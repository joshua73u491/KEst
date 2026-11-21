import { inflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { cspFor, headersFile, manifest, pwaIndexHtml, scriptHash, serviceWorker } from "../src/pwa/files.js";
import { crc32, drawIcon, encodePng } from "../src/pwa/png.js";

/** Installierbare Web-App (UMSETZUNG 3.5): Manifest, Offline-Betrieb, statisches Hosting. */

const template =
  '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>KESt-Rücklage</title>' +
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">\n</head><body><script>\nAPP\n</script></body></html>';

describe("Startseite der installierbaren Web-App", () => {
  const html = pwaIndexHtml(template, "\nAPP\n");

  test("keine Schriften von Google: nichts wird beim Öffnen an Dritte übertragen", () => {
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  test("Manifest, Farbe, Symbol und Inhaltssicherheit sind eingebunden", () => {
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest">');
    expect(html).toContain('<meta name="theme-color" content="#00a862">');
    expect(html).toContain('<link rel="apple-touch-icon" href="icon-192.png">');
    expect(html).toContain(`'${scriptHash("\nAPP\n")}'`);
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
  });

  test("Inhaltssicherheit: Skripte nur mit Prüfsumme, Verbindungen nur zur eigenen Seite und zur EZB", () => {
    const csp = cspFor("sha256-abc");
    expect(csp).toContain("script-src 'self' 'sha256-abc'");
    expect(csp).toContain("connect-src 'self' https://data-api.ecb.europa.eu");
    expect(csp).toContain("object-src 'none'");
  });

  test("Relays für den IBKR-Abruf werden in connect-src ergänzt", () => {
    expect(cspFor("sha256-abc", false, ["http://localhost:8787", "https://relay.example"])).toContain(
      "connect-src 'self' https://data-api.ecb.europa.eu http://localhost:8787 https://relay.example",
    );
  });

  test("Prüfsumme nach CSP-Regeln (SHA-256, Base64)", () => {
    expect(scriptHash("")).toBe("sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
  });

  test("Windows-Zeilenumbrüche: Prüfsumme wie im Browser über LF", () => {
    expect(scriptHash("a\r\nb")).toBe(scriptHash("a\nb"));
  });
});

describe("Manifest", () => {
  const m = JSON.parse(manifest()) as Record<string, unknown> & { icons: Array<{ src: string; sizes: string; purpose?: string }> };

  test("Pflichtangaben für die Installation", () => {
    expect(m).toMatchObject({ name: "KESt-Rücklage", short_name: "KESt-Rücklage", start_url: ".", scope: ".", display: "standalone", lang: "de" });
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });
});

describe("Service Worker für den Offline-Betrieb", () => {
  const sw = serviceWorker("abc123", ["./", "index.html", "manifest.webmanifest"]);

  test("legt alle Dateien der App im Cache ab, Name mit Version", () => {
    expect(sw).toContain('const CACHE = "kest-abc123"');
    expect(sw).toContain('["./","index.html","manifest.webmanifest"]');
  });

  test("fremde Adressen (z. B. EZB-Kurse) gehen immer ins Netz und werden nie zwischengespeichert", () => {
    expect(sw).toContain("url.origin !== self.location.origin");
  });

  test("alte Versionen werden beim Aktivieren gelöscht", () => {
    expect(sw).toMatch(/caches\.delete/);
  });
});

describe("Hosting-Vorbereitung", () => {
  test("Header-Datei für statisches Hosting: Sicherheit und kein Zwischenspeichern von sw.js", () => {
    const h = headersFile("sha256-abc");
    expect(h).toContain("Content-Security-Policy: ");
    expect(h).toContain("X-Content-Type-Options: nosniff");
    expect(h).toMatch(/\/sw\.js\n {2}Cache-Control: no-cache/);
  });
});

describe("App-Symbole als PNG", () => {
  test("gültige PNG-Datei: Signatur, Größe, Prüfsummen, Bilddaten", () => {
    const png = encodePng(2, 1, Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]));
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(2); // Breite
    expect(view.getUint32(20)).toBe(1); // Höhe
    // IHDR-Prüfsumme
    expect(view.getUint32(29)).toBe(crc32(png.subarray(12, 29)));
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(Array.from(raw)).toEqual([0, 255, 0, 0, 255, 0, 255, 0, 255]);
  });

  test("CRC-32 nach PNG-Norm", () => {
    expect(crc32(new TextEncoder().encode("IEND")).toString(16)).toBe("ae426082");
  });

  test("Symbol: grüner Hintergrund, weiße Fläche in der Mitte; maskierbar ohne Rand", () => {
    const size = 64;
    const icon = drawIcon(size, false);
    const px = (x: number, y: number) => Array.from(icon.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
    expect(px(32, 34)).toEqual([255, 255, 255, 255]);
    expect(px(4, 32)).toEqual([0, 168, 98, 255]);
    expect(px(0, 0)[3]).toBe(0); // runde Ecke: durchsichtig
    expect(drawIcon(size, true).subarray(3, 4)[0]).toBe(255); // maskierbar: volle Fläche
  });
});
