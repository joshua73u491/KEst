/** Baut erfundene Trade-Republic-Exporte für Tests. Nur Spalten setzen, die der Test braucht. */
export const TR_HEADER = [
  "datetime", "date", "account_type", "category", "type", "asset_class", "name", "symbol", "shares", "price",
  "amount", "fee", "tax", "currency", "original_amount", "original_currency", "fx_rate", "description",
  "transaction_id", "counterparty_name", "counterparty_iban", "payment_reference", "mcc_code",
] as const;

export type TrRow = Partial<Record<(typeof TR_HEADER)[number], string>>;

const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function trCsv(...rows: TrRow[]): string {
  const lines = [TR_HEADER.map(quote).join(",")];
  for (const row of rows) lines.push(TR_HEADER.map((h) => quote(row[h] ?? "")).join(","));
  return lines.join("\n") + "\n";
}

/** Ein Kauf oder Verkauf in EUR; Vorzeichen wie im echten Export (Verkauf: negative Stückzahl). */
export function trade(
  side: "BUY" | "SELL",
  at: string,
  symbol: string,
  shares: string,
  amount: string,
  extra: TrRow = {},
): TrRow {
  return {
    datetime: at,
    date: at.slice(0, 10),
    account_type: "DEFAULT",
    category: "TRADING",
    type: side,
    asset_class: "STOCK",
    name: `Erfunden ${symbol}`,
    symbol,
    shares: side === "SELL" ? `-${shares}` : shares,
    amount: side === "BUY" ? `-${amount}` : amount,
    fee: "-1.00",
    currency: "EUR",
    transaction_id: `${side}-${at}-${symbol}`,
    ...extra,
  };
}
