/**
 * Baut erfundene DEGIRO-Exporte für Tests.
 * - Transaktionen (Transactions.csv): Kopfzeile laut https://github.com/wirrike/degiro-portfolio (englischer Export),
 *   17 Spalten; nach „Price“ und „Local value“ steht je eine Spalte ohne Namen mit der Währung.
 * - Kontoübersicht (Account.csv): Kopfzeilen laut https://github.com/nyg/libdegiro (README, „Supported exports“),
 *   12 Spalten; nach „Change“ und „Balance“ steht je eine Spalte ohne Namen mit dem Betrag.
 * Zahlen im europäischen Format („1.234,56“), Datum TT-MM-JJJJ.
 */
export const TX_HEADER_EN =
  "Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID";
export const ACCOUNT_HEADER_DE = "Datum,Uhrzeit,Wertstellungsdatum,Produkt,ISIN,Beschreibung,FX,Änderung,,Saldo,,Auftrag ID";
export const ACCOUNT_HEADER_EN = "Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id";

const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const line = (cells: string[]) => cells.map(q).join(",");

export interface DgTrade {
  date: string; // TT-MM-JJJJ
  time?: string;
  product?: string;
  isin: string;
  quantity: string; // negativ = Verkauf
  price: string;
  currency?: string;
  local: string; // Kurswert in Handelswährung, negativ bei Kauf
  valueEur: string;
  rate?: string;
  autoFx?: string;
  fees?: string;
  total?: string;
  orderId?: string;
}

export function dgTransactions(trades: DgTrade[], header = TX_HEADER_EN): string {
  const rows = trades.map((t) =>
    line([
      t.date,
      t.time ?? "10:00",
      t.product ?? `ERFUNDEN ${t.isin}`,
      t.isin,
      "XET",
      "XETA",
      t.quantity,
      t.price,
      t.currency ?? "EUR",
      t.local,
      t.currency ?? "EUR",
      t.valueEur,
      t.rate ?? "",
      t.autoFx ?? "0,00",
      t.fees ?? "-2,00",
      t.total ?? t.valueEur,
      t.orderId ?? `ord-${t.date}-${t.isin}-${t.quantity}`,
    ]),
  );
  return [header, ...rows].join("\n") + "\n";
}

export interface DgCash {
  date: string; // TT-MM-JJJJ
  valueDate?: string;
  product?: string;
  isin?: string;
  description: string;
  currency?: string;
  amount: string;
}

export function dgAccount(rows: Array<DgCash | { wrap: string }>, header = ACCOUNT_HEADER_DE): string {
  const lines = rows.map((r) =>
    "wrap" in r
      ? line(["", "", "", "", "", r.wrap, "", "", "", "", "", ""])
      : line([r.date, "07:30", r.valueDate ?? r.date, r.product ?? "", r.isin ?? "", r.description, "", r.currency ?? "EUR", r.amount, r.currency ?? "EUR", "100,00", ""]),
  );
  return [header, ...lines].join("\n") + "\n";
}
