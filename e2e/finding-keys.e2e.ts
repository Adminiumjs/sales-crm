/**
 * P08, the keyboard shortcuts and their dialog.
 *
 * The dialog lists only the keys that work for the person (a screen in their
 * own menu, a deal they may start or change); each listed key works; none
 * fires while a field, a dialog's field or Adminium's mention box has the
 * focus, or while a dialog is open. The dialog holds the focus and gives it
 * back. Nothing here writes.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { inArabic, rows, STAFF, watch } from "./helpers.ts";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });
/** The dialog's rows as "label: keys". */
const listed = async (scope: Locator): Promise<string[]> =>
  scope.locator(".crm-keys-row").evaluateAll((all) => all.map((row) => `${row.querySelector("dt")?.textContent ?? ""}: ${Array.from(row.querySelectorAll("dd > *")).map((one) => one.textContent).join(" ")}`));
/** The key Jump is opened with where the browser runs: ⌘ on a Mac, Ctrl elsewhere. */
const modOf = (page: Page): Promise<string> => page.evaluate(() => (/mac|iphone|ipad/i.test(`${navigator.platform} ${navigator.userAgent}`) ? "⌘" : "Ctrl"));
const url = (page: Page, path: string) => expect(page).toHaveURL(new RegExp(`${STAFF}${path}$`));

test("Dana: the list is hers, every key on it works, and none fires while she types", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}today`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.keyboard.press("?");
  await expect(dialog(page)).toBeVisible();
  const rows_ = await listed(dialog(page));
  expect(rows_).toEqual([
    "Today: 1",
    "Pipeline board: 2",
    "Companies: 3",
    "Contacts: 4",
    "This week: G then W",
    "Closed: G then C",
    "Team inbox: G then I",
    "Messages: G then M",
    `Jump to a screen: ${await modOf(page)} K`,
    "Search: /",
    "Start a deal: N",
    "Switch the theme: D",
    "This list: ?",
    "Close what is open: Esc",
    "Edit the amount: E",
    "Open the comments: C",
  ]);
  // The row of the screen she is on is lit.
  await expect(dialog(page).locator('.crm-keys-row[data-here="1"]')).toHaveText(/Today/);
  // It holds the focus: Tab goes round inside it.
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-labelledby") !== undefined)).toBe(true);
  }
  // A key pressed while it is open does nothing but what the dialog does.
  await page.keyboard.press("2");
  await url(page, "today");
  await picture(page, "keys-1-dana");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  // Each key, as listed.
  await page.keyboard.press("2");
  await url(page, "pipeline");
  await page.keyboard.press("g");
  await page.keyboard.press("w");
  await url(page, "week");
  await page.keyboard.press("3");
  await url(page, "companies");
  await page.keyboard.press("4");
  await url(page, "contacts");
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await url(page, "closed");
  await page.keyboard.press("1");
  await url(page, "today");
  // Not hers: G T (the Team view) and G F (the feed) go nowhere.
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await url(page, "today");
  // D switches the theme, and back.
  const theme = await page.locator("html").getAttribute("data-theme");
  await page.keyboard.press("d");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme ?? "");
  await page.keyboard.press("d");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme ?? "");

  // In the deal room: E opens the amount where it may be typed, C goes to the comments.
  const typed = (await rows<{ id: number; name: string }>(context.request, data, "deals", { and: [{ column: "state", op: "eq", value: "open" }, { column: "quoted_amount", op: "is_null" }] }, "&order=id"))[0]!;
  await page.goto(`${STAFF}deals/${String(typed.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(typed.name);
  await page.keyboard.press("e");
  const amount = page.getByRole("textbox", { name: "Amount" });
  await expect(amount).toBeFocused();
  // While the field has the focus, every key is the field's: nothing moves.
  await page.keyboard.press("2");
  await page.keyboard.press("?");
  await url(page, `deals/${String(typed.id)}`);
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(amount).toHaveCount(0);
  // The composer's text box is a field too.
  const composer = page.getByRole("textbox", { name: "What happened" });
  await composer.click();
  await page.keyboard.type("g w 2 ? / c");
  await expect(composer).toHaveValue("g w 2 ? / c");
  await url(page, `deals/${String(typed.id)}`);
  await composer.fill("");
  await composer.blur();
  await page.keyboard.press("c");
  await url(page, `deals/${String(typed.id)}/comments`);
  // Adminium's mention box: `?` and `/` are letters there.
  const box = page.locator('[data-box="new"]').getByRole("combobox");
  await box.click();
  await page.keyboard.type("? / 2");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Jump" })).toHaveCount(0);
  await url(page, `deals/${String(typed.id)}/comments`);
  await box.fill("");

  // A dialog's field: the new-deal sheet (N) has the keyboard; `2` is typed, not followed.
  await page.goto(`${STAFF}today`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("n");
  const sheet = page.getByRole("dialog", { name: "Start a deal" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("2");
  await page.keyboard.press("?");
  await url(page, "today");
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // From the menu under her name; closing gives the focus back to her name.
  const chip = page.getByRole("button", { name: "Your menu" });
  await chip.click();
  await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chip).toBeFocused();
  expect(problems).toEqual([]);
});

test("the marketer: only the keys of her screens; the others do nothing", async ({ as }) => {
  const context = await as("lena");
  const page = await context.newPage();
  await page.goto(`${STAFF}home`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("?");
  expect(await listed(dialog(page))).toEqual(["Home: 1", "Companies: 3", "Contacts: 4", `Jump to a screen: ${await modOf(page)} K`, "Search: /", "Switch the theme: D", "This list: ?", "Close what is open: Esc"]);
  await page.keyboard.press("Escape");
  for (const key of ["2", "n"]) await page.keyboard.press(key);
  await page.keyboard.press("g");
  await page.keyboard.press("w");
  await url(page, "home");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("3");
  await url(page, "companies");
  await page.keyboard.press("1");
  await url(page, "home");
});

test("the sales manager: her home is the Team view, and G T, G F are hers", async ({ as }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  await page.goto(`${STAFF}pipeline`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("?");
  const all = await listed(dialog(page));
  expect(all.slice(0, 2)).toEqual(["Team view: 1", "Team board: 2"]);
  expect(all).toContain("Activity feed: G then F");
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await url(page, "activity");
  await page.keyboard.press("1");
  await url(page, "team");
});

test("the dialog in Arabic, 390 wide, dark: right to left, one column, no sideways scroll", async ({ as, api }) => {
  const context = await as("dana", { viewport: { width: 390, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  await inArabic(await api("dana"), async () => {
    await page.goto(`${STAFF}today`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.keyboard.press("?");
    const box = page.getByRole("dialog", { name: "اختصارات لوحة المفاتيح" });
    await expect(box).toBeVisible();
    await expect(box.getByRole("heading", { name: "التنقّل" })).toBeVisible();
    await expect(box.locator(".crm-keys-row").first()).toContainText("اليوم");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await picture(page, "keys-2-arabic-390-dark");
    await page.keyboard.press("Escape");
  });
});
