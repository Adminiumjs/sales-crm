/**
 * Call notes (ledger §25): what is picked out of the notes, what is stored,
 * and how a call and its next steps are saved.
 */
import { describe, expect, it } from "vitest";

import type { Row, Saved } from "../../staffSession.ts";
import { callText, chipsOf, logCall, MARK_WORDS_EN, pickOut, QUEUE_CHIPS, withLine, wordCount } from "./call.ts";
import type { Deal } from "./data.ts";

const GERMAN = { next: "Nächster Schritt", decision: "Entscheidung", objection: "Einwand", blocker: "Hindernis" };

describe("what the notes pick out", () => {
  it("lines that start with a mark, in the reader's words or in English", () => {
    const notes = ["Petra is keen.", "Next step: send the revised layout", "decision - standing desks on the east side", "  Einwand: Lieferfenster ist zu spät ", "Blocker:", "Hindernis：Budget"].join("\n");
    expect(pickOut(notes, GERMAN)).toEqual([
      { key: "l1", mark: "next", text: "send the revised layout" },
      { key: "l2", mark: "decision", text: "standing desks on the east side" },
      { key: "l3", mark: "objection", text: "Lieferfenster ist zu spät" },
      { key: "l5", mark: "blocker", text: "Budget" },
    ]);
    expect(pickOut("Nothing marked here", MARK_WORDS_EN)).toEqual([]);
  });
  it("a chip starts a new line at the end", () => {
    expect(withLine("", "Next step: ")).toBe("Next step: ");
    expect(withLine("Petra is keen.  \n\n", "Decision: ")).toBe("Petra is keen.\nDecision: ");
  });
  it("counts words as the design does", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  one two\nthree ")).toBe(3);
  });
  it("stores an opening line and the notes, line by line", () => {
    expect(callText("Call with Petra Lindqvist.", "Keen.  \nNext step: layout\n")).toBe("Call with Petra Lindqvist.\nKeen.\nNext step: layout");
    expect(callText(null, " Keen. ")).toBe("Keen.");
  });
});

describe("the calls lined up today", () => {
  const deal = { id: 1, name: "Fourth-floor desk rows", company: "Nordwind Logistics" } as unknown as Deal & { stage: string | null };
  it("put the deal on the page first, then the others, each once, a few at most", () => {
    const queue = [2, 1, 13, 3, 6, 9].map((dealId) => ({ dealId, company: `C${String(dealId)}`, deal: `D${String(dealId)}` }));
    expect(chipsOf({ deal, queue }).map((one) => one.dealId)).toEqual([1, 2, 13, 3, 6].slice(0, QUEUE_CHIPS));
    expect(chipsOf({ deal, queue: [] })).toEqual([{ dealId: 1, company: "Nordwind Logistics", deal: "Fourth-floor desk rows" }]);
  });
});

describe("logging a call", () => {
  const due = new Date("2026-07-29T09:00:00Z");
  function fake(answers: Record<string, Saved<Row>>) {
    const made: { ref: string; values: Row; key: string }[] = [];
    return {
      made,
      create: async <R extends Row = Row>(ref: string, values: Row, key: string): Promise<Saved<R>> => {
        made.push({ ref, values, key });
        return (answers[ref] ?? { state: "saved", row: { id: made.length }, replayed: false, readBack: false }) as Saved<R>;
      },
    };
  }
  it("writes the call, then each next step as the writer's own follow-up, one by one, each with its key", async () => {
    const session = fake({});
    const done = await logCall(session, { dealId: 1, text: "Call with Petra.\nNext step: layout\nNext step: window", me: "usr_dana", due, steps: ["layout", "window"] }, { call: "K0", steps: ["K1", "K2"] });
    expect(done.call.state).toBe("saved");
    expect(done.steps.map((one) => one.state)).toEqual(["saved", "saved"]);
    expect(session.made).toEqual([
      { ref: "activities", values: { deal_id: 1, kind: "call", text: "Call with Petra.\nNext step: layout\nNext step: window" }, key: "K0" },
      { ref: "follow_ups", values: { deal_id: 1, owner_id: "usr_dana", due_at: "2026-07-29T09:00:00.000Z", text: "layout", kind: "step" }, key: "K1" },
      { ref: "follow_ups", values: { deal_id: 1, owner_id: "usr_dana", due_at: "2026-07-29T09:00:00.000Z", text: "window", kind: "step" }, key: "K2" },
    ]);
  });
  it("makes no next step when the call itself was not saved", async () => {
    const session = fake({ activities: { state: "unknown" } });
    const done = await logCall(session, { dealId: 1, text: "x", me: "usr_dana", due, steps: ["layout"] }, { call: "K0", steps: ["K1"] });
    expect(done).toEqual({ call: { state: "unknown" }, steps: [] });
    expect(session.made.map((one) => one.ref)).toEqual(["activities"]);
  });
});
