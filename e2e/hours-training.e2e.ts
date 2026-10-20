/**
 * P25, part B: TRAINING (the office) and MY CERTIFICATES (the crew's phone),
 * and the part's numbers and line in Settings, on a stand of stage 3
 * (`CRM_STAND_STAGE=3`).
 *
 * - Training as the operations manager on the sample (the ledger's §64): five
 *   crew members, 23 certificates of 7 kinds, one run out (Sean), two within
 *   42 days (Rina, Mo), Cal's just outside at 46; each figure compared with
 *   what the server answers her.
 * - She adds a certificate, books its course, renews it and takes it off; the
 *   crew member's open My certificates follows each, live.
 * - My certificates as Yusuf: his six, none within 42 days, the nearest 125
 *   days off; a crew-mate's is not there for him.
 * - Read-only reads Training with nothing to press; a rep and a sales manager
 *   are refused the page and the rows by the server.
 * - Settings: the part's two numbers on the Crews tab, held between bounds by
 *   the server; its line on the Parts tab.
 * - Arabic, dark, 390 wide, axe.
 *
 * What it writes: one certificate named `zz-hours …`, taken away at the end;
 * the warning setting is moved and put back.
 */
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, unfoldMenu, watch } from "./helpers.ts";
import type { StandState } from "./stand.mjs";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const TODAY = "2026-07-28";
const NAME = "zz-hours Forklift, reach truck";

async function figure(person: APIRequestContext, stand: StandState, filters: unknown[]): Promise<number> {
  const res = await person.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: "crm_certificates" }, shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] } }, headers: await csrf(person) });
  expect(res.status(), await res.text()).toBe(200);
  return Number(((await res.json()) as { result: { value?: number } }).result.value ?? 0);
}

const narrowEnough = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function axe(page: Page): Promise<string[]> {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((one) => one.effect?.getTiming().iterations !== Infinity).map((one) => one.finished.catch(() => undefined))), new Promise((done) => setTimeout(done, 3000))]));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((one) => `${one.impact ?? "?"} ${one.id}: ${one.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(" | ")}`);
}

test.skip(({ stand }) => !stand.parts.includes("fleet"), "Vehicles and crew is not in this stand's stage");

test("Training: the sample's certificates with the ledger's figures, as the server answers the operations manager", async ({ as, stand }) => {
  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  // Her menu is long (Jobs on site, Supply, Vehicles and crew): it starts folded.
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Training" }).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Training records");
  const ada = context.request;
  const all = await figure(ada, stand, []);
  const out = await figure(ada, stand, [{ column: "valid_until", op: "lt", value: TODAY }]);
  const soon = await figure(ada, stand, [{ column: "valid_until", op: "between", value: [TODAY, "2026-09-08"] }]);
  expect([all, out, soon]).toEqual([23, 1, 2]);
  await expect(page.locator('[data-figure="members"] [data-value]')).toHaveText("5");
  await expect(page.locator('[data-figure="members"]')).toContainText("2 crews · 23 certificates of 7 kinds");
  await expect(page.locator('[data-figure="out"] [data-value]')).toHaveText(String(out));
  await expect(page.locator('[data-figure="soon"]')).toContainText("Runs out within 42 days");
  await expect(page.locator('[data-figure="soon"] [data-value]')).toHaveText(String(soon));
  await expect(page.getByTestId("hr-tr-out")).toHaveText("Sean Petit (Red crew): Working at height ran out on Sun, Jul 12.");
  const card = (key: string) => page.locator(`[data-holder="${stand.people[key]!.id}"]`);
  await expect(page.locator("[data-holder]")).toHaveCount(5);
  await expect(card("sean").getByTestId("hr-tr-summary")).toHaveText("One certificate has run out");
  await expect(card("rina").getByTestId("hr-tr-summary")).toHaveText("One runs out soon");
  await expect(card("mo").getByTestId("hr-tr-summary")).toHaveText("One runs out soon");
  await expect(card("cal").getByTestId("hr-tr-summary")).toHaveText("All in date");
  await expect(card("f_yusuf")).toContainText("Since 2018");
  await expect(card("f_yusuf").locator("[data-cert]")).toHaveCount(6);
  // Rina's first aid: 24 days, a course to book; Cal's working at height: 46 days, just outside.
  const rinaAid = card("rina").locator('[data-cert][data-state="soon"]');
  await expect(rinaAid).toContainText("First aid at work");
  await expect(rinaAid.locator('[data-figure="when"]')).toHaveText("24 days left");
  await expect(rinaAid.getByRole("button", { name: "Book a course: First aid at work, Rina Duval" })).toBeVisible();
  const calHeight = card("cal").locator("[data-cert]", { hasText: "Working at height" });
  await expect(calHeight).toHaveAttribute("data-state", "ok");
  await expect(calHeight.locator('[data-figure="when"]')).toHaveText("46 days left");
  await expect(card("sean").locator('[data-cert][data-state="out"] [data-figure="when"]')).toHaveText("ran out Sun, Jul 12");
  await expect(card("sean").getByRole("link", { name: "Day sheet" })).toHaveAttribute("href", /\/day-sheet\/2026-07-28\/\d+$/);
  await picture(page, "p25b-5-ada-training");
  expect(problems).toEqual([]);
});

test("a certificate added, its course booked, renewed and taken off by the office; the crew member's open screen follows each, live", async ({ as, api, stand, data }) => {
  const desk = await as("ada");
  const phone = await as("cal", PHONE);
  const hers = await desk.newPage();
  const his = await phone.newPage();
  const problems = [...watch(hers), ...watch(his)];
  try {
    await his.goto(`${STAFF}my-certificates`);
    await expect(his.getByTestId("hr-mc-line")).toHaveText("4 certificates. None runs out within 42 days.");
    await hers.goto(`${STAFF}training`);
    const cal = hers.locator(`[data-holder="${stand.people["cal"]!.id}"]`);
    await cal.getByRole("button", { name: "Add a certificate for Cal Brennan" }).click();
    const dialog = hers.locator('[data-dialog="hr-cert"]');
    await dialog.getByLabel("Certificate").fill(NAME);
    await dialog.getByLabel("Valid until").fill("2026-08-10");
    await dialog.getByTestId("hr-cert-save").click();
    await expect(hers.locator(".crm-toast").last()).toHaveText(`${NAME} added for Cal Brennan.`);
    const row = cal.locator("[data-cert]", { hasText: NAME });
    await expect(row.locator('[data-figure="when"]')).toHaveText("13 days left");
    await expect(cal.getByTestId("hr-tr-summary")).toHaveText("One runs out soon");
    await expect(hers.locator('[data-figure="soon"] [data-value]')).toHaveText("3");
    // His screen follows: a fifth, with the chip.
    await expect(his.getByTestId("hr-mc-line")).toHaveText("5 certificates. 1 runs out within 42 days.");
    const mine = his.locator("[data-cert]", { hasText: NAME });
    await expect(mine.getByTestId("hr-mc-chip")).toHaveText("Runs out within 42 days");
    await expect(mine.locator('[data-figure="left"]')).toHaveText("13 days left");

    // She books its course: it still runs out on its day until renewed.
    await row.getByRole("button", { name: `Book a course: ${NAME}, Cal Brennan` }).click();
    await dialog.getByLabel("Course booked for").fill("2026-08-03");
    await dialog.getByTestId("hr-cert-save").click();
    await expect(row.locator('[data-figure="when"]')).toHaveText("13 days left · course Mon, Aug 3");
    await expect(mine.getByTestId("hr-mc-course")).toHaveText("Course booked for Mon, Aug 3");
    await expect(hers.locator('[data-figure="soon"] [data-value]')).toHaveText("3");

    // Renewed: a new last day, the course done.
    await row.getByRole("button", { name: `Change ${NAME} of Cal Brennan` }).click();
    await dialog.getByLabel("Valid until").fill("2029-08-03");
    await dialog.getByLabel("Course booked for").fill("");
    await dialog.getByTestId("hr-cert-save").click();
    await expect(hers.locator(".crm-toast").last()).toHaveText(`${NAME} of Cal Brennan is saved.`);
    await expect(row).toHaveAttribute("data-state", "ok");
    await expect(cal.getByTestId("hr-tr-summary")).toHaveText("All in date");
    await expect(mine.getByTestId("hr-mc-chip")).toHaveCount(0);
    await expect(his.getByTestId("hr-mc-line")).toHaveText("5 certificates. None runs out within 42 days.");

    // Taken off: asked twice.
    await row.getByRole("button", { name: `Change ${NAME} of Cal Brennan` }).click();
    await dialog.getByRole("button", { name: "Take it off" }).click();
    await dialog.getByRole("button", { name: "Take it off for good" }).click();
    await expect(hers.locator(".crm-toast").last()).toHaveText(`${NAME} of Cal Brennan is taken off.`);
    await expect(row).toHaveCount(0);
    await expect(his.locator("[data-cert]", { hasText: NAME })).toHaveCount(0);
    await expect(his.getByTestId("hr-mc-line")).toHaveText("4 certificates. None runs out within 42 days.");
    expect(problems).toEqual([]);
  } finally {
    const ada = await api("ada");
    const headers = await csrf(ada);
    for (const left of await rows<{ id: number }>(ada, data, "certificates", { column: "name", op: "like", value: "zz-hours%" })) await ada.delete(data("certificates", `/${String(left.id)}?confirm=true`), { headers });
  }
});

test("My certificates: his own six, the nearest 125 days off; a crew-mate's is not there for him; nothing to press", async ({ as, stand, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}my-certificates`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My certificates");
  await expect(page.getByTestId("hr-mc-line")).toHaveText("6 certificates. None runs out within 42 days.");
  await expect(page.locator("[data-cert]")).toHaveCount(6);
  const first = page.locator("[data-cert]").first();
  await expect(first).toContainText("Asbestos awareness");
  await expect(first.locator('[data-figure="until"]')).toHaveText("Monday, November 30, 2026");
  await expect(first.locator('[data-figure="left"]')).toHaveText("125 days left");
  await expect(page.getByTestId("hr-mc-chip")).toHaveCount(0);
  await expect(page.locator("#crm-page button")).toHaveCount(0);
  await picture(page, "p25b-6-yusuf-my-certificates");
  // The server: his own six only; Cal's is not there for him; he keeps none of them.
  const me = context.request;
  expect((await rows<{ user_id: string }>(me, data, "certificates")).map((row) => row.user_id)).toEqual(Array(6).fill(stand.people["f_yusuf"]!.id));
  const cals = await rows<{ id: number }>(await (await as("ada")).request, data, "certificates", { column: "user_id", op: "eq", value: stand.people["cal"]!.id });
  expect((await me.get(data("certificates", `/${String(cals[0]!.id)}`))).status()).toBe(404);
  const headers = await csrf(me);
  expect((await me.post(data("certificates"), { data: { values: { user_id: stand.people["f_yusuf"]!.id, name: "zz-hours mine", valid_until: "2030-01-01" } }, headers })).status()).toBe(403);
  expect(problems).toEqual([]);
});

test("refused: Read-only reads Training with nothing to press; a rep and a sales manager are refused the page and the rows by the server", async ({ as, api, stand, data }) => {
  const grace = await (await as("grace")).newPage();
  await grace.goto(`${STAFF}training`);
  await expect(grace.locator("[data-holder]")).toHaveCount(5);
  await expect(grace.getByRole("button", { name: /^Add a certificate/ })).toHaveCount(0);
  await expect(grace.getByRole("button", { name: /^Book a course/ })).toHaveCount(0);
  const readOnly = await api("grace");
  expect((await readOnly.post(data("certificates"), { data: { values: { user_id: stand.people["cal"]!.id, name: "zz-hours no", valid_until: "2030-01-01" } }, headers: await csrf(readOnly) })).status()).toBe(403);
  for (const person of ["dana", "ivy"]) {
    const page = await (await as(person)).newPage();
    await page.goto(`${STAFF}training`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
    const who = await api(person);
    expect((await who.get(data("certificates", "?limit=1"))).status(), person).toBe(403);
  }
  // Nor is the crew's phone theirs.
  const dana = await (await as("dana")).newPage();
  await dana.goto(`${STAFF}my-certificates`);
  await expect(dana.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
});

test("Settings: the part's two numbers on the Crews tab, the admin's and held between bounds by the server; its line on the Parts tab", async ({ as, api, data }) => {
  const page = await (await as("tessa")).newPage();
  const problems = watch(page);
  const tessa = await api("tessa");
  const headers = await csrf(tessa);
  const settings = (await rows<{ id: number; certificate_warn_days: number; inspection_warn_days: number }>(tessa, data, "settings"))[0]!;
  expect([settings.certificate_warn_days, settings.inspection_warn_days].map(Number)).toEqual([42, 30]);
  try {
    await page.goto(`${STAFF}settings/crews`);
    const card = page.locator('[data-card="fleet-numbers"]');
    await expect(card).toContainText("Vehicles and crew");
    const cert = card.locator('[data-setting="certificate_warn_days"] input');
    await expect(cert).toHaveValue("42");
    await expect(card.locator('[data-setting="inspection_warn_days"] input')).toHaveValue("30");
    await cert.fill("45");
    await cert.press("Enter");
    await expect(page.locator(".crm-toast").last()).toContainText("A certificate runs out soon within");
    expect(Number((await rows<{ certificate_warn_days: number }>(tessa, data, "settings"))[0]!.certificate_warn_days)).toBe(45);
    for (const [column, bad] of [["certificate_warn_days", 0], ["certificate_warn_days", 181], ["inspection_warn_days", 0], ["inspection_warn_days", 91]] as const) {
      expect((await tessa.patch(data("settings", `/${String(settings.id)}`), { data: { values: { [column]: bad } }, headers })).status(), `${column} ${String(bad)}`).toBe(422);
    }
    await page.goto(`${STAFF}settings/parts`);
    await expect(page.locator('[data-part="fleet"]')).toContainText("Vehicles, fuel, time sheets, training, subcontractors and insurance claims.");
    expect(problems).toEqual([]);
  } finally {
    expect((await tessa.patch(data("settings", `/${String(settings.id)}`), { data: { values: { certificate_warn_days: 42 } }, headers })).status()).toBe(200);
  }
  // The operations manager reads the numbers and writes none; the server refuses her.
  const ada = await api("ada");
  const hers = await (await as("ada")).newPage();
  await hers.goto(`${STAFF}settings`);
  await expect(hers.locator('[data-card="fleet-numbers"] [data-setting="certificate_warn_days"] input')).toHaveCount(0);
  await expect(hers.locator('[data-card="fleet-numbers"]')).toContainText("42");
  expect((await ada.patch(data("settings", `/${String(settings.id)}`), { data: { values: { certificate_warn_days: 30 } }, headers: await csrf(ada) })).status()).toBe(403);
});

test("in Arabic, dark, 390 wide: Training and My certificates read right to left, fit the phone, and axe finds nothing", async ({ as, api }) => {
  const found: string[] = [];
  for (const [person, path] of [["f_yusuf", "my-certificates"], ["ada", "training"]] as const) {
    const who = await api(person);
    await inArabic(who, async () => {
      const page = await (await as(person, { ...PHONE, colorScheme: "dark" })).newPage();
      const problems = watch(page);
      await page.goto(`${STAFF}${path}`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("[data-cert]").first()).toBeVisible();
      await page.waitForTimeout(1000);
      expect(await narrowEnough(page), path).toBe(true);
      found.push(...(await axe(page)).map((line) => `${path} dark rtl: ${line}`));
      await picture(page, `p25b-7-${person}-arabic-dark`);
      expect(problems).toEqual([]);
    });
    const page = await (await as(person, person === "ada" ? {} : PHONE)).newPage();
    await page.goto(`${STAFF}${path}`);
    await expect(page.locator("[data-cert]").first()).toBeVisible();
    await page.waitForTimeout(1000);
    found.push(...(await axe(page)).map((line) => `${path} light: ${line}`));
  }
  expect(found).toEqual([]);
});
