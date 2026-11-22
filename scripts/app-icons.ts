// Ersetzt die Platzhalterbilder von Capacitor (Symbol und Startbild) in android/ und ios/ durch das Symbol der App
// (dasselbe wie in der Web-App, src/pwa/png.ts). Jede vorhandene PNG-Datei wird in ihrer Größe neu gezeichnet.
// Aufruf: npm run app:icons (nach `npx cap add android|ios`).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_COLOR } from "../src/pwa/files.js";
import { drawIcon, encodePng } from "../src/pwa/png.js";

const sizeOf = (file: string) => {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

const pngs = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? pngs(p) : n.endsWith(".png") ? [p] : [];
  });

/** Startbild: weiß, Symbol in der Mitte (30 % der kürzeren Seite). */
function splash(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4).fill(255);
  const s = Math.round(Math.min(w, h) * 0.3);
  const icon = drawIcon(s, false);
  const x0 = Math.floor((w - s) / 2);
  const y0 = Math.floor((h - s) / 2);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const o = ((y0 + y) * w + x0 + x) * 4;
      const a = icon[i + 3]! / 255;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(icon[i + c]! * a + 255 * (1 - a));
    }
  }
  return out;
}

let count = 0;
for (const file of [...pngs("android/app/src/main/res"), ...pngs("ios/App/App/Assets.xcassets")]) {
  const { w, h } = sizeOf(file);
  const name = file.replace(/\\/g, "/");
  let rgba: Uint8Array;
  if (/splash/.test(name)) rgba = splash(w, h);
  // Adaptives Android-Symbol (Vordergrund) und iOS-Symbol: vollflächig, Inhalt in der sicheren Zone; iOS rundet selbst ab
  else if (/ic_launcher_foreground|AppIcon/.test(name)) rgba = drawIcon(w, true);
  else rgba = drawIcon(w, false);
  writeFileSync(file, encodePng(w, h, rgba));
  count++;
}
// Hintergrund des adaptiven Android-Symbols in der Farbe der App
writeFileSync(
  "android/app/src/main/res/values/ic_launcher_background.xml",
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${THEME_COLOR.toUpperCase()}</color>\n</resources>\n`,
);
console.log(`${count} Bilder neu gezeichnet`);
