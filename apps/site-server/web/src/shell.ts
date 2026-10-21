/**
 * The frame every Site Server page shares: the website-style header bar (product
 * lockup, language, sign out) over the dark chrome, and the offline notice at the foot.
 */
import '@evactis-3dworkflow/brand/tokens.css';
import '@evactis-3dworkflow/brand/fonts.css';
import '@evactis-3dworkflow/brand/chrome.css';
import './style.css';
import lockup from '@evactis-3dworkflow/brand/product-lockup.svg?url';
import { api, type Site } from './api.ts';
import { h } from './dom.ts';
import { STRINGS, language, setLanguage, type Lang, type Strings } from './strings.ts';

export interface Shell {
  lang: Lang;
  t: Strings;
  main: HTMLElement;
}

export function shell(
  site: Site | null,
  render: (s: Shell) => void,
  extra?: (t: Strings) => Node[],
): void {
  const draw = () => {
    const lang = language();
    const t = STRINGS[lang];
    document.documentElement.lang = lang;
    const main = h('main', { class: 'site-main', id: 'main' });
    const signOut = site?.user
      ? h(
          'button',
          {
            type: 'button',
            class: 'site-link',
            onclick: async () => {
              await api('POST', '/api/logout').catch(() => undefined);
              location.href = '/';
            },
          },
          t.signOut,
        )
      : null;
    document.body.replaceChildren(
      h(
        'header',
        { class: 'evx-topbar site-top' },
        h(
          'a',
          { href: '/', class: 'site-home' },
          h('img', { src: lockup, alt: 'EVACTIS 3DWORKFLOW', class: 'site-lockup' }),
        ),
        h(
          'nav',
          { class: 'site-nav', 'aria-label': t.product },
          ...(extra?.(t) ?? []),
          site?.user ? h('span', { class: 'site-user' }, site.user.name) : null,
          h(
            'button',
            {
              type: 'button',
              class: 'site-link',
              lang: lang === 'en' ? 'fr' : 'en',
              onclick: () => {
                setLanguage(lang === 'en' ? 'fr' : 'en');
                draw();
              },
            },
            t.language,
          ),
          signOut,
        ),
      ),
      main,
      h('footer', { class: 'site-foot' }, h('p', { role: 'note' }, t.offline)),
    );
    render({ lang, t, main });
  };
  document.body.classList.add('evx-chrome');
  draw();
}

/** A labelled form field. */
export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = input.id || `f-${Math.random().toString(36).slice(2)}`;
  input.id = id;
  return h(
    'div',
    { class: 'site-field' },
    h('label', { for: id }, label),
    input,
    hint ? h('p', { class: 'site-hint' }, hint) : null,
  );
}

/** A status line: errors are announced as alerts, other messages politely. */
export function say(el: HTMLElement, text: string, error = false): void {
  el.textContent = text;
  el.setAttribute('role', error ? 'alert' : 'status');
  el.classList.toggle('site-error', error);
}

interface Question {
  t: Strings;
  /** The question, also the dialog's accessible name. */
  text: string;
  /** The confirming button ("Remove", "Save"…). */
  ok: string;
  /** Asks for a value as well (e.g. a new password). */
  input?: { label: string; hint?: string; type?: string; minLength?: number };
}

/**
 * An in-page question instead of the browser's confirm()/prompt(), which cannot be
 * styled, translated or reliably used with assistive technology. A native modal
 * <dialog> keeps focus inside and closes on Escape. Resolves to true (or the typed
 * value), or null when cancelled.
 */
export function ask(q: Question): Promise<string | true | null> {
  return new Promise((resolve) => {
    const input = q.input
      ? h('input', {
          type: q.input.type ?? 'text',
          required: true,
          minLength: q.input.minLength,
          autocomplete: q.input.type === 'password' ? 'new-password' : 'off',
        })
      : null;
    const dialog = h('dialog', { class: 'site-dialog', 'aria-label': q.text });
    const form = h(
      'form',
      { method: 'dialog', class: 'site-form' },
      h('p', { class: 'site-dialog-text' }, q.text),
      input && q.input ? field(q.input.label, input, q.input.hint) : null,
      h(
        'div',
        { class: 'site-dialog-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'evx-cta evx-cta--ghost site-small',
            onclick: () => dialog.close('cancel'),
          },
          q.t.cancel,
        ),
        h('button', { type: 'submit', value: 'ok', class: 'evx-cta site-small' }, q.ok),
      ),
    );
    dialog.append(form);
    dialog.addEventListener('close', () => {
      const ok = dialog.returnValue === 'ok';
      dialog.remove();
      resolve(ok ? (input ? input.value : true) : null);
    });
    document.body.append(dialog);
    dialog.showModal();
    (input ?? form.querySelector<HTMLButtonElement>('button[type="submit"]'))?.focus();
  });
}
