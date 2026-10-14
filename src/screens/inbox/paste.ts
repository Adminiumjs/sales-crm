/**
 * A PASTED LIST THAT BELONGS TO ONE SHOW.
 *
 * Adminium's import wizard brings in what the list holds and nothing else: it
 * has no way to say "and every line is a lead of this show". So the list is
 * given two more columns on its way to the server, in front of its own: where
 * the enquiry came from (a trade show) and which show. The wizard then shows
 * both, already matched, like any other column of the list.
 *
 * The cells go in FRONT of each line, so a line that stops short of the last
 * column still lines up. The mark that parts the cells is found the way the
 * server finds it (its first line that says anything: the commonest of comma,
 * tab and semicolon outside quotes).
 */

const BOM = "﻿";
export type Mark = "," | "\t" | ";";

export function sniffMark(text: string): Mark {
  let counts: Record<Mark, number> = { ",": 0, "\t": 0, ";": 0 };
  let inQuotes = false;
  let blank = true;
  for (const ch of text.startsWith(BOM) ? text.slice(1) : text) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      blank = false;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\n" || ch === "\r") {
      if (!blank) break;
      counts = { ",": 0, "\t": 0, ";": 0 };
      continue;
    }
    if (ch === "," || ch === "\t" || ch === ";") counts[ch] += 1;
    if (ch !== " " && ch !== "\t") blank = false;
  }
  const marks: Mark[] = [",", "\t", ";"];
  const most = Math.max(...marks.map((mark) => counts[mark]));
  const leading = marks.filter((mark) => counts[mark] === most);
  return most === 0 || leading.length !== 1 ? "," : leading[0]!;
}

const cell = (value: string, mark: Mark): string => (/["\n\r]/.test(value) || value.includes(mark) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * Put `values` in front of every line of a list, and `header` in front of its
 * first line when that line holds the columns' names (`null`: every line is
 * data). A line that says nothing is left as it is.
 */
export function stampList(text: string, header: readonly string[] | null, values: readonly string[]): string {
  const bom = text.startsWith(BOM) ? BOM : "";
  const body = bom === "" ? text : text.slice(1);
  const mark = sniffMark(body);
  let out = "";
  let line = "";
  let inQuotes = false;
  let first = true;
  const flush = (ending: string): void => {
    if (line.trim() === "") out += line + ending;
    else {
      out += `${(first && header !== null ? header : values).map((value) => cell(value, mark)).join(mark)}${mark}${line}${ending}`;
      first = false;
    }
    line = "";
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      const pair = ch === "\r" && body[i + 1] === "\n";
      if (pair) i += 1;
      flush(pair ? "\r\n" : ch);
      continue;
    }
    line += ch;
  }
  if (line !== "") flush("");
  return bom + out;
}

export type ListFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A `fetch` for the import wizard that stamps the list on its way up, and passes every other call through untouched. */
export function stampingFetch(stamp: () => { header: readonly string[]; values: readonly string[] } | null, inner: ListFetch = (input, init) => fetch(input, init)): ListFetch {
  return async (input, init) => {
    const marks = stamp();
    if (marks === null || (init?.method ?? "GET") !== "POST" || !input.split("?")[0]!.endsWith("/imports/upload") || init?.body === undefined || init.body === null) return inner(input, init);
    const text = typeof init.body === "string" ? init.body : await new Response(init.body as BodyInit).text();
    return inner(input, { ...init, body: stampList(text, /[?&]header=none(&|$)/.test(input) ? null : marks.header, marks.values) });
  };
}
