/** Minimaler CSV-Leser nach RFC 4180: Komma als Trenner, Felder in Anführungszeichen, "" als Escape. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseRows(text);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((cells, i) => {
    if (cells.length !== header.length) {
      throw new Error(`CSV Zeile ${i + 2}: ${cells.length} statt ${header.length} Spalten`);
    }
    return Object.fromEntries(header.map((name, j) => [name, cells[j] ?? ""]));
  });
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") endField();
    else if (ch === "\n") endRow();
    else if (ch !== "\r") field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
