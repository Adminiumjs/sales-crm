/**
 * TIME SHEETS AND TRAINING (P25, part B): what the office's Time sheets and
 * Training and the crew's My hours and My certificates read, and how a week is
 * sent, sent back, signed off, and a certificate added or renewed.
 *
 * WHO COUNTS. The server. A week's hours are kept on its sheet by the server
 * (`hours_total`, `travel_total` add the lines up; `total_hours` is the two
 * together), and every count on a screen is a figure asked of the server for
 * the reader's rows. The browser compares a day with the server's today (run
 * out, runs out soon) and subtracts one from the other (days left).
 *
 * WHO MAY. The server: a crew member reads and writes his own sheets and their
 * lines only, and sends a week (open or sent back → sent); the operations
 * manager and the CRM admin sign a sent week off or send it back with a note;
 * a signed-off week changes no more. Certificates are read by their holder and
 * by the office (`proofs/crm-hours.test.ts`).
 *
 * A LOST REPLY. A sheet, a line and a certificate are made with a retry key; a
 * move names the state it starts from, and is read back.
 */
import { addDays, weekOf } from "../../lib/format.ts";
import type { Condition, Grouped, Row, Saved, StaffSession } from "../../staffSession.ts";
import { DAYS, workDaysOf, type Day } from "../appsettings/data.ts";
import { dayKeyOf, num, truthy } from "../jobs/data.ts";

export { dayKeyOf, num, truthy };

export type SheetState = "open" | "sent" | "signed-off" | "sent-back";
export const SHEET_STATES: readonly SheetState[] = ["open", "sent", "sent-back", "signed-off"];

export interface Sheet extends Row {
  id: number;
  user_id: string;
  week_of: string;
  state: SheetState;
  signed_by_id: string | null;
  signed_at: string | null;
  sent_at: string | null;
  sent_back_note: string | null;
  hours_total: number | string | null;
  travel_total: number | string | null;
  total_hours: number | string | null;
}

export interface SheetLine extends Row {
  id: number;
  sheet_id: number;
  day: string;
  what: string;
  hours: number | string;
  travel_hours: number | string;
  visit_id: number | null;
  job_id: number | null;
}

export interface Certificate extends Row {
  id: number;
  user_id: string;
  name: string;
  valid_until: string;
  course_on: string | null;
}

const SHEET_COLUMNS = ["id", "user_id", "week_of", "state", "signed_by_id", "signed_at", "sent_at", "sent_back_note", "hours_total", "travel_total", "total_hours"];
const LINE_COLUMNS = ["id", "sheet_id", "day", "what", "hours", "travel_hours", "visit_id", "job_id"];
const CERT_COLUMNS = ["id", "user_id", "name", "valid_until", "course_on"];

/** Monday of the week a day falls in. */
export const mondayOf = (day: string): string => weekOf(day)[0];
/** The seven days of the week that starts on a Monday. */
export const daysOf = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
/** The week a time sheet is for, from an address (`time-sheets/2026-07-20`) or, with none, the week just gone. */
export function weekAsked(rest: readonly string[], today: string): string {
  const asked = rest[0];
  if (asked !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(`${asked}T00:00:00Z`))) return mondayOf(asked);
  return mondayOf(addDays(today, -7));
}

/* ─── The settings a screen reads: the working week, the certificate warning ─── */

export interface HoursSettings {
  /** The business's working days. */
  workDays: Set<Day>;
  /** A working day's hours (Settings → Working time). */
  dayHours: number;
  /** Days before a certificate runs out that it is said to run out soon. */
  warnDays: number;
}

/** The settings row's few columns these screens need. Somebody who may not read the settings counts Monday to Friday, 8 hours, 42 days. */
export async function readHoursSettings(session: StaffSession): Promise<HoursSettings> {
  const row = session.can("settings", "read")
    ? await session
        .list<Row>("settings", { select: ["id", "working_day_hours", "certificate_warn_days", ...DAYS.map((day) => `work_${day}`)], limit: 1 })
        .then((page) => page.rows[0] ?? null)
        .catch(() => null)
    : null;
  const hours = num(row?.["working_day_hours"]);
  const warn = num(row?.["certificate_warn_days"]);
  return { workDays: workDaysOf(row), dayHours: hours > 0 ? hours : 8, warnDays: warn > 0 ? warn : 42 };
}

/** A working week's hours: the settings' day times its working days. Above it, a week is "over the week". */
export const weekHours = (settings: Pick<HoursSettings, "workDays" | "dayHours">): number => settings.dayHours * settings.workDays.size;

/** The last working day of a week: the week is over once today is past it. */
export function lastWorkingDay(monday: string, workDays: ReadonlySet<Day>): string {
  const days = daysOf(monday);
  // By the day each date is, not its place in the week: the week may start on any day (S9).
  for (let i = 6; i >= 0; i -= 1) if (workDays.has(DAYS[(new Date(`${days[i]!}T12:00:00Z`).getUTCDay() + 6) % 7]!)) return days[i]!;
  return days[6]!;
}

/* ─── Time sheets ─── */

/** The sheets of one week the reader reaches: everybody's for the office, his own for a crew member. */
export async function readWeekSheets(session: StaffSession, monday: string, user: string | null = null): Promise<Sheet[]> {
  // Any sheet whose week falls in this one: a sheet made before the business moved its first day keeps its old one (S9).
  const week: Condition = { column: "week_of", op: "between", value: [monday, addDays(monday, 6)] };
  const where: Condition = user === null ? week : { and: [week, { column: "user_id", op: "eq", value: user }] };
  return (await session.list<Sheet>("time_sheets", { select: SHEET_COLUMNS, where, order: ["id"], limit: 200 })).rows;
}

/** The lines of some sheets, by day. */
export async function readLines(session: StaffSession, sheets: readonly number[]): Promise<SheetLine[]> {
  if (sheets.length === 0) return [];
  return (await session.list<SheetLine>("time_sheet_lines", { select: LINE_COLUMNS, where: { column: "sheet_id", op: "in", value: [...sheets] }, order: ["day", "id"], limit: 200 })).rows;
}

export interface WeekFigures {
  /** Hours on the job and travel, over every sheet of the week the reader reaches: the server's sums of its kept totals. */
  onJob: number;
  travel: number;
  sheets: number;
  /** Sheets sent and waiting for a sign-off. */
  toSign: number;
  /** Sheets whose hours in all are over a working week. */
  over: number;
  /** The week's lines: all of them, those on a job (and how many a job), the days off. */
  lines: number;
  onAJob: number;
  byJob: { key: string; label: string; count: number }[];
  daysOff: number;
}

const value = (figure: { value?: number | null }): number => num(figure.value);

/** Every figure of a week, in one batch: the server's, for the rows the reader reaches. */
export async function readWeekFigures(session: StaffSession, monday: string, over: number): Promise<WeekFigures> {
  const week: Condition = { column: "week_of", op: "between", value: [monday, addDays(monday, 6)] };
  const days: Condition = { column: "day", op: "between", value: [monday, addDays(monday, 6)] };
  const one = (table: string, filters: Condition[], aggregation: { fn: "count" | "sum"; column?: string }): Promise<number> =>
    session.figure<{ value?: number | null }>({ table, shape: "single-metric", filters, aggregations: [{ ...aggregation, alias: "v" }] }).then(value);
  const jobs = session.can("jobs", "read");
  const [onJob, travel, sheets, toSign, overN, lines, onAJob, daysOff, byJob] = await Promise.all([
    one("time_sheets", [week], { fn: "sum", column: "hours_total" }),
    one("time_sheets", [week], { fn: "sum", column: "travel_total" }),
    one("time_sheets", [week], { fn: "count" }),
    one("time_sheets", [week, { column: "state", op: "eq", value: "sent" }], { fn: "count" }),
    one("time_sheets", [week, { column: "total_hours", op: "gt", value: over }], { fn: "count" }),
    one("time_sheet_lines", [days], { fn: "count" }),
    one("time_sheet_lines", [days, { column: "job_id", op: "gt", value: 0 }], { fn: "count" }),
    one("time_sheet_lines", [days, { column: "hours", op: "eq", value: 0 }, { column: "travel_hours", op: "eq", value: 0 }], { fn: "count" }),
    // Which job a line was on, by the job's code: only for somebody who reads the jobs (a crew member does not).
    jobs
      ? session.figure<Grouped>({ table: "time_sheet_lines", shape: "categorical", filters: [days, { column: "job_id", op: "gt", value: 0 }], groupBy: ["job_id"], groupLabel: "job_id.code", aggregations: [{ fn: "count", alias: "n" }], limit: 50 })
      : Promise.resolve(null),
  ]);
  return {
    onJob,
    travel,
    sheets,
    toSign,
    over: overN,
    lines,
    onAJob,
    daysOff,
    byJob: (byJob?.items ?? []).map((item) => ({ key: String(item.key), label: item.label ?? String(item.key), count: num(item.values?.["n"] ?? item.value) })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** The codes of the jobs some lines were on, for the reader who reads jobs: by job id. */
export async function readJobCodes(session: StaffSession, lines: readonly SheetLine[]): Promise<Map<number, string>> {
  const ids = [...new Set(lines.map((line) => line.job_id).filter((id): id is number => id !== null && id !== undefined))];
  if (ids.length === 0 || !session.can("jobs", "read")) return new Map();
  const page = await session.list<{ id: number; code: string | null }>("jobs", { select: ["id", "code"], where: { column: "id", op: "in", value: ids }, limit: 200 });
  return new Map(page.rows.filter((row) => row.code !== null).map((row) => [row.id, row.code!]));
}

/** Sign a sent week off. */
export const signSheet = (session: StaffSession, sheet: Pick<Sheet, "id">): Promise<Saved<Sheet>> => session.act<Sheet>("time_sheets", sheet.id, "sign-off", "sent");
/** Send a sent week back, with the reason the crew member reads. */
export const sendBack = (session: StaffSession, sheet: Pick<Sheet, "id">, note: string): Promise<Saved<Sheet>> => session.act<Sheet>("time_sheets", sheet.id, "send-back", "sent", { values: { sent_back_note: note.trim() } });
/** Send one's own week for sign-off, from the state the screen saw. */
export const sendSheet = (session: StaffSession, sheet: Pick<Sheet, "id" | "state">): Promise<Saved<Sheet>> => session.act<Sheet>("time_sheets", sheet.id, "send", sheet.state);

/** Whether a week is still its maker's to change: open, or sent back. */
export const editable = (state: SheetState): boolean => state === "open" || state === "sent-back";

/** A crew member's own week, made the first time he writes a day of it. */
export const makeSheet = (session: StaffSession, user: string, monday: string, key: string): Promise<Saved<Sheet>> => session.create<Sheet>("time_sheets", { user_id: user, week_of: monday }, key);

export interface LineDraft {
  day: string;
  what: string;
  hours: number;
  travel: number;
  visitId: number | null;
}

/** A day's line, written to a sheet. */
export const addLine = (session: StaffSession, sheet: number, draft: LineDraft, key: string): Promise<Saved<SheetLine>> =>
  session.create<SheetLine>("time_sheet_lines", { sheet_id: sheet, day: draft.day, what: draft.what.trim(), hours: draft.hours, travel_hours: draft.travel, visit_id: draft.visitId }, key);

/** A day's line changed. */
export const changeLine = (session: StaffSession, line: Pick<SheetLine, "id">, draft: LineDraft): Promise<Saved<SheetLine>> =>
  session.update<SheetLine>("time_sheet_lines", line.id, { day: draft.day, what: draft.what.trim(), hours: draft.hours, travel_hours: draft.travel, visit_id: draft.visitId });

/** Hours as typed (a comma or a point), between 0 and 24, in quarters at most two places: null when it is not. */
export function readHours(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (clean === "") return 0;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(clean)) return null;
  const hours = Number(clean);
  return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? hours : null;
}

/* ─── Certificates ─── */

export type CertState = "out" | "soon" | "ok";

/** Run out (its last day is before today), runs out within the warning days, or in date. */
export function certState(validUntil: string, today: string, warnDays: number): CertState {
  const until = dayKeyOf(validUntil) ?? validUntil;
  if (until < today) return "out";
  return until <= addDays(today, warnDays) ? "soon" : "ok";
}

/** Whole days from today to a day: negative once it has passed. */
export const daysFrom = (today: string, day: string): number => Math.round((Date.parse(`${dayKeyOf(day) ?? day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/** The certificates the reader reaches, soonest to run out first. */
export async function readCertificates(session: StaffSession): Promise<Certificate[]> {
  return (await session.list<Certificate>("certificates", { select: CERT_COLUMNS, order: ["valid_until", "id"], limit: 200 })).rows;
}

export interface CertFigures {
  all: number;
  out: number;
  soon: number;
  /** How many kinds (names) of certificate there are. */
  kinds: number;
  /** Per person: how many have run out, how many run out soon. */
  outBy: Record<string, number>;
  soonBy: Record<string, number>;
}

const byPerson = (figure: Grouped): Record<string, number> => Object.fromEntries(figure.items.map((item) => [String(item.key), num(item.values?.["n"] ?? item.value)]));

/** The certificate counts, the server's for the reader's rows: in one batch. */
export async function readCertFigures(session: StaffSession, today: string, warnDays: number, perPerson: boolean): Promise<CertFigures> {
  const outF: Condition = { column: "valid_until", op: "lt", value: today };
  const soonF: Condition = { column: "valid_until", op: "between", value: [today, addDays(today, warnDays)] };
  const count = (filters: Condition[]): Promise<number> => session.figure<{ value?: number | null }>({ table: "certificates", shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] }).then(value);
  const grouped = (filters: Condition[], by: string): Promise<Grouped> => session.figure<Grouped>({ table: "certificates", shape: "categorical", filters, groupBy: [by], aggregations: [{ fn: "count", alias: "n" }], limit: 200 });
  const empty: Grouped = { shape: "categorical", items: [], total: 0 };
  const [all, out, soon, kinds, outBy, soonBy] = await Promise.all([
    count([]),
    count([outF]),
    count([soonF]),
    perPerson ? grouped([], "name") : Promise.resolve(empty),
    perPerson ? grouped([outF], "user_id") : Promise.resolve(empty),
    perPerson ? grouped([soonF], "user_id") : Promise.resolve(empty),
  ]);
  return { all, out, soon, kinds: kinds.items.length, outBy: byPerson(outBy), soonBy: byPerson(soonBy) };
}

/** A certificate given to somebody. */
export const addCertificate = (session: StaffSession, user: string, name: string, validUntil: string, key: string): Promise<Saved<Certificate>> =>
  session.create<Certificate>("certificates", { user_id: user, name: name.trim(), valid_until: validUntil }, key);

/** A certificate's dates changed: renewed (a new last day, the course done) or a course booked. Named from the day the screen saw. */
export const changeCertificate = (session: StaffSession, cert: Pick<Certificate, "id" | "valid_until">, values: { valid_until?: string; course_on?: string | null }): Promise<Saved<Certificate>> =>
  session.update<Certificate>("certificates", cert.id, values, { seen: { valid_until: dayKeyOf(cert.valid_until) ?? cert.valid_until } });

export const removeCertificate = (session: StaffSession, cert: Pick<Certificate, "id">): Promise<Saved<Row>> => session.remove("certificates", cert.id);

/** A day key typed into a date field: `2026-09-01`, or null. */
export const isDay = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
