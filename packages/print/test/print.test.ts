import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { demoEnvironment } from '../../demo-facility/src/environment.ts';
import {
  PrintError,
  certificatePdf,
  quickStartPdf,
  installGuidePdf,
  installGuideTexts,
  crc32,
  evacuationPlanPdf,
  registerCsv,
  registerPdf,
  registerRows,
  registerXlsx,
} from '../src/index.ts';
import { demoAssets } from './assets.ts';

/** PDF checks use poppler (pdftotext, pdfinfo, pdffonts), as installed in CI. */
const dir = mkdtempSync(join(tmpdir(), 'evx-print-'));
const save = (name: string, bytes: Uint8Array) => {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};
const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { encoding: 'utf8' });
const text = (pdf: string) => run('pdftotext', '-layout', pdf, '-');
const env = demoEnvironment();
const assets = demoAssets();

describe('evacuation plans', () => {
  it('prints letter and tabloid, bilingual, with "You are here", the date and the verify note', async () => {
    for (const paper of ['letter', 'tabloid'] as const) {
      const { bytes, report } = await evacuationPlanPdf(env, assets, {
        floorId: 'f1',
        postingId: 'post-lobby',
        paper,
        printedOn: '2026-10-19',
      });
      const pdf = save(`f1-${paper}.pdf`, bytes);
      const info = run('pdfinfo', pdf);
      expect(info).toMatch(paper === 'letter' ? /612 x 792 pts \(letter\)/ : /792 x 1224 pts/);
      expect(info).toMatch(/Pages:\s+1/);
      // Legible: nothing under 8 pt on letter, and everything scales up on tabloid.
      expect(report.minFontPt).toBeGreaterThanOrEqual(paper === 'letter' ? 8 : 10.3);
      const t = text(pdf);
      for (const s of [
        'EVACUATION PLAN',
        'PLAN D’ÉVACUATION',
        'YOU ARE HERE',
        'VOUS ÊTES ICI',
        'Main lobby',
        'Hall principal',
        'Verify on site before relying on this plan. Printed 2026-10-19.',
        'Vérifiez sur place avant de vous fier à ce plan. Imprimé le 2026-10-19.',
        'Assembly point A — front lawn',
        'Evacuation route',
        'Itinéraire de rechange',
        'Fire extinguisher',
        'Extincteur',
      ])
        expect(t, s).toContain(s);
      expect(t).toMatch(/\b\d+ ?m\b/);
      // Fonts are embedded subsets of Inter (no system font substitution on any PC).
      const fonts = run('pdffonts', pdf);
      expect(fonts.match(/Inter/g)?.length).toBeGreaterThanOrEqual(3);
      expect(fonts).not.toMatch(/ no {2,}no /);
      expect(report).toMatchObject({ equipment: 10, routes: 2, unconfirmed: [] });
    }
  });

  it('prints the general plan without "You are here" and orients by the plan', async () => {
    const { bytes, report } = await evacuationPlanPdf(env, assets, {
      floorId: 'f2',
      paper: 'letter',
      printedOn: '2026-10-19',
    });
    const t = text(save('f2.pdf', bytes));
    expect(t).not.toContain('YOU ARE HERE');
    expect(t).toContain('Second floor');
    expect(t).toContain('Deuxième étage');
    expect(report.page).toEqual({ w: 612, h: 792 });
  });

  it('shows each audience its own layers; first responders get the extra items', async () => {
    const staff = await evacuationPlanPdf(env, assets, {
      floorId: 'f1',
      paper: 'letter',
      printedOn: '2026-10-19',
      audience: 'staff',
    });
    const fr = await evacuationPlanPdf(env, assets, {
      floorId: 'f1',
      paper: 'letter',
      printedOn: '2026-10-19',
      audience: 'first-responders',
    });
    expect(fr.report.equipment - staff.report.equipment).toBe(4);
    const t = text(save('f1-fr.pdf', fr.bytes));
    expect(t).toContain('FDC');
    expect(t).toContain('Fire department connection');
    expect(text(save('f1-staff.pdf', staff.bytes))).not.toContain('FDC');
  });

  it('leaves out anything nobody confirmed, and says which', async () => {
    const draft = structuredClone(env);
    draft.equipment.find((e) => e.id === 'fe-101')!.confirmed = undefined;
    draft.routes.find((r) => r.id === 'route-north')!.confirmed = undefined;
    const { report, bytes } = await evacuationPlanPdf(draft, assets, {
      floorId: 'f1',
      paper: 'letter',
      printedOn: '2026-10-19',
    });
    expect(report.unconfirmed.sort()).toEqual(['fe-101', 'route-north']);
    expect(report).toMatchObject({ equipment: 9, routes: 1 });
    expect(text(save('draft.pdf', bytes))).not.toContain('Itinéraire de rechange');
  });

  it('refuses floors without a plan and postings from another floor', async () => {
    await expect(
      evacuationPlanPdf(env, assets, {
        floorId: 'f1',
        postingId: 'post-office',
        paper: 'letter',
        printedOn: '2026-10-19',
      }),
    ).rejects.toBeInstanceOf(PrintError);
    const noPlan = structuredClone(env);
    delete noPlan.buildings[0]!.floors[1]!.plan;
    await expect(
      evacuationPlanPdf(noPlan, assets, {
        floorId: 'f2',
        paper: 'letter',
        printedOn: '2026-10-19',
      }),
    ).rejects.toThrow('has no plan');
  });

  it('is reproducible: same input, same bytes', async () => {
    const o = { floorId: 'f1', paper: 'letter' as const, printedOn: '2026-10-19' };
    const a = await evacuationPlanPdf(env, assets, o);
    const b = await evacuationPlanPdf(env, assets, o);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

describe('equipment register', () => {
  const rows = registerRows(env);

  it('lists every item with floor, location, inspections and a scene link', () => {
    expect(rows).toHaveLength(env.equipment.length);
    const fe = rows.find((r) => r.tag === 'FE-101')!;
    expect(fe).toMatchObject({
      typeEn: 'Fire extinguisher',
      typeFr: 'Extincteur',
      floor: 'Ground floor / Rez-de-chaussée',
      location: 'Main lobby',
      scenes: 'Main lobby',
      lastInspection: '2026-09-15',
      nextInspection: '2026-10-15',
      sceneLink: 'index.html?scene=lobby',
      audience: 'Everyone / Tous',
    });
    expect(rows.find((r) => r.id === 'fdc')).toMatchObject({
      audience: 'First Responders',
      sceneLink: '',
    });
    // Ground floor first.
    const floors = rows.map((r) => (r.floor.startsWith('Ground') ? 0 : 1));
    expect([...floors].sort()).toEqual(floors);
    expect(registerRows(env, { audience: 'staff' }).some((r) => r.id === 'fdc')).toBe(false);
  });

  it('exports CSV that spreadsheets open with accents intact', () => {
    const csv = registerCsv(rows);
    expect(csv.startsWith('﻿Tag / Étiquette,Type (EN),Type (FR),')).toBe(true);
    expect(csv).toContain('\r\nFE-101,Fire extinguisher,Extincteur,');
    expect(csv).toContain('"Ground floor / Rez-de-chaussée"'.replace(/"/g, ''));
    expect(csv.split('\r\n')).toHaveLength(rows.length + 2);
  });

  it('exports a valid XLSX workbook', () => {
    const x = registerXlsx(rows);
    const file = save('register.xlsx', x);
    expect(run('unzip', '-t', file)).toContain('No errors detected');
    const list = run('unzip', '-l', file);
    for (const part of [
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/styles.xml',
    ])
      expect(list).toContain(part);
    const sheet = run('unzip', '-p', file, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<t xml:space="preserve">FE-101</t>');
    expect(sheet).toContain('Rez-de-chaussée');
    expect(sheet).toContain('state="frozen"');
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('prints the register as a PDF table with the verify note and page numbers', async () => {
    const { bytes, minFontPt } = await registerPdf(env, rows, assets.fonts, {
      printedOn: '2026-10-19',
    });
    const pdf = save('register.pdf', bytes);
    expect(run('pdfinfo', pdf)).toMatch(/792 x 612 pts/);
    const t = text(pdf);
    for (const s of [
      'EQUIPMENT REGISTER',
      'FE-101',
      'Extincteur',
      'Verify on site',
      'Page 1 of',
      '2026-10-19',
    ])
      expect(t, s).toContain(s);
    expect(minFontPt).toBeGreaterThanOrEqual(8);
  });
});

describe('training certificates', () => {
  it('prints a bilingual landscape certificate with the learner, module, facility and result', async () => {
    const bytes = await certificatePdf(
      {
        learner: 'Marie-Ève Tremblay',
        module: { en: 'Find your nearest exit', fr: 'Trouvez la sortie la plus proche' },
        facility: { en: 'Evactis Demo Centre', fr: 'Centre de démonstration Evactis' },
        score: 3.5,
        max: 4,
        percent: 88,
        date: '2026-10-20',
      },
      { fonts: assets.fonts, logo: assets.logo },
    );
    const pdf = save('certificate.pdf', bytes);
    expect(run('pdfinfo', pdf)).toMatch(/792 x 612 pts/);
    const t = text(pdf).replace(/\s+/g, ' ');
    for (const s of [
      'CERTIFICATE OF COMPLETION · ATTESTATION DE RÉUSSITE',
      'Marie-Ève Tremblay',
      'Find your nearest exit',
      'Trouvez la sortie la plus proche',
      'at Evactis Demo Centre',
      'Result: 3.5 / 4 (88 %), 2026-10-20',
      'Résultat : 3.5 / 4 (88 %), 2026-10-20',
      'no data was sent anywhere',
      'ne remplace pas une visite sur place',
    ])
      expect(t, s).toContain(s);
    // Nothing that could phone home: no links or JavaScript in the file.
    const raw = Buffer.from(bytes).toString('latin1');
    expect(raw).not.toMatch(/\/URI|\/JavaScript|\/JS\b|\/Launch/);
  });
});

describe('quick-start guide', () => {
  it('prints English then French: how to open this kind, the stamp, the offline notice', async () => {
    const bytes = await quickStartPdf(
      {
        kind: 'portable',
        facility: { en: 'Riverside Hospital', fr: 'Hôpital Riverside' },
        createdAt: '2026-10-20T15:00:00Z',
        producer: 'EVACTIS 3DWORKFLOW Studio 0.1.0',
        encrypted: true,
      },
      { fonts: assets.fonts, logo: assets.logo },
    );
    const pdf = save('quick-start.pdf', bytes);
    expect(run('pdfinfo', pdf)).toMatch(/Pages:\s+2/);
    const [en, fr] = text(pdf)
      .split('\f')
      .map((p) => p.replace(/\s+/g, ' '));
    for (const s of [
      'QUICK START',
      'RIVERSIDE HOSPITAL',
      'Portable viewer (no installation) · made 2026-10-20 by EVACTIS 3DWORKFLOW Studio 0.1.0',
      'This environment runs fully offline',
      'double-click EVACTIS-3DWORKFLOW-Viewer.exe',
      'Enter the passphrase you were given',
      'evacuation route button',
    ])
      expect(en, s).toContain(s);
    for (const s of [
      'DÉMARRAGE RAPIDE',
      'HÔPITAL RIVERSIDE',
      'produit le 2026-10-20',
      'fonctionne entièrement hors ligne',
      'Entrez la phrase de passe',
    ])
      expect(fr, s).toContain(s);
    const raw = Buffer.from(bytes).toString('latin1');
    expect(raw).not.toMatch(/\/URI|\/JavaScript|\/JS\b|\/Launch/);
  });
});

describe('Windows installation guide', () => {
  const guide = (lang: 'en' | 'fr', testSigned = false) =>
    installGuidePdf(
      { lang, version: '1.0.0', date: '2026-10-27', testSigned },
      { fonts: assets.fonts, logo: assets.logo! },
    );

  it('prints each language with the steps, signature check, IT commands and page numbers', async () => {
    const en = await guide('en');
    const fr = await guide('fr');
    for (const [lang, g] of [
      ['en', en],
      ['fr', fr],
    ] as const) {
      expect(g.minFontPt).toBeGreaterThanOrEqual(8);
      expect(g.pages).toBeLessThanOrEqual(6);
      const pdf = save(`install-guide-${lang}.pdf`, g.pdf);
      expect(run('pdfinfo', pdf)).toMatch(new RegExp(`Pages:\\s+${g.pages}`));
      const t = text(pdf).replace(/\s+/g, ' ');
      for (const s of [
        'EVACTIS-3DWORKFLOW-Viewer-1.0.0-x64-setup.exe',
        'msiexec /i EVACTIS-3DWORKFLOW-Viewer-1.0.0-x64-en-US.msi /qn /norestart',
        '/S /CurrentUser',
        `${g.pages} `,
      ])
        expect(t, s).toContain(s);
      expect(t).not.toContain('TEST');
      const raw = Buffer.from(g.pdf).toString('latin1');
      expect(raw).not.toMatch(/\/URI|\/JavaScript|\/JS\b|\/Launch/);
    }
    const tEn = text(save('ig-en.pdf', en.pdf)).replace(/\s+/g, ' ');
    const tFr = text(save('ig-fr.pdf', fr.pdf)).replace(/\s+/g, ' ');
    for (const s of [
      'INSTALLING EVACTIS 3DWORKFLOW',
      'The signer must be "Evactis"',
      'Install just for me',
      'No internet connection is needed',
      'Page 1 of',
    ])
      expect(tEn, s).toContain(s);
    for (const s of [
      'INSTALLER EVACTIS 3DWORKFLOW',
      'Le signataire doit être « Evactis »',
      'Aucune connexion Internet n’est nécessaire',
      'Page 1 de',
    ])
      expect(tFr, s).toContain(s);
  });

  it('a test-signed build says so and tells the reader not to trust the test certificate', async () => {
    const t = text(save('ig-test.pdf', (await guide('en', true)).pdf)).replace(/\s+/g, ' ');
    expect(t).toContain('TEST BUILD, NOT FOR DELIVERY');
    expect(t).toContain('Do not add the test certificate');
    expect(t).not.toContain('The signer must be "Evactis"');
    const tf = text(save('ig-test-fr.pdf', (await guide('fr', true)).pdf)).replace(/\s+/g, ' ');
    expect(tf).toContain('VERSION D’ESSAI, NE PAS LIVRER');
  });

  it('has every text in both languages, and the print fonts draw every character', () => {
    const en = installGuideTexts('en');
    const fr = installGuideTexts('fr');
    expect(fr.length).toBe(en.length);
    const fonts = Object.values(assets.fonts).map((b) => fontkit.create(Buffer.from(b)));
    const missing = new Set<string>();
    for (const s of [...en, ...fr])
      for (const ch of s)
        if (ch !== '\n' && !fonts.every((f) => f.hasGlyphForCodePoint(ch.codePointAt(0)!)))
          missing.add(ch);
    expect([...missing]).toEqual([]);
  });
});
