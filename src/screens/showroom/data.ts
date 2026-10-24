/**
 * SHOWROOM AND SAMPLES (P19): what the five screens and the front desk's home
 * read, and what is written from them.
 *
 * WHO COUNTS. The server: every count is the total it answers for a list of
 * one row (asked afresh, so a booking just made is counted at once), and a
 * sample's pieces out and on the shelf are columns it keeps itself (a loan's
 * pieces, summed while the loan is not back; the shelf is what is held less
 * that, and a loan past the shelf is refused). A screen puts a row under its
 * day and subtracts a day from the server's clock (how late, how long away).
 *
 * A CANCEL REMOVES THE BOOKING (F17). The why is written to it a moment before
 * it goes, so the removal's own audit entry holds it. A piece of display stock
 * promised to the booking lets go of it first: the database would refuse to
 * remove a booking a piece still names. A booking somebody came in for is
 * history, and the server refuses to remove it.
 *
 * THE SHOWROOM'S HOURS are a setting (the owner's ruling, D4 Q1): the dialog
 * checks them, with the business's working days. The server refuses only an
 * overlap in one space (`occupies`); "outside the hours" and "in the past"
 * are the dialog's own.
 */
import type { Formatters } from "../../lib/format.ts";
import { addDays } from "../../lib/format.ts";
import type { Condition, HistoryEntry, Saved, StaffSession } from "../../staffSession.ts";

export type BookingState = "tentative" | "confirmed" | "done";
export const LIVE: readonly BookingState[] = ["tentative", "confirmed"];

export interface Booking extends Record<string, unknown> {
  id: number;
  space_id: number;
  company_id: number | null;
  contact_id: number | null;
  visitor_name: string | null;
  party: number;
  starts_at: string;
  minutes: number;
  rep_id: string | null;
  state: BookingState;
  note: string | null;
  outcome: string | null;
  next_step: string | null;
  next_step_by: string | null;
  next_step_done_on: string | null;
  deal_id: number | null;
  space: string | null;
  company: string | null;
  contact: string | null;
  contact_email: string | null;
  deal?: string | null;
  deal_amount?: number | string | null;
}

export const BOOKING_COLUMNS = ["id", "space_id", "company_id", "contact_id", "visitor_name", "party", "starts_at", "minutes", "rep_id", "state", "note", "outcome", "next_step", "next_step_by", "next_step_done_on", "deal_id"];

/** A deal's name and amount come along only for somebody who reads deals: the front desk does not, and a lookup she may not make would refuse the whole list. */
export const bookingLookups = (session: Pick<StaffSession, "can">): string[] => [
  "space:space_id.name",
  "company:company_id.name",
  "contact:contact_id.name",
  "contact_email:contact_id.email",
  ...(session.can("deals", "read") ? ["deal:deal_id.name", "deal_amount:deal_id.amount"] : []),
];

export interface Space extends Record<string, unknown> {
  id: number;
  name: string;
}

/** The showroom's week, from the settings: its hours, and the business's working days (weekends closed by default). */
export interface ShowWeek {
  id: number | null;
  opens: string;
  closes: string;
  days: Set<Weekday>;
  emails: "on" | "off" | "unknown";
  address: string | null;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** The weekday a day key falls on. */
export const weekdayOf = (day: string): Weekday => WEEKDAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]!;

const yes = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "true";
export const isClock = (text: unknown): text is string => typeof text === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
/** Minutes past midnight of an `HH:MM`. */
export const clockMinutes = (text: string): number => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
/** An `HH:MM` from minutes past midnight. */
export const clockOf = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const DEFAULT_WEEK: ShowWeek = { id: null, opens: "09:00", closes: "17:30", days: new Set(["mon", "tue", "wed", "thu", "fri"]), emails: "unknown", address: null };

export async function readWeek(session: StaffSession): Promise<ShowWeek> {
  if (!session.can("settings", "read")) return DEFAULT_WEEK;
  const row = (await session.list<Record<string, unknown>>("settings", { limit: 1 })).rows[0];
  if (row === undefined) return DEFAULT_WEEK;
  const days = new Set(WEEKDAYS.filter((day) => yes(row[`work_${day}`])));
  const emails = row["showroom_emails"];
  return {
    id: Number(row["id"]),
    opens: isClock(row["showroom_opens"]) ? row["showroom_opens"] : DEFAULT_WEEK.opens,
    closes: isClock(row["showroom_closes"]) ? row["showroom_closes"] : DEFAULT_WEEK.closes,
    days: days.size === 0 ? DEFAULT_WEEK.days : days,
    emails: emails === undefined || emails === null ? "unknown" : yes(emails) ? "on" : "off",
    address: typeof row["showroom_address"] === "string" && row["showroom_address"].trim() !== "" ? row["showroom_address"] : null,
  };
}

export const readSpaces = (session: StaffSession): Promise<Space[]> => session.list<Space>("showroom_spaces", { select: ["id", "name"], order: ["id"], limit: 50 }).then((page) => page.rows);

/** The moment today began where the business is. */
export const startOfToday = (now: Date, f: Formatters): Date => f.at(f.dayKey(now), "00:00");

/** `10:30–12:00`, on the business's clock. */
export const spanOf = (row: { starts_at: string; minutes: number | string }, f: Formatters): string => {
  const from = new Date(row.starts_at);
  return `${f.time(from)}–${f.time(new Date(from.getTime() + Number(row.minutes) * 60_000))}`;
};

const count = (session: StaffSession, ref: string, where: Condition): Promise<number> => session.list(ref, { select: ["id"], where, limit: 1, count: "exact" }).then((page) => Number(page.total ?? 0));
const all = (conditions: Condition[]): Condition => (conditions.length === 1 ? conditions[0]! : { and: conditions });
const live: Condition = { column: "state", op: "in", value: [...LIVE] };

export type BookingFilter = "coming" | "tentative" | "done" | "all";
export const BOOKING_FILTERS: readonly BookingFilter[] = ["coming", "tentative", "done", "all"];

export interface ShowroomData {
  bookings: Booking[];
  spaces: (Space & { live: number })[];
  counts: Record<BookingFilter, number>;
  /** What is set out for each booking: the display pieces promised to it, by name. */
  setOut: Record<number, string[]>;
}

/** Whether a booking is under a filter, by its state and the server's clock. */
export function inFilter(booking: Pick<Booking, "state" | "starts_at">, filter: BookingFilter, now: Date, f: Formatters): boolean {
  if (filter === "all") return true;
  if (filter === "done") return booking.state === "done";
  if (filter === "tentative") return booking.state === "tentative";
  return booking.state !== "done" && new Date(booking.starts_at).getTime() >= startOfToday(now, f).getTime();
}

/** The showroom's diary: every booking, the server's four counts and each space's live bookings, and what each booking has set out for it. */
export async function readShowroom(session: StaffSession, now: Date, f: Formatters): Promise<ShowroomData> {
  const from = startOfToday(now, f).toISOString();
  const [page, coming, tentative, done, spaces, pieces] = await Promise.all([
    session.list<Booking>("showroom_bookings", { select: BOOKING_COLUMNS, order: ["starts_at"], lookup: bookingLookups(session), limit: 200, count: "exact" }),
    count(session, "showroom_bookings", all([live, { column: "starts_at", op: "gte", value: from }])),
    count(session, "showroom_bookings", { column: "state", op: "eq", value: "tentative" }),
    count(session, "showroom_bookings", { column: "state", op: "eq", value: "done" }),
    readSpaces(session),
    session.can("display_pieces", "read")
      ? session.list<{ id: number; name: string; promised_booking_id: number }>("display_pieces", { select: ["id", "name", "promised_booking_id"], where: { column: "promised_booking_id", op: "not_null" }, order: ["id"], limit: 200 }).then((one) => one.rows)
      : Promise.resolve([]),
  ]);
  const perSpace = await Promise.all(spaces.map((space) => count(session, "showroom_bookings", all([live, { column: "space_id", op: "eq", value: space.id }]))));
  const setOut: Record<number, string[]> = {};
  for (const piece of pieces) (setOut[piece.promised_booking_id] ??= []).push(piece.name);
  return {
    bookings: page.rows,
    spaces: spaces.map((space, i) => ({ ...space, live: perSpace[i] ?? 0 })),
    counts: { coming, tentative, done, all: Number(page.total ?? page.rows.length) },
    setOut,
  };
}

/** Who a booking is for, as a line: the company and the person, or a new visitor's name. */
export const visitorOf = (booking: Pick<Booking, "company" | "contact" | "visitor_name">): string => [booking.company, booking.contact ?? booking.visitor_name].filter((part) => part !== null && part !== undefined && part !== "").join(", ");

// ── the booking dialog's own checks ───────────────────────────────────────

/** A booking as the dialog drafts it: the space, when it starts, for how long. */
export interface Draft {
  id?: number;
  space_id: number;
  starts_at: string;
  minutes: number;
}

export const overlaps = (a: { starts_at: string; minutes: number | string }, b: { starts_at: string; minutes: number | string }): boolean => {
  const from = new Date(a.starts_at).getTime();
  const other = new Date(b.starts_at).getTime();
  return from < other + Number(b.minutes) * 60_000 && other < from + Number(a.minutes) * 60_000;
};

/** The first live booking of the same space the draft overlaps, other than itself. */
export const clashOf = <B extends Pick<Booking, "id" | "space_id" | "starts_at" | "minutes" | "state">>(draft: Draft, others: readonly B[]): B | null =>
  others.find((one) => one.id !== draft.id && Number(one.space_id) === Number(draft.space_id) && LIVE.includes(one.state) && overlaps(draft, one)) ?? null;

export type HoursProblem = "closed" | "hours" | null;

/** Whether a draft lies in the showroom's hours on a day it is open, on the business's clock. */
export function hoursProblem(draft: Pick<Draft, "starts_at" | "minutes">, week: Pick<ShowWeek, "opens" | "closes" | "days">, f: Formatters): HoursProblem {
  const start = new Date(draft.starts_at);
  const end = new Date(start.getTime() + Number(draft.minutes) * 60_000);
  const day = f.dayKey(start);
  if (!week.days.has(weekdayOf(day))) return "closed";
  if (f.dayKey(end) !== day && f.time(end) !== "00:00") return "hours";
  const from = clockMinutes(f.time(start));
  const to = f.dayKey(end) === day ? clockMinutes(f.time(end)) : 24 * 60;
  return from < clockMinutes(week.opens) || to > clockMinutes(week.closes) ? "hours" : null;
}

/** How far the dialog looks for the next clear time, in days. */
export const LOOK_AHEAD_DAYS = 21;
/** The steps a start is offered on, in minutes. */
export const STEP_MINUTES = 15;

/**
 * The first time from the one asked that is clear: the same space and length,
 * on a day the showroom opens, inside its hours, not before the server's now,
 * on the quarter-hour, up to three weeks on. Null when none is.
 */
export function nextClear(draft: Draft, others: readonly Pick<Booking, "id" | "space_id" | "starts_at" | "minutes" | "state">[], week: Pick<ShowWeek, "opens" | "closes" | "days">, now: Date, f: Formatters): Date | null {
  const asked = new Date(draft.starts_at);
  const firstDay = f.dayKey(asked);
  const opens = clockMinutes(week.opens);
  const closes = clockMinutes(week.closes);
  for (let n = 0; n <= LOOK_AHEAD_DAYS; n += 1) {
    const day = addDays(firstDay, n);
    if (!week.days.has(weekdayOf(day))) continue;
    let from = opens;
    if (n === 0) from = Math.max(opens, Math.ceil(clockMinutes(f.time(asked)) / STEP_MINUTES) * STEP_MINUTES);
    from = Math.ceil((from - opens) / STEP_MINUTES) * STEP_MINUTES + opens;
    for (let at = from; at + draft.minutes <= closes; at += STEP_MINUTES) {
      const start = f.at(day, clockOf(at));
      if (start.getTime() < now.getTime()) continue;
      if (clashOf({ ...draft, starts_at: start.toISOString() }, others) === null) return start;
    }
  }
  return null;
}

/** One space's live bookings from a day, for as far as the dialog looks: one read. */
export function readSpaceDays(session: StaffSession, spaceId: number, day: string, f: Formatters): Promise<Booking[]> {
  const from = f.at(day, "00:00").toISOString();
  const to = f.at(addDays(day, LOOK_AHEAD_DAYS + 1), "00:00").toISOString();
  return session
    .list<Booking>("showroom_bookings", {
      select: BOOKING_COLUMNS,
      where: { and: [{ column: "space_id", op: "eq", value: spaceId }, live, { column: "starts_at", op: "gte", value: from }, { column: "starts_at", op: "lt", value: to }] },
      order: ["starts_at"],
      lookup: bookingLookups(session),
      limit: 200,
    })
    .then((page) => page.rows);
}

export interface Moved {
  was: Date;
  by: string | null;
  at: Date;
}

/** The last time this booking's start was changed: the time it had, who changed it and when, from the record's own history. */
export async function lastMove(session: StaffSession, id: number): Promise<Moved | null> {
  const { entries } = await session.history("showroom_bookings", id, { limit: 50 });
  for (const entry of entries as (Omit<HistoryEntry, "createdAt"> & { createdAt: string | number })[]) {
    // Newest first: past this row's own making, the entries are of an earlier row that had the same number (SQLite gives a removed row's number again).
    if (/create|insert/i.test(entry.action)) break;
    const changes = entry.changes as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
    const before = changes?.before;
    if (before === undefined || before === null || !("starts_at" in before) || before["starts_at"] === null) continue;
    const was = new Date(String(before["starts_at"]));
    const after = changes?.after?.["starts_at"];
    // A move has a time after it: a removal's entry (and, on SQLite, one of an earlier row that had the same number) is not one.
    if (/delete|remove/i.test(entry.action) || after === undefined || after === null) continue;
    if (Number.isNaN(was.getTime()) || new Date(String(after)).getTime() === was.getTime()) continue;
    const at = new Date(typeof entry.createdAt === "number" ? entry.createdAt : /^\d+$/.test(entry.createdAt) ? Number(entry.createdAt) : entry.createdAt);
    return { was, by: entry.actorLabel, at };
  }
  return null;
}

// ── writes ────────────────────────────────────────────────────────────────

export interface NewBooking {
  space_id: number;
  contact_id: number | null;
  company_id: number | null;
  visitor_name: string | null;
  party: number;
  starts_at: string;
  minutes: number;
  rep_id: string | null;
  note: string | null;
}

/**
 * Book a visitor in, confirmed. A new booking starts "to confirm" (the
 * server's rule); the dialog confirms it at once in a second write, from the
 * state the first answered. If the first is saved and the second is not, the
 * booking is there and says so: the caller tells the person, and the list
 * offers "Confirm it".
 */
export async function bookIn(session: StaffSession, values: NewBooking, clientKey: string, confirm: boolean): Promise<{ made: Saved<Booking>; confirmed: Saved<Booking> | null }> {
  const made = await session.create<Booking>("showroom_bookings", { ...values }, clientKey);
  if (made.state !== "saved" || !confirm) return { made, confirmed: null };
  // A lost first reply read back is the row the first try made: confirmed already (a replay), or still to confirm.
  if (made.row.state === "confirmed") return { made, confirmed: made };
  return { made, confirmed: await session.act<Booking>("showroom_bookings", made.row.id, "confirm", "tentative") };
}

/** Move a booking: a new time, length, space, how many or note, named against what the dialog read, so a colleague's change in between is not written over. */
export const moveBooking = (session: StaffSession, booking: Pick<Booking, "id" | "starts_at" | "minutes" | "space_id" | "state">, values: Partial<NewBooking>): Promise<Saved<Booking>> =>
  session.update<Booking>("showroom_bookings", booking.id, values, { seen: { starts_at: booking.starts_at, minutes: booking.minutes, space_id: booking.space_id, state: booking.state } });

/**
 * Cancel a booking: each piece of display stock promised to it lets go, then
 * the row is removed with the why (plan 68 S16), which the server keeps with
 * the removed booking. A reply lost on the way back is read back (`remove`
 * answers saved once the row is no longer there), so a second press never
 * finds a booking to cancel twice; one already gone is cancelled.
 */
export async function cancelBooking(session: StaffSession, booking: Pick<Booking, "id" | "state">, why: string): Promise<Saved> {
  if (session.can("display_pieces", "read")) {
    const promised = await session.list<{ id: number }>("display_pieces", { select: ["id"], where: { column: "promised_booking_id", op: "eq", value: booking.id }, limit: 50 });
    for (const piece of promised.rows) {
      const freed = await session.update("display_pieces", piece.id, { promised_booking_id: null });
      if (freed.state !== "saved") return freed;
    }
  }
  const done = await session.remove("showroom_bookings", booking.id, { reason: why });
  if (done.state === "refused" && done.error.status === 404 && (await session.get("showroom_bookings", booking.id)) === null) return { state: "saved", row: {}, replayed: true, readBack: true };
  return done;
}

export const confirmBooking = (session: StaffSession, booking: Pick<Booking, "id" | "state">): Promise<Saved<Booking>> => session.act<Booking>("showroom_bookings", booking.id, "confirm", booking.state);
/** "They came in": a booking still to confirm, or confirmed, becomes "been in". */
export const cameIn = (session: StaffSession, booking: Pick<Booking, "id" | "state">): Promise<Saved<Booking>> => session.act<Booking>("showroom_bookings", booking.id, "done", booking.state);

/** What the visitor is told by e-mail when the dialog saves, as the server will do it (the outbox, one switch in the settings). */
export type ToldKey = "sh.told.unknown" | "sh.told.off" | "sh.told.nobody" | "sh.told.tentative" | "sh.told.new" | "sh.told.move" | "sh.told.move.same" | "sh.told.move.tentative" | "sh.told.cancel" | "sh.told.cancel.tentative";

export function toldLine(mode: "new" | "move" | "cancel", emails: ShowWeek["emails"], state: BookingState, mailable: boolean, timeMoved: boolean, confirm: boolean): ToldKey {
  if (emails === "unknown") return "sh.told.unknown";
  if (emails === "off") return "sh.told.off";
  if (!mailable) return "sh.told.nobody";
  if (mode === "new") return confirm ? "sh.told.new" : "sh.told.tentative";
  if (mode === "cancel") return state === "confirmed" ? "sh.told.cancel" : "sh.told.cancel.tentative";
  if (!timeMoved) return "sh.told.move.same";
  return state === "confirmed" ? "sh.told.move" : "sh.told.move.tentative";
}

// ── follow-ups (55) ───────────────────────────────────────────────────────

export interface FollowUps {
  rows: Booking[];
  counts: { been: number; written: number; late: number; done: number };
}

/** The bookings somebody came in for, newest first, with the server's counts: written up, next steps past their date, next steps done. */
export async function readFollowUps(session: StaffSession, now: Date, f: Formatters): Promise<FollowUps> {
  const been: Condition = { column: "state", op: "eq", value: "done" };
  const today = f.dayKey(now);
  const [page, written, late, done] = await Promise.all([
    session.list<Booking>("showroom_bookings", { select: BOOKING_COLUMNS, where: been, order: ["starts_at.desc"], lookup: bookingLookups(session), limit: 200, count: "exact" }),
    count(session, "showroom_bookings", all([been, { column: "outcome", op: "not_null" }])),
    count(session, "showroom_bookings", all([been, { column: "next_step", op: "not_null" }, { column: "next_step_done_on", op: "is_null" }, { column: "next_step_by", op: "lt", value: today }])),
    count(session, "showroom_bookings", all([been, { column: "next_step_done_on", op: "not_null" }])),
  ]);
  return { rows: page.rows, counts: { been: Number(page.total ?? page.rows.length), written, late, done } };
}

export interface WriteUp {
  outcome: string;
  next_step: string;
  next_step_by: string;
}

export const writeUp = (session: StaffSession, booking: Pick<Booking, "id" | "state">, values: WriteUp): Promise<Saved<Booking>> =>
  session.update<Booking>(
    "showroom_bookings",
    booking.id,
    { outcome: values.outcome.trim() === "" ? null : values.outcome.trim(), next_step: values.next_step.trim() === "" ? null : values.next_step.trim(), next_step_by: values.next_step_by === "" ? null : values.next_step_by },
    { seen: { state: booking.state } },
  );

export const nextStepDone = (session: StaffSession, booking: Pick<Booking, "id">, today: string): Promise<Saved<Booking>> => session.update<Booking>("showroom_bookings", booking.id, { next_step_done_on: today }, { seen: { next_step_done_on: null } });

// ── samples, loans and returns (45, 54) ──────────────────────────────────

export interface Sample extends Record<string, unknown> {
  id: number;
  name: string;
  kind: string | null;
  held: number;
  out: number;
  on_shelf: number;
}

export interface Loan extends Record<string, unknown> {
  id: number;
  sample_id: number;
  company_id: number | null;
  contact_id: number | null;
  pieces: number;
  out_on: string;
  due_back: string;
  returned_on: string | null;
  chases: number;
  sample: string | null;
  company: string | null;
  contact: string | null;
  contact_title: string | null;
  contact_phone: string | null;
}

const LOAN_COLUMNS = ["id", "sample_id", "company_id", "contact_id", "pieces", "out_on", "due_back", "returned_on", "chases"];
const LOAN_LOOKUPS = ["sample:sample_id.name", "company:company_id.name", "contact:contact_id.name", "contact_title:contact_id.job_title", "contact_phone:contact_id.phone"];
const OUT: Condition = { column: "returned_on", op: "is_null" };

export interface Library {
  samples: Sample[];
  loans: Loan[];
  figures: { held: number; out: number; shelf: number; samplesIn: number; samplesOut: number; late: number };
  loanDays: number;
}

/**
 * A sum the server works out over a table for this reader. Kept by the server
 * for half a minute, and dropped by any write to that same table: so a sum is
 * asked only of the table the screen's own writes go to (a loan's pieces, not
 * the sample's kept total, which a loan moves without dropping its figures).
 */
const sum = (session: StaffSession, table: string, column: string, filters: Condition[] = []): Promise<number> =>
  session.figure<{ value: number | null }>({ table, shape: "single-metric", filters, aggregations: [{ fn: "sum", column, alias: column }] }).then((answer) => Number(answer.value ?? 0));

export async function readLibrary(session: StaffSession, now: Date, f: Formatters): Promise<Library> {
  const today = f.dayKey(now);
  const [samples, loans, held, out, samplesIn, samplesOut, late, settings] = await Promise.all([
    session.list<Sample>("samples", { select: ["id", "name", "kind", "held", "out", "on_shelf"], order: ["name"], limit: 200 }).then((page) => page.rows),
    session.list<Loan>("sample_loans", { select: LOAN_COLUMNS, where: OUT, order: ["due_back"], lookup: LOAN_LOOKUPS, limit: 200 }).then((page) => page.rows),
    sum(session, "samples", "held"),
    sum(session, "sample_loans", "pieces", [OUT]),
    count(session, "samples", { column: "out", op: "eq", value: 0 }),
    count(session, "samples", { column: "out", op: "gt", value: 0 }),
    count(session, "sample_loans", all([OUT, { column: "due_back", op: "lt", value: today }])),
    session.can("settings", "read") ? session.list<{ loan_days: number | null }>("settings", { select: ["loan_days"], limit: 1 }).then((page) => page.rows[0] ?? null) : Promise.resolve(null),
  ]);
  // On the shelf is what is held less what is out: two figures of the server's, subtracted (as decisions 106 and 148).
  return { samples, loans, figures: { held, out, shelf: held - out, samplesIn, samplesOut, late }, loanDays: Number(settings?.loan_days ?? 14) || 14 };
}

/** Days a loan is past its day back, by the business's calendar (0 or less: not late). */
export const daysLate = (loan: Pick<Loan, "due_back">, now: Date, f: Formatters): number => f.dayDiff(new Date(`${loan.due_back}T12:00:00Z`), now);
/** Days a loan has been away. */
export const daysAway = (loan: Pick<Loan, "out_on">, now: Date, f: Formatters): number => f.dayDiff(new Date(`${loan.out_on}T12:00:00Z`), now);

export interface Lendable {
  id: number;
  name: string;
}

/** Book a piece of a sample out to a contact (and the contact's company), back after the settings' loan days. */
export function lend(session: StaffSession, sample: Pick<Sample, "id">, to: { company_id: number | null; contact_id: number | null }, today: string, loanDays: number, clientKey: string): Promise<Saved<Loan>> {
  return session.create<Loan>("sample_loans", { sample_id: sample.id, company_id: to.company_id, contact_id: to.contact_id, pieces: 1, out_on: today, due_back: addDays(today, loanDays) }, clientKey);
}

/** "It came back": the loan is returned today, and its piece is on the shelf again (the server's sum). */
export const cameBack = (session: StaffSession, loan: Pick<Loan, "id">, today: string): Promise<Saved<Loan>> => session.update<Loan>("sample_loans", loan.id, { returned_on: today }, { seen: { returned_on: null } });

export interface Chase extends Record<string, unknown> {
  id: number;
  loan_id: number;
  chased_on: string;
  by_id: string;
}

export interface Returns {
  loans: Loan[];
  chases: Chase[];
  figures: { pieces: number; accounts: number; late: number; chases: number };
}

/** The loans not back yet, longest away first, each with its chases; and the server's figures over them. */
export async function readReturns(session: StaffSession, now: Date, f: Formatters): Promise<Returns> {
  const today = f.dayKey(now);
  const [loans, pieces, late, accounts] = await Promise.all([
    session.list<Loan>("sample_loans", { select: LOAN_COLUMNS, where: OUT, order: ["out_on", "id"], lookup: LOAN_LOOKUPS, limit: 200 }).then((page) => page.rows),
    sum(session, "sample_loans", "pieces", [OUT]),
    count(session, "sample_loans", all([OUT, { column: "due_back", op: "lt", value: today }])),
    session.figure<{ items: unknown[] }>({ table: "sample_loans", shape: "categorical", filters: [OUT], aggregations: [{ fn: "count", alias: "loans" }], groupBy: ["company_id"] }).then((answer) => answer.items.length),
  ]);
  // The chases of the loans still out, and how many there are: the list's own total, never a figure kept from before the last chase.
  const chases =
    loans.length === 0 || !session.can("sample_chases", "read")
      ? { rows: [] as Chase[], total: 0 }
      : await session.list<Chase>("sample_chases", { select: ["id", "loan_id", "chased_on", "by_id"], where: { column: "loan_id", op: "in", value: loans.map((loan) => loan.id) }, order: ["chased_on", "id"], limit: 200, count: "exact" });
  return { loans, chases: chases.rows, figures: { pieces, accounts, late, chases: Number(chases.total ?? chases.rows.length) } };
}

export const chase = (session: StaffSession, loan: Pick<Loan, "id">, today: string, clientKey: string): Promise<Saved<Chase>> => session.create<Chase>("sample_chases", { loan_id: loan.id, chased_on: today }, clientKey);

// ── display stock (61) ───────────────────────────────────────────────────

export interface Piece extends Record<string, unknown> {
  id: number;
  name: string;
  space_id: number;
  out_since: string;
  spec: "current" | "old";
  promised_booking_id: number | null;
  lent_company_id: number | null;
  lent_until: string | null;
  space: string | null;
  promised_at: string | null;
  promised_company: string | null;
  promised_visitor: string | null;
  lent_company: string | null;
}

export interface Floor {
  pieces: Piece[];
  spaces: Space[];
  tiredMonths: number;
  figures: { all: number; floor: number; lent: number; promised: number; tired: number; bySpace: Record<number, number> };
}

/** How many months a piece has been out, rounded as the ledger does (days over 30.44). */
export const monthsOut = (piece: Pick<Piece, "out_since">, now: Date, f: Formatters): number => Math.round(f.dayDiff(new Date(`${piece.out_since}T12:00:00Z`), now) / 30.44);

/** Tired: old spec, or out for the setting's months or more. */
export const isTired = (piece: Pick<Piece, "spec" | "out_since">, tiredMonths: number, now: Date, f: Formatters): boolean => piece.spec === "old" || monthsOut(piece, now, f) >= tiredMonths;

export async function readFloor(session: StaffSession, now: Date, f: Formatters): Promise<Floor> {
  const [settings, spaces] = await Promise.all([
    session.can("settings", "read") ? session.list<{ display_tired_months: number | null }>("settings", { select: ["display_tired_months"], limit: 1 }).then((page) => page.rows[0] ?? null) : Promise.resolve(null),
    readSpaces(session),
  ]);
  const tiredMonths = Number(settings?.display_tired_months ?? 10) || 10;
  // "Out N months or more", where N months is the ledger's 30.44 days each, as a day the server can compare with.
  const since = addDays(f.dayKey(now), -Math.ceil((tiredMonths - 0.5) * 30.44));
  const lookups = ["space:space_id.name", "promised_at:promised_booking_id.starts_at", "promised_company:promised_booking_id.company_id.name", "promised_visitor:promised_booking_id.visitor_name", "lent_company:lent_company_id.name"];
  const [page, floor, lent, promised, tired, ...bySpace] = await Promise.all([
    session.list<Piece>("display_pieces", { order: ["out_since", "id"], lookup: lookups, limit: 200, count: "exact" }),
    count(session, "display_pieces", { column: "lent_company_id", op: "is_null" }),
    count(session, "display_pieces", { column: "lent_company_id", op: "not_null" }),
    count(session, "display_pieces", { column: "promised_booking_id", op: "not_null" }),
    count(session, "display_pieces", { or: [{ column: "spec", op: "eq", value: "old" }, { column: "out_since", op: "lte", value: since }] }),
    ...spaces.map((space) => count(session, "display_pieces", { column: "space_id", op: "eq", value: space.id })),
  ]);
  return {
    pieces: page.rows,
    spaces,
    tiredMonths,
    figures: { all: Number(page.total ?? page.rows.length), floor, lent, promised, tired, bySpace: Object.fromEntries(spaces.map((space, i) => [space.id, bySpace[i] ?? 0])) },
  };
}

/** "Swap it out": a fresh piece of the current range goes on the floor today, so the clock starts again. */
export const swapOut = (session: StaffSession, piece: Pick<Piece, "id" | "out_since" | "spec">, today: string): Promise<Saved<Piece>> =>
  session.update<Piece>("display_pieces", piece.id, { out_since: today, spec: "current" }, { seen: { out_since: piece.out_since, spec: piece.spec } });

// ── the front desk's home ─────────────────────────────────────────────────

export interface DeskHome {
  soon: Booking[];
  /** Live bookings today and tomorrow: the list's own total. */
  soonCount: number;
  today: number;
  tomorrow: number;
  late: Loan[];
  lateCount: number;
}

/** Today's and tomorrow's live bookings, and the loans late back: what the front desk's day turns on. */
export async function readDeskHome(session: StaffSession, now: Date, f: Formatters): Promise<DeskHome> {
  const today = f.dayKey(now);
  const from = f.at(today, "00:00").toISOString();
  const mid = f.at(addDays(today, 1), "00:00").toISOString();
  const to = f.at(addDays(today, 2), "00:00").toISOString();
  const [soon, onToday, onTomorrow, late] = await Promise.all([
    session.list<Booking>("showroom_bookings", { select: BOOKING_COLUMNS, where: all([live, { column: "starts_at", op: "gte", value: from }, { column: "starts_at", op: "lt", value: to }]), order: ["starts_at"], lookup: bookingLookups(session), limit: 50, count: "exact" }),
    count(session, "showroom_bookings", all([live, { column: "starts_at", op: "gte", value: from }, { column: "starts_at", op: "lt", value: mid }])),
    count(session, "showroom_bookings", all([live, { column: "starts_at", op: "gte", value: mid }, { column: "starts_at", op: "lt", value: to }])),
    session.can("sample_loans", "read") ? session.list<Loan>("sample_loans", { select: LOAN_COLUMNS, where: all([OUT, { column: "due_back", op: "lt", value: today }]), order: ["due_back"], lookup: LOAN_LOOKUPS, limit: 50, count: "exact" }) : Promise.resolve({ rows: [] as Loan[], total: 0, next: null }),
  ]);
  return { soon: soon.rows, soonCount: Number(soon.total ?? soon.rows.length), today: onToday, tomorrow: onTomorrow, late: late.rows, lateCount: Number(late.total ?? late.rows.length) };
}
