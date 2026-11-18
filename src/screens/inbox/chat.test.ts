/**
 * An enquiry from the website chat (the Live chat add-on): "Read the chat"
 * offered only with the add-on and its read, the transcript worded in the
 * reader's language, and an enquiry with no company yet said as such and
 * asked for at claim.
 *
 * What the server answers each role is proved on the whole server, on three
 * engines (`proofs/crm-chat.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { companyProblem } from "../../selling/newDeal.ts";
import type { StaffSession } from "../../staffSession.ts";
import { CHAT_ADD_ON, CHAT_LINES, chatReadable, hasCompany, type Enquiry } from "./data.ts";
import { dealFrom } from "./Inbox.tsx";
import { companyText, firstStepOf, namedOf, subjectOf } from "./parts.tsx";
import { authorOf, CHAT_EVENTS, eventText } from "./ReadChat.tsx";

type Session = Pick<StaffSession, "config" | "can">;
/** A reader: the add-on attached or not, and the reads the server gave. */
const reader = (attached: boolean, reads: string[]): Session =>
  ({
    config: { addOns: attached ? { [CHAT_ADD_ON]: { tables: { conversations: "live_chat_conversations", messages: "live_chat_messages" } } } : {} } as unknown as StaffSession["config"],
    can: (ref: string, action: string) => action === "read" && reads.includes(ref),
  }) as Session;

const t = ((key: string, vars?: Record<string, string>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`)) as unknown as Parameters<typeof eventText>[1];
const row = (over: Partial<Enquiry>): Enquiry => ({ id: 7, source: "chat", company_name: "", person: "Marta Kovac", email: "marta@example.com", phone: null, text: "How many booths fit?", est_value: null, town: null, wants: null, warmth: null, show_id: null, company_id: null, received_at: "2026-11-17T11:05:00.000Z", state: "open", claimed_by_id: null, passed_to_id: null, rung_at: null, deal_id: null, company: null, ...over });

describe('"Read the chat"', () => {
  it("is offered only with Live chat attached and both its conversations and messages readable", () => {
    const both = [`${CHAT_ADD_ON}:conversations`, `${CHAT_ADD_ON}:messages`];
    expect(chatReadable(reader(true, both))).toBe(true);
    // Not attached: no button, whatever a stale grant says.
    expect(chatReadable(reader(false, both))).toBe(false);
    // A role without the read (Read-only, the operations manager): no button.
    expect(chatReadable(reader(true, []))).toBe(false);
    expect(chatReadable(reader(true, [both[0]!]))).toBe(false);
    expect(chatReadable(reader(true, [both[1]!]))).toBe(false);
  });

  it("asks for no more lines than one read of the server's gives (200), else the read is refused", () => {
    expect(CHAT_LINES).toBeLessThanOrEqual(200);
  });

  it("words the chat's own lines in the reader's language, and shows one it does not know as the add-on wrote it", () => {
    for (const event of CHAT_EVENTS) expect(eventText({ event, body: "as written" }, t)).toBe(`inbox.chat.event.${event}`);
    expect(eventText({ event: "something-new", body: "As written" }, t)).toBe("As written");
    expect(eventText({ event: null, body: "No event" }, t)).toBe("No event");
  });

  it("names who wrote each line: the visitor by the enquiry's name, an automatic answer, a colleague by name or as somebody on the team", () => {
    const names = { usr_dana: "Dana Whitlock" };
    expect(authorOf({ kind: "visitor", authorId: null }, "Marta Kovac", names, t)).toBe("Marta Kovac");
    expect(authorOf({ kind: "visitor", authorId: null }, null, names, t)).toBe("inbox.chat.visitor");
    expect(authorOf({ kind: "automatic", authorId: null }, "Marta Kovac", names, t)).toBe("inbox.chat.automatic");
    expect(authorOf({ kind: "staff", authorId: "usr_dana" }, "Marta Kovac", names, t)).toBe("Dana Whitlock");
    expect(authorOf({ kind: "staff", authorId: "usr_gone" }, "Marta Kovac", names, t)).toBe("inbox.chat.staff");
    expect(authorOf({ kind: "staff", authorId: null }, "Marta Kovac", names, t)).toBe("inbox.chat.staff");
  });
});

describe("an enquiry with no company yet", () => {
  it("knows it has none when the name is empty or spaces, and says so instead of a blank", () => {
    expect(hasCompany({ company_name: "" })).toBe(false);
    expect(hasCompany({ company_name: "   " })).toBe(false);
    expect(hasCompany({ company_name: "Veldt Studios" })).toBe(true);
    expect(companyText({ company_name: "" }, t)).toBe("inbox.noCompany");
    expect(companyText({ company_name: "Veldt Studios" }, t)).toBe("Veldt Studios");
  });

  it("is headed by what they want, else nothing, and named by the person when there is no subject", () => {
    expect(subjectOf(row({}))).toBeNull();
    expect(subjectOf(row({ wants: "Acoustic booths" }))).toBe("Acoustic booths");
    expect(subjectOf(row({ company_name: "Veldt Studios" }))).toBe("Veldt Studios");
    expect(namedOf(row({}), t)).toBe("Marta Kovac");
    expect(namedOf(row({ person: null }), t)).toBe("inbox.noCompany");
  });

  it("starts its deal with a call to the person, and the sheet asks for the new company's name", () => {
    expect(firstStepOf(row({}), t)).toBe('inbox.firstStep.person {"person":"Marta Kovac"}');
    expect(firstStepOf(row({ person: null }), t)).toBe("inbox.firstStep.plain");
    expect(firstStepOf(row({ company_name: "Veldt Studios" }), t)).toBe('inbox.firstStep {"person":"Marta Kovac","subject":"Veldt Studios"}');
    const newName = (start: ReturnType<typeof dealFrom>) => ("newCompany" in start ? start.newCompany.name : null);
    expect(dealFrom(row({}), "First call").name).toBe("");
    expect(newName(dealFrom(row({}), "First call"))).toBe("");
    expect(newName(dealFrom(row({ company_name: " Veldt Studios " }), "First call"))).toBe("Veldt Studios");
  });

  it("refuses a new company with no name, or one of spaces, and a deal with no company at all", () => {
    expect(companyProblem({ companyId: null, makeNew: true, newName: "" })).toBe("deal.new.error.companyName");
    expect(companyProblem({ companyId: null, makeNew: true, newName: "   " })).toBe("deal.new.error.companyName");
    expect(companyProblem({ companyId: null, makeNew: true, newName: "Veldt Studios" })).toBeNull();
    expect(companyProblem({ companyId: null, makeNew: false, newName: "" })).toBe("deal.new.error.company");
    expect(companyProblem({ companyId: 4, makeNew: false, newName: "" })).toBeNull();
  });
});
