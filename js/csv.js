// Delimited text (CSV, TSV, semicolons), as pasted or imported.

export function parseDelimitedText(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  if (!source.trim()) return [];

  const delimiter = chooseDelimiter(source);
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && delimiter && character === delimiter) {
      row.push(value.trim());
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      row.push(value.trim());
      if (row.some((cell) => cell)) rows.push(row);
      row = [];
      value = "";
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      value += character;
    }
  }

  row.push(value.trim());
  if (row.some((cell) => cell)) rows.push(row);
  return rows;
}

function chooseDelimiter(text) {
  const counts = new Map([",", ";", "\t"].map((delimiter) => [delimiter, 0]));
  let quoted = false;
  let records = 0;

  for (let index = 0; index < text.length && records < 20; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (counts.has(character)) counts.set(character, counts.get(character) + 1);
      if (character === "\n" || character === "\r") {
        records += 1;
        if (character === "\r" && text[index + 1] === "\n") index += 1;
      }
    }
  }

  const candidates = [...counts].map(([delimiter, count]) => ({ delimiter, count }));
  const winner = candidates.sort((a, b) => b.count - a.count)[0];
  return winner.count ? winner.delimiter : null;
}
