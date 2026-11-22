/**
 * The app-wide controls: language, light/dark, interface size and full screen. On the
 * start screen they sit in the website-style top bar; with a project open, in the slim
 * project bar (Workspace), so the editors keep the height.
 */
import { iconSvg } from '@evactis-3dworkflow/brand';
import { fullScreen, stepZoom, ZOOM_STEPS } from '@evactis-3dworkflow/desktop-bridge';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { Strings } from './i18n.ts';

export type Theme = 'dark' | 'light';

/** A line icon in the button kit's style (24 px grid, 2 px round strokes). */
export function ToolIcon({ d, fill }: { d: string; fill?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
      {fill && <path d={fill} fill="currentColor" stroke="none" />}
    </svg>
  );
}

export const ICONS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  // Light/dark: a circle, half filled (the fill is THEME_FILL).
  theme: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  close: 'M18 6 6 18M6 6l12 12',
};

const THEME_FILL = 'M12 3a9 9 0 0 1 0 18z';

/** Whether full screen is on, kept current whatever turned it on or off (button, F11, Esc). */
function useFullScreen() {
  const [full] = useState(() => fullScreen());
  const [on, setOn] = useState(() => full?.on ?? false);
  useEffect(() => full?.watch(() => setOn(full.on)), [full]);
  return { full, on };
}

export function AppControls({
  t,
  theme,
  setTheme,
  onLanguage,
  zoom,
  setZoom,
}: {
  t: Strings;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onLanguage: () => void;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
}) {
  const { full, on } = useFullScreen();
  return (
    <div className="evx-appcontrols">
      <button type="button" className="evx-tool" onClick={onLanguage}>
        {t.language}
      </button>
      <button
        type="button"
        className="evx-tool"
        aria-label={t.theme}
        title={t.theme}
        aria-pressed={theme === 'light'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        <ToolIcon d={ICONS.theme} fill={THEME_FILL} />
      </button>
      <div className="evx-zoom" role="group" aria-label={t.zoomLevel(Math.round(zoom * 100))}>
        <button
          type="button"
          className="evx-tool"
          aria-label={`A− ${t.zoomOut}`}
          title={t.zoomOut}
          disabled={zoom <= ZOOM_STEPS[0]}
          onClick={() => setZoom((z) => stepZoom(z, -1))}
        >
          A−
        </button>
        <span className="evx-zoom__level" aria-hidden="true">
          {Math.round(zoom * 100)} %
        </span>
        <button
          type="button"
          className="evx-tool"
          aria-label={`A+ ${t.zoomIn}`}
          title={t.zoomIn}
          disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!}
          onClick={() => setZoom((z) => stepZoom(z, 1))}
        >
          A+
        </button>
      </div>
      {full && (
        <button
          type="button"
          className="evx-tool"
          data-testid="full-screen"
          aria-label={on ? t.exitFullScreen : t.fullScreen}
          title={on ? t.exitFullScreen : t.fullScreen}
          onClick={() => void full.toggle().catch(() => undefined)}
          dangerouslySetInnerHTML={{ __html: iconSvg(on ? 'fullscreen-exit' : 'fullscreen') }}
        />
      )}
    </div>
  );
}
