/**
 * SITE VISITS: what the three screens read, and how a visit is booked, moved
 * and cancelled.
 *
 * WHO COUNTS. The server: "coming up", "written up" and "needs writing up"
 * are four counts it answers for the reader's own rows (a visit keeps how
 * many write-ups it has in `written`). A screen only puts each visit under
 * its day and names its tone from the server's clock.
 *
 * A CANCEL REMOVES THE VISIT. There is no cancelled mark. The why is written
 * to the visit a moment before it is removed, so the removal's own entry in
 * Adminium's audit log holds it; a visit that was written up, or marked as
 * made, is refused by the server and stays.
 */
import type { Formatters } from "../../lib/format.ts";
import { addDays } from "../../lib/format.ts";
import type { Condition, HistoryEntry, Saved, StaffSession } from "../../staffSession.ts";

export interface Visit extends Record<string, unknown> {
  id: number;
  deal_id: number;
  contact_id: number | null;
  rep_id: string;
  starts_at: string;
  minutes: number;
  purpose: string;
  state: "booked" | "done";
  note: string | null;
  written: number | string | null;
  deal: string | null;
  company: string | null;
  town: string | null;
  amount: number | string | null;
  contact: string | null;
  contact_role: string | null;
}

export const VISIT_LOOKUPS = ["deal:deal_id.name", "company:deal_id.company_id.name", "town:deal_id.company_id.town", "amount:deal_id.amount", "contact:contact_id.name", "contact_role:contact_id.job_title"];
export const VISIT_COLUMNS = ["id", "deal_id", "contact_id", "rep_id", "starts_at", "minutes", "purpose", "state", "note", "written"];

/** The lengths a visit is booked for, in minutes, as the design offers them. */
export const LENGTHS = [30, 45, 60, 75, 90, 120, 180] as const;

export type Tone = "today" | "soon" | "done" | "unwritten";
export type Filter = "all" | "soon" | "done" | "unwritten";

export const isWritten = (visit: Pick<Visit, "written">): boolean => Number(visit.written ?? 0) > 0;

/** What a visit is, by the server's clock: still to come (today counts), written up, or waiting on its notes. */
export function toneOf(visit: Pick<Visit, "starts_at" | "written">, now: Date, f: Formatters): Tone {
  const days = f.dayDiff(now, new Date(visit.starts_at));
  if (days < 0) return isWritten(visit) ? "done" : "unwritten";
  return days === 0 ? "today" : "soon";
}

/** The moment today began where the business is. */
export const startOfToday = (now: Date, f: Formatters): Date => f.at(f.dayKey(now), "00:00");

/** `10:30–12:00`, on the business's clock. */
export const spanOf = (visit: Pick<Visit, "starts_at" | "minutes">, f: Formatters): string => {
  const from = new Date(visit.starts_at);
  return `${f.time(from)}–${f.time(new Date(from.getTime() + Number(visit.minutes) * 60_000))}`;
};

export interface VisitCounts {
  all: number;
  soon: number;
  done: number;
  unwritten: number;
}

export interface VisitList {
  visits: Visit[];
  counts: VisitCounts;
}

/** The people who sign in here, by id: read once per page. Somebody who may not read them sees first names nowhere, and nothing else breaks. */
export const readNames = (session: StaffSession): Promise<Record<string, string>> =>
  session.people(undefined, 200).then(
    (people) => Object.fromEntries(people.map((person) => [person.id, person.name])),
    () => ({}),
  );

/**
 * The reader's visits (a rep's own; the team's for who reads the team), with
 * the server's four counts. Each count is the total the server answers for a
 * list of one row, asked afresh every time: a figure from the widget door is
 * kept for half a minute and is not dropped when a write-up moves a visit's
 * `written`, so it would say "needs writing up 1" for a visit just written up.
 */
export async function readVisits(session: StaffSession, mine: boolean, now: Date, f: Formatters): Promise<VisitList> {
  const me = session.config.user?.id ?? "";
  const own: Condition[] = mine ? [{ column: "rep_id", op: "eq", value: me }] : [];
  const from = startOfToday(now, f).toISOString();
  const all = (conditions: Condition[]): Condition | undefined => (conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : { and: conditions });
  const count = (filters: Condition[]): Promise<number> => session.list("site_visits", { select: ["id"], where: all([...own, ...filters])!, limit: 1, count: "exact" }).then((page) => Number(page.total ?? 0));
  const whole = all(own);
  const [page, soon, done, unwritten] = await Promise.all([
    session.list<Visit>("site_visits", { select: VISIT_COLUMNS, ...(whole === undefined ? {} : { where: whole }), order: ["starts_at"], lookup: VISIT_LOOKUPS, limit: 200, count: "exact" }),
    count([{ column: "starts_at", op: "gte", value: from }]),
    count([{ column: "starts_at", op: "lt", value: from }, { column: "written", op: "gt", value: 0 }]),
    count([{ column: "starts_at", op: "lt", value: from }, { column: "written", op: "eq", value: 0 }]),
  ]);
  return { visits: page.rows, counts: { all: Number(page.total ?? page.rows.length), soon, done, unwritten } };
}

export const readVisit = (session: StaffSession, id: number | string): Promise<Visit | null> => session.get<Visit>("site_visits", id, { lookup: VISIT_LOOKUPS });

/** One rep's visits on one day where the business is, in the order they fall. */
export function readDay(session: StaffSession, rep: string, day: string, f: Formatters): Promise<Visit[]> {
  const from = f.at(day, "00:00").toISOString();
  const to = f.at(addDays(day, 1), "00:00").toISOString();
  return session
    .list<Visit>("site_visits", {
      select: VISIT_COLUMNS,
      where: { and: [{ column: "rep_id", op: "eq", value: rep }, { column: "starts_at", op: "gte", value: from }, { column: "starts_at", op: "lt", value: to }] },
      order: ["starts_at"],
      lookup: VISIT_LOOKUPS,
      limit: 50,
    })
    .then((page) => page.rows);
}

export const overlaps = (a: Pick<Visit, "starts_at" | "minutes">, b: Pick<Visit, "starts_at" | "minutes">): boolean => {
  const from = new Date(a.starts_at).getTime();
  const other = new Date(b.starts_at).getTime();
  return from < other + Number(b.minutes) * 60_000 && other < from + Number(a.minutes) * 60_000;
};

export interface Moved {
  /** When it was to start before the move. */
  was: Date;
  minutes: number | null;
  by: string | null;
  at: Date;
}

/** The last time this visit's start was changed: the time it had, who changed it and when, read from the record's own history. */
export async function lastMove(session: StaffSession, id: number): Promise<Moved | null> {
  const { entries } = await session.history("site_visits", id, { limit: 50 });
  for (const entry of entries as (Omit<HistoryEntry, "createdAt"> & { createdAt: string | number })[]) {
    const changes = entry.changes as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
    const before = changes?.before;
    if (before === undefined || before === null || !("starts_at" in before) || before["starts_at"] === null) continue;
    const was = new Date(String(before["starts_at"]));
    const now = changes?.after?.["starts_at"];
    if (Number.isNaN(was.getTime()) || (now !== undefined && now !== null && new Date(String(now)).getTime() === was.getTime())) continue;
    const at = new Date(typeof entry.createdAt === "number" ? entry.createdAt : /^\d+$/.test(entry.createdAt) ? Number(entry.createdAt) : entry.createdAt);
    return { was, minutes: before["minutes"] === undefined || before["minutes"] === null ? null : Number(before["minutes"]), by: entry.actorLabel, at };
  }
  return null;
}

/**
 * Cancel a visit: the why first, then the row is removed. A reply lost on the
 * way back is read back by the session (`remove` answers saved once the row
 * is no longer there), so a second press never finds a visit to cancel twice.
 */
export async function cancelVisit(session: StaffSession, visit: Pick<Visit, "id">, why: string): Promise<Saved> {
  const noted = await session.update("site_visits", visit.id, { cancel_reason: why }, { seen: { state: "booked" } });
  // Already gone (a second press after a lost reply, or a colleague cancelled it): there is nothing left to remove.
  if (noted.state === "refused" && noted.error.status === 404 && (await session.get("site_visits", visit.id)) === null) return { state: "saved", row: {}, replayed: true, readBack: true };
  if (noted.state !== "saved") return noted;
  return session.remove("site_visits", visit.id);
}

export interface Note extends Record<string, unknown> {
  id: number;
  visit_id: number;
  saw: string | null;
  said: string | null;
  next: string | null;
}

export interface Agreed extends Record<string, unknown> {
  id: number;
  visit_note_id: number;
  text: string;
  position: number;
}

export interface WriteUp {
  visit: Visit;
  note: Note | null;
  agreed: Agreed[];
  /** Every visit whose time has passed, newest first: the picker and "earlier write-ups". */
  past: Visit[];
}

export async function readWriteUp(session: StaffSession, id: number | null, mine: boolean, now: Date): Promise<WriteUp | null> {
  const me = session.config.user?.id ?? "";
  const before: Condition = { column: "starts_at", op: "lt", value: now.toISOString() };
  const page = await session.list<Visit>("site_visits", { select: VISIT_COLUMNS, where: mine ? { and: [{ column: "rep_id", op: "eq", value: me }, before] } : before, order: ["starts_at.desc"], lookup: VISIT_LOOKUPS, limit: 60 });
  const past = page.rows;
  // The visit asked for; else the first still waiting on its notes; else the newest.
  const visit = id !== null ? (past.find((one) => one.id === id) ?? (await readVisit(session, id))) : (past.find((one) => !isWritten(one)) ?? past[0] ?? null);
  if (visit === null) return null;
  const notes = await session.list<Note>("visit_notes", { where: { column: "visit_id", op: "eq", value: visit.id }, limit: 1 });
  const note = notes.rows[0] ?? null;
  const agreed = note === null ? [] : (await session.list<Agreed>("visit_agreed", { where: { column: "visit_note_id", op: "eq", value: note.id }, order: ["position", "id"], limit: 100 })).rows;
  return { visit, note, agreed, past };
}
