/**
 * The integrity manifest every delivery package carries at `evx-manifest.json`: what the
 * package is (kind, version/date stamp, environment), whether it is encrypted, and the
 * SHA-256 of every other file in it. Readers refuse a file whose bytes do not match, and
 * any file the manifest does not list.
 */
import type { KdfParams } from './crypto.ts';

export const MANIFEST_PATH = 'evx-manifest.json';
export const FORMAT = 'evactis-3dworkflow-package';
export const FORMAT_VERSION = 1;
/** Encrypted packages keep their content as numbered blobs plus an encrypted index. */
export const INDEX_PATH = 'content/index.bin';
/** The bilingual quick-start guide, readable (not encrypted) in every package. */
export const QUICK_START_NAME = 'Quick start - Démarrage rapide.pdf';

export type PackageKind =
  | 'installer'
  | 'evx'
  | 'portable'
  | 'intranet'
  | 'browser-folder'
  | 'single-file'
  | 'scorm';

export const PACKAGE_KINDS: readonly PackageKind[] = [
  'installer',
  'evx',
  'portable',
  'intranet',
  'browser-folder',
  'single-file',
  'scorm',
];

export interface ManifestFile {
  path: string;
  size: number;
  /** Lower-case hex SHA-256 of the bytes stored at `path`. */
  sha256: string;
}

export interface PackageManifest {
  format: typeof FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  kind: PackageKind;
  /** The version/date stamp: when and by what the package was made. */
  createdAt: string;
  producer: string;
  environment: { id: string; title: Record<string, string>; updatedAt: string };
  /** Every package runs fully offline; stated here and shown to the reader. */
  offline: true;
  /** Delivered for a kiosk (the skin's kiosk layout). */
  kiosk?: boolean;
  encryption: null | { cipher: 'AES-256-GCM'; kdf: KdfParams; index: typeof INDEX_PATH };
  files: ManifestFile[];
}

/** Inside an encrypted package: where each environment file's blob is. */
export interface EncryptedIndex {
  entries: { path: string; blob: string; size: number }[];
}

export class ManifestError extends Error {
  override name = 'ManifestError';
}

/** Relative, `/`-separated, no `.`/`..` parts; letters (any script), digits, plain marks. */
const SAFE_PATH =
  /^(?!.*(?:^|\/)\.\.?(?:\/|$))[\p{L}\p{N}_ .()&'+,@~-]+(?:\/[\p{L}\p{N}_ .()&'+,@~-]+)*$/u;

/** Validates a manifest read from a package (it is untrusted input). */
export function parseManifest(text: string): PackageManifest {
  let m: PackageManifest;
  try {
    m = JSON.parse(text) as PackageManifest;
  } catch {
    throw new ManifestError('The package manifest is not valid JSON');
  }
  if (m?.format !== FORMAT) throw new ManifestError('Not an EVACTIS 3DWORKFLOW package');
  if (m.formatVersion !== FORMAT_VERSION)
    throw new ManifestError(`Package format ${String(m.formatVersion)} is not supported`);
  if (!PACKAGE_KINDS.includes(m.kind)) throw new ManifestError('Unknown package kind');
  if (!Array.isArray(m.files)) throw new ManifestError('The manifest lists no files');
  const seen = new Set<string>();
  for (const f of m.files) {
    if (
      typeof f?.path !== 'string' ||
      !SAFE_PATH.test(f.path) ||
      f.path === MANIFEST_PATH ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      !/^[0-9a-f]{64}$/.test(f.sha256) ||
      seen.has(f.path)
    )
      throw new ManifestError(`Invalid manifest entry ${JSON.stringify(f?.path)}`);
    seen.add(f.path);
  }
  const e = m.encryption;
  if (e !== null) {
    if (
      e?.cipher !== 'AES-256-GCM' ||
      e.index !== INDEX_PATH ||
      e.kdf?.name !== 'Argon2id' ||
      typeof e.kdf.salt !== 'string' ||
      ![e.kdf.memoryKiB, e.kdf.iterations, e.kdf.parallelism].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      ) ||
      // Refuse absurd costs a hostile file could use to freeze the reader.
      e.kdf.memoryKiB > 1024 * 1024 ||
      e.kdf.iterations > 16 ||
      e.kdf.parallelism > 8
    )
      throw new ManifestError('Unsupported encryption settings');
    if (!seen.has(INDEX_PATH)) throw new ManifestError('The encrypted index is missing');
  }
  return m;
}

/** The content type a browser needs for a package file (blob URLs carry it). */
export function contentType(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webm: 'video/webm',
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      ogv: 'video/ogg',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      wav: 'audio/wav',
      pdf: 'application/pdf',
      json: 'application/json',
      glb: 'model/gltf-binary',
      txt: 'text/plain',
      html: 'text/html',
    }[ext] ?? 'application/octet-stream'
  );
}
