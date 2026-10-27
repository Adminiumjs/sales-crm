/**
 * THE INBOX: what the Team inbox, Trade-show leads and the marketer's home
 * read, and what is done to an enquiry.
 *
 * ONE TABLE, TWO SCREENS. An enquiry that was scanned on a stand (it names
 * its show and says how keen the person was) is a TRADE-SHOW LEAD; every
 * other enquiry is the TEAM INBOX's. Somebody an enquiry was passed to, or
 * who claimed it, also finds it in her own Team inbox, lead or not: a rep's
 * menu has no Trade-show leads, and the leads passed to her are hers to ring.
 *
 * WHO READS WHAT is the server's: a rep and the front desk are answered the
 * enquiries nobody has yet and their own; a manager her team's too; the
 * marketer, the CRM admin and Read-only all of them. Nothing here narrows by
 * role.
 *
 * WHO COUNTS. The server: every count on these screens is the total it
 * answers for a list of one row, or a figure it works out. A screen puts a
 * row under "to ring" or "spoken to" from the row's own columns, and takes a
 * day from the server's clock.
 */
import type { Formatters } from "../../lib/format.ts";
import type { Condition, Grouped, Saved, StaffSession } from "../../staffSession.ts";

export type Source = "form" | "phone" | "show" | "chat";
export const SOURCES: readonly Source[] = ["phone", "form", "show", "chat"];
export type Warmth = "hot" | "warm" | "cold";
export const WARMTHS: readonly Warmth[] = ["hot", "warm", "cold"];
export type EnquiryState = "open" | "claimed" | "passed" | "dropped";

export interface Enquiry extends Record<string, unknown> {
  id: number;
  source: Source;
  company_name: string;
  person: string | null;
  email: string | null;
  phone: string | null;
  text: string | null;
  est_value: number | string | null;
  town: string | null;
  wants: string | null;
  warmth: Warmth | null;
  show_id: number | null;
  company_id: number | null;
  received_at: string;
  state: EnquiryState;
  claimed_by_id: string | null;
  passed_to_id: string | null;
  rung_at: string | null;
  deal_id: number | null;
  /** When whoever took it offered the person a way to say no to our mail (the server's stamp); empty from a file, or before 0.2.3. */
  opt_out_offered_at?: string | null;
  /** The matched company's name, from the server. */
  company: string | null;
  /** The columns the server keeps from this reader (a role that reads no personal data). */
  _masked?: string[];
}

/**
 * Scanned on a stand: it names its show and how keen the person was. Kept as
 * flat lists of conditions: the server reads a `where` three levels deep at
 * most, so a rule is never nested inside another, only laid beside it.
 */
const LEAD: Condition[] = [{ column: "show_id", op: "not_null" }, { column: "warmth", op: "not_null" }];
const NO_LEAD: Condition[] = [{ column: "show_id", op: "is_null" }, { column: "warmth", op: "is_null" }];
export const IS_LEAD: Condition = { and: LEAD };
export const NOT_LEAD: Condition = { or: NO_LEAD };
export const isLead = (row: Pick<Enquiry, "show_id" | "warmth">): boolean => row.show_id !== null && row.warmth !== null;

const MINE = (me: string): Condition[] => [{ column: "claimed_by_id", op: "eq", value: me }, { column: "passed_to_id", op: "eq", value: me }];
const mineOf = (me: string): Condition => ({ or: MINE(me) });
/** The Team inbox of one person: what was never scanned on a stand, and whatever is hers. */
export const inboxOf = (me: string): Condition => (me === "" ? NOT_LEAD : { or: [...NO_LEAD, ...MINE(me)] });

const LOOKUPS = ["company:company_id.name"];
const total = (session: StaffSession, where: Condition): Promise<number> => session.list("enquiries", { select: ["id"], where, limit: 1, count: "exact" }).then((page) => page.total ?? page.rows.length);

export type InboxFilter = "open" | "mine" | "all";
export interface InboxData {
  rows: Enquiry[];
  counts: Record<InboxFilter, number>;
  /** More than a page of them: the list is the newest, the counts are all. */
  cut: boolean;
}

export const inInboxFilter = (row: Enquiry, filter: InboxFilter, me: string): boolean => (filter === "all" ? true : filter === "open" ? row.state === "open" : row.claimed_by_id === me || row.passed_to_id === me);

/** The reader's Team inbox, newest first, with the server's three counts. */
export async function readInbox(session: StaffSession): Promise<InboxData> {
  const me = session.config.user?.id ?? "";
  const scope = inboxOf(me);
  const [page, open, mine] = await Promise.all([
    session.list<Enquiry>("enquiries", { where: scope, order: ["received_at.desc", "id.desc"], lookup: LOOKUPS, limit: 200, count: "exact" }),
    total(session, { and: [scope, { column: "state", op: "eq", value: "open" }] }),
    me === "" ? Promise.resolve(0) : total(session, mineOf(me)),
  ]);
  const all = page.total ?? page.rows.length;
  return { rows: page.rows, counts: { open, mine, all }, cut: all > page.rows.length };
}

/** What a trade-show lead has come to. `new` still wants its first call. */
export type LeadState = "new" | "called" | "deal" | "no";
export const LEAD_STATES: readonly LeadState[] = ["new", "called", "deal", "no"];
export const leadState = (row: Pick<Enquiry, "state" | "rung_at" | "deal_id">): LeadState => (row.deal_id !== null ? "deal" : row.state === "dropped" ? "no" : row.rung_at !== null ? "called" : "new");

const LEAD_WHERE: Record<LeadState, Condition[]> = {
  deal: [{ column: "deal_id", op: "not_null" }],
  no: [{ column: "deal_id", op: "is_null" }, { column: "state", op: "eq", value: "dropped" }],
  called: [{ column: "deal_id", op: "is_null" }, { column: "state", op: "neq", value: "dropped" }, { column: "rung_at", op: "not_null" }],
  new: [{ column: "deal_id", op: "is_null" }, { column: "state", op: "neq", value: "dropped" }, { column: "rung_at", op: "is_null" }],
};

export interface Show extends Record<string, unknown> {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string | null;
}

export interface LeadsData {
  shows: Show[];
  show: Show | null;
  rows: Enquiry[];
  counts: Record<LeadState | "all" | "hotNew", number>;
  cut: boolean;
  /** After how many days a lead goes cold: the install's setting. */
  coldDays: number;
}

/** The shows, newest first: read once per page. */
export const readShows = (session: StaffSession): Promise<Show[]> => session.list<Show>("shows", { select: ["id", "name", "starts_on", "ends_on"], order: ["starts_on.desc", "id.desc"], limit: 50 }).then((page) => page.rows);

export const readColdDays = (session: StaffSession): Promise<number> =>
  session.list<{ lead_cold_days: number | string | null }>("settings", { select: ["lead_cold_days"], limit: 1 }).then(
    (page) => Number(page.rows[0]?.lead_cold_days ?? 14) || 14,
    () => 14,
  );

/** One show's leads as the reader is answered them, with the server's counts of each state. */
export async function readLeads(session: StaffSession, shows: Show[], showId: number | null, coldDays: number): Promise<LeadsData> {
  const show = shows.find((one) => one.id === showId) ?? shows[0] ?? null;
  const zero = { all: 0, new: 0, called: 0, deal: 0, no: 0, hotNew: 0 };
  if (show === null) return { shows, show, rows: [], counts: zero, cut: false, coldDays };
  const scope: Condition[] = [{ column: "show_id", op: "eq", value: show.id }, { column: "warmth", op: "not_null" }];
  const [page, called, deal, no, fresh, hotNew] = await Promise.all([
    session.list<Enquiry>("enquiries", { where: { and: scope }, order: ["received_at", "id"], lookup: LOOKUPS, limit: 200, count: "exact" }),
    total(session, { and: [...scope, ...LEAD_WHERE.called] }),
    total(session, { and: [...scope, ...LEAD_WHERE.deal] }),
    total(session, { and: [...scope, ...LEAD_WHERE.no] }),
    total(session, { and: [...scope, ...LEAD_WHERE.new] }),
    total(session, { and: [...scope, ...LEAD_WHERE.new, { column: "warmth", op: "eq", value: "hot" }] }),
  ]);
  const all = page.total ?? page.rows.length;
  return { shows, show, rows: page.rows, counts: { all, new: fresh, called, deal, no, hotNew }, cut: all > page.rows.length, coldDays };
}

const STATE_ORDER: Record<LeadState, number> = { new: 0, called: 1, deal: 2, no: 3 };
const WARM_ORDER: Record<Warmth, number> = { hot: 0, warm: 1, cold: 2 };
/** The order to work in: still to ring first, the keenest first among them. */
export const byWorkOrder = (a: Enquiry, b: Enquiry): number =>
  STATE_ORDER[leadState(a)] - STATE_ORDER[leadState(b)] || WARM_ORDER[a.warmth ?? "cold"] - WARM_ORDER[b.warmth ?? "cold"] || new Date(a.received_at).getTime() - new Date(b.received_at).getTime() || a.id - b.id;

/** Whole days since a lead was scanned, and how many are left before it goes cold (below nothing: it has). */
export function leadAge(row: Pick<Enquiry, "received_at">, now: Date, f: Formatters, coldDays: number): { days: number; left: number } {
  const days = Math.max(0, f.dayDiff(new Date(row.received_at), now));
  return { days, left: coldDays - days };
}

/** The marketer's home: counts of what came in this month by where it came from, and the leads nobody has rung. */
export interface SourceLine {
  source: Source;
  label: string;
  enquiries: number;
  inbox: number;
  scanned: number;
  deals: number;
}
export interface MarketerHome {
  month: number;
  sources: SourceLine[];
  deals: number;
  notRung: number;
  hotNotRung: number;
  waiting: Enquiry[];
  coldDays: number;
}

const bySource = (session: StaffSession, filters: Condition[]): Promise<Grouped> =>
  session.figure<Grouped>({ table: "enquiries", shape: "categorical", filters, groupBy: ["source"], aggregations: [{ fn: "count", alias: "n" }, { fn: "count", column: "deal_id", alias: "deals" }], limit: 20 });

export async function readMarketerHome(session: StaffSession, month: [string, string], f: Formatters): Promise<MarketerHome> {
  // The month where the business is, as moments: an enquiry is stamped with a time, not a day.
  const within: Condition = { column: "received_at", op: "between", value: [f.at(month[0], "00:00").toISOString(), new Date(f.at(month[1], "23:59").getTime() + 59_999).toISOString()] };
  const waiting: Condition[] = [...LEAD, ...LEAD_WHERE.new];
  const [all, inbox, monthTotal, deals, notRung, hotNotRung, rows, coldDays] = await Promise.all([
    bySource(session, [within]),
    bySource(session, [within, NOT_LEAD]),
    total(session, within),
    total(session, { and: [within, { column: "deal_id", op: "not_null" }] }),
    total(session, { and: waiting }),
    total(session, { and: [...waiting, { column: "warmth", op: "eq", value: "hot" }] }),
    session.list<Enquiry>("enquiries", { where: { and: waiting }, order: ["received_at", "id"], lookup: LOOKUPS, limit: 50 }),
    readColdDays(session),
  ]);
  const inInbox = new Map(inbox.items.map((item) => [String(item.key), item.values?.["n"] ?? item.value]));
  const sources = all.items.map((item) => {
    const enquiries = Number(item.values?.["n"] ?? item.value);
    const kept = Number(inInbox.get(String(item.key)) ?? 0);
    // Two of the server's counts of one source: what is left over was scanned on a stand.
    return { source: String(item.key) as Source, label: item.label ?? String(item.key), enquiries, inbox: kept, scanned: enquiries - kept, deals: Number(item.values?.["deals"] ?? 0) };
  });
  sources.sort((a, b) => b.enquiries - a.enquiries || a.source.localeCompare(b.source));
  return { month: monthTotal, sources, deals, notRung, hotNotRung, waiting: [...rows.rows].sort(byWorkOrder), coldDays };
}

/* ── What is done to an enquiry ──────────────────────────────────────────── */

export interface NewEnquiry {
  source: Source;
  company_name: string;
  person: string;
  email: string;
  phone: string;
  wants: string;
  text: string;
  est_value: number | null;
  town: string;
  company_id: number | null;
}

const orNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** Type an enquiry in. The key is made once by the dialog: sent again after a lost reply, the server answers the row the first try made. */
export const addEnquiry = (session: StaffSession, values: NewEnquiry, clientKey: string, told = false): Promise<Saved<Enquiry>> =>
  session.create<Enquiry>(
    "enquiries",
    { source: values.source, company_name: values.company_name.trim(), person: orNull(values.person), email: orNull(values.email), phone: orNull(values.phone), wants: orNull(values.wants), text: orNull(values.text), est_value: values.est_value, town: orNull(values.town), company_id: values.company_id },
    clientKey,
    // The dialog showed the line "you can say no to our mail" under the address: the server marks the enquiry as offered.
    told ? { optOut: { shown: true } } : {},
  );

/** The enquiry's own buttons on the server, each pressed from the state the screen saw. */
export const claim = (session: StaffSession, row: Pick<Enquiry, "id" | "state">): Promise<Saved<Enquiry>> => session.act<Enquiry>("enquiries", row.id, "claim", row.state);
export const passOn = (session: StaffSession, row: Pick<Enquiry, "id" | "state">, to: string): Promise<Saved<Enquiry>> => session.act<Enquiry>("enquiries", row.id, "pass", row.state, { values: { passed_to_id: to } });
export const notForUs = (session: StaffSession, row: Pick<Enquiry, "id" | "state">): Promise<Saved<Enquiry>> => session.act<Enquiry>("enquiries", row.id, "not-for-us", row.state);
/** "Rang them": the moment, by the server's clock. */
export const markRung = (session: StaffSession, row: Pick<Enquiry, "id">): Promise<Saved<Enquiry>> => session.update<Enquiry>("enquiries", row.id, { rung_at: session.now().toISOString() });

/** Who an enquiry can be passed to: the people with a rep's profile where the reader may read those, else everybody who signs in here (the server refuses somebody who cannot open enquiries). */
export async function readPassTo(session: StaffSession): Promise<{ id: string; name: string }[]> {
  const [people, reps] = await Promise.all([
    session.people(undefined, 200).catch(() => []),
    session.can("reps", "read") ? session.list<{ user_id: string }>("reps", { select: ["user_id"], limit: 200 }).then((page) => page.rows.map((row) => row.user_id)) : Promise.resolve(null),
  ]);
  const me = session.config.user?.id ?? "";
  return people.filter((person) => person.id !== me && (reps === null || reps.includes(person.id))).map((person) => ({ id: person.id, name: person.name }));
}

/** May this person turn an enquiry into a deal: change the enquiry, and make a deal. */
export const canClaim = (session: StaffSession): boolean => session.can("enquiries", "update") && session.part("selling") && session.can("deals", "create") && session.can("stages", "read") && session.can("companies", "read");

/** Companies on the books whose name holds what was typed: offered as the enquiry's match. */
export const findCompanies = (session: StaffSession, typed: string): Promise<{ id: number; name: string }[]> =>
  typed.trim().length < 3 || !session.can("companies", "read") ? Promise.resolve([]) : session.list<{ id: number; name: string }>("companies", { select: ["id", "name"], q: typed.trim(), order: ["name"], limit: 4 }).then((page) => page.rows);
