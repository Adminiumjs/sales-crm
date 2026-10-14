/**
 * P07, Companies (ledger §4a), a company's profile (§4b) with the record
 * sheet, and its timeline (§12).
 *
 * A company is everybody's; a deal is not. The ledger's figures (Nordwind:
 * 2 open, 67,050, weighted 43,162.50, won 26,400) are the whole team's, which
 * is what the sales manager, the CRM admin and Read-only read. Dana reads HER
 * deals there (1 open, 52,800, weighted 39,600, nothing won by her) and the
 * page says so; Leo's open deal at Nordwind is one quiet line for her. The
 * account manager reads what was won and a count of what is open; the marketer
 * a count and nothing else.
 *
 * The specs are spread over the people the screens are for (a person's
 * requests are counted by the minute). What a spec makes is called "P07 …"
 * and taken away by the CRM admin at the end.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { authOf, expect, picture, stand, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

const card = (page: Page, name: string) => page.locator(".crm-acc-card").filter({ has: page.locator(".crm-acc-card-name", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}$`) }) });
const fact = (page: Page, key: string) => page.locator(`.crm-acc-facts [data-fact="${key}"]`);
const money = (value: number): string => `£${value.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2 })}`;
const companyId = async (person: APIRequestContext, data: Data, name: string): Promise<number> => (await rows<{ id: number }>(person, data, "companies", { column: "name", op: "eq", value: name }))[0]!.id;

async function removeMade(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const person of await rows<{ id: number }>(admin, data, "contacts", { column: "name", op: "like", value: "P07 %" })) expect((await admin.delete(data("contacts", `/${String(person.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  for (const company of await rows<{ id: number }>(admin, data, "companies", { column: "name", op: "like", value: "P07 %" })) expect((await admin.delete(data("companies", `/${String(company.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
}
test.afterAll(async ({ browser }) => {
  // The fixtures are per test: the last clean-up signs nobody in again, it reads the CRM admin's kept cookies.
  const state = stand();
  const context = await browser.newContext({ baseURL: state.url, storageState: await authOf(browser, "tessa") });
  const data: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;
  await removeMade(context.request, data);
  await context.close();
});

test("Dana opens Companies from her menu: the nine, each with what is HERS open there", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Companies" }).click();
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/companies$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Companies");
  await expect(page.locator(".crm-acc-card")).toHaveCount(9);
  // By name, and each says what it is: sector, people, town.
  await expect(page.locator(".crm-acc-card-name")).toHaveText(["Brightloom Foods", "Cobalt Legal", "Fernway Clinics", "Harbor & Finch", "Juno Analytics", "Low Orbit", "Nordwind Logistics", "Tandem Robotics", "Veldt Studios"]);
  await expect(card(page, "Nordwind Logistics").locator(".crm-acc-card-meta")).toHaveText("Freight · 1,200 people · Hull");
  // Hers: six open deals, 143,400 in all, at five companies. A company where only colleagues hold deals says so and shows no amount.
  const hers: Record<string, [string, string]> = {
    "Cobalt Legal": ["1 deal of yours open", "£16,800"],
    "Juno Analytics": ["1 deal of yours open", "£21,600"],
    "Low Orbit": ["1 deal of yours open", "£21,500"],
    "Nordwind Logistics": ["1 deal of yours open", "£52,800"],
    "Veldt Studios": ["2 deals of yours open", "£30,700"],
  };
  for (const [name, [line, value]] of Object.entries(hers)) {
    await expect(card(page, name).locator(".crm-acc-card-open span").first(), name).toHaveText(line);
    await expect(card(page, name).locator(".crm-acc-card-value"), name).toHaveText(value);
  }
  for (const name of ["Brightloom Foods", "Fernway Clinics", "Harbor & Finch", "Tandem Robotics"]) {
    await expect(card(page, name).locator(".crm-acc-card-open span").first(), name).toHaveText("None of yours open");
    await expect(card(page, name).locator(".crm-acc-card-value"), name).toHaveText("—");
  }
  // The two deals that have sat past thirty days (d12, d5) are colleagues': no badge on her cards.
  await expect(page.locator(".crm-acc-badge")).toHaveCount(0);
  // A rep adds and changes companies.
  await expect(page.getByRole("button", { name: "New company" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Nordwind Logistics" })).toBeVisible();
  expect(problems).toEqual([]);
  await picture(page, "1-dana-companies");
});

test("the sales manager reads the ledger's nine: open deals, open value, and the two with a stale deal; the box narrows them", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  await page.goto(`${STAFF}companies`);
  const ledger: Record<string, [string, string]> = {
    "Cobalt Legal": ["2 deals open", "£40,200"],
    "Fernway Clinics": ["1 deal open", "£12,400"],
    "Juno Analytics": ["1 deal open", "£21,600"],
    "Nordwind Logistics": ["2 deals open", "£67,050"],
    "Veldt Studios": ["2 deals open", "£30,700"],
    "Brightloom Foods": ["2 deals open", "£45,800"],
    "Harbor & Finch": ["2 deals open", "£40,750"],
    "Tandem Robotics": ["1 deal open", "£6,300"],
    "Low Orbit": ["1 deal open", "£21,500"],
  };
  for (const [name, [line, value]] of Object.entries(ledger)) {
    await expect(card(page, name).locator(".crm-acc-card-open span").first(), name).toHaveText(line);
    await expect(card(page, name).locator(".crm-acc-card-value"), name).toHaveText(value);
  }
  await expect(page.locator(".crm-acc-badge")).toHaveCount(2);
  await expect(card(page, "Nordwind Logistics").locator(".crm-acc-badge")).toHaveText("1 stale");
  await expect(card(page, "Brightloom Foods").locator(".crm-acc-badge")).toHaveText("1 stale");
  await picture(page, "2-ivy-companies");

  const box = page.getByRole("searchbox", { name: "Filter by name, sector or town" });
  await box.fill("hull");
  await expect(page.locator(".crm-acc-card-name")).toHaveText(["Nordwind Logistics"]);
  await box.fill("LAW");
  await expect(page.locator(".crm-acc-card-name")).toHaveText(["Cobalt Legal"]);
  await box.fill("no such company");
  await expect(page.locator(".crm-acc-card")).toHaveCount(0);
  await expect(page.locator(".crm-empty-title")).toHaveText("No company matches that");
  await box.fill("");
  await expect(page.locator(".crm-acc-card")).toHaveCount(9);
});

test("every figure on a company's card is what the server answers that person, asked directly", async ({ as, data }) => {
  for (const person of ["dana", "grace", "hugo", "lena"]) {
    const context = await as(person);
    const page = await context.newPage();
    await page.goto(`${STAFF}companies`);
    await expect(page.locator(".crm-acc-card"), person).toHaveCount(9);
    const companies = await rows<{ id: number; name: string }>(context.request, data, "companies");
    // Every open deal there, by the marks: all of these people read them.
    const marks = await rows<{ company_id: number }>(context.request, data, "deal_marks", { column: "state", op: "eq", value: "open" });
    // The open deals she is answered: none for the marketer (refused), none for the account manager (he reads a deal once it is won).
    const deals = person === "lena" ? [] : await rows<{ company_id: number; amount: number }>(context.request, data, "deals", { column: "state", op: "eq", value: "open" });
    if (person === "lena") expect((await context.request.get(data("deals", "?limit=5"))).status()).toBe(403);
    for (const company of companies) {
      const mine = deals.filter((deal) => deal.company_id === company.id);
      const all = marks.filter((mark) => mark.company_id === company.id).length;
      const sum = mine.reduce((total, deal) => total + Number(deal.amount), 0);
      const line = card(page, company.name).locator(".crm-acc-card-open span").first();
      const value = card(page, company.name).locator(".crm-acc-card-value");
      const deals_ = (n: number): string => `${String(n)} ${n === 1 ? "deal" : "deals"}`;
      if (person === "dana") {
        await expect(line, `${person} ${company.name}`).toHaveText(mine.length > 0 ? `${deals_(mine.length)} of yours open` : all > 0 ? "None of yours open" : "Nothing open");
        await expect(value, `${person} ${company.name}`).toHaveText(mine.length > 0 ? money(sum) : "—");
      } else if (person === "grace") {
        // Read-only reads the team's: the ledger's figures.
        expect(mine.length).toBe(all);
        await expect(line, `${person} ${company.name}`).toHaveText(`${deals_(all)} open`);
        await expect(value, `${person} ${company.name}`).toHaveText(money(sum));
      } else {
        // The account manager and the marketer: how many are open, and no amount at all.
        expect(mine.length).toBe(0);
        await expect(line, `${person} ${company.name}`).toHaveText(`${deals_(all)} open`);
        await expect(value, `${person} ${company.name}`).toHaveCount(0);
      }
    }
    if (person === "grace") expect(deals.reduce((total, deal) => total + Number(deal.amount), 0)).toBe(286_300);
    // Who is offered a change: Read-only and the marketer none.
    await expect(page.getByRole("button", { name: "New company" }), person).toHaveCount(person === "hugo" ? 1 : person === "dana" ? 1 : 0);
    await expect(page.getByRole("button", { name: /^Edit / }), person).toHaveCount(person === "grace" || person === "lena" ? 0 : 9);
    await page.close();
  }
});

test("Nordwind for Dana: her own figures, said to be hers; Leo's open deal is one quiet line", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}companies`);
  await card(page, "Nordwind Logistics").locator(".crm-acc-card-name").click();
  const id = await companyId(context.request, data, "Nordwind Logistics");
  await expect(page).toHaveURL(new RegExp(`/companies/${String(id)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nordwind Logistics");
  await expect(page.locator(".crm-acc-hero-meta")).toContainText("Freight · 1,200 people · ");
  await expect(page.locator(".crm-acc-hero-meta")).toContainText("Hull, United Kingdom");
  await expect(page.locator(".crm-acc-hero-no")).toHaveText(`Company no. ${String(id)}`);
  // A customer (Sam won a deal here in March), and no day: the days of a colleague's deals are not hers to read.
  await expect(page.locator(".crm-acc-since")).toHaveText("Customer");

  // HER figures at Nordwind, not the company's: d1 only. The ledger's 67,050 / 43,162.50 / 26,400 are the team's.
  await expect(fact(page, "open").locator("dt")).toHaveText("My open value");
  await expect(fact(page, "open").locator("dd")).toHaveText("£52,800");
  await expect(fact(page, "weighted").locator("dt")).toHaveText("My weighted");
  await expect(fact(page, "weighted").locator("dd")).toHaveText("£39,600");
  await expect(fact(page, "won").locator("dt")).toHaveText("Won by me to date");
  await expect(fact(page, "won").locator("dd")).toHaveText("£0");
  await expect(fact(page, "people").locator("dd")).toHaveText("2");
  await expect(page.locator(".crm-acc-own")).toHaveText("These three figures are over your own deals here. A colleague’s deals are not in them.");

  // Each is what the server answers her.
  const here = { column: "company_id", op: "eq", value: id };
  const mine = await rows<{ id: number; name: string; state: string; amount: number; weighted_value: number }>(context.request, data, "deals", here);
  const open = mine.filter((deal) => deal.state === "open");
  expect(open.map((deal) => deal.name)).toEqual(["Fourth-floor desk rows"]);
  expect([open[0]!.amount, open[0]!.weighted_value].map(Number)).toEqual([52800, 39600]);
  expect(mine.filter((deal) => deal.state === "won")).toEqual([]);

  // Her open deal is a card that opens its room; Leo's is a line: who and which stage. No title, no amount, no link.
  const panel = page.getByRole("region", { name: "My open deals" });
  await expect(panel.locator(".crm-acc-open-n")).toHaveText("1");
  await expect(panel.locator(".crm-acc-deal")).toHaveCount(1);
  await expect(panel.locator(".crm-acc-deal")).toContainText("Fourth-floor desk rows");
  await expect(panel.locator(".crm-acc-deal")).toContainText("£52,800");
  await expect(panel.locator(".crm-acc-deal")).toContainText("Negotiation");
  await expect(panel.locator(".crm-acc-deal")).toContainText("closes Fri, Aug 14");
  const quiet = panel.locator(".crm-acc-quiet li");
  await expect(quiet).toHaveCount(1);
  await expect(quiet).toHaveText("Leo Vance has an open deal here·Qualified");
  await expect(quiet.locator("a, button")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Depot supervisor stations");
  await expect(page.locator("main")).not.toContainText("14,250");
  // What the server answers her of that deal: its mark, and for the deal itself "no such row".
  const marks = await rows<{ deal_id: number; state: string }>(context.request, data, "deal_marks", { and: [here, { column: "state", op: "eq", value: "open" }] });
  expect(marks).toHaveLength(2);
  const leos = marks.find((mark) => mark.deal_id !== open[0]!.id)!;
  expect((await context.request.get(data("deals", `/${String(leos.deal_id)}`))).status()).toBe(404);

  // The people here, and her own history: the deal she lost here in 2025.
  await expect(page.locator(".crm-acc-person-name")).toHaveText(["Jonas Reuter", "Petra Lindqvist"]);
  const history = page.getByRole("region", { name: "My history here" });
  await expect(history.locator("li")).toHaveCount(1);
  await expect(history.locator("li")).toContainText("Dock office pods");
  await expect(history.locator("li")).toContainText("Lost Sep 19, 2025 · Proposal · Went with another supplier");
  await expect(history.locator("li")).toContainText("£15,300");
  // The last things logged on her deal here.
  await expect(page.locator(".crm-acc-act")).toHaveCount(3);
  await expect(page.locator(".crm-acc-act").first()).toContainText("Nudged Petra on the layout.");
  expect(problems).toEqual([]);
  await picture(page, "3-dana-nordwind");

  // The card opens the deal's room.
  await panel.locator(".crm-acc-deal a").click();
  await expect(page).toHaveURL(new RegExp(`/deals/${String(open[0]!.id)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fourth-floor desk rows");
  // And the room names the company and its people as links back to these screens.
  await page.locator(".crm-room-company-name a").click();
  await expect(page).toHaveURL(new RegExp(`/companies/${String(id)}$`));
});

test("Nordwind for the sales manager: the ledger's figures, the day it became a customer, four closed deals", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  const id = await companyId(context.request, data, "Nordwind Logistics");
  await page.goto(`${STAFF}companies/${String(id)}`);
  await expect(page.locator(".crm-acc-since")).toHaveText("Customer since March 2026");
  await expect(fact(page, "open").locator("dt")).toHaveText("Open value");
  await expect(fact(page, "open").locator("dd")).toHaveText("£67,050");
  await expect(fact(page, "weighted").locator("dd")).toHaveText("£43,162.50");
  await expect(fact(page, "won").locator("dt")).toHaveText("Won to date");
  await expect(fact(page, "won").locator("dd")).toHaveText("£26,400");
  await expect(fact(page, "people").locator("dd")).toHaveText("2");
  await expect(page.locator(".crm-acc-own")).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Open deals" });
  await expect(panel.locator(".crm-acc-open-n")).toHaveText("2");
  await expect(panel.locator(".crm-acc-panel-sum")).toHaveText("£67,050");
  await expect(panel.locator(".crm-acc-deal-name")).toHaveText(["Fourth-floor desk rows", "Depot supervisor stations"]);
  await expect(panel.locator(".crm-acc-quiet li")).toHaveCount(0);
  // History: four closed, one won and three lost, the newest first.
  const history = page.getByRole("region", { name: "History" });
  await expect(history.locator("li")).toHaveCount(4);
  await expect(history.locator('li[data-state="won"]')).toHaveCount(1);
  await expect(history.locator("li").first()).toContainText("Warehouse office desks");
  await expect(history.locator("li").first()).toContainText("Won Mar 26, 2026");
  await expect(history.locator("li").first()).toContainText("£26,400");
  // Asked directly: the same.
  const deals = await rows<{ state: string; amount: number; weighted_value: number }>(context.request, data, "deals", { column: "company_id", op: "eq", value: id });
  const sum = (state: string, column: "amount" | "weighted_value"): number => deals.filter((deal) => deal.state === state).reduce((total, deal) => total + Number(deal[column]), 0);
  expect([sum("open", "amount"), sum("open", "weighted_value"), sum("won", "amount"), deals.filter((deal) => deal.state !== "open").length]).toEqual([67050, 43162.5, 26400, 4]);
  await picture(page, "4-ivy-nordwind");
});

test("since when, for all nine, as the CRM admin: the ledger's lines, each from the first win or the first deal", async ({ as, data }) => {
  const context = await as("tessa");
  const page = await context.newPage();
  const ledger: Record<string, string> = {
    "Cobalt Legal": "Customer since October 2025",
    "Fernway Clinics": "Customer since April 2026",
    "Juno Analytics": "Customer since December 2025",
    "Nordwind Logistics": "Customer since March 2026",
    "Veldt Studios": "Customer since June 2026",
    "Brightloom Foods": "In conversation since September 2025",
    "Harbor & Finch": "Customer since December 2025",
    "Tandem Robotics": "Customer since June 2026",
    "Low Orbit": "In conversation since September 2025",
  };
  const won: Record<string, string> = { "Cobalt Legal": "£36,900", "Fernway Clinics": "£11,200", "Juno Analytics": "£24,800", "Nordwind Logistics": "£26,400", "Veldt Studios": "£8,900", "Brightloom Foods": "£0", "Harbor & Finch": "£6,200", "Tandem Robotics": "£15,600", "Low Orbit": "£0" };
  const companies = await rows<{ id: number; name: string }>(context.request, data, "companies");
  const deals = await rows<{ company_id: number; state: string; closed_on: string | null; opened_on: string }>(context.request, data, "deals");
  for (const company of companies) {
    await page.goto(`${STAFF}companies/${String(company.id)}`);
    await expect(page.locator(".crm-acc-since"), company.name).toHaveText(ledger[company.name]!);
    await expect(fact(page, "won").locator("dd"), company.name).toHaveText(won[company.name]!);
    // The server's own rows say the same: the first day a deal here was won, else the first day one was opened.
    const here = deals.filter((deal) => deal.company_id === company.id);
    const firstWon = here.filter((deal) => deal.state === "won").map((deal) => String(deal.closed_on)).sort()[0];
    const first = firstWon ?? here.map((deal) => deal.opened_on).sort()[0]!;
    const month = new Date(`${first}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    expect(ledger[company.name], company.name).toBe(`${firstWon === undefined ? "In conversation" : "Customer"} since ${month}`);
  }
});

test("the account manager reads what was won and a count; the marketer a count and nothing else; the server holds both", async ({ as, api, data }) => {
  const hugo = await as("hugo");
  const page = await hugo.newPage();
  const id = await companyId(hugo.request, data, "Nordwind Logistics");
  await page.goto(`${STAFF}companies/${String(id)}`);
  // He reads every won deal, so he is answered the day of the first win.
  await expect(page.locator(".crm-acc-since")).toHaveText("Customer since March 2026");
  await expect(page.locator(".crm-acc-facts dt")).toHaveText(["Won to date", "Open deals", "People"]);
  await expect(fact(page, "won").locator("dd")).toHaveText("£26,400");
  await expect(fact(page, "deals").locator("dd")).toHaveText("2");
  // Both open deals are somebody else's for him: two quiet lines, no card.
  await expect(page.locator(".crm-acc-deal")).toHaveCount(0);
  await expect(page.locator(".crm-acc-quiet li")).toHaveText(["Dana Whitlock has an open deal here·Negotiation", "Leo Vance has an open deal here·Qualified"]);
  await expect(page.getByRole("button", { name: "New deal" })).toHaveCount(0);
  const wonHere = page.getByRole("region", { name: "Won here" });
  await expect(wonHere.locator("li")).toHaveCount(1);
  await expect(wonHere.locator("li")).toContainText("Warehouse office desks");
  // He logs nothing on a deal and reads none of what is logged: no timeline for him.
  await expect(page.getByRole("link", { name: "Full timeline" })).toHaveCount(0);
  expect(await rows(hugo.request, data, "deals", { and: [{ column: "company_id", op: "eq", value: id }, { column: "state", op: "eq", value: "open" }] })).toEqual([]);
  expect((await hugo.request.get(data("activities", "?limit=5"))).status()).toBe(403);
  await picture(page, "5-hugo-nordwind");

  const lena = await as("lena");
  const hers = await lena.newPage();
  await hers.goto(`${STAFF}companies/${String(id)}`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("Nordwind Logistics");
  await expect(hers.locator(".crm-acc-since")).toHaveText("Customer");
  await expect(hers.locator(".crm-acc-facts dt")).toHaveText(["Open deals", "People"]);
  await expect(fact(hers, "deals").locator("dd")).toHaveText("2");
  await expect(hers.getByRole("region", { name: "Open deals" })).toContainText("2 deals are open here. Your role does not open deals.");
  // No amount, no deal's name, nobody's name, no stage; no history; nothing to press.
  await expect(hers.locator("main")).not.toContainText("£");
  for (const word of ["Fourth-floor desk rows", "Depot supervisor stations", "Leo Vance", "Negotiation", "Qualified", "Warehouse office desks"]) await expect(hers.locator("main"), word).not.toContainText(word);
  await expect(hers.locator(".crm-acc-quiet li")).toHaveCount(0);
  await expect(hers.getByRole("region", { name: /History|Won here/ })).toHaveCount(0);
  for (const name of ["Edit company", "New deal", "Add a contact here"]) await expect(hers.getByRole("button", { name }), name).toHaveCount(0);
  await picture(hers, "6-lena-nordwind");
  // What the server answers her: a mark's company and state; no deal; no stage; and no write.
  const marks = await rows<Record<string, unknown>>(lena.request, data, "deal_marks", { and: [{ column: "company_id", op: "eq", value: id }, { column: "state", op: "eq", value: "open" }] });
  expect(marks).toHaveLength(2);
  // Her mark: the company, the state and the numbers of the rows it links. Never whose the deal is.
  expect(Object.keys(marks[0]!).filter((key) => !key.startsWith("_") && !["id", "company_id", "deal_id", "contact_id", "stage_id", "state"].includes(key))).toEqual([]);
  expect((await lena.request.get(data("deal_marks", "?select=owner_id&limit=5"))).status()).toBe(403);
  expect((await lena.request.get(data("deals", "?limit=5"))).status()).toBe(403);
  expect((await lena.request.get(data("stages", "?limit=5"))).status()).toBe(403);
  const headers = await csrf(lena.request);
  expect((await lena.request.patch(data("companies", `/${String(id)}`), { data: { values: { town: "Elsewhere" } }, headers })).status()).toBe(403);
  expect((await lena.request.post(data("companies"), { data: { values: { name: "P07 Refused" } }, headers })).status()).toBe(403);

  // The front desk reads companies and has no Accounts in its menu: the address says so.
  const corin = await (await as("corin")).newPage();
  await corin.goto(`${STAFF}companies`);
  await expect(corin.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  // The operations manager is refused the rows themselves.
  expect((await (await api("ada")).get(data("companies", "?limit=5"))).status()).toBe(403);
});

test("a company is added once though its reply is lost, then changed; the sheet holds the keyboard and gives it back", async ({ as, data }) => {
  const context = await as("priya");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}companies`);
  await expect(card(page, "Nordwind Logistics")).toHaveCount(1);
  const opener = page.getByRole("button", { name: "New company" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "New company" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Company name")).toBeFocused();
  // A name is asked for before anything is sent.
  await sheet.getByRole("button", { name: "Add company" }).click();
  await expect(sheet.locator(".crm-form-error")).toHaveText("Give the company a name.");
  await sheet.getByLabel("Company name").fill("P07 Kestrel Print");
  await sheet.getByLabel("What they do").fill("Printing");
  await sheet.getByLabel("How many people").fill("forty");
  await sheet.getByRole("button", { name: "Add company" }).click();
  await expect(sheet.locator(".crm-form-error")).toHaveText("How many people is a whole number.");
  await sheet.getByLabel("How many people").fill("40");
  await sheet.getByLabel("Town").fill("York");
  await sheet.getByLabel("Country").fill("gb");
  // The street and the postal code are kept from every role of the app: they are not offered, and the sheet says why.
  await expect(sheet.getByLabel("Address lines")).toHaveCount(0);
  await expect(sheet).toContainText("The street and the postal code are kept from your role");

  // The first save reaches the server and is written; its answer never arrives.
  const sent: { key: string; replayed: boolean | null }[] = [];
  let dropped = false;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_companies$/.test(new URL(request.url()).pathname)) return route.fallback();
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
  await sheet.getByRole("button", { name: "Add company" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("P07 Kestrel Print added.");
  expect(sent.length).toBe(2);
  expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
  await page.unroute("**/api/v1/data/**");
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
  const made = await rows<{ id: number; headcount: number; country: string; town: string }>(context.request, data, "companies", { column: "name", op: "eq", value: "P07 Kestrel Print" });
  expect(made).toHaveLength(1);
  expect([made[0]!.headcount, made[0]!.country, made[0]!.town]).toEqual([40, "GB", "York"]);
  await expect(card(page, "P07 Kestrel Print").locator(".crm-acc-card-meta")).toHaveText("Printing · 40 people · York");
  await expect(card(page, "P07 Kestrel Print").locator(".crm-acc-card-open span").first()).toHaveText("Nothing open");

  // Changed from its card: only what changed is sent.
  const patches: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") patches.push((request.postDataJSON() as { values: unknown }).values);
  });
  await page.getByRole("button", { name: "Edit P07 Kestrel Print" }).click();
  const edit = page.getByRole("dialog", { name: "P07 Kestrel Print" });
  await expect(edit.getByLabel("Town")).toHaveValue("York");
  await edit.getByLabel("Town").fill("Harrogate");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("P07 Kestrel Print saved.");
  expect(patches).toEqual([{ town: "Harrogate" }]);
  await expect(card(page, "P07 Kestrel Print").locator(".crm-acc-card-meta")).toHaveText("Printing · 40 people · Harrogate");
  // Escape closes a sheet and changes nothing.
  await page.getByRole("button", { name: "Edit P07 Kestrel Print" }).click();
  await page.getByRole("dialog", { name: "P07 Kestrel Print" }).getByLabel("Town").fill("Nowhere");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit P07 Kestrel Print" })).toBeFocused();
  expect((await rows<{ town: string }>(context.request, data, "companies", { column: "name", op: "eq", value: "P07 Kestrel Print" }))[0]!.town).toBe("Harrogate");
  expect(problems.filter((problem) => !/ERR_CONNECTION_RESET|Failed to load resource/.test(problem))).toEqual([]);
});

test("Read-only reads a company with no control that writes, and the server refuses her the writes", async ({ as, data }) => {
  const context = await as("grace");
  const page = await context.newPage();
  const id = await companyId(context.request, data, "Cobalt Legal");
  await page.goto(`${STAFF}companies/${String(id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cobalt Legal");
  await expect(fact(page, "open").locator("dd")).toHaveText("£40,200");
  await expect(fact(page, "won").locator("dd")).toHaveText("£36,900");
  for (const name of ["Edit company", "New deal", "Add a contact here"]) await expect(page.getByRole("button", { name }), name).toHaveCount(0);
  // A contact's sheet opens to look, with no Edit; her role is not shown e-mail and phone.
  await page.locator(".crm-acc-person").filter({ hasText: "Ines Vaughan" }).click();
  const sheet = page.getByRole("dialog", { name: "Ines Vaughan" });
  await expect(sheet).toContainText("Operations Director");
  await expect(sheet).toContainText("Your role is not shown e-mail addresses and phone numbers.");
  await expect(sheet).not.toContainText("@");
  await expect(sheet.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const headers = await csrf(context.request);
  const ines = (await rows<{ id: number }>(context.request, data, "contacts", { column: "name", op: "eq", value: "Ines Vaughan" }))[0]!;
  expect((await context.request.patch(data("companies", `/${String(id)}`), { data: { values: { town: "Elsewhere" } }, headers })).status()).toBe(403);
  expect((await context.request.post(data("companies"), { data: { values: { name: "P07 Refused" } }, headers })).status()).toBe(403);
  expect((await context.request.patch(data("contacts", `/${String(ines.id)}`), { data: { values: { job_title: "Elsewhere" } }, headers })).status()).toBe(403);
  expect((await context.request.post(data("contacts"), { data: { values: { name: "P07 Refused", company_id: id, may_email: true } }, headers })).status()).toBe(403);
  expect((await context.request.delete(data("companies", `/${String(id)}?confirm=true`), { headers })).status()).toBe(403);
  // The e-mail she is not shown is refused by name, and left empty when she asks for the row.
  expect((await context.request.get(data("contacts", "?select=id,email&limit=5"))).status()).toBe(403);
  expect(await rows(context.request, data, "companies", { column: "name", op: "eq", value: "P07 Refused" })).toEqual([]);
});

test("live, two people: the manager adds a company and a deal there, and Sam's open list follows", async ({ as, data }) => {
  const sam = await as("sam");
  const page = await sam.newPage();
  await page.goto(`${STAFF}companies`);
  await expect(card(page, "Nordwind Logistics")).toHaveCount(1);
  const before = await page.locator(".crm-acc-card").count();
  await expect(card(page, "P07 Verity Insurance")).toHaveCount(0);

  const ivy = (await as("ivy")).request;
  const headers = await csrf(ivy);
  const made = await ivy.post(data("companies"), { data: { values: { name: "P07 Verity Insurance", sector: "Insurance", town: "Durham" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  // No reload: the list hears it.
  await expect(card(page, "P07 Verity Insurance")).toHaveCount(1);
  await expect(page.locator(".crm-acc-card")).toHaveCount(before + 1);
  await expect(card(page, "P07 Verity Insurance").locator(".crm-acc-card-open span").first()).toHaveText("Nothing open");
  // She renames its town: the card follows.
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  expect((await ivy.patch(data("companies", `/${String(id)}`), { data: { values: { town: "Sunderland" } }, headers })).status()).toBe(200);
  await expect(card(page, "P07 Verity Insurance").locator(".crm-acc-card-meta")).toHaveText("Insurance · Sunderland");
});

test("the company's timeline: the ledger's five and six for the manager, her own three and four for Dana", async ({ as, data }) => {
  const ivy = await as("ivy");
  const page = await ivy.newPage();
  const problems = watch(page);
  const id = await companyId(ivy.request, data, "Nordwind Logistics");
  await page.goto(`${STAFF}companies/${String(id)}`);
  await page.getByRole("link", { name: "Full timeline" }).click();
  await expect(page).toHaveURL(new RegExp(`/companies/${String(id)}/timeline$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nordwind Logistics");
  const chip = (target: Page, type: string) => target.locator(`.crm-chip-btn[data-type="${type}"]`);
  // Nordwind by kind: call 1, email 1, meeting 1, note 2; and six stage changes (d1 four, d12 two).
  for (const [type, count] of [["call", "1"], ["email", "1"], ["meeting", "1"], ["note", "2"], ["stage", "6"]] as const) await expect(chip(page, type).locator(".crm-chip-count"), type).toHaveText(count);
  await expect(chip(page, "all").locator(".crm-chip-count")).toHaveCount(0);
  await expect(page.locator(".crm-feed-entry")).toHaveCount(11);
  // Newest first: Dana's e-mail of Monday.
  await expect(page.locator(".crm-feed-entry").first()).toContainText("Nudged Petra on the layout.");
  await expect(page.locator(".crm-feed-entry").first()).toContainText("Fourth-floor desk rows");
  await expect(page.locator(".crm-feed-entry").first()).toContainText("Dana");
  await expect(page.locator(".crm-feed-day").first()).toContainText("Yesterday · Mon, Jul 27");
  // Asked directly, as her: the same counts.
  const deals = (await rows<{ id: number }>(ivy.request, data, "deals", { and: [{ column: "company_id", op: "eq", value: id }, { column: "state", op: "eq", value: "open" }] })).map((deal) => deal.id);
  const on = { column: "deal_id", op: "in", value: deals };
  const activities = await rows<{ kind: string }>(ivy.request, data, "activities", on);
  const moves = await rows(ivy.request, data, "deal_stage_changes", on);
  expect([activities.length, moves.length]).toEqual([5, 6]);
  expect(["call", "email", "meeting", "note"].map((kind) => activities.filter((one) => one.kind === kind).length)).toEqual([1, 1, 1, 2]);

  await chip(page, "note").click();
  await expect(page.locator(".crm-feed-entry")).toHaveCount(2);
  await chip(page, "stage").click();
  await expect(page.locator(".crm-feed-entry")).toHaveCount(6);
  await expect(page.locator(".crm-feed-entry").last()).toContainText(/Opened in (Discovery|Qualified)/);
  await picture(page, "7-ivy-nordwind-timeline");
  // A deal's name opens its room; Back comes back; the company's name goes to its profile.
  await chip(page, "all").click();
  await page.locator(".crm-feed-entry").first().getByRole("link", { name: "Fourth-floor desk rows" }).click();
  await expect(page).toHaveURL(/\/deals\/\d+$/);
  await page.goBack();
  await expect(page.locator(".crm-feed-entry")).toHaveCount(11);
  await page.getByRole("link", { name: "Nordwind Logistics" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/companies/${String(id)}$`));
  expect(problems).toEqual([]);

  // Dana: what was logged on HER deal there. Leo's two entries and two moves are not hers to read.
  const dana = await as("dana");
  const hers = await dana.newPage();
  await hers.goto(`${STAFF}companies/${String(id)}/timeline`);
  for (const [type, count] of [["call", "0"], ["email", "1"], ["meeting", "1"], ["note", "1"], ["stage", "4"]] as const) await expect(chip(hers, type).locator(".crm-chip-count"), type).toHaveText(count);
  await expect(hers.locator(".crm-feed-entry")).toHaveCount(7);
  await expect(hers.locator("main")).not.toContainText("Depot supervisor stations");
  const danas = (await rows<{ id: number }>(dana.request, data, "deals", { and: [{ column: "company_id", op: "eq", value: id }, { column: "state", op: "eq", value: "open" }] })).map((deal) => deal.id);
  expect(danas).toHaveLength(1);
  expect([(await rows(dana.request, data, "activities", { column: "deal_id", op: "in", value: danas })).length, (await rows(dana.request, data, "deal_stage_changes", { column: "deal_id", op: "in", value: danas })).length]).toEqual([3, 4]);
  // A kind with nothing says so.
  await chip(hers, "call").click();
  await expect(hers.locator(".crm-empty-title")).toHaveText("Nothing of that kind here");
  // An address that names no company reads as no record.
  await hers.goto(`${STAFF}companies/999999/timeline`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("There is no record at this address");
});

test("Companies and a profile at 390 wide in the dark, and in Arabic right to left", async ({ as, data }) => {
  const context = await as("tessa", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const narrow = await context.newPage();
  const id = await companyId(context.request, data, "Nordwind Logistics");
  for (const path of ["companies", `companies/${String(id)}`, `companies/${String(id)}/timeline`]) {
    await narrow.goto(`${STAFF}${path}`);
    await expect(narrow.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(narrow.locator(".mr-skel")).toHaveCount(0);
    expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    await picture(narrow, `8-tessa-390-dark-${path.replace(/\W+/g, "-")}`);
  }

  const leo = await as("leo");
  await inArabic(leo.request, async () => {
    const page = await leo.newPage();
    await page.goto(`${STAFF}companies`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الشركات");
    expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
    // Leo's own: one open deal at Nordwind (d12), in Arabic's own plural.
    await expect(card(page, "Nordwind Logistics").locator(".crm-acc-card-open span").first()).toHaveText("صفقة مفتوحة واحدة لك");
    await card(page, "Nordwind Logistics").locator(".crm-acc-card-name").click();
    await expect(fact(page, "open").locator("dt")).toHaveText("قيمتي المفتوحة");
    await expect(page.locator(".crm-acc-quiet li")).toContainText("لدى Dana Whitlock صفقة مفتوحة هنا");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await picture(page, "9-leo-nordwind-arabic");
  });
});
