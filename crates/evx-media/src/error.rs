use std::fmt;

#[derive(Debug)]
pub enum MediaError {
    Io(std::io::Error),
    /// The file is not something Studio can import (wrong type, size or shape).
    Invalid(String),
    Decode(String),
    Ffmpeg(String),
    Cancelled,
    /// The same file is already in the project library.
    Duplicate(String),
}

impl fmt::Display for MediaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "file error: {e}"),
            Self::Invalid(m) => write!(f, "{m}"),
            Self::Decode(m) => write!(f, "could not decode: {m}"),
            Self::Ffmpeg(m) => write!(f, "video processing failed: {m}"),
            Self::Cancelled => write!(f, "cancelled"),
            Self::Duplicate(id) => write!(f, "already in the library (asset {id})"),
        }
    }
}

impl std::error::Error for MediaError {}

impl From<std::io::Error> for MediaError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<image::ImageError> for MediaError {
    fn from(e: image::ImageError) -> Self {
        Self::Decode(e.to_string())
    }
}

/// Stable machine-readable code for the UI (localised messages live in Studio).
impl MediaError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "io",
            Self::Invalid(_) => "invalid",
            Self::Decode(_) => "decode",
            Self::Ffmpeg(_) => "ffmpeg",
            Self::Cancelled => "cancelled",
            Self::Duplicate(_) => "duplicate",
        }
    }
}

pub type Result<T> = std::result::Result<T, MediaError>;
