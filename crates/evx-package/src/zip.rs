//! The minimal ZIP reader a `.evx` needs: stored (uncompressed) entries as written by the
//! packager, read in place from the file. Anything else — compression, encryption,
//! ZIP64, odd names — is refused rather than guessed at.

use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use crate::Error;

#[derive(Debug, Clone, Copy)]
pub struct Entry {
    /// Offset of the entry's data in the file.
    pub offset: u64,
    pub size: u64,
}

pub struct Zip {
    file: File,
    entries: HashMap<String, Entry>,
}

fn u16_at(b: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([b[i], b[i + 1]])
}
fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

impl Zip {
    pub fn open(path: &Path) -> Result<Self, Error> {
        let mut file = File::open(path).map_err(|e| Error::Io(e.to_string()))?;
        let len = file.metadata().map_err(|e| Error::Io(e.to_string()))?.len();
        // End of central directory: 22 bytes, plus up to 64 KiB of comment.
        let tail = len.min(22 + 65_535);
        file.seek(SeekFrom::Start(len - tail)).map_err(|e| Error::Io(e.to_string()))?;
        let mut buf = vec![0; tail as usize];
        file.read_exact(&mut buf).map_err(|e| Error::Io(e.to_string()))?;
        let eocd = (0..=buf.len().saturating_sub(22))
            .rev()
            .find(|&i| u32_at(&buf, i) == 0x0605_4b50)
            .ok_or(Error::NotAPackage)?;
        let count = u16_at(&buf, eocd + 10) as usize;
        let cd_size = u32_at(&buf, eocd + 12) as u64;
        let cd_offset = u32_at(&buf, eocd + 16) as u64;
        if cd_offset + cd_size > len {
            return Err(Error::NotAPackage);
        }
        let mut cd = vec![0; cd_size as usize];
        file.seek(SeekFrom::Start(cd_offset)).map_err(|e| Error::Io(e.to_string()))?;
        file.read_exact(&mut cd).map_err(|e| Error::Io(e.to_string()))?;

        let mut entries = HashMap::with_capacity(count);
        let mut i = 0;
        for _ in 0..count {
            if i + 46 > cd.len() || u32_at(&cd, i) != 0x0201_4b50 {
                return Err(Error::NotAPackage);
            }
            let flags = u16_at(&cd, i + 8);
            let method = u16_at(&cd, i + 10);
            let csize = u32_at(&cd, i + 20) as u64;
            let usize_ = u32_at(&cd, i + 24) as u64;
            let name_len = u16_at(&cd, i + 28) as usize;
            let extra_len = u16_at(&cd, i + 30) as usize;
            let comment_len = u16_at(&cd, i + 32) as usize;
            let local = u32_at(&cd, i + 42) as u64;
            if i + 46 + name_len > cd.len() {
                return Err(Error::NotAPackage);
            }
            let name = std::str::from_utf8(&cd[i + 46..i + 46 + name_len])
                .map_err(|_| Error::NotAPackage)?
                .to_owned();
            if method != 0 || flags & 1 != 0 || csize != usize_ {
                return Err(Error::Unsupported(format!("{name} is compressed or encrypted")));
            }
            // Local header: fixed 30 bytes, then its own name and extra fields.
            let mut lh = [0u8; 30];
            file.seek(SeekFrom::Start(local)).map_err(|e| Error::Io(e.to_string()))?;
            file.read_exact(&mut lh).map_err(|e| Error::Io(e.to_string()))?;
            if u32_at(&lh, 0) != 0x0403_4b50 {
                return Err(Error::NotAPackage);
            }
            let offset = local + 30 + u16_at(&lh, 26) as u64 + u16_at(&lh, 28) as u64;
            if offset + csize > len {
                return Err(Error::NotAPackage);
            }
            if !name.ends_with('/') && entries.insert(name.clone(), Entry { offset, size: csize }).is_some() {
                return Err(Error::Unsupported(format!("{name} appears twice")));
            }
            i += 46 + name_len + extra_len + comment_len;
        }
        Ok(Self { file, entries })
    }

    pub fn entry(&self, name: &str) -> Option<Entry> {
        self.entries.get(name).copied()
    }

    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    pub fn read(&mut self, name: &str) -> Result<Vec<u8>, Error> {
        let e = self.entry(name).ok_or_else(|| Error::Integrity(name.to_owned()))?;
        let mut buf = vec![0; e.size as usize];
        self.file.seek(SeekFrom::Start(e.offset)).map_err(|err| Error::Io(err.to_string()))?;
        self.file.read_exact(&mut buf).map_err(|err| Error::Io(err.to_string()))?;
        Ok(buf)
    }
}
