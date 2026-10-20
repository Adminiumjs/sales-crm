/**
 * Vehicles and crew, part A: what the screens work out from the server's
 * answers, and what they send. The server's own figures are proved on three
 * engines (`proofs/crm-fleet.test.ts`) and on the stand (`e2e/fleet-*.e2e.ts`).
 */
import { describe, expect, it } from "vitest";

import { formatters } from "../../lib/format.ts";
import type { Figure, Grouped, Row, Saved, StaffSession } from "../../staffSession.ts";
import { addFill, changedOf, chase, chasedOn, covered, daysSince, missingTicks, monthStarts, per, readFuelFigures, readSubFigures, subValues, vehicleValues } from "./data.ts";

const f = formatters({ locale: "en-US", currency: "GBP", timeZone: "Europe/London" });

describe("the days and the months", () => {
  it("counts whole days from the server's today, either way", () => {
    expect(daysSince(f, "2026-06-30", "2026-07-28")).toBe(28);
    expect(daysSince(f, "2026-07-28", "2026-08-08")).toBe(11);
  });

  it("asks the last months up to today by their first days, the day after the last included", () => {
    expect(monthStarts("2026-07-28", 3)).toEqual(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]);
    expect(monthStarts("2026-01-15", 2)).toEqual(["2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("says a subcontractor is covered while insured until today or later", () => {
    expect(covered({ insurance_until: "2026-07-28" }, "2026-07-28")).toBe(true);
    expect(covered({ insurance_until: "2026-06-30" }, "2026-07-28")).toBe(false);
    expect(covered({ insurance_until: null }, "2026-07-28")).toBe(false);
  });

  it("knows a chase made today where the business is", () => {
    expect(chasedOn({ chased_at: "2026-07-28T08:35:00.000Z" }, f, "2026-07-28")).toBe(true);
    expect(chasedOn({ chased_at: "2026-07-27T22:59:00.000Z" }, f, "2026-07-28")).toBe(false);
    expect(chasedOn({ chased_at: null }, f, "2026-07-28")).toBe(false);
  });
});

describe("a walk-round and a division", () => {
  it("lists what a check left unticked, in the crew's order", () => {
    expect(missingTicks({ tyres: true, fluids: 1, lights: false, straps: true, tail_lift: 0 })).toEqual(["lights", "tail_lift"]);
  });

  it("divides two figures, and says nothing over nothing", () => {
    expect(per(343.53, 1430)).toBeCloseTo(0.24, 3);
    expect(per(10, 0)).toBeNull();
  });
});

describe("what a form sends", () => {
  it("sends only what changed, naming what the screen saw of each", () => {
    const before: Row = { name: "Red van", plate: "YK20 HTC", service_due: "2026-07-20", hired: 0, odometer: 96780 };
    const after = vehicleValues({ name: "Red van", plate: "YK20 HTC", model: "", odometer: 96780, inspection_due: "", service_due: "2026-08-03", tax_to: "", hired: false });
    expect(changedOf(before, after)).toEqual({ values: { service_due: "2026-08-03" }, seen: { service_due: "2026-07-20" } });
  });

  it("keeps a subcontractor's empty fields empty, never blank text", () => {
    expect(subValues({ name: " Marek Sowa ", hands: 1, day_rate: 190, days_used: null, insurance_until: "", certificate: " ", email: "marek@sowa-lockers.example" })).toEqual({ name: "Marek Sowa", hands: 1, day_rate: 190, days_used: null, insurance_until: null, certificate: null, email: "marek@sowa-lockers.example" });
  });
});

/** A session that answers figures from a table of answers, and records what was written. */
function fake(answer: (figure: Figure) => unknown): { session: StaffSession; writes: unknown[][] } {
  const writes: unknown[][] = [];
  const session = {
    now: () => new Date("2026-07-28T08:35:00.000Z"),
    figure: async (figure: Figure) => answer(figure),
    create: async (ref: string, values: Row, key: string): Promise<Saved> => {
      writes.push(["create", ref, values, key]);
      return { state: "saved", row: { id: 1, ...values }, replayed: false, readBack: false };
    },
    update: async (ref: string, id: number, values: Row, more: unknown): Promise<Saved> => {
      writes.push(["update", ref, id, values, more]);
      return { state: "saved", row: { id, ...values }, replayed: false, readBack: false };
    },
  } as unknown as StaffSession;
  return { session, writes };
}

const grouped = (items: [number, Record<string, number>][]): Grouped => ({ shape: "categorical", items: items.map(([key, values]) => ({ key, label: null, value: values["n"] ?? 0, values })), total: 0 });

describe("the fuel figures", () => {
  it("takes the measured distance, litres and money from the server, everywhere and by vehicle, and asks the months by day", async () => {
    const asked: Figure[] = [];
    const { session } = fake((figure) => {
      asked.push(figure);
      const measured = (figure.filters ?? []).some((one) => "column" in one && one.column === "distance");
      if (figure.shape === "categorical") return measured ? grouped([[1, { n: 2, l: 68.5, c: 99.99, d: 730 }], [2, { n: 2, l: 89.1, c: 130.08, d: 700 }]]) : grouped([[1, { n: 3, l: 104.7, c: 152.86 }], [2, { n: 3, l: 130.6, c: 190.67 }], [3, { n: 1, l: 44, c: 64.24 }]]);
      const aggregation = figure.aggregations![0]!;
      if (aggregation.fn === "count") return { value: measured ? 4 : 7 };
      const sums: Record<string, number> = measured ? { distance: 1430, litres: 157.6, cost: 230.07 } : { litres: 279.3, cost: 407.77 };
      return { value: sums[aggregation.column!] };
    });
    const figures = await readFuelFigures(session, "2026-07-28", 2);
    expect(figures.all).toEqual({ fills: 7, litres: 279.3, cost: 407.77, distance: 1430, measuredLitres: 157.6, measuredCost: 230.07, measuredFills: 4 });
    expect(figures.by.get(1)).toEqual({ fills: 3, litres: 104.7, cost: 152.86, distance: 730, measuredLitres: 68.5, measuredCost: 99.99, measuredFills: 2 });
    expect(figures.by.get(3)).toEqual({ fills: 1, litres: 44, cost: 64.24, distance: 0, measuredLitres: 0, measuredCost: 0, measuredFills: 0 });
    // The months: two, each a range of days, the second up to the first of the next month.
    const months = asked.filter((one) => (one.filters ?? []).some((filter) => "column" in filter && filter.column === "day"));
    expect(months.map((one) => one.filters)).toEqual([
      [{ column: "day", op: "gte", value: "2026-06-01" }, { column: "day", op: "lt", value: "2026-07-01" }],
      [{ column: "day", op: "gte", value: "2026-07-01" }, { column: "day", op: "lt", value: "2026-08-01" }],
    ]);
    // Nothing is added up here: every number above is one the server gave.
  });
});

describe("the subcontractors' figures", () => {
  it("counts the covered, the run out and the undated apart, and the visits with no day only for who may read them", async () => {
    const { session } = fake((figure) => {
      const filter = (figure.filters ?? [])[0] as { column?: string; op?: string } | undefined;
      if (figure.table === "job_visits") return { value: 5 };
      if (figure.aggregations![0]!.fn === "sum") return { value: figure.aggregations![0]!.column === "spent" ? 17800 : 53 };
      return { value: filter === undefined ? 5 : filter.op === "gte" ? 4 : filter.op === "lt" ? 1 : 0 };
    });
    expect(await readSubFigures(session, "2026-07-28", true)).toEqual({ all: 5, covered: 4, runOut: 1, unknown: 0, days: 53, spent: 17800, undated: 5 });
    expect((await readSubFigures(session, "2026-07-28", false)).undated).toBeNull();
  });
});

describe("what the phone and the chase send", () => {
  it("makes a fill with a key and no reading before it: the server copies that", async () => {
    const { session, writes } = fake(() => ({}));
    await addFill(session, { vehicleId: 1, day: "2026-07-28", litres: 40.5, cost: 59.13, odometer: 118_650 }, "KEY");
    expect(writes).toEqual([["create", "fuel_fills", { vehicle_id: 1, day: "2026-07-28", litres: 40.5, cost: 59.13, odometer: 118_650 }, "KEY"]]);
  });

  it("chases once over what the screen saw, at the server's clock; who chased is the server's", async () => {
    const { session, writes } = fake(() => ({}));
    await chase(session, { id: 4, chased_at: null });
    expect(writes).toEqual([["update", "subcontractors", 4, { chased_at: "2026-07-28T08:35:00.000Z" }, { seen: { chased_at: null } }]]);
  });
});
