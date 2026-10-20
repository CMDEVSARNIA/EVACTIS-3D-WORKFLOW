/** Package dialog strings (EN/FR), merged into STRINGS as `t.packaging` (i18n.ts). */
export const PACKAGING = {
  en: {
    open: 'Package…',
    title: 'Package the environment',
    lead: 'Everything is made on this computer. Every package runs fully offline, checks its files at launch and carries a quick-start guide.',
    kindLabel: 'Package type',
    kinds: {
      installer: {
        name: 'Windows installer',
        hint: 'The 3DWORKFLOW Viewer with this environment. Installs like a program, with a Start menu shortcut named after the facility.',
      },
      evx: {
        name: '.evx environment file',
        hint: 'One file for computers that already have the 3DWORKFLOW Viewer. Double-click to open.',
      },
      portable: {
        name: 'Portable viewer',
        hint: 'A folder with the Viewer and the environment. Runs from a USB drive with a double-click, nothing installed.',
      },
      intranet: {
        name: 'Intranet bundle',
        hint: 'Static files for your own web server, with a strict security policy and no outside requests.',
      },
      'browser-folder': {
        name: 'Browser folder',
        hint: 'Opens index.html straight from a disk or shared drive. Some features are limited (see README).',
      },
      'single-file': {
        name: 'Single HTML file',
        hint: 'One file for small environments; panoramas capped at 2048 px per cube face.',
      },
      scorm: {
        name: 'SCORM package',
        hint: 'For a learning management system: training results are reported to it.',
      },
    },
    missing: {
      viewer: 'Unavailable: the 3DWORKFLOW Viewer program is not bundled with this Studio.',
      nsis: 'Unavailable: the installer builder (NSIS) is not bundled with this Studio.',
    },
    name: 'Name',
    nameHint: 'File or folder name; the installer’s shortcut uses the facility name.',
    scormVersion: 'SCORM version',
    kiosk: 'Kiosk deployment (larger buttons, no full-screen switch)',
    webview2Installer:
      'Include the Microsoft WebView2 Runtime for PCs that lack it (installed only where missing; about 180 MB more)',
    needsWebView2:
      'Runs on PCs that already have the Microsoft WebView2 Runtime (built into Windows 11 and updated Windows 10).',
    encrypt: 'Encrypt with a passphrase',
    encryptHint:
      'AES-256 with an Argon2id key. Without the passphrase nobody can open the environment, and it cannot be recovered: keep it somewhere safe.',
    passphrase: 'Passphrase',
    passphraseAgain: 'Passphrase again',
    tooShort: 'At least 8 characters.',
    noMatch: 'The two passphrases differ.',
    folder: 'Save in',
    chooseFolder: 'Choose folder…',
    noFolder: 'No folder chosen',
    folderTitle: 'Choose where to save the package',
    estimating: 'Estimating size…',
    estimate: (size: string) => `About ${size}.`,
    tooLarge: (size: string) =>
      `This file would be about ${size}: browsers open files this large slowly, or not at all on some devices. A browser folder or an intranet bundle suits larger environments.`,
    anyway: 'Make it anyway',
    unconfirmed: (n: number) =>
      n === 1
        ? '1 safety item is not confirmed: it is left out of the package until someone confirms it on the Safety tab.'
        : `${n} safety items are not confirmed: they are left out of the package until someone confirms them on the Safety tab.`,
    make: 'Make package',
    close: 'Close',
    steps: {
      files: (done: number, total: number) => `Packing files: ${done} of ${total}…`,
      runtime: () => 'Adding the WebView2 runtime…',
      installer: () => 'Building the installer…',
    },
    done: (path: string) => `Package ready: ${path}`,
    unsigned:
      'The installer is not code-signed yet: sign it at the signing station before delivery (see the delivery guide).',
    exists: (path: string) =>
      `${path} already exists. Choose another name or folder: packages never overwrite earlier work.`,
    failed: 'The package could not be made: ',
  },
  fr: {
    open: 'Empaqueter…',
    title: 'Empaqueter l’environnement',
    lead: 'Tout est produit sur cet ordinateur. Chaque paquet fonctionne entièrement hors ligne, vérifie ses fichiers au lancement et contient un guide de démarrage rapide.',
    kindLabel: 'Type de paquet',
    kinds: {
      installer: {
        name: 'Programme d’installation Windows',
        hint: 'Le visualiseur 3DWORKFLOW avec cet environnement. S’installe comme un programme, avec un raccourci du menu Démarrer au nom de l’installation.',
      },
      evx: {
        name: 'Fichier d’environnement .evx',
        hint: 'Un seul fichier pour les ordinateurs qui ont déjà le visualiseur 3DWORKFLOW. Double-cliquez pour l’ouvrir.',
      },
      portable: {
        name: 'Visualiseur portable',
        hint: 'Un dossier avec le visualiseur et l’environnement. Fonctionne depuis une clé USB par double-clic, sans installation.',
      },
      intranet: {
        name: 'Ensemble intranet',
        hint: 'Des fichiers statiques pour votre propre serveur web, avec une politique de sécurité stricte et aucune requête externe.',
      },
      'browser-folder': {
        name: 'Dossier pour navigateur',
        hint: 'Ouvre index.html directement depuis un disque ou un lecteur partagé. Certaines fonctions sont limitées (voir LISEZMOI).',
      },
      'single-file': {
        name: 'Fichier HTML unique',
        hint: 'Un seul fichier pour les petits environnements; panoramas limités à 2048 px par face de cube.',
      },
      scorm: {
        name: 'Paquet SCORM',
        hint: 'Pour un système de gestion de l’apprentissage : les résultats de formation lui sont transmis.',
      },
    },
    missing: {
      viewer:
        'Indisponible : le programme du visualiseur 3DWORKFLOW n’est pas fourni avec ce Studio.',
      nsis: 'Indisponible : le générateur d’installation (NSIS) n’est pas fourni avec ce Studio.',
    },
    name: 'Nom',
    nameHint:
      'Nom du fichier ou du dossier; le raccourci de l’installation utilise le nom de l’installation.',
    scormVersion: 'Version SCORM',
    kiosk: 'Déploiement en borne (boutons plus grands, pas de plein écran)',
    webview2Installer:
      'Inclure l’environnement d’exécution Microsoft WebView2 pour les PC qui ne l’ont pas (installé seulement s’il manque; environ 180 Mo de plus)',
    needsWebView2:
      'Fonctionne sur les PC qui ont déjà l’environnement d’exécution Microsoft WebView2 (intégré à Windows 11 et à Windows 10 à jour).',
    encrypt: 'Chiffrer avec une phrase secrète',
    encryptHint:
      'AES-256 avec une clé Argon2id. Sans la phrase secrète, personne ne peut ouvrir l’environnement, et elle ne peut pas être récupérée : conservez-la en lieu sûr.',
    passphrase: 'Phrase secrète',
    passphraseAgain: 'Phrase secrète (confirmation)',
    tooShort: 'Au moins 8 caractères.',
    noMatch: 'Les deux phrases secrètes diffèrent.',
    folder: 'Enregistrer dans',
    chooseFolder: 'Choisir un dossier…',
    noFolder: 'Aucun dossier choisi',
    folderTitle: 'Choisir où enregistrer le paquet',
    estimating: 'Estimation de la taille…',
    estimate: (size: string) => `Environ ${size}.`,
    tooLarge: (size: string) =>
      `Ce fichier ferait environ ${size} : les navigateurs ouvrent lentement les fichiers aussi volumineux, voire pas du tout sur certains appareils. Un dossier pour navigateur ou un ensemble intranet convient mieux aux grands environnements.`,
    anyway: 'Le produire quand même',
    unconfirmed: (n: number) =>
      n === 1
        ? '1 élément de sécurité n’est pas confirmé : il est exclu du paquet jusqu’à sa confirmation dans l’onglet Sécurité.'
        : `${n} éléments de sécurité ne sont pas confirmés : ils sont exclus du paquet jusqu’à leur confirmation dans l’onglet Sécurité.`,
    make: 'Produire le paquet',
    close: 'Fermer',
    steps: {
      files: (done: number, total: number) => `Emballage des fichiers : ${done} sur ${total}…`,
      runtime: () => 'Ajout de l’environnement d’exécution WebView2…',
      installer: () => 'Création du programme d’installation…',
    },
    done: (path: string) => `Paquet prêt : ${path}`,
    unsigned:
      'Le programme d’installation n’est pas encore signé : signez-le au poste de signature avant la livraison (voir le guide de livraison).',
    exists: (path: string) =>
      `${path} existe déjà. Choisissez un autre nom ou dossier : un paquet n’écrase jamais un travail antérieur.`,
    failed: 'Impossible de produire le paquet : ',
  },
};
