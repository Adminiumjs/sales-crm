/**
 * SETTINGS: what the screen reads, and the few things it works out.
 *
 * The settings are ONE row. Who may write which of its columns is the
 * server's to say (the manifest's `limits.settings.writable` for the sales
 * manager; every column for the CRM admin). The app's config says only that a
 * person may update the table, not which columns, so the manager's eight are
 * listed here too, and a test holds this list to the manifest's.
 *
 * WHO ADDS UP. Counts and sums come from the server. What is worked out here
 * is arithmetic on the settings themselves (the hours between two times of
 * day, a week's hours) and the walk along a calendar that counts working days.
 */
import { addDays, type Formatters } from "../../lib/format.ts";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { byKey } from "../team/data.ts";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

/** The columns that say how the team sells: the only ones a sales manager writes. Held to the manifest by `data.test.ts`. */
export const MANAGER_WRITES: readonly string[] = ["approval_threshold_pct", "quote_valid_days", "quote_warn_days", "sitting_warm_days", "sitting_stale_days", "nudge_quiet_days", "nudge_stuck_days", "nudge_soon_days"];

/** The least and the most each number takes, as the server holds them (the manifest's `validation`). Held to the manifest by `data.test.ts`. */
export const BOUNDS: Record<string, readonly [number, number]> = {
  approval_threshold_pct: [0, 50],
  quote_valid_days: [1, 365],
  quote_warn_days: [0, 30],
  sitting_warm_days: [1, 364],
  sitting_stale_days: [2, 365],
  nudge_quiet_days: [3, 21],
  nudge_stuck_days: [7, 45],
  nudge_soon_days: [3, 30],
  working_day_hours: [4, 12],
  lead_cold_days: [1, 365],
};

export interface Place {
  lat: number;
  lng: number;
  by: "town" | "exact";
  name?: string;
}

export interface SettingsRow extends Record<string, unknown> {
  id: number;
  week_starts: Day;
  work_from: string;
  work_to: string;
  distance_unit: "km" | "miles";
  depot_name: string | null;
  depot_address: string | null;
  depot_town: string | null;
  depot_region: string | null;
  depot_postal_code: string | null;
  depot_country: string | null;
  depot_place: Place | string | null;
}

export const SETTINGS_COLUMNS = [
  "id", ...MANAGER_WRITES, "lead_cold_days", "working_day_hours", "week_starts", ...DAYS.map((day) => `work_${day}`), "work_from", "work_to",
  "depot_name", "depot_address", "depot_town", "depot_region", "depot_postal_code", "depot_country", "depot_lat", "depot_lng", "depot_place", "distance_unit",
];

export const readSettings = (session: StaffSession): Promise<SettingsRow | null> => session.list<SettingsRow>("settings", { select: SETTINGS_COLUMNS, limit: 1 }).then((page) => page.rows[0] ?? null);

const truthy = (value: unknown): boolean => value === true || value === 1 || value === "1";
export const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);

/** The days the business works, from a settings row. Monday to Friday when the row is not there or says nothing (an install from before the setting). */
export function workDaysOf(row: Record<string, unknown> | null | undefined): Set<Day> {
  if (row === null || row === undefined || DAYS.every((day) => row[`work_${day}`] === undefined || row[`work_${day}`] === null)) return new Set<Day>(["mon", "tue", "wed", "thu", "fri"]);
  const days = new Set<Day>(DAYS.filter((day) => truthy(row[`work_${day}`])));
  // A week with no working day counts nothing and would never end a count: read it as the usual week.
  return days.size === 0 ? new Set<Day>(["mon", "tue", "wed", "thu", "fri"]) : days;
}

/** The weekday of a calendar day: `2026-07-28` is `tue`. */
export const dayOfKey = (dayKey: string): Day => DAYS[(new Date(`${dayKey}T12:00:00Z`).getUTCDay() + 6) % 7]!;

/** Working days from one calendar day to another, both counted, by the business's working week. */
export function workingDaysBetween(from: string, to: string, days: ReadonlySet<Day>): number {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) if (days.has(dayOfKey(day))) count += 1;
  return count;
}

/**
 * The business's working days, read once a page and kept a minute: the
 * setting changes a few times a year, and a person's requests are counted. A
 * reader who may not read the settings counts Monday to Friday.
 */
const KEPT = new WeakMap<StaffSession, { at: number; days: Promise<Set<Day>> }>();
export function workWeek(session: StaffSession, fresh = false): Promise<Set<Day>> {
  const kept = KEPT.get(session);
  if (!fresh && kept !== undefined && Date.now() - kept.at < 60_000) return kept.days;
  const days = session.can("settings", "read")
    ? session
        .list<Record<string, unknown>>("settings", { select: ["id", ...DAYS.map((day) => `work_${day}`)], limit: 1 })
        .then((page) => workDaysOf(page.rows[0]))
        .catch(() => workDaysOf(null))
    : Promise.resolve(workDaysOf(null));
  KEPT.set(session, { at: Date.now(), days });
  return days;
}

/** The seven days in the order of a week that starts on `first`. */
export function weekFrom(first: Day): Day[] {
  const at = DAYS.indexOf(first);
  return [...DAYS.slice(at), ...DAYS.slice(0, at)];
}

/** A time of day as the server keeps it: `08:30`. */
export const isTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** The hours between two times of one day; null when the day does not end after it starts. */
export function hoursBetween(from: string, to: string): number | null {
  if (!isTime(from) || !isTime(to) || minutes(to) <= minutes(from)) return null;
  return (minutes(to) - minutes(from)) / 60;
}

/** A place as the server keeps it (an object on every engine), or null. */
export function placeOf(value: unknown): Place | null {
  let doc: unknown = value;
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc);
    } catch {
      return null;
    }
  }
  if (doc === null || typeof doc !== "object") return null;
  const place = doc as Record<string, unknown>;
  const lat = Number(place["lat"]);
  const lng = Number(place["lng"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, by: place["by"] === "exact" ? "exact" : "town", ...(typeof place["name"] === "string" ? { name: place["name"] } : {}) };
}

/** What a number field holds when its text is read: the number, or why not. */
export function readNumber(text: string, bounds: readonly [number, number], whole: boolean): number | null {
  const clean = text.trim().replace(",", ".");
  if (clean === "" || !/^\d+(\.\d+)?$/.test(clean)) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < bounds[0] || value > bounds[1] || (whole && !Number.isInteger(value))) return null;
  return value;
}

export interface StageRow extends Record<string, unknown> {
  id: number;
  label: string;
  odds: number | string;
  position: number;
}
export interface ReasonRow extends Record<string, unknown> {
  id: number;
  label: string;
  position: number;
}
export interface PriceRow extends Record<string, unknown> {
  id: number;
  name: string;
  list_rate: number | string;
  active: boolean | number;
}
export interface RepRow extends Record<string, unknown> {
  id: number;
  user_id: string;
  hours_from: string | null;
  hours_to: string | null;
}

const OPEN: Condition = { column: "state", op: "eq", value: "open" };

export interface SellingData {
  settings: SettingsRow | null;
  stages: StageRow[];
  reasons: ReasonRow[];
  /** Per stage id: the open deals in it and their weighted value, and every deal that names it (a stage that holds any cannot be removed). */
  byStage: Record<string, { open: number; weighted: number; all: number }>;
  open: number;
  weighted: number;
  /** Per lost reason id: the lost deals that give it. */
  byReason: Record<string, number>;
  lost: number;
  warm: number;
  stale: number;
  caught: { quiet: number; stuck: number; soon: number };
}

/** The start of the day `days` whole days back, as the server's clock reads it where the business is. */
const before = (f: Formatters, today: string, days: number): string => f.at(addDays(today, 1 - days), "00:00").toISOString();

/**
 * Everything the Selling tab shows, in two requests' worth of rows and one
 * batch of figures. Every count is the server's, for the rows the reader
 * reaches: a manager's are her team's deals, the CRM admin's everybody's.
 */
export async function readSelling(session: StaffSession, f: Formatters): Promise<SellingData> {
  const today = f.dayKey(session.now());
  const [settings, stages, reasons] = await Promise.all([
    readSettings(session),
    session.list<StageRow>("stages", { select: ["id", "label", "odds", "position"], order: ["position", "id"], limit: 50 }).then((page) => page.rows),
    session.list<ReasonRow>("lost_reasons", { select: ["id", "label", "position"], order: ["position", "id"], limit: 50 }).then((page) => page.rows),
  ]);
  const days = (column: string, fallback: number): number => num(settings?.[column]) || fallback;
  const count = (filters: Condition[]): Promise<number> => session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] }).then((figure) => num(figure.value));
  const deals = session.can("deals", "read");
  if (!deals) return { settings, stages, reasons, byStage: {}, open: 0, weighted: 0, byReason: {}, lost: 0, warm: 0, stale: 0, caught: { quiet: 0, stuck: 0, soon: 0 } };
  const warmAt = before(f, today, days("sitting_warm_days", 14));
  const staleAt = before(f, today, days("sitting_stale_days", 30));
  const sum = (filters: Condition[]): Promise<number> => session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters, aggregations: [{ fn: "sum", column: "weighted_value", alias: "w" }] }).then((figure) => num(figure.value));
  const [openBy, allBy, lostBy, warm, stale, quiet, stuck, soon, openAll, weightedAll, lostAll] = await Promise.all([
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [OPEN], groupBy: ["stage_id"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "w" }], limit: 50 }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [], groupBy: ["stage_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 50 }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [{ column: "state", op: "eq", value: "lost" }], groupBy: ["lost_reason_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 50 }),
    count([OPEN, { column: "entered_stage_at", op: "lt", value: warmAt }, { column: "entered_stage_at", op: "gte", value: staleAt }]),
    count([OPEN, { column: "entered_stage_at", op: "lt", value: staleAt }]),
    count([OPEN, { column: "last_activity_at", op: "lt", value: before(f, today, days("nudge_quiet_days", 7)) }]),
    count([OPEN, { column: "entered_stage_at", op: "lt", value: before(f, today, days("nudge_stuck_days", 21)) }]),
    count([OPEN, { column: "expected_close", op: "gte", value: today }, { column: "expected_close", op: "lte", value: addDays(today, days("nudge_soon_days", 7)) }, { column: "stage_odds", op: "lt", value: 0.9 }]),
    count([OPEN]),
    sum([OPEN]),
    count([{ column: "state", op: "eq", value: "lost" }]),
  ]);
  const open = byKey(openBy);
  const all = byKey(allBy, "n");
  const lost = byKey(lostBy, "n");
  const byStage: SellingData["byStage"] = {};
  for (const stage of stages) byStage[String(stage.id)] = { open: open[String(stage.id)]?.["n"] ?? 0, weighted: open[String(stage.id)]?.["w"] ?? 0, all: all[String(stage.id)]?.["n"] ?? 0 };
  const byReason: Record<string, number> = {};
  for (const reason of reasons) byReason[String(reason.id)] = lost[String(reason.id)]?.["n"] ?? 0;
  return { settings, stages, reasons, byStage, open: openAll, weighted: weightedAll, byReason, lost: lostAll, warm, stale, caught: { quiet, stuck, soon } };
}
