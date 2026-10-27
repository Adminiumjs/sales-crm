import { describe, expect, it } from "vitest";

import { newsletterLine, saidNo, type ConsentEvent, type ConsentPanel } from "./consent.ts";
import type { StaffSession } from "../staffSession.ts";

const AT = Date.parse("2026-07-20T09:00:00Z");
const event = (state: ConsentEvent["state"], source: ConsentEvent["source"], more: Partial<ConsentEvent> = {}): ConsentEvent => ({ state, source, detail: null, staff: null, at: AT, ...more });
const panel = (state: "yes" | "no" | "not-asked", one: ConsentEvent | null): Pick<ConsentPanel, "purposes"> => ({ purposes: [{ purpose: "newsletter", state, event: one }, { purpose: "surveys", state: "not-asked", event: null }] });

describe("what the contact sheet says of the newsletter, read from the consent log", () => {
  it("names the colleague who ticked it, and when", () => {
    expect(newsletterLine(panel("yes", event("yes", "staff", { staff: { id: "u1", label: "Dana Reyes" } })))).toEqual({ kind: "since", at: AT, by: "Dana Reyes" });
  });

  it("says a yes the send's review confirmed as one from before records were kept is that", () => {
    expect(newsletterLine(panel("yes", event("yes", "review", { detail: "before-records", staff: { id: "u1", label: "Mia" } })))).toEqual({ kind: "before" });
  });

  it("says nothing when the log has heard nothing of the person: the row's own stamps speak, as before the log", () => {
    expect(newsletterLine(panel("not-asked", null))).toBeNull();
    // Nor is a yes another row of the same address gave shown as this one's.
    expect(newsletterLine(panel("yes", null))).toBeNull();
  });

  it("dates a yes that came in another way (a form, an import) without a name", () => {
    expect(newsletterLine(panel("yes", event("yes", "import")))).toEqual({ kind: "sinceAt", at: AT });
  });

  it("names an unsubscribe, by the link or by the mail service, and a no at the send's review, each with its day", () => {
    expect(newsletterLine(panel("no", event("no", "unsubscribe")))).toEqual({ kind: "unsubscribed", at: AT });
    expect(newsletterLine(panel("no", event("no", "relay")))).toEqual({ kind: "unsubscribed", at: AT });
    expect(newsletterLine(panel("no", event("no", "review")))).toEqual({ kind: "review", at: AT });
  });

  it("says a plain no otherwise", () => {
    expect(newsletterLine(panel("no", event("no", "staff")))).toEqual({ kind: "no" });
    // Another person's event on the same address is never shown: the state still is.
    expect(newsletterLine(panel("no", null))).toEqual({ kind: "no" });
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
