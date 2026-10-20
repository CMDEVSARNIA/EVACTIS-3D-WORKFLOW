/**
 * Administration: environments (upload a .evx, checked on arrival; remove), people
 * (site accounts; network accounts appear after their first sign-in), usage reports
 * (off by default, CSV export, delete) and the certificate authority for client PCs.
 */
import { api, site, type EnvironmentInfo, type Site, type SiteUser } from './api.ts';
import { clear, formatDate, formatSize, h } from './dom.ts';
import { field, say, shell, type Shell } from './shell.ts';
import { localized } from './strings.ts';

type AdminUser = SiteUser & { disabled: boolean };

/** Upload with progress (fetch has no upload progress). */
function upload(file: File, onProgress: (p: number) => void): Promise<EnvironmentInfo> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', '/api/environments');
    x.setRequestHeader('x-evx', '1');
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) =>
      e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 99));
    x.onload = () => {
      const body = JSON.parse(x.responseText || '{}') as EnvironmentInfo & { error?: string };
      if (x.status === 200) resolve(body);
      else reject(new Error(body.error ?? x.statusText));
    };
    x.onerror = () => reject(new Error('upload failed'));
    x.send(file);
  });
}

async function environments(s: Shell, box: HTMLElement) {
  const { t, lang } = s;
  const envs = await api<EnvironmentInfo[]>('GET', '/api/environments');
  const status = h('p', {});
  const progress = h('progress', { max: 100, value: 0, hidden: true });
  const file = h('input', { type: 'file', accept: '.evx', id: 'evx-file' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    progress.hidden = false;
    try {
      await upload(f, (p) => {
        progress.value = p;
        say(status, t.uploading(p));
      });
      say(status, t.uploaded);
      await environments(s, box);
    } catch (e) {
      progress.hidden = true;
      say(status, (e as Error).message, true);
    }
  });
  clear(
    box,
    h('h2', {}, t.environments),
    field(t.upload, file, t.uploadHint),
    progress,
    status,
    h(
      'table',
      { class: 'site-table' },
      h(
        'tbody',
        {},
        ...envs.map((e) =>
          h(
            'tr',
            {},
            h(
              'td',
              {},
              h('strong', {}, localized(e.title, lang)),
              e.encrypted ? ` · ${t.encrypted}` : '',
            ),
            h(
              'td',
              { class: 'site-meta' },
              `${formatSize(e.size, lang)} · ${formatDate(e.uploadedAt, lang)}`,
            ),
            h(
              'td',
              {},
              h(
                'button',
                {
                  type: 'button',
                  class: 'evx-cta evx-cta--ghost site-small',
                  onclick: async () => {
                    if (!confirm(t.removeConfirm)) return;
                    await api('DELETE', `/api/environments/${e.id}`);
                    await environments(s, box);
                  },
                },
                t.remove,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

async function people(s: Shell, box: HTMLElement, me: SiteUser) {
  const { t } = s;
  const users = await api<AdminUser[]>('GET', '/api/users');
  const status = h('p', {});
  const username = h('input', { required: true, autocomplete: 'off' });
  const name = h('input', {});
  const password = h('input', {
    type: 'password',
    required: true,
    minlength: '10',
    autocomplete: 'new-password',
  });
  const role = h(
    'select',
    {},
    h('option', { value: 'member' }, t.roles.member),
    h('option', { value: 'admin' }, t.roles.admin),
  );
  const refresh = () => people(s, box, me);
  clear(
    box,
    h('h2', {}, t.users),
    h(
      'table',
      { class: 'site-table' },
      h(
        'tbody',
        {},
        ...users.map((u) =>
          h(
            'tr',
            {},
            h(
              'td',
              {},
              h('strong', {}, u.name),
              h('br'),
              h('span', { class: 'site-meta' }, `${u.username} · ${t.sources[u.source]}`),
            ),
            h('td', {}, u.disabled ? t.disabled : t.roles[u.role]),
            h(
              'td',
              {},
              u.id === me.id
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      class: 'evx-cta evx-cta--ghost site-small',
                      onclick: async () => {
                        await api('PATCH', `/api/users/${u.id}`, { disabled: !u.disabled });
                        await refresh();
                      },
                    },
                    u.disabled ? t.enable : t.disable,
                  ),
              ' ',
              u.source === 'local'
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'evx-cta evx-cta--ghost site-small',
                      onclick: async () => {
                        const p = prompt(`${t.resetPassword} (${u.username}) — ${t.passwordHint}`);
                        if (!p) return;
                        try {
                          await api('POST', `/api/users/${u.id}/password`, { password: p });
                          say(status, t.saved);
                        } catch (e) {
                          say(status, (e as Error).message, true);
                        }
                      },
                    },
                    t.resetPassword,
                  )
                : null,
            ),
          ),
        ),
      ),
    ),
    h('h2', {}, t.addUser),
    h(
      'form',
      {
        class: 'site-form',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            await api('POST', '/api/users', {
              username: username.value,
              displayName: name.value,
              password: password.value,
              role: role.value,
            });
            await refresh();
          } catch (err) {
            say(status, (err as Error).message, true);
          }
        },
      },
      field(t.username, username),
      field(t.displayName, name),
      field(t.password, password, t.passwordHint),
      field(t.role, role),
      h('button', { type: 'submit', class: 'evx-cta site-small' }, t.create),
    ),
    status,
  );
}

async function reports(s: Shell, box: HTMLElement) {
  const { t } = s;
  const r = await api<{ enabled: boolean; events: number }>('GET', '/api/admin/reports');
  const on = h('input', { type: 'checkbox', checked: r.enabled, id: 'reports-on' });
  on.addEventListener('change', async () => {
    await api('PUT', '/api/admin/reports', { enabled: on.checked });
    await reports(s, box);
  });
  const from = h('input', { type: 'date' });
  const to = h('input', { type: 'date' });
  clear(
    box,
    h('h2', {}, t.reports),
    h('p', { class: 'site-lead' }, t.reportsLead),
    h('label', { class: 'site-check', for: 'reports-on' }, on, t.reportsOn),
    h('p', { class: 'site-meta', 'data-testid': 'report-count' }, t.events(r.events)),
    h(
      'div',
      { class: 'site-row' },
      field(t.from, from),
      field(t.to, to),
      h(
        'button',
        {
          type: 'button',
          class: 'evx-cta site-small',
          onclick: () => {
            const q = new URLSearchParams();
            if (from.value) q.set('from', from.value);
            if (to.value) q.set('to', to.value);
            location.href = `/api/admin/reports.csv?${q}`;
          },
        },
        t.exportCsv,
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'evx-cta evx-cta--ghost site-small',
          onclick: async () => {
            if (!confirm(t.clearConfirm)) return;
            await api('DELETE', '/api/admin/reports');
            await reports(s, box);
          },
        },
        t.clearReports,
      ),
    ),
  );
}

function certificate(s: Shell, box: HTMLElement) {
  const { t } = s;
  clear(
    box,
    h('h2', {}, t.certificate),
    h('p', { class: 'site-lead' }, t.certificateLead),
    h(
      'a',
      { class: 'evx-cta evx-cta--ghost site-small', href: '/ca.pem', download: '' },
      t.downloadCa,
    ),
  );
}

async function start() {
  const info: Site = await site();
  if (info.user?.role !== 'admin') {
    location.href = '/';
    return;
  }
  shell(
    info,
    (s) => {
      const boxes = [0, 1, 2, 3].map(() => h('section', {}));
      clear(
        s.main,
        h('p', { class: 'evx-eyebrow' }, info.siteName),
        h('h1', { class: 'evx-heading' }, s.t.admin),
        ...boxes,
      );
      void environments(s, boxes[0]!);
      void people(s, boxes[1]!, info.user!);
      void reports(s, boxes[2]!);
      certificate(s, boxes[3]!);
    },
    (t) => [h('a', { href: '/', class: 'site-link' }, t.back)],
  );
}

void start();
