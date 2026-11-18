import { describe, expect, test } from "vitest";
import { parseCsv } from "../src/import/csv.js";

describe("parseCsv", () => {
  test("liest Kopfzeile und Zeilen als Objekte", () => {
    expect(parseCsv('"a","b"\n"1","2"\n')).toEqual([{ a: "1", b: "2" }]);
  });

  test("Kommas und doppelte Anführungszeichen innerhalb von Feldern", () => {
    expect(parseCsv('"a","b"\n"x, y","sagt ""hallo"""\n')).toEqual([{ a: "x, y", b: 'sagt "hallo"' }]);
  });

  test("leere Felder, Windows-Zeilenenden und fehlender Zeilenumbruch am Ende", () => {
    expect(parseCsv('"a","b"\r\n"","2"\r\n"3",""')).toEqual([
      { a: "", b: "2" },
      { a: "3", b: "" },
    ]);
  });

  test("Zeile mit falscher Spaltenzahl wird abgelehnt", () => {
    expect(() => parseCsv('"a","b"\n"1"\n')).toThrow(/Zeile 2/);
  });

  test("UTF-8-BOM am Dateianfang gehört nicht zum ersten Spaltennamen", () => {
    expect(parseCsv('\uFEFF"a","b"\n"1","2"\n')).toEqual([{ a: "1", b: "2" }]);
  });
});
