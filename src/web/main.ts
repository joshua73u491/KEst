import sampleCsv from "../../test/fixtures/tr-beispiel.csv";
import { dec, D, type Dec } from "../decimal.js";
import { formatEur } from "../format.js";
import { parseTradeRepublicCsv, type ImportResult } from "../import/tradeRepublic.js";
import { reserveTarget } from "../reserve.js";
import { computeYear, type YearReport } from "../yearReport.js";

interface State {
  data: ImportResult | null;
  source: string;
  isSample: boolean;
  year: number;
  bufferPct: number;
  error: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const KIND_LABEL = { security: "Wertpapier", securitizedDerivative: "Derivat", crypto: "Krypto" } as const;

const state: State = { data: null, source: "", isSample: true, year: 2026, bufferPct: 10, error: "" };

function yearsOf(data: ImportResult): number[] {
  const ys = new Set<number>();
  for (const t of data.trades) if (t.side === "sell") ys.add(Number(t.date.slice(0, 4)));
  for (const i of data.interest) ys.add(Number(i.date.slice(0, 4)));
  if (ys.size === 0) ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

function load(text: string, source: string, isSample: boolean) {
  try {
    const data = parseTradeRepublicCsv(text);
    state.data = data;
    state.source = source;
    state.isSample = isSample;
    state.error = "";
    state.year = yearsOf(data)[0] ?? state.year;
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
  }
  render();
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
  $("error").textContent = state.error ? `Die Datei konnte nicht gelesen werden: ${state.error}` : "";
  const data = state.data;
  if (!data) return;

  let report: YearReport;
  try {
    report = computeYear(data, state.year);
  } catch (e) {
    $("error").hidden = false;
    $("error").textContent = `Berechnung nicht möglich: ${e instanceof Error ? e.message : String(e)}`;
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
    : `Geladen: <b>${esc(state.source)}</b> · ${data.trades.length} Trades`;
  $("year").innerHTML = yearsOf(data)
    .map((y) => `<option value="${y}"${y === state.year ? " selected" : ""}>${y}</option>`)
    .join("");
  $("yearLabel").textContent = String(state.year);
  $("reserve").textContent = formatEur(reserve);
  $("reserveNote").textContent = tax.toDecimalPlaces(2).isZero()
    ? report.unusedLossEur.gt(0)
      ? `Keine Steuer: ${formatEur(report.unusedLossEur)} Verlust bleibt übrig. Er verfällt am Jahresende.`
      : "Noch keine steuerpflichtigen Erträge in diesem Jahr."
    : `${formatEur(tax)} Steuer plus ${state.bufferPct} % Sicherheitspuffer.`;
  $("bufferOut").textContent = `${state.bufferPct} %`;

  const figs: Array<[string, Dec]> = [
    ["Steuer 27,5 %", report.tax275Eur],
    ["Steuer 25 % auf Zinsen", report.tax25Eur],
    ["Nicht ausgeglichener Verlust", report.unusedLossEur],
    ["Ordergebühren, nicht abziehbar", report.feesEur],
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
  file.text().then((t) => load(t, file.name, false), () => load("", file.name, false));
}

{
  const drop = $("drop");
  const input = $<HTMLInputElement>("file");
  input.addEventListener("change", () => input.files?.[0] && readFile(input.files[0]));
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
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
  $("sample").addEventListener("click", () => load(sampleCsv, "Beispieldaten", true));
  load(sampleCsv, "Beispieldaten", true);
}
