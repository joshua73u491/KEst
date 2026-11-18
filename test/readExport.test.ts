import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { readExport } from "../src/web/readExport.js";

const sample = readFileSync(new URL("./fixtures/tr-beispiel.csv", import.meta.url), "utf8");
const wrong = readFileSync(new URL("./fixtures/falsche-datei.csv", import.meta.url), "utf8");

describe("Web-App: Datei einlesen ohne leere Seite", () => {
  test("gültiger Export liefert die Daten", () => {
    const r = readExport(sample);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.trades.length).toBeGreaterThan(0);
  });

  test("falsche Datei liefert eine deutsche Meldung statt einer Ausnahme", () => {
    const r = readExport(wrong);
    expect(r).toEqual({
      ok: false,
      message: expect.stringMatching(/^Die Datei konnte nicht gelesen werden: Die Datei ist kein Trade-Republic-Transaktionsexport/),
    });
  });

  test("leere Datei liefert eine deutsche Meldung", () => {
    const r = readExport("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Die Datei ist leer/);
  });

  test("auch unerwartete Fehler werden zu einer Meldung", () => {
    const r = readExport('"datetime","date","category","type","asset_class","symbol","shares","amount","fee","currency"\n"1"\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Zeile 2/);
  });
});
