/**
 * ACCOUNTS, as the screens read them: companies, the people there, and what
 * a reader may know of the deals at a company.
 *
 * A COMPANY IS EVERYBODY'S; A DEAL IS NOT. Every role with Accounts reads
 * every company and contact. Deals are read by reach (a rep her own, the
 * manager her team's, the account manager won ones, the marketer none), and
 * everything said about deals on these screens is one of two answers of the
 * server to THIS reader:
 *
 *  - a figure folded over `deals` (a measure, a list), which the server cuts
 *    to the rows she reads: "my open value", the deals named on a profile;
 *  - a row of `deal_marks`, the one thing everybody who has Accounts may know
 *    of any deal: its company, its main contact, whether it is open, and (for
 *    the roles that read deals) whose it is and its stage. No title, no
 *    amount, no date. The marketer reads a mark's company and state (and the
 *    numbers of the rows it links), never whose it is: for her it is a count.
 *
 * WHO ADDS UP. Nothing here adds rows. Counts and sums are the server's
 * (measures on the list of companies, grouped figures over the marks, a
 * list's own total). This file matches a mark to a deal the reader holds,
 * picks the first row of a list the server put in order, and subtracts a
 * moment from the server's clock.
 */
import { mayChangeCompany, openOwnersAt, readUs } from "../../selling/whose.ts";
import { leadRole } from "../../shell/roles.ts";
import type { Condition, Grouped, ListQuery, Measure, Page, StaffSession } from "../../staffSession.ts";
import { noValue } from "../../staffSession.ts";

export const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);

/**
 * What this reader is answered about deals:
 *  - `team`: the deals she reaches are everybody's she leads (manager, admin, Read-only);
 *  - `mine`: a rep's own, with the ones she helps on or covers;
 *  - `won`: the account manager's, once a deal is won;
 *  - `count`: no deal at all, only how many there are (the marketer);
 *  - `none`: nothing of deals (a role with no mark either).
 */
export type Reach = "team" | "mine" | "won" | "count" | "none";

export function reachOf(session: StaffSession): Reach {
  const marks = session.can("deal_marks", "read");
  if (!session.part("selling") || !session.can("deals", "read")) return marks && session.part("selling") ? "count" : "none";
  const lead = leadRole((session.config.access?.roles ?? []).map((role) => role.slug));
  return lead === "rep" ? "mine" : lead === "account-manager" ? "won" : "team";
}

/** Whether the reader is answered amounts at all. */
export const readsDeals = (reach: Reach): boolean => reach === "team" || reach === "mine" || reach === "won";

const OPEN: { column: string; in: unknown[] }[] = [{ column: "state", in: ["open"] }];
const WON: { column: string; in: unknown[] }[] = [{ column: "state", in: ["won"] }];
/**
 * A fold over the deals of each company, as the server takes one: `of` is a
 * sum of products of columns, and an empty fold answers nothing or zero. (The
 * shared client's `Measure` type says `of: string` and `emptyAs: number`,
 * which the server refuses; the shape is built here and handed over as is.)
 */
const overDeals = (id: string, fn: Measure["fn"], of: string | undefined, where: Measure["where"]): Measure =>
  ({ id, table: "deals", fkColumn: "company_id", fn, ...(of === undefined ? {} : { of: { terms: [{ sign: "plus", factors: [of] }] } }), emptyAs: "zero", ...(where === undefined ? {} : { where }) }) as unknown as Measure;

export interface CompanyCard extends Record<string, unknown> {
  id: number;
  name: string;
  sector: string | null;
  headcount: number | null;
  town: string | null;
  account_owner_id?: string | null;
  /** The reader's own open deals here, and their sum: null when she reads no deal. */
  open_n: number | string | null;
  open_value: number | string | null;
}

export interface CompanyList {
  rows: CompanyCard[];
  total: number;
  /** Every open deal at a company, whoever holds it: the marks' count. Null when the reader reads no mark. */
  marks: Record<string, number> | null;
  /** The reader's open deals that have sat in their stage past the "stale" setting, by company. */
  stale: Record<string, number>;
  /** The companies the reader may change (plan 68 X3: hers, her team's, or nobody's; the server holds every write). */
  changeable: ReadonlySet<number>;
}

/**
 * Which of some companies the reader may change: none for a role that changes no company; for the others, the server's
 * rule as the page can read it (whose each is, and whose its open deals are, from the marks).
 */
export async function changeableOf(session: StaffSession, companies: readonly { id: number; account_owner_id?: string | null }[]): Promise<ReadonlySet<number>> {
  if (!session.can("companies", "update") || companies.length === 0) return new Set();
  const us = await readUs(session);
  if (us === "anybody") return new Set(companies.map((company) => company.id));
  const owners = await openOwnersAt(session, companies.map((company) => company.id)).catch(() => null);
  // Unread, nothing is offered: the server would be asked to decide a write the page cannot say is hers.
  if (owners === null) return new Set();
  return new Set(companies.filter((company) => mayChangeCompany(us, company.account_owner_id ?? null, owners[String(company.id)] ?? [])).map((company) => company.id));
}

/** The most companies or contacts one look holds: the server's limit for a list. */
export const PAGE = 200;

/** Narrow a list by what was typed, over the columns a card shows. Used when there are more rows than one look holds. */
export const typed = (columns: readonly string[], q: string): Condition | undefined => {
  const text = q.trim();
  if (text === "") return undefined;
  const like = `%${text.replace(/[%_\\]/g, (letter) => `\\${letter}`)}%`;
  return { or: columns.map((column) => ({ column, op: "ilike" as const, value: like })) };
};

const grouped = (figure: Grouped): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of figure.items) if (!noValue(item.key)) out[String(item.key)] = num(item.values?.["n"] ?? item.value);
  return out;
};

/**
 * The companies, each with the reader's own open deals counted and summed by
 * the server, the count of every open deal there (the marks), and how many of
 * hers have sat too long. Three requests, whatever the number of companies.
 */
/** The days after which a sitting deal is "stale": the business's own setting, read once and kept. */
const STALE = new WeakMap<StaffSession, Promise<number>>();
export function staleDaysOf(session: StaffSession): Promise<number> {
  const kept = STALE.get(session);
  if (kept !== undefined) return kept;
  const days = session.can("settings", "read")
    ? session
        .list<{ sitting_stale_days: number | null }>("settings", { select: ["sitting_stale_days"], limit: 1 })
        .then((page) => num(page.rows[0]?.sitting_stale_days) || 30)
        .catch(() => 30)
    : Promise.resolve(30);
  STALE.set(session, days);
  return days;
}

export async function readCompanies(session: StaffSession, reach: Reach, before: (days: number) => string, q: string): Promise<CompanyList> {
  const staleBefore = reach === "team" || reach === "mine" ? before(await staleDaysOf(session)) : null;
  const where = typed(["name", "sector", "town"], q);
  const page = await session.list<CompanyCard>("companies", {
    select: ["id", "name", "sector", "headcount", "town", "account_owner_id"],
    ...(where === undefined ? {} : { where }),
    order: ["name", "id"],
    limit: PAGE,
    count: "exact",
    ...(readsDeals(reach) ? { measures: [overDeals("open_n", "count", undefined, OPEN), overDeals("open_value", "sum", "amount", OPEN)] } : {}),
  });
  const ids = page.rows.map((row) => row.id);
  if (ids.length === 0) return { rows: [], total: page.total ?? 0, marks: reach === "none" ? null : {}, stale: {}, changeable: new Set() };
  const here: Condition = { column: "company_id", op: "in", value: ids };
  const [marks, stale, changeable] = await Promise.all([
    reach === "none"
      ? Promise.resolve(null)
      : session.figure<Grouped>({ table: "deal_marks", shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }, here], groupBy: ["company_id"], aggregations: [{ fn: "count", alias: "n" }], limit: PAGE }),
    (reach === "team" || reach === "mine") && staleBefore !== null
      ? session.figure<Grouped>({
          table: "deals",
          shape: "categorical",
          filters: [{ column: "state", op: "eq", value: "open" }, { column: "entered_stage_at", op: "lt", value: staleBefore }, here],
          groupBy: ["company_id"],
          aggregations: [{ fn: "count", alias: "n" }],
          limit: PAGE,
        })
      : Promise.resolve(null),
    changeableOf(session, page.rows),
  ]);
  return { rows: page.rows, total: page.total ?? page.rows.length, marks: marks === null ? null : grouped(marks), stale: stale === null ? {} : grouped(stale), changeable };
}

/** The words under a card: how many deals are open here, said for this reader. */
export type OpenLine = { kind: "team"; count: number } | { kind: "mine"; count: number } | { kind: "noneMine" } | { kind: "all"; count: number } | { kind: "none" } | null;

/**
 * - a team's reader: the deals she reaches, with their sum (where she reaches none of the open deals there, how many there are);
 * - a rep: her own, with their sum; "none of yours" when colleagues hold some; "nothing open" when nobody does;
 * - anybody else who reads the marks: how many are open, no amount;
 * - a reader of no mark: nothing is said.
 */
export function openLine(reach: Reach, mine: number, everybody: number | null): OpenLine {
  if (reach === "none") return null;
  if (reach === "team") return mine > 0 ? { kind: "team", count: mine } : (everybody ?? 0) > 0 ? { kind: "all", count: everybody ?? 0 } : { kind: "none" };
  if (reach === "mine") return mine > 0 ? { kind: "mine", count: mine } : (everybody ?? 0) > 0 ? { kind: "noneMine" } : { kind: "none" };
  return (everybody ?? 0) > 0 ? { kind: "all", count: everybody ?? 0 } : { kind: "none" };
}

// ── one company ──────────────────────────────────────────────────────────────

export interface Company extends Record<string, unknown> {
  id: number;
  name: string;
  sector: string | null;
  headcount: number | null;
  address_lines: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  website: string | null;
  access_note: string | null;
  account_owner_id: string | null;
  open_n: number | string | null;
  open_value: number | string | null;
  weighted: number | string | null;
  won_value: number | string | null;
  people: number | string | null;
}

export interface Mark extends Record<string, unknown> {
  id?: number;
  deal_id?: number;
  owner_id?: string | null;
  stage_id?: number;
  contact_id?: number | null;
  state: "open" | "won" | "lost";
}

export interface DealRow extends Record<string, unknown> {
  id: number;
  name: string;
  state: "open" | "won" | "lost";
  amount: number | string;
  expected_close: string | null;
  closed_on: string | null;
  opened_on: string | null;
  stage: string | null;
  reason: string | null;
}

export interface Person extends Record<string, unknown> {
  id: number;
  company_id: number;
  name: string;
  job_title: string | null;
  email?: string | null;
  phone?: string | null;
  may_email?: boolean | null;
}

export interface ActivityRow extends Record<string, unknown> {
  id: number;
  deal_id: number;
  kind: "call" | "email" | "meeting" | "note";
  text: string | null;
  author_id: string | null;
  at: string;
  deal: string | null;
}

/** Somebody else's open deal: who has it and where it stands. No amount, no title, no link. */
export interface Quiet {
  key: string;
  owner: string | null;
  stage: string | null;
}

/** When a company became a customer, or since when it has been spoken to, as far as this reader is answered. */
export type Since = { kind: "customer"; on: string | null } | { kind: "talking"; on: string | null } | { kind: "new" } | null;

export interface Profile {
  company: Company;
  /** The open deals here that the reader may open, the soonest to close first. */
  open: DealRow[];
  /** The closed ones she may open, the newest first. */
  closed: DealRow[];
  /** Open deals she may not open: one quiet line each (the roles that read whose a mark is). */
  quiet: Quiet[];
  /** Every open deal here by the marks' count; null when she reads no mark. */
  openEverybody: number | null;
  since: Since;
  people: Person[];
  /** Whether the reader is answered the people's e-mail and phone. */
  details: boolean;
  /** The latest things logged on the open deals she reads here. */
  latest: ActivityRow[];
  /** The job a won deal became, where the reader has Jobs on site: its code by the deal's number. */
  jobs: Record<number, string>;
  names: Record<string, string>;
  /** Whether the reader may change the company (plan 68 X3). */
  changeable: boolean;
}

/**
 * A contact's e-mail and phone are personal. A list that NAMES a column kept
 * from the reader is refused whole, so the people are read with no column
 * named: the server then answers every column and leaves the kept ones empty,
 * saying which in `_masked`. The card says the details are not the reader's.
 */
export async function listPeople<R extends Person>(session: StaffSession, q: Omit<ListQuery, "select">): Promise<{ page: Page<R>; details: boolean }> {
  const page = await session.list<R>("contacts", q);
  const kept = page.rows[0]?.["_masked"];
  return { page, details: !(Array.isArray(kept) && kept.includes("email")) };
}

const DEAL_COLUMNS = ["id", "name", "state", "amount", "expected_close", "closed_on", "opened_on"];
const DEAL_LOOKUPS = ["stage:stage_id.label", "reason:lost_reason_id.label"];

/**
 * "Customer since" is the day the first deal here was won; with none won,
 * "in conversation since" the day the first was opened. The server puts the
 * rows in order and this takes the first.
 *
 * It is a fact about the WHOLE company, so the day is said only to a reader
 * who was answered EVERY deal there (as many deals as the company has marks):
 * the manager of everybody, the CRM admin, Read-only, a rep at a company where
 * all the deals are hers. Anybody else is not answered the days of her
 * colleagues' deals, and is told "customer" or "in conversation" from the
 * marks (which say whether a deal was won, and no day). The account manager
 * reads every WON deal, so he is answered the day of the first win.
 */
export function sinceOf(reach: Reach, firstWon: string | null, firstOpened: string | null, marks: readonly Mark[] | null, everyDeal: boolean): Since {
  if (marks === null) return null;
  if (everyDeal && readsDeals(reach) && reach !== "won") return firstWon !== null ? { kind: "customer", on: firstWon } : firstOpened !== null ? { kind: "talking", on: firstOpened } : { kind: "new" };
  if (marks.some((mark) => mark.state === "won")) return { kind: "customer", on: reach === "won" ? firstWon : null };
  return marks.length > 0 ? { kind: "talking", on: null } : { kind: "new" };
}

/** The marks of open deals the reader may not open, as quiet lines: matched against the deals she was answered. */
export function quietLines(marks: readonly Mark[], opened: readonly { id: number }[], names: Record<string, string>, stages: Record<string, string>): Quiet[] {
  const mine = new Set(opened.map((deal) => deal.id));
  return marks
    .filter((mark) => mark.state === "open" && mark.deal_id !== undefined && !mine.has(mark.deal_id))
    .map((mark) => ({ key: String(mark.deal_id), owner: mark.owner_id === null || mark.owner_id === undefined ? null : (names[mark.owner_id] ?? null), stage: mark.stage_id === undefined ? null : (stages[String(mark.stage_id)] ?? null) }));
}

/** Everybody's name, read once and kept a minute (a person's requests are counted). */
const NAMES = new WeakMap<StaffSession, { at: number; names: Promise<Record<string, string>> }>();
export function namesOf(session: StaffSession): Promise<Record<string, string>> {
  const kept = NAMES.get(session);
  if (kept !== undefined && Date.now() - kept.at < 60_000) return kept.names;
  const me = session.config.user;
  const names = session
    .people(undefined, 200)
    .catch(() => [])
    .then((people) => Object.fromEntries([...(me === null ? [] : [[me.id, me.name] as const]), ...people.map((person) => [person.id, person.name] as const)]));
  NAMES.set(session, { at: Date.now(), names });
  return names;
}

export async function readProfile(session: StaffSession, reach: Reach, id: number): Promise<Profile | null> {
  const deals = readsDeals(reach);
  const company = await session.get<Company>("companies", id, {
    agg: [`people:${session.tableId("contacts")}.company_id:count`],
    ...(deals ? { measures: [overDeals("open_n", "count", undefined, OPEN), overDeals("open_value", "sum", "amount", OPEN), overDeals("weighted", "sum", "weighted_value", OPEN), overDeals("won_value", "sum", "amount", WON)] } : {}),
  });
  if (company === null) return null;
  const here: Condition = { column: "company_id", op: "eq", value: id };
  const [marks, list, people, stages, names] = await Promise.all([
    reach === "none"
      ? Promise.resolve(null)
      : session.list<Mark>("deal_marks", { select: reach === "count" ? ["company_id", "state"] : ["deal_id", "owner_id", "stage_id", "state"], where: here, limit: PAGE, count: "exact" }),
    deals ? session.list<DealRow>("deals", { select: DEAL_COLUMNS, where: here, order: ["closed_on.desc", "expected_close", "id"], lookup: DEAL_LOOKUPS, limit: PAGE }) : Promise.resolve(null),
    listPeople<Person>(session, { where: here, order: ["name", "id"], limit: PAGE }),
    deals && session.can("stages", "read") ? session.list<{ id: number; label: string }>("stages", { select: ["id", "label"], limit: 50 }) : Promise.resolve(null),
    deals ? namesOf(session) : Promise.resolve({} as Record<string, string>),
  ]);
  const rows = list?.rows ?? [];
  const open = rows.filter((deal) => deal.state === "open").sort((a, b) => String(a.expected_close ?? "9").localeCompare(String(b.expected_close ?? "9")) || a.id - b.id);
  const closed = rows.filter((deal) => deal.state !== "open").sort((a, b) => String(b.closed_on ?? "").localeCompare(String(a.closed_on ?? "")) || b.id - a.id);
  const stageNames = Object.fromEntries((stages?.rows ?? []).map((stage) => [String(stage.id), stage.label]));
  const openIds = open.map((deal) => deal.id);
  const latest =
    openIds.length > 0 && session.can("activities", "read")
      ? (await session.list<ActivityRow>("activities", { select: ["id", "deal_id", "kind", "text", "author_id", "at"], where: { column: "deal_id", op: "in", value: openIds }, order: ["at.desc", "id.desc"], lookup: ["deal:deal_id.name"], limit: 12 })).rows
      : [];
  const won = closed.filter((deal) => deal.state === "won").map((deal) => deal.id);
  const jobs: Record<number, string> = {};
  if (won.length > 0 && session.part("jobs") && session.can("jobs", "read")) {
    const found = await session.list<{ deal_id: number; code: string | null }>("jobs", { select: ["deal_id", "code"], where: { column: "deal_id", op: "in", value: won }, limit: PAGE }).catch(() => null);
    for (const job of found?.rows ?? []) if (job.code !== null) jobs[job.deal_id] = job.code;
  }
  // The first day of each kind, from the rows the server answered this reader (every deal here, for a team's reader).
  const days = (state: "won" | null, column: "closed_on" | "opened_on"): string | null =>
    rows
      .filter((deal) => (state === null || deal.state === state) && deal[column] !== null)
      .map((deal) => String(deal[column]))
      .sort()[0] ?? null;
  const allMarks = marks?.rows ?? null;
  const changeable = (await changeableOf(session, [company])).has(company.id);
  return {
    company,
    open,
    closed,
    quiet: allMarks === null || reach === "count" ? [] : quietLines(allMarks, open, names, stageNames),
    openEverybody: allMarks === null ? null : allMarks.filter((mark) => mark.state === "open").length,
    since: sinceOf(reach, days("won", "closed_on"), days(null, "opened_on"), allMarks, allMarks !== null && (marks?.total ?? allMarks.length) === rows.length),
    people: people.page.rows,
    details: people.details,
    latest,
    jobs,
    names,
    changeable,
  };
}

// ── contacts ─────────────────────────────────────────────────────────────────

export interface ContactCard extends Person {
  company: string | null;
}

export interface ContactList {
  rows: ContactCard[];
  total: number;
  /** Whether the reader is answered e-mail and phone. */
  details: boolean;
  /** How many open deals each contact is the main contact of, by the marks: everybody's. Null when the reader is not answered it. */
  main: Record<string, number> | null;
  /** The open deals the reader may open, by their main contact. */
  mine: Record<string, { id: number; name: string }[]>;
}

export async function readContacts(session: StaffSession, reach: Reach, q: string, companyId: number | null = null): Promise<ContactList> {
  const narrowed = typed(["name", "job_title"], q);
  const where: Condition | undefined = companyId === null ? narrowed : narrowed === undefined ? { column: "company_id", op: "eq", value: companyId } : { and: [{ column: "company_id", op: "eq", value: companyId }, narrowed] };
  const { page, details } = await listPeople<ContactCard>(session, { ...(where === undefined ? {} : { where }), order: ["name", "id"], lookup: ["company:company_id.name"], limit: PAGE, count: "exact" });
  const ids = page.rows.map((row) => row.id);
  // Asked for the roles that read deals. The marketer's count is a company's: her cards say nothing of deals.
  const counted = reach === "team" || reach === "mine" || reach === "won";
  if (ids.length === 0) return { rows: [], total: page.total ?? 0, details, main: counted ? {} : null, mine: {} };
  const theirs: Condition = { column: "contact_id", op: "in", value: ids };
  const [main, deals] = await Promise.all([
    counted ? session.figure<Grouped>({ table: "deal_marks", shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }, theirs], groupBy: ["contact_id"], aggregations: [{ fn: "count", alias: "n" }], limit: PAGE }) : Promise.resolve(null),
    reach === "team" || reach === "mine" ? session.list<{ id: number; name: string; contact_id: number | null }>("deals", { select: ["id", "name", "contact_id"], where: { and: [{ column: "state", op: "eq", value: "open" }, theirs] }, order: ["id"], limit: PAGE }) : Promise.resolve(null),
  ]);
  const mine: ContactList["mine"] = {};
  for (const deal of deals?.rows ?? []) if (deal.contact_id !== null) (mine[String(deal.contact_id)] ??= []).push({ id: deal.id, name: deal.name });
  return { rows: page.rows, total: page.total ?? page.rows.length, details, main: main === null ? null : grouped(main), mine };
}

/**
 * What a contact's card says about deals: the deal's own name when there is
 * one and the reader may open it, else a count and nothing more (a
 * colleague's deal is never named).
 */
export type MainLine = { kind: "deal"; id: number; name: string } | { kind: "count"; count: number } | null;
export function mainLine(everybody: number | null, mine: readonly { id: number; name: string }[]): MainLine {
  // Not answered the marks: only what she holds herself.
  const count = everybody ?? mine.length;
  if (count <= 0) return null;
  return count === 1 && mine.length === 1 ? { kind: "deal", id: mine[0]!.id, name: mine[0]!.name } : { kind: "count", count };
}

// ── the company's timeline ───────────────────────────────────────────────────

export const KINDS = ["call", "email", "meeting", "note"] as const;
export type Kind = (typeof KINDS)[number] | "stage";

export interface Entry {
  key: string;
  type: Kind;
  at: string;
  who: string | null;
  dealId: number;
  deal: string | null;
  text: string | null;
  from?: string | null;
  to?: string | null;
}

export interface Timeline {
  company: { id: number; name: string } | null;
  entries: Entry[];
  /** Each kind's count, the server's. */
  counts: Record<Kind, number>;
  /** More was logged than one look holds. */
  cut: boolean;
  names: Record<string, string>;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** Newest first; two entries of one moment keep one order. */
export const newestFirst = (a: Entry, b: Entry): number => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key.localeCompare(b.key));

/**
 * Everything logged on the open deals of a company that the reader may open:
 * what people logged and each stage move. The same rows the Activity feed
 * reads, narrowed to one company.
 */
export async function readTimeline(session: StaffSession, id: number): Promise<Timeline> {
  const company = await session.get<{ id: number; name: string }>("companies", id);
  const none: Timeline = { company, entries: [], counts: { call: 0, email: 0, meeting: 0, note: 0, stage: 0 }, cut: false, names: {} };
  if (company === null || !session.can("deals", "read")) return none;
  const deals = await session.list<{ id: number }>("deals", { select: ["id"], where: { and: [{ column: "company_id", op: "eq", value: id }, { column: "state", op: "eq", value: "open" }] }, order: ["id"], limit: PAGE });
  const ids = deals.rows.map((deal) => deal.id);
  if (ids.length === 0) return none;
  const on: Condition = { column: "deal_id", op: "in", value: ids };
  const reads = (table: string): boolean => session.can(table, "read");
  const [byKind, moves, activities, stages, names] = await Promise.all([
    reads("activities") ? session.figure<Grouped>({ table: "activities", shape: "categorical", filters: [on], groupBy: ["kind"], aggregations: [{ fn: "count", alias: "n" }], limit: 20 }) : Promise.resolve(null),
    reads("deal_stage_changes") ? session.figure<{ value: number }>({ table: "deal_stage_changes", shape: "single-metric", filters: [on], aggregations: [{ fn: "count", alias: "n" }] }) : Promise.resolve(null),
    reads("activities") ? session.list<Record<string, unknown>>("activities", { select: ["id", "deal_id", "kind", "text", "author_id", "at"], where: on, order: ["at.desc", "id.desc"], lookup: ["deal:deal_id.name"], limit: PAGE, count: "exact" }) : Promise.resolve(null),
    reads("deal_stage_changes")
      ? session.list<Record<string, unknown>>("deal_stage_changes", { select: ["id", "deal_id", "by_id", "at"], where: on, order: ["at.desc", "id.desc"], lookup: ["deal:deal_id.name", "from:from_stage_id.label", "to:to_stage_id.label"], limit: PAGE, count: "exact" })
      : Promise.resolve(null),
    namesOf(session),
  ]);
  const entries: Entry[] = [
    ...(activities?.rows ?? []).map((row): Entry => ({ key: `a${String(row["id"])}`, type: row["kind"] as Kind, at: String(row["at"]), who: text(row["author_id"]), dealId: num(row["deal_id"]), deal: text(row["deal"]), text: text(row["text"]) })),
    ...(stages?.rows ?? []).map((row): Entry => ({ key: `s${String(row["id"])}`, type: "stage", at: String(row["at"]), who: text(row["by_id"]), dealId: num(row["deal_id"]), deal: text(row["deal"]), text: null, from: text(row["from"]), to: text(row["to"]) })),
  ].sort(newestFirst);
  const kinds = byKind === null ? {} : grouped(byKind);
  const counts: Timeline["counts"] = { call: kinds["call"] ?? 0, email: kinds["email"] ?? 0, meeting: kinds["meeting"] ?? 0, note: kinds["note"] ?? 0, stage: moves === null ? 0 : num(moves.value) };
  const cut = [activities, stages].some((page) => page !== null && (page.total ?? page.rows.length) > page.rows.length);
  return { company, entries, counts, cut, names };
}

/** A company's tile takes one of the eight chart tones from its number, never from its name: a company is the install's to rename. */
export const toneOf = (id: number): number => ((Math.trunc(id) % 8) + 8) % 8;

/** A country's name in the reader's language from its two letters, or the letters themselves. */
export function countryName(code: string | null, locale: string): string | null {
  if (code === null || code === "") return null;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** A company's address on one line: its lines, the town, the region, the postal code, the country. */
export function addressOf(company: Pick<Company, "address_lines" | "town" | "region" | "postal_code" | "country">, locale: string): string {
  return [company.address_lines, company.town, company.region, company.postal_code, countryName(company.country, locale)].filter((part) => part !== null && part !== undefined && String(part).trim() !== "").join(", ");
}

/**
 * What a person sees on a record and does not change. A contact's e-mail is
 * where her quotes and their customer's link are mailed, and a company's
 * street and postal code are kept from the roles that paste: the CRM admin's
 * and the sales manager's to change (the server refuses anybody else).
 */
export const fixedOn = (kind: "company" | "contact", slugs: readonly string[]): readonly string[] =>
  slugs.length === 0 || slugs.includes("crm-admin") || slugs.includes("crm-sales-manager") ? [] : kind === "contact" ? ["email"] : ["address_lines", "postal_code"];

// ── paste a list ─────────────────────────────────────────────────────────────

/** The columns a list may bring: never one the server works out itself, and never a company's street or postal code (kept from the roles that paste). */
export const COMPANY_COLUMNS = ["name", "sector", "headcount", "town", "region", "country", "website"] as const;
export const CONTACT_COLUMNS = ["company_id", "name", "job_title", "email", "phone", "may_email"] as const;

/** What may be done with a line that is already here: the CRM admin may update it, everybody else leaves it. */
export const modesFor = (admin: boolean, mayUpdate: boolean): ("skip" | "update")[] => (admin && mayUpdate ? ["skip", "update"] : ["skip"]);
