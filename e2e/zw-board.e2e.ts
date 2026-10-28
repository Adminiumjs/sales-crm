/**
 * THE PIPELINE BOARD, the walk's way: Adminium's board as the console draws
 * it (the Sales CRM section's Pipeline, `/p/crm-pipeline`), and the same kit
 * board on the CRM's own staff side where a step reaches it too.
 *
 * What `pipeline.e2e.ts` and `console-section.e2e.ts` already prove is not
 * done again here: the staff board's figures, its drag and keys and refusal,
 * a colleague's move arriving, Read-only's and the marketer's refusals, the
 * staff board at 390 and in Arabic; the console board's headings and the
 * owner's person filter. This file proves what the walk asks beyond them:
 * the console board signed in as the sales manager and as Dana, a card
 * dragged and moved by keyboard in the console, a won deal's stage refused
 * from its record, a stage added in Stages joining the open boards with no
 * reload (and leaving when it is removed), many stages scrolling sideways
 * inside the board and never the page, the console board at 390 wide, and in
 * Arabic.
 *
 * It leaves the stand as it found it: a moved card is put back, every stage
 * it adds is called "Legal review" or "ZW stage …" and is taken away.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { authOf, expect, picture, stand, test } from "./fixtures.ts";
import { csrf, dealNamed, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { room } from "./p12-helpers.ts";

interface Stage {
  id: number;
  label: string;
  position: number;
}

const board = (page: Page): Locator => page.locator("[data-board-scroller]").first();
const columnOf = (page: Page, id: number | string): Locator => page.locator(`[data-board-column="${String(id)}"]`);
const cardIn = (page: Page, column: number | string, title: string): Locator => columnOf(page, column).locator("[data-board-card]").filter({ hasText: title });
const columnIds = (page: Page): Promise<string[]> => page.locator("[data-board-column]").evaluateAll((all) => all.map((one) => one.getAttribute("data-board-column") ?? ""));
const spoken = (page: Page): Locator => page.locator("[data-board-liveregion]").first();
const pageSideways = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const stagesOf = (person: APIRequestContext, data: Data): Promise<Stage[]> => rows<Stage>(person, data, "stages", undefined, "&order=position");

/** Every stage this file adds, taken away as the CRM admin (nothing names one). */
async function removeSpecStages(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const stage of await stagesOf(admin, data)) {
    if (stage.label !== "Legal review" && !stage.label.startsWith("ZW stage")) continue;
    const gone = await admin.delete(data("stages", `/${String(stage.id)}?confirm=true`), { headers });
    expect(gone.status(), `stage ${stage.label} is taken away: ${await gone.text()}`).toBeLessThan(300);
  }
}

test.beforeAll(async ({ browser }) => {
  // A stage an earlier, broken run left behind would add a column to every board after this file.
  const state = stand();
  const context = await browser.newContext({ baseURL: state.url, storageState: await authOf(browser, "tessa") });
  const data: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;
  await removeSpecStages(context.request, data);
  await context.close();
});

test("the console's Pipeline as the sales manager and as Dana: the stages in order, each heading's count and totals, and the toolbar's", async ({ as, data }) => {
  const ivyContext = await as("ivy");
  const stages = await stagesOf(ivyContext.request, data);
  expect(stages.map((stage) => stage.label)).toEqual(["Discovery", "Qualified", "Proposal", "Negotiation", "Verbal"]);

  // The sales manager: the team's 14 deals, £286,300 at full value (ledger §2), and each stage's count, full and weighted.
  const ivy = await ivyContext.newPage();
  const problems = watch(ivy);
  await ivy.goto("/p/crm-pipeline");
  await expect(columnOf(ivy, stages[0]!.id)).toBeVisible();
  expect(await columnIds(ivy)).toEqual(stages.map((stage) => String(stage.id)));
  const team = [
    ["3", "£36,350", "£3,635"],
    ["3", "£32,950", "£8,237.50"],
    ["3", "£87,000", "£43,500"],
    ["3", "£105,400", "£79,050"],
    ["2", "£24,600", "£22,140"],
  ] as const;
  for (const [at, stage] of stages.entries()) {
    const column = columnOf(ivy, stage.id);
    await expect(column, stage.label).toContainText(stage.label);
    await expect(column.locator('[data-part="column-count"]'), stage.label).toHaveText(team[at]![0]);
    await expect(column.locator('[data-part="column-total"]'), stage.label).toContainText(team[at]![1]);
    await expect(column.locator('[data-part="column-total"]'), stage.label).toContainText(team[at]![2]);
    await expect(column.locator("[data-board-card]"), stage.label).toHaveCount(Number(team[at]![0]));
  }
  const total = ivy.getByTestId("board-total");
  await expect(total).toContainText("14");
  await expect(total).toContainText("£286,300");
  await picture(ivy, "zw-board-1-ivy-console");
  expect(problems).toEqual([]);

  // Dana: her own 6 deals, £143,400 (ledger §2: 1 · 0 · 2 · 2 · 1).
  const dana = await (await as("dana")).newPage();
  await dana.goto("/p/crm-pipeline");
  await expect(columnOf(dana, stages[0]!.id)).toBeVisible();
  expect(await columnIds(dana)).toEqual(stages.map((stage) => String(stage.id)));
  const hers = [
    ["1", "£3,200", "£320"],
    ["0", "£0", "£0"],
    ["2", "£49,000", "£24,500"],
    ["2", "£74,400", "£55,800"],
    ["1", "£16,800", "£15,120"],
  ] as const;
  for (const [at, stage] of stages.entries()) {
    const column = columnOf(dana, stage.id);
    await expect(column.locator('[data-part="column-count"]'), stage.label).toHaveText(hers[at]![0]);
    if (hers[at]![0] !== "0") {
      await expect(column.locator('[data-part="column-total"]'), stage.label).toContainText(hers[at]![1]);
      await expect(column.locator('[data-part="column-total"]'), stage.label).toContainText(hers[at]![2]);
    }
  }
  await expect(dana.getByTestId("board-total")).toContainText("6");
  await expect(dana.getByTestId("board-total")).toContainText("£143,400");
  await picture(dana, "zw-board-2-dana-console");
});

test("in the console a card is dragged with the mouse and moved by keyboard; the server holds each stage", async ({ as, data }) => {
  const context = await as("dana");
  const [discovery, qualified] = (await stagesOf(context.request, data)) as [Stage, Stage];
  const deal = await dealNamed(context.request, data, "Edit-suite chairs");
  expect(deal.stage_id).toBe(discovery.id);
  try {
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto("/p/crm-pipeline");
    const chairs = cardIn(page, discovery.id, "Edit-suite chairs");
    await expect(chairs).toBeVisible();

    // By mouse: Discovery to Qualified.
    const from = (await chairs.boundingBox())!;
    // The whole column is the drop target (Adminium 0.3.37), and it says so while a card is over it.
    const to = (await columnOf(page, qualified.id).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
    await expect(columnOf(page, qualified.id)).toHaveAttribute("data-drop-target", "");
    await page.mouse.up();
    await expect(cardIn(page, qualified.id, "Edit-suite chairs")).toBeVisible();
    await expect(spoken(page)).toHaveText(/Moved Edit-suite chairs to Qualified\./);
    await expect.poll(async () => (await dealNamed(context.request, data, "Edit-suite chairs")).stage_id).toBe(qualified.id);
    // The headings follow the server: Qualified holds it, Discovery is empty.
    await expect(columnOf(page, qualified.id).locator('[data-part="column-count"]')).toHaveText("1");
    await expect(columnOf(page, discovery.id).locator('[data-part="column-count"]')).toHaveText("0");

    // By keyboard: back to Discovery. The card keeps the focus.
    const moved = cardIn(page, qualified.id, "Edit-suite chairs");
    await moved.focus();
    await expect(moved).toBeFocused();
    await page.keyboard.press("Space");
    await expect(moved).toHaveAttribute("aria-grabbed", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(spoken(page)).toHaveText(/Edit-suite chairs is over Discovery\./);
    await page.keyboard.press("Enter");
    await expect(cardIn(page, discovery.id, "Edit-suite chairs")).toBeVisible();
    await expect(spoken(page)).toHaveText(/Moved Edit-suite chairs to Discovery\./);
    await expect.poll(async () => (await dealNamed(context.request, data, "Edit-suite chairs")).stage_id).toBe(discovery.id);
    await expect(cardIn(page, discovery.id, "Edit-suite chairs")).toBeFocused();
    // Still there after a reload: the server's, not the screen's.
    await page.reload();
    await expect(cardIn(page, discovery.id, "Edit-suite chairs")).toBeVisible();
    await expect(page.getByTestId("board-total")).toContainText("£143,400");
    expect(problems).toEqual([]);
  } finally {
    const now = await dealNamed(context.request, data, "Edit-suite chairs");
    if (now.stage_id !== discovery.id) expect((await context.request.patch(data("deals", `/${String(deal.id)}`), { data: { values: { stage_id: discovery.id } }, headers: await csrf(context.request) })).status()).toBe(200);
  }
});

test("a won deal's stage is not moved from its record: the record says it is locked, its edit holds the stage, and the server refuses the move", async ({ as, data, stand }) => {
  const context = await as("dana");
  const won = (await rows<{ id: number; name: string; stage_id: number; owner_id: string }>(context.request, data, "deals", { column: "state", op: "eq", value: "won" }, "&order=id")).find((deal) => deal.owner_id === stand.people["dana"]!.id)!;
  expect(won, "Dana has a won deal (ledger: 2 won in 2026)").toBeDefined();
  const stages = await stagesOf(context.request, data);
  const other = stages.find((stage) => stage.id !== won.stage_id)!;
  const page = await context.newPage();
  await page.goto(`/p/crm-deals/r/${String(won.id)}`);
  const record = page.locator('[data-part="page-record"]');
  await expect(record).toContainText(won.name);
  // The record says why before anybody tries: it is locked now it is won.
  await expect(record.getByText("Locked once Won")).toBeVisible();
  // Its edit leaves the stage as it is: the field cannot be changed.
  const edit = record.getByRole("button", { name: "Edit", exact: true });
  if ((await edit.count()) > 0) {
    await edit.click();
    const dialog = page.getByRole("dialog");
    // Every field but the close note and the lost reason is locked: the stage is shown as it is, with no control to change it.
    await expect(dialog.getByText("Stage", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel(/^Stage/)).toHaveCount(0);
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await picture(page, "zw-board-3-won-record");
  // Asked directly, the server refuses the move, and the deal stays where it was won.
  const refused = await context.request.patch(data("deals", `/${String(won.id)}`), { data: { values: { stage_id: other.id } }, headers: await csrf(context.request) });
  expect(refused.status(), await refused.text()).toBeGreaterThanOrEqual(400);
  expect(((await refused.json()) as { error?: { code?: string } }).error?.code).toMatch(/LOCK/);
  expect((await rows<{ stage_id: number; state: string }>(context.request, data, "deals", { column: "id", op: "eq", value: won.id }))[0]).toMatchObject({ stage_id: won.stage_id, state: "won" });
  // Nor is it a card of the board to drag.
  await page.goto("/p/crm-pipeline");
  await expect(page.locator("[data-board-column]").first()).toBeVisible();
  await expect(page.locator("[data-board-card]").filter({ hasText: won.name })).toHaveCount(0);
});

test("a stage added in Stages joins the open boards without a reload, and leaves them when it is removed", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  try {
    // The open boards: Dana's in the console and on the staff side.
    const dana = await as("dana");
    const consoleBoard = await dana.newPage();
    await consoleBoard.goto("/p/crm-pipeline");
    await expect(consoleBoard.locator("[data-board-column]")).toHaveCount(5);
    const staffBoard = await dana.newPage();
    await staffBoard.goto(`${STAFF}pipeline`);
    await expect(staffBoard.locator('[data-kit-part="board"] [data-board-column]')).toHaveCount(5);

    // In the console, Stages: a new row "Legal review", after Verbal.
    const owner = await (await as("owner")).newPage();
    await owner.goto("/p/crm-stages");
    await owner.getByRole("button", { name: /^New/ }).first().click();
    const form = owner.getByRole("dialog");
    await form.getByLabel(/^Label/).fill("Legal review");
    await form.getByLabel(/^Odds/).fill("0.95");
    await form.getByLabel(/^Position/).fill("5");
    await form.getByRole("button", { name: /^(Create|Add)/ }).click();
    await expect(form).toHaveCount(0);
    const made = (await stagesOf(tessa, data)).find((stage) => stage.label === "Legal review");
    expect(made, "the stage is saved").toBeDefined();

    // Both boards gain the column, last, with no reload.
    await expect(consoleBoard.locator("[data-board-column]")).toHaveCount(6, { timeout: 20_000 });
    expect((await columnIds(consoleBoard)).at(-1)).toBe(String(made!.id));
    await expect(columnOf(consoleBoard, made!.id)).toContainText("Legal review");
    await expect(columnOf(consoleBoard, made!.id).locator('[data-part="column-count"]')).toHaveText("0");
    await expect(staffBoard.locator('[data-kit-part="board"] [data-board-column]')).toHaveCount(6, { timeout: 20_000 });
    await expect(staffBoard.locator(`[data-kit-part="board"] [data-board-column="${String(made!.id)}"]`)).toContainText("Legal review");
    await picture(consoleBoard, "zw-board-4-legal-review");

    // Taken away again (nothing names it): both boards let it go, still with no reload.
    await removeSpecStages(tessa, data);
    await expect(consoleBoard.locator("[data-board-column]")).toHaveCount(5, { timeout: 20_000 });
    await expect(staffBoard.locator('[data-kit-part="board"] [data-board-column]')).toHaveCount(5, { timeout: 20_000 });
  } finally {
    await removeSpecStages(tessa, data);
  }
  expect((await stagesOf(tessa, data)).map((stage) => stage.label)).toEqual(["Discovery", "Qualified", "Proposal", "Negotiation", "Verbal"]);
});

test("with many stages the board scrolls sideways inside itself, and the page does not", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  await room(tessa, data, 40);
  const headers = await csrf(tessa);
  try {
    for (let n = 1; n <= 7; n += 1) {
      const res = await tessa.post(data("stages"), { data: { values: { label: `ZW stage ${String(n)}`, odds: 0.5, position: 10 + n } }, headers });
      expect(res.status(), await res.text()).toBe(201);
    }
    const ids = (await stagesOf(tessa, data)).map((stage) => String(stage.id));
    expect(ids).toHaveLength(12);
    const dana = await as("dana");
    for (const [where, address, scope] of [["console", "/p/crm-pipeline", ""], ["staff side", `${STAFF}pipeline`, '[data-kit-part="board"] ']] as const) {
      const page = await dana.newPage();
      await page.goto(address);
      await expect(page.locator(`${scope}[data-board-column]`), where).toHaveCount(12);
      const scroller = page.locator(`${scope}[data-board-scroller]`).first();
      const last = page.locator(`${scope}[data-board-column="${ids.at(-1)!}"]`);
      // The columns are wider than the window: the board holds them and scrolls; the page stays the window's width.
      expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 200), where).toBe(true);
      expect(await pageSideways(page), where).toBeLessThanOrEqual(0);
      expect(await last.evaluate((el) => el.getBoundingClientRect().left >= window.innerWidth), `${where}: the last column starts out of view`).toBe(true);
      // Scrolled inside the board, the last column comes into view; the page has not moved.
      await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      await expect.poll(() => last.evaluate((el) => { const box = el.getBoundingClientRect(); return box.right <= window.innerWidth + 1 && box.left >= 0; }), where).toBe(true);
      expect(await page.evaluate(() => window.scrollX), where).toBe(0);
      expect(await pageSideways(page), where).toBeLessThanOrEqual(0);
      await picture(page, `zw-board-5-many-stages-${where === "console" ? "console" : "staff"}`);
      await page.close();
    }
  } finally {
    await removeSpecStages(tessa, data);
  }
  expect(await stagesOf(tessa, data)).toHaveLength(5);
});

test("the console's board at 390 wide: the page never scrolls sideways, the board does, and a card moved by keyboard is followed into view", async ({ as, data }) => {
  const context = await as("dana", { viewport: { width: 390, height: 844 } });
  const stages = await stagesOf(context.request, data);
  const [discovery, qualified] = stages as [Stage, Stage];
  try {
    const page = await context.newPage();
    await page.goto("/p/crm-pipeline");
    await expect(columnOf(page, discovery.id)).toBeVisible();
    await expect(page.getByTestId("board-total")).toContainText("£143,400");
    expect(await pageSideways(page)).toBeLessThanOrEqual(0);
    expect(await board(page).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    // A column is no wider than the window.
    expect((await columnOf(page, discovery.id).boundingBox())!.width).toBeLessThanOrEqual(390);
    const chairs = cardIn(page, discovery.id, "Edit-suite chairs");
    await chairs.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(cardIn(page, qualified.id, "Edit-suite chairs")).toBeVisible();
    await expect.poll(async () => (await dealNamed(context.request, data, "Edit-suite chairs")).stage_id).toBe(qualified.id);
    // The board scrolled to the column the card went to; the page did not move sideways.
    await expect.poll(() => cardIn(page, qualified.id, "Edit-suite chairs").evaluate((el) => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth + 1; })).toBe(true);
    expect(await pageSideways(page)).toBeLessThanOrEqual(0);
    await picture(page, "zw-board-6-console-390");
  } finally {
    const now = await dealNamed(context.request, data, "Edit-suite chairs");
    if (now.stage_id !== discovery.id) expect((await context.request.patch(data("deals", `/${String(now.id)}`), { data: { values: { stage_id: discovery.id } }, headers: await csrf(context.request) })).status()).toBe(200);
  }
});

test("the console's board in Arabic reads right to left, in Arabic, and still moves nothing sideways at 390", async ({ as, data }) => {
  const context = await as("priya", { viewport: { width: 390, height: 844 } });
  const stages = await stagesOf(context.request, data);
  await inArabic(context.request, async () => {
    const page = await context.newPage();
    await page.goto("/p/crm-pipeline");
    await expect(columnOf(page, stages[0]!.id)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مسار الصفقات");
    // Priya's three open deals, said in Arabic: the count in the sentence's own digits (٣), the sums in Latin ones.
    await expect(page.getByTestId("board-total")).toContainText(/^الصفقات: ٣ · المبلغ/);
    // The first stage stands at the right, the next to its left.
    const [first, second] = await Promise.all([columnOf(page, stages[0]!.id).boundingBox(), columnOf(page, stages[1]!.id).boundingBox()]);
    expect(second!.x).toBeLessThan(first!.x);
    expect(await board(page).evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
    expect(await pageSideways(page)).toBeLessThanOrEqual(0);
    await picture(page, "zw-board-7-console-arabic");
  });
});
