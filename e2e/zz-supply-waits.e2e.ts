/**
 * P16, the part waiting for its add-on: Supply with the Inventory add-on NOT
 * connected to this app. The install's owner switches Inventory off for the
 * CRM (Adminium's own route, as on the app's Add-ons card), which is what an
 * install that never had it looks like to the app: the part is off and none
 * of its tables are anybody's to read. Inventory is switched back on at the
 * end, whatever happened.
 *
 * Named to run LAST: switching an add-on off and on rebuilds the server's
 * add-on runtime and takes its grants away for the while, which a spec running
 * beside it on Supply (or on quotes, through the runtime) must not meet.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, STAFF, unfoldMenu, watch } from "./helpers.ts";

async function inventoryFor(owner: APIRequestContext, enabled: boolean): Promise<void> {
  const res = await owner.patch("/api/v1/add-ons/inventory", { data: { attachedTo: "crm", enabled }, headers: await csrf(owner) });
  expect(res.status(), await res.text()).toBe(200);
}

test("with Inventory not connected, Supply says what it waits for: the owner is told where, the CRM admin whom to ask; nothing else breaks", async ({ as, api, stand }) => {
  const owner = await api("owner");
  const items = `/api/v1/data/${stand.connectionId}/${encodeURIComponent(stand.tables["inventory_items"] ?? "inventory_items")}?limit=1`;
  const tessa = await api("tessa");
  expect((await tessa.get(items)).status()).toBe(200);
  await inventoryFor(owner, false);
  try {
    // The server first: the add-on's tables are nobody's now, and the app's own need of a deal neither.
    expect((await tessa.get(items)).status()).toBe(403);
    const config = (await (await tessa.get(`${STAFF}surface-config.json`)).json()) as { modules: Record<string, boolean>; addOns?: Record<string, unknown> };
    expect(config.modules["supply"]).toBe(false);
    expect(Object.keys(config.addOns ?? {})).not.toContain("inventory");

    // The CRM admin: Supply stays in her menu, and says so.
    const page = await (await as("tessa")).newPage();
    const problems = watch(page);
    await page.goto(STAFF);
    await unfoldMenu(page);
    const menu = page.getByRole("navigation", { name: "Menu" });
    await menu.getByRole("link", { name: "Stock and lead times" }).click();
    await expect(page).toHaveURL(/\/stock$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supply is waiting for the Inventory add-on");
    await expect(page.locator(".crm-plain")).toContainText("If you need it, ask the person who runs this install to connect it.");
    await expect(page.getByTestId("waits-open")).toHaveCount(0);
    await picture(page, "p16-8-tessa-supply-waits");
    await menu.getByRole("link", { name: "Supplier scorecard" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supply is waiting for the Inventory add-on");
    // Nothing else is broken: the rest of her menu opens as before.
    await menu.getByRole("link", { name: "Team view" }).click();
    await expect(page).toHaveURL(/\/team$/);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Supply is waiting for the Inventory add-on");
    expect(problems).toEqual([]);

    // The install's owner is told where to connect it.
    const own = await (await as("owner")).newPage();
    await own.goto(`${STAFF}suppliers`);
    await expect(own.getByRole("heading", { level: 1 })).toHaveText("Supply is waiting for the Inventory add-on");
    await expect(own.locator(".crm-plain")).toContainText("Connect it in Adminium, on this app’s page under Add-ons");
    await expect(own.getByTestId("waits-open")).toHaveAttribute("href", "/studio/apps/crm");
    await picture(own, "p16-9-owner-supply-waits");

    // A rep who types the address is told it is not hers, not what it waits for.
    const dana = await (await as("dana")).newPage();
    await dana.goto(`${STAFF}stock`);
    await expect(dana.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");

    // The operations manager's only part waits: the server itself refuses her the app's screens (Adminium's page, not the app's).
    const ada = await api("ada");
    const refused = await ada.get(`${STAFF}surface-config.json`);
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("NO_STAFF_ACCESS");
    const adaPage = await (await as("ada")).newPage();
    await adaPage.goto(STAFF);
    await picture(adaPage, "p16-10-ada-supply-waits");
  } finally {
    await inventoryFor(owner, true);
  }
  // Connected again: the grants are back, and so are the figures.
  expect((await tessa.get(items)).status()).toBe(200);
  const page = await (await as("tessa")).newPage();
  await page.goto(`${STAFF}stock`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stock and lead times");
  await expect(page.locator('.crm-sup-tile[data-figure="empty"] .crm-sup-tile-value')).toHaveText("3");
});
