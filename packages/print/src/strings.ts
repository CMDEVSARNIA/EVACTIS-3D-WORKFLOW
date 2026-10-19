/**
 * Printed text. Plans are bilingual on one sheet (English then French), as posted in
 * Canadian workplaces; registers use bilingual column headings.
 */
export const PRINT = {
  title: { en: 'Evacuation plan', fr: 'Plan d’évacuation' },
  youAreHere: { en: 'You are here', fr: 'Vous êtes ici' },
  legend: { en: 'Legend', fr: 'Légende' },
  primaryRoute: { en: 'Evacuation route', fr: 'Itinéraire d’évacuation' },
  secondaryRoute: { en: 'Alternative route', fr: 'Itinéraire de rechange' },
  assemblyPoint: { en: 'Assembly point', fr: 'Point de rassemblement' },
  emergency: { en: 'In an emergency', fr: 'En cas d’urgence' },
  follow: {
    en: (to: string) => `Follow the green route to ${to}. Do not use elevators.`,
    fr: (to: string) => `Suivez l’itinéraire vert jusqu’à : ${to}. N’utilisez pas les ascenseurs.`,
  },
  verify: {
    en: (date: string) => `Verify on site before relying on this plan. Printed ${date}.`,
    fr: (date: string) => `Vérifiez sur place avant de vous fier à ce plan. Imprimé le ${date}.`,
  },
  confirmed: {
    en: (by: string, date: string) => `Content confirmed by ${by} on ${date}.`,
    fr: (by: string, date: string) => `Contenu confirmé par ${by} le ${date}.`,
  },
  scale: { en: 'Scale', fr: 'Échelle' },
  north: 'N',
  // Register
  register: { en: 'Equipment register', fr: 'Registre des équipements' },
  page: {
    en: (n: number, of: number) => `Page ${n} of ${of}`,
    fr: (n: number, of: number) => `Page ${n} de ${of}`,
  },
  columns: {
    tag: 'Tag / Étiquette',
    typeEn: 'Type (EN)',
    typeFr: 'Type (FR)',
    name: 'Name / Nom',
    building: 'Building / Bâtiment',
    floor: 'Floor / Étage',
    location: 'Location / Emplacement',
    scenes: 'Seen in / Visible dans',
    lastInspection: 'Last inspection / Dernière inspection',
    nextInspection: 'Next inspection / Prochaine inspection',
    responsible: 'Responsible / Responsable',
    audience: 'Audience / Public',
    sceneLink: 'Scene link / Lien vers la scène',
    confirmedBy: 'Confirmed by / Confirmé par',
    confirmedAt: 'Confirmed on / Confirmé le',
  },
  everyone: 'Everyone / Tous',
  notConfirmed: 'NOT CONFIRMED / NON CONFIRMÉ',
};
