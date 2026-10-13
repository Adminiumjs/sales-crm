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
