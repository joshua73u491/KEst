import { describe, expect, test } from "vitest";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { fetchEcbRates, ratesNeeded } from "../src/web/loadRates.js";
import { parseIbkrFlexXml } from "../src/import/ibkrFlex.js";
import { ibCash, ibkrXml, ibTrade } from "./helpers/ibkrXml.js";
import { dividend, trade, trCsv } from "./helpers/trCsv.js";

const usd = (at: string) =>
  dividend(at, "US0000000001", "90.00", "-13.50", { original_amount: "100.00", original_currency: "USD", fx_rate: "0.9" });

describe("Web-App: welche EZB-Kurse gebraucht werden", () => {
  test("nur für Dividenden in Fremdwährung, Zeitraum vom ersten bis zum letzten Zufluss", () => {
    const data = parseTradeRepublicCsv(
      trCsv(
        usd("2026-03-02T00:00:00.000000Z"),
        dividend("2026-04-15T00:00:00.000000Z", "DE0000000001", "100.00", "-26.38"),
        usd("2026-09-01T00:00:00.000000Z"),
        trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000002", "1", "50.00", { original_amount: "-55.00", original_currency: "USD" }),
      ),
    );
    expect(ratesNeeded(data)).toEqual({ currencies: ["USD"], start: "2026-03-02", end: "2026-09-01" });
  });

  test("IBKR: auch Trades, Kommissionen und Zinsen in Fremdwährung brauchen EZB-Kurse", () => {
    const data = parseIbkrFlexXml(
      ibkrXml({
        trades: [
          ibTrade("BUY", "20260302", "US0000000101", "10", "1000"),
          ibTrade("BUY", "20260303", "DE0000000201", "1", "50", { currency: "EUR", ibCommissionCurrency: "CHF" }),
        ],
        cash: [ibCash("Broker Interest Received", "20261105;202000", "4.00", { currency: "JPY" })],
      }),
    );
    expect(ratesNeeded(data)).toEqual({ currencies: ["CHF", "JPY", "USD"], start: "2026-03-02", end: "2026-11-05" });
  });

  test("ohne Fremdwährungs-Dividenden wird nichts abgerufen", () => {
    const data = parseTradeRepublicCsv(trCsv(dividend("2026-04-15T00:00:00.000000Z", "DE0000000001", "100.00")));
    expect(ratesNeeded(data)).toBeNull();
  });
});

describe("Web-App: EZB-Kurse abrufen", () => {
  const need = { currencies: ["USD"], start: "2026-03-02", end: "2026-09-01" };

  test("ruft die EZB-Datenschnittstelle ab und liest die Kurse", async () => {
    const urls: string[] = [];
    const fakeFetch = async (url: string) => {
      urls.push(url);
      return new Response("KEY,CURRENCY,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,USD,2026-03-02,1.25\n", { status: 200 });
    };
    const table = await fetchEcbRates(need, fakeFetch);
    expect(urls).toEqual([
      "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=2026-03-02&endPeriod=2026-09-01&format=csvdata",
    ]);
    expect(table.rate("USD", "2026-03-02")?.toString()).toBe("1.25");
  });

  test("Fehler beim Abruf wird zu einer deutschen Meldung", async () => {
    await expect(fetchEcbRates(need, async () => new Response("", { status: 503 }))).rejects.toThrow(
      /EZB-Kurse konnten nicht geladen werden \(HTTP 503\)/,
    );
    await expect(
      fetchEcbRates(need, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow(/EZB-Kurse konnten nicht geladen werden/);
  });
});
