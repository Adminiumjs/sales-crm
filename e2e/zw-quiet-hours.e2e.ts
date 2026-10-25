/**
 * Plan 67 gate G2, "Quiet hours": Account → Notifications → the Quiet hours and Summaries cards, as Grace (a sample
 * person of the CRM), in English and in Arabic (the cards laid out right to left). 18:00 to 08:00 on weekdays, by
 * setting Monday, copying it to every day and taking the weekend off; a day and a time for summaries; a reload keeps it
 * all, as the server does.
 *
 * Every change is saved as it is made (the cards have no Save button). Grace's schedule is put back as it was.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, watch } from "./helpers.ts";
import { inLanguage, words, type ConsoleLocale } from "./zw-helpers.ts";

interface Schedule {
  timezone: string | null;
  quiet: Record<string, { from: string; to: string }> | null;
  digestDay: number | null;
  digestTime: string | null;
  quietOn: boolean;
  summariesOn: boolean;
}

const PERSON = "grace";
const WEEKDAYS = ["1", "2", "3", "4", "5"];

async function schedule(person: APIRequestContext): Promise<Schedule> {
  const res = await person.get("/api/v1/me/notification-schedule");
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { data: Schedule }).data;
}

async function putSchedule(person: APIRequestContext, next: Schedule): Promise<void> {
  const { timezone, quiet, digestDay, digestTime, quietOn, summariesOn } = next;
  const res = await person.put("/api/v1/me/notification-schedule", { data: { timezone, quiet, digestDay, digestTime, quietOn, summariesOn }, headers: await csrf(person) });
  expect(res.status(), await res.text()).toBe(200);
}

/** A weekday's name as the page writes it, in the page's own language (0 = Sunday). */
const dayName = (page: Page, day: string): Promise<string> => page.evaluate((one) => new Intl.DateTimeFormat(document.documentElement.lang || undefined, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 1, 1 + Number(one)))), day);

for (const [locale, dir] of [["en-US", "ltr"], ["ar-EG", "rtl"]] as [ConsoleLocale, string][]) {
  test(`quiet hours 18:00–08:00 on weekdays, copied from Monday, summaries on Friday at 16:30, kept over a reload (${locale})`, async ({ as, api }) => {
    test.setTimeout(150_000);
    const person = await api(PERSON);
    const say = words(locale);
    const before = await schedule(person);
    await putSchedule(person, { ...before, timezone: null, quiet: null, digestDay: null, digestTime: null, quietOn: true, summariesOn: true });
    try {
      await inLanguage(person, locale, async () => {
        const page = await (await as(PERSON)).newPage();
        const problems = watch(page);
        await page.goto("/account/notifications");
        const quiet = page.getByTestId("quiet-hours");
        await expect(quiet.getByRole("heading", { name: say("quietHours.title") })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
        await expect(quiet.getByTestId("quiet-lead")).toHaveText(say("quietHours.leadOff"));

        // On: every evening to start with.
        await quiet.getByRole("switch", { name: say("quietHours.title") }).click();
        await expect(quiet.getByTestId("quiet-lead")).toHaveText(say("quietHours.leadOn"));
        await expect.poll(async () => Object.keys((await schedule(person)).quiet ?? {}).length).toBe(7);

        // Monday from 18:00, then Monday's times on every day.
        const [monday, tuesday] = [await dayName(page, "1"), await dayName(page, "2")];
        await quiet.getByLabel(say("quietHours.from", { day: monday })).fill("18:00");
        await expect.poll(async () => (await schedule(person)).quiet?.["1"]).toEqual({ from: "18:00", to: "08:00" });
        await expect(quiet.getByTestId("quiet-copy")).toHaveText(say("quietHours.copy", { day: monday }));
        await quiet.getByTestId("quiet-copy").click();
        await expect.poll(async () => Object.values((await schedule(person)).quiet ?? {}).every((window) => window.from === "18:00" && window.to === "08:00")).toBe(true);

        // The weekend off.
        for (const day of ["6", "0"]) {
          await quiet.getByTestId(`quiet-day-${day}`).click();
          await expect(quiet.getByTestId(`quiet-day-${day}`)).toHaveAttribute("aria-checked", "false");
        }
        await expect.poll(async () => Object.keys((await schedule(person)).quiet ?? {}).sort()).toEqual(WEEKDAYS);
        await expect(quiet.locator('[data-day="1"]')).toContainText(say("quietHours.endsOn", { day: tuesday }));
        await expect(quiet.getByTestId("quiet-example")).toHaveText(say("quietHours.example", { from: "18:00", day: monday, to: "08:00", endDay: tuesday }));

        // Summaries: on Friday at 16:30.
        const summaries = page.getByTestId("summaries");
        await summaries.getByTestId("digest-day").selectOption("5");
        await expect.poll(async () => (await schedule(person)).digestDay).toBe(5);
        await summaries.getByTestId("digest-time").fill("16:30");
        await expect.poll(async () => (await schedule(person)).digestTime).toBe("16:30");
        await picture(page, `zw-quiet-hours-${locale}`);

        // A reload: the cards draw what the server keeps.
        await page.reload();
        const again = page.getByTestId("quiet-hours");
        await expect(again.getByRole("switch", { name: say("quietHours.title") })).toHaveAttribute("aria-checked", "true");
        for (const day of WEEKDAYS) {
          const name = await dayName(page, day);
          await expect(again.getByTestId(`quiet-day-${day}`)).toHaveAttribute("aria-checked", "true");
          await expect(again.getByLabel(say("quietHours.from", { day: name }))).toHaveValue("18:00");
          await expect(again.getByLabel(say("quietHours.to", { day: name }))).toHaveValue("08:00");
        }
        for (const day of ["6", "0"]) await expect(again.getByTestId(`quiet-day-${day}`)).toHaveAttribute("aria-checked", "false");
        await expect(page.getByTestId("digest-day")).toHaveValue("5");
        await expect(page.getByTestId("digest-time")).toHaveValue("16:30");
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
        // Laid out from the reading's start: in Arabic the switch is on the card's left, its title on the right.
        const [title, toggle] = [await again.getByRole("heading", { name: say("quietHours.title") }).boundingBox(), await again.getByRole("switch", { name: say("quietHours.title") }).boundingBox()];
        expect(title !== null && toggle !== null && (dir === "rtl" ? toggle.x < title.x : toggle.x > title.x), "the card reads from its start").toBe(true);
        const held = await schedule(person);
        expect(held).toMatchObject({ quietOn: true, summariesOn: true, digestDay: 5, digestTime: "16:30" });
        expect(held.quiet).toEqual(Object.fromEntries(WEEKDAYS.map((day) => [day, { from: "18:00", to: "08:00" }])));
        expect(held.timezone).not.toBeNull();
        expect(problems).toEqual([]);
      });
    } finally {
      await putSchedule(person, before);
    }
  });
}
