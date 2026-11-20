import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { formatEur, formatFindings, formatLocations, formatReport } from "../src/format.js";
import { RateTable } from "../src/fx.js";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { computeYear } from "../src/yearReport.js";
import { parseIbkrFlexXml } from "../src/import/ibkrFlex.js";
import { ibCash, ibkrXml } from "./helpers/ibkrXml.js";
import { dividend, interest, trCsv } from "./helpers/trCsv.js";

describe("Ausgabe des Prüfassistenten", () => {
  test("Schweregrad, Text und Fundstellen, nach Datei gruppiert", () => {
    const text = formatFindings([
      { severity: "error", code: "insufficient-position", text: "Verkauf ohne Bestand.", at: [{ line: 3, file: "a.csv" }] },
      { severity: "warning", code: "unknown-type", text: "Unbekannt.", at: [{ line: 2, file: "a.csv" }, { line: 5, file: "a.csv" }, { line: 4, file: "b.csv" }] },
      { severity: "info", code: "duplicate", text: "Doppelt.", at: [] },
    ]);
    expect(text).toBe(
      [
        "Prüfassistent: Buchungen prüfen",
        "[Fehler]  Verkauf ohne Bestand. (a.csv, Zeile 3)",
        "[Warnung] Unbekannt. (a.csv, Zeilen 2, 5; b.csv, Zeile 4)",
        "[Hinweis] Doppelt.",
      ].join("\n"),
    );
  });

  test("ohne Auffälligkeiten eine kurze Zeile", () => {
    expect(formatFindings([])).toBe("Prüfassistent: keine Auffälligkeiten in den Buchungen.");
  });

  test("Fundstellen ohne Datei und lange Listen werden gekürzt", () => {
    expect(formatLocations([1, 2, 3, 4, 5, 6, 7].map((line) => ({ line })))).toBe("Zeilen 1, 2, 3, 4, 5 und 2 weitere");
  });
});

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

  test("Bericht zeigt Dividenden mit anrechenbarer Quellensteuer und Endbesteuertes getrennt", () => {
    const csv = trCsv(
      dividend("2026-04-15T00:00:00.000000Z", "DE0000000001", "100.00", "-26.38", { name: "Beispiel Dividende AG" }),
      interest("2026-07-01T00:00:00.000000Z", "4.00", { tax: "-1.10" }),
    );
    const text = formatReport(computeYear(parseTradeRepublicCsv(csv), 2026, { taxSimpleSince: "2026-05-01" }));
    expect(text).toContain("Trade Republic zieht die KESt seit 2026-05-01 selbst ab (steuereinfach).");
    expect(text).toContain("Dividenden (brutto · einbehalten · anrechenbar)");
    expect(text).toMatch(/2026-04-15 {2}Beispiel Dividende AG \(DE\) +100,00 € · 26,38 € · 15,00 €/);
    expect(text).toContain("Von Trade Republic bereits versteuert (zählt nicht für E1kv und Rücklage)");
    expect(text).toMatch(/2026-07-01 {2}Zinsen +4,00 € · 1,10 € einbehalten/);
    expect(text).toMatch(/Einbehalten von Trade Republic +1,10 €/);
    // Kennzahlen nur aus der Zeit vor der Umstellung
    expect(text).toMatch(/KZ 861 {2}Zinsen aus Geldeinlagen +0,00 €/);
  });

  test("Bericht nennt Broker-Zinsen und die gewählte Kennzahl", () => {
    const xml = ibkrXml({ cash: [ibCash("Broker Interest Received", "20260905;202000", "10.00", { currency: "EUR" })] });
    const text = formatReport(computeYear(parseIbkrFlexXml(xml), 2026));
    expect(text).toMatch(/ {2}IBKR-Zinsen, Einstellung KZ 863 +10,00 €/);
    const alt = formatReport(computeYear(parseIbkrFlexXml(xml), 2026, { brokerInterestKz: "861" }));
    expect(alt).toMatch(/ {2}IBKR-Zinsen, Einstellung KZ 861 +10,00 €/);
  });

  test("Bericht nennt bei Dividenden in Fremdwährung Währung und EZB-Kurs", () => {
    const csv = trCsv(
      dividend("2026-04-15T00:00:00.000000Z", "US0000000001", "90.00", "-13.50", {
        name: "Amerika Beispiel",
        original_amount: "100.00",
        original_currency: "USD",
        fx_rate: "0.9",
      }),
    );
    const rates = new RateTable([["USD", "2026-04-15", "1.25"]]);
    const text = formatReport(computeYear(parseTradeRepublicCsv(csv), 2026, { rates }));
    expect(text).toMatch(/2026-04-15 {2}Amerika Beispiel \(US\) +80,00 € · 12,00 € · 12,00 € {2}\(USD, EZB-Kurs 1\.25\)/);
  });
});
