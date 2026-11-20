import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { RateTable } from "../src/fx.js";
import { parseIbkrFlexXml } from "../src/import/ibkrFlex.js";
import { ibCash, ibkrXml, ibPosition, ibTrade, type Sections } from "./helpers/ibkrXml.js";
import { computeYear } from "../src/yearReport.js";
import { dividend, interest, trade, trCsv, type TrRow } from "./helpers/trCsv.js";

const sample = readFileSync(new URL("./fixtures/tr-beispiel.csv", import.meta.url), "utf8");

describe("Jahresauswertung aus dem Trade-Republic-Beispiel", () => {
  const report = computeYear(parseTradeRepublicCsv(sample), 2026);

  test("Kauf aus dem Vorjahr zählt für die Anschaffungskosten, der Gewinn ins Verkaufsjahr", () => {
    // US0000000003: Kauf 2025 zu 50, Verkauf 2026 zu 60 -> +10 in 2026
    expect(report.kz994.toString()).toBe("10");
  });

  test("Kennzahlen je Topf", () => {
    expect(report.kz892.toString()).toBe("20"); // Beispiel AG: 200 -> 180
    expect(report.kz995.toString()).toBe("5"); // Optionsschein: 10 -> 15
    expect(report.kz896.toString()).toBe("3"); // Turbo: 8 -> 5
    expect(report.kz174.toString()).toBe("5"); // BTC: 0.0005 zu 50.000 € gekauft, für 30 € verkauft
    expect(report.kz176.toString()).toBe("0");
    expect(report.kz861.toString()).toBe("2");
  });

  test("Verluste gleichen Gewinne topfübergreifend aus: 10 − 20 + 5 − 3 + 5 = −3", () => {
    expect(report.taxableBaseEur.toString()).toBe("0");
    expect(report.unusedLossEur.toString()).toBe("3");
    expect(report.tax275Eur.toString()).toBe("0");
  });

  test("Bankzinsen werden mit 25 % besteuert und nicht mit Verlusten verrechnet", () => {
    expect(report.tax25Eur.toString()).toBe("0.5");
  });

  test("Spesen werden ausgewiesen, mindern aber im 27,5 %-Topf nicht die Steuer", () => {
    expect(report.feesEur.toString()).toBe("9"); // 9 Trades im Jahr 2026 zu je 1 €
  });

  test("Nicht Berechnetes wird aufgelistet", () => {
    expect(report.notComputed.map((n) => n.reason)).toEqual(["Unbekannter Buchungstyp"]);
  });

  test("Übertrag ins externe Wallet leert die Position ohne Gewinn", () => {
    expect(report.openPositions.find((p) => p.isin === "BTC")).toBeUndefined();
  });
});

describe("Jahresauswertung: Randfälle", () => {
  const year = (...rows: TrRow[]) => computeYear(parseTradeRepublicCsv(trCsv(...rows)), 2026);
  const T = "2026-03-02T10:00:00.000Z";

  test("Kauf und Verkauf mit identischem Zeitstempel: Kauf zuerst, auch wenn der Verkauf in der Datei vorne steht", () => {
    // Kauf 1 Stück zu 100, Verkauf 1 Stück zu 110 in derselben Sekunde -> +10
    const r = year(trade("SELL", T, "US0000000009", "1", "110.00"), trade("BUY", T, "US0000000009", "1", "100.00"));
    expect(r.notComputed).toEqual([]);
    expect(r.kz994.toString()).toBe("10");
  });

  test("Verkauf ohne bekannten Kauf (Kauf vor dem Exportzeitraum) wird als nicht berechnet gemeldet, der Rest wird gerechnet", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "1", "100.00"),
      trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000001", "1", "130.00"), // +30
      trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000002", "2", "50.00"), // Kauf fehlt
    );
    expect(r.kz994.toString()).toBe("30");
    expect(r.realized.map((x) => x.isin)).toEqual(["US0000000001"]);
    expect(r.notComputed).toHaveLength(1);
    expect(r.notComputed[0]).toMatchObject({ line: 4, type: "TRADING/SELL" });
    expect(r.notComputed[0]?.reason).toMatch(/übersteigt den bekannten Bestand von 0/);
    expect(r.notComputed[0]?.reason).toMatch(/vor dem Exportzeitraum/);
  });

  test("nach einem fehlenden Bestand werden spätere Verkäufe derselben ISIN nicht still gerechnet", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000002", "1", "40.00"),
      trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000002", "3", "120.00"), // 2 Stück fehlen
      trade("BUY", "2026-03-02T10:00:00.000Z", "US0000000002", "1", "45.00"),
      trade("SELL", "2026-04-02T10:00:00.000Z", "US0000000002", "1", "50.00"),
    );
    expect(r.realized).toEqual([]);
    expect(r.kz994.toString()).toBe("0");
    expect(r.notComputed.map((n) => n.line)).toEqual([3, 5]);
    expect(r.notComputed[1]?.reason).toMatch(/seit Zeile 3 unvollständig/);
    expect(r.openPositions.find((p) => p.isin === "US0000000002")).toBeUndefined();
  });

  test("Übertrag größer als Bestand wird als nicht berechnet gemeldet", () => {
    const crypto = { asset_class: "CRYPTO" };
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "BTC", "0.001", "50.00", crypto),
      {
        datetime: "2026-02-02T10:00:00.000Z",
        date: "2026-02-02",
        category: "DELIVERY",
        type: "FREE_DELIVERY",
        asset_class: "CRYPTO",
        symbol: "BTC",
        shares: "-0.002",
      },
    );
    expect(r.notComputed).toHaveLength(1);
    expect(r.notComputed[0]).toMatchObject({ line: 3, type: "DELIVERY/FREE_DELIVERY" });
    expect(r.notComputed[0]?.reason).toMatch(/Übertrag von 0.002 Stück BTC/);
  });

  test("sehr kleine Krypto-Bruchteile: exakter Durchschnittspreis ohne Rundungsrest", () => {
    // 0,000000123 BTC für 0,01 € + 0,000000877 BTC für 0,09 € = 0,000001 BTC für 0,10 € (Ø 100.000 €)
    // Verkauf 0,0000005 BTC für 0,07 €: Anschaffungskosten 0,05 €, Gewinn 0,02 €
    // Verkauf Rest 0,0000005 BTC für 0,04 €: Anschaffungskosten 0,05 €, Verlust 0,01 €
    const crypto = { asset_class: "CRYPTO" };
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "BTC", "0.000000123", "0.01", crypto),
      trade("BUY", "2026-01-03T10:00:00.000Z", "BTC", "0.000000877", "0.09", crypto),
      trade("SELL", "2026-01-04T10:00:00.000Z", "BTC", "0.0000005", "0.07", crypto),
      trade("SELL", "2026-01-05T10:00:00.000Z", "BTC", "0.0000005", "0.04", crypto),
    );
    expect(r.realized.map((x) => x.gainEur.toString())).toEqual(["0.02", "-0.01"]);
    expect(r.kz174.toString()).toBe("0.02");
    expect(r.kz176.toString()).toBe("0.01");
    expect(r.openPositions).toEqual([]);
  });

  test("übersprungene Buchung (z. B. Fremdwährung, Kapitalmaßnahme) macht spätere Verkäufe derselben ISIN unsicher", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000005", "1", "100.00"),
      trade("BUY", "2026-02-02T10:00:00.000Z", "US0000000005", "1", "200.00", { currency: "USD" }),
      { datetime: "2026-02-15T10:00:00.000Z", date: "2026-02-15", category: "CORPORATE_ACTION", type: "SPLIT", asset_class: "STOCK", symbol: "US0000000006", shares: "9" },
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000006", "1", "100.00"),
      trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000005", "1", "150.00"),
      trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000006", "1", "20.00"),
    );
    expect(r.realized).toEqual([]);
    expect(r.notComputed.map((n) => n.line)).toEqual([3, 4, 6, 7]);
    expect(r.notComputed[2]?.reason).toMatch(/US0000000005 ist seit Zeile 3 unvollständig/);
    expect(r.notComputed[3]?.reason).toMatch(/US0000000006 ist seit Zeile 4 unvollständig/);
  });

  test("Hinweise ohne Einfluss auf den Bestand (Fonds, Spalte tax) blockieren keine Verkäufe", () => {
    const fund = { asset_class: "ETF" };
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "IE0000000001", "2", "100.00", fund),
      trade("SELL", "2026-03-02T10:00:00.000Z", "IE0000000001", "1", "60.00", { ...fund, tax: "-1.00" }),
    );
    expect(r.realized.map((x) => x.gainEur.toString())).toEqual(["10"]);
  });

  test("Steuer in Spalte tax bei einem nicht steuereinfachen Konto wird nicht still übergangen", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000009", "1", "8.00"),
      trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000009", "1", "10.00", { tax: "-0.55" }),
    );
    expect(r.kz994.toString()).toBe("2");
    expect(r.notComputed).toEqual([
      {
        line: 3,
        type: "TRADING/SELL",
        reason:
          "Trade Republic hat 0,55 € Steuer einbehalten (Spalte tax). Bei einem Konto ohne KESt-Abzug wird sie nicht angerechnet. Ist dein Konto steuereinfach, gib an, seit wann.",
      },
    ]);
  });
});

describe("Jahresauswertung: Dividenden und Quellensteuer", () => {
  const year = (...rows: TrRow[]) => computeYear(parseTradeRepublicCsv(trCsv(...rows)), 2026);
  const T = "2026-04-15T00:00:00.000000Z";

  test("deutsche Dividende: KZ 863 brutto, Quellensteuer bis 15 % in KZ 998, 12,5 % Rest-KESt", () => {
    // DBA Österreich–Deutschland Art. 10 Abs. 2 lit. b: höchstens 15 % (RIS, Gesetzesnummer 20002157).
    // 100 € brutto, 26,38 € einbehalten -> anrechenbar 15 €, KESt 27,50 − 15 = 12,50 €.
    const r = year(dividend(T, "DE0000000001", "100.00", "-26.38"));
    expect(r.kz863.toString()).toBe("100");
    expect(r.kz998.toString()).toBe("15");
    expect(r.tax275Eur.toString()).toBe("12.5");
    expect(r.dividends).toEqual([
      expect.objectContaining({ line: 2, isin: "DE0000000001", country: "DE" }),
    ]);
    expect(r.dividends[0]?.creditableEur.toString()).toBe("15");
    expect(r.dividends[0]?.treatySource).toMatch(/Gesetzesnummer=20002157/);
    expect(r.notComputed).toEqual([]);
  });

  test("finnische Dividende: DBA-Satz 10 % deckelt die Anrechnung", () => {
    // DBA Österreich–Finnland Art. 10 Abs. 2: höchstens 10 % (RIS, Gesetzesnummer 20001206).
    // 200 € brutto, 70 € (35 %) einbehalten -> anrechenbar 20 €, KESt 55 − 20 = 35 €.
    const r = year(dividend(T, "FI0000000001", "200.00", "-70.00"));
    expect(r.kz998.toString()).toBe("20");
    expect(r.tax275Eur.toString()).toBe("35");
  });

  test("Testfall 3: Kursverlust im selben Jahr senkt die anrechenbare Quellensteuer", () => {
    // 100 € Dividende (DE), 15 € einbehalten, 60 € Kursverlust -> 40 € steuerpflichtig.
    // Anrechenbar höchstens 27,5 % von 40 € = 11 € (Annahme laut README), Steuer 0 €.
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "1", "160.00"),
      trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000001", "1", "100.00"),
      dividend(T, "DE0000000001", "100.00", "-15.00"),
    );
    expect(r.kz892.toString()).toBe("60");
    expect(r.kz863.toString()).toBe("100");
    expect(r.kz998.toString()).toBe("11");
    expect(r.tax275Eur.toString()).toBe("0");
  });

  test("Land ohne hinterlegten DBA-Satz: Dividende zählt, Quellensteuer wird nicht angerechnet und gemeldet", () => {
    const r = year(dividend(T, "IE0000000009", "100.00", "-25.00"));
    expect(r.kz863.toString()).toBe("100");
    expect(r.kz998.toString()).toBe("0");
    expect(r.tax275Eur.toString()).toBe("27.5");
    expect(r.dividends[0]?.treatySource).toBeNull();
    expect(r.notComputed).toEqual([
      {
        line: 2,
        type: "CASH/DIVIDEND",
        reason:
          "Quellensteuer 25,00 € auf die Dividende von IE0000000009 wird nicht angerechnet: Der DBA-Satz für IE ist in der App noch nicht hinterlegt. Die Steuer fällt dadurch eher zu hoch aus.",
      },
    ]);
  });

  test("Land ohne hinterlegten DBA-Satz und ohne Quellensteuer: kein Hinweis", () => {
    const r = year(dividend(T, "GB0000000001", "50.00"));
    expect(r.kz863.toString()).toBe("50");
    expect(r.notComputed).toEqual([]);
  });

  test("Dividende in Fremdwährung ohne geladene EZB-Kurse wird nicht berechnet", () => {
    const r = year(dividend(T, "US0000000001", "29.58", "-4.44", { original_amount: "34.51", original_currency: "USD", fx_rate: "0.857265" }));
    expect(r.kz863.toString()).toBe("0");
    expect(r.kz998.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toBe(
      "Dividende von US0000000001 in USD: Die EZB-Referenzkurse sind nicht geladen. Nicht berechnet.",
    );
  });

  test("inländische Dividende (ISIN AT) wird nicht berechnet", () => {
    const r = year(dividend(T, "AT0000000001", "40.00", "-11.00"));
    expect(r.kz863.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toBe(
      "Inländische Dividende von AT0000000001: Die App rechnet bisher nur ausländische Kapitaleinkünfte. Nicht berechnet.",
    );
  });

  test("Dividende mit Steuergutschrift statt Abzug wird nicht berechnet", () => {
    const r = year(dividend(T, "DE0000000001", "40.00", "3.00"));
    expect(r.kz863.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toMatch(/Steuergutschrift/);
  });

  test("Fondsausschüttung wird nicht berechnet (steuerpflichtiger Anteil laut § 186 InvFG 2011)", () => {
    const r = year(dividend(T, "LU0000000001", "11.46", "", { type: "DISTRIBUTION", asset_class: "FUND" }));
    expect(r.kz863.toString()).toBe("0");
    expect(r.notComputed).toEqual([
      {
        line: 2,
        type: "CASH/DISTRIBUTION",
        reason:
          "Ausschüttung des Fonds/ETF LU0000000001: Steuerpflichtig ist bei Meldefonds der von der Meldestelle (OeKB) veröffentlichte Anteil, bei Nicht-Meldefonds die ganze Ausschüttung (§ 186 InvFG 2011). Nicht berechnet.",
      },
    ]);
  });

  test("Kapitalausschüttung wird nicht berechnet, spätere Verkäufe derselben Position auch nicht", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "NO0000000001", "10", "100.00"),
      dividend("2026-03-19T00:00:00.000000Z", "NO0000000001", "41.56", "-11.63", { type: "DIVIDEND_EQUIVALENT_PAYMENT" }),
      trade("SELL", "2026-05-02T10:00:00.000Z", "NO0000000001", "10", "120.00"),
    );
    expect(r.kz863.toString()).toBe("0");
    expect(r.realized).toEqual([]);
    expect(r.notComputed.map((n) => n.line)).toEqual([3, 4]);
    expect(r.notComputed[0]?.reason).toMatch(/Einlagenrückzahlung/);
    expect(r.notComputed[1]?.reason).toMatch(/NO0000000001 ist seit Zeile 3 unvollständig/);
  });

  test("Dividende aus einem anderen Jahr zählt nicht", () => {
    const r = year(dividend("2025-04-15T00:00:00.000000Z", "DE0000000001", "100.00", "-26.38"));
    expect(r.kz863.toString()).toBe("0");
    expect(r.dividends).toEqual([]);
  });

  test("Anleihezinsen (Zinsen mit ISIN) gehören nicht in KZ 861 und werden nicht berechnet", () => {
    const r = year(interest(T, "3.00", { symbol: "XS0000000001" }), interest(T, "2.00"));
    expect(r.kz861.toString()).toBe("2");
    expect(r.notComputed[0]?.reason).toBe(
      "Zinsen aus dem Wertpapier XS0000000001 (KZ 863) werden noch nicht berechnet.",
    );
  });

  test("Steuer auf Bankzinsen bei einem nicht steuereinfachen Konto wird gemeldet", () => {
    const r = year(interest(T, "2.00", { tax: "-0.50" }));
    expect(r.kz861.toString()).toBe("2");
    expect(r.notComputed[0]?.reason).toMatch(/0,50 € Steuer einbehalten/);
  });
});

describe("Jahresauswertung: Dividenden in Fremdwährung (EZB-Referenzkurs im Zuflusszeitpunkt)", () => {
  // EStR 2000 Rz 6201c: Einkünfte in Fremdwährung (zB Dividenden) mit dem EZB-Referenzkurs im Zuflusszeitpunkt bewerten.
  const rates = new RateTable([
    ["USD", "2026-04-15", "1.25"],
    ["USD", "2026-04-17", "1.20"],
  ]);
  const year = (...rows: TrRow[]) => computeYear(parseTradeRepublicCsv(trCsv(...rows)), 2026, { rates });
  // 100 USD brutto; Trade Republic rechnet mit 0,9 um: 90 € gutgeschrieben, 13,50 € (= 15 USD) einbehalten.
  const usd = (at: string, extra: TrRow = {}) =>
    dividend(at, "US0000000001", "90.00", "-13.50", { original_amount: "100.00", original_currency: "USD", fx_rate: "0.9", ...extra });

  test("US-Dividende: Brutto und Quellensteuer zum EZB-Kurs, DBA-Deckel 15 %", () => {
    // EZB 2026-04-15: 1 EUR = 1,25 USD. Brutto 100 / 1,25 = 80 €. Quellensteuer 13,50 / 0,9 = 15 USD -> 15 / 1,25 = 12 €.
    // DBA USA 15 % von 80 € = 12 € anrechenbar. KESt 27,5 % von 80 € = 22 € − 12 € = 10 €.
    const r = year(usd("2026-04-15T00:00:00.000000Z"));
    expect(r.kz863.toString()).toBe("80");
    expect(r.kz998.toString()).toBe("12");
    expect(r.tax275Eur.toString()).toBe("10");
    expect(r.dividends[0]).toMatchObject({ originalCurrency: "USD" });
    expect(r.dividends[0]?.ecbRate?.toString()).toBe("1.25");
    expect(r.dividends[0]?.withheldEur.toString()).toBe("12");
    expect(r.notComputed).toEqual([]);
  });

  test("an einem Tag ohne EZB-Kurs (Wochenende, Feiertag) wird nicht geschätzt", () => {
    const r = year(usd("2026-04-16T00:00:00.000000Z"));
    expect(r.kz863.toString()).toBe("0");
    expect(r.notComputed).toEqual([
      {
        line: 2,
        type: "CASH/DIVIDEND",
        reason:
          "Dividende von US0000000001: Für USD gibt es am 2026-04-16 keinen EZB-Referenzkurs (z. B. Wochenende oder Feiertag). " +
          "Eine offizielle Regel für diesen Fall ist nicht bekannt. Nicht berechnet.",
      },
    ]);
  });

  test("ohne Umrechnungskurs von Trade Republic lässt sich die Quellensteuer nicht in USD zurückrechnen", () => {
    const r = year(usd("2026-04-15T00:00:00.000000Z", { fx_rate: "" }));
    expect(r.kz863.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toMatch(/Umrechnungskurs von Trade Republic fehlt/);
  });

  test("ohne Quellensteuer genügt der Originalbetrag", () => {
    const r = year(usd("2026-04-17T00:00:00.000000Z", { tax: "", fx_rate: "" }));
    // 100 USD / 1,20 = 83,333… €
    expect(r.kz863.toDecimalPlaces(2).toString()).toBe("83.33");
    expect(r.kz998.toString()).toBe("0");
  });

  test("ohne Originalbetrag wird nicht geschätzt", () => {
    const r = year(usd("2026-04-15T00:00:00.000000Z", { original_amount: "" }));
    expect(r.kz863.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toMatch(/Originalbetrag in USD fehlt/);
  });

  test("ab „steuereinfach seit“ zählt der von Trade Republic gutgeschriebene Betrag, ohne EZB-Kurs", () => {
    const r = computeYear(parseTradeRepublicCsv(trCsv(usd("2026-04-16T00:00:00.000000Z"))), 2026, { taxSimpleSince: "2026-01-01" });
    expect(r.taxedByBroker[0]?.amountEur.toString()).toBe("90");
    expect(r.notComputed).toEqual([]);
  });

  test("Trade in Fremdwährung: Gewinn aus den tatsächlich umgerechneten EUR-Beträgen", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000002", "1", "50.00", { original_amount: "-55.00", original_currency: "USD", fx_rate: "0.909091" }),
      trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000002", "1", "60.00", { original_amount: "62.00", original_currency: "USD", fx_rate: "0.967742" }),
    );
    expect(r.kz994.toString()).toBe("10");
    expect(r.notComputed).toEqual([]);
  });
});

describe("Jahresauswertung: IBKR (Flex Query)", () => {
  // IBKR hält Fremdwährung ohne Umtausch: Kursgewinne zum EZB-Referenzkurs (EStR 2000 Rz 6201c, erster Punkt).
  const rates = new RateTable([
    ["USD", "2026-03-02", "1.25"],
    ["USD", "2026-06-01", "1.30"],
    ["USD", "2026-04-15", "1.20"],
    ["USD", "2026-08-05", "1.10"],
  ]);
  const run = (s: Sections, options = {}) => computeYear(parseIbkrFlexXml(ibkrXml(s)), 2026, { rates, ...options });
  const buy = ibTrade("BUY", "20260302", "US0000000101", "10", "1000.00");
  const sell = ibTrade("SELL", "20260601", "US0000000101", "4", "520.00");

  test("Kauf und Verkauf in USD zum EZB-Kurs am Handelstag, Kommission nicht abziehbar", () => {
    // Kauf 1.000 USD / 1,25 = 800 € für 10 Stück (Ø 80 €). Verkauf 4 Stück: 520 USD / 1,30 = 400 €,
    // Anschaffungskosten 4 × 80 = 320 €, Gewinn 80 €. Kommission je 1 USD: 0,80 € + 0,769… € = 1,57 €.
    const r = run({ trades: [buy, sell] });
    expect(r.kz994.toString()).toBe("80");
    expect(r.feesEur.toDecimalPlaces(2).toString()).toBe("1.57");
    expect(r.openPositions).toEqual([expect.objectContaining({ isin: "US0000000101", depot: "IBKR U0000000" })]);
    expect(r.openPositions[0]?.costEur.toString()).toBe("480");
    expect(r.notComputed).toEqual([]);
  });

  test("ohne EZB-Kurs am Handelstag: kein Schätzen, spätere Verkäufe derselben Position auch nicht", () => {
    const r = run({ trades: [ibTrade("BUY", "20260303", "US0000000101", "10", "1000.00"), sell] });
    expect(r.realized).toEqual([]);
    expect(r.notComputed.map((n) => n.line)).toEqual([5, 6]);
    expect(r.notComputed[0]?.reason).toBe(
      "Trade von US0000000101 in USD: Für USD gibt es am 2026-03-03 keinen EZB-Referenzkurs. Nicht berechnet.",
    );
    expect(r.notComputed[1]?.reason).toMatch(/seit Zeile 5 unvollständig/);
  });

  test("ohne geladene EZB-Kurse werden Trades in Fremdwährung nicht berechnet", () => {
    const r = computeYear(parseIbkrFlexXml(ibkrXml({ trades: [buy] })), 2026);
    expect(r.notComputed[0]?.reason).toBe("Trade von US0000000101 in USD: Die EZB-Referenzkurse sind nicht geladen. Nicht berechnet.");
  });

  test("US-Dividende mit Quellensteuer in USD: beides zum EZB-Kurs am Zahltag", () => {
    // 10 USD / 1,20 = 8,333… €; 1,50 USD / 1,20 = 1,25 €; DBA USA 15 % von 8,333… € = 1,25 € anrechenbar.
    const r = run({
      cash: [
        ibCash("Dividends", "20260415;202000", "10.00", { isin: "US0000000101", symbol: "SYM101" }),
        ibCash("Withholding Tax", "20260415;202000", "-1.50", { isin: "US0000000101", symbol: "SYM101" }),
      ],
    });
    expect(r.kz863.toDecimalPlaces(4).toString()).toBe("8.3333");
    expect(r.kz998.toString()).toBe("1.25");
    expect(r.dividends[0]?.ecbRate?.toString()).toBe("1.2");
  });

  test("Zinsen von IBKR: Standard KZ 863 (27,5 %), wahlweise KZ 861 (25 %)", () => {
    // 4 USD / 1,10 = 3,636… €
    const interest = { cash: [ibCash("Broker Interest Received", "20260805;202000", "4.00")] };
    const std = run(interest);
    expect(std.brokerInterestKz).toBe("863");
    expect(std.brokerInterestEur.toDecimalPlaces(2).toString()).toBe("3.64");
    expect(std.kz863.toDecimalPlaces(2).toString()).toBe("3.64");
    expect(std.kz861.toString()).toBe("0");
    const alt = run(interest, { brokerInterestKz: "861" });
    expect(alt.kz863.toString()).toBe("0");
    expect(alt.kz861.toDecimalPlaces(2).toString()).toBe("3.64");
  });

  test("Zinsen von IBKR in KZ 863 werden mit Verlusten ausgeglichen", () => {
    // EUR-Zinsen 10 €, Kursverlust 4 € -> 6 € steuerpflichtig, 1,65 € Steuer.
    const eur = { currency: "EUR", ibCommissionCurrency: "EUR" };
    const r = run({
      trades: [ibTrade("BUY", "20260302", "DE0000000201", "1", "50", eur), ibTrade("SELL", "20260303", "DE0000000201", "1", "46", eur)],
      cash: [ibCash("Broker Interest Received", "20260905;202000", "10.00", { currency: "EUR" })],
    });
    expect(r.taxableBaseEur.toString()).toBe("6");
    expect(r.tax275Eur.toString()).toBe("1.65");
  });

  test("Bestand laut IBKR weicht vom berechneten ab: Hinweis statt stiller Annahme", () => {
    const r = run({ trades: [buy, sell], positions: [ibPosition("US0000000101", "6"), ibPosition("US0000000999", "3")] });
    expect(r.notComputed).toEqual([
      {
        line: 12,
        type: "OpenPosition",
        reason:
          "Bestand von US0000000999 laut IBKR am 2026-12-31: 3 Stück, laut App: 0 Stück. Vermutlich fehlen Käufe vor dem Exportzeitraum; " +
          "Verkäufe dieser Position können falsch berechnet sein. Bitte den Export mit Zeitraum seit Kontoeröffnung verwenden.",
      },
    ]);
  });

  test("„steuereinfach seit“ gilt nur für Trade Republic, nicht für IBKR", () => {
    const r = run({ trades: [buy, sell] }, { taxSimpleSince: "2026-01-01" });
    expect(r.kz994.toString()).toBe("80");
    expect(r.taxedByBroker).toEqual([]);
  });

  test("Fondsausschüttung (ETF) wird wie bei Trade Republic nicht berechnet", () => {
    const r = run({ cash: [ibCash("Dividends", "20260601;202000", "3.00", { isin: "IE0000000301", currency: "EUR", subCategory: "ETF" })] });
    expect(r.kz863.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toMatch(/§ 186 InvFG 2011/);
  });
});

describe("Jahresauswertung: Trade Republic steuereinfach (KESt-Abzug durch den Broker)", () => {
  const SINCE = "2026-05-01";
  const year = (...rows: TrRow[]) =>
    computeYear(parseTradeRepublicCsv(trCsv(...rows)), 2026, { taxSimpleSince: SINCE });

  test("Verkauf vor der Umstellung zählt für die E1kv, Verkauf danach gilt als endbesteuert", () => {
    const r = year(
      trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "2", "100.00"),
      trade("SELL", "2026-04-30T10:00:00.000Z", "US0000000001", "1", "70.00"), // +20 vor der Umstellung
      trade("SELL", "2026-05-01T10:00:00.000Z", "US0000000001", "1", "80.00", { tax: "-8.25" }), // +30 danach
    );
    expect(r.kz994.toString()).toBe("20");
    expect(r.tax275Eur.toString()).toBe("5.5");
    expect(r.realized.map((x) => x.gainEur.toString())).toEqual(["20"]);
    expect(r.taxedByBroker).toEqual([
      expect.objectContaining({ line: 4, kind: "sale", isin: "US0000000001", date: "2026-05-01" }),
    ]);
    expect(r.taxedByBroker[0]?.amountEur.toString()).toBe("30");
    expect(r.taxedByBroker[0]?.withheldEur.toString()).toBe("8.25");
    expect(r.brokerWithheldEur.toString()).toBe("8.25");
    expect(r.notComputed).toEqual([]);
  });

  test("Dividenden und Zinsen ab der Umstellung gelten als endbesteuert, auch Fonds und Fremdwährung", () => {
    const r = year(
      dividend("2026-04-15T00:00:00.000000Z", "DE0000000001", "100.00", "-26.38"),
      dividend("2026-06-15T00:00:00.000000Z", "US0000000001", "29.58", "-8.13", { original_currency: "USD" }),
      dividend("2026-06-16T00:00:00.000000Z", "IE0000000001", "42.38", "-11.65", { asset_class: "ETF" }),
      interest("2026-07-01T00:00:00.000000Z", "4.00", { tax: "-1.10" }),
    );
    expect(r.kz863.toString()).toBe("100");
    expect(r.kz998.toString()).toBe("15");
    expect(r.kz861.toString()).toBe("0");
    expect(r.taxedByBroker.map((x) => [x.line, x.kind, x.amountEur.toString(), x.withheldEur.toString()])).toEqual([
      [3, "dividend", "29.58", "8.13"],
      [4, "dividend", "42.38", "11.65"],
      [5, "interest", "4", "1.1"],
    ]);
    expect(r.brokerWithheldEur.toString()).toBe("20.88");
    expect(r.notComputed).toEqual([]);
  });

  test("Gutschrift von Trade Republic (Verlustausgleich) mindert die einbehaltene Steuer", () => {
    const r = year(
      trade("BUY", "2026-05-02T10:00:00.000Z", "US0000000001", "1", "100.00"),
      trade("SELL", "2026-06-02T10:00:00.000Z", "US0000000001", "1", "90.00", { tax: "2.75" }),
      interest("2026-07-01T00:00:00.000000Z", "10.00", { tax: "-2.75" }),
    );
    expect(r.brokerWithheldEur.toString()).toBe("0");
    expect(r.unusedLossEur.toString()).toBe("0"); // Verlust gehört nicht in die eigene Rechnung
  });

  test("ohne Angabe gilt das Konto als nicht steuereinfach", () => {
    const r = computeYear(parseTradeRepublicCsv(trCsv(interest("2026-07-01T00:00:00.000000Z", "4.00"))), 2026);
    expect(r.taxSimpleSince).toBeNull();
    expect(r.kz861.toString()).toBe("4");
    expect(r.taxedByBroker).toEqual([]);
  });

  test("ungültiges Datum wird mit deutscher Meldung abgelehnt", () => {
    const data = parseTradeRepublicCsv(trCsv(interest("2026-07-01T00:00:00.000000Z", "4.00")));
    expect(() => computeYear(data, 2026, { taxSimpleSince: "1.5.2026" })).toThrow(/steuereinfach seit/);
  });
});
