/**
 * Package cryptography: SHA-256 for the integrity manifest, Argon2id to turn a passphrase
 * into a key, AES-256-GCM per file. WebCrypto is used where the page has it (desktop
 * apps, file://, https, localhost); elsewhere — e.g. an intranet served over plain http —
 * the audited pure-JavaScript implementations from @noble take over. Same bytes either
 * way; nothing here touches the network or needs WebAssembly.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;

/** Argon2id costs used for new packages (stored in each manifest, so they can change). */
export const DEFAULT_KDF = { memoryKiB: 65536, iterations: 2, parallelism: 1 } as const;

export interface KdfParams {
  name: 'Argon2id';
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  /** Base64. */
  salt: string;
}

/** WebCrypto's SubtleCrypto when this page may use it. */
function subtle(): SubtleCrypto | null {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.subtle && (globalThis.isSecureContext ?? true) ? c.subtle : null;
}

/** An owned, plain ArrayBuffer view (WebCrypto refuses shared or offset buffers in places). */
const own = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const s = subtle();
  if (s) return new Uint8Array(await s.digest('SHA-256', own(data)));
  return nobleSha256(data);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await sha256(data));
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** New KDF parameters with a fresh random salt. */
export function newKdf(): KdfParams {
  return { name: 'Argon2id', ...DEFAULT_KDF, salt: toBase64(randomBytes(16)) };
}

/** The 256-bit key for a passphrase (Unicode-normalised, so it types the same anywhere). */
export async function deriveKey(
  passphrase: string,
  kdf: KdfParams,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  if (kdf.name !== 'Argon2id') throw new Error(`Unknown key derivation "${kdf.name}"`);
  return argon2idAsync(
    new TextEncoder().encode(passphrase.normalize('NFC')),
    fromBase64(kdf.salt),
    {
      t: kdf.iterations,
      m: kdf.memoryKiB,
      p: kdf.parallelism,
      dkLen: KEY_BYTES,
      asyncTick: 20,
      maxmem: kdf.memoryKiB * 1024 + 1024 * 1024,
      onProgress,
    },
  );
}

/**
 * Encrypts one file: nonce ‖ ciphertext ‖ tag. The file's name inside the package is the
 * associated data, so blobs cannot be swapped between names without failing.
 */
export async function seal(key: Uint8Array, name: string, plain: Uint8Array): Promise<Uint8Array> {
  const nonce = randomBytes(NONCE_BYTES);
  const aad = new TextEncoder().encode(name);
  const s = subtle();
  const body = s
    ? new Uint8Array(
        await s.encrypt(
          { name: 'AES-GCM', iv: own(nonce), additionalData: own(aad) },
          await s.importKey('raw', own(key), 'AES-GCM', false, ['encrypt']),
          own(plain),
        ),
      )
    : gcm(key, nonce, aad).encrypt(plain);
  const out = new Uint8Array(NONCE_BYTES + body.length);
  out.set(nonce);
  out.set(body, NONCE_BYTES);
  return out;
}

/** Thrown when a blob does not decrypt: wrong passphrase, or the file was altered. */
export class DecryptError extends Error {
  override name = 'DecryptError';
}

export async function open(key: Uint8Array, name: string, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < NONCE_BYTES + TAG_BYTES) throw new DecryptError(`${name} is too short`);
  const nonce = blob.subarray(0, NONCE_BYTES);
  const body = blob.subarray(NONCE_BYTES);
  const aad = new TextEncoder().encode(name);
  const s = subtle();
  try {
    if (s)
      return new Uint8Array(
        await s.decrypt(
          { name: 'AES-GCM', iv: own(nonce), additionalData: own(aad) },
          await s.importKey('raw', own(key), 'AES-GCM', false, ['decrypt']),
          own(body),
        ),
      );
    return gcm(key, nonce, aad).decrypt(body);
  } catch {
    throw new DecryptError(`${name} could not be decrypted`);
  }
}
