import { flexWindows } from "./ibkrFlexService.js";

/**
 * Automatischer IBKR-Abruf aus der Web-App über das Relay (`src/sync/relay.ts`). Je Zeitfenster (höchstens 365 Tage)
 * ein Abruf; dazwischen eine Pause, damit die Grenze von IBKR (10 Abrufe je Minute, je Fenster mindestens zwei) hält.
 */

export interface RelaySyncRequest {
  /** Adresse des Relays, z. B. http://localhost:8787 */
  relay: string;
  token: string;
  queryId: string;
  from: string;
  to: string;
}

export type FetchLike = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export const WINDOW_PAUSE_MS = 13_000;

function relayUrl(relay: string, route: string): { url: string; origin: string } {
  let base: URL;
  try {
    base = new URL(relay.trim());
  } catch {
    throw new Error("Die Adresse des Relays fehlt oder ist ungültig (z. B. http://localhost:8787).");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("Die Adresse des Relays muss mit http:// oder https:// beginnen.");
  return { url: `${base.origin}${base.pathname.replace(/\/$/, "")}/${route}`, origin: base.origin };
}

async function post(fetchFn: FetchLike, url: string, origin: string, body: unknown): Promise<string> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`Das Relay unter ${origin} ist nicht erreichbar. Läuft es (npm run relay)?`);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = `Das Relay meldet Fehler ${res.status}.`;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      // keine JSON-Antwort: allgemeine Meldung
    }
    throw new Error(message);
  }
  return text;
}

/** SnapTrade Personal über das Relay: liefert den Schnappschuss als JSON-Text (für die Historie). */
export async function syncSnapTradeViaRelay(
  req: { relay: string; clientId: string; consumerKey: string },
  deps: { fetchFn: FetchLike },
): Promise<string> {
  if (!req.clientId.trim() || !req.consumerKey.trim()) throw new Error("Bitte Client ID und Consumer Key aus dem SnapTrade-Dashboard (API Key) eintragen.");
  const { url, origin } = relayUrl(req.relay, "snaptrade");
  return post(deps.fetchFn, url, origin, { clientId: req.clientId.trim(), consumerKey: req.consumerKey.trim() });
}

export async function syncViaRelay(
  req: RelaySyncRequest,
  deps: { fetchFn: FetchLike; sleep: (ms: number) => Promise<void>; onProgress?: (done: number, total: number) => void },
): Promise<Array<{ from: string; to: string; xml: string }>> {
  const { url, origin } = relayUrl(req.relay, "ibkr-flex");
  const windows = flexWindows(req.from, req.to);
  const out: Array<{ from: string; to: string; xml: string }> = [];
  for (const [i, w] of windows.entries()) {
    if (i > 0) await deps.sleep(WINDOW_PAUSE_MS);
    const xml = await post(deps.fetchFn, url, origin, { token: req.token.trim(), queryId: req.queryId.trim(), from: w.from, to: w.to });
    out.push({ ...w, xml });
    deps.onProgress?.(i + 1, windows.length);
  }
  return out;
}
