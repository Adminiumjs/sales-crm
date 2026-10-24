/**
 * Plan 68 S13, the office's Sign-off (stage 2): the signed copy's file row under "Who signed" (M2 note 1).
 *
 * The row is there only when the job is signed off AND Invoices & Receipts draws the copy: on a stand whose Invoices
 * does not draw the kind yet (1.0.13), the copy waits and the row is left out with no line in its place; on one that
 * draws it, the row names the file and its size as the server gives them, and its button downloads the PDF the
 * server serves. A reader the copy is not for gets none from the server. Light and dark, axe clean, and at 390 wide.
 */
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch, type Data } from "./helpers.ts";

test.skip(({ stand }) => !stand.parts.includes("jobs"), "Jobs on site is not in this stand's stage");

const render = async (person: APIRequestContext, id: number) => person.post("/api/v1/apps/crm/documents/render", { data: { kind: "signed-copy", ref: "sign_offs", pk: { id } }, headers: await csrf(person) });
const violations = async (page: Page): Promise<string[]> =>
  (await new AxeBuilder({ page }).include('[data-testid="jb-so-card"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map((one) => `${one.impact ?? "?"} ${one.id}: ${one.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
const signOffOf = async (person: APIRequestContext, data: Data, job: number): Promise<number> => (await rows<{ id: number }>(person, data, "sign_offs", { column: "job_id", op: "eq", value: job }))[0]!.id;

test("the signed copy's row: only when it is drawn, the server's file and size, a download of its PDF; none for a reader it is not for", async ({ as, data, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  // J-08 is signed off (Marta Kovac); J-07 is not.
  const id = await signOffOf(context.request, data, 8);
  const asked = await render(context.request, id);
  const drawn = asked.status() < 300;
  // Which case this stand is: its Invoices draws the copy, or the copy waits (1.0.13, or no Invoices).
  console.log(`[signed copy] ${drawn ? "drawn" : `waiting (${String(asked.status())})`}, add-ons ${JSON.stringify(stand.addOns)}`);
  await page.goto(`${STAFF}sign-off/8`);
  const card = page.getByTestId("jb-so-card");
  await expect(card).toHaveAttribute("data-signed", "1");
  await expect(card.getByTestId("jb-so-signed")).toContainText("Marta Kovac");
  const row = card.getByTestId("jb-so-copy");
  if (!drawn) {
    // The copy waits for Invoices' update (or there is no Invoices): the door says so, and the row is not there at all.
    expect([409, 404], await asked.text()).toContain(asked.status());
    await expect(card.getByTestId("jb-so-sealed")).toBeVisible();
    await expect(row).toHaveCount(0);
  } else {
    const reply = (await asked.json()) as { contentUrl: string; document: { format: string } };
    expect(reply.document.format).toBe("pdf");
    const head = await context.request.head(reply.contentUrl);
    expect(head.status()).toBe(200);
    const size = Number(head.headers()["content-length"]);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-format", "pdf");
    await expect(row.locator(".crm-sc-tag")).toHaveText("PDF");
    // Named after the work, never the job's code.
    await expect(row.getByTestId("jb-so-copy-name")).toHaveText(/^signed-copy-.*\.pdf$/i);
    await expect(row.getByTestId("jb-so-copy-name")).not.toContainText("J-08");
    await expect(row.getByTestId("jb-so-copy-size")).toHaveText(`${String(Math.max(1, Math.round(size / 1024)))} KB`);
    const link = row.getByTestId("jb-so-copy-download");
    await expect(link).toHaveAttribute("href", reply.contentUrl);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toMatch(/^signed-copy-.*\.pdf$/i);
    const bytes = await context.request.get(reply.contentUrl);
    expect([bytes.status(), bytes.headers()["content-type"]]).toEqual([200, "application/pdf"]);
    expect((await bytes.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await picture(page, "s13-1-ada-signed-copy");
    // Dark, and axe has nothing to say about the card.
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await violations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: "light" });
    expect(await violations(page)).toEqual([]);
    // At 390 wide the row wraps and the page does not scroll sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(row).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await picture(page, "s13-2-ada-signed-copy-390");
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  // A job not signed off: no row, no line in its place.
  await page.getByRole("group", { name: "Which job" }).locator('[data-job="7"]').click();
  await expect(card).toHaveAttribute("data-signed", "0");
  await expect(row).toHaveCount(0);
  // A reader the copy is not for (the marketer reads no sign-off): the server gives her none.
  const lena = await as("lena");
  expect((await render(lena.request, id)).status()).toBeGreaterThanOrEqual(403);
  expect(problems).toEqual([]);
});
