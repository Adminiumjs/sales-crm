/**
 * Paying for a quote, while the CRM takes no payments: a stand has no payment
 * service, so the CRM's payable stays switched off, and every screen must read
 * exactly as it did before payments.
 *
 *  - the staff config says payments are off;
 *  - Settings → Selling has no Payments card.
 *
 * The customer's page is read by `z-customer-page.e2e.ts`, unchanged with
 * payments off: a spec here opening a quote's link too would spend the
 * stand's budget of public sign-ins from one address, which that file needs.
 *
 * WHAT THIS CHANGES: nothing. It reads, so it may run anywhere in the order.
 */
import { expect, test } from "./fixtures.ts";
import { STAFF, unfoldMenu, watch } from "./helpers.ts";

test("the staff config says the CRM takes no payments", async ({ api }) => {
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
