import { dec, D } from "./decimal.js";
import type { ImportResult } from "./import/model.js";
import type { YearSoll } from "./ledger.js";
import { reserveTarget } from "./reserve.js";
import { computeYear, type YearOptions, type YearReport } from "./yearReport.js";

/** Soll-Rücklage laut PRODUKTPLAN: (Steuer 27,5 % + Steuer auf Bankzinsen + Mehrsteuer KZ 857) × (1 + Puffer). */
export const sollOf = (r: YearReport, bufferPct: number) =>
  reserveTarget({
    basket275TaxEur: r.tax275Eur,
    bankInterestTaxEur: r.tax25Eur,
    tariffExtraTaxEur: r.tariffExtraTaxEur,
    bufferRate: dec(bufferPct).div(100),
  });

/**
 * Soll je Steuerjahr bis zum Stichtag `today`, ohne Jahre, deren Steuer bezahlt ist. Abgeschlossene Jahre: endgültiges
 * Soll. Laufendes Jahr: Soll zum Stichtag und höchstes Soll an allen bisherigen Buchungstagen (für die Freigabe).
 */
export function sollTimeline(data: ImportResult, options: YearOptions, bufferPct: number, today: string, paidYears: Record<string, string>): YearSoll[] {
  const todayYear = Number(today.slice(0, 4));
  const dates = [
    ...data.trades.map((t) => t.date),
    ...data.transfersOut.map((t) => t.date),
    ...data.dividends.map((d) => d.date),
    ...data.interest.map((i) => i.date),
  ].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today);
  const years = [...new Set([...dates.map((d) => Number(d.slice(0, 4))), todayYear])].sort((a, b) => a - b);
  const out: YearSoll[] = [];
  for (const year of years) {
    if (paidYears[String(year)] !== undefined) continue;
    if (year < todayYear) {
      const r = computeYear(data, year, options);
      const soll = sollOf(r, bufferPct);
      out.push({ year, sollEur: soll, peakEur: soll, complete: r.notComputed.length === 0 });
      continue;
    }
    const r = computeYear(data, year, { ...options, asOf: today });
    const soll = sollOf(r, bufferPct);
    const checkpoints = [...new Set(dates.filter((d) => d.startsWith(`${year}-`)))];
    const peak = D.max(soll, ...checkpoints.map((d) => sollOf(computeYear(data, year, { ...options, asOf: d }), bufferPct)));
    out.push({ year, sollEur: soll, peakEur: peak, complete: r.notComputed.length === 0 });
  }
  return out;
}
