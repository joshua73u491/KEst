import { ecbApiUrl, parseEcbApiCsv, type RateTable } from "../fx.js";
import type { ImportResult } from "../import/tradeRepublic.js";

export interface RateNeed {
  currencies: string[];
  start: string;
  end: string;
}

/**
 * Welche EZB-Kurse die Auswertung braucht: Währungen und Zeitraum der Aktiendividenden in Fremdwährung.
 * Trades brauchen keine, weil Trade Republic tatsächlich in EUR umrechnet (EStR 2000 Rz 6201c).
 */
export function ratesNeeded(data: ImportResult): RateNeed | null {
  const fx = data.dividends.filter((d) => d.kind === "stock" && d.originalCurrency !== "");
  if (fx.length === 0) return null;
  const dates = fx.map((d) => d.date).sort();
  return {
    currencies: [...new Set(fx.map((d) => d.originalCurrency))].sort(),
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
