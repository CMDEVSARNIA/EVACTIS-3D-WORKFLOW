import type { Audio, Environment } from '@evactis-3dworkflow/schema';
import { DEG, yawDelta } from './math.ts';

/**
 * Sounds of the environment, local files only:
 * - background: plays across the scenes it lists (all scenes when none);
 * - ambient: plays in its scenes, the same from every direction;
 * - spatial: comes from a direction in the panorama (an alarm at its panel): it pans
 *   with the view and is louder when faced.
 *
 * Browsers only start sound after a user gesture; sounds that should autoplay before one
 * start on the first press. Captions (settings.accessibility.captions) name what is
 * playing and where it comes from, so the information does not depend on hearing.
 */
export interface SoundState {
  id: string;
  playing: boolean;
  /** −1 (left) … 1 (right); 0 for non-spatial sounds. */
  pan: number;
  gain: number;
}

interface Voice {
  def: Audio;
  el: HTMLAudioElement;
  pan?: StereoPannerNode;
  gain?: GainNode;
  /** Pan/gain computed even without Web Audio (tests, captions). */
  state: { pan: number; gain: number };
}

export class Sounds {
  private ctx: AudioContext | null = null;
  private voices = new Map<string, Voice>();
  private waiting = new Set<string>();
  private muted = false;
  private view = { yaw: 0, pitch: 0 };
  private sceneId: string | null = null;

  constructor(
    private env: () => Environment,
    private resolve: (path: string) => string | null,
    private onChange: () => void,
  ) {}

  /** Called on the first user gesture: the context may start, waiting sounds play. */
  unlock(): void {
    if (!this.ctx && typeof AudioContext !== 'undefined') {
      this.ctx = new AudioContext();
      for (const v of this.voices.values()) this.connect(v);
    }
    void this.ctx?.resume();
    for (const id of [...this.waiting]) void this.play(id, false);
  }

  private connect(v: Voice) {
    const ctx = this.ctx;
    if (!ctx || v.gain) return;
    const src = ctx.createMediaElementSource(v.el);
    v.gain = ctx.createGain();
    if (v.def.kind === 'spatial') {
      v.pan = ctx.createStereoPanner();
      src.connect(v.pan).connect(v.gain).connect(ctx.destination);
    } else src.connect(v.gain).connect(ctx.destination);
    this.apply(v);
  }

  private voice(id: string): Voice | null {
    const existing = this.voices.get(id);
    if (existing) return existing;
    const def = this.env().audio.find((a) => a.id === id);
    const src = def && this.resolve(def.source);
    if (!def || !src) return null;
    const el = new Audio(src);
    el.loop = def.loop;
    el.preload = 'auto';
    el.muted = this.muted;
    el.addEventListener('ended', () => this.onChange());
    const v: Voice = { def, el, state: { pan: 0, gain: def.volume } };
    this.voices.set(id, v);
    this.connect(v);
    this.apply(v);
    return v;
  }

  async play(id: string, restart = true): Promise<void> {
    const v = this.voice(id);
    if (!v) return;
    if (restart) v.el.currentTime = 0;
    try {
      await v.el.play();
      this.waiting.delete(id);
    } catch {
      // Blocked until the user interacts with the page.
      this.waiting.add(id);
    }
    this.onChange();
  }

  stop(id: string): void {
    this.waiting.delete(id);
    this.voices.get(id)?.el.pause();
    this.onChange();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const v of this.voices.values()) v.el.muted = muted;
  }

  /** Entering a scene: its autoplay sounds start, sounds of other scenes stop. */
  enterScene(sceneId: string): void {
    this.sceneId = sceneId;
    for (const v of this.voices.values())
      if (!this.belongs(v.def, sceneId) && !v.el.paused) this.stop(v.def.id);
    for (const a of this.env().audio)
      if (a.autoplay && this.belongs(a, sceneId) && this.voices.get(a.id)?.el.paused !== false)
        void this.play(a.id, false);
    this.updateAll();
  }

  private belongs(a: Audio, sceneId: string) {
    return a.kind === 'background' && a.sceneIds.length === 0 ? true : a.sceneIds.includes(sceneId);
  }

  setView(yaw: number, pitch: number): void {
    this.view = { yaw, pitch };
    this.updateAll();
  }

  private updateAll() {
    for (const v of this.voices.values()) this.apply(v);
  }

  private apply(v: Voice) {
    const d = v.def;
    if (d.kind === 'spatial' && d.position) {
      const rel = yawDelta(this.view.yaw, d.position.yaw) * DEG;
      v.state.pan = Math.round(Math.sin(rel) * 100) / 100;
      // Facing it: full volume; behind: about a third.
      v.state.gain = Math.round(d.volume * (0.65 + 0.35 * Math.cos(rel)) * 100) / 100;
    } else v.state = { pan: 0, gain: d.volume };
    const t = this.ctx?.currentTime ?? 0;
    v.pan?.pan.setTargetAtTime(v.state.pan, t, 0.05);
    v.gain?.gain.setTargetAtTime(v.state.gain, t, 0.05);
    // Without Web Audio the element's own volume carries the facing gain.
    if (!v.gain) v.el.volume = Math.min(1, v.state.gain);
  }

  /** Sounds playing (or waiting for a gesture) in the current scene. */
  get states(): SoundState[] {
    return [...this.voices.values()]
      .filter((v) => !v.el.paused || this.waiting.has(v.def.id))
      .map((v) => ({ id: v.def.id, playing: !v.el.paused, ...v.state }));
  }

  get current(): string | null {
    return this.sceneId;
  }

  dispose(): void {
    for (const v of this.voices.values()) {
      v.el.pause();
      v.el.removeAttribute('src');
    }
    this.voices.clear();
    void this.ctx?.close();
  }
}

/** Where a sound comes from, in words, relative to the view (captions). */
export function soundDirection(
  viewYaw: number,
  soundYaw: number,
): 'ahead' | 'left' | 'right' | 'behind' {
  const d = yawDelta(viewYaw, soundYaw);
  if (Math.abs(d) <= 45) return 'ahead';
  if (Math.abs(d) >= 135) return 'behind';
  return d < 0 ? 'left' : 'right';
}
