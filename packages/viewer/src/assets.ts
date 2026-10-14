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

export function resolveBase(baseUrl: string, origin: string = location.href): URL {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, origin);
  const page = new URL(origin);
  const local =
    LOCAL_SCHEMES.has(base.protocol) ||
    LOCAL_HOSTS.test(base.hostname) ||
    (base.origin === page.origin && page.origin !== 'null');
  if (!local) throw new AssetError(`Refusing non-local asset base: ${base.href}`);
  return base;
}

/** Resolves an environment asset path against the base. Throws for anything non-relative. */
export function resolveAsset(base: URL, path: string): string {
  const ok = AssetPathSchema.safeParse(path);
  if (!ok.success) throw new AssetError(`Invalid asset path "${path}"`);
  return new URL(path, base).href;
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
