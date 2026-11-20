import { dec, type Dec } from "./decimal.js";

export interface TreatyRate {
  /** Höchstsatz der Quellensteuer auf Dividenden aus Streubesitz an eine natürliche Person */
  rate: Dec;
  /** DBA-Text im RIS (konsolidierte Fassung), maßgeblich ist Art. 10 Abs. 2 */
  source: string;
  /** Kundmachung des Abkommens */
  bgbl: string;
}

const ris = (gesetzesnummer: string) =>
  `https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=${gesetzesnummer}`;

/**
 * Höchstsätze laut Doppelbesteuerungsabkommen, bis zu denen ausländische Quellensteuer auf Dividenden
 * in Österreich anrechenbar ist. Gelesen im RIS, konsolidierte Fassung vom 20.11.2026, jeweils Art. 10 Abs. 2
 * (Satz für „alle anderen Fälle“, also nicht das Schachtelprivileg). Übersicht der Abkommen:
 * https://www.bmf.gv.at/themen/steuern/internationales-steuerrecht/doppelbesteuerungsabkommen/dba-liste.html
 *
 * Nicht geprüft: die MLI-synthetisierten Fassungen (BGBl. III Nr. 93/2018). Bewusst nicht enthalten, weil der Text
 * nicht gelesen oder die Regel anders aufgebaut ist: Irland (Art. 8 statt Art. 10, 15 % nur mit irischer Steuergutschrift),
 * Japan (neues DBA BGBl. III Nr. 167/2018, im RIS nur als Bild), Vereinigtes Königreich. Für nicht hinterlegte Länder
 * rechnet die App keine Quellensteuer an und meldet das (Steuer eher zu hoch, nie zu niedrig).
 */
const RATES: Record<string, { rate: string; gesetzesnummer: string; bgbl: string }> = {
  BE: { rate: "0.15", gesetzesnummer: "10004142", bgbl: "BGBl. Nr. 415/1973" },
  CA: { rate: "0.15", gesetzesnummer: "10004336", bgbl: "BGBl. Nr. 77/1981" },
  CH: { rate: "0.15", gesetzesnummer: "10004202", bgbl: "BGBl. Nr. 64/1975" },
  DE: { rate: "0.15", gesetzesnummer: "20002157", bgbl: "BGBl. III Nr. 182/2002" },
  DK: { rate: "0.15", gesetzesnummer: "20005786", bgbl: "BGBl. III Nr. 41/2008" },
  ES: { rate: "0.15", gesetzesnummer: "10004008", bgbl: "BGBl. Nr. 395/1967" },
  FI: { rate: "0.10", gesetzesnummer: "20001206", bgbl: "BGBl. III Nr. 42/2001" },
  FR: { rate: "0.15", gesetzesnummer: "10004906", bgbl: "BGBl. Nr. 613/1994" },
  IT: { rate: "0.15", gesetzesnummer: "10004430", bgbl: "BGBl. Nr. 125/1985" },
  LU: { rate: "0.15", gesetzesnummer: "10003974", bgbl: "BGBl. Nr. 54/1964" },
  NL: { rate: "0.15", gesetzesnummer: "10004091", bgbl: "BGBl. Nr. 191/1971" },
  NO: { rate: "0.15", gesetzesnummer: "10005080", bgbl: "BGBl. III Nr. 1/1997" },
  SE: { rate: "0.10", gesetzesnummer: "10003921", bgbl: "BGBl. Nr. 39/1960" },
  US: { rate: "0.15", gesetzesnummer: "10005110", bgbl: "BGBl. III Nr. 6/1998" },
};

/** DBA-Höchstsatz für Dividenden aus `country` (ISO-Ländercode), oder `undefined`, wenn nicht hinterlegt. */
export function dividendTreatyRate(country: string): TreatyRate | undefined {
  const r = RATES[country];
  return r && { rate: dec(r.rate), source: ris(r.gesetzesnummer), bgbl: r.bgbl };
}

/**
 * Land einer ISIN (die ersten zwei Buchstaben). Annahme, siehe README: Das ISIN-Land ist der Quellenstaat
 * der Dividende. Bei Hinterlegungsscheinen (ADR) oder Gesellschaften mit Sitz in einem anderen Land stimmt das nicht.
 */
export function countryOfIsin(isin: string): string | null {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) ? isin.slice(0, 2) : null;
}
