/**
 * THE CRM INSTALLED FROM THE CONSOLE'S INSTALL WIZARD, on a stand of its own where the app and its two add-ons are
 * staged and nothing is installed (`CRM_STAND_INSTALL=0`). One install per stand run: the first test only looks at the
 * check step, the second installs (the file's order, one worker):
 *
 *  1. Plan 67 gate G2, "Parts at install and after", the install half: the check step shows a tick for each part that
 *     can be switched (Selling, Accounts and The team always on), Quotes and Supply under the add-on each is built on,
 *     Quotes greyed and waiting once Invoices is unticked (Supply, whose tables are the app's own, stays ticked under a
 *     group that says it waits for Inventory); the maps question; the sample offered.
 *  2. P18, "Install without Invoices & Receipts and Inventory from the install wizard": installed with both unticked
 *     (and the sample): no Quotes line or quote link anywhere, in the console or on the staff side; Supply's lines open
 *     the page that says it waits for Inventory; as the install's owner its link opens the app's page in Studio, whose
 *     Parts card says Quotes is not set up yet and Supply is off until Inventory is connected.
 *
 * Run it on a stand of its own, stage 3 (the released stage):
 *   CRM_STAND_INSTALL=0 CRM_STAND_STAGE=3 npx playwright test e2e/zw-install-wizard.e2e.ts
 * On any other stand every test here is skipped. The sample's people cannot sign in until the sample is in: the second
 * test makes them able to (`admitSamplePeople`, as the stand does on every other stand) once the wizard has added it.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { rows, STAFF, unfoldMenu, watch, type Data } from "./helpers.ts";
import { admitSamplePeople } from "./stand.mjs";
import { until, words } from "./zw-helpers.ts";

test.beforeEach(({ stand }) => {
  test.skip(stand.installed !== false, "needs a stand started with CRM_STAND_INSTALL=0 (the app staged, not installed)");
});

const say = words("en-US");
/** The parts an owner may tick at install (`default` is not "always"), as the released stage holds them. */
const SWITCHED = ["quotes", "inbox", "showroom", "jobs", "aftercare", "supply", "fleet"];
const ALWAYS = ["selling", "accounts", "team"];
const LABEL: Record<string, string> = { quotes: "Quotes", inbox: "Inbox", showroom: "Showroom and samples", jobs: "Jobs on site", aftercare: "After the job", supply: "Supply", fleet: "Vehicles and crew", selling: "Selling", accounts: "Accounts", team: "The team" };
const ON_AT_START = new Set(["quotes", "inbox", "supply"]);

/** Open the install wizard on the staged CRM, as the owner, and go to its check step on the stand's database. */
async function openCheckStep(wizard: Page): Promise<void> {
  await wizard.goto("/studio/apps");
  await expect(wizard.getByRole("heading", { name: "Hosted apps" })).toBeVisible();
  const card = wizard.getByRole("article").filter({ hasText: "Sales CRM" });
  await card.getByRole("button", { name: "Install", exact: true }).click();
  await expect(wizard.getByRole("heading", { name: "Install Sales CRM" })).toBeVisible();
  await wizard.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(wizard.getByText("Install into which database?")).toBeVisible();
  await wizard.getByRole("radio", { name: /Meridian/ }).click();
  await wizard.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(wizard.getByText("Check the tables")).toBeVisible({ timeout: 60_000 });
}

/** Untick an add-on on the check step, and wait for the install to be planned again without it. */
async function untick(wizard: Page, key: string): Promise<void> {
  const addOn = wizard.getByTestId("install-add-ons").locator(`li[data-add-on="${key}"]`).getByRole("checkbox");
  await addOn.click();
  await expect(addOn).not.toBeChecked();
}

const tick = (page: Page, part: string) => page.getByTestId("install-parts").locator(`li[data-part="${part}"]`).getByRole("checkbox");

test("the check step: a tick for each part, Quotes and Supply under their add-ons, Quotes left out without Invoices, the maps question", async ({ as, stand }) => {
  test.setTimeout(180_000);
  const wizard = await (await as("owner")).newPage();
  const problems = watch(wizard);
  await openCheckStep(wizard);
  await expect(wizard.locator('[data-part="check-hint"]')).toHaveText("Nothing changes until you press Install.");

  // The add-ons, both offered and ticked.
  const addOns = wizard.getByTestId("install-add-ons");
  for (const key of ["invoices", "inventory"]) await expect(addOns.locator(`li[data-add-on="${key}"]`).getByRole("checkbox")).toBeChecked();
  const names = Object.fromEntries(await Promise.all(["invoices", "inventory"].map(async (key) => [key, (await addOns.locator(`li[data-add-on="${key}"]`).getByRole("checkbox").getAttribute("aria-label"))!] as const)));

  // A tick for each part that can be switched, as the app starts them; the three always on.
  const parts = wizard.getByTestId("install-parts");
  for (const part of SWITCHED) {
    await expect(tick(wizard, part), part).toHaveAttribute("aria-label", say("studio:appParts.installTick", { part: LABEL[part]! }));
    await expect(tick(wizard, part), part).toHaveAttribute("aria-checked", ON_AT_START.has(part) ? "true" : "false");
    await expect(tick(wizard, part), part).toBeEnabled();
  }
  for (const part of ALWAYS) {
    await expect(tick(wizard, part), part).toHaveAttribute("aria-checked", "true");
    await expect(tick(wizard, part), part).toBeDisabled();
  }
  // Quotes and Supply sit under the add-on each is built on.
  await expect(parts.locator('[data-part-addon="invoices"] li[data-part="quotes"]')).toHaveCount(1);
  await expect(parts.locator('[data-part-addon="inventory"] li[data-part="supply"]')).toHaveCount(1);
  for (const key of ["invoices", "inventory"]) await expect(parts.locator(`[data-part-addon="${key}"] [data-part="addon-state"]`)).toHaveText(say("studio:appParts.groupTicked"));
  // The maps question, asked because nobody on this server has answered it yet; and the sample, offered.
  const maps = wizard.getByTestId("install-maps");
  await expect(maps.getByRole("checkbox", { name: /Show maps/ })).toBeChecked();
  await expect(wizard.getByTestId("install-sample-data").getByRole("checkbox", { name: /Add sample data/ })).not.toBeChecked();
  await picture(wizard, "zw-wizard-check-all");

  // Both add-ons unticked, one at a time (each untick plans the install again). Quotes, whose tables are built on Invoices',
  // is left out: greyed, and says what it waits for. Supply's tables are the app's own: it is still made, and its group says
  // it waits for Inventory (it stays off until Inventory is connected).
  for (const key of ["invoices", "inventory"]) await untick(wizard, key);
  await expect(parts.locator('[data-part-addon="invoices"] [data-part="addon-state"]')).toHaveText(say("studio:appParts.groupWaiting"));
  // Judged softly so that the rest is still judged: the group's line is worked out from its parts being left out, not from
  // the tick, so Inventory unticked still reads "Ticked under Add-ons" over Supply (an engine fault, see the report).
  await expect.soft(parts.locator('[data-part-addon="inventory"] [data-part="addon-state"]'), "Inventory's group says it is not ticked").toHaveText(say("studio:appParts.groupWaiting"));
  await expect(tick(wizard, "quotes")).toHaveAttribute("aria-checked", "false");
  await expect(tick(wizard, "quotes")).toBeDisabled();
  await expect(parts.locator('li[data-part="quotes"] [data-part="needs"]')).toHaveText(say("studio:appParts.installWaiting", { addOns: names["invoices"]! }));
  await expect(tick(wizard, "supply")).toHaveAttribute("aria-checked", "true");
  await expect(tick(wizard, "supply")).toBeEnabled();
  await expect(parts.locator('li[data-part="supply"] [data-part="needs"]')).toHaveCount(0);
  // The other parts are as they were.
  for (const part of SWITCHED.filter((one) => one !== "quotes")) await expect(tick(wizard, part)).toHaveAttribute("aria-checked", ON_AT_START.has(part) ? "true" : "false");
  await picture(wizard, "zw-wizard-check-no-add-ons");
  expect(stand.installed).toBe(false);
  expect(problems).toEqual([]);
});

test("installed without Invoices and Inventory: no quote anywhere; Supply waits for Inventory, and the owner is led to the app's page", async ({ as, api, stand }) => {
  test.setTimeout(420_000);
  // The same check step, both add-ons unticked; with the sample, so that the sample's people can look.
  const wizard = await (await as("owner")).newPage();
  await openCheckStep(wizard);
  for (const key of ["invoices", "inventory"]) await untick(wizard, key);
  await expect(tick(wizard, "quotes")).toBeDisabled();
  await wizard.getByTestId("install-sample-data").getByRole("checkbox", { name: /Add sample data/ }).click();
  await wizard.getByRole("button", { name: "Install", exact: true }).click();
  await expect(wizard.getByRole("heading", { name: "Sales CRM is installed" })).toBeVisible({ timeout: 180_000 });
  const owner: APIRequestContext = await api("owner");
  const sample = await until(async () => (await (await owner.get("/api/v1/apps/crm/sample-data")).json()) as { loaded?: boolean; total?: number }, (status) => status.loaded === true, 300_000, 2000);
  expect(sample.loaded, JSON.stringify(sample)).toBe(true);
  await picture(wizard, "zw-wizard-done");

  // What the wizard sent: no add-on, the two parts left out, maps answered.
  const installed = ((await (await owner.get("/api/v1/apps/crm/parts")).json()) as { parts: { id: string; on: boolean; leftOut: boolean; waiting: { key: string }[] }[] }).parts;
  expect(installed.find((one) => one.id === "quotes")).toMatchObject({ on: false, leftOut: true });
  expect(installed.find((one) => one.id === "supply")).toMatchObject({ on: false, leftOut: false, waiting: [expect.objectContaining({ key: "inventory" })] });
  const schema = (await (await owner.get(`/api/v1/connections/${stand.connectionId}/schema`)).json()) as { model?: { tables: { name: string; id: string }[] }; data?: { model: { tables: { name: string; id: string }[] } } };
  const tables = Object.fromEntries((schema.model ?? schema.data!.model).tables.map((table) => [table.name, table.id]));
  expect(Object.keys(tables)).not.toContain("crm_quotes");
  const state = await admitSamplePeople(tables);
  /** The address of a table's rows, now that the install has tables (the `data` fixture was made before it had). */
  const dataOf: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;

  // The console: no Quotes (nor Approvals, the quotes' answers) in the app's section.
  const consolePage = await (await as("owner")).newPage();
  await consolePage.goto("/");
  const section = consolePage.locator('[data-part="nav-app-section"]').filter({ hasText: "Sales CRM" });
  await expect(section.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
  const rail = (await section.locator("a").allInnerTexts()).map((text) => text.trim());
  expect(rail.filter((entry) => /quote|approval/i.test(entry)), rail.join(" · ")).toEqual([]);

  // The staff side, as a rep, the sales manager and the CRM admin: no Quotes line, no quote link on a deal.
  for (const person of ["dana", "ivy", "tessa"]) {
    const page = await (await as(person)).newPage();
    const problems = watch(page);
    await page.goto(STAFF);
    await unfoldMenu(page);
    const lines = (await page.getByRole("navigation", { name: "Menu" }).getByRole("link").allInnerTexts()).map((text) => text.trim());
    expect(lines.length, person).toBeGreaterThan(2);
    expect(lines.filter((line) => /quote|approval/i.test(line)), `${person}: ${lines.join(" · ")}`).toEqual([]);
    const [deal] = await rows<{ id: number }>(await api(person), dataOf, "deals");
    await page.goto(`${STAFF}deals/${String(deal!.id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /quote/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /quote/i })).toHaveCount(0);
    expect(problems, person).toEqual([]);
  }
  expect(Object.keys(state.people)).toContain("dana");

  // Supply's lines say what they wait for: the CRM admin is told whom to ask.
  const tessa = await (await as("tessa")).newPage();
  await tessa.goto(STAFF);
  await unfoldMenu(tessa);
  const menu = tessa.getByRole("navigation", { name: "Menu" });
  for (const line of ["Stock and lead times", "Supplier scorecard"]) {
    await menu.getByRole("link", { name: line, exact: true }).click();
    await expect(tessa.getByRole("heading", { level: 1 })).toHaveText("Supply is waiting for the Inventory add-on");
    await expect(tessa.locator(".crm-plain")).toContainText("If you need it, ask the person who runs this install to connect it.");
  }
  await picture(tessa, "zw-wizard-supply-waits-tessa");

  // The owner is told where, and the link opens the app's page in Studio: Quotes and Supply are not set up yet.
  const own = await (await as("owner")).newPage();
  await own.goto(`${STAFF}stock`);
  await expect(own.getByRole("heading", { level: 1 })).toHaveText("Supply is waiting for the Inventory add-on");
  await own.getByTestId("waits-open").click();
  await expect(own).toHaveURL(/\/studio\/apps\/crm$/);
  await expect(own.getByRole("heading", { name: "Sales CRM", level: 2 })).toBeVisible();
  const partsCard = own.getByTestId("app-parts");
  for (const part of ["quotes", "supply"]) {
    await expect(partsCard.locator(`li[data-part="${part}"]`)).toContainText(say("studio:appParts.needs"));
    if (part === "quotes") await expect(partsCard.locator(`li[data-part="${part}"] [data-part="waiting"]`)).toContainText("Not set up yet.");
    else {
      await expect(partsCard.locator(`li[data-part="${part}"] [data-part="waiting"]`)).toContainText(/Off until inventory is connected, under Add-ons\./i);
      // The add-on by its name, as the add-ons card names it (judged softly: the server gives its key when it is not attached).
      await expect.soft(partsCard.locator(`li[data-part="${part}"] [data-part="waiting"]`), "the add-on is named, not keyed").toContainText("Off until Inventory is connected");
    }
  }
  await picture(own, "zw-wizard-app-page");
});
