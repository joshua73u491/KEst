import { dec } from "../decimal.js";
import { parseCsv } from "./csv.js";

/** Steuertopf eines Wertpapiers. */
export type AssetKind = "security" | "securitizedDerivative" | "crypto";

export interface ImportedTrade {
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

const abs = (v: string) => dec(v).abs().toString();

export function parseTradeRepublicCsv(text: string): ImportResult {
  const rows = parseCsv(text).map((row, i) => ({ row, line: i + 2 }));
  rows.sort((a, b) => (a.row.datetime ?? "").localeCompare(b.row.datetime ?? ""));

  const result: ImportResult = { trades: [], transfersOut: [], interest: [], unsupported: [] };
  const flag = (line: number, type: string, reason: string) => result.unsupported.push({ line, type, reason });

  for (const { row, line } of rows) {
    const category = row.category ?? "";
    const type = row.type ?? "";
    const label = `${category}/${type}`;
    const date = row.date ?? "";

    if (category === "CASH") {
      if (IGNORED_CASH_TYPES.has(type)) continue;
      if (type === "INTEREST_PAYMENT") {
        if (row.currency !== "EUR") flag(line, label, `Währung ${row.currency} wird noch nicht unterstützt`);
        else result.interest.push({ date, amountEur: dec(row.amount ?? "0").toString() });
        continue;
      }
      flag(line, label, "Unbekannter Buchungstyp");
      continue;
    }

    const kind = KIND_BY_ASSET_CLASS[row.asset_class ?? ""];
    const isin = row.symbol ?? "";

    if (category === "DELIVERY" && type === "FREE_DELIVERY" && kind) {
      result.transfersOut.push({ isin, depot: DEPOT, date, datetime: row.datetime ?? "", quantity: abs(row.shares ?? "0"), kind });
      continue;
    }

    if (category === "TRADING" && (type === "BUY" || type === "SELL")) {
      if (!kind) {
        flag(line, label, `Anlageklasse ${row.asset_class || "(leer)"} ist noch nicht zugeordnet`);
        continue;
      }
      if (row.currency !== "EUR") {
        flag(line, label, `Währung ${row.currency} wird noch nicht unterstützt`);
        continue;
      }
      result.trades.push({
        isin,
        depot: DEPOT,
        date,
        datetime: row.datetime ?? "",
        side: type === "BUY" ? "buy" : "sell",
        quantity: abs(row.shares ?? "0"),
        amountEur: abs(row.amount ?? "0"),
        feeEur: abs(row.fee || "0"),
        kind,
        name: row.name ?? "",
      });
      continue;
    }

    flag(line, label, "Unbekannter Buchungstyp");
  }
  return result;
}
