import { dec, ZERO, type Dec } from "../decimal.js";
import type { AssetKind, DistributionKind, ImportedTrade, ImportResult, Unsupported } from "./model.js";

/**
 * Auswertung eines SnapTrade-Schnappschusses (`src/sync/snaptrade.ts`). Feldbedeutung laut OpenAPI von SnapTrade
 * (UniversalActivity: type, symbol, option_symbol, units, price, amount, fee, currency, fx_rate, trade_date,
 * institution, description). Regeln wie bei den Datei-Importen; Annahmen siehe README („SnapTrade“):
 * - SnapTrade liefert keine ISIN, nur FIGI. Steht eine ISIN in der Beschreibung einer Buchung, gilt sie für alle
 *   Buchungen desselben Wertpapiers (symbol.id); sonst ist die Kennung die FIGI-Klasse. Ohne ISIN ist der Quellenstaat
 *   einer Dividende unbekannt, die Dividende wird dann „nicht berechnet“.
 * - Beträge in EUR (auch nach automatischem Umtausch des Brokers, Feld fx_rate) zählen wie im Export; Beträge in
 *   Fremdwährung werden zum EZB-Kurs umgerechnet (Rz 6201c).
 * - Dividende = Bruttobetrag; Quellensteuer kommt als eigene Buchung TAX am selben Tag.
 */

export const SNAPTRADE_SOURCE = "snaptrade";

interface Snap {
  fetchedAt: string;
  accounts: Array<Record<string, unknown> & { id: string }>;
  activities: Record<string, Array<Record<string, unknown>>>;
}

export function isSnapTradeSnapshot(text: string): boolean {
  if (!text.trimStart().startsWith("{")) return false;
  try {
    const j = JSON.parse(text) as { source?: unknown; accounts?: unknown; activities?: unknown };
    return j.source === SNAPTRADE_SOURCE && Array.isArray(j.accounts) && typeof j.activities === "object" && j.activities !== null;
  } catch {
    return false;
  }
}

export interface SnapFile {
  snap: Snap;
  file?: string;
}

export function readSnapTradeSnapshot(text: string, file?: string): SnapFile {
  if (!isSnapTradeSnapshot(text)) throw new Error("Die Datei ist kein SnapTrade-Abruf der KESt-Rücklage-App.");
  const snap = JSON.parse(text) as Snap;
  return { snap, ...(file ? { file } : {}) };
}

export function parseSnapTradeJson(text: string, file?: string): ImportResult {
  return processSnapTrade(mergeSnapTrade([readSnapTradeSnapshot(text, file)]).entries);
}

type Activity = Record<string, unknown>;
interface Entry {
  depot: string;
  act: Activity;
  file?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown) => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);
const num = (v: unknown): Dec | null => (typeof v === "number" && Number.isFinite(v) ? dec(String(v)) : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? dec(v) : null);

const depotOf = (a: Record<string, unknown>) => `SnapTrade ${[str(a.display_name), str(a.masked_account_number)].filter(Boolean).join(" ") || a.id}`;

/**
 * Führt Schnappschüsse zusammen: Jede Aktivität (Konto und ID) zählt einmal, der neueste Abruf gewinnt.
 * `duplicates` zählt Aktivitäten, die in mehreren Abrufen standen.
 */
export function mergeSnapTrade(files: SnapFile[]): { entries: Entry[]; duplicates: number } {
  const byKey = new Map<string, Entry>();
  let duplicates = 0;
  for (const f of [...files].sort((a, b) => str(a.snap.fetchedAt).localeCompare(str(b.snap.fetchedAt)))) {
    for (const account of f.snap.accounts) {
      const depot = depotOf(account);
      for (const act of f.snap.activities[account.id] ?? []) {
        const key = `${account.id}|${str(act.id) || JSON.stringify(act)}`;
        if (byKey.has(key)) duplicates++;
        byKey.set(key, { depot, act, ...(f.file ? { file: f.file } : {}) });
      }
    }
  }
  return { entries: [...byKey.values()], duplicates };
}

const ISIN_IN_TEXT = /\b(?!BBG)([A-Z]{2}[A-Z0-9]{9}\d)\b/;
const FUND_TYPES = new Set(["et", "oef", "cef"]);
const IGNORE = new Set(["CONTRIBUTION", "WITHDRAWAL", "FEE"]);
const POSITION_CHANGES = new Set([
  "SPLIT",
  "STOCK_DIVIDEND",
  "REI",
  "TRANSFER",
  "EXTERNAL_ASSET_TRANSFER_IN",
  "EXTERNAL_ASSET_TRANSFER_OUT",
  "ADJUSTMENT",
  "OPTIONEXPIRATION",
  "OPTIONASSIGNMENT",
  "OPTIONEXERCISE",
]);

const dateOf = (a: Activity) => (str(a.trade_date) || str(a.settlement_date)).slice(0, 10);
const datetimeOf = (a: Activity) => (str(a.trade_date) || `${str(a.settlement_date).slice(0, 10)}T00:00:00`).slice(0, 19);

export function processSnapTrade(entries: Entry[]): ImportResult {
  const result: ImportResult = { trades: [], transfersOut: [], interest: [], dividends: [], reportedPositions: [], unsupported: [] };
  const sorted = [...entries].sort((a, b) => datetimeOf(a.act).localeCompare(datetimeOf(b.act)) || str(a.act.id).localeCompare(str(b.act.id)));

  // ISIN je Wertpapier aus den Beschreibungen (gilt für alle Buchungen desselben symbol.id)
  const isinOf = new Map<string, string>();
  for (const { act } of sorted) {
    const sym = obj(act.symbol);
    const m = ISIN_IN_TEXT.exec(str(act.description));
    if (sym && m && !isinOf.has(str(sym.id))) isinOf.set(str(sym.id), m[1]!);
  }
  const keyOf = (sym: Record<string, unknown>) => {
    const isin = isinOf.get(str(sym.id));
    if (isin) return isin;
    const share = str(obj(sym.figi_instrument)?.figi_share_class);
    if (share) return `FIGI ${share}`;
    if (str(sym.figi_code)) return `FIGI ${str(sym.figi_code)}`;
    return `Symbol ${str(sym.symbol) || str(sym.id)}`;
  };

  const groups = new Map<string, { line: number; file?: string; isin: string; depot: string; date: string; name: string; currency: string; kind: DistributionKind; gross: Dec; withheld: Dec; hasDividend: boolean }>();
  const taxes: Array<{ line: number; file?: string; key: string; isin: string; date: string; amount: Dec; currency: string }> = [];

  sorted.forEach(({ depot, act, file }, i) => {
    const line = i + 1;
    const type = str(act.type).toUpperCase();
    const label = `SnapTrade/${type || "?"}`;
    const src = file ? { file } : {};
    const sym = obj(act.symbol);
    const key = sym ? keyOf(sym) : "";
    const date = dateOf(act);
    const datetime = datetimeOf(act);
    const currency = (str(obj(act.currency)?.code) || str(obj(sym?.currency)?.code)).toUpperCase();
    const note = (reason: string, affects = false) =>
      result.unsupported.push({ line, type: label, reason, ...src, ...(affects && key ? { affects: { isin: key, depot, datetime } } : {}) } as Unsupported);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return note("Buchung ohne gültiges Datum. Nicht berechnet.", true);
    if (obj(act.option_symbol)) return note("Optionen und Futures über SnapTrade werden noch nicht berechnet.");
    if (IGNORE.has(type) && type !== "FEE") return;
    if (type === "FEE") return; // Gebühren sind im 27,5 %-Topf nicht abziehbar

    if (type === "BUY" || type === "SELL") {
      if (!sym) return note("Kauf oder Verkauf ohne erkanntes Wertpapier. Nicht berechnet.");
      const units = num(act.units)?.abs();
      const price = num(act.price)?.abs();
      if (!units || units.isZero() || !price || price.isZero()) return note(`Stückzahl oder Kurs fehlt bei ${key}. Nicht berechnet.`, true);
      if (!currency) return note(`Währung fehlt bei ${key}. Nicht berechnet.`, true);
      const amount = units.times(price);
      const fee = num(act.fee)?.abs() ?? ZERO;
      const typeCode = str(obj(sym.type)?.code);
      const kind: AssetKind = typeCode === "crypto" ? "crypto" : typeCode === "wt" || typeCode === "struct" ? "securitizedDerivative" : "security";
      const base = { line, isin: key, depot, date, datetime, side: type === "BUY" ? "buy" : "sell", quantity: units.toString(), withheldEur: "0", kind, name: str(sym.description) || str(sym.symbol), price: price.toString(), ...src } as const;
      const trade: ImportedTrade =
        currency === "EUR"
          ? { ...base, amountEur: amount.toString(), feeEur: fee.toString(), originalCurrency: "" }
          : { ...base, amountEur: "", feeEur: "", originalCurrency: currency, convert: { currency, amount: amount.toString(), fees: fee.isZero() ? [] : [{ currency, amount: fee.toString() }] } };
      result.trades.push(trade);
      return;
    }

    if (type === "DIVIDEND" || type === "CAPITAL_GAINS_LONG" || type === "CAPITAL_GAINS_SHORT") {
      if (!sym) return note("Ausschüttung ohne erkanntes Wertpapier. Nicht berechnet.");
      const amount = num(act.amount);
      if (amount === null || !currency) return note(`Betrag oder Währung fehlt bei der Ausschüttung von ${key}. Nicht berechnet.`);
      const fund = FUND_TYPES.has(str(obj(sym.type)?.code)) || type !== "DIVIDEND";
      const gkey = `${depot}|${key}|${date}|${currency}`;
      const g = groups.get(gkey) ?? { line, ...src, isin: key, depot, date, name: str(sym.description) || str(sym.symbol), currency, kind: fund ? "fund" : "stock", gross: ZERO, withheld: ZERO, hasDividend: true };
      g.gross = g.gross.plus(amount);
      groups.set(gkey, g);
      return;
    }

    if (type === "TAX") {
      const amount = num(act.amount);
      if (!sym || amount === null) return note("Steuerbuchung ohne Wertpapier oder Betrag. Nicht berechnet, bitte prüfen.");
      taxes.push({ line, ...src, key: `${depot}|${key}|${date}|${currency}`, isin: key, date, amount, currency });
      return;
    }

    if (type === "INTEREST") {
      const amount = num(act.amount);
      if (amount === null || !currency) return note("Zinsbuchung ohne Betrag oder Währung. Nicht berechnet.");
      if (amount.lte(0)) return; // Sollzinsen sind für die KESt ohne Bedeutung
      const eur = currency === "EUR";
      result.interest.push({
        line,
        date,
        depot,
        // Guthabenzinsen der flatexDEGIRO Bank wie Zinsen aus Geldeinlagen (KZ 861), sonst Broker-Zinsen laut Einstellung
        source: /degiro|flatex/i.test(str(act.institution)) ? "bank" : "broker",
        amountEur: eur ? amount.toString() : "",
        withheldEur: "0",
        isin: "",
        ...(eur ? {} : { convert: { currency, amount: amount.toString() } }),
        ...src,
      });
      return;
    }

    if (type === "SUBSTITUTE_DIVIDEND") return note("Ersatzzahlung für eine Dividende (Wertpapierleihe): wird noch nicht berechnet.");
    if (POSITION_CHANGES.has(type)) return note(`Buchung ${type} zu ${key || "einem Wertpapier"} verändert den Bestand und wird noch nicht berechnet. Spätere Verkäufe dieser Position werden nicht gerechnet.`, true);
    return note(`SnapTrade-Typ „${type || "unbekannt"}“ wird nicht zugeordnet. Bitte prüfen.`, !!sym);
  });

  for (const t of taxes) {
    const g = groups.get(t.key);
    if (!g) {
      result.unsupported.push({ line: t.line, type: "SnapTrade/TAX", reason: `Steuerbuchung von ${t.isin} am ${t.date} (${t.amount.toString()} ${t.currency}) ohne Dividende am selben Tag. Nicht berechnet, bitte prüfen.`, ...(t.file ? { file: t.file } : {}) });
      continue;
    }
    g.withheld = g.withheld.minus(t.amount);
  }
  for (const g of groups.values()) {
    if (g.gross.lte(0)) {
      result.unsupported.push({ line: g.line, type: "SnapTrade/DIVIDEND", reason: `Ausschüttung von ${g.isin} am ${g.date}: Summe ${g.gross.toString()} ${g.currency}. Nicht berechnet, bitte prüfen.`, ...(g.file ? { file: g.file } : {}) });
      continue;
    }
    const eur = g.currency === "EUR";
    result.dividends.push({
      line: g.line,
      ...(g.file ? { file: g.file } : {}),
      isin: g.isin,
      depot: g.depot,
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
  return result;
}
