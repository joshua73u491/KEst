import { describe, expect, test } from "vitest";
import { RateTable } from "../src/fx.js";
import { parseIbkrFlexXml } from "../src/import/ibkrFlex.js";
import { computeYear, type YearOptions } from "../src/yearReport.js";
import { ibDelivery, ibkrXml, ibOption, ibOptionBook, ibTrade, type Attrs } from "./helpers/ibkrXml.js";

/**
 * Nicht verbriefte Derivate (IBKR-Optionen, Futures). Rechtsgrundlage:
 * - § 27 Abs. 4 und § 27a Abs. 3 Z 3 EStG 1988 (https://www.jusline.at/gesetz/estg/paragraf/27a): Bei Verfall ist die
 *   Stillhalterprämie der Ertrag (lit b); beim Glattstellen gilt die Stillhalterprämie als Veräußerungserlös (lit c).
 * - § 27a Abs. 2 Z 7 EStG: kein Sondersteuersatz für nicht verbriefte Derivate ohne freiwilligen KESt-Abzug -> Tarif, KZ 857.
 * - EStR 2000 Rz 6173-6177 (Abschnitt 20.2.3, Fassung 13.03.2024): Besteuerung erst bei Verfall, Glattstellung oder Ausübung;
 *   Ausübung mit Lieferung: Prämie geht in Anschaffungskosten bzw. Veräußerungserlös der Aktien ein.
 */
const year = (y: number, trades: Attrs[], options: YearOptions = {}) => computeYear(parseIbkrFlexXml(ibkrXml({ trades })), y, options);

describe("Stillhalter (Rz 6176, 6177)", () => {
  test("Testfall 4a: Short Put verfällt wertlos – Prämie wird beim Verfall voll steuerpflichtig (Tarif, KZ 857)", () => {
    // 1 Kontrakt, Prämie 200 €; Verfall 18.12.2026 -> Ertrag 200 € am Verfallstag
    const r = year(2026, [ibOption("SELL", "20260915", "ERF P50", "1", "200"), ibOptionBook("BUY", "20261218", "ERF P50", "1")]);
    expect(r.kz857.toString()).toBe("200");
    expect(r.kz994.toString()).toBe("0");
    expect(r.kz995.toString()).toBe("0");
    expect(r.realized).toEqual([expect.objectContaining({ date: "2026-12-18", kind: "derivative", name: "ERF P50" })]);
    expect(r.realized[0]?.gainEur.toString()).toBe("200");
  });

  test("Testfall 4b: Short Call glattgestellt – Prämie 480 € minus 100 € Rückkauf = 380 € (Beispiel Rz 6177 mal 10)", () => {
    const call = { putCall: "C" };
    const r = year(2026, [ibOption("SELL", "20260301", "ERF C60", "1", "480", call), ibOption("BUY", "20260401", "ERF C60", "1", "100", { ...call, openCloseIndicator: "C" })]);
    expect(r.kz857.toString()).toBe("380");
    expect(r.realized.map((x) => x.date)).toEqual(["2026-04-01"]);
  });

  test("Testfall 4c: Short Put zugeteilt – Prämie senkt die Anschaffungskosten der Aktien (Rz 6176)", () => {
    // Prämie 100 €, Zuteilung: 100 Aktien zu 50 € = 5.000 €; Anschaffungskosten 4.900 €.
    // Verkauf der Aktien zu 52 € = 5.200 € -> Gewinn 300 € im 27,5 %-Topf (KZ 994), kein Ertrag aus der Option.
    const r = year(2026, [
      ibOption("SELL", "20260301", "ERF P50", "1", "100"),
      ibOptionBook("BUY", "20260619", "ERF P50", "1"),
      ibDelivery("BUY", "20260619", "100", "50"),
      ibTrade("SELL", "20260701", "US0000000777", "100", "5200", { currency: "EUR", ibCommission: "0", ibCommissionCurrency: "EUR" }),
    ]);
    expect(r.kz857.toString()).toBe("0");
    expect(r.kz994.toString()).toBe("300");
    expect(r.realized.map((x) => [x.kind, x.gainEur.toString()])).toEqual([["security", "300"]]);
    expect(r.notComputed).toEqual([]);
  });

  test("Short Call zugeteilt – Prämie erhöht den Veräußerungserlös (Rz 6176)", () => {
    // Aktien gekauft zu 5.000 €, Call verkauft (Prämie 150 €), Zuteilung: Lieferung zu 55 € = 5.500 € + 150 € = 5.650 € -> +650 €
    const call = { putCall: "C", strike: "55" };
    const r = year(2026, [
      ibTrade("BUY", "20260102", "US0000000777", "100", "5000", { symbol: "ERF", conid: "U-ERF", currency: "EUR", ibCommission: "0", ibCommissionCurrency: "EUR" }),
      ibOption("SELL", "20260301", "ERF C55", "1", "150", call),
      ibOptionBook("BUY", "20260619", "ERF C55", "1", call),
      ibDelivery("SELL", "20260619", "100", "55"),
    ]);
    expect(r.kz994.toString()).toBe("650");
    expect(r.kz857.toString()).toBe("0");
  });

  test("Testfall 5: Option über den Jahreswechsel – kein Ertrag im Jahr der Prämie, Ertrag im Jahr des Verfalls", () => {
    const trades = [
      ibOption("SELL", "20261115", "ERF C70", "1", "200", { putCall: "C", strike: "70", expiry: "20270115" }),
      ibOptionBook("BUY", "20270115", "ERF C70", "1", { putCall: "C", strike: "70", expiry: "20270115" }),
    ];
    const y2026 = year(2026, trades.slice(0, 1));
    expect(y2026.kz857.toString()).toBe("0");
    expect(y2026.openDerivatives.map((p) => [p.symbol, p.quantity.toString(), p.basisEur.toString()])).toEqual([["ERF C70", "-1", "200"]]);
    expect(year(2027, trades).kz857.toString()).toBe("200");
  });
});

describe("Inhaber von Optionen (Rz 6174a, 6176)", () => {
  test("Long Option verfällt – Verlust in Höhe der Prämie", () => {
    const r = year(2026, [ibOption("BUY", "20260301", "ERF P50", "1", "120"), ibOptionBook("SELL", "20261218", "ERF P50", "1")]);
    expect(r.kz857.toString()).toBe("-120");
  });

  test("Long Call ausgeübt – Prämie erhöht die Anschaffungskosten der Aktien (Rz 6174a Beispiel 1)", () => {
    // Prämie 100 €, Lieferung 100 Aktien zu 50 € -> Anschaffungskosten 5.100 €
    const call = { putCall: "C" };
    const r = year(2026, [ibOption("BUY", "20260301", "ERF C50", "1", "100", call), ibOptionBook("SELL", "20260619", "ERF C50", "1", call), ibDelivery("BUY", "20260619", "100", "50")]);
    expect(r.openPositions.map((p) => [p.isin, p.costEur.toString()])).toEqual([["US0000000777", "5100"]]);
    expect(r.kz857.toString()).toBe("0");
  });

  test("Long Put ausgeübt – Prämie mindert den Veräußerungserlös (Rz 6174a Beispiel 2)", () => {
    // Aktien zu 4.000 €, Put-Prämie 100 €, Lieferung zu 50 € = 5.000 € - 100 € = 4.900 € -> Gewinn 900 €
    const r = year(2026, [
      ibTrade("BUY", "20260102", "US0000000777", "100", "4000", { symbol: "ERF", conid: "U-ERF", currency: "EUR", ibCommission: "0", ibCommissionCurrency: "EUR" }),
      ibOption("BUY", "20260301", "ERF P50", "1", "100"),
      ibOptionBook("SELL", "20260619", "ERF P50", "1"),
      ibDelivery("SELL", "20260619", "100", "50"),
    ]);
    expect(r.kz994.toString()).toBe("900");
  });

  test("Verkauf mit Gewinn und gleitender Durchschnittspreis je Kontrakt (§ 27a Abs. 4 Z 3)", () => {
    // Kauf 1 zu 100, Kauf 1 zu 200 (Ø 150), Verkauf 1 zu 180 -> +30
    const r = year(2026, [
      ibOption("BUY", "20260301", "ERF P50", "1", "100"),
      ibOption("BUY", "20260302", "ERF P50", "1", "200"),
      ibOption("SELL", "20260303", "ERF P50", "1", "180", { openCloseIndicator: "C" }),
    ]);
    expect(r.kz857.toString()).toBe("30");
  });

  test("ein Trade schließt Long und eröffnet Short: aufgeteilt nach Stückzahl", () => {
    // Long 1 (100 €), Verkauf 2 für 300 € (150 je Kontrakt): +50 realisiert, Short 1 mit Prämie 150 offen
    const r = year(2026, [ibOption("BUY", "20260301", "ERF P50", "1", "100"), ibOption("SELL", "20260302", "ERF P50", "2", "300")]);
    expect(r.kz857.toString()).toBe("50");
    expect(r.openDerivatives.map((p) => [p.quantity.toString(), p.basisEur.toString()])).toEqual([["-1", "150"]]);
  });
});

describe("Futures, Einstellung und Grenzfälle", () => {
  test("Future: Gewinn aus der Differenz von Eröffnung und Schließung (Differenzausgleich, Rz 6175)", () => {
    const fut = { assetCategory: "FUT", symbol: "ERFZ6", conid: "F-1", multiplier: "50", currency: "EUR", ibCommission: "0", ibCommissionCurrency: "EUR", putCall: "", strike: "", expiry: "20261218", underlyingSymbol: "ERF" };
    const r = year(2026, [ibTrade("BUY", "20260301", "", "1", "250000", fut), ibTrade("SELL", "20260401", "", "1", "250500", { ...fut, openCloseIndicator: "C" })]);
    expect(r.kz857.toString()).toBe("500");
  });

  test("Einstellung 27,5 %: Ergebnis in KZ 995/896 und im 27,5 %-Topf mit Verlustausgleich", () => {
    const special = { derivativesTreatment: "special" } as const;
    const r = year(2026, [
      ibOption("SELL", "20260915", "ERF P50", "1", "200"),
      ibOptionBook("BUY", "20261218", "ERF P50", "1"),
      ibTrade("BUY", "20260102", "DE0000000201", "1", "100", { currency: "EUR", ibCommission: "0", ibCommissionCurrency: "EUR" }),
      ibTrade("SELL", "20260103", "DE0000000201", "1", "50", { currency: "EUR", ibCommission: "0", ibCommissionCurrency: "EUR" }),
    ], special);
    expect(r.kz857.toString()).toBe("0");
    expect(r.kz995.toString()).toBe("200");
    expect(r.kz892.toString()).toBe("50");
    expect(r.taxableBaseEur.toString()).toBe("150");
  });

  test("Spesen: beim Tarif abziehbar, bei 27,5 % nicht (Annahme, offene Frage)", () => {
    const fee = { ibCommission: "-2" };
    const trades = [ibOption("SELL", "20260301", "ERF P50", "1", "200", fee), ibOption("BUY", "20260401", "ERF P50", "1", "50", { ...fee, openCloseIndicator: "C" })];
    expect(year(2026, trades).kz857.toString()).toBe("146");
    expect(year(2026, trades, { derivativesTreatment: "special" }).kz995.toString()).toBe("150");
  });

  test("positive KZ 857 ohne Angabe des sonstigen Einkommens: Hinweis statt Schätzung", () => {
    const r = year(2026, [ibOption("SELL", "20260915", "ERF P50", "1", "200"), ibOptionBook("BUY", "20261218", "ERF P50", "1")]);
    expect(r.tariffExtraTaxEur.toString()).toBe("0");
    expect(r.notComputed).toEqual([
      {
        line: 0,
        type: "KZ 857",
        reason:
          "Für die Einkommensteuer auf KZ 857 (200,00 €, Tarif bis 55 %) fehlt die Angabe deines sonstigen Einkommens. " +
          "Ohne sie wird die Mehrsteuer nicht berechnet, und die Rücklage enthält sie nicht.",
      },
    ]);
  });
});

describe("Tarif-Schätzung für KZ 857 (Schritt 2.2)", () => {
  // Mehrsteuer = ESt(sonstiges Einkommen + KZ 857) − ESt(sonstiges Einkommen), Tarif des Jahres (src/tariff.ts)
  const shortPutExpires = (y: string) => [ibOption("SELL", `${y}0301`, "ERF P50", "50", "5000", { expiry: `${y}1218` }), ibOptionBook("BUY", `${y}1218`, "ERF P50", "50", { expiry: `${y}1218` })];

  test("2026: 30.000 € sonstiges Einkommen, 5.000 € Prämie -> 1.500 € Mehrsteuer", () => {
    const r = year(2026, shortPutExpires("2026"), { otherIncomeEur: "30000" });
    expect(r.kz857.toString()).toBe("5000");
    expect(r.tariffExtraTaxEur.toString()).toBe("1500");
    expect(r.notComputed).toEqual([]);
  });

  test("2025 mit dem Tarif 2025: 33.000 € + 5.000 € -> 1.716,40 €", () => {
    expect(year(2025, shortPutExpires("2025"), { otherIncomeEur: "33000" }).tariffExtraTaxEur.toString()).toBe("1716.4");
  });

  test("Jahr ohne hinterlegten Tarif (2027): nicht berechnet", () => {
    const r = year(2027, shortPutExpires("2027"), { otherIncomeEur: "30000" });
    expect(r.tariffExtraTaxEur.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toBe(
      "Der Einkommensteuertarif 2027 ist in der App noch nicht hinterlegt. Die Mehrsteuer auf KZ 857 (5.000,00 €) wird nicht berechnet.",
    );
  });

  test("Einstellung 27,5 %: keine Mehrsteuer nach Tarif", () => {
    const r = year(2026, shortPutExpires("2026"), { otherIncomeEur: "30000", derivativesTreatment: "special" });
    expect(r.tariffExtraTaxEur.toString()).toBe("0");
  });

  test("Verlust in KZ 857: keine Mehrsteuer, kein Hinweis", () => {
    const r = year(2026, [ibOption("BUY", "20260301", "ERF P50", "1", "120"), ibOptionBook("SELL", "20261218", "ERF P50", "1")], { otherIncomeEur: "30000" });
    expect(r.kz857.toString()).toBe("-120");
    expect(r.tariffExtraTaxEur.toString()).toBe("0");
    expect(r.notComputed).toEqual([]);
  });

  test("ungültige Angabe des sonstigen Einkommens wird abgelehnt", () => {
    expect(() => year(2026, shortPutExpires("2026"), { otherIncomeEur: "dreißigtausend" })).toThrow(/sonstige Einkommen/);
  });

  test("Schließung ohne bekannte Eröffnung (vor dem Exportzeitraum) wird nicht berechnet", () => {
    const r = year(2026, [ibOptionBook("BUY", "20261218", "ERF P50", "1")]);
    expect(r.kz857.toString()).toBe("0");
    expect(r.openDerivatives).toEqual([]);
    expect(r.notComputed[0]?.reason).toMatch(/Schließung von 1 Kontrakt ERF P50 am 2026-12-18 ohne bekannte Eröffnung/);
  });

  test("Schließung zum Preis 0 vor dem Verfallstag ohne Aktienbuchung wird nicht geschätzt", () => {
    const r = year(2026, [ibOption("SELL", "20260301", "ERF P50", "1", "100"), ibOptionBook("BUY", "20260601", "ERF P50", "1")]);
    expect(r.kz857.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toMatch(/vor dem Verfallstag 2026-12-18.*Ausübung oder Zuteilung/);
  });

  test("Code A (Assignment) ohne eingelesene Aktienbuchung: nie als Verfall werten", () => {
    // Wie in einer echten Flex-Datei: Zuteilung mit Code A, die Aktienbuchung fehlt (z. B. ohne ISIN nicht eingelesen).
    const r = year(2026, [ibOption("SELL", "20260301", "ERF P50", "1", "100"), ibOptionBook("BUY", "20261218", "ERF P50", "1", { notes: "A" })]);
    expect(r.kz857.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toMatch(/Zuteilung oder Ausübung \(Code A\).*ohne passende Aktienbuchung.*Nicht berechnet/);
  });

  test("Code Ep (Expired) gilt als Verfall, auch wenn kein Verfallstag bekannt ist", () => {
    const r = year(2026, [ibOption("SELL", "20260301", "ERF P50", "1", "100", { expiry: "" }), ibOptionBook("BUY", "20260619", "ERF P50", "1", { expiry: "", notes: "Ep" })]);
    expect(r.kz857.toString()).toBe("100");
  });

  test("Code GEA (Verfall oder Zuteilung aus Gegenpositionen) wird nicht geschätzt", () => {
    const r = year(2026, [ibOption("SELL", "20260301", "ERF P50", "1", "100"), ibOptionBook("BUY", "20261218", "ERF P50", "1", { notes: "GEA" })]);
    expect(r.kz857.toString()).toBe("0");
    expect(r.notComputed[0]?.reason).toMatch(/Code GEA/);
  });

  test("Code A mit passender Aktienbuchung: Prämie geht in die Aktie ein", () => {
    const r = year(2026, [
      ibOption("SELL", "20260301", "ERF P50", "1", "100"),
      ibOptionBook("BUY", "20260619", "ERF P50", "1", { notes: "A" }),
      ibDelivery("BUY", "20260619", "100", "50", { notes: "A" }),
    ]);
    expect(r.openPositions.map((p) => p.costEur.toString())).toEqual(["4900"]);
    expect(r.notComputed).toEqual([]);
  });

  test("ohne EZB-Kurs: Kontrakt ab dieser Buchung nicht berechnet", () => {
    const usd = { currency: "USD", ibCommissionCurrency: "USD" };
    const r = computeYear(
      parseIbkrFlexXml(ibkrXml({ trades: [ibOption("SELL", "20260301", "ERF P50", "1", "200", usd), ibOptionBook("BUY", "20261218", "ERF P50", "1", usd)] })),
      2026,
      { rates: new RateTable([["USD", "2026-12-18", "1.2"]]) },
    );
    expect(r.kz857.toString()).toBe("0");
    expect(r.notComputed.map((n) => n.line)).toEqual([5, 6]);
    expect(r.notComputed[1]?.reason).toMatch(/Kontrakt ERF P50 ist seit Zeile 5 unvollständig/);
  });
});
