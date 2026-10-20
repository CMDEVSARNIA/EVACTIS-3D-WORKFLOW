import { Lms } from './lms.ts';
import { openPackage } from './open.ts';
import { packageSource } from './source.ts';
import './player.css';

/**
 * The 3DWORKFLOW Viewer page shipped in packages (intranet bundle, browser folder, single
 * HTML file, SCORM): opens the package it sits in (see open.ts).
 *   ?scene= ?lang= ?audience=   where to start
 *   ?kiosk                      kiosk layout (or the package's own kiosk setting)
 *   ?module=<id>                start a training module (the SCORM launch)
 * Inside an LMS (SCORM 1.2 or 2004), the module's result is reported to it.
 */
const params = new URLSearchParams(location.search);
// Started before anything awaits: a browser-folder page defines its data hooks here.
const source = packageSource();

async function main() {
  const lms = Lms.connect(window);
  document.body.dataset.lms = lms?.version ?? 'none';
  const { mode, read } = await source;
  document.body.dataset.mode = mode;
  const viewer = await openPackage({
    stage: document.getElementById('stage')!,
    read,
    language: params.get('lang') ?? undefined,
    audience: params.get('audience') ?? undefined,
    sceneId: params.get('scene') ?? undefined,
    moduleId: params.get('module') ?? undefined,
    kiosk: params.has('kiosk'),
    learnerName: lms?.learnerName || undefined,
  });
  if (lms) {
    viewer.on('modulecomplete', (r) => lms.complete(r));
    addEventListener('pagehide', () => lms.finish());
  }
}

// Failures are shown on the page by openPackage.
main().catch(() => undefined);
