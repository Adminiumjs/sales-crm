/**
 * THE TEAM'S SCREENS: what they read and write in common, with no drawing in
 * it (`common.tsx` holds the parts they draw with).
 *
 * WHO IS WHO. A screen is told names by Adminium's own list of people, read
 * once per page; the sales reps are the people with a row in `reps`.
 *
 * ONE ACTION LIST. One-to-one notes, the weekly meeting and coaching each
 * show rows of the same table (`actions`). A row says where else it lives by
 * the links it holds, and a tick anywhere is a write to that one row.
 *
 * WHO COUNTS. Nothing here adds rows up. A count is the total the server
 * answers for a list, cut to the rows the reader reaches.
 */
import stages from "../../../stage.json";
import type { Condition, Saved, StaffSession } from "../../staffSession.ts";

export type Names = Record<string, string>;

export interface Who {
  names: Names;
  /** The people with a rep's profile, in the order the server lists them. */
  reps: string[];
  /** Everybody who signs in here, as Adminium lists them. */
  everyone: { id: string; name: string }[];
}

/** Names and the reps: read once per page. Somebody who may not read one of them gets an empty list, and nothing else breaks. */
export async function readWho(session: StaffSession): Promise<Who> {
  const [people, reps] = await Promise.all([
    session.people(undefined, 200).catch(() => []),
    session.can("reps", "read") ? session.list<{ user_id: string }>("reps", { select: ["user_id"], order: ["id"], limit: 200 }).then((page) => page.rows.map((row) => row.user_id)) : Promise.resolve([] as string[]),
  ]);
  return { names: Object.fromEntries(people.map((person) => [person.id, person.name])), reps, everyone: people.map((person) => ({ id: person.id, name: person.name })) };
}

export const NOBODY: Who = { names: {}, reps: [], everyone: [] };

/** The total the server answers for a list: a count of the reader's own rows, asked afresh. */
export const countOf = (session: StaffSession, ref: string, where: Condition): Promise<number> =>
  session.list(ref, { select: ["id"], where, limit: 1, count: "exact" }).then((page) => Number(page.total ?? 0));

export const all = (conditions: Condition[]): Condition => (conditions.length === 1 ? conditions[0]! : { and: conditions });

export const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : 0;
  return Number.isFinite(n) ? n : 0;
};

/** A column that is true on SQLite (1), Postgres (true) and MySQL (1) alike. */
export const truthy = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "true";

export type Source = "one-to-one" | "meeting" | "coaching";

export interface Action extends Record<string, unknown> {
  id: number;
  text: string;
  owner_id: string;
  set_by_id: string | null;
  due_on: string | null;
  done: unknown;
  done_at: string | null;
  source: Source;
  one_to_one_id: number | null;
  meeting_id: number | null;
  coaching_area_id: number | null;
  /** The one-to-one session it came from, where the install keeps that (`sessionLinked`). */
  session_id?: number | null;
}

export const ACTION_COLUMNS = ["id", "text", "owner_id", "set_by_id", "due_on", "done", "done_at", "source", "one_to_one_id", "meeting_id", "coaching_area_id"];

/** Where else a row of the list is shown, beside the screen it is read on. */
export function alsoIn(action: Pick<Action, "one_to_one_id" | "meeting_id" | "coaching_area_id">, here: Source): Source[] {
  const places: Source[] = [];
  if (action.one_to_one_id !== null && action.one_to_one_id !== undefined) places.push("one-to-one");
  if (action.coaching_area_id !== null && action.coaching_area_id !== undefined) places.push("coaching");
  if (action.meeting_id !== null && action.meeting_id !== undefined) places.push("meeting");
  return places.filter((place) => place !== here);
}

/** Tick an action, or take the tick off: one write to the one row, naming what the screen saw. */
export const tickAction = (session: StaffSession, action: Pick<Action, "id" | "done">, done: boolean): Promise<Saved<Action>> =>
  session.update<Action>("actions", action.id, { done }, { seen: { done: truthy(action.done) } });

/**
 * Whether an action keeps the session it came from (`actions.session_id`). The link came with the app's second stage
 * (`stage.json`), so an install of the first stage has no such column: it is asked by the parts the install holds, a
 * part of a later stage being one the first stage has not (switched on or off). A server that does not say has them all.
 */
export function sessionLinked(session: Pick<StaffSession, "config">): boolean {
  const parts = session.config.modules;
  if (parts === null || parts === undefined) return true;
  const first = new Set<string>((stages.stages as Record<string, string[]>)["1"] ?? []);
  return Object.keys(parts).some((part) => !first.has(part));
}

/**
 * The name of a link the server writes child rows through, beside a new row in the same save (a conversation and its
 * people, a starter and her steps): the child table's link column to the parent's key, by their stored names.
 */
export const childLink = (session: Pick<StaffSession, "tableId">, child: string, column: string, parent: string): string => `fk:${session.tableId(child)}(${column})->${session.tableId(parent)}(id)`;
