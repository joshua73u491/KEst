/**
 * Abruf bei SnapTrade mit einem Personal API Key (Entscheidung Joshua, 21.11.2026: SnapTrade Personal). Jeder Nutzer
 * hat sein eigenes, kostenloses SnapTrade-Konto, verbindet dort seine Broker und trägt Client ID und Consumer Key ein.
 * Quellen (geprüft am 21.11.2026):
 * - Personal API Key: https://docs.snaptrade.com/docs/personal-api-key (ohne userId/userSecret)
 * - Signatur: https://docs.snaptrade.com/docs/request-signatures (HMAC-SHA256 über kanonisches JSON, Base64)
 * - Konten: GET /accounts/all; Aktivitäten: GET /accounts/{id}/activities (seitenweise, höchstens 1000 je Seite)
 * SnapTrade erlaubt Webseiten den Header `Signature` nicht (CORS, geprüft); der Abruf läuft daher über das lokale Relay
 * oder die Kommandozeile.
 */

export const SNAPTRADE_BASE = "https://api.snaptrade.com";

export type SnapFetch = (
  url: string,
  init: { method: "GET"; headers: Record<string, string> },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text: () => Promise<string> }>;

export interface SnapCreds {
  clientId: string;
  consumerKey: string;
}

export interface SnapDeps {
  fetchFn: SnapFetch;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Schnappschuss aller Anlagekonten und ihrer Aktivitäten, so wie SnapTrade sie liefert. */
export interface SnapSnapshot {
  source: "snaptrade";
  version: 1;
  fetchedAt: string;
  accounts: Array<Record<string, unknown> & { id: string }>;
  activities: Record<string, unknown[]>;
}

/** Kanonisches JSON laut SnapTrade: Schlüssel auf jeder Ebene alphabetisch, ohne Leerraum. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** Signatur einer Anfrage: HMAC-SHA256 mit dem Consumer Key über {content, path, query}, Base64 (Web Crypto). */
export async function signRequest(consumerKey: string, path: string, query: string, content: unknown): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(consumerKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(canonicalJson({ content: content ?? null, path, query }))));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

const MAX_RETRIES = 5;

async function call(creds: SnapCreds, deps: SnapDeps, path: string, params: Array<[string, string]> = []): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const ts = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
    const query = [["clientId", creds.clientId.trim()], ["timestamp", String(ts)], ...params].map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
    const signature = await signRequest(creds.consumerKey.trim(), path, query, null);
    let res: Awaited<ReturnType<SnapFetch>>;
    try {
      res = await deps.fetchFn(`${SNAPTRADE_BASE}${path}?${query}`, { method: "GET", headers: { Signature: signature, Accept: "application/json" } });
    } catch {
      throw new Error("SnapTrade ist nicht erreichbar. Bitte Internetverbindung prüfen und später erneut versuchen.");
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const after = Number(res.headers.get("Retry-After"));
      await deps.sleep((Number.isFinite(after) && after > 0 ? after : 5 * 2 ** attempt) * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("SnapTrade lehnt die Anmeldung ab: Client ID oder Consumer Key sind ungültig oder widerrufen. Beide stehen im SnapTrade-Dashboard unter „API Key“.");
    }
    if (res.status >= 400) throw new Error(`SnapTrade meldet Fehler ${res.status}. Bitte später erneut versuchen.`);
    try {
      return JSON.parse(await res.text()) as unknown;
    } catch {
      throw new Error("SnapTrade hat eine unerwartete Antwort geschickt (kein JSON).");
    }
  }
}

/** Ruft alle Anlagekonten und deren Aktivitäten ab. Zeitraum optional (JJJJ-MM-TT), sonst die ganze bekannte Historie. */
export async function fetchSnapTradeSnapshot(creds: SnapCreds, deps: SnapDeps, range: { from?: string; to?: string } = {}): Promise<SnapSnapshot> {
  if (!/^\S+$/.test(creds.clientId.trim()) || !/^\S+$/.test(creds.consumerKey.trim())) {
    throw new Error("Bitte Client ID und Consumer Key aus dem SnapTrade-Dashboard (API Key) eintragen.");
  }
  const all = (await call(creds, deps, "/accounts/all")) as { results?: Array<Record<string, unknown>> };
  const accounts = (all.results ?? []).filter((a): a is Record<string, unknown> & { id: string } => a.kind === "investment" && typeof a.id === "string");
  const activities: Record<string, unknown[]> = {};
  for (const a of accounts) {
    const list: unknown[] = [];
    for (let offset = 0; ; ) {
      const params: Array<[string, string]> = [
        ...(range.from ? ([["startDate", range.from]] as Array<[string, string]>) : []),
        ...(range.to ? ([["endDate", range.to]] as Array<[string, string]>) : []),
        ["offset", String(offset)],
        ["limit", "1000"],
      ];
      const page = (await call(creds, deps, `/accounts/${encodeURIComponent(a.id)}/activities`, params)) as { data?: unknown[]; pagination?: { total?: number } };
      const data = page.data ?? [];
      list.push(...data);
      offset += data.length;
      if (data.length === 0 || offset >= (page.pagination?.total ?? offset)) break;
    }
    activities[a.id] = list;
  }
  return { source: "snaptrade", version: 1, fetchedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(), accounts, activities };
}
