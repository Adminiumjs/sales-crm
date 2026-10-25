/**
 * THE KIT'S THREE LARGE PARTS ON A PHONE'S WIDTH (390 wide): Adminium's board,
 * import wizard and map, each in the CRM screen that uses it. Each must fit,
 * never make the page scroll sideways, and still be usable there: a card
 * moved, every step of a paste looked at, a pin picked.
 *
 * Already proved elsewhere at 390: the board drawn in the dark
 * (`pipeline.e2e.ts`), Paste a list's first step and Arabic
 * (`paste-list.e2e.ts`), Territory in Arabic in the dark (`territory.e2e.ts`),
 * and the console's own board, import and place field (`zw-board`,
 * `zw-paste`, `zw-place`). This file works each part at 390, in English.
 *
 * A card moved is put back; nothing is brought in by the paste.
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, dealNamed, rows, STAFF } from "./helpers.ts";
import { bubble, mapServer, openTerritory, pinOf, pins, territoryRow } from "./territory-helpers.ts";

const PHONE = { viewport: { width: 390, height: 844 } };
const sideways = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const inView = (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.left >= -1 && box.right <= window.innerWidth + 1;
  });

test("the board on Pipeline at 390: the board scrolls inside itself, the page never does, and a card moved by keyboard is followed into view", async ({ as, data }) => {
  const context = await as("dana", PHONE);
  const stages = await rows<{ id: number; label: string }>(context.request, data, "stages", undefined, "&order=position");
  const discovery = stages[0]!;
  const qualified = stages[1]!;
  try {
    const page = await context.newPage();
    await page.goto(`${STAFF}pipeline`);
    const kit = page.locator('[data-kit-part="board"]').first();
    await expect(kit.locator("[data-board-column]")).toHaveCount(5);
    await expect(page.getByTestId("board-count")).toHaveText("6");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    // The kit's part is no wider than the screen; its columns scroll inside it.
    expect((await kit.boundingBox())!.width).toBeLessThanOrEqual(390);
    const scroller = kit.locator("[data-board-scroller]").first();
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect((await kit.locator(`[data-board-column="${String(discovery.id)}"]`).boundingBox())!.width).toBeLessThan(390);

    const chairs = kit.getByRole("button", { name: "Edit-suite chairs", exact: true });
    await chairs.focus();
    await page.keyboard.press("Enter");
    await expect(chairs).toHaveAttribute("aria-grabbed", "true");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.locator(".crm-toast")).toContainText("Edit-suite chairs → Qualified");
    expect((await dealNamed(context.request, data, "Edit-suite chairs")).stage_id).toBe(qualified.id);
    // The board brought the column the card went to into view; the page stayed the screen's width.
    await expect.poll(() => inView(page, `[data-kit-part="board"] [data-board-column="${String(qualified.id)}"] [data-board-card]`)).toBe(true);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    // Scrolled by hand to the last stage and back: inside the board.
    await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect.poll(() => inView(page, `[data-kit-part="board"] [data-board-column="${String(stages[4]!.id)}"]`)).toBe(true);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await picture(page, "zw-390-1-board");
  } finally {
    const now = await dealNamed(context.request, data, "Edit-suite chairs");
    if (now.stage_id !== discovery.id) expect((await context.request.patch(data("deals", `/${String(now.id)}`), { data: { values: { stage_id: discovery.id } }, headers: await csrf(context.request) })).status()).toBe(200);
  }
});

test("the import wizard on Paste a list at 390: the paste, the columns, the look at each line, each fits with no sideways scroll", async ({ as, api, data }) => {
  const page = await (await as("ivy", PHONE)).newPage();
  await page.goto(`${STAFF}paste-a-list`);
  const kit = page.locator('[data-kit-part="import"]').first();
  await expect(kit.getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  expect((await kit.boundingBox())!.width).toBeLessThanOrEqual(390);
  expect(await sideways(page), "the paste").toBeLessThanOrEqual(0);
  // Long cells, as a real list has them.
  const list = ["Name\tSector\tTown\tCustomer number", "ZW Kit Northumbrian Engineering and Fabrication Holdings\tHeavy engineering and fabrication\tNewcastle upon Tyne\tZWK-0001", "ZW Kit Small Co\tRetail\tYork\tZWK-0002"].join("\n");
  await kit.getByRole("textbox").fill(list);
  await kit.getByTestId("import-paste-use").click();
  const targets = kit.locator('[data-part="mapping-row"] [data-part="mapping-target"]');
  await expect(targets).toHaveCount(4, { timeout: 30_000 });
  expect(await sideways(page), "the columns").toBeLessThanOrEqual(0);
  // Every control of the step is on the screen and can be worked.
  for (let at = 0; at < 4; at += 1) expect(await targets.nth(at).evaluate((el) => { const box = el.getBoundingClientRect(); return box.width > 40 && box.right <= window.innerWidth + 1; }), `column ${String(at + 1)}`).toBe(true);
  await expect(kit.getByTestId("import-match-on")).toHaveValue("customer_no");
  await kit.getByTestId("wizard-validate").click();
  await expect(kit.locator('[data-testid="import-preview"] [data-line]')).toHaveCount(2, { timeout: 30_000 });
  await expect(kit.locator('[data-testid="import-preview"] [data-count="new"]')).toContainText("2");
  expect(await sideways(page), "the look at each line").toBeLessThanOrEqual(0);
  // The long name is held to the screen's width.
  expect(await kit.locator('[data-testid="import-preview"] [data-line]').first().evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
  const run = kit.getByTestId("wizard-run");
  await run.scrollIntoViewIfNeeded();
  await expect(run).toBeEnabled();
  expect(await run.evaluate((el) => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth + 1; })).toBe(true);
  await picture(page, "zw-390-2-import");
  // Nothing was brought in by looking.
  expect(await rows(await api("tessa"), data, "companies", { column: "name", op: "like", value: "ZW Kit %" })).toEqual([]);
});

test("the map on Territory at 390: the map stands with the list under it, a pin is picked and its row marked, nothing scrolls sideways", async ({ as }) => {
  const page = await (await as("ivy", PHONE)).newPage();
  await mapServer(page);
  await openTerritory(page);
  await expect(pins(page)).toHaveCount(5);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  const map = (await page.locator('[data-kit-part="map"]').first().boundingBox())!;
  expect(map.width).toBeLessThanOrEqual(390);
  expect(map.height).toBeGreaterThan(200);
  // The list goes under the map, not beside it.
  const list = (await page.locator("#crm-terr-list").boundingBox())!;
  expect(list.y).toBeGreaterThanOrEqual(map.y + map.height - 1);
  await pinOf(page, "Veldt Studios").click();
  await expect(territoryRow(page, "Scotland").getByRole("button", { name: /Veldt Studios/ })).toHaveAttribute("aria-pressed", "true");
  // The map's own zoom buttons are on the screen.
  expect(await page.locator('[data-kit-part="map"] .maplibregl-ctrl-zoom-in').evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
  await expect(bubble(page)).toHaveAttribute("data-map-status", "ready");
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await picture(page, "zw-390-3-territory");
});

test("the map on a crew's Route at 390: the map and the stops fit, nothing scrolls sideways", async ({ as, stand }) => {
  test.skip(!stand.parts.includes("jobs"), "the Route comes with Jobs on site: stage 2 or 3");
  const page = await (await as("ada", PHONE)).newPage();
  await mapServer(page);
  await page.goto(`${STAFF}route/2026-08-05/2`);
  const route = page.getByTestId("jb-route");
  await expect(route.locator('[data-figure="distance"] [data-value]')).toHaveText("160.6 km");
  await expect(page.locator('[data-kit-part="map"] [data-widget="map-bubble"]')).toHaveAttribute("data-map-status", "ready", { timeout: 45_000 });
  await expect(page.locator('[data-kit-part="map"] [data-part="map-pin"]')).toHaveCount(2);
  expect((await page.locator('[data-kit-part="map"]').first().boundingBox())!.width).toBeLessThanOrEqual(390);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await expect(route.locator('[data-stop="depot"]')).toBeVisible();
  await picture(page, "zw-390-4-route");
});
