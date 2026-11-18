import { computeBasket275 } from "./basket275.js";
import { Positions, type Position } from "./costBasis.js";
import { dec, D, ZERO, type Dec } from "./decimal.js";
import type { AssetKind, ImportResult, Unsupported } from "./import/tradeRepublic.js";

export const BANK_INTEREST_RATE = dec("0.25");

export interface RealizedLine {
  isin: string;
  name: string;
  date: string;
  kind: AssetKind;
  gainEur: Dec;
}

export interface YearReport {
  year: number;
  kz994: Dec;
  kz892: Dec;
  kz995: Dec;
  kz896: Dec;
  kz174: Dec;
  kz176: Dec;
  kz863: Dec;
  kz998: Dec;
  /** Zinsen aus Geldeinlagen bei Kreditinstituten (25 %) */
  kz861: Dec;
  taxableBaseEur: Dec;
  unusedLossEur: Dec;
  tax275Eur: Dec;
  tax25Eur: Dec;
  /** gezahlte Ordergebühren im Jahr (im 27,5 %-Topf nicht abziehbar) */
  feesEur: Dec;
  realized: RealizedLine[];
  openPositions: Array<Position & { isin: string; depot: string }>;
  notComputed: Unsupported[];
}

/**
 * Wertet alle Buchungen aus: Bestände über die gesamte Historie, Gewinne und Steuer nur für `year`.
 */
export function computeYear(data: ImportResult, year: number): YearReport {
  const inYear = (date: string) => date.startsWith(`${year}-`);
  const positions = new Positions();
  const realized: RealizedLine[] = [];
  let feesEur = ZERO;

  const events: Array<{ at: string; apply: () => void }> = [
    ...data.trades.map((t) => ({
      at: t.datetime || t.date,
      apply: () => {
        const r = positions.apply(t);
        if (inYear(t.date)) feesEur = feesEur.plus(t.feeEur);
        if (r && inYear(t.date)) realized.push({ isin: t.isin, name: t.name, date: t.date, kind: t.kind, gainEur: r.gainEur });
      },
    })),
    ...data.transfersOut.map((t) => ({
      at: t.datetime || t.date,
      apply: () => void positions.apply({ ...t, side: "transfer_out", amountEur: "0" }),
    })),
  ];
  events.sort((a, b) => a.at.localeCompare(b.at)).forEach((e) => e.apply());

  const gainsOf = (kind: AssetKind) => realized.filter((r) => r.kind === kind).map((r) => r.gainEur);
  const basket = computeBasket275({
    realizedGainsEur: gainsOf("security"),
    derivativeGainsEur: gainsOf("securitizedDerivative"),
    cryptoGainsEur: gainsOf("crypto"),
    dividends: [],
  });

  const kz861 = D.sum(ZERO, ...data.interest.filter((i) => inYear(i.date)).map((i) => dec(i.amountEur)));

  return {
    year,
    kz994: basket.kz994,
    kz892: basket.kz892,
    kz995: basket.kz995,
    kz896: basket.kz896,
    kz174: basket.kz174,
    kz176: basket.kz176,
    kz863: basket.kz863,
    kz998: basket.kz998,
    kz861,
    taxableBaseEur: basket.taxableBaseEur,
    unusedLossEur: basket.unusedLossEur,
    tax275Eur: basket.taxEur,
    tax25Eur: D.max(ZERO, kz861).times(BANK_INTEREST_RATE),
    feesEur,
    realized,
    openPositions: positions.open(),
    notComputed: data.unsupported,
  };
}
