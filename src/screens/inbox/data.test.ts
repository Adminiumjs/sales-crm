import { describe, expect, it } from "vitest";

import { formatters } from "../../lib/format.ts";
import { byWorkOrder, inInboxFilter, inboxOf, isLead, leadAge, leadState, NOT_LEAD, type Enquiry } from "./data.ts";
import { mayPaste } from "./Leads.tsx";
import { tileOf } from "./parts.tsx";

const f = formatters({ locale: "en-US", currency: "GBP", timeZone: "Europe/London" });
const NOW = new Date("2026-07-28T08:35:00.000Z");
const row = (over: Partial<Enquiry>): Enquiry => ({ id: 1, source: "show", company_name: "Co", person: null, email: null, phone: null, text: null, est_value: null, town: null, wants: null, warmth: null, show_id: null, company_id: null, received_at: "2026-07-16T10:00:00.000Z", state: "open", claimed_by_id: null, passed_to_id: null, rung_at: null, deal_id: null, company: null, ...over });

describe("one table, two screens", () => {
  it("calls an enquiry a trade-show lead when it names its show and how keen the person was", () => {
    expect(isLead(row({ show_id: 1, warmth: "hot" }))).toBe(true);
    // Somebody who wrote in after a show: a show, and nobody scored them on the stand.
    expect(isLead(row({ show_id: 1 }))).toBe(false);
    expect(isLead(row({ warmth: "warm" }))).toBe(false);
  });
  it("puts in a person's Team inbox what was never scanned, and whatever is hers", () => {
    expect(inboxOf("")).toEqual(NOT_LEAD);
    // One flat "or": the server reads a `where` three levels deep at most.
    expect(inboxOf("usr_1")).toEqual({ or: [{ column: "show_id", op: "is_null" }, { column: "warmth", op: "is_null" }, { column: "claimed_by_id", op: "eq", value: "usr_1" }, { column: "passed_to_id", op: "eq", value: "usr_1" }] });
  });
  it("narrows the list she was answered to unclaimed, hers, or everything", () => {
    const open = row({});
    const hers = row({ state: "passed", passed_to_id: "usr_1" });
    const claimed = row({ state: "claimed", claimed_by_id: "usr_1" });
    const theirs = row({ state: "passed", passed_to_id: "usr_2" });
    expect([open, hers, claimed, theirs].map((one) => inInboxFilter(one, "open", "usr_1"))).toEqual([true, false, false, false]);
    expect([open, hers, claimed, theirs].map((one) => inInboxFilter(one, "mine", "usr_1"))).toEqual([false, true, true, false]);
    expect([open, hers, claimed, theirs].every((one) => inInboxFilter(one, "all", "usr_1"))).toBe(true);
  });
});

describe("what a lead has come to", () => {
  it("reads it from the lead's own columns: a deal wins, then dropped, then rung", () => {
    expect(leadState(row({ state: "passed" }))).toBe("new");
    expect(leadState(row({ state: "passed", rung_at: "2026-07-17T09:00:00Z" }))).toBe("called");
    expect(leadState(row({ state: "dropped", rung_at: "2026-07-17T09:00:00Z" }))).toBe("no");
    expect(leadState(row({ state: "claimed", deal_id: 9, rung_at: "2026-07-17T09:00:00Z" }))).toBe("deal");
  });
  it("orders them to work in: still to ring first, the keenest first among those", () => {
    const rows = [row({ id: 1, state: "dropped" }), row({ id: 2, rung_at: "2026-07-17T09:00:00Z", warmth: "hot" }), row({ id: 3, warmth: "warm" }), row({ id: 4, warmth: "hot" }), row({ id: 5, warmth: "hot", received_at: "2026-07-15T10:00:00.000Z" })];
    expect([...rows].sort(byWorkOrder).map((one) => one.id)).toEqual([5, 4, 3, 2, 1]);
  });
  it("counts the days since the scan by the business's calendar, and what is left before it goes cold", () => {
    expect(leadAge(row({ received_at: "2026-07-16T10:00:00.000Z" }), NOW, f, 14)).toEqual({ days: 12, left: 2 });
    expect(leadAge(row({ received_at: "2026-07-10T10:00:00.000Z" }), NOW, f, 14)).toEqual({ days: 18, left: -4 });
    // Scanned a minute before midnight in London, the day before.
    expect(leadAge(row({ received_at: "2026-07-27T22:59:00.000Z" }), NOW, f, 14).days).toBe(1);
  });
});

describe("small things", () => {
  it("offers the pasted list to the marketer, the CRM admin and whoever runs the install", () => {
    expect(mayPaste([{ slug: "crm-marketer" }])).toBe(true);
    expect(mayPaste([{ slug: "crm-admin" }])).toBe(true);
    expect(mayPaste([])).toBe(true);
    expect(mayPaste([{ slug: "crm-rep" }, { slug: "crm-sales-manager" }])).toBe(false);
    expect(mayPaste([{ slug: "crm-read-only" }])).toBe(false);
  });
  it("makes a tile of two letters from a company's name", () => {
    expect(tileOf("Slate & Barrow")).toBe("SB");
    expect(tileOf("Verity Insurance Group")).toBe("VI");
    expect(tileOf("Æther")).toBe("Æ");
  });
});
