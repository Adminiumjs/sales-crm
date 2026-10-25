/**
 * The console in another language and currency: the install's owner reads German (his own setting in Adminium) and the
 * connection keeps its books in euros. The Overview's "Reps" and "Sitting longest" headings are German, and the money a
 * person reads, the weighted value too, prints euros: Show data on "Pipeline by stage", and the column totals of the
 * console's Pipeline board. (`console-section.e2e.ts` proves English and pounds.)
 *
 * The ledger's figures (§2), written the German way. The language and the currency are put back, whatever happens.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf } from "./helpers.ts";

const card = (page: Page, key: string): Locator => page.locator(`[data-grid-item="${key}"]`);
const column = (page: Page, label: string): Locator => page.locator("[data-board-column]").filter({ has: page.getByText(label, { exact: true }) });

test("German and euros: the Overview's headings in German, and the weighted value in euros on Show data and on the board", async ({ as, stand }) => {
  const context = await as("owner");
  const owner = context.request;
  const headers = await csrf(owner);
  const prefs = ((await (await owner.get("/api/v1/me/prefs")).json()) as { data: { prefs: { locale: string | null } } }).data.prefs;
  const connection = (await (await owner.get(`/api/v1/connections/${stand.connectionId}`)).json()) as { data?: { currency?: string }; connection?: { currency?: string }; currency?: string };
  const currency = connection.data?.currency ?? connection.connection?.currency ?? connection.currency;
  expect(currency).toBe("GBP");
  expect((await owner.patch("/api/v1/me/prefs", { data: { locale: "de_DE" }, headers })).status()).toBe(200);
  try {
    expect((await owner.patch(`/api/v1/connections/${stand.connectionId}`, { data: { currency: "EUR" }, headers })).status()).toBe(200);
    const page = await context.newPage();
    await page.goto("/p/crm-overview");
    await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
    // A language changed elsewhere is drawn from the next load on.
    await page.reload();
    // The two headings, and the table's own column headings.
    await expect(card(page, "reps").getByText("Vertrieb", { exact: true })).toBeVisible();
    await expect(card(page, "reps").getByRole("columnheader").first()).toHaveText(/Vertriebsmitarbeiter/i);
    await expect(card(page, "reps").getByRole("columnheader").filter({ hasText: /Gewichtet/i })).toHaveCount(1);
    await expect(card(page, "sitting").getByText("Am längsten in einer Phase", { exact: true })).toBeVisible();
    await expect(card(page, "sitting")).toContainText("Offene Deals, Tage in ihrer Phase");
    // The cards' money is euros now.
    await expect(card(page, "reps")).toContainText("€");
    await expect(card(page, "reps")).not.toContainText("£");
    // Show data on Pipeline by stage: the value and the weighted value, in euros, written the German way.
    const byStage = card(page, "by-stage");
    await expect(byStage.getByText("Pipeline nach Phase", { exact: true })).toBeVisible();
    await byStage.getByRole("button", { name: "Daten anzeigen" }).click();
    for (const [stage, value, weighted] of [
      ["Discovery", "36.350 €", "3.635 €"],
      ["Negotiation", "105.400 €", "79.050 €"],
    ] as const) {
      const row = byStage.getByRole("row").filter({ hasText: stage });
      await expect(row).toContainText(value);
      await expect(row).toContainText(weighted);
    }
    await expect(byStage.getByRole("table")).not.toContainText("£");
    await picture(page, "zw-owner-overview-de-eur");

    // The console's Pipeline: each column's two totals, the weighted value in euros too.
    await page.goto("/p/crm-pipeline");
    const discovery = column(page, "Discovery");
    await expect(discovery.locator('[data-part="column-total"]')).toHaveText("Betrag 36.350 € · Gewichteter Wert 3.635 €");
    await expect(column(page, "Negotiation").locator('[data-part="column-total"]')).toHaveText("Betrag 105.400 € · Gewichteter Wert 79.050 €");
    await expect(page.getByTestId("board-total")).toContainText("286.300 €");
    await expect(page.locator("[data-board-column]").first()).not.toContainText("£");
    await picture(page, "zw-owner-pipeline-de-eur");
  } finally {
    // Put back for the specs that follow.
    expect((await owner.patch(`/api/v1/connections/${stand.connectionId}`, { data: { currency: "GBP" }, headers })).status()).toBe(200);
    expect((await owner.patch("/api/v1/me/prefs", { data: { locale: prefs.locale }, headers })).status()).toBe(200);
  }
});
