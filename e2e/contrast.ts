import type { Page } from '@playwright/test';

export interface ContrastProblem {
  text: string;
  ratio: number;
  required: number;
  colour: string;
  background: string;
}

/**
 * Measures WCAG 2.x text contrast for every visible text element under `root`, from
 * computed styles: the text colour (with element opacity) against the first opaque
 * background colour found walking up the tree. Returns the elements below 4.5:1
 * (3:1 for large text: ≥ 24 px, or ≥ 18.66 px bold). Disabled controls are exempt,
 * as WCAG allows. Background images (the chrome's soft glows) are ignored; they only
 * shift the dark background slightly.
 */
export async function contrastProblems(page: Page, root = 'body'): Promise<ContrastProblem[]> {
  return page.evaluate((rootSel) => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3];
      return [
        top[0] * a + under[0] * (1 - a),
        top[1] * a + under[1] * (1 - a),
        top[2] * a + under[2] * (1 - a),
        1,
      ];
    };
    const lum = ([r, g, b]: RGBA) => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const ratio = (a: RGBA, b: RGBA) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const background = (el: Element): RGBA => {
      // Composite translucent backgrounds from the page down to this element.
      const chain: RGBA[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor);
        if (bg[3] > 0) chain.push(bg);
        if (bg[3] >= 1) break;
      }
      let acc: RGBA = [255, 255, 255, 1];
      for (const bg of chain.reverse()) acc = over(bg, acc);
      return acc;
    };
    const opacity = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement)
        o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const problems: ContrastProblem[] = [];
    const root = document.querySelector(rootSel);
    if (!root) return problems;
    for (const el of root.querySelectorAll('*')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (!own) continue;
      const s = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (s.visibility === 'hidden' || s.display === 'none' || !box.width || !box.height) continue;
      if (el.closest('[disabled], [aria-disabled="true"]')) continue;
      // Fully transparent (e.g. a hotspot behind the camera): nobody can see it.
      if (opacity(el) === 0) continue;
      const bg = background(el);
      const fg = parse(s.color);
      const fgOnBg = over([fg[0], fg[1], fg[2], fg[3] * opacity(el)], bg);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      const required = large ? 3 : 4.5;
      const r = ratio(fgOnBg, bg);
      if (r < required)
        problems.push({
          text: el.textContent!.trim().slice(0, 60),
          ratio: Math.round(r * 100) / 100,
          required,
          colour: s.color,
          background: `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`,
        });
    }
    return problems;
  }, root);
}
