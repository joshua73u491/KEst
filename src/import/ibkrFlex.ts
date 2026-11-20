import { dec, ZERO, type Dec } from "../decimal.js";
import type { DistributionKind, ForeignAmount, ImportedTrade, ImportResult, Unsupported } from "./model.js";
import { childrenNamed, parseXml, type XmlElement } from "./xml.js";

/**
 * Import einer IBKR Activity Flex Query im XML-Format.
 *
 * Quellen für Felder und Werte:
 * - IBKR Reporting Reference: https://ibkrguides.com/reportingreference/reportguide/tradesfq.htm,
 *   …/cash%20transactionsfq.htm, …/open%20positionsfq.htm (Bedeutung von Proceeds, Net Cash, Level of Detail).
 * - Attributnamen und Werte (assetCategory, buySell, levelOfDetail, type, dateTime …) laut den anonymisierten
 *   echten Flex-Dateien im IBKR-Importer von Portfolio Performance, Stand Commit 5448857 (14.11.2026):
 *   https://github.com/portfolio-performance/portfolio/tree/544885757440f49b4d362b073e25ff7cc5a76cd5/name.abuchen.portfolio.tests/src/name/abuchen/portfolio/datatransfer/ibflex
 */

const HOW_TO =
  "Lege bei IBKR eine Activity Flex Query im Format XML an, mit den Abschnitten Trades (Detailstufe „Executions“), " +
  "Cash Transactions und Open Positions, Datumsformat yyyyMMdd, Zeitraum seit Kontoeröffnung bzw. so weit wie möglich.";

const SECTIONS = ["Trades", "CashTransactions", "OpenPositions"] as const;

const TRADE_FIELDS = ["assetCategory", "currency", "isin", "quantity", "proceeds", "buySell", "tradeDate", "ibCommission", "ibCommissionCurrency", "levelOfDetail"];
const CASH_FIELDS = ["type", "amount", "currency", "dateTime", "isin"];
const POSITION_FIELDS = ["assetCategory", "isin", "position", "reportDate"];

/** Wertpapiere im 27,5 %-Topf mit KZ 994/892 */
const SECURITY_CATEGORIES = new Set(["STK", "FUND", "BOND", "BILL"]);
/** Nicht verbriefte Derivate: kommen erst in Phase 2 (KZ 857 oder 995 ist eine offene Frage) */
const DERIVATIVE_CATEGORIES = new Set(["OPT", "FUT", "FOP", "CFD"]);
/** Cash-Buchungen ohne Bedeutung für die KESt (Ein-/Auszahlungen, Gebühren, Sollzinsen) */
const IGNORED_CASH_TYPES = new Set([
  "Deposits/Withdrawals",
  "Deposits",
  "Withdrawals",
  "Deposits & Withdrawals",
  "Other Fees",
  "Advisor Fees",
  "Management Fees",
  "Commission Adjustments",
  "Broker Interest Paid",
  "Broker Fees",
]);

class RowError extends Error {}

/** Erkennt eine Flex Query am Wurzelelement. */
export function isIbkrFlexXml(text: string): boolean {
  return /^(<\?xml[^>]*\?>\s*)?<FlexQueryResponse\b/.test(text.replace(/^﻿/, "").trimStart());
}

function num(el: XmlElement, attr: string): Dec {
  const raw = (el.attrs[attr] ?? "").trim();
  try {
    if (raw === "") throw new Error();
    const v = dec(raw);
    if (!v.isFinite()) throw new Error();
    return v;
  } catch {
    throw new RowError(`Ungültige Zahl in Feld ${attr}: „${raw}“`);
  }
}

/** Datum laut Flex Query: yyyyMMdd oder yyyy-MM-dd, optional mit Uhrzeit nach „;“ (HHmmss oder HH:mm:ss). */
function parseDate(value: string, time = ""): { date: string; datetime: string } {
  const v = value.trim();
  const m = /^(\d{4})(-?)(\d{2})\2(\d{2})(?:[;,]\s?(\d{2}):?(\d{2}):?(\d{2}))?(?:\s.*)?$/.exec(v);
  if (!m) throw new RowError(`Datum „${v}“ wird nicht erkannt. Bitte in der Flex Query das Datumsformat yyyyMMdd einstellen.`);
  const date = `${m[1]}-${m[3]}-${m[4]}`;
  let hms = m[5] ? `${m[5]}:${m[6]}:${m[7]}` : "00:00:00";
  const t = /^(\d{2}):?(\d{2}):?(\d{2})$/.exec(time.trim());
  if (t) hms = `${t[1]}:${t[2]}:${t[3]}`;
  return { date, datetime: `${date}T${hms}` };
}

function checkFields(section: string, rows: XmlElement[], fields: string[]): void {
  const missing = fields.filter((f) => rows.some((r) => !(f in r.attrs)));
  if (missing.length > 0) {
    throw new Error(`Im Abschnitt ${section} fehlen Felder: ${missing.join(", ")}. Bitte diese Felder in der Flex Query aktivieren.`);
  }
}

/** Ein Kontoauszug (FlexStatement) einer Datei, geprüft und mit den Zeilen der drei Abschnitte. */
export interface FlexStatementData {
  accountId: string;
  /** Beginn des Zeitraums (JJJJ-MM-TT), leer wenn nicht angegeben */
  fromDate: string;
  /** Ende des Zeitraums (JJJJ-MM-TT); der neueste Auszug liefert den Bestandsabgleich */
  toDate: string;
  trades: XmlElement[];
  cash: XmlElement[];
  positions: XmlElement[];
}

/** Liest und prüft eine Flex-Query-Datei: Abschnitte, Pflichtfelder, Detailstufe. Wirft deutsche Fehlermeldungen. */
export function readIbkrFlexStatements(text: string, source?: string): FlexStatementData[] {
  const root = parseXml(text);
  if (root.name !== "FlexQueryResponse") {
    throw new Error(`Die Datei ist keine IBKR-Flex-Query (erwartet wird eine Activity Flex Query im XML-Format). ${HOW_TO}`);
  }
  const statements = childrenNamed(root, "FlexStatements").flatMap((s) => childrenNamed(s, "FlexStatement"));
  if (statements.length === 0) throw new Error("Die Flex Query enthält keinen Kontoauszug (FlexStatement).");

  return statements.map((statement) => {
    const missing = SECTIONS.filter((s) => childrenNamed(statement, s).length === 0);
    if (missing.length === 1) throw new Error(`Die Flex Query ist unvollständig: Abschnitt ${missing[0]} fehlt. ${HOW_TO}`);
    if (missing.length > 1) throw new Error(`Die Flex Query ist unvollständig: Abschnitte ${missing.join(", ")} fehlen. ${HOW_TO}`);
    const section = (name: string, child: string) => {
      const rows = childrenNamed(statement, name).flatMap((s) => childrenNamed(s, child));
      if (source !== undefined) for (const r of rows) r.file = source;
      return rows;
    };
    const trades = section("Trades", "Trade");
    const cash = section("CashTransactions", "CashTransaction");
    const positions = section("OpenPositions", "OpenPosition");
    checkFields("Trades", trades, TRADE_FIELDS);
    checkFields("CashTransactions", cash, CASH_FIELDS);
    checkFields("OpenPositions", positions, POSITION_FIELDS);
    if (trades.length > 0 && !trades.some((r) => (r.attrs.levelOfDetail ?? "EXECUTION") === "EXECUTION")) {
      throw new Error("Im Abschnitt Trades fehlen die Einzelausführungen. Bitte in der Flex Query für Trades die Detailstufe „Executions“ wählen.");
    }
    const dateOrEmpty = (v: string | undefined) => {
      try {
        return parseDate(v ?? "").date;
      } catch {
        return ""; // ohne Datum: gilt beim Zusammenführen als ältester Auszug, keine Lückenprüfung
      }
    };
    return {
      accountId: statement.attrs.accountId ?? "",
      fromDate: dateOrEmpty(statement.attrs.fromDate),
      toDate: dateOrEmpty(statement.attrs.toDate),
      trades,
      cash,
      positions,
    };
  });
}

export function parseIbkrFlexXml(text: string, source?: string): ImportResult {
  return processIbkrStatements(readIbkrFlexStatements(text, source));
}

/** Wertet geprüfte Kontoauszüge aus (beim Zusammenführen mehrerer Dateien bereits ohne Duplikate, siehe `src/history.ts`). */
export function processIbkrStatements(statements: FlexStatementData[]): ImportResult {
  const result: ImportResult = { trades: [], transfersOut: [], interest: [], dividends: [], reportedPositions: [], unsupported: [] };
  const flag: Flag = (el, type, reason, affects) =>
    result.unsupported.push({ line: el.line, type, reason, ...(affects ? { affects } : {}), ...src(el) });
  for (const st of statements) {
    const depot = `IBKR ${st.accountId}`.trim();
    readTrades(st.trades, depot, result, flag);
    readCash(st.cash, depot, result, flag);
    readPositions(st.positions, depot, result, flag);
  }
  return result;
}

/** Herkunft eines Elements für Hinweise und Buchungen */
const src = (el: XmlElement) => (el.file === undefined ? {} : { file: el.file });

type Flag = (el: XmlElement, type: string, reason: string, affects?: Unsupported["affects"]) => void;

function readTrades(rows: XmlElement[], depot: string, result: ImportResult, flag: Flag): void {
  const executions = rows.filter((r) => (r.attrs.levelOfDetail ?? "EXECUTION") === "EXECUTION");
  const isCancel = (r: XmlElement) => r.attrs.transactionType === "TradeCancel" || (r.attrs.buySell ?? "").includes("(Ca.)");
  const fundsNoted = new Set<string>();
  const bondsNoted = new Set<string>();
  const firstTrade = result.trades.length;
  /** transactionID je eingelesenem Trade, für Stornos (nicht Teil des gemeinsamen Datenmodells) */
  const tradeIds = new Map<ImportedTrade, string>();

  for (const r of executions.filter((x) => !isCancel(x))) {
    const a = r.attrs;
    const category = a.assetCategory ?? "";
    const label = `Trade/${category || "?"}`;
    const isin = (a.isin ?? "").trim();
    let affects: Unsupported["affects"];
    try {
      const when = parseDate(a.tradeDate ?? a.dateTime ?? "", a.tradeTime ?? "");
      affects = isin ? { isin, depot, datetime: when.datetime } : undefined;
      if (DERIVATIVE_CATEGORIES.has(category)) {
        flag(r,label, `Option oder Future ${a.symbol || isin || category}: wird erst in Phase 2 berechnet. Nicht berechnet.`);
        continue;
      }
      if (category === "CASH") {
        flag(r,label, `Devisentausch ${a.symbol || "?"}: Gewinne und Verluste aus Fremdwährung werden noch nicht berechnet.`);
        continue;
      }
      if (!SECURITY_CATEGORIES.has(category)) {
        flag(r,label, `Anlageklasse ${category || "(leer)"} wird noch nicht zugeordnet`, affects);
        continue;
      }
      if (!isin) throw new RowError("ISIN fehlt. Bitte in der Flex Query das Feld ISIN aktivieren.");
      const side = a.buySell === "BUY" ? "buy" : a.buySell === "SELL" ? "sell" : null;
      if (!side) throw new RowError(`Unbekannte Richtung „${a.buySell ?? ""}“`);
      const quantity = num(r, "quantity").abs();
      if (quantity.isZero()) throw new RowError("Stückzahl 0");
      // Kurswert ohne Spesen: |proceeds| (laut IBKR negativ bei Käufen, positiv bei Verkäufen)
      const amount = num(r, "proceeds").abs();
      const currency = (a.currency ?? "").trim().toUpperCase();
      const fees: ForeignAmount[] = [];
      const commission = num(r, "ibCommission").abs();
      if (!commission.isZero()) fees.push({ currency: (a.ibCommissionCurrency || currency).toUpperCase(), amount: commission.toString() });
      if ((a.taxes ?? "").trim() !== "" && !num(r, "taxes").isZero()) fees.push({ currency, amount: num(r, "taxes").abs().toString() });

      const allEur = currency === "EUR" && fees.every((f) => f.currency === "EUR");
      const trade: ImportedTrade = {
        line: r.line,
        isin,
        depot,
        date: when.date,
        datetime: when.datetime,
        side,
        quantity: quantity.toString(),
        amountEur: allEur ? amount.toString() : "",
        feeEur: allEur ? fees.reduce((s, f) => s.plus(f.amount), ZERO).toString() : "",
        withheldEur: "0",
        originalCurrency: currency === "EUR" ? "" : currency,
        ...(allEur ? {} : { convert: { currency, amount: amount.toString(), fees } }),
        kind: "security",
        name: a.description ?? "",
        ...src(r),
      };
      tradeIds.set(trade, a.transactionID ?? "");
      result.trades.push(trade);
      if ((a.subCategory === "ETF" || category === "FUND") && !fundsNoted.has(isin)) {
        fundsNoted.add(isin);
        flag(r,label, `Fonds/ETF ${isin}: ausschüttungsgleiche Erträge (KZ 937) und Meldefonds-Status werden noch nicht berechnet`);
      }
      if ((category === "BOND" || category === "BILL") && !bondsNoted.has(isin)) {
        bondsNoted.add(isin);
        flag(r,label, `Anleihe ${isin}: Stückzinsen werden noch nicht berechnet`);
      }
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      flag(r,label, e.message, affects);
    }
  }

  // Stornierte Ausführungen (TradeCancel) heben die ursprüngliche Ausführung auf.
  for (const r of executions.filter(isCancel)) {
    const orig = r.attrs.origTransactionID ?? "";
    const i = result.trades.findIndex((t, k) => k >= firstTrade && orig !== "" && tradeIds.get(t) === orig);
    if (i >= 0) {
      result.trades.splice(i, 1);
      continue;
    }
    let datetime = "";
    try {
      datetime = parseDate(r.attrs.tradeDate ?? r.attrs.dateTime ?? "", r.attrs.tradeTime ?? "").datetime;
    } catch {
      // Datum unbekannt: Position gilt ab Beginn als unsicher
    }
    const isin = (r.attrs.isin ?? "").trim();
    flag(
      r,
      `Trade/${r.attrs.assetCategory ?? "?"}`,
      `Storno einer Ausführung ohne passende ursprüngliche Ausführung (origTransactionID ${orig || "fehlt"}). Nicht berechnet; spätere Verkäufe dieser Position ebenfalls nicht.`,
      isin ? { isin, depot, datetime } : undefined,
    );
  }
}

function readCash(rows: XmlElement[], depot: string, result: ImportResult, flag: Flag): void {
  interface Group {
    /** erste Dividendenzeile (für Zeile und Datei) */
    el: XmlElement;
    /** erste Quellensteuerzeile */
    whtEl: XmlElement;
    isin: string;
    name: string;
    currency: string;
    date: string;
    datetime: string;
    kind: DistributionKind;
    gross: Dec;
    withheld: Dec;
    hasDividend: boolean;
  }
  const groups = new Map<string, Group>();

  for (const r of rows.filter((x) => (x.attrs.levelOfDetail ?? "DETAIL") !== "SUMMARY")) {
    const a = r.attrs;
    const type = a.type ?? "";
    const label = `CashTransaction/${type}`;
    try {
      if (IGNORED_CASH_TYPES.has(type)) continue;
      const currency = (a.currency ?? "").trim().toUpperCase();
      if (type === "Dividends" || type === "Withholding Tax") {
        const isin = (a.isin ?? "").trim();
        if (!isin) throw new RowError(`${type === "Dividends" ? "Dividende" : "Quellensteuer"} ohne ISIN: ISIN fehlt. Bitte in der Flex Query das Feld ISIN aktivieren.`);
        const when = parseDate(a.dateTime ?? "");
        const amount = num(r, "amount");
        // Zahltag laut dateTime; Korrekturen tragen dasselbe dateTime und ein späteres reportDate.
        const key = `${isin}|${currency}|${when.date}`;
        let g = groups.get(key);
        if (!g) {
          g = { el: r, whtEl: r, isin, name: a.symbol || isin, currency, date: when.date, datetime: when.datetime, kind: "stock", gross: ZERO, withheld: ZERO, hasDividend: false };
          groups.set(key, g);
        }
        if (type === "Dividends") {
          if (!g.hasDividend) {
            g.el = r;
            g.datetime = when.datetime;
          }
          g.hasDividend = true;
          g.gross = g.gross.plus(amount);
          if (a.subCategory === "ETF" || a.assetCategory === "FUND") g.kind = "fund";
        } else {
          g.withheld = g.withheld.minus(amount);
        }
        continue;
      }
      if (type === "Broker Interest Received") {
        const when = parseDate(a.dateTime ?? "");
        const amount = num(r, "amount").toString();
        result.interest.push({
          line: r.line,
          date: when.date,
          depot,
          source: "broker",
          amountEur: currency === "EUR" ? amount : "",
          withheldEur: "0",
          isin: "",
          ...(currency === "EUR" ? {} : { convert: { currency, amount } }),
          ...src(r),
        });
        continue;
      }
      if (type === "Payment In Lieu Of Dividends") {
        flag(r,label, "Ersatzzahlung für eine Dividende (Payment In Lieu Of Dividends): wird noch nicht berechnet.");
        continue;
      }
      if (type === "Bond Interest Received" || type === "Bond Interest Paid") {
        flag(r,label, `Anleihezinsen (${type}): werden noch nicht berechnet.`);
        continue;
      }
      flag(r,label, "Unbekannter Buchungstyp");
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      flag(r,label, e.message);
    }
  }

  for (const g of groups.values()) {
    if (!g.hasDividend) {
      if (!g.withheld.isZero()) {
        flag(
          g.whtEl,
          "CashTransaction/Withholding Tax",
          `Quellensteuer von ${g.isin} am ${g.date} (${g.withheld.negated().toString()} ${g.currency}) ohne Dividende am selben Zahltag. Nicht berechnet, bitte prüfen.`,
        );
      }
      continue;
    }
    if (g.gross.lte(0)) {
      flag(
        g.el,
        "CashTransaction/Dividends",
        `Dividende von ${g.isin} am ${g.date}: Summe nach Korrekturen ${g.gross.toString()} ${g.currency}. Nicht berechnet, bitte prüfen.`,
      );
      continue;
    }
    const eur = g.currency === "EUR";
    result.dividends.push({
      line: g.el.line,
      ...src(g.el),
      isin: g.isin,
      depot,
      date: g.date,
      datetime: g.datetime,
      name: g.name,
      kind: g.kind,
      grossEur: eur ? g.gross.toString() : "",
      withheldEur: eur ? g.withheld.toString() : "",
      originalCurrency: eur ? "" : g.currency,
      originalAmount: eur ? "" : g.gross.toString(),
      withheldOriginal: eur ? "" : g.withheld.toString(),
      brokerFxRate: "",
    });
  }
}

function readPositions(rows: XmlElement[], depot: string, result: ImportResult, flag: Flag): void {
  for (const r of rows) {
    const a = r.attrs;
    if ((a.levelOfDetail ?? "SUMMARY") !== "SUMMARY") continue;
    if (!SECURITY_CATEGORIES.has(a.assetCategory ?? "") || !(a.isin ?? "").trim()) continue;
    try {
      result.reportedPositions.push({
        line: r.line,
        isin: (a.isin ?? "").trim(),
        depot,
        quantity: num(r, "position").toString(),
        date: parseDate(a.reportDate ?? "").date,
        ...src(r),
      });
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      flag(r,"OpenPosition", e.message);
    }
  }
}
