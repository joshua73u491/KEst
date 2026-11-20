import type { FilePeriod } from "./check.js";
import { processIbkrStatements, readIbkrFlexStatements, type FlexStatementData } from "./import/ibkrFlex.js";
import type { ImportResult } from "./import/model.js";
import { parseExport, type Broker } from "./import/readAny.js";
import { processTradeRepublicRows, readTradeRepublicRows, type TrSourceRow } from "./import/tradeRepublic.js";
import type { XmlElement } from "./import/xml.js";
import { addEntry, emptyLedger, markPaid, type InvestmentKind, type Ledger, type ReserveEntry, type ReserveInvestment } from "./ledger.js";

/**
 * Lokale Steuerhistorie: alle importierten Dateien und die Einstellungen. Gespeichert wird sie nur im Browser
 * (IndexedDB, `src/web/storage.ts`) und auf Wunsch als Backup-Datei; kein Konto, kein Server.
 *
 * Gespeichert werden die Originaldateien. Ausgewertet wird, indem die Zeilen aller Dateien eines Brokers
 * zusammengeführt werden (Duplikate über die Transaktions-ID) und dann gemeinsam durch den Import laufen.
 * So werden Stornos und Korrekturen auch über Dateigrenzen hinweg richtig verrechnet.
 */

export interface StoredFile {
  id: string;
  name: string;
  broker: Broker;
  /** Zeitpunkt des Imports (ISO 8601) */
  importedAt: string;
  text: string;
}

export interface Settings {
  /** JJJJ-MM-TT, ab dem Trade Republic die KESt abzieht; leer = nicht steuereinfach */
  taxSimpleSince: string;
  brokerInterestKz: "863" | "861";
  bufferPct: number;
  /** nicht verbriefte Derivate: Tarif (KZ 857, Standard) oder 27,5 % (KZ 995/896) */
  derivativesTreatment: "tariff" | "special";
  /** geschätztes zu versteuerndes Einkommen ohne Kapitalerträge, für die Mehrsteuer auf KZ 857; leer = keine Angabe */
  otherIncomeEur: string;
  /** Ort der Rücklage laut Einrichtung, freie Eingabe ohne Empfehlung; Vorschlag beim Eintragen des Stands */
  reservePlace: string;
  /** JJJJ-MM-TT, an dem die Einrichtung abgeschlossen wurde; leer = noch nicht */
  setupDoneAt: string;
}

export interface History {
  files: StoredFile[];
  settings: Settings;
  /** Rücklagen-Ledger: eingetragene Marktwerte, gewählte Anlage, bezahlte Jahre */
  reserve: Ledger;
}

export const DEFAULT_SETTINGS: Settings = {
  taxSimpleSince: "",
  brokerInterestKz: "863",
  bufferPct: 10,
  derivativesTreatment: "tariff",
  otherIncomeEur: "",
  reservePlace: "",
  setupDoneAt: "",
};

export const emptyHistory = (): History => ({ files: [], settings: { ...DEFAULT_SETTINGS }, reserve: emptyLedger() });

/**
 * Prüft eine Datei und nimmt sie in die Historie auf. Eine ungültige Datei wirft eine deutsche Meldung;
 * eine bereits gespeicherte Datei (gleicher Inhalt) wird nicht noch einmal aufgenommen.
 */
export function addFile(history: History, name: string, text: string, importedAt: string, id: string): { history: History; added: boolean; broker: Broker } {
  const { broker } = parseExport(text);
  if (history.files.some((f) => f.text === text)) return { history, added: false, broker };
  return { history: { ...history, files: [...history.files, { id, name, broker, importedAt, text }] }, added: true, broker };
}

export function removeFile(history: History, id: string): History {
  return { ...history, files: history.files.filter((f) => f.id !== id) };
}

export interface Combined {
  data: ImportResult;
  /** Buchungen, die in mehreren Dateien vorkamen und nur einmal gezählt werden */
  duplicates: number;
}

const emptyResult = (): ImportResult => ({ trades: [], transfersOut: [], interest: [], dividends: [], reportedPositions: [], unsupported: [] });

/** Führt alle gespeicherten Dateien zusammen und wertet sie aus. */
export function combine(history: History): Combined {
  let duplicates = 0;
  const parts: ImportResult[] = [];

  // Trade Republic: Zeilen aller Exporte, Duplikate über transaction_id
  const trRows: TrSourceRow[] = [];
  const trSeen = new Set<string>();
  for (const f of history.files.filter((x) => x.broker === "Trade Republic")) {
    for (const r of readTradeRepublicRows(f.text, f.name)) {
      const id = (r.row.transaction_id ?? "").trim();
      const key = id !== "" ? `id:${id}` : `row:${JSON.stringify(r.row)}`;
      if (trSeen.has(key)) {
        duplicates++;
        continue;
      }
      trSeen.add(key);
      trRows.push(r);
    }
  }
  if (trRows.length > 0) parts.push(processTradeRepublicRows(trRows));

  // IBKR: je Konto alle Kontoauszüge zusammenführen, Duplikate über transactionID
  const accounts = new Map<string, FlexStatementData[]>();
  for (const f of history.files.filter((x) => x.broker === "IBKR")) {
    for (const st of readIbkrFlexStatements(f.text, f.name)) {
      accounts.set(st.accountId, [...(accounts.get(st.accountId) ?? []), st]);
    }
  }
  const merged: FlexStatementData[] = [];
  for (const [accountId, statements] of accounts) {
    const unique = (pick: (s: FlexStatementData) => XmlElement[]) => {
      const seen = new Set<string>();
      const out: XmlElement[] = [];
      for (const el of statements.flatMap(pick)) {
        const id = (el.attrs.transactionID ?? "").trim();
        const level = el.attrs.levelOfDetail ?? "";
        const key = id !== "" && id !== "N/A" ? `id:${level}|${id}` : `el:${JSON.stringify(el.attrs)}`;
        if (seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);
        out.push(el);
      }
      return out;
    };
    // Bestandsabgleich nur mit dem neuesten Auszug (bei gleichem Enddatum: zuletzt importiert)
    const newest = statements.reduce((a, b) => (b.toDate >= a.toDate ? b : a));
    const fromDate = statements.map((s) => s.fromDate).filter((d) => d !== "").sort()[0] ?? "";
    merged.push({ accountId, fromDate, toDate: newest.toDate, trades: unique((s) => s.trades), cash: unique((s) => s.cash), positions: newest.positions });
  }
  if (merged.length > 0) parts.push(processIbkrStatements(merged));

  const data = emptyResult();
  for (const p of parts) {
    data.trades.push(...p.trades);
    data.transfersOut.push(...p.transfersOut);
    data.interest.push(...p.interest);
    data.dividends.push(...p.dividends);
    data.reportedPositions.push(...p.reportedPositions);
    data.unsupported.push(...p.unsupported);
  }
  return { data, duplicates };
}

/**
 * Zeitraum je Datei und Depot für die Lückenprüfung des Prüfassistenten: bei IBKR laut Flex Query (fromDate/toDate),
 * bei Trade Republic abgeleitet aus der ersten und letzten Buchung der Datei (der Export nennt keinen Zeitraum).
 */
export function filePeriods(history: History): FilePeriod[] {
  const periods: FilePeriod[] = [];
  for (const f of history.files) {
    if (f.broker === "Trade Republic") {
      const dates = readTradeRepublicRows(f.text, f.name)
        .map((r) => (r.row.date ?? "").trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();
      if (dates.length > 0) periods.push({ depot: "TR", file: f.name, from: dates[0]!, to: dates[dates.length - 1]!, exact: false });
    } else {
      for (const st of readIbkrFlexStatements(f.text, f.name)) {
        if (st.fromDate && st.toDate) periods.push({ depot: `IBKR ${st.accountId}`.trim(), file: f.name, from: st.fromDate, to: st.toDate, exact: true });
      }
    }
  }
  return periods;
}

const APP = "KESt-Rücklage";
const FORMAT = 1;

/** Backup als JSON-Datei: Originaldateien und Einstellungen. */
export function toBackup(history: History, exportedAt: string): string {
  return JSON.stringify({ app: APP, format: FORMAT, exportedAt, files: history.files, settings: history.settings, reserve: history.reserve }, null, 2);
}

/** Liest ein Backup und prüft jede Datei erneut. Wirft deutsche Meldungen. */
export function fromBackup(text: string): History {
  const notBackup = () => new Error("Die Datei ist kein Backup der KESt-Rücklage-App.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw notBackup();
  }
  if (typeof raw !== "object" || raw === null || (raw as { app?: unknown }).app !== APP) throw notBackup();
  const b = raw as { format?: unknown; files?: unknown; settings?: unknown; reserve?: unknown };
  if (typeof b.format !== "number" || b.format > FORMAT) {
    throw new Error("Das Backup stammt aus einer neueren Version der App und kann hier nicht gelesen werden.");
  }
  if (!Array.isArray(b.files)) throw new Error("Das Backup ist beschädigt: Die Liste der Dateien fehlt.");
  const files: StoredFile[] = b.files.map((f: unknown, i: number) => {
    const x = f as Partial<StoredFile>;
    if (typeof x?.name !== "string" || typeof x.text !== "string" || typeof x.id !== "string" || typeof x.importedAt !== "string") {
      throw new Error(`Das Backup ist beschädigt: Eintrag ${i + 1} ist unvollständig.`);
    }
    let broker: Broker;
    try {
      broker = parseExport(x.text).broker; // nie dem gespeicherten Broker vertrauen, Datei erneut prüfen
    } catch (e) {
      throw new Error(`Das Backup enthält eine ungültige Datei „${x.name}“: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { id: x.id, name: x.name, broker, importedAt: x.importedAt, text: x.text };
  });
  const s = (b.settings ?? {}) as Partial<Settings>;
  const settings: Settings = {
    taxSimpleSince: typeof s.taxSimpleSince === "string" && /^(\d{4}-\d{2}-\d{2})?$/.test(s.taxSimpleSince) ? s.taxSimpleSince : DEFAULT_SETTINGS.taxSimpleSince,
    brokerInterestKz: s.brokerInterestKz === "861" ? "861" : "863",
    bufferPct: typeof s.bufferPct === "number" && s.bufferPct >= 0 && s.bufferPct <= 100 ? s.bufferPct : DEFAULT_SETTINGS.bufferPct,
    derivativesTreatment: s.derivativesTreatment === "special" ? "special" : "tariff",
    otherIncomeEur: typeof s.otherIncomeEur === "string" && /^(\d+(\.\d+)?)?$/.test(s.otherIncomeEur) ? s.otherIncomeEur : "",
    reservePlace: typeof s.reservePlace === "string" ? s.reservePlace.slice(0, 80) : "",
    setupDoneAt: typeof s.setupDoneAt === "string" && /^(\d{4}-\d{2}-\d{2})?$/.test(s.setupDoneAt) ? s.setupDoneAt : "",
  };
  return { files, settings, reserve: ledgerFromBackup(b.reserve) };
}

const KINDS = new Set<InvestmentKind>(["deposit", "moneyMarketFund", "shortGovBonds", "equityEtf", "longBondEtf", "other"]);

/** Liest den Rücklagen-Ledger aus einem Backup; ältere Backups ohne Ledger ergeben einen leeren. */
function ledgerFromBackup(raw: unknown): Ledger {
  if (raw === undefined || raw === null) return emptyLedger();
  const r = raw as { entries?: unknown; investment?: unknown; paidYears?: unknown };
  let ledger = emptyLedger();
  for (const [i, e] of (Array.isArray(r.entries) ? r.entries : []).entries()) {
    const x = e as Partial<ReserveEntry>;
    try {
      if (typeof x?.id !== "string") throw new Error();
      ledger = addEntry(ledger, { id: x.id, date: String(x.date ?? ""), valueEur: String(x.valueEur ?? ""), place: String(x.place ?? ""), note: String(x.note ?? "") });
    } catch {
      throw new Error(`Das Backup ist beschädigt: Rücklagen-Eintrag ${i + 1} ist ungültig.`);
    }
  }
  const inv = r.investment as Partial<ReserveInvestment> | null | undefined;
  if (inv && typeof inv === "object" && KINDS.has(inv.kind as InvestmentKind)) {
    ledger.investment = {
      kind: inv.kind as InvestmentKind,
      reportingFund: inv.reportingFund === "yes" || inv.reportingFund === "no" || inv.reportingFund === "unknown" ? inv.reportingFund : null,
      sri: typeof inv.sri === "number" && Number.isInteger(inv.sri) && inv.sri >= 1 && inv.sri <= 7 ? inv.sri : null,
    };
  }
  if (r.paidYears && typeof r.paidYears === "object") {
    for (const [year, date] of Object.entries(r.paidYears as Record<string, unknown>)) {
      if (/^\d{4}$/.test(year) && typeof date === "string") ledger = markPaid(ledger, Number(year), date);
    }
  }
  return ledger;
}

/**
 * Stellt ein Backup wieder her, ohne vorhandene Daten zu löschen: Dateien aus dem Backup kommen dazu
 * (gleicher Inhalt nur einmal), die Einstellungen werden aus dem Backup übernommen.
 */
export function restoreBackup(current: History, backup: History, newId: () => string): { history: History; added: number; skipped: number } {
  const files = [...current.files];
  let added = 0;
  let skipped = 0;
  for (const f of backup.files) {
    if (files.some((x) => x.text === f.text)) {
      skipped++;
      continue;
    }
    files.push({ ...f, id: files.some((x) => x.id === f.id) ? newId() : f.id });
    added++;
  }
  // Rücklagen-Ledger: Einträge ergänzen (gleiche ID nur einmal), Anlage und bezahlte Jahre aus dem Backup übernehmen
  const known = new Set(current.reserve.entries.map((e) => e.id));
  const reserve: Ledger = {
    entries: [...current.reserve.entries, ...backup.reserve.entries.filter((e) => !known.has(e.id))],
    investment: backup.reserve.investment ?? current.reserve.investment,
    paidYears: { ...current.reserve.paidYears, ...backup.reserve.paidYears },
  };
  return { history: { files, settings: { ...backup.settings }, reserve }, added, skipped };
}
