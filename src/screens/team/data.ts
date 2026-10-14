/**
 * WHAT THE MANAGER'S SCREENS SHARE: who the reps are, the stages, the days a
 * deal may sit, and the moments those days are counted from.
 *
 * WHO ADDS UP. Nothing here adds rows. A count, a sum or an average is a
 * figure the server worked out for the reader's own rows (a sales manager's
 * are her team's). What this file does with them is what the plan allows a
 * browser: divide one figure by another, compare two, and subtract a moment
 * from the server's clock.
 */
import { useMemo } from "react";

import { useI18n } from "../../i18n/index.tsx";
import { addDays, formatters, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { canOpen, type MenuFacts, type PartId, type RouteKey } from "../../shell/routes.ts";
import { isBuilt } from "../../shell/screens.tsx";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { noValue } from "../../staffSession.ts";

export const OPEN: Condition = { column: "state", op: "eq", value: "open" };
/** A stage's dot and bar take their colour from its place in the order, never from its name: stages are the install's to rename. */
export const TONES = ["neutral", "info", "accent", "warn", "pos"] as const;
export const toneOf = (index: number): string => TONES[Math.min(index, TONES.length - 1)]!;

export const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);

export interface Stage extends Record<string, unknown> {
  id: number;
  label: string;
  odds: number | string;
}

export interface People {
  /** The people with a rep's profile, in the order the profiles were made: ids. */
  reps: string[];
  names: Record<string, string>;
}

export interface Days {
  warm: number;
  stale: number;
  quiet: number;
  stuck: number;
  soon: number;
  /** The settings row, for a save that names what it saw; null when the reader may not read it. */
  row: (Record<string, unknown> & { id: number }) | null;
}

export const stagesOf = (session: StaffSession): Promise<Stage[]> => session.list<Stage>("stages", { select: ["id", "label", "odds"], order: ["position"], limit: 50 }).then((page) => page.rows);

/**
 * The reps and everybody's name. A group by a staff column answers ids; the
 * names come from here. Read once and kept a minute: who the reps are does not
 * change while a figure is read again after a colleague's change, and a
 * person's requests are counted.
 */
const KEPT = new WeakMap<StaffSession, { at: number; people: Promise<People> }>();
const KEEP_MS = 60_000;
export function peopleOf(session: StaffSession): Promise<People> {
  const kept = KEPT.get(session);
  if (kept !== undefined && Date.now() - kept.at < KEEP_MS) return kept.people;
  const people = readPeople(session);
  KEPT.set(session, { at: Date.now(), people });
  // A read that failed is not kept: the next look asks again.
  people.catch(() => KEPT.delete(session));
  return people;
}
async function readPeople(session: StaffSession): Promise<People> {
  const me = session.config.user;
  const [reps, people] = await Promise.all([
    session.list<{ user_id: string }>("reps", { select: ["user_id"], order: ["id"], limit: 200 }).then((page) => page.rows.map((row) => row.user_id)),
    session.people(undefined, 200).catch(() => []),
  ]);
  const names: Record<string, string> = me === null ? {} : { [me.id]: me.name };
  for (const person of people) names[person.id] = person.name;
  return { reps, names };
}

/** The days the business set: when a sitting deal turns warm and stale, and the three nudge thresholds. */
export async function daysOf(session: StaffSession): Promise<Days> {
  const row = session.can("settings", "read")
    ? await session
        .list<Record<string, unknown> & { id: number }>("settings", { select: ["id", "sitting_warm_days", "sitting_stale_days", "nudge_quiet_days", "nudge_stuck_days", "nudge_soon_days"], limit: 1 })
        .then((page) => page.rows[0] ?? null)
        .catch(() => null)
    : null;
  return {
    warm: num(row?.["sitting_warm_days"]) || 14,
    stale: num(row?.["sitting_stale_days"]) || 30,
    quiet: num(row?.["nudge_quiet_days"]) || 7,
    stuck: num(row?.["nudge_stuck_days"]) || 21,
    soon: num(row?.["nudge_soon_days"]) || 7,
    row,
  };
}

/**
 * The moment before which a deal has been somewhere for `days` whole days or
 * more, by the business's calendar: a deal that entered its stage on the
 * 14th has sat 14 days on the 28th, whatever the hour.
 */
export const before = (f: Formatters, today: string, days: number): string => f.at(addDays(today, 1 - days), "00:00").toISOString();

/** Whole days from a moment to now, by the business's calendar. */
export const daysSince = (f: Formatters, now: Date, moment: string | null): number | null => (moment === null ? null : f.dayDiff(new Date(moment), now));

/** The same day of the month, some months back: `monthsBack("2026-07-28", 12)` is `2025-07-28` (a month too short gives its last day). */
export function monthsBack(dayKey: string, months: number): string {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 - months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${String(first.getUTCFullYear())}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** The first day of the quarter a day falls in. */
export function quarterOf(dayKey: string): string {
  const month = Number(dayKey.slice(5, 7));
  return `${dayKey.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
}

/** A grouped figure as a map from each group's key to its figures by alias. */
export function byKey(figure: Grouped, single?: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const item of figure.items) {
    if (noValue(item.key)) continue;
    const values: Record<string, number> = {};
    for (const [alias, value] of Object.entries(item.values ?? {})) values[alias] = num(value);
    // A figure asked for one number answers it as `value`.
    if (single !== undefined && item.values?.[single] === undefined) values[single] = num(item.value);
    out[String(item.key)] = values;
  }
  return out;
}

export interface Matrix {
  shape: "matrix";
  rowKeys: (string | number | null)[];
  colKeys: (string | number | null)[];
  cells: (number | null)[][];
}

/** A two-way figure as `row → column → figure`. */
export function cellsOf(matrix: Matrix): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  matrix.rowKeys.forEach((row, r) => {
    const cells: Record<string, number> = {};
    matrix.colKeys.forEach((column, c) => {
      const value = matrix.cells[r]?.[c];
      if (typeof value === "number") cells[String(column)] = value;
    });
    out[String(row)] = cells;
  });
  return out;
}

/**
 * Which keys hold the largest figure, and what it is: "mostly at Proposal (4
 * of 6)", or all of a tie. Compares the server's figures; adds nothing.
 */
export function largest(figures: Record<string, number>): { keys: string[]; value: number } {
  let value = 0;
  let keys: string[] = [];
  for (const [key, one] of Object.entries(figures)) {
    if (one > value) [value, keys] = [one, [key]];
    else if (one === value && one > 0) keys.push(key);
  }
  return { keys, value };
}

/** What every one of these screens reads before it draws: the session, the formatters, and which screens the reader can open. */
export function useScreen(): { session: StaffSession; f: Formatters; opens: (route: RouteKey) => boolean; writes: boolean } {
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const facts = useMemo<MenuFacts>(
    () => ({ roles: (config.access?.roles ?? []).map((role) => role.slug), part: (id: PartId) => session.part(id), reads: (table) => session.can(table, "read"), built: isBuilt }),
    [config, session],
  );
  const opens = useMemo(() => (route: RouteKey) => canOpen(route, facts), [facts]);
  // Read-only reads these screens and is offered none of their buttons.
  return { session, f, opens, writes: session.can("deals", "update") };
}
