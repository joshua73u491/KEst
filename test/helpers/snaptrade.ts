/**
 * Baut erfundene SnapTrade-Daten für Tests. Feldnamen laut OpenAPI-Spezifikation von SnapTrade
 * (https://docs.snaptrade.com/reference/Account%20Information/AccountInformation_getAccountActivities,
 * AccountInformation_listAllUserAccounts).
 */
export type Activity = Record<string, unknown>;

export interface SymbolSpec {
  id?: string;
  ticker: string;
  figi?: string;
  share?: string;
  typeCode?: string;
  description?: string;
}

export const symbol = (s: SymbolSpec) => ({
  id: s.id ?? `sym-${s.ticker}`,
  symbol: s.ticker,
  raw_symbol: s.ticker,
  description: s.description ?? `ERFUNDEN ${s.ticker}`,
  currency: { code: "EUR" },
  type: { code: s.typeCode ?? "cs", description: "Common Stock" },
  figi_code: s.figi ?? null,
  figi_instrument: s.share ? { figi_code: s.figi ?? null, figi_share_class: s.share } : null,
});

export function activity(type: string, date: string, extra: Activity = {}): Activity {
  return {
    id: `act-${type}-${date}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    trade_date: `${date}T10:00:00Z`,
    settlement_date: `${date}T00:00:00Z`,
    currency: { code: "EUR" },
    fee: 0,
    fx_rate: null,
    institution: "DEGIRO",
    description: "",
    ...extra,
  };
}

export const ACCOUNT = { kind: "investment", id: "11111111-2222-3333-4444-555555555555", display_name: "DEGIRO Depot", masked_account_number: "****1234" };

export function snapshot(activities: Activity[], fetchedAt = "2026-11-21T10:00:00Z", account = ACCOUNT): string {
  return JSON.stringify({ source: "snaptrade", version: 1, fetchedAt, accounts: [account], activities: { [account.id]: activities } });
}
