import { readFileSync, writeFileSync } from "node:fs";
import { buildE1kvDocument, e1kvCsv, e1kvPdf } from "../e1kvReport.js";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { checkBookings, type CheckInput } from "../check.js";
import { formatFindings, formatReport } from "../format.js";
import { parseRateFile } from "../fx.js";
import { addFile, combine, emptyHistory, filePeriods } from "../history.js";
import { computeYear, type YearOptions } from "../yearReport.js";

const USAGE =
  "Aufruf: npm run report -- <Datei> [weitere Dateien …] [Jahr] [--steuereinfach-seit JJJJ-MM-TT] " +
  "[--ezb-kurse <eurofxref-hist.csv>] [--ibkr-zinsen 863|861] [--derivate tarif|275] [--sonstiges-einkommen 30000] " +
  "[--pdf <bericht.pdf>] [--csv <bericht.csv>]\n" +
  "Dateien: Trade-Republic-CSV, IBKR-Flex-XML oder DEGIRO-CSV; mehrere werden zusammengeführt, Duplikate zählen nur einmal.";

let positionals: string[] = [];
let values: Record<string, string | undefined> = {};
try {
  const parsed = parseArgs({
    allowPositionals: true,
    options: {
      "steuereinfach-seit": { type: "string" },
      "ezb-kurse": { type: "string" },
      "ibkr-zinsen": { type: "string" },
      derivate: { type: "string" },
      "sonstiges-einkommen": { type: "string" },
      pdf: { type: "string" },
      csv: { type: "string" },
    },
  });
  positionals = parsed.positionals;
  values = parsed.values;
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
  process.exit(1);
}
const last = positionals[positionals.length - 1];
const yearGiven = last !== undefined && /^\d{4}$/.test(last);
const files = yearGiven ? positionals.slice(0, -1) : positionals;
if (files.length === 0) {
  console.error(USAGE);
  process.exit(1);
}
const year = yearGiven ? Number(last) : new Date().getFullYear();
try {
  let history = emptyHistory();
  for (const [i, file] of files.entries()) {
    const r = addFile(history, basename(file), readFileSync(file, "utf8"), new Date().toISOString(), `f${i}`);
    history = r.history;
    console.log(`Gelesen: ${basename(file)} (${r.broker})${r.added ? "" : " – gleicher Inhalt wie eine andere Datei, übersprungen"}`);
  }
  const { data, duplicates } = combine(history);
  if (duplicates > 0) console.log(`${duplicates} doppelte Buchungen nur einmal gezählt.`);
  const options: YearOptions = {};
  const since = values["steuereinfach-seit"];
  const ratesFile = values["ezb-kurse"];
  const interestKz = values["ibkr-zinsen"];
  if (since) options.taxSimpleSince = since;
  if (ratesFile) options.rates = parseRateFile(readFileSync(ratesFile, "latin1"));
  if (interestKz !== undefined) {
    if (interestKz !== "861" && interestKz !== "863") throw new Error(`--ibkr-zinsen erwartet 863 oder 861, nicht „${interestKz}“.`);
    options.brokerInterestKz = interestKz;
  }
  const derivate = values.derivate;
  if (derivate !== undefined) {
    if (derivate !== "tarif" && derivate !== "275") throw new Error(`--derivate erwartet tarif oder 275, nicht „${derivate}“.`);
    options.derivativesTreatment = derivate === "275" ? "special" : "tariff";
  }
  const otherIncome = values["sonstiges-einkommen"];
  if (otherIncome !== undefined) options.otherIncomeEur = otherIncome;
  const checkInput: CheckInput = { data, duplicates, periods: filePeriods(history) };
  if (options.rates) checkInput.rates = options.rates;
  if (options.taxSimpleSince) checkInput.taxSimpleSince = options.taxSimpleSince;
  console.log(formatFindings(checkBookings(checkInput)));
  console.log("");
  const report = computeYear(data, year, options);
  console.log(formatReport(report));
  if (values.pdf || values.csv) {
    const doc = buildE1kvDocument(report, {
      createdAt: new Date().toISOString().slice(0, 10),
      files: history.files.map((f) => f.name),
      settings: {
        ...history.settings,
        taxSimpleSince: options.taxSimpleSince ?? "",
        brokerInterestKz: options.brokerInterestKz ?? "863",
        derivativesTreatment: options.derivativesTreatment ?? "tariff",
        otherIncomeEur: options.otherIncomeEur ?? "",
      },
    });
    if (values.pdf) {
      writeFileSync(values.pdf, e1kvPdf(doc));
      console.log(`PDF gespeichert: ${values.pdf}`);
    }
    if (values.csv) {
      writeFileSync(values.csv, e1kvCsv(doc), "utf8");
      console.log(`CSV gespeichert: ${values.csv}`);
    }
  }
} catch (e) {
  console.error(`Auswertung nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
