import { dec, ZERO, type Dec } from "../decimal.js";
import { parseCsvRows } from "./csv.js";
import type { DistributionKind, ForeignAmount, ImportedTrade, ImportResult, Unsupported } from "./model.js";

/**
 * Import der DEGIRO-Exporte als CSV (UMSETZUNG 3.2). DEGIRO dokumentiert die Formate nicht; belegt sind sie über
 * Open-Source-Parser (geprüft am 20.11.2026):
 * - „Transaktionen“ (Transactions.csv), 17 Spalten, englische Kopfzeile laut https://github.com/wirrike/degiro-portfolio:
 *   Date, Time, Product, ISIN, Reference exchange, Venue, Quantity, Price, (Währung), Local value, (Währung), Value EUR,
 *   Exchange rate, AutoFX Fee, Transaction and/or third party fees EUR, Total EUR, Order ID.
 * - „Kontoübersicht“ (Account.csv), 12 Spalten, Kopfzeile in jeder Sprache mit demselben Layout laut
 *   https://github.com/nyg/libdegiro (README, „Supported exports“): Date, Time, Value date, Product, ISIN, Description, FX,
 *   Change, (Betrag), Balance, (Betrag), Order Id. Beschreibungen (Dividende, Dividendensteuer, …) ebenfalls laut libdegiro.
 * Die Kopfzeile wird am Spaltenlayout erkannt (Spaltenzahl und leere Spaltennamen), nicht an der Sprache.
 */

export const DEGIRO_DEPOT = "DEGIRO";

export type DegiroFileKind = "transactions" | "account";

export interface DegiroSourceRow {
  /** Zeile in der Datei (Kopfzeile = 1) */
  line: number;
  cells: string[];
  file?: string;
}

export interface DegiroFile {
  kind: DegiroFileKind;
  rows: DegiroSourceRow[];
}

const TX_COLUMNS = 17;
const ACCOUNT_COLUMNS = 12;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function layoutOf(header: string[]): DegiroFileKind | null {
  const h = header.map((x) => x.trim());
  if (h.length === TX_COLUMNS && h[8] === "" && h[10] === "" && /ISIN/i.test(h[3] ?? "")) return "transactions";
  if (h.length === ACCOUNT_COLUMNS && h[8] === "" && h[10] === "" && /ISIN/i.test(h[4] ?? "")) return "account";
  return null;
}

/** true, wenn die erste Zeile das Spaltenlayout eines DEGIRO-Exports hat. */
export function isDegiroCsv(text: string): boolean {
  const firstLine = (text.startsWith("﻿") ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? "";
  const [header] = parseCsvRows(firstLine);
  return header !== undefined && layoutOf(header) !== null;
}

/**
 * Zahl aus dem DEGIRO-Export. Europäisches („1.234,56“) und US-Format („1,234.56“): Kommen Komma und Punkt vor, ist das
 * letzte Zeichen davon das Dezimalzeichen; kommt nur eines mehrfach vor, trennt es Tausender; ein einzelnes ist das
 * Dezimalzeichen (Regel wie in libdegiro). Leer oder ungültig: `null`.
 */
export function parseDegiroNumber(raw: string): Dec | null {
  let s = raw.replace(/[\s  ]/g, "");
  if (s === "") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else {
    const sep = lastComma >= 0 ? "," : lastDot >= 0 ? "." : "";
    if (sep !== "") {
      const count = s.split(sep).length - 1;
      s = count > 1 ? s.split(sep).join("") : s.replace(sep, ".");
    }
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  return dec(s);
}

/** TT-MM-JJJJ (auch TT/MM/JJJJ) oder JJJJ-MM-TT → JJJJ-MM-TT; sonst `null`. */
function isoDate(raw: string): string | null {
  const s = raw.trim();
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Liest die Zeilen einer DEGIRO-Datei. Wirft eine deutsche Meldung, wenn das Layout unbekannt ist. */
export function readDegiroRows(text: string, source?: string): DegiroFile {
  const rows = parseCsvRows(text);
  const [header, ...body] = rows;
  const kind = header ? layoutOf(header) : null;
  if (!kind) {
    throw new Error(
      "Unbekanntes DEGIRO-Format: Erwartet wird der Export „Transaktionen“ (17 Spalten) oder „Kontoübersicht“ (12 Spalten) als CSV, " +
        "unverändert aus dem DEGIRO-Web-Trader (nicht in Excel geöffnet und gespeichert).",
    );
  }
  const width = kind === "transactions" ? TX_COLUMNS : ACCOUNT_COLUMNS;
  const out: DegiroSourceRow[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    if (cells.length !== width) throw new Error(`DEGIRO-Datei, Zeile ${line}: ${cells.length} statt ${width} Spalten.`);
    out.push({ line, cells: cells.map((c) => c.trim()), ...(source ? { file: source } : {}) });
  });
  if (out.length === 0) throw new Error("Die DEGIRO-Datei enthält keine Buchungen.");
  return { kind, rows: out };
}

export function parseDegiroCsv(text: string, source?: string): ImportResult {
  return processDegiroFiles([readDegiroRows(text, source)]);
}

const empty = (): ImportResult => ({ trades: [], transfersOut: [], interest: [], dividends: [], reportedPositions: [], unsupported: [] });

/** Wertet die Zeilen aller DEGIRO-Dateien aus (Transaktionen und Kontoübersicht). */
export function processDegiroFiles(files: DegiroFile[]): ImportResult {
  const result = empty();
  for (const f of files.filter((x) => x.kind === "transactions")) for (const r of f.rows) readTrade(r, result);
  readAccount(files.filter((x) => x.kind === "account").flatMap((f) => f.rows), result);
  return result;
}

const src = (r: DegiroSourceRow) => (r.file ? { file: r.file } : {});

function readTrade(r: DegiroSourceRow, result: ImportResult): void {
  const c = r.cells;
  const product = c[2] ?? "";
  const isin = (c[3] ?? "").toUpperCase();
  const type = "DEGIRO/Transaktion";
  const fail = (reason: string, affects?: Unsupported["affects"]) =>
    result.unsupported.push({ line: r.line, type, reason, ...src(r), ...(affects ? { affects } : {}) });
  if (isin === "") {
    fail(`${product || "Buchung"} ohne ISIN (z. B. Option oder Future): Derivate bei DEGIRO werden noch nicht berechnet.`);
    return;
  }
  if (!ISIN_RE.test(isin)) {
    fail(`Ungültige ISIN „${isin}“. Nicht berechnet.`);
    return;
  }
  const date = isoDate(c[0] ?? "");
  const time = /^\d{2}:\d{2}$/.test(c[1] ?? "") ? `${c[1]}:00` : "00:00:00";
  const datetime = date ? `${date}T${time}` : "";
  // Fehlt etwas, das den Bestand verändert, werden spätere Verkäufe dieser Position nicht gerechnet.
  const affects = { isin, depot: DEGIRO_DEPOT, datetime };
  if (!date) {
    fail(`Ungültiges Datum „${c[0] ?? ""}“ bei ${isin}. Nicht berechnet.`, affects);
    return;
  }
  const quantity = parseDegiroNumber(c[6] ?? "");
  const local = parseDegiroNumber(c[9] ?? "");
  const valueEur = parseDegiroNumber(c[11] ?? "");
  const autoFx = parseDegiroNumber(c[13] ?? "") ?? ZERO;
  const fees = parseDegiroNumber(c[14] ?? "") ?? ZERO;
  if (quantity === null || quantity.isZero()) {
    fail(`Ungültige Stückzahl „${c[6] ?? ""}“ bei ${isin}. Nicht berechnet.`, affects);
    return;
  }
  const currency = ((c[10] || c[8]) ?? "").toUpperCase();
  const base = {
    line: r.line,
    isin,
    depot: DEGIRO_DEPOT,
    date,
    datetime,
    side: quantity.gt(0) ? "buy" : "sell",
    quantity: quantity.abs().toString(),
    withheldEur: "0",
    kind: "security",
    name: product,
    ...src(r),
    ...(parseDegiroNumber(c[7] ?? "") ? { price: parseDegiroNumber(c[7] ?? "")!.toString() } : {}),
  } as const;
  const feeEur = fees.abs().plus(autoFx.abs());
  let trade: ImportedTrade;
  if (currency === "EUR" || currency === "") {
    const amount = local ?? valueEur;
    if (amount === null) {
      fail(`Kurswert fehlt bei ${isin}. Nicht berechnet.`, affects);
      return;
    }
    trade = { ...base, amountEur: amount.abs().toString(), feeEur: feeEur.toString(), originalCurrency: "" };
  } else if (!autoFx.isZero()) {
    // AutoFX: DEGIRO tauscht beim Handel tatsächlich in EUR um -> es zählt der EUR-Betrag laut Export (EStR 2000 Rz 6201c,
    // tatsächliche Konvertierung; Annahme, siehe README)
    if (valueEur === null) {
      fail(`EUR-Wert fehlt bei ${isin}. Nicht berechnet.`, affects);
      return;
    }
    trade = { ...base, amountEur: valueEur.abs().toString(), feeEur: feeEur.toString(), originalCurrency: currency };
  } else {
    // ohne AutoFX bleibt das Geld in Fremdwährung -> EZB-Referenzkurs am Handelstag (Rz 6201c, wie bei IBKR)
    if (local === null) {
      fail(`Kurswert in ${currency} fehlt bei ${isin}. Nicht berechnet.`, affects);
      return;
    }
    const feeList: ForeignAmount[] = fees.isZero() ? [] : [{ currency: "EUR", amount: fees.abs().toString() }];
    trade = { ...base, amountEur: "", feeEur: "", originalCurrency: currency, convert: { currency, amount: local.abs().toString(), fees: feeList } };
  }
  result.trades.push(trade);
}

// Beschreibungen in der Kontoübersicht, mehrsprachig laut libdegiro (src/classify/matchers)
const TRADE_VERB = /^(?:Achat|Vente|Buy|Sell|Koop|Verkoop|Kauf|Verkauf)\s+/i;
const DIVIDEND_TAX = /^(?:imp[oô]ts? sur (?:le )?dividende|dividend tax|withholding tax|dividendbelasting|dividendensteuer|retenci[óo]n del dividendo|ritenuta sul dividendo)/i;
const CAPITAL_RETURN = /^(?:remboursement de capital|capital return|return of capital|kapitalr[üu]ckzahlung|kapitaalsuitkering)/i;
const DIVIDEND = /^(?:dividend[aeo]?\b|fondsaussch[üu]ttung)/i;
const FUND = /^fondsaussch[üu]ttung/i;
const INTEREST = /interest income|^(?:flatex interest|interest|rente|zinsen|interesse)\b/i;
/** Geldbewegungen ohne Bedeutung für die KESt (Einzahlungen, Gebühren, Währungswechsel, Geldmarkt-Umbuchungen) */
const IRRELEVANT =
  /einzahlung|auszahlung|deposit|withdrawal|überweisung|transfer|virement|geb[üu]hr|fee|kosten|costs|frais|w[äa]hrungswechsel|currency|fx |conversion|geldmarkt|money market|cash sweep/i;

interface DivGroup {
  row: DegiroSourceRow;
  isin: string;
  name: string;
  date: string;
  currency: string;
  kind: DistributionKind;
  gross: Dec;
  withheld: Dec;
  hasDividend: boolean;
}

function readAccount(rows: DegiroSourceRow[], result: ImportResult): void {
  // DEGIRO bricht lange Beschreibungen in eine Folgezeile um, die nur den Rest des Texts enthält (laut libdegiro).
  const joined: DegiroSourceRow[] = [];
  for (const r of rows) {
    const onlyText = r.cells.every((c, i) => (i === 5 ? c !== "" : c === ""));
    const prev = joined[joined.length - 1];
    if (onlyText && prev) {
      prev.cells = prev.cells.map((c, i) => (i === 5 ? c + r.cells[5] : c));
      continue;
    }
    joined.push({ ...r, cells: [...r.cells] });
  }

  const type = "DEGIRO/Kontoübersicht";
  const groups = new Map<string, DivGroup>();
  const taxes: DegiroSourceRow[] = [];
  for (const r of joined) {
    const c = r.cells;
    const desc = c[5] ?? "";
    const isin = (c[4] ?? "").toUpperCase();
    const currency = (c[7] ?? "").toUpperCase() || "EUR";
    const amount = parseDegiroNumber(c[8] ?? "");
    const booked = isoDate(c[0] ?? "");
    // Zufluss am Wertstellungstag (Valuta), sonst am Buchungstag
    const date = isoDate(c[2] ?? "") ?? booked;
    const note = (reason: string, affects?: Unsupported["affects"]) =>
      result.unsupported.push({ line: r.line, type, reason, ...src(r), ...(affects ? { affects } : {}) });

    if (TRADE_VERB.test(desc)) continue; // Käufe und Verkäufe kommen aus der Datei „Transaktionen“
    const isTax = DIVIDEND_TAX.test(desc);
    const isCapital = !isTax && CAPITAL_RETURN.test(desc);
    const isDividend = !isTax && !isCapital && DIVIDEND.test(desc);
    if (isTax || isCapital || isDividend) {
      if (!date || amount === null || !ISIN_RE.test(isin)) {
        note(`Buchung „${desc}“ ist unvollständig (Datum, Betrag oder ISIN). Nicht berechnet.`);
        continue;
      }
      if (isTax) {
        taxes.push(r);
        continue;
      }
      const kind: DistributionKind = isCapital ? "capitalDistribution" : FUND.test(desc) ? "fund" : "stock";
      const key = `${isin}|${date}|${currency}`;
      const g = groups.get(key) ?? { row: r, isin, name: c[3] ?? "", date, currency, kind, gross: ZERO, withheld: ZERO, hasDividend: false };
      g.gross = g.gross.plus(amount);
      g.hasDividend = true;
      if (kind !== "stock") g.kind = kind;
      groups.set(key, g);
      continue;
    }
    if (INTEREST.test(desc)) {
      if (!booked || amount === null) {
        note(`Zinsbuchung „${desc}“ ist unvollständig. Nicht berechnet.`);
        continue;
      }
      if (amount.lte(0)) continue; // Sollzinsen sind für die KESt ohne Bedeutung
      const eur = currency === "EUR";
      result.interest.push({
        line: r.line,
        date: date ?? booked,
        depot: DEGIRO_DEPOT,
        // Guthabenzinsen der flatexDEGIRO Bank: wie Zinsen aus Geldeinlagen bei Kreditinstituten, KZ 861 (Annahme)
        source: "bank",
        amountEur: eur ? amount.toString() : "",
        withheldEur: "0",
        isin: "",
        ...(eur ? {} : { convert: { currency, amount: amount.toString() } }),
        ...src(r),
      });
      continue;
    }
    if (isin === "" || IRRELEVANT.test(desc)) continue;
    note(`Buchung „${desc}“ zu ${isin} wird nicht zugeordnet. Bitte prüfen.`, {
      isin,
      depot: DEGIRO_DEPOT,
      datetime: booked ? `${booked}T${/^\d{2}:\d{2}$/.test(c[1] ?? "") ? `${c[1]}:00` : "00:00:00"}` : "",
    });
  }

  for (const r of taxes) {
    const c = r.cells;
    const isin = (c[4] ?? "").toUpperCase();
    const currency = (c[7] ?? "").toUpperCase() || "EUR";
    const date = isoDate(c[2] ?? "") ?? isoDate(c[0] ?? "") ?? "";
    const amount = parseDegiroNumber(c[8] ?? "") ?? ZERO;
    const g = groups.get(`${isin}|${date}|${currency}`);
    if (!g) {
      result.unsupported.push({
        line: r.line,
        type,
        reason: `Dividendensteuer von ${isin} am ${date} (${amount.toString()} ${currency}) ohne Dividende am selben Tag. Nicht berechnet, bitte prüfen.`,
        ...src(r),
      });
      continue;
    }
    g.withheld = g.withheld.minus(amount); // Steuer steht negativ in der Kontoübersicht
  }

  for (const g of groups.values()) {
    if (g.gross.lte(0)) {
      result.unsupported.push({
        line: g.row.line,
        type,
        reason: `Ausschüttung von ${g.isin} am ${g.date}: Summe nach Korrekturen ${g.gross.toString()} ${g.currency}. Nicht berechnet, bitte prüfen.`,
        ...src(g.row),
      });
      continue;
    }
    const eur = g.currency === "EUR";
    result.dividends.push({
      line: g.row.line,
      ...src(g.row),
      isin: g.isin,
      depot: DEGIRO_DEPOT,
      date: g.date,
      datetime: `${g.date}T00:00:00`,
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
  result.dividends.sort((a, b) => a.line - b.line);
}
