/**
 * P11, the manager's home: the Team view (ledger §5), a rep's one-to-one
 * (§10) and Stage health (§11); the homes of the CRM admin and Read-only.
 *
 * Reached from the menu as the sales manager, the CRM admin and Read-only,
 * and it is where each of them lands. A rep, the account manager, the
 * marketer and the front desk are told it is not part of their role; for the
 * three who read no open deal, the server says so too, asked directly.
 *
 * The one spec that makes a row (a deal, for the live look) names it
 * "P11 live …" and takes it away.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test, type Who } from "./fixtures.ts";
import { csrf, inArabic, removeDeals, rows, STAFF, watch, unfoldMenu } from "./helpers.ts";

type Stand = Who["stand"];

/** A figure, asked of the server directly as this person. */
async function figure<T>(person: APIRequestContext, stand: Stand, table: string, descriptor: Record<string, unknown>): Promise<{ status: number; result: T }> {
  const res = await person.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: stand.tables[`crm_${table}`] }, ...descriptor } }, headers: await csrf(person) });
  return { status: res.status(), result: res.status() === 200 ? ((await res.json()) as { result: T }).result : (undefined as T) };
}
const OPEN = { column: "state", op: "eq", value: "open" };
const money = (value: number): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "GBP", minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
const month = (page: Page, key: string) => page.locator(`.crm-tm-month[data-month="${key}"]`);
const rep = (page: Page, first: string) => page.locator(`.crm-tm-reps .crm-tm-row[data-rep="${first}"]`);
const chip = (page: Page, name: string | RegExp) => page.getByRole("group", { name: "Whose deals" }).getByRole("button", { name });
const stat = (page: Page, label: string) => page.locator(`.crm-stat[data-stat="${label}"]`);

test("Ivy lands on the Team view: the ledger's win rate, forecast, longest sitting and reps", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/team$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team view");
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Team view" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".crm-now")).toContainText("Tuesday, July 28, 2026");
  await expect(page.locator('[data-figure="win-rate"]')).toHaveText("Win rate 31% over twelve months (8 of 26) · 29% in 2026 (5 of 17)");
  await expect(page.locator('[data-figure="cycle"]')).toHaveText("Average cycle 54 days in 2026 · 54 all time");
  // Who has what open.
  for (const [name, count] of [["All", "14"], ["Dana", "6"], ["Priya", "3"], ["Sam", "3"], ["Leo", "2"]] as const) await expect(chip(page, new RegExp(`^${name}`)).locator(".crm-chip-count")).toHaveText(count);
  // Four months, to the last a deal is expected in (the design's strip stopped at September).
  await expect(page.locator(".crm-tm-month")).toHaveCount(4);
  for (const [key, name, value, sub] of [
    ["2026-07", "July", "£38,340", "3 deals expected"],
    ["2026-08", "August", "£87,670", "5 deals expected"],
    ["2026-09", "September", "£28,212.50", "5 deals expected"],
    ["2026-10", "October", "£2,340", "1 deal expected"],
  ] as const) {
    await expect(month(page, key).locator(".crm-tm-label")).toHaveText(name);
    await expect(month(page, key).locator(".crm-tm-month-value")).toHaveText(value);
    await expect(month(page, key)).toContainText(sub);
  }
  await expect(page.locator('[data-figure="cumulative"]')).toHaveText("£156,562.50");
  await expect(page.locator(".crm-tm-outside")).toHaveCount(0);
  // Sitting longest: d12 34 days, d5 32, d2 20; two of them stale.
  const longest = page.locator(".crm-tm-longest .crm-tm-row");
  await expect(longest).toHaveCount(3);
  await expect(longest.nth(0)).toContainText("Depot supervisor stations");
  await expect(longest.nth(0)).toContainText("Leo · Qualified · Nordwind Logistics");
  await expect(longest.nth(0)).toContainText("sitting 34 days · stale");
  await expect(longest.nth(0)).toContainText("£14,250");
  await expect(longest.nth(1)).toContainText("Showroom refit, phase one");
  await expect(longest.nth(1)).toContainText("sitting 32 days · stale");
  await expect(longest.nth(2)).toContainText("Acoustic booths for the studio floor");
  await expect(longest.nth(2)).toContainText("sitting 20 days · warm");
  await expect(page.locator(".crm-tm-longest")).toContainText("2 of these 3 are stale (30 days and up).");
  // The reps, each with their open deals by stage.
  await expect(page.locator(".crm-tm-reps .crm-tm-row")).toHaveCount(4);
  for (const [first, open, weighted, bars] of [
    ["Dana", "6 open deals", "£95,740", ["Discovery: 1", "Proposal: 2", "Negotiation: 2", "Verbal: 1"]],
    ["Priya", "3 open deals", "£11,695", ["Qualified: 2", "Verbal: 1"]],
    ["Sam", "3 open deals", "£44,590", ["Discovery: 1", "Proposal: 1", "Negotiation: 1"]],
    ["Leo", "2 open deals", "£4,537.50", ["Discovery: 1", "Qualified: 1"]],
  ] as const) {
    await expect(rep(page, first)).toContainText(open);
    await expect(rep(page, first).locator(".crm-tm-amount")).toHaveText(weighted);
    expect(await rep(page, first).locator(".crm-tm-bar > span").evaluateAll((spans) => spans.map((span) => span.getAttribute("aria-label")))).toEqual([...bars]);
  }
  expect(problems).toEqual([]);
  await picture(page, "1-ivy-team");

  // Narrowed to Dana: the forecast is hers; the reps and the longest sitting stay the team's.
  await chip(page, /^Dana/).click();
  await expect(page.locator('[data-figure="cumulative"]')).toHaveText("£95,740");
  await expect(month(page, "2026-07").locator(".crm-tm-month-value")).toHaveText("£31,320");
  await expect(month(page, "2026-08").locator(".crm-tm-month-value")).toHaveText("£64,420");
  await expect(page.locator(".crm-tm-reps .crm-tm-row")).toHaveCount(4);
});

test("every figure on the Team view is what the server answers that person, asked directly", async ({ as, data, stand }) => {
  for (const person of ["ivy", "tessa", "grace"]) {
    const context = await as(person);
    const page = await context.newPage();
    await page.goto(`${STAFF}team`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team view");
    const open = await rows<{ owner_id: string; stage_id: number; weighted_value: number; expected_close: string | null }>(context.request, data, "deals", OPEN);
    const closed = await rows<{ state: string; closed_on: string; cycle_days: number }>(context.request, data, "deals", { column: "state", op: "in", value: ["won", "lost"] });
    // The reader's own rows, added up here in the spec, against what the page shows.
    const sum = (list: { weighted_value: number }[]): number => Math.round(list.reduce((n, deal) => n + Number(deal.weighted_value), 0) * 100) / 100;
    await expect(chip(page, /^All/).locator(".crm-chip-count"), person).toHaveText(String(open.length));
    for (const key of ["2026-07", "2026-08", "2026-09", "2026-10"]) {
      const inMonth = open.filter((deal) => deal.expected_close?.startsWith(key) === true);
      await expect(month(page, key).locator(".crm-tm-month-value"), `${person} ${key}`).toHaveText(money(sum(inMonth)));
      await expect(month(page, key), `${person} ${key}`).toContainText(inMonth.length === 1 ? "1 deal expected" : `${String(inMonth.length)} deals expected`);
    }
    await expect(page.locator('[data-figure="cumulative"]'), person).toHaveText(money(sum(open.filter((deal) => (deal.expected_close ?? "") >= "2026-07-01"))));
    const won = (list: typeof closed) => list.filter((deal) => deal.state === "won");
    const year = closed.filter((deal) => deal.closed_on >= "2026-01-01");
    const twelve = closed.filter((deal) => deal.closed_on >= "2025-07-28");
    const pct = (list: typeof closed): string => `${String(Math.round((won(list).length / list.length) * 100))}%`;
    await expect(page.locator('[data-figure="win-rate"]'), person).toHaveText(`Win rate ${pct(twelve)} over twelve months (${String(won(twelve).length)} of ${String(twelve.length)}) · ${pct(year)} in 2026 (${String(won(year).length)} of ${String(year.length)})`);
    const cycle = (list: typeof closed): number => Math.round(won(list).reduce((n, deal) => n + Number(deal.cycle_days), 0) / won(list).length);
    await expect(page.locator('[data-figure="cycle"]'), person).toHaveText(`Average cycle ${String(cycle(year))} days in 2026 · ${String(cycle(closed))} all time`);
    // And the server's own figure, the way the page asks it: each rep's open deals and weighted value.
    const byOwner = await figure<{ items: { key: string; values: { n: number; w: number } }[] }>(context.request, stand, "deals", { shape: "categorical", filters: [OPEN], groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "w" }], limit: 200 });
    expect(byOwner.status).toBe(200);
    const names = Object.fromEntries(((await (await context.request.get("/api/v1/people?limit=200")).json()) as { people: { id: string; name: string }[] }).people.map((one) => [one.id, one.name]));
    for (const item of byOwner.result.items) {
      const first = names[item.key]!.split(" ")[0]!;
      await expect(rep(page, first).locator(".crm-tm-amount"), `${person} ${first}`).toHaveText(money(item.values.w));
      await expect(rep(page, first), `${person} ${first}`).toContainText(`${String(item.values.n)} open deal`);
    }
  }
});

test("the CRM admin and Read-only land on the Team view; Read-only has no button, and the server refuses her writes", async ({ as, api, data }) => {
  const tessa = await (await as("tessa")).newPage();
  await tessa.goto(STAFF);
  await expect(tessa).toHaveURL(/\/team$/);
  await expect(tessa.locator('[data-figure="cumulative"]')).toHaveText("£156,562.50");
  await expect(rep(tessa, "Dana").getByRole("link", { name: "One-to-one" })).toBeVisible();
  await expect(tessa.locator(".crm-tm-longest").getByRole("link", { name: "Stage health" })).toBeVisible();
  // The admin's Nudges sits under Settings, as "Nudge rules".
  await unfoldMenu(tessa);
  await expect(tessa.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Nudge rules" })).toHaveCount(1);

  const grace = await (await as("grace")).newPage();
  await grace.goto(STAFF);
  await expect(grace).toHaveURL(/\/team$/);
  await expect(grace.locator('[data-figure="cumulative"]')).toHaveText("£156,562.50");
  await expect(grace.locator(".crm-tm-reps .crm-tm-row")).toHaveCount(4);
  // The only controls in the page are the filter chips.
  await expect(grace.locator("#crm-page").getByRole("link")).toHaveCount(0);
  await expect(grace.locator("#crm-page").getByRole("button")).toHaveCount(5);
  await expect(grace.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: /Nudge/ })).toHaveCount(0);
  await picture(grace, "3-grace-team");
  // What Read-only may not do is refused by the server, not by a missing button.
  const direct = await api("grace");
  const headers = await csrf(direct);
  const d12 = (await rows<{ id: number }>(direct, data, "deals", { column: "name", op: "eq", value: "Depot supervisor stations" }))[0]!;
  expect((await direct.patch(data("deals", `/${String(d12.id)}`), { data: { values: { name: "Renamed by Read-only" } }, headers })).status()).toBe(403);
  expect((await direct.post(data("nudge_snoozes"), { data: { values: { rule: "stuck", deal_id: d12.id, until: "2026-08-04T08:35:00.000Z" }, clientKey: "p11readonlysnoozeAAAAAAAAAAAAAAA" }, headers })).status()).toBe(403);
  expect((await direct.get(data("nudge_snoozes", "?limit=1"))).status()).toBe(403);
  // Her address for Nudges says so too.
  await grace.goto(`${STAFF}nudges`);
  await expect(grace.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
});

test("a rep, the account manager, the marketer and the front desk have no Team view: the route says so, and the server refuses what it must", async ({ as, api, data, stand }) => {
  for (const person of ["dana", "hugo", "lena", "corin"]) {
    const page = await (await as(person)).newPage();
    for (const address of ["team", "stage-health", "why-we-lose", "activity", "nudges"]) {
      await page.goto(`${STAFF}${address}`);
      await expect(page.getByRole("heading", { level: 1 }), `${person} ${address}`).toHaveText("This page is not part of your role");
    }
    await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: /Team view|Stage health|Why we lose|Activity feed|Nudge/ })).toHaveCount(0);
  }
  // The marketer and the front desk read none of the tables these screens read, by any door.
  for (const person of ["lena", "corin"]) {
    const direct = await api(person);
    for (const table of ["deals", "stages", "lost_reasons", "activities", "deal_stage_changes", "deal_amount_changes", "nudge_snoozes", "reps", "follow_ups"]) {
      expect((await direct.get(data(table, "?limit=1"))).status(), `${person} reads ${table}`).toBe(403);
      expect((await figure(direct, stand, table, { shape: "single-metric", aggregations: [{ fn: "count", alias: "n" }] })).status, `${person}'s figure over ${table}`).toBe(403);
    }
  }
  // The account manager reads a deal once it is won (ruling R6): no open deal, no lost one, and none of the feed's tables.
  const hugo = await api("hugo");
  for (const table of ["activities", "deal_stage_changes", "deal_amount_changes", "nudge_snoozes"]) {
    expect((await hugo.get(data(table, "?limit=1"))).status(), `hugo reads ${table}`).toBe(403);
    expect((await figure(hugo, stand, table, { shape: "single-metric", aggregations: [{ fn: "count", alias: "n" }] })).status, `hugo's figure over ${table}`).toBe(403);
  }
  for (const state of ["open", "lost"]) {
    expect(await rows(hugo, data, "deals", { column: "state", op: "eq", value: state }), `hugo's ${state} deals`).toEqual([]);
    expect((await figure<{ value: number }>(hugo, stand, "deals", { shape: "single-metric", filters: [{ column: "state", op: "eq", value: state }], aggregations: [{ fn: "sum", column: "weighted_value", alias: "w" }] })).result.value, `hugo's sum over ${state} deals`).toBe(0);
  }
  // A rep reads her own deals and nobody else's: the server answers her six, whatever she asks.
  const dana = await api("dana");
  expect((await figure<{ value: number }>(dana, stand, "deals", { shape: "single-metric", filters: [OPEN], aggregations: [{ fn: "count", alias: "n" }] })).result.value).toBe(6);
});

test("live: Dana starts a deal and Ivy's open Team view follows", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await removeDeals(admin, data, "P11 live");
  const ivy = await (await as("ivy")).newPage();
  await ivy.goto(`${STAFF}team`);
  await expect(chip(ivy, /^Dana/).locator(".crm-chip-count")).toHaveText("6");
  try {
    const dana = await api("dana");
    const config = (await (await dana.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } };
    const stage = (await rows<{ id: number; label: string }>(dana, data, "stages", { column: "label", op: "eq", value: "Proposal" }))[0]!;
    const company = (await rows<{ id: number }>(dana, data, "companies", { column: "name", op: "eq", value: "Cobalt Legal" }))[0]!;
    const made = await dana.post(data("deals"), {
      data: { values: { name: "P11 live boardroom table", company_id: company.id, owner_id: config.user.id, stage_id: stage.id, typed_amount: 10000, expected_close: "2026-11-20" }, clientKey: "p11liveAAAAAAAAAAAAAAAAAAAAAAAAA" },
      headers: await csrf(dana),
    });
    expect(made.status(), await made.text()).toBe(201);
    // No reload: the stream brings it.
    await expect(chip(ivy, /^Dana/).locator(".crm-chip-count")).toHaveText("7");
    await expect(chip(ivy, /^All/).locator(".crm-chip-count")).toHaveText("15");
    await expect(rep(ivy, "Dana").locator(".crm-tm-amount")).toHaveText("£100,740");
    // A month the strip did not have: November, half of ten thousand.
    await expect(month(ivy, "2026-11").locator(".crm-tm-month-value")).toHaveText("£5,000");
    await expect(ivy.locator('[data-figure="cumulative"]')).toHaveText("£161,562.50");
  } finally {
    await removeDeals(admin, data, "P11 live");
  }
  await expect(chip(ivy, /^Dana/).locator(".crm-chip-count")).toHaveText("6");
  await expect(ivy.locator('[data-figure="cumulative"]')).toHaveText("£156,562.50");
});

test("a rep's one-to-one page: Dana's and Priya's, with the ledger's figures", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}team`);
  await rep(page, "Dana").getByRole("link", { name: "One-to-one" }).click();
  await expect(page).toHaveURL(/\/team\/usr_/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dana Whitlock");
  await expect(page.locator(".crm-o1-sub")).toHaveText("6 open deals · £143,400 at full value");
  await expect(stat(page, "Weighted").locator(".crm-stat-value")).toHaveText("£95,740");
  await expect(stat(page, "Win rate").locator(".crm-stat-value")).toHaveText("38%");
  await expect(stat(page, "Win rate")).toContainText("All time, 3 of 8 · 2026: 40% (2 of 5)");
  await expect(stat(page, "Average cycle").locator(".crm-stat-value")).toHaveText("46 days");
  await expect(stat(page, "Queue").locator(".crm-stat-value")).toHaveText("7");
  // Three are overdue at 09:35 (the ledger's moment); the stand's clock runs on, and a fourth falls due at 10:00.
  const dana = ((await (await context.request.get("/api/v1/people?q=Dana&limit=5")).json()) as { people: { id: string }[] }).people[0]!.id;
  const steps = await rows<{ due_at: string }>(context.request, data, "follow_ups", { and: [{ column: "owner_id", op: "eq", value: dana }, { column: "kind", op: "eq", value: "step" }, { column: "done", op: "eq", value: false }] });
  const now = ((await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { now: string }).now;
  const late = steps.filter((step) => step.due_at < now).length;
  expect([3, 4]).toContain(late);
  await expect(stat(page, "Overdue").locator(".crm-stat-value")).toHaveText(String(late));
  // Open work, the latest stage first; none of hers in Qualified.
  expect(await page.locator(".crm-o1-stage").evaluateAll((stages) => stages.map((stage) => stage.getAttribute("data-stage")))).toEqual(["Verbal", "Negotiation", "Proposal", "Discovery"]);
  const negotiation = page.locator('.crm-o1-stage[data-stage="Negotiation"]');
  await expect(negotiation.locator(".crm-o1-stage-head")).toContainText("Negotiation · 75%");
  await expect(negotiation.locator(".crm-o1-stage-sum")).toHaveText("£74,400");
  await expect(negotiation.locator(".crm-o1-deal").first()).toContainText("Fourth-floor desk rows");
  await expect(negotiation.locator(".crm-o1-deal").first()).toContainText("sitting 14 days · warm");
  await expect(page.locator('.crm-o1-stage[data-stage="Proposal"] .crm-o1-deal').first()).toContainText("sitting 20 days · warm");
  // The quarter began on 1 July: L4 lost, nothing won.
  await expect(page.locator('[data-figure="quarter"]')).toHaveText("Since Jul 1, 2026: 0 won, 1 lost");
  await expect(page.locator(".crm-o1-ended")).toHaveCount(1);
  await expect(page.locator(".crm-o1-ended")).toContainText("Archive shelving, second run");
  await expect(page.locator(".crm-o1-ended")).toContainText("Lost Mon, Jul 20 · at Proposal · Budget pulled");
  await expect(page.locator(".crm-o1-ended")).toContainText("49 days");
  // Worth raising: her oldest sitting deal, her late follow-ups, the empty stage, her biggest.
  const points = page.locator(".crm-o1-points li");
  await expect(points).toHaveCount(4);
  await expect(points.nth(0)).toHaveText("Acoustic booths for the studio floor has sat in Proposal for 20 days. Ask what it is waiting on.");
  await expect(points.nth(1)).toHaveText(`${String(late)} follow-ups are past due. The oldest is 4 days late.`);
  await expect(points.nth(2)).toHaveText("Nothing in Qualified. Worth checking what is ready to move.");
  await expect(points.nth(3)).toHaveText("Biggest open is Fourth-floor desk rows at £52,800, closing Fri, Aug 14.");
  await expect(page.locator(".crm-o1-step")).toHaveCount(5);
  await expect(page.locator(".crm-o1-step").first()).toContainText("Fourth-floor desk rows");
  expect(problems).toEqual([]);
  await picture(page, "4-ivy-dana-one-to-one");

  // What the server answers Ivy about Dana's rows, asked directly.
  const open = await rows<{ amount: number; weighted_value: number }>(context.request, data, "deals", { and: [OPEN, { column: "owner_id", op: "eq", value: dana }] });
  expect(open.length).toBe(6);
  await expect(page.locator(".crm-o1-sub")).toHaveText(`6 open deals · ${money(open.reduce((n, deal) => n + Number(deal.amount), 0))} at full value`);
  await expect(stat(page, "Weighted").locator(".crm-stat-value")).toHaveText(money(open.reduce((n, deal) => n + Number(deal.weighted_value), 0)));
  await expect(stat(page, "Queue").locator(".crm-stat-value")).toHaveText(String(steps.length));

  // Priya, by her chip: three open, nothing queued, nothing closed this quarter.
  await page.getByRole("group", { name: "Whose one-to-one" }).getByRole("link", { name: "Priya" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Priya Raman");
  await expect(page.locator(".crm-o1-sub")).toHaveText("3 open deals · £26,500 at full value");
  await expect(stat(page, "Weighted").locator(".crm-stat-value")).toHaveText("£11,695");
  await expect(stat(page, "Win rate")).toContainText("All time, 2 of 6 · 2026: 25% (1 of 4)");
  await expect(stat(page, "Average cycle").locator(".crm-stat-value")).toHaveText("62 days");
  await expect(stat(page, "Queue").locator(".crm-stat-value")).toHaveText("0");
  await expect(stat(page, "Overdue")).toContainText("All current");
  await expect(page.locator('[data-figure="quarter"]')).toHaveText("Nothing since Jul 1, 2026");
  await expect(page.getByText("Queue is clear.")).toBeVisible();
  // Their board: the team's board, on her deals.
  await page.getByRole("link", { name: "Their board" }).click();
  await expect(page).toHaveURL(/\/pipeline\/of\/usr_/);
  await expect(page.locator('[data-kit-part="board"] [data-board-card]')).toHaveCount(3);

  // Somebody who is nobody's rep reads as no record.
  await page.goto(`${STAFF}team/usr_nobody`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("There is no record at this address");
});

test("Stage health: the ledger's five stages, their ages and the deal sitting longest in each", async ({ as, data, stand }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Stage health" }).click();
  await expect(page).toHaveURL(/\/stage-health$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stage health");
  const stage = (label: string) => page.locator(`.crm-hl-stage[data-stage="${label}"]`);
  for (const [label, odds, count, weighted, buckets, oldest] of [
    ["Discovery", "10%", "3", "£3,635", ["3", "0", "0"], ["Task seating refresh", "3 days", "£9,750", "Leo"]],
    ["Qualified", "25%", "3", "£8,237.50", ["1", "1", "1"], ["Depot supervisor stations", "34 days", "£14,250", "Leo"]],
    ["Proposal", "50%", "3", "£43,500", ["1", "1", "1"], ["Showroom refit, phase one", "32 days", "£38,000", "Sam"]],
    ["Negotiation", "75%", "3", "£79,050", ["2", "1", "0"], ["Fourth-floor desk rows", "14 days", "£52,800", "Dana"]],
    ["Verbal", "90%", "2", "£22,140", ["2", "0", "0"], ["Canteen benches and stools", "5 days", "£7,800", "Priya"]],
  ] as const) {
    await expect(stage(label).locator(".crm-hl-head .crm-pill")).toHaveText(odds);
    await expect(stage(label).locator('[data-figure="count"]')).toHaveText(count);
    await expect(stage(label).locator('[data-figure="weighted"]')).toHaveText(weighted);
    for (const [i, bucket] of (["fresh", "warm", "stale"] as const).entries()) await expect(stage(label).locator(`.crm-hl-buckets [data-figure="${bucket}"]`), `${label} ${bucket}`).toHaveText(buckets[i]!);
    for (const words of oldest) await expect(stage(label).locator(".crm-hl-oldest"), label).toContainText(words);
  }
  await expect(page.locator(".crm-hl-key")).toContainText("Under 14 days");
  await expect(page.locator(".crm-hl-key")).toContainText("14 to 29 days");
  await expect(page.locator(".crm-hl-key")).toContainText("30 days and over");
  expect(problems).toEqual([]);
  await picture(page, "5-ivy-stage-health");

  // The same counts, asked of the server directly: by stage, and how many entered their stage 30 days ago or more.
  const byStage = await figure<{ items: { label: string; key: string; values: { n: number; w: number } }[] }>(context.request, stand, "deals", { shape: "categorical", filters: [OPEN], groupBy: ["stage_id"], groupLabel: "stage_id.label", aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "w" }], limit: 50 });
  const open = await rows<{ stage_id: number; entered_stage_at: string }>(context.request, data, "deals", OPEN);
  const stages = await rows<{ id: number; label: string }>(context.request, data, "stages");
  for (const one of stages) {
    const item = byStage.result.items.find((it) => String(it.key) === String(one.id))!;
    await expect(stage(one.label).locator('[data-figure="count"]')).toHaveText(String(item.values.n));
    await expect(stage(one.label).locator('[data-figure="weighted"]')).toHaveText(money(item.values.w));
    // Sitting 30 days or more on 28 July: entered before 29 June, London.
    const stale = open.filter((deal) => deal.stage_id === one.id && deal.entered_stage_at < "2026-06-28T23:00:00.000Z").length;
    await expect(stage(one.label).locator('.crm-hl-buckets [data-figure="stale"]')).toHaveText(String(stale));
  }

  // Narrowed to Leo: his two, and the other three stages say nothing is there.
  await page.getByRole("group", { name: "Whose deals" }).getByRole("button", { name: "Leo" }).click();
  await expect(stage("Qualified").locator('[data-figure="count"]')).toHaveText("1");
  await expect(stage("Proposal").locator('[data-figure="count"]')).toHaveText("0");
  await expect(stage("Proposal")).toContainText("Nothing here. Nothing has reached this stage.");
  await expect(stage("Verbal")).toContainText("Nothing here. Nothing on the brink.");
});

test("the Team view at 390 wide in the dark, and in Arabic from the right", async ({ as, api }) => {
  const narrow = await (await as("ivy", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  for (const address of ["team", "stage-health"]) {
    await narrow.goto(`${STAFF}${address}`);
    await expect(narrow.locator(".crm-screen")).toBeVisible();
    await expect(narrow.locator(".crm-skeleton")).toHaveCount(0);
    expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${address} does not scroll sideways`).toBe(true);
  }
  await picture(narrow, "6-ivy-stage-health-390-dark");
  await inArabic(await api("ivy"), async () => {
    const page = await (await as("ivy")).newPage();
    await page.goto(`${STAFF}team`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظرة على الفريق");
    await expect(page.locator(".crm-tm-month")).toHaveCount(4);
    await picture(page, "7-ivy-team-arabic");
  });
});

test("a person with two roles gets both menus, and the home of the role that leads", async ({ as, api, stand }) => {
  // Leo is a rep. For this spec the install's owner also makes him a sales manager, and takes it away again.
  const owner = await api("owner");
  const headers = await csrf(owner);
  const roles = ((await (await owner.get("/api/v1/roles")).json()) as { roles: { id: string; slug: string }[] }).roles;
  const manager = roles.find((role) => role.slug === "crm-sales-manager")!;
  const leo = stand.people["leo"]!.id;
  const before = await (await as("leo")).newPage();
  await before.goto(STAFF);
  await expect(before).toHaveURL(/\/today$/);
  await expect(before.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Team view" })).toHaveCount(0);
  try {
    expect((await owner.post(`/api/v1/users/${leo}/roles`, { data: { roleId: manager.id }, headers })).status()).toBe(200);
    const page = await (await as("leo")).newPage();
    await page.goto(STAFF);
    // The sales manager's role comes before the rep's in the order: her home, not his.
    await expect(page).toHaveURL(/\/team$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team view");
    const menu = page.getByRole("navigation", { name: "Menu" });
    const lines = await menu.getByRole("link").allTextContents();
    // The manager's lines lead; the rep's own (Today) follow; nothing is listed twice.
    expect(lines.slice(0, 6)).toEqual(["Team view", "Stage health", "Nudges", "Notifications", "Activity feed", "Weekly digest"]);
    expect(lines).toContain("Today");
    expect(lines).toContain("Why we lose");
    expect(new Set(lines).size).toBe(lines.length);
    // Both homes open for him.
    await menu.getByRole("link", { name: "Today" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Leo");
  } finally {
    expect((await owner.delete(`/api/v1/users/${leo}/roles/${manager.id}`, { headers })).status()).toBe(200);
  }
  await before.reload();
  await expect(before).toHaveURL(/\/today$/);
  await before.goto(`${STAFF}team`);
  await expect(before.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
});
