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
  /** Aktien, ETFs, Anleihen, Fonds */
  realizedGainsEur: DecInput[];
  /** verbriefte Derivate: Optionsscheine, Zertifikate, Turbos */
  derivativeGainsEur?: DecInput[];
  cryptoGainsEur?: DecInput[];
  dividends: Dividend[];
}

export interface Basket275Result {
  /** Überschüsse aus realisierten Wertsteigerungen (ausländisch) */
  kz994: Dec;
  /** Verluste aus realisierten Wertsteigerungen, als positiver Betrag */
  kz892: Dec;
  /** Überschüsse aus verbrieften Derivaten */
  kz995: Dec;
  /** Verluste aus Derivaten, als positiver Betrag */
  kz896: Dec;
  /** Überschüsse aus realisierten Wertsteigerungen von Kryptowährungen */
  kz174: Dec;
  /** Verluste aus Kryptowährungen, als positiver Betrag */
  kz176: Dec;
  /** Dividenden und Wertpapierzinsen brutto */
  kz863: Dec;
  /** anrechenbare ausländische Quellensteuer */
  kz998: Dec;
  taxableBaseEur: Dec;
  taxEur: Dec;
  /** Verlust, der im Jahr nicht ausgeglichen werden konnte (kein Vortrag möglich) */
  unusedLossEur: Dec;
}

const split = (values: DecInput[] = []): [gains: Dec, losses: Dec] => {
  const all = values.map(dec);
  return [D.sum(ZERO, ...all.filter((v) => v.gt(0))), D.sum(ZERO, ...all.filter((v) => v.lt(0))).abs()];
};

/**
 * Jahresergebnis des 27,5 %-Topfs für ein ausländisches Depot.
 * Kursgewinne, verbriefte Derivate, Krypto und Dividenden werden im selben Kalenderjahr gegeneinander verrechnet.
 *
 * Annahme (offene Frage an den Steuerberater, siehe README): Gleichen Verluste Dividenden aus,
 * wird die anrechenbare Quellensteuer auf die österreichische Steuer gedeckelt,
 * die auf die verbleibenden Dividenden entfällt.
 */
export function computeBasket275(input: Basket275Input): Basket275Result {
  const [kz994, kz892] = split(input.realizedGainsEur);
  const [kz995, kz896] = split(input.derivativeGainsEur);
  const [kz174, kz176] = split(input.cryptoGainsEur);
  const kz863 = D.sum(ZERO, ...input.dividends.map((d) => dec(d.grossEur)));

  const netGains = D.sum(kz994, kz995, kz174).minus(D.sum(kz892, kz896, kz176));
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

  return { kz994, kz892, kz995, kz896, kz174, kz176, kz863, kz998, taxableBaseEur, taxEur, unusedLossEur };
}
