/**
 * THE MARKETER'S HOME, PAST THE ENQUIRIES: the campaigns, the website's
 * forms, the landing pages' funnels and the website chat, each with this
 * month's figures. Read only: nothing here makes or changes a page, a funnel,
 * a form or a campaign (an admin builds those in their own add-ons).
 *
 * WHERE EACH GROUP COMES FROM
 *  - Campaigns: Adminium's own list of e-mail campaigns (`/email-templates`),
 *    open to everybody who signs in, each with its latest send as Adminium
 *    sums it up: its state, when, how many of how many went, how many failed.
 *  - Forms: the Forms add-on's forms and its answers, through the reads the
 *    marketer's role is given on them (`forms:forms`, `forms:answers`).
 *  - Funnels: the Pages add-on's funnels and pages (`pages:funnels`,
 *    `pages:pages`), and how many times strangers saw each step this month
 *    from Adminium's counts (`/views`).
 *  - Chats: the Live chat add-on's conversations (`live-chat:conversations`).
 *
 * A GROUP IS THERE OR IT IS NOT. An add-on that is not attached to the app,
 * or whose tables the reader may not read, has no group at all: never an
 * empty one. The server still decides every read, and a group it refuses is
 * left out the same way.
 *
 * WHO COUNTS. The server, always: a figure is the total it answers for a list,
 * a count it groups, or the views it kept. A month is the business's month.
 */
import type { Formatters } from "../../lib/format.ts";
import { StaffError, type Condition, type Grouped, type StaffSession } from "../../staffSession.ts";
import { CHAT_ADD_ON, ENQUIRIES_REF } from "./data.ts";

/** The Forms add-on: its forms and the answers strangers send them. */
export const FORMS_ADD_ON = "forms";
/** The Pages add-on (landing pages): its pages and the funnels that put them in order. */
export const PAGES_ADD_ON = "pages";

type Reader = Pick<StaffSession, "config" | "can">;
const attached = (session: Reader, key: string): boolean => session.config.addOns[key] !== undefined;

/** Which of the add-on groups this reader gets: the add-on attached, and every table the group reads readable. */
export interface MarketingReach {
  forms: boolean;
  funnels: boolean;
  chats: boolean;
}
export const marketingReach = (session: Reader): MarketingReach => ({
  forms: attached(session, FORMS_ADD_ON) && session.can(`${FORMS_ADD_ON}:forms`, "read") && session.can(`${FORMS_ADD_ON}:answers`, "read"),
  funnels: attached(session, PAGES_ADD_ON) && session.can(`${PAGES_ADD_ON}:pages`, "read") && session.can(`${PAGES_ADD_ON}:funnels`, "read"),
  chats: attached(session, CHAT_ADD_ON) && session.can(`${CHAT_ADD_ON}:conversations`, "read"),
});

/** A month where the business is, as the moments a stamped row is read between. */
export function monthWithin(column: string, month: [string, string], f: Pick<Formatters, "at">): Condition {
  return { column, op: "between", value: [f.at(month[0], "00:00").toISOString(), new Date(f.at(month[1], "23:59").getTime() + 59_999).toISOString()] };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : 0);
const keyText = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null);
const moment = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A read the server refused (not this reader's, or not there): the group is left out. Anything else is a failure the screen shows. */
const refused = (error: unknown): boolean => error instanceof StaffError && (error.status === 401 || error.status === 403 || error.status === 404);
async function orAbsent<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (refused(error)) return null;
    throw error;
  }
}

/* ── Campaigns ───────────────────────────────────────────────────────────── */

export type CampaignStatus = "draft" | "scheduled" | "running" | "sent" | "failed" | "cancelled";
const RUN_STATUSES: readonly CampaignStatus[] = ["scheduled", "running", "sent", "failed", "cancelled"];

export interface CampaignLine {
  key: string;
  name: string;
  /** Its latest send's state; `draft` when it was never sent. */
  status: CampaignStatus;
  /** When the latest send finished, started or is set to go (epoch ms); null for a draft. */
  at: number | null;
  sent: number;
  total: number;
  failed: number;
}
export interface CampaignsGroup {
  lines: CampaignLine[];
  /** Campaigns whose latest send went out this month, and the mails those sends delivered. */
  sentInMonth: number;
  mailsInMonth: number;
}

/**
 * The campaign list as Adminium answers it, one line a campaign: a campaign
 * in several languages is one row a language under one key, so the line
 * takes the newest send among them. Archived ones are not asked for.
 * `from` and `to` are the month's first and last moment.
 */
export function campaignsOf(answer: unknown, from: number, to: number): CampaignsGroup {
  const items = isRecord(answer) && Array.isArray(answer["items"]) ? answer["items"] : [];
  const byKey = new Map<string, CampaignLine>();
  for (const item of items) {
    if (!isRecord(item) || item["kind"] !== "campaign") continue;
    const key = keyText(item["key"]) ?? keyText(item["id"]);
    if (key === null) continue;
    const name = typeof item["topicLabel"] === "string" && item["topicLabel"] !== "" ? item["topicLabel"] : typeof item["name"] === "string" ? item["name"] : key;
    const run = isRecord(item["run"]) ? item["run"] : null;
    const status = run !== null && RUN_STATUSES.includes(run["status"] as CampaignStatus) ? (run["status"] as CampaignStatus) : "draft";
    const at = run === null ? null : (moment(run["finishedAt"]) ?? moment(run["startedAt"]) ?? moment(run["scheduledAt"]));
    const line: CampaignLine = { key, name, status, at, sent: run === null ? 0 : num(run["sent"]), total: run === null ? 0 : num(run["total"]), failed: run === null ? 0 : num(run["failed"]) };
    const had = byKey.get(key);
    // The newest send of the campaign's languages speaks for it; one never sent gives way to one that was.
    if (had === undefined || (line.at ?? -1) > (had.at ?? -1)) byKey.set(key, had === undefined ? line : { ...line, name: had.name });
  }
  const lines = [...byKey.values()].sort((a, b) => (b.at ?? -1) - (a.at ?? -1) || a.name.localeCompare(b.name));
  const went = lines.filter((line) => line.status === "sent" && line.at !== null && line.at >= from && line.at <= to);
  return { lines, sentInMonth: went.length, mailsInMonth: went.reduce((sum, line) => sum + line.sent, 0) };
}

const readCampaigns = (session: StaffSession, from: number, to: number): Promise<CampaignsGroup | null> =>
  orAbsent(async () => campaignsOf(await session.call("GET", "/email-templates?kind=campaign"), from, to));

/* ── Forms ───────────────────────────────────────────────────────────────── */

export interface FormLine {
  id: string;
  name: string;
  kind: "form" | "survey" | null;
  state: "draft" | "live" | "closed" | null;
  answers: number;
}
export interface FormsGroup {
  lines: FormLine[];
  answers: number;
}

type FormRow = { id: string | number; name: string | null; kind: string | null; state: string | null };

/** Each form with its answers this month: those that had any, and those live now; the most answered first. */
export function formLinesOf(forms: readonly FormRow[], grouped: Pick<Grouped, "items">): FormLine[] {
  const answers = new Map(grouped.items.map((item) => [String(item.key), num(item.values?.["n"] ?? item.value)]));
  return forms
    .map(
      (row): FormLine => ({
        id: String(row.id),
        name: row.name ?? "",
        kind: row.kind === "form" || row.kind === "survey" ? row.kind : null,
        state: row.state === "draft" || row.state === "live" || row.state === "closed" ? row.state : null,
        answers: answers.get(String(row.id)) ?? 0,
      }),
    )
    .filter((line) => line.answers > 0 || line.state === "live")
    .sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name));
}

async function readForms(session: StaffSession, within: Condition): Promise<FormsGroup | null> {
  return orAbsent(async () => {
    const [forms, grouped] = await Promise.all([
      session.list<FormRow>(`${FORMS_ADD_ON}:forms`, { select: ["id", "name", "kind", "state"], order: ["name", "id"], limit: 200 }),
      session.figure<Grouped>({ table: `${FORMS_ADD_ON}:answers`, shape: "categorical", filters: [within], groupBy: ["form_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 200 }),
    ]);
    const lines = formLinesOf(forms.rows, grouped);
    return { lines, answers: grouped.items.reduce((sum, item) => sum + num(item.values?.["n"] ?? item.value), 0) };
  });
}

/* ── Funnels ─────────────────────────────────────────────────────────────── */

/** A funnel's step as the Pages add-on keeps it: a page of its own, or a form of a forms add-on, each by its row key. */
export type FunnelStep = { kind: "page"; key: string } | { kind: "form"; key: string; addOn: string };
/** The most steps a funnel has. */
export const FUNNEL_STEPS_MAX = 8;

/** A funnel's steps, read leniently: json as the database hands it back (parsed, or as text), anything else dropped. */
export function stepsOf(value: unknown): FunnelStep[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: FunnelStep[] = [];
  for (const step of parsed.slice(0, FUNNEL_STEPS_MAX)) {
    if (!isRecord(step)) continue;
    const key = keyText(step["key"]);
    if (key === null) continue;
    if (step["kind"] === "page") out.push({ kind: "page", key });
    else if (step["kind"] === "form") out.push({ kind: "form", key, addOn: typeof step["addOn"] === "string" && step["addOn"] !== "" ? step["addOn"] : FORMS_ADD_ON });
  }
  return out;
}

export type ViewKind = "page" | "form-page" | "form-opened" | "form-sent";
export type CardKind = "page" | "form-opened" | "form-sent";

/** One card of a funnel: what it counts, where, and (once read) how many. */
export interface FunnelCard {
  kind: CardKind;
  /** The page's or the form's name; null when it is gone or not one the reader may read. */
  title: string | null;
  /** What to ask the counts for; null when the card counts nothing. */
  ask: { addOn: string; kind: ViewKind; thing: string; place?: string } | null;
  count: number | null;
}

/**
 * A funnel's cards: a page step is one card, its page's views; a form step is
 * two, the form coming into view and the form sent. Where the step before is a
 * page, both are counted on that page (Adminium keeps a form's counts by the
 * page it was on); where it is not, "opened" is the form's own page opened.
 */
export function cardsOf(steps: readonly FunnelStep[], pages: ReadonlyMap<string, string>, forms: ReadonlyMap<string, string>): FunnelCard[] {
  const out: FunnelCard[] = [];
  steps.forEach((step, i) => {
    if (step.kind === "page") {
      const name = pages.get(step.key);
      out.push({ kind: "page", title: name ?? null, ask: name === undefined ? null : { addOn: PAGES_ADD_ON, kind: "page", thing: step.key }, count: null });
      return;
    }
    const name = forms.get(`${step.addOn}:${step.key}`);
    const before = steps[i - 1];
    const place = before?.kind === "page" && pages.has(before.key) ? { place: before.key } : {};
    const known = name !== undefined;
    out.push({ kind: "form-opened", title: name ?? null, ask: known ? { addOn: step.addOn, kind: "place" in place ? "form-opened" : "form-page", thing: step.key, ...place } : null, count: null });
    out.push({ kind: "form-sent", title: name ?? null, ask: known ? { addOn: step.addOn, kind: "form-sent", thing: step.key, ...place } : null, count: null });
  });
  return out;
}

/** "This card ÷ the one before" as a share (0.4 for 40 %); null when either counts nothing or the one before is 0. */
export function shareOf(count: number | null, before: number | null): number | null {
  if (count === null || before === null || before <= 0) return null;
  return count / before;
}

export type CountingLevel = "off" | "counts" | "visitor";
export interface ViewCounts {
  level: CountingLevel | null;
  countingSince: number | null;
  /** Each thing's views over the days read, every place added up. */
  totals: Map<string, number>;
}

/** Adminium's answer to a views read, leniently: a field that is missing or of another kind is "not known". */
export function viewCountsOf(answer: unknown): ViewCounts {
  const data = isRecord(answer) && isRecord(answer["data"]) ? answer["data"] : {};
  const level = data["level"] === "off" || data["level"] === "counts" || data["level"] === "visitor" ? data["level"] : null;
  const totals = new Map<string, number>();
  for (const one of Array.isArray(data["things"]) ? data["things"] : []) {
    if (!isRecord(one) || typeof one["thing"] !== "string") continue;
    const days = Array.isArray(one["days"]) ? one["days"] : [];
    totals.set(one["thing"], days.reduce((sum: number, day: unknown) => sum + (isRecord(day) ? num(day["views"]) : 0), 0));
  }
  return { level, countingSince: moment(data["countingSince"]), totals };
}

/**
 * Where an add-on's counts are kept: the install of it this app's database
 * uses (its own copy, else the one kept once per server), as Adminium lists
 * the add-ons the reader may know of. Null when it lists none.
 */
export function installIdOf(answer: unknown, key: string, connectionId: string): string | null {
  const list = isRecord(answer) && Array.isArray(answer["addOns"]) ? answer["addOns"] : [];
  const copies = list.filter((one): one is Record<string, unknown> => isRecord(one) && one["key"] === key && keyText(one["installId"]) !== null);
  const own = copies.find((one) => one["connectionId"] === connectionId) ?? copies.find((one) => one["connectionId"] === null || one["connectionId"] === undefined);
  return own === undefined ? null : keyText(own["installId"]);
}

/** The most things one views read names (the route's own cap). */
const VIEWS_THINGS_MAX = 50;

export interface FunnelLine {
  id: string;
  name: string;
  cards: FunnelCard[];
}
export interface FunnelsGroup {
  lines: FunnelLine[];
  /** Every live page's views this month; null when they could not be read. */
  pageViews: number | null;
  livePages: number;
  level: CountingLevel | null;
  /** When counting began (epoch ms), as Adminium keeps it. */
  countingSince: number | null;
}

type PageRow = { id: string | number; name: string | null; state: string | null };
type FunnelRow = { id: string | number; name: string | null; steps: unknown };

async function readFunnels(session: StaffSession, month: [string, string], formsReadable: boolean): Promise<FunnelsGroup | null> {
  return orAbsent(async () => {
    const [funnels, pages, forms, addOns] = await Promise.all([
      session.list<FunnelRow>(`${PAGES_ADD_ON}:funnels`, { select: ["id", "name", "steps"], order: ["name", "id"], limit: 50 }),
      session.list<PageRow>(`${PAGES_ADD_ON}:pages`, { select: ["id", "name", "state"], order: ["id"], limit: 200 }),
      // A form step names a form of the Forms add-on: its name only where the reader may read the forms.
      formsReadable ? session.list<FormRow>(`${FORMS_ADD_ON}:forms`, { select: ["id", "name"], limit: 200 }).then((page) => page.rows) : Promise.resolve([] as FormRow[]),
      session.call("GET", "/add-ons"),
    ]);
    const pageNames = new Map(pages.rows.map((row) => [String(row.id), row.name ?? ""]));
    const formNames = new Map(forms.map((row) => [`${FORMS_ADD_ON}:${String(row.id)}`, row.name ?? ""]));
    const lines: FunnelLine[] = funnels.rows.map((row) => ({ id: String(row.id), name: row.name ?? "", cards: cardsOf(stepsOf(row.steps), pageNames, formNames) }));
    const live = pages.rows.filter((row) => row.state === "live").map((row) => String(row.id));

    const range = { from: month[0], to: month[1] };
    const views = async (addOn: string, kind: ViewKind, things: string[], place?: string): Promise<ViewCounts | null> => {
      const installId = installIdOf(addOns, addOn, session.connectionId);
      if (installId === null || things.length === 0) return null;
      const query = new URLSearchParams({ installId, kind, things: things.slice(0, VIEWS_THINGS_MAX).join(","), ...range, ...(place === undefined ? {} : { place }) });
      return orAbsent(async () => viewCountsOf(await session.call("GET", `/views?${query.toString()}`)));
    };
    // Every page a funnel names and every live page, in one read; each form card in a read of its own (eight steps at most).
    const pageThings = [...new Set([...lines.flatMap((line) => line.cards.flatMap((card) => (card.ask?.kind === "page" ? [card.ask.thing] : []))), ...live])];
    const pageCounts = await views(PAGES_ADD_ON, "page", pageThings);
    const reads: ViewCounts[] = pageCounts === null ? [] : [pageCounts];
    for (const line of lines) {
      for (const card of line.cards) {
        const ask = card.ask;
        if (ask === null) continue;
        if (ask.kind === "page") {
          card.count = pageCounts === null ? null : (pageCounts.totals.get(ask.thing) ?? 0);
          continue;
        }
        const read = await views(ask.addOn, ask.kind, [ask.thing], ask.place);
        if (read !== null) reads.push(read);
        card.count = read === null ? null : (read.totals.get(ask.thing) ?? 0);
      }
    }
    const said = reads.find((read) => read.level !== null) ?? null;
    return {
      lines,
      pageViews: pageCounts === null ? null : live.reduce((sum, key) => sum + (pageCounts.totals.get(key) ?? 0), 0),
      livePages: live.length,
      level: said?.level ?? null,
      countingSince: said?.countingSince ?? null,
    };
  });
}

/** Whether to say when counting began: it began after the month's first day, so the month's figures are short. */
export function countingStartedIn(countingSince: number | null, month: [string, string], f: Pick<Formatters, "dayKey">): boolean {
  if (countingSince === null) return false;
  const day = f.dayKey(new Date(countingSince));
  return day > month[0] && day <= month[1];
}

/* ── Chats ───────────────────────────────────────────────────────────────── */

export interface ChatQuestion {
  id: string;
  startedAt: string;
  /** The enquiry it became, as the reader reads it; null when it became none (or one she cannot read). */
  enquiry: { id: number; person: string | null; company_name: string } | null;
}
export interface ChatsGroup {
  conversations: number;
  outsideHours: number;
  /** This month's questions left outside hours, the newest first. */
  questions: ChatQuestion[];
}

/** The most outside-hours questions the home lists. */
export const CHAT_QUESTIONS_SHOWN = 20;

type ConversationRow = { id: string | number; started_at: string; became_table: string | null; became_key: string | null };

async function readChats(session: StaffSession, within: Condition): Promise<ChatsGroup | null> {
  return orAbsent(async () => {
    const ref = `${CHAT_ADD_ON}:conversations`;
    const outside: Condition = { and: [within, { column: "outside_hours", op: "eq", value: true }] };
    const [all, left] = await Promise.all([
      session.list(ref, { select: ["id"], where: within, limit: 1, count: "exact" }),
      session.list<ConversationRow>(ref, { select: ["id", "started_at", "became_table", "became_key"], where: outside, order: ["started_at.desc", "id.desc"], limit: CHAT_QUESTIONS_SHOWN, count: "exact" }),
    ]);
    const enquiryIds = left.rows.flatMap((row) => (row.became_table === ENQUIRIES_REF && row.became_key !== null && /^\d+$/.test(row.became_key) ? [Number(row.became_key)] : []));
    const enquiries =
      enquiryIds.length === 0
        ? []
        : await session
            .list<{ id: number; person: string | null; company_name: string }>("enquiries", { select: ["id", "person", "company_name"], where: { column: "id", op: "in", value: enquiryIds }, limit: enquiryIds.length })
            .then((page) => page.rows)
            .catch((error: unknown) => (refused(error) ? [] : Promise.reject(error)));
    const byId = new Map(enquiries.map((row) => [String(row.id), row]));
    return {
      conversations: all.total ?? all.rows.length,
      outsideHours: left.total ?? left.rows.length,
      questions: left.rows.map((row) => ({ id: String(row.id), startedAt: row.started_at, enquiry: row.became_table === ENQUIRIES_REF && row.became_key !== null ? (byId.get(row.became_key) ?? null) : null })),
    };
  });
}

/* ── All four ────────────────────────────────────────────────────────────── */

export interface Marketing {
  campaigns: CampaignsGroup | null;
  forms: FormsGroup | null;
  funnels: FunnelsGroup | null;
  chats: ChatsGroup | null;
}

/** The four groups for this month: each one this reader gets, the rest null (left out, never drawn empty). */
export async function readMarketing(session: StaffSession, month: [string, string], f: Pick<Formatters, "at">): Promise<Marketing> {
  const reach = marketingReach(session);
  const from = f.at(month[0], "00:00").getTime();
  const to = f.at(month[1], "23:59").getTime() + 59_999;
  const [campaigns, forms, funnels, chats] = await Promise.all([
    readCampaigns(session, from, to),
    reach.forms ? readForms(session, monthWithin("submitted_at", month, f)) : Promise.resolve(null),
    reach.funnels ? readFunnels(session, month, reach.forms) : Promise.resolve(null),
    reach.chats ? readChats(session, monthWithin("started_at", month, f)) : Promise.resolve(null),
  ]);
  return { campaigns, forms, funnels, chats };
}
