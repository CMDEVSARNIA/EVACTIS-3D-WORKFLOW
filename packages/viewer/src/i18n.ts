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
    tag: 'Tag:',
    lastInspection: 'Last inspection:',
    nextInspection: 'Next inspection:',
    evacuationRoute: 'Evacuation route',
    primaryRoute: 'Evacuation route',
    secondaryRoute: 'Alternative route',
    follow: (to: string) => `Follow the green arrows to ${to}.`,
    reached: (to: string) => `You have reached ${to}. Report to your floor warden.`,
    offRoute: 'This location is not on this route. Open the floor plan to find it.',
    noRoute: 'No evacuation route has been set for this location.',
    alternativeRoute: 'Alternative route',
    mainRoute: 'Main route',
    floorPlan: 'Floor plan',
    closeRoute: 'Close route',
    assemblyPoint: 'the assembly point',
    youAreHere: 'You are here',
    legend: 'Legend',
    floors: 'Floors',
    noPlan: 'No floor plan is available for this floor.',
    audience: 'Audience',
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
    tag: 'Étiquette :',
    lastInspection: 'Dernière inspection :',
    nextInspection: 'Prochaine inspection :',
    evacuationRoute: 'Itinéraire d’évacuation',
    primaryRoute: 'Itinéraire d’évacuation',
    secondaryRoute: 'Itinéraire de rechange',
    follow: (to: string) => `Suivez les flèches vertes jusqu’à : ${to}.`,
    reached: (to: string) =>
      `Vous êtes arrivé : ${to}. Présentez-vous à votre responsable d’étage.`,
    offRoute: 'Cet endroit n’est pas sur cet itinéraire. Ouvrez le plan d’étage pour le trouver.',
    noRoute: 'Aucun itinéraire d’évacuation n’a été défini pour cet endroit.',
    alternativeRoute: 'Itinéraire de rechange',
    mainRoute: 'Itinéraire principal',
    floorPlan: 'Plan d’étage',
    closeRoute: 'Fermer l’itinéraire',
    assemblyPoint: 'le point de rassemblement',
    youAreHere: 'Vous êtes ici',
    legend: 'Légende',
    floors: 'Étages',
    noPlan: 'Aucun plan n’est offert pour cet étage.',
    audience: 'Public',
  },
};

export type UiLang = keyof typeof UI;
/** Both languages share one shape; English defines it. */
export type UiStrings = (typeof UI)['en'];
const _frMatches: UiStrings = UI.fr;
void _frMatches;

export function uiStrings(lang: string): UiStrings {
  return lang.startsWith('fr') ? UI.fr : UI.en;
}
