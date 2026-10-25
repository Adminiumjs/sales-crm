/**
 * Plan 67 gate G2, "The CRM's rules, switched on": on the console's rules page (Automations, narrowed to the CRM) the
 * install's owner switches on "A deal has gone quiet: its owner is told" and "Each week: every sales rep's … own week by
 * email", and presses Test (a dry run: nothing is written, nothing is sent). Then the mornings come, on the stand's own
 * clock: at 08:00 each deal that has gone quiet tells its owner, once (the next morning tells nobody again about it); at
 * 07:00 on Monday each rep's week goes by e-mail (read through the stand's mail catcher), listing only that rep's deals.
 * Both rules are switched off again on the same page, and off whatever happened.
 *
 * Run it on a stand of its own, with mail kept, as the only file (it moves the stand's clock six days on):
 *   CRM_STAND_MAIL=1 CRM_STAND_MAIL_PORT=<port> CRM_STAND_STAGE=3 npx playwright test e2e/zw-rules-on.e2e.ts
 * On any other stand it is skipped.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, watch, type Data } from "./helpers.ts";
import { clearMailbox, LEDGER_TZ, mailbox } from "./stand.mjs";
import { moveStandClock, standNow, until } from "./zw-helpers.ts";

test.describe.configure({ mode: "serial" });

test.beforeEach(({ stand }) => {
  test.skip(stand.mail === undefined, "needs a stand of its own started with CRM_STAND_MAIL=1 (it reads the weekly e-mail, and moves the stand's clock)");
});

interface RuleView {
  id: string;
  name: string;
  enabled: boolean;
  managed?: { key: string; templateKey: string } | null;
}
interface Notice {
  id: string;
  title: string;
  createdAt: number;
}

const QUIET = "nudge-quiet";
const WEEK = "week-rep";
const DAY = 86_400_000;
const REPS = ["dana", "priya", "sam", "leo"];

async function shipped(owner: APIRequestContext, key: string): Promise<RuleView> {
  const rules = ((await (await owner.get("/api/v1/automations")).json()) as { rules: RuleView[] }).rules;
  const rule = rules.find((one) => one.managed?.key === "crm" && one.managed.templateKey === key);
  expect(rule, key).toBeDefined();
  return rule!;
}

async function notices(person: APIRequestContext): Promise<Notice[]> {
  const res = await person.get("/api/v1/me/notifications?limit=100");
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { data: { items: Notice[] } }).data.items;
}

/** The next moment a London wall clock reads `hh:mm` on a day matching `day` (0 = Sunday), after `from`, plus a few seconds. */
function nextLondon(from: number, hhmm: string, day: ((weekday: number) => boolean) = () => true): number {
  const [hours, minutes] = hhmm.split(":").map(Number) as [number, number];
  for (let at = from - (from % 60_000) + 60_000; at < from + 8 * DAY; at += 60_000) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: LEDGER_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts["weekday"]!);
    if (Number(parts["hour"]) === hours && Number(parts["minute"]) === minutes && day(weekday)) return at + 5_000;
  }
  throw new Error(`no ${hhmm} after ${new Date(from).toISOString()}`);
}

/** The open deals that have gone quiet at a moment, as the rule's own words have it: nothing logged for the days set in Settings. */
async function quietAt(owner: APIRequestContext, data: Data, at: number): Promise<{ id: number; name: string; owner_id: string }[]> {
  const [settings] = await rows<{ nudge_quiet_days: number | null }>(owner, data, "settings");
  const days = Number(settings?.nudge_quiet_days ?? 7);
  const open = await rows<{ id: number; name: string; owner_id: string; last_activity_at: string | null }>(owner, data, "deals", { column: "state", op: "eq", value: "open" });
  return open.filter((deal) => deal.last_activity_at !== null && Date.parse(deal.last_activity_at) < at - days * DAY);
}

async function switchFromPage(page: Page, rule: RuleView, on: boolean): Promise<void> {
  const toggle = page.getByTestId(`rule-toggle-${rule.id}`);
  await expect(toggle).toHaveAttribute("aria-checked", on ? "false" : "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", on ? "true" : "false");
}

test("switched on, tested, and their mornings come: a quiet deal's owner told once; each rep's week, only theirs, by e-mail", async ({ as, api, data, stand }) => {
  test.setTimeout(600_000);
  const owner = await api("owner");
  const quiet = await shipped(owner, QUIET);
  const week = await shipped(owner, WEEK);
  expect([quiet.enabled, week.enabled]).toEqual([false, false]);
  const people = Object.fromEntries(await Promise.all(Object.keys(stand.people).filter((key) => stand.people[key]!.sample !== true).map(async (key) => [key, await api(key)] as const)));
  const before = Object.fromEntries(await Promise.all(Object.entries(people).map(async ([key, person]) => [key, (await notices(person)).map((one) => one.id)] as const)));
  const startedAt = await standNow(owner);
  const page = await (await as("owner")).newPage();
  const problems = watch(page);
  try {
    // The rules page, narrowed to the app: both shipped rules, off; switched on here.
    await page.goto("/automations?app=crm");
    await expect(page.getByTestId("app-filter-note")).toContainText("Only the rules of Sales CRM are shown.");
    const fromApps = page.locator('[data-part="rules-shipped-app"]');
    await expect(fromApps.getByTestId(`rule-card-${quiet.id}`)).toContainText("A deal has gone quiet: its owner is told");
    await expect(fromApps.getByTestId(`rule-card-${week.id}`)).toContainText("Each week: every sales rep’s and account manager’s own week by email");
    await switchFromPage(page, quiet, true);
    await switchFromPage(page, week, true);
    await expect.poll(async () => [(await shipped(owner, QUIET)).enabled, (await shipped(owner, WEEK)).enabled]).toEqual([true, true]);

    // Test: a dry run of the quiet-deal rule on one deal. Nothing is told.
    await page.getByTestId(`rule-card-${quiet.id}`).click();
    await expect(page.locator('[data-part="rule-shipped-note"]')).toContainText("This rule came with Sales CRM.");
    const tested = page.waitForResponse((res) => res.url().endsWith(`/api/v1/automations/${quiet.id}/test`));
    await page.getByTestId("rule-test").click();
    const trace = (await (await tested).json()) as unknown;
    expect((await tested).status(), JSON.stringify(trace).slice(0, 600)).toBe(200);
    await expect(page.getByTestId("rule-test")).toHaveText("Test");
    await picture(page, "zw-rules-on-tested");
    for (const [key, person] of Object.entries(people)) expect((await notices(person)).filter((one) => !before[key]!.includes(one.id)), `${key}: a test tells nobody`).toEqual([]);

    // Wednesday, 08:00: each deal gone quiet tells its owner, once.
    const wednesday = nextLondon(await standNow(owner), "08:00");
    const goneQuiet = await quietAt(owner, data as Data, wednesday);
    expect(goneQuiet.length, "the sample has deals gone quiet").toBeGreaterThan(0);
    await clearMailbox();
    expect(moveStandClock(wednesday)).toBe(true);
    const ownerOf = (deal: { owner_id: string }) => Object.keys(people).find((key) => stand.people[key]!.id === deal.owner_id)!;
    const toldAbout = async (key: string): Promise<string[]> => (await notices(people[key]!)).filter((one) => !before[key]!.includes(one.id) && one.title.startsWith("Gone quiet: ")).map((one) => one.title.slice("Gone quiet: ".length));
    const last = goneQuiet.at(-1)!;
    await until(() => toldAbout(ownerOf(last)), (titles) => titles.includes(last.name), 150_000, 3000);
    await new Promise((done) => setTimeout(done, 5000));
    for (const key of Object.keys(people)) {
      const mine = goneQuiet.filter((deal) => deal.owner_id === stand.people[key]!.id).map((deal) => deal.name).sort();
      expect((await toldAbout(key)).sort(), `${key} is told once about each of their deals gone quiet, and about no other`).toEqual(mine);
    }

    // Thursday, 08:00: nothing more about those (once each time a deal goes quiet).
    const thursday = nextLondon(wednesday, "08:00");
    const quietThursday = await quietAt(owner, data as Data, thursday);
    expect(moveStandClock(thursday)).toBe(true);
    // The rules' clock ticks each minute (and up to ten seconds late): two ticks' time.
    await new Promise((done) => setTimeout(done, 75_000));
    for (const key of Object.keys(people)) {
      const told = await toldAbout(key);
      for (const deal of goneQuiet.filter((one) => one.owner_id === stand.people[key]!.id)) expect(told.filter((name) => name === deal.name), `${key}: ${deal.name} once`).toHaveLength(1);
      const newlyQuiet = quietThursday.filter((deal) => deal.owner_id === stand.people[key]!.id && !goneQuiet.some((one) => one.id === deal.id)).map((deal) => deal.name);
      for (const name of newlyQuiet) expect(told, `${key}: ${name} went quiet on Thursday`).toContain(name);
    }

    // Monday, 07:00: each rep's own week by e-mail, listing only their deals.
    const monday = nextLondon(thursday, "07:00", (weekday) => weekday === 1);
    const openDeals = await rows<{ id: number; name: string; owner_id: string }>(owner, data as Data, "deals", { column: "state", op: "eq", value: "open" });
    expect(moveStandClock(monday)).toBe(true);
    const weekMails = await until(
      async () => (await mailbox()).filter((mail) => REPS.some((rep) => mail.to.includes(stand.people[rep]!.email))),
      (mails) => REPS.every((rep) => mails.some((mail) => mail.to.includes(stand.people[rep]!.email))),
      180_000,
      3000,
    );
    for (const rep of REPS) {
      const mine = weekMails.filter((mail) => mail.to.includes(stand.people[rep]!.email));
      expect(mine, `${rep} has one week's e-mail`).toHaveLength(1);
      const text = `${mine[0]!.html}\n${mine[0]!.text}`;
      const own = openDeals.filter((deal) => deal.owner_id === stand.people[rep]!.id);
      const others = openDeals.filter((deal) => deal.owner_id !== stand.people[rep]!.id && !own.some((one) => one.name.includes(deal.name) || deal.name.includes(one.name)));
      expect(own.length, `${rep} owns open deals`).toBeGreaterThan(0);
      expect(own.filter((deal) => text.includes(deal.name)).length, `${rep}'s mail lists their own deals`).toBeGreaterThan(0);
      expect(others.filter((deal) => text.includes(deal.name)).map((deal) => deal.name), `${rep}'s mail lists nobody else's deals`).toEqual([]);
    }

    // Both off again, on the same page.
    await page.goto("/automations?app=crm");
    await switchFromPage(page, quiet, false);
    await switchFromPage(page, week, false);
    expect(problems).toEqual([]);
  } finally {
    const headers = await csrf(owner);
    for (const rule of [quiet, week]) await owner.patch(`/api/v1/automations/${rule.id}`, { data: { enabled: false }, headers });
    moveStandClock(startedAt + 60_000);
  }
  expect([(await shipped(owner, QUIET)).enabled, (await shipped(owner, WEEK)).enabled]).toEqual([false, false]);
});
