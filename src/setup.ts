import { checkBookings } from "./check.js";
import type { History } from "./history.js";
import type { ImportResult } from "./import/model.js";
import { parseExport, type Broker } from "./import/readAny.js";

/**
 * Einrichtungsassistent (UMSETZUNG 3.1, PRODUKTPLAN „Einrichtung in zwei Minuten“): Broker wählen, Export holen,
 * Datei prüfen, drei Fragen beantworten. Hier liegen die Inhalte und die prüfbare Logik; die Oberfläche steht in
 * `src/web/setupWizard.ts`.
 */

export type BrokerId = "tr" | "ibkr" | "degiro";

export const BROKER_NAME: Record<BrokerId, Broker> = { tr: "Trade Republic", ibkr: "IBKR", degiro: "DEGIRO" };

export interface GuideStep {
  text: string;
  /** Beschreibung des Screenshots, der an dieser Stelle gezeigt wird (Platzhalter, bis Bilder vorliegen) */
  shot: string;
}

export interface ExportGuide {
  title: string;
  steps: GuideStep[];
  /** Was im Export enthalten oder eingestellt sein muss */
  checklist: string[];
  /** Dateiendungen für die Dateiauswahl */
  accept: string;
  sources: Array<{ label: string; url: string }>;
}

/**
 * Anleitungen zum Export, geprüft am 20.11.2026. Menünamen können sich mit App-Versionen ändern.
 * - Trade Republic: kein offizieller Hilfeartikel gefunden; Weg laut Portfolio-Performance-Forum und CoinTracking.
 * - IBKR: ibkrguides.com, „Create an Activity Flex Query“.
 */
export const GUIDES: Record<BrokerId, ExportGuide> = {
  tr: {
    title: "Transaktionsexport von Trade Republic",
    steps: [
      { text: "Öffne die Trade-Republic-App und tippe auf dein Profil.", shot: "Startseite der App, Profil-Symbol markiert" },
      { text: "Wähle „Kontoauszüge“ und dann „Transaktionsexport“. In älteren App-Versionen heißt der Weg „Service → Kontoauszüge“.", shot: "Profil mit dem Eintrag Kontoauszüge" },
      { text: "Wähle „Alle Transaktionen“, damit auch Käufe aus früheren Jahren enthalten sind, und tippe auf „Erstellen“.", shot: "Auswahl des Zeitraums" },
      { text: "Speichere die CSV-Datei oder schick sie dir selbst, und zieh sie hier hinein.", shot: "Teilen-Dialog mit der CSV-Datei" },
    ],
    checklist: ["Format CSV", "Zeitraum: alle Transaktionen seit Kontoeröffnung", "Wertpapier- und Verrechnungskonto sind in derselben Datei"],
    accept: ".csv,text/csv",
    sources: [
      { label: "Portfolio-Performance-Forum: Trade-Republic-Transaktionsexport", url: "https://forum.portfolio-performance.info/t/import-trade-republic-csv-transaktionsexport/39126" },
      { label: "CoinTracking: Trade-Republic-Import", url: "https://www.cointracking.info/blog/cointracking-trade-republic-import" },
    ],
  },
  ibkr: {
    title: "Activity Flex Query von IBKR",
    steps: [
      {
        text: "Melde dich im Client Portal an und öffne „Performance & Reports“ → „Flex Queries“ (oder Menü oben links → „Reporting“ → „Flex Queries“).",
        shot: "Client Portal mit dem Menü Performance & Reports",
      },
      { text: "Klicke bei „Activity Flex Query“ auf das Plus-Symbol und gib einen Namen ein, z. B. „KESt“.", shot: "Liste der Flex Queries, Plus-Symbol markiert" },
      { text: "Wähle die Abschnitte aus der Checkliste und darin jeweils alle Felder.", shot: "Auswahl der Abschnitte Trades, Cash Transactions, Open Positions" },
      { text: "Stelle Format und Datumsformat laut Checkliste ein, dann „Continue“ und „Create“. Das ist nur einmal nötig.", shot: "Einstellungen Format XML und Datumsformat" },
      {
        text: "Führe die Query mit dem Pfeil-Symbol aus, wähle den Zeitraum so weit zurück wie möglich und lade die XML-Datei herunter. Erlaubt IBKR nur ein Jahr je Abruf, lade je Jahr eine Datei; die App führt sie zusammen.",
        shot: "Dialog zum Ausführen mit Zeitraum und Format",
      },
    ],
    checklist: [
      "Abschnitt Trades mit Detailstufe „Executions“",
      "Abschnitt Cash Transactions",
      "Abschnitt Open Positions",
      "Format XML",
      "Datumsformat yyyyMMdd",
      "Zeitraum ab Kontoeröffnung (notfalls je Jahr eine Datei)",
    ],
    accept: ".xml,text/xml,application/xml",
    sources: [{ label: "IBKR: Create an Activity Flex Query", url: "https://www.ibkrguides.com/orgportal/performanceandstatements/activityflex.htm" }],
  },
  degiro: {
    title: "Transaktionen und Kontoübersicht von DEGIRO",
    steps: [
      { text: "Melde dich am Computer im Web-Trader von DEGIRO an. In der App gibt es den CSV-Export nicht.", shot: "Anmeldung im Web-Trader" },
      {
        text: "Öffne „Posteingang“ bzw. „Aktivität“ → „Transaktionen“, stelle das Startdatum auf den Tag der Kontoeröffnung und wähle „Exportieren“ → CSV.",
        shot: "Seite Transaktionen mit Zeitraum und Export-Knopf",
      },
      { text: "Öffne dort „Kontoübersicht“, wähle denselben Zeitraum und exportiere sie ebenfalls als CSV. Sie enthält Dividenden und Zinsen.", shot: "Seite Kontoübersicht mit Export-Knopf" },
      { text: "Zieh beide Dateien hier hinein. Lässt DEGIRO nur einen kürzeren Zeitraum zu, exportiere mehrere Zeiträume; die App führt sie zusammen.", shot: "Beide CSV-Dateien im Download-Ordner" },
    ],
    checklist: [
      "Zwei Dateien: „Transaktionen“ (Käufe und Verkäufe) und „Kontoübersicht“ (Dividenden, Zinsen)",
      "Format CSV",
      "Zeitraum ab Kontoeröffnung (notfalls mehrere Dateien)",
      "Dateien unverändert lassen, nicht in Excel öffnen und speichern",
    ],
    accept: ".csv,text/csv",
    sources: [
      { label: "Snowball Analytics: DEGIRO-Import (Menüweg)", url: "https://help.snowball-analytics.com/import-degiro/" },
      { label: "libdegiro: Format der Kontoübersicht", url: "https://github.com/nyg/libdegiro" },
      { label: "degiro-portfolio: Format der Transaktionen", url: "https://github.com/wirrike/degiro-portfolio" },
    ],
  },
};

export interface ImportSummary {
  trades: number;
  dividends: number;
  interest: number;
  /** erste und letzte Buchung (JJJJ-MM-TT) */
  from: string | null;
  to: string | null;
  /** Optionen oder Futures (nicht verbriefte Derivate) in der Datei */
  hasDerivatives: boolean;
  /** Fehler und Warnungen des Prüfassistenten (ohne „Kurse nicht geladen“, die lädt die App selbst) */
  errors: number;
  warnings: number;
}

export interface ImportCheck {
  ok: boolean;
  broker: Broker | null;
  /** Gründe, warum die Datei nicht gelesen werden kann */
  problems: string[];
  /** Hinweise, die das Einlesen nicht verhindern */
  notes: string[];
  summary: ImportSummary;
  data: ImportResult | null;
}

const EMPTY: ImportSummary = { trades: 0, dividends: 0, interest: 0, from: null, to: null, hasDerivatives: false, errors: 0, warnings: 0 };

/** Sofortprüfung einer Exportdatei: liest sie, fasst zusammen und sagt konkret, was fehlt. */
export function checkImport(text: string, expected: BrokerId): ImportCheck {
  let broker: Broker;
  let data: ImportResult;
  try {
    ({ broker, data } = parseExport(text));
  } catch (e) {
    return { ok: false, broker: null, problems: [e instanceof Error ? e.message : String(e)], notes: [], summary: EMPTY, data: null };
  }
  const notes = broker === BROKER_NAME[expected] ? [] : [`Die Datei ist ein Export von ${broker}, gewählt war ${BROKER_NAME[expected]}.`];
  const dates = [...data.trades, ...data.transfersOut, ...data.dividends, ...data.interest]
    .map((x) => x.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const findings = checkBookings({ data }).filter((f) => f.code !== "rates-not-loaded");
  return {
    ok: true,
    broker,
    problems: [],
    notes,
    summary: {
      trades: data.trades.length,
      dividends: data.dividends.length,
      interest: data.interest.length,
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
      hasDerivatives: data.trades.some((t) => t.kind === "derivative"),
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
    },
    data,
  };
}

/** Antworten auf die drei Fragen (plus „steuereinfach seit“ bei Trade Republic). */
export interface SetupAnswers {
  /** Handelst du Optionen oder Futures? */
  derivatives: boolean;
  /** geschätztes sonstiges Einkommen, nur bei Optionen/Futures; leer = weiß ich nicht */
  otherIncomeEur: string;
  /** Wo liegt deine Rücklage? Freie Eingabe */
  reservePlace: string;
  /** Sicherheitspuffer in Prozent */
  bufferPct: number;
  /** JJJJ-MM-TT oder leer */
  taxSimpleSince: string;
}

/** Übernimmt die Antworten in die Einstellungen. Wirft deutsche Meldungen bei ungültigen Angaben. */
export function applySetup(history: History, a: SetupAnswers, today: string): History {
  if (!Number.isInteger(a.bufferPct) || a.bufferPct < 0 || a.bufferPct > 100) {
    throw new Error("Der Sicherheitspuffer muss eine ganze Zahl zwischen 0 und 100 % sein.");
  }
  const income = a.derivatives ? a.otherIncomeEur.trim() : "";
  if (income !== "" && !/^\d+(\.\d+)?$/.test(income)) {
    throw new Error(`Das sonstige Einkommen „${a.otherIncomeEur}“ ist keine gültige Zahl ab 0 (z. B. 30000).`);
  }
  const since = a.taxSimpleSince.trim();
  if (since !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`Das Datum für „steuereinfach seit“ ist ungültig: „${a.taxSimpleSince}“. Erwartet wird JJJJ-MM-TT.`);
  }
  return {
    ...history,
    settings: {
      ...history.settings,
      otherIncomeEur: income,
      reservePlace: a.reservePlace.trim().slice(0, 80),
      bufferPct: a.bufferPct,
      taxSimpleSince: since,
      setupDoneAt: today,
    },
  };
}
