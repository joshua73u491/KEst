import { readFileSync } from "node:fs";
import { formatReport } from "../format.js";
import { parseTradeRepublicCsv } from "../import/tradeRepublic.js";
import { computeYear } from "../yearReport.js";

const [file, yearArg] = process.argv.slice(2);
if (!file) {
  console.error("Aufruf: npm run report -- <Trade-Republic-CSV> [Jahr]");
  process.exit(1);
}
const year = Number(yearArg ?? new Date().getFullYear());
try {
  console.log(formatReport(computeYear(parseTradeRepublicCsv(readFileSync(file, "utf8")), year)));
} catch (e) {
  console.error(`Auswertung nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
