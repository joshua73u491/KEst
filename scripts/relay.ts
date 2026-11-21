// Lokaler Relay-Server für den automatischen IBKR-Abruf aus der Web-App (IBKR erlaubt keine Abrufe aus Webseiten).
// Start: npm run relay  (Port 8787, nur auf diesem Rechner erreichbar)
// Erlaubte Seiten: KEST_RELAY_ORIGINS, durch Komma getrennt (Standard: die lokalen Testadressen der App).
// Speichert nichts und schreibt keine Protokolle mit Token oder Inhalt.
import { createServer } from "node:http";
import { handleRelay } from "../src/sync/relay.js";
import type { HttpGet } from "../src/sync/ibkrFlexService.js";

const port = Number(process.env.KEST_RELAY_PORT ?? 8787);
const allowedOrigins = (process.env.KEST_RELAY_ORIGINS ?? "http://localhost:4317,http://localhost:4318,http://localhost:4319,null")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const get: HttpGet = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "KESt-Ruecklage/1.0" } });
  return { status: res.status, text: await res.text() };
};

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const request = new Request(`http://localhost:${port}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
  });
  const response = await handleRelay(request, { get, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), allowedOrigins });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, "127.0.0.1", () => {
  console.log(`Relay für IBKR läuft auf http://localhost:${port} (erlaubt: ${allowedOrigins.join(", ")})`);
});
