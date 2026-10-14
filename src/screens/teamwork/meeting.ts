/**
 * THE WEEKLY MEETING: what the screen reads.
 *
 * The meeting, its running order and last week's decisions are everybody's
 * who reads the team part. The figures and the deals each rep brings are cut
 * by the server to the reader's rows: the manager sees the team's, a rep her
 * own. The actions are rows of the one list (`common.tsx`), each reader
 * seeing the ones the server lets them.
 */
import { addDays, monthOf, type Formatters } from "../../lib/format.ts";
import { closedFigures, winRate } from "../../selling/figures.ts";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { ACTION_COLUMNS, countOf, num, type Action } from "./data.ts";

export interface Meeting extends Record<string, unknown> {
  id: number;
  at: string;
  minutes: number;
}
export interface Slot extends Record<string, unknown> {
  id: number;
  label: string;
  who_id: string | null;
  minutes: number;
  position: number;
}
export interface Decision extends Record<string, unknown> {
  id: number;
  text: string;
  who_id: string | null;
  state: "open" | "done" | "carried";
}
export interface Brought {
  id: number;
  name: string;
  amount: number;
}

export interface MeetingData {
  meeting: Meeting;
  slots: Slot[];
  decisions: Decision[];
  actions: Action[];
  numbers: {
    weighted: number;
    deals: number;
    monthWeighted: number;
    monthDeals: number;
    /** Won out of all that closed in the twelve months to today; null when nothing closed. */
    rate: number | null;
    won: number;
    closed: number;
    /** Average whole days a won deal was open; null when none was won. */
    cycle: number | null;
    /** Null when the reader may not read the setting that says what stale is. */
    stale: number | null;
  };
  /** How many open deals each person has, and the two each brings: the biggest and the longest in its stage. */
  inPlay: Record<string, number>;
  brings: Record<string, Brought[]>;
}

/** The next meeting from today on; when none is to come, the last one held. */
export async function readMeeting(session: StaffSession, now: Date, f: Formatters): Promise<MeetingData | null> {
  const today = f.dayKey(now);
  const from = f.at(today, "00:00").toISOString();
  const coming = await session.list<Meeting>("meetings", { select: ["id", "at", "minutes"], where: { column: "at", op: "gte", value: from }, order: ["at"], limit: 1 });
  const meeting = coming.rows[0] ?? (await session.list<Meeting>("meetings", { select: ["id", "at", "minutes"], order: ["at.desc"], limit: 1 })).rows[0];
  if (meeting === undefined) return null;
  const mine: Condition = { column: "meeting_id", op: "eq", value: meeting.id };
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const month = monthOf(f.dayKey(new Date(meeting.at)));
  const inMonth: Condition = { column: "expected_close", op: "between", value: month };
  const one = (filters: Condition[], fn: "sum" | "count", column?: string): Promise<{ value: number | null }> =>
    session.figure<{ value: number | null }>({ table: "deals", shape: "single-metric", filters, aggregations: [{ fn, ...(column === undefined ? {} : { column }), alias: "v" }] });
  const deals = session.can("deals", "read");
  const zero = Promise.resolve({ value: 0 });
  const settings = session.can("settings", "read") ? session.list<{ sitting_stale_days: number | null }>("settings", { select: ["sitting_stale_days"], limit: 1 }).then((page) => page.rows[0]?.sitting_stale_days ?? null, () => null) : Promise.resolve(null);
  const [slots, decisions, actions, weighted, count, monthWeighted, monthCount, closed, staleDays, byOwner, list] = await Promise.all([
    session.list<Slot>("meeting_slots", { select: ["id", "label", "who_id", "minutes", "position"], where: mine, order: ["position", "id"], limit: 50 }),
    session.list<Decision>("meeting_decisions", { select: ["id", "text", "who_id", "state"], where: mine, order: ["id"], limit: 50 }),
    session.can("actions", "read") ? session.list<Action>("actions", { select: ACTION_COLUMNS, where: mine, order: ["id"], limit: 200 }).then((page) => page.rows) : Promise.resolve([] as Action[]),
    deals ? one([open], "sum", "weighted_value") : zero,
    deals ? one([open], "count") : zero,
    deals ? one([open, inMonth], "sum", "weighted_value") : zero,
    deals ? one([open, inMonth], "count") : zero,
    deals ? closedFigures(session, { between: [addDays(today, -365), today] }) : Promise.resolve(null),
    settings,
    deals ? session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [open], groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }] }) : Promise.resolve(null),
    deals ? session.list<{ id: number; name: string; amount: number | string | null; owner_id: string; entered_stage_at: string | null }>("deals", { select: ["id", "name", "amount", "owner_id", "entered_stage_at"], where: open, order: ["amount.desc", "id"], limit: 200 }).then((page) => page.rows) : Promise.resolve([]),
  ]);
  const stale = !deals || staleDays === null ? null : await countOf(session, "deals", { and: [open, { column: "entered_stage_at", op: "lte", value: new Date(now.getTime() - Number(staleDays) * 86_400_000).toISOString() }] });
  const inPlay: Record<string, number> = {};
  for (const item of byOwner?.items ?? []) if (item.key !== null) inPlay[String(item.key)] = num(item.values?.["n"] ?? item.value);
  const brings: Record<string, Brought[]> = {};
  for (const owner of new Set(list.map((deal) => deal.owner_id))) {
    const theirs = list.filter((deal) => deal.owner_id === owner);
    // The list comes largest first; the longest in its stage is the one that entered it earliest.
    const biggest = theirs[0];
    const sitting = [...theirs].filter((deal) => deal.entered_stage_at !== null).sort((a, b) => Date.parse(a.entered_stage_at!) - Date.parse(b.entered_stage_at!))[0];
    brings[owner] = [biggest, sitting].filter((deal, at, both) => deal !== undefined && both.indexOf(deal) === at).map((deal) => ({ id: deal!.id, name: deal!.name, amount: num(deal!.amount) }));
  }
  return {
    meeting,
    slots: slots.rows,
    decisions: decisions.rows,
    actions,
    numbers: {
      weighted: num(weighted.value),
      deals: num(count.value),
      monthWeighted: num(monthWeighted.value),
      monthDeals: num(monthCount.value),
      rate: closed === null ? null : winRate(closed),
      won: closed?.won.count ?? 0,
      closed: closed === null ? 0 : closed.won.count + closed.lost.count,
      cycle: closed?.won.cycle ?? null,
      stale,
    },
    inPlay,
    brings,
  };
}
