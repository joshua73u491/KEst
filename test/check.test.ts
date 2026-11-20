import { describe, expect, test } from "vitest";
import { checkBookings } from "../src/check.js";
import { RateTable } from "../src/fx.js";
import { addFile, combine, emptyHistory, filePeriods, type History } from "../src/history.js";
import { parseIbkrFlexXml } from "../src/import/ibkrFlex.js";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { ibCash, ibkrXml, ibOption, ibOptionBook, ibTrade } from "./helpers/ibkrXml.js";
import { dividend, trade, trCsv, type TrRow } from "./helpers/trCsv.js";

const tr = (...rows: TrRow[]) => parseTradeRepublicCsv(trCsv(...rows));
const codes = (f: ReturnType<typeof checkBookings>) => f.map((x) => `${x.severity}:${x.code}`);

describe("Prüfassistent: Bestände", () => {
  test("Verkauf ohne ausreichenden Bestand: Fehler mit Fundstelle und Erklärung", () => {
    const f = checkBookings({
      data: tr(
        trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "1", "100.00"),
        trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000001", "3", "300.00"),
      ),
    });
    expect(f).toEqual([
      {
        severity: "error",
        code: "insufficient-position",
        text:
          "Verkauf von 3 Stück US0000000001 am 2026-02-02, bekannt sind nur 1 Stück. Vermutlich wurde vor dem Exportzeitraum gekauft " +
          "oder eine Einbuchung fehlt. Gewinne dieser Position werden nicht berechnet. Bitte den Export mit Zeitraum seit Kontoeröffnung verwenden.",
        at: [{ line: 3 }],
      },
    ]);
  });

  test("Übertrag größer als Bestand: eigener Hinweis", () => {
    const f = checkBookings({
      data: tr(
        trade("BUY", "2026-01-02T10:00:00.000Z", "BTC", "0.001", "50.00", { asset_class: "CRYPTO" }),
        { datetime: "2026-02-02T10:00:00.000Z", date: "2026-02-02", category: "DELIVERY", type: "FREE_DELIVERY", asset_class: "CRYPTO", symbol: "BTC", shares: "-0.002" },
      ),
    });
    expect(codes(f)).toEqual(["error:transfer-exceeds"]);
    expect(f[0]?.text).toMatch(/Übertrag von 0.002 Stück BTC am 2026-02-02, bekannt sind nur 0.001 Stück/);
  });

  test("nach einer übersprungenen Buchung keine Folgemeldungen für dieselbe Position", () => {
    const f = checkBookings({
      data: tr(
        trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000005", "1", "100.00", { currency: "USD" }),
        trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000005", "1", "150.00"),
      ),
    });
    expect(f.filter((x) => x.code === "insufficient-position")).toEqual([]);
  });

  test("Stillhalter (Short-Optionen) gelten nicht als Verkauf ohne Bestand", () => {
    const data = parseIbkrFlexXml(ibkrXml({ trades: [ibOption("SELL", "20260301", "ERF P50", "1", "100"), ibOptionBook("BUY", "20261218", "ERF P50", "1")] }));
    expect(checkBookings({ data })).toEqual([]);
  });

  test("Bestand nahe 0 durch Rundung wird erklärt", () => {
    const crypto = { asset_class: "CRYPTO" };
    const f = checkBookings({
      data: tr(
        trade("BUY", "2026-01-02T10:00:00.000Z", "BTC", "0.5", "20000.00", crypto),
        trade("SELL", "2026-02-02T10:00:00.000Z", "BTC", "0.4999999999", "21000.00", crypto),
      ),
    });
    expect(f).toEqual([
      {
        severity: "info",
        code: "dust",
        text:
          "Von BTC ist ein Rest von 1e-10 Stück übrig, vermutlich durch Rundung beim Broker. " +
          "Die App führt ihn als offene Position; beim späteren Verkauf zählt er mit.",
        at: [{ line: 3 }],
      },
    ]);
  });
});

describe("Prüfassistent: doppelte Buchungen", () => {
  test("gleiche Buchung mit verschiedenen Transaktions-IDs: mögliche Doppelung", () => {
    const t = trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "1", "100.00");
    const f = checkBookings({ data: tr({ ...t, transaction_id: "a" }, { ...t, transaction_id: "b" }) });
    expect(f).toEqual([
      {
        severity: "warning",
        code: "possible-duplicate",
        text: "Kauf von 1 Stück US0000000001 am 2026-01-02 steht zweimal mit gleichem Zeitpunkt und Betrag in den Daten. Bitte prüfen, ob die Buchung doppelt ist.",
        at: [{ line: 2 }, { line: 3 }],
      },
    ]);
  });

  test("Duplikate aus mehreren Dateien werden genannt", () => {
    const f = checkBookings({ data: tr(trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "1", "100.00")), duplicates: 4 });
    expect(f).toEqual([
      { severity: "info", code: "duplicate", text: "4 Buchungen kamen in mehreren Dateien vor und werden nur einmal gezählt.", at: [] },
    ]);
  });
});

describe("Prüfassistent: Lücken im Exportzeitraum", () => {
  const NOW = "2026-11-20T10:00:00.000Z";
  const add = (h: History, name: string, text: string) => addFile(h, name, text, NOW, name).history;

  test("IBKR: Tage zwischen zwei Flex Queries ohne Auszug", () => {
    let h = add(emptyHistory(), "q1.xml", ibkrXml({ toDate: "20260331" }));
    h = add(h, "rest.xml", ibkrXml({ toDate: "20261231" }).replace('fromDate="20260101"', 'fromDate="20260501"'));
    const f = checkBookings({ data: combine(h).data, periods: filePeriods(h) });
    expect(f).toEqual([
      {
        severity: "warning",
        code: "gap",
        text:
          "IBKR U0000000: Für 2026-04-01 bis 2026-04-30 liegt kein Export vor (zwischen „q1.xml“ und „rest.xml“). " +
          "Fehlen dort Buchungen, stimmen Bestände und Gewinne nicht.",
        at: [],
      },
    ]);
  });

  test("Trade Republic: lange Zeit ohne Buchung zwischen zwei Dateien", () => {
    let h = add(emptyHistory(), "a.csv", trCsv(trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "1", "100.00", { transaction_id: "1" })));
    h = add(h, "b.csv", trCsv(trade("BUY", "2026-05-04T10:00:00.000Z", "US0000000001", "1", "100.00", { transaction_id: "2" })));
    const f = checkBookings({ data: combine(h).data, periods: filePeriods(h) });
    expect(codes(f)).toEqual(["warning:gap"]);
    expect(f[0]?.text).toBe(
      "Trade Republic: Zwischen der letzten Buchung am 2026-01-02 in „a.csv“ und der ersten am 2026-05-04 in „b.csv“ liegen 122 Tage. " +
        "Falls dazwischen ein Export fehlt, stimmen Bestände und Gewinne nicht. Am sichersten ist ein Export mit Zeitraum seit Kontoeröffnung.",
    );
  });

  test("Trade Republic: kurze Abstände zwischen Dateien sind normal", () => {
    let h = add(emptyHistory(), "a.csv", trCsv(trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "1", "100.00", { transaction_id: "1" })));
    h = add(h, "b.csv", trCsv(trade("BUY", "2026-01-30T10:00:00.000Z", "US0000000001", "1", "100.00", { transaction_id: "2" })));
    expect(checkBookings({ data: combine(h).data, periods: filePeriods(h) })).toEqual([]);
  });
});

describe("Prüfassistent: Fremdwährung ohne Kurs", () => {
  const ibData = () =>
    parseIbkrFlexXml(
      ibkrXml({
        trades: [ibTrade("BUY", "20260302", "US0000000101", "10", "1000"), ibTrade("SELL", "20260307", "US0000000101", "1", "100")],
        cash: [ibCash("Broker Interest Received", "20260805;202000", "4.00")],
      }),
    );

  test("ohne geladene EZB-Kurse: ein Hinweis mit Anzahl", () => {
    expect(checkBookings({ data: ibData() })).toEqual([
      {
        severity: "warning",
        code: "rates-not-loaded",
        text: "3 Buchungen in Fremdwährung brauchen EZB-Referenzkurse, die nicht geladen sind. Sie werden nicht berechnet.",
        at: [],
      },
    ]);
  });

  test("Tag ohne EZB-Kurs (Samstag): je Buchung ein Hinweis", () => {
    const rates = new RateTable([
      ["USD", "2026-03-02", "1.25"],
      ["USD", "2026-08-05", "1.10"],
    ]);
    const f = checkBookings({ data: ibData(), rates });
    expect(f).toEqual([
      {
        severity: "warning",
        code: "missing-rate",
        text: "Für USD gibt es am 2026-03-07 keinen EZB-Referenzkurs (z. B. Wochenende oder Feiertag). Die Buchung wird nicht geschätzt, sondern nicht berechnet.",
        at: [{ line: 6 }],
      },
    ]);
  });

  test("ab „steuereinfach seit“ brauchen Trade-Republic-Dividenden keinen EZB-Kurs", () => {
    const data = tr(dividend("2026-06-15T00:00:00.000000Z", "US0000000001", "29.58", "-4.44", { original_amount: "34.51", original_currency: "USD", fx_rate: "0.857265" }));
    expect(codes(checkBookings({ data }))).toEqual(["warning:rates-not-loaded"]);
    expect(checkBookings({ data, taxSimpleSince: "2026-01-01" })).toEqual([]);
  });
});

describe("Prüfassistent: unbekannte Buchungstypen und Reihenfolge", () => {
  test("unbekannte Buchungstypen werden je Typ zusammengefasst", () => {
    const neu = (at: string) => ({ datetime: at, date: at.slice(0, 10), category: "CASH", type: "SOMETHING_NEW", amount: "1", currency: "EUR" });
    const f = checkBookings({ data: tr(neu("2026-01-02T10:00:00.000Z"), neu("2026-02-02T10:00:00.000Z")) });
    expect(f).toEqual([
      {
        severity: "warning",
        code: "unknown-type",
        text: "Buchungstyp CASH/SOMETHING_NEW (2×) ist der App unbekannt und wird nicht berechnet. Bitte prüfen, ob er steuerlich relevant ist.",
        at: [{ line: 2 }, { line: 3 }],
      },
    ]);
  });

  test("Fehler vor Warnungen vor Hinweisen", () => {
    const f = checkBookings({
      data: tr(
        { datetime: "2026-01-01T10:00:00.000Z", date: "2026-01-01", category: "CASH", type: "SOMETHING_NEW", amount: "1", currency: "EUR" },
        trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000001", "3", "300.00"),
      ),
      duplicates: 1,
    });
    expect(codes(f)).toEqual(["error:insufficient-position", "warning:unknown-type", "info:duplicate"]);
  });

  test("saubere Daten: keine Hinweise", () => {
    const f = checkBookings({
      data: tr(trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "2", "100.00"), trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000001", "2", "120.00")),
    });
    expect(f).toEqual([]);
  });
});
