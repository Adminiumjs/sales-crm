/**
 * Call notes (ledger §25; the piece of P04 decision 96 left unbuilt).
 *
 * d1 "Fourth-floor desk rows" as Dana, from its room: 52,800 · Negotiation
 * 75 % · 14 days in stage · closes Fri 14 Aug; where it was left (the three
 * newest things logged), the customer's people, the calls lined up today.
 * Nothing is saved on a sample deal: every call here is logged on a deal of
 * the spec's own ("Spec: call …"), taken away at the end with what it holds,
 * so the timeline, the feed and the nudges keep the ledger's figures.
 *
 * A call is one row of `activities`; a line "Next step: …" is a follow-up of
 * the writer's, due Wed 29 Jul 2026 at 10:00 London. Proved: the owner, her
 * manager, a helper; Read-only with nothing to press and the server refusing;
 * another rep (no such deal); the marketer (not her role, and 403); a lost
 * reply; two people (the manager's open room follows); 390 dark; Arabic.
 *
 * THE FILE'S NAME PUTS IT JUST BEFORE THE DEAL ROOM'S, which spends most of
 * Dana's minute of requests (300) by itself: this file lets her minute run out
 * when it ends, as the helpers' `minuteOut` is for.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, dealNamed, inArabic, minuteOut, removeDeals, rows, STAFF, watch, type Data } from "./helpers.ts";

const userId = async (person: APIRequestContext): Promise<string> => ((await (await person.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
const noSideways = async (page: Page): Promise<void> => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
/** Tomorrow at 10:00 in London, on the ledger's Tuesday: Wednesday 29 July, 09:00 UTC. */
const DUE = "2026-07-29T09:00:00.000Z";

async function makeDeal(dana: APIRequestContext, data: Data, name: string): Promise<number> {
  const me = await userId(dana);
  const stages = await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const ines = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Ines Vaughan" }))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name, company_id: ines.company_id, contact_id: ines.id, owner_id: me, stage_id: stages[1]!.id, typed_amount: 6400, expected_close: "2026-09-30" } }, headers: await csrf(dana) });
  expect(made.status(), await made.text()).toBe(201);
  return ((await made.json()) as { data: { id: number } }).data.id;
}

const calls = (person: APIRequestContext, data: Data, dealId: number) => rows<{ id: number; kind: string; text: string; author_id: string }>(person, data, "activities", { and: [{ column: "deal_id", op: "eq", value: dealId }, { column: "kind", op: "eq", value: "call" }] }, "&order=id");
test.afterAll(async () => {
  await minuteOut();
});

const steps = (person: APIRequestContext, data: Data, dealId: number) => rows<{ id: number; owner_id: string; due_at: string; text: string; kind: string }>(person, data, "follow_ups", { column: "deal_id", op: "eq", value: dealId }, "&order=id");

test("Dana opens d1's call notes from its room: the ledger's figures, where it was left, the people, today's calls", async ({ as, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  const d1 = await dealNamed(dana, data, "Fourth-floor desk rows");
  await page.goto(`${STAFF}deals/${String(d1.id)}`);
  await page.getByRole("link", { name: "Call notes" }).click();
  await expect(page).toHaveURL(new RegExp(`${STAFF}deals/${String(d1.id)}/call$`));
  // The board's line stays lit: the screen is reached from the room.
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Pipeline board" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("call-live")).toHaveText("On the call");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fourth-floor desk rows");
  await expect(page.getByTestId("call-sub")).toHaveText(/^Nordwind Logistics · with Petra Lindqvist · Tue, Jul 28, \d\d:\d\d$/);
  // The deal's figures are its own, as the server answers Dana.
  await expect(page.getByTestId("call-amount")).toHaveText("£52,800");
  await expect(page.getByTestId("call-stage")).toHaveText("Negotiation · 75%");
  await expect(page.getByTestId("call-sitting")).toHaveText("14 days in stage");
  await expect(page.getByTestId("call-close")).toHaveText("Aug 14, 2026");
  expect([Number(d1["amount"]), Number(d1["stage_odds"]), String(d1["expected_close"]).slice(0, 10)]).toEqual([52800, 0.75, "2026-08-14"]);
  // Where it was left: the three newest things logged, as the server orders them.
  const newest = await rows<{ text: string }>(dana, data, "activities", { column: "deal_id", op: "eq", value: d1.id }, "&order=at.desc,id.desc");
  await expect(page.getByTestId("call-last").locator("li p")).toHaveText(newest.slice(0, 3).map((one) => one.text));
  // On the call: Nordwind's people, Petra marked, and Dana.
  const nordwind = await rows<{ name: string }>(dana, data, "contacts", { column: "company_id", op: "eq", value: d1["company_id"] }, "&order=name");
  const people = page.getByRole("region", { name: "On the call" }).locator(".crm-room-person-name");
  await expect(people).toHaveText([...nordwind.map((one) => one.name), "Dana Whitlock"]);
  // The calls lined up today: her open follow-ups due by tonight, each deal once, this one first.
  const chips = page.getByRole("navigation", { name: "Calls lined up for today" }).getByRole("link");
  await expect(chips.first()).toHaveAttribute("aria-current", "page");
  await expect(chips.first()).toContainText("Nordwind Logistics");
  const due = await rows<{ deal_id: number }>(dana, data, "follow_ups", { and: [{ column: "owner_id", op: "eq", value: await userId(dana) }, { column: "done", op: "eq", value: false }, { column: "due_at", op: "lt", value: "2026-07-28T23:00:00.000Z" }] }, "&order=due_at");
  await expect(chips).toHaveCount(Math.min(5, new Set(due.map((one) => one.deal_id)).size));
  // Nothing typed: nothing to log.
  await expect(page.getByRole("button", { name: "Log the call" })).toBeDisabled();
  await expect(page.getByTestId("call-words")).toHaveText("0 words");
  // Worth asking at Negotiation, as the sales manager wrote it (S11): pressed, a question starts a line of the notes.
  const asking = page.getByTestId("call-asking");
  await expect(asking.getByRole("button")).toHaveText(["Who signs the order?", "Do the terms work as written?", "Is this the whole job, or is there more after it?", "What would make this close this month?"]);
  await asking.getByRole("button", { name: "Who signs the order?" }).click();
  await expect(page.getByRole("textbox", { name: "Notes from the call" })).toHaveValue("Who signs the order? ");
  await picture(page, "call-1-dana-d1");
  // A chip opens that deal's call notes.
  await chips.nth(1).click();
  await expect(page).toHaveURL(/\/deals\/\d+\/call$/);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Fourth-floor desk rows");
  expect(problems).toEqual([]);
});

test("a call logged by keyboard, its reply dropped: one call, one next step; the manager's open room follows; the manager logs too, a helper does not", async ({ as, api, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const name = "Spec: call notes";
  const dealId = await makeDeal(dana, data, name);
  try {
    const [danaId, ivyId, priyaId] = [await userId(dana), await userId(await api("ivy")), await userId(await api("priya"))];
    // IVY has the deal's room open first.
    const ivyContext = await as("ivy");
    const ivy = ivyContext.request;
    const room = await ivyContext.newPage();
    await room.goto(`${STAFF}deals/${String(dealId)}`);
    await expect(room.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(room.getByTestId("room-lines")).toBeVisible();
    const linesBefore = await room.locator('.crm-room-line[data-type="call"]').count();

    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}deals/${String(dealId)}/call`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByTestId("call-sub")).toContainText("Cobalt Legal · with Ines Vaughan");
    const notes = page.getByRole("textbox", { name: "Notes from the call" });
    await notes.focus();
    await page.keyboard.type("Ines is keen on the trial set.");
    await page.keyboard.press("Enter");
    // A mark's chip starts a line, and the focus is back in the notes.
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(notes).toBeFocused();
    await page.keyboard.type("send the revised layout");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Decision: chairs before desks");
    await expect(page.getByTestId("call-words")).toHaveText("17 words");
    await expect(page.getByTestId("call-items")).toHaveText("2 items");
    const picked = page.getByTestId("call-picked");
    await expect(picked.locator("li")).toHaveCount(2);
    await expect(picked.locator('li[data-mark="next"]')).toContainText("send the revised layout");
    await expect(picked.locator('li[data-mark="next"]')).toContainText("Wed, Jul 29, 10:00");
    await expect(picked.locator('li[data-mark="decision"]')).toContainText("chairs before desks");
    // While typing, no shortcut fires.
    await page.keyboard.type(" g w 2");
    await expect(page).toHaveURL(new RegExp(`/deals/${String(dealId)}/call$`));
    for (let i = 0; i < 6; i += 1) await page.keyboard.press("Backspace");

    // THE FIRST SAVE REACHES THE SERVER; ITS ANSWER IS DROPPED. The same key goes again and the server answers the row the first made.
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
    // By keyboard: Tab from the notes to "Log the call".
    await notes.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Log the call" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".crm-toast")).toHaveText("Logged, and 1 next step is on Dana’s queue for Wed, Jul 29, 10:00.");
    await page.unroute("**/api/v1/data/**");
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
    await expect(notes).toHaveValue("");
    // The server holds exactly one call, hers, and one follow-up, hers, due tomorrow at 10:00.
    const made = await calls(dana, data, dealId);
    expect(made.map((one) => [one.author_id, one.text])).toEqual([[danaId, "Call with Ines Vaughan.\nInes is keen on the trial set.\nNext step: send the revised layout\nDecision: chairs before desks"]]);
    expect((await steps(dana, data, dealId)).map((one) => [one.owner_id, one.due_at.replace(/\.\d+Z$/, ".000Z").replace("+00:00", ".000Z"), one.text, one.kind])).toEqual([[danaId, DUE, "send the revised layout", "step"]]);
    // It is where the deal was left now, on her page; and on Ivy's open room, with no reload.
    await expect(page.getByTestId("call-last").locator("li").first()).toContainText("Ines is keen on the trial set.");
    await expect(room.locator('.crm-room-line[data-type="call"]')).toHaveCount(linesBefore + 1);
    await expect(room.locator('.crm-room-line[data-type="call"]').first()).toContainText("Dana Whitlock");
    await picture(page, "call-2-dana-logged");
    // The one thing that went wrong is the reply the spec dropped.
    expect(problems.filter((one) => !one.includes("ERR_CONNECTION_RESET"))).toEqual([]);

    // HER MANAGER logs one: his, and his next step is his own.
    const ivyPage = await ivyContext.newPage();
    await ivyPage.goto(`${STAFF}deals/${String(dealId)}/call`);
    await ivyPage.getByRole("textbox", { name: "Notes from the call" }).fill("Next step: price the trial set");
    await ivyPage.getByRole("button", { name: "Log the call" }).click();
    await expect(ivyPage.locator(".crm-toast")).toHaveText("Logged, and 1 next step is on Ivy’s queue for Wed, Jul 29, 10:00.");
    expect((await calls(ivy, data, dealId)).map((one) => one.author_id)).toEqual([danaId, ivyId]);
    expect((await steps(ivy, data, dealId)).map((one) => [one.owner_id, one.text])).toEqual([
      [danaId, "send the revised layout"],
      [ivyId, "price the trial set"],
    ]);

    // A HELPER (ruling 1d): Dana adds Priya. Priya reads where the deal was left and logs nothing on it: Dana does. She is
    // told so where the notes box would be.
    expect((await dana.post(data("deal_members"), { data: { values: { deal_id: dealId, user_id: priyaId } }, headers: await csrf(dana) })).status()).toBe(201);
    const priyaContext = await as("priya");
    const hers = await priyaContext.newPage();
    const herProblems = watch(hers);
    await hers.goto(`${STAFF}deals/${String(dealId)}/call`);
    await expect(hers.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(hers.getByTestId("call-helping")).toHaveText("You’re helping on this deal: Dana logs its calls. Say what you know in its comments.");
    await expect(hers.getByRole("textbox", { name: "Notes from the call" })).toHaveCount(0);
    await expect(hers.getByRole("button", { name: "Log the call" })).toHaveCount(0);
    await expect(hers.getByTestId("call-live")).toHaveCount(0);
    await expect(hers.getByTestId("call-last").locator("li").first()).toContainText("price the trial set");
    // Her room has no "Call notes" link and no composer either.
    await hers.goto(`${STAFF}deals/${String(dealId)}`);
    await expect(hers.getByTestId("room-helping")).toBeVisible();
    await expect(hers.getByRole("link", { name: "Call notes" })).toHaveCount(0);
    await expect(hers.getByRole("form", { name: "Log it" })).toHaveCount(0);
    expect(herProblems).toEqual([]);
    expect((await calls(dana, data, dealId)).map((one) => one.author_id)).toEqual([danaId, ivyId]);
    expect((await steps(dana, data, dealId)).length).toBe(2);
  } finally {
    await removeDeals(await api("tessa"), data, "Spec: call");
  }
});

test("who may not: Read-only reads with nothing to press, another rep finds no deal, the marketer is refused; the server says the same", async ({ as, api, data }) => {
  const dana = await api("dana");
  const name = "Spec: call refusals";
  const dealId = await makeDeal(dana, data, name);
  try {
    // READ-ONLY: the page, where the deal was left, and no notes box.
    const graceContext = await as("grace");
    const grace = graceContext.request;
    const page = await graceContext.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}deals/${String(dealId)}/call`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByTestId("call-readonly")).toHaveText("Your role reads what was said on a call; it does not log one.");
    await expect(page.getByRole("textbox")).toHaveCount(1); // the top bar's search box, and nothing else
    await expect(page.getByRole("button", { name: "Log the call" })).toHaveCount(0);
    await expect(page.getByTestId("call-live")).toHaveCount(0);
    // Her room has no "Call notes" link either.
    await page.goto(`${STAFF}deals/${String(dealId)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("link", { name: "Call notes" })).toHaveCount(0);
    expect(problems).toEqual([]);
    const headers = await csrf(grace);
    expect((await grace.post(data("activities"), { data: { values: { deal_id: dealId, kind: "call", text: "no" } }, headers })).status()).toBe(403);
    expect((await grace.post(data("follow_ups"), { data: { values: { deal_id: dealId, owner_id: await userId(grace), due_at: DUE, text: "no", kind: "step" } }, headers })).status()).toBe(403);

    // ANOTHER REP: no such deal for Sam, by its address or by a direct call; his write is refused and nothing is made.
    const samContext = await as("sam");
    const sam = samContext.request;
    const his = await samContext.newPage();
    await his.goto(`${STAFF}deals/${String(dealId)}/call`);
    await expect(his.getByTestId("no-deal")).toContainText("No deal to open");
    expect((await sam.get(data("deals", `/${String(dealId)}`))).status()).toBe(404);
    const samWrite = await sam.post(data("activities"), { data: { values: { deal_id: dealId, kind: "call", text: "no" } }, headers: await csrf(sam) });
    expect(samWrite.status(), await samWrite.text()).toBe(SAM_REFUSED.status);
    expect(((await samWrite.json()) as { error: { code: string } }).error.code).toBe(SAM_REFUSED.code);
    expect(await calls(dana, data, dealId)).toEqual([]);

    // THE MARKETER: not her role, and the server refuses her the tables.
    const lenaContext = await as("lena");
    const lena = lenaContext.request;
    const hersPage = await lenaContext.newPage();
    await hersPage.goto(`${STAFF}deals/${String(dealId)}/call`);
    await expect(hersPage.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
    for (const ref of ["deals", "activities", "follow_ups"]) expect((await lena.get(data(ref, "?limit=1"))).status(), ref).toBe(403);
    expect((await lena.post(data("activities"), { data: { values: { deal_id: dealId, kind: "call", text: "no" } }, headers: await csrf(lena) })).status()).toBe(403);
  } finally {
    await removeDeals(await api("tessa"), data, "Spec: call");
  }
});

/**
 * What the server answers another rep writing a call on a deal that is not his: the deal is not there for him, so the
 * link to it is refused as a link to nothing (it says no more than a 404 would).
 */
const SAM_REFUSED = { status: 409, code: "FK_VIOLATION" };

test("390 wide in the dark, and in Arabic: the notes first, right to left, no sideways scroll", async ({ as, api, data }) => {
  const dana = await api("dana");
  const name = "Spec: call phone";
  const dealId = await makeDeal(dana, data, name);
  try {
    const context = await as("dana", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(`${STAFF}deals/${String(dealId)}/call`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    const notes = page.getByRole("textbox", { name: "Notes from the call" });
    await notes.fill("Blocker: budget sits with the partners");
    await expect(page.getByTestId("call-picked").locator('li[data-mark="blocker"]')).toContainText("budget sits with the partners");
    // On one column the notes come before where it was left.
    const [notesBox, lastBox] = [await notes.boundingBox(), await page.getByRole("region", { name: "Where we left it" }).boundingBox()];
    expect(notesBox!.y).toBeLessThan(lastBox!.y);
    await noSideways(page);
    await picture(page, "call-3-390-dark");
    await notes.fill("");

    await inArabic(dana, async () => {
      await page.goto(`${STAFF}deals/${String(dealId)}/call`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByTestId("call-live")).toHaveText("في المكالمة");
      const box = page.getByRole("textbox", { name: "ملاحظات من المكالمة" });
      await page.getByRole("button", { name: "الخطوة التالية" }).click();
      await expect(box).toHaveValue("الخطوة التالية: ");
      await expect(box).toBeFocused();
      await page.keyboard.type("أرسل المخطط");
      await expect(page.getByTestId("call-picked").locator('li[data-mark="next"]')).toContainText("أرسل المخطط");
      await page.getByRole("button", { name: "سجّل المكالمة" }).click();
      await expect(page.locator(".crm-toast")).toContainText("سُجّلت");
      expect((await calls(dana, data, dealId)).map((one) => one.text)).toEqual(["مكالمة مع Ines Vaughan.\nالخطوة التالية: أرسل المخطط"]);
      expect((await steps(dana, data, dealId)).map((one) => one.text)).toEqual(["أرسل المخطط"]);
      await noSideways(page);
      await picture(page, "call-4-arabic");
    });
  } finally {
    await removeDeals(await api("tessa"), data, "Spec: call");
  }
});
