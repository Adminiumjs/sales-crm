/**
 * The team's screens: the pieces that decide something without the server.
 * Where a cover stands on a day, the working days it spans, how a lost reply
 * on a new cover ends, what "covered" and "even pace" are worked out from,
 * and where else a row of the one action list lives.
 */
import { describe, expect, it } from "vitest";

import { LostReply, StaffError, type StaffSession } from "../../staffSession.ts";
import { coverState, dayOf, makeCover, workingDays } from "./cover.ts";
import { areaRow } from "./coaching.ts";
import { all, alsoIn, childLink, num, sessionLinked, truthy } from "./data.ts";
import { raisedOf, sessionRow, TOPICS } from "./notes.ts";
import { coverOf, leftOf, yearDay } from "./targets.ts";

describe("a cover on a day", () => {
  const cover = { starts_on: "2026-08-10", ends_on: "2026-08-21" };
  it("is coming up until its first day, running through its last, and over the day after", () => {
    expect(coverState(cover, "2026-07-28")).toBe("coming");
    expect(coverState(cover, "2026-08-09")).toBe("coming");
    expect(coverState(cover, "2026-08-10")).toBe("running");
    expect(coverState(cover, "2026-08-21")).toBe("running");
    expect(coverState(cover, "2026-08-22")).toBe("over");
  });
  it("runs with no end until it is ended", () => {
    expect(coverState({ starts_on: "2026-08-10", ends_on: null }, "2031-01-01")).toBe("running");
  });
  it("ended today, still runs today", () => {
    expect(coverState({ starts_on: "2026-07-20", ends_on: "2026-07-28" }, "2026-07-28")).toBe("running");
    expect(coverState({ starts_on: "2026-07-20", ends_on: "2026-07-28" }, "2026-07-29")).toBe("over");
  });
  it("reads a day whatever shape the engine answers it in", () => {
    expect(dayOf("2026-08-10")).toBe("2026-08-10");
    expect(dayOf("2026-08-10T00:00:00.000Z")).toBe("2026-08-10");
    expect(dayOf(null)).toBeNull();
    expect(coverState({ starts_on: "2026-08-10T00:00:00.000Z", ends_on: null }, "2026-08-10")).toBe("running");
  });
  it("counts the ledger's ten working days, Mon 10 to Fri 21 Aug", () => {
    expect(workingDays("2026-08-10", "2026-08-21")).toBe(10);
    expect(workingDays("2026-08-15", "2026-08-16")).toBe(0);
    expect(workingDays("2026-08-14", "2026-08-17")).toBe(2);
  });
});

describe("making a cover when the reply is lost", () => {
  const values = { owner_id: "dana", cover_id: "priya", starts_on: "2026-09-01", ends_on: "2026-09-04" };
  const made = { id: 7, ...values };
  function fake(posts: (() => unknown)[], found: (() => unknown[])[]): { session: StaffSession; sent: unknown[] } {
    const sent: unknown[] = [];
    const session = {
      connectionId: "c",
      tableId: () => "crm_covers",
      call: (_method: string, _path: string, body: unknown) => {
        sent.push(body);
        const next = posts.shift()!;
        return Promise.resolve().then(next);
      },
      list: () => Promise.resolve().then(() => ({ rows: found.shift()!(), total: null, next: null })),
    } as unknown as StaffSession;
    return { session, sent };
  }
  const none = (): Promise<void> => Promise.resolve();

  it("sends no client key: the server takes none on a table of spans", async () => {
    const { session, sent } = fake([() => ({ data: made })], []);
    expect(await makeCover(session, values, none)).toMatchObject({ state: "saved", readBack: false, row: { id: 7 } });
    expect(sent).toEqual([{ values }]);
  });
  it("reads the cover back after a lost reply and sends nothing twice", async () => {
    const { session, sent } = fake([() => { throw new LostReply(); }], [() => [made]]);
    expect(await makeCover(session, values, none)).toMatchObject({ state: "saved", readBack: true, row: { id: 7 } });
    expect(sent.length).toBe(1);
  });
  it("sends again when nothing was written, and takes the second answer", async () => {
    const { session, sent } = fake([() => { throw new LostReply(); }, () => ({ data: made })], [() => []]);
    expect(await makeCover(session, values, none)).toMatchObject({ state: "saved", readBack: false });
    expect(sent.length).toBe(2);
  });
  it("a second send refused as overlapping its own first is said once, as made", async () => {
    const { session } = fake([() => { throw new LostReply(); }, () => { throw new StaffError(409, "BOOKING_TAKEN", "Those days overlap another entry."); }], [() => [], () => [made]]);
    expect(await makeCover(session, values, none)).toMatchObject({ state: "saved", replayed: true, readBack: true });
  });
  it("a first send refused as overlapping is a refusal", async () => {
    const { session } = fake([() => { throw new StaffError(409, "BOOKING_TAKEN", "Those days overlap another entry."); }], []);
    expect(await makeCover(session, values, none)).toMatchObject({ state: "refused" });
  });
  it("says it does not know when nothing can be read back either", async () => {
    const lost = (): never => { throw new LostReply(); };
    const { session } = fake([lost, lost, lost], [lost, lost]);
    expect(await makeCover(session, values, none)).toEqual({ state: "unknown" });
  });
});

describe("a target", () => {
  it("is covered by the server's one figure over it (the ledger's Dana: 124,140 of 140,000 is 89 %)", () => {
    expect(Math.round(coverOf(124_140, 140_000)! * 100)).toBe(89);
    expect(Math.round(coverOf(238_162.5, 450_000)! * 100)).toBe(53);
    expect(coverOf(10, 0)).toBeNull();
  });
  it("still to find is never below nothing", () => {
    expect(leftOf(124_140, 140_000)).toBe(15_860);
    expect(leftOf(238_162.5, 450_000)).toBe(211_837.5);
    expect(leftOf(150_000, 140_000)).toBe(0);
  });
  it("28 July 2026 is day 209 of 365 (even pace: 80,164 of Dana's 140,000)", () => {
    expect(yearDay("2026-07-28")).toEqual({ day: 209, of: 365 });
    expect(Math.round((140_000 * 209) / 365)).toBe(80_164);
    expect(yearDay("2028-12-31")).toEqual({ day: 366, of: 366 });
  });
});

describe("the one action list", () => {
  it("says where else a row lives", () => {
    expect(alsoIn({ one_to_one_id: 1, meeting_id: null, coaching_area_id: 3 }, "one-to-one")).toEqual(["coaching"]);
    expect(alsoIn({ one_to_one_id: 1, meeting_id: 1, coaching_area_id: 3 }, "meeting")).toEqual(["one-to-one", "coaching"]);
    expect(alsoIn({ one_to_one_id: null, meeting_id: 1, coaching_area_id: null }, "meeting")).toEqual([]);
  });
  it("reads a tick as each engine answers it", () => {
    expect([true, 1, "1", "true"].map(truthy)).toEqual([true, true, true, true]);
    expect([false, 0, "0", null, undefined, ""].map(truthy)).toEqual([false, false, false, false, false, false]);
  });
  it("reads a figure that is a number, a decimal's text, or nothing", () => {
    expect([num(3), num("95740.50"), num(null), num(""), num("x")]).toEqual([3, 95740.5, 0, 0, 0]);
  });
  it("one condition stays one, several are all asked", () => {
    const a = { column: "a", op: "eq" as const, value: 1 };
    expect(all([a])).toBe(a);
    expect(all([a, a])).toEqual({ and: [a, a] });
  });
});

describe("T04: the Team screens' left-out pieces", () => {
  const pair = { id: 4, manager_id: "ivy", rep_id: "dana", next_at: null };
  it("saves a session with every drawn tick, yes or no, what else was raised one line each, and its length", () => {
    const row = sessionRow(pair, { held_on: "2026-07-28", notes: "Spec", covered: ["biggest", "late"], raised: [" The August cover ", "", "Leeds"], minutes: 30 });
    expect(row).toEqual({ one_to_one_id: 4, manager_id: "ivy", rep_id: "dana", held_on: "2026-07-28", notes: "Spec", cover_sitting: false, cover_biggest: true, cover_target: false, cover_late: true, raised: "The August cover\nLeeds", minutes: 30 });
    expect(TOPICS.length).toBe(4);
  });
  it("keeps nothing raised as empty, and reads a kept one back line by line", () => {
    expect(sessionRow(pair, { held_on: "2026-07-28", notes: "x", covered: [], raised: ["  "], minutes: null })).toMatchObject({ raised: null, minutes: null });
    expect(raisedOf({ raised: "A\n\n B \n" })).toEqual(["A", "B"]);
    expect(raisedOf({ raised: null })).toEqual([]);
  });
  it("knows an install of the first stage has no session link: by the parts it holds, whatever is switched on", () => {
    const parts = (modules: Record<string, boolean> | null) => ({ config: { modules } }) as unknown as StaffSession;
    expect(sessionLinked(parts({ selling: true, quotes: true, accounts: true, team: true, inbox: true, supply: false }))).toBe(false);
    expect(sessionLinked(parts({ selling: true, team: true, jobs: false }))).toBe(true);
    expect(sessionLinked(parts({ selling: true, team: true, showroom: true }))).toBe(true);
    expect(sessionLinked(parts(null))).toBe(true);
  });
  it("names the link a child row is written through by the tables' stored names", () => {
    const session = { tableId: (ref: string) => `public.crm_${ref}` } as unknown as StaffSession;
    expect(childLink(session, "thread_members", "thread_id", "threads")).toBe("fk:public.crm_thread_members(thread_id)->public.crm_threads(id)");
  });
  it("saves an area with an empty line as no line and no measure as no number", () => {
    expect(areaRow({ title: " Get on site sooner ", why: "  ", good_looks_like: "Inside five days", measure: "" })).toEqual({ title: "Get on site sooner", why: null, good_looks_like: "Inside five days", measure: null });
    expect(areaRow({ title: "A", why: "B", good_looks_like: "", measure: "late" })).toMatchObject({ measure: "late", good_looks_like: null });
  });
});
