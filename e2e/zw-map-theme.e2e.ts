/**
 * THE MAP IN THE DARK THEME, and the theme switched while a map is open.
 *
 * A map is drawn from the map server's style for the theme: `/styles/dark` in
 * the dark, `/styles/positron` in the light (the map server is stood in for,
 * `territory-helpers.ts`, and every path asked of it is kept). On the CRM's
 * staff side the person switches the theme with the top bar's button, or the
 * device switches it; in the console the only map the CRM's pages draw is the
 * place field of a record's edit, and there the device's theme is switched
 * (the console's own "Dark mode" is in a menu the open dialog covers).
 *
 * Nothing is written: no figure another spec reads moves.
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { rows, STAFF, watch } from "./helpers.ts";
import { bubble, mapServer, openTerritory, pins, type MapServer } from "./territory-helpers.ts";

const styles = (server: MapServer): string[] => server.asked.filter((path) => path.startsWith("/styles/"));
const lastStyle = (server: MapServer): string | undefined => styles(server).at(-1);
const toggle = (page: Page) => page.getByRole("button", { name: /^Switch to the (dark|light) theme$/ });
const expected = (line: string): boolean => /Failed to load resource|net::ERR/.test(line);

test("Territory in the dark: the map takes the dark style, and the theme switched with the map open restyles it in place", async ({ as }) => {
  const page = await (await as("ivy", { colorScheme: "dark" })).newPage();
  const problems = watch(page);
  const server = await mapServer(page);
  await openTerritory(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(styles(server)).toEqual(["/styles/dark"]);
  await expect(pins(page)).toHaveCount(5);
  await picture(page, "zw-theme-1-territory-dark");

  // The top bar's button: light, with the map open. The map asks the light style and keeps its pins; nothing is reloaded.
  await page.evaluate(() => ((window as unknown as { zwKept: boolean }).zwKept = true));
  await toggle(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => lastStyle(server), { timeout: 20_000 }).toBe("/styles/positron");
  await expect(bubble(page)).toHaveAttribute("data-map-status", "ready");
  await expect(pins(page)).toHaveCount(5);
  await picture(page, "zw-theme-2-territory-switched-light");
  // And back to dark.
  await toggle(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => lastStyle(server), { timeout: 20_000 }).toBe("/styles/dark");
  await expect(pins(page)).toHaveCount(5);
  expect(await page.evaluate(() => (window as unknown as { zwKept?: boolean }).zwKept)).toBe(true);
  expect(problems.filter((line) => !expected(line))).toEqual([]);
});

test("Territory follows the device: light, then dark while the map is open", async ({ as }) => {
  const context = await as("ivy", { colorScheme: "light" });
  const page = await context.newPage();
  // A person who never pressed the button follows the device (nothing kept on this browser).
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("sales-crm-theme");
    } catch {
      // No storage: the device's preference stands anyway.
    }
  });
  const server = await mapServer(page);
  await openTerritory(page);
  expect(styles(server)).toEqual(["/styles/positron"]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => lastStyle(server), { timeout: 20_000 }).toBe("/styles/dark");
  await expect(pins(page)).toHaveCount(5);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => lastStyle(server), { timeout: 20_000 }).toBe("/styles/positron");
});

test("the crew's Route: the dark style, and the theme switched with the map open", async ({ as, stand }) => {
  test.skip(!stand.parts.includes("jobs"), "the Route comes with Jobs on site: stage 2 or 3");
  const page = await (await as("ada", { colorScheme: "dark" })).newPage();
  const server = await mapServer(page);
  await page.goto(`${STAFF}route/2026-08-05/2`);
  await expect(page.getByTestId("jb-route")).toBeVisible();
  await expect(page.locator('[data-kit-part="map"] [data-widget="map-bubble"]')).toHaveAttribute("data-map-status", "ready", { timeout: 45_000 });
  expect(styles(server)).toEqual(["/styles/dark"]);
  await toggle(page).click();
  await expect.poll(() => lastStyle(server), { timeout: 20_000 }).toBe("/styles/positron");
  await toggle(page).click();
  await expect.poll(() => lastStyle(server), { timeout: 20_000 }).toBe("/styles/dark");
  await picture(page, "zw-theme-3-route-dark");
});

test("the console: a record's place map in the dark, and the device switched to light and back while it is open", async ({ as, data }) => {
  const context = await as("owner", { colorScheme: "dark" });
  const [cobalt] = await rows<{ id: number }>(context.request, data, "companies", { column: "name", op: "eq", value: "Cobalt Legal" });
  const page = await context.newPage();
  const problems = watch(page);
  const server = await mapServer(page);
  await page.goto(`/p/crm-companies/r/${String(cobalt!.id)}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator('[data-part="page-record"]').getByRole("button", { name: "Edit", exact: true }).click();
  const map = page.getByRole("dialog").locator('[data-part="place-map"]');
  await expect(map.locator('[data-part="map-pin"]')).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => lastStyle(server)).toBe("/styles/dark");
  await picture(page, "zw-theme-4-console-place-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => lastStyle(server), { timeout: 20_000 }).toBe("/styles/positron");
  await expect(map.locator('[data-part="map-pin"]')).toHaveCount(1);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => lastStyle(server), { timeout: 20_000 }).toBe("/styles/dark");
  await page.keyboard.press("Escape");
  expect(problems.filter((line) => !expected(line))).toEqual([]);
});
