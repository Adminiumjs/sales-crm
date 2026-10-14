/**
 * Finding things (P08), the parts that decide: which screens Jump offers to
 * whom, how records are asked for and what that costs, which keys work for
 * whom, where a notice's record opens, and the bell's live line.
 */
import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";
import { openRecord, placeOfPath, refOfTable } from "../shell/open-record.ts";
import { homeFor, menuFor, USER_MENU, type MenuFacts, type RoleKey, type RouteKey } from "../shell/routes.ts";
import type { ListQuery, Page, Row } from "../staffSession.ts";
import { findRecords, fold, GAP_MS, kindsFor, likeOf, matchScreens, PAUSE_MS, PER_KIND, roundDelay, screenLines } from "./jump.ts";
import { NUDGE_MS, POLL_MS, shouldNudge } from "./notices.ts";
import { busyTarget, shortcutFor, shortcutGroups, type ShortcutFacts } from "./shortcuts.ts";

type Role = { key: string; permissions: string[] };
const roles = (manifest as unknown as { roles: Role[] }).roles;

/** What a person holding these roles reads, on an install with every part on and every screen built. */
function facts(held: RoleKey[]): MenuFacts {
  const grants = new Set(roles.filter((role) => held.includes(role.key as RoleKey)).flatMap((role) => role.permissions));
  return { roles: held.map((key) => `crm-${key}`), part: () => true, reads: (table) => grants.has(`table:@${table}:read`), built: () => true };
}
const can = (held: RoleKey[]) => {
  const grants = new Set(roles.filter((role) => held.includes(role.key as RoleKey)).flatMap((role) => role.permissions));
  return (table: string, action: string) => grants.has(`table:@${table}:${action}`);
};
function keyFacts(held: RoleKey[]): ShortcutFacts {
  const f = facts(held);
  const menu = new Map<RouteKey, string>();
  for (const group of menuFor(f)) for (const item of group.items) menu.set(item.route, item.label);
  return { menu, home: homeFor(f), canStartDeal: can(held)("deals", "create"), canEditDeal: can(held)("deals", "update"), canReadComments: can(held)("comments", "read") };
}
const press = (key: string, more: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...more });

describe("Jump's screens", () => {
  const lines = (held: RoleKey[]) => screenLines(menuFor(facts(held)), (route) => USER_MENU.includes(route));
  it("are the person's own menu, then the screens under their name, each once", () => {
    const rep = lines(["rep"]).map((line) => line.route);
    expect(rep.slice(0, 3)).toEqual(["today", "week", "visits"]);
    expect(rep).toContain("pipeline");
    expect(rep).not.toContain("team");
    expect(rep).not.toContain("approvals");
    expect(rep.slice(-2)).toEqual(["me", "mydetails"]);
    expect(new Set(rep).size).toBe(rep.length);
  });
  it("never offer the marketer a screen of selling", () => {
    const marketer = lines(["marketer"]).map((line) => line.route);
    expect(marketer).toEqual(expect.arrayContaining(["mkhome", "leads", "companies", "contacts"]));
    for (const route of ["pipeline", "today", "deal", "quotes", "archive", "team"] as RouteKey[]) expect(marketer).not.toContain(route);
  });
  it("are matched by the words the menu shows, without case or accents", () => {
    const all = lines(["rep"]);
    const words = (line: { label: string }) => ({ "nav.item.pipeline": "Pipeline board", "nav.item.companies": "Sociétés" })[line.label] ?? line.label;
    expect(matchScreens(all, "PIPE", words).map((line) => line.route)).toEqual(["pipeline"]);
    expect(matchScreens(all, "societes", words).map((line) => line.route)).toEqual(["companies"]);
    expect(matchScreens(all, "", words).length).toBe(8);
    expect(fold("  Été   Ünïcode ")).toBe("ete unicode");
  });
});

/** A session that answers lists from a table of canned rows and remembers what it was asked. */
function fakeSession(held: RoleKey[], rows: Record<string, Row[]> = {}) {
  const asked: { ref: string; q: ListQuery }[] = [];
  return {
    asked,
    part: () => true,
    can: can(held),
    list: async <R extends Row = Row>(ref: string, q: ListQuery = {}): Promise<Page<R>> => {
      asked.push({ ref, q });
      return { rows: (rows[ref] ?? []) as R[], total: null, next: null };
    },
  };
}

describe("Jump's records", () => {
  it("are asked only of the tables the person reads, one request each, by name", async () => {
    const dana = fakeSession(["rep"], { deals: [{ id: 1, name: "Fourth-floor desk rows", state: "open", amount: 52800, company: "Nordwind Logistics", stage: "Negotiation" }] });
    const found = await findRecords(dana, "desk", { version: (n) => `version ${String(n)}` });
    expect(dana.asked.map((one) => one.ref)).toEqual(["deals", "companies", "contacts", "quotes"]);
    for (const one of dana.asked) expect(one.q.limit).toBe(PER_KIND);
    expect(dana.asked[0]!.q.where).toEqual({ column: "name", op: "ilike", value: "%desk%" });
    expect(found).toEqual([{ kind: "deal", id: 1, title: "Fourth-floor desk rows", sub: "Nordwind Logistics · Negotiation", amount: 52800, state: "open", route: "deal" }]);

    // The marketer reads companies and contacts: no deal and no quote is asked for, by any spelling.
    const lena = fakeSession(["marketer"]);
    await findRecords(lena, "Fourth-floor desk rows", { version: String });
    expect(lena.asked.map((one) => one.ref)).toEqual(["companies", "contacts"]);
    expect(kindsFor(lena)).toEqual(["company", "contact"]);
    // Read-only: all four. The front desk: companies and contacts. Operations: nothing at all.
    expect(kindsFor(fakeSession(["read-only"]))).toEqual(["deal", "company", "contact", "quote"]);
    expect(kindsFor(fakeSession(["ops-manager"]))).toEqual([]);
  });
  it("ask nothing for fewer than two letters, and take what is typed literally", async () => {
    const dana = fakeSession(["rep"]);
    expect(await findRecords(dana, " d ", { version: String })).toEqual([]);
    expect(dana.asked).toEqual([]);
    expect(likeOf("50%_off")).toBe("%50\\%\\_off%");
  });
  it("find a quote by its family's number or its own, and name the version", async () => {
    const dana = fakeSession(["rep"], { quotes: [{ id: 9, number: "Q-1009", family_no: "Q-1002", version: 2, deal: "Fourth-floor desk rows" }] });
    const found = await findRecords(dana, "Q-1002", { version: (n) => `version ${String(n)}` });
    expect(dana.asked.find((one) => one.ref === "quotes")!.q.where).toEqual({ or: [{ column: "family_no", op: "ilike", value: "%Q-1002%" }, { column: "number", op: "ilike", value: "%Q-1002%" }] });
    expect(found).toEqual([{ kind: "quote", id: 9, title: "Q-1002 · version 2", sub: "Fourth-floor desk rows", amount: null, state: null, route: "quotes" }]);
  });
  it("a table that refuses gives no lines; the others still answer", async () => {
    const dana = fakeSession(["rep"], { companies: [{ id: 4, name: "Nordwind Logistics", sector: "Logistics", town: "Leeds" }] });
    dana.list = (async (ref: string, q: ListQuery = {}) => {
      dana.asked.push({ ref, q });
      if (ref === "deals") throw new Error("refused");
      return { rows: ref === "companies" ? [{ id: 4, name: "Nordwind Logistics", sector: "Logistics", town: "Leeds" }] : [], total: null, next: null };
    }) as typeof dana.list;
    expect((await findRecords(dana, "nord", { version: String })).map((line) => line.title)).toEqual(["Nordwind Logistics"]);
  });
  it("wait for a pause, and no round leaves sooner than the gap after the last: the most a minute is bounded", () => {
    expect(roundDelay(null, 10_000)).toBe(PAUSE_MS);
    expect(roundDelay(10_000, 10_100)).toBe(GAP_MS - 100);
    expect(roundDelay(10_000, 10_000 + GAP_MS + 5)).toBe(PAUSE_MS);
    // Four tables at most, one round per gap: the palette's ceiling, against a person's 300 a minute.
    expect(4 * Math.ceil(60_000 / GAP_MS)).toBeLessThanOrEqual(160);
  });
});

describe("the keyboard shortcuts", () => {
  it("list only what works for the person", () => {
    const rows = (held: RoleKey[]) => shortcutGroups(keyFacts(held)).flatMap((group) => group.rows.map((row) => `${row.item ?? row.label}:${row.keys.join(" ")}`));
    const rep = rows(["rep"]);
    expect(rep).toEqual(expect.arrayContaining(["today:1", "pipeline:2", "companies:3", "contacts:4", "week:G then W", "archive:G then C", "inbox:G then I", "messages:G then M", "keys.newDeal:N", "keys.jump:mod K", "keys.dealAmount:E", "keys.dealComments:C"]));
    expect(rep.some((row) => row.startsWith("team:") || row.startsWith("feed:"))).toBe(false);
    const manager = rows(["sales-manager"]);
    expect(manager).toEqual(expect.arrayContaining(["team:1", "teamBoard:2", "feed:G then F"]));
    expect(manager.some((row) => row.startsWith("team:G then T"))).toBe(false);
    const marketer = rows(["marketer"]);
    expect(marketer).toEqual(expect.arrayContaining(["home:1", "companies:3", "contacts:4", "keys.jump:mod K"]));
    expect(marketer.some((row) => /^(pipeline|week|archive|team|inbox):/.test(row) || row.startsWith("keys.newDeal") || row.startsWith("keys.deal"))).toBe(false);
    // Read-only changes nothing: no new deal, no amount; she reads comments.
    const grace = rows(["read-only"]);
    expect(grace.some((row) => row.startsWith("keys.newDeal") || row.startsWith("keys.dealAmount"))).toBe(false);
    expect(grace).toContain("keys.dealComments:C");
  });
  it("do what the table says, and nothing for a screen the person has not got", () => {
    const rep = keyFacts(["rep"]);
    const was = { afterG: false, inDeal: false };
    expect(shortcutFor(press("k", { metaKey: true }), rep, was)).toEqual({ kind: "jump" });
    expect(shortcutFor(press("K", { ctrlKey: true }), rep, was)).toEqual({ kind: "jump" });
    expect(shortcutFor(press("/"), rep, was)).toEqual({ kind: "search" });
    expect(shortcutFor(press("?"), rep, was)).toEqual({ kind: "help" });
    expect(shortcutFor(press("1"), rep, was)).toEqual({ kind: "go", route: "today" });
    expect(shortcutFor(press("g"), rep, was)).toBe("g");
    expect(shortcutFor(press("w"), rep, { ...was, afterG: true })).toEqual({ kind: "go", route: "week" });
    expect(shortcutFor(press("t"), rep, { ...was, afterG: true })).toBeNull();
    expect(shortcutFor(press("e"), rep, was)).toBeNull();
    expect(shortcutFor(press("e"), rep, { ...was, inDeal: true })).toEqual({ kind: "dealAmount" });
    expect(shortcutFor(press("c"), rep, { ...was, inDeal: true })).toEqual({ kind: "dealComments" });
    expect(shortcutFor(press("d", { altKey: true }), rep, was)).toBeNull();
    expect(shortcutFor(press("n"), rep, was)).toBeNull();
    const marketer = keyFacts(["marketer"]);
    expect(shortcutFor(press("2"), marketer, was)).toBeNull();
    expect(shortcutFor(press("1"), marketer, was)).toEqual({ kind: "go", route: "mkhome" });
    expect(shortcutFor(press("g"), marketer, was)).toBeNull();
  });
  it("never fire inside a field, a dialog or a menu", () => {
    const quiet = { querySelector: () => null };
    const open = { querySelector: () => ({}) };
    expect(busyTarget(null, quiet)).toBe(false);
    expect(busyTarget(null, open)).toBe(true);
  });
});

describe("where a notice's record opens", () => {
  const here = { appKey: "crm", connectionId: "conn_1", tables: { deals: "crm_deals", companies: "crm_companies", contacts: "crm_contacts", quotes: "crm_quotes", comments: "crm_comments" } };
  it("prefers the server's own answer when it gives one", () => {
    expect(openRecord({ opens: { appKey: "crm", path: "/deals/12" }, entity: { connectionId: "conn_1", table: "main.crm_companies", pk: { id: 4 } } }, here)).toEqual({ route: "deal", rest: ["12"] });
    expect(openRecord({ opens: { appKey: "pos", path: "/orders/3" } }, here)).toBeNull();
    expect(placeOfPath("/home/1")).toBeNull();
    expect(placeOfPath("/quotes/7")).toEqual({ route: "quotes", rest: ["7"] });
  });
  it("else maps the record's table to the app's screen for it", () => {
    expect(openRecord({ entity: { connectionId: "conn_1", table: "main.crm_deals", pk: { id: 12 } } }, here)).toEqual({ route: "deal", rest: ["12"] });
    expect(openRecord({ entity: { connectionId: "conn_1", table: "public.crm_contacts", pk: { id: "7" } } }, here)).toEqual({ route: "contacts", rest: ["7"] });
    expect(openRecord({ entity: { connectionId: "conn_1", table: "crm_companies", pk: { id: 4 } } }, here)).toEqual({ route: "companies", rest: ["4"] });
    expect(refOfTable("main.crm_quotes", here.tables)).toBe("quotes");
  });
  it("opens nothing for a notice with no record, another database, a table with no screen, or a key that is not one number", () => {
    expect(openRecord({ entity: null }, here)).toBeNull();
    expect(openRecord({}, here)).toBeNull();
    expect(openRecord({ entity: { connectionId: "conn_2", table: "main.crm_deals", pk: { id: 12 } } }, here)).toBeNull();
    expect(openRecord({ entity: { connectionId: "conn_1", table: "main.crm_comments", pk: { id: 3 } } }, here)).toBeNull();
    expect(openRecord({ entity: { connectionId: "conn_1", table: "main.other_deals", pk: { id: 3 } } }, here)).toBeNull();
    expect(openRecord({ entity: { connectionId: "conn_1", table: "main.crm_deals", pk: { a: 1, b: 2 } } }, here)).toBeNull();
    expect(openRecord({ entity: { reportId: "r1" } }, here)).toBeNull();
  });
});

describe("the bell's asking", () => {
  it("asks on a nudge only when the last ask is some seconds old; once a minute otherwise", () => {
    expect(POLL_MS).toBe(60_000);
    expect(shouldNudge(null, 5)).toBe(true);
    expect(shouldNudge(1_000, 1_000 + NUDGE_MS - 1)).toBe(false);
    expect(shouldNudge(1_000, 1_000 + NUDGE_MS)).toBe(true);
  });
});
