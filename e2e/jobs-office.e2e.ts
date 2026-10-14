/**
 * P20 and P15, Jobs on site at the office (stage 2): the operations manager's
 * home, Deliveries (ledger §33) with its booking dialog in its third use, and
 * the jobs still to make. Run on a stand of stage 2 (`CRM_STAND_STAGE=2`).
 *
 * Who: the operations manager (Ada) books, moves, calls off and adds visits
 * and makes the jobs still to make; the CRM admin (Tessa) does the same;
 * Read-only (Grace) reads Deliveries and presses nothing. Every figure on a
 * screen is compared with what the server answers that person, asked
 * directly; every "may not" is the server's refusal, asked directly as that
 * person. A reply lost on the way back is staged (adding a visit). Everything
 * a spec writes is put back, and every message it set off taken away.
 *
 * The rules of the server itself (e-mails, notices, sign-offs sealed) are
 * proved on three engines in `proofs/crm-jobs.test.ts`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { request, type APIRequestContext, type Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, removeDeals, rows, STAFF, unfoldMenu, watch, type Data } from "./helpers.ts";
import { readState, STAND_DIR, type StandState } from "./stand.mjs";

/** The sample's visits still to come, by id (the ledger's "Deliveries"). */
const V = { cobaltReturn: 12, nordwind: 13, fernway: 14, veldt: 15, tandem: 16, juno: 17, cobaltTopUp: 18, harbor: 19 } as const;
const BLUE = 1;
const RED = 2;

/** A figure asked of the server as this person. */
async function figure(person: APIRequestContext, stand: StandState, descriptor: Record<string, unknown>): Promise<{ value?: number; items?: { key: string | number | null; value?: number; values?: Record<string, number | null> }[] }> {
  const res = await person.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, ...descriptor } }, headers: await csrf(person) });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { result: never }).result;
}
const visits = (filters: unknown[], aggregation: Record<string, unknown> = { fn: "count", alias: "n" }) => ({ source: { name: "crm_job_visits" }, shape: "single-metric", filters, aggregations: [aggregation] });
const BOOKED = { column: "state", op: "eq", value: "booked" };
const WAITING = { column: "state", op: "eq", value: "waiting" };
const TO_COME = { column: "state", op: "in", value: ["waiting", "booked"] };
const WEEK = [{ column: "day", op: "gte", value: "2026-08-03" }, { column: "day", op: "lte", value: "2026-08-09" }];

/** What the server answers this person for Deliveries' own figures, the week of Mon 3 Aug. */
async function served(person: APIRequestContext, stand: StandState) {
  const n = async (descriptor: Record<string, unknown>): Promise<number> => Number((await figure(person, stand, descriptor)).value ?? 0);
  const byDay = await figure(person, stand, { source: { name: "crm_job_visits" }, shape: "categorical", filters: [BOOKED, ...WEEK], groupBy: ["day"], aggregations: [{ fn: "sum", column: "hours", alias: "h" }] });
  return {
    toCome: await n(visits([TO_COME])),
    booked: await n(visits([BOOKED])),
    waiting: await n(visits([WAITING])),
    hours: await n(visits([TO_COME], { fn: "sum", column: "hours", alias: "h" })),
    week: await n(visits([BOOKED, ...WEEK])),
    weekHours: await n(visits([BOOKED, ...WEEK], { fn: "sum", column: "hours", alias: "h" })),
    byDay: Object.fromEntries((byDay.items ?? []).map((item) => [String(item.key).slice(0, 10), Number(item.values?.["h"] ?? item.value)])),
  };
}

let owner: APIRequestContext | null = null;
/** The install's owner, with no page: to take away the messages a spec's bookings set off (no role of the app removes one). */
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

/** The messages a visit set off, as the owner reads the outbox. */
async function messagesOf(data: Data, visitId: number): Promise<{ id: number; kind: string }[]> {
  return rows<{ id: number; kind: string }>(await asOwner(), data, "outbox", { column: "job_visit_id", op: "eq", value: visitId });
}
async function dropMessages(data: Data, visitId: number): Promise<void> {
  const me = await asOwner();
  const headers = await csrf(me);
  for (const one of await messagesOf(data, visitId)) expect((await me.delete(data("outbox", `/${String(one.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
}

/** The messages of a job's visits (a removed visit's keep its job), as the owner reads the outbox. The sample sets off none. */
async function messagesOfJob(data: Data, jobId: number): Promise<{ id: number; kind: string }[]> {
  return rows<{ id: number; kind: string }>(await asOwner(), data, "outbox", { column: "job_id", op: "eq", value: jobId }, "&order=id");
}
async function dropMessagesOfJob(data: Data, jobId: number): Promise<void> {
  const me = await asOwner();
  const headers = await csrf(me);
  for (const one of await messagesOfJob(data, jobId)) expect((await me.delete(data("outbox", `/${String(one.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
}

/** Put a sample visit back as the ledger has it: waiting with no day, or booked on its day. */
async function putBack(person: APIRequestContext, data: Data, id: number, was: { day: string; crew: number; start: string } | null): Promise<void> {
  const headers = await csrf(person);
  const now = (await rows<{ state: string }>(person, data, "job_visits", { column: "id", op: "eq", value: id }))[0]!;
  if (was === null) {
    if (now.state === "booked") expect((await person.post(data("job_visits", `/${String(id)}/actions/back-to-waiting`), { data: { from: "booked" }, headers })).status()).toBe(200);
    expect((await person.patch(data("job_visits", `/${String(id)}`), { data: { values: { day: null, start_time: null, crew_id: null } }, headers })).status()).toBe(200);
  } else {
    expect((await person.patch(data("job_visits", `/${String(id)}`), { data: { values: { day: was.day, start_time: was.start, crew_id: was.crew } }, headers })).status()).toBe(200);
  }
  await dropMessages(data, id);
}

const pill = (page: Page, name: string) => page.locator(`.crm-screen-actions [data-figure="${name}"]`);
const dayColumn = (page: Page, day: string) => page.locator(`[data-testid="jb-week-days"] section[data-day="${day}"]`);
const toBook = (page: Page) => page.locator('[data-testid="jb-tobook"] li[data-visit]');
const narrowEnough = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Jobs on site is a part of stage 2: on a stand of the released stage 1 there is nothing here to try (the whole suite runs there).
test.skip(({ stand }) => !stand.parts.includes("jobs"), "Jobs on site is not in this stand's stage");

test("the operations manager's home: the week's bookings, the visits with no day, the snags in the way, each the server's", async ({ as, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await expect(page.locator('[data-screen="ophome"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Good morning, Ada");
  await unfoldMenu(page);
  const menu = page.getByRole("navigation", { name: "Menu" });
  for (const line of ["Deliveries", "Day sheet", "Route", "Sign-off", "Delivery notes", "Job snag list", "Recycling and disposal"]) await expect(menu.getByRole("link", { name: line, exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Settings" })).toBeVisible();

  const server = await served(context.request, stand);
  // The ledger: three visits booked in the week of 3 August, 17 hours; five with no day.
  expect([server.week, server.weekHours, server.waiting]).toEqual([3, 17, 5]);
  const stopping = Number((await figure(context.request, stand, { source: { name: "crm_snags" }, shape: "single-metric", filters: [{ column: "state", op: "in", value: ["open", "waiting-part"] }, { column: "stops_sign_off", op: "eq", value: true }], aggregations: [{ fn: "count", alias: "n" }] })).value);
  expect(stopping).toBe(2);
  const tile = (name: string) => page.locator(`.crm-jb-stats [data-figure="${name}"]`);
  await expect(tile("week").locator(".crm-kpi-label")).toHaveText("Booked, week of Mon, Aug 3");
  await expect(tile("week").locator("[data-value]")).toHaveText(String(server.week));
  await expect(tile("week").locator(".crm-kpi-sub")).toHaveText(`${String(server.weekHours)} h across 2 crews`);
  await expect(tile("noday").locator("[data-value]")).toHaveText(String(server.waiting));
  await expect(tile("stopping").locator("[data-value]")).toHaveText(String(stopping));
  await expect(tile("still").locator("[data-value]")).toHaveText("0");
  await expect(tile("still").locator(".crm-kpi-sub")).toHaveText("Every won deal has its job");
  // Each crew's week: Red is over its day on Wednesday (9 h of 8), as the server adds it up.
  await expect(page.locator('[data-row="crew-2"]')).toContainText("Wed, Aug 5 is 9 h of 8 h");
  await expect(page.locator('[data-row="crew-1"]')).toContainText("Tue, Aug 4 · J-01 Cobalt Legal · 6 h; Thu, Aug 6 · J-06 Cobalt Legal · 2 h");
  await expect(page.locator('[data-row^="visit-"]')).toHaveCount(server.waiting);
  await expect(page.locator('[data-row^="snag-"]')).toHaveCount(stopping);
  await picture(page, "p20-1-ada-home");
  await page.locator('[data-row="crew-2"] a').click();
  await expect(page).toHaveURL(/\/deliveries\/2026-08-03$/);
  expect(problems).toEqual([]);
});

test("Deliveries as the operations manager: the week of 3 August, its hours by day, the alerts and the visits to book, each the server's", async ({ as, stand, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}deliveries`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deliveries");
  await expect(page.getByTestId("jb-week")).toHaveText("Mon, Aug 3 – Sun, Aug 9");
  const server = await served(context.request, stand);
  expect([server.toCome, server.booked, server.waiting, server.hours]).toEqual([8, 3, 5, 41]);
  expect(server.byDay).toEqual({ "2026-08-04": 6, "2026-08-05": 9, "2026-08-06": 2 });
  await expect(pill(page, "booked")).toHaveText(`${String(server.booked)} booked`);
  await expect(pill(page, "waiting")).toHaveText(`${String(server.waiting)} to book`);
  await expect(page.getByTestId("jb-weeknote")).toHaveText(`${String(server.toCome)} visits to come · ${String(server.hours)} h in all · ${String(server.week)} visits in the week shown · 2 crews, 8 h a day each`);
  // The working days of the week, each with the server's hours.
  await expect(page.locator('[data-testid="jb-week-days"] section')).toHaveCount(5);
  for (const day of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]) {
    await expect(dayColumn(page, day).locator('[data-figure="day-hours"]')).toHaveAttribute("data-hours", String(server.byDay[day] ?? 0));
  }
  await expect(dayColumn(page, "2026-08-05").locator("article")).toHaveText([/Nordwind Logistics.*J-04 · Warehouse office desks and screens.*Red crew · 3 crew members.*08:00 · 9 h/]);
  await expect(dayColumn(page, "2026-08-05").locator('[data-figure="day-hours"]')).toHaveAttribute("aria-label", "9 hours booked of 16");
  // The alerts: Red over its day; two visits waiting for their stock.
  await expect(page.getByTestId("jb-alerts").locator("li")).toHaveText([
    "Red crew: 9 h of 8 on Wed, Aug 5. Booked and flagged.",
    "J-07 Tandem Robotics waits for stock. The first day it may be booked is Wed, Aug 5.",
    "J-03 Juno Analytics waits for stock. The first day it may be booked is Fri, Aug 7.",
  ]);
  // To book: the five with no day, from the server's list.
  const waiting = await rows<{ id: number }>(context.request, data, "job_visits", WAITING);
  await expect(toBook(page)).toHaveCount(waiting.length);
  await expect(page.locator(`[data-testid="jb-tobook"] li[data-visit="${String(V.tandem)}"]`)).toContainText("Stock lands Wed, Aug 5");
  await expect(page.locator(`[data-testid="jb-tobook"] li[data-visit="${String(V.fernway)}"]`)).toContainText("Stock in");
  await expect(page.getByTestId("jb-still")).toHaveCount(0);
  // The week before: nothing booked; the days gone by say so.
  await page.getByRole("button", { name: "This week" }).click();
  await expect(page).toHaveURL(/\/deliveries\/2026-07-27$/);
  await expect(dayColumn(page, "2026-07-27")).toContainText("Gone by");
  await expect(dayColumn(page, "2026-07-29")).toContainText("Nothing booked");
  await picture(page, "p20-2-ada-deliveries-this-week");
  expect(problems).toEqual([]);
});

test("book from the list: a day before the stock lands is refused and the first day offered; a crew over its day is booked and flagged; moved, its history says from where", async ({ as, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}deliveries`);
    await page.getByRole("button", { name: "Book Test-floor workbenches at Tandem Robotics" }).click();
    const dialog = page.getByRole("dialog", { name: "Book a visit to a job" });
    await expect(dialog.getByTestId("jb-bk-job")).toContainText("Tandem Robotics · J-07 · Test-floor workbenches");
    // It opens on the first day it may be booked, with the first crew that has three people.
    await expect(dialog.getByLabel("Day")).toHaveValue("2026-08-05");
    await expect(dialog.getByLabel("Crew", { exact: true })).toHaveValue(String(RED));
    await expect(dialog.getByTestId("jb-told")).toHaveText("The customer is e-mailed that the visit is booked.");
    // A day before the stock: refused here, nothing sent, and the first day that would do offered.
    await dialog.getByLabel("Day").fill("2026-08-04");
    await expect(dialog.getByTestId("jb-refusal")).toHaveAttribute("data-kind", "stock");
    await expect(dialog.getByTestId("jb-refusal")).toContainText("J-07 waits for stock that lands Wed, Aug 5. The first day it may be booked is Wed, Aug 5.");
    await expect(dialog.locator("[data-go]")).toBeDisabled();
    // The server refuses it too, asked directly: a visit that waits takes any day, and is not booked on that one.
    const headers = await csrf(context.request);
    expect((await context.request.patch(data("job_visits", `/${String(V.tandem)}`), { data: { values: { day: "2026-08-04", crew_id: RED, start_time: "08:00" } }, headers })).status()).toBe(200);
    const early = await context.request.post(data("job_visits", `/${String(V.tandem)}/actions/book`), { data: { from: "waiting" }, headers });
    expect(early.status(), await early.text()).toBe(422);
    expect((await early.json()) as unknown).toMatchObject({ error: { details: { fields: { day: { code: "out-of-range" } } } } });
    expect((await context.request.patch(data("job_visits", `/${String(V.tandem)}`), { data: { values: { day: null, crew_id: null, start_time: null } }, headers })).status()).toBe(200);
    await dialog.getByTestId("jb-offer").click();
    await expect(dialog.getByLabel("Day")).toHaveValue("2026-08-05");
    // Red already has 9 h that day: booked, and flagged.
    await expect(dialog.getByTestId("jb-over")).toHaveText("Red crew: 16 h of 8 on Wed, Aug 5. It can still be booked.");
    await dialog.locator("[data-go]").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Booked: Tandem Robotics, Wed, Aug 5, Red crew. Red crew: 16 h of 8 on Wed, Aug 5.");
    await expect(dialog).toHaveCount(0);
    const booked = (await rows<{ state: string; day: string; crew_id: number }>(context.request, data, "job_visits", { column: "id", op: "eq", value: V.tandem }))[0]!;
    expect([booked.state, booked.day.slice(0, 10), booked.crew_id]).toEqual(["booked", "2026-08-05", RED]);
    await expect(pill(page, "booked")).toHaveText("4 booked");
    await expect(pill(page, "waiting")).toHaveText("4 to book");
    await expect(dayColumn(page, "2026-08-05").locator(`article[data-visit="${String(V.tandem)}"]`)).toBeVisible();
    await expect(dayColumn(page, "2026-08-05").locator('[data-figure="day-hours"]')).toHaveAttribute("data-hours", "16");
    // A row of the sample never sets off a mail (the product's rule): what a booking writes is proved on a visit added here, below.
    expect(await messagesOf(data, V.tandem)).toEqual([]);

    // Moved to Thursday: the dialog shows the day it had, struck through.
    await dayColumn(page, "2026-08-05").getByRole("button", { name: "Move the visit to Tandem Robotics on Wed, Aug 5" }).click();
    const move = page.getByRole("dialog", { name: "Move this visit to a job" });
    await expect(move.getByTestId("jb-was")).toHaveText("WasWed, Aug 5, 08:00 · 7 h · Red crew");
    await expect(move.getByTestId("jb-told")).toHaveText("The day and the start stay as they were: the customer is not e-mailed.");
    await move.getByLabel("Day").fill("2026-08-06");
    await expect(move.getByTestId("jb-told")).toHaveText("The customer is e-mailed the new day.");
    await expect(move.getByTestId("jb-over")).toHaveCount(0);
    await move.locator("[data-go]").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Moved: Tandem Robotics, Thu, Aug 6, Red crew.");
    await expect(dayColumn(page, "2026-08-06").locator(`article[data-visit="${String(V.tandem)}"]`)).toBeVisible();
    expect(((await rows<{ day: string }>(context.request, data, "job_visits", { column: "id", op: "eq", value: V.tandem }))[0]!.day).slice(0, 10)).toBe("2026-08-06");
    // Opened again: the record's own history says where it was, and who moved it.
    await dayColumn(page, "2026-08-06").getByRole("button", { name: "Move the visit to Tandem Robotics on Thu, Aug 6" }).click();
    await expect(page.getByTestId("jb-history")).toHaveText(/^Moved by .*ada.* on .+; it was Wed, Aug 5, 08:00\.$/i);
    // A move that names the day it read is refused when somebody moved it meanwhile.
    const stale = await context.request.patch(data("job_visits", `/${String(V.tandem)}`), { data: { values: { day: "2026-08-07" }, seen: { state: "booked", day: "2026-08-05" } }, headers });
    expect(stale.status(), await stale.text()).toBe(409);
    await page.keyboard.press("Escape");
    expect(problems).toEqual([]);
  } finally {
    await putBack(context.request, data, V.tandem, null);
  }
});

test("dragging onto a day follows the rules of booking: a visit that waits opens the dialog with that day, a booked one moves, a day gone by is refused", async ({ as, data }) => {
  // Wide enough for the whole week beside To book (narrower, the week scrolls sideways inside its box).
  const context = await as("ada", { viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}deliveries`);
    // J-03 waits for stock that lands on Friday: dropped on Tuesday, the dialog opens on Tuesday and says why not.
    await page.locator(`[data-testid="jb-tobook"] li[data-visit="${String(V.juno)}"]`).dragTo(dayColumn(page, "2026-08-04"));
    const dialog = page.getByRole("dialog", { name: "Book a visit to a job" });
    await expect(dialog.getByLabel("Day")).toHaveValue("2026-08-04");
    await expect(dialog.getByTestId("jb-refusal")).toContainText("J-03 waits for stock that lands Fri, Aug 7.");
    await expect(dialog.getByTestId("jb-offer")).toHaveText("Use Fri, Aug 7");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // The Cobalt top-up, booked on Thursday for Blue, dragged to Friday: moved.
    await dayColumn(page, "2026-08-06").locator(`article[data-visit="${String(V.cobaltTopUp)}"]`).dragTo(dayColumn(page, "2026-08-07"));
    await expect(page.locator(".crm-toast").last()).toHaveText("Moved: Cobalt Legal, Fri, Aug 7, Blue crew.");
    await expect(dayColumn(page, "2026-08-07").locator(`article[data-visit="${String(V.cobaltTopUp)}"]`)).toBeVisible();
    expect(((await rows<{ day: string }>(context.request, data, "job_visits", { column: "id", op: "eq", value: V.cobaltTopUp }))[0]!.day).slice(0, 10)).toBe("2026-08-07");
    // This week: Monday has gone by. A visit dropped there opens on it, refused, with the first day that would do.
    await page.getByRole("button", { name: "This week" }).click();
    await page.locator(`[data-testid="jb-tobook"] li[data-visit="${String(V.harbor)}"]`).dragTo(dayColumn(page, "2026-07-27"));
    await expect(dialog.getByTestId("jb-refusal")).toHaveAttribute("data-kind", "gone");
    await expect(dialog.getByTestId("jb-refusal")).toContainText("Mon, Jul 27 has gone by.");
    await expect(dialog.getByTestId("jb-offer")).toHaveText("Use Tue, Jul 28");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(((await rows<{ state: string }>(context.request, data, "job_visits", { column: "id", op: "eq", value: V.harbor }))[0]!.state)).toBe("waiting");
    expect(problems).toEqual([]);
  } finally {
    await putBack(context.request, data, V.cobaltTopUp, { day: "2026-08-06", crew: BLUE, start: "08:00" });
  }
});

test("a visit added to a job whose reply is lost is made once; booked, then called off, it is removed and the customer told; a visit that was made is not", async ({ as, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const what = "Spec jobs: two more bays";
  try {
    await page.goto(`${STAFF}deliveries`);
    await page.getByTestId("jb-add").click();
    const dialog = page.getByRole("dialog", { name: "Add a visit to a job" });
    const job = dialog.getByLabel("Job", { exact: true });
    await job.selectOption({ label: (await job.locator("option", { hasText: "J-02" }).textContent()) ?? "" });
    await dialog.getByLabel("What the visit is for").fill(what);
    await dialog.getByLabel("Hours on site").fill("2");
    await dialog.getByLabel("Crew members").fill("1");
    // No day: it waits in To book.
    await dialog.getByLabel("Day").fill("");
    await expect(dialog.getByTestId("jb-told")).toHaveCount(0);
    const sent: { key: string; replayed: boolean | null }[] = [];
    let dropped = false;
    await page.route("**/api/v1/data/**", async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !/crm_job_visits$/.test(new URL(req.url()).pathname)) return route.fallback();
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
    await dialog.getByRole("button", { name: "Add the visit" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Added to Harbor & Finch: it waits in To book.");
    await page.unroute("**/api/v1/data/**");
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
    const added = await rows<{ id: number; state: string; job_id: number }>(context.request, data, "job_visits", { column: "what", op: "eq", value: what });
    expect(added.map((one) => [one.state, one.job_id])).toEqual([["waiting", 2]]);
    await expect(toBook(page)).toHaveCount(6);
    await expect(pill(page, "waiting")).toHaveText("6 to book");

    // A visit that waits was never announced: calling it off says no e-mail goes. Kept.
    await page.getByRole("button", { name: `Call off ${what} at Harbor & Finch` }).click();
    const cancel = page.getByRole("dialog", { name: "Cancel this visit to a job" });
    await expect(cancel.getByTestId("jb-told")).toHaveCount(0);
    await expect(cancel.getByRole("button", { name: "Cancel it" })).toBeDisabled();
    await cancel.getByRole("button", { name: "Keep it" }).click();
    await expect(cancel).toHaveCount(0);

    // Booked from To book for Friday, Blue: the customer is told once.
    await page.getByRole("button", { name: `Book ${what} at Harbor & Finch` }).click();
    const book = page.getByRole("dialog", { name: "Book a visit to a job" });
    await book.getByLabel("Day").fill("2026-08-07");
    await expect(book.getByLabel("Crew", { exact: true })).toHaveValue(String(BLUE));
    await book.locator("[data-go]").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Booked: Harbor & Finch, Fri, Aug 7, Blue crew.");
    const card = dayColumn(page, "2026-08-07").locator(`article[data-visit="${String(added[0]!.id)}"]`);
    await expect(card).toBeVisible();
    expect((await messagesOfJob(data, 2)).map((one) => one.kind)).toEqual(["delivery-booked"]);

    // Called off from its day: the why, then it is gone, and the customer is told it is off.
    await card.getByRole("button", { name: "Cancel the visit to Harbor & Finch on Fri, Aug 7" }).click();
    await expect(cancel.getByTestId("jb-told")).toHaveText("The customer is e-mailed that the visit is off.");
    await cancel.getByLabel("Why is it cancelled?").fill("Spec: the bays are not needed");
    await cancel.getByRole("button", { name: "Cancel it" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Cancelled: J-02 Harbor & Finch.");
    await expect(card).toHaveCount(0);
    await expect(toBook(page)).toHaveCount(5);
    expect(await rows(context.request, data, "job_visits", { column: "what", op: "eq", value: what })).toEqual([]);
    expect((await messagesOfJob(data, 2)).map((one) => one.kind)).toEqual(["delivery-booked", "delivery-cancelled"]);

    // A visit that was made stays: the server refuses its removal, and there is no "cancelled" to set.
    const headers = await csrf(context.request);
    expect((await context.request.delete(data("job_visits", "/1?confirm=true"), { headers })).status()).toBe(409);
    expect((await context.request.patch(data("job_visits", `/${String(V.harbor)}`), { data: { values: { state: "cancelled" } }, headers })).status()).toBeGreaterThanOrEqual(400);
    expect(problems.filter((line) => !/ERR_CONNECTION_RESET|Failed to load resource/.test(line))).toEqual([]);
  } finally {
    const headers = await csrf(context.request);
    for (const left of await rows<{ id: number }>(context.request, data, "job_visits", { column: "what", op: "eq", value: what })) await context.request.delete(data("job_visits", `/${String(left.id)}?confirm=true`), { headers });
    await dropMessagesOfJob(data, 2);
  }
});

test("Read-only reads Deliveries and presses nothing; the rep, the marketer and Read-only are refused by the server", async ({ as, api, data, stand }) => {
  const grace = await as("grace");
  const page = await grace.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Deliveries", exact: true }).click();
  await expect(page.locator(".crm-screen-sub")).toHaveText("Visits still to come on won jobs, a week at a time, and the ones still waiting for a day.");
  const server = await served(grace.request, stand);
  await expect(pill(page, "booked")).toHaveText(`${String(server.booked)} booked`);
  await expect(toBook(page)).toHaveCount(server.waiting);
  await expect(page.locator('[data-act], [data-testid="jb-add"]')).toHaveCount(0);
  await expect(page.locator('[draggable="true"]')).toHaveCount(0);
  const headers = await csrf(grace.request);
  expect((await grace.request.patch(data("job_visits", `/${String(V.cobaltReturn)}`), { data: { values: { day: "2026-08-05" } }, headers })).status()).toBe(403);
  expect((await grace.request.post(data("job_visits", `/${String(V.harbor)}/actions/book`), { data: { from: "waiting" }, headers })).status()).toBe(403);
  expect((await grace.request.delete(data("job_visits", `/${String(V.harbor)}?confirm=true`), { headers })).status()).toBe(403);
  expect((await grace.request.post(data("job_visits"), { data: { values: { job_id: 2, kind: "drop", what: "x", hours: 1, crew_size: 1 } }, headers })).status()).toBe(403);
  expect((await grace.request.post(data("jobs"), { data: { values: { deal_id: 1, site_name: "x" } }, headers })).status()).toBe(403);
  // The rep reads the visits of her own deals' jobs and changes none; the marketer reads none.
  const dana = await api("dana");
  const hers = await csrf(dana);
  expect((await dana.patch(data("job_visits", `/${String(V.cobaltReturn)}`), { data: { values: { day: "2026-08-05" } }, headers: hers })).status()).toBeGreaterThanOrEqual(403);
  expect((await dana.post(data("job_visits"), { data: { values: { job_id: 2, kind: "drop", what: "x", hours: 1, crew_size: 1 } }, headers: hers })).status()).toBe(403);
  expect((await dana.post(data("jobs"), { data: { values: { deal_id: 1, site_name: "x" } }, headers: hers })).status()).toBe(403);
  const lena = await api("lena");
  expect((await lena.get(data("job_visits", "?limit=5"))).status()).toBe(403);
  expect((await lena.get(data("jobs", "?limit=5"))).status()).toBe(403);
  // The operations manager reads won deals only, and changes none.
  const ada = await api("ada");
  const open = await rows<{ id: number }>(ada, data, "deals", { column: "state", op: "eq", value: "open" });
  expect(open).toEqual([]);
  const won = await rows<Record<string, unknown>>(ada, data, "deals");
  expect(won.length).toBe(8);
  // Five columns of a deal, and its links (the engine shows which row a link names, never what is in it): no amount, no owner.
  expect(Object.keys(won[0]!).filter((key) => !key.endsWith("_id")).sort()).toEqual(["closed_on", "id", "job_count", "name", "state"]);
  expect((await ada.patch(data("deals", `/${String(won[0]!["id"])}`), { data: { values: { name: "x" } }, headers: await csrf(ada) })).status()).toBe(403);
  // Nobody changes or takes away a sign-off: not the operations manager, not the CRM admin.
  for (const who of ["ada", "tessa"]) {
    const person = await api(who);
    const theirs = await csrf(person);
    expect((await person.patch(data("sign_offs", "/1"), { data: { values: { signer_name: "x" } }, headers: theirs })).status(), who).toBe(403);
    expect((await person.delete(data("sign_offs", "/1?confirm=true"), { headers: theirs })).status(), who).toBe(403);
  }
  expect(problems).toEqual([]);
});

test("jobs still to make: a won deal with no job is listed for the operations manager, and made with one press", async ({ as, api, data }) => {
  // The app's rule runs once the win's minute of undo has passed.
  test.setTimeout(300_000);
  const tessa = await api("tessa");
  const headers = await csrf(tessa);
  const name = "Spec jobs: canteen benches";
  const firstStage = (await rows<{ id: number }>(tessa, data, "stages", undefined, "&order=position"))[0]!.id;
  const me = await asOwner();
  try {
    const made = await tessa.post(data("deals"), { data: { values: { name, company_id: 1, owner_id: readState()!.people["dana"]!.id, stage_id: firstStage, typed_amount: 4200 } }, headers });
    expect(made.status(), await made.text()).toBe(201);
    const deal = ((await made.json()) as { data: { id: number } }).data.id;
    expect((await tessa.post(data("deals", `/${String(deal)}/actions/mark-won`), { data: { from: "open" }, headers })).status()).toBe(200);
    // The app's rule makes its job once the win can no longer be undone (a minute); this one is taken away again, as for a
    // deal won before the part was switched on.
    let made1: { id: number }[] = [];
    await expect
      .poll(async () => (made1 = await rows<{ id: number }>(tessa, data, "jobs", { column: "deal_id", op: "eq", value: deal })).length, { timeout: 150_000, intervals: [3000] })
      .toBe(1);
    expect((await me.delete(data("jobs", `/${String(made1[0]!.id)}?confirm=true`), { headers: await csrf(me) })).status()).toBeLessThan(300);

    const context = await as("ada");
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(STAFF);
    await expect(page.locator('.crm-jb-stats [data-figure="still"] [data-value]')).toHaveText("1");
    await expect(page.locator(`[data-row="deal-${String(deal)}"]`)).toContainText(`${name}Won Jul 28, 2026`);
    await page.goto(`${STAFF}deliveries`);
    const still = page.getByTestId("jb-still");
    await expect(still.locator('[data-figure="still"]')).toHaveText("1");
    await expect(still.locator(`li[data-deal="${String(deal)}"]`)).toContainText(name);
    await still.getByRole("button", { name: `Make the job for ${name}` }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText(`The job for ${name} is made. Add its visits from Deliveries.`);
    await expect(still).toHaveCount(0);
    const jobs = await rows<{ id: number; site_name: string }>(context.request, data, "jobs", { column: "deal_id", op: "eq", value: deal });
    expect(jobs.map((one) => one.site_name)).toEqual([name]);
    // A second job for the same deal: refused by the server.
    expect((await context.request.post(data("jobs"), { data: { values: { deal_id: deal, site_name: "Again" } }, headers: await csrf(context.request) })).status()).toBe(409);
    expect(problems).toEqual([]);
  } finally {
    const meHeaders = await csrf(me);
    for (const deal of await rows<{ id: number }>(tessa, data, "deals", { column: "name", op: "eq", value: name })) {
      for (const job of await rows<{ id: number }>(tessa, data, "jobs", { column: "deal_id", op: "eq", value: deal.id })) await me.delete(data("jobs", `/${String(job.id)}?confirm=true`), { headers: meHeaders });
    }
    await removeDeals(tessa, data, "Spec jobs:");
  }
});

test("live, two people: the CRM admin books a visit and puts it back, and the operations manager's Deliveries follows", async ({ as, api, data }) => {
  const page = await (await as("ada")).newPage();
  await page.goto(`${STAFF}deliveries`);
  await expect(pill(page, "waiting")).toHaveText("5 to book");
  const tessa = await api("tessa");
  const headers = await csrf(tessa);
  try {
    expect((await tessa.patch(data("job_visits", `/${String(V.harbor)}`), { data: { values: { day: "2026-08-03", start_time: "09:00", crew_id: BLUE }, seen: { state: "waiting" } }, headers })).status()).toBe(200);
    expect((await tessa.post(data("job_visits", `/${String(V.harbor)}/actions/book`), { data: { from: "waiting" }, headers })).status()).toBe(200);
    await expect(dayColumn(page, "2026-08-03").locator(`article[data-visit="${String(V.harbor)}"]`)).toContainText("Harbor & Finch");
    await expect(pill(page, "waiting")).toHaveText("4 to book");
    await expect(pill(page, "booked")).toHaveText("4 booked");
    await expect(dayColumn(page, "2026-08-03").locator('[data-figure="day-hours"]')).toHaveAttribute("data-hours", "1");
  } finally {
    await putBack(tessa, data, V.harbor, null);
  }
  await expect(dayColumn(page, "2026-08-03").locator("article")).toHaveCount(0);
  await expect(pill(page, "waiting")).toHaveText("5 to book");
});

test("in Arabic, at 390 wide and dark: the home and Deliveries read right to left and fit the screen", async ({ as }) => {
  const ada = await as("ada", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await inArabic(ada.request, async () => {
    const page = await ada.newPage();
    const problems = watch(page);
    await page.goto(STAFF);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator('.crm-jb-stats [data-figure="noday"] .crm-kpi-label')).toHaveText("زيارات بلا تاريخ");
    expect(await narrowEnough(page)).toBe(true);
    await picture(page, "p20-3-ada-home-ar-390-dark");
    await page.goto(`${STAFF}deliveries`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("التوصيلات");
    await expect(page.locator('[data-testid="jb-week-days"] section')).toHaveCount(5);
    expect(await narrowEnough(page)).toBe(true);
    await picture(page, "p20-4-ada-deliveries-ar-390-dark");
    await page.getByRole("button", { name: /Tandem Robotics/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await narrowEnough(page)).toBe(true);
    await picture(page, "p20-5-ada-book-ar-390-dark");
    expect(problems).toEqual([]);
  });
});
