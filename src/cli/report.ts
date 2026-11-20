import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatReport } from "../format.js";
import { parseRateFile } from "../fx.js";
import { parseTradeRepublicCsv } from "../import/tradeRepublic.js";
import { computeYear, type YearOptions } from "../yearReport.js";

const USAGE =
  "Aufruf: npm run report -- <Trade-Republic-CSV> [Jahr] [--steuereinfach-seit JJJJ-MM-TT] [--ezb-kurse <eurofxref-hist.csv>]";

let file: string | undefined;
let yearArg: string | undefined;
let since: string | undefined;
let ratesFile: string | undefined;
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { "steuereinfach-seit": { type: "string" }, "ezb-kurse": { type: "string" } },
  });
  [file, yearArg] = positionals;
  since = values["steuereinfach-seit"];
  ratesFile = values["ezb-kurse"];
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
  const data = parseTradeRepublicCsv(readFileSync(file, "utf8"));
  const options: YearOptions = {};
  if (since) options.taxSimpleSince = since;
  if (ratesFile) options.rates = parseRateFile(readFileSync(ratesFile, "latin1"));
  console.log(formatReport(computeYear(data, year, options)));
} catch (e) {
  console.error(`Auswertung nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
