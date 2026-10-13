import { describe, expect, it } from "vitest";

import { formatters } from "../../lib/format.ts";
import { StaffError, type HistoryEntry, type Saved, type StaffSession } from "../../staffSession.ts";
import { cancelVisit, lastMove, overlaps, spanOf, startOfToday, toneOf } from "./data.ts";

const f = formatters({ locale: "en-US", currency: "GBP", timeZone: "Europe/London" });
// The ledger's clock: Tuesday 28 July 2026, 09:35 in London (08:35 UTC).
const NOW = new Date("2026-07-28T08:35:00Z");

describe("what a visit is, by the business's clock", () => {
  it("counts today's visit as still to come, whatever the hour", () => {
    expect(toneOf({ starts_at: "2026-07-28T13:00:00Z", written: 0 }, NOW, f)).toBe("today");
    expect(toneOf({ starts_at: "2026-07-28T06:00:00Z", written: 0 }, NOW, f)).toBe("today");
    expect(toneOf({ starts_at: "2026-07-29T09:30:00Z", written: 0 }, NOW, f)).toBe("soon");
  });

  it("tells a visit that has been from its write-up, not from a mark", () => {
    expect(toneOf({ starts_at: "2026-07-23T09:00:00Z", written: 1 }, NOW, f)).toBe("done");
    expect(toneOf({ starts_at: "2026-07-16T08:30:00Z", written: 0 }, NOW, f)).toBe("unwritten");
    expect(toneOf({ starts_at: "2026-07-16T08:30:00Z", written: "0" }, NOW, f)).toBe("unwritten");
    expect(toneOf({ starts_at: "2026-07-16T08:30:00Z", written: null }, NOW, f)).toBe("unwritten");
  });

  it("starts the day where the business is: midnight in London is 23:00 UTC the day before, in July", () => {
    expect(startOfToday(NOW, f).toISOString()).toBe("2026-07-27T23:00:00.000Z");
    // A visit at half past midnight in London is today's there, though yesterday's in UTC.
    expect(toneOf({ starts_at: "2026-07-27T23:30:00Z", written: 0 }, NOW, f)).toBe("today");
  });

  it("writes a span on the business's clock", () => {
    expect(spanOf({ starts_at: "2026-07-29T09:30:00Z", minutes: 90 }, f)).toBe("10:30–12:00");
  });
});

describe("two visits at once", () => {
  const at = (time: string, minutes: number) => ({ starts_at: `2026-07-29T${time}:00Z`, minutes });
  it("overlap when either starts before the other ends", () => {
    expect(overlaps(at("09:00", 60), at("09:30", 90))).toBe(true);
    expect(overlaps(at("09:30", 90), at("09:00", 60))).toBe(true);
    expect(overlaps(at("09:00", 120), at("09:30", 30))).toBe(true);
  });
  it("do not when one ends as the other starts", () => {
    expect(overlaps(at("09:00", 30), at("09:30", 90))).toBe(false);
    expect(overlaps(at("11:00", 30), at("09:30", 90))).toBe(false);
  });
});

const entry = (createdAt: unknown, actorLabel: string | null, changes: HistoryEntry["changes"]): HistoryEntry => ({ id: "a", createdAt: createdAt as string, actorKind: "user", actorLabel, action: "record.update", changes });

describe("a move's old day, who and when, from the record's history", () => {
  const session = (entries: HistoryEntry[]): StaffSession => ({ history: () => Promise.resolve({ entries, next: null }) }) as unknown as StaffSession;

  it("takes the newest change of the start, with the time it had", async () => {
    const moved = await lastMove(
      session([
        entry(Date.parse("2026-07-28T08:40:00Z"), "Dana Whitlock", { before: { note: null }, after: { note: "x" } } as never),
        entry(Date.parse("2026-07-28T08:36:00Z"), "Ivy Sandoval", { before: { starts_at: "2026-07-29T07:30:00.000Z", minutes: 60 }, after: { starts_at: "2026-07-30T14:15:00.000Z", minutes: 90 } } as never),
        entry(Date.parse("2026-07-27T10:00:00Z"), "Dana Whitlock", { before: { starts_at: "2026-07-28T07:30:00.000Z" }, after: { starts_at: "2026-07-29T07:30:00.000Z" } } as never),
      ]),
      7,
    );
    expect(moved).toEqual({ was: new Date("2026-07-29T07:30:00.000Z"), minutes: 60, by: "Ivy Sandoval", at: new Date("2026-07-28T08:36:00Z") });
  });

  it("reads a moment written as text, and answers nothing for a visit never moved", async () => {
    const moved = await lastMove(session([entry("2026-07-28T08:36:00Z", null, { before: { starts_at: "2026-07-29 07:30:00+00" }, after: { starts_at: "2026-07-30T14:15:00Z" } } as never)]), 7);
    expect(moved?.at.toISOString()).toBe("2026-07-28T08:36:00.000Z");
    expect(moved?.by).toBeNull();
    expect(await lastMove(session([entry(1, "Dana", { after: { starts_at: "2026-07-30T14:15:00Z" } } as never), entry(2, "Dana", null)]), 7)).toBeNull();
    // The same moment written two ways is no move.
    expect(await lastMove(session([entry(1, "Dana", { before: { starts_at: "2026-07-30 14:15:00+00" }, after: { starts_at: "2026-07-30T14:15:00.000Z" } } as never)]), 7)).toBeNull();
  });
});

describe("a cancel: the why, then the row is removed", () => {
  const saved: Saved = { state: "saved", row: {}, replayed: false, readBack: false };
  const fake = (over: Partial<Record<"update" | "remove" | "get", (...args: unknown[]) => unknown>>, calls: string[]): StaffSession =>
    ({
      update: (...args: unknown[]) => (calls.push(`update ${JSON.stringify(args.slice(1))}`), over.update?.(...args) ?? Promise.resolve(saved)),
      remove: (...args: unknown[]) => (calls.push(`remove ${JSON.stringify(args.slice(1))}`), over.remove?.(...args) ?? Promise.resolve(saved)),
      get: (...args: unknown[]) => over.get?.(...args) ?? Promise.resolve(null),
    }) as unknown as StaffSession;

  it("writes the reason on a visit still booked, and only then removes it", async () => {
    const calls: string[] = [];
    expect((await cancelVisit(fake({}, calls), { id: 12 }, "Petra is off sick")).state).toBe("saved");
    expect(calls).toEqual(['update [12,{"cancel_reason":"Petra is off sick"},{"seen":{"state":"booked"}}]', "remove [12]"]);
  });

  it("removes nothing when the reason was refused", async () => {
    const calls: string[] = [];
    const refused: Saved = { state: "refused", error: new StaffError(403, "FORBIDDEN", "no") };
    const answer = await cancelVisit(fake({ update: () => Promise.resolve(refused), get: () => Promise.resolve({ id: 12 }) }, calls), { id: 12 }, "why");
    expect(answer.state).toBe("refused");
    expect(calls.filter((call) => call.startsWith("remove"))).toEqual([]);
  });

  it("says cancelled once when the visit is already gone", async () => {
    const calls: string[] = [];
    const gone: Saved = { state: "refused", error: new StaffError(404, "NOT_FOUND", "gone") };
    const answer = await cancelVisit(fake({ update: () => Promise.resolve(gone) }, calls), { id: 12 }, "why");
    expect(answer.state).toBe("saved");
    expect(calls.filter((call) => call.startsWith("remove"))).toEqual([]);
  });

  it("does not say cancelled when nothing could be confirmed", async () => {
    const answer = await cancelVisit(fake({ remove: () => Promise.resolve({ state: "unknown" }) }, []), { id: 12 }, "why");
    expect(answer.state).toBe("unknown");
  });
});
