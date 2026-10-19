import type { UiStrings } from './i18n.ts';

/**
 * Local PDF viewer (procedures, MSDS sheets, plans) built on pdf.js, loaded on first use
 * so the Viewer core stays small. It reads only the package file it is given:
 * - no worker file: the parser runs on the page (a worker URL would break file:// and
 *   strict CSPs), loaded as a code chunk instead;
 * - no eval (`isEvalSupported: false`), no font, CMap or wasm downloads, no streaming
 *   range requests; documents' own embedded fonts are used.
 */
type PdfJs = typeof import('pdfjs-dist');
let loading: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist');
  })();
  return loading;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

/** A document view: page navigation, zoom, one rendered page at a time. */
export function pdfView(url: string, title: string, t: UiStrings): HTMLElement {
  const root = el('section', 'evx-viewer__pdf');
  root.setAttribute('aria-label', title);
  root.dataset.state = 'loading';
  const bar = el('div', 'evx-viewer__pdf-bar');
  const prev = el('button', 'evx-viewer__pdf-button');
  const next = el('button', 'evx-viewer__pdf-button');
  const zoomOut = el('button', 'evx-viewer__pdf-button');
  const zoomIn = el('button', 'evx-viewer__pdf-button');
  const status = el('p', 'evx-viewer__pdf-page');
  status.setAttribute('aria-live', 'polite');
  for (const [b, text, label] of [
    [prev, '‹', t.previous],
    [next, '›', t.next],
    [zoomOut, '−', t.zoomOut],
    [zoomIn, '+', t.zoomIn],
  ] as const) {
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.disabled = true;
  }
  const pages = el('div', 'evx-viewer__pdf-group');
  const zoom = el('div', 'evx-viewer__pdf-group');
  pages.append(prev, status, next);
  zoom.append(zoomOut, zoomIn);
  bar.append(pages, zoom);
  const page = el('div', 'evx-viewer__pdf-sheet');
  const canvas = el('canvas');
  // The page's text, for screen readers and search (the canvas is a picture of it).
  const text = el('div', 'evx-viewer__pdf-text');
  page.append(canvas, text);
  root.append(bar, page);
  status.textContent = t.loading;

  void (async () => {
    try {
      const lib = await pdfjs();
      const doc = await lib.getDocument({
        url,
        isEvalSupported: false,
        disableAutoFetch: true,
        disableStream: true,
        disableRange: true,
        useSystemFonts: false,
        stopAtErrors: false,
      }).promise;
      let n = 1;
      let scale = 1;
      let rendering: { cancel(): void } | null = null;
      const draw = async () => {
        rendering?.cancel();
        const p = await doc.getPage(n);
        const fit = (page.clientWidth || 640) / p.getViewport({ scale: 1 }).width;
        const vp = p.getViewport({ scale: fit * scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(vp.width * ratio);
        canvas.height = Math.floor(vp.height * ratio);
        canvas.style.width = `${Math.floor(vp.width)}px`;
        canvas.style.height = `${Math.floor(vp.height)}px`;
        const task = p.render({
          canvasContext: canvas.getContext('2d')!,
          viewport: vp,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        rendering = task;
        const content = await p.getTextContent();
        text.textContent = content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
        await task.promise.catch(() => undefined);
        status.textContent = t.page(n, doc.numPages);
        prev.disabled = n <= 1;
        next.disabled = n >= doc.numPages;
        zoomOut.disabled = scale <= 0.5;
        zoomIn.disabled = scale >= 3;
        root.dataset.page = String(n);
        root.dataset.pages = String(doc.numPages);
        root.dataset.state = 'ready';
      };
      prev.addEventListener('click', () => n > 1 && (n--, void draw()));
      next.addEventListener('click', () => n < doc.numPages && (n++, void draw()));
      zoomOut.addEventListener('click', () => ((scale = Math.max(0.5, scale / 1.25)), void draw()));
      zoomIn.addEventListener('click', () => ((scale = Math.min(3, scale * 1.25)), void draw()));
      root.addEventListener('keydown', (e) => {
        if (e.key === 'PageDown' || e.key === 'ArrowRight') next.click();
        else if (e.key === 'PageUp' || e.key === 'ArrowLeft') prev.click();
        else return;
        e.preventDefault();
      });
      // Draw once laid out (the dialog opens around it).
      requestAnimationFrame(() => void draw());
    } catch {
      root.dataset.state = 'error';
      status.textContent = t.documentFailed;
    }
  })();
  return root;
}
