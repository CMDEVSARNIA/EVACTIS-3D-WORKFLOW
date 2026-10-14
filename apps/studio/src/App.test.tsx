import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { STRINGS } from './i18n.ts';

afterEach(cleanup);

describe('Studio start screen', () => {
  it('shows the product lockup and switches language and theme', () => {
    const { container } = render(<App info={null} />);
    expect(screen.getAllByAltText('EVACTIS 3DWORKFLOW').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Français|English/ }));
    expect(document.documentElement.lang).toMatch(/en|fr/);
    const theme = screen.getByRole('button', { pressed: false });
    fireEvent.click(theme);
    expect(container.querySelector('.evx-chrome')?.getAttribute('data-theme')).toBe('light');
  });

  it('opens the About dialog with the full product name and version', () => {
    render(
      <App
        info={{
          name: 'EVACTIS 3DWORKFLOW Studio',
          version: '0.1.0',
          publisher: 'Evactis',
          identifier: 'ca.evactis.3dworkflow.studio',
          openPath: null,
          smokeTest: false,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /About|À propos/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('about-version').textContent).toBe('0.1.0');
  });

  it('has complete French strings', () => {
    expect(Object.keys(STRINGS.fr).sort()).toEqual(Object.keys(STRINGS.en).sort());
    expect(STRINGS.fr.offline).toHaveLength(STRINGS.en.offline.length);
  });
});
