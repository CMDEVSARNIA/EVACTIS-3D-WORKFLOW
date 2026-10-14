//! Locating Studio projects.
//!
//! A project is a folder holding `<name>.evxproj` (the environment JSON manifest) and
//! its `media/`. Windows cannot associate a *folder* by extension, so the
//! double-clickable `.evxproj` is the manifest file; Studio opens its parent folder.
//! A folder named `<name>.evxproj` is also accepted (see docs/decisions/0004).

use std::path::{Path, PathBuf};

use crate::identity::PROJECT_EXT;

#[derive(Debug, PartialEq, Eq)]
pub struct ProjectLocation {
    /// Project root folder (holds media/ and snapshots/).
    pub root: PathBuf,
    /// The manifest file.
    pub manifest: PathBuf,
}

fn has_ext(p: &Path, ext: &str) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// Resolves a path the user opened (manifest file or project folder) to a project.
pub fn locate(path: &Path) -> Result<ProjectLocation, String> {
    if path.is_file() {
        if !has_ext(path, PROJECT_EXT) {
            return Err(format!("{} is not a .{PROJECT_EXT} file", path.display()));
        }
        let root = path.parent().map(Path::to_path_buf).unwrap_or_default();
        return Ok(ProjectLocation { root, manifest: path.to_path_buf() });
    }
    if path.is_dir() {
        let manifests: Vec<PathBuf> = std::fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_file() && has_ext(p, PROJECT_EXT))
            .collect();
        return match manifests.as_slice() {
            [one] => Ok(ProjectLocation { root: path.to_path_buf(), manifest: one.clone() }),
            [] => Err(format!("No .{PROJECT_EXT} file in {}", path.display())),
            _ => Err(format!("More than one .{PROJECT_EXT} file in {}", path.display())),
        };
    }
    Err(format!("{} does not exist", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("evx-core-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn opens_manifest_file_or_folder() {
        let d = temp("ok");
        let m = d.join("Riverside.evxproj");
        fs::write(&m, "{}").unwrap();
        assert_eq!(locate(&m).unwrap(), ProjectLocation { root: d.clone(), manifest: m.clone() });
        assert_eq!(locate(&d).unwrap().manifest, m);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn rejects_wrong_or_ambiguous_input() {
        let d = temp("bad");
        assert!(locate(&d).unwrap_err().contains("No .evxproj"));
        fs::write(d.join("a.evxproj"), "{}").unwrap();
        fs::write(d.join("b.EVXPROJ"), "{}").unwrap();
        assert!(locate(&d).unwrap_err().contains("More than one"));
        fs::write(d.join("x.txt"), "").unwrap();
        assert!(locate(&d.join("x.txt")).is_err());
        assert!(locate(&d.join("missing")).is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
