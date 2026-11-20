import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { emptyHistory, fromBackup, toBackup } from "../src/history.js";
import { applySetup, checkImport, GUIDES, type SetupAnswers } from "../src/setup.js";
import { ibkrXml, ibOption, ibOptionBook } from "./helpers/ibkrXml.js";
import { trade, trCsv } from "./helpers/trCsv.js";

const sample = readFileSync(new URL("./fixtures/tr-beispiel.csv", import.meta.url), "utf8");

describe("Anleitungen zum Export je Broker", () => {
  test("jede Anleitung hat Schritte, Platz für Screenshots und eine Quelle", () => {
    for (const g of Object.values(GUIDES)) {
      expect(g.steps.length).toBeGreaterThanOrEqual(3);
      expect(g.steps.every((s) => s.text.length > 0 && s.shot.length > 0)).toBe(true);
      expect(g.sources.length).toBeGreaterThan(0);
      for (const s of g.sources) expect(s.url).toMatch(/^https:\/\//);
    }
  });

  test("IBKR: Checkliste der nötigen Abschnitte und Einstellungen der Flex Query", () => {
    const list = GUIDES.ibkr.checklist.join(" ");
    for (const s of ["Trades", "Executions", "Cash Transactions", "Open Positions", "XML", "yyyyMMdd"]) expect(list).toContain(s);
  });
});

describe("Sofortprüfung der Datei", () => {
  test("Trade-Republic-Export: Broker, Umfang und Zeitraum", () => {
    const c = checkImport(sample, "tr");
    expect(c.ok).toBe(true);
    expect(c.broker).toBe("Trade Republic");
    expect(c.problems).toEqual([]);
    expect(c.notes).toEqual([]);
    // Beispieldatei: 5 Käufe, 5 Verkäufe, 1 Zinsbuchung, keine Dividende; steuerlich relevante Buchungen vom
    // 01.12.2025 bis 01.08.2026 (die Zeile vom 01.09.2026 hat einen unbekannten Buchungstyp und zählt nicht)
    expect(c.summary).toMatchObject({ trades: 10, dividends: 0, interest: 1, from: "2025-12-01", to: "2026-08-01", hasDerivatives: false });
  });

  test("anderer Broker als gewählt: Hinweis, die Datei wird trotzdem gelesen", () => {
    const c = checkImport(sample, "ibkr");
    expect(c.ok).toBe(true);
    expect(c.notes).toEqual(["Die Datei ist ein Export von Trade Republic, gewählt war IBKR."]);
  });

  test("IBKR-Flex-Query ohne Cash Transactions: die App sagt konkret, was fehlt", () => {
    const c = checkImport(ibkrXml({ cash: null }), "ibkr");
    expect(c.ok).toBe(false);
    expect(c.broker).toBeNull();
    expect(c.problems[0]).toMatch(/Abschnitt CashTransactions fehlt/);
  });

  test("leere Datei: Fehler statt leerem Ergebnis", () => {
    const c = checkImport("", "tr");
    expect(c.ok).toBe(false);
    expect(c.problems[0]).toMatch(/leer/);
  });

  test("Optionen in der Datei werden erkannt (für die Frage nach Optionen und Futures)", () => {
    const c = checkImport(ibkrXml({ trades: [ibOption("SELL", "20260301", "ERF P50", "1", "200"), ibOptionBook("BUY", "20261218", "ERF P50", "1")] }), "ibkr");
    expect(c.ok).toBe(true);
    expect(c.summary.hasDerivatives).toBe(true);
  });

  test("Fehler des Prüfassistenten werden gezählt (Verkauf ohne Kauf)", () => {
    const c = checkImport(trCsv(trade("SELL", "2026-03-02T10:00:00.000Z", "US0000000002", "2", "50.00")), "tr");
    expect(c.ok).toBe(true);
    expect(c.summary.errors).toBe(1);
  });
});

describe("Die drei Fragen der Einrichtung", () => {
  const answers = (over: Partial<SetupAnswers> = {}): SetupAnswers => ({
    derivatives: true,
    otherIncomeEur: "30000",
    reservePlace: "Tagesgeld Hausbank",
    bufferPct: 15,
    taxSimpleSince: "",
    ...over,
  });

  test("mit Optionen oder Futures: Einkommen, Ort der Rücklage und Puffer werden übernommen", () => {
    const h = applySetup(emptyHistory(), answers(), "2026-11-20");
    expect(h.settings).toMatchObject({ otherIncomeEur: "30000", reservePlace: "Tagesgeld Hausbank", bufferPct: 15, setupDoneAt: "2026-11-20" });
  });

  test("ohne Optionen und Futures wird kein sonstiges Einkommen gespeichert", () => {
    expect(applySetup(emptyHistory(), answers({ derivatives: false }), "2026-11-20").settings.otherIncomeEur).toBe("");
  });

  test("Einkommen darf leer bleiben (weiß ich nicht): dann keine Schätzung", () => {
    expect(applySetup(emptyHistory(), answers({ otherIncomeEur: " " }), "2026-11-20").settings.otherIncomeEur).toBe("");
  });

  test("Trade Republic steuereinfach: Datum wird übernommen", () => {
    expect(applySetup(emptyHistory(), answers({ taxSimpleSince: "2025-06-01" }), "2026-11-20").settings.taxSimpleSince).toBe("2025-06-01");
  });

  test("ungültige Angaben werden mit deutscher Meldung abgelehnt", () => {
    expect(() => applySetup(emptyHistory(), answers({ bufferPct: -5 }), "2026-11-20")).toThrow(/Sicherheitspuffer/);
    expect(() => applySetup(emptyHistory(), answers({ otherIncomeEur: "dreißigtausend" }), "2026-11-20")).toThrow(/sonstige Einkommen/);
    expect(() => applySetup(emptyHistory(), answers({ taxSimpleSince: "1.5.2026" }), "2026-11-20")).toThrow(/steuereinfach/);
  });

  test("Antworten sind im Backup enthalten; ältere Backups ohne sie bekommen Standardwerte", () => {
    const h = applySetup(emptyHistory(), answers(), "2026-11-20");
    expect(fromBackup(toBackup(h, "2026-11-20T10:00:00Z")).settings).toEqual(h.settings);
    const old = JSON.stringify({ app: "KESt-Rücklage", format: 1, exportedAt: "x", files: [], settings: { bufferPct: 10 } });
    expect(fromBackup(old).settings).toMatchObject({ reservePlace: "", setupDoneAt: "" });
  });
});
