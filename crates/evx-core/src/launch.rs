//! Command-line arguments shared by Studio and Viewer.
//!
//! - a positional path: the file Explorer asked us to open (file association)
//! - `--smoke-test <report.json>`: start, let the UI report it rendered, write the
//!   report and exit. Used by the Windows install → launch → uninstall CI job.

use std::path::PathBuf;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LaunchArgs {
    pub open: Option<PathBuf>,
    pub smoke_test: Option<PathBuf>,
}

/// Parses arguments, excluding the program name. Unknown flags are ignored so that
/// Windows/WebView2 switches never stop the app from starting.
pub fn parse<I, S>(args: I) -> LaunchArgs
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut out = LaunchArgs::default();
    let mut it = args.into_iter().map(Into::into);
    while let Some(arg) = it.next() {
        if arg == "--smoke-test" {
            out.smoke_test = it.next().map(PathBuf::from);
        } else if let Some(v) = arg.strip_prefix("--smoke-test=") {
            out.smoke_test = Some(PathBuf::from(v));
        } else if !arg.starts_with('-') && out.open.is_none() {
            out.open = Some(PathBuf::from(arg));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_file_and_smoke_flag() {
        let a = parse(["C:\\Sites\\Riverside.evx", "--smoke-test", "out.json"]);
        assert_eq!(a.open, Some(PathBuf::from("C:\\Sites\\Riverside.evx")));
        assert_eq!(a.smoke_test, Some(PathBuf::from("out.json")));
        assert_eq!(parse(["--smoke-test=r.json"]).smoke_test, Some(PathBuf::from("r.json")));
    }

    #[test]
    fn ignores_unknown_flags_and_empty_input() {
        assert_eq!(parse(Vec::<String>::new()), LaunchArgs::default());
        let a = parse(["--some-webview-switch", "a.evxproj", "b.evxproj"]);
        assert_eq!(a.open, Some(PathBuf::from("a.evxproj")));
        assert_eq!(a.smoke_test, None);
    }
}
