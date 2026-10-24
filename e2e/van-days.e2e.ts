/**
 * Plan 68 S14, stage 3: A CREW'S VEHICLE FOR THE DAY, A HIRED VEHICLE, AND WHAT
 * TO LOAD, against `designs/plan-68/Meridian Sales Vehicle Days` (M3). Run on a
 * stand of stage 3 (`CRM_STAND_STAGE=3`); skipped where Vehicles and crew is
 * not in the stand's stage.
 *
 * The sample (M3 BN-17…23): Blue crew on its own YJ19 KPX on Tue 4, Wed 5 and
 * Thu 6 August; Red crew on the hired ML24 VDR (hired Mon 27 Jul to Fri 14 Aug)
 * on Wed 5 August; J-07's return visit booked for Blue on Wed 5 August, with
 * its stock need (cable trays, two each) and its delivery note.
 *
 *  - the booking dialog's "Vehicle for the day": the crew's day already on a
 *    vehicle is a line with "Change for the whole day"; the list says how each
 *    vehicle stands and a vehicle with another crew cannot be picked; a pick
 *    out of its hire days is refused with its fix; the service flag; a
 *    booking writes the crew's day; in Arabic, right to left;
 *  - the Day sheet names the crew's vehicle (hired, not its own), lists what
 *    to load on each visit, and prints it; "Change" is the office's; the
 *    Route's head names the vehicle;
 *  - Vehicles: the hire days, where the hired vehicle goes (each day to its
 *    Route), a hire shortened past a day given to a crew refused, a hired
 *    vehicle added with every field;
 *  - My day names the crew's vehicle, and "Not your usual vehicle today." only
 *    for the crew on another; the crew reads its own days only.
 *
 * The server's rules (one crew a vehicle a day, the hire days, the crew's
 * reach, the old crew told) are proved on three engines in `proofs/crm-fleet`,
 * `crm-crew` and `crm-jobs`.
 */
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { restoreVanDays, SAMPLE_VAN_DAYS } from "./vandays-helpers.ts";

const BLUE = 1;
const RED = 2;
const HIRED = 3;
const V = { nordwind: 13, fernway: 14, tandem: 16 } as const;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

test.skip(({ stand }) => !stand.parts.includes("fleet"), "Vehicles and crew is not in this stand's stage");

/** Put a sample visit that waits back as the sample has it: waiting, with no day. */
async function backToWaiting(person: APIRequestContext, data: Data, id: number): Promise<void> {
  const headers = await csrf(person);
  const now = (await rows<{ state: string }>(person, data, "job_visits", { column: "id", op: "eq", value: id }))[0]!;
  if (now.state === "booked") expect((await person.post(data("job_visits", `/${String(id)}/actions/back-to-waiting`), { data: { from: "booked" }, headers })).status()).toBe(200);
  expect((await person.patch(data("job_visits", `/${String(id)}`), { data: { values: { day: null, start_time: null, crew_id: null } }, headers })).status()).toBe(200);
}

const axe = async (page: Page): Promise<string[]> => {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((one) => `${one.id}: ${one.nodes.map((node) => node.target.join(" ")).join(", ")}`);
};

test("the sample holds the crews' days: Blue on its own vehicle, Red on the hired one on Wed 5 Aug, and each crew reads its own", async ({ api, data }) => {
  const ada = await api("ada");
  const all = await rows<{ crew_id: number; day: string; vehicle_id: number; plate: string; hired: boolean | number }>(ada, data, "van_days");
  const order = (a: { day: string; crew_id: number }, b: { day: string; crew_id: number }) => a.day.localeCompare(b.day) || a.crew_id - b.crew_id;
  expect(all.map((row) => ({ crew_id: row.crew_id, day: row.day.slice(0, 10), vehicle_id: row.vehicle_id })).sort(order)).toEqual([...SAMPLE_VAN_DAYS].sort(order));
  // The day's row keeps its vehicle's plate and whether it is hired, for the crew who reads no other vehicle.
  expect(all.filter((row) => row.crew_id === RED).map((row) => [row.plate, Boolean(row.hired)])).toEqual([["ML24 VDR", true]]);
  const hire = (await rows<{ hired_from: string; hired_to: string }>(ada, data, "vehicles", { column: "id", op: "eq", value: HIRED }))[0]!;
  expect([hire.hired_from.slice(0, 10), hire.hired_to.slice(0, 10)]).toEqual(["2026-07-27", "2026-08-14"]);
  // Each crew reads its own days, as the server answers them.
  const rina = await api("rina");
  expect((await rows<{ crew_id: number }>(rina, data, "van_days")).map((row) => row.crew_id)).toEqual([RED]);
  const yusuf = await api("f_yusuf");
  expect((await rows<{ crew_id: number }>(yusuf, data, "van_days")).map((row) => row.crew_id)).toEqual([BLUE, BLUE, BLUE]);
});

test("the booking dialog's vehicle for the day: the crew's day as it stands, the list, a vehicle out of its hire days refused, and a booking that writes the day", async ({ as, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}deliveries`);
    await page.getByRole("button", { name: "Book Ward corridor seating, two sites at Fernway Clinics" }).click();
    const dialog = page.getByRole("dialog", { name: "Book a visit to a job" });
    await dialog.getByLabel("Day", { exact: true }).fill("2026-08-05");
    await dialog.getByLabel("Crew", { exact: true }).selectOption(String(BLUE));
    // Blue's Wednesday is on its own vehicle already: a line says so, and the other visit that day.
    await expect(dialog.getByTestId("vd-line")).toContainText("Blue crew is on YJ19 KPX all day Wed, Aug 5. 1 other visit.");
    await dialog.getByTestId("vd-change-day").click();
    const list = dialog.getByRole("listbox", { name: "Vehicles for Blue crew on Wed, Aug 5" });
    await expect(list).toBeFocused();
    await expect(list.locator(`[data-vehicle="${String(BLUE)}"]`)).toContainText("Blue crew’s own");
    await expect(list.locator(`[data-vehicle="${String(BLUE)}"]`)).toHaveAttribute("aria-selected", "true");
    await expect(list.locator(`[data-vehicle="${String(RED)}"]`)).toContainText("Red crew’s own · not in use on Wed, Aug 5");
    await expect(list.locator(`[data-vehicle="${String(HIRED)}"]`)).toContainText("With Red crew on Wed, Aug 5");
    await expect(list.locator(`[data-vehicle="${String(HIRED)}"]`)).toHaveAttribute("aria-disabled", "true");
    // By the keys: down to Red's own vehicle, picked. The change moves Blue's other visit that day; the van is past its service.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(dialog.getByTestId("vd-moves")).toHaveText("This moves the crew’s visit that day to YK20 HTC.");
    await expect(dialog.getByTestId("vd-service")).toHaveText("YK20 HTC is 8 days past its service. It can still be booked.");
    await picture(page, "m3-1e-ada-change-for-the-day");
    // The vehicle with another crew is listed and cannot be picked; Escape closes the list and keeps the dialog.
    await dialog.getByTestId("vd-pick").locator("button").click();
    await list.locator(`[data-vehicle="${String(HIRED)}"]`).click({ force: true });
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(dialog).toBeVisible();

    // Red crew on Mon 10 Aug has no day yet: its own vehicle; the hired one picked, then the day moved past the hire.
    await dialog.getByLabel("Crew", { exact: true }).selectOption(String(RED));
    await dialog.getByLabel("Day", { exact: true }).fill("2026-08-10");
    await expect(dialog.getByTestId("vd-pick").locator("button")).toHaveAttribute("data-vehicle", String(RED));
    await dialog.getByTestId("vd-pick").locator("button").click();
    await expect(list.locator(`[data-vehicle="${String(HIRED)}"]`)).toHaveCount(0);
    const redList = dialog.getByRole("listbox", { name: "Vehicles for Red crew on Mon, Aug 10" });
    await expect(redList.locator(`[data-vehicle="${String(HIRED)}"]`)).toContainText("Hired until Fri, Aug 14");
    await redList.locator(`[data-vehicle="${String(HIRED)}"]`).click();
    await dialog.getByLabel("Day", { exact: true }).fill("2026-08-17");
    await expect(dialog.getByTestId("vd-refusal")).toHaveAttribute("data-kind", "hiredTo");
    await expect(dialog.getByTestId("vd-refusal")).toContainText("ML24 VDR is hired until Fri, Aug 14.");
    await expect(dialog.getByTestId("vd-change-hire").locator("a")).toHaveAttribute("href", /\/vehicles\/hire\/3$/);
    await expect(dialog.locator("[data-go]")).toBeDisabled();
    // Back inside the hire: booked, and Red's Monday is on the hired vehicle, as the server keeps it.
    await dialog.getByLabel("Day", { exact: true }).fill("2026-08-10");
    await expect(dialog.getByTestId("vd-refusal")).toHaveCount(0);
    await dialog.locator("[data-go]").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Booked: Fernway Clinics, Mon, Aug 10, Red crew.");
    const made = await rows<{ crew_id: number; vehicle_id: number }>(context.request, data, "van_days", { column: "day", op: "eq", value: "2026-08-10" });
    expect(made.map((row) => [row.crew_id, row.vehicle_id])).toEqual([[RED, HIRED]]);
    expect(problems).toEqual([]);
  } finally {
    await backToWaiting(context.request, data, V.fernway);
    await restoreVanDays(context.request, data);
  }
});

test("the Day sheet names the crew's vehicle and what to load on each visit, prints both, and the Route names the vehicle", async ({ as }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  // Red crew, Wed 5 Aug: on the hired vehicle, not its own; Nordwind's visit has nothing listed to load.
  await page.goto(`${STAFF}day-sheet/2026-08-05/${String(RED)}`);
  const head = page.getByTestId("vd-sheet-vehicle");
  await expect(head).toContainText("ML24 VDR");
  await expect(head).toContainText("Hired van");
  await expect(head.getByTestId("vd-hired")).toHaveText("Hired");
  await expect(head.getByTestId("vd-not-own")).toHaveText("Not the crew’s own vehicle (YK20 HTC).");
  const nordwind = page.locator(`li[data-visit="${String(V.nordwind)}"]`);
  await expect(nordwind.getByTestId("vd-stock")).toHaveText("Stock for this jobNothing listed yet.");
  await expect(nordwind.getByTestId("vd-note")).toHaveText("On the delivery note · Wed, Aug 5Nothing listed yet.");
  await picture(page, "m3-2a-ada-day-sheet-red");
  // "Change": one vehicle for all of the crew's visits that day; Save stays off until another is picked.
  await page.getByRole("button", { name: "Change the vehicle for Red crew, Wed, Aug 5" }).click();
  const change = page.getByRole("dialog", { name: "Vehicle for Red crew, Wed, Aug 5" });
  await expect(change.getByRole("listbox")).toBeVisible();
  await expect(change.getByRole("listbox").locator(`[data-vehicle="${String(BLUE)}"]`)).toHaveAttribute("aria-disabled", "true");
  await expect(change.locator("[data-go]")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(change).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(change).toHaveCount(0);
  // The sheet as it prints: the crew line names the vehicle, and each visit its two lists.
  await page.getByTestId("jb-print").click();
  await expect(page.getByTestId("jb-print-crew")).toHaveText("Red crew (Rina Duval, Mo Idris, Sean Petit; ML24 VDR, hired)");
  await expect(page.getByTestId("jb-print-layout").getByTestId("vd-loads")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Blue crew, Wed 5 Aug: its own vehicle; J-07's return visit takes the cable trays and the note's lines, as ordered.
  await page.goto(`${STAFF}day-sheet/2026-08-05/${String(BLUE)}`);
  await expect(page.getByTestId("vd-sheet-vehicle")).toContainText("YJ19 KPX");
  await expect(page.getByTestId("vd-not-own")).toHaveCount(0);
  await expect(page.getByTestId("vd-hired")).toHaveCount(0);
  const tandem = page.locator(`li[data-visit="${String(V.tandem)}"]`);
  await expect(tandem.getByTestId("vd-stock").locator("li")).toHaveText(["Cable trays and floor power2 each"]);
  await expect(tandem.getByTestId("vd-note").locator("li")).toHaveText(["Cable tray, 2m2", "Bench top, laminate1"]);
  // Nothing of what the stock costs.
  expect(await page.locator("#crm-page").innerText()).not.toMatch(/£|€|\$/);
  await page.getByTestId("jb-print").click();
  await expect(page.getByTestId("jb-print-crew")).toHaveText("Blue crew (Yusuf Adeyemi, Cal Brennan; YJ19 KPX)");
  await expect(page.getByTestId("jb-print-layout").getByTestId("vd-stock")).toContainText("Cable trays and floor power");
  await picture(page, "m3-2h-ada-day-sheet-print-blue");
  await page.keyboard.press("Escape");

  // The Route's head: the crew, its vehicle that day, and the day.
  await page.goto(`${STAFF}route/2026-08-05/${String(RED)}`);
  await expect(page.getByTestId("jb-route-vehicle")).toHaveText("Vehicle ML24 VDR (hired)");
  await page.goto(`${STAFF}route/2026-08-05/${String(BLUE)}`);
  await expect(page.getByTestId("jb-route-vehicle")).toHaveText("Vehicle YJ19 KPX");
  expect(problems).toEqual([]);
});

test("the print stays paper in the dark, and Read-only reads the sheet's vehicle with no Change", async ({ as }) => {
  const dark = await (await as("ada", { colorScheme: "dark" })).newPage();
  await dark.goto(`${STAFF}day-sheet/2026-08-05/${String(RED)}`);
  await dark.getByTestId("jb-print").click();
  await expect(dark.getByTestId("jb-print-layout")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await dark.keyboard.press("Escape");
  const grace = await (await as("grace")).newPage();
  await grace.goto(`${STAFF}day-sheet/2026-08-05/${String(RED)}`);
  await expect(grace.getByTestId("vd-sheet-vehicle")).toContainText("ML24 VDR");
  await expect(grace.getByTestId("vd-sheet-change")).toHaveCount(0);
});

test("Vehicles: the hired vehicle's days and where it goes; a hire shortened past a day given to a crew is refused; a hired vehicle is added with every field", async ({ as, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const name = "Spec hired vehicle";
  try {
    await page.goto(`${STAFF}vehicles`);
    await expect(page.locator(".crm-screen-sub")).toHaveText("2 of our own, 1 hired. When one is off the road, its crew’s day can go on another vehicle.");
    const card = page.locator(`[data-vehicle="${String(HIRED)}"]`);
    await expect(card.getByTestId("fl-vn-model")).toHaveText("No crew of its own");
    await expect(card.getByTestId("vd-hire-days")).toHaveText("Hired Mon, Jul 27 to Fri, Aug 14");
    await expect(card.getByTestId("vd-where").locator("li")).toHaveText(["Wed, Aug 5 · Red crewRoute"]);
    await expect(card.getByRole("link", { name: "Route for Red crew, Wed, Aug 5" })).toHaveAttribute("href", /\/route\/2026-08-05\/2$/);
    await picture(page, "m3-4a-ada-vehicles");
    // Shortened to end on Tue 4 Aug: Red crew has it on the 5th, so it is refused, naming that day.
    await card.getByTestId("vd-hire-change").click();
    const hire = page.getByRole("dialog", { name: "Change the hire days" });
    await expect(hire.getByTestId("vd-given")).toContainText("Wed, Aug 5 · Red crew");
    await hire.getByLabel("To", { exact: true }).fill("2026-08-04");
    await expect(hire.getByTestId("vd-hire-refused")).toHaveText("Red crew has it on Wed, Aug 5. Move that day first.");
    await expect(hire.locator("[data-go]")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(hire).toHaveCount(0);
    // The booking dialog's "Change the hire days" opens the same dialog on the vehicle.
    await page.goto(`${STAFF}vehicles/hire/${String(HIRED)}`);
    await expect(page.getByRole("dialog", { name: "Change the hire days" })).toBeVisible();
    await page.keyboard.press("Escape");

    // A hired vehicle: every field asked for, then added.
    await page.getByTestId("vd-add-hired").click();
    const add = page.getByRole("dialog", { name: "Add a hired vehicle" });
    await expect(add.locator("[data-go]")).toBeDisabled();
    await add.getByLabel("Name").fill(name);
    await add.getByLabel("Plate").fill("sp26 hir");
    await add.getByLabel("Model").fill("High-roof panel vehicle");
    await add.getByLabel("From").fill("2026-08-10");
    await expect(add.locator("[data-go]")).toBeDisabled();
    await add.getByLabel("To", { exact: true }).fill("2026-08-21");
    await add.locator("[data-go]").click();
    await expect(page.locator(".crm-toast").last()).toHaveText(`${name} is added, hired from Mon, Aug 10 to Fri, Aug 21.`);
    const made = (await rows<{ plate: string; hired: boolean | number; hired_from: string; hired_to: string }>(context.request, data, "vehicles", { column: "name", op: "eq", value: name }))[0]!;
    expect([made.plate, Boolean(made.hired), made.hired_from.slice(0, 10), made.hired_to.slice(0, 10)]).toEqual(["SP26 HIR", true, "2026-08-10", "2026-08-21"]);
    expect(problems).toEqual([]);
  } finally {
    const headers = await csrf(context.request);
    for (const one of await rows<{ id: number }>(context.request, data, "vehicles", { column: "name", op: "eq", value: name })) await context.request.delete(data("vehicles", `/${String(one.id)}?confirm=true`), { headers });
  }
});

test("My day names the crew's vehicle that day, and says when it is not the usual one", async ({ as }) => {
  const rina = await (await as("rina", PHONE)).newPage();
  const problems = watch(rina);
  await rina.goto(`${STAFF}my-day/2026-08-05`);
  await expect(rina.getByTestId("cw-vehicle")).toContainText("ML24 VDR · Hired van");
  await expect(rina.getByTestId("cw-vehicle-other")).toHaveText("Not your usual vehicle today.");
  await picture(rina, "m3-5a-rina-my-day");
  const yusuf = await (await as("f_yusuf", PHONE)).newPage();
  await yusuf.goto(`${STAFF}my-day/2026-08-05`);
  await expect(yusuf.getByTestId("cw-vehicle")).toContainText("YJ19 KPX · Blue van");
  await expect(yusuf.getByTestId("cw-vehicle-other")).toHaveCount(0);
  const card = yusuf.locator(`[data-visit="${String(V.tandem)}"]`);
  await expect(card.getByTestId("vd-stock").locator("li")).toHaveText(["Cable trays and floor power2 each"]);
  await expect(card.getByTestId("vd-note").locator("li")).toHaveText(["Cable tray, 2m2", "Bench top, laminate1"]);
  expect(problems).toEqual([]);
});

test("in Arabic, dark: the booking dialog's list and the Day sheet read right to left, and axe finds nothing", async ({ as }) => {
  const context = await as("ada", { colorScheme: "dark" });
  await inArabic(context.request, async () => {
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}day-sheet/2026-08-05/${String(RED)}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("vd-hired")).toHaveText("مستأجرة");
    await expect(page.getByTestId("vd-stock").first()).toContainText("المخزون لهذه المهمة");
    await page.waitForTimeout(1000);
    const found = await axe(page);
    await picture(page, "m3-6b-ada-day-sheet-ar-dark");
    await page.goto(`${STAFF}deliveries`);
    await page.locator('[data-testid="jb-tobook"] li[data-visit="14"] [data-act="book"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#crm-jb-day").fill("2026-08-05");
    await dialog.locator("#crm-jb-crew").selectOption(String(BLUE));
    await dialog.getByTestId("vd-change-day").click();
    await expect(dialog.getByRole("listbox")).toBeVisible();
    await expect(dialog.locator(".crm-label", { hasText: "مركبة اليوم" })).toBeVisible();
    found.push(...(await axe(page)).map((line) => `dialog: ${line}`));
    await picture(page, "m3-6a-ada-dialog-ar-dark");
    await page.keyboard.press("Escape");
    expect(found).toEqual([]);
    expect(problems).toEqual([]);
  });
});
