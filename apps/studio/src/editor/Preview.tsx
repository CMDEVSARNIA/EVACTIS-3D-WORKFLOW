/**
 * Live preview: the real 3DWORKFLOW Viewer, in editing mode (clicks select and place,
 * hotspots drag) or as the client will see it ("Test the tour"). Assets are loaded
 * through the desktop asset protocol, scoped by Rust to the project's media folder.
 */
import type { Environment } from '@evactis-3dworkflow/schema';
import { createViewer, type Viewer } from '@evactis-3dworkflow/viewer';
import { useEffect, useRef, useState } from 'react';

export interface PreviewHandlers {
  onPanoramaClick?: (at: { yaw: number; pitch: number }) => void;
  onHotspotClick?: (id: string) => void;
  onHotspotMove?: (id: string, at: { yaw: number; pitch: number }) => void;
  /** The viewer navigated (test mode) or finished loading a scene. */
  onSceneChange?: (sceneId: string) => void;
}

export function Preview({
  env,
  sceneId,
  editing,
  selectedHotspot,
  lang,
  resolveAsset,
  viewerRef,
  failedText,
  ...handlers
}: PreviewHandlers & {
  env: Environment;
  sceneId: string;
  editing: boolean;
  selectedHotspot: string | null;
  lang: string;
  resolveAsset: (path: string) => string;
  /** Receives the Viewer (or null), so the editor can read the current view. */
  viewerRef?: (v: Viewer | null) => void;
  failedText: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Latest props for the long-lived viewer callbacks and the async start-up.
  const latest = useRef({ env, sceneId, selectedHotspot, lang, handlers, viewerRef });
  latest.current = { env, sceneId, selectedHotspot, lang, handlers, viewerRef };

  // One viewer per mode; switching editing on/off rebuilds it.
  useEffect(() => {
    const el = host.current!;
    let gone = false;
    let made: Viewer | null = null;
    setError(null);
    void createViewer(el, latest.current.env, {
      editing,
      sceneId: latest.current.sceneId,
      language: latest.current.lang,
      resolveAsset,
    })
      .then((v) => {
        if (gone) return v.destroy();
        made = v;
        viewer.current = v;
        latest.current.viewerRef?.(v);
        v.on('panoramaclick', ({ yaw, pitch }) =>
          latest.current.handlers.onPanoramaClick?.({ yaw, pitch }),
        );
        v.on('hotspotclick', ({ hotspotId }) =>
          latest.current.handlers.onHotspotClick?.(hotspotId),
        );
        v.on('hotspotmove', ({ hotspotId, yaw, pitch }) =>
          latest.current.handlers.onHotspotMove?.(hotspotId, { yaw, pitch }),
        );
        v.on('scenechange', ({ sceneId: id }) => latest.current.handlers.onSceneChange?.(id));
        v.on('error', ({ error: e }) => setError(e.message));
        // Edits made while the viewer was starting.
        void v.setEnvironment(latest.current.env).then(() => {
          if (latest.current.sceneId !== v.sceneId)
            void v.goToScene(latest.current.sceneId, { transition: { kind: 'cut' } });
          if (editing) v.selectHotspot(latest.current.selectedHotspot);
        });
      })
      .catch((e: unknown) => !gone && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      gone = true;
      if (made) {
        made.destroy();
        latest.current.viewerRef?.(null);
      }
      viewer.current = null;
      el.replaceChildren();
    };
  }, [editing, resolveAsset]);

  useEffect(() => {
    void viewer.current?.setEnvironment(env);
  }, [env]);

  useEffect(() => {
    const v = viewer.current;
    if (v && v.sceneId !== sceneId) void v.goToScene(sceneId, { transition: { kind: 'cut' } });
  }, [sceneId]);

  useEffect(() => {
    if (editing) viewer.current?.selectHotspot(selectedHotspot);
  }, [selectedHotspot, editing]);

  useEffect(() => {
    const v = viewer.current;
    if (v && v.language !== lang && env.settings.languages.includes(lang)) v.setLanguage(lang);
  }, [lang, env.settings.languages]);

  return (
    <div className="evx-preview" data-testid="preview" data-editing={editing}>
      <div ref={host} className="evx-preview__stage" />
      {error && (
        <p role="alert" className="evx-alert evx-preview__error">
          {failedText}
          {error}
        </p>
      )}
    </div>
  );
}
