import { demoEnvironment } from '@evactis-3dworkflow/demo-facility/environment';
import { describe, expect, it } from 'vitest';
import { PACKAGING } from './packageStrings.ts';
import {
  estimateSingleFile,
  KINDS,
  mainOutput,
  missingTool,
  outputsOf,
  unconfirmedSafety,
} from './packageDelivery.ts';

describe('Package dialog', () => {
  it('names what each package creates and points to the right output', () => {
    expect(outputsOf('installer', 'Riverside')).toEqual(['Riverside', 'Riverside Setup.exe']);
    expect(mainOutput('installer', 'Riverside')).toBe('Riverside Setup.exe');
    expect(mainOutput('evx', 'Riverside')).toBe('Riverside.evx');
    expect(mainOutput('single-file', 'Riverside')).toBe('Riverside.html');
    expect(mainOutput('scorm', 'Riverside')).toBe('Riverside.zip');
    expect(outputsOf('browser-folder', 'Riverside')).toEqual(['Riverside']);
  });

  it('offers the desktop kinds only with the bundled Viewer, the installer only with NSIS', () => {
    const none = { viewer: false, webview2: false, webview2Installer: false, nsis: false };
    expect(KINDS.filter((k) => missingTool(k, none))).toEqual(['installer', 'portable']);
    expect(missingTool('installer', { ...none, viewer: true })).toBe('nsis');
    expect(missingTool('installer', { ...none, viewer: true, nsis: true })).toBeNull();
  });

  it('counts the safety items left out because nobody confirmed them', () => {
    const env = demoEnvironment();
    const before = unconfirmedSafety(env);
    delete env.equipment[0]!.confirmed;
    delete env.routes[0]!.confirmed;
    expect(unconfirmedSafety(env)).toBe(before + 2);
  });

  it('estimates a single HTML file from capped tiles, base64-encoded', async () => {
    const env = demoEnvironment();
    let asked: string[] = [];
    const n = await estimateSingleFile(env, async (paths) => {
      asked = paths;
      return paths.map(() => 3000);
    });
    expect(asked.some((p) => /\/tiles\//.test(p))).toBe(true);
    expect(n).toBe(Math.ceil((asked.length * 3000 * 4) / 3) + 4 * 1024 * 1024);
  });

  it('has every string in both languages', () => {
    expect(Object.keys(PACKAGING.fr).sort()).toEqual(Object.keys(PACKAGING.en).sort());
    expect(Object.keys(PACKAGING.fr.kinds)).toEqual(KINDS);
    expect(Object.keys(PACKAGING.en.kinds)).toEqual(KINDS);
  });
});
