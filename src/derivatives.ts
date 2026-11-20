import { dec, ZERO, type Dec } from "./decimal.js";
import type { ImportedTrade, Unsupported } from "./import/model.js";

/**
 * Nicht verbriefte Derivate (Optionen, Futures) je Kontrakt und Depot, mit Long- und Short-Positionen.
 *
 * Rechtsgrundlage:
 * - § 27a Abs. 3 Z 3 EStG 1988 (https://www.jusline.at/gesetz/estg/paragraf/27a): bei Verfall ist die Stillhalterprämie
 *   der Ertrag (lit b); bei Veräußerung oder Glattstellung der Unterschiedsbetrag, die Stillhalterprämie gilt als
 *   Veräußerungserlös (lit c).
 * - § 27a Abs. 4 Z 3 EStG: gleitender Durchschnittspreis auch für Derivate. Für Short-Positionen wird analog die
 *   durchschnittliche Prämie je Kontrakt verwendet (Annahme, README).
 * - EStR 2000 Rz 6173–6177 (Abschnitt 20.2.3, Fassung 13.03.2024): Besteuerung erst bei Verfall, Glattstellung oder
 *   Ausübung, nicht bei Zufluss der Prämie (Rz 6176). Ausübung mit Lieferung: Long Call -> Prämie erhöht die
 *   Anschaffungskosten der Aktien, Long Put -> mindert den Veräußerungserlös (Rz 6174a); Short Put zugeteilt -> Prämie
 *   senkt die Anschaffungskosten, Short Call zugeteilt -> erhöht den Veräußerungserlös (Rz 6176).
 *
 * Verfall, Ausübung und Zuteilung bucht IBKR als Schließung zum Preis 0 (BookTrade). Eine Ausübung oder Zuteilung wird
 * an der Aktienbuchung desselben Tages erkannt (Basiswert, Stückzahl = Kontrakte × Multiplikator, Kurs = Ausübungspreis).
 * Ohne solche Buchung gilt die Schließung zum Preis 0 am oder nach dem Verfallstag als Verfall; davor wird nichts geschätzt.
 */

export interface DerivativeRealized {
  trade: ImportedTrade;
  gainEur: Dec;
  how: "close" | "expiry";
}

export interface OpenDerivative {
  depot: string;
  contract: string;
  symbol: string;
  /** Anzahl Kontrakte, negativ bei Short (Stillhalter) */
  quantity: Dec;
  /** Long: Anschaffungskosten; Short: erhaltene Prämie (jeweils EUR) */
  basisEur: Dec;
}

export interface DerivativeOutcome {
  realized: DerivativeRealized[];
  /** Betrag in EUR, um den Anschaffungskosten (Kauf) bzw. Veräußerungserlös (Verkauf) einer Aktienbuchung zu ändern sind */
  adjustments: Map<ImportedTrade, Dec>;
  open: OpenDerivative[];
  notes: Unsupported[];
}

/** Ein Derivat-Trade, bereits in EUR (`amountEur`, `feeEur`), oder der Grund, warum er nicht umgerechnet werden konnte. */
export type DerivativeInput = { trade: ImportedTrade; failure?: string };

interface State {
  /** Kontrakte, negativ bei Short */
  qty: Dec;
  /** Basis ohne Spesen: Long = gezahlte Prämie, Short = erhaltene Prämie */
  gross: Dec;
  /** Spesen, die beim Tarif zur Basis gehören (Long: dazu, Short: davon ab) */
  fees: Dec;
  symbol: string;
  depot: string;
  contract: string;
  /** Zeile, ab der der Kontrakt unvollständig ist */
  brokenSince?: number;
}

/** IBKR-Codes für Zuteilung und Ausübung (https://ibkrguides.com/reportingreference/reportguide/codes_flex.htm, Stand 20.03.2025) */
const EXERCISE_CODES = new Set(["A", "Ex", "AEx", "MEx"]);
/** „Expiration or Assignment resulting from offsetting positions“: Verfall oder Zuteilung, nicht unterscheidbar */
const AMBIGUOUS_CODES = new Set(["GEA"]);

const at = (t: ImportedTrade) => (t.file === undefined ? { line: t.line } : { line: t.line, file: t.file });
const label = (t: ImportedTrade) => (t.side === "buy" ? "Trade/BUY" : "Trade/SELL");
const contracts = (n: Dec) => `${n.toString()} ${n.eq(1) ? "Kontrakt" : "Kontrakte"}`;

/**
 * @param inputs Derivat-Trades (alle Jahre)
 * @param stocks Aktien-Trades (alle Jahre, unverändert), für die Zuordnung von Ausübung und Zuteilung
 * @param includeFees true beim Tarif: Spesen mindern das Ergebnis (Annahme, offene Frage); false bei 27,5 %
 */
export function runDerivatives(inputs: DerivativeInput[], stocks: ImportedTrade[], includeFees: boolean): DerivativeOutcome {
  const out: DerivativeOutcome = { realized: [], adjustments: new Map(), open: [], notes: [] };
  const book = new Map<string, State>();
  const usedStocks = new Set<ImportedTrade>();
  const sorted = [...inputs].sort((a, b) => (a.trade.datetime || a.trade.date).localeCompare(b.trade.datetime || b.trade.date));

  for (const { trade: t, failure } of sorted) {
    const d = t.derivative;
    if (!d) continue;
    const key = `${t.depot}|${d.contract}`;
    const s = book.get(key) ?? { qty: ZERO, gross: ZERO, fees: ZERO, symbol: t.name || d.contract, depot: t.depot, contract: d.contract };
    book.set(key, s);
    if (s.brokenSince !== undefined) {
      out.notes.push({ ...at(t), type: label(t), reason: `Kontrakt ${s.symbol} ist seit Zeile ${s.brokenSince} unvollständig; nicht berechnet.` });
      continue;
    }
    if (failure) {
      out.notes.push({ ...at(t), type: label(t), reason: failure });
      s.brokenSince = t.line;
      continue;
    }

    const q = dec(t.quantity);
    const amount = dec(t.amountEur);
    const fee = includeFees ? dec(t.feeEur || "0") : ZERO;
    const sign = t.side === "buy" ? 1 : -1;
    const closing = (s.qty.gt(0) && sign < 0) || (s.qty.lt(0) && sign > 0);

    if (!closing && t.openClose === "C") {
      out.notes.push({
        ...at(t),
        type: label(t),
        reason:
          `Schließung von ${contracts(q)} ${s.symbol} am ${t.date} ohne bekannte Eröffnung. Vermutlich wurde vor dem Exportzeitraum eröffnet. ` +
          `Nicht berechnet; bitte den Export mit Zeitraum seit Kontoeröffnung verwenden.`,
      });
      s.brokenSince = t.line;
      continue;
    }

    let rest = q;
    if (closing) {
      const closeQ = q.lt(s.qty.abs()) ? q : s.qty.abs();
      const share = closeQ.div(s.qty.abs());
      const grossPart = s.gross.times(share);
      const feePart = s.fees.times(share);
      const amountPart = amount.times(closeQ).div(q);
      const feeNow = fee.times(closeQ).div(q);
      const long = s.qty.gt(0);
      const zeroPrice = amount.isZero();

      // Codes laut IBKR (codes_flex): A/Ex/AEx/MEx = Zuteilung oder Ausübung, Ep = Verfall, GEA = Verfall oder Zuteilung
      const codes = t.codes ?? [];
      const exerciseCode = codes.find((c) => EXERCISE_CODES.has(c));
      const ambiguousCode = codes.find((c) => AMBIGUOUS_CODES.has(c));
      const expired = codes.includes("Ep");
      const delivery = zeroPrice && !expired ? findDelivery(t, closeQ, long, stocks, usedStocks) : undefined;
      if (zeroPrice && !delivery && (ambiguousCode || exerciseCode)) {
        out.notes.push({
          ...at(t),
          type: label(t),
          reason: ambiguousCode
            ? `Schließung von ${contracts(closeQ)} ${s.symbol} am ${t.date} mit Code ${ambiguousCode} (Verfall oder Zuteilung aus Gegenpositionen). Nicht berechnet, bitte prüfen.`
            : `Zuteilung oder Ausübung (Code ${exerciseCode}) von ${contracts(closeQ)} ${s.symbol} am ${t.date} ohne passende Aktienbuchung ` +
              `(Basiswert ${d.underlying}, ${closeQ.times(d.multiplier).toString()} Stück zu ${d.strike}). Die Prämie gehört in die Aktie; nicht als Verfall gewertet. Nicht berechnet.`,
        });
        s.brokenSince = t.line;
        continue;
      }
      if (delivery) {
        // Ausübung/Zuteilung: Prämie geht in die Aktienbuchung ein, kein eigener Ertrag (Rz 6174a, 6176).
        usedStocks.add(delivery);
        const stockBuy = delivery.side === "buy";
        const adj = (stockBuy ? 1 : -1) * (long ? 1 : -1);
        out.adjustments.set(delivery, (out.adjustments.get(delivery) ?? ZERO).plus(grossPart.times(adj)));
      } else if (zeroPrice && !expired && !(d.expiry !== "" && t.date >= d.expiry)) {
        out.notes.push({
          ...at(t),
          type: label(t),
          reason:
            `Schließung von ${contracts(closeQ)} ${s.symbol} am ${t.date} zum Preis 0 vor dem Verfallstag ${d.expiry || "(unbekannt)"} ` +
            `und ohne passende Aktienbuchung (Ausübung oder Zuteilung?). Nicht berechnet.`,
        });
        s.brokenSince = t.line;
        continue;
      } else {
        // Long: Erlös − Anschaffungskosten. Short: Prämie (gilt als Veräußerungserlös) − Kosten der Glattstellung.
        const gain = long
          ? amountPart.minus(feeNow).minus(grossPart.plus(feePart))
          : grossPart.minus(feePart).minus(amountPart.plus(feeNow));
        out.realized.push({ trade: t, gainEur: gain, how: zeroPrice ? "expiry" : "close" });
      }
      s.gross = s.gross.minus(grossPart);
      s.fees = s.fees.minus(feePart);
      s.qty = s.qty.plus(closeQ.times(sign));
      rest = q.minus(closeQ);
    }
    if (rest.gt(0)) {
      // Eröffnen oder Aufstocken (Long durch Kauf, Short durch Verkauf)
      s.gross = s.gross.plus(amount.times(rest).div(q));
      s.fees = s.fees.plus(fee.times(rest).div(q));
      s.qty = s.qty.plus(rest.times(sign));
    }
  }

  for (const s of book.values()) {
    if (s.brokenSince !== undefined || s.qty.isZero()) continue;
    out.open.push({
      depot: s.depot,
      contract: s.contract,
      symbol: s.symbol,
      quantity: s.qty,
      basisEur: s.qty.gt(0) ? s.gross.plus(s.fees) : s.gross.minus(s.fees),
    });
  }
  return out;
}

/**
 * Aktienbuchung aus Ausübung oder Zuteilung: gleicher Tag und Depot, Basiswert, Stückzahl = Kontrakte × Multiplikator,
 * Kurs = Ausübungspreis, passende Richtung (Long Call/Short Put -> Aktienkauf, Long Put/Short Call -> Aktienverkauf).
 */
function findDelivery(t: ImportedTrade, closeQ: Dec, long: boolean, stocks: ImportedTrade[], used: Set<ImportedTrade>): ImportedTrade | undefined {
  const d = t.derivative;
  if (!d || d.type !== "option" || d.putCall === "") return undefined;
  const call = d.putCall === "C";
  const side = long === call ? "buy" : "sell";
  const shares = closeQ.times(d.multiplier);
  return stocks.find(
    (s) =>
      !used.has(s) &&
      s.kind !== "derivative" &&
      s.depot === t.depot &&
      s.date === t.date &&
      s.side === side &&
      (s.symbol === d.underlying || (d.underlyingConid !== undefined && s.conid === d.underlyingConid)) &&
      dec(s.quantity).eq(shares) &&
      s.price !== undefined &&
      dec(s.price).eq(d.strike),
  );
}
