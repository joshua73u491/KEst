import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";

const sample = readFileSync(new URL("./fixtures/tr-beispiel.csv", import.meta.url), "utf8");

describe("Trade-Republic-Transaktionsexport (CSV seit April 2026)", () => {
  const result = parseTradeRepublicCsv(sample);

  test("Trades werden zeitlich sortiert, auch wenn die Datei sie durcheinander liefert", () => {
    const beispiel = result.trades.filter((t) => t.isin === "US0000000001").map((t) => t.side);
    expect(beispiel).toEqual(["buy", "sell"]);
  });

  test("Kauf: Stückzahl und Kurswert positiv, Spesen nicht im Kurswert", () => {
    const buy = result.trades.find((t) => t.isin === "US0000000001" && t.side === "buy");
    expect(buy).toMatchObject({ depot: "TR", date: "2026-05-02", quantity: "2", amountEur: "200", kind: "security" });
    expect(buy?.feeEur).toBe("1");
  });

  test("Verkauf: negative Stückzahl in der Datei wird zur positiven Verkaufsmenge", () => {
    const sell = result.trades.find((t) => t.isin === "US0000000001" && t.side === "sell");
    expect(sell).toMatchObject({ quantity: "2", amountEur: "180" });
  });

  test("Anlageklassen werden Steuertöpfen zugeordnet", () => {
    const kindOf = (isin: string) => result.trades.find((t) => t.isin === isin)?.kind;
    expect(kindOf("US0000000001")).toBe("security");
    expect(kindOf("DE000XX00001")).toBe("securitizedDerivative");
    expect(kindOf("BTC")).toBe("crypto");
  });

  test("Krypto-Auslieferung an ein externes Wallet ist ein Übertrag, kein Verkauf", () => {
    expect(result.transfersOut).toEqual([
      { isin: "BTC", depot: "TR", date: "2026-04-02", datetime: "2026-04-02T10:00:00.000Z", quantity: "0.0015", kind: "crypto" },
    ]);
  });

  test("Zinsen auf dem Verrechnungskonto werden erfasst", () => {
    expect(result.interest).toEqual([{ date: "2026-08-01", amountEur: "2" }]);
  });

  test("Kartenzahlungen und Einzahlungen werden ignoriert, Unbekanntes wird gemeldet", () => {
    expect(result.unsupported).toEqual([{ line: 16, type: "CASH/SOMETHING_NEW", reason: "Unbekannter Buchungstyp" }]);
  });

  test("Trade in Fremdwährung wird gemeldet statt geschätzt", () => {
    const usd = sample.split("\n").slice(0, 2).join("\n").replace('"-50.00","-1.00","","EUR"', '"-50.00","-1.00","","USD"');
    const r = parseTradeRepublicCsv(usd);
    expect(r.trades).toEqual([]);
    expect(r.unsupported[0]?.reason).toMatch(/Währung USD/);
  });
});
