import { csrf, rows, unfoldMenu } from "./helpers.ts";
/**
 * P02, This week: the follow-ups due up to Sunday, a lane a day, with the
 * ledger's figures (§7 of `figures.md`): Mon 27 Jul to Sun 2 Aug, 7 follow-ups,
 * 143,400 riding on them (each deal once), and
 * Before Monday 1 · 52,800; Monday 2 · 30,700; Tuesday 2 · 38,400;
 * Wednesday 1 · 21,500; Thursday 1 · 52,800; Friday to Sunday 0.
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";

const STAFF = "/apps/crm/staff/";
const lane = (page: Page, key: string) => page.locator(`[data-lane="${key}"]`);
const facts = async (page: Page): Promise<[string, string, string][]> =>
  page.locator(".crm-lane").evaluateAll((lanes) => lanes.map((el) => [el.getAttribute("data-lane") ?? "", el.querySelector(".crm-lane-count")?.textContent?.trim() ?? "", el.querySelector(".crm-lane-sum")?.textContent?.trim() ?? ""]));
const LEDGER: [string, string, string][] = [
  ["before", "1", "£52,800"],
  ["2026-07-27", "2", "£30,700"],
  ["2026-07-28", "2", "£38,400"],
  ["2026-07-29", "1", "£21,500"],
  ["2026-07-30", "1", "£52,800"],
  ["2026-07-31", "0", "—"],
  ["2026-08-01", "0", "—"],
  ["2026-08-02", "0", "—"],
];

test("Dana opens This week from her menu and from Today, with the ledger's lanes", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${STAFF}today`);
  await page.getByRole("link", { name: "This week" }).last().click();
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/week$/);
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This week");
  await expect(page.locator(".crm-facts")).toContainText("Mon, Jul 27 — Sun, Aug 2");
  await expect(page.getByTestId("week-count")).toHaveText("7");
  await expect(page.getByTestId("week-value")).toHaveText("£143,400");
  await expect.poll(() => facts(page)).toEqual(LEDGER);
  // Tuesday is today; what was left from last week is marked late.
  await expect(lane(page, "2026-07-28").locator(".crm-pill-accent")).toHaveText("Today");
  await expect(lane(page, "before")).toContainText("Before Monday");
  await expect(lane(page, "before").locator(".crm-card")).toContainText("Fourth-floor desk rows");
  await expect(lane(page, "2026-07-31")).toContainText("Clear");
  // She works alone here: no chips to narrow by, no corner that says whose a card is.
  await expect(page.locator(".crm-chips")).toHaveCount(0);
  // Back goes back, and the button goes home.
  await page.getByRole("link", { name: "Back to Today" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/week$/);
  expect(errors).toEqual([]);
  await picture(page, "1-dana-week");
});

test("a card is moved to another day by its Move button with the keyboard, and by dragging; the lanes' figures follow", async ({ as, data }) => {
  // Wide enough to hold all eight lanes: a drag onto a lane that must first be scrolled to is the browser's own to do, not this spec's.
  const context = await as("dana", { viewport: { width: 2400, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${STAFF}week`);
  await expect.poll(() => facts(page)).toEqual(LEDGER);

  // Wednesday's one card (Quiet-room pods, 09:30, 21,500) to Friday, by keyboard.
  const move = lane(page, "2026-07-29").getByRole("button", { name: /Move “Quiet-room pods”/ });
  await move.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Move to" });
  await expect(menu).toBeVisible();
  // Every day of the week but its own.
  await expect(menu.getByRole("menuitem")).toHaveCount(6);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(move).toBeFocused();
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: /Friday/ }).press("Enter");
  await expect(page.locator(".crm-toast")).toContainText("Moved to Fri, Jul 31, 09:30");
  await expect.poll(() => facts(page)).toEqual(LEDGER.map((row) => (row[0] === "2026-07-29" ? [row[0], "0", "—"] : row[0] === "2026-07-31" ? [row[0], "1", "£21,500"] : row)));
  // The page's own figures do not move: the same seven, the same deals.
  await expect(page.getByTestId("week-count")).toHaveText("7");
  await expect(page.getByTestId("week-value")).toHaveText("£143,400");
  await picture(page, "2-dana-moved-to-friday");

  // Thursday's card (the other step on Fourth-floor desk rows, 11:00) dragged onto Saturday.
  await lane(page, "2026-07-30").locator(".crm-card").dragTo(lane(page, "2026-08-01").locator(".crm-lane-cards"));
  await expect(page.locator(".crm-toast")).toContainText("Moved to Sat, Aug 1, 11:00");
  await expect(lane(page, "2026-08-01").locator(".crm-card")).toContainText("Fourth-floor desk rows");

  // What the server holds, asked directly; then both back where the ledger has them.
  const steps = (await (await context.request.get(data("follow_ups", "?limit=200&order=id"))).json()) as { data: { id: number; due_at: string; text: string }[] };
  const pods = steps.data.find((step) => step.due_at === "2026-07-31T08:30:00.000Z")!;
  const rows = steps.data.find((step) => step.due_at === "2026-08-01T10:00:00.000Z")!;
  expect([pods !== undefined, rows !== undefined]).toEqual([true, true]);
  const config = (await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string };
  const headers = { "x-adminium-csrf": config.csrfToken };
  expect((await context.request.patch(data("follow_ups", `/${String(pods.id)}`), { data: { values: { due_at: "2026-07-29T08:30:00.000Z" } }, headers })).status()).toBe(200);
  expect((await context.request.patch(data("follow_ups", `/${String(rows.id)}`), { data: { values: { due_at: "2026-07-30T10:00:00.000Z" } }, headers })).status()).toBe(200);
  await expect.poll(() => facts(page)).toEqual(LEDGER);
});

test("the sales manager sees her team's week, says whose each card is, and narrows it to one person", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  await page.goto(STAFF);
  // She lands on her home, the Team view, and opens This week from the menu.
  await expect(page).toHaveURL(/\/team$/);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "This week" }).click();
  await expect(page).toHaveURL(/\/week$/);
  await expect(page.getByTestId("week-count")).toHaveText("7");
  await expect.poll(() => facts(page)).toEqual(LEDGER);
  // Only Dana has follow-ups this week: the chips are All and Dana, and each card carries her initials.
  await expect(page.locator(".crm-chips button")).toHaveText(["All", "Dana"]);
  await expect(lane(page, "before").locator(".crm-avatar-sm")).toHaveText("DW");
  await page.getByRole("button", { name: "Dana" }).click();
  await expect(page.getByRole("button", { name: "Dana" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("week-count")).toHaveText("7");
  await picture(page, "3-ivy-team-week");
});

test("Read-only reads the week and can change nothing: no tick, no Move, and the server refuses the write", async ({ as, data }) => {
  const context = await as("grace");
  const page = await context.newPage();
  await page.goto(`${STAFF}week`);
  await expect(page.getByTestId("week-count")).toHaveText("7");
  await expect(page.getByRole("button", { name: /Move “/ })).toHaveCount(0);
  await expect(page.locator(".crm-card-tick").first()).toBeDisabled();
  await expect(page.locator('.crm-card[draggable="true"]')).toHaveCount(0);
  await expect(page.locator(".crm-week-hint")).toHaveCount(0);
  const config = (await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string };
  const refused = await context.request.patch(data("follow_ups", "/1"), { data: { values: { done: true } }, headers: { "x-adminium-csrf": config.csrfToken } });
  expect(refused.status()).toBe(403);
});

test("the marketer has no This week: her address for it is refused, as the server refuses the rows", async ({ as, api, data }) => {
  const page = await (await as("lena")).newPage();
  await page.goto(`${STAFF}week`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "This week" })).toHaveCount(0);
  expect((await (await api("lena")).get(data("follow_ups", "?limit=5"))).status()).toBe(403);
});

test("This week at 390 wide: the lanes scroll inside themselves, the page does not", async ({ as }) => {
  const context = await as("dana", { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${STAFF}week`);
  await expect(page.getByTestId("week-count")).toHaveText("7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator(".crm-lanes-scroll").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await picture(page, "4-dana-week-390");
});

test("the week starts on the business's first day, and a narrowed week is kept as a view and opened again (S9, S7)", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  const settings = (await rows<{ id: number; week_starts: string }>(tessa, data, "settings"))[0]!;
  const startOn = async (day: string): Promise<void> => {
    expect((await tessa.patch(data("settings", `/${String(settings.id)}`), { data: { values: { week_starts: day } }, headers: await csrf(tessa) })).status()).toBe(200);
  };
  try {
    // S9: a business whose week starts on Sunday sees Sunday to Saturday; what is from before is "Before Sunday".
    await startOn("sun");
    const page = await (await as("dana")).newPage();
    await page.goto(`${STAFF}week`);
    await expect(page.locator(".crm-facts")).toContainText("Sun, Jul 26 — Sat, Aug 1");
    await expect(lane(page, "2026-07-26")).toBeVisible();
    await expect(lane(page, "2026-08-02")).toHaveCount(0);
    await expect(lane(page, "before")).toContainText("Before Sunday");
  } finally {
    await startOn(settings.week_starts);
  }

  // S7: the sales manager narrows This week to one of her people and keeps it as a view; opened from Saved views, it is
  // that person's week again.
  const context = await as("ivy");
  const ivy = context.request;
  const page = await context.newPage();
  await page.goto(`${STAFF}week`);
  const person = page.locator(".crm-chips").getByRole("button").nth(1);
  const first = (await person.innerText()).trim();
  await person.click();
  await page.getByTestId("viewbar-save").click();
  const box = page.getByRole("dialog", { name: "Save this view" });
  await expect(box.getByTestId("view-holds")).toHaveText(`It keeps: ${first}’s`);
  await box.getByLabel("What to call it").fill("Spec: a person's week");
  await page.keyboard.press("Enter");
  await expect(page.locator(".crm-toast")).toHaveText("“Spec: a person's week” is saved. It is under Saved views.");
  const view = (await rows<{ id: number; filters: unknown }>(ivy, data, "saved_views", { column: "name", op: "eq", value: "Spec: a person's week" }))[0]!;
  try {
    expect(JSON.parse(typeof view.filters === "string" ? view.filters : JSON.stringify(view.filters))).toMatchObject({ screen: "week" });
    const fresh = await context.newPage();
    await fresh.goto(`${STAFF}saved-views`);
    await fresh.locator(`[data-view="${String(view.id)}"]`).filter({ hasText: "Spec: a person's week" }).getByRole("link").first().click();
    await expect(fresh).toHaveURL(new RegExp(`/week/view/${String(view.id)}$`));
    await expect(fresh.getByTestId("viewbar-showing")).toContainText("Spec: a person's week");
    await expect(fresh.locator(".crm-chips").getByRole("button", { name: first, exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    expect((await ivy.delete(data("saved_views", `/${String(view.id)}?confirm=true`), { headers: await csrf(ivy) })).status()).toBeLessThan(300);
  }
});
