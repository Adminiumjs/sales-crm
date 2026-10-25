/**
 * Switch the Inbox part off (Studio → the app → Parts) and open the console Overview: the "Unclaimed enquiries" card is
 * gone and the page whole; switch it on again and the card is back where it was.
 *
 * The engine's own spec (`apps/e2e/tests/console-cards.spec.ts`, "a card of a part that is off is not drawn") hands the
 * dashboard a page with the card taken out; here the part is switched off for real, through Studio, on an install of
 * the CRM, and the server's own page reply leaves the card out.
 *
 * The part is switched on again whatever happens.
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, watch } from "./helpers.ts";

/** Every card of the Overview, with where it is drawn. */
const cards = (page: Page): Promise<{ key: string; x: number; y: number; w: number; h: number }[]> =>
  page.locator("[data-grid-item]").evaluateAll((all) =>
    all.map((card) => {
      const box = card.getBoundingClientRect();
      return { key: card.getAttribute("data-grid-item") ?? "", x: Math.round(box.x), y: Math.round(box.y + window.scrollY), w: Math.round(box.width), h: Math.round(box.height) };
    }),
  );

async function switchInbox(page: Page, on: boolean): Promise<void> {
  await page.goto("/studio/apps/crm");
  const parts = page.getByTestId("app-parts");
  const inbox = parts.getByRole("switch", { name: "Inbox, on or off" });
  await expect(inbox).toHaveAttribute("aria-checked", String(!on));
  await inbox.click();
  // The switch says what it will do, and asks first.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(on ? "Switch on Inbox?" : "Switch off Inbox?");
  const [saved] = await Promise.all([page.waitForResponse((res) => res.url().endsWith("/api/v1/apps/crm/parts/inbox") && res.request().method() === "PUT"), dialog.getByRole("button", { name: on ? "Switch on" : "Switch off", exact: true }).click()]);
  expect(saved.status(), await saved.text()).toBe(200);
  await expect(inbox).toHaveAttribute("aria-checked", String(on));
}

test("the Inbox part off: the Overview has no Unclaimed enquiries card and is whole; on again, the card is back where it was", async ({ as }) => {
  const context = await as("owner");
  const owner = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/p/crm-overview");
  await expect(page.locator('[data-grid-item="unclaimed-enquiries"]')).toContainText("Unclaimed enquiries");
  await expect(page.locator('[data-grid-item="sitting"]')).toBeVisible();
  await expect(page.locator('[data-grid-item="reps"]').getByRole("row").filter({ hasText: "Dana" })).toContainText("89");
  const before = await cards(page);
  expect(before.map((one) => one.key)).toContain("unclaimed-enquiries");
  try {
    await switchInbox(page, false);
    await picture(page, "zw-studio-inbox-off");
    await page.goto("/p/crm-overview");
    await expect(page.locator('[data-grid-item="open-pipeline"]')).toContainText("Open pipeline");
    await expect(page.locator('[data-grid-item="sitting"]')).toBeVisible();
    // Gone, the card and its words.
    await expect(page.locator('[data-grid-item="unclaimed-enquiries"]')).toHaveCount(0);
    await expect(page.getByText("Unclaimed enquiries")).toHaveCount(0);
    // Whole: every other card is there and drawn, none says it failed, none sits over another, nothing sideways.
    const off = await cards(page);
    expect(off.map((one) => one.key)).toEqual(before.map((one) => one.key).filter((key) => key !== "unclaimed-enquiries"));
    for (const one of off) expect(one.w * one.h, one.key).toBeGreaterThan(0);
    for (const [i, a] of off.entries()) for (const b of off.slice(i + 1)) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.key} over ${b.key}`).toBe(false);
    await expect(page.locator("main").getByRole("button", { name: /try again|retry/i })).toHaveCount(0);
    await expect(page.locator('[data-grid-item="reps"]').getByRole("row").filter({ hasText: "Dana" })).toContainText("89");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await picture(page, "zw-overview-inbox-off");
  } finally {
    await switchInbox(page, true).catch(async () => {
      // The switch by its own route, if the page could not do it: the stand must not be left with the part off.
      expect((await owner.put("/api/v1/apps/crm/parts/inbox", { data: { on: true }, headers: await csrf(owner) })).status()).toBe(200);
    });
  }
  await page.goto("/p/crm-overview");
  await expect(page.locator('[data-grid-item="unclaimed-enquiries"]')).toContainText("Unclaimed enquiries");
  await expect(page.locator('[data-grid-item="unclaimed-enquiries"]')).toContainText("4");
  await expect(page.locator('[data-grid-item="sitting"]')).toBeVisible();
  await expect(page.locator('[data-grid-item="reps"]').getByRole("row").filter({ hasText: "Dana" })).toContainText("89");
  // Back where it was: every card where it was before.
  expect(await cards(page)).toEqual(before);
  expect(problems).toEqual([]);
});
