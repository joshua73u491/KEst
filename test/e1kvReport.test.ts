import { describe, expect, test } from "vitest";
import { buildE1kvDocument, e1kvCsv, e1kvPdf, winAnsi } from "../src/e1kvReport.js";
import { DEFAULT_SETTINGS } from "../src/history.js";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { RULES_VERSION } from "../src/rules.js";
import { computeYear } from "../src/yearReport.js";
import { dividend, interest, trade, trCsv } from "./helpers/trCsv.js";

/**
 * E1kv-Bericht als PDF und CSV (UMSETZUNG 3.4): Kennzahlen, Belegliste, Regelversion, sichtbarer Hinweis
 * „Berechnungstool, keine Steuerberatung“. Beispiel: Gewinn 120 €, Verlust 20 €, deutsche Dividende 100 € mit 26,38 €
 * Quellensteuer (anrechenbar 15 €), Zinsen 2 €.
 */
const data = parseTradeRepublicCsv(
  trCsv(
    trade("BUY", "2026-01-15T10:00:00.000Z", "DE0000000301", "10", "1000.00"),
    trade("SELL", "2026-03-02T10:00:00.000Z", "DE0000000301", "4", "520.00"),
    trade("BUY", "2026-04-01T10:00:00.000Z", "DE0000000302", "1", "100.00"),
    trade("SELL", "2026-05-02T10:00:00.000Z", "DE0000000302", "1", "80.00"),
    dividend("2026-04-15T00:00:00.000000Z", "DE0000000001", "100.00", "-26.38"),
    interest("2026-07-01T00:00:00.000000Z", "2.00"),
  ),
  "export.csv",
);
const report = computeYear(data, 2026);
const doc = buildE1kvDocument(report, { createdAt: "2026-11-20", files: ["export.csv"], settings: { ...DEFAULT_SETTINGS } });

describe("Inhalt des Berichts", () => {
  test("Kennzahlen wie in der App, Verluste als positiver Betrag", () => {
    const kz = Object.fromEntries(doc.kz.map((k) => [k.kz, k.amountEur.toString()]));
    expect(kz).toMatchObject({ "994": "120", "892": "20", "863": "100", "998": "15", "861": "2" });
  });

  test("Hinweis, Regelversion und Erstellungsdatum stehen im Kopf", () => {
    expect(doc.disclaimer).toMatch(/^Berechnungstool, keine Steuerberatung\./);
    expect(doc.meta).toContainEqual(["Regelversion", RULES_VERSION]);
    expect(doc.meta).toContainEqual(["Erstellt am", "20.11.2026"]);
    expect(doc.meta).toContainEqual(["Steuerjahr", "2026"]);
  });

  test("Belegliste: jeder Verkauf, jede Dividende und jede Zinsbuchung mit Kennzahl und Fundstelle", () => {
    expect(doc.belege.map((b) => [b.date, b.art, b.kz, b.amountEur.toString(), b.source])).toEqual([
      ["2026-03-02", "Verkauf", "994", "120", "export.csv, Zeile 3"],
      ["2026-04-15", "Dividende", "863", "100", "export.csv, Zeile 6"],
      ["2026-05-02", "Verkauf", "892", "-20", "export.csv, Zeile 5"],
      ["2026-07-01", "Zinsen", "861", "2", "export.csv, Zeile 7"],
    ]);
    expect(doc.belege[1]?.withheldEur?.toString()).toBe("26.38");
  });

  test("Einstellungen, die das Ergebnis beeinflussen, stehen im Bericht", () => {
    expect(doc.settings.join(" ")).toMatch(/Optionen\/Futures: Tarif \(KZ 857\)/);
    expect(doc.settings.join(" ")).toMatch(/Sicherheitspuffer: 10 %/);
  });

  test("Steuer und Soll: 27,5 % von 200 € = 55 € minus 15 € Quellensteuer = 40 €, 25 % von 2 € = 0,50 €", () => {
    const s = Object.fromEntries(doc.summary.map(([l, v]) => [l, v.toString()]));
    expect(s["Steuer 27,5 % (nach Anrechnung der Quellensteuer)"]).toBe("40");
    expect(s["Steuer 25 % auf Zinsen"]).toBe("0.5");
    expect(s["Soll-Rücklage mit 10 % Puffer"]).toBe("44.55");
  });
});

describe("CSV für Excel", () => {
  const csv = e1kvCsv(doc);
  test("UTF-8 mit BOM, Strichpunkt als Trenner, Dezimalkomma, Datum TT.MM.JJJJ", () => {
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Hinweis;Berechnungstool, keine Steuerberatung.");
    expect(csv).toContain(`Regelversion;${RULES_VERSION}`);
    expect(csv).toContain("KZ 994;Überschüsse aus Wertpapieren;120,00");
    expect(csv).toContain("02.03.2026;Verkauf;994;DE0000000301;Erfunden DE0000000301;120,00;;export.csv, Zeile 3");
    expect(csv).toContain("15.04.2026;Dividende;863;DE0000000001;Erfunden DE0000000001;100,00;26,38;export.csv, Zeile 6");
  });

  test("Felder mit Strichpunkt oder Anführungszeichen werden in Anführungszeichen gesetzt", () => {
    const d = { ...doc, belege: [{ ...doc.belege[0]!, name: 'A;B "C"' }] };
    expect(e1kvCsv(d)).toContain(';"A;B ""C""";');
  });
});

describe("PDF", () => {
  const ascii = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const hex = (s: string) => Array.from(winAnsi(s), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");

  test("Umlaute und Eurozeichen in WinAnsi", () => {
    expect(Array.from(winAnsi("äöüß€„“"))).toEqual([0xe4, 0xf6, 0xfc, 0xdf, 0x80, 0x84, 0x93]);
    expect(Array.from(winAnsi("−→"))).toEqual([0x2d, 0x3f]);
  });

  test("gültiger Aufbau: Kopf, Querverweise mit richtigen Positionen, Ende", () => {
    const pdf = ascii(e1kvPdf(doc));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const entries = pdf.slice(startxref).split("\n").slice(3).filter((l) => / 00000 n $/.test(l));
    entries.forEach((e, i) => expect(pdf.slice(Number(e.slice(0, 10)), Number(e.slice(0, 10)) + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  test("der Hinweis steht sichtbar im Text, auf jeder Seite auch in der Fußzeile", () => {
    const pdf = ascii(e1kvPdf(doc));
    expect(pdf).toContain(hex("Berechnungstool, keine Steuerberatung."));
    expect(pdf).toContain(hex(`Regelversion ${RULES_VERSION}`));
  });

  test("lange Belegliste: mehrere Seiten", () => {
    const many = { ...doc, belege: Array.from({ length: 150 }, (_, i) => ({ ...doc.belege[0]!, source: `export.csv, Zeile ${i + 2}` })) };
    const pdf = ascii(e1kvPdf(many));
    const count = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf)?.[1]);
    expect(count).toBeGreaterThan(1);
    expect(pdf.match(/\/Type \/Page /g)?.length).toBe(count);
    expect(pdf).toContain(hex(`Seite ${count} von ${count}`));
  });
});
