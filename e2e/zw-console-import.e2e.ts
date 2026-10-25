/**
 * A pasted list as a rep, by the CONSOLE's door: Adminium's own Import data page (`/imports`), which the stand serves
 * beside the app. (The CRM's own "Paste a list" screen is `paste-list.e2e.ts`.)
 *
 * Dana pastes three companies into Companies: looked at first, brought in, and in the table. Bringing a list in was the
 * owner's alone when the walk was written; a rep holds the import right on companies now.
 *
 * The marketer brings enquiries in (her role may), but "Update them" is refused: a list that changes the rows it
 * matches is for somebody who may change them. The console says so before anything is run, and the server refuses the
 * same import asked directly.
 *
 * The three companies are called "W3 Console …" and taken away by the CRM admin before and after.
 */
import type { APIRequestContext, Browser } from "@playwright/test";

import { authOf, expect, picture, stand, test } from "./fixtures.ts";
import { csrf, rows, watch, type Data } from "./helpers.ts";
import { room } from "./p12-helpers.ts";

const LIST = ["Name\tSector\tCustomer number", "W3 Console Kestrel Print\tPrinting\tW3CK", "W3 Console Verity Insurance\tInsurance\tW3CV", "W3 Console Halden Foods\tFood\tW3CH"].join("\n");
const brought = (person: APIRequestContext, data: Data) => rows<{ id: number; name: string; sector: string; customer_no: string }>(person, data, "companies", { column: "name", op: "like", value: "W3 Console %" }, "&order=name");

async function removeMade(browser: Browser): Promise<void> {
  const state = stand();
  const context = await browser.newContext({ baseURL: state.url, storageState: await authOf(browser, "tessa") });
  const data: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;
  const headers = await csrf(context.request);
  for (const company of await brought(context.request, data)) expect((await context.request.delete(data("companies", `/${String(company.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  await context.close();
}
test.beforeAll(async ({ browser }) => removeMade(browser));
test.afterAll(async ({ browser }) => removeMade(browser));

test("Dana pastes three companies on the console's Import data page: looked at, brought in, in the table", async ({ as, data }) => {
  const context = await as("dana");
  await room(context.request, data, 80);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/");
  // The console's own menu leads there.
  await page.getByRole("link", { name: "Import data" }).first().click();
  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByRole("heading", { name: "Import data" })).toBeVisible();
  await expect(page.getByText("Drop a CSV file to import")).toBeVisible();
  await page.getByTestId("import-target").selectOption({ label: "Companies" });
  const box = page.getByTestId("import-paste").getByRole("textbox");
  await expect(box).toBeEnabled();
  await box.fill(LIST);
  await page.getByTestId("import-paste-use").click();
  // The pasted headings find their columns.
  await expect.poll(() => page.locator('[data-part="mapping-row"] [data-part="mapping-target"]').evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value))).toEqual(["name", "sector", "customer_no"]);
  await page.getByTestId("wizard-validate").click();
  // Looked at before anything is written.
  const preview = page.getByTestId("import-preview");
  await expect(preview.locator("[data-line]")).toHaveCount(3);
  expect(await preview.locator("[data-line]").evaluateAll((lines) => lines.map((line) => line.getAttribute("data-status")))).toEqual(["new", "new", "new"]);
  await expect(page.getByTestId("validation-summary")).toHaveText("3 new lines will be brought in.");
  expect(await brought(context.request, data)).toEqual([]);
  await expect(page.getByTestId("wizard-run")).toHaveText("Bring in 3 new lines");
  await picture(page, "zw-dana-console-import-looked-at");
  await page.getByTestId("wizard-run").click();
  const review = page.getByTestId("import-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  // Three lines, three made, none updated, none left.
  expect(await review.locator(".font-mono").allTextContents()).toEqual(["3", "3", "0", "0"]);
  expect((await brought(context.request, data)).map((company) => [company.name, company.sector, company.customer_no])).toEqual([
    ["W3 Console Halden Foods", "Food", "W3CH"],
    ["W3 Console Kestrel Print", "Printing", "W3CK"],
    ["W3 Console Verity Insurance", "Insurance", "W3CV"],
  ]);
  await picture(page, "zw-dana-console-import-done");
  expect(problems).toEqual([]);
});

test("the marketer may bring enquiries in, but \"Update them\" is refused: the console says so, and so does the server", async ({ as, data }) => {
  const state = stand();
  const context = await as("lena");
  const lena = context.request;
  await room(lena, data, 60);
  const [enquiry] = await rows<{ id: number; company_name: string }>(lena, data, "enquiries", undefined, "&order=id");
  const before = await rows<Record<string, unknown>>(lena, data, "enquiries", { column: "id", op: "eq", value: enquiry!.id });
  const page = await context.newPage();
  await page.goto("/imports");
  await expect(page.getByText("Drop a CSV file to import")).toBeVisible();
  await page.getByTestId("import-target").selectOption({ label: "Enquiries" });
  await page.getByTestId("import-paste").getByRole("textbox").fill(`company_name\n${enquiry!.company_name}`);
  await page.getByTestId("import-paste-use").click();
  await page.getByTestId("import-match-on").selectOption({ label: "Company name" });
  // Both are offered; she chooses to update the line already here.
  expect(await page.getByTestId("import-when-here").locator("option").allTextContents()).toEqual(["Leave them as they are", "Update them"]);
  await page.getByTestId("import-when-here").selectOption({ label: "Update them" });
  const [asked] = await Promise.all([page.waitForResponse((res) => /\/api\/v1\/imports$/.test(res.url()) && res.request().method() === "POST"), page.getByTestId("wizard-validate").click()]);
  expect(asked.status()).toBe(403);
  // Refused before anything runs, in words: she does not hold the right to change enquiries.
  await expect(page.getByText("You do not hold the right to change rows of Enquiries. Leave the lines already here as they are, or ask an administrator for it.")).toBeVisible();
  await expect(page.getByTestId("import-review")).toHaveCount(0);
  await picture(page, "zw-lena-console-update-refused");

  // The same import asked directly, as the console asks it: refused, naming the right it needs.
  const headers = await csrf(lena);
  const upload = await lena.post("/api/v1/imports/upload?filename=direct.csv", { headers: { ...headers, "content-type": "text/csv" }, data: `company_name\n${enquiry!.company_name}` });
  expect(upload.status()).toBe(201);
  const fileId = ((await upload.json()) as { data: { fileId: string } }).data.fileId;
  const made = await lena.post("/api/v1/imports", {
    headers,
    data: { fileId, connectionId: state.connectionId, table: state.tables["crm_enquiries"], mapping: { columns: [{ from: "company_name", to: "company_name" }] }, options: { mode: "upsert", matchColumn: "company_name", skipInvalid: true } },
  });
  expect(made.status()).toBe(403);
  const error = ((await made.json()) as { error: { code: string; details: { permission: string } } }).error;
  expect([error.code, error.details.permission.split(":").pop()]).toEqual(["TABLE_FORBIDDEN", "update"]);
  // Nothing changed.
  expect(await rows<Record<string, unknown>>(lena, data, "enquiries", { column: "id", op: "eq", value: enquiry!.id })).toEqual(before);
});
