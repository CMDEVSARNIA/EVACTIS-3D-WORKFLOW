/**
 * Shared notes in the viewer page: pins drawn over the scene where each note was left,
 * a list (filtered by status) that takes you to a note, the note itself with its status,
 * assignee, photos and replies, and "Add a note" by clicking the place in the scene.
 * Everything typed is shown as text. Changes from other people arrive live.
 */
import type { Viewer } from '@evactis-3dworkflow/viewer/open-package';
import { api, type SiteUser } from './api.ts';
import { clear, formatDate, h } from './dom.ts';
import type { LiveChannel } from './live.ts';
import { field, say } from './shell.ts';
import { localized, type Lang, type Strings } from './strings.ts';

export interface Person {
  id: string;
  name: string;
}
export interface Note {
  id: string;
  sceneId: string;
  yaw: number;
  pitch: number;
  category: string;
  title: string;
  body: string;
  status: string;
  assignee: Person | null;
  author: Person;
  createdAt: string;
  updatedAt: string;
  replies: { id: string; author: Person; body: string; createdAt: string }[];
  photos: { id: string; type: string; size: number; replyId: string | null }[];
}

type View =
  | { kind: 'list' }
  | { kind: 'note'; id: string }
  | { kind: 'placing' }
  | { kind: 'new'; sceneId: string; yaw: number; pitch: number };

export class NotesLayer {
  private notes = new Map<string, Note>();
  private overlay: HTMLElement;
  private view: View = { kind: 'list' };
  private filter = 'open';
  private frame = 0;
  private off: (() => void)[] = [];

  constructor(
    private o: {
      viewer: Viewer;
      environmentId: string;
      me: SiteUser;
      people: Person[];
      categories: string[];
      statuses: string[];
      live: LiveChannel;
      panel: HTMLElement;
      t: Strings;
      lang: Lang;
    },
  ) {
    this.overlay = h('div', { class: 'site-pins', 'data-testid': 'note-pins' });
    o.viewer.element.append(this.overlay);
    const redraw = () => this.schedule();
    this.off.push(
      o.viewer.on('viewchange', redraw),
      o.viewer.on('scenechange', redraw),
      o.viewer.on('panoramaclick', (e) => {
        if (this.view.kind !== 'placing') return;
        const sceneId = o.viewer.sceneId;
        if (!sceneId) return;
        this.show({ kind: 'new', sceneId, yaw: e.yaw, pitch: e.pitch });
      }),
      o.live.on('note', (m) => {
        if (m.action === 'deleted') this.notes.delete(String(m.id));
        else {
          const n = m.note as Note;
          this.notes.set(n.id, n);
        }
        this.schedule();
        // Refresh what is on screen unless the reader is typing a new note.
        if (
          this.view.kind === 'list' ||
          (this.view.kind === 'note' && this.notes.has(this.view.id))
        )
          this.render();
        else if (this.view.kind === 'note') this.show({ kind: 'list' });
      }),
    );
    addEventListener('resize', redraw);
  }

  async load(): Promise<void> {
    const list = await api<Note[]>('GET', `/api/environments/${this.o.environmentId}/notes`);
    this.notes = new Map(list.map((n) => [n.id, n]));
    this.schedule();
    this.render();
  }

  private sceneName(id: string): string {
    const s = this.o.viewer.scenes.find((x) => x.id === id);
    return s ? localized(s.name, this.o.lang) : id;
  }

  // ---------------------------------------------------------------- pins
  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.drawPins();
    });
  }

  private drawPins() {
    const scene = this.o.viewer.sceneId;
    const pins: HTMLElement[] = [];
    for (const n of this.notes.values()) {
      if (n.sceneId !== scene) continue;
      const at = this.o.viewer.viewToScreen(n.yaw, n.pitch);
      if (!at) continue;
      pins.push(
        h(
          'button',
          {
            type: 'button',
            class: 'site-pin',
            'data-status': n.status,
            'data-category': n.category,
            'data-note': n.id,
            style: `left:${at.x}px;top:${at.y}px`,
            'aria-label': `${this.o.t.categories[n.category] ?? n.category}: ${n.title}`,
            title: n.title,
            onclick: (e: Event) => {
              e.stopPropagation();
              this.show({ kind: 'note', id: n.id });
            },
          },
          h('span', { 'aria-hidden': 'true' }, h('b', {}, '!')),
        ),
      );
    }
    this.overlay.replaceChildren(...pins);
  }

  // ---------------------------------------------------------------- panel
  show(v: View): void {
    this.view = v;
    this.o.viewer.element.classList.toggle('site-placing', v.kind === 'placing');
    this.render();
  }

  private render() {
    const v = this.view;
    if (v.kind === 'list') this.renderList();
    else if (v.kind === 'note') this.renderNote(v.id);
    else if (v.kind === 'placing')
      clear(
        this.o.panel,
        h('p', { role: 'status', class: 'site-lead' }, this.o.t.placing),
        h(
          'button',
          {
            type: 'button',
            class: 'evx-cta evx-cta--ghost site-small',
            onclick: () => this.show({ kind: 'list' }),
          },
          this.o.t.cancel,
        ),
      );
    else this.renderForm(v);
  }

  private select(options: [string, string][], value: string): HTMLSelectElement {
    return h(
      'select',
      {},
      ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
    );
  }

  private renderList() {
    const { t, lang } = this.o;
    const all = [...this.notes.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const shown = this.filter ? all.filter((n) => n.status === this.filter) : all;
    const filter = this.select(
      [
        ['', t.allStatuses],
        ...this.o.statuses.map((s): [string, string] => [s, t.statuses[s] ?? s]),
      ],
      this.filter,
    );
    filter.addEventListener('change', () => {
      this.filter = filter.value;
      this.renderList();
    });
    clear(
      this.o.panel,
      h(
        'button',
        {
          type: 'button',
          class: 'evx-cta site-small',
          onclick: () => this.show({ kind: 'placing' }),
        },
        t.addNote,
      ),
      field(t.status, filter),
      shown.length
        ? h(
            'ul',
            { class: 'site-notes', 'data-testid': 'note-list' },
            ...shown.map((n) =>
              h(
                'li',
                {},
                h(
                  'button',
                  { type: 'button', class: 'site-note-item', onclick: () => this.open(n) },
                  h('strong', {}, n.title),
                  h(
                    'span',
                    { class: 'site-meta' },
                    `${t.categories[n.category] ?? n.category} · ${t.statuses[n.status] ?? n.status} · ${t.inScene(this.sceneName(n.sceneId))}`,
                  ),
                  h(
                    'span',
                    { class: 'site-meta' },
                    t.by(n.author.name, formatDate(n.updatedAt, lang)),
                  ),
                ),
              ),
            ),
          )
        : h('p', {}, t.noNotes),
    );
  }

  /** Goes to the note's scene, turns towards it and shows it. */
  private async open(n: Note) {
    if (this.o.viewer.sceneId !== n.sceneId)
      await this.o.viewer.goToScene(n.sceneId, { view: { yaw: n.yaw, pitch: n.pitch } });
    else await this.o.viewer.lookAt({ yaw: n.yaw, pitch: n.pitch });
    this.show({ kind: 'note', id: n.id });
  }

  private renderNote(id: string) {
    const { t, lang, me } = this.o;
    const n = this.notes.get(id);
    if (!n) return this.show({ kind: 'list' });
    const status = h('p', {});
    const patch = async (body: Record<string, unknown>) => {
      try {
        const saved = await api<Note>('PATCH', `/api/notes/${n.id}`, body);
        this.notes.set(saved.id, saved);
        this.render();
      } catch (e) {
        say(status, (e as Error).message, true);
      }
    };
    const statusSelect = this.select(
      this.o.statuses.map((s) => [s, t.statuses[s] ?? s]),
      n.status,
    );
    statusSelect.addEventListener('change', () => void patch({ status: statusSelect.value }));
    const assignee = this.select(
      [['', t.nobody], ...this.o.people.map((p): [string, string] => [p.id, p.name])],
      n.assignee?.id ?? '',
    );
    assignee.addEventListener('change', () => void patch({ assigneeId: assignee.value || null }));
    const reply = h('textarea', { required: true, maxlength: 4000 });
    const photo = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    photo.addEventListener('change', async () => {
      const f = photo.files?.[0];
      if (!f) return;
      try {
        const saved = await api<Note>('PUT', `/api/notes/${n.id}/photos`, f, f.type);
        this.notes.set(saved.id, saved);
        this.render();
      } catch (e) {
        say(status, (e as Error).message, true);
      }
    });
    const mine = n.author.id === me.id || me.role === 'admin';
    clear(
      this.o.panel,
      h(
        'button',
        {
          type: 'button',
          class: 'site-link site-back',
          onclick: () => this.show({ kind: 'list' }),
        },
        `← ${t.notes}`,
      ),
      h('h3', { class: 'site-note-title', 'data-testid': 'note-title' }, n.title),
      h(
        'p',
        { class: 'site-meta' },
        `${t.categories[n.category] ?? n.category} · ${t.inScene(this.sceneName(n.sceneId))}`,
      ),
      h('p', { class: 'site-meta' }, t.by(n.author.name, formatDate(n.createdAt, lang))),
      n.body ? h('p', { class: 'site-note-body' }, n.body) : null,
      h('button', { type: 'button', class: 'site-link', onclick: () => void this.open(n) }, t.goTo),
      field(t.status, statusSelect),
      field(t.assignee, assignee),
      n.photos.length
        ? h(
            'div',
            { class: 'site-photos' },
            ...n.photos.map((p) =>
              h(
                'a',
                { href: `/api/photos/${p.id}`, target: '_blank', rel: 'noopener' },
                h('img', { src: `/api/photos/${p.id}`, alt: t.photos, loading: 'lazy' }),
              ),
            ),
          )
        : null,
      field(t.photo, photo),
      h('h4', {}, t.replies),
      h(
        'ul',
        { class: 'site-replies' },
        ...n.replies.map((r) =>
          h(
            'li',
            {},
            h('p', {}, r.body),
            h('p', { class: 'site-meta' }, t.by(r.author.name, formatDate(r.createdAt, lang))),
          ),
        ),
      ),
      h(
        'form',
        {
          class: 'site-form',
          onsubmit: async (e: Event) => {
            e.preventDefault();
            try {
              const saved = await api<Note>('POST', `/api/notes/${n.id}/replies`, {
                body: reply.value,
              });
              this.notes.set(saved.id, saved);
              this.render();
            } catch (err) {
              say(status, (err as Error).message, true);
            }
          },
        },
        field(t.reply, reply),
        h('button', { type: 'submit', class: 'evx-cta site-small' }, t.send),
      ),
      mine
        ? h(
            'button',
            {
              type: 'button',
              class: 'evx-cta evx-cta--ghost site-small',
              onclick: async () => {
                if (!confirm(t.deleteConfirm)) return;
                await api('DELETE', `/api/notes/${n.id}`);
                this.notes.delete(n.id);
                this.schedule();
                this.show({ kind: 'list' });
              },
            },
            t.deleteNote,
          )
        : null,
      status,
    );
  }

  private renderForm(v: { sceneId: string; yaw: number; pitch: number }) {
    const { t } = this.o;
    const status = h('p', {});
    const title = h('input', { required: true, maxlength: 120 });
    const body = h('textarea', { maxlength: 4000 });
    const category = this.select(
      this.o.categories.map((c) => [c, t.categories[c] ?? c]),
      'general',
    );
    const assignee = this.select(
      [['', t.nobody], ...this.o.people.map((p): [string, string] => [p.id, p.name])],
      '',
    );
    const photo = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    clear(
      this.o.panel,
      h('h3', {}, t.addNote),
      h('p', { class: 'site-meta' }, t.inScene(this.sceneName(v.sceneId))),
      h(
        'form',
        {
          class: 'site-form',
          onsubmit: async (e: Event) => {
            e.preventDefault();
            try {
              let n = await api<Note>('POST', `/api/environments/${this.o.environmentId}/notes`, {
                ...v,
                title: title.value,
                body: body.value,
                category: category.value,
                assigneeId: assignee.value || null,
              });
              const f = photo.files?.[0];
              if (f) n = await api<Note>('PUT', `/api/notes/${n.id}/photos`, f, f.type);
              this.notes.set(n.id, n);
              this.schedule();
              this.show({ kind: 'note', id: n.id });
            } catch (err) {
              say(status, (err as Error).message, true);
            }
          },
        },
        field(t.title, title),
        field(t.category, category),
        field(t.text, body),
        field(t.assignee, assignee),
        field(t.photo, photo),
        h(
          'div',
          { class: 'site-row' },
          h('button', { type: 'submit', class: 'evx-cta site-small' }, t.save),
          h(
            'button',
            {
              type: 'button',
              class: 'evx-cta evx-cta--ghost site-small',
              onclick: () => this.show({ kind: 'list' }),
            },
            t.cancel,
          ),
        ),
        status,
      ),
    );
    title.focus();
  }

  destroy(): void {
    for (const f of this.off) f();
    this.overlay.remove();
  }
}
