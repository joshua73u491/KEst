import { deflateSync } from "node:zlib";

/**
 * Kleiner PNG-Schreiber für die App-Symbole (nur beim Bauen, nicht im Browser). PNG laut W3C-Norm:
 * Signatur, IHDR (RGBA, 8 Bit), IDAT (zlib), IEND, je Chunk CRC-32.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA-Pixel (Zeile für Zeile) als PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 Bit, RGBA, Standard-Kompression, Filter, ohne Interlace
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // Filter „None“
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const GREEN = [0, 168, 98] as const;
const WHITE = [255, 255, 255] as const;

/** Punkt in einem Rechteck mit runden Ecken (Koordinaten 0..1) */
function inRoundRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * Symbol: grüne Fläche (wie das Band der App) mit einem weißen Umschlag für die Rücklage, darin ein grüner Schlitz.
 * `maskable`: volle Fläche ohne runde Ecken, Inhalt in den inneren 80 % (sichere Zone laut Web-App-Manifest).
 */
export function drawIcon(size: number, maskable: boolean): Uint8Array {
  const s = maskable ? 0.8 : 1; // Inhalt verkleinern
  const c = (v: number) => 0.5 + (v - 0.5) * s;
  const out = new Uint8Array(size * size * 4);
  const N = 4; // 4×4 Abtastpunkte je Pixel für glatte Kanten
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let opaque = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = (px + (sx + 0.5) / N) / size;
          const y = (py + (sy + 0.5) / N) / size;
          const base = maskable || inRoundRect(x, y, 0, 0, 1, 1, 0.22);
          if (!base) continue;
          const body = inRoundRect(x, y, c(0.22), c(0.32), c(0.78), c(0.72), 0.05 * s);
          const slot = inRoundRect(x, y, c(0.36), c(0.4), c(0.64), c(0.46), 0.03 * s);
          const col = body && !slot ? WHITE : GREEN;
          r += col[0];
          g += col[1];
          b += col[2];
          opaque++;
        }
      }
      const i = (py * size + px) * 4;
      if (opaque > 0) {
        out[i] = Math.round(r / opaque);
        out[i + 1] = Math.round(g / opaque);
        out[i + 2] = Math.round(b / opaque);
      }
      out[i + 3] = Math.round((opaque / (N * N)) * 255);
    }
  }
  return out;
}
