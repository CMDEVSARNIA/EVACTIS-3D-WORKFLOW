/**
 * The Windows installation guide that ships in the release kit: a branded letter PDF,
 * one per language. Who needs which program, system requirements, which installer to
 * use, how to check the signature, the setup wizard step by step, opening a facility,
 * updates and removal, silent and managed installs for IT, and troubleshooting.
 * A test-signed build gets a "not for delivery" banner and says what Windows will show.
 */
import type { RGB } from 'pdf-lib';
import { C, Canvas, PAPER, type Page, type PrintFonts, type Weight } from './canvas.ts';

export type GuideLang = 'en' | 'fr';

export interface InstallGuideData {
  lang: GuideLang;
  /** Product version, e.g. "1.0.0". */
  version: string;
  /** ISO date printed on the guide. */
  date: string;
  /** The installers carry the CI test certificate, not Evactis's. */
  testSigned?: boolean;
}

type L = { en: string; fr: string };

type Block =
  | { p: L }
  | { steps: L[] }
  | { bullets: L[] }
  | { table: { head: L[]; rows: L[][]; widths: number[] } }
  | { code: string[] }
  | { note: L; tone: 'info' | 'warn' };

const same = (s: string): L => ({ en: s, fr: s });
const setup = 'EVACTIS-3DWORKFLOW-Viewer-{v}-x64-setup.exe';
const msi = 'EVACTIS-3DWORKFLOW-Viewer-{v}-x64-en-US.msi';

export const INSTALL_GUIDE = {
  eyebrow: { en: 'Windows installation guide', fr: 'Guide d’installation Windows' },
  title: { en: 'Installing EVACTIS 3DWORKFLOW', fr: 'Installer EVACTIS 3DWORKFLOW' },
  subtitle: {
    en: 'Studio and Viewer {v} · Windows 10 and Windows 11',
    fr: 'Studio et Viewer {v} · Windows 10 et Windows 11',
  },
  tagline: {
    en: 'Safe plans. Clear paths.',
    fr: 'Des plans sûrs. Des parcours clairs.',
  },
  offline: {
    en: 'Runs entirely on your own computers. No internet connection is needed to install or use it, there is no account to create, and nothing is ever sent anywhere.',
    fr: 'Fonctionne entièrement sur vos propres ordinateurs. Aucune connexion Internet n’est nécessaire pour l’installer ou l’utiliser, aucun compte n’est à créer et rien n’est jamais transmis.',
  },
  testBanner: {
    en: 'TEST BUILD, NOT FOR DELIVERY. These installers carry a test certificate. Windows will say the publisher is unknown or untrusted. Use them only to try the software; the delivered release is signed by Evactis.',
    fr: 'VERSION D’ESSAI, NE PAS LIVRER. Ces programmes d’installation portent un certificat de test. Windows indiquera un éditeur inconnu ou non approuvé. Utilisez-les seulement pour essayer le logiciel; la version livrée est signée par Evactis.',
  },
  contents: { en: 'In this guide', fr: 'Dans ce guide' },
  footer: {
    en: 'EVACTIS 3DWORKFLOW {v} · Windows installation guide · {d}',
    fr: 'EVACTIS 3DWORKFLOW {v} · Guide d’installation Windows · {d}',
  },
  page: { en: 'Page {n} of {t}', fr: 'Page {n} de {t}' },
};

const SECTIONS: { title: L; blocks: (testSigned: boolean) => Block[] }[] = [
  {
    title: { en: 'Before you start', fr: 'Avant de commencer' },
    blocks: () => [
      {
        p: {
          en: 'EVACTIS 3DWORKFLOW has two Windows programs. Most people only need the Viewer.',
          fr: 'EVACTIS 3DWORKFLOW comprend deux programmes Windows. La plupart des gens n’ont besoin que du Viewer.',
        },
      },
      {
        table: {
          widths: [0.3, 0.7],
          head: [
            { en: 'Program', fr: 'Programme' },
            { en: 'For', fr: 'Pour' },
          ],
          rows: [
            [
              same('3DWORKFLOW Viewer'),
              {
                en: 'Everyone who explores a facility: staff, contractors, leadership and first responders.',
                fr: 'Toute personne qui explore un établissement : personnel, entrepreneurs, direction et premiers intervenants.',
              },
            ],
            [
              same('3DWORKFLOW Studio'),
              {
                en: 'Evactis staff who build facility environments.',
                fr: 'Le personnel d’Evactis qui construit les environnements des établissements.',
              },
            ],
          ],
        },
      },
      {
        table: {
          widths: [0.22, 0.4, 0.38],
          head: [
            { en: 'System', fr: 'Système' },
            { en: 'Minimum', fr: 'Minimum' },
            { en: 'Recommended', fr: 'Recommandé' },
          ],
          rows: [
            [
              same('Windows'),
              {
                en: 'Windows 10 22H2 or Windows 11, 64-bit',
                fr: 'Windows 10 22H2 ou Windows 11, 64 bits',
              },
              same('Windows 11, 64-bit'),
            ],
            [
              { en: 'Memory', fr: 'Mémoire' },
              { en: '8 GB', fr: '8 Go' },
              { en: '16 GB for Studio', fr: '16 Go pour Studio' },
            ],
            [
              { en: 'Graphics', fr: 'Graphisme' },
              { en: 'WebGL2-capable', fr: 'Compatible WebGL2' },
              {
                en: 'Dedicated graphics card for large 3D scenes',
                fr: 'Carte graphique dédiée pour les grandes scènes 3D',
              },
            ],
            [
              { en: 'Disk space', fr: 'Espace disque' },
              {
                en: 'About 350 MB free during setup; about 30 MB once installed',
                fr: 'Environ 350 Mo libres pendant l’installation; environ 30 Mo une fois installé',
              },
              {
                en: 'Plus about 500 MB if the WebView2 Runtime has to be added',
                fr: 'Plus environ 500 Mo si le WebView2 Runtime doit être ajouté',
              },
            ],
          ],
        },
      },
      {
        tone: 'info',
        note: {
          en: 'You can disconnect from the network before you start: installing needs no download.',
          fr: 'Vous pouvez vous déconnecter du réseau avant de commencer : l’installation ne télécharge rien.',
        },
      },
    ],
  },
  {
    title: { en: 'Choose your installer', fr: 'Choisir le programme d’installation' },
    blocks: () => [
      {
        table: {
          widths: [0.46, 0.54],
          head: [
            { en: 'File', fr: 'Fichier' },
            { en: 'Use it when', fr: 'À utiliser quand' },
          ],
          rows: [
            [
              same(setup),
              {
                en: 'You install on one computer. With or without administrator rights; the wizard is in English and French.',
                fr: 'Vous installez sur un seul ordinateur. Avec ou sans droits d’administrateur; l’assistant est en anglais et en français.',
              },
            ],
            [
              same(`${msi}\nEVACTIS-3DWORKFLOW-Viewer-{v}-x64-fr-FR.msi`),
              {
                en: 'Your IT team deploys to many computers (Group Policy, Intune, Configuration Manager). Needs administrator rights; see section 7.',
                fr: 'Votre équipe informatique déploie sur plusieurs ordinateurs (stratégie de groupe, Intune, Configuration Manager). Exige des droits d’administrateur; voir la section 7.',
              },
            ],
          ],
        },
      },
      {
        p: {
          en: 'Studio installs the same way: its files carry "Studio" instead of "Viewer".',
          fr: 'Studio s’installe de la même façon : ses fichiers portent « Studio » au lieu de « Viewer ».',
        },
      },
    ],
  },
  {
    title: { en: 'Check that the file is genuine', fr: 'Vérifier que le fichier est authentique' },
    blocks: (testSigned) => [
      {
        steps: [
          {
            en: 'Right-click the setup file and select Properties.',
            fr: 'Cliquez avec le bouton droit sur le programme d’installation, puis sur Propriétés.',
          },
          {
            en: 'Open the Digital Signatures tab.',
            fr: 'Ouvrez l’onglet Signatures numériques.',
          },
          testSigned
            ? {
                en: 'The signer is "Evactis (TEST - not for distribution)". Windows reports that the certificate is not trusted: expected for a test build.',
                fr: 'Le signataire est « Evactis (TEST - not for distribution) ». Windows indique que le certificat n’est pas approuvé : c’est normal pour une version d’essai.',
              }
            : {
                en: 'The signer must be "Evactis". Select it, then Details: Windows must say "This digital signature is OK."',
                fr: 'Le signataire doit être « Evactis ». Sélectionnez-le, puis Détails : Windows doit indiquer « Cette signature numérique est correcte. »',
              },
        ],
      },
      testSigned
        ? {
            tone: 'warn',
            note: {
              en: 'Do not add the test certificate to your computer’s trusted certificates. When Windows SmartScreen says "Windows protected your PC", select More info, check the file name, then Run anyway.',
              fr: 'N’ajoutez pas le certificat de test aux certificats approuvés de votre ordinateur. Lorsque Windows SmartScreen affiche « Windows a protégé votre ordinateur », sélectionnez Informations complémentaires, vérifiez le nom du fichier, puis Exécuter quand même.',
            },
          }
        : {
            tone: 'warn',
            note: {
              en: 'If there is no Digital Signatures tab, or the signer is anyone other than Evactis, do not run the file. Contact Evactis.',
              fr: 'S’il n’y a pas d’onglet Signatures numériques, ou si le signataire n’est pas Evactis, ne lancez pas le fichier. Communiquez avec Evactis.',
            },
          },
      {
        p: {
          en: 'The release kit also lists the SHA-256 of every file in SHA256SUMS.txt. IT staff can compare it with the result of Get-FileHash in PowerShell.',
          fr: 'La trousse de publication donne aussi le SHA-256 de chaque fichier dans SHA256SUMS.txt. L’équipe informatique peut le comparer au résultat de Get-FileHash dans PowerShell.',
        },
      },
    ],
  },
  {
    title: { en: 'Install', fr: 'Installer' },
    blocks: () => [
      {
        steps: [
          { en: `Double-click ${setup}.`, fr: `Double-cliquez sur ${setup}.` },
          {
            en: 'Choose English or Français, then select OK.',
            fr: 'Choisissez English ou Français, puis sélectionnez OK.',
          },
          {
            en: 'Select Next on the welcome page. Read the licence agreement and select I Agree.',
            fr: 'Sélectionnez Suivant sur la page d’accueil. Lisez le contrat de licence et sélectionnez J’accepte.',
          },
          {
            en: 'Choose who can use the program. "Install just for me" needs no administrator rights. "Install for anyone using this computer" needs them, and Windows asks for permission: check that it names Evactis as the verified publisher, then select Yes.',
            fr: 'Choisissez qui pourra utiliser le programme. L’installation pour vous seulement n’exige aucun droit d’administrateur. L’installation pour tous les utilisateurs de l’ordinateur les exige, et Windows demande l’autorisation : vérifiez que l’éditeur vérifié est Evactis, puis sélectionnez Oui.',
          },
          {
            en: 'Keep the suggested folder and the Start menu folder "EVACTIS 3DWORKFLOW", then select Install.',
            fr: 'Gardez le dossier proposé et le dossier du menu Démarrer « EVACTIS 3DWORKFLOW », puis sélectionnez Installer.',
          },
          {
            en: 'On the last page, tick "Create desktop shortcut" if you want one, then select Finish.',
            fr: 'Sur la dernière page, cochez « Créer un raccourci sur le bureau » si vous en voulez un, puis sélectionnez Terminer.',
          },
        ],
      },
      {
        tone: 'info',
        note: {
          en: 'The programs display through the Microsoft Edge WebView2 Runtime, already present on Windows 11 and most Windows 10 computers. If it is missing, setup installs it from its own copy, without downloading anything. This takes a minute longer.',
          fr: 'Les programmes s’affichent grâce au Microsoft Edge WebView2 Runtime, déjà présent sous Windows 11 et sur la plupart des ordinateurs Windows 10. S’il manque, l’installation l’ajoute à partir de sa propre copie, sans rien télécharger. Cela prend une minute de plus.',
        },
      },
      {
        p: {
          en: 'Start the program from Start › EVACTIS 3DWORKFLOW › 3DWORKFLOW Viewer.',
          fr: 'Lancez le programme depuis Démarrer › EVACTIS 3DWORKFLOW › 3DWORKFLOW Viewer.',
        },
      },
    ],
  },
  {
    title: { en: 'Open your facility', fr: 'Ouvrir votre établissement' },
    blocks: () => [
      {
        p: {
          en: 'Evactis delivers each facility in one of these forms:',
          fr: 'Evactis livre chaque établissement sous l’une de ces formes :',
        },
      },
      {
        bullets: [
          {
            en: 'An .evx file: double-click it. The Viewer opens it and checks every file before showing anything.',
            fr: 'Un fichier .evx : double-cliquez dessus. Le Viewer l’ouvre et vérifie chaque fichier avant d’afficher quoi que ce soit.',
          },
          {
            en: 'A facility setup ("<facility> Setup.exe"): run it as in section 4. It adds a Start menu shortcut "Evactis – <facility>" and needs no administrator rights.',
            fr: 'Un programme d’installation de l’établissement (« <établissement> Setup.exe ») : lancez-le comme à la section 4. Il ajoute au menu Démarrer un raccourci « Evactis – <établissement> » et n’exige aucun droit d’administrateur.',
          },
          {
            en: 'A portable folder: copy it anywhere, even a USB key, and double-click EVACTIS-3DWORKFLOW-Viewer.exe inside it. Nothing is installed.',
            fr: 'Un dossier portable : copiez-le où vous voulez, même sur une clé USB, et double-cliquez sur EVACTIS-3DWORKFLOW-Viewer.exe dans ce dossier. Rien n’est installé.',
          },
        ],
      },
      {
        p: {
          en: 'A protected environment asks for its passphrase. Evactis gives it to you separately. It is case-sensitive and cannot be recovered.',
          fr: 'Un environnement protégé demande sa phrase de passe. Evactis vous la remet séparément. Elle tient compte des majuscules et ne peut pas être récupérée.',
        },
      },
      {
        tone: 'warn',
        note: {
          en: 'If the Viewer says the environment failed its integrity check, the file was changed or damaged on the way. Do not use it: copy it again from the original medium.',
          fr: 'Si le Viewer indique que l’environnement a échoué à la vérification d’intégrité, le fichier a été modifié ou endommagé en chemin. Ne l’utilisez pas : copiez-le de nouveau depuis le support d’origine.',
        },
      },
    ],
  },
  {
    title: { en: 'Update and uninstall', fr: 'Mettre à jour et désinstaller' },
    blocks: () => [
      {
        bullets: [
          {
            en: 'There are no automatic updates and no update checks. Evactis delivers each new version as new installers: run the newer one and it replaces the old version, keeping your settings. An older installer is refused.',
            fr: 'Il n’y a ni mise à jour automatique ni recherche de mises à jour. Evactis livre chaque nouvelle version sous forme de nouveaux programmes d’installation : lancez le plus récent et il remplace l’ancienne version en gardant vos réglages. Un programme d’installation plus ancien est refusé.',
          },
          {
            en: 'To uninstall: Settings › Apps › Installed apps › EVACTIS 3DWORKFLOW Viewer › Uninstall. The setup version offers "Delete the application data" (settings and cache).',
            fr: 'Pour désinstaller : Paramètres › Applications › Applications installées › EVACTIS 3DWORKFLOW Viewer › Désinstaller. La version installée par le programme d’installation .exe offre « Supprimer les données de l’application » (réglages et cache).',
          },
          {
            en: 'Studio projects in Documents\\EVACTIS 3DWORKFLOW are never deleted.',
            fr: 'Les projets Studio dans Documents\\EVACTIS 3DWORKFLOW ne sont jamais supprimés.',
          },
        ],
      },
    ],
  },
  {
    title: {
      en: 'For IT: silent and managed installs',
      fr: 'Pour l’équipe informatique : installations silencieuses et gérées',
    },
    blocks: () => [
      {
        code: [
          `msiexec /i ${msi} /qn /norestart /l*v viewer-install.log`,
          `msiexec /x ${msi} /qn /norestart`,
          `${setup} /S /AllUsers`,
          `${setup} /S /CurrentUser`,
        ],
      },
      {
        bullets: [
          {
            en: 'The MSI installs for all users in C:\\Program Files\\EVACTIS\\3DWORKFLOW\\Viewer; choose another folder with INSTALLDIR="…". The setup ignores /D= in silent installs.',
            fr: 'Le MSI installe pour tous les utilisateurs dans C:\\Program Files\\EVACTIS\\3DWORKFLOW\\Viewer; choisissez un autre dossier avec INSTALLDIR="…". Le programme d’installation ignore /D= en mode silencieux.',
          },
          {
            en: 'Per-user installs go to %LOCALAPPDATA%\\Programs\\EVACTIS\\3DWORKFLOW\\Viewer.',
            fr: 'Les installations par utilisateur vont dans %LOCALAPPDATA%\\Programs\\EVACTIS\\3DWORKFLOW\\Viewer.',
          },
          {
            en: 'Group Policy: assign the MSI from a share. Intune: line-of-business app. Configuration Manager: Windows Installer deployment type. Detection: the MSI product code.',
            fr: 'Stratégie de groupe : attribuez le MSI depuis un partage. Intune : application métier. Configuration Manager : type de déploiement Windows Installer. Détection : le code de produit du MSI.',
          },
          {
            en: 'AppLocker and WDAC: one publisher rule for "Evactis" covers every program, including the FFmpeg that Studio carries.',
            fr: 'AppLocker et WDAC : une seule règle d’éditeur pour « Evactis » couvre tous les programmes, y compris le FFmpeg inclus dans Studio.',
          },
          {
            en: 'Firewall: no rules are needed. Outbound traffic from Studio and the Viewer can be blocked entirely.',
            fr: 'Pare-feu : aucune règle n’est nécessaire. Le trafic sortant de Studio et du Viewer peut être entièrement bloqué.',
          },
        ],
      },
      {
        p: {
          en: 'Full details are in the IT deployment guide (docs/it-deployment.md) in the release kit.',
          fr: 'Tous les détails figurent dans le guide de déploiement informatique (docs/it-deployment.md) de la trousse de publication.',
        },
      },
    ],
  },
  {
    title: { en: 'Troubleshooting', fr: 'Dépannage' },
    blocks: (testSigned) => [
      {
        table: {
          widths: [0.36, 0.64],
          head: [
            { en: 'Problem', fr: 'Problème' },
            { en: 'What to do', fr: 'Que faire' },
          ],
          rows: [
            [
              { en: '"Windows protected your PC"', fr: '« Windows a protégé votre ordinateur »' },
              testSigned
                ? {
                    en: 'Expected for a test build: select More info, then Run anyway.',
                    fr: 'Normal pour une version d’essai : sélectionnez Informations complémentaires, puis Exécuter quand même.',
                  }
                : {
                    en: 'Check the signature (section 3). SmartScreen can warn about a recently issued certificate. If the signer is Evactis, select More info, then Run anyway.',
                    fr: 'Vérifiez la signature (section 3). SmartScreen peut avertir au sujet d’un certificat récent. Si le signataire est Evactis, sélectionnez Informations complémentaires, puis Exécuter quand même.',
                  },
            ],
            [
              {
                en: 'Blank window when the program starts',
                fr: 'Fenêtre vide au démarrage du programme',
              },
              {
                en: 'The WebView2 Runtime is missing or damaged. Look for "Microsoft Edge WebView2 Runtime" in Settings › Apps, or run the setup again.',
                fr: 'Le WebView2 Runtime manque ou est endommagé. Cherchez « Microsoft Edge WebView2 Runtime » dans Paramètres › Applications, ou relancez le programme d’installation.',
              },
            ],
            [
              {
                en: '"A newer version is already installed"',
                fr: '« Une version plus récente est déjà installée »',
              },
              {
                en: 'The installer is older than the installed program. Use the newest installer.',
                fr: 'Le programme d’installation est plus ancien que le programme installé. Utilisez le plus récent.',
              },
            ],
            [
              { en: 'Passphrase refused', fr: 'Phrase de passe refusée' },
              {
                en: 'Check upper and lower case. A lost passphrase cannot be recovered: ask Evactis for a new package.',
                fr: 'Vérifiez les majuscules et les minuscules. Une phrase de passe perdue ne peut pas être récupérée : demandez un nouveau paquet à Evactis.',
              },
            ],
            [
              { en: 'Integrity check failed', fr: 'Échec de la vérification d’intégrité' },
              {
                en: 'Copy the environment again from the original medium.',
                fr: 'Copiez de nouveau l’environnement depuis le support d’origine.',
              },
            ],
            [
              { en: 'Self-test for IT', fr: 'Autotest pour l’informatique' },
              same('EVACTIS-3DWORKFLOW-Viewer.exe --smoke-test report.json'),
            ],
          ],
        },
      },
    ],
  },
];

/** Every text the guide can print, for the font-coverage and translation tests. */
export function installGuideTexts(lang: GuideLang): string[] {
  const out: string[] = [];
  const G = INSTALL_GUIDE;
  for (const k of [
    'eyebrow',
    'title',
    'subtitle',
    'tagline',
    'offline',
    'testBanner',
    'contents',
    'footer',
    'page',
  ] as const)
    out.push(G[k][lang]);
  for (const s of SECTIONS) {
    out.push(s.title[lang]);
    for (const b of [...s.blocks(false), ...s.blocks(true)]) {
      if ('p' in b) out.push(b.p[lang]);
      else if ('steps' in b) out.push(...b.steps.map((x) => x[lang]));
      else if ('bullets' in b) out.push(...b.bullets.map((x) => x[lang]));
      else if ('table' in b)
        out.push(...b.table.head.map((x) => x[lang]), ...b.table.rows.flat().map((x) => x[lang]));
      else if ('code' in b) out.push(...b.code);
      else out.push(b.note[lang]);
    }
  }
  return out;
}

const M = 54;
const TOP = 46; // content starts below the running header
const BOTTOM = 60; // room for the footer
const BODY = 10.5;

export async function installGuidePdf(
  d: InstallGuideData,
  assets: { fonts: PrintFonts; logo: Uint8Array },
): Promise<{ pdf: Uint8Array; pages: number; minFontPt: number }> {
  const G = INSTALL_GUIDE;
  const { lang } = d;
  const fill = (s: string) => s.replaceAll('{v}', d.version).replaceAll('{d}', d.date);
  const c = await Canvas.create(assets.fonts, {
    title: `${fill(G.title[lang])} — ${G.eyebrow[lang]}`,
    subject: fill(G.subtitle[lang]),
  });
  c.doc.setCreator('EVACTIS 3DWORKFLOW');
  c.doc.setLanguage(lang === 'en' ? 'en-CA' : 'fr-CA');
  const logo = await c.image(assets.logo);
  const W = PAPER.letter.w;
  const H = PAPER.letter.h;
  const cw = W - 2 * M;
  const pages: Page[] = [];

  const newPage = (cover: boolean): Page => {
    const p = c.page(W, H);
    pages.push(p);
    p.rect(0, 0, W, 8, { fill: C.green });
    if (!cover) {
      const h = 13;
      p.image(logo, M, 22, (logo.width / logo.height) * h, h);
      p.text(G.eyebrow[lang].toUpperCase(), W - M, 24, {
        size: 8.5,
        weight: 'bold',
        color: C.greenText,
        align: 'right',
      });
    }
    return p;
  };

  // ---------------------------------------------------------------- cover
  let page = newPage(true);
  let y = 64;
  const lh = 34;
  page.image(logo, M, y, (logo.width / logo.height) * lh, lh);
  y += lh + 70;
  page.line(M, y + 6, M + 22, y + 6, { color: C.green, width: 2 });
  y += page.text(G.eyebrow[lang].toUpperCase(), M + 30, y, {
    size: 11,
    weight: 'bold',
    color: C.greenText,
  });
  y += 8;
  for (const line of c.wrap(fill(G.title[lang]).toUpperCase(), 30, cw, 'extrabold'))
    y += page.text(line, M, y, { size: 30, weight: 'extrabold', color: C.navy });
  y += 6;
  y += page.text(fill(G.subtitle[lang]), M, y, { size: 13, weight: 'semibold', color: C.ink });
  y += 4;
  y += page.text(G.tagline[lang], M, y, { size: 11, color: C.subtle });
  y += 26;
  y = panel(page, c, y, G.offline[lang], C.green, C.panel);
  if (d.testSigned) {
    y += 14;
    y = panel(page, c, y, G.testBanner[lang], C.red, C.white, C.red);
  }
  y += 34;
  y += page.text(G.contents[lang], M, y, { size: 13, weight: 'bold', color: C.navy });
  y += 6;
  SECTIONS.forEach((s, i) => {
    page.rect(M + 2, y + 3.2, 5, 5, { fill: C.green });
    y += page.text(`${i + 1}. ${s.title[lang]}`, M + 16, y, { size: BODY });
    y += 3;
  });

  // ---------------------------------------------------------------- sections
  page = newPage(false);
  y = TOP + 18;
  const room = (h: number) => {
    if (y + h > H - BOTTOM) {
      page = newPage(false);
      y = TOP + 18;
    }
  };
  const para = (
    s: string,
    x: number,
    max: number,
    weight: Weight = 'regular',
    color: RGB = C.ink,
  ) => {
    const lines = c.wrap(s, BODY, max, weight);
    for (const line of lines) {
      room(BODY * 1.35);
      page.text(line, x, y, { size: BODY, weight, color });
      y += BODY * 1.35;
    }
  };
  const height = (s: string, max: number, size = BODY, weight: Weight = 'regular') =>
    c.wrap(s, size, max, weight).length * size * 1.35;

  const stepsHeight = (steps: L[]) =>
    steps.reduce((h, st) => h + height(fill(st[lang]), cw - 28) + 8.5, 0);

  SECTIONS.forEach((s, i) => {
    const blocks = s.blocks(!!d.testSigned);
    // Keep a heading with the start of what follows it (a whole short list of steps).
    const first = blocks[0]!;
    const steps = 'steps' in first ? stepsHeight(first.steps) : 0;
    room(40 + (steps && steps < 300 ? steps : 'table' in first ? 90 : 40));
    if (y > TOP + 18) y += 14;
    page.text(String(i + 1).padStart(2, '0'), M, y, {
      size: 13,
      weight: 'extrabold',
      color: C.green,
    });
    y += page.text(s.title[lang], M + 26, y, { size: 13, weight: 'bold', color: C.navy });
    page.line(M, y + 2, W - M, y + 2, { color: C.rule, width: 0.75 });
    y += 12;

    for (const b of blocks) {
      if ('p' in b) {
        para(fill(b.p[lang]), M, cw);
        y += 8;
      } else if ('steps' in b) {
        // A short list of steps stays on one page.
        const all = stepsHeight(b.steps);
        if (all < 300) room(all);
        b.steps.forEach((st, n) => {
          const text = fill(st[lang]);
          room(Math.min(height(text, cw - 28), 40));
          const r = 8.5;
          page.rect(M, y, 2 * r, 2 * r, { fill: C.navy, radius: r });
          page.text(String(n + 1), M + r, y + 3.2, {
            size: 9,
            weight: 'bold',
            color: C.white,
            align: 'center',
          });
          y += 1.5;
          para(text, M + 28, cw - 28);
          y += 7;
        });
        y += 4;
      } else if ('bullets' in b) {
        for (const bl of b.bullets) {
          const text = fill(bl[lang]);
          room(Math.min(height(text, cw - 16), 40));
          page.rect(M + 2, y + 3.4, 5, 5, { fill: C.green });
          para(text, M + 16, cw - 16);
          y += 6;
        }
        y += 4;
      } else if ('code' in b) {
        const size = 8.5;
        const lines = b.code.flatMap((l) => c.wrap(fill(l), size, cw - 24, 'semibold'));
        const h = lines.length * size * 1.5 + 16;
        room(h);
        page.rect(M, y, cw, h, { fill: C.surfaceDark });
        let cy = y + 9;
        for (const l of lines) {
          page.text(l, M + 12, cy, { size, weight: 'semibold', color: C.white });
          cy += size * 1.5;
        }
        y += h + 12;
      } else if ('note' in b) {
        const accent = b.tone === 'warn' ? C.red : C.navy;
        const h = height(b.note[lang], cw - 30, BODY, 'semibold') + 18;
        room(h);
        y = panel(page, c, y, fill(b.note[lang]), accent, C.panel) + 12;
      } else {
        const t = b.table;
        const cols = t.widths.map((f) => f * cw);
        const pad = 6;
        const size = 9.5;
        const cell = (s: string, i: number, weight: Weight) =>
          c.wrap(fill(s), size, cols[i]! - 2 * pad, weight);
        const drawRow = (cells: string[], head: boolean) => {
          const weight: Weight = head ? 'bold' : 'regular';
          const wrapped = cells.map((s, i) => cell(s, i, i === 0 && !head ? 'semibold' : weight));
          const h = Math.max(...wrapped.map((l) => l.length)) * size * 1.35 + 2 * pad;
          return { wrapped, h, head };
        };
        const head = drawRow(
          t.head.map((x) => x[lang]),
          true,
        );
        const paint = (r: ReturnType<typeof drawRow>) => {
          if (r.head) page.rect(M, y, cw, r.h, { fill: C.navy });
          let x = M;
          r.wrapped.forEach((lines, i) => {
            let ty = y + pad;
            for (const l of lines) {
              page.text(l, x + pad, ty, {
                size,
                weight: r.head ? 'bold' : i === 0 ? 'semibold' : 'regular',
                color: r.head ? C.white : C.ink,
              });
              ty += size * 1.35;
            }
            x += cols[i]!;
          });
          y += r.h;
          if (!r.head) page.line(M, y, M + cw, y, { color: C.rule, width: 0.75 });
        };
        room(head.h + 60); // the header and at least one row
        paint(head);
        for (const row of t.rows) {
          const r = drawRow(
            row.map((x) => x[lang]),
            false,
          );
          if (y + r.h > H - BOTTOM) {
            room(H); // new page, then repeat the header
            paint(head);
          }
          paint(r);
        }
        y += 14;
      }
    }
  });

  // ---------------------------------------------------------------- footers
  pages.forEach((p, i) => {
    const fy = H - 40;
    p.line(M, fy, W - M, fy, { color: C.rule, width: 0.75 });
    p.text(fill(G.footer[lang]), M, fy + 7, { size: 8, color: C.subtle });
    p.text(
      G.page[lang].replace('{n}', String(i + 1)).replace('{t}', String(pages.length)),
      W - M,
      fy + 7,
      { size: 8, color: C.subtle, align: 'right' },
    );
  });
  return { pdf: await c.save(), pages: pages.length, minFontPt: c.minFontPt };
}

/** A note panel with a coloured bar on the left; returns the y below it. */
function panel(
  page: Page,
  c: Canvas,
  y: number,
  text: string,
  accent: RGB,
  bg: RGB,
  textColor: RGB = C.ink,
): number {
  const cw = page.w - 2 * M;
  const lines = c.wrap(text, BODY, cw - 30, 'semibold');
  const h = lines.length * BODY * 1.35 + 18;
  page.rect(M, y, cw, h, { fill: bg, ...(bg === C.white && { stroke: accent, width: 1.5 }) });
  page.rect(M, y, 4, h, { fill: accent });
  let ty = y + 9;
  for (const l of lines) {
    page.text(l, M + 18, ty, { size: BODY, weight: 'semibold', color: textColor });
    ty += BODY * 1.35;
  }
  return y + h;
}
