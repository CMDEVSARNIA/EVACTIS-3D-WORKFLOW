import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoEnvironment } from '../../demo-facility/src/environment.ts';
import { PackagingError, scormManifest, scormPackage, unzip } from '../src/index.ts';

const env = demoEnvironment();
const enc = new TextEncoder();
const file = (path: string, text = path) => ({ path, data: enc.encode(text) });
const player = ['index.html', 'player.js', 'index.css', 'files.json'].map((p) => file(p));
const assets = [file('media/lobby/preview.jpg'), file('docs/emergency-procedures.pdf')];
const dir = mkdtempSync(join(tmpdir(), 'evx-scorm-'));

/** Well-formed XML (libxml2's xmllint, as on CI runners). */
function wellFormed(xmlText: string) {
  const p = join(dir, `m${Math.random().toString(36).slice(2)}.xml`);
  writeFileSync(p, xmlText);
  execFileSync('xmllint', ['--noout', p]);
}

describe('SCORM packages', () => {
  it('writes a SCORM 1.2 package: manifest at the root, one SCO per module, mastery scores', () => {
    const entries = unzip(scormPackage(env, { version: '1.2', player, assets }));
    const names = entries.map((e) => e.name);
    expect(names[0]).toBe('imsmanifest.xml');
    expect(names).toEqual(
      expect.arrayContaining([
        'index.html',
        'player.js',
        'environment.json',
        ...assets.map((a) => a.path),
      ]),
    );
    expect(names).not.toContain('files.json');
    const manifest = new TextDecoder().decode(entries[0]!.data);
    wellFormed(manifest);
    expect(manifest).toContain('<schemaversion>1.2</schemaversion>');
    expect(manifest.match(/adlcp:scormtype="sco"/g)).toHaveLength(env.modules.length);
    expect(manifest).toContain('parameters="?module=aed-floor-2"');
    expect(manifest).toContain('<adlcp:masteryscore>100</adlcp:masteryscore>');
    expect(manifest).toContain('<file href="media/lobby/preview.jpg"/>');
    expect(manifest).toContain('<title>Evactis Demo Centre</title>');
    // The environment travels as JSON next to the player.
    const json = JSON.parse(
      new TextDecoder().decode(entries.find((e) => e.name === 'environment.json')!.data),
    );
    expect(json.modules).toHaveLength(env.modules.length);
  });

  it('writes a SCORM 2004 4th edition manifest with sequencing objectives', () => {
    const m = scormManifest(env, '2004', ['index.html', 'player.js'], ['nearest-exit']);
    wellFormed(m);
    expect(m).toContain('<schemaversion>2004 4th Edition</schemaversion>');
    expect(m).toContain('adlcp:scormType="sco"');
    expect(m).toContain('<imsss:minNormalizedMeasure>0.80</imsss:minNormalizedMeasure>');
    expect(m.match(/<item /g)).toHaveLength(1);
  });

  it('escapes text, and refuses unsafe paths or an environment without modules', () => {
    const odd = structuredClone(env);
    odd.modules[0]!.title = { en: 'Exits & <stairs>', fr: 'Sorties' };
    const m = scormManifest(odd, '1.2', ['index.html']);
    wellFormed(m);
    expect(m).toContain('Exits &amp; &lt;stairs&gt;');
    expect(() =>
      scormPackage(env, { version: '1.2', player, assets: [file('../secret.txt')] }),
    ).toThrow(PackagingError);
    const none = structuredClone(env);
    none.modules = [];
    expect(() => scormPackage(none, { version: '2004', player, assets })).toThrow(/at least one/);
    expect(() => scormPackage(env, { version: '2004', player: [], assets })).toThrow(/player/);
  });

  it('round-trips through the system unzip too', () => {
    const p = join(dir, 'pkg.zip');
    writeFileSync(p, scormPackage(env, { version: '2004', player, assets }));
    const list = execFileSync('unzip', ['-l', p], { encoding: 'utf8' });
    expect(list).toContain('imsmanifest.xml');
    expect(execFileSync('unzip', ['-t', p], { encoding: 'utf8' })).toContain('No errors');
  });
});
