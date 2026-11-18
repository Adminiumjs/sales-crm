/**
 * The marketer's home past the enquiries: which groups a reader gets, what
 * each is read from, and how its figures are put together. A group whose
 * add-on is not here, or whose tables the reader may not read, is absent
 * (never drawn empty), and its tables are never asked.
 *
 * What the server answers the marketer and the other roles is proved on the
 * whole server, on three engines (`proofs/crm-pages.test.ts`).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatters } from "../../lib/format.ts";
import { StaffError, type StaffSession } from "../../staffSession.ts";
import { CHAT_ADD_ON } from "./data.ts";
import {
  campaignsOf,
  cardsOf,
  countingStartedIn,
  FORMS_ADD_ON,
  formLinesOf,
  installIdOf,
  marketingReach,
  PAGES_ADD_ON,
  readMarketing,
  shareOf,
  stepsOf,
  viewCountsOf,
  type Marketing,
} from "./marketing.ts";
import { campaignState, MarketingGroups, MarketingTiles } from "./MarketingGroups.tsx";

const f = formatters({ locale: "en-US", currency: "GBP", timeZone: "Europe/London" });
const MONTH: [string, string] = ["2026-11-01", "2026-11-30"];
const t = ((key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`)) as unknown as Parameters<typeof campaignState>[1];

const FORMS_READS = [`${FORMS_ADD_ON}:forms`, `${FORMS_ADD_ON}:answers`];
const PAGES_READS = [`${PAGES_ADD_ON}:pages`, `${PAGES_ADD_ON}:funnels`];
const CHAT_READS = [`${CHAT_ADD_ON}:conversations`];
const ATTACHED = { [FORMS_ADD_ON]: { version: "1.0.31", settings: {} }, [PAGES_ADD_ON]: { version: "1.0.31", settings: {} }, [CHAT_ADD_ON]: { version: "1.0.31", settings: {} } };

type Call = { what: string; ref?: string; path?: string; q?: unknown };

/** A session as the server would answer one reader: the add-ons attached, the tables she may read, and canned answers. */
function sessionOf(opts: { addOns?: Record<string, unknown>; reads?: string[]; answers?: Partial<Record<string, unknown>>; refuse?: string[]; fail?: string[] }): { session: StaffSession; calls: Call[] } {
  const calls: Call[] = [];
  const reads = opts.reads ?? [];
  const answer = (key: string, fallback: unknown): unknown => {
    if (opts.refuse?.some((one) => key.startsWith(one))) throw new StaffError(403, "FORBIDDEN", "no");
    if (opts.fail?.some((one) => key.startsWith(one))) throw new Error("boom");
    return opts.answers?.[key] ?? fallback;
  };
  const session = {
    config: { addOns: opts.addOns ?? {}, timezone: "Europe/London" },
    connectionId: "conn_crm",
    can: (ref: string, action: string) => action === "read" && reads.includes(ref),
    list: async (ref: string, q: unknown) => {
      calls.push({ what: "list", ref, q });
      return answer(`list:${ref}`, { rows: [], total: 0 });
    },
    figure: async (figure: { table: string }) => {
      calls.push({ what: "figure", ref: figure.table, q: figure });
      return answer(`figure:${figure.table}`, { shape: "categorical", items: [], total: 0 });
    },
    call: async (_method: string, path: string) => {
      calls.push({ what: "call", path });
      return answer(`call:${path.split("?")[0]!}`, path.startsWith("/email-templates") ? { items: [] } : path.startsWith("/add-ons") ? { addOns: [] } : { data: { level: "counts", countingSince: null, things: [] } });
    },
  } as unknown as StaffSession;
  return { session, calls };
}

describe("which groups a reader gets", () => {
  it("draws a group only with its add-on attached and every table it reads readable", () => {
    const all = [...FORMS_READS, ...PAGES_READS, ...CHAT_READS];
    expect(marketingReach({ config: { addOns: ATTACHED }, can: (ref: string) => all.includes(ref) } as never)).toEqual({ forms: true, funnels: true, chats: true });
    // Not attached: no group, whatever a grant left over says.
    expect(marketingReach({ config: { addOns: {} }, can: (ref: string) => all.includes(ref) } as never)).toEqual({ forms: false, funnels: false, chats: false });
    // Attached, and a role without the reads (Read-only, the operations manager): no group.
    expect(marketingReach({ config: { addOns: ATTACHED }, can: () => false } as never)).toEqual({ forms: false, funnels: false, chats: false });
    // Half the reads is none: the forms without their answers, the funnels without their pages.
    expect(marketingReach({ config: { addOns: ATTACHED }, can: (ref: string) => [FORMS_READS[0], PAGES_READS[1]].includes(ref) } as never)).toEqual({ forms: false, funnels: false, chats: false });
  });

  it("never asks the tables of an add-on that is not here, and leaves its group out", async () => {
    const { session, calls } = sessionOf({ addOns: {}, reads: [...FORMS_READS, ...PAGES_READS, ...CHAT_READS] });
    const read = await readMarketing(session, MONTH, f);
    expect(read.forms).toBeNull();
    expect(read.funnels).toBeNull();
    expect(read.chats).toBeNull();
    expect(calls.filter((call) => call.ref !== undefined)).toEqual([]);
    expect(calls.map((call) => call.path)).toEqual(["/email-templates?kind=campaign"]);
  });

  it("leaves out a group the server refuses, and shows a failure that is not a refusal", async () => {
    const refused = await readMarketing(sessionOf({ addOns: ATTACHED, reads: [...FORMS_READS, ...CHAT_READS], refuse: ["call:/email-templates", "list:forms:forms", `list:${CHAT_ADD_ON}`] }).session, MONTH, f);
    expect(refused).toEqual({ campaigns: null, forms: null, funnels: null, chats: null });
    await expect(readMarketing(sessionOf({ addOns: ATTACHED, reads: FORMS_READS, fail: ["figure:forms:answers"] }).session, MONTH, f)).rejects.toThrow("boom");
  });

  it("reads each group as the marketer's grants allow: only the columns she is given", async () => {
    const { session, calls } = sessionOf({ addOns: ATTACHED, reads: [...FORMS_READS, ...PAGES_READS, ...CHAT_READS] });
    const read = await readMarketing(session, MONTH, f);
    expect(read.campaigns).not.toBeNull();
    expect(read.forms).not.toBeNull();
    expect(read.funnels).not.toBeNull();
    expect(read.chats).not.toBeNull();
    const selected = (ref: string) => calls.filter((call) => call.what === "list" && call.ref === ref).map((call) => (call.q as { select: string[] }).select);
    for (const select of selected("forms:forms")) for (const column of select) expect(["id", "name", "kind", "state"]).toContain(column);
    for (const select of selected("pages:pages")) for (const column of select) expect(["id", "name", "slug", "state", "language", "published_at"]).toContain(column);
    for (const select of selected("pages:funnels")) for (const column of select) expect(["id", "name", "steps"]).toContain(column);
    for (const select of selected(`${CHAT_ADD_ON}:conversations`)) for (const column of select) expect(["id", "started_at", "outside_hours", "became_table", "became_key"]).toContain(column);
    // Nothing is written: a read-only home.
    expect(calls.filter((call) => call.what === "call").every((call) => call.path!.startsWith("/email-templates") || call.path!.startsWith("/add-ons") || call.path!.startsWith("/views"))).toBe(true);
  });
});

describe("campaigns", () => {
  const nov = (day: number) => Date.UTC(2026, 10, day, 10);
  const run = (status: string, at: number | null, sent = 0, total = 0, failed = 0) => ({ status, finishedAt: status === "sent" || status === "failed" ? at : null, startedAt: at, scheduledAt: at ?? 0, sent, total, failed });
  const answer = {
    items: [
      { kind: "campaign", key: "autumn", locale: "en-US", name: "Autumn", topicLabel: "Autumn news", run: run("sent", nov(3), 120, 125, 5) },
      // The same campaign's German version, sent earlier: the newest send speaks for it.
      { kind: "campaign", key: "autumn", locale: "de-DE", name: "Herbst", topicLabel: "Autumn news", run: run("sent", Date.UTC(2026, 9, 2), 40, 40) },
      { kind: "campaign", key: "winter", locale: "en-US", name: "Winter", topicLabel: "Winter", run: run("scheduled", nov(28)) },
      { kind: "campaign", key: "spring", locale: "en-US", name: "Spring" },
      { kind: "campaign", key: "summer", locale: "en-US", name: "Summer", run: run("sent", Date.UTC(2026, 6, 1), 300, 300) },
      { kind: "template", key: "welcome", name: "Welcome" },
    ],
  };
  const from = f.at(MONTH[0], "00:00").getTime();
  const to = f.at(MONTH[1], "23:59").getTime() + 59_999;

  it("is one line a campaign, its newest send, and counts what went out this month", () => {
    const group = campaignsOf(answer, from, to);
    expect(group.lines.map((line) => line.key)).toEqual(["winter", "autumn", "summer", "spring"]);
    expect(group.lines.find((line) => line.key === "autumn")).toMatchObject({ name: "Autumn news", status: "sent", sent: 120, total: 125, failed: 5 });
    expect(group.lines.find((line) => line.key === "spring")).toMatchObject({ status: "draft", at: null, sent: 0 });
    expect(group.sentInMonth).toBe(1);
    expect(group.mailsInMonth).toBe(120);
  });

  it("reads an answer it does not know as nothing", () => {
    expect(campaignsOf(null, from, to)).toEqual({ lines: [], sentInMonth: 0, mailsInMonth: 0 });
    expect(campaignsOf({ items: [{ kind: "campaign" }, "x"] }, from, to).lines).toEqual([]);
  });

  it("says where each send stands", () => {
    expect(campaignState({ status: "draft", at: null }, t, f)).toBe("mkhome.campaign.draft");
    expect(campaignState({ status: "sent", at: nov(3) }, t, f)).toMatch(/^mkhome\.campaign\.sent /);
    expect(campaignState({ status: "running", at: nov(3) }, t, f)).toBe("mkhome.campaign.running");
  });
});

describe("forms", () => {
  it("lists each form that had answers this month, or is live, the most answered first", () => {
    const forms = [
      { id: "f1", name: "Book a showroom visit", kind: "form", state: "closed" },
      { id: "f2", name: "Newsletter sign-up", kind: "form", state: "live" },
      { id: "f3", name: "Trade show enquiry", kind: "form", state: "draft" },
      { id: "f4", name: "How did your fit-out go?", kind: "survey", state: "closed" },
    ];
    const grouped = { items: [{ key: "f4", label: null, value: 0, values: { n: 7 } }, { key: "f1", label: null, value: 3 }] };
    expect(formLinesOf(forms, grouped).map((line) => [line.id, line.answers])).toEqual([["f4", 7], ["f1", 3], ["f2", 0]]);
  });
});

describe("funnels", () => {
  it("reads a funnel's steps as the database hands them back, parsed or as text, and drops what is not a step", () => {
    const steps = [{ kind: "page", key: "12" }, { kind: "form", key: "b398", addOn: "forms" }, { kind: "page", key: 13 }, { kind: "video", key: "1" }, { kind: "page" }];
    const read = [{ kind: "page", key: "12" }, { kind: "form", key: "b398", addOn: "forms" }, { kind: "page", key: "13" }];
    expect(stepsOf(steps)).toEqual(read);
    expect(stepsOf(JSON.stringify(steps))).toEqual(read);
    expect(stepsOf("not json")).toEqual([]);
    expect(stepsOf({ kind: "page" })).toEqual([]);
    expect(stepsOf([{ kind: "form", key: "x" }])).toEqual([{ kind: "form", key: "x", addOn: "forms" }]);
    expect(stepsOf(Array.from({ length: 12 }, (_, i) => ({ kind: "page", key: String(i) }))).length).toBe(8);
  });

  it("makes a page one card and a form two, a form's counted on the page before it", () => {
    const pages = new Map([["12", "Showroom open day"], ["13", "Thanks, see you there"]]);
    const forms = new Map([["forms:b398", "Book a showroom visit"]]);
    const cards = cardsOf(stepsOf([{ kind: "page", key: "12" }, { kind: "form", key: "b398", addOn: "forms" }, { kind: "page", key: "13" }]), pages, forms);
    expect(cards.map((card) => [card.kind, card.title, card.ask])).toEqual([
      ["page", "Showroom open day", { addOn: "pages", kind: "page", thing: "12" }],
      ["form-opened", "Book a showroom visit", { addOn: "forms", kind: "form-opened", thing: "b398", place: "12" }],
      ["form-sent", "Book a showroom visit", { addOn: "forms", kind: "form-sent", thing: "b398", place: "12" }],
      ["page", "Thanks, see you there", { addOn: "pages", kind: "page", thing: "13" }],
    ]);
    // First, a form is counted on its own page; a form or a page that is gone counts nothing.
    const first = cardsOf(stepsOf([{ kind: "form", key: "b398" }, { kind: "page", key: "99" }, { kind: "form", key: "gone" }]), pages, forms);
    expect(first.map((card) => card.ask?.kind ?? null)).toEqual(["form-page", "form-sent", null, null, null]);
    expect(first[2]!.title).toBeNull();
  });

  it("says what share of the step before went on, and nothing where either counts nothing", () => {
    expect(shareOf(40, 100)).toBe(0.4);
    expect(shareOf(4, 0)).toBeNull();
    expect(shareOf(null, 10)).toBeNull();
    expect(shareOf(4, null)).toBeNull();
  });

  it("asks the counts of this database's own copy of an add-on, else the one kept once per server", () => {
    const answer = { addOns: [{ key: "pages", installId: "inst_other", connectionId: "conn_other" }, { key: "pages", installId: "inst_server", connectionId: null }, { key: "pages", installId: "inst_mine", connectionId: "conn_crm" }] };
    expect(installIdOf(answer, "pages", "conn_crm")).toBe("inst_mine");
    expect(installIdOf(answer, "pages", "conn_new")).toBe("inst_server");
    expect(installIdOf({ addOns: [{ key: "pages", installId: "inst_other", connectionId: "conn_other" }] }, "pages", "conn_crm")).toBeNull();
    expect(installIdOf({}, "pages", "conn_crm")).toBeNull();
  });

  it("adds a thing's days up, every place together, and reads an odd answer as not known", () => {
    const read = viewCountsOf({ data: { level: "counts", countingSince: 1_700_000_000_000, things: [{ thing: "12", days: [{ day: "2026-11-02", place: "", views: 3 }, { day: "2026-11-03", place: "", views: 4 }] }, { thing: "13", days: [] }] } });
    expect([...read.totals]).toEqual([["12", 7], ["13", 0]]);
    expect(read.level).toBe("counts");
    expect(viewCountsOf("x")).toEqual({ level: null, countingSince: null, totals: new Map() });
  });

  it("says when counting started only when it started inside the month", () => {
    expect(countingStartedIn(null, MONTH, f)).toBe(false);
    expect(countingStartedIn(f.at("2026-10-20", "12:00").getTime(), MONTH, f)).toBe(false);
    expect(countingStartedIn(f.at("2026-11-01", "12:00").getTime(), MONTH, f)).toBe(false);
    expect(countingStartedIn(f.at("2026-11-12", "12:00").getTime(), MONTH, f)).toBe(true);
  });

  it("counts each step through Adminium's views, the pages of the Pages copy and the form at the page before it", async () => {
    const { session, calls } = sessionOf({
      addOns: ATTACHED,
      reads: [...FORMS_READS, ...PAGES_READS],
      answers: {
        "list:pages:funnels": { rows: [{ id: 1, name: "Open day", steps: JSON.stringify([{ kind: "page", key: "12" }, { kind: "form", key: "b398", addOn: "forms" }, { kind: "page", key: "13" }]) }] },
        "list:pages:pages": { rows: [{ id: 12, name: "Showroom open day", state: "live" }, { id: 13, name: "Thanks, see you there", state: "live" }, { id: 14, name: "German copy", state: "draft" }] },
        "list:forms:forms": { rows: [{ id: "b398", name: "Book a showroom visit" }] },
        "call:/add-ons": { addOns: [{ key: "pages", installId: "inst_pages", connectionId: "conn_crm" }, { key: "forms", installId: "inst_forms", connectionId: "conn_crm" }] },
      },
    });
    const views = new Map<string, unknown>([
      ["inst_pages|page", { data: { level: "counts", countingSince: f.at("2026-11-12", "09:00").getTime(), things: [{ thing: "12", days: [{ day: "2026-11-13", place: "", views: 100 }] }, { thing: "13", days: [{ day: "2026-11-13", place: "", views: 9 }] }] } }],
      ["inst_forms|form-opened", { data: { level: "counts", countingSince: null, things: [{ thing: "b398", days: [{ day: "2026-11-13", place: "12", views: 40 }] }] } }],
      ["inst_forms|form-sent", { data: { level: "counts", countingSince: null, things: [{ thing: "b398", days: [{ day: "2026-11-13", place: "12", views: 10 }] }] } }],
    ]);
    session.call = (async (_method: string, path: string) => {
      calls.push({ what: "call", path });
      if (path.startsWith("/views?")) {
        const q = new URLSearchParams(path.slice("/views?".length));
        return views.get(`${q.get("installId")!}|${q.get("kind")!}`);
      }
      return path.startsWith("/add-ons") ? { addOns: [{ key: "pages", installId: "inst_pages", connectionId: "conn_crm" }, { key: "forms", installId: "inst_forms", connectionId: "conn_crm" }] } : { items: [] };
    }) as StaffSession["call"];
    const read = await readMarketing(session, MONTH, f);
    expect(read.funnels!.lines[0]!.cards.map((card) => card.count)).toEqual([100, 40, 10, 9]);
    expect(read.funnels!.pageViews).toBe(109);
    expect(read.funnels!.livePages).toBe(2);
    const asked = calls.filter((call) => call.path?.startsWith("/views?")).map((call) => Object.fromEntries(new URLSearchParams(call.path!.slice("/views?".length))));
    expect(asked).toContainEqual({ installId: "inst_pages", kind: "page", things: "12,13", from: "2026-11-01", to: "2026-11-30" });
    expect(asked).toContainEqual({ installId: "inst_forms", kind: "form-opened", things: "b398", from: "2026-11-01", to: "2026-11-30", place: "12" });
    expect(asked).toContainEqual({ installId: "inst_forms", kind: "form-sent", things: "b398", from: "2026-11-01", to: "2026-11-30", place: "12" });
    expect(countingStartedIn(read.funnels!.countingSince, MONTH, f)).toBe(true);
  });
});

describe("the drawn home", () => {
  const groups: Marketing = {
    campaigns: { lines: [{ key: "autumn", name: "Autumn news", status: "sent", at: Date.UTC(2026, 10, 3), sent: 120, total: 125, failed: 5 }], sentInMonth: 1, mailsInMonth: 120 },
    forms: { lines: [{ id: "f1", name: "Book a showroom visit", kind: "form", state: "live", answers: 3 }], answers: 3 },
    funnels: { lines: [{ id: "1", name: "Open day", cards: [{ kind: "page", title: "Showroom open day", ask: { addOn: "pages", kind: "page", thing: "12" }, count: 100 }] }], pageViews: 100, livePages: 3, level: "counts", countingSince: null },
    chats: { conversations: 4, outsideHours: 1, questions: [{ id: "7", startedAt: "2026-11-17T21:05:00.000Z", enquiry: { id: 3, person: "Marta Kovac", company_name: "" } }] },
  };
  const draw = (data: Marketing) =>
    renderToStaticMarkup(createElement("div", null, createElement(MarketingTiles, { data, month: "November", t, f }), createElement(MarketingGroups, { data, month: "November", monthDays: MONTH, t, f })));

  it("draws the four groups with their figures", () => {
    const html = draw(groups);
    for (const group of ["campaigns", "forms", "funnels", "chats"]) expect(html).toContain(`data-group="${group}"`);
    for (const stat of ["campaigns", "answers", "views", "chats"]) expect(html).toContain(`data-stat="${stat}"`);
    expect(html).toContain("Marta Kovac");
  });

  it("draws no group, no tile and no heading for an add-on that is not here", () => {
    const html = draw({ ...groups, forms: null, funnels: null, chats: null });
    expect(html).toContain('data-group="campaigns"');
    for (const group of ["forms", "funnels", "chats"]) expect(html).not.toContain(`data-group="${group}"`);
    for (const stat of ["answers", "views", "chats"]) expect(html).not.toContain(`data-stat="${stat}"`);
    expect(draw({ campaigns: null, forms: null, funnels: null, chats: null })).toBe("<div></div>");
  });

  it("offers nothing to make or change: no button, no form, no field", () => {
    const html = draw(groups);
    for (const tag of ["<button", "<form", "<input", "<select", "<textarea"]) expect(html).not.toContain(tag);
  });

  it("says counting is off, or when it started", () => {
    expect(draw({ ...groups, funnels: { ...groups.funnels!, level: "off" } })).toContain('data-counting="off"');
    expect(draw({ ...groups, funnels: { ...groups.funnels!, countingSince: f.at("2026-11-12", "09:00").getTime() } })).toContain('data-counting="since"');
    expect(draw(groups)).not.toContain("data-counting");
  });
});
