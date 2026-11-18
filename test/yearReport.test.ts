import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { computeYear } from "../src/yearReport.js";

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
