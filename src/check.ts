import { dec, D, ZERO, type Dec } from "./decimal.js";
import type { RateSource } from "./fx.js";
import type { ImportResult } from "./import/model.js";

/**
 * Prüfassistent, Teil „Buchungen prüfen“: deterministische Regeln über alle importierten Daten (alle Jahre).
 * Liefert Hinweise mit Schweregrad und Klartext. Rechnet nichts um und entscheidet nichts; die Steuer rechnet
 * `src/yearReport.ts`. Keine Sprach-KI (Entscheidung Joshua, docs/UMSETZUNG.md).
 */

export type Severity = "error" | "warning" | "info";

export type FindingCode =
  | "insufficient-position"
  | "transfer-exceeds"
  | "possible-duplicate"
  | "duplicate"
  | "gap"
  | "rates-not-loaded"
  | "missing-rate"
  | "unknown-type"
  | "dust";

export interface Finding {
  severity: Severity;
  code: FindingCode;
  text: string;
  /** Fundstellen (Zeile und, bei mehreren Dateien, Dateiname) */
  at: Array<{ line: number; file?: string }>;
}

/** Zeitraum, den eine Datei für ein Depot abdeckt. */
export interface FilePeriod {
  depot: string;
  file: string;
  /** JJJJ-MM-TT */
  from: string;
  to: string;
  /** true: Zeitraum laut Datei (IBKR fromDate/toDate); false: abgeleitet aus erster und letzter Buchung (Trade Republic) */
  exact: boolean;
}

export interface CheckInput {
  data: ImportResult;
  /** Buchungen, die beim Zusammenführen mehrerer Dateien als Duplikat erkannt wurden */
  duplicates?: number;
  periods?: FilePeriod[];
  rates?: RateSource;
  /** Ab diesem Tag zieht Trade Republic die KESt ab; Trade-Republic-Dividenden brauchen dann keinen EZB-Kurs */
  taxSimpleSince?: string;
}

/** Bei abgeleiteten Zeiträumen (Trade Republic) gilt erst ein Abstand von mehr als einem Monat als auffällig. */
const INFERRED_GAP_DAYS = 31;

const at = (x: { line: number; file?: string }) => (x.file === undefined ? { line: x.line } : { line: x.line, file: x.file });
const day = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(toTime(d) + n * day).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / day);
const times = (n: number) => (n === 2 ? "zweimal" : `${n}-mal`);

export function checkBookings(input: CheckInput): Finding[] {
  const { data } = input;
  const findings: Finding[] = [];
  const add = (severity: Severity, code: FindingCode, text: string, where: Finding["at"] = []) => findings.push({ severity, code, text, at: where });

  // 1. Bestände über die ganze Historie nachrechnen (nur Stückzahlen): Verkauf/Übertrag größer als Bestand, Reste nahe 0
  type Event = { at: string; rank: number; run: () => void };
  const held = new Map<string, Dec>();
  const maxHeld = new Map<string, Dec>();
  const lastOut = new Map<string, { line: number; file?: string }>();
  const unknown = new Set<string>(); // Positionen, deren Bestand nach einer übersprungenen Buchung unsicher ist
  const events: Event[] = [];
  const key = (depot: string, isin: string) => `${depot}|${isin}`;
  // Optionen und Futures haben Short-Positionen (Stillhalter); ihre Bestände prüft src/derivatives.ts.
  for (const t of data.trades.filter((x) => x.kind !== "derivative")) {
    events.push({
      at: t.datetime || t.date,
      rank: t.side === "buy" ? 0 : 1,
      run: () => {
        const k = key(t.depot, t.isin);
        if (unknown.has(k)) return;
        const have = held.get(k) ?? ZERO;
        const q = dec(t.quantity);
        if (t.side === "buy") {
          const now = have.plus(q);
          held.set(k, now);
          maxHeld.set(k, D.max(maxHeld.get(k) ?? ZERO, now));
          return;
        }
        if (q.gt(have)) {
          unknown.add(k);
          add(
            "error",
            "insufficient-position",
            `Verkauf von ${q.toString()} Stück ${t.isin} am ${t.date}, bekannt sind nur ${have.toString()} Stück. ` +
              `Vermutlich wurde vor dem Exportzeitraum gekauft oder eine Einbuchung fehlt. Gewinne dieser Position werden nicht berechnet. ` +
              `Bitte den Export mit Zeitraum seit Kontoeröffnung verwenden.`,
            [at(t)],
          );
          return;
        }
        held.set(k, have.minus(q));
        lastOut.set(k, at(t));
      },
    });
  }
  for (const t of data.transfersOut) {
    events.push({
      at: t.datetime || t.date,
      rank: 1,
      run: () => {
        const k = key(t.depot, t.isin);
        if (unknown.has(k)) return;
        const have = held.get(k) ?? ZERO;
        const q = dec(t.quantity);
        if (q.gt(have)) {
          unknown.add(k);
          add(
            "error",
            "transfer-exceeds",
            `Übertrag von ${q.toString()} Stück ${t.isin} am ${t.date}, bekannt sind nur ${have.toString()} Stück. ` +
              `Vermutlich fehlt ein Kauf oder eine Einbuchung. Die Position wird ab hier nicht mehr berechnet.`,
            [at(t)],
          );
          return;
        }
        held.set(k, have.minus(q));
        lastOut.set(k, at(t));
      },
    });
  }
  for (const u of data.unsupported) {
    const a = u.affects;
    if (a) events.push({ at: a.datetime, rank: 0, run: () => unknown.add(key(a.depot, a.isin)) });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.rank - b.rank).forEach((e) => e.run());
  for (const [k, rest] of held) {
    if (unknown.has(k) || rest.lte(0)) continue;
    const limit = D.max(dec("1e-8"), (maxHeld.get(k) ?? ZERO).times("1e-6"));
    const where = lastOut.get(k);
    if (rest.lte(limit) && where) {
      add(
        "info",
        "dust",
        `Von ${k.split("|")[1]} ist ein Rest von ${rest.toString()} Stück übrig, vermutlich durch Rundung beim Broker. ` +
          `Die App führt ihn als offene Position; beim späteren Verkauf zählt er mit.`,
        [where],
      );
    }
  }

  // 2. Doppelte Buchungen: gleicher Trade mehrfach in den Daten (andere oder fehlende Transaktions-ID)
  const sameTrade = new Map<string, typeof data.trades>();
  for (const t of data.trades) {
    const k = [t.depot, t.derivative?.contract ?? t.isin, t.side, t.datetime || t.date, dec(t.quantity).toString(), t.amountEur || t.convert?.amount || ""].join("|");
    sameTrade.set(k, [...(sameTrade.get(k) ?? []), t]);
  }
  for (const group of sameTrade.values()) {
    if (group.length < 2) continue;
    const t = group[0]!;
    add(
      "warning",
      "possible-duplicate",
      `${t.side === "buy" ? "Kauf" : "Verkauf"} von ${dec(t.quantity).toString()} Stück ${t.isin} am ${t.date} steht ${times(group.length)} ` +
        `mit gleichem Zeitpunkt und Betrag in den Daten. Bitte prüfen, ob die Buchung doppelt ist.`,
      group.map(at),
    );
  }
  if ((input.duplicates ?? 0) > 0) {
    const n = input.duplicates!;
    add("info", "duplicate", `${n} ${n === 1 ? "Buchung kam" : "Buchungen kamen"} in mehreren Dateien vor und ${n === 1 ? "wird" : "werden"} nur einmal gezählt.`);
  }

  // 3. Lücken im Exportzeitraum je Depot
  const byDepot = new Map<string, FilePeriod[]>();
  for (const p of input.periods ?? []) byDepot.set(p.depot, [...(byDepot.get(p.depot) ?? []), p]);
  for (const [depot, periods] of byDepot) {
    const sorted = [...periods].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    let covered = sorted[0]!;
    let coveredTo = covered.to;
    for (const p of sorted.slice(1)) {
      if (p.exact && covered.exact) {
        if (p.from > addDays(coveredTo, 1)) {
          add(
            "warning",
            "gap",
            `${depot}: Für ${addDays(coveredTo, 1)} bis ${addDays(p.from, -1)} liegt kein Export vor (zwischen „${covered.file}“ und „${p.file}“). ` +
              `Fehlen dort Buchungen, stimmen Bestände und Gewinne nicht.`,
          );
        }
      } else if (daysBetween(coveredTo, p.from) > INFERRED_GAP_DAYS) {
        add(
          "warning",
          "gap",
          `${depot === "TR" ? "Trade Republic" : depot}: Zwischen der letzten Buchung am ${coveredTo} in „${covered.file}“ und der ersten am ${p.from} in „${p.file}“ ` +
            `liegen ${daysBetween(coveredTo, p.from)} Tage. Falls dazwischen ein Export fehlt, stimmen Bestände und Gewinne nicht. ` +
            `Am sichersten ist ein Export mit Zeitraum seit Kontoeröffnung.`,
        );
      }
      if (p.to > coveredTo) {
        coveredTo = p.to;
        covered = p;
      }
    }
  }

  // 4. Fremdwährung ohne EZB-Referenzkurs
  const since = input.taxSimpleSince ?? "";
  const taxedByTr = (depot: string, date: string) => depot === "TR" && since !== "" && date >= since;
  const needs: Array<{ currency: string; date: string; where: { line: number; file?: string } }> = [];
  for (const t of data.trades) if (t.convert && t.convert.currency !== "EUR") needs.push({ currency: t.convert.currency, date: t.date, where: at(t) });
  for (const d of data.dividends) {
    if (d.kind === "stock" && d.originalCurrency !== "" && !taxedByTr(d.depot, d.date)) needs.push({ currency: d.originalCurrency, date: d.date, where: at(d) });
  }
  for (const i of data.interest) if (i.convert && !taxedByTr(i.depot, i.date)) needs.push({ currency: i.convert.currency, date: i.date, where: at(i) });
  if (needs.length > 0 && !input.rates) {
    const n = needs.length;
    add(
      "warning",
      "rates-not-loaded",
      `${n} ${n === 1 ? "Buchung" : "Buchungen"} in Fremdwährung ${n === 1 ? "braucht" : "brauchen"} EZB-Referenzkurse, die nicht geladen sind. ` +
        `${n === 1 ? "Sie wird" : "Sie werden"} nicht berechnet.`,
    );
  } else if (input.rates) {
    for (const x of needs) {
      if (input.rates.rate(x.currency, x.date)) continue;
      add(
        "warning",
        "missing-rate",
        `Für ${x.currency} gibt es am ${x.date} keinen EZB-Referenzkurs (z. B. Wochenende oder Feiertag). Die Buchung wird nicht geschätzt, sondern nicht berechnet.`,
        [x.where],
      );
    }
  }

  // 5. Unbekannte Buchungstypen, je Typ zusammengefasst
  const unknownTypes = new Map<string, Finding["at"]>();
  for (const u of data.unsupported) if (u.reason === "Unbekannter Buchungstyp") unknownTypes.set(u.type, [...(unknownTypes.get(u.type) ?? []), at(u)]);
  for (const [type, where] of unknownTypes) {
    add(
      "warning",
      "unknown-type",
      `Buchungstyp ${type} (${where.length}×) ist der App unbekannt und wird nicht berechnet. Bitte prüfen, ob er steuerlich relevant ist.`,
      where,
    );
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return findings.map((f, i) => ({ f, i })).sort((a, b) => order[a.f.severity] - order[b.f.severity] || a.i - b.i).map((x) => x.f);
}
