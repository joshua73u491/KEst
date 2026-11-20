import { describe, expect, test } from "vitest";
import { RateTable } from "../src/fx.js";
import { combine, emptyHistory, addFile, filePeriods } from "../src/history.js";
import { isDegiroCsv, parseDegiroCsv, parseDegiroNumber } from "../src/import/degiro.js";
import { parseExport } from "../src/import/readAny.js";
import { checkImport, GUIDES } from "../src/setup.js";
import { computeYear } from "../src/yearReport.js";
import { ACCOUNT_HEADER_EN, dgAccount, dgTransactions, TX_HEADER_EN } from "./helpers/degiroCsv.js";

/**
 * DEGIRO-Import (UMSETZUNG 3.2). Formate: siehe test/helpers/degiroCsv.ts. Steuerliche Behandlung wie bei den anderen
 * Brokern: gleitender Durchschnittspreis, Spesen im 27,5 %-Topf nicht abziehbar, Fremdwährung laut EStR 2000 Rz 6201c.
 */

const buyEur = { date: "15-01-2026", isin: "DE0000000301", quantity: "10", price: "100,00", local: "-1.000,00", valueEur: "-1.000,00" };
const sellEur = { date: "02-03-2026", isin: "DE0000000301", quantity: "-4", price: "130,00", local: "520,00", valueEur: "520,00" };

describe("DEGIRO: Zahlen und Erkennung", () => {
  test("Zahlen im europäischen und im US-Format", () => {
    expect(parseDegiroNumber("1.234,56")?.toString()).toBe("1234.56");
    expect(parseDegiroNumber("1,234.56")?.toString()).toBe("1234.56");
    expect(parseDegiroNumber("-2,00")?.toString()).toBe("-2");
    expect(parseDegiroNumber("41,305")?.toString()).toBe("41.305");
    expect(parseDegiroNumber("1.060.200")?.toString()).toBe("1060200");
    expect(parseDegiroNumber("")).toBeNull();
    expect(parseDegiroNumber("abc")).toBeNull();
  });

  test("Transaktionen und Kontoübersicht werden an ihrem Spaltenlayout erkannt", () => {
    expect(isDegiroCsv(dgTransactions([buyEur]))).toBe(true);
    expect(isDegiroCsv(dgAccount([]))).toBe(true);
    expect(isDegiroCsv('"datetime","date","account_type"\n')).toBe(false);
    expect(parseExport(dgTransactions([buyEur])).broker).toBe("DEGIRO");
  });

  test("unbekanntes DEGIRO-Layout: klare Meldung statt Schätzung", () => {
    const odd = "Date,Time,Product,ISIN,Quantity,Price,Order ID\n15-01-2026,10:00,X,DE0000000301,1,1,o\n";
    expect(() => parseDegiroCsv(odd)).toThrow(/DEGIRO/);
  });
});

describe("DEGIRO: Transaktionen (Transactions.csv)", () => {
  test("Kauf und Teilverkauf in EUR: gleitender Durchschnittspreis, Spesen nicht abziehbar", () => {
    // Kauf 10 Stück für 1.000 € (Ø 100 €), Verkauf 4 Stück für 520 € -> Gewinn 520 − 400 = 120 €; Spesen 2 × 2 € = 4 €
    const data = parseDegiroCsv(dgTransactions([buyEur, sellEur]));
    expect(data.trades.map((t) => [t.side, t.quantity, t.amountEur, t.feeEur, t.date, t.depot])).toEqual([
      ["buy", "10", "1000", "2", "2026-01-15", "DEGIRO"],
      ["sell", "4", "520", "2", "2026-03-02", "DEGIRO"],
    ]);
    const r = computeYear(data, 2026);
    expect(r.kz994.toString()).toBe("120");
    expect(r.feesEur.toString()).toBe("4");
    expect(r.openPositions[0]?.costEur.toString()).toBe("600");
    expect(r.notComputed).toEqual([]);
  });

  test("Fremdwährung mit AutoFX: tatsächliche Konvertierung, es zählt der EUR-Betrag aus dem Export (Rz 6201c)", () => {
    // Kauf 10 Stück für 1.000 USD = 800 € (Ø 80 €), Verkauf 4 Stück für 520 USD = 400 € -> Gewinn 400 − 320 = 80 €
    const usd = { currency: "USD", autoFx: "-2,00" };
    const data = parseDegiroCsv(
      dgTransactions([
        { ...usd, date: "02-03-2026", isin: "US0000000301", quantity: "10", price: "100,00", local: "-1.000,00", valueEur: "-800,00", rate: "1,2500" },
        { ...usd, date: "01-06-2026", isin: "US0000000301", quantity: "-4", price: "130,00", local: "520,00", valueEur: "400,00", rate: "1,3000", autoFx: "-1,00" },
      ]),
    );
    expect(data.trades[0]).toMatchObject({ amountEur: "800", feeEur: "4", originalCurrency: "USD" });
    expect(data.trades[0]?.convert).toBeUndefined();
    expect(computeYear(data, 2026).kz994.toString()).toBe("80");
  });

  test("Fremdwährung ohne AutoFX (Fremdwährungskonto): Umrechnung zum EZB-Kurs am Handelstag", () => {
    // EZB: 02.03.2026 1,25 USD/EUR, 01.06.2026 1,30 USD/EUR -> wie oben 800 € und 400 €, Gewinn 80 €
    const usd = { currency: "USD", autoFx: "" };
    const data = parseDegiroCsv(
      dgTransactions([
        { ...usd, date: "02-03-2026", isin: "US0000000301", quantity: "10", price: "100,00", local: "-1.000,00", valueEur: "-810,00", rate: "1,2345" },
        { ...usd, date: "01-06-2026", isin: "US0000000301", quantity: "-4", price: "130,00", local: "520,00", valueEur: "410,00", rate: "1,2683" },
      ]),
    );
    expect(data.trades[0]?.convert).toMatchObject({ currency: "USD", amount: "1000" });
    const rates = new RateTable([
      ["USD", "2026-03-02", "1.25"],
      ["USD", "2026-06-01", "1.30"],
    ]);
    expect(computeYear(data, 2026, { rates }).kz994.toString()).toBe("80");
    expect(computeYear(data, 2026).notComputed[0]?.reason).toMatch(/EZB-Referenzkurse sind nicht geladen/);
  });

  test("Spaltenköpfe in einer anderen Sprache: Zuordnung nach dem festen Spaltenlayout", () => {
    const other = "Datum,Zeit,Produkt,ISIN,Börse,Ort,Anzahl,Kurs,,Wert lokal,,Wert EUR,Kurs FX,AutoFX,Gebühren EUR,Gesamt EUR,Auftrag";
    const data = parseDegiroCsv(dgTransactions([buyEur, sellEur], other));
    expect(computeYear(data, 2026).kz994.toString()).toBe("120");
  });

  test("Zeile ohne ISIN (z. B. Option oder Future): nicht berechnet", () => {
    const data = parseDegiroCsv(dgTransactions([{ ...buyEur, isin: "", product: "ERF C60 18DEC26" }]));
    expect(data.trades).toEqual([]);
    expect(data.unsupported[0]).toMatchObject({ line: 2, type: "DEGIRO/Transaktion" });
    expect(data.unsupported[0]?.reason).toMatch(/ohne ISIN/);
  });

  test("ungültige Zahl oder ungültiges Datum: gemeldet, spätere Verkäufe derselben Position nicht gerechnet", () => {
    const data = parseDegiroCsv(dgTransactions([{ ...buyEur, quantity: "zehn" }, sellEur]));
    expect(data.unsupported[0]?.affects).toMatchObject({ isin: "DE0000000301", depot: "DEGIRO" });
    const r = computeYear(data, 2026);
    expect(r.realized).toEqual([]);
  });
});

describe("DEGIRO: Kontoübersicht (Account.csv)", () => {
  const rates = new RateTable([["USD", "2026-04-15", "1.20"]]);

  test("US-Dividende mit Dividendensteuer: zusammengeführt, EZB-Kurs am Wertstellungstag", () => {
    // 10 USD / 1,20 = 8,333… €; 1,50 USD / 1,20 = 1,25 €; DBA USA 15 % von 8,333… € = 1,25 € anrechenbar
    const data = parseDegiroCsv(
      dgAccount([
        { date: "16-04-2026", valueDate: "15-04-2026", product: "ERFUNDEN INC", isin: "US0000000301", description: "Dividende", currency: "USD", amount: "10,00" },
        { date: "16-04-2026", valueDate: "15-04-2026", product: "ERFUNDEN INC", isin: "US0000000301", description: "Dividendensteuer", currency: "USD", amount: "-1,50" },
      ]),
    );
    expect(data.dividends).toEqual([
      expect.objectContaining({ isin: "US0000000301", date: "2026-04-15", kind: "stock", originalCurrency: "USD", originalAmount: "10", withheldOriginal: "1.5", depot: "DEGIRO" }),
    ]);
    const r = computeYear(data, 2026, { rates });
    expect(r.kz863.toDecimalPlaces(4).toString()).toBe("8.3333");
    expect(r.kz998.toString()).toBe("1.25");
  });

  test("englische Beschreibungen und Dividende in EUR", () => {
    const data = parseDegiroCsv(
      dgAccount(
        [
          { date: "20-04-2026", isin: "DE0000000301", description: "Dividend", amount: "20,00" },
          { date: "20-04-2026", isin: "DE0000000301", description: "Dividend Tax", amount: "-5,28" },
        ],
        ACCOUNT_HEADER_EN,
      ),
    );
    expect(data.dividends[0]).toMatchObject({ grossEur: "20", withheldEur: "5.28", originalCurrency: "" });
  });

  test("Fondsausschüttung und Kapitalrückzahlung werden erkannt (wie bei Trade Republic nicht berechnet)", () => {
    const data = parseDegiroCsv(
      dgAccount([
        { date: "01-06-2026", isin: "IE0000000301", description: "Fondsausschüttung", amount: "3,00" },
        { date: "02-06-2026", isin: "NO0000000301", description: "Kapitalrückzahlung", amount: "4,00" },
      ]),
    );
    expect(data.dividends.map((d) => [d.isin, d.kind])).toEqual([
      ["IE0000000301", "fund"],
      ["NO0000000301", "capitalDistribution"],
    ]);
  });

  test("Zinsen auf dem Geldkonto (flatex): KZ 861 wie bei Trade Republic; Sollzinsen ohne Bedeutung", () => {
    const data = parseDegiroCsv(
      dgAccount([
        { date: "01-07-2026", description: "Flatex Interest Income", amount: "4,00" },
        { date: "01-08-2026", description: "Flatex Interest", amount: "-0,50" },
      ]),
    );
    expect(data.interest).toEqual([expect.objectContaining({ date: "2026-07-01", source: "bank", amountEur: "4", depot: "DEGIRO" })]);
    expect(computeYear(data, 2026).kz861.toString()).toBe("4");
  });

  test("Käufe, Gebühren, Einzahlungen und Währungswechsel stehen in der Kontoübersicht doppelt bzw. sind ohne Bedeutung", () => {
    const data = parseDegiroCsv(
      dgAccount([
        { date: "15-01-2026", isin: "DE0000000301", description: "Kauf 10 Erfunden AG@100 EUR (DE0000000301)", amount: "-1.000,00" },
        { date: "15-01-2026", isin: "DE0000000301", description: "DEGIRO Transaktionsgebühr", amount: "-2,00" },
        { date: "10-01-2026", description: "Einzahlung", amount: "2.000,00" },
        { date: "02-03-2026", description: "Währungswechsel (Ausbuchung)", currency: "USD", amount: "-10,00" },
      ]),
    );
    expect(data.trades).toEqual([]);
    expect(data.unsupported).toEqual([]);
  });

  test("unbekannte Buchung zu einem Wertpapier (z. B. Aktiensplit) wird gemeldet; spätere Verkäufe werden nicht gerechnet", () => {
    const data = parseDegiroCsv(dgAccount([{ date: "05-05-2026", isin: "DE0000000301", description: "Aktiensplit", amount: "0,00" }]));
    expect(data.unsupported).toEqual([
      {
        line: 2,
        type: "DEGIRO/Kontoübersicht",
        reason: "Buchung „Aktiensplit“ zu DE0000000301 wird nicht zugeordnet. Bitte prüfen.",
        affects: { isin: "DE0000000301", depot: "DEGIRO", datetime: "2026-05-05T07:30:00" },
      },
    ]);
  });

  test("Dividendensteuer ohne Dividende am selben Tag wird gemeldet", () => {
    const data = parseDegiroCsv(dgAccount([{ date: "15-04-2026", isin: "US0000000301", description: "Dividendensteuer", currency: "USD", amount: "-1,50" }]));
    expect(data.dividends).toEqual([]);
    expect(data.unsupported[0]?.reason).toMatch(/ohne Dividende/);
  });

  test("umgebrochene Beschreibung in der Folgezeile wird angehängt", () => {
    const data = parseDegiroCsv(
      dgAccount([
        { date: "20-04-2026", isin: "DE0000000301", description: "Dividend", amount: "20,00" },
        { date: "20-04-2026", isin: "DE0000000301", description: "Dividendens", amount: "-5,28" },
        { wrap: "teuer" },
      ]),
    );
    expect(data.dividends[0]).toMatchObject({ grossEur: "20", withheldEur: "5.28" });
    expect(data.unsupported).toEqual([]);
  });
});

describe("DEGIRO in Historie und Einrichtung", () => {
  test("überlappende Exporte: gleiche Zeilen zählen nur einmal", () => {
    let h = emptyHistory();
    h = addFile(h, "2026a.csv", dgTransactions([buyEur]), "2026-11-20T10:00:00Z", "a").history;
    h = addFile(h, "2026b.csv", dgTransactions([buyEur, sellEur]), "2026-11-20T10:00:00Z", "b").history;
    h = addFile(h, "konto.csv", dgAccount([{ date: "20-04-2026", isin: "DE0000000301", description: "Dividende", amount: "20,00" }]), "2026-11-20T10:00:00Z", "c").history;
    const c = combine(h);
    expect(c.duplicates).toBe(1);
    expect(c.data.trades).toHaveLength(2);
    expect(c.data.dividends).toHaveLength(1);
    expect(filePeriods(h).map((p) => [p.depot, p.file, p.from, p.to])).toEqual([
      ["DEGIRO", "2026a.csv", "2026-01-15", "2026-01-15"],
      ["DEGIRO", "2026b.csv", "2026-01-15", "2026-03-02"],
      ["DEGIRO", "konto.csv", "2026-04-20", "2026-04-20"],
    ]);
  });

  test("Einrichtung: Anleitung für beide Dateien und Sofortprüfung", () => {
    expect(GUIDES.degiro.checklist.join(" ")).toMatch(/Transaktionen.*Kontoübersicht/);
    const c = checkImport(dgTransactions([buyEur, sellEur]), "degiro");
    expect(c).toMatchObject({ ok: true, broker: "DEGIRO", notes: [] });
    expect(c.summary.trades).toBe(2);
  });

  test("englische Kopfzeile der Transaktionen bleibt erhalten (Kontrolle des Testformats)", () => {
    expect(dgTransactions([]).split("\n")[0]).toBe(TX_HEADER_EN);
  });
});
