/**
 * CUSTOMERS AFTER A SALE on the stand, with the sample: the account manager's
 * home, Renewals, Repeat orders, and Referrals with "Say thank you".
 *
 * Who each is proved as: the account manager (his own menu; a deal reaches
 * him only once it is won, so nothing of an open deal is on any of these
 * pages), the CRM admin (everything, and the buttons that start a deal),
 * Read-only (nothing to press, and the server refuses the writes), and the
 * marketer, whom the server refuses. A rep and a sales manager are told the
 * pages are not part of their role (the design gives them no line for them).
 *
 * The one write, a thank-you, is taken off again at the end; the renewal a
 * spec makes to show a colleague's page following is named "Spec: …" and
 * removed.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, unfoldMenu, watch, type Data } from "./helpers.ts";
import { figure } from "./territory-helpers.ts";

const money = (value: number): string => {
  const whole = Math.round(value * 100) % 100 === 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "GBP", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(value);
};
const menu = (page: Page) => page.getByRole("navigation", { name: "Menu" });
const toast = (page: Page) => page.locator(".crm-toast");
const noSidewaysScroll = (page: Page): Promise<boolean> => page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth);
const value = (page: Page, id: string) => page.getByTestId(id).locator(".crm-stat-value, .crm-kpi-value");
const sub = (page: Page, id: string) => page.getByTestId(id).locator(".crm-stat-sub, .crm-kpi-sub");

/** The names of every open deal, read as somebody who may read them all: what must not be on the account manager's pages. */
const openDealNames = async (admin: APIRequestContext, data: Data): Promise<string[]> => (await rows<{ name: string }>(admin, data, "deals", { column: "state", op: "eq", value: "open" })).map((deal) => deal.name);

async function single(person: APIRequestContext, stand: Parameters<typeof figure>[1], table: string, filters: unknown[], aggregation: Record<string, unknown> = { fn: "count" }): Promise<number> {
  return Number(((await figure(person, stand, table, { shape: "single-metric", filters, aggregations: [{ ...aggregation, alias: "v" }] })) as { value: number | null }).value ?? 0);
}
const IDEA = [{ column: "kind", op: "eq", value: "idea" }, { column: "state", op: "eq", value: "open" }];
const REORDER = [{ column: "kind", op: "eq", value: "reorder" }, { column: "state", op: "eq", value: "open" }];

test("the account manager lands on his home: renewals coming up and introductions to thank, with the server's figures and nothing of an open deal", async ({ as, api, data, stand }) => {
  const hugo = await api("hugo");
  const tessa = await api("tessa");
  const page = await (await as("hugo")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await expect(page.locator('[data-screen="amhome"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon), Hugo\.$/);
  await expect(page.locator(".crm-now")).toContainText("Tuesday, July 28, 2026");
  // His menu holds the stage-1 lines the design gives him, in this order; a later stage adds its own (After the job) between
  // them, so the menu is not read as an exact list. None of a rep's or a manager's lines is his.
  await unfoldMenu(page);
  await expect(menu(page).getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
  const lines = (await menu(page).getByRole("link").allInnerTexts()).map((text) => text.trim());
  const his = ["Home", "Renewals", "Repeat orders", "Referrals", "Won deals", "Companies", "Contacts"];
  expect(lines.filter((line) => his.includes(line))).toEqual(his);
  for (const theirs of ["Today", "Pipeline", "Quotes", "Approvals", "Team view", "Team inbox"]) expect(lines, theirs).not.toContain(theirs);

  // The figures, asked of the server as Hugo.
  const ideas = await single(hugo, stand, "renewals", IDEA);
  const room = await single(hugo, stand, "renewals", IDEA, { fn: "sum", column: "est_value" });
  const ready = await single(hugo, stand, "renewals", [...IDEA, { column: "due_on", op: "lte", value: "2026-07-28" }]);
  const toThank = await single(hugo, stand, "referrals", [{ column: "thanked_at", op: "is_null" }]);
  const lastYear = await single(hugo, stand, "referrals", [{ column: "introduced_on", op: "gte", value: "2025-07-28" }]);
  const reorders = await single(hugo, stand, "renewals", REORDER);
  const typical = await single(hugo, stand, "renewals", REORDER, { fn: "avg", column: "est_value" });
  // The ledger's: 7 ideas, 175,500 estimated, 3 ready now; 6 introductions, none thanked; 6 reorders, typical 4,016.67.
  expect([ideas, room, ready, toThank, lastYear, reorders, Math.round(typical * 100) / 100]).toEqual([7, 175_500, 3, 6, 6, 6, 4016.67]);
  await expect(value(page, "amhome-ready")).toHaveText("3");
  await expect(sub(page, "amhome-ready")).toHaveText(`7 ideas · ${money(175_500)} estimated`);
  await expect(value(page, "amhome-thank")).toHaveText("6");
  await expect(sub(page, "amhome-thank")).toHaveText("6 introductions in the last twelve months");
  await expect(value(page, "amhome-reorders")).toHaveText("6");
  await expect(sub(page, "amhome-reorders")).toHaveText(`typical ${money(4016.67)}`);

  // Soonest first, then the larger: the three whose day has come, then September, October, November.
  const renewals = page.locator('[data-group="renewals"]');
  await expect(renewals.locator(".crm-queue-group-count")).toHaveText("7");
  await expect(renewals.locator(".crm-step .crm-step-deal")).toHaveText(["Five remaining sites", "Floors two and three", "Second grading suite", "Office floor, not the lab", "Library shelving check", "Head office, ground floor", "Depot chairs, three-year swap"]);
  await expect(renewals.locator(".crm-step").nth(0)).toContainText("Fernway Clinics");
  await expect(renewals.locator(".crm-step").nth(0)).toContainText("Ready now");
  await expect(renewals.locator(".crm-step").nth(0)).toContainText(money(41_000));
  await expect(renewals.locator(".crm-step").nth(3)).toContainText("From Tue, Sep 1");
  await expect(renewals.locator(".crm-step").nth(5)).toContainText("From Thu, Oct 1");
  await expect(renewals.locator(".crm-step").nth(6)).toContainText("From Sun, Nov 1");
  const thanks = page.locator('[data-group="thanks"]');
  await expect(thanks.locator(".crm-queue-group-count")).toHaveText("6");
  await expect(thanks.locator(".crm-step")).toHaveCount(6);
  // The oldest introduction first.
  await expect(thanks.locator(".crm-step").first()).toContainText("Ana Belova introduced Cobalt Legal");

  // Ruling R6: he reads a deal once it is won. Nothing on his home names an open deal, and the server gives him none.
  const text = await page.locator('[data-screen="amhome"]').innerText();
  for (const name of await openDealNames(tessa, data)) expect(text, name).not.toContain(name);
  expect(await rows(hugo, data, "deals", { column: "state", op: "eq", value: "open" })).toEqual([]);

  await picture(page, "p09-amhome");
  // A row opens the list it belongs to.
  await renewals.locator(".crm-step").first().getByRole("link", { name: "Five remaining sites" }).click();
  await expect(page.locator('[data-screen="renewals"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Renewals and expansion");
  expect(problems).toEqual([]);

  // The home is his: the CRM admin is told it is not part of her role.
  const hers = await (await as("tessa")).newPage();
  await hers.goto(`${STAFF}home`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
});

test("Renewals: one card a customer with the server's figures; the admin starts a deal from an idea, the account manager sees no open deal's value", async ({ as, api, data, stand }) => {
  const tessa = await api("tessa");
  const hugo = await api("hugo");
  const page = await (await as("tessa")).newPage();
  await page.goto(`${STAFF}team`);
  await unfoldMenu(page);
  await menu(page).getByRole("link", { name: "Renewals", exact: true }).click();
  await expect(page.locator('[data-screen="renewals"]')).toBeVisible();

  const wonAll = await single(tessa, stand, "deals", [{ column: "state", op: "eq", value: "won" }], { fn: "sum", column: "amount" });
  expect(wonAll).toBe(130_000);
  await expect(page.getByTestId("renew-won")).toHaveText(`${money(130_000)} won to date`);
  await expect(page.getByTestId("renew-room")).toHaveText(`${money(175_500)} of room`);
  await expect(page.getByTestId("renew-count")).toHaveText("7 ideas · 5 customers · ready now 3");

  // The ledger's section 26, the most room first; and each customer's figures asked of the server.
  const ledger = [
    { name: "Nordwind Logistics", won: 26_400, open: 67_050, room: 61_600, lastWon: "Mar 26, 2026", ideas: 2 },
    { name: "Fernway Clinics", won: 11_200, open: 12_400, room: 41_000, lastWon: "Apr 9, 2026", ideas: 1 },
    { name: "Cobalt Legal", won: 36_900, open: 40_200, room: 36_400, lastWon: "Apr 28, 2026", ideas: 2 },
    { name: "Tandem Robotics", won: 15_600, open: 6_300, room: 22_000, lastWon: "Jun 3, 2026", ideas: 1 },
    { name: "Veldt Studios", won: 8_900, open: 30_700, room: 14_500, lastWon: "Jun 12, 2026", ideas: 1 },
  ];
  const cards = page.locator(".crm-as-card");
  await expect(cards.locator(".crm-as-card-title .crm-as-name")).toHaveText(ledger.map((row) => row.name));
  const all = await rows<{ id: number; name: string }>(tessa, data, "companies");
  for (const want of ledger) {
    const company = all.find((one) => one.name === want.name)!;
    const at = { column: "company_id", op: "eq", value: company.id };
    const served = {
      won: await single(tessa, stand, "deals", [at, { column: "state", op: "eq", value: "won" }], { fn: "sum", column: "amount" }),
      open: await single(tessa, stand, "deals", [at, { column: "state", op: "eq", value: "open" }], { fn: "sum", column: "amount" }),
      room: await single(tessa, stand, "renewals", [at, ...IDEA], { fn: "sum", column: "est_value" }),
    };
    expect(served, want.name).toEqual({ won: want.won, open: want.open, room: want.room });
    const card = page.locator(`.crm-as-card[data-company="${want.name}"]`);
    await expect(card.getByTestId("renew-co-won")).toHaveText(money(want.won));
    await expect(card.getByTestId("renew-co-open")).toHaveText(money(want.open));
    await expect(card.getByTestId("renew-co-room")).toHaveText(money(want.room));
    await expect(card.locator(".crm-as-meta")).toContainText(`Last won ${want.lastWon}`);
    await expect(card.locator(".crm-as-idea")).toHaveCount(want.ideas);
  }
  await picture(page, "p09-renewals-admin");
  const nordwind = page.locator('.crm-as-card[data-company="Nordwind Logistics"]');
  await expect(nordwind.locator(".crm-as-meta")).toContainText("2 deals open");
  await expect(nordwind.locator(".crm-as-since")).toHaveText("Customer since Mar 26, 2026");
  await expect(nordwind.locator(".crm-as-idea").nth(0)).toContainText("From Oct 1, 2026");
  await expect(page.locator('.crm-as-card[data-company="Fernway Clinics"] .crm-as-idea')).toContainText("Ready now");

  // "Start a deal" opens the new-deal sheet on that customer with the idea as its name; closing gives the focus back, and nothing is made.
  const deals = (await rows(tessa, data, "deals")).length;
  const start = page.locator('.crm-as-card[data-company="Fernway Clinics"]').getByRole("button", { name: "Start a deal" });
  await start.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("input").first()).toHaveValue("Five remaining sites");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(start).toBeFocused();
  expect((await rows(tessa, data, "deals")).length).toBe(deals);

  // The account manager: what was won, the room, and how many deals are open; never an open deal's value, and no way to start a deal.
  const his = await (await as("hugo")).newPage();
  await his.goto(`${STAFF}renewals`);
  await expect(his.locator(".crm-as-card")).toHaveCount(5);
  await expect(his.getByTestId("renew-won")).toHaveText(`${money(130_000)} won to date`);
  const hisNordwind = his.locator('.crm-as-card[data-company="Nordwind Logistics"]');
  await expect(hisNordwind.getByTestId("renew-co-won")).toHaveText(money(26_400));
  await expect(hisNordwind.getByTestId("renew-co-open")).toHaveText("—");
  await expect(hisNordwind.locator(".crm-as-meta")).toContainText("2 deals open");
  await expect(his.getByText("“Open now” counts the deals you can open.")).toBeVisible();
  await expect(his.getByRole("button", { name: "Start a deal" })).toHaveCount(0);
  expect(await single(hugo, stand, "deals", [{ column: "state", op: "eq", value: "open" }], { fn: "sum", column: "amount" })).toBe(0);
  const text = await his.locator('[data-screen="renewals"]').innerText();
  for (const name of await openDealNames(tessa, data)) expect(text, name).not.toContain(name);
  expect(text).not.toContain(money(67_050));
  const headers = await csrf(hugo);
  const stage = (await rows<{ id: number }>(hugo, data, "stages").catch(() => []))[0];
  expect((await hugo.post(data("deals"), { data: { values: { name: "Spec: not his to make", company_id: all[0]!.id, ...(stage === undefined ? {} : { stage_id: stage.id }) } }, headers })).status()).toBe(403);

  // A colleague's change is followed: the account manager adds an idea, and the admin's open page counts it without a reload.
  const veldt = all.find((one) => one.name === "Veldt Studios")!;
  const made = await hugo.post(data("renewals"), { data: { values: { company_id: veldt.id, kind: "idea", title: "Spec: a third suite", est_value: 1000, due_on: "2026-12-01" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  try {
    await expect(page.getByTestId("renew-count")).toHaveText("8 ideas · 5 customers · ready now 3", { timeout: 45_000 });
    await expect(page.locator('.crm-as-card[data-company="Veldt Studios"]').getByTestId("renew-co-room")).toHaveText(money(15_500));
    await expect(page.locator('.crm-as-card[data-company="Veldt Studios"] .crm-as-idea')).toHaveCount(2);
  } finally {
    expect((await hugo.delete(data("renewals", `/${String(id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
  await expect(page.getByTestId("renew-count")).toHaveText("7 ideas · 5 customers · ready now 3", { timeout: 45_000 });
});

test("Repeat orders: who came back, what the second orders came to, and each expected reorder with its due day", async ({ as, api, data, stand }) => {
  const hugo = await api("hugo");
  const page = await (await as("hugo")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await menu(page).getByRole("link", { name: "Repeat orders", exact: true }).click();
  await expect(page.locator('[data-screen="repeat"]')).toBeVisible();

  // One company has ordered twice (the ledger's section 51): Cobalt Legal, 190 days apart.
  const won = (await figure(hugo, stand, "deals", { shape: "categorical", filters: [{ column: "state", op: "eq", value: "won" }], groupBy: ["company_id"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "amount" }], limit: 200 })) as { items: { key: number; values: { n: number; amount: number } }[] };
  const back = won.items.filter((item) => item.values.n >= 2);
  expect(back).toHaveLength(1);
  const cobalt = (await rows<{ id: number; name: string }>(hugo, data, "companies", { column: "name", op: "eq", value: "Cobalt Legal" }))[0]!;
  expect(Number(back[0]!.key)).toBe(cobalt.id);
  expect(back[0]!.values).toMatchObject({ n: 2, amount: 36_900 });
  const mean = await single(hugo, stand, "deals", [{ column: "state", op: "eq", value: "won" }, { column: "company_id", op: "eq", value: cobalt.id }], { fn: "avg", column: "amount" });
  expect(mean).toBe(18_450);

  await expect(value(page, "repeat-twice")).toHaveText("1");
  await expect(sub(page, "repeat-twice")).toHaveText("Cobalt Legal");
  await expect(value(page, "repeat-later")).toHaveText(money(19_500));
  await expect(sub(page, "repeat-later")).toHaveText(`mean order ${money(18_450)}`);
  await expect(value(page, "repeat-expected")).toHaveText(String(await single(hugo, stand, "renewals", REORDER)));
  await expect(value(page, "repeat-expected")).toHaveText("6");
  await expect(sub(page, "repeat-expected")).toHaveText(`typical ${money(4016.67)}`);

  const card = page.locator('.crm-as-card[data-company="Cobalt Legal"]');
  await expect(card.getByTestId("repeat-orders")).toHaveText(`Reception refit, fourth floor ${money(17_400)} · Oct 20, 2025  ·  Legal library shelving ${money(19_500)} · Apr 28, 2026`);
  await expect(card.getByTestId("repeat-gap")).toHaveText("2 won deals · 190 days apart · mean order");
  await expect(card.getByTestId("repeat-mean")).toHaveText(money(18_450));
  await expect(card.getByTestId("reorder-state")).toHaveText("Reorder due now");
  await expect(card).toContainText("reorder due Jul 28, 2026");

  // The six reorders a rep expects: the due ones first, each with the day it was worked out from.
  const expected = [
    ["Nordwind Logistics", "now", "last won Mar 26, 2026 · due Jul 26, 2026"],
    ["Cobalt Legal", "now", "last won Apr 28, 2026 · due Jul 28, 2026"],
    ["Harbor & Finch", "soon", "last won Dec 5, 2025 · due Aug 5, 2026"],
    ["Fernway Clinics", "soon", "last won Apr 9, 2026 · due Aug 9, 2026"],
    ["Tandem Robotics", "later", "last won Jun 3, 2026 · due Jan 3, 2027"],
    ["Veldt Studios", "later", "last won Jun 12, 2026 · due Mar 12, 2027"],
  ] as const;
  const list = page.locator(".crm-as-row");
  await expect(list).toHaveCount(6);
  for (const [i, [company, state, days]] of expected.entries()) {
    await expect(list.nth(i)).toHaveAttribute("data-company", company);
    await expect(list.nth(i)).toHaveAttribute("data-state", state);
    await expect(list.nth(i).getByTestId("reorder-days")).toHaveText(days);
  }
  await expect(list.nth(0).getByTestId("reorder-state")).toHaveText("Reorder due now");
  await expect(list.nth(2).getByTestId("reorder-state")).toHaveText("Reorder due soon");
  await expect(list.nth(4).getByTestId("reorder-state")).toHaveText("Reorder not yet");
  await expect(list.nth(0)).toContainText("every 4 months");
  await picture(page, "p09-repeat-orders");
  // He may not make a deal, so nothing offers one.
  await expect(page.getByRole("button", { name: "Start the reorder" })).toHaveCount(0);
  expect(problems).toEqual([]);

  // The CRM admin is offered the reorder, on the company that came back and on each reorder that is due or nearly.
  const hers = await (await as("tessa")).newPage();
  await hers.goto(`${STAFF}repeat-orders`);
  await expect(hers.locator(".crm-as-row")).toHaveCount(6);
  await expect(hers.getByRole("button", { name: "Start the reorder" })).toHaveCount(5);
  await hers.locator('.crm-as-row[data-company="Nordwind Logistics"]').getByRole("button", { name: "Start the reorder" }).click();
  await expect(hers.getByRole("dialog").locator("input").first()).toHaveValue("Desk screens and cable trays");
  await hers.keyboard.press("Escape");
  await expect(hers.getByRole("dialog")).toHaveCount(0);
});

test("Referrals: what came of each introduction; “Say thank you” is kept once, survives a lost reply, and a colleague's page follows", async ({ as, api, data, stand }) => {
  const tessa = await api("tessa");
  const hugo = await api("hugo");
  const referrals = await rows<{ id: number; from_contact_id: number; deal_id: number | null; thanked_at: string | null }>(tessa, data, "referrals");
  expect(referrals).toHaveLength(6);
  const ruth = (await rows<{ id: number }>(tessa, data, "contacts", { column: "name", op: "like", value: "Ruth%" }))[0]!;
  const hers = referrals.find((row) => row.from_contact_id === ruth.id)!;
  // No thank-you for this introduction yet.
  expect(await rows(tessa, data, "outbox", { column: "referral_id", op: "eq", value: hers.id })).toEqual([]);
  const headers = await csrf(tessa);
  try {
    // The CRM admin reads every deal: the ledger's section 43.
    const page = await (await as("tessa")).newPage();
    await page.goto(`${STAFF}referrals`);
    await expect(page.locator('[data-screen="referrals"]')).toBeVisible();
    const dealIds = referrals.flatMap((row) => (row.deal_id === null ? [] : [row.deal_id]));
    const byState = (await figure(tessa, stand, "deals", { shape: "categorical", filters: [{ column: "id", op: "in", value: dealIds }], groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "amount" }] })) as { items: { key: string; values: { n: number; amount: number } }[] };
    expect(byState.items.find((item) => item.key === "won")!.values).toMatchObject({ n: 2, amount: 30_700 });
    expect(byState.items.find((item) => item.key === "open")!.values).toMatchObject({ n: 3, amount: 58_800 });
    await expect(value(page, "refer-count")).toHaveText("6");
    await expect(sub(page, "refer-count")).toHaveText("in the last twelve months");
    await expect(value(page, "refer-won")).toHaveText(money(30_700));
    await expect(sub(page, "refer-won")).toHaveText("2 deals won");
    await expect(value(page, "refer-open")).toHaveText(money(58_800));
    await expect(sub(page, "refer-open")).toHaveText("3 deals open");
    await expect(value(page, "refer-nowhere")).toHaveText("1");
    await expect(page.getByTestId("refer-thanked")).toHaveText("0 of 6 thanked");
    // The newest first.
    await expect(page.locator(".crm-as-refer")).toHaveCount(6);
    await expect(page.locator(".crm-as-refer").locator('[data-testid="refer-state"]')).toHaveText(["In play", "In play", "In play", "No deal yet", "Won", "Won"]);
    const hersRow = page.locator(`.crm-as-refer[data-referral="${String(hers.id)}"]`);
    await expect(hersRow).toContainText("Ruth Adeyemi");
    await expect(hersRow).toContainText("Fernway Clinics");
    await expect(hersRow).toContainText("Ward corridor seating");
    await expect(hersRow).toContainText(`${money(11_200)} booked`);
    await expect(page.locator('.crm-as-refer[data-state="none"]')).toContainText("A design studio in Sheffield");
    await expect(page.getByText("“Say thank you” e-mails the person who made the introduction, once, and notes when.")).toBeVisible();

    // The account manager: the won ones in full; of an open deal, only that there is one.
    const his = await (await as("hugo")).newPage();
    await his.goto(STAFF);
    await unfoldMenu(his);
    await menu(his).getByRole("link", { name: "Referrals", exact: true }).click();
    await expect(his.locator(".crm-as-refer")).toHaveCount(6);
    await expect(value(his, "refer-won")).toHaveText(money(30_700));
    await expect(value(his, "refer-open")).toHaveText("—");
    await expect(sub(his, "refer-open")).toHaveText("Open deals are not yours to see");
    await expect(his.locator(".crm-as-refer").locator('[data-testid="refer-state"]')).toHaveText(["A deal, not won", "A deal, not won", "A deal, not won", "No deal yet", "Won", "Won"]);
    const text = await his.locator('[data-screen="referrals"]').innerText();
    for (const name of await openDealNames(tessa, data)) expect(text, name).not.toContain(name);
    for (const amount of [21_500, 6_300, 31_000, 58_800]) expect(text).not.toContain(money(amount));

    // He says thank you, and the reply is lost on its way back. The page reads the row before it says anything, and says it once.
    let writes = 0;
    let lost = 0;
    await his.route("**/api/v1/data/**", async (route) => {
      if (route.request().method() !== "PATCH" || !new RegExp(`crm_referrals/${String(hers.id)}$`).test(new URL(route.request().url()).pathname)) return route.fallback();
      writes += 1;
      if (lost > 0) return route.fallback();
      lost += 1;
      await route.fetch();
      return route.abort("connectionreset");
    });
    const hisRow = his.locator(`.crm-as-refer[data-referral="${String(hers.id)}"]`);
    const button = hisRow.getByRole("button", { name: "Say thank you" });
    await button.focus();
    await his.keyboard.press("Enter");
    await expect(toast(his)).toContainText("Thank-you to Ruth Adeyemi noted.", { timeout: 20_000 });
    // The stand's clock began at 09:35 on the ledger's Tuesday and runs on: the moment kept is the server's, that morning.
    await expect(hisRow.getByTestId("refer-thanked-at")).toHaveText(/^Thanked Tue, Jul 28, (09|1\d):\d\d$/);
    await expect(hisRow.getByRole("button", { name: "Say thank you" })).toHaveCount(0);
    await expect(his.getByTestId("refer-thanked")).toHaveText("1 of 6 thanked");
    expect(lost).toBe(1);
    await picture(his, "p09-referrals-thanked");
    const after = (await rows<{ id: number; thanked_at: string | null }>(tessa, data, "referrals")).find((row) => row.id === hers.id)!;
    expect(after.thanked_at).not.toBeNull();
    expect(new Date(after.thanked_at!).toISOString().slice(0, 10)).toBe("2026-07-28");
    expect(writes).toBeLessThanOrEqual(2);

    // Live: the admin's open page follows without a reload.
    await expect(hersRow.getByTestId("refer-thanked-at")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("refer-thanked")).toHaveText("1 of 6 thanked");
    // Thanked once: a second thanks is refused by the server, because the row no longer reads "not thanked".
    expect((await tessa.patch(data("referrals", `/${String(hers.id)}`), { data: { values: { thanked_at: "2026-07-29T10:00:00.000Z" }, seen: { thanked_at: null } }, headers })).status()).toBe(409);
    // The thank-you e-mail itself (e-mail 19, F21) is proved in `z-referral-thanks.e2e.ts`: the sample is never mailed, and a
    // mailed introduction can never be removed (the message keeps it), so that spec runs last.
    // Read-only: who was thanked, nothing to press, and the server refuses the write.
    const grace = await api("grace");
    const reader = await (await as("grace")).newPage();
    await reader.goto(`${STAFF}referrals`);
    await expect(reader.locator(".crm-as-refer")).toHaveCount(6);
    await expect(reader.getByRole("button", { name: "Say thank you" })).toHaveCount(0);
    await expect(reader.locator(`.crm-as-refer[data-referral="${String(hers.id)}"]`).getByTestId("refer-thanked-at")).toBeVisible();
    await expect(reader.getByText("Not thanked yet")).toHaveCount(5);
    const other = referrals.find((row) => row.id !== hers.id)!;
    expect((await grace.patch(data("referrals", `/${String(other.id)}`), { data: { values: { thanked_at: "2026-07-28T09:00:00.000Z" } }, headers: await csrf(grace) })).status()).toBe(403);
    expect((await rows<{ id: number; thanked_at: string | null }>(tessa, data, "referrals")).find((row) => row.id === other.id)!.thanked_at).toBeNull();
  } finally {
    expect((await tessa.patch(data("referrals", `/${String(hers.id)}`), { data: { values: { thanked_at: null } }, headers })).status()).toBe(200);
  }
  expect((await rows<{ thanked_at: string | null }>(hugo, data, "referrals")).every((row) => row.thanked_at === null)).toBe(true);
});

test("who these pages are not for: the server refuses the marketer and the front desk, and a rep and a sales manager are told it is not their role", async ({ as, api, data }) => {
  for (const person of ["lena", "corin"]) {
    const one = await api(person);
    for (const table of ["renewals", "referrals"]) expect((await one.get(data(table, "?limit=5"))).status(), `${person} ${table}`).toBe(403);
  }
  // Read-only makes no renewal and no introduction.
  const grace = await api("grace");
  const company = (await rows<{ id: number }>(grace, data, "companies"))[0]!;
  expect((await grace.post(data("renewals"), { data: { values: { company_id: company.id, kind: "idea", title: "Spec: not hers" } }, headers: await csrf(grace) })).status()).toBe(403);
  for (const person of ["dana", "ivy", "lena"]) {
    const page = await (await as(person)).newPage();
    for (const address of ["renewals", "repeat-orders", "referrals"]) {
      await page.goto(`${STAFF}${address}`);
      await expect(page.getByRole("heading", { level: 1 }), `${person} ${address}`).toHaveText("This page is not part of your role");
    }
    await page.close();
  }
  // Read-only's menu holds all three.
  const reader = await (await as("grace")).newPage();
  for (const [address, screen] of [["renewals", "renewals"], ["repeat-orders", "repeat"], ["referrals", "referrals"]] as const) {
    await reader.goto(`${STAFF}${address}`);
    await expect(reader.locator(`[data-screen="${screen}"]`)).toBeVisible();
    await expect(reader.getByRole("button", { name: /Start a deal|Start the reorder|Say thank you/ })).toHaveCount(0);
  }
});

test("in Arabic, at 390 wide, in the dark: the four pages read right to left with no sideways scroll", async ({ as, api }) => {
  const hugo = await api("hugo");
  await inArabic(hugo, async () => {
    const context = await as("hugo", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    const page = await context.newPage();
    const problems = watch(page);
    for (const [address, screen, heading] of [
      ["home", "amhome", null],
      ["renewals", "renewals", "التجديدات والتوسّع"],
      ["repeat-orders", "repeat", "الطلبات المتكررة"],
      ["referrals", "referrals", "الإحالات"],
    ] as const) {
      await page.goto(`${STAFF}${address}`);
      await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      if (heading !== null) await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.locator(".crm-skeleton")).toHaveCount(0);
      expect(await noSidewaysScroll(page), address).toBe(true);
      await picture(page, `p09-${screen}-ar-390-dark`);
    }
    await expect(page.locator(".crm-as-refer")).toHaveCount(6);
    await expect(page.getByRole("button", { name: "قل شكرًا" })).toHaveCount(6);
    expect(problems).toEqual([]);
  });
});
