/**
 * P19, Showroom and samples, as READ: the front desk's home and the part's
 * five screens on the sample, at the ledger's Tuesday 28 July 2026 09:35,
 * each figure compared with what the server answers that person. Stage 2's
 * part: run with `CRM_STAND_STAGE=2` (stage 1's file holds no showroom).
 *
 * Nothing here writes: the specs that do are `showroom-bookings` and
 * `showroom-samples`, each taking away what it makes.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { inArabic, rows, STAFF, unfoldMenu, watch, type Data } from "./helpers.ts";

test.skip(Number(process.env.CRM_STAND_STAGE ?? "1") < 2, "the showroom arrives with stage 2: run with CRM_STAND_STAGE=2");

const chip = (page: Page, filter: string) => page.locator(`.crm-chip-btn[data-filter="${filter}"] .crm-chip-count`);
const stat = (page: Page, name: string) => page.locator(`.crm-sh-stat[data-stat="${name}"]`);
const live = { column: "state", op: "in", value: ["tentative", "confirmed"] };

async function serverCounts(person: APIRequestContext, data: Data): Promise<{ all: number; tentative: number; done: number; live: number }> {
  const all = await rows<{ state: string }>(person, data, "showroom_bookings");
  return { all: all.length, tentative: all.filter((one) => one.state === "tentative").length, done: all.filter((one) => one.state === "done").length, live: (await rows(person, data, "showroom_bookings", live)).length };
}

test("the front desk lands on her home: two coming in tomorrow, one sample late back, four enquiries nobody has", async ({ as }) => {
  const context = await as("corin");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await expect(page).toHaveURL(/\/staff\/home$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Front desk");
  await expect(stat(page, "soon").locator(".crm-sh-value")).toHaveText("2");
  await expect(stat(page, "soon").locator(".crm-sh-stat-note")).toHaveText("Nothing today · 2 tomorrow");
  await expect(stat(page, "late").locator(".crm-sh-value")).toHaveText("1");
  await expect(stat(page, "unclaimed").locator(".crm-sh-value")).toHaveText("4");
  // The two of tomorrow, in their order: Owen Marsh at ten on the Main floor, Ruth Adeyemi at two, not confirmed yet.
  const soon = page.locator('section[aria-labelledby="crm-sh-desk-soon"] li');
  await expect(soon).toHaveCount(2);
  await expect(soon.nth(0)).toContainText("Owen Marsh");
  await expect(soon.nth(0)).toContainText("Juno Analytics");
  await expect(soon.nth(0)).toContainText("Main floor · Analyst pod mock-up with the acoustic panels");
  await expect(soon.nth(0)).toContainText("Tomorrow, 10:00");
  await expect(soon.nth(1)).toContainText("Ruth Adeyemi");
  await expect(soon.nth(1)).toContainText("not confirmed yet");
  const late = page.locator('section[aria-labelledby="crm-sh-desk-late"] li');
  await expect(late).toHaveCount(1);
  await expect(late).toContainText("Acoustic panel set");
  await expect(late).toContainText("Low Orbit");
  await expect(late).toContainText("7 days late");
  await expect(page.locator('section[aria-labelledby="crm-sh-desk-inbox"] li')).toHaveCount(4);
  // Her menu: her home, the showroom's five, the Inbox.
  await unfoldMenu(page);
  const menu = page.getByRole("navigation", { name: "Menu" });
  for (const line of ["Home", "Showroom bookings", "Showroom follow-ups", "Sample library", "Sample returns chase", "Display stock", "Team inbox"]) await expect(menu.getByRole("link", { name: line, exact: true })).toBeVisible();
  await picture(page, "sh-1-corin-home");
  expect(problems).toEqual([]);
});

test("Showroom bookings: nine, six coming in, two to confirm, three been in; by space two, three and one; each the server's", async ({ as, data }) => {
  const context = await as("corin");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}home`);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Showroom bookings" }).click();
  await expect(page).toHaveURL(/\/staff\/showroom$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Showroom bookings");
  await expect(page.getByTestId("sh-note")).toHaveText("3 spaces · open 09:00 to 17:30");
  await expect(chip(page, "coming")).toHaveText("6");
  await expect(chip(page, "tentative")).toHaveText("2");
  await expect(chip(page, "done")).toHaveText("3");
  await expect(chip(page, "all")).toHaveText("9");
  await expect(page.locator(".crm-sh-space .crm-sh-space-count")).toHaveText(["2", "3", "1"]);
  await expect(page.locator(".crm-sh-space .crm-sh-space-name")).toHaveText(["Main floor", "Booth corner", "Meeting room"]);
  const server = await serverCounts(context.request, data);
  expect(server).toEqual({ all: 9, tentative: 2, done: 3, live: 6 });
  // Coming in, soonest first: tomorrow's two, then Thursday's and Friday's.
  await expect(page.locator(".crm-sh-card")).toHaveCount(6);
  const first = page.locator(".crm-sh-card").first();
  await expect(first.locator(".crm-sh-time .crm-mono").first()).toHaveText("10:00");
  await expect(first.locator(".crm-sh-name")).toHaveText("Juno Analytics");
  await expect(first.locator(".crm-sh-who")).toHaveText("Owen Marsh");
  await expect(first.locator(".crm-sh-see")).toHaveText("Analyst pod mock-up with the acoustic panels");
  await expect(first.getByTestId("sh-set")).toHaveText("Set out: Analyst pod, two-person");
  await expect(first.getByTestId("sh-state")).toHaveText("Confirmed");
  await expect(first.locator(".crm-sh-rep")).toHaveText(/Dana/);
  await expect(page.locator(".crm-sh-day-head > span:first-child").first()).toHaveText("Tomorrow");
  // Cobalt's Friday: three of them, the locker wall set out.
  const cobalt = page.locator(".crm-sh-card", { hasText: "Records-room lockers, finish choices" });
  await expect(cobalt.locator(".crm-sh-party")).toHaveText("3 people");
  await expect(cobalt.getByTestId("sh-set")).toHaveText("Set out: Locker wall, twelve doors");
  // To confirm: Brightloom and Veldt, each with "Confirm it".
  await page.locator('.crm-chip-btn[data-filter="tentative"]').click();
  await expect(page.locator(".crm-sh-card")).toHaveCount(2);
  await expect(page.locator('.crm-sh-card [data-act="confirm"]')).toHaveCount(2);
  // Been in: newest first, no buttons.
  await page.locator('.crm-chip-btn[data-filter="done"]').click();
  await expect(page.locator(".crm-sh-card")).toHaveCount(3);
  await expect(page.locator(".crm-sh-card .crm-sh-name")).toHaveText(["Nordwind Logistics", "Harbor & Finch", "Tandem Robotics"]);
  await expect(page.locator(".crm-sh-card .crm-sh-actions")).toHaveCount(0);
  await picture(page, "sh-2-bookings-been");
  expect(problems).toEqual([]);
});

test("Showroom follow-ups: three been in, two written up, one next step past its day; the deal for who reads deals", async ({ as, data }) => {
  for (const person of ["corin", "tessa"]) {
    const context = await as(person);
    const page = await context.newPage();
    await page.goto(`${STAFF}showroom-follow-ups`);
    await expect(page.getByRole("heading", { level: 1 }), person).toHaveText("Showroom follow-ups");
    await expect(stat(page, "been").locator(".crm-sh-value"), person).toHaveText("3");
    await expect(stat(page, "written").locator(".crm-sh-value"), person).toHaveText("2 of 3");
    await expect(stat(page, "late").locator(".crm-sh-value"), person).toHaveText("1");
    await expect(page.getByTestId("sh-fu-missing"), person).toHaveText("Harbor & Finch came in and nobody wrote it up. Do it while you remember it.");
    const nordwind = page.locator(".crm-sh-card", { hasText: "Nordwind Logistics" });
    await expect(nordwind.locator(".crm-sh-see")).toContainText("Petra liked the standing-desk swap");
    await expect(nordwind.getByTestId("sh-fu-step")).toHaveText("past the date");
    await expect(page.locator(".crm-sh-card", { hasText: "Tandem Robotics" }).getByTestId("sh-fu-step")).toHaveText("by Thu, Jul 30");
    const done = (await rows<{ outcome: string | null; next_step_by: string | null; next_step_done_on: string | null }>(context.request, data, "showroom_bookings", { column: "state", op: "eq", value: "done" }));
    expect([done.length, done.filter((one) => one.outcome !== null).length, done.filter((one) => one.next_step_by !== null && one.next_step_by < "2026-07-28" && one.next_step_done_on === null).length]).toEqual([3, 2, 1]);
    // The deal a visit was for: the CRM admin reads deals and opens it; the front desk reads none, and is shown none.
    if (person === "tessa") await expect(nordwind.locator(".crm-sh-deal")).toContainText("Fourth-floor desk rows");
    else await expect(page.locator(".crm-sh-deal")).toHaveCount(0);
    await picture(page, `sh-3-follow-ups-${person}`);
    await page.close();
  }
});

test("Sample library and returns: 22 held, 4 out, 18 on the shelf; 4 pieces across 3 accounts, 1 late, 21 days away, 3 chases", async ({ as, data }) => {
  const context = await as("corin");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}samples`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sample library");
  await expect(page.getByTestId("sh-lib-line")).toHaveText("22 pieces held: 4 out, 18 on the shelf. 1 is late back. Chase it before someone else needs it.");
  await expect(chip(page, "all")).toHaveText("8");
  await expect(chip(page, "in")).toHaveText("4");
  await expect(chip(page, "out")).toHaveText("4");
  await expect(chip(page, "late")).toHaveText("1");
  const panels = page.locator(".crm-sh-sample", { hasText: "Acoustic panel set" });
  await expect(panels.locator(".crm-pill")).toHaveText("Late");
  await expect(panels.locator(".crm-sh-loan-due")).toHaveText("7 days late");
  await expect(panels.locator('[data-act="lend"]')).toBeDisabled();
  const samples = await rows<{ held: number; out: number; on_shelf: number }>(context.request, data, "samples");
  expect([samples.reduce((n, one) => n + Number(one.held), 0), samples.reduce((n, one) => n + Number(one.out), 0), samples.reduce((n, one) => n + Number(one.on_shelf), 0)]).toEqual([22, 4, 18]);
  await picture(page, "sh-4-library");

  await page.getByRole("link", { name: "Sample returns chase" }).first().click();
  await expect(page).toHaveURL(/\/staff\/sample-returns$/);
  await expect(stat(page, "out").locator(".crm-sh-value")).toHaveText("4");
  await expect(stat(page, "out").locator(".crm-sh-stat-note")).toHaveText("pieces across 3 accounts");
  await expect(stat(page, "late").locator(".crm-sh-value")).toHaveText("1");
  await expect(stat(page, "longest").locator(".crm-sh-value")).toHaveText("21 days");
  await expect(stat(page, "longest").locator(".crm-sh-stat-note")).toHaveText("Low Orbit · 3 chases logged");
  // Longest away first: the panels, out on 7 July, chased twice by the front desk.
  const first = page.locator(".crm-sh-card").first();
  await expect(first.locator(".crm-sh-name")).toHaveText("Acoustic panel set");
  await expect(first.getByTestId("sh-ret-state")).toHaveText("7 days late");
  await expect(first.locator(".crm-sh-chases li")).toHaveCount(2);
  await expect(first.locator(".crm-sh-chases li").first()).toContainText("Chased by Corin");
  await picture(page, "sh-5-returns");
  expect(problems).toEqual([]);
});

test("Display stock: eight on the floor, two to swap out, one on loan back Sat, Aug 8; by space four, two, three", async ({ as }) => {
  const page = await (await as("corin")).newPage();
  await page.goto(`${STAFF}display-stock`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Showroom stock");
  await expect(stat(page, "floor").locator(".crm-sh-value")).toHaveText("8");
  await expect(stat(page, "floor").locator(".crm-sh-stat-note")).toHaveText("9 pieces across 3 spaces · promised to a booking 6");
  await expect(stat(page, "tired").locator(".crm-sh-value")).toHaveText("2");
  await expect(stat(page, "lent").locator(".crm-sh-value")).toHaveText("1");
  await expect(stat(page, "lent").locator(".crm-sh-stat-note")).toHaveText("back Sat, Aug 8");
  await expect(page.locator(".crm-chip-btn .crm-chip-count")).toHaveText(["9", "4", "2", "3"]);
  // The tired two first: the old sit-stand frame and the meeting table, eleven months each.
  await expect(page.locator(".crm-sh-card .crm-sh-name").nth(0)).toHaveText("Sit-stand frame, single");
  await expect(page.locator(".crm-sh-card").nth(0).locator(".crm-sh-age")).toHaveText("11 months out");
  await expect(page.locator(".crm-sh-card .crm-sh-name").nth(1)).toHaveText("Meeting table, welded frame");
  await expect(page.locator('.crm-sh-card [data-act="swap"]')).toHaveCount(2);
  await expect(page.locator(".crm-sh-card", { hasText: "Analyst pod, two-person" }).locator(".crm-sh-wanted")).toHaveText("Wanted for Juno Analytics, Wed, Jul 29");
  await page.locator('.crm-chip-btn[data-space]').nth(3).click();
  await expect(page.locator(".crm-sh-card")).toHaveCount(3);
  await picture(page, "sh-6-floor");
});

test("Read-only reads all five and her figures, with nothing to press; the CRM admin and the owner read them too", async ({ as }) => {
  const page = await (await as("grace")).newPage();
  await page.goto(`${STAFF}showroom`);
  await expect(chip(page, "all")).toHaveText("9");
  await expect(page.getByTestId("sh-book")).toHaveCount(0);
  await expect(page.locator(".crm-sh-actions")).toHaveCount(0);
  await page.goto(`${STAFF}samples`);
  await expect(page.getByTestId("sh-lib-line")).toContainText("22 pieces held");
  await expect(page.locator('[data-act="lend"], [data-act="back"]')).toHaveCount(0);
  await page.goto(`${STAFF}sample-returns`);
  await expect(page.locator('[data-act="chase"]')).toHaveCount(0);
  await page.goto(`${STAFF}display-stock`);
  await expect(page.locator('[data-act="swap"]')).toHaveCount(0);
  await page.goto(`${STAFF}showroom-follow-ups`);
  await expect(page.locator('[data-act="write"]')).toHaveCount(0);
  for (const person of ["tessa", "owner"]) {
    const other = await (await as(person)).newPage();
    await other.goto(`${STAFF}showroom`);
    await expect(chip(other, "coming"), person).toHaveText("6");
    await unfoldMenu(other);
    await expect(other.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Display stock" }), person).toBeVisible();
    await other.close();
  }
});

test("a role the showroom is not for is told it is not part of their role, and the server refuses its reads", async ({ as, api, data }) => {
  for (const person of ["dana", "lena", "ada", "hugo"]) {
    const page = await (await as(person)).newPage();
    await page.goto(`${STAFF}showroom`);
    await expect(page.getByRole("heading", { level: 1 }), person).not.toHaveText("Showroom bookings");
    await page.close();
  }
  for (const person of ["lena", "ada", "hugo"]) {
    const request = await api(person);
    for (const ref of ["showroom_bookings", "samples", "sample_loans", "display_pieces"]) expect([person, ref, (await request.get(data(ref, "?limit=1"))).status()]).toEqual([person, ref, 403]);
  }
});

test("the showroom at 390 wide in the dark, and in Arabic right to left", async ({ as }) => {
  const context = await as("corin", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const page = await context.newPage();
  for (const path of ["home", "showroom", "showroom-follow-ups", "samples", "sample-returns", "display-stock"]) {
    await page.goto(`${STAFF}${path}`);
    await expect(page.locator(".crm-sh").first()).toBeVisible();
    await expect(page.locator(".crm-skeleton")).toHaveCount(0);
    expect([path, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)]).toEqual([path, true]);
  }
  await page.goto(`${STAFF}showroom`);
  await page.getByTestId("sh-book").click();
  const dialog = page.getByRole("dialog", { name: "Book the showroom" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((box) => box.scrollWidth <= box.clientWidth + 1 && box.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
  await picture(page, "sh-7-booking-390-dark");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("sh-book")).toBeFocused();

  await inArabic(context.request, async () => {
    await page.goto(`${STAFF}showroom`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("حجوزات صالة العرض");
    // Arabic writes its own digits.
    await expect(chip(page, "all")).toHaveText("٩");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await picture(page, "sh-8-bookings-arabic");
    await page.goto(`${STAFF}samples`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مكتبة العينات");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
