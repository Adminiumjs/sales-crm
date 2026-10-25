/**
 * A PASTE, the walk's way: rows copied from a spreadsheet (tabs between the
 * cells), with a header row and without one, "Match on" chosen, the three
 * counts and the lines marked "already here" and "refused", "Show more", the
 * run; and a person held to their own rows refused a line that matches a
 * colleague's row. On the CRM's Paste a list (Adminium's import, drawn on the
 * staff side) and on the console's own Import data, which is the same wizard.
 *
 * `paste-list.e2e.ts` already proves the screen's place in each role's menu,
 * a header row's columns found, the match on the customer number chosen for
 * a rep, a list looked at and run, the same list again all "already here",
 * the CRM admin's update, past deals, who is refused, and the page at 390
 * and in Arabic. This file proves the rest of the walk.
 *
 * The companies it makes are all called "ZW Paste …" or "ZW Import …" and are
 * taken away by the CRM admin before and after.
 */
import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";

import { authOf, expect, picture, stand, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch, type Data } from "./helpers.ts";

const wizard = (page: Page): Locator => page.locator('[data-kit-part="import"]').first();
const statuses = (scope: Locator): Promise<string[]> => scope.locator('[data-testid="import-preview"] [data-line]').evaluateAll((all) => all.map((line) => line.getAttribute("data-status") ?? ""));
const countOf = (scope: Locator, kind: "new" | "here" | "refused"): Locator => scope.locator(`[data-testid="import-preview"] [data-count="${kind}"] .font-mono`);
const made = (person: APIRequestContext, data: Data, prefix: string) => rows<{ id: number; name: string; sector: string | null; town: string | null; customer_no: string | null; account_owner_id: string | null }>(person, data, "companies", { column: "name", op: "like", value: `${prefix}%` }, "&order=name");

async function removeMade(browser: Browser): Promise<void> {
  const state = stand();
  const context = await browser.newContext({ baseURL: state.url, storageState: await authOf(browser, "tessa") });
  const data: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;
  const headers = await csrf(context.request);
  for (const prefix of ["ZW Paste ", "ZW Import "]) {
    for (const company of await made(context.request, data, prefix)) {
      const gone = await context.request.delete(data("companies", `/${String(company.id)}?confirm=true`), { headers });
      expect(gone.status(), `${company.name} is taken away: ${await gone.text()}`).toBeLessThan(300);
    }
  }
  await context.close();
}
test.beforeAll(async ({ browser }) => removeMade(browser));
test.afterAll(async ({ browser }) => removeMade(browser));

const HEADER = "Name\tSector\tTown\tCustomer number\tHeadcount";
// A customer number is kept as a code (`normalize: code`): written here as it is stored, with no separators.
const NEW_LINE = "ZW Paste Kestrel Print\tPrinting\tYork\tZWPNEW\t12";

test("Dana pastes tab-separated rows with a header: Match on, the three counts, the lines already here and refused, Show more, run", async ({ as, api, data, stand: state }) => {
  test.setTimeout(240_000);
  // Two companies with a customer number: one is Dana's, one is Sam's (plan 68 X3 holds a rep to her own for changes).
  const tessa = await api("tessa");
  const headers = await csrf(tessa);
  for (const [name, number, owner] of [["ZW Paste Dana Own", "ZWPDANA", "dana"], ["ZW Paste Sam Own", "ZWPSAM", "sam"]] as const) {
    const res = await tessa.post(data("companies"), { data: { values: { name, customer_no: number, sector: "Retail", town: "Leeds", account_owner_id: state.people[owner]!.id } }, headers });
    expect(res.status(), await res.text()).toBe(201);
  }
  // The list: a new company, Dana's own and Sam's (both already here), one whose headcount is no number (refused),
  // then the new one a hundred times more.
  const list = [HEADER, NEW_LINE, "ZW Paste Dana Own\tRetail\tLeeds\tZWPDANA\t", "ZW Paste Sam Own\tWholesale\tHull\tZWPSAM\t40", "ZW Paste Many Staff\tRetail\tLeeds\tZWPMANY\tlots", ...Array.from({ length: 100 }, () => NEW_LINE)].join("\n");

  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}paste-a-list`);
  const kit = wizard(page);
  await expect(kit.getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await kit.getByRole("textbox").fill(list);
  // A header row is what the wizard takes to begin with.
  await expect(kit.getByRole("checkbox", { name: "The first row holds the column names" })).toBeChecked();
  await kit.getByTestId("import-paste-use").click();
  await expect(kit.getByText("104 data rows in pasted.csv", { exact: false })).toBeVisible();
  await expect.poll(() => kit.locator('[data-part="mapping-row"] [data-part="mapping-target"]').evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value))).toEqual(["name", "sector", "town", "customer_no", "headcount"]);

  // "Match on": nothing first (every line would be new), then the customer number, chosen by hand.
  const match = kit.getByTestId("import-match-on");
  expect(await match.locator("option").allTextContents()).toEqual(["Nothing: every line is new", "Customer number"]);
  await match.selectOption("");
  await expect(match).toHaveValue("");
  await match.selectOption({ label: "Customer number" });
  await expect(match).toHaveValue("customer_no");
  await expect(kit.getByText("A line whose value in this column is already in the table is not added a second time.")).toBeVisible();

  await kit.getByTestId("wizard-validate").click();
  // The three counts: one new; Dana's own, Sam's and the hundred repeats already here; the headcount that is no number refused.
  await expect(countOf(kit, "new")).toHaveText("1", { timeout: 30_000 });
  await expect(countOf(kit, "here")).toHaveText("102");
  await expect(countOf(kit, "refused")).toHaveText("1");
  // A hundred lines are shown; the rest wait for "Show more".
  const shown = kit.locator('[data-testid="import-preview"] [data-line]');
  await expect(shown).toHaveCount(100);
  expect((await statuses(kit)).slice(0, 5)).toEqual(["new", "here", "here", "refused", "here"]);
  await expect(shown.nth(1)).toContainText("Already here");
  await expect(shown.nth(2)).toContainText("Already here");
  await expect(shown.nth(3)).toContainText("Refused");
  // Each line is named by the value it is matched on: the customer number.
  await expect(shown.nth(3)).toContainText("ZWPMANY");
  await expect(shown.nth(3)).toContainText("headcount");
  await expect(shown.nth(4)).toContainText(/Same as line \d+/);
  await picture(page, "zw-paste-1-dana-preview");
  await kit.getByTestId("import-preview-more").click();
  await expect(shown).toHaveCount(104);
  await expect(kit.getByTestId("import-preview-more")).toHaveCount(0);
  const all = await statuses(kit);
  expect([all.filter((one) => one === "new").length, all.filter((one) => one === "here").length, all.filter((one) => one === "refused").length]).toEqual([1, 102, 1]);
  // Looking wrote nothing.
  expect((await made(tessa, data, "ZW Paste Kestrel")).length).toBe(0);

  // Run: the one new company is brought in, once; Sam's row is left as it was (a rep's list never changes what is here).
  await kit.getByTestId("wizard-run").click();
  await expect(kit.getByTestId("import-review")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".crm-toast")).toContainText("Brought in 1");
  const kestrel = await made(tessa, data, "ZW Paste Kestrel");
  expect(kestrel.map((one) => [one.name, one.sector, one.town, one.customer_no])).toEqual([["ZW Paste Kestrel Print", "Printing", "York", "ZWPNEW"]]);
  const sam = (await made(tessa, data, "ZW Paste Sam Own"))[0]!;
  expect([sam.sector, sam.town, sam.account_owner_id]).toEqual(["Retail", "Leeds", state.people["sam"]!.id]);
  expect(await made(tessa, data, "ZW Paste Many Staff")).toEqual([]);

  // Matched on nothing, every line is new to the wizard; a line whose customer number is already a colleague's company's is
  // still never brought in as a second one: the run refuses it (the column is unique), and Sam's company is the only one.
  await page.goto(`${STAFF}paste-a-list`);
  await expect(kit.getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await kit.getByRole("textbox").fill([HEADER, "ZW Paste Sam Again\tRetail\tLeeds\tZWPSAM\t", "ZW Paste Fresh Start\tRetail\tLeeds\tZWPFRESH\t"].join("\n"));
  await kit.getByTestId("import-paste-use").click();
  await expect(kit.getByTestId("import-match-on")).toBeVisible({ timeout: 30_000 });
  await kit.getByTestId("import-match-on").selectOption("");
  await kit.getByTestId("wizard-validate").click();
  await expect(kit.locator('[data-testid="import-preview"] [data-line]')).toHaveCount(2, { timeout: 30_000 });
  // With nothing to match on, no line can be here already: two counts.
  await expect(kit.locator('[data-testid="import-preview"] [data-count="here"]')).toHaveCount(0);
  const looked = await kit.getByTestId("import-preview").innerText();
  console.info(`[zw-paste] matched on nothing, the look says: ${looked.replace(/\s+/g, " ")}`);
  await picture(page, "zw-paste-2-dana-match-nothing");
  await kit.getByTestId("wizard-run").click();
  const review = kit.getByTestId("import-review");
  await expect(review).toBeVisible({ timeout: 60_000 });
  console.info(`[zw-paste] matched on nothing, the run says: ${(await review.innerText()).replace(/\s+/g, " ")}`);
  const sams = await rows<{ name: string; customer_no: string }>(tessa, data, "companies", { column: "customer_no", op: "eq", value: "ZWPSAM" });
  expect(sams.map((one) => one.name)).toEqual(["ZW Paste Sam Own"]);
  expect(await made(tessa, data, "ZW Paste Sam Again")).toEqual([]);
  expect((await made(tessa, data, "ZW Paste Fresh Start")).map((one) => one.customer_no)).toEqual(["ZWPFRESH"]);
  expect(problems.filter((line) => !/409|422/.test(line))).toEqual([]);
});

test("a paste without a header row: the columns are matched by hand, then Match on, looked at and run", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  const page = await (await as("dana")).newPage();
  await page.goto(`${STAFF}paste-a-list`);
  const kit = wizard(page);
  await expect(kit.getByRole("group", { name: "Paste a list" })).toBeVisible({ timeout: 30_000 });
  await kit.getByRole("textbox").fill(["ZW Paste Halden Foods\tFood\tRipon\tZWPNOHEAD", "ZW Paste Verity Insurance\tInsurance\tDurham\tZWPNOHEAD2"].join("\n"));
  await kit.getByRole("checkbox", { name: "The first row holds the column names" }).uncheck();
  await kit.getByTestId("import-paste-use").click();
  // Both lines are rows: none was taken for the names.
  await expect(kit.getByText("2 data rows in pasted.csv", { exact: false })).toBeVisible();
  const targets = kit.locator('[data-part="mapping-row"] [data-part="mapping-target"]');
  await expect(targets).toHaveCount(4);
  for (const [at, column] of ["name", "sector", "town", "customer_no"].entries()) await targets.nth(at).selectOption(column);
  await kit.getByTestId("import-match-on").selectOption({ label: "Customer number" });
  await kit.getByTestId("wizard-validate").click();
  await expect(countOf(kit, "new")).toHaveText("2", { timeout: 30_000 });
  await expect(countOf(kit, "here")).toHaveText("0");
  await expect(countOf(kit, "refused")).toHaveText("0");
  expect(await statuses(kit)).toEqual(["new", "new"]);
  await kit.getByTestId("wizard-run").click();
  await expect(kit.getByTestId("import-review")).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await made(tessa, data, "ZW Paste ")).filter((one) => one.customer_no?.startsWith("ZWPNOHEAD")).map((one) => [one.name, one.sector, one.town, one.customer_no])).toEqual([
    ["ZW Paste Halden Foods", "Food", "Ripon", "ZWPNOHEAD"],
    ["ZW Paste Verity Insurance", "Insurance", "Durham", "ZWPNOHEAD2"],
  ]);
});

test("the console's Import data: the same paste into Companies, matched on the name, counted, run, and reviewed", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  const cobalt = async () => (await rows<Record<string, unknown>>(tessa, data, "companies", { column: "name", op: "eq", value: "Cobalt Legal" }))[0]!;
  const before = await cobalt();
  const page = await (await as("owner")).newPage();
  const problems = watch(page);
  await page.goto("/imports");
  await page.getByTestId("import-target").selectOption({ label: "Companies" });
  await page.getByTestId("import-paste").getByRole("textbox").fill(["Name\tSector", "Cobalt Legal\tCommercial law", "ZW Import Low Fell Joinery\tJoinery"].join("\n"));
  await page.getByTestId("import-paste-use").click();
  await expect(page.getByText("2 data rows in pasted.csv", { exact: false })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("import-match-on").selectOption({ label: "Name" });
  // The owner may update a line already here; leaving it is what is chosen to begin with.
  await expect(page.getByTestId("import-when-here")).toHaveValue("skip");
  await page.getByTestId("wizard-validate").click();
  const preview = page.getByTestId("import-preview");
  await expect(preview.locator('[data-count="new"] .font-mono')).toHaveText("1", { timeout: 30_000 });
  await expect(preview.locator('[data-count="here"] .font-mono')).toHaveText("1");
  await expect(preview.locator('[data-count="refused"] .font-mono')).toHaveText("0");
  expect(await preview.locator("[data-line]").evaluateAll((all) => all.map((line) => line.getAttribute("data-status")))).toEqual(["here", "new"]);
  await picture(page, "zw-paste-3-console-preview");
  await page.getByTestId("wizard-run").click();
  const review = page.getByTestId("import-review");
  await expect(review).toBeVisible({ timeout: 60_000 });
  await expect(review).toContainText("Created");
  expect((await made(tessa, data, "ZW Import ")).map((one) => [one.name, one.sector])).toEqual([["ZW Import Low Fell Joinery", "Joinery"]]);
  // Cobalt was left as it was.
  expect(await cobalt()).toEqual(before);
  expect(problems).toEqual([]);
});

test("the console's Import data at 390 wide: no step makes the page scroll sideways", async ({ as }) => {
  const page = await (await as("owner", { viewport: { width: 390, height: 844 } })).newPage();
  const sideways = (): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto("/imports");
  await page.getByTestId("import-target").selectOption({ label: "Companies" });
  expect(await sideways()).toBeLessThanOrEqual(0);
  await page.getByTestId("import-paste").getByRole("textbox").fill(["Name\tSector\tTown", "Cobalt Legal\tCommercial law\tLeeds", "ZW Import Narrow Screen Ltd\tJoinery\tGateshead"].join("\n"));
  await page.getByTestId("import-paste-use").click();
  await expect(page.getByTestId("import-match-on")).toBeVisible({ timeout: 30_000 });
  expect(await sideways(), "the map step").toBeLessThanOrEqual(0);
  await page.getByTestId("import-match-on").selectOption({ label: "Name" });
  await page.getByTestId("wizard-validate").click();
  await expect(page.getByTestId("import-preview").locator("[data-line]")).toHaveCount(2, { timeout: 30_000 });
  expect(await sideways(), "the preview").toBeLessThanOrEqual(0);
  await expect(page.getByTestId("wizard-run")).toBeVisible();
  await picture(page, "zw-paste-4-console-390");
});
