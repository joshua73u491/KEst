import { describe, expect, test } from "vitest";
import { parseXml } from "../src/import/xml.js";

describe("Minimaler XML-Leser für IBKR-Flex-Dateien", () => {
  test("Elemente mit Attributen, verschachtelt und selbstschließend, mit Zeilennummer", () => {
    const root = parseXml('<?xml version="1.0" encoding="UTF-8"?>\n<A x="1">\n  <B y="zwei" />\n  <B y="drei"></B>\n</A>\n');
    expect(root.name).toBe("A");
    expect(root.attrs).toEqual({ x: "1" });
    expect(root.line).toBe(2);
    expect(root.children.map((c) => [c.name, c.attrs.y, c.line])).toEqual([
      ["B", "zwei", 3],
      ["B", "drei", 4],
    ]);
  });

  test("Entitäten in Attributen werden dekodiert, einfache Anführungszeichen sind erlaubt", () => {
    const root = parseXml(`<A d="S&amp;P 500 &quot;Dist&quot; &lt;x&gt; &apos;y&apos;" e='1' />`);
    expect(root.attrs).toEqual({ d: `S&P 500 "Dist" <x> 'y'`, e: "1" });
  });

  test("„>“ innerhalb eines Attributwerts beendet das Tag nicht", () => {
    expect(parseXml('<A d="x > y"><B/></A>').attrs.d).toBe("x > y");
  });

  test("Kommentare und Text zwischen Elementen werden übergangen", () => {
    const root = parseXml("<A><!-- Kommentar <B/> -->Text<B/></A>");
    expect(root.children.map((c) => c.name)).toEqual(["B"]);
  });

  test("UTF-8-BOM am Anfang wird ignoriert", () => {
    expect(parseXml("﻿<A/>").name).toBe("A");
  });

  test("kaputtes XML ergibt eine deutsche Meldung mit Zeile", () => {
    expect(() => parseXml("<A>\n<B>\n</A>")).toThrow(/kein gültiges XML.*Zeile 3/);
    expect(() => parseXml("kein xml")).toThrow(/kein gültiges XML/);
    expect(() => parseXml("<A>")).toThrow(/kein gültiges XML/);
  });
});
