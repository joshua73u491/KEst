import { dec, D, ZERO, type Dec, type DecInput } from "./decimal.js";

export const SPECIAL_RATE = dec("0.275");

export interface Dividend {
  grossEur: DecInput;
  /** tatsächlich einbehaltene ausländische Quellensteuer in EUR */
  withholdingEur: DecInput;
  /** Quellensteuersatz laut Doppelbesteuerungsabkommen, z. B. 0.15 für die USA */
  treatyRate: DecInput;
}

export interface Basket275Input {
  realizedGainsEur: DecInput[];
  dividends: Dividend[];
}

export interface Basket275Result {
  /** Überschüsse aus realisierten Wertsteigerungen (ausländisch) */
  kz994: Dec;
  /** Verluste aus realisierten Wertsteigerungen, als positiver Betrag */
  kz892: Dec;
  /** Dividenden und Wertpapierzinsen brutto */
  kz863: Dec;
  /** anrechenbare ausländische Quellensteuer */
  kz998: Dec;
  taxableBaseEur: Dec;
  taxEur: Dec;
  /** Verlust, der im Jahr nicht ausgeglichen werden konnte (kein Vortrag möglich) */
  unusedLossEur: Dec;
}

/**
 * Jahresergebnis des 27,5 %-Topfs für ein ausländisches Depot.
 *
 * Annahme (offene Frage an den Steuerberater, siehe Produktplan): Gleichen Kursverluste
 * Dividenden aus, wird die anrechenbare Quellensteuer auf die österreichische Steuer
 * gedeckelt, die auf die verbleibenden Dividenden entfällt.
 */
export function computeBasket275(input: Basket275Input): Basket275Result {
  const gains = input.realizedGainsEur.map(dec);
  const kz994 = D.sum(ZERO, ...gains.filter((g) => g.gt(0)));
  const kz892 = D.sum(ZERO, ...gains.filter((g) => g.lt(0))).abs();
  const kz863 = D.sum(ZERO, ...input.dividends.map((d) => dec(d.grossEur)));

  const netGains = kz994.minus(kz892);
  const total = netGains.plus(kz863);
  const taxableBaseEur = D.max(ZERO, total);
  const unusedLossEur = D.max(ZERO, total.negated());

  const remainingDividends = netGains.lt(0) ? D.max(ZERO, kz863.plus(netGains)) : kz863;
  const creditableRaw = D.sum(
    ZERO,
    ...input.dividends.map((d) => D.min(dec(d.withholdingEur), dec(d.grossEur).times(dec(d.treatyRate)))),
  );
  const kz998 = D.min(creditableRaw, remainingDividends.times(SPECIAL_RATE));

  const taxEur = D.max(ZERO, taxableBaseEur.times(SPECIAL_RATE).minus(kz998));

  return { kz994, kz892, kz863, kz998, taxableBaseEur, taxEur, unusedLossEur };
}
