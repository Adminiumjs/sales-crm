import { describe, expect, it } from "vitest";

import { newsletterLine, saidNo, type ConsentEvent, type ConsentPanel } from "./consent.ts";
import type { StaffSession } from "../staffSession.ts";

const AT = Date.parse("2026-07-20T09:00:00Z");
const event = (state: ConsentEvent["state"], source: ConsentEvent["source"], more: Partial<ConsentEvent> = {}): ConsentEvent => ({ state, source, detail: null, staff: null, at: AT, ...more });
const panel = (state: "yes" | "no" | "not-asked", one: ConsentEvent | null): Pick<ConsentPanel, "purposes"> => ({ purposes: [{ purpose: "newsletter", state, event: one }, { purpose: "surveys", state: "not-asked", event: null }] });

describe("what the contact sheet says of the newsletter, read from the consent log", () => {
  it("names the colleague who ticked it, and when", () => {
    expect(newsletterLine(panel("yes", event("yes", "staff", { staff: { id: "u1", label: "Dana Reyes" } })), true)).toEqual({ kind: "since", at: AT, by: "Dana Reyes" });
  });

  it("says a yes from before records were kept is one, the switch on with no event, or one the send's review confirmed as that", () => {
    expect(newsletterLine(panel("not-asked", null), true)).toEqual({ kind: "before" });
    expect(newsletterLine(panel("yes", event("yes", "review", { detail: "before-records", staff: { id: "u1", label: "Mia" } })), true)).toEqual({ kind: "before" });
    expect(newsletterLine(panel("yes", null), true)).toEqual({ kind: "before" });
  });

  it("dates a yes that came in another way (a form, an import) without a name", () => {
    expect(newsletterLine(panel("yes", event("yes", "import")), true)).toEqual({ kind: "sinceAt", at: AT });
  });

  it("names an unsubscribe, by the link or by the mail service, and a no at the send's review, each with its day", () => {
    expect(newsletterLine(panel("no", event("no", "unsubscribe")), false)).toEqual({ kind: "unsubscribed", at: AT });
    expect(newsletterLine(panel("no", event("no", "relay")), false)).toEqual({ kind: "unsubscribed", at: AT });
    expect(newsletterLine(panel("no", event("no", "review")), false)).toEqual({ kind: "review", at: AT });
  });

  it("says a plain no otherwise, and for somebody never asked whose switch is off", () => {
    expect(newsletterLine(panel("no", event("no", "staff")), false)).toEqual({ kind: "no" });
    expect(newsletterLine(panel("not-asked", null), false)).toEqual({ kind: "no" });
    // Another person's event on the same address is never shown: the state still is.
    expect(newsletterLine(panel("no", null), false)).toEqual({ kind: "no" });
  });
});

describe("\"They said no\"", () => {
  it("asks the server to put the record's address on the do-not-email list, naming the row as the record pages do", async () => {
    const calls: unknown[][] = [];
    const session = {
      connectionId: "conn_1",
      tableId: (ref: string) => `public.crm_${ref}`,
      call: async (...args: unknown[]) => {
        calls.push(args);
        return { data: { added: true, stopped: { since: AT, reason: "hand", origin: null } } };
      },
    } as unknown as StaffSession;
    expect(await saidNo(session, "contacts", 42)).toEqual({ added: true, since: AT });
    expect(calls).toEqual([["POST", "/consent/said-no", { connectionId: "conn_1", table: "public.crm_contacts", recordId: "42" }]]);
  });
});
