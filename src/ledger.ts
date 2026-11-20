import { dec, D, ZERO, type Dec } from "./decimal.js";

/**
 * Rücklagen-Ledger (PRODUKTPLAN, „Rücklage beiseitelegen“): Soll laut App gegen Ist laut Nutzer.
 * Das Geld bewegt immer der Nutzer selbst; die App rechnet, vergleicht und warnt. Sie nennt nie ein Produkt.
 */

/** Vom Nutzer eingetragener Marktwert der Rücklage. */
export interface ReserveEntry {
  id: string;
  /** JJJJ-MM-TT */
  date: string;
  /** aktueller Marktwert in EUR, nicht die Summe der Einzahlungen */
  valueEur: string;
  /** Ort des Geldes, freie Eingabe des Nutzers (z. B. „Tagesgeld Hausbank“) */
  place: string;
  note: string;
}

/** Anlagearten laut PRODUKTPLAN-Tabelle „Angelegte Rücklage: Regeln“ (Kategorien, keine Produkte). */
export type InvestmentKind = "deposit" | "moneyMarketFund" | "shortGovBonds" | "equityEtf" | "longBondEtf" | "other";

/** Angaben des Nutzers zu seiner gewählten Anlage, für den Kriterien-Check. */
export interface ReserveInvestment {
  kind: InvestmentKind;
  /** Meldefonds laut OeKB; `null` = kein Fonds */
  reportingFund: "yes" | "no" | "unknown" | null;
  /** Gesamtrisikoindikator 1–7 laut Basisinformationsblatt; `null` = nicht angegeben */
  sri: number | null;
}

export interface Ledger {
  entries: ReserveEntry[];
  investment: ReserveInvestment | null;
  /** Steuer für ein Jahr bezahlt: Jahr -> Datum (JJJJ-MM-TT); das Jahr zählt dann nicht mehr zum Soll */
  paidYears: Record<string, string>;
}

export const emptyLedger = (): Ledger => ({ entries: [], investment: null, paidYears: {} });

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addEntry(ledger: Ledger, entry: ReserveEntry): Ledger {
  if (!isDate(entry.date)) throw new Error(`Das Datum „${entry.date}“ ist ungültig. Erwartet wird JJJJ-MM-TT.`);
  if (!/^\d+(\.\d+)?$/.test(entry.valueEur.trim())) {
    throw new Error(`Der Marktwert „${entry.valueEur}“ ist keine gültige Zahl ab 0 (z. B. 3025 oder 3025.50).`);
  }
  return { ...ledger, entries: [...ledger.entries, { ...entry, valueEur: dec(entry.valueEur.trim()).toString() }] };
}

export const removeEntry = (ledger: Ledger, id: string): Ledger => ({ ...ledger, entries: ledger.entries.filter((e) => e.id !== id) });

export function markPaid(ledger: Ledger, year: number, date: string): Ledger {
  if (!isDate(date)) throw new Error(`Das Datum „${date}“ ist ungültig. Erwartet wird JJJJ-MM-TT.`);
  return { ...ledger, paidYears: { ...ledger.paidYears, [String(year)]: date } };
}

export function unmarkPaid(ledger: Ledger, year: number): Ledger {
  const paidYears = { ...ledger.paidYears };
  delete paidYears[String(year)];
  return { ...ledger, paidYears };
}

/** Soll-Rücklage eines Steuerjahres (aus `src/sollTimeline.ts`). */
export interface YearSoll {
  year: number;
  /** Soll zum Stichtag */
  sollEur: Dec;
  /** höchstes Soll des Jahres bis zum Stichtag (bei abgeschlossenen Jahren = endgültiges Soll) */
  peakEur: Dec;
  /** false, wenn in der Auswertung des Jahres etwas „nicht berechnet“ ist */
  complete: boolean;
}

export interface ReserveStatus {
  today: string;
  /** Jahre, deren Steuer noch nicht bezahlt ist */
  years: Array<YearSoll & { closed: boolean }>;
  sollEur: Dec;
  istEur: Dec | null;
  /** Eintrag, der als aktueller Stand zählt */
  istEntryId: string | null;
  istDate: string | null;
  istPlace: string | null;
  shortfallEur: Dec;
  surplusEur: Dec;
  /** Überschuss, der freigegeben ist */
  releasableEur: Dec;
  /** Überschuss, der erst nach dem 31.12. frei wird */
  lockedEur: Dec;
  lockedUntil: string | null;
  complete: boolean;
}

/**
 * Soll gegen Ist zum Stichtag. Freigabe erst nach dem 31.12. (PRODUKTPLAN, Testfall 6): Im laufenden Jahr gilt für die
 * Freigabe der höchste Soll-Wert des Jahres, weil spätere Gewinne einen Verlust wieder aufheben können. Ab dem 1.1. ist
 * das Soll des abgelaufenen Jahres endgültig.
 */
export function reserveStatus(yearSolls: YearSoll[], ledger: Ledger, today: string): ReserveStatus {
  const todayYear = Number(today.slice(0, 4));
  const years = yearSolls
    .filter((y) => y.year <= todayYear && ledger.paidYears[String(y.year)] === undefined)
    .map((y) => ({ ...y, closed: y.year < todayYear }));
  const soll = D.sum(ZERO, ...years.map((y) => y.sollEur));
  const lockBase = D.sum(ZERO, ...years.map((y) => (y.closed ? y.sollEur : D.max(y.sollEur, y.peakEur))));
  const current = ledger.entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.date <= today)
    .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
    .pop()?.e;
  const ist = current ? dec(current.valueEur) : null;
  const shortfall = D.max(ZERO, soll.minus(ist ?? ZERO));
  const surplus = ist ? D.max(ZERO, ist.minus(soll)) : ZERO;
  const releasable = ist ? D.max(ZERO, ist.minus(lockBase)) : ZERO;
  const locked = D.max(ZERO, surplus.minus(releasable));
  return {
    today,
    years,
    sollEur: soll,
    istEur: ist,
    istEntryId: current?.id ?? null,
    istDate: current?.date ?? null,
    istPlace: current?.place ?? null,
    shortfallEur: shortfall,
    surplusEur: surplus,
    releasableEur: releasable,
    lockedEur: locked,
    lockedUntil: locked.gt(0) ? `${todayYear + 1}-01-01` : null,
    complete: years.every((y) => y.complete),
  };
}

export interface CriteriaFinding {
  severity: "ok" | "warning";
  text: string;
}

/** Ab dieser Risikoklasse (SRI laut Basisinformationsblatt) warnt die App (Entscheidung Joshua, 20.11.2026). */
export const SRI_WARNING_FROM = 3;

const FUND_KINDS = new Set<InvestmentKind>(["moneyMarketFund", "equityEtf", "longBondEtf"]);

/**
 * Kriterien-Check der vom Nutzer gewählten Anlage (PRODUKTPLAN, „Angelegte Rücklage: Regeln“). Prüft nur Kriterien:
 * Meldefonds-Status und Risikoklasse. Warnt, blockiert nichts und empfiehlt keine Anlage.
 */
export function checkInvestment(inv: ReserveInvestment): CriteriaFinding[] {
  const warnings: string[] = [];
  if (inv.kind === "equityEtf") {
    warnings.push("Aktien-ETFs können stark schwanken; zum Zahltag kann der Wert deutlich unter dem Soll liegen.");
  }
  if (inv.kind === "longBondEtf") {
    warnings.push("Anleihen-ETFs mit langer Laufzeit können bei steigenden Zinsen deutlich an Wert verlieren; zum Zahltag kann der Wert unter dem Soll liegen.");
  }
  if (inv.reportingFund === "no") {
    warnings.push(
      "Kein Meldefonds: Steuerpflichtig sind pauschal 90 % der Wertsteigerung, mindestens 10 % des Werts am 31.12. " +
        "Das kann ein Vielfaches des tatsächlichen Ertrags sein.",
    );
  } else if (inv.reportingFund === "unknown" || (inv.reportingFund === null && FUND_KINDS.has(inv.kind))) {
    // ein Fonds ohne Angabe zum Meldefonds-Status wird wie „unbekannt“ behandelt (nie still annehmen, er sei Meldefonds)
    warnings.push(
      "Meldefonds-Status unbekannt: Ob ein Fonds Meldefonds ist, steht in der OeKB-Datenbank (my.oekb.at). " +
        "Als Nicht-Meldefonds würde er pauschal besteuert.",
    );
  }
  if (inv.kind !== "deposit") {
    if (inv.sri !== null && inv.sri >= SRI_WARNING_FROM) {
      warnings.push(`Risikoklasse ${inv.sri} laut Basisinformationsblatt: ab ${SRI_WARNING_FROM} kann der Wert zum Zahltag spürbar unter dem Soll liegen.`);
    } else if (inv.sri === null && (FUND_KINDS.has(inv.kind) || inv.kind === "other")) {
      warnings.push("Risikoklasse nicht angegeben: Sie steht im Basisinformationsblatt (Gesamtrisikoindikator 1 bis 7).");
    }
  }
  if (warnings.length > 0) return warnings.map((text) => ({ severity: "warning", text }));

  const ok: Record<InvestmentKind, string> = {
    deposit: "Tagesgeld oder Sparkonto: Einlagensicherung, praktisch kein Kursrisiko. Zinsen sind mit 25 % steuerpflichtig; eine österreichische Bank zieht die KESt automatisch ab.",
    moneyMarketFund: "Geldmarktfonds als Meldefonds mit niedriger Risikoklasse: geringes Kursrisiko, Erträge mit 27,5 % steuerpflichtig.",
    shortGovBonds: "Kurzlaufende Staatsanleihen: geringes Kursrisiko, Erträge mit 27,5 % steuerpflichtig.",
    equityEtf: "",
    longBondEtf: "",
    other: "Bei den angegebenen Kriterien (Meldefonds, Risikoklasse) gibt es keine Auffälligkeit.",
  };
  return [{ severity: "ok", text: ok[inv.kind] }];
}
