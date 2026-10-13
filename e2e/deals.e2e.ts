/**
 * P02, starting a deal and closing one.
 *
 * A deal is started from the board's button or with N, by a rep (her own) or
 * a manager (for whoever she picks). It is saved once even when the reply is
 * lost on the way back: staged here in a real browser, by letting the save
 * reach the server and dropping its answer.
 *
 * A deal is closed from its card: won, or lost with a reason the server
 * insists on. Every deal a spec makes is called "Spec: …" and taken away
 * again by the CRM admin, so the ledger's figures hold for the next spec.
 */
import { expect, picture, test } from "./fixtures.ts";
import { card, cardsIn, csrf, dealNamed, removeDeals, rows, STAFF, watch } from "./helpers.ts";

test.afterEach(async ({ api, data }) => {
  await removeDeals(await api("tessa"), data, "Spec: ");
});

test("Dana starts a deal with N: it is on her board, hers, with its first step on Thursday at ten", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}pipeline`);
  await expect(page.getByTestId("board-count")).toHaveText("6");
  await page.keyboard.press("n");
  const sheet = page.getByRole("dialog", { name: "Start a deal" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("What is the work?")).toBeFocused();
  // No owner to pick: a rep's deal is her own.
  await expect(sheet.getByRole("radiogroup", { name: "Who owns it?" })).toHaveCount(0);

  // Each thing it needs, asked for in turn.
  const save = sheet.getByRole("button", { name: "Add to the board" });
  await save.click();
  await expect(sheet.getByRole("alert")).toHaveText("Give it a name: what is the work?");
  await sheet.getByLabel("What is the work?").fill("Spec: boardroom table");
  await save.click();
  await expect(sheet.getByRole("alert")).toHaveText("Pick the company.");
  await sheet.getByRole("radio", { name: "Cobalt Legal" }).click();
  await save.click();
  await expect(sheet.getByRole("alert")).toHaveText("An amount, even a rough one, keeps the forecast honest.");

  await expect(sheet.locator("#crm-nd-amount-read")).toHaveText("In GBP. For example £18,000.");
  await sheet.getByLabel("Amount").fill("18,000");
  await expect(sheet.locator("#crm-nd-amount-read")).toHaveText("Reads as £18,000");
  // Sixty days on from Tuesday 28 July.
  await expect(sheet.getByLabel("Expected close")).toHaveValue("2026-09-26");
  await expect(sheet.getByRole("radio", { name: /Discovery/ })).toHaveAttribute("aria-checked", "true");
  await expect(sheet).toContainText("Weighted value starts at £1,800.");
  await sheet.getByRole("radio", { name: /Qualified/ }).click();
  await expect(sheet).toContainText("Weighted value starts at £4,500.");
  await expect(sheet.getByRole("switch", { name: "Line up the first step" })).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("textbox", { name: "Line up the first step" }).fill("Call the office manager");
  await expect(sheet).toContainText("Lands on the Today queue for");
  await expect(sheet.locator(".crm-next-when")).toContainText("Thu, Jul 30, 10:00");
  await picture(page, "1-dana-new-deal");
  await save.click();

  await expect(page.locator(".crm-toast")).toHaveText("Spec: boardroom table is on the board: Qualified, £18,000.");
  await expect(sheet).toHaveCount(0);
  await expect(card(page, "Spec: boardroom table")).toContainText("£18,000");
  await expect(page.getByTestId("board-count")).toHaveText("7");
  await expect(page.getByTestId("board-weighted")).toHaveText("£100,240");

  // What the server holds: hers, in Qualified, typed 18,000, weighted 4,500, opened today; one step, due 10:00 on the 30th in London.
  const me = ((await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const deal = await dealNamed(context.request, data, "Spec: boardroom table");
  expect([deal.owner_id, deal.state, Number(deal["typed_amount"]), Number(deal["amount"]), Number(deal["weighted_value"]), deal["expected_close"], deal["opened_on"]]).toEqual([me, "open", 18000, 18000, 4500, "2026-09-26", "2026-07-28"]);
  const steps = await rows<{ due_at: string; text: string; kind: string; owner_id: string; done: boolean }>(context.request, data, "follow_ups", { column: "deal_id", op: "eq", value: deal.id });
  expect(steps.map((step) => [step.due_at, step.text, step.kind, step.owner_id, Boolean(step.done)])).toEqual([["2026-07-30T09:00:00.000Z", "Call the office manager", "step", me, false]]);
  expect(problems).toEqual([]);
});

test("a reply lost on the way back makes one deal, not two", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}pipeline`);
  await expect(page.getByTestId("board-count")).toHaveText("6");
  await page.getByRole("button", { name: /New deal/ }).click();
  const sheet = page.getByRole("dialog", { name: "Start a deal" });
  await sheet.getByLabel("What is the work?").fill("Spec: lost reply");
  await sheet.getByRole("radio", { name: "Low Orbit" }).click();
  await sheet.getByLabel("Amount").fill("2500");
  await sheet.getByRole("switch", { name: "Line up the first step" }).click();

  // The first save reaches the server and is written; its answer never arrives. Whatever follows goes through.
  const sent: { key: string; replayed: boolean | null }[] = [];
  let dropped = false;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_deals$/.test(new URL(request.url()).pathname)) return route.fallback();
    const key = (request.postDataJSON() as { clientKey: string }).clientKey;
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      sent.push({ key, replayed: null });
      return route.abort("connectionreset");
    }
    sent.push({ key, replayed: ((await response.json()) as { replayed?: boolean }).replayed === true });
    await route.fulfill({ response });
  });
  await sheet.getByRole("button", { name: "Add to the board" }).click();
  // It is never called "not saved": the same save is sent again with the same key, and the server answers the row the first one made.
  await expect(page.locator(".crm-toast")).toHaveText("Spec: lost reply is on the board: Discovery, £2,500.");
  await expect(page.locator(".crm-form-error")).toHaveCount(0);
  expect(sent.length).toBe(2);
  expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
  await page.unroute("**/api/v1/data/**");
  expect((await rows(context.request, data, "deals", { column: "name", op: "eq", value: "Spec: lost reply" })).length).toBe(1);
  await expect(page.getByTestId("board-count")).toHaveText("7");
  expect((await cardsIn(page, (await dealNamed(context.request, data, "Spec: lost reply")).stage_id)).filter((name) => name === "Spec: lost reply")).toEqual(["Spec: lost reply"]);
});

test("the sales manager starts a deal for a rep she picks", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  await page.goto(`${STAFF}pipeline`);
  await page.getByRole("button", { name: /New deal/ }).click();
  const sheet = page.getByRole("dialog", { name: "Start a deal" });
  await sheet.getByLabel("What is the work?").fill("Spec: for Priya");
  await sheet.getByRole("radio", { name: "Fernway Clinics" }).click();
  await sheet.getByLabel("Amount").fill("7400.50");
  await expect(sheet.locator("#crm-nd-amount-read")).toHaveText("Reads as £7,400.50");
  const owners = sheet.getByRole("radiogroup", { name: "Who owns it?" });
  await expect(owners.getByRole("radio")).toHaveText(["IS Ivy", "DW Dana", "PR Priya", "SO Sam", "LV Leo"].map((text) => new RegExp(text.split(" ")[1]!)));
  await owners.getByRole("radio", { name: /Priya/ }).click();
  await sheet.getByRole("textbox", { name: "Line up the first step" }).fill("First call");
  await sheet.getByRole("button", { name: "Add to the board" }).click();
  await expect(page.locator(".crm-toast")).toContainText("Spec: for Priya is on the board");

  const priya = (await rows<{ id: string; name: string }>(context.request, data, "deals", { column: "name", op: "eq", value: "Priya: lab stools" })).length;
  expect(priya).toBe(0);
  const deal = await dealNamed(context.request, data, "Spec: for Priya");
  const lab = await dealNamed(context.request, data, "Lab bench stools");
  // Lab bench stools is Priya's: the new deal has the same owner, and so has its first step.
  expect(deal.owner_id).toBe(lab.owner_id);
  const steps = await rows<{ owner_id: string }>(context.request, data, "follow_ups", { column: "deal_id", op: "eq", value: deal.id });
  expect(steps.map((step) => step.owner_id)).toEqual([lab.owner_id]);
});

test("a deal is closed from its card: lost needs its reason, won is booked; both land on Closed", async ({ as, data }) => {
  const context = await as("dana");
  const headers = await csrf(context.request);
  const stages = await rows<{ id: number; label: string }>(context.request, data, "stages", undefined, "&order=position");
  const me = ((await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const company = (await rows<{ id: number }>(context.request, data, "companies", { column: "name", op: "eq", value: "Low Orbit" }))[0]!;
  for (const [name, amount] of [["Spec: to lose", 4000], ["Spec: to win", 6000]] as const) {
    const made = await context.request.post(data("deals"), { data: { values: { name, company_id: company.id, owner_id: me, stage_id: stages[1]!.id, typed_amount: amount } }, headers });
    expect(made.status(), await made.text()).toBe(201);
  }
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}pipeline`);
  await expect(page.getByTestId("board-count")).toHaveText("8");
  // A click on a card opens a short look at the deal, with Close in it too.
  await card(page, "Spec: to lose").click();
  const look = page.getByRole("dialog", { name: "Spec: to lose" });
  await expect(look).toContainText("£4,000");
  await expect(look.getByRole("button", { name: "Close: won or lost…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(look).toHaveCount(0);

  // LOST, from the card's own menu.
  await page.getByRole("button", { name: "Actions for Spec: to lose" }).click();
  await page.getByRole("menuitem", { name: "Close: won or lost…" }).click();
  const box = page.getByRole("dialog", { name: "Close this deal" });
  await expect(box).toContainText("Spec: to lose · Low Orbit");
  const confirm = box.getByRole("button", { name: /Mark it/ });
  await expect(confirm).toBeDisabled();
  await box.getByRole("radio", { name: "Lost" }).click();
  await expect(confirm).toHaveText("Mark it lost");
  // Lost with no reason cannot be confirmed.
  await expect(confirm).toBeDisabled();
  await expect(box.getByRole("radiogroup", { name: /Why did it go/ }).getByRole("radio")).toHaveCount(5);
  await box.getByRole("radio", { name: "Budget pulled" }).click();
  await box.getByLabel("Note for the team").fill("Ask again in the spring");
  await picture(page, "2-dana-close-lost");
  await confirm.click();
  await expect(page.locator(".crm-toast")).toHaveText("Spec: to lose marked lost: Budget pulled.");
  await expect(card(page, "Spec: to lose")).toHaveCount(0);
  await expect(page.getByTestId("board-count")).toHaveText("7");
  await expect(page.getByTestId("zone-lost")).toHaveText("4 · £23,400");

  // WON, with the keyboard alone: Tab from the card to its menu button, open it, choose Close, pick Won, confirm.
  await card(page, "Spec: to win").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Actions for Spec: to win" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Close: won or lost…" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(box.getByRole("radio", { name: "Won" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(box).toContainText("Booked value");
  await expect(box.locator(".crm-booked-value")).toHaveText("£6,000");
  await box.getByRole("button", { name: "Mark it won" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".crm-toast")).toHaveText("Spec: to win is won. £6,000 booked.");
  await expect(page.getByTestId("zone-won")).toHaveText("3 · £34,400");
  await expect(page.getByTestId("board-count")).toHaveText("6");
  await expect(page.getByTestId("board-weighted")).toHaveText("£95,740");

  // What the server holds: each closed today, zero days open, locked.
  const lost = await dealNamed(context.request, data, "Spec: to lose");
  const won = await dealNamed(context.request, data, "Spec: to win");
  expect([lost.state, lost["closed_on"], Number(lost["cycle_days"]), lost["close_note"]]).toEqual(["lost", "2026-07-28", 0, "Ask again in the spring"]);
  expect([won.state, won["closed_on"], Number(won["cycle_days"])]).toEqual(["won", "2026-07-28", 0]);
  expect((await context.request.patch(data("deals", `/${String(won.id)}`), { data: { values: { name: "Spec: renamed after closing" } }, headers })).status()).toBeGreaterThanOrEqual(400);

  // And on Closed: the two newest rows, and her figures with them in.
  await page.getByRole("link", { name: "See them all" }).click();
  const list = page.locator(".crm-closed-row");
  await expect(list).toHaveCount(10);
  await expect(list.filter({ hasText: "Spec: to lose" })).toContainText("Lost at Qualified · Budget pulled · “Ask again in the spring”");
  await expect(list.filter({ hasText: "Spec: to win" })).toContainText("Won Jul 28, 2026");
  await expect(list.filter({ hasText: "Spec: to win" })).toContainText("0 days");
  await expect(page.locator(".crm-stat").first().locator(".crm-stat-value")).toHaveText("£51,800");
  expect(problems).toEqual([]);
  await picture(page, "3-dana-closed-after");
});

test("the server refuses a loss with no reason, a second close, and a close by somebody whose deal it is not", async ({ as, api, data }) => {
  const dana = (await as("dana")).request;
  const headers = await csrf(dana);
  const stages = await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const me = ((await (await dana.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const made = await dana.post(data("deals"), { data: { values: { name: "Spec: refusals", company_id: 1, owner_id: me, stage_id: stages[0]!.id, typed_amount: 100 } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  const act = (who: typeof dana, action: string, body: unknown, with_: Record<string, string>) => who.post(data("deals", `/${String(id)}/actions/${action}`), { data: body, headers: with_ });

  // Lost with no reason: refused, and the deal is still open.
  expect((await act(dana, "mark-lost", { from: "open" }, headers)).status()).toBeGreaterThanOrEqual(400);
  expect((await dealNamed(dana, data, "Spec: refusals")).state).toBe("open");
  // Another rep, who does not reach the deal: not there for her. The account manager and Read-only: no such right.
  const sam = await api("sam");
  expect([404, 403]).toContain((await act(sam, "mark-won", { from: "open" }, await csrf(sam))).status());
  const hugo = await api("hugo");
  expect([404, 403]).toContain((await act(hugo, "mark-won", { from: "open" }, await csrf(hugo))).status());
  // Won once; a second press from "open" is refused: it is no longer open.
  expect((await act(dana, "mark-won", { from: "open" }, headers)).status()).toBe(200);
  expect((await act(dana, "mark-won", { from: "open" }, headers)).status()).toBe(409);
  // The account manager starts no deal.
  expect((await hugo.post(data("deals"), { data: { values: { name: "Spec: not his", company_id: 1, owner_id: me, stage_id: stages[0]!.id, typed_amount: 1 } }, headers: await csrf(hugo) })).status()).toBe(403);
});

test("the sheet keeps the keyboard, closes on Escape and gives the focus back; at 390 wide it fills the screen", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  await page.goto(`${STAFF}pipeline`);
  const opener = page.getByRole("button", { name: /New deal/ });
  await opener.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Start a deal" });
  await expect(sheet).toBeVisible();
  // Shift+Tab from the first field goes round to the last button, not out to the page.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  // N typed into a field is a letter, not a second sheet.
  await sheet.getByLabel("What is the work?").fill("n");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();

  const narrow = await (await as("dana", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await narrow.goto(`${STAFF}pipeline`);
  await narrow.getByRole("button", { name: /New deal/ }).click();
  await expect(narrow.getByRole("dialog", { name: "Start a deal" })).toBeVisible();
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "4-dana-new-deal-390-dark");
});
