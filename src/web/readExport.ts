import type { ImportResult } from "../import/model.js";
import { parseExport, type Broker } from "../import/readAny.js";

export type ReadResult = { ok: true; broker: Broker; data: ImportResult } | { ok: false; message: string };

/** Liest einen Export für die Web-App. Wirft nie: jeder Fehler wird zu einer deutschen Meldung für die Seite. */
export function readExport(text: string): ReadResult {
  try {
    const { broker, data } = parseExport(text);
    return { ok: true, broker, data };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Die Datei konnte nicht gelesen werden: ${reason}` };
  }
}
