import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { formatEur, formatReport } from "../src/format.js";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { computeYear } from "../src/yearReport.js";

describe("Ausgabe", () => {
  test("Euro-Beträge auf Cent gerundet, deutsches Format", () => {
    expect(formatEur("1234.565")).toBe("1.234,57 €");
    expect(formatEur("-3.5")).toBe("-3,50 €");
  });

  test("Bericht nennt Kennzahlen, Steuer und nicht Berechnetes", () => {
    const sample = readFileSync(new URL("./fixtures/tr-beispiel.csv", import.meta.url), "utf8");
    const text = formatReport(computeYear(parseTradeRepublicCsv(sample), 2026));
    expect(text).toContain("KZ 994  Überschüsse Wertpapiere             10,00 €");
    expect(text).toContain("KZ 896  Verluste Derivate                    3,00 €");
    expect(text).toContain("Steuer 27,5 %                                0,00 €");
    expect(text).toContain("Zeile 16: CASH/SOMETHING_NEW – Unbekannter Buchungstyp");
  });
});
