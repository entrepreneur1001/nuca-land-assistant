/**
 * Draws the app icons (a white house on the site's blue) used by the web app manifest and iOS home screen:
 *   npx tsx scripts/tools/make-icons.mts   → public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png
 * No image library: plain RGBA pixels, 4× supersampled, written as PNG with zlib.
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x2f, 0x5b, 0xd8];
const FG = [0xff, 0xff, 0xff];

/** Is (x, y) in unit coordinates (0..1) part of the house? Kept inside the central 60% so it survives maskable crops. */
function house(x: number, y: number): boolean {
  const door = x > 0.45 && x < 0.55 && y > 0.6 && y < 0.72;
  if (door) return false;
  const body = x > 0.31 && x < 0.69 && y >= 0.47 && y < 0.72;
  // Roof: a triangle from (0.22, 0.5) to (0.78, 0.5) with its apex at (0.5, 0.26).
  const roof = y >= 0.26 && y < 0.5 && Math.abs(x - 0.5) < ((y - 0.26) / 0.24) * 0.28;
  return body || roof;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size: number): Buffer {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (house((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)) hit++;
      const a = hit / (SS * SS);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + FG[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

for (const [file, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]] as const) {
  writeFileSync(`public/${file}`, png(size));
  console.log(`public/${file}`);
}
