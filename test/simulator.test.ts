import { describe, expect, test } from "vitest";
import { dec } from "../src/decimal.js";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { addEntry, emptyLedger, reserveStatus, type YearSoll } from "../src/ledger.js";
import { checkOrder, simulateSale } from "../src/simulator.js";
import { trade, trCsv } from "./helpers/trCsv.js";

/**
 * Verkaufs-Simulator und Kauf-Check (UMSETZUNG 3.3, PRODUKTPLAN „Funktionen“): reine Rechnung, keine Empfehlung.
 * Grundlage: Kauf 10 Stück für 1.000 € (Ø 100 €), Verkauf 4 Stück für 520 € -> Gewinn 120 €, Steuer 27,5 % = 33 €.
 */
const data = parseTradeRepublicCsv(
  trCsv(
    trade("BUY", "2026-01-15T10:00:00.000Z", "DE0000000301", "10", "1000.00"),
    trade("SELL", "2026-03-02T10:00:00.000Z", "DE0000000301", "4", "520.00"),
  ),
);
const TODAY = "2026-11-20";
const sim = (quantity: string, priceEur: string, over = {}) =>
  simulateSale({ data, options: {}, bufferPct: 10, today: TODAY, isin: "DE0000000301", depot: "TR", quantity, priceEur, ...over });

describe("Verkaufs-Simulator: Was kostet dieser Verkauf steuerlich?", () => {
  test("Verkauf mit Verlust senkt die Steuer des Jahres", () => {
    // Rest 6 Stück zu Ø 100 € = 600 €; Verkauf zu 90 € = 540 € -> Verlust 60 €.
    // Steuer vorher 33 €, nachher 27,5 % von 60 € = 16,50 € -> 16,50 € weniger; Soll 36,30 € -> 18,15 €
    const s = sim("6", "90");
    expect(s.holdingQuantity.toString()).toBe("6");
    expect(s.avgPriceEur.toString()).toBe("100");
    expect(s.proceedsEur.toString()).toBe("540");
    expect(s.costEur.toString()).toBe("600");
    expect(s.gainEur.toString()).toBe("-60");
    expect(s.taxBeforeEur.toString()).toBe("33");
    expect(s.taxAfterEur.toString()).toBe("16.5");
    expect(s.taxChangeEur.toString()).toBe("-16.5");
    expect(s.sollBeforeEur.toString()).toBe("36.3");
    expect(s.sollAfterEur.toString()).toBe("18.15");
    expect(s.year).toBe(2026);
    expect(s.taxedByBroker).toBe(false);
  });

  test("Teilverkauf mit Gewinn erhöht die Steuer", () => {
    // 3 Stück zu 150 € = 450 €, Anschaffungskosten 300 € -> +150 €; Steuer 27,5 % von 270 € = 74,25 € (+41,25 €)
    const s = sim("3", "150");
    expect(s.gainEur.toString()).toBe("150");
    expect(s.taxAfterEur.toString()).toBe("74.25");
    expect(s.taxChangeEur.toString()).toBe("41.25");
  });

  test("Spesen mindern den Gewinn im 27,5 %-Topf nicht", () => {
    expect(sim("3", "150", { feeEur: "5" }).taxChangeEur.toString()).toBe("41.25");
  });

  test("mehr Stück als vorhanden, unbekannte Position oder ungültiger Preis: deutsche Meldung", () => {
    expect(() => sim("7", "100")).toThrow(/nur 6 Stück/);
    expect(() => sim("1", "100", { isin: "US0000000999" })).toThrow(/keine offene Position/);
    expect(() => sim("1", "0")).toThrow(/Preis/);
    expect(() => sim("0", "100")).toThrow(/Stückzahl/);
  });

  test("Trade Republic steuereinfach: der Verkauf wäre endbesteuert und ändert die E1kv nicht", () => {
    const s = sim("6", "150", { options: { taxSimpleSince: "2026-06-01" } });
    expect(s.taxedByBroker).toBe(true);
    expect(s.taxChangeEur.toString()).toBe("0");
    expect(s.gainEur.toString()).toBe("300");
  });
});

describe("Kauf-Check: Reicht das freie Geld nach Abzug der Rücklage?", () => {
  // Soll 3.025 €, eingetragen 1.000 € -> in der Rücklage fehlen 2.025 €
  const years: YearSoll[] = [{ year: 2026, sollEur: dec("3025"), peakEur: dec("3025"), complete: true }];
  const status = reserveStatus(years, addEntry(emptyLedger(), { id: "a", date: "2026-11-01", valueEur: "1000", place: "Tagesgeld", note: "" }), TODAY);

  test("Rücklage liegt woanders: nur der Fehlbetrag muss im Guthaben bleiben", () => {
    // 5.000 € Guthaben − 2.025 € Fehlbetrag = 2.975 € frei
    expect(checkOrder({ cashEur: "5000", orderEur: "2500", reserveInAccount: false }, status)).toMatchObject({ enough: true });
    const c = checkOrder({ cashEur: "5000", orderEur: "3500", reserveInAccount: false }, status);
    expect(c.mustKeepEur.toString()).toBe("2025");
    expect(c.freeEur.toString()).toBe("2975");
    expect(c.enough).toBe(false);
    expect(c.missingEur.toString()).toBe("525");
  });

  test("Rücklage liegt in diesem Guthaben: das ganze Soll muss bleiben", () => {
    // 5.000 € − 3.025 € = 1.975 € frei; Order 2.500 € -> es fehlen 525 €
    const c = checkOrder({ cashEur: "5000", orderEur: "2500", reserveInAccount: true }, status);
    expect(c.mustKeepEur.toString()).toBe("3025");
    expect(c.freeEur.toString()).toBe("1975");
    expect(c.missingEur.toString()).toBe("525");
  });

  test("bis zum 31.12. zählt der Höchststand des Solls (Testfall 6)", () => {
    // Soll jetzt 605 €, Höchststand 3.025 €; Rücklage im Guthaben -> 3.025 € müssen bleiben
    const locked = reserveStatus([{ year: 2026, sollEur: dec("605"), peakEur: dec("3025"), complete: true }], emptyLedger(), "2026-12-20");
    expect(locked.requiredEur.toString()).toBe("3025");
    // 4.000 € − 3.025 € = 975 € frei: 900 € reichen, 1.000 € nicht
    expect(checkOrder({ cashEur: "4000", orderEur: "900", reserveInAccount: true }, locked).enough).toBe(true);
    expect(checkOrder({ cashEur: "4000", orderEur: "1000", reserveInAccount: true }, locked).missingEur.toString()).toBe("25");
    expect(checkOrder({ cashEur: "4000", orderEur: "1000", reserveInAccount: false }, locked).mustKeepEur.toString()).toBe("3025");
  });

  test("ungültige Beträge werden abgelehnt", () => {
    expect(() => checkOrder({ cashEur: "viel", orderEur: "100", reserveInAccount: false }, status)).toThrow(/Guthaben/);
    expect(() => checkOrder({ cashEur: "100", orderEur: "-1", reserveInAccount: false }, status)).toThrow(/Order/);
  });
});
