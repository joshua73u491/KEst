import { describe, expect, test } from "vitest";
import { computeBasket275 } from "../src/basket275.js";

const usDividend = (grossEur: string, withholdingEur: string) => ({
  grossEur,
  withholdingEur,
  treatyRate: "0.15",
});

describe("27,5 %-Topf: Kursgewinne, Dividenden, Quellensteuer (ausländisches Depot)", () => {
  test("Gewinne und Verluste landen getrennt in KZ 994 und KZ 892 (Verlust als positiver Betrag)", () => {
    const r = computeBasket275({ realizedGainsEur: ["100", "-40", "60"], dividends: [] });
    expect(r.kz994.toString()).toBe("160");
    expect(r.kz892.toString()).toBe("40");
    expect(r.taxableBaseEur.toString()).toBe("120");
    expect(r.taxEur.toString()).toBe("33");
  });

  test("US-Dividende mit 15 % Quellensteuer: 15 % angerechnet, 12,5 % Rest-KESt", () => {
    const r = computeBasket275({ realizedGainsEur: [], dividends: [usDividend("100", "15")] });
    expect(r.kz863.toString()).toBe("100");
    expect(r.kz998.toString()).toBe("15");
    expect(r.taxEur.toString()).toBe("12.5");
  });

  test("Quellensteuer über dem DBA-Satz (30 % ohne W-8BEN) wird nur bis 15 % angerechnet", () => {
    const r = computeBasket275({ realizedGainsEur: [], dividends: [usDividend("100", "30")] });
    expect(r.kz998.toString()).toBe("15");
    expect(r.taxEur.toString()).toBe("12.5");
  });

  test("Testfall 3: Kursverlust im selben Jahr senkt die anrechenbare Quellensteuer", () => {
    // 100 Dividende, 15 Quellensteuer, 60 Kursverlust -> 40 steuerpflichtig.
    // Anrechenbar höchstens die österreichische Steuer auf die verbleibenden 40 (= 11).
    const r = computeBasket275({ realizedGainsEur: ["-60"], dividends: [usDividend("100", "15")] });
    expect(r.taxableBaseEur.toString()).toBe("40");
    expect(r.kz998.toString()).toBe("11");
    expect(r.taxEur.toString()).toBe("0");
  });

  test("verbriefte Derivate (KZ 995/896) und Krypto (KZ 174/176) laufen im selben Topf", () => {
    const r = computeBasket275({
      realizedGainsEur: ["100"],
      derivativeGainsEur: ["50", "-20"],
      cryptoGainsEur: ["30", "-10"],
      dividends: [],
    });
    expect(r.kz995.toString()).toBe("50");
    expect(r.kz896.toString()).toBe("20");
    expect(r.kz174.toString()).toBe("30");
    expect(r.kz176.toString()).toBe("10");
    expect(r.taxableBaseEur.toString()).toBe("150");
    expect(r.taxEur.toString()).toBe("41.25");
  });

  test("Verlustüberhang: keine Steuer, kein Vortrag ins nächste Jahr", () => {
    const r = computeBasket275({ realizedGainsEur: ["-500"], dividends: [usDividend("100", "15")] });
    expect(r.taxableBaseEur.toString()).toBe("0");
    expect(r.kz998.toString()).toBe("0");
    expect(r.taxEur.toString()).toBe("0");
    expect(r.unusedLossEur.toString()).toBe("400");
  });
});
