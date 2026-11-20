import sampleCsv from "../../test/fixtures/tr-beispiel.csv";
import { dec, D, type Dec } from "../decimal.js";
import { formatEur } from "../format.js";
import { parseRateFile, type RateTable } from "../fx.js";
import type { ImportResult } from "../import/model.js";
import type { Broker } from "../import/readAny.js";
import { reserveTarget } from "../reserve.js";
import { computeYear, type YearOptions, type YearReport } from "../yearReport.js";
import { fetchEcbRates, ratesNeeded } from "./loadRates.js";
import { readExport } from "./readExport.js";

interface State {
  data: ImportResult | null;
  broker: Broker | "";
  /** Kennzahl für IBKR-Zinsen (Einstellung, offene Frage an den Steuerberater) */
  brokerInterestKz: "863" | "861";
  source: string;
  isSample: boolean;
  year: number;
  bufferPct: number;
  /** JJJJ-MM-TT, ab dem Trade Republic die KESt abzieht; leer = nicht steuereinfach */
  taxSimpleSince: string;
  /** EZB-Referenzkurse für Dividenden in Fremdwährung */
  rates: RateTable | null;
  /** Stand des Kursabrufs für die Anzeige; leer, wenn keine Kurse gebraucht werden */
  ratesStatus: string;
  /** true, wenn Kurse gebraucht werden, aber nicht geladen sind: dann Kursdatei anbieten */
  ratesMissing: boolean;
  error: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const KIND_LABEL = { security: "Wertpapier", securitizedDerivative: "Derivat", crypto: "Krypto" } as const;
const BROKER_KIND = { sale: "Verkauf", dividend: "Ausschüttung", interest: "Zinsen" } as const;

const state: State = {
  data: null,
  broker: "",
  brokerInterestKz: "863",
  source: "",
  isSample: true,
  year: 2026,
  bufferPct: 10,
  taxSimpleSince: "",
  rates: null,
  ratesStatus: "",
  ratesMissing: false,
  error: "",
};
/** Zählt Ladevorgänge, damit ein später eintreffender Kursabruf keine neuere Datei überschreibt. */
let loadId = 0;

/** Holt die EZB-Kurse, die die geladene Datei braucht. Ohne Fremdwährungs-Dividenden wird nichts abgerufen. */
function loadRates(data: ImportResult) {
  const id = ++loadId;
  state.rates = null;
  const need = ratesNeeded(data);
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

function load(text: string, source: string, isSample: boolean) {
  const r = readExport(text);
  state.source = source;
  state.isSample = isSample;
  if (r.ok) {
    state.data = r.data;
    state.broker = r.broker;
    state.error = "";
    state.year = yearsOf(r.data)[0] ?? state.year;
    loadRates(r.data);
  } else {
    // Keine alten Zahlen neben einer neuen Datei stehen lassen.
    state.data = null;
    state.error = r.message;
    loadId++;
    state.rates = null;
    state.ratesStatus = "";
    state.ratesMissing = false;
  }
  render();
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

function fail(message: string) {
  state.data = null;
  state.error = message;
  render();
}

/** Zeigt statt der Auswertung einen klaren Leerzustand; die Seite bleibt bedienbar. */
function renderEmpty() {
  $("source").innerHTML = state.source
    ? `Nicht ausgewertet: <b>${esc(state.source)}</b>`
    : "Noch keine Datei geladen.";
  $("year").innerHTML = "";
  $("yearLabel").textContent = "–";
  $("reserve").textContent = "–";
  $("reserveNote").textContent = "Keine Auswertung. Wähle deinen Trade-Republic-Export oder sieh dir die Beispieldaten an.";
  $("bufferOut").textContent = `${state.bufferPct} %`;
  $("figs").innerHTML = "";
  $("bars").innerHTML = `<li class="empty">Keine Daten.</li>`;
  $("kz").innerHTML = `<tr><td colspan="3" class="empty">Keine Daten.</td></tr>`;
  $("open").innerHTML = `<tr><td colspan="4" class="empty">Keine Daten.</td></tr>`;
  $("todo").hidden = true;
  $("todoList").innerHTML = "";
  $("divBlock").hidden = true;
  $("brokerBlock").hidden = true;
  $("kzSetting").hidden = true;
  $("copy").onclick = null;
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
  ];
}

function render() {
  $("error").hidden = !state.error;
  $("error").textContent = state.error;
  $("ratesBox").hidden = !state.ratesStatus;
  $("ratesStatus").textContent = state.ratesStatus;
  $("rateFileBtn").hidden = !state.ratesMissing;
  const data = state.data;
  if (!data) {
    renderEmpty();
    return;
  }

  let report: YearReport;
  try {
    const options: YearOptions = {};
    if (state.taxSimpleSince) options.taxSimpleSince = state.taxSimpleSince;
    if (state.rates) options.rates = state.rates;
    options.brokerInterestKz = state.brokerInterestKz;
    report = computeYear(data, state.year, options);
  } catch (e) {
    fail(`Berechnung nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const tax = report.tax275Eur.plus(report.tax25Eur);
  const reserve = reserveTarget({
    basket275TaxEur: report.tax275Eur,
    bankInterestTaxEur: report.tax25Eur,
    tariffExtraTaxEur: 0,
    bufferRate: dec(state.bufferPct).div(100),
  });

  $("source").innerHTML = state.isSample
    ? "Beispieldaten geladen. Zieh deinen eigenen Export hierher, um deine Zahlen zu sehen."
    : `Geladen: <b>${esc(state.source)}</b> · ${esc(state.broker)} · ${data.trades.length} Trades`;
  $("kzSetting").hidden = !data.interest.some((i) => i.source === "broker");
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
      : `${formatEur(tax)} Steuer plus ${state.bufferPct} % Sicherheitspuffer.`) +
    (report.taxSimpleSince
      ? ` Erträge ab ${report.taxSimpleSince} hat Trade Republic selbst versteuert; sie zählen hier nicht.`
      : "") +
    (open > 0
      ? ` Achtung: ${open} ${open === 1 ? "Hinweis" : "Hinweise"} unten unter „Nicht berechnet“, das Ergebnis kann unvollständig sein.`
      : "");
  $("bufferOut").textContent = `${state.bufferPct} %`;

  const figs: Array<[string, Dec]> = [
    ["Steuer 27,5 %", report.tax275Eur],
    ["Steuer 25 % auf Zinsen", report.tax25Eur],
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

  $("open").innerHTML = report.openPositions.length
    ? report.openPositions
        .map((p) => `<tr><td>${esc(p.isin)}</td><td class="num">${p.quantity.toString()}</td><td class="num">${formatEur(p.avgPriceEur)}</td><td class="num">${formatEur(p.costEur)}</td></tr>`)
        .join("")
    : `<tr><td colspan="4" class="empty">Keine offenen Positionen.</td></tr>`;

  $("todo").hidden = report.notComputed.length === 0;
  $("todoList").innerHTML = report.notComputed
    .map((n) => `<li>Zeile ${n.line}: <code>${esc(n.type)}</code> – ${esc(n.reason)}</li>`)
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
}

function readFile(file: File) {
  file.text().then(
    (t) => load(t, file.name, false),
    () => {
      state.source = file.name;
      state.isSample = false;
      fail("Die Datei konnte nicht geöffnet werden. Bitte wähle sie noch einmal aus.");
    },
  );
}

{
  const drop = $("drop");
  const input = $<HTMLInputElement>("file");
  input.addEventListener("change", () => {
    if (input.files?.[0]) readFile(input.files[0]);
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
    const f = e.dataTransfer?.files?.[0];
    if (f) readFile(f);
  });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) readFile(f);
  });
  $<HTMLSelectElement>("year").addEventListener("change", (e) => {
    state.year = Number((e.target as HTMLSelectElement).value);
    render();
  });
  $<HTMLInputElement>("buffer").addEventListener("input", (e) => {
    state.bufferPct = Number((e.target as HTMLInputElement).value);
    render();
  });
  const rateInput = $<HTMLInputElement>("rateFile");
  rateInput.addEventListener("change", () => {
    if (rateInput.files?.[0]) readRateFile(rateInput.files[0]);
    rateInput.value = "";
  });
  $<HTMLSelectElement>("ibkrKz").addEventListener("change", (e) => {
    state.brokerInterestKz = (e.target as HTMLSelectElement).value === "861" ? "861" : "863";
    render();
  });
  $<HTMLInputElement>("since").addEventListener("change", (e) => {
    state.taxSimpleSince = (e.target as HTMLInputElement).value;
    render();
  });
  $("sample").addEventListener("click", () => load(sampleCsv, "Beispieldaten", true));
  load(sampleCsv, "Beispieldaten", true);
}
