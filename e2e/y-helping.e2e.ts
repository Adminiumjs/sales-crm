/**
 * Helping on a colleague's deal (ruling 1d, owner 2026-10-25): a rep listed on
 * a deal she does not own ("Also on this deal") reads the deal and everything
 * on it, and comments. Its owner makes the changes, and so does whoever
 * covers for the owner. The screens draw a helper no control that changes the
 * deal, and say so where she would look for one: the room, Jump in the room,
 * the call notes, her board's card and its look, the quote, the quotes list,
 * a visit's booking.
 *
 * Priya helps on a deal of Dana's made here ("Helping spec: …", not "Spec: ", which other specs' clean-up takes); Sam covers
 * Dana for three days from today; Dana herself keeps every control. The
 * deal is retired at the end as the deal room's specs retire theirs (closed
 * as lost and handed to the install's owner), its draft quote removed first.
 *
 * THE FILE'S NAME PUTS IT NEAR THE END, after the specs that count the year's
 * losses, as `y-deal-room.e2e.ts`.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { card, cardsIn, column, csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { me, room as freshMinute } from "./p12-helpers.ts";

const NAME = "Helping spec: Dana's deal";

interface Stage {
  id: number;
  label: string;
  odds: number | string;
}

/** Dana's deal at Proposal (where the quotes list asks for a quote), Priya listed on it; and the day the listing was made, the business's today. */
async function makeDeal(dana: APIRequestContext, data: Data, priyaId: string): Promise<{ id: number; today: string; stages: Stage[] }> {
  const headers = await csrf(dana);
  const stages = await rows<Stage>(dana, data, "stages", undefined, "&order=position");
  const proposal = stages.find((stage) => Number(stage.odds) >= 0.5)!;
  const ines = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Ines Vaughan" }))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name: NAME, company_id: ines.company_id, contact_id: ines.id, owner_id: await me(dana), stage_id: proposal.id, typed_amount: 6400, expected_close: "2026-09-30" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  const listed = await dana.post(data("deal_members"), { data: { values: { deal_id: id, user_id: priyaId } }, headers });
  expect(listed.status(), await listed.text()).toBe(201);
  const since = ((await listed.json()) as { data: { since: string } }).data.since;
  return { id, today: since.slice(0, 10), stages };
}

/** The deal out of every later figure: its draft quote removed, handed to the install's owner and closed as lost (as `y-deal-room.e2e.ts`). */
async function retire(api: (person: string) => Promise<APIRequestContext>, data: Data): Promise<void> {
  const admin = await api("tessa");
  const headers = await csrf(admin);
  const owner = await me(await api("owner"));
  const reason = (await rows<{ id: number }>(admin, data, "lost_reasons", undefined, "&order=position"))[0]!;
  for (const deal of await rows<{ id: number; owner_id: string }>(admin, data, "deals", { and: [{ column: "name", op: "eq", value: NAME }, { column: "state", op: "eq", value: "open" }] })) {
    for (const quote of await rows<{ id: number }>(admin, data, "quotes", { column: "deal_id", op: "eq", value: deal.id })) {
      for (const line of await rows<{ id: number }>(admin, data, "quote_lines", { column: "document_id", op: "eq", value: quote.id })) {
        expect((await admin.delete(data("quote_lines", `/${String(line.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
      }
      expect((await admin.delete(data("quotes", `/${String(quote.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
    for (const step of await rows<{ id: number }>(admin, data, "follow_ups", { column: "deal_id", op: "eq", value: deal.id })) {
      expect((await admin.delete(data("follow_ups", `/${String(step.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
    if (deal.owner_id !== owner) expect((await admin.post(data("deals", `/${String(deal.id)}/actions/hand-over`), { data: { from: "open", values: { owner_id: owner } }, headers })).status()).toBe(200);
    expect((await admin.post(data("deals", `/${String(deal.id)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id } }, headers })).status()).toBe(200);
  }
}

const jump = (page: Page) => page.getByRole("dialog", { name: "Jump" });
/** What Jump offers in a deal's room that changes it or logs on it. */
const roomActions = (page: Page) => jump(page).getByRole("group", { name: "Actions", exact: true }).getByRole("option", { name: /Edit the amount|Close this deal|Call notes/ });
const noSideways = async (page: Page): Promise<void> => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test("a rep helping on a colleague's deal reads it all and comments; nothing that changes it is drawn, wherever she looks", async ({ as, api, data }) => {
  const priyaContext = await as("priya");
  const priya = priyaContext.request;
  const dana = await api("dana");
  const priyaId = await me(priya);
  const deal = await makeDeal(dana, data, priyaId);
  try {
    await freshMinute(priya, data, 150);
    const page = await priyaContext.newPage();
    const problems = watch(page);

    // THE QUOTES LIST: the deal waits for a quote, and Dana starts it.
    await page.goto(`${STAFF}quotes`);
    const bare = page.locator(`.crm-bare-row[data-deal="${String(deal.id)}"]`);
    await expect(bare).toContainText(NAME);
    await expect(bare.getByTestId("bare-helping")).toHaveText("Dana starts its quote");
    await expect(bare.getByRole("button")).toHaveCount(0);

    // THE ROOM: said where the controls would be, and none of them drawn.
    await page.goto(`${STAFF}deals/${String(deal.id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
    await expect(page.getByTestId("room-helping")).toHaveText("You’re helping on this deal: Dana makes the changes. You can read all of it and comment.");
    await expect(page.locator(".crm-room-steps .crm-room-step")).not.toHaveCount(0);
    await expect(page.locator(".crm-room-steps button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Change the amount/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close: won or lost…" })).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Log it" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Call notes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start a quote" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Comments/ })).toBeVisible();
    // Jump in her room offers nothing the room does not: no amount, no close, no call notes.
    await page.keyboard.press("Control+k");
    await expect(jump(page)).toBeVisible();
    await expect(roomActions(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    // `E` opens no amount field either.
    await page.keyboard.press("e");
    await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveCount(0);

    // THE CALL NOTES, by their address: where the deal was left, and no notes box.
    await page.goto(`${STAFF}deals/${String(deal.id)}/call`);
    await expect(page.getByTestId("call-helping")).toHaveText("You’re helping on this deal: Dana logs its calls. Say what you know in its comments.");
    await expect(page.getByRole("textbox", { name: "Notes from the call" })).toHaveCount(0);

    // THE COMMENTS are hers: a thread of her own, which she settles.
    const headers = await csrf(priya);
    const said = await priya.post(data("comments"), { data: { values: { deal_id: deal.id, text: "Spec: their facilities lead knows us." } }, headers });
    expect(said.status(), await said.text()).toBe(201);
    const thread = ((await said.json()) as { data: { id: number } }).data.id;
    await page.goto(`${STAFF}deals/${String(deal.id)}/comments`);
    const hers = page.locator(`[data-thread="${String(thread)}"]`);
    await expect(hers).toContainText("Spec: their facilities lead knows us.");
    await hers.getByRole("button", { name: "Settle it" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Settled.");
    // Put away until "Show settled", and settled by her.
    await expect(hers).toHaveCount(0);
    await page.getByRole("button", { name: /Show settled/ }).click();
    await expect(hers.getByTestId("cmt-settled")).toHaveText("Settled by Priya Raman");

    // HER BOARD: the card is marked, does not move, and opens to read.
    await page.goto(`${STAFF}pipeline`);
    const proposal = deal.stages.find((stage) => Number(stage.odds) >= 0.5)!;
    const qualified = deal.stages[deal.stages.indexOf(proposal) - 1]!;
    const mine = card(page, NAME);
    await expect(mine).toBeVisible();
    await expect(column(page, proposal.id)).toContainText("helping");
    await expect(page.getByTestId("board-helping")).toHaveText("A deal you’re helping on stays where its owner puts it: open it to read it and comment.");
    // By keyboard: Enter opens it, it is not picked up.
    await mine.focus();
    await page.keyboard.press("Enter");
    await expect(mine).not.toHaveAttribute("aria-grabbed", "true");
    const look = page.getByRole("dialog", { name: NAME });
    await expect(look).toBeVisible();
    await expect(look.getByTestId("look-helping")).toHaveText("You’re helping on this deal: Dana makes the changes. You can read all of it and comment.");
    await expect(look.getByRole("button", { name: "Close: won or lost…" })).toHaveCount(0);
    await expect(look.getByRole("link", { name: "Book a visit" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // By mouse: dragged to Qualified, it stays at Proposal, and so does the deal.
    const from = (await mine.boundingBox())!;
    const to = (await column(page, qualified.id).locator("[data-board-cell]").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByRole("dialog", { name: NAME })).toHaveCount(0);
    expect(await cardsIn(page, proposal.id)).toContain(NAME);
    expect(await cardsIn(page, qualified.id)).not.toContain(NAME);
    expect((await rows<{ stage_id: number }>(dana, data, "deals", { column: "id", op: "eq", value: deal.id }))[0]!.stage_id).toBe(proposal.id);

    // A VISIT'S BOOKING, by the look's own address: the deal is not offered, and she is told why.
    await page.goto(`${STAFF}visits/book/${String(deal.id)}`);
    const booking = page.getByRole("dialog", { name: "Book a site visit" });
    await expect(booking).toBeVisible();
    await expect(booking.getByLabel("Deal")).toHaveValue("");
    await expect(booking.getByLabel("Deal").locator(`option[value="${String(deal.id)}"]`)).toHaveCount(0);
    await expect(booking.getByTestId("bk-helping")).toContainText("you’re helping on");
    await page.keyboard.press("Escape");

    // THE QUOTE Dana makes: Priya reads every line and changes, sends and asks nothing.
    const quote = await dana.post(data("quotes"), { data: { values: { deal_id: deal.id }, children: { quote_lines: [{ values: { description: "Spec: desks", qty: 4, rate: 1600, position: 0 } }] } }, headers: await csrf(dana) });
    expect(quote.status(), await quote.text()).toBe(201);
    const quoteId = ((await quote.json()) as { data: { id: number } }).data.id;
    await page.goto(`${STAFF}quotes/${String(quoteId)}`);
    await expect(page.getByTestId("quote-helping")).toHaveText("You’re helping on this deal: Dana changes and sends its quotes. You can read every version.");
    await expect(page.locator(".crm-lines")).toContainText("Spec: desks");
    await expect(page.locator(".crm-lines input, .crm-lines select, .crm-lines button")).toHaveCount(0);
    await expect(page.locator('[data-panel="send"], [data-panel="ask"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New version" })).toHaveCount(0);
    expect(problems).toEqual([]);

    // DANA, the owner, keeps every control on the same quote and in the same room.
    const danaPage = await (await as("dana")).newPage();
    await danaPage.goto(`${STAFF}quotes/${String(quoteId)}`);
    await expect(danaPage.getByTestId("quote-helping")).toHaveCount(0);
    await expect(danaPage.locator(".crm-lines input").first()).toBeVisible();
    await expect(danaPage.locator('[data-panel="send"], [data-panel="ask"]')).toHaveCount(1);
    await danaPage.goto(`${STAFF}deals/${String(deal.id)}`);
    await expect(danaPage.getByRole("heading", { level: 1 })).toHaveText(NAME);
    await expect(danaPage.getByTestId("room-helping")).toHaveCount(0);
    await expect(danaPage.locator(".crm-room-steps button")).not.toHaveCount(0);
    await expect(danaPage.getByRole("form", { name: "Log it" })).toBeVisible();
    await danaPage.keyboard.press("Control+k");
    await expect(roomActions(danaPage)).toHaveCount(3);
  } finally {
    await retire(api, data);
  }
});

test("whoever covers for the owner works the deal as today; the helper's room in Arabic, right to left, at 390 wide", async ({ as, api, data }) => {
  const dana = await api("dana");
  const priya = await api("priya");
  const deal = await makeDeal(dana, data, await me(priya));
  const ivy = await api("ivy");
  const ivyHeaders = await csrf(ivy);
  let cover: number | null = null;
  try {
    // Ivy has Sam cover Dana for three days from today: Dana's deals are Sam's to work, and nothing says "helping".
    const plus = (days: number): string => new Date(Date.parse(`${deal.today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const made = await ivy.post(data("covers"), { data: { values: { owner_id: await me(dana), cover_id: await me(await api("sam")), starts_on: deal.today, ends_on: plus(2), note: "Spec: Dana is at the fair" } }, headers: ivyHeaders });
    expect(made.status(), await made.text()).toBe(201);
    cover = ((await made.json()) as { data: { id: number } }).data.id;
    const samPage = await (await as("sam")).newPage();
    const problems = watch(samPage);
    await samPage.goto(`${STAFF}deals/${String(deal.id)}`);
    await expect(samPage.getByRole("heading", { level: 1 })).toHaveText(NAME);
    await expect(samPage.getByRole("form", { name: "Log it" })).toBeVisible();
    await expect(samPage.getByTestId("room-helping")).toHaveCount(0);
    await expect(samPage.locator(".crm-room-steps button")).not.toHaveCount(0);
    await expect(samPage.getByRole("button", { name: "Close: won or lost…" })).toBeVisible();
    await samPage.goto(`${STAFF}pipeline`);
    await expect(column(samPage, deal.stages.find((stage) => Number(stage.odds) >= 0.5)!.id)).toContainText("covering for Dana");
    await expect(samPage.getByTestId("board-helping")).toHaveCount(0);
    expect(problems).toEqual([]);

    // Priya, who only helps, in Arabic at 390 wide: the line, right to left, and nothing wider than the screen.
    await inArabic(priya, async () => {
      const page = await (await as("priya", { viewport: { width: 390, height: 844 } })).newPage();
      await page.goto(`${STAFF}deals/${String(deal.id)}`);
      const line = page.getByTestId("room-helping");
      await expect(line).toContainText("أنت تساعد في هذه الصفقة");
      expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
      expect(await line.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
      await expect(page.locator(".crm-room-steps button")).toHaveCount(0);
      await noSideways(page);
    });
  } finally {
    if (cover !== null) expect((await ivy.delete(data("covers", `/${String(cover)}?confirm=true`), { headers: ivyHeaders })).status()).toBeLessThan(300);
    await retire(api, data);
  }
});
