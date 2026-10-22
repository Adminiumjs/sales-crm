/**
 * ONE-TO-ONE NOTES: what the screen reads and saves.
 *
 * PRIVATE TO ITS TWO PEOPLE. The tables behind this screen are marked
 * private in the manifest: a one-to-one, its sessions, a coaching plan and
 * its areas are read by the manager and the rep each row names, and by
 * nobody and nothing else (not the CRM admin, not Read-only, not the person
 * who runs the install, not a rule or an export). A rep reads her own; the
 * manager writes them.
 *
 * A SESSION IS SEVERAL SAVES: the session, then each action it sets, one by
 * one, each with its own key. A session whose reply is lost is sent again
 * with the same key and made once.
 */
import type { Saved, StaffSession } from "../../staffSession.ts";
import { ACTION_COLUMNS, countOf, sessionLinked, type Action } from "./data.ts";
import { readRepYear, type RepYear } from "./targets.ts";

export interface OneToOne extends Record<string, unknown> {
  id: number;
  manager_id: string;
  rep_id: string;
  next_at: string | null;
}
/** The drawn "what to cover" lines a session keeps a tick for (T04): each a yes/no column, no by default. */
export const TOPICS = ["sitting", "biggest", "target", "late"] as const;
export type Topic = (typeof TOPICS)[number];
export const topicColumn = (topic: Topic): string => `cover_${topic}`;

export interface Session extends Record<string, unknown> {
  id: number;
  one_to_one_id: number;
  held_on: string;
  notes: string | null;
  cover_sitting?: unknown;
  cover_biggest?: unknown;
  cover_target?: unknown;
  cover_late?: unknown;
  /** Something else raised, one line each; empty on a session written before 0.2.2. */
  raise?: string | null;
  /** How long it ran; empty when nobody said. */
  minutes?: number | string | null;
}
const SESSION_COLUMNS = ["id", "one_to_one_id", "held_on", "notes", ...TOPICS.map(topicColumn), "raise", "minutes"];
export interface Raise {
  kind: "sitting" | "biggest" | "target" | "late";
  deal?: string;
  stage?: string;
  days?: number;
  amount?: number;
  count?: number;
}

export interface Pair {
  sessions: Session[];
  /** Whether an action keeps the session it came from (the app's second stage on): then each session lists its own. */
  linked: boolean;
  sessionCount: number;
  actions: Action[];
  actionCount: number;
  openCount: number;
  year: RepYear;
  /** The open deal that has sat longest in its stage, and the biggest: what the record suggests raising. */
  sitting: { name: string; stage: string | null; since: string | null } | null;
  biggest: { name: string; amount: number | string | null } | null;
  late: number;
}

/** The one-to-ones the reader is part of: a rep's own, a manager's with each of her people. */
export const readOneToOnes = (session: StaffSession): Promise<OneToOne[]> => session.list<OneToOne>("one_to_ones", { select: ["id", "manager_id", "rep_id", "next_at"], order: ["id"], limit: 200 }).then((page) => page.rows);

export async function readPair(session: StaffSession, pair: OneToOne, now: Date, today: string): Promise<Pair> {
  const mine = { column: "one_to_one_id", op: "eq" as const, value: pair.id };
  const open = { and: [{ column: "owner_id", op: "eq" as const, value: pair.rep_id }, { column: "state", op: "eq" as const, value: "open" }] };
  const deals = session.can("deals", "read");
  const linked = sessionLinked(session);
  const [sessions, actions, openCount, year, sitting, biggest, late] = await Promise.all([
    session.list<Session>("one_to_one_sessions", { select: SESSION_COLUMNS, where: mine, order: ["held_on.desc", "id.desc"], limit: 100, count: "exact" }),
    session.can("actions", "read") ? session.list<Action>("actions", { select: linked ? [...ACTION_COLUMNS, "session_id"] : ACTION_COLUMNS, where: mine, order: ["id"], limit: 200, count: "exact" }) : Promise.resolve({ rows: [] as Action[], total: 0, next: null }),
    session.can("actions", "read") ? countOf(session, "actions", { and: [mine, { column: "done", op: "eq", value: false }] }) : Promise.resolve(0),
    readRepYear(session, pair.rep_id, today),
    deals ? session.list<{ name: string; entered_stage_at: string | null; stage: string | null }>("deals", { select: ["id", "name", "entered_stage_at"], where: open, lookup: ["stage:stage_id.label"], order: ["entered_stage_at", "id"], limit: 1 }) : Promise.resolve(null),
    deals ? session.list<{ name: string; amount: number | string | null }>("deals", { select: ["id", "name", "amount"], where: open, order: ["amount.desc", "id"], limit: 1 }) : Promise.resolve(null),
    session.can("follow_ups", "read")
      ? countOf(session, "follow_ups", { and: [{ column: "owner_id", op: "eq", value: pair.rep_id }, { column: "kind", op: "eq", value: "step" }, { column: "done", op: "eq", value: false }, { column: "due_at", op: "lt", value: now.toISOString() }] })
      : Promise.resolve(0),
  ]);
  const first = sitting?.rows[0];
  const big = biggest?.rows[0];
  return {
    sessions: sessions.rows,
    linked,
    sessionCount: Number(sessions.total ?? sessions.rows.length),
    actions: actions.rows,
    actionCount: Number(actions.total ?? actions.rows.length),
    openCount,
    year,
    sitting: first === undefined ? null : { name: first.name, stage: first.stage, since: first.entered_stage_at },
    biggest: big === undefined ? null : { name: big.name, amount: big.amount },
    late,
  };
}

export interface DraftAction {
  text: string;
  owner: string;
  due: string;
  key: string;
}

export type SessionSaved = { state: "saved"; actions: number; failed: number } | { state: "refused"; error: Extract<Saved, { state: "refused" }>["error"] } | { state: "unknown" };

export interface SessionValues {
  held_on: string;
  notes: string;
  /** The "what to cover" lines ticked off. */
  covered: readonly Topic[];
  /** Something else raised, one line each. */
  raised: readonly string[];
  /** How long it ran, or null when nobody said. */
  minutes: number | null;
}

/** The row a session is saved as: its ticks (each one sent, yes or no), what else was raised (empty for nothing) and its length. */
export function sessionRow(pair: OneToOne, values: SessionValues): Record<string, unknown> {
  const raised = values.raised.map((line) => line.trim()).filter((line) => line !== "");
  return {
    one_to_one_id: pair.id,
    manager_id: pair.manager_id,
    rep_id: pair.rep_id,
    held_on: values.held_on,
    notes: values.notes,
    ...Object.fromEntries(TOPICS.map((topic) => [topicColumn(topic), values.covered.includes(topic)])),
    raise: raised.length === 0 ? null : raised.join("\n"),
    minutes: values.minutes,
  };
}

/** The lines a session raised, as kept: one each. */
export const raisedOf = (one: Pick<Session, "raise">): string[] =>
  (one.raise ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

/**
 * Save a session, then the actions it sets. The session's key is the form's own, so sending it again makes one session.
 * Where an action keeps its session (`linked`), each action names the one just made, and is listed under it.
 */
export async function saveSession(session: StaffSession, pair: OneToOne, values: SessionValues, actions: DraftAction[], key: string, linked = sessionLinked(session)): Promise<SessionSaved> {
  const made = await session.create<Session>("one_to_one_sessions", sessionRow(pair, values), key);
  if (made.state !== "saved") return made;
  let saved = 0;
  let failed = 0;
  for (const action of actions) {
    const one = await session.create(
      "actions",
      { text: action.text, owner_id: action.owner, due_on: action.due === "" ? null : action.due, source: "one-to-one", one_to_one_id: pair.id, ...(linked ? { session_id: made.row.id } : {}) },
      action.key,
    );
    if (one.state === "saved") saved += 1;
    else failed += 1;
  }
  return { state: "saved", actions: saved, failed };
}
