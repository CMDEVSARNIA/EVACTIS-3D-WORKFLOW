/**
 * Equipment register: every item with its location, floor, inspection dates and a link
 * that opens the Viewer at the scene where it is seen. Exported as CSV (UTF-8 with a
 * byte-order mark, so spreadsheet apps read accents), XLSX and PDF.
 */
import {
  allFloors,
  equipmentTypeInfo,
  forAudience,
  localize,
  type Environment,
  type Equipment,
  type PlanPoint,
} from '@evactis-3dworkflow/schema';
import { C, Canvas, PAPER, type PrintFonts } from './canvas.ts';
import { PRINT } from './strings.ts';
import { zip } from './zip.ts';

export interface RegisterRow {
  id: string;
  tag: string;
  typeEn: string;
  typeFr: string;
  name: string;
  building: string;
  floor: string;
  location: string;
  scenes: string;
  lastInspection: string;
  nextInspection: string;
  responsible: string;
  audience: string;
  sceneLink: string;
  confirmedBy: string;
  confirmedAt: string;
}

export type RegisterColumn = Exclude<keyof RegisterRow, 'id'>;

export const REGISTER_COLUMNS: RegisterColumn[] = [
  'tag',
  'typeEn',
  'typeFr',
  'name',
  'building',
  'floor',
  'location',
  'scenes',
  'lastInspection',
  'nextInspection',
  'responsible',
  'audience',
  'sceneLink',
  'confirmedBy',
  'confirmedAt',
];

function inside(p: PlanPoint, poly: PlanPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      hit = !hit;
  }
  return hit;
}

/** Rows for the register; `audience` limits it to what that audience may see. */
export function registerRows(
  env: Environment,
  options: { audience?: string | null } = {},
): RegisterRow[] {
  const floors = allFloors(env);
  const level = (e: Equipment) => floors.find((f) => f.id === e.floorId)?.level ?? 0;
  const items = env.equipment
    .filter((e) => options.audience === undefined || forAudience(e.audienceIds, options.audience))
    .sort((a, b) => level(a) - level(b) || (a.tag ?? a.id).localeCompare(b.tag ?? b.id));
  return items.map((e) => {
    const info = equipmentTypeInfo(env, e.typeId);
    const building = env.buildings.find((b) => b.floors.some((f) => f.id === e.floorId));
    const floor = floors.find((f) => f.id === e.floorId);
    const zone = e.planPosition
      ? env.zones.find((z) => z.floorId === e.floorId && inside(e.planPosition!, z.polygon))
      : undefined;
    const scenes = [...new Set(e.placements.map((p) => p.sceneId))]
      .map((id) => env.scenes.find((s) => s.id === id))
      .filter((s) => !!s);
    const first = scenes[0];
    return {
      id: e.id,
      tag: e.tag ?? '',
      typeEn: localize(info.name, 'en'),
      typeFr: localize(info.name, 'fr'),
      name: localize(e.label ?? info.name, 'en'),
      building: building ? localize(building.name, 'en') : '',
      floor: floor ? `${localize(floor.name, 'en')} / ${localize(floor.name, 'fr')}` : e.floorId,
      location: zone ? localize(zone.name, 'en') : '',
      scenes: scenes.map((s) => localize(s.name, 'en')).join('; '),
      lastInspection: e.lastInspection ?? '',
      nextInspection: e.nextInspection ?? '',
      responsible: e.responsiblePerson ?? '',
      audience: e.audienceIds.length
        ? e.audienceIds
            .map((a) => localize(env.audiences.find((x) => x.id === a)?.name ?? { en: a }, 'en'))
            .join('; ')
        : PRINT.everyone,
      // Opens the delivered Viewer at that scene (relative to the package folder).
      sceneLink: first ? `index.html?scene=${encodeURIComponent(first.id)}` : '',
      confirmedBy: e.confirmed?.by ?? PRINT.notConfirmed,
      confirmedAt: e.confirmed?.at.slice(0, 10) ?? '',
    };
  });
}

const csvCell = (v: string) => (/[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV with bilingual headings, CRLF line ends and a UTF-8 byte-order mark. */
export function registerCsv(rows: RegisterRow[]): string {
  const lines = [REGISTER_COLUMNS.map((c) => csvCell(PRINT.columns[c]))];
  for (const r of rows) lines.push(REGISTER_COLUMNS.map((c) => csvCell(r[c])));
  return '﻿' + lines.map((l) => l.join(',')).join('\r\n') + '\r\n';
}

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 cannot carry (control characters other than tab and newlines).
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32 || ch === '\t' || ch === '\n' || ch === '\r')
    .join('');

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** A one-sheet XLSX workbook: bold frozen header row, filters, sensible widths. */
export function registerXlsx(rows: RegisterRow[], sheetName = 'Register'): Uint8Array {
  const enc = new TextEncoder();
  const head = REGISTER_COLUMNS.map((c) => PRINT.columns[c]);
  const all = [head, ...rows.map((r) => REGISTER_COLUMNS.map((c) => r[c]))];
  const widths = REGISTER_COLUMNS.map((_, i) =>
    Math.min(60, Math.max(10, ...all.map((row) => row[i]!.length + 2))),
  );
  const cell = (v: string, r: number, c: number, style: number) =>
    v === ''
      ? ''
      : `<c r="${colName(c)}${r}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const sheetRows = all
    .map(
      (row, ri) =>
        `<row r="${ri + 1}">${row.map((v, ci) => cell(v, ri + 1, ci, ri === 0 ? 1 : 0)).join('')}</row>`,
    )
    .join('');
  const last = `${colName(REGISTER_COLUMNS.length - 1)}${all.length}`;
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${sheetRows}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    `</worksheet>`;
  const files = {
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    'xl/workbook.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xml(sheetName.slice(0, 31))}'!$A$1:$${colName(REGISTER_COLUMNS.length - 1)}$${all.length}</definedName></definedNames>` +
      `</workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    'xl/styles.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `</styleSheet>`,
    'xl/worksheets/sheet1.xml': sheet,
  };
  return zip(Object.entries(files).map(([name, data]) => ({ name, data: enc.encode(data) })));
}

/** The register as a PDF table (landscape letter), with the verify-on-site note and date. */
export async function registerPdf(
  env: Environment,
  rows: RegisterRow[],
  fonts: PrintFonts,
  options: { printedOn: string },
): Promise<{ bytes: Uint8Array; minFontPt: number }> {
  const facility = { en: localize(env.facility.name, 'en'), fr: localize(env.facility.name, 'fr') };
  const c = await Canvas.create(fonts, {
    title: `${PRINT.register.en} — ${facility.en}`,
    subject: `${PRINT.register.fr} — ${facility.fr}`,
  });
  const W = PAPER.letter.h;
  const H = PAPER.letter.w;
  const M = 30;
  const size = 8.5;
  const cols: { key: keyof RegisterRow | 'type'; label: string; w: number }[] = [
    { key: 'tag', label: PRINT.columns.tag, w: 62 },
    { key: 'type', label: 'Type', w: 128 },
    { key: 'floor', label: PRINT.columns.floor, w: 96 },
    { key: 'location', label: PRINT.columns.location, w: 92 },
    { key: 'lastInspection', label: PRINT.columns.lastInspection, w: 72 },
    { key: 'nextInspection', label: PRINT.columns.nextInspection, w: 72 },
    { key: 'scenes', label: PRINT.columns.scenes, w: 96 },
    { key: 'confirmedBy', label: PRINT.columns.confirmedBy, w: W - 2 * M - 618 },
  ];
  const text = (r: RegisterRow, k: (typeof cols)[number]['key']) =>
    k === 'type' ? `${r.typeEn}\n${r.typeFr}${r.name !== r.typeEn ? `\n${r.name}` : ''}` : r[k];

  type Line = { row: RegisterRow; cells: string[][]; h: number };
  const lines: Line[] = rows.map((row) => {
    const cells = cols.map((col) => c.wrap(text(row, col.key) || '—', size, col.w - 6));
    return { row, cells, h: Math.max(...cells.map((x) => x.length)) * size * 1.25 + 6 };
  });
  const headCells = cols.map((col) => c.wrap(col.label, size, col.w - 6, 'bold'));
  const headH = Math.max(...headCells.map((x) => x.length)) * size * 1.25 + 6;

  const pages: Line[][] = [[]];
  const bodyTop = M + 52;
  const bodyBottom = H - M - 30;
  let y = bodyTop + headH;
  for (const l of lines) {
    if (y + l.h > bodyBottom) {
      pages.push([]);
      y = bodyTop + headH;
    }
    pages.at(-1)!.push(l);
    y += l.h;
  }

  pages.forEach((pageLines, pi) => {
    const p = c.page(W, H);
    p.rect(0, 0, W, 5, { fill: C.green });
    p.text(`${PRINT.register.en.toUpperCase()} / ${PRINT.register.fr.toUpperCase()}`, M, M - 8, {
      size: 16,
      weight: 'extrabold',
      color: C.navy,
    });
    p.text(`${facility.en} / ${facility.fr}`, M, M + 14, { size: 10, weight: 'semibold' });
    const row = (
      cells: string[][],
      yy: number,
      h: number,
      weight: 'bold' | 'regular',
      fill?: typeof C.panel,
    ) => {
      if (fill) p.rect(M, yy, W - 2 * M, h, { fill });
      let x = M;
      cells.forEach((cl, i) => {
        cl.forEach((t, j) =>
          p.text(t, x + 3, yy + 3 + j * size * 1.25, {
            size,
            weight,
            color: t === PRINT.notConfirmed ? C.red : weight === 'bold' ? C.navy : C.ink,
          }),
        );
        x += cols[i]!.w;
      });
    };
    let yy = bodyTop;
    row(headCells, yy, headH, 'bold', C.panel);
    yy += headH;
    p.line(M, yy, W - M, yy, { color: C.navy, width: 1 });
    pageLines.forEach((l, i) => {
      row(l.cells, yy, l.h, 'regular', i % 2 ? C.panel : undefined);
      yy += l.h;
    });
    const fy = H - M - 22;
    p.line(M, fy, W - M, fy, { color: C.rule, width: 0.75 });
    p.text(
      `${PRINT.verify.en(options.printedOn)}  ${PRINT.verify.fr(options.printedOn)}`,
      M,
      fy + 5,
      {
        size: 8,
        weight: 'bold',
      },
    );
    p.text(
      `${PRINT.page.en(pi + 1, pages.length)} / ${PRINT.page.fr(pi + 1, pages.length)}`,
      W - M,
      fy + 5,
      {
        size: 8,
        color: C.subtle,
        align: 'right',
      },
    );
  });
  return { bytes: await c.save(), minFontPt: c.minFontPt };
}
