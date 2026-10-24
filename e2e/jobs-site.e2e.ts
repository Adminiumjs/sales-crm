/**
 * P20 and P21, Jobs on site at the office (stage 2), the screens after the
 * booking: the Day sheet and its print (ledger §49), the Route (§52, on the
 * kit's map), Sign-off as the office sees it (§1440), the Job snag list
 * (§44), Delivery notes (§48), Recycling and disposal (§63), and the crews in
 * Settings (F20). Run on a stand of stage 2 (`CRM_STAND_STAGE=2`).
 *
 * Every figure on a screen is compared with what the server answers that
 * person, asked directly. Everything a spec writes is put back.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { request, type APIRequestContext, type Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { room } from "./p12-helpers.ts";
import { readState, STAND_DIR, type StandState } from "./stand.mjs";

const BLUE = 1;
const RED = 2;

async function figure(person: APIRequestContext, stand: StandState, table: string, filters: unknown[] = [], aggregation: Record<string, unknown> = { fn: "count", alias: "n" }): Promise<number> {
  const res = await person.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: `crm_${table}` }, shape: "single-metric", filters, aggregations: [aggregation] } }, headers: await csrf(person) });
  expect(res.status(), await res.text()).toBe(200);
  return Number(((await res.json()) as { result: { value?: number } }).result.value ?? 0);
}

let owner: APIRequestContext | null = null;
/** The install's owner, with no page: to take away a row a spec made that no role of the app removes (a snag). */
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
async function dropSnags(data: Data, startsWith: string): Promise<void> {
  const me = await asOwner();
  const headers = await csrf(me);
  for (const snag of await rows<{ id: number }>(me, data, "snags", { column: "text", op: "like", value: `${startsWith}%` })) expect((await me.delete(data("snags", `/${String(snag.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
}

const stat = (page: Page, name: string) => page.locator(`.crm-jb-stats [data-figure="${name}"]`);
const narrowEnough = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Jobs on site is a part of stage 2: on a stand of the released stage 1 there is nothing here to try (the whole suite runs there).
test.skip(({ stand }) => !stand.parts.includes("jobs"), "Jobs on site is not in this stand's stage");

test("the Day sheet: the next day booked, its crew, the server's hours, the ticks the office may make, and the sheet as it prints", async ({ as, data, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}day-sheet`);
  const sheet = page.getByTestId("jb-sheet");
  // The next day with a visit booked from today (Tue 28 July): Tuesday 4 August, Blue crew.
  await expect(sheet).toHaveAttribute("data-day", "2026-08-04");
  await expect(sheet).toHaveAttribute("data-crew", String(BLUE));
  await expect(sheet.locator("h2")).toHaveText("Blue crew");
  await expect(sheet.getByTestId("jb-sheet-people")).toHaveText("Yusuf Adeyemi · Cal Brennan");
  const hours = await figure(context.request, stand, "job_visits", [{ column: "state", op: "eq", value: "booked" }, { column: "day", op: "eq", value: "2026-08-04" }, { column: "crew_id", op: "eq", value: BLUE }], { fn: "sum", column: "hours", alias: "h" });
  expect(hours).toBe(6);
  await expect(sheet.locator('[data-figure="sheet-hours"]')).toHaveText(`${String(hours)} h`);
  await expect(sheet.locator(".crm-jb-sheet-hours")).toContainText("inside the day");
  await expect(sheet.locator('[data-figure="sheet-visits"]')).toHaveText("1 visit");
  const stop = sheet.locator("li[data-visit='12']");
  await expect(stop.locator(".crm-jb-stop-line")).toHaveText("08:00Cobalt Legal6 h · Leeds");
  await expect(stop.locator('[data-figure="ticks"]')).toHaveText("0 of 4 ticked");
  // The office ticks "Done on site", and takes it back: each the server's.
  await stop.getByRole("button", { name: "Done on site" }).click();
  await expect(page.locator(".crm-toast").last()).toHaveText("Ticked: Done on site.");
  await expect(stop.locator('[data-figure="ticks"]')).toHaveText("1 of 4 ticked");
  expect((await rows<{ tick_done: boolean }>(context.request, data, "job_visits", { column: "id", op: "eq", value: 12 }))[0]!.tick_done).toBe(true);
  await stop.getByRole("button", { name: "Done on site" }).click();
  await expect(page.locator(".crm-toast").last()).toHaveText("Taken back: Done on site.");
  await expect(stop.locator('[data-figure="ticks"]')).toHaveText("0 of 4 ticked");
  expect((await rows<{ tick_done: boolean }>(context.request, data, "job_visits", { column: "id", op: "eq", value: 12 }))[0]!.tick_done).toBe(false);
  // Wednesday, the same crew: J-07's return visit (plan 68 M3 BN-19); Red's day is over its normal day, as the server adds it up.
  await page.getByRole("group", { name: "Which day" }).locator('[data-day="2026-08-05"]').click();
  await expect(page).toHaveURL(/\/day-sheet\/2026-08-05\/1$/);
  await expect(sheet.locator("li[data-visit='16'] .crm-jb-stop-line")).toHaveText("08:00Tandem Robotics7 h · Cambridge");
  await page.locator(`.crm-jb-crews [data-crew="${String(RED)}"]`).click();
  await expect(page).toHaveURL(/\/day-sheet\/2026-08-05\/2$/);
  await expect(sheet.locator('[data-figure="sheet-hours"]')).toHaveText("9 h");
  await expect(sheet.locator(".crm-jb-sheet-hours")).toContainText("over a normal day of 8 h");
  await page.getByTestId("jb-print").click();
  const print = page.getByTestId("jb-print-layout");
  await expect(print.locator("h1")).toHaveText("Day sheet · Wednesday, August 5, 2026");
  await expect(print).toContainText("Nordwind Logistics");
  await picture(page, "p20-6-ada-day-sheet-print");
  await page.keyboard.press("Escape");
  // Read-only reads the sheet and ticks nothing.
  const grace = await (await as("grace")).newPage();
  await grace.goto(`${STAFF}day-sheet/2026-08-04/1`);
  await expect(grace.getByTestId("jb-sheet").locator("[data-tick]")).toHaveCount(4);
  await expect(grace.locator("button[data-tick]")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the Route: a day's way out of the depot and back, the server's legs and hours; a leg inside one town is unknown until a pin is placed", async ({ as, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  // Wednesday, Red: Leeds → Hull → Leeds, 160.6 km (the ledger), with 9 h on site.
  await page.goto(`${STAFF}route/2026-08-05/${String(RED)}`);
  const route = page.getByTestId("jb-route");
  await expect(route.locator("h2")).toHaveText("Red crew");
  await expect(route.locator('[data-figure="stops"] [data-value]')).toHaveText("1");
  const onSite = await figure(context.request, stand, "job_visits", [{ column: "state", op: "eq", value: "booked" }, { column: "day", op: "eq", value: "2026-08-05" }, { column: "crew_id", op: "eq", value: RED }], { fn: "sum", column: "hours", alias: "h" });
  await expect(route.locator('[data-figure="onsite"] [data-value]')).toHaveText(`${String(onSite)} h`);
  await expect(route.locator('[data-figure="distance"] [data-value]')).toHaveText("160.6 km");
  await expect(route.getByTestId("jb-route-seq")).toHaveText("Leeds → Hull → Leeds");
  // The list numbers the stops as the map does: the depot first.
  await expect(route.locator('[data-stop="depot"] .crm-jb-num')).toHaveText("1");
  await expect(route.locator("li[data-stop]:not([data-stop='depot']) .crm-jb-num").first()).toHaveText("2");
  await picture(page, "p21-1-ada-route-wed");
  // Tuesday, Blue: the depot and the stop are both in Leeds, known by the town only: the legs are unknown, and the screen says why.
  await page.goto(`${STAFF}route/2026-08-04/${String(BLUE)}`);
  await expect(route.locator('[data-figure="distance"] [data-value]')).toHaveText("Unknown");
  await expect(page.getByTestId("jb-route-note")).toHaveText(/^2 legs are unknown until a pin is placed/);
  // A day with nothing: no way, and nothing asked.
  await page.goto(`${STAFF}route/2026-08-07/${String(BLUE)}`);
  await expect(route.locator('[data-figure="distance"] [data-value]')).toHaveText("—");
  expect(problems).toEqual([]);
});

test("Sign-off as the office sees it: the server's count of jobs signed, a refused one and why, a snag logged on it, and a signed one sealed", async ({ as, data, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}sign-off`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign-off");
    const all = await figure(context.request, stand, "jobs");
    const signed = new Set((await rows<{ job_id: number }>(context.request, data, "sign_offs")).map((one) => one.job_id)).size;
    expect([all, signed]).toEqual([8, 7]);
    await expect(page.getByTestId("jb-so-line")).toHaveText(`Jobs ${String(all)}: signed off ${String(signed)}, not signed ${String(all - signed)}.`);
    // It opens on the one not signed: J-07, refused while a snag stops it.
    const card = page.getByTestId("jb-so-card");
    await expect(card).toHaveAttribute("data-job", "7");
    await expect(card.getByTestId("jb-so-state")).toHaveText("Done, sign-off refused");
    await expect(card.getByTestId("jb-so-hint")).toHaveText("“Cable trays short by two metres” is open and stops the sign-off. Put it right first.");
    await expect(card.locator('[data-figure="snags"]')).toHaveText("2 snags (2 live)");
    await expect(card.getByTestId("jb-so-done")).toHaveText("Done Jul 21, 2026");
    // A snag logged here goes on the snag list, the server's.
    await card.getByLabel("What is wrong?").fill("Spec jobs: a loose cable cover");
    await card.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Snag logged on J-07. It is on the snag list.");
    await expect(card.locator('[data-figure="snags"]')).toHaveText("3 snags (3 live)");
    const logged = await rows<{ job_id: number; stops_sign_off: boolean; state: string }>(context.request, data, "snags", { column: "text", op: "eq", value: "Spec jobs: a loose cable cover" });
    expect(logged.map((one) => [one.job_id, one.stops_sign_off, one.state])).toEqual([[7, false, "open"]]);
    // A signed one: who signed, and nothing here changes it.
    await page.getByRole("group", { name: "Which job" }).locator('[data-job="8"]').click();
    await expect(card).toHaveAttribute("data-signed", "1");
    const theirs = (await rows<{ signer_name: string }>(context.request, data, "sign_offs", { column: "job_id", op: "eq", value: 8 }))[0]!;
    await expect(card.getByTestId("jb-so-signed")).toContainText(theirs.signer_name);
    await expect(card.getByTestId("jb-so-sealed")).toHaveText("A sign-off stays as it was made: nobody changes it. A correction would be a new sign-off that names this one.");
    await expect(card.getByTestId("jb-so-add")).toHaveCount(0);
    await picture(page, "p20-7-ada-sign-off");
    expect(problems).toEqual([]);
  } finally {
    await dropSnags(data, "Spec jobs:");
  }
});

test("the Job snag list: the server's counts, what stops a sign-off first, a snag logged and put right", async ({ as, data, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const text = "Spec jobs: a door closer too strong";
  try {
    await page.goto(`${STAFF}snags`);
    const live = { column: "state", op: "in", value: ["open", "waiting-part"] };
    const open = await figure(context.request, stand, "snags", [{ column: "state", op: "eq", value: "open" }]);
    const waiting = await figure(context.request, stand, "snags", [{ column: "state", op: "eq", value: "waiting-part" }]);
    const late = await figure(context.request, stand, "snags", [live, { column: "due_on", op: "lt", value: "2026-07-28" }]);
    const byCrew = await figure(context.request, stand, "snags", [{ column: "raised_by_id", op: "not_null" }]);
    const byCustomer = await figure(context.request, stand, "snags", [{ column: "raised_by_contact_id", op: "not_null" }]);
    expect([open, waiting, late, byCrew, byCustomer]).toEqual([3, 2, 2, 5, 4]);
    await expect(stat(page, "open").locator("[data-value]")).toHaveText(String(open));
    await expect(stat(page, "open").locator(".crm-kpi-sub")).toHaveText("across 3 jobs");
    await expect(stat(page, "waiting").locator("[data-value]")).toHaveText(String(waiting));
    await expect(stat(page, "late").locator("[data-value]")).toHaveText(String(late));
    await expect(page.getByTestId("jb-sg-stopping")).toContainText("2 snags are stopping sign-off or use:");
    await expect(page.getByTestId("jb-sg-stopping")).toContainText("Cable trays short by two metres (J-07)");
    await expect(page.getByTestId("jb-sg-stopping")).toContainText("Two shelf ends missing from the run (J-06)");
    await expect(page.getByTestId("jb-sg-by")).toHaveText(`Raised by the crew ${String(byCrew)}, by the customer ${String(byCustomer)}. A snag logged today is due Sun, Aug 2.`);
    await expect(page.locator(".crm-jb-list > li")).toHaveCount(open + waiting);

    await page.getByTestId("jb-sg-add").click();
    const form = page.getByTestId("jb-sg-form");
    await form.getByLabel("What is wrong?").fill(text);
    const job = form.getByLabel("Which job");
    await job.selectOption({ label: (await job.locator("option", { hasText: "J-08" }).textContent()) ?? "" });
    await form.getByRole("button", { name: "Log it" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Snag logged on J-08. It is on the snag list.");
    await expect(stat(page, "open").locator("[data-value]")).toHaveText(String(open + 1));
    const row = page.locator(".crm-jb-list > li", { hasText: text });
    await expect(row).toContainText("Raised today by Ada Novak");
    await expect(row).toContainText("due Sun, Aug 2");
    await row.locator('[data-act="fix"]').click();
    await row.getByLabel("What was done?").fill("Spring adjusted on the visit");
    await row.getByRole("button", { name: "Put right" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Put right on J-08.");
    await expect(stat(page, "open").locator("[data-value]")).toHaveText(String(open));
    const done = (await rows<{ state: string; put_right_note: string; put_right_on: string }>(context.request, data, "snags", { column: "text", op: "eq", value: text }))[0]!;
    expect([done.state, done.put_right_note, done.put_right_on.slice(0, 10)]).toEqual(["put-right", "Spring adjusted on the visit", "2026-07-28"]);
    await page.locator('[data-filter="put-right"]').click();
    await expect(page.locator(".crm-jb-list > li", { hasText: text })).toHaveAttribute("data-state", "put-right");
    // Read-only logs nothing and puts nothing right; the server refuses it too.
    const grace = await as("grace");
    const hers = await grace.newPage();
    await hers.goto(`${STAFF}snags`);
    await expect(hers.locator(".crm-jb-list > li").first()).toBeVisible();
    await expect(hers.locator('[data-testid="jb-sg-add"], [data-act]')).toHaveCount(0);
    expect((await grace.request.post(data("snags"), { data: { values: { job_id: 8, text: "x" } }, headers: await csrf(grace.request) })).status()).toBe(403);
    expect(problems).toEqual([]);
  } finally {
    await dropSnags(data, "Spec jobs:");
  }
});

test("Delivery notes: the server's totals and what needs sorting; the office sorts one", async ({ as, data, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}delivery-notes`);
    const all = await figure(context.request, stand, "delivery_notes");
    const lines = await figure(context.request, stand, "delivery_note_lines");
    const sorting = await figure(context.request, stand, "delivery_notes", [{ column: "needs_sorting", op: "eq", value: 1 }]);
    const clean = await figure(context.request, stand, "delivery_notes", [{ column: "needs_sorting", op: "eq", value: 0 }, { column: "sorted", op: "eq", value: false }]);
    // J-07's note for its return visit of Wed 5 Aug (plan 68 M3 BN-21) is not signed for yet: it needs sorting as any unsigned note does.
    expect([all, lines, clean, sorting]).toEqual([6, 17, 2, 4]);
    await expect(stat(page, "notes").locator("[data-value]")).toHaveText(String(all));
    await expect(stat(page, "notes").locator(".crm-kpi-sub")).toHaveText(`${String(lines)} lines on ${String(all)} visits`);
    await expect(stat(page, "clean").locator("[data-value]")).toHaveText(String(clean));
    await expect(stat(page, "sorting").locator("[data-value]")).toHaveText(String(sorting));
    await expect(page.getByTestId("jb-dn-unsigned")).toContainText("2 deliveries were never signed for.");
    const short = page.locator('li[data-note="1"]');
    await expect(short.getByTestId("jb-dn-state")).toHaveText("Short by 2");
    await expect(short.locator('[data-figure="items"]')).toHaveText("42 of 44");
    // The damaged one, sorted by the office.
    const damaged = page.locator('li[data-note="2"]');
    await expect(damaged.getByTestId("jb-dn-state")).toHaveText("Damage noted");
    await damaged.locator('[data-act="sort"]').click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Sorted. Noted on the delivery (J-08).");
    await expect(stat(page, "sorting").locator("[data-value]")).toHaveText(String(sorting - 1));
    await expect(damaged.getByTestId("jb-dn-state")).toHaveText("Sorted");
    await expect(damaged).toContainText("Sorted Jul 28, 2026");
    const now = (await rows<{ sorted: boolean; sorted_on: string; needs_sorting: number }>(context.request, data, "delivery_notes", { column: "id", op: "eq", value: 2 }))[0]!;
    expect([now.sorted, now.sorted_on.slice(0, 10), Number(now.needs_sorting)]).toEqual([true, "2026-07-28", 0]);
    // Nobody types a total.
    const headers = await csrf(context.request);
    await context.request.patch(data("delivery_notes", "/1"), { data: { values: { ordered: 99, short: 0 } }, headers });
    const one = (await rows<{ ordered: number; short: number }>(context.request, data, "delivery_notes", { column: "id", op: "eq", value: 1 }))[0]!;
    expect([Number(one.ordered), Number(one.short)]).toEqual([44, 2]);
    expect(problems).toEqual([]);
  } finally {
    const me = await asOwner();
    expect((await me.patch(data("delivery_notes", "/2"), { data: { values: { sorted: false, sorted_on: null } }, headers: await csrf(me) })).status()).toBe(200);
  }
});

test("Recycling and disposal: tonnes, what was kept out of landfill, the cost, and the paperwork missing, each the server's", async ({ as, stand }) => {
  const context = await as("tessa");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}recycling`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recycling and disposal");
  const sum = (column: string, filters: unknown[] = []) => figure(context.request, stand, "waste_removals", filters, { fn: "sum", column, alias: "s" });
  const tonnes = await sum("tonnes");
  const landfill = await sum("tonnes", [{ column: "route", op: "eq", value: "landfill" }]);
  const cost = await sum("cost");
  const income = await sum("income");
  const count = await figure(context.request, stand, "waste_removals");
  expect([Math.round(tonnes * 10) / 10, landfill, cost, income, count]).toEqual([7.7, 1.1, 310, 220, 5]);
  await expect(stat(page, "tonnes").locator("[data-value]")).toHaveText("7.7 t");
  await expect(stat(page, "tonnes").locator(".crm-kpi-sub")).toHaveText("5 removals, Mar 27, 2026 to Jun 15, 2026");
  await expect(stat(page, "kept").locator("[data-value]")).toHaveText("86%");
  await expect(stat(page, "kept").locator(".crm-kpi-sub")).toHaveText("1.1 t went to landfill");
  await expect(stat(page, "cost").locator("[data-value]")).toHaveText(/^£90(\.00)?$/);
  await expect(stat(page, "cost").locator(".crm-kpi-sub")).toHaveText(/^£310(\.00)? paid, £220(\.00)? back on scrap$/);
  await expect(page.getByTestId("jb-ws-landfill")).toHaveText("1.1 t went to landfill. Say that plainly if a customer asks.");
  await expect(page.getByTestId("jb-ws-nonote")).toHaveText("One job has no transfer note: J-08 Veldt Studios. If they ask for one, we cannot produce it.");
  await expect(page.getByTestId("jb-ws-quarters")).toHaveText("By quarter, this year: Q1 3.4 t, Q2 4.3 t, Q3 0 t.");
  await page.locator('[data-filter="landfill"]').click();
  await expect(page.locator("[data-removal]")).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("the crews in Settings: their days, their people and phones, kept by the operations manager; the customer's e-mails switched by the CRM admin", async ({ as, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const headers = await csrf(context.request);
  try {
    await page.goto(`${STAFF}settings`);
    // Her one tab of Settings: the crews (no row of tabs for one).
    await expect(page.getByRole("tabpanel", { name: "Crews" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByTestId(`jb-crew-people-${String(RED)}`).locator("li")).toHaveCount(3);
    await expect(page.getByTestId(`jb-crew-people-${String(BLUE)}`).locator("li").first()).toContainText("Yusuf AdeyemiLead");
    // Saturday for Red: on, then off again, each the server's.
    const saturday = page.getByRole("group", { name: "Days Red crew works" }).locator('[data-weekday="sat"]');
    await expect(saturday).toHaveAttribute("aria-pressed", "false");
    await saturday.click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Red crew works on Saturday from now.");
    await expect(saturday).toHaveAttribute("aria-pressed", "true");
    expect(await rows(context.request, data, "crew_days", { and: [{ column: "crew_id", op: "eq", value: RED }, { column: "weekday", op: "eq", value: "sat" }] })).toHaveLength(1);
    await saturday.click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Red crew no longer works on Saturday.");
    await expect(saturday).toHaveAttribute("aria-pressed", "false");
    // Cal's phone, written and kept.
    const phone = page.getByLabel("Phone of Cal Brennan");
    await phone.fill("07700 900456");
    await phone.blur();
    await expect(page.locator(".crm-toast").last()).toHaveText("The phone of Cal Brennan is saved.");
    expect((await rows<{ phone: string }>(context.request, data, "crew_members", { column: "id", op: "eq", value: 2 }))[0]!.phone).toBe("07700 900456");
    // Cal leads Blue now: one lead a crew.
    await page.getByTestId(`jb-crew-people-${String(BLUE)}`).locator('li[data-member="2"]').getByRole("button", { name: "Make lead" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Cal Brennan leads Blue crew.");
    const leads = await rows<{ id: number; lead: boolean }>(context.request, data, "crew_members", { column: "crew_id", op: "eq", value: BLUE });
    expect(leads.map((one) => [one.id, one.lead])).toEqual([[1, false], [2, true]]);
    // The customer's e-mails are the CRM admin's to switch: shown, not pressed.
    await expect(page.getByTestId("jb-mails-on")).toBeDisabled();
    expect((await context.request.patch(data("settings", "/1"), { data: { values: { delivery_emails: false } }, headers })).status()).toBe(403);
    expect(problems).toEqual([]);

    const tessa = await as("tessa");
    const hers = await tessa.newPage();
    await hers.goto(`${STAFF}settings/crews`);
    await hers.getByTestId("jb-mails-off").click();
    await expect(hers.locator(".crm-toast").last()).toHaveText("Delivery e-mails are off.");
    expect((await rows<{ delivery_emails: boolean }>(tessa.request, data, "settings"))[0]!.delivery_emails).toBe(false);
    // Booking now says the customer is not e-mailed.
    await hers.goto(`${STAFF}deliveries`);
    await hers.getByRole("button", { name: "Book Archive shelving: return visit at Harbor & Finch" }).click();
    await expect(hers.getByTestId("jb-told")).toHaveText("No e-mail goes to the customer: delivery e-mails are switched off in Settings.");
    await hers.keyboard.press("Escape");
    await hers.goto(`${STAFF}settings/crews`);
    await hers.getByTestId("jb-mails-on").click();
    await expect(hers.locator(".crm-toast").last()).toHaveText("Delivery e-mails are on.");
  } finally {
    await context.request.patch(data("crew_members", "/2"), { data: { values: { phone: null, lead: false } }, headers });
    await context.request.patch(data("crew_members", "/1"), { data: { values: { lead: true } }, headers });
    for (const extra of await rows<{ id: number }>(context.request, data, "crew_days", { and: [{ column: "crew_id", op: "eq", value: RED }, { column: "weekday", op: "eq", value: "sat" }] })) await context.request.delete(data("crew_days", `/${String(extra.id)}?confirm=true`), { headers });
    const tessa = await as("tessa");
    await tessa.request.patch(data("settings", "/1"), { data: { values: { delivery_emails: true } }, headers: await csrf(tessa.request) });
  }
});

test("in Arabic, at 390 wide and dark: the Day sheet, the Route and Sign-off read right to left and fit the screen", async ({ as, data }) => {
  const ada = await as("ada", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  // Four screens as Ada after the file's other specs: she starts on a fresh minute (in the whole run hers ran out, a 429).
  await room(ada.request, data, 120);
  await inArabic(ada.request, async () => {
    const page = await ada.newPage();
    const problems = watch(page);
    for (const [path, shot] of [["day-sheet/2026-08-05/2", "p20-8-day-sheet-ar-390-dark"], [`route/2026-08-05/${String(RED)}`, "p21-2-route-ar-390-dark"], ["sign-off", "p20-9-sign-off-ar-390-dark"], ["snags", "p20-10-snags-ar-390-dark"], ["delivery-notes", "p20-11-notes-ar-390-dark"], ["recycling", "p20-12-recycling-ar-390-dark"], ["settings", "p20-13-crews-ar-390-dark"]] as const) {
      await page.goto(`${STAFF}${path}`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator(".crm-jb, .crm-jb-crews-tab").first()).toBeVisible();
      await expect(page.locator(".crm-skeleton")).toHaveCount(0);
      expect(await narrowEnough(page), path).toBe(true);
      await picture(page, shot);
    }
    expect(problems).toEqual([]);
  });
});
