/**
 * Training completion certificate (Phase 8): one landscape letter page, bilingual
 * (English then French) like posted plans. Made on the learner's device from the
 * module result; nothing is sent anywhere and the PDF carries no tracking.
 */
import { C, Canvas, PAPER, type PrintFonts } from './canvas.ts';

export interface CertificateData {
  learner: string;
  module: { en: string; fr: string };
  facility: { en: string; fr: string };
  score: number;
  max: number;
  percent: number;
  /** ISO date (YYYY-MM-DD) of completion. */
  date: string;
}

export const CERTIFICATE = {
  title: { en: 'Certificate of completion', fr: 'Attestation de réussite' },
  completed: { en: 'has completed', fr: 'a terminé' },
  at: { en: 'at', fr: 'à' },
  result: {
    en: (s: number, m: number, p: number, d: string) => `Result: ${s} / ${m} (${p} %), ${d}`,
    fr: (s: number, m: number, p: number, d: string) => `Résultat : ${s} / ${m} (${p} %), ${d}`,
  },
  offline: {
    en: 'Issued by EVACTIS 3DWORKFLOW on this device; no data was sent anywhere.',
    fr: 'Délivrée par EVACTIS 3DWORKFLOW sur cet appareil; aucune donnée n’a été transmise.',
  },
  verify: {
    en: 'Virtual training does not replace a walk-through on site.',
    fr: 'Une formation virtuelle ne remplace pas une visite sur place.',
  },
};

export async function certificatePdf(
  d: CertificateData,
  assets: { fonts: PrintFonts; logo?: Uint8Array },
): Promise<Uint8Array> {
  const T = CERTIFICATE;
  const c = await Canvas.create(assets.fonts, {
    title: `${T.title.en} — ${d.module.en}`,
    subject: `${T.title.fr} — ${d.module.fr}`,
  });
  c.doc.setCreator('EVACTIS 3DWORKFLOW Viewer');
  const page = c.page(PAPER.letter.h, PAPER.letter.w);
  const M = 48;
  const cw = page.w - 2 * M;
  const mid = page.w / 2;

  page.rect(0, 0, page.w, 8, { fill: C.green });
  page.rect(M / 2, M / 2, page.w - M, page.h - M, { stroke: C.navy, width: 1.5, radius: 6 });
  let y = M + 44;
  if (assets.logo) {
    const logo = await c.image(assets.logo);
    const h = 30;
    const w = (logo.width / logo.height) * h;
    page.image(logo, mid - w / 2, y, w, h);
    y += h + 30;
  }
  // Eyebrow: short green rule then green caps, as on evactis.ca.
  const eyebrow = `${T.title.en} · ${T.title.fr}`.toUpperCase();
  const ew = c.width(eyebrow, 11, 'bold');
  page.line(mid - ew / 2 - 30, y + 6, mid - ew / 2 - 8, y + 6, { color: C.green, width: 2 });
  y += page.text(eyebrow, mid, y, {
    size: 11,
    weight: 'bold',
    color: C.greenText,
    align: 'center',
  });
  y += 30;
  const name = d.learner.trim().slice(0, 80);
  const nameSize = Math.min(34, (cw * 0.9) / Math.max(1, c.width(name, 1, 'extrabold')));
  y += page.text(name, mid, y, {
    size: nameSize,
    weight: 'extrabold',
    color: C.navy,
    align: 'center',
  });
  page.line(mid - 180, y + 4, mid + 180, y + 4, { color: C.rule, width: 0.75 });
  y += 26;
  // Centred lines (paragraph wraps, then each line is centred on the page).
  const centred = (
    s: string,
    size: number,
    weight: 'bold' | 'semibold' | 'regular',
    color = C.ink,
  ) => {
    for (const line of c.wrap(s, size, cw - 40, weight))
      y += page.text(line, mid, y, { size, weight, color, align: 'center' });
  };
  centred(`${T.completed.en} / ${T.completed.fr}`, 12, 'regular', C.subtle);
  y += 12;
  centred(d.module.en, 20, 'bold');
  if (d.module.fr !== d.module.en) centred(d.module.fr, 15, 'semibold', C.subtle);
  y += 16;
  centred(`${T.at.en} ${d.facility.en}`, 12, 'semibold');
  if (d.facility.fr !== d.facility.en)
    centred(`${T.at.fr} ${d.facility.fr}`, 11, 'regular', C.subtle);
  y += 26;
  centred(T.result.en(d.score, d.max, d.percent, d.date), 12, 'bold', C.navy);
  centred(T.result.fr(d.score, d.max, d.percent, d.date), 11, 'regular', C.subtle);

  // Footer.
  const fy = page.h - M - 28;
  page.line(M, fy, page.w - M, fy, { color: C.rule, width: 0.75 });
  page.text(`${T.offline.en} ${T.verify.en}`, mid, fy + 6, {
    size: 8.5,
    align: 'center',
    color: C.subtle,
  });
  page.text(`${T.offline.fr} ${T.verify.fr}`, mid, fy + 17, {
    size: 8.5,
    align: 'center',
    color: C.subtle,
  });
  return c.save();
}
