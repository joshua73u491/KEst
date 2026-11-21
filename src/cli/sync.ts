import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseIbkrFlexXml } from "../import/ibkrFlex.js";
import { FlexError, fetchFlexHistory, type HttpGet } from "../sync/ibkrFlexService.js";

/**
 * Automatischer Abruf der IBKR Flex Query auf der Kommandozeile (kein CORS, kein Relay nötig).
 * Das Token kommt aus der Umgebungsvariable IBKR_FLEX_TOKEN oder aus einer Datei, nie aus der Befehlszeile
 * (sonst stünde es im Verlauf und in der Prozessliste). Die Dateien landen in data/private/ (nie committen).
 */
const USAGE =
  "Aufruf: npm run sync -- --query <Query-ID> [--seit JJJJ-MM-TT] [--bis JJJJ-MM-TT] [--ausgabe data/private/ibkr] [--token-datei <pfad>]\n" +
  "Das Token steht in IBKR_FLEX_TOKEN oder in der Token-Datei (Client Portal → Reporting → Flex Queries → Flex Web Service Configuration).";

const today = new Date().toISOString().slice(0, 10);
let values: Record<string, string | undefined> = {};
try {
  values = parseArgs({
    options: { query: { type: "string" }, seit: { type: "string" }, bis: { type: "string" }, ausgabe: { type: "string" }, "token-datei": { type: "string" } },
  }).values;
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
  process.exit(1);
}
const tokenFile = values["token-datei"];
const token = (tokenFile ? readFileSync(tokenFile, "utf8") : (process.env.IBKR_FLEX_TOKEN ?? "")).trim();
if (!values.query || !token) {
  console.error(USAGE);
  process.exit(1);
}
const from = values.seit ?? `${Number(today.slice(0, 4)) - 1}-01-01`;
const to = values.bis ?? today;
const out = values.ausgabe ?? "data/private/ibkr";

const get: HttpGet = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "KESt-Ruecklage/1.0" } });
  return { status: res.status, text: await res.text() };
};

try {
  console.log(`Rufe die Flex Query ${values.query} von ${from} bis ${to} ab (je Abruf höchstens 365 Tage, IBKR erlaubt 10 Abrufe je Minute) …`);
  const parts = await fetchFlexHistory(
    { token, queryId: values.query, from, to },
    { get, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  );
  mkdirSync(out, { recursive: true });
  for (const p of parts) {
    const data = parseIbkrFlexXml(p.xml); // prüft Abschnitte und Felder wie beim Datei-Import
    const file = join(out, `ibkr-flex-${p.from}-bis-${p.to}.xml`);
    writeFileSync(file, p.xml, "utf8");
    console.log(`Gespeichert: ${file} (${data.trades.length} Trades, ${data.dividends.length} Dividenden, ${data.interest.length} Zinsbuchungen)`);
  }
  console.log(`Auswertung: npm run report -- ${parts.map((p) => join(out, `ibkr-flex-${p.from}-bis-${p.to}.xml`)).join(" ")} ${to.slice(0, 4)}`);
} catch (e) {
  console.error(`Abruf nicht möglich: ${e instanceof FlexError || e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
