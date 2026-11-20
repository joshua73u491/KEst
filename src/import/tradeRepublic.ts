import { dec, type Dec } from "../decimal.js";
import { formatEur } from "../format.js";
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
  /** von Trade Republic einbehaltene Steuer laut Spalte `tax` (positiv = einbehalten, negativ = gutgeschrieben) */
  withheldEur: string;
  /**
   * Handelswährung, wenn nicht EUR. `amountEur` ist dann der Betrag, den Trade Republic tatsächlich umgerechnet hat;
   * bei tatsächlicher Konvertierung zählt dieser Kurs (EStR 2000 Rz 6201c, Annahme im README).
   */
  originalCurrency: string;
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
  /** Zeile in der CSV-Datei (Kopfzeile = 1) */
  line: number;
  date: string;
  amountEur: string;
  /** einbehaltene Steuer laut Spalte `tax` (positiv = einbehalten) */
  withheldEur: string;
  /** gesetzt bei Zinsen aus einem Wertpapier (z. B. Anleihe), leer bei Zinsen auf dem Verrechnungskonto */
  isin: string;
}

/**
 * Art der Ausschüttung laut Export:
 * - `stock`: Dividende einer Aktie (Buchungstyp DIVIDEND, Anlageklasse STOCK)
 * - `fund`: Ausschüttung eines Fonds oder ETF (DIVIDEND oder DISTRIBUTION, Anlageklasse FUND/ETF)
 * - `capitalDistribution`: DIVIDEND_EQUIVALENT_PAYMENT („Capital Distribution“), ob Dividende oder Einlagenrückzahlung, ist offen
 */
export type DistributionKind = "stock" | "fund" | "capitalDistribution";

export interface ImportedDividend {
  /** Zeile in der CSV-Datei (Kopfzeile = 1) */
  line: number;
  isin: string;
  depot: string;
  date: string;
  datetime: string;
  name: string;
  kind: DistributionKind;
  /** Bruttobetrag in EUR (Spalte `amount`) */
  grossEur: string;
  /** einbehaltene Steuer laut Spalte `tax` (positiv = einbehalten, negativ = gutgeschrieben) */
  withheldEur: string;
  /** Originalwährung laut Export; leer, wenn in EUR ausgeschüttet */
  originalCurrency: string;
  /** Bruttobetrag in der Originalwährung (Spalte `original_amount`), leer bei EUR */
  originalAmount: string;
  /** Umrechnungskurs von Trade Republic (Spalte `fx_rate`, EUR je Einheit Fremdwährung), leer wenn nicht angegeben */
  brokerFxRate: string;
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
  dividends: ImportedDividend[];
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

/**
 * Buchungstypen für Ausschüttungen im Transaktionsexport. Quelle: der quelloffene Trade-Republic-CSV-Importer von
 * Portfolio Performance (TradeRepublicCSVExtractor.processCash/processCashDividend, Stand Commit 96f6040, 10.10.2026):
 * https://github.com/portfolio-performance/portfolio/blob/96f6040818d5b5e8aeaca63e60e7e6857b4befa2/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/traderepublic/TradeRepublicCSVExtractor.java
 * Dort: `amount` = Bruttobetrag, `tax` = einbehaltene Steuer (negativ), negativer `amount` = Storno einer Ausschüttung.
 */
const DISTRIBUTION_TYPES = new Set(["DIVIDEND", "DISTRIBUTION", "DIVIDEND_EQUIVALENT_PAYMENT"]);

function distributionKind(type: string, assetClass: string): DistributionKind | null {
  if (FUND_CLASSES.has(assetClass) && (type === "DIVIDEND" || type === "DISTRIBUTION")) return "fund";
  if (assetClass === "STOCK" && type === "DIVIDEND") return "stock";
  if (assetClass === "STOCK" && type === "DIVIDEND_EQUIVALENT_PAYMENT") return "capitalDistribution";
  return null;
}

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

/** Einbehaltene Steuer laut Spalte `tax`: im Export negativ, hier positiv. Leer = nichts einbehalten. */
function withheldOf(row: Record<string, string>): string {
  if ((row.tax ?? "").trim() === "") return "0";
  const tax = num(row, "tax");
  return tax.isZero() ? "0" : tax.negated().toString();
}

/** Originalwährung laut Export, leer bei EUR oder ohne Angabe. */
function originalCurrencyOf(row: Record<string, string>): string {
  const c = (row.original_currency ?? "").trim().toUpperCase();
  return c === "EUR" ? "" : c;
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

  const result: ImportResult = { trades: [], transfersOut: [], interest: [], dividends: [], unsupported: [] };
  const flag = (line: number, type: string, reason: string, affects?: Unsupported["affects"]) =>
    result.unsupported.push(affects ? { line, type, reason, affects } : { line, type, reason });
  const fundsNoted = new Set<string>();
  /** Stornos (negativer Betrag), werden nach dem Einlesen mit der ursprünglichen Ausschüttung verrechnet */
  const reversals: Array<{ dividend: ImportedDividend; label: string }> = [];

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
          else
            result.interest.push({
              line,
              date: dateOf(row),
              amountEur: num(row, "amount").toString(),
              withheldEur: withheldOf(row),
              isin: symbol.trim(),
            });
          continue;
        }
        if (DISTRIBUTION_TYPES.has(type)) {
          const assetClass = row.asset_class ?? "";
          const kind = distributionKind(type, assetClass);
          if (!kind) {
            flag(line, label, `Ausschüttung (${type}) für Anlageklasse ${assetClass || "(leer)"} wird noch nicht zugeordnet`);
            continue;
          }
          if (row.currency !== "EUR") {
            flag(line, label, `Währung ${row.currency} wird noch nicht unterstützt`);
            continue;
          }
          if (symbol.trim() === "") throw new RowError("ISIN fehlt");
          const gross = num(row, "amount");
          if (gross.isZero()) throw new RowError("Betrag 0");
          const originalCurrency = originalCurrencyOf(row);
          const entry: ImportedDividend = {
            line,
            isin: symbol.trim(),
            depot: DEPOT,
            date: dateOf(row),
            datetime: row.datetime ?? "",
            name: row.name ?? "",
            kind,
            grossEur: gross.toString(),
            withheldEur: withheldOf(row),
            originalCurrency,
            originalAmount: originalCurrency !== "" && (row.original_amount ?? "").trim() !== "" ? num(row, "original_amount").toString() : "",
            brokerFxRate: originalCurrency !== "" && (row.fx_rate ?? "").trim() !== "" ? num(row, "fx_rate").toString() : "",
          };
          if (gross.lt(0)) reversals.push({ dividend: entry, label });
          else result.dividends.push(entry);
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
          withheldEur: withheldOf(row),
          originalCurrency: originalCurrencyOf(row),
          kind,
          name: row.name ?? "",
        };
        result.trades.push(trade);
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

  // Storno: hebt die frühere Ausschüttung derselben ISIN auf, die es genau umkehrt (Betrag und Steuer mit
  // umgekehrtem Vorzeichen). Ohne passendes Gegenstück wird nichts verrechnet, sondern gemeldet.
  for (const { dividend: rev, label } of reversals) {
    const i = result.dividends.findIndex(
      (d) =>
        d.isin === rev.isin &&
        d.datetime <= rev.datetime &&
        dec(d.grossEur).eq(dec(rev.grossEur).negated()) &&
        dec(d.withheldEur).eq(dec(rev.withheldEur).negated()),
    );
    const original = result.dividends[i];
    if (!original) {
      flag(
        rev.line,
        label,
        `Storno einer Ausschüttung von ${rev.isin} (${formatEur(rev.grossEur)}) ohne passende ursprüngliche Buchung. Nicht berechnet, bitte prüfen.`,
      );
      continue;
    }
    result.dividends.splice(i, 1);
    if (original.date.slice(0, 4) !== rev.date.slice(0, 4)) {
      flag(
        rev.line,
        label,
        `Ausschüttung von ${rev.isin} vom ${original.date} wurde am ${rev.date} storniert. Eine Neubuchung zählt im Jahr ihres Buchungsdatums; bitte prüfen, welchem Jahr sie zuzurechnen ist.`,
      );
    }
  }
  return result;
}
