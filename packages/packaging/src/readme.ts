/**
 * README.txt in every package: the stamp, the offline notice and how to open it, in
 * English then French. For packages opened from disk, which features are limited and why.
 */
import { localize, type Environment } from '@evactis-3dworkflow/schema';
import type { PackageKind } from '@evactis-3dworkflow/package-format';

const HOW: Record<PackageKind, { en: string[]; fr: string[] }> = {
  installer: {
    en: [
      'Run the setup file. It installs for the current user (no administrator rights) and adds',
      'a Start menu shortcut named after the facility, which opens this environment directly.',
      'Uninstall it like any program (Settings > Apps).',
    ],
    fr: [
      'Lancez le programme d’installation. Il s’installe pour l’utilisateur courant (sans droits',
      'd’administrateur) et ajoute au menu Démarrer un raccourci au nom de l’établissement, qui',
      'ouvre directement cet environnement. Désinstallez-le comme tout logiciel (Paramètres > Applications).',
    ],
  },
  evx: {
    en: [
      'Double-click the .evx file: it opens in EVACTIS 3DWORKFLOW Viewer (installed separately).',
    ],
    fr: [
      'Double-cliquez sur le fichier .evx : il s’ouvre dans EVACTIS 3DWORKFLOW Viewer (installé à part).',
    ],
  },
  portable: {
    en: [
      'Copy this folder anywhere (a USB key works) and double-click EVACTIS-3DWORKFLOW-Viewer.exe.',
      'Nothing is installed. It needs Microsoft Edge WebView2, which Windows 11 includes; a',
      '"webview2" folder here, when present, carries its own copy for older systems.',
    ],
    fr: [
      'Copiez ce dossier où vous voulez (une clé USB convient) et double-cliquez sur',
      'EVACTIS-3DWORKFLOW-Viewer.exe. Rien n’est installé. Il a besoin de Microsoft Edge WebView2,',
      'inclus dans Windows 11; un dossier « webview2 », s’il est présent, en fournit une copie.',
    ],
  },
  intranet: {
    en: [
      'Copy this folder to an internal web server and open its address in a current browser.',
      'Serve it as static files; index.html carries a strict Content-Security-Policy and the',
      'pages make no request outside this folder.',
    ],
    fr: [
      'Copiez ce dossier sur un serveur Web interne et ouvrez son adresse dans un navigateur récent.',
      'Servez-le comme fichiers statiques; index.html porte une politique de sécurité stricte et',
      'les pages ne font aucune requête hors de ce dossier.',
    ],
  },
  'browser-folder': {
    en: [
      'Open index.html in a current browser (Edge, Chrome or Firefox), straight from the folder.',
    ],
    fr: [
      'Ouvrez index.html dans un navigateur récent (Edge, Chrome ou Firefox), directement depuis le dossier.',
    ],
  },
  'single-file': {
    en: ['Open the HTML file in a current browser. Everything is inside that one file.'],
    fr: ['Ouvrez le fichier HTML dans un navigateur récent. Tout se trouve dans ce seul fichier.'],
  },
  scorm: {
    en: ['Import the ZIP into your LMS (SCORM). Each training module becomes one activity.'],
    fr: [
      'Importez le fichier ZIP dans votre plateforme (SCORM). Chaque module devient une activité.',
    ],
  },
};

/** What is limited when a package is opened from disk (file://), and why. */
const FROM_DISK = {
  en: [
    'Opened from disk, browsers forbid a page from reading neighbouring files, so the',
    'environment travels inside small script files (or the one HTML file). As a result:',
    '- it opens more slowly, and videos are read into memory whole before they play;',
    '- VR headsets are not offered (they need the intranet bundle or the Viewer app);',
    '- the single HTML file keeps panoramas at a reduced resolution to stay small.',
    'Everything else (navigation, safety signs, routes, plans, training) works the same.',
  ],
  fr: [
    'Ouvert depuis le disque, un navigateur interdit à une page de lire les fichiers voisins :',
    'l’environnement voyage donc dans de petits fichiers de script (ou le fichier HTML unique).',
    '- l’ouverture est plus lente et les vidéos sont chargées en mémoire avant de jouer;',
    '- les casques de RV ne sont pas proposés (ensemble intranet ou application Viewer);',
    '- le fichier HTML unique garde les panoramas en résolution réduite pour rester léger.',
    'Tout le reste (navigation, panneaux, itinéraires, plans, formation) fonctionne de même.',
  ],
};

export function readme(
  env: Environment,
  kind: PackageKind,
  createdAt: string,
  producer: string,
  encrypted: boolean,
): string {
  const title = (l: string) => localize(env.title, l);
  const lines: string[] = [];
  for (const l of ['en', 'fr'] as const) {
    const en = l === 'en';
    lines.push(
      `${title(l)} — EVACTIS 3DWORKFLOW`,
      '='.repeat(Math.min(78, title(l).length + 21)),
      '',
      en
        ? 'This environment runs fully offline: it needs no internet connection and sends nothing anywhere.'
        : 'Cet environnement fonctionne entièrement hors ligne : aucune connexion Internet, rien n’est transmis.',
      '',
      en ? `Package: ${kind}` : `Paquet : ${kind}`,
      en ? `Made: ${createdAt} by ${producer}` : `Produit : ${createdAt} par ${producer}`,
      en
        ? 'Integrity: every file is listed with its SHA-256 in evx-manifest.json and checked when it opens.'
        : 'Intégrité : chaque fichier figure avec son SHA-256 dans evx-manifest.json et est vérifié à l’ouverture.',
      '',
      en ? 'Opening it' : 'Pour l’ouvrir',
      '-'.repeat(en ? 10 : 13),
      ...HOW[kind][l],
      '',
    );
    if (encrypted)
      lines.push(
        en
          ? 'This package is encrypted: enter the passphrase you were given. It is never stored.'
          : 'Ce paquet est chiffré : entrez la phrase de passe remise. Elle n’est jamais enregistrée.',
        '',
      );
    if (kind === 'browser-folder' || kind === 'single-file')
      lines.push(
        en ? 'Opened from disk' : 'Ouvert depuis le disque',
        '-'.repeat(en ? 16 : 24),
        ...FROM_DISK[l],
        '',
      );
    lines.push(
      en
        ? 'See "Quick start - Démarrage rapide.pdf" for how to use it.'
        : 'Voir « Quick start - Démarrage rapide.pdf » pour son utilisation.',
      '',
      '',
    );
  }
  return lines.join('\r\n');
}
