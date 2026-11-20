import { describe, expect, test } from "vitest";
import { ecbApiUrl, parseEcbApiCsv, parseEcbHistCsv, parseRateFile, RateTable, toEur } from "../src/fx.js";

describe("toEur – Umrechnung zum EZB-Referenzkurs am Buchungstag", () => {
  test("Euro-Beträge bleiben unverändert", () => {
    expect(toEur("123.45", "EUR").toString()).toBe("123.45");
  });

  test("Fremdwährung wird durch den EZB-Kurs (Einheiten pro 1 EUR) geteilt", () => {
    // EZB: 1 EUR = 1.25 USD  ->  1100 USD = 880 EUR
    expect(toEur("1100", "USD", "1.25").toString()).toBe("880");
  });

  test("ohne Kurs für Fremdwährung wird ein Fehler geworfen statt geschätzt", () => {
    expect(() => toEur("100", "USD")).toThrow(/Wechselkurs fehlt/);
  });

  test("ein Kurs von 0 oder darunter ist ungültig", () => {
    expect(() => toEur("100", "USD", "0")).toThrow(/ungültig/);
  });
});

describe("Kurstabelle (austauschbare Kursquelle)", () => {
  const table = new RateTable([
    ["USD", "2026-11-13", "1.25"],
    ["USD", "2026-11-16", "1.2"],
    ["JPY", "2026-11-13", "160"],
  ]);

  test("liefert den Kurs genau für Währung und Tag", () => {
    expect(table.rate("USD", "2026-11-13")?.toString()).toBe("1.25");
    expect(table.rate("usd", "2026-11-16")?.toString()).toBe("1.2");
    expect(table.rate("JPY", "2026-11-13")?.toString()).toBe("160");
  });

  test("an einem Tag ohne Kurs (Wochenende) gibt es keinen Kurs, auch nicht den vom Vortag", () => {
    expect(table.rate("USD", "2026-11-14")).toBeUndefined();
    expect(table.rate("USD", "2026-11-15")).toBeUndefined();
  });

  test("unbekannte Währung: kein Kurs", () => {
    expect(table.rate("CHF", "2026-11-13")).toBeUndefined();
  });

  test("ungültiger Kurs wird abgelehnt", () => {
    expect(() => new RateTable([["USD", "2026-11-13", "0"]])).toThrow(/ungültig/);
  });
});

describe("EZB-Kursdateien einlesen", () => {
  test("Datei eurofxref-hist.csv der EZB (Spalte je Währung, N/A für fehlende Kurse)", () => {
    const csv = "Date,USD,JPY,CYP,\n2026-11-16,1.2000,161.50,N/A,\n2026-11-13,1.2500,160.00,N/A,\n";
    const t = parseEcbHistCsv(csv);
    expect(t.rate("USD", "2026-11-13")?.toString()).toBe("1.25");
    expect(t.rate("JPY", "2026-11-16")?.toString()).toBe("161.5");
    expect(t.rate("CYP", "2026-11-16")).toBeUndefined();
  });

  test("CSV der EZB-Datenschnittstelle (data-api.ecb.europa.eu, format=csvdata)", () => {
    const csv =
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE\n" +
      'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-13,1.25,A,"US dollar/Euro, ECB reference exchange rate"\n' +
      'EXR.D.JPY.EUR.SP00.A,D,JPY,EUR,SP00,A,2026-11-13,160,A,"Japanese yen/Euro, ECB reference exchange rate"\n';
    const t = parseEcbApiCsv(csv);
    expect(t.rate("USD", "2026-11-13")?.toString()).toBe("1.25");
    expect(t.rate("JPY", "2026-11-13")?.toString()).toBe("160");
  });

  test("Format wird erkannt; ZIP und fremde Dateien werden mit deutscher Meldung abgelehnt", () => {
    expect(parseRateFile("Date,USD,\n2026-11-13,1.25,\n").rate("USD", "2026-11-13")?.toString()).toBe("1.25");
    expect(parseRateFile("KEY,CURRENCY,TIME_PERIOD,OBS_VALUE\nX,USD,2026-11-13,1.25\n").rate("USD", "2026-11-13")?.toString()).toBe("1.25");
    expect(() => parseRateFile("PK\u0003\u0004binär")).toThrow(/ZIP-Datei/);
    expect(() => parseRateFile('"datetime","date"\n')).toThrow(/keine EZB-Kursdatei/);
  });

  test("Abfrage-Adresse der EZB-Datenschnittstelle: nur Währungen und Zeitraum", () => {
    expect(ecbApiUrl(["USD", "JPY", "USD"], "2026-01-02", "2026-11-19")).toBe(
      "https://data-api.ecb.europa.eu/service/data/EXR/D.JPY+USD.EUR.SP00.A?startPeriod=2026-01-02&endPeriod=2026-11-19&format=csvdata",
    );
  });
});
