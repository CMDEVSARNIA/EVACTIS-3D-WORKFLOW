import type { Transition } from '@evactis-3dworkflow/schema';

/**
 * Scene transitions, composited in the DOM over the WebGL canvas: the outgoing frame is
 * snapshotted into an overlay, the new scene renders underneath, and the overlay
 * animates away. Reduced motion turns zoom and walk into a short fade.
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
              { transform: 'scale(1.35)', opacity: 0, filter: 'blur(3px)' },
            ]
          : [{ opacity: 1 }, { opacity: 0 }];
    if (typeof snapshot.animate === 'function') {
      await snapshot.animate(frames, { duration, easing: 'ease-in-out', fill: 'forwards' })
        .finished;
    }
  } finally {
    overlay.replaceChildren();
  }
}
