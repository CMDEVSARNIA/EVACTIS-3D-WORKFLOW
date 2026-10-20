/**
 * The bilingual quick-start guide every delivery package carries (Phase 10): one letter
 * page in English, one in French. How to open this kind of package, how to move around,
 * the emergency tools, the passphrase if there is one, the version/date stamp, and the
 * notice that the environment runs fully offline.
 */
import { C, Canvas, PAPER, type Page, type PrintFonts } from './canvas.ts';

export type QuickStartKind =
  | 'installer'
  | 'evx'
  | 'portable'
  | 'intranet'
  | 'browser-folder'
  | 'single-file'
  | 'scorm';

export interface QuickStartData {
  kind: QuickStartKind;
  facility: { en: string; fr: string };
  /** ISO date-time the package was made. */
  createdAt: string;
  producer: string;
  encrypted: boolean;
}

type L = { en: string; fr: string };

export const QUICK_START = {
  eyebrow: { en: 'Quick start', fr: 'Démarrage rapide' },
  kindName: {
    installer: { en: 'Windows installer', fr: 'Programme d’installation Windows' },
    evx: { en: 'Environment file (.evx)', fr: 'Fichier d’environnement (.evx)' },
    portable: {
      en: 'Portable viewer (no installation)',
      fr: 'Visionneuse portable (sans installation)',
    },
    intranet: { en: 'Intranet bundle', fr: 'Ensemble pour intranet' },
    'browser-folder': { en: 'Browser folder', fr: 'Dossier pour navigateur' },
    'single-file': { en: 'Single HTML file', fr: 'Fichier HTML unique' },
    scorm: { en: 'SCORM package', fr: 'Paquet SCORM' },
  } satisfies Record<QuickStartKind, L>,
  open: { en: 'Opening it', fr: 'Pour l’ouvrir' },
  how: {
    installer: {
      en: 'Run the setup file. It installs like any other program (no administrator rights needed) and adds a Start menu shortcut named after the facility, which opens this environment directly.',
      fr: 'Lancez le programme d’installation. Il s’installe comme tout autre logiciel (sans droits d’administrateur) et ajoute au menu Démarrer un raccourci au nom de l’établissement, qui ouvre directement cet environnement.',
    },
    evx: {
      en: 'Double-click the .evx file. It opens in EVACTIS 3DWORKFLOW Viewer, which must already be installed on this computer.',
      fr: 'Double-cliquez sur le fichier .evx. Il s’ouvre dans EVACTIS 3DWORKFLOW Viewer, qui doit déjà être installé sur cet ordinateur.',
    },
    portable: {
      en: 'Copy the folder anywhere — a USB key works — and double-click EVACTIS-3DWORKFLOW-Viewer.exe inside it. Nothing is installed.',
      fr: 'Copiez le dossier où vous voulez — une clé USB convient — puis double-cliquez sur EVACTIS-3DWORKFLOW-Viewer.exe dans ce dossier. Rien n’est installé.',
    },
    intranet: {
      en: 'Your IT team copies the folder to an internal web server; open its address in a current browser. It makes no request outside that server.',
      fr: 'Votre équipe informatique copie le dossier sur un serveur Web interne; ouvrez son adresse dans un navigateur récent. Aucune requête ne sort de ce serveur.',
    },
    'browser-folder': {
      en: 'Open index.html from the folder in a current browser (Edge, Chrome or Firefox). A few features are limited when opened from disk: see README.txt.',
      fr: 'Ouvrez index.html depuis le dossier dans un navigateur récent (Edge, Chrome ou Firefox). Quelques fonctions sont limitées lorsqu’il est ouvert depuis le disque : voir README.txt.',
    },
    'single-file': {
      en: 'Open the HTML file in a current browser. Everything is in that one file; images are reduced to keep it small.',
      fr: 'Ouvrez le fichier HTML dans un navigateur récent. Tout se trouve dans ce seul fichier; les images sont réduites pour le garder léger.',
    },
    scorm: {
      en: 'Your training administrator imports the ZIP into your learning management system (LMS). Each training module appears as its own activity.',
      fr: 'Votre responsable de la formation importe le fichier ZIP dans votre plateforme d’apprentissage (LMS). Chaque module de formation y apparaît comme une activité.',
    },
  } satisfies Record<QuickStartKind, L>,
  passphrase: {
    en: 'This package is protected. Enter the passphrase you were given when asked; without it nothing can be opened. The passphrase is never stored.',
    fr: 'Ce paquet est protégé. Entrez la phrase de passe qui vous a été remise lorsqu’elle est demandée; sans elle, rien ne peut être ouvert. La phrase de passe n’est jamais enregistrée.',
  },
  moveTitle: { en: 'Moving around', fr: 'Pour se déplacer' },
  move: [
    {
      en: 'Drag, or use the arrow keys, to look around; scroll or pinch to zoom.',
      fr: 'Faites glisser, ou utilisez les flèches du clavier, pour regarder autour; défilez ou pincez pour zoomer.',
    },
    {
      en: 'Select the arrow buttons in the view to move to the next place.',
      fr: 'Sélectionnez les boutons fléchés dans la vue pour passer à l’endroit suivant.',
    },
    {
      en: 'Select a safety sign to learn about the equipment there.',
      fr: 'Sélectionnez un panneau de sécurité pour en savoir plus sur l’équipement.',
    },
    {
      en: 'Switch between English and French with the EN/FR button.',
      fr: 'Passez du français à l’anglais avec le bouton FR/EN.',
    },
  ] satisfies L[],
  emergencyTitle: { en: 'Emergency tools', fr: 'Outils d’urgence' },
  emergency: [
    {
      en: 'The evacuation route button shows the nearest route and the arrows to follow.',
      fr: 'Le bouton d’itinéraire d’évacuation montre l’itinéraire le plus proche et les flèches à suivre.',
    },
    {
      en: 'The floor plan shows where you are and where the equipment is.',
      fr: 'Le plan d’étage indique où vous êtes et où se trouve l’équipement.',
    },
    {
      en: 'In a real emergency, follow staff instructions and the plans posted on site.',
      fr: 'En situation d’urgence réelle, suivez les consignes du personnel et les plans affichés sur place.',
    },
  ] satisfies L[],
  offline: {
    en: 'This environment runs fully offline: it needs no internet connection and sends nothing anywhere.',
    fr: 'Cet environnement fonctionne entièrement hors ligne : il n’a besoin d’aucune connexion Internet et ne transmet rien.',
  },
  stamp: {
    en: (kind: string, date: string, by: string) => `${kind} · made ${date} by ${by}`,
    fr: (kind: string, date: string, by: string) => `${kind} · produit le ${date} par ${by}`,
  },
  verify: {
    en: 'The virtual environment does not replace an on-site walk-through.',
    fr: 'L’environnement virtuel ne remplace pas une visite sur place.',
  },
};

export async function quickStartPdf(
  d: QuickStartData,
  assets: { fonts: PrintFonts; logo?: Uint8Array },
): Promise<Uint8Array> {
  const Q = QUICK_START;
  const c = await Canvas.create(assets.fonts, {
    title: `${Q.eyebrow.en} — ${d.facility.en}`,
    subject: `${Q.eyebrow.fr} — ${d.facility.fr}`,
  });
  c.doc.setCreator('EVACTIS 3DWORKFLOW');
  const logo = assets.logo ? await c.image(assets.logo) : null;
  for (const lang of ['en', 'fr'] as const) {
    const page = c.page(PAPER.letter.w, PAPER.letter.h);
    const M = 54;
    const cw = page.w - 2 * M;
    page.rect(0, 0, page.w, 8, { fill: C.green });
    let y = M;
    if (logo) {
      const h = 26;
      page.image(logo, M, y, (logo.width / logo.height) * h, h);
      y += h + 26;
    }
    page.line(M, y + 6, M + 22, y + 6, { color: C.green, width: 2 });
    y += page.text(Q.eyebrow[lang].toUpperCase(), M + 30, y, {
      size: 10.5,
      weight: 'bold',
      color: C.greenText,
    });
    y += 6;
    for (const line of c.wrap(d.facility[lang].toUpperCase(), 22, cw, 'extrabold'))
      y += page.text(line, M, y, { size: 22, weight: 'extrabold', color: C.navy });
    y += 4;
    const date = d.createdAt.slice(0, 10);
    y += page.paragraph(Q.stamp[lang](Q.kindName[d.kind][lang], date, d.producer), M, y, cw, {
      size: 10,
      color: C.subtle,
    });
    y += 14;

    // The offline notice, as a panel: it is the promise the product makes.
    const notice = c.wrap(Q.offline[lang], 10.5, cw - 28, 'semibold');
    const nh = notice.length * 10.5 * 1.25 + 18;
    page.rect(M, y, cw, nh, { fill: C.panel, radius: 6 });
    page.rect(M, y, 4, nh, { fill: C.green });
    let ny = y + 9;
    for (const line of notice)
      ny += page.text(line, M + 16, ny, { size: 10.5, weight: 'semibold', color: C.ink });
    y += nh + 20;

    const heading = (s: string) => {
      y += page.text(s, M, y, { size: 13, weight: 'bold', color: C.navy });
      y += 4;
    };
    const bullet = (s: string) => {
      page.rect(M + 2, y + 3.2, 5, 5, { fill: C.green });
      y += page.paragraph(s, M + 16, y, cw - 16, { size: 10.5 });
      y += 5;
    };
    heading(Q.open[lang]);
    y += page.paragraph(Q.how[d.kind][lang], M, y, cw, { size: 10.5 });
    y += 6;
    if (d.encrypted) {
      y += page.paragraph(Q.passphrase[lang], M, y, cw, { size: 10.5, weight: 'semibold' });
      y += 6;
    }
    y += 12;
    heading(Q.moveTitle[lang]);
    for (const b of Q.move) bullet(b[lang]);
    y += 12;
    heading(Q.emergencyTitle[lang]);
    for (const b of Q.emergency) bullet(b[lang]);

    footer(page, M, Q.verify[lang]);
  }
  return c.save();
}

function footer(page: Page, M: number, text: string) {
  const fy = page.h - M - 10;
  page.line(M, fy, page.w - M, fy, { color: C.rule, width: 0.75 });
  page.text(text, page.w / 2, fy + 6, { size: 8.5, align: 'center', color: C.subtle });
}
