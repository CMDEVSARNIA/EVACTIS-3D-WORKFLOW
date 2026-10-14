/**
 * Deterministic procedural backdrops for legibility tests: the sheet's light-to-dark
 * gradient plus three synthetic equirectangular "panoramas" covering the hard cases
 * (overexposed atrium, night corridor, busy high-contrast texture). No image files,
 * no network.
 */
export type BackdropName = 'gradient' | 'bright' | 'dark' | 'busy';
export const BACKDROPS: BackdropName[] = ['gradient', 'bright', 'dark', 'busy'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paintBackdrop(ctx: CanvasRenderingContext2D, name: BackdropName): void {
  const { width: w, height: h } = ctx.canvas;
  const rand = rng(name.length * 7919);
  if (name === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d8d3c7');
    g.addColorStop(0.5, '#848179');
    g.addColorStop(1, '#2c3034');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (name === 'bright') {
    // Sunlit atrium: white sky through glazing, pale walls, polished floor.
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.5);
    sky.addColorStop(0, '#ffffff');
    sky.addColorStop(1, '#dfeaf2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.5);
    ctx.fillStyle = '#efece6';
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
    for (let x = 0; x < w; x += 150) {
      ctx.fillStyle = '#fbfbfa';
      ctx.fillRect(x + 20, h * 0.12, 110, h * 0.34);
      ctx.fillStyle = '#c9ccce';
      ctx.fillRect(x + 72, h * 0.12, 6, h * 0.34);
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.4 + rand() * 0.6})`;
      ctx.beginPath();
      ctx.arc(rand() * w, h * 0.5 + rand() * h * 0.5, 10 + rand() * 60, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (name === 'dark') {
    // Night corridor: near-black with emergency lighting.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#05070a');
    g.addColorStop(0.5, '#0c1118');
    g.addColorStop(1, '#030405');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const glow = (x: number, y: number, r: number, c: string) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    };
    glow(w * 0.2, h * 0.25, 140, 'rgba(0,132,61,0.55)');
    glow(w * 0.75, h * 0.3, 120, 'rgba(200,16,46,0.35)');
    glow(w * 0.5, h * 0.05, 260, 'rgba(255,240,210,0.12)');
    return;
  }
  // Busy: high-contrast tiles and stripes (signage, racking, patterned floor).
  for (let y = 0; y < h; y += 40)
    for (let x = 0; x < w; x += 40) {
      const v = Math.floor(rand() * 255);
      ctx.fillStyle = `rgb(${v},${Math.floor(v * (0.6 + rand() * 0.4))},${Math.floor(rand() * 255)})`;
      ctx.fillRect(x, y, 40, 40);
    }
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000';
    ctx.fillRect(rand() * w, 0, 4 + rand() * 14, h);
  }
  ctx.globalAlpha = 1;
}
