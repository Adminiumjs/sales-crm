/**
 * THE FIELD CREW'S PHONE (P22): what his screens read, and how a tick, a
 * snag, "put right" and a sign-off are sent.
 *
 * WHAT HE READS. His crew's visits (the server holds him to the visits of the
 * crews he is in), with the job's facts the visit carries: the site, its
 * address and phone, how to get in, who to ask for, the office's note. He
 * reads no job, no deal, no quote and no company: the job's number and
 * anything with an amount in it are not his, by any door (proved by
 * `proofs/crm-crew.test.ts`). His crew's snags and sign-offs, its delivery
 * notes and their lines.
 *
 * WHO COUNTS. The server: a day's visits and hours, a snag list's counts. The
 * browser puts a visit under its day and reads a visit's own four ticks.
 *
 * ONLINE ONLY (ruling Q1). Nothing is kept on the phone. A save that cannot
 * be sent says so, and what was typed stays on the screen: the same press,
 * with the same retry key, sends it again once the line is back.
 *
 * SIGNING A JOB OFF IS ONE RECORD. The signature pad and the photo field send
 * their files as the person keeps each (`FileParts.tsx`); then ONE create of
 * the sign-off, with a retry key, names the five checks, the signer's name,
 * the signature and the photos. A lost reply is sent again with the same key
 * and the server answers the row the first one made. Refused, the files are
 * thrown away; a file the server says a record holds (`409 FILE_HELD`) means
 * the record WAS made, and it is read back.
 */
import { addDays, weekOf, type Formatters } from "../../lib/format.ts";
import { LostReply, StaffError, type Condition, type Grouped, type Row, type Saved, type StaffSession } from "../../staffSession.ts";
import { CHECKS, dayKeyOf, num, truthy, type CrewFacts, type Moved, type SignOff, type Snag, type SnagState, type Tick, type Visit } from "../jobs/data.ts";

export { CHECKS, TICKS, dayKeyOf, num, truthy } from "../jobs/data.ts";
export type { Moved, SignOff, Snag, SnagState, Tick, Visit } from "../jobs/data.ts";

/** A visit as the crew reads it: the visit's own columns (the job's number and title, read through the job, are masked to him). */
export type CrewVisit = Visit;

/** The crews the signed-in person is in, by id. */
export function crewsOf(facts: Pick<CrewFacts, "members">, me: string | null): number[] {
  if (me === null) return [];
  return [...new Set(facts.members.filter((member) => member.user_id === me).map((member) => member.crew_id))];
}

/** The days of the week a day falls in, Monday first. */
export function weekDays(day: string): string[] {
  const monday = weekOf(day)[0];
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const SHOWN: Condition = { column: "state", op: "in", value: ["booked", "done"] };

/** The visits of his crews in the week of a day, in the order they start: booked ones and ones made. */
export async function readWeek(session: StaffSession, day: string): Promise<CrewVisit[]> {
  const days = weekDays(day);
  const page = await session.list<CrewVisit>("job_visits", {
    where: { and: [SHOWN, { column: "day", op: "gte", value: days[0]! }, { column: "day", op: "lte", value: days[6]! }] },
    order: ["day", "start_time", "id"],
    limit: 200,
  });
  return page.rows;
}

/** A day's visits and their hours, as the server counts them for him. */
export async function readDayFigures(session: StaffSession, day: string): Promise<{ visits: number; hours: number }> {
  const filters: Condition[] = [SHOWN, { column: "day", op: "eq", value: day }];
  const [visits, hours] = await Promise.all([
    session.figure<{ value?: number | null }>({ table: "job_visits", shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] }),
    session.figure<{ value?: number | null }>({ table: "job_visits", shape: "single-metric", filters, aggregations: [{ fn: "sum", column: "hours", alias: "h" }] }),
  ]);
  return { visits: num(visits.value), hours: num(hours.value) };
}

/** A snag with the pictures the crew's screens show. */
export interface CrewSnag extends Snag {
  photo: string | null;
  put_right_photo: string | null;
}

const SNAG_COLUMNS = ["id", "job_id", "visit_id", "text", "stops_sign_off", "state", "raised_on", "raised_by_id", "raised_by_contact_id", "due_on", "put_right_on", "put_right_note", "photo", "put_right_photo"];
const SNAG_RANK: Record<SnagState, number> = { open: 0, "waiting-part": 1, "put-right": 2 };

/** Open first, then waiting on a part, then put right; the newest raised first inside each. */
export const snagOrder = (a: Pick<CrewSnag, "state" | "raised_on" | "id">, b: Pick<CrewSnag, "state" | "raised_on" | "id">): number =>
  SNAG_RANK[a.state] - SNAG_RANK[b.state] || (dayKeyOf(b.raised_on) ?? "").localeCompare(dayKeyOf(a.raised_on) ?? "") || b.id - a.id;

/** His crew's snags: of some jobs, or all of them. */
export async function readSnags(session: StaffSession, jobs: readonly number[] | null = null): Promise<CrewSnag[]> {
  if (jobs !== null && jobs.length === 0) return [];
  const page = await session.list<CrewSnag>("snags", {
    select: SNAG_COLUMNS,
    ...(jobs === null ? {} : { where: { column: "job_id", op: "in", value: [...jobs] } }),
    order: ["raised_on.desc", "id.desc"],
    limit: 200,
  });
  return [...page.rows].sort(snagOrder);
}

export const isLive = (snag: Pick<CrewSnag, "state">): boolean => snag.state !== "put-right";
/** The live snags of a job that stop its sign-off: what the server's rule refuses a sign-off for. */
export const stoppers = (snags: readonly CrewSnag[], jobId: number): CrewSnag[] => snags.filter((snag) => snag.job_id === jobId && isLive(snag) && truthy(snag.stops_sign_off));

/** The snag counts of his crew's jobs, as the server counts them: open, waiting on a part, put right. */
export async function readSnagCounts(session: StaffSession): Promise<Record<SnagState, number>> {
  const answer = await session.figure<Grouped>({ table: "snags", shape: "categorical", groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }] });
  const out: Record<SnagState, number> = { open: 0, "waiting-part": 0, "put-right": 0 };
  for (const item of answer.items) if (item.key === "open" || item.key === "waiting-part" || item.key === "put-right") out[item.key] = num(item.values?.["n"] ?? item.value);
  return out;
}

const SIGN_COLUMNS = ["id", "job_id", "visit_id", ...CHECKS, "signer_name", "signature", "photos", "signed_at", "corrects_id", "version", "retry_key"];

/** The sign-off that stands for each of some jobs: the newest version of each (a correction is a new row). */
export async function readSignOffs(session: StaffSession, jobs: readonly number[]): Promise<Map<number, SignOff>> {
  const out = new Map<number, SignOff>();
  if (jobs.length === 0) return out;
  const page = await session.list<SignOff>("sign_offs", { select: SIGN_COLUMNS, where: { column: "job_id", op: "in", value: [...jobs] }, order: ["job_id", "version"], limit: 200 });
  for (const row of page.rows) {
    const held = out.get(row.job_id);
    if (held === undefined || num(row.version) >= num(held.version)) out.set(row.job_id, row);
  }
  return out;
}

/** The ids a file column holds: one for the signature, a list for the photos (kept as JSON on some engines). */
export function fileIds(value: unknown): string[] {
  let doc: unknown = value;
  if (typeof doc === "string" && doc.trim().startsWith("[")) {
    try {
      doc = JSON.parse(doc);
    } catch {
      return [];
    }
  }
  if (typeof doc === "string") return /^file_[A-Za-z0-9]+$/.test(doc) ? [doc] : [];
  return Array.isArray(doc) ? doc.filter((id): id is string => typeof id === "string" && /^file_[A-Za-z0-9]+$/.test(id)) : [];
}

/** A kept file's address, for an image. */
export const fileSrc = (id: string): string => `/api/v1/files/${encodeURIComponent(id)}/content?inline=true`;

export interface NoteLine extends Row {
  id: number;
  note_id: number;
  what: string;
  ordered: number | string;
  delivered: number | string;
}

/** What is on the vehicle for some visits: the lines of each visit's delivery note, by visit. */
export async function readLoads(session: StaffSession, visits: readonly number[]): Promise<Map<number, NoteLine[]>> {
  const out = new Map<number, NoteLine[]>();
  if (visits.length === 0) return out;
  // The crew's note columns are few: a list that named one he does not read would be refused whole.
  const notes = await session.list<{ id: number; visit_id: number }>("delivery_notes", { select: ["id", "visit_id"], where: { column: "visit_id", op: "in", value: [...visits] }, limit: 200 });
  if (notes.rows.length === 0) return out;
  const lines = await session.list<NoteLine>("delivery_note_lines", { select: ["id", "note_id", "what", "ordered", "delivered"], where: { column: "note_id", op: "in", value: notes.rows.map((note) => note.id) }, order: ["note_id", "id"], limit: 200 });
  for (const note of notes.rows) out.set(note.visit_id, [...(out.get(note.visit_id) ?? []), ...lines.rows.filter((line) => line.note_id === note.id)]);
  return out;
}

type Entry = { createdAt: string | number; actorLabel: string | null; changes: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } | null };

/**
 * The last time a booked visit's day, start or crew really changed, from its
 * history: what it was, who changed it and when. An entry's `before` holds the
 * whole row, so a change is a column whose value differs from `after` (a tick
 * is not a move). A booking that writes a day onto a visit that had none is
 * not a move either.
 */
export function lastShift(entries: readonly Entry[]): Moved | null {
  for (const entry of entries) {
    const before = entry.changes?.before ?? null;
    const after = entry.changes?.after ?? null;
    if (before === null || after === null) continue;
    const moved = (column: string): boolean => column in before && column in after && String(before[column] ?? "") !== String(after[column] ?? "");
    const was = dayKeyOf(before["day"]);
    if (moved("day") && was === null) continue;
    if (!moved("day") && !moved("start_time") && !moved("crew_id")) continue;
    const at = new Date(typeof entry.createdAt === "number" ? entry.createdAt : /^\d+$/.test(entry.createdAt) ? Number(entry.createdAt) : entry.createdAt);
    return {
      day: moved("day") ? was : null,
      start: moved("start_time") && typeof before["start_time"] === "string" ? before["start_time"] : null,
      crewId: moved("crew_id") && before["crew_id"] !== null && before["crew_id"] !== undefined ? Number(before["crew_id"]) : null,
      by: entry.actorLabel,
      at,
    };
  }
  return null;
}

/** When the office last moved a booked visit, read from the visit's own history: one read a visit. A history he may not read is no move. */
export async function readMoves(session: StaffSession, visits: readonly CrewVisit[]): Promise<Map<number, Moved>> {
  const out = new Map<number, Moved>();
  await Promise.all(
    visits
      .filter((visit) => visit.state === "booked")
      .map(async (visit) => {
        try {
          const { entries } = await session.history("job_visits", visit.id, { limit: 50 });
          const moved = lastShift(entries as unknown as Entry[]);
          if (moved !== null) out.set(visit.id, moved);
        } catch {
          // Not readable, or not reachable just now: the card shows the visit as it is, with no line about a move.
        }
      }),
  );
  return out;
}

/* ─── What a visit offers ─── */

/** Whether a visit's ticks are still his to change: a visit of today or to come, not yet marked done by the office. Past ones are read. */
export const ticksOpen = (visit: Pick<CrewVisit, "day" | "state">, today: string): boolean => visit.state === "booked" && (dayKeyOf(visit.day) ?? "") >= today;

/**
 * Whether a visit offers "Sign off the job": a job with no sign-off yet, on a
 * visit that fits or comes back to finish the work (not a drop of goods), on
 * its day or after it. A return visit to a job already signed shows that
 * sign-off instead (B19).
 */
export const offersSignOff = (visit: Pick<CrewVisit, "kind" | "day">, signed: boolean, today: string): boolean => !signed && visit.kind !== "drop" && (dayKeyOf(visit.day) ?? "9999") <= today;

/* ─── Links a phone hands to its own apps ─── */

/** The visit's address, one line a part, as the visit carries it (lines, then the town). */
export function addressLines(visit: Pick<CrewVisit, "site_address" | "site_town">): string[] {
  // Lines as the office typed them ("Unit 6, Fen Road Park" stays one line), then the town.
  const out = (visit.site_address ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (visit.site_town !== null && visit.site_town.trim() !== "") out.push(visit.site_town.trim());
  return out;
}

/**
 * "Open in my maps app": on an Apple phone or tablet Apple's maps address
 * (`geo:` does nothing there, B16), on any other phone `geo:` with the
 * address (the phone asks which app), and on a desk, where there is no such
 * app, OpenStreetMap's search in a new tab. Built from the address as the
 * visit carries it: the crew reads no pin.
 */
export function mapsHref(address: readonly string[], agent: string, touch: boolean): { href: string; newTab: boolean } {
  const q = encodeURIComponent(address.join(", "));
  if (/iPhone|iPad|iPod|Macintosh/.test(agent) && touch) return { href: `https://maps.apple.com/?q=${q}`, newTab: false };
  if (touch || /Android|Mobile/.test(agent)) return { href: `geo:0,0?q=${q}`, newTab: false };
  return { href: `https://www.openstreetmap.org/search?query=${q}`, newTab: true };
}

/** A phone number as a call link: its digits and a leading plus, nothing else. Null when there is no number in it. */
export function telHref(phone: string | null): string | null {
  if (phone === null) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 3) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/* ─── Saving ─── */

/**
 * How a save of the crew's ended, in the words the screen needs: saved;
 * refused by the server with its reason; or no connection (nothing could be
 * sent or read back: the screen keeps what was typed, and the same press sends
 * it again with the same key).
 */
export type Sent<R> = { state: "saved"; row: R; replayed: boolean } | { state: "refused"; error: StaffError } | { state: "offline" };

export function sentOf<R>(saved: Saved<R>): Sent<R> {
  if (saved.state === "saved") return { state: "saved", row: saved.row, replayed: saved.replayed };
  if (saved.state === "refused") return { state: "refused", error: saved.error };
  return { state: "offline" };
}

/** One of the four ticks, set or taken back. */
export const setTick = async (session: StaffSession, visit: Pick<CrewVisit, "id">, tick: Tick, on: boolean): Promise<Sent<CrewVisit>> => sentOf(await session.update<CrewVisit>("job_visits", visit.id, { [tick]: on }));

export interface NewSnag {
  visitId: number;
  text: string;
  stops: boolean;
  photo: string | null;
}

/** A snag raised on one of his crew's visits: its job is the visit's, and its crew. */
export const raiseSnag = async (session: StaffSession, made: NewSnag, key: string): Promise<Sent<CrewSnag>> =>
  sentOf(
    await session.create<CrewSnag>(
      "snags",
      { visit_id: made.visitId, text: made.text.trim(), stops_sign_off: made.stops, raised_by_id: session.config.user?.id ?? null, ...(made.photo === null ? {} : { photo: made.photo }) },
      key,
    ),
  );

/**
 * "Put right": the line and the photo with the move, in one change that
 * names the state the screen saw (a snag a colleague put right meanwhile is
 * not written over). The record's own button takes the line only; the phone
 * also sends the photo (D6 Q6: the photo is asked on the phone).
 */
export const putRight = async (session: StaffSession, snag: Pick<CrewSnag, "id" | "state">, note: string, photo: string): Promise<Sent<CrewSnag>> =>
  sentOf(await session.update<CrewSnag>("snags", snag.id, { state: "put-right", put_right_note: note.trim(), put_right_photo: photo }, { seen: { state: snag.state } }));

/** What a sign-off is made of on the phone. */
export interface SignOffDraft {
  visitId: number;
  checks: readonly boolean[];
  signer: string;
  signature: string;
  photos: readonly string[];
}

export type SignedOff =
  | { state: "signed"; row: SignOff; replayed: boolean }
  /** Refused: a snag that stops it (the server's rule on the job's link), a sign-off already there, or another reason. The files are thrown away. */
  | { state: "refused"; why: "snag" | "signed" | "other"; error: StaffError }
  | { state: "offline" };

/** Throw away files no record holds. A `409 FILE_HELD` answers that a record holds one: the sign-off WAS made. Answers whether one was held. */
export async function discardFiles(session: Pick<StaffSession, "call">, ids: readonly string[]): Promise<"gone" | "held" | "offline"> {
  let held = false;
  let lost = false;
  for (const id of ids) {
    try {
      await session.call("DELETE", `/files/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof StaffError && error.status === 409 && error.code === "FILE_HELD") held = true;
      else if (error instanceof LostReply) lost = true;
      // 404: already gone (the part threw it away itself, or a second press).
    }
  }
  return held ? "held" : lost ? "offline" : "gone";
}

/** Why a sign-off was refused, from the server's answer. */
export function signRefusal(error: StaffError): "snag" | "signed" | "other" {
  // The sign-off's link to its job names only a job no snag stops (`linkable` on `sign_offs.job_id`): refused as that field's.
  if (error.status === 422 && error.fields["job_id"] === "not-allowed") return "snag";
  // One sign-off a job and version: a colleague signed it first.
  if (error.status === 409 && error.code === "UNIQUE_VIOLATION") return "signed";
  return "other";
}

/** The sign-off made with this key, read back. */
async function signedWith(session: StaffSession, key: string): Promise<SignOff | null> {
  const page = await session.list<SignOff>("sign_offs", { select: SIGN_COLUMNS, where: { column: "retry_key", op: "eq", value: key }, limit: 1 });
  return page.rows[0] ?? null;
}

/** Sign a job off: one create, with a key. Refused, its files are thrown away; one the server says a record holds means it WAS made. */
export async function signOff(session: StaffSession, draft: SignOffDraft, key: string): Promise<SignedOff> {
  const values: Row = { visit_id: draft.visitId, signer_name: draft.signer.trim(), signature: draft.signature, photos: draft.photos.length === 0 ? null : [...draft.photos] };
  CHECKS.forEach((check, i) => (values[check] = draft.checks[i] === true));
  const saved = await session.create<SignOff>("sign_offs", values, key);
  if (saved.state === "saved") return { state: "signed", row: saved.row, replayed: saved.replayed };
  if (saved.state === "unknown") return { state: "offline" };
  const files = await discardFiles(session, [draft.signature, ...draft.photos]);
  if (files === "held") {
    const made = await signedWith(session, key).catch(() => null);
    if (made !== null) return { state: "signed", row: made, replayed: true };
  }
  return { state: "refused", why: signRefusal(saved.error), error: saved.error };
}

/* ─── Words ─── */

/** "07:30" and "07:30–13:30" for a visit with a start and hours. */
export function timeSpan(start: string | null, hours: unknown): { from: string; to: string } | null {
  if (start === null || !/^\d{2}:\d{2}/.test(start)) return null;
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + Math.round(num(hours) * 60);
  if (num(hours) <= 0) return null;
  const end = minutes % (24 * 60);
  return { from: start.slice(0, 5), to: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` };
}

/** A number of hours, one decimal place at most. */
export const hoursText = (f: Pick<Formatters, "number">, value: unknown): string => f.number(Math.round(num(value) * 10) / 10);
