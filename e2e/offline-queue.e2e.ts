/**
 * Plan 68 S19, THE CREW'S OFFLINE QUEUE (stage 3), as Yusuf Adeyemi of Blue
 * crew on a phone 390 wide. On each phone screen the signal goes mid-save
 * (`context.setOffline(true)`): the save is kept on the phone (with its retry
 * key and its files), the screen says so and shows it with "Waiting to send",
 * and once the signal is back it is sent, in order, and makes exactly one row;
 * no file is left on the server that no row names.
 *
 *  - My day: Arrived and Done on site with no signal; taking a waiting tick
 *    back asks first; sign-out asks first; the lines live through a reload
 *    while nothing gets through; back online, both ticks are in.
 *  - Snags: a put-right and a new snag, each with a photo, kept and sent once;
 *    a put-right refused on arrival (the office put it right first) says who
 *    and when, and is removed from the phone only after asking.
 *  - My vehicle: a fuel fill ("Distance when sent") and a fault with a photo.
 *  - My hours: a day of a week with no sheet yet, and the week sent: the week
 *    made first, then its day, then its sending.
 *  - Sign off the job: signed with no signal while the office raises a snag
 *    that stops it; back online the sign-off is refused, the crew is told why
 *    (and in Arabic, the list), the checks and photo stay on the phone, the
 *    signature and the server's copies of the files go, the phone writes the
 *    refusal down, and the office sees it on Sign-off and in the bell.
 *
 * What it writes is named "Spec offline:" and taken away at the end; J-07's
 * stopping snag is lent out of the way for the sign-off and put back.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { request, type APIRequestContext, type BrowserContext, type Page, type Request } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { readState, STAND_DIR } from "./stand.mjs";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const RETURN_VISIT = 12;
const J07_VISIT = 7;
const TODAY = "2026-07-28";
const SAMPLE_WEEK = "2026-07-20";

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
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) raw.set([x * 9, y * 9, 160], y * (size * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let owner: APIRequestContext | null = null;
async function asOwner(): Promise<APIRequestContext> {
  if (owner !== null) return owner;
  const state = readState()!;
  const file = join(STAND_DIR, "auth", "owner-cleanup.json");
  owner = await request.newContext({ baseURL: state.url, ...(existsSync(file) ? { storageState: file } : {}) });
  if (!existsSync(file)) {
    const res = await owner.post("/api/v1/auth/login", { data: { email: state.owner.email, password: state.owner.password } });
    expect(res.status(), await res.text()).toBe(200);
    await owner.storageState({ path: file });
  }
  return owner;
}

/** Take rows away as the install's owner. */
async function takeAway(data: Data, ref: string, condition: unknown): Promise<void> {
  const me = await asOwner();
  const headers = await csrf(me);
  for (const row of await rows<{ id: number }>(me, data, ref, condition)) expect((await me.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status(), `${ref} ${String(row.id)}`).toBeLessThan(300);
}

/** Every request to the file doors, as it ended. */
function files(page: Page): { method: string; url: string; status: number | null }[] {
  const seen: { method: string; url: string; status: number | null }[] = [];
  page.on("requestfinished", (req: Request) => {
    if (/\/api\/v1\/files(\/|\?|$)/.test(req.url())) void req.response().then((res) => seen.push({ method: req.method(), url: req.url(), status: res?.status() ?? null }));
  });
  return seen;
}

const pill = (page: Page) => page.getByTestId("queue-pill");
const toast = (page: Page) => page.locator(".crm-toast").last();
const offline = async (context: BrowserContext, page: Page): Promise<void> => {
  await context.setOffline(true);
  await expect(page.getByTestId("cw-signal")).toHaveText("No signal. What you save is kept on this phone and sent when you are back online.");
};

/** The connection problems a spec that drops the line causes on purpose, and nothing else. */
const real = (problems: string[]): string[] => problems.filter((line) => !/ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_CONNECTION|Failed to load resource|NetworkError|Failed to fetch/.test(line));

test.skip(({ stand }) => !stand.parts.includes("fleet"), "the crew's phone screens are all in stage 3");

test("My day: two ticks kept with no signal; a waiting tick taken back and sign-out both ask first; the lines live through a reload; back online both are in, once", async ({ as, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  const yusuf = context.request;
  try {
    await page.goto(`${STAFF}my-day/2026-08-04`);
    const card = page.locator(`[data-visit="${String(RETURN_VISIT)}"]`);
    await expect(card.getByTestId("cw-ticked")).toHaveText("0 of 4 ticked");
    await expect(page.getByTestId("cw-signal")).toHaveCount(0);
    await expect(pill(page)).toHaveCount(0);

    await offline(context, page);
    await card.locator('button[data-tick="tick_arrived"]').click();
    await expect(toast(page)).toHaveText("Kept on this phone. It goes when you have signal.");
    await card.locator('button[data-tick="tick_done"]').click();
    await expect(card.locator('button[data-tick="tick_arrived"]')).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator('button[data-tick="tick_done"]')).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator('button[data-tick="tick_done"]').getByTestId("queue-chip")).toHaveText("Waiting to send");
    await expect(card.getByTestId("cw-ticked")).toHaveText("2 of 4 ticked");
    await expect(page.getByRole("button", { name: "2 waiting. Open the list of what is waiting to send." })).toBeVisible();
    await expect(page.getByTestId("queue-row")).toContainText("2 saves on this phone, oldest first");
    await picture(page, "s19-1-my-day-kept");

    // Taking back a tick that only waits on the phone asks first; "Keep it" keeps it.
    await card.locator('button[data-tick="tick_arrived"]').click();
    const confirm = page.locator('[data-dialog="queue-remove"]');
    await expect(confirm).toContainText("Remove from this phone?");
    await expect(confirm).toContainText("It has not been sent.");
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(card.locator('button[data-tick="tick_arrived"]')).toHaveAttribute("aria-pressed", "true");

    // The list: oldest first, numbered, each "Waiting", and a line opened says what it holds.
    await page.getByTestId("queue-row").click();
    const sheet = page.locator('[data-dialog="queue"]');
    await expect(sheet.locator(".crm-q-line-title")).toHaveText(["Arrived · Cobalt Legal", "Done on site · Cobalt Legal"]);
    await expect(sheet.locator(".crm-q-line .crm-pill")).toHaveText(["Waiting", "Waiting"]);
    await sheet.locator(".crm-q-line-btn").nth(1).click();
    await expect(sheet.getByTestId("queue-line")).toContainText("Number 2 to send");
    await expect(sheet.getByTestId("queue-line")).toContainText("Done on site: ticked");
    await expect(sheet.getByTestId("queue-line")).toContainText("Nothing here can be changed. It goes as it is.");
    await sheet.getByRole("button", { name: "Close" }).first().click();

    // Sign-out asks first while saves wait on the phone; he stays.
    await page.getByRole("button", { name: "Open the menu" }).click();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Sign out" }).click();
    const out = page.locator('[data-dialog="queue-signout"]');
    await expect(out).toContainText("2 saves are waiting on this phone. Signing out throws them away.");
    await out.getByRole("button", { name: "Stay signed in" }).click();
    await expect(out).toHaveCount(0);

    // The phone says it has signal while nothing gets through, and the app is opened again: the lines are still there.
    await page.route("**/api/v1/data/**", (route) => route.abort("connectionreset"));
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole("button", { name: "2 waiting. Open the list of what is waiting to send." })).toBeVisible();
    expect((await rows<{ tick_arrived: boolean; tick_done: boolean }>(yusuf, data, "job_visits", { column: "id", op: "eq", value: RETURN_VISIT }))[0]).toMatchObject({ tick_arrived: false, tick_done: false });

    // It gets through again: both go, in order, once each, and the phone says so.
    await page.unroute("**/api/v1/data/**");
    await expect(toast(page)).toHaveText("2 sent.", { timeout: 40_000 });
    await expect(pill(page)).toHaveCount(0);
    expect((await rows<{ tick_arrived: boolean; tick_done: boolean }>(yusuf, data, "job_visits", { column: "id", op: "eq", value: RETURN_VISIT }))[0]).toMatchObject({ tick_arrived: true, tick_done: true });
    await expect(card.getByTestId("cw-ticked")).toHaveText("2 of 4 ticked");
    // Sent lines stay in the list, greyed, until the end of the day.
    await page.getByTestId("queue-row").click();
    await expect(page.locator('[data-dialog="queue"] .crm-q-line .crm-pill')).toHaveText(["Sent", "Sent"]);
    await expect(page.locator('[data-dialog="queue"]')).toContainText("Lines sent stay here, greyed, until the end of the day.");
    expect(real(problems)).toEqual([]);
  } finally {
    await context.setOffline(false);
    await page.unroute("**/api/v1/data/**").catch(() => undefined);
    await yusuf.patch(data("job_visits", `/${String(RETURN_VISIT)}`), { data: { values: { tick_arrived: false, tick_done: false } }, headers: await csrf(yusuf) });
  }
});

test("Snags: a put-right and a new snag kept with their photos, each sent once; a put-right the office beat says who and when, and goes only after asking", async ({ as, api, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  const sent = files(page);
  const ada = await api("ada");
  const adaHeaders = await csrf(ada);
  try {
    const make = async (text: string): Promise<number> => {
      const res = await ada.post(data("snags"), { data: { values: { visit_id: RETURN_VISIT, text, stops_sign_off: false } }, headers: adaHeaders });
      expect(res.status(), await res.text()).toBe(201);
      return ((await res.json()) as { data: { id: number } }).data.id;
    };
    const fix = await make("Spec offline: scuffed skirting");
    const beaten = await make("Spec offline: door closer stiff");

    await page.goto(`${STAFF}my-snags`);
    const row = page.locator(`article[data-snag="${String(fix)}"]`);
    await expect(row.locator("h2")).toHaveText("Spec offline: scuffed skirting");
    // The dialog opened with signal, its photo field drawn; the signal goes before the photo is taken.
    await row.getByRole("button", { name: "Put right" }).click();
    const dialog = page.getByRole("dialog", { name: "Put right" });
    await expect(dialog.locator('[data-testid="kit-photos-input"]')).toHaveCount(1);
    await offline(context, page);
    await dialog.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "skirting.png", mimeType: "image/png", buffer: photoPng() });
    await dialog.getByLabel("What you did").fill("Touched up the paint");
    await dialog.getByRole("button", { name: "Put right" }).click();
    await expect(toast(page)).toHaveText("Kept on this phone. It goes when you have signal.");
    await expect(row).toHaveAttribute("data-state", "put-right");
    await expect(row.getByTestId("queue-chip")).toHaveText("Waiting to send");
    await expect(row.getByRole("button", { name: "Put right" })).toHaveCount(0);

    // The second: the office puts it right first, from her desk, while his phone has no signal.
    const other = page.locator(`article[data-snag="${String(beaten)}"]`);
    await other.getByRole("button", { name: "Put right" }).click();
    await dialog.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "closer.png", mimeType: "image/png", buffer: photoPng() });
    await dialog.getByLabel("What you did").fill("Adjusted the closer");
    await dialog.getByRole("button", { name: "Put right" }).click();
    await expect(page.getByRole("button", { name: "2 waiting. Open the list of what is waiting to send." })).toBeVisible();
    expect((await ada.post(data("snags", `/${String(beaten)}/actions/put-right`), { data: { from: "open", values: { put_right_note: "Done from the office" } }, headers: adaHeaders })).status()).toBe(200);
    expect(sent).toEqual([]);

    // Back: the first goes (its photo once), the second is refused, and says who put it right and when.
    await context.setOffline(false);
    await expect(toast(page)).toHaveText("1 sent. 1 was refused: see why.", { timeout: 30_000 });
    const fixed = (await rows<{ state: string; put_right_note: string; put_right_photo: string | null }>(ada, data, "snags", { column: "id", op: "eq", value: fix }))[0]!;
    expect([fixed.state, fixed.put_right_note, fixed.put_right_photo?.startsWith("file_")]).toEqual(["put-right", "Touched up the paint", true]);
    await expect(other.getByTestId("queue-refused")).toContainText(/^Not saved\. Ada Novak marked “Spec offline: door closer stiff” put right at \d{2}:\d{2}, before this arrived\./);
    expect((await rows<{ put_right_note: string }>(ada, data, "snags", { column: "id", op: "eq", value: beaten }))[0]!.put_right_note).toBe("Done from the office");
    await expect(page.getByRole("button", { name: "1 refused. Open the list of what is waiting to send." })).toBeVisible();
    // Two photos went up; the refused one's was thrown away again: no file is left that no row names.
    await expect.poll(() => sent.filter((one) => one.method === "POST" && one.status === 201).length).toBe(2);
    await expect.poll(() => sent.filter((one) => one.method === "DELETE" && one.status !== null && one.status < 300).length).toBe(1);
    const deleted = sent.find((one) => one.method === "DELETE")!;
    expect((await context.request.get(`${new URL(deleted.url).pathname}/content`)).status()).toBe(404);
    await picture(page, "s19-2-snags-refused");

    // Off the phone, after asking.
    await pill(page).click();
    const sheet = page.locator('[data-dialog="queue"]');
    await sheet.locator('.crm-q-line[data-state="refused"] .crm-q-line-btn').click();
    await expect(sheet.getByTestId("queue-line")).toContainText("Remove it from this phone; save it again if it still holds.");
    await sheet.getByTestId("queue-remove").click();
    const confirm = page.locator('[data-dialog="queue-remove"]');
    await expect(confirm).toContainText("The office never had it.");
    await confirm.getByTestId("queue-remove-go").click();
    await expect(toast(page)).toHaveText("Removed from this phone.");
    await expect(pill(page)).toHaveCount(0);

    // A new snag raised with no signal on the visit's card, photo and all: kept, listed as new, sent once.
    await page.goto(`${STAFF}my-day/2026-08-04`);
    const card = page.locator(`[data-visit="${String(RETURN_VISIT)}"]`);
    const add = card.getByTestId("cw-add-snag");
    await expect(add.locator('[data-testid="kit-photos-input"]')).toHaveCount(1);
    await offline(context, page);
    await add.getByLabel("Add a snag").fill("Spec offline: loose handle");
    await add.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "handle.png", mimeType: "image/png", buffer: photoPng() });
    await expect(add).toContainText("1 of 1");
    await add.getByRole("button", { name: "Add the snag" }).click();
    await expect(card.getByTestId("cw-visit-new-snags")).toContainText("Spec offline: loose handle");
    expect(await rows(ada, data, "snags", { column: "text", op: "eq", value: "Spec offline: loose handle" })).toEqual([]);
    await context.setOffline(false);
    await expect(toast(page)).toHaveText("1 sent.", { timeout: 30_000 });
    const made = await rows<{ photo: string | null; visit_id: number }>(ada, data, "snags", { column: "text", op: "eq", value: "Spec offline: loose handle" });
    expect(made.map((one) => [one.visit_id, one.photo?.startsWith("file_")])).toEqual([[RETURN_VISIT, true]]);
    await expect.poll(() => sent.filter((one) => one.method === "POST" && one.status === 201).length).toBe(3);
    expect(real(problems)).toEqual([]);
  } finally {
    await context.setOffline(false);
    await takeAway(data, "snags", { column: "text", op: "like", value: "Spec offline:%" });
  }
});

test("My vehicle: a fuel fill and a fault with a photo kept with no signal, the fill's distance worked out once it is sent; one of each", async ({ as, api, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  const sent = files(page);
  const ada = await api("ada");
  const takeVan = async (): Promise<void> => {
    const headers = await csrf(ada);
    for (const [ref, condition] of [
      ["vehicle_faults", { column: "text", op: "like", value: "Spec offline:%" }],
      ["fuel_fills", { column: "day", op: "eq", value: TODAY }],
    ] as const) {
      for (const row of await rows<{ id: number }>(ada, data, ref, condition)) expect((await ada.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
  };
  try {
    await page.goto(`${STAFF}my-vehicle`);
    await expect(page.getByTestId("fl-my-reading")).toHaveText("118,420 km");
    // The photo field is drawn (Adminium's part, loaded with signal) before the signal goes.
    await expect(page.getByTestId("fl-my-fault").locator('[data-testid="kit-photos-input"]')).toHaveCount(1);
    await offline(context, page);
    const fill = page.getByTestId("fl-my-fill");
    await fill.getByLabel("Litres").fill("41.2");
    await fill.getByLabel(/^What it cost/).fill("60.15");
    await fill.getByLabel(/Odometer/).fill("118655");
    await page.getByTestId("fl-my-fill-go").click();
    await expect(toast(page)).toHaveText("Kept on this phone. It goes when you have signal.");
    await expect(page.getByTestId("fl-my-fill-kept")).toContainText("Distance when sent");
    await expect(page.getByTestId("fl-my-fill-kept").getByTestId("queue-chip")).toHaveText("Waiting to send");
    // The low-reading warning reads the fill waiting on the phone too.
    await fill.getByLabel(/Odometer/).fill("118500");
    await expect(fill.locator("#crm-fl-my-below")).toContainText("118,655");
    await fill.getByLabel(/Odometer/).fill("");

    const fault = page.getByTestId("fl-my-fault");
    await fault.getByLabel("What is wrong").fill("Spec offline: passenger mirror cracked");
    await fault.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "mirror.png", mimeType: "image/png", buffer: photoPng() });
    await expect(fault).toContainText("1 of 1");
    await page.getByTestId("fl-my-fault-go").click();
    await expect(page.getByTestId("fl-my-faults-kept")).toContainText("Spec offline: passenger mirror cracked");
    await expect(page.getByRole("button", { name: "2 waiting. Open the list of what is waiting to send." })).toBeVisible();
    await picture(page, "s19-3-my-vehicle-kept");
    expect(await rows(ada, data, "fuel_fills", { column: "day", op: "eq", value: TODAY })).toEqual([]);

    await context.setOffline(false);
    await expect(toast(page)).toHaveText("2 sent.", { timeout: 30_000 });
    const fills = await rows<{ litres: number; odometer: number; distance: number | null }>(ada, data, "fuel_fills", { column: "day", op: "eq", value: TODAY });
    expect(fills.map((one) => [Number(one.litres), Number(one.odometer), Number(one.distance)])).toEqual([[41.2, 118655, 235]]);
    const faults = await rows<{ photo: string | null }>(ada, data, "vehicle_faults", { column: "text", op: "like", value: "Spec offline:%" });
    expect(faults.map((one) => one.photo?.startsWith("file_"))).toEqual([true]);
    expect(sent.filter((one) => one.method === "POST").length).toBe(1);
    await expect(page.getByTestId("fl-my-reading")).toHaveText("118,655 km");
    expect(real(problems)).toEqual([]);
  } finally {
    await context.setOffline(false);
    await takeVan();
  }
});

test("My hours: a day of a week with no sheet yet, and the week sent for sign-off, kept with no signal: the week is made first, then its day, then it is sent", async ({ as, api, stand, data }) => {
  const yusufId = stand.people["f_yusuf"]!.id;
  const ada = await api("ada");
  const dayOf = (value: string): string => value.slice(0, 10);
  const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  // A week of his no other spec reads: the first free one six weeks before the sample's.
  const taken = new Set((await rows<{ week_of: string }>(ada, data, "time_sheets", { column: "user_id", op: "eq", value: yusufId })).map((row) => dayOf(row.week_of)));
  let week = addDays(SAMPLE_WEEK, -42);
  while (taken.has(week)) week = addDays(week, -7);
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}my-hours/${week}`);
    await expect(page.getByTestId("hr-mh-empty")).toBeVisible();
    await offline(context, page);
    await page.getByRole("button", { name: "Add a day" }).click();
    const dialog = page.locator('[data-dialog="hr-line"]');
    await dialog.getByLabel("What you did").fill("Spec offline: depot, loaded for a return visit");
    await dialog.getByLabel("Hours on site").fill("6");
    await dialog.getByLabel("Hours of travel").fill("1");
    await dialog.getByTestId("hr-line-save").click();
    await expect(toast(page)).toHaveText("Kept on this phone. The office gets it when this phone has signal.");
    await expect(page.getByTestId("hr-mh-kept")).toContainText("Spec offline: depot, loaded for a return visit");
    await page.getByTestId("hr-mh-send").click();
    await expect(page.getByTestId("hr-mh-kept-send")).toContainText("Waiting to send: the office gets it when this phone has signal.");
    // Two of his saves wait (the week itself is the phone's own line, not listed).
    await expect(page.getByRole("button", { name: "2 waiting. Open the list of what is waiting to send." })).toBeVisible();
    await picture(page, "s19-4-my-hours-kept");
    expect(await rows(ada, data, "time_sheets", { and: [{ column: "user_id", op: "eq", value: yusufId }, { column: "week_of", op: "eq", value: week }] })).toEqual([]);

    await context.setOffline(false);
    await expect(toast(page)).toHaveText("2 sent.", { timeout: 30_000 });
    const sheets = await rows<{ id: number; state: string }>(ada, data, "time_sheets", { and: [{ column: "user_id", op: "eq", value: yusufId }, { column: "week_of", op: "eq", value: week }] });
    expect(sheets.map((one) => one.state)).toEqual(["sent"]);
    const lines = await rows<{ hours: number; what: string }>(ada, data, "time_sheet_lines", { column: "sheet_id", op: "eq", value: sheets[0]!.id });
    expect(lines.map((one) => [one.what, Number(one.hours)])).toEqual([["Spec offline: depot, loaded for a return visit", 6]]);
    await expect(page.getByTestId("hr-mh-state")).toHaveText("Sent");
    expect(real(problems)).toEqual([]);
  } finally {
    await context.setOffline(false);
    const sheets = await rows<{ id: number; state: string }>(ada, data, "time_sheets", { and: [{ column: "user_id", op: "eq", value: yusufId }, { column: "week_of", op: "eq", value: week }] });
    for (const sheet of sheets) {
      // A sent week is locked: the office sends it back first, then the owner takes it away.
      if (sheet.state === "sent") expect((await ada.post(data("time_sheets", `/${String(sheet.id)}/actions/send-back`), { data: { from: "sent", values: { sent_back_note: "Spec offline: taken away" } }, headers: await csrf(ada) })).status()).toBe(200);
      await takeAway(data, "time_sheet_lines", { column: "sheet_id", op: "eq", value: sheet.id });
      await takeAway(data, "time_sheets", { column: "id", op: "eq", value: sheet.id });
    }
  }
});

test("Sign off the job with no signal, while the office raises a snag that stops it: refused on arrival, told to the crew (in Arabic too) and to the office; the checks and photo kept, the signature and the server's files gone", async ({ as, api, data, stand }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  const sent = files(page);
  const ada = await api("ada");
  const adaHeaders = await csrf(ada);
  const job = (await rows<{ id: number }>(ada, data, "jobs", { column: "code", op: "eq", value: "J-07" }))[0]!.id;
  const trays = (await rows<{ id: number }>(ada, data, "snags", { column: "text", op: "eq", value: "Cable trays short by two metres" }))[0]!.id;
  try {
    // J-07's stopping snag is lent out of the way, so his sign-off can be made at all.
    expect((await ada.patch(data("snags", `/${String(trays)}`), { data: { values: { stops_sign_off: false } }, headers: adaHeaders })).status()).toBe(200);
    await page.goto(`${STAFF}sign-off-the-job/${String(J07_VISIT)}`);
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("Still needed: 5 checks, the customer’s name, their signature.");
    for (const check of await page.locator("button[data-check]").all()) await check.click();
    await page.getByRole("button", { name: "Use Yusuf Demir" }).click();
    const customer = page.getByTestId("cw-sign-customer");
    await customer.getByRole("button", { name: "Type the name instead" }).click();
    await customer.getByLabel("Name, as the signature").fill("Yusuf Demir");
    await offline(context, page);
    await customer.getByRole("button", { name: "Keep this signature" }).click();
    await expect(customer.getByRole("button", { name: "Sign again" })).toBeVisible();
    await page.getByTestId("cw-sign-photos").locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "benches.png", mimeType: "image/png", buffer: photoPng() });
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("Ready to sign off.");
    await page.getByTestId("cw-sign-go").click();
    await expect(page.getByTestId("cw-sign-kept")).toBeVisible();
    await expect(page.getByTestId("cw-kept-by")).toContainText("Signed by Yusuf Demir, ");
    await expect(page.getByTestId("cw-kept-line")).toHaveText("Waiting to send: the office gets it when this phone has signal.");
    expect(sent).toEqual([]);
    await picture(page, "s19-5-signed-on-this-phone");

    // Meanwhile the office raises a snag that stops it.
    const stopper = await ada.post(data("snags"), { data: { values: { visit_id: J07_VISIT, text: "Spec offline: floor boxes not fixed down in bay 3", stops_sign_off: true, raised_by_id: stand.people["ada"]!.id } }, headers: adaHeaders });
    expect(stopper.status(), await stopper.text()).toBe(201);

    // The signal comes back: refused on arrival.
    await context.setOffline(false);
    await expect(toast(page)).toHaveText("1 was refused: see why.", { timeout: 30_000 });
    const refused = page.getByTestId("queue-refused");
    await expect(refused).toContainText(/^Not signed off\. While you had no signal, Ada Novak raised a snag that stops it: “Spec offline: floor boxes not fixed down in bay 3” \(\d{2}:\d{2}\)\. Put it right, then the customer signs again\./);
    await expect(page.getByTestId("cw-refused-kept")).toHaveText("The five checks and the 1 photo are still on this phone. The signature was not kept: the customer signs for what is true when they sign.");
    await expect(page.locator('button[data-check][aria-checked="true"]')).toHaveCount(5);
    await expect(page.getByLabel("Their name")).toHaveValue("Yusuf Demir");
    await expect(page.getByTestId("cw-held-photos").locator("img")).toHaveCount(1);
    await expect(customer.getByRole("button", { name: "Keep this signature" })).toBeVisible();
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("“Spec offline: floor boxes not fixed down in bay 3” stops the sign-off. Put it right first.");
    expect(await rows(ada, data, "sign_offs", { column: "job_id", op: "eq", value: job })).toEqual([]);
    // Both files went up with it and were thrown away again: none is left that no row names.
    await expect.poll(() => sent.filter((one) => one.method === "POST" && one.status === 201).length).toBe(2);
    await expect.poll(() => sent.filter((one) => one.method === "DELETE" && one.status !== null && one.status < 300).length).toBe(2);
    for (const gone of sent.filter((one) => one.method === "DELETE")) expect((await context.request.get(`${new URL(gone.url).pathname}/content`)).status()).toBe(404);
    await picture(page, "s19-6-refused-on-arrival");

    // The phone wrote the refusal down: who signed, on whose phone, when, and the snag; no checks, photo or signature.
    const records = await rows<Record<string, unknown>>(ada, data, "refused_sign_offs", { column: "job_id", op: "eq", value: job });
    expect(records.map((one) => [one["signer_name"], one["by_id"], one["snag_text"], one["snag_by_id"], one["site_name"]])).toEqual([["Yusuf Demir", stand.people["f_yusuf"]!.id, "Spec offline: floor boxes not fixed down in bay 3", stand.people["ada"]!.id, "Tandem Robotics"]]);
    expect(Object.keys(records[0]!).some((column) => /check|photo|signature/.test(column))).toBe(false);

    // My day says it too, with the way to the snag and to sign off again.
    await page.goto(`${STAFF}my-day/2026-07-21`);
    const card = page.locator(`[data-visit="${String(J07_VISIT)}"]`);
    await expect(card.getByTestId("queue-refused")).toContainText("While you had no signal, Ada Novak raised a snag that stops it");
    await expect(card.getByRole("link", { name: "Sign off the job" })).toBeVisible();

    // The list, in Arabic, right to left: the refused line and why.
    await inArabic(context.request, async () => {
      await page.reload();
      await pill(page).click();
      const sheet = page.locator('[data-dialog="queue"]');
      await expect(sheet.getByRole("heading", { name: "بانتظار الإرسال" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
      await sheet.locator('.crm-q-line[data-state="refused"] .crm-q-line-btn').click();
      await expect(sheet.getByTestId("queue-refused")).toContainText("لم يتم الاستلام. بينما لم تكن لديك إشارة");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await picture(page, "s19-7-list-arabic");
    });

    // The office: Refused on arrival on Sign-off, in The other jobs, and in the bell.
    const desk = await as("ada");
    const office = await desk.newPage();
    const officeProblems = watch(office);
    await office.goto(`${STAFF}sign-off/${String(job)}`);
    await expect(office.getByTestId("jb-so-state")).toHaveText("Refused on arrival");
    await expect(office.getByTestId("jb-so-refused")).toContainText(/^Yusuf Demir signed on Yusuf Adeyemi’s phone at .+\. It reached us at .+ and was refused: “Spec offline: floor boxes not fixed down in bay 3” \(raised by Ada Novak at .+\) stops sign-off\./);
    await expect(office.getByTestId("jb-so-refused")).toContainText("No signature picture is held: none is kept when a sign-off is refused.");
    await expect(office.getByTestId("jb-so-card")).toContainText("No photos are held: they come with the next sign-off.");
    await picture(office, "s19-8-office-refused");
    const toldTitle = "A sign-off was refused on arrival: Tandem Robotics";
    await expect.poll(async () => ((await ada.get("/api/v1/me/notifications?limit=100").then((res) => res.json())) as { data: { items: { title: string }[] } }).data.items.filter((item) => item.title === toldTitle).length, { timeout: 60_000 }).toBeGreaterThan(0);
    // At 390 wide too, as the operations manager on her phone.
    await office.setViewportSize({ width: 390, height: 844 });
    await expect(office.getByTestId("jb-so-refused")).toBeVisible();
    await expect.poll(() => office.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Another job's page names J-07 "Refused" among the other jobs, and no other job so.
    const j01 = (await rows<{ id: number }>(ada, data, "jobs", { column: "code", op: "eq", value: "J-01" }))[0]!.id;
    await office.goto(`${STAFF}sign-off/${String(j01)}`);
    await expect(office.locator(`.crm-jb-others button[data-job="${String(job)}"]`).getByTestId("jb-so-other-refused")).toHaveText("Refused");
    await expect(office.getByTestId("jb-so-other-refused")).toHaveCount(1);
    expect(real([...problems, ...officeProblems])).toEqual([]);
  } finally {
    await context.setOffline(false);
    await takeAway(data, "refused_sign_offs", { column: "job_id", op: "eq", value: job });
    await takeAway(data, "snags", { column: "text", op: "like", value: "Spec offline:%" });
    expect((await ada.patch(data("snags", `/${String(trays)}`), { data: { values: { stops_sign_off: true } }, headers: adaHeaders })).status()).toBe(200);
  }
});
