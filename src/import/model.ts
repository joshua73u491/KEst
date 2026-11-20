/**
 * Gemeinsames Datenmodell aller Importe (Trade Republic, IBKR). Ein Import liefert nur Fakten aus der Datei;
 * die steuerliche Behandlung entscheidet die Jahresauswertung (`src/yearReport.ts`).
 */

/**
 * Steuertopf eines Wertpapiers. `derivative` = nicht verbrieftes Derivat (Option, Future): eigener Topf,
 * Tarif und KZ 857 oder wahlweise 27,5 % (Einstellung, siehe `src/derivatives.ts`).
 */
export type AssetKind = "security" | "securitizedDerivative" | "crypto" | "derivative";

/** Kontraktdaten eines nicht verbrieften Derivats (IBKR). */
export interface DerivativeContract {
  /** eindeutiger Schlüssel des Kontrakts (IBKR conid, sonst Symbol) */
  contract: string;
  type: "option" | "future";
  /** Symbol des Basiswerts, für die Zuordnung der Aktienlieferung bei Ausübung oder Zuteilung */
  underlying: string;
  underlyingConid?: string;
  /** C = Call, P = Put, leer bei Futures */
  putCall: "C" | "P" | "";
  /** Ausübungspreis je Stück des Basiswerts, leer bei Futures */
  strike: string;
  /** Verfallstag JJJJ-MM-TT, leer wenn unbekannt */
  expiry: string;
  multiplier: string;
}

/** Betrag in einer Fremdwährung, der erst in der Auswertung zum EZB-Referenzkurs umgerechnet wird. */
export interface ForeignAmount {
  currency: string;
  amount: string;
}

export interface ImportedTrade {
  /** Zeile in der Datei (CSV: Kopfzeile = 1) */
  line: number;
  isin: string;
  depot: string;
  date: string;
  datetime: string;
  side: "buy" | "sell";
  quantity: string;
  /** Kurswert in EUR ohne Spesen; leer, wenn `convert` gesetzt ist */
  amountEur: string;
  /** Spesen in EUR (nur zur Information, im 27,5 %-Topf nicht abziehbar); leer, wenn `convert` gesetzt ist */
  feeEur: string;
  /** vom Broker einbehaltene Steuer laut Export (positiv = einbehalten, negativ = gutgeschrieben) */
  withheldEur: string;
  /**
   * Handelswährung, wenn nicht EUR. Bei Trade Republic ist `amountEur` dann der tatsächlich umgerechnete Betrag
   * (tatsächliche Konvertierung, EStR 2000 Rz 6201c).
   */
  originalCurrency: string;
  /**
   * Gesetzt, wenn ohne tatsächlichen Umtausch in Fremdwährung gehandelt wurde (z. B. IBKR): Kurswert und Spesen
   * werden in der Auswertung zum EZB-Referenzkurs am Handelstag umgerechnet (EStR 2000 Rz 6201c).
   */
  convert?: ForeignAmount & { fees: ForeignAmount[] };
  kind: AssetKind;
  name: string;
  /** Dateiname, wenn mehrere Dateien zusammengeführt wurden */
  file?: string;
  /** nur bei `kind: "derivative"` */
  derivative?: DerivativeContract;
  /** Angaben des Brokers (IBKR) für die Zuordnung von Ausübung und Zuteilung */
  symbol?: string;
  conid?: string;
  /** Kurs je Stück bzw. Kontrakt laut Broker */
  price?: string;
  /** z. B. ExchTrade, BookTrade (Lieferung aus Ausübung, Verfall) */
  transactionType?: string;
  /** Eröffnung (O) oder Schließung (C) laut Broker, leer wenn nicht angegeben */
  openClose?: "O" | "C" | "";
  /**
   * Codes laut Broker (IBKR Feld notes), z. B. A = Assignment, Ep = Resulted from an Expired Position, Ex = Exercise.
   * Legende: https://ibkrguides.com/reportingreference/reportguide/codes_flex.htm
   */
  codes?: string[];
}

export interface ImportedTransfer {
  /** Zeile in der Datei */
  line: number;
  isin: string;
  depot: string;
  date: string;
  datetime: string;
  quantity: string;
  kind: AssetKind;
  file?: string;
}

export interface ImportedInterest {
  /** Zeile in der Datei */
  line: number;
  date: string;
  depot: string;
  /**
   * `bank`: Zinsen auf einem Bankkonto (Trade Republic, KZ 861).
   * `broker`: Zinsen auf dem Konto eines Brokers (IBKR); KZ 861 oder 863 ist eine Einstellung (offene Frage).
   */
  source: "bank" | "broker";
  /** Betrag in EUR; leer, wenn `convert` gesetzt ist */
  amountEur: string;
  /** einbehaltene Steuer laut Export (positiv = einbehalten) */
  withheldEur: string;
  /** gesetzt bei Zinsen aus einem Wertpapier (z. B. Anleihe), leer bei Zinsen auf dem Konto */
  isin: string;
  /** Betrag in Fremdwährung, wird zum EZB-Referenzkurs im Zuflusszeitpunkt umgerechnet */
  convert?: ForeignAmount;
  file?: string;
}

/**
 * Art der Ausschüttung laut Export:
 * - `stock`: Dividende einer Aktie
 * - `fund`: Ausschüttung eines Fonds oder ETF
 * - `capitalDistribution`: „Capital Distribution“ (Trade Republic), ob Dividende oder Einlagenrückzahlung, ist offen
 */
export type DistributionKind = "stock" | "fund" | "capitalDistribution";

export interface ImportedDividend {
  /** Zeile in der Datei */
  line: number;
  isin: string;
  depot: string;
  date: string;
  datetime: string;
  name: string;
  kind: DistributionKind;
  /** Bruttobetrag in EUR; leer, wenn er nur in Fremdwährung vorliegt */
  grossEur: string;
  /** einbehaltene Steuer in EUR (positiv = einbehalten, negativ = gutgeschrieben); leer, wenn nur in Fremdwährung */
  withheldEur: string;
  /** Originalwährung laut Export; leer, wenn in EUR ausgeschüttet */
  originalCurrency: string;
  /** Bruttobetrag in der Originalwährung, leer bei EUR */
  originalAmount: string;
  /** einbehaltene Steuer in der Originalwährung (IBKR), leer wenn der Broker sie nur in EUR ausweist */
  withheldOriginal: string;
  /** Umrechnungskurs des Brokers (Trade Republic, Spalte `fx_rate`, EUR je Einheit Fremdwährung), leer wenn nicht angegeben */
  brokerFxRate: string;
  file?: string;
}

/** Bestand laut Broker zu einem Stichtag (IBKR OpenPositions), zum Abgleich mit dem berechneten Bestand. */
export interface ReportedPosition {
  line: number;
  isin: string;
  depot: string;
  quantity: string;
  date: string;
  file?: string;
}

export interface Unsupported {
  line: number;
  type: string;
  reason: string;
  /** Dateiname, wenn mehrere Dateien zusammengeführt wurden */
  file?: string;
  /**
   * Übersprungene Buchung, die den Bestand dieser Position verändert hätte.
   * Spätere Abgänge derselben Position werden dann nicht mehr gerechnet.
   */
  affects?: { isin: string; depot: string; datetime: string };
}

export interface ImportResult {
  trades: ImportedTrade[];
  transfersOut: ImportedTransfer[];
  interest: ImportedInterest[];
  dividends: ImportedDividend[];
  reportedPositions: ReportedPosition[];
  unsupported: Unsupported[];
}
