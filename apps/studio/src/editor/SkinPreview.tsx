/**
 * Skin preview: the real Viewer with the skin being designed, at the exact size of a
 * device (phone, tablet, desktop, 1080p kiosk) and scaled down to fit. Outlines over
 * each skin element select it; dragging one moves it (offsets in the device's CSS px).
 */
import type { Environment, Skin } from '@evactis-3dworkflow/schema';
import { createViewer, type Viewer } from '@evactis-3dworkflow/viewer';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const DEVICES = {
  phone: { width: 375, height: 667, kiosk: false },
  tablet: { width: 768, height: 1024, kiosk: false },
  desktop: { width: 1440, height: 900, kiosk: false },
  kiosk: { width: 1920, height: 1080, kiosk: true },
  'kiosk-portrait': { width: 1080, height: 1920, kiosk: true },
} as const;
export type Device = keyof typeof DEVICES;

type Box = { id: string; x: number; y: number; width: number; height: number };

export function SkinPreview({
  env,
  skin,
  device,
  lang,
  resolveAsset,
  selected,
  trying,
  label,
  failedText,
  elementName,
  onSelect,
  onMove,
}: {
  env: Environment;
  skin: Skin;
  device: Device;
  lang: string;
  resolveAsset: (path: string) => string;
  selected: string | null;
  /** Clicks go to the Viewer instead of selecting elements. */
  trying: boolean;
  label: string;
  failedText: string;
  elementName: (id: string) => string;
  onSelect: (id: string) => void;
  /** Moved by (dx, dy) device px; `nudge` for keyboard steps (coalesced into one undo). */
  onMove: (id: string, dx: number, dy: number, nudge: boolean) => void;
}) {
  const d = DEVICES[device];
  const outer = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [avail, setAvail] = useState({ width: 800, height: 600 });
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [bp, setBp] = useState('');
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ env, skin, device, lang });
  latest.current = { env, skin, device, lang };

  const scale = Math.min(1, avail.width / d.width, avail.height / d.height);

  useLayoutEffect(() => {
    const el = outer.current!;
    const ro = new ResizeObserver(() =>
      setAvail({
        width: el.clientWidth,
        height: Math.max(320, window.innerHeight - el.getBoundingClientRect().top - 48),
      }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One viewer for the tab; the skin and document follow edits.
  useEffect(() => {
    const el = host.current!;
    let gone = false;
    let made: Viewer | null = null;
    const { env: e, skin: s, device: dv, lang: l } = latest.current;
    void createViewer(el, e, {
      language: e.settings.languages.includes(l) ? l : undefined,
      resolveAsset,
      skin: s,
      kiosk: DEVICES[dv].kiosk,
    })
      .then((v) => {
        if (gone) return v.destroy();
        made = v;
        viewer.current = v;
        v.on('error', ({ error: x }) => setError(x.message));
        setReady(true);
      })
      .catch((x: unknown) => !gone && setError(x instanceof Error ? x.message : String(x)));
    return () => {
      gone = true;
      setReady(false);
      made?.destroy();
      viewer.current = null;
      el.replaceChildren();
    };
  }, [resolveAsset]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    void v.setEnvironment(env).then(() => {
      if (viewer.current === v) v.setSkin(skin, d.kiosk);
    });
  }, [env, skin, d.kiosk, ready]);

  useEffect(() => {
    const v = viewer.current;
    if (v && v.language !== lang && env.settings.languages.includes(lang)) v.setLanguage(lang);
  }, [lang, ready, env.settings.languages]);

  // Outlines follow the chrome (layout, text and breakpoint changes).
  useEffect(() => {
    const el = host.current!;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const o = el.getBoundingClientRect();
      const found: Box[] = [];
      for (const n of el.querySelectorAll<HTMLElement>('[data-skin-element]')) {
        const r = n.getBoundingClientRect();
        if (n.hidden || !r.width) continue;
        found.push({
          id: n.dataset.skinElement!,
          x: r.left - o.left,
          y: r.top - o.top,
          width: r.width,
          height: r.height,
        });
      }
      setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(found) ? prev : found));
      setBp(el.querySelector<HTMLElement>('.evx-skin')?.dataset.breakpoint ?? '');
    };
    const later = () => (frame ||= requestAnimationFrame(measure));
    const mo = new MutationObserver(later);
    mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
    const ro = new ResizeObserver(later);
    ro.observe(el);
    void document.fonts?.ready.then(later);
    later();
    return () => {
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scale]);

  return (
    <div ref={outer} className="evx-skin-preview" data-testid="skin-preview">
      <div
        className="evx-skin-preview__frame"
        role="group"
        aria-label={label}
        data-ready={ready && boxes.length > 0}
        data-breakpoint={bp}
        data-device={device}
        style={{ width: d.width * scale, height: d.height * scale }}
      >
        <div
          ref={host}
          className="evx-skin-preview__viewer"
          style={{ width: d.width, height: d.height, transform: `scale(${scale})` }}
        />
        {!trying && (
          <div className="evx-skin-preview__overlay">
            {boxes.map((b) => {
              const moving = drag?.id === b.id ? drag : null;
              return (
                <button
                  key={b.id}
                  type="button"
                  className="evx-skin-preview__box"
                  data-element={b.id}
                  aria-pressed={selected === b.id}
                  aria-label={elementName(b.id)}
                  style={{
                    left: b.x,
                    top: b.y,
                    width: b.width,
                    height: b.height,
                    transform: moving ? `translate(${moving.dx}px, ${moving.dy}px)` : undefined,
                  }}
                  onPointerDown={(ev) => {
                    if (ev.button !== 0) return;
                    ev.currentTarget.setPointerCapture(ev.pointerId);
                    onSelect(b.id);
                    const start = { x: ev.clientX, y: ev.clientY };
                    setDrag({ id: b.id, dx: 0, dy: 0 });
                    const target = ev.currentTarget;
                    const move = (m: PointerEvent) =>
                      setDrag({ id: b.id, dx: m.clientX - start.x, dy: m.clientY - start.y });
                    const up = (u: PointerEvent) => {
                      target.removeEventListener('pointermove', move);
                      target.removeEventListener('pointerup', up);
                      target.removeEventListener('pointercancel', up);
                      setDrag(null);
                      const dx = u.clientX - start.x;
                      const dy = u.clientY - start.y;
                      if (u.type === 'pointerup' && Math.hypot(dx, dy) > 3)
                        onMove(b.id, dx / scale, dy / scale, false);
                    };
                    target.addEventListener('pointermove', move);
                    target.addEventListener('pointerup', up);
                    target.addEventListener('pointercancel', up);
                  }}
                  onKeyDown={(ev) => {
                    const step = ev.shiftKey ? 16 : 4;
                    const delta = {
                      ArrowLeft: [-step, 0],
                      ArrowRight: [step, 0],
                      ArrowUp: [0, -step],
                      ArrowDown: [0, step],
                    }[ev.key];
                    if (!delta) return;
                    ev.preventDefault();
                    onSelect(b.id);
                    onMove(b.id, delta[0]!, delta[1]!, true);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="evx-alert evx-preview__error">
          {failedText}
          {error}
        </p>
      )}
    </div>
  );
}
