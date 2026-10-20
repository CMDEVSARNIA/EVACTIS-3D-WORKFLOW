/**
 * An environment on the Site Server: the 3DWORKFLOW Viewer (files read from the server,
 * each checked against the package manifest and, for encrypted packages, decrypted in
 * this browser), with the site panel: shared notes and guided sessions. With usage
 * reports on (site setting), scene views and module completions are recorded locally.
 */
import '@evactis-3dworkflow/brand/tokens.css';
import '@evactis-3dworkflow/brand/fonts.css';
import '@evactis-3dworkflow/brand/chrome.css';
import '@evactis-3dworkflow/viewer/player.css';
import './style.css';
import './view.css';
import { openPackage } from '@evactis-3dworkflow/viewer/open-package';
import { api, site, type SiteUser } from './api.ts';
import { h } from './dom.ts';
import { LiveChannel } from './live.ts';
import { NotesLayer, type Person } from './notes.ts';
import { GuidedSessions } from './session.ts';
import { STRINGS, language } from './strings.ts';

declare global {
  interface Window {
    evxSite?: { notes: NotesLayer; sessions: GuidedSessions; live: LiveChannel };
  }
}

async function start() {
  const id = decodeURIComponent(location.pathname.split('/').pop() ?? '');
  const info = await site();
  if (!info.user) {
    location.href = '/';
    return;
  }
  const user: SiteUser = info.user;
  const lang = language();
  const t = STRINGS[lang];
  document.documentElement.lang = lang;

  const stage = h('div', { class: 'player-stage site-stage', id: 'stage' });
  const notesBox = h('div', {
    class: 'site-tabpanel',
    id: 'panel-notes',
    role: 'tabpanel',
    'aria-labelledby': 'tab-notes',
  });
  const sessionBox = h('div', {
    class: 'site-tabpanel',
    id: 'panel-session',
    role: 'tabpanel',
    'aria-labelledby': 'tab-session',
    hidden: true,
  });
  const live = h('p', { class: 'site-meta site-live', role: 'status' });
  const tab = (key: 'notes' | 'session', label: string, box: HTMLElement, other: HTMLElement) =>
    h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `tab-${key}`,
        'aria-controls': box.id,
        'aria-selected': key === 'notes' ? 'true' : 'false',
        onclick: (e: Event) => {
          box.hidden = false;
          other.hidden = true;
          for (const b of (e.currentTarget as HTMLElement).parentElement!.children)
            b.setAttribute('aria-selected', String(b === e.currentTarget));
        },
      },
      label,
    );
  const panel = h(
    'aside',
    { class: 'site-panel', 'aria-label': t.panel, id: 'site-panel', 'data-open': 'true' },
    h(
      'div',
      { class: 'site-tabs', role: 'tablist' },
      tab('notes', t.notes, notesBox, sessionBox),
      tab('session', t.session, sessionBox, notesBox),
    ),
    live,
    notesBox,
    sessionBox,
  );
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'site-panel-toggle evx-cta site-small',
      'aria-controls': 'site-panel',
      'aria-expanded': 'true',
      onclick: () => {
        const open = panel.dataset.open !== 'true';
        panel.dataset.open = String(open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? t.hidePanel : t.showPanel;
      },
    },
    t.hidePanel,
  );
  document.body.replaceChildren(stage, toggle, panel);

  const base = `/api/environments/${encodeURIComponent(id)}/files/`;
  const viewer = await openPackage({
    stage,
    language: lang,
    read: async (path) => {
      const r = await fetch(base + path.split('/').map(encodeURIComponent).join('/'), {
        credentials: 'same-origin',
      });
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  });

  const channel = new LiveChannel();
  channel.onState = (ok) => (live.textContent = ok ? '' : t.reconnecting);
  channel.send({ t: 'watch', environmentId: id }, true);
  const people = await api<Person[]>('GET', '/api/users');
  const notes = new NotesLayer({
    viewer,
    environmentId: id,
    me: user,
    people,
    categories: info.categories,
    statuses: info.statuses,
    live: channel,
    panel: notesBox,
    t,
    lang,
  });
  await notes.load();
  const sessions = new GuidedSessions({
    viewer,
    live: channel,
    panel: sessionBox,
    t,
    user,
    relayOnly: new URLSearchParams(location.search).has('relay'),
  });
  window.evxSite = { notes, sessions, live: channel };

  // Local usage reports: only when the administrator turned them on.
  if (info.reports) {
    const record = (body: Record<string, unknown>) =>
      void api('POST', '/api/reports/events', { environmentId: id, ...body }).catch(
        () => undefined,
      );
    if (viewer.sceneId) record({ kind: 'scene-view', sceneId: viewer.sceneId });
    viewer.on('scenechange', ({ sceneId }) => record({ kind: 'scene-view', sceneId }));
    viewer.on('modulecomplete', (r) =>
      record({ kind: 'module-complete', moduleId: r.moduleId, score: r.percent, passed: r.passed }),
    );
  }
  document.body.dataset.site = 'ready';
}

start().catch((e: unknown) => {
  document.body.dataset.site = 'error';
  console.error(e);
});
