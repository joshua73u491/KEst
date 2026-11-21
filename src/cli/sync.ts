import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseIbkrFlexXml } from "../import/ibkrFlex.js";
import { parseSnapTradeJson } from "../import/snaptrade.js";
import { FlexError, fetchFlexHistory, type HttpGet } from "../sync/ibkrFlexService.js";
import { fetchSnapTradeSnapshot, type SnapFetch } from "../sync/snaptrade.js";

/**
 * Automatischer Abruf auf der Kommandozeile (kein CORS, kein Relay nötig):
 * - IBKR über den Flex Web Service: Token aus IBKR_FLEX_TOKEN oder --token-datei
 * - SnapTrade Personal (--snaptrade): SNAPTRADE_CLIENT_ID und SNAPTRADE_CONSUMER_KEY
 * Zugangsdaten nie als Befehlsargument (sonst stehen sie im Verlauf und in der Prozessliste).
 * Die Dateien landen in data/private/ (nie committen).
 */
const USAGE =
  "Aufruf IBKR:      npm run sync -- --query <Query-ID> [--seit JJJJ-MM-TT] [--bis JJJJ-MM-TT] [--ausgabe data/private/ibkr] [--token-datei <pfad>]\n" +
  "                  Token in IBKR_FLEX_TOKEN oder in der Token-Datei (Client Portal → Reporting → Flex Queries → Flex Web Service Configuration).\n" +
  "Aufruf SnapTrade: npm run sync -- --snaptrade [--seit JJJJ-MM-TT] [--ausgabe data/private/snaptrade]\n" +
  "                  Schlüssel in SNAPTRADE_CLIENT_ID und SNAPTRADE_CONSUMER_KEY (SnapTrade-Dashboard → API Key).";

const today = new Date().toISOString().slice(0, 10);
let values: Record<string, string | boolean | undefined> = {};
try {
  values = parseArgs({
    options: {
      query: { type: "string" },
      seit: { type: "string" },
      bis: { type: "string" },
      ausgabe: { type: "string" },
      "token-datei": { type: "string" },
      snaptrade: { type: "boolean" },
    },
  }).values;
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
  process.exit(1);
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

async function syncSnapTrade() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID ?? "";
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY ?? "";
  const out = str(values.ausgabe) ?? "data/private/snaptrade";
  const fetchFn: SnapFetch = async (url, init) => {
    const res = await fetch(url, init);
    return { status: res.status, headers: res.headers, text: () => res.text() };
  };
  const seit = str(values.seit);
  console.log("Rufe die verbundenen Konten bei SnapTrade ab …");
  const snap = await fetchSnapTradeSnapshot({ clientId, consumerKey }, { fetchFn, sleep }, seit ? { from: seit, to: str(values.bis) ?? today } : {});
  const text = JSON.stringify(snap);
  const data = parseSnapTradeJson(text);
  mkdirSync(out, { recursive: true });
  const file = join(out, `snaptrade-${today}.json`);
  writeFileSync(file, text, "utf8");
  console.log(`Gespeichert: ${file} (${snap.accounts.length} Konten, ${data.trades.length} Trades, ${data.dividends.length} Dividenden, ${data.unsupported.length} Hinweise)`);
  console.log(`Auswertung: npm run report -- ${file} ${today.slice(0, 4)}`);
}

async function syncIbkr() {
  const tokenFile = str(values["token-datei"]);
  const token = (tokenFile ? readFileSync(tokenFile, "utf8") : (process.env.IBKR_FLEX_TOKEN ?? "")).trim();
  const query = str(values.query);
  if (!query || !token) {
    console.error(USAGE);
    process.exit(1);
  }
  const from = str(values.seit) ?? `${Number(today.slice(0, 4)) - 1}-01-01`;
  const to = str(values.bis) ?? today;
  const out = str(values.ausgabe) ?? "data/private/ibkr";
  const get: HttpGet = async (url) => {
    const res = await fetch(url, { headers: { "User-Agent": "KESt-Ruecklage/1.0" } });
    return { status: res.status, text: await res.text() };
  };
  console.log(`Rufe die Flex Query ${query} von ${from} bis ${to} ab (je Abruf höchstens 365 Tage, IBKR erlaubt 10 Abrufe je Minute) …`);
  const parts = await fetchFlexHistory({ token, queryId: query, from, to }, { get, sleep });
  mkdirSync(out, { recursive: true });
  for (const p of parts) {
    const data = parseIbkrFlexXml(p.xml); // prüft Abschnitte und Felder wie beim Datei-Import
    const file = join(out, `ibkr-flex-${p.from}-bis-${p.to}.xml`);
    writeFileSync(file, p.xml, "utf8");
    console.log(`Gespeichert: ${file} (${data.trades.length} Trades, ${data.dividends.length} Dividenden, ${data.interest.length} Zinsbuchungen)`);
  }
  console.log(`Auswertung: npm run report -- ${parts.map((p) => join(out, `ibkr-flex-${p.from}-bis-${p.to}.xml`)).join(" ")} ${to.slice(0, 4)}`);
}

try {
  if (values.snaptrade) await syncSnapTrade();
  else await syncIbkr();
} catch (e) {
  console.error(`Abruf nicht möglich: ${e instanceof FlexError || e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
