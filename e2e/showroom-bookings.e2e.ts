/**
 * P19, Showroom bookings WRITTEN: the booking dialog's showroom use (book,
 * move, cancel), the clash that names the booking in the way and offers the
 * next clear time, a lost reply, two people at once, the showroom's hours
 * from Settings, and every "may not" as the server's refusal by a direct
 * call. Stage 2's part: run with `CRM_STAND_STAGE=2`.
 *
 * Every booking a spec makes says "Spec" in what they come to see, and is
 * taken away again by the CRM admin; a booking whose time a spec moves is
 * its own. The sample's nine stay as they are.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch, type Data } from "./helpers.ts";

test.skip(Number(process.env.CRM_STAND_STAGE ?? "1") < 2, "the showroom arrives with stage 2: run with CRM_STAND_STAGE=2");

interface BookingRow {
  id: number;
  space_id: number;
  contact_id: number | null;
  starts_at: string;
  minutes: number;
  state: string;
  note: string | null;
  party: number;
}

const spec = { column: "note", op: "like", value: "Spec%" };
const chip = (page: Page, filter: string) => page.locator(`.crm-chip-btn[data-filter="${filter}"] .crm-chip-count`);
const spaceNamed = async (person: APIRequestContext, data: Data, name: string): Promise<number> => (await rows<{ id: number }>(person, data, "showroom_spaces", { column: "name", op: "eq", value: name }))[0]!.id;
const contactNamed = async (person: APIRequestContext, data: Data, name: string): Promise<{ id: number; company_id: number }> => (await rows<{ id: number; company_id: number }>(person, data, "contacts", { column: "name", op: "eq", value: name }))[0]!;

async function tidy(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const booking of await rows<BookingRow>(admin, data, "showroom_bookings", spec)) {
    for (const piece of await rows<{ id: number }>(admin, data, "display_pieces", { column: "promised_booking_id", op: "eq", value: booking.id })) await admin.patch(data("display_pieces", `/${String(piece.id)}`), { data: { values: { promised_booking_id: null } }, headers });
    const gone = await admin.delete(data("showroom_bookings", `/${String(booking.id)}?confirm=true`), { headers });
    expect(gone.status(), await gone.text()).toBeLessThan(300);
  }
}

test.afterEach(async ({ api, data }) => {
  await tidy(await api("tessa"), data);
});

test("the front desk books a visitor: the clash names the booking in the way, offers the next clear time, and the booking is confirmed", async ({ as, data }) => {
  const context = await as("corin");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}showroom`);
  await expect(chip(page, "all")).toHaveText("9");
  await page.getByTestId("sh-book").click();
  const dialog = page.getByRole("dialog", { name: "Book the showroom" });
  await dialog.getByLabel("Find a contact").fill("Bea");
  await dialog.getByLabel("Visitor", { exact: true }).selectOption({ label: "Bea Nolan · Low Orbit" });
  await dialog.getByLabel("Date").fill("2026-07-31");
  await dialog.getByLabel("Start").fill("10:00");
  await dialog.getByLabel("Space").selectOption({ label: "Main floor" });
  // Cobalt's three are on the Main floor from half past nine: the dialog names them and offers eleven.
  const refusal = dialog.locator('[data-check="taken"]');
  await expect(refusal).toContainText("Main floor is taken 09:30–11:00 on Fri, Jul 31 by Cobalt Legal, Ines Vaughan.");
  await expect(dialog.getByRole("button", { name: "Book", exact: true })).toBeDisabled();
  await expect(dialog.locator(".crm-bk-other[data-clash='1']")).toContainText("Cobalt Legal, Ines Vaughan");
  await refusal.getByTestId("sh-offer").click();
  await expect(dialog.getByLabel("Start")).toHaveValue("11:00");
  await expect(dialog.locator(".crm-sh-refusal")).toHaveCount(0);
  await dialog.getByLabel("How many").fill("2");
  await dialog.getByLabel("What they come to see").fill("Spec hot-desk bench, two heights");
  // What the visitor is told is what the server will send.
  await expect(dialog.getByTestId("sh-told")).toHaveText("Low Orbit, Bea Nolan is sent an e-mail confirming the day, the time and the space.");
  await picture(page, "sh-9-book-offer");
  await dialog.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Booked: Low Orbit, Bea Nolan, Main floor, Fri, Jul 31, 11:00.");
  await expect(chip(page, "all")).toHaveText("10");
  const made = await rows<BookingRow>(context.request, data, "showroom_bookings", spec);
  expect(made.map((one) => [one.state, one.party, one.minutes, one.starts_at.slice(0, 16)])).toEqual([["confirmed", 2, 60, "2026-07-31T10:00"]]);
  // The server wrote the visitor's e-mail (an address the sample keeps at example.test is never sent to).
  const mails = await rows<{ kind: string; booking_id: number | null }>(await (await as("tessa")).request, data, "outbox", { column: "kind", op: "eq", value: "showroom-confirmed" });
  expect(mails.filter((one) => one.booking_id === made[0]!.id)).toHaveLength(1);

  // Cancelled from its own card: the why, and it is gone, from the list and from the server.
  const card = page.locator(".crm-sh-card", { hasText: "Spec hot-desk bench" });
  await card.getByRole("button", { name: /^Cancel the booking of/ }).click();
  const cancelling = page.getByRole("dialog", { name: "Cancel this showroom booking" });
  await expect(cancelling.getByTestId("sh-told")).toHaveText("Low Orbit, Bea Nolan is sent an e-mail saying the visit is cancelled.");
  await expect(cancelling.getByRole("button", { name: "Cancel it" })).toBeDisabled();
  await cancelling.getByLabel("Why is it cancelled?").fill("Spec: their move slipped");
  await cancelling.getByRole("button", { name: "Cancel it" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Cancelled: Low Orbit, Bea Nolan, Fri, Jul 31.");
  await expect(card).toHaveCount(0);
  await expect(chip(page, "all")).toHaveText("9");
  expect(await rows(context.request, data, "showroom_bookings", spec)).toEqual([]);
  // Its why is kept with the removed booking, read through its space (plan 68 S16).
  await page.getByRole("button", { name: "Show cancelled bookings" }).click();
  const gone = page.getByTestId("sh-removed").locator(".crm-removed-line", { hasText: "Spec: their move slipped" });
  await expect(gone).toContainText("Why: Spec: their move slipped");
  await expect(gone).toContainText(/Cancelled by Corin/);
  expect(problems).toEqual([]);
});

test("a booking whose reply is lost is sent again with its key and is one booking; a cancel whose reply is lost is read back", async ({ as, data }) => {
  const context = await as("corin");
  const page = await context.newPage();
  await page.goto(`${STAFF}showroom`);
  await page.getByTestId("sh-book").click();
  const dialog = page.getByRole("dialog", { name: "Book the showroom" });
  await dialog.getByRole("button", { name: "A new name" }).click();
  await dialog.getByLabel("Visitor’s name").fill("Jo Bloggs");
  await dialog.getByLabel("Date").fill("2026-08-05");
  await dialog.getByLabel("Start").fill("12:15");
  await dialog.getByLabel("Space").selectOption({ label: "Meeting room" });
  await dialog.getByLabel("What they come to see").fill("Spec lost reply");
  // A new name has no address here: nobody is mailed, and the dialog says so.
  await expect(dialog.getByTestId("sh-told")).toHaveText("Jo Bloggs has no e-mail address here, so nothing is sent. Tell them yourself.");
  const sent: { key: string; replayed: boolean | null }[] = [];
  let dropped = false;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_showroom_bookings$/.test(new URL(request.url()).pathname)) return route.fallback();
    const key = (request.postDataJSON() as { clientKey: string }).clientKey;
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      sent.push({ key, replayed: null });
      return route.abort("connectionreset");
    }
    sent.push({ key, replayed: ((await response.json()) as { replayed?: boolean }).replayed === true });
    await route.fulfill({ response });
  });
  await dialog.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Booked: Jo Bloggs, Meeting room, Wed, Aug 5, 12:15.");
  await page.unroute("**/api/v1/data/**");
  expect(sent.length).toBe(2);
  expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
  const held = await rows<BookingRow>(context.request, data, "showroom_bookings", spec);
  expect(held.map((one) => one.state)).toEqual(["confirmed"]);
  const card = page.locator(".crm-sh-card", { hasText: "Spec lost reply" });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".crm-sh-who")).toHaveText("New visitor");
  await expect(card.getByTestId("sh-state")).toHaveText("Confirmed");

  await card.getByRole("button", { name: /^Cancel the booking of/ }).click();
  const cancelling = page.getByRole("dialog", { name: "Cancel this showroom booking" });
  await cancelling.getByLabel("Why is it cancelled?").fill("Spec: double booked by phone");
  let removals = 0;
  await page.route("**/api/v1/data/**", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    removals += 1;
    await route.fetch();
    return route.abort("connectionreset");
  });
  await cancelling.getByRole("button", { name: "Cancel it" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Cancelled: Jo Bloggs, Wed, Aug 5.");
  await page.unroute("**/api/v1/data/**");
  expect(removals).toBe(1);
  expect(await rows(context.request, data, "showroom_bookings", spec)).toEqual([]);
});

test("a move keeps to the hours and to the space; the old time is struck through, and the history says who moved it", async ({ as, api, data }) => {
  const corin = await api("corin");
  const headers = await csrf(corin);
  const booth = await spaceNamed(corin, data, "Booth corner");
  const marta = await contactNamed(corin, data, "Marta Kovac");
  const made = await corin.post(data("showroom_bookings"), { data: { values: { space_id: booth, contact_id: marta.id, company_id: marta.company_id, party: 1, starts_at: "2026-08-06T09:00:00.000Z", minutes: 45, note: "Spec move" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const page = await (await as("corin")).newPage();
  await page.goto(`${STAFF}showroom`);
  const card = page.locator(".crm-sh-card", { hasText: "Spec move" });
  await card.getByRole("button", { name: /^Move the booking of/ }).click();
  const dialog = page.getByRole("dialog", { name: "Move this showroom booking" });
  await expect(dialog.getByTestId("sh-was")).toContainText("Thu, Aug 6, 10:00–10:45 · Booth corner");
  // Not yet confirmed: a move tells nobody.
  await dialog.getByLabel("Start").fill("17:00");
  await expect(dialog.locator('[data-check="hours"]')).toContainText("The showroom is open 09:00 to 17:30.");
  await expect(dialog.getByTestId("sh-offer")).toHaveText("Use Fri, Aug 7, 09:00");
  await dialog.getByLabel("Date").fill("2026-08-08");
  await dialog.getByLabel("Start").fill("10:00");
  await expect(dialog.locator('[data-check="closed"]')).toContainText("The showroom is closed on Saturday.");
  // On a later day the next clear time starts at opening.
  await expect(dialog.getByTestId("sh-offer")).toHaveText("Use Mon, Aug 10, 09:00");
  await dialog.getByLabel("Date").fill("2026-08-10");
  await expect(dialog.getByTestId("sh-told")).toHaveText("It is not confirmed yet, so nothing is sent for the move.");
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Moved: Veldt Studios, Marta Kovac, Booth corner, Mon, Aug 10, 10:00.");
  await expect(card.locator(".crm-sh-time .crm-mono").first()).toHaveText("10:00");
  await card.getByRole("button", { name: /^Move the booking of/ }).click();
  await expect(page.getByRole("dialog", { name: "Move this showroom booking" }).getByTestId("sh-history")).toHaveText(/^Moved from Thu, Aug 6, 10:00 by Corin Hale, Tue, Jul 28, \d\d:\d\d\.$/);
  await page.keyboard.press("Escape");
});

test("live, two people: the CRM admin's open diary follows the front desk booking, confirming and cancelling", async ({ as, api, data }) => {
  const page = await (await as("tessa")).newPage();
  await page.goto(`${STAFF}showroom`);
  await expect(chip(page, "all")).toHaveText("9");
  const corin = await api("corin");
  const headers = await csrf(corin);
  const main = await spaceNamed(corin, data, "Main floor");
  const made = await corin.post(data("showroom_bookings"), { data: { values: { space_id: main, visitor_name: "Walk-in", party: 1, starts_at: "2026-08-03T13:00:00.000Z", minutes: 30, note: "Spec live" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  const card = page.locator(".crm-sh-card", { hasText: "Spec live" });
  await expect(card).toHaveCount(1);
  await expect(chip(page, "all")).toHaveText("10");
  await expect(chip(page, "tentative")).toHaveText("3");
  await expect(card.getByTestId("sh-state")).toHaveText("To confirm");
  expect((await corin.post(data("showroom_bookings", `/${String(id)}/actions/confirm`), { data: { from: "tentative" }, headers })).status()).toBe(200);
  await expect(card.getByTestId("sh-state")).toHaveText("Confirmed");
  await expect(chip(page, "tentative")).toHaveText("2");
  expect((await corin.patch(data("showroom_bookings", `/${String(id)}`), { data: { values: { cancel_reason: "Spec over" } }, headers })).status()).toBe(200);
  expect((await corin.delete(data("showroom_bookings", `/${String(id)}?confirm=true`), { headers })).status()).toBe(200);
  await expect(card).toHaveCount(0);
  await expect(chip(page, "all")).toHaveText("9");
});

test("every refusal is the server's: a clash, a cancelled state, Read-only's writes, and roles the showroom is not for", async ({ api, data }) => {
  const corin = await api("corin");
  const headers = await csrf(corin);
  const main = await spaceNamed(corin, data, "Main floor");
  // Over Cobalt's Friday on the Main floor: refused by the server, naming nothing of it.
  const over = await corin.post(data("showroom_bookings"), { data: { values: { space_id: main, visitor_name: "Spec clash", party: 1, starts_at: "2026-07-31T09:15:00.000Z", minutes: 30, note: "Spec clash" } }, headers });
  expect(over.status()).toBe(409);
  const body = await over.text();
  expect(body).toContain("BOOKING_TAKEN");
  expect(body).not.toContain("Cobalt");
  // Made as confirmed: refused (a booking starts to be confirmed).
  expect((await corin.post(data("showroom_bookings"), { data: { values: { space_id: main, visitor_name: "Spec state", party: 1, starts_at: "2026-08-10T09:00:00.000Z", minutes: 30, state: "confirmed", note: "Spec state" } }, headers })).status()).toBe(409);
  // A booking somebody came in for is not removed.
  const been = (await rows<BookingRow>(corin, data, "showroom_bookings", { column: "state", op: "eq", value: "done" }))[0]!;
  expect((await corin.delete(data("showroom_bookings", `/${String(been.id)}?confirm=true`), { headers })).status()).toBe(409);
  // Read-only reads and writes nothing.
  const grace = await api("grace");
  const graceHeaders = await csrf(grace);
  expect((await grace.get(data("showroom_bookings", "?limit=1"))).status()).toBe(200);
  expect((await grace.post(data("showroom_bookings"), { data: { values: { space_id: main, visitor_name: "Grace", party: 1, starts_at: "2026-08-10T09:00:00.000Z", minutes: 30 } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.patch(data("showroom_bookings", `/${String(been.id)}`), { data: { values: { outcome: "Mine" } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.delete(data("showroom_bookings", `/${String(been.id)}?confirm=true`), { headers: graceHeaders })).status()).toBe(403);
  // The marketer and the operations manager read nothing of it.
  for (const person of ["lena", "ada"]) expect([person, (await (await api(person)).get(data("showroom_bookings", "?limit=1"))).status()]).toEqual([person, 403]);
});

test("the showroom's hours are set in Settings by the CRM admin, and the dialog keeps to them; Read-only reads them", async ({ as, api, data }) => {
  const page = await (await as("tessa")).newPage();
  await page.goto(`${STAFF}settings/working-time`);
  const card = page.locator('[data-card="showroom"]');
  await expect(card).toBeVisible();
  await expect(card.getByTestId("sh-set-spaces").locator("input")).toHaveCount(3);
  await card.getByLabel("Opens").fill("10:00");
  await card.getByLabel("Opens").blur();
  await expect(page.locator(".crm-toast")).toHaveText("The showroom now opens 10:00 to 17:30.");
  try {
    const desk = await (await as("corin")).newPage();
    await desk.goto(`${STAFF}showroom`);
    await expect(desk.getByTestId("sh-note")).toHaveText("3 spaces · open 10:00 to 17:30");
    await desk.getByTestId("sh-book").click();
    const dialog = desk.getByRole("dialog", { name: "Book the showroom" });
    await dialog.getByLabel("Date").fill("2026-08-10");
    await dialog.getByLabel("Start").fill("09:30");
    await expect(dialog.locator('[data-check="hours"]')).toContainText("The showroom is open 10:00 to 17:30.");
    await expect(dialog.getByTestId("sh-offer")).toHaveText("Use Mon, Aug 10, 10:00");
    // The front desk does not set the showroom up: the server refuses her.
    const corin = await api("corin");
    const settings = (await rows<{ id: number }>(corin, data, "settings"))[0]!;
    expect((await corin.patch(data("settings", `/${String(settings.id)}`), { data: { values: { showroom_opens: "07:00" } }, headers: await csrf(corin) })).status()).toBe(403);
    const reader = await (await as("grace")).newPage();
    await reader.goto(`${STAFF}settings/working-time`);
    await expect(reader.locator('[data-card="showroom"] [data-figure="showroom-hours"]')).toHaveText("open 10:00 to 17:30");
    await expect(reader.locator('[data-card="showroom"] input')).toHaveCount(0);
  } finally {
    const tessa = await api("tessa");
    const settings = (await rows<{ id: number }>(tessa, data, "settings"))[0]!;
    expect((await tessa.patch(data("settings", `/${String(settings.id)}`), { data: { values: { showroom_opens: "09:00" } }, headers: await csrf(tessa) })).status()).toBe(200);
  }
});
