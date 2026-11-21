import sampleCsv from "../../test/fixtures/tr-beispiel.csv";
import { dec, D, type Dec } from "../decimal.js";
import { formatEur } from "../format.js";
import { parseRateFile, type RateTable } from "../fx.js";
import { checkBookings, type CheckInput, type FilePeriod } from "../check.js";
import { formatLocations, SEVERITY_LABEL } from "../format.js";
import { addFile, combine, emptyHistory, filePeriods, fromBackup, removeFile, restoreBackup, toBackup, type History } from "../history.js";
import type { ImportResult } from "../import/model.js";
import { parseExport } from "../import/readAny.js";
import {
  addEntry,
  checkInvestment,
  markPaid,
  removeEntry,
  reserveStatus,
  unmarkPaid,
  type InvestmentKind,
  type Ledger,
  type ReserveInvestment,
  type ReserveStatus,
  type YearSoll,
} from "../ledger.js";
import { reminders, yearFigures, type YearFigures } from "../reminders.js";
import { checkOrder, simulateSale } from "../simulator.js";
import { buildE1kvDocument, e1kvCsv, e1kvPdf } from "../e1kvReport.js";
import { reserveTarget } from "../reserve.js";
import { sollTimeline } from "../sollTimeline.js";
import { computeYear, type YearOptions, type YearReport } from "../yearReport.js";
import { fetchEcbRates, ratesNeeded } from "./loadRates.js";
import { initSetupWizard } from "./setupWizard.js";
import { clearHistory, loadFlexSettings, loadHistory, saveFlexSettings, saveHistory, type FlexSettings } from "./storage.js";
import { syncSnapTradeViaRelay, syncViaRelay } from "../sync/webSync.js";

interface State {
  /** alle gespeicherten Dateien und Einstellungen */
  history: History;
  /** gespeicherte Daten oder die Beispieldaten anzeigen */
  mode: "history" | "sample";
  data: ImportResult | null;
  /** Buchungen, die in mehreren Dateien vorkamen */
  duplicates: number;
  /** Zeitraum je gespeicherter Datei, für die Lückenprüfung */
  periods: FilePeriod[];
  /** false, wenn der Browser nicht speichern kann (z. B. privates Fenster) */
  storageOk: boolean;
  storageError: string;
  /** kurze Rückmeldung zur letzten Aktion */
  notice: string;
  year: number;
  /** EZB-Referenzkurse für Beträge in Fremdwährung */
  rates: RateTable | null;
  /** Stand des Kursabrufs für die Anzeige; leer, wenn keine Kurse gebraucht werden */
  ratesStatus: string;
  /** true, wenn Kurse gebraucht werden, aber nicht geladen sind: dann Kursdatei anbieten */
  ratesMissing: boolean;
  error: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const KIND_LABEL = { security: "Wertpapier", securitizedDerivative: "Derivat", crypto: "Krypto", derivative: "Option/Future" } as const;
const BROKER_KIND = { sale: "Verkauf", dividend: "Ausschüttung", interest: "Zinsen" } as const;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** heutiges Datum in der Ortszeit des Geräts (JJJJ-MM-TT) */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** JJJJ-MM-TT → TT.MM.JJJJ für Fließtext */
const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

const state: State = {
  history: emptyHistory(),
  mode: "sample",
  data: null,
  duplicates: 0,
  periods: [],
  storageOk: true,
  storageError: "",
  notice: "",
  year: new Date().getFullYear(),
  rates: null,
  ratesStatus: "",
  ratesMissing: false,
  error: "",
};
/** Zählt Ladevorgänge, damit ein später eintreffender Kursabruf keine neueren Daten überschreibt. */
let loadId = 0;

/** Holt die EZB-Kurse, die die Daten brauchen. Ohne Beträge in Fremdwährung wird nichts abgerufen. */
function loadRates(data: ImportResult | null) {
  const id = ++loadId;
  state.rates = null;
  const need = data ? ratesNeeded(data) : null;
  if (!need) {
    state.ratesStatus = "";
    state.ratesMissing = false;
    return;
  }
  state.ratesStatus = `Lade EZB-Referenzkurse für ${need.currencies.join(", ")} von der EZB …`;
  state.ratesMissing = true;
  fetchEcbRates(need).then(
    (table) => {
      if (id !== loadId) return;
      state.rates = table;
      state.ratesMissing = false;
      state.ratesStatus = `EZB-Referenzkurse für ${need.currencies.join(", ")} von ${need.start} bis ${need.end} geladen.`;
      render();
    },
    (e: unknown) => {
      if (id !== loadId) return;
      state.ratesStatus = `${e instanceof Error ? e.message : String(e)} Du kannst die Datei eurofxref-hist.csv von der EZB-Website selbst laden.`;
      render();
    },
  );
}

function yearsOf(data: ImportResult): number[] {
  const ys = new Set<number>();
  for (const t of data.trades) if (t.side === "sell") ys.add(Number(t.date.slice(0, 4)));
  for (const i of data.interest) ys.add(Number(i.date.slice(0, 4)));
  for (const d of data.dividends) ys.add(Number(d.date.slice(0, 4)));
  ys.delete(NaN);
  if (ys.size === 0) ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

/** Berechnet die angezeigten Daten neu: Beispieldaten oder alle gespeicherten Dateien zusammengeführt. */
function refresh() {
  try {
    state.periods = [];
    if (state.mode === "sample") {
      state.data = parseExport(sampleCsv).data;
      state.duplicates = 0;
    } else if (state.history.files.length === 0) {
      state.data = null;
      state.duplicates = 0;
    } else {
      const c = combine(state.history);
      state.data = c.data;
      state.duplicates = c.duplicates;
      state.periods = filePeriods(state.history);
    }
  } catch (e) {
    state.data = null;
    state.error = `Die gespeicherten Daten konnten nicht ausgewertet werden: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (state.data) {
    const years = yearsOf(state.data);
    if (!years.includes(state.year)) state.year = years[0] ?? state.year;
  }
  loadRates(state.data);
  render();
}

/** Speichert die Historie im Browser. Klappt das nicht, bleibt die App benutzbar und weist auf das Backup hin. */
function persist() {
  if (!state.storageOk) return;
  saveHistory(state.history).catch((e: unknown) => {
    state.storageOk = false;
    state.storageError = e instanceof Error ? e.message : String(e);
    render();
  });
}

function addText(name: string, text: string) {
  try {
    const r = addFile(state.history, name, text, new Date().toISOString(), newId());
    state.error = "";
    state.notice = r.added ? `„${name}“ gespeichert (${r.broker}).` : `„${name}“ ist bereits gespeichert, nichts geändert.`;
    state.history = r.history;
    state.mode = "history";
    if (r.added) persist();
    refresh();
  } catch (e) {
    // Die gespeicherten Daten bleiben unverändert; die fehlerhafte Datei wird nicht übernommen.
    state.notice = "";
    state.error = `Die Datei „${name}“ konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`;
    render();
  }
}

function readFile(file: File) {
  file.text().then(
    (t) => addText(file.name, t),
    () => {
      state.error = `Die Datei „${file.name}“ konnte nicht geöffnet werden. Bitte wähle sie noch einmal aus.`;
      render();
    },
  );
}

function readRateFile(file: File) {
  file.text().then(
    (text) => {
      try {
        state.rates = parseRateFile(text);
        loadId++; // ein noch laufender Abruf soll die gewählte Datei nicht überschreiben
        state.ratesMissing = false;
        state.ratesStatus = `EZB-Kurse aus ${file.name} geladen.`;
      } catch (e) {
        state.ratesStatus = e instanceof Error ? e.message : String(e);
      }
      render();
    },
    () => {
      state.ratesStatus = "Die Kursdatei konnte nicht geöffnet werden.";
      render();
    },
  );
}

/** Lädt Daten als Datei herunter, ohne Server: alles entsteht im Browser. */
function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveBackup() {
  download(`kest-ruecklage-backup-${today()}.json`, toBackup(state.history, new Date().toISOString()), "application/json");
  state.notice = "Backup gespeichert. Bewahre die Datei sicher auf, sie enthält deine vollständigen Exporte.";
  render();
}

function readBackup(file: File) {
  file.text().then(
    (text) => {
      try {
        const r = restoreBackup(state.history, fromBackup(text), newId);
        state.history = r.history;
        state.mode = "history";
        state.error = "";
        state.notice = `Backup geladen: ${r.added} ${r.added === 1 ? "Datei" : "Dateien"} ergänzt, ${r.skipped} bereits vorhanden. Einstellungen aus dem Backup übernommen, Rücklagen-Einträge ergänzt.`;
        applySettingsToControls();
        persist();
        refresh();
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e);
        render();
      }
    },
    () => {
      state.error = "Die Backup-Datei konnte nicht geöffnet werden.";
      render();
    },
  );
}

function clearAll() {
  const ok = window.confirm(
    "Alle gespeicherten Dateien, Einstellungen, Rücklagen-Einträge und IBKR-Zugangsdaten in diesem Browser löschen? Das lässt sich nicht rückgängig machen. Sichere vorher ein Backup, wenn du die Daten noch brauchst.",
  );
  if (!ok) return;
  state.history = emptyHistory();
  state.mode = "history";
  state.notice = "Alle gespeicherten Daten in diesem Browser wurden gelöscht.";
  applySettingsToControls();
  if (state.storageOk) clearHistory().catch(() => undefined); // löscht auch die IBKR-Zugangsdaten
  flex = { ...EMPTY_FLEX };
  applyFlexToControls();
  refresh();
}

function applySettingsToControls() {
  const s = state.history.settings;
  $<HTMLInputElement>("since").value = s.taxSimpleSince;
  $<HTMLSelectElement>("ibkrKz").value = s.brokerInterestKz;
  $<HTMLSelectElement>("derivTreatment").value = s.derivativesTreatment;
  $<HTMLInputElement>("otherIncome").value = s.otherIncomeEur;
  $<HTMLInputElement>("buffer").value = String(s.bufferPct);
  // Ort der Rücklage aus der Einrichtung als Vorschlag, eine eigene Eingabe bleibt stehen
  const place = $<HTMLInputElement>("entryPlace");
  if (!place.value) place.value = s.reservePlace;
}

function updateSettings(change: Partial<History["settings"]>) {
  state.history = { ...state.history, settings: { ...state.history.settings, ...change } };
  persist();
  render();
}

function renderStore() {
  const files = state.history.files;
  $("storeNote").textContent = state.storageOk
    ? "Deine Daten liegen nur in diesem Browser auf diesem Gerät, nicht auf einem Server. Löschst du die Browserdaten oder wechselst du das Gerät, sind sie weg: Sichere regelmäßig ein Backup."
    : `Speichern ist in diesem Browser nicht möglich (${state.storageError}). Deine Daten gehen beim Schließen der Seite verloren: Sichere ein Backup.`;
  $("storeNote").classList.toggle("warn", !state.storageOk);
  $("fileList").innerHTML = files.length
    ? files
        .map(
          (f) =>
            `<li><span><b>${esc(f.name)}</b> <small>${esc(f.broker)} · gespeichert am ${esc(f.importedAt.slice(0, 10))}</small></span>` +
            `<button class="link" type="button" data-remove="${esc(f.id)}">Entfernen</button></li>`,
        )
        .join("")
    : `<li class="empty">Noch keine Datei gespeichert.</li>`;
  const empty = files.length === 0 && !hasLedgerData(state.history.reserve);
  $("backupSave").toggleAttribute("disabled", empty);
  $("clearAll").toggleAttribute("disabled", empty);
  $("mine").hidden = !(state.mode === "sample" && files.length > 0);
  $("notice").hidden = !state.notice;
  $("notice").textContent = state.notice;
}

/** Prüfassistent über der Auswertung: prüft alle Buchungen aller Jahre. */
function renderCheck(data: ImportResult | null) {
  if (!data) {
    $("checkBand").hidden = true;
    return;
  }
  const input: CheckInput = { data, duplicates: state.duplicates, periods: state.periods };
  if (state.rates) input.rates = state.rates;
  if (state.history.settings.taxSimpleSince) input.taxSimpleSince = state.history.settings.taxSimpleSince;
  // Solange die EZB-Kurse noch laden, nicht vorschnell „nicht geladen“ melden.
  const findings = checkBookings(input).filter((f) => !(f.code === "rates-not-loaded" && state.ratesStatus.startsWith("Lade")));
  $("checkBand").hidden = false;
  const counts = (["error", "warning", "info"] as const)
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${n === 1 ? SEVERITY_LABEL[s] : { error: "Fehler", warning: "Warnungen", info: "Hinweise" }[s]}`);
  $("checkSummary").textContent = findings.length
    ? `${counts.join(", ")}. Geprüft werden alle gespeicherten Buchungen, nicht nur das gewählte Jahr.`
    : "Keine Auffälligkeiten in den Buchungen.";
  $("checkList").innerHTML = findings
    .map(
      (f) =>
        `<li class="sev-${f.severity}"><span class="badge">${SEVERITY_LABEL[f.severity]}</span><span>${esc(f.text)}` +
        `${f.at.length ? ` <small>${esc(formatLocations(f.at))}</small>` : ""}</span></li>`,
    )
    .join("");
}

/** Zeigt statt der Auswertung einen klaren Leerzustand; die Seite bleibt bedienbar. */
function renderEmpty() {
  $("source").innerHTML = "Noch keine Datei geladen.";
  $("year").innerHTML = "";
  $("yearLabel").textContent = "–";
  $("reserve").textContent = "–";
  $("reserveNote").textContent = "Keine Auswertung. Wähle deinen Export (Trade Republic oder IBKR) oder sieh dir die Beispieldaten an.";
  $("bufferOut").textContent = `${state.history.settings.bufferPct} %`;
  $("figs").innerHTML = "";
  $("bars").innerHTML = `<li class="empty">Keine Daten.</li>`;
  $("kz").innerHTML = `<tr><td colspan="3" class="empty">Keine Daten.</td></tr>`;
  $("open").innerHTML = `<tr><td colspan="4" class="empty">Keine Daten.</td></tr>`;
  $("todo").hidden = true;
  $("todoList").innerHTML = "";
  $("divBlock").hidden = true;
  $("brokerBlock").hidden = true;
  $("kzSetting").hidden = true;
  $("derivSetting").hidden = true;
  $("incomeSetting").hidden = true;
  $("copy").onclick = null;
  $("pdfOut").onclick = null;
  $("csvOut").onclick = null;
}

function yearOptions(): YearOptions {
  const s = state.history.settings;
  const options: YearOptions = {
    brokerInterestKz: s.brokerInterestKz,
    derivativesTreatment: s.derivativesTreatment,
    otherIncomeEur: s.otherIncomeEur,
  };
  if (s.taxSimpleSince) options.taxSimpleSince = s.taxSimpleSince;
  if (state.rates) options.rates = state.rates;
  return options;
}

/**
 * Zwischenspeicher für Rechnungen über die ganze Historie (Soll-Verlauf, Zahlen für die Erinnerungen). Gilt, solange
 * Daten und Kurse gleich bleiben; der Schlüssel enthält Einstellungen und Stichtag.
 */
let calcCache: { data: ImportResult; rates: RateTable | null; values: Map<string, unknown> } | null = null;
function cached<T>(data: ImportResult, name: string, now: string, compute: () => T): T {
  if (!calcCache || calcCache.data !== data || calcCache.rates !== state.rates) calcCache = { data, rates: state.rates, values: new Map() };
  const key = JSON.stringify([name, state.history.settings, now]);
  if (!calcCache.values.has(key)) calcCache.values.set(key, compute());
  return calcCache.values.get(key) as T;
}

/**
 * Soll-Verlauf: rechnet jedes Jahr und im laufenden Jahr jeden Buchungstag neu. Bezahlte Jahre blendet erst
 * `reserveStatus` aus, damit „Steuer bezahlt“ und „Rückgängig“ nichts neu rechnen müssen.
 */
const yearSolls = (data: ImportResult, now: string): YearSoll[] =>
  cached(data, "soll", now, () => sollTimeline(data, yearOptions(), state.history.settings.bufferPct, now, {}));

interface LedgerState {
  /** `null` ohne Daten oder wenn die Rechnung scheitert */
  solls: YearSoll[] | null;
  calcError: string;
  status: ReserveStatus;
}

function ledgerState(data: ImportResult | null, now: string): LedgerState {
  let solls: YearSoll[] | null = null;
  let calcError = "";
  if (data) {
    try {
      solls = yearSolls(data, now);
    } catch (e) {
      calcError = `Das Soll konnte nicht berechnet werden: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { solls, calcError, status: reserveStatus(solls ?? [], state.history.reserve, now) };
}

/** Erinnerungen über der Auswertung; nur für die eigenen gespeicherten Daten, nicht für die Beispieldaten. */
function renderReminders(data: ImportResult | null, ls: LedgerState, now: string) {
  const files = state.history.files;
  if (state.mode !== "history" || files.length === 0) {
    $("remindBand").hidden = true;
    return;
  }
  const year = Number(now.slice(0, 4));
  let currentYear: YearFigures | null = null;
  let previousYear: YearFigures | null = null;
  if (data) {
    try {
      currentYear = cached(data, "current", now, () => yearFigures(computeYear(data, year, { ...yearOptions(), asOf: now })));
      previousYear = cached(data, "previous", now, () => yearFigures(computeYear(data, year - 1, yearOptions())));
    } catch {
      // Den Fehler zeigt die Auswertung darunter.
    }
  }
  const list = reminders({
    today: now,
    reserve: ls.solls ? ls.status : null,
    lastImportAt: files.map((f) => f.importedAt).sort().pop() ?? null,
    currentYear,
    previousYear,
    paidYears: state.history.reserve.paidYears,
  });
  $("remindBand").hidden = list.length === 0;
  $("remindList").innerHTML = list
    .map(
      (r) =>
        `<li class="sev-${r.severity}"><span class="badge">${r.severity === "warning" ? "Warnung" : "Hinweis"}</span><span>${esc(r.text)}` +
        `${r.source ? ` <a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.label)}</a>` : ""}</span></li>`,
    )
    .join("");
}

const statusCell = (label: string, value: string, note = "", cls = "") =>
  `<div${cls ? ` class="${cls}"` : ""}><dt>${label}</dt><dd>${value}</dd>${note ? `<small>${note}</small>` : ""}</div>`;

const hasLedgerData = (l: Ledger) => l.entries.length > 0 || l.investment !== null || Object.keys(l.paidYears).length > 0;

function updateReserve(reserve: Ledger) {
  state.history = { ...state.history, reserve };
  persist();
  render();
}

/** Bereich „Rücklage“: Soll offener Jahre gegen den eingetragenen Marktwert, Freigabe erst nach dem 31.12. */
function renderLedger(data: ImportResult | null, ls: LedgerState, now: string) {
  const ledger = state.history.reserve;
  const sample = state.mode === "sample";
  $("ledgerSample").hidden = !sample;
  const { solls, calcError, status: st } = ls;
  const ist = st.istEur
    ? statusCell("Ist", formatEur(st.istEur), `Stand ${deDate(st.istDate ?? "")}${st.istPlace ? `, ${esc(st.istPlace)}` : ""}`)
    : statusCell("Ist", "–", "noch kein Stand eingetragen");
  const cells = [
    solls
      ? statusCell("Soll offener Jahre", formatEur(st.sollEur), st.complete ? "" : "unvollständig berechnet, kann höher sein")
      : statusCell("Soll offener Jahre", "–", data ? "nicht berechnet" : "noch keine Datei gespeichert"),
    ist,
  ];
  if (solls && st.istEur) {
    const short = st.shortfallEur.toDecimalPlaces(2).gt(0);
    cells.push(
      short
        ? statusCell("Fehlbetrag", formatEur(st.shortfallEur), "so viel fehlt bis zum Soll", "short")
        : statusCell("Überschuss", formatEur(st.surplusEur), "über dem Soll"),
      statusCell(
        "Freigegeben",
        formatEur(st.releasableEur),
        st.lockedUntil ? `${formatEur(st.lockedEur)} gesperrt, frei ab ${deDate(st.lockedUntil)}` : short ? "" : "über dem Soll und nicht gesperrt",
      ),
    );
  } else {
    cells.push(statusCell("Fehlbetrag oder Überschuss", "–"), statusCell("Freigegeben", "–"));
  }
  $("ledgerStatus").innerHTML = cells.join("");
  $("ledgerNote").textContent =
    (calcError ? `${calcError} ` : "") +
    (solls && !st.complete ? "Mindestens ein offenes Jahr enthält Buchungen, die nicht berechnet sind (siehe „Nicht berechnet“ im jeweiligen Jahr). " : "") +
    "Was über dem Soll liegt, gibt die App erst nach dem 31.12. frei: Bis dahin zählt für das laufende Jahr der höchste Soll-Wert des Jahres, auch wenn ein späterer Verlust das Soll senkt.";

  const shown = st.years.filter((y) => !y.closed || y.sollEur.gt(0) || !y.complete).reverse();
  $("ledgerYears").innerHTML = !solls
    ? `<tr><td colspan="4" class="empty">${data ? "Nicht berechnet." : "Keine Daten."}</td></tr>`
    : shown.length
      ? shown
          .map(
            (y) =>
              `<tr><td>${y.year}</td><td>${
                y.closed ? "abgeschlossen, Steuer offen" : `laufend, höchstes Soll bisher ${formatEur(y.peakEur)}`
              }${y.complete ? "" : " · unvollständig"}</td><td class="num">${formatEur(y.sollEur)}</td><td>${
                y.closed && !sample ? `<button class="link ok" type="button" data-paid="${y.year}">Steuer bezahlt</button>` : ""
              }</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="empty">Keine offenen Jahre.</td></tr>`;

  const paid = Object.entries(ledger.paidYears).sort(([a], [b]) => b.localeCompare(a));
  $("paidBlock").hidden = paid.length === 0;
  $("paidList").innerHTML = paid
    .map(
      ([year, date]) =>
        `<li><span><b>${esc(year)}</b><small>als bezahlt markiert am ${esc(deDate(date))}, zählt nicht mehr zum Soll</small></span>` +
        `<button class="link" type="button" data-unpaid="${esc(year)}">Rückgängig</button></li>`,
    )
    .join("");

  const entries = ledger.entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.date.localeCompare(a.e.date) || b.i - a.i);
  $("entries").innerHTML = entries
    .map(({ e }) => {
      const tag = e.id === st.istEntryId ? " · zählt als aktueller Stand" : e.date > now ? " · zählt erst ab diesem Tag" : "";
      const details = [deDate(e.date), e.place, e.note].filter(Boolean).map(esc).join(" · ");
      return (
        `<li><span><b>${formatEur(dec(e.valueEur))}</b><small>${details}${tag}</small></span>` +
        `<button class="link" type="button" data-entry="${esc(e.id)}">Entfernen</button></li>`
      );
    })
    .join("");

  const inv = ledger.investment;
  $<HTMLSelectElement>("invKind").value = inv?.kind ?? "";
  $<HTMLSelectElement>("invFund").value = inv?.reportingFund ?? "";
  $<HTMLSelectElement>("invSri").value = inv?.sri ? String(inv.sri) : "";
  const noDetails = !inv || inv.kind === "deposit";
  $("invFund").toggleAttribute("disabled", noDetails);
  $("invSri").toggleAttribute("disabled", noDetails);
  $("invFindings").innerHTML = inv
    ? checkInvestment(inv)
        .map(
          (f) =>
            `<li class="sev-${f.severity}"><span class="badge">${f.severity === "ok" ? "Erfüllt" : "Warnung"}</span><span>${esc(f.text)}</span></li>`,
        )
        .join("")
    : `<li class="empty">Wähle die Anlageart, dann prüft die App die Kriterien.</li>`;
}

/** zuletzt berechneter Stand der Rücklage, für den Kauf-Check */
let lastLedger: LedgerState | null = null;
let simPositionsKey = "";

/** Verkaufs-Simulator (Schritt 3.3): Auswahl der offenen Positionen zum heutigen Tag. */
function renderSimulator(data: ImportResult | null, now: string) {
  const select = $<HTMLSelectElement>("simPos");
  let positions: Array<{ key: string; label: string; quantity: string }> = [];
  if (data) {
    try {
      const report = cached(data, "today", now, () => computeYear(data, Number(now.slice(0, 4)), { ...yearOptions(), asOf: now }));
      const names = new Map(data.trades.map((t) => [`${t.depot}|${t.isin}`, t.name]));
      positions = report.openPositions.map((p) => {
        const key = `${p.depot}|${p.isin}`;
        return {
          key,
          quantity: p.quantity.toString(),
          label: `${names.get(key) || p.isin} · ${p.depot} · ${p.quantity.toString()} Stück · Ø ${formatEur(p.avgPriceEur)}`,
        };
      });
    } catch {
      positions = [];
    }
  }
  const key = positions.map((p) => p.key + p.quantity).join(";");
  if (key === simPositionsKey) return;
  simPositionsKey = key;
  const selected = select.value;
  select.innerHTML = positions.length
    ? positions.map((p) => `<option value="${esc(p.key)}" data-qty="${esc(p.quantity)}">${esc(p.label)}</option>`).join("")
    : `<option value="">Keine offene Position</option>`;
  if (positions.some((p) => p.key === selected)) select.value = selected;
  $<HTMLInputElement>("simQty").value = select.selectedOptions[0]?.dataset.qty ?? "";
  $("simResult").hidden = true;
  $("simNote").textContent = "";
  $<HTMLFormElement>("simForm").querySelector("button")?.toggleAttribute("disabled", positions.length === 0);
}

function runSimulation() {
  const [depot = "", isin = ""] = $<HTMLSelectElement>("simPos").value.split("|");
  const error = $("simError");
  if (!state.data || !isin) return;
  try {
    const s = simulateSale({
      data: state.data,
      options: yearOptions(),
      bufferPct: state.history.settings.bufferPct,
      today: today(),
      isin,
      depot,
      quantity: $<HTMLInputElement>("simQty").value,
      priceEur: $<HTMLInputElement>("simPrice").value,
      feeEur: $<HTMLInputElement>("simFee").value,
    });
    error.hidden = true;
    const loss = s.gainEur.lt(0);
    const change = s.taxChangeEur;
    $("simResult").hidden = false;
    $("simResult").innerHTML = [
      statusCell("Erlös", formatEur(s.proceedsEur), `${$<HTMLInputElement>("simQty").value} Stück`),
      statusCell("Anschaffungskosten", formatEur(s.costEur), `Ø ${formatEur(s.avgPriceEur)} je Stück`),
      statusCell(loss ? "Verlust" : "Gewinn", formatEur(s.gainEur.abs()), "", loss ? "short" : ""),
      statusCell(
        `Steuer ${s.year} bis heute`,
        `${change.gte(0) ? "+" : "−"} ${formatEur(change.abs())}`,
        `${formatEur(s.taxBeforeEur)} ohne, ${formatEur(s.taxAfterEur)} mit diesem Verkauf; Soll ${formatEur(s.sollBeforeEur)} → ${formatEur(s.sollAfterEur)}`,
      ),
    ].join("");
    $("simNote").textContent =
      (s.taxedByBroker
        ? "Dieser Verkauf wäre bei Trade Republic endbesteuert: Trade Republic zieht die KESt selbst ab, deine E1kv und die Rücklage ändern sich dadurch nicht. "
        : "") +
      (s.complete ? "" : "Achtung: Im Jahr ist etwas „nicht berechnet“, die Zahlen können unvollständig sein. ") +
      "Spesen mindern den Gewinn im 27,5 %-Topf nicht.";
  } catch (e) {
    error.hidden = false;
    error.textContent = e instanceof Error ? e.message : String(e);
    $("simResult").hidden = true;
  }
}

function runOrderCheck() {
  const error = $("ocError");
  const out = $("ocResult");
  if (!lastLedger) return;
  try {
    const order = $<HTMLInputElement>("ocOrder").value;
    // Zahlenfelder liefern bei leerer oder ungültiger Eingabe einen leeren Wert
    if ($<HTMLInputElement>("ocCash").value === "") throw new Error("Bitte trag dein Guthaben in Euro ein.");
    if (order === "") throw new Error("Bitte trag den Betrag der Order in Euro ein.");
    const c = checkOrder({ cashEur: $<HTMLInputElement>("ocCash").value, orderEur: order, reserveInAccount: $<HTMLInputElement>("ocInAccount").checked }, lastLedger.status);
    error.hidden = true;
    out.hidden = false;
    out.classList.toggle("short", !c.enough);
    const keep = `Für die Rücklage müssen ${formatEur(c.mustKeepEur)} im Guthaben bleiben, frei sind ${formatEur(c.freeEur)}.`;
    out.textContent = c.enough
      ? `${keep} Die Order über ${formatEur(dec(order))} ist gedeckt.`
      : `${keep} Für die Order über ${formatEur(dec(order))} fehlen ${formatEur(c.missingEur)}, wenn die Rücklage gedeckt bleiben soll.`;
  } catch (e) {
    error.hidden = false;
    error.textContent = e instanceof Error ? e.message : String(e);
    out.hidden = true;
  }
}

// ---------------------------------------------------------------- Automatischer IBKR-Abruf (Phase 4, Schritt 4.1)

const EMPTY_FLEX: FlexSettings = {
  token: "",
  queryId: "",
  since: "",
  relay: "http://localhost:8787",
  auto: false,
  lastSync: "",
  snapClientId: "",
  snapConsumerKey: "",
  lastSnapSync: "",
};
let flex: FlexSettings = { ...EMPTY_FLEX };
let syncing = false;
const ROLLING_NAME = "IBKR automatisch (letzte 365 Tage).xml";

function applyFlexToControls() {
  $<HTMLInputElement>("syncToken").value = flex.token;
  $<HTMLInputElement>("syncQuery").value = flex.queryId;
  $<HTMLInputElement>("syncSince").value = flex.since;
  $<HTMLInputElement>("syncRelay").value = flex.relay;
  $<HTMLInputElement>("syncAuto").checked = flex.auto;
  $<HTMLInputElement>("snapClientId").value = flex.snapClientId;
  $<HTMLInputElement>("snapConsumerKey").value = flex.snapConsumerKey;
  if (flex.token || flex.snapClientId) $<HTMLDetailsElement>("syncBox").open = true;
  if (flex.lastSnapSync) $("snapStatus").textContent = `Letzter erfolgreicher SnapTrade-Abruf: ${deDate(flex.lastSnapSync)}.`;
  if (flex.lastSync) $("syncStatus").textContent = `Letzter erfolgreicher Abruf: ${deDate(flex.lastSync)}.`;
}

function readFlexControls(): FlexSettings {
  return {
    token: $<HTMLInputElement>("syncToken").value.trim(),
    queryId: $<HTMLInputElement>("syncQuery").value.trim(),
    since: $<HTMLInputElement>("syncSince").value,
    relay: $<HTMLInputElement>("syncRelay").value.trim(),
    auto: $<HTMLInputElement>("syncAuto").checked,
    lastSync: flex.lastSync,
    snapClientId: $<HTMLInputElement>("snapClientId").value.trim(),
    snapConsumerKey: $<HTMLInputElement>("snapConsumerKey").value.trim(),
    lastSnapSync: flex.lastSnapSync,
  };
}

const minusDays = (iso: string, days: number) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) - days)).toISOString().slice(0, 10);

/**
 * Ruft die Flex Query über das Relay ab und speichert sie wie eine importierte Datei. Erster Abruf: ab „Erster Abruf ab“
 * in Fenstern von 365 Tagen. Danach: die letzten 365 Tage als laufende Datei, die bei jedem Abruf ersetzt wird.
 */
/**
 * SnapTrade Personal über das Relay. Der Abruf enthält die ganze bekannte Historie aller verbundenen Konten; er ersetzt
 * den vorigen SnapTrade-Abruf in der Historie.
 */
let snapSyncing = false;
async function runSnapSync() {
  if (snapSyncing) return;
  const status = $("snapStatus");
  if (!flex.snapClientId || !flex.snapConsumerKey) {
    status.textContent = "Bitte Client ID und Consumer Key eintragen.";
    return;
  }
  snapSyncing = true;
  const now = today();
  status.textContent = "Rufe bei SnapTrade ab …";
  try {
    const text = await syncSnapTradeViaRelay(
      { relay: flex.relay, clientId: flex.snapClientId, consumerKey: flex.snapConsumerKey },
      { fetchFn: (url, init) => fetch(url, init) },
    );
    const base = { ...state.history, files: state.history.files.filter((f) => f.broker !== "SnapTrade") };
    const r = addFile(base, `SnapTrade ${now}.json`, text, new Date().toISOString(), newId());
    state.history = r.history;
    state.mode = "history";
    state.error = "";
    flex = { ...flex, lastSnapSync: now };
    saveFlexSettings(flex).catch(() => undefined);
    persist();
    refresh();
    const snap = JSON.parse(text) as { accounts?: unknown[] };
    status.textContent = `Abruf am ${deDate(now)} erfolgreich: ${snap.accounts?.length ?? 0} ${snap.accounts?.length === 1 ? "Konto" : "Konten"}.`;
  } catch (e) {
    status.textContent = `Abruf nicht möglich: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    snapSyncing = false;
  }
}

async function runSync(mode: "full" | "rolling") {
  if (syncing) return;
  const status = $("syncStatus");
  if (!flex.token || !flex.queryId) {
    status.textContent = "Bitte Token und Query-ID eintragen.";
    return;
  }
  syncing = true;
  const now = today();
  const from = mode === "full" ? flex.since || `${Number(now.slice(0, 4)) - 1}-01-01` : minusDays(now, 364);
  status.textContent = `Rufe bei IBKR ab (${deDate(from)} bis ${deDate(now)}) …`;
  try {
    const parts = await syncViaRelay(
      { relay: flex.relay, token: flex.token, queryId: flex.queryId, from, to: now },
      {
        fetchFn: (url, init) => fetch(url, init),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        onProgress: (done, total) => {
          if (total > 1) status.textContent = `${done} von ${total} Zeiträumen geladen. IBKR erlaubt nur wenige Abrufe je Minute, bitte warten …`;
        },
      },
    );
    let history = state.history;
    let added = 0;
    for (const p of parts) {
      const name = mode === "rolling" ? ROLLING_NAME : `IBKR automatisch ${p.from} bis ${p.to}.xml`;
      if (mode === "rolling") history = { ...history, files: history.files.filter((f) => f.name !== ROLLING_NAME) };
      const r = addFile(history, name, p.xml, new Date().toISOString(), newId()); // prüft die Flex Query wie beim Datei-Import
      history = r.history;
      if (r.added) added++;
    }
    state.history = history;
    state.mode = "history";
    state.error = "";
    flex = { ...flex, lastSync: now };
    saveFlexSettings(flex).catch(() => undefined);
    persist();
    refresh();
    status.textContent = `Abruf am ${deDate(now)} erfolgreich: ${parts.length} ${parts.length === 1 ? "Zeitraum" : "Zeiträume"}, ${added} ${added === 1 ? "Datei" : "Dateien"} gespeichert.`;
  } catch (e) {
    status.textContent = `Abruf nicht möglich: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    syncing = false;
  }
}

function readInvestment(): ReserveInvestment | null {
  const kind = $<HTMLSelectElement>("invKind").value as InvestmentKind | "";
  if (!kind) return null;
  if (kind === "deposit") return { kind, reportingFund: null, sri: null };
  const fund = $<HTMLSelectElement>("invFund").value;
  const sri = $<HTMLSelectElement>("invSri").value;
  const isFund = kind === "moneyMarketFund" || kind === "equityEtf" || kind === "longBondEtf";
  return {
    kind,
    // bei einem Fonds ist „kein Fonds“ widersprüchlich: dann „weiß nicht“
    reportingFund: fund === "yes" || fund === "no" || fund === "unknown" ? fund : isFund ? "unknown" : null,
    sri: sri ? Number(sri) : null,
  };
}

function kzRows(r: YearReport): Array<[string, string, Dec]> {
  return [
    ["994", "Überschüsse aus Wertpapieren", r.kz994],
    ["892", "Verluste aus Wertpapieren", r.kz892],
    ["995", "Überschüsse aus Derivaten", r.kz995],
    ["896", "Verluste aus Derivaten", r.kz896],
    ["174", "Überschüsse aus Krypto", r.kz174],
    ["176", "Verluste aus Krypto", r.kz176],
    ["863", "Dividenden, Wertpapierzinsen", r.kz863],
    ["998", "Anrechenbare Quellensteuer", r.kz998],
    ["861", "Zinsen aus Geldeinlagen (25 %)", r.kz861],
    ["857", "Optionen und Futures zum Tarif", r.kz857],
  ];
}

function render() {
  const settings = state.history.settings;
  $("error").hidden = !state.error;
  $("error").textContent = state.error;
  $("ratesBox").hidden = !state.ratesStatus;
  $("ratesStatus").textContent = state.ratesStatus;
  $("rateFileBtn").hidden = !state.ratesMissing;
  renderStore();
  const data = state.data;
  const now = today();
  const ls = ledgerState(data, now);
  lastLedger = ls;
  renderReminders(data, ls, now);
  renderCheck(data);
  renderLedger(data, ls, now);
  renderSimulator(data, now);
  if (!data) {
    renderEmpty();
    return;
  }

  let report: YearReport;
  try {
    report = computeYear(data, state.year, yearOptions());
  } catch (e) {
    state.error = `Berechnung nicht möglich: ${e instanceof Error ? e.message : String(e)}`;
    $("error").hidden = false;
    $("error").textContent = state.error;
    renderEmpty();
    return;
  }
  const tax = report.tax275Eur.plus(report.tax25Eur).plus(report.tariffExtraTaxEur);
  const reserve = reserveTarget({
    basket275TaxEur: report.tax275Eur,
    bankInterestTaxEur: report.tax25Eur,
    tariffExtraTaxEur: report.tariffExtraTaxEur,
    bufferRate: dec(settings.bufferPct).div(100),
  });

  const files = state.history.files.length;
  $("source").innerHTML =
    state.mode === "sample"
      ? "Beispieldaten. Zieh deinen eigenen Export hierher, um deine Zahlen zu sehen."
      : `Ausgewertet: <b>${files} ${files === 1 ? "gespeicherte Datei" : "gespeicherte Dateien"}</b> · ${data.trades.length} Trades` +
        (state.duplicates > 0
          ? ` · ${state.duplicates} ${state.duplicates === 1 ? "doppelte Buchung" : "doppelte Buchungen"} nur einmal gezählt`
          : "");
  $("kzSetting").hidden = !data.interest.some((i) => i.source === "broker");
  const hasDerivatives = data.trades.some((t) => t.kind === "derivative");
  $("derivSetting").hidden = !hasDerivatives;
  // Sonstiges Einkommen nur abfragen, wenn tarifbesteuerte Derivate vorkommen (PRODUKTPLAN, Einrichtung)
  $("incomeSetting").hidden = !(hasDerivatives && settings.derivativesTreatment === "tariff");
  $("year").innerHTML = yearsOf(data)
    .map((y) => `<option value="${y}"${y === state.year ? " selected" : ""}>${y}</option>`)
    .join("");
  $("yearLabel").textContent = String(state.year);
  $("reserve").textContent = formatEur(reserve);
  const open = report.notComputed.length;
  $("reserveNote").textContent =
    (tax.toDecimalPlaces(2).isZero()
      ? report.unusedLossEur.gt(0)
        ? `Keine Steuer: ${formatEur(report.unusedLossEur)} Verlust bleibt übrig. Er verfällt am Jahresende.`
        : "Noch keine steuerpflichtigen Erträge in diesem Jahr."
      : `${formatEur(tax)} Steuer plus ${settings.bufferPct} % Sicherheitspuffer.`) +
    (report.taxSimpleSince
      ? ` Erträge ab ${report.taxSimpleSince} hat Trade Republic selbst versteuert; sie zählen hier nicht.`
      : "") +
    (open > 0
      ? ` Achtung: ${open} ${open === 1 ? "Hinweis" : "Hinweise"} unten unter „Nicht berechnet“, das Ergebnis kann unvollständig sein.`
      : "");
  $("bufferOut").textContent = `${settings.bufferPct} %`;

  const figs: Array<[string, Dec]> = [
    ["Steuer 27,5 %", report.tax275Eur],
    ["Steuer 25 % auf Zinsen", report.tax25Eur],
    ...(report.derivativesTreatment === "tariff" && report.kz857.gt(0)
      ? [["Mehrsteuer Optionen/Futures (Tarif)", report.tariffExtraTaxEur] as [string, Dec]]
      : []),
    ["Nicht ausgeglichener Verlust", report.unusedLossEur],
    ["Ordergebühren, nicht abziehbar", report.feesEur],
    ...(report.taxSimpleSince ? [["Von Trade Republic einbehalten", report.brokerWithheldEur] as [string, Dec]] : []),
  ];
  $("figs").innerHTML = figs.map(([l, v]) => `<div><dt>${l}</dt><dd>${formatEur(v)}</dd></div>`).join("");

  const rows = report.realized;
  const max = D.max(dec("0.01"), ...rows.map((x) => x.gainEur.abs()));
  $("bars").innerHTML = rows.length
    ? rows
        .map((x) => {
          const w = x.gainEur.abs().div(max).times(100).toDecimalPlaces(1).toString();
          const neg = x.gainEur.lt(0);
          return `<li><span class="who"><b>${esc(x.name)}</b><small>${x.date} · ${KIND_LABEL[x.kind]}</small></span>
            <span class="track"><span class="half l">${neg ? `<i class="bar neg" style="width:${w}%"></i>` : ""}</span><span class="half r">${neg ? "" : `<i class="bar pos" style="width:${w}%"></i>`}</span></span>
            <span class="val ${neg ? "n" : "p"}">${formatEur(x.gainEur)}</span></li>`;
        })
        .join("")
    : `<li class="empty">In ${state.year} wurde noch nichts verkauft.</li>`;

  $("kz").innerHTML = kzRows(report)
    .map(([kz, l, v]) => `<tr class="${v.isZero() ? "zero" : ""}"><td>KZ ${kz}</td><td>${l}</td><td class="num">${formatEur(v)}</td></tr>`)
    .join("");
  $("kzSub").textContent = report.taxSimpleSince
    ? `Ausländische Kapitaleinkünfte vor dem ${report.taxSimpleSince}, Verluste als positiver Betrag.`
    : "Ausländische Kapitaleinkünfte, Verluste als positiver Betrag.";

  $("divBlock").hidden = report.dividends.length === 0;
  $("div").innerHTML = report.dividends
    .map(
      (d) =>
        `<tr><td>${esc(d.date)}</td><td>${esc(d.name || d.isin)} <small>(${esc(d.country)}, ${
          d.treatySource
            ? `<a href="${esc(d.treatySource)}" target="_blank" rel="noopener">DBA ${d.treatyRate.times(100).toString()} %</a>`
            : "DBA-Satz nicht hinterlegt"
        }${d.ecbRate ? `, ${esc(d.originalCurrency)} zum EZB-Kurs ${d.ecbRate.toString().replace(".", ",")}` : ""})</small></td>` +
        `<td class="num">${formatEur(d.grossEur)}</td><td class="num">${formatEur(d.withheldEur)}</td><td class="num">${formatEur(d.creditableEur)}</td></tr>`,
    )
    .join("");

  $("brokerBlock").hidden = report.taxedByBroker.length === 0;
  $("brokerSub").textContent = report.taxSimpleSince
    ? `Seit ${report.taxSimpleSince} zieht Trade Republic die KESt selbst ab. Diese Erträge sind endbesteuert und zählen nicht für E1kv und Rücklage.`
    : "";
  $("broker").innerHTML =
    report.taxedByBroker
      .map(
        (x) =>
          `<tr><td>${esc(x.date)}</td><td>${BROKER_KIND[x.kind]}${x.name || x.isin ? ` ${esc(x.name || x.isin)}` : ""}</td>` +
          `<td class="num">${formatEur(x.amountEur)}</td><td class="num">${formatEur(x.withheldEur)}</td></tr>`,
      )
      .join("") +
    `<tr><td></td><td><b>Summe einbehalten</b></td><td></td><td class="num"><b>${formatEur(report.brokerWithheldEur)}</b></td></tr>`;

  const openRows = [
    ...report.openPositions.map(
      (p) => `<tr><td>${esc(p.isin)}</td><td class="num">${p.quantity.toString()}</td><td class="num">${formatEur(p.avgPriceEur)}</td><td class="num">${formatEur(p.costEur)}</td></tr>`,
    ),
    // Optionen und Futures: Short (Stillhalter) mit negativer Anzahl, Basis = erhaltene Prämie
    ...report.openDerivatives.map(
      (p) =>
        `<tr><td>${esc(p.symbol)} <small>${p.quantity.lt(0) ? "Stillhalter, Prämie" : "Option/Future"}</small></td><td class="num">${p.quantity.toString()}</td>` +
        `<td class="num">${formatEur(p.basisEur.div(p.quantity.abs()))}</td><td class="num">${formatEur(p.basisEur)}</td></tr>`,
    ),
  ];
  $("open").innerHTML = openRows.length ? openRows.join("") : `<tr><td colspan="4" class="empty">Keine offenen Positionen.</td></tr>`;

  $("todo").hidden = report.notComputed.length === 0;
  $("todoList").innerHTML = report.notComputed
    .map((n) => `<li>${n.file ? `${esc(n.file)}, ` : ""}${n.line ? `Zeile ${n.line}: ` : ""}<code>${esc(n.type)}</code> – ${esc(n.reason)}</li>`)
    .join("");

  $("copy").onclick = async () => {
    const text = kzRows(report)
      .filter(([, , v]) => !v.isZero())
      .map(([kz, l, v]) => `KZ ${kz} ${l}: ${v.toDecimalPlaces(2).toFixed(2).replace(".", ",")}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text || "Keine Beträge");
      $("copy").textContent = "Kopiert";
    } catch {
      $("copy").textContent = "Kopieren nicht möglich";
    }
    setTimeout(() => ($("copy").textContent = "Kennzahlen kopieren"), 1800);
  };

  // E1kv-Bericht (Schritt 3.4): entsteht im Browser, nichts wird hochgeladen
  const reportDoc = () =>
    buildE1kvDocument(report, {
      createdAt: today(),
      files: state.mode === "sample" ? ["Beispieldaten"] : state.history.files.map((f) => f.name),
      settings: state.history.settings,
    });
  $("pdfOut").onclick = () => download(`e1kv-bericht-${report.year}.pdf`, e1kvPdf(reportDoc()), "application/pdf");
  $("csvOut").onclick = () => download(`e1kv-bericht-${report.year}.csv`, e1kvCsv(reportDoc()), "text/csv;charset=utf-8");
}

{
  const drop = $("drop");
  const input = $<HTMLInputElement>("file");
  input.addEventListener("change", () => {
    for (const f of input.files ?? []) readFile(f);
    input.value = ""; // dieselbe Datei nach einer Korrektur erneut wählbar
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  // Daneben fallen gelassene Dateien nicht vom Browser öffnen lassen: die Seite würde sonst verlassen.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer?.files ?? []) readFile(f);
  });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove("over");
    for (const f of e.dataTransfer?.files ?? []) readFile(f);
  });
  $<HTMLSelectElement>("year").addEventListener("change", (e) => {
    state.year = Number((e.target as HTMLSelectElement).value);
    render();
  });
  $<HTMLInputElement>("buffer").addEventListener("input", (e) => updateSettings({ bufferPct: Number((e.target as HTMLInputElement).value) }));
  const rateInput = $<HTMLInputElement>("rateFile");
  rateInput.addEventListener("change", () => {
    if (rateInput.files?.[0]) readRateFile(rateInput.files[0]);
    rateInput.value = "";
  });
  $<HTMLSelectElement>("ibkrKz").addEventListener("change", (e) =>
    updateSettings({ brokerInterestKz: (e.target as HTMLSelectElement).value === "861" ? "861" : "863" }),
  );
  $<HTMLInputElement>("since").addEventListener("change", (e) => updateSettings({ taxSimpleSince: (e.target as HTMLInputElement).value }));
  $<HTMLInputElement>("otherIncome").addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).value.trim();
    // nur ganze oder Dezimalzahlen ≥ 0 übernehmen; sonst bleibt die Angabe leer (keine Schätzung)
    updateSettings({ otherIncomeEur: /^\d+(\.\d+)?$/.test(v) ? v : "" });
  });
  $<HTMLSelectElement>("derivTreatment").addEventListener("change", (e) =>
    updateSettings({ derivativesTreatment: (e.target as HTMLSelectElement).value === "special" ? "special" : "tariff" }),
  );
  $("fileList").addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-remove]")?.dataset.remove;
    if (!id) return;
    const name = state.history.files.find((f) => f.id === id)?.name ?? "";
    state.history = removeFile(state.history, id);
    state.notice = `„${name}“ entfernt.`;
    persist();
    refresh();
  });
  $("backupSave").addEventListener("click", saveBackup);
  const backupInput = $<HTMLInputElement>("backupFile");
  backupInput.addEventListener("change", () => {
    if (backupInput.files?.[0]) readBackup(backupInput.files[0]);
    backupInput.value = "";
  });
  $("clearAll").addEventListener("click", clearAll);

  // Rücklage: Stand eintragen, Einträge entfernen, Jahre als bezahlt markieren, Kriterien der Anlage
  $<HTMLInputElement>("entryDate").value = today();
  $<HTMLFormElement>("entryForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = $<HTMLInputElement>("entryValue");
    const note = $<HTMLInputElement>("entryNote");
    if (value.value === "") {
      // leer oder keine Zahl (das Zahlenfeld liefert dann einen leeren Wert)
      $("ledgerError").hidden = false;
      $("ledgerError").textContent = "Bitte trag den Marktwert in Euro ein, z. B. 3025,50.";
      return;
    }
    try {
      const reserve = addEntry(state.history.reserve, {
        id: newId(),
        date: $<HTMLInputElement>("entryDate").value,
        valueEur: value.value,
        place: $<HTMLInputElement>("entryPlace").value.trim(),
        note: note.value.trim(),
      });
      $("ledgerError").hidden = true;
      value.value = "";
      note.value = "";
      updateReserve(reserve);
    } catch (err) {
      $("ledgerError").hidden = false;
      $("ledgerError").textContent = err instanceof Error ? err.message : String(err);
    }
  });
  $("entries").addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-entry]")?.dataset.entry;
    if (id) updateReserve(removeEntry(state.history.reserve, id));
  });
  $("ledgerYears").addEventListener("click", (e) => {
    const year = (e.target as HTMLElement).closest<HTMLElement>("[data-paid]")?.dataset.paid;
    if (year) updateReserve(markPaid(state.history.reserve, Number(year), today()));
  });
  $("paidList").addEventListener("click", (e) => {
    const year = (e.target as HTMLElement).closest<HTMLElement>("[data-unpaid]")?.dataset.unpaid;
    if (year) updateReserve(unmarkPaid(state.history.reserve, Number(year)));
  });
  for (const id of ["invKind", "invFund", "invSri"]) {
    $(id).addEventListener("change", () => updateReserve({ ...state.history.reserve, investment: readInvestment() }));
  }
  $("sample").addEventListener("click", () => {
    state.mode = "sample";
    state.notice = "";
    refresh();
  });
  $("mine").addEventListener("click", () => {
    state.mode = "history";
    state.notice = "";
    refresh();
  });

  // Verkaufs-Simulator und Kauf-Check (Schritt 3.3)
  $("simPos").addEventListener("change", () => {
    $<HTMLInputElement>("simQty").value = $<HTMLSelectElement>("simPos").selectedOptions[0]?.dataset.qty ?? "";
    $("simResult").hidden = true;
  });
  $<HTMLFormElement>("simForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runSimulation();
  });
  $<HTMLFormElement>("ocForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runOrderCheck();
  });

  // Automatischer IBKR-Abruf (Schritt 4.1)
  $<HTMLFormElement>("syncForm").addEventListener("submit", (e) => {
    e.preventDefault();
    flex = readFlexControls();
    saveFlexSettings(flex).catch(() => undefined);
    void runSync(flex.lastSync ? "rolling" : "full");
  });
  $<HTMLInputElement>("syncAuto").addEventListener("change", () => {
    flex = readFlexControls();
    saveFlexSettings(flex).catch(() => undefined);
  });
  $<HTMLFormElement>("snapForm").addEventListener("submit", (e) => {
    e.preventDefault();
    flex = readFlexControls();
    saveFlexSettings(flex).catch(() => undefined);
    void runSnapSync();
  });
  $("syncForget").addEventListener("click", () => {
    if (!window.confirm("Token, Query-ID, SnapTrade-Schlüssel und Relay-Adresse in diesem Browser löschen? Die abgerufenen Daten bleiben gespeichert.")) return;
    flex = { ...EMPTY_FLEX };
    saveFlexSettings(flex).catch(() => undefined);
    applyFlexToControls();
    $("syncStatus").textContent = "Zugangsdaten gelöscht.";
  });

  // Installierbare Web-App (Schritt 3.5): Service Worker nur in der gehosteten Fassung mit Manifest, nicht in der Einzeldatei
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && document.querySelector('link[rel="manifest"]')) {
    navigator.serviceWorker.register("sw.js").catch(() => undefined);
  }

  // Einrichtungsassistent (Schritt 3.1): beim ersten Besuch automatisch, sonst über den Knopf „Einrichtung“
  const wizard = initSetupWizard({
    history: () => state.history,
    storeFile: (name, text) => {
      const r = addFile(state.history, name, text, new Date().toISOString(), newId());
      state.history = r.history;
      state.mode = "history";
      state.error = "";
      if (r.added) persist();
      refresh();
      return r.added ? "Gespeichert." : "War schon gespeichert.";
    },
    finish: (history) => {
      state.history = history;
      state.mode = "history";
      state.notice = "Einrichtung abgeschlossen. Unten siehst du die Steuer seit Jahresbeginn, die Soll-Rücklage und offene Klärungsfälle.";
      applySettingsToControls();
      persist();
      refresh();
      document.querySelector(".hero")?.scrollIntoView({ behavior: "smooth" });
    },
    today,
  });
  $("setupOpen").addEventListener("click", () => wizard.open());

  loadHistory().then(
    (history) => {
      state.history = history;
      state.mode = history.files.length > 0 ? "history" : "sample";
      applySettingsToControls();
      refresh();
      if (history.files.length === 0 && !history.settings.setupDoneAt) wizard.open();
      loadFlexSettings().then(
        (s) => {
          if (!s) return;
          flex = s;
          applyFlexToControls();
          // automatisch beim Öffnen, höchstens einmal am Tag
          if (s.auto && s.token && s.queryId && s.relay && s.lastSync !== today()) void runSync(s.lastSync ? "rolling" : "full");
          if (s.auto && s.snapClientId && s.snapConsumerKey && s.relay && s.lastSnapSync !== today()) void runSnapSync();
        },
        () => undefined,
      );
    },
    (e: unknown) => {
      state.storageOk = false;
      state.storageError = e instanceof Error ? e.message : String(e);
      state.mode = "sample";
      refresh();
      wizard.open();
    },
  );
}
