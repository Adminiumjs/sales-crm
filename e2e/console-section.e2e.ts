/**
 * P17, the console's "Sales CRM" section (design D10; ruling Q4 of the plan's §0.16), in Adminium's own
 * dashboard served by the stand: the section's rail, the Overview with the ledger's figures (§2, §5,
 * §14, §28), the Pipeline page's headings, cards and note, Approvals (§27, §9), each figure the
 * reader's own or left out, and the roles it is not for refused by the server.
 *
 * It reads and writes nothing of the sample: no figure another spec reads moves.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, watch } from "./helpers.ts";
import type { StandState } from "./stand.mjs";

const section = (page: Page): Locator => page.locator('[data-part="nav-app-section"]').filter({ hasText: "Sales CRM" });
const card = (page: Page, key: string): Locator => page.locator(`[data-grid-item="${key}"]`);
/** The entries of the section's rail, in order, as a person reads them. */
const entries = async (page: Page): Promise<string[]> => (await section(page).locator("a").allInnerTexts()).map((text) => text.trim()).filter((text) => text !== "");
/** Stage 2 brings Jobs on site, whose console page is listed after Enquiries for every role that reads jobs. */
const withJobs = (stand: StandState, rail: readonly string[]): string[] => (stand.parts.includes("jobs") ? rail.flatMap((entry) => (entry === "Enquiries" ? [entry, "Jobs"] : [entry])) : [...rail]);
const column = (page: Page, label: string): Locator => page.locator("[data-board-column]").filter({ has: page.getByText(label, { exact: true }) });

test("the owner's console: the section's entries as drawn, and the Overview with the whole team's figures", async ({ as, api, stand }) => {
  const context = await as("owner");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/");
  // Stage 1: the twelve drawn but Jobs, whose part comes with stage 2; then the app's own screens. Stage 2: all twelve.
  await expect(section(page).locator("a").first()).toBeVisible();
  expect(await entries(page)).toEqual(withJobs(stand, ["Overview", "Pipeline", "Deals", "Companies", "Contacts", "Quotes", "Approvals", "Enquiries", "Rules", "Emails", "Sample data", "Open the staff screens"]));
  await expect(section(page).getByText("Setup", { exact: true })).toBeVisible();
  // A page kept off the rail is not listed (Stages, Follow-ups, the outbox …), and still opens by its address below.
  for (const name of ["Stages", "Follow-ups", "Settings"]) await expect(section(page).getByRole("link", { name, exact: true })).toHaveCount(0);

  await section(page).getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(/\/p\/crm-overview$/);
  // A figure card writes its amount short, as every overview of the console does (286,300 is "£286.3K").
  await expect(card(page, "open-pipeline")).toContainText("£286.3K");
  await expect(card(page, "weighted")).toContainText("£156.6K");
  await expect(card(page, "won-this-year")).toContainText("£81,600");
  await expect(card(page, "team-cover")).toContainText(/53\s?%|52\.9\s?%/);
  await expect(card(page, "open-deals")).toContainText("14");
  await expect(card(page, "unclaimed-enquiries")).toContainText("4");
  // Stage 1 has no Jobs: no card of it. Stage 2: the week's job visits, the figure the server answers the owner for that card.
  if (!stand.parts.includes("jobs")) await expect(card(page, "jobs-this-week")).toHaveCount(0);
  else {
    const owner = await api("owner");
    const pages = ((await (await owner.get("/api/v1/pages")).json()) as { data: { id: string; slug: string }[] }).data;
    const overview = ((await (await owner.get(`/api/v1/pages/${pages.find((one) => one.slug === "crm-overview")!.id}`)).json()) as { data: { config: Record<string, unknown> } }).data.config;
    const items = ((overview["layout"] ?? (overview["config"] as Record<string, unknown>)["layout"]) as { items: { i: string; config: { binding: Record<string, unknown> } }[] }).items;
    const binding = items.find((item) => item.i === "jobs-this-week")!.config.binding;
    const asked = await owner.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, ...binding } }, headers: await csrf(owner) });
    expect(asked.status(), await asked.text()).toBe(200);
    const result = ((await asked.json()) as { result: { value?: number; current?: number; values?: Record<string, number> } }).result;
    const visits = Number(result.value ?? result.current ?? result.values?.["visits"] ?? NaN);
    expect(Number.isFinite(visits), JSON.stringify(result)).toBe(true);
    await expect(card(page, "jobs-this-week")).toContainText("Job visits this week");
    await expect(card(page, "jobs-this-week")).toContainText(String(visits));
  }
  // The reps (§14), each with the year's cover.
  for (const [rep, cover] of [["Dana", "89"], ["Priya", "24"], ["Sam", "55"], ["Leo", "24"]] as const) await expect(card(page, "reps").getByRole("row").filter({ hasText: rep })).toContainText(cover);
  await expect(card(page, "reps")).toContainText("£140,000");
  // Sitting longest: d12 34 days, then d5 32 (§2, §5).
  // (A short list's line is a button that opens the deal.)
  const sitting = card(page, "sitting").getByRole("button").filter({ hasText: /\d$/ });
  await expect(sitting.nth(0)).toContainText("Depot supervisor stations");
  await expect(sitting.nth(0)).toContainText("34");
  await expect(sitting.nth(1)).toContainText("Showroom refit, phase one");
  await expect(sitting.nth(1)).toContainText("32");
  // Each chart's figures as a table: Show data on Pipeline by stage gives the five stages, value and weighted (§2), in the
  // install's currency: the value is an amount by its name, the weighted value is money because the app says so.
  await card(page, "by-stage").getByRole("button", { name: /show data/i }).click();
  for (const [stage, value, weighted] of [["Discovery", "£36,350", "£3,635"], ["Qualified", "£32,950", ""], ["Proposal", "£87,000", ""], ["Negotiation", "£105,400", "£79,050"], ["Verbal", "£24,600", ""]] as const) {
    await expect(card(page, "by-stage").getByRole("row").filter({ hasText: stage })).toContainText(value);
    if (weighted !== "") await expect(card(page, "by-stage").getByRole("row").filter({ hasText: stage })).toContainText(weighted);
  }
  // The forecast, July to October (§5): weighted value, so money too.
  await card(page, "forecast").getByRole("button", { name: /show data/i }).click();
  await expect(card(page, "forecast")).toContainText("£87,670");
  await expect(card(page, "forecast")).toContainText("£2,340");
  // The toolbar's way into the app's own screens.
  await expect(page.getByTestId("page-dashboard-link")).toHaveText(/Open Sales CRM/);
  await picture(page, "p17-owner-overview");
  expect(problems).toEqual([]);
});

test("the console's Pipeline: odds, count and both totals on each heading, the card's facts, and the note that opens Stages", async ({ as, data }) => {
  const context = await as("owner");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/p/crm-pipeline");
  const discovery = column(page, "Discovery");
  await expect(discovery).toBeVisible();
  await expect(discovery.locator('[data-part="column-badge"]')).toHaveText("10%");
  await expect(discovery.locator('[data-part="column-count"]')).toHaveText("3");
  await expect(discovery.locator('[data-part="column-total"]')).toContainText("£36,350");
  // The weighted value is money too: the app writes `deals.weighted_value` as money, so the heading prints the currency.
  await expect(discovery.locator('[data-part="column-total"]')).toContainText("£3,635");
  await expect(column(page, "Verbal").locator('[data-part="column-badge"]')).toHaveText("90%");
  await expect(column(page, "Negotiation").locator('[data-part="column-total"]')).toContainText("£79,050");
  // d12, 34 days in Qualified (§2): its company, its owner by name, its amount and its days, first in its column.
  const depot = column(page, "Qualified").locator('[role="button"]').filter({ hasText: "Depot supervisor stations" });
  await expect(depot).toContainText("34 days");
  await expect(depot).toContainText("£14,250");
  // Leo, by his initials (the board draws a person as a tile named after them).
  await expect(depot).toContainText("LV");
  // The note says where the columns come from, and opens that page by keyboard.
  const note = page.getByTestId("board-note");
  await expect(note).toHaveText("Columns come from Stages");
  await note.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/p\/crm-stages$/);
  // The console's own address of a deal (a notice or a search hit for somebody with no role of the app): the Pipeline is
  // the first page of the deals, so a deal opens on it, a won one too (no card of the board, the record all the same).
  const [won] = await rows<{ id: number; name: string }>(context.request, data, "deals", { column: "state", op: "eq", value: "won" }, "&order=id");
  await page.goto(`/p/crm-pipeline/r/${String(won!.id)}`);
  await expect(page.getByRole("dialog")).toContainText(won!.name);
  expect(problems).toEqual([]);
});

test("the sales manager: her figures are her team's, the whole team's two say so and show nothing, and Approvals lists the discount waiting", async ({ as, api, stand }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  await page.goto("/");
  await expect(section(page).locator("a").first()).toBeVisible();
  // Her role's pages; the console's own screens (Rules, Emails, Sample data) are the install owner's.
  expect(await entries(page)).toEqual(withJobs(stand, ["Overview", "Pipeline", "Deals", "Companies", "Contacts", "Quotes", "Approvals", "Enquiries", "Open the staff screens"]));
  await section(page).getByRole("link", { name: "Overview", exact: true }).click();
  // Ivy leads all four reps: her open pipeline is the team's.
  await expect(card(page, "open-pipeline")).toContainText("£286.3K");
  // A row limit holds her, so the whole team's cover and reps are never her part dressed as the whole.
  for (const key of ["team-cover", "reps"]) await expect(card(page, key)).toContainText("For the whole team only");
  await expect(card(page, "team-cover")).not.toContainText("53");
  // The server's refusal, asked directly as her.
  const ivy = await api("ivy");
  // (The list of pages is the owner's to read; Ivy reads the page itself by its id.)
  const pages = ((await (await (await api("owner")).get("/api/v1/pages")).json()) as { data: { id: string; slug: string }[] }).data;
  const overview = ((await (await ivy.get(`/api/v1/pages/${pages.find((one) => one.slug === "crm-overview")!.id}`)).json()) as { data: { config: Record<string, unknown> } }).data.config;
  const items = (((overview["layout"] ?? (overview["config"] as Record<string, unknown>)["layout"]) as { items: { i: string; config: { binding: Record<string, unknown> } }[] }).items);
  const cover = items.find((item) => item.i === "team-cover")!;
  const asked = await ivy.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, ...cover.config.binding } }, headers: await csrf(ivy) });
  expect([asked.status(), ((await asked.json()) as { error?: { code?: string } }).error?.code]).toEqual([403, "TEAM_FIGURE_WHOLE_ONLY"]);

  await section(page).getByRole("link", { name: "Approvals", exact: true }).click();
  await expect(page).toHaveURL(/\/p\/crm-approvals$/);
  // §27: one waiting, Q-1001 v2 (d5, Sam), 10.5 % off list.
  const quotes = (key: string) => card(page, key).getByRole("button").filter({ hasText: /Q-\d{4}/ });
  await expect(quotes("waiting")).toHaveCount(1);
  await expect(quotes("waiting")).toContainText("Q-1001");
  await expect(quotes("waiting")).toContainText("Showroom refit, phase one");
  // §9: sent, running out first: Q-1001 ran out on 26 July, Q-1002 runs out on 30 July.
  await expect(quotes("running-out").nth(0)).toContainText("Q-1001");
  await expect(quotes("running-out").nth(1)).toContainText("Q-1002");
  await picture(page, "p17-ivy-approvals");
  // Answering stays in the app (decision 159): the toolbar's link opens the staff side's own Approvals screen, by its deep
  // address, and the staff side serves that address.
  const link = page.getByTestId("page-dashboard-link");
  await expect(link).toHaveText(/Answer in Sales CRM/);
  // An address of the side's own opens in a window of its own.
  const [staff] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await staff.waitForLoadState();
  expect(staff.url()).toMatch(/\/apps\/crm\/staff\/approvals$/);
  await expect(staff.locator(".crm-approval").first()).toBeVisible();
  await expect(staff.locator(".crm-approval").first()).toContainText("Q-1001");
});

test("a rep and the operations manager: no Overview and no Approvals on their rail, and the server refuses both pages", async ({ as, api, stand }) => {
  // From stage 2 the operations manager reads a won deal (the jobs' own) and the jobs: Deals and Jobs join her rail.
  for (const [person, rail] of [
    ["dana", withJobs(stand, ["Pipeline", "Deals", "Companies", "Contacts", "Quotes", "Enquiries", "Open the staff screens"])],
    ["ada", stand.parts.includes("jobs") ? ["Deals", "Jobs", "Open the staff screens"] : ["Open the staff screens"]],
  ] as const) {
    const context = await as(person);
    const page = await context.newPage();
    await page.goto("/");
    await expect(section(page).locator("a").first()).toBeVisible();
    expect([person, await entries(page)]).toEqual([person, rail]);
    // By the page's address: the console draws no card of it.
    await page.goto("/p/crm-overview");
    await expect(page.locator('[data-grid-item="open-pipeline"]')).toHaveCount(0);
  }
  // The pages' own reads, by id, as the owner sees them: refused to Dana by the server.
  const owner = await api("owner");
  const all = ((await (await owner.get("/api/v1/pages")).json()) as { data: { id: string; slug: string }[] }).data;
  for (const person of ["dana", "ada"]) {
    const asked = await api(person);
    for (const slug of ["crm-overview", "crm-approvals"]) expect([403, 404], `${person} ${slug}`).toContain((await asked.get(`/api/v1/pages/${all.find((one) => one.slug === slug)!.id}`)).status());
  }
});

test("the Overview in Arabic, dark, 390 wide: right to left, the cards' words in Arabic, nothing sideways", async ({ as, api }) => {
  const grace = await api("grace");
  await inArabic(grace, async () => {
    const headers = await csrf(grace);
    await grace.patch("/api/v1/me/prefs", { data: { theme: "dark" }, headers });
    try {
      const context = await as("grace", { viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto("/p/crm-overview");
      await expect(page.locator("html")).toHaveAttribute("lang", "ar-EG");
      await page.reload();
      expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe("rtl");
      await expect(card(page, "open-pipeline")).toContainText("المسار المفتوح");
      await expect(card(page, "team-cover")).toContainText("تغطية الهدف");
      // A table card's headings in the reader's language too.
      await expect(card(page, "reps").getByRole("columnheader").first()).toContainText("المندوب");
      await expect(card(page, "reps").getByRole("columnheader").filter({ hasText: "التغطية" })).toHaveCount(1);
      // Read-only reads every row: the whole team's cover is hers to see.
      await expect(card(page, "team-cover")).toContainText(/53|52[.,٫]9|٥٣/);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sideways).toBeLessThanOrEqual(1);
      await picture(page, "p17-grace-overview-ar-dark-390");
    } finally {
      await grace.patch("/api/v1/me/prefs", { data: { theme: null }, headers });
    }
  });
});
