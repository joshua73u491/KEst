import { dec, D, ZERO, type Dec, type DecInput } from "./decimal.js";

/**
 * Einkommensteuertarif nach § 33 Abs. 1 EStG je Jahr (Obergrenze der Stufe, Grenzsteuersatz).
 * Quelle: BMF, Steuertarif und Steuerabsetzbeträge (Stand 01.01.2026):
 * https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/steuertarif-steuerabsetzbetraege/steuertarif-steuerabsetzbetraege.html
 * Die Grenzen bis 1 Mio. € werden jährlich an die Inflation angepasst (§ 33 Abs. 1a iVm § 33a EStG); ein Jahr ohne
 * hinterlegte Werte wird nie mit dem Tarif eines anderen Jahres geschätzt.
 */
const TARIFF: Record<number, Array<[upTo: number | null, rate: string]>> = {
  2024: [[12816, "0"], [20818, "0.20"], [34513, "0.30"], [66612, "0.40"], [99266, "0.48"], [1000000, "0.50"], [null, "0.55"]],
  2025: [[13308, "0"], [21617, "0.20"], [35836, "0.30"], [69166, "0.40"], [103072, "0.48"], [1000000, "0.50"], [null, "0.55"]],
  2026: [[13539, "0"], [21992, "0.20"], [36458, "0.30"], [70365, "0.40"], [104859, "0.48"], [1000000, "0.50"], [null, "0.55"]],
};

export const TARIFF_SOURCE =
  "https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/steuertarif-steuerabsetzbetraege/steuertarif-steuerabsetzbetraege.html";

export const hasTariff = (year: number): boolean => year in TARIFF;

/**
 * Einkommensteuer eines Jahres vor Absetzbeträgen.
 * Absetzbeträge bleiben bewusst unberücksichtigt: Die Rücklage fällt dadurch eher zu hoch als zu niedrig aus.
 */
export function incomeTax(year: number, incomeEur: DecInput): Dec {
  const brackets = TARIFF[year];
  if (!brackets) throw new Error(`Der Einkommensteuertarif ${year} ist in der App noch nicht hinterlegt.`);
  const income = D.max(ZERO, dec(incomeEur));
  let tax = ZERO;
  let lower = ZERO;
  for (const [limit, rate] of brackets) {
    const upTo = limit === null ? null : dec(limit);
    const top = upTo === null ? income : D.min(income, upTo);
    if (top.gt(lower)) tax = tax.plus(top.minus(lower).times(rate));
    if (upTo === null || income.lte(upTo)) break;
    lower = upTo;
  }
  return tax;
}

/**
 * Mehrsteuer durch tarifbesteuerte Kapitaleinkünfte (KZ 857, z. B. Optionen ohne freiwilligen KESt-Abzug):
 * ESt(sonstiges Einkommen + KZ 857) − ESt(sonstiges Einkommen), mit dem Tarif des Jahres (PRODUKTPLAN, Soll-Rücklage).
 * Ein negativer Saldo in KZ 857 senkt keine anderen Einkünfte.
 */
export function extraTaxOnTariffIncome(args: { year: number; otherIncomeEur: DecInput; kz857Eur: DecInput }): Dec {
  const kz857 = D.max(ZERO, dec(args.kz857Eur));
  const other = dec(args.otherIncomeEur);
  return incomeTax(args.year, other.plus(kz857)).minus(incomeTax(args.year, other));
}
