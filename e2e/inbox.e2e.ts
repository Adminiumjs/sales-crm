/**
 * P14, the Inbox: the Team inbox (ledger §28), "Add an enquiry", Trade-show
 * leads (§58) with a pasted list, the marketer's home, and the front desk's
 * first page.
 *
 * Read mostly as Lena (marketer), Corin (front desk), Ivy and Tessa, so
 * Dana's minute is spent elsewhere. Everything a spec makes is named "P14 …"
 * and taken away as the CRM admin. Turning an enquiry into a deal is in
 * `y-inbox-claim.e2e.ts`, which runs late on purpose.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { authOf, expect, picture, stand as standOf, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

const NOT_LEAD = { or: [{ column: "show_id", op: "is_null" }, { column: "warmth", op: "is_null" }] };
const IS_LEAD = { and: [{ column: "show_id", op: "not_null" }, { column: "warmth", op: "not_null" }] };
const chip = (page: Page, filter: string) => page.locator(`.crm-chip-btn[data-filter="${filter}"]`);
const count = (page: Page, filter: string) => chip(page, filter).locator(".crm-chip-count");
const cards = (page: Page) => page.locator(".crm-enq");
const stat = (page: Page, name: string) => page.locator(`.crm-leads-stat[data-stat="${name}"]`);

const total = async (person: APIRequestContext, data: Data, condition?: unknown): Promise<number> => {
  const res = await person.get(data("enquiries", `?limit=1&select=id&count=exact${condition === undefined ? "" : `&where=${encodeURIComponent(JSON.stringify(condition))}`}`));
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { page: { total: number } }).page.total;
};

/** Take away what these specs made, as the CRM admin. */
async function clear(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const ref of ["enquiries", "shows"] as const) {
    for (const row of await rows<{ id: number }>(admin, data, ref, { column: ref === "shows" ? "name" : "company_name", op: "like", value: "P14 %" })) {
      expect((await admin.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status(), `${ref} ${String(row.id)}`).toBeLessThan(300);
    }
  }
}

test.beforeAll(async ({ browser }) => {
  // Nothing of an earlier, broken run is left to be counted.
  const state = standOf();
  const context = await browser.newContext({ baseURL: state.url, storageState: await authOf(browser, "tessa") });
  await clear(context.request, (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`);
  await context.close();
});

test("the Team inbox with the ledger's six, as the sales manager, and each count is the server's", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  // A long menu keeps its groups shut but Selling: the Inbox group is opened first.
  await page.getByRole("navigation", { name: "Menu" }).getByRole("button", { name: "Inbox" }).click();
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Team inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team inbox");
  // §28: 6 enquiries, 4 unclaimed, 1 passed (to Priya), 1 dropped, none claimed.
  await expect(count(page, "open")).toHaveText("4");
  await expect(count(page, "mine")).toHaveText("0");
  await expect(count(page, "all")).toHaveText("6");
  await expect(cards(page)).toHaveCount(4);
  const first = cards(page).first();
  await expect(first.locator(".crm-enq-subject")).toHaveText("Sixty desks for a new floor");
  await expect(first).toContainText("Web form");
  await expect(first.locator(".crm-enq-from")).toHaveText("Ines Vaughan · Cobalt Legal · ines.vaughan@cobaltlegal.example");
  await expect(first.locator(".crm-enq-size")).toHaveText("£44,000");
  await expect(first.locator(".crm-enq-when")).toHaveText("Today 08:12");
  await expect(first.locator("[data-match]")).toHaveText("Matches Cobalt Legal");
  await expect(cards(page).nth(1).locator(".crm-enq-when")).toHaveText("Yesterday 16:48");
  await expect(cards(page).nth(1).locator("[data-match]")).toHaveText("No company on the books");
  await expect(cards(page).nth(3).locator(".crm-enq-when")).toHaveText("4 days ago");
  // A manager claims, passes and drops.
  for (const act of ["claim", "pass", "drop"]) await expect(first.locator(`[data-act="${act}"]`)).toBeVisible();
  await expect(page.getByTestId("enquiry-add")).toBeVisible();

  await chip(page, "all").click();
  await expect(cards(page)).toHaveCount(6);
  await expect(cards(page).filter({ hasText: "Reception refit" })).toContainText("Passed to Priya, not claimed yet");
  await expect(cards(page).filter({ hasText: "Reception refit" }).locator(".crm-enq-settled")).toHaveText("Passed to Priya Raman. It is theirs to claim.");
  await expect(cards(page).filter({ hasText: "Two hundred sit-stand desks" }).locator(".crm-enq-settled")).toHaveText("Not for us.");
  await expect(cards(page).filter({ hasText: "Two hundred sit-stand desks" }).locator(".crm-enq-size")).toHaveText("£120,000");
  await chip(page, "mine").click();
  await expect(page.getByTestId("inbox-empty")).toContainText("Nothing is claimed by you or passed to you.");
  expect(problems).toEqual([]);
  await picture(page, "1-ivy-inbox");

  // What the server answers her, asked directly: the same three numbers.
  expect(await total(context.request, data, NOT_LEAD)).toBe(6);
  expect(await total(context.request, data, { and: [NOT_LEAD, { column: "state", op: "eq", value: "open" }] })).toBe(4);
  expect(await total(context.request, data, { column: "state", op: "eq", value: "claimed" })).toBe(0);
});

test("a rep's inbox is the unclaimed ones and her own, show leads passed to her among them", async ({ as, data, stand }) => {
  const context = await as("priya");
  const page = await context.newPage();
  await page.goto(`${STAFF}inbox`);
  const me = stand.people["priya"]!.id;
  const mine = { or: [{ column: "claimed_by_id", op: "eq", value: me }, { column: "passed_to_id", op: "eq", value: me }] };
  const hers = await total(context.request, data);
  const open = await total(context.request, data, { column: "state", op: "eq", value: "open" });
  const own = await total(context.request, data, mine);
  // Priya: the four nobody has, the dropped one nobody had, e5 passed to her, and her two leads from the show.
  expect([open, own, hers]).toEqual([4, 3, 8]);
  await expect(count(page, "open")).toHaveText(String(open));
  await expect(count(page, "mine")).toHaveText(String(own));
  await expect(count(page, "all")).toHaveText(String(hers));
  await chip(page, "mine").click();
  await expect(cards(page)).toHaveCount(3);
  const passed = cards(page).filter({ hasText: "Reception refit" });
  await expect(passed).toContainText("Passed to you");
  // Hers to claim; passing on again is not a move the server has.
  await expect(passed.locator('[data-act="claim"]')).toBeVisible();
  await expect(passed.locator('[data-act="pass"]')).toHaveCount(0);
  const lead = cards(page).filter({ hasText: "Sixty task chairs" });
  await expect(lead).toContainText("Keen");
  await expect(lead.locator('[data-act="rung"]')).toBeVisible();
  // A colleague's lead is not hers to read, by number.
  const others = await rows<{ id: number }>(await (await as("tessa")).request, data, "enquiries", { column: "company_name", op: "eq", value: "Kestrel Print" });
  expect((await context.request.get(data("enquiries", `/${String(others[0]!.id)}`))).status()).toBe(404);
});

test("the front desk lands on the Inbox, passes and adds, and is offered no claim", async ({ as, api, data, stand }) => {
  const context = await as("corin");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  const menu = page.getByRole("navigation", { name: "Menu" }).getByRole("link");
  if (stand.parts.includes("showroom")) {
    // From stage 2 she lands on her own home, the showroom's day; the Team inbox is the last line of her menu.
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.locator('[data-screen="deskhome"]')).toBeVisible();
    await unfoldMenu(page);
    await expect(menu).toHaveText(["Home", "Showroom bookings", "Showroom follow-ups", "Sample library", "Sample returns chase", "Display stock", "Team inbox"]);
    await menu.filter({ hasText: "Team inbox" }).click();
  } else {
    // Decision 48: at stage 1 the front desk is left with the Inbox, and that is where she lands.
    await expect(menu).toHaveText(["Team inbox"]);
  }
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(count(page, "open")).toHaveText("4");
  await expect(count(page, "all")).toHaveText(String(await total(context.request, data)));
  await expect(count(page, "all")).toHaveText("5");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team inbox");
  await expect(page.locator(".crm-screen-sub")).toContainText("pass each one to a rep");
  const first = cards(page).first();
  await expect(first.locator('[data-act="pass"]')).toBeVisible();
  await expect(first.locator('[data-act="drop"]')).toBeVisible();
  await expect(page.locator('[data-act="claim"]')).toHaveCount(0);
  await expect(page.getByTestId("enquiry-add")).toBeVisible();
  expect(problems).toEqual([]);

  // She starts no deal and ties no enquiry to one: the server's refusals, by direct call.
  const direct = await api("corin");
  const headers = await csrf(direct);
  expect((await direct.get(data("deals", "?limit=1"))).status()).toBe(403);
  expect((await direct.post(data("deals"), { data: { values: { name: "P14 not hers" }, clientKey: "p14corindealAAAAAAAAAAAAAAAAAAAA" }, headers })).status()).toBe(403);
  const free = (await rows<{ id: number }>(direct, data, "enquiries", { column: "company_name", op: "eq", value: "Westgate Care" }))[0]!;
  expect((await direct.patch(data("enquiries", `/${String(free.id)}`), { data: { values: { deal_id: 1 } }, headers })).status()).toBe(403);
});

test("Add an enquiry at the front desk, its first reply lost: one enquiry, and the marketer's open home follows", async ({ as, api, data }) => {
  const admin = await api("tessa");
  // Two people signed in: the marketer is looking at her home.
  const lena = await (await as("lena")).newPage();
  await lena.goto(STAFF);
  await expect(lena).toHaveURL(/\/home$/);
  await expect(stat(lena, "month").locator(".crm-leads-value")).toHaveText("17");

  const context = await as("corin");
  const page = await context.newPage();
  await page.goto(`${STAFF}inbox`);
  await expect(count(page, "open")).toHaveText("4");
  const opener = page.getByTestId("enquiry-add");
  await opener.click();
  const sheet = page.getByRole("dialog", { name: "Add an enquiry" });
  // The keyboard starts in the company's name.
  await expect(sheet.getByLabel("Company")).toBeFocused();
  await sheet.getByRole("button", { name: "Add it to the inbox" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Say which company it is from.");
  await sheet.getByLabel("Company").fill("P14 Tide Mill Bakery");
  await sheet.getByLabel("What they want").fill("A counter and twelve stools");
  await sheet.getByLabel("What they said").fill("Ana rang from the bakery. Opening in October.");
  await sheet.getByLabel("Who asked").fill("Ana Brandt");
  await sheet.getByLabel("Phone").fill("0117 496 0000");
  await sheet.getByLabel("Rough size").fill("9,500");
  await expect(sheet.locator("#crm-enq-size-read")).toHaveText("Reads as £9,500");
  await expect(sheet.getByRole("radio", { name: "Phone" })).toHaveAttribute("aria-checked", "true");

  // The first save reaches the server and is written; its answer never arrives.
  const sent: { key: string; replayed: boolean | null }[] = [];
  let dropped = false;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_enquiries$/.test(new URL(request.url()).pathname)) return route.fallback();
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
  try {
    await sheet.getByRole("button", { name: "Add it to the inbox" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("P14 Tide Mill Bakery is in the inbox.");
    await expect(sheet).toHaveCount(0);
    // The focus goes back to the button that opened the dialog.
    await expect(opener).toBeFocused();
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
    await page.unroute("**/api/v1/data/**");
    const made = await rows<{ id: number; state: string; source: string; est_value: number; claimed_by_id: string | null }>(admin, data, "enquiries", { column: "company_name", op: "eq", value: "P14 Tide Mill Bakery" });
    expect(made.map((row) => [row.state, row.source, Number(row.est_value), row.claimed_by_id])).toEqual([["open", "phone", 9500, null]]);
    await expect(count(page, "open")).toHaveText("5");
    await expect(cards(page).first().locator(".crm-enq-subject")).toHaveText("A counter and twelve stools");
    await expect(cards(page).first().locator(".crm-enq-from")).toHaveText("Ana Brandt · P14 Tide Mill Bakery · 0117 496 0000");

    // Live: Lena's home, never reloaded, counts it.
    await expect(stat(lena, "month").locator(".crm-leads-value")).toHaveText("18");
    await expect(lena.locator('.crm-mk-rows li[data-source="phone"]')).toContainText("2 enquiries", { timeout: 45_000 });

  } finally {
    await page.unroute("**/api/v1/data/**").catch(() => undefined);
    await clear(admin, data);
  }
  await expect(stat(lena, "month").locator(".crm-leads-value")).toHaveText("17");
});

test("the front desk passes an enquiry to a rep by keyboard: it becomes his, and leaves her list", async ({ as, api, data, stand }) => {
  const admin = await api("tessa");
  await clear(admin, data);
  const corin = await api("corin");
  const made = await corin.post(data("enquiries"), { data: { values: { source: "phone", company_name: "P14 Tide Mill Bakery", person: "Ana Brandt", wants: "A counter and twelve stools" }, clientKey: "p14passAAAAAAAAAAAAAAAAAAAAAAAAA" }, headers: await csrf(corin) });
  expect(made.status(), await made.text()).toBe(201);
  const page = await (await as("corin")).newPage();
  try {
    await page.goto(`${STAFF}inbox`);
    await expect(count(page, "open")).toHaveText("5");
    // Passed to a rep with the keyboard: the picker opens under the card, and the server holds who.
    const card = cards(page).filter({ hasText: "A counter and twelve stools" });
    await card.locator('[data-act="pass"]').focus();
    await page.keyboard.press("Enter");
    const picker = card.getByRole("group", { name: "Pass it to" });
    await expect(picker.getByRole("button", { name: "Never mind" })).toBeVisible();
    await picker.getByRole("button", { name: "Leo" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("“A counter and twelve stools” is passed to Leo.");
    const after = (await rows<{ state: string; passed_to_id: string }>(admin, data, "enquiries", { column: "company_name", op: "eq", value: "P14 Tide Mill Bakery" }))[0]!;
    expect([after.state, after.passed_to_id]).toEqual(["passed", stand.people["leo"]!.id]);
    // Passed on, it is the rep's: the front desk no longer reads it, and her count goes back.
    await expect(count(page, "open")).toHaveText("4");
    await expect(cards(page).filter({ hasText: "A counter and twelve stools" })).toHaveCount(0);
    // Leo finds it under "Mine", his to claim.
    const leo = await api("leo");
    expect((await rows<{ state: string }>(leo, data, "enquiries", { column: "company_name", op: "eq", value: "P14 Tide Mill Bakery" })).map((row) => row.state)).toEqual(["passed"]);
    // Somebody who cannot open enquiries is not somebody to pass one to: the server's refusal (the operations manager).
    const other = await corin.post(data("enquiries"), { data: { values: { source: "phone", company_name: "P14 Second" }, clientKey: "p14pass2AAAAAAAAAAAAAAAAAAAAAAAA" }, headers: await csrf(corin) });
    const second = ((await other.json()) as { data: { id: number } }).data.id;
    expect((await corin.post(data("enquiries", `/${String(second)}/actions/pass`), { data: { from: "open", values: { passed_to_id: stand.people["ada"]!.id } }, headers: await csrf(corin) })).status()).toBe(422);
    // …nor by writing the column straight, with the move or without it: the button is not the only door.
    for (const values of [{ passed_to_id: stand.people["ada"]!.id }, { passed_to_id: stand.people["ada"]!.id, state: "passed" }]) {
      expect((await corin.patch(data("enquiries", `/${String(second)}`), { data: { values }, headers: await csrf(corin) })).status()).toBe(422);
    }
    // And the front desk claims none, by the button or by a call.
    expect((await corin.patch(data("enquiries", `/${String(second)}`), { data: { values: { state: "claimed" } }, headers: await csrf(corin) })).status()).toBeGreaterThanOrEqual(400);
    // And "passed" needs a somebody: the move with nobody named is refused.
    expect([409, 422]).toContain((await corin.post(data("enquiries", `/${String(second)}/actions/pass`), { data: { from: "open" }, headers: await csrf(corin) })).status());
  } finally {
    await clear(admin, data);
  }
});

test("Read-only reads the inbox with no control, contact details kept from her; the server refuses her and the roles with no Inbox", async ({ as, api, data }) => {
  const page = await (await as("grace", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await page.goto(`${STAFF}inbox`);
  await expect(count(page, "open")).toHaveText("4");
  await expect(count(page, "all")).toHaveText("6");
  // Who asked is a person's name (0.2.3): kept from her with the address and the phone.
  await expect(cards(page).first().locator(".crm-enq-from")).toHaveText("Cobalt Legal · contact details are hidden for your role");
  await expect(page.locator(".crm-enq [data-act]")).toHaveCount(0);
  await expect(page.getByTestId("enquiry-add")).toHaveCount(0);
  // 390 wide, dark: nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(page, "2-grace-inbox-390-dark");

  const grace = await api("grace");
  const headers = await csrf(grace);
  const e2 = (await rows<{ id: number; email: string | null; _masked?: string[] }>(grace, data, "enquiries", { column: "company_name", op: "eq", value: "Westgate Care" }))[0]!;
  expect([e2.email, e2._masked]).toEqual([null, ["person", "email", "phone"]]);
  expect((await grace.post(data("enquiries"), { data: { values: { source: "phone", company_name: "P14 not hers" }, clientKey: "p14graceAAAAAAAAAAAAAAAAAAAAAAAA" }, headers })).status()).toBe(403);
  expect((await grace.post(data("enquiries", `/${String(e2.id)}/actions/claim`), { data: { from: "open" }, headers })).status()).toBe(403);
  expect((await grace.patch(data("enquiries", `/${String(e2.id)}`), { data: { values: { rung_at: "2026-07-28T09:00:00.000Z" } }, headers })).status()).toBe(403);

  // The marketer reads every enquiry and changes none: no Team inbox in her menu, and the server refuses her the moves.
  const lena = await api("lena");
  const hers = await csrf(lena);
  expect(await total(lena, data)).toBe(17);
  expect((await lena.post(data("enquiries", `/${String(e2.id)}/actions/claim`), { data: { from: "open" }, headers: hers })).status()).toBe(403);
  expect((await lena.post(data("enquiries", `/${String(e2.id)}/actions/not-for-us`), { data: { from: "open" }, headers: hers })).status()).toBe(403);
  expect((await lena.patch(data("enquiries", `/${String(e2.id)}`), { data: { values: { state: "claimed" } }, headers: hers })).status()).toBe(403);
  const inbox = await (await as("lena")).newPage();
  await inbox.goto(`${STAFF}inbox`);
  await expect(inbox.getByText("This page is not part of your role")).toBeVisible();

  // The account manager and the operations manager have no Inbox: every door answers 403.
  for (const person of ["hugo", "ada"]) {
    const direct = await api(person);
    expect((await direct.get(data("enquiries", "?limit=1"))).status(), person).toBe(403);
    expect((await direct.get(data("shows", "?limit=1"))).status(), person).toBe(403);
    expect((await direct.post(data("enquiries"), { data: { values: { source: "phone", company_name: "P14 no" }, clientKey: `p14${person}AAAAAAAAAAAAAAAAAAAAAAAAAAAA`.slice(0, 32) }, headers: await csrf(direct) })).status(), person).toBe(403);
  }
  const hugo = await (await as("hugo")).newPage();
  await hugo.goto(`${STAFF}inbox`);
  await expect(hugo.getByText("This page is not part of your role")).toBeVisible();
});

test("Trade-show leads as the marketer: the ledger's figures, each the server's, and nothing she can press but the list", async ({ as, data }) => {
  const context = await as("lena");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Trade show leads" }).click();
  await expect(page).toHaveURL(/\/trade-show-leads$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trade show leads");
  await expect(page.locator(".crm-screen-sub")).toContainText("A lead goes cold after 14 days");
  await expect(page.getByTestId("leads-show")).toHaveText("The Leeds Workspace Show · Wed, Jul 15 – Thu, Jul 16");
  // §58: scanned 11; still to ring 3 (1 keen); spoken to 6; became a deal 0; not for us 2.
  await expect(stat(page, "scanned").locator(".crm-leads-value")).toHaveText("11");
  await expect(stat(page, "new").locator(".crm-leads-value")).toHaveText("3");
  await expect(stat(page, "new").locator(".crm-leads-note")).toHaveText("1 of them was keen");
  await expect(stat(page, "deal").locator(".crm-leads-value")).toHaveText("0");
  await expect(stat(page, "deal").locator(".crm-leads-note")).toHaveText("None yet · spoken to 6");
  await expect(page.getByTestId("leads-hot")).toHaveText("Sadie Kwan at Verity Insurance was keen on the stand and was scanned 12 days ago with no call yet. A lead goes cold after 14 days: the first day’s leads on Wed, Jul 29.");
  for (const [filter, n] of [["all", "11"], ["new", "3"], ["called", "6"], ["deal", "0"], ["no", "2"]] as const) await expect(count(page, filter), filter).toHaveText(n);
  await expect(cards(page)).toHaveCount(11);
  // The order to work in: to ring first, the keen one first among them.
  const first = cards(page).first();
  await expect(first.locator(".crm-enq-subject")).toHaveText("Verity Insurance");
  await expect(first.locator("[data-lead-pill]")).toHaveText("To ring");
  await expect(first.locator(".crm-lead-warm")).toHaveText("Keen");
  await expect(first.locator(".crm-enq-from")).toHaveText("Sadie Kwan · Manchester");
  await expect(first.locator(".crm-lead-want")).toHaveText("Sixty task chairs");
  await expect(first.locator(".crm-enq-when")).toHaveText("Thu, Jul 16");
  await expect(first.locator(".crm-lead-age")).toHaveText("goes cold in 2 days");
  await expect(first.locator(".crm-lead-rep")).toContainText("Priya");
  await expect(cards(page).nth(1).locator("[data-lead-pill]")).toHaveText("To ring");
  await expect(cards(page).nth(3).locator("[data-lead-pill]")).toHaveText("Spoken to");
  await expect(cards(page).last().locator("[data-lead-pill]")).toHaveText("Not for us");
  // She reads; she changes none of them. She brings a list in.
  await expect(page.locator(".crm-enq [data-act]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Paste a list" })).toBeVisible();
  await chip(page, "no").click();
  await expect(cards(page)).toHaveCount(2);
  await chip(page, "deal").click();
  await expect(page.getByTestId("leads-empty")).toContainText("Try another filter.");
  expect(problems).toEqual([]);
  await picture(page, "3-lena-leads");

  // The same numbers, asked of the server directly as her.
  const of = (more: unknown[]): Promise<number> => total(context.request, data, { and: [IS_LEAD, ...more] });
  expect(await of([])).toBe(11);
  expect(await of([{ column: "deal_id", op: "is_null" }, { column: "state", op: "neq", value: "dropped" }, { column: "rung_at", op: "is_null" }])).toBe(3);
  expect(await of([{ column: "deal_id", op: "is_null" }, { column: "state", op: "neq", value: "dropped" }, { column: "rung_at", op: "is_null" }, { column: "warmth", op: "eq", value: "hot" }])).toBe(1);
  expect(await of([{ column: "deal_id", op: "is_null" }, { column: "state", op: "neq", value: "dropped" }, { column: "rung_at", op: "not_null" }])).toBe(6);
  expect(await of([{ column: "state", op: "eq", value: "dropped" }])).toBe(2);
  expect(await of([{ column: "deal_id", op: "not_null" }])).toBe(0);
});

test("the CRM admin rings a lead and drops one; Read-only and a rep do not; 390 wide in Arabic", async ({ as, api, data, stand }) => {
  const admin = await api("tessa");
  const headers = await csrf(admin);
  const show = (await rows<{ id: number }>(admin, data, "shows"))[0]!;
  await clear(admin, data);
  // Two leads of the show, made for this spec (as the marketer makes them: scanned, nobody's yet).
  const lena = await api("lena");
  for (const [n, warmth] of [["One", "hot"], ["Two", "cold"]] as const) {
    const made = await lena.post(data("enquiries"), { data: { values: { source: "show", company_name: `P14 Lead ${n}`, person: `Person ${n}`, town: "Leeds", wants: `Desks ${n}`, warmth, show_id: show.id }, clientKey: `p14lead${n}AAAAAAAAAAAAAAAAAAAAAAAAAAAA`.slice(0, 32) }, headers: await csrf(lena) });
    expect(made.status(), await made.text()).toBe(201);
  }
  try {
    const page = await (await as("tessa")).newPage();
    await page.goto(`${STAFF}trade-show-leads`);
    await expect(count(page, "all")).toHaveText("13");
    await expect(count(page, "new")).toHaveText("5");
    await expect(stat(page, "new").locator(".crm-leads-note")).toHaveText("2 of them were keen");
    await expect(page.getByTestId("leads-hot")).toContainText("2 keen leads have not had a call yet.");
    const one = cards(page).filter({ hasText: "P14 Lead One" });
    for (const act of ["rung", "deal", "drop"]) await expect(one.locator(`[data-act="${act}"]`)).toBeVisible();
    await one.locator('[data-act="rung"]').click();
    await expect(page.locator(".crm-toast")).toHaveText("Person One is marked as rung.");
    await expect(count(page, "new")).toHaveText("4");
    await expect(count(page, "called")).toHaveText("7");
    await expect(one.locator("[data-lead-pill]")).toHaveText("Spoken to");
    await expect(one.locator('[data-act="rung"]')).toHaveCount(0);
    // The moment is the server's clock (the stand lives on 28 July 2026), not the browser's.
    const rung = (await rows<{ rung_at: string }>(admin, data, "enquiries", { column: "company_name", op: "eq", value: "P14 Lead One" }))[0]!;
    expect(rung.rung_at.slice(0, 10)).toBe("2026-07-28");
    const two = cards(page).filter({ hasText: "P14 Lead Two" });
    await two.locator('[data-act="drop"]').click();
    await expect(page.locator(".crm-toast")).toHaveText("Left it. Better than chasing it.");
    await expect(count(page, "no")).toHaveText("3");
    await expect(count(page, "new")).toHaveText("3");
    // Dropped twice is refused by the server: the move starts from a state it has left.
    const dropped = (await rows<{ id: number; state: string }>(admin, data, "enquiries", { column: "company_name", op: "eq", value: "P14 Lead Two" }))[0]!;
    expect(dropped.state).toBe("dropped");
    expect([409, 422]).toContain((await admin.post(data("enquiries", `/${String(dropped.id)}/actions/not-for-us`), { data: { from: "open" }, headers })).status());

    // Read-only: the list, no control. A rep: not her page, and the server answers her only her own leads.
    const grace = await (await as("grace")).newPage();
    await grace.goto(`${STAFF}trade-show-leads`);
    await expect(count(grace, "all")).toHaveText("13");
    await expect(grace.locator(".crm-enq [data-act]")).toHaveCount(0);
    await expect(grace.getByRole("link", { name: "Paste a list" })).toHaveCount(0);
    // Sam is answered the three leads passed to him at the show, and the two of this spec that nobody has yet.
    const sam = await api("sam");
    expect(await total(sam, data, { and: [...IS_LEAD.and, { column: "passed_to_id", op: "eq", value: stand.people["sam"]!.id }] })).toBe(3);
    expect(await total(sam, data, IS_LEAD)).toBe(5);
    const his = await (await as("sam")).newPage();
    await his.goto(`${STAFF}trade-show-leads`);
    await expect(his.getByText("This page is not part of your role")).toBeVisible();
  } finally {
    await clear(admin, data);
  }

  // Arabic, right to left, 390 wide: the marketer's own language setting.
  const lenaApi = await api("lena");
  await inArabic(lenaApi, async () => {
    const narrow = await (await as("lena", { viewport: { width: 390, height: 844 } })).newPage();
    await narrow.goto(`${STAFF}trade-show-leads`);
    await expect(narrow.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(narrow.getByRole("heading", { level: 1 })).toHaveText("عملاء المعرض المحتملون");
    await expect(count(narrow, "all")).toHaveText("١١");
    expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await picture(narrow, "4-lena-leads-ar-390");
  });
  expect(stand.people["lena"]).toBeDefined();
});

test("a show's list is pasted: every line a lead of that show for the CRM admin, dated the show's day; the marketer's dated the day she brings it; a rep's is refused outright", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await clear(admin, data);
  const show = (await rows<{ id: number; name: string }>(admin, data, "shows"))[0]!;
  const mapping = (wizard: ReturnType<Page["locator"]>) => wizard.locator('[data-part="mapping-row"] [data-part="mapping-target"]').evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value));
  try {
    const page = await (await as("tessa")).newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}trade-show-leads`);
    await page.getByRole("link", { name: "Paste a list" }).click();
    await expect(page).toHaveURL(/\/trade-show-leads\/paste$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paste a show’s leads");
    await expect(page.locator("#crm-paste-which")).toHaveValue(String(show.id));
    const wizard = page.locator('[data-kit-part="import"]');
    // As copied out of a sheet: tabs, the stand's own headings. One line stops short of "how keen".
    await wizard.getByRole("textbox").fill(["Company\tWho asked\tTown\tWhat they want\tHow keen", "P14 Paste One\tAda Lovell\tLeeds\tTwelve desks\thot", "P14 Paste Two\tBo Tran\tYork\tA boardroom table\twarm", "P14 Paste Three\tCy Oduya\tHull"].join("\n"));
    await wizard.getByTestId("import-paste-use").click();
    // The cells this screen adds are in front, and matched like any other column: a trade show, which show, and when it was scanned.
    await expect.poll(() => mapping(wizard)).toEqual(["source", "show_id", "received_at", "company_name", "person", "town", "wants", "warmth"]);
    // Matched on nothing: every line is new, and no personal column is ever a match column.
    const match = wizard.getByTestId("import-match-on");
    if ((await match.count()) > 0) await expect(match).toHaveValue("");
    await wizard.getByTestId("wizard-validate").click();
    await expect(wizard.getByTestId("validation-summary")).toHaveText("3 new lines will be brought in.");
    await wizard.getByTestId("wizard-run").click();
    await expect(wizard.getByTestId("import-review")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".crm-toast")).toHaveText("3 leads were brought in.");
    const made = await rows<{ company_name: string; source: string; show_id: number; warmth: string | null; state: string; town: string; person: string; received_at: string }>(admin, data, "enquiries", { column: "company_name", op: "like", value: "P14 Paste%" }, "&order=company_name");
    // Scanned on the show's first day, at noon in London.
    expect(made.map((row) => [row.company_name, row.source, row.show_id, row.warmth, row.state, row.town, row.person, row.received_at])).toEqual([
      ["P14 Paste One", "show", show.id, "hot", "open", "Leeds", "Ada Lovell", "2026-07-15T11:00:00.000Z"],
      ["P14 Paste Three", "show", show.id, null, "open", "Hull", "Cy Oduya", "2026-07-15T11:00:00.000Z"],
      ["P14 Paste Two", "show", show.id, "warm", "open", "York", "Bo Tran", "2026-07-15T11:00:00.000Z"],
    ]);
    expect(problems).toEqual([]);
    // Back on the leads: the two with a "how keen" are leads of the show; the one without went to the Team inbox.
    await wizard.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/trade-show-leads$/);
    await expect(count(page, "all")).toHaveText("13");
    await expect(cards(page).filter({ hasText: "P14 Paste One" })).toContainText("Twelve desks");
    await expect(cards(page).filter({ hasText: "P14 Paste One" }).locator(".crm-lead-age")).toHaveText("goes cold in 1 day");
    await expect(cards(page).filter({ hasText: "P14 Paste Three" })).toHaveCount(0);
    expect(await total(admin, data, { and: [NOT_LEAD, { column: "company_name", op: "eq", value: "P14 Paste Three" }] })).toBe(1);
    await clear(admin, data);

    /*
     * THE MARKETER'S LIST (decision 14; decision 120 turned 115 round). A brought-in line is her create: the table's stamps
     * fill what it leaves out, so "received at" is the day she brings it in (she may not say a show's day herself), and
     * the lines come in whole.
     */
    const hers = await (await as("lena")).newPage();
    await hers.goto(`${STAFF}trade-show-leads/paste`);
    const wizard2 = hers.locator('[data-kit-part="import"]');
    await wizard2.getByRole("textbox").fill(["Company\tWho asked\tHow keen", "P14 Hers One\tDi Park\thot", "P14 Hers Two\tEd Roe\twarm"].join("\n"));
    await wizard2.getByTestId("import-paste-use").click();
    await expect.poll(() => mapping(wizard2)).toEqual(["source", "show_id", "company_name", "person", "warmth"]);
    await wizard2.getByTestId("wizard-validate").click();
    await expect(wizard2.getByTestId("validation-summary")).toHaveText("2 new lines will be brought in.");
    await wizard2.getByTestId("wizard-run").click();
    await expect(wizard2.getByTestId("import-review")).toBeVisible({ timeout: 30_000 });
    await expect(hers.locator(".crm-toast")).toHaveText("2 leads were brought in.");
    const brought = await rows<{ company_name: string; source: string; show_id: number; warmth: string; state: string; received_at: string | null }>(admin, data, "enquiries", { column: "company_name", op: "like", value: "P14 Hers%" }, "&order=company_name");
    expect(brought.map((row) => [row.company_name, row.source, row.show_id, row.warmth, row.state])).toEqual([
      ["P14 Hers One", "show", show.id, "hot", "open"],
      ["P14 Hers Two", "show", show.id, "warm", "open"],
    ]);
    // Dated by the server as it brought them in: not empty, and not the show's day.
    for (const row of brought) expect(row.received_at === null || row.received_at === "2026-07-15T11:00:00.000Z", row.company_name).toBe(false);
    await clear(admin, data);
    // She may not say when herself: the server's refusal of that column, by the import's own door.
    const lena = await api("lena");
    const lenaHeaders = await csrf(lena);
    const up = await lena.post("/api/v1/imports/upload?filename=pasted.csv", { data: "Source,Company,When\nshow,P14 Hers Three,2026-07-15T11:00:00Z\n", headers: { ...lenaHeaders, "content-type": "text/csv" } });
    const refusedWhen = await lena.post("/api/v1/imports", { data: { fileId: ((await up.json()) as { data: { fileId: string } }).data.fileId, connectionId: standOf().connectionId, table: standOf().tables["crm_enquiries"], mapping: { columns: [{ from: "Source", to: "source" }, { from: "Company", to: "company_name" }, { from: "When", to: "received_at" }] }, options: { mode: "insert", skipInvalid: true } }, headers: lenaHeaders });
    expect(refusedWhen.status()).toBe(403);
    expect(((await refusedWhen.json()) as { error: { code: string } }).error.code).toBe("COLUMN_FORBIDDEN");
  } finally {
    await clear(admin, data);
  }

  // A rep may not bring enquiries in at all: the server's refusal, by the import's own doors.
  const rep = await api("priya");
  const headers = await csrf(rep);
  const up = await rep.post("/api/v1/imports/upload?filename=pasted.csv", { data: "Source,Company\nshow,P14 not theirs\n", headers: { ...headers, "content-type": "text/csv" } });
  const fileId = up.status() < 300 ? ((await up.json()) as { data: { fileId: string } }).data.fileId : null;
  const stand = standOf();
  const made = fileId === null ? up : await rep.post("/api/v1/imports", { data: { fileId, connectionId: stand.connectionId, table: stand.tables["crm_enquiries"], mapping: { columns: [{ from: "Source", to: "source" }, { from: "Company", to: "company_name" }] }, options: { mode: "insert", skipInvalid: true } }, headers });
  expect(made.status(), await made.text()).toBe(403);
  expect(await total(admin, data, { column: "company_name", op: "eq", value: "P14 not theirs" })).toBe(0);
});

test("the marketer's home: counts only, each the server's, the keen lead first, and no money", async ({ as, data }) => {
  const context = await as("lena");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link")).toHaveText(["Home", "Trade show leads", "Companies", "Contacts"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where the work is coming from");
  await expect(stat(page, "month").locator(".crm-kpi-label")).toHaveText("Enquiries in July");
  await expect(stat(page, "month").locator(".crm-leads-value")).toHaveText("17");
  await expect(stat(page, "month").locator(".crm-leads-note")).toHaveText("From 3 sources");
  await expect(stat(page, "notRung").locator(".crm-leads-value")).toHaveText("3");
  await expect(stat(page, "notRung").locator(".crm-leads-note")).toHaveText("1 of them was keen");
  await expect(stat(page, "deals").locator(".crm-leads-value")).toHaveText("0");
  const sources = page.locator("section[aria-labelledby='crm-mk-sources'] li");
  await expect(sources).toHaveCount(3);
  await expect(sources.nth(0)).toHaveText(/Trade show.*1 in the team inbox · 11 scanned at the show.*12 enquiries.*0 deals/);
  await expect(sources.nth(1)).toHaveText(/Web form.*4 in the team inbox.*4 enquiries.*0 deals/);
  await expect(sources.nth(2)).toHaveText(/Phone.*1 in the team inbox.*1 enquiry.*0 deals/);
  const waiting = page.locator("section[aria-labelledby='crm-mk-waiting'] li");
  await expect(waiting).toHaveCount(3);
  await expect(waiting.first()).toContainText("Sadie Kwan, Verity Insurance");
  await expect(waiting.first()).toContainText("Keen");
  await expect(waiting.first().locator(".crm-mk-sub")).toHaveText("Sixty task chairs · passed to Priya · goes cold in 2 days");
  await expect(waiting.first().locator(".crm-mk-figure")).toHaveText("12 days since the show");
  // No money anywhere on it.
  await expect(page.locator(".crm-mkhome")).not.toContainText("£");
  expect(problems).toEqual([]);
  await picture(page, "5-lena-home");

  // Asked directly as her.
  expect(await total(context.request, data, { column: "received_at", op: "between", value: ["2026-06-30T23:00:00.000Z", "2026-07-31T22:59:59.999Z"] })).toBe(17);
  expect(await total(context.request, data, { column: "deal_id", op: "not_null" })).toBe(0);
  const bySource = await context.request.post("/api/v1/widget-data/query", {
    data: { descriptor: { connectionId: standOf().connectionId, source: { name: standOf().tables["crm_enquiries"] }, shape: "categorical", groupBy: ["source"], aggregations: [{ fn: "count", alias: "n" }], filters: [] } },
    headers: await csrf(context.request),
  });
  expect(((await bySource.json()) as { result: { items: { key: string; value: number }[] } }).result.items.map((item) => [item.key, item.value]).sort()).toEqual([["form", 4], ["phone", 1], ["show", 12]]);
  // She reads nothing of a deal: the server's refusal.
  expect((await context.request.get(data("deals", "?limit=1"))).status()).toBe(403);
  // The row for the show opens the leads.
  await sources.nth(0).getByRole("link").click();
  await expect(page).toHaveURL(/\/trade-show-leads$/);
});
