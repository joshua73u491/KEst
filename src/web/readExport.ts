import { parseTradeRepublicCsv, type ImportResult } from "../import/tradeRepublic.js";

export type ReadResult = { ok: true; data: ImportResult } | { ok: false; message: string };

/** Liest einen Export für die Web-App. Wirft nie: jeder Fehler wird zu einer deutschen Meldung für die Seite. */
export function readExport(text: string): ReadResult {
  try {
    return { ok: true, data: parseTradeRepublicCsv(text) };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Die Datei konnte nicht gelesen werden: ${reason}` };
  }
}
