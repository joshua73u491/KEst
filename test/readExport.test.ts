import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { readExport } from "../src/web/readExport.js";
import { ibkrXml, ibTrade } from "./helpers/ibkrXml.js";

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

  test("IBKR-Flex-Query (XML) wird erkannt und gelesen", () => {
    const r = readExport(ibkrXml({ trades: [ibTrade("BUY", "20260302", "US0000000101", "10", "1000")] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.broker).toBe("IBKR");
      expect(r.data.trades).toHaveLength(1);
    }
  });

  test("Trade Republic wird als Broker benannt", () => {
    const r = readExport(sample);
    expect(r.ok && r.broker).toBe("Trade Republic");
  });

  test("unvollständige Flex Query ergibt eine deutsche Meldung", () => {
    const r = readExport(ibkrXml({ positions: null }));
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/Abschnitt OpenPositions fehlt/) });
  });

  test("auch unerwartete Fehler werden zu einer Meldung", () => {
    const r = readExport('"datetime","date","category","type","asset_class","symbol","shares","amount","fee","currency"\n"1"\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Zeile 2/);
  });
});
