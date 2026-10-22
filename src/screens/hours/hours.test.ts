/**
 * Time sheets and training (P25, part B): what the screens work out for
 * themselves, and what they ask the server. Every count is the server's; what
 * is left to the browser is which week an address names, whether a day is
 * before today or within the warning days of it, and how hours are typed.
 */
import { describe, expect, it } from "vitest";

import type { Figure, StaffSession } from "../../staffSession.ts";
import { DAYS, type Day } from "../appsettings/data.ts";
import { certState, daysFrom, daysOf, editable, lastWorkingDay, readCertFigures, readHours, readWeekFigures, weekAsked, weekHours } from "./data.ts";

const TODAY = "2026-07-28"; // the sample's Tuesday

describe("the week a screen shows", () => {
  it("is the week just gone with no address, and the Monday of any day an address names", () => {
    expect(weekAsked([], TODAY)).toBe("2026-07-20");
    expect(weekAsked(["2026-07-15"], TODAY)).toBe("2026-07-13");
    expect(weekAsked(["2026-07-27"], TODAY)).toBe("2026-07-27");
    // Not a day: the week just gone.
    expect(weekAsked(["soon"], TODAY)).toBe("2026-07-20");
    expect(weekAsked(["2026-13-45"], TODAY)).toBe("2026-07-20");
    expect(daysOf("2026-07-20")).toEqual(["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"]);
  });

  it("is over after its last working day, and its hours are the settings' day times the working days", () => {
    const weekdays = new Set<Day>(["mon", "tue", "wed", "thu", "fri"]);
    expect(lastWorkingDay("2026-07-20", weekdays)).toBe("2026-07-24");
    expect(lastWorkingDay("2026-07-20", new Set<Day>(["mon", "sat"]))).toBe("2026-07-25");
    expect(lastWorkingDay("2026-07-20", new Set<Day>(DAYS))).toBe("2026-07-26");
    expect(weekHours({ workDays: weekdays, dayHours: 8 })).toBe(40);
    expect(weekHours({ workDays: weekdays, dayHours: 7.5 })).toBe(37.5);
  });

  it("is its maker's to change while open or sent back, and nobody's once sent or signed off", () => {
    expect([editable("open"), editable("sent-back"), editable("sent"), editable("signed-off")]).toEqual([true, true, false, false]);
  });
});

describe("hours as a crew member types them", () => {
  it("reads a number of hours from 0 to 24, with a point or a comma, and nothing else", () => {
    expect(["7", "1.5", "1,5", "0", "", " 6 ", "24", "7.25"].map(readHours)).toEqual([7, 1.5, 1.5, 0, 0, 6, 24, 7.25]);
    expect(["25", "-1", "seven", "1.2.3", "1.255"].map(readHours)).toEqual([null, null, null, null, null]);
  });
});

describe("a certificate's state, by the server's today and the warning days", () => {
  it("has run out before today, runs out soon up to the warning day, and is in date after", () => {
    expect(certState("2026-07-12", TODAY, 42)).toBe("out");
    expect(certState("2026-07-27", TODAY, 42)).toBe("out");
    expect(certState("2026-07-28", TODAY, 42)).toBe("soon");
    // The ledger's (§64): Rina's first aid 24 days on, Mo's working at height 18, both soon; Cal's 46, just outside.
    expect(certState("2026-08-21", TODAY, 42)).toBe("soon");
    expect(certState("2026-09-08", TODAY, 42)).toBe("soon");
    expect(certState("2026-09-09", TODAY, 42)).toBe("ok");
    expect(certState("2026-09-12", TODAY, 42)).toBe("ok");
    expect(certState("2026-09-12T00:00:00.000Z", TODAY, 46)).toBe("soon");
    expect([daysFrom(TODAY, "2026-09-12"), daysFrom(TODAY, "2026-07-12"), daysFrom(TODAY, TODAY)]).toEqual([46, -16, 0]);
  });
});

/** A session that answers every figure with a number and keeps what was asked. */
function fakeSession(reads: readonly string[]): { session: StaffSession; asked: Figure[] } {
  const asked: Figure[] = [];
  const session = {
    can: (ref: string) => reads.includes(ref),
    figure: async (figure: Figure) => {
      asked.push(figure);
      return figure.shape === "categorical" ? { shape: "categorical", items: [{ key: 3, label: "J-07", value: 2, values: { n: 2 } }], total: 2 } : { value: 5 };
    },
  } as unknown as StaffSession;
  return { session, asked };
}

describe("what the screens ask the server", () => {
  it("asks a week's figures of the sheets of that week and the lines of its days, all as figures", async () => {
    const { session, asked } = fakeSession(["jobs"]);
    const figures = await readWeekFigures(session, "2026-07-20", 40);
    expect(figures).toMatchObject({ onJob: 5, travel: 5, sheets: 5, toSign: 5, over: 5, lines: 5, onAJob: 5, daysOff: 5, byJob: [{ label: "J-07", count: 2 }] });
    expect(asked.map((figure) => figure.table)).toEqual(["time_sheets", "time_sheets", "time_sheets", "time_sheets", "time_sheets", "time_sheet_lines", "time_sheet_lines", "time_sheet_lines", "time_sheet_lines"]);
    expect(asked[0]).toMatchObject({ filters: [{ column: "week_of", op: "between", value: ["2026-07-20", "2026-07-26"] }], aggregations: [{ fn: "sum", column: "hours_total" }] });
    expect(asked[4]).toMatchObject({ filters: [{ column: "week_of", op: "between", value: ["2026-07-20", "2026-07-26"] }, { column: "total_hours", op: "gt", value: 40 }] });
    expect(asked[5]).toMatchObject({ filters: [{ column: "day", op: "between", value: ["2026-07-20", "2026-07-26"] }] });
    expect(asked[8]).toMatchObject({ groupBy: ["job_id"], groupLabel: "job_id.code" });
  });

  it("does not ask which job a line was on of somebody who reads no job", async () => {
    const { session, asked } = fakeSession([]);
    expect((await readWeekFigures(session, "2026-07-20", 40)).byJob).toEqual([]);
    expect(asked.some((figure) => figure.groupBy !== undefined)).toBe(false);
  });

  it("counts certificates run out and running out by the warning days, per person only for the office", async () => {
    const { session, asked } = fakeSession([]);
    await readCertFigures(session, TODAY, 42, false);
    expect(asked.map((figure) => figure.filters)).toEqual([[], [{ column: "valid_until", op: "lt", value: TODAY }], [{ column: "valid_until", op: "between", value: [TODAY, "2026-09-08"] }]]);
    const office = fakeSession([]);
    const figures = await readCertFigures(office.session, TODAY, 42, true);
    expect(office.asked.filter((figure) => figure.groupBy !== undefined).map((figure) => figure.groupBy)).toEqual([["name"], ["user_id"], ["user_id"]]);
    expect(figures.outBy).toEqual({ "3": 2 });
  });
});
