/**
 * Walk "Deliveries by keyboard alone, and by touch at 390 wide" (P24), the
 * script's half: at 390 wide the week's days scroll inside their own strip
 * (the page does not), and the keyboard alone reaches it: Tab comes to the
 * strip, its focus ring is drawn (the computed outline, not a guess), and the
 * arrow keys scroll it to the week's last day and back. In Arabic the strip
 * runs right to left and the arrows scroll it the same way.
 *
 * The drag of a visit onto a day by a finger stays the owner's (a real
 * phone): the screen's drag is the browser's own drag and drop, which an
 * emulated touch does not start.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { inArabic, STAFF, watch } from "./helpers.ts";

test.skip(({ stand }) => !stand.parts.includes("jobs"), "Jobs on site arrives with stage 2: run with CRM_STAND_STAGE=2 or 3");

/** Tab from the top of the page until the week's strip has the focus; answers how many presses it took (null: never). */
async function tabToStrip(page: Page): Promise<number | null> {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let presses = 1; presses <= 80; presses += 1) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "jb-week-days")) return presses;
  }
  return null;
}

const scroll = (page: Page) => page.getByTestId("jb-week-days").evaluate((strip) => ({ at: strip.scrollLeft, max: strip.scrollWidth - strip.clientWidth }));

test("at 390 wide, by keyboard alone: Tab reaches the week's strip, its focus ring shows, the arrows scroll it to the last day and back; in Arabic too", async ({ as, api }) => {
  const ada = await api("ada");
  const context = await as("ada", { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const problems = watch(page);
  const walk = async (rtl: boolean): Promise<void> => {
    await page.goto(`${STAFF}deliveries/2026-07-27`);
    const strip = page.getByTestId("jb-week-days");
    await expect(strip.locator("section")).toHaveCount(5);
    // The days scroll inside the strip; the page itself is not wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const start = await scroll(page);
    expect(Math.abs(start.at)).toBe(0);
    expect(start.max, "the week is wider than the screen at 390").toBeGreaterThan(200);
    const presses = await tabToStrip(page);
    expect(presses, "Tab reaches the strip").not.toBeNull();
    await expect(strip).toBeFocused();
    console.info(`[zw-deliveries] ${rtl ? "Arabic" : "English"}: the strip after ${String(presses)} presses of Tab`);
    // The ring: a visible outline, from :focus-visible.
    const ring = await strip.evaluate((el) => ({ visible: el.matches(":focus-visible"), style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth, color: getComputedStyle(el).outlineColor, offset: getComputedStyle(el).outlineOffset }));
    expect(ring.visible).toBe(true);
    expect(ring.style).toBe("solid");
    expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
    expect(ring.color).not.toMatch(/rgba\(.*, 0\)|transparent/);
    // The arrows scroll it: on to the last day, then back to the first.
    const onward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    await page.keyboard.press(onward);
    await expect.poll(async () => Math.abs((await scroll(page)).at)).toBeGreaterThan(0);
    for (let i = 0; i < 40 && Math.abs((await scroll(page)).at) < start.max - 1; i += 1) {
      const was = (await scroll(page)).at;
      await page.keyboard.press(onward);
      // A key's scroll runs a moment: wait for it to stop before reading where it is.
      await expect.poll(async () => (await scroll(page)).at, { timeout: 2000 }).not.toBe(was).catch(() => undefined);
    }
    await expect.poll(async () => Math.abs((await scroll(page)).at)).toBeGreaterThanOrEqual(start.max - 1);
    // The week's last day is in view inside the strip.
    const last = await strip.locator("section").last().boundingBox();
    expect(last!.x).toBeGreaterThanOrEqual(-1);
    expect(last!.x + last!.width).toBeLessThanOrEqual(391);
    for (let i = 0; i < 40 && Math.abs((await scroll(page)).at) > 0; i += 1) {
      const was = (await scroll(page)).at;
      await page.keyboard.press(back);
      // A key's scroll runs a moment: wait for it to stop before reading where it is.
      await expect.poll(async () => (await scroll(page)).at, { timeout: 2000 }).not.toBe(was).catch(() => undefined);
    }
    // Back at the week's first day, in view inside the strip (the browser may stop a few pixels short of the edge).
    await expect.poll(async () => Math.abs((await scroll(page)).at)).toBeLessThanOrEqual(8);
    const firstDay = await strip.locator("section").first().boundingBox();
    expect(firstDay!.x).toBeGreaterThanOrEqual(-1);
    expect(firstDay!.x + firstDay!.width).toBeLessThanOrEqual(391);
    await expect(strip).toBeFocused();
  };
  await walk(false);
  await inArabic(ada, async () => {
    await walk(true);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
  expect(problems).toEqual([]);
});
