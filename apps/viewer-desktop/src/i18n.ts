export const STRINGS = {
  en: {
    eyebrow: 'Safe plans . Clear paths',
    title: 'See the space. Understand the plan.',
    empty: 'No environment is open. Double-click a .evx file, or open one here.',
    offline: 'This environment runs fully offline. Nothing is sent over the network.',
    toolbar: 'Viewer controls',
    language: 'Français',
    version: 'Version',
    open: 'Open an environment…',
    pickTitle: 'Open an EVACTIS 3DWORKFLOW environment',
    pickFilter: 'EVACTIS 3DWORKFLOW Environment',
  },
  fr: {
    eyebrow: 'Plans sûrs . Chemins clairs',
    title: 'Voyez l’espace. Comprenez le plan.',
    empty:
      'Aucun environnement n’est ouvert. Double-cliquez sur un fichier .evx ou ouvrez-en un ici.',
    offline:
      'Cet environnement fonctionne entièrement hors ligne. Rien n’est transmis sur le réseau.',
    toolbar: 'Commandes du visualiseur',
    language: 'English',
    version: 'Version',
    open: 'Ouvrir un environnement…',
    pickTitle: 'Ouvrir un environnement EVACTIS 3DWORKFLOW',
    pickFilter: 'Environnement EVACTIS 3DWORKFLOW',
  },
} as const;

export type Lang = keyof typeof STRINGS;
export type StringKey = keyof (typeof STRINGS)['en'];

export function detectLang(nav: { language?: string } = navigator): Lang {
  return nav.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
