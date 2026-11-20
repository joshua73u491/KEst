import { dec, D, ZERO, type Dec } from "./decimal.js";
import type { ImportedTrade, ImportResult } from "./import/model.js";
import type { ReserveStatus } from "./ledger.js";
import { sollOf } from "./sollTimeline.js";
import { computeYear, type YearOptions, type YearReport } from "./yearReport.js";

/**
 * Verkaufs-Simulator und Kauf-Check (UMSETZUNG 3.3, PRODUKTPLAN „Funktionen“: `simulate_sale`,
 * `check_order_against_reserve`). Beides rechnet nur; ob verkauft oder gekauft wird, entscheidet der Nutzer.
 */

const isAmount = (s: string) => /^\d+(\.\d+)?$/.test(s.trim());
const taxOf = (r: YearReport) => r.tax275Eur.plus(r.tax25Eur).plus(r.tariffExtraTaxEur);

export interface SaleInput {
  data: ImportResult;
  options: YearOptions;
  bufferPct: number;
  /** Tag des gedachten Verkaufs (JJJJ-MM-TT), in der App heute */
  today: string;
  isin: string;
  depot: string;
  quantity: string;
  /** Preis je Stück in EUR */
  priceEur: string;
  /** Spesen in EUR (im 27,5 %-Topf nicht abziehbar) */
  feeEur?: string;
}

export interface SaleResult {
  year: number;
  holdingQuantity: Dec;
  avgPriceEur: Dec;
  proceedsEur: Dec;
  /** anteilige Anschaffungskosten (gleitender Durchschnittspreis) */
  costEur: Dec;
  gainEur: Dec;
  /** Steuer des Jahres bis heute ohne und mit dem Verkauf (27,5 %, 25 %, Mehrsteuer KZ 857) */
  taxBeforeEur: Dec;
  taxAfterEur: Dec;
  taxChangeEur: Dec;
  sollBeforeEur: Dec;
  sollAfterEur: Dec;
  /** true, wenn Trade Republic den Verkauf selbst versteuern würde (steuereinfach) */
  taxedByBroker: boolean;
  /** false, wenn im Jahr etwas „nicht berechnet“ ist */
  complete: boolean;
}

/** Rechnet einen gedachten Verkauf einer offenen Position durch. Wirft deutsche Meldungen bei ungültigen Angaben. */
export function simulateSale(input: SaleInput): SaleResult {
  const { data, options, bufferPct, today, isin, depot } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`Der Stichtag „${today}“ ist ungültig.`);
  if (!isAmount(input.quantity) || dec(input.quantity.trim()).lte(0)) throw new Error(`Die Stückzahl „${input.quantity}“ ist ungültig. Erwartet wird eine Zahl größer 0.`);
  if (!isAmount(input.priceEur) || dec(input.priceEur.trim()).lte(0)) throw new Error(`Der Preis je Stück „${input.priceEur}“ ist ungültig. Erwartet wird ein Betrag in EUR größer 0.`);
  const fee = (input.feeEur ?? "").trim();
  if (fee !== "" && !isAmount(fee)) throw new Error(`Die Spesen „${input.feeEur}“ sind keine gültige Zahl ab 0.`);

  const year = Number(today.slice(0, 4));
  const opts: YearOptions = { ...options, asOf: today };
  const before = computeYear(data, year, opts);
  const pos = before.openPositions.find((p) => p.isin === isin && p.depot === depot);
  if (!pos) throw new Error(`Für ${isin} im Depot ${depot} gibt es keine offene Position, die die App berechnen kann.`);
  const quantity = dec(input.quantity.trim());
  if (quantity.gt(pos.quantity)) throw new Error(`Du hältst nur ${pos.quantity.toString()} Stück von ${isin}.`);

  const template = [...data.trades].reverse().find((t) => t.isin === isin && t.depot === depot);
  const proceeds = quantity.times(dec(input.priceEur.trim()));
  const sale: ImportedTrade = {
    line: 0,
    isin,
    depot,
    date: today,
    datetime: `${today}T23:59:59`,
    side: "sell",
    quantity: quantity.toString(),
    amountEur: proceeds.toString(),
    feeEur: fee === "" ? "0" : dec(fee).toString(),
    withheldEur: "0",
    originalCurrency: "",
    kind: template?.kind ?? "security",
    name: template?.name ?? isin,
    file: "Simulation",
  };
  const after = computeYear({ ...data, trades: [...data.trades, sale] }, year, opts);
  // anteilige Anschaffungskosten wie im gleitenden Durchschnitt (src/costBasis.ts)
  const cost = quantity.eq(pos.quantity) ? pos.costEur : pos.costEur.div(pos.quantity).times(quantity);
  return {
    year,
    holdingQuantity: pos.quantity,
    avgPriceEur: pos.avgPriceEur,
    proceedsEur: proceeds,
    costEur: cost,
    gainEur: proceeds.minus(cost),
    taxBeforeEur: taxOf(before),
    taxAfterEur: taxOf(after),
    taxChangeEur: taxOf(after).minus(taxOf(before)),
    sollBeforeEur: sollOf(before, bufferPct),
    sollAfterEur: sollOf(after, bufferPct),
    taxedByBroker: after.taxedByBroker.some((x) => x.line === 0 && x.isin === isin),
    complete: after.notComputed.length === 0,
  };
}

export interface OrderInput {
  /** freies Guthaben auf dem Konto in EUR */
  cashEur: string;
  /** Orderbetrag inklusive Spesen in EUR */
  orderEur: string;
  /** true, wenn die Rücklage selbst in diesem Guthaben liegt */
  reserveInAccount: boolean;
}

export interface OrderCheck {
  /** Betrag, der für die Rücklage im Guthaben bleiben muss */
  mustKeepEur: Dec;
  /** Guthaben nach Abzug der Rücklage (kann negativ sein) */
  freeEur: Dec;
  enough: boolean;
  missingEur: Dec;
}

/**
 * Kauf-Check: Reicht das Guthaben für die Order, ohne die Rücklage anzugreifen? Bis zum 31.12. zählt der Höchststand
 * des Solls (`requiredEur`). Liegt die Rücklage woanders, muss nur der noch fehlende Teil im Guthaben bleiben.
 */
export function checkOrder(input: OrderInput, status: ReserveStatus): OrderCheck {
  if (!isAmount(input.cashEur)) throw new Error(`Das Guthaben „${input.cashEur}“ ist keine gültige Zahl ab 0.`);
  if (!isAmount(input.orderEur)) throw new Error(`Der Order-Betrag „${input.orderEur}“ ist keine gültige Zahl ab 0.`);
  const cash = dec(input.cashEur.trim());
  const order = dec(input.orderEur.trim());
  const mustKeep = input.reserveInAccount ? status.requiredEur : D.max(ZERO, status.requiredEur.minus(status.istEur ?? ZERO));
  const free = cash.minus(mustKeep);
  return { mustKeepEur: mustKeep, freeEur: free, enough: order.lte(free), missingEur: D.max(ZERO, order.minus(free)) };
}
