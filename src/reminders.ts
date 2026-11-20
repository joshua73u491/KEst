import { D, ZERO, type Dec } from "./decimal.js";
import { formatEur } from "./format.js";
import type { ReserveStatus } from "./ledger.js";
import type { YearReport } from "./yearReport.js";

/**
 * Prüfassistent, Teil „Warnen und erinnern“ (UMSETZUNG 2.4): In-App-Hinweise als reine Funktion mit dem Stichtag als
 * Eingabe. Die Hinweise nennen Zahlen, Regeln und Fristen; sie empfehlen keine Anlage, keinen Verkauf und keine
 * Steuergestaltung.
 */

/**
 * Erklärungsfrist laut BMF: Papier bis 30. April, FinanzOnline bis 30. Juni des Folgejahres (§ 134 Abs 1 BAO).
 * Geprüft am 20.11.2026, Seite „Letzte Aktualisierung: 1. Jänner 2025“.
 */
export const DECLARATION_SOURCE = {
  label: "BMF: Einkommensteuererklärung, Erklärungsfrist",
  url: "https://www.bmf.gv.at/themen/steuern/fuer-unternehmen/einkommensteuer/einkommensteuererklaerungspflicht.html",
} as const;

/**
 * Gesetzliche Frist für die Steuererklärung eines Jahres. Fällt sie auf ein Wochenende, endet sie erst am nächsten
 * Werktag (§ 108 Abs 3 BAO); die App nennt bewusst das frühere, gesetzliche Datum.
 */
export function declarationDeadline(year: number): { paper: string; electronic: string } {
  return { paper: `${year + 1}-04-30`, electronic: `${year + 1}-06-30` };
}

/** Ab so vielen Tagen seit dem letzten Import erinnert die App an einen neuen Export. */
export const IMPORT_MAX_AGE_DAYS = 30;
/** In so vielen Tagen vor Fristende wird der Fristhinweis zur Warnung. */
export const DEADLINE_WARNING_DAYS = 30;

/** Zahlen eines Steuerjahres, die die Erinnerungen brauchen (aus `yearFigures`). */
export interface YearFigures {
  /** Überschüsse aus Wertpapieren, Derivaten und Krypto mit 27,5 % (KZ 994, 995, 174) */
  gainsEur: Dec;
  /** Verluste daraus als positiver Betrag (KZ 892, 896, 176) */
  lossesEur: Dec;
  /** Verlust, der nach dem Ausgleich übrig bleibt */
  unusedLossEur: Dec;
  /** true, wenn mindestens eine Kennzahl der E1kv nicht 0 ist */
  hasDeclarationAmounts: boolean;
}

export function yearFigures(r: YearReport): YearFigures {
  const all = [r.kz994, r.kz892, r.kz995, r.kz896, r.kz174, r.kz176, r.kz863, r.kz998, r.kz861, r.kz857];
  return {
    gainsEur: D.sum(ZERO, r.kz994, r.kz995, r.kz174),
    lossesEur: D.sum(ZERO, r.kz892, r.kz896, r.kz176),
    unusedLossEur: r.unusedLossEur,
    hasDeclarationAmounts: all.some((v) => !v.toDecimalPlaces(2).isZero()),
  };
}

export interface ReminderInput {
  /** Stichtag JJJJ-MM-TT */
  today: string;
  /** Rücklage zum Stichtag; `null` ohne gespeicherte Daten */
  reserve: ReserveStatus | null;
  /** Zeitpunkt des letzten Imports (ISO); `null` ohne gespeicherte Datei */
  lastImportAt: string | null;
  /** laufendes Jahr bis zum Stichtag */
  currentYear: YearFigures | null;
  /** abgelaufenes Jahr */
  previousYear: YearFigures | null;
  /** Jahre, deren Steuer als bezahlt markiert ist */
  paidYears: Record<string, string>;
}

export type ReminderCode = "reserve-shortfall" | "reserve-missing" | "import-old" | "deadline" | "loss-offset";

export interface Reminder {
  code: ReminderCode;
  severity: "warning" | "info";
  text: string;
  source?: { label: string; url: string };
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** Tage von `from` bis `to` (beide JJJJ-MM-TT) */
const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);
const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const cents = (v: Dec) => v.toDecimalPlaces(2);

export function reminders(input: ReminderInput): Reminder[] {
  const { today } = input;
  if (!isDate(today)) throw new Error(`Der Stichtag „${today}“ ist ungültig. Erwartet wird JJJJ-MM-TT.`);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const out: Reminder[] = [];

  // 1. Fehlbetrag in der Rücklage
  const r = input.reserve;
  if (r && cents(r.sollEur).gt(0)) {
    const incomplete = r.complete ? "" : " Das Soll ist unvollständig berechnet und kann höher sein.";
    if (r.istEur === null) {
      out.push({
        code: "reserve-missing",
        severity: "warning",
        text: `Für deine Rücklage ist noch kein Stand eingetragen. Das Soll beträgt ${formatEur(r.sollEur)}.${incomplete}`,
      });
    } else if (cents(r.shortfallEur).gt(0)) {
      out.push({
        code: "reserve-shortfall",
        severity: "warning",
        text:
          `Deiner Rücklage fehlen ${formatEur(r.shortfallEur)} bis zum Soll von ${formatEur(r.sollEur)} ` +
          `(Stand ${deDate(r.istDate ?? "")}: ${formatEur(r.istEur)}).${incomplete}`,
      });
    }
  }

  // 2. Letzter Import älter als 30 Tage
  if (input.lastImportAt && isDate(input.lastImportAt.slice(0, 10))) {
    const last = input.lastImportAt.slice(0, 10);
    const age = daysBetween(last, today);
    if (age > IMPORT_MAX_AGE_DAYS) {
      out.push({
        code: "import-old",
        severity: "warning",
        text: `Dein letzter Import ist vom ${deDate(last)}, vor ${age} Tagen. Neuere Buchungen fehlen in Soll und Rücklage, bis du einen aktuellen Export lädst.`,
      });
    }
  }

  // 3. Frist der Steuererklärung für das Vorjahr, bis die Steuer dafür als bezahlt markiert ist
  const prev = year - 1;
  const deadline = declarationDeadline(prev);
  if (input.previousYear?.hasDeclarationAmounts && input.paidYears[String(prev)] === undefined && today <= deadline.electronic) {
    const left = daysBetween(today, deadline.electronic);
    out.push({
      code: "deadline",
      severity: left <= DEADLINE_WARNING_DAYS ? "warning" : "info",
      text:
        `Frist für die Steuererklärung ${prev} mit Beilage E1kv: über FinanzOnline bis ${deDate(deadline.electronic)}, ` +
        `auf Papier bis ${deDate(deadline.paper)}. Mit steuerlicher Vertretung gelten in der Regel längere Fristen; ` +
        `eine Verlängerung kann beantragt werden.`,
      source: DECLARATION_SOURCE,
    });
  }

  // 4. November und Dezember: Verluste gleichen nur im selben Kalenderjahr aus
  const cur = input.currentYear;
  if ((month === 11 || month === 12) && cur && (cents(cur.gainsEur).gt(0) || cents(cur.lossesEur).gt(0))) {
    out.push({
      code: "loss-offset",
      severity: "info",
      text:
        `Verluste gleichen Gewinne nur im selben Kalenderjahr aus; ein Vortrag ins nächste Jahr ist nicht möglich. ` +
        `Stand ${year} bis heute (27,5 %): Überschüsse ${formatEur(cur.gainsEur)}, Verluste ${formatEur(cur.lossesEur)}.` +
        (cents(cur.unusedLossEur).gt(0) ? ` Nicht ausgeglichen: ${formatEur(cur.unusedLossEur)}, dieser Verlust verfällt am 31.12.${year}.` : ""),
    });
  }

  const rank = { warning: 0, info: 1 } as const;
  return out.map((x, i) => ({ x, i })).sort((a, b) => rank[a.x.severity] - rank[b.x.severity] || a.i - b.i).map(({ x }) => x);
}
