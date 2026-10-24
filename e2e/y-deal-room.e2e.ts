/**
 * P04, the Deal room (ledger §3, §8, §15, §29).
 *
 * d1 "Fourth-floor desk rows" (Nordwind Logistics, Dana): 52,800 from Q-1002
 * version 1; weighted 39,600 at 75 %; 14 days in Negotiation (warm); opened
 * Tue 12 May, expected close Fri 14 Aug; main contact Petra Lindqvist; three
 * things logged and four changes of stage, so seven lines; two threads, one
 * open; two open follow-ups.
 *
 * Whatever a spec changes, it changes on a deal of its own ("Room spec: …"),
 * which the CRM admin closes and hands out of the team at the end: the
 * sample's deals keep the ledger's figures for the specs that follow.
 *
 * THE FILE'S NAME PUTS IT NEAR THE END. Its deals cannot be taken away (a deal
 * that has lived a minute holds rows no role may remove), so they end lost and
 * handed to the install's owner; the specs before it count the year's losses.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, dealNamed, inArabic, minuteOut, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";
import { room as freshMinute } from "./p12-helpers.ts";

interface Made {
  id: number;
  me: string;
  stages: { id: number; label: string }[];
}

/** A deal of Dana's own for a spec to work on: Cobalt Legal, at Discovery, 4,000 typed. */
async function makeDeal(dana: APIRequestContext, data: Data, name: string, more: Record<string, unknown> = {}): Promise<Made> {
  const headers = await csrf(dana);
  const me = ((await (await dana.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const stages = await rows<{ id: number; label: string }>(dana, data, "stages", undefined, "&order=position");
  const ines = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Ines Vaughan" }))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name, company_id: ines.company_id, contact_id: ines.id, owner_id: me, stage_id: stages[0]!.id, typed_amount: 4000, expected_close: "2026-09-30", ...more } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  return { id: ((await made.json()) as { data: { id: number } }).data.id, me, stages };
}

/**
 * Put a spec's deals out of every figure a later spec reads, as the CRM admin: their open follow-ups removed, the deal handed to the install's owner (no rep, in nobody's team) and closed as lost.
 *
 * They are not deleted. A deal that has lived a minute carries rows only the app's rules write (its mark, its changes of stage), which no role removes; and on SQLite the next deal made would take the removed one's number, with its history. So they stay, closed, where no board, queue or team figure counts them. Their name does not start with "Spec: ", which the other specs' own clean-up takes away.
 */
async function retire(api: (person: string) => Promise<APIRequestContext>, data: Data, startsWith: string): Promise<void> {
  const admin = await api("tessa");
  const headers = await csrf(admin);
  const owner = await userId(await api("owner"));
  const reason = (await rows<{ id: number }>(admin, data, "lost_reasons", undefined, "&order=position"))[0]!;
  for (const deal of await rows<{ id: number; owner_id: string }>(admin, data, "deals", { and: [{ column: "name", op: "like", value: `${startsWith}%` }, { column: "state", op: "eq", value: "open" }] })) {
    for (const step of await rows<{ id: number }>(admin, data, "follow_ups", { column: "deal_id", op: "eq", value: deal.id })) {
      expect((await admin.delete(data("follow_ups", `/${String(step.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
    if (deal.owner_id !== owner) expect((await admin.post(data("deals", `/${String(deal.id)}/actions/hand-over`), { data: { from: "open", values: { owner_id: owner } }, headers })).status()).toBe(200);
    expect((await admin.post(data("deals", `/${String(deal.id)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id } }, headers })).status()).toBe(200);
  }
}

const userId = async (person: APIRequestContext): Promise<string> => ((await (await person.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
const line = (page: Page, text: string | RegExp) => page.locator(".crm-room-line").filter({ hasText: text });
const fact = (scope: Page | Locator, label: string) => scope.locator(".crm-room-facts > div").filter({ has: ("page" in scope ? scope.page() : scope).locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
const noSideways = async (page: Page): Promise<void> => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test("Dana opens a deal from her board: the room, with the ledger's figures and the server's own; her note for whoever covers her", async ({ as, api, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}pipeline`);
  await page.locator('[data-kit-part="board"]').getByRole("button", { name: "Fourth-floor desk rows", exact: true }).click();
  await page.getByRole("dialog", { name: "Fourth-floor desk rows" }).getByRole("link", { name: "Open the deal room" }).click();
  const d1 = await dealNamed(context.request, data, "Fourth-floor desk rows");
  await expect(page).toHaveURL(new RegExp(`/apps/crm/staff/deals/${String(d1.id)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fourth-floor desk rows");
  await expect(page.getByTestId("room-owner")).toHaveText(/Dana Whitlock/);
  // The board's line stays lit in the menu: the room was reached from it.
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Pipeline board" })).toHaveAttribute("aria-current", "page");

  // The amount is the quote's: version 1 of Q-1002 is what the customer holds. It is not a field.
  await expect(page.getByTestId("room-amount")).toHaveText("£52,800");
  await expect(page.getByTestId("room-amount-source")).toHaveText("· from Q-1002 v1");
  await expect(page.getByRole("button", { name: /Change the amount/ })).toHaveCount(0);
  await expect(page.getByTestId("room-weighted")).toHaveText("£39,600 weighted at 75%");
  // Each figure is the server's own, as it answers Dana.
  expect([Number(d1["amount"]), Number(d1["weighted_value"]), Number(d1["stage_odds"]), Number(d1["quoted_amount"])]).toEqual([52800, 39600, 0.75, 52800]);

  const steps = page.getByRole("list", { name: "Stage" }).getByRole("button");
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(3)).toHaveAttribute("aria-current", "step");
  await expect(steps.nth(3)).toContainText("Negotiation");
  await expect(steps.nth(3)).toContainText("75%");

  await expect(fact(page, "Amount")).toHaveText("£52,800");
  await expect(fact(page, "Weighted value")).toHaveText("£39,600");
  await expect(fact(page, "Stage odds")).toHaveText("75%");
  await expect(page.getByTestId("room-sitting")).toHaveText("14 days in stage · warm");
  await expect(fact(page, "Opened")).toHaveText("May 12, 2026");
  await expect(fact(page, "Expected close")).toHaveText("Aug 14, 2026");
  await expect(fact(page, "Owner")).toHaveText("Dana Whitlock");

  // Seven lines: three things logged, four changes of stage. Nothing else has changed this deal since the sample went in.
  await expect(page.getByTestId("room-lines")).toHaveText("7");
  await expect(page.locator(".crm-room-line")).toHaveCount(7);
  await expect(page.locator(".crm-room-line").last()).toContainText("Opened at Discovery.");
  await expect(line(page, "Moved from Proposal to Negotiation.")).toContainText("Dana Whitlock");
  await expect(line(page, "Moved from Proposal to Negotiation.")).toContainText("Tue, Jul 14, 11:20");
  const logged = await rows(context.request, data, "activities", { column: "deal_id", op: "eq", value: d1.id });
  const moved = await rows(context.request, data, "deal_stage_changes", { column: "deal_id", op: "eq", value: d1.id });
  expect([logged.length, moved.length]).toEqual([3, 4]);
  await expect(page.locator('.crm-room-line[data-type="stage"]')).toHaveCount(4);

  // The customer's people, the main one marked.
  const people = page.getByRole("region", { name: "People" });
  await expect(people.locator(".crm-room-contact").filter({ hasText: "Petra Lindqvist" })).toContainText("Main");
  await expect(page.getByRole("region", { name: "Company" })).toContainText("Nordwind Logistics");

  // The quote: the newest version is 2, approved; the customer holds version 1 until Thursday.
  const quote = page.getByTestId("room-quote");
  await expect(quote).toContainText("Q-1002 · version 2");
  await expect(quote).toContainText("Approved");
  await expect(quote).toContainText("£48,000");
  await expect(quote).toContainText("The customer has version 1 at £52,800, valid until Thu, Jul 30.");

  // Who is on it: the owner, and nobody else yet.
  const on = page.getByTestId("room-on");
  await expect(on).toContainText("Dana Whitlock");
  await expect(on).toContainText("Nobody yet.");
  // One thread is open on this deal; the count is the server's.
  await expect(page.getByTestId("room-open-threads")).toHaveText("1");
  const open = await context.request.get(data("comments", `?limit=1&count=exact&where=${encodeURIComponent(JSON.stringify({ and: [{ column: "deal_id", op: "eq", value: d1.id }, { column: "parent_id", op: "is_null" }, { column: "settled_at", op: "is_null" }] }))}`));
  expect(((await open.json()) as { page: { total: number } }).page.total).toBe(1);

  // Her cover is coming up: the card is hers to write, and Priya's to read once it runs.
  const cover = page.getByTestId("room-cover");
  await expect(cover).toContainText("For Priya while Dana is away");
  await expect(cover).toContainText("Mon, Aug 10 – Fri, Aug 21");
  await expect(cover).toContainText("No note yet. Priya reads it while covering.");
  expect(problems).toEqual([]);
  await picture(page, "1-dana-room");

  // She writes the note Priya will read while covering. Escape is not needed: "Leave it" puts the card back as it was.
  await cover.getByRole("button", { name: "Write a note" }).click();
  const note = cover.getByRole("textbox", { name: "Briefing note" });
  await expect(note).toBeFocused();
  await expect(cover.getByRole("button", { name: "Save the note" })).toBeDisabled();
  await cover.getByRole("button", { name: "Leave it" }).click();
  await expect(note).toHaveCount(0);
  await cover.getByRole("button", { name: "Write a note" }).click();
  await note.fill("Petra decides. Do not move the price before she is back.");
  await cover.getByRole("button", { name: "Save the note" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Note saved. Priya reads it on this deal.");
  await expect(cover).toContainText("Petra decides. Do not move the price before she is back.");
  await expect(cover.getByRole("button", { name: "Edit the note" })).toBeVisible();
  const notes = await rows<{ id: number; text: string }>(context.request, data, "cover_notes", { column: "deal_id", op: "eq", value: d1.id });
  expect(notes.map((one) => one.text)).toEqual(["Petra decides. Do not move the price before she is back."]);
  // Nobody else writes it: Read-only is refused the write, and another rep cannot hang a note on a deal that is not theirs.
  const coverId = (await rows<{ id: number }>(context.request, data, "covers"))[0]!.id;
  const grace = await api("grace");
  expect((await grace.post(data("cover_notes"), { data: { values: { cover_id: coverId, deal_id: d1.id, text: "no" } }, headers: await csrf(grace) })).status()).toBe(403);
  const sam = await api("sam");
  expect((await sam.post(data("cover_notes"), { data: { values: { cover_id: coverId, deal_id: d1.id, text: "no" } }, headers: await csrf(sam) })).status()).toBeGreaterThanOrEqual(400);
  expect((await rows(context.request, data, "cover_notes", { column: "deal_id", op: "eq", value: d1.id })).length).toBe(1);
  // The sample goes back as it was: the CRM admin takes the note away.
  const tessa = await api("tessa");
  expect((await tessa.delete(data("cover_notes", `/${String(notes[0]!.id)}?confirm=true`), { headers: await csrf(tessa) })).status()).toBeLessThan(300);

  // The quote opens from here, and Back comes back to the room, then to the board.
  await quote.getByRole("link", { name: "Open the quote" }).click();
  await expect(page).toHaveURL(/\/quotes\/\d+$/);
  await expect(page.getByRole("link", { name: "Open the deal room" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/deals/${String(d1.id)}$`));
  await expect(page.getByTestId("room-amount")).toHaveText("£52,800");
  await page.goBack();
  await expect(page).toHaveURL(/\/pipeline$/);
});

test("an open deal is worked from its room: the amount typed, the stage, what is logged with a next step; a lost reply, a refused move, a colleague's change", async ({ as, api, data }) => {
  // The stage history is written by two rules a tick apart (decision 157): on a slow machine the last line lands after two minutes.
  test.setTimeout(300_000);
  const context = await as("dana");
  const dana = context.request;
  // Dana's minute of requests is shared by every spec that runs as her just before this one (Today, Site visits, This week, the room): wait for a fresh one when it is short.
  await freshMinute(dana, data, 200);
  const deal = await makeDeal(dana, data, "Room spec: work");
  const [discovery, qualified, proposal] = deal.stages as [Made["stages"][number], Made["stages"][number], Made["stages"][number]];
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}deals/${String(deal.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Room spec: work");
  // No quote: the amount is what was typed, and it can be changed here.
  await expect(page.getByTestId("room-amount")).toHaveText("£4,000");
  await expect(page.getByTestId("room-amount-source")).toHaveCount(0);
  await expect(page.getByTestId("room-weighted")).toHaveText("£400 weighted at 10%");
  await expect(page.getByTestId("room-quote")).toContainText("No quote yet. The amount above is typed.");
  await expect(page.getByTestId("room-quote").getByRole("button", { name: "Start a quote" })).toBeVisible();
  // The rule that writes a deal's first line has run: "Opened at Discovery."
  await expect(line(page, "Opened at Discovery.")).toHaveCount(1);

  // THE AMOUNT, by keyboard. Escape leaves it as it was and gives the focus back.
  const pencil = page.getByRole("button", { name: "Change the amount, now £4,000" });
  await pencil.focus();
  await page.keyboard.press("Enter");
  const field = page.getByRole("textbox", { name: "Amount" });
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(pencil).toBeFocused();
  await page.keyboard.press("Enter");
  await field.fill("4,250.40");
  await page.keyboard.press("Enter");
  await expect(page.locator(".crm-toast")).toHaveText("Amount is now £4,250.40. Weighted value follows.");
  await expect(page.getByTestId("room-amount")).toHaveText("£4,250.40");
  await expect(page.getByTestId("room-weighted")).toHaveText("£425.04 weighted at 10%");
  let held = await dealNamed(dana, data, "Room spec: work");
  expect([Number(held["typed_amount"]), Number(held["amount"]), Number(held["weighted_value"])]).toEqual([4250.4, 4250.4, 425.04]);
  // The change is a line of the deal's own history, with who made it.
  await expect(line(page, "Amount changed from £4,000 to £4,250.40.")).toContainText("Dana Whitlock");

  // THE STAGE: the server's move, from the stage the page saw.
  const steps = page.getByRole("list", { name: "Stage" }).getByRole("button");
  await steps.nth(1).click();
  await expect(page.locator(".crm-toast")).toHaveText("Room spec: work → Qualified · £1,062.60 weighted");
  await expect(steps.nth(1)).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("room-weighted")).toHaveText("£1,062.60 weighted at 25%");
  held = await dealNamed(dana, data, "Room spec: work");
  expect([held.stage_id, Number(held["weighted_value"])]).toEqual([qualified.id, 1062.6]);
  // The line is the rule's row; it says where the deal went, and the page reads where it came from off the line before.
  await expect(line(page, "Moved from Discovery to Qualified.")).toContainText("Dana Whitlock");

  // LOGGING, with the next step, and the first reply lost on its way back.
  const composer = page.getByRole("form", { name: "Log it" });
  await expect(composer.getByRole("button", { name: "Log it" })).toBeDisabled();
  await composer.getByRole("radio", { name: "Meeting" }).click();
  await expect(composer.getByRole("textbox", { name: "What happened" })).toHaveAttribute("placeholder", "Who was there, what was agreed?");
  await composer.getByRole("textbox", { name: "What happened" }).fill("Walked the floor with Ines. She wants the tall lockers.");
  await composer.getByRole("switch", { name: "Schedule it as the next step" }).click();
  await expect(page.getByTestId("room-next-when")).toHaveText("Wed, Jul 29, 10:00");
  const sent: { key: string; replayed: boolean | null }[] = [];
  let dropped = false;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_activities$/.test(new URL(request.url()).pathname)) return route.fallback();
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
  await composer.getByRole("button", { name: "Log it" }).click();
  // Never "not saved": the same save goes again with the same key, and the server answers the row the first one made.
  await expect(page.locator(".crm-toast")).toHaveText("Logged, and it is on your Today queue for Wed, Jul 29, 10:00.");
  expect(sent.length).toBe(2);
  expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
  await page.unroute("**/api/v1/data/**");
  const logged = await rows<{ kind: string; author_id: string; text: string }>(dana, data, "activities", { column: "deal_id", op: "eq", value: deal.id });
  expect(logged.map((one) => [one.kind, one.author_id, one.text])).toEqual([["meeting", deal.me, "Walked the floor with Ines. She wants the tall lockers."]]);
  const step = await rows<{ owner_id: string; due_at: string; kind: string; text: string; done: boolean | number }>(dana, data, "follow_ups", { column: "deal_id", op: "eq", value: deal.id });
  expect(step.map((one) => [one.owner_id, new Date(one.due_at).toISOString(), one.kind, one.text])).toEqual([[deal.me, "2026-07-29T09:00:00.000Z", "step", "Walked the floor with Ines. She wants the tall lockers."]]);
  await expect(line(page, "Walked the floor with Ines.")).toContainText("Meeting");
  await expect(line(page, "Walked the floor with Ines.")).toContainText("Dana Whitlock");
  await expect(composer.getByRole("textbox", { name: "What happened" })).toHaveValue("");
  await expect(composer.getByRole("switch", { name: "Schedule it as the next step" })).toHaveAttribute("aria-checked", "false");
  // Four lines now: opened, the amount, the stage, the meeting.
  await expect(page.getByTestId("room-lines")).toHaveText("4");
  await picture(page, "2-dana-room-worked");

  // A MOVE THE SERVER REFUSES. A second page of Dana's that hears nothing; Ivy moves the deal on; Dana's press there names a stage the deal has left.
  const deaf = await context.newPage();
  await deaf.route("**/api/v1/events**", (route) => route.abort());
  await deaf.goto(`${STAFF}deals/${String(deal.id)}`);
  const deafSteps = deaf.getByRole("list", { name: "Stage" }).getByRole("button");
  await expect(deafSteps.nth(1)).toHaveAttribute("aria-current", "step");
  const ivy = await api("ivy");
  const moved = await ivy.patch(data("deals", `/${String(deal.id)}`), { data: { values: { stage_id: proposal.id }, seen: { stage_id: qualified.id } }, headers: await csrf(ivy) });
  expect(moved.status(), await moved.text()).toBe(200);
  await deafSteps.nth(4).click();
  await expect(deaf.locator(".crm-toast")).toContainText("Somebody changed this since you opened it. It has been read again.");
  await expect(deafSteps.nth(2)).toHaveAttribute("aria-current", "step");
  expect((await dealNamed(dana, data, "Room spec: work")).stage_id).toBe(proposal.id);
  await deaf.close();

  // TWO PEOPLE SIGNED IN: the page that listens followed Ivy's move with no reload, and names her.
  await expect(steps.nth(2)).toHaveAttribute("aria-current", "step");
  await expect(line(page, "Moved from Qualified to Proposal.")).toContainText("Ivy Sandoval");
  await expect(page.getByTestId("room-weighted")).toHaveText("£2,125.20 weighted at 50%");
  // And what she logs lands in Dana's open timeline.
  const call = await ivy.post(data("activities"), { data: { values: { deal_id: deal.id, kind: "call", text: "Rang Ines to say hello." } }, headers: await csrf(ivy) });
  expect(call.status(), await call.text()).toBe(201);
  await expect(line(page, "Rang Ines to say hello.")).toContainText("Ivy Sandoval");

  // Another rep may not move this deal, read it or log on it: the server says so to a direct call.
  const sam = await api("sam");
  const samHeaders = await csrf(sam);
  expect((await sam.get(data("deals", `/${String(deal.id)}`))).status()).toBe(404);
  expect((await sam.patch(data("deals", `/${String(deal.id)}`), { data: { values: { stage_id: discovery.id } }, headers: samHeaders })).status()).toBe(404);
  // A deal he cannot read is not there for him to log on: the link is refused as one to nothing.
  expect((await sam.post(data("activities"), { data: { values: { deal_id: deal.id, kind: "note", text: "not mine" } }, headers: samHeaders })).status()).toBe(409);
  expect((await rows(dana, data, "activities", { column: "deal_id", op: "eq", value: deal.id })).length).toBe(2);
  // Nothing went wrong on the page but the one reply this spec dropped itself.
  expect(problems.filter((problem) => !problem.includes("ERR_CONNECTION_RESET"))).toEqual([]);

  // THE RULE'S OWN ROWS land a minute after each move (F21: each names where from, where to, who and the move's own moment, whatever happened after). They are the same three moves: the room says each once, from the deal's own history, before the rows land and after.
  const said = async (): Promise<number[]> => Promise.all(["Opened at Discovery.", "Moved from Discovery to Qualified.", "Moved from Qualified to Proposal."].map((text) => line(page, text).count()));
  expect(await said()).toEqual([1, 1, 1]);
  // Asked every five seconds: the rows land a minute after the moves, and Dana's minute of requests is mostly spent by now.
  await expect.poll(async () => (await rows(dana, data, "deal_stage_changes", { column: "deal_id", op: "eq", value: deal.id })).length, { timeout: 200_000, intervals: [5000] }).toBe(3);
  // Each line names where the deal went from, where to, and who moved it (F21), whatever happened after.
  const lines = await rows<{ from_stage_id: number | null; to_stage_id: number; by_id: string }>(dana, data, "deal_stage_changes", { column: "deal_id", op: "eq", value: deal.id }, "&order=at,id");
  expect(lines.map((one) => [one.from_stage_id, one.to_stage_id])).toEqual([[null, discovery.id], [discovery.id, qualified.id], [qualified.id, proposal.id]]);
  expect(lines.map((one) => one.by_id)).toEqual([deal.me, deal.me, await userId(ivy)]);
  await page.reload();
  await expect(page.locator('.crm-room-line[data-type="stage"]')).toHaveCount(3);
  expect(await said()).toEqual([1, 1, 1]);
  await expect(line(page, "Moved from Qualified to Proposal.")).toContainText("Ivy Sandoval");
  await retire(api, data, "Room spec: work");
});

test("also on this deal: the owner adds a colleague, who then opens it and may add nobody; she takes them off again", async ({ as, api, data, stand }) => {
  const context = await as("dana");
  const dana = context.request;
  const headers = await csrf(dana);
  const deal = await makeDeal(dana, data, "Room spec: people");
  const priya = await api("priya");
  const priyaId = await userId(priya);
  // Somebody whose role opens no deal: the marketer, at every stage; the operations manager too at stage 1 (from stage 2 she
  // reads a won deal, the jobs' own, so her role does open deals).
  const noDeal = await Promise.all((stand.parts.includes("jobs") ? ["lena"] : ["ada", "lena"]).map(async (who) => [who, await userId(await api(who))] as const));
  const samId = await userId(await api("sam"));
  expect((await priya.get(data("deals", `/${String(deal.id)}`))).status()).toBe(404);

  const page = await context.newPage();
  await page.goto(`${STAFF}deals/${String(deal.id)}`);
  const on = page.getByTestId("room-on");
  await expect(on).toContainText("Nobody yet.");
  const add = on.getByRole("button", { name: "Add someone" });
  await expect(add).toHaveAttribute("aria-expanded", "false");
  await add.click();
  // Who is offered: the people with a sales profile here, less the owner. Nobody whose role opens no deal.
  const pool = on.getByRole("group", { name: "People who can be added" });
  await expect(pool.getByRole("button")).toHaveText([/Priya Raman$/, /Sam Okonjo$/, /Leo Vance$/]);
  await pool.getByRole("button", { name: "Priya Raman" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Priya is on this deal. The amount still counts for Dana.");
  const helper = on.locator(`[data-member="${priyaId}"]`);
  await expect(helper).toContainText("Priya Raman");
  await expect(helper).toContainText("helping");
  await expect(helper).toContainText("Since Tue, Jul 28");
  await expect(pool).toHaveCount(0);
  const listed = await rows<{ id: number; user_id: string; added_by_id: string; since: string }>(dana, data, "deal_members", { column: "deal_id", op: "eq", value: deal.id });
  expect(listed.map((one) => [one.user_id, one.added_by_id, one.since.slice(0, 10)])).toEqual([[priyaId, deal.me, "2026-07-28"]]);
  // The timeline says it, on the day (plan 68 S3).
  await expect(line(page, "Priya Raman added by Dana Whitlock.")).toContainText("Tue, Jul 28");

  // Priya opens it now, in her own room: marked as on it, with no "Add someone" and no way to take herself or anybody off.
  expect((await priya.get(data("deals", `/${String(deal.id)}`))).status()).toBe(200);
  const hers = await (await as("priya")).newPage();
  await hers.goto(`${STAFF}deals/${String(deal.id)}`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("Room spec: people");
  await expect(hers.getByTestId("room-on").locator(`[data-member="${priyaId}"]`)).toContainText("helping");
  await expect(hers.getByTestId("room-on").getByRole("button")).toHaveCount(0);
  // She works the deal: the composer is hers too.
  await expect(hers.getByRole("form", { name: "Log it" })).toBeVisible();
  // The server holds it: somebody on a deal adds nobody, and cannot take a row off the list.
  const priyaHeaders = await csrf(priya);
  const refused = await priya.post(data("deal_members"), { data: { values: { deal_id: deal.id, user_id: samId } }, headers: priyaHeaders });
  expect(refused.status(), await refused.text()).toBe(403);
  expect((await priya.delete(data("deal_members", `/${String(listed[0]!.id)}?confirm=true`), { headers: priyaHeaders })).status()).toBe(404);
  // And nobody is listed whose role opens no deal, whoever asks: refused by name of the column.
  for (const [who, id] of noDeal) {
    const cannot = await dana.post(data("deal_members"), { data: { values: { deal_id: deal.id, user_id: id } }, headers });
    expect(cannot.status(), who).toBe(422);
    expect(((await cannot.json()) as { error: { details: { fields: Record<string, { code: string }> } } }).error.details.fields["user_id"]?.code, who).toBe("cannot-open");
  }
  // Another rep adds nobody to a deal that is not theirs.
  const sam = await api("sam");
  expect((await sam.post(data("deal_members"), { data: { values: { deal_id: deal.id, user_id: samId } }, headers: await csrf(sam) })).status()).toBe(409);

  // Dana takes Priya off, and the deal closes to her again. Priya's open room hears it.
  await on.getByRole("button", { name: "Take Priya Raman off this deal" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Priya Raman is off this deal.");
  await expect(on).toContainText("Nobody yet.");
  expect((await rows(dana, data, "deal_members", { column: "deal_id", op: "eq", value: deal.id })).length).toBe(0);
  expect((await priya.get(data("deals", `/${String(deal.id)}`))).status()).toBe(404);
  // The timeline keeps both: who added her, and who took her off and when, read from the deal's removed people (plan 68 S3).
  await expect(line(page, "Priya Raman taken off by Dana Whitlock.")).toBeVisible();
  await expect(line(page, "Priya Raman added by Dana Whitlock.")).toHaveCount(0);
  const offUrl = data("deals", `/${String(deal.id)}/removed/${data("deal_members").split("/").pop()!}`);
  const offList = await dana.get(offUrl);
  expect(offList.status()).toBe(200);
  expect(((await offList.json()) as { removed: { row: { user_id: string } }[] }).removed.map((one) => one.row.user_id)).toEqual([priyaId]);
  // Off the deal, Priya reads none of it: as a deal that is not there.
  expect((await priya.get(offUrl)).status()).toBe(404);
  await hers.reload();
  await expect(hers.getByTestId("no-deal")).toContainText("No deal to open");
  await retire(api, data, "Room spec: people");
});

test("a closed deal is the same page, read-only; whoever may reopens it; the account manager reads a won deal and nothing of an open one", async ({ as, api, data }) => {
  // Dana's lost deal, from Closed: how it ended, and nothing to change.
  const context = await as("dana");
  const dana = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}closed`);
  await page.getByRole("link", { name: "Archive shelving, second run" }).click();
  const l4 = await dealNamed(dana, data, "Archive shelving, second run");
  await expect(page).toHaveURL(new RegExp(`/deals/${String(l4.id)}$`));
  await expect(page.getByTestId("room-state")).toHaveText("Lost");
  await expect(page.getByTestId("room-closed")).toHaveText("Lost on Jul 20, 2026 at Proposal: Budget pulled. Open for 49 days. A closed deal is read-only.");
  expect([l4.state, String(l4["closed_on"]).slice(0, 10), Number(l4["cycle_days"])]).toEqual(["lost", "2026-07-20", 49]);
  await expect(page.getByTestId("room-amount")).toHaveText("£5,400");
  await expect(page.getByTestId("room-weighted")).toHaveCount(0);
  await expect(fact(page, "Stage reached")).toHaveText("Proposal");
  await expect(fact(page, "Closed")).toHaveText("Jul 20, 2026");
  // Its steps are not buttons, and nothing on the page writes: no pencil, no composer, no "Add someone", no close, no hand-over.
  await expect(page.getByRole("list", { name: "Stage" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("list", { name: "Stage" }).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Change the amount/ })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Log it" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add someone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close: won or lost…" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Hand it over" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Closed" })).toBeVisible();
  // The server holds the lock: a change to a closed deal is refused.
  const headers = await csrf(dana);
  expect((await dana.patch(data("deals", `/${String(l4.id)}`), { data: { values: { typed_amount: 1 } }, headers })).status()).toBeGreaterThanOrEqual(400);
  expect(Number((await dealNamed(dana, data, "Archive shelving, second run"))["amount"])).toBe(5400);
  await picture(page, "3-dana-closed-deal");

  // REOPEN, on a deal of the spec's own: lost with a reason, then open again from its page.
  const deal = await makeDeal(dana, data, "Room spec: closed");
  const reason = (await rows<{ id: number; label: string }>(dana, data, "lost_reasons", { column: "label", op: "eq", value: "Budget pulled" }))[0]!;
  expect((await dana.post(data("deals", `/${String(deal.id)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id, close_note: "They froze spending." } }, headers })).status()).toBe(200);
  await page.goto(`${STAFF}deals/${String(deal.id)}`);
  await expect(page.getByTestId("room-closed")).toContainText("at Discovery: Budget pulled.");
  await expect(page.getByTestId("room-closed")).toContainText("“They froze spending.”");
  // How it closed is in the deal's own history, signed.
  await expect(line(page, "Closed as lost: Budget pulled. Note: They froze spending.")).toContainText("Dana Whitlock");
  await page.getByRole("button", { name: "Reopen the deal" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Room spec: closed is open again, at Discovery.");
  await expect(page.getByTestId("room-closed")).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Log it" })).toBeVisible();
  await expect(line(page, "Reopened.")).toContainText("Dana Whitlock");
  const reopened = await dealNamed(dana, data, "Room spec: closed");
  expect([reopened.state, reopened["closed_on"], reopened["lost_reason_id"]]).toEqual(["open", null, null]);
  expect(problems).toEqual([]);

  // THE ACCOUNT MANAGER reads a deal once it is won: from "Won deals", its page, with nothing to change and nothing of what was logged.
  const hugoContext = await as("hugo");
  const hugo = hugoContext.request;
  const his = await hugoContext.newPage();
  await his.goto(STAFF);
  await unfoldMenu(his);
  await his.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Won deals" }).click();
  await his.getByRole("link", { name: "Studio meeting tables" }).click();
  await expect(his.getByRole("heading", { level: 1 })).toHaveText("Studio meeting tables");
  await expect(his.getByTestId("room-state")).toHaveText("Won");
  await expect(his.getByTestId("room-closed")).toHaveText("Won on Jun 12, 2026. Open for 41 days. A closed deal is read-only.");
  await expect(his.getByTestId("room-amount")).toHaveText("£8,900");
  await expect(his.getByRole("button", { name: "Reopen the deal" })).toHaveCount(0);
  await expect(his.getByTestId("room-no-lines")).toHaveText("What was logged on a deal is not part of your role.");
  await expect(his.getByRole("link", { name: "Comments" })).toHaveCount(0);
  await expect(his.getByTestId("room-quote")).toHaveCount(0);
  // His menu has no board: the line the deal was reached from, "Won deals", stays lit.
  await expect(his.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Won deals" })).toHaveAttribute("aria-current", "page");
  await picture(his, "4-hugo-won-deal");
  const h4 = (await rows<{ id: number }>(hugo, data, "deals", { column: "name", op: "eq", value: "Studio meeting tables" }))[0]!;
  const hugoHeaders = await csrf(hugo);
  // The server's own refusals: he reopens nothing, reads nothing that was logged or said on a deal he is not on (he reads it
  // only on a deal he is on, P23), and an open deal is not there for him.
  expect((await hugo.post(data("deals", `/${String(h4.id)}/actions/reopen`), { data: { from: "won" }, headers: hugoHeaders })).status()).toBe(403);
  const tessa = await api("tessa");
  let there = 0;
  for (const table of ["activities", "comments", "deal_stage_changes"]) {
    expect(await rows(hugo, data, table, { column: "deal_id", op: "eq", value: h4.id }), `hugo reads ${table} of a deal he is not on`).toEqual([]);
    there += (await rows(tessa, data, table, { column: "deal_id", op: "eq", value: h4.id })).length;
  }
  expect(there, "the won deal has a history to keep from him").toBeGreaterThan(0);
  expect((await hugo.get(data("deals", `/${String(deal.id)}`))).status()).toBe(404);
  await his.goto(`${STAFF}deals/${String(deal.id)}`);
  await expect(his.getByTestId("no-deal")).toContainText("No deal to open");
  await retire(api, data, "Room spec: closed");
});

test("Read-only reads the room with nothing to press, the marketer's address is refused, another rep's deal is not there: each the server's answer", async ({ as, api, data }) => {
  const dana = await api("dana");
  const d1 = await dealNamed(dana, data, "Fourth-floor desk rows");
  const samId = await userId(await api("sam"));

  // READ-ONLY: the whole room, and no control that writes.
  const graceContext = await as("grace");
  const grace = graceContext.request;
  const page = await graceContext.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}pipeline`);
  await page.locator('[data-kit-part="board"]').getByRole("button", { name: "Fourth-floor desk rows", exact: true }).click();
  await page.getByRole("dialog", { name: "Fourth-floor desk rows" }).getByRole("link", { name: "Open the deal room" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fourth-floor desk rows");
  await expect(page.getByTestId("room-amount")).toHaveText("£52,800");
  await expect(page.getByTestId("room-lines")).toHaveText("7");
  await expect(page.getByRole("list", { name: "Stage" }).getByRole("button")).toHaveCount(0);
  await expect(page.locator('.crm-room-step[aria-current="step"]')).toContainText("Negotiation");
  await expect(page.getByRole("form", { name: "Log it" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add someone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close: won or lost…" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Hand it over" })).toHaveCount(0);
  await expect(page.getByTestId("room-quote").getByRole("button")).toHaveCount(0);
  // The cover card is for the two people of the cover; she is neither.
  await expect(page.getByTestId("room-cover")).toHaveCount(0);
  // A contact's address and number are masked for her by the server: the card names Petra and shows neither.
  const petra = (await rows<{ email: string | null; phone: string | null }>(grace, data, "contacts", { column: "name", op: "eq", value: "Petra Lindqvist" }))[0]!;
  expect([petra.email, petra.phone]).toEqual([null, null]);
  const card = page.getByRole("region", { name: "People" }).locator(".crm-room-contact").filter({ hasText: "Petra Lindqvist" });
  await expect(card).toContainText("Head of Facilities");
  await expect(card.locator(".crm-room-contact-ways")).toHaveCount(0);
  expect(problems).toEqual([]);
  await picture(page, "5-grace-room");
  const graceHeaders = await csrf(grace);
  expect((await grace.patch(data("deals", `/${String(d1.id)}`), { data: { values: { stage_id: d1.stage_id } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.post(data("activities"), { data: { values: { deal_id: d1.id, kind: "note", text: "no" } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.post(data("follow_ups"), { data: { values: { deal_id: d1.id, owner_id: samId, due_at: "2026-07-29T09:00:00.000Z", text: "no", kind: "step" } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.post(data("deal_members"), { data: { values: { deal_id: d1.id, user_id: samId } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.post(data("comments"), { data: { values: { deal_id: d1.id, text: "no" } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.post(data("deals", `/${String(d1.id)}/actions/hand-over`), { data: { from: "open", values: { owner_id: samId } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.post(data("deals", `/${String(d1.id)}/actions/mark-won`), { data: { from: "open" }, headers: graceHeaders })).status()).toBe(403);

  // THE MARKETER: no deal is hers to read. Her address for one says so, as the server does.
  const lenaContext = await as("lena");
  const lena = lenaContext.request;
  const hers = await lenaContext.newPage();
  await hers.goto(`${STAFF}deals/${String(d1.id)}`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  await hers.goto(`${STAFF}deals/${String(d1.id)}/comments`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  await hers.goto(`${STAFF}hand-over`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  for (const ref of ["deals", "activities", "comments", "deal_stage_changes", "deal_members", "deal_amount_changes"]) expect((await lena.get(data(ref, "?limit=1"))).status(), ref).toBe(403);
  expect((await lena.get(data("deals", `/${String(d1.id)}/history`))).status()).toBe(403);

  // ANOTHER REP: Dana's deal is not there for Sam, by its address or by a direct call, and nor is anything on it.
  const samContext = await as("sam");
  const sam = samContext.request;
  const his = await samContext.newPage();
  await his.goto(`${STAFF}deals/${String(d1.id)}`);
  await expect(his.getByTestId("no-deal")).toContainText("No deal to open");
  await expect(his.getByTestId("no-deal")).toContainText("It is not there, or it is not a deal of yours.");
  await his.goto(`${STAFF}deals/${String(d1.id)}/comments`);
  await expect(his.getByTestId("no-deal")).toContainText("No deal to open");
  expect((await sam.get(data("deals", `/${String(d1.id)}`))).status()).toBe(404);
  expect((await sam.get(data("deals", `/${String(d1.id)}/history`))).status()).toBe(404);
  for (const ref of ["activities", "comments", "deal_stage_changes", "deal_members"]) expect(await rows(sam, data, ref, { column: "deal_id", op: "eq", value: d1.id }), ref).toEqual([]);
  // An address that names no deal at all reads the same.
  await his.goto(`${STAFF}deals/999999`);
  await expect(his.getByTestId("no-deal")).toContainText("No deal to open");
  await his.goto(`${STAFF}deals/${String(d1.id)}/nothing`);
  await expect(his.getByTestId("no-deal")).toContainText("No deal to open");
});

test("comments: threads and replies, mentions through Adminium's own box, the quiet line, settling; a colleague's reply arrives live", async ({ as, api, data }) => {
  const context = await as("dana");
  const dana = context.request;
  // Two pages of Dana's hear every comment: the test starts her on a fresh minute (the server counts 300 a minute).
  await freshMinute(dana, data, 200);
  const d1 = await dealNamed(dana, data, "Fourth-floor desk rows");
  const page = await context.newPage();
  const problems = watch(page);

  // The sample's two threads on d1: one open (Dana's, with Ivy's reply), one settled (Leo's).
  await page.goto(`${STAFF}deals/${String(d1.id)}`);
  await page.getByRole("link", { name: /^Comments/ }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${String(d1.id)}/comments$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fourth-floor desk rows");
  await expect(page.locator(".crm-screen-sub")).toHaveText("Nordwind Logistics · internal thread");
  const threads = page.locator(".crm-cmt-thread");
  await expect(threads).toHaveCount(1);
  await expect(threads.first()).toContainText("the number off list is 9.1%");
  await expect(threads.first().locator(".crm-cmt-reply")).toHaveCount(1);
  await expect(threads.first().locator(".crm-cmt-reply")).toContainText("Ivy Sandoval");
  // When each was written, as the server keeps it (S18): Dana's yesterday evening, Ivy's reply this morning.
  await expect(threads.first().locator(".crm-cmt-head .crm-cmt-when").first()).toHaveText("Yesterday 17:20");
  await expect(threads.first().locator(".crm-cmt-reply .crm-cmt-when")).toHaveText("Today 08:05");
  // Hers to settle; Leo's is not, and the server says the same.
  await expect(threads.first().getByRole("button", { name: "Settle it" })).toBeVisible();
  await page.getByRole("button", { name: "Show settled" }).click();
  await expect(threads).toHaveCount(2);
  const leos = threads.filter({ hasText: "Delivery on this one clashes" });
  await expect(leos).toContainText("Settled");
  await expect(leos.getByRole("button", { name: "Reopen" })).toHaveCount(0);
  const all = await rows<{ id: number; parent_id: number | null; text: string; settled_at: string | null }>(dana, data, "comments", { column: "deal_id", op: "eq", value: d1.id });
  expect([all.filter((one) => one.parent_id === null).length, all.filter((one) => one.parent_id !== null).length, all.filter((one) => one.settled_at !== null).length]).toEqual([2, 2, 1]);
  const leo = all.find((one) => one.text.startsWith("Delivery on this one"))!;
  expect((await dana.patch(data("comments", `/${String(leo.id)}`), { data: { values: { settled_at: null, settled_by_id: null } }, headers: await csrf(dana) })).status()).toBe(404);
  await picture(page, "6-dana-comments");

  // A NEW THREAD, on a deal of the spec's own, naming two people through Adminium's box.
  const deal = await makeDeal(dana, data, "Room spec: talk");
  const ivyContext = await as("ivy");
  const ivy = ivyContext.request;
  const [ivyId, adaId] = [await userId(ivy), await userId(await api("ada"))];
  const ada = await api("ada");
  const seenBy = async (person: APIRequestContext) => ((await (await person.get("/api/v1/me/notifications?limit=20")).json()) as { data: { items: { kind: string; title: string; body: string | null; actionUrl: string | null }[] } }).data.items.filter((item) => item.kind === "mention" && ((item.body ?? "").includes("Room spec: talk") || (item.actionUrl === null && item.title === "Dana Whitlock mentioned you")));
  // What each had been told before (nothing, on a fresh stand): the newest notice is first.
  const told = { ivy: (await seenBy(ivy)).length, ada: (await seenBy(ada)).length };
  await page.goto(`${STAFF}deals/${String(deal.id)}/comments`);
  await expect(page.locator(".crm-cmt-threads .crm-empty")).toContainText("No comments on this deal yet");
  const box = page.locator('[data-box="new"]').getByRole("combobox");
  await expect(box).toBeVisible();
  await expect(page.getByRole("button", { name: "Post it" })).toBeDisabled();
  await box.click();
  await page.keyboard.type("@Ada");
  const offered = page.getByRole("listbox", { name: "People to mention" });
  await expect(offered.getByRole("option", { name: /Ada Novak/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(offered).toHaveCount(0);
  // Ada is not on this deal: the writer is told what somebody who cannot open it gets.
  const quiet = page.getByTestId("cmt-quiet");
  await expect(quiet).toHaveText("Ada is not on this deal. Someone who cannot open it is told only that you mentioned them, never what you wrote.");
  await page.keyboard.type("can the crew fit this in August? ");
  await page.keyboard.type("@Ivy");
  await expect(offered.getByRole("option", { name: /Ivy Sandoval/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("for the price.");
  await expect(quiet.locator("p")).toHaveCount(2);
  await page.getByRole("button", { name: "Post it" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Posted.");
  const mine = page.locator(".crm-cmt-thread").filter({ hasText: "can the crew fit this in August?" });
  await expect(mine).toHaveCount(1);
  await expect(mine.locator(".crm-cmt-mention")).toHaveText(["@Ada Novak", "@Ivy Sandoval"]);
  await expect(mine.locator(".crm-cmt-first .crm-cmt-who")).toHaveText("Dana Whitlock");
  await expect(quiet).toHaveCount(0);
  await expect(box).toHaveValue("");
  // What is stored is Adminium's own mark, each person by id.
  const stored = await rows<{ id: number; text: string; author_id: string }>(dana, data, "comments", { column: "deal_id", op: "eq", value: deal.id });
  expect(stored.map((one) => one.text)).toEqual([`@[Ada Novak](${adaId}) can the crew fit this in August? @[Ivy Sandoval](${ivyId}) for the price.`]);
  // THE NOTICES ARE THE SERVER'S. Ivy, who can open the deal, gets a way in; Ada, who cannot, gets none. Neither gets a word of what was written.
  await expect.poll(async () => (await seenBy(ivy)).length).toBe(told.ivy + 1);
  expect((await seenBy(ada)).length).toBe(told.ada + 1);
  const [toIvy] = await seenBy(ivy);
  const [toAda] = await seenBy(ada);
  expect(toIvy!.title).toBe("Dana Whitlock mentioned you");
  expect(toIvy!.actionUrl).not.toBeNull();
  expect(toAda!.title).toBe("Dana Whitlock mentioned you");
  expect(toAda!.actionUrl).toBeNull();
  // A mention names the deal only to somebody who can open it (F21, engine d50a6e3b8): Ada is told the kind of record only.
  expect(toIvy!.body ?? "").toContain("Room spec: talk");
  expect(toAda!.body ?? "").not.toContain("Room spec: talk");
  expect(`${toIvy!.title}${toIvy!.body ?? ""}${toAda!.title}${toAda!.body ?? ""}`).not.toContain("crew");

  // TWO PEOPLE SIGNED IN: Ivy answers from her own page, and Dana's open page shows it with no reload.
  const hers = await ivyContext.newPage();
  await hers.goto(`${STAFF}deals/${String(deal.id)}/comments`);
  const reply = hers.locator(`[data-box="reply-${String(stored[0]!.id)}"]`).getByRole("combobox");
  await reply.click();
  await hers.keyboard.type("Hold it at list. I will ring Ada.");
  await hers.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(hers.locator(".crm-toast")).toHaveText("Posted.");
  await expect(mine.locator(".crm-cmt-reply")).toContainText("Hold it at list. I will ring Ada.");
  await expect(mine.locator(".crm-cmt-reply .crm-cmt-who")).toHaveText("Ivy Sandoval");
  // And the room's own count of open threads followed, for whoever has the room open.
  const room = await context.newPage();
  await room.goto(`${STAFF}deals/${String(deal.id)}`);
  await expect(room.getByTestId("room-open-threads")).toHaveText("1");

  // SETTLING: the writer puts her thread away; the room's count follows live; "Show settled" brings it back, and she reopens it.
  await mine.getByRole("button", { name: "Settle it" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Settled.");
  await expect(page.locator(".crm-cmt-thread")).toHaveCount(0);
  await expect(page.locator(".crm-cmt-threads .crm-empty")).toContainText("Everything here is settled");
  await expect(room.getByTestId("room-open-threads")).toHaveCount(0);
  const settled = (await rows<{ settled_at: string | null; settled_by_id: string | null }>(dana, data, "comments", { column: "id", op: "eq", value: stored[0]!.id }))[0]!;
  expect([settled.settled_at !== null, settled.settled_by_id]).toEqual([true, deal.me]);
  await page.getByRole("button", { name: "Show settled" }).click();
  // WHO SETTLED IS THE SERVER'S (plan 68 R1b): the thread names her, and nobody types it. Dana may not send it at all, nor
  // may the CRM admin, who changes of a comment only whether it is settled (plan 68 X6): she is stamped as who settled it.
  await expect(page.getByTestId("cmt-settled")).toHaveText("Settled by Dana Whitlock");
  const thread = `/${String(stored[0]!.id)}`;
  const typed = await dana.patch(data("comments", thread), { data: { values: { settled_by_id: ivyId } }, headers: await csrf(dana) });
  expect([typed.status(), ((await typed.json()) as { error?: { code?: string } }).error?.code]).toEqual([403, "COLUMN_FORBIDDEN"]);
  const tessa = await api("tessa");
  const tessaId = await userId(tessa);
  expect((await tessa.patch(data("comments", thread), { data: { values: { settled_at: null } }, headers: await csrf(tessa) })).status()).toBe(200);
  const forged = await tessa.patch(data("comments", thread), { data: { values: { settled_at: new Date().toISOString(), settled_by_id: ivyId } }, headers: await csrf(tessa) });
  expect([forged.status(), ((await forged.json()) as { error?: { code?: string } }).error?.code]).toEqual([403, "COLUMN_FORBIDDEN"]);
  // …and she rewords nobody's comment (plan 68 X6).
  expect((await tessa.patch(data("comments", thread), { data: { values: { text: "Spec: reworded by the CRM admin" } }, headers: await csrf(tessa) })).status()).toBe(403);
  expect((await tessa.patch(data("comments", thread), { data: { values: { settled_at: new Date().toISOString() } }, headers: await csrf(tessa) })).status()).toBe(200);
  expect((await rows<{ settled_by_id: string | null }>(dana, data, "comments", { column: "id", op: "eq", value: stored[0]!.id }))[0]!.settled_by_id).toBe(tessaId);
  await expect(page.getByTestId("cmt-settled")).toHaveText("Settled by Tessa Marlow");
  await page.locator(".crm-cmt-thread").getByRole("button", { name: "Reopen" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Back open.");
  await expect(room.getByTestId("room-open-threads")).toHaveText("1");
  await room.close();
  expect(problems).toEqual([]);

  // READ-ONLY reads the comments and writes none: no box, no button, and the server refuses the write.
  const graceContext = await as("grace");
  const graces = await graceContext.newPage();
  await graces.goto(`${STAFF}deals/${String(deal.id)}/comments`);
  await expect(graces.locator(".crm-cmt-thread")).toHaveCount(1);
  await expect(graces.locator(".crm-cmt-thread")).toContainText("@Ada Novak");
  await expect(graces.getByRole("combobox")).toHaveCount(0);
  await expect(graces.getByRole("button", { name: /Post it|Reply|Settle it/ })).toHaveCount(0);
  expect((await graceContext.request.post(data("comments"), { data: { values: { deal_id: deal.id, text: "no" } }, headers: await csrf(graceContext.request) })).status()).toBe(403);
  // Somebody named who does not sign in here is refused by the server, with nothing written.
  const ghost = await dana.post(data("comments"), { data: { values: { deal_id: deal.id, text: "@[Nobody](usr_00000000000000000000000000) hello" } }, headers: await csrf(dana) });
  expect(ghost.status()).toBe(422);
  expect((await rows(dana, data, "comments", { column: "deal_id", op: "eq", value: deal.id })).length).toBe(2);
  await retire(api, data, "Room spec: talk");
});

test("hand a deal over: a rep hands on her own with a note; whoever leads the team moves the follow-ups too; the room shows whose it was", async ({ as, api, data }) => {
  // The tests before this one work Dana's screens hard, and the server counts her requests by the minute (300): on a stage-2
  // stand her minute ran out during this test (429s on the hand-over dialog). She starts it with her whole minute.
  test.setTimeout(240_000);
  await minuteOut();
  const context = await as("dana");
  const dana = context.request;
  const headers = await csrf(dana);
  const d1 = await dealNamed(dana, data, "Fourth-floor desk rows");
  // The counts below are of the sample's deals alone: nothing an earlier spec left behind.
  await retire(api, data, "Room spec:");
  const priya = await api("priya");
  const [priyaId, samId] = [await userId(priya), await userId(await api("sam"))];

  // From her menu: her own six open deals, and no other.
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Hand a deal over" }).click();
  await expect(page).toHaveURL(/\/hand-over$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hand a deal over");
  const which = page.getByRole("radiogroup", { name: "Which deal?" });
  await expect(which.getByRole("radio")).toHaveCount(6);
  expect((await rows(dana, data, "deals", { and: [{ column: "state", op: "eq", value: "open" }, { column: "owner_id", op: "eq", value: d1.owner_id }] })).length).toBe(6);

  // From the room of d1: it is picked, and the brief is the ledger's.
  await page.goto(`${STAFF}deals/${String(d1.id)}`);
  await page.getByRole("link", { name: "Hand it over" }).click();
  await expect(page).toHaveURL(new RegExp(`/hand-over/${String(d1.id)}$`));
  await expect(which.getByRole("radio", { name: /Fourth-floor desk rows/ })).toHaveAttribute("aria-checked", "true");
  const brief = page.getByTestId("hand-brief");
  await expect(brief).toContainText("Fourth-floor desk rows");
  await expect(brief).toContainText("Negotiation · 75%");
  await expect(fact(brief, "Amount")).toHaveText("£52,800");
  await expect(fact(brief, "Weighted value")).toHaveText("£39,600");
  await expect(fact(brief, "Sitting")).toHaveText("14 days in stage · warm");
  await expect(fact(brief, "Expected close")).toHaveText("Aug 14, 2026");
  await expect(fact(brief, "Main contact")).toHaveText("Petra Lindqvist");
  await expect(fact(brief, "Currently")).toHaveText("Dana Whitlock");
  // Two open follow-ups on it, the first late. A rep's stay in her queue, and the page says so before she presses anything.
  await expect(page.getByTestId("hand-steps-title")).toHaveText("2 open follow-ups on it");
  await expect(brief.locator(".crm-hand-steps li")).toHaveCount(2);
  await expect(brief.locator(".crm-hand-steps li").first()).toHaveAttribute("data-late", "1");
  await expect(page.getByTestId("hand-steps-stay")).toContainText("Its 2 open follow-ups stay in your queue");
  await expect(page.getByRole("switch", { name: "Move the open follow-ups across" })).toHaveCount(0);
  await expect(brief.locator(".crm-hand-last li")).toHaveCount(3);
  // Who can take it: the others with a sales profile.
  const who = page.getByRole("radiogroup", { name: "Who picks it up?" });
  await expect(who.getByRole("radio")).toHaveText([/Priya$/, /Sam$/, /Leo$/]);
  await expect(page.getByTestId("hand-who-note")).toHaveText("Currently Dana Whitlock. Pick who takes it.");
  // "Tell the new owner" is the rule's real state (off as installed); the introduction to the customer is offered, and on,
  // since Petra has an address (S1).
  await expect(page.getByTestId("hand-tell")).toHaveText("The new owner is not told: the rule that tells them is switched off. The person who runs this install switches it on.");
  await expect(page.getByTestId("hand-introduce")).toHaveText("Introduce the new owner to the customer by email");
  await expect(page.getByTestId("hand-introduce")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#crm-hand-intro-note")).toHaveText("It goes to Petra Lindqvist a quarter of an hour after you hand the deal over.");
  await expect(page.getByRole("button", { name: "Pick who takes it" })).toBeDisabled();
  await picture(page, "7-dana-hand-over");

  // SHE HANDS OVER a deal of the spec's own, which has a follow-up, with a note for Priya.
  const deal = await makeDeal(dana, data, "Room spec: handed");
  const made = await dana.post(data("follow_ups"), { data: { values: { deal_id: deal.id, owner_id: deal.me, due_at: "2026-07-30T09:00:00.000Z", text: "Ring Ines about the lockers", kind: "step" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const stepId = ((await made.json()) as { data: { id: number } }).data.id;
  await page.goto(`${STAFF}hand-over/${String(deal.id)}`);
  await expect(which.getByRole("radio", { name: /Room spec: handed/ })).toHaveAttribute("aria-checked", "true");
  await who.getByRole("radio", { name: "Priya" }).click();
  await expect(page.getByTestId("hand-who-note")).toHaveText("Priya Raman picks it up from Dana Whitlock. Their board updates straight away.");
  await page.getByRole("textbox", { name: "Notes for them" }).fill("Ines decides. She wants the tall lockers and a price by Friday.");
  // She hands it over without introducing Priya to the customer: the tick is hers to take off, and nothing is written.
  await expect(page.getByTestId("hand-introduce")).toHaveText("Introduce Priya to the customer by email");
  await page.getByTestId("hand-introduce").click();
  await expect(page.getByTestId("hand-introduce")).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Hand it to Priya" }).click();
  const done = page.getByTestId("hand-done");
  await expect(done).toContainText("Room spec: handed is Priya Raman's now.");
  await expect(done).toContainText("Priya Raman owns the deal, its board card and its deal room.");
  await expect(done).toContainText("Your notes are on the deal, as a note.");
  await expect(page.getByTestId("hand-stayed")).toContainText("1 open follow-up stays with Dana.");
  await expect(done).toContainText("It is Priya's to open now, and no longer on your board.");
  await expect(page.getByTestId("hand-introduced")).toHaveCount(0);
  await expect(done.getByRole("link", { name: "Open the deal room" })).toHaveCount(0);
  // The server holds exactly that: Priya's deal, with Dana's note on it; not Dana's to read any more; her follow-up still hers.
  const handed = (await rows<{ owner_id: string }>(priya, data, "deals", { column: "id", op: "eq", value: deal.id }))[0]!;
  expect(handed.owner_id).toBe(priyaId);
  expect((await rows<{ kind: string; text: string; author_id: string }>(priya, data, "activities", { column: "deal_id", op: "eq", value: deal.id })).map((one) => [one.kind, one.text, one.author_id])).toEqual([["note", "Ines decides. She wants the tall lockers and a price by Friday.", deal.me]]);
  expect((await dana.get(data("deals", `/${String(deal.id)}`))).status()).toBe(404);
  expect((await rows<{ owner_id: string }>(dana, data, "follow_ups", { column: "id", op: "eq", value: stepId }))[0]!.owner_id).toBe(deal.me);
  // A rep may not give a follow-up of hers to a colleague: the server's refusal, which is why the page offers her no tick.
  const given = await dana.patch(data("follow_ups", `/${String(stepId)}`), { data: { values: { owner_id: priyaId } }, headers });
  expect(given.status()).toBe(403);
  expect(((await given.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("staff-column");
  await page.getByRole("button", { name: "Hand over another" }).click();
  await expect(which.getByRole("radio")).toHaveCount(6);
  expect(problems).toEqual([]);

  // THE SALES MANAGER hands it on to Sam, follow-ups and all: any of the team's open deals is hers to hand over.
  const ivyContext = await as("ivy");
  const ivy = ivyContext.request;
  const hers = await ivyContext.newPage();
  await hers.goto(`${STAFF}hand-over`);
  const team = hers.getByRole("radiogroup", { name: "Which deal?" });
  await expect(team.getByRole("radio")).toHaveCount(15);
  expect((await rows(ivy, data, "deals", { column: "state", op: "eq", value: "open" })).length).toBe(15);
  await team.getByRole("radio", { name: /Room spec: handed/ }).click();
  await expect(team.getByRole("radio", { name: /Room spec: handed/ })).toContainText("Cobalt Legal · Discovery · Priya");
  // The follow-up is still Dana's: she moves it herself first, as its owner's lead, by handing the deal back through Dana.
  const back = await ivy.post(data("deals", `/${String(deal.id)}/actions/hand-over`), { data: { from: "open", values: { owner_id: deal.me } }, headers: await csrf(ivy) });
  expect(back.status(), await back.text()).toBe(200);
  await expect(team.getByRole("radio", { name: /Room spec: handed/ })).toContainText("Cobalt Legal · Discovery · Dana");
  await expect(hers.getByTestId("hand-steps-title")).toHaveText("1 open follow-up on it");
  await expect(hers.getByRole("switch", { name: "Move the open follow-ups across" })).toHaveAttribute("aria-checked", "true");
  await hers.getByRole("radiogroup", { name: "Who picks it up?" }).getByRole("radio", { name: "Sam" }).click();
  await hers.getByRole("button", { name: "Hand it to Sam" }).click();
  const hersDone = hers.getByTestId("hand-done");
  await expect(hersDone).toContainText("Room spec: handed is Sam Okonjo's now.");
  await expect(hersDone).toContainText("1 open follow-up moved to Sam's queue.");
  // She left "Introduce Sam" on: the customer gets the introduction once its quarter-hour is up (S1); the spec's deal is
  // closed before then, which drops it.
  await expect(hers.getByTestId("hand-introduced")).toHaveText("Ines Vaughan gets an email introducing Sam in a quarter of an hour.");
  const queued = await rows<{ kind: string; status: string }>(await api("tessa"), data, "outbox", { and: [{ column: "deal_id", op: "eq", value: deal.id }, { column: "kind", op: "eq", value: "handover-intro" }] });
  expect(queued.map((one) => one.status)).toEqual(["queued"]);
  expect((await rows<{ owner_id: string }>(ivy, data, "deals", { column: "id", op: "eq", value: deal.id }))[0]!.owner_id).toBe(samId);
  expect((await rows<{ owner_id: string }>(ivy, data, "follow_ups", { column: "id", op: "eq", value: stepId }))[0]!.owner_id).toBe(samId);
  // She still reaches it: its room says whose it was, each change signed and dated, from the deal's own history.
  await hersDone.getByRole("link", { name: "Open the deal room" }).click();
  await expect(hers.getByTestId("room-owner")).toHaveText(/Sam Okonjo/);
  await expect(line(hers, "Handed over from Dana Whitlock to Priya Raman.")).toContainText("Dana Whitlock");
  await expect(line(hers, "Handed over from Dana Whitlock to Sam Okonjo.")).toContainText("Ivy Sandoval");
  await expect(line(hers, "Ines decides. She wants the tall lockers")).toContainText("Note");
  await picture(hers, "8-ivy-room-after-hand-over");

  // The refusals, by direct call: Read-only hands nothing over; another rep's deal is not there to hand over; nobody hands d1 to somebody else's name without the right.
  const grace = await api("grace");
  expect((await grace.post(data("deals", `/${String(deal.id)}/actions/hand-over`), { data: { from: "open", values: { owner_id: priyaId } }, headers: await csrf(grace) })).status()).toBe(403);
  expect((await priya.post(data("deals", `/${String(deal.id)}/actions/hand-over`), { data: { from: "open", values: { owner_id: priyaId } }, headers: await csrf(priya) })).status()).toBe(404);
  // Read-only has no line for it in her menu, and her address for it is refused.
  const graces = await (await as("grace")).newPage();
  await graces.goto(STAFF);
  await expect(graces.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Hand a deal over" })).toHaveCount(0);
  await retire(api, data, "Room spec: handed");
});

test("the room, the comments and the hand-over at 390 wide in the dark, and in Arabic right to left", async ({ as, data }) => {
  // As the sales manager: a person's requests are counted by the minute, and Dana has spent hers in the specs above.
  const context = await as("ivy", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const d1 = await dealNamed(context.request, data, "Fourth-floor desk rows");
  const page = await context.newPage();
  await page.goto(`${STAFF}deals/${String(d1.id)}`);
  await expect(page.getByTestId("room-amount")).toHaveText("£52,800");
  await expect(page.locator(".crm-room-line")).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  await noSideways(page);
  await picture(page, "9-ivy-room-390-dark");
  await page.goto(`${STAFF}deals/${String(d1.id)}/comments`);
  await expect(page.locator(".crm-cmt-thread")).toHaveCount(1);
  await expect(page.locator('[data-box="new"]').getByRole("combobox")).toBeVisible();
  await noSideways(page);
  await page.goto(`${STAFF}hand-over/${String(d1.id)}`);
  await expect(page.getByTestId("hand-brief")).toContainText("Fourth-floor desk rows");
  await noSideways(page);

  await inArabic(context.request, async () => {
    const arabic = await context.newPage();
    await arabic.goto(`${STAFF}deals/${String(d1.id)}`);
    await expect(arabic.getByRole("heading", { level: 2, name: "النشاط" })).toBeVisible();
    expect(await arabic.evaluate(() => document.documentElement.dir)).toBe("rtl");
    await expect(arabic.locator(".crm-room-line")).toHaveCount(7);
    await noSideways(arabic);
    await picture(arabic, "10-ivy-room-arabic");
    await arabic.goto(`${STAFF}deals/${String(d1.id)}/comments`);
    await expect(arabic.locator(".crm-cmt-thread")).toHaveCount(1);
    await noSideways(arabic);
    await arabic.close();
  });
});

test("with Quotes switched off the room has no quote card, and a deal's typed amount is still changed there", async ({ as, api, data }) => {
  const owner = await api("owner");
  const ownerHeaders = await csrf(owner);
  // As Priya, on a deal of her own; the sample's quoted deal is looked at by the sales manager.
  const context = await as("priya");
  const dana = context.request;
  const deal = await makeDeal(dana, data, "Room spec: no quotes");
  const ivyContext = await as("ivy");
  const d1 = await dealNamed(ivyContext.request, data, "Fourth-floor desk rows");
  const off = await owner.put("/api/v1/apps/crm/parts/quotes", { data: { on: false }, headers: ownerHeaders });
  expect(off.status(), await off.text()).toBe(200);
  try {
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}deals/${String(deal.id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Room spec: no quotes");
    await expect(page.getByTestId("room-quote")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Quotes" })).toHaveCount(0);
    await page.getByRole("button", { name: "Change the amount, now £4,000" }).click();
    await page.getByRole("textbox", { name: "Amount" }).fill("6100");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Amount is now £6,100. Weighted value follows.");
    await expect(page.getByTestId("room-amount")).toHaveText("£6,100");
    expect(Number((await dealNamed(dana, data, "Room spec: no quotes"))["amount"])).toBe(6100);
    // A deal that already stands at a sent quote keeps that amount, plainly: the part being off does not turn it back into a field.
    expect(problems).toEqual([]);
    const hers = await ivyContext.newPage();
    await hers.goto(`${STAFF}deals/${String(d1.id)}`);
    await expect(hers.getByTestId("room-amount")).toHaveText("£52,800");
    await expect(hers.getByTestId("room-quote")).toHaveCount(0);
    await expect(hers.getByTestId("room-amount-source")).toHaveCount(0);
    await expect(hers.getByRole("button", { name: /Change the amount/ })).toHaveCount(0);
    await expect(hers.locator(".crm-room-line")).toHaveCount(7);
  } finally {
    expect((await owner.put("/api/v1/apps/crm/parts/quotes", { data: { on: true }, headers: ownerHeaders })).status()).toBe(200);
  }
  await retire(api, data, "Room spec: no quotes");
});

// A person's requests are counted by the minute, and the next file's first spec is Dana's: her minute is let run out here.
test.afterAll(async () => {
  await minuteOut();
});
