import { describe, expect, test } from "vitest";
import { dec } from "../src/decimal.js";
import { formatEur, formatReport } from "../src/format.js";
import { parseIbkrFlexXml } from "../src/import/ibkrFlex.js";
import { parseTradeRepublicCsv } from "../src/import/tradeRepublic.js";
import { addEntry, emptyLedger, reserveStatus } from "../src/ledger.js";
import { computeYear } from "../src/yearReport.js";
import { ibCash, ibkrXml, ibOption, ibOptionBook } from "./helpers/ibkrXml.js";
import { trade, trCsv } from "./helpers/trCsv.js";

/**
 * Anzeigefehler, gefunden beim Test mit erfundenen Exporten aller Broker (22.11.2026).
 * Die Steuer selbst war jeweils richtig; falsch war, was die App dazu anzeigt.
 */

describe("Offene Positionen gelten am Ende des gewählten Jahres", () => {
  // 2025: 20 Stück gekauft (1.000 € + 1.400 €). 2026: 5 verkauft, 1 Stück Bitcoin-Anteil gekauft.
  const data = parseTradeRepublicCsv(
    trCsv(
      trade("BUY", "2025-03-10T10:00:00.000Z", "US0000000101", "10", "1000.00"),
      trade("BUY", "2025-06-10T10:00:00.000Z", "US0000000101", "10", "1400.00"),
      trade("SELL", "2026-02-10T10:00:00.000Z", "US0000000101", "5", "750.00"),
      trade("BUY", "2026-03-01T10:00:00.000Z", "DE0000000202", "4", "400.00"),
    ),
  );

  test("Bericht 2025 zeigt den Bestand am 31.12.2025, nicht den späteren", () => {
    const open = computeYear(data, 2025).openPositions;
    expect(open.map((p) => [p.isin, p.quantity.toString(), p.costEur.toString()])).toEqual([["US0000000101", "20", "2400"]]);
  });

  test("Bericht 2026 zeigt den Bestand am Ende der Daten", () => {
    const open = computeYear(data, 2026).openPositions;
    expect(open.map((p) => [p.isin, p.quantity.toString(), p.costEur.toString()])).toEqual([
      ["US0000000101", "15", "1800"],
      ["DE0000000202", "4", "400"],
    ]);
  });

  test("offene Optionen ebenfalls zum Jahresende: Short Put 2025 eröffnet, 2026 verfallen", () => {
    const opt = parseIbkrFlexXml(
      ibkrXml({ trades: [ibOption("SELL", "20251110", "ERF P50", "1", "200", { expiry: "20260116" }), ibOptionBook("BUY", "20260116", "ERF P50", "1", { expiry: "20260116", notes: "Ep" })] }),
    );
    expect(computeYear(opt, 2025).openDerivatives.map((d) => d.quantity.toString())).toEqual(["-1"]);
    expect(computeYear(opt, 2026).openDerivatives).toEqual([]);
  });
});

describe("Beschriftung der Broker-Zinsen", () => {
  test("Zinsen eines Broker-Kontos heißen nicht „IBKR-Zinsen“, weil auch SnapTrade-Konten dazugehören", () => {
    const r = computeYear(parseIbkrFlexXml(ibkrXml({ cash: [ibCash("Broker Interest Received", "20260301;120000", "5", { currency: "EUR" })] })), 2026);
    const text = formatReport(r);
    expect(text).not.toContain("IBKR-Zinsen");
    expect(text).toContain("Broker-Zinsen, Einstellung KZ 863");
  });
});

describe("Stückzahlen ohne Exponentenschreibweise", () => {
  test("ein Rest von 0,0000000001 Stück erscheint nicht als 1e-10", () => {
    expect(dec("0.0000000001").toString()).toBe("0.0000000001");
    expect(dec("2.9999999999").minus("3").toString()).toBe("-0.0000000001");
  });
});

describe("Soll und Ist: angezeigte Beträge gehen auf den Cent auf", () => {
  test("Überschuss = freigegeben + gesperrt, auch nach dem Runden", () => {
    // Soll 285,2551 €, Höchststand 295,8349 €, Ist 300 €. Ungerundet: Überschuss 14,7449, frei 4,1651, gesperrt 10,5798.
    // Einzeln gerundet: 14,74 € ≠ 4,17 € + 10,58 €. Mit Soll und Höchststand auf Cent (285,26 € / 295,83 €):
    // 14,74 € = 4,17 € + 10,57 €.
    const years = [{ year: 2026, sollEur: dec("285.2551"), peakEur: dec("295.8349"), complete: true }];
    const ledger = addEntry(emptyLedger(), { id: "e1", date: "2026-11-22", valueEur: "300", place: "Tagesgeld", note: "" });
    const s = reserveStatus(years, ledger, "2026-11-22");
    const shown = (v: ReturnType<typeof dec>) => formatEur(v);
    expect([shown(s.sollEur), shown(s.surplusEur), shown(s.releasableEur), shown(s.lockedEur)]).toEqual(["285,26 €", "14,74 €", "4,17 €", "10,57 €"]);
    expect(s.surplusEur.eq(s.releasableEur.plus(s.lockedEur))).toBe(true);
  });

  test("Soll mehrerer Jahre = Summe der angezeigten Jahreswerte", () => {
    const years = [
      { year: 2025, sollEur: dec("10.004"), peakEur: dec("10.004"), complete: true },
      { year: 2026, sollEur: dec("10.004"), peakEur: dec("10.004"), complete: true },
    ];
    const s = reserveStatus(years, emptyLedger(), "2026-11-22");
    expect(formatEur(s.sollEur)).toBe("20,00 €");
  });
});
