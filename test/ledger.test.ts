import { describe, expect, test } from "vitest";
import { dec } from "../src/decimal.js";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { addEntry, checkInvestment, emptyLedger, markPaid, removeEntry, reserveStatus, type Ledger } from "../src/ledger.js";
import { sollTimeline } from "../src/sollTimeline.js";
import { computeYear } from "../src/yearReport.js";
import { trade, trCsv } from "./helpers/trCsv.js";

/**
 * Testfall 6 aus dem PRODUKTPLAN: großer Verlust im Dezember, die Rücklage wird erst nach dem 31.12. freigegeben.
 * Puffer 10 %. Bis 10.11.: Gewinn 10.000 € -> 27,5 % = 2.750 € -> Soll 3.025 €.
 * Am 15.12.: Verlust 8.000 € -> Gewinn 2.000 € -> 550 € -> Soll 605 €. Höchststand des Jahres: 3.025 €.
 */
const data = parseTradeRepublicCsv(
  trCsv(
    trade("BUY", "2026-01-05T10:00:00.000Z", "US0000000001", "10", "1000.00"),
    trade("SELL", "2026-11-10T10:00:00.000Z", "US0000000001", "10", "11000.00"),
    trade("BUY", "2026-12-01T10:00:00.000Z", "US0000000002", "1", "9000.00"),
    trade("SELL", "2026-12-15T10:00:00.000Z", "US0000000002", "1", "1000.00"),
  ),
);
const timeline = (today: string, paid: Record<string, string> = {}) => sollTimeline(data, {}, 10, today, paid);
const withIst = (value: string, date = "2026-11-30"): Ledger => addEntry(emptyLedger(), { id: "e1", date, valueEur: value, place: "Tagesgeld Hausbank", note: "" });

describe("Soll-Verlauf je Jahr", () => {
  test("laufendes Jahr: aktuelles Soll und Höchststand bisher", () => {
    const [y] = timeline("2026-12-20");
    expect(y?.year).toBe(2026);
    expect(y?.sollEur.toString()).toBe("605");
    expect(y?.peakEur.toString()).toBe("3025");
  });

  test("Stichtag vor dem Verlust: Soll gleich Höchststand", () => {
    const [y] = timeline("2026-11-30");
    expect(y?.sollEur.toString()).toBe("3025");
    expect(y?.peakEur.toString()).toBe("3025");
  });

  test("Auswertung zu einem Stichtag (asOf) ignoriert spätere Buchungen", () => {
    expect(computeYear(data, 2026, { asOf: "2026-11-30" }).kz994.toString()).toBe("10000");
  });

  test("neues Jahr: Vorjahr abgeschlossen mit endgültigem Soll, laufendes Jahr beginnt bei 0", () => {
    const ys = timeline("2027-01-05");
    expect(ys.map((y) => [y.year, y.sollEur.toString(), y.peakEur.toString()])).toEqual([
      [2026, "605", "605"],
      [2027, "0", "0"],
    ]);
  });
});

describe("Rücklagen-Ledger: Soll gegen Ist", () => {
  test("Fehlbetrag, wenn weniger zurückgelegt ist als nötig", () => {
    const s = reserveStatus(timeline("2026-11-30"), withIst("1000"), "2026-11-30");
    expect(s.sollEur.toString()).toBe("3025");
    expect(s.istEur?.toString()).toBe("1000");
    expect(s.shortfallEur.toString()).toBe("2025");
    expect(s.surplusEur.toString()).toBe("0");
  });

  test("ohne Eintrag: ganzes Soll fehlt, Ist unbekannt", () => {
    const s = reserveStatus(timeline("2026-11-30"), emptyLedger(), "2026-11-30");
    expect(s.istEur).toBeNull();
    expect(s.shortfallEur.toString()).toBe("3025");
  });

  test("Testfall 6: Verlust im Dezember – Überschuss erst nach dem 31.12. frei", () => {
    const s = reserveStatus(timeline("2026-12-20"), withIst("3025"), "2026-12-20");
    expect(s.sollEur.toString()).toBe("605");
    expect(s.surplusEur.toString()).toBe("2420");
    expect(s.releasableEur.toString()).toBe("0");
    expect(s.lockedEur.toString()).toBe("2420");
    expect(s.lockedUntil).toBe("2027-01-01");
  });

  test("Testfall 6: nach dem 31.12. ist der Überschuss frei", () => {
    const s = reserveStatus(timeline("2027-01-05"), withIst("3025"), "2027-01-05");
    expect(s.sollEur.toString()).toBe("605");
    expect(s.releasableEur.toString()).toBe("2420");
    expect(s.lockedEur.toString()).toBe("0");
    expect(s.years.map((y) => [y.year, y.closed])).toEqual([
      [2026, true],
      [2027, false],
    ]);
  });

  test("Steuer bezahlt: das Jahr zählt nicht mehr zum Soll", () => {
    const ledger = markPaid(withIst("3025"), 2026, "2027-01-03");
    const s = reserveStatus(timeline("2027-01-05", ledger.paidYears), ledger, "2027-01-05");
    expect(s.sollEur.toString()).toBe("0");
    expect(s.releasableEur.toString()).toBe("3025");
    expect(s.years.map((y) => y.year)).toEqual([2027]);
  });

  test("es gilt der neueste Eintrag bis zum Stichtag", () => {
    let l = addEntry(emptyLedger(), { id: "a", date: "2026-10-01", valueEur: "500", place: "Tagesgeld", note: "" });
    l = addEntry(l, { id: "b", date: "2026-11-15", valueEur: "3100", place: "Tagesgeld", note: "nach Verkauf" });
    l = addEntry(l, { id: "c", date: "2026-12-31", valueEur: "4000", place: "Tagesgeld", note: "" });
    const s = reserveStatus(timeline("2026-11-30"), l, "2026-11-30");
    expect(s.istEur?.toString()).toBe("3100");
    expect(s.istDate).toBe("2026-11-15");
    expect(s.istEntryId).toBe("b");
    expect(s.istPlace).toBe("Tagesgeld");
    expect(removeEntry(l, "b").entries.map((e) => e.id)).toEqual(["a", "c"]);
  });

  test("ungültige Einträge werden abgelehnt", () => {
    expect(() => addEntry(emptyLedger(), { id: "x", date: "30.11.2026", valueEur: "100", place: "", note: "" })).toThrow(/Datum/);
    expect(() => addEntry(emptyLedger(), { id: "x", date: "2026-11-30", valueEur: "-5", place: "", note: "" })).toThrow(/Marktwert/);
  });

  test("unvollständige Berechnung eines Jahres wird im Status vermerkt", () => {
    const usd = parseTradeRepublicCsv(trCsv(trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000009", "1", "100.00")));
    const s = reserveStatus(sollTimeline(usd, {}, 10, "2026-11-30", {}), emptyLedger(), "2026-11-30");
    expect(s.complete).toBe(false);
  });
});

describe("Kriterien-Check der gewählten Anlage (warnt nur, empfiehlt nichts)", () => {
  test("Tagesgeld: erfüllt", () => {
    expect(checkInvestment({ kind: "deposit", reportingFund: null, sri: null }).map((f) => f.severity)).toEqual(["ok"]);
  });

  test("Geldmarktfonds als Meldefonds mit SRI 1: erfüllt", () => {
    expect(checkInvestment({ kind: "moneyMarketFund", reportingFund: "yes", sri: 1 }).map((f) => f.severity)).toEqual(["ok"]);
  });

  test("Nicht-Meldefonds: Warnung wegen Pauschalbesteuerung", () => {
    const f = checkInvestment({ kind: "moneyMarketFund", reportingFund: "no", sri: 1 });
    expect(f).toEqual([
      {
        severity: "warning",
        text:
          "Kein Meldefonds: Steuerpflichtig sind pauschal 90 % der Wertsteigerung, mindestens 10 % des Werts am 31.12. " +
          "Das kann ein Vielfaches des tatsächlichen Ertrags sein.",
      },
    ]);
  });

  test("Meldefonds-Status unbekannt: Warnung mit Hinweis auf die OeKB", () => {
    expect(checkInvestment({ kind: "moneyMarketFund", reportingFund: "unknown", sri: 1 })[0]?.text).toMatch(/my\.oekb\.at/);
  });

  test("Fonds ohne Angabe zum Meldefonds: dieselbe Warnung wie bei „unbekannt“", () => {
    const f = checkInvestment({ kind: "moneyMarketFund", reportingFund: null, sri: 1 });
    expect(f.map((x) => x.severity)).toEqual(["warning"]);
    expect(f[0]?.text).toMatch(/my\.oekb\.at/);
  });

  test("Risikoklasse ab 3: Warnung (Entscheidung Joshua)", () => {
    expect(checkInvestment({ kind: "shortGovBonds", reportingFund: null, sri: 2 }).map((f) => f.severity)).toEqual(["ok"]);
    const f = checkInvestment({ kind: "shortGovBonds", reportingFund: null, sri: 3 });
    expect(f.map((x) => x.severity)).toEqual(["warning"]);
    expect(f[0]?.text).toMatch(/Risikoklasse 3/);
  });

  test("Aktien-ETF: Warnung, auch ohne Angabe der Risikoklasse", () => {
    const f = checkInvestment({ kind: "equityEtf", reportingFund: "yes", sri: null });
    expect(f.map((x) => x.severity)).toEqual(["warning", "warning"]);
    expect(f.map((x) => x.text).join(" ")).toMatch(/schwanken/);
    expect(f.map((x) => x.text).join(" ")).toMatch(/Risikoklasse nicht angegeben/);
  });

  test("kein Text empfiehlt ein Produkt oder eine Anlage", () => {
    const all = (["deposit", "moneyMarketFund", "shortGovBonds", "equityEtf", "longBondEtf", "other"] as const).flatMap((kind) =>
      [null, 1, 3, 6].flatMap((sri) => (["yes", "no", "unknown", null] as const).flatMap((reportingFund) => checkInvestment({ kind, reportingFund, sri }))),
    );
    for (const f of all) expect(f.text).not.toMatch(/empfehl|solltest|wähle|kaufe|nimm /i);
  });
});
