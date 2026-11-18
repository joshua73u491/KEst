import { describe, expect, test } from "vitest";
import { toEur } from "../src/fx.js";

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
