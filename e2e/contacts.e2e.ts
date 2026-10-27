/**
 * P07, Contacts (ledger §4c) and a contact's record sheet.
 *
 * Thirteen contacts. Main contact on two open deals: Marta Kovac and Ruth
 * Adeyemi; on one: ten of them; on none: Kit Delaney.
 *
 * A card names a deal only when it is the one open deal of that contact AND
 * the reader may open it. A colleague's deal is a count, never a name
 * (finding P21): Dana reads "main contact on 1 open deal" for Tomas Reidy,
 * whose deal is Sam's. The count is the server's, over the deals' marks. The
 * marketer's cards say nothing of deals (her count is a company's). A
 * contact's e-mail and phone are kept from Read-only by the server; the
 * marketer reads them (she sends the campaigns, 0.2.3).
 *
 * What a spec makes is called "P07 …" and taken away by the CRM admin.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { authOf, expect, picture, stand, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

const card = (page: Page, name: string) => page.locator(".crm-acc-contact").filter({ has: page.locator(".crm-acc-contact-name", { hasText: new RegExp(`^${name}$`) }) });
const NAMES = ["Ana Belova", "Bea Nolan", "Callum Finch", "Ines Vaughan", "Jonas Reuter", "Kit Delaney", "Marta Kovac", "Owen Marsh", "Petra Lindqvist", "Ruth Adeyemi", "Sadie Moore", "Tomas Reidy", "Yusuf Demir"];
/** The one open deal each of these is the main contact of. */
const ONE: Record<string, string> = {
  "Ana Belova": "Clinic waiting-room seating",
  "Bea Nolan": "Quiet-room pods",
  "Callum Finch": "Partner-office fit-out",
  "Ines Vaughan": "Records-room lockers",
  "Jonas Reuter": "Depot supervisor stations",
  "Owen Marsh": "Analyst pods, second floor",
  "Petra Lindqvist": "Fourth-floor desk rows",
  "Sadie Moore": "Task seating refresh",
  "Tomas Reidy": "Reception desk and lounge",
  "Yusuf Demir": "Lab bench stools",
};
const DANAS = ["Bea Nolan", "Ines Vaughan", "Owen Marsh", "Petra Lindqvist"];

test.afterAll(async ({ browser }) => {
  const state = stand();
  const context = await browser.newContext({ baseURL: state.url, storageState: await authOf(browser, "tessa") });
  const data: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;
  const admin = context.request;
  const headers = await csrf(admin);
  for (const person of await rows<{ id: number }>(admin, data, "contacts", { column: "name", op: "like", value: "P07 %" })) expect((await admin.delete(data("contacts", `/${String(person.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  await context.close();
});

/** How many open deals each contact is the main contact of, as the server answers this person from the marks. */
async function mainCounts(person: APIRequestContext, data: Data): Promise<Record<number, number>> {
  const marks = await rows<{ contact_id: number | null }>(person, data, "deal_marks", { column: "state", op: "eq", value: "open" });
  const out: Record<number, number> = {};
  for (const mark of marks) if (mark.contact_id !== null && mark.contact_id !== undefined) out[mark.contact_id] = (out[mark.contact_id] ?? 0) + 1;
  return out;
}

test("Dana opens Contacts from her menu: her own deal is named, a colleague's is a count", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Contacts" }).click();
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/contacts$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contacts");
  await expect(page.locator(".crm-acc-contact-name")).toHaveText(NAMES);
  // Who they are and how to reach them.
  const ines = card(page, "Ines Vaughan");
  await expect(ines.locator(".crm-acc-contact-role")).toHaveText("Operations Director");
  await expect(ines.locator(".crm-acc-contact-co")).toHaveText("Cobalt Legal");
  await expect(ines.locator(".crm-acc-contact-ways")).toContainText("ines.vaughan@cobaltlegal.example");
  await expect(ines.locator(".crm-acc-contact-ways")).toContainText("0113 496 0182");

  // The one open deal of a contact is named when it is hers, as a link to its room.
  for (const name of DANAS) {
    await expect(card(page, name).locator(".crm-acc-contact-deals"), name).toHaveText(`Main contact on ${ONE[name]!}`);
    await expect(card(page, name).locator(".crm-acc-contact-deals a"), name).toHaveText(ONE[name]!);
  }
  // A colleague's deal is a count and nothing else: Tomas's is Sam's, Jonas's is Leo's.
  for (const name of Object.keys(ONE).filter((one) => !DANAS.includes(one))) {
    await expect(card(page, name).locator(".crm-acc-contact-deals"), name).toHaveText("Main contact on 1 open deal");
    await expect(card(page, name).locator(".crm-acc-contact-deals a"), name).toHaveCount(0);
    await expect(page.locator("main"), name).not.toContainText(ONE[name]!);
  }
  // Two open deals are a count whoever holds them: Marta's are both Dana's, Ruth's are Sam's and Priya's.
  for (const name of ["Marta Kovac", "Ruth Adeyemi"]) await expect(card(page, name).locator(".crm-acc-contact-deals"), name).toHaveText("Main contact on 2 open deals");
  await expect(card(page, "Kit Delaney").locator(".crm-acc-contact-deals")).toHaveCount(0);

  // Each line is what the server answers her: the marks' count, and the names of the deals she may open.
  const people = await rows<{ id: number; name: string }>(context.request, data, "contacts");
  const counts = await mainCounts(context.request, data);
  const hers = await rows<{ name: string; contact_id: number }>(context.request, data, "deals", { column: "state", op: "eq", value: "open" });
  expect(hers).toHaveLength(6);
  for (const person of people) {
    const all = counts[person.id] ?? 0;
    const mine = hers.filter((deal) => deal.contact_id === person.id);
    const line = card(page, person.name).locator(".crm-acc-contact-deals");
    if (all === 0) await expect(line, person.name).toHaveCount(0);
    else await expect(line, person.name).toHaveText(all === 1 && mine.length === 1 ? `Main contact on ${mine[0]!.name}` : `Main contact on ${String(all)} open ${all === 1 ? "deal" : "deals"}`);
  }
  expect(problems).toEqual([]);
  await picture(page, "1-dana-contacts");

  // The box narrows by name, role or company; a company's chip opens its profile.
  const box = page.getByRole("searchbox", { name: "Filter by name, role or company" });
  await box.fill("nordwind");
  await expect(page.locator(".crm-acc-contact-name")).toHaveText(["Jonas Reuter", "Petra Lindqvist"]);
  await box.fill("partner");
  await expect(page.locator(".crm-acc-contact-name")).toHaveText(["Callum Finch"]);
  await box.fill("nobody at all");
  await expect(page.locator(".crm-empty-title")).toHaveText("Nobody by that name");
  await box.fill("petra");
  await card(page, "Petra Lindqvist").locator(".crm-acc-contact-co").click();
  await expect(page).toHaveURL(/\/companies\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nordwind Logistics");
});

test("the sales manager may open every deal: each one-deal contact names it; the ledger's two, ten and one", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  await page.goto(`${STAFF}contacts`);
  await expect(page.locator(".crm-acc-contact")).toHaveCount(13);
  for (const [name, deal] of Object.entries(ONE)) await expect(card(page, name).locator(".crm-acc-contact-deals a"), name).toHaveText(deal);
  for (const name of ["Marta Kovac", "Ruth Adeyemi"]) await expect(card(page, name).locator(".crm-acc-contact-deals"), name).toHaveText("Main contact on 2 open deals");
  await expect(card(page, "Kit Delaney").locator(".crm-acc-contact-deals")).toHaveCount(0);
  const counts = Object.values(await mainCounts(context.request, data));
  expect([counts.filter((n) => n === 2).length, counts.filter((n) => n === 1).length, 13 - counts.length]).toEqual([2, 10, 1]);
  await picture(page, "2-ivy-contacts");
});

test("the marketer reads who her campaigns go to, and is told nothing of deals; Read-only is not shown e-mail and phone; the server holds each", async ({ as, data }) => {
  const lena = await as("lena");
  const page = await lena.newPage();
  await page.goto(`${STAFF}contacts`);
  await expect(page.locator(".crm-acc-contact")).toHaveCount(13);
  // She sends the campaigns (0.2.3): a contact's address and phone are hers to read.
  await expect(page.locator(".crm-acc-kept")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("@");
  await expect(page.locator(".crm-acc-contact-deals")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New contact" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await picture(page, "3-lena-contacts");
  // Asked directly: the e-mail is answered; whose contact a mark names is refused; so is every write.
  expect((await lena.request.get(data("contacts", "?select=id,name,email&limit=5"))).status()).toBe(200);
  const row = (await rows<Record<string, unknown>>(lena.request, data, "contacts"))[0]!;
  expect(String(row["email"])).toMatch(/@/);
  const headers = await csrf(lena.request);
  // Whose a deal is, she is never answered; and no deal at all.
  expect((await lena.request.get(data("deal_marks", "?select=owner_id&limit=5"))).status()).toBe(403);
  expect((await lena.request.get(data("deals", "?limit=5"))).status()).toBe(403);
  expect((await lena.request.patch(data("contacts", `/${String(row["id"])}`), { data: { values: { job_title: "Elsewhere" } }, headers })).status()).toBe(403);
  expect((await lena.request.post(data("contacts"), { data: { values: { name: "P07 Refused", company_id: row["company_id"], may_email: true } }, headers })).status()).toBe(403);

  // Read-only reads the team's deals, so her cards name them; her role is not shown the details either, and has nothing to press.
  const grace = await as("grace");
  const hers = await grace.newPage();
  await hers.goto(`${STAFF}contacts`);
  await expect(hers.locator(".crm-acc-contact")).toHaveCount(13);
  await expect(hers.locator(".crm-acc-kept")).toBeVisible();
  await expect(hers.locator(".crm-acc-contact-ways")).toHaveCount(0);
  await expect(card(hers, "Tomas Reidy").locator(".crm-acc-contact-deals a")).toHaveText("Reception desk and lounge");
  await expect(hers.getByRole("button", { name: "New contact" })).toHaveCount(0);
  await expect(hers.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  expect(await rows(grace.request, data, "contacts", { column: "name", op: "eq", value: "P07 Refused" })).toEqual([]);
});

test("a contact's sheet: who they are, where they come up; changed and read again; a new one saved once though its reply is lost", async ({ as, data }) => {
  const context = await as("sam");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}contacts`);
  await expect(page.locator(".crm-acc-contact")).toHaveCount(13);
  // Callum Finch is the main contact of Sam's own d14.
  const who = card(page, "Callum Finch").locator(".crm-acc-contact-who");
  await who.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Callum Finch" });
  await expect(sheet).toContainText("Partner · Harbor & Finch");
  const facts = sheet.locator(".crm-acc-rec-facts > div");
  // The company's street is a business's, read by everybody who reads companies (plan 68 R3); whether he may be emailed is said
  // too, and Callum has not said yes (R8, D14).
  await expect(facts).toHaveText(["RolePartner", "CompanyHarbor & Finch", "Emailc.finch@harborfinch.example", "Phone0131 208 6600", "Where19 Albany Court, Edinburgh, United Kingdom", "May be emailedNo"]);
  const links = sheet.locator(".crm-acc-rec-link");
  await expect(links).toHaveCount(2);
  await expect(links.first()).toContainText("Partner-office fit-out");
  await expect(links.first()).toContainText("Main contact · Negotiation");
  await expect(links.first()).toContainText("£31,000");
  await expect(links.last()).toContainText("Harbor & Finch");
  // The amount is the server's for that deal.
  expect(Number((await rows<{ amount: number }>(context.request, data, "deals", { column: "name", op: "eq", value: "Partner-office fit-out" }))[0]!.amount)).toBe(31000);

  // Edit, change the title, save: only that is sent, and the card reads it.
  await sheet.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Callum Finch" });
  await expect(edit.getByLabel("Job title")).toHaveValue("Partner");
  await expect(edit.getByRole("radio", { name: "Harbor & Finch" })).toHaveAttribute("aria-checked", "true");
  await edit.getByLabel("Job title").fill("Managing Partner");
  const patches: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") patches.push((request.postDataJSON() as { values: unknown }).values);
  });
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Callum Finch saved.");
  expect(patches).toEqual([{ job_title: "Managing Partner" }]);
  await expect(card(page, "Callum Finch").locator(".crm-acc-contact-role")).toHaveText("Managing Partner");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(who).toBeFocused();
  // Put back as it was, by the pencil; "Back" from the edit returns to the look.
  await page.getByRole("button", { name: "Edit Callum Finch" }).click();
  await page.getByRole("dialog", { name: "Callum Finch" }).getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog", { name: "Callum Finch" }).locator(".crm-acc-rec-facts")).toBeVisible();
  await page.getByRole("dialog", { name: "Callum Finch" }).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: "Callum Finch" }).getByLabel("Job title").fill("Partner");
  await page.getByRole("dialog", { name: "Callum Finch" }).getByRole("button", { name: "Save" }).click();
  await expect(card(page, "Callum Finch").locator(".crm-acc-contact-role")).toHaveText("Partner");

  // A new contact: a name and a company are asked for; the first reply is dropped; one contact is made.
  await page.getByRole("button", { name: "New contact" }).click();
  const add = page.getByRole("dialog", { name: "New contact" });
  await expect(add.getByLabel("Name")).toBeFocused();
  await add.getByRole("button", { name: "Add contact" }).click();
  await expect(add.locator(".crm-form-error")).toHaveText("Give the contact a name.");
  await add.getByLabel("Name").fill("P07 Ada Lowe");
  await add.getByRole("button", { name: "Add contact" }).click();
  await expect(add.locator(".crm-form-error")).toHaveText("Pick the company they work at.");
  await add.getByLabel("Job title").fill("Buyer");
  await add.getByLabel("Email").fill("ada.lowe@example.test");
  // A new contact may not be emailed until somebody ticks it (R8): the switch starts off, and she has said yes.
  const may = add.getByRole("switch", { name: "May be emailed" });
  await expect(may).toHaveAttribute("aria-checked", "false");
  await may.click();
  await expect(may).toHaveAttribute("aria-checked", "true");
  await add.getByRole("radio", { name: "Tandem Robotics" }).click();
  const sent: { key: string; replayed: boolean | null }[] = [];
  let dropped = false;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_contacts$/.test(new URL(request.url()).pathname)) return route.fallback();
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
  await add.getByRole("button", { name: "Add contact" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("P07 Ada Lowe added.");
  expect(sent.length).toBe(2);
  expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
  await page.unroute("**/api/v1/data/**");
  const made = await rows<{ job_title: string; email: string; may_email: boolean; company_id: number }>(context.request, data, "contacts", { column: "name", op: "eq", value: "P07 Ada Lowe" });
  expect(made).toHaveLength(1);
  expect([made[0]!.job_title, made[0]!.email, Boolean(made[0]!.may_email)]).toEqual(["Buyer", "ada.lowe@example.test", true]);
  await expect(card(page, "P07 Ada Lowe").locator(".crm-acc-contact-co")).toHaveText("Tandem Robotics");
  await expect(card(page, "P07 Ada Lowe").locator(".crm-acc-contact-deals")).toHaveCount(0);
  expect(problems.filter((problem) => !/ERR_CONNECTION_RESET|Failed to load resource/.test(problem))).toEqual([]);
  await picture(page, "4-sam-contact-added");
});

test("whether a contact may be emailed says who ticked it and when (R8)", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}contacts`);
  const who = card(page, "Ines Vaughan").locator(".crm-acc-contact-who");
  await who.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Ines Vaughan" });
  await expect(sheet.locator(".crm-acc-rec-facts > div").last()).toHaveText(/^May be emailedYes, since .+, ticked by Dana Whitlock$/);
  expect(problems).toEqual([]);
});

test("a contact has an address: the deal's room names its people as links to it", async ({ as, data }) => {
  const context = await as("priya");
  const page = await context.newPage();
  // d4 "Clinic waiting-room seating" is Priya's; Ana Belova is its main contact.
  const deal = (await rows<{ id: number; contact_id: number }>(context.request, data, "deals", { column: "name", op: "eq", value: "Clinic waiting-room seating" }))[0]!;
  await page.goto(`${STAFF}deals/${String(deal.id)}`);
  await page.locator(".crm-room-contact").getByRole("link", { name: "Ana Belova" }).click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${String(deal.contact_id)}$`));
  const sheet = page.getByRole("dialog", { name: "Ana Belova" });
  await expect(sheet).toContainText("Estates Manager · Fernway Clinics");
  await expect(sheet.locator(".crm-acc-rec-link").first()).toContainText("Clinic waiting-room seating");
  // Closing it leaves the list, at the list's own address.
  await sheet.getByRole("button", { name: "Close" }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card(page, "Ana Belova")).toHaveCount(1);
  // A number that names nobody says so in the sheet.
  await page.goto(`${STAFF}contacts/999999`);
  await expect(page.getByRole("dialog")).toContainText("This record is no longer there.");
});

test("live, two people: the manager adds a contact and Leo's open list follows", async ({ as, data }) => {
  const leo = await as("leo");
  const page = await leo.newPage();
  await page.goto(`${STAFF}contacts`);
  await expect(card(page, "Kit Delaney")).toHaveCount(1);
  await expect(card(page, "P07 Nia Okonjo")).toHaveCount(0);
  const ivy = (await as("ivy")).request;
  const headers = await csrf(ivy);
  const veldt = (await rows<{ id: number }>(ivy, data, "companies", { column: "name", op: "eq", value: "Veldt Studios" }))[0]!;
  const made = await ivy.post(data("contacts"), { data: { values: { name: "P07 Nia Okonjo", company_id: veldt.id, job_title: "Producer", may_email: false } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  await expect(card(page, "P07 Nia Okonjo")).toHaveCount(1);
  await expect(card(page, "P07 Nia Okonjo").locator(".crm-acc-contact-co")).toHaveText("Veldt Studios");
  // And when she is taken away again, the card goes.
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  const tessa = (await as("tessa")).request;
  expect((await tessa.delete(data("contacts", `/${String(id)}?confirm=true`), { headers: await csrf(tessa) })).status()).toBeLessThan(300);
  await expect(card(page, "P07 Nia Okonjo")).toHaveCount(0);
});

test("Contacts at 390 wide in the dark, and in Arabic right to left", async ({ as }) => {
  const narrow = await (await as("tessa", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await narrow.goto(`${STAFF}contacts`);
  await expect(card(narrow, "Kit Delaney")).toHaveCount(1);
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card(narrow, "Marta Kovac").locator(".crm-acc-contact-who").click();
  await expect(narrow.getByRole("dialog", { name: "Marta Kovac" })).toBeVisible();
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "5-tessa-contact-390-dark");

  const context = await as("leo");
  await inArabic(context.request, async () => {
    const page = await context.newPage();
    await page.goto(`${STAFF}contacts`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("جهات الاتصال");
    expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
    // Marta is the main contact of two open deals, in Arabic's own form for two; Jonas's one deal is Leo's own and is named.
    await expect(card(page, "Marta Kovac").locator(".crm-acc-contact-deals")).toHaveText("جهة الاتصال الرئيسية في صفقتين مفتوحتين");
    await expect(card(page, "Jonas Reuter").locator(".crm-acc-contact-deals")).toHaveText("جهة الاتصال الرئيسية في Depot supervisor stations");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await picture(page, "6-leo-contacts-arabic");
  });
});

test("a new contact's sheet says the line under the address: saved, she is marked as offered a way to say no; one who said no goes on the do-not-email list instead", async ({ as, api, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  const owner = await api("owner");
  const listed = async (address: string): Promise<{ id: string; address: string | null; reason: string }[]> =>
    ((await (await owner.get(`/api/v1/consent/stop-list?q=${encodeURIComponent(address)}`)).json()) as { data: { entries: { id: string; address: string | null; reason: string }[] } }).data.entries;
  try {
    await page.goto(`${STAFF}contacts`);
    // Told, and saved: the server marks the contact. Nothing is said before there is an address to say it at.
    await page.getByRole("button", { name: "New contact" }).click();
    const add = page.getByRole("dialog", { name: "New contact" });
    await add.getByLabel("Name").fill("P07 Line Told");
    await expect(add.locator(".crm-optout")).toHaveCount(0);
    await add.getByLabel("Email").fill("line.told@p07-optout.example");
    await expect(add.locator(".crm-optout-line")).toHaveText("Tell them: “We may e-mail you now and then about our work. You can say no now, or at any time from any e-mail.”");
    await add.getByRole("radio", { name: "Tandem Robotics" }).click();
    const sent: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /crm_contacts$/.test(new URL(request.url()).pathname)) sent.push((request.postDataJSON() as { optOut?: unknown }).optOut ?? null);
    });
    await add.getByRole("button", { name: "Add contact" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("P07 Line Told added.");
    expect(sent).toEqual([{ shown: true }]);
    const told = (await rows<{ id: number; opt_out_offered_at: string | null }>(context.request, data, "contacts", { column: "name", op: "eq", value: "P07 Line Told" }))[0]!;
    expect(told.opt_out_offered_at).not.toBeNull();

    // They said no: not marked, and on the do-not-email list once saved, by Dana.
    await page.getByRole("button", { name: "New contact" }).click();
    const again = page.getByRole("dialog", { name: "New contact" });
    await again.getByLabel("Name").fill("P07 Line Refused");
    await again.getByLabel("Email").fill("line.refused@p07-optout.example");
    const no = again.getByRole("button", { name: "They said no" });
    await no.click();
    await expect(no).toHaveAttribute("aria-pressed", "true");
    await expect(again.locator(".crm-optout [role=status]")).toHaveText("They go on the do-not-email list when you save, and are not counted as offered a way to say no.");
    await again.getByRole("radio", { name: "Tandem Robotics" }).click();
    await again.getByRole("button", { name: "Add contact" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("P07 Line Refused is on the do-not-email list.");
    expect(sent).toEqual([{ shown: true }, null]);
    const refused = (await rows<{ id: number; opt_out_offered_at: string | null }>(context.request, data, "contacts", { column: "name", op: "eq", value: "P07 Line Refused" }))[0]!;
    expect(refused.opt_out_offered_at).toBeNull();
    expect((await listed("line.refused@p07-optout.example")).map((entry) => [entry.address, entry.reason])).toEqual([["line.refused@p07-optout.example", "hand"]]);
    // Her sheet says so, from the server.
    await card(page, "P07 Line Refused").locator(".crm-acc-contact-who").click();
    const sheet = page.getByRole("dialog", { name: "P07 Line Refused" });
    await expect(sheet.locator(".crm-acc-rec-facts > div").last()).toHaveText(/^Do-not-email listOn the do-not-email list since .+$/);
    expect(problems).toEqual([]);
  } finally {
    const headers = await csrf(owner);
    for (const address of ["line.told@p07-optout.example", "line.refused@p07-optout.example"]) for (const entry of await listed(address)) await owner.delete(`/api/v1/consent/stop-list/${entry.id}`, { headers });
  }
});
