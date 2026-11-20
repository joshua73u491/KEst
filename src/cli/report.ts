import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatReport } from "../format.js";
import { parseRateFile } from "../fx.js";
import { parseExport } from "../import/readAny.js";
import { computeYear, type YearOptions } from "../yearReport.js";

const USAGE =
  "Aufruf: npm run report -- <Trade-Republic-CSV oder IBKR-Flex-XML> [Jahr] [--steuereinfach-seit JJJJ-MM-TT] " +
  "[--ezb-kurse <eurofxref-hist.csv>] [--ibkr-zinsen 863|861]";

let file: string | undefined;
let yearArg: string | undefined;
let values: Record<string, string | undefined> = {};
try {
  const parsed = parseArgs({
    allowPositionals: true,
    options: { "steuereinfach-seit": { type: "string" }, "ezb-kurse": { type: "string" }, "ibkr-zinsen": { type: "string" } },
  });
  [file, yearArg] = parsed.positionals;
  values = parsed.values;
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
  process.exit(1);
}
if (!file) {
  console.error(USAGE);
  process.exit(1);
}
const year = Number(yearArg ?? new Date().getFullYear());
try {
  const { broker, data } = parseExport(readFileSync(file, "utf8"));
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
  console.log(`Gelesen: ${broker}`);
  console.log(formatReport(computeYear(data, year, options)));
} catch (e) {
  console.error(`Auswertung nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
