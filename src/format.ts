import { dec, type DecInput } from "./decimal.js";
import type { YearReport } from "./yearReport.js";

/** Rundet kaufmännisch auf Cent und formatiert deutsch: 1.234,57 € */
export function formatEur(value: DecInput): string {
  const fixed = dec(value).toDecimalPlaces(2).toFixed(2);
  const negative = fixed.startsWith("-");
  const [int = "0", cents = "00"] = fixed.replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${cents} €`;
}

const line = (label: string, value: DecInput) => label.padEnd(36) + formatEur(value).padStart(15);

export function formatReport(r: YearReport): string {
  const out = [
    `KESt-Auswertung ${r.year} (Berechnungstool, keine Steuerberatung)`,
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
    "",
    line("Bemessungsgrundlage 27,5 %", r.taxableBaseEur),
    line("Steuer 27,5 %", r.tax275Eur),
    line("Steuer 25 % (Bankzinsen)", r.tax25Eur),
    line("Nicht ausgeglichener Verlust", r.unusedLossEur),
    line("Ordergebühren (nicht abziehbar)", r.feesEur),
    "",
    "Realisierte Ergebnisse",
    ...r.realized.map((x) => line(`${x.date}  ${x.name.slice(0, 22)}`, x.gainEur)),
    "",
    "Offene Positionen (Anschaffungskosten)",
    ...r.openPositions.map((p) => line(`${p.isin}  ${p.quantity.toString()} Stk.`, p.costEur)),
  ];
  if (r.notComputed.length > 0) {
    out.push("", "Nicht berechnet – bitte prüfen");
    out.push(...r.notComputed.map((n) => `Zeile ${n.line}: ${n.type} – ${n.reason}`));
  }
  return out.join("\n");
}
