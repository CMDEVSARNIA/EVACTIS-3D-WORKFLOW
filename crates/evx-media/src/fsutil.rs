//! Finishing an import on Windows, where another program often holds new files open for
//! a moment: an antivirus scan, the search indexer, or a sync app such as OneDrive.
//! Renaming or removing their folder then fails with "Access is denied" (os error 5) or
//! a sharing violation (32, 33) until it lets go, so those errors are retried.

use std::fs;
use std::io;
use std::path::Path;
use std::thread;
use std::time::Duration;

/// Waits between attempts: about 6 s in total before giving up.
const BUSY_DELAYS_MS: [u64; 8] = [50, 100, 200, 400, 800, 1200, 1600, 2000];

/// A Windows error that another process's open handle causes and that clears by itself.
pub fn is_busy(e: &io::Error) -> bool {
    cfg!(windows) && matches!(e.raw_os_error(), Some(5 | 32 | 33))
}

/// Runs `op`, retrying while it fails with a busy error.
pub fn retry_busy<T>(op: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    retry(&BUSY_DELAYS_MS, is_busy, op)
}

pub(crate) fn retry<T>(
    delays_ms: &[u64],
    transient: impl Fn(&io::Error) -> bool,
    mut op: impl FnMut() -> io::Result<T>,
) -> io::Result<T> {
    let mut attempt = 0;
    loop {
        match op() {
            Err(e) if attempt < delays_ms.len() && transient(&e) => {
                thread::sleep(Duration::from_millis(delays_ms[attempt]));
                attempt += 1;
            }
            result => return result,
        }
    }
}

/// Moves the folder `from` to `to` (same volume). A folder rename fails while any file in
/// it is held open; moving file by file only waits for the files actually held.
pub fn move_dir(from: &Path, to: &Path) -> io::Result<()> {
    match retry_busy(|| fs::rename(from, to)) {
        Ok(()) => Ok(()),
        Err(e) if is_busy(&e) => {
            move_entries(from, to)?;
            retry_busy(|| fs::remove_dir(from))
        }
        Err(e) => Err(e),
    }
}

fn move_entries(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            move_entries(&entry.path(), &target)?;
            retry_busy(|| fs::remove_dir(entry.path()))?;
        } else {
            retry_busy(|| fs::rename(entry.path(), &target))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn denied() -> io::Error {
        io::Error::from_raw_os_error(5)
    }

    #[test]
    fn retries_a_busy_error_until_it_clears() {
        let calls = Cell::new(0);
        let r = retry(
            &[0, 0, 0],
            |_| true,
            || {
                calls.set(calls.get() + 1);
                if calls.get() < 3 {
                    Err(denied())
                } else {
                    Ok(7)
                }
            },
        );
        assert_eq!(r.unwrap(), 7);
        assert_eq!(calls.get(), 3);
    }

    #[test]
    fn gives_up_after_the_last_wait_and_never_retries_other_errors() {
        let calls = Cell::new(0);
        let r: io::Result<()> = retry(
            &[0, 0],
            |_| true,
            || {
                calls.set(calls.get() + 1);
                Err(denied())
            },
        );
        assert_eq!(r.unwrap_err().raw_os_error(), Some(5));
        assert_eq!(calls.get(), 3);

        calls.set(0);
        let r: io::Result<()> = retry(
            &[0, 0],
            |_| false,
            || {
                calls.set(calls.get() + 1);
                Err(io::Error::from(io::ErrorKind::NotFound))
            },
        );
        assert!(r.is_err());
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn busy_means_access_denied_or_a_sharing_violation_on_windows_only() {
        for code in [5, 32, 33] {
            assert_eq!(is_busy(&io::Error::from_raw_os_error(code)), cfg!(windows));
        }
        assert!(!is_busy(&io::Error::from(io::ErrorKind::NotFound)));
    }

    #[test]
    fn moves_a_folder_with_subfolders() {
        let root = std::env::temp_dir().join(format!("evx-move-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let from = root.join(".import-1");
        fs::create_dir_all(from.join("tiles/0")).unwrap();
        fs::write(from.join("asset.json"), "{}").unwrap();
        fs::write(from.join("tiles/0/f.jpg"), "x").unwrap();
        let to = root.join("abc");
        move_dir(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read_to_string(to.join("tiles/0/f.jpg")).unwrap(), "x");
        // The file-by-file path, as used when the folder rename stays busy.
        let back = root.join("again");
        move_entries(&to, &back).unwrap();
        assert_eq!(fs::read_to_string(back.join("asset.json")).unwrap(), "{}");
        fs::remove_dir_all(&root).unwrap();
    }
}
