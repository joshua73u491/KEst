import { describe, expect, test } from "vitest";
import { FLEX_BASE, FlexError, fetchFlexHistory, fetchFlexReport, flexWindows, parseFlexResponse, type HttpGet } from "../src/sync/ibkrFlexService.js";
import { handleRelay } from "../src/sync/relay.js";
import { ibkrXml, ibTrade } from "./helpers/ibkrXml.js";

/**
 * Automatischer Abruf der IBKR Flex Query über den Flex Web Service (offizielle Schnittstelle, Version 3):
 * SendRequest liefert einen ReferenceCode, GetStatement den Bericht. Quelle:
 * https://www.interactivebrokers.com/docs/web-api/flex-web-service/using-flex-web-service/generate-the-report,
 * Fehlercodes: https://www.interactivebrokers.com/docs/web-api/flex-web-service/error-codes
 */

const TOKEN = "123456789012345678901234";
const ok = (ref: string) => `<FlexStatementResponse timestamp='21 November, 2026 10:00 AM EST'>\n<Status>Success</Status>\n<ReferenceCode>${ref}</ReferenceCode>\n<url>https://example.invalid/ignore</url>\n</FlexStatementResponse>`;
const fail = (code: string, msg = "x", status = "Fail") => `<FlexStatementResponse timestamp='t'><Status>${status}</Status><ErrorCode>${code}</ErrorCode><ErrorMessage>${msg}</ErrorMessage></FlexStatementResponse>`;
const report = ibkrXml({ trades: [ibTrade("BUY", "20260302", "US0000000101", "10", "1000.00")] });

/** Spielt Antworten der Reihe nach ab und merkt sich Adressen und Zeitpunkte (virtuelle Uhr). */
function fake(responses: string[]) {
  let now = 0;
  const calls: Array<{ url: string; at: number }> = [];
  const get: HttpGet = async (url) => {
    calls.push({ url, at: now });
    const text = responses.shift();
    if (text === undefined) throw new Error("keine Antwort mehr");
    return { status: 200, text };
  };
  const sleep = async (ms: number) => {
    now += ms;
  };
  return { get, sleep, calls, now: () => now };
}

describe("Antworten des Flex Web Service", () => {
  test("Erfolg mit ReferenceCode, Fehler mit Code, Bericht ist keine Statusantwort", () => {
    expect(parseFlexResponse(ok("777"))).toEqual({ status: "Success", referenceCode: "777" });
    expect(parseFlexResponse(fail("1015", "Token is invalid."))).toEqual({ status: "Fail", errorCode: "1015", errorMessage: "Token is invalid." });
    expect(parseFlexResponse(report)).toBeNull();
  });
});

describe("Bericht abrufen", () => {
  test("SendRequest, dann GetStatement mit dem ReferenceCode; die URL aus der Antwort wird ignoriert", async () => {
    const f = fake([ok("777"), report]);
    const xml = await fetchFlexReport({ token: TOKEN, queryId: "800969" }, f);
    expect(xml).toBe(report);
    expect(f.calls.map((c) => c.url)).toEqual([
      `${FLEX_BASE}/SendRequest?t=${TOKEN}&q=800969&v=3`,
      `${FLEX_BASE}/GetStatement?t=${TOKEN}&q=777&v=3`,
    ]);
  });

  test("Zeitraum als fd/td im Format yyyyMMdd", async () => {
    const f = fake([ok("1"), report]);
    await fetchFlexReport({ token: TOKEN, queryId: "800969", fromDate: "2025-01-01", toDate: "2025-12-31" }, f);
    expect(f.calls[0]?.url).toBe(`${FLEX_BASE}/SendRequest?t=${TOKEN}&q=800969&v=3&fd=20250101&td=20251231`);
  });

  test("Bericht noch in Arbeit (1019): warten und erneut abrufen, höchstens ein Abruf je Sekunde", async () => {
    const f = fake([ok("777"), fail("1019", "Statement generation in progress.", "Warn"), fail("1019", "", "Warn"), report]);
    expect(await fetchFlexReport({ token: TOKEN, queryId: "1" }, f)).toBe(report);
    const at = f.calls.map((c) => c.at);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(1000);
  });

  test("dauerhafte Fehler mit deutscher Meldung, ohne das Token zu nennen", async () => {
    const f = fake([fail("1012", "Token has expired.")]);
    const err = await fetchFlexReport({ token: TOKEN, queryId: "1" }, f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlexError);
    expect((err as FlexError).code).toBe("1012");
    expect((err as Error).message).toMatch(/Token ist abgelaufen/);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  test("zu lange in Arbeit: Abbruch mit Hinweis statt endlos zu warten", async () => {
    const f = fake([ok("777"), ...Array.from({ length: 50 }, () => fail("1019", "", "Warn"))]);
    await expect(fetchFlexReport({ token: TOKEN, queryId: "1" }, { ...f, maxWaitMs: 30_000 })).rejects.toThrow(/noch nicht fertig/);
  });

  test("ungültiges Token oder ungültige Query-ID werden vor dem Abruf abgelehnt", async () => {
    const f = fake([]);
    await expect(fetchFlexReport({ token: "abc def", queryId: "1" }, f)).rejects.toThrow(/Token/);
    await expect(fetchFlexReport({ token: TOKEN, queryId: "12a" }, f)).rejects.toThrow(/Query-ID/);
    expect(f.calls).toEqual([]);
  });

  test("Antwort ist weder Status noch Flex Query: Fehler statt still weiterzurechnen", async () => {
    const f = fake([ok("777"), "<html>Wartung</html>"]);
    await expect(fetchFlexReport({ token: TOKEN, queryId: "1" }, f)).rejects.toThrow(/unerwartete Antwort/);
  });
});

describe("Ganze Historie: je Abruf höchstens 365 Tage", () => {
  test("Zeitfenster von höchstens 365 Tagen bis heute", () => {
    expect(flexWindows("2024-01-01", "2026-11-21")).toEqual([
      { from: "2024-01-01", to: "2024-12-30" },
      { from: "2024-12-31", to: "2025-12-30" },
      { from: "2025-12-31", to: "2026-11-21" },
    ]);
  });

  test("je Fenster ein Bericht; höchstens 10 Abrufe je Minute", async () => {
    const responses = Array.from({ length: 6 }, (_, i) => [ok(String(i)), report]).flat();
    const f = fake(responses);
    const parts = await fetchFlexHistory({ token: TOKEN, queryId: "1", from: "2021-01-01", to: "2026-11-21" }, f);
    expect(parts).toHaveLength(6);
    expect(parts[0]).toMatchObject({ from: "2021-01-01", xml: report });
    // in keinem Zeitraum von 60 Sekunden mehr als 10 Abrufe
    const at = f.calls.map((c) => c.at);
    for (let i = 10; i < at.length; i++) expect(at[i]! - at[i - 10]!).toBeGreaterThanOrEqual(60_000);
  });
});

describe("Relay für die Web-App (IBKR erlaubt keine Abrufe aus Webseiten)", () => {
  const allowed = ["https://app.example"];
  const post = (body: unknown, origin = "https://app.example") =>
    new Request("https://relay.example/ibkr-flex", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

  test("leitet den Abruf weiter und gibt die Flex Query mit CORS-Header zurück", async () => {
    const f = fake([ok("9"), report]);
    const res = await handleRelay(post({ token: TOKEN, queryId: "1", from: "2026-01-01", to: "2026-11-21" }), { ...f, allowedOrigins: allowed });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe(report);
  });

  test("fremde Herkunft, falsche Methode oder kaputte Anfrage werden abgelehnt", async () => {
    const f = fake([]);
    expect((await handleRelay(post({ token: TOKEN, queryId: "1" }, "https://boese.example"), { ...f, allowedOrigins: allowed })).status).toBe(403);
    expect((await handleRelay(new Request("https://relay.example/ibkr-flex", { headers: { Origin: "https://app.example" } }), { ...f, allowedOrigins: allowed })).status).toBe(405);
    expect((await handleRelay(new Request("https://relay.example/ibkr-flex", { method: "POST", headers: { Origin: "https://app.example" }, body: "{" }), { ...f, allowedOrigins: allowed })).status).toBe(400);
    expect(f.calls).toEqual([]);
  });

  test("Vorabanfrage des Browsers (OPTIONS) wird für erlaubte Herkunft beantwortet", async () => {
    const res = await handleRelay(new Request("https://relay.example/ibkr-flex", { method: "OPTIONS", headers: { Origin: "https://app.example" } }), { ...fake([]), allowedOrigins: allowed });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST");
  });

  test("Fehler von IBKR kommen als deutsche Meldung mit Code zurück, ohne Token", async () => {
    const res = await handleRelay(post({ token: TOKEN, queryId: "1" }), { ...fake([fail("1015")]), allowedOrigins: allowed });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("1015");
    expect(body.message).toMatch(/Token ist ungültig/);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});
