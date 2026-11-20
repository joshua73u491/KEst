import { describe, expect, test } from "vitest";
import { isIbkrFlexXml, parseIbkrFlexXml } from "../src/import/ibkrFlex.js";
import { ibCash, ibkrXml, ibPosition, ibTrade } from "./helpers/ibkrXml.js";

const DEPOT = "IBKR U0000000";
/** Zeile der i-ten Cash-Buchung, wenn `trades` Zeilen im Abschnitt Trades stehen (siehe helpers/ibkrXml.ts). */
const cashLine = (trades: number, i: number) => 5 + trades + 2 + i;

describe("IBKR-Flex-Query: Datei erkennen und prüfen", () => {
  test("Flex-XML wird erkannt, ein Trade-Republic-CSV nicht", () => {
    expect(isIbkrFlexXml(ibkrXml())).toBe(true);
    expect(isIbkrFlexXml('﻿<?xml version="1.0"?>\n<FlexQueryResponse>')).toBe(true);
    expect(isIbkrFlexXml('"datetime","date"\n')).toBe(false);
  });

  test("fehlender Abschnitt wird konkret auf Deutsch gemeldet", () => {
    expect(() => parseIbkrFlexXml(ibkrXml({ cash: null }))).toThrow(/Abschnitt CashTransactions fehlt/);
    expect(() => parseIbkrFlexXml(ibkrXml({ cash: null, positions: null }))).toThrow(/Abschnitte CashTransactions, OpenPositions fehlen/);
  });

  test("fehlende Felder im Abschnitt Trades werden genannt", () => {
    const t = ibTrade("BUY", "20260302", "US0000000101", "10", "1000");
    delete t.isin;
    expect(() => parseIbkrFlexXml(ibkrXml({ trades: [t] }))).toThrow(/Im Abschnitt Trades fehlen Felder: isin/);
  });

  test("nur Zusammenfassungen statt Einzelausführungen: Detailstufe wird verlangt", () => {
    const t = ibTrade("BUY", "20260302", "US0000000101", "10", "1000", { levelOfDetail: "ORDER" });
    expect(() => parseIbkrFlexXml(ibkrXml({ trades: [t] }))).toThrow(/Detailstufe „Executions“/);
  });

  test("Fehlerantwort statt Kontoauszug und fremde Dateien werden abgelehnt", () => {
    expect(() => parseIbkrFlexXml("<FlexStatementResponse><Status>Fail</Status></FlexStatementResponse>")).toThrow(/keine IBKR-Flex-Query/);
    expect(() => parseIbkrFlexXml('<FlexQueryResponse><FlexStatements count="0"></FlexStatements></FlexQueryResponse>')).toThrow(/keinen Kontoauszug/);
  });

  test("Datumsformat außer JJJJMMTT und JJJJ-MM-TT wird mit Hinweis abgelehnt", () => {
    const t = ibTrade("BUY", "03/02/2026", "US0000000101", "10", "1000", { tradeTime: "" });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [t] }));
    expect(r.trades).toEqual([]);
    expect(r.unsupported[0]?.reason).toMatch(/Datum „03\/02\/2026“.*yyyyMMdd/);
  });
});

describe("IBKR-Flex-Query: Trades", () => {
  test("Kauf in USD: Betrag ohne Kommission, Umrechnung zum EZB-Kurs erst in der Auswertung", () => {
    const r = parseIbkrFlexXml(ibkrXml({ trades: [ibTrade("BUY", "20260302", "US0000000101", "10", "1000.00")] }));
    expect(r.trades).toEqual([
      {
        line: 5,
        isin: "US0000000101",
        depot: DEPOT,
        date: "2026-03-02",
        datetime: "2026-03-02T15:30:00",
        side: "buy",
        quantity: "10",
        amountEur: "",
        feeEur: "",
        withheldEur: "0",
        originalCurrency: "USD",
        convert: { currency: "USD", amount: "1000", fees: [{ currency: "USD", amount: "1" }] },
        kind: "security",
        name: "ERFUNDEN US0000000101",
        symbol: "SYM101",
        price: "0",
        transactionType: "ExchTrade",
      },
    ]);
    expect(r.unsupported).toEqual([]);
  });

  test("Verkauf in EUR: negative Stückzahl wird zur Verkaufsmenge, Betrag direkt in EUR", () => {
    const t = ibTrade("SELL", "20260910", "DE0000000201", "5", "450.00", { currency: "EUR", ibCommission: "-1.25", ibCommissionCurrency: "EUR" });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [t] }));
    expect(r.trades[0]).toMatchObject({ side: "sell", quantity: "5", amountEur: "450", feeEur: "1.25", originalCurrency: "" });
    expect(r.trades[0]?.convert).toBeUndefined();
  });

  test("Zusammenfassungen (ORDER, SYMBOL_SUMMARY) werden neben den Ausführungen nicht doppelt gezählt", () => {
    const exec = ibTrade("BUY", "20260302", "US0000000101", "10", "1000");
    const r = parseIbkrFlexXml(ibkrXml({ trades: [exec, { ...exec, levelOfDetail: "ORDER" }, { ...exec, levelOfDetail: "SYMBOL_SUMMARY" }] }));
    expect(r.trades).toHaveLength(1);
  });

  test("ETF: Hinweis auf ausschüttungsgleiche Erträge, einmal je ISIN", () => {
    const etf = { subCategory: "ETF", currency: "EUR", ibCommissionCurrency: "EUR" };
    const r = parseIbkrFlexXml(
      ibkrXml({ trades: [ibTrade("BUY", "20260315", "IE0000000301", "10", "300", etf), ibTrade("BUY", "20260316", "IE0000000301", "1", "30", etf)] }),
    );
    expect(r.trades).toHaveLength(2);
    expect(r.unsupported).toEqual([
      { line: 5, type: "Trade/STK", reason: "Fonds/ETF IE0000000301: ausschüttungsgleiche Erträge (KZ 937) und Meldefonds-Status werden noch nicht berechnet" },
    ]);
  });

  test("Optionen und Futures werden als nicht verbriefte Derivate mit Kontraktdaten eingelesen", () => {
    const opt = ibTrade("BUY", "20260402", "", "1", "250", {
      assetCategory: "OPT",
      symbol: "XYZ 260619C00100000",
      conid: "123",
      underlyingSymbol: "XYZ",
      underlyingConid: "456",
      putCall: "C",
      strike: "100",
      expiry: "20260619",
      multiplier: "100",
      tradePrice: "2.5",
      openCloseIndicator: "O",
    });
    const fut = ibTrade("SELL", "20260403", "", "1", "5000", { assetCategory: "FUT", symbol: "ESM6", conid: "789", putCall: "", strike: "", expiry: "20260619", multiplier: "50", underlyingSymbol: "ES" });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [opt, fut] }));
    expect(r.unsupported).toEqual([]);
    expect(r.trades[0]).toMatchObject({
      kind: "derivative",
      isin: "",
      side: "buy",
      quantity: "1",
      openClose: "O",
      price: "2.5",
      derivative: { contract: "123", type: "option", underlying: "XYZ", underlyingConid: "456", putCall: "C", strike: "100", expiry: "2026-06-19", multiplier: "100" },
    });
    expect(r.trades[1]).toMatchObject({ kind: "derivative", side: "sell", derivative: { contract: "789", type: "future", putCall: "", expiry: "2026-06-19" } });
  });

  test("Codes laut IBKR (Feld notes, durch Semikolon getrennt) werden mitgeführt", () => {
    const opt = ibTrade("BUY", "20260402", "", "1", "0", {
      assetCategory: "OPT", symbol: "X P", conid: "1", underlyingSymbol: "X", putCall: "P", strike: "50", expiry: "20260402", multiplier: "100", notes: "A;C",
    });
    expect(parseIbkrFlexXml(ibkrXml({ trades: [opt] })).trades[0]?.codes).toEqual(["A", "C"]);
  });

  test("Option ohne Kontraktdaten (z. B. Feld strike nicht in der Flex Query) wird gemeldet", () => {
    const opt = ibTrade("BUY", "20260402", "", "1", "250", { assetCategory: "OPT", symbol: "XYZ C", putCall: "C", expiry: "20260619", multiplier: "100" });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [opt] }));
    expect(r.trades).toEqual([]);
    expect(r.unsupported[0]?.reason).toMatch(/Kontraktdaten fehlen: strike, underlyingSymbol/);
  });

  test("CFDs werden noch nicht berechnet", () => {
    const cfd = ibTrade("BUY", "20260402", "", "10", "1000", { assetCategory: "CFD", symbol: "ERF.CFD" });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [cfd] }));
    expect(r.trades).toEqual([]);
    expect(r.unsupported[0]?.reason).toBe("CFD ERF.CFD: Differenzkontrakte werden noch nicht berechnet.");
  });

  test("Devisentausch wird als nicht berechnet gemeldet", () => {
    const fx = ibTrade("BUY", "20260301", "", "1000", "1100", { assetCategory: "CASH", symbol: "EUR.USD" });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [fx] }));
    expect(r.trades).toEqual([]);
    expect(r.unsupported[0]?.reason).toBe("Devisentausch EUR.USD: Gewinne und Verluste aus Fremdwährung werden noch nicht berechnet.");
  });

  test("nicht zugeordnete Anlageklasse macht spätere Verkäufe derselben ISIN unsicher", () => {
    const war = ibTrade("BUY", "20260301", "DE000XX00001", "10", "100", { assetCategory: "WAR" });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [war] }));
    expect(r.unsupported).toEqual([
      {
        line: 5,
        type: "Trade/WAR",
        reason: "Anlageklasse WAR wird noch nicht zugeordnet",
        affects: { isin: "DE000XX00001", depot: DEPOT, datetime: "2026-03-01T15:30:00" },
      },
    ]);
  });

  test("Stornierte Ausführung (TradeCancel) hebt die ursprüngliche auf", () => {
    const exec = ibTrade("BUY", "20260302", "US0000000101", "10", "1000", { transactionID: "111" });
    const cancel = ibTrade("SELL", "20260302", "US0000000101", "10", "1000", {
      buySell: "BUY (Ca.)",
      transactionType: "TradeCancel",
      transactionID: "112",
      origTransactionID: "111",
    });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [exec, cancel] }));
    expect(r.trades).toEqual([]);
    expect(r.unsupported).toEqual([]);
  });

  test("Storno ohne passende Ausführung wird gemeldet", () => {
    const cancel = ibTrade("SELL", "20260302", "US0000000101", "10", "1000", { buySell: "BUY (Ca.)", transactionType: "TradeCancel", origTransactionID: "999" });
    const r = parseIbkrFlexXml(ibkrXml({ trades: [cancel] }));
    expect(r.unsupported[0]).toMatchObject({ line: 5, reason: expect.stringMatching(/Storno einer Ausführung ohne passende ursprüngliche Ausführung/) });
    expect(r.unsupported[0]?.affects).toMatchObject({ isin: "US0000000101" });
  });
});

describe("IBKR-Flex-Query: CashTransactions", () => {
  const div = (dateTime: string, amount: string, extra = {}) =>
    ibCash("Dividends", dateTime, amount, { isin: "US0000000101", symbol: "SYM101", ...extra });
  const wht = (dateTime: string, amount: string, extra = {}) =>
    ibCash("Withholding Tax", dateTime, amount, { isin: "US0000000101", symbol: "SYM101", ...extra });

  test("Dividende und Quellensteuer desselben Zahltags werden zusammengeführt, Korrekturen verrechnet", () => {
    const r = parseIbkrFlexXml(
      ibkrXml({
        cash: [
          div("20260415;202000", "10.00"),
          wht("20260415;202000", "-1.50"),
          wht("20260415;202000", "1.50", { reportDate: "20260520" }),
          wht("20260415;202000", "-1.50", { reportDate: "20260520" }),
        ],
      }),
    );
    expect(r.dividends).toEqual([
      {
        line: cashLine(0, 0),
        isin: "US0000000101",
        depot: DEPOT,
        date: "2026-04-15",
        datetime: "2026-04-15T20:20:00",
        name: "SYM101",
        kind: "stock",
        grossEur: "",
        withheldEur: "",
        originalCurrency: "USD",
        originalAmount: "10",
        withheldOriginal: "1.5",
        brokerFxRate: "",
      },
    ]);
    expect(r.unsupported).toEqual([]);
  });

  test("Dividende in EUR: Beträge direkt in EUR", () => {
    const r = parseIbkrFlexXml(
      ibkrXml({ cash: [div("20260420;202000", "20.00", { isin: "DE0000000201", currency: "EUR" }), wht("20260420;202000", "-5.28", { isin: "DE0000000201", currency: "EUR" })] }),
    );
    expect(r.dividends[0]).toMatchObject({ isin: "DE0000000201", grossEur: "20", withheldEur: "5.28", originalCurrency: "", withheldOriginal: "" });
  });

  test("Ausschüttung eines ETF wird als Fondsausschüttung erkannt", () => {
    const r = parseIbkrFlexXml(ibkrXml({ cash: [div("20260601;202000", "3.00", { isin: "IE0000000301", currency: "EUR", subCategory: "ETF" })] }));
    expect(r.dividends[0]?.kind).toBe("fund");
  });

  test("Zusammenfassungszeilen (SUMMARY) werden nicht doppelt gezählt", () => {
    const r = parseIbkrFlexXml(ibkrXml({ cash: [div("20260415;202000", "10.00"), div("20260415;202000", "10.00", { levelOfDetail: "SUMMARY" })] }));
    expect(r.dividends.map((d) => d.originalAmount)).toEqual(["10"]);
  });

  test("Quellensteuer ohne Dividende am selben Zahltag wird gemeldet", () => {
    const r = parseIbkrFlexXml(ibkrXml({ cash: [wht("20260416;202000", "-1.50")] }));
    expect(r.dividends).toEqual([]);
    expect(r.unsupported).toEqual([
      {
        line: cashLine(0, 0),
        type: "CashTransaction/Withholding Tax",
        reason: "Quellensteuer von US0000000101 am 2026-04-16 (-1.5 USD) ohne Dividende am selben Zahltag. Nicht berechnet, bitte prüfen.",
      },
    ]);
  });

  test("Dividende ohne ISIN wird gemeldet", () => {
    const r = parseIbkrFlexXml(ibkrXml({ cash: [div("20260415;202000", "10.00", { isin: "" })] }));
    expect(r.dividends).toEqual([]);
    expect(r.unsupported[0]?.reason).toMatch(/ISIN fehlt/);
  });

  test("Zinsen von IBKR: als Broker-Zinsen markiert, Fremdwährung wird später umgerechnet", () => {
    const r = parseIbkrFlexXml(
      ibkrXml({
        cash: [
          ibCash("Broker Interest Received", "20260805;202000", "4.00", { assetCategory: "", subCategory: "" }),
          ibCash("Broker Interest Received", "20260905;202000", "2.00", { currency: "EUR", assetCategory: "", subCategory: "" }),
        ],
      }),
    );
    expect(r.interest).toEqual([
      { line: cashLine(0, 0), date: "2026-08-05", depot: DEPOT, source: "broker", amountEur: "", withheldEur: "0", isin: "", convert: { currency: "USD", amount: "4" } },
      { line: cashLine(0, 1), date: "2026-09-05", depot: DEPOT, source: "broker", amountEur: "2", withheldEur: "0", isin: "" },
    ]);
  });

  test("Einzahlungen, Gebühren und Sollzinsen sind für die KESt ohne Bedeutung", () => {
    const r = parseIbkrFlexXml(
      ibkrXml({
        cash: [
          ibCash("Deposits/Withdrawals", "20260105", "1000", { currency: "EUR" }),
          ibCash("Other Fees", "20260131", "-10"),
          ibCash("Broker Interest Paid", "20260131", "-3"),
          ibCash("Commission Adjustments", "20260131", "0.5"),
        ],
      }),
    );
    expect(r.unsupported).toEqual([]);
    expect(r.interest).toEqual([]);
  });

  test("Ersatzzahlung, Anleihezinsen und Unbekanntes werden gemeldet", () => {
    const r = parseIbkrFlexXml(
      ibkrXml({
        cash: [
          ibCash("Payment In Lieu Of Dividends", "20260715", "2", { isin: "US0000000101" }),
          ibCash("Bond Interest Received", "20260716", "5", { isin: "US0000000777" }),
          ibCash("Something New", "20260717", "1"),
        ],
      }),
    );
    expect(r.unsupported.map((u) => u.reason)).toEqual([
      "Ersatzzahlung für eine Dividende (Payment In Lieu Of Dividends): wird noch nicht berechnet.",
      "Anleihezinsen (Bond Interest Received): werden noch nicht berechnet.",
      "Unbekannter Buchungstyp",
    ]);
  });
});

describe("IBKR-Flex-Query: OpenPositions", () => {
  test("gemeldete Bestände werden für den Abgleich mitgeführt, Optionen nicht", () => {
    const r = parseIbkrFlexXml(
      ibkrXml({ positions: [ibPosition("US0000000101", "6"), ibPosition("", "1", { assetCategory: "OPT" }), ibPosition("US0000000102", "2", { levelOfDetail: "LOT" })] }),
    );
    expect(r.reportedPositions).toEqual([{ line: 9, isin: "US0000000101", depot: DEPOT, quantity: "6", date: "2026-12-31" }]);
  });
});
