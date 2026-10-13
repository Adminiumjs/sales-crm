/**
 * QUOTES, as the screens read them.
 *
 * A quote is a FAMILY of versions on one deal. Each version is a document of
 * its own with its own number (Q-1009); the family goes by its first
 * version's number (Q-1002). A new version names the one it replaces, and
 * sending it withdraws that one in the same save, so the customer holds one
 * quote at a time.
 *
 * Every figure here is the server's: a line's amount, a version's subtotal,
 * tax and total, its list value, how far under list it is, whether it needs
 * approval and whether it may be sent. A screen shows them and adds nothing.
 */
import { newClientKey, type Condition, type Saved, type StaffSession } from "../../staffSession.ts";

export interface Quote extends Record<string, unknown> {
  id: number;
  number: string | null;
  family_no: string | null;
  version: number;
  status: "draft" | "sent" | "accepted" | "declined" | "withdrawn";
  approval: "none" | "asked" | "approved" | "refused";
  deal_id: number;
  replaces_id: number | null;
  valid_until: string | null;
  sent_at: string | null;
  decided_at: string | null;
  subtotal: number | string | null;
  tax: number | string | null;
  tax_name: string | null;
  tax_rate: number | string | null;
  total: number | string | null;
  list_value: number | string | null;
  under_list_pct: number | string | null;
  unlisted_lines: number | string | null;
  threshold_pct: number | string | null;
  needs_approval: number | string | null;
  may_send: number | string | null;
  approved_pct: number | string | null;
  asked_by_id: string | null;
  asked_at: string | null;
  ask_reason: string | null;
  decided_by_id: string | null;
  approval_decided_at: string | null;
  decision_note: string | null;
  sent_to_contact_id: number | null;
  to_name: string | null;
  sent_to_name: string | null;
  /** The address the quote (and its link) went to, stamped at sending. Only on a quote read by itself, and only for a role that is shown it: no list asks for it. */
  sent_to_email?: string | null;
  accepted_name: string | null;
  accepted_via: string | null;
  notes: string | null;
  /** Read through the deal. */
  deal: string | null;
  company: string | null;
  owner_id: string | null;
  deal_state: string | null;
  deal_stage: string | null;
  deal_close: string | null;
}

export interface Line extends Record<string, unknown> {
  id: number;
  document_id: number;
  position: number;
  description: string | null;
  qty: number | string;
  rate: number | string | null;
  amount: number | string | null;
  price_id: number | null;
  list_rate: number | string | null;
  list_amount: number | string | null;
}

export const QUOTE_COLUMNS = [
  "id", "number", "family_no", "version", "status", "approval", "deal_id", "replaces_id", "valid_until", "sent_at", "decided_at", "subtotal", "tax", "tax_name", "tax_rate", "total",
  "list_value", "under_list_pct", "unlisted_lines", "threshold_pct", "needs_approval", "may_send", "approved_pct", "asked_by_id", "asked_at", "ask_reason", "decided_by_id",
  "approval_decided_at", "decision_note", "sent_to_contact_id", "to_name", "sent_to_name", "accepted_name", "accepted_via", "notes",
];
export const QUOTE_LOOKUPS = ["deal:deal_id.name", "company:deal_id.company_id.name", "owner_id:deal_id.owner_id", "deal_state:deal_id.state", "deal_stage:deal_id.stage_id.label", "deal_close:deal_id.expected_close"];
export const LINE_COLUMNS = ["id", "document_id", "position", "description", "qty", "rate", "amount", "price_id", "list_rate", "list_amount"];

/** What a version is, in the one word a person reads. Worked out from what the server holds and the server's day. */
export type QuoteState = "draft" | "waiting" | "approved" | "refused" | "sent" | "ranOut" | "replaced" | "withdrawn" | "accepted" | "declined";

export function stateOf(quote: Quote, family: readonly Quote[], today: string): QuoteState {
  if (quote.status === "accepted") return "accepted";
  if (quote.status === "declined") return "declined";
  if (quote.status === "withdrawn") return family.some((other) => other.replaces_id === quote.id && other.sent_at !== null) ? "replaced" : "withdrawn";
  if (quote.status === "sent") return quote.valid_until !== null && quote.valid_until.slice(0, 10) < today ? "ranOut" : "sent";
  return quote.approval === "asked" ? "waiting" : quote.approval === "approved" ? "approved" : quote.approval === "refused" ? "refused" : "draft";
}

export const TONE: Record<QuoteState, "neutral" | "warn" | "pos" | "danger" | "accent"> = {
  draft: "neutral", waiting: "warn", approved: "pos", refused: "danger", sent: "accent", ranOut: "danger", replaced: "neutral", withdrawn: "neutral", accepted: "pos", declined: "danger",
};

/** The versions of each family, oldest first; families by their number. */
export function families(quotes: readonly Quote[]): Quote[][] {
  const by = new Map<string, Quote[]>();
  for (const quote of quotes) {
    const key = `${String(quote.deal_id)}:${quote.family_no ?? quote.number ?? String(quote.id)}`;
    by.set(key, [...(by.get(key) ?? []), quote]);
  }
  return [...by.values()].map((list) => [...list].sort((a, b) => a.version - b.version || a.id - b.id));
}

/** The version the customer holds: the one that is sent or accepted, if any. */
export const held = (family: readonly Quote[]): Quote | null => [...family].reverse().find((quote) => quote.status === "sent" || quote.status === "accepted") ?? null;
export const newest = (family: readonly Quote[]): Quote => family[family.length - 1]!;
export const familyNo = (family: readonly Quote[]): string => family[0]!.family_no ?? family[0]!.number ?? "";

/** Whether a version's lines and notes can be changed: a draft that is not waiting on a decision. The server holds the same. */
export const editable = (quote: Quote): boolean => quote.status === "draft" && quote.approval !== "asked";

export async function readQuotes(session: StaffSession, where?: Condition): Promise<Quote[]> {
  const out: Quote[] = [];
  for (let offset = 0; offset < 1000; offset += 200) {
    const page = await session.list<Quote>("quotes", { select: QUOTE_COLUMNS, lookup: QUOTE_LOOKUPS, order: ["id"], limit: 200, offset, ...(where === undefined ? {} : { where }) });
    out.push(...page.rows);
    if (page.rows.length < 200) break;
  }
  return out;
}

const peopleOf = new WeakMap<StaffSession, Promise<Record<string, string>>>();

/** Everybody a screen names, by id: the signed-in person, and whoever else they may name. The people list is asked once per page load, not once per read. */
export async function readNames(session: StaffSession, ids: readonly (string | null)[]): Promise<Record<string, string>> {
  const me = session.config.user;
  const names: Record<string, string> = me === null ? {} : { [me.id]: me.name };
  if (!ids.some((id) => id !== null && names[id] === undefined)) return names;
  let all = peopleOf.get(session);
  if (all === undefined) {
    all = session.people(undefined, 200).then(
      (people) => Object.fromEntries(people.map((person) => [person.id, person.name])),
      () => {
        peopleOf.delete(session);
        return {};
      },
    );
    peopleOf.set(session, all);
  }
  return { ...(await all), ...names };
}

export const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);

/**
 * A new quote with its lines: the quote first, then each line under it.
 *
 * Not one save: a side cannot name a parent's child relation to the server
 * (the config gives tables, not relations), so the lines follow one by one,
 * each with a key of its own. If a line fails the quote is still there, a
 * draft with the lines that went in; the answer says how many did not.
 */
export async function createQuote(session: StaffSession, values: Record<string, unknown>, lines: readonly Record<string, unknown>[]): Promise<{ saved: Saved<Quote>; missing: number }> {
  const saved = await session.create<Quote>("quotes", values, newClientKey());
  if (saved.state !== "saved") return { saved, missing: lines.length };
  let missing = 0;
  for (const [at, line] of lines.entries()) {
    const made = await session.create("quote_lines", { ...line, document_id: saved.row.id, position: at }, newClientKey());
    if (made.state !== "saved") missing += 1;
  }
  return { saved, missing };
}
