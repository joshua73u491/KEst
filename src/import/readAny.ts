import { isDegiroCsv, parseDegiroCsv } from "./degiro.js";
import { isIbkrFlexXml, parseIbkrFlexXml } from "./ibkrFlex.js";
import type { ImportResult } from "./model.js";
import { parseTradeRepublicCsv } from "./tradeRepublic.js";

export type Broker = "Trade Republic" | "IBKR" | "DEGIRO";

/**
 * Erkennt den Broker am Inhalt und liest die Datei: IBKR Flex Query als XML, DEGIRO-CSV am Spaltenlayout,
 * sonst Trade-Republic-CSV.
 */
export function parseExport(text: string): { broker: Broker; data: ImportResult } {
  if (isIbkrFlexXml(text)) return { broker: "IBKR", data: parseIbkrFlexXml(text) };
  if (isDegiroCsv(text)) return { broker: "DEGIRO", data: parseDegiroCsv(text) };
  return { broker: "Trade Republic", data: parseTradeRepublicCsv(text) };
}
