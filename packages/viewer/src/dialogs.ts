import type { QuizQuestion } from '@evactis-3dworkflow/schema';
import { localize } from '@evactis-3dworkflow/schema';
import type { UiStrings } from './i18n.ts';

/**
 * Modal popups built with DOM APIs only (textContent, never innerHTML), so environment
 * text cannot inject markup or script.
 */
export class Dialogs {
  readonly el: HTMLDialogElement;
  private body: HTMLDivElement;
  private title: HTMLHeadingElement;
  private closeBtn: HTMLButtonElement;
  private closing: (() => void) | null = null;

  constructor(
    host: HTMLElement,
    private t: () => UiStrings,
  ) {
    this.el = document.createElement('dialog');
    this.el.className = 'evx-viewer__dialog';
    this.title = document.createElement('h2');
    this.title.className = 'evx-viewer__dialog-title';
    this.title.id = `evx-dlg-${Math.random().toString(36).slice(2)}`;
    this.el.setAttribute('aria-labelledby', this.title.id);
    this.body = document.createElement('div');
    this.body.className = 'evx-viewer__dialog-body';
    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'evx-cta evx-viewer__dialog-close';
    this.closeBtn.addEventListener('click', () => this.close());
    this.el.addEventListener('close', () => {
      const c = this.closing;
      this.closing = null;
      c?.();
    });
    this.el.append(this.title, this.body, this.closeBtn);
    host.append(this.el);
  }

  get open(): boolean {
    return this.el.open;
  }

  /** Dialogs asked for while one is open wait their turn (e.g. a step's question after a sign's popup). */
  private queue: Promise<void> = Promise.resolve();

  /** Shows content; resolves when the dialog closes. */
  show(title: string, content: Node[], modifier?: string): Promise<void> {
    const shown = this.queue.then(() => this.present(title, content, modifier));
    this.queue = shown.catch(() => undefined);
    return shown;
  }

  private present(title: string, content: Node[], modifier?: string): Promise<void> {
    this.el.className = modifier ? `evx-viewer__dialog ${modifier}` : 'evx-viewer__dialog';
    this.title.textContent = title;
    this.title.hidden = !title;
    this.body.replaceChildren(...content);
    this.closeBtn.textContent = this.t().close;
    return new Promise((resolve) => {
      this.closing = resolve;
      if (typeof this.el.showModal === 'function') this.el.showModal();
      else this.el.setAttribute('open', '');
    });
  }

  close(): void {
    if (typeof this.el.close === 'function' && this.el.open) this.el.close();
    else {
      this.el.removeAttribute('open');
      const c = this.closing;
      this.closing = null;
      c?.();
    }
  }

  text(s: string, cls = 'evx-viewer__text'): HTMLElement {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = s;
    return p;
  }

  /** Multiple-choice question; resolves with whether the chosen answer was correct. */
  async ask(
    q: QuizQuestion,
    lang: string,
  ): Promise<{ correct: boolean; choiceId: string | null; points: number }> {
    let result = { correct: false, choiceId: null as string | null, points: 0 };
    const list = document.createElement('div');
    list.className = 'evx-viewer__choices';
    list.setAttribute('role', 'group');
    const feedback = this.text('', 'evx-viewer__feedback');
    feedback.setAttribute('role', 'status');
    for (const c of q.choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'evx-cta evx-cta--ghost';
      b.textContent = localize(c.label, lang);
      b.dataset.choiceId = c.id;
      b.addEventListener('click', () => {
        result = { correct: c.correct, choiceId: c.id, points: c.correct ? q.points : 0 };
        list.querySelectorAll('button').forEach((x) => (x.disabled = true));
        const fb = c.correct ? q.feedbackCorrect : q.feedbackIncorrect;
        feedback.textContent = fb
          ? localize(fb, lang)
          : c.correct
            ? this.t().correct
            : this.t().incorrect;
        feedback.dataset.correct = String(c.correct);
      });
      list.append(b);
    }
    await this.show(localize(q.prompt, lang), [list, feedback]);
    return result;
  }

  dispose(): void {
    this.el.remove();
  }
}
