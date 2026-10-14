/**
 * The showroom's own judgement, at the ledger's moment (Tue 28 Jul 2026,
 * 09:35 in London): which booking is in the way, the next clear time, the
 * showroom's hours, the filters, what the visitor is told, and how long a
 * loan or a piece has been out.
 */
import { describe, expect, it } from "vitest";

import { formatters } from "../../lib/format.ts";
import { clashOf, clockOf, daysAway, daysLate, DEFAULT_WEEK, hoursProblem, inFilter, isTired, monthsOut, nextClear, toldLine, visitorOf, weekdayOf, type Booking, type ShowWeek } from "./data.ts";

const f = formatters({ locale: "en-US", currency: "GBP", timeZone: "Europe/London" });
const NOW = new Date("2026-07-28T08:35:00Z");
const at = (day: string, time: string): string => f.at(day, time).toISOString();
const booking = (id: number, space: number, day: string, time: string, minutes: number, state: Booking["state"] = "confirmed"): Pick<Booking, "id" | "space_id" | "starts_at" | "minutes" | "state"> => ({ id, space_id: space, starts_at: at(day, time), minutes, state });
const WEEK: ShowWeek = { ...DEFAULT_WEEK };

// The ledger's Fri 31 Jul: w4 on the Main floor 09:30–11:00 (Cobalt, three of them), w5 in the Booth corner 10:00–11:00.
const MAIN = 1;
const BOOTH = 2;
const FRIDAY = [booking(4, MAIN, "2026-07-31", "09:30", 90), booking(5, BOOTH, "2026-07-31", "10:00", 60, "tentative")];

describe("the booking in the way", () => {
  it("is the live booking of the same space whose time overlaps", () => {
    expect(clashOf({ space_id: MAIN, starts_at: at("2026-07-31", "10:00"), minutes: 60 }, FRIDAY)?.id).toBe(4);
    // The Booth corner at the same hour is another space's, and w5 is taken there.
    expect(clashOf({ space_id: BOOTH, starts_at: at("2026-07-31", "10:30"), minutes: 30 }, FRIDAY)?.id).toBe(5);
    // One that ends as the other starts does not overlap.
    expect(clashOf({ space_id: MAIN, starts_at: at("2026-07-31", "11:00"), minutes: 60 }, FRIDAY)).toBeNull();
    expect(clashOf({ space_id: MAIN, starts_at: at("2026-07-31", "08:30"), minutes: 60 }, FRIDAY)).toBeNull();
  });

  it("is never the booking itself (a move), nor one somebody has already been in for", () => {
    expect(clashOf({ id: 4, space_id: MAIN, starts_at: at("2026-07-31", "10:00"), minutes: 60 }, FRIDAY)).toBeNull();
    expect(clashOf({ space_id: MAIN, starts_at: at("2026-07-24", "11:00"), minutes: 60 }, [booking(7, MAIN, "2026-07-24", "11:00", 60, "done")])).toBeNull();
  });
});

describe("the next clear time", () => {
  it("is the first quarter-hour after the booking in the way, the same length, the same space", () => {
    const next = nextClear({ space_id: MAIN, starts_at: at("2026-07-31", "10:00"), minutes: 60 }, FRIDAY, WEEK, NOW, f);
    expect(next === null ? null : `${f.dayKey(next)} ${f.time(next)}`).toBe("2026-07-31 11:00");
  });

  it("keeps to the hours: a booking that cannot fit before closing goes to the next day the showroom opens", () => {
    // 16:45 for an hour runs past 17:30; Friday has nothing later, Saturday and Sunday are closed: Monday at opening.
    const next = nextClear({ space_id: MAIN, starts_at: at("2026-07-31", "16:45"), minutes: 60 }, FRIDAY, WEEK, NOW, f);
    expect(next === null ? null : `${weekdayOf(f.dayKey(next))} ${f.dayKey(next)} ${f.time(next)}`).toBe("mon 2026-08-03 09:00");
  });

  it("takes the next start on the quarter-hour, and never one already past by the server's clock", () => {
    // Asked for 09:00 today: the clock says 09:35, so the first free start is 09:45.
    const next = nextClear({ space_id: BOOTH, starts_at: at("2026-07-28", "09:00"), minutes: 45 }, [], WEEK, NOW, f);
    expect(next === null ? null : f.time(next)).toBe("09:45");
    const odd = nextClear({ space_id: BOOTH, starts_at: at("2026-07-29", "10:05"), minutes: 30 }, [], WEEK, NOW, f);
    expect(odd === null ? null : f.time(odd)).toBe("10:15");
  });

  it("opens on a Saturday when the business works Saturdays", () => {
    const next = nextClear({ space_id: MAIN, starts_at: at("2026-07-31", "16:45"), minutes: 60 }, FRIDAY, { ...WEEK, days: new Set([...WEEK.days, "sat"]) }, NOW, f);
    expect(next === null ? null : f.dayKey(next)).toBe("2026-08-01");
  });

  it("is none when nothing is clear in three weeks", () => {
    const full = Array.from({ length: 30 }, (_, n) => booking(100 + n, MAIN, new Date(Date.UTC(2026, 6, 31 + n)).toISOString().slice(0, 10), "09:00", 510));
    expect(nextClear({ space_id: MAIN, starts_at: at("2026-07-31", "10:00"), minutes: 60 }, full, WEEK, NOW, f)).toBeNull();
  });
});

describe("the showroom's hours", () => {
  it("refuses a weekend, and a time outside opening to closing; takes a booking that ends at closing", () => {
    expect(hoursProblem({ starts_at: at("2026-08-01", "10:00"), minutes: 60 }, WEEK, f)).toBe("closed");
    expect(hoursProblem({ starts_at: at("2026-07-31", "08:45"), minutes: 30 }, WEEK, f)).toBe("hours");
    expect(hoursProblem({ starts_at: at("2026-07-31", "17:00"), minutes: 45 }, WEEK, f)).toBe("hours");
    expect(hoursProblem({ starts_at: at("2026-07-31", "16:30"), minutes: 60 }, WEEK, f)).toBeNull();
    expect(hoursProblem({ starts_at: at("2026-07-31", "09:00"), minutes: 90 }, { ...WEEK, opens: "09:30" }, f)).toBe("hours");
  });

  it("reads a day key's weekday and writes a clock", () => {
    expect(["2026-07-27", "2026-07-28", "2026-08-01", "2026-08-02"].map(weekdayOf)).toEqual(["mon", "tue", "sat", "sun"]);
    expect([clockOf(540), clockOf(1050), clockOf(0)]).toEqual(["09:00", "17:30", "00:00"]);
  });
});

describe("the filters", () => {
  it("puts a booking under coming in, still to confirm, been in, by its state and the server's day", () => {
    const tomorrow = { state: "tentative" as const, starts_at: at("2026-07-29", "14:00") };
    const earlierToday = { state: "confirmed" as const, starts_at: at("2026-07-28", "09:00") };
    const been = { state: "done" as const, starts_at: at("2026-07-24", "11:00") };
    const where = (row: Pick<Booking, "state" | "starts_at">) => (["coming", "tentative", "done", "all"] as const).filter((one) => inFilter(row, one, NOW, f));
    expect(where(tomorrow)).toEqual(["coming", "tentative", "all"]);
    // Today counts as coming in, the whole day.
    expect(where(earlierToday)).toEqual(["coming", "all"]);
    expect(where(been)).toEqual(["done", "all"]);
  });

  it("names a visitor by company and person, or a new name", () => {
    expect(visitorOf({ company: "Cobalt Legal", contact: "Ines Vaughan", visitor_name: null })).toBe("Cobalt Legal, Ines Vaughan");
    expect(visitorOf({ company: null, contact: null, visitor_name: "Jo Bloggs" })).toBe("Jo Bloggs");
  });
});

describe("what the visitor is told", () => {
  it("says what the server will send, and nothing it will not", () => {
    expect(toldLine("new", "on", "confirmed", true, true, true)).toBe("sh.told.new");
    expect(toldLine("new", "on", "tentative", true, true, false)).toBe("sh.told.tentative");
    expect(toldLine("new", "on", "confirmed", false, true, true)).toBe("sh.told.nobody");
    expect(toldLine("new", "off", "confirmed", true, true, true)).toBe("sh.told.off");
    expect(toldLine("new", "unknown", "confirmed", true, true, true)).toBe("sh.told.unknown");
    expect(toldLine("move", "on", "confirmed", true, true, true)).toBe("sh.told.move");
    expect(toldLine("move", "on", "confirmed", true, false, true)).toBe("sh.told.move.same");
    expect(toldLine("move", "on", "tentative", true, true, true)).toBe("sh.told.move.tentative");
    expect(toldLine("cancel", "on", "confirmed", true, false, true)).toBe("sh.told.cancel");
    expect(toldLine("cancel", "on", "tentative", true, false, true)).toBe("sh.told.cancel.tentative");
  });
});

describe("how long out", () => {
  it("counts a loan's days late and away by the business's calendar (the ledger's sm4: out 7 Jul, due 21 Jul, 7 days late, 21 away)", () => {
    expect(daysLate({ due_back: "2026-07-21" }, NOW, f)).toBe(7);
    expect(daysAway({ out_on: "2026-07-07" }, NOW, f)).toBe(21);
    expect(daysLate({ due_back: "2026-07-31" }, NOW, f)).toBe(-3);
  });

  it("counts a piece's months out as the ledger does, and calls it tired at the setting's months or on an old spec", () => {
    // fl1 6, fl3 8, fl6 11 (old), fl8 11, fl4 1: the ledger's own.
    expect(["2026-02-10", "2025-11-22", "2025-08-14", "2025-09-09", "2026-06-18"].map((out_since) => monthsOut({ out_since }, NOW, f))).toEqual([6, 8, 11, 11, 1]);
    expect(isTired({ out_since: "2025-09-09", spec: "current" }, 10, NOW, f)).toBe(true);
    expect(isTired({ out_since: "2025-11-22", spec: "current" }, 10, NOW, f)).toBe(false);
    expect(isTired({ out_since: "2026-07-06", spec: "old" }, 10, NOW, f)).toBe(true);
  });
});
