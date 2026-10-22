/**
 * P12, the team: Targets (14), One-to-one notes (36) with the one action
 * list, the Weekly meeting (37), Coaching (41), Messages (34) and the New
 * starter (30), on the sample, on the ledger's Tuesday 28 July 2026.
 *
 * WHAT A SPEC MAKES starts "Spec: " (a session's notes, an action, a
 * message) and is taken away after every test; a tick, a target, a read mark
 * and the starter's first-year target are put back as the sample has them.
 * A private session is removed by the manager who wrote it (nobody else can
 * reach it); messages and actions by the install's owner.
 *
 * WHY THE NAME: these files run BEFORE `quotes.e2e.ts`. That spec leaves two
 * deals closed as lost (a sent quote cannot be taken away), which moves the
 * meeting's "win rate, last twelve months" off the ledger's 8 of 26.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { go, me, menu, noSidewaysScroll, room, stat } from "./p12-helpers.ts";

interface ActionRow {
  id: number;
  text: string;
  owner_id: string;
  set_by_id: string;
  done: boolean | number;
  source: string;
  one_to_one_id: number | null;
  meeting_id: number | null;
  coaching_area_id: number | null;
}
const SHARED = "Write the one-page note on paper proposals";
const LEDGER_NOW = "2026-07-28T08:35:00.000Z";
/** Dana's read marks as the sample has them, by the conversation's other words. */
const MARKS: Record<number, string> = { 1: "2026-07-27T15:18:00.000Z", 2: "2026-07-27T08:52:00.000Z", 3: "2026-07-24T13:44:00.000Z", 4: "2026-07-22T10:31:00.000Z" };
const isDone = (value: unknown): boolean => value === true || value === 1;

async function tidy(api: (person: string) => Promise<APIRequestContext>, data: Data): Promise<void> {
  const owner = await api("owner");
  const ownerHeaders = await csrf(owner);
  for (const table of ["actions", "messages"]) {
    for (const row of await rows<{ id: number }>(owner, data, table, { column: "text", op: "like", value: "Spec: %" })) {
      expect((await owner.delete(data(table, `/${String(row.id)}?confirm=true`), { headers: ownerHeaders })).status()).toBeLessThan(300);
    }
  }
  const ivy = await api("ivy");
  const ivyHeaders = await csrf(ivy);
  for (const row of await rows<{ id: number }>(ivy, data, "one_to_one_sessions", { column: "notes", op: "like", value: "Spec: %" })) {
    expect((await ivy.delete(data("one_to_one_sessions", `/${String(row.id)}?confirm=true`), { headers: ivyHeaders })).status()).toBeLessThan(300);
  }
  // The shared action as the sample has it: not done.
  for (const row of await rows<ActionRow>(ivy, data, "actions", { column: "text", op: "eq", value: SHARED })) {
    if (isDone(row.done)) expect((await ivy.patch(data("actions", `/${String(row.id)}`), { data: { values: { done: false } }, headers: ivyHeaders })).status()).toBe(200);
  }
  // Leo's target, the starter's step and first-year target.
  for (const row of await rows<{ id: number; amount: number }>(ivy, data, "targets")) {
    if (Number(row.amount) === 90_000) expect((await ivy.patch(data("targets", `/${String(row.id)}`), { data: { values: { amount: 85_000 } }, headers: ivyHeaders })).status()).toBe(200);
  }
  for (const row of await rows<{ id: number; done: unknown }>(ivy, data, "starter_steps", { column: "text", op: "eq", value: "Add her to the workspace" })) {
    if (isDone(row.done)) expect((await ivy.patch(data("starter_steps", `/${String(row.id)}`), { data: { values: { done: false } }, headers: ivyHeaders })).status()).toBe(200);
  }
  for (const row of await rows<{ id: number; first_year_target: unknown }>(ivy, data, "starters")) {
    if (row.first_year_target !== null) expect((await ivy.patch(data("starters", `/${String(row.id)}`), { data: { values: { first_year_target: null } }, headers: ivyHeaders })).status()).toBe(200);
  }
}

test.afterEach(async ({ api, data }) => {
  await tidy(api, data);
});

const fig = (page: Page, card: string, id: string) => page.getByTestId(card).getByTestId(id);
const tick = (scope: Page | ReturnType<Page["locator"]>, text: string) => scope.getByRole("checkbox", { name: text, exact: true });

/* ─── Targets ─────────────────────────────────────────────────────────────── */

test("a rep's Targets: her own year in the ledger's figures, no team target, and the server answers her no other", async ({ as, api, data, stand }) => {
  const context = await as("priya");
  await room(context.request, data, 80);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}today`);
  await go(page, "My targets");
  await expect(page).toHaveURL(/\/staff\/targets$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My targets");
  await expect(page.getByTestId("tg-period")).toContainText("2026 · to the end of December");
  await expect(page.getByTestId("tg-period")).toContainText("6 months");
  await expect(page.getByTestId("tg-mine-cover")).toHaveText("24% covered");
  await expect(fig(page, "tg-mine", "tg-target").locator(".crm-stat-value")).toHaveText("£95,000");
  await expect(fig(page, "tg-mine", "tg-target")).toContainText("Set by Ivy Sandoval, Jan 5, 2026");
  await expect(fig(page, "tg-mine", "tg-booked").locator(".crm-stat-value")).toHaveText("£11,200");
  await expect(fig(page, "tg-mine", "tg-weighted").locator(".crm-stat-value")).toHaveText("£11,695");
  await expect(fig(page, "tg-mine", "tg-weighted")).toContainText("3 deals in play");
  await expect(fig(page, "tg-mine", "tg-left").locator(".crm-stat-value")).toHaveText("£72,105");
  await expect(page.getByTestId("tg-pace")).toContainText("Even pace puts you at £54,397 booked by today. You are £43,197 short, and the open work covers it if it lands.");
  await expect(page.getByTestId("tg-biggest")).toContainText("Clinic waiting-room seating");
  await expect(page.getByTestId("tg-biggest")).toContainText("£12,400");
  // Ruling F5: no team target, nobody else's row.
  await expect(page.getByTestId("tg-team")).toHaveCount(0);
  await expect(page.locator(".crm-tg-row")).toHaveCount(0);

  // The server, asked as Priya: one target, hers; one figure toward it; no write.
  const priya = context.request;
  const hers = await rows<{ id: number; rep_id: string; amount: number }>(priya, data, "targets");
  expect(hers.length).toBe(1);
  expect(hers[0]).toMatchObject({ rep_id: await me(priya), amount: 95_000 });
  const danas = (await rows<{ id: number; rep_id: string }>(await api("ivy"), data, "targets", { column: "rep_id", op: "eq", value: await me(await api("dana")) }))[0]!;
  expect((await priya.get(data("targets", `/${String(danas.id)}`))).status()).toBe(404);
  const headers = await csrf(priya);
  expect((await priya.patch(data("targets", `/${String(hers[0]!.id)}`), { data: { values: { amount: 1 } }, headers })).status()).toBe(403);
  const toward = await priya.post("/api/v1/widget-data/query", {
    data: {
      descriptor: {
        connectionId: stand.connectionId,
        source: { name: stand.tables["crm_deals"] },
        shape: "single-metric",
        filters: [{ column: "owner_id", op: "eq", value: await me(priya) }, { or: [{ column: "state", op: "eq", value: "open" }, { and: [{ column: "state", op: "eq", value: "won" }, { column: "closed_on", op: "between", value: ["2026-01-01", "2026-12-31"] }] }] }],
        aggregations: [{ fn: "sum", column: "target_value", alias: "sum" }],
      },
    },
    headers,
  });
  // 11,200 booked and 11,695 weighted, as ONE sum of the server's: 22,895 of 95,000 is the 24 % on screen.
  expect(((await toward.json()) as { result: { value: number } }).result.value).toBe(22_895);
  const all = await priya.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: stand.tables["crm_targets"] }, shape: "single-metric", aggregations: [{ fn: "sum", column: "amount", alias: "sum" }] } }, headers });
  expect(((await all.json()) as { result: { value: number } }).result.value).toBe(95_000);
  await picture(page, "targets-1-priya");
  expect(problems).toEqual([]);
});

test("the manager's Team targets in the ledger's figures; she sets Leo's and his open page follows (two people); Read-only changes nothing", async ({ as, api, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 100);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}week`);
  await go(page, "Team targets");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team targets");
  await expect(page.getByTestId("tg-team-cover")).toHaveText("53% covered");
  await expect(fig(page, "tg-team", "tg-target").locator(".crm-stat-value")).toHaveText("£450,000");
  await expect(fig(page, "tg-team", "tg-target")).toContainText("4 sales reps");
  await expect(fig(page, "tg-team", "tg-booked").locator(".crm-stat-value")).toHaveText("£81,600");
  await expect(fig(page, "tg-team", "tg-weighted").locator(".crm-stat-value")).toHaveText("£156,562.50");
  await expect(fig(page, "tg-team", "tg-left").locator(".crm-stat-value")).toHaveText("£211,837.50");
  await expect(page.locator(".crm-tg-row")).toHaveCount(4);
  const row = (name: string) => page.locator(".crm-tg-row", { hasText: name });
  const cell = (name: string, id: string) => row(name).locator(`[data-cell="${id}"]`);
  await expect(cell("Dana Whitlock", "booked")).toHaveText("£28,400");
  await expect(cell("Dana Whitlock", "weighted")).toHaveText("£95,740");
  await expect(cell("Dana Whitlock", "target")).toContainText("£140,000");
  await expect(cell("Dana Whitlock", "cover")).toHaveText("89%");
  await expect(cell("Dana Whitlock", "gap")).toHaveText("£15,860 still to find");
  await expect(cell("Dana Whitlock", "biggest")).toContainText("Fourth-floor desk rows");
  await expect(row("Dana Whitlock")).toContainText("6 open deals");
  await expect(cell("Sam Okonjo", "cover")).toHaveText("55%");
  await expect(cell("Priya Raman", "cover")).toHaveText("24%");
  await expect(cell("Leo Vance", "weighted")).toHaveText("£4,537.50");
  await expect(cell("Leo Vance", "cover")).toHaveText("24%");
  await expect(cell("Leo Vance", "gap")).toHaveText("£64,862.50 still to find");

  // Leo has his own page open.
  const leoContext = await as("leo");
  const leoPage = await leoContext.newPage();
  await leoPage.goto(`${STAFF}targets`);
  await expect(fig(leoPage, "tg-mine", "tg-target").locator(".crm-stat-value")).toHaveText("£85,000");

  // Ivy presses his figure, types a new one in her own language's way, and sets it by keyboard.
  await row("Leo Vance").getByRole("button", { name: "Change the target of Leo, now £85,000" }).click();
  const box = row("Leo Vance").getByLabel("Target of Leo");
  await expect(box).toBeFocused();
  await box.fill("90,000");
  await box.press("Enter");
  await expect(page.locator(".crm-toast")).toHaveText("The target of Leo is now £90,000.");
  await expect(cell("Leo Vance", "target")).toContainText("£90,000");
  await expect(cell("Leo Vance", "cover")).toHaveText("22%");
  await expect(fig(page, "tg-team", "tg-target").locator(".crm-stat-value")).toHaveText("£455,000");
  await expect(row("Leo Vance").getByRole("button", { name: /^Change the target of Leo/ })).toBeFocused();
  const leo = await me(leoContext.request);
  const held = (await rows<{ amount: number; set_by_id: string }>(context.request, data, "targets", { column: "rep_id", op: "eq", value: leo }))[0]!;
  expect(held).toMatchObject({ amount: 90_000, set_by_id: await me(context.request) });
  // Leo's open page follows with no reload.
  await expect(fig(leoPage, "tg-mine", "tg-target").locator(".crm-stat-value")).toHaveText("£90,000");
  await expect(leoPage.getByTestId("tg-mine-cover")).toHaveText("22% covered");
  await picture(page, "targets-2-ivy");

  // Read-only: the same figures, nothing to press, and the server refuses the write.
  const graceContext = await as("grace");
  const gracePage = await graceContext.newPage();
  await gracePage.goto(`${STAFF}targets`);
  await expect(gracePage.getByRole("heading", { level: 1 })).toHaveText("Team targets");
  await expect(gracePage.locator(".crm-tg-row")).toHaveCount(4);
  await expect(gracePage.locator(".crm-tg-figure")).toHaveCount(0);
  const target = (await rows<{ id: number }>(graceContext.request, data, "targets"))[0]!;
  expect((await graceContext.request.patch(data("targets", `/${String(target.id)}`), { data: { values: { amount: 1 } }, headers: await csrf(graceContext.request) })).status()).toBe(403);
  // The marketer reads no target.
  const lena = await as("lena");
  expect((await lena.request.get(data("targets", "?limit=1"))).status()).toBe(403);
  const hers = await lena.newPage();
  await hers.goto(`${STAFF}targets`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  expect(problems).toEqual([]);
  void api;
});

/* ─── One-to-one notes, and the one action list ───────────────────────────── */

test("One-to-one notes: the ledger's record for Dana and Priya; a new session with its actions (a lost reply makes one)", async ({ as, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 140);
  const ivy = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}week`);
  await go(page, "One-to-one notes");
  await expect(page).toHaveURL(/\/staff\/one-to-ones$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("One-to-one notes");
  await expect(page.getByTestId("notes-private")).toContainText("Private to the two of you.");
  await expect(page.locator(".crm-tw-people .crm-chip-btn")).toHaveCount(4);

  // Dana first: Thu 30 Jul 09:00 in 2 days, three sessions, five actions with two still open.
  await expect(page.getByTestId("notes-who")).toContainText("Dana Whitlock");
  await expect(page.getByTestId("notes-next")).toContainText("Thu, Jul 30");
  await expect(page.getByTestId("notes-next")).toContainText("09:00");
  await expect(page.getByTestId("notes-next")).toContainText("in 2 days");
  await expect(page.locator(".crm-no-session")).toHaveCount(3);
  await expect(page.locator(".crm-no-session").first().locator(".crm-no-session-head")).toHaveText("Thu, Jul 1612 days ago");
  await expect(page.locator(".crm-no-session").nth(2).locator(".crm-no-session-head")).toContainText("40 days ago");
  await expect(page.getByTestId("notes-open-count")).toHaveText("2 of 5");
  await expect(page.getByTestId("notes-open").locator(".crm-tw-action")).toHaveCount(5);
  await expect(page.getByTestId("notes-done").locator(".crm-tw-action")).toHaveCount(3);
  await expect(page.locator('[data-stat="cover"]')).toHaveText("89%");
  await expect(page.locator('[data-stat="weighted"]')).toHaveText("£95,740");
  await expect(page.locator('[data-stat="deals"]')).toHaveText("6");
  await expect(page.locator('[data-stat="booked"]')).toHaveText("£28,400");
  const raise = page.getByTestId("notes-raise");
  await expect(raise.locator('[data-raise="sitting"]')).toContainText("Acoustic booths for the studio floor has sat in Proposal for 20 days.");
  await expect(raise.locator('[data-raise="biggest"]')).toContainText("Where Fourth-floor desk rows really stands: £52,800 on the line.");
  await expect(raise.locator('[data-raise="target"]')).toContainText("On for the year? 89% covered, £15,860 still to find.");
  await expect(raise.locator('[data-raise="late"]')).toContainText("3 follow-ups are past due in the queue.");

  // Priya: Thu 30 Jul 10:00, two sessions, two actions with one still open.
  await page.locator(".crm-tw-people").getByRole("button", { name: "Priya" }).click();
  await expect(page.getByTestId("notes-who")).toContainText("Priya Raman");
  await expect(page.getByTestId("notes-next")).toContainText("10:00");
  await expect(page.locator(".crm-no-session")).toHaveCount(2);
  await expect(page.getByTestId("notes-open-count")).toHaveText("1 of 2");
  await expect(page.locator('[data-stat="cover"]')).toHaveText("24%");
  // The one still open is the row all three lists share, and says so.
  await expect(page.getByTestId("notes-open").locator(".crm-tw-action", { hasText: SHARED })).toContainText("also in coaching · also in the meeting");

  // A new session: Escape closes the form and gives the focus back; then it is written.
  await page.getByTestId("notes-new").click();
  let form = page.getByRole("form", { name: "New session" });
  await expect(form.getByLabel("What we talked about, one line each")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("notes-new")).toBeFocused();
  await page.getByTestId("notes-new").click();
  form = page.getByRole("form", { name: "New session" });
  await expect(form).toContainText("With Priya Raman");
  await expect(form.getByLabel("Date")).toHaveValue("2026-07-28");
  await expect(form.getByRole("button", { name: "Save the session" })).toBeDisabled();
  await form.getByLabel("What we talked about, one line each").fill("Spec: the Fernway visit went well.\nSpec: the bigger piece of work is worth asking for.");
  await form.getByLabel("Action 1", { exact: true }).fill("Spec: send Fernway the full-floor layout");
  await form.getByLabel("Action 1, due").fill("2026-07-31");
  await form.getByRole("button", { name: "Add an action" }).click();
  await form.getByLabel("Action 2", { exact: true }).fill("Spec: Ivy rings the Fernway buyer");
  await form.getByLabel("Action 2, owner").selectOption({ label: "Ivy Sandoval" });
  let dropped = false;
  const sent: string[] = [];
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_one_to_one_sessions$/.test(new URL(request.url()).pathname)) return route.fallback();
    sent.push((request.postDataJSON() as { clientKey: string }).clientKey);
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      return route.abort("connectionreset");
    }
    await route.fulfill({ response });
  });
  await form.getByRole("button", { name: "Save the session" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Session saved with 2 actions.");
  await page.unroute("**/api/v1/data/**");
  // Sent twice with one key, made once.
  expect(sent.length).toBe(2);
  expect(sent[0]).toBe(sent[1]);
  expect((await rows(ivy, data, "one_to_one_sessions", { column: "notes", op: "like", value: "Spec: %" })).length).toBe(1);
  await expect(page.locator(".crm-no-session")).toHaveCount(3);
  await expect(page.locator(".crm-no-session").first().locator(".crm-no-session-head")).toHaveText("Tue, Jul 28today");
  await expect(page.locator(".crm-no-session").first().locator("p")).toHaveCount(2);
  await expect(page.getByTestId("notes-open-count")).toHaveText("3 of 4");
  const made = await rows<ActionRow & { due_on: string | null }>(ivy, data, "actions", { column: "text", op: "like", value: "Spec: %" });
  expect(made.length).toBe(2);
  expect(made.every((action) => action.source === "one-to-one" && action.one_to_one_id !== null && action.set_by_id !== "")).toBe(true);
  expect(made.find((action) => action.text.includes("layout"))!.due_on?.slice(0, 10)).toBe("2026-07-31");
  await expect(page.getByTestId("notes-open").locator(".crm-tw-action", { hasText: "Spec: send Fernway the full-floor layout" })).toContainText("Priya · due Fri, Jul 31");

  // Ticked here, it is done on the server and moves under "Ticked off".
  await tick(page, "Spec: Ivy rings the Fernway buyer").click();
  await expect(page.locator(".crm-toast")).toHaveText("Done.");
  await expect(page.getByTestId("notes-open-count")).toHaveText("2 of 4");
  await expect(page.getByTestId("notes-done").getByRole("checkbox", { name: "Spec: Ivy rings the Fernway buyer" })).toBeChecked();
  await picture(page, "notes-1-ivy");
  // The dropped reply this spec staged is the only thing that went wrong on the page.
  expect(problems.filter((problem) => !/ERR_CONNECTION_RESET/.test(problem))).toEqual([]);
});

test("a one-to-one is private to its two people: the CRM admin, Read-only and the install's owner are answered nothing; a rep reads her own and writes no session", async ({ as, api, data }) => {
  const ivy = await api("ivy");
  const pairs = await rows<{ id: number; rep_id: string }>(ivy, data, "one_to_ones");
  expect(pairs.length).toBe(4);
  const sessions = await rows<{ id: number; one_to_one_id: number }>(ivy, data, "one_to_one_sessions");
  expect(sessions.length).toBe(9);
  const plans = await rows<{ id: number }>(ivy, data, "coaching_plans");
  const areas = await rows<{ id: number }>(ivy, data, "coaching_areas");
  expect([plans.length, areas.length]).toEqual([4, 8]);

  // The CRM admin and Read-only: refused each of the four tables, by list and by key.
  for (const person of ["tessa", "grace"]) {
    const who = await api(person);
    for (const [table, id] of [["one_to_ones", pairs[0]!.id], ["one_to_one_sessions", sessions[0]!.id], ["coaching_plans", plans[0]!.id], ["coaching_areas", areas[0]!.id]] as const) {
      expect((await who.get(data(table, "?limit=5"))).status(), `${person} lists ${table}`).toBe(403);
      expect((await who.get(data(table, `/${String(id)}`))).status(), `${person} opens ${table}`).toBe(403);
      expect((await who.get(data(table, `/${String(id)}/history`))).status(), `${person} reads the history of ${table}`).toBe(403);
    }
  }
  // The install's owner reaches every other table whole, and of these not one row.
  const owner = await api("owner");
  expect((await rows(owner, data, "actions")).length).toBe(25);
  for (const [table, id] of [["one_to_ones", pairs[0]!.id], ["one_to_one_sessions", sessions[0]!.id], ["coaching_plans", plans[0]!.id], ["coaching_areas", areas[0]!.id]] as const) {
    expect(await rows(owner, data, table), `the owner lists ${table}`).toEqual([]);
    expect((await owner.get(data(table, `/${String(id)}`))).status(), `the owner opens ${table}`).toBe(404);
    expect((await owner.get(data(table, `/${String(id)}/history`))).status(), `the owner reads the history of ${table}`).toBe(404);
    expect((await owner.delete(data(table, `/${String(id)}?confirm=true`), { headers: await csrf(owner) })).status(), `the owner removes from ${table}`).toBe(404);
  }
  // Nothing was removed.
  expect((await rows(ivy, data, "one_to_one_sessions")).length).toBe(9);

  // The CRM admin's page at that address is not hers, and her menu has no such line.
  const tessa = await as("tessa");
  const page = await tessa.newPage();
  await page.goto(`${STAFF}one-to-ones`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  await expect(menu(page).getByRole("link", { name: /One-to-one|Coaching/ })).toHaveCount(0);
  await page.goto(`${STAFF}coaching`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");

  // A rep: her own one-to-one and no colleague's; she reads the sessions and writes none.
  const samContext = await as("sam");
  const sam = samContext.request;
  const mine = await rows<{ id: number; rep_id: string }>(sam, data, "one_to_ones");
  expect(mine.map((pair) => pair.rep_id)).toEqual([await me(sam)]);
  const danas = pairs.find((pair) => pair.rep_id !== mine[0]!.rep_id)!;
  expect((await sam.get(data("one_to_ones", `/${String(danas.id)}`))).status()).toBe(404);
  expect(await rows(sam, data, "one_to_one_sessions", { column: "one_to_one_id", op: "eq", value: danas.id })).toEqual([]);
  const headers = await csrf(sam);
  expect((await sam.post(data("one_to_one_sessions"), { data: { values: { one_to_one_id: mine[0]!.id, manager_id: await me(ivy), rep_id: await me(sam), held_on: "2026-07-28", notes: "Spec: no" } }, headers })).status()).toBe(403);
  const samPage = await samContext.newPage();
  await samPage.goto(`${STAFF}today`);
  await go(samPage, "My one-to-ones");
  await expect(samPage.getByRole("heading", { level: 1 })).toHaveText("My one-to-ones");
  await expect(samPage.getByTestId("notes-who")).toContainText("Sam Okonjo");
  await expect(samPage.getByTestId("notes-who")).toContainText("With Ivy Sandoval, your manager");
  await expect(samPage.getByTestId("notes-next")).toContainText("Fri, Jul 31");
  await expect(samPage.locator(".crm-no-session")).toHaveCount(2);
  await expect(samPage.getByTestId("notes-open-count")).toHaveText("1 of 2");
  await expect(samPage.locator('[data-stat="cover"]')).toHaveText("55%");
  await expect(samPage.locator(".crm-tw-people")).toHaveCount(0);
  await expect(samPage.getByTestId("notes-new")).toHaveCount(0);
  await picture(samPage, "notes-2-sam");
});

test("the three action lists are one list: ticked in One-to-one notes, it is ticked in Coaching and the meeting, and a rep's open page follows (two people)", async ({ as, data }) => {
  const ivyContext = await as("ivy");
  await room(ivyContext.request, data, 120);
  const priyaContext = await as("priya");
  // Priya has her coaching open.
  const priyaPage = await priyaContext.newPage();
  await priyaPage.goto(`${STAFF}today`);
  await go(priyaPage, "My coaching");
  await expect(priyaPage.getByRole("heading", { level: 1 })).toHaveText("My coaching");
  // Her manager counts four steps on this plan (the ledger's "1 of 4"); Priya is answered the three that are hers.
  // The fourth is her manager's own ("Ivy sits in on one first meeting"), and a rep reads the actions she owns or set.
  const hers = await rows<ActionRow>(priyaContext.request, data, "actions", { column: "source", op: "eq", value: "coaching" });
  expect(hers.length + (await rows<ActionRow>(priyaContext.request, data, "actions", { and: [{ column: "source", op: "neq", value: "coaching" }, { column: "coaching_area_id", op: "not_null" }] })).length).toBe(3);
  await expect(priyaPage.getByTestId("co-progress")).toContainText("1 of 3 done");
  await expect(tick(priyaPage, SHARED)).not.toBeChecked();
  await expect(priyaPage.locator(".crm-tw-action", { hasText: SHARED })).toContainText("also in one-to-one · also in the meeting");

  // Ivy ticks it in One-to-one notes.
  const page = await ivyContext.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}one-to-ones`);
  await page.locator(".crm-tw-people").getByRole("button", { name: "Priya" }).click();
  await expect(page.getByTestId("notes-open-count")).toHaveText("1 of 2");
  await tick(page, SHARED).click();
  await expect(page.locator(".crm-toast")).toHaveText("Done.");
  await expect(page.getByTestId("notes-open-count")).toHaveText("0 of 2");
  await expect(page.getByTestId("notes-open")).toContainText("Nothing outstanding. Rare and worth saying out loud.");
  const row = (await rows<ActionRow>(ivyContext.request, data, "actions", { column: "text", op: "eq", value: SHARED }))[0]!;
  expect(isDone(row.done)).toBe(true);
  expect([row.one_to_one_id, row.meeting_id, row.coaching_area_id].every((link) => link !== null)).toBe(true);

  // Priya's open Coaching follows with no reload: the same row, ticked, and one more step done.
  await expect(tick(priyaPage, SHARED)).toBeChecked();
  await expect(priyaPage.getByTestId("co-progress")).toContainText("2 of 3 done");

  // It is ticked in the manager's Coaching and in the meeting too.
  await go(page, "Coaching");
  await page.locator(".crm-tw-people").getByRole("button", { name: "Priya" }).click();
  await expect(page.getByTestId("co-progress")).toContainText("2 of 4 done");
  await expect(tick(page, SHARED)).toBeChecked();
  await go(page, "Weekly meeting");
  await expect(tick(page, SHARED)).toBeChecked();
  // The tick taken off in the meeting comes off in Priya's Coaching.
  await tick(page, SHARED).click();
  await expect(page.locator(".crm-toast")).toHaveText("Open again.");
  await expect(tick(priyaPage, SHARED)).not.toBeChecked();
  await expect(priyaPage.getByTestId("co-progress")).toContainText("1 of 3 done");
  expect(problems).toEqual([]);
});

/* ─── The weekly meeting ──────────────────────────────────────────────────── */

test("the Weekly meeting: when, the five numbers, the running order with the deals each rep brings, the actions, last week's decisions", async ({ as, api, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 100);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}week`);
  await go(page, "Weekly meeting");
  await expect(page).toHaveURL(/\/staff\/weekly-meeting$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Weekly team meeting");
  await expect(page.getByTestId("mt-when")).toContainText("Monday, August 3, 2026");
  await expect(page.getByTestId("mt-when")).toContainText("09:30");
  await expect(page.getByTestId("mt-when")).toContainText("30 minutes, ends 10:00 · in 6 days");
  await expect(page.locator(".crm-mt-people .crm-avatar")).toHaveCount(5);

  await expect(stat(page, "mt-weighted")).toHaveText("£156,562.50");
  await expect(page.getByTestId("mt-weighted")).toContainText("14 deals");
  await expect(page.getByTestId("mt-month")).toContainText("August");
  await expect(stat(page, "mt-month")).toHaveText("£87,670");
  await expect(page.getByTestId("mt-month")).toContainText("5 expected to close");
  await expect(stat(page, "mt-rate")).toHaveText("31%");
  await expect(page.getByTestId("mt-rate")).toContainText("8 of 26, last twelve months");
  await expect(stat(page, "mt-cycle")).toHaveText("54 days");
  await expect(stat(page, "mt-stale")).toHaveText("2");

  // Six items, five minutes each, from 09:30.
  const slots = page.getByTestId("mt-order").locator(".crm-mt-slot");
  await expect(slots).toHaveCount(6);
  await expect(slots.locator(".crm-mt-slot-at strong")).toHaveText(["09:30", "09:35", "09:40", "09:45", "09:50", "09:55"]);
  await expect(slots.locator(".crm-mt-slot-main > strong")).toHaveText(["Where we are", "Dana", "Priya", "Sam", "Leo", "Anything else"]);
  await expect(slots.nth(1)).toContainText("6 deals in play");
  await expect(slots.nth(1).locator(".crm-chip")).toHaveCount(2);
  await expect(slots.nth(1)).toContainText("Fourth-floor desk rows");
  await expect(slots.nth(1)).toContainText("Acoustic booths for the studio floor");
  await expect(slots.nth(2)).toContainText("Clinic waiting-room seating");
  await expect(slots.nth(2)).toContainText("Lab bench stools");
  await expect(slots.nth(3).locator(".crm-chip")).toHaveText(["Showroom refit, phase one£38,000"]);
  await expect(slots.nth(4).locator(".crm-chip")).toHaveText(["Depot supervisor stations£14,250"]);

  // Three actions, none done; three decisions of last time, one carried over.
  const actions = page.getByTestId("mt-actions").locator(".crm-tw-action");
  await expect(actions).toHaveCount(3);
  await expect(page.getByTestId("mt-actions").getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(page.getByTestId("mt-last").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("mt-last").locator(".crm-pill")).toHaveText(["Done", "Done", "Carried over"]);

  // Written down: a row of the one list, the meeting's, hers.
  await page.getByLabel("What we agreed").fill("Spec: agree who covers in August");
  await page.keyboard.press("Enter");
  await expect(page.locator(".crm-toast")).toHaveText("Written down.");
  await expect(actions).toHaveCount(4);
  await expect(page.getByLabel("What we agreed")).toHaveValue("");
  const made = (await rows<ActionRow>(context.request, data, "actions", { column: "text", op: "eq", value: "Spec: agree who covers in August" }))[0]!;
  expect(made).toMatchObject({ source: "meeting", owner_id: await me(context.request) });
  expect(made.meeting_id).not.toBeNull();
  await picture(page, "meeting-1-ivy");

  // A rep: her own five numbers (and the heading says so), and the actions the server lets her read.
  const priyaContext = await as("priya");
  const priyaPage = await priyaContext.newPage();
  await priyaPage.goto(`${STAFF}weekly-meeting`);
  await expect(priyaPage.locator(".crm-mt-numbers-head")).toHaveText("Where you are: your own deals");
  await expect(stat(priyaPage, "mt-weighted")).toHaveText("£11,695");
  await expect(priyaPage.getByTestId("mt-weighted")).toContainText("3 deals");
  await expect(priyaPage.getByTestId("mt-actions").locator(".crm-tw-action")).toHaveCount(1);
  await expect(priyaPage.getByTestId("mt-actions")).toContainText(SHARED);
  await expect(priyaPage.getByTestId("mt-order").locator(".crm-mt-slot")).toHaveCount(6);

  // Read-only reads the meeting, not the action list, and the server refuses her an action; the CRM admin reads the list and adds nothing.
  const graceContext = await as("grace");
  const gracePage = await graceContext.newPage();
  await gracePage.goto(`${STAFF}weekly-meeting`);
  await expect(stat(gracePage, "mt-weighted")).toHaveText("£156,562.50");
  await expect(gracePage.getByTestId("mt-actions")).toContainText("The action list is not part of your role.");
  await expect(gracePage.getByLabel("What we agreed")).toHaveCount(0);
  const meeting = (await rows<{ id: number }>(graceContext.request, data, "meetings"))[0]!;
  for (const person of ["grace", "tessa"]) {
    const who = await api(person);
    const refused = await who.post(data("actions"), { data: { values: { text: "Spec: no", owner_id: await me(who), source: "meeting", meeting_id: meeting.id } }, headers: await csrf(who) });
    expect(refused.status(), person).toBe(403);
  }
  expect((await graceContext.request.get(data("actions", "?limit=1"))).status()).toBe(403);
  const tessaPage = await (await as("tessa")).newPage();
  await tessaPage.goto(`${STAFF}weekly-meeting`);
  await expect(tessaPage.getByTestId("mt-actions")).toContainText("Nothing written down yet.");
  await expect(tessaPage.getByLabel("What we agreed")).toHaveCount(0);
  expect(problems).toEqual([]);
});

/* ─── Coaching ────────────────────────────────────────────────────────────── */

test("Coaching: the ledger's plans for the manager; a rep adds a step to her own and to nobody else's", async ({ as, api, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 80);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}coaching`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Coaching");
  await expect(page.getByTestId("co-who")).toContainText("Dana Whitlock");
  await expect(page.getByTestId("co-who")).toContainText("Runs to Sat, Oct 31");
  await expect(page.getByTestId("co-review")).toContainText("Fri, Oct 2");
  await expect(page.getByTestId("co-review")).toContainText("9 weeks away");
  await expect(page.getByTestId("co-progress")).toContainText("2 of 5 done");
  const areas = page.locator(".crm-co-area");
  await expect(areas).toHaveCount(2);
  await expect(areas.locator("h2")).toHaveText(["Follow-ups on the day they are due", "Ask for the decision earlier"]);
  await expect(areas.nth(0).locator(".crm-tw-action")).toHaveCount(3);
  await expect(areas.nth(1).locator(".crm-tw-action")).toHaveCount(2);
  await expect(areas.nth(0).locator(".crm-tw-action", { hasText: "Clear the overdue queue every Friday afternoon" })).toContainText("also in one-to-one");
  for (const [name, progress] of [["Priya", "1 of 4 done"], ["Sam", "1 of 3 done"], ["Leo", "2 of 4 done"]] as const) {
    await page.locator(".crm-tw-people").getByRole("button", { name }).click();
    await expect(page.getByTestId("co-progress")).toContainText(progress);
  }
  await picture(page, "coaching-1-ivy");

  // Sam, on his own plan.
  const samContext = await as("sam");
  const samPage = await samContext.newPage();
  await samPage.goto(`${STAFF}coaching`);
  await expect(samPage.getByRole("heading", { level: 1 })).toHaveText("My coaching");
  await expect(samPage.getByTestId("co-progress")).toContainText("1 of 3 done");
  await samPage.getByLabel("Something to practise").fill("Spec: ask for the visit before the price");
  await samPage.getByRole("button", { name: "Add a step" }).click();
  await expect(samPage.locator(".crm-toast")).toHaveText("Added. That is the work.");
  await expect(samPage.getByTestId("co-progress")).toContainText("1 of 4 done");
  await expect(samPage.locator(".crm-co-area").first().locator(".crm-tw-action", { hasText: "Spec: ask for the visit before the price" })).toHaveCount(1);
  // A step under a colleague's area is refused him, as a link to a row that is not there.
  const sam = samContext.request;
  const danasArea = (await rows<{ id: number; rep_id: string }>(await api("ivy"), data, "coaching_areas", { column: "rep_id", op: "eq", value: await me(await api("dana")) }))[0]!;
  const refused = await sam.post(data("actions"), { data: { values: { text: "Spec: no", owner_id: await me(sam), source: "coaching", coaching_area_id: danasArea.id } }, headers: await csrf(sam) });
  expect(refused.status()).toBe(409);
  expect(await rows(sam, data, "coaching_areas", { column: "id", op: "eq", value: danasArea.id })).toEqual([]);
  expect(problems).toEqual([]);
});

/* ─── Messages ────────────────────────────────────────────────────────────── */

async function putMarksBack(api: (person: string) => Promise<APIRequestContext>, data: Data): Promise<void> {
  const dana = await api("dana");
  const id = await me(dana);
  const headers = await csrf(dana);
  for (const member of await rows<{ id: number; thread_id: number }>(dana, data, "thread_members", { column: "user_id", op: "eq", value: id })) {
    const mark = MARKS[member.thread_id];
    if (mark !== undefined) expect((await dana.patch(data("thread_members", `/${String(member.id)}`), { data: { values: { read_at: mark } }, headers })).status()).toBe(200);
  }
  const ivy = await api("ivy");
  for (const member of await rows<{ id: number; read_at: string | null }>(ivy, data, "thread_members", { column: "user_id", op: "eq", value: await me(ivy) })) {
    if (member.read_at !== null) expect((await ivy.patch(data("thread_members", `/${String(member.id)}`), { data: { values: { read_at: null } }, headers: await csrf(ivy) })).status()).toBe(200);
  }
}

test("Messages: the ledger's four conversations and three unread; read, answered (a lost reply sends one), and live between two people", async ({ as, api, data }) => {
  await putMarksBack(api, data);
  try {
    const context = await as("dana");
    await room(context.request, data, 160);
    const dana = context.request;
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}today`);
    await go(page, "Messages");
    await expect(page).toHaveURL(/\/staff\/messages$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Messages");
    const threads = page.locator(".crm-ms-thread");
    await expect(threads).toHaveCount(4);
    // Whoever wrote last comes first.
    await expect(threads.locator(".crm-ms-thread-top strong")).toHaveText(["The four of us", "Ivy Sandoval", "Leo Vance", "Priya Raman"]);
    await expect(threads.nth(0).locator(".crm-ms-badge")).toHaveText("2");
    await expect(threads.nth(1).locator(".crm-ms-badge")).toHaveText("1");
    await expect(page.locator(".crm-ms-badge")).toHaveCount(2);
    await expect(threads.nth(2).locator(".crm-ms-preview")).toContainText("You: Noted.");
    // The same unread, counted by the server for Dana: messages by somebody else since her own mark.
    const id = await me(dana);
    let unread = 0;
    for (const member of await rows<{ thread_id: number; read_at: string }>(dana, data, "thread_members", { column: "user_id", op: "eq", value: id })) {
      unread += (await rows(dana, data, "messages", { and: [{ column: "thread_id", op: "eq", value: member.thread_id }, { column: "author_id", op: "neq", value: id }, { column: "at", op: "gt", value: member.read_at }] })).length;
    }
    expect(unread).toBe(3);
    expect((await rows(dana, data, "messages")).length).toBe(12);

    // The group shown on arrival: four members, four messages, hers on the far side.
    const talk = page.getByTestId("msgs-talk");
    await expect(talk.locator(".crm-ms-talk-head")).toContainText("The four of us");
    await expect(talk.locator(".crm-ms-talk-head")).toContainText("Dana, Priya, Sam, Leo");
    await expect(talk.locator(".crm-ms-msg")).toHaveCount(4);

    // Ivy's conversation: opening it reads it.
    await threads.nth(1).click();
    await expect(talk.locator(".crm-ms-talk-head")).toContainText("Ivy Sandoval");
    await expect(talk.locator(".crm-ms-msg")).toHaveCount(3);
    await expect(talk.locator('.crm-ms-msg[data-mine="1"]')).toHaveCount(1);
    await expect(talk.locator(".crm-ms-msg").last()).toContainText("can you sit in on one of Nia’s first calls next week?");
    await expect(page.locator(".crm-ms-thread", { hasText: "Ivy Sandoval" }).locator(".crm-ms-badge")).toHaveCount(0);
    await expect(page.locator(".crm-ms-badge")).toHaveCount(1);
    const mark = (await rows<{ read_at: string }>(dana, data, "thread_members", { and: [{ column: "user_id", op: "eq", value: id }, { column: "thread_id", op: "eq", value: 1 }] }))[0]!;
    expect(Date.parse(mark.read_at)).toBeGreaterThanOrEqual(Date.parse(LEDGER_NOW));

    // Ivy has her side open: one conversation, with Dana.
    const ivyContext = await as("ivy");
    const ivyPage = await ivyContext.newPage();
    await ivyPage.goto(`${STAFF}messages`);
    await expect(ivyPage.locator(".crm-ms-thread")).toHaveCount(1);
    await expect(ivyPage.locator(".crm-ms-thread-top strong")).toHaveText("Dana Whitlock");
    await expect(ivyPage.getByTestId("msgs-talk").locator(".crm-ms-msg")).toHaveCount(3);

    // Dana answers; the reply to her send is dropped on the way back.
    let dropped = false;
    const sent: string[] = [];
    await page.route("**/api/v1/data/**", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !/crm_messages$/.test(new URL(request.url()).pathname)) return route.fallback();
      sent.push((request.postDataJSON() as { clientKey: string }).clientKey);
      const response = await route.fetch();
      if (!dropped) {
        dropped = true;
        return route.abort("connectionreset");
      }
      await route.fulfill({ response });
    });
    await page.getByLabel("A message to Ivy Sandoval").fill("Spec: yes, Tuesday works.");
    await page.keyboard.press("Enter");
    await expect(talk.locator(".crm-ms-msg")).toHaveCount(4);
    await page.unroute("**/api/v1/data/**");
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe(sent[1]);
    const mine = await rows<{ author_id: string; at: string }>(dana, data, "messages", { column: "text", op: "eq", value: "Spec: yes, Tuesday works." });
    expect(mine.length).toBe(1);
    // Who wrote it and when are the server's.
    expect(mine[0]!.author_id).toBe(id);
    expect(Date.parse(mine[0]!.at)).toBeGreaterThanOrEqual(Date.parse(LEDGER_NOW));
    await expect(talk.locator(".crm-ms-msg").last()).toHaveAttribute("data-mine", "1");
    await expect(page.getByLabel("A message to Ivy Sandoval")).toHaveValue("");

    // Live, two people: Ivy's open page shows it with no reload; she answers and Dana's shows hers.
    await expect(ivyPage.getByTestId("msgs-talk").locator(".crm-ms-msg").last()).toContainText("Spec: yes, Tuesday works.");
    await ivyPage.getByLabel("A message to Dana Whitlock").fill("Spec: good, I will tell Nia.");
    await ivyPage.getByRole("button", { name: "Send" }).click();
    await expect(talk.locator(".crm-ms-msg").last()).toContainText("Spec: good, I will tell Nia.");
    await expect(talk.locator(".crm-ms-msg")).toHaveCount(5);

    // Mark all as read: the group's two go too.
    await page.getByTestId("msgs-read-all").click();
    await expect(page.locator(".crm-toast")).toHaveText("All read.");
    await expect(page.locator(".crm-ms-badge")).toHaveCount(0);
    await expect(page.getByTestId("msgs-read-all")).toHaveCount(0);
    await picture(page, "messages-1-dana");

    // What the server refuses, by direct call. Ivy is not in the group: its messages are not there for her, and she writes none into it.
    const ivy = ivyContext.request;
    expect(await rows(ivy, data, "messages", { column: "thread_id", op: "eq", value: 2 })).toEqual([]);
    expect((await ivy.get(data("threads", "/2"))).status()).toBe(404);
    expect((await ivy.post(data("messages"), { data: { values: { thread_id: 2, text: "Spec: no" } }, headers: await csrf(ivy) })).status()).toBe(409);
    // A member moves her own mark and nobody else's.
    const ivysRow = (await rows<{ id: number }>(ivy, data, "thread_members", { column: "user_id", op: "eq", value: await me(ivy) }))[0]!;
    expect((await dana.patch(data("thread_members", `/${String(ivysRow.id)}`), { data: { values: { read_at: LEDGER_NOW } }, headers: await csrf(dana) })).status()).toBe(404);
    // Nobody rewrites a message, their own included.
    const first = (await rows<{ id: number }>(dana, data, "messages", { column: "author_id", op: "eq", value: id }))[0]!;
    expect((await dana.patch(data("messages", `/${String(first.id)}`), { data: { values: { text: "Spec: rewritten" } }, headers: await csrf(dana) })).status()).toBe(403);
    // The CRM admin reads the conversations she is in: none. Read-only has no messages at all.
    const tessa = await api("tessa");
    expect(await rows(tessa, data, "threads")).toEqual([]);
    expect(await rows(tessa, data, "messages")).toEqual([]);
    const grace = await as("grace");
    expect((await grace.request.get(data("messages", "?limit=1"))).status()).toBe(403);
    const hers = await grace.newPage();
    await hers.goto(`${STAFF}messages`);
    await expect(hers.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
    const tessaPage = await (await as("tessa")).newPage();
    await tessaPage.goto(`${STAFF}messages`);
    await expect(tessaPage.locator(".crm-empty-title")).toHaveText("No conversation yet");
    expect(problems.filter((problem) => !/ERR_CONNECTION_RESET/.test(problem))).toEqual([]);
  } finally {
    await tidy(api, data);
    await putMarksBack(api, data);
  }
});

/* ─── The new starter ─────────────────────────────────────────────────────── */

test("Messages: a member brings a colleague into a group conversation, who reads it from its start; a two-person one offers nobody (R4c, D3, D12)", async ({ as, api, data }) => {
  const owner = await api("owner");
  const ownerHeaders = await csrf(owner);
  const ivyId = await me(await api("ivy"));
  // Ivy is in none of the group's rows, as the sample has it: taken back out at the end whatever happens.
  const takeOut = async (): Promise<void> => {
    for (const row of await rows<{ id: number; thread_id: number }>(owner, data, "thread_members", { column: "user_id", op: "eq", value: ivyId })) {
      if (row.thread_id !== 1) expect((await owner.delete(data("thread_members", `/${String(row.id)}?confirm=true`), { headers: ownerHeaders })).status()).toBeLessThan(300);
    }
  };
  await takeOut();
  try {
    const context = await as("dana");
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}messages`);
    const talk = page.getByTestId("msgs-talk");
    // A two-person conversation offers nobody to add.
    await page.locator(".crm-ms-thread", { hasText: "Ivy Sandoval" }).click();
    await expect(talk.locator(".crm-ms-talk-head")).toContainText("Ivy Sandoval");
    await expect(talk.getByRole("button", { name: "Add a colleague" })).toHaveCount(0);
    // The group: Ivy is not in it, and is answered none of it.
    const ivy = await api("ivy");
    const group = (await rows<{ id: number; title: string | null }>(owner, data, "threads", { column: "kind", op: "eq", value: "group" })).find((row) => row.title === "The four of us")!;
    expect((await rows(ivy, data, "messages", { column: "thread_id", op: "eq", value: group.id })).length).toBe(0);
    await page.locator(".crm-ms-thread", { hasText: "The four of us" }).click();
    await talk.getByRole("button", { name: "Add a colleague" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a colleague to this conversation" });
    await expect(dialog.getByTestId("msgs-add-note")).toHaveText("Whoever you add reads this conversation from its start, every message already in it.");
    await expect(dialog.getByRole("button", { name: "Add to the conversation" })).toBeDisabled();
    await dialog.locator(`[data-person="${ivyId}"]`).click();
    await expect(dialog.getByTestId("msgs-add-note")).toHaveText("Ivy reads this conversation from its start, every message already in it.");
    await dialog.getByRole("button", { name: "Add to the conversation" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Ivy Sandoval is in the conversation.");
    await expect(dialog).toHaveCount(0);
    await expect(talk.locator(".crm-ms-talk-head")).toContainText("Dana, Priya, Sam, Leo, Ivy");
    // From its start: every message already in it, and its five people.
    expect((await rows(ivy, data, "messages", { column: "thread_id", op: "eq", value: group.id })).length).toBe(4);
    expect((await rows(ivy, data, "thread_members", { column: "thread_id", op: "eq", value: group.id })).length).toBe(5);
    const ivyPage = await (await as("ivy")).newPage();
    await ivyPage.goto(`${STAFF}messages`);
    await expect(ivyPage.locator(".crm-ms-thread")).toHaveCount(2);
    // The server refuses a third person on a two-person conversation, whatever a screen offers.
    const direct = (await rows<{ thread_id: number }>(context.request, data, "thread_members", { column: "user_id", op: "eq", value: ivyId })).find((row) => row.thread_id !== group.id)!;
    const third = await context.request.post(data("thread_members"), { data: { values: { thread_id: direct.thread_id, user_id: (await me(await api("sam"))) } }, headers: await csrf(context.request) });
    expect(third.status()).toBeGreaterThanOrEqual(400);
    expect(problems).toEqual([]);
  } finally {
    await takeOut();
  }
});

test("New starter: the ledger's three of twelve; a step ticked and put back; the first-year target set; a rep ticks and changes nothing else; Read-only presses nothing", async ({ as, api, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 100);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}week`);
  await go(page, "New starter");
  await expect(page).toHaveURL(/\/staff\/new-starter$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nia Okonjo");
  await expect(page.getByTestId("st-head")).toContainText("Starts Aug 3, 2026 · 6 days away");
  await expect(page.getByTestId("st-pct")).toHaveText("25%");
  await expect(page.getByTestId("st-done")).toHaveText("3 of 12 done");
  await expect(page.getByTestId("st-before")).toContainText("Before Mon, Aug 3");
  await expect(stat(page, "st-before")).toHaveText("3/4");
  await expect(page.getByTestId("st-before")).toContainText("1 thing left");
  await expect(page.getByTestId("st-count-before")).toHaveText("3 of 4");
  await expect(page.getByTestId("st-count-week")).toHaveText("0 of 4");
  await expect(page.getByTestId("st-count-month")).toHaveText("0 of 4");
  await expect(page.locator(".crm-st-step")).toHaveCount(12);
  await expect(page.locator('[data-phase="week"] .crm-st-step', { hasText: "Log her first activity" }).locator(".crm-st-owner")).toHaveText(/Nia/);
  await expect(page.locator('[data-phase="week"] .crm-st-step', { hasText: "Walk the catalogue" }).locator(".crm-st-owner")).toHaveText(/Leo/);

  // The last thing before the first day.
  await tick(page, "Add her to the workspace").click();
  await expect(page.locator(".crm-toast")).toHaveText("Done.");
  await expect(page.getByTestId("st-done")).toHaveText("4 of 12 done");
  await expect(page.getByTestId("st-pct")).toHaveText("33%");
  await expect(page.getByTestId("st-count-before")).toHaveText("4 of 4");
  await expect(page.getByTestId("st-before")).toContainText("All set");
  await tick(page, "Add her to the workspace").click();
  await expect(page.locator(".crm-toast")).toHaveText("Open again.");
  await expect(page.getByTestId("st-done")).toHaveText("3 of 12 done");

  // The first-year target: not set in the sample; half the server's average full target is offered (the ledger's 56,250).
  await expect(stat(page, "st-target")).toHaveText("Not set");
  await page.getByRole("button", { name: "Set £56,250, half the average target" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("The first-year target of Nia is £56,250.");
  await expect(stat(page, "st-target")).toHaveText("£56,250");
  expect(Number((await rows<{ first_year_target: number }>(context.request, data, "starters"))[0]!.first_year_target)).toBe(56_250);
  await picture(page, "starter-1-ivy");

  // A rep opens it by its address: she ticks a step, changes nothing else of it, and is shown no target.
  const danaContext = await as("dana");
  const dana = danaContext.request;
  const step = (await rows<{ id: number }>(dana, data, "starter_steps", { column: "text", op: "eq", value: "Sit in on three calls" }))[0]!;
  const headers = await csrf(dana);
  expect((await dana.patch(data("starter_steps", `/${String(step.id)}`), { data: { values: { text: "Spec: no" } }, headers })).status()).toBe(403);
  expect((await dana.patch(data("starter_steps", `/${String(step.id)}`), { data: { values: { done: true } }, headers })).status()).toBe(200);
  expect((await dana.patch(data("starter_steps", `/${String(step.id)}`), { data: { values: { done: false } }, headers })).status()).toBe(200);
  expect(Object.keys((await rows<Record<string, unknown>>(dana, data, "starters"))[0]!)).not.toContain("first_year_target");
  const starter = (await rows<{ id: number }>(dana, data, "starters"))[0]!;
  expect((await dana.patch(data("starters", `/${String(starter.id)}`), { data: { values: { name: "Spec: no" } }, headers })).status()).toBe(403);

  // Read-only: every tick is there to read and none to press; the server refuses hers.
  const graceContext = await as("grace");
  const gracePage = await graceContext.newPage();
  await gracePage.goto(`${STAFF}new-starter`);
  await expect(gracePage.getByTestId("st-done")).toHaveText("3 of 12 done");
  await expect(gracePage.getByRole("checkbox", { disabled: false })).toHaveCount(0);
  await expect(gracePage.getByRole("button", { name: /^Set £/ })).toHaveCount(0);
  expect((await graceContext.request.patch(data("starter_steps", `/${String(step.id)}`), { data: { values: { done: true } }, headers: await csrf(graceContext.request) })).status()).toBe(403);
  // The marketer reads no starter.
  expect((await (await api("lena")).get(data("starters", "?limit=1"))).status()).toBe(403);
  expect(problems).toEqual([]);
});

/* ─── Narrow, dark, right to left ─────────────────────────────────────────── */

test("the team's screens at 390 wide in the dark with no sideways scroll; and in Arabic right to left", async ({ as, data }) => {
  const context = await as("ivy", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await room(context.request, data, 160);
  const page = await context.newPage();
  for (const [path, ready] of [
    ["targets", ".crm-tg-row"],
    ["one-to-ones", ".crm-no-session"],
    ["weekly-meeting", ".crm-mt-slot"],
    ["coaching", ".crm-co-area"],
    ["messages", ".crm-ms-msg"],
    ["new-starter", ".crm-st-step"],
  ] as const) {
    await page.goto(`${STAFF}${path}`);
    await expect(page.locator(ready).first(), path).toBeVisible();
    expect(await noSidewaysScroll(page), path).toBe(true);
    await picture(page, `team-390-dark-${path}`);
  }
  // The new-session form, at that width.
  await page.goto(`${STAFF}one-to-ones`);
  await page.getByTestId("notes-new").click();
  await expect(page.getByRole("form", { name: "New session" })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  const sam = await as("sam");
  await inArabic(sam.request, async () => {
    const arabic = await sam.newPage();
    for (const [path, heading] of [
      ["one-to-ones", "لقاءاتي الفردية"],
      ["coaching", "تدريبي"],
      ["weekly-meeting", "اجتماع الفريق الأسبوعي"],
      ["messages", "الرسائل"],
    ] as const) {
      await arabic.goto(`${STAFF}${path}`);
      await expect(arabic.getByRole("heading", { level: 1 }), path).toHaveText(heading);
      await expect(arabic.locator("html")).toHaveAttribute("dir", "rtl");
      expect(await noSidewaysScroll(arabic), path).toBe(true);
    }
    await picture(arabic, "team-arabic-messages");
    await arabic.close();
  });
});
