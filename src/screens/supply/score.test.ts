/**
 * The supplier score, as the ledger works it (screen 60): the six suppliers' deliveries, late ones, claims and weeks
 * over give its scores and bands to the point.
 */
import { describe, expect, it } from "vitest";

import { bandOf, onTimeTenths, scoreOf, weeksOver } from "./score.ts";

describe("a supplier's score", () => {
  it("is the ledger's for its six suppliers", () => {
    // name, deliveries, late, the late ones' average days late, claims → on time, score, band
    const LEDGER: [string, number, number, number | null, number, string, number, string][] = [
      ["Marchmont Joinery", 6, 0, null, 0, "100.0", 100, "solid"],
      ["Halvard Werke", 28, 1, 2, 0, "96.4", 96, "solid"],
      ["Kirkwall Steel", 19, 2, 2, 1, "89.5", 84, "watch"],
      ["Trellis Textiles", 22, 2, 7, 1, "90.9", 78, "watch"],
      ["Ostrom Seating", 34, 5, 7, 2, "85.3", 66, "problem"],
      ["Fenlow Acoustics", 14, 8, 21, 1, "42.9", 16, "problem"],
    ];
    for (const [name, n, late, avgLate, claims, on, score, band] of LEDGER) {
      const got = scoreOf({ n, late, avgLate, claims })!;
      expect([(got.onTenths / 10).toFixed(1), got.score, got.band], name).toEqual([on, score, band]);
    }
    // All of them: 105 of 123.
    expect(onTimeTenths(123, 18)).toBe(854);
  });

  it("rounds a half up, in tenths, never in floating point", () => {
    // 89.47 % is 89.5, and 89.5 − 6 is 83.5, which is 84 (worked in floating point from 89.47 it would be 83).
    expect(onTimeTenths(19, 2)).toBe(895);
    expect(scoreOf({ n: 19, late: 2, avgLate: 2, claims: 1 })?.score).toBe(84);
    expect([weeksOver(3.5), weeksOver(3.49), weeksOver(null), weeksOver(10.5)]).toEqual([1, 0, 0, 2]);
  });

  it("is held to 0 and 100, and there is none with no delivery to judge", () => {
    expect(scoreOf({ n: 4, late: 4, avgLate: 40, claims: 3 })).toEqual({ onTenths: 0, weeksOver: 6, score: 0, band: "problem" });
    expect(scoreOf({ n: 0, late: 0, avgLate: null, claims: 2 })).toBeNull();
    expect([bandOf(88), bandOf(87), bandOf(75), bandOf(74)]).toEqual(["solid", "watch", "watch", "problem"]);
  });
});
