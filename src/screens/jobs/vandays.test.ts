/**
 * How the booking dialog and the Day sheet say a vehicle stands for a crew's day (plan 68 S14, M3 §7), on the
 * sample of M3: Blue on YJ19 KPX, Red on the hired ML24 VDR (hired Mon 27 Jul to Fri 14 Aug) on Wed 5 Aug.
 */
import { describe, expect, it } from "vitest";

import { defaultVehicle, hiredOn, holderOf, pickable, refusalOf, serviceOver, staleOf, standingOf, type DayVehicle, type Facts, type VanDay } from "./vandays.ts";

const vehicle = (id: number, plate: string, more: Partial<DayVehicle> = {}): DayVehicle => ({ id, name: plate, plate, hired: false, hired_from: null, hired_to: null, service_due: null, ...more });
const BLUE_VAN = vehicle(1, "YJ19 KPX", { service_due: "2026-09-02" });
const RED_VAN = vehicle(2, "YK20 HTC", { service_due: "2026-07-20" });
const HIRED = vehicle(3, "ML24 VDR", { hired: true, hired_from: "2026-07-27", hired_to: "2026-08-14" });
const row = (id: number, crew_id: number, day: string, vehicle_id: number): VanDay => ({ id, crew_id, day, vehicle_id, plate: null, vehicle_name: null, hired: false });
const BLUE = 1;
const RED = 2;

function facts(days: VanDay[], busy: [number, string][] = days.map((one) => [one.crew_id, one.day])): Facts {
  const has = new Set(busy.map(([crew, day]) => `${String(crew)}|${day}`));
  return { vehicles: [BLUE_VAN, RED_VAN, HIRED], own: new Map([[BLUE, 1], [RED, 2]]), days, busy: (crew, day) => has.has(`${String(crew)}|${day}`) };
}
const SAMPLE = facts([row(1, BLUE, "2026-08-05", 1), row(2, RED, "2026-08-05", 3)]);

describe("a vehicle for a crew's day", () => {
  it("says, for Blue on Wed 5 Aug, its own, Red's own not in use, and the hired one with Red", () => {
    expect(standingOf(SAMPLE, BLUE_VAN, BLUE, "2026-08-05")).toEqual({ kind: "own" });
    expect(standingOf(SAMPLE, RED_VAN, BLUE, "2026-08-05")).toEqual({ kind: "idle", crewId: RED });
    expect(standingOf(SAMPLE, HIRED, BLUE, "2026-08-05")).toEqual({ kind: "with", crewId: RED });
    expect(pickable(standingOf(SAMPLE, HIRED, BLUE, "2026-08-05"))).toBe(false);
  });

  it("says the hired one is hired until its last day, and not hired outside its days", () => {
    expect(standingOf(SAMPLE, HIRED, RED, "2026-08-10")).toEqual({ kind: "until", to: "2026-08-14" });
    expect(standingOf(SAMPLE, HIRED, RED, "2026-08-17")).toEqual({ kind: "notHired", from: "2026-07-27", to: "2026-08-14" });
    expect([hiredOn(HIRED, "2026-07-27"), hiredOn(HIRED, "2026-08-14"), hiredOn(HIRED, "2026-07-26"), hiredOn(BLUE_VAN, "2030-01-01")]).toEqual([true, true, false, true]);
  });

  it("refuses a vehicle another crew has, and one out of its hire days, before anything is sent", () => {
    expect(refusalOf(SAMPLE, 3, BLUE, "2026-08-05")).toEqual({ kind: "with", vehicleId: 3, crewId: RED });
    expect(refusalOf(SAMPLE, 3, RED, "2026-08-17")).toEqual({ kind: "hiredTo", vehicleId: 3, to: "2026-08-14" });
    expect(refusalOf(SAMPLE, 3, RED, "2026-07-24")).toEqual({ kind: "hiredFrom", vehicleId: 3, from: "2026-07-27" });
    expect(refusalOf(SAMPLE, 2, BLUE, "2026-08-05")).toBeNull();
  });

  it("holds nothing by a row whose crew has no visit left that day: it is taken away before the vehicle is used", () => {
    const left = facts([row(9, RED, "2026-08-06", 1)], []);
    expect(holderOf(left, 1, "2026-08-06", BLUE)).toBeNull();
    expect(staleOf(left, 1, "2026-08-06", BLUE)?.id).toBe(9);
    expect(refusalOf(left, 1, BLUE, "2026-08-06")).toBeNull();
  });

  it("defaults a crew's day to its row's vehicle, else to its own (CD-8, CD-9)", () => {
    expect(defaultVehicle(SAMPLE, RED, "2026-08-05")).toBe(3);
    expect(defaultVehicle(SAMPLE, RED, "2026-08-06")).toBe(2);
    expect(defaultVehicle(SAMPLE, null, "2026-08-06")).toBeNull();
  });

  it("counts the days past a vehicle's service on the office's today (CD-11)", () => {
    expect(serviceOver(RED_VAN, "2026-07-28")).toBe(8);
    expect(serviceOver(BLUE_VAN, "2026-07-28")).toBe(0);
    expect(serviceOver(HIRED, "2026-07-28")).toBe(0);
  });
});
