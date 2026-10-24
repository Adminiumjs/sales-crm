/**
 * JOBS ON SITE, THE OFFICE SIDE: what the screens read, and how a visit to a
 * job is booked, moved and called off.
 *
 * WHO COUNTS. The server: every count and every sum on these screens is a
 * figure the server works out for the reader's own rows (`session.figure`),
 * or a list's own total. The browser puts a visit under its day, names its
 * tone from the server's clock, and compares a day's hours with the crew's
 * day (a setting): it adds up no rows.
 *
 * A VISIT IS BOOKED IN TWO WRITES: first its day, crew and the rest while it
 * still waits, then the record's own "Book" button from "waiting". The
 * customer's "booked" e-mail is set off by the second, and a "moved" e-mail
 * only by a booked visit's day or start changing afterwards, never by its
 * booking (`whole/manifest.json`, the outbox's delivery producers).
 *
 * CALLED OFF IS REMOVED (F17). The why is written to the visit a moment
 * before it is removed, so the removal's own entry in Adminium's audit log
 * holds it; a visit that was made (done) is refused by the server and stays.
 */
import { addDays, type Formatters } from "../../lib/format.ts";
import { DAYS, dayOfKey, workDaysOf, type Day } from "../appsettings/data.ts";
import type { Condition, Figure, Grouped, HistoryEntry, Row, Saved, StaffSession } from "../../staffSession.ts";

export type VisitState = "waiting" | "booked" | "done";
export type VisitKind = "install" | "drop" | "return";

export interface Crew extends Row {
  id: number;
  name: string;
  day_hours: number | string | null;
}

export interface Member extends Row {
  id: number;
  crew_id: number;
  user_id: string;
  lead: boolean | number | string;
  phone: string | null;
  since: string | null;
}

export interface CrewDayRow extends Row {
  id: number;
  crew_id: number;
  weekday: Day;
}

export interface Visit extends Row {
  id: number;
  job_id: number;
  kind: VisitKind;
  what: string;
  day: string | null;
  start_time: string | null;
  crew_id: number | null;
  hours: number | string | null;
  crew_size: number | null;
  note: string | null;
  stock_ready_on: string | null;
  state: VisitState;
  cancel_reason: string | null;
  tick_loaded: boolean | number;
  tick_arrived: boolean | number;
  tick_done: boolean | number;
  tick_cleared: boolean | number;
  site_name: string;
  site_address: string | null;
  site_town: string | null;
  site_phone: string | null;
  access_note: string | null;
  ask_for: string | null;
  /** The job's number and its title, read through the visit's link. */
  code: string | null;
  title: string | null;
}

export interface Place {
  lat: number;
  lng: number;
  by: "town" | "exact";
  placeId?: number;
  name?: string;
}

export interface Job extends Row {
  id: number;
  code: string | null;
  deal_id: number;
  title: string;
  site_name: string;
  address_lines: string | null;
  town: string | null;
  lat: number | string | null;
  lng: number | string | null;
  place: Place | string | null;
  access_note: string | null;
  ask_for: string | null;
  site_phone: string | null;
  state: "open" | "installed" | "signed-off";
  blocking_snags: number | string;
}

export interface JobSettings extends Row {
  id: number;
  working_day_hours: number | string | null;
  distance_unit: "km" | "miles" | null;
  depot_name: string | null;
  depot_address: string | null;
  depot_town: string | null;
  depot_lat: number | string | null;
  depot_lng: number | string | null;
  depot_place: Place | string | null;
  office_phone: string | null;
  delivery_emails: boolean | number | string | null;
  snag_days: number | string | null;
}

/**
 * A visit's and a job's columns are not NAMED in a list: a site's address and phone are personal, and a list that
 * names a column kept from its reader (Read-only, a rep) is refused whole, where one that names none is answered
 * with that column empty (`_masked` says which). The lists read every column.
 */
export const VISIT_LOOKUPS = ["code:job_id.code", "title:job_id.title"];
const SETTINGS_COLUMNS = ["id", "working_day_hours", "distance_unit", "depot_name", "depot_address", "depot_town", "depot_lat", "depot_lng", "depot_place", "office_phone", "delivery_emails", "snag_days", ...DAYS.map((day) => `work_${day}`)];

/** The four ticks of a visit, in the crew's order. The fourth reads "Done on site" (D6 Q8). */
export const TICKS = ["tick_loaded", "tick_arrived", "tick_done", "tick_cleared"] as const;
export type Tick = (typeof TICKS)[number];

export const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);
export const truthy = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "true";
/** A day as the server keeps it, whatever the engine wrote after it. */
export const dayKeyOf = (value: unknown): string | null => (typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null);

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
  return { lat, lng, by: place["by"] === "exact" ? "exact" : "town", ...(typeof place["placeId"] === "number" ? { placeId: place["placeId"] } : {}), ...(typeof place["name"] === "string" ? { name: place["name"] } : {}) };
}

/* ─── What a page reads once: the crews, their people and days, the settings ─── */

export interface CrewFacts {
  crews: Crew[];
  members: Member[];
  /** The weekdays each crew works, by crew id. A crew with no row works no day: a visit cannot be booked for it. */
  days: Map<number, Set<Day>>;
  /** Who signs in here, by id. */
  names: Record<string, string>;
  settings: JobSettings | null;
  /** The business's working days (Settings → Working time): the columns of a week. */
  workDays: Set<Day>;
}

export async function readCrewFacts(session: StaffSession): Promise<CrewFacts> {
  const [crews, members, days, settings, people] = await Promise.all([
    session.list<Crew>("crews", { select: ["id", "name", "day_hours"], order: ["name", "id"], limit: 50 }),
    // No column list: a phone is personal, and a list that names a column kept from its reader is refused whole (the server answers it empty instead).
    session.list<Member>("crew_members", { order: ["crew_id", "id"], limit: 200 }),
    session.list<CrewDayRow>("crew_days", { select: ["id", "crew_id", "weekday"], limit: 200 }),
    session.can("settings", "read") ? session.list<JobSettings>("settings", { select: SETTINGS_COLUMNS, limit: 1 }).then((page) => page.rows[0] ?? null) : Promise.resolve(null),
    session.people(undefined, 200).catch(() => []),
  ]);
  const byCrew = new Map<number, Set<Day>>();
  for (const crew of crews.rows) byCrew.set(crew.id, new Set());
  for (const row of days.rows) byCrew.get(row.crew_id)?.add(row.weekday);
  return { crews: crews.rows, members: members.rows, days: byCrew, names: Object.fromEntries(people.map((person) => [person.id, person.name])), settings, workDays: workDaysOf(settings) };
}

/** A crew's normal day in hours: its own, else the setting, else eight. */
export function dayHoursOf(facts: Pick<CrewFacts, "crews" | "settings">, crewId: number | null): number {
  const crew = facts.crews.find((one) => one.id === crewId);
  const own = crew === undefined || crew.day_hours === null || crew.day_hours === "" ? null : num(crew.day_hours);
  if (own !== null && own > 0) return own;
  const setting = facts.settings?.working_day_hours;
  return setting === null || setting === undefined || num(setting) <= 0 ? 8 : num(setting);
}

/** The people of a crew, its lead first, by name. */
export function crewPeople(facts: Pick<CrewFacts, "members" | "names">, crewId: number | null): { member: Member; name: string }[] {
  return facts.members
    .filter((member) => member.crew_id === crewId)
    .sort((a, b) => Number(truthy(b.lead)) - Number(truthy(a.lead)) || a.id - b.id)
    .map((member) => ({ member, name: facts.names[member.user_id] ?? "" }));
}

/* ─── The visits still to come ─── */

const TO_COME: Condition = { column: "state", op: "in", value: ["waiting", "booked"] };
const BOOKED: Condition = { column: "state", op: "eq", value: "booked" };
const WAITING: Condition = { column: "state", op: "eq", value: "waiting" };

/** Every visit still to come, waiting or booked, soonest first (those with no day last). */
export async function readToCome(session: StaffSession): Promise<Visit[]> {
  const page = await session.list<Visit>("job_visits", { where: TO_COME, order: ["day", "start_time", "id"], lookup: VISIT_LOOKUPS, limit: 200 });
  return page.rows;
}

/** The booked visits of some days, for a day sheet and a route: one crew's, or every crew's. */
export async function readBooked(session: StaffSession, from: string, to: string, crewId: number | null = null): Promise<Visit[]> {
  const where: Condition[] = [BOOKED, { column: "day", op: "gte", value: from }, { column: "day", op: "lte", value: to }];
  if (crewId !== null) where.push({ column: "crew_id", op: "eq", value: crewId });
  const page = await session.list<Visit>("job_visits", { where: { and: where }, order: ["day", "start_time", "id"], lookup: VISIT_LOOKUPS, limit: 200 });
  return page.rows;
}

const single = (session: StaffSession, filters: Condition[], aggregation: Figure["aggregations"]): Promise<number> =>
  session.figure<{ value?: number | null }>({ table: "job_visits", shape: "single-metric", filters, aggregations: aggregation }).then((answer) => num(answer.value));

/** The hours one crew is booked for on one day, as the server adds them up. */
export const readDayHours = (session: StaffSession, day: string, crewId: number): Promise<number> =>
  single(session, [BOOKED, { column: "day", op: "eq", value: day }, { column: "crew_id", op: "eq", value: crewId }], [{ fn: "sum", column: "hours", alias: "h" }]);

export interface Plan {
  /** Still to come, booked, waiting for a day, and their hours, as the server counts them. */
  toCome: number;
  booked: number;
  waiting: number;
  hours: number;
  /** The shown week: booked hours by day and by crew, in all, and how many visits. */
  weekHours: Record<string, number>;
  weekByCrew: Record<string, number>;
  weekTotal: number;
  weekVisits: number;
  /** Booked hours of each crew on each day from today on: `crew → day → hours`. */
  crewDays: Record<string, Record<string, number>>;
}

/** The figures of Deliveries, asked together (one request). */
export async function readPlan(session: StaffSession, today: string, monday: string): Promise<Plan> {
  const sunday = addDays(monday, 6);
  const week: Condition[] = [BOOKED, { column: "day", op: "gte", value: monday }, { column: "day", op: "lte", value: sunday }];
  const [toCome, booked, waiting, hours, weekGrouped, weekVisits, matrix, weekTotal, byCrew] = await Promise.all([
    single(session, [TO_COME], [{ fn: "count", alias: "n" }]),
    single(session, [BOOKED], [{ fn: "count", alias: "n" }]),
    single(session, [WAITING], [{ fn: "count", alias: "n" }]),
    single(session, [TO_COME], [{ fn: "sum", column: "hours", alias: "h" }]),
    session.figure<Grouped>({ table: "job_visits", shape: "categorical", filters: week, groupBy: ["day"], aggregations: [{ fn: "sum", column: "hours", alias: "h" }] }),
    single(session, week, [{ fn: "count", alias: "n" }]),
    session.figure<{ rowKeys: (string | number | null)[]; colKeys: (string | number | null)[]; cells: (number | null)[][] }>({
      table: "job_visits",
      shape: "matrix",
      filters: [BOOKED, { column: "day", op: "gte", value: today }],
      groupBy: ["crew_id", "day"],
      aggregations: [{ fn: "sum", column: "hours", alias: "h" }],
    }),
    single(session, week, [{ fn: "sum", column: "hours", alias: "h" }]),
    session.figure<Grouped>({ table: "job_visits", shape: "categorical", filters: week, groupBy: ["crew_id"], aggregations: [{ fn: "sum", column: "hours", alias: "h" }] }),
  ]);
  const weekByCrew: Record<string, number> = {};
  for (const item of byCrew.items) if (item.key !== null) weekByCrew[String(item.key)] = num(item.values?.["h"] ?? item.value);
  const weekHours: Record<string, number> = {};
  for (const item of weekGrouped.items) {
    const key = dayKeyOf(item.key);
    if (key !== null) weekHours[key] = num(item.values?.["h"] ?? item.value);
  }
  const crewDays: Record<string, Record<string, number>> = {};
  matrix.rowKeys.forEach((crew, r) => {
    if (crew === null) return;
    const cells: Record<string, number> = {};
    matrix.colKeys.forEach((day, c) => {
      const key = dayKeyOf(day);
      const value = matrix.cells[r]?.[c];
      if (key !== null && typeof value === "number") cells[key] = value;
    });
    crewDays[String(crew)] = cells;
  });
  return { toCome, booked, waiting, hours, weekHours, weekByCrew, weekTotal, weekVisits, crewDays };
}

/* ─── The checks a booking is held to before it is sent ─── */

export type Refusal = { kind: "gone"; offer: string | null } | { kind: "stock"; ready: string; offer: string | null } | { kind: "closed"; offer: string | null } | { kind: "nocrew" };

export interface BookingCheck {
  refusal: Refusal | null;
  /** Booked and flagged: the crew's hours that day with this visit, against its day. */
  over: { hours: number; of: number } | null;
}

export interface CheckInput {
  day: string;
  today: string;
  stock: string | null;
  crewId: number | null;
  /** This visit's hours. */
  hours: number;
  /** The crew's other booked hours that day (the server's, less this visit's own when it is already there). */
  otherHours: number;
  crewDays: ReadonlySet<Day> | undefined;
  dayHours: number;
}

/** The first day from `from` on, up to two months ahead, that the crew works and the stock is in: what "Use …" offers. */
export function firstOpenDay(from: string, today: string, stock: string | null, crewDays: ReadonlySet<Day> | undefined): string | null {
  let day = [from, today, stock ?? ""].sort().reverse()[0]!;
  for (let tries = 0; tries < 62; tries += 1, day = addDays(day, 1)) if (crewDays !== undefined && crewDays.has(dayOfKey(day))) return day;
  return null;
}

/**
 * What the server will refuse, and what it books and flags, before the
 * person presses (the design's `jobCheck`): a day gone by (the server takes
 * one; this screen does not offer it), a day before the stock lands
 * (`notBefore`: the server refuses), a day the crew does not work (the
 * server's "That day is closed."), and a crew over its normal day (allowed,
 * flagged). The server stays the last word for a race between two desks.
 */
export function checkBooking(input: CheckInput): BookingCheck {
  if (input.crewId === null) return { refusal: { kind: "nocrew" }, over: null };
  const offer = (): string | null => firstOpenDay(input.day, input.today, input.stock, input.crewDays);
  if (input.day < input.today) return { refusal: { kind: "gone", offer: offer() }, over: null };
  if (input.stock !== null && input.day < input.stock) return { refusal: { kind: "stock", ready: input.stock, offer: offer() }, over: null };
  if (input.crewDays === undefined || !input.crewDays.has(dayOfKey(input.day))) return { refusal: { kind: "closed", offer: offer() }, over: null };
  const total = input.otherHours + input.hours;
  return { refusal: null, over: total > input.dayHours ? { hours: total, of: input.dayHours } : null };
}

/** The days a crew is over its normal day, from the server's hours of each crew each day: `[crew, day, hours, of]`, soonest first. */
export function overDays(crewDays: Plan["crewDays"], dayHours: (crewId: number) => number): { crewId: number; day: string; hours: number; of: number }[] {
  const out: { crewId: number; day: string; hours: number; of: number }[] = [];
  for (const [crew, days] of Object.entries(crewDays)) {
    const of = dayHours(Number(crew));
    for (const [day, hours] of Object.entries(days)) if (hours > of) out.push({ crewId: Number(crew), day, hours, of });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.crewId - b.crewId));
}

/** The days of a week that are working days, Monday first. */
export function weekColumns(monday: string, workDays: ReadonlySet<Day>): string[] {
  return DAYS.map((_, i) => addDays(monday, i)).filter((day) => workDays.has(dayOfKey(day)));
}

/** The visits of one day of a crew, in the order they start. */
export const ofDay = (visits: readonly Visit[], day: string, crewId: number | null = null): Visit[] =>
  visits.filter((visit) => dayKeyOf(visit.day) === day && (crewId === null || visit.crew_id === crewId)).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? "") || a.id - b.id);

/* ─── Booking, moving, adding and calling off a visit ─── */

export interface Draft {
  day: string;
  start: string;
  crewId: number;
  hours: number;
  size: number;
  note: string;
}

const values = (draft: Draft): Row => ({ day: draft.day, start_time: draft.start, crew_id: draft.crewId, hours: draft.hours, crew_size: draft.size, note: draft.note.trim() === "" ? null : draft.note.trim() });

/**
 * Book a visit that waits: its day and the rest first (while it still waits,
 * so the customer is not told it "moved"), then its own "Book" button. A
 * refused booking puts the day back, so the visit is waiting as it was.
 */
export async function bookVisit(session: StaffSession, visit: Pick<Visit, "id" | "day" | "crew_id">, draft: Draft): Promise<Saved<Visit>> {
  const set = await session.update<Visit>("job_visits", visit.id, values(draft), { seen: { state: "waiting" } });
  if (set.state !== "saved") return set;
  const booked = await session.act<Visit>("job_visits", visit.id, "book", "waiting");
  if (booked.state === "refused") await session.update("job_visits", visit.id, { day: visit.day, crew_id: visit.crew_id }, { seen: { state: "waiting" } });
  return booked;
}

/** Move a booked visit: names the day it was on, so a visit a colleague moved meanwhile is not written over. */
export const moveVisit = (session: StaffSession, visit: Pick<Visit, "id" | "day">, draft: Draft): Promise<Saved<Visit>> =>
  session.update<Visit>("job_visits", visit.id, values(draft), { seen: { state: "booked", day: dayKeyOf(visit.day) } });

export interface NewVisit {
  jobId: number;
  kind: VisitKind;
  what: string;
  hours: number;
  size: number;
  stock: string | null;
  note: string;
}

/** A visit added to a job (after a cancel, or for a job made from "jobs still to make"): it waits for a day. */
export const addVisit = (session: StaffSession, made: NewVisit, key: string): Promise<Saved<Visit>> =>
  session.create<Visit>("job_visits", { job_id: made.jobId, kind: made.kind, what: made.what.trim(), hours: made.hours, crew_size: made.size, stock_ready_on: made.stock, note: made.note.trim() === "" ? null : made.note.trim() }, key);

/** Call a visit off: one removal with the why, kept with the removed visit (plan 68 S16). A second press after a lost reply finds nothing to remove twice. */
export async function cancelVisit(session: StaffSession, visit: Pick<Visit, "id" | "state">, why: string): Promise<Saved> {
  const done = await session.remove("job_visits", visit.id, { reason: why });
  if (done.state === "refused" && done.error.status === 404 && (await session.get("job_visits", visit.id)) === null) return { state: "saved", row: {}, replayed: true, readBack: true };
  return done;
}

export interface Moved {
  /** The day it was on and when it was to start, before the move. */
  day: string | null;
  start: string | null;
  crewId: number | null;
  by: string | null;
  at: Date;
}

/** The last time a booked visit's day, start or crew changed: what it was, who and when, read from the record's own history (F17). */
export async function lastMove(session: StaffSession, id: number): Promise<Moved | null> {
  const { entries } = await session.history("job_visits", id, { limit: 50 });
  for (const entry of entries as (Omit<HistoryEntry, "createdAt"> & { createdAt: string | number })[]) {
    const changes = entry.changes as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
    const before = changes?.before;
    if (before === undefined || before === null) continue;
    // A booking writes the day onto a visit that had none: that is not a move.
    if (!("day" in before || "start_time" in before || "crew_id" in before)) continue;
    // Nor is a write that changed none of the three (a rule keeping what the visit had, plan 68 D17): an entry may hold the whole row.
    const after = changes?.after;
    if (after !== undefined && after !== null && ["day", "start_time", "crew_id"].every((column) => !(column in after) || String(dayKeyOf(before[column]) ?? before[column] ?? "") === String(dayKeyOf(after[column]) ?? after[column] ?? ""))) continue;
    const was = dayKeyOf(before["day"]);
    if ("day" in before && was === null) continue;
    const at = new Date(typeof entry.createdAt === "number" ? entry.createdAt : /^\d+$/.test(entry.createdAt) ? Number(entry.createdAt) : entry.createdAt);
    return { day: was, start: typeof before["start_time"] === "string" ? before["start_time"] : null, crewId: before["crew_id"] === undefined || before["crew_id"] === null ? null : Number(before["crew_id"]), by: entry.actorLabel, at };
  }
  return null;
}

/** Whether the customer's e-mails about a delivery are on, from the settings the page read. */
export const mailsOn = (settings: JobSettings | null): "on" | "off" | "unknown" =>
  settings === null || settings.delivery_emails === null || settings.delivery_emails === undefined ? "unknown" : truthy(settings.delivery_emails) ? "on" : "off";

/* ─── Jobs ─── */

export const readJobs = (session: StaffSession): Promise<Job[]> =>
  session.list<Job>("jobs", { order: ["code_seq", "id"], limit: 200 }).then((page) => page.rows);

export interface WonDeal extends Row {
  id: number;
  name: string;
  closed_on: string | null;
}

/**
 * "JOBS STILL TO MAKE" (P15): won deals with no job, won before Jobs on site
 * was switched on (a deal won after makes its job by the app's rule). The
 * server says which (a deal keeps how many jobs it has) and how many.
 */
export async function readStillToMake(session: StaffSession): Promise<{ deals: WonDeal[]; total: number }> {
  if (!session.can("deals", "read") || !session.can("jobs", "create")) return { deals: [], total: 0 };
  const page = await session.list<WonDeal>("deals", {
    select: ["id", "name", "closed_on"],
    where: { and: [{ column: "state", op: "eq", value: "won" }, { column: "job_count", op: "eq", value: 0 }] },
    order: ["closed_on.desc", "id"],
    limit: 50,
    count: "exact",
  });
  return { deals: page.rows, total: Number(page.total ?? page.rows.length) };
}

/** Make the job of a won deal: its site is called what the deal is, as the app's rule names it. A second press finds the deal holds one. */
export const makeJob = (session: StaffSession, deal: Pick<WonDeal, "id" | "name">, key: string): Promise<Saved<Job>> =>
  session.create<Job>("jobs", { deal_id: deal.id, site_name: deal.name }, key);

/* ─── Snags ─── */

export type SnagState = "open" | "waiting-part" | "put-right";

export interface Snag extends Row {
  id: number;
  job_id: number;
  visit_id: number | null;
  text: string;
  stops_sign_off: boolean | number;
  state: SnagState;
  raised_on: string;
  raised_by_id: string | null;
  raised_by_contact_id: number | null;
  due_on: string;
  put_right_on: string | null;
  put_right_note: string | null;
  code: string | null;
  title: string | null;
  site: string | null;
}

export const SNAG_COLUMNS = ["id", "job_id", "visit_id", "text", "stops_sign_off", "state", "raised_on", "raised_by_id", "raised_by_contact_id", "due_on", "put_right_on", "put_right_note"];
export const SNAG_LOOKUPS = ["code:job_id.code", "title:job_id.title", "site:job_id.site_name"];
const SNAG_ORDER: Record<SnagState, number> = { open: 0, "waiting-part": 1, "put-right": 2 };

/** Open first, then waiting on a part, then put right; the newest raised first inside each. */
export const snagOrder = (a: Pick<Snag, "state" | "raised_on" | "id">, b: Pick<Snag, "state" | "raised_on" | "id">): number =>
  SNAG_ORDER[a.state] - SNAG_ORDER[b.state] || (dayKeyOf(b.raised_on) ?? "").localeCompare(dayKeyOf(a.raised_on) ?? "") || b.id - a.id;

export const readSnags = (session: StaffSession, jobId: number | null = null): Promise<Snag[]> =>
  session
    .list<Snag>("snags", { select: SNAG_COLUMNS, ...(jobId === null ? {} : { where: { column: "job_id", op: "eq", value: jobId } }), lookup: SNAG_LOOKUPS, order: ["raised_on.desc", "id.desc"], limit: 200 })
    .then((page) => [...page.rows].sort(snagOrder));

export interface SnagFigures {
  /** Still to do: open or waiting on a part. */
  live: number;
  open: number;
  waiting: number;
  putRight: number;
  all: number;
  late: number;
  stopping: number;
  /** Jobs with an open snag. */
  openJobs: number;
  byCrew: number;
  byCustomer: number;
}

const snagCount = (session: StaffSession, filters: Condition[]): Promise<number> =>
  session.figure<{ value?: number | null }>({ table: "snags", shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] }).then((answer) => num(answer.value));

const LIVE: Condition = { column: "state", op: "in", value: ["open", "waiting-part"] };

/** Every count of the snag list, asked together. */
export async function readSnagFigures(session: StaffSession, today: string): Promise<SnagFigures> {
  const [live, open, waiting, putRight, all, late, stopping, openJobs, byCrew, byCustomer] = await Promise.all([
    snagCount(session, [LIVE]),
    snagCount(session, [{ column: "state", op: "eq", value: "open" }]),
    snagCount(session, [{ column: "state", op: "eq", value: "waiting-part" }]),
    snagCount(session, [{ column: "state", op: "eq", value: "put-right" }]),
    snagCount(session, []),
    snagCount(session, [LIVE, { column: "due_on", op: "lt", value: today }]),
    snagCount(session, [LIVE, { column: "stops_sign_off", op: "eq", value: true }]),
    session.figure<Grouped>({ table: "snags", shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }], groupBy: ["job_id"], aggregations: [{ fn: "count", alias: "n" }] }).then((answer) => answer.items.filter((item) => item.key !== null).length),
    snagCount(session, [{ column: "raised_by_id", op: "not_null" }]),
    snagCount(session, [{ column: "raised_by_contact_id", op: "not_null" }]),
  ]);
  return { live, open, waiting, putRight, all, late, stopping, openJobs, byCrew, byCustomer };
}

/** How many snags each job has, and how many still live, as the server counts them. */
export async function readSnagsByJob(session: StaffSession): Promise<Record<string, { all: number; live: number }>> {
  const [all, live] = await Promise.all([
    session.figure<Grouped>({ table: "snags", shape: "categorical", groupBy: ["job_id"], aggregations: [{ fn: "count", alias: "n" }] }),
    session.figure<Grouped>({ table: "snags", shape: "categorical", filters: [LIVE], groupBy: ["job_id"], aggregations: [{ fn: "count", alias: "n" }] }),
  ]);
  const out: Record<string, { all: number; live: number }> = {};
  for (const item of all.items) if (item.key !== null) out[String(item.key)] = { all: num(item.values?.["n"] ?? item.value), live: 0 };
  for (const item of live.items) if (item.key !== null) (out[String(item.key)] ??= { all: 0, live: 0 }).live = num(item.values?.["n"] ?? item.value);
  return out;
}

/* ─── Sign-offs ─── */

export interface SignOff extends Row {
  id: number;
  job_id: number;
  visit_id: number | null;
  check_1: boolean | number;
  check_2: boolean | number;
  check_3: boolean | number;
  check_4: boolean | number;
  check_5: boolean | number;
  signer_name: string;
  signature: string | null;
  photos: unknown;
  signed_at: string;
  copy_sent_to: string | null;
  corrects_id: number | null;
  version: number | string | null;
}

export const CHECKS = ["check_1", "check_2", "check_3", "check_4", "check_5"] as const;

/** Every sign-off, the newest version of each job's last: a correction is a new row, and the newest stands. */
export async function readSignOffs(session: StaffSession): Promise<Map<number, SignOff>> {
  const page = await session.list<SignOff>("sign_offs", {
    select: ["id", "job_id", "visit_id", ...CHECKS, "signer_name", "signature", "photos", "signed_at", "copy_sent_to", "corrects_id", "version"],
    order: ["job_id", "version"],
    limit: 200,
  });
  const out = new Map<number, SignOff>();
  for (const row of page.rows) {
    const held = out.get(row.job_id);
    if (held === undefined || num(row.version) >= num(held.version)) out.set(row.job_id, row);
  }
  return out;
}

/** A signature kept as a file: its address, for an image. Anything else (no file yet) has none. */
export const signatureSrc = (value: string | null): string | null => (value !== null && /^file_[A-Za-z0-9]+$/.test(value) ? `/api/v1/files/${encodeURIComponent(value)}/content?inline=true` : null);

/* ─── Delivery notes ─── */

export interface Note extends Row {
  id: number;
  job_id: number;
  visit_id: number;
  crew_id: number | null;
  taken_by_id: string | null;
  signed_name: string | null;
  damage: boolean | number;
  note: string | null;
  ordered: number | string;
  delivered: number | string;
  short: number | string | null;
  sorted: boolean | number;
  sorted_on: string | null;
  needs_sorting: number | string | null;
  code: string | null;
  title: string | null;
  site: string | null;
  day: string | null;
}

export interface NoteLine extends Row {
  id: number;
  note_id: number;
  what: string;
  ordered: number;
  delivered: number;
}

export type NoteState = "unsigned" | "short" | "damaged" | "clean" | "sorted";

/** What a note needs, from what the server keeps on it: never signed for, short, damaged, or clean (and sorted once the office has). */
export function noteState(note: Pick<Note, "signed_name" | "short" | "damage" | "sorted">): NoteState {
  if (truthy(note.sorted)) return "sorted";
  if (note.signed_name === null || note.signed_name === "") return "unsigned";
  if (num(note.short) > 0) return "short";
  if (truthy(note.damage)) return "damaged";
  return "clean";
}

const NOTE_ORDER: Record<NoteState, number> = { unsigned: 0, short: 1, damaged: 2, sorted: 3, clean: 4 };
export const noteOrder = (a: Pick<Note, "id" | "day"> & Parameters<typeof noteState>[0], b: Pick<Note, "id" | "day"> & Parameters<typeof noteState>[0]): number =>
  NOTE_ORDER[noteState(a)] - NOTE_ORDER[noteState(b)] || (dayKeyOf(b.day) ?? "").localeCompare(dayKeyOf(a.day) ?? "") || b.id - a.id;

export async function readNotes(session: StaffSession): Promise<{ notes: Note[]; lines: NoteLine[] }> {
  const [notes, lines] = await Promise.all([
    session.list<Note>("delivery_notes", {
      select: ["id", "job_id", "visit_id", "crew_id", "taken_by_id", "signed_name", "damage", "note", "ordered", "delivered", "short", "sorted", "sorted_on", "needs_sorting"],
      lookup: ["code:job_id.code", "title:job_id.title", "site:job_id.site_name", "day:visit_id.day"],
      limit: 200,
    }),
    session.list<NoteLine>("delivery_note_lines", { select: ["id", "note_id", "what", "ordered", "delivered"], order: ["note_id", "id"], limit: 200 }),
  ]);
  return { notes: [...notes.rows].sort(noteOrder), lines: lines.rows };
}

export interface NoteFigures {
  all: number;
  lines: number;
  clean: number;
  sorting: number;
  short: number;
  damaged: number;
  unsigned: number;
}

const noteCount = (session: StaffSession, filters: Condition[]): Promise<number> =>
  session.figure<{ value?: number | null }>({ table: "delivery_notes", shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] }).then((answer) => num(answer.value));

export async function readNoteFigures(session: StaffSession): Promise<NoteFigures> {
  const notSorted: Condition = { column: "sorted", op: "eq", value: false };
  const [all, lines, clean, sorting, short, damaged, unsigned] = await Promise.all([
    noteCount(session, []),
    session.figure<{ value?: number | null }>({ table: "delivery_note_lines", shape: "single-metric", aggregations: [{ fn: "count", alias: "n" }] }).then((answer) => num(answer.value)),
    noteCount(session, [{ column: "needs_sorting", op: "eq", value: 0 }, notSorted]),
    noteCount(session, [{ column: "needs_sorting", op: "eq", value: 1 }]),
    noteCount(session, [notSorted, { column: "signed_name", op: "not_null" }, { column: "short", op: "gt", value: 0 }]),
    noteCount(session, [notSorted, { column: "signed_name", op: "not_null" }, { column: "short", op: "lte", value: 0 }, { column: "damage", op: "eq", value: true }]),
    noteCount(session, [notSorted, { column: "signed_name", op: "is_null" }]),
  ]);
  return { all, lines, clean, sorting, short, damaged, unsigned };
}

/* ─── Recycling and disposal ─── */

export type WasteRoute = "reused" | "recycled" | "landfill";

export interface Removal extends Row {
  id: number;
  job_id: number;
  day: string;
  what: string;
  tonnes: number | string;
  route: WasteRoute;
  cost: number | string;
  income: number | string;
  carrier: string | null;
  note_number: string | null;
  has_transfer_note: boolean | number;
  code: string | null;
  title: string | null;
  site: string | null;
}

export const readRemovals = (session: StaffSession): Promise<Removal[]> =>
  session
    .list<Removal>("waste_removals", {
      select: ["id", "job_id", "day", "what", "tonnes", "route", "cost", "income", "carrier", "note_number", "has_transfer_note"],
      lookup: ["code:job_id.code", "title:job_id.title", "site:job_id.site_name"],
      order: ["tonnes.desc", "id"],
      limit: 200,
    })
    .then((page) => page.rows);

export interface WasteFigures {
  count: number;
  tonnes: number;
  byRoute: Record<WasteRoute, { count: number; tonnes: number }>;
  cost: number;
  income: number;
  first: string | null;
  last: string | null;
  /** Tonnes by quarter of the year the server's clock is in, so far: asked by day ranges (a month's bucket is read differently on Postgres, E20). */
  quarters: { quarter: number; tonnes: number }[];
  noNote: number;
}

export async function readWasteFigures(session: StaffSession, today: string): Promise<WasteFigures> {
  const year = today.slice(0, 4);
  const upTo = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const quarters = Array.from({ length: upTo }, (_, i) => i + 1);
  const range = (q: number): Condition[] => [{ column: "day", op: "gte", value: `${year}-${String(q * 3 - 2).padStart(2, "0")}-01` }, { column: "day", op: q === 4 ? "lte" : "lt", value: q === 4 ? `${year}-12-31` : `${year}-${String(q * 3 + 1).padStart(2, "0")}-01` }];
  const sum = (column: string, filters: Condition[] = []): Promise<number> =>
    session.figure<{ value?: number | null }>({ table: "waste_removals", shape: "single-metric", filters, aggregations: [{ fn: "sum", column, alias: "s" }] }).then((answer) => num(answer.value));
  const [byRoute, count, tonnes, cost, income, noNote, firstLast, ...perQuarter] = await Promise.all([
    session.figure<Grouped>({ table: "waste_removals", shape: "categorical", groupBy: ["route"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "tonnes", alias: "t" }] }),
    session.figure<{ value?: number | null }>({ table: "waste_removals", shape: "single-metric", aggregations: [{ fn: "count", alias: "n" }] }).then((answer) => num(answer.value)),
    sum("tonnes"),
    sum("cost"),
    sum("income"),
    session.figure<{ value?: number | null }>({ table: "waste_removals", shape: "single-metric", filters: [{ column: "has_transfer_note", op: "eq", value: false }], aggregations: [{ fn: "count", alias: "n" }] }).then((answer) => num(answer.value)),
    // The first and the last day: the list in the order of the day, one row each way (`min` of a date answers 0 today, E12).
    Promise.all([
      session.list<{ day: string }>("waste_removals", { select: ["day"], order: ["day"], limit: 1 }),
      session.list<{ day: string }>("waste_removals", { select: ["day"], order: ["day.desc"], limit: 1 }),
    ]),
    ...quarters.map((q) => sum("tonnes", range(q))),
  ]);
  const routes: Record<WasteRoute, { count: number; tonnes: number }> = { reused: { count: 0, tonnes: 0 }, recycled: { count: 0, tonnes: 0 }, landfill: { count: 0, tonnes: 0 } };
  for (const item of byRoute.items) {
    if (item.key === "reused" || item.key === "recycled" || item.key === "landfill") routes[item.key] = { count: num(item.values?.["n"]), tonnes: num(item.values?.["t"]) };
  }
  return {
    count,
    tonnes,
    byRoute: routes,
    cost,
    income,
    first: dayKeyOf(firstLast[0].rows[0]?.day),
    last: dayKeyOf(firstLast[1].rows[0]?.day),
    quarters: quarters.map((quarter, i) => ({ quarter, tonnes: perQuarter[i] ?? 0 })),
    noNote,
  };
}

/** One decimal place, the way the reader's language writes it: tonnes, hours. */
export const oneDecimal = (f: Pick<Formatters, "number">, value: number): string => f.number(Math.round(value * 10) / 10);

/** A share between 0 and 1 of two server figures (the browser may divide two figures the server gave, §1). */
export const shareOf = (part: number, whole: number): number | null => (whole <= 0 ? null : part / whole);

/** The hour and minute of a start as the server keeps it (`08:00`), or null. */
export const startOf = (value: unknown): string | null => (typeof value === "string" && /^\d{2}:\d{2}$/.test(value.slice(0, 5)) ? value.slice(0, 5) : null);
