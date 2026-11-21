import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { RateTable } from "../src/fx.js";
import { addFile, combine, emptyHistory, filePeriods } from "../src/history.js";
import { isSnapTradeSnapshot, parseSnapTradeJson } from "../src/import/snaptrade.js";
import { parseExport } from "../src/import/readAny.js";
import { handleRelay } from "../src/sync/relay.js";
import { canonicalJson, fetchSnapTradeSnapshot, signRequest, SNAPTRADE_BASE, type SnapFetch } from "../src/sync/snaptrade.js";
import { computeYear } from "../src/yearReport.js";
import { ACCOUNT, activity, snapshot, symbol } from "./helpers/snaptrade.js";

/**
 * SnapTrade Personal (Entscheidung Joshua, 21.11.2026): Abruf mit der eigenen Client ID und dem Consumer Key des
 * Nutzers, signiert laut https://docs.snaptrade.com/docs/request-signatures. Die Daten kommen als Schnappschuss in die
 * Historie und werden wie ein Export ausgewertet.
 */

describe("Signatur der Anfragen", () => {
  test("kanonisches JSON wie im Beispiel der Doku", () => {
    const payload = { query: "clientId=YOUR_CLIENT_ID&timestamp=1715123456", path: "/symbols", content: { substring: "AAPL" } };
    expect(canonicalJson(payload)).toBe('{"content":{"substring":"AAPL"},"path":"/symbols","query":"clientId=YOUR_CLIENT_ID&timestamp=1715123456"}');
  });

  test("HMAC-SHA256 mit dem Consumer Key, Base64", async () => {
    const expected = createHmac("sha256", "KEY").update('{"content":null,"path":"/accounts/all","query":"clientId=C&timestamp=1"}').digest("base64");
    expect(await signRequest("KEY", "/accounts/all", "clientId=C&timestamp=1", null)).toBe(expected);
  });
});

describe("Abruf bei SnapTrade", () => {
  function fake(pages: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
    const calls: Array<{ url: string; signature: string }> = [];
    const waits: number[] = [];
    const fetchFn: SnapFetch = async (url, init) => {
      calls.push({ url, signature: init.headers.Signature ?? "" });
      const p = pages.shift();
      if (!p) throw new Error("keine Antwort");
      return { status: p.status, headers: { get: (n: string) => p.headers?.[n] ?? null }, text: async () => JSON.stringify(p.body) };
    };
    return { fetchFn, sleep: async (ms: number) => void waits.push(ms), now: () => 1_763_719_200_000, calls, waits };
  }
  const creds = { clientId: "PERSONAL-CLIENT", consumerKey: "geheim-123" };
  const acts = (n: number, from = 0) => Array.from({ length: n }, (_, i) => activity("FEE", "2026-01-02", { id: `a${from + i}` }));

  test("Konten, dann Aktivitäten je Anlagekonto, seitenweise; jede Anfrage signiert, der Key steht nie in der Adresse", async () => {
    const f = fake([
      { status: 200, body: { results: [ACCOUNT, { kind: "deposit", id: "dep-1" }] } },
      { status: 200, body: { data: acts(1000), pagination: { offset: 0, limit: 1000, total: 1500 } } },
      { status: 200, body: { data: acts(500, 1000), pagination: { offset: 1000, limit: 1000, total: 1500 } } },
    ]);
    const snap = await fetchSnapTradeSnapshot(creds, f, { from: "2021-01-01", to: "2026-11-21" });
    expect(f.calls.map((c) => c.url)).toEqual([
      `${SNAPTRADE_BASE}/accounts/all?clientId=PERSONAL-CLIENT&timestamp=1763719200`,
      `${SNAPTRADE_BASE}/accounts/${ACCOUNT.id}/activities?clientId=PERSONAL-CLIENT&timestamp=1763719200&startDate=2021-01-01&endDate=2026-11-21&offset=0&limit=1000`,
      `${SNAPTRADE_BASE}/accounts/${ACCOUNT.id}/activities?clientId=PERSONAL-CLIENT&timestamp=1763719200&startDate=2021-01-01&endDate=2026-11-21&offset=1000&limit=1000`,
    ]);
    expect(f.calls[0]?.signature).toBe(await signRequest("geheim-123", "/accounts/all", "clientId=PERSONAL-CLIENT&timestamp=1763719200", null));
    for (const c of f.calls) expect(c.url).not.toContain("geheim");
    expect(snap.accounts.map((a) => a.id)).toEqual([ACCOUNT.id]);
    expect(snap.activities[ACCOUNT.id]).toHaveLength(1500);
    expect(snap.source).toBe("snaptrade");
  });

  test("falsche Schlüssel: deutsche Meldung, ohne den Consumer Key", async () => {
    const f = fake([{ status: 401, body: { detail: "Invalid signature" } }]);
    const err = (await fetchSnapTradeSnapshot(creds, f).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/Client ID oder Consumer Key/);
    expect(err.message).not.toContain("geheim");
  });

  test("zu viele Anfragen (429): warten laut Retry-After, dann erneut", async () => {
    const f = fake([
      { status: 429, body: {}, headers: { "Retry-After": "3" } },
      { status: 200, body: { results: [] } },
    ]);
    const snap = await fetchSnapTradeSnapshot(creds, f);
    expect(f.waits).toEqual([3000]);
    expect(snap.accounts).toEqual([]);
  });

  test("ohne Schlüssel wird nichts abgerufen", async () => {
    const f = fake([]);
    await expect(fetchSnapTradeSnapshot({ clientId: "", consumerKey: "" }, f)).rejects.toThrow(/Client ID/);
    expect(f.calls).toEqual([]);
  });
});

describe("Auswertung der SnapTrade-Daten", () => {
  const erf = symbol({ id: "s1", ticker: "ERF", figi: "BBG000000001", share: "BBG001S00001" });
  const buy = activity("BUY", "2026-01-15", { symbol: erf, units: 10, price: 100, amount: -1002, fee: 2, description: "Kauf ERFUNDEN AG (DE0000000301)" });
  const sell = activity("SELL", "2026-03-02", { symbol: erf, units: -4, price: 130, amount: 518, fee: 2, description: "Verkauf ERFUNDEN AG" });

  test("als SnapTrade-Schnappschuss erkannt", () => {
    expect(isSnapTradeSnapshot(snapshot([]))).toBe(true);
    expect(isSnapTradeSnapshot('{"foo":1}')).toBe(false);
    expect(parseExport(snapshot([buy])).broker).toBe("SnapTrade");
  });

  test("Kauf und Verkauf: ISIN aus der Beschreibung gilt für alle Buchungen desselben Wertpapiers", () => {
    // Kauf 10 zu 100 € (Ø 100 €), Verkauf 4 zu 130 € = 520 € -> Gewinn 120 €; Spesen 2 × 2 € nicht abziehbar
    const data = parseSnapTradeJson(snapshot([sell, buy]));
    expect(data.trades.map((t) => [t.side, t.isin, t.quantity, t.amountEur, t.feeEur, t.depot])).toEqual([
      ["buy", "DE0000000301", "10", "1000", "2", "SnapTrade DEGIRO Depot ****1234"],
      ["sell", "DE0000000301", "4", "520", "2", "SnapTrade DEGIRO Depot ****1234"],
    ]);
    expect(computeYear(data, 2026).kz994.toString()).toBe("120");
  });

  test("ohne ISIN: Kennung über die FIGI-Klasse, gerechnet wird trotzdem", () => {
    const noIsin = { ...buy, description: "Kauf ERFUNDEN AG" };
    const data = parseSnapTradeJson(snapshot([noIsin, sell]));
    expect(data.trades[0]?.isin).toBe("FIGI BBG001S00001");
    expect(computeYear(data, 2026).kz994.toString()).toBe("120");
  });

  test("Fremdwährung ohne Umtausch: EZB-Kurs am Handelstag (wie bei IBKR)", () => {
    const usd = symbol({ id: "s2", ticker: "ERFU", description: "ERFUNDEN INC" });
    const data = parseSnapTradeJson(
      snapshot([
        activity("BUY", "2026-03-02", { symbol: usd, units: 10, price: 100, amount: -1000, currency: { code: "USD" }, description: "ERFUNDEN INC (US0000000301)" }),
        activity("SELL", "2026-06-01", { symbol: usd, units: -4, price: 130, amount: 520, currency: { code: "USD" } }),
      ]),
    );
    expect(data.trades[0]?.convert).toMatchObject({ currency: "USD", amount: "1000" });
    const rates = new RateTable([
      ["USD", "2026-03-02", "1.25"],
      ["USD", "2026-06-01", "1.30"],
    ]);
    // 1.000 USD / 1,25 = 800 € (Ø 80 €); 520 USD / 1,30 = 400 € -> Gewinn 400 − 320 = 80 €
    expect(computeYear(data, 2026, { rates }).kz994.toString()).toBe("80");
  });

  test("Dividende mit Quellensteuer (TAX am selben Tag) wird zusammengeführt", () => {
    const us = symbol({ id: "s3", ticker: "ERFD" });
    const data = parseSnapTradeJson(
      snapshot([
        activity("DIVIDEND", "2026-04-15", { symbol: us, amount: 10, currency: { code: "USD" }, description: "Dividende ERFUNDEN (US0000000301)" }),
        activity("TAX", "2026-04-15", { symbol: us, amount: -1.5, currency: { code: "USD" }, description: "Quellensteuer" }),
      ]),
    );
    expect(data.dividends).toEqual([
      expect.objectContaining({ isin: "US0000000301", date: "2026-04-15", kind: "stock", originalCurrency: "USD", originalAmount: "10", withheldOriginal: "1.5" }),
    ]);
    const r = computeYear(data, 2026, { rates: new RateTable([["USD", "2026-04-15", "1.20"]]) });
    // 10 USD / 1,20 = 8,333… €; 1,50 USD / 1,20 = 1,25 € anrechenbar (DBA USA 15 %)
    expect(r.kz863.toDecimalPlaces(4).toString()).toBe("8.3333");
    expect(r.kz998.toString()).toBe("1.25");
  });

  test("Dividende ohne ISIN: Quellenstaat unbekannt, nicht berechnet; ETF-Ausschüttung als Fondsausschüttung", () => {
    const noIsin = symbol({ id: "s4", ticker: "NOID" });
    const etf = symbol({ id: "s5", ticker: "ETF1", typeCode: "et" });
    const data = parseSnapTradeJson(
      snapshot([
        activity("DIVIDEND", "2026-05-02", { symbol: noIsin, amount: 5 }),
        activity("DIVIDEND", "2026-05-03", { symbol: etf, amount: 3, description: "Ausschüttung (IE0000000301)" }),
      ]),
    );
    expect(data.dividends.map((d) => d.kind)).toEqual(["stock", "fund"]);
    const reasons = computeYear(data, 2026).notComputed.map((n) => n.reason).join(" ");
    expect(reasons).toMatch(/keine gültige ISIN/);
    expect(reasons).toMatch(/§ 186 InvFG/);
  });

  test("Zinsen: bei DEGIRO wie Zinsen aus Geldeinlagen, sonst Broker-Zinsen laut Einstellung", () => {
    const data = parseSnapTradeJson(
      snapshot([
        activity("INTEREST", "2026-07-01", { amount: 4 }),
        activity("INTEREST", "2026-07-02", { amount: 2, institution: "Interactive Brokers" }),
        activity("INTEREST", "2026-07-03", { amount: -1 }),
      ]),
    );
    expect(data.interest.map((i) => [i.date, i.source, i.amountEur])).toEqual([
      ["2026-07-01", "bank", "4"],
      ["2026-07-02", "broker", "2"],
    ]);
  });

  test("Split, Übertrag und Optionen: gemeldet, spätere Verkäufe derselben Position nicht gerechnet", () => {
    const data = parseSnapTradeJson(
      snapshot([
        buy,
        activity("SPLIT", "2026-02-01", { symbol: erf, units: 10 }),
        sell,
        activity("BUY", "2026-02-05", { option_symbol: { ticker: "ERF 261218C00100000" }, units: 1, price: 2, amount: -200 }),
      ]),
    );
    expect(data.unsupported.map((u) => u.type)).toEqual(["SnapTrade/SPLIT", "SnapTrade/BUY"]);
    expect(data.unsupported[0]?.affects).toMatchObject({ isin: "DE0000000301", depot: "SnapTrade DEGIRO Depot ****1234" });
    expect(computeYear(data, 2026).realized).toEqual([]);
  });

  test("Ein- und Auszahlungen und Gebühren ohne Wertpapier sind für die KESt ohne Bedeutung; Steuer ohne Dividende wird gemeldet", () => {
    const data = parseSnapTradeJson(
      snapshot([
        activity("CONTRIBUTION", "2026-01-02", { amount: 5000 }),
        activity("WITHDRAWAL", "2026-01-03", { amount: -100 }),
        activity("FEE", "2026-01-04", { amount: -2.5 }),
        activity("TAX", "2026-04-20", { symbol: erf, amount: -1 }),
      ]),
    );
    expect(data.trades).toEqual([]);
    expect(data.unsupported.map((u) => u.reason)).toEqual([expect.stringMatching(/Steuerbuchung .* ohne Dividende/)]);
  });
});

describe("Schnappschüsse in der Historie", () => {
  const erf = symbol({ id: "s1", ticker: "ERF" });
  const buy = { ...activity("BUY", "2026-01-15", { symbol: erf, units: 10, price: 100, description: "(DE0000000301)" }), id: "b1" };
  const sell = { ...activity("SELL", "2026-03-02", { symbol: erf, units: -4, price: 130 }), id: "s1" };

  test("mehrere Abrufe: jede Aktivität zählt einmal (über die ID)", () => {
    let h = emptyHistory();
    h = addFile(h, "SnapTrade 2026-11-20.json", snapshot([buy], "2026-11-20T10:00:00Z"), "2026-11-20T10:00:00Z", "a").history;
    h = addFile(h, "SnapTrade 2026-11-21.json", snapshot([buy, sell]), "2026-11-21T10:00:00Z", "b").history;
    const c = combine(h);
    expect(c.data.trades).toHaveLength(2);
    expect(c.duplicates).toBe(1);
    expect(filePeriods(h).map((p) => [p.depot, p.from, p.to])).toEqual([
      ["SnapTrade DEGIRO Depot ****1234", "2026-01-15", "2026-01-15"],
      ["SnapTrade DEGIRO Depot ****1234", "2026-01-15", "2026-03-02"],
    ]);
  });
});

describe("Relay: Weg für SnapTrade (der Header Signature ist für Webseiten nicht freigegeben)", () => {
  test("holt den Schnappschuss mit den Schlüsseln des Nutzers und gibt JSON zurück", async () => {
    const pages = [{ results: [ACCOUNT] }, { data: [], pagination: { offset: 0, limit: 1000, total: 0 } }];
    const snapFetch: SnapFetch = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify(pages.shift()) });
    const req = new Request("http://localhost:8787/snaptrade", {
      method: "POST",
      headers: { Origin: "https://app.example", "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "C", consumerKey: "K" }),
    });
    const res = await handleRelay(req, { get: async () => ({ status: 500, text: "" }), sleep: async () => undefined, allowedOrigins: ["https://app.example"], snapFetch });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(isSnapTradeSnapshot(await res.text())).toBe(true);
  });
});
