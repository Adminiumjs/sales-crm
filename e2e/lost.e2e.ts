/**
 * P11, Why we lose and One reason (ledger §31, §32): 18 lost deals for
 * 294,400 in twelve months, 10 for 135,100 in six, 5 for 95,500 in three.
 *
 * Reached from the menu as the sales manager, the CRM admin and Read-only.
 * Makes no row. (Who is refused, by the route and by the server: `manager.e2e.ts`.)
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { rows, STAFF, watch } from "./helpers.ts";

const stat = (page: Page, label: string) => page.locator(`.crm-stat[data-stat="${label}"]`);
const reason = (page: Page, label: string) => page.locator(".crm-lr-reason").filter({ hasText: label });
const money = (value: number): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);

test("Why we lose: the ledger's twelve, six and three months", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Why we lose" }).click();
  await expect(page).toHaveURL(/\/why-we-lose$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Why we lose");
  await expect(page.locator(".crm-screen-sub")).toContainText("The last 12 months of lost work");
  await expect(stat(page, "Lost value").locator(".crm-stat-value")).toHaveText("£294,400");
  await expect(stat(page, "Lost value")).toContainText("18 deals");
  await expect(stat(page, "Average size").locator(".crm-stat-value")).toHaveText("£16,356");
  await expect(stat(page, "Biggest reason").locator(".crm-stat-value")).toHaveText("Went with another supplier");
  await expect(stat(page, "Biggest reason")).toContainText("£111,100 · 38%");
  await expect(stat(page, "Won alongside").locator(".crm-stat-value")).toHaveText("8");
  // The reasons, the most lost first; a three-way tie is named as one.
  const list = page.locator(".crm-lr-reason");
  await expect(list).toHaveCount(5);
  for (const [i, label, value, share, count, mostly] of [
    [0, "Went with another supplier", "£111,100", "38%", "6 deals", "mostly at Proposal (4 of 6)"],
    [1, "Wrong fit for us", "£77,300", "26%", "3 deals", "mostly at Discovery (2 of 3)"],
    [2, "Lost on timing", "£49,800", "17%", "3 deals", "mostly at Negotiation (2 of 3)"],
    [3, "Budget pulled", "£33,300", "11%", "3 deals", "mostly at Qualified (2 of 3)"],
    [4, "No decision made", "£22,900", "8%", "3 deals", "mostly at Discovery / Qualified / Proposal (1 of 3)"],
  ] as const) {
    await expect(list.nth(i)).toContainText(label);
    await expect(list.nth(i).locator(".crm-tm-amount")).toHaveText(value);
    await expect(list.nth(i).locator(".crm-lr-share")).toHaveText(share);
    await expect(list.nth(i)).toContainText(count);
    await expect(list.nth(i)).toContainText(mostly);
  }
  for (const [label, value] of [["Discovery", "£55,500"], ["Qualified", "£62,800"], ["Proposal", "£72,400"], ["Negotiation", "£103,700"], ["Verbal", "£0"]] as const) await expect(page.locator(`.crm-lr-stages [data-stage="${label}"]`)).toContainText(value);
  await expect(page.locator('[data-figure="late"]')).toContainText("£103,700 was lost in Negotiation / Verbal");
  expect(problems).toEqual([]);
  await picture(page, "1-ivy-why-we-lose");

  const windows = page.getByRole("group", { name: "How far back" });
  await windows.getByRole("button", { name: "6 months" }).click();
  await expect(stat(page, "Lost value").locator(".crm-stat-value")).toHaveText("£135,100");
  await expect(stat(page, "Lost value")).toContainText("10 deals");
  await expect(stat(page, "Average size").locator(".crm-stat-value")).toHaveText("£13,510");
  await expect(stat(page, "Won alongside").locator(".crm-stat-value")).toHaveText("5");
  await expect(reason(page, "Went with another supplier").locator(".crm-lr-share")).toHaveText("43%");
  await expect(reason(page, "Wrong fit for us").locator(".crm-lr-share")).toHaveText("3%");
  await windows.getByRole("button", { name: "3 months" }).click();
  await expect(stat(page, "Lost value").locator(".crm-stat-value")).toHaveText("£95,500");
  await expect(stat(page, "Lost value")).toContainText("5 deals");
  await expect(stat(page, "Average size").locator(".crm-stat-value")).toHaveText("£19,100");
  await expect(stat(page, "Won alongside").locator(".crm-stat-value")).toHaveText("3");
  await expect(page.locator(".crm-lr-reason")).toHaveCount(3);
  await expect(reason(page, "Went with another supplier")).toContainText("£51,700");
  await expect(reason(page, "Went with another supplier").locator(".crm-lr-share")).toHaveText("54%");
});

test("every figure on Why we lose is what the server answers that person, asked directly", async ({ as, data }) => {
  for (const person of ["ivy", "tessa", "grace"]) {
    const context = await as(person);
    const page = await context.newPage();
    await page.goto(`${STAFF}why-we-lose`);
    const lost = await rows<{ amount: number; lost_reason_id: number; stage_id: number }>(context.request, data, "deals", { and: [{ column: "state", op: "eq", value: "lost" }, { column: "closed_on", op: "gte", value: "2025-07-28" }] });
    const reasons = await rows<{ id: number; label: string }>(context.request, data, "lost_reasons");
    const total = lost.reduce((n, deal) => n + Number(deal.amount), 0);
    await expect(stat(page, "Lost value").locator(".crm-stat-value"), person).toHaveText(money(total));
    await expect(stat(page, "Lost value"), person).toContainText(`${String(lost.length)} deals`);
    await expect(stat(page, "Average size").locator(".crm-stat-value"), person).toHaveText(money(Math.round(total / lost.length)));
    for (const one of reasons) {
      const mine = lost.filter((deal) => deal.lost_reason_id === one.id);
      if (mine.length === 0) continue;
      const value = mine.reduce((n, deal) => n + Number(deal.amount), 0);
      await expect(reason(page, one.label).locator(".crm-tm-amount"), `${person} ${one.label}`).toHaveText(money(value));
      await expect(reason(page, one.label).locator(".crm-lr-share"), `${person} ${one.label}`).toHaveText(`${String(Math.round((value / total) * 100))}%`);
    }
  }
});

test("One reason: the deals behind it, where it dies and which of us", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}why-we-lose`);
  await reason(page, "Went with another supplier").click();
  await expect(page).toHaveURL(/\/why-we-lose\/\d+\/12$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Went with another supplier");
  await expect(page.locator(".crm-screen-sub")).toContainText("6 deals, £111,100 of work. Looking back: 12 months.");
  await expect(page.locator('[data-figure="share"]')).toHaveText("38% of everything lost");
  await expect(stat(page, "Value").locator(".crm-stat-value")).toHaveText("£111,100");
  await expect(stat(page, "Average size").locator(".crm-stat-value")).toHaveText("£18,517");
  await expect(stat(page, "Usually dies at").locator(".crm-stat-value")).toHaveText("Proposal");
  await expect(stat(page, "Usually dies at")).toContainText("4 of 6");
  await expect(stat(page, "Most recent").locator(".crm-stat-value")).toHaveText("Tue, Jun 30");
  await expect(stat(page, "Most recent")).toContainText("Trading-floor desk rows");
  const deals = page.locator(".crm-l1-deal");
  await expect(deals).toHaveCount(6);
  await expect(deals.first()).toContainText("Trading-floor desk rows");
  await expect(deals.first()).toContainText("Low Orbit · Sam · lost Tue, Jun 30");
  await expect(deals.first()).toContainText("£38,000");
  await expect(deals.first()).toContainText("Negotiation");
  const reps = page.locator(".crm-l1-reps > div");
  expect(await reps.evaluateAll((list) => list.map((one) => one.textContent))).toEqual(["PRPriya Raman£38,200", "SOSam Okonjo£38,000", "DWDana Whitlock£22,100", "LVLeo Vance£12,800"]);
  expect(problems).toEqual([]);
  await picture(page, "2-ivy-one-reason");

  // The server's own rows for that reason, read directly.
  const id = Number(/why-we-lose\/(\d+)\//.exec(page.url())![1]);
  const mine = await rows<{ amount: number }>(context.request, data, "deals", { and: [{ column: "state", op: "eq", value: "lost" }, { column: "closed_on", op: "gte", value: "2025-07-28" }, { column: "lost_reason_id", op: "eq", value: id }] });
  expect(mine.length).toBe(6);
  await expect(stat(page, "Value").locator(".crm-stat-value")).toHaveText(money(mine.reduce((n, deal) => n + Number(deal.amount), 0)));

  // Back, then the reason that ties three ways.
  await page.getByRole("link", { name: "Why we lose" }).first().click();
  await expect(page).toHaveURL(/\/why-we-lose$/);
  await reason(page, "No decision made").click();
  await expect(stat(page, "Usually dies at").locator(".crm-stat-value")).toHaveText("Discovery / Qualified / Proposal");
  await expect(stat(page, "Usually dies at")).toContainText("1 of 3");
  await expect(stat(page, "Most recent").locator(".crm-stat-value")).toHaveText("Sat, Apr 18");
  // A reason that is not there reads as no record.
  await page.goto(`${STAFF}why-we-lose/9999/12`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("There is no record at this address");
});

test("Why we lose at 390 wide in the dark, and Read-only reads it", async ({ as }) => {
  const narrow = await (await as("grace", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await narrow.goto(`${STAFF}why-we-lose`);
  await expect(narrow.locator(".crm-lr-reason")).toHaveCount(5);
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await narrow.locator(".crm-lr-reason").first().click();
  await expect(narrow.locator(".crm-l1-deal")).toHaveCount(6);
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "3-grace-one-reason-390-dark");
});
