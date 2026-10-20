/**
 * SCORM export from Studio: the bundled player (./player/, see vite.config.ts), the
 * environment and every project file it uses, packed by @evactis-3dworkflow/packaging
 * like every delivery package (integrity manifest, stamp, quick start, README).
 * Files are read through the media-scoped Rust command; nothing goes over a network.
 */
import { buildDelivery, type ScormVersion } from '@evactis-3dworkflow/packaging';
import type { Environment } from '@evactis-3dworkflow/schema';
import { api } from '../api.ts';
import { quickStart, PRODUCER } from './deliveryAssets.ts';

const bytes = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`The bundled player file ${url} is missing`);
  return new Uint8Array(await r.arrayBuffer());
};

/** The module player's files, as bundled with Studio. */
export async function playerFiles(): Promise<{ path: string; data: Uint8Array }[]> {
  const list = (await (await fetch('./player/files.json')).json()) as string[];
  return Promise.all(list.map(async (path) => ({ path, data: await bytes(`./player/${path}`) })));
}

export async function buildScorm(
  env: Environment,
  version: ScormVersion,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const createdAt = new Date().toISOString();
  const parts: Uint8Array[] = [];
  await buildDelivery(
    {
      env,
      kind: 'scorm',
      producer: PRODUCER,
      name: 'package',
      createdAt,
      readAsset: (p) => api.readMedia(p),
      quickStart: await quickStart(env, 'scorm', createdAt, false),
      player: await playerFiles(),
      scorm: { version },
      onProgress,
    },
    { write: async (_path, data) => void parts.push(data) },
  );
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
