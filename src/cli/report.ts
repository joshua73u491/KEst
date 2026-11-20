import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatReport } from "../format.js";
import { parseTradeRepublicCsv } from "../import/tradeRepublic.js";
import { computeYear } from "../yearReport.js";

const USAGE = "Aufruf: npm run report -- <Trade-Republic-CSV> [Jahr] [--steuereinfach-seit JJJJ-MM-TT]";

let file: string | undefined;
let yearArg: string | undefined;
let since: string | undefined;
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { "steuereinfach-seit": { type: "string" } },
  });
  [file, yearArg] = positionals;
  since = values["steuereinfach-seit"];
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
  console.log(formatReport(computeYear(data, year, since ? { taxSimpleSince: since } : {})));
} catch (e) {
  console.error(`Auswertung nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
