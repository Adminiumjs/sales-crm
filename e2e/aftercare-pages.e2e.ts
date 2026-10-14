/**
 * AFTER THE JOB on the stand, with the sample (stage 2: `CRM_STAND_STAGE=2`;
 * on a stand of stage 1 there is no such part and every test here is skipped):
 * Aftercare calls, What customers said with "Add an answer", Customer
 * complaints, Warranty claims, and the aftercare part of the account
 * manager's home. The ledger's screens 47, 56, 59 and 62.
 *
 * Who each is proved as: the account manager (his menu, his home, every
 * write), the CRM admin (her menu, and her open page following his writes),
 * Read-only (the four pages, nothing to press, the server refusing her
 * writes), and the rep, the sales manager, the operations manager, the
 * marketer and the front desk, whose menus hold none of the four: told it is
 * not part of their role, and refused by the server where they would write
 * (the marketer and the front desk read none of it at all).
 *
 * Every write is to a row the spec makes and names "Spec: …", and takes away
 * at the end, or is put back as it was (a thank-you): no figure another spec
 * reads is moved once a test ends.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, unfoldMenu, watch, type Data } from "./helpers.ts";
import { figure } from "./territory-helpers.ts";

const menu = (page: Page) => page.getByRole("navigation", { name: "Menu" });
const toast = (page: Page) => page.locator(".crm-toast");
const value = (page: Page, id: string) => page.getByTestId(id).locator(".crm-stat-value, .crm-kpi-value");
const sub = (page: Page, id: string) => page.getByTestId(id).locator(".crm-stat-sub, .crm-kpi-sub");
const chip = (page: Page, key: string) => page.locator(`.crm-ac-chips [data-chip="${key}"]`);
const noSidewaysScroll = (page: Page): Promise<boolean> => page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth);
const AFTER_THE_JOB = ["Aftercare calls", "What customers said", "Customer complaints", "Warranty claims"];
const PAGES = [
  ["aftercare-calls", "aftercare", "Aftercare calls"],
  ["what-customers-said", "feedback", "What customers said"],
  ["complaints", "complaints", "Customer complaints"],
  ["warranty-claims", "claims", "Warranty claims"],
] as const;

type Stand = Parameters<typeof figure>[1];
async function single(person: APIRequestContext, stand: Stand, table: string, filters: unknown[], aggregation: Record<string, unknown> = { fn: "count" }): Promise<number> {
  return Number(((await figure(person, stand, table, { shape: "single-metric", filters, aggregations: [{ ...aggregation, alias: "v" }] })) as { value: number | null }).value ?? 0);
}
const AFTERCARE = { column: "kind", op: "eq", value: "aftercare" };

/** A job of the sample by its code, as somebody who reads them all. */
async function jobId(person: APIRequestContext, data: Data, code: string): Promise<number> {
  const found = await rows<{ id: number }>(person, data, "jobs", { column: "code", op: "eq", value: code });
  expect(found, code).toHaveLength(1);
  return found[0]!.id;
}
async function made(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<number> {
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { data: { id: number } }).data.id;
}

test.beforeEach(({ stand }) => {
  test.skip(!stand.parts.includes("aftercare"), "After the job arrives with stage 2: run with CRM_STAND_STAGE=2");
});

test("the account manager's menu holds After the job, and his home its calls due, complaints open and answers to reply to, as the server counts them", async ({ as, api, stand }) => {
  const hugo = await api("hugo");
  const page = await (await as("hugo")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await expect(page.locator('[data-screen="amhome"]')).toBeVisible();
  await unfoldMenu(page);
  const lines = await menu(page).getByRole("link").allInnerTexts();
  const at = lines.indexOf(AFTER_THE_JOB[0]!);
  expect(at, lines.join(", ")).toBeGreaterThan(0);
  expect(lines.slice(at, at + 4)).toEqual(AFTER_THE_JOB);

  // The ledger's sections 62, 56 and 47, asked of the server as Hugo.
  // The stand's clock, not this machine's: the ledger's morning.
  const now = "2026-07-28T12:00:00.000Z";
  const due = await single(hugo, stand, "follow_ups", [AFTERCARE, { column: "done", op: "eq", value: false }]);
  const open = await single(hugo, stand, "complaints", [{ column: "state", op: "eq", value: "open" }]);
  const slow = await single(hugo, stand, "complaints", [{ column: "state", op: "eq", value: "open" }, { column: "raised_on", op: "lte", value: "2026-07-25" }]);
  const unreplied = await single(hugo, stand, "feedback", [{ column: "replied_at", op: "is_null" }]);
  expect([due, open, slow, unreplied]).toEqual([3, 3, 2, 1]);
  expect(await single(hugo, stand, "follow_ups", [AFTERCARE, { column: "done", op: "eq", value: false }, { column: "due_at", op: "lt", value: now }])).toBe(0);

  await expect(value(page, "amhome-calls")).toHaveText("3");
  await expect(sub(page, "amhome-calls")).toHaveText("None past the date");
  await expect(value(page, "amhome-complaints")).toHaveText("3");
  await expect(sub(page, "amhome-complaints")).toHaveText("2 waiting 3 days or more");
  await expect(value(page, "amhome-answers")).toHaveText("1");
  await expect(sub(page, "amhome-answers")).toHaveText("A customer is waiting to hear back");
  // The tiles of stage 1 are still there.
  await expect(value(page, "amhome-ready")).toHaveText("3");

  const calls = page.locator('[data-group="calls"]');
  await expect(calls.locator(".crm-queue-group-count")).toHaveText("3");
  await expect(calls.locator(".crm-step-deal")).toHaveText(["J-06 · Legal library shelving (second call)", "J-07 · Test-floor workbenches", "J-08 · Studio meeting tables"]);
  await expect(calls.locator(".crm-step-end")).toHaveText(["Thu, Aug 6", "Tue, Aug 18", "Sat, Aug 22"]);
  await expect(calls.locator(".crm-step").nth(1)).toContainText("Tandem Robotics");
  await expect(calls.locator(".crm-step").nth(1)).toContainText("Ring Yusuf Demir.");
  const complaints = page.locator('[data-group="complaints"]');
  await expect(complaints.locator(".crm-step-deal")).toHaveText(["Late, and no warning", "Nobody came back to them", "Wrong item sent"]);
  await expect(complaints.locator(".crm-step-end")).toHaveText(["12 days open", "5 days open", "1 day open"]);
  await expect(complaints.locator('.crm-step[data-late="1"]')).toHaveCount(2);
  await expect(complaints.locator(".crm-step").first()).toContainText("Nordwind Logistics");
  const answers = page.locator('[data-group="answers"]');
  await expect(answers.locator(".crm-step-deal")).toHaveText(["Marta Kovac on J-08"]);
  await expect(answers.locator(".crm-step").first()).toContainText("Veldt Studios");
  await expect(answers.locator(".crm-step-due")).toHaveText("Answered Mon, Jul 27");
  await expect(answers.locator(".crm-step-amount")).toHaveText("5 / 5");
  await picture(page, "p23-amhome");

  // A row opens the list it belongs to; the primary button opens the calls.
  await complaints.getByRole("link", { name: "Nobody came back to them" }).click();
  await expect(page.locator('[data-screen="complaints"]')).toBeVisible();
  await page.goto(STAFF);
  await page.getByRole("link", { name: "Aftercare calls" }).first().click();
  await expect(page.locator('[data-screen="aftercare"]')).toBeVisible();
  expect(problems).toEqual([]);
});

test("Aftercare calls: the server's counts, past due by its clock; a call made survives a lost reply, once, and the admin's open page follows", async ({ as, api, data, stand }) => {
  const tessa = await api("tessa");
  const hugo = await api("hugo");
  const admin = await (await as("tessa")).newPage();
  await admin.goto(`${STAFF}team`);
  await unfoldMenu(admin);
  await menu(admin).getByRole("link", { name: "Aftercare calls", exact: true }).click();
  await expect(admin.locator('[data-screen="aftercare"]')).toBeVisible();

  const counts = {
    total: await single(tessa, stand, "follow_ups", [AFTERCARE]),
    made: await single(tessa, stand, "follow_ups", [AFTERCARE, { column: "done", op: "eq", value: true }]),
    more: await single(tessa, stand, "follow_ups", [AFTERCARE, { column: "done", op: "eq", value: true }, { column: "outcome", op: "eq", value: "more-work" }]),
  };
  // The ledger's section 62: 9 calls, made 6, past due 0, coming up 3, more work 1.
  expect(counts).toEqual({ total: 9, made: 6, more: 1 });
  await expect(value(admin, "ac-late")).toHaveText("0");
  await expect(sub(admin, "ac-late")).toHaveText("all made on time");
  await expect(value(admin, "ac-soon")).toHaveText("3");
  await expect(value(admin, "ac-more")).toHaveText("1");
  await expect(sub(admin, "ac-more")).toHaveText("out of 6 calls made · 9 calls in all");
  await expect(admin.getByText("A call falls due 28 days after the job is signed off.")).toBeVisible();
  for (const [key, n] of [["all", 9], ["late", 0], ["soon", 3], ["made", 6]] as const) await expect(chip(admin, key).locator(".crm-ac-chip-count")).toHaveText(String(n));
  const cards = admin.locator(".crm-ac-card");
  await expect(cards).toHaveCount(9);
  expect(await cards.evaluateAll((all) => all.map((card) => `${card.getAttribute("data-job") ?? ""} ${card.getAttribute("data-state") ?? ""}`))).toEqual(["J-06 soon", "J-07 soon", "J-08 soon", "J-06 made", "J-05 made", "J-04 made", "J-03 made", "J-02 made", "J-01 made"]);
  await expect(cards.nth(0)).toContainText("J-06 · Legal library shelving (second call)");
  await expect(cards.nth(0).getByTestId("ac-due")).toHaveText("Call by Aug 6, 2026");
  await expect(cards.nth(1)).toContainText("Fitted Jul 21, 2026");
  await expect(cards.nth(2)).toContainText("Signed off Jul 25, 2026");
  await expect(cards.nth(3).getByTestId("ac-outcome")).toHaveText("Led to more work");
  await expect(cards.nth(4).getByTestId("ac-outcome")).toHaveText("Turned up a fault");
  await expect(cards.nth(5).getByTestId("ac-outcome")).toHaveText("Turned up a complaint");
  await expect(cards.nth(8).getByTestId("ac-due")).toHaveText("Made Dec 16, 2025");
  // Only made-calls and coming-up calls: the filter narrows the list the server gave.
  await chip(admin, "made").click();
  await expect(cards).toHaveCount(6);
  await chip(admin, "all").click();
  await picture(admin, "p23-calls-admin");

  // A call of the spec's own, for Hugo, on J-07: the admin's page counts it without a reload.
  const j07 = await jobId(tessa, data, "J-07");
  const headers = await csrf(hugo);
  const id = await made(await hugo.post(data("follow_ups"), { data: { values: { job_id: j07, owner_id: stand.people["hugo"]!.id, due_at: "2026-08-10T09:00:00.000Z", text: "Spec: ring about the bench tops", kind: "aftercare", call_no: 2 } }, headers }));
  try {
    await expect(chip(admin, "all").locator(".crm-ac-chip-count")).toHaveText("10", { timeout: 45_000 });
    await expect(value(admin, "ac-soon")).toHaveText("4");

    // He makes it, and the reply is lost on its way back: the page reads the row before it says anything, and says it once.
    const page = await (await as("hugo")).newPage();
    await page.goto(`${STAFF}aftercare-calls`);
    let writes = 0;
    let lost = 0;
    await page.route("**/api/v1/data/**", async (route) => {
      if (route.request().method() !== "PATCH" || !new RegExp(`crm_follow_ups/${String(id)}$`).test(new URL(route.request().url()).pathname)) return route.fallback();
      writes += 1;
      if (lost > 0) return route.fallback();
      lost += 1;
      await route.fetch();
      return route.abort("connectionreset");
    });
    const card = page.locator(`.crm-ac-card[data-call="${String(id)}"]`);
    await expect(card).toContainText("Spec: ring about the bench tops");
    const button = card.getByRole("button", { name: "Made the call" });
    await button.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The focus is held inside; Escape gives it back to the button, and nothing is written.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(writes).toBe(0);
    await page.keyboard.press("Enter");
    await dialog.getByRole("radio", { name: "Led to more work" }).click();
    await dialog.getByRole("button", { name: "Save the call" }).click();
    await expect(toast(page)).toContainText("Call marked as made: J-07 · Test-floor workbenches (second call).", { timeout: 20_000 });
    await expect(card.getByTestId("ac-state")).toHaveText("Made");
    await expect(card.getByTestId("ac-outcome")).toHaveText("Led to more work");
    await expect(card.getByRole("button", { name: "Made the call" })).toHaveCount(0);
    expect(lost).toBe(1);
    expect(writes).toBeLessThanOrEqual(2);
    const row = (await rows<{ id: number; done: boolean | number; outcome: string; done_by_id: string; done_at: string | null }>(tessa, data, "follow_ups", { column: "id", op: "eq", value: id }))[0]!;
    expect([Boolean(row.done), row.outcome, row.done_by_id]).toEqual([true, "more-work", stand.people["hugo"]!.id]);
    expect(row.done_at).not.toBeNull();
    // Made once: a second "made" that names the call as not done is refused by the server.
    expect((await hugo.patch(data("follow_ups", `/${String(id)}`), { data: { values: { done: true, outcome: "none" }, seen: { done: false } }, headers })).status()).toBe(409);

    // Live: the admin's open page follows without a reload.
    await expect(value(admin, "ac-more")).toHaveText("2", { timeout: 45_000 });
    await expect(sub(admin, "ac-more")).toHaveText("out of 7 calls made · 10 calls in all");
  } finally {
    expect((await tessa.delete(data("follow_ups", `/${String(id)}?confirm=true`), { headers: await csrf(tessa) })).status()).toBeLessThan(300);
  }
  await expect(chip(admin, "all").locator(".crm-ac-chip-count")).toHaveText("9", { timeout: 45_000 });
});

test("What customers said: the ledger's answers and themes; an answer added by hand through a lost reply is one answer; a thank-you is kept once", async ({ as, api, data, stand }) => {
  const hugo = await api("hugo");
  const tessa = await api("tessa");
  const page = await (await as("hugo")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await menu(page).getByRole("link", { name: "What customers said", exact: true }).click();
  await expect(page.locator('[data-screen="feedback"]')).toBeVisible();

  // The ledger's section 47, all answers: 5, average 4.4, replied to 4, threes or below 1 with a fix 1.
  expect([
    await single(hugo, stand, "feedback", []),
    await single(hugo, stand, "feedback", [], { fn: "avg", column: "score" }),
    await single(hugo, stand, "feedback", [{ column: "replied_at", op: "not_null" }]),
    await single(hugo, stand, "feedback", [{ column: "score", op: "lte", value: 3 }]),
    await single(hugo, stand, "feedback", [{ column: "score", op: "lte", value: 3 }, { column: "fix_written", op: "not_null" }]),
  ]).toEqual([5, 4.4, 4, 1, 1]);
  await expect(value(page, "fb-avg")).toHaveText("4.4 / 5");
  await expect(sub(page, "fb-avg")).toHaveText("5 answers");
  await expect(value(page, "fb-replied")).toHaveText("4 of 5");
  await expect(value(page, "fb-low")).toHaveText("1");
  await expect(sub(page, "fb-low")).toHaveText("1 of 1 with a fix written");
  await expect(page.getByTestId("fb-waiting")).toHaveText("Signed-off jobs with no answer yet: J-02, J-03.");
  for (const [key, n] of [["all", 5], ["high", 4], ["low", 1], ["unreplied", 1]] as const) await expect(chip(page, key).locator(".crm-ac-chip-count")).toHaveText(String(n));
  const cards = page.locator(".crm-ac-card");
  expect(await cards.evaluateAll((all) => all.map((card) => card.getAttribute("data-job")))).toEqual(["J-08", "J-06", "J-05", "J-04", "J-01"]);
  await expect(cards.nth(0).getByTestId("fb-score")).toHaveText("5 / 5");
  await expect(cards.nth(0)).toContainText("Marta Kovac · Studio Manager");
  await expect(cards.nth(3).getByTestId("fb-score")).toHaveText("3 / 5");
  await expect(cards.nth(3).getByTestId("fb-fix")).toHaveText("We now confirm the week in writing before the order goes in.");
  // The themes, counted by the server: the most named first, then by name.
  await expect(page.getByTestId("fb-themes").locator("li")).toHaveText(["No theme2", "A date moved1", "Drawings matched the room1", "Wanted earlier warning on stock1"]);
  await chip(page, "low").click();
  await expect(cards).toHaveCount(1);
  await chip(page, "all").click();

  // Dana's own, as the server cuts them (the ledger's line for her): 3 answers, 4.7, replied to 2 of 3. Her menu has no line for the page.
  const dana = await api("dana");
  expect([await single(dana, stand, "feedback", []), Math.round((await single(dana, stand, "feedback", [], { fn: "avg", column: "score" })) * 10) / 10, await single(dana, stand, "feedback", [{ column: "replied_at", op: "not_null" }])]).toEqual([3, 4.7, 2]);

  const admin = await (await as("tessa")).newPage();
  await admin.goto(`${STAFF}what-customers-said`);
  await expect(admin.locator(".crm-ac-card")).toHaveCount(5);

  const j02 = await jobId(tessa, data, "J-02");
  const j08 = await jobId(tessa, data, "J-08");
  const veldt = (await rows<{ id: number; replied_at: string | null }>(tessa, data, "feedback", { column: "job_id", op: "eq", value: j08 }))[0]!;
  expect(veldt.replied_at).toBeNull();
  try {
    // Add an answer, and the reply is lost: one answer, said once.
    let posts = 0;
    let lost = 0;
    await page.route("**/api/v1/data/**", async (route) => {
      if (route.request().method() !== "POST" || !/crm_feedback$/.test(new URL(route.request().url()).pathname)) return route.fallback();
      posts += 1;
      if (lost > 0) return route.fallback();
      lost += 1;
      await route.fetch();
      return route.abort("connectionreset");
    });
    await page.getByRole("button", { name: "Add an answer" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Job")).toBeFocused();
    // Only the signed-off jobs with no answer are offered.
    await expect(dialog.getByLabel("Job").locator("option")).toHaveText(["Pick a signed-off job", "J-02 · Archive shelving · Harbor & Finch", "J-03 · Meeting pods, first floor · Juno Analytics"]);
    await dialog.getByRole("button", { name: "Add the answer" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Pick the job and a score from 1 to 5.");
    await dialog.getByLabel("Job").selectOption(String(j02));
    await dialog.getByRole("radio", { name: "4" }).click();
    await dialog.getByLabel("What they said").fill("Spec: the shelving holds up well.");
    await dialog.getByLabel("Theme").fill("Spec theme");
    await expect(dialog.getByLabel("Answered on")).toHaveValue("2026-07-28");
    await dialog.getByRole("button", { name: "Add the answer" }).click();
    await expect(toast(page)).toContainText("Answer for J-02 added.", { timeout: 20_000 });
    await expect(dialog).toHaveCount(0);
    expect(lost).toBe(1);
    const added = await rows<{ id: number; score: number; text: string; theme: string; answered_on: string }>(tessa, data, "feedback", { column: "job_id", op: "eq", value: j02 });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ score: 4, text: "Spec: the shelving holds up well.", theme: "Spec theme" });
    await expect(cards).toHaveCount(6);
    await expect(page.getByTestId("fb-waiting")).toHaveText("Signed-off jobs with no answer yet: J-03.");
    // A second answer for the same job is refused by the server.
    expect((await hugo.post(data("feedback"), { data: { values: { job_id: j02, score: 2, answered_on: "2026-07-28" } }, headers: await csrf(hugo) })).status()).toBeGreaterThanOrEqual(400);
    // The admin's open page follows.
    await expect(admin.locator(".crm-ac-card")).toHaveCount(6, { timeout: 45_000 });

    // Say thank you, once, at the server's moment; the admin's open page follows.
    const card = page.locator('.crm-ac-card[data-job="J-08"]');
    await card.getByRole("button", { name: "Say thank you" }).click();
    await expect(toast(page)).toContainText("Thank-you to Marta Kovac noted.");
    await expect(card.getByTestId("fb-thanked")).toHaveText(/^Thanked Tue, Jul 28, (09|1\d):\d\d$/);
    await expect(admin.locator('.crm-ac-card[data-job="J-08"]').getByTestId("fb-thanked")).toBeVisible({ timeout: 45_000 });
    expect((await tessa.patch(data("feedback", `/${String(veldt.id)}`), { data: { values: { replied_at: "2026-07-29T10:00:00.000Z" }, seen: { replied_at: null } }, headers: await csrf(tessa) })).status()).toBe(409);
    await picture(page, "p23-feedback");
    expect(problems.filter((line) => !line.includes("ERR_CONNECTION_RESET") && !line.includes("Failed to load resource"))).toEqual([]);
  } finally {
    for (const one of await rows<{ id: number }>(tessa, data, "feedback", { column: "job_id", op: "eq", value: j02 })) expect((await hugo.delete(data("feedback", `/${String(one.id)}?confirm=true`), { headers: await csrf(hugo) })).status()).toBeLessThan(300);
    expect((await tessa.patch(data("feedback", `/${String(veldt.id)}`), { data: { values: { replied_at: null } }, headers: await csrf(tessa) })).status()).toBe(200);
  }
  expect(await single(tessa, stand, "feedback", [{ column: "replied_at", op: "not_null" }])).toBe(4);
  expect(await single(tessa, stand, "feedback", [])).toBe(5);
});

test("Customer complaints: the ledger's figures; a complaint answered with what we told them, then settled, each move once and from where it stood", async ({ as, api, data, stand }) => {
  const hugo = await api("hugo");
  const tessa = await api("tessa");
  const page = await (await as("hugo")).newPage();
  await page.goto(`${STAFF}complaints`);
  await expect(page.locator('[data-screen="complaints"]')).toBeVisible();

  // The ledger's section 56: 7; open 3, answered 2, settled 2; overdue 2; late and wrong 2 each; on a job 5, before any job 2.
  const byState = (await figure(hugo, stand, "complaints", { shape: "categorical", groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }] })) as { items: { key: string; values?: { n: number }; value: number }[] };
  expect(Object.fromEntries(byState.items.map((item) => [item.key, Number(item.values?.n ?? item.value)]))).toEqual({ open: 3, answered: 2, settled: 2 });
  expect(await single(hugo, stand, "complaints", [{ column: "job_id", op: "not_null" }])).toBe(5);
  await expect(value(page, "cp-open")).toHaveText("3");
  await expect(value(page, "cp-slow")).toHaveText("2");
  await expect(value(page, "cp-top")).toHaveText("2");
  await expect(sub(page, "cp-top")).toHaveText("Late, and no warning and Wrong item sent · on a job 5, before any job 2");
  await expect(page.getByTestId("cp-slow-line")).toHaveText("2 complaints have waited 3 days or more. Answer them today, even if the answer is not finished.");
  for (const [key, n] of [["all", 7], ["open", 3], ["answered", 2], ["settled", 2]] as const) await expect(chip(page, key).locator(".crm-ac-chip-count")).toHaveText(String(n));
  const cards = page.locator(".crm-ac-card");
  expect(await cards.evaluateAll((all) => all.map((card) => card.getAttribute("data-state")))).toEqual(["open", "open", "open", "answered", "answered", "settled", "settled"]);
  await expect(cards.locator(".crm-ac-co")).toHaveText(["Brightloom Foods", "Juno Analytics", "J-04 · Nordwind Logistics", "J-08 · Veldt Studios", "J-07 · Tandem Robotics", "J-05 · Fernway Clinics", "J-02 · Harbor & Finch"]);
  await expect(cards.getByTestId("cp-age")).toHaveText(["yesterday", "5 days ago", "12 days ago", "4 days ago", "7 days ago", "19 days ago", "28 days ago"]);
  await expect(cards.locator('[data-testid="cp-age"][data-late="1"]')).toHaveCount(2);
  await expect(cards.nth(2)).toContainText("We cleared the floor on a Monday");
  await expect(cards.nth(2)).toContainText("They are right to be annoyed");

  // A complaint of the spec's own: the admin's open page counts it without a reload.
  const admin = await (await as("tessa")).newPage();
  await admin.goto(`${STAFF}complaints`);
  await expect(chip(admin, "open").locator(".crm-ac-chip-count")).toHaveText("3");
  const lowOrbit = (await rows<{ id: number }>(tessa, data, "companies", { column: "name", op: "eq", value: "Low Orbit" }))[0]!;
  const headers = await csrf(hugo);
  const id = await made(await hugo.post(data("complaints"), { data: { values: { company_id: lowOrbit.id, owner_id: stand.people["hugo"]!.id, text: "Spec: the chairs squeak.", cause: "crew", fairness: "fair" } }, headers }));
  try {
    await expect(chip(admin, "open").locator(".crm-ac-chip-count")).toHaveText("4", { timeout: 45_000 });
    await expect(chip(page, "open").locator(".crm-ac-chip-count")).toHaveText("4", { timeout: 45_000 });
    const card = page.locator(`.crm-ac-card[data-complaint="${String(id)}"]`);
    await expect(card.getByTestId("cp-state")).toHaveText("Open");
    await expect(card.getByTestId("cp-age")).toHaveText("today");
    // Answer it, by the keyboard: the dialog holds the focus, Escape gives it back.
    const answer = card.getByRole("button", { name: "Answer it" });
    await answer.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("What did you tell them?")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(answer).toBeFocused();
    await page.keyboard.press("Enter");
    await dialog.getByLabel("What did you tell them?").fill("Spec: a fitter goes back on Friday.");
    await dialog.getByRole("button", { name: "Mark as answered" }).click();
    await expect(toast(page)).toContainText("Marked as answered.");
    await expect(card.getByTestId("cp-state")).toHaveText("Answered");
    await expect(card.getByTestId("cp-answer")).toHaveText("Spec: a fitter goes back on Friday.");
    const row = (await rows<{ state: string; answer: string; answered_at: string | null }>(tessa, data, "complaints", { column: "id", op: "eq", value: id }))[0]!;
    expect([row.state, row.answer]).toEqual(["answered", "Spec: a fitter goes back on Friday."]);
    expect(row.answered_at).not.toBeNull();
    // A move that names where it starts: "answered" again from open is refused now that it has moved.
    expect((await hugo.post(data("complaints", `/${String(id)}/actions/answered`), { data: { from: "open", values: { answer: "again" } }, headers })).status()).toBe(409);
    await card.getByRole("button", { name: "Settled" }).click();
    await expect(toast(page)).toContainText("Settled. Put right.");
    await expect(card.getByTestId("cp-state")).toHaveText("Settled");
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(admin.locator(`.crm-ac-card[data-complaint="${String(id)}"]`).getByTestId("cp-state")).toHaveText("Settled", { timeout: 45_000 });
    await picture(page, "p23-complaints");
  } finally {
    expect((await hugo.delete(data("complaints", `/${String(id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
  expect(await single(tessa, stand, "complaints", [])).toBe(7);
});

test("Warranty claims: the ledger's figures and days; a claim raised, its parts on the way, put right saying who paid", async ({ as, api, data, stand }) => {
  const hugo = await api("hugo");
  const tessa = await api("tessa");
  const page = await (await as("hugo")).newPage();
  await page.goto(`${STAFF}warranty-claims`);
  await expect(page.locator('[data-screen="claims"]')).toBeVisible();

  // The ledger's section 59: 5 claims; in hand 4; longest open 22 days (Fernway); we covered 1, the supplier 2, not settled 2.
  expect(await single(hugo, stand, "warranty_claims", [{ column: "state", op: "in", value: ["to-raise", "with-supplier", "parts-coming"] }])).toBe(4);
  expect(await single(hugo, stand, "warranty_claims", [{ column: "paid_by", op: "is_null" }])).toBe(2);
  await expect(value(page, "wc-hand")).toHaveText("4");
  await expect(value(page, "wc-longest")).toHaveText("22 days");
  await expect(page.getByTestId("wc-longest").locator(".crm-stat-value")).toHaveAttribute("data-tone", "danger");
  await expect(sub(page, "wc-longest")).toHaveText("Fernway Clinics");
  await expect(value(page, "wc-us")).toHaveText("1");
  await expect(sub(page, "wc-us")).toHaveText("supplier covered 2 · not settled 2");
  await expect(page.getByTestId("wc-to-raise")).toHaveText("1 claim has not been raised with the supplier yet. Do it before the month turns.");
  const cards = page.locator(".crm-ac-card");
  expect(await cards.evaluateAll((all) => all.map((card) => `${card.getAttribute("data-job") ?? ""} ${card.getAttribute("data-state") ?? ""}`))).toEqual(["J-03 to-raise", "J-01 with-supplier", "J-08 with-supplier", "J-05 parts-coming", "J-02 sorted"]);
  // Days after the fitting, and the cover on the day it was raised: the ledger's 136 / 237 / 3 / 75 / 161.
  await expect(cards.getByTestId("wc-after")).toHaveText(["raised 136 days after fitting", "raised 237 days after fitting", "raised 3 days after fitting", "raised 75 days after fitting", "raised 161 days after fitting"]);
  await expect(cards.getByTestId("wc-cover")).toHaveText(["Moving parts, 2 years · in cover", "Moving parts, 2 years · in cover", "Frame, 5 years · in cover", "Fabric, 1 year · in cover", "Frame, 5 years · in cover"]);
  await expect(cards.getByTestId("wc-paid")).toHaveText(["Not settled yet", "Supplier covered it", "Not settled yet", "Supplier covered it", "We covered it"]);
  await expect(cards.nth(2)).toContainText("Fitted Jul 24, 2026");
  await expect(cards.nth(0).getByRole("button")).toHaveText(["Raise it"]);
  await expect(cards.nth(1).getByRole("button")).toHaveText(["Parts on the way"]);
  await expect(cards.nth(3).getByRole("button")).toHaveText(["Put right"]);
  await expect(cards.nth(4).getByRole("button")).toHaveCount(0);

  // A claim of the spec's own, on J-07: raised, parts on the way, put right at our cost.
  const j07 = await jobId(tessa, data, "J-07");
  const headers = await csrf(hugo);
  const id = await made(await hugo.post(data("warranty_claims"), { data: { values: { job_id: j07, what: "Spec: castor split", part: "Workbench castor", cover: "mechanism", cover_years: 2, supplier_name: "Ostrom Seating" } }, headers }));
  try {
    const card = page.locator(`.crm-ac-card[data-claim="${String(id)}"]`);
    await expect(card.getByTestId("wc-state")).toHaveText("To raise", { timeout: 45_000 });
    await expect(card.getByTestId("wc-after")).toHaveText("raised 7 days after fitting");
    await card.getByRole("button", { name: "Raise it" }).click();
    await expect(toast(page)).toContainText("Marked as raised with the supplier.");
    await expect(card.getByTestId("wc-state")).toHaveText("With the supplier");
    // Straight to sorted from the supplier is not a move the table has: the server refuses it.
    expect((await hugo.post(data("warranty_claims", `/${String(id)}/actions/sorted`), { data: { from: "with-supplier", values: { paid_by: "us" } }, headers })).status()).toBeGreaterThanOrEqual(400);
    await card.getByRole("button", { name: "Parts on the way" }).click();
    await expect(card.getByTestId("wc-state")).toHaveText("Parts coming");
    await card.getByRole("button", { name: "Put right" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "We did" }).click();
    await dialog.getByRole("button", { name: "Mark as sorted" }).click();
    await expect(toast(page)).toContainText("Marked as sorted.");
    await expect(card.getByTestId("wc-state")).toHaveText("Sorted");
    await expect(card.getByTestId("wc-paid")).toHaveText("We covered it");
    const row = (await rows<{ state: string; paid_by: string }>(tessa, data, "warranty_claims", { column: "id", op: "eq", value: id }))[0]!;
    expect([row.state, row.paid_by]).toEqual(["sorted", "us"]);
    await picture(page, "p23-claims");
  } finally {
    expect((await hugo.delete(data("warranty_claims", `/${String(id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
  expect(await single(tessa, stand, "warranty_claims", [])).toBe(5);
});

test("who these pages are not for: told it is not part of their role, refused by the server; Read-only reads all four and presses nothing", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  const someone = (await rows<{ id: number }>(tessa, data, "complaints"))[0]!;
  const claim = (await rows<{ id: number; state: string }>(tessa, data, "warranty_claims", { column: "state", op: "eq", value: "to-raise" }))[0]!;
  const call = (await rows<{ id: number }>(tessa, data, "follow_ups", AFTERCARE))[0]!;
  const job = (await rows<{ id: number }>(tessa, data, "jobs"))[0]!;
  const company = (await rows<{ id: number }>(tessa, data, "companies"))[0]!;

  // The marketer and the front desk read none of the four tables.
  for (const person of ["lena", "corin"]) {
    const one = await api(person);
    for (const table of ["feedback", "complaints", "warranty_claims"]) expect((await one.get(data(table, "?limit=5"))).status(), `${person} ${table}`).toBe(403);
  }
  // The rep reads her own and writes no answer and no claim; the sales manager and the operations manager open no complaint.
  const dana = await api("dana");
  expect((await rows<{ owner_id: string }>(dana, data, "complaints")).length).toBe(3);
  expect((await dana.post(data("feedback"), { data: { values: { job_id: job.id, score: 5, answered_on: "2026-07-28" } }, headers: await csrf(dana) })).status()).toBe(403);
  expect((await dana.post(data("warranty_claims", `/${String(claim.id)}/actions/raise`), { data: { from: "to-raise" }, headers: await csrf(dana) })).status()).toBeGreaterThanOrEqual(403);
  const ivy = await api("ivy");
  expect((await ivy.post(data("complaints"), { data: { values: { company_id: company.id, cause: "late", text: "Spec: not hers" } }, headers: await csrf(ivy) })).status()).toBe(403);
  const ada = await api("ada");
  expect((await ada.post(data("complaints", `/${String(someone.id)}/actions/answered`), { data: { from: "open" }, headers: await csrf(ada) })).status()).toBe(403);
  expect((await ada.post(data("feedback"), { data: { values: { job_id: job.id, score: 5, answered_on: "2026-07-28" } }, headers: await csrf(ada) })).status()).toBe(403);
  // Read-only changes nothing.
  const grace = await api("grace");
  const graceHeaders = await csrf(grace);
  expect((await grace.post(data("feedback"), { data: { values: { job_id: job.id, score: 5, answered_on: "2026-07-28" } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.post(data("complaints", `/${String(someone.id)}/actions/answered`), { data: { from: "open" }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.patch(data("follow_ups", `/${String(call.id)}`), { data: { values: { done: true } }, headers: graceHeaders })).status()).toBe(403);
  expect((await grace.post(data("warranty_claims", `/${String(claim.id)}/actions/raise`), { data: { from: "to-raise" }, headers: graceHeaders })).status()).toBe(403);

  for (const person of ["dana", "ivy", "ada", "lena", "corin"]) {
    const page = await (await as(person)).newPage();
    for (const [address] of PAGES) {
      await page.goto(`${STAFF}${address}`);
      await expect(page.getByRole("heading", { level: 1 }), `${person} ${address}`).toHaveText(/This page is not part of your role|Nothing is switched on for you/);
    }
    await page.close();
  }
  const reader = await (await as("grace")).newPage();
  await reader.goto(`${STAFF}team`);
  await unfoldMenu(reader);
  const lines = await menu(reader).getByRole("link").allInnerTexts();
  const at = lines.indexOf(AFTER_THE_JOB[0]!);
  expect(lines.slice(at, at + 4)).toEqual(AFTER_THE_JOB);
  for (const [address, screen, heading] of PAGES) {
    await reader.goto(`${STAFF}${address}`);
    await expect(reader.locator(`[data-screen="${screen}"]`)).toBeVisible();
    await expect(reader.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(reader.locator(".crm-ac-card").first()).toBeVisible();
    // No button on any row, and no "Add an answer" (the chips that narrow the list are buttons too, and stay).
    await expect(reader.locator(".crm-ac-card").getByRole("button")).toHaveCount(0);
    await expect(reader.getByRole("button", { name: "Add an answer" })).toHaveCount(0);
  }
});

test("in Arabic, at 390 wide, in the dark: the four pages and the home read right to left with no sideways scroll", async ({ as, api }) => {
  const hugo = await api("hugo");
  await inArabic(hugo, async () => {
    const context = await as("hugo", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    const page = await context.newPage();
    const problems = watch(page);
    for (const [address, screen, heading] of [
      ["home", "amhome", null],
      ["aftercare-calls", "aftercare", "مكالمات المتابعة"],
      ["what-customers-said", "feedback", "ما قاله العملاء"],
      ["complaints", "complaints", "شكاوى العملاء"],
      ["warranty-claims", "claims", "مطالبات الضمان"],
    ] as const) {
      await page.goto(`${STAFF}${address}`);
      await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      if (heading !== null) await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.locator(".crm-skeleton")).toHaveCount(0);
      expect(await noSidewaysScroll(page), address).toBe(true);
      await picture(page, `p23-${screen}-ar-390-dark`);
    }
    await expect(page.locator(".crm-ac-card")).toHaveCount(5);
    await expect(page.getByTestId("wc-to-raise")).toHaveText("مطالبة واحدة لم تُرفع إلى المورّد بعد. افعل ذلك قبل نهاية الشهر.");
    expect(problems).toEqual([]);
  });
});
