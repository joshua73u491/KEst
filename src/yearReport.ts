import { computeBasket275, type Dividend } from "./basket275.js";
import { InsufficientPositionError, Positions, type Position, type Trade } from "./costBasis.js";
import { dec, D, ZERO, type Dec } from "./decimal.js";
import { runDerivatives, type DerivativeInput, type OpenDerivative } from "./derivatives.js";
import { extraTaxOnTariffIncome, hasTariff } from "./tariff.js";
import { formatEur } from "./format.js";
import type { RateSource } from "./fx.js";
import type { AssetKind, ImportedTrade, ImportResult, Unsupported } from "./import/model.js";
import { countryOfIsin, dividendTreatyRate } from "./treaty.js";

export const BANK_INTEREST_RATE = dec("0.25");

/** Depot von Trade Republic; nur dort gilt „steuereinfach seit“. */
const TR_DEPOT = "TR";

export interface YearOptions {
  /**
   * Tag (JJJJ-MM-TT), ab dem Trade Republic für dieses Konto die KESt selbst abzieht (steuereinfach).
   * Erträge ab diesem Tag gelten als endbesteuert: Sie zählen nicht für die E1kv und nicht für die Rücklage.
   */
  taxSimpleSince?: string;
  /** EZB-Referenzkurse für Beträge in Fremdwährung; ohne Kursquelle werden sie als „nicht berechnet“ gemeldet */
  rates?: RateSource;
  /**
   * Kennzahl für Zinsen auf dem Konto eines Brokers (IBKR): KZ 863 (27,5 %, Verlustausgleich möglich, Standard)
   * oder KZ 861 (25 %). Offene Frage an den Steuerberater, siehe docs/HANDOFF.md.
   */
  brokerInterestKz?: "861" | "863";
  /**
   * Behandlung nicht verbriefter Derivate (Optionen, Futures bei IBKR): `tariff` = Tarif, KZ 857 (Standard, vorsichtig;
   * § 27a Abs. 2 Z 7 EStG) oder `special` = 27,5 %, KZ 995/896. Offene Frage an den Steuerberater, siehe docs/HANDOFF.md.
   */
  derivativesTreatment?: "tariff" | "special";
  /**
   * Geschätztes zu versteuerndes Einkommen des Jahres ohne Kapitalerträge (z. B. Gehalt nach Sozialversicherung).
   * Nur nötig für die Mehrsteuer auf KZ 857 (Tarif); ohne Angabe wird sie nicht berechnet.
   */
  otherIncomeEur?: string;
}

export interface RealizedLine {
  isin: string;
  name: string;
  date: string;
  kind: AssetKind;
  gainEur: Dec;
}

export interface DividendLine {
  line: number;
  isin: string;
  name: string;
  date: string;
  /** Quellenstaat laut ISIN */
  country: string;
  /** Ausschüttungswährung, leer bei EUR */
  originalCurrency: string;
  /** verwendeter EZB-Referenzkurs im Zuflusszeitpunkt (Einheiten Fremdwährung je EUR), `null` bei EUR */
  ecbRate: Dec | null;
  /** Bruttobetrag in EUR (bei Fremdwährung zum EZB-Referenzkurs) */
  grossEur: Dec;
  /** tatsächlich einbehaltene Quellensteuer in EUR (bei Fremdwährung zum EZB-Referenzkurs) */
  withheldEur: Dec;
  /** DBA-Höchstsatz, 0 wenn nicht hinterlegt */
  treatyRate: Dec;
  /** Link auf den DBA-Text im RIS, `null` wenn der Satz nicht hinterlegt ist */
  treatySource: string | null;
  /** anrechenbar vor dem Verlustausgleich: einbehalten, höchstens DBA-Satz */
  creditableEur: Dec;
}

/** Ertrag, für den Trade Republic die KESt bereits abgezogen hat (steuereinfach). */
export interface BrokerTaxedLine {
  line: number;
  date: string;
  kind: "sale" | "dividend" | "interest";
  /** leer bei Zinsen auf dem Verrechnungskonto */
  isin: string;
  name: string;
  /** Gewinn laut App (Verkauf) bzw. Bruttobetrag (Ausschüttung, Zinsen) */
  amountEur: Dec;
  /** von Trade Republic einbehalten laut Spalte tax (negativ = gutgeschrieben) */
  withheldEur: Dec;
}

export interface YearReport {
  year: number;
  /** Tag, ab dem Trade Republic die KESt abzieht, oder `null` (nicht steuereinfach) */
  taxSimpleSince: string | null;
  kz994: Dec;
  kz892: Dec;
  kz995: Dec;
  kz896: Dec;
  kz174: Dec;
  kz176: Dec;
  kz863: Dec;
  kz998: Dec;
  /** Zinsen aus Geldeinlagen bei Kreditinstituten (25 %) */
  kz861: Dec;
  /** Zinsen auf dem Konto eines Brokers (IBKR) im Jahr, enthalten in KZ 863 oder KZ 861 laut Einstellung */
  brokerInterestEur: Dec;
  brokerInterestKz: "861" | "863";
  /** Einkünfte aus nicht verbrieften Derivaten zum Tarif (Saldo, kann negativ sein); 0 bei Einstellung 27,5 % */
  kz857: Dec;
  derivativesTreatment: "tariff" | "special";
  /** Mehrsteuer auf KZ 857 nach Tarif: ESt(sonstiges Einkommen + KZ 857) − ESt(sonstiges Einkommen); 0 wenn nicht berechenbar */
  tariffExtraTaxEur: Dec;
  /** verwendetes sonstiges Einkommen, `null` ohne Angabe */
  otherIncomeEur: Dec | null;
  /** offene Optionen und Futures am Ende der Daten (Short mit negativer Anzahl) */
  openDerivatives: OpenDerivative[];
  taxableBaseEur: Dec;
  unusedLossEur: Dec;
  tax275Eur: Dec;
  tax25Eur: Dec;
  /** gezahlte Ordergebühren im Jahr (im 27,5 %-Topf nicht abziehbar) */
  feesEur: Dec;
  realized: RealizedLine[];
  dividends: DividendLine[];
  /** endbesteuerte Erträge ab `taxSimpleSince` */
  taxedByBroker: BrokerTaxedLine[];
  /** Summe der von Trade Republic einbehaltenen Steuer auf `taxedByBroker` */
  brokerWithheldEur: Dec;
  openPositions: Array<Position & { isin: string; depot: string }>;
  notComputed: Unsupported[];
}

/** Fundstelle einer Buchung: Zeile und, wenn mehrere Dateien zusammengeführt wurden, die Datei */
type Where = { line: number; file?: string };
const at = (w: Where): Where => (w.file === undefined ? { line: w.line } : { line: w.line, file: w.file });

const withheldNote = (withheld: Dec) =>
  `Trade Republic hat ${formatEur(withheld)} Steuer einbehalten (Spalte tax). Bei einem Konto ohne KESt-Abzug wird sie nicht angerechnet. Ist dein Konto steuereinfach, gib an, seit wann.`;

/**
 * Wertet alle Buchungen aus: Bestände über die gesamte Historie, Gewinne und Steuer nur für `year`.
 */
export function computeYear(data: ImportResult, year: number, options: YearOptions = {}): YearReport {
  const since = options.taxSimpleSince ?? null;
  if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`Das Datum für „steuereinfach seit“ ist ungültig: „${since}“. Erwartet wird JJJJ-MM-TT.`);
  }
  /** Ab der Umstellung zieht Trade Republic die KESt selbst ab: Erträge in diesem Depot sind endbesteuert. */
  const taxedByTr = (depot: string, date: string) => depot === TR_DEPOT && since !== null && date >= since;
  const inYear = (date: string) => date.startsWith(`${year}-`);
  const brokerInterestKz = options.brokerInterestKz ?? "863";
  const otherIncomeRaw = (options.otherIncomeEur ?? "").trim();
  if (otherIncomeRaw !== "" && !/^\d+(\.\d+)?$/.test(otherIncomeRaw)) {
    throw new Error(`Das sonstige Einkommen „${otherIncomeRaw}“ ist keine gültige Zahl (z. B. 30000 oder 30000.50).`);
  }
  const otherIncome = otherIncomeRaw === "" ? null : dec(otherIncomeRaw);

  /**
   * Betrag in Fremdwährung zum EZB-Referenzkurs am Tag (EStR 2000 Rz 6201c). Ohne Kurs an diesem Tag wird nicht
   * geschätzt; der Grund kommt als Text zurück.
   */
  const ecbToEur = (amount: string, currency: string, date: string, what: string): Dec | string => {
    if (currency === "EUR") return dec(amount);
    if (!options.rates) return `${what} in ${currency}: Die EZB-Referenzkurse sind nicht geladen. Nicht berechnet.`;
    const rate = options.rates.rate(currency, date);
    if (!rate) return `${what} in ${currency}: Für ${currency} gibt es am ${date} keinen EZB-Referenzkurs. Nicht berechnet.`;
    return dec(amount).div(rate);
  };

  /** Kurswert und Spesen eines Trades in EUR; bei IBKR-Trades in Fremdwährung zum EZB-Kurs am Handelstag. */
  const tradeInEur = (t: ImportedTrade): ImportedTrade | string => {
    if (!t.convert) return t;
    const amount = ecbToEur(t.convert.amount, t.convert.currency, t.date, `Trade von ${t.isin}`);
    if (typeof amount === "string") return amount;
    // Spesen dienen nur der Information (im 27,5 %-Topf nicht abziehbar); ohne Kurs werden sie nicht mitgezählt.
    const fee = t.convert.fees.reduce((sum, f) => {
      const eur = ecbToEur(f.amount, f.currency, t.date, "Spesen");
      return typeof eur === "string" ? sum : sum.plus(eur);
    }, ZERO);
    return { ...t, amountEur: amount.toString(), feeEur: fee.toString() };
  };
  const positions = new Positions();
  const realized: RealizedLine[] = [];
  const taxedByBroker: BrokerTaxedLine[] = [];
  let feesEur = ZERO;

  const notComputed: Unsupported[] = [...data.unsupported];
  /** Positionen (Depot|ISIN), deren Bestand seit einer Zeile nicht mehr vollständig bekannt ist */
  const broken = new Map<string, number>();
  const markBroken = (depot: string, isin: string, line: number) => {
    const key = `${depot}|${isin}`;
    if (!broken.has(key)) broken.set(key, line);
  };

  /**
   * Verkauf oder Übertrag mit fehlendem Bestand: nie schätzen. Die Buchung und alle späteren Abgänge
   * derselben Position werden als „nicht berechnet“ gemeldet, die übrige Auswertung läuft weiter.
   */
  const applyChecked = (trade: Trade, where: Where, type: string) => {
    const key = `${trade.depot}|${trade.isin}`;
    const brokenSince = broken.get(key);
    if (brokenSince !== undefined) {
      if (trade.side !== "buy") {
        notComputed.push({
          ...at(where),
          type,
          reason: `Bestand von ${trade.isin} ist seit Zeile ${brokenSince} unvollständig; ${trade.side === "sell" ? "Gewinn" : "Übertrag"} nicht berechnet`,
        });
      }
      return null;
    }
    try {
      return positions.apply(trade);
    } catch (e) {
      if (!(e instanceof InsufficientPositionError)) throw e;
      broken.set(key, where.line);
      notComputed.push({
        ...at(where),
        type,
        reason:
          `${trade.side === "sell" ? "Verkauf" : "Übertrag"} von ${dec(trade.quantity).toString()} Stück ${trade.isin} am ${trade.date} ` +
          `übersteigt den bekannten Bestand von ${e.available.toString()}. Vermutlich liegt ein Kauf vor dem Exportzeitraum ` +
          `oder eine Einbuchung fehlt. ${trade.side === "sell" ? "Gewinn" : "Übertrag"} nicht berechnet; ` +
          `bitte den Export mit Zeitraum seit Kontoeröffnung verwenden.`,
      });
      return null;
    }
  };

  // Nicht verbriefte Derivate (Optionen, Futures): eigene Rechnung über alle Jahre (src/derivatives.ts).
  // Bei Ausübung oder Zuteilung geht die Prämie in die Aktienbuchung ein (adjustments).
  const derivativesTreatment = options.derivativesTreatment ?? "tariff";
  const securityTrades = data.trades.filter((t) => t.kind !== "derivative");
  const derivativeInputs: DerivativeInput[] = data.trades
    .filter((t) => t.kind === "derivative")
    .map((t) => {
      const c = tradeInEur(t);
      return typeof c === "string" ? { trade: t, failure: c } : { trade: c };
    });
  const deriv = runDerivatives(derivativeInputs, securityTrades, derivativesTreatment === "tariff");

  // Bei identischem Zeitstempel zuerst Käufe, dann Verkäufe und Überträge (Annahme, siehe README).
  const rank = (side: "buy" | "sell" | "transfer_out") => (side === "buy" ? 0 : 1);
  const events: Array<{ at: string; rank: number; apply: () => void }> = [
    ...securityTrades.map((original) => ({
      at: original.datetime || original.date,
      rank: rank(original.side),
      apply: () => {
        const side = original.side === "buy" ? "BUY" : "SELL";
        const type = original.depot === TR_DEPOT ? `TRADING/${side}` : `Trade/${side}`;
        const converted = tradeInEur(original);
        if (typeof converted === "string") {
          // Ohne Kurs kein Trade: der Bestand dieser Position ist ab hier unsicher.
          notComputed.push({ ...at(original), type, reason: converted });
          markBroken(original.depot, original.isin, original.line);
          return;
        }
        // Prämie aus Ausübung oder Zuteilung: Anschaffungskosten (Kauf) bzw. Veräußerungserlös (Verkauf) anpassen
        const adj = deriv.adjustments.get(original);
        const t = adj ? { ...converted, amountEur: dec(converted.amountEur).plus(adj).toString() } : converted;
        const r = applyChecked(t, t, type);
        if (!inYear(t.date)) return;
        feesEur = feesEur.plus(t.feeEur);
        const withheld = dec(t.withheldEur);
        if (taxedByTr(t.depot, t.date)) {
          if (r) {
            taxedByBroker.push({ line: t.line, date: t.date, kind: "sale", isin: t.isin, name: t.name, amountEur: r.gainEur, withheldEur: withheld });
          }
          return;
        }
        if (!withheld.isZero()) notComputed.push({ ...at(t), type, reason: withheldNote(withheld) });
        if (r) realized.push({ isin: t.isin, name: t.name, date: t.date, kind: t.kind, gainEur: r.gainEur });
      },
    })),
    ...data.transfersOut.map((t) => ({
      at: t.datetime || t.date,
      rank: rank("transfer_out"),
      apply: () => void applyChecked({ ...t, side: "transfer_out", amountEur: "0" }, t, "DELIVERY/FREE_DELIVERY"),
    })),
  ];
  // Übersprungene Bestandsbuchungen: ab diesem Zeitpunkt ist der Bestand der Position unsicher.
  for (const u of data.unsupported) {
    const a = u.affects;
    if (!a) continue;
    events.push({ at: a.datetime, rank: 0, apply: () => markBroken(a.depot, a.isin, u.line) });
  }
  // Kapitalausschüttung vor der Umstellung: kann eine Einlagenrückzahlung sein, die die Anschaffungskosten mindert.
  for (const d of data.dividends) {
    if (d.kind !== "capitalDistribution" || taxedByTr(d.depot, d.date)) continue;
    events.push({
      at: d.datetime || d.date,
      rank: 0,
      apply: () => {
        notComputed.push({
          ...at(d),
          type: "CASH/DIVIDEND_EQUIVALENT_PAYMENT",
          reason:
            `Kapitalausschüttung von ${d.isin} (${formatEur(d.grossEur)}): Ob es eine Dividende oder eine Einlagenrückzahlung ist, ` +
            `die die Anschaffungskosten mindert, ist aus dem Export nicht erkennbar. Nicht berechnet, spätere Verkäufe dieser Position ebenfalls nicht.`,
        });
        markBroken(d.depot, d.isin, d.line);
      },
    });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.rank - b.rank).forEach((e) => e.apply());

  // Abgleich mit dem Bestand laut Broker (IBKR OpenPositions): Abweichungen nie still übergehen.
  for (const p of data.reportedPositions) {
    if (broken.has(`${p.depot}|${p.isin}`)) continue; // bereits als unvollständig gemeldet
    const app = positions.get(p.isin, p.depot).quantity;
    if (app.eq(p.quantity)) continue;
    notComputed.push({
      ...at(p),
      type: "OpenPosition",
      reason:
        `Bestand von ${p.isin} laut ${p.depot.split(" ")[0]} am ${p.date}: ${dec(p.quantity).toString()} Stück, laut App: ${app.toString()} Stück. ` +
        `Vermutlich fehlen Käufe vor dem Exportzeitraum; Verkäufe dieser Position können falsch berechnet sein. ` +
        `Bitte den Export mit Zeitraum seit Kontoeröffnung verwenden.`,
    });
  }

  // Ausschüttungen im Jahr
  const dividends: DividendLine[] = [];
  const basketDividends: Dividend[] = [];
  for (const d of data.dividends.filter((x) => inYear(x.date))) {
    const type = d.kind === "fund" ? "CASH/DISTRIBUTION" : d.kind === "capitalDistribution" ? "CASH/DIVIDEND_EQUIVALENT_PAYMENT" : "CASH/DIVIDEND";
    let gross = d.grossEur === "" ? ZERO : dec(d.grossEur);
    let withheld = d.withheldEur === "" ? ZERO : dec(d.withheldEur);
    if (taxedByTr(d.depot, d.date)) {
      taxedByBroker.push({ line: d.line, date: d.date, kind: "dividend", isin: d.isin, name: d.name, amountEur: gross, withheldEur: withheld });
      continue;
    }
    if (d.kind === "capitalDistribution") continue; // oben gemeldet
    const skip = (reason: string) => notComputed.push({ ...at(d), type, reason });
    if (d.kind === "fund") {
      // § 186 Abs. 1, Abs. 2 Z 2 und Z 3 InvFG 2011: https://www.jusline.at/gesetz/invfg_2011/paragraf/186
      skip(
        `Ausschüttung des Fonds/ETF ${d.isin}: Steuerpflichtig ist bei Meldefonds der von der Meldestelle (OeKB) veröffentlichte Anteil, ` +
          `bei Nicht-Meldefonds die ganze Ausschüttung (§ 186 InvFG 2011). Nicht berechnet.`,
      );
      continue;
    }
    let ecbRate: Dec | null = null;
    if (d.originalCurrency !== "") {
      // EStR 2000 Rz 6201c: Einkünfte in Fremdwährung (zB Dividenden) mit dem EZB-Referenzkurs im Zuflusszeitpunkt bewerten.
      // https://findok.bmf.gv.at (EStR 2000, Abschnitt 20.2.4.12, Fassung vom 21.04.2026)
      const cur = d.originalCurrency;
      if (!options.rates) {
        skip(`Dividende von ${d.isin} in ${cur}: Die EZB-Referenzkurse sind nicht geladen. Nicht berechnet.`);
        continue;
      }
      if (d.originalAmount === "") {
        skip(`Dividende von ${d.isin}: Der Originalbetrag in ${cur} fehlt im Export. Nicht berechnet.`);
        continue;
      }
      const rate = options.rates.rate(cur, d.date);
      if (!rate) {
        skip(
          `Dividende von ${d.isin}: Für ${cur} gibt es am ${d.date} keinen EZB-Referenzkurs (z. B. Wochenende oder Feiertag). ` +
            `Eine offizielle Regel für diesen Fall ist nicht bekannt. Nicht berechnet.`,
        );
        continue;
      }
      if (d.withheldOriginal !== "") {
        // IBKR weist die Quellensteuer in der Originalwährung aus.
        withheld = dec(d.withheldOriginal).div(rate);
      } else if (!withheld.isZero()) {
        // Trade Republic weist die Steuer nur in EUR aus. Zurück in die Originalwährung mit dem Kurs von Trade Republic
        // (Annahme im README: dieselbe Umrechnung wie beim Bruttobetrag), dann zum EZB-Kurs in EUR.
        if (d.brokerFxRate === "" || dec(d.brokerFxRate).lte(0)) {
          skip(
            `Dividende von ${d.isin} in ${cur}: Der Umrechnungskurs von Trade Republic fehlt, die einbehaltene Steuer lässt sich nicht in ${cur} zurückrechnen. Nicht berechnet.`,
          );
          continue;
        }
        withheld = withheld.div(d.brokerFxRate).div(rate);
      }
      gross = dec(d.originalAmount).div(rate);
      ecbRate = rate;
    }
    const country = countryOfIsin(d.isin);
    if (country === null) {
      skip(`Dividende von ${d.isin}: keine gültige ISIN, Quellenstaat unbekannt. Nicht berechnet.`);
      continue;
    }
    if (country === "AT") {
      skip(`Inländische Dividende von ${d.isin}: Die App rechnet bisher nur ausländische Kapitaleinkünfte. Nicht berechnet.`);
      continue;
    }
    if (withheld.lt(0)) {
      skip(`Dividende von ${d.isin} mit Steuergutschrift von ${formatEur(withheld.negated())} statt eines Abzugs. Nicht berechnet, bitte prüfen.`);
      continue;
    }
    const treaty = dividendTreatyRate(country);
    const treatyRate = treaty?.rate ?? ZERO;
    if (!treaty && withheld.gt(0)) {
      skip(
        `Quellensteuer ${formatEur(withheld)} auf die Dividende von ${d.isin} wird nicht angerechnet: Der DBA-Satz für ${country} ist in der App noch nicht hinterlegt. ` +
          `Die Steuer fällt dadurch eher zu hoch aus.`,
      );
    }
    basketDividends.push({ grossEur: gross, withholdingEur: withheld, treatyRate });
    dividends.push({
      line: d.line,
      isin: d.isin,
      name: d.name,
      date: d.date,
      country,
      originalCurrency: d.originalCurrency,
      ecbRate,
      grossEur: gross,
      withheldEur: withheld,
      treatyRate,
      treatySource: treaty?.source ?? null,
      creditableEur: D.min(withheld, gross.times(treatyRate)),
    });
  }

  // Zinsen im Jahr
  let kz861 = ZERO;
  let brokerInterestEur = ZERO;
  for (const i of data.interest.filter((x) => inYear(x.date))) {
    const type = i.depot === TR_DEPOT ? "CASH/INTEREST_PAYMENT" : "CashTransaction/Broker Interest Received";
    const withheld = dec(i.withheldEur);
    if (taxedByTr(i.depot, i.date)) {
      taxedByBroker.push({ line: i.line, date: i.date, kind: "interest", isin: i.isin, name: "", amountEur: dec(i.amountEur), withheldEur: withheld });
      continue;
    }
    if (i.isin !== "") {
      notComputed.push({ ...at(i), type, reason: `Zinsen aus dem Wertpapier ${i.isin} (KZ 863) werden noch nicht berechnet.` });
      continue;
    }
    // Zinsen in Fremdwährung: EZB-Referenzkurs im Zuflusszeitpunkt (EStR 2000 Rz 6201c)
    const amount = i.convert ? ecbToEur(i.convert.amount, i.convert.currency, i.date, "Zinsen") : dec(i.amountEur);
    if (typeof amount === "string") {
      notComputed.push({ ...at(i), type, reason: amount });
      continue;
    }
    if (!withheld.isZero()) notComputed.push({ ...at(i), type, reason: withheldNote(withheld) });
    if (i.source === "broker") {
      brokerInterestEur = brokerInterestEur.plus(amount);
      // KZ 863: im 27,5 %-Topf mit Verlustausgleich; ohne Quellensteuer
      if (brokerInterestKz === "863") basketDividends.push({ grossEur: amount, withholdingEur: ZERO, treatyRate: ZERO });
      else kz861 = kz861.plus(amount);
      continue;
    }
    kz861 = kz861.plus(amount);
  }

  // Ergebnisse aus nicht verbrieften Derivaten im Jahr (Verfall, Glattstellung, Verkauf)
  notComputed.push(...deriv.notes);
  for (const x of deriv.realized) {
    if (!inYear(x.trade.date)) continue;
    realized.push({ isin: x.trade.derivative?.contract ?? "", name: x.trade.name || (x.trade.derivative?.contract ?? ""), date: x.trade.date, kind: "derivative", gainEur: x.gainEur });
  }
  for (const i of derivativeInputs) if (!i.failure && inYear(i.trade.date)) feesEur = feesEur.plus(i.trade.feeEur || "0");

  const gainsOf = (kind: AssetKind) => realized.filter((r) => r.kind === kind).map((r) => r.gainEur);
  const derivativeGains = gainsOf("derivative");
  const kz857 = derivativesTreatment === "tariff" ? D.sum(ZERO, ...derivativeGains) : ZERO;
  // Mehrsteuer auf KZ 857 nach Tarif (src/tariff.ts); nie mit einem geschätzten Einkommen oder einem fremden Jahrestarif
  let tariffExtraTaxEur = ZERO;
  if (kz857.gt(0)) {
    if (otherIncome === null) {
      notComputed.push({
        line: 0,
        type: "KZ 857",
        reason:
          `Für die Einkommensteuer auf KZ 857 (${formatEur(kz857)}, Tarif bis 55 %) fehlt die Angabe deines sonstigen Einkommens. ` +
          `Ohne sie wird die Mehrsteuer nicht berechnet, und die Rücklage enthält sie nicht.`,
      });
    } else if (!hasTariff(year)) {
      notComputed.push({
        line: 0,
        type: "KZ 857",
        reason: `Der Einkommensteuertarif ${year} ist in der App noch nicht hinterlegt. Die Mehrsteuer auf KZ 857 (${formatEur(kz857)}) wird nicht berechnet.`,
      });
    } else {
      tariffExtraTaxEur = extraTaxOnTariffIncome({ year, otherIncomeEur: otherIncome, kz857Eur: kz857 });
    }
  }
  const basket = computeBasket275({
    realizedGainsEur: gainsOf("security"),
    // Einstellung 27,5 %: nicht verbriefte Derivate laufen wie verbriefte über KZ 995/896 im 27,5 %-Topf
    derivativeGainsEur: [...gainsOf("securitizedDerivative"), ...(derivativesTreatment === "special" ? derivativeGains : [])],
    cryptoGainsEur: gainsOf("crypto"),
    dividends: basketDividends,
  });

  taxedByBroker.sort((a, b) => a.line - b.line);

  return {
    year,
    taxSimpleSince: since,
    kz994: basket.kz994,
    kz892: basket.kz892,
    kz995: basket.kz995,
    kz896: basket.kz896,
    kz174: basket.kz174,
    kz176: basket.kz176,
    kz863: basket.kz863,
    kz998: basket.kz998,
    kz861,
    brokerInterestEur,
    brokerInterestKz,
    kz857,
    derivativesTreatment,
    tariffExtraTaxEur,
    otherIncomeEur: otherIncome,
    openDerivatives: deriv.open,
    taxableBaseEur: basket.taxableBaseEur,
    unusedLossEur: basket.unusedLossEur,
    tax275Eur: basket.taxEur,
    tax25Eur: D.max(ZERO, kz861).times(BANK_INTEREST_RATE),
    feesEur,
    realized,
    dividends,
    taxedByBroker,
    brokerWithheldEur: D.sum(ZERO, ...taxedByBroker.map((x) => x.withheldEur)),
    openPositions: positions.open().filter((p) => !broken.has(`${p.depot}|${p.isin}`)),
    notComputed,
  };
}
