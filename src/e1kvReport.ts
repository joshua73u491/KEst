import { D, ZERO, type Dec } from "./decimal.js";
import { formatEur } from "./format.js";
import type { Settings } from "./history.js";
import type { AssetKind } from "./import/model.js";
import { RULES_NOTE, RULES_VERSION } from "./rules.js";
import { sollOf } from "./sollTimeline.js";
import type { YearReport } from "./yearReport.js";

/**
 * E1kv-Bericht als PDF und CSV (UMSETZUNG 3.4): Kennzahlen, Steuer und Soll, Belegliste mit Fundstellen, Einstellungen,
 * nicht Berechnetes, Regelversion und der sichtbare Hinweis „Berechnungstool, keine Steuerberatung“.
 * Das PDF entsteht ohne Bibliothek direkt im Browser; nichts verlässt das Gerät.
 */

export const DISCLAIMER =
  "Berechnungstool, keine Steuerberatung. Die Werte sind eine Rechenhilfe für die Beilage E1kv (ausländische Kapitaleinkünfte). " +
  "Prüfe sie vor der Abgabe. Strittige Punkte sind Einstellungen oder dokumentierte Annahmen, siehe unten.";

/** Kennzahlen der Beilage E1kv in der Reihenfolge der App (Verluste als positiver Betrag). */
export function kzRows(r: YearReport): Array<{ kz: string; label: string; amountEur: Dec }> {
  return [
    { kz: "994", label: "Überschüsse aus Wertpapieren", amountEur: r.kz994 },
    { kz: "892", label: "Verluste aus Wertpapieren", amountEur: r.kz892 },
    { kz: "995", label: "Überschüsse aus Derivaten", amountEur: r.kz995 },
    { kz: "896", label: "Verluste aus Derivaten", amountEur: r.kz896 },
    { kz: "174", label: "Überschüsse aus Krypto", amountEur: r.kz174 },
    { kz: "176", label: "Verluste aus Krypto", amountEur: r.kz176 },
    { kz: "863", label: "Dividenden, Wertpapierzinsen", amountEur: r.kz863 },
    { kz: "998", label: "Anrechenbare Quellensteuer", amountEur: r.kz998 },
    { kz: "861", label: "Zinsen aus Geldeinlagen (25 %)", amountEur: r.kz861 },
    { kz: "857", label: "Optionen und Futures zum Tarif", amountEur: r.kz857 },
  ];
}

export interface Beleg {
  date: string;
  art: string;
  kz: string;
  isin: string;
  name: string;
  amountEur: Dec;
  /** einbehaltene Quellensteuer (nur Dividenden) */
  withheldEur: Dec | null;
  /** Datei und Zeile */
  source: string;
}

export interface E1kvDocument {
  title: string;
  disclaimer: string;
  meta: Array<[string, string]>;
  kz: Array<{ kz: string; label: string; amountEur: Dec }>;
  summary: Array<[string, Dec]>;
  settings: string[];
  belege: Beleg[];
  notComputed: string[];
}

const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const where = (w: { line: number; file?: string }) => `${w.file ? `${w.file}, ` : ""}Zeile ${w.line}`;

function kzOfSale(kind: AssetKind, gain: Dec, derivativesTreatment: YearReport["derivativesTreatment"]): string {
  const loss = gain.lt(0);
  if (kind === "derivative") return derivativesTreatment === "tariff" ? "857" : loss ? "896" : "995";
  if (kind === "securitizedDerivative") return loss ? "896" : "995";
  if (kind === "crypto") return loss ? "176" : "174";
  return loss ? "892" : "994";
}

export function buildE1kvDocument(report: YearReport, meta: { createdAt: string; files: string[]; settings: Settings }): E1kvDocument {
  const s = meta.settings;
  const tariff = report.derivativesTreatment === "tariff";
  const total = report.tax275Eur.plus(report.tax25Eur).plus(report.tariffExtraTaxEur);
  const belege: Beleg[] = [
    ...report.realized.map((x) => ({
      date: x.date,
      art: x.kind === "derivative" ? "Option/Future" : "Verkauf",
      kz: kzOfSale(x.kind, x.gainEur, report.derivativesTreatment),
      isin: x.isin,
      name: x.name,
      amountEur: x.gainEur,
      withheldEur: null,
      source: where(x),
    })),
    ...report.dividends.map((d) => ({ date: d.date, art: "Dividende", kz: "863", isin: d.isin, name: d.name, amountEur: d.grossEur, withheldEur: d.withheldEur, source: where(d) })),
    ...report.interest.map((i) => ({ date: i.date, art: "Zinsen", kz: i.kz, isin: "", name: "Zinsen", amountEur: i.amountEur, withheldEur: null, source: where(i) })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source, "de", { numeric: true }));

  const summary: Array<[string, Dec]> = [
    ["Steuer 27,5 % (nach Anrechnung der Quellensteuer)", report.tax275Eur],
    ["Steuer 25 % auf Zinsen", report.tax25Eur],
    ...(tariff && !report.kz857.isZero() ? [["Mehrsteuer auf KZ 857 (Tarif, geschätzt)", report.tariffExtraTaxEur] as [string, Dec]] : []),
    ["Steuer gesamt", total],
    [`Soll-Rücklage mit ${s.bufferPct} % Puffer`, sollOf(report, s.bufferPct)],
    ["Nicht ausgeglichener Verlust (verfällt)", report.unusedLossEur],
    ...(report.taxSimpleSince ? [["Von Trade Republic einbehalten (endbesteuert, nicht in der E1kv)", report.brokerWithheldEur] as [string, Dec]] : []),
  ];

  return {
    title: `E1kv-Bericht ${report.year}`,
    disclaimer: DISCLAIMER,
    meta: [
      ["Steuerjahr", String(report.year)],
      ["Erstellt am", deDate(meta.createdAt)],
      ["Regelversion", RULES_VERSION],
      ["Regelstand", RULES_NOTE],
      ["Dateien", meta.files.join(", ") || "–"],
    ],
    kz: kzRows(report),
    summary,
    settings: [
      `Optionen/Futures: ${tariff ? "Tarif (KZ 857)" : "27,5 % (KZ 995/896)"}`,
      `Zinsen auf dem Konto eines Brokers (IBKR): KZ ${s.brokerInterestKz}`,
      `Steuereinfach seit (Trade Republic): ${s.taxSimpleSince ? deDate(s.taxSimpleSince) : "nein"}`,
      `Sonstiges Einkommen für KZ 857: ${s.otherIncomeEur ? formatEur(s.otherIncomeEur) : "keine Angabe"}`,
      `Sicherheitspuffer: ${s.bufferPct} %`,
    ],
    belege,
    notComputed: report.notComputed.map((n) => `${n.file ? `${n.file}, ` : ""}${n.line ? `Zeile ${n.line}: ` : ""}${n.type} – ${n.reason}`),
  };
}

// ---------------------------------------------------------------- CSV

/** Betrag für Excel in Österreich: Dezimalkomma, zwei Nachkommastellen, kein Tausenderpunkt. */
const csvAmount = (v: Dec) => v.toDecimalPlaces(2).toFixed(2).replace(".", ",");
const csvCell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvLine = (cells: string[]) => cells.map(csvCell).join(";");

/** CSV mit Strichpunkt (Excel in Österreich), UTF-8 mit BOM. */
export function e1kvCsv(doc: E1kvDocument): string {
  const lines = [
    csvLine([`KESt-Rücklage: ${doc.title}`]),
    csvLine(["Hinweis", doc.disclaimer]),
    ...doc.meta.map(([k, v]) => csvLine([k, v])),
    "",
    csvLine(["Kennzahl", "Bedeutung", "Betrag EUR"]),
    ...doc.kz.map((k) => csvLine([`KZ ${k.kz}`, k.label, csvAmount(k.amountEur)])),
    "",
    csvLine(["Steuer und Rücklage", "Betrag EUR"]),
    ...doc.summary.map(([l, v]) => csvLine([l, csvAmount(v)])),
    "",
    csvLine(["Einstellungen"]),
    ...doc.settings.map((x) => csvLine([x])),
    "",
    csvLine(["Belegliste"]),
    csvLine(["Datum", "Art", "Kennzahl", "ISIN", "Bezeichnung", "Betrag EUR", "Quellensteuer EUR", "Fundstelle"]),
    ...doc.belege.map((b) =>
      csvLine([deDate(b.date), b.art, b.kz, b.isin, b.name, csvAmount(b.amountEur), b.withheldEur ? csvAmount(b.withheldEur) : "", b.source]),
    ),
    "",
    csvLine(["Nicht berechnet"]),
    ...(doc.notComputed.length ? doc.notComputed.map((x) => csvLine([x])) : [csvLine(["–"])]),
  ];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- PDF

const WIN_ANSI_EXTRA: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f, "−": 0x2d, " ": 0x20, "\t": 0x20, "\n": 0x20,
};

/** Text in WinAnsiEncoding (Standardschriften im PDF); nicht darstellbare Zeichen werden „?“. */
export function winAnsi(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0x3f;
    const extra = WIN_ANSI_EXTRA[ch];
    if (extra !== undefined) out.push(extra);
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else out.push(0x3f);
  }
  return Uint8Array.from(out);
}

const hexOf = (text: string) => Array.from(winAnsi(text), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");

type Font = "F1" | "F2" | "F3"; // Helvetica, Helvetica-Bold, Courier
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const BOTTOM = 56;
/** grobe mittlere Zeichenbreite in em (Helvetica), für Umbruch und Kürzen */
const EM: Record<Font, number> = { F1: 0.5, F2: 0.56, F3: 0.6 };
const n = (v: number) => (Math.round(v * 100) / 100).toString();

class Layout {
  pages: string[][] = [[]];
  y = PAGE_H - MARGIN;

  private get ops() {
    return this.pages[this.pages.length - 1]!;
  }

  newPage() {
    this.pages.push([]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  text(x: number, y: number, text: string, font: Font, size: number, gray = 0) {
    this.ops.push(`${n(gray)} g BT /${font} ${n(size)} Tf 1 0 0 1 ${n(x)} ${n(y)} Tm <${hexOf(text)}> Tj ET`);
  }

  /** rechtsbündig in Courier (feste Zeichenbreite) */
  amount(right: number, y: number, text: string, size: number, gray = 0) {
    this.text(right - [...text].length * EM.F3 * size, y, text, "F3", size, gray);
  }

  rule(y: number, gray = 0.75) {
    this.ops.push(`${n(gray)} G 0.5 w ${MARGIN} ${n(y)} m ${PAGE_W - MARGIN} ${n(y)} l S`);
  }

  box(x: number, y: number, w: number, h: number) {
    this.ops.push(`0.92 0.98 0.95 rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
  }

  /** Absatz mit Umbruch an Wortgrenzen */
  paragraph(text: string, font: Font, size: number, gray = 0, x = MARGIN, width = PAGE_W - 2 * MARGIN) {
    for (const line of wrap(text, width, font, size)) {
      this.ensure(size * 1.4);
      this.y -= size * 1.4;
      this.text(x, this.y, line, font, size, gray);
    }
  }
}

function wrap(text: string, width: number, font: Font, size: number): string[] {
  const max = Math.max(10, Math.floor(width / (EM[font] * size)));
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    if (cur && [...cur].length + 1 + [...word].length > max) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines;
}

const cut = (text: string, chars: number) => ([...text].length > chars ? `${[...text].slice(0, chars - 1).join("")}…` : text);

/** PDF (A4) mit Standardschriften, ohne Komprimierung. */
export function e1kvPdf(doc: E1kvDocument): Uint8Array<ArrayBuffer> {
  const L = new Layout();
  const right = PAGE_W - MARGIN;

  L.y -= 18;
  L.text(MARGIN, L.y, `KESt-Rücklage · ${doc.title}`, "F2", 18);
  // Hinweis gut sichtbar in einem farbigen Kasten
  const disclaimerLines = wrap(doc.disclaimer, PAGE_W - 2 * MARGIN - 16, "F2", 10);
  const boxH = disclaimerLines.length * 14 + 12;
  L.y -= 10;
  L.box(MARGIN, L.y - boxH, PAGE_W - 2 * MARGIN, boxH);
  let yy = L.y - 6;
  for (const line of disclaimerLines) {
    yy -= 14;
    L.text(MARGIN + 8, yy + 3, line, "F2", 10);
  }
  L.y -= boxH + 8;
  for (const [k, v] of doc.meta) {
    const lines = wrap(v, PAGE_W - 2 * MARGIN - 110, "F1", 9);
    lines.forEach((line, i) => {
      L.ensure(13);
      L.y -= 13;
      if (i === 0) L.text(MARGIN, L.y, k, "F2", 9);
      L.text(MARGIN + 110, L.y, line, "F1", 9);
    });
  }

  const heading = (t: string) => {
    L.ensure(40);
    L.y -= 26;
    L.text(MARGIN, L.y, t, "F2", 13);
    L.y -= 6;
    L.rule(L.y, 0);
  };

  heading("Kennzahlen für die Beilage E1kv");
  for (const k of doc.kz) {
    L.ensure(15);
    L.y -= 15;
    const gray = k.amountEur.isZero() ? 0.45 : 0;
    L.text(MARGIN, L.y, `KZ ${k.kz}`, "F2", 10, gray);
    L.text(MARGIN + 60, L.y, k.label, "F1", 10, gray);
    L.amount(right, L.y, formatEur(k.amountEur), 10, gray);
  }

  heading("Steuer und Rücklage");
  for (const [l, v] of doc.summary) {
    L.ensure(15);
    L.y -= 15;
    L.text(MARGIN, L.y, l, "F1", 10);
    L.amount(right, L.y, formatEur(v), 10);
  }

  heading("Einstellungen und Annahmen");
  for (const x of doc.settings) L.paragraph(x, "F1", 9);

  heading("Belegliste");
  const cols = { date: MARGIN, art: MARGIN + 52, kz: MARGIN + 122, name: MARGIN + 152 };
  const head = () => {
    L.y -= 12;
    L.text(cols.date, L.y, "Datum", "F2", 8, 0.35);
    L.text(cols.art, L.y, "Art", "F2", 8, 0.35);
    L.text(cols.kz, L.y, "KZ", "F2", 8, 0.35);
    L.text(cols.name, L.y, "Bezeichnung", "F2", 8, 0.35);
    L.text(right - 150, L.y, "Betrag", "F2", 8, 0.35);
    L.text(right - 52, L.y, "Quellenst.", "F2", 8, 0.35);
  };
  head();
  if (doc.belege.length === 0) L.paragraph("Keine Buchungen in diesem Jahr.", "F1", 9, 0.45);
  for (const b of doc.belege) {
    if (L.y - 24 < BOTTOM) {
      L.newPage();
      head();
    }
    L.y -= 12;
    L.text(cols.date, L.y, deDate(b.date), "F1", 8);
    L.text(cols.art, L.y, b.art, "F1", 8);
    L.text(cols.kz, L.y, b.kz, "F1", 8);
    L.text(cols.name, L.y, cut(b.name || b.isin, 44), "F1", 8);
    L.amount(right - 72, L.y, formatEur(b.amountEur), 8);
    if (b.withheldEur) L.amount(right, L.y, formatEur(b.withheldEur), 8);
    L.y -= 10;
    L.text(cols.name, L.y, cut(`${b.isin ? `${b.isin} · ` : ""}${b.source}`, 70), "F1", 7, 0.45);
  }

  heading("Nicht berechnet, bitte prüfen");
  if (doc.notComputed.length === 0) L.paragraph("Keine offenen Punkte.", "F1", 9, 0.45);
  for (const x of doc.notComputed) L.paragraph(`• ${x}`, "F1", 8);

  // Fußzeile mit Hinweis, Regelversion und Seitenzahl auf jeder Seite
  const total = L.pages.length;
  L.pages.forEach((ops, i) => {
    const regel = doc.meta.find(([k]) => k === "Regelversion")?.[1] ?? "";
    ops.push(`0.45 g BT /F1 7.5 Tf 1 0 0 1 ${MARGIN} 28 Tm <${hexOf(`Berechnungstool, keine Steuerberatung. · Regelversion ${regel} · Seite ${i + 1} von ${total}`)}> Tj ET`);
  });

  return writePdf(L.pages, doc.title);
}

function writePdf(pages: string[][], title: string): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${7 + 2 * i} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  // Titel als UTF-16BE mit BOM, damit Umlaute im Dokumenttitel stimmen
  const utf16 = Array.from(`KESt-Rücklage · ${title}`, (c) => (c.codePointAt(0) ?? 0x3f).toString(16).padStart(4, "0").toUpperCase()).join("");
  objects.push(`<< /Title <FEFF${utf16}> /Producer (KESt-Ruecklage) >>`);
  for (const [i, ops] of pages.entries()) {
    const content = ops.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${8 + 2 * i} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  // Alles ist ASCII (Text steht als Hex-String im Inhalt), also Zeichen = Bytes.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

/** Summe der Belegbeträge je Kennzahl (zur Kontrolle gegen die Kennzahlen). */
export const sumByKz = (belege: Beleg[]) => {
  const m = new Map<string, Dec>();
  for (const b of belege) m.set(b.kz, D.sum(m.get(b.kz) ?? ZERO, b.amountEur.abs()));
  return m;
};
