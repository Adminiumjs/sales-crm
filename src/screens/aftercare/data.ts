/**
 * WHAT "AFTER THE JOB" READS AND WRITES: Aftercare calls, What customers said,
 * Complaints, Warranty claims, and the account manager's aftercare tiles.
 *
 * WHO ADDS UP. The server: every count, average and group here is a figure it
 * answers for the reader's own rows (`session.figure`). What this file does
 * itself is pick rows and work with days: which state a row's buttons start
 * from, how many days a claim was raised after its job was fitted, whether its
 * cover still held on that day, and how long a row has waited (a day the
 * server gave, taken from the server's own today).
 *
 * A ROW HANGS ON A JOB. A job is "Jobs on site"'s table: its code, its title,
 * its company and contact (copied from the won deal), the day it was signed
 * off and the day it was fitted are read only where the reader reads those
 * tables, and a row whose job cannot be read is still listed, without them.
 */
import type { Condition, Grouped, Row, Saved, StaffError, StaffSession } from "../../staffSession.ts";
import { readNames } from "../quotes/data.ts";

export const LISTED = 200;
/** How many rows each list of the account manager's home shows. */
export const HOME_ROWS = 20;

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (value: unknown): number | null => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const textOf = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
/** A date column as its day: `2026-07-28` (a driver may answer a whole timestamp). */
export const dayOf = (value: unknown): string | null => (typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null);

async function single(session: StaffSession, table: string, filters: Condition[], aggregation: { fn: "count" | "sum" | "avg"; column?: string } = { fn: "count" }): Promise<number | null> {
  const value = (await session.figure<{ value: number | null }>({ table, shape: "single-metric", filters, aggregations: [{ ...aggregation, alias: "v" }] })).value;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}
const count = async (session: StaffSession, table: string, filters: Condition[]): Promise<number> => (await single(session, table, filters)) ?? 0;

/** A count of a table's rows by the values of one column, as the server groups them: the rows with no value are the key `null`. */
async function grouped(session: StaffSession, table: string, column: string, filters: Condition[] = []): Promise<Map<string | null, number>> {
  const answer = await session.figure<Grouped>({ table, shape: "categorical", filters, groupBy: [column], aggregations: [{ fn: "count", alias: "n" }], limit: LISTED });
  const out = new Map<string | null, number>();
  for (const item of answer.items) {
    // The server names the group of rows with no value `__null`.
    const key = item.key === null || item.key === undefined || item.key === "" || item.key === "__null" ? null : String(item.key);
    out.set(key, (out.get(key) ?? 0) + num(item.values?.["n"] ?? item.value));
  }
  return out;
}

// ── days ──────────────────────────────────────────────────────────────────────

/** Whole days from one day key to another. */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** A day some days on (back, when `days` is below nothing). */
export function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The same day some years on: the 29th of February lands on the 28th. */
export function addYears(dayKey: string, years: number): string {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return `${String(year + years).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * Whether a claim's cover still held on the day it was raised: the job was
 * fitted, and the part is covered for so many years from that day. Unknown
 * when the fitting day or the years are not there.
 */
export function inCover(fittedOn: string | null, years: number | null, raisedOn: string | null): boolean | null {
  if (fittedOn === null || years === null || raisedOn === null) return null;
  return raisedOn <= addYears(fittedOn, years);
}

// ── the settings these pages read ─────────────────────────────────────────────

export interface AfterSettings {
  /** Days after sign-off an aftercare call falls due. */
  aftercareDays: number | null;
  /** Days a complaint may wait for an answer. */
  answerDays: number;
  /** Days a warranty claim may run before it is shown in red. */
  claimRedDays: number;
}

async function readSettings(session: StaffSession): Promise<AfterSettings> {
  const fallback: AfterSettings = { aftercareDays: null, answerDays: 3, claimRedDays: 21 };
  if (!session.can("settings", "read")) return fallback;
  const row = (await session.list<Row>("settings", { select: ["aftercare_days", "complaint_answer_days", "claim_red_days"], limit: 1 })).rows[0];
  if (row === undefined) return fallback;
  const whole = (value: unknown, otherwise: number): number => {
    const n = Number(value);
    return value !== null && value !== undefined && Number.isInteger(n) && n > 0 ? n : otherwise;
  };
  return { aftercareDays: whole(row["aftercare_days"], 0) || null, answerDays: whole(row["complaint_answer_days"], 3), claimRedDays: whole(row["claim_red_days"], 21) };
}

// ── jobs, their companies and their people ────────────────────────────────────

export interface Job {
  id: number;
  code: string | null;
  title: string | null;
  companyId: number | null;
  company: string | null;
  contactId: number | null;
  contact: string | null;
  contactTitle: string | null;
  /** Whose won deal the job came from. */
  ownerId: string | null;
  /** When the customer signed the job off. */
  signedAt: string | null;
  /** The day it was fitted: its install visit. */
  fittedOn: string | null;
}

interface JobRow extends Row {
  id: number;
  code: string | null;
  title: string | null;
  company_id: number | null;
  contact_id: number | null;
  owner?: string | null;
}

/** Everything these pages say of the jobs they name, read as the reader reads it: a table they do not read leaves its part empty. */
export async function readJobs(session: StaffSession, ids: readonly number[]): Promise<Map<number, Job>> {
  const out = new Map<number, Job>();
  const wanted = [...new Set(ids)].filter((id) => Number.isFinite(id));
  if (wanted.length === 0) return out;
  const inJobs: Condition = { column: "job_id", op: "in", value: wanted };
  const [jobs, signed, fitted] = await Promise.all([
    session.can("jobs", "read")
      ? session.list<JobRow>("jobs", {
          select: ["id", "code", "title", "company_id", "contact_id"],
          where: { column: "id", op: "in", value: wanted },
          ...(session.can("deals", "read") ? { lookup: ["owner:deal_id.owner_id"] } : {}),
          limit: LISTED,
        })
      : null,
    session.can("sign_offs", "read") ? session.list<{ job_id: number; signed_at: string | null }>("sign_offs", { select: ["job_id", "signed_at"], where: inJobs, limit: LISTED }) : null,
    session.can("job_visits", "read")
      ? session.list<{ job_id: number; day: string | null }>("job_visits", { select: ["job_id", "day"], where: { and: [inJobs, { column: "kind", op: "eq", value: "install" }] }, order: ["day", "id"], limit: LISTED })
      : null,
  ]);
  for (const id of wanted) out.set(id, { id, code: null, title: null, companyId: null, company: null, contactId: null, contact: null, contactTitle: null, ownerId: null, signedAt: null, fittedOn: null });
  for (const row of jobs?.rows ?? []) {
    const job = out.get(Number(row.id));
    if (job === undefined) continue;
    Object.assign(job, { code: textOf(row.code), title: textOf(row.title), companyId: idOf(row.company_id), contactId: idOf(row.contact_id), ownerId: textOf(row.owner) });
  }
  for (const row of signed?.rows ?? []) {
    const job = out.get(Number(row.job_id));
    if (job !== undefined && row.signed_at !== null) job.signedAt = row.signed_at;
  }
  // The first install visit with a day: when the job was fitted.
  for (const row of fitted?.rows ?? []) {
    const job = out.get(Number(row.job_id));
    const day = dayOf(row.day);
    if (job !== undefined && job.fittedOn === null && day !== null) job.fittedOn = day;
  }
  const companyIds = [...new Set([...out.values()].flatMap((job) => (job.companyId === null ? [] : [job.companyId])))];
  const contactIds = [...new Set([...out.values()].flatMap((job) => (job.contactId === null ? [] : [job.contactId])))];
  const [companies, contacts] = await Promise.all([
    companyIds.length > 0 && session.can("companies", "read") ? session.list<{ id: number; name: string }>("companies", { select: ["id", "name"], where: { column: "id", op: "in", value: companyIds }, limit: LISTED }) : null,
    contactIds.length > 0 && session.can("contacts", "read") ? session.list<{ id: number; name: string; job_title: string | null }>("contacts", { select: ["id", "name", "job_title"], where: { column: "id", op: "in", value: contactIds }, limit: LISTED }) : null,
  ]);
  const companyName = new Map((companies?.rows ?? []).map((row) => [Number(row.id), row.name]));
  const contactOf = new Map((contacts?.rows ?? []).map((row) => [Number(row.id), row]));
  for (const job of out.values()) {
    if (job.companyId !== null) job.company = companyName.get(job.companyId) ?? null;
    const contact = job.contactId === null ? undefined : contactOf.get(job.contactId);
    if (contact !== undefined) Object.assign(job, { contact: contact.name, contactTitle: textOf(contact.job_title) });
  }
  return out;
}

/** The day a job is done for aftercare: signed off, else fitted. */
export const doneOn = (job: Job | null): string | null => (job === null ? null : job.signedAt !== null ? dayOf(job.signedAt) : job.fittedOn);

// ── Aftercare calls ──────────────────────────────────────────────────────────

const AFTERCARE: Condition = { column: "kind", op: "eq", value: "aftercare" };
const MADE: Condition = { column: "done", op: "eq", value: true };
const NOT_MADE: Condition = { column: "done", op: "eq", value: false };

export type CallState = "late" | "soon" | "made";
export type Outcome = "none" | "more-work" | "fault" | "complaint";
export const OUTCOMES: readonly Outcome[] = ["none", "more-work", "fault", "complaint"];

export interface Call {
  id: number;
  jobId: number | null;
  job: Job | null;
  ownerId: string | null;
  dueAt: string;
  text: string | null;
  callNo: number | null;
  outcome: Outcome | null;
  done: boolean;
  doneAt: string | null;
  state: CallState;
}

interface CallRow extends Row {
  id: number;
  job_id: number | null;
  owner_id: string | null;
  due_at: string;
  text: string | null;
  call_no: number | null;
  outcome: string | null;
  done: boolean | number | string;
  done_at: string | null;
}

const isTrue = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "true";

/** Where a call stands at a moment: made, past its due moment, or still to come. */
export function callState(done: boolean, dueAt: string, now: Date): CallState {
  if (done) return "made";
  return Date.parse(dueAt) < now.getTime() ? "late" : "soon";
}

/** The order the page lists calls in: past due first (the oldest first), then the ones to come (soonest first), then the ones made (latest first). */
export function byCallOrder(a: Call, b: Call): number {
  const rank: Record<CallState, number> = { late: 0, soon: 1, made: 2 };
  if (a.state !== b.state) return rank[a.state] - rank[b.state];
  const diff = Date.parse(a.dueAt) - Date.parse(b.dueAt);
  return (a.state === "made" ? -diff : diff) || a.id - b.id;
}

const callOf = (row: CallRow, jobs: Map<number, Job>, now: Date): Call => {
  const jobId = idOf(row.job_id);
  const done = isTrue(row.done);
  const outcome = OUTCOMES.includes(row.outcome as Outcome) ? (row.outcome as Outcome) : null;
  return { id: Number(row.id), jobId, job: jobId === null ? null : (jobs.get(jobId) ?? null), ownerId: textOf(row.owner_id), dueAt: row.due_at, text: textOf(row.text), callNo: row.call_no === null ? null : num(row.call_no), outcome, done, doneAt: row.done_at, state: callState(done, row.due_at, now) };
};

const CALL_SELECT = ["id", "job_id", "owner_id", "due_at", "text", "call_no", "outcome", "done", "done_at"];

export interface Calls {
  total: number;
  made: number;
  late: number;
  soon: number;
  /** Made calls that led to more work. */
  moreWork: number;
  rows: Call[];
  names: Record<string, string>;
  settings: AfterSettings;
  cut: boolean;
}

export async function readCalls(session: StaffSession): Promise<Calls> {
  const now = session.now();
  const at = now.toISOString();
  const [total, made, late, soon, moreWork, page, settings] = await Promise.all([
    count(session, "follow_ups", [AFTERCARE]),
    count(session, "follow_ups", [AFTERCARE, MADE]),
    count(session, "follow_ups", [AFTERCARE, NOT_MADE, { column: "due_at", op: "lt", value: at }]),
    count(session, "follow_ups", [AFTERCARE, NOT_MADE, { column: "due_at", op: "gte", value: at }]),
    count(session, "follow_ups", [AFTERCARE, MADE, { column: "outcome", op: "eq", value: "more-work" }]),
    session.list<CallRow>("follow_ups", { select: CALL_SELECT, where: AFTERCARE, order: ["due_at", "id"], limit: LISTED, count: "exact" }),
    readSettings(session),
  ]);
  const [jobs, names] = await Promise.all([readJobs(session, page.rows.flatMap((row) => (idOf(row.job_id) === null ? [] : [Number(row.job_id)]))), readNames(session, page.rows.map((row) => row.owner_id))]);
  const rows = page.rows.map((row) => callOf(row, jobs, now)).sort(byCallOrder);
  return { total, made, late, soon, moreWork, rows, names, settings, cut: (page.total ?? rows.length) > rows.length };
}

export type Ended = { state: "saved"; mine: boolean } | { state: "refused"; error: StaffError } | { state: "unknown" };

/**
 * A change made once: sent only while the row still reads as `seen`, so two
 * people pressing at once make one change. A reply that is lost, or a refusal
 * because the row moved, is read back before anything is said: a row that
 * reads as `done` was changed, by this press or a colleague's.
 */
async function once(session: StaffSession, ref: string, id: number, values: Row, seen: Row, done: (row: Row) => boolean): Promise<Ended> {
  const saved = await session.update(ref, id, values, { seen });
  if (saved.state === "saved") return { state: "saved", mine: true };
  if (saved.state === "refused" && saved.error.status !== 409) return saved;
  const row = await session.get(ref, id).catch(() => undefined);
  if (row === undefined) return saved.state === "refused" ? saved : { state: "unknown" };
  if (row !== null && done(row)) return { state: "saved", mine: saved.state !== "refused" };
  return saved.state === "refused" ? saved : { state: "unknown" };
}

/** "Made the call": done, with what came of it, once. The moment and who are the server's stamps. */
export const makeCall = (session: StaffSession, id: number, outcome: Outcome): Promise<Ended> => once(session, "follow_ups", id, { done: true, outcome }, { done: false }, (row) => isTrue(row["done"]));

// ── What customers said ──────────────────────────────────────────────────────

export interface Answer {
  id: number;
  jobId: number | null;
  job: Job | null;
  score: number;
  text: string | null;
  theme: string | null;
  answeredOn: string | null;
  repliedAt: string | null;
  fix: string | null;
}

interface AnswerRow extends Row {
  id: number;
  job_id: number | null;
  score: number | string;
  text: string | null;
  theme: string | null;
  answered_on: string | null;
  replied_at: string | null;
  fix_written: string | null;
}

const answerOf = (row: AnswerRow, jobs: Map<number, Job>): Answer => {
  const jobId = idOf(row.job_id);
  return { id: Number(row.id), jobId, job: jobId === null ? null : (jobs.get(jobId) ?? null), score: num(row.score), text: textOf(row.text), theme: textOf(row.theme), answeredOn: dayOf(row.answered_on), repliedAt: row.replied_at, fix: textOf(row.fix_written) };
};

const ANSWER_SELECT = ["id", "job_id", "score", "text", "theme", "answered_on", "replied_at", "fix_written"];

export type AnswerFilter = "all" | "high" | "low" | "unreplied";
export const ANSWER_FILTERS: readonly AnswerFilter[] = ["all", "high", "low", "unreplied"];

/** Whether an answer is in a filter: fours and fives, threes and below, or no reply yet. */
export function inAnswerFilter(answer: Answer, filter: AnswerFilter): boolean {
  if (filter === "high") return answer.score >= 4;
  if (filter === "low") return answer.score <= 3;
  if (filter === "unreplied") return answer.repliedAt === null;
  return true;
}

export interface Feedback {
  count: number;
  average: number | null;
  replied: number;
  high: number;
  low: number;
  lowFixed: number;
  unreplied: number;
  /** How many answers name each theme, the most first; `null` is "no theme". */
  themes: { theme: string | null; n: number }[];
  rows: Answer[];
  /** Signed-off jobs with no answer yet: what "Add an answer" offers. Null when it cannot be known (the reader does not read sign-offs, or the list was cut). */
  waiting: Job[] | null;
  cut: boolean;
}

export async function readFeedback(session: StaffSession): Promise<Feedback> {
  const [total, average, replied, high, low, lowFixed, unreplied, themes, page, signed] = await Promise.all([
    count(session, "feedback", []),
    single(session, "feedback", [], { fn: "avg", column: "score" }),
    count(session, "feedback", [{ column: "replied_at", op: "not_null" }]),
    count(session, "feedback", [{ column: "score", op: "gte", value: 4 }]),
    count(session, "feedback", [{ column: "score", op: "lte", value: 3 }]),
    count(session, "feedback", [{ column: "score", op: "lte", value: 3 }, { column: "fix_written", op: "not_null" }]),
    count(session, "feedback", [{ column: "replied_at", op: "is_null" }]),
    grouped(session, "feedback", "theme"),
    session.list<AnswerRow>("feedback", { select: ANSWER_SELECT, order: ["answered_on.desc", "id.desc"], limit: LISTED, count: "exact" }),
    session.can("sign_offs", "read") ? session.list<{ job_id: number }>("sign_offs", { select: ["job_id"], order: ["signed_at", "id"], limit: LISTED, count: "exact" }) : Promise.resolve(null),
  ]);
  const answered = new Set(page.rows.flatMap((row) => (idOf(row.job_id) === null ? [] : [Number(row.job_id)])));
  const signedIds = (signed?.rows ?? []).map((row) => Number(row.job_id));
  const jobs = await readJobs(session, [...answered, ...signedIds]);
  const rows = page.rows.map((row) => answerOf(row, jobs));
  const cut = (page.total ?? rows.length) > rows.length;
  const knowable = signed !== null && !cut && (signed.total ?? signed.rows.length) <= signed.rows.length;
  return {
    count: total,
    average,
    replied,
    high,
    low,
    lowFixed,
    unreplied,
    themes: [...themes.entries()].map(([theme, n]) => ({ theme, n })).filter((one) => one.n > 0).sort((a, b) => b.n - a.n || (a.theme === null ? 1 : b.theme === null ? -1 : a.theme.localeCompare(b.theme))),
    rows,
    waiting: knowable ? signedIds.filter((id) => !answered.has(id)).map((id) => jobs.get(id)!) : null,
    cut,
  };
}

/** What "Add an answer" sends: the job, the score, the words and the day, as the person typed them. */
export interface NewAnswer {
  jobId: number;
  score: number;
  text: string;
  theme: string;
  answeredOn: string;
}

export function answerValues(answer: NewAnswer): Row {
  return {
    job_id: answer.jobId,
    score: answer.score,
    text: answer.text.trim() === "" ? null : answer.text.trim(),
    theme: answer.theme.trim() === "" ? null : answer.theme.trim(),
    answered_on: answer.answeredOn,
  };
}

/** Add an answer a customer gave by hand (one a job: the server refuses a second). The key is made once per dialog, so a lost reply sent again makes one row. */
export const addAnswer = (session: StaffSession, answer: NewAnswer, clientKey: string): Promise<Saved> => session.create("feedback", answerValues(answer), clientKey);

/** "Say thank you": the moment is kept on the answer, once. */
export function sayThanks(session: StaffSession, id: number): Promise<Ended> {
  return once(session, "feedback", id, { replied_at: session.now().toISOString() }, { replied_at: null }, (row) => row["replied_at"] !== null && row["replied_at"] !== undefined);
}

// ── Complaints ───────────────────────────────────────────────────────────────

export type ComplaintState = "open" | "answered" | "settled";
export const COMPLAINT_STATES: readonly ComplaintState[] = ["open", "answered", "settled"];
export type Cause = "late" | "damaged" | "wrong" | "crew" | "silence";
export const CAUSES: readonly Cause[] = ["late", "damaged", "wrong", "crew", "silence"];
export type Fairness = "serious" | "fair" | "misunderstanding";

export interface Complaint {
  id: number;
  companyId: number | null;
  company: string | null;
  contactId: number | null;
  contact: string | null;
  contactTitle: string | null;
  jobId: number | null;
  jobCode: string | null;
  ownerId: string | null;
  text: string | null;
  answer: string | null;
  cause: Cause | null;
  fairness: Fairness | null;
  raisedOn: string | null;
  state: ComplaintState;
}

interface ComplaintRow extends Row {
  id: number;
  company_id: number | null;
  contact_id: number | null;
  job_id: number | null;
  owner_id: string | null;
  text: string | null;
  answer: string | null;
  cause: string | null;
  fairness: string | null;
  raised_on: string | null;
  state: string;
  company?: string | null;
  contact?: string | null;
  contact_title?: string | null;
  job?: string | null;
}

const complaintOf = (row: ComplaintRow): Complaint => ({
  id: Number(row.id),
  companyId: idOf(row.company_id),
  company: textOf(row.company),
  contactId: idOf(row.contact_id),
  contact: textOf(row.contact),
  contactTitle: textOf(row.contact_title),
  jobId: idOf(row.job_id),
  jobCode: textOf(row.job),
  ownerId: textOf(row.owner_id),
  text: textOf(row.text),
  answer: textOf(row.answer),
  cause: CAUSES.includes(row.cause as Cause) ? (row.cause as Cause) : null,
  fairness: row.fairness === "serious" || row.fairness === "fair" || row.fairness === "misunderstanding" ? row.fairness : null,
  raisedOn: dayOf(row.raised_on),
  state: COMPLAINT_STATES.includes(row.state as ComplaintState) ? (row.state as ComplaintState) : "open",
});

const complaintQuery = (session: StaffSession) => ({
  select: ["id", "company_id", "contact_id", "job_id", "owner_id", "text", "answer", "cause", "fairness", "raised_on", "state"],
  lookup: [
    ...(session.can("companies", "read") ? ["company:company_id.name"] : []),
    ...(session.can("contacts", "read") ? ["contact:contact_id.name", "contact_title:contact_id.job_title"] : []),
    ...(session.can("jobs", "read") ? ["job:job_id.code"] : []),
  ],
});

/** Open first, then answered, then settled; the newest first in each. */
export function byComplaintOrder(a: Complaint, b: Complaint): number {
  return COMPLAINT_STATES.indexOf(a.state) - COMPLAINT_STATES.indexOf(b.state) || (b.raisedOn ?? "").localeCompare(a.raisedOn ?? "") || b.id - a.id;
}

export interface Complaints {
  byState: Record<ComplaintState, number>;
  total: number;
  /** Open, and waiting the setting's days or more. */
  slow: number;
  /** The causes named most, with their count; empty when there is no complaint. */
  topCauses: Cause[];
  topCount: number;
  onJob: number;
  beforeJob: number;
  rows: Complaint[];
  names: Record<string, string>;
  settings: AfterSettings;
  cut: boolean;
}

export async function readComplaints(session: StaffSession, today: string): Promise<Complaints> {
  const settings = await readSettings(session);
  const [total, byState, slow, byCause, onJob, beforeJob, page] = await Promise.all([
    count(session, "complaints", []),
    grouped(session, "complaints", "state"),
    count(session, "complaints", [{ column: "state", op: "eq", value: "open" }, { column: "raised_on", op: "lte", value: addDays(today, -settings.answerDays) }]),
    grouped(session, "complaints", "cause"),
    count(session, "complaints", [{ column: "job_id", op: "not_null" }]),
    count(session, "complaints", [{ column: "job_id", op: "is_null" }]),
    session.list<ComplaintRow>("complaints", { ...complaintQuery(session), order: ["raised_on.desc", "id.desc"], limit: LISTED, count: "exact" }),
  ]);
  const rows = page.rows.map(complaintOf).sort(byComplaintOrder);
  const names = await readNames(session, rows.map((row) => row.ownerId));
  const states = Object.fromEntries(COMPLAINT_STATES.map((state) => [state, byState.get(state) ?? 0])) as Record<ComplaintState, number>;
  const topCount = Math.max(0, ...CAUSES.map((cause) => byCause.get(cause) ?? 0));
  return {
    byState: states,
    total,
    slow,
    topCauses: topCount === 0 ? [] : CAUSES.filter((cause) => (byCause.get(cause) ?? 0) === topCount),
    topCount,
    onJob,
    beforeJob,
    rows,
    names,
    settings,
    cut: (page.total ?? rows.length) > rows.length,
  };
}

/** "Answer it": the complaint moves on from open, carrying what we told them. */
export const answerComplaint = (session: StaffSession, id: number, answer: string): Promise<Saved> => session.act("complaints", id, "answered", "open", { values: { answer: answer.trim() === "" ? null : answer.trim() } });
/** "Settled": put right. */
export const settleComplaint = (session: StaffSession, id: number): Promise<Saved> => session.act("complaints", id, "settle", "answered");

// ── Warranty claims ──────────────────────────────────────────────────────────

export type ClaimState = "to-raise" | "with-supplier" | "parts-coming" | "sorted" | "turned-down";
export const CLAIM_STATES: readonly ClaimState[] = ["to-raise", "with-supplier", "parts-coming", "sorted", "turned-down"];
/** The claims still running. */
export const LIVE_CLAIMS: readonly ClaimState[] = ["to-raise", "with-supplier", "parts-coming"];
export type PaidBy = "supplier" | "us" | "none";
export const PAID_BY: readonly PaidBy[] = ["supplier", "us", "none"];

export interface Claim {
  id: number;
  jobId: number | null;
  job: Job | null;
  contact: string | null;
  what: string;
  part: string | null;
  cover: string | null;
  coverYears: number | null;
  raisedOn: string | null;
  supplier: string | null;
  paidBy: PaidBy | null;
  state: ClaimState;
}

interface ClaimRow extends Row {
  id: number;
  job_id: number | null;
  contact_id: number | null;
  what: string;
  part: string | null;
  cover: string | null;
  cover_years: number | null;
  raised_on: string | null;
  supplier_name: string | null;
  paid_by: string | null;
  state: string;
  contact?: string | null;
}

const claimOf = (row: ClaimRow, jobs: Map<number, Job>): Claim => {
  const jobId = idOf(row.job_id);
  return {
    id: Number(row.id),
    jobId,
    job: jobId === null ? null : (jobs.get(jobId) ?? null),
    contact: textOf(row.contact),
    what: row.what,
    part: textOf(row.part),
    cover: textOf(row.cover),
    coverYears: row.cover_years === null || row.cover_years === undefined ? null : num(row.cover_years),
    raisedOn: dayOf(row.raised_on),
    supplier: textOf(row.supplier_name),
    paidBy: PAID_BY.includes(row.paid_by as PaidBy) ? (row.paid_by as PaidBy) : null,
    state: CLAIM_STATES.includes(row.state as ClaimState) ? (row.state as ClaimState) : "to-raise",
  };
};

/** Still to raise first, then with the supplier, parts coming, turned down, sorted; the oldest first in each. */
export function byClaimOrder(a: Claim, b: Claim): number {
  const rank: Record<ClaimState, number> = { "to-raise": 0, "with-supplier": 1, "parts-coming": 2, "turned-down": 3, sorted: 4 };
  return rank[a.state] - rank[b.state] || (a.raisedOn ?? "").localeCompare(b.raisedOn ?? "") || a.id - b.id;
}

export interface Claims {
  byState: Record<ClaimState, number>;
  total: number;
  inHand: number;
  /** The claim running longest, from the server's own order. */
  oldest: Claim | null;
  paid: Record<PaidBy | "open", number>;
  rows: Claim[];
  settings: AfterSettings;
  cut: boolean;
}

export async function readClaims(session: StaffSession): Promise<Claims> {
  const live: Condition = { column: "state", op: "in", value: [...LIVE_CLAIMS] };
  const query = { select: ["id", "job_id", "contact_id", "what", "part", "cover", "cover_years", "raised_on", "supplier_name", "paid_by", "state"], ...(session.can("contacts", "read") ? { lookup: ["contact:contact_id.name"] } : {}) };
  const [byState, total, inHand, byPaid, oldest, page, settings] = await Promise.all([
    grouped(session, "warranty_claims", "state"),
    count(session, "warranty_claims", []),
    count(session, "warranty_claims", [live]),
    grouped(session, "warranty_claims", "paid_by"),
    session.list<ClaimRow>("warranty_claims", { ...query, where: live, order: ["raised_on", "id"], limit: 1 }),
    session.list<ClaimRow>("warranty_claims", { ...query, order: ["raised_on", "id"], limit: LISTED, count: "exact" }),
    readSettings(session),
  ]);
  const jobs = await readJobs(session, [...page.rows, ...oldest.rows].flatMap((row) => (idOf(row.job_id) === null ? [] : [Number(row.job_id)])));
  const rows = page.rows.map((row) => claimOf(row, jobs)).sort(byClaimOrder);
  return {
    byState: Object.fromEntries(CLAIM_STATES.map((state) => [state, byState.get(state) ?? 0])) as Record<ClaimState, number>,
    total,
    inHand,
    oldest: oldest.rows[0] === undefined ? null : claimOf(oldest.rows[0], jobs),
    paid: { supplier: byPaid.get("supplier") ?? 0, us: byPaid.get("us") ?? 0, none: byPaid.get("none") ?? 0, open: byPaid.get(null) ?? 0 },
    rows,
    settings,
    cut: (page.total ?? rows.length) > rows.length,
  };
}

/** The buttons a claim offers, from the state it is in: each is a move the table allows from there. */
export function claimMoves(state: ClaimState): ("raise" | "parts-coming" | "sorted")[] {
  if (state === "to-raise") return ["raise"];
  if (state === "with-supplier") return ["parts-coming"];
  if (state === "parts-coming") return ["sorted"];
  return [];
}

export const raiseClaim = (session: StaffSession, id: number): Promise<Saved> => session.act("warranty_claims", id, "raise", "to-raise");
export const partsComing = (session: StaffSession, id: number): Promise<Saved> => session.act("warranty_claims", id, "parts-coming", "with-supplier");
/** "Put right": sorted, saying who paid for it. */
export const putRight = (session: StaffSession, id: number, paidBy: PaidBy): Promise<Saved> => session.act("warranty_claims", id, "sorted", "parts-coming", { values: { paid_by: paidBy } });

// ── the account manager's home ────────────────────────────────────────────────

export interface AfterHome {
  /** Each null when the reader does not read that table. */
  calls: { due: number; late: number; rows: Call[] } | null;
  complaints: { open: number; slow: number; rows: Complaint[]; answerDays: number } | null;
  answers: { unreplied: number; rows: Answer[] } | null;
}

export async function readAfterHome(session: StaffSession, today: string, reads: { calls: boolean; complaints: boolean; answers: boolean }): Promise<AfterHome> {
  const now = session.now();
  const at = now.toISOString();
  const settings = reads.complaints ? await readSettings(session) : null;
  const OPEN: Condition = { column: "state", op: "eq", value: "open" };
  const UNREPLIED: Condition = { column: "replied_at", op: "is_null" };
  const [due, late, calls, open, slow, complaints, unreplied, answers] = await Promise.all([
    reads.calls ? count(session, "follow_ups", [AFTERCARE, NOT_MADE]) : null,
    reads.calls ? count(session, "follow_ups", [AFTERCARE, NOT_MADE, { column: "due_at", op: "lt", value: at }]) : null,
    reads.calls ? session.list<CallRow>("follow_ups", { select: CALL_SELECT, where: { and: [AFTERCARE, NOT_MADE] }, order: ["due_at", "id"], limit: HOME_ROWS }) : null,
    reads.complaints ? count(session, "complaints", [OPEN]) : null,
    reads.complaints && settings !== null ? count(session, "complaints", [OPEN, { column: "raised_on", op: "lte", value: addDays(today, -settings.answerDays) }]) : null,
    reads.complaints ? session.list<ComplaintRow>("complaints", { ...complaintQuery(session), where: OPEN, order: ["raised_on", "id"], limit: HOME_ROWS }) : null,
    reads.answers ? count(session, "feedback", [UNREPLIED]) : null,
    reads.answers ? session.list<AnswerRow>("feedback", { select: ANSWER_SELECT, where: UNREPLIED, order: ["answered_on.desc", "id.desc"], limit: HOME_ROWS }) : null,
  ]);
  const jobIds = [...(calls?.rows ?? []), ...(answers?.rows ?? [])].flatMap((row) => (idOf(row["job_id"]) === null ? [] : [Number(row["job_id"])]));
  const jobs = await readJobs(session, jobIds);
  return {
    calls: calls === null ? null : { due: due ?? 0, late: late ?? 0, rows: calls.rows.map((row) => callOf(row, jobs, now)) },
    complaints: complaints === null ? null : { open: open ?? 0, slow: slow ?? 0, rows: complaints.rows.map(complaintOf), answerDays: settings?.answerDays ?? 3 },
    answers: answers === null ? null : { unreplied: unreplied ?? 0, rows: answers.rows.map((row) => answerOf(row, jobs)) },
  };
}
