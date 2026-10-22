/**
 * P08, Jump: the palette over every screen, by keyboard alone.
 *
 * It lists the screens of the person's own menu and nothing else, and the
 * deals, companies, people and quotes the SERVER answers that person by what
 * is typed. Every hit is compared with what the server answers the same person
 * directly, and every hit opens the app's own screen for it.
 *
 * Nothing here writes: the sample's figures are left as they were.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { rows, STAFF, watch, type Data } from "./helpers.ts";

const palette = (page: Page) => page.getByRole("dialog", { name: "Jump" });
const field = (page: Page) => palette(page).getByRole("combobox");
const options = (page: Page) => palette(page).getByRole("option");
const group = (page: Page, name: string) => palette(page).getByRole("group", { name, exact: true });
const me = async (person: APIRequestContext): Promise<string> => ((await (await person.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;

/** What the server answers this person for a name, as Jump asks it. */
const named = async (person: APIRequestContext, data: Data, ref: string, typed: string, column = "name"): Promise<string[]> =>
  (await rows<Record<string, unknown>>(person, data, ref, { column, op: "ilike", value: `%${typed}%` })).map((row) => String(row[column]));

/** Wait for a round of records to have landed: the foot no longer says it is looking. */
async function settled(page: Page): Promise<void> {
  await expect(palette(page).getByTestId("jump-count")).not.toHaveText("Looking…");
}

/** Type into the palette's field as a person would, a key at a time. */
async function typeIn(page: Page, text: string): Promise<void> {
  await field(page).fill("");
  await page.keyboard.type(text, { delay: 25 });
  await settled(page);
}

/** The option the field names as picked, and that it is the one marked selected: what a screen reader is told. */
async function picked(page: Page): Promise<string> {
  const active = await field(page).getAttribute("aria-activedescendant");
  expect(active, "the field names the picked line").not.toBeNull();
  const option = palette(page).locator(`[id="${active!}"]`);
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(options(page).and(page.locator('[aria-selected="true"]'))).toHaveCount(1);
  return (await option.innerText()).replace(/\s+/g, " ").trim();
}

test("Dana, by keyboard alone: her own screens, her deals, every company, a person, a quote; each opens its screen", async ({ as, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}today`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Ctrl+K opens it, the focus is in its field, and the screens it lists are her menu's.
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(group(page, "Go to").getByRole("option")).toHaveText([/^Today/, /^This week/, /^Site visits/, /^Notifications/, /^Weekly digest/, /^Pipeline board/, /^Saved views/, /^Saved searches/]);
  await expect(group(page, "Go to").getByRole("option").first()).toContainText("here");
  await expect(palette(page).getByTestId("jump-count")).toHaveText(/^\d+ matches$/);
  // A screen her role does not hold is never offered, whatever she types.
  await typeIn(page, "team");
  await expect(group(page, "Go to").getByRole("option")).toHaveText([/^Team inbox/]);
  await expect(options(page).filter({ hasText: "Team view" })).toHaveCount(0);
  await typeIn(page, "approv");
  await expect(palette(page).getByTestId("jump-empty")).toBeVisible();
  await expect(palette(page).getByTestId("jump-empty")).toContainText("Nothing matches that");

  // Arrows pick, Enter opens: the board.
  await typeIn(page, "pipe");
  expect(await picked(page)).toBe("Pipeline board");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${STAFF}pipeline$`));

  // `/` opens it too. "desk": her deal, with the server's figure; the lines are exactly the rows the server answers her.
  await page.keyboard.press("/");
  await expect(field(page)).toBeFocused();
  await typeIn(page, "desk");
  const deals = group(page, "Deals").getByRole("option");
  expect(await named(dana, data, "deals", "desk")).toEqual(["Fourth-floor desk rows"]);
  await expect(deals).toHaveCount(1);
  await expect(deals.first()).toContainText("Fourth-floor desk rows");
  await expect(deals.first()).toContainText("Nordwind Logistics · Negotiation");
  await expect(deals.first()).toContainText("£52,800");
  const total = await options(page).count();
  await expect(palette(page).getByTestId("jump-count")).toHaveText(`${String(total)} ${total === 1 ? "match" : "matches"}`);
  // Down to the deal, and open it: its room.
  for (let at = 0; at < total && !(await picked(page)).startsWith("Fourth-floor desk rows"); at += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const d1 = (await rows<{ id: number }>(dana, data, "deals", { column: "name", op: "eq", value: "Fourth-floor desk rows" }))[0]!;
  await expect(page).toHaveURL(new RegExp(`${STAFF}deals/${String(d1.id)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fourth-floor desk rows");

  // A colleague's deal, typed in full: Leo's. Nothing, as the server answers her nothing; Ivy is answered it.
  await page.keyboard.press("Control+k");
  await typeIn(page, "Depot supervisor stations");
  expect(await named(dana, data, "deals", "Depot supervisor stations")).toEqual([]);
  await expect(group(page, "Deals")).toHaveCount(0);
  await expect(palette(page).getByTestId("jump-empty")).toBeVisible();
  // Every company is hers to read: Nordwind, with Leo's deal at it or not.
  await typeIn(page, "nordwind");
  expect(await named(dana, data, "companies", "nordwind")).toEqual(["Nordwind Logistics"]);
  await expect(group(page, "Companies").getByRole("option")).toHaveText([/Nordwind Logistics/]);
  while (!(await picked(page)).startsWith("Nordwind Logistics")) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const nordwind = (await rows<{ id: number }>(dana, data, "companies", { column: "name", op: "eq", value: "Nordwind Logistics" }))[0]!;
  await expect(page).toHaveURL(new RegExp(`${STAFF}companies/${String(nordwind.id)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nordwind Logistics");

  // A person: her record sheet, on Contacts.
  await page.keyboard.press("Control+k");
  await typeIn(page, "petra");
  await expect(group(page, "People").getByRole("option")).toHaveText([/Petra Lindqvist/]);
  while (!(await picked(page)).startsWith("Petra Lindqvist")) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const petra = (await rows<{ id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Petra Lindqvist" }))[0]!;
  await expect(page).toHaveURL(new RegExp(`${STAFF}contacts/${String(petra.id)}$`));
  await expect(page.getByRole("dialog", { name: "Petra Lindqvist" })).toBeVisible();
  await page.keyboard.press("Escape");

  // A quote, by its number: every version the server answers her, the newest first.
  await page.keyboard.press("Control+k");
  await typeIn(page, "Q-1002");
  const versions = await rows<{ id: number; version: number }>(dana, data, "quotes", { or: [{ column: "family_no", op: "ilike", value: "%Q-1002%" }, { column: "number", op: "ilike", value: "%Q-1002%" }] }, "&order=family_no,version.desc");
  await expect(group(page, "Quotes").getByRole("option")).toHaveText(versions.map((one) => new RegExp(`Q-1002 · version ${String(one.version)}`)));
  while (!(await picked(page)).startsWith("Q-1002 · version 2")) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${STAFF}quotes/${String(versions.find((one) => one.version === 2)!.id)}$`));
  await picture(page, "jump-1-dana-quote");

  // Opened from the top bar's button, Escape gives the focus back to it.
  const button = page.getByRole("button", { name: /^Jump/ });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(field(page)).toBeFocused();
  // Tab stays in the box.
  await page.keyboard.press("Tab");
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  // The top bar's search box opens the same palette with what is typed in it.
  await page.getByRole("textbox", { name: "Search deals, companies, people" }).focus();
  await page.keyboard.type("n");
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveValue("n");
  await page.keyboard.type("ordw");
  await settled(page);
  await expect(group(page, "Companies").getByRole("option")).toHaveText([/Nordwind Logistics/]);
  await page.keyboard.press("Escape");
  expect(problems).toEqual([]);
});

test("Jump's requests: a pause before asking, a word asked once, four tables a round at most", async ({ as }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}today`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const asked: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/v1\/data\//.test(request.url()) && /ilike/.test(decodeURIComponent(request.url()))) asked.push(request.url());
  });
  await page.keyboard.press("Control+k");
  // Typed at a steady pace, a whole name: one round of four reads once she stops.
  await page.keyboard.type("nordwind", { delay: 60 });
  await settled(page);
  await expect(group(page, "Companies").getByRole("option")).toHaveText([/Nordwind Logistics/]);
  expect(asked.length).toBe(4);
  // Back to a word already asked: nothing is asked again.
  await page.keyboard.press("Backspace");
  await page.keyboard.type("d");
  await settled(page);
  await page.waitForTimeout(1500);
  expect(asked.length).toBe(4);
  // Nothing typed, or one letter: nothing is asked.
  await field(page).fill("");
  await page.keyboard.type("x");
  await page.waitForTimeout(1500);
  expect(asked.length).toBe(4);
});

test("the marketer: her screens, companies and people, no deal by any spelling; the server refuses her deals", async ({ as, data }) => {
  const context = await as("lena");
  const lena = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}home`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(group(page, "Go to").getByRole("option")).toHaveText([/^Home/, /^Trade show leads/, /^Companies/, /^Contacts/, /^My profile/, /^My details/, /^Notifications/]);
  // No "Start a deal" for her.
  await expect(group(page, "Actions").getByRole("option")).not.toContainText(["Start a deal"]);
  for (const typed of ["Fourth-floor desk rows", "desk", "Depot", "Q-1002"]) {
    await typeIn(page, typed);
    await expect(group(page, "Deals")).toHaveCount(0);
    await expect(group(page, "Quotes")).toHaveCount(0);
  }
  // Not a missing line only: the server refuses her the table.
  expect((await lena.get(data("deals", `?limit=1&where=${encodeURIComponent(JSON.stringify({ column: "name", op: "ilike", value: "%desk%" }))}`))).status()).toBe(403);
  expect((await lena.get(data("quotes", "?limit=1"))).status()).toBe(403);
  await typeIn(page, "nordwind");
  expect(await named(lena, data, "companies", "nordwind")).toEqual(["Nordwind Logistics"]);
  await expect(group(page, "Companies").getByRole("option")).toHaveText([/Nordwind Logistics/]);
  await typeIn(page, "petra");
  await expect(group(page, "People").getByRole("option")).toHaveText([/Petra Lindqvist/]);
  while (!(await picked(page)).startsWith("Petra Lindqvist")) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/contacts\/\d+$/);
  await expect(page.getByRole("dialog", { name: "Petra Lindqvist" })).toBeVisible();
  await picture(page, "jump-2-marketer");
  expect(problems).toEqual([]);
});

test("Read-only: every deal her role reads, her own menu's screens, nothing to start", async ({ as, data }) => {
  const context = await as("grace");
  const grace = context.request;
  const page = await context.newPage();
  await page.goto(`${STAFF}team`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(group(page, "Actions").getByRole("option")).not.toContainText(["Start a deal"]);
  await typeIn(page, "view");
  await expect(group(page, "Go to").getByRole("option")).toHaveText([/^Team view/, /^Saved views/]);
  // Leo's deal, which Dana cannot find: Read-only reads every deal.
  await typeIn(page, "Depot supervisor");
  expect(await named(grace, data, "deals", "Depot supervisor")).toEqual(["Depot supervisor stations"]);
  await expect(group(page, "Deals").getByRole("option")).toHaveText([/Depot supervisor stations/]);
  await typeIn(page, "Q-100");
  const quotes = await rows<{ id: number }>(grace, data, "quotes", { or: [{ column: "family_no", op: "ilike", value: "%Q-100%" }, { column: "number", op: "ilike", value: "%Q-100%" }] });
  await expect(group(page, "Quotes").getByRole("option")).toHaveCount(Math.min(5, quotes.length));
  await page.keyboard.press("Escape");
});

test("in a deal's room Jump also edits the amount and closes the deal, only where the room's own buttons would (S4)", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  // A deal of Dana's whose amount is typed, not a quote's: the room's own amount field is hers to open.
  const typed = (await rows<{ id: number; name: string }>(context.request, data, "deals", { and: [{ column: "state", op: "eq", value: "open" }, { column: "quoted_amount", op: "is_null" }, { column: "owner_id", op: "eq", value: await me(context.request) }] }))[0]!;
  await page.goto(`${STAFF}deals/${String(typed.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(typed.name);
  await page.keyboard.press("Control+k");
  await expect(group(page, "Actions").getByRole("option")).toContainText(["Edit the amount", "Close this deal…"]);
  // Close this deal…: the board's own dialog, for this deal.
  await group(page, "Actions").getByRole("option", { name: /Close this deal/ }).click();
  await expect(page.getByRole("dialog", { name: "Close this deal" })).toContainText(typed.name);
  await page.keyboard.press("Escape");
  // Edit the amount: the room's own field opens.
  await page.keyboard.press("Control+k");
  await group(page, "Actions").getByRole("option", { name: /Edit the amount/ }).click();
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toBeFocused();
  expect(problems).toEqual([]);
  // Read-only opens the same room and is offered neither.
  const graces = await (await as("grace")).newPage();
  await graces.goto(`${STAFF}deals/${String(typed.id)}`);
  await expect(graces.getByRole("heading", { level: 1 })).toHaveText(typed.name);
  await graces.keyboard.press("Control+k");
  await expect(group(graces, "Actions").getByRole("option")).not.toContainText(["Edit the amount", "Close this deal…"]);
});

test("390 wide, dark, and in Arabic: the palette fits and reads right to left", async ({ as, api }) => {
  const context = await as("dana", { viewport: { width: 390, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  const { inArabic } = await import("./helpers.ts");
  await inArabic(await api("dana"), async () => {
    await page.goto(`${STAFF}today`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("textbox", { name: "ابحث في الصفقات والشركات والأشخاص" }).click();
    const dialog = page.getByRole("dialog", { name: "انتقال" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("Nordwind", { delay: 25 });
    await expect(dialog.getByRole("group", { name: "الشركات" }).getByRole("option")).toHaveText([/Nordwind Logistics/]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await picture(page, "jump-3-arabic-390-dark");
    await page.keyboard.press("Escape");
  });
});
