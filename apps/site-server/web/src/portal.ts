/**
 * Start page: first-time setup, sign-in, then the site's environments (with how many
 * guided sessions are running in each) and the account's password.
 */
import { ApiError, api, site, type EnvironmentInfo, type Site } from './api.ts';
import { clear, formatDate, formatSize, h } from './dom.ts';
import { field, say, shell, type Shell } from './shell.ts';
import { localized } from './strings.ts';

const input = (props: Record<string, string | boolean>) => h('input', { class: '', ...props });

function setup(s: Shell, info: Site) {
  const { t, main } = s;
  const status = h('p', {});
  const code = input({ name: 'code', required: true, autocomplete: 'off' });
  const username = input({ name: 'username', required: true, autocomplete: 'username' });
  const name = input({ name: 'displayName', autocomplete: 'name' });
  const password = input({
    name: 'password',
    type: 'password',
    required: true,
    autocomplete: 'new-password',
    minlength: '10',
  });
  const form = h(
    'form',
    {
      class: 'site-form',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        try {
          await api('POST', '/api/setup', {
            code: code.value,
            username: username.value,
            displayName: name.value,
            password: password.value,
          });
          location.reload();
        } catch (err) {
          say(status, (err as Error).message, true);
        }
      },
    },
    field(t.setupCode, code),
    field(t.username, username),
    field(t.displayName, name),
    field(t.password, password, t.passwordHint),
    h('button', { type: 'submit', class: 'evx-cta' }, t.create),
    status,
  );
  clear(
    main,
    h('p', { class: 'evx-eyebrow' }, info.siteName),
    h('h1', { class: 'evx-heading' }, t.setupTitle),
    h('p', { class: 'site-lead' }, t.setupLead),
    form,
  );
}

function signIn(s: Shell, info: Site) {
  const { t, main } = s;
  const status = h('p', {});
  const username = input({ name: 'username', required: true, autocomplete: 'username' });
  const password = input({
    name: 'password',
    type: 'password',
    required: true,
    autocomplete: 'current-password',
  });
  clear(
    main,
    h('p', { class: 'evx-eyebrow' }, t.eyebrow),
    h('h1', { class: 'evx-heading' }, info.siteName),
    h(
      'form',
      {
        class: 'site-form',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            await api('POST', '/api/login', { username: username.value, password: password.value });
            location.reload();
          } catch (err) {
            say(status, (err as Error).message, true);
          }
        },
      },
      field(t.username, username, info.directory ? t.directoryHint : undefined),
      field(t.password, password),
      h('button', { type: 'submit', class: 'evx-cta' }, t.signIn),
      status,
    ),
  );
}

async function home(s: Shell, info: Site) {
  const { t, lang, main } = s;
  const envs = await api<EnvironmentInfo[]>('GET', '/api/environments');
  const counts = await Promise.all(
    envs.map((e) =>
      api<unknown[]>('GET', `/api/environments/${e.id}/sessions`).then(
        (x) => x.length,
        () => 0,
      ),
    ),
  );
  const list = envs.length
    ? h(
        'ul',
        { class: 'site-cards' },
        ...envs.map((e, i) =>
          h(
            'li',
            { class: 'site-card' },
            h('h3', {}, localized(e.title, lang)),
            h(
              'p',
              { class: 'site-meta' },
              `${formatSize(e.size, lang)} · ${formatDate(e.uploadedAt, lang)}`,
            ),
            e.encrypted ? h('p', {}, t.encrypted) : null,
            counts[i] ? h('p', { class: 'site-meta' }, t.liveSessions(counts[i]!)) : null,
            h('a', { class: 'evx-cta', href: `/view/${encodeURIComponent(e.id)}` }, t.open),
          ),
        ),
      )
    : h('p', {}, t.noEnvironments);

  const status = h('p', {});
  const current = input({ type: 'password', autocomplete: 'current-password', required: true });
  const next = input({
    type: 'password',
    autocomplete: 'new-password',
    required: true,
    minlength: '10',
  });
  const passwordForm =
    info.user!.source === 'local'
      ? h(
          'form',
          {
            class: 'site-form',
            onsubmit: async (e: Event) => {
              e.preventDefault();
              try {
                await api('POST', `/api/users/${info.user!.id}/password`, {
                  current: current.value,
                  password: next.value,
                });
                // Changing the password signs every session out, this one too.
                location.reload();
              } catch (err) {
                say(status, (err as Error).message, true);
              }
            },
          },
          field(t.currentPassword, current),
          field(t.newPassword, next, t.passwordHint),
          h('button', { type: 'submit', class: 'evx-cta evx-cta--ghost site-small' }, t.save),
          status,
        )
      : null;

  clear(
    main,
    h('p', { class: 'evx-eyebrow' }, info.siteName),
    h('h1', { class: 'evx-heading' }, t.environments),
    list,
    passwordForm ? h('h2', {}, t.changePassword) : null,
    passwordForm,
  );
}

async function start() {
  let info: Site | null = null;
  try {
    info = await site();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  shell(
    info,
    (s) => {
      if (!info) return;
      if (info.setup) setup(s, info);
      else if (!info.user) signIn(s, info);
      else void home(s, info);
    },
    (t) =>
      info?.user?.role === 'admin' ? [h('a', { href: '/admin', class: 'site-link' }, t.admin)] : [],
  );
}

void start();
