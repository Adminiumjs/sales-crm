/**
 * The states of the app's tables: which moves a row may make, what a move
 * needs, what a state locks and which buttons make the moves.
 *
 * One table of expectations, read against the manifest. It says what the
 * manifest WRITES; that a server refuses a move without what it needs and
 * makes it with it is proved on three engines, against an install, in the
 * engine's repo.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";
import { HAND_OVER_CARRIES_VISITS } from "../selling/handover.ts";

type Move = string | { to: string; requires?: { where?: { column: string; isNull?: boolean; eq?: unknown; gt?: unknown }[]; children?: Record<string, number> }; roles?: string[]; undo?: true; clears?: string[] };
interface States {
  column: string;
  initial: string;
  moves: Record<string, Move[]>;
  lock?: { when: string[]; except?: string[] };
  children?: Record<string, { via: string; lock?: boolean; createIn?: string[] }>;
  actions?: { id: string; move?: { to: string }; set?: Record<string, unknown>; in?: string[]; ask?: string[]; handOver?: boolean; label: Record<string, string> }[];
}
interface Table {
  ref: string;
  states?: States;
  columns: { ref: string; type: string; enum?: string[]; nullable?: boolean; rules?: { stamp?: { set: unknown; on: unknown; clearOnBack?: boolean } } }[];
}

const tables = (manifest as unknown as { requiredSchema: { tables: Table[] } }).requiredSchema.tables;
const table = (ref: string): Table => tables.find((one) => one.ref === ref)!;
const states = (ref: string): States => table(ref).states!;
const to = (move: Move): string => (typeof move === "string" ? move : move.to);
/** `from → to`, with what the move needs after a colon. */
const moves = (ref: string): string[] =>
  Object.entries(states(ref).moves).flatMap(([from, list]) =>
    list.map((move) => {
      if (typeof move === "string") return `${from} → ${move}`;
      const needs = [
        ...(move.requires?.where ?? []).map((one) => (one.isNull === false ? `${one.column} filled` : one.gt !== undefined ? `${one.column} over ${String(one.gt)}` : `${one.column} = ${String(one.eq)}`)),
        ...Object.entries(move.requires?.children ?? {}).map(([child, n]) => `${String(n)} ${child}`),
        ...(move.roles === undefined ? [] : [`only ${move.roles.join(", ")}`]),
        ...(move.undo === true ? ["back"] : []),
        ...(move.clears === undefined ? [] : [`empties ${move.clears.join(", ")}`]),
      ];
      return `${from} → ${move.to}${needs.length === 0 ? "" : `: ${needs.join("; ")}`}`;
    }),
  );

/** Every table with states, its column, and each move with what it needs. */
const EXPECTED: Record<string, { column: string; initial: string; moves: string[] }> = {
  deals: { column: "state", initial: "open", moves: ["open → won", "open → lost: lost_reason_id filled", "won → open: back", "lost → open: back; empties lost_reason_id"] },
  quotes: { column: "status", initial: "draft", moves: ["draft → sent: total over 0; may_send = 1; replaces_ok = 1; to_email filled; deal_state = open; 1 quote_lines", "sent → accepted", "sent → declined", "sent → withdrawn"] },
  // A cancelled visit is removed, never marked (F17): the only move left is "it was made".
  site_visits: { column: "state", initial: "booked", moves: ["booked → done"] },
  renewals: { column: "state", initial: "open", moves: ["open → done", "open → dropped"] },
  meeting_decisions: { column: "state", initial: "open", moves: ["open → done", "open → carried"] },
  enquiries: { column: "state", initial: "open", moves: ["open → claimed", "open → passed: passed_to_id filled", "open → dropped", "passed → claimed", "passed → dropped"] },
  // A cancelled showroom booking is removed, never marked (F17, P19); one somebody came in for without a confirmation is still "been in".
  showroom_bookings: { column: "state", initial: "tentative", moves: ["tentative → confirmed", "tentative → done", "confirmed → done"] },
  jobs: { column: "state", initial: "open", moves: ["open → installed", "open → signed-off: blocking_snags = 0; 1 sign_offs", "installed → signed-off: blocking_snags = 0; 1 sign_offs"] },
  // A visit to a job that is called off is removed (F17), its why sent with the removal and kept on the removed list (plan 68 S16): no "cancelled" state.
  job_visits: { column: "state", initial: "waiting", moves: ["waiting → booked: day filled; crew_id filled", "booked → done", "booked → waiting"] },
  snags: { column: "state", initial: "open", moves: ["open → waiting-part", "open → put-right: put_right_note filled", "waiting-part → open", "waiting-part → put-right: put_right_note filled"] },
  complaints: { column: "state", initial: "open", moves: ["open → answered", "answered → settled"] },
  warranty_claims: {
    column: "state",
    initial: "to-raise",
    moves: ["to-raise → with-supplier", "to-raise → turned-down", "with-supplier → parts-coming", "with-supplier → turned-down", "parts-coming → sorted", "parts-coming → turned-down", "sorted → turned-down"],
  },
  // A week is sent with a day in it at least; the operations manager or the CRM admin answers it (P25).
  time_sheets: { column: "state", initial: "open", moves: ["open → sent: 1 time_sheet_lines", "sent → signed-off: only ops-manager, admin", "sent → sent-back: sent_back_note filled; only ops-manager, admin", "sent-back → sent: 1 time_sheet_lines"] },
  insurance_incidents: { column: "state", initial: "open", moves: ["open → settled"] },
  // A message is removed by its button, which empties its words in the same write; the move waits for them to be empty (plan 68 R4d).
  messages: { column: "state", initial: "live", moves: ["live → removed: text = "] },
};

describe("the tables that have states are these, and no other", () => {
  it("fifteen of them, each on its own column", () => {
    const found = tables.filter((one) => one.states !== undefined).map((one) => one.ref).sort();
    expect(found).toEqual(Object.keys(EXPECTED).sort());
    for (const [ref, expected] of Object.entries(EXPECTED)) expect([states(ref).column, states(ref).initial], ref).toEqual([expected.column, expected.initial]);
  });

  it.each(Object.keys(EXPECTED))("%s makes exactly its moves, each with what it needs", (ref) => {
    expect(moves(ref)).toEqual(EXPECTED[ref]!.moves);
  });

  it("names only states the column holds, and reaches every one of them", () => {
    for (const ref of Object.keys(EXPECTED)) {
      const column = table(ref).columns.find((one) => one.ref === states(ref).column)!;
      const named = new Set([states(ref).initial, ...Object.keys(states(ref).moves), ...Object.values(states(ref).moves).flat().map(to)]);
      expect([...named].filter((state) => !column.enum!.includes(state)), ref).toEqual([]);
      expect(column.enum!.filter((state) => !named.has(state)), ref).toEqual([]);
    }
  });

  it("leaves no state column of the app without its moves, but the ones a row is only read in", () => {
    // `deal_marks.state` is a copy of its deal's; the outbox's `status` is Adminium's own to move.
    const bare = tables.filter((one) => one.states === undefined && one.columns.some((column) => (column.ref === "state" || column.ref === "status") && column.type === "enum")).map((one) => one.ref);
    expect(bare).toEqual(["deal_marks", "outbox"]);
  });
});

describe("a deal", () => {
  const deal = states("deals");

  it("is locked once won or lost, but for its closing note and why it was lost", () => {
    expect(deal.lock).toEqual({ when: ["won", "lost"], except: ["close_note", "lost_reason_id"] });
  });

  it("is reopened by a move back, which empties when it closed and, of a lost one, why", () => {
    const closedAt = table("deals").columns.find((one) => one.ref === "closed_at")!;
    expect(closedAt.nullable).toBe(true);
    expect(closedAt.rules?.stamp).toEqual({ set: "now", on: { column: "state", values: ["won", "lost"] }, clearOnBack: true });
    // A closed deal carries its closed moment: a file's line without one is named and not brought in (plan 68 R5, E13).
    expect((closedAt.rules as { requiredWhen?: unknown } | undefined)?.requiredWhen).toEqual({ column: "state", in: ["won", "lost"] });
    expect(table("deals").columns.find((one) => one.ref === "lost_reason_id")!.nullable).toBe(true);
  });

  it("keeps the day it closed and how many days it was open, both emptied by a reopen", () => {
    // "Average cycle" is the server's average of a stored figure: whole days from the day it opened to the day it closed.
    const closedOn = table("deals").columns.find((one) => one.ref === "closed_on")!;
    expect([closedOn.type, closedOn.nullable]).toEqual(["date", true]);
    // A person's close stamps the business's day; a deal brought in closed carries its own (plan 68 R5), never the import's.
    expect(closedOn.rules?.stamp).toEqual({ set: "today", on: { column: "state", values: ["won", "lost"] }, clearOnBack: true });
    expect((closedOn.rules as { requiredWhen?: unknown } | undefined)?.requiredWhen).toEqual({ column: "state", in: ["won", "lost"] });
    const cycle = table("deals").columns.find((one) => one.ref === "cycle_days")!;
    expect([cycle.type, cycle.nullable, (cycle.rules as { formula?: unknown } | undefined)?.formula]).toEqual(["int", true, { daysBetween: ["opened_on", "closed_on"] }]);
  });

  it("a quote that is sent withdraws the version it replaces, in the same write; that version must be of the same deal", () => {
    const quote = states("quotes") as unknown as { effects?: unknown[] };
    expect(quote.effects).toEqual([{ on: { to: "sent" }, via: "replaces_id", set: { status: "withdrawn" } }]);
    const column = (ref: string) => table("quotes").columns.find((one) => one.ref === ref)! as unknown as { type: string; rules?: Record<string, unknown> };
    // Two numbers a formula can compare: the quote's own deal, and the deal of the quote it replaces.
    expect(column("deal_no").rules).toEqual({ copy: { via: "deal_id", from: "id", mode: "always" } });
    // It follows the replaced quote, so it cannot go stale between the day a version is drafted and the day it is sent.
    expect(column("replaces_deal_id").rules).toEqual({ copy: { via: "replaces_id", from: "deal_id", mode: "always", follow: true } });
    // And a quote does not change deals: no role writes `deal_id` after the quote is made.
    for (const role of (manifest as unknown as { roles: { key: string; limits?: Record<string, { writable?: string[]; creatable?: string[] }> }[] }).roles) {
      expect(role.limits?.["quotes"]?.writable ?? [], role.key).not.toContain("deal_id");
    }
    // Once sent, who it went to is not changed: the lock keeps only what the customer's answer and a withdrawal write.
    expect((states("quotes") as unknown as { lock: { except: string[] } }).lock.except).toEqual(["valid_until", "decided_at", "withdraw_reason", "accepted_name", "yes_seen_at"]);
    expect(column("replaces_ok").rules).toEqual({ formula: { if: [{ or: [{ isNull: "replaces_id" }, { and: [{ gte: ["replaces_deal_id", "deal_no"] }, { lte: ["replaces_deal_id", "deal_no"] }] }] }, 1, 0] } });
    // Nobody types who accepted: the customer's page does, as plain text, and the server says through which door.
    // It is a person's name, personal data like the contact's own.
    expect(column("accepted_name").rules).toEqual({ plainText: { max: 120 }, personal: true });
    expect(column("accepted_via").rules).toEqual({ stamp: { set: { byOrigin: { public: "customer", staff: "staff" } }, on: { column: "status", values: ["accepted"] } } });
    for (const role of (manifest as unknown as { roles: { key: string; limits?: Record<string, { writable?: string[]; creatable?: string[] }> }[] }).roles) {
      expect(role.limits?.["quotes"]?.writable ?? [], role.key).not.toContain("accepted_name");
      expect(role.limits?.["quotes"]?.creatable ?? [], role.key).not.toContain("accepted_name");
    }
  });

  it("has four buttons: won, lost (asks why), reopen, and a hand-over that asks to whom", () => {
    expect((deal.actions ?? []).map((one) => [one.id, one.move?.to ?? null, one.ask ?? [], one.handOver === true])).toEqual([
      ["mark-won", "won", ["close_note"], false],
      ["mark-lost", "lost", ["lost_reason_id", "close_note"], false],
      ["reopen", "open", [], false],
      // It also takes the sheet's "Introduce … to the customer by email" (S1).
      ["hand-over", null, ["owner_id", "introduce"], true],
    ]);
    // A deal is handed over while it is open; a closed one is locked, owner and all.
    expect(deal.actions!.find((one) => one.id === "hand-over")).toMatchObject({ set: {}, in: ["open"] });
    // Plan 68 R1c: in the same write, the old owner's open follow-ups go to the new owner, and her visits not yet made
    // once the engine carries a row that holds a time slot (0.3.35 refuses it); the sheet says what the manifest does.
    expect((deal.actions!.find((one) => one.id === "hand-over") as { carries?: unknown }).carries).toEqual([
      ...(HAND_OVER_CARRIES_VISITS ? [{ table: "site_visits", via: "deal_id", column: "rep_id", where: [{ column: "state", eq: "booked" }] }] : []),
      { table: "follow_ups", via: "deal_id", column: "owner_id", where: [{ column: "done", eq: false }] },
    ]);
  });
});

describe("what a state locks", () => {
  it("a sent quote and its lines; a sent or signed-off time sheet and its lines; a closed deal", () => {
    const locks = Object.fromEntries(tables.filter((one) => one.states?.lock !== undefined).map((one) => [one.ref, one.states!.lock!.when]));
    expect(locks).toEqual({ deals: ["won", "lost"], quotes: ["sent", "accepted", "declined", "withdrawn"], time_sheets: ["sent", "signed-off"] });
    const children = Object.fromEntries(tables.filter((one) => one.states?.children !== undefined).map((one) => [one.ref, Object.entries(one.states!.children!).map(([child, rule]) => `${child}${rule.lock === true ? " locked" : ""}${rule.createIn === undefined ? "" : ` made in ${rule.createIn.join(", ")}`}`)]));
    // On a closed deal nobody is added or taken off.
    // A signed-off job still takes a sign-off: the correction of the one it holds (F19), never a change of it.
    expect(children).toEqual({ deals: ["deal_members locked"], quotes: ["quote_lines locked"], jobs: ["sign_offs made in open, installed, signed-off"], time_sheets: ["time_sheet_lines locked"] });
  });
});

describe("every button", () => {
  const buttons = tables.flatMap((one) => (one.states?.actions ?? []).map((action) => ({ ref: one.ref, action })));

  it("is named in eight languages", () => {
    const short = buttons.filter(({ action }) => Object.keys(action.label).length !== 8 || Object.values(action.label).some((text) => text.trim() === "")).map(({ ref, action }) => `${ref}.${action.id}`);
    expect(short).toEqual([]);
  });

  it("makes a move the table lists, or writes a column and says in which states", () => {
    const wrong: string[] = [];
    for (const { ref, action } of buttons) {
      if (action.move !== undefined) {
        const reached = Object.values(states(ref).moves).flat().map(to);
        if (!reached.includes(action.move.to)) wrong.push(`${ref}.${action.id} moves to ${action.move.to}, which no move reaches`);
      } else if (action.set === undefined || action.in === undefined) wrong.push(`${ref}.${action.id} neither moves nor says where it writes`);
      for (const asked of action.ask ?? []) if (!table(ref).columns.some((column) => column.ref === asked)) wrong.push(`${ref}.${action.id} asks for ${asked}, which is no column`);
    }
    expect(wrong).toEqual([]);
  });

  it("there are thirty-five", () => {
    // The showroom's "Cancel" went with its state (P19), and a job visit's (P20): calling off removes the row.
    // Plan 68 adds a message's "Remove" (R4d) and a quote's "Reopen it" (S2).
    expect(buttons).toHaveLength(35);
  });
});

describe("the buttons of After the job", () => {
  it("answers a complaint with what we told them, and puts a warranty claim right saying who paid", () => {
    const of = (ref: string) => (states(ref).actions ?? []).map((one) => [one.id, one.move?.to ?? null, one.ask ?? []]);
    expect(of("complaints")).toEqual([
      ["answered", "answered", ["answer"]],
      ["settle", "settled", []],
    ]);
    expect(of("warranty_claims")).toEqual([
      ["raise", "with-supplier", []],
      ["parts-coming", "parts-coming", []],
      ["sorted", "sorted", ["paid_by"]],
      ["turn-down", "turned-down", []],
    ]);
    // Whoever may move a complaint may write what was told: a role held to some columns has both or neither.
    for (const role of (manifest as unknown as { roles: { key: string; limits?: Record<string, { writable?: string[] }> }[] }).roles) {
      const writable = role.limits?.["complaints"]?.writable;
      if (writable !== undefined) expect(writable.includes("answer"), role.key).toBe(writable.includes("state"));
    }
  });
});
