import { describe, expect, test } from "vitest";
import { fileData } from "../src/app/fileData.js";
import { appIndexHtml } from "../src/app/files.js";
import { scriptHash } from "../src/pwa/files.js";

/** Store-App (Android/iOS über Capacitor): dieselbe Web-App, aber ohne Service Worker, Manifest und fremde Schriften. */
describe("Startseite der Store-App", () => {
  const template =
    '<!doctype html><html><head>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet">\n</head><body><script>\nAPP\n</script></body></html>';
  const html = appIndexHtml(template, "\nAPP\n");

  test("kein Manifest und damit kein Service Worker (die Dateien liegen ohnehin auf dem Gerät)", () => {
    expect(html).not.toContain('rel="manifest"');
    expect(html).not.toContain("sw.js");
  });

  test("keine Schriften von Google", () => {
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  test("Content-Security-Policy mit Prüfsumme des Skripts, Verbindungen nur zur EZB, kein Relay", () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(csp).toContain(`script-src 'self' '${scriptHash("\nAPP\n")}'`);
    expect(csp).toContain("connect-src 'self' https://data-api.ecb.europa.eu");
    expect(csp).not.toContain("localhost:8787");
  });

  test("Viewport für Handys mit Notch (viewport-fit=cover)", () => {
    expect(html).toContain("viewport-fit=cover");
  });
});

describe("Dateien speichern in der Store-App", () => {
  test("Text wird als UTF-8 geschrieben, Umlaute bleiben erhalten", () => {
    expect(fileData("Kennzahl;Betrag\nKZ 994;Überschuss")).toEqual({ data: "Kennzahl;Betrag\nKZ 994;Überschuss", utf8: true });
  });

  test("PDF (Bytes) wird als Base64 geschrieben", () => {
    expect(fileData(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toEqual({ data: "JVBERg==", utf8: false });
  });
});
