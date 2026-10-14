/**
 * P07, Paste a list (ledger §21): Adminium's own import, drawn on a screen of
 * the app. Its first real place.
 *
 * A rep and the sales manager have it under Accounts, the CRM admin under
 * Settings. Below the admin a line that is already here is left as it is and
 * the screen offers nothing else (the server would let a rep update; the
 * proof `crm-accounts` shows that it does, and the screen keeps it for the
 * admin). A company is "already here" when its name is the same.
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
import { csrf, inArabic, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

const LIST = ["Name\tSector\tTown", "P07 List Kestrel Print\tPrinting\tYork", "P07 List Verity Insurance\tInsurance\tDurham", "P07 List Halden Foods\tFood\tRipon"].join("\n");
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
  // What she is offered, said before she pastes: a line already here is left alone, and a company is matched on its name.
  await expect(page.locator('[data-note="modes"]')).toHaveText("A line that is already here is left as it is. Changing what is already here by a list is the CRM admin’s to do.");
  await expect(page.locator('[data-note="companies"]')).toHaveText("A company is already here when its name is the same, letter for letter.");
  await expect(wizard(page).getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  // Two tables to bring a list into, Companies first.
  const target = wizard(page).getByTestId("import-target");
  expect(await target.locator("option").allTextContents()).toEqual(["Companies", "Contacts"]);

  await wizard(page).getByRole("textbox").fill(LIST);
  await wizard(page).getByTestId("import-paste-use").click();
  // The pasted headings find their columns, and lines are matched on the name.
  await expect.poll(() => wizard(page).locator('[data-part="mapping-row"] [data-part="mapping-target"]').evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value))).toEqual(["name", "sector", "town"]);
  await expect(wizard(page).getByTestId("import-match-on")).toHaveValue("name");
  // One thing may be done with a line already here, so she is not asked.
  await expect(wizard(page).getByTestId("import-when-here")).toHaveCount(0);
  await wizard(page).getByTestId("wizard-validate").click();
  await expect(wizard(page).getByTestId("validation-summary")).toHaveText("3 new lines will be brought in.");
  expect(await lines(page)).toEqual(["new P07 List Kestrel Print", "new P07 List Verity Insurance", "new P07 List Halden Foods"]);
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
  expect(await lines(page)).toEqual(["here P07 List Kestrel Print", "here P07 List Verity Insurance", "here P07 List Halden Foods"]);
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

test("below the admin a contact is matched on its name or on nothing, never on an e-mail", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  await page.goto(`${STAFF}paste-a-list`);
  await expect(wizard(page).getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-note="modes"]')).toContainText("is left as it is. Changing what is already here by a list is the CRM admin’s to do.");
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
