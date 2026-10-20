/**
 * Live preview: the real 3DWORKFLOW Viewer, in editing mode (clicks select and place,
 * hotspots drag) or as the client will see it ("Test the tour"). Assets are loaded
 * through the desktop asset protocol, scoped by Rust to the project's media folder.
 */
import type { Environment, WorldPoint } from '@evactis-3dworkflow/schema';
import { createViewer, type Viewer } from '@evactis-3dworkflow/viewer';
import { useEffect, useRef, useState } from 'react';

export interface PreviewHandlers {
  /** `point`: the model surface under the click, in GLB and splat scenes. */
  onPanoramaClick?: (at: { yaw: number; pitch: number; point?: WorldPoint | null }) => void;
  onHotspotClick?: (id: string) => void;
  onHotspotMove?: (
    id: string,
    at: { yaw: number; pitch: number; point?: WorldPoint | null },
  ) => void;
  /** The viewer navigated (test mode) or finished loading a scene. */
  onSceneChange?: (sceneId: string) => void;
}

/** Every live layer at its default state, except the one being previewed. */
function applyLayers(
  v: Viewer,
  env: Environment,
  show: { layerId: string; stateId: string } | null,
) {
  for (const l of env.liveLayers) {
    const state = show?.layerId === l.id ? show.stateId : l.defaultStateId;
    if (v.liveLayers.find((x) => x.layerId === l.id)?.stateId !== state)
      void v.setLiveLayer(l.id, state).catch(() => undefined);
  }
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
  routeId = null,
  liveLayer = null,
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
  /** An evacuation route to show (drafts included in editing mode). */
  routeId?: string | null;
  /** A live-layer state to preview (others stay at their defaults). */
  liveLayer?: { layerId: string; stateId: string } | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set once the viewer is running with the current document (tests wait for it). */
  const [ready, setReady] = useState(false);
  // Latest props for the long-lived viewer callbacks and the async start-up.
  const latest = useRef({
    env,
    sceneId,
    selectedHotspot,
    lang,
    handlers,
    viewerRef,
    routeId,
    liveLayer,
  });
  latest.current = { env, sceneId, selectedHotspot, lang, handlers, viewerRef, routeId, liveLayer };

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
        v.on('panoramaclick', ({ yaw, pitch, point }) =>
          latest.current.handlers.onPanoramaClick?.({ yaw, pitch, point }),
        );
        v.on('hotspotclick', ({ hotspotId }) =>
          latest.current.handlers.onHotspotClick?.(hotspotId),
        );
        v.on('hotspotmove', ({ hotspotId, yaw, pitch, point }) =>
          latest.current.handlers.onHotspotMove?.(hotspotId, { yaw, pitch, point }),
        );
        v.on('scenechange', ({ sceneId: id }) => latest.current.handlers.onSceneChange?.(id));
        v.on('error', ({ error: e }) => setError(e.message));
        // Edits made while the viewer was starting.
        void v.setEnvironment(latest.current.env).then(() => {
          if (latest.current.sceneId !== v.sceneId)
            void v.goToScene(latest.current.sceneId, { transition: { kind: 'cut' } });
          if (editing) v.selectHotspot(latest.current.selectedHotspot);
          if (latest.current.routeId) v.showRoute(latest.current.routeId);
          applyLayers(v, latest.current.env, latest.current.liveLayer);
          if (!gone) setReady(true);
        });
      })
      .catch((e: unknown) => !gone && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      gone = true;
      setReady(false);
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
    if (!v) return;
    if (routeId) v.showRoute(routeId);
    else v.hideRoute();
  }, [routeId, env]);

  useEffect(() => {
    const v = viewer.current;
    if (v) applyLayers(v, env, liveLayer);
  }, [liveLayer?.layerId, liveLayer?.stateId, env]);

  useEffect(() => {
    const v = viewer.current;
    if (v && v.language !== lang && env.settings.languages.includes(lang)) v.setLanguage(lang);
  }, [lang, env.settings.languages]);

  return (
    <div className="evx-preview" data-testid="preview" data-editing={editing} data-ready={ready}>
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
