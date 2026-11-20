/**
 * Minimaler XML-Leser für IBKR-Flex-Dateien: Elemente, Attribute, Verschachtelung und Zeilennummern.
 * Text, Kommentare, Verarbeitungsanweisungen und CDATA werden übergangen. Läuft ohne Abhängigkeiten in Node und im Browser.
 */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Zeile des öffnenden Tags (erste Zeile = 1) */
  line: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e.startsWith("#x") ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith("#") ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e] ?? ""),
  );
}

const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(text: string): XmlElement {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const fail = (msg: string, pos: number): never => {
    const line = src.slice(0, pos).split("\n").length;
    throw new Error(`Die Datei ist kein gültiges XML (${msg}, Zeile ${line}).`);
  };
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let line = 1;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;
    for (let k = i; k < lt; k++) if (src.charCodeAt(k) === 10) line++;
    i = lt;
    const skipTo = (end: string) => {
      const j = src.indexOf(end, i);
      if (j === -1) fail(`„${end}“ fehlt`, i);
      for (let k = i; k < j; k++) if (src.charCodeAt(k) === 10) line++;
      i = j + end.length;
    };
    if (src.startsWith("<!--", i)) {
      skipTo("-->");
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      skipTo("]]>");
      continue;
    }
    if (src.startsWith("<?", i) || src.startsWith("<!", i)) {
      skipTo(">");
      continue;
    }
    // Ende des Tags suchen; ein „>“ innerhalb eines Attributwerts in Anführungszeichen ist erlaubt.
    let gt = -1;
    let quote = "";
    for (let k = i + 1; k < src.length; k++) {
      const ch = src[k];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") {
        gt = k;
        break;
      }
    }
    if (gt === -1) fail("Tag nicht geschlossen", i);
    const tag = src.slice(i + 1, gt);
    const tagLine = line;
    for (let k = i; k < gt; k++) if (src.charCodeAt(k) === 10) line++;
    const pos = i;
    i = gt + 1;
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      if (!open || open.name !== name) fail(`schließendes Tag </${name}> passt nicht`, pos);
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const m = /^([A-Za-z_][\w.:-]*)/.exec(body);
    if (!m) fail("ungültiger Elementname", pos);
    const name = m![1]!;
    const attrs: Record<string, string> = {};
    for (const a of body.slice(name.length).matchAll(ATTR)) attrs[a[1]!] = decode(a[2] ?? a[3] ?? "");
    const element: XmlElement = { name, attrs, children: [], line: tagLine };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else if (root) fail("mehr als ein Wurzelelement", pos);
    else root = element;
    if (!selfClosing) stack.push(element);
  }
  if (!root) fail("kein Element gefunden", 0);
  if (stack.length > 0) fail(`<${stack[stack.length - 1]!.name}> wird nicht geschlossen`, src.length);
  return root!;
}

/** Alle direkten Kinder mit diesem Namen. */
export const childrenNamed = (el: XmlElement, name: string) => el.children.filter((c) => c.name === name);
