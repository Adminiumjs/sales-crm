/**
 * Walks "My hours on a phone" and "My certificates on a phone" (P26), at 390
 * wide in Arabic, right to left, by touch. `hours-week.e2e.ts` and
 * `hours-training.e2e.ts` prove the two screens whole in English (the week
 * written, sent, sent back, signed off, live on both sides; the server's
 * refusals once sent; the certificates soonest first, the chip, the course,
 * the setting's bounds; Arabic and dark only as a look with axe). What is
 * added here is the walk in Arabic:
 *
 *  - My hours, as Cal on his phone: a day added and a line changed by touch,
 *    hours typed in Arabic digits; the week sent; the office (in English)
 *    sends it back with a note, which his phone shows; he changes it and
 *    sends again; the office signs it off. Once sent no line has a Change
 *    button and nothing can be added. The week's dates, each line's hours,
 *    the totals and the toasts' days are the Arabic ones (the browser's own
 *    `Intl` for ar-EG, not the app's formatter).
 *  - My certificates, as Yusuf: soonest first; a certificate the office adds
 *    that runs out in 30 days, with a course booked, carries the "runs out
 *    soon" chip at 42 days and the course's day; the CRM admin sets the
 *    setting to 20 on the Crews tab, he looks again and the chip is gone; 42
 *    again and it is back. Nothing to press.
 *
 * What it writes it takes away: the week (as the install's owner; a signed-off
 * week the server keeps is said, as `hours-week.e2e.ts` says it), the
 * certificate, the setting back at 42, both people back in English.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { hours } from "../src/i18n/strings/hours.ts";
import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { asOwner } from "./zw-helpers.ts";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const SAMPLE_WEEK = "2026-07-20";
const CERT = "zw-ar Working at height";

/** An Arabic string of the app's, its `{names}` filled. */
const ar = (key: keyof (typeof hours)["ar-EG"], vars: Record<string, string> = {}): string => hours["ar-EG"][key].replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);

const addDays = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** How the browser's own Intl writes a day and a number in Arabic (Egypt), where the business is. */
const arabic = (page: Page) => ({
  dayShort: (day: string): Promise<string> => page.evaluate((d) => new Intl.DateTimeFormat("ar-EG", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(`${d}T12:00:00Z`)), day),
  number: (n: number): Promise<string> => page.evaluate((v) => new Intl.NumberFormat("ar-EG").format(v), n),
});

test.skip(({ stand }) => !stand.parts.includes("fleet"), "Vehicles and crew arrives with stage 3: run with CRM_STAND_STAGE=3");

test("My hours on a phone, in Arabic: a day added and a line changed by touch, sent; sent back with a note the phone shows; sent again and signed off; the dates and totals Arabic", async ({ as, api, stand, data }) => {
  test.setTimeout(300_000);
  const calId = stand.people["cal"]!.id;
  const ada = await api("ada");
  const cal = await api("cal");
  const taken = new Set((await rows<{ week_of: string }>(ada, data, "time_sheets", { column: "user_id", op: "eq", value: calId })).map((row) => String(row.week_of).slice(0, 10)));
  let week = addDays(SAMPLE_WEEK, -7);
  while (taken.has(week)) week = addDays(week, -7);
  const [monday, tuesday, friday] = [week, addDays(week, 1), addDays(week, 4)];
  let sheetId: number | null = null;
  await inArabic(cal, async () => {
    const phone = await as("cal", PHONE);
    const desk = await as("ada");
    const his = await phone.newPage();
    const hers = await desk.newPage();
    const problems = [...watch(his), ...watch(hers)];
    const intl = arabic(his);
    try {
      await his.goto(`${STAFF}my-hours/${week}`);
      await expect(his.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(his.getByTestId("hr-mh-week")).toHaveText(`${await intl.dayShort(monday)} – ${await intl.dayShort(friday)}`);
      await expect(his.getByTestId("hr-mh-state")).toHaveText(ar("hr.mine.open"));
      await hers.goto(`${STAFF}time-sheets/${week}`);
      const row = hers.locator(`[data-sheet-of="${calId}"]`);
      await expect(row.getByTestId("hr-ts-state")).toHaveText("Nothing written");

      // Monday, by touch, the hours in Arabic digits: six and a half on site, one of travel.
      const dialog = his.locator('[data-dialog="hr-line"]');
      const write = async (day: string, what: string, onSite: string, travel: string): Promise<void> => {
        await his.getByRole("button", { name: ar("hr.mh.add") }).tap();
        await dialog.locator("select").first().selectOption(day);
        await dialog.getByLabel(ar("hr.mh.what")).fill(what);
        await dialog.getByLabel(ar("hr.mh.hours")).fill(onSite);
        await dialog.getByLabel(ar("hr.mh.travelHours")).fill(travel);
        await dialog.getByTestId("hr-line-save").tap();
        await expect(his.locator(".crm-toast").last()).toHaveText(ar("hr.mh.line.added", { day: await intl.dayShort(day) }));
      };
      await write(monday, "zw-ar: المستودع، أسطح الطاولات", "٦٫٥", "١");
      const sheet = (await rows<{ id: number }>(ada, data, "time_sheets", { and: [{ column: "user_id", op: "eq", value: calId }, { column: "week_of", op: "eq", value: week }] }))[0]!;
      sheetId = sheet.id;
      const line = his.locator("[data-line]").first();
      await expect(line.locator('[data-figure="hours"]')).toHaveText(ar("hr.h", { n: await intl.number(6.5) }));
      await expect(line.locator('[data-figure="travel"]')).toHaveText(ar("hr.h", { n: await intl.number(1) }));
      // Tuesday too.
      await write(tuesday, "zw-ar: كامبريدج، التركيب", "٨", "٠٫٥");
      const totals = his.getByTestId("hr-mh-totals");
      await expect(totals.locator('[data-figure="onsite"]')).toHaveText(ar("hr.h", { n: await intl.number(14.5) }));
      await expect(totals.locator('[data-figure="travel"]')).toHaveText(ar("hr.h", { n: await intl.number(1.5) }));
      await expect(totals.locator('[data-figure="total"]')).toHaveText(ar("hr.h", { n: await intl.number(16) }));
      // Monday's line changed by touch: seven on site.
      await his.getByRole("button", { name: ar("hr.mh.change.label", { day: await intl.dayShort(monday) }) }).tap();
      await dialog.getByLabel(ar("hr.mh.hours")).fill("٧");
      await dialog.getByTestId("hr-line-save").tap();
      await expect(his.locator(".crm-toast").last()).toHaveText(ar("hr.mh.line.changed", { day: await intl.dayShort(monday) }));
      await expect(totals.locator('[data-figure="total"]')).toHaveText(ar("hr.h", { n: await intl.number(16.5) }));
      // The server holds what was typed in Arabic digits as numbers.
      const held = await rows<{ day: string; hours: number; travel_hours: number }>(ada, data as Data, "time_sheet_lines", { column: "sheet_id", op: "eq", value: sheet.id }, "&order=day");
      expect(held.map((one) => [String(one.day).slice(0, 10), Number(one.hours), Number(one.travel_hours)])).toEqual([[monday, 7, 1], [tuesday, 8, 0.5]]);
      // No Latin digit in a figure of the week.
      expect(await his.locator('[data-figure], [data-testid="hr-mh-week"]').allInnerTexts()).not.toContainEqual(expect.stringMatching(/[0-9]/));
      expect(await his.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await picture(his, "zw-ar-1-cal-my-hours-written");

      // Sent: nothing of it is his to change or add to any more.
      await his.getByTestId("hr-mh-send").tap();
      await expect(his.getByTestId("hr-mh-state")).toHaveText(ar("hr.mine.sent"));
      await expect(his.getByRole("button", { name: ar("hr.mh.add") })).toHaveCount(0);
      await expect(his.getByRole("button", { name: new RegExp(`^${ar("hr.mh.change.label", { day: "" })}`) })).toHaveCount(0);
      await expect(row.getByTestId("hr-ts-state")).toHaveText("To sign off");

      // The office sends it back with a note; his phone shows it, right to left.
      const note = "zw-ar: كان يوم الاثنين ست ساعات في الموقع.";
      await row.getByPlaceholder("A note for Cal if you send it back").fill(note);
      await row.getByRole("button", { name: "Send it back" }).click();
      await expect(row.getByTestId("hr-ts-state")).toHaveText("Sent back");
      await expect(his.getByTestId("hr-mh-state")).toHaveText(ar("hr.mine.sent-back"));
      await expect(his.locator(".crm-hr-back")).toHaveText(ar("hr.mh.line.back"));
      await expect(his.getByTestId("hr-mh-backnote")).toHaveText(note);
      expect(await his.getByTestId("hr-mh-backnote").evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
      await picture(his, "zw-ar-2-cal-sent-back");

      // He puts Monday right and sends it again; the office signs it off.
      await his.getByRole("button", { name: ar("hr.mh.change.label", { day: await intl.dayShort(monday) }) }).tap();
      await dialog.getByLabel(ar("hr.mh.hours")).fill("٦");
      await dialog.getByTestId("hr-line-save").tap();
      await expect(totals.locator('[data-figure="total"]')).toHaveText(ar("hr.h", { n: await intl.number(15.5) }));
      await expect(his.getByTestId("hr-mh-send")).toHaveText(ar("hr.mh.again"));
      await his.getByTestId("hr-mh-send").tap();
      await expect(row.getByTestId("hr-ts-state")).toHaveText("To sign off");
      await row.getByRole("button", { name: "Sign it off" }).click();
      await expect(row.getByTestId("hr-ts-state")).toHaveText("Signed off");
      await expect(his.getByTestId("hr-mh-state")).toHaveText(ar("hr.mine.signed-off"));
      const signedAt = (await rows<{ signed_at: string }>(ada, data, "time_sheets", { column: "id", op: "eq", value: sheet.id }))[0]!.signed_at;
      const signedDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(signedAt));
      await expect(his.getByTestId("hr-mh-signed")).toHaveText(ar("hr.mh.line.signedByOn", { name: "Ada Novak", day: await intl.dayShort(signedDay) }));
      await expect(his.getByRole("button", { name: new RegExp(`^${ar("hr.mh.change.label", { day: "" })}`) })).toHaveCount(0);
      await expect(his.getByTestId("hr-mh-send")).toHaveCount(0);
      expect(await his.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await picture(his, "zw-ar-3-cal-signed-off");
      expect(problems).toEqual([]);
    } finally {
      await phone.close();
      await desk.close();
    }
  }).finally(async () => {
    if (sheetId !== null) await takeAwayWeek(data, sheetId);
  });
});

/** The week this spec made, taken away as the install's owner when the server lets anybody (a signed-off week it keeps is said). */
async function takeAwayWeek(data: Data, sheetId: number): Promise<void> {
  const owner: APIRequestContext = await asOwner();
  const headers = await csrf(owner);
  for (const line of await rows<{ id: number }>(owner, data, "time_sheet_lines", { column: "sheet_id", op: "eq", value: sheetId }).catch(() => [])) await owner.delete(data("time_sheet_lines", `/${String(line.id)}?confirm=true`), { headers });
  const gone = await owner.delete(data("time_sheets", `/${String(sheetId)}?confirm=true`), { headers });
  if (gone.status() >= 300) console.info(`[zw-phone-ar] the signed-off week ${String(sheetId)} stays: the server keeps a locked row (${String(gone.status())}).`);
}

test("My certificates on a phone, in Arabic: soonest first, the chip at 42 days and gone at 20 (the Crews tab), a booked course's day; nothing to press", async ({ as, api, stand, data }) => {
  test.setTimeout(240_000);
  const yusufId = stand.people["f_yusuf"]!.id;
  const ada = await api("ada");
  const tessa = await api("tessa");
  const yusuf = await api("f_yusuf");
  const settings = (await rows<{ id: number; certificate_warn_days: number }>(tessa, data, "settings"))[0]!;
  expect(Number(settings.certificate_warn_days)).toBe(42);
  for (const left of await rows<{ id: number }>(ada, data, "certificates", { column: "name", op: "like", value: "zw-ar%" })) await ada.delete(data("certificates", `/${String(left.id)}?confirm=true`), { headers: await csrf(ada) });
  // One the office adds for him: it runs out in 30 days (Thu 27 Aug), its course booked for Thu 20 Aug.
  const made = await ada.post(data("certificates"), { data: { values: { user_id: yusufId, name: CERT, valid_until: "2026-08-27", course_on: "2026-08-20" } }, headers: await csrf(ada) });
  expect(made.status(), await made.text()).toBe(201);
  const certId = ((await made.json()) as { data: { id: number } }).data.id;
  try {
    await inArabic(yusuf, async () => {
      const page = await (await as("f_yusuf", PHONE)).newPage();
      const problems = watch(page);
      const intl = arabic(page);
      await page.goto(`${STAFF}my-certificates`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(ar("hr.mc.title"));
      // Soonest first: the order of the server's last days.
      const mine = await rows<{ name: string; valid_until: string }>(yusuf, data, "certificates");
      const soonest = [...mine].sort((a, b) => String(a.valid_until).localeCompare(String(b.valid_until)));
      await expect(page.locator("[data-cert]")).toHaveCount(mine.length);
      const names = await page.locator("[data-cert]").evaluateAll((cards) => cards.map((card) => card.textContent ?? ""));
      soonest.forEach((cert, i) => expect(names[i], `#${String(i + 1)} is ${cert.name}`).toContain(cert.name));
      // The first: the chip at 42 days, the days left and the course's day, in Arabic.
      const first = page.locator("[data-cert]").first();
      await expect(first).toContainText(CERT);
      await expect(first.getByTestId("hr-mc-chip")).toHaveText(ar("hr.cert.soon", { days: await intl.number(42) }));
      await expect(first.locator('[data-figure="left"]')).toContainText(await intl.number(30));
      await expect(first.getByTestId("hr-mc-course")).toHaveText(ar("hr.cert.course", { day: await intl.dayShort("2026-08-20") }));
      await expect(page.getByTestId("hr-mc-chip")).toHaveCount(1);
      await expect(page.locator("#crm-page button")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await picture(page, "zw-ar-4-yusuf-certificates-42");

      // The CRM admin sets the setting to 20 days on the Crews tab; he looks again: no chip.
      const desk = await (await as("tessa")).newPage();
      const setTo = async (days: number): Promise<void> => {
        await desk.goto(`${STAFF}settings/crews`);
        const field = desk.locator('[data-card="fleet-numbers"] [data-setting="certificate_warn_days"] input');
        await field.fill(String(days));
        await field.press("Enter");
        await expect(desk.locator(".crm-toast").last()).toContainText("A certificate runs out soon within");
        await expect.poll(async () => Number((await rows<{ certificate_warn_days: number }>(tessa, data, "settings"))[0]!.certificate_warn_days)).toBe(days);
      };
      await setTo(20);
      await page.reload();
      await expect(page.locator("[data-cert]").first()).toContainText(CERT);
      await expect(page.getByTestId("hr-mc-chip")).toHaveCount(0);
      await expect(page.locator("[data-cert]").first().getByTestId("hr-mc-course")).toBeVisible();
      await picture(page, "zw-ar-5-yusuf-certificates-20");
      // Back at 42: the chip is back.
      await setTo(42);
      await page.reload();
      await expect(page.locator("[data-cert]").first().getByTestId("hr-mc-chip")).toHaveText(ar("hr.cert.soon", { days: await intl.number(42) }));
      await expect(page.locator("#crm-page button")).toHaveCount(0);
      expect(problems).toEqual([]);
      await desk.context().close();
    });
  } finally {
    const back = await tessa.patch(data("settings", `/${String(settings.id)}`), { data: { values: { certificate_warn_days: 42 } }, headers: await csrf(tessa) });
    expect(back.status(), await back.text()).toBe(200);
    await ada.delete(data("certificates", `/${String(certId)}?confirm=true`), { headers: await csrf(ada) });
  }
});
