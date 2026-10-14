/**
 * P19: "Confirm it" and "They came in" on a booking's card, pressed as the
 * front desk. Stage 2's part: run with `CRM_STAND_STAGE=2`.
 *
 * NAMED TO RUN LAST of the showroom's specs, and why: a booking somebody came
 * in for is history, and the server refuses to remove it (the CRM admin and
 * the install's owner included). The booking this spec makes stays, and moves
 * "Been in" from 3 to 4 and "Everything" from 9 to 10, which
 * `showroom-screens` reads; no spec after this one reads either.
 */
import { expect, test } from "./fixtures.ts";
import { csrf, rows, STAFF } from "./helpers.ts";

test.skip(Number(process.env.CRM_STAND_STAGE ?? "1") < 2, "the showroom arrives with stage 2: run with CRM_STAND_STAGE=2");

test("the front desk confirms a booking of today and marks them come in: it moves to Been in, and nothing can remove it", async ({ as, api, data }) => {
  const corin = await api("corin");
  const headers = await csrf(corin);
  const space = (await rows<{ id: number }>(corin, data, "showroom_spaces", { column: "name", op: "eq", value: "Meeting room" }))[0]!.id;
  const made = await corin.post(data("showroom_bookings"), { data: { values: { space_id: space, visitor_name: "Walk-in at noon", party: 2, starts_at: "2026-07-28T11:00:00.000Z", minutes: 30, note: "Spec came in" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  const page = await (await as("corin")).newPage();
  await page.goto(`${STAFF}showroom`);
  const card = page.locator(`.crm-sh-card[data-booking="${String(id)}"]`);
  await expect(card.getByTestId("sh-state")).toHaveText("To confirm");
  await card.getByRole("button", { name: "Confirm it" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Walk-in at noon is confirmed for 12:00.");
  await expect(card.getByTestId("sh-state")).toHaveText("Confirmed");
  await expect(card.getByRole("button", { name: "Confirm it" })).toHaveCount(0);
  await card.getByRole("button", { name: "They came in" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Walk-in at noon marked as been in.");
  await page.locator('.crm-chip-btn[data-filter="done"]').click();
  await expect(page.locator(`.crm-sh-card[data-booking="${String(id)}"]`).getByTestId("sh-state")).toHaveText("Been in");
  await expect(page.locator('.crm-chip-btn[data-filter="done"] .crm-chip-count')).toHaveText("4");
  // Kept: the server refuses its removal, to the CRM admin too.
  const admin = await api("tessa");
  expect((await admin.delete(data("showroom_bookings", `/${String(id)}?confirm=true`), { headers: await csrf(admin) })).status()).toBe(409);
});
