import { useId, useState, type KeyboardEvent } from 'react';
import type { PlanPoint } from '@evactis-3dworkflow/schema';

/**
 * The keyboard way to point at a floor plan (placing scenes and equipment, setting the
 * scale, drawing routes), alongside clicking: Tab to the plan, move the crosshair with
 * the arrow keys (Shift: bigger steps, Alt: finer), Enter or Space to act there, just as
 * a click would. Shown only while the plan is waiting for a point.
 */
export function PlanCursor({
  width,
  height,
  label,
  hint,
  onPoint,
}: {
  /** Plan size in pixels (the plan's own coordinates). */
  width: number;
  height: number;
  /** Accessible name, given the cursor position in per cent from the top left. */
  label: (xPercent: number, yPercent: number) => string;
  hint: string;
  onPoint: (p: PlanPoint) => void;
}) {
  const [at, setAt] = useState<PlanPoint>({ x: width / 2, y: height / 2 });
  const [focused, setFocused] = useState(false);
  const hintId = useId();
  const px = Math.round((at.x / width) * 100);
  const py = Math.round((at.y / height) * 100);

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    const step = (ev.shiftKey ? 0.05 : ev.altKey ? 0.002 : 0.01) * Math.max(width, height);
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = move[ev.key];
    if (d) {
      ev.preventDefault();
      setAt((p) => ({
        x: Math.min(width, Math.max(0, p.x + d[0])),
        y: Math.min(height, Math.max(0, p.y + d[1])),
      }));
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onPoint({ x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 });
    }
  };

  return (
    <div
      className="evx-plan__keys"
      role="application"
      tabIndex={0}
      aria-label={label(px, py)}
      aria-describedby={hintId}
      data-testid="plan-cursor"
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span id={hintId} className="sr-only">
        {hint}
      </span>
      {focused && (
        <span
          className="evx-plan__crosshair"
          style={{ left: `${(at.x / width) * 100}%`, top: `${(at.y / height) * 100}%` }}
        />
      )}
    </div>
  );
}
