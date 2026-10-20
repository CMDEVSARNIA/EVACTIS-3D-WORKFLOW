/**
 * Where the packaged player reads its files, by how the package was opened:
 *  - fetch  (intranet bundle, SCORM): files beside index.html;
 *  - chunks (browser folder, file://): browsers refuse `fetch` from disk, so each file
 *           travels in a small script, `evx-data/NNNNNN.js`, that hands its bytes over;
 *  - inline (single HTML file): non-executing `application/octet-stream` blocks.
 * All three give the stored bytes; the PackageReader checks and decrypts them.
 */
import { fromBase64, MANIFEST_PATH, type ReadStored } from '@evactis-3dworkflow/package-format';

declare global {
  interface Window {
    __evxManifest?: (manifest: string, files: Record<string, string>) => void;
    __evxChunk?: (path: string, data: string) => void;
  }
}

export type Mode = 'fetch' | 'chunks' | 'inline';

/** The single-file blocks, if this page is a single HTML file. */
function inlineBlocks(): Map<string, HTMLElement> | null {
  const manifest = document.getElementById('evx-manifest');
  if (!manifest) return null;
  const blocks = new Map<string, HTMLElement>([[MANIFEST_PATH, manifest]]);
  for (const el of document.querySelectorAll<HTMLElement>(
    'script[type="application/octet-stream"][data-path]',
  ))
    blocks.set(el.dataset.path!, el);
  return blocks;
}

/**
 * Chunk mode: `evx-manifest.js` (loaded after this script) calls `__evxManifest` with the
 * manifest and the map of chunk files; each chunk script calls `__evxChunk`.
 */
function chunkReader(): Promise<ReadStored> {
  return new Promise((ready) => {
    const waiting = new Map<string, ((b64: string) => void)[]>();
    window.__evxChunk = (path, data) => {
      for (const done of waiting.get(path) ?? []) done(data);
      waiting.delete(path);
    };
    window.__evxManifest = (manifest, files) =>
      ready((path) => {
        if (path === MANIFEST_PATH) return Promise.resolve(fromBase64(manifest));
        const file = files[path];
        if (!file) return Promise.reject(new Error(`${path} is not in this package`));
        return new Promise((resolve, reject) => {
          const list = waiting.get(path) ?? [];
          list.push((b64) => resolve(fromBase64(b64)));
          waiting.set(path, list);
          if (list.length > 1) return;
          const s = document.createElement('script');
          s.src = file;
          s.onerror = () => reject(new Error(`${file} could not be read`));
          // The script has run (and called __evxChunk) once it loads; drop the element.
          s.onload = () => s.remove();
          document.head.append(s);
        });
      });
  });
}

export async function packageSource(): Promise<{ mode: Mode; read: ReadStored }> {
  const blocks = inlineBlocks();
  if (blocks)
    return {
      mode: 'inline',
      read: async (path) => {
        const el = blocks.get(path);
        if (!el) throw new Error(`${path} is not in this package`);
        return fromBase64(el.textContent!.trim());
      },
    };
  if (location.protocol === 'file:') return { mode: 'chunks', read: await chunkReader() };
  return {
    mode: 'fetch',
    read: async (path) => {
      const res = await fetch(`./${path.split('/').map(encodeURIComponent).join('/')}`);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
