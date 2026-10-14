export const STRINGS = {
  en: {
    eyebrow: 'Safe plans . Clear paths',
    heading: 'Build the environment. Ship the plan.',
    lead: 'Author interactive facility environments — tours, safety equipment, evacuation routes and training — and deliver them to run entirely offline.',
    newProject: 'New project',
    openProject: 'Open project…',
    comingSoon: 'Project editing arrives in a later phase.',
    offlineTitle: 'Zero cloud exposure',
    offline: [
      'Runs on this computer with no cloud service or internet connection.',
      'Facility data never leaves the machine unless you package and hand it over.',
      'Deliverables work on any storage medium, including air-gapped setups.',
    ],
    about: 'About',
    theme: 'Switch light/dark',
    language: 'Français',
    aboutTitle: 'About EVACTIS 3DWORKFLOW Studio',
    version: 'Version',
    publisher: 'Publisher',
    identifier: 'Identifier',
    aboutOffline:
      'This application makes no network requests: no telemetry, no update checks, no online fonts or services.',
    licenses: 'Third-party licences are listed in licenses.md in the installation folder.',
    close: 'Close',
  },
  fr: {
    eyebrow: 'Plans sûrs . Chemins clairs',
    heading: 'Bâtissez l’environnement. Livrez le plan.',
    lead: 'Créez des environnements interactifs d’installations — visites, équipements de sécurité, itinéraires d’évacuation et formation — et livrez-les pour un fonctionnement entièrement hors ligne.',
    newProject: 'Nouveau projet',
    openProject: 'Ouvrir un projet…',
    comingSoon: 'L’édition de projets arrive dans une phase ultérieure.',
    offlineTitle: 'Aucune exposition au nuage',
    offline: [
      'Fonctionne sur cet ordinateur sans service infonuagique ni connexion Internet.',
      'Les données de l’installation ne quittent jamais l’appareil, sauf si vous les emballez et les remettez.',
      'Les livrables fonctionnent sur tout support de stockage, y compris en environnement isolé.',
    ],
    about: 'À propos',
    theme: 'Basculer clair/sombre',
    language: 'English',
    aboutTitle: 'À propos d’EVACTIS 3DWORKFLOW Studio',
    version: 'Version',
    publisher: 'Éditeur',
    identifier: 'Identifiant',
    aboutOffline:
      'Cette application n’effectue aucune requête réseau : aucune télémétrie, aucune vérification de mise à jour, aucune police ni aucun service en ligne.',
    licenses:
      'Les licences des tiers sont énumérées dans licenses.md, dans le dossier d’installation.',
    close: 'Fermer',
  },
} as const;

export type Lang = keyof typeof STRINGS;
export type Strings = (typeof STRINGS)[Lang];

export function detectLang(nav: { language?: string } = navigator): Lang {
  return nav.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
