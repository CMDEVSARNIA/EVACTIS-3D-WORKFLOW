import { Euler, Quaternion, Vector3 } from 'three';
import { DEG, angles, clamp, wrapYaw } from './math.ts';
import type { View } from './panorama/renderer.ts';

export interface ControlOptions {
  keyboard: boolean;
  minFov: number;
  maxFov: number;
  reducedMotion: () => boolean;
}

/**
 * Mouse, touch (drag + pinch), wheel, keyboard and gyroscope input. Drag uses a
 * "grab the panorama" model: dragging right turns the view left.
 */
export class Controls {
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { dist: number; fov: number } | null = null;
  private velocity = { yaw: 0, pitch: 0 };
  private lastMove = 0;
  private inertiaRaf = 0;
  private gyro: { handler: (e: DeviceOrientationEvent) => void; offset: number | null } | null =
    null;
  private off: (() => void)[] = [];

  constructor(
    private host: HTMLElement,
    private getView: () => View,
    private setView: (v: View) => void,
    private onInteract: () => void,
    private opts: ControlOptions,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      o?: AddEventListenerOptions,
    ) => {
      host.addEventListener(type, fn, o);
      this.off.push(() => host.removeEventListener(type, fn, o));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.up(e));
    on('wheel', (e) => this.wheel(e), { passive: false });
    if (opts.keyboard) on('keydown', (e) => this.key(e));
  }

  private apply(v: Partial<View>) {
    const cur = this.getView();
    const fov = clamp(v.fov ?? cur.fov, this.opts.minFov, this.opts.maxFov);
    this.setView({
      yaw: wrapYaw(v.yaw ?? cur.yaw),
      pitch: clamp(v.pitch ?? cur.pitch, -90, 90),
      fov,
    });
  }

  private down(e: PointerEvent) {
    if (e.button > 0 || (e.target as Element).closest('button, a, dialog, [data-hotspot-id]'))
      return;
    this.host.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.stopInertia();
    this.onInteract();
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), fov: this.getView().fov };
    }
  }

  private move(e: PointerEvent) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size >= 2 && this.pinchStart) {
      const [a, b] = [...this.pointers.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.apply({ fov: this.pinchStart.fov * (this.pinchStart.dist / dist) });
      return;
    }
    const view = this.getView();
    const degPerPx = view.fov / (this.host.clientHeight || 1);
    const dYaw = -(cur.x - prev.x) * degPerPx;
    const dPitch = (cur.y - prev.y) * degPerPx;
    const now = performance.now();
    const dt = Math.max(1, now - this.lastMove);
    this.lastMove = now;
    this.velocity = { yaw: (dYaw / dt) * 16, pitch: (dPitch / dt) * 16 };
    this.apply({ yaw: view.yaw + dYaw, pitch: view.pitch + dPitch });
  }

  private up(e: PointerEvent) {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size < 2) this.pinchStart = null;
    if (
      this.pointers.size === 0 &&
      !this.opts.reducedMotion() &&
      performance.now() - this.lastMove < 80
    )
      this.coast();
  }

  private coast() {
    const step = () => {
      this.velocity.yaw *= 0.92;
      this.velocity.pitch *= 0.92;
      if (Math.abs(this.velocity.yaw) + Math.abs(this.velocity.pitch) < 0.01) return;
      const v = this.getView();
      this.apply({ yaw: v.yaw + this.velocity.yaw, pitch: v.pitch + this.velocity.pitch });
      this.inertiaRaf = requestAnimationFrame(step);
    };
    this.inertiaRaf = requestAnimationFrame(step);
  }

  private stopInertia() {
    cancelAnimationFrame(this.inertiaRaf);
    this.velocity = { yaw: 0, pitch: 0 };
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    this.stopInertia();
    this.onInteract();
    const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    this.apply({ fov: this.getView().fov * Math.exp(e.deltaY * scale * 0.0015) });
  }

  private key(e: KeyboardEvent) {
    if (e.target !== this.host || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? 15 : 5;
    const v = this.getView();
    const map: Record<string, Partial<View>> = {
      ArrowLeft: { yaw: v.yaw - step },
      ArrowRight: { yaw: v.yaw + step },
      ArrowUp: { pitch: v.pitch + step },
      ArrowDown: { pitch: v.pitch - step },
      '+': { fov: v.fov / 1.15 },
      '=': { fov: v.fov / 1.15 },
      '-': { fov: v.fov * 1.15 },
      _: { fov: v.fov * 1.15 },
    };
    const change = map[e.key];
    if (!change) return;
    e.preventDefault();
    this.stopInertia();
    this.onInteract();
    this.apply(change);
  }

  zoom(factor: number) {
    this.apply({ fov: this.getView().fov / factor });
  }

  /** Starts gyroscope look-around. Must be called from a user gesture on iOS. */
  async enableGyro(): Promise<boolean> {
    if (this.gyro) return true;
    const DOE = (globalThis as { DeviceOrientationEvent?: typeof DeviceOrientationEvent })
      .DeviceOrientationEvent;
    if (!DOE) return false;
    const req = (DOE as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (req && (await req()) !== 'granted') return false;
    const q = new Quaternion();
    const euler = new Euler();
    const q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    const zee = new Vector3(0, 0, 1);
    const q0 = new Quaternion();
    const gyro = {
      offset: null as number | null,
      handler: (e: DeviceOrientationEvent) => {
        if (e.alpha === null || e.beta === null || e.gamma === null) return;
        const orient = (screen.orientation?.angle ?? 0) * DEG;
        euler.set(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG, 'YXZ');
        q.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
        const f = new Vector3(0, 0, -1).applyQuaternion(q);
        const { yaw, pitch } = angles([f.x, f.y, f.z]);
        if (gyro.offset === null) gyro.offset = this.getView().yaw - yaw;
        this.apply({ yaw: yaw + gyro.offset, pitch });
      },
    };
    window.addEventListener('deviceorientation', gyro.handler);
    this.gyro = gyro;
    return true;
  }

  disableGyro(): void {
    if (this.gyro) window.removeEventListener('deviceorientation', this.gyro.handler);
    this.gyro = null;
  }

  get gyroEnabled(): boolean {
    return this.gyro !== null;
  }

  dispose(): void {
    cancelAnimationFrame(this.inertiaRaf);
    this.disableGyro();
    this.off.forEach((f) => f());
  }
}
