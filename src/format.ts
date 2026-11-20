import type { Finding, Severity } from "./check.js";
import { dec, type DecInput } from "./decimal.js";
import type { YearReport } from "./yearReport.js";

export const SEVERITY_LABEL: Record<Severity, string> = { error: "Fehler", warning: "Warnung", info: "Hinweis" };

/** Fundstellen lesbar: „a.csv, Zeilen 2, 5; b.csv, Zeile 4“; lange Listen gekürzt. */
export function formatLocations(at: Finding["at"], max = 5): string {
  const byFile = new Map<string, number[]>();
  for (const x of at) byFile.set(x.file ?? "", [...(byFile.get(x.file ?? "") ?? []), x.line]);
  return [...byFile]
    .map(([file, lines]) => {
      const shown = lines.slice(0, max).join(", ");
      const more = lines.length > max ? ` und ${lines.length - max} weitere` : "";
      return `${file ? `${file}, ` : ""}${lines.length === 1 ? "Zeile" : "Zeilen"} ${shown}${more}`;
    })
    .join("; ");
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "Prüfassistent: keine Auffälligkeiten in den Buchungen.";
  const width = Math.max(...findings.map((f) => SEVERITY_LABEL[f.severity].length)) + 2;
  return [
    "Prüfassistent: Buchungen prüfen",
    ...findings.map((f) => `${`[${SEVERITY_LABEL[f.severity]}]`.padEnd(width + 1)}${f.text}${f.at.length ? ` (${formatLocations(f.at)})` : ""}`),
  ].join("\n");
}

/** Rundet kaufmännisch auf Cent und formatiert deutsch: 1.234,57 € */
export function formatEur(value: DecInput): string {
  const fixed = dec(value).toDecimalPlaces(2).toFixed(2);
  const negative = fixed.startsWith("-");
  const [int = "0", cents = "00"] = fixed.replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${cents} €`;
}

const line = (label: string, value: DecInput) => label.padEnd(36) + formatEur(value).padStart(15);
const detail = (label: string, value: DecInput, rest: string) => label.padEnd(44) + formatEur(value).padStart(11) + rest;

const BROKER_KIND = { sale: "Verkauf", dividend: "Ausschüttung", interest: "Zinsen" } as const;

export function formatReport(r: YearReport): string {
  const out = [
    `KESt-Auswertung ${r.year} (Berechnungstool, keine Steuerberatung)`,
    ...(r.taxSimpleSince
      ? [
          `Trade Republic zieht die KESt seit ${r.taxSimpleSince} selbst ab (steuereinfach).`,
          "Erträge ab diesem Tag stehen unten getrennt und zählen nicht für E1kv und Rücklage.",
        ]
      : []),
    "",
    "Beilage E1kv – ausländische Kapitaleinkünfte",
    line("KZ 994  Überschüsse Wertpapiere", r.kz994),
    line("KZ 892  Verluste Wertpapiere", r.kz892),
    line("KZ 995  Überschüsse Derivate", r.kz995),
    line("KZ 896  Verluste Derivate", r.kz896),
    line("KZ 174  Überschüsse Krypto", r.kz174),
    line("KZ 176  Verluste Krypto", r.kz176),
    line("KZ 863  Dividenden, Wertpapierzinsen", r.kz863),
    line("KZ 998  Anrechenbare Quellensteuer", r.kz998),
    line("KZ 861  Zinsen aus Geldeinlagen", r.kz861),
    ...(r.brokerInterestEur.isZero() ? [] : [line(`  IBKR-Zinsen, Einstellung KZ ${r.brokerInterestKz}`, r.brokerInterestEur)]),
    line("KZ 857  Optionen/Futures (Tarif)", r.kz857),
    ...(r.derivativesTreatment === "special" ? ["        Einstellung: Optionen/Futures mit 27,5 % in KZ 995/896"] : []),
    "",
    line("Bemessungsgrundlage 27,5 %", r.taxableBaseEur),
    line("Steuer 27,5 %", r.tax275Eur),
    line("Steuer 25 % (Bankzinsen)", r.tax25Eur),
    ...(r.derivativesTreatment === "tariff" && !r.kz857.isZero()
      ? [
          line("Mehrsteuer KZ 857 (Tarif)", r.tariffExtraTaxEur),
          r.otherIncomeEur === null
            ? "Sonstiges Einkommen: keine Angabe"
            : `Sonstiges Einkommen (deine Schätzung): ${formatEur(r.otherIncomeEur)}`,
        ]
      : []),
    line("Nicht ausgeglichener Verlust", r.unusedLossEur),
    line("Ordergebühren (nicht abziehbar)", r.feesEur),
    "",
    "Realisierte Ergebnisse",
    ...r.realized.map((x) => line(`${x.date}  ${x.name.slice(0, 22)}`, x.gainEur)),
  ];
  if (r.dividends.length > 0) {
    out.push("", "Dividenden (brutto · einbehalten · anrechenbar)");
    out.push(
      ...r.dividends.map((d) =>
        detail(
          `${d.date}  ${(d.name || d.isin).slice(0, 22)} (${d.country})`,
          d.grossEur,
          ` · ${formatEur(d.withheldEur)} · ${formatEur(d.creditableEur)}` +
            (d.ecbRate ? `  (${d.originalCurrency}, EZB-Kurs ${d.ecbRate.toString()})` : ""),
        ),
      ),
    );
    out.push("Anrechenbar ist höchstens der DBA-Satz; nach einem Verlustausgleich kann KZ 998 niedriger sein.");
  }
  if (r.taxedByBroker.length > 0) {
    out.push("", "Von Trade Republic bereits versteuert (zählt nicht für E1kv und Rücklage)");
    out.push(
      ...r.taxedByBroker.map((x) =>
        detail(
          `${x.date}  ${x.kind === "interest" && x.isin === "" ? "Zinsen" : `${BROKER_KIND[x.kind]} ${(x.name || x.isin).slice(0, 18)}`}`,
          x.amountEur,
          ` · ${formatEur(x.withheldEur)} einbehalten`,
        ),
      ),
    );
    out.push(line("Einbehalten von Trade Republic", r.brokerWithheldEur));
  }
  out.push(
    "",
    "Offene Positionen (Anschaffungskosten)",
    ...r.openPositions.map((p) => line(`${p.isin}  ${p.quantity.toString()} Stk.`, p.costEur)),
  );
  if (r.openDerivatives.length > 0) {
    out.push("", "Offene Optionen und Futures (Anzahl, Basis)");
    out.push(
      ...r.openDerivatives.map((p) =>
        detail(`${p.symbol.slice(0, 20)}  ${p.quantity.toString()} Kontr.${p.quantity.lt(0) ? " (Stillhalter)" : ""}`, p.basisEur, ""),
      ),
    );
  }
  if (r.notComputed.length > 0) {
    out.push("", "Nicht berechnet – bitte prüfen");
    out.push(...r.notComputed.map((n) => `${n.file ? `${n.file}, ` : ""}${n.line ? `Zeile ${n.line}: ` : ""}${n.type} – ${n.reason}`));
  }
  return out.join("\n");
}
