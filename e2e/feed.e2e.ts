/**
 * P11, the Activity feed (ledger §18): 26 activities (8 calls, 7 emails,
 * 4 meetings, 7 notes) and 40 stage changes on the 14 open deals; 20 to a
 * page.
 *
 * The live spec logs one call as Dana ("P11 feed …") and takes it away.
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch } from "./helpers.ts";

const kind = (page: Page, type: string) => page.locator(`.crm-chip-btn[data-type="${type}"]`);
const entries = (page: Page) => page.locator(".crm-feed-entry");

test("the Activity feed: the ledger's counts, twenty to a page, narrowed by kind and by person", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Activity feed" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Activity");
  for (const [type, count] of [["call", "8"], ["email", "7"], ["meeting", "4"], ["note", "7"], ["stage", "40"], ["amount", "0"]] as const) await expect(kind(page, type).locator(".crm-chip-count")).toHaveText(count);
  // "Everything" is three tables: it carries no count of its own.
  await expect(kind(page, "all").locator(".crm-chip-count")).toHaveCount(0);
  await expect(entries(page)).toHaveCount(20);
  // The newest thing logged: Dana's call on d3, this morning.
  await expect(page.locator(".crm-feed-day").first().locator(".crm-tm-label")).toHaveText("Today · Tue, Jul 28");
  await expect(entries(page).first()).toContainText("Records-room lockers");
  await expect(entries(page).first()).toContainText("Cobalt Legal");
  await expect(entries(page).first()).toContainText("Call");
  await expect(entries(page).first()).toContainText("Dana");
  await expect(entries(page).first()).toContainText("09:05");
  await expect(entries(page).first()).toContainText("Ines said the verbal is firm.");
  await expect(page.locator(".crm-feed-day").nth(1).locator(".crm-tm-label")).toHaveText("Yesterday · Mon, Jul 27");
  expect(problems).toEqual([]);
  await picture(page, "1-ivy-feed");
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(entries(page)).toHaveCount(40);

  // Stage changes only: forty, fourteen of them a deal's opening.
  await kind(page, "stage").click();
  await expect(entries(page)).toHaveCount(20);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(entries(page)).toHaveCount(40);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
  await expect(entries(page).filter({ hasText: "Opened in " })).toHaveCount(14);
  await expect(entries(page).filter({ hasText: /Moved from \w+ to \w+/ })).toHaveCount(26);

  // Calls only, then Dana's: what the server answers Ivy directly.
  await kind(page, "call").click();
  await expect(entries(page)).toHaveCount(8);
  await expect(page.locator('.crm-feed-entry:not([data-type="call"])')).toHaveCount(0);
  await kind(page, "all").click();
  const dana = ((await (await context.request.get("/api/v1/people?q=Dana&limit=5")).json()) as { people: { id: string }[] }).people[0]!.id;
  await page.getByRole("group", { name: "Whose" }).getByRole("button", { name: "Dana" }).click();
  const open = (await rows<{ id: number }>(context.request, data, "deals", { column: "state", op: "eq", value: "open" })).map((deal) => deal.id);
  const hers = await rows<{ kind: string }>(context.request, data, "activities", { and: [{ column: "author_id", op: "eq", value: dana }, { column: "deal_id", op: "in", value: open }] });
  expect(hers.length).toBe(12);
  for (const type of ["call", "email", "meeting", "note"]) await expect(kind(page, type).locator(".crm-chip-count"), type).toHaveText(String(hers.filter((one) => one.kind === type).length));
  const moves = await rows(context.request, data, "deal_stage_changes", { and: [{ column: "by_id", op: "eq", value: dana }, { column: "deal_id", op: "in", value: open }] });
  await expect(kind(page, "stage").locator(".crm-chip-count")).toHaveText(String(moves.length));
  // Everybody again: each kind's count is the server's over the open deals.
  await page.getByRole("group", { name: "Whose" }).getByRole("button", { name: "Everyone" }).click();
  const all = await rows<{ kind: string }>(context.request, data, "activities", { column: "deal_id", op: "in", value: open });
  expect(all.length).toBe(26);
  for (const type of ["call", "email", "meeting", "note"]) await expect(kind(page, type).locator(".crm-chip-count"), type).toHaveText(String(all.filter((one) => one.kind === type).length));
  // "Just mine" as Ivy, who logged nothing: the empty state.
  await page.getByRole("button", { name: "Just mine" }).click();
  await expect(page.getByText("Nothing matches those filters")).toBeVisible();
  await expect(entries(page)).toHaveCount(0);
});

test("live: Dana logs a call and Ivy's open feed follows", async ({ as, api, data }) => {
  const admin = await api("tessa");
  const headers = await csrf(admin);
  const clear = async (): Promise<void> => {
    for (const row of await rows<{ id: number }>(admin, data, "activities", { column: "text", op: "like", value: "P11 feed%" })) expect((await admin.delete(data("activities", `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  };
  await clear();
  const ivy = await (await as("ivy")).newPage();
  await ivy.goto(`${STAFF}activity`);
  await expect(kind(ivy, "call").locator(".crm-chip-count")).toHaveText("8");
  try {
    const dana = await api("dana");
    const d1 = (await rows<{ id: number }>(dana, data, "deals", { column: "name", op: "eq", value: "Fourth-floor desk rows" }))[0]!;
    const made = await dana.post(data("activities"), { data: { values: { deal_id: d1.id, kind: "call", text: "P11 feed live: Petra rang back about the desks." }, clientKey: "p11feedAAAAAAAAAAAAAAAAAAAAAAAAA" }, headers: await csrf(dana) });
    expect(made.status(), await made.text()).toBe(201);
    // No reload.
    await expect(entries(ivy).first()).toContainText("P11 feed live: Petra rang back about the desks.");
    await expect(entries(ivy).first()).toContainText("Fourth-floor desk rows");
    await expect(kind(ivy, "call").locator(".crm-chip-count")).toHaveText("9");
  } finally {
    await clear();
  }
  await expect(kind(ivy, "call").locator(".crm-chip-count")).toHaveText("8");
  await expect(entries(ivy).first()).toContainText("Ines said the verbal is firm.");
});

test("the feed for Read-only, at 390 wide in the dark", async ({ as, api, data }) => {
  const narrow = await (await as("grace", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await narrow.goto(`${STAFF}activity`);
  await expect(entries(narrow)).toHaveCount(20);
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "2-grace-feed-390-dark");
  // She reads; the server refuses her a line of her own.
  const direct = await api("grace");
  const d1 = (await rows<{ id: number }>(direct, data, "deals", { column: "name", op: "eq", value: "Fourth-floor desk rows" }))[0]!;
  expect((await direct.post(data("activities"), { data: { values: { deal_id: d1.id, kind: "note", text: "P11 feed: not hers to write" }, clientKey: "p11feedreadonlyAAAAAAAAAAAAAAAAA" }, headers: await csrf(direct) })).status()).toBe(403);
});
