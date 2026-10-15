import './index.css';
import {
  appInfo,
  reportSmoke,
  watchNetwork,
  type SmokeExtra,
} from '@evactis-3dworkflow/desktop-bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const blocked = watchNetwork();
const info = await appInfo();
let smokeDone: (r: SmokeExtra) => void = () => {};
const smoke = new Promise<SmokeExtra>((resolve) => (smokeDone = resolve));
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App info={info} onSmoke={smokeDone} />
  </StrictMode>,
);
// A plain smoke run reports once rendered; a --smoke-import run waits for the import.
await reportSmoke(info, blocked, info?.smokeImport ? await smoke : {});
