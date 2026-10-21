/**
 * The player's own screens, before the Viewer starts: the passphrase prompt of an
 * encrypted package, and the message when a package cannot be opened or has been altered.
 * Built with DOM APIs (no innerHTML) in the brand's dark chrome.
 */
// Exported for the EN/FR guardrail (tools/guardrail/check-i18n.mjs).
export const STRINGS = {
  en: {
    eyebrow: 'Protected environment',
    title: 'Enter the passphrase',
    lead: 'This environment is encrypted. The passphrase was given to you with it; it is never stored.',
    label: 'Passphrase',
    open: 'Open',
    checking: 'Checking…',
    wrong: 'This passphrase does not open the environment. Check it and try again.',
    problem: 'This environment cannot be opened',
    altered: (path: string) =>
      `The file “${path}” failed its integrity check: the package has been altered or damaged. Ask for a fresh copy.`,
    cannotOpen: (e: string) => `Could not open the environment: ${e}`,
    offline: 'Runs fully offline: nothing is sent anywhere.',
  },
  fr: {
    eyebrow: 'Environnement protégé',
    title: 'Entrez la phrase de passe',
    lead: 'Cet environnement est chiffré. La phrase de passe vous a été remise avec lui; elle n’est jamais enregistrée.',
    label: 'Phrase de passe',
    open: 'Ouvrir',
    checking: 'Vérification…',
    wrong: 'Cette phrase de passe n’ouvre pas l’environnement. Vérifiez-la et réessayez.',
    problem: 'Cet environnement ne peut pas être ouvert',
    altered: (path: string) =>
      `Le fichier « ${path} » n’a pas passé le contrôle d’intégrité : le paquet a été modifié ou endommagé. Demandez-en une nouvelle copie.`,
    cannotOpen: (e: string) => `Impossible d’ouvrir l’environnement : ${e}`,
    offline: 'Fonctionne entièrement hors ligne : rien n’est transmis.',
  },
};

export type PlayerStrings = (typeof STRINGS)['en'];

export function playerStrings(lang: string): PlayerStrings {
  return lang.toLowerCase().startsWith('fr') ? STRINGS.fr : STRINGS.en;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function card(stage: HTMLElement, eyebrow: string, title: string): HTMLElement {
  const box = el('section', 'player-card evx-chrome');
  box.setAttribute('aria-labelledby', 'player-card-title');
  const h = el('h1', 'evx-heading player-card__title', title);
  h.id = 'player-card-title';
  box.append(el('p', 'evx-eyebrow', eyebrow), h);
  stage.replaceChildren(box);
  return box;
}

/**
 * Asks until `attempt` accepts the passphrase (returns true); a wrong one says so and
 * asks again. `progress` reports the key derivation (it takes a moment by design).
 */
export function askPassphrase(
  stage: HTMLElement,
  t: PlayerStrings,
  attempt: (passphrase: string, progress: (f: number) => void) => Promise<boolean>,
): Promise<void> {
  const box = card(stage, t.eyebrow, t.title);
  const form = el('form', 'player-unlock');
  const lead = el('p', 'player-card__lead', t.lead);
  const label = el('label', 'player-unlock__label', t.label);
  const input = el('input', 'player-unlock__input');
  input.type = 'password';
  input.id = label.htmlFor = 'player-passphrase';
  input.autocomplete = 'off';
  input.required = true;
  const button = el('button', 'evx-cta', t.open);
  button.type = 'submit';
  const status = el('p', 'player-unlock__status');
  status.setAttribute('role', 'status');
  const offline = el('p', 'player-card__note', t.offline);
  form.append(lead, label, input, button, status);
  box.append(form, offline);
  input.focus();
  return new Promise((done, failed) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      input.disabled = button.disabled = true;
      status.textContent = t.checking;
      status.dataset.state = 'checking';
      attempt(input.value, (f) => (status.textContent = `${t.checking} ${Math.round(f * 100)} %`))
        .then((ok) => {
          if (ok) {
            input.value = '';
            stage.replaceChildren();
            return done();
          }
          input.disabled = button.disabled = false;
          status.textContent = t.wrong;
          status.dataset.state = 'wrong';
          input.select();
        })
        .catch(failed);
    });
  });
}

export function showProblem(stage: HTMLElement, message: string): void {
  const t = playerStrings(document.documentElement.lang || navigator.language);
  const box = card(stage, 'EVACTIS 3DWORKFLOW', t.problem);
  const p = el('p', 'player-card__lead', message);
  p.setAttribute('role', 'alert');
  box.append(p);
}
