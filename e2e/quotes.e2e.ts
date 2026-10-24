/**
 * P05, Quotes and Approvals (ledger §9 and §27).
 *
 * Nine documents in five families. Q-1002 (d1): version 1 sent at 52,800,
 * valid until Thu 30 Jul; version 2 (Q-1009) at 48,000, 9.1 % under list,
 * approved by Ivy and not sent. Q-1001 (d5): version 1 ran out on 26 Jul;
 * version 2 (Q-1008) at 34,000, 10.5 % under list, waiting. Four requests:
 * one waiting, three decided.
 *
 * The spec makes a deal of its own ("Spec: quoted"), works a quote on it from
 * a first draft to a sent second version, and closes the deal as lost at the
 * end: a sent quote cannot be taken away, and a lost deal is in no open
 * figure the later specs read.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, dealNamed, inArabic, minuteOut, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

const row = (page: Page, family: string) => page.locator(".crm-quote-row").filter({ has: page.locator(".crm-quote-no", { hasText: new RegExp(`^${family}$`) }) });
const quoteNumbered = async (person: APIRequestContext, data: Data, number: string) => (await rows<Record<string, unknown> & { id: number }>(person, data, "quotes", { column: "number", op: "eq", value: number }))[0]!;

test("Dana opens Quotes from her menu: her three families, with what the customer holds", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Quotes" }).click();
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/quotes$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quotes");
  await expect(page.locator(".crm-quote-list").first().locator("a.crm-quote-row")).toHaveCount(3);
  // d1: the newest version is 2, approved at 48,000; the customer holds version 1 at 52,800 until Thu 30 Jul.
  await expect(row(page, "Q-1002")).toContainText("v2 · Approved");
  await expect(row(page, "Q-1002")).toContainText("Fourth-floor desk rows");
  await expect(row(page, "Q-1002").locator(".crm-quote-fig").nth(0)).toContainText("£48,000");
  await expect(row(page, "Q-1002").locator(".crm-quote-fig").nth(1)).toContainText("£52,800");
  await expect(row(page, "Q-1002")).toContainText("v1 · valid until Thu, Jul 30");
  // d9: version 2 was not approved; the customer still holds version 1 at 21,500.
  await expect(row(page, "Q-1005")).toContainText("v2 · Not approved");
  await expect(row(page, "Q-1005").locator(".crm-quote-fig").nth(1)).toContainText("£21,500");
  // No filter by person for a rep.
  await expect(page.getByRole("group", { name: "Whose deals" })).toHaveCount(0);
  // Her deals at Proposal or later with no quote: d6 and d3, at the amount typed.
  const bare = page.locator(".crm-bare .crm-bare-row");
  await expect(bare).toHaveCount(2);
  await expect(bare.filter({ hasText: "Analyst pods, second floor" })).toContainText("£21,600");
  await expect(bare.filter({ hasText: "Records-room lockers" })).toContainText("£16,800");
  expect(problems).toEqual([]);
  await picture(page, "1-dana-quotes");
});

test("the sales manager sees all five families; one ran out, one is waiting on her", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  await page.goto(`${STAFF}quotes`);
  await expect(page.locator(".crm-quote-list").first().locator("a.crm-quote-row")).toHaveCount(5);
  await expect(row(page, "Q-1001")).toContainText("v2 · Waiting for approval");
  await expect(row(page, "Q-1001")).toContainText("Brightloom Foods · Sam");
  await expect(row(page, "Q-1001").locator(".crm-quote-fig").nth(0)).toContainText("£34,000");
  // What the customer holds there ran out on Sunday 26 July.
  await expect(row(page, "Q-1001").locator(".crm-quote-fig").nth(1)).toContainText("£38,000");
  await expect(row(page, "Q-1001")).toContainText("v1 · ran out Sun, Jul 26");
  // d14: version 2 was sent, and withdrew version 1 as it went.
  await expect(row(page, "Q-1004")).toContainText("v2 · Sent");
  await expect(row(page, "Q-1004")).toContainText("v2 · valid until Wed, Aug 19");
  await page.getByRole("group", { name: "Whose deals" }).getByRole("button", { name: "Sam" }).click();
  await expect(page.locator(".crm-quote-list").first().locator("a.crm-quote-row")).toHaveCount(2);
  await picture(page, "2-ivy-quotes");
});

test("one quote: its versions, the approval's line, the figures the server keeps, and an older version read-only", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}quotes`);
  await row(page, "Q-1002").click();
  const v2 = await quoteNumbered(context.request, data, "Q-1009");
  await expect(page).toHaveURL(new RegExp(`/quotes/${String(v2.id)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fourth-floor desk rows");
  await expect(page.getByTestId("quote-state")).toHaveText("Approved");
  const strip = page.getByRole("group", { name: "Versions" }).getByRole("link");
  await expect(strip).toHaveCount(2);
  await expect(strip.nth(0)).toContainText("Version 1");
  await expect(strip.nth(0)).toContainText("£52,800");
  await expect(strip.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("quote-banner")).toHaveText("Approved by Ivy Sandoval · Tue, Jul 28, 08:05, up to 9.1% under list. Not sent yet. The customer still has version 1 at £52,800.");
  // The server's own figures for this version, shown as they are.
  await expect(page.getByTestId("quote-list-value")).toHaveText("£52,800");
  await expect(page.getByTestId("quote-total")).toHaveText("£48,000");
  await expect(page.getByTestId("quote-under")).toHaveText("9.1% under list");
  expect([Number(v2["list_value"]), Number(v2["total"]), Math.round(Number(v2["under_list_pct"]) * 10) / 10, Number(v2["may_send"])]).toEqual([52800, 48000, 9.1, 1]);
  await expect(page.locator("tr[data-line]")).toHaveCount(4);
  await expect(page.getByTestId("quote-customer-has")).toHaveText("Q-1002 · £52,800");
  // Approved, so it may be sent: to Petra, valid thirty days from today, and Q-1002 is withdrawn as it goes.
  const send = page.locator('[data-panel="send"]');
  await expect(send).toContainText("Petra Lindqvist is sent it by e-mail. Sent today, it is valid until Aug 27, 2026. The deal amount becomes £48,000.");
  await expect(send).toContainText("Q-1002, which the customer holds now, is withdrawn as this goes out.");
  await expect(send.getByRole("button", { name: "Send to Petra Lindqvist" })).toBeEnabled();
  await picture(page, "3-dana-quote-approved");

  // Version 1 is what the customer holds: read-only, and it runs out in two days.
  await strip.nth(0).click();
  await expect(page.getByTestId("quote-state")).toHaveText("Sent");
  await expect(page.getByTestId("quote-banner")).toHaveText("Version 1 is read-only. The newest is version 2, approved.");
  await expect(page.locator("tr[data-line] input, tr[data-line] select")).toHaveCount(0);
  await expect(page.locator("[data-panel]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New version" })).toHaveCount(0);
});

test("a quote from first draft to a sent second version: lines, asking, the manager's yes, sending, replacing", async ({ as, api, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const headers = await csrf(dana);
  const me = ((await (await dana.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const stages = await rows<{ id: number; label: string }>(dana, data, "stages", undefined, "&order=position");
  const petra = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Petra Lindqvist" }))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name: "Spec: quoted", company_id: petra.company_id, contact_id: petra.id, owner_id: me, stage_id: stages[2]!.id, typed_amount: 5000 } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const deal = ((await made.json()) as { data: { id: number } }).data.id;

  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}quotes`);

  // START: from "at Proposal or later, with no quote". One line of her own, at the amount typed on the deal.
  await page.locator(".crm-bare-row").filter({ hasText: "Spec: quoted" }).getByRole("button", { name: "Start a quote" }).click();
  await expect(page.locator(".crm-toast")).toContainText("started from the typed amount. It is a draft.");
  await expect(page.getByTestId("quote-state")).toHaveText("Draft");
  const lines = page.locator("tr[data-line]");
  await expect(lines).toHaveCount(1);
  await expect(page.getByTestId("quote-total")).toHaveText("£5,000");
  // A line of her own has no list price, and so the quote needs approval whatever it costs.
  await expect(lines.first()).toContainText("no list price · needs approval");
  await expect(page.getByTestId("quote-under")).toHaveText("1 line with no list price");
  await expect(page.locator('[data-panel="ask"]')).toBeVisible();
  await expect(page.locator('[data-panel="send"]')).toHaveCount(0);

  // The line picks an item of the price list: its name and list price come with it, and are not typed.
  await lines.first().getByLabel("From the price list").selectOption({ label: "Height-adjustable supervisor station" });
  await expect(lines.first().locator(".crm-line-list")).toHaveText("£1,340");
  await expect(page.getByTestId("quote-total")).toHaveText("£1,340");
  await expect(page.getByTestId("quote-under")).toHaveText("At list");
  // Three of them: the total is the server's, read back after the save.
  await lines.first().getByLabel("Quantity").fill("3");
  await lines.first().getByLabel("Quantity").blur();
  await expect(page.getByTestId("quote-total")).toHaveText("£4,020");
  await expect(page.getByTestId("quote-list-value")).toHaveText("£4,020");

  // A second line, moved above the first, then taken out again.
  await page.getByRole("button", { name: "Add a line" }).click();
  await expect(lines).toHaveCount(2);
  await lines.nth(1).getByLabel("From the price list").selectOption({ label: "Ventilation retrofit kit" });
  await expect(page.getByTestId("quote-total")).toHaveText("£4,210");
  await page.getByRole("button", { name: "Move “Ventilation retrofit kit” up" }).click();
  await expect(lines.first().locator('input[aria-label="Description"]')).toHaveValue("Ventilation retrofit kit");
  await page.getByRole("button", { name: "Remove “Ventilation retrofit kit”" }).click();
  await expect(lines).toHaveCount(1);
  await expect(page.getByTestId("quote-total")).toHaveText("£4,020");

  // At list, with a contact: it may be sent as it is. Notes first.
  await page.getByRole("textbox", { name: "Notes for the customer" }).fill("Delivered to the fourth floor.");
  await page.getByRole("textbox", { name: "Notes for the customer" }).blur();
  await expect(page.locator(".crm-toast")).toHaveText("Notes saved.");
  await expect(page.locator('[data-panel="send"]')).toContainText("The deal amount becomes £4,020.");

  // CUT THE PRICE: 1,340 to 1,200 is 10.45 % under list as the server keeps it, shown to one place. It no longer goes without a yes.
  await lines.first().getByLabel("Unit price").fill("1200");
  await lines.first().getByLabel("Unit price").blur();
  await expect(page.getByTestId("quote-total")).toHaveText("£3,600");
  await expect(page.getByTestId("quote-under")).toHaveText("10.5% under list");
  await expect(page.getByTestId("quote-under")).toHaveAttribute("data-over", "1");
  await expect(page.locator('[data-panel="send"]')).toHaveCount(0);
  const ask = page.locator('[data-panel="ask"]');
  await expect(ask.getByRole("button", { name: "Ask for approval" })).toBeDisabled();
  await ask.getByLabel("Why this price").fill("They take three now and nine in the autumn.");
  await ask.getByRole("button", { name: "Ask for approval" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Asked. It is in Approvals.");
  await expect(page.getByTestId("quote-state")).toHaveText("Waiting for approval");
  // Waiting: nothing on it can be changed.
  await expect(page.locator("tr[data-line] input, tr[data-line] select")).toHaveCount(0);
  await expect(page.locator('[data-panel="asked"]')).toContainText("They take three now and nine in the autumn.");
  await picture(page, "4-dana-quote-waiting");

  // THE MANAGER, in her own session: the request is in Approvals with the server's figures; she approves with a line of why.
  const ivyPage = await (await as("ivy")).newPage();
  await ivyPage.goto(`${STAFF}approvals`);
  const card = ivyPage.locator(".crm-approval").filter({ hasText: "Spec: quoted" });
  await expect(card).toContainText("Waiting on a decision");
  await expect(card.locator(".crm-approval-figs")).toContainText("£4,020");
  await expect(card.locator(".crm-approval-figs")).toContainText("£3,600");
  await expect(card.getByTestId("approval-under")).toHaveText("10.5% under list");
  await expect(card).toContainText("They take three now and nine in the autumn.");
  await card.getByRole("button", { name: "Approve…" }).click();
  await expect(card.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await card.getByLabel("Why approve £3,600?").fill("Volume in the autumn.");
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(ivyPage.locator(".crm-toast")).toHaveText("Approved. Dana can send it now.");
  await picture(ivyPage, "5-ivy-approved");

  // Dana's open page follows without a reload (two people signed in), and the quote may now be sent.
  await expect(page.getByTestId("quote-state")).toHaveText("Approved");
  await expect(page.getByTestId("quote-banner")).toContainText("Approved by Ivy Sandoval");
  await page.locator('[data-panel="send"]').getByRole("button", { name: "Send to Petra Lindqvist" }).click();
  await expect(page.locator(".crm-toast")).toContainText("sent to Petra. The deal is now £3,600.");
  await expect(page.getByTestId("quote-state")).toHaveText("Sent");
  await expect(page.getByTestId("quote-customer-has")).toContainText("£3,600");

  // What the server holds: sent, valid thirty days, to Petra's address as it is today, and the deal stands at the quote.
  const first = (await rows<Record<string, unknown> & { id: number }>(dana, data, "quotes", { column: "deal_id", op: "eq", value: deal }))[0]!;
  expect([first["status"], first["valid_until"], first["sent_to_name"], first["approval"], Number(first["approved_pct"])]).toEqual(["sent", "2026-08-27", "Petra Lindqvist", "approved", 10.45]);
  expect(Number((await dealNamed(dana, data, "Spec: quoted"))["amount"])).toBe(3600);

  // A NEW VERSION: a copy of the sent one, a draft, which names the one it replaces.
  await page.getByRole("button", { name: "New version" }).click();
  await expect(page.locator(".crm-toast")).toContainText("Version 2 started as");
  await expect(page.getByTestId("quote-state")).toHaveText("Draft");
  await expect(page.getByRole("group", { name: "Versions" }).getByRole("link")).toHaveCount(2);
  await expect(lines).toHaveCount(1);
  await expect(page.getByTestId("quote-total")).toHaveText("£3,600");
  // Put back to list: it goes with no asking, and sending it withdraws version 1 in the same save.
  await lines.first().getByLabel("Unit price").fill("1340");
  await lines.first().getByLabel("Unit price").blur();
  await expect(page.getByTestId("quote-under")).toHaveText("At list");
  await expect(page.locator('[data-panel="send"]')).toContainText("is withdrawn as this goes out.");
  await page.locator('[data-panel="send"]').getByRole("button", { name: "Send to Petra Lindqvist" }).click();
  await expect(page.locator(".crm-toast")).toContainText("The deal is now £4,020.");
  const strip = page.getByRole("group", { name: "Versions" }).getByRole("link");
  await expect(strip.nth(0)).toContainText("Sent · replaced");
  await expect(strip.nth(1)).toContainText("Sent");
  const both = await rows<{ version: number; status: string }>(dana, data, "quotes", { column: "deal_id", op: "eq", value: deal }, "&order=version");
  expect(both.map((quote) => [quote.version, quote.status])).toEqual([[1, "withdrawn"], [2, "sent"]]);
  expect(Number((await dealNamed(dana, data, "Spec: quoted"))["amount"])).toBe(4020);
  await strip.nth(0).click();
  await expect(page.getByTestId("quote-banner")).toHaveText("Version 1 is read-only. The newest is version 2, sent.");
  expect(problems).toEqual([]);
  await picture(page, "6-dana-quote-replaced");

  // The deal leaves the open figures: lost, by its own button.
  const reason = (await rows<{ id: number }>(dana, data, "lost_reasons"))[0]!;
  expect((await dana.post(data("deals", `/${String(deal)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id } }, headers })).status()).toBe(200);
  void api;
});

test("what Quotes shows and does is the server's to refuse: Read-only, another rep, the marketer, a rep's own approval", async ({ as, api, data }) => {
  // Read-only reads every quote and can change none: no field, no button, and the server says no to each write.
  const grace = await as("grace");
  const page = await grace.newPage();
  await page.goto(`${STAFF}quotes`);
  await expect(page.locator(".crm-quote-list").first().locator("a.crm-quote-row").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a quote" })).toHaveCount(0);
  const draft = await quoteNumbered(grace.request, data, "Q-1007");
  await page.goto(`${STAFF}quotes/${String(draft.id)}`);
  await expect(page.getByTestId("quote-state")).toHaveText("Not approved");
  await expect(page.locator("tr[data-line] input, tr[data-line] select")).toHaveCount(0);
  await expect(page.locator("[data-panel]")).toHaveCount(0);
  const headers = await csrf(grace.request);
  const line = (await rows<{ id: number }>(grace.request, data, "quote_lines", { column: "document_id", op: "eq", value: draft.id }))[0]!;
  expect((await grace.request.patch(data("quote_lines", `/${String(line.id)}`), { data: { values: { rate: 1 } }, headers })).status()).toBe(403);
  expect((await grace.request.patch(data("quotes", `/${String(draft.id)}`), { data: { values: { notes: "hers" } }, headers })).status()).toBe(403);
  expect((await grace.request.post(data("quotes"), { data: { values: { deal_id: draft["deal_id"] } }, headers })).status()).toBe(403);
  // Her Approvals page lists the requests and offers no decision; the server refuses hers too.
  await page.goto(`${STAFF}approvals`);
  const waiting = await quoteNumbered(grace.request, data, "Q-1008");
  await expect(page.locator(".crm-approval").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve…" })).toHaveCount(0);
  expect((await grace.request.post(data("quotes", `/${String(waiting.id)}/actions/approve`), { data: { from: "draft", values: { decision_note: "no" } }, headers })).status()).toBe(403);

  // Sam does not reach Dana's deal: her quote is not there for him, in the list, by its address or by a direct call.
  const sam = await as("sam");
  const samPage = await sam.newPage();
  await samPage.goto(`${STAFF}quotes/${String(draft.id)}`);
  await expect(samPage.getByText("No quote to open")).toBeVisible();
  expect((await sam.request.get(data("quotes", `/${String(draft.id)}`))).status()).toBe(404);
  expect((await sam.request.patch(data("quote_lines", `/${String(line.id)}`), { data: { values: { rate: 1 } }, headers: await csrf(sam.request) })).status()).toBeGreaterThanOrEqual(403);

  // A rep does not approve a discount, her own or anybody's: not by the button, not by writing the column.
  const dana = await api("dana");
  const danaHeaders = await csrf(dana);
  expect((await dana.post(data("quotes", `/${String(draft.id)}/actions/approve`), { data: { from: "draft", values: { decision_note: "mine" } }, headers: danaHeaders })).status()).toBe(403);
  expect((await dana.patch(data("quotes", `/${String(draft.id)}`), { data: { values: { approval: "approved" } }, headers: danaHeaders })).status()).toBe(403);
  // No new quote on a closed deal (plan 68 R1a): the server refuses Dana's direct create on her won deal, lines and all.
  const wonDeal = (await rows<{ id: number }>(dana, data, "deals", { column: "state", op: "eq", value: "won" }))[0]!;
  const onWon = await dana.post(data("quotes"), { data: { values: { deal_id: wonDeal.id }, children: { quote_lines: [{ values: { description: "Late", qty: 1, rate: 1 } }] } }, headers: danaHeaders });
  expect(onWon.status()).toBe(409);
  expect(((await onWon.json()) as { error: { code: string } }).error.code).toBe("STATE_MOVE_REFUSED");
  // Reps have no Approvals page.
  const danaPage = await (await as("dana")).newPage();
  await danaPage.goto(`${STAFF}approvals`);
  await expect(danaPage.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Approvals" })).toHaveCount(0);

  // The marketer reads no quote at all; the account manager only the quotes of a deal he is on (P23), and on the sample he
  // is on none: the server answers him none. Neither has Quotes.
  expect((await (await api("lena")).get(data("quotes", "?limit=5"))).status(), "lena").toBe(403);
  expect(await rows(await api("hugo"), data, "quotes"), "hugo").toEqual([]);
  for (const person of ["lena", "hugo"]) {
    const theirs = await (await as(person)).newPage();
    await theirs.goto(`${STAFF}quotes`);
    await expect(theirs.getByRole("heading", { level: 1 }), person).toHaveText("This page is not part of your role");
  }
});

test("Approvals: the four requests, a decline with its line, a question that lands on the deal, and no deciding one's own", async ({ as, data }) => {
  const context = await as("ivy");
  const ivy = context.request;
  const page = await context.newPage();
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Approvals" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Approvals");
  const filters = page.getByRole("group", { name: "Which requests" }).getByRole("button");
  const asked = await rows<{ id: number; approval: string; status: string }>(ivy, data, "quotes", { column: "asked_at", op: "not_null" });
  const waiting = asked.filter((quote) => quote.status === "draft" && quote.approval === "asked").length;
  // Each count is the server's list, counted (the sample's four, and whatever an earlier spec asked).
  await expect(filters.nth(0)).toHaveText(`Waiting${String(waiting)}`);
  await expect(filters.nth(2)).toHaveText(`Everything${String(asked.length)}`);
  const sams = page.locator(".crm-approval").filter({ hasText: "Showroom refit, phase one" });
  await expect(sams).toContainText("Brightloom Foods · Sam · Proposal · closes Fri, Sep 11");
  await expect(sams.locator(".crm-approval-figs")).toContainText("£38,000");
  await expect(sams.locator(".crm-approval-figs")).toContainText("£34,000");
  await expect(sams.getByTestId("approval-under")).toHaveText("10.5% under list");
  await expect(sams).toContainText("Q-1001 · Version 2 · Q-1008 · not sent");
  await expect(sams).toContainText("asked by Sam · Fri, Jul 24, 10:20");
  await picture(page, "7-ivy-approvals");

  // "Ask for more" is a comment on the deal that mentions Sam.
  await sams.getByRole("button", { name: "Ask for more…" }).click();
  await expect(sams.getByLabel("Your question to Sam")).toHaveValue("What else is on the table here?");
  await sams.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Sam has the question.");
  const q8 = await quoteNumbered(ivy, data, "Q-1008");
  const comments = await rows<{ text: string; author_id: string }>(ivy, data, "comments", { column: "deal_id", op: "eq", value: q8["deal_id"] }, "&order=id.desc");
  expect(comments[0]!.text).toMatch(/^@\[Sam Okonjo\]\(usr_[^)]+\) What else is on the table here\?$/);
  // Still waiting: a question decides nothing.
  expect((await quoteNumbered(ivy, data, "Q-1008"))["approval"]).toBe("asked");

  // Decided requests keep who decided and why.
  await filters.nth(1).click();
  const d1 = page.locator(".crm-approval").filter({ hasText: "Fourth-floor desk rows" });
  await expect(d1).toContainText("Approved by Ivy Sandoval · Tue, Jul 28, 08:05");
  await expect(d1.getByRole("button", { name: "Approve…" })).toHaveCount(0);
  const d9 = page.locator(".crm-approval").filter({ hasText: "Quiet-room pods" });
  await expect(d9).toContainText("Declined by Ivy Sandoval · Wed, Jul 22, 15:40");

  // Her own request is not hers to decide here: the card says who decides.
  const me = ((await (await ivy.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const headers = await csrf(ivy);
  const stages = await rows<{ id: number }>(ivy, data, "stages", undefined, "&order=position");
  const petra = (await rows<{ id: number; company_id: number }>(ivy, data, "contacts", { column: "name", op: "eq", value: "Petra Lindqvist" }))[0]!;
  const made = await ivy.post(data("deals"), { data: { values: { name: "Spec: the manager's own", company_id: petra.company_id, contact_id: petra.id, owner_id: me, stage_id: stages[2]!.id, typed_amount: 900 } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const deal = ((await made.json()) as { data: { id: number } }).data.id;
  const quote = await ivy.post(data("quotes"), { data: { values: { deal_id: deal, sent_to_contact_id: petra.id } }, headers });
  expect(quote.status(), await quote.text()).toBe(201);
  const quoteId = ((await quote.json()) as { data: { id: number } }).data.id;
  expect((await ivy.post(data("quote_lines"), { data: { values: { document_id: quoteId, position: 0, description: "A line of her own", qty: 1, rate: 900 } }, headers })).status()).toBe(201);
  expect((await ivy.post(data("quotes", `/${String(quoteId)}/actions/ask-approval`), { data: { from: "draft", values: { ask_reason: "My own deal" } }, headers })).status()).toBe(200);
  await filters.nth(0).click();
  const own = page.locator(".crm-approval").filter({ hasText: "Spec: the manager's own" });
  await expect(own).toContainText("This is your own request.");
  await expect(own.getByRole("button", { name: "Approve…" })).toHaveCount(0);
  // The CRM admin decides it: declined, with a line, and the deal stays where it was.
  const tessa = await (await as("tessa")).newPage();
  await tessa.goto(`${STAFF}approvals`);
  const hers = tessa.locator(".crm-approval").filter({ hasText: "Spec: the manager's own" });
  await hers.getByRole("button", { name: "Decline…" }).click();
  await expect(hers).toContainText("The deal stays at £900. Ivy is told, with your line.");
  await hers.getByLabel("Why decline it?").fill("No list price, no sale.");
  await hers.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(tessa.locator(".crm-toast")).toHaveText("Declined. The deal stays as it is.");
  const now = (await rows<Record<string, unknown>>(ivy, data, "quotes", { column: "id", op: "eq", value: quoteId }))[0]!;
  expect([now["approval"], now["decision_note"], now["status"]]).toEqual(["refused", "No list price, no sale.", "draft"]);

  // "REOPEN IT" (plan 68 S2). Ivy's own request, declined: not hers to reopen (she asked it, and the deal is hers), as the
  // server holds; another rep's declined draft (Q-1007, on Dana's Quiet-room pods) is offered to her.
  await page.reload();
  await filters.nth(1).click();
  const ownDecided = page.locator(".crm-approval").filter({ hasText: "Spec: the manager's own" });
  await expect(ownDecided).toContainText("Declined by Tessa Marlow");
  await expect(ownDecided.getByRole("button", { name: "Reopen it" })).toHaveCount(0);
  await expect(page.locator(".crm-approval").filter({ hasText: "Quiet-room pods" }).getByRole("button", { name: "Reopen it" })).toBeVisible();
  // A sent one (d1's) is not reopened: the customer holds it.
  await expect(page.locator(".crm-approval").filter({ hasText: "Fourth-floor desk rows" }).getByRole("button", { name: "Reopen it" })).toHaveCount(0);
  // The CRM admin reopens Ivy's, with a note: back to waiting, still Ivy's request, the decline kept in the history.
  await tessa.reload();
  await tessa.getByRole("group", { name: "Which requests" }).getByRole("button").nth(1).click();
  const reopen = tessa.locator(".crm-approval").filter({ hasText: "Spec: the manager's own" });
  await reopen.getByRole("button", { name: "Reopen it" }).click();
  await expect(reopen).toContainText("It goes back to Waiting with your note, still Ivy’s request. The decision before it stays in the quote’s history.");
  await reopen.getByLabel("Why are you reopening this decision?").fill("Spec: the list price moved");
  await reopen.getByRole("button", { name: "Reopen the decision" }).click();
  await expect(tessa.locator(".crm-toast")).toHaveText("Back in the queue.");
  const back = tessa.locator(".crm-approval").filter({ hasText: "Spec: the manager's own" });
  await expect(back.getByTestId("approval-reopened")).toContainText("Reopened after a decision on");
  await expect(back.getByTestId("approval-reopened")).toContainText("“Spec: the list price moved”");
  await expect(back).toContainText("asked by Ivy");
  const reopened = (await rows<Record<string, unknown>>(ivy, data, "quotes", { column: "id", op: "eq", value: quoteId }))[0]!;
  expect([reopened["approval"], reopened["asked_by_id"], reopened["decision_note"]]).toEqual(["asked", me, "Spec: the list price moved"]);
  const history = await ivy.get(data("quotes", `/${String(quoteId)}/history?limit=50`));
  expect(history.status()).toBe(200);
  expect(await history.text()).toContain("No list price, no sale.");
  // Still Ivy's own: no decision offered to her, and the server refuses one by a direct call.
  await page.reload();
  await expect(own).toContainText("This is your own request.");
  await expect(own.getByRole("button", { name: "Approve…" })).toHaveCount(0);
  expect((await ivy.post(data("quotes", `/${String(quoteId)}/actions/approve`), { data: { from: "draft", values: { decision_note: "Mine" } }, headers })).status()).toBe(403);

  const reason = (await rows<{ id: number }>(ivy, data, "lost_reasons"))[0]!;
  expect((await ivy.post(data("deals", `/${String(deal)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id } }, headers })).status()).toBe(200);
});

test("Quotes at 390 wide in the dark, and in Arabic right to left", async ({ as, data }) => {
  // The specs above worked a quote as Dana, save after save: her minute of requests is let run out before she opens one more.
  await minuteOut();
  const context = await as("dana", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const narrow = await context.newPage();
  await narrow.goto(`${STAFF}quotes`);
  await expect(narrow.locator("a.crm-quote-row").first()).toBeVisible();
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const v2 = await quoteNumbered(context.request, data, "Q-1009");
  await narrow.goto(`${STAFF}quotes/${String(v2.id)}`);
  await expect(narrow.getByTestId("quote-total")).toHaveText("£48,000");
  // The lines scroll inside their own box; the page does not scroll sideways.
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "8-dana-quote-390-dark");

  const priya = await as("priya");
  await inArabic(priya.request, async () => {
    const page = await priya.newPage();
    await page.goto(`${STAFF}quotes`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("عروض الأسعار");
    expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
    await picture(page, "9-priya-quotes-arabic");
  });
});

// The next file's first spec is Dana's too.
test.afterAll(async () => {
  await minuteOut();
});
