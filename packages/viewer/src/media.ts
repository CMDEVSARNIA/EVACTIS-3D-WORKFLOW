import { localize, type Environment } from '@evactis-3dworkflow/schema';
import type { UiStrings } from './i18n.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Controls for a 360° video scene: play/pause, position, time and sound. The video
 * starts paused and muted (browsers block sound before a gesture); pressing play is that
 * gesture, so it also turns the sound on.
 */
export class VideoBar {
  readonly element = el('div', 'evx-viewer__video');
  private video: HTMLVideoElement | null = null;
  private playBtn = el('button', 'evx-viewer__video-button');
  private muteBtn = el('button', 'evx-viewer__video-button');
  private range = el('input', 'evx-viewer__video-range');
  private time = el('span', 'evx-viewer__video-time');
  private cleanup: (() => void) | null = null;

  constructor(
    host: HTMLElement,
    private t: () => UiStrings,
    private onTime: () => void,
  ) {
    this.element.setAttribute('role', 'group');
    this.element.hidden = true;
    this.playBtn.type = 'button';
    this.muteBtn.type = 'button';
    this.range.type = 'range';
    this.range.min = '0';
    this.range.step = '0.1';
    this.playBtn.addEventListener('click', () => {
      const v = this.video;
      if (!v) return;
      if (v.paused) {
        v.muted = false;
        void v.play().catch(() => undefined);
      } else v.pause();
    });
    this.muteBtn.addEventListener('click', () => {
      if (this.video) this.video.muted = !this.video.muted;
      this.render();
    });
    this.range.addEventListener('input', () => {
      if (this.video) this.video.currentTime = Number(this.range.value);
    });
    this.element.append(this.playBtn, this.range, this.time, this.muteBtn);
    host.append(this.element);
  }

  attach(video: HTMLVideoElement | null): void {
    this.cleanup?.();
    this.cleanup = null;
    this.video = video;
    this.element.hidden = !video;
    if (!video) return;
    const update = () => {
      this.render();
      this.onTime();
    };
    const events = [
      'play',
      'pause',
      'timeupdate',
      'seeked',
      'loadedmetadata',
      'volumechange',
      'ended',
    ];
    for (const e of events) video.addEventListener(e, update);
    this.cleanup = () => events.forEach((e) => video.removeEventListener(e, update));
    this.render();
  }

  render(): void {
    const v = this.video;
    const t = this.t();
    if (!v) return;
    this.element.setAttribute('aria-label', t.videoControls);
    this.playBtn.textContent = v.paused ? '▶' : '❚❚';
    this.playBtn.setAttribute('aria-label', v.paused ? t.play : t.pause);
    this.muteBtn.textContent = v.muted ? '🔇' : '🔊';
    this.muteBtn.setAttribute('aria-label', v.muted ? t.unmute : t.mute);
    this.range.max = String(Number.isFinite(v.duration) ? v.duration : 0);
    this.range.value = String(v.currentTime);
    this.range.setAttribute('aria-label', t.videoPosition);
    this.range.setAttribute('aria-valuetext', clock(v.currentTime));
    this.time.textContent = `${clock(v.currentTime)} / ${clock(v.duration)}`;
  }
}

/** An album as a gallery: one photo at a time, caption, counter, previous/next (arrows). */
export function albumView(
  env: Environment,
  albumId: string,
  start: number,
  lang: string,
  t: UiStrings,
  resolve: (path: string) => string | null,
): HTMLElement | null {
  const album = env.albums.find((a) => a.id === albumId);
  if (!album) return null;
  const root = el('figure', 'evx-viewer__album');
  root.dataset.albumId = album.id;
  const img = el('img', 'evx-viewer__album-photo');
  const caption = el('figcaption', 'evx-viewer__album-caption');
  const counter = el('p', 'evx-viewer__album-counter');
  counter.setAttribute('aria-live', 'polite');
  const prev = el('button', 'evx-viewer__album-nav');
  const next = el('button', 'evx-viewer__album-nav');
  prev.type = next.type = 'button';
  prev.textContent = `‹ ${t.previous}`;
  next.textContent = `${t.next} ›`;
  let i = Math.min(start, album.items.length - 1);
  const show = () => {
    const item = album.items[i]!;
    img.src = resolve(item.source) ?? '';
    const text = item.caption ? localize(item.caption, lang) : '';
    img.alt = text || localize(album.name, lang);
    caption.textContent = text;
    counter.textContent = t.photo(i + 1, album.items.length);
    root.dataset.index = String(i);
    prev.disabled = i === 0;
    next.disabled = i === album.items.length - 1;
  };
  prev.addEventListener('click', () => {
    if (i > 0) i--;
    show();
  });
  next.addEventListener('click', () => {
    if (i < album.items.length - 1) i++;
    show();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prev.click();
    else if (e.key === 'ArrowRight') next.click();
    else return;
    e.preventDefault();
  });
  root.tabIndex = -1;
  const nav = el('div', 'evx-viewer__album-bar');
  nav.append(prev, counter, next);
  root.append(img, caption, nav);
  show();
  return root;
}
