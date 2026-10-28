/**
 * P03, the Pipeline board (ledger §2), on Adminium's own board part.
 *
 * Dana's board: 6 deals, 143,400 at full value, 95,740 weighted; columns
 * 320 / 0 / 24,500 / 55,800 / 15,120. The team's: 14 · 286,300 · 156,562.50.
 * Closed in 2026: won 5 · 81,600, lost 12 · 188,600 (Dana 2 · 28,400 and
 * 3 · 19,400).
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { card, cardsIn, column, csrf, dealNamed, inArabic, rows, STAFF, watch, unfoldMenu } from "./helpers.ts";

interface Stage {
  id: number;
  label: string;
}
const total = (page: Page, stage: Stage) => column(page, stage.id).locator('[data-part="column-total"]');
const count = (page: Page, stage: Stage) => column(page, stage.id).locator('[data-part="column-count"]');

test("Dana opens her board from the menu, with the ledger's figures", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Pipeline board" }).click();
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/pipeline$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My pipeline");
  await expect(page.getByTestId("board-weighted")).toHaveText("£95,740");
  await expect(page.getByTestId("board-full")).toHaveText("£143,400");
  await expect(page.getByTestId("board-count")).toHaveText("6");

  const stages = await rows<Stage>(context.request, data, "stages", undefined, "&order=position");
  expect(stages.map((stage) => stage.label)).toEqual(["Discovery", "Qualified", "Proposal", "Negotiation", "Verbal"]);
  await expect(page.getByRole("group", { name: "Pipeline board" })).toBeVisible();
  // Each column says its stage and, beside it, the stage's odds.
  await expect(column(page, stages[0]!.id)).toContainText("Discovery");
  await expect(column(page, stages[0]!.id)).toContainText("10%");
  await expect(column(page, stages[4]!.id)).toContainText("90%");
  const want = [["1", "£320"], ["0", "£0"], ["2", "£24,500"], ["2", "£55,800"], ["1", "£15,120"]] as const;
  for (const [index, stage] of stages.entries()) {
    await expect(count(page, stage), stage.label).toHaveText(want[index]![0]);
    await expect(total(page, stage), stage.label).toHaveText(want[index]![1]);
  }
  // d1 has sat 14 days in Negotiation (warm), d2 20 in Proposal (warm).
  await expect(card(page, "Fourth-floor desk rows")).toContainText("sitting 14d · warm");
  await expect(card(page, "Fourth-floor desk rows")).toContainText("£52,800");
  await expect(card(page, "Fourth-floor desk rows")).toContainText("Nordwind Logistics");
  await expect(card(page, "Acoustic booths for the studio floor")).toContainText("sitting 20d · warm");
  // Closed in 2026, her own.
  await expect(page.getByTestId("zone-won")).toHaveText("2 · £28,400");
  await expect(page.getByTestId("zone-lost")).toHaveText("3 · £19,400");
  await page.getByRole("link", { name: "See them all" }).click();
  await expect(page).toHaveURL(/\/closed$/);
  expect(problems).toEqual([]);
  await page.goBack();
  await expect(page.getByTestId("board-count")).toHaveText("6");
  await picture(page, "1-dana-board");
});

test("the sales manager's board is the team's, and narrows to one rep", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Team board" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team pipeline");
  await expect(page.getByTestId("board-weighted")).toHaveText("£156,562.50");
  await expect(page.getByTestId("board-full")).toHaveText("£286,300");
  await expect(page.getByTestId("board-count")).toHaveText("14");
  const stages = await rows<Stage>(context.request, data, "stages", undefined, "&order=position");
  const want = [["3", "£3,635"], ["3", "£8,237.50"], ["3", "£43,500"], ["3", "£79,050"], ["2", "£22,140"]] as const;
  for (const [index, stage] of stages.entries()) {
    await expect(count(page, stage), stage.label).toHaveText(want[index]![0]);
    await expect(total(page, stage), stage.label).toHaveText(want[index]![1]);
  }
  // Stale: d12 at 34 days, d5 at 32.
  await expect(card(page, "Depot supervisor stations")).toContainText("sitting 34d · stale");
  await expect(card(page, "Showroom refit, phase one")).toContainText("sitting 32d · stale");
  await expect(page.getByTestId("zone-won")).toHaveText("5 · £81,600");
  await expect(page.getByTestId("zone-lost")).toHaveText("12 · £188,600");
  await picture(page, "2-ivy-team-board");

  await page.getByRole("group", { name: "Whose deals" }).getByRole("button", { name: "Dana" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dana: pipeline");
  await expect(page.getByTestId("board-weighted")).toHaveText("£95,740");
  await expect(page.getByTestId("board-count")).toHaveText("6");
  await expect(page.getByTestId("zone-won")).toHaveText("2 · £28,400");
});

test("a card is moved by keyboard and by mouse; the figures follow and the server holds the stage", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}pipeline`);
  const stages = await rows<Stage>(context.request, data, "stages", undefined, "&order=position");
  const [discovery, qualified, proposal] = stages as [Stage, Stage, Stage];
  await expect(count(page, discovery)).toHaveText("1");

  // By keyboard: Edit-suite chairs (3,200) from Discovery (10 %) to Qualified (25 %).
  await card(page, "Edit-suite chairs").focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "Edit-suite chairs")).toHaveAttribute("aria-grabbed", "true");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator(".crm-toast")).toContainText("Edit-suite chairs → Qualified · £800 weighted");
  await expect.poll(() => cardsIn(page, qualified.id)).toEqual(["Edit-suite chairs"]);
  await expect(total(page, discovery)).toHaveText("£0");
  await expect(total(page, qualified)).toHaveText("£800");
  // 95,740 - 320 + 800.
  await expect(page.getByTestId("board-weighted")).toHaveText("£96,220");
  expect((await dealNamed(context.request, data, "Edit-suite chairs")).stage_id).toBe(qualified.id);

  // By mouse: on to Proposal (50 %).
  const from = (await card(page, "Edit-suite chairs").boundingBox())!;
  // The whole column is the drop target (Adminium 0.3.37).
  const to = (await column(page, proposal.id).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".crm-toast")).toContainText("Edit-suite chairs → Proposal · £1,600 weighted");
  await expect(count(page, proposal)).toHaveText("3");
  expect((await dealNamed(context.request, data, "Edit-suite chairs")).stage_id).toBe(proposal.id);
  await picture(page, "3-dana-moved");

  // Still there after a reload: it was the server's save, not the screen's.
  await page.reload();
  await expect.poll(() => cardsIn(page, proposal.id)).toContain("Edit-suite chairs");

  // Put it back, so the specs after this one read the ledger again.
  const deal = await dealNamed(context.request, data, "Edit-suite chairs");
  expect((await context.request.patch(data("deals", `/${String(deal.id)}`), { data: { values: { stage_id: discovery.id } }, headers: await csrf(context.request) })).status()).toBe(200);
  await expect(total(page, discovery)).toHaveText("£320");
});

test("a move the server refuses puts the card back and says why", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}pipeline`);
  const stages = await rows<Stage>(context.request, data, "stages", undefined, "&order=position");
  const [discovery, qualified] = stages as [Stage, Stage];
  await expect(count(page, discovery)).toHaveText("1");
  // The server's own answer to a row somebody changed in between, given here in its place: the board must take a refusal as one.
  await page.route("**/api/v1/data/**", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "ROW_CHANGED", message: "The row changed." } }) });
  });
  await card(page, "Edit-suite chairs").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const notice = page.locator('[data-kit-part="board"] [data-part="board-move-refused"]');
  await expect(notice).toContainText("Somebody changed this since you opened it");
  await expect.poll(() => cardsIn(page, discovery.id)).toEqual(["Edit-suite chairs"]);
  expect(await cardsIn(page, qualified.id)).toEqual([]);
  await page.unroute("**/api/v1/data/**");
  expect((await dealNamed(context.request, data, "Edit-suite chairs")).stage_id).toBe(discovery.id);
});

test("a colleague's move reaches the open board without a reload", async ({ as, api, data }) => {
  const page = await (await as("dana")).newPage();
  await page.goto(`${STAFF}pipeline`);
  const ivy = await api("ivy");
  const stages = await rows<Stage>(ivy, data, "stages", undefined, "&order=position");
  const [discovery, qualified] = stages as [Stage, Stage];
  await expect(count(page, discovery)).toHaveText("1");
  const deal = await dealNamed(ivy, data, "Edit-suite chairs");
  const headers = await csrf(ivy);
  expect((await ivy.patch(data("deals", `/${String(deal.id)}`), { data: { values: { stage_id: qualified.id } }, headers })).status()).toBe(200);
  await expect.poll(() => cardsIn(page, qualified.id)).toEqual(["Edit-suite chairs"]);
  await expect(total(page, qualified)).toHaveText("£800");
  expect((await ivy.patch(data("deals", `/${String(deal.id)}`), { data: { values: { stage_id: discovery.id } }, headers })).status()).toBe(200);
  await expect.poll(() => cardsIn(page, discovery.id)).toEqual(["Edit-suite chairs"]);
  await expect(page.getByTestId("board-weighted")).toHaveText("£95,740");
});

test("Read-only sees the team's board and can move nothing; the server refuses her and the marketer", async ({ as, api, data }) => {
  const context = await as("grace");
  const page = await context.newPage();
  await page.goto(`${STAFF}pipeline`);
  await expect(page.getByTestId("board-count")).toHaveText("14");
  await expect(page.getByRole("button", { name: /New deal/ })).toHaveCount(0);
  const stages = await rows<Stage>(context.request, data, "stages", undefined, "&order=position");
  // No card has a menu for her: there is nothing she may do to a deal.
  await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
  // Enter on a card she cannot move opens it; there is nothing to close it with.
  await card(page, "Edit-suite chairs").focus();
  await page.keyboard.press("Enter");
  const look = page.getByRole("dialog", { name: "Edit-suite chairs" });
  await expect(look).toBeVisible();
  await expect(look.getByRole("button", { name: /won or lost/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(look).toHaveCount(0);
  // N starts nothing for her.
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // By a direct call: the move, a new deal and closing one are each the server's to refuse.
  const deal = await dealNamed(context.request, data, "Edit-suite chairs");
  const headers = await csrf(context.request);
  expect((await context.request.patch(data("deals", `/${String(deal.id)}`), { data: { values: { stage_id: stages[1]!.id } }, headers })).status()).toBe(403);
  expect((await context.request.post(data("deals"), { data: { values: { name: "Not hers to make", company_id: 1, owner_id: deal.owner_id, stage_id: stages[0]!.id, typed_amount: 1 } }, headers })).status()).toBe(403);
  expect((await context.request.post(data("deals", `/${String(deal.id)}/actions/mark-won`), { data: { from: "open" }, headers })).status()).toBe(403);

  const lena = await api("lena");
  expect((await lena.get(data("deals", "?limit=5"))).status()).toBe(403);
  const refused = await (await as("lena")).newPage();
  await refused.goto(`${STAFF}pipeline`);
  await expect(refused.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
});

test("the board at 390 wide in the dark, and in Arabic right to left", async ({ as }) => {
  const narrow = await (await as("dana", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await narrow.goto(`${STAFF}pipeline`);
  await expect(narrow.getByTestId("board-count")).toHaveText("6");
  await expect(card(narrow, "Edit-suite chairs")).toBeVisible();
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "4-dana-board-390-dark");

  const context = await as("priya");
  await inArabic(context.request, async () => {
    const priya = await context.newPage();
    await priya.goto(`${STAFF}pipeline`);
    await expect(priya.getByTestId("board-count")).toHaveText("٣");
    expect(await priya.evaluate(() => document.documentElement.dir)).toBe("rtl");
    await expect(priya.getByRole("heading", { level: 1 })).toHaveText("مسار صفقاتي");
    await expect(priya.locator('[data-kit-part="board"] [data-board-card]').first()).toBeVisible();
    // The board itself is drawn right to left by the kit.
    expect(await priya.locator('[data-kit-part="board"] [data-part="kit-board"]').evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
    await picture(priya, "5-priya-board-arabic");
  });
});
