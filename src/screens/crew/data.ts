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
 * KEPT ON THE PHONE WITH NO SIGNAL (plan 68 S19, replacing ruling Q1's
 * online-only phone). Each save is a line of the offline queue
 * (`queue.tsx`): sent at once with signal, else kept with its retry key and
 * its files and sent in order when the signal is back.
 *
 * SIGNING A JOB OFF IS ONE RECORD. The signature pad and the photo field keep
 * their files on the phone (`FileParts.tsx`); the sign-off is ONE create,
 * with a retry key, naming the five checks, the signer's name, the signature
 * and the photos, each file sent first, once. A lost reply is sent again with
 * the same key and the server answers the row the first one made; a file the
 * server says a record holds (`409 FILE_HELD`) means the record WAS made, and
 * it is read back by its key (`offlineQueue.ts`).
 */
import { addDays, weekOf, type Formatters } from "../../lib/format.ts";
import type { NewLine } from "../../offlineQueue.ts";
import type { Condition, Grouped, Row, StaffSession } from "../../staffSession.ts";
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

/* ─── Saving: each save a line of the phone's offline queue (`queue.tsx`, plan 68 S19) ─── */

/** One of the four ticks, set or taken back: a change of the visit, sent at once or kept on the phone. */
export const tickLine = (visit: Pick<CrewVisit, "id" | "job_id" | "site_name">, tick: Tick, on: boolean): NewLine => ({
  kind: "tick",
  meta: { visit: visit.id, job: visit.job_id, site: visit.site_name, tick, on },
  op: { type: "update", table: "job_visits", id: visit.id, values: { [tick]: on } },
});

export interface NewSnag {
  visitId: number;
  jobId: number;
  site: string;
  text: string;
  stops: boolean;
  /** The photo, as the phone holds it (`phone_…`). */
  photo: string | null;
}

/** A snag raised on one of his crew's visits: its job is the visit's, and its crew. One create with a key. */
export const snagLine = (made: NewSnag, by: string | null, key: string): NewLine => ({
  kind: "snag",
  meta: { visit: made.visitId, job: made.jobId, site: made.site, text: made.text.trim(), stops: made.stops, photo: made.photo !== null },
  op: { type: "create", table: "snags", values: { visit_id: made.visitId, text: made.text.trim(), stops_sign_off: made.stops, raised_by_id: by, ...(made.photo === null ? {} : { photo: made.photo }) }, key },
});

/**
 * "Put right": the line and the photo with the move, in one change that
 * names the state the screen saw (a snag a colleague put right meanwhile is
 * refused, not written over). The record's own button takes the line only;
 * the phone also sends the photo (D6 Q6: the photo is asked on the phone).
 */
export const putRightLine = (snag: Pick<CrewSnag, "id" | "state" | "text" | "job_id">, site: string | null, note: string, photo: string): NewLine => ({
  kind: "put-right",
  meta: { snag: snag.id, job: snag.job_id, site: site ?? "", text: snag.text, note: note.trim(), from: snag.state },
  op: { type: "update", table: "snags", id: snag.id, values: { state: "put-right", put_right_note: note.trim(), put_right_photo: photo }, seen: { state: snag.state } },
});

/** What a sign-off is made of on the phone. */
export interface SignOffDraft {
  visitId: number;
  jobId: number;
  site: string;
  checks: readonly boolean[];
  signer: string;
  /** The files, as the phone holds them (`phone_…`). */
  signature: string;
  photos: readonly string[];
  /** The job's snags still open, as the screen showed them to the customer. */
  open: readonly Pick<CrewSnag, "text" | "due_on" | "put_right_note">[];
  /** The five checks' words, as the screen said them, in the columns' order. */
  checkWords: readonly string[];
  /** An address the signed copy ALSO goes to (the job's contact gets one anyway); empty for none. */
  copyTo?: string;
}

/** The longest address `sign_offs.copy_sent_to` holds. */
export const COPY_TO_MAX = 200;

/**
 * Whether a typed address for the signed copy may go: empty (none), or an
 * e-mail address as the server checks one (`rules.validation.format: "email"`
 * on `sign_offs.copy_sent_to`), within the column's length.
 */
export function copyToOk(typed: string): boolean {
  const text = typed.trim();
  return text === "" || (text.length <= COPY_TO_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text));
}

/** The longest list of open snags a sign-off holds (`sign_offs.snags_at_signing`'s own bound). */
export const SNAGS_AT_SIGNING_MAX = 20_000;

/**
 * The snags open when the customer signed, as the signed copy reads them: a
 * JSON list of `{ what, by, note }` (`by` a `YYYY-MM-DD` day), in the order the
 * screen showed them; `[]` when none was. Kept within the column's bound: a
 * list too long for it loses its last snags, never its shape.
 */
export function snagsAtSigning(open: SignOffDraft["open"]): string {
  const entries = open.map((snag) => ({ what: snag.text.trim(), by: dayKeyOf(snag.due_on) ?? "", note: (snag.put_right_note ?? "").trim() }));
  let text = JSON.stringify(entries);
  while (text.length > SNAGS_AT_SIGNING_MAX && entries.length > 0) {
    entries.pop();
    text = JSON.stringify(entries);
  }
  return text;
}

/**
 * Sign a job off: ONE create, with a key, naming the five checks, the
 * signer's name, the signature and the photos, and what the customer was
 * shown: the job's open snags and the checks' words. Refused, the signature goes
 * (the customer signs for what is true when they sign) and the checks, the
 * name and the photos stay on the phone for the next try.
 */
export function signOffLine(draft: SignOffDraft, key: string): NewLine {
  const values: Row = { visit_id: draft.visitId, signer_name: draft.signer.trim(), signature: draft.signature, photos: draft.photos.length === 0 ? null : [...draft.photos] };
  CHECKS.forEach((check, i) => (values[check] = draft.checks[i] === true));
  // What the customer was shown, written with the sign-off: the signed copy prints these (plan 68 S13).
  values["snags_at_signing"] = snagsAtSigning(draft.open);
  values["check_words"] = draft.checkWords.map((words) => words.replace(/\s+/g, " ").trim()).join("\n").slice(0, 1000);
  // The extra address goes with the sign-off itself, so a sign-off kept on the phone with no signal keeps it too.
  const copyTo = (draft.copyTo ?? "").trim();
  if (copyTo !== "") values["copy_sent_to"] = copyTo;
  return {
    kind: "sign-off",
    dropOnRefusal: ["signature"],
    meta: { visit: draft.visitId, job: draft.jobId, site: draft.site, signer: draft.signer.trim(), checks: draft.checks.filter(Boolean).length, photos: draft.photos.length },
    op: { type: "create", table: "sign_offs", values, key },
  };
}

/** The checks a sign-off line holds, in the columns' order. */
export const checksOf = (values: Row): boolean[] => CHECKS.map((check) => values[check] === true);

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
