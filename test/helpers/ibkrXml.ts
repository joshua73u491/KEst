/**
 * Baut erfundene IBKR-Flex-Query-Dateien (XML) für Tests. Attributnamen wie in echten Activity Flex Queries
 * (siehe Beispieldateien des IBKR-Importers von Portfolio Performance, src/import/ibkrFlex.ts).
 * Jedes Element steht in einer eigenen Zeile: Zeile 1 FlexQueryResponse, 2 FlexStatements, 3 FlexStatement,
 * dann die Abschnitte in der Reihenfolge Trades, CashTransactions, OpenPositions.
 */
export type Attrs = Record<string, string>;

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const el = (name: string, attrs: Attrs) => `<${name} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")} />`;

export interface Sections {
  trades?: Attrs[] | null;
  cash?: Attrs[] | null;
  positions?: Attrs[] | null;
  account?: string;
}

export function ibkrXml({ trades = [], cash = [], positions = [], account = "U0000000" }: Sections = {}): string {
  const lines = [
    '<FlexQueryResponse queryName="KESt" type="AF">',
    '<FlexStatements count="1">',
    `<FlexStatement accountId="${account}" fromDate="20260101" toDate="20261231" period="YearToDate" whenGenerated="20270102;080000">`,
  ];
  const section = (name: string, child: string, rows: Attrs[] | null) => {
    if (rows === null) return;
    lines.push(`<${name}>`, ...rows.map((r) => el(child, r)), `</${name}>`);
  };
  section("Trades", "Trade", trades);
  section("CashTransactions", "CashTransaction", cash);
  section("OpenPositions", "OpenPosition", positions);
  lines.push("</FlexStatement>", "</FlexStatements>", "</FlexQueryResponse>");
  return lines.join("\n") + "\n";
}

/** Erste Zeile des ersten Abschnitts (Trades bzw. der erste vorhandene Abschnitt beginnt in Zeile 4). */
export const FIRST_ROW_LINE = 5;

/** Ein ausgeführter Trade (levelOfDetail EXECUTION). Verkauf: negative Stückzahl, positive proceeds. */
export function ibTrade(side: "BUY" | "SELL", date: string, isin: string, quantity: string, proceeds: string, extra: Attrs = {}): Attrs {
  return {
    accountId: "U0000000",
    currency: "USD",
    assetCategory: "STK",
    subCategory: "COMMON",
    symbol: `SYM${isin.slice(-3)}`,
    description: `ERFUNDEN ${isin}`,
    isin,
    multiplier: "1",
    tradeDate: date,
    tradeTime: "153000",
    quantity: side === "SELL" ? `-${quantity}` : quantity,
    tradePrice: "0",
    proceeds: side === "SELL" ? proceeds : `-${proceeds}`,
    taxes: "0",
    ibCommission: "-1",
    ibCommissionCurrency: "USD",
    buySell: side,
    transactionType: "ExchTrade",
    transactionID: `T-${side}-${date}-${isin}`,
    levelOfDetail: "EXECUTION",
    ...extra,
  };
}

/** Eine Buchung im Abschnitt CashTransactions (levelOfDetail DETAIL). */
export function ibCash(type: string, dateTime: string, amount: string, extra: Attrs = {}): Attrs {
  return {
    accountId: "U0000000",
    currency: "USD",
    assetCategory: "STK",
    subCategory: "COMMON",
    symbol: "",
    description: type,
    isin: "",
    dateTime,
    settleDate: dateTime.slice(0, 8),
    reportDate: dateTime.slice(0, 8),
    amount,
    type,
    transactionID: `C-${type}-${dateTime}-${amount}`,
    actionID: "",
    levelOfDetail: "DETAIL",
    ...extra,
  };
}

export function ibPosition(isin: string, position: string, extra: Attrs = {}): Attrs {
  return {
    accountId: "U0000000",
    currency: "USD",
    assetCategory: "STK",
    symbol: `SYM${isin.slice(-3)}`,
    isin,
    position,
    reportDate: "20261231",
    side: "Long",
    levelOfDetail: "SUMMARY",
    ...extra,
  };
}
