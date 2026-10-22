/**
 * P25-A, the crew's own vehicle on his phone (stage 3): "My vehicle", reached
 * from My day and from his menu: the walk-round before the day, a fault with
 * a photo, a fuel fill. Signed in as Yusuf Adeyemi (Blue crew, given the Blue
 * van), on a phone 390 wide. Run on a stand of stage 3 (`CRM_STAND_STAGE=3`).
 *
 * Every "may not" is the server's refusal, asked directly as him: another
 * crew's van is not there for him, and nothing he makes can name it. A reply
 * lost on its way back is staged on a fill (the same key answers the row the
 * first one made), and a check that gets nowhere kept on the phone and sent
 * by itself (plan 68 S19). What he reports shows on
 * the operations manager's open Vehicles screen without a reload. Everything
 * the spec writes is taken away, so the van's reading is the ledger's again.
 */
import { deflateSync } from "node:zlib";

import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const TODAY = "2026-07-28";

/** A small PNG, a few colours wide: what a phone's camera hands the photo field. */
function photoPng(): Buffer {
  const crc = (bytes: Buffer): number => {
    let c = ~0;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, body: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type), body]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(typed));
    return Buffer.concat([length, typed, sum]);
  };
  const size = 24;
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8;
  head[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) raw.set([x * 10, y * 10, 120], y * (size * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const narrowEnough = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function axe(page: Page): Promise<string[]> {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((one) => one.effect?.getTiming().iterations !== Infinity).map((one) => one.finished.catch(() => undefined))), new Promise((done) => setTimeout(done, 3000))]));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((one) => `${one.impact ?? "?"} ${one.id}: ${one.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(" | ")}`);
}

const vanId = async (person: APIRequestContext, data: Data, name: string): Promise<number> => (await rows<{ id: number }>(person, data, "vehicles", { column: "name", op: "eq", value: name }))[0]!.id;

/** Take away what the spec made on a day, as the operations manager: today's checks, the spec's faults, today's fills. */
async function takeAway(ada: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(ada);
  const gone = async (ref: string, condition: unknown): Promise<void> => {
    for (const row of await rows<{ id: number }>(ada, data, ref, condition)) expect((await ada.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status(), `${ref} ${String(row.id)}`).toBeLessThan(300);
  };
  await gone("vehicle_checks", { column: "day", op: "eq", value: TODAY });
  await gone("vehicle_faults", { column: "text", op: "like", value: "Spec fleet phone:%" });
  await gone("fuel_fills", { column: "day", op: "eq", value: TODAY });
}

test.skip(({ stand }) => !stand.parts.includes("fleet"), "Vehicles and crew is not in this stand's stage");

test("My vehicle: his crew's van only, from My day and his menu; the check before the day; a fault with a photo, live on the office's Vehicles; a fill whose reply is lost is one fill; another van refused by the server", async ({ as, api, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  const ada = await api("ada");
  const yusuf = context.request;
  const blue = await vanId(ada, data, "Blue van");
  const red = await vanId(ada, data, "Red van");
  try {
    await page.goto(STAFF);
    await expect(page).toHaveURL(/\/my-day$/);
    // His menu: the two of stage 2, then his vehicle, his hours and his certificates (stage 3).
    await page.getByRole("button", { name: "Open the menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("navigation", { name: "Menu" }).getByRole("link")).toHaveText(["My day", "Snags", "My vehicle", "My hours", "My certificates"]);
    await page.keyboard.press("Escape");
    // From My day, one press.
    await page.getByRole("link", { name: "My vehicle: its check, a fault, a fuel fill" }).click();
    await expect(page).toHaveURL(/\/my-vehicle$/);
    await expect(page.getByTestId("fl-my-name")).toHaveText("Blue van");
    await expect(page.getByTestId("fl-my-reading")).toHaveText("118,420 km");
    await expect(page.locator(".crm-chips")).toHaveCount(0);

    // The server: his crew's van is the one there is for him; Red's is not there, and nothing he makes may name it.
    expect((await rows<{ id: number }>(yusuf, data, "vehicles")).map((one) => one.id)).toEqual([blue]);
    expect((await yusuf.get(data("vehicles", `/${String(red)}`))).status()).toBe(404);
    const headers = await csrf(yusuf);
    for (const [ref, values] of [
      ["vehicle_checks", { vehicle_id: red, day: TODAY, tyres: true, fluids: true, lights: true, straps: true, tail_lift: true }],
      ["vehicle_faults", { vehicle_id: red, text: "Spec fleet phone: not mine" }],
      ["fuel_fills", { vehicle_id: red, day: TODAY, litres: 10, cost: 15, odometer: 99_000 }],
    ] as const) {
      const refused = await yusuf.post(data(ref), { data: { values }, headers });
      expect(refused.status(), `${ref}: ${await refused.text()}`).toBe(409);
    }

    // The check before the day, where nothing gets through though the phone says it has signal (plan 68 S19): kept on the
    // phone, "No signal" said, nothing saved; sent by itself once a request gets through again.
    const check = page.getByTestId("fl-my-check");
    for (const tick of ["Tyres", "Fluids", "Lights", "Straps"]) await check.getByRole("checkbox", { name: tick }).click();
    await expect(page.getByTestId("fl-my-ticked")).toHaveText("4 of 5 ticked");
    await page.route("**/api/v1/data/**", (route) => (route.request().method() === "POST" && /crm_vehicle_checks$/.test(new URL(route.request().url()).pathname) ? route.abort("internetdisconnected") : route.fallback()));
    await page.getByTestId("fl-my-check-go").click();
    await expect(page.getByTestId("cw-signal")).toContainText("No signal. What you save is kept on this phone and sent when you are back online.", { timeout: 15_000 });
    await expect(page.getByTestId("fl-my-check-kept")).toContainText("4 of 5 checked.");
    expect(await rows(yusuf, data, "vehicle_checks", { column: "day", op: "eq", value: TODAY })).toEqual([]);
    await page.unroute("**/api/v1/data/**");
    await expect(page.locator(".crm-toast").last()).toHaveText("1 sent.", { timeout: 30_000 });
    await expect(page.getByTestId("fl-my-checked")).toHaveText("Checked Tue, Jul 28 by Yusuf Adeyemi.");
    const checks = await rows<{ by_id: string; tail_lift: boolean; lights: boolean }>(yusuf, data, "vehicle_checks", { column: "day", op: "eq", value: TODAY });
    expect(checks.map((one) => [Boolean(one.lights), Boolean(one.tail_lift)])).toEqual([[true, false]]);
    // Cal, his crew-mate, sees the van was checked today; Rina, of the Red crew, does not.
    expect(await rows(await api("cal"), data, "vehicle_checks", { column: "day", op: "eq", value: TODAY })).toHaveLength(1);
    expect(await rows(await api("rina"), data, "vehicle_checks", { column: "day", op: "eq", value: TODAY })).toHaveLength(0);

    // A fault with a photo, while the operations manager has Vehicles open: hers follows without a reload.
    const office = await as("ada");
    const vehicles = await office.newPage();
    await vehicles.goto(`${STAFF}vehicles`);
    const blueCard = vehicles.locator("[data-vehicle]").filter({ has: vehicles.getByRole("heading", { name: "Blue van", exact: true }) });
    await expect(blueCard.getByTestId("fl-vn-walk")).toHaveText("One thing left: Tail lift");
    await expect(blueCard.getByTestId("fl-vn-faults")).toHaveCount(0);
    const fault = page.getByTestId("fl-my-fault");
    await fault.getByLabel("What is wrong").fill("Spec fleet phone: tail lift sticks halfway");
    await fault.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "lift.png", mimeType: "image/png", buffer: photoPng() });
    await expect(fault.getByTestId("fl-my-fault-go")).toBeEnabled({ timeout: 15_000 });
    await fault.getByTestId("fl-my-fault-go").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Fault on Blue van reported to the office.");
    await expect(fault.getByTestId("fl-my-faults")).toContainText("Spec fleet phone: tail lift sticks halfway");
    const reported = (await rows<{ photo: string | null; raised_by_id: string }>(yusuf, data, "vehicle_faults", { column: "text", op: "like", value: "Spec fleet phone:%" }))[0]!;
    expect(reported.photo?.startsWith("file_")).toBe(true);
    await expect(blueCard.getByTestId("fl-vn-faults")).toContainText("Spec fleet phone: tail lift sticks halfway", { timeout: 15_000 });
    await expect.poll(() => blueCard.locator(".crm-fl-fault-photo").first().evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    // A fill, its reply lost on the way back: the phone sends it again with the same key, and the server answers the first row.
    const fill = page.getByTestId("fl-my-fill");
    await expect(fill.getByTestId("fl-my-lastfill")).toHaveText("Last fill Fri, Jul 24: 33.1 L at 118,420 km.");
    await fill.getByLabel("Litres").fill("35.5");
    await fill.getByLabel("What it cost (GBP)").fill("51.80");
    await fill.getByLabel("Odometer (km)").fill("118,300");
    await expect(fill.getByText("That is less than the vehicle’s last reading, 118,420 km.")).toBeVisible();
    await expect(fill.getByTestId("fl-my-fill-go")).toBeDisabled();
    await fill.getByLabel("Odometer (km)").fill("118,650");
    const sent: { key: string; replayed: boolean | null }[] = [];
    let dropped = false;
    await page.route("**/api/v1/data/**", async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !/crm_fuel_fills$/.test(new URL(req.url()).pathname)) return route.fallback();
      const key = (req.postDataJSON() as { clientKey: string }).clientKey;
      const response = await route.fetch();
      if (!dropped) {
        dropped = true;
        sent.push({ key, replayed: null });
        return route.abort("connectionreset");
      }
      sent.push({ key, replayed: ((await response.json()) as { replayed?: boolean }).replayed === true });
      await route.fulfill({ response });
    });
    await fill.getByTestId("fl-my-fill-go").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Fill saved for Blue van: 230 km since the last.");
    await page.unroute("**/api/v1/data/**");
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
    const fills = await rows<{ odometer: number; prev_odometer: number; distance: number; by_id: string }>(yusuf, data, "fuel_fills", { column: "day", op: "eq", value: TODAY });
    expect(fills.map((one) => [one.odometer, one.prev_odometer, one.distance])).toEqual([[118650, 118420, 230]]);
    // The van's reading is now the fill's, for him and the office.
    await expect(page.getByTestId("fl-my-reading")).toHaveText("118,650 km");
    await expect(blueCard.getByTestId("fl-vn-reading")).toHaveText("118,650 km", { timeout: 15_000 });
    // Made is made: he changes and removes none of it.
    const mine = await rows<{ id: number }>(yusuf, data, "fuel_fills", { column: "day", op: "eq", value: TODAY });
    expect((await yusuf.patch(data("fuel_fills", `/${String(mine[0]!.id)}`), { data: { values: { litres: 1 } }, headers })).status()).toBe(403);
    expect((await yusuf.delete(data("fuel_fills", `/${String(mine[0]!.id)}?confirm=true`), { headers })).status()).toBe(403);
    // No amount but what he typed, no subcontractor, no claim on his phone.
    expect(await page.locator("#crm-page").innerText()).not.toMatch(/Marek|Pallet/);
    expect(await narrowEnough(page)).toBe(true);
    await picture(page, "p25-6-yusuf-my-vehicle");
    expect(problems.filter((line) => !/ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to load resource|NetworkError|Failed to fetch/.test(line))).toEqual([]);
  } finally {
    await takeAway(ada, data);
    // The ledger's reading is back: the last fill's.
    expect((await rows<{ reading: number }>(ada, data, "vehicles", { column: "id", op: "eq", value: blue }))[0]!.reading).toBe(118420);
  }
});

test("My vehicle in Arabic, dark, 390 wide: right to left, it fits, axe finds nothing; light too; and a crew member with no vehicle given is told so", async ({ as, api, data }) => {
  const yusuf = await api("f_yusuf");
  const found: string[] = [];
  await inArabic(yusuf, async () => {
    const context = await as("f_yusuf", { ...PHONE, colorScheme: "dark" });
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}my-vehicle`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("fl-my-name")).toBeVisible();
    expect(await narrowEnough(page)).toBe(true);
    found.push(...(await axe(page)).map((line) => `dark: ${line}`));
    await picture(page, "p25-7-yusuf-arabic-dark");
    expect(problems).toEqual([]);
  });
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  await page.goto(`${STAFF}my-vehicle`);
  await expect(page.getByTestId("fl-my-name")).toBeVisible();
  found.push(...(await axe(page)).map((line) => `light: ${line}`));
  // The ticks go by the keyboard: Tab to one, Space ticks it.
  await page.getByTestId("fl-my-check").getByRole("checkbox", { name: "Tyres" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("fl-my-check").getByRole("checkbox", { name: "Tyres" })).toHaveAttribute("aria-checked", "true");
  expect(found).toEqual([]);

  // The Red crew given no vehicle for a moment: Rina is told her crew has none, and reads no vehicle by any door.
  const ada = await api("ada");
  const headers = await csrf(ada);
  const red = (await rows<{ id: number; vehicle_id: number }>(ada, data, "crews", { column: "name", op: "eq", value: "Red crew" }))[0]!;
  expect((await ada.patch(data("crews", `/${String(red.id)}`), { data: { values: { vehicle_id: null } }, headers })).status()).toBe(200);
  try {
    const rina = await as("rina", PHONE);
    const hers = await rina.newPage();
    await hers.goto(`${STAFF}my-vehicle`);
    await expect(hers.getByTestId("fl-my-none")).toContainText("Your crew has no vehicle yet. The operations manager gives it one.");
    expect(await rows(rina.request, data, "vehicles")).toEqual([]);
  } finally {
    expect((await ada.patch(data("crews", `/${String(red.id)}`), { data: { values: { vehicle_id: red.vehicle_id } }, headers })).status()).toBe(200);
  }
});
