import { EnvironmentSchema, placementFor, type Environment } from '@evactis-3dworkflow/schema';
import { demoEnvironment } from '@evactis-3dworkflow/demo-facility/environment';
import { describe, expect, it } from 'vitest';
import { EditError } from './ops.ts';
import * as s from './skinOps.ts';

const valid = (env: Environment) => {
  const r = EnvironmentSchema.safeParse(env);
  if (!r.success)
    throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
};
const el = (env: Environment, id: string) =>
  s.effectiveSkin(env).elements.find((e) => e.id === id)!;

describe('skin editing operations', () => {
  it('starts from the Evactis default and edits one breakpoint at a time', () => {
    const env = demoEnvironment();
    s.resetSkin(env);
    expect(s.effectiveSkin(env).id).toBe('evactis-default');
    s.setPlacement(env, 'toolbar', 'tablet', { anchor: 'right', orientation: 'vertical' });
    expect(env.skin?.id).toBe('evactis-default');
    expect(placementFor(el(env, 'toolbar'), 'tablet')).toMatchObject({
      anchor: 'right',
      orientation: 'vertical',
      scale: 0.85,
    });
    // Phone inherits tablet; desktop and kiosk do not.
    expect(placementFor(el(env, 'toolbar'), 'phone').anchor).toBe('right');
    expect(placementFor(el(env, 'toolbar'), 'desktop').anchor).toBe('bottom');
    expect(placementFor(el(env, 'toolbar'), 'kiosk').anchor).toBe('bottom');
    valid(env);

    s.inherit(env, 'toolbar', 'tablet');
    expect(placementFor(el(env, 'toolbar'), 'tablet').anchor).toBe('bottom');
    expect(() => s.inherit(env, 'toolbar', 'desktop')).toThrow(EditError);
    expect(() => s.setPlacement(env, 'nope', 'phone', {})).toThrow(EditError);
  });

  it('rounds and clamps offsets and scale to what the schema allows', () => {
    const env = demoEnvironment();
    s.setPlacement(env, 'logo', 'desktop', { x: -12.4, y: 812.6, scale: 3.333 });
    expect(el(env, 'logo').layout.desktop).toMatchObject({ x: 0, y: 400, scale: 2.5 });
    s.setPlacement(env, 'logo', 'phone', { scale: 0.666 });
    expect(el(env, 'logo').layout.phone?.scale).toBe(0.67);
    valid(env);
  });

  it('keeps the menu and evacuation-route buttons on every toolbar', () => {
    const env = demoEnvironment();
    s.setToolbarButtons(env, 'toolbar', 'phone', ['evac-route', 'menu', 'menu', 'home']);
    expect(placementFor(el(env, 'toolbar'), 'phone').buttons).toEqual([
      'evac-route',
      'menu',
      'home',
    ]);
    expect(() => s.setToolbarButtons(env, 'toolbar', 'phone', ['menu', 'home'])).toThrow(
      /evac-route/,
    );
    expect(() => s.setToolbarButtons(env, 'logo', 'phone', ['menu', 'evac-route'])).toThrow(
      EditError,
    );
    valid(env);
  });

  it('changes only theme tokens, and refuses colours that would be hard to read', () => {
    const env = demoEnvironment();
    s.setToken(env, '--evx-navy', '#123456');
    expect(env.skin?.tokens['--evx-navy']).toBe('#123456');
    s.setToken(env, '--evx-btn-radius', '50%');
    expect(() => s.setToken(env, '--evx-navy', 'url(https://x)')).toThrow(EditError);
    expect(() => s.setToken(env, '--evx-btn-radius', '#fff')).toThrow(EditError);
    // Safety colours are not theme tokens.
    expect(() => s.setToken(env, '--evx-fire-red', '#FF0000')).toThrow(EditError);
    // A pale face would hide the white icons; a dark accent would hide the eyebrows.
    expect(() => s.setToken(env, '--evx-navy', '#DDDDDD')).toThrow(s.ContrastError);
    expect(() => s.setToken(env, '--evx-green', '#203010')).toThrow(/eyebrow/);
    expect(env.skin?.tokens['--evx-navy']).toBe('#123456');
    expect(s.contrastReport(env.skin!).every((r) => r.ratio >= r.min)).toBe(true);
    s.setToken(env, '--evx-navy', null);
    s.setToken(env, '--evx-btn-radius', null);
    expect(env.skin?.tokens).toEqual({});
    valid(env);
  });

  it('names, resets and co-brands', () => {
    const env = demoEnvironment();
    s.renameSkin(env, '  Client kiosk  ');
    expect(env.skin?.name).toBe('Client kiosk');
    expect(() => s.renameSkin(env, ' ')).toThrow(EditError);
    s.resetSkin(env);
    expect(env.skin).toBeUndefined();

    s.setBranding(env, {
      coBrand: true,
      clientName: { en: 'Acme Plant', fr: 'Usine Acme' },
      clientLogo: 'media/abc/source.png',
    });
    expect(env.settings.branding).toMatchObject({
      coBrand: true,
      clientLogo: 'media/abc/source.png',
    });
    valid(env);
    s.setBranding(env, { clientName: { en: '', fr: '' }, clientLogo: null });
    expect(env.settings.branding.clientName).toBeUndefined();
    expect(env.settings.branding.clientLogo).toBeUndefined();
  });

  it('shows logos from the original file when it keeps transparency', () => {
    expect(s.logoPath({ source: 'media/a/source.png', preview: 'media/a/photo.png' })).toBe(
      'media/a/source.png',
    );
    expect(s.logoPath({ source: 'media/a/source.tif', preview: 'media/a/photo.png' })).toBe(
      'media/a/photo.png',
    );
  });
});

describe('skin breakpoints', () => {
  it('keeps phone below tablet', () => {
    const env = demoEnvironment();
    s.setBreakpoints(env, { phone: 480.4 });
    expect(env.skin?.breakpoints).toEqual({ phone: 480, tablet: 1100 });
    expect(() => s.setBreakpoints(env, { tablet: 400 })).toThrow(EditError);
    expect(() => s.setBreakpoints(env, { phone: 200 })).toThrow(EditError);
    valid(env);
  });
});
