import type { Environment, LiveLayer, SceneMedia } from '@evactis-3dworkflow/schema';
import { hazeForVisibility, NEUTRAL, type Grade } from './panorama/grading.ts';

/** Smoke grey when a layer gives visibility but no colour. */
const SMOKE = '#7a7a74';

/**
 * Live layers: switchable conditions over the whole environment (normal / smoke, day /
 * night, before / after). Each layer has a current state; a scene's look is the sum of
 * the overrides its layers' current states define for it.
 */
export class LiveLayers {
  private states = new Map<string, string>();

  constructor(private env: () => Environment) {}

  /** Layers with their current state (defaults until switched). */
  get current(): { layer: LiveLayer; stateId: string }[] {
    return this.env().liveLayers.map((layer) => ({
      layer,
      stateId: this.states.get(layer.id) ?? layer.defaultStateId,
    }));
  }

  set(layerId: string, stateId: string): void {
    const layer = this.env().liveLayers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Unknown live layer "${layerId}"`);
    if (!layer.states.some((s) => s.id === stateId))
      throw new Error(`Unknown state "${stateId}" in live layer "${layerId}"`);
    this.states.set(layerId, stateId);
  }

  private overrides(sceneId: string) {
    return this.current.flatMap(({ layer, stateId }) =>
      layer.overrides.filter((o) => o.sceneId === sceneId && o.stateId === stateId),
    );
  }

  /** Exposure and haze for a scene under the current states. */
  grade(sceneId: string): Grade {
    let exposure = 0;
    let haze = 0;
    let hazeColor = NEUTRAL.hazeColor;
    for (const o of this.overrides(sceneId)) {
      if (!o.lighting) continue;
      exposure += o.lighting.exposure;
      const h = hazeForVisibility(o.lighting.visibilityM);
      if (h > haze) {
        haze = h;
        hazeColor = o.lighting.fogColor ?? SMOKE;
      }
    }
    return { exposure, haze, hazeColor };
  }

  /** The scene's media, or the replacement panorama a current state captured for it. */
  media(sceneId: string, media: SceneMedia): SceneMedia {
    const replacement = this.overrides(sceneId).find((o) => o.media)?.media;
    return replacement ? { type: 'equirect', source: replacement, hdr: false } : media;
  }
}
