import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { trade, trCsv } from "./helpers/trCsv.js";

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
      { isin: "BTC", depot: "TR", date: "2026-04-02", datetime: "2026-04-02T10:00:00.000Z", quantity: "0.0015", kind: "crypto", line: 8 },
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

describe("Trade-Republic-Import: Randfälle", () => {
  const at = "2026-03-02T10:00:00.000Z";

  test("Datei mit UTF-8-BOM wird genauso gelesen wie ohne", () => {
    const mitBom = parseTradeRepublicCsv("\uFEFF" + sample);
    expect(mitBom).toEqual(parseTradeRepublicCsv(sample));
    expect(mitBom.trades.length).toBeGreaterThan(0);
  });

  test("leere Datei ergibt eine verständliche Fehlermeldung", () => {
    expect(() => parseTradeRepublicCsv("")).toThrow(/Die Datei ist leer/);
    expect(() => parseTradeRepublicCsv("\uFEFF\r\n")).toThrow(/Die Datei ist leer/);
  });

  test("Datei nur mit Kopfzeile: keine Buchungen statt einer Rücklage von 0 €", () => {
    expect(() => parseTradeRepublicCsv(trCsv())).toThrow(/keine Buchungen/);
  });

  test("falsche Datei (andere Spalten) wird mit deutscher Meldung abgelehnt", () => {
    const kontoauszug = '"Buchungsdatum","Empfänger","Betrag"\n"01.02.2026","Beispiel GmbH","-12,34"\n';
    expect(() => parseTradeRepublicCsv(kontoauszug)).toThrow(/kein Trade-Republic-Transaktionsexport/);
    expect(() => parseTradeRepublicCsv(kontoauszug)).toThrow(/category/);
  });

  test("mit Excel umgespeicherte Datei (Semikolon) bekommt einen Hinweis", () => {
    const excel = sample.replace(/","/g, '";"');
    expect(() => parseTradeRepublicCsv(excel)).toThrow(/Semikolon/);
  });

  test("Trades und Überträge kennen ihre Zeile in der Datei", () => {
    const r = parseTradeRepublicCsv(sample);
    expect(r.trades.find((t) => t.isin === "US0000000003" && t.side === "buy")?.line).toBe(2);
    expect(r.trades.find((t) => t.isin === "US0000000001" && t.side === "sell")?.line).toBe(9);
  });

  test("ungültige Zahl wird als nicht berechnet gemeldet statt abzustürzen", () => {
    const r = parseTradeRepublicCsv(trCsv(trade("BUY", at, "US0000000009", "abc", "10.00")));
    expect(r.trades).toEqual([]);
    expect(r.unsupported).toEqual([
      {
        line: 2,
        type: "TRADING/BUY",
        reason: 'Ungültige Zahl in Spalte shares: „abc“',
        // übersprungener Kauf: spätere Verkäufe dieser ISIN dürfen nicht still gerechnet werden
        affects: { isin: "US0000000009", depot: "TR", datetime: at },
      },
    ]);
  });

  test("leere Zahl bei Zinsen wird gemeldet statt abzustürzen", () => {
    const zins = { datetime: at, date: "2026-03-02", category: "CASH", type: "INTEREST_PAYMENT", amount: "", currency: "EUR" };
    const r = parseTradeRepublicCsv(trCsv(zins));
    expect(r.interest).toEqual([]);
    expect(r.unsupported[0]?.reason).toMatch(/Ungültige Zahl in Spalte amount/);
  });

  test("Stückzahl 0 wird gemeldet statt die ganze Auswertung abzubrechen", () => {
    const r = parseTradeRepublicCsv(trCsv(trade("SELL", at, "BTC", "0.0000000000", "0.00", { asset_class: "CRYPTO" })));
    expect(r.trades).toEqual([]);
    expect(r.unsupported[0]?.reason).toMatch(/Stückzahl 0/);
  });

  test("fehlendes oder kaputtes Datum wird gemeldet", () => {
    const r = parseTradeRepublicCsv(trCsv(trade("BUY", at, "US0000000009", "1", "10.00", { date: "" })));
    expect(r.trades).toEqual([]);
    expect(r.unsupported[0]?.reason).toMatch(/Datum/);
  });

  test("sehr kleine Krypto-Bruchteile bleiben exakt", () => {
    const r = parseTradeRepublicCsv(
      trCsv(trade("BUY", at, "BTC", "0.0000000001", "0.01", { asset_class: "CRYPTO" })),
    );
    expect(r.trades[0]).toMatchObject({ quantity: "1e-10", amountEur: "0.01", kind: "crypto" });
  });

  test("Betrag in der Spalte tax wird nicht still übergangen", () => {
    const r = parseTradeRepublicCsv(trCsv(trade("SELL", at, "US0000000009", "1", "10.00", { tax: "-2.75" })));
    expect(r.trades).toHaveLength(1);
    expect(r.unsupported).toEqual([
      { line: 2, type: "TRADING/SELL", reason: "Steuerbetrag -2.75 in Spalte tax wird noch nicht angerechnet" },
    ]);
  });

  test("Umrechnung durch Trade Republic statt EZB-Referenzkurs wird gemeldet", () => {
    const r = parseTradeRepublicCsv(
      trCsv(trade("BUY", at, "US0000000009", "1", "10.00", { original_amount: "-11.00", original_currency: "USD" })),
    );
    expect(r.trades).toEqual([]);
    expect(r.unsupported[0]?.reason).toMatch(/Originalwährung USD/);
  });

  test("Fonds und ETFs: Hinweis auf fehlende ausschüttungsgleiche Erträge, einmal je ISIN", () => {
    const r = parseTradeRepublicCsv(
      trCsv(
        trade("BUY", "2026-01-02T10:00:00.000Z", "IE0000000001", "1", "100.00", { asset_class: "FUND" }),
        trade("BUY", "2026-02-02T10:00:00.000Z", "IE0000000001", "1", "100.00", { asset_class: "FUND" }),
        trade("BUY", "2026-02-02T10:00:00.000Z", "IE0000000002", "1", "100.00", { asset_class: "ETF" }),
      ),
    );
    expect(r.trades).toHaveLength(3);
    expect(r.unsupported.map((u) => [u.line, u.reason])).toEqual([
      [2, "Fonds/ETF IE0000000001: ausschüttungsgleiche Erträge (KZ 937) und Meldefonds-Status werden noch nicht berechnet"],
      [4, "Fonds/ETF IE0000000002: ausschüttungsgleiche Erträge (KZ 937) und Meldefonds-Status werden noch nicht berechnet"],
    ]);
  });
});
