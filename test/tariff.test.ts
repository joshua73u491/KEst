import { describe, expect, test } from "vitest";
import { extraTaxOnTariffIncome, incomeTax2026 } from "../src/tariff.js";

describe("Einkommensteuertarif 2026 (§ 33 EStG), ohne Absetzbeträge", () => {
  test.each([
    ["0", "0"],
    ["13539", "0"],
    ["21992", "1690.6"],
    ["30000", "4093"],
    ["36458", "6030.4"],
    ["70365", "19593.2"],
  ])("Einkommen %s € -> Steuer %s €", (income, tax) => {
    expect(incomeTax2026(income).toString()).toBe(tax);
  });

  test("über 1 Mio. € gilt 55 %", () => {
    const at1m = incomeTax2026("1000000");
    expect(incomeTax2026("1001000").minus(at1m).toString()).toBe("550");
  });

  test("Mehrsteuer durch tarifbesteuerte Derivate (KZ 857) = ESt(sonst + 857) − ESt(sonst)", () => {
    expect(extraTaxOnTariffIncome({ otherIncomeEur: "30000", kz857Eur: "5000" }).toString()).toBe("1500");
  });

  test("Verlust in KZ 857 senkt keine anderen Einkünfte: Mehrsteuer ist 0", () => {
    expect(extraTaxOnTariffIncome({ otherIncomeEur: "30000", kz857Eur: "-2000" }).toString()).toBe("0");
  });
});
