import { FlexError, fetchFlexReport, type FlexOptions } from "./ibkrFlexService.js";

/**
 * Relay für den IBKR Flex Web Service: IBKR erlaubt keine Abrufe aus Webseiten (keine CORS-Header), deshalb leitet
 * dieser kleine, zustandslose Dienst den Abruf der Web-App weiter. Er speichert nichts, schreibt kein Protokoll mit
 * Token oder Inhalt und antwortet nur Seiten aus `allowedOrigins`. Läuft mit Standard-Request/Response, also in Node
 * (`npm run relay`), in Cloudflare Workers oder Deno. Wo er öffentlich läuft, entscheidet Joshua (das Token geht
 * dann über diesen Server).
 *
 * POST JSON { token, queryId, from?, to? } → 200 text/xml (Flex Query) oder JSON { code, message }.
 */

export interface RelayOptions extends FlexOptions {
  allowedOrigins: string[];
}

const MAX_BODY = 4096;

export async function handleRelay(req: Request, opts: RelayOptions): Promise<Response> {
  const origin = req.headers.get("Origin") ?? "";
  if (!opts.allowedOrigins.includes(origin)) return new Response("Herkunft nicht erlaubt", { status: 403 });
  const cors = {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" },
    });
  }
  const json = (status: number, body: { code: string; message: string }) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
  if (req.method !== "POST") return json(405, { code: "method", message: "Nur POST ist erlaubt." });

  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { code: "size", message: "Anfrage zu groß." });
  let body: { token?: unknown; queryId?: unknown; from?: unknown; to?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return json(400, { code: "json", message: "Die Anfrage ist kein gültiges JSON." });
  }
  if (typeof body.token !== "string" || typeof body.queryId !== "string") return json(400, { code: "fields", message: "Token und Query-ID fehlen." });
  const range = typeof body.from === "string" && typeof body.to === "string" ? { fromDate: body.from, toDate: body.to } : {};
  try {
    const xml = await fetchFlexReport({ token: body.token, queryId: body.queryId, ...range }, opts);
    return new Response(xml, { status: 200, headers: { ...cors, "Content-Type": "text/xml; charset=utf-8" } });
  } catch (e) {
    if (e instanceof FlexError) return json(e.code === "token" || e.code === "query" || e.code === "date" ? 400 : 502, { code: e.code, message: e.message });
    return json(502, { code: "network", message: "IBKR ist gerade nicht erreichbar. Bitte später erneut versuchen." });
  }
}
