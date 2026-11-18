import { describe, expect, test } from "vitest";
import { reserveTarget } from "../src/reserve.js";

describe("Soll-Rücklage", () => {
  test("Summe der Steuern plus prozentualer Sicherheitspuffer", () => {
    const r = reserveTarget({ basket275TaxEur: "100", tariffExtraTaxEur: "50", bufferRate: "0.1" });
    expect(r.toString()).toBe("165");
  });

  test("ohne Puffer genau die Steuer", () => {
    expect(reserveTarget({ basket275TaxEur: "33", tariffExtraTaxEur: "0", bufferRate: "0" }).toString()).toBe("33");
  });

  test("Steuer auf Bankzinsen (25 %) zählt mit", () => {
    const r = reserveTarget({ basket275TaxEur: "10", bankInterestTaxEur: "0.5", tariffExtraTaxEur: "0", bufferRate: "0" });
    expect(r.toString()).toBe("10.5");
  });

  test("negativer Puffer ist ungültig", () => {
    expect(() => reserveTarget({ basket275TaxEur: "1", tariffExtraTaxEur: "0", bufferRate: "-0.1" })).toThrow(/Puffer/);
  });
});
