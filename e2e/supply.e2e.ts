/**
 * P16, Supply, on the Inventory add-on: Stock and lead times (ledger §42) and
 * the Supplier scorecard (§60), with the stand's real Inventory (its sample
 * goes in by Inventory's own saves: an opening receipt and four orders sent).
 *
 * The scorecard (plan 68 S12) reads Inventory's receipts: on time over the
 * last 90 days, late deliveries, claims of the year (from stage 2, with After
 * the job), score and band, each compared with the server's own figures.
 *
 * Who reaches Supply: the CRM admin (Tessa), the operations manager (Ada),
 * Read-only (Grace) and the install's owner. Every figure on screen is compared
 * with what the server answers that person, asked directly. A rep (Dana) and
 * the sales manager (Ivy) are refused by the server. Nothing here writes from
 * a screen (both screens read only), so no lost reply is staged; the one
 * write, Ada's change of a deal's need in the live test, is put back.
 *
 * The add-on switched off for the app ("the part waiting for its add-on") is
 * `zz-supply-waits.e2e.ts`, which runs last because it takes the add-on away.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, unfoldMenu, watch } from "./helpers.ts";
import type { StandState } from "./stand.mjs";

/** Inventory's table by its own name, as the data routes take it. */
const inv = (stand: StandState, table: string, rest = ""): string => `/api/v1/data/${stand.connectionId}/${encodeURIComponent(stand.tables[`inventory_${table}`] ?? `inventory_${table}`)}${rest}`;

/** A figure asked of the server as this person. */
async function figure(person: APIRequestContext, stand: StandState, descriptor: Record<string, unknown>): Promise<{ status: number; result: { value?: number; items?: { key: string; value: number; values?: Record<string, number | null> }[] } }> {
  const res = await person.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, ...descriptor } }, headers: await csrf(person) });
  return { status: res.status(), result: res.status() === 200 ? ((await res.json()) as { result: never }).result : { value: undefined } };
}
const count = async (person: APIRequestContext, stand: StandState, table: string, filters: unknown[]): Promise<number> => {
  const answer = await figure(person, stand, { source: { name: table }, shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] });
  expect(answer.status).toBe(200);
  return Number(answer.result.value);
};

/** What the server answers this person for the Stock screen's own figures. */
async function served(person: APIRequestContext, stand: StandState, readsDeals: boolean) {
  const active = { column: "active", op: "eq", value: true };
  const inStock = await count(person, stand, "inventory_items", [active, { column: "on_hand", op: "gt", value: 0 }]);
  const empty = await count(person, stand, "inventory_items", [active, { column: "on_hand", op: "lte", value: 0 }]);
  const all = await count(person, stand, "inventory_items", [active]);
  const levels = await count(person, stand, "inventory_stock_points", [{ column: "reorder_level", op: "not_null" }]);
  const emptyIds = (await rows<{ id: number }>(person, (_ref, rest = "") => inv(stand, "items", rest), "items", { and: [active, { column: "on_hand", op: "lte", value: 0 }] })).map((row) => row.id);
  const needs = await rows<{ deal_id: number; item: number }>(person, (_ref, rest = "") => `/api/v1/data/${stand.connectionId}/${encodeURIComponent(stand.tables["crm_deal_stock_needs"]!)}${rest}`, "deal_stock_needs", { column: "deal_state", op: "eq", value: "open" });
  const leaning = [...new Set(needs.filter((need) => emptyIds.includes(need.item)).map((need) => need.deal_id))];
  let risk: { deals: number; amount: number } | { needs: number };
  if (readsDeals) {
    const answer = await figure(person, stand, { source: { name: "crm_deals" }, shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }, { column: "id", op: "in", value: leaning }], groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "a" }], limit: 5 });
    expect(answer.status).toBe(200);
    risk = { deals: Number(answer.result.items?.[0]?.values?.["n"] ?? 0), amount: Number(answer.result.items?.[0]?.values?.["a"] ?? 0) };
  } else {
    risk = { needs: await count(person, stand, "crm_deal_stock_needs", [{ column: "deal_state", op: "eq", value: "open" }, { column: "item", op: "in", value: emptyIds }]) };
  }
  return { all, inStock, empty, levels, risk };
}

const tile = (page: Page, figure: string) => page.locator(`.crm-sup-tile[data-figure="${figure}"]`);
const line = (page: Page, sku: string) => page.locator(`.crm-sup-line[data-line="${sku}"]`);
const chip = (page: Page, filter: string) => page.locator(`.crm-sup-chips .crm-chip-btn[data-filter="${filter}"]`);
const supplier = (page: Page, name: string) => page.locator(`.crm-sup-supplier[data-supplier="${name}"]`);
const narrowEnough = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const SHORT = "Short today against what open deals ask for: Acoustic booths, single: need 10, have 4, short 6; Acoustic rooms, four-person: need 2, have 0, short 2; Task seating, mesh back: need 68, have 60, short 8.";

test("Stock and lead times as the CRM admin: Inventory's lines, each figure the server's", async ({ as, stand }) => {
  const context = await as("tessa");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  await unfoldMenu(page);
  const menu = page.getByRole("navigation", { name: "Menu" });
  await expect(menu.getByRole("button", { name: "Supply" })).toBeVisible();
  await menu.getByRole("link", { name: "Stock and lead times" }).click();
  await expect(page).toHaveURL(/\/stock$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stock and lead times");

  const server = await served(context.request, stand, true);
  // Inventory's ten lines: seven with something on the shelf, three with nothing (the rooms, the fittings, the stools).
  expect([server.all, server.inStock, server.empty, server.levels]).toEqual([10, 7, 3, 0]);
  await expect(tile(page, "inStock").locator(".crm-sup-tile-value")).toHaveText(String(server.inStock));
  await expect(tile(page, "empty").locator(".crm-sup-tile-value")).toHaveText(String(server.empty));
  // No reorder level is set in Inventory's sample: nothing is "running low", and the tile says why.
  await expect(tile(page, "low")).toContainText("0");
  await expect(tile(page, "low")).toContainText("no reorder level is set in Inventory");
  // The longest a supplier says it takes: Marchmont Joinery, 49 days.
  await expect(tile(page, "lead").locator(".crm-sup-tile-value")).toHaveText("7 weeks");
  await expect(tile(page, "lead")).toContainText("Marchmont Joinery");
  // The open deals on a line with nothing on the shelf, counted and summed by the server: d2, d5, d8.
  expect(server.risk).toEqual({ deals: 3, amount: 71800 });
  await expect(page.locator('[data-figure="risk"]')).toHaveText("3 open deals lean on a line with nothing on the shelf: £71,800 between them.");
  // The ledger's "short today", line for line.
  await expect(page.locator('[data-figure="short"]')).toHaveText(`${SHORT} Counted where a deal says how many.`);

  // The chips count what the tiles count.
  for (const [filter, n] of [["all", server.all], ["inStock", server.inStock], ["low", 0], ["empty", server.empty]] as const) await expect(chip(page, filter).locator(".crm-sup-chip-n")).toHaveText(String(n));
  await expect(page.locator(".crm-sup-line")).toHaveCount(10);
  // Task seating: 60 on the shelf, 240 on order with no landing day (the sample's orders were sent with none), Ostrom's three weeks, two open deals.
  const seating = line(page, "MER-002");
  await expect(seating.locator('[data-figure="have"]')).toHaveText("60");
  await expect(seating.locator('[data-figure="on-order"]')).toHaveText("240no landing day yet");
  await expect(seating.locator('[data-figure="lead"]')).toHaveText("3 weeksOstrom Seating");
  await expect(seating.locator(".crm-pill")).toHaveText("In stock");
  const asked = await rows<{ deal_id: number; deal: string }>(context.request, (_ref, rest = "") => `/api/v1/data/${stand.connectionId}/${encodeURIComponent(stand.tables["crm_deal_stock_needs"]!)}${rest}`, "deal_stock_needs", { and: [{ column: "item", op: "eq", value: 2 }, { column: "deal_state", op: "eq", value: "open" }] }, "&lookup=deal:deal_id.name");
  expect(asked).toHaveLength(2);
  await expect(seating.locator(".crm-sup-deal")).toHaveCount(2);
  for (const need of asked) await expect(seating.locator(".crm-sup-deal").filter({ hasText: need.deal })).toHaveCount(1);
  await expect(line(page, "MER-004").locator(".crm-pill")).toHaveText("Nothing on the shelf");
  await expect(line(page, "MER-007").locator('[data-figure="lead"]')).toHaveText("No supplier set");

  await chip(page, "empty").click();
  await expect(page.locator(".crm-sup-line")).toHaveCount(3);
  await expect(page.locator(".crm-sup-line h2")).toHaveText(["Acoustic rooms, four-person", "Lab bench stools", "Showroom fittings"]);
  await chip(page, "low").click();
  await expect(page.getByText("No line is in this group.")).toBeVisible();
  await chip(page, "all").click();
  await picture(page, "p16-1-tessa-stock");
  // A deal on a line opens its room.
  await seating.locator(".crm-sup-deal a").first().click();
  await expect(page).toHaveURL(/\/deals\/\d+$/);
  expect(problems).toEqual([]);
});

/** What the server answers this person for a supplier's deliveries of the last 90 days (by its orders), and its claims of the year. */
async function judged(person: APIRequestContext, stand: StandState, supplier: { id: number; name: string } | null, claims: boolean): Promise<{ n: number; late: number; weeks: number; claims: number | null }> {
  const filters = [{ column: "status", op: "eq", value: "posted" }, { column: "late", op: "not_null" }, { column: "received_on", op: "gte", day: "today-89" }, ...(supplier === null ? [] : [{ column: "po_id.supplier_id", op: "eq", value: supplier.id }])];
  const answer = await figure(person, stand, { source: { name: "inventory_receipts" }, shape: "categorical", filters, groupBy: ["late"], aggregations: [{ fn: "count", alias: "n" }, { fn: "avg", column: "days_late", alias: "d" }], limit: 5 });
  expect(answer.status).toBe(200);
  const items = answer.result.items ?? [];
  const late = items.find((item) => Number(item.key) === 1);
  const raised = supplier === null || !claims ? null : await count(person, stand, "crm_warranty_claims", [{ column: "raised_on", op: "gte", day: "today-364" }, { or: [{ column: "supplier", op: "eq", value: supplier.id }, { column: "supplier_name", op: "eq", value: supplier.name }] }]);
  return { n: items.reduce((sum, item) => sum + Number(item.values?.["n"] ?? 0), 0), late: Number(late?.values?.["n"] ?? 0), weeks: late === undefined ? 0 : Math.floor(Number(late.values?.["d"]) / 7 + 0.5), claims: raised };
}
/** The ledger's arithmetic: on time to a tenth, half up; less 6 a claim and 7 a week over; held to 0…100, half up. */
const ledgerScore = (n: number, late: number, claims: number, weeks: number): number => Math.floor((Math.max(0, Math.min(1000, Math.floor((2000 * (n - late) + n) / (2 * n)) - 60 * claims - 70 * weeks)) + 5) / 10);
const percent = (n: number, late: number): string => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(Math.floor((2000 * (n - late) + n) / (2 * n)) / 1000);

test("the Supplier scorecard as the CRM admin: on time over 90 days, late deliveries, claims, score and band, each figure the server's", async ({ as, stand }) => {
  const context = await as("tessa");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}suppliers`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supplier scorecard");
  // After the job carries the warranty claims: from stage 2 they count against a supplier; at stage 1 there are none to count.
  const claims = stand.parts.includes("aftercare");
  await expect(page.locator(".crm-screen-sub")).toHaveText(
    claims ? "6 suppliers, judged on the two things that reach the customer: did it arrive when they said, and what happened when it went wrong." : "6 suppliers, judged on whether it arrived when they said.",
  );
  // All of them: the ledger's 105 on time of 123, over the last 90 days (the sample's older deliveries left out).
  const all = await judged(context.request, stand, null, claims);
  expect([all.n, all.late]).toEqual([123, 18]);
  await expect(tile(page, "on-time").locator(".crm-sup-tile-value")).toHaveText("85.4%");
  await expect(tile(page, "on-time")).toContainText("across the last 90 days");
  if (claims) {
    expect(await count(context.request, stand, "crm_warranty_claims", [{ column: "raised_on", op: "gte", day: "today-364" }])).toBe(5);
    await expect(tile(page, "claims").locator(".crm-sup-tile-value")).toHaveText("5");
  } else await expect(tile(page, "claims")).toHaveCount(0);

  // Each supplier: the server's figures, and the ledger's score and band from them.
  const listed = (await rows<{ id: number; name: string }>(context.request, (_ref, rest = "") => inv(stand, "suppliers", rest), "suppliers")).map((one) => ({ id: one.id, name: one.name }));
  const scores: Record<string, number> = {};
  for (const one of listed) {
    const got = await judged(context.request, stand, one, claims);
    const card = supplier(page, one.name);
    const score = ledgerScore(got.n, got.late, got.claims ?? 0, got.weeks);
    scores[one.name] = score;
    await expect(card.locator('[data-figure="score"]'), one.name).toHaveText(String(score));
    await expect(card.locator('[data-figure="band"]'), one.name).toHaveText(score >= 88 ? "Solid" : score >= 75 ? "Watch them" : "A problem");
    await expect(card.locator('[data-figure="on-time"]'), one.name).toHaveText(percent(got.n, got.late));
    await expect(card.locator('[data-figure="deliveries"]'), one.name).toHaveText(String(got.n));
    await expect(card.locator('[data-figure="late"]'), one.name).toHaveText(String(got.late));
    if (claims) await expect(card.locator('[data-figure="claims"]'), one.name).toHaveText(String(got.claims));
    else await expect(card.locator('[data-figure="claims"]'), one.name).toHaveCount(0);
  }
  // The ledger's six (screen 60), with the claims; without them, nothing counts against a supplier but its deliveries.
  expect(scores).toEqual(claims
    ? { "Halvard Werke": 96, "Kirkwall Steel": 84, "Ostrom Seating": 66, "Trellis Textiles": 78, "Fenlow Acoustics": 16, "Marchmont Joinery": 100 }
    : { "Halvard Werke": 96, "Kirkwall Steel": 90, "Ostrom Seating": 78, "Trellis Textiles": 84, "Fenlow Acoustics": 22, "Marchmont Joinery": 100 });
  // Highest first.
  await expect(page.locator(".crm-sup-supplier h2")).toHaveText(Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([name]) => name));
  await expect(tile(page, "talk").locator(".crm-sup-tile-value")).toHaveText(claims ? "2" : "1");
  await expect(tile(page, "talk")).toContainText(claims ? "Ostrom Seating" : "Fenlow Acoustics");
  await expect(page.locator('[data-figure="worst"]')).toHaveText("Fenlow Acoustics is on time 42.9% of the time and runs 3 weeks past what it promises. Every one of those weeks lands on a rep.");

  // Fenlow: six weeks promised, nine taken by the late ones; its lines and its order still on the way.
  const fenlow = supplier(page, "Fenlow Acoustics");
  await expect(fenlow.locator('[data-figure="lead"]')).toHaveText("9 weeks");
  await expect(fenlow.locator('[data-figure="slip"]')).toHaveText("Says 6 weeks; the late ones take 9 weeks.");
  await expect(fenlow.locator('[data-figure="supplies"]')).toHaveText("Supplies: Acoustic booths, single; Acoustic rooms, four-person");
  await expect(fenlow.locator('[data-figure="next"]')).toHaveText("PO-1002 is on its way, with no landing day yet.");
  await expect(supplier(page, "Marchmont Joinery").locator('[data-figure="slip"]')).toHaveText("Says 7 weeks and means it.");
  await expect(supplier(page, "Trellis Textiles").locator('[data-figure="next"]')).toHaveText("Nothing on order.");
  await picture(page, "p16-2-tessa-suppliers");
  // The claims behind a supplier's score are one click away while After the job is on.
  if (claims) {
    await fenlow.getByRole("link", { name: "Claims" }).click();
    await expect(page).toHaveURL(/\/warranty-claims$/);
  } else await expect(fenlow.getByRole("link", { name: "Claims" })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("Read-only reads both screens, 390 wide and dark, presses nothing, and the server refuses her writes", async ({ as, api, stand }) => {
  const page = await (await as("grace", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}stock`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stock and lead times");
  const grace = await api("grace");
  const server = await served(grace, stand, true);
  await expect(tile(page, "inStock").locator(".crm-sup-tile-value")).toHaveText(String(server.inStock));
  await expect(tile(page, "empty").locator(".crm-sup-tile-value")).toHaveText(String(server.empty));
  await expect(page.locator('[data-figure="risk"]')).toHaveText("3 open deals lean on a line with nothing on the shelf: £71,800 between them.");
  await expect(page.locator('[data-figure="short"]')).toContainText(SHORT);
  expect(await narrowEnough(page)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  // The only buttons in the page are the filter chips: there is nothing to write.
  await expect(page.locator("main button:not(.crm-chip-btn)")).toHaveCount(0);
  await picture(page, "p16-3-grace-stock-390-dark");
  await page.goto(`${STAFF}suppliers`);
  await expect(page.locator(".crm-sup-supplier")).toHaveCount(6);
  // Her scorecard is the CRM admin's: the same figures through the same grant.
  await expect(tile(page, "on-time").locator(".crm-sup-tile-value")).toHaveText("85.4%");
  await expect(supplier(page, "Fenlow Acoustics").locator('[data-figure="band"]')).toHaveText("A problem");
  await expect(supplier(page, "Marchmont Joinery").locator('[data-figure="score"]')).toHaveText("100");
  expect(await narrowEnough(page)).toBe(true);
  await picture(page, "p16-4-grace-suppliers-390-dark");
  expect(problems).toEqual([]);

  // The server: Inventory read only, and the app's own needs read only for her.
  const headers = await csrf(grace);
  expect((await grace.post(inv(stand, "items"), { data: { values: { name: "P16 Grace" } }, headers })).status()).toBe(403);
  expect((await grace.patch(inv(stand, "suppliers", "/1"), { data: { values: { lead_days: 1 } }, headers })).status()).toBe(403);
  const need = (await rows<{ id: number; qty: number | null }>(grace, (_ref, rest = "") => `/api/v1/data/${stand.connectionId}/${encodeURIComponent(stand.tables["crm_deal_stock_needs"]!)}${rest}`, "deal_stock_needs"))[0]!;
  expect((await grace.patch(`/api/v1/data/${stand.connectionId}/${encodeURIComponent(stand.tables["crm_deal_stock_needs"]!)}/${String(need.id)}`, { data: { values: { qty: 1 } }, headers })).status()).toBe(403);
  // What a line costs is not hers to read: the grant names a few columns.
  const item = (await (await grace.get(inv(stand, "items", "/1"))).json()) as { data: Record<string, unknown> };
  expect(item.data["name"]).toBe("Bench desk runs");
  expect(Object.keys(item.data)).not.toContain("cost_avg");
  expect(Object.keys(item.data)).not.toContain("value");
});

test("the operations manager lands on Stock, reads no open deal, and is told how many needs wait", async ({ as, api, stand }) => {
  const page = await (await as("ada")).newPage();
  const problems = watch(page);
  await page.goto(STAFF);
  const menu = page.getByRole("navigation", { name: "Menu" });
  if (stand.parts.includes("jobs")) {
    // From stage 2 her home is Jobs on site's; Supply follows the jobs' seven lines, then (stage 3) Vehicles and crew's six,
    // and Settings (her crews) closes the menu.
    await expect(page).toHaveURL(/\/home$/);
    await unfoldMenu(page);
    const fleet = stand.parts.includes("fleet") ? ["Vehicles", "Fuel", "Time sheets", "Training", "Subcontractors", "Insurance claims"] : [];
    await expect(menu.getByRole("link")).toHaveText(["Home", "Deliveries", "Day sheet", "Route", "Sign-off", "Delivery notes", "Job snag list", "Recycling and disposal", "Stock and lead times", "Supplier scorecard", ...fleet, "Settings"]);
    await menu.getByRole("link", { name: "Stock and lead times" }).click();
  } else {
    // At stage 1 her menu is Supply, and her first page is Stock (her home's part is a later stage's).
    await expect(menu.getByRole("link")).toHaveText(["Stock and lead times", "Supplier scorecard"]);
  }
  await expect(page).toHaveURL(/\/stock$/);
  const ada = await api("ada");
  const server = await served(ada, stand, false);
  // Three needs of open deals wait on an empty line (d2's rooms, d5's fittings, d8's stools): counted by the server for her.
  expect(server.risk).toEqual({ needs: 3 });
  await expect(page.locator('[data-figure="risk"]')).toHaveText("3 needs of open deals wait on a line with nothing on the shelf.");
  await expect(page.locator('[data-figure="short"]')).toContainText(SHORT);
  await expect(line(page, "MER-002").locator('[data-figure="asked"]')).toHaveText("Asked for on 2 open deals");
  await expect(line(page, "MER-002").locator(".crm-sup-deal")).toHaveCount(0);
  await expect(tile(page, "inStock").locator(".crm-sup-tile-value")).toHaveText(String(server.inStock));
  await picture(page, "p16-5-ada-stock");
  await page.goto(`${STAFF}suppliers`);
  await expect(page.locator(".crm-sup-supplier")).toHaveCount(6);
  await expect(tile(page, "on-time").locator(".crm-sup-tile-value")).toHaveText("85.4%");
  await expect(supplier(page, "Fenlow Acoustics").locator('[data-figure="score"]')).toHaveText(stand.parts.includes("aftercare") ? "16" : "22");
  expect(problems).toEqual([]);
  // The server: no open deal for her (at stage 1 no deal at all; from stage 2 a won deal, the jobs' own), and Inventory read only.
  const deals = await ada.get(`/api/v1/data/${stand.connectionId}/${encodeURIComponent(stand.tables["crm_deals"]!)}?limit=200`);
  if (!stand.parts.includes("jobs")) expect(deals.status()).toBe(403);
  else {
    expect(deals.status(), await deals.text()).toBe(200);
    const read = ((await deals.json()) as { data: { state: string; amount?: unknown }[] }).data;
    expect(read.length).toBeGreaterThan(0);
    expect(new Set(read.map((deal) => deal.state))).toEqual(new Set(["won"]));
    expect(read.some((deal) => "amount" in deal), "she reads no deal's amount").toBe(false);
  }
  expect((await ada.post(inv(stand, "items"), { data: { values: { name: "P16 Ada" } }, headers: await csrf(ada) })).status()).toBe(403);
});

test("the install's owner has Supply in the CRM admin's menu, with the same figures", async ({ as, api, stand }) => {
  const page = await (await as("owner")).newPage();
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Stock and lead times" }).click();
  const server = await served(await api("owner"), stand, true);
  await expect(tile(page, "empty").locator(".crm-sup-tile-value")).toHaveText(String(server.empty));
  await expect(page.locator('[data-figure="risk"]')).toHaveText("3 open deals lean on a line with nothing on the shelf: £71,800 between them.");
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Supplier scorecard" }).click();
  await expect(page.locator(".crm-sup-supplier")).toHaveCount(6);
});

test("a rep and the sales manager are refused Supply, by the page and by the server", async ({ as, api, stand }) => {
  const page = await (await as("dana")).newPage();
  await page.goto(`${STAFF}stock`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Stock and lead times" })).toHaveCount(0);
  for (const who of ["dana", "ivy"]) {
    const person = await api(who);
    // Inventory's tables answer neither of them: by a list, a row, a figure or the live stream.
    expect((await person.get(inv(stand, "items", "?limit=1"))).status(), who).toBe(403);
    expect((await person.get(inv(stand, "suppliers", "/1"))).status(), who).toBe(403);
    expect((await person.get(inv(stand, "receipts", "?limit=1"))).status(), who).toBe(403);
    expect((await figure(person, stand, { source: { name: "inventory_receipts" }, shape: "categorical", groupBy: ["late"], aggregations: [{ fn: "count", alias: "n" }] })).status, who).toBe(403);
    expect((await figure(person, stand, { source: { name: "inventory_stock_points" }, shape: "single-metric", aggregations: [{ fn: "count", alias: "n" }] })).status, who).toBe(403);
    const stream = await person.get(`/api/v1/events?channels=${encodeURIComponent(`widget-data:${stand.connectionId}:inventory_items`)}`, { timeout: 5000 });
    expect(stream.status(), who).toBe(403);
    // Search finds none of Inventory's rows for them.
    const found = (await (await person.get("/api/v1/search?q=Bench")).json()) as { data: { groups: { table?: string }[] } };
    expect(found.data.groups.filter((group) => (group.table ?? "").includes("inventory_")), who).toEqual([]);
  }
});

test("live, two people: the operations manager changes a deal's need and the CRM admin's open Stock follows", async ({ as, api, stand }) => {
  const page = await (await as("tessa")).newPage();
  await page.goto(`${STAFF}stock`);
  await expect(page.locator('[data-figure="short"]')).toContainText("Task seating, mesh back: need 68, have 60, short 8");
  const ada = await api("ada");
  const needsUrl = (rest = "") => `/api/v1/data/${stand.connectionId}/${encodeURIComponent(stand.tables["crm_deal_stock_needs"]!)}${rest}`;
  // d13 asks for eight task chairs.
  const [need] = await rows<{ id: number; qty: number }>(ada, (_ref, rest = "") => needsUrl(rest), "deal_stock_needs", { and: [{ column: "item", op: "eq", value: 2 }, { column: "qty", op: "eq", value: 8 }] });
  expect(need).toBeDefined();
  const headers = await csrf(ada);
  try {
    expect((await ada.patch(needsUrl(`/${String(need!.id)}`), { data: { values: { qty: 20 } }, headers })).status()).toBe(200);
    // No reload: the page heard the change and read again.
    await expect(page.locator('[data-figure="short"]')).toContainText("Task seating, mesh back: need 80, have 60, short 20");
  } finally {
    expect((await ada.patch(needsUrl(`/${String(need!.id)}`), { data: { values: { qty: 8 } }, headers })).status()).toBe(200);
  }
  await expect(page.locator('[data-figure="short"]')).toContainText("Task seating, mesh back: need 68, have 60, short 8");
});

test("in Arabic, right to left and 390 wide, with the same figures", async ({ as, api }) => {
  const tessa = await api("tessa");
  await inArabic(tessa, async () => {
    const page = await (await as("tessa", { viewport: { width: 390, height: 844 } })).newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}stock`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("المخزون ومدد التوريد");
    expect(await page.evaluate(() => document.documentElement.getAttribute("dir"))).toBe("rtl");
    await expect(page.locator('[data-figure="risk"]')).toContainText("صفقات مفتوحة تعتمد على صنف لا شيء منه على الرف");
    // Seven weeks, in the reader's own digits.
    await expect(tile(page, "lead").locator(".crm-sup-tile-value")).toHaveText(`${new Intl.NumberFormat("ar-EG").format(7)} أسابيع`);
    expect(await narrowEnough(page)).toBe(true);
    await picture(page, "p16-6-tessa-stock-ar-390");
    await page.goto(`${STAFF}suppliers`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("تقييم الموردين");
    await expect(page.locator(".crm-sup-supplier")).toHaveCount(6);
    // The band and the score in her language and digits; on time to a tenth, as the reader's own percent.
    await expect(supplier(page, "Fenlow Acoustics").locator('[data-figure="band"]')).toHaveText("مشكلة");
    await expect(supplier(page, "Marchmont Joinery").locator('[data-figure="score"]')).toHaveText(new Intl.NumberFormat("ar-EG").format(100));
    await expect(tile(page, "on-time").locator(".crm-sup-tile-value")).toHaveText(new Intl.NumberFormat("ar-EG", { style: "percent", maximumFractionDigits: 1 }).format(0.854));
    expect(await narrowEnough(page)).toBe(true);
    await picture(page, "p16-7-tessa-suppliers-ar-390");
    expect(problems).toEqual([]);
  });
});
