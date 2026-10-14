/**
 * The small sums of the manager's screens that are done in the browser:
 * moments worked out from the server's clock, and figures compared (never
 * added).
 */
import { describe, expect, it } from "vitest";

import { formatters } from "../../lib/format.ts";
import type { StaffSession } from "../../staffSession.ts";
import { before, byKey, cellsOf, daysSince, largest, monthsBack, peopleOf, quarterOf, toneOf } from "./data.ts";

const f = formatters({ locale: "en-US", currency: "GBP", timeZone: "Europe/London" });

describe("the moment a deal has sat N days from", () => {
  it("is the start of a calendar day where the business is, so the hour a deal entered its stage does not matter", () => {
    // On 28 July, "30 days or more" is anything that entered before 29 June began in London (23:00 UTC the evening before, in summer).
    expect(before(f, "2026-07-28", 30)).toBe("2026-06-28T23:00:00.000Z");
    expect(before(f, "2026-07-28", 14)).toBe("2026-07-14T23:00:00.000Z");
    // In winter London is on UTC.
    expect(before(f, "2026-01-20", 7)).toBe("2026-01-14T00:00:00.000Z");
  });

  it("agrees with the days a row is said to have sat", () => {
    const now = new Date("2026-07-28T08:35:00.000Z");
    // d1 entered Negotiation on 14 July at 11:20 London: 14 days, and so "14 or more" but not "15 or more".
    const entered = "2026-07-14T10:20:00.000Z";
    expect(daysSince(f, now, entered)).toBe(14);
    expect(entered < before(f, "2026-07-28", 14)).toBe(true);
    expect(entered < before(f, "2026-07-28", 15)).toBe(false);
    expect(daysSince(f, now, null)).toBeNull();
  });
});

describe("how far back a screen looks", () => {
  it("goes back whole months to the same day, as the ledger does", () => {
    expect(monthsBack("2026-07-28", 12)).toBe("2025-07-28");
    expect(monthsBack("2026-07-28", 6)).toBe("2026-01-28");
    expect(monthsBack("2026-07-28", 3)).toBe("2026-04-28");
  });

  it("stops at the last day of a shorter month", () => {
    expect(monthsBack("2026-05-31", 3)).toBe("2026-02-28");
    expect(monthsBack("2024-03-31", 1)).toBe("2024-02-29");
  });

  it("knows the quarter a day is in", () => {
    expect(quarterOf("2026-07-28")).toBe("2026-07-01");
    expect(quarterOf("2026-03-31")).toBe("2026-01-01");
    expect(quarterOf("2026-12-01")).toBe("2026-10-01");
  });
});

describe("the server's figures, as a screen holds them", () => {
  it("keys a grouped figure by its group, and reads a figure asked for one number", () => {
    expect(byKey({ shape: "categorical", total: 2, items: [{ key: 4, label: "Negotiation", value: 3, values: { n: 3, w: 79050 } }, { key: null, label: null, value: 1, values: { n: 1, w: 5 } }] })).toEqual({ "4": { n: 3, w: 79050 } });
    expect(byKey({ shape: "categorical", total: 8, items: [{ key: "call", label: "call", value: 8 }] }, "n")).toEqual({ call: { n: 8 } });
  });

  it("reads a two-way figure, leaving out the cells the server left empty", () => {
    expect(cellsOf({ shape: "matrix", rowKeys: ["a", "b"], colKeys: ["1", "2"], cells: [[1, null], [null, 2]] })).toEqual({ a: { "1": 1 }, b: { "2": 2 } });
  });

  it("names every key of a tie for the largest, and nothing when all are nought", () => {
    expect(largest({ proposal: 4, negotiation: 2 })).toEqual({ keys: ["proposal"], value: 4 });
    expect(largest({ discovery: 1, qualified: 1, proposal: 1 })).toEqual({ keys: ["discovery", "qualified", "proposal"], value: 1 });
    expect(largest({ discovery: 0 })).toEqual({ keys: [], value: 0 });
    expect(largest({})).toEqual({ keys: [], value: 0 });
  });

  it("colours a stage by its place, however many stages an install adds", () => {
    expect([0, 1, 4, 9].map(toneOf)).toEqual(["neutral", "info", "pos", "pos"]);
  });
});

describe("who the reps are", () => {
  it("is read once for a session and kept: a figure read again does not ask for the names again", async () => {
    let lists = 0;
    let people = 0;
    const session = {
      config: { user: { id: "u1", name: "Ivy Sandoval" } },
      list: async () => ((lists += 1), { rows: [{ user_id: "u2" }], total: 1, next: null }),
      people: async () => ((people += 1), [{ id: "u2", name: "Dana Whitlock" }]),
    } as unknown as StaffSession;
    const first = await peopleOf(session);
    const second = await peopleOf(session);
    expect(first).toEqual({ reps: ["u2"], names: { u1: "Ivy Sandoval", u2: "Dana Whitlock" } });
    expect(second).toBe(first);
    expect([lists, people]).toEqual([1, 1]);
  });

  it("asks again after a read that failed", async () => {
    let tries = 0;
    const session = {
      config: { user: null },
      list: async () => {
        tries += 1;
        if (tries === 1) throw new Error("the line dropped");
        return { rows: [], total: 0, next: null };
      },
      people: async () => [],
    } as unknown as StaffSession;
    await expect(peopleOf(session)).rejects.toThrow("the line dropped");
    expect(await peopleOf(session)).toEqual({ reps: [], names: {} });
  });
});

describe("byKey leaves out the group of rows with no value", () => {
  it("drops the server's `__null` group", () => {
    const answer = { shape: "categorical" as const, total: 3, items: [{ key: "__null", label: "—", value: 1 }, { key: "u1", label: "u1", value: 2 }] };
    expect(byKey(answer, "n")).toEqual({ u1: { n: 2 } });
  });
});
