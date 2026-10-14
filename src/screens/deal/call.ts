/**
 * CALL NOTES, as the screen reads and writes them (ledger §25).
 *
 * A call is one row of `activities` (kind `call`), written as the person, on
 * the deal; the server stamps who wrote it and when. Every line of the notes
 * that starts "Next step:" also becomes a follow-up, the writer's own, due
 * tomorrow at 10:00 where the business is. Decisions, objections and blockers
 * are picked out on the screen only: no column holds them apart, so they are
 * kept as the words of the call.
 *
 * Each save carries its own client key, made once per draft: sent again after
 * a lost reply it answers the row the first one made.
 */
import type { Saved, StaffSession } from "../../staffSession.ts";
import { DEAL_LOOKUPS, type Activity, type Contact, type Deal } from "./data.ts";

/** The four marks a line can start with, in the design's order. */
export const MARKS = ["next", "decision", "objection", "blocker"] as const;
export type Mark = (typeof MARKS)[number];
export const MARK_ICON: Record<Mark, string> = { next: "corner-down-right", decision: "gavel", objection: "hand", blocker: "octagon-alert" };

/** The English word of each mark: a line started in English is picked out whatever the reader's language. */
export const MARK_WORDS_EN: Record<Mark, string> = { next: "Next step", decision: "Decision", objection: "Objection", blocker: "Blocker" };

export interface Picked {
  key: string;
  mark: Mark;
  text: string;
}

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The lines of the notes that start with a mark ("Next step: …", or the reader's own words for it). */
export function pickOut(notes: string, words: Record<Mark, string>): Picked[] {
  const out: Picked[] = [];
  notes.split("\n").forEach((line, index) => {
    const raw = line.trim();
    if (raw === "") return;
    for (const mark of MARKS) {
      const said = [words[mark], MARK_WORDS_EN[mark]].map(escape).join("|");
      const found = new RegExp(`^(?:${said})\\s*[:：\\-]\\s*(.+)$`, "iu").exec(raw);
      if (found !== null) {
        out.push({ key: `l${String(index)}`, mark, text: found[1]!.trim() });
        return;
      }
    }
  });
  return out;
}

/** The notes with a mark put on a new line at their end, as the chips and the prompts do. */
export const withLine = (notes: string, start: string): string => `${notes.replace(/\s*$/, "")}${notes.trim() === "" ? "" : "\n"}${start}`;

/** Words, as the design counts them: what whitespace separates. */
export const wordCount = (notes: string): number => (notes.trim() === "" ? 0 : notes.trim().split(/\s+/u).length);

/** The most a call's text holds (the column's limit), less room for the opening line. */
export const MAX_NOTES = 3800;

/** What is stored for the call: an opening line naming who it was with, then the notes, each line kept. */
export function callText(opening: string | null, notes: string): string {
  const body = notes
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return opening === null ? body : `${opening}\n${body}`;
}

export interface CallDeal extends Deal {
  stage: string | null;
}

/** One of the person's deals with a call lined up today or overdue: the chips at the top. */
export interface Queued {
  dealId: number;
  company: string | null;
  deal: string | null;
}

export interface CallData {
  deal: CallDeal;
  /** The last three things logged on the deal, newest first; null when the reader reads none. */
  last: Activity[] | null;
  /** The customer's people at the deal's company; empty when the reader reads none. */
  people: Contact[];
  queue: Queued[];
}

/**
 * The deal and what the screen shows beside the notes. Null when the server
 * answers no such deal for this reader (not there, or not theirs).
 */
export async function readCall(session: StaffSession, id: number, endOfToday: string): Promise<CallData | null> {
  const deal = await session.get<CallDeal>("deals", id, { lookup: [...DEAL_LOOKUPS, "stage:stage_id.label"] });
  if (deal === null) return null;
  const me = session.config.user?.id ?? null;
  const [last, people, queue] = await Promise.all([
    session.can("activities", "read") ? session.list<Activity>("activities", { select: ["id", "kind", "text", "author_id", "at"], where: { column: "deal_id", op: "eq", value: id }, order: ["at.desc", "id.desc"], limit: 3 }).then((page) => page.rows) : Promise.resolve(null),
    session.part("accounts") && session.can("contacts", "read")
      ? // No column list: a column the reader's role sees masked is answered empty, where naming it would refuse the whole read.
        session.list<Contact>("contacts", { where: { column: "company_id", op: "eq", value: deal.company_id }, order: ["name"], limit: 50 }).then((page) => page.rows)
      : Promise.resolve([] as Contact[]),
    me !== null && session.can("follow_ups", "read")
      ? session
          .list<{ deal_id: number | null; deal: string | null; company: string | null; deal_state: string | null }>("follow_ups", {
              select: ["deal_id"],
              lookup: ["deal:deal_id.name", "company:deal_id.company_id.name", "deal_state:deal_id.state"],
              where: { and: [{ column: "owner_id", op: "eq", value: me }, { column: "done", op: "eq", value: false }, { column: "due_at", op: "lt", value: endOfToday }, { column: "deal_id", op: "not_null" }] },
              order: ["due_at"],
              limit: 50,
            })
          .then((page) => {
            const out: Queued[] = [];
            for (const row of page.rows) if (row.deal_id !== null && row.deal_state === "open" && !out.some((one) => one.dealId === row.deal_id)) out.push({ dealId: row.deal_id, company: row.company, deal: row.deal });
            return out;
          })
          .catch(() => [] as Queued[])
      : Promise.resolve([] as Queued[]),
  ]);
  return { deal, last, people, queue };
}

/** The most chips at the top: the deal on the page and the others lined up today. */
export const QUEUE_CHIPS = 5;

/** The chips: the deal on the page first, then the others lined up today, in the order they are due. */
export function chipsOf(data: Pick<CallData, "deal" | "queue">): Queued[] {
  const here: Queued = { dealId: data.deal.id, company: data.deal.company, deal: data.deal.name };
  return [here, ...data.queue.filter((one) => one.dealId !== data.deal.id)].slice(0, QUEUE_CHIPS);
}

export interface Logged {
  call: Saved<Activity>;
  /** Each next step's save, in the order the lines were written; empty when the call was not saved. */
  steps: Saved[];
}

/**
 * Write the call, then each next step as its own follow-up, one by one.
 * `keys` holds a key for the call and one per step, made for this draft: a
 * second press after a lost reply sends the same keys, so nothing is made
 * twice.
 */
export async function logCall(session: Pick<StaffSession, "create">, call: { dealId: number; text: string; me: string; due: Date; steps: string[] }, keys: { call: string; steps: string[] }): Promise<Logged> {
  const saved = await session.create<Activity>("activities", { deal_id: call.dealId, kind: "call", text: call.text }, keys.call);
  if (saved.state !== "saved") return { call: saved, steps: [] };
  const steps: Saved[] = [];
  for (const [index, text] of call.steps.entries()) {
    steps.push(await session.create("follow_ups", { deal_id: call.dealId, owner_id: call.me, due_at: call.due.toISOString(), text: text.slice(0, 400), kind: "step" }, keys.steps[index]!));
  }
  return { call: saved, steps };
}
