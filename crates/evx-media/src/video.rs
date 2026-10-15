//! 360° video through a local ffmpeg/ffprobe (bundled LGPL build next to Studio's
//! executable; never downloaded at runtime).
//!
//! Every invocation passes `-protocol_whitelist file,pipe`, so ffmpeg cannot open a
//! network URL even if a crafted file (playlist, concat list) points to one.

use crate::error::{MediaError, Result};
use crate::probe::{layout_for, ImageLayout};
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
};

const PROTOCOLS: [&str; 2] = ["-protocol_whitelist", "file,pipe"];

#[derive(Debug, Clone)]
pub struct Ffmpeg {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

/// Build configuration of an ffmpeg binary, for the licence check.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegBuild {
    pub version: String,
    pub gpl: bool,
    pub nonfree: bool,
}

impl FfmpegBuild {
    /// Evactis may only redistribute LGPL builds (no --enable-gpl / --enable-nonfree).
    pub fn redistributable(&self) -> bool {
        !self.gpl && !self.nonfree
    }

    pub fn parse(version_output: &str) -> Self {
        let version = version_output
            .lines()
            .next()
            .and_then(|l| l.strip_prefix("ffmpeg version "))
            .and_then(|l| l.split_whitespace().next())
            .unwrap_or("unknown")
            .to_string();
        let config = version_output
            .lines()
            .find_map(|l| l.trim().strip_prefix("configuration:"))
            .unwrap_or("");
        let has = |flag: &str| config.split_whitespace().any(|w| w == flag);
        Self {
            version,
            gpl: has("--enable-gpl"),
            nonfree: has("--enable-nonfree"),
        }
    }
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Hides the console window ffmpeg would otherwise flash on Windows.
fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.stdin(Stdio::null());
    c
}

impl Ffmpeg {
    /// Finds ffmpeg + ffprobe in the first of: `dir`, `$EVX_FFMPEG_DIR`, the folder of
    /// the running executable (where the installer puts the sidecar), then `PATH`.
    pub fn locate(dir: Option<&Path>) -> Option<Self> {
        let mut candidates: Vec<PathBuf> = vec![];
        candidates.extend(dir.map(Path::to_path_buf));
        candidates.extend(std::env::var_os("EVX_FFMPEG_DIR").map(PathBuf::from));
        if let Some(d) = std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(Path::to_path_buf))
        {
            candidates.push(d);
        }
        for d in candidates {
            let (f, p) = (d.join(exe("ffmpeg")), d.join(exe("ffprobe")));
            if f.is_file() && p.is_file() {
                return Some(Self {
                    ffmpeg: f,
                    ffprobe: p,
                });
            }
        }
        let on_path = |name: &str| -> Option<PathBuf> {
            std::env::split_paths(&std::env::var_os("PATH")?)
                .map(|d| d.join(exe(name)))
                .find(|p| p.is_file())
        };
        Some(Self {
            ffmpeg: on_path("ffmpeg")?,
            ffprobe: on_path("ffprobe")?,
        })
    }

    pub fn build(&self) -> Result<FfmpegBuild> {
        let out = command(&self.ffmpeg)
            .args(["-hide_banner", "-version"])
            .output()
            .map_err(|e| MediaError::Ffmpeg(format!("cannot run ffmpeg: {e}")))?;
        Ok(FfmpegBuild::parse(&String::from_utf8_lossy(&out.stdout)))
    }

    fn encoders(&self) -> Result<String> {
        let out = command(&self.ffmpeg)
            .args(["-hide_banner", "-encoders"])
            .output()
            .map_err(|e| MediaError::Ffmpeg(e.to_string()))?;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    pub fn probe(&self, path: &Path) -> Result<VideoInfo> {
        let out = command(&self.ffprobe)
            .args(["-v", "error"])
            .args(PROTOCOLS)
            .args(["-print_format", "json", "-show_streams", "-show_format"])
            .arg(path)
            .output()
            .map_err(|e| MediaError::Ffmpeg(format!("cannot run ffprobe: {e}")))?;
        if !out.status.success() {
            return Err(MediaError::Invalid(format!(
                "not a readable video: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        VideoInfo::from_ffprobe(&out.stdout)
    }

    /// Converts `src` into a playback file in `out_dir` and returns its file name.
    /// `progress` receives (processed, total) microseconds.
    pub fn transcode(
        &self,
        src: &Path,
        info: &VideoInfo,
        out_dir: &Path,
        max_width: u32,
        cancel: &AtomicBool,
        progress: &dyn Fn(u64, u64),
    ) -> Result<String> {
        let total = (info.duration_sec * 1e6) as u64;
        // Already H.264 in MP4 at a playable size: copy the streams, no quality loss.
        if info.codec == "h264" && info.container_mp4 && info.width <= max_width {
            let out = out_dir.join("video.mp4");
            let args = vec![
                "-c".into(),
                "copy".into(),
                "-movflags".into(),
                "+faststart".into(),
            ];
            self.run(src, &out, &args, total, cancel, progress)?;
            return Ok("video.mp4".into());
        }
        let encoders = self.encoders()?;
        let scale = if info.width > max_width {
            vec![
                "-vf".to_string(),
                format!("scale={max_width}:-2:flags=lanczos"),
            ]
        } else {
            vec![]
        };
        let mut last_err =
            MediaError::Ffmpeg("no suitable video encoder in this ffmpeg build".into());
        for plan in encoder_plans(&encoders, info.has_audio) {
            let out = out_dir.join(plan.file);
            let mut args: Vec<String> = scale.clone();
            args.extend(plan.args.iter().map(|s| s.to_string()));
            match self.run(src, &out, &args, total, cancel, progress) {
                Ok(()) => return Ok(plan.file.into()),
                Err(MediaError::Cancelled) => return Err(MediaError::Cancelled),
                Err(e) => {
                    // Hardware encoders are listed even without the hardware; try the next.
                    let _ = std::fs::remove_file(&out);
                    last_err = e;
                }
            }
        }
        Err(last_err)
    }

    fn run(
        &self,
        src: &Path,
        out: &Path,
        args: &[String],
        total_us: u64,
        cancel: &AtomicBool,
        progress: &dyn Fn(u64, u64),
    ) -> Result<()> {
        let mut child = command(&self.ffmpeg)
            .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"])
            .args(PROTOCOLS)
            .arg("-i")
            .arg(src)
            .args(args)
            .args(["-progress", "pipe:1", "-nostats"])
            .arg(out)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| MediaError::Ffmpeg(format!("cannot run ffmpeg: {e}")))?;
        let mut stderr = child.stderr.take().expect("piped");
        let err_reader = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });
        let stdout = BufReader::new(child.stdout.take().expect("piped"));
        for line in stdout.lines() {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(MediaError::Cancelled);
            }
            let Ok(line) = line else { break };
            if let Some(us) = line
                .strip_prefix("out_time_us=")
                .and_then(|v| v.parse::<u64>().ok())
            {
                progress(us.min(total_us), total_us);
            }
        }
        let status = child.wait()?;
        let err = err_reader.join().unwrap_or_default();
        if cancel.load(Ordering::Relaxed) {
            return Err(MediaError::Cancelled);
        }
        if !status.success() {
            let msg = err
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("unknown error");
            return Err(MediaError::Ffmpeg(msg.trim().to_string()));
        }
        progress(total_us, total_us);
        Ok(())
    }

    /// Writes one frame (at 1 s, or mid-clip for short clips) as a high-quality JPEG.
    pub fn poster(&self, src: &Path, info: &VideoInfo, out: &Path) -> Result<()> {
        let at = (info.duration_sec / 2.0).min(1.0);
        let st = command(&self.ffmpeg)
            .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"])
            .args(PROTOCOLS)
            .args(["-ss", &format!("{at:.3}"), "-i"])
            .arg(src)
            .args(["-frames:v", "1", "-q:v", "2"])
            .arg(out)
            .output()
            .map_err(|e| MediaError::Ffmpeg(e.to_string()))?;
        if !st.status.success() || !out.is_file() {
            return Err(MediaError::Ffmpeg(format!(
                "could not extract a poster frame: {}",
                String::from_utf8_lossy(&st.stderr).trim()
            )));
        }
        Ok(())
    }
}

struct Plan {
    file: &'static str,
    args: Vec<&'static str>,
}

/// Encoders in preference order. All are compatible with an LGPL ffmpeg build
/// (libx264/libx265 are GPL and deliberately absent).
fn encoder_plans(encoders: &str, audio: bool) -> Vec<Plan> {
    let has = |name: &str| {
        encoders
            .lines()
            .any(|l| l.split_whitespace().nth(1) == Some(name))
    };
    let aac: Vec<&'static str> = if audio {
        vec!["-c:a", "aac", "-b:a", "160k"]
    } else {
        vec!["-an"]
    };
    let mp4 = |v: &[&'static str]| -> Plan {
        let mut args = v.to_vec();
        args.extend(["-pix_fmt", "yuv420p"]);
        args.extend(aac.iter().copied());
        args.extend(["-movflags", "+faststart"]);
        Plan {
            file: "video.mp4",
            args,
        }
    };
    let mut plans = vec![];
    for (name, extra) in [
        ("h264_nvenc", &["-preset", "p5", "-cq", "21"][..]),
        ("h264_qsv", &["-global_quality", "21"][..]),
        (
            "h264_amf",
            &[
                "-quality", "quality", "-rc", "cqp", "-qp_i", "21", "-qp_p", "23",
            ][..],
        ),
        ("h264_mf", &["-b:v", "20M"][..]),
        ("libopenh264", &["-b:v", "20M"][..]),
    ] {
        if has(name) {
            let mut v = vec!["-c:v", name];
            v.extend(extra);
            plans.push(mp4(&v));
        }
    }
    if has("libvpx-vp9") {
        let mut args = vec![
            "-c:v",
            "libvpx-vp9",
            "-crf",
            "30",
            "-b:v",
            "0",
            "-row-mt",
            "1",
            "-pix_fmt",
            "yuv420p",
        ];
        if audio && has("libopus") {
            args.extend(["-c:a", "libopus"]);
        } else {
            args.push("-an");
        }
        plans.push(Plan {
            file: "video.webm",
            args,
        });
    }
    plans
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub duration_sec: f64,
    pub codec: String,
    pub has_audio: bool,
    pub container_mp4: bool,
}

impl VideoInfo {
    pub fn from_ffprobe(json: &[u8]) -> Result<Self> {
        let v: serde_json::Value = serde_json::from_slice(json)
            .map_err(|e| MediaError::Ffmpeg(format!("ffprobe output: {e}")))?;
        let streams = v["streams"].as_array().cloned().unwrap_or_default();
        let video = streams
            .iter()
            .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
            .ok_or_else(|| MediaError::Invalid("the file has no video stream".into()))?;
        let num = |x: &serde_json::Value| {
            x.as_f64()
                .or_else(|| x.as_str().and_then(|s| s.parse().ok()))
        };
        let duration = num(&v["format"]["duration"])
            .or_else(|| num(&video["duration"]))
            .unwrap_or(0.0);
        let format_name = v["format"]["format_name"].as_str().unwrap_or("");
        Ok(Self {
            width: video["width"].as_u64().unwrap_or(0) as u32,
            height: video["height"].as_u64().unwrap_or(0) as u32,
            duration_sec: duration,
            codec: video["codec_name"]
                .as_str()
                .unwrap_or("unknown")
                .to_string(),
            has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
            container_mp4: format_name.split(',').any(|f| f == "mp4"),
        })
    }

    /// 360° video uses the same frame shapes as panoramas.
    pub fn layout(&self) -> Result<ImageLayout> {
        layout_for(self.width, self.height).ok_or_else(|| {
            MediaError::Invalid(format!(
                "{}×{} is not a 360° video: expected 2:1 (or 1:1 / 4:1 for stereo)",
                self.width, self.height
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn licence_check_reads_the_build_configuration() {
        let lgpl = "ffmpeg version n8.0-lgpl Copyright (c)\nbuilt with gcc\nconfiguration: --prefix=/x --enable-version3 --enable-libvpx\nlibavutil 60";
        let gpl = "ffmpeg version 6.1.1-3ubuntu5 Copyright\nconfiguration: --enable-gpl --enable-libx264\n";
        let nonfree = "ffmpeg version 7\n  configuration: --enable-nonfree --enable-libfdk-aac\n";
        assert_eq!(
            FfmpegBuild::parse(lgpl),
            FfmpegBuild {
                version: "n8.0-lgpl".into(),
                gpl: false,
                nonfree: false
            }
        );
        assert!(FfmpegBuild::parse(lgpl).redistributable());
        assert!(!FfmpegBuild::parse(gpl).redistributable());
        assert!(!FfmpegBuild::parse(nonfree).redistributable());
    }

    #[test]
    fn encoder_preference_never_picks_gpl_encoders() {
        let list = " V....D libx264  H.264 (GPL)\n V....D h264_mf  H264 via MediaFoundation\n V....D libvpx-vp9 VP9\n A....D libopus Opus\n";
        let plans = encoder_plans(list, true);
        assert_eq!(plans.len(), 2);
        assert!(plans[0].args.contains(&"h264_mf") && plans[0].args.contains(&"aac"));
        assert_eq!(plans[1].file, "video.webm");
        assert!(plans.iter().all(|p| !p.args.contains(&"libx264")));
        assert!(encoder_plans(" V....D libx264 GPL\n", false).is_empty());
    }

    #[test]
    fn parses_ffprobe_json() {
        let json = br#"{"streams":[{"codec_type":"video","codec_name":"hevc","width":5760,"height":2880,"disposition":{"attached_pic":0}},{"codec_type":"audio"}],"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"12.5"}}"#;
        let i = VideoInfo::from_ffprobe(json).unwrap();
        assert_eq!((i.width, i.height, i.codec.as_str()), (5760, 2880, "hevc"));
        assert!(i.has_audio && i.container_mp4);
        assert_eq!(i.duration_sec, 12.5);
        assert_eq!(i.layout().unwrap(), ImageLayout::Mono);
        assert!(
            VideoInfo::from_ffprobe(br#"{"streams":[{"codec_type":"audio"}],"format":{}}"#)
                .is_err()
        );
    }
}
