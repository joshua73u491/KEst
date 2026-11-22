// MCP-Add-on der KESt-Rücklage (PRODUKTPLAN „Funktionen“, Phase 5): derselbe Rechenkern wie die App, als lokaler
// MCP-Server über stdio für Claude. Start: npm run mcp
// Historie: KEST_HISTORY (Standard: data/private/kest-historie.json im Repository), im Backup-Format der Web-App.
// Optional: KEST_EZB_KURSE (eurofxref-hist.csv statt Abruf bei der EZB), IBKR_FLEX_TOKEN, SNAPTRADE_CLIENT_ID,
// SNAPTRADE_CONSUMER_KEY für den automatischen Abruf. Nichts wird an Dritte gesendet außer an EZB, IBKR bzw. SnapTrade
// (nur auf Anforderung).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseRateFile } from "../fx.js";
import { addFile, emptyHistory, fromBackup, toBackup, type History } from "../history.js";
import { fetchFlexHistory } from "../sync/ibkrFlexService.js";
import { fetchSnapTradeSnapshot } from "../sync/snaptrade.js";
import { fetchEcbRates, ratesNeeded } from "../web/loadRates.js";
import { createTools, type Tool, type ToolStore } from "./tools.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const historyPath = process.env.KEST_HISTORY ?? resolve(root, "data/private/kest-historie.json");
const now = () => new Date().toISOString();
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const store: ToolStore = {
  load: () => (existsSync(historyPath) ? fromBackup(readFileSync(historyPath, "utf8")) : emptyHistory()),
  save: (h: History) => {
    mkdirSync(dirname(historyPath), { recursive: true });
    writeFileSync(historyPath, toBackup(h, now()), "utf8");
  },
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, d) => writeFileSync(p, d),
  today,
  now,
  rates: async (data) => {
    if (process.env.KEST_EZB_KURSE) return parseRateFile(readFileSync(process.env.KEST_EZB_KURSE, "latin1"));
    const need = ratesNeeded(data);
    return need ? fetchEcbRates(need) : null;
  },
};

// Automatischer Abruf, nur wenn die Zugangsdaten in der Umgebung stehen (nie als Werkzeug-Argument)
const syncTools: Tool[] = [
  {
    name: "sync_ibkr",
    description: "Ruft die Activity Flex Query über den Flex Web Service von IBKR ab (Token aus IBKR_FLEX_TOKEN) und speichert sie in der Historie.",
    params: {
      query_id: { type: "string", description: "Query-ID der Activity Flex Query" },
      since: { type: "string", description: "JJJJ-MM-TT, ab dem abgerufen wird (Standard: 1. Jänner des Vorjahres)", optional: true },
    },
    async run(a) {
      const token = process.env.IBKR_FLEX_TOKEN ?? "";
      if (!token) throw new Error("IBKR_FLEX_TOKEN ist nicht gesetzt. Das Token gehört in die Umgebung des MCP-Servers, nicht in den Chat.");
      const from = typeof a.since === "string" && a.since ? a.since : `${Number(today().slice(0, 4)) - 1}-01-01`;
      const get = async (url: string) => {
        const res = await fetch(url, { headers: { "User-Agent": "KESt-Ruecklage/1.0" } });
        return { status: res.status, text: await res.text() };
      };
      const parts = await fetchFlexHistory({ token, queryId: String(a.query_id ?? ""), from, to: today() }, { get, sleep });
      let h = store.load();
      let added = 0;
      for (const p of parts) {
        const r = addFile(h, `IBKR automatisch ${p.from} bis ${p.to}.xml`, p.xml, now(), `mcp-ibkr-${p.from}-${Date.now()}`);
        h = r.history;
        if (r.added) added++;
      }
      store.save(h);
      return { text: `IBKR: ${parts.length} Zeiträume abgerufen, ${added} neu gespeichert.` };
    },
  },
  {
    name: "sync_snaptrade",
    description: "Ruft alle über SnapTrade Personal verbundenen Konten ab (Schlüssel aus SNAPTRADE_CLIENT_ID und SNAPTRADE_CONSUMER_KEY) und ersetzt den vorigen SnapTrade-Abruf in der Historie.",
    params: {},
    async run() {
      const clientId = process.env.SNAPTRADE_CLIENT_ID ?? "";
      const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY ?? "";
      const snap = await fetchSnapTradeSnapshot(
        { clientId, consumerKey },
        {
          fetchFn: async (url, init) => {
            const res = await fetch(url, init);
            return { status: res.status, headers: res.headers, text: () => res.text() };
          },
          sleep,
        },
      );
      const h = store.load();
      const base = { ...h, files: h.files.filter((f) => f.broker !== "SnapTrade") };
      store.save(addFile(base, `SnapTrade ${today()}.json`, JSON.stringify(snap), now(), `mcp-snap-${Date.now()}`).history);
      return { text: `SnapTrade: ${snap.accounts.length} Konten abgerufen und gespeichert.` };
    },
  },
];

function zodShape(params: Tool["params"]) {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, p] of Object.entries(params)) {
    let t: z.ZodType = p.type === "number" ? z.number() : p.type === "boolean" ? z.boolean() : p.enum ? z.enum(p.enum as [string, ...string[]]) : z.string();
    t = t.describe(p.description);
    shape[k] = p.optional ? t.optional() : t;
  }
  return shape;
}

const server = new McpServer({ name: "kest-ruecklage", version: "0.1.0" });
for (const tool of [...createTools(store), ...syncTools]) {
  server.registerTool(tool.name, { description: tool.description, inputSchema: zodShape(tool.params) }, async (args: Record<string, unknown>) => {
    try {
      const r = await tool.run(args ?? {});
      return { content: [{ type: "text" as const, text: r.text }, ...(r.data !== undefined ? [{ type: "text" as const, text: JSON.stringify(r.data, null, 2) }] : [])] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  });
}
await server.connect(new StdioServerTransport());
