import { Color, DoubleSide, ShaderMaterial, type Texture } from 'three';

/**
 * Look of every panorama surface (image, tiles, video, animated regions), shared through
 * one set of uniforms so a change applies everywhere at once:
 * - exposure in stops (live layers such as "night", and adaptive HDR);
 * - haze for smoke conditions: a panorama has no depth, so visibility becomes a single
 *   haze amount, denser towards the ceiling where hot smoke collects first.
 */
export interface Grade {
  /** Stops; 0 leaves the image as captured. */
  exposure: number;
  /** 0 (clear) to 1 (nothing visible but smoke). */
  haze: number;
  /** sRGB hex, e.g. '#6b6b66'. */
  hazeColor: string;
}

export const NEUTRAL: Grade = { exposure: 0, haze: 0, hazeColor: '#808080' };

/**
 * Haze amount for a visibility distance: what is left of a surface about 5 m away (a
 * typical wall in a captured room) under exponential falloff.
 */
export function hazeForVisibility(visibilityM: number | undefined): number {
  if (!visibilityM) return 0;
  return 1 - Math.exp(-5 / visibilityM);
}

export class Grading {
  readonly uniforms = {
    exposure: { value: 0 },
    haze: { value: 0 },
    hazeColor: { value: new Color('#808080') },
  };

  set(g: Grade, adapt = 0): void {
    this.uniforms.exposure.value = g.exposure + adapt;
    this.uniforms.haze.value = Math.min(1, Math.max(0, g.haze));
    this.uniforms.hazeColor.value.set(g.hazeColor);
  }

  material(map: Texture, opacity = 1): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: { ...this.uniforms, map: { value: map }, opacity: { value: opacity } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: opacity < 1,
    });
  }
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vUv = uv;
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
uniform float exposure;
uniform float haze;
uniform vec3 hazeColor;
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vec4 c = texture2D(map, vUv);
  vec3 col = c.rgb * exp2(exposure);
  float up = normalize(vDir).y;
  float h = clamp(haze * mix(0.6, 1.0, smoothstep(-0.5, 0.6, up)), 0.0, 1.0);
  col = mix(col, hazeColor, h);
  gl_FragColor = vec4(col, c.a * opacity);
  #include <colorspace_fragment>
}`;
