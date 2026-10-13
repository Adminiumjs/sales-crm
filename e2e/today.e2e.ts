/**
 * P02, Today: a rep's own figures and queue, with the ledger's figures (§1 of
 * `figures.md`), on the ledger's clock.
 *
 * Reached as the rep, from her menu. Not a page of a manager, the CRM admin
 * or Read-only (their menus do not hold it, and its address answers "not
 * found" or sends them home); and what it reads is the server's to refuse:
 * a marketer asks the same figures directly and is refused.
 */
import { expect, picture, test } from "./fixtures.ts";

const STAFF = "/apps/crm/staff/";

test("Dana lands on Today from the app's address, with the ledger's figures", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(STAFF);
  await expect(page).toHaveURL(/\/apps\/crm\/staff\/today$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Good morning, Dana.");
  // Her language in Adminium is English (US), so a date is written the American way.
  // The stand's clock starts at 09:35 and runs on while the specs before this one do: the time shown is the server's, to the ten minutes.
  const now = new Date(((await (await page.request.get(`${STAFF}surface-config.json`)).json()) as { now: string }).now);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).format(now);
  expect(clock.startsWith("09:")).toBe(true);
  await expect(page.locator(".crm-now")).toContainText(`Tuesday, July 28, 2026 · ${clock.slice(0, 4)}`);

  // The menu holds Today, and it is where she is.
  const today = page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Today" });
  await expect(today).toHaveAttribute("aria-current", "page");

  const kpis = page.locator(".crm-kpi");
  await expect(kpis).toHaveCount(3);
  // Open pipeline: 95,740 weighted · 6 deals · 143,400 at full value.
  await expect(kpis.nth(0)).toContainText("My open pipeline");
  await expect(kpis.nth(0).locator(".crm-kpi-value")).toHaveText("£95,740");
  await expect(kpis.nth(0)).toContainText("6 deals · £143,400 at full value");
  // Closing in July: 38,400 (d3, d6).
  await expect(kpis.nth(1)).toContainText("Closing in July");
  await expect(kpis.nth(1).locator(".crm-kpi-value")).toHaveText("£38,400");
  await expect(kpis.nth(1)).toContainText("2 deals,");
  // Overdue follow-ups: 3; the oldest is 4 days late.
  await expect(kpis.nth(2).locator(".crm-kpi-value")).toHaveText("3");
  await expect(kpis.nth(2)).toContainText("Oldest is 4 days late");

  // The queue: 7 = overdue 3 + today 2 + later this week 2.
  await expect(page.getByTestId("queue-count")).toHaveText("7");
  const count = (group: string) => page.locator(`[data-group="${group}"] .crm-step`);
  await expect(count("overdue")).toHaveCount(3);
  await expect(count("today")).toHaveCount(2);
  await expect(count("later")).toHaveCount(2);
  await expect(page.locator('[data-group="after"]')).toHaveCount(0);
  // The oldest first: f1, due Fri 24 Jul at 16:00, on the 52,800 deal.
  const first = count("overdue").first();
  await expect(first).toContainText("Fourth-floor desk rows");
  await expect(first).toContainText("Nordwind Logistics");
  await expect(first).toContainText("Fri, Jul 24, 16:00");
  await expect(first).toContainText("£52,800");
  expect(errors).toEqual([]);
  await picture(page, "5-dana-today");
});

test("every figure on the screen is what the server answers Dana, asked directly", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}today`);
  await expect(page.getByTestId("queue-count")).toHaveText("7");
  const mine = (await (await context.request.get(data("deals", `?limit=200&where=${encodeURIComponent(JSON.stringify({ column: "state", op: "eq", value: "open" }))}`))).json()) as { data: { amount: number; weighted_value: number; expected_close: string }[] };
  const sum = (rows: { amount: number }[]) => rows.reduce((total, row) => total + Number(row.amount), 0);
  const money = (value: number) => `£${value.toLocaleString("en-GB")}`;
  await expect(page.locator(".crm-kpi").nth(0).locator(".crm-kpi-value")).toHaveText(money(mine.data.reduce((total, row) => total + Number(row.weighted_value), 0)));
  await expect(page.locator(".crm-kpi").nth(0)).toContainText(`${String(mine.data.length)} deals · ${money(sum(mine.data))} at full value`);
  await expect(page.locator(".crm-kpi").nth(1).locator(".crm-kpi-value")).toHaveText(money(sum(mine.data.filter((deal) => deal.expected_close.startsWith("2026-07")))));
});

test("a follow-up pushed a day moves to tomorrow at its own hour, and one ticked off leaves the queue", async ({ as, data }) => {
  const context = await as("dana");
  const page = await context.newPage();
  await page.goto(`${STAFF}today`);
  const overdue = page.locator('[data-group="overdue"] .crm-step');
  await expect(overdue).toHaveCount(3);

  // "Push a day" on f1 (due Fri 24 Jul, 16:00): it would still be late on the 25th, so it lands on the day after today, at 16:00.
  await overdue.first().getByRole("button", { name: /What happened with/ }).click();
  await expect(page.getByRole("menu", { name: "What happened?" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Push a day" }).click();
  await expect(page.locator(".crm-toast")).toContainText("Pushed to Wed, Jul 29, 16:00");
  await expect(overdue).toHaveCount(2);
  await expect(page.locator(".crm-kpi").nth(2).locator(".crm-kpi-value")).toHaveText("2");
  // The deal has another step later in the week already: the pushed one is the one now due Wednesday at 16:00.
  await expect(page.locator('[data-group="later"] .crm-step').filter({ hasText: "Fourth-floor desk rows" }).filter({ hasText: "Wed, 16:00" })).toHaveCount(1);
  await picture(page, "6-dana-pushed-a-day");

  // Tick the next one off: by keyboard, Escape first to prove the menu closes.
  const tick = overdue.first().getByRole("button", { name: /What happened with/ });
  await tick.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "What happened?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "What happened?" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.locator(".crm-toast")).toContainText("is off the queue");
  await expect(page.getByTestId("queue-count")).toHaveText("6");

  // What the server holds now, asked directly: one step done (stamped as hers), one moved.
  const steps = (await (await context.request.get(data("follow_ups", "?limit=200&order=id"))).json()) as { data: { id: number; done: boolean; due_at: string; done_by_id: string | null; kind: string }[] };
  const f1 = steps.data.find((step) => step.id === 1)!;
  expect(f1.due_at).toBe("2026-07-29T15:00:00.000Z");
  expect(steps.data.filter((step) => step.kind === "step" && step.done).length).toBe(1);

  // Put both back, so the specs after this one read the ledger again.
  const config = (await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string };
  const headers = { "x-adminium-csrf": config.csrfToken };
  expect((await context.request.patch(data("follow_ups", "/1"), { data: { values: { due_at: "2026-07-24T15:00:00.000Z" } }, headers })).status()).toBe(200);
  const done = steps.data.find((step) => step.kind === "step" && step.done)!;
  expect((await context.request.patch(data("follow_ups", `/${String(done.id)}`), { data: { values: { done: false } }, headers })).status()).toBe(200);
});

test("a colleague's change reaches the open screen without a reload", async ({ as, api, data }) => {
  const page = await (await as("dana")).newPage();
  await page.goto(`${STAFF}today`);
  await expect(page.getByTestId("queue-count")).toHaveText("7");
  // Ivy, her manager, ticks one of Dana's follow-ups off from her own session.
  const ivy = await api("ivy");
  const config = (await (await ivy.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string };
  const headers = { "x-adminium-csrf": config.csrfToken };
  expect((await ivy.patch(data("follow_ups", "/2"), { data: { values: { done: true } }, headers })).status()).toBe(200);
  await expect(page.getByTestId("queue-count")).toHaveText("6");
  await expect(page.locator(".crm-kpi").nth(2).locator(".crm-kpi-value")).toHaveText("2");
  expect((await ivy.patch(data("follow_ups", "/2"), { data: { values: { done: false } }, headers })).status()).toBe(200);
  await expect(page.getByTestId("queue-count")).toHaveText("7");
});

test("Today is the rep's: a manager, the CRM admin and Read-only have no such line, and its address is not a page of theirs", async ({ as }) => {
  for (const person of ["ivy", "tessa", "grace"]) {
    const page = await (await as(person)).newPage();
    await page.goto(`${STAFF}today`);
    // Their roles' menus do not hold Today. The CRM admin and Read-only read the tables, so the page would draw: it is their own (empty) queue, and no menu leads there.
    await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Today" }), person).toHaveCount(0);
    await page.close();
  }
});

test("what Today reads is the server's to refuse: the marketer asks for the same rows and figures and gets none", async ({ as, api, data, stand }) => {
  const lena = await api("lena");
  expect((await lena.get(data("follow_ups", "?limit=5"))).status()).toBe(403);
  expect((await lena.get(data("deals", "?limit=5"))).status()).toBe(403);
  const config = (await (await lena.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string };
  const figure = await lena.post("/api/v1/widget-data/query", {
    data: { descriptor: { connectionId: stand.connectionId, shape: "single-metric", source: { name: stand.tables["crm_deals"] }, aggregations: [{ fn: "count", alias: "n" }] } },
    headers: { "x-adminium-csrf": config.csrfToken },
  });
  expect(figure.status()).toBe(403);
  // And her own page at that address says so, inside the frame.
  const page = await (await as("lena")).newPage();
  await page.goto(`${STAFF}today`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  await expect(page.locator(".crm-plain-who")).toHaveText("Signed in as Lena Fischer · Marketer");
  await picture(page, "7-lena-refused");
});

test("Today at 390 wide and in the dark", async ({ as }) => {
  const context = await as("dana", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto(`${STAFF}today`);
  await expect(page.getByTestId("queue-count")).toHaveText("7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(page, "8-dana-today-390-dark");
});
