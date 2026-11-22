import type { Transition } from '@evactis-3dworkflow/schema';

/**
 * Scene transitions, composited in the DOM over the WebGL canvas: the outgoing frame is
 * snapshotted into an overlay, the new scene renders underneath, and the overlay
 * animates away. Reduced motion turns zoom and walk into a short fade.
 *
 * Walk (the walk-through): the Viewer has already turned to face the link, so the old
 * view pushes forward from the centre and fades while the new scene widens behind it.
 */
export async function runTransition(
  overlay: HTMLElement,
  snapshot: HTMLCanvasElement | null,
  transition: Transition,
  reducedMotion: boolean,
  towards: { x: number; y: number } | null,
  swap: () => Promise<void>,
): Promise<void> {
  if (!snapshot || transition.kind === 'cut' || transition.durationMs === 0) {
    await swap();
    return;
  }
  snapshot.className = 'evx-viewer__snapshot';
  overlay.replaceChildren(snapshot);
  try {
    await swap();
    let kind = transition.kind;
    let duration = transition.durationMs;
    if (reducedMotion) {
      kind = 'fade';
      duration = Math.min(duration, 200);
    }
    const origin = towards ? `${towards.x}px ${towards.y}px` : '50% 50%';
    snapshot.style.transformOrigin = origin;
    const frames: Keyframe[] =
      kind === 'zoom'
        ? [
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(2.2)', opacity: 0 },
          ]
        : kind === 'walk'
          ? [
              { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' },
              { transform: 'scale(1.25)', opacity: 0.85, filter: 'blur(0.5px)', offset: 0.35 },
              { transform: 'scale(1.7)', opacity: 0, filter: 'blur(2px)' },
            ]
          : [{ opacity: 1 }, { opacity: 0 }];
    if (typeof snapshot.animate === 'function') {
      const easing = kind === 'walk' ? 'cubic-bezier(0.4, 0, 0.6, 1)' : 'ease-in-out';
      await snapshot.animate(frames, { duration, easing, fill: 'forwards' }).finished;
    }
  } finally {
    overlay.replaceChildren();
  }
}
