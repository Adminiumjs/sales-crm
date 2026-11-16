/**
 * Paying for a quote, while the CRM takes no payments: a stand has no payment
 * service, so the CRM's payable stays switched off, and every screen must read
 * exactly as it did before payments.
 *
 *  - the staff config says payments are off, and nobody may refund;
 *  - Settings → Selling has no Payments card;
 *  - the customer's page of a quote still on offer has its Accept and Decline,
 *    and no "Pay now", no Stripe or PayPal, no test band;
 *  - the customer's link reads what a quote asks of its own quote only.
 *
 * WHAT THIS CHANGES: nothing. It reads, so it may run anywhere in the order.
 */
import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { rows, STAFF, unfoldMenu, watch } from "./helpers.ts";
import { linkCodeOf, readState } from "./stand.mjs";

const CUSTOMER = "/apps/crm/customer/";

async function stranger(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: readState()!.url, locale: "en-US" });
  return context.newPage();
}

test("the staff config says the CRM takes no payments, and nobody may refund", async ({ api }) => {
  for (const person of ["tessa", "ivy", "dana"]) {
    const config = (await (await (await api(person)).get(`${STAFF}surface-config.json`)).json()) as { payments?: { on: boolean; online: boolean; refund: boolean } };
    expect(config.payments, person).toMatchObject({ on: false, online: false });
  }
});

test("Settings → Selling has no Payments card while the CRM takes no payments", async ({ as }) => {
  const page = await (await as("tessa")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.locator('.crm-ast-card[data-card="quotes"]')).toBeVisible();
  await expect(page.locator('.crm-ast-card[data-card="payments"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/Stripe|PayPal/);
  expect(problems.filter((line) => !/net::ERR|openfreemap|maplibre/i.test(line))).toEqual([]);
});

test("a quote's page offers Accept and Decline as always, and nothing to pay", async ({ browser, api, data }) => {
  const dana = await api("dana");
  const quote = (await rows<{ id: number }>(dana, data, "quotes", { column: "number", op: "eq", value: "Q-1002" }))[0]!;
  const page = await stranger(browser);
  const problems = watch(page);
  await page.goto(`${CUSTOMER}#${await linkCodeOf(quote.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Q-1002");
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(page.getByTestId("pay-now")).toHaveCount(0);
  await expect(page.getByTestId("pay-test")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/Stripe|PayPal|Pay /);
  expect(problems).toEqual([]);
});
