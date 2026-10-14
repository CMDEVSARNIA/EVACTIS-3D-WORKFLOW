export const UI = {
  en: {
    panorama: '360° panorama',
    close: 'Close',
    blockedLink: 'This environment runs offline. External links are disabled.',
    unsupported: 'This content type is not available in this viewer yet.',
    correct: 'Correct',
    incorrect: 'Not quite',
    loading: 'Loading',
    question: 'Question',
  },
  fr: {
    panorama: 'Panorama à 360°',
    close: 'Fermer',
    blockedLink: 'Cet environnement fonctionne hors ligne. Les liens externes sont désactivés.',
    unsupported: 'Ce type de contenu n’est pas encore offert dans ce visualiseur.',
    correct: 'Bonne réponse',
    incorrect: 'Pas tout à fait',
    loading: 'Chargement',
    question: 'Question',
  },
} as const;

export type UiLang = keyof typeof UI;
export type UiStrings = (typeof UI)[UiLang];

export function uiStrings(lang: string): UiStrings {
  return lang.startsWith('fr') ? UI.fr : UI.en;
}
