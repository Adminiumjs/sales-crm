/**
 * P22, the field crew's phone (stage 2): My day, a visit and its ticks, the
 * crew's Snags, his own profile and his Jump, "No connection", and a live
 * change from the office. Signed in as Yusuf Adeyemi (Blue crew, with Cal
 * Brennan), on a phone 390 wide. Run on a stand of stage 2 (`CRM_STAND_STAGE=2`).
 *
 * Every figure on a screen is compared with what the server answers him,
 * asked directly; every "may not" is the server's refusal, asked directly.
 * Everything a spec writes is put back. Signing a job off is `crew-signoff.e2e.ts`.
 */
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch } from "./helpers.ts";
import type { StandState } from "./stand.mjs";

const BLUE = 1;
/** The sample's return visit to J-01, Tue 4 Aug, Blue crew; and Red's drop to J-04 on Wed 5 Aug. */
const RETURN_VISIT = 12;
const RED_VISIT = 13;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

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

test.skip(({ stand }) => !stand.parts.includes("jobs"), "Jobs on site is not in this stand's stage");

test("My day: he lands on today, his crew and its people; a day with a visit has the ledger's facts, the server's count and hours, and a return to a signed job", async ({ as, stand }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await expect(page).toHaveURL(/\/my-day$/);
  // His menu: the two screens of stage 2, and nothing else.
  await page.getByRole("button", { name: "Open the menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("navigation", { name: "Menu" }).getByRole("link")).toHaveText(["My day", "Snags"]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cw-crew")).toHaveText("Blue crew");
  await expect(page.getByTestId("cw-mates")).toHaveText("Yusuf Adeyemi · Cal Brennan");
  // Today, Tue 28 July by the server's clock: nothing for Blue, and the next day with a visit offered.
  await expect(page.getByTestId("cw-day")).toHaveAttribute("data-day", "2026-07-28");
  await expect(page.getByTestId("cw-day-empty")).toContainText("Nothing is booked for Blue crew on this day.");
  await page.getByTestId("cw-next").click();
  await expect(page).toHaveURL(/\/my-day\/2026-08-04$/);

  // Tue 4 Aug (ledger §49): one visit, Cobalt Legal, 08:00, 6 h, 12 Sovereign Street, Leeds, Tomas Reidy, four ticks with none done.
  const visits = await figure(context.request, stand, "job_visits", [{ column: "state", op: "in", value: ["booked", "done"] }, { column: "day", op: "eq", value: "2026-08-04" }], { fn: "count", alias: "n" });
  const hours = await figure(context.request, stand, "job_visits", [{ column: "state", op: "in", value: ["booked", "done"] }, { column: "day", op: "eq", value: "2026-08-04" }], { fn: "sum", column: "hours", alias: "h" });
  expect([visits, hours]).toEqual([1, 6]);
  await expect(page.getByTestId("cw-summary")).toHaveText(`${String(visits)} visit · ${String(hours)} h on site`);
  const card = page.locator(`[data-visit="${String(RETURN_VISIT)}"]`);
  await expect(card.locator(".crm-cw-visit-time")).toHaveText("08:00");
  await expect(card.locator(".crm-cw-visit-span")).toHaveText("08:00–14:00");
  await expect(card.locator("h2")).toHaveText("Cobalt Legal");
  await expect(card.locator(".crm-cw-address")).toHaveText("12 Sovereign StreetLeeds");
  await expect(card.getByTestId("cw-call")).toHaveAttribute("href", "tel:01134960190");
  await expect(card.locator(".crm-cw-ask-who")).toHaveText("Tomas Reidy");
  await expect(card.getByTestId("cw-maps")).toHaveAttribute("href", /^geo:0,0\?q=12%20Sovereign%20Street%2C%20Leeds$/);
  await expect(card).toContainText("Loading bay off Sovereign Street. Ask at the desk for Tomas.");
  await expect(card.getByTestId("cw-ticked")).toHaveText("0 of 4 ticked");
  await expect(card.getByTestId("cw-load")).toContainText("Nothing listed yet.");
  // A return visit to J-01, signed off on Tue 18 Nov 2025 by Tomas Reidy: the sign-off read, the four ticks, "Add a snag" (B19).
  await expect(card.getByTestId("cw-signed")).toContainText("Signed off Nov 18, 2025 by Tomas Reidy");
  await expect(card.getByRole("link", { name: "Sign off the job" })).toHaveCount(0);
  await expect(card.getByTestId("cw-add-snag")).toBeVisible();
  // The week's strip marks his two booked days, Tue 4 and Thu 6 Aug.
  await expect(page.locator('.crm-cw-weekday-dot[data-on="1"]')).toHaveCount(2);
  // No amount anywhere on his day.
  expect(await page.locator("#crm-page").innerText()).not.toMatch(/£/);
  expect(await narrowEnough(page)).toBe(true);
  await picture(page, "p22-1-yusuf-my-day");

  // "See the sign-off": the sign-off as it was made, read only: no drawn signature is held for a sample one.
  await card.getByRole("link", { name: "See the sign-off" }).click();
  await expect(page).toHaveURL(new RegExp(`/sign-off-the-job/${String(RETURN_VISIT)}$`));
  await expect(page.getByTestId("cw-signed-by")).toHaveText("Signed by Tomas Reidy, Tuesday, November 18, 2025");
  await expect(page.getByTestId("cw-no-signature")).toBeVisible();
  await expect(page.getByTestId("cw-sign-go")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the ticks: his to set and take back on his crew's visit, the server's each time; another crew's visit and the rest of a visit are refused by the server", async ({ as, api, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}my-day/2026-08-04`);
    const card = page.locator(`[data-visit="${String(RETURN_VISIT)}"]`);
    await card.getByRole("button", { name: "Loaded" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Ticked: Loaded.");
    await expect(card.getByTestId("cw-ticked")).toHaveText("1 of 4 ticked");
    expect((await rows<{ tick_loaded: boolean }>(context.request, data, "job_visits", { column: "id", op: "eq", value: RETURN_VISIT }))[0]!.tick_loaded).toBe(true);
    // His crew-mate sees it ticked.
    expect((await rows<{ tick_loaded: boolean }>(await api("cal"), data, "job_visits", { column: "id", op: "eq", value: RETURN_VISIT }))[0]!.tick_loaded).toBe(true);
    await card.getByRole("button", { name: "Loaded" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Taken back: Loaded.");
    await expect(card.getByTestId("cw-ticked")).toHaveText("0 of 4 ticked");
    // A past visit's ticks are read, not pressed.
    await page.goto(`${STAFF}my-day/2026-07-24`);
    await expect(page.locator("[data-visit] button[data-tick]").first()).toBeDisabled();
    // The server: Red's visit is not there for him; of his own, nothing but a tick is his to change.
    const headers = await csrf(context.request);
    expect((await context.request.patch(data("job_visits", `/${String(RED_VISIT)}`), { data: { values: { tick_loaded: true } }, headers })).status()).toBe(404);
    expect((await context.request.get(data("job_visits", `/${String(RED_VISIT)}`))).status()).toBe(404);
    for (const values of [{ day: "2026-08-05" }, { start_time: "06:00" }, { crew_id: 2 }]) expect((await context.request.patch(data("job_visits", `/${String(RETURN_VISIT)}`), { data: { values }, headers })).status(), JSON.stringify(values)).toBe(403);
    // No job, no deal, no quote: refused outright.
    for (const ref of ["jobs", "deals", "quotes"]) expect((await context.request.get(data(ref, "?limit=1"))).status(), ref).toBe(403);
    expect(problems).toEqual([]);
  } finally {
    await context.request.patch(data("job_visits", `/${String(RETURN_VISIT)}`), { data: { values: { tick_loaded: false } }, headers: await csrf(context.request) });
  }
});

test("live, two people: the office moves his visit while his day is open, and his screen follows with who changed it", async ({ as, api, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  const ada = await api("ada");
  const headers = await csrf(ada);
  try {
    await page.goto(`${STAFF}my-day/2026-08-04`);
    const card = page.locator(`[data-visit="${String(RETURN_VISIT)}"]`);
    await expect(card.locator(".crm-cw-visit-time")).toHaveText("08:00");
    await expect(card.getByTestId("cw-changed")).toHaveCount(0);
    // Ada moves the start to 07:30 from her own session; his open day follows, no reload.
    expect((await ada.patch(data("job_visits", `/${String(RETURN_VISIT)}`), { data: { values: { start_time: "07:30" }, seen: { state: "booked", day: "2026-08-04" } }, headers })).status()).toBe(200);
    await expect(card.locator(".crm-cw-visit-time")).toHaveText("07:30");
    await expect(card.getByTestId("cw-changed")).toContainText("by Ada Novak: start moved from 08:00 to 07:30.");
    await picture(page, "p22-2-yusuf-live-move");
    expect(problems).toEqual([]);
  } finally {
    expect((await ada.patch(data("job_visits", `/${String(RETURN_VISIT)}`), { data: { values: { start_time: "08:00" } }, headers })).status()).toBe(200);
  }
});

test("No connection: a tick that cannot be sent says so plainly, saves nothing, keeps the screen, and goes once the line is back", async ({ as, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  try {
    await page.goto(`${STAFF}my-day/2026-08-04`);
    const card = page.locator(`[data-visit="${String(RETURN_VISIT)}"]`);
    await expect(card.getByTestId("cw-ticked")).toHaveText("0 of 4 ticked");
    // The line goes: every request to Adminium is dropped.
    await page.route("**/api/v1/**", (route) => route.abort("internetdisconnected"));
    await card.getByRole("button", { name: "Arrived" }).click();
    const line = page.getByTestId("cw-offline");
    await expect(line).toContainText("No connection. Nothing was saved. Try again when you are back online.");
    // What was read stays on the screen; nothing was saved.
    await expect(card.locator("h2")).toHaveText("Cobalt Legal");
    await expect(card.getByTestId("cw-ticked")).toHaveText("0 of 4 ticked");
    await line.getByRole("button", { name: "Try again" }).click();
    await expect(line).toContainText("Still no connection.");
    expect((await rows<{ tick_arrived: boolean }>(context.request, data, "job_visits", { column: "id", op: "eq", value: RETURN_VISIT }))[0]!.tick_arrived).toBe(false);
    await picture(page, "p22-3-yusuf-no-connection");
    // Back online: the same press goes.
    await page.unroute("**/api/v1/**");
    await line.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("cw-offline")).toHaveCount(0);
    await expect(card.getByTestId("cw-ticked")).toHaveText("1 of 4 ticked");
    expect((await rows<{ tick_arrived: boolean }>(context.request, data, "job_visits", { column: "id", op: "eq", value: RETURN_VISIT }))[0]!.tick_arrived).toBe(true);
  } finally {
    await page.unroute("**/api/v1/**").catch(() => undefined);
    await context.request.patch(data("job_visits", `/${String(RETURN_VISIT)}`), { data: { values: { tick_arrived: false } }, headers: await csrf(context.request) });
  }
});

test("Snags: his crew's, open first, with the server's three counts; no other crew's is there for him", async ({ as, stand, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}my-snags`);
  const count = (state: string): Promise<number> => figure(context.request, stand, "snags", [{ column: "state", op: "eq", value: state }], { fn: "count", alias: "n" });
  const [open, waiting, fixed] = [await count("open"), await count("waiting-part"), await count("put-right")];
  // Blue crew's seven of the sample's nine: three open (g3, g1, g5), two waiting on a part, two put right.
  expect([open, waiting, fixed]).toEqual([3, 2, 2]);
  for (const [state, value] of [["open", open], ["waiting-part", waiting], ["put-right", fixed]] as const) await expect(page.locator(`[data-figure="${state}"] [data-value]`)).toHaveText(String(value));
  const mine = await rows<{ id: number; crew_id: number }>(context.request, data, "snags");
  expect(new Set(mine.map((one) => one.crew_id))).toEqual(new Set([BLUE]));
  await expect(page.locator("article[data-snag]")).toHaveCount(mine.length);
  // Open first: the first three cards are the open ones, the last two put right.
  await expect(page.locator("article[data-snag]").nth(0)).toHaveAttribute("data-state", "open");
  await expect(page.locator("article[data-snag]").nth(mine.length - 1)).toHaveAttribute("data-state", "put-right");
  await expect(page.locator('article[data-snag][data-state="open"]', { hasText: "Cable trays short by two metres" })).toContainText("Was due");
  // A Red crew snag is not there for him by a direct call.
  // A Red crew snag (the sample's g6, on J-04) is not there for him by a direct call, as a row that does not exist.
  expect(mine.map((one) => one.id)).not.toContain(6);
  expect((await context.request.get(data("snags", "/6"))).status()).toBe(404);
  expect(await narrowEnough(page)).toBe(true);
  await picture(page, "p22-4-yusuf-snags");
  expect(problems).toEqual([]);
});

test("his own: My profile holds his name, crew, phone, language and alerts and no figure; Jump lists his screens, no record and no action", async ({ as }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}me`);
  await expect(page.getByTestId("me-role")).toHaveText("Field crew · Blue crew");
  await expect(page.getByTestId("me-phone")).toContainText("Kept by the operations manager");
  await expect(page.getByTestId("me-language")).toHaveText("English (US)");
  // The three rules that tell his crew of a change, each with its real state (switched on in the sample install).
  await expect(page.getByTestId("me-alerts").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("me-alerts").locator('li[data-state="on"]')).toHaveCount(3);
  // No pipeline, no target, no amount (N2).
  for (const gone of ["me-target", "me-companies"]) await expect(page.getByTestId(gone)).toHaveCount(0);
  expect(await page.locator("#crm-page").innerText()).not.toMatch(/£|pipeline|target/i);
  // Notifications lists what can reach him: a change to a visit of his.
  await page.goto(`${STAFF}notifications`);
  await expect(page.getByTestId("told-reasons")).toContainText("A visit of mine today or tomorrow is changed");
  // Jump (N1): his two screens, and nothing else: no action, and no record whatever he types.
  await page.goto(`${STAFF}my-day`);
  await expect(page.getByTestId("cw-day")).toBeVisible();
  await page.keyboard.press("Control+k");
  const jump = page.getByRole("dialog", { name: "Jump" });
  await expect(jump.getByRole("option")).toHaveText([/My day/, /Snags/]);
  await jump.getByRole("combobox").fill("Cobalt");
  await page.waitForTimeout(2000);
  await expect(jump.getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(problems).toEqual([]);
});

test("refused: the crew's phone is not a rep's or the marketer's, by the menu and by the server", async ({ as, api, data }) => {
  const dana = await (await as("dana")).newPage();
  await dana.goto(`${STAFF}my-day`);
  await expect(dana.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  // A rep makes no sign-off and ticks no visit, by a direct call.
  const rep = await api("dana");
  const repHeaders = await csrf(rep);
  expect((await rep.post(data("sign_offs"), { data: { values: { visit_id: RETURN_VISIT, signer_name: "D" } }, headers: repHeaders })).status()).toBe(403);
  expect((await rep.patch(data("job_visits", `/${String(RETURN_VISIT)}`), { data: { values: { tick_loaded: true } }, headers: repHeaders })).status()).toBeGreaterThanOrEqual(403);
  // The marketer reads no visit and no snag at all.
  const lena = await api("lena");
  expect((await lena.get(data("job_visits", "?limit=1"))).status()).toBe(403);
  expect((await lena.get(data("snags", "?limit=1"))).status()).toBe(403);
  const page = await (await as("lena")).newPage();
  await page.goto(`${STAFF}my-snags`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
});

test("in Arabic, dark, 390 wide: his day, a sign-off, his snags and his profile read right to left, fit the phone, and axe finds nothing", async ({ as, api }) => {
  const yusuf = await api("f_yusuf");
  await inArabic(yusuf, async () => {
    const context = await as("f_yusuf", { ...PHONE, colorScheme: "dark" });
    const page = await context.newPage();
    const problems = watch(page);
    const found: string[] = [];
    for (const path of ["my-day/2026-08-04", "sign-off-the-job/7", `sign-off-the-job/${String(RETURN_VISIT)}`, "my-snags", "me"]) {
      await page.goto(`${STAFF}${path}`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("#crm-page h1").first()).toBeVisible();
      await page.waitForTimeout(1500);
      expect(await narrowEnough(page), path).toBe(true);
      found.push(...(await axe(page)).map((line) => `${path}: ${line}`));
      if (path === "my-day/2026-08-04") await picture(page, "p22-5-yusuf-arabic-dark");
    }
    await expect(page.getByTestId("me-role")).toContainText("فريق الموقع");
    expect(found).toEqual([]);
    expect(problems).toEqual([]);
  });
  // Light too, in English.
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const found: string[] = [];
  for (const path of ["my-day/2026-08-04", "sign-off-the-job/7", "my-snags", "me"]) {
    await page.goto(`${STAFF}${path}`);
    await expect(page.locator("#crm-page h1").first()).toBeVisible();
    await page.waitForTimeout(1500);
    found.push(...(await axe(page)).map((line) => `${path} light: ${line}`));
  }
  expect(found).toEqual([]);
});
