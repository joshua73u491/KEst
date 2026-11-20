import { createHash } from "node:crypto";

/**
 * Dateien der installierbaren Web-App (UMSETZUNG 3.5), erzeugt beim Bauen (`npm run build:web` → `dist/pwa/`).
 * Statisches Hosting genügt; wo gehostet wird, entscheidet Joshua (siehe docs/HOSTING.md).
 */

export const THEME_COLOR = "#00a862";
export const ICONS = ["icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png"] as const;

/**
 * Prüfsumme eines Inline-Skripts für die Content-Security-Policy (SHA-256, Base64). Wie im Browser werden CRLF und CR
 * vorher zu LF (HTML-Norm, Vorverarbeitung des Eingabestroms).
 */
export function scriptHash(script: string): string {
  return `sha256-${createHash("sha256").update(script.replace(/\r\n?/g, "\n"), "utf8").digest("base64")}`;
}

/**
 * Content-Security-Policy: Skripte nur mit passender Prüfsumme, Verbindungen nur zur eigenen Seite und zur
 * EZB-Datenschnittstelle (Wechselkurse), keine Einbettung in fremde Seiten.
 */
export function cspFor(hash: string, withFrameAncestors = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' '${hash}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://data-api.ecb.europa.eu",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    ...(withFrameAncestors ? ["frame-ancestors 'none'"] : []),
  ].join("; ");
}

/**
 * Startseite der installierbaren App aus der fertigen HTML-Datei: ohne Schriften von Google (beim Öffnen würde sonst
 * die IP-Adresse an Google gehen; die App fällt auf Systemschriften zurück), mit Manifest, Symbolen und CSP.
 */
export function pwaIndexHtml(html: string, inlineScript: string): string {
  const head = [
    '<link rel="manifest" href="manifest.webmanifest">',
    `<meta name="theme-color" content="${THEME_COLOR}">`,
    '<link rel="icon" href="icon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="icon-192.png">',
    `<meta http-equiv="Content-Security-Policy" content="${cspFor(scriptHash(inlineScript))}">`,
  ].join("\n");
  return html.replace(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\r?\n?/g, "").replace("</head>", `${head}\n</head>`);
}

export function manifest(): string {
  return JSON.stringify(
    {
      name: "KESt-Rücklage",
      short_name: "KESt-Rücklage",
      description: "Rechnet laufend die KESt aus und zeigt, wie viel du für die Steuer zurücklegen musst. Alles bleibt auf deinem Gerät.",
      lang: "de",
      start_url: ".",
      scope: ".",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: THEME_COLOR,
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
      ],
    },
    null,
    2,
  );
}

/** Dasselbe Symbol wie die PNG-Dateien (src/pwa/png.ts), als SVG. */
export function iconSvg(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    `<rect width="100" height="100" rx="22" fill="${THEME_COLOR}"/>` +
    '<rect x="22" y="32" width="56" height="40" rx="5" fill="#fff"/>' +
    `<rect x="36" y="40" width="28" height="6" rx="3" fill="${THEME_COLOR}"/>` +
    "</svg>"
  );
}

/**
 * Service Worker: legt die Dateien der App beim Installieren im Cache ab und liefert sie offline aus. Die Seite selbst
 * kommt zuerst aus dem Netz (für Updates), ohne Netz aus dem Cache. Fremde Adressen (EZB-Kurse) gehen immer ins Netz.
 */
export function serviceWorker(version: string, files: readonly string[]): string {
  return `// KESt-Rücklage, Service Worker (erzeugt beim Bauen)
const CACHE = "kest-${version}";
const FILES = ${JSON.stringify(files)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("kest-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("index.html", copy));
          return res;
        })
        .catch(() => caches.match("index.html")),
    );
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
`;
}

/** Header für statische Hosts, die eine `_headers`-Datei lesen (z. B. Netlify, Cloudflare Pages). */
export function headersFile(hash: string): string {
  return [
    "/*",
    `  Content-Security-Policy: ${cspFor(hash, true)}`,
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "/sw.js",
    "  Cache-Control: no-cache",
    "/index.html",
    "  Cache-Control: no-cache",
    "/manifest.webmanifest",
    "  Content-Type: application/manifest+json",
    "",
  ].join("\n");
}
