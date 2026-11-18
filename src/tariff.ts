import { dec, D, ZERO, type Dec, type DecInput } from "./decimal.js";

/** Tarifstufen 2026 nach § 33 Abs 1 EStG (Obergrenze der Stufe, Grenzsteuersatz). */
const BRACKETS_2026: Array<[upTo: Dec | null, rate: Dec]> = [
  [dec(13539), dec(0)],
  [dec(21992), dec("0.20")],
  [dec(36458), dec("0.30")],
  [dec(70365), dec("0.40")],
  [dec(104859), dec("0.48")],
  [dec(1000000), dec("0.50")],
  [null, dec("0.55")],
];

/**
 * Einkommensteuer 2026 vor Absetzbeträgen.
 * Absetzbeträge bleiben bewusst unberücksichtigt: Die Rücklage fällt dadurch eher zu hoch als zu niedrig aus.
 */
export function incomeTax2026(incomeEur: DecInput): Dec {
  const income = D.max(ZERO, dec(incomeEur));
  let tax = ZERO;
  let lower = ZERO;
  for (const [upTo, rate] of BRACKETS_2026) {
    const top = upTo === null ? income : D.min(income, upTo);
    if (top.gt(lower)) tax = tax.plus(top.minus(lower).times(rate));
    if (upTo === null || income.lte(upTo)) break;
    lower = upTo;
  }
  return tax;
}

/**
 * Mehrsteuer durch tarifbesteuerte Kapitaleinkünfte (KZ 857, z. B. Optionen ohne freiwilligen KESt-Abzug).
 * Ein negativer Saldo in KZ 857 senkt keine anderen Einkünfte.
 */
export function extraTaxOnTariffIncome(args: { otherIncomeEur: DecInput; kz857Eur: DecInput }): Dec {
  const kz857 = D.max(ZERO, dec(args.kz857Eur));
  const other = dec(args.otherIncomeEur);
  return incomeTax2026(other.plus(kz857)).minus(incomeTax2026(other));
}
