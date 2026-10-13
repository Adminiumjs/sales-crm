/**
 * The customer's quote, read and answered through the quote's own link.
 *
 * Nobody signs in here. The link's code opens one quote on the `quote` key
 * (the manifest's `publicAccess`): the quote's own figures and its lines,
 * and nothing of the business's side of it (no list price, no approval, no
 * deal, no person). The server decides everything: which quote the code
 * opens, whether it may still be answered, and what the page may read.
 *
 * What a link can come to:
 *  - `open`      the quote, with its lines;
 *  - `gone`      the code is a quote's, and that quote is not on offer: it was
 *                replaced by a newer version, or it was never sent. The page
 *                is told nothing of it, and nothing of the newer one;
 *  - `unknown`   the code opens nothing;
 *  - `closed`    the link was stopped;
 *  - `off`       this business does not share quotes by link (the part is off);
 *  - `unreachable` no answer.
 *
 * "Today" is the server's, never the browser's: a customer's clock may be a
 * day or a year off, and the page must not say "ran out" on its word.
 */
import { formatters, type Formatters } from "../lib/format.ts";

export interface CustomerQuote {
  id: number;
  number: string;
  version: number;
  status: "sent" | "accepted" | "declined";
  /** `2026-08-27`, or null when the quote names no last day. */
  validUntil: string | null;
  currency: string | null;
  taxName: string | null;
  taxRate: number;
  subtotal: number;
  tax: number;
  total: number;
  notes: string;
  sentAt: Date | null;
  decidedAt: Date | null;
  acceptedName: string | null;
}

export interface CustomerLine {
  id: number;
  position: number;
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

export type Opened =
  | { state: "open"; quote: CustomerQuote; lines: CustomerLine[]; timeZone: string | null; /** Today where the business is, by the SERVER'S clock: `2026-07-28`. */ today: string }
  | { state: "gone" | "unknown" | "closed" | "off" | "unreachable" };

/** What an answer came to. `late`: its last day has passed; `changed`: it was answered or replaced meanwhile. */
export type Answered = { ok: true; quote: CustomerQuote } | { ok: false; why: "late" | "changed" | "name" | "unreachable" };

type Row = Record<string, unknown>;

/** The few calls of `@adminiumjs/public-client` this page makes: narrow, so a test can stand in. */
export interface QuoteDoor {
  openShared: (token: string) => Promise<"opened" | "unknown" | "closed">;
  config: () => Promise<{ timezone?: string; refs: Record<string, unknown> }>;
  list: (ref: string, options?: { limit?: number }) => Promise<{ data: Row[] }>;
  update: (ref: string, id: string, values: Row) => Promise<Row>;
}

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const moment = (value: unknown): Date | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
};

export function quoteOf(row: Row): CustomerQuote | null {
  const status = row["status"];
  if (status !== "sent" && status !== "accepted" && status !== "declined") return null;
  return {
    id: num(row["id"]),
    number: text(row["number"]) ?? "",
    version: num(row["version"]) || 1,
    status,
    validUntil: text(row["valid_until"])?.slice(0, 10) ?? null,
    currency: text(row["currency"]),
    taxName: text(row["tax_name"]),
    taxRate: num(row["tax_rate"]),
    subtotal: num(row["subtotal"]),
    tax: num(row["tax"]),
    total: num(row["total"]),
    notes: text(row["notes"]) ?? "",
    sentAt: moment(row["sent_at"]),
    decidedAt: moment(row["decided_at"]),
    acceptedName: text(row["accepted_name"]),
  };
}

export function lineOf(row: Row): CustomerLine {
  return {
    id: num(row["id"]),
    position: num(row["position"]),
    description: text(row["description"]) ?? "",
    qty: num(row["qty"]),
    rate: num(row["rate"]),
    amount: num(row["amount"]),
  };
}

/** The server's code on a refusal, however the client throws it. */
const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
};
const statusOf = (error: unknown): number => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 0;
};

/** The name a ref goes by on this install: the table's real name, or that name with a suffix. */
function refOf(refs: Record<string, unknown>, real: string): string {
  return Object.keys(refs).find((ref) => ref === real || ref.startsWith(`${real}_`)) ?? real;
}

export interface QuoteLink {
  open: () => Promise<Opened>;
  /** Accept (with the name typed) or decline. Reads the quote back before it says anything. */
  answer: (quote: CustomerQuote, to: "accepted" | "declined", name?: string) => Promise<Answered>;
}

/**
 * `tables` are the app's tables' real names (`quotes` → `crm_quotes`), from
 * the side's config. `door` is null when the install serves no `quote` key.
 */
export function quoteLink(door: QuoteDoor | null, token: string, tables: Record<string, string>, now: () => Date = () => new Date()): QuoteLink {
  let refs: { quotes: string; lines: string } | null = null;
  let timeZone: string | null = null;

  async function read(): Promise<Opened> {
    if (door === null) return { state: "off" };
    if (refs === null) {
      const config = await door.config();
      timeZone = typeof config.timezone === "string" && config.timezone !== "" ? config.timezone : null;
      refs = { quotes: refOf(config.refs, tables["quotes"] ?? "quotes"), lines: refOf(config.refs, tables["quote_lines"] ?? "quote_lines") };
    }
    const quote = (await door.list(refs.quotes, { limit: 2 })).data.map(quoteOf).find((one) => one !== null) ?? null;
    if (quote === null) return { state: "gone" };
    const lines = (await door.list(refs.lines, { limit: 200 })).data.map(lineOf).sort((a, b) => a.position - b.position || a.id - b.id);
    return { state: "open", quote, lines, timeZone, today: today(timeZone, now()) };
  }

  const refusal = (error: unknown): Opened => {
    const code = codeOf(error);
    if (code === "LINK_EXPIRED") return { state: "closed" };
    if (code === "PUBLIC_REF_NOT_FOUND" || code === "PUBLIC_KEY_INVALID" || code === "PUBLIC_SWITCHED_OFF" || code === "APP_DISABLED" || code === "SURFACE_OFF" || code === "PUBLIC_KEY_OFF" || code === "PUBLIC_API_DISABLED") return { state: "off" };
    return { state: "unreachable" };
  };

  return {
    async open() {
      if (door === null) return { state: "off" };
      if (token === "") return { state: "unknown" };
      try {
        const opened = await door.openShared(token);
        if (opened !== "opened") return { state: opened };
        return await read();
      } catch (error) {
        return refusal(error);
      }
    },

    async answer(quote, to, name) {
      if (door === null || refs === null) return { ok: false, why: "unreachable" };
      const typed = (name ?? "").trim();
      if (to === "accepted" && typed === "") return { ok: false, why: "name" };
      let refused: unknown = null;
      try {
        await door.update(refs.quotes, String(quote.id), to === "accepted" ? { status: "accepted", accepted_name: typed } : { status: "declined" });
      } catch (error) {
        refused = error;
      }
      // Whatever the reply was (or was not): what the server holds now is the answer.
      let now: Opened;
      try {
        now = await read();
      } catch (error) {
        now = refusal(error);
      }
      if (now.state === "open" && now.quote.status === to && (to === "declined" || refused === null || now.quote.acceptedName === typed)) return { ok: true, quote: now.quote };
      if (now.state === "unreachable") return { ok: false, why: "unreachable" };
      if (now.state === "open" && now.quote.status === "sent") return { ok: false, why: ranOut(now.quote, now.today) || codeOf(refused) === "PUBLIC_TOO_LATE" ? "late" : statusOf(refused) >= 400 && statusOf(refused) < 500 && to === "accepted" ? "name" : "unreachable" };
      return { ok: false, why: "changed" };
    },
  };
}

/** Today where the business is, as `2026-07-28`. */
export function today(timeZone: string | null, at: Date = new Date()): string {
  return formatters({ locale: "en-US", currency: null, timeZone }).dayKey(at);
}

/** A sent quote whose last day has passed. The server is who refuses the answer; this only words the page. */
export const ranOut = (quote: CustomerQuote, day: string): boolean => quote.status === "sent" && quote.validUntil !== null && quote.validUntil < day;

/** The page's formatters: the reader's language, the quote's own currency, the business's days. */
export function quoteFormatters(locale: string, quote: CustomerQuote, timeZone: string | null): Formatters {
  return formatters({ locale, currency: quote.currency, timeZone });
}
