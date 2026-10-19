//! Project versions: local snapshots of the manifest in `<project>/.evx-history/`.
//!
//! Media is content-addressed and never modified after import (`media/<sha256-prefix>/`),
//! so a copy of the `.evxproj` manifest is a complete version of the project. Nothing
//! leaves the project folder.
//!
//! Each snapshot is two files: `<id>.evxproj` (the manifest) and `<id>.json` (label,
//! kind, time). Automatic snapshots are pruned to the newest `keep`; manual ones and
//! "before restore" ones are kept until the user deletes them.

use crate::project::ProjectLocation;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

pub const HISTORY_DIR: &str = ".evx-history";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotKind {
    /// Taken by Studio (on open, periodically while editing).
    Auto,
    /// "Save version" by the author.
    Manual,
    /// Taken just before a restore replaced the project, so a restore can be undone.
    BeforeRestore,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub label: String,
    pub kind: SnapshotKind,
    /// UTC, ISO 8601.
    pub created_at: String,
    pub bytes: u64,
}

fn dir(loc: &ProjectLocation) -> PathBuf {
    loc.root.join(HISTORY_DIR)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Copies the current manifest into the history. `now` is an ISO 8601 UTC timestamp.
/// An automatic snapshot identical to the newest snapshot is skipped (returns None).
pub fn take(
    loc: &ProjectLocation,
    label: &str,
    kind: SnapshotKind,
    now: &str,
) -> Result<Option<Snapshot>, String> {
    let manifest = fs::read(&loc.manifest).map_err(|e| e.to_string())?;
    if kind == SnapshotKind::Auto {
        if let Some(latest) = list(loc)?.first() {
            if read(loc, &latest.id)? == manifest {
                return Ok(None);
            }
        }
    }
    let d = dir(loc);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let stamp: String = now.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let mut id = stamp.clone();
    let mut n = 1;
    while d.join(format!("{id}.evxproj")).exists() {
        n += 1;
        id = format!("{stamp}-{n}");
    }
    let snap = Snapshot {
        id: id.clone(),
        label: label.chars().take(120).collect(),
        kind,
        created_at: now.to_string(),
        bytes: manifest.len() as u64,
    };
    fs::write(d.join(format!("{id}.evxproj")), &manifest).map_err(|e| e.to_string())?;
    let meta = serde_json::to_vec_pretty(&snap).map_err(|e| e.to_string())?;
    fs::write(d.join(format!("{id}.json")), meta).map_err(|e| e.to_string())?;
    Ok(Some(snap))
}

/// Every snapshot, newest first. Unreadable entries are skipped.
pub fn list(loc: &ProjectLocation) -> Result<Vec<Snapshot>, String> {
    let d = dir(loc);
    if !d.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<Snapshot> = fs::read_dir(&d)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .filter_map(|p| serde_json::from_slice::<Snapshot>(&fs::read(p).ok()?).ok())
        .filter(|s| valid_id(&s.id) && d.join(format!("{}.evxproj", s.id)).is_file())
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    Ok(out)
}

/// The manifest bytes of one snapshot.
pub fn read(loc: &ProjectLocation, id: &str) -> Result<Vec<u8>, String> {
    if !valid_id(id) {
        return Err(format!("not a snapshot ID: {id}"));
    }
    fs::read(dir(loc).join(format!("{id}.evxproj"))).map_err(|e| e.to_string())
}

pub fn delete(loc: &ProjectLocation, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("not a snapshot ID: {id}"));
    }
    let d = dir(loc);
    for ext in ["evxproj", "json"] {
        let p = d.join(format!("{id}.{ext}"));
        if p.exists() {
            fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Keeps the newest `keep` automatic snapshots; other kinds are never pruned.
pub fn prune_auto(loc: &ProjectLocation, keep: usize) -> Result<usize, String> {
    let autos: Vec<Snapshot> = list(loc)?
        .into_iter()
        .filter(|s| s.kind == SnapshotKind::Auto)
        .collect();
    let mut removed = 0;
    for s in autos.iter().skip(keep) {
        delete(loc, &s.id)?;
        removed += 1;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("evx-history-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn takes_lists_reads_and_prunes() {
        let d = temp("all");
        let loc = project::create(&d, "Riverside", b"{\"v\":1}").unwrap();
        let a = take(&loc, "Opened", SnapshotKind::Auto, "2026-10-19T10:00:00Z")
            .unwrap()
            .unwrap();
        // Unchanged manifest: no duplicate automatic snapshot.
        assert!(
            take(&loc, "Opened", SnapshotKind::Auto, "2026-10-19T10:05:00Z")
                .unwrap()
                .is_none()
        );
        project::save_manifest(&loc, b"{\"v\":2}").unwrap();
        let m = take(
            &loc,
            "Before client review",
            SnapshotKind::Manual,
            "2026-10-19T11:00:00Z",
        )
        .unwrap()
        .unwrap();
        // Same second: a distinct ID.
        let m2 = take(&loc, "Again", SnapshotKind::Manual, "2026-10-19T11:00:00Z")
            .unwrap()
            .unwrap();
        assert_ne!(m.id, m2.id);

        let all = list(&loc).unwrap();
        assert_eq!(
            all.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(),
            ["Again", "Before client review", "Opened"]
        );
        assert_eq!(read(&loc, &a.id).unwrap(), b"{\"v\":1}");
        assert_eq!(read(&loc, &m.id).unwrap(), b"{\"v\":2}");
        assert!(read(&loc, "../Riverside").is_err());

        for i in 0..5 {
            project::save_manifest(&loc, format!("{{\"v\":{}}}", 10 + i).as_bytes()).unwrap();
            take(
                &loc,
                "Autosave",
                SnapshotKind::Auto,
                &format!("2026-10-19T12:0{i}:00Z"),
            )
            .unwrap();
        }
        assert_eq!(prune_auto(&loc, 3).unwrap(), 3);
        let after = list(&loc).unwrap();
        assert_eq!(
            after
                .iter()
                .filter(|s| s.kind == SnapshotKind::Auto)
                .count(),
            3
        );
        assert_eq!(
            after
                .iter()
                .filter(|s| s.kind == SnapshotKind::Manual)
                .count(),
            2
        );
        fs::remove_dir_all(d).unwrap();
    }
}
