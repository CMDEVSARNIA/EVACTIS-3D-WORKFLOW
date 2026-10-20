import { IntegrityError, PackageReader, PassphraseError } from '@evactis-3dworkflow/package-format';
import { describe, expect, it } from 'vitest';
import { demoEnvironment } from '../../demo-facility/src/environment.ts';
import {
  buildDelivery,
  DeliveryError,
  deliveredEnvironment,
  unzip,
  type DeliveryInput,
} from '../src/index.ts';

const env = demoEnvironment();
const enc = new TextEncoder();
const dec = new TextDecoder();
const PASS = 'correct horse battery staple';

/** Builds a package into memory: path → bytes (appends joined). */
async function build(over: Partial<DeliveryInput>) {
  const out = new Map<string, Uint8Array>();
  const result = await buildDelivery(
    {
      env,
      kind: 'evx',
      producer: 'test',
      name: 'Riverside',
      createdAt: '2026-10-20T12:00:00.000Z',
      readAsset: async (p) => enc.encode(`asset ${p}`),
      quickStart: enc.encode('%PDF-test'),
      ...over,
    },
    {
      write: async (path, data, append) => {
        const before = append ? (out.get(path) ?? new Uint8Array()) : new Uint8Array();
        const next = new Uint8Array(before.length + data.length);
        next.set(before);
        next.set(data, before.length);
        out.set(path, next);
      },
    },
  );
  return { out, result };
}

const reader = (zip: Uint8Array, alter?: string) => {
  const entries = new Map(unzip(zip).map((e) => [e.name, e.data]));
  // One byte changed after the ZIP layer (whose CRC would catch it first).
  const d = alter ? entries.get(alter) : undefined;
  if (d) d[0] = d[0]! ^ 0xff;
  return PackageReader.open(async (p) => {
    const d = entries.get(p);
    if (!d) throw new Error(`missing ${p}`);
    return d;
  });
};

// Argon2id (64 MiB) runs several times per test: slow under a parallel test run.
describe('delivery packages', { timeout: 60_000 }, () => {
  it('an encrypted .evx refuses a wrong passphrase and opens with the right one', async () => {
    const { out } = await build({ passphrase: PASS });
    expect([...out.keys()]).toEqual(['Riverside.evx']);
    const pkg = await reader(out.get('Riverside.evx')!);
    expect(pkg.encrypted).toBe(true);
    expect(pkg.manifest.kind).toBe('evx');
    await expect(pkg.unlock('wrong horse battery staple')).rejects.toBeInstanceOf(PassphraseError);
    await pkg.unlock(PASS);
    expect(JSON.parse(dec.decode(await pkg.bytes('environment.json'))).id).toBe(env.id);
    const tile = pkg.manifest.files.find((f) => f.path.includes('/tiles/'));
    // Encrypted: the content is listed in the index, not by name in the manifest.
    expect(tile).toBeUndefined();
    expect(dec.decode(await pkg.bytes('media/lobby/preview.jpg'))).toBe(
      'asset media/lobby/preview.jpg',
    );
  });

  it('an altered file in an .evx fails its integrity check', async () => {
    const { out } = await build({});
    const pkg = await reader(out.get('Riverside.evx')!, 'media/lobby/preview.jpg');
    await expect(pkg.bytes('media/lobby/preview.jpg')).rejects.toBeInstanceOf(IntegrityError);
  });

  it('a portable folder holds the Viewer, the environment and its delivery note', async () => {
    const { out } = await build({ kind: 'portable', viewerExe: enc.encode('MZ') });
    expect([...out.keys()].sort()).toEqual(
      [
        'Riverside/EVACTIS-3DWORKFLOW-Viewer.exe',
        'Riverside/Quick start - Démarrage rapide.pdf',
        'Riverside/README.txt',
        'Riverside/environment.evx',
        'Riverside/viewer.json',
      ].sort(),
    );
    expect(JSON.parse(dec.decode(out.get('Riverside/viewer.json')!))).toEqual({
      environment: 'environment.evx',
      kiosk: false,
      portable: true,
    });
    await expect(build({ kind: 'portable' })).rejects.toBeInstanceOf(DeliveryError);
  });

  it('an installer script installs per user, names the shortcut after the facility and uninstalls only its own files', async () => {
    const { out } = await build({
      kind: 'installer',
      viewerExe: enc.encode('MZ'),
      installerIcon: enc.encode('ico'),
      webview2Copied: true,
    });
    const nsi = out.get('Riverside/installer.nsi')!;
    expect([...nsi.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const script = dec.decode(nsi);
    expect(script).toContain('RequestExecutionLevel user');
    expect(script).toContain('OutFile "../Riverside Setup.exe"');
    expect(script).toMatch(/CreateShortCut "\$SMPROGRAMS\\Evactis – [^"]+\.lnk"/);
    expect(script).toContain('!define MUI_ICON "installer.ico"');
    expect(script).toContain('File /r "webview2"');
    expect(script).toContain('RMDir /r "$INSTDIR\\webview2"');
    expect(script).not.toContain('RMDir /r "$INSTDIR"\n');
    expect(script).toContain('RMDir "$INSTDIR"');
    expect(out.get('Riverside/installer.ico')).toBeDefined();
    const plain = dec.decode(
      (await build({ kind: 'installer', viewerExe: enc.encode('MZ') })).out.get(
        'Riverside/installer.nsi',
      )!,
    );
    expect(plain).not.toContain('webview2');
    expect(plain).toContain('modern-install.ico');
  });

  it('a single HTML file keeps tile levels up to the cap only', () => {
    const faces = deliveredEnvironment(env, 2048).scenes.flatMap((s) =>
      s.media.type === 'equirect' && s.media.tiles ? s.media.tiles.levels.map((l) => l.size) : [],
    );
    expect(faces.length).toBeGreaterThan(0);
    expect(Math.max(...faces)).toBeLessThanOrEqual(2048);
  });
});
