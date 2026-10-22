/**
 * A PERSON'S OWN: what her weekly summary would hold, how she is told, her
 * details, her saved views and searches, her own figures.
 *
 * Most of this is Adminium's own, not the app's: a person's language, the
 * kinds of notice that reach her and by which channel, her quiet hours, the
 * day and time her summaries go out, and the summary rules that write to her
 * (`/me`, `/me/prefs`, `/me/notification-prefs`, `/me/notification-schedule`,
 * `/me/summaries`). The session's own request function carries those calls,
 * except the one that sends a test: see `sendTest`.
 *
 * WHAT IS CUT TO HER ROLES AND PARTS. A kind of notice is listed only when
 * something can send it to her: a mention while Selling is on; a rule's
 * notice only when one of the app's rules could name her (she can own a
 * follow-up or a deal, she asks for approvals, she gives them). A summary
 * only when the server says one of the summary rules writes to her.
 */
import type { Formatters } from "../../lib/format.ts";
import { addDays } from "../../lib/format.ts";
import { LostReply, StaffError, type Condition, type Grouped, type Saved, type StaffSession } from "../../staffSession.ts";

/* ── The summary rules that write to her, and their state (R7) ───────────── */

export interface Summary {
  id: string;
  name: string;
  /** Whether the rule is switched on. A server that does not say leaves it out. */
  enabled?: boolean;
}

export const readSummaries = (session: StaffSession): Promise<Summary[]> => session.call<{ data: Summary[] }>("GET", "/me/summaries").then((doc) => doc.data);

/**
 * WHETHER A RULE IS SWITCHED ON, as far as this person can be told (ruling
 * R7). The ONE place a screen asks: `on`, `off`, or `unknown` when nothing
 * the server answers her says.
 *
 * Today the server says it for her own summary rules and for nothing else:
 * no app role can read the state of a rule that sends notices. When the
 * server answers that too, the rows it answers are passed here and no screen
 * changes.
 */
export type RuleState = "on" | "off" | "unknown";
export const ruleState = (rule: { enabled?: unknown } | null | undefined): RuleState => (rule === null || rule === undefined || typeof rule.enabled !== "boolean" ? "unknown" : rule.enabled ? "on" : "off");

export type TestSent =
  /** Made and handed to the mail. `left` more may be asked this hour. */
  | { state: "sent"; left: number }
  /** Made, and not delivered: this install has no outgoing mail, or the summary has no e-mail template. */
  | { state: "made"; reason: "no-email" | "no-template"; left: number }
  /** Three were asked this hour: `seconds` until the next may be. */
  | { state: "limited"; seconds: number }
  /** Not a summary of hers (any more). */
  | { state: "gone" }
  | { state: "refused"; message: string }
  | { state: "lost" };

/**
 * "Send me a test": her own summary, to her own address, now. The server
 * allows three an hour, and sends it also while the rule is switched off.
 *
 * A fetch of its own, not the session's: the session's request function
 * waits and sends again after a 429, which is right for a list and wrong
 * here (the wait is up to an hour, and a second send would be a second
 * mail). It carries the session's token the way the session does.
 */
export async function sendTest(session: StaffSession, ruleId: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<TestSent> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/v1/me/summaries/${encodeURIComponent(ruleId)}/send`, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json", "x-adminium-csrf": session.config.csrfToken ?? "" },
      body: "{}",
    });
  } catch {
    return { state: "lost" };
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after") ?? "");
    return { state: "limited", seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 3600 };
  }
  if (res.status === 404) return { state: "gone" };
  if (res.status >= 500) return { state: "lost" };
  const doc = (await res.json().catch(() => null)) as { data?: { sent?: boolean; reason?: string | null; left?: number }; error?: { message?: string } } | null;
  if (!res.ok) return { state: "refused", message: doc?.error?.message ?? "" };
  const left = Number(doc?.data?.left ?? 0);
  if (doc?.data?.sent === true) return { state: "sent", left };
  return { state: "made", reason: doc?.data?.reason === "no-template" ? "no-template" : "no-email", left };
}

/* ── What the summary holds ──────────────────────────────────────────────── */

/** The two summaries the app ships: a rep's (and an account manager's) own week, a sales manager's own week. */
export type DigestKind = "rep" | "manager";
export const digestKinds = (slugs: readonly string[]): DigestKind[] => [
  ...(slugs.includes("crm-rep") || slugs.includes("crm-account-manager") ? (["rep"] as const) : []),
  ...(slugs.includes("crm-sales-manager") ? (["manager"] as const) : []),
];

export type SectionKey = "closing" | "due" | "slipped" | "quiet";
export const SECTIONS: Record<DigestKind, readonly SectionKey[]> = { rep: ["closing", "due", "slipped"], manager: ["closing", "slipped", "quiet"] };

export interface DigestLine {
  id: number;
  title: string;
  sub: string | null;
  /** A day (`expected_close`) or a moment (`due_at`, `last_activity_at`). */
  at: string | null;
  amount: number | string | null;
  dealId: number | null;
}
export interface DigestSection {
  key: SectionKey;
  /** How many rows the section holds for her, by the server's count; the mail lists the first twenty. */
  total: number;
  lines: DigestLine[];
}

const LISTED = 20;

/**
 * The sections of a summary, read the way the rule reads them for her: her
 * own rows (`owner_id` is her), the same conditions, the same order, twenty
 * to a section. Nothing is added up here: each section's count is the
 * server's.
 */
export async function readDigest(session: StaffSession, kind: DigestKind, now: Date, f: Formatters): Promise<DigestSection[]> {
  const me = session.config.user?.id ?? "";
  const today = f.dayKey(now);
  const mine: Condition = { column: "owner_id", op: "eq", value: me };
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const notDone: Condition = { column: "done", op: "eq", value: false };
  const week = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const deals = session.can("deals", "read");
  const steps = session.can("follow_ups", "read");
  const none = (key: SectionKey): DigestSection => ({ key, total: 0, lines: [] });
  const read: Record<SectionKey, () => Promise<DigestSection>> = {
    closing: async () => {
      if (!deals) return none("closing");
      const page = await session.list<{ id: number; name: string; expected_close: string; amount: number | string; company: string | null }>("deals", {
        select: ["id", "name", "expected_close", "amount"],
        where: { and: [mine, open, { column: "expected_close", op: "between", value: [today, addDays(today, 7)] }] },
        order: ["expected_close", "id"],
        lookup: ["company:company_id.name"],
        limit: LISTED,
        count: "exact",
      });
      return { key: "closing", total: page.total ?? page.rows.length, lines: page.rows.map((row) => ({ id: row.id, title: row.name, sub: row.company, at: row.expected_close, amount: row.amount, dealId: row.id })) };
    },
    due: () => followUps("due", { column: "due_at", op: "between", value: [now.toISOString(), week] }),
    slipped: () => followUps("slipped", { column: "due_at", op: "lt", value: new Date(now.getTime() - 60_000).toISOString() }),
    quiet: async () => {
      if (!deals) return none("quiet");
      const page = await session.list<{ id: number; name: string; last_activity_at: string; company: string | null }>("deals", {
        select: ["id", "name", "last_activity_at"],
        where: { and: [mine, open, { column: "last_activity_at", op: "lt", value: new Date(now.getTime() - 7 * 86_400_000).toISOString() }] },
        order: ["last_activity_at", "id"],
        lookup: ["company:company_id.name"],
        limit: LISTED,
        count: "exact",
      });
      return { key: "quiet", total: page.total ?? page.rows.length, lines: page.rows.map((row) => ({ id: row.id, title: row.name, sub: row.company, at: row.last_activity_at, amount: null, dealId: row.id })) };
    },
  };
  async function followUps(key: "due" | "slipped", when: Condition): Promise<DigestSection> {
    if (!steps) return none(key);
    const page = await session.list<{ id: number; text: string; due_at: string; deal_id: number | null; deal: string | null }>("follow_ups", {
      select: ["id", "text", "due_at", "deal_id"],
      where: { and: [mine, notDone, when] },
      order: ["due_at", "id"],
      ...(deals ? { lookup: ["deal:deal_id.name"] } : {}),
      limit: LISTED,
      count: "exact",
    });
    return { key, total: page.total ?? page.rows.length, lines: page.rows.map((row) => ({ id: row.id, title: row.text, sub: row.deal ?? null, at: row.due_at, amount: null, dealId: row.deal_id })) };
  }
  return Promise.all(SECTIONS[kind].map((key) => read[key]()));
}

/* ── How she is told ─────────────────────────────────────────────────────── */

export interface Channels {
  inApp: boolean;
  email: boolean;
  push: boolean;
  always?: boolean;
}
export interface Told {
  channels: { id: "inApp" | "email" | "push"; available: boolean; reason?: string }[];
  events: { key: string; channels: Channels; custom: boolean }[];
}
export interface Schedule {
  timezone: string | null;
  quiet: Record<string, { from: string; to: string }> | null;
  digestDay: number | null;
  digestTime: string | null;
  fallbackTimezone: string;
  /** Quiet hours switched on; off keeps the hours for when they are on again (absent: an older server, on). */
  quietOn?: boolean;
  /** "Not me": no rule's summary is made for her; the day and time are kept (absent: an older server, on). */
  summariesOn?: boolean;
}

export const readTold = (session: StaffSession): Promise<Told> => session.call<{ data: Told }>("GET", "/me/notification-prefs").then((doc) => doc.data);
export const readSchedule = (session: StaffSession): Promise<Schedule> => session.call<{ data: Schedule }>("GET", "/me/notification-schedule").then((doc) => doc.data);

/** The kinds of notice Adminium keeps a switch for, of the ones this app can cause. */
export type Kind = "mention" | "automation.notice";
/** What a kind is set to when the person has never chosen: Adminium's own default. */
export const DEFAULT_CHANNELS: Channels = { inApp: true, email: true, push: false };
export const channelsOf = (told: Told, kind: Kind): Channels => told.events.find((event) => event.key === kind)?.channels ?? DEFAULT_CHANNELS;

/** What one of the app's rules can tell a person, by what she must be able to do for it to name her. */
export type Reason = "followUp" | "nudge" | "handedOver" | "quoteRunsOut" | "approvalAsked" | "approvalAnswered" | "visitChanged";
export function reasonsFor(session: Pick<StaffSession, "can" | "part">, slugs: readonly string[]): Reason[] {
  const selling = session.part("selling");
  const quotes = session.part("quotes");
  // The owner of a follow-up; the owner of a deal; whoever asks for an approval; whoever is asked.
  const ownsSteps = selling && session.can("follow_ups", "create");
  const ownsDeals = selling && session.can("deals", "create");
  const out: Reason[] = [];
  if (ownsSteps) out.push("followUp");
  if (ownsDeals) out.push("nudge", "handedOver");
  if (ownsDeals && quotes && session.can("quotes", "read")) out.push("quoteRunsOut");
  if (quotes && slugs.includes("crm-sales-manager")) out.push("approvalAsked");
  if (quotes && session.can("quotes", "create")) out.push("approvalAnswered");
  // The field crew: a visit of today or tomorrow that starts at another time, moves onto those days or comes to his crew (P22).
  if (session.part("jobs") && slugs.includes("crm-crew")) out.push("visitChanged");
  return out;
}

/** The kinds listed for this person: only what something can send her. */
export function kindsFor(session: Pick<StaffSession, "can" | "part">, slugs: readonly string[]): Kind[] {
  const out: Kind[] = [];
  // Anybody who signs in here can be named in a comment on a deal, while there are deals to comment on.
  if (session.part("selling")) out.push("mention");
  if (reasonsFor(session, slugs).length > 0) out.push("automation.notice");
  return out;
}

/** Quiet hours as the screen holds them: one stretch, the same every day. */
export interface Quiet {
  on: boolean;
  from: string;
  to: string;
  /** The server holds different hours on different days (set in Adminium's own screen): saving here makes them one. */
  mixed: boolean;
}
const DAYS = ["0", "1", "2", "3", "4", "5", "6"] as const;
export function quietOf(schedule: Pick<Schedule, "quiet" | "quietOn">): Quiet {
  const held = schedule.quiet === null ? [] : DAYS.map((day) => schedule.quiet![day]).filter((one): one is { from: string; to: string } => one !== undefined);
  const first = held[0];
  if (first === undefined) return { on: false, from: "18:30", to: "08:00", mixed: false };
  // Switched off, the hours are kept by the server: shown, ready for when she switches them on again.
  return { on: schedule.quietOn !== false, from: first.from, to: first.to, mixed: held.length !== DAYS.length || held.some((one) => one.from !== first.from || one.to !== first.to) };
}
/** The hours as the server keeps them: every day the same, kept whether they are on or off (the switch says which). */
export const quietFor = (quiet: Pick<Quiet, "from" | "to">): Schedule["quiet"] => Object.fromEntries(DAYS.map((day) => [day, { from: quiet.from, to: quiet.to }]));

export interface ToldChoice {
  kinds: Partial<Record<Kind, { inApp: boolean; email: boolean }>>;
  quiet: Pick<Quiet, "on" | "from" | "to">;
  digestDay: number | null;
  digestTime: string | null;
  /** False: "not me", no summary is made for her. */
  summariesOn: boolean;
}

/**
 * Save how she is told: the kinds shown, then her hours. Both are "set it to
 * this", so a reply that never arrives is answered by sending the same again
 * once and reading back; `unknown` only when nothing could be read either.
 */
export async function saveTold(session: StaffSession, was: { told: Told; schedule: Schedule }, choice: ToldChoice): Promise<{ state: "saved"; told: Told; schedule: Schedule } | { state: "refused"; error: StaffError } | { state: "unknown" }> {
  const events = (Object.keys(choice.kinds) as Kind[]).map((key) => ({ key, channels: { ...channelsOf(was.told, key), ...choice.kinds[key] } }));
  const hours = { timezone: was.schedule.timezone, quiet: quietFor(choice.quiet), quietOn: choice.quiet.on, digestDay: choice.digestDay, digestTime: choice.digestTime, summariesOn: choice.summariesOn };
  const once = async (): Promise<{ told: Told; schedule: Schedule }> => {
    const told = events.length === 0 ? was.told : (await session.call<{ data: Told }>("PUT", "/me/notification-prefs", { events })).data;
    const schedule = (await session.call<{ data: Schedule }>("PUT", "/me/notification-schedule", hours)).data;
    return { told, schedule };
  };
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      return { state: "saved", ...(await once()) };
    } catch (error) {
      if (error instanceof StaffError) return { state: "refused", error };
      if (!(error instanceof LostReply)) throw error;
    }
  }
  return { state: "unknown" };
}

/* ── Her details ─────────────────────────────────────────────────────────── */

export interface RepRow extends Record<string, unknown> {
  id: number;
  user_id: string;
  hours_from: string | null;
  hours_to: string | null;
}
export interface Details {
  name: string;
  email: string;
  /** Her own choice of language as Adminium keeps it (`de_DE`), or null: as the install is set. */
  locale: string | null;
  /** The language in force for her. */
  resolved: string;
  /** Her rep's profile, when she has one: only then do working hours mean anything. */
  rep: RepRow | null;
}

export async function readDetails(session: StaffSession): Promise<Details> {
  const me = session.config.user;
  const [prefs, rep] = await Promise.all([
    session.call<{ data: { prefs: { locale: string | null }; resolved: { locale: string } } }>("GET", "/me/prefs"),
    me !== null && session.part("team") && session.can("reps", "read") ? session.list<RepRow>("reps", { select: ["id", "user_id", "hours_from", "hours_to"], where: { column: "user_id", op: "eq", value: me.id }, limit: 1 }).then((page) => page.rows[0] ?? null) : Promise.resolve(null),
  ]);
  return { name: me?.name ?? "", email: me?.email ?? "", locale: prefs.data.prefs.locale, resolved: prefs.data.resolved.locale, rep };
}

/** `de-DE` as the app writes a language, `de_DE` as Adminium keeps it. */
export const toServerLocale = (tag: string): string => tag.replace("-", "_");
export const fromServerLocale = (id: string): string => id.replace("_", "-");

export interface DetailsChoice {
  name: string;
  locale: string | null;
  hours: { from: string; to: string } | null;
}

/** Save what changed, one door at a time, and say which one failed. */
export async function saveDetails(session: StaffSession, was: Details, choice: DetailsChoice): Promise<{ state: "saved" } | { state: "refused"; error: StaffError } | { state: "unknown" }> {
  try {
    if (choice.name.trim() !== was.name) await session.call("PATCH", "/me", { name: choice.name.trim() });
    if (choice.locale !== was.locale) await session.call("PATCH", "/me/prefs", { locale: choice.locale });
  } catch (error) {
    if (error instanceof StaffError) return { state: "refused", error };
    if (error instanceof LostReply) return { state: "unknown" };
    throw error;
  }
  if (was.rep !== null && choice.hours !== null && (choice.hours.from !== (was.rep.hours_from ?? "") || choice.hours.to !== (was.rep.hours_to ?? ""))) {
    const saved = await session.update("reps", was.rep.id, { hours_from: choice.hours.from === "" ? null : choice.hours.from, hours_to: choice.hours.to === "" ? null : choice.hours.to });
    if (saved.state === "refused") return { state: "refused", error: saved.error };
    if (saved.state === "unknown") return { state: "unknown" };
  }
  return { state: "saved" };
}

/* ── Saved views ─────────────────────────────────────────────────────────── */

/** The screens a view can be saved from and reopened on. */
export type ViewScreen = "pipeline" | "archive" | "quotes" | "visits" | "team" | "week" | "health" | "feed" | "lost";
// This week, Stage health, the Activity feed and Why we lose take a view too (plan 68 S7). Today narrows nothing: it has none.
export const VIEW_SCREENS: readonly ViewScreen[] = ["pipeline", "archive", "quotes", "visits", "team", "week", "health", "feed", "lost"];

/**
 * A view's filters, as kept in the row. `screen` is absent from a view made
 * before screens could be named (the sample's): those are cuts of the board.
 * Each screen reads the keys it knows and leaves the rest.
 */
export interface ViewFilters {
  screen?: ViewScreen;
  /** A person: whose deals, quotes, visits. */
  rep?: string;
  /** A stage, by its number; the sample writes its name instead. */
  stage?: number | string;
  /** Deals worth more than this. */
  over?: number;
  /** Deals that have sat in their stage this many days and up. */
  sitting?: number;
  /** Deals expected to close in the month the view is opened in. */
  closing?: "this month";
  /** Closed: won or lost only. */
  only?: "won" | "lost";
  /** Site visits: which ones. */
  show?: "soon" | "done" | "unwritten";
  /** The Activity feed: what kind of line (`call` … `amount`). */
  type?: string;
  /** Why we lose: how many months back. */
  months?: number;
}

export interface SavedView extends Record<string, unknown> {
  id: number;
  /** Whose it is: hers (the table is private; a view with no owner, left from before plan 68, is read by nobody). */
  owner_id: string | null;
  made_by_id: string;
  name: string;
  filters: ViewFilters;
  pinned: boolean;
}

/** A json column comes back as text from one of the three databases, and as the value from the other two. */
export function filtersOf(value: unknown): ViewFilters {
  let held = value;
  if (typeof held === "string") {
    try {
      held = JSON.parse(held) as unknown;
    } catch {
      return {};
    }
  }
  return held !== null && typeof held === "object" && !Array.isArray(held) ? (held as ViewFilters) : {};
}

export const screenOf = (filters: ViewFilters): ViewScreen => (filters.screen !== undefined && VIEW_SCREENS.includes(filters.screen) ? filters.screen : "pipeline");

interface ViewRow extends Record<string, unknown> {
  id: number;
  owner_id: string | null;
  made_by_id: string;
  name: string;
  filters: unknown;
  pinned: unknown;
}
const viewOf = (row: ViewRow): SavedView => ({ id: row.id, owner_id: row.owner_id, made_by_id: row.made_by_id, name: row.name, filters: filtersOf(row.filters), pinned: row.pinned === true || row.pinned === 1 });

/** Her views, as the server answers her (her own: the table is private). Pinned first, then by name. */
export const readViews = (session: StaffSession): Promise<SavedView[]> =>
  session.list<ViewRow>("saved_views", { select: ["id", "owner_id", "made_by_id", "name", "filters", "pinned"], order: ["pinned.desc", "name", "id"], limit: 200 }).then((page) => page.rows.map(viewOf));
export const readView = (session: StaffSession, id: number): Promise<SavedView | null> => session.get<ViewRow>("saved_views", id).then((row) => (row === null ? null : viewOf(row)));

export interface Stage extends Record<string, unknown> {
  id: number;
  label: string;
}
/** The stage a view names: by number, or (the sample's) by its name. Null when the install has no such stage any more. */
export const stageOf = (filters: ViewFilters, stages: readonly Stage[]): Stage | null =>
  filters.stage === undefined ? null : (stages.find((stage) => (typeof filters.stage === "number" ? stage.id === filters.stage : stage.label.toLowerCase() === String(filters.stage).toLowerCase())) ?? null);

/** The rows of `deals` a board view cuts to, as conditions the server reads. A stage the install no longer has matches nothing. */
export function dealConditions(filters: ViewFilters, stages: readonly Stage[], now: Date, f: Formatters): Condition[] {
  const out: Condition[] = [];
  const today = f.dayKey(now);
  if (filters.rep !== undefined) out.push({ column: "owner_id", op: "eq", value: filters.rep });
  if (filters.stage !== undefined) out.push({ column: "stage_id", op: "eq", value: stageOf(filters, stages)?.id ?? -1 });
  if (typeof filters.over === "number") out.push({ column: "amount", op: "gt", value: filters.over });
  // "14 days and up": it entered its stage on or before the day 14 days back, so before the day after that began.
  if (typeof filters.sitting === "number") out.push({ column: "entered_stage_at", op: "lt", value: f.at(addDays(today, 1 - filters.sitting), "00:00").toISOString() });
  if (filters.closing === "this month") out.push({ column: "expected_close", op: "between", value: [`${today.slice(0, 7)}-01`, addDays(`${today.slice(0, 7)}-01`, new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate() - 1)] });
  return out;
}

export interface ViewFigure {
  count: number;
  weighted: number | null;
}

/** What a view holds for THIS reader, from the server: how many, and for a board view their weighted value. All the views of a page leave as one request. */
export async function viewFigure(session: StaffSession, view: SavedView, stages: readonly Stage[], now: Date, f: Formatters): Promise<ViewFigure | null> {
  const screen = screenOf(view.filters);
  const filters = view.filters;
  if (screen === "pipeline" || screen === "team") {
    if (!session.can("deals", "read")) return null;
    const grouped = await session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }, ...dealConditions(filters, stages, now, f)], groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "weighted" }] });
    const values = grouped.items[0]?.values;
    return { count: Number(values?.["n"] ?? 0), weighted: Number(values?.["weighted"] ?? 0) };
  }
  if (screen === "archive") {
    if (!session.can("deals", "read")) return null;
    const where: Condition[] = [{ column: "state", op: "in", value: filters.only === undefined ? ["won", "lost"] : [filters.only] }];
    if (filters.rep !== undefined) where.push({ column: "owner_id", op: "eq", value: filters.rep });
    return { count: await totalOf(session, "deals", where), weighted: null };
  }
  if (screen === "quotes") {
    if (!session.can("quotes", "read")) return null;
    // A quote is somebody's through its deal, and a count cannot be asked through a link: a view narrowed to a person carries no figure.
    return filters.rep === undefined ? { count: await totalOf(session, "quotes", []), weighted: null } : null;
  }
  // This week, Stage health, the Activity feed and Why we lose are read as they are opened: their view carries no figure.
  if (screen !== "visits") return null;
  if (!session.can("site_visits", "read")) return null;
  return { count: await totalOf(session, "site_visits", filters.rep === undefined ? [] : [{ column: "rep_id", op: "eq", value: filters.rep }]), weighted: null };
}

const totalOf = (session: StaffSession, ref: string, where: Condition[]): Promise<number> =>
  session.list(ref, { select: ["id"], ...(where.length === 0 ? {} : { where: { and: where } }), limit: 1, count: "exact" }).then((page) => page.total ?? page.rows.length);

/** Save a view: always her own. Saved views are private (plan 68 D9): a view nobody owns would be read by nobody. */
export const saveView = (session: StaffSession, name: string, filters: ViewFilters, clientKey: string): Promise<Saved<SavedView>> =>
  session.create<SavedView>("saved_views", { name: name.trim(), filters, owner_id: session.config.user?.id ?? null, pinned: false }, clientKey);

/** May this person change this view: her own, which is every view the server answers her. */
export const mayChangeView = (session: StaffSession, view: Pick<SavedView, "owner_id">): boolean => session.can("saved_views", "update") && view.owner_id === (session.config.user?.id ?? "");

/* ── Saved searches ──────────────────────────────────────────────────────── */

export interface SavedSearch extends Record<string, unknown> {
  id: number;
  owner_id: string | null;
  name: string;
  query: string;
  last_run_at: string | null;
  pinned: boolean;
}
interface SearchRow extends Record<string, unknown> {
  id: number;
  owner_id: string | null;
  name: string;
  query: string;
  last_run_at: string | null;
  pinned: unknown;
}

export const readSearches = (session: StaffSession): Promise<SavedSearch[]> =>
  session
    .list<SearchRow>("saved_searches", { select: ["id", "owner_id", "name", "query", "last_run_at", "pinned"], order: ["pinned.desc", "last_run_at.desc", "id"], limit: 200 })
    .then((page) => page.rows.map((row) => ({ id: row.id, owner_id: row.owner_id, name: row.name, query: row.query, last_run_at: row.last_run_at, pinned: row.pinned === true || row.pinned === 1 })));

export interface Hit {
  id: string;
  label: string;
  context: string | null;
}
export interface Found {
  deals: { count: number; hits: Hit[] };
  companies: { count: number; hits: Hit[] };
  people: { count: number; hits: Hit[] };
  /** The sum of the amounts of the deals found, from the server; null when there is none or she may not read deals. */
  value: number | null;
}

/**
 * What a saved search looks through, table by table: the words a person reads on the screens. Never the whole row
 * (plan 68 K2): the server's quick search (`q`) looks through EVERY text column of a table, a person's id among them, a
 * stage move's key and a save's retry key. A staff id is `usr_` and 26 letters and digits, so "bea" found every deal of
 * somebody whose id held those three letters (each deal names its owner), and a move key in hex found deals at random.
 * And a table whose columns the server had not in hand would have answered every row to `q`, where a named column that
 * is not there is refused. A person's e-mail is not looked through: it is kept from some readers, who would be refused.
 */
const LABEL: Record<"deals" | "companies" | "people", { ref: string; select: string[]; context?: string; words: readonly string[] }> = {
  deals: { ref: "deals", select: ["id", "name"], words: ["name", "scope", "close_note"] },
  companies: { ref: "companies", select: ["id", "name", "town"], context: "town", words: ["name", "town", "sector", "address_lines", "postal_code", "website"] },
  people: { ref: "contacts", select: ["id", "name", "job_title"], context: "job_title", words: ["name", "job_title"] },
};
/** The words, as one condition: any of the columns holds them, whatever the case (`%`, `_` and `\` are taken as typed). */
export const wordsIn = (columns: readonly string[], q: string): Condition => {
  const like = `%${q.replace(/[%_\\]/g, (letter) => `\\${letter}`)}%`;
  return { or: columns.map((column) => ({ column, op: "ilike" as const, value: like })) };
};

/**
 * Run a search as her: the three things a saved search counts (deals,
 * companies, people), each asked of its own table with the words typed. The
 * server looks through the columns named above for her rows only and answers
 * how many there are; the value of the deals found is a sum it works out
 * over those deals.
 *
 * Not Adminium's one search door: that door looks through twenty tables at
 * most unless it is told which, by names this side is not given (see the
 * report's engine gaps).
 */
export async function runSearch(session: StaffSession, query: string): Promise<Found> {
  const found: Found = { deals: { count: 0, hits: [] }, companies: { count: 0, hits: [] }, people: { count: 0, hits: [] }, value: null };
  const q = query.trim();
  if (q.length < 2) return found;
  await Promise.all(
    (Object.keys(LABEL) as (keyof typeof LABEL)[]).map(async (key) => {
      const table = LABEL[key];
      if (!session.can(table.ref, "read")) return;
      const page = await session.list<{ id: number; name: string } & Record<string, unknown>>(table.ref, { select: table.select, where: wordsIn(table.words, q), order: ["name", "id"], limit: 50, count: "exact" });
      found[key] = { count: page.total ?? page.rows.length, hits: page.rows.map((row) => ({ id: String(row.id), label: row.name, context: table.context === undefined ? null : ((row[table.context] as string | null) ?? null) })) };
    }),
  );
  // Every deal found is listed (fifty at most): their sum is asked of the server, and left out when there are more than were listed.
  if (found.deals.hits.length > 0 && found.deals.hits.length === found.deals.count) {
    const sum = await session.figure<{ value: number | null }>({ table: "deals", shape: "single-metric", filters: [{ column: "id", op: "in", value: found.deals.hits.map((hit) => Number(hit.id)) }], aggregations: [{ fn: "sum", column: "amount", alias: "amount" }] });
    found.value = typeof sum.value === "number" ? sum.value : null;
  }
  return found;
}

export const saveSearch = (session: StaffSession, name: string, query: string, clientKey: string): Promise<Saved<SavedSearch>> =>
  session.create<SavedSearch>("saved_searches", { name: name.trim(), query: query.trim(), owner_id: session.config.user?.id ?? null, last_run_at: session.now().toISOString(), pinned: false }, clientKey);

/* ── Her own figures (My profile) ────────────────────────────────────────── */

export interface Profile {
  /** Her open deals: how many, and their weighted value. */
  open: { count: number; weighted: number };
  queue: number;
  /** Her target for the year, when one is set. */
  target: number | null;
  /** The companies she has something open with: the server's count and sum for each, largest first. */
  companies: { id: number; name: string; count: number; amount: number }[];
}

export async function readProfile(session: StaffSession, year: number): Promise<Profile> {
  const me = session.config.user?.id ?? "";
  const mine: Condition = { column: "owner_id", op: "eq", value: me };
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const [sums, byCompany, queue, target] = await Promise.all([
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [mine, open], groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "weighted" }] }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [mine, open], groupBy: ["company_id"], groupLabel: "company_id.name", aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "amount" }], limit: 50 }),
    session.can("follow_ups", "read") ? totalOf(session, "follow_ups", [mine, { column: "kind", op: "eq", value: "step" }, { column: "done", op: "eq", value: false }]) : Promise.resolve(0),
    session.part("team") && session.can("targets", "read") ? session.list<{ amount: number | string }>("targets", { select: ["amount"], where: { and: [{ column: "rep_id", op: "eq", value: me }, { column: "year", op: "eq", value: year }] }, limit: 1 }).then((page) => (page.rows[0] === undefined ? null : Number(page.rows[0].amount))) : Promise.resolve(null),
  ]);
  const values = sums.items[0]?.values;
  const companies = byCompany.items
    .filter((item) => item.key !== null)
    .map((item) => ({ id: Number(item.key), name: item.label ?? String(item.key), count: Number(item.values?.["n"] ?? 0), amount: Number(item.values?.["amount"] ?? 0) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { open: { count: Number(values?.["n"] ?? 0), weighted: Number(values?.["weighted"] ?? 0) }, queue, target, companies };
}
