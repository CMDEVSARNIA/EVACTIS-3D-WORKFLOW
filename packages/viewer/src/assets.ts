import { AssetPathSchema } from '@evactis-3dworkflow/schema';

/**
 * All environment assets are loaded from paths relative to the environment's base URL.
 * The base itself must be relative, a same-origin URL, or a local scheme — never a
 * remote server — so the Viewer cannot be pointed at the network by a document or an
 * integrator by accident.
 */
export class AssetError extends Error {
  override name = 'AssetError';
}

const LOCAL_SCHEMES = new Set(['file:', 'blob:', 'tauri:', 'asset:', 'evx:']);
const LOCAL_HOSTS = /^(tauri|asset)\.localhost$/;

function isLocal(url: URL, page: URL): boolean {
  return (
    LOCAL_SCHEMES.has(url.protocol) ||
    LOCAL_HOSTS.test(url.hostname) ||
    (url.origin === page.origin && page.origin !== 'null')
  );
}

export function resolveBase(baseUrl: string, origin: string = location.href): URL {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, origin);
  if (!isLocal(base, new URL(origin)))
    throw new AssetError(`Refusing non-local asset base: ${base.href}`);
  return base;
}

/** Resolves an environment asset path against the base. Throws for anything non-relative. */
export function resolveAsset(base: URL, path: string): string {
  const ok = AssetPathSchema.safeParse(path);
  if (!ok.success) throw new AssetError(`Invalid asset path "${path}"`);
  return new URL(path, base).href;
}

/** Maps an environment asset path to a URL the Viewer can load. */
export type AssetResolver = (path: string) => string;

/**
 * Gives a URL the Viewer can load for an asset path once the asset may be used: a
 * package source checks its integrity (and decrypts it) first, then hands out a blob URL.
 */
export type AssetUrl = (path: string) => Promise<string>;

/**
 * Wraps a package's asset source like `checkedResolver`: valid relative paths in, local
 * URLs (in practice blob: URLs) out.
 */
export function checkedSource(
  source: { url(path: string): Promise<string> },
  origin: string = location.href,
): AssetUrl {
  const page = new URL(origin);
  return async (path) => {
    if (!AssetPathSchema.safeParse(path).success)
      throw new AssetError(`Invalid asset path "${path}"`);
    const url = new URL(await source.url(path), origin);
    if (!isLocal(url, page)) throw new AssetError(`Refusing non-local asset URL: ${url.href}`);
    return url.href;
  };
}

/** The Viewer's own lookup: a loadable URL, or null when the path is refused. */
export type Resolve = (path: string) => Promise<string | null>;

export function baseResolver(base: URL): AssetResolver {
  return (path) => resolveAsset(base, path);
}

/**
 * Wraps an integrator's resolver (e.g. Studio, whose project files are served through
 * the desktop asset protocol): the path must be a valid relative asset path and the
 * returned URL must still be local, so a resolver cannot point the Viewer at a server.
 */
export function checkedResolver(fn: AssetResolver, origin: string = location.href): AssetResolver {
  const page = new URL(origin);
  return (path) => {
    if (!AssetPathSchema.safeParse(path).success)
      throw new AssetError(`Invalid asset path "${path}"`);
    const url = new URL(fn(path), origin);
    if (!isLocal(url, page)) throw new AssetError(`Refusing non-local asset URL: ${url.href}`);
    return url.href;
  };
}

/** Loads and decodes an image; rejects on error or abort. */
export function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const img = new Image();
    img.decoding = 'async';
    const abort = () => {
      img.src = '';
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    img.onload = () => {
      signal?.removeEventListener('abort', abort);
      img.decode().then(
        () => resolve(img),
        () => resolve(img),
      );
    };
    img.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(new AssetError(`Could not load ${url}`));
    };
    img.src = url;
  });
}
