import './index.css';
import { appInfo, reportSmoke, watchNetwork } from '@evactis-3dworkflow/desktop-bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const blocked = watchNetwork();
const info = await appInfo();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App info={info} />
  </StrictMode>,
);
await reportSmoke(info, blocked);
