//! Offline guard for the desktop webviews. Navigation is only allowed to the app's
//! own bundled content; everything else (http, https, file, ws…) is refused.

/// Origins Tauri v2 serves bundled assets and IPC from (Windows uses
/// `http(s)://<name>.localhost`, other platforms custom schemes).
const APP_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "asset://localhost",
    "http://asset.localhost",
    "https://asset.localhost",
    "ipc://localhost",
    "http://ipc.localhost",
    "https://ipc.localhost",
];

/// Dev server used by `tauri dev` (loopback only).
const DEV_ORIGINS: &[&str] = &["http://127.0.0.1:1420", "http://127.0.0.1:1421"];

/// Whether the webview may navigate to `url`.
pub fn is_app_url(url: &str, allow_dev: bool) -> bool {
    let matches = |origin: &&str| {
        url == *origin
            || url
                .strip_prefix(*origin)
                .is_some_and(|rest| rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('#'))
    };
    APP_ORIGINS.iter().any(matches) || (allow_dev && DEV_ORIGINS.iter().any(matches)) || url == "about:blank"
}

#[cfg(test)]
mod tests {
    use super::is_app_url;

    #[test]
    fn allows_bundled_content() {
        assert!(is_app_url("http://tauri.localhost/index.html", false));
        assert!(is_app_url("tauri://localhost/", false));
        assert!(is_app_url("about:blank", false));
        assert!(is_app_url("http://127.0.0.1:1420/", true));
    }

    #[test]
    fn refuses_everything_else() {
        for url in [
            "https://evactis.ca/",
            "http://example.com",
            "http://tauri.localhost.evil.com/",
            "https://tauri.localhostx/",
            "file:///C:/Windows/",
            "ws://127.0.0.1:1420/",
            "http://127.0.0.1:1420/",
        ] {
            assert!(!is_app_url(url, false), "{url} must be refused");
        }
    }
}
