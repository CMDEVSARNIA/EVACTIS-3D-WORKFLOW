import { readFileSync } from 'node:fs';
import { runInNewContext, runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { demoAssets } from './assets.ts';

/**
 * The desktop apps harden Object.prototype before any page script (crates/evx-desktop/
 * src/harden.js). pdf-lib and fontkit assign inherited names (`toString`, `valueOf`) on
 * their own prototypes when they load, which a plain Object.freeze turns into a
 * TypeError; printing must work under the hardening the apps really use.
 */
const HARDEN = readFileSync(
  new URL('../../../crates/evx-desktop/src/harden.js', import.meta.url),
  'utf8',
);

const PROBE = `(() => {
  'use strict';
  const out = {};
  try { Object.prototype.polluted = 1; } catch (e) { out.add = e instanceof TypeError; }
  try { Object.prototype.toString = () => 'x'; } catch (e) { out.replace = e instanceof TypeError; }
  try { Object.defineProperty(Object.prototype, 'valueOf', { value: 1 }); } catch (e) { out.define = e instanceof TypeError; }
  try {
    function Box(v) { this.v = v; }
    Box.prototype.valueOf = function () { return this.v; };
    Box.prototype.toString = function () { return 'box'; };
    out.box = new Box(41) + 1;
    out.str = String(new Box(1));
    out.keys = Object.keys(Box.prototype).join();
  } catch (e) { out.override = String(e); }
  try { out.assign = String(Object.assign({}, { toString: () => 'own' })); } catch (e) { out.assign = String(e); }
  out.plain = String({});
  out.frozen = Object.isFrozen(Object.prototype);
  return JSON.stringify(out);
})()`;

describe('prototype hardening', () => {
  it('blocks pollution of Object.prototype but keeps overriding inherited names', () => {
    expect(JSON.parse(runInNewContext(`${HARDEN}\n${PROBE}`))).toEqual({
      add: true,
      replace: true,
      define: true,
      box: 42,
      str: 'box',
      keys: 'valueOf,toString',
      assign: 'own',
      plain: '[object Object]',
      frozen: true,
    });
  });

  it('a plain freeze (Tauri freezePrototype) breaks that pattern', () => {
    const out = JSON.parse(runInNewContext(`Object.freeze(Object.prototype);\n${PROBE}`));
    expect(out.override).toMatch(/read only property 'valueOf'/);
  });

  it('pdf-lib and fontkit load and print a certificate under the hardening', async () => {
    runInThisContext(HARDEN);
    expect(Object.isFrozen(Object.prototype)).toBe(true);
    const { certificatePdf } = await import('../src/index.ts');
    const assets = await demoAssets();
    const bytes = await certificatePdf(
      {
        learner: 'Test',
        module: { en: 'Find your nearest exit', fr: 'Trouvez la sortie la plus proche' },
        facility: { en: 'Evactis Demo Centre', fr: 'Centre de démonstration Evactis' },
        score: 3,
        max: 3,
        percent: 100,
        date: '2026-10-20',
      },
      { fonts: assets.fonts, logo: assets.logo },
    );
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  });
});
