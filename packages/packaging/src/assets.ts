/**
 * The package files an environment uses: panoramas (cube tiles, previews), videos,
 * plans, sounds, documents, photos, region clips, logos. Originals behind tiles or a
 * preview stay in the project (12K sources are large and the Viewer never loads them).
 */
import { FACES, tilePath } from '@evactis-3dworkflow/viewer/cube';
import type { Action, Environment, TileSet } from '@evactis-3dworkflow/schema';

/** Every tile of a tile set, all levels and faces. */
export function tilePaths(t: TileSet): string[] {
  const out: string[] = [];
  t.levels.forEach((level, li) => {
    const n = Math.ceil(level.size / t.tileSize);
    for (const face of FACES)
      for (let row = 0; row < n; row++)
        for (let col = 0; col < n; col++)
          out.push(tilePath(t.basePath, face, li, row, col, t.format));
  });
  return out;
}

function actionAssets(a: Action): string[] {
  if (a.type !== 'openPopup') return [];
  const c = a.content;
  return c.kind === 'image' || c.kind === 'video' || c.kind === 'model3d' ? [c.source] : [];
}

/** Paths (relative to the environment) of every file the delivered Viewer may load, sorted. */
export function packageAssetPaths(env: Environment): string[] {
  const p = new Set<string>();
  const add = (x: string | undefined) => x && p.add(x);
  for (const s of env.scenes) {
    const m = s.media;
    switch (m.type) {
      case 'equirect':
        if (m.tiles) tilePaths(m.tiles).forEach(add);
        add(m.preview);
        if (!m.tiles && !m.preview) add(m.source);
        add(m.luminance);
        break;
      case 'equirect-stereo':
        add(m.source);
        add(m.preview);
        break;
      case 'video360':
        add(m.source);
        add(m.poster);
        break;
      default:
        add(m.source);
    }
    add(s.thumbnail);
  }
  for (const b of env.buildings) for (const f of b.floors) add(f.plan?.image);
  for (const l of env.liveLayers) for (const o of l.overrides) add(o.media);
  for (const r of env.animatedRegions) add(r.source);
  for (const a of env.audio) add(a.source);
  for (const a of env.albums) for (const i of a.items) add(i.source);
  for (const d of env.documents) add(d.source);
  for (const t of env.equipmentTypes) add(t.icon);
  for (const e of env.equipment) e.photos.forEach(add);
  for (const h of env.hotspots) h.actions.flatMap(actionAssets).forEach(add);
  add(env.settings.branding.clientLogo);
  return [...p].sort();
}
