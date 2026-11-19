/**
 * A company's details: its number in the register, its phone and a few words
 * about what it does, on the company sheet (under the website) and on the
 * company's page (under its name). The sample's Kestrel Yard Architects, one
 * of the practices Lead finder found, holds all three; a rep changes one and
 * only that one is sent, and a company she adds keeps the three as the server
 * holds them. What a spec makes is called "P11 …" and taken away at the end.
 */
import { authOf, expect, stand, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch, type Data } from "./helpers.ts";

const KESTREL = "Kestrel Yard Architects";
const ABOUT = "A small practice drawing homes and workshops.";

test.afterAll(async ({ browser }) => {
  const state = stand();
  const context = await browser.newContext({ baseURL: state.url, storageState: await authOf(browser, "tessa") });
  const data: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;
  const headers = await csrf(context.request);
  for (const company of await rows<{ id: number }>(context.request, data, "companies", { column: "name", op: "like", value: "P11 %" })) expect((await context.request.delete(data("companies", `/${String(company.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  // Kestrel's few words as the sample wrote them, whatever a failed run left.
  const [kestrel] = await rows<{ id: number; about: string | null }>(context.request, data, "companies", { column: "name", op: "eq", value: KESTREL });
  if (kestrel !== undefined && kestrel.about !== ABOUT) expect((await context.request.patch(data("companies", `/${String(kestrel.id)}`), { data: { values: { about: ABOUT } }, headers })).status()).toBeLessThan(300);
  await context.close();
});

test("a company's page shows its number, phone and website under its name, and what it does", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  const [kestrel] = await rows<{ id: number }>(context.request, data, "companies", { column: "name", op: "eq", value: KESTREL });
  await page.goto(`${STAFF}companies/${String(kestrel!.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(KESTREL);
  const reach = page.locator(".crm-acc-hero-reach");
  await expect(reach.locator("dt")).toHaveText(["Company number", "Phone", "Website"]);
  await expect(reach.locator("dd")).toHaveText(["98000412", "0113 496 0412", "https://kestrelyard.example"]);
  await expect(page.locator(".crm-acc-hero-about")).toHaveText(`About: ${ABOUT}`);
  // A company with none of the three shows neither line.
  const [nordwind] = await rows<{ id: number }>(context.request, data, "companies", { column: "name", op: "eq", value: "Nordwind Logistics" });
  await page.goto(`${STAFF}companies/${String(nordwind!.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nordwind Logistics");
  await expect(page.locator(".crm-acc-hero-reach")).toHaveCount(0);
  await expect(page.locator(".crm-acc-hero-about")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the company sheet asks for the three under the website; a change sends only what changed", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  const [kestrel] = await rows<{ id: number }>(context.request, data, "companies", { column: "name", op: "eq", value: KESTREL });
  await page.goto(`${STAFF}companies/${String(kestrel!.id)}`);
  // Nobody's yet: a rep may change it.
  await page.getByRole("button", { name: "Edit company" }).click();
  const sheet = page.getByRole("dialog", { name: KESTREL });
  const labels = await sheet.locator(".crm-acc-rec-field .crm-label").allTextContents();
  expect(labels.slice(labels.indexOf("Website"))).toEqual(["Website", "Phone", "Company number", "About"]);
  await expect(sheet.getByLabel("Company number")).toHaveValue("98000412");
  await expect(sheet.getByLabel("Phone")).toHaveValue("0113 496 0412");
  await expect(sheet.getByLabel("About")).toHaveValue(ABOUT);
  await expect(sheet.getByLabel("About")).toHaveAttribute("maxlength", "1000");
  await expect(sheet.getByLabel("Company number")).toHaveAttribute("maxlength", "40");
  const patches: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") patches.push((request.postDataJSON() as { values: unknown }).values);
  });
  await sheet.getByLabel("About").fill("Homes, workshops and one school.");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".crm-toast")).toHaveText(`${KESTREL} saved.`);
  expect(patches).toEqual([{ about: "Homes, workshops and one school." }]);
  await expect(page.locator(".crm-acc-hero-about")).toHaveText("About: Homes, workshops and one school.");
  // Put back.
  await page.getByRole("button", { name: "Edit company" }).click();
  await page.getByRole("dialog", { name: KESTREL }).getByLabel("About").fill(ABOUT);
  await page.getByRole("dialog", { name: KESTREL }).getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".crm-acc-hero-about")).toHaveText(`About: ${ABOUT}`);

  // A new company with the three: the server holds them.
  await page.goto(`${STAFF}companies`);
  await page.getByRole("button", { name: "New company" }).click();
  const add = page.getByRole("dialog", { name: "New company" });
  await add.getByLabel("Company name").fill("P11 Wharf Lane Studio");
  await add.getByLabel("Phone").fill("0113 496 0777");
  await add.getByLabel("Company number").fill("98009999");
  await add.getByLabel("About").fill("Drawings for small shops.");
  await add.getByRole("button", { name: "Add company" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("P11 Wharf Lane Studio added.");
  const [made] = await rows<{ company_number: string | null; phone: string | null; about: string | null }>(context.request, data, "companies", { column: "name", op: "eq", value: "P11 Wharf Lane Studio" });
  expect(made).toMatchObject({ company_number: "98009999", phone: "0113 496 0777", about: "Drawings for small shops." });
  expect(problems).toEqual([]);
});
