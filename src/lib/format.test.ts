import { describe, expect, it } from "vitest";

import { formatters, monthOf, weekOf } from "./format.ts";

const LONDON = { locale: "en-GB", currency: "GBP", timeZone: "Europe/London" };
const at = (iso: string) => new Date(iso);

describe("money", () => {
  it("is the install's currency in the reader's language, with decimals only when there are some", () => {
    const f = formatters(LONDON);
    expect([f.money(143400), f.money("95740.00"), f.money(1250.5)]).toEqual(["£143,400", "£95,740", "£1,250.50"]);
    expect(formatters({ ...LONDON, locale: "de-DE", currency: "EUR" }).money(143400)).toBe("143.400 €");
    expect(formatters({ ...LONDON, locale: "ar-EG", currency: "EGP" }).money(1250)).toContain("ج.م");
  });

  it("is a plain number when the install has no currency: no sign is made up", () => {
    expect(formatters({ ...LONDON, currency: null }).money(143400)).toBe("143,400");
  });

  it("reads anything that is not a number as nothing", () => {
    expect(formatters(LONDON).money(null)).toBe("£0");
  });
});

describe("a moment, where the business is", () => {
  const f = formatters(LONDON);
  it("writes the day and the time of the business's zone, on the 24-hour clock", () => {
    // 15:00 UTC in July is 16:00 in London.
    expect([f.dayLong(at("2026-07-28T08:35:00Z")), f.dayShort(at("2026-07-24T15:00:00Z")), f.time(at("2026-07-24T15:00:00Z"))]).toEqual(["Tuesday, 28 July 2026", "Fri 24 Jul", "16:00"]);
  });

  it("puts a moment late at night on the business's day, not the reader's", () => {
    // 23:30 UTC on the 27th is already the 28th in London.
    expect(f.dayKey(at("2026-07-27T23:30:00Z"))).toBe("2026-07-28");
    expect(formatters({ ...LONDON, timeZone: "America/New_York" }).dayKey(at("2026-07-27T23:30:00Z"))).toBe("2026-07-27");
  });

  it("counts whole days by the calendar: four days back is -4 whatever the hours", () => {
    expect(f.dayDiff(at("2026-07-28T08:35:00Z"), at("2026-07-24T15:00:00Z"))).toBe(-4);
    expect(f.dayDiff(at("2026-07-28T08:35:00Z"), at("2026-07-28T22:00:00Z"))).toBe(0);
    expect(f.dayDiff(at("2026-07-28T08:35:00Z"), at("2026-07-29T00:30:00Z"))).toBe(1);
  });

  it("says the hour of the business's day", () => {
    expect(f.hour(at("2026-07-28T08:35:00Z"))).toBe(9);
  });

  it("keeps working with a zone the browser does not know", () => {
    expect(formatters({ ...LONDON, timeZone: "Mars/Olympus" }).dayKey(at("2026-07-28T12:00:00Z"))).toMatch(/^2026-07-2[78]$/);
  });
});

describe("the month and the week a day is in", () => {
  it("names the month's first and last day", () => {
    expect(monthOf("2026-07-28")).toEqual(["2026-07-01", "2026-07-31"]);
    expect(monthOf("2028-02-10")).toEqual(["2028-02-01", "2028-02-29"]);
  });

  it("starts the week on its Monday, and ends it before the next", () => {
    expect(weekOf("2026-07-28")).toEqual(["2026-07-27", "2026-08-03"]);
    expect(weekOf("2026-08-02")).toEqual(["2026-07-27", "2026-08-03"]);
    expect(weekOf("2026-07-27")).toEqual(["2026-07-27", "2026-08-03"]);
  });
});

describe("what a person types as an amount", () => {
  it("is read the way their language writes a number", () => {
    expect([formatters(LONDON).readAmount("18,000.50"), formatters(LONDON).readAmount("£ 18000"), formatters(LONDON).readAmount("0.5")]).toEqual([18000.5, 18000, 0.5]);
    const german = formatters({ ...LONDON, locale: "de-DE", currency: "EUR" });
    expect([german.readAmount("18.000,50"), german.readAmount("18000")]).toEqual([18000.5, 18000]);
    expect(formatters({ ...LONDON, locale: "fr-FR" }).readAmount("18\u202f000,5")).toBe(18000.5);
    expect(formatters({ ...LONDON, locale: "ar-EG" }).readAmount("١٨٬٠٠٠٫٥")).toBe(18000.5);
  });

  it("is nothing when it is not a number above nothing", () => {
    const f = formatters(LONDON);
    expect([f.readAmount(""), f.readAmount("about ten"), f.readAmount("0"), f.readAmount("1.2.3")]).toEqual([null, null, null, null]);
  });
});

describe("a day and a time where the business is, as a moment", () => {
  it("is that clock's moment in summer and in winter, and on a day the clocks change", () => {
    const f = formatters(LONDON);
    expect([f.at("2026-07-30", "10:00").toISOString(), f.at("2026-12-01", "10:00").toISOString()]).toEqual(["2026-07-30T09:00:00.000Z", "2026-12-01T10:00:00.000Z"]);
    // The clocks go back on 25 October 2026: 10:00 that day is 10:00 UTC.
    expect(f.at("2026-10-25", "10:00").toISOString()).toBe("2026-10-25T10:00:00.000Z");
    expect(formatters({ ...LONDON, timeZone: "Asia/Kolkata" }).at("2026-07-30", "10:00").toISOString()).toBe("2026-07-30T04:30:00.000Z");
  });

  it("writes a day with its year, and a share as a percentage", () => {
    const f = formatters(LONDON);
    expect([f.date(at("2026-05-12T11:00:00Z")), f.percent(3 / 8)]).toEqual(["12 May 2026", "38%"]);
  });
});
