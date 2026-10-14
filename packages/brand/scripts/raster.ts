/**
 * Small, dependency-free encoders for the Windows assets the installers need:
 * multi-size .ico (PNG entries) and 24-bit .bmp (NSIS/WiX dialog images).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');

export interface Rgba {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Rasterises SVG markup to exactly `width` px wide. */
export function renderSvg(svg: string, width: number): { png: Buffer; rgba: Rgba } {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } });
  const img = r.render();
  return {
    png: img.asPng(),
    rgba: { width: img.width, height: img.height, pixels: new Uint8Array(img.pixels) },
  };
}

/** Packs PNG images into an .ico container (supported by Windows Vista and later). */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

/** Flattens RGBA onto an opaque background and encodes a bottom-up 24-bit BMP. */
export function encodeBmp(img: Rgba, background: [number, number, number] = [255, 255, 255]): Buffer {
  const { width, height, pixels } = img;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const dataSize = rowSize * height;
  const buf = Buffer.alloc(54 + dataSize);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(54 + dataSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(dataSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // resvg returns premultiplied RGBA.
      const a = pixels[i + 3]! / 255;
      const px = (c: number, bg: number) => Math.round(pixels[i + c]! + bg * (1 - a));
      buf[row + x * 3] = px(2, background[2]);
      buf[row + x * 3 + 1] = px(1, background[1]);
      buf[row + x * 3 + 2] = px(0, background[0]);
    }
  }
  return buf;
}
