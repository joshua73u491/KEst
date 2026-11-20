import { describe, expect, test } from "vitest";
import { addFile, combine, emptyHistory, fromBackup, removeFile, restoreBackup, toBackup, type History } from "../src/history.js";
import { RateTable } from "../src/fx.js";
import { addEntry, emptyLedger, markPaid } from "../src/ledger.js";
import { computeYear } from "../src/yearReport.js";
import { ibCash, ibkrXml, ibPosition, ibTrade } from "./helpers/ibkrXml.js";
import { dividend, trade, trCsv } from "./helpers/trCsv.js";

const NOW = "2026-11-20T10:00:00.000Z";
let n = 0;
const add = (h: History, name: string, text: string) => addFile(h, name, text, NOW, `id-${++n}`);

const t1 = trade("BUY", "2026-01-02T10:00:00.000Z", "US0000000001", "2", "100.00", { transaction_id: "t-1" });
const t2 = trade("SELL", "2026-02-02T10:00:00.000Z", "US0000000001", "1", "70.00", { transaction_id: "t-2" });
const t3 = trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000001", "1", "80.00", { transaction_id: "t-3" });

describe("Lokale Historie: Dateien hinzufügen", () => {
  test("gültige Datei wird mit Broker und Zeitpunkt gespeichert", () => {
    const r = add(emptyHistory(), "januar.csv", trCsv(t1));
    expect(r.added).toBe(true);
    expect(r.broker).toBe("Trade Republic");
    expect(r.history.files).toEqual([{ id: expect.any(String), name: "januar.csv", broker: "Trade Republic", importedAt: NOW, text: trCsv(t1) }]);
  });

  test("dieselbe Datei noch einmal wird nicht doppelt gespeichert", () => {
    const first = add(emptyHistory(), "a.csv", trCsv(t1)).history;
    const again = add(first, "a-kopie.csv", trCsv(t1));
    expect(again.added).toBe(false);
    expect(again.history.files).toHaveLength(1);
  });

  test("ungültige Datei wird mit deutscher Meldung abgelehnt und nicht gespeichert", () => {
    expect(() => add(emptyHistory(), "falsch.csv", '"a","b"\n"1","2"\n')).toThrow(/kein Trade-Republic-Transaktionsexport/);
  });

  test("Datei entfernen", () => {
    const h = add(emptyHistory(), "a.csv", trCsv(t1)).history;
    expect(removeFile(h, h.files[0]!.id).files).toEqual([]);
  });

  test("Standard-Einstellungen", () => {
    expect(emptyHistory().settings).toEqual({
      taxSimpleSince: "",
      brokerInterestKz: "863",
      bufferPct: 10,
      derivativesTreatment: "tariff",
      otherIncomeEur: "",
      reservePlace: "",
      setupDoneAt: "",
    });
  });
});

describe("Lokale Historie: mehrere Dateien zusammenführen", () => {
  test("überlappende Exporte: Duplikate über die Transaktions-ID erkannt", () => {
    let h = add(emptyHistory(), "jan-feb.csv", trCsv(t1, t2)).history;
    h = add(h, "feb-mar.csv", trCsv(t2, t3)).history;
    const c = combine(h);
    expect(c.data.trades.map((t) => t.line + "@" + t.file)).toEqual(["2@jan-feb.csv", "3@jan-feb.csv", "3@feb-mar.csv"]);
    expect(c.duplicates).toBe(1);
    // Kauf 2 zu 100 (Ø 50), Verkauf 1 zu 70 (+20), Verkauf 1 zu 80 (+30)
    expect(computeYear(c.data, 2026).kz994.toString()).toBe("50");
  });

  test("Storno in einer späteren Datei hebt die Dividende aus einer früheren Datei auf", () => {
    const original = dividend("2026-02-17T00:00:00.000000Z", "DE0000000001", "100.00", "-26.38", { transaction_id: "d-1" });
    const storno = dividend("2026-03-27T12:17:08.000000Z", "DE0000000001", "-100.00", "26.38", { transaction_id: "d-2" });
    const neu = dividend("2026-03-27T12:44:58.000000Z", "DE0000000001", "100.00", "-15.00", { transaction_id: "d-3" });
    let h = add(emptyHistory(), "alt.csv", trCsv(original)).history;
    h = add(h, "neu.csv", trCsv(storno, neu)).history;
    const c = combine(h);
    expect(c.data.dividends.map((d) => [d.file, d.withheldEur])).toEqual([["neu.csv", "15"]]);
    expect(c.data.unsupported).toEqual([]);
  });

  test("Hinweise nennen die Datei, aus der die Zeile stammt", () => {
    let h = add(emptyHistory(), "a.csv", trCsv(t1)).history;
    h = add(h, "b.csv", trCsv({ datetime: "2026-04-01T10:00:00.000Z", date: "2026-04-01", category: "CASH", type: "NEU", amount: "1", currency: "EUR", transaction_id: "x-1" })).history;
    expect(combine(h).data.unsupported).toEqual([{ line: 2, type: "CASH/NEU", reason: "Unbekannter Buchungstyp", file: "b.csv" }]);
  });

  test("IBKR: überlappende Flex Queries, Bestandsabgleich aus dem neuesten Auszug", () => {
    const buy = ibTrade("BUY", "20260302", "US0000000101", "10", "1000", { currency: "EUR", ibCommissionCurrency: "EUR", transactionID: "100" });
    const sell = ibTrade("SELL", "20260601", "US0000000101", "4", "520", { currency: "EUR", ibCommissionCurrency: "EUR", transactionID: "101" });
    let h = add(emptyHistory(), "q1.xml", ibkrXml({ trades: [buy], positions: [ibPosition("US0000000101", "10")], toDate: "20260331" })).history;
    h = add(h, "jahr.xml", ibkrXml({ trades: [buy, sell], positions: [ibPosition("US0000000101", "6")], toDate: "20261231" })).history;
    const c = combine(h);
    expect(c.data.trades).toHaveLength(2);
    expect(c.duplicates).toBe(1);
    expect(c.data.reportedPositions.map((p) => [p.quantity, p.file])).toEqual([["6", "jahr.xml"]]);
    expect(computeYear(c.data, 2026).notComputed).toEqual([]);
  });

  test("IBKR: Dividende und Quellensteuer aus verschiedenen Dateien werden zusammengeführt", () => {
    const div = ibCash("Dividends", "20260415;202000", "10.00", { isin: "US0000000101", transactionID: "C1" });
    const wht = ibCash("Withholding Tax", "20260415;202000", "-1.50", { isin: "US0000000101", transactionID: "C2" });
    let h = add(emptyHistory(), "a.xml", ibkrXml({ cash: [div] })).history;
    h = add(h, "b.xml", ibkrXml({ cash: [div, wht] })).history;
    const c = combine(h);
    expect(c.data.dividends.map((d) => [d.originalAmount, d.withheldOriginal])).toEqual([["10", "1.5"]]);
    const r = computeYear(c.data, 2026, { rates: new RateTable([["USD", "2026-04-15", "1.25"]]) });
    expect(r.kz998.toString()).toBe("1.2");
  });

  test("Trade Republic und IBKR gemeinsam", () => {
    let h = add(emptyHistory(), "tr.csv", trCsv(t1, t2)).history;
    h = add(h, "ib.xml", ibkrXml({ trades: [ibTrade("BUY", "20260302", "DE0000000201", "1", "50", { currency: "EUR", ibCommissionCurrency: "EUR" })] })).history;
    const c = combine(h);
    expect(c.data.trades.map((t) => t.depot)).toEqual(["TR", "TR", "IBKR U0000000"]);
  });

  test("leere Historie ergibt leere Daten", () => {
    expect(combine(emptyHistory())).toMatchObject({ duplicates: 0, data: { trades: [], dividends: [], unsupported: [] } });
  });
});

describe("Backup als JSON-Datei", () => {
  const history = (): History => {
    const h = add(emptyHistory(), "a.csv", trCsv(t1)).history;
    return { ...h, settings: {
      taxSimpleSince: "2025-05-12",
      brokerInterestKz: "861",
      bufferPct: 20,
      derivativesTreatment: "special",
      otherIncomeEur: "32000",
      reservePlace: "Tagesgeld",
      setupDoneAt: "2026-11-20",
    },
  };
  };

  test("exportieren und wiederherstellen ergibt dieselben Daten und Einstellungen", () => {
    const h = history();
    const json = toBackup(h, NOW);
    expect(JSON.parse(json)).toMatchObject({ app: "KESt-Rücklage", format: 1, exportedAt: NOW });
    expect(fromBackup(json)).toEqual(h);
  });

  test("keine oder kaputte Backup-Datei wird mit deutscher Meldung abgelehnt", () => {
    expect(() => fromBackup("kein json")).toThrow(/kein Backup der KESt-Rücklage/);
    expect(() => fromBackup('{"app":"etwas anderes"}')).toThrow(/kein Backup der KESt-Rücklage/);
    expect(() => fromBackup('{"app":"KESt-Rücklage","format":99,"files":[]}')).toThrow(/neueren Version/);
    expect(() => fromBackup('{"app":"KESt-Rücklage","format":1,"files":[{"name":"a.csv"}]}')).toThrow(/beschädigt/);
  });

  test("Wiederherstellen ergänzt vorhandene Daten, gleiche Dateien nur einmal, Einstellungen aus dem Backup", () => {
    const backup = history();
    const current = add(emptyHistory(), "b.csv", trCsv(t2, t3)).history;
    const r = restoreBackup(current, backup, () => `neu-${++n}`);
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.history.files.map((f) => f.name)).toEqual(["b.csv", "a.csv"]);
    expect(r.history.settings).toEqual(backup.settings);
    expect(restoreBackup(r.history, backup, () => `neu-${++n}`)).toMatchObject({ added: 0, skipped: 1 });
  });

  test("Rücklagen-Ledger (Einträge, Anlage, bezahlte Jahre) ist im Backup enthalten", () => {
    let reserve = addEntry(emptyLedger(), { id: "r1", date: "2026-11-30", valueEur: "3025", place: "Tagesgeld", note: "Nov" });
    reserve = markPaid({ ...reserve, investment: { kind: "moneyMarketFund", reportingFund: "yes", sri: 1 } }, 2025, "2026-06-30");
    const h = { ...history(), reserve };
    expect(fromBackup(toBackup(h, NOW))).toEqual(h);
  });

  test("älteres Backup ohne Rücklagen-Ledger: leerer Ledger", () => {
    const old = JSON.stringify({ app: "KESt-Rücklage", format: 1, exportedAt: NOW, files: [], settings: {} });
    expect(fromBackup(old).reserve).toEqual(emptyLedger());
  });

  test("ungültiger Rücklagen-Eintrag im Backup wird mit deutscher Meldung abgelehnt", () => {
    const bad = JSON.stringify({ app: "KESt-Rücklage", format: 1, exportedAt: NOW, files: [], settings: {}, reserve: { entries: [{ id: "x", date: "gestern", valueEur: "1", place: "", note: "" }] } });
    expect(() => fromBackup(bad)).toThrow(/Rücklagen-Eintrag 1/);
  });

  test("Wiederherstellen ergänzt Rücklagen-Einträge und bezahlte Jahre", () => {
    const current = { ...emptyHistory(), reserve: addEntry(emptyLedger(), { id: "a", date: "2026-10-01", valueEur: "100", place: "", note: "" }) };
    const backup = { ...emptyHistory(), reserve: markPaid(addEntry(emptyLedger(), { id: "b", date: "2026-11-01", valueEur: "200", place: "", note: "" }), 2025, "2026-06-30") };
    const r = restoreBackup(current, backup, () => "neu");
    expect(r.history.reserve.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(r.history.reserve.paidYears).toEqual({ "2025": "2026-06-30" });
  });

  test("älteres Backup ohne Derivate-Einstellung erhält den vorsichtigen Standard (Tarif)", () => {
    const old = JSON.stringify({ app: "KESt-Rücklage", format: 1, exportedAt: NOW, files: [], settings: { taxSimpleSince: "", brokerInterestKz: "863", bufferPct: 10 } });
    expect(fromBackup(old).settings.derivativesTreatment).toBe("tariff");
    expect(fromBackup(old).settings.otherIncomeEur).toBe("");
  });

  test("ungültiges sonstiges Einkommen im Backup wird verworfen statt übernommen", () => {
    const bad = JSON.stringify({ app: "KESt-Rücklage", format: 1, exportedAt: NOW, files: [], settings: { otherIncomeEur: "viel" } });
    expect(fromBackup(bad).settings.otherIncomeEur).toBe("");
  });

  test("Dateien im Backup werden beim Wiederherstellen erneut geprüft", () => {
    const broken = JSON.stringify({ app: "KESt-Rücklage", format: 1, exportedAt: NOW, files: [{ id: "x", name: "x.csv", broker: "IBKR", importedAt: NOW, text: "kaputt" }], settings: {} });
    expect(() => fromBackup(broken)).toThrow(/x\.csv/);
  });
});
