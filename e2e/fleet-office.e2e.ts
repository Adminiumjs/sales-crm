/**
 * P25-A, Vehicles and crew at the office (stage 3): Vehicles (ledger §57),
 * Fuel (§65), Subcontractors (§68) with "Chase the certificate" (e-mail 11),
 * and Insurance claims (§67). Run on a stand of stage 3 (`CRM_STAND_STAGE=3`).
 *
 * Who: the operations manager (Ada) and the CRM admin (Tessa) read and write
 * them; Read-only (Grace) reads them and presses nothing; a rep (Dana) and
 * the sales manager (Ivy) are refused by the server. Every figure on a screen
 * is compared with the ledger AND with what the server answers that person,
 * asked directly; every "may not" is the server's refusal, asked directly as
 * that person. Everything a spec writes is put back, and the one message it
 * sets off taken away. The crew's phone is `fleet-phone.e2e.ts`; the server's
 * rules on three engines are `proofs/crm-fleet.test.ts`.
 */
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, unfoldMenu, watch, type Data } from "./helpers.ts";
import type { StandState } from "./stand.mjs";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const FLEET = ["vehicles", "vehicle_checks", "vehicle_faults", "fuel_fills", "subcontractors", "insurance_incidents"] as const;
const SCREENS = ["vehicles", "fuel", "subcontractors", "insurance-claims"] as const;

/** A single figure asked of the server as this person. */
async function figure(person: APIRequestContext, stand: StandState, table: string, aggregation: Record<string, unknown> = { fn: "count", alias: "n" }, filters: unknown[] = []): Promise<number> {
  const res = await person.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: `crm_${table}` }, shape: "single-metric", filters, aggregations: [aggregation] } }, headers: await csrf(person) });
  expect(res.status(), await res.text()).toBe(200);
  return Number(((await res.json()) as { result: { value?: number } }).result.value ?? 0);
}

const narrowEnough = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function axe(page: Page): Promise<string[]> {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((one) => one.effect?.getTiming().iterations !== Infinity).map((one) => one.finished.catch(() => undefined))), new Promise((done) => setTimeout(done, 3000))]));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((one) => `${one.impact ?? "?"} ${one.id}: ${one.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(" | ")}`);
}

async function removeAll(person: APIRequestContext, data: Data, ref: string, condition: unknown): Promise<void> {
  const headers = await csrf(person);
  for (const row of await rows<{ id: number }>(person, data, ref, condition)) expect((await person.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status(), `${ref} ${String(row.id)}`).toBeLessThan(300);
}

test.skip(({ stand }) => !stand.parts.includes("fleet"), "Vehicles and crew is not in this stand's stage");

test("Vehicles, as the operations manager: the ledger's figures, each the server's; walk-rounds and faults; a vehicle added, booked in, its fault fixed, and taken away", async ({ as, stand, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const ada = context.request;
  try {
    await page.goto(STAFF);
    await unfoldMenu(page);
    const menu = page.getByRole("navigation", { name: "Menu" });
    // The group in the design's order: the four here, and Time sheets and Training (hours-*.e2e.ts) between them.
    await expect(menu.locator("#crm-menu-fleet a")).toHaveText(["Vehicles", "Fuel", "Time sheets", "Training", "Subcontractors", "Insurance claims"]);
    await menu.getByRole("link", { name: "Vehicles", exact: true }).click();
    await expect(page).toHaveURL(/\/vehicles$/);

    // §57: 3 vans (2 ours, 1 hired); service overdue 1 (YK20 HTC, 8 days over); inspection within 30 days 1 (YK20 HTC in 11 days).
    const served = {
      all: await figure(ada, stand, "vehicles"),
      ours: await figure(ada, stand, "vehicles", undefined, [{ column: "hired", op: "eq", value: false }]),
      over: await figure(ada, stand, "vehicles", undefined, [{ column: "service_due", op: "lt", value: "2026-07-28" }]),
      soon: await figure(ada, stand, "vehicles", undefined, [{ column: "inspection_due", op: "gte", value: "2026-07-28" }, { column: "inspection_due", op: "lte", value: "2026-08-27" }]),
      faults: await figure(ada, stand, "vehicle_faults", undefined, [{ column: "fixed_on", op: "is_null" }]),
    };
    expect(served).toEqual({ all: 3, ours: 2, over: 1, soon: 1, faults: 3 });
    await expect(page.locator('[data-figure="service-over"] [data-value]')).toHaveText(String(served.over));
    await expect(page.locator('[data-figure="inspection-soon"]')).toContainText("Inspection due within 30 days");
    await expect(page.locator('[data-figure="inspection-soon"]')).toContainText("YK20 HTC in 11 days");
    await expect(page.locator('[data-figure="vehicles"]')).toContainText("2 ours, 1 hired");
    await expect(page.getByTestId("fl-vn-over")).toHaveText("YK20 HTC went past its service on Mon, Jul 20. Book it in.");
    const card = (name: string) => page.locator("[data-vehicle]").filter({ has: page.getByRole("heading", { name, exact: true }) });
    // Walk-rounds: Blue 5 of 5, Red 4 of 5 (lights), the hired van never; faults Blue 0, Red 2, Hired 1; odometers.
    await expect(card("Blue van").getByTestId("fl-vn-last")).toHaveText("Walked round Mon, Jul 27 · 5 of 5");
    await expect(card("Blue van").getByTestId("fl-vn-walk")).toHaveText("Everything checked");
    await expect(card("Red van").getByTestId("fl-vn-walk")).toHaveText("One thing left: Lights");
    await expect(card("Hired van").getByTestId("fl-vn-last")).toHaveText("Never checked");
    await expect(card("Blue van").getByTestId("fl-vn-faults")).toHaveCount(0);
    await expect(card("Red van").getByTestId("fl-vn-faults").locator("li")).toHaveCount(2);
    await expect(card("Hired van").getByTestId("fl-vn-faults").locator("li")).toHaveCount(1);
    await expect(card("Blue van").getByTestId("fl-vn-reading")).toHaveText("118,420 km");
    await expect(card("Red van").getByTestId("fl-vn-reading")).toHaveText("96,780 km");
    await expect(card("Hired van").getByTestId("fl-vn-reading")).toHaveText("8,310 km");
    await expect(card("Red van").getByTestId("fl-vn-service")).toHaveText("8 days over");
    await expect(card("Red van").getByTestId("fl-vn-inspection")).toHaveText("Aug 8, 2026 · in 11 days");
    await expect(card("Blue van").getByTestId("fl-vn-model")).toHaveText("Sprinter, long wheelbase · Blue crew");
    await expect(card("Hired van").getByTestId("fl-vn-model")).toHaveText("Hired in for August · no crew");
    await picture(page, "p25-1-ada-vehicles");

    // A vehicle added, with a lost reply on its way back: the same key answers the row the first one made.
    await page.getByTestId("fl-vn-add").click();
    const dialog = page.getByRole("dialog", { name: "Add a vehicle" });
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await dialog.getByLabel("Name").fill("Spec fleet van");
    await dialog.getByLabel("Number plate").fill("SP25 FLT");
    await dialog.getByLabel("Odometer (km)").fill("12,000");
    await dialog.getByLabel("Service due").fill("2026-07-10");
    let dropped = false;
    await page.route("**/api/v1/data/**", async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !/crm_vehicles$/.test(new URL(req.url()).pathname)) return route.fallback();
      const response = await route.fetch();
      if (!dropped) {
        dropped = true;
        return route.abort("connectionreset");
      }
      await route.fulfill({ response });
    });
    await dialog.getByRole("button", { name: "Add it" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Spec fleet van is on the list.");
    await page.unroute("**/api/v1/data/**");
    const made = await rows<{ id: number; odometer: number; reading: number }>(ada, data, "vehicles", { column: "name", op: "eq", value: "Spec fleet van" });
    expect(made.map((one) => [one.odometer, one.reading])).toEqual([[12000, 12000]]);
    // The server now counts two over; the screen with it.
    await expect(page.locator('[data-figure="service-over"] [data-value]')).toHaveText("2");
    expect(await figure(ada, stand, "vehicles", undefined, [{ column: "service_due", op: "lt", value: "2026-07-28" }])).toBe(2);
    await expect(page.getByTestId("fl-vn-over")).toHaveText("2 vehicles are past a service.");
    // Booked in: the service day moved to the day it goes in; it is no longer over.
    await card("Spec fleet van").getByTestId("fl-vn-book").click();
    const book = page.getByRole("dialog", { name: "Book Spec fleet van in for a service" });
    await expect(book.getByLabel("Service due")).toBeFocused();
    await book.getByLabel("Service due").fill("2026-08-03");
    await book.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Spec fleet van saved.");
    await expect(card("Spec fleet van").getByTestId("fl-vn-service")).toHaveText("due Aug 3, 2026");
    await expect(page.locator('[data-figure="service-over"] [data-value]')).toHaveText("1");
    // A fault on it, marked fixed today by the server's clock.
    const headers = await csrf(ada);
    expect((await ada.post(data("vehicle_faults"), { data: { values: { vehicle_id: made[0]!.id, text: "Spec fleet: wiper torn" } }, headers })).status()).toBe(201);
    await expect(card("Spec fleet van").getByTestId("fl-vn-faults")).toContainText("Spec fleet: wiper torn");
    await card("Spec fleet van").getByRole("button", { name: "Fixed" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("A fault on Spec fleet van is marked fixed today.");
    await expect(card("Spec fleet van").getByTestId("fl-vn-faults")).toHaveCount(0);
    expect((await rows<{ fixed_on: string }>(ada, data, "vehicle_faults", { column: "text", op: "eq", value: "Spec fleet: wiper torn" }))[0]!.fixed_on.slice(0, 10)).toBe("2026-07-28");
    expect(problems.filter((line) => !/ERR_CONNECTION_RESET|Failed to load resource/.test(line))).toEqual([]);
  } finally {
    const vans = await rows<{ id: number }>(ada, data, "vehicles", { column: "name", op: "eq", value: "Spec fleet van" });
    for (const van of vans) await removeAll(ada, data, "vehicle_faults", { column: "vehicle_id", op: "eq", value: van.id });
    await removeAll(ada, data, "vehicles", { column: "name", op: "eq", value: "Spec fleet van" });
  }
});

test("Fuel, as the operations manager: the ledger's distance, litres and money from the server; per van, per fill and by month", async ({ as, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const ada = context.request;
  await page.goto(`${STAFF}fuel`);
  // §65: 7 fills, 279.3 litres, 407.77; 1,430 measured over the 6 fills with a distance, 343.53 of fuel: 0.240 a km.
  const measured = [{ column: "distance", op: "gt", value: 0 }];
  const served = {
    fills: await figure(ada, stand, "fuel_fills"),
    litres: await figure(ada, stand, "fuel_fills", { fn: "sum", column: "litres", alias: "l" }),
    cost: await figure(ada, stand, "fuel_fills", { fn: "sum", column: "cost", alias: "c" }),
    distance: await figure(ada, stand, "fuel_fills", { fn: "sum", column: "distance", alias: "d" }, measured),
    measuredCost: await figure(ada, stand, "fuel_fills", { fn: "sum", column: "cost", alias: "c" }, measured),
    measuredFills: await figure(ada, stand, "fuel_fills", undefined, measured),
  };
  expect(served).toEqual({ fills: 7, litres: 279.3, cost: 407.77, distance: 1430, measuredCost: 343.53, measuredFills: 6 });
  await expect(page.locator('[data-figure="distance"] [data-value]')).toHaveText("1,430 km");
  await expect(page.locator('[data-figure="distance"]')).toContainText("3 vehicles, 7 fills");
  await expect(page.locator('[data-figure="fuel"] [data-value]')).toHaveText("£407.77");
  await expect(page.locator('[data-figure="fuel"]')).toContainText("279.3 litres");
  await expect(page.locator('[data-figure="rate"] [data-value]')).toHaveText("£0.240");
  await expect(page.locator('[data-figure="rate"]')).toContainText("over the 6 fills with a measured distance");
  // Per van: Blue 14.3 litres per 100 km, 730 km, 0.209 a km; Red 18.7, 700 km, 0.272; the hired van one fill and nothing to measure from.
  const van = (name: string) => page.locator(".crm-fl-van").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(van("Blue van").getByTestId("fl-fu-per100")).toHaveText("14.3");
  await expect(van("Blue van").locator('[data-cell="distance"]')).toHaveText("730 km");
  await expect(van("Blue van").locator('[data-cell="rate"]')).toHaveText("£0.209");
  await expect(van("Red van").getByTestId("fl-fu-per100")).toHaveText("18.7");
  await expect(van("Red van").locator('[data-cell="distance"]')).toHaveText("700 km");
  await expect(van("Red van").locator('[data-cell="rate"]')).toHaveText("£0.272");
  await expect(van("Hired van").getByTestId("fl-fu-per100")).toHaveText("—");
  await expect(van("Hired van")).toContainText("no fill to measure from yet");
  // The red van at each fill: 13 Jul 18.9, 21 Jul 18.3, 27 Jul 18.8; its service fell due Mon 20 Jul.
  await expect(page.getByTestId("fl-fu-worst")).toHaveText("Red van uses the most for its distance. Litres per 100 km at each fill: Mon, Jul 13 18.9, Tue, Jul 21 18.3, Mon, Jul 27 18.8. Its service fell due Mon, Jul 20.");
  // By month: July holds every fill of the sample.
  const july = page.getByTestId("fl-fu-months").locator('tr[data-month="2026-07-01"]');
  await expect(july.locator("td")).toHaveText(["£152.86 · 104.7 L", "£190.67 · 130.6 L", "£64.24 · 44 L"]);
  await expect(page.getByTestId("fl-fu-months").locator('tr[data-month="2026-06-01"] td')).toHaveText(["—", "—", "—"]);
  // The chips narrow the fills; a fill shows its own distance (the server's) and litres per 100 km.
  await page.getByRole("group", { name: "Show the fills of" }).getByRole("button", { name: /Red van/ }).click();
  await expect(page.locator("[data-fill]")).toHaveCount(3);
  await expect(page.locator("[data-fill]").first().locator('[data-cell="distance"]')).toHaveText("260");
  await expect(page.locator("[data-fill]").first().locator('[data-cell="per100"]')).toHaveText("18.8");
  await picture(page, "p25-2-ada-fuel");
  expect(problems).toEqual([]);
});

test("Subcontractors: the ledger's figures; \"Chase the certificate\" sends e-mail 11 to the subcontractor's own address and to nobody else, and leaves them not covered", async ({ as, api, stand, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const ada = context.request;
  const owner = await api("owner");
  const headers = await csrf(ada);
  try {
    await page.goto(`${STAFF}subcontractors`);
    // §68: 5 on the books, covered 4; 53 days bought, 17,800; one cannot go out (Marek Sowa, 28 days ago); 5 visits with no day.
    const served = {
      all: await figure(ada, stand, "subcontractors"),
      covered: await figure(ada, stand, "subcontractors", undefined, [{ column: "insurance_until", op: "gte", value: "2026-07-28" }]),
      out: await figure(ada, stand, "subcontractors", undefined, [{ column: "insurance_until", op: "lt", value: "2026-07-28" }]),
      days: await figure(ada, stand, "subcontractors", { fn: "sum", column: "days_used", alias: "d" }),
      spent: await figure(ada, stand, "subcontractors", { fn: "sum", column: "spent", alias: "s" }),
      undated: await figure(ada, stand, "job_visits", undefined, [{ column: "state", op: "eq", value: "waiting" }, { column: "day", op: "is_null" }]),
    };
    expect(served).toEqual({ all: 5, covered: 4, out: 1, days: 53, spent: 17800, undated: 5 });
    await expect(page.locator('[data-figure="on-books"] [data-value]')).toHaveText("5");
    await expect(page.locator('[data-figure="on-books"]')).toContainText("covered 4");
    await expect(page.locator('[data-figure="days"] [data-value]')).toHaveText("53");
    await expect(page.locator('[data-figure="days"]')).toContainText("£17,800 of outside help");
    await expect(page.locator('[data-figure="out"] [data-value]')).toHaveText("1");
    await expect(page.getByTestId("fl-sb-out")).toHaveText("Marek Sowa’s insurance ran out 28 days ago. They do not go on a site until we have seen the new certificate.");
    await expect(page.getByTestId("fl-sb-undated")).toContainText("5 visits have no day yet.");
    const row = (name: string) => page.locator("[data-sub]").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(row("Marek Sowa").locator('[data-cell="insurance"]')).toHaveText("ran out 28 days ago");
    await expect(row("Bright Lane Interiors").locator('[data-cell="spent"]')).toHaveText("£7,200");
    await expect(row("Halden Fit-Out")).toContainText("a day, 2 people");
    // Those who cannot go out come first.
    await expect(page.locator("[data-sub] h2").first()).toHaveText("Marek Sowa");
    await expect(page.getByRole("group", { name: "Show" }).getByRole("button")).toHaveText(["Everybody5", "Covered4", "Cannot go out1"]);

    // The chase, on a subcontractor of the spec's own (so no sample row is left chased): one e-mail, to his address.
    expect((await ada.post(data("subcontractors"), { data: { values: { name: "Spec Fleet Fitter", hands: 1, day_rate: 200, days_used: 1, insurance_until: "2026-07-01", email: "spec.fitter@fleet-spec.example" } }, headers })).status()).toBe(201);
    await expect(row("Spec Fleet Fitter")).toBeVisible();
    await row("Spec Fleet Fitter").getByTestId("fl-sb-chase").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Spec Fleet Fitter is asked for the certificate by e-mail. Still not covered until it lands.");
    await expect(row("Spec Fleet Fitter").getByTestId("fl-sb-chase")).toHaveText("Asked today");
    await expect(row("Spec Fleet Fitter").getByTestId("fl-sb-chase")).toBeDisabled();
    await expect(row("Spec Fleet Fitter").getByTestId("fl-sb-asked")).toHaveText("Certificate asked for on Jul 28, 2026 by Ada Novak.");
    // Still not covered: the figure has not moved.
    expect(await figure(ada, stand, "subcontractors", undefined, [{ column: "insurance_until", op: "gte", value: "2026-07-28" }])).toBe(4);
    const sub = (await rows<{ id: number; chased_by_id: string }>(ada, data, "subcontractors", { column: "name", op: "eq", value: "Spec Fleet Fitter" }))[0]!;
    expect(sub.chased_by_id).toBe(stand.people["ada"]!.id);
    await expect.poll(async () => (await rows<{ kind: string; to: string | null }>(owner, data, "outbox", { column: "subcontractor_id", op: "eq", value: sub.id })).map((one) => one.kind), { timeout: 20_000 }).toEqual(["certificate-asked"]);
    const message = (await rows<{ kind: string; to: string | null }>(owner, data, "outbox", { column: "subcontractor_id", op: "eq", value: sub.id }))[0]!;
    expect(message.to === null || message.to === "spec.fitter@fleet-spec.example").toBe(true);
    // Changing anything else, his address included, sends nothing more.
    expect((await ada.patch(data("subcontractors", `/${String(sub.id)}`), { data: { values: { email: "other@fleet-spec.example", days_used: 2 } }, headers })).status()).toBe(200);
    await page.waitForTimeout(1500);
    expect(await rows(owner, data, "outbox", { column: "subcontractor_id", op: "eq", value: sub.id })).toHaveLength(1);
    await picture(page, "p25-3-ada-subcontractors");
    expect(problems).toEqual([]);
  } finally {
    for (const one of await rows<{ id: number }>(ada, data, "subcontractors", { column: "name", op: "eq", value: "Spec Fleet Fitter" })) {
      const ownerHeaders = await csrf(owner);
      for (const message of await rows<{ id: number }>(owner, data, "outbox", { column: "subcontractor_id", op: "eq", value: one.id })) expect((await owner.delete(data("outbox", `/${String(message.id)}?confirm=true`), { headers: ownerHeaders })).status()).toBeLessThan(300);
    }
    await removeAll(ada, data, "subcontractors", { column: "name", op: "eq", value: "Spec Fleet Fitter" });
  }
});

test("Insurance claims: the ledger's figures; an incident added, settled by its button, and taken away", async ({ as, stand, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const ada = context.request;
  try {
    await page.goto(`${STAFF}insurance-claims`);
    // §67: 5 incidents, open 2 (oldest 26 days); claimed 5,870; excess on the settled 750; paid out 2,160; still claimed 2,960.
    const open = [{ column: "state", op: "eq", value: "open" }];
    const settled = [{ column: "state", op: "eq", value: "settled" }];
    const served = {
      all: await figure(ada, stand, "insurance_incidents"),
      open: await figure(ada, stand, "insurance_incidents", undefined, open),
      claimed: await figure(ada, stand, "insurance_incidents", { fn: "sum", column: "claimed", alias: "c" }),
      excess: await figure(ada, stand, "insurance_incidents", { fn: "sum", column: "excess", alias: "e" }, settled),
      paid: await figure(ada, stand, "insurance_incidents", { fn: "sum", column: "paid", alias: "p" }),
      still: await figure(ada, stand, "insurance_incidents", { fn: "sum", column: "claimed", alias: "c" }, open),
    };
    expect(served).toEqual({ all: 5, open: 2, claimed: 5870, excess: 750, paid: 2160, still: 2960 });
    await expect(page.locator(".crm-fl-lead")).toHaveText("5 incidents on record. 2 are still open, waiting on somebody outside this building.");
    await expect(page.locator('[data-figure="open"] [data-value]')).toHaveText("2");
    await expect(page.locator('[data-figure="open"]')).toContainText("oldest is 26 days");
    await expect(page.locator('[data-figure="claimed"] [data-value]')).toHaveText("£5,870");
    await expect(page.locator('[data-figure="excess"] [data-value]')).toHaveText("£750");
    await expect(page.locator('[data-figure="paid"] [data-value]')).toHaveText("£2,160");
    await expect(page.locator('[data-figure="still"] [data-value]')).toHaveText("£2,960");
    await expect(page.getByTestId("fl-ic-big")).toHaveText("£2,960 has been open 26 days, waiting on somebody else. Chase the carrier, then the broker.");
    // Open first, the oldest first; the operations manager reads no company, so none is named to her.
    await expect(page.locator("[data-incident] h2").first()).toHaveText("Pallet of chairs damaged in transit");
    await expect(page.locator("[data-incident]").first().getByTestId("fl-ic-state")).toHaveText("26 days open");
    await expect(page.locator("[data-incident]").first()).not.toContainText("Brightloom");

    // An incident of the spec's own: added, then settled.
    await page.getByTestId("fl-ic-add").click();
    const dialog = page.getByRole("dialog", { name: "Add an incident" });
    await dialog.getByLabel("What happened").fill("Spec fleet: a scraped door frame");
    await dialog.getByLabel("Kind").fill("public liability");
    await dialog.getByLabel("Claimed").fill("420");
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Added: Spec fleet: a scraped door frame.");
    await expect(page.locator('[data-figure="open"] [data-value]')).toHaveText("3");
    const mine = page.locator("[data-incident]").filter({ hasText: "Spec fleet: a scraped door frame" });
    await expect(mine.getByTestId("fl-ic-state")).toHaveText("0 days open");
    await mine.getByTestId("fl-ic-settle").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Settled: Spec fleet: a scraped door frame.");
    await expect(mine.getByTestId("fl-ic-state")).toHaveText("Settled");
    await expect(mine.getByTestId("fl-ic-settle")).toHaveCount(0);
    expect((await rows<{ state: string }>(ada, data, "insurance_incidents", { column: "what", op: "eq", value: "Spec fleet: a scraped door frame" }))[0]!.state).toBe("settled");
    await picture(page, "p25-4-ada-insurance");
    expect(problems).toEqual([]);
  } finally {
    await removeAll(ada, data, "insurance_incidents", { column: "what", op: "eq", value: "Spec fleet: a scraped door frame" });
  }
});

test("the CRM admin has the four, with the company named; Read-only reads each with nothing to press, and the server refuses her writes", async ({ as, api, data }) => {
  const tessa = await as("tessa");
  const page = await tessa.newPage();
  await page.goto(`${STAFF}insurance-claims`);
  await unfoldMenu(page);
  for (const name of ["Vehicles", "Fuel", "Time sheets", "Training", "Subcontractors", "Insurance claims"]) await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name, exact: true })).toBeVisible();
  // The admin reads companies: the incident names one.
  await expect(page.locator("[data-incident]").filter({ hasText: "Pallet of chairs damaged in transit" })).toContainText("Brightloom");

  const grace = await as("grace");
  const read = await grace.newPage();
  const problems = watch(read);
  for (const path of SCREENS) {
    await read.goto(`${STAFF}${path}`);
    await expect(read.locator(`[data-screen]`)).toBeVisible();
    await expect(read.locator(".crm-kpi").first()).toBeVisible();
    // Nothing to press: no add, no change, no chase, no settle, no "fixed".
    await expect(read.locator('[data-testid$="-add"], [data-testid$="-edit"], [data-testid="fl-sb-chase"], [data-testid="fl-ic-settle"], [data-testid="fl-vn-book"]')).toHaveCount(0);
    await expect(read.getByRole("button", { name: "Fixed" })).toHaveCount(0);
  }
  const graceApi = await api("grace");
  const headers = await csrf(graceApi);
  const marek = (await rows<{ id: number }>(graceApi, data, "subcontractors", { column: "name", op: "eq", value: "Marek Sowa" }))[0]!;
  expect((await graceApi.patch(data("subcontractors", `/${String(marek.id)}`), { data: { values: { chased_at: new Date().toISOString() } }, headers })).status()).toBe(403);
  expect((await graceApi.post(data("vehicles"), { data: { values: { name: "Grace van" } }, headers })).status()).toBe(403);
  const open = (await rows<{ id: number }>(graceApi, data, "insurance_incidents", { column: "state", op: "eq", value: "open" }))[0]!;
  expect((await graceApi.post(data("insurance_incidents", `/${String(open.id)}/actions/settle`), { data: { from: "open" }, headers })).status()).toBe(403);
  expect(problems).toEqual([]);
});

test("a rep and the sales manager are refused every fleet table by the server, by a list and by a figure; their menus have no line and the address says it is not their role", async ({ as, api, stand, data }) => {
  for (const person of ["dana", "ivy"]) {
    const request = await api(person);
    const headers = await csrf(request);
    for (const table of FLEET) {
      expect((await request.get(data(table, "?limit=1"))).status(), `${person} ${table}`).toBe(403);
      const asked = await request.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: `crm_${table}` }, shape: "single-metric", aggregations: [{ fn: "count", alias: "n" }] } }, headers });
      expect(asked.status(), `${person} ${table} figure`).toBe(403);
    }
    const context = await as(person);
    const page = await context.newPage();
    await page.goto(`${STAFF}subcontractors`);
    await expect(page.getByRole("heading", { name: "This page is not part of your role" })).toBeVisible();
    await unfoldMenu(page);
    for (const name of ["Vehicles", "Fuel", "Time sheets", "Training", "Subcontractors", "Insurance claims"]) await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  // The crew reads no subcontractor and no claim, by any door.
  const yusuf = await api("f_yusuf");
  for (const table of ["subcontractors", "insurance_incidents"]) expect((await yusuf.get(data(table, "?limit=1"))).status(), table).toBe(403);
});

test("in Arabic, dark, 390 wide: the four screens read right to left, fit the phone, and axe finds nothing; light too", async ({ as, api }) => {
  const ada = await api("ada");
  const found: string[] = [];
  await inArabic(ada, async () => {
    const context = await as("ada", { ...PHONE, colorScheme: "dark" });
    const page = await context.newPage();
    const problems = watch(page);
    for (const path of SCREENS) {
      await page.goto(`${STAFF}${path}`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator(".crm-kpi").first()).toBeVisible();
      expect(await narrowEnough(page), `${path} fits 390`).toBe(true);
      found.push(...(await axe(page)).map((line) => `${path}: ${line}`));
      if (path === "vehicles") await picture(page, "p25-5-ada-arabic-dark");
    }
    expect(problems).toEqual([]);
  });
  const light = await as("ada", PHONE);
  const page = await light.newPage();
  for (const path of SCREENS) {
    await page.goto(`${STAFF}${path}`);
    await expect(page.locator(".crm-kpi").first()).toBeVisible();
    expect(await narrowEnough(page), `${path} fits 390, light`).toBe(true);
    found.push(...(await axe(page)).map((line) => `${path} light: ${line}`));
  }
  // The dialogs too, at 390: the keyboard stays inside, Escape closes and gives the focus back.
  await page.goto(`${STAFF}vehicles`);
  await page.getByTestId("fl-vn-add").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add a vehicle" });
  await expect(dialog.getByLabel("Name")).toBeFocused();
  found.push(...(await axe(page)).map((line) => `vehicle dialog: ${line}`));
  expect(await narrowEnough(page)).toBe(true);
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("fl-vn-add")).toBeFocused();
  expect(found).toEqual([]);
});
