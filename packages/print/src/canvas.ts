/**
 * Thin drawing layer over pdf-lib: top-left coordinates (as on screen), the four Inter
 * weights, brand colours, and a record of the smallest text size used, so tests can
 * prove printed plans stay legible.
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';

export interface PrintFonts {
  regular: Uint8Array;
  semibold: Uint8Array;
  bold: Uint8Array;
  extrabold: Uint8Array;
}

export type Weight = keyof PrintFonts;

/** Paper sizes in points (1/72 in), portrait. */
export const PAPER = {
  letter: { w: 612, h: 792 },
  tabloid: { w: 792, h: 1224 },
} as const;
export type Paper = keyof typeof PAPER;

const hex = (h: string): RGB =>
  rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  );

/** Brand and safety colours (packages/brand/src/tokens.ts). */
export const C = {
  ink: hex('#0A0A0A'),
  navy: hex('#0A2F5B'),
  green: hex('#71B043'),
  greenText: hex('#4A7A13'),
  safeGreen: hex('#00843D'),
  red: hex('#C8102E'),
  yellow: hex('#F2C230'),
  white: rgb(1, 1, 1),
  subtle: hex('#4B5563'),
  rule: hex('#C9CED6'),
  panel: hex('#F2F4F7'),
  surfaceDark: hex('#101809'),
};

export class Canvas {
  minFontPt = Infinity;
  readonly doc: PDFDocument;
  readonly fonts: Record<Weight, PDFFont>;
  private constructor(doc: PDFDocument, fonts: Record<Weight, PDFFont>) {
    this.doc = doc;
    this.fonts = fonts;
  }

  static async create(
    fonts: PrintFonts,
    meta: { title: string; subject: string },
  ): Promise<Canvas> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const embed = (b: Uint8Array) => doc.embedFont(b, { subset: true });
    const f = {
      regular: await embed(fonts.regular),
      semibold: await embed(fonts.semibold),
      bold: await embed(fonts.bold),
      extrabold: await embed(fonts.extrabold),
    };
    doc.setTitle(meta.title);
    doc.setSubject(meta.subject);
    doc.setCreator('EVACTIS 3DWORKFLOW Studio');
    doc.setProducer('EVACTIS 3DWORKFLOW');
    // Fixed dates keep output reproducible; the printed date is on the page itself.
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));
    return new Canvas(doc, f);
  }

  page(w: number, h: number): Page {
    return new Page(this, this.doc.addPage([w, h]));
  }

  async image(bytes: Uint8Array): Promise<PDFImage> {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return png ? this.doc.embedPng(bytes) : this.doc.embedJpg(bytes);
  }

  width(text: string, size: number, weight: Weight = 'regular'): number {
    return this.fonts[weight].widthOfTextAtSize(text, size);
  }

  /**
   * Splits text into lines no wider than `max`. A word wider than a whole line (a long
   * file name) is broken after its hyphens or backslashes.
   */
  wrap(text: string, size: number, max: number, weight: Weight = 'regular'): string[] {
    const lines: string[] = [];
    const pieces = (word: string): string[] => {
      if (this.width(word, size, weight) <= max) return [word];
      const out: string[] = [];
      let cur = '';
      for (const part of word.split(/(?<=[-\\])/)) {
        if (cur && this.width(cur + part, size, weight) > max) {
          out.push(cur);
          cur = part;
        } else cur += part;
      }
      return [...out, cur];
    };
    for (const para of text.split('\n')) {
      let line = '';
      for (const piece of para.split(/\s+/).filter(Boolean).map(pieces)) {
        if (piece.length > 1) {
          if (line) lines.push(line);
          lines.push(...piece.slice(0, -1));
          line = piece.at(-1)!;
          continue;
        }
        const word = piece[0]!;
        const next = line ? `${line} ${word}` : word;
        if (line && this.width(next, size, weight) > max) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  save(): Promise<Uint8Array> {
    return this.doc.save({ useObjectStreams: false });
  }
}

export interface TextOpts {
  size: number;
  weight?: Weight;
  color?: RGB;
  align?: 'left' | 'center' | 'right';
  /** Rotation in degrees, clockwise. */
  rotate?: number;
}

/** A page with top-left coordinates. */
export class Page {
  readonly w: number;
  readonly h: number;
  readonly page: PDFPage;
  private c: Canvas;
  constructor(c: Canvas, page: PDFPage) {
    this.c = c;
    this.page = page;
    this.w = page.getWidth();
    this.h = page.getHeight();
  }

  /** Draws one line of text with its top at `y`. Returns the line height used. */
  text(s: string, x: number, y: number, o: TextOpts): number {
    const weight = o.weight ?? 'regular';
    const font = this.c.fonts[weight];
    const width = font.widthOfTextAtSize(s, o.size);
    const dx = o.align === 'center' ? -width / 2 : o.align === 'right' ? -width : 0;
    const ascent = font.heightAtSize(o.size, { descender: false });
    this.c.minFontPt = Math.min(this.c.minFontPt, o.size);
    this.page.drawText(s, {
      x: x + dx,
      y: this.h - y - ascent,
      size: o.size,
      font,
      color: o.color ?? C.ink,
    });
    return o.size * 1.25;
  }

  /** Wrapped paragraph; returns its height. */
  paragraph(s: string, x: number, y: number, max: number, o: TextOpts): number {
    let dy = 0;
    for (const line of this.c.wrap(s, o.size, max, o.weight)) dy += this.text(line, x, y + dy, o);
    return dy;
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    o: { fill?: RGB; stroke?: RGB; width?: number; radius?: number },
  ) {
    if (o.radius) {
      const r = Math.min(o.radius, w / 2, h / 2);
      const path = `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
      this.page.drawSvgPath(path, {
        x,
        y: this.h - y,
        ...(o.fill && { color: o.fill }),
        ...(o.stroke && { borderColor: o.stroke, borderWidth: o.width ?? 1 }),
      });
      return;
    }
    this.page.drawRectangle({
      x,
      y: this.h - y - h,
      width: w,
      height: h,
      ...(o.fill && { color: o.fill }),
      ...(o.stroke && { borderColor: o.stroke, borderWidth: o.width ?? 1 }),
    });
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    o: { color: RGB; width: number; dash?: number[] },
  ) {
    this.page.drawLine({
      start: { x: x1, y: this.h - y1 },
      end: { x: x2, y: this.h - y2 },
      color: o.color,
      thickness: o.width,
      ...(o.dash && { dashArray: o.dash }),
      lineCap: 1,
    });
  }

  /** SVG path data in local coordinates (y down), placed with its origin at (x, y). */
  path(
    d: string,
    x: number,
    y: number,
    o: { fill?: RGB; stroke?: RGB; width?: number; scale?: number },
  ) {
    this.page.drawSvgPath(d, {
      x,
      y: this.h - y,
      ...(o.scale && { scale: o.scale }),
      ...(o.fill && { color: o.fill }),
      ...(o.stroke && { borderColor: o.stroke, borderWidth: o.width ?? 1, borderLineCap: 1 }),
    });
  }

  circle(x: number, y: number, r: number, o: { fill?: RGB; stroke?: RGB; width?: number }) {
    this.page.drawCircle({
      x,
      y: this.h - y,
      size: r,
      ...(o.fill && { color: o.fill }),
      ...(o.stroke && { borderColor: o.stroke, borderWidth: o.width ?? 1 }),
    });
  }

  image(img: PDFImage, x: number, y: number, w: number, h: number) {
    this.page.drawImage(img, { x, y: this.h - y - h, width: w, height: h });
  }
}
