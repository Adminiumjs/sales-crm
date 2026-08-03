/**
 * Engine assertions for `lib/pipeline.ts`.
 *
 * These run against the shipped seed rather than fixtures wherever the seed
 * makes the point, so a change to `data/demo.ts` that quietly breaks the board
 * — a stage renamed, a close date moved out of the forecast window — fails
 * here instead of on the screen.
 */

import { describe, expect, it } from "vitest";

import {
  ACTIVITIES,
  DEALS,
  FOLLOWUPS,
  HISTORY,
  NOW,
  STAGES,
} from "../data/demo.ts";
import type { Deal } from "../data/types.ts";
import {
  averageCycleDays,
  closingThisMonth,
  columns,
  dayDiff,
  daysInStage,
  followUpQueue,
  forecast,
  goingStale,
  openTotal,
  parseAt,
  pushDue,
  staleness,
  timeline,
  timelineForDeals,
  weighted,
  weightedTotal,
  winRate,
} from "./pipeline.ts";

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: "x",
  name: "data.deal.x",
  co: "cobalt",
  amount: 10_000,
  stage: "proposal",
  owner: "dana",
  opened: "2026-06-01",
  since: "2026-07-01",
  close: "2026-08-15",
  scope: "data.scope.x",
  main: "ines",
  ...over,
});

describe("date helpers", () => {
  it("parses a bare date at local midnight", () => {
    const d = parseAt("2026-07-28");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(0);
  });

  it("parses a date with a time", () => {
    const d = parseAt("2026-07-28 16:45");
    expect(d.getHours()).toBe(16);
    expect(d.getMinutes()).toBe(45);
  });

  it("counts whole days and ignores the time of day", () => {
    expect(dayDiff(parseAt("2026-07-28 09:35"), parseAt("2026-07-24 23:59"))).toBe(4);
    expect(dayDiff(parseAt("2026-07-28"), parseAt("2026-07-28 23:00"))).toBe(0);
  });

  it("returns a negative difference for a future date", () => {
    expect(dayDiff(parseAt("2026-07-28"), parseAt("2026-07-31"))).toBe(-3);
  });
});

describe("weighting", () => {
  it("multiplies the amount by the stage odds", () => {
    expect(weighted(deal({ amount: 20_000, stage: "proposal" }), STAGES)).toBe(10_000);
    expect(weighted(deal({ amount: 20_000, stage: "verbal" }), STAGES)).toBe(18_000);
    expect(weighted(deal({ amount: 20_000, stage: "discovery" }), STAGES)).toBe(2_000);
  });

  it("sums the weighted value across a set", () => {
    const set = [
      deal({ id: "a", amount: 10_000, stage: "discovery" }), //  1,000
      deal({ id: "b", amount: 10_000, stage: "verbal" }), //     9,000
    ];
    expect(weightedTotal(set, STAGES)).toBe(10_000);
    expect(openTotal(set)).toBe(20_000);
  });

  it("weighs the shipped pipeline below its unweighted value", () => {
    const w = weightedTotal(DEALS, STAGES);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(openTotal(DEALS));
  });
});

describe("columns", () => {
  it("returns one column per stage, in stage order", () => {
    const cols = columns(DEALS, STAGES);
    expect(cols).toHaveLength(STAGES.length);
    expect(cols.map((c) => c.stage.id)).toEqual([
      "discovery",
      "qualified",
      "proposal",
      "negotiation",
      "verbal",
    ]);
  });

  it("accounts for every deal exactly once", () => {
    const cols = columns(DEALS, STAGES);
    expect(cols.reduce((n, c) => n + c.count, 0)).toBe(DEALS.length);
    expect(cols.reduce((n, c) => n + c.total, 0)).toBe(openTotal(DEALS));
  });

  it("column subtotals sum to the board total", () => {
    const cols = columns(DEALS, STAGES);
    const boardWeighted = cols.reduce((n, c) => n + c.weighted, 0);
    expect(boardWeighted).toBeCloseTo(weightedTotal(DEALS, STAGES), 6);
  });

  it("moves value between columns when a deal changes stage", () => {
    const before = columns(DEALS, STAGES);
    const moved = DEALS.map((d) =>
      d.id === "d1" ? { ...d, stage: "verbal" as const } : d,
    );
    const after = columns(moved, STAGES);

    const negoBefore = before.find((c) => c.stage.id === "negotiation")!;
    const negoAfter = after.find((c) => c.stage.id === "negotiation")!;
    const verbalBefore = before.find((c) => c.stage.id === "verbal")!;
    const verbalAfter = after.find((c) => c.stage.id === "verbal")!;

    expect(negoAfter.count).toBe(negoBefore.count - 1);
    expect(verbalAfter.count).toBe(verbalBefore.count + 1);
    // The board is worth more: the same money now sits at better odds.
    expect(weightedTotal(moved, STAGES)).toBeGreaterThan(
      weightedTotal(DEALS, STAGES),
    );
  });

  it("gives an empty stage a zero column rather than omitting it", () => {
    const onlyDiscovery = [deal({ stage: "discovery" })];
    const cols = columns(onlyDiscovery, STAGES);
    expect(cols).toHaveLength(5);
    expect(cols.find((c) => c.stage.id === "verbal")).toMatchObject({
      count: 0,
      total: 0,
      weighted: 0,
    });
  });
});

describe("staleness", () => {
  it("counts days from the stage-entry date, not the open date", () => {
    const d = deal({ opened: "2026-01-01", since: "2026-07-21" });
    expect(daysInStage(d, NOW)).toBe(7);
    expect(staleness(d, NOW)).toBe("fresh");
  });

  it("turns amber at 14 days and danger at 30", () => {
    expect(staleness(deal({ since: "2026-07-15" }), NOW)).toBe("fresh"); // 13
    expect(staleness(deal({ since: "2026-07-14" }), NOW)).toBe("warn"); //  14
    expect(staleness(deal({ since: "2026-06-29" }), NOW)).toBe("warn"); //  29
    expect(staleness(deal({ since: "2026-06-28" }), NOW)).toBe("stale"); // 30
  });

  it("never reports a negative age for a future stage date", () => {
    expect(daysInStage(deal({ since: "2026-08-10" }), NOW)).toBe(0);
  });

  it("finds the worst deals, worst first", () => {
    const stale = goingStale(DEALS, NOW, 3);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.length).toBeLessThanOrEqual(3);
    const ages = stale.map((d) => daysInStage(d, NOW));
    expect([...ages].sort((a, b) => b - a)).toEqual(ages);
    expect(ages[0]).toBeGreaterThanOrEqual(14);
  });

  it("the shipped seed has at least two deals worth nudging", () => {
    expect(goingStale(DEALS, NOW, 10).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the follow-up queue", () => {
  it("puts overdue rows first, oldest of those first", () => {
    const q = followUpQueue(FOLLOWUPS, DEALS, NOW);
    const overdue = q.filter((r) => r.overdue);
    expect(overdue.length).toBe(3);
    expect(q.slice(0, overdue.length).every((r) => r.overdue)).toBe(true);
    const times = overdue.map((r) => r.due.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("orders the rest by due time", () => {
    const rest = followUpQueue(FOLLOWUPS, DEALS, NOW).filter((r) => !r.overdue);
    const times = rest.map((r) => r.due.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("reports how many days late an overdue row is", () => {
    const q = followUpQueue(FOLLOWUPS, DEALS, NOW);
    const f1 = q.find((r) => r.followUp.id === "f1")!;
    expect(f1.overdue).toBe(true);
    expect(f1.daysLate).toBe(4); // due 24 Jul, now 28 Jul
  });

  it("drops completed rows", () => {
    const q = followUpQueue(FOLLOWUPS, DEALS, NOW, new Set(["f1", "f2"]));
    expect(q.map((r) => r.followUp.id)).not.toContain("f1");
    expect(q).toHaveLength(FOLLOWUPS.length - 2);
  });

  it("drops rows whose deal is gone rather than rendering an orphan", () => {
    const q = followUpQueue(FOLLOWUPS, DEALS.filter((d) => d.id !== "d1"), NOW);
    expect(q.every((r) => r.deal.id !== "d1")).toBe(true);
  });

  it("pushes a due date forward by a day or a week", () => {
    const due = parseAt("2026-07-28 10:00");
    expect(dayDiff(pushDue(due, "day"), due)).toBe(1);
    expect(dayDiff(pushDue(due, "week"), due)).toBe(7);
    // Pushing does not move the time of day.
    expect(pushDue(due, "week").getHours()).toBe(10);
  });

  it("pushing an overdue row past now clears its overdue flag", () => {
    const pushed = FOLLOWUPS.map((f) =>
      f.id === "f1" ? { ...f, due: "2026-07-31 16:00" } : f,
    );
    const row = followUpQueue(pushed, DEALS, NOW).find(
      (r) => r.followUp.id === "f1",
    )!;
    expect(row.overdue).toBe(false);
    expect(row.daysLate).toBe(0);
  });
});

describe("forecast", () => {
  it("returns the requested number of consecutive months from now", () => {
    const f = forecast(DEALS, STAGES, NOW, 3);
    expect(f).toHaveLength(3);
    expect(f[0].month.getMonth()).toBe(6); // July
    expect(f[1].month.getMonth()).toBe(7); // August
    expect(f[2].month.getMonth()).toBe(8); // September
  });

  it("accumulates the weighted value down the months", () => {
    const f = forecast(DEALS, STAGES, NOW, 3);
    expect(f[0].cumulative).toBeCloseTo(f[0].weighted, 6);
    expect(f[1].cumulative).toBeCloseTo(f[0].weighted + f[1].weighted, 6);
    expect(f[2].cumulative).toBeGreaterThanOrEqual(f[1].cumulative);
  });

  it("folds a close date already in the past into the first month", () => {
    const overdue = [deal({ amount: 10_000, stage: "verbal", close: "2026-05-01" })];
    const f = forecast(overdue, STAGES, NOW, 3);
    expect(f[0].count).toBe(1);
    expect(f[0].weighted).toBe(9_000);
  });

  it("leaves a deal beyond the window out of every bucket", () => {
    const far = [deal({ close: "2027-01-10" })];
    const f = forecast(far, STAGES, NOW, 3);
    expect(f.reduce((n, b) => n + b.count, 0)).toBe(0);
  });

  it("counts the deals closing in the current calendar month", () => {
    const july = closingThisMonth(DEALS, NOW);
    expect(july.length).toBeGreaterThan(0);
    expect(july.every((d) => parseAt(d.close).getMonth() === 6)).toBe(true);
  });
});

describe("closed history", () => {
  it("computes the win rate from the seeded history", () => {
    // Five won of eight closed.
    expect(winRate(HISTORY)).toBeCloseTo(5 / 8, 6);
  });

  it("returns zero rather than NaN for an empty history", () => {
    expect(winRate([])).toBe(0);
    expect(averageCycleDays([])).toBe(0);
  });

  it("averages the cycle over won deals only", () => {
    const won = HISTORY.filter((h) => h.won);
    const expected = Math.round(
      won.reduce(
        (sum, h) => sum + dayDiff(parseAt(h.closed), parseAt(h.opened)),
        0,
      ) / won.length,
    );
    expect(averageCycleDays(HISTORY)).toBe(expected);
    expect(averageCycleDays(HISTORY)).toBeGreaterThan(0);
  });

  it("ignores lost deals when averaging the cycle", () => {
    const slowLoss = [
      ...HISTORY,
      {
        id: "h9",
        name: "data.deal.h9",
        co: "cobalt",
        amount: 1_000,
        owner: "dana",
        opened: "2025-01-01",
        closed: "2026-07-01",
        won: false,
      },
    ];
    expect(averageCycleDays(slowLoss)).toBe(averageCycleDays(HISTORY));
  });
});

describe("timelines", () => {
  it("returns one deal's activities newest first", () => {
    const rows = timeline(ACTIVITIES, "d1");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((a) => a.deal === "d1")).toBe(true);
    const times = rows.map((a) => parseAt(a.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("merges every type into one stream", () => {
    const types = new Set(timeline(ACTIVITIES, "d1").map((a) => a.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it("merges several deals for a company timeline", () => {
    const merged = timelineForDeals(ACTIVITIES, ["d1", "d12"]);
    expect(merged.some((a) => a.deal === "d1")).toBe(true);
    expect(merged.some((a) => a.deal === "d12")).toBe(true);
    const times = merged.map((a) => parseAt(a.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("returns an empty stream for a deal with no activity", () => {
    expect(timeline(ACTIVITIES, "nope")).toEqual([]);
    expect(timelineForDeals(ACTIVITIES, [])).toEqual([]);
  });
});
