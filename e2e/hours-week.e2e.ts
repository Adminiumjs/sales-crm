/**
 * P25, part B: TIME SHEETS (the office) and MY HOURS (the crew's phone), both
 * sides of one week, on a stand of stage 3 (`CRM_STAND_STAGE=3`).
 *
 * - The office's Time sheets on the sample's week (Mon 20 to Fri 24 Jul, the
 *   ledger's §53), as the operations manager, every figure compared with what
 *   the server answers her; Read-only reads it with nothing to press and the
 *   server refuses her the move; a rep is refused the page and the rows.
 * - His My hours on that week (Yusuf, 28 + 7 = 35 h, sent), read only.
 * - The week, live with two people signed in: he writes a day (its reply lost
 *   on the way: one line all the same), sends the week; the operations
 *   manager's open screen follows; she sends it back with a reason; his open
 *   screen follows; he corrects the day and sends it again; she signs it off;
 *   his screen follows, and nothing of it is his to change any more (the
 *   server refuses).
 * - Arabic, dark, 390 wide, axe.
 *
 * What it writes: a week of Yusuf's that no other spec reads (the first free
 * week before the sample's), with one line. A signed-off week is never removed
 * by the app; the spec asks the install's owner to take it away at the end and
 * says so if the server keeps it. No figure another spec reads moves: every
 * other spec reads the sample's week.
 */
import AxeBuilder from "@axe-core/playwright";
import { request, type APIRequestContext, type Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch } from "./helpers.ts";
import type { StandState } from "./stand.mjs";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const SAMPLE_WEEK = "2026-07-20";

async function figure(person: APIRequestContext, stand: StandState, table: string, filters: unknown[], aggregation: Record<string, unknown>): Promise<number> {
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

const dayOf = (value: unknown): string => String(value).slice(0, 10);
const addDays = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

test.skip(({ stand }) => !stand.parts.includes("fleet"), "Vehicles and crew is not in this stand's stage");

test("Time sheets: the sample's week with the ledger's figures, as the server answers the operations manager; Read-only presses nothing; a rep is refused", async ({ as, api, stand, data }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}time-sheets`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Time sheets");
  await expect(page.getByTestId("jb-week")).toHaveText("Mon, Jul 20 – Sun, Jul 26");
  const ada = context.request;
  const week = [{ column: "week_of", op: "eq", value: SAMPLE_WEEK }];
  const days = [{ column: "day", op: "between", value: [SAMPLE_WEEK, "2026-07-26"] }];
  const onJob = await figure(ada, stand, "time_sheets", week, { fn: "sum", column: "hours_total", alias: "v" });
  const travel = await figure(ada, stand, "time_sheets", week, { fn: "sum", column: "travel_total", alias: "v" });
  const toSign = await figure(ada, stand, "time_sheets", [...week, { column: "state", op: "eq", value: "sent" }], { fn: "count", alias: "v" });
  const lines = await figure(ada, stand, "time_sheet_lines", days, { fn: "count", alias: "v" });
  const onAJob = await figure(ada, stand, "time_sheet_lines", [...days, { column: "job_id", op: "gt", value: 0 }], { fn: "count", alias: "v" });
  // The ledger's §53: 123 h on the job, 31 h travel, 5 still to sign off; 11 of 25 lines on a job; 2 days off; none over the week.
  expect([onJob, travel, toSign, lines, onAJob]).toEqual([123, 31, 5, 25, 11]);
  await expect(page.locator('[data-figure="onjob"] [data-value]')).toHaveText(`${String(onJob)} h`);
  await expect(page.locator('[data-figure="travel"] [data-value]')).toHaveText(`${String(travel)} h`);
  await expect(page.locator('[data-figure="tosign"] [data-value]')).toHaveText(String(toSign));
  await expect(page.getByTestId("hr-ts-jobline")).toHaveText(/^Lines on a job: 11 of 25 \(J-\d+ \d, J-\d+ \d, J-\d+ \d, J-\d+ \d, J-\d+ \d\)\. Days off: 2\. Over 40 h: 0\.$/);
  // The five, each with the server's kept hours: Yusuf 28 + 7 = 35.
  const yusuf = page.locator(`[data-sheet-of="${stand.people["f_yusuf"]!.id}"]`);
  await expect(page.locator("[data-sheet-of]")).toHaveCount(5);
  await expect(yusuf.getByTestId("hr-ts-name")).toHaveText("Yusuf Adeyemi");
  await expect(yusuf.getByTestId("hr-ts-state")).toHaveText("To sign off");
  await expect(yusuf.locator('[data-figure="total"]')).toHaveText("35 h");
  await expect(yusuf.locator('[data-figure="split"]')).toHaveText("28 h on the job · 7 h travel");
  const sheet = (await rows<{ total_hours: string }>(ada, data, "time_sheets", { and: [{ column: "user_id", op: "eq", value: stand.people["f_yusuf"]!.id }, { column: "week_of", op: "eq", value: SAMPLE_WEEK }] }))[0]!;
  expect(Number(sheet.total_hours)).toBe(35);
  // His days, opened: five, two of them on a job.
  await yusuf.getByRole("button", { name: "Show Yusuf Adeyemi’s days" }).click();
  await expect(yusuf.getByTestId("hr-ts-lines").locator("li")).toHaveCount(5);
  await expect(yusuf.getByTestId("hr-ts-lines").locator("li").first()).toContainText("Mon, Jul 20");
  await expect(yusuf.getByRole("button", { name: "Sign it off" })).toBeVisible();
  // Mo's Friday is a day off: no hours shown.
  await expect(page.locator(`[data-sheet-of="${stand.people["mo"]!.id}"] [data-figure="total"]`)).toHaveText("27.5 h");
  await picture(page, "p25b-1-ada-time-sheets");
  expect(problems).toEqual([]);

  // Read-only: the same week, nothing to press; and the server refuses her the move.
  const grace = await (await as("grace")).newPage();
  await grace.goto(`${STAFF}time-sheets`);
  await expect(grace.locator(`[data-sheet-of="${stand.people["f_yusuf"]!.id}"] [data-figure="total"]`)).toHaveText("35 h");
  await expect(grace.getByRole("button", { name: "Sign it off" })).toHaveCount(0);
  const readOnly = await api("grace");
  const sheetId = (await rows<{ id: number }>(readOnly, data, "time_sheets", { and: [{ column: "user_id", op: "eq", value: stand.people["f_yusuf"]!.id }, { column: "week_of", op: "eq", value: SAMPLE_WEEK }] }))[0]!.id;
  expect((await readOnly.post(data("time_sheets", `/${String(sheetId)}/actions/sign-off`), { data: { from: "sent" }, headers: await csrf(readOnly) })).status()).toBe(403);
  // A rep: not her page, and not her rows.
  const dana = await (await as("dana")).newPage();
  await dana.goto(`${STAFF}time-sheets`);
  await expect(dana.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  const rep = await api("dana");
  expect((await rep.get(data("time_sheets", "?limit=1"))).status()).toBe(403);
  expect((await rep.get(data("time_sheet_lines", "?limit=1"))).status()).toBe(403);
});

test("My hours: his own week as the server keeps it, sent and read only; a crew-mate's sheet is not there for him", async ({ as, stand, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await page.getByRole("button", { name: "Open the menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("navigation", { name: "Menu" }).getByRole("link")).toHaveText(["My day", "Snags", "My hours", "My certificates"]);
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "My hours" }).click();
  await expect(page).toHaveURL(/\/my-hours$/);
  await expect(page.getByTestId("hr-mh-week")).toHaveText("Mon, Jul 20 – Fri, Jul 24");
  await expect(page.getByTestId("hr-mh-state")).toHaveText("Sent");
  await expect(page.locator("[data-line]")).toHaveCount(5);
  await expect(page.locator("[data-line]").first()).toContainText("Cambridge, workbench prep");
  await expect(page.locator('[data-line] [data-figure="hours"]').first()).toHaveText("7 h");
  await expect(page.locator('[data-line] [data-figure="travel"]').first()).toHaveText("1.5 h");
  await expect(page.getByTestId("hr-mh-totals").locator('[data-figure="onsite"]')).toHaveText("28 h");
  await expect(page.getByTestId("hr-mh-totals").locator('[data-figure="travel"]')).toHaveText("7 h");
  await expect(page.getByTestId("hr-mh-totals").locator('[data-figure="total"]')).toHaveText("35 h");
  await expect(page.getByTestId("hr-mh-sent")).toHaveText("Sent for sign-off. It is signed off, or sent back with a note.");
  // Sent: nothing of it is his to press.
  await expect(page.getByRole("button", { name: "Add a day" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Change / })).toHaveCount(0);
  await expect(page.getByTestId("hr-mh-send")).toHaveCount(0);
  expect(await page.locator("#crm-page").innerText()).not.toMatch(/£/);
  await picture(page, "p25b-2-yusuf-my-hours");
  // The server: his own sheet only; Cal's is not there, by a record or a list.
  const me = context.request;
  const mine = await rows<{ id: number; user_id: string }>(me, data, "time_sheets");
  // His own only (on a kept stand, the week the live test signed off is his too).
  expect(mine.length).toBeGreaterThan(0);
  expect([...new Set(mine.map((row) => row.user_id))]).toEqual([stand.people["f_yusuf"]!.id]);
  const cal = (await rows<{ id: number }>(await (await as("ada")).request, data, "time_sheets", { column: "user_id", op: "eq", value: stand.people["cal"]!.id }))[0]!;
  expect((await me.get(data("time_sheets", `/${String(cal.id)}`))).status()).toBe(404);
  expect(problems).toEqual([]);
});

test("one week, both sides, live: he writes a day (its reply lost) and sends it; she sends it back with a reason; he corrects it and sends it again; she signs it off", async ({ as, api, stand, data }) => {
  const yusufId = stand.people["f_yusuf"]!.id;
  const adaApi = await api("ada");
  // The first Monday before the sample's week that Yusuf has no sheet for.
  const taken = new Set((await rows<{ week_of: string }>(adaApi, data, "time_sheets", { column: "user_id", op: "eq", value: yusufId })).map((row) => dayOf(row.week_of)));
  let week = addDays(SAMPLE_WEEK, -7);
  while (taken.has(week)) week = addDays(week, -7);
  const mondayWords = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${week}T12:00:00Z`));
  const phone = await as("f_yusuf", PHONE);
  const desk = await as("ada");
  const his = await phone.newPage();
  const hers = await desk.newPage();
  const problems = [...watch(his), ...watch(hers)];
  let sheetId: number | null = null;
  try {
    await his.goto(`${STAFF}my-hours/${week}`);
    await expect(his.getByTestId("hr-mh-state")).toHaveText("Not sent yet");
    await expect(his.getByTestId("hr-mh-empty")).toBeVisible();
    await hers.goto(`${STAFF}time-sheets/${week}`);
    const row = hers.locator(`[data-sheet-of="${yusufId}"]`);
    await expect(row.getByTestId("hr-ts-state")).toHaveText("Nothing written");

    // He writes Monday; the reply to the line is lost on its way, and the same line is sent again with its key.
    await his.getByRole("button", { name: "Add a day" }).click();
    const dialog = his.locator('[data-dialog="hr-line"]');
    await dialog.getByLabel("What you did").fill("zz-hours: depot, bench tops");
    await dialog.getByLabel("Hours on site").fill("6");
    await dialog.getByLabel("Hours of travel").fill("1");
    let lost = 0;
    await his.route("**/api/v1/data/**", async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !/crm_time_sheet_lines$/.test(new URL(req.url()).pathname) || lost > 0) return route.fallback();
      lost += 1;
      await route.fetch();
      return route.abort("connectionreset");
    });
    await dialog.getByTestId("hr-line-save").click();
    await expect(his.locator(".crm-toast").last()).toHaveText(`${mondayWords} is written.`);
    await his.unroute("**/api/v1/data/**");
    expect(lost).toBe(1);
    const sheet = (await rows<{ id: number; state: string }>(adaApi, data, "time_sheets", { and: [{ column: "user_id", op: "eq", value: yusufId }, { column: "week_of", op: "eq", value: week }] }))[0]!;
    sheetId = sheet.id;
    expect((await rows(adaApi, data, "time_sheet_lines", { column: "sheet_id", op: "eq", value: sheet.id })).length, "one line, though its reply was lost").toBe(1);
    await expect(his.getByTestId("hr-mh-totals").locator('[data-figure="total"]')).toHaveText("7 h");
    // Her open screen follows: written, not sent.
    await expect(row.getByTestId("hr-ts-state")).toHaveText("Not sent yet");
    await expect(row.locator('[data-figure="total"]')).toHaveText("7 h");

    // He sends it; her screen follows.
    await his.getByTestId("hr-mh-send").click();
    await expect(his.locator(".crm-toast").last()).toHaveText("Sent for sign-off.");
    await expect(his.getByTestId("hr-mh-state")).toHaveText("Sent");
    await expect(row.getByTestId("hr-ts-state")).toHaveText("To sign off");
    // Sent: his day is not his to change any more, by the server.
    const line = (await rows<{ id: number }>(phone.request, data, "time_sheet_lines", { column: "sheet_id", op: "eq", value: sheet.id }))[0]!;
    expect((await phone.request.patch(data("time_sheet_lines", `/${String(line.id)}`), { data: { values: { hours: 8 } }, headers: await csrf(phone.request) })).status()).toBe(409);

    // She sends it back: not without a reason; with one, his screen follows with it.
    await expect(row.getByRole("button", { name: "Send it back" })).toBeDisabled();
    await row.getByPlaceholder("A note for Yusuf if you send it back").fill("zz-hours: Monday was 7 h on site, the van log says so.");
    await row.getByRole("button", { name: "Send it back" }).click();
    await expect(hers.locator(".crm-toast").last()).toHaveText("Yusuf’s week is sent back with your note.");
    await expect(row.getByTestId("hr-ts-state")).toHaveText("Sent back");
    await expect(his.getByTestId("hr-mh-state")).toHaveText("Sent back");
    await expect(his.getByTestId("hr-mh-backnote")).toHaveText("zz-hours: Monday was 7 h on site, the van log says so.");

    // He corrects Monday and sends it again.
    await his.getByRole("button", { name: `Change ${mondayWords}` }).click();
    await dialog.getByLabel("Hours on site").fill("7");
    await dialog.getByTestId("hr-line-save").click();
    await expect(his.locator(".crm-toast").last()).toHaveText(`${mondayWords} is changed.`);
    await expect(his.getByTestId("hr-mh-totals").locator('[data-figure="total"]')).toHaveText("8 h");
    await his.getByTestId("hr-mh-send").click();
    await expect(his.locator(".crm-toast").last()).toHaveText("Sent again for sign-off.");
    await expect(row.getByTestId("hr-ts-state")).toHaveText("To sign off");
    await expect(row.locator('[data-figure="total"]')).toHaveText("8 h");

    // She signs it off; his screen follows, and nothing of it is his any more.
    await row.getByRole("button", { name: "Sign it off" }).click();
    await expect(hers.locator(".crm-toast").last()).toHaveText("Yusuf’s week is signed off.");
    await expect(row.getByTestId("hr-ts-state")).toHaveText("Signed off");
    await expect(row.getByTestId("hr-ts-signed")).toContainText("Signed off by Ada Novak");
    await expect(his.getByTestId("hr-mh-state")).toHaveText("Signed off");
    await expect(his.getByTestId("hr-mh-signed")).toContainText("Signed off by Ada Novak");
    await expect(his.getByRole("button", { name: /^Change / })).toHaveCount(0);
    await expect(his.getByTestId("hr-mh-send")).toHaveCount(0);
    await picture(his, "p25b-3-yusuf-signed-off");
    const headers = await csrf(phone.request);
    expect((await phone.request.patch(data("time_sheet_lines", `/${String(line.id)}`), { data: { values: { hours: 9 } }, headers })).status()).toBe(409);
    expect((await phone.request.post(data("time_sheets", `/${String(sheet.id)}/actions/send`), { data: { from: "signed-off" }, headers })).status()).toBeGreaterThanOrEqual(400);
    expect((await adaApi.patch(data("time_sheets", `/${String(sheet.id)}`), { data: { values: { sent_back_note: "after" } }, headers: await csrf(adaApi) })).status()).toBeGreaterThanOrEqual(400);
    expect(problems).toEqual([]);
  } finally {
    if (sheetId !== null) await takeAway(stand, data, sheetId);
  }
});

/** The week this spec made, taken away as the install's owner when the server lets anybody (a signed-off week is kept: said, not failed). */
async function takeAway(stand: StandState, data: (ref: string, rest?: string) => string, sheetId: number): Promise<void> {
  const owner = await request.newContext({ baseURL: stand.url });
  try {
    const login = await owner.post("/api/v1/auth/login", { data: { email: stand.owner.email, password: stand.owner.password } });
    if (login.status() !== 200) return;
    const headers = await csrf(owner);
    for (const line of await rows<{ id: number }>(owner, data, "time_sheet_lines", { column: "sheet_id", op: "eq", value: sheetId }).catch(() => [])) await owner.delete(data("time_sheet_lines", `/${String(line.id)}?confirm=true`), { headers });
    const gone = await owner.delete(data("time_sheets", `/${String(sheetId)}?confirm=true`), { headers });
    if (gone.status() >= 300) console.info(`[hours-week] the signed-off week ${String(sheetId)} stays: the server keeps a locked row (${String(gone.status())}).`);
  } finally {
    await owner.dispose();
  }
}

test("in Arabic, dark, 390 wide: My hours and Time sheets read right to left, fit the phone, and axe finds nothing", async ({ as, api }) => {
  const found: string[] = [];
  for (const [person, path] of [["f_yusuf", "my-hours"], ["ada", "time-sheets"]] as const) {
    const who = await api(person);
    await inArabic(who, async () => {
      const page = await (await as(person, { ...PHONE, colorScheme: "dark" })).newPage();
      const problems = watch(page);
      await page.goto(`${STAFF}${path}`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("#crm-page h1").first()).toBeVisible();
      await expect(page.locator("[data-line], [data-sheet-of]").first()).toBeVisible();
      if (path === "time-sheets") await page.locator("[data-sheet-of] button[aria-expanded]").first().click();
      await page.waitForTimeout(1000);
      expect(await narrowEnough(page), path).toBe(true);
      found.push(...(await axe(page)).map((line) => `${path} dark rtl: ${line}`));
      await picture(page, `p25b-4-${person}-arabic-dark`);
      expect(problems).toEqual([]);
    });
    // Light, in English, at a desk's width for the office.
    const page = await (await as(person, person === "ada" ? {} : PHONE)).newPage();
    await page.goto(`${STAFF}${path}`);
    await expect(page.locator("[data-line], [data-sheet-of]").first()).toBeVisible();
    await page.waitForTimeout(1000);
    found.push(...(await axe(page)).map((line) => `${path} light: ${line}`));
  }
  expect(found).toEqual([]);
});
