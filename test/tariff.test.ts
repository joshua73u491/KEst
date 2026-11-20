import { describe, expect, test } from "vitest";
import { extraTaxOnTariffIncome, hasTariff, incomeTax } from "../src/tariff.js";

// Tarifstufen laut BMF (https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/steuertarif-steuerabsetzbetraege/steuertarif-steuerabsetzbetraege.html,
// Stand 01.01.2026) und § 33 Abs. 1 EStG. Steuer jeweils von Hand: Summe über die Stufen.

describe("Einkommensteuertarif 2026 (§ 33 EStG), ohne Absetzbeträge", () => {
  test.each([
    ["0", "0"],
    ["13539", "0"],
    ["21992", "1690.6"], // 20 % × 8.453
    ["30000", "4093"], // 1.690,6 + 30 % × 8.008
    ["36458", "6030.4"],
    ["70365", "19593.2"],
  ])("Einkommen %s € -> Steuer %s €", (income, tax) => {
    expect(incomeTax(2026, income).toString()).toBe(tax);
  });

  test("über 1 Mio. € gilt 55 %", () => {
    const at1m = incomeTax(2026, "1000000");
    expect(incomeTax(2026, "1001000").minus(at1m).toString()).toBe("550");
  });
});

describe("Einkommensteuertarif 2025 und 2024", () => {
  test.each([
    ["13308", "0"],
    ["21617", "1661.8"], // 20 % × (21.617 − 13.308)
    ["35836", "5927.5"], // 1.661,8 + 30 % × 14.219
  ])("2025: Einkommen %s € -> Steuer %s €", (income, tax) => {
    expect(incomeTax(2025, income).toString()).toBe(tax);
  });

  test("2024: Einkommen 20.818 € -> 20 % × 8.002 = 1.600,40 €", () => {
    expect(incomeTax(2024, "20818").toString()).toBe("1600.4");
  });

  test("nicht hinterlegtes Jahr: Fehler statt Schätzung mit dem Tarif eines anderen Jahres", () => {
    expect(hasTariff(2027)).toBe(false);
    expect(() => incomeTax(2027, "30000")).toThrow(/Einkommensteuertarif 2027 ist in der App noch nicht hinterlegt/);
  });
});

describe("Mehrsteuer durch tarifbesteuerte Derivate (KZ 857)", () => {
  test("ESt(sonst + 857) − ESt(sonst): 30.000 € sonstiges Einkommen, 5.000 € KZ 857 -> 30 % = 1.500 € (2026)", () => {
    expect(extraTaxOnTariffIncome({ year: 2026, otherIncomeEur: "30000", kz857Eur: "5000" }).toString()).toBe("1500");
  });

  test("über eine Stufengrenze: 2025, 33.000 € + 5.000 € -> 30 % × 2.836 + 40 % × 2.164 = 1.716,40 €", () => {
    expect(extraTaxOnTariffIncome({ year: 2025, otherIncomeEur: "33000", kz857Eur: "5000" }).toString()).toBe("1716.4");
  });

  test("Verlust in KZ 857 senkt keine anderen Einkünfte: Mehrsteuer ist 0", () => {
    expect(extraTaxOnTariffIncome({ year: 2026, otherIncomeEur: "30000", kz857Eur: "-2000" }).toString()).toBe("0");
  });
});
