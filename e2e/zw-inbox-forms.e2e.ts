/**
 * An enquiry a website form made, in the Team inbox: its card says where it
 * came from by the form's own name ("Website form · Showroom form"), in
 * English and in Arabic, right to left at phone width, and the Settings tab
 * where the CRM admin gives the brochure's link.
 *
 * The enquiry is written as the forms door writes one (source "form", the
 * form's name in "From the form"), by the CRM admin through the server; the
 * door itself is proved in `proofs/crm-forms.test.ts`. Everything made here
 * is named "P71F …" and taken away again, whatever happens.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";

async function clear(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const row of await rows<{ id: number }>(admin, data, "enquiries", { column: "company_name", op: "like", value: "P71F %" })) {
    expect((await admin.delete(data("enquiries", `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
}

test("a website form's enquiry says which form it came from in the Team inbox, in English and in Arabic", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await clear(admin, data);
  try {
    const made = await admin.post(data("enquiries"), {
      data: { values: { source: "form", from_form: "Showroom form", company_name: "P71F Fenn Office", person: "Lou Fenn", wants: "P71F two booths", brochure: "yes" }, clientKey: "p71fformAAAAAAAAAAAAAAAAAAAAAAAA" },
      headers: await csrf(admin),
    });
    expect(made.status(), await made.text()).toBe(201);

    const context = await as("ivy");
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}inbox`);
    const card = page.locator(".crm-enq").filter({ hasText: "P71F two booths" });
    await expect(card.locator("[data-source-pill]")).toHaveText("Website form · Showroom form");
    // An enquiry typed in by phone keeps its plain source.
    await expect(page.locator(".crm-enq").filter({ hasNotText: "P71F" }).first().locator("[data-source-pill]")).not.toContainText("·");
    expect(problems).toEqual([]);

    const ivy = await api("ivy");
    await inArabic(ivy, async () => {
      const narrow = await (await as("ivy", { viewport: { width: 390, height: 844 } })).newPage();
      await narrow.goto(`${STAFF}inbox`);
      await expect(narrow.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(narrow.locator(".crm-enq").filter({ hasText: "P71F two booths" }).locator("[data-source-pill]")).toHaveText("نموذج الموقع · Showroom form");
      expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await picture(narrow, "p71f-inbox-form-ar-390");
    });
  } finally {
    await clear(admin, data);
  }
});

test("the CRM admin gives the brochure's link in Settings; a link that is not https is not saved", async ({ as, api, data }) => {
  const admin = await api("tessa");
  const [settings] = await rows<{ id: number; brochure_link: string | null }>(admin, data, "settings");
  const before = settings!.brochure_link;
  try {
    const page = await (await as("tessa")).newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}settings/inbox`);
    const link = page.getByTestId("inset-brochure-link");
    await expect(link).toHaveValue(before ?? "");
    await link.fill("http://meridian.example/brochure");
    await link.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Give a whole address that starts with https://");
    await link.fill("https://meridian.example/brochure-2026");
    await link.press("Enter");
    await expect.poll(async () => (await rows<{ brochure_link: string | null }>(admin, data, "settings"))[0]!.brochure_link).toBe("https://meridian.example/brochure-2026");
    // The person the sample names for brochure follow-ups: the sales manager.
    await expect(page.getByTestId("inset-brochure-owner").locator("option:checked")).toHaveText("Ivy Sandoval");
    await picture(page, "p71f-settings-brochure");
    expect(problems).toEqual([]);
    // Read-only reads the tab and changes nothing.
    const grace = await (await as("grace")).newPage();
    await grace.goto(`${STAFF}settings/inbox`);
    await expect(grace.getByTestId("inset-brochure-link")).toBeDisabled();
  } finally {
    const headers = await csrf(admin);
    expect((await admin.patch(data("settings", `/${String(settings!.id)}`), { data: { values: { brochure_link: before } }, headers })).status()).toBeLessThan(300);
  }
});
