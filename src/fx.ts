import { dec, type Dec, type DecInput } from "./decimal.js";
import { parseCsvTable } from "./import/csv.js";

/**
 * Rechnet einen Betrag in Euro um.
 * `ecbRate` = EZB-Referenzkurs am Buchungstag in Einheiten der Fremdwährung pro 1 EUR
 * (z. B. USD 1.25 heißt 1 EUR = 1,25 USD).
 */
export function toEur(amount: DecInput, currency: string, ecbRate?: DecInput): Dec {
  if (currency.toUpperCase() === "EUR") return dec(amount);
  if (ecbRate === undefined) {
    throw new Error(`Wechselkurs fehlt für ${currency}: Betrag kann nicht in EUR umgerechnet werden`);
  }
  const rate = dec(ecbRate);
  if (rate.lte(0)) throw new Error(`Wechselkurs ${rate.toString()} für ${currency} ist ungültig`);
  return dec(amount).div(rate);
}

/**
 * Austauschbare Kursquelle: EZB-Referenzkurs (Einheiten Fremdwährung pro 1 EUR) für eine Währung an einem Tag.
 * Gibt es an dem Tag keinen Kurs (Wochenende, Feiertag), liefert sie `undefined`. Sie greift bewusst nicht auf
 * den Vortag zurück: Eine offizielle Regel dafür ist nicht bekannt (EStR 2000 Rz 6201c nennt nur den Kurs im
 * Zuflusszeitpunkt), also wird der Fall als „nicht berechnet“ gemeldet.
 */
export interface RateSource {
  rate(currency: string, date: string): Dec | undefined;
}

/** Kurse im Speicher, z. B. aus einer EZB-Datei oder in Tests aus festen Werten. */
export class RateTable implements RateSource {
  private readonly rates = new Map<string, Dec>();

  constructor(entries: Iterable<[currency: string, date: string, rate: DecInput]> = []) {
    for (const [currency, date, rate] of entries) this.set(currency, date, rate);
  }

  set(currency: string, date: string, rate: DecInput): void {
    let value: Dec;
    try {
      value = dec(rate);
    } catch {
      throw new Error(`EZB-Kurs „${String(rate)}“ für ${currency} am ${date} ist ungültig`);
    }
    if (!value.isFinite() || value.lte(0)) throw new Error(`EZB-Kurs ${value.toString()} für ${currency} am ${date} ist ungültig`);
    this.rates.set(`${currency.toUpperCase()}|${date}`, value);
  }

  rate(currency: string, date: string): Dec | undefined {
    return this.rates.get(`${currency.toUpperCase()}|${date}`);
  }

  get size(): number {
    return this.rates.size;
  }
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isRate = (s: string) => /^\d+(\.\d+)?$/.test(s);

/**
 * Liest die Datei eurofxref-hist.csv der EZB (eine Spalte je Währung, „N/A“ an Tagen ohne Kurs).
 * Download: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
 */
export function parseEcbHistCsv(text: string): RateTable {
  const { header, rows } = parseCsvTable(text);
  const table = new RateTable();
  const currencies = header.filter((h) => /^[A-Z]{3}$/.test(h.trim()));
  for (const row of rows) {
    const date = (row.Date ?? "").trim();
    if (!isDate(date)) continue;
    for (const c of currencies) {
      const v = (row[c] ?? "").trim();
      if (isRate(v)) table.set(c.trim(), date, v);
    }
  }
  return table;
}

/** Liest die CSV der EZB-Datenschnittstelle (data-api.ecb.europa.eu, Datensatz EXR, format=csvdata). */
export function parseEcbApiCsv(text: string): RateTable {
  const { rows } = parseCsvTable(text);
  const table = new RateTable();
  for (const row of rows) {
    const currency = (row.CURRENCY ?? "").trim();
    const date = (row.TIME_PERIOD ?? "").trim();
    const v = (row.OBS_VALUE ?? "").trim();
    if (/^[A-Z]{3}$/.test(currency) && isDate(date) && isRate(v)) table.set(currency, date, v);
  }
  return table;
}

/** Erkennt das Format einer EZB-Kursdatei und liest sie. */
export function parseRateFile(text: string): RateTable {
  const start = text.replace(/^﻿/, "");
  if (start.startsWith("PK")) {
    throw new Error("Das ist eine ZIP-Datei. Bitte die Datei eurofxref-hist.zip entpacken und die enthaltene CSV-Datei verwenden.");
  }
  const firstLine = start.split(/\r?\n/, 1)[0] ?? "";
  const columns = firstLine.split(",").map((c) => c.replace(/"/g, "").trim());
  if (columns[0] === "Date") return parseEcbHistCsv(start);
  if (columns.includes("CURRENCY") && columns.includes("TIME_PERIOD") && columns.includes("OBS_VALUE")) return parseEcbApiCsv(start);
  throw new Error(
    "Das ist keine EZB-Kursdatei. Erwartet wird eurofxref-hist.csv von der EZB oder eine CSV der EZB-Datenschnittstelle.",
  );
}

/**
 * Abfrage-Adresse der EZB-Datenschnittstelle für tägliche Referenzkurse (Datensatz EXR, Serie D.<Währung>.EUR.SP00.A).
 * Übermittelt werden nur Währungen und Zeitraum, keine Steuerdaten.
 * Doku: https://data.ecb.europa.eu/help/api/data
 */
export function ecbApiUrl(currencies: string[], start: string, end: string): string {
  const list = [...new Set(currencies.map((c) => c.toUpperCase()))].sort().join("+");
  return `https://data-api.ecb.europa.eu/service/data/EXR/D.${list}.EUR.SP00.A?startPeriod=${start}&endPeriod=${end}&format=csvdata`;
}
