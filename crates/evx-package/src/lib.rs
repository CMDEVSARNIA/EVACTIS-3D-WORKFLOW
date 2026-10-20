//! Reading EVACTIS 3DWORKFLOW delivery packages (`.evx`) in the desktop Viewer.
//!
//! Same format as `packages/package-format` (TypeScript), which writes them:
//! - `evx-manifest.json` lists every other file with its size and SHA-256; a file that
//!   does not match, or is not listed, is refused;
//! - an encrypted package keeps its environment as numbered AES-256-GCM blobs (the blob's
//!   name is the associated data) plus an encrypted index of the real names; the key comes
//!   from the passphrase through Argon2id with the costs and salt in the manifest.
//!
//! Decrypted bytes only ever live in memory. There is no network code.

mod zip;

use std::{collections::HashMap, fmt, path::Path};

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub const MANIFEST_PATH: &str = "evx-manifest.json";
pub const INDEX_PATH: &str = "content/index.bin";
const FORMAT: &str = "evactis-3dworkflow-package";
const NONCE: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Io(String),
    /// Not a package this Viewer can read.
    NotAPackage,
    Unsupported(String),
    /// A file is altered, damaged, missing or not listed.
    Integrity(String),
    /// The passphrase does not open the package.
    Passphrase,
    /// The package is encrypted and has not been unlocked.
    Locked,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(e) => write!(f, "the package could not be read: {e}"),
            Error::NotAPackage => write!(f, "this file is not an EVACTIS 3DWORKFLOW package"),
            Error::Unsupported(e) => write!(f, "this package is not supported: {e}"),
            Error::Integrity(p) => write!(f, "the package file \"{p}\" failed its integrity check"),
            Error::Passphrase => write!(f, "this passphrase does not open the package"),
            Error::Locked => write!(f, "the package is encrypted: a passphrase is needed"),
        }
    }
}

impl std::error::Error for Error {}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Kdf {
    pub name: String,
    #[serde(rename = "memoryKiB")]
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub salt: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Encryption {
    pub cipher: String,
    pub kdf: Kdf,
    pub index: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentInfo {
    pub id: String,
    pub title: HashMap<String, String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub kind: String,
    pub created_at: String,
    pub producer: String,
    pub environment: EnvironmentInfo,
    pub encryption: Option<Encryption>,
    pub files: Vec<ManifestFile>,
}

#[derive(Deserialize)]
struct Index {
    entries: Vec<IndexEntry>,
}
#[derive(Deserialize)]
struct IndexEntry {
    path: String,
    blob: String,
}

/// A path inside a package: relative, `/`-separated, no `.`/`..` parts, plain characters.
fn safe_path(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && p.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part.chars().all(|c| c.is_alphanumeric() || " _.()&'+,@~-".contains(c))
        })
}

pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, Error> {
    let m: Manifest = serde_json::from_slice(bytes).map_err(|_| Error::NotAPackage)?;
    if m.format != FORMAT {
        return Err(Error::NotAPackage);
    }
    if m.format_version != 1 {
        return Err(Error::Unsupported(format!("format {}", m.format_version)));
    }
    let mut seen = std::collections::HashSet::new();
    for f in &m.files {
        let hex_ok = f.sha256.len() == 64 && f.sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !safe_path(&f.path) || f.path == MANIFEST_PATH || !hex_ok || !seen.insert(f.path.as_str()) {
            return Err(Error::Unsupported(format!("manifest entry {:?}", f.path)));
        }
    }
    if let Some(e) = &m.encryption {
        let k = &e.kdf;
        if e.cipher != "AES-256-GCM"
            || e.index != INDEX_PATH
            || k.name != "Argon2id"
            || k.memory_kib == 0
            || k.memory_kib > 1024 * 1024
            || !(1..=16).contains(&k.iterations)
            || !(1..=8).contains(&k.parallelism)
            || !seen.contains(INDEX_PATH)
        {
            return Err(Error::Unsupported("encryption settings".into()));
        }
    }
    Ok(m)
}

pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// The 256-bit key for a passphrase (NFC is applied by the caller's UI; Rust strings from
/// the webview arrive as typed).
pub fn derive_key(passphrase: &str, kdf: &Kdf) -> Result<Zeroizing<[u8; 32]>, Error> {
    let salt = base64::engine::general_purpose::STANDARD
        .decode(&kdf.salt)
        .map_err(|_| Error::Unsupported("salt".into()))?;
    let params = argon2::Params::new(kdf.memory_kib, kdf.iterations, kdf.parallelism, Some(32))
        .map_err(|e| Error::Unsupported(e.to_string()))?;
    let argon = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(passphrase.as_bytes(), &salt, key.as_mut())
        .map_err(|e| Error::Unsupported(e.to_string()))?;
    Ok(key)
}

/// Decrypts one blob (nonce ‖ ciphertext ‖ tag) stored under `name`.
pub fn open_blob(key: &[u8; 32], name: &str, blob: &[u8]) -> Result<Vec<u8>, Error> {
    if blob.len() < NONCE + 16 {
        return Err(Error::Integrity(name.to_owned()));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| Error::Unsupported("key".into()))?;
    cipher
        .decrypt(Nonce::from_slice(&blob[..NONCE]), Payload { msg: &blob[NONCE..], aad: name.as_bytes() })
        .map_err(|_| Error::Integrity(name.to_owned()))
}

/// An open `.evx` package.
pub struct Package {
    zip: zip::Zip,
    pub manifest: Manifest,
    /// SHA-256 of the manifest itself (shown so it can be compared with the delivery note).
    pub digest: String,
    manifest_bytes: Vec<u8>,
    files: HashMap<String, ManifestFile>,
    key: Option<Zeroizing<[u8; 32]>>,
    index: Option<HashMap<String, String>>,
}

impl Package {
    pub fn open(path: &Path) -> Result<Self, Error> {
        let mut zip = zip::Zip::open(path)?;
        let bytes = zip.read(MANIFEST_PATH).map_err(|_| Error::NotAPackage)?;
        let manifest = parse_manifest(&bytes)?;
        let files = manifest.files.iter().map(|f| (f.path.clone(), f.clone())).collect();
        Ok(Self { zip, digest: sha256_hex(&bytes), manifest_bytes: bytes, manifest, files, key: None, index: None })
    }

    /// The manifest exactly as stored (readers hash it themselves).
    pub fn manifest_bytes(&self) -> Result<Vec<u8>, Error> {
        Ok(self.manifest_bytes.clone())
    }

    pub fn encrypted(&self) -> bool {
        self.manifest.encryption.is_some()
    }

    pub fn locked(&self) -> bool {
        self.encrypted() && self.index.is_none()
    }

    /// The stored bytes of a listed file, checked against the manifest.
    pub fn stored(&mut self, path: &str) -> Result<Vec<u8>, Error> {
        let f = self.files.get(path).ok_or_else(|| Error::Integrity(path.to_owned()))?;
        let (size, hash) = (f.size, f.sha256.clone());
        let data = self.zip.read(path).map_err(|_| Error::Integrity(path.to_owned()))?;
        if data.len() as u64 != size || sha256_hex(&data) != hash {
            return Err(Error::Integrity(path.to_owned()));
        }
        Ok(data)
    }

    /// Checks every listed file, and that the package holds nothing unlisted.
    pub fn verify_all(&mut self, mut progress: impl FnMut(usize, usize)) -> Result<(), Error> {
        if let Some(extra) = self.zip.names().find(|n| *n != MANIFEST_PATH && !self.files.contains_key(*n)) {
            return Err(Error::Integrity(extra.to_owned()));
        }
        let paths: Vec<String> = self.files.keys().cloned().collect();
        for (i, p) in paths.iter().enumerate() {
            self.stored(p)?;
            progress(i + 1, paths.len());
        }
        Ok(())
    }

    pub fn unlock(&mut self, passphrase: &str) -> Result<(), Error> {
        let Some(e) = self.manifest.encryption.clone() else { return Ok(()) };
        let blob = self.stored(INDEX_PATH)?;
        let key = derive_key(passphrase, &e.kdf)?;
        let json = open_blob(&key, INDEX_PATH, &blob).map_err(|_| Error::Passphrase)?;
        let index: Index = serde_json::from_slice(&json).map_err(|_| Error::Integrity(INDEX_PATH.into()))?;
        self.index = Some(index.entries.into_iter().map(|x| (x.path, x.blob)).collect());
        self.key = Some(key);
        Ok(())
    }

    /// The verified (and decrypted) bytes of an environment file.
    pub fn read(&mut self, path: &str) -> Result<Vec<u8>, Error> {
        if !self.encrypted() {
            return self.stored(path);
        }
        let blob_name = self
            .index
            .as_ref()
            .ok_or(Error::Locked)?
            .get(path)
            .cloned()
            .ok_or_else(|| Error::Integrity(path.to_owned()))?;
        let blob = self.stored(&blob_name)?;
        let key = self.key.as_ref().ok_or(Error::Locked)?;
        open_blob(key, &blob_name, &blob).map_err(|_| Error::Integrity(path.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Vector {
        passphrase: String,
        kdf: Kdf,
        key: String,
        name: String,
        plain: String,
        blob: String,
    }

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    /// Written by the TypeScript side (packages/package-format), which checks it too.
    #[test]
    fn matches_the_typescript_vector() {
        let v: Vector = serde_json::from_str(include_str!("../tests/vector.json")).unwrap();
        let key = derive_key(&v.passphrase, &v.kdf).unwrap();
        assert_eq!(key.to_vec(), hex(&v.key));
        let plain = open_blob(&key, &v.name, &hex(&v.blob)).unwrap();
        assert_eq!(String::from_utf8(plain).unwrap(), v.plain);
        assert!(open_blob(&key, "content/000002.bin", &hex(&v.blob)).is_err());
    }

    #[test]
    fn refuses_unsafe_paths() {
        for p in ["../x", "/etc/passwd", "a/../b", "a\\b", "a//b", ""] {
            assert!(!safe_path(p), "{p}");
        }
        assert!(safe_path("media/lobby/tiles/f/0/0_0.jpg"));
        assert!(safe_path("Guide de démarrage rapide.pdf"));
    }
}
