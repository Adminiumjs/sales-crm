/**
 * P13, a person's own: the Weekly digest with "Send me a test" (ledger §16),
 * how I am told (§20), my details (§23), saved views (§19) and searches
 * (§38), my profile (§22).
 *
 * Mostly as Sam, Leo, Ivy and Lena; Dana only where the ledger's figures are
 * hers (her profile, her views, her searches). Everything a spec makes is
 * named "P13 …" and taken away; a person's own settings are put back.
 *
 * REQUESTS. Dana's three specs come first, and the file ends by letting a
 * minute run out: the suite spends close to her 300 requests a minute, and
 * `pipeline.e2e.ts` (hers again, and Ivy's) follows this file.
 *
 * "Send me a test" is allowed three times an hour for each person, kept by
 * the server while it runs: the spec that proves the fourth is refused is
 * Sam's, and is written for a fresh stand.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, minuteOut, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

const userMenu = async (page: Page, item: string): Promise<void> => {
  await page.getByRole("button", { name: "Your menu" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: item }).click();
};
const section = (page: Page, key: string) => page.locator(`.crm-digest-section[data-section="${key}"]`);
const views = (page: Page) => page.locator(".crm-view");
const viewNamed = (page: Page, name: string) => views(page).filter({ has: page.locator(".crm-view-name", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
const stat = (page: Page, name: string) => page.locator(`.crm-leads-stat[data-stat="${name}"]`);

const total = async (person: APIRequestContext, data: Data, ref: string, condition: unknown): Promise<number> => {
  const res = await person.get(data(ref, `?limit=1&select=id&count=exact&where=${encodeURIComponent(JSON.stringify(condition))}`));
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { page: { total: number } }).page.total;
};
const summaries = async (person: APIRequestContext): Promise<{ id: string; name: string; enabled: boolean }[]> => ((await (await person.get("/api/v1/me/summaries")).json()) as { data: { id: string; name: string; enabled: boolean }[] }).data;

test("my profile as Dana: the ledger's figures, each the server's for her", async ({ as, data, stand }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}me`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dana Whitlock");
  await expect(page.getByTestId("me-role")).toHaveText("Sales rep");
  // §22: weighted open 95,740 · 6 deals; win rate 38 % (3 of 8); average cycle 46 d; in my queue 7.
  await expect(stat(page, "weighted").locator(".crm-leads-value")).toHaveText("£95,740");
  await expect(stat(page, "weighted").locator(".crm-leads-note")).toHaveText("6 open deals");
  await expect(stat(page, "rate").locator(".crm-leads-value")).toHaveText("38%");
  await expect(stat(page, "rate").locator(".crm-leads-note")).toHaveText("3 of 8 closed");
  await expect(stat(page, "cycle").locator(".crm-leads-value")).toHaveText("46 days");
  await expect(stat(page, "queue").locator(".crm-leads-value")).toHaveText("7");
  // Target 140,000, booked 28,400, to find 15,860, covered 89 %.
  const target = page.getByTestId("me-target");
  await expect(target.locator(".crm-me-target-value")).toHaveText("£140,000");
  await expect(target.locator('[data-part="booked"] dd')).toHaveText("£28,400");
  await expect(target.locator('.crm-me-legend [data-part="weighted"] dd')).toHaveText("£95,740");
  await expect(target.locator('[data-part="toFind"] dd')).toHaveText("£15,860");
  await expect(page.getByTestId("me-cover")).toHaveText("89% covered");
  // The companies with something of hers open.
  const companies = page.getByTestId("me-companies").locator("li");
  await expect(companies).toHaveCount(5);
  await expect(companies.locator(".crm-mk-title")).toHaveText(["Nordwind Logistics", "Veldt Studios", "Juno Analytics", "Low Orbit", "Cobalt Legal"]);
  await expect(companies.locator(".crm-mk-figure")).toHaveText(["£52,800", "£30,700", "£21,600", "£21,500", "£16,800"]);
  await expect(companies.nth(1).locator(".crm-mk-sub")).toHaveText("2 open deals");
  expect(problems).toEqual([]);
  await picture(page, "4-dana-profile");

  // The server's own answers, asked directly as her.
  const me = stand.people["dana"]!.id;
  const figure = async (descriptor: Record<string, unknown>): Promise<{ items: { key: unknown; values: Record<string, number> }[] }> =>
    ((await (await context.request.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: stand.tables["crm_deals"] }, shape: "categorical", ...descriptor } }, headers: await csrf(context.request) })).json()) as { result: { items: { key: unknown; values: Record<string, number> }[] } }).result;
  const open = await figure({ filters: [{ column: "owner_id", op: "eq", value: me }, { column: "state", op: "eq", value: "open" }], groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "w" }] });
  expect(open.items[0]!.values).toEqual({ n: 6, w: 95740 });
  const won = await figure({ filters: [{ column: "owner_id", op: "eq", value: me }, { column: "state", op: "eq", value: "won" }, { column: "closed_on", op: "between", value: ["2026-01-01", "2026-12-31"] }], groupBy: ["state"], aggregations: [{ fn: "sum", column: "amount", alias: "a" }, { fn: "count", alias: "n" }] });
  expect(won.items[0]!.values["a"]).toBe(28400);
  const hers = await rows<{ amount: number; year: number }>(context.request, data, "targets", { column: "year", op: "eq", value: 2026 });
  expect(hers.map((row) => Number(row.amount))).toEqual([140000]);
  expect(await total(context.request, data, "follow_ups", { and: [{ column: "owner_id", op: "eq", value: me }, { column: "kind", op: "eq", value: "step" }, { column: "done", op: "eq", value: false }] })).toBe(7);
});

test("a rep's saved views count her own deals, and a view that is not hers reads as not there", async ({ as, api, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}saved-views`);
  // §19: Dana sees her own one of the six: saved views are private (plan 68 D9), so nobody shares one.
  await expect(views(page)).toHaveCount(1);
  // v1, her own: 2 deals · weighted 55,800.
  const mine = viewNamed(page, "My negotiation deals");
  await expect(mine.getByTestId("view-count")).toHaveText("2");
  await expect(mine.getByTestId("view-weighted")).toHaveText("£55,800");
  await expect(mine.locator(".crm-view-owner")).toHaveText("Board · Yours · private");
  await expect(mine.locator(".crm-view-rules .crm-pill")).toHaveText(["Dana’s", "Stage: Negotiation"]);
  // She pins and removes her own; Ivy's are not listed for her at all.
  await expect(mine.locator('[data-act="pin"]')).toBeVisible();
  await expect(mine.locator('[data-act="remove"]')).toBeVisible();
  await expect(viewNamed(page, "Everything over 20,000")).toHaveCount(0);
  // Her own board on her own view.
  await mine.getByRole("link").click();
  await expect(page.getByTestId("viewbar-showing")).toContainText("Showing “My negotiation deals”");
  await expect(page.getByTestId("board-count")).toHaveText("2");
  await expect(page.getByTestId("board-weighted")).toHaveText("£55,800");
  // Ivy's private view by its address: not there for Dana, and the board is her whole board.
  const ivys = (await rows<{ id: number; name: string }>(await api("ivy"), data, "saved_views")).find((row) => row.name === "Sam's board")!;
  await page.goto(`${STAFF}pipeline/view/${String(ivys.id)}`);
  await expect(page.getByTestId("viewbar-missing")).toHaveText("That saved view is no longer there, or it is not yours to open.");
  await expect(page.getByTestId("board-count")).toHaveText("6");
});

test("saved searches: a live count from the server, private to their owner", async ({ as, api, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  const headers = await csrf(context.request);
  const clear = async (): Promise<void> => {
    for (const row of await rows<{ id: number }>(context.request, data, "saved_searches", { column: "name", op: "like", value: "P13%" })) await context.request.delete(data("saved_searches", `/${String(row.id)}?confirm=true`), { headers });
  };
  await clear();
  try {
    await page.goto(`${STAFF}saved-views`);
    await page.getByRole("link", { name: "Saved searches" }).first().click();
    await expect(page).toHaveURL(/\/saved-searches$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My saved searches");
    const cards = page.locator(".crm-view[data-search]");
    // §38: her five, the newest run first.
    await expect(cards).toHaveCount(5);
    await expect(cards.locator(".crm-view-name")).toHaveText(["Acoustic work", "Leeds", "Lockers and storage", "Bea at Low Orbit", "Showroom refits"]);
    const acoustic = cards.first();
    await expect(acoustic.locator(".crm-pill")).toHaveText("booth");
    // "Acoustic work" (booth): 1 deal (d2), no company, nobody; value 27,500; last run Tue 28 Jul, 08:40.
    await expect(acoustic.getByTestId("search-breakdown")).toHaveText("1 deal · 0 companies · 0 people");
    await expect(acoustic.getByTestId("search-value")).toHaveText("£27,500");
    await expect(acoustic.getByTestId("search-last")).toHaveText("Last run Tue, Jul 28, 08:40");
    await expect(cards.nth(1).getByTestId("search-breakdown")).toHaveText("0 deals · 1 company · 0 people");
    await expect(cards.nth(1).getByTestId("search-last")).toHaveText("Last run Mon, Jul 27, 15:10");
    await expect(cards.nth(2).getByTestId("search-breakdown")).toHaveText("1 deal · 0 companies · 0 people");
    await expect(cards.nth(2).getByTestId("search-value")).toHaveText("£16,800");
    await expect(cards.nth(3).getByTestId("search-breakdown")).toHaveText("0 deals · 0 companies · 1 person");
    expect(problems).toEqual([]);
    await picture(page, "6-dana-searches");

    // Type a word: the server's counts for her, and the sum of the deals found.
    await page.getByRole("searchbox", { name: "Search for" }).fill("locker");
    await expect(page.getByTestId("search-count")).toHaveText("1 deal · 0 companies · 0 people · £16,800 in deals");
    await expect(page.getByTestId("search-found").locator("li")).toHaveText(["Records-room lockersDeal"]);
    await page.getByRole("searchbox", { name: "Search for" }).fill("P13 zebra");
    await expect(page.getByTestId("search-found")).toContainText("Nothing matches that");
    await page.getByRole("searchbox", { name: "Search for" }).fill("P13 lockers");
    await page.getByTestId("search-save").click();
    await expect(page.locator(".crm-toast")).toHaveText("“P13 lockers” is saved.");
    await expect(cards).toHaveCount(6);
    const made = (await rows<{ id: number; query: string; owner_id: string; last_run_at: string }>(context.request, data, "saved_searches", { column: "name", op: "eq", value: "P13 lockers" }))[0]!;
    expect(made.query).toBe("P13 lockers");
    // Stamped by the server's clock, not the browser's.
    expect(made.last_run_at.slice(0, 10)).toBe("2026-07-28");
    // Run it: the word goes into the box.
    const mine = cards.filter({ hasText: "P13 lockers" });
    await mine.getByRole("button", { name: "Run “P13 lockers”" }).click();
    await expect(page.getByRole("searchbox", { name: "Search for" })).toHaveValue("P13 lockers");
    await mine.getByRole("button", { name: "Remove “P13 lockers”" }).click();
    await expect(cards).toHaveCount(5);

    // Private: nobody else is answered one of hers, by list or by number.
    const one = (await rows<{ id: number }>(context.request, data, "saved_searches"))[0]!;
    for (const person of ["ivy", "tessa", "priya", "grace"]) {
      const direct = await api(person);
      expect((await rows(direct, data, "saved_searches")).length, person).toBe(0);
      expect((await direct.get(data("saved_searches", `/${String(one.id)}`))).status(), person).toBe(404);
    }
    // Whoever runs the install included: saved searches are private (plan 68 D9).
    expect((await rows(await api("owner"), data, "saved_searches")).length).toBe(0);
  } finally {
    await clear();
  }
  // The manager has none of her own: the empty state. Read-only has no saving.
  const ivy = await (await as("ivy")).newPage();
  await ivy.goto(`${STAFF}saved-searches`);
  await expect(ivy.getByTestId("searches-none")).toContainText("Nothing saved yet");
  const grace = await (await as("grace")).newPage();
  await grace.goto(`${STAFF}saved-searches`);
  await expect(grace.getByTestId("search-save")).toHaveCount(0);
  const direct = await api("grace");
  expect((await direct.post(data("saved_searches"), { data: { values: { name: "P13 no", query: "no" }, clientKey: "p13gracesearchAAAAAAAAAAAAAAAAAA" }, headers: await csrf(direct) })).status()).toBe(403);
});

test("the Weekly digest for a rep: the rule's state, what the mail holds, a test, and the fourth in an hour refused", async ({ as, api, data, stand }) => {
  const context = await as("sam");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}today`);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Weekly digest" }).click();
  await expect(page).toHaveURL(/\/digest$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Weekly digest");
  const mine = await summaries(context.request);
  expect(mine.map((rule) => [rule.name, rule.enabled])).toEqual([["Each week: every sales rep’s and account manager’s own week by email", false]]);
  const rule = page.locator(".crm-digest-rule");
  await expect(rule).toHaveCount(1);
  await expect(rule.locator(".crm-digest-rule-name")).toHaveText(mine[0]!.name);
  // R7: the state is the rule's own, as the server says it for her summary. It is switched off on a default install.
  await expect(rule).toHaveAttribute("data-state", "off");
  await expect(rule.getByTestId("digest-state")).toHaveText("Switched offIt is switched off for this install, so nothing goes out by itself. Ask the person who runs this install. A test works either way.");
  await expect(rule.locator(".crm-digest-when")).toContainText("Goes out on the day and at the time the rule is set to.");
  // The stand sends no mail, and the screen says so before anything is pressed.
  await expect(page.getByTestId("digest-no-mail")).toContainText("This install has no outgoing mail set up, so nothing is delivered");

  // What it holds: the rule's three sections, each count what the server answers Sam for the same rows.
  const me = stand.people["sam"]!.id;
  const own = { column: "owner_id", op: "eq", value: me };
  const now = new Date(((await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { now: string }).now);
  const slipped = await total(context.request, data, "follow_ups", { and: [own, { column: "done", op: "eq", value: false }, { column: "due_at", op: "lt", value: new Date(now.getTime() - 60_000).toISOString() }] });
  const due = await total(context.request, data, "follow_ups", { and: [own, { column: "done", op: "eq", value: false }, { column: "due_at", op: "between", value: [now.toISOString(), new Date(now.getTime() + 7 * 86_400_000).toISOString()] }] });
  const closing = await total(context.request, data, "deals", { and: [own, { column: "state", op: "eq", value: "open" }, { column: "expected_close", op: "between", value: ["2026-07-28", "2026-08-04"] }] });
  await expect(page.locator(".crm-digest-section")).toHaveCount(3);
  await expect(section(page, "closing").locator(".crm-chip-count")).toHaveText(String(closing));
  await expect(section(page, "due").locator(".crm-chip-count")).toHaveText(String(due));
  await expect(section(page, "slipped").locator(".crm-chip-count")).toHaveText(String(slipped));
  await expect(section(page, "closing").locator("li")).toHaveCount(Math.min(20, closing));
  await expect(section(page, "due").locator("li")).toHaveCount(Math.min(20, due));
  expect(problems).toEqual([]);
  await picture(page, "1-sam-digest");

  // "Send me a test": the route's own answer, said in words. No mail leaves the stand.
  const button = page.getByTestId("digest-test");
  await expect(rule.locator(".crm-digest-test .crm-field-note")).toHaveText("To your own address, three times an hour at most.");
  await button.click();
  await expect(page.locator(".crm-toast")).toContainText(/Sent to sam@crm\.test\.|The summary was made, and not delivered: this install has no outgoing mail set up\./);
  await expect(rule.locator(".crm-digest-test .crm-field-note")).toHaveText("2 more this hour");
  // Twice more by direct call, then the fourth: 429 with how long to wait, also while the rule is switched off.
  const headers = await csrf(context.request);
  const send = (id: string) => context.request.post(`/api/v1/me/summaries/${id}/send`, { data: {}, headers });
  const second = await send(mine[0]!.id);
  expect(second.status(), await second.text()).toBe(200);
  expect(((await second.json()) as { data: { left: number } }).data.left).toBe(1);
  expect(((await (await send(mine[0]!.id)).json()) as { data: { left: number } }).data.left).toBe(0);
  const fourth = await send(mine[0]!.id);
  expect(fourth.status()).toBe(429);
  expect(Number(fourth.headers()["retry-after"])).toBeGreaterThan(3000);
  await button.click();
  // Said at once, with the wait: the screen does not hang on the server's hour.
  await expect(page.locator(".crm-toast")).toContainText(/You have asked three times this hour\. Try again in (59|60) minutes\./, { timeout: 5000 });

  // Another person's summary is not hers to send: it answers as one that does not exist.
  const ivys = await summaries(await api("ivy"));
  expect(ivys.map((one) => one.name)).toEqual(["Each week: every sales manager’s team by email"]);
  expect((await send(ivys[0]!.id)).status()).toBe(404);
  expect((await send("auto_00000000000000000000000000")).status()).toBe(404);
});

test("the digest for the sales manager and for a role no summary is written to", async ({ as, api, data, stand }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  await page.goto(`${STAFF}digest`);
  await expect(page.locator(".crm-digest-rule-name")).toHaveText("Each week: every sales manager’s team by email");
  // The manager's summary as the rule is written today: the deals she owns herself. She owns none.
  const me = stand.people["ivy"]!.id;
  expect(await total(context.request, data, "deals", { and: [{ column: "owner_id", op: "eq", value: me }, { column: "state", op: "eq", value: "open" }] })).toBe(0);
  await expect(page.locator(".crm-digest-section")).toHaveCount(3);
  await expect(section(page, "closing")).toContainText("Nothing of yours closes in the next seven days.");
  await expect(section(page, "slipped")).toContainText("Nothing has slipped.");
  await expect(section(page, "quiet")).toContainText("None of your deals has gone quiet.");
  for (const key of ["closing", "slipped", "quiet"]) await expect(section(page, key).locator(".crm-chip-count")).toHaveText("0");

  // The marketer: the server names no summary of hers, and the page says so. So does the front desk's.
  const lena = await api("lena");
  expect(await summaries(lena)).toEqual([]);
  const hers = await (await as("lena")).newPage();
  await hers.goto(`${STAFF}digest`);
  await expect(hers.getByTestId("digest-none")).toContainText("No weekly summary is sent to your role");
  await expect(hers.getByTestId("digest-test")).toHaveCount(0);
  // The account manager gets the rep's summary, and reaches it from "How I am told".
  expect((await summaries(await api("hugo"))).length).toBe(1);
});

test("how I am told is cut to the person's roles and parts", async ({ as }) => {
  // A rep: mentions, and what the rules can tell a rep. No "put to me for approval": that is a manager's.
  const sam = await (await as("sam")).newPage();
  const problems = watch(sam);
  await sam.goto(`${STAFF}today`);
  await userMenu(sam, "Notifications");
  await expect(sam).toHaveURL(/\/notifications$/);
  await expect(sam.getByRole("heading", { level: 1 })).toHaveText("Notifications");
  await expect(sam.locator(".crm-told-row .crm-told-label")).toHaveText(["Somebody mentions me", "A rule tells me something"]);
  await expect(sam.locator("[data-testid='told-reasons'] li")).toHaveText([
    "A follow-up of mine falls due",
    "A deal of mine has gone quiet, is stuck in its stage, or closes soon and is not agreed",
    "A deal is handed over to me",
    "A quote on a deal of mine runs out in a few days",
    "A discount I asked for is approved or refused",
  ]);
  // No app role can read which notice rules are on: the page claims no state.
  await expect(sam.getByTestId("told-rules-state")).toHaveText("Which of these rules are switched on is set by the person who runs this install.");
  await expect(sam.locator(".crm-screen-sub")).toContainText("4 of 4 switches are on.");
  await expect(sam.getByTestId("told-digest")).toBeVisible();
  await expect(sam.getByTestId("told-no-mail")).toContainText("This install has no outgoing mail set up yet.");
  expect(problems).toEqual([]);
  await picture(sam, "2-sam-told");

  // The sales manager is asked for approvals, and also asks.
  const ivy = await (await as("ivy")).newPage();
  await ivy.goto(`${STAFF}notifications`);
  await expect(ivy.locator("[data-testid='told-reasons'] li[data-reason='approvalAsked']")).toHaveText("A discount is put to me for approval");
  await expect(ivy.locator("[data-testid='told-reasons'] li")).toHaveCount(6);

  // The marketer and the front desk own no deal and no follow-up: no rule can name them. A mention can. No summary is theirs.
  for (const person of ["lena", "corin"]) {
    const page = await (await as(person)).newPage();
    await page.goto(STAFF);
    await userMenu(page, "Notifications");
    await expect(page.locator(".crm-told-row .crm-told-label"), person).toHaveText(["Somebody mentions me"]);
    await expect(page.getByTestId("told-reasons")).toHaveCount(0);
    await expect(page.getByTestId("told-digest")).toHaveCount(0);
    await expect(page.locator(".crm-screen-sub")).toContainText("2 of 2 switches are on.");
    await expect(page.getByRole("heading", { name: "Quiet hours" })).toBeVisible();
  }
  // Read-only owns nothing either; the account manager owns follow-ups and gets the rep's summary.
  const grace = await (await as("grace")).newPage();
  await grace.goto(`${STAFF}notifications`);
  await expect(grace.locator(".crm-told-row .crm-told-label")).toHaveText(["Somebody mentions me"]);
  const hugo = await (await as("hugo")).newPage();
  await hugo.goto(`${STAFF}notifications`);
  await expect(hugo.locator("[data-testid='told-reasons'] li")).toHaveText(["A follow-up of mine falls due"]);
  await expect(hugo.getByTestId("told-digest")).toBeVisible();
  await hugo.getByTestId("told-digest").getByRole("link", { name: "See it" }).click();
  await expect(hugo).toHaveURL(/\/digest$/);
  await expect(hugo.locator(".crm-digest-rule")).toHaveCount(1);
});

test("saving how I am told: Adminium holds it, a lost reply is sent again, and it is put back", async ({ as }) => {
  const context = await as("leo");
  const page = await context.newPage();
  const headers = await csrf(context.request);
  const read = async (): Promise<{ events: { key: string; channels: { inApp: boolean; email: boolean } }[]; schedule: { quiet: Record<string, { from: string; to: string }> | null; digestDay: number | null; digestTime: string | null; quietOn?: boolean; summariesOn?: boolean } }> => ({
    events: ((await (await context.request.get("/api/v1/me/notification-prefs")).json()) as { data: { events: { key: string; channels: { inApp: boolean; email: boolean } }[] } }).data.events,
    schedule: ((await (await context.request.get("/api/v1/me/notification-schedule")).json()) as { data: { quiet: Record<string, { from: string; to: string }> | null; digestDay: number | null; digestTime: string | null; quietOn?: boolean; summariesOn?: boolean } }).data,
  });
  const putBack = async (): Promise<void> => {
    await context.request.put("/api/v1/me/notification-prefs", { data: { events: [{ key: "mention", channels: { inApp: true, email: true, push: false } }, { key: "automation.notice", channels: { inApp: true, email: true, push: false } }] }, headers });
    await context.request.put("/api/v1/me/notification-schedule", { data: { timezone: null, quiet: null, digestDay: null, digestTime: null, quietOn: true, summariesOn: true }, headers });
  };
  await putBack();
  try {
    await page.goto(`${STAFF}notifications`);
    const rules = page.locator('.crm-told-row[data-kind="automation.notice"]');
    const byMail = rules.getByRole("switch", { name: "A rule tells me something: by email" });
    await expect(byMail).toHaveAttribute("aria-checked", "true");
    // By keyboard: the switch, then quiet hours on, then Friday at eight for the digest.
    await byMail.focus();
    await page.keyboard.press("Space");
    await expect(byMail).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".crm-screen-sub")).toContainText("3 of 4 switches are on.");
    const quiet = page.getByTestId("quiet-switch");
    await expect(quiet).toHaveText("Quiet hours are off");
    await quiet.click();
    await expect(quiet).toHaveText("Quiet hours are on");
    await expect(page.getByLabel("Quiet from")).toHaveValue("18:30");
    await expect(page.getByLabel("Quiet until")).toHaveValue("08:00");
    await page.getByTestId("told-digest").locator('[data-day="5"]').click();
    await page.getByLabel("At what time").fill("08:00");

    // The first reply to the kinds is lost on the way back; the same is sent again.
    let dropped = 0;
    await page.route("**/api/v1/me/notification-prefs", async (route) => {
      if (route.request().method() !== "PUT" || dropped > 0) return route.fallback();
      dropped += 1;
      await route.fetch();
      return route.abort("connectionreset");
    });
    await page.getByTestId("told-save").click();
    await expect(page.locator(".crm-toast")).toHaveText("Saved.");
    await expect(page.locator(".crm-told-saved")).toHaveText(/Saved at \d\d:\d\d/);
    expect(dropped).toBe(1);
    await page.unroute("**/api/v1/me/notification-prefs");
    const held = await read();
    expect(held.events.find((event) => event.key === "automation.notice")?.channels).toMatchObject({ inApp: true, email: false });
    expect(held.events.find((event) => event.key === "mention")?.channels).toMatchObject({ inApp: true, email: true });
    expect(Object.keys(held.schedule.quiet ?? {}).sort()).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(held.schedule.quiet?.["3"]).toEqual({ from: "18:30", to: "08:00" });
    expect([held.schedule.digestDay, held.schedule.digestTime]).toEqual([5, "08:00"]);
    // The digest screen says the day she chose.
    await page.getByTestId("told-digest").getByRole("link", { name: "See it" }).click();
    await expect(page.locator(".crm-digest-when")).toContainText("Goes out on Friday at 08:00, as you chose.");
    // Still there after a reload, and "Turn everything off" is one press and a save.
    await page.goto(`${STAFF}notifications`);
    await expect(byMail).toHaveAttribute("aria-checked", "false");
    await expect(quiet).toHaveText("Quiet hours are on");
    // Quiet hours switched off keep their hours on the server; "Not me" keeps the day and time she chose.
    await quiet.click();
    await expect(quiet).toHaveText("Quiet hours are off");
    await page.getByTestId("told-digest").locator('[data-day="none"]').click();
    await expect(page.getByTestId("told-digest").locator('[data-day="none"]')).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("told-save").click();
    await expect(page.locator(".crm-toast")).toHaveText("Saved.");
    const kept = (await read()).schedule;
    expect([kept.quietOn, kept.summariesOn, kept.quiet?.["3"], kept.digestDay, kept.digestTime]).toEqual([false, false, { from: "18:30", to: "08:00" }, 5, "08:00"]);
    await page.goto(`${STAFF}notifications`);
    await expect(quiet).toHaveText("Quiet hours are off");
    await expect(page.getByLabel("Quiet from")).toHaveValue("18:30");
    await expect(page.getByTestId("told-digest").locator('[data-day="none"]')).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("told-off").click();
    await expect(page.locator(".crm-screen-sub")).toContainText("0 of 4 switches are on.");
    await page.getByTestId("told-save").click();
    await expect(page.locator(".crm-toast")).toHaveText("Saved.");
    expect((await read()).events.filter((event) => event.key === "mention" || event.key === "automation.notice").map((event) => [event.channels.inApp, event.channels.email])).toEqual([[false, false], [false, false]]);
  } finally {
    await page.unroute("**/api/v1/me/notification-prefs").catch(() => undefined);
    await putBack();
  }
});

test("my details: a rep's working hours, a language of her own; the marketer has no hours to set", async ({ as, api, data, stand }) => {
  const context = await as("leo");
  const page = await context.newPage();
  const problems = watch(page);
  const headers = await csrf(context.request);
  const me = stand.people["leo"]!.id;
  const mine = (await rows<{ id: number }>(context.request, data, "reps", { column: "user_id", op: "eq", value: me }))[0]!;
  const putBack = async (): Promise<void> => {
    await context.request.patch(data("reps", `/${String(mine.id)}`), { data: { values: { hours_from: null, hours_to: null } }, headers });
    await context.request.patch("/api/v1/me/prefs", { data: { locale: null }, headers });
  };
  await putBack();
  try {
    await page.goto(`${STAFF}today`);
    await userMenu(page, "My details");
    await expect(page).toHaveURL(/\/my-details$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My details");
    await expect(page.getByLabel("Name")).toHaveValue("Leo Vance");
    await expect(page.getByTestId("my-email")).toHaveText("leo@crm.test");
    await expect(page.getByTestId("my-zone")).toContainText("Europe/London");
    await expect(page.getByTestId("details-save")).toBeDisabled();
    // One end of the hours alone is asked for; both are saved on her own rep's profile.
    await page.getByLabel("Works from").fill("08:30");
    await page.getByTestId("details-save").click();
    await expect(page.getByRole("alert")).toHaveText("Give both ends of your working hours, or neither.");
    await page.getByLabel("Works until").fill("17:30");
    await page.getByTestId("details-save").click();
    await expect(page.locator(".crm-toast")).toHaveText("Your details are saved.");
    expect((await rows<{ hours_from: string; hours_to: string }>(context.request, data, "reps", { column: "user_id", op: "eq", value: me })).map((row) => [row.hours_from, row.hours_to])).toEqual([["08:30", "17:30"]]);
    // My profile shows them.
    await userMenu(page, "My profile");
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByTestId("me-hours")).toHaveText("08:30 to 17:30");
    await expect(page.getByTestId("me-role")).toHaveText("Sales rep");
    expect(problems).toEqual([]);

    // Her language: German, kept by Adminium for her; the page comes back in it.
    await page.getByRole("link", { name: "Edit my details" }).click();
    await page.getByRole("radio", { name: "Deutsch" }).click();
    await page.getByTestId("details-save").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meine Angaben", { timeout: 20_000 });
    expect(((await (await context.request.get("/api/v1/me/prefs")).json()) as { data: { prefs: { locale: string } } }).data.prefs.locale).toBe("de_DE");
    await expect(page.getByRole("radio", { name: "Deutsch" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("navigation").getByRole("link", { name: "Heute" })).toBeVisible();
  } finally {
    await putBack();
  }

  // A colleague's rep's profile is not hers to change: the server's refusal.
  const dana = (await rows<{ id: number }>(context.request, data, "reps", { column: "user_id", op: "eq", value: stand.people["dana"]!.id }))[0]!;
  expect([403, 404]).toContain((await context.request.patch(data("reps", `/${String(dana.id)}`), { data: { values: { hours_from: "09:00", hours_to: "17:00" } }, headers })).status());

  // The marketer: her name, her language, no working hours (she has no rep's profile), and her own menu under her name.
  const lena = await (await as("lena", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await lena.goto(`${STAFF}my-details`);
  await expect(lena.getByLabel("Name")).toHaveValue("Lena Fischer");
  await expect(lena.getByTestId("my-hours")).toHaveCount(0);
  expect(await lena.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(lena, "3-lena-details-390-dark");
  expect((await (await api("lena")).get(data("reps", "?limit=1"))).status()).toBe(403);
  await lena.goto(`${STAFF}me`);
  await expect(lena.getByRole("heading", { level: 1 })).toHaveText("Lena Fischer");
  await expect(lena.getByTestId("me-role")).toHaveText("Marketer");
  // No figure of selling on a profile that owns no deal: who she is, and the way to how she is told.
  await expect(lena.locator(".crm-me-stats")).toHaveCount(0);
  await expect(lena.getByTestId("me-target")).toHaveCount(0);
  await expect(lena.getByRole("link", { name: /How I am told/ })).toBeVisible();
  expect(await lena.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("saved views: the ledger's six, whose they are, and each count the reader's own", async ({ as, api, data, stand }) => {
  const admin = await api("tessa");
  const clear = async (): Promise<void> => {
    for (const person of ["ivy", "tessa", "sam"]) {
      const direct = await api(person);
      for (const row of await rows<{ id: number }>(direct, data, "saved_views", { column: "name", op: "like", value: "P13 %" })) await direct.delete(data("saved_views", `/${String(row.id)}?confirm=true`), { headers: await csrf(direct) });
    }
  };
  await clear();
  const context = await as("ivy");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}team`);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Saved views" }).click();
  await expect(page).toHaveURL(/\/saved-views$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Saved views");
  // Ivy reads her five: saved views are private (plan 68 D9), so the three she used to share are hers alone. Dana's is not hers.
  await expect(views(page)).toHaveCount(5);
  // §19, as the manager reads the team's deals.
  for (const [name, count, weighted, owner] of [
    ["Everything over 20,000", "7", "£124,890", "Board · Yours · private"],
    ["Sitting 14 days and up", "5", "£77,487.50", "Board · Yours · private"],
    ["Closing this month", "3", "£38,340", "Board · Yours · private"],
    ["Sam's board", "3", "£44,590", "Board · Yours · private"],
    ["Discovery, all reps", "3", "£3,635", "Board · Yours · private"],
  ] as const) {
    const card = viewNamed(page, name);
    await expect(card.getByTestId("view-count"), name).toHaveText(count);
    await expect(card.getByTestId("view-weighted"), name).toHaveText(weighted);
    await expect(card.locator(".crm-view-owner"), name).toHaveText(owner);
  }
  await expect(viewNamed(page, "Sam's board").locator(".crm-view-rules .crm-pill")).toHaveText(["Sam’s"]);
  await expect(viewNamed(page, "Discovery, all reps").locator(".crm-view-rules .crm-pill")).toHaveText(["Stage: Discovery"]);
  await expect(viewNamed(page, "Everything over 20,000").locator(".crm-view-rules .crm-pill")).toHaveText(["Over £20,000"]);
  expect(problems).toEqual([]);
  await picture(page, "5-ivy-views");

  // A view reopens the board it was saved from, cut the same way, with the same figures.
  await viewNamed(page, "Sitting 14 days and up").getByRole("link", { name: "Open “Sitting 14 days and up”" }).click();
  await expect(page).toHaveURL(/\/pipeline\/view\/\d+$/);
  await expect(page.getByTestId("viewbar-showing")).toHaveText("Showing “Sitting 14 days and up”: Sitting 14 days and up");
  await expect(page.getByTestId("board-count")).toHaveText("5");
  await expect(page.getByTestId("board-weighted")).toHaveText("£77,487.50");
  await expect(page.locator('[data-kit-part="board"] [data-board-card]')).toHaveCount(5);
  await page.getByTestId("viewbar-clear").click();
  await expect(page).toHaveURL(/\/pipeline$/);
  await expect(page.getByTestId("board-count")).toHaveText("14");
  await page.goto(`${STAFF}saved-views`);
  await viewNamed(page, "Sam's board").getByRole("link").click();
  await expect(page.getByTestId("board-count")).toHaveText("3");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sam");

  // Saved from Closed: Dana's, won only. It is listed with the server's count, and reopens Closed narrowed.
  try {
    await page.goto(`${STAFF}closed`);
    await page.getByRole("group", { name: "Whose deals" }).getByRole("button", { name: "Dana" }).click();
    await page.locator('.crm-chip-btn[data-filter="won"]').click();
    const opener = page.getByTestId("viewbar-save");
    await opener.click();
    const box = page.getByRole("dialog", { name: "Save this view" });
    await expect(box.getByLabel("What to call it")).toBeFocused();
    await expect(box.getByTestId("view-holds")).toHaveText("It keeps: Dana’s · Won only");
    await box.getByRole("button", { name: "Save it" }).click();
    await expect(box.getByRole("alert")).toHaveText("Give it a name.");
    await box.getByLabel("What to call it").fill("P13 Dana's wins");
    await page.keyboard.press("Enter");
    await expect(page.locator(".crm-toast")).toHaveText("“P13 Dana's wins” is saved. It is under Saved views.");
    await expect(opener).toBeFocused();
    const made = (await rows<{ id: number; owner_id: string; filters: unknown }>(context.request, data, "saved_views", { column: "name", op: "eq", value: "P13 Dana's wins" }))[0]!;
    expect(made.owner_id).toBe(stand.people["ivy"]!.id);
    expect(typeof made.filters === "string" ? JSON.parse(made.filters) : made.filters).toEqual({ screen: "archive", rep: stand.people["dana"]!.id, only: "won" });
    await page.goto(`${STAFF}saved-views`);
    const card = viewNamed(page, "P13 Dana's wins");
    await expect(card.locator(".crm-view-owner")).toHaveText("Closed · Yours · private");
    // Dana's won deals, all time: the ledger's 3.
    await expect(card.getByTestId("view-count")).toHaveText("3");
    await expect(card.getByTestId("view-weighted")).toHaveCount(0);
    await card.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/closed/view/${String(made.id)}$`));
    await expect(page.getByTestId("viewbar-showing")).toHaveText("Showing “P13 Dana's wins”: Dana’s · Won only");
    await expect(page.getByRole("group", { name: "Whose deals" }).getByRole("button", { name: "Dana" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('.crm-chip-btn[data-filter="won"]')).toHaveAttribute("aria-pressed", "true");
    // Pinned, it leads the list; removed, it is gone.
    await page.goto(`${STAFF}saved-views`);
    await viewNamed(page, "P13 Dana's wins").getByRole("button", { name: "Pin “P13 Dana's wins”" }).click();
    await expect(views(page).first().locator(".crm-view-name")).toHaveText("P13 Dana's wins");
    await viewNamed(page, "P13 Dana's wins").getByRole("button", { name: "Remove “P13 Dana's wins”" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("“P13 Dana's wins” is removed.");
    await expect(views(page)).toHaveCount(5);
  } finally {
    await clear();
  }

  // WHOSE THEY ARE, by direct calls. Saved views are private (plan 68 D9): each answers its owner and nobody else, the CRM
  // admin and whoever runs the install included.
  const dana = await api("dana");
  const hers = await rows<{ id: number; name: string; owner_id: string | null }>(dana, data, "saved_views");
  expect(hers.map((row) => row.name)).toEqual(["My negotiation deals"]);
  const own = hers[0]!;
  for (const person of ["ivy", "tessa", "sam", "grace", "owner"]) expect((await (await api(person)).get(data("saved_views", `/${String(own.id)}`))).status(), person).toBe(404);
  expect((await rows(admin, data, "saved_views")).length).toBe(0);
  expect((await rows(await api("owner"), data, "saved_views")).length).toBe(0);
  const ivys = await rows<{ id: number; name: string }>(context.request, data, "saved_views");
  expect(ivys).toHaveLength(5);
  const closing = ivys.find((row) => row.name === "Closing this month")!;
  const over = ivys.find((row) => row.name === "Everything over 20,000")!;
  for (const person of ["dana", "tessa"]) expect((await (await api(person)).get(data("saved_views", `/${String(closing.id)}`))).status(), person).toBe(404);
  // A rep neither changes nor removes Ivy's: to her it is not there.
  const headers = await csrf(dana);
  expect([403, 404]).toContain((await dana.patch(data("saved_views", `/${String(over.id)}`), { data: { values: { name: "P13 not hers" } }, headers })).status());
  expect([403, 404]).toContain((await dana.delete(data("saved_views", `/${String(over.id)}?confirm=true`), { headers })).status());
  expect((await rows<{ name: string }>(context.request, data, "saved_views", { column: "id", op: "eq", value: over.id }))[0]!.name).toBe("Everything over 20,000");
  // A view saved with nobody as its owner is refused: nobody could open it again.
  expect([403, 422]).toContain((await dana.post(data("saved_views"), { data: { values: { name: "P13 nobody's", filters: {}, owner_id: null }, clientKey: "p13danaviewnobodyAAAAAAAAAAAAAAA" }, headers })).status());
  // Read-only has none and saves none; the marketer has no saved views at all.
  const grace = await api("grace");
  expect((await rows(grace, data, "saved_views")).length).toBe(0);
  expect((await grace.post(data("saved_views"), { data: { values: { name: "P13 no", filters: {} }, clientKey: "p13graceviewAAAAAAAAAAAAAAAAAAAA" }, headers: await csrf(grace) })).status()).toBe(403);
  expect((await (await api("lena")).get(data("saved_views", "?limit=1"))).status()).toBe(403);
  const lena = await (await as("lena")).newPage();
  await lena.goto(`${STAFF}saved-views`);
  await expect(lena.getByText("This page is not part of your role")).toBeVisible();
});

test("a person's own in Arabic, right to left, 390 wide", async ({ as, api }) => {
  const corin = await api("corin");
  await inArabic(corin, async () => {
    const page = await (await as("corin", { viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(`${STAFF}notifications`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الإشعارات");
    await expect(page.locator(".crm-told-row .crm-told-label")).toHaveText(["أحدهم يذكرني"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await picture(page, "7-corin-told-ar-390");
    await page.goto(`${STAFF}me`);
    await expect(page.getByTestId("me-role")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

// The next file is the board's, as Dana and Ivy: both were busy here, and each person's requests are counted by the minute.
test.afterAll(async () => {
  await minuteOut();
});
