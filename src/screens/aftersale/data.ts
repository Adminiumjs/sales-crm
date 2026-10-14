/**
 * WHAT THE "CUSTOMERS AFTER A SALE" SCREENS READ: Renewals, Repeat orders,
 * Referrals and the account manager's home.
 *
 * WHO ADDS UP. The server: every count, sum and average here is a figure it
 * answers for the reader's own rows (`session.figure`), or a fold over a
 * company's deals (`measures`). What this file does itself is pick rows and
 * work with days: the last and the first won deal of a company out of the
 * rows read, the day a reorder falls due (the last won day plus the rhythm
 * the rep gave it), and whether a renewal's day has come.
 *
 * WHAT A READER SEES OF A DEAL is the server's to cut. The account manager
 * reads a deal only once it is won (ruling R6), so for him an open deal's
 * name and amount do not arrive, "open now" is nothing, and a referral whose
 * deal is still open says only that there is one.
 */
import type { Condition, Grouped, StaffError, StaffSession } from "../../staffSession.ts";

export const LISTED = 200;

/** A measure folds an expression: the one column, as the server wants it written. (The session client types `of` as text; the server takes this.) */
const AMOUNT = { terms: [{ sign: "plus", factors: ["amount"] }] } as unknown as string;

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const single = async (session: StaffSession, table: string, filters: Condition[], aggregation: { fn: "count" | "sum" | "avg"; column?: string } = { fn: "count" }): Promise<number | null> => {
  const value = (await session.figure<{ value: number | null }>({ table, shape: "single-metric", filters, aggregations: [{ ...aggregation, alias: "v" }] })).value;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
};
const WON: Condition = { column: "state", op: "eq", value: "won" };
const OPEN_RENEWAL: Condition = { column: "state", op: "eq", value: "open" };
const IDEA: Condition = { column: "kind", op: "eq", value: "idea" };
const REORDER: Condition = { column: "kind", op: "eq", value: "reorder" };

// ── days ──────────────────────────────────────────────────────────────────────

/** A day some months on: the 31st of a month that has none lands on its last day. */
export function addMonths(dayKey: string, months: number): string {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${String(first.getUTCFullYear()).padStart(4, "0")}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** The same day a year back, for "in the last twelve months". */
export const yearBack = (dayKey: string): string => addMonths(dayKey, -12);

/** Whole days from one day key to another. */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** A reorder is "soon" when it falls due within this many days. */
export const REORDER_SOON_DAYS = 31;
export type ReorderState = "now" | "soon" | "later" | "unknown";
/** Where a reorder stands today: due (its day has come), due soon, not yet, or unknown when nothing was ever won to count from. */
export function reorderState(due: string | null, today: string): ReorderState {
  if (due === null) return "unknown";
  const days = daysBetween(today, due);
  return days <= 0 ? "now" : days <= REORDER_SOON_DAYS ? "soon" : "later";
}

// ── won deals, by company ─────────────────────────────────────────────────────

export interface WonDeal {
  id: number;
  name: string;
  companyId: number;
  amount: number;
  closedOn: string | null;
}

/** Each company's won deals, oldest first (a deal with no day last). */
export function byCompany(deals: readonly WonDeal[]): Map<number, WonDeal[]> {
  const out = new Map<number, WonDeal[]>();
  for (const deal of deals) out.set(deal.companyId, [...(out.get(deal.companyId) ?? []), deal]);
  for (const list of out.values()) list.sort((a, b) => (a.closedOn ?? "9999").localeCompare(b.closedOn ?? "9999") || a.id - b.id);
  return out;
}

/** Every won deal that was not its company's first: what "booked from the second order on" is summed over, by the server. */
export const laterOrders = (deals: readonly WonDeal[]): number[] => [...byCompany(deals).values()].flatMap((list) => list.slice(1).map((deal) => deal.id));

async function wonDealsOf(session: StaffSession, companyIds: readonly number[]): Promise<{ deals: WonDeal[]; cut: boolean }> {
  if (companyIds.length === 0 || !session.can("deals", "read")) return { deals: [], cut: false };
  const page = await session.list<{ id: number; name: string; company_id: number; amount: number | string; closed_on: string | null }>("deals", {
    select: ["id", "name", "company_id", "amount", "closed_on"],
    where: { and: [WON, { column: "company_id", op: "in", value: [...companyIds] }] },
    order: ["closed_on.desc", "id.desc"],
    limit: LISTED,
    count: "exact",
  });
  return { deals: page.rows.map((row) => ({ id: row.id, name: row.name, companyId: row.company_id, amount: num(row.amount), closedOn: row.closed_on })), cut: (page.total ?? page.rows.length) > page.rows.length };
}

// ── Renewals ──────────────────────────────────────────────────────────────────

export interface Idea {
  id: number;
  companyId: number;
  company: string | null;
  title: string;
  value: number | null;
  dueOn: string | null;
  /** Its day has come: worth raising today. An idea with no day is not counted as ready. */
  ready: boolean;
}

export interface RenewalCompany {
  id: number;
  name: string;
  sector: string | null;
  headcount: number | null;
  town: string | null;
  /** Won to date and open now, of the deals the reader can open; null when the reader reads no deals. */
  won: number | null;
  openValue: number | null;
  /** Every open deal at the company, whoever owns it; null when the reader may not count them. */
  openDeals: number | null;
  /** What its ideas come to. */
  room: number;
  lastWon: string | null;
  firstWon: string | null;
  ideas: Idea[];
}

export interface Renewals {
  wonToDate: number | null;
  room: number;
  ideas: number;
  customers: number;
  ready: number;
  companies: RenewalCompany[];
  /** More ideas exist than are listed. */
  cut: boolean;
}

interface IdeaRow extends Record<string, unknown> {
  id: number;
  company_id: number;
  title: string;
  est_value: number | string | null;
  due_on: string | null;
  company: string | null;
}

const ideaOf = (row: IdeaRow, today: string): Idea => ({ id: row.id, companyId: row.company_id, company: row.company, title: row.title, value: row.est_value === null ? null : num(row.est_value), dueOn: row.due_on, ready: row.due_on !== null && row.due_on <= today });

/** The open ideas, soonest first, then the larger: the order the home lists them in. */
async function openIdeas(session: StaffSession, today: string): Promise<{ ideas: Idea[]; total: number }> {
  const page = await session.list<IdeaRow>("renewals", {
    select: ["id", "company_id", "title", "est_value", "due_on"],
    where: { and: [IDEA, OPEN_RENEWAL] },
    order: ["due_on", "est_value.desc", "id"],
    lookup: ["company:company_id.name"],
    limit: LISTED,
    count: "exact",
  });
  return { ideas: page.rows.map((row) => ideaOf(row, today)), total: page.total ?? page.rows.length };
}

/** How many ideas, what they come to, and how many have their day behind them: three figures of the server's. */
async function ideaFigures(session: StaffSession, today: string): Promise<{ count: number; room: number; ready: number }> {
  const [count, room, ready] = await Promise.all([
    single(session, "renewals", [IDEA, OPEN_RENEWAL]),
    single(session, "renewals", [IDEA, OPEN_RENEWAL], { fn: "sum", column: "est_value" }),
    single(session, "renewals", [IDEA, OPEN_RENEWAL, { column: "due_on", op: "lte", value: today }]),
  ]);
  return { count: count ?? 0, room: room ?? 0, ready: ready ?? 0 };
}

export async function readRenewals(session: StaffSession, today: string): Promise<Renewals> {
  const readsDeals = session.can("deals", "read");
  const [{ ideas, total }, figures, perCompany, wonToDate] = await Promise.all([
    openIdeas(session, today),
    ideaFigures(session, today),
    session.figure<Grouped>({
      table: "renewals",
      shape: "categorical",
      filters: [IDEA, OPEN_RENEWAL],
      groupBy: ["company_id"],
      aggregations: [
        { fn: "count", alias: "n" },
        { fn: "sum", column: "est_value", alias: "room" },
      ],
      limit: LISTED,
    }),
    readsDeals ? single(session, "deals", [WON], { fn: "sum", column: "amount" }) : Promise.resolve(null),
  ]);
  const ids = perCompany.items.map((item) => Number(item.key)).filter((id) => Number.isFinite(id));
  const roomOf = new Map(perCompany.items.map((item) => [Number(item.key), num(item.values?.["room"])]));
  if (ids.length === 0) return { wonToDate, room: figures.room, ideas: figures.count, customers: 0, ready: figures.ready, companies: [], cut: false };

  const state = (value: string) => [{ column: "state", in: [value] }];
  const [companies, marks, won] = await Promise.all([
    session.list<{ id: number; name: string; sector: string | null; headcount: number | null; town: string | null; won?: unknown; open_value?: unknown }>("companies", {
      select: ["id", "name", "sector", "headcount", "town"],
      where: { column: "id", op: "in", value: ids },
      limit: LISTED,
      ...(readsDeals
        ? {
            measures: [
              { id: "won", table: "deals", fkColumn: "company_id", fn: "sum" as const, of: AMOUNT, emptyAs: "zero" as unknown as number, where: state("won") },
              { id: "open_value", table: "deals", fkColumn: "company_id", fn: "sum" as const, of: AMOUNT, emptyAs: "zero" as unknown as number, where: state("open") },
            ],
          }
        : {}),
    }),
    session.can("deal_marks", "read")
      ? session.figure<Grouped>({ table: "deal_marks", shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }, { column: "company_id", op: "in", value: ids }], groupBy: ["company_id"], aggregations: [{ fn: "count", alias: "n" }], limit: LISTED })
      : Promise.resolve(null),
    wonDealsOf(session, ids),
  ]);
  const wonBy = byCompany(won.deals);
  const marked = marks === null ? null : new Map(marks.items.map((item) => [Number(item.key), num(item.values?.["n"] ?? item.value)]));
  const rows: RenewalCompany[] = companies.rows.map((company) => {
    const deals = wonBy.get(company.id) ?? [];
    return {
      id: company.id,
      name: company.name,
      sector: company.sector,
      headcount: company.headcount === null ? null : num(company.headcount),
      town: company.town,
      won: readsDeals ? num(company.won) : null,
      openValue: readsDeals ? num(company.open_value) : null,
      openDeals: marked === null ? null : (marked.get(company.id) ?? 0),
      room: roomOf.get(company.id) ?? 0,
      // The rows read hold every won deal of these companies unless there were more than a list takes: then a day that may not be the last is not shown as one.
      lastWon: won.cut ? null : (deals[deals.length - 1]?.closedOn ?? null),
      firstWon: won.cut ? null : (deals[0]?.closedOn ?? null),
      ideas: ideas.filter((idea) => idea.companyId === company.id),
    };
  });
  // The most room first, as the design lists them.
  rows.sort((a, b) => b.room - a.room || a.name.localeCompare(b.name));
  return { wonToDate, room: figures.room, ideas: figures.count, customers: ids.length, ready: figures.ready, companies: rows, cut: total > ideas.length };
}

// ── Repeat orders ─────────────────────────────────────────────────────────────

export interface Reorder {
  id: number;
  companyId: number;
  company: string | null;
  title: string;
  typical: number | null;
  everyMonths: number | null;
  lastWon: string | null;
  due: string | null;
  state: ReorderState;
}

export interface Repeater {
  id: number;
  name: string;
  orders: WonDeal[];
  /** Days between its last two orders. */
  gapDays: number | null;
  /** Its orders' amounts and their number, from the server: the mean is one divided by the other. */
  total: number;
  count: number;
  reorder: Reorder | null;
}

export interface RepeatOrders {
  repeaters: Repeater[];
  /** The sum of every order that was not a company's first, and the average order of the companies that came back. */
  laterValue: number | null;
  meanOrder: number | null;
  reorders: Reorder[];
  reorderCount: number;
  typical: number | null;
  cut: boolean;
}

interface ReorderRow extends Record<string, unknown> {
  id: number;
  company_id: number;
  title: string;
  est_value: number | string | null;
  every_months: number | null;
  company: string | null;
}

export async function readRepeat(session: StaffSession, today: string): Promise<RepeatOrders> {
  const readsDeals = session.can("deals", "read");
  const [wonBy, reorderPage, reorderCount, typical] = await Promise.all([
    readsDeals
      ? session.figure<Grouped>({
          table: "deals",
          shape: "categorical",
          filters: [WON],
          groupBy: ["company_id"],
          groupLabel: "company_id.name",
          aggregations: [
            { fn: "count", alias: "n" },
            { fn: "sum", column: "amount", alias: "amount" },
          ],
          limit: LISTED,
        })
      : Promise.resolve(null),
    session.list<ReorderRow>("renewals", {
      select: ["id", "company_id", "title", "est_value", "every_months"],
      where: { and: [REORDER, OPEN_RENEWAL] },
      order: ["id"],
      lookup: ["company:company_id.name"],
      limit: LISTED,
      count: "exact",
    }),
    single(session, "renewals", [REORDER, OPEN_RENEWAL]),
    single(session, "renewals", [REORDER, OPEN_RENEWAL], { fn: "avg", column: "est_value" }),
  ]);
  // A company "came back" when the server counts two won deals or more for it.
  const back = (wonBy?.items ?? []).filter((item) => num(item.values?.["n"]) >= 2);
  const backIds = back.map((item) => Number(item.key));
  const reorderIds = reorderPage.rows.map((row) => row.company_id);
  const won = await wonDealsOf(session, [...new Set([...backIds, ...reorderIds])]);
  const deals = byCompany(won.deals);
  const later = won.cut ? [] : laterOrders(won.deals.filter((deal) => backIds.includes(deal.companyId)));
  const [laterValue, meanOrder] = await Promise.all([
    later.length === 0 ? Promise.resolve(won.cut ? null : 0) : single(session, "deals", [WON, { column: "id", op: "in", value: later }], { fn: "sum", column: "amount" }),
    backIds.length === 0 ? Promise.resolve(null) : single(session, "deals", [WON, { column: "company_id", op: "in", value: backIds }], { fn: "avg", column: "amount" }),
  ]);

  const reorders: Reorder[] = reorderPage.rows.map((row) => {
    const mine = deals.get(row.company_id) ?? [];
    const lastWon = won.cut ? null : (mine[mine.length - 1]?.closedOn ?? null);
    const due = lastWon === null || row.every_months === null ? null : addMonths(lastWon, num(row.every_months));
    return { id: row.id, companyId: row.company_id, company: row.company, title: row.title, typical: row.est_value === null ? null : num(row.est_value), everyMonths: row.every_months === null ? null : num(row.every_months), lastWon, due, state: reorderState(due, today) };
  });
  const order: Record<ReorderState, number> = { now: 0, soon: 1, later: 2, unknown: 3 };
  reorders.sort((a, b) => order[a.state] - order[b.state] || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.id - b.id);

  const repeaters: Repeater[] = back.map((item) => {
    const id = Number(item.key);
    const orders = deals.get(id) ?? [];
    const [previous, last] = [orders[orders.length - 2], orders[orders.length - 1]];
    return {
      id,
      name: item.label ?? orders[0]?.name ?? "",
      orders,
      gapDays: previous?.closedOn != null && last?.closedOn != null ? daysBetween(previous.closedOn, last.closedOn) : null,
      total: num(item.values?.["amount"]),
      count: num(item.values?.["n"]),
      reorder: reorders.find((one) => one.companyId === id) ?? null,
    };
  });
  return { repeaters, laterValue, meanOrder, reorders, reorderCount: reorderCount ?? reorders.length, typical, cut: won.cut || (reorderPage.total ?? reorders.length) > reorders.length };
}

// ── Referrals ─────────────────────────────────────────────────────────────────

export type ReferralState = "won" | "open" | "lost" | "none" | "hidden";

export interface Referral {
  id: number;
  fromId: number | null;
  from: string | null;
  fromTitle: string | null;
  fromCompany: string | null;
  toId: number | null;
  to: string | null;
  dealId: number | null;
  deal: string | null;
  dealAmount: number | null;
  state: ReferralState;
  introducedOn: string;
  thankedAt: string | null;
}

export interface Referrals {
  total: number;
  lastYear: number;
  thanked: number;
  /** No deal came of it. */
  nowhere: number;
  won: { count: number; amount: number } | null;
  open: { count: number; amount: number } | null;
  rows: Referral[];
  cut: boolean;
}

interface ReferralRow extends Record<string, unknown> {
  id: number;
  from_contact_id: number | null;
  company_id: number | null;
  referred_name: string | null;
  deal_id: number | null;
  introduced_on: string;
  thanked_at: string | null;
  from: string | null;
  from_title: string | null;
  from_company: string | null;
  to: string | null;
  deal: string | null;
  deal_amount: number | string | null;
  deal_state: string | null;
}

/** What came of an introduction, as far as this reader may see: a deal that does not arrive (somebody else's open deal) is "hidden", not "none". */
export function referralState(dealId: number | null, dealState: string | null): ReferralState {
  if (dealId === null) return "none";
  return dealState === "won" || dealState === "open" || dealState === "lost" ? dealState : "hidden";
}

const referralOf = (row: ReferralRow): Referral => ({
  id: row.id,
  fromId: row.from_contact_id,
  from: row.from,
  fromTitle: row.from_title,
  fromCompany: row.from_company,
  toId: row.company_id,
  to: row.to ?? row.referred_name,
  dealId: row.deal_id,
  deal: row.deal,
  dealAmount: row.deal_amount === null || row.deal_amount === undefined ? null : num(row.deal_amount),
  state: referralState(row.deal_id, row.deal_state),
  introducedOn: row.introduced_on,
  thankedAt: row.thanked_at,
});

const REFERRAL_QUERY = {
  select: ["id", "from_contact_id", "company_id", "referred_name", "deal_id", "introduced_on", "thanked_at"],
  lookup: ["from:from_contact_id.name", "from_title:from_contact_id.job_title", "from_company:from_contact_id.company_id.name", "to:company_id.name", "deal:deal_id.name", "deal_amount:deal_id.amount", "deal_state:deal_id.state"],
};

export async function readReferrals(session: StaffSession, today: string): Promise<Referrals> {
  const [page, lastYear, thanked, nowhere] = await Promise.all([
    session.list<ReferralRow>("referrals", { ...REFERRAL_QUERY, order: ["introduced_on.desc", "id.desc"], limit: LISTED, count: "exact" }),
    single(session, "referrals", [{ column: "introduced_on", op: "gte", value: yearBack(today) }]),
    single(session, "referrals", [{ column: "thanked_at", op: "not_null" }]),
    single(session, "referrals", [{ column: "deal_id", op: "is_null" }]),
  ]);
  const rows = page.rows.map(referralOf);
  const dealIds = [...new Set(rows.flatMap((row) => (row.dealId === null ? [] : [row.dealId])))];
  // What the introductions' deals come to, by how they stand: the server's sums over the deals this reader can open.
  const byState =
    dealIds.length === 0 || !session.can("deals", "read")
      ? null
      : await session.figure<Grouped>({
          table: "deals",
          shape: "categorical",
          filters: [{ column: "id", op: "in", value: dealIds }],
          groupBy: ["state"],
          aggregations: [
            { fn: "count", alias: "n" },
            { fn: "sum", column: "amount", alias: "amount" },
          ],
        });
  const of = (state: string): { count: number; amount: number } => {
    const values = byState?.items.find((item) => String(item.key) === state)?.values;
    return { count: num(values?.["n"]), amount: num(values?.["amount"]) };
  };
  const total = page.total ?? rows.length;
  return { total, lastYear: lastYear ?? 0, thanked: thanked ?? 0, nowhere: nowhere ?? 0, won: byState === null && dealIds.length > 0 ? null : of("won"), open: byState === null && dealIds.length > 0 ? null : of("open"), rows, cut: total > rows.length };
}

/**
 * SAY THANK YOU: the moment is kept on the introduction (`thanked_at`), and
 * only while nobody has thanked yet (`seen`), so two people pressing at once
 * make one thanks. A reply that is lost is read back before anything is
 * said: an introduction that reads as thanked was thanked, by this press or
 * by a colleague's, and either way it is not asked again.
 */
export async function sayThanks(session: StaffSession, id: number): Promise<{ state: "thanked"; at: string; mine: boolean } | { state: "refused"; error: StaffError } | { state: "unknown" }> {
  const at = session.now().toISOString();
  const saved = await session.update<{ thanked_at: string | null }>("referrals", id, { thanked_at: at }, { seen: { thanked_at: null } });
  if (saved.state === "saved" && saved.row.thanked_at != null) return { state: "thanked", at: saved.row.thanked_at, mine: true };
  if (saved.state === "refused" && saved.error.status !== 409) return saved;
  // Refused because it changed, or nothing certain came back: what does the row say now?
  const row = await session.get<{ thanked_at: string | null }>("referrals", id).catch(() => undefined);
  if (row === undefined) return saved.state === "refused" ? saved : { state: "unknown" };
  if (row !== null && row.thanked_at != null) return { state: "thanked", at: row.thanked_at, mine: saved.state !== "refused" || Math.abs(Date.parse(row.thanked_at) - Date.parse(at)) < 1000 };
  return saved.state === "refused" ? saved : { state: "unknown" };
}

// ── the account manager's home ────────────────────────────────────────────────

export interface AmHome {
  ideas: Idea[];
  ideaCount: number;
  room: number;
  ready: number;
  /** Introductions nobody has thanked for yet, the oldest first. */
  toThank: Referral[];
  toThankCount: number;
  introductions: number;
  reorders: number;
  typical: number | null;
  cut: boolean;
}

export async function readAmHome(session: StaffSession, today: string): Promise<AmHome> {
  const referrals = session.can("referrals", "read");
  const [{ ideas, total }, figures, toThank, toThankCount, introductions, reorders, typical] = await Promise.all([
    openIdeas(session, today),
    ideaFigures(session, today),
    referrals ? session.list<ReferralRow>("referrals", { ...REFERRAL_QUERY, where: { column: "thanked_at", op: "is_null" }, order: ["introduced_on", "id"], limit: 20 }) : Promise.resolve(null),
    referrals ? single(session, "referrals", [{ column: "thanked_at", op: "is_null" }]) : Promise.resolve(null),
    referrals ? single(session, "referrals", [{ column: "introduced_on", op: "gte", value: yearBack(today) }]) : Promise.resolve(null),
    single(session, "renewals", [REORDER, OPEN_RENEWAL]),
    single(session, "renewals", [REORDER, OPEN_RENEWAL], { fn: "avg", column: "est_value" }),
  ]);
  return {
    ideas,
    ideaCount: figures.count,
    room: figures.room,
    ready: figures.ready,
    toThank: (toThank?.rows ?? []).map(referralOf),
    toThankCount: toThankCount ?? 0,
    introductions: introductions ?? 0,
    reorders: reorders ?? 0,
    typical,
    cut: total > ideas.length,
  };
}
