/**
 * Printable evacuation plan (PDF), one floor per sheet, English and French together:
 * the floor plan with routes and direction arrows, equipment signs, the assembly
 * point, room names, north and scale, a legend, "You are here" for a posting location,
 * and the "verify on site" note with the print date.
 *
 * Only confirmed items appear (CLAUDE.md: safety content is placed or confirmed by a
 * person); the report lists what was left out so Studio can say so.
 */
import {
  equipmentSymbol,
  equipmentTypeInfo,
  forAudience,
  localize,
  type Environment,
  type EquipmentCategory,
  type Floor,
  type PlanPoint,
  type Route,
  type SafetySignName,
} from '@evactis-3dworkflow/schema';
import type { PDFImage, RGB } from 'pdf-lib';
import { C, Canvas, PAPER, type Page, type Paper, type PrintFonts } from './canvas.ts';
import { PRINT } from './strings.ts';

export interface PlanAssets {
  fonts: PrintFonts;
  /** PNG of each safety sign (packages/brand/generated/print). */
  signs: Partial<Record<SafetySignName, Uint8Array>>;
  /** Product lockup PNG. */
  logo?: Uint8Array;
  /** Plan image bytes (PNG or JPEG) for a floor. */
  planImage: (floorId: string) => Uint8Array | undefined;
}

export interface PlanOptions {
  floorId: string;
  /** A posting location: prints its "You are here" variant. */
  postingId?: string;
  paper: Paper;
  /** Printed date, YYYY-MM-DD. */
  printedOn: string;
  /** Whose plan: default the environment's default audience. */
  audience?: string | null;
}

export interface PrintReport {
  minFontPt: number;
  page: { w: number; h: number };
  equipment: number;
  routes: number;
  /** Items left out because nobody confirmed them. */
  unconfirmed: string[];
}

export class PrintError extends Error {}

const CATEGORY_ORDER: EquipmentCategory[] = [
  'safe-condition',
  'fire',
  'warning',
  'utility',
  'access',
  'custom',
];
const both = (t: Record<string, string>) => ({ en: localize(t, 'en'), fr: localize(t, 'fr') });

function floorOf(
  env: Environment,
  id: string,
): { floor: Floor; building: { en: string; fr: string } } {
  for (const b of env.buildings) {
    const f = b.floors.find((x) => x.id === id);
    if (f) return { floor: f, building: both(b.name) };
  }
  throw new PrintError(`unknown floor ${id}`);
}

/** Nice scale-bar length (m) close to `target`. */
function niceMetres(target: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  return steps.reduce((best, s) => (s <= target ? s : best), steps[0]!);
}

export async function evacuationPlanPdf(
  env: Environment,
  assets: PlanAssets,
  o: PlanOptions,
): Promise<{ bytes: Uint8Array; report: PrintReport }> {
  const { floor, building } = floorOf(env, o.floorId);
  const plan = floor.plan;
  if (!plan) throw new PrintError(`floor ${floor.id} has no plan`);
  const planBytes = assets.planImage(floor.id);
  if (!planBytes) throw new PrintError(`plan image for ${floor.id} is missing`);
  const posting = o.postingId ? env.postings.find((p) => p.id === o.postingId) : undefined;
  if (o.postingId && (!posting || posting.floorId !== floor.id))
    throw new PrintError(`posting ${o.postingId} is not on floor ${floor.id}`);
  const audience = o.audience === undefined ? (env.settings.defaultAudienceId ?? null) : o.audience;

  const unconfirmed: string[] = [];
  const equipment = env.equipment.filter((e) => {
    if (e.floorId !== floor.id || !e.planPosition || !forAudience(e.audienceIds, audience))
      return false;
    if (!e.confirmed) unconfirmed.push(e.id);
    return !!e.confirmed;
  });
  const routes = env.routes
    .filter(
      (r) => forAudience(r.audienceIds, audience) && r.segments.some((s) => s.floorId === floor.id),
    )
    .filter((r) => {
      if (!r.confirmed) unconfirmed.push(r.id);
      return !!r.confirmed;
    })
    // Secondary first, so the primary route is drawn on top.
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'secondary' ? -1 : 1));

  const facilityName = both(env.facility.name);
  const floorName = both(floor.name);
  const c = await Canvas.create(assets.fonts, {
    title: `${PRINT.title.en} — ${facilityName.en} — ${floorName.en}`,
    subject: `${PRINT.title.fr} — ${facilityName.fr} — ${floorName.fr}`,
  });
  const portrait = plan.widthPx <= plan.heightPx;
  const paper = PAPER[o.paper];
  const page = portrait ? c.page(paper.w, paper.h) : c.page(paper.h, paper.w);
  // Everything is laid out for letter and scaled up for tabloid.
  const k = Math.min(page.w, page.h) / PAPER.letter.w;
  const M = 30 * k;
  const cw = page.w - 2 * M;

  // ---------------------------------------------------------------- header
  page.rect(0, 0, page.w, 6 * k, { fill: C.green });
  let y = M - 4 * k;
  const logoH = 26 * k;
  if (assets.logo) {
    const logo = await c.image(assets.logo);
    const lw = (logo.width / logo.height) * logoH;
    page.image(logo, page.w - M - lw, y, lw, logoH);
  }
  y += page.text(PRINT.title.en.toUpperCase(), M, y, {
    size: 22 * k,
    weight: 'extrabold',
    color: C.navy,
  });
  y += page.text(PRINT.title.fr.toUpperCase(), M, y, {
    size: 15 * k,
    weight: 'extrabold',
    color: C.greenText,
  });
  const whereEn = `${facilityName.en} — ${building.en} — ${floorName.en}`;
  const whereFr = `${facilityName.fr} — ${building.fr} — ${floorName.fr}`;
  y += page.paragraph(whereEn, M, y + 2 * k, cw, { size: 11 * k, weight: 'semibold' });
  y += page.paragraph(whereFr, M, y + 2 * k, cw, { size: 11 * k, color: C.subtle }) + 4 * k;
  if (posting) {
    const name = both(posting.name);
    const label = `${PRINT.youAreHere.en.toUpperCase()} / ${PRINT.youAreHere.fr.toUpperCase()}: ${name.en} / ${name.fr}`;
    const lines = c.wrap(label, 10 * k, cw - 12 * k, 'bold');
    const h = lines.length * 12.5 * k + 6 * k;
    page.rect(M, y, cw, h, { fill: C.red, radius: 4 * k });
    lines.forEach((l, i) =>
      page.text(l, M + 6 * k, y + 3 * k + i * 12.5 * k, {
        size: 10 * k,
        weight: 'bold',
        color: C.white,
      }),
    );
    y += h + 6 * k;
  }
  const top = y + 4 * k;

  // ---------------------------------------------------------------- footer
  const confirmations = [...equipment, ...routes]
    .map((x) => x.confirmed!)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const people = [...new Set(confirmations.map((x) => x.by))];
  const footerLines: { t: string; w: 'bold' | 'regular' }[] = [
    { t: PRINT.verify.en(o.printedOn), w: 'bold' },
    { t: PRINT.verify.fr(o.printedOn), w: 'bold' },
  ];
  if (people.length) {
    const by = people.length > 2 ? `${people.slice(0, 2).join(', ')}, …` : people.join(', ');
    const date = confirmations[0]!.at.slice(0, 10);
    footerLines.push({
      t: `${PRINT.confirmed.en(by, date)} ${PRINT.confirmed.fr(by, date)}`,
      w: 'regular' as const,
    });
  }
  const footerSize = 8.5 * k;
  const footerTextW = cw - 120 * k;
  const footerH =
    footerLines.reduce(
      (h, l) => h + c.wrap(l.t, footerSize, footerTextW, l.w).length * footerSize * 1.25,
      0,
    ) +
    10 * k;
  const footerY = page.h - M - footerH;
  page.line(M, footerY, page.w - M, footerY, { color: C.rule, width: 0.75 * k });
  let fy = footerY + 6 * k;
  for (const l of footerLines)
    fy += page.paragraph(l.t, M, fy, footerTextW, {
      size: footerSize,
      weight: l.w,
      color: l.w === 'bold' ? C.ink : C.subtle,
    });
  page.text('EVACTIS 3DWORKFLOW', page.w - M, footerY + 6 * k, {
    size: 8 * k,
    weight: 'extrabold',
    color: C.navy,
    align: 'right',
  });

  // ---------------------------------------------------------------- legend content
  const types = [
    ...new Map(equipment.map((e) => [e.typeId, equipmentTypeInfo(env, e.typeId)])).values(),
  ].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  const ap = env.equipment.find((e) => routes.some((r) => r.assemblyPointId === e.id));
  const apName = ap
    ? both(ap.label ?? equipmentTypeInfo(env, ap.typeId).name)
    : both(PRINT.assemblyPoint);
  type Row = { draw: (p: Page, x: number, y: number) => void; en: string; fr: string };
  const icon = 16 * k;
  const rows: Row[] = [];
  for (const pr of ['primary', 'secondary'] as const)
    if (routes.some((r) => r.priority === pr))
      rows.push({
        en: (pr === 'primary' ? PRINT.primaryRoute : PRINT.secondaryRoute).en,
        fr: (pr === 'primary' ? PRINT.primaryRoute : PRINT.secondaryRoute).fr,
        draw: (p, x, yy) => routeSample(p, x, yy + icon / 2, icon * 1.6, pr, k),
      });
  if (posting)
    rows.push({
      en: PRINT.youAreHere.en,
      fr: PRINT.youAreHere.fr,
      draw: (p, x, yy) => youAreHereDot(p, x + icon / 2, yy + icon / 2, k),
    });
  const signImages = new Map<string, PDFImage>();
  for (const t of types)
    if (t.sign && assets.signs[t.sign])
      signImages.set(t.sign, await c.image(assets.signs[t.sign]!));
  for (const t of types)
    rows.push({
      en: localize(t.name, 'en'),
      fr: localize(t.name, 'fr'),
      draw: (p, x, yy) =>
        drawItem(
          p,
          c,
          t.sign ? signImages.get(t.sign) : undefined,
          equipmentSymbol(t),
          t.category,
          x + icon / 2,
          yy + icon / 2,
          icon,
          k,
        ),
    });
  const legendTitle = `${PRINT.legend.en.toUpperCase()} / ${PRINT.legend.fr.toUpperCase()}`;
  const emergencyTitle = [PRINT.emergency.en.toUpperCase(), PRINT.emergency.fr.toUpperCase()];
  const follow = [PRINT.follow.en(apName.en), PRINT.follow.fr(apName.fr)];
  const rowH = 26 * k;
  const textSize = 9 * k;

  /** Lays the legend out in a box of width w at (x, y); returns its height. */
  const legend = (p: Page | null, x: number, y0: number, w: number, columns: number): number => {
    let yy = y0;
    if (p) p.text(legendTitle, x, yy, { size: 10 * k, weight: 'extrabold', color: C.navy });
    yy += 16 * k;
    const colW = w / columns;
    rows.forEach((r, i) => {
      const cx = x + (i % columns) * colW;
      const cy = yy + Math.floor(i / columns) * rowH;
      if (p) {
        r.draw(p, cx, cy);
        const tx = cx + icon * 2.2;
        p.text(r.en, tx, cy, { size: textSize, weight: 'semibold' });
        p.text(r.fr, tx, cy + textSize * 1.2, { size: textSize, color: C.subtle });
      }
    });
    yy += Math.ceil(rows.length / columns) * rowH + 8 * k;
    if (routes.length) {
      for (const t of emergencyTitle) {
        if (p) p.text(t, x, yy, { size: 10 * k, weight: 'extrabold', color: C.navy });
        yy += 13 * k;
      }
      yy += 2 * k;
      for (const f of follow) {
        const h = p
          ? p.paragraph(f, x, yy, w, { size: textSize })
          : c.wrap(f, textSize, w).length * textSize * 1.25;
        yy += h + 3 * k;
      }
    }
    return yy - y0;
  };

  // ---------------------------------------------------------------- choose layout
  const W = plan.widthPx;
  const H = plan.heightPx;
  const ch = footerY - 8 * k - top;
  const sideW = 170 * k;
  const gap = 14 * k;
  const sideScale = Math.min((cw - sideW - gap) / W, ch / H);
  const bottomCols = 3;
  const bottomH = legend(null, 0, 0, cw, bottomCols);
  const bottomScale = Math.min(cw / W, (ch - bottomH - gap) / H);
  const side = sideScale >= bottomScale;
  const s = Math.max(side ? sideScale : bottomScale, 0.01);
  const pw = W * s;
  const ph = H * s;
  const px = side ? M + (cw - sideW - gap - pw) / 2 : M + (cw - pw) / 2;
  const py = top;
  const at = (q: PlanPoint) => ({ x: px + q.x * s, y: py + q.y * s });

  // ---------------------------------------------------------------- plan
  page.image(await c.image(planBytes), px, py, pw, ph);
  page.rect(px, py, pw, ph, { stroke: C.rule, width: 0.75 * k });

  for (const r of routes)
    for (const seg of r.segments.filter((x) => x.floorId === floor.id))
      drawRoute(page, seg.points.map(at), r, k);

  // Labels are placed where they hide no route, sign or other label (see place()).
  const blocked = new Obstacles();
  for (const r of routes)
    for (const seg of r.segments.filter((x) => x.floorId === floor.id)) {
      const pts = seg.points.map(at);
      for (let i = 1; i < pts.length; i++) blocked.segment(pts[i - 1]!, pts[i]!, 4 * k);
    }
  for (const e of equipment) {
    const q = at(e.planPosition!);
    const size = (e.typeId === 'assembly-point' ? 24 : 15) * k;
    blocked.box({ x: q.x - size / 2 - k, y: q.y - size / 2 - k, w: size + 2 * k, h: size + 2 * k });
  }
  const inside = (b: Box) => b.x >= px && b.y >= py && b.x + b.w <= px + pw && b.y + b.h <= py + ph;
  /** Around a point: right, left, below, above. */
  const around = (q: { x: number; y: number }, w: number, h: number, d: number): Box[] => [
    { x: q.x + d, y: q.y - h / 2, w, h },
    { x: q.x - d - w, y: q.y - h / 2, w, h },
    { x: q.x - w / 2, y: q.y + d, w, h },
    { x: q.x - w / 2, y: q.y - d - h, w, h },
  ];

  let yahLabel: Box | null = null;
  const yahSize = 9 * k;
  const yahLines = [PRINT.youAreHere.en.toUpperCase(), PRINT.youAreHere.fr.toUpperCase()];
  if (posting) {
    const q = at(posting.planPosition);
    blocked.box({ x: q.x - 10 * k, y: q.y - 10 * k, w: 20 * k, h: 20 * k });
    if (posting.facingDeg !== undefined) {
      const a = (posting.facingDeg * Math.PI) / 180;
      blocked.segment(q, { x: q.x + Math.sin(a) * 26 * k, y: q.y - Math.cos(a) * 26 * k }, 5 * k);
    }
    const w = Math.max(...yahLines.map((l) => c.width(l, yahSize, 'extrabold'))) + 8 * k;
    yahLabel = blocked.place(around(q, w, yahSize * 2.6, 12 * k).filter(inside));
  }
  let apLabel: { box: Box; lines: string[] } | null = null;
  const apEquip = equipment.find((e) => e.typeId === 'assembly-point');
  if (apEquip) {
    const n = both(apEquip.label ?? equipmentTypeInfo(env, apEquip.typeId).name);
    const lines = [n.en, n.fr];
    const size8 = 8 * k;
    const w = Math.max(...lines.map((l) => c.width(l, size8, 'bold'))) + 6 * k;
    apLabel = {
      box: blocked.place(around(at(apEquip.planPosition!), w, size8 * 2.6, 16 * k).filter(inside)),
      lines,
    };
  }
  for (const z of env.zones.filter((z) => z.floorId === floor.id)) {
    const xs = z.polygon.map((q) => q.x);
    const ys = z.polygon.map((q) => q.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const n = both(z.name);
    const size = 8 * k;
    const w = Math.max(c.width(n.en, size, 'bold'), c.width(n.fr, size)) + 6 * k;
    const h = size * 2.6;
    const spots = [
      [0.5, 0.5],
      [0.5, 0.25],
      [0.5, 0.75],
      [0.3, 0.5],
      [0.7, 0.5],
      [0.3, 0.25],
      [0.7, 0.25],
      [0.3, 0.75],
      [0.7, 0.75],
      [0.5, 0.12],
      [0.5, 0.88],
    ].map(([fx, fy]) => {
      const q = at({ x: x0 + (x1 - x0) * fx!, y: y0 + (y1 - y0) * fy! });
      return { x: q.x - w / 2, y: q.y - h / 2, w, h };
    });
    // Small rooms: just outside the room, beside it, is better than over the route.
    const tl = at({ x: x0, y: y0 });
    const br = at({ x: x1, y: y1 });
    const my = (tl.y + br.y) / 2 - h / 2;
    const mx = (tl.x + br.x) / 2 - w / 2;
    spots.push(
      { x: br.x + 4 * k, y: my, w, h },
      { x: tl.x - 4 * k - w, y: my, w, h },
      { x: mx, y: br.y + 4 * k, w, h },
      { x: mx, y: tl.y - 4 * k - h, w, h },
    );
    const b = blocked.place(spots.filter(inside));
    page.rect(b.x, b.y, b.w, b.h, { fill: C.white, radius: 2 * k });
    page.text(n.en, b.x + b.w / 2, b.y + 1.5 * k, {
      size,
      weight: 'bold',
      color: C.navy,
      align: 'center',
    });
    page.text(n.fr, b.x + b.w / 2, b.y + 1.5 * k + size * 1.2, {
      size,
      color: C.navy,
      align: 'center',
    });
  }

  for (const e of equipment) {
    const info = equipmentTypeInfo(env, e.typeId);
    const q = at(e.planPosition!);
    const isAp = e.typeId === 'assembly-point';
    const size = (isAp ? 24 : 15) * k;
    drawItem(
      page,
      c,
      info.sign ? signImages.get(info.sign) : undefined,
      equipmentSymbol(info),
      info.category,
      q.x,
      q.y,
      size,
      k,
    );
    if (isAp && apLabel) {
      const b = apLabel.box;
      const size8 = 8 * k;
      page.rect(b.x, b.y, b.w, b.h, {
        fill: C.white,
        stroke: C.safeGreen,
        width: 0.75 * k,
        radius: 2 * k,
      });
      apLabel.lines.forEach((l, i) =>
        page.text(l, b.x + 3 * k, b.y + 1.5 * k + i * size8 * 1.2, {
          size: size8,
          weight: 'bold',
          color: C.safeGreen,
        }),
      );
    }
  }

  if (posting) {
    const q = at(posting.planPosition);
    if (posting.facingDeg !== undefined) {
      // facingDeg is already measured from the top of the plan.
      const a = (posting.facingDeg * Math.PI) / 180;
      const len = 22 * k;
      const tip = { x: q.x + Math.sin(a) * len, y: q.y - Math.cos(a) * len };
      page.line(q.x, q.y, tip.x, tip.y, { color: C.red, width: 3 * k });
      arrowHead(page, tip, a, 7 * k, C.red);
    }
    youAreHereDot(page, q.x, q.y, k);
    if (yahLabel) {
      const b = yahLabel;
      page.rect(b.x, b.y, b.w, b.h, { fill: C.red, radius: 3 * k });
      yahLines.forEach((l, i) =>
        page.text(l, b.x + 4 * k, b.y + 2 * k + i * yahSize * 1.2, {
          size: yahSize,
          weight: 'extrabold',
          color: C.white,
        }),
      );
    }
  }

  // North arrow (top right of the plan) and scale bar (bottom left).
  const nx = px + pw - 18 * k;
  const ny = py + 20 * k;
  page.circle(nx, ny, 13 * k, { fill: C.white, stroke: C.navy, width: 0.75 * k });
  const na = (plan.northDeg * Math.PI) / 180;
  arrowHead(
    page,
    { x: nx + Math.sin(na) * 9 * k, y: ny - Math.cos(na) * 9 * k },
    na,
    8 * k,
    C.navy,
  );
  page.line(nx, ny, nx + Math.sin(na) * 6 * k, ny - Math.cos(na) * 6 * k, {
    color: C.navy,
    width: 2 * k,
  });
  page.text(PRINT.north, nx, ny + 1 * k, {
    size: 8 * k,
    weight: 'extrabold',
    color: C.navy,
    align: 'center',
  });
  if (plan.pixelsPerMetre) {
    const metres = niceMetres((70 * k) / (s * plan.pixelsPerMetre));
    const len = metres * plan.pixelsPerMetre * s;
    const sx = px + 10 * k;
    const sy = py + ph - 14 * k;
    page.rect(sx - 4 * k, sy - 14 * k, len + 40 * k, 22 * k, { fill: C.white, radius: 2 * k });
    page.rect(sx, sy, len, 3 * k, { fill: C.navy });
    page.line(sx, sy - 3 * k, sx, sy + 3 * k, { color: C.navy, width: 1 * k });
    page.line(sx + len, sy - 3 * k, sx + len, sy + 3 * k, { color: C.navy, width: 1 * k });
    page.text(`${metres} m`, sx + len + 4 * k, sy - 3.5 * k, {
      size: 8 * k,
      weight: 'bold',
      color: C.navy,
    });
    page.text('0', sx, sy - 12 * k, { size: 8 * k, color: C.navy });
  }

  // ---------------------------------------------------------------- legend
  if (side) legend(page, M + cw - sideW, top, sideW, 1);
  else legend(page, M, py + ph + gap, cw, bottomCols);

  const bytes = await c.save();
  return {
    bytes,
    report: {
      minFontPt: Math.round(c.minFontPt * 100) / 100,
      page: { w: page.w, h: page.h },
      equipment: equipment.length,
      routes: routes.length,
      unconfirmed,
    },
  };
}

// ---------------------------------------------------------------- label placement

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Things a label must not cover: route lines (with their width) and placed boxes. */
class Obstacles {
  private boxes: Box[] = [];
  private segments: { a: { x: number; y: number }; b: { x: number; y: number }; r: number }[] = [];

  box(b: Box) {
    this.boxes.push(b);
  }

  segment(a: { x: number; y: number }, b: { x: number; y: number }, r: number) {
    this.segments.push({ a, b, r });
  }

  hits(b: Box): number {
    let n = 0;
    for (const o of this.boxes)
      if (b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h) n++;
    for (const s of this.segments)
      if (
        segmentHitsBox(s.a, s.b, { x: b.x - s.r, y: b.y - s.r, w: b.w + 2 * s.r, h: b.h + 2 * s.r })
      )
        n++;
    return n;
  }

  /** The first candidate that hides nothing (else the least bad); it becomes an obstacle. */
  place(candidates: Box[]): Box {
    let best = candidates[0]!;
    let bestHits = Infinity;
    for (const c of candidates) {
      const h = this.hits(c);
      if (h < bestHits) {
        best = c;
        bestHits = h;
        if (h === 0) break;
      }
    }
    this.box(best);
    return best;
  }
}

/** Liang–Barsky: does segment a–b cross the box? */
function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, r: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- drawing helpers

function arrowHead(
  p: Page,
  tip: { x: number; y: number },
  angle: number,
  size: number,
  color: RGB,
) {
  const back = { x: tip.x - Math.sin(angle) * size, y: tip.y + Math.cos(angle) * size };
  const side = { x: Math.cos(angle) * size * 0.55, y: Math.sin(angle) * size * 0.55 };
  const d = `M${tip.x} ${tip.y} L${back.x + side.x} ${back.y + side.y} L${back.x - side.x} ${back.y - side.y} Z`;
  p.path(d, 0, 0, { fill: color });
}

function drawRoute(p: Page, pts: { x: number; y: number }[], r: Route, k: number) {
  const primary = r.priority === 'primary';
  const width = (primary ? 4.5 : 3.5) * k;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    // A white casing keeps the route readable over walls and fills.
    p.line(a.x, a.y, b.x, b.y, { color: C.white, width: width + 2.5 * k });
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    p.line(a.x, a.y, b.x, b.y, {
      color: C.safeGreen,
      width,
      ...(primary ? {} : { dash: [7 * k, 5 * k] }),
    });
  }
  // Direction arrows along the route.
  const step = 46 * k;
  let carry = step / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.x - a.x, -(b.y - a.y));
    for (let d = carry; d < len; d += step) {
      const t = d / len;
      const tip = {
        x: a.x + (b.x - a.x) * t + Math.sin(ang) * 4 * k,
        y: a.y + (b.y - a.y) * t - Math.cos(ang) * 4 * k,
      };
      arrowHead(p, tip, ang, 9 * k, C.white);
      arrowHead(
        p,
        { x: tip.x - Math.sin(ang) * 1.2 * k, y: tip.y + Math.cos(ang) * 1.2 * k },
        ang,
        6.5 * k,
        C.safeGreen,
      );
    }
    carry = (((carry - len) % step) + step) % step;
  }
  // The end of the route.
  const end = pts.at(-1)!;
  p.circle(end.x, end.y, 3.5 * k, { fill: C.safeGreen, stroke: C.white, width: 1.5 * k });
}

function routeSample(
  p: Page,
  x: number,
  y: number,
  w: number,
  priority: Route['priority'],
  k: number,
) {
  p.line(x, y, x + w, y, { color: C.white, width: 7 * k });
  p.line(x, y, x + w, y, {
    color: C.safeGreen,
    width: 4 * k,
    ...(priority === 'primary' ? {} : { dash: [7 * k, 5 * k] }),
  });
  arrowHead(p, { x: x + w, y }, Math.PI / 2, 7 * k, C.safeGreen);
}

function youAreHereDot(p: Page, x: number, y: number, k: number) {
  p.circle(x, y, 7 * k, { fill: C.red, stroke: C.white, width: 2.5 * k });
}

/** A sign image, or a symbol tile for types without a sign, centred at (x, y). */
function drawItem(
  p: Page,
  c: Canvas,
  img: PDFImage | undefined,
  symbol: string,
  category: EquipmentCategory,
  x: number,
  y: number,
  size: number,
  k: number,
) {
  if (img) {
    const h = (img.height / img.width) * size;
    p.image(img, x - size / 2, y - h / 2, size, h);
    return;
  }
  const fs = 8 * k;
  const w = Math.max(size, c.width(symbol, fs, 'extrabold') + 6 * k);
  const h = Math.max(size * 0.8, fs * 1.6);
  p.rect(x - w / 2, y - h / 2, w, h, {
    fill: category === 'fire' ? C.red : C.navy,
    stroke: C.white,
    width: 1.2 * k,
    radius: 2 * k,
  });
  p.text(symbol, x, y - fs * 0.62, {
    size: fs,
    weight: 'extrabold',
    color: C.white,
    align: 'center',
  });
}
