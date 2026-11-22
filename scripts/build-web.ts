// Baut die Web-App:
// - dist/kest-app.html: eine einzige, eigenständige HTML-Datei (z. B. als Artefakt)
// - dist/pwa/: installierbare Web-App für statisches Hosting (Manifest, Service Worker, Symbole, Header)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { headersFile, iconSvg, ICONS, manifest, pwaIndexHtml, scriptHash, serviceWorker } from "../src/pwa/files.js";
import { drawIcon, encodePng } from "../src/pwa/png.js";
import { appIndexHtml } from "../src/app/files.js";

const result = await build({
  entryPoints: ["src/web/main.ts"],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  loader: { ".csv": "text" },
  write: false,
});
const js = result.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script");
// Zeilenumbrüche auf LF: Der Browser wandelt CRLF vor dem Bilden der CSP-Prüfsumme in LF um (HTML-Norm, „Preprocessing
// the input stream“); sonst passt die Prüfsumme auf Windows nicht und das Skript wird blockiert.
const html = readFileSync("web/index.html", "utf8")
  .replace(/\r\n?/g, "\n")
  .replace("<!--APP_SCRIPT-->", () => js);
mkdirSync("dist/pwa", { recursive: true });
writeFileSync("dist/kest-app.html", html);
console.log(`dist/kest-app.html (${Math.round(html.length / 1024)} KB)`);

// Inline-Skript genau so, wie es in der Datei steht (inklusive Zeilenumbrüchen), für die CSP-Prüfsumme
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
if (inline === undefined) throw new Error("Inline-Skript nicht gefunden");
// Relays für den automatischen IBKR-Abruf: lokal immer, weitere über KEST_RELAY_ORIGINS (durch Komma getrennt)
const relays = ["http://localhost:8787", ...(process.env.KEST_RELAY_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
const index = pwaIndexHtml(html, inline, relays);
const version = createHash("sha256").update(index).digest("hex").slice(0, 12);
const files = ["./", "index.html", "manifest.webmanifest", ...ICONS];
writeFileSync("dist/pwa/index.html", index);
writeFileSync("dist/pwa/manifest.webmanifest", manifest());
writeFileSync("dist/pwa/sw.js", serviceWorker(version, files));
writeFileSync("dist/pwa/icon.svg", iconSvg());
writeFileSync("dist/pwa/icon-192.png", encodePng(192, 192, drawIcon(192, false)));
writeFileSync("dist/pwa/icon-512.png", encodePng(512, 512, drawIcon(512, false)));
writeFileSync("dist/pwa/icon-maskable-512.png", encodePng(512, 512, drawIcon(512, true)));
writeFileSync("dist/pwa/_headers", headersFile(scriptHash(inline), relays));
console.log(`dist/pwa/ (Version ${version}, ${files.length} Dateien im Offline-Cache)`);

// Store-App (Android/iOS über Capacitor): Inhalt für `npx cap sync`, siehe capacitor.config.json und docs/STORE-APPS.md
mkdirSync("dist/app", { recursive: true });
writeFileSync("dist/app/index.html", appIndexHtml(html, inline));
console.log("dist/app/ (Store-App, für npx cap sync)");
