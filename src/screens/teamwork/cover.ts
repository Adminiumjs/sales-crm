/**
 * COVER: what the screen reads, and how a cover is made, re-dated, ended and
 * cancelled.
 *
 * WHAT THE SERVER HOLDS, whatever this screen offers: one cover at a time for
 * the person away (an overlap is refused); the sales manager makes one where
 * both people are ones she leads, the CRM admin for anybody who reads deals;
 * the covering rep reads the lent deals from the cover's first day to its
 * last, and not a day sooner or later. Before her first day she is shown the
 * dates and who, and nothing of the deals: this file asks for nothing of them
 * then, and the server would answer nothing if it did.
 *
 * WHO COUNTS. Every count here is the total the server answers for a list
 * of the reader's rows; every sum is a figure of the server's.
 */
import type { Formatters } from "../../lib/format.ts";
import { addDays } from "../../lib/format.ts";
import { LostReply, StaffError, type Condition, type Grouped, type Saved, type StaffSession } from "../../staffSession.ts";
import { all, countOf, num } from "./data.ts";

export interface Cover extends Record<string, unknown> {
  id: number;
  owner_id: string;
  cover_id: string;
  starts_on: string;
  ends_on: string | null;
}

export type CoverState = "coming" | "running" | "over";

/** A day as the server keeps it, whatever the engine answers (`2026-08-10` or a whole moment). */
export const dayOf = (value: string | null | undefined): string | null => (value === null || value === undefined || value === "" ? null : value.slice(0, 10));

/** Where a cover stands on a day: still to come, running (its last day included), or over. */
export function coverState(cover: Pick<Cover, "starts_on" | "ends_on">, today: string): CoverState {
  const from = dayOf(cover.starts_on)!;
  const to = dayOf(cover.ends_on);
  if (today < from) return "coming";
  return to !== null && today > to ? "over" : "running";
}

/** Monday to Friday between two days, both counted. */
export function workingDays(from: string, to: string): number {
  let days = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

export const COVER_COLUMNS = ["id", "owner_id", "cover_id", "starts_on", "ends_on"];

/** Every cover the reader reaches, the earliest first. */
export const readCovers = (session: StaffSession): Promise<Cover[]> =>
  session.list<Cover>("covers", { select: COVER_COLUMNS, order: ["starts_on", "id"], limit: 200 }).then((page) => page.rows.map((row) => ({ ...row, starts_on: dayOf(row.starts_on)!, ends_on: dayOf(row.ends_on) })));

export interface LentDeal extends Record<string, unknown> {
  id: number;
  name: string;
  amount: number | string | null;
  expected_close: string | null;
  stage_id: number;
  company: string | null;
  stage: string | null;
}
export interface Step extends Record<string, unknown> {
  id: number;
  deal_id: number | null;
  due_at: string;
  text: string;
  deal: string | null;
}
export interface WindowVisit extends Record<string, unknown> {
  id: number;
  starts_at: string;
  purpose: string;
  company: string | null;
}
export interface Note extends Record<string, unknown> {
  id: number;
  cover_id: number;
  deal_id: number;
  text: string;
}
export interface Other {
  id: string;
  deals: number;
  amount: number;
  closing: number;
}

export interface Lent {
  deals: LentDeal[];
  count: number;
  /** The server's sum of the lent deals' amounts. */
  amount: number;
  closing: number;
  steps: Step[];
  stepCount: number;
  stepsLate: number;
  stepsInWindow: number;
  visits: WindowVisit[];
  visitCount: number;
  notes: Note[];
  /** The other reps over the same days; empty for somebody who reads only her own deals. */
  others: Other[];
}

/** The last day of a cover for a filter: an open end reaches as far as a date goes. */
const lastDay = (cover: Pick<Cover, "ends_on">): string => cover.ends_on ?? "9999-12-31";

/**
 * What a cover lends: the open deals of the person away, what closes and
 * falls due while they are away, the visits already booked, and the briefing
 * notes. Read as the person signed in: the covering rep gets all of it from
 * the cover's first day, the person away gets her own, the manager her
 * team's.
 */
export async function readLent(session: StaffSession, cover: Cover, now: Date, f: Formatters, team: boolean): Promise<Lent> {
  const mine: Condition[] = [{ column: "owner_id", op: "eq", value: cover.owner_id }, { column: "state", op: "eq", value: "open" }];
  const window: [string, string] = [cover.starts_on, lastDay(cover)];
  const from = f.at(cover.starts_on, "00:00").toISOString();
  const until = cover.ends_on === null ? "9999-12-31T00:00:00.000Z" : f.at(addDays(cover.ends_on, 1), "00:00").toISOString();
  const steps: Condition[] = [{ column: "owner_id", op: "eq", value: cover.owner_id }, { column: "done", op: "eq", value: false }, { column: "kind", op: "eq", value: "step" }];
  const visits: Condition[] = [{ column: "rep_id", op: "eq", value: cover.owner_id }, { column: "starts_at", op: "gte", value: from }, { column: "starts_at", op: "lt", value: until }];
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const byOwner = (filters: Condition[]): Promise<Grouped> =>
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters, groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "amount" }] });
  const [deals, sum, closing, stepPage, stepsLate, stepsInWindow, visitPage, notes, everyone, everyoneClosing] = await Promise.all([
    session.list<LentDeal>("deals", { select: ["id", "name", "amount", "expected_close", "stage_id"], where: all(mine), lookup: ["company:company_id.name", "stage:stage_id.label"], order: ["amount.desc", "id"], limit: 200, count: "exact" }),
    session.figure<{ value: number | null }>({ table: "deals", shape: "single-metric", filters: mine, aggregations: [{ fn: "sum", column: "amount", alias: "amount" }] }),
    countOf(session, "deals", all([...mine, { column: "expected_close", op: "between", value: window }])),
    session.can("follow_ups", "read")
      ? session.list<Step>("follow_ups", { select: ["id", "deal_id", "due_at", "text"], where: all(steps), lookup: ["deal:deal_id.name"], order: ["due_at", "id"], limit: 200, count: "exact" })
      : Promise.resolve({ rows: [] as Step[], total: 0, next: null }),
    session.can("follow_ups", "read") ? countOf(session, "follow_ups", all([...steps, { column: "due_at", op: "lt", value: now.toISOString() }])) : Promise.resolve(0),
    session.can("follow_ups", "read") ? countOf(session, "follow_ups", all([...steps, { column: "due_at", op: "gte", value: from }, { column: "due_at", op: "lt", value: until }])) : Promise.resolve(0),
    session.can("site_visits", "read")
      ? session.list<WindowVisit>("site_visits", { select: ["id", "starts_at", "purpose"], where: all(visits), lookup: ["company:deal_id.company_id.name"], order: ["starts_at"], limit: 100, count: "exact" })
      : Promise.resolve({ rows: [] as WindowVisit[], total: 0, next: null }),
    session.can("cover_notes", "read") ? session.list<Note>("cover_notes", { select: ["id", "cover_id", "deal_id", "text"], where: { column: "cover_id", op: "eq", value: cover.id }, limit: 200 }).then((page) => page.rows) : Promise.resolve([] as Note[]),
    team ? byOwner([open]) : Promise.resolve(null),
    team ? byOwner([open, { column: "expected_close", op: "between", value: window }]) : Promise.resolve(null),
  ]);
  const others: Other[] =
    everyone === null
      ? []
      : everyone.items
          .filter((item) => item.key !== null && String(item.key) !== cover.owner_id)
          .map((item) => ({
            id: String(item.key),
            deals: num(item.values?.["n"] ?? item.value),
            amount: num(item.values?.["amount"]),
            closing: num(everyoneClosing?.items.find((one) => String(one.key) === String(item.key))?.values?.["n"]),
          }));
  return {
    deals: deals.rows,
    count: Number(deals.total ?? deals.rows.length),
    amount: num(sum.value),
    closing,
    steps: stepPage.rows,
    stepCount: Number(stepPage.total ?? stepPage.rows.length),
    stepsLate,
    stepsInWindow,
    visits: visitPage.rows,
    visitCount: Number(visitPage.total ?? visitPage.rows.length),
    notes,
    others,
  };
}

/** End a cover today: the deals stay lent through today and leave tomorrow. Names the last day the screen saw. */
export const endToday = (session: StaffSession, cover: Cover, today: string): Promise<Saved<Cover>> => session.update<Cover>("covers", cover.id, { ends_on: today }, { seen: { ends_on: cover.ends_on } });

/**
 * Cancel a cover that has not started: its briefing notes first (the server
 * keeps a cover that still has notes), then the cover. A reply lost on the
 * way back is read back by the session, so a second press finds nothing left
 * to cancel and says so once.
 */
export async function cancelCover(session: StaffSession, cover: Cover): Promise<Saved> {
  if (session.can("cover_notes", "read")) {
    const notes = await session.list<Note>("cover_notes", { select: ["id"], where: { column: "cover_id", op: "eq", value: cover.id }, limit: 200 });
    for (const note of notes.rows) {
      const gone = await session.remove("cover_notes", note.id);
      if (gone.state !== "saved" && !(gone.state === "refused" && gone.error.status === 404)) return gone;
    }
  }
  const removed = await session.remove("covers", cover.id);
  if (removed.state === "refused" && removed.error.status === 404) return { state: "saved", row: {}, replayed: true, readBack: true };
  return removed;
}

/**
 * Make a cover. NOT with the client key every other create carries: Adminium
 * takes no keyed create on a table whose rows hold a span of days (it answers
 * 409, "written one at a time"). So a lost reply is handled by the rule the
 * table already keeps: one cover at a time for the person away. After a lost
 * reply the cover is looked for (the same two people, the same first day);
 * found, it was made. Sent again while the first is there, the server refuses
 * the second as overlapping, and the first is read back and said once.
 */
export async function makeCover(session: StaffSession, values: { owner_id: string; cover_id: string; starts_on: string; ends_on: string | null }, wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<Saved<Cover>> {
  const path = `/data/${encodeURIComponent(session.connectionId)}/${encodeURIComponent(session.tableId("covers"))}`;
  const find = async (): Promise<Cover | null> => {
    const page = await session.list<Cover>("covers", { select: COVER_COLUMNS, where: all([{ column: "owner_id", op: "eq", value: values.owner_id }, { column: "cover_id", op: "eq", value: values.cover_id }, { column: "starts_on", op: "eq", value: values.starts_on }]), limit: 1 });
    const row = page.rows[0];
    return row === undefined ? null : { ...row, starts_on: dayOf(row.starts_on)!, ends_on: dayOf(row.ends_on) };
  };
  let lost = false;
  for (const pause of [400, 1500, 0]) {
    try {
      const doc = await session.call<{ data: Cover }>("POST", path, { values });
      return { state: "saved", row: doc.data, replayed: false, readBack: false };
    } catch (error) {
      if (error instanceof StaffError) {
        if (lost && error.code === "BOOKING_TAKEN") {
          const made = await find().catch(() => null);
          if (made !== null) return { state: "saved", row: made, replayed: true, readBack: true };
        }
        return { state: "refused", error };
      }
      if (!(error instanceof LostReply)) throw error;
      lost = true;
      if (pause === 0) break;
      await wait(pause);
      try {
        const made = await find();
        if (made !== null) return { state: "saved", row: made, replayed: false, readBack: true };
      } catch (inner) {
        if (inner instanceof StaffError) return { state: "refused", error: inner };
        if (!(inner instanceof LostReply)) throw inner;
      }
    }
  }
  return { state: "unknown" };
}
