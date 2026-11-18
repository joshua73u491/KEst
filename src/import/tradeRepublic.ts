import { dec, type Dec } from "../decimal.js";
import { parseCsvTable } from "./csv.js";

/** Steuertopf eines Wertpapiers. */
export type AssetKind = "security" | "securitizedDerivative" | "crypto";

export interface ImportedTrade {
  /** Zeile in der CSV-Datei (Kopfzeile = 1) */
  line: number;
  isin: string;
  depot: string;
  date: string;
  datetime: string;
  side: "buy" | "sell";
  quantity: string;
  /** Kurswert in EUR ohne Spesen */
  amountEur: string;
  feeEur: string;
  kind: AssetKind;
  name: string;
}

export interface ImportedTransfer {
  /** Zeile in der CSV-Datei (Kopfzeile = 1) */
  line: number;
  isin: string;
  depot: string;
  date: string;
  datetime: string;
  quantity: string;
  kind: AssetKind;
}

export interface ImportedInterest {
  date: string;
  amountEur: string;
}

export interface Unsupported {
  line: number;
  type: string;
  reason: string;
  /**
   * Übersprungene Buchung, die den Bestand dieser Position verändert hätte.
   * Spätere Abgänge derselben Position werden dann nicht mehr gerechnet.
   */
  affects?: { isin: string; depot: string; datetime: string };
}

export interface ImportResult {
  trades: ImportedTrade[];
  transfersOut: ImportedTransfer[];
  interest: ImportedInterest[];
  unsupported: Unsupported[];
}

const DEPOT = "TR";

/**
 * Trade Republic bietet nur verbriefte Derivate an (Optionsscheine, Faktor-Zertifikate, Turbos).
 * Sie gehören in KZ 995/896 mit 27,5 %. Annahme im README dokumentiert.
 */
const KIND_BY_ASSET_CLASS: Record<string, AssetKind> = {
  STOCK: "security",
  FUND: "security",
  ETF: "security",
  BOND: "security",
  DERIVATIVE: "securitizedDerivative",
  CRYPTO: "crypto",
};

/** Buchungen ohne Bedeutung für die KESt (Kartenzahlungen, Überweisungen, Einzahlungen, Kontogebühren). */
const IGNORED_CASH_TYPES = new Set([
  "CARD_TRANSACTION",
  "CARD_TRANSACTION_INTERNATIONAL",
  "CARD_ORDERING_FEE",
  "CUSTOMER_INPAYMENT",
  "TRANSFER_INBOUND",
  "TRANSFER_OUTBOUND",
  "TRANSFER_INSTANT_INBOUND",
  "TRANSFER_INSTANT_OUTBOUND",
  "FEE",
]);

/** Spalten, ohne die der Export nicht ausgewertet werden kann. */
const REQUIRED_COLUMNS = ["datetime", "date", "category", "type", "asset_class", "symbol", "shares", "amount", "fee", "currency"];

const FUND_CLASSES = new Set(["FUND", "ETF"]);

const HOW_TO_EXPORT =
  "Exportiere die Datei in der Trade-Republic-App unter Profil → Kontoauszüge → Transaktionsexport (Zeitraum seit Kontoeröffnung) und verwende sie unverändert.";

function checkHeader(header: string[]): void {
  if (header.length === 0 || header.every((h) => h.trim() === "")) {
    throw new Error(`Die Datei ist leer. ${HOW_TO_EXPORT}`);
  }
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length === 0) return;
  if (header.length === 1 && header[0]?.includes(";")) {
    throw new Error(
      `Die Datei ist kein Trade-Republic-Transaktionsexport in der Originalform: Die Spalten sind mit Semikolon getrennt, vermutlich wurde sie mit Excel gespeichert. ${HOW_TO_EXPORT}`,
    );
  }
  throw new Error(
    `Die Datei ist kein Trade-Republic-Transaktionsexport. Es fehlen die Spalten: ${missing.join(", ")}. ${HOW_TO_EXPORT}`,
  );
}

class RowError extends Error {}

/** Liest eine Zahl aus der Spalte `column`; leere oder ungültige Werte werden nie still als 0 gelesen. */
function num(row: Record<string, string>, column: string): Dec {
  const raw = (row[column] ?? "").trim();
  try {
    if (raw === "") throw new Error();
    const v = dec(raw);
    if (!v.isFinite()) throw new Error();
    return v;
  } catch {
    throw new RowError(`Ungültige Zahl in Spalte ${column}: „${raw}“`);
  }
}

function dateOf(row: Record<string, string>): string {
  const date = row.date ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RowError(`Datum „${date}“ ist ungültig`);
  return date;
}

export function parseTradeRepublicCsv(text: string): ImportResult {
  const table = parseCsvTable(text, checkHeader);
  if (table.rows.length === 0) throw new Error(`Die Datei enthält keine Buchungen. ${HOW_TO_EXPORT}`);
  const rows = table.rows.map((row, i) => ({ row, line: i + 2 }));
  rows.sort((a, b) => (a.row.datetime ?? "").localeCompare(b.row.datetime ?? ""));

  const result: ImportResult = { trades: [], transfersOut: [], interest: [], unsupported: [] };
  const flag = (line: number, type: string, reason: string, affects?: Unsupported["affects"]) =>
    result.unsupported.push(affects ? { line, type, reason, affects } : { line, type, reason });
  const fundsNoted = new Set<string>();

  for (const { row, line } of rows) {
    const category = row.category ?? "";
    const type = row.type ?? "";
    const label = `${category}/${type}`;
    const symbol = row.symbol ?? "";
    /** Gesetzt bei Wertpapierbuchungen: wird die Zeile übersprungen, ist der Bestand danach unsicher. */
    const affects = category !== "CASH" && symbol !== "" ? { isin: symbol, depot: DEPOT, datetime: row.datetime || row.date || "" } : undefined;
    try {
      if (category === "CASH") {
        if (IGNORED_CASH_TYPES.has(type)) continue;
        if (type === "INTEREST_PAYMENT") {
          if (row.currency !== "EUR") flag(line, label, `Währung ${row.currency} wird noch nicht unterstützt`);
          else result.interest.push({ date: dateOf(row), amountEur: num(row, "amount").toString() });
          continue;
        }
        flag(line, label, "Unbekannter Buchungstyp");
        continue;
      }

      const assetClass = row.asset_class ?? "";
      const kind = KIND_BY_ASSET_CLASS[assetClass];
      const isin = symbol;

      if (category === "DELIVERY" && type === "FREE_DELIVERY" && kind) {
        const quantity = num(row, "shares").abs();
        if (quantity.isZero()) throw new RowError("Stückzahl 0");
        result.transfersOut.push({ isin, depot: DEPOT, date: dateOf(row), datetime: row.datetime ?? "", quantity: quantity.toString(), kind, line });
        continue;
      }

      if (category === "TRADING" && (type === "BUY" || type === "SELL")) {
        if (!kind) {
          flag(line, label, `Anlageklasse ${assetClass || "(leer)"} ist noch nicht zugeordnet`, affects);
          continue;
        }
        if (row.currency !== "EUR") {
          flag(line, label, `Währung ${row.currency} wird noch nicht unterstützt`, affects);
          continue;
        }
        const originalCurrency = (row.original_currency ?? "").trim();
        if (originalCurrency !== "" && originalCurrency !== "EUR") {
          flag(line, label, `Originalwährung ${originalCurrency}: Umrechnung zum EZB-Referenzkurs wird noch nicht unterstützt`, affects);
          continue;
        }
        const quantity = num(row, "shares").abs();
        if (quantity.isZero()) throw new RowError("Stückzahl 0");
        const trade: ImportedTrade = {
          line,
          isin,
          depot: DEPOT,
          date: dateOf(row),
          datetime: row.datetime ?? "",
          side: type === "BUY" ? "buy" : "sell",
          quantity: quantity.toString(),
          amountEur: num(row, "amount").abs().toString(),
          feeEur: (row.fee ?? "").trim() === "" ? "0" : num(row, "fee").abs().toString(),
          kind,
          name: row.name ?? "",
        };
        result.trades.push(trade);
        const tax = (row.tax ?? "").trim();
        if (tax !== "" && !num(row, "tax").isZero()) {
          flag(line, label, `Steuerbetrag ${tax} in Spalte tax wird noch nicht angerechnet`);
        }
        if (FUND_CLASSES.has(assetClass) && !fundsNoted.has(isin)) {
          fundsNoted.add(isin);
          flag(
            line,
            label,
            `Fonds/ETF ${isin}: ausschüttungsgleiche Erträge (KZ 937) und Meldefonds-Status werden noch nicht berechnet`,
          );
        }
        continue;
      }

      flag(line, label, "Unbekannter Buchungstyp", affects);
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      flag(line, label, e.message, affects);
    }
  }
  return result;
}
