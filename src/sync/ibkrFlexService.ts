/**
 * Automatischer Abruf der Activity Flex Query über den IBKR Flex Web Service, Version 3 (offizielle Schnittstelle,
 * nur lesend). Ablauf laut IBKR (geprüft am 21.11.2026):
 * 1. GET {FLEX_BASE}/SendRequest?t={Token}&q={Query-ID}&v=3[&fd=yyyyMMdd&td=yyyyMMdd] → <ReferenceCode>
 *    (die <url> der Antwort ist laut IBKR zu ignorieren)
 * 2. GET {FLEX_BASE}/GetStatement?t={Token}&q={ReferenceCode}&v=3 → Bericht, solange er erzeugt wird Code 1019
 * Grenzen: 1 Abruf je Sekunde, 10 je Minute und Token; je Abruf höchstens 365 Tage.
 * Quellen: https://www.interactivebrokers.com/docs/web-api/flex-web-service/using-flex-web-service/generate-the-report,
 * https://www.interactivebrokers.com/docs/web-api/api-reference/send-request,
 * https://www.interactivebrokers.com/docs/web-api/flex-web-service/error-codes
 *
 * IBKR erlaubt keine Abrufe aus Webseiten (keine CORS-Header, geprüft am 21.11.2026). Im Browser läuft der Abruf
 * deshalb über ein Relay (`src/sync/relay.ts`), auf der Kommandozeile direkt.
 */

export const FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

export type HttpGet = (url: string) => Promise<{ status: number; text: string }>;

export interface FlexOptions {
  get: HttpGet;
  sleep: (ms: number) => Promise<void>;
  /** Uhr in Millisekunden (Tests: virtuelle Uhr) */
  now?: () => number;
  /** so lange wird auf einen Bericht gewartet, der noch erzeugt wird */
  maxWaitMs?: number;
}

export interface FlexRequest {
  token: string;
  queryId: string;
  /** JJJJ-MM-TT; ohne Angabe gilt der Zeitraum der Query im Client Portal */
  fromDate?: string;
  toDate?: string;
}

export interface FlexStatus {
  status: string;
  referenceCode?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Fehler des Flex Web Service mit IBKR-Code und deutscher Meldung (nie mit dem Token). */
export class FlexError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FlexError";
  }
}

const TOKEN_HELP = "Das Token steht im Client Portal unter Reporting → Flex Queries → Flex Web Service Configuration.";

/** Deutsche Meldungen zu den Fehlercodes laut IBKR. */
export const FLEX_ERRORS: Record<string, string> = {
  "1001": "Der Bericht kann gerade nicht erzeugt werden.",
  "1003": "Der Bericht ist nicht verfügbar.",
  "1004": "Der Bericht ist noch unvollständig.",
  "1005": "Die Abwicklungsdaten sind noch nicht bereit.",
  "1006": "Die FIFO-Daten sind noch nicht bereit.",
  "1007": "Die MTM-Daten sind noch nicht bereit.",
  "1008": "Die MTM- und FIFO-Daten sind noch nicht bereit.",
  "1009": "Der IBKR-Server ist stark ausgelastet.",
  "1010": "Diese Flex Query ist veraltet. Bitte eine Activity Flex Query anlegen.",
  "1011": "Das Konto für den Flex Web Service ist nicht aktiv.",
  "1012": `Das Token ist abgelaufen. Bitte ein neues erstellen. ${TOKEN_HELP}`,
  "1013": "IP-Beschränkung: Das Token erlaubt Abrufe nur von bestimmten IP-Adressen.",
  "1014": "Die Query-ID ist ungültig. Sie steht im Client Portal bei der Activity Flex Query.",
  "1015": `Das Token ist ungültig. ${TOKEN_HELP}`,
  "1016": "Das Konto ist ungültig.",
  "1017": "Der Referenzcode ist ungültig.",
  "1018": "Zu viele Abrufe: IBKR erlaubt einen je Sekunde und zehn je Minute.",
  "1019": "Der Bericht wird noch erzeugt.",
  "1020": "IBKR konnte die Anfrage nicht prüfen. Bitte Token und Query-ID kontrollieren.",
  "1021": "Der Bericht kann gerade nicht abgerufen werden.",
  "1025": "Zu viele fehlgeschlagene Versuche. Bitte später erneut versuchen.",
};

/** Codes, bei denen sich erneutes Abrufen nach einer Pause lohnt */
const RETRY = new Set(["1001", "1004", "1005", "1006", "1007", "1008", "1009", "1018", "1019", "1021"]);

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(xml)?.[1]?.trim();

/** Statusantwort des Flex Web Service; `null`, wenn der Text keine ist (z. B. der Bericht selbst). */
export function parseFlexResponse(xml: string): FlexStatus | null {
  if (!/<FlexStatementResponse[\s>]/i.test(xml)) return null;
  const status = tag(xml, "Status") ?? "";
  const out: FlexStatus = { status };
  const ref = tag(xml, "ReferenceCode");
  const code = tag(xml, "ErrorCode");
  const msg = tag(xml, "ErrorMessage");
  if (ref) out.referenceCode = ref;
  if (code) out.errorCode = code;
  if (msg) out.errorMessage = msg;
  return out;
}

const flexError = (code: string, ibkrMessage?: string) =>
  new FlexError(code, `IBKR-Fehler ${code}: ${FLEX_ERRORS[code] ?? ibkrMessage ?? "unbekannter Fehler"}`);

/** Hält die Grenzen von IBKR ein: mindestens 1 s zwischen Abrufen, höchstens 10 in 60 s. */
class Pacer {
  private times: number[] = [];
  constructor(private readonly opts: FlexOptions) {}
  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }
  async call(url: string) {
    const last = this.times[this.times.length - 1];
    if (last !== undefined && this.now() - last < 1100) await this.opts.sleep(1100 - (this.now() - last));
    if (this.times.length >= 10) {
      const tenthLast = this.times[this.times.length - 10]!;
      const wait = tenthLast + 61_000 - this.now();
      if (wait > 0) await this.opts.sleep(wait);
    }
    this.times.push(this.now());
    return this.opts.get(url);
  }
}

const compact = (iso: string) => iso.replace(/-/g, "");

function validate(req: FlexRequest) {
  if (!/^[A-Za-z0-9]{8,64}$/.test(req.token.trim())) throw new FlexError("token", `Das Token ist ungültig. ${TOKEN_HELP}`);
  if (!/^\d{1,12}$/.test(req.queryId.trim())) throw new FlexError("query", "Die Query-ID ist ungültig: Sie besteht nur aus Ziffern und steht im Client Portal bei der Activity Flex Query.");
  for (const d of [req.fromDate, req.toDate]) {
    if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new FlexError("date", `Das Datum „${d}“ ist ungültig. Erwartet wird JJJJ-MM-TT.`);
  }
  if ((req.fromDate === undefined) !== (req.toDate === undefined)) throw new FlexError("date", "Für einen Zeitraum braucht es Anfangs- und Enddatum.");
}

async function fetchWith(req: FlexRequest, opts: FlexOptions, pacer: Pacer): Promise<string> {
  validate(req);
  const t = encodeURIComponent(req.token.trim());
  const range = req.fromDate && req.toDate ? `&fd=${compact(req.fromDate)}&td=${compact(req.toDate)}` : "";
  const maxWait = opts.maxWaitMs ?? 120_000;
  let waited = 0;
  let pause = 2000;
  const backoff = async () => {
    if (waited + pause > maxWait) {
      throw new FlexError("timeout", `Der Bericht ist nach ${Math.round(maxWait / 1000)} Sekunden noch nicht fertig. Bitte später erneut abrufen.`);
    }
    await opts.sleep(pause);
    waited += pause;
    pause = Math.min(Math.round(pause * 1.5), 10_000);
  };

  // 1. Bericht anfordern
  let ref: string | undefined;
  while (!ref) {
    const res = await pacer.call(`${FLEX_BASE}/SendRequest?t=${t}&q=${encodeURIComponent(req.queryId.trim())}&v=3${range}`);
    const s = parseFlexResponse(res.text);
    if (!s) throw new FlexError("unexpected", "IBKR hat eine unerwartete Antwort geschickt (keine Statusmeldung). Bitte später erneut versuchen.");
    if (s.status === "Success" && s.referenceCode) ref = s.referenceCode;
    else if (s.errorCode && RETRY.has(s.errorCode)) await backoff();
    else throw flexError(s.errorCode ?? "unknown", s.errorMessage);
  }

  // 2. Bericht abholen, solange er erzeugt wird erneut versuchen
  for (;;) {
    const res = await pacer.call(`${FLEX_BASE}/GetStatement?t=${t}&q=${encodeURIComponent(ref)}&v=3`);
    const s = parseFlexResponse(res.text);
    if (!s) {
      if (/<FlexQueryResponse[\s>]/.test(res.text)) return res.text;
      throw new FlexError("unexpected", "IBKR hat eine unerwartete Antwort geschickt (keine Flex Query im XML-Format). Ist die Query auf das Format XML eingestellt?");
    }
    if (s.errorCode && RETRY.has(s.errorCode)) await backoff();
    else throw flexError(s.errorCode ?? "unknown", s.errorMessage);
  }
}

/** Ruft einen Bericht ab (ein Zeitraum). Wirft `FlexError` mit deutscher Meldung. */
export function fetchFlexReport(req: FlexRequest, opts: FlexOptions): Promise<string> {
  return fetchWith(req, opts, new Pacer(opts));
}

const DAY = 86_400_000;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Zeitfenster von höchstens 365 Tagen (Grenze je Abruf laut IBKR) vom Anfang bis zum Ende. */
export function flexWindows(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (let start = msOf(from); start <= msOf(to); start += 365 * DAY) {
    out.push({ from: isoOf(start), to: isoOf(Math.min(start + 364 * DAY, msOf(to))) });
  }
  return out;
}

/** Ruft die ganze Historie in Fenstern von höchstens 365 Tagen ab, unter Einhaltung der Grenzen von IBKR. */
export async function fetchFlexHistory(
  req: { token: string; queryId: string; from: string; to: string },
  opts: FlexOptions,
): Promise<Array<{ from: string; to: string; xml: string }>> {
  const pacer = new Pacer(opts);
  const out: Array<{ from: string; to: string; xml: string }> = [];
  for (const w of flexWindows(req.from, req.to)) {
    out.push({ ...w, xml: await fetchWith({ token: req.token, queryId: req.queryId, fromDate: w.from, toDate: w.to }, opts, pacer) });
  }
  return out;
}
