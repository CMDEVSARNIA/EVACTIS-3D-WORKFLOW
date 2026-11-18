/**
 * Drag handles between an editor's columns: the list on the left and the inspector on the
 * right can be made wider or narrower (mouse, touch, or the arrow keys once focused;
 * double-click or Home restores the default). The widths are CSS variables on the page
 * root (--evx-left, --evx-right, read by .evx-editor), so every tab shares them, and they
 * are remembered on this computer.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Strings } from '../i18n.ts';

type Side = 'left' | 'right';
const LIMITS: Record<Side, [number, number]> = { left: [176, 480], right: [224, 560] };
const STEP = 16;
const KEY = 'evx-studio-panels';

const clamp = (side: Side, px: number) =>
  Math.round(Math.min(LIMITS[side][1], Math.max(LIMITS[side][0], px)));

function stored(): Partial<Record<Side, number>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<Side, number>>;
  } catch {
    return {};
  }
}

function apply(side: Side, px: number | null) {
  const name = `--evx-${side}`;
  if (px === null) document.documentElement.style.removeProperty(name);
  else document.documentElement.style.setProperty(name, `${px}px`);
}

function remember(side: Side, px: number | null) {
  try {
    const all = stored();
    if (px === null) delete all[side];
    else all[side] = px;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage may be unavailable; the width still applies for this session.
  }
}

// Widths chosen earlier on this computer apply from the start.
for (const side of ['left', 'right'] as const) {
  const px = stored()[side];
  if (typeof px === 'number') apply(side, clamp(side, px));
}

/** The column a handle sizes: the editor's first or last column. */
function column(handle: HTMLElement, side: Side): HTMLElement | null {
  const cols = [...(handle.parentElement?.children ?? [])].filter(
    (c) => !c.classList.contains('evx-panel-handle'),
  );
  return (side === 'left' ? cols[0] : cols[cols.length - 1]) as HTMLElement | null;
}

function Handle({ side, label }: { side: Side; label: string }) {
  const [width, setWidth] = useState<number | null>(() => stored()[side] ?? null);
  const [drag, setDrag] = useState<{ x: number; w: number } | null>(null);
  // The column's width as laid out, for screen readers (aria-valuenow) before any drag.
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number>(LIMITS[side][0]);
  useLayoutEffect(() => {
    const col = ref.current && column(ref.current, side);
    if (!col) return;
    const measure = () => setShown(clamp(side, col.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(col);
    return () => watch.disconnect();
  }, [side]);
  const dir = side === 'left' ? 1 : -1;
  const set = (px: number, save: boolean) => {
    const w = clamp(side, px);
    apply(side, w);
    setWidth(w);
    if (save) remember(side, w);
  };
  const reset = () => {
    apply(side, null);
    setWidth(null);
    remember(side, null);
  };
  const now = (el: HTMLElement) =>
    width ?? Math.round(column(el, side)?.getBoundingClientRect().width ?? LIMITS[side][0]);

  return (
    <div
      ref={ref}
      className={`evx-panel-handle evx-panel-handle--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={LIMITS[side][0]}
      aria-valuemax={LIMITS[side][1]}
      aria-valuenow={width ?? shown}
      tabIndex={0}
      data-dragging={drag ? '' : undefined}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ x: e.clientX, w: now(e.currentTarget) });
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        if (drag) set(drag.w + dir * (e.clientX - drag.x), false);
      }}
      onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
        if (!drag) return;
        setDrag(null);
        set(drag.w + dir * (e.clientX - drag.x), true);
      }}
      onDoubleClick={reset}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Home') reset();
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const grow = (e.key === 'ArrowRight') === (side === 'left');
          set(now(e.currentTarget) + (grow ? STEP : -STEP), true);
        } else return;
        e.preventDefault();
      }}
    />
  );
}

export function PanelHandles({ t }: { t: Strings }) {
  return (
    <>
      <Handle side="left" label={t.editor.resizeLeft} />
      <Handle side="right" label={t.editor.resizeRight} />
    </>
  );
}
