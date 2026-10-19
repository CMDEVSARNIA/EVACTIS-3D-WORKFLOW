/**
 * The demo's "Emergency procedures" document (2 pages, English then French), made with
 * pdf-lib and the brand's static Inter so the Viewer's PDF reader has a real local file.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';

const fonts = resolve(dirname(fileURLToPath(import.meta.url)), '../../brand/fonts/print');
const NAVY = rgb(10 / 255, 47 / 255, 91 / 255);
const RED = rgb(200 / 255, 16 / 255, 46 / 255);
const INK = rgb(0.1, 0.1, 0.1);

const PAGES = {
  en: {
    title: 'EMERGENCY PROCEDURES',
    sub: 'Evactis Demo Centre — demonstration content, not a real site',
    sections: [
      [
        'Fire',
        [
          'Pull the nearest fire alarm.',
          'Leave by the nearest exit; do not use elevators.',
          'Go to Assembly point A (front lawn) and report to your floor warden.',
        ],
      ],
      [
        'Medical emergency',
        [
          'Call 911.',
          'Send someone for the AED (lobby, west wall).',
          'Start CPR if trained; follow the AED voice prompts.',
        ],
      ],
      [
        'Smoke',
        [
          'Stay low, below the smoke.',
          'Feel doors with the back of your hand before opening.',
          'If trapped, close the door and signal from a window.',
        ],
      ],
    ],
    note: 'Verify on site: exits and equipment shown in the 3DWORKFLOW environment.',
  },
  fr: {
    title: 'PROCÉDURES D’URGENCE',
    sub: 'Centre de démonstration Evactis — contenu de démonstration, pas un vrai site',
    sections: [
      [
        'Incendie',
        [
          'Actionnez l’avertisseur le plus proche.',
          'Sortez par la sortie la plus proche; n’utilisez pas les ascenseurs.',
          'Rendez-vous au point de rassemblement A (pelouse avant) et présentez-vous à votre responsable d’étage.',
        ],
      ],
      [
        'Urgence médicale',
        [
          'Composez le 911.',
          'Envoyez quelqu’un chercher le DEA (hall, mur ouest).',
          'Commencez la RCR si vous êtes formé; suivez les instructions vocales du DEA.',
        ],
      ],
      [
        'Fumée',
        [
          'Restez bas, sous la fumée.',
          'Touchez les portes du dos de la main avant de les ouvrir.',
          'Si vous êtes coincé, fermez la porte et faites signe par une fenêtre.',
        ],
      ],
    ],
    note: 'Vérifiez sur place : sorties et équipements montrés dans l’environnement 3DWORKFLOW.',
  },
} as const;

export async function procedures(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(readFileSync(`${fonts}/inter-latin-400-normal.woff`), {
    subset: true,
  });
  const bold = await doc.embedFont(readFileSync(`${fonts}/inter-latin-800-normal.woff`), {
    subset: true,
  });
  doc.setTitle('Emergency procedures / Procédures d’urgence');
  doc.setProducer('EVACTIS 3DWORKFLOW');
  doc.setCreator('EVACTIS 3DWORKFLOW demo facility');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  for (const lang of ['en', 'fr'] as const) {
    const t = PAGES[lang];
    const page = doc.addPage([612, 792]);
    let y = 730;
    page.drawRectangle({ x: 0, y: 772, width: 612, height: 20, color: RED });
    page.drawText(t.title, { x: 56, y, size: 26, font: bold, color: NAVY });
    y -= 26;
    page.drawText(t.sub, { x: 56, y, size: 11, font: regular, color: INK });
    y -= 40;
    for (const [head, items] of t.sections) {
      page.drawText(head.toUpperCase(), { x: 56, y, size: 15, font: bold, color: RED });
      y -= 24;
      items.forEach((line, i) => {
        page.drawText(`${i + 1}.  ${line}`, {
          x: 70,
          y,
          size: 12,
          font: regular,
          color: INK,
          maxWidth: 480,
        });
        y -= 22;
      });
      y -= 16;
    }
    page.drawText(t.note, { x: 56, y: 60, size: 10, font: regular, color: INK });
  }
  return doc.save();
}
