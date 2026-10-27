/**
 * P07, Paste a list (ledger §21): Adminium's own import, drawn on a screen of
 * the app. Its first real place.
 *
 * A rep and the sales manager have it under Accounts, the CRM admin under
 * Settings. Below the admin a line that is already here is left as it is and
 * the screen offers nothing else (the server would let a rep update; the
 * proof `crm-accounts` shows that it does, and the screen keeps it for the
 * admin). A company is "already here" when its customer number is the same
 * (plan 68 X3 holds a rep and the manager to some companies, and the server
 * matches such a writer's list only on a column no two companies share); for
 * the CRM admin, when its name is.
 *
 * Nobody else brings a list in: the marketer, Read-only and the account
 * manager are refused BY THE SERVER, asked directly, and their address for
 * this screen says it is not part of their role.
 *
 * The three companies it brings in are called "P07 List …" and taken away by
 * the CRM admin at the end.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { authOf, expect, picture, stand, test } from "./fixtures.ts";
import { csrf, inArabic, removeDeals, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

const LIST = ["Name\tSector\tTown\tCustomer number", "P07 List Kestrel Print\tPrinting\tYork\tP07LK", "P07 List Verity Insurance\tInsurance\tDurham\tP07LV", "P07 List Halden Foods\tFood\tRipon\tP07LH"].join("\n");
/** What each line of the preview would do, in order. */
const statuses = async (page: Page): Promise<string[]> => (await lines(page)).map((line) => line.split(" ")[0]!);
const wizard = (page: Page) => page.locator('[data-kit-part="import"]').first();
const lines = (page: Page): Promise<string[]> =>
  wizard(page)
    .locator('[data-testid="import-preview"] [data-line]')
    .evaluateAll((all) => all.map((line) => `${line.getAttribute("data-status") ?? ""} ${line.querySelector('[data-part="line-label"]')?.textContent ?? ""}`));
const brought = (person: APIRequestContext, data: Data) => rows<{ id: number; name: string; sector: string; town: string }>(person, data, "companies", { column: "name", op: "like", value: "P07 List %" }, "&order=name");

async function removeMade(browser: import("@playwright/test").Browser): Promise<void> {
  const state = stand();
  const context = await browser.newContext({ baseURL: state.url, storageState: await authOf(browser, "tessa") });
  const data: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;
  const headers = await csrf(context.request);
  for (const company of await brought(context.request, data)) expect((await context.request.delete(data("companies", `/${String(company.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  await context.close();
}
test.beforeAll(async ({ browser }) => removeMade(browser));
test.afterAll(async ({ browser }) => removeMade(browser));

/** The same import as the screen makes, by a direct call as this person: what the server says to it. */
async function direct(person: APIRequestContext, table: string, mode: "skip" | "upsert" = "skip"): Promise<string> {
  const state = stand();
  const headers = await csrf(person);
  const upload = await person.post("/api/v1/imports/upload?filename=direct.csv", { headers: { ...headers, "content-type": "text/csv" }, data: LIST });
  if (upload.status() !== 201) return `upload ${String(upload.status())}`;
  const fileId = ((await upload.json()) as { data: { fileId: string } }).data.fileId;
  const made = await person.post("/api/v1/imports", {
    headers,
    data: { fileId, connectionId: state.connectionId, table: state.tables[`crm_${table}`], mapping: { columns: [{ from: "Name", to: "name" }] }, options: { mode, matchColumn: "name", skipInvalid: true } },
  });
  if (made.status() === 201) return "made";
  const error = ((await made.json()) as { error?: { code?: string; details?: { permission?: string } } }).error;
  return `${String(made.status())} ${String(error?.code)} ${String(error?.details?.permission ?? "").split(":").pop() ?? ""}`.trim();
}

test("Dana pastes three companies: looked at, brought in, in the list; pasted again, nothing is brought in", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Paste a list" }).click();
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/paste-a-list$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paste a list");
  // What she is offered, said before she pastes: a line already here is left alone, and a company is matched on its
  // customer number (plan 68 X3: the server matches her list on no other kind of column).
  await expect(page.locator('[data-note="modes"]')).toHaveText("A line that is already here is left as it is. Changing what is already here by a list is the CRM admin’s to do.");
  await expect(page.locator('[data-note="companies"]')).toHaveText("A company is already here when its customer number is the same. A line with no customer number is brought in as a new company, so leave out the ones you already have.");
  await expect(wizard(page).getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  // Two tables to bring a list into, Companies first.
  const target = wizard(page).getByTestId("import-target");
  expect(await target.locator("option").allTextContents()).toEqual(["Companies", "Contacts"]);

  await wizard(page).getByRole("textbox").fill(LIST);
  await wizard(page).getByTestId("import-paste-use").click();
  // The pasted headings find their columns, and lines are matched on the customer number.
  await expect.poll(() => wizard(page).locator('[data-part="mapping-row"] [data-part="mapping-target"]').evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value))).toEqual(["name", "sector", "town", "customer_no"]);
  await expect(wizard(page).getByTestId("import-match-on")).toHaveValue("customer_no");
  // One thing may be done with a line already here, so she is not asked.
  await expect(wizard(page).getByTestId("import-when-here")).toHaveCount(0);
  await wizard(page).getByTestId("wizard-validate").click();
  await expect(wizard(page).getByTestId("validation-summary")).toHaveText("3 new lines will be brought in.");
  expect(await statuses(page)).toEqual(["new", "new", "new"]);
  // Looking wrote nothing.
  expect(await brought(context.request, data)).toEqual([]);
  await picture(page, "1-dana-paste-looked-at");
  await wizard(page).getByTestId("wizard-run").click();
  await expect(wizard(page).getByTestId("import-review")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".crm-toast")).toHaveText("Brought in 3, updated 0, left 0 as they were.");
  expect((await brought(context.request, data)).map((company) => [company.name, company.sector, company.town])).toEqual([
    ["P07 List Halden Foods", "Food", "Ripon"],
    ["P07 List Kestrel Print", "Printing", "York"],
    ["P07 List Verity Insurance", "Insurance", "Durham"],
  ]);
  await picture(page, "2-dana-paste-done");
  // "Close" goes to Companies, and they are in the list.
  await wizard(page).getByTestId("wizard-close").click();
  await expect(page).toHaveURL(/\/companies$/);
  for (const name of ["P07 List Halden Foods", "P07 List Kestrel Print", "P07 List Verity Insurance"]) await expect(page.locator(".crm-acc-card-name", { hasText: name })).toHaveCount(1);

  // The same list again: every line is already here, and nothing is brought in.
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Paste a list" }).click();
  await wizard(page).getByRole("textbox").fill(LIST);
  await wizard(page).getByTestId("import-paste-use").click();
  await wizard(page).getByTestId("wizard-validate").click();
  await expect(wizard(page).getByTestId("import-nothing")).toHaveText("Nothing here would be brought in.");
  expect(await statuses(page)).toEqual(["here", "here", "here"]);
  await expect(wizard(page).getByTestId("wizard-run")).toBeDisabled();
  expect(await brought(context.request, data)).toHaveLength(3);
  expect(problems).toEqual([]);
});

test("the CRM admin has it under Settings and may also update; contacts are matched on nothing unless she says so", async ({ as }) => {
  const page = await (await as("tessa")).newPage();
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Paste a list" }).click();
  await expect(page.locator('[data-note="modes"]')).toHaveText("A line that is already here is left as it is, unless you choose to update it.");
  await expect(wizard(page).getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await wizard(page).getByRole("textbox").fill(LIST);
  await wizard(page).getByTestId("import-paste-use").click();
  // She is asked, and "leave it" is what is chosen to begin with.
  await expect(wizard(page).getByTestId("import-when-here")).toHaveValue("skip");
  await wizard(page).getByTestId("wizard-validate").click();
  // Dana brought these three in: for the admin they are already here too.
  await expect(wizard(page).getByTestId("import-nothing")).toHaveText("Nothing here would be brought in.");

  // Contacts: the columns a line may bring, and nothing matched to begin with.
  await page.reload();
  await expect(wizard(page).getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await wizard(page).getByTestId("import-target").selectOption({ label: "Contacts" });
  await wizard(page).getByRole("textbox").fill("Company\tName\tJob\n1\tP07 Nobody Yet\tBuyer");
  await wizard(page).getByTestId("import-paste-use").click();
  await expect(wizard(page).getByTestId("import-match-on")).toHaveValue("");
  expect(await wizard(page).locator('[data-part="mapping-row"] [data-part="mapping-target"]').first().locator("option").allTextContents()).toEqual(expect.arrayContaining(["Company (its number)", "Name", "Job title", "Email", "Phone", "May be emailed (yes or no)"]));
  await picture(page, "3-tessa-paste-contacts");
});

/**
 * Plan 68 R5: the CRM admin brings past deals in, in a wizard of their own. A won deal with its closed date comes in with
 * that day; one without is named, in the reader's words, and not brought in. R8: the page says who ticked "may be
 * emailed" is never a list's to say. The deals it makes are called "P68 Past …" and taken away at the end.
 */
test("the CRM admin brings past deals in: one without its closed date is named and not brought in", async ({ as, data }) => {
  const context = await as("tessa");
  const admin = context.request;
  await removeDeals(admin, data, "P68 Past");
  try {
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}paste-a-list`);
    await expect(page.locator('[data-note="stamps"]')).toHaveText("Who ticked “may be emailed”, and when, are kept by the CRM itself: a list that carries either is refused. A blank “may be emailed” is no for a new contact, and leaves a saved contact’s answer as it is.");
    const deals = page.locator('[data-section="deals"]');
    await expect(deals.getByRole("heading", { level: 2 })).toHaveText("Past deals");
    await expect(deals.locator('[data-note="closed"]')).toHaveText("A won or lost deal needs its closed date. A line without one is named and not brought in: no deal is dated by the day it was brought in.");
    const [stage] = await rows<{ id: number; label: string }>(admin, data, "stages", undefined, "&order=position");
    const [company] = await rows<{ id: number }>(admin, data, "companies", undefined, "&order=id");
    // The numbers a line names are listed on the page.
    await expect(deals.locator('[data-legend="stages"] li').first()).toContainText(stage!.label);
    const kit = deals.locator('[data-kit-part="import"]');
    await expect(kit.getByRole("group", { name: "Past deals" })).toBeVisible({ timeout: 30_000 });
    const list = [
      "Name\tCompany (its number)\tStage (its number)\tState (open, won or lost)\tClosed (a date)",
      `P68 Past mill roof\t${String(company!.id)}\t${String(stage!.id)}\twon\t2025-05-01T12:00:00Z`,
      `P68 Past no date\t${String(company!.id)}\t${String(stage!.id)}\twon\t`,
    ].join("\n");
    await kit.getByRole("textbox").fill(list);
    await kit.getByTestId("import-paste-use").click();
    // Every line is given its owner (the CRM admin herself, unless she picks another) before the columns are matched.
    await expect.poll(() => kit.locator('[data-part="mapping-row"] [data-part="mapping-target"]').evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value))).toEqual(["owner_id", "name", "company_id", "stage_id", "state", "closed_at"]);
    await kit.getByTestId("wizard-validate").click();
    const lines = kit.locator('[data-testid="import-preview"] [data-line]');
    await expect(lines).toHaveCount(2);
    expect(await lines.evaluateAll((all) => all.map((line) => line.getAttribute("data-status")))).toEqual(["new", "refused"]);
    await expect(lines.nth(1)).toContainText("Needs a closed date: a won or lost deal comes in with the day it closed.");
    await expect(lines.nth(1)).not.toContainText("closed_at");
    await picture(page, "6-tessa-paste-past-deals");
    await kit.getByTestId("wizard-run").click();
    await expect(kit.getByTestId("import-review")).toBeVisible({ timeout: 30_000 });
    const made = await rows<{ name: string; state: string; closed_on: string | null; owner_id: string }>(admin, data, "deals", { column: "name", op: "like", value: "P68 Past %" });
    expect(made.map((deal) => [deal.name, deal.state, String(deal.closed_on).slice(0, 10), deal.owner_id])).toEqual([["P68 Past mill roof", "won", "2025-05-01", stand().people["tessa"]!.id]]);
    expect(problems).toEqual([]);
  } finally {
    await removeDeals(admin, data, "P68 Past");
  }
});

test("past deals are the CRM admin's alone: a rep's page has no such wizard, and the server refuses her the import", async ({ as }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}paste-a-list`);
  await expect(wizard(page).getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-section="deals"]')).toHaveCount(0);
  expect(await direct(context.request, "deals")).toBe("403 TABLE_FORBIDDEN import");
});

test("below the admin a contact is matched on its name or on nothing, never on an e-mail", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  await page.goto(`${STAFF}paste-a-list`);
  await expect(wizard(page).getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-note="modes"]')).toContainText("is left as it is. Changing what is already here by a list is the CRM admin’s to do.");
  // A file never says a person was offered a way to say no: what it brings in never counts as an existing customer.
  await expect(page.locator('[data-note="opt-out"]')).toHaveText("Rows brought in from a file carry no “offered a way to say no” mark, so they never count as existing customers.");
  await wizard(page).getByTestId("import-target").selectOption({ label: "Contacts" });
  await wizard(page).getByRole("textbox").fill("Company\tName\tEmail\n1\tP07 Nobody Yet\tnobody@example.test");
  await wizard(page).getByTestId("import-paste-use").click();
  const match = wizard(page).getByTestId("import-match-on");
  await expect(match).toHaveValue("");
  expect(await match.locator("option").allTextContents()).toEqual(["Nothing: every line is new", "Name"]);
  await expect(wizard(page).getByTestId("import-when-here")).toHaveCount(0);
});

test("nobody else brings a list in: the server refuses the marketer, Read-only and the account manager, and their page says so", async ({ as, data }) => {
  for (const person of ["lena", "grace", "hugo"]) {
    const context = await as(person);
    // Asked directly: no right to import either table, whatever the page shows.
    expect(await direct(context.request, "companies"), person).toBe("403 TABLE_FORBIDDEN import");
    expect(await direct(context.request, "contacts"), person).toBe("403 TABLE_FORBIDDEN import");
    const page = await context.newPage();
    await page.goto(`${STAFF}paste-a-list`);
    await expect(page.getByRole("heading", { level: 1 }), person).toHaveText("This page is not part of your role");
    await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Paste a list" }), person).toHaveCount(0);
    await page.close();
  }
  // And the three are the three Dana brought in, no more.
  expect(await brought(await (await as("tessa")).request, data)).toHaveLength(3);
  // A rep, the manager and the admin are let in by the same call.
  expect(await direct((await as("sam")).request, "companies")).toBe("made");
});

test("Paste a list at 390 wide in the dark, and in Arabic right to left", async ({ as }) => {
  const narrow = await (await as("ivy", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await narrow.goto(`${STAFF}paste-a-list`);
  await expect(wizard(narrow).getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await wizard(narrow).getByRole("textbox").fill(LIST);
  await wizard(narrow).getByTestId("import-paste-use").click();
  await expect(wizard(narrow).getByTestId("wizard-validate")).toBeVisible();
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "4-ivy-paste-390-dark");

  const context = await as("priya");
  await inArabic(context.request, async () => {
    const page = await context.newPage();
    await page.goto(`${STAFF}paste-a-list`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("لصق قائمة");
    expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
    await expect(wizard(page).getByRole("group", { name: "لصق قائمة" })).toBeVisible({ timeout: 30_000 });
    expect(await wizard(page).getByTestId("import-target").locator("option").allTextContents()).toEqual(["الشركات", "جهات الاتصال"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await picture(page, "5-priya-paste-arabic");
  });
});
