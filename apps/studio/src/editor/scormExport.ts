/**
 * SCORM export from Studio: the bundled player (./player/, see vite.config.ts), the
 * environment and every project file it uses, packed by @evactis-3dworkflow/packaging.
 * Files are read through the media-scoped Rust command; nothing goes over a network.
 */
import { packageAssetPaths, scormPackage, type ScormVersion } from '@evactis-3dworkflow/packaging';
import type { Environment } from '@evactis-3dworkflow/schema';
import { api } from '../api.ts';

const bytes = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`The bundled player file ${url} is missing`);
  return new Uint8Array(await r.arrayBuffer());
};

export async function buildScorm(
  env: Environment,
  version: ScormVersion,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const list = (await (await fetch('./player/files.json')).json()) as string[];
  const player = await Promise.all(
    list.map(async (path) => ({ path, data: await bytes(`./player/${path}`) })),
  );
  const paths = packageAssetPaths(env);
  const assets = [];
  for (const [i, path] of paths.entries()) {
    onProgress(i, paths.length);
    try {
      assets.push({ path, data: await api.readMedia(path) });
    } catch {
      throw new Error(`A file the environment uses is missing from the project: ${path}`);
    }
  }
  onProgress(paths.length, paths.length);
  return scormPackage(env, { version, player, assets });
}
