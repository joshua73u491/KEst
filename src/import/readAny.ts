import { isIbkrFlexXml, parseIbkrFlexXml } from "./ibkrFlex.js";
import type { ImportResult } from "./model.js";
import { parseTradeRepublicCsv } from "./tradeRepublic.js";

export type Broker = "Trade Republic" | "IBKR";

/** Erkennt den Broker am Inhalt (IBKR Flex Query als XML, sonst Trade-Republic-CSV) und liest die Datei. */
export function parseExport(text: string): { broker: Broker; data: ImportResult } {
  if (isIbkrFlexXml(text)) return { broker: "IBKR", data: parseIbkrFlexXml(text) };
  return { broker: "Trade Republic", data: parseTradeRepublicCsv(text) };
}
