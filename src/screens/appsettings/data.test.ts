/** Settings: the few things the screen works out, and the lists it keeps that must agree with the manifest. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { inMenu } from "../../shell/routes.ts";
import { workingDays } from "../teamwork/cover.ts";
import { BOUNDS, DAYS, dayOfKey, hoursBetween, isTime, MANAGER_WRITES, placeOf, readNumber, SETTINGS_COLUMNS, weekFrom, workDaysOf, workingDaysBetween, type Day } from "./data.ts";
import { PARTS } from "./Tabs.tsx";

interface Column {
  ref: string;
  default?: unknown;
  rules?: { validation?: { min?: number; max?: number } };
}
interface Doc {
  requiredSchema: { tables: { ref: string; columns: Column[] }[] };
  roles: { key: string; modules: string[]; limits?: Record<string, { writable?: string[] }> }[];
  modules: { id: string }[];
}
const read = (path: string): Doc => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8")) as Doc;
const whole = read("whole/manifest.json");
const released = read("manifest.json");
const settings = (doc: Doc): Column[] => doc.requiredSchema.tables.find((table) => table.ref === "settings")!.columns;

describe("what the screen keeps that the manifest decides", () => {
  it("lists the sales manager's columns as the manifest does", () => {
    for (const doc of [whole, released]) expect([...MANAGER_WRITES].sort()).toEqual([...doc.roles.find((role) => role.key === "sales-manager")!.limits!["settings"]!.writable!].sort());
  });

  it("holds each number between the bounds the server holds it between", () => {
    const bounded = Object.fromEntries(
      settings(whole)
        .filter((column) => column.rules?.validation?.min !== undefined)
        .map((column) => [column.ref, [column.rules!.validation!.min, column.rules!.validation!.max]]),
    );
    expect(BOUNDS).toEqual(bounded);
  });

  it("reads only columns the released settings row has", () => {
    const refs = settings(released).map((column) => column.ref);
    expect(SETTINGS_COLUMNS.filter((column) => !refs.includes(column))).toEqual([]);
  });

  it("starts the working week as Monday to Friday, 08:30 to 17:30", () => {
    const column = (ref: string): unknown => settings(whole).find((one) => one.ref === ref)!.default;
    expect(DAYS.map((day) => column(`work_${day}`))).toEqual([true, true, true, true, true, false, false]);
    expect([column("work_from"), column("work_to")]).toEqual(["08:30", "17:30"]);
  });

  it("names the roles each released part brings as the manifest does", () => {
    expect(PARTS.map((part) => part.id)).toEqual(released.modules.map((part) => part.id));
    for (const part of PARTS) {
      const brings = released.roles.filter((role) => role.modules.includes(part.id)).map((role) => role.key);
      expect([...part.roles].sort(), part.id).toEqual(brings.sort());
    }
  });

  it("is in the menu of the CRM admin, the sales manager and Read-only, and of nobody else", () => {
    for (const role of ["crm-admin", "crm-sales-manager", "crm-read-only"]) expect(inMenu("appsettings", [role]), role).toBe(true);
    // The install's owner holds none of the app's roles and is read as the CRM admin.
    expect(inMenu("appsettings", [])).toBe(true);
    for (const role of ["crm-rep", "crm-account-manager", "crm-marketer", "crm-front-desk", "crm-ops-manager", "crm-crew"]) expect(inMenu("appsettings", [role]), role).toBe(false);
  });
});

describe("the working week", () => {
  const week = (...days: Day[]): Set<Day> => new Set(days);
  it("is Monday to Friday when the row says nothing, or names no day", () => {
    expect([...workDaysOf(null)]).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect([...workDaysOf({ id: 1 })]).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect([...workDaysOf(Object.fromEntries(DAYS.map((day) => [`work_${day}`, false])))]).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });
  it("reads the days as each engine answers a yes", () => {
    expect([...workDaysOf({ work_mon: 1, work_tue: 0, work_wed: true, work_thu: false, work_fri: "1", work_sat: 1, work_sun: 0 })]).toEqual(["mon", "wed", "fri", "sat"]);
  });
  it("knows a calendar day's weekday", () => {
    expect([dayOfKey("2026-07-28"), dayOfKey("2026-08-01"), dayOfKey("2026-08-02"), dayOfKey("2026-08-03")]).toEqual(["tue", "sat", "sun", "mon"]);
  });
  it("counts the sample's cover as 10 working days on the usual week, and by the setting when it changes", () => {
    // Priya covers Dana from Mon 10 Aug to Fri 21 Aug 2026 (the ledger's cover).
    expect(workingDaysBetween("2026-08-10", "2026-08-21", workDaysOf(null))).toBe(10);
    expect(workingDays("2026-08-10", "2026-08-21")).toBe(10);
    expect(workingDays("2026-08-10", "2026-08-21", week("mon", "tue", "wed", "thu", "fri", "sat"))).toBe(11);
    expect(workingDays("2026-08-10", "2026-08-21", week("sun", "mon", "tue", "wed", "thu"))).toBe(9);
    expect(workingDays("2026-08-15", "2026-08-16")).toBe(0);
    expect(workingDays("2026-08-21", "2026-08-10")).toBe(0);
  });
  it("orders a week from its first day", () => {
    expect(weekFrom("mon")).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    expect(weekFrom("sun")).toEqual(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
    expect(weekFrom("sat")[0]).toBe("sat");
  });
  it("works out a day's hours, and refuses a day that ends before it starts", () => {
    expect(hoursBetween("08:30", "17:30")).toBe(9);
    expect(hoursBetween("09:00", "12:30")).toBe(3.5);
    expect(hoursBetween("17:30", "08:30")).toBeNull();
    expect(hoursBetween("09:00", "09:00")).toBeNull();
    expect([isTime("08:30"), isTime("8:30"), isTime("24:00"), isTime("23:59"), isTime("")]).toEqual([true, false, false, true, false]);
  });
});

describe("what a field holds", () => {
  it("reads a number between its bounds and nothing else", () => {
    expect(readNumber("21", [7, 45], true)).toBe(21);
    expect(readNumber(" 7 ", [7, 45], true)).toBe(7);
    expect(readNumber("6", [7, 45], true)).toBeNull();
    expect(readNumber("46", [7, 45], true)).toBeNull();
    expect(readNumber("7.5", [0, 50], true)).toBeNull();
    expect(readNumber("7.5", [0, 50], false)).toBe(7.5);
    expect(readNumber("7,5", [0, 50], false)).toBe(7.5);
    for (const text of ["", "abc", "-3", "1e2", "5 days"]) expect(readNumber(text, [0, 50], false), text).toBeNull();
  });
  it("reads a place as each engine answers it", () => {
    expect(placeOf({ lat: 53.79648, lng: -1.54785, by: "town", name: "Leeds" })).toEqual({ lat: 53.79648, lng: -1.54785, by: "town", name: "Leeds" });
    expect(placeOf('{"lat":53.79,"lng":-1.55,"by":"exact"}')).toEqual({ lat: 53.79, lng: -1.55, by: "exact" });
    for (const value of [null, undefined, "", "Leeds", { lat: "north", lng: 1 }, 7]) expect(placeOf(value)).toBeNull();
  });
});
