/**
 * STAGE 2'S SETTINGS ON THE SETTINGS SCREEN (P24, B24): who makes the aftercare calls and how soon each thing of
 * After the job is due (a tab of its own), a sample's loan and a tired display piece (the showroom's card, Working
 * time), how long a snag has (the Crews tab), and the three parts on the Parts tab. The CRM admin writes them,
 * Read-only reads them and presses nothing, and the server holds every number between its bounds. Runs on a stand of
 * stage 2 (`CRM_STAND_STAGE=2`); on stage 1 there is nothing to show and the test is skipped. What it changes it puts
 * back.
 */
import { expect, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch } from "./helpers.ts";

test.beforeEach(({ stand }) => {
  test.skip(!stand.parts.includes("aftercare") || !stand.parts.includes("showroom") || !stand.parts.includes("jobs"), "Stage 2's parts: run with CRM_STAND_STAGE=2");
});

test("the CRM admin sets who makes the aftercare calls and how soon things are due; Read-only reads it all; the server keeps each number in its bounds", async ({ as, api, data, stand }) => {
  const tessa = await api("tessa");
  const headers = await csrf(tessa);
  const settings = (await rows<{ id: number; aftercare_owner_id: string | null; aftercare_days: number }>(tessa, data, "settings"))[0]!;
  const hugo = settings.aftercare_owner_id;
  expect(hugo).not.toBeNull();

  const page = await (await as("tessa")).newPage();
  const problems = watch(page);
  try {
    // After the job, a tab of its own: the sample names Hugo; nobody named gives the call to whoever sold the job.
    await page.goto(`${STAFF}settings/after-the-job`);
    const owner = page.getByTestId("ac-set-owner");
    await expect(owner).toHaveValue(hugo!);
    await expect(owner.locator("option:checked")).toHaveText("Hugo Brandt");
    await owner.selectOption("");
    await expect(page.locator(".crm-toast")).toHaveText("Aftercare calls: saved.");
    expect((await rows<{ aftercare_owner_id: string | null }>(tessa, data, "settings"))[0]!.aftercare_owner_id).toBeNull();

    // A number saves as the field is left; out of its bounds it is not sent, and the server refuses it anyway.
    const call = page.getByRole("spinbutton", { name: /An aftercare call is due after/ }).or(page.getByRole("textbox", { name: /An aftercare call is due after/ }));
    await call.fill("21");
    await call.press("Enter");
    await expect(page.locator(".crm-toast")).toHaveText("An aftercare call is due after: saved.");
    expect((await rows<{ aftercare_days: number }>(tessa, data, "settings"))[0]!.aftercare_days).toBe(21);
    for (const [column, bad] of [["aftercare_days", 0], ["loan_days", 91], ["snag_days", 0], ["display_tired_months", 61], ["complaint_answer_days", 31], ["claim_red_days", 181]] as const) {
      const refused = await tessa.patch(data("settings", `/${String(settings.id)}`), { data: { values: { [column]: bad } }, headers });
      expect(refused.status(), `${column} ${String(bad)}`).toBe(422);
    }

    // The showroom's card holds a sample's loan and a tired piece; the Crews tab, a snag's days; the Parts tab, nine parts (ten from stage 3).
    await page.goto(`${STAFF}settings/working-time`);
    const showroom = page.locator('[data-card="showroom-numbers"]');
    await expect(showroom).toContainText("A sample is out on loan for");
    await expect(showroom).toContainText("A display piece is tired after");
    await page.goto(`${STAFF}settings/crews`);
    await expect(page.locator('[data-card="snag-days"]')).toContainText("A snag is put right within");
    await page.goto(`${STAFF}settings/parts`);
    await expect(page.locator(".crm-ast-part")).toHaveCount(stand.parts.includes("fleet") ? 10 : 9);
    await expect(page.locator('[data-part="aftercare"]')).toContainText("Account manager");
    expect(problems).toEqual([]);
  } finally {
    const back = await tessa.patch(data("settings", `/${String(settings.id)}`), { data: { values: { aftercare_owner_id: hugo, aftercare_days: settings.aftercare_days } }, headers });
    expect(back.status(), await back.text()).toBe(200);
  }

  // Read-only reads the tab and presses nothing; the server refuses the write.
  const grace = await api("grace");
  const graces = await (await as("grace")).newPage();
  await graces.goto(`${STAFF}settings/after-the-job`);
  await expect(graces.getByTestId("ac-set-owner")).toBeDisabled();
  expect((await grace.patch(data("settings", `/${String(settings.id)}`), { data: { values: { aftercare_days: 30 } }, headers: await csrf(grace) })).status()).toBe(403);
});
