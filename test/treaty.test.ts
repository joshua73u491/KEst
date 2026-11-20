import { describe, expect, test } from "vitest";
import { countryOfIsin, dividendTreatyRate } from "../src/treaty.js";

describe("Land einer ISIN", () => {
  test("die ersten zwei Buchstaben einer gültigen ISIN sind das Land", () => {
    expect(countryOfIsin("US0000000001")).toBe("US");
    expect(countryOfIsin("DE000XX00001")).toBe("DE");
  });

  test("keine ISIN (Krypto-Kürzel, leer, falsches Format) ergibt kein Land", () => {
    expect(countryOfIsin("BTC")).toBeNull();
    expect(countryOfIsin("")).toBeNull();
    expect(countryOfIsin("us0000000001")).toBeNull();
    expect(countryOfIsin("US00000000011")).toBeNull();
  });
});

describe("Quellensteuer-Höchstsatz auf Dividenden laut DBA (Streubesitz, natürliche Person)", () => {
  test("USA 15 % (DBA Art. 10 Abs. 2 lit. b, BGBl. III Nr. 6/1998)", () => {
    expect(dividendTreatyRate("US")?.rate.toString()).toBe("0.15");
    expect(dividendTreatyRate("US")?.source).toMatch(/Gesetzesnummer=10005110/);
  });

  test("Deutschland 15 % (DBA Art. 10 Abs. 2 lit. b, BGBl. III Nr. 182/2002)", () => {
    expect(dividendTreatyRate("DE")?.rate.toString()).toBe("0.15");
  });

  test("Finnland und Schweden 10 %", () => {
    expect(dividendTreatyRate("FI")?.rate.toString()).toBe("0.1");
    expect(dividendTreatyRate("SE")?.rate.toString()).toBe("0.1");
  });

  test("jeder hinterlegte Satz verweist auf den DBA-Text im RIS", () => {
    for (const country of ["US", "DE", "FR", "NL", "CH", "IT", "LU", "ES", "BE", "FI", "SE", "DK", "NO", "CA"]) {
      expect(dividendTreatyRate(country)?.source, country).toMatch(/^https:\/\/www\.ris\.bka\.gv\.at\//);
    }
  });

  test("nicht geprüfte Länder sind nicht hinterlegt statt geschätzt", () => {
    expect(dividendTreatyRate("IE")).toBeUndefined(); // Sonderregel in Art. 8 DBA Irland
    expect(dividendTreatyRate("JP")).toBeUndefined();
    expect(dividendTreatyRate("GB")).toBeUndefined();
    expect(dividendTreatyRate("AT")).toBeUndefined();
  });
});
