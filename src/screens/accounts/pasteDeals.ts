/**
 * PAST DEALS ON PASTE A LIST (plan 68 R5): what the page does to the
 * import's calls on their way.
 *
 * WHOSE THE DEALS ARE. A deal names its owner, a person; a list of past deals
 * from another system names nobody this install knows. So the page asks once
 * ("whose deals these are") and gives every line an "Owner" cell in front,
 * the way the trade show's list is given its show (`inbox/paste.ts`).
 *
 * WHAT A REFUSED LINE SAYS. A won or lost deal without its closed moment is
 * refused by the server (`deals.closed_at` is required while the deal is
 * closed, and no stamp fills it for a file: E13), and its line reads the
 * server's own words, "closed_at: required". The page says it in the reader's
 * language instead: the preview's answer is reworded on its way to the
 * wizard, and nothing else in it is touched.
 */
import { stampingFetch, type ListFetch } from "../inbox/paste.ts";

export interface PreviewLine {
  row: number;
  status: string;
  code?: string;
  column?: string;
  message?: string;
  [more: string]: unknown;
}

/** A line the server refused for want of its closed moment. */
export const needsClosedDate = (line: PreviewLine): boolean => line.status === "refused" && line.column === "closed_at" && /required/i.test(line.message ?? line.code ?? "");

/** The preview's lines with a missing closed date said in `words`; the same array when there is none. */
export function reword(lines: readonly PreviewLine[], words: string): PreviewLine[] {
  if (!lines.some(needsClosedDate)) return lines as PreviewLine[];
  return lines.map((line) => {
    if (!needsClosedDate(line)) return line;
    // Without its column the wizard prints the message alone, not "closed_at: …".
    const { column: _column, ...rest } = line;
    return { ...rest, message: words };
  });
}

/** Whether a call is one that answers preview lines: the preview, and its next page. */
const answersLines = (input: string): boolean => /\/api\/v1\/imports\/[^/?]+\/(preview|lines)(\?|$)/.test(input);

/** The answer's headers, less those that described the bytes as they came (they are written again). */
function headersOf(res: Response): Headers {
  const out = new Headers(res.headers);
  out.delete("content-length");
  out.delete("content-encoding");
  return out;
}

/** A `fetch` that rewords the preview's lines and passes every other answer through untouched. */
export function rewordingFetch(words: () => string, inner: ListFetch): ListFetch {
  return async (input, init) => {
    const res = await inner(input, init);
    if (!answersLines(input) || !res.ok) return res;
    const text = await res.text();
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return new Response(text, { status: res.status, statusText: res.statusText, headers: headersOf(res) });
    }
    const data = (doc as { data?: { lines?: unknown } } | null)?.data;
    if (data !== undefined && data !== null && Array.isArray(data.lines)) data.lines = reword(data.lines as PreviewLine[], words());
    return new Response(JSON.stringify(doc), { status: res.status, statusText: res.statusText, headers: headersOf(res) });
  };
}

/** The import's fetch for past deals: every line given its owner, and a missing closed date said in the reader's words. */
export function dealsFetch(owner: () => { header: string; id: string } | null, words: () => string, inner: ListFetch = (input, init) => fetch(input, init)): ListFetch {
  return rewordingFetch(
    words,
    stampingFetch(() => {
      const who = owner();
      return who === null ? null : { header: [who.header], values: [who.id] };
    }, inner),
  );
}

/** The columns of a deal a list may bring, in the order the page offers them. */
export const DEAL_COLUMNS = ["name", "company_id", "stage_id", "state", "lost_reason_id", "opened_on", "closed_at", "typed_amount", "close_note"] as const;
