import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { computeYear } from "../src/yearReport.js";
import { trade, trCsv, type TrRow } from "./helpers/trCsv.js";

const sample = readFileSync(new URL("./fixtures/tr-beispiel.csv", import.meta.url), "utf8");

describe("Jahresauswertung aus dem Trade-Republic-Beispiel", () => {
  const report = computeYear(parseTradeRepublicCsv(sample), 2026);

  test("Kauf aus dem Vorjahr zählt für die Anschaffungskosten, der Gewinn ins Verkaufsjahr", () => {
    // US0000000003: Kauf 2025 zu 50, Verkauf 2026 zu 60 -> +10 in 2026
    expect(report.kz994.toString()).toBe("10");
  });

  test("Kennzahlen je Topf", () => {
    expect(report.kz892.toString()).toBe("20"); // Beispiel AG: 200 -> 180
    expect(report.kz995.toString()).toBe("5"); // Optionsschein: 10 -> 15
    expect(report.kz896.toString()).toBe("3"); // Turbo: 8 -> 5
    expect(report.kz174.toString()).toBe("5"); // BTC: 0.0005 zu 50.000 € gekauft, für 30 € verkauft
    expect(report.kz176.toString()).toBe("0");
    expect(report.kz861.toString()).toBe("2");
  });

  test("Verluste gleichen Gewinne topfübergreifend aus: 10 − 20 + 5 − 3 + 5 = −3", () => {
    expect(report.taxableBaseEur.toString()).toBe("0");
    expect(report.unusedLossEur.toString()).toBe("3");
    expect(report.tax275Eur.toString()).toBe("0");
  });

  test("Bankzinsen werden mit 25 % besteuert und nicht mit Verlusten verrechnet", () => {
    expect(report.tax25Eur.toString()).toBe("0.5");
  });

  test("Spesen werden ausgewiesen, mindern aber im 27,5 %-Topf nicht die Steuer", () => {
    expect(report.feesEur.toString()).toBe("9"); // 9 Trades im Jahr 2026 zu je 1 €
  });

  test("Nicht Berechnetes wird aufgelistet", () => {
    expect(report.notComputed.map((n) => n.reason)).toEqual(["Unbekannter Buchungstyp"]);
  });

  test("Übertrag ins externe Wallet leert die Position ohne Gewinn", () => {
    expect(report.openPositions.find((p) => p.isin === "BTC")).toBeUndefined();
  });
});

describe("Jahresauswertung: Randfälle", () => {
  const year = (...rows: TrRow[]) => computeYear(parseTradeRepublicCsv(trCsv(...rows)), 2026);
  const T = "2026-03-02T10:00:00.000Z";

  test("Kauf und Verkauf mit identischem Zeitstempel: Kauf zuerst, auch wenn der Verkauf in der Datei vorne steht", () => {
    // Kauf 1 Stück zu 100, Verkauf 1 Stück zu 110 in derselben Sekunde -> +10
    const r = year(trade("SELL", T, "US0000000009", "1", "110.00"), trade("BUY", T, "US0000000009", "1", "100.00"));
    expect(r.notComputed).toEqual([]);
    expect(r.kz994.toString()).toBe("10");
  });

  test("Verkauf ohne bekannten Kauf (Kauf vor dem Exportzeitraum) wird als nicht berechnet gemeldet, der Rest wird gerechnet", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "1", "100.00"),
      trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000001", "1", "130.00"), // +30
      trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000002", "2", "50.00"), // Kauf fehlt
    );
    expect(r.kz994.toString()).toBe("30");
    expect(r.realized.map((x) => x.isin)).toEqual(["US0000000001"]);
    expect(r.notComputed).toHaveLength(1);
    expect(r.notComputed[0]).toMatchObject({ line: 4, type: "TRADING/SELL" });
    expect(r.notComputed[0]?.reason).toMatch(/übersteigt den bekannten Bestand von 0/);
    expect(r.notComputed[0]?.reason).toMatch(/vor dem Exportzeitraum/);
  });

  test("nach einem fehlenden Bestand werden spätere Verkäufe derselben ISIN nicht still gerechnet", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000002", "1", "40.00"),
      trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000002", "3", "120.00"), // 2 Stück fehlen
      trade("BUY", "2026-03-02T10:00:00.000Z", "US0000000002", "1", "45.00"),
      trade("SELL", "2026-04-02T10:00:00.000Z", "US0000000002", "1", "50.00"),
    );
    expect(r.realized).toEqual([]);
    expect(r.kz994.toString()).toBe("0");
    expect(r.notComputed.map((n) => n.line)).toEqual([3, 5]);
    expect(r.notComputed[1]?.reason).toMatch(/seit Zeile 3 unvollständig/);
    expect(r.openPositions.find((p) => p.isin === "US0000000002")).toBeUndefined();
  });

  test("Übertrag größer als Bestand wird als nicht berechnet gemeldet", () => {
    const crypto = { asset_class: "CRYPTO" };
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "BTC", "0.001", "50.00", crypto),
      {
        datetime: "2026-02-02T10:00:00.000Z",
        date: "2026-02-02",
        category: "DELIVERY",
        type: "FREE_DELIVERY",
        asset_class: "CRYPTO",
        symbol: "BTC",
        shares: "-0.002",
      },
    );
    expect(r.notComputed).toHaveLength(1);
    expect(r.notComputed[0]).toMatchObject({ line: 3, type: "DELIVERY/FREE_DELIVERY" });
    expect(r.notComputed[0]?.reason).toMatch(/Übertrag von 0.002 Stück BTC/);
  });

  test("sehr kleine Krypto-Bruchteile: exakter Durchschnittspreis ohne Rundungsrest", () => {
    // 0,000000123 BTC für 0,01 € + 0,000000877 BTC für 0,09 € = 0,000001 BTC für 0,10 € (Ø 100.000 €)
    // Verkauf 0,0000005 BTC für 0,07 €: Anschaffungskosten 0,05 €, Gewinn 0,02 €
    // Verkauf Rest 0,0000005 BTC für 0,04 €: Anschaffungskosten 0,05 €, Verlust 0,01 €
    const crypto = { asset_class: "CRYPTO" };
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "BTC", "0.000000123", "0.01", crypto),
      trade("BUY", "2026-01-03T10:00:00.000Z", "BTC", "0.000000877", "0.09", crypto),
      trade("SELL", "2026-01-04T10:00:00.000Z", "BTC", "0.0000005", "0.07", crypto),
      trade("SELL", "2026-01-05T10:00:00.000Z", "BTC", "0.0000005", "0.04", crypto),
    );
    expect(r.realized.map((x) => x.gainEur.toString())).toEqual(["0.02", "-0.01"]);
    expect(r.kz174.toString()).toBe("0.02");
    expect(r.kz176.toString()).toBe("0.01");
    expect(r.openPositions).toEqual([]);
  });

  test("übersprungene Buchung (z. B. Fremdwährung, Kapitalmaßnahme) macht spätere Verkäufe derselben ISIN unsicher", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000005", "1", "100.00"),
      trade("BUY", "2026-02-02T10:00:00.000Z", "US0000000005", "1", "200.00", { currency: "USD" }),
      { datetime: "2026-02-15T10:00:00.000Z", date: "2026-02-15", category: "CORPORATE_ACTION", type: "SPLIT", asset_class: "STOCK", symbol: "US0000000006", shares: "9" },
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000006", "1", "100.00"),
      trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000005", "1", "150.00"),
      trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000006", "1", "20.00"),
    );
    expect(r.realized).toEqual([]);
    expect(r.notComputed.map((n) => n.line)).toEqual([3, 4, 6, 7]);
    expect(r.notComputed[2]?.reason).toMatch(/US0000000005 ist seit Zeile 3 unvollständig/);
    expect(r.notComputed[3]?.reason).toMatch(/US0000000006 ist seit Zeile 4 unvollständig/);
  });

  test("Hinweise ohne Einfluss auf den Bestand (Fonds, Spalte tax) blockieren keine Verkäufe", () => {
    const fund = { asset_class: "ETF" };
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "IE0000000001", "2", "100.00", fund),
      trade("SELL", "2026-03-02T10:00:00.000Z", "IE0000000001", "1", "60.00", { ...fund, tax: "-1.00" }),
    );
    expect(r.realized.map((x) => x.gainEur.toString())).toEqual(["10"]);
  });
});
