//! Smoke-test report written by `--smoke-test <path>`: proves the installed app
//! started, loaded its bundled UI in WebView2 and could talk to the Rust core.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmokeReport {
    pub app: String,
    pub version: String,
    /// Reported by the UI once it has rendered.
    pub ui_ready: bool,
    pub user_agent: String,
    pub location: String,
    /// Network requests the UI saw attempted (must be empty).
    pub blocked_requests: Vec<String>,
    pub error: Option<String>,
    /// What the run verified beyond start-up (e.g. a media import), for the log.
    #[serde(default)]
    pub checks: Vec<String>,
}

impl SmokeReport {
    pub fn failure(app: &str, version: &str, error: impl Into<String>) -> Self {
        Self {
            app: app.into(),
            version: version.into(),
            ui_ready: false,
            user_agent: String::new(),
            location: String::new(),
            blocked_requests: vec![],
            error: Some(error.into()),
            checks: vec![],
        }
    }

    pub fn passed(&self) -> bool {
        self.ui_ready && self.error.is_none() && self.blocked_requests.is_empty()
    }

    pub fn write(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_judges_pass_fail() {
        let path = std::env::temp_dir().join(format!("evx-smoke-{}/r.json", std::process::id()));
        let ok = SmokeReport {
            app: "EVACTIS 3DWORKFLOW Viewer".into(),
            version: "0.1.0".into(),
            ui_ready: true,
            user_agent: "Edg/1".into(),
            location: "http://tauri.localhost/".into(),
            blocked_requests: vec![],
            error: None,
            checks: vec!["import: ok".into()],
        };
        ok.write(&path).unwrap();
        let back: SmokeReport = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(back, ok);
        assert!(ok.passed());
        assert!(!SmokeReport::failure("x", "0", "timeout").passed());
        let mut leaked = ok.clone();
        leaked.blocked_requests.push("https://example.com".into());
        assert!(!leaked.passed());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
