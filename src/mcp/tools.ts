import { basename } from "node:path";
import { checkBookings } from "../check.js";
import { D, type Dec } from "../decimal.js";
import { buildE1kvDocument, DISCLAIMER, e1kvCsv, e1kvPdf, kzRows } from "../e1kvReport.js";
import type { RateTable } from "../fx.js";
import { addFile, combine, filePeriods, type History, type Settings } from "../history.js";
import type { ImportResult } from "../import/model.js";
import { addEntry, reserveStatus } from "../ledger.js";
import { checkOrder, simulateSale } from "../simulator.js";
import { sollOf, sollTimeline } from "../sollTimeline.js";
import { computeYear, type YearOptions } from "../yearReport.js";

/**
 * Werkzeuge des MCP-Add-ons (PRODUKTPLAN „Funktionen“, Spalte „Tool im MCP-Add-on“). Derselbe Rechenkern wie die App;
 * alles läuft lokal. Kein Werkzeug bewegt Geld oder empfiehlt etwas. Die Historie liegt im Backup-Format der Web-App.
 */

export interface ToolStore {
  load(): History;
  save(history: History): void;
  readFile(path: string): string;
  writeFile(path: string, data: string | Uint8Array): void;
  today(): string;
  now(): string;
  /** EZB-Kurse für Beträge in Fremdwährung (nur Währung und Zeitraum werden übermittelt); `null` = keine */
  rates(data: ImportResult): Promise<RateTable | null>;
}

export interface ToolResult {
  text: string;
  data?: unknown;
}

export type ParamType = "string" | "number" | "boolean";
export interface ToolParam {
  type: ParamType;
  description: string;
  optional?: boolean;
  enum?: string[];
}

export interface Tool {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  run(args: Record<string, unknown>): Promise<ToolResult>;
}

const s = (v: Dec) => v.toString();
const money = (v: Dec) => `${v.toDecimalPlaces(2).toFixed(2).replace(".", ",")} €`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const NOTE = `Hinweis: ${DISCLAIMER.split(". ")[0]}.`;

function optionsOf(settings: Settings, rates: RateTable | null): YearOptions {
  const o: YearOptions = { brokerInterestKz: settings.brokerInterestKz, derivativesTreatment: settings.derivativesTreatment, otherIncomeEur: settings.otherIncomeEur };
  if (settings.taxSimpleSince) o.taxSimpleSince = settings.taxSimpleSince;
  if (rates) o.rates = rates;
  return o;
}

export function createTools(store: ToolStore): Tool[] {
  async function context() {
    const history = store.load();
    const { data, duplicates } = combine(history);
    const rates = await store.rates(data).catch(() => null);
    return { history, data, duplicates, rates, options: optionsOf(history.settings, rates) };
  }
  const yearOf = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : Number(store.today().slice(0, 4)));

  return [
    {
      name: "import_file",
      description: "Liest eine Exportdatei (Trade Republic CSV, IBKR Flex Query XML, DEGIRO CSV, SnapTrade-Abruf JSON) von der Festplatte und speichert sie in der lokalen Historie. Doppelte Buchungen zählen nur einmal.",
      params: { path: { type: "string", description: "Pfad zur Exportdatei" } },
      async run(a) {
        const path = str(a.path) ?? "";
        const r = addFile(store.load(), basename(path), store.readFile(path), store.now(), `mcp-${Date.parse(store.now())}-${basename(path)}`);
        if (r.added) store.save(r.history);
        return { text: r.added ? `„${basename(path)}“ gespeichert (${r.broker}).` : `„${basename(path)}“ ist bereits gespeichert.`, data: { broker: r.broker, added: r.added } };
      },
    },
    {
      name: "compute_tax_ytd",
      description: "Rechnet Kennzahlen der E1kv, Steuer und Soll-Rücklage für ein Steuerjahr (Standard: laufendes Jahr) und nennt, was nicht berechnet werden konnte.",
      params: { year: { type: "number", description: "Steuerjahr, z. B. 2026", optional: true } },
      async run(a) {
        const { history, data, options } = await context();
        const year = yearOf(a.year);
        const r = computeYear(data, year, options);
        const soll = sollOf(r, history.settings.bufferPct);
        const kz = Object.fromEntries(kzRows(r).map((k) => [k.kz, s(k.amountEur)]));
        const lines = kzRows(r)
          .filter((k) => !k.amountEur.isZero())
          .map((k) => `KZ ${k.kz} ${k.label}: ${money(k.amountEur)}`);
        return {
          text:
            `Steuerjahr ${year}\n${lines.join("\n") || "Keine Beträge."}\n` +
            `Steuer 27,5 %: ${money(r.tax275Eur)}, Steuer 25 %: ${money(r.tax25Eur)}, Mehrsteuer KZ 857: ${money(r.tariffExtraTaxEur)}\n` +
            `Soll-Rücklage mit ${history.settings.bufferPct} % Puffer: ${money(soll)}\n` +
            (r.notComputed.length ? `Nicht berechnet (${r.notComputed.length}): ${r.notComputed.slice(0, 5).map((n) => n.reason).join(" | ")}\n` : "") +
            NOTE,
          data: { year, kz, tax275Eur: s(r.tax275Eur), tax25Eur: s(r.tax25Eur), tariffExtraTaxEur: s(r.tariffExtraTaxEur), sollEur: s(soll), unusedLossEur: s(r.unusedLossEur), notComputed: r.notComputed },
        };
      },
    },
    {
      name: "get_reserve_status",
      description: "Vergleicht die Soll-Rücklage aller Jahre, deren Steuer noch offen ist, mit dem zuletzt eingetragenen Stand der Rücklage. Freigabe erst nach dem 31.12.",
      params: {},
      async run() {
        const { history, data, options } = await context();
        const today = store.today();
        const st = reserveStatus(sollTimeline(data, options, history.settings.bufferPct, today, {}), history.reserve, today);
        return {
          text:
            `Soll offener Jahre: ${money(st.sollEur)}; Ist: ${st.istEur ? `${money(st.istEur)} (Stand ${st.istDate})` : "noch kein Stand eingetragen"}; ` +
            (st.shortfallEur.gt(0) ? `Fehlbetrag: ${money(st.shortfallEur)}.` : `Überschuss: ${money(st.surplusEur)}, davon frei: ${money(st.releasableEur)}${st.lockedUntil ? `, gesperrt bis ${st.lockedUntil}: ${money(st.lockedEur)}` : ""}.`),
          data: {
            sollEur: s(st.sollEur),
            istEur: st.istEur ? s(st.istEur) : null,
            istDate: st.istDate,
            shortfallEur: s(st.shortfallEur),
            surplusEur: s(st.surplusEur),
            releasableEur: s(st.releasableEur),
            lockedEur: s(st.lockedEur),
            lockedUntil: st.lockedUntil,
            complete: st.complete,
          },
        };
      },
    },
    {
      name: "book_reserve",
      description: "Trägt den aktuellen Marktwert der Rücklage ein (nicht die Summe der Einzahlungen), mit Datum, Ort und Notiz. Bewegt kein Geld.",
      params: {
        value_eur: { type: "string", description: "Marktwert in EUR, z. B. 3025.50" },
        date: { type: "string", description: "Datum JJJJ-MM-TT (Standard: heute)", optional: true },
        place: { type: "string", description: "Wo das Geld liegt, freie Angabe", optional: true },
        note: { type: "string", description: "Notiz", optional: true },
      },
      async run(a) {
        const h = store.load();
        const date = str(a.date) ?? store.today();
        const reserve = addEntry(h.reserve, { id: `mcp-${Date.parse(store.now())}`, date, valueEur: str(a.value_eur) ?? "", place: str(a.place) ?? h.settings.reservePlace, note: str(a.note) ?? "" });
        store.save({ ...h, reserve });
        return { text: `Stand der Rücklage am ${date} eingetragen.`, data: reserve.entries[reserve.entries.length - 1] };
      },
    },
    {
      name: "simulate_sale",
      description: "Rechnet durch, was ein gedachter Verkauf heute steuerlich bewirkt (gleitender Durchschnittspreis, Steuer des Jahres ohne und mit dem Verkauf, Soll vorher und nachher). Reine Rechnung, keine Empfehlung.",
      params: {
        isin: { type: "string", description: "ISIN bzw. Kennung der Position" },
        quantity: { type: "string", description: "Stückzahl" },
        price_eur: { type: "string", description: "Preis je Stück in EUR" },
        depot: { type: "string", description: "Depot (z. B. TR, DEGIRO, IBKR U1234567); nur nötig, wenn die Position in mehreren Depots liegt", optional: true },
        fee_eur: { type: "string", description: "Spesen in EUR", optional: true },
      },
      async run(a) {
        const { history, data, options } = await context();
        const isin = str(a.isin) ?? "";
        let depot = str(a.depot);
        if (!depot) {
          const open = computeYear(data, Number(store.today().slice(0, 4)), { ...options, asOf: store.today() }).openPositions.filter((p) => p.isin === isin);
          if (open.length === 0) throw new Error(`Für ${isin} gibt es keine offene Position, die die App berechnen kann.`);
          if (open.length > 1) throw new Error(`${isin} liegt in mehreren Depots (${open.map((p) => p.depot).join(", ")}). Bitte das Depot angeben.`);
          depot = open[0]!.depot;
        }
        const r = simulateSale({ data, options, bufferPct: history.settings.bufferPct, today: store.today(), isin, depot, quantity: str(a.quantity) ?? "", priceEur: str(a.price_eur) ?? "", ...(str(a.fee_eur) ? { feeEur: str(a.fee_eur)! } : {}) });
        return {
          text:
            `Erlös ${money(r.proceedsEur)} − Anschaffungskosten ${money(r.costEur)} = ${r.gainEur.lt(0) ? "Verlust" : "Gewinn"} ${money(r.gainEur.abs())}. ` +
            `Steuer ${r.year} bis heute: ${money(r.taxBeforeEur)} ohne, ${money(r.taxAfterEur)} mit diesem Verkauf. Soll ${money(r.sollBeforeEur)} → ${money(r.sollAfterEur)}.` +
            (r.taxedByBroker ? " Der Verkauf wäre bei Trade Republic endbesteuert." : "") +
            (r.complete ? "" : " Achtung: Im Jahr ist etwas nicht berechnet."),
          data: { depot, gainEur: s(r.gainEur), proceedsEur: s(r.proceedsEur), costEur: s(r.costEur), taxBeforeEur: s(r.taxBeforeEur), taxAfterEur: s(r.taxAfterEur), taxChangeEur: s(r.taxChangeEur), sollBeforeEur: s(r.sollBeforeEur), sollAfterEur: s(r.sollAfterEur), taxedByBroker: r.taxedByBroker },
        };
      },
    },
    {
      name: "check_order_against_reserve",
      description: "Prüft, ob ein Guthaben für eine Order reicht, ohne die Rücklage anzugreifen (bis zum 31.12. gilt der Höchststand des Solls). Reine Rechnung, keine Empfehlung.",
      params: {
        cash_eur: { type: "string", description: "Guthaben in EUR" },
        order_eur: { type: "string", description: "Orderbetrag inklusive Spesen in EUR" },
        reserve_in_account: { type: "boolean", description: "true, wenn die Rücklage in diesem Guthaben liegt" },
      },
      async run(a) {
        const { history, data, options } = await context();
        const today = store.today();
        const st = reserveStatus(sollTimeline(data, options, history.settings.bufferPct, today, {}), history.reserve, today);
        const c = checkOrder({ cashEur: str(a.cash_eur) ?? "", orderEur: str(a.order_eur) ?? "", reserveInAccount: a.reserve_in_account === true }, st);
        return {
          text: `Für die Rücklage müssen ${money(c.mustKeepEur)} bleiben, frei sind ${money(c.freeEur)}. ${c.enough ? "Die Order ist gedeckt." : `Es fehlen ${money(c.missingEur)}.`}`,
          data: { mustKeepEur: s(c.mustKeepEur), freeEur: s(c.freeEur), enough: c.enough, missingEur: s(c.missingEur) },
        };
      },
    },
    {
      name: "review_findings",
      description: "Prüfassistent: meldet Auffälligkeiten in allen Buchungen (Verkauf ohne Bestand, Lücken, Duplikate, fehlende Kurse, unbekannte Buchungstypen) mit Schweregrad.",
      params: {},
      async run() {
        const { history, data, duplicates, rates } = await context();
        const findings = checkBookings({ data, duplicates, periods: filePeriods(history), ...(rates ? { rates } : {}), ...(history.settings.taxSimpleSince ? { taxSimpleSince: history.settings.taxSimpleSince } : {}) });
        return { text: findings.length ? findings.map((f) => `${f.severity}: ${f.text}`).join("\n") : "Keine Auffälligkeiten.", data: findings };
      },
    },
    {
      name: "get_cost_basis",
      description: "Offene Positionen mit Stückzahl, gleitendem Durchschnittspreis und Anschaffungskosten in EUR, Stand heute.",
      params: {},
      async run() {
        const { data, options } = await context();
        const r = computeYear(data, Number(store.today().slice(0, 4)), { ...options, asOf: store.today() });
        const out = r.openPositions.map((p) => ({ isin: p.isin, depot: p.depot, quantity: s(p.quantity), avgPriceEur: s(p.avgPriceEur), costEur: s(p.costEur) }));
        return { text: out.map((p) => `${p.isin} (${p.depot}): ${p.quantity} Stück, Ø ${money(D.sum(p.avgPriceEur))}`).join("\n") || "Keine offenen Positionen.", data: out };
      },
    },
    {
      name: "list_transactions",
      description: "Listet die Käufe, Verkäufe, Dividenden und Zinsen eines Jahres in EUR (Fremdwährung als Originalbetrag).",
      params: { year: { type: "number", description: "Jahr (Standard: laufendes Jahr)", optional: true } },
      async run(a) {
        const { data } = await context();
        const y = String(yearOf(a.year));
        const trades = data.trades.filter((t) => t.date.startsWith(y)).map((t) => ({ date: t.date, side: t.side, isin: t.isin, name: t.name, depot: t.depot, quantity: t.quantity, amountEur: t.amountEur, currency: t.originalCurrency || "EUR", ...(t.convert ? { amount: t.convert.amount } : {}) }));
        const dividends = data.dividends.filter((d) => d.date.startsWith(y)).map((d) => ({ date: d.date, isin: d.isin, name: d.name, kind: d.kind, grossEur: d.grossEur, withheldEur: d.withheldEur, currency: d.originalCurrency || "EUR", ...(d.originalAmount ? { originalAmount: d.originalAmount } : {}) }));
        const interest = data.interest.filter((i) => i.date.startsWith(y)).map((i) => ({ date: i.date, depot: i.depot, amountEur: i.amountEur, ...(i.convert ? { currency: i.convert.currency, amount: i.convert.amount } : {}) }));
        return { text: `${y}: ${trades.length} Trades, ${dividends.length} Dividenden, ${interest.length} Zinsbuchungen.`, data: { trades, dividends, interest } };
      },
    },
    {
      name: "generate_e1kv_report",
      description: "Erstellt den E1kv-Bericht (Kennzahlen, Belegliste, Regelversion) als PDF und/oder CSV und speichert ihn lokal. Hinweis im Bericht: Berechnungstool, keine Steuerberatung.",
      params: {
        year: { type: "number", description: "Steuerjahr", optional: true },
        pdf_path: { type: "string", description: "Zielpfad für das PDF", optional: true },
        csv_path: { type: "string", description: "Zielpfad für die CSV", optional: true },
      },
      async run(a) {
        const { history, data, options } = await context();
        const year = yearOf(a.year);
        const doc = buildE1kvDocument(computeYear(data, year, options), { createdAt: store.today(), files: history.files.map((f) => f.name), settings: history.settings });
        const written: string[] = [];
        if (str(a.pdf_path)) {
          store.writeFile(str(a.pdf_path)!, e1kvPdf(doc));
          written.push(str(a.pdf_path)!);
        }
        if (str(a.csv_path)) {
          store.writeFile(str(a.csv_path)!, e1kvCsv(doc));
          written.push(str(a.csv_path)!);
        }
        return { text: written.length ? `E1kv-Bericht ${year} gespeichert: ${written.join(", ")}. ${NOTE}` : `Kein Zielpfad angegeben. ${NOTE}`, data: { kz: doc.kz.map((k) => ({ kz: k.kz, amountEur: s(k.amountEur) })), written } };
      },
    },
    {
      name: "set_config",
      description: "Ändert Einstellungen der Berechnung: Sicherheitspuffer, „steuereinfach seit“ (Trade Republic), Behandlung von Optionen und Futures, Kennzahl für Broker-Zinsen, sonstiges Einkommen für KZ 857.",
      params: {
        buffer_pct: { type: "number", description: "Sicherheitspuffer in Prozent (0 bis 100)", optional: true },
        tax_simple_since: { type: "string", description: "JJJJ-MM-TT oder leer", optional: true },
        derivatives_treatment: { type: "string", description: "tariff (KZ 857) oder special (27,5 %)", optional: true, enum: ["tariff", "special"] },
        broker_interest_kz: { type: "string", description: "863 oder 861", optional: true, enum: ["863", "861"] },
        other_income_eur: { type: "string", description: "geschätztes sonstiges Einkommen in EUR oder leer", optional: true },
      },
      async run(a) {
        const h = store.load();
        const next: Settings = { ...h.settings };
        if (a.buffer_pct !== undefined) {
          const b = a.buffer_pct;
          if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 100) throw new Error("Der Sicherheitspuffer muss eine ganze Zahl zwischen 0 und 100 % sein.");
          next.bufferPct = b;
        }
        if (a.tax_simple_since !== undefined) {
          const v = str(a.tax_simple_since) ?? "";
          if (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Das Datum für „steuereinfach seit“ ist ungültig. Erwartet wird JJJJ-MM-TT.");
          next.taxSimpleSince = v;
        }
        if (a.derivatives_treatment !== undefined) next.derivativesTreatment = a.derivatives_treatment === "special" ? "special" : "tariff";
        if (a.broker_interest_kz !== undefined) next.brokerInterestKz = a.broker_interest_kz === "861" ? "861" : "863";
        if (a.other_income_eur !== undefined) {
          const v = (str(a.other_income_eur) ?? "").trim();
          if (v !== "" && !/^\d+(\.\d+)?$/.test(v)) throw new Error("Das sonstige Einkommen muss eine Zahl ab 0 sein.");
          next.otherIncomeEur = v;
        }
        store.save({ ...h, settings: next });
        return { text: "Einstellungen gespeichert.", data: next };
      },
    },
  ];
}
