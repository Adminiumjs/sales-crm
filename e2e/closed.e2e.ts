/**
 * P02, Closed (ledger §8): one list of 26 closed deals, 8 won for 130,000 and
 * 18 lost for 294,400; in 2026, 5 for 81,600 and 12 for 188,600.
 *
 * Reached from the menu as a rep (her own), the sales manager, the CRM admin
 * and Read-only (the team's), and as the account manager, for whom it is
 * "Won deals". Refused to the marketer, by the server.
 */
import { expect, picture, test } from "./fixtures.ts";
import { inArabic, rows, STAFF, watch, unfoldMenu } from "./helpers.ts";

const stat = (page: import("@playwright/test").Page, label: string) => page.locator(".crm-stat").filter({ has: page.locator(".crm-stat-label", { hasText: new RegExp(`^${label}$`) }) });

test("Dana opens Closed from her menu: her own eight, the newest first", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Closed" }).click();
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/closed$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Closed");
  // Her own: 3 won for 45,800 (2 · 28,400 this year), 5 lost for 43,300 (3 · 19,400); 38 % (3 of 8); 46 days on average.
  await expect(stat(page, "Won").locator(".crm-stat-value")).toHaveText("£45,800");
  await expect(stat(page, "Won")).toContainText("3 deals · in 2026: 2 · £28,400");
  await expect(stat(page, "Lost").locator(".crm-stat-value")).toHaveText("£43,300");
  await expect(stat(page, "Lost")).toContainText("5 deals · in 2026: 3 · £19,400");
  await expect(stat(page, "Win rate").locator(".crm-stat-value")).toHaveText("38%");
  await expect(stat(page, "Win rate")).toContainText("3 of 8 closed");
  await expect(stat(page, "Average cycle").locator(".crm-stat-value")).toHaveText("46 days");
  // No filter by person for a rep, and no name on a row: they are all hers.
  await expect(page.getByRole("group", { name: "Whose deals" })).toHaveCount(0);
  const list = page.locator(".crm-closed-row");
  await expect(list).toHaveCount(8);
  // The ledger's newest close: L4, Mon 20 Jul 2026.
  await expect(list.first()).toContainText("Archive shelving, second run");
  await expect(list.first()).toContainText("Lost at Proposal · Budget pulled");
  await expect(list.first()).toContainText("Jun 1, 2026 → Jul 20, 2026");
  await expect(list.first()).toContainText("49 days");
  await expect(list.first().locator(".crm-closed-owner")).toHaveCount(0);
  expect(problems).toEqual([]);
  await picture(page, "1-dana-closed");
});

test("the sales manager sees the team's 26 with the ledger's figures, and narrows them", async ({ as, stand }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  await page.goto(`${STAFF}closed`);
  await expect(stat(page, "Won").locator(".crm-stat-value")).toHaveText("£130,000");
  await expect(stat(page, "Won")).toContainText("8 deals · in 2026: 5 · £81,600");
  await expect(stat(page, "Lost").locator(".crm-stat-value")).toHaveText("£294,400");
  await expect(stat(page, "Lost")).toContainText("18 deals · in 2026: 12 · £188,600");
  await expect(stat(page, "Win rate").locator(".crm-stat-value")).toHaveText("31%");
  await expect(stat(page, "Win rate")).toContainText("8 of 26 closed · 29% in 2026");
  await expect(stat(page, "Average cycle").locator(".crm-stat-value")).toHaveText("54 days");
  await expect(stat(page, "Average cycle")).toContainText("54 days in 2026");
  await expect(page.locator(".crm-closed-row")).toHaveCount(26);
  // A won deal names the job it became, where Jobs on site is installed (stage 2); at the first release it says when it was won.
  await expect(page.locator(".crm-closed-row").filter({ hasText: "Studio meeting tables" })).toContainText(stand.parts.includes("jobs") ? "Won Jun 12, 2026 · job J-08" : "Won Jun 12, 2026");
  if (!stand.parts.includes("jobs")) await expect(page.locator(".crm-closed-row").filter({ hasText: "Studio meeting tables" })).not.toContainText("job");
  // The longest cycle is w3's 77 days.
  await expect(page.locator(".crm-closed-row").filter({ hasText: "Meeting pods, first floor" })).toContainText("77 days");
  await picture(page, "2-ivy-closed");

  await page.getByRole("group", { name: "Which deals" }).getByRole("button", { name: /^Lost/ }).click();
  await expect(page.locator(".crm-closed-row")).toHaveCount(18);
  await expect(page.locator('.crm-closed-row[data-state="won"]')).toHaveCount(0);
  await page.getByRole("group", { name: "Which deals" }).getByRole("button", { name: /^All/ }).click();
  await page.getByRole("group", { name: "Whose deals" }).getByRole("button", { name: "Dana" }).click();
  await expect(page.locator(".crm-closed-row")).toHaveCount(8);
  await expect(stat(page, "Won").locator(".crm-stat-value")).toHaveText("£45,800");
});

test("every figure on Closed is what the server answers that person, asked directly", async ({ as, data }) => {
  for (const person of ["dana", "ivy"]) {
    const context = await as(person);
    const page = await context.newPage();
    await page.goto(`${STAFF}closed`);
    const mine = person === "dana";
    const me = ((await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
    const closed = (await rows<{ state: string; amount: number; owner_id: string; cycle_days: number }>(context.request, data, "deals", { column: "state", op: "in", value: ["won", "lost"] })).filter((deal) => !mine || deal.owner_id === me);
    const won = closed.filter((deal) => deal.state === "won");
    const money = (value: number) => `£${value.toLocaleString("en-GB")}`;
    const sum = (list: { amount: number }[]) => list.reduce((total, deal) => total + Number(deal.amount), 0);
    await expect(stat(page, "Won").locator(".crm-stat-value"), person).toHaveText(money(sum(won)));
    await expect(stat(page, "Lost").locator(".crm-stat-value"), person).toHaveText(money(sum(closed.filter((deal) => deal.state === "lost"))));
    await expect(stat(page, "Win rate").locator(".crm-stat-value"), person).toHaveText(`${String(Math.round((won.length / closed.length) * 100))}%`);
    await expect(stat(page, "Average cycle").locator(".crm-stat-value"), person).toHaveText(`${String(Math.round(won.reduce((total, deal) => total + Number(deal.cycle_days), 0) / won.length))} days`);
    await expect(page.locator(".crm-closed-row"), person).toHaveCount(closed.length);
    await page.close();
  }
});

test("for the account manager it is Won deals: the eight that were won, and the server gives him no lost one", async ({ as, api, data }) => {
  const page = await (await as("hugo")).newPage();
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Won deals" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Won deals");
  await expect(page.locator(".crm-stat")).toHaveCount(2);
  await expect(stat(page, "Won").locator(".crm-stat-value")).toHaveText("£130,000");
  await expect(stat(page, "Average cycle").locator(".crm-stat-value")).toHaveText("54 days");
  await expect(page.getByRole("group", { name: "Which deals" })).toHaveCount(0);
  await expect(page.locator(".crm-closed-row")).toHaveCount(8);
  await expect(page.locator('.crm-closed-row[data-state="lost"]')).toHaveCount(0);
  // His menu holds no board: he reads a deal only once it is won.
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: /board|Deals I am on/i })).toHaveCount(0);
  await picture(page, "3-hugo-won-deals");

  // Asked directly: no lost deal in a list, and one asked for by its number is not there.
  const hugo = await api("hugo");
  expect(await rows(hugo, data, "deals", { column: "state", op: "eq", value: "lost" })).toEqual([]);
  const lost = (await rows<{ id: number }>(await api("ivy"), data, "deals", { column: "state", op: "eq", value: "lost" }))[0]!;
  expect((await hugo.get(data("deals", `/${String(lost.id)}`))).status()).toBe(404);
});

test("Read-only reads the team's Closed; the marketer is refused, by the server", async ({ as, api, data }) => {
  const grace = await (await as("grace")).newPage();
  await grace.goto(`${STAFF}closed`);
  await expect(grace.locator(".crm-closed-row")).toHaveCount(26);
  await expect(grace.getByRole("group", { name: "Whose deals" })).toBeVisible();

  const lena = await api("lena");
  expect((await lena.get(data("deals", "?limit=5"))).status()).toBe(403);
  const page = await (await as("lena")).newPage();
  await page.goto(`${STAFF}closed`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
});

test("Closed at 390 wide, in the dark, and in Arabic right to left", async ({ as }) => {
  const narrow = await (await as("ivy", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await narrow.goto(`${STAFF}closed`);
  await expect(narrow.locator(".crm-closed-row")).toHaveCount(26);
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "4-ivy-closed-390-dark");

  const context = await as("priya");
  await inArabic(context.request, async () => {
    const priya = await context.newPage();
    await priya.goto(`${STAFF}closed`);
    await expect(priya.getByRole("heading", { level: 1 })).toHaveText("المغلقة");
    expect(await priya.evaluate(() => document.documentElement.dir)).toBe("rtl");
    await expect(priya.locator(".crm-closed-row").first()).toBeVisible();
    expect(await priya.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await picture(priya, "5-priya-closed-arabic");
  });
});
