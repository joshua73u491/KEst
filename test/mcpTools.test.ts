import { describe, expect, test } from "vitest";
import { emptyHistory, fromBackup, toBackup, type History } from "../src/history.js";
import { createTools, type ToolStore } from "../src/mcp/tools.js";
import { dividend, trade, trCsv } from "./helpers/trCsv.js";

/**
 * MCP-Add-on (PRODUKTPLAN „Funktionen“, Phase 5): dieselben Funktionen wie die App, als Werkzeuge für Claude.
 * Alles rechnet oder liest lokal; die Historie liegt in derselben Form wie das Backup der Web-App.
 */

const csv = trCsv(
  trade("BUY", "2026-01-15T10:00:00.000Z", "DE0000000301", "10", "1000.00"),
  trade("SELL", "2026-03-02T10:00:00.000Z", "DE0000000301", "4", "520.00"),
  dividend("2026-04-15T00:00:00.000000Z", "DE0000000001", "100.00", "-26.38"),
);

function memStore(files: Record<string, string> = {}) {
  let saved = toBackup(emptyHistory(), "2026-11-21T00:00:00Z");
  const written: Record<string, string | Uint8Array> = {};
  const store: ToolStore = {
    load: () => fromBackup(saved),
    save: (h: History) => {
      saved = toBackup(h, "2026-11-21T00:00:00Z");
    },
    readFile: (p) => {
      const f = files[p];
      if (f === undefined) throw new Error(`Datei nicht gefunden: ${p}`);
      return f;
    },
    writeFile: (p, d) => {
      written[p] = d;
    },
    today: () => "2026-11-21",
    now: () => "2026-11-21T10:00:00Z",
    rates: async () => null,
  };
  return { store, written, history: () => fromBackup(saved) };
}

describe("Werkzeuge des MCP-Add-ons", () => {
  test("Liste: jede Funktion des PRODUKTPLANs, mit deutscher Beschreibung", () => {
    const names = createTools(memStore().store).map((t) => t.name);
    for (const n of ["import_file", "compute_tax_ytd", "get_reserve_status", "book_reserve", "simulate_sale", "check_order_against_reserve", "review_findings", "get_cost_basis", "list_transactions", "generate_e1kv_report", "set_config"]) {
      expect(names).toContain(n);
    }
    for (const t of createTools(memStore().store)) expect(t.description).toMatch(/[äöüÄÖÜß]|\b(der|die|das|den|des|ein|eine|und|mit)\b/);
  });

  const tool = (store: ToolStore, name: string) => createTools(store).find((t) => t.name === name)!;

  test("import_file speichert eine Exportdatei in der Historie", async () => {
    const m = memStore({ "C:/export.csv": csv });
    const r = await tool(m.store, "import_file").run({ path: "C:/export.csv" });
    expect(r.text).toMatch(/gespeichert \(Trade Republic\)/);
    expect(m.history().files.map((f) => f.name)).toEqual(["export.csv"]);
    expect((await tool(m.store, "import_file").run({ path: "C:/export.csv" })).text).toMatch(/bereits gespeichert/);
  });

  test("compute_tax_ytd: Kennzahlen, Steuer und Soll des Jahres", async () => {
    const m = memStore({ "e.csv": csv });
    await tool(m.store, "import_file").run({ path: "e.csv" });
    const r = await tool(m.store, "compute_tax_ytd").run({ year: 2026 });
    // Gewinn 120 €, Dividende 100 € mit 15 € anrechenbarer Quellensteuer: 27,5 % von 220 € = 60,50 € − 15 € = 45,50 €
    expect(r.data).toMatchObject({ year: 2026, kz: { "994": "120", "863": "100", "998": "15" }, tax275Eur: "45.5", sollEur: "50.05" });
    expect(r.text).toMatch(/Berechnungstool, keine Steuerberatung/);
  });

  test("Rücklage eintragen und Status abfragen (Soll gegen Ist)", async () => {
    const m = memStore({ "e.csv": csv });
    await tool(m.store, "import_file").run({ path: "e.csv" });
    await tool(m.store, "book_reserve").run({ value_eur: "30", place: "Tagesgeld" });
    const r = await tool(m.store, "get_reserve_status").run({});
    expect(r.data).toMatchObject({ sollEur: "50.05", istEur: "30", shortfallEur: "20.05" });
    expect(m.history().reserve.entries[0]).toMatchObject({ date: "2026-11-21", valueEur: "30", place: "Tagesgeld" });
  });

  test("simulate_sale und check_order_against_reserve rechnen wie die App", async () => {
    const m = memStore({ "e.csv": csv });
    await tool(m.store, "import_file").run({ path: "e.csv" });
    const s = await tool(m.store, "simulate_sale").run({ isin: "DE0000000301", quantity: "6", price_eur: "90" });
    // Rest 6 Stück zu Ø 100 €, Verkauf zu 90 € -> Verlust 60 € -> Steuer 27,5 % von 160 € = 44 € − 15 € = 29 € (−16,50 €)
    expect(s.data).toMatchObject({ gainEur: "-60", taxChangeEur: "-16.5" });
    const c = await tool(m.store, "check_order_against_reserve").run({ cash_eur: "100", order_eur: "80", reserve_in_account: false });
    expect(c.data).toMatchObject({ mustKeepEur: "50.05", enough: false, missingEur: "30.05" });
  });

  test("simulate_sale ohne Depot: eindeutig wählen oder nachfragen", async () => {
    const m = memStore({ "e.csv": csv });
    await tool(m.store, "import_file").run({ path: "e.csv" });
    await expect(tool(m.store, "simulate_sale").run({ isin: "XX0000000000", quantity: "1", price_eur: "1" })).rejects.toThrow(/keine offene Position/);
  });

  test("Positionen, Buchungen und Prüfassistent", async () => {
    const m = memStore({ "e.csv": csv });
    await tool(m.store, "import_file").run({ path: "e.csv" });
    expect((await tool(m.store, "get_cost_basis").run({})).data).toEqual([{ isin: "DE0000000301", depot: "TR", quantity: "6", avgPriceEur: "100", costEur: "600" }]);
    const tx = (await tool(m.store, "list_transactions").run({ year: 2026 })).data as { trades: unknown[]; dividends: unknown[] };
    expect(tx.trades).toHaveLength(2);
    expect(tx.dividends).toHaveLength(1);
    expect(Array.isArray((await tool(m.store, "review_findings").run({})).data)).toBe(true);
  });

  test("set_config ändert Einstellungen mit Prüfung; der Bericht wird als Datei geschrieben", async () => {
    const m = memStore({ "e.csv": csv });
    await tool(m.store, "import_file").run({ path: "e.csv" });
    await tool(m.store, "set_config").run({ buffer_pct: 20, derivatives_treatment: "special" });
    expect(m.history().settings).toMatchObject({ bufferPct: 20, derivativesTreatment: "special" });
    await expect(tool(m.store, "set_config").run({ buffer_pct: -1 })).rejects.toThrow(/Sicherheitspuffer/);
    const r = await tool(m.store, "generate_e1kv_report").run({ year: 2026, pdf_path: "out.pdf", csv_path: "out.csv" });
    expect(r.text).toMatch(/out\.pdf/);
    expect(String.fromCharCode(...(m.written["out.pdf"] as Uint8Array).subarray(0, 8))).toBe("%PDF-1.4");
    expect(String(m.written["out.csv"])).toContain("KZ 994;Überschüsse aus Wertpapieren;120,00");
  });

  test("kein Werkzeug empfiehlt etwas", async () => {
    for (const t of createTools(memStore().store)) expect(t.description).not.toMatch(/(?<!keine )empfehl|solltest|kaufe |verkaufe /i);
  });
});
