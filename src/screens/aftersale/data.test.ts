import { describe, expect, it } from "vitest";

import { StaffError, type Saved, type StaffSession } from "../../staffSession.ts";
import { addMonths, byCompany, daysBetween, laterOrders, referralState, reorderState, sayThanks, yearBack, type WonDeal } from "./data.ts";

describe("days", () => {
  it("adds months as the ledger does: the last won day plus the rep's months", () => {
    expect(addMonths("2026-04-28", 3)).toBe("2026-07-28");
    expect(addMonths("2026-03-26", 4)).toBe("2026-07-26");
    expect(addMonths("2026-04-09", 4)).toBe("2026-08-09");
    expect(addMonths("2026-06-12", 9)).toBe("2027-03-12");
    expect(addMonths("2026-06-03", 7)).toBe("2027-01-03");
    expect(addMonths("2025-12-05", 8)).toBe("2026-08-05");
  });

  it("lands on the last day of a month that has no such day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
  });

  it("goes a year back for the last twelve months", () => {
    expect(yearBack("2026-07-28")).toBe("2025-07-28");
    expect(yearBack("2024-02-29")).toBe("2023-02-28");
  });

  it("counts whole days between two days", () => {
    expect(daysBetween("2025-10-20", "2026-04-28")).toBe(190);
    expect(daysBetween("2026-07-28", "2026-07-26")).toBe(-2);
  });

  it("says where a reorder stands today", () => {
    const today = "2026-07-28";
    expect(reorderState("2026-07-28", today)).toBe("now");
    expect(reorderState("2026-07-26", today)).toBe("now");
    expect(reorderState("2026-08-05", today)).toBe("soon");
    expect(reorderState("2026-08-09", today)).toBe("soon");
    expect(reorderState("2026-08-28", today)).toBe("soon");
    expect(reorderState("2026-08-29", today)).toBe("later");
    expect(reorderState("2027-03-12", today)).toBe("later");
    expect(reorderState(null, today)).toBe("unknown");
  });
});

describe("won deals by company", () => {
  const deals: WonDeal[] = [
    { id: 4, name: "h1", companyId: 1, amount: 19500, closedOn: "2026-04-28" },
    { id: 2, name: "w1", companyId: 1, amount: 17400, closedOn: "2025-10-20" },
    { id: 7, name: "h3", companyId: 2, amount: 26400, closedOn: "2026-03-26" },
    { id: 9, name: "x", companyId: 1, amount: 100, closedOn: null },
  ];

  it("lists each company's oldest first, a deal with no day last", () => {
    expect(byCompany(deals).get(1)!.map((deal) => deal.name)).toEqual(["w1", "h1", "x"]);
    expect(byCompany(deals).get(2)!.map((deal) => deal.name)).toEqual(["h3"]);
  });

  it("names every order that was not a company's first", () => {
    expect(laterOrders(deals)).toEqual([4, 9]);
    expect(laterOrders(deals.filter((deal) => deal.companyId === 2))).toEqual([]);
  });
});

describe("what came of an introduction", () => {
  it("is the deal's state where the reader sees it, and never 'none' for a deal that does not arrive", () => {
    expect(referralState(null, null)).toBe("none");
    expect(referralState(5, "won")).toBe("won");
    expect(referralState(5, "open")).toBe("open");
    expect(referralState(5, "lost")).toBe("lost");
    expect(referralState(5, null)).toBe("hidden");
  });
});

describe("say thank you", () => {
  const now = new Date("2026-07-28T08:35:00.000Z");
  const fake = (update: () => Promise<Saved<{ thanked_at: string | null }>>, get: () => Promise<{ thanked_at: string | null } | null>): { session: StaffSession; calls: unknown[][] } => {
    const calls: unknown[][] = [];
    const session = {
      now: () => now,
      update: (...args: unknown[]) => (calls.push(["update", ...args]), update()),
      get: (...args: unknown[]) => (calls.push(["get", ...args]), get()),
    } as unknown as StaffSession;
    return { session, calls };
  };
  const refused = (status: number, code: string): Saved<{ thanked_at: string | null }> => ({ state: "refused", error: new StaffError(status, code, "no") });

  it("keeps the server's moment, and only while nobody has thanked", async () => {
    const { session, calls } = fake(async () => ({ state: "saved", row: { thanked_at: "2026-07-28T08:35:00.000Z" }, replayed: false, readBack: false }), async () => null);
    expect(await sayThanks(session, 3)).toEqual({ state: "thanked", at: "2026-07-28T08:35:00.000Z", mine: true });
    expect(calls).toEqual([["update", "referrals", 3, { thanked_at: "2026-07-28T08:35:00.000Z" }, { seen: { thanked_at: null } }]]);
  });

  it("reads the row back after a lost reply whose second try was refused as changed, and says thanked when it is", async () => {
    // The first send was written and its reply lost; the client's second send found the row changed.
    const { session, calls } = fake(async () => refused(409, "ROW_CHANGED"), async () => ({ thanked_at: "2026-07-28T08:35:00Z" }));
    expect(await sayThanks(session, 3)).toEqual({ state: "thanked", at: "2026-07-28T08:35:00Z", mine: true });
    expect(calls.map((call) => call[0])).toEqual(["update", "get"]);
  });

  it("says a colleague got there first when the moment kept is not this press's", async () => {
    const { session } = fake(async () => refused(409, "ROW_CHANGED"), async () => ({ thanked_at: "2026-07-27T16:00:00Z" }));
    expect(await sayThanks(session, 3)).toEqual({ state: "thanked", at: "2026-07-27T16:00:00Z", mine: false });
  });

  it("hands on a refusal that is not about the row having changed, without reading", async () => {
    const { session, calls } = fake(async () => refused(403, "FORBIDDEN"), async () => null);
    expect(await sayThanks(session, 3)).toMatchObject({ state: "refused" });
    expect(calls.map((call) => call[0])).toEqual(["update"]);
  });

  it("never says saved when nothing certain came back", async () => {
    const lost = fake(async () => ({ state: "unknown" }), async () => ({ thanked_at: null }));
    expect(await sayThanks(lost.session, 3)).toEqual({ state: "unknown" });
    const dark = fake(async () => ({ state: "unknown" }), async () => Promise.reject(new Error("offline")));
    expect(await sayThanks(dark.session, 3)).toEqual({ state: "unknown" });
    const found = fake(async () => ({ state: "unknown" }), async () => ({ thanked_at: "2026-07-28T08:35:00.400Z" }));
    expect(await sayThanks(found.session, 3)).toEqual({ state: "thanked", at: "2026-07-28T08:35:00.400Z", mine: true });
  });

  it("keeps the refusal when the row still reads as not thanked", async () => {
    const { session } = fake(async () => refused(409, "ROW_CHANGED"), async () => ({ thanked_at: null }));
    expect(await sayThanks(session, 3)).toMatchObject({ state: "refused" });
  });
});
