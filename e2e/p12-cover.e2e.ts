/**
 * P12, Cover (ledger screen 46): the three groups, New cover, Change the
 * dates, End today, Cancel, and the covering rep's page, on the sample, on
 * the ledger's Tuesday 28 July 2026.
 *
 * The sample holds one cover: Priya covers Dana from Mon 10 to Fri 21 August,
 * which on the stand's clock is still to come. A cover that RUNS is made by
 * the spec (Leo covers Sam from today) and taken away again, with its notes,
 * by the CRM admin after every test: the ledger's figures hold for the next.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, dealNamed, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { go, me, noSidewaysScroll, removeSpecCovers, room, stat, type CoverRow } from "./p12-helpers.ts";

const ownedBy = (owner: string): unknown => ({ and: [{ column: "owner_id", op: "eq", value: owner }, { column: "state", op: "eq", value: "open" }] });
const coversOf = (person: APIRequestContext, data: Data, owner: string): Promise<CoverRow[]> => rows<CoverRow>(person, data, "covers", { column: "owner_id", op: "eq", value: owner });

test.afterEach(async ({ api, data }) => {
  await removeSpecCovers(await api("tessa"), data);
});

test("the sales manager's Cover: three groups, the ledger's entry and its figures, each what the server answers her", async ({ as, api, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 120);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}week`);
  await go(page, "Cover");
  await expect(page).toHaveURL(/\/staff\/cover$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cover");

  // The three groups: one coming up, nothing running, nothing over.
  const coming = page.locator('[data-group="coming"]');
  await expect(coming.locator(".crm-cv-row")).toHaveCount(1);
  await expect(coming.locator(".crm-cv-row")).toContainText("Priya covers Dana");
  await expect(coming.locator(".crm-cv-row")).toContainText("Mon, Aug 10 to Fri, Aug 21");
  await expect(page.locator('[data-group="running"]')).toContainText("Nobody is covering anyone today.");
  await expect(page.locator('[data-group="over"]')).toContainText("No cover has ended yet.");
  await expect(coming.getByRole("button", { name: "Change the dates of the cover of Dana" })).toBeVisible();
  await expect(coming.getByRole("button", { name: "Cancel the cover of Dana" })).toBeVisible();

  // The entry, in the ledger's words.
  const entry = page.getByTestId("cover-entry");
  await expect(entry.locator(".crm-pill")).toHaveText("Coming up");
  await expect(entry.getByTestId("cover-head")).toHaveText("in 13 days");
  await expect(coming.locator(".crm-cv-row")).toContainText("in 13 days");
  await expect(entry.locator(".crm-cv-entry-title")).toHaveText("Priya covers Dana, Mon, Aug 10 to Fri, Aug 21");
  await expect(entry.locator(".crm-cv-entry-days")).toHaveText("10 working days · Dana is back Sat, Aug 22");
  await expect(entry).toContainText("Dana stays the owner of every one. Nothing changes hands.");

  // The four figures of ledger section 46.
  await expect(stat(page, "cv-deals")).toHaveText("6");
  await expect(page.getByTestId("cv-deals")).toContainText("£143,400 at full value");
  await expect(stat(page, "cv-closing")).toHaveText("4");
  await expect(page.getByTestId("cv-steps")).toContainText("Follow-ups open today");
  await expect(stat(page, "cv-steps")).toHaveText("7");
  await expect(page.getByTestId("cv-steps")).toContainText("3 past due · 0 due in the window");
  await expect(stat(page, "cv-visits")).toHaveText("2");
  await expect(page.getByTestId("cv-deals-sum")).toHaveText("6 · £143,400");

  // The six deals, the biggest first, each marked.
  const deals = page.locator(".crm-cv-deal");
  await expect(deals).toHaveCount(6);
  await expect(deals.first()).toContainText("Fourth-floor desk rows");
  await expect(deals.first()).toContainText("Nordwind Logistics");
  await expect(deals.first()).toContainText("covering for Dana");
  await expect(deals.first()).toContainText("Negotiation");
  await expect(deals.first()).toContainText("£52,800");
  await expect(deals.first()).toContainText("Fri, Aug 14");
  await expect(deals.first()).toContainText("closes in the window");
  await expect(page.locator(".crm-cv-deal", { hasText: "closes in the window" })).toHaveCount(4);
  await expect(deals.first()).toContainText("No briefing note yet.");
  await expect(page.locator('[aria-labelledby="crm-cv-steps"] .crm-cv-item')).toHaveCount(7);
  await expect(page.locator('[aria-labelledby="crm-cv-visits"] .crm-cv-item')).toHaveCount(2);

  // The team over the same days.
  const other = (name: string) => page.locator(".crm-cv-other", { hasText: name });
  await expect(other("Priya")).toContainText("3 deals · £26,500");
  await expect(other("Priya")).toContainText("none closing in the window · plus Dana’s 6 while covering");
  await expect(other("Sam")).toContainText("3 deals · £92,400");
  await expect(other("Sam")).toContainText("1 closing in the window");
  await expect(other("Leo")).toContainText("2 deals · £24,000");
  await expect(other("Leo")).toContainText("none closing in the window");

  // The same figures, asked of the server as Ivy.
  const ivy = context.request;
  const dana = await me(await api("dana"));
  const lent = await rows<{ amount: number; expected_close: string }>(ivy, data, "deals", ownedBy(dana));
  expect(lent.length).toBe(6);
  expect(lent.reduce((sum, deal) => sum + Number(deal.amount), 0)).toBe(143_400);
  expect(lent.filter((deal) => String(deal.expected_close).slice(0, 10) >= "2026-08-10" && String(deal.expected_close).slice(0, 10) <= "2026-08-21").length).toBe(4);
  const steps = await rows<{ due_at: string }>(ivy, data, "follow_ups", { and: [{ column: "owner_id", op: "eq", value: dana }, { column: "done", op: "eq", value: false }, { column: "kind", op: "eq", value: "step" }] });
  expect(steps.length).toBe(7);
  expect(steps.filter((step) => Date.parse(step.due_at) < Date.parse("2026-07-28T08:35:00Z")).length).toBe(3);
  await picture(page, "cover-1-ivy");
  expect(problems).toEqual([]);
});

test("the CRM admin sets a cover (a lost reply makes one), ends it today, re-dates another and cancels it; the server refuses an overlap", async ({ as, api, data }) => {
  const context = await as("tessa");
  const tessa = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}cover`);
  await expect(page.getByTestId("cover-entry")).toBeVisible();
  const sam = await me(await api("sam"));
  const leo = await me(await api("leo"));

  // The dialog holds the keyboard and starts on its first field.
  await page.getByTestId("cover-new").click();
  let dialog = page.getByRole("dialog", { name: "New cover" });
  await expect(dialog.getByLabel("Who is away")).toBeFocused();
  await expect(dialog.getByText("Leave it empty for until further notice.")).toBeVisible();

  // Somebody who cannot open deals cannot cover: the server's refusal, in the dialog's words.
  await dialog.getByLabel("Who is away").selectOption({ label: "Priya Raman" });
  await dialog.getByLabel("Who covers").selectOption({ label: "Lena Fischer" });
  await dialog.getByLabel("From").fill("2026-09-14");
  await dialog.getByRole("button", { name: "Set the cover" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Lena cannot open deals, so cannot cover them.");
  expect((await rows<CoverRow>(tessa, data, "covers")).length).toBe(1);

  // Leo covers Sam from today, until further notice. The reply to the save is dropped on the way back.
  await dialog.getByLabel("Who is away").selectOption({ label: "Sam Okonjo" });
  await dialog.getByLabel("Who covers").selectOption({ label: "Leo Vance" });
  await dialog.getByLabel("From").fill("2026-07-28");
  let posts = 0;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_covers$/.test(new URL(request.url()).pathname)) return route.fallback();
    posts += 1;
    await route.fetch();
    return route.abort("connectionreset");
  });
  await dialog.getByRole("button", { name: "Set the cover" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Leo covers Sam, from Tue, Jul 28, until further notice.");
  await page.unroute("**/api/v1/data/**");
  // Read back, not sent twice; and one cover is there.
  expect(posts).toBe(1);
  const made = await coversOf(tessa, data, sam);
  expect(made.length).toBe(1);
  expect(made[0]).toMatchObject({ cover_id: leo, ends_on: null });
  expect(String(made[0]!.starts_on).slice(0, 10)).toBe("2026-07-28");

  // It runs from today: its group, its card, and what it lends.
  const running = page.locator('[data-group="running"]');
  await expect(running.locator(".crm-cv-row")).toContainText("Leo covers Sam");
  await expect(running.locator(".crm-cv-row")).toHaveAttribute("data-on", "1");
  const entry = page.getByTestId("cover-entry");
  await expect(entry.locator(".crm-pill")).toHaveText("Running now");
  await expect(entry.locator(".crm-cv-entry-days")).toHaveText("Until further notice · it runs until it is ended");
  await expect(entry.getByTestId("cover-head")).toHaveText("day 1");
  await expect(stat(page, "cv-deals")).toHaveText("3");
  await expect(page.getByTestId("cv-deals")).toContainText("£92,400 at full value");
  await expect(page.getByTestId("cv-steps")).toContainText("Follow-ups to pick up");

  // End today: the deals stay lent through today.
  await running.getByRole("button", { name: "End the cover of Sam today" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("The cover ends today. From tomorrow Sam’s deals are off Leo’s board.");
  expect(String((await coversOf(tessa, data, sam))[0]!.ends_on).slice(0, 10)).toBe("2026-07-28");
  await expect(running.locator(".crm-cv-row")).toContainText("Tue, Jul 28 to Tue, Jul 28");
  await expect(entry.locator(".crm-cv-entry-days")).toHaveText("1 working day · Sam is back Wed, Jul 29");
  await expect(entry.getByTestId("cover-head")).toHaveText("day 1 of 1");

  // A cover to come: Sam covers Leo, Tue 1 to Fri 4 September.
  await page.getByTestId("cover-new").click();
  dialog = page.getByRole("dialog", { name: "New cover" });
  await dialog.getByLabel("Who is away").selectOption({ label: "Leo Vance" });
  await dialog.getByLabel("Who covers").selectOption({ label: "Sam Okonjo" });
  await dialog.getByLabel("From").fill("2026-09-01");
  await dialog.getByLabel("To", { exact: true }).fill("2026-09-04");
  await expect(dialog.getByText("Back on Sat, Sep 5.")).toBeVisible();
  await dialog.getByRole("button", { name: "Set the cover" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Sam covers Leo, Tue, Sep 1 to Fri, Sep 4.");
  const coming = page.locator('[data-group="coming"]');
  await expect(coming.locator(".crm-cv-row")).toHaveCount(2);

  // A second cover for Leo over those days: the dialog says so before anything is sent, and the server refuses it whoever asks.
  await page.getByTestId("cover-new").click();
  dialog = page.getByRole("dialog", { name: "New cover" });
  await dialog.getByLabel("Who is away").selectOption({ label: "Leo Vance" });
  await dialog.getByLabel("Who covers").selectOption({ label: "Dana Whitlock" });
  await dialog.getByLabel("From").fill("2026-09-03");
  await expect(dialog.getByRole("alert")).toHaveText("Leo already has a cover over those days.");
  await expect(dialog.getByRole("button", { name: "Set the cover" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("cover-new")).toBeFocused();
  const headers = await csrf(tessa);
  const dana = await me(await api("dana"));
  const overlap = await tessa.post(data("covers"), { data: { values: { owner_id: leo, cover_id: dana, starts_on: "2026-09-03", ends_on: null } }, headers });
  expect(overlap.status()).toBe(409);
  expect(((await overlap.json()) as { error: { code: string } }).error.code).toBe("BOOKING_TAKEN");

  // Change the dates: who is fixed, the days move.
  await coming.getByRole("button", { name: "Change the dates of the cover of Leo" }).click();
  dialog = page.getByRole("dialog", { name: "Change the dates" });
  await expect(dialog.getByTestId("cvd-fixed")).toHaveText("Sam Okonjo covers Leo Vance");
  await expect(dialog.getByLabel("From")).toBeFocused();
  await dialog.getByLabel("To", { exact: true }).fill("2026-09-08");
  await expect(dialog.getByText("Back on Wed, Sep 9.")).toBeVisible();
  await dialog.getByRole("button", { name: "Save the dates" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Dates changed.");
  expect(String((await coversOf(tessa, data, leo))[0]!.ends_on).slice(0, 10)).toBe("2026-09-08");
  await expect(coming.locator(".crm-cv-row", { hasText: "Sam covers Leo" })).toContainText("Tue, Sep 1 to Tue, Sep 8");

  // Cancel it: asked first, then gone.
  await coming.getByRole("button", { name: "Cancel the cover of Leo" }).click();
  const asking = page.getByRole("dialog", { name: "Cancel this cover?" });
  await expect(asking).toContainText("Sam covers Leo, Tue, Sep 1 to Tue, Sep 8. It has not started, so nothing was lent yet.");
  await asking.getByRole("button", { name: "Cancel the cover" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Cancelled: Sam no longer covers Leo.");
  expect(await coversOf(tessa, data, leo)).toEqual([]);
  await expect(coming.locator(".crm-cv-row")).toHaveCount(1);
  await picture(page, "cover-2-tessa");
  // The two things this spec staged itself (the server's 422 for Lena, the dropped reply) are the only ones.
  expect(problems.filter((problem) => !/status of 422|ERR_CONNECTION_RESET/.test(problem))).toEqual([]);
  expect(problems.length).toBe(2);
});

test("D-1: before her first day the covering rep is shown the dates and who, and nothing of the deals; the server answers her none", async ({ as, api, data, stand }) => {
  const context = await as("priya");
  await room(context.request, data, 80);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}today`);
  await go(page, "Cover");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cover");
  const entry = page.getByTestId("cover-entry");
  await expect(entry.locator(".crm-cv-entry-title")).toHaveText("Priya covers Dana, Mon, Aug 10 to Fri, Aug 21");
  await expect(entry.locator(".crm-cv-entry-days")).toHaveText("10 working days · Dana is back Sat, Aug 22");
  await expect(page.getByTestId("cover-early")).toContainText("Until Mon, Aug 10 you are shown the dates and who, and nothing else.");

  // Nothing of the lent deals: no figure, no row, no name, no amount, no note.
  await expect(page.locator(".crm-stat")).toHaveCount(0);
  await expect(page.locator(".crm-cv-deal")).toHaveCount(0);
  await expect(page.locator(".crm-cv-item")).toHaveCount(0);
  const screen = page.locator('[data-screen="cover"]');
  await expect(screen).not.toContainText("Fourth-floor desk rows");
  await expect(screen).not.toContainText("Nordwind");
  await expect(screen).not.toContainText("143,400");
  await expect(screen).not.toContainText("52,800");
  // Hers to read, nobody's to change from here.
  await expect(page.getByTestId("cover-new")).toHaveCount(0);
  await expect(page.locator("[data-act]")).toHaveCount(0);

  // The server, asked directly as Priya: Dana's deals, steps, visits and briefing notes are not there.
  const priya = context.request;
  const dana = await me(await api("dana"));
  expect(await rows(priya, data, "deals", { column: "owner_id", op: "eq", value: dana })).toEqual([]);
  const d1 = await dealNamed(await api("tessa"), data, "Fourth-floor desk rows");
  expect((await priya.get(data("deals", `/${String(d1.id)}`))).status()).toBe(404);
  expect((await priya.get(data("deals", `/${String(d1.id)}/history`))).status()).toBe(404);
  expect(await rows(priya, data, "follow_ups", { column: "owner_id", op: "eq", value: dana })).toEqual([]);
  expect(await rows(priya, data, "site_visits", { column: "rep_id", op: "eq", value: dana })).toEqual([]);
  expect(await rows(priya, data, "cover_notes")).toEqual([]);
  const headers = await csrf(priya);
  const figure = await priya.post("/api/v1/widget-data/query", {
    data: { descriptor: { connectionId: stand.connectionId, source: { name: stand.tables["crm_deals"] }, shape: "single-metric", filters: [{ column: "owner_id", op: "eq", value: dana }], aggregations: [{ fn: "count", alias: "n" }] } },
    headers,
  });
  expect(figure.status(), await figure.text()).toBe(200);
  expect(Number(((await figure.json()) as { result: { value: number | null } }).result.value ?? 0)).toBe(0);
  // What she does read of the cover: who and when, and not why Dana is away.
  const covers = await rows<Record<string, unknown>>(priya, data, "covers");
  expect(covers.length).toBe(1);
  expect(Object.keys(covers[0]!).sort()).toEqual(["cover_id", "ends_on", "id", "owner_id", "starts_on"]);
  // And she makes, changes and removes no cover.
  expect((await priya.post(data("covers"), { data: { values: { owner_id: dana, cover_id: await me(priya), starts_on: "2026-10-01", ends_on: "2026-10-02" } }, headers })).status()).toBe(403);
  expect((await priya.patch(data("covers", `/${String(covers[0]!["id"])}`), { data: { values: { starts_on: "2026-07-28" } }, headers })).status()).toBe(403);
  expect((await priya.delete(data("covers", `/${String(covers[0]!["id"])}?confirm=true`), { headers })).status()).toBe(403);
  await picture(page, "cover-3-priya-before");
  expect(problems).toEqual([]);
});

test("live, two people: from the first day the covering rep reads the lent deals; the person away writes the briefing note and it appears; the cover removed, they are gone at once", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  const headers = await csrf(tessa);
  const samContext = await as("sam");
  const leoContext = await as("leo");
  const sam = await me(samContext.request);
  const leo = await me(leoContext.request);
  const made = await tessa.post(data("covers"), { data: { values: { owner_id: sam, cover_id: leo, starts_on: "2026-07-28", ends_on: null } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const coverId = ((await made.json()) as { data: { id: number } }).data.id;

  // Leo, covering: the cover runs, and Sam's three deals are his to read.
  const leoPage = await leoContext.newPage();
  const problems = watch(leoPage);
  await leoPage.goto(`${STAFF}cover`);
  const entry = leoPage.getByTestId("cover-entry");
  await expect(entry.locator(".crm-pill")).toHaveText("Running now");
  await expect(entry.locator(".crm-cv-entry-title")).toHaveText("Leo covers Sam, from Tue, Jul 28, until further notice");
  await expect(leoPage.getByTestId("cover-early")).toHaveCount(0);
  await expect(stat(leoPage, "cv-deals")).toHaveText("3");
  await expect(leoPage.getByTestId("cv-deals")).toContainText("£92,400 at full value");
  await expect(leoPage.getByTestId("cv-deals-sum")).toHaveText("3 · £92,400");
  await expect(leoPage.locator(".crm-cv-deal")).toHaveCount(3);
  await expect(leoPage.locator(".crm-cv-deal").first()).toContainText("Showroom refit, phase one");
  await expect(leoPage.locator(".crm-cv-deal").first()).toContainText("covering for Sam");
  await expect(leoPage.locator(".crm-cv-deal").first()).toContainText("No briefing note yet.");
  // He writes no briefing note and changes no cover.
  await expect(leoPage.locator("[data-act]")).toHaveCount(0);
  await expect(leoPage.getByTestId("cover-new")).toHaveCount(0);
  // What the server answers him directly: the same three, for the same sum.
  const lent = await rows<{ amount: number }>(leoContext.request, data, "deals", ownedBy(sam));
  expect(lent.length).toBe(3);
  expect(lent.reduce((sum, deal) => sum + Number(deal.amount), 0)).toBe(92_400);

  // Sam, away: his own deals, and the note he leaves on the biggest.
  const samPage = await samContext.newPage();
  await samPage.goto(`${STAFF}cover`);
  await expect(samPage.getByTestId("cover-entry").locator(".crm-cv-entry-title")).toHaveText("Leo covers Sam, from Tue, Jul 28, until further notice");
  await samPage.getByRole("button", { name: "Write a briefing note on Showroom refit, phase one" }).click();
  await samPage.getByLabel("Briefing note for Leo").fill("Spec: Bea signs on Friday. Ring her, do not write.");
  await samPage.getByRole("button", { name: "Save the note" }).click();
  await expect(samPage.locator(".crm-toast")).toHaveText("Briefing note saved on Showroom refit, phase one.");
  // Leo's open page follows, with no reload.
  await expect(leoPage.locator(".crm-cv-deal").first().getByTestId("cv-note")).toHaveText("Spec: Bea signs on Friday. Ring her, do not write.");
  await picture(leoPage, "cover-4-leo-running");

  // A cover that still has its notes is not removed; without them it is, and the lent deals leave Leo at once.
  expect((await tessa.delete(data("covers", `/${String(coverId)}?confirm=true`), { headers })).status()).toBeGreaterThanOrEqual(400);
  await removeSpecCovers(tessa, data);
  await expect(leoPage.getByTestId("cover-none")).toContainText("No cover to show");
  expect(await rows(leoContext.request, data, "deals", ownedBy(sam))).toEqual([]);
  expect(problems).toEqual([]);
});

test("Read-only reads Cover with nothing to press and the server refuses her writes; a manager names only people she leads; the marketer is refused the rows", async ({ as, api, data }) => {
  const context = await as("grace");
  const page = await context.newPage();
  await page.goto(`${STAFF}cover`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cover");
  await expect(page.locator(".crm-cv-group")).toHaveCount(3);
  await expect(page.locator(".crm-cv-deal")).toHaveCount(6);
  await expect(page.getByTestId("cover-new")).toHaveCount(0);
  await expect(page.locator("[data-act]")).toHaveCount(0);
  const grace = context.request;
  const headers = await csrf(grace);
  const dana = await me(await api("dana"));
  const priya = await me(await api("priya"));
  const cover = (await rows<{ id: number }>(grace, data, "covers"))[0]!;
  expect((await grace.post(data("covers"), { data: { values: { owner_id: dana, cover_id: priya, starts_on: "2026-10-01", ends_on: "2026-10-02" } }, headers })).status()).toBe(403);
  expect((await grace.patch(data("covers", `/${String(cover.id)}`), { data: { values: { ends_on: "2026-08-22" } }, headers })).status()).toBe(403);
  expect((await grace.delete(data("covers", `/${String(cover.id)}?confirm=true`), { headers })).status()).toBe(403);
  const d1 = await dealNamed(grace, data, "Fourth-floor desk rows");
  expect((await grace.post(data("cover_notes"), { data: { values: { cover_id: cover.id, deal_id: d1.id, text: "Spec: no" } }, headers })).status()).toBe(403);

  // The sales manager makes a cover only where both people are ones she leads: the CRM admin is not.
  const ivy = await api("ivy");
  const refused = await ivy.post(data("covers"), { data: { values: { owner_id: dana, cover_id: await me(await api("tessa")), starts_on: "2026-10-01", ends_on: "2026-10-02" } }, headers: await csrf(ivy) });
  expect(refused.status()).toBe(403);

  // The marketer reads no cover, and her page at that address says so.
  const lena = await as("lena");
  expect((await lena.request.get(data("covers", "?limit=1"))).status()).toBe(403);
  const hers = await lena.newPage();
  await hers.goto(`${STAFF}cover`);
  await expect(hers.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
});

test("Cover at 390 wide in the dark, its dialog too; and in Arabic right to left", async ({ as, data }) => {
  const context = await as("ivy", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await room(context.request, data, 80);
  const page = await context.newPage();
  await page.goto(`${STAFF}cover`);
  await expect(page.locator(".crm-cv-deal")).toHaveCount(6);
  expect(await noSidewaysScroll(page)).toBe(true);
  await picture(page, "cover-5-ivy-390-dark");
  await page.getByTestId("cover-new").click();
  const dialog = page.getByRole("dialog", { name: "New cover" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((box) => box.scrollWidth <= box.clientWidth + 1 && box.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");

  const sam = await as("sam");
  await inArabic(sam.request, async () => {
    const arabic = await sam.newPage();
    await arabic.goto(`${STAFF}cover`);
    await expect(arabic.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(arabic.getByRole("heading", { level: 1 })).toHaveText("التغطية");
    await expect(arabic.getByTestId("cover-none")).toBeVisible();
    await picture(arabic, "cover-6-sam-arabic");
    await arabic.close();
  });
});
