import { describe, expect, test } from "vitest";
import { Positions } from "../src/costBasis.js";
import { toEur } from "../src/fx.js";

const ISIN = "AT0000000001";
const DEPOT = "TR";

describe("Gleitender Durchschnittspreis je ISIN und Depot (§ 27a Abs 4 Z 3 EStG)", () => {
  test("Testfall 1: drei Käufe zu verschiedenen Kursen, dann Teilverkäufe", () => {
    const p = new Positions();
    p.apply({ isin: ISIN, depot: DEPOT, date: "2025-01-10", side: "buy", quantity: "10", amountEur: "1000" });
    p.apply({ isin: ISIN, depot: DEPOT, date: "2025-02-10", side: "buy", quantity: "10", amountEur: "1200" });

    expect(p.get(ISIN, DEPOT).avgPriceEur.toString()).toBe("110");

    const first = p.apply({ isin: ISIN, depot: DEPOT, date: "2025-03-10", side: "sell", quantity: "5", amountEur: "650" });
    expect(first?.costEur.toString()).toBe("550");
    expect(first?.gainEur.toString()).toBe("100");

    p.apply({ isin: ISIN, depot: DEPOT, date: "2025-04-10", side: "buy", quantity: "5", amountEur: "450" });
    const pos = p.get(ISIN, DEPOT);
    expect(pos.quantity.toString()).toBe("20");
    expect(pos.costEur.toString()).toBe("2100");
    expect(pos.avgPriceEur.toString()).toBe("105");

    const second = p.apply({ isin: ISIN, depot: DEPOT, date: "2025-05-10", side: "sell", quantity: "20", amountEur: "2000" });
    expect(second?.gainEur.toString()).toBe("-100");
    expect(p.get(ISIN, DEPOT).quantity.toString()).toBe("0");
    expect(p.get(ISIN, DEPOT).costEur.toString()).toBe("0");
  });

  test("Bruchstücke (Sparplan-Anteile) werden exakt gerechnet", () => {
    const p = new Positions();
    p.apply({ isin: ISIN, depot: DEPOT, date: "2025-01-02", side: "buy", quantity: "0.3333", amountEur: "33.33" });
    p.apply({ isin: ISIN, depot: DEPOT, date: "2025-02-03", side: "buy", quantity: "0.6667", amountEur: "70" });
    expect(p.get(ISIN, DEPOT).quantity.toString()).toBe("1");
    expect(p.get(ISIN, DEPOT).costEur.toString()).toBe("103.33");
  });

  test("Depots werden getrennt geführt", () => {
    const p = new Positions();
    p.apply({ isin: ISIN, depot: "TR", date: "2025-01-02", side: "buy", quantity: "1", amountEur: "100" });
    p.apply({ isin: ISIN, depot: "IBKR", date: "2025-01-02", side: "buy", quantity: "1", amountEur: "200" });
    expect(p.get(ISIN, "TR").avgPriceEur.toString()).toBe("100");
    expect(p.get(ISIN, "IBKR").avgPriceEur.toString()).toBe("200");
  });

  test("Verkauf von mehr Stück als im Bestand wird abgelehnt", () => {
    const p = new Positions();
    p.apply({ isin: ISIN, depot: DEPOT, date: "2025-01-02", side: "buy", quantity: "1", amountEur: "100" });
    expect(() =>
      p.apply({ isin: ISIN, depot: DEPOT, date: "2025-01-03", side: "sell", quantity: "2", amountEur: "250" }),
    ).toThrow(/Bestand/);
  });

  test("Testfall 2: US-Aktie – Gewinn in USD, aber Verlust in EUR durch den Wechselkurs", () => {
    const p = new Positions();
    // Kauf 10 Stück zu 100 USD, EZB-Kurs 1.10  ->  909.0909... EUR
    p.apply({ isin: "US0000000002", depot: DEPOT, date: "2025-01-02", side: "buy", quantity: "10", amountEur: toEur("1000", "USD", "1.10") });
    // Verkauf 10 Stück zu 110 USD, EZB-Kurs 1.25  ->  880 EUR
    const r = p.apply({ isin: "US0000000002", depot: DEPOT, date: "2025-06-02", side: "sell", quantity: "10", amountEur: toEur("1100", "USD", "1.25") });
    expect(r?.gainEur.toDecimalPlaces(2).toString()).toBe("-29.09");
  });
});
