import { describe, expect, it } from "vitest";

import { formatters } from "../../lib/format.ts";
import type { StaffSession } from "../../staffSession.ts";
import { channelsOf, dealConditions, digestKinds, filtersOf, fromServerLocale, kindsFor, quietFor, quietOf, reasonsFor, ruleState, screenOf, sendTest, stageOf, toServerLocale, type Told } from "./data.ts";

const f = formatters({ locale: "en-US", currency: "GBP", timeZone: "Europe/London" });
const NOW = new Date("2026-07-28T08:35:00.000Z");
const STAGES = [
  { id: 1, label: "Discovery" },
  { id: 4, label: "Negotiation" },
];

/** A person by what she may do: `can("deals", "create")` is `rights.deals` holding "create". */
const person = (rights: Record<string, string[]>, parts: Record<string, boolean> = {}): Pick<StaffSession, "can" | "part"> => ({
  can: (ref, action) => (rights[ref] ?? []).includes(action),
  part: (id) => parts[id] !== false,
});
const REP = { deals: ["read", "create", "update"], follow_ups: ["read", "create", "update"], quotes: ["read", "create", "update"] };
const MANAGER = REP;
const ACCOUNT = { deals: ["read"], follow_ups: ["read", "create", "update"] };
const MARKETER = { enquiries: ["read", "create"], companies: ["read"] };

describe("the state of a rule, as far as a person can be told (R7)", () => {
  it("is on or off when the server says, and not known otherwise", () => {
    expect(ruleState({ enabled: true })).toBe("on");
    expect(ruleState({ enabled: false })).toBe("off");
    expect(ruleState({})).toBe("unknown");
    expect(ruleState({ enabled: "yes" })).toBe("unknown");
    expect(ruleState(null)).toBe("unknown");
    expect(ruleState(undefined)).toBe("unknown");
  });
});

describe("what can reach a person, cut to her roles and parts (P26)", () => {
  it("lists for a rep what a rule can tell a rep, and no approval put to her", () => {
    expect(reasonsFor(person(REP), ["crm-rep"])).toEqual(["followUp", "nudge", "handedOver", "quoteRunsOut", "approvalAnswered"]);
    expect(kindsFor(person(REP), ["crm-rep"])).toEqual(["mention", "automation.notice"]);
  });
  it("adds the approval asked for the sales manager", () => {
    expect(reasonsFor(person(MANAGER), ["crm-sales-manager"])).toContain("approvalAsked");
  });
  it("lists for the field crew the change of a visit of his, while Jobs on site is on, and nothing else (P22)", () => {
    const CREW = { job_visits: ["read", "update"], snags: ["read", "create", "update"], sign_offs: ["read", "create"] };
    expect(reasonsFor(person(CREW), ["crm-crew"])).toEqual(["visitChanged"]);
    expect(kindsFor(person(CREW), ["crm-crew"])).toEqual(["mention", "automation.notice"]);
    expect(reasonsFor(person(CREW, { jobs: false }), ["crm-crew"])).toEqual([]);
  });
  it("lists a follow-up falling due for the account manager, who owns no deal", () => {
    expect(reasonsFor(person(ACCOUNT), ["crm-account-manager"])).toEqual(["followUp"]);
  });
  it("lists no rule's notice for the marketer, the front desk or Read-only: a mention only", () => {
    expect(reasonsFor(person(MARKETER), ["crm-marketer"])).toEqual([]);
    expect(kindsFor(person(MARKETER), ["crm-marketer"])).toEqual(["mention"]);
    expect(kindsFor(person({ deals: ["read"], follow_ups: ["read"], quotes: ["read"] }), ["crm-read-only"])).toEqual(["mention"]);
  });
  it("leaves out what a part that is off would send", () => {
    expect(reasonsFor(person(REP, { quotes: false }), ["crm-rep"])).toEqual(["followUp", "nudge", "handedOver"]);
    expect(reasonsFor(person(MANAGER, { quotes: false }), ["crm-sales-manager"])).not.toContain("approvalAsked");
    expect(kindsFor(person(REP, { selling: false, quotes: false }), ["crm-rep"])).toEqual([]);
  });
  it("names the summaries by the roles that get one", () => {
    expect(digestKinds(["crm-rep"])).toEqual(["rep"]);
    expect(digestKinds(["crm-account-manager"])).toEqual(["rep"]);
    expect(digestKinds(["crm-sales-manager", "crm-rep"])).toEqual(["rep", "manager"]);
    expect(digestKinds(["crm-marketer"])).toEqual([]);
    expect(digestKinds([])).toEqual([]);
  });
});

describe("how she is told, as Adminium keeps it", () => {
  const told: Told = { channels: [], events: [{ key: "mention", channels: { inApp: false, email: true, push: false, always: true }, custom: true }] };
  it("reads a kind she never chose as Adminium's default", () => {
    expect(channelsOf(told, "mention")).toEqual({ inApp: false, email: true, push: false, always: true });
    expect(channelsOf(told, "automation.notice")).toEqual({ inApp: true, email: true, push: false });
  });
  it("holds quiet hours as one stretch, and says when the server holds several", () => {
    expect(quietOf({ quiet: null })).toEqual({ on: false, from: "18:30", to: "08:00", mixed: false });
    const same = quietFor({ from: "19:00", to: "07:30" });
    expect(Object.keys(same ?? {})).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(quietOf({ quiet: same })).toEqual({ on: true, from: "19:00", to: "07:30", mixed: false });
    expect(quietOf({ quiet: { "1": { from: "19:00", to: "07:30" } } }).mixed).toBe(true);
    expect(quietOf({ quiet: { ...same, "6": { from: "12:00", to: "23:00" } } }).mixed).toBe(true);
    // Switched off, the server keeps the hours: shown as they were, off.
    expect(quietOf({ quiet: same, quietOn: false })).toEqual({ on: false, from: "19:00", to: "07:30", mixed: false });
  });
  it("writes a language the way each side keeps it", () => {
    expect(toServerLocale("zh-TW")).toBe("zh_TW");
    expect(fromServerLocale("ar_EG")).toBe("ar-EG");
  });
});

describe("Send me a test", () => {
  const session = { config: { csrfToken: "tok" } } as unknown as StaffSession;
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => (): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status, headers }));
  it("carries the session's token and names her own rule", async () => {
    const calls: { input: unknown; init: RequestInit | undefined }[] = [];
    await sendTest(session, "auto 1", (input, init) => {
      calls.push({ input, init });
      return Promise.resolve(new Response(JSON.stringify({ data: { sent: true, reason: null, left: 2 } })));
    });
    expect(calls[0]!.input).toBe("/api/v1/me/summaries/auto%201/send");
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>)["x-adminium-csrf"]).toBe("tok");
  });
  it("says each of the server's answers apart, and never waits out the hour", async () => {
    expect(await sendTest(session, "a", answer(200, { data: { sent: true, reason: null, left: 2 } }))).toEqual({ state: "sent", left: 2 });
    expect(await sendTest(session, "a", answer(200, { data: { sent: false, reason: "no-email", left: 1 } }))).toEqual({ state: "made", reason: "no-email", left: 1 });
    expect(await sendTest(session, "a", answer(200, { data: { sent: false, reason: "no-template", left: 0 } }))).toEqual({ state: "made", reason: "no-template", left: 0 });
    expect(await sendTest(session, "a", answer(429, { error: { code: "RATE_LIMITED" } }, { "retry-after": "1800" }))).toEqual({ state: "limited", seconds: 1800 });
    expect(await sendTest(session, "a", answer(429, {}))).toEqual({ state: "limited", seconds: 3600 });
    expect(await sendTest(session, "a", answer(404, { error: { code: "NOT_FOUND" } }))).toEqual({ state: "gone" });
    expect(await sendTest(session, "a", answer(403, { error: { message: "No." } }))).toEqual({ state: "refused", message: "No." });
    expect(await sendTest(session, "a", answer(502, {}))).toEqual({ state: "lost" });
    expect(await sendTest(session, "a", () => Promise.reject(new Error("offline")))).toEqual({ state: "lost" });
  });
});

describe("a saved view's filters", () => {
  it("reads the json as text or as a value, and anything else as no filter", () => {
    expect(filtersOf('{"over":20000}')).toEqual({ over: 20000 });
    expect(filtersOf({ sitting: 14 })).toEqual({ sitting: 14 });
    expect(filtersOf("not json")).toEqual({});
    expect(filtersOf(null)).toEqual({});
    expect(filtersOf([1])).toEqual({});
  });
  it("is a cut of the board unless it names another screen", () => {
    expect(screenOf({})).toBe("pipeline");
    expect(screenOf({ screen: "archive" })).toBe("archive");
    expect(screenOf({ screen: "nowhere" as never })).toBe("pipeline");
  });
  it("finds a stage by its number, or (the sample's) by its name; a stage that is gone matches nothing", () => {
    expect(stageOf({ stage: 4 }, STAGES)?.label).toBe("Negotiation");
    expect(stageOf({ stage: "negotiation" }, STAGES)?.id).toBe(4);
    expect(stageOf({ stage: "proposal" }, STAGES)).toBeNull();
    expect(stageOf({}, STAGES)).toBeNull();
    expect(dealConditions({ stage: "proposal" }, STAGES, NOW, f)).toEqual([{ column: "stage_id", op: "eq", value: -1 }]);
  });
  it("turns each rule into a condition the server reads, on the business's days", () => {
    expect(dealConditions({ rep: "usr_1", stage: "negotiation" }, STAGES, NOW, f)).toEqual([
      { column: "owner_id", op: "eq", value: "usr_1" },
      { column: "stage_id", op: "eq", value: 4 },
    ]);
    expect(dealConditions({ over: 20000 }, STAGES, NOW, f)).toEqual([{ column: "amount", op: "gt", value: 20000 }]);
    // Sitting 14 days and up on 28 July: entered on or before 14 July, so before 15 July began in London (23:00 UTC the day before).
    expect(dealConditions({ sitting: 14 }, STAGES, NOW, f)).toEqual([{ column: "entered_stage_at", op: "lt", value: "2026-07-14T23:00:00.000Z" }]);
    expect(dealConditions({ closing: "this month" }, STAGES, NOW, f)).toEqual([{ column: "expected_close", op: "between", value: ["2026-07-01", "2026-07-31"] }]);
    expect(dealConditions({ closing: "this month" }, STAGES, new Date("2028-02-10T12:00:00Z"), f)).toEqual([{ column: "expected_close", op: "between", value: ["2028-02-01", "2028-02-29"] }]);
    expect(dealConditions({}, STAGES, NOW, f)).toEqual([]);
  });
});
