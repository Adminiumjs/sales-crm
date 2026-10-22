/**
 * ONE DEAL, as its room reads it.
 *
 * Three reads, each asked again only when its own tables change:
 *  - the deal itself with who is on it, its quotes and how many threads are
 *    open (`readRoom`);
 *  - what happened on it (`readTimeline`): what people logged, the amount a
 *    quote was sent at, and the record's own history for every change to the
 *    deal itself (its stage, the amount typed, the owner, the close date, how
 *    it closed), with the kept rows of stage changes for the time before that
 *    history begins;
 *  - the company and its people (`readSide`), once per deal.
 *
 * Every figure is the server's: the amount, the weighted value, the odds.
 * This file subtracts a time from the server's clock (days in a stage) and
 * puts lines in order; it adds no rows up.
 */
import type { StaffSession } from "../../staffSession.ts";
import { readQuotes, type Quote } from "../quotes/data.ts";

export interface Stage extends Record<string, unknown> {
  id: number;
  label: string;
  odds: number | string;
  position: number;
}

export interface Deal extends Record<string, unknown> {
  id: number;
  name: string;
  scope: string | null;
  company_id: number;
  contact_id: number | null;
  owner_id: string | null;
  stage_id: number;
  entered_stage_at: string | null;
  opened_on: string | null;
  expected_close: string | null;
  state: "open" | "won" | "lost";
  closed_on: string | null;
  cycle_days: number | string | null;
  lost_reason_id: number | null;
  close_note: string | null;
  typed_amount: number | string | null;
  quoted_amount: number | string | null;
  quote_id: number | null;
  amount: number | string;
  stage_odds: number | string;
  weighted_value: number | string;
  company: string | null;
  contact: string | null;
  lost_reason: string | null;
}

export interface Member extends Record<string, unknown> {
  id: number;
  deal_id: number;
  user_id: string;
  since: string | null;
  added_by_id: string | null;
}

export interface Company extends Record<string, unknown> {
  id: number;
  name: string;
  sector: string | null;
  headcount: number | null;
  town: string | null;
}

export interface Contact extends Record<string, unknown> {
  id: number;
  name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
}

export interface Activity extends Record<string, unknown> {
  id: number;
  kind: "call" | "email" | "meeting" | "note";
  text: string;
  author_id: string | null;
  at: string;
}

export interface StageChange extends Record<string, unknown> {
  id: number;
  from_stage_id: number | null;
  to_stage_id: number;
  by_id: string | null;
  at: string;
}

export interface AmountLine extends Record<string, unknown> {
  id: number;
  quote_id: number | null;
  amount: number | string;
  at: string;
  quote: string | null;
}

/** One entry of a record's history, as the server answers it: the whole row before and after. */
export interface HistoryRow {
  id: string;
  createdAt: number | string;
  actorKind: string;
  actorLabel: string | null;
  action: string;
  changes: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } | null;
}

export interface Cover extends Record<string, unknown> {
  id: number;
  owner_id: string;
  cover_id: string;
  starts_on: string;
  ends_on: string | null;
}

export interface Fixed {
  stages: Stage[];
  warmDays: number;
  staleDays: number;
  /** The people who have a rep's profile here: who "Add someone" and "Who picks it up" offer. Empty when the reader may not read it. */
  reps: string[];
}

export interface RoomData {
  deal: Deal;
  members: Member[];
  quotes: Quote[];
  /** Threads nobody has settled, counted by the server; null when the reader reads no comments. */
  openThreads: number | null;
  /** A cover of the owner's deals that is coming up or running, when the reader may see one. */
  cover: Cover | null;
  coverNote: { id: number; text: string } | null;
}

export interface Side {
  company: Company | null;
  contacts: Contact[];
}

export interface TimelineData {
  activities: Activity[];
  stageChanges: StageChange[];
  amountLines: AmountLine[];
  history: HistoryRow[];
}

export const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);

export const DEAL_LOOKUPS = ["company:company_id.name", "contact:contact_id.name", "lost_reason:lost_reason_id.label"];

/** What does not change while a deal is open on the page: the stages, the two "sitting" settings, who has a rep's profile. */
export async function readFixed(session: StaffSession): Promise<Fixed> {
  const [stages, settings, reps] = await Promise.all([
    session.can("stages", "read") ? session.list<Stage>("stages", { select: ["id", "label", "odds", "position"], order: ["position"], limit: 50 }).then((page) => page.rows) : Promise.resolve([] as Stage[]),
    session.can("settings", "read") ? session.list<{ sitting_warm_days: number | null; sitting_stale_days: number | null }>("settings", { select: ["sitting_warm_days", "sitting_stale_days"], limit: 1 }).then((page) => page.rows[0] ?? null) : Promise.resolve(null),
    session.part("team") && session.can("reps", "read") ? session.list<{ user_id: string }>("reps", { select: ["user_id"], limit: 200 }).then((page) => page.rows.map((row) => row.user_id)) : Promise.resolve([] as string[]),
  ]);
  return { stages, warmDays: num(settings?.sitting_warm_days) || 14, staleDays: num(settings?.sitting_stale_days) || 30, reps };
}

const ofDeal = (id: number) => ({ column: "deal_id", op: "eq" as const, value: id });

/** The deal, or null when the server says there is none for this reader (not there, or not theirs: the two read alike). */
export async function readRoom(session: StaffSession, id: number, today: string): Promise<RoomData | null> {
  const deal = await session.get<Deal>("deals", id, { lookup: DEAL_LOOKUPS });
  if (deal === null) return null;
  const seesCover = session.part("team") && session.can("covers", "read") && deal.owner_id !== null && deal.state === "open";
  const [members, quotes, threads, covers] = await Promise.all([
    session.can("deal_members", "read") ? session.list<Member>("deal_members", { select: ["id", "deal_id", "user_id", "since", "added_by_id"], where: ofDeal(id), order: ["id"], limit: 200 }).then((page) => page.rows) : Promise.resolve([] as Member[]),
    session.part("quotes") && session.can("quotes", "read") ? readQuotes(session, ofDeal(id)) : Promise.resolve([] as Quote[]),
    // How many threads are open is the server's count of them, not a list measured here.
    session.can("comments", "read")
      ? session.list("comments", { select: ["id"], where: { and: [ofDeal(id), { column: "parent_id", op: "is_null" }, { column: "settled_at", op: "is_null" }] }, limit: 1, count: "exact" }).then((page) => page.total)
      : Promise.resolve(null),
    seesCover
      ? session
          .list<Cover>("covers", { select: ["id", "owner_id", "cover_id", "starts_on", "ends_on"], where: { and: [{ column: "owner_id", op: "eq", value: deal.owner_id }, { or: [{ column: "ends_on", op: "gte", value: today }, { column: "ends_on", op: "is_null" }] }] }, order: ["starts_on"], limit: 1 })
          .then((page) => page.rows[0] ?? null)
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  // The card is for the two people of the cover only: who is away, and who covers.
  const me = session.config.user?.id ?? null;
  const cover = covers !== null && (covers.owner_id === me || covers.cover_id === me) ? covers : null;
  const coverNote =
    cover !== null && session.can("cover_notes", "read")
      ? await session
          .list<{ id: number; text: string }>("cover_notes", { select: ["id", "text"], where: { and: [ofDeal(id), { column: "cover_id", op: "eq", value: cover.id }] }, limit: 1 })
          .then((page) => page.rows[0] ?? null)
          .catch(() => null)
      : null;
  return { deal, members, quotes, openThreads: threads, cover, coverNote };
}

export async function readSide(session: StaffSession, companyId: number): Promise<Side> {
  const [company, contacts] = await Promise.all([
    session.part("accounts") && session.can("companies", "read") ? session.get<Company>("companies", companyId) : Promise.resolve(null),
    session.part("accounts") && session.can("contacts", "read")
      ? // No column list: a column the reader's role sees masked (an address, a number) is then answered empty, where naming it would refuse the whole read.
        session.list<Contact>("contacts", { where: { column: "company_id", op: "eq", value: companyId }, order: ["name"], limit: 200 }).then((page) => page.rows)
      : Promise.resolve([] as Contact[]),
  ]);
  return { company, contacts };
}

export async function readTimeline(session: StaffSession, id: number): Promise<TimelineData> {
  const [activities, stageChanges, amountLines, history] = await Promise.all([
    session.can("activities", "read") ? session.list<Activity>("activities", { select: ["id", "kind", "text", "author_id", "at"], where: ofDeal(id), order: ["at.desc", "id.desc"], limit: 200 }).then((page) => page.rows) : Promise.resolve([] as Activity[]),
    session.can("deal_stage_changes", "read")
      ? session.list<StageChange>("deal_stage_changes", { select: ["id", "from_stage_id", "to_stage_id", "by_id", "at"], where: ofDeal(id), order: ["at.desc", "id.desc"], limit: 200 }).then((page) => page.rows)
      : Promise.resolve([] as StageChange[]),
    session.part("quotes") && session.can("deal_amount_changes", "read")
      ? session.list<AmountLine>("deal_amount_changes", { select: ["id", "quote_id", "amount", "at"], where: ofDeal(id), lookup: session.can("quotes", "read") ? ["quote:quote_id.number"] : [], order: ["at.desc", "id.desc"], limit: 200 }).then((page) => page.rows)
      : Promise.resolve([] as AmountLine[]),
    // The record's own history: every change a person or a rule made to the deal's row.
    (session.history("deals", id, { limit: 100 }) as unknown as Promise<{ entries: HistoryRow[] }>).then(
      (page) => page.entries,
      () => [] as HistoryRow[],
    ),
  ]);
  return { activities, stageChanges, amountLines, history };
}

const moment = (value: number | string): number => (typeof value === "number" ? value : Date.parse(value));

/**
 * A record's history is kept by its number, and a database may give a new row
 * the number of one that was removed (SQLite does). What happened to that
 * earlier row is not this one's story: the history starts where this row was
 * made, at the newest "created" entry the read holds.
 */
export function ownHistory(history: readonly HistoryRow[]): HistoryRow[] {
  const born = history.reduce<number | null>((latest, entry) => (entry.action === "record.create" && (latest === null || moment(entry.createdAt) > latest) ? moment(entry.createdAt) : latest), null);
  return born === null ? [...history] : history.filter((entry) => moment(entry.createdAt) >= born);
}

/** A change to one column of the deal that the timeline says in words. A change of stage is not here: it has lines of its own. */
export type Change =
  | { column: "typed_amount"; before: number | null; after: number | null }
  | { column: "owner_id"; before: string | null; after: string | null }
  | { column: "expected_close"; before: string | null; after: string | null }
  | { column: "name"; before: string; after: string }
  | { column: "contact_id"; before: number | null; after: number | null }
  | { column: "scope"; before: string | null; after: string | null }
  | { column: "state"; before: string; after: string; reasonId: number | null; note: string | null };

export type Line =
  | { key: string; at: number; type: "activity"; kind: Activity["kind"]; who: string | null; text: string }
  | { key: string; at: number; type: "stage"; who: string | null; whoLabel: string | null; from: number | null; to: number }
  | { key: string; at: number; type: "quoted"; amount: number; quote: string | null }
  | { key: string; at: number; type: "change"; whoLabel: string | null; change: Change };

const asNumber = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : num(value));
const asText = (value: unknown): string | null => (value === null || value === undefined || value === "" ? null : String(value));
const day = (value: unknown): string | null => (asText(value) === null ? null : String(value).slice(0, 10));
const differs = (a: unknown, b: unknown): boolean => (a ?? null) !== (b ?? null) && String(a ?? "") !== String(b ?? "");

/** The changes one history entry made that the timeline says: the columns a person sets, never the ones the server keeps. */
export function changesOf(entry: HistoryRow): Change[] {
  const before = entry.changes?.before ?? null;
  const after = entry.changes?.after ?? null;
  if (entry.action !== "record.update" || before === null || after === null) return [];
  const out: Change[] = [];
  if (differs(before["state"], after["state"])) out.push({ column: "state", before: String(before["state"]), after: String(after["state"]), reasonId: asNumber(after["lost_reason_id"]), note: asText(after["close_note"]) });
  if (differs(before["owner_id"], after["owner_id"])) out.push({ column: "owner_id", before: asText(before["owner_id"]), after: asText(after["owner_id"]) });
  if (asNumber(before["typed_amount"]) !== asNumber(after["typed_amount"])) out.push({ column: "typed_amount", before: asNumber(before["typed_amount"]), after: asNumber(after["typed_amount"]) });
  if (day(before["expected_close"]) !== day(after["expected_close"])) out.push({ column: "expected_close", before: day(before["expected_close"]), after: day(after["expected_close"]) });
  if (differs(before["name"], after["name"])) out.push({ column: "name", before: String(before["name"] ?? ""), after: String(after["name"] ?? "") });
  if (asNumber(before["contact_id"]) !== asNumber(after["contact_id"])) out.push({ column: "contact_id", before: asNumber(before["contact_id"]), after: asNumber(after["contact_id"]) });
  if (differs(before["scope"], after["scope"])) out.push({ column: "scope", before: asText(before["scope"]), after: asText(after["scope"]) });
  return out;
}

/**
 * Everything that happened on a deal, newest first.
 *
 * A CHANGE OF STAGE IS KEPT TWICE, AND SAID ONCE. The deal's own history holds
 * every move the moment it is made, with who and when and from where. The
 * app's rule also writes a row of `deal_stage_changes` for it, a minute later
 * (once the move can no longer be undone); since F21 the row names where from,
 * where to, who, and the move's own moment, copied from what the server kept
 * on the deal at the move. The history is what the room says, as far back as
 * it was read, because it is there at once; a row is said only for the time
 * before that: the sample's deals, which have rows and no history, and
 * whatever a long history's first hundred entries do not reach. A row's moment
 * is the move's, a hair before the history's entry of the same write (the
 * stamp is taken as the write starts), so the cut leaves a few seconds' room.
 * A row that does not say where the deal came from (older rows) came from the
 * stage of the row before it.
 */
const SAME_WRITE_MS = 5_000;
export function timelineOf(read: TimelineData): Line[] {
  const history = ownHistory(read.history);
  const data = { ...read, history };
  const lines: Line[] = [];
  for (const activity of data.activities) lines.push({ key: `a${String(activity.id)}`, at: moment(activity.at), type: "activity", kind: activity.kind, who: activity.author_id, text: activity.text });
  for (const entry of history) {
    const before = entry.changes?.before ?? null;
    const after = entry.changes?.after ?? null;
    const made = entry.action === "record.create";
    const to = asNumber(after?.["stage_id"]);
    if (to === null || (!made && (entry.action !== "record.update" || before === null || asNumber(before["stage_id"]) === to))) continue;
    lines.push({ key: `m${entry.id}`, at: moment(entry.createdAt), type: "stage", who: null, whoLabel: entry.actorLabel, from: made ? null : asNumber(before?.["stage_id"]), to });
  }
  // Where the history read begins: the deal's making when the read holds it, else its oldest entry. Rows from then on are the rule's own copies of moves the history holds.
  const reach = history.reduce((oldest, entry) => Math.min(oldest, moment(entry.createdAt)), Number.POSITIVE_INFINITY);
  const rows = [...data.stageChanges].sort((a, b) => moment(a.at) - moment(b.at) || a.id - b.id).filter((row) => moment(row.at) < reach - SAME_WRITE_MS);
  rows.forEach((move, index) => {
    const from = move.from_stage_id ?? (index === 0 ? null : rows[index - 1]!.to_stage_id);
    lines.push({ key: `s${String(move.id)}`, at: moment(move.at), type: "stage", who: move.by_id, whoLabel: null, from, to: move.to_stage_id });
  });
  for (const line of data.amountLines) lines.push({ key: `q${String(line.id)}`, at: moment(line.at), type: "quoted", amount: num(line.amount), quote: line.quote ?? null });
  for (const entry of history) {
    for (const change of changesOf(entry)) lines.push({ key: `h${entry.id}:${change.column}`, at: moment(entry.createdAt), type: "change", whoLabel: entry.actorLabel, change });
  }
  return lines.sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : -1));
}

export type Sitting = "fresh" | "warm" | "stale";
export const sittingOf = (days: number, fixed: Pick<Fixed, "warmDays" | "staleDays">): Sitting => (days >= fixed.staleDays ? "stale" : days >= fixed.warmDays ? "warm" : "fresh");

const MENTION = /@\[([^\]\n]{1,120})\]\((usr_[0-9A-Za-z]{6,40})\)/g;

export type TextPart = { text: string } | { mention: string; id: string };

/** A stored text in pieces: what was written, and each colleague it names (kept by Adminium as `@[Name](usr_…)`). */
export function mentionParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let from = 0;
  for (const match of text.matchAll(MENTION)) {
    if (match.index > from) parts.push({ text: text.slice(from, match.index) });
    parts.push({ mention: match[1]!, id: match[2]! });
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}

/** The people a stored text names, each once, with the name it was written under. */
export function mentioned(text: string): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const part of mentionParts(text)) if ("mention" in part && !out.some((one) => one.id === part.id)) out.push({ id: part.id, name: part.mention });
  return out;
}

/** Whether a cover is running on a day, or still to come. */
export const coverPhase = (cover: Pick<Cover, "starts_on" | "ends_on">, today: string): "coming" | "running" | "over" => (cover.starts_on.slice(0, 10) > today ? "coming" : cover.ends_on !== null && cover.ends_on.slice(0, 10) < today ? "over" : "running");

export interface Comment extends Record<string, unknown> {
  id: number;
  deal_id: number;
  parent_id: number | null;
  author_id: string | null;
  text: string;
  settled_by_id: string | null;
  settled_at: string | null;
  /** When it was written: the server's stamp; empty for a comment written before 0.2.2. */
  at?: string | null;
}

export interface Thread {
  first: Comment;
  replies: Comment[];
}

/** Comments as threads, the newest thread first and its replies in the order they were written. A table of comments keeps no time of its own: the order is the order they were made in. */
export function threadsOf(comments: readonly Comment[]): Thread[] {
  const firsts = comments.filter((comment) => comment.parent_id === null).sort((a, b) => b.id - a.id);
  return firsts.map((first) => ({ first, replies: comments.filter((comment) => comment.parent_id === first.id).sort((a, b) => a.id - b.id) }));
}

export async function readComments(session: StaffSession, id: number): Promise<{ deal: Deal; members: Member[]; comments: Comment[] } | null> {
  const deal = await session.get<Deal>("deals", id, { lookup: DEAL_LOOKUPS });
  if (deal === null) return null;
  const [comments, members] = await Promise.all([
    session.list<Comment>("comments", { select: ["id", "deal_id", "parent_id", "author_id", "text", "at", "settled_by_id", "settled_at"], where: ofDeal(id), order: ["id"], limit: 200 }).then((page) => page.rows),
    session.can("deal_members", "read") ? session.list<Member>("deal_members", { select: ["id", "deal_id", "user_id", "since", "added_by_id"], where: ofDeal(id), limit: 200 }).then((page) => page.rows) : Promise.resolve([] as Member[]),
  ]);
  return { deal, members, comments };
}
