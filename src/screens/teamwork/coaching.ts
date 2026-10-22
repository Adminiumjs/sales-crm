/**
 * COACHING: what the screen reads and saves, with no drawing in it.
 *
 * PRIVATE TO ITS TWO PEOPLE, as `notes.ts` says: a plan and its areas are read
 * by the rep and the manager they name, and written by the manager.
 *
 * THE LIVE NUMBER (T04). An area may say which number it is measured by
 * (`coaching_areas.measure`). The number is a figure the server answers over
 * the rep's own deals and queue (`owner_id` is the rep), so the rep and her
 * manager read the same number: nothing is added up here, and an average or a
 * share is the server's figure, or two of its counts divided.
 */
import { addDays } from "../../lib/format.ts";
import { closedFigures, winRate } from "../../selling/figures.ts";
import type { Condition, Saved, StaffSession } from "../../staffSession.ts";
import { countOf, num } from "./data.ts";

export const MEASURES = ["late", "deals", "average", "first_stage", "win_rate", "cycle"] as const;
export type Measure = (typeof MEASURES)[number];

export interface Area extends Record<string, unknown> {
  id: number;
  plan_id: number;
  title: string;
  position: number;
  why?: string | null;
  good_looks_like?: string | null;
  measure?: Measure | null;
}
export const AREA_COLUMNS = ["id", "plan_id", "title", "position", "why", "good_looks_like", "measure"];

/** A number as the screen draws it: a count, an amount of money, a share or a number of days, and what it is of. */
export type Live = { kind: "count"; value: number; stage?: string } | { kind: "money"; value: number } | { kind: "share"; value: number } | { kind: "days"; value: number };

/**
 * The area's number now, or null where it has none, the reader may not read what it counts, or nothing has closed yet.
 * `today` is the business's day, `now` the server's moment.
 */
export async function liveOf(session: StaffSession, measure: Measure | null | undefined, rep: string, now: Date, today: string): Promise<Live | null> {
  if (measure === null || measure === undefined) return null;
  const hers: Condition = { column: "owner_id", op: "eq", value: rep };
  const open: Condition = { column: "state", op: "eq", value: "open" };
  if (measure === "late") {
    if (!session.can("follow_ups", "read")) return null;
    const late = await countOf(session, "follow_ups", { and: [hers, { column: "kind", op: "eq", value: "step" }, { column: "done", op: "eq", value: false }, { column: "due_at", op: "lt", value: now.toISOString() }] });
    return { kind: "count", value: late };
  }
  if (!session.can("deals", "read")) return null;
  if (measure === "deals") return { kind: "count", value: await countOf(session, "deals", { and: [hers, open] }) };
  if (measure === "average") {
    const answer = await session.figure<{ value: number | string | null }>({ table: "deals", shape: "single-metric", filters: [hers, open], aggregations: [{ fn: "avg", column: "amount", alias: "v" }] });
    return answer.value === null ? null : { kind: "money", value: num(answer.value) };
  }
  if (measure === "first_stage") {
    if (!session.can("stages", "read")) return null;
    const first = (await session.list<{ id: number; label: string }>("stages", { select: ["id", "label"], order: ["position", "id"], limit: 1 })).rows[0];
    if (first === undefined) return null;
    return { kind: "count", value: await countOf(session, "deals", { and: [hers, open, { column: "stage_id", op: "eq", value: first.id }] }), stage: first.label };
  }
  const closed = await closedFigures(session, { owner: rep, between: [addDays(today, -365), today] });
  if (measure === "win_rate") {
    const share = winRate(closed);
    return share === null ? null : { kind: "share", value: share };
  }
  return closed.won.cycle === null ? null : { kind: "days", value: Math.round(closed.won.cycle) };
}

export interface AreaValues {
  title: string;
  why: string;
  good_looks_like: string;
  measure: Measure | "";
}

/** The columns an area is saved with: an empty line is no line, and no measure is no number. */
export function areaRow(values: AreaValues): Record<string, unknown> {
  const text = (value: string): string | null => (value.trim() === "" ? null : value.trim());
  return { title: values.title.trim(), why: text(values.why), good_looks_like: text(values.good_looks_like), measure: values.measure === "" ? null : values.measure };
}

/** A new area of a plan, after its last one. Whose it is comes from the plan: its rep, and the manager who writes it. */
export const makeArea = (session: StaffSession, plan: { id: number; rep_id: string; manager_id: string }, values: AreaValues, position: number, key: string): Promise<Saved<Area>> =>
  session.create<Area>("coaching_areas", { plan_id: plan.id, rep_id: plan.rep_id, manager_id: plan.manager_id, position, ...areaRow(values) }, key);

/** An area renamed (and its why, what good looks like and number changed): one change, naming the title the screen saw. */
export const changeArea = (session: StaffSession, area: Area, values: AreaValues): Promise<Saved<Area>> => session.update<Area>("coaching_areas", area.id, areaRow(values), { seen: { title: area.title } });
