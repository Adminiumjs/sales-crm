/**
 * P11, Nudges (ledger §17): quiet 2 (d8, d12), stuck 2 (d5, d12), soon 1
 * (d6); 4 deals caught of 14 open.
 *
 * Ten of the app's rules ship switched off (ruling R7). Only somebody who may
 * manage Adminium's automations reads whether a rule is on: the install's
 * owner is told each rule's real state; the sales manager and the CRM admin
 * are told who decides, and nothing is guessed.
 *
 * WHAT THESE SPECS CHANGE, AND PUT BACK: the nudge thresholds of the one
 * settings row (back to 7 / 21 / 7), the CRM admin's own snoozes (removed), a rule
 * switched on by the owner (off again), and one comment on d12 (removed by
 * the CRM admin). The notice Leo gets from that comment stays; no spec reads
 * his bell.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

const rule = (page: Page, id: string) => page.locator(`.crm-ndg-rule[data-rule="${id}"]`);
const group = (page: Page, id: string) => page.locator(`.crm-panel[data-group="${id}"]`);
const caught = (page: Page) => page.locator('.crm-screen-head [data-figure="caught"]');

async function restore(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  expect((await admin.patch(data("settings", "/1"), { data: { values: { nudge_quiet_days: 7, nudge_stuck_days: 21, nudge_soon_days: 7 } }, headers })).status()).toBe(200);
}
async function unsnooze(person: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(person);
  for (const row of await rows<{ id: number }>(person, data, "nudge_snoozes")) expect((await person.delete(data("nudge_snoozes", `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
}

test("Nudges: the ledger's four deals caught, and who decides whether owners are told", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Nudges" }).click();
  await expect(page).toHaveURL(/\/nudges$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nudges");
  await expect(caught(page)).toHaveText("4 deals caught of 14 open");
  for (const [id, days, count] of [["quiet", "7 days", "2 caught"], ["stuck", "21 days", "2 caught"], ["soon", "7 days", "1 caught"]] as const) {
    await expect(rule(page, id).locator('[data-figure="days"]')).toHaveText(days);
    await expect(rule(page, id).locator('[data-figure="caught"]')).toHaveText(count);
  }
  // A sales manager cannot read a rule's switch, and the page says so instead of guessing.
  const state = page.locator(".crm-ndg-state");
  await expect(state).toHaveAttribute("data-rules", "unknown");
  await expect(state).toContainText("Whether owners are told by themselves is set by the person who runs this install");
  await expect(state).toContainText("this page cannot read which are on");
  await expect(page.locator(".crm-ndg-rule-state")).toHaveCount(0);
  await expect(page.getByText(/switched off for this install/i)).toHaveCount(0);
  // The deals, the longest waiting first.
  await expect(group(page, "quiet").locator(".crm-ndg-deal")).toHaveCount(2);
  await expect(group(page, "quiet").locator(".crm-ndg-deal").nth(0)).toContainText("Depot supervisor stations");
  await expect(group(page, "quiet").locator(".crm-ndg-deal").nth(0)).toContainText("13 days quiet");
  await expect(group(page, "quiet").locator(".crm-ndg-deal").nth(0)).toContainText("Last logged Wed, Jul 15. Qualified since Wed, Jun 24.");
  await expect(group(page, "quiet").locator(".crm-ndg-deal").nth(1)).toContainText("Lab bench stools");
  await expect(group(page, "quiet").locator(".crm-ndg-deal").nth(1)).toContainText("8 days quiet");
  await expect(group(page, "stuck").locator(".crm-ndg-deal").nth(0)).toContainText("Depot supervisor stations");
  await expect(group(page, "stuck").locator(".crm-ndg-deal").nth(0)).toContainText("sitting 34 days");
  await expect(group(page, "stuck").locator(".crm-ndg-deal").nth(1)).toContainText("Showroom refit, phase one");
  await expect(group(page, "stuck").locator(".crm-ndg-deal").nth(1)).toContainText("sitting 32 days");
  await expect(group(page, "stuck").locator(".crm-ndg-deal").nth(1)).toContainText("In Proposal since Fri, Jun 26. Expected close Fri, Sep 11.");
  await expect(group(page, "soon").locator(".crm-ndg-deal")).toHaveCount(1);
  await expect(group(page, "soon").locator(".crm-ndg-deal")).toContainText("Analyst pods, second floor");
  await expect(group(page, "soon").locator(".crm-ndg-deal")).toContainText("2 days to close");
  await expect(group(page, "soon").locator(".crm-ndg-deal")).toContainText("Closes Thu, Jul 30 and still at Negotiation.");
  await expect(group(page, "soon").locator(".crm-ndg-deal")).toContainText("£21,600");
  // The one refusal on the page is the one it tells the reader about: a sales manager may not read Adminium's automations.
  expect(problems).toEqual(["Failed to load resource: the server responded with a status of 403 (Forbidden)"]);
  await picture(page, "1-ivy-nudges");
});

test("a rule's real state: the install's owner is told each one, and sees one switched on", async ({ as, api, stand }) => {
  const owner = await api("owner");
  const headers = await csrf(owner);
  const list = async () => ((await (await owner.get(`/api/v1/automations?connectionId=${stand.connectionId}`)).json()) as { rules: { id: string; enabled: boolean; managed: { templateKey: string } | null }[] }).rules;
  const quiet = (await list()).find((one) => one.managed?.templateKey === "nudge-quiet")!;
  expect(quiet.enabled, "the rule ships switched off").toBe(false);
  // The people of the app's own roles cannot read it: the gap the page's honest line rests on.
  for (const person of ["ivy", "tessa"]) expect((await (await api(person)).get(`/api/v1/automations?connectionId=${stand.connectionId}`)).status(), person).toBe(403);

  const page = await (await as("owner")).newPage();
  await page.goto(`${STAFF}nudges`);
  await expect(caught(page)).toHaveText("4 deals caught of 14 open");
  await expect(page.locator(".crm-ndg-state")).toHaveAttribute("data-rules", "off");
  await expect(page.locator(".crm-ndg-state")).toContainText("Telling owners is switched off for this install");
  for (const id of ["quiet", "stuck", "soon"]) await expect(page.locator(`.crm-ndg-rule[data-rule="${id}"] .crm-ndg-rule-state`)).toHaveText("Switched off for this install");
  await picture(page, "2-owner-nudges-rules-off");
  try {
    expect((await owner.patch(`/api/v1/automations/${quiet.id}`, { data: { enabled: true }, headers })).status()).toBe(200);
    await page.reload();
    await expect(rule(page, "quiet").locator(".crm-ndg-rule-state")).toHaveText("Switched on: the owner is told");
    await expect(rule(page, "stuck").locator(".crm-ndg-rule-state")).toHaveText("Switched off for this install");
    // Not all off any more: no banner claims they are.
    await expect(page.locator(".crm-ndg-state")).toHaveCount(0);
  } finally {
    expect((await owner.patch(`/api/v1/automations/${quiet.id}`, { data: { enabled: false }, headers })).status()).toBe(200);
  }
  expect((await list()).find((one) => one.id === quiet.id)!.enabled).toBe(false);
});

test("a threshold moved moves the list, for the CRM admin by keyboard and live for the sales manager, who may move it too; a rep may not", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await restore(admin, data);
  const ivy = await (await as("ivy")).newPage();
  const tessa = await (await as("tessa")).newPage();
  try {
    await ivy.goto(`${STAFF}nudges`);
    await expect(caught(ivy)).toHaveText("4 deals caught of 14 open");
    // The admin reaches it from her Settings group, as "Nudge rules".
    await tessa.goto(STAFF);
    await unfoldMenu(tessa);
    await tessa.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Nudge rules" }).click();
    await expect(caught(tessa)).toHaveText("4 deals caught of 14 open");
    // Quiet from 7 days down to 3, by keyboard: eight deals (the ledger's line).
    const fewer = tessa.getByRole("button", { name: "Fewer days for “Nothing logged for a while”" });
    await fewer.focus();
    for (const days of ["6 days", "5 days", "4 days", "3 days"]) {
      await tessa.keyboard.press("Enter");
      await expect(rule(tessa, "quiet").locator('[data-figure="days"]')).toHaveText(days);
    }
    await expect(fewer).toBeDisabled();
    // Seven deals have had nothing logged for three days; with the two other checks, eight are caught (the ledger's line).
    await expect(rule(tessa, "quiet").locator('[data-figure="caught"]')).toHaveText("7 caught");
    await expect(group(tessa, "quiet").locator(".crm-ndg-deal")).toHaveCount(7);
    await expect(caught(tessa)).toHaveText("8 deals caught of 14 open");
    expect((await rows<{ nudge_quiet_days: number }>(admin, data, "settings"))[0]!.nudge_quiet_days).toBe(3);
    // Ivy's open page follows without a reload, and she moves it a day back herself.
    await expect(rule(ivy, "quiet").locator('[data-figure="days"]')).toHaveText("3 days");
    await expect(caught(ivy)).toHaveText("8 deals caught of 14 open");
    await ivy.getByRole("button", { name: "More days for “Nothing logged for a while”" }).click();
    await expect(rule(ivy, "quiet").locator('[data-figure="days"]')).toHaveText("4 days");
    await expect(ivy.locator(".crm-toast")).toContainText("“Nothing logged for a while” now waits 4 days.");
    expect((await rows<{ nudge_quiet_days: number }>(admin, data, "settings"))[0]!.nudge_quiet_days).toBe(4);
    // The ledger's other lines, each set by the admin directly and followed live: stuck at 14 catches six in all,
    // closing within 30 nine, and all three at their loosest one.
    const set = async (values: Record<string, number>): Promise<void> => expect((await admin.patch(data("settings", "/1"), { data: { values }, headers: await csrf(admin) })).status()).toBe(200);
    await set({ nudge_quiet_days: 7, nudge_stuck_days: 14, nudge_soon_days: 7 });
    await expect(rule(ivy, "stuck").locator('[data-figure="caught"]')).toHaveText("5 caught");
    await expect(caught(ivy)).toHaveText("6 deals caught of 14 open");
    await set({ nudge_quiet_days: 7, nudge_stuck_days: 21, nudge_soon_days: 30 });
    await expect(rule(ivy, "soon").locator('[data-figure="caught"]')).toHaveText("6 caught");
    await expect(caught(ivy)).toHaveText("9 deals caught of 14 open");
    await set({ nudge_quiet_days: 21, nudge_stuck_days: 45, nudge_soon_days: 3 });
    await expect(caught(ivy)).toHaveText("1 deal caught of 14 open");
    await expect(rule(ivy, "quiet").locator('[data-figure="caught"]')).toHaveText("nothing caught");
  } finally {
    await restore(admin, data);
  }
  await expect(caught(ivy)).toHaveText("4 deals caught of 14 open");
  // A rep reads the settings and may not change them: the server's refusal.
  const dana = await api("dana");
  expect((await dana.patch(data("settings", "/1"), { data: { values: { nudge_quiet_days: 3 } }, headers: await csrf(dana) })).status()).toBe(403);
});

test("a snooze for a week, its reply lost on the way back, and brought back", async ({ as, api, data }) => {
  const direct = await api("tessa");
  await unsnooze(direct, data);
  const page = await (await as("tessa")).newPage();
  await page.goto(`${STAFF}nudges`);
  await expect(caught(page)).toHaveText("4 deals caught of 14 open");
  // The save reaches the server and is written; its answer never arrives.
  const sent: { key: string; replayed: boolean | null }[] = [];
  let dropped = false;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_nudge_snoozes$/.test(new URL(request.url()).pathname)) return route.fallback();
    const key = (request.postDataJSON() as { clientKey: string }).clientKey;
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      sent.push({ key, replayed: null });
      return route.abort("connectionreset");
    }
    sent.push({ key, replayed: ((await response.json()) as { replayed?: boolean }).replayed === true });
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Snooze “Analyst pods, second floor” for a week" }).click();
    // Never "not saved": sent again with the same key, the server answers the row the first one made.
    // A week from the server's clock (the stand's began at 09:35 and runs on).
    await expect(page.locator(".crm-toast")).toContainText(/Analyst pods, second floor snoozed until Tue, Aug 4, (09|10):\d\d\./);
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
    await page.unroute("**/api/v1/data/**");
    const held = await rows<{ rule: string; until: string }>(direct, data, "nudge_snoozes");
    expect(held.length, "one snooze, not two").toBe(1);
    expect(held[0]!.rule).toBe("soon");
    const now = new Date(((await (await direct.get(`${STAFF}surface-config.json`)).json()) as { now: string }).now).getTime();
    const week = new Date(held[0]!.until).getTime() - now;
    expect(week, "seven days from the server's now, give or take the seconds this spec took").toBeGreaterThan(7 * 86_400_000 - 60_000);
    expect(week).toBeLessThanOrEqual(7 * 86_400_000);
    // It leaves the list and the count; nothing else moves.
    await expect(group(page, "soon")).toHaveCount(0);
    await expect(rule(page, "soon").locator('[data-figure="caught"]')).toHaveText("nothing caught");
    await expect(caught(page)).toHaveText("3 deals caught of 14 open");
    // A snooze is the person's own: the sales manager's list still holds the deal.
    const ivy = await (await as("ivy")).newPage();
    await ivy.goto(`${STAFF}nudges`);
    await expect(caught(ivy)).toHaveText("4 deals caught of 14 open");
    await page.getByRole("button", { name: "1 snoozed · bring back" }).click();
    await expect(caught(page)).toHaveText("4 deals caught of 14 open");
    await expect(group(page, "soon").locator(".crm-ndg-deal")).toHaveCount(1);
    expect(await rows(direct, data, "nudge_snoozes")).toEqual([]);
  } finally {
    await unsnooze(direct, data);
  }
});

test("“Nudge Leo” is a comment on the deal that mentions him", async ({ as, api, data }) => {
  const admin = await api("tessa");
  const headers = await csrf(admin);
  const clear = async (): Promise<void> => {
    for (const row of await rows<{ id: number }>(admin, data, "comments", { column: "text", op: "like", value: "%A nudge: this deal has sat%" })) expect((await admin.delete(data("comments", `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  };
  await clear();
  const page = await (await as("ivy")).newPage();
  await page.goto(`${STAFF}nudges`);
  const d12 = group(page, "stuck").locator('.crm-ndg-deal[data-deal="Depot supervisor stations"]');
  try {
    await d12.getByRole("button", { name: "Nudge Leo" }).click();
    await expect(page.locator(".crm-toast")).toContainText("Leo has the nudge about Depot supervisor stations in the bell.");
    await expect(d12).toContainText("nudged Tue, Jul 28");
    await expect(d12.getByRole("button", { name: "Nudge Leo" })).toHaveCount(0);
    const written = await rows<{ text: string; deal_id: number }>(admin, data, "comments", { column: "text", op: "like", value: "%A nudge: this deal has sat%" });
    expect(written.length).toBe(1);
    expect(written[0]!.text).toMatch(/^@\[Leo Vance\]\(usr_[^)]+\) A nudge: this deal has sat in the same stage for a long time\./);
  } finally {
    await clear();
  }
});

test("Nudges at 390 wide in the dark", async ({ as }) => {
  const narrow = await (await as("ivy", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await narrow.goto(`${STAFF}nudges`);
  await expect(caught(narrow)).toHaveText("4 deals caught of 14 open");
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(narrow, "3-ivy-nudges-390-dark");
});
