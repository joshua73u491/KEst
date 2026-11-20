import { computeBasket275 } from "./basket275.js";
import { InsufficientPositionError, Positions, type Position, type Trade } from "./costBasis.js";
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

  const notComputed: Unsupported[] = [...data.unsupported];
  /** Positionen (Depot|ISIN), deren Bestand seit einer Zeile nicht mehr vollständig bekannt ist */
  const broken = new Map<string, number>();

  /**
   * Verkauf oder Übertrag mit fehlendem Bestand: nie schätzen. Die Buchung und alle späteren Abgänge
   * derselben Position werden als „nicht berechnet“ gemeldet, die übrige Auswertung läuft weiter.
   */
  const applyChecked = (trade: Trade, line: number, type: string) => {
    const key = `${trade.depot}|${trade.isin}`;
    const since = broken.get(key);
    if (since !== undefined) {
      if (trade.side !== "buy") {
        notComputed.push({
          line,
          type,
          reason: `Bestand von ${trade.isin} ist seit Zeile ${since} unvollständig; ${trade.side === "sell" ? "Gewinn" : "Übertrag"} nicht berechnet`,
        });
      }
      return null;
    }
    try {
      return positions.apply(trade);
    } catch (e) {
      if (!(e instanceof InsufficientPositionError)) throw e;
      broken.set(key, line);
      notComputed.push({
        line,
        type,
        reason:
          `${trade.side === "sell" ? "Verkauf" : "Übertrag"} von ${dec(trade.quantity).toString()} Stück ${trade.isin} am ${trade.date} ` +
          `übersteigt den bekannten Bestand von ${e.available.toString()}. Vermutlich liegt ein Kauf vor dem Exportzeitraum ` +
          `oder eine Einbuchung fehlt. ${trade.side === "sell" ? "Gewinn" : "Übertrag"} nicht berechnet; ` +
          `bitte den Export mit Zeitraum seit Kontoeröffnung verwenden.`,
      });
      return null;
    }
  };

  // Bei identischem Zeitstempel zuerst Käufe, dann Verkäufe und Überträge (Annahme, siehe README).
  const rank = (side: "buy" | "sell" | "transfer_out") => (side === "buy" ? 0 : 1);
  const events: Array<{ at: string; rank: number; apply: () => void }> = [
    ...data.trades.map((t) => ({
      at: t.datetime || t.date,
      rank: rank(t.side),
      apply: () => {
        const r = applyChecked(t, t.line, `TRADING/${t.side === "buy" ? "BUY" : "SELL"}`);
        if (inYear(t.date)) feesEur = feesEur.plus(t.feeEur);
        if (r && inYear(t.date)) realized.push({ isin: t.isin, name: t.name, date: t.date, kind: t.kind, gainEur: r.gainEur });
      },
    })),
    ...data.transfersOut.map((t) => ({
      at: t.datetime || t.date,
      rank: rank("transfer_out"),
      apply: () => void applyChecked({ ...t, side: "transfer_out", amountEur: "0" }, t.line, "DELIVERY/FREE_DELIVERY"),
    })),
  ];
  // Übersprungene Bestandsbuchungen: ab diesem Zeitpunkt ist der Bestand der Position unsicher.
  for (const u of data.unsupported) {
    const a = u.affects;
    if (!a) continue;
    events.push({
      at: a.datetime,
      rank: 0,
      apply: () => {
        const key = `${a.depot}|${a.isin}`;
        if (!broken.has(key)) broken.set(key, u.line);
      },
    });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.rank - b.rank).forEach((e) => e.apply());

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
    openPositions: positions.open().filter((p) => !broken.has(`${p.depot}|${p.isin}`)),
    notComputed,
  };
}
