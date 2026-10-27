/**
 * P14, an enquiry turned into a deal ("a new company from here", decision 35).
 *
 * WHY THIS FILE RUNS LATE (`y-`). Claiming makes a deal. A deal that has lived
 * a minute cannot be removed by any app role (the rows the rules hang on it
 * block it), and an open deal moves the team's figures every other spec reads
 * (14 open deals, the board's columns, the manager's screens). This spec
 * takes its deals away within seconds, as the CRM admin; if that ever fails,
 * the damage falls after the specs that count deals, not before them.
 *
 * Everything made here is named "P14 …".
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, removeDeals, rows, STAFF, watch, type Data } from "./helpers.ts";

const cards = (page: Page) => page.locator(".crm-enq");

async function clear(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  // The enquiry first (it names the deal), then the deal and its steps, then the contact and the company.
  for (const ref of ["enquiries"] as const) {
    for (const row of await rows<{ id: number }>(admin, data, ref, { column: "company_name", op: "like", value: "P14 %" })) expect((await admin.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
  await removeDeals(admin, data, "P14 ");
  const companies = await rows<{ id: number }>(admin, data, "companies", { column: "name", op: "like", value: "P14 %" });
  for (const company of companies) {
    for (const contact of await rows<{ id: number }>(admin, data, "contacts", { column: "company_id", op: "eq", value: company.id })) expect((await admin.delete(data("contacts", `/${String(contact.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    expect((await admin.delete(data("companies", `/${String(company.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
}

test("a rep claims an enquiry from a company not on the books: the company, its contact, the deal and its first step, all hers", async ({ as, api, data, stand }) => {
  const admin = await api("tessa");
  await clear(admin, data);
  const before = { companies: (await rows(admin, data, "companies")).length, contacts: (await rows(admin, data, "contacts")).length, open: (await rows(admin, data, "deals", { column: "state", op: "eq", value: "open" })).length };
  // §28: a claim makes one company, one contact, one deal and one follow-up (on the untouched sample: 9, 13 and 14 become 10, 14 and 15).
  // The specs before this one may have left a deal of their own behind, so the count is taken here and the claim is held to "one more of each".
  const corin = await api("corin");
  const taken = await corin.post(data("enquiries"), {
    data: { values: { source: "form", company_name: "P14 Westgate Care", person: "Hannah Doyle", email: "hannah@p14-westgate.example", town: "Doncaster", wants: "P14 chairs for a call centre", text: "Ninety task chairs.", est_value: 28000 }, clientKey: "p14claimAAAAAAAAAAAAAAAAAAAAAAAA" },
    headers: await csrf(corin),
  });
  expect(taken.status(), await taken.text()).toBe(201);
  const enquiry = ((await taken.json()) as { data: { id: number } }).data.id;
  const me = stand.people["priya"]!.id;

  const context = await as("priya");
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}inbox`);
    const card = cards(page).filter({ hasText: "P14 chairs for a call centre" });
    await expect(card.locator("[data-match]")).toHaveText("No company on the books");
    const opener = card.locator('[data-act="claim"]');
    await opener.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Start a deal" });
    // Filled from the enquiry.
    await expect(sheet.getByLabel("What is the work?")).toHaveValue("P14 chairs for a call centre");
    await expect(sheet.getByLabel("Amount")).toHaveValue("28000");
    await expect(sheet.locator("#crm-nd-amount-read")).toHaveText("Reads as £28,000");
    await expect(sheet.getByRole("radio", { name: "New company: P14 Westgate Care" })).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByTestId("new-company-note")).toHaveText("P14 Westgate Care is put on the books with Hannah Doyle as its first contact, then the deal is started there.");
    await expect(sheet.getByRole("textbox", { name: "Line up the first step" })).toHaveValue("First call with Hannah Doyle about P14 chairs for a call centre");
    // Whoever typed the enquiry in said nothing of our mail: the sheet asks Priya to, at her first call.
    await expect(sheet.locator(".crm-optout-line")).toHaveText("Say it when you first speak to them: “We may e-mail you now and then about our work. You can say no now, or at any time from any e-mail.”");
    await expect(sheet.getByTestId("opt-out-carried")).toHaveCount(0);
    await picture(page, "6-priya-claim-sheet");
    // Escape gives the focus back; nothing was claimed by looking.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect((await rows<{ state: string }>(admin, data, "enquiries", { column: "id", op: "eq", value: enquiry }))[0]!.state).toBe("open");

    await opener.click();
    await sheet.getByRole("button", { name: "Add to the board" }).click();
    await expect(page.locator(".crm-toast")).toContainText("P14 chairs for a call centre is on the board");
    await expect(sheet).toHaveCount(0);

    // What the server now holds: the enquiry is hers and names its deal and its company.
    const told = (await rows<{ state: string; claimed_by_id: string; deal_id: number; company_id: number }>(admin, data, "enquiries", { column: "id", op: "eq", value: enquiry }))[0]!;
    expect([told.state, told.claimed_by_id]).toEqual(["claimed", me]);
    const company = (await rows<{ id: number; name: string; town: string; account_owner_id: string }>(admin, data, "companies", { column: "name", op: "eq", value: "P14 Westgate Care" }));
    expect(company.map((row) => [row.town, row.account_owner_id])).toEqual([["Doncaster", me]]);
    expect(told.company_id).toBe(company[0]!.id);
    const contact = await rows<{ id: number; name: string; email: string; may_email: boolean | number; opt_out_offered_at: string | null }>(admin, data, "contacts", { column: "company_id", op: "eq", value: company[0]!.id });
    expect(contact.map((row) => [row.name, row.email, Boolean(row.may_email)])).toEqual([["Hannah Doyle", "hannah@p14-westgate.example", false]]);
    // The sheet showed the line with her address: the server marked her as offered a way to say no.
    expect(contact[0]!.opt_out_offered_at).not.toBeNull();
    const deal = (await rows<{ id: number; owner_id: string; company_id: number; contact_id: number; typed_amount: number; state: string }>(admin, data, "deals", { column: "name", op: "eq", value: "P14 chairs for a call centre" }));
    expect(deal.map((row) => [row.owner_id, row.company_id, row.contact_id, Number(row.typed_amount), row.state])).toEqual([[me, company[0]!.id, contact[0]!.id, 28000, "open"]]);
    expect(told.deal_id).toBe(deal[0]!.id);
    const steps = await rows<{ text: string; owner_id: string }>(admin, data, "follow_ups", { column: "deal_id", op: "eq", value: deal[0]!.id });
    expect(steps.map((row) => [row.text, row.owner_id])).toEqual([["First call with Hannah Doyle about P14 chairs for a call centre", me]]);
    // §28: one company, one contact, one deal more.
    expect({ companies: (await rows(admin, data, "companies")).length, contacts: (await rows(admin, data, "contacts")).length, open: (await rows(admin, data, "deals", { column: "state", op: "eq", value: "open" })).length }).toEqual({ companies: before.companies + 1, contacts: before.contacts + 1, open: before.open + 1 });

    // Her inbox says so, and the deal opens from it.
    await page.locator('.crm-chip-btn[data-filter="mine"]').click();
    const mine = cards(page).filter({ hasText: "P14 chairs for a call centre" });
    await expect(mine).toContainText("You claimed it");
    await expect(mine.locator(".crm-enq-settled")).toContainText("You claimed this.");
    await expect(mine.locator("[data-match]")).toHaveText("Matches P14 Westgate Care");
    await expect(mine.getByRole("link", { name: "Open its deal" })).toHaveAttribute("href", new RegExp(`/deals/${String(deal[0]!.id)}$`));
    expect(problems).toEqual([]);

    // A colleague who had the inbox open a moment ago presses Claim on what is now Priya's: the server's refusal, and nothing made.
    const sam = await api("sam");
    const late = await sam.post(data("enquiries", `/${String(enquiry)}/actions/claim`), { data: { from: "open" }, headers: await csrf(sam) });
    expect([403, 404, 409]).toContain(late.status());
    expect((await rows(admin, data, "enquiries", { column: "id", op: "eq", value: enquiry }) as { claimed_by_id: string }[])[0]!.claimed_by_id).toBe(me);
  } finally {
    await clear(admin, data);
  }
  expect({ companies: (await rows(admin, data, "companies")).length, contacts: (await rows(admin, data, "contacts")).length, open: (await rows(admin, data, "deals", { column: "state", op: "eq", value: "open" })).length }).toEqual(before);
});

test("the CRM admin starts a deal from a trade-show lead for a company already on the books, and picks whose it is", async ({ as, api, data, stand }) => {
  const admin = await api("tessa");
  await clear(admin, data);
  const show = (await rows<{ id: number }>(admin, data, "shows"))[0]!;
  const cobalt = (await rows<{ id: number }>(admin, data, "companies", { column: "name", op: "eq", value: "Cobalt Legal" }))[0]!;
  const made = await admin.post(data("enquiries"), {
    data: { values: { source: "show", company_name: "P14 Cobalt again", person: "Ines Vaughan", wants: "P14 screens for floor three", warmth: "hot", show_id: show.id, company_id: cobalt.id }, clientKey: "p14leadclaimAAAAAAAAAAAAAAAAAAAA" },
    headers: await csrf(admin),
  });
  expect(made.status(), await made.text()).toBe(201);
  // A lead nobody has yet (the claim then starts from "open").
  const page = await (await as("tessa")).newPage();
  try {
    await page.goto(`${STAFF}trade-show-leads`);
    const card = cards(page).filter({ hasText: "P14 Cobalt again" });
    await card.locator('[data-act="deal"]').click();
    const sheet = page.getByRole("dialog", { name: "Start a deal" });
    // The company is the one it matches: no second copy is offered.
    await expect(sheet.getByRole("radio", { name: "Cobalt Legal" })).toHaveAttribute("aria-checked", "true");
    await expect(sheet.locator("[data-new-company]")).toHaveCount(0);
    await sheet.getByLabel("Amount").fill("7,200");
    await sheet.getByRole("radiogroup", { name: "Who owns it?" }).getByRole("radio", { name: /Leo/ }).click();
    await sheet.getByRole("button", { name: "Add to the board" }).click();
    await expect(page.locator(".crm-toast")).toContainText("P14 screens for floor three is on the board");
    const deal = (await rows<{ id: number; owner_id: string; company_id: number }>(admin, data, "deals", { column: "name", op: "eq", value: "P14 screens for floor three" }))[0]!;
    expect([deal.owner_id, deal.company_id]).toEqual([stand.people["leo"]!.id, cobalt.id]);
    const told = (await rows<{ state: string; deal_id: number; claimed_by_id: string }>(admin, data, "enquiries", { column: "company_name", op: "eq", value: "P14 Cobalt again" }))[0]!;
    expect([told.state, told.deal_id, told.claimed_by_id]).toEqual(["claimed", deal.id, stand.people["tessa"]!.id]);
    // The lead now reads "became work", and the show's count of deals is one.
    await expect(card.locator("[data-lead-pill]")).toHaveText("Became work");
    await expect(page.locator('.crm-chip-btn[data-filter="deal"] .crm-chip-count')).toHaveText("1");
    await expect(page.locator('.crm-leads-stat[data-stat="deal"] .crm-leads-value')).toHaveText("1");
    await expect(card.getByRole("link", { name: "Open its deal" })).toBeVisible();
  } finally {
    await clear(admin, data);
  }
});

test("an enquiry whose taker said the line hands its mark to the contact a claim makes of it", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await clear(admin, data);
  // The front desk takes a call and says the line: the server marks the enquiry.
  const corin = await api("corin");
  const taken = await corin.post(data("enquiries"), {
    data: { values: { source: "phone", company_name: "P14 Larkfield Vets", person: "Owen Pike", email: "owen@p14-larkfield.example", wants: "P14 benches for a waiting room", est_value: 3500 }, clientKey: "p14markAAAAAAAAAAAAAAAAAAAAAAAAA", optOut: { shown: true } },
    headers: await csrf(corin),
  });
  expect(taken.status(), await taken.text()).toBe(201);
  const enquiry = ((await taken.json()) as { data: { id: number } }).data.id;
  const offered = (await rows<{ opt_out_offered_at: string | null }>(admin, data, "enquiries", { column: "id", op: "eq", value: enquiry }))[0]!.opt_out_offered_at;
  expect(offered).not.toBeNull();
  const page = await (await as("priya")).newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}inbox`);
    await cards(page).filter({ hasText: "P14 benches for a waiting room" }).locator('[data-act="claim"]').click();
    const sheet = page.getByRole("dialog", { name: "Start a deal" });
    // Said already: the sheet says when, and asks nothing more.
    await expect(sheet.getByTestId("opt-out-carried")).toHaveText(/^They were offered a way to say no on .+$/);
    await expect(sheet.locator(".crm-optout")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Add to the board" }).click();
    await expect(page.locator(".crm-toast")).toContainText("P14 benches for a waiting room is on the board");
    const company = (await rows<{ id: number }>(admin, data, "companies", { column: "name", op: "eq", value: "P14 Larkfield Vets" }))[0]!;
    const contact = (await rows<{ email: string; opt_out_offered_at: string | null }>(admin, data, "contacts", { column: "company_id", op: "eq", value: company.id }))[0]!;
    expect(contact.email).toBe("owen@p14-larkfield.example");
    expect(new Date(contact.opt_out_offered_at!).getTime()).toBe(new Date(offered!).getTime());
    expect(problems).toEqual([]);
  } finally {
    await clear(admin, data);
  }
});
