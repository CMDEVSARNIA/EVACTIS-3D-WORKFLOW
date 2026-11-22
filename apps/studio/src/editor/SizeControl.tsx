/**
 * A size slider for hotspots: 50 % to 200 % in steps of 10 (the schema's range; 50 %
 * keeps every hotspot at least 24 px across). Dragging is one undo step (keyed edits).
 */
import { useId } from 'react';

export function SizeControl({
  label,
  value,
  onChange,
  hint,
  testId,
}: {
  label: string;
  /** 1 = 100 %. */
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  testId?: string;
}) {
  const id = useId();
  const pct = Math.round(value * 100);
  return (
    <div className="evx-form-row">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2">
        <span>{label}</span>
        <span className="evx-size__value" aria-hidden="true">
          {pct} %
        </span>
      </label>
      <input
        id={id}
        type="range"
        className="evx-size"
        min={50}
        max={200}
        step={10}
        value={pct}
        aria-valuetext={`${pct} %`}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      {hint && <p className="evx-hint">{hint}</p>}
    </div>
  );
}
