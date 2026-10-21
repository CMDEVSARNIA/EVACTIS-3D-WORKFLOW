/**
 * Floor plan for the Safety tab: routes, the line being drawn, equipment (same signs as
 * in the panorama), postings and scene positions. A click picks an item or, in a
 * placing/drawing tool, places at that point (plan pixels).
 */
import { escapeXml, signSvg } from '@evactis-3dworkflow/brand';
import {
  equipmentSymbol,
  equipmentTypeInfo,
  localize,
  type Environment,
  type PlanPoint,
} from '@evactis-3dworkflow/schema';
import type { MouseEvent } from 'react';
import { PlanCursor } from './PlanCursor';

export type Pick = { kind: 'equipment' | 'posting' | 'route'; id: string };

export function SafetyPlan({
  env,
  floorId,
  lang,
  image,
  selected,
  draft,
  highlightRoute,
  crosshair,
  onPoint,
  onPick,
  cursor,
}: {
  env: Environment;
  floorId: string;
  lang: string;
  image: string;
  selected: Pick | null;
  /** The route line being drawn. */
  draft: PlanPoint[] | null;
  highlightRoute: string | null;
  crosshair: boolean;
  onPoint: (p: PlanPoint) => void;
  onPick: (p: Pick) => void;
  /** The keyboard cursor's name and hint (see PlanCursor). */
  cursor: { label: (x: number, y: number) => string; hint: string };
}) {
  const plan = env.buildings.flatMap((b) => b.floors).find((f) => f.id === floorId)?.plan;
  if (!plan) return null;
  const W = plan.widthPx;
  const H = plan.heightPx;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const click = (ev: MouseEvent<SVGSVGElement>) => {
    const box = ev.currentTarget.getBoundingClientRect();
    onPoint({
      x: Math.round(((ev.clientX - box.left) / box.width) * W * 10) / 10,
      y: Math.round(((ev.clientY - box.top) / box.height) * H * 10) / 10,
    });
  };
  const sel = (kind: Pick['kind'], id: string) => selected?.kind === kind && selected.id === id;
  const name = (t: Record<string, string>) => localize(t, lang);
  const stroke = W / 160;

  return (
    <div
      className="evx-plan evx-safety-plan"
      data-testid="safety-plan"
      data-floor-id={floorId}
      style={{
        aspectRatio: `${W} / ${H}`,
        inlineSize: `min(100%, calc((100vh - 17rem) * ${W / H}))`,
      }}
    >
      <img src={image} alt="" draggable={false} />
      {(crosshair || draft) && (
        <PlanCursor
          width={W}
          height={H}
          label={cursor.label}
          hint={cursor.hint}
          onPoint={onPoint}
        />
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        data-mode={crosshair ? 'place' : 'none'}
        onClick={click}
        aria-hidden="true"
      >
        {env.routes.flatMap((r) =>
          r.segments
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => s.floorId === floorId)
            .map(({ s, i }) => (
              <polyline
                key={`${r.id}-${i}`}
                className={`evx-safety-plan__route evx-safety-plan__route--${r.priority}${r.id === highlightRoute ? ' evx-safety-plan__route--on' : ''}`}
                data-route-id={r.id}
                points={s.points.map((p) => `${p.x},${p.y}`).join(' ')}
                strokeWidth={r.id === highlightRoute ? stroke * 1.6 : stroke}
              />
            )),
        )}
        {draft && (
          <>
            <polyline
              className="evx-safety-plan__draft"
              points={draft.map((p) => `${p.x},${p.y}`).join(' ')}
              strokeWidth={stroke}
            />
            {draft.map((p, i) => (
              <circle
                key={i}
                className="evx-safety-plan__draft-point"
                cx={p.x}
                cy={p.y}
                r={stroke * 1.4}
              />
            ))}
          </>
        )}
        {env.scenes
          .filter((s) => s.floorId === floorId && s.planPosition)
          .map((s) => (
            <circle
              key={s.id}
              className="evx-safety-plan__scene"
              cx={s.planPosition!.x}
              cy={s.planPosition!.y}
              r={stroke * 1.2}
            >
              <title>{name(s.name)}</title>
            </circle>
          ))}
      </svg>
      {env.equipment
        .filter((e) => e.floorId === floorId && e.planPosition)
        .map((e) => {
          const info = equipmentTypeInfo(env, e.typeId);
          const label = name(e.label ?? info.name) + (e.tag ? ` ${e.tag}` : '');
          return (
            <button
              key={e.id}
              type="button"
              className="evx-safety-plan__item"
              aria-label={label}
              aria-pressed={sel('equipment', e.id)}
              data-equipment-id={e.id}
              data-confirmed={!!e.confirmed}
              title={label}
              style={{ left: pct(e.planPosition!.x, W), top: pct(e.planPosition!.y, H) }}
              onClick={() => onPick({ kind: 'equipment', id: e.id })}
              dangerouslySetInnerHTML={{
                __html: info.sign
                  ? signSvg(info.sign, 'A', { title: label })
                  : `<span class="evx-symbol evx-symbol--${info.category}">${escapeXml(equipmentSymbol(info))}</span>`,
              }}
            />
          );
        })}
      {env.postings
        .filter((p) => p.floorId === floorId)
        .map((p) => (
          <button
            key={p.id}
            type="button"
            className="evx-safety-plan__posting"
            aria-label={name(p.name)}
            aria-pressed={sel('posting', p.id)}
            data-posting-id={p.id}
            title={name(p.name)}
            style={{
              left: pct(p.planPosition.x, W),
              top: pct(p.planPosition.y, H),
              ...(p.facingDeg !== undefined && { ['--facing' as string]: `${p.facingDeg}deg` }),
            }}
            onClick={() => onPick({ kind: 'posting', id: p.id })}
          />
        ))}
    </div>
  );
}
