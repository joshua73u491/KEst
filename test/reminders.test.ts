import { describe, expect, test } from "vitest";
import { dec } from "../src/decimal.js";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { addEntry, emptyLedger, reserveStatus, type YearSoll } from "../src/ledger.js";
import {
  declarationDeadline,
  DECLARATION_SOURCE,
  reminders,
  yearFigures,
  type ReminderInput,
  type YearFigures,
} from "../src/reminders.js";
import { computeYear } from "../src/yearReport.js";
import { trade, trCsv } from "./helpers/trCsv.js";

/** Neutraler Stichtag: kein November/Dezember, keine Frist offen (Vorjahr ohne Angabe). */
const input = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  today: "2026-06-15",
  reserve: null,
  lastImportAt: null,
  currentYear: null,
  previousYear: null,
  paidYears: {},
  ...over,
});

const fig = (gains: string, losses: string, unused = "0", hasDeclarationAmounts = true): YearFigures => ({
  gainsEur: dec(gains),
  lossesEur: dec(losses),
  unusedLossEur: dec(unused),
  hasDeclarationAmounts,
});

/** Rücklage zum Stichtag: Soll 2026 wie angegeben, Ist als ein Eintrag vom 01.11.2026 (oder keiner). */
function reserve(soll: string, ist: string | null, complete = true, today = "2026-11-20") {
  const years: YearSoll[] = [{ year: 2026, sollEur: dec(soll), peakEur: dec(soll), complete }];
  const ledger = ist === null ? emptyLedger() : addEntry(emptyLedger(), { id: "a", date: "2026-11-01", valueEur: ist, place: "Tagesgeld", note: "" });
  return reserveStatus(years, ledger, today);
}

const codes = (i: ReminderInput) => reminders(i).map((r) => r.code);

describe("Frist der Steuererklärung laut BMF", () => {
  test("Papier bis 30. April, FinanzOnline bis 30. Juni des Folgejahres (§ 134 Abs 1 BAO)", () => {
    // Quelle: BMF, Einkommensteuererklärung und Einkommensteuerveranlagung, Abschnitt „Erklärungsfrist“
    expect(declarationDeadline(2026)).toEqual({ paper: "2027-04-30", electronic: "2027-06-30" });
    expect(DECLARATION_SOURCE.url).toMatch(/^https:\/\/www\.bmf\.gv\.at\//);
  });
});

describe("Fehlbetrag in der Rücklage", () => {
  test("weniger zurückgelegt als nötig: Warnung mit Fehlbetrag und Soll", () => {
    // Soll 3.025 €, Ist 1.000 € -> es fehlen 2.025 €
    const [r] = reminders(input({ today: "2026-11-20", reserve: reserve("3025", "1000") }));
    expect(r?.code).toBe("reserve-shortfall");
    expect(r?.severity).toBe("warning");
    expect(r?.text).toContain("2.025,00 €");
    expect(r?.text).toContain("3.025,00 €");
    expect(r?.text).toContain("01.11.2026");
  });

  test("kein Stand eingetragen, aber ein Soll: Warnung", () => {
    const [r] = reminders(input({ today: "2026-11-20", reserve: reserve("3025", null) }));
    expect(r?.code).toBe("reserve-missing");
    expect(r?.severity).toBe("warning");
    expect(r?.text).toContain("3.025,00 €");
  });

  test("Soll gedeckt oder kein Soll: kein Hinweis", () => {
    expect(codes(input({ today: "2026-11-20", reserve: reserve("3025", "3025") }))).toEqual([]);
    expect(codes(input({ today: "2026-11-20", reserve: reserve("0", null) }))).toEqual([]);
    // Fehlbetrag unter einem Cent zählt nicht
    expect(codes(input({ today: "2026-11-20", reserve: reserve("3025.004", "3025") }))).toEqual([]);
  });

  test("Soll unvollständig berechnet: der Hinweis sagt, dass es höher sein kann", () => {
    const [r] = reminders(input({ today: "2026-11-20", reserve: reserve("3025", "1000", false) }));
    expect(r?.text).toMatch(/kann höher sein/);
  });
});

describe("Letzter Import älter als 30 Tage", () => {
  test("genau 30 Tage: noch kein Hinweis, ab 31 Tagen Warnung", () => {
    const lastImportAt = "2026-10-21T08:00:00.000Z";
    expect(codes(input({ today: "2026-11-20", lastImportAt }))).toEqual([]);
    const [r] = reminders(input({ today: "2026-11-21", lastImportAt }));
    expect(r?.code).toBe("import-old");
    expect(r?.severity).toBe("warning");
    expect(r?.text).toContain("21.10.2026");
    expect(r?.text).toContain("31 Tagen");
  });

  test("ohne gespeicherte Datei kein Hinweis", () => {
    expect(codes(input({ today: "2027-03-01" }))).toEqual([]);
  });
});

describe("November und Dezember: Verluste gleichen nur im laufenden Jahr aus", () => {
  const currentYear = fig("2000", "800");

  test("nur vom 1. November bis 31. Dezember", () => {
    expect(codes(input({ today: "2026-10-31", currentYear }))).toEqual([]);
    expect(codes(input({ today: "2026-11-01", currentYear }))).toEqual(["loss-offset"]);
    expect(codes(input({ today: "2026-12-31", currentYear }))).toEqual(["loss-offset"]);
    expect(codes(input({ today: "2027-01-01", currentYear }))).toEqual([]);
  });

  test("Hinweis mit dem Stand des Jahres, ohne Empfehlung", () => {
    const [r] = reminders(input({ today: "2026-11-20", currentYear }));
    expect(r?.severity).toBe("info");
    expect(r?.text).toMatch(/nur im selben Kalenderjahr/);
    expect(r?.text).toContain("2.000,00 €");
    expect(r?.text).toContain("800,00 €");
    expect(r?.text).not.toMatch(/verfällt/);
  });

  test("nicht ausgeglichener Verlust: Hinweis, dass er am 31.12. verfällt", () => {
    const [r] = reminders(input({ today: "2026-11-20", currentYear: fig("0", "800", "800") }));
    expect(r?.text).toMatch(/Nicht ausgeglichen: 800,00 €.*verfällt am 31\.12\.2026/);
  });

  test("ohne Gewinne und Verluste im Jahr kein Hinweis", () => {
    expect(codes(input({ today: "2026-11-20", currentYear: fig("0", "0") }))).toEqual([]);
  });
});

describe("Frist der Steuererklärung für das Vorjahr", () => {
  const previousYear = fig("2000", "0");

  test("ab 1. Jänner als Hinweis mit beiden Fristen und BMF-Link", () => {
    const [r] = reminders(input({ today: "2027-01-02", previousYear }));
    expect(r?.code).toBe("deadline");
    expect(r?.severity).toBe("info");
    expect(r?.text).toContain("2026");
    expect(r?.text).toContain("30.06.2027");
    expect(r?.text).toContain("30.04.2027");
    expect(r?.source).toEqual(DECLARATION_SOURCE);
  });

  test("in den letzten 30 Tagen vor dem 30. Juni als Warnung, danach nicht mehr", () => {
    expect(reminders(input({ today: "2027-05-30", previousYear }))[0]?.severity).toBe("info"); // 31 Tage
    expect(reminders(input({ today: "2027-05-31", previousYear }))[0]?.severity).toBe("warning"); // 30 Tage
    expect(reminders(input({ today: "2027-06-30", previousYear }))[0]?.severity).toBe("warning");
    expect(codes(input({ today: "2027-07-01", previousYear }))).toEqual([]);
  });

  test("kein Hinweis, wenn die Steuer für das Jahr als bezahlt markiert ist oder nichts zu erklären ist", () => {
    expect(codes(input({ today: "2027-02-01", previousYear, paidYears: { "2026": "2027-01-20" } }))).toEqual([]);
    expect(codes(input({ today: "2027-02-01", previousYear: fig("0", "0", "0", false) }))).toEqual([]);
  });
});

describe("Reihenfolge und Texte", () => {
  test("Warnungen zuerst, dann Hinweise", () => {
    const all = reminders(
      input({
        today: "2026-12-10",
        reserve: reserve("3025", "1000", true, "2026-12-10"),
        lastImportAt: "2026-10-01T08:00:00.000Z",
        currentYear: fig("2000", "800"),
      }),
    );
    expect(all.map((r) => r.code)).toEqual(["reserve-shortfall", "import-old", "loss-offset"]);
  });

  test("kein Text empfiehlt eine Anlage, einen Verkauf oder eine Steuergestaltung", () => {
    const all = [
      ...reminders(input({ today: "2026-12-10", reserve: reserve("3025", "1000", false, "2026-12-10"), lastImportAt: "2026-01-01T00:00:00Z", currentYear: fig("100", "900", "800") })),
      ...reminders(input({ today: "2026-12-10", reserve: reserve("3025", null, true, "2026-12-10") })),
      ...reminders(input({ today: "2027-06-20", previousYear: fig("1", "0") })),
    ];
    expect(all.length).toBe(5);
    for (const r of all) expect(r.text).not.toMatch(/empfehl|solltest|verkauf|realisier|kaufe|nutze/i);
  });

  test("ungültiger Stichtag wird abgelehnt", () => {
    expect(() => reminders(input({ today: "20.11.2026" }))).toThrow(/Stichtag/);
  });
});

describe("Kennzahlen eines Jahres für die Erinnerungen", () => {
  const data = parseTradeRepublicCsv(
    trCsv(
      trade("BUY", "2026-01-10T10:00:00.000Z", "DE000ERF0001", "10", "1000"),
      trade("SELL", "2026-03-10T10:00:00.000Z", "DE000ERF0001", "10", "3000"),
      trade("BUY", "2026-04-01T10:00:00.000Z", "DE000ERF0002", "10", "1000"),
      trade("SELL", "2026-10-01T10:00:00.000Z", "DE000ERF0002", "10", "200"),
    ),
  );

  test("Überschüsse, Verluste und Kennzahlen für die E1kv", () => {
    // Gewinn 3.000 − 1.000 = 2.000 €, Verlust 1.000 − 200 = 800 €, voll ausgeglichen
    const f = yearFigures(computeYear(data, 2026));
    expect(f.gainsEur.toString()).toBe("2000");
    expect(f.lossesEur.toString()).toBe("800");
    expect(f.unusedLossEur.toString()).toBe("0");
    expect(f.hasDeclarationAmounts).toBe(true);
  });

  test("vor dem ersten Verkauf nichts zu erklären; nur ein Verlust bleibt unausgeglichen", () => {
    // bis 09.03.2026 ist noch nichts verkauft
    expect(yearFigures(computeYear(data, 2026, { asOf: "2026-03-09" })).hasDeclarationAmounts).toBe(false);
    const onlyLoss = parseTradeRepublicCsv(
      trCsv(
        trade("BUY", "2026-04-01T10:00:00.000Z", "DE000ERF0002", "10", "1000"),
        trade("SELL", "2026-10-01T10:00:00.000Z", "DE000ERF0002", "10", "200"),
      ),
    );
    expect(yearFigures(computeYear(onlyLoss, 2026)).unusedLossEur.toString()).toBe("800");
  });

  test("Jahr ohne Buchungen: nichts zu erklären", () => {
    const f = yearFigures(computeYear(data, 2025));
    expect(f.hasDeclarationAmounts).toBe(false);
    expect(f.gainsEur.toString()).toBe("0");
  });
});
