import { ecbApiUrl, parseEcbApiCsv, type RateTable } from "../fx.js";
import type { ImportResult } from "../import/model.js";

export interface RateNeed {
  currencies: string[];
  start: string;
  end: string;
}

/**
 * Welche EZB-Kurse die Auswertung braucht: Währungen und Zeitraum aller Beträge, die zum EZB-Referenzkurs
 * umgerechnet werden (Aktiendividenden in Fremdwährung, IBKR-Trades samt Spesen, Zinsen in Fremdwährung).
 * Trades bei Trade Republic brauchen keine, weil Trade Republic tatsächlich in EUR umrechnet (EStR 2000 Rz 6201c).
 */
export function ratesNeeded(data: ImportResult): RateNeed | null {
  const uses: Array<[currency: string, date: string]> = [];
  for (const d of data.dividends) if (d.kind === "stock" && d.originalCurrency !== "") uses.push([d.originalCurrency, d.date]);
  for (const t of data.trades) {
    if (!t.convert) continue;
    uses.push([t.convert.currency, t.date]);
    for (const f of t.convert.fees) uses.push([f.currency, t.date]);
  }
  for (const i of data.interest) if (i.convert) uses.push([i.convert.currency, i.date]);
  const foreign = uses.filter(([c]) => c !== "EUR");
  if (foreign.length === 0) return null;
  const dates = foreign.map(([, d]) => d).sort();
  return {
    currencies: [...new Set(foreign.map(([c]) => c))].sort(),
    start: dates[0] ?? "",
    end: dates[dates.length - 1] ?? "",
  };
}

type FetchLike = (url: string) => Promise<Response>;

/** Lädt die EZB-Referenzkurse von der EZB-Datenschnittstelle. Übermittelt werden nur Währungen und Zeitraum. */
export async function fetchEcbRates(need: RateNeed, fetchFn: FetchLike = (url) => fetch(url)): Promise<RateTable> {
  let response: Response;
  try {
    response = await fetchFn(ecbApiUrl(need.currencies, need.start, need.end));
  } catch {
    throw new Error("Die EZB-Kurse konnten nicht geladen werden (keine Verbindung zur EZB).");
  }
  if (!response.ok) throw new Error(`Die EZB-Kurse konnten nicht geladen werden (HTTP ${response.status}).`);
  return parseEcbApiCsv(await response.text());
}
