import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { changesOf, coverPhase, mentioned, mentionParts, ownHistory, sittingOf, threadsOf, timelineOf, type Comment, type HistoryRow, type TimelineData } from "./data.ts";

const none: TimelineData = { activities: [], stageChanges: [], amountLines: [], history: [] };
const row = (over: Record<string, unknown>): Record<string, unknown> => ({ id: 6, name: "Analyst pods", scope: null, contact_id: 4, owner_id: "usr_dana", stage_id: 4, expected_close: "2026-07-30", state: "open", lost_reason_id: null, close_note: null, typed_amount: 21600, amount: 21600, weighted_value: 16200, ...over });
const entry = (id: string, before: Record<string, unknown>, after: Record<string, unknown>, more: Partial<HistoryRow> = {}): HistoryRow => ({ id, createdAt: 1785227901478, actorKind: "user", actorLabel: "Dana Whitlock", action: "record.update", changes: { before: row(before), after: row(after) }, ...more });

describe("a deal's timeline", () => {
  it("puts what was logged, each change of stage and each amount line in one list, newest first", () => {
    const lines = timelineOf({
      ...none,
      activities: [{ id: 1, kind: "call", text: "Rang Petra.", author_id: "usr_dana", at: "2026-07-27T14:10:00.000Z" }],
      stageChanges: [
        { id: 2, from_stage_id: 1, to_stage_id: 2, by_id: "usr_dana", at: "2026-06-02T08:00:00.000Z" },
        { id: 1, from_stage_id: null, to_stage_id: 1, by_id: "usr_dana", at: "2026-05-12T08:00:00.000Z" },
      ],
      amountLines: [{ id: 1, quote_id: 2, amount: "52800", at: "2026-06-30T10:20:00.000Z", quote: "Q-1002" }],
    });
    expect(lines.map((line) => line.type)).toEqual(["activity", "quoted", "stage", "stage"]);
    expect(lines[1]).toMatchObject({ type: "quoted", amount: 52800, quote: "Q-1002" });
    expect(lines[3]).toMatchObject({ type: "stage", from: null, to: 1 });
  });

  it("reads where a move came from off the move before it, when the row does not say (a rule writes only where the deal went)", () => {
    const lines = timelineOf({
      ...none,
      stageChanges: [
        { id: 3, from_stage_id: null, to_stage_id: 3, by_id: "usr_ivy", at: "2026-07-28T08:40:00.000Z" },
        { id: 2, from_stage_id: null, to_stage_id: 2, by_id: "usr_dana", at: "2026-07-28T08:36:00.000Z" },
        { id: 1, from_stage_id: null, to_stage_id: 1, by_id: "usr_dana", at: "2026-07-28T08:35:00.000Z" },
      ],
    });
    expect(lines.map((line) => (line.type === "stage" ? [line.from, line.to, line.who] : null))).toEqual([
      [2, 3, "usr_ivy"],
      [1, 2, "usr_dana"],
      [null, 1, "usr_dana"],
    ]);
  });

  it("says a move once: the history's entry at once, and not again when the rule's row lands a minute later", () => {
    const made: HistoryRow = { id: "h1", createdAt: Date.parse("2026-07-28T08:35:00.000Z"), actorKind: "user", actorLabel: "Dana Whitlock", action: "record.create", changes: { before: null, after: row({ stage_id: 1 }) } };
    const moved = entry("h2", { stage_id: 1 }, { stage_id: 2 }, { createdAt: Date.parse("2026-07-28T08:40:00.000Z") });
    const back = entry("h3", { stage_id: 2 }, { stage_id: 1 }, { createdAt: Date.parse("2026-07-28T08:50:00.000Z"), actorLabel: "Ivy Sandoval" });
    const stage = (data: TimelineData) => timelineOf(data).flatMap((line) => (line.type === "stage" ? [[line.key, line.from, line.to, line.whoLabel ?? line.who, line.at]] : []));
    // Before any rule has run: three lines, from the history alone.
    const early = stage({ ...none, history: [back, moved, made] });
    expect(early).toEqual([
      ["mh3", 2, 1, "Ivy Sandoval", Date.parse("2026-07-28T08:50:00.000Z")],
      ["mh2", 1, 2, "Dana Whitlock", Date.parse("2026-07-28T08:40:00.000Z")],
      ["mh1", null, 1, "Dana Whitlock", Date.parse("2026-07-28T08:35:00.000Z")],
    ]);
    // The rule's three rows, each a minute after its move, two of them into the same stage: the same three lines, at the moment of the move.
    const late = stage({
      ...none,
      history: [back, moved, made],
      stageChanges: [
        { id: 13, from_stage_id: null, to_stage_id: 1, by_id: "usr_ivy", at: "2026-07-28T08:51:00.400Z" },
        { id: 12, from_stage_id: null, to_stage_id: 2, by_id: "usr_dana", at: "2026-07-28T08:41:00.300Z" },
        { id: 11, from_stage_id: null, to_stage_id: 1, by_id: "usr_dana", at: "2026-07-28T08:36:00.200Z" },
      ],
    });
    expect(late).toEqual(early);
  });

  it("starts a deal's story where the deal was made: nothing of an earlier row that had its number", () => {
    const old = { ...entry("o2", {}, { state: "lost", lost_reason_id: 2 }), createdAt: Date.parse("2026-07-28T08:20:00.000Z") };
    const oldMade: HistoryRow = { id: "o1", createdAt: Date.parse("2026-07-28T08:10:00.000Z"), actorKind: "user", actorLabel: "Sam Okonjo", action: "record.create", changes: { before: null, after: row({ stage_id: 3 }) } };
    const gone: HistoryRow = { id: "o3", createdAt: Date.parse("2026-07-28T08:30:00.000Z"), actorKind: "user", actorLabel: "Tessa Marlow", action: "record.delete", changes: { before: row({}), after: null } };
    const made: HistoryRow = { id: "n1", createdAt: Date.parse("2026-07-28T08:35:00.000Z"), actorKind: "user", actorLabel: "Dana Whitlock", action: "record.create", changes: { before: null, after: row({ stage_id: 1 }) } };
    const changed = entry("n2", {}, { typed_amount: 30000 }, { createdAt: Date.parse("2026-07-28T08:36:00.000Z") });
    expect(ownHistory([changed, made, gone, old, oldMade]).map((one) => one.id)).toEqual(["n2", "n1"]);
    expect(timelineOf({ ...none, history: [changed, made, gone, old, oldMade] }).map((line) => line.key)).toEqual(["hn2:typed_amount", "mn1"]);
    // A read that holds no "created" entry (a long history, cut at a hundred) is taken whole.
    expect(ownHistory([changed, old]).map((one) => one.id)).toEqual(["n2", "o2"]);
  });

  it("does not say the rule's rows as moves of their own, even when they name the wrong stage: two quick moves, and both rows hold the second", () => {
    // As the server really answered: made at Discovery, moved to Qualified two seconds on, to Proposal within the minute; each of the rule's three rows, written a minute after its move, says Proposal.
    const made: HistoryRow = { id: "h1", createdAt: Date.parse("2026-07-28T08:35:04.834Z"), actorKind: "user", actorLabel: "Dana Whitlock", action: "record.create", changes: { before: null, after: row({ stage_id: 1 }) } };
    const first = entry("h2", { stage_id: 1 }, { stage_id: 2 }, { createdAt: Date.parse("2026-07-28T08:35:06.777Z") });
    const second = entry("h3", { stage_id: 2 }, { stage_id: 3 }, { createdAt: Date.parse("2026-07-28T08:36:02.408Z"), actorLabel: "Ivy Sandoval" });
    const lines = timelineOf({
      ...none,
      history: [second, first, made],
      stageChanges: [
        { id: 69, from_stage_id: null, to_stage_id: 3, by_id: "usr_ivy", at: "2026-07-28T08:37:02.645Z" },
        { id: 68, from_stage_id: null, to_stage_id: 3, by_id: "usr_ivy", at: "2026-07-28T08:36:07.525Z" },
        { id: 67, from_stage_id: null, to_stage_id: 3, by_id: "usr_ivy", at: "2026-07-28T08:36:05.501Z" },
      ],
    });
    expect(lines.map((line) => (line.type === "stage" ? [line.from, line.to, line.whoLabel] : null))).toEqual([
      [2, 3, "Ivy Sandoval"],
      [1, 2, "Dana Whitlock"],
      [null, 1, "Dana Whitlock"],
    ]);
  });

  it("says the sample's rows, then the history's moves from the first change it holds: a sample deal moved today", () => {
    const moved = entry("h9", { stage_id: 4 }, { stage_id: 5 }, { createdAt: Date.parse("2026-07-28T08:40:00.000Z") });
    const lines = timelineOf({
      ...none,
      history: [moved],
      stageChanges: [
        { id: 70, from_stage_id: null, to_stage_id: 5, by_id: "usr_dana", at: "2026-07-28T08:41:00.500Z" },
        { id: 4, from_stage_id: 3, to_stage_id: 4, by_id: "usr_dana", at: "2026-07-14T10:20:00.000Z" },
        { id: 3, from_stage_id: 2, to_stage_id: 3, by_id: "usr_dana", at: "2026-06-23T08:00:00.000Z" },
      ],
    });
    expect(lines.map((line) => (line.type === "stage" ? [line.key, line.from, line.to] : null))).toEqual([
      ["mh9", 4, 5],
      ["s4", 3, 4],
      ["s3", 2, 3],
    ]);
  });

  it("keeps a row the history does not hold: the sample's, with who the row names", () => {
    const moved = entry("h2", { stage_id: 3 }, { stage_id: 4 }, { createdAt: Date.parse("2026-07-28T08:40:00.000Z") });
    const lines = timelineOf({
      ...none,
      history: [moved],
      stageChanges: [
        { id: 3, from_stage_id: 2, to_stage_id: 3, by_id: "usr_dana", at: "2026-06-23T08:00:00.000Z" },
        { id: 2, from_stage_id: 1, to_stage_id: 2, by_id: "usr_dana", at: "2026-06-02T08:00:00.000Z" },
      ],
    });
    expect(lines.map((line) => (line.type === "stage" ? [line.key, line.from, line.to] : null))).toEqual([
      ["mh2", 3, 4],
      ["s3", 2, 3],
      ["s2", 1, 2],
    ]);
  });

  it("says the changes of the record's own history: the server answers the whole row before and after", () => {
    expect(changesOf(entry("a", {}, { typed_amount: 21700, amount: 21700, weighted_value: 16275 }))).toEqual([{ column: "typed_amount", before: 21600, after: 21700 }]);
    expect(changesOf(entry("b", {}, { owner_id: "usr_priya" }))).toEqual([{ column: "owner_id", before: "usr_dana", after: "usr_priya" }]);
    expect(changesOf(entry("c", {}, { expected_close: "2026-07-31" }))).toEqual([{ column: "expected_close", before: "2026-07-30", after: "2026-07-31" }]);
    expect(changesOf(entry("d", {}, { state: "lost", lost_reason_id: 2, close_note: "They froze spending." }))).toEqual([{ column: "state", before: "open", after: "lost", reasonId: 2, note: "They froze spending." }]);
    expect(changesOf(entry("e", { state: "lost", lost_reason_id: 2 }, {}))).toEqual([{ column: "state", before: "lost", after: "open", reasonId: null, note: null }]);
  });

  it("leaves a change of stage to its own line, and says nothing of what the server keeps", () => {
    // The stage moved: the weighted value, the odds and "entered" follow by themselves. None of it is a line here.
    expect(changesOf(entry("f", {}, { stage_id: 5, weighted_value: 19440, stage_odds: 0.9, entered_stage_at: "2026-07-28 09:35:00" }))).toEqual([]);
    // A row made, and an entry with no rows, say nothing.
    expect(changesOf(entry("g", {}, {}, { action: "record.create" }))).toEqual([]);
    expect(changesOf({ ...entry("h", {}, {}), changes: null })).toEqual([]);
  });

  it("lists one line per column an entry changed, at the entry's moment, signed", () => {
    const lines = timelineOf({ ...none, history: [entry("x", {}, { typed_amount: 30000, expected_close: "2026-08-15" })] });
    expect(lines.map((line) => (line.type === "change" ? [line.change.column, line.whoLabel, line.at] : null))).toEqual([
      ["typed_amount", "Dana Whitlock", 1785227901478],
      ["expected_close", "Dana Whitlock", 1785227901478],
    ]);
  });
});

describe("the sample, by the ledger", () => {
  const seed = JSON.parse(readFileSync("seeds/meridian.json", "utf8")) as { tables: { ref: string; rows: Record<string, unknown>[] }[] };
  const rowsOf = (ref: string): Record<string, unknown>[] => seed.tables.find((table) => table.ref === ref)?.rows ?? [];
  const on = (ref: string, deal: string): number => rowsOf(ref).filter((one) => (one["deal_id"] as { "@ref"?: string } | undefined)?.["@ref"] === `deal:${deal}`).length;

  it("gives d1 three things logged and four changes of stage: the room's seven lines", () => {
    expect([on("activities", "d1"), on("deal_stage_changes", "d1")]).toEqual([3, 4]);
    // No amount line is in the sample: the history of amounts starts at the install.
    expect(rowsOf("deal_amount_changes")).toEqual([]);
  });

  it("gives d1 two threads, d2 and d6 one each, with three replies", () => {
    const threads = (deal: string): number => rowsOf("comments").filter((one) => (one["deal_id"] as { "@ref"?: string })["@ref"] === `deal:${deal}` && one["parent_id"] === undefined).length;
    expect([threads("d1"), threads("d2"), threads("d6")]).toEqual([2, 1, 1]);
    expect(rowsOf("comments").filter((one) => one["parent_id"] !== undefined).length).toBe(3);
  });
});

describe("sitting in a stage", () => {
  it("is warm from fourteen days and stale from thirty, by the install's two settings", () => {
    const fixed = { warmDays: 14, staleDays: 30 };
    expect([13, 14, 29, 30, 34].map((days) => sittingOf(days, fixed))).toEqual(["fresh", "warm", "warm", "stale", "stale"]);
  });
});

describe("a text that names people", () => {
  it("is cut into what was written and who was named, as Adminium stores it", () => {
    expect(mentionParts("@[Ada Novak](usr_01KYKXT09K4WAB8MR9AH7Y74F8) can the crew fit this in? @[Ivy Sandoval](usr_01KYKXT09K4WAB8MR9AH7Y74F3)")).toEqual([
      { mention: "Ada Novak", id: "usr_01KYKXT09K4WAB8MR9AH7Y74F8" },
      { text: " can the crew fit this in? " },
      { mention: "Ivy Sandoval", id: "usr_01KYKXT09K4WAB8MR9AH7Y74F3" },
    ]);
  });

  it("leaves a typed @name as the words it is: nobody is named by it", () => {
    expect(mentionParts("@Ivy the number off list is 9.1%.")).toEqual([{ text: "@Ivy the number off list is 9.1%." }]);
    expect(mentioned("@Ivy the number off list is 9.1%.")).toEqual([]);
    expect(mentionParts("")).toEqual([]);
  });

  it("names each person once", () => {
    expect(mentioned("@[Ivy Sandoval](usr_01KYKXT09K4WAB8MR9AH7Y74F3) and again @[Ivy](usr_01KYKXT09K4WAB8MR9AH7Y74F3)")).toEqual([{ id: "usr_01KYKXT09K4WAB8MR9AH7Y74F3", name: "Ivy Sandoval" }]);
  });
});

describe("comments as threads", () => {
  const comment = (id: number, parent: number | null, settled = false): Comment => ({ id, deal_id: 1, parent_id: parent, author_id: "usr_dana", text: `c${String(id)}`, settled_by_id: null, settled_at: settled ? "2026-07-24T12:15:00.000Z" : null });

  it("puts the newest thread first and each thread's replies in the order they were written", () => {
    const threads = threadsOf([comment(1, null), comment(4, 3), comment(2, 1), comment(3, null, true), comment(5, 1)]);
    expect(threads.map((thread) => [thread.first.id, thread.replies.map((reply) => reply.id)])).toEqual([
      [3, [4]],
      [1, [2, 5]],
    ]);
  });
});

describe("a cover", () => {
  it("is coming up before its first day, running through its last, and over after; with no last day it runs until it is ended", () => {
    const cover = { starts_on: "2026-08-10", ends_on: "2026-08-21" };
    expect(["2026-07-28", "2026-08-10", "2026-08-21", "2026-08-22"].map((day) => coverPhase(cover, day))).toEqual(["coming", "running", "running", "over"]);
    expect(coverPhase({ starts_on: "2026-08-10", ends_on: null }, "2027-01-01")).toBe("running");
  });
});
