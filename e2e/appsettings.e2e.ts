/**
 * P15, Settings (on F18 and F20): Selling with the price list and the reps,
 * Working time, Places, Maps and Parts.
 *
 * WHO OPENS IT: the CRM admin and the install's owner (five tabs), the sales
 * manager (Selling, no tabs), Read-only (five tabs, nothing to press). A rep,
 * the account manager, the marketer and the front desk are told it is not
 * part of their role. Every "may not" is tried by a direct call as that
 * person: the server's refusal, not a missing button.
 *
 * WHAT THESE SPECS CHANGE, AND PUT BACK: columns of the one settings row (put
 * back to the sample's by `restore`), a stage and a price-list line whose
 * names start "Spec" (removed by the CRM admin), a rep's profile for Ivy
 * (removed). No deal, quote or company is touched, so no other spec's figure
 * moves.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, unfoldMenu, watch, type Data } from "./helpers.ts";
import type { StandState } from "./stand.mjs";

const SAMPLE = {
  approval_threshold_pct: 5, quote_valid_days: 30, quote_warn_days: 3, sitting_warm_days: 14, sitting_stale_days: 30, nudge_quiet_days: 7, nudge_stuck_days: 21, nudge_soon_days: 7,
  week_starts: "mon", work_mon: true, work_tue: true, work_wed: true, work_thu: true, work_fri: true, work_sat: false, work_sun: false, work_from: "08:30", work_to: "17:30",
  depot_region: null, depot_postal_code: null, depot_country: "GB", depot_place: { placeId: 2644688 }, distance_unit: "km",
};

type Settings = Record<string, unknown> & { id: number };
const settingsRow = async (person: APIRequestContext, data: Data): Promise<Settings> => (await rows<Settings>(person, data, "settings"))[0]!;

/** Put the settings row and the two lists back as the sample has them, as the CRM admin. */
async function restore(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  const row = await settingsRow(admin, data);
  const res = await admin.patch(data("settings", `/${String(row.id)}`), { data: { values: SAMPLE }, headers });
  expect(res.status(), await res.text()).toBe(200);
  for (const ref of ["stages", "price_list"]) {
    for (const made of await rows<{ id: number }>(admin, data, ref, { column: ref === "stages" ? "label" : "name", op: "like", value: "Spec%" })) {
      expect((await admin.delete(data(ref, `/${String(made.id)}?confirm=true`), { headers })).status(), `${ref} ${String(made.id)}`).toBeLessThan(300);
    }
  }
  // A stage a spec moved goes back to its place.
  const stages = await rows<{ id: number; position: number }>(admin, data, "stages", undefined, "&order=id");
  for (const [at, stage] of stages.entries()) if (stage.position !== at) expect((await admin.patch(data("stages", `/${String(stage.id)}`), { data: { values: { position: at } }, headers })).status()).toBe(200);
}

const card = (page: Page, name: string) => page.locator(`.crm-ast-card[data-card="${name}"]`);
const setting = (page: Page, column: string) => page.locator(`[data-setting="${column}"]`);
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const toast = (page: Page) => page.locator(".crm-toast");
/** What went wrong on a page, less what the map server's own address did (a stand may have no way out to it; the map part says so itself). */
const own = (problems: string[]): string[] => problems.filter((line) => !/net::ERR|openfreemap|maplibre/i.test(line));
const noSidewaysScroll = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const config = async (person: APIRequestContext): Promise<{ maps: { enabled: boolean; server: string | null; routing: boolean }; modules: Record<string, boolean> }> =>
  (await (await person.get(`${STAFF}surface-config.json`)).json()) as { maps: { enabled: boolean; server: string | null; routing: boolean }; modules: Record<string, boolean> };

async function openSettings(page: Page): Promise<void> {
  await page.goto(STAFF);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
}

/**
 * The tabs a person who reads every setting is offered, in the stand's stage: stage 1's five, and from stage 2 Crews
 * (with Jobs on site) and After the job (with its part). The parts the Parts tab lists, the same way.
 */
const TABS: readonly (readonly [string, string, string?])[] = [["Selling", "المبيعات"], ["Working time", "وقت العمل"], ["Places", "الأماكن"], ["Maps", "الخرائط"], ["Parts", "الأجزاء"], ["Crews", "الفرق", "jobs"], ["After the job", "بعد التنفيذ", "aftercare"]];
const tabsOf = (stand: StandState, arabic = false): string[] => TABS.filter(([, , part]) => part === undefined || stand.parts.includes(part)).map(([en, ar]) => (arabic ? ar : en));
const STAGE_PARTS: Record<number, string[]> = { 1: ["accounts", "inbox", "quotes", "selling", "supply", "team"], 2: ["accounts", "aftercare", "inbox", "jobs", "quotes", "selling", "showroom", "supply", "team"] };
const partsOf = (stand: StandState): string[] => STAGE_PARTS[stand.stage] ?? [...stand.parts].sort();

/** Type a number into a setting and leave the field by Enter. */
async function type(page: Page, column: string, value: string): Promise<void> {
  const field = setting(page, column).locator("input");
  await field.fill(value);
  await field.press("Enter");
}

test("the CRM admin reaches every tab of her stage from her menu, with the ledger's figures on Selling", async ({ as, api, data, stand }) => {
  const direct = await api("tessa");
  await restore(direct, data);
  const page = await (await as("tessa")).newPage();
  const problems = watch(page);
  await openSettings(page);
  await expect(page.locator('[data-screen="appsettings"]')).toHaveAttribute("data-writes", "all");
  await expect(page.getByRole("tab")).toHaveText(tabsOf(stand));
  await expect(tab(page, "Selling")).toHaveAttribute("aria-selected", "true");

  // Stages: the ledger's 14 open deals at £156,562.50 weighted, five stages, each with the count the server answers her.
  const stages = card(page, "stages");
  await expect(stages.locator('[data-figure="weighted"]')).toHaveText("£156,562.50");
  await expect(stages.locator('[data-figure="open"]')).toHaveText("14 open deals");
  const kept = await rows<{ id: number; label: string; odds: number }>(direct, data, "stages", undefined, "&order=position");
  expect(kept.length).toBe(5);
  const figure = async (filters: unknown[], groupBy: string): Promise<Record<string, number>> => {
    const res = await direct.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: stand.tables["crm_deals"] }, shape: "categorical", filters, groupBy: [groupBy], aggregations: [{ fn: "count", alias: "n" }], limit: 50 } }, headers: await csrf(direct) });
    expect(res.status(), await res.text()).toBe(200);
    return Object.fromEntries(((await res.json()) as { result: { items: { key: string | number; value: number }[] } }).result.items.map((item) => [String(item.key), Number(item.value)]));
  };
  const openBy = await figure([{ column: "state", op: "eq", value: "open" }], "stage_id");
  expect(Object.values(openBy).reduce((sum, n) => sum + n, 0)).toBe(14);
  for (const [at, stage] of kept.entries()) {
    const row = stages.locator(".crm-ast-row").nth(at);
    await expect(row.locator(".crm-ast-input-name")).toHaveValue(stage.label);
    await expect(row.locator(".crm-ast-input-odds")).toHaveValue(String(Math.round(Number(stage.odds) * 100)));
    const n = openBy[String(stage.id)] ?? 0;
    await expect(row.locator('[data-figure="count"]')).toHaveText(`${String(n)} open ${n === 1 ? "deal" : "deals"}`);
    // A stage deals name stays: its bin is off.
    await expect(row.locator("[data-remove]")).toBeDisabled();
  }
  // Lost reasons: the ledger's 18 lost deals, 6 / 3 / 3 / 3 / 3.
  const reasons = card(page, "reasons");
  await expect(reasons.locator('[data-figure="lost"]')).toHaveText("18 lost deals");
  const lostBy = await figure([{ column: "state", op: "eq", value: "lost" }], "lost_reason_id");
  expect(Object.values(lostBy).sort()).toEqual([3, 3, 3, 3, 6]);
  const keptReasons = await rows<{ id: number; label: string }>(direct, data, "lost_reasons", undefined, "&order=position");
  for (const [at, reason] of keptReasons.entries()) {
    await expect(reasons.locator(".crm-ast-row").nth(at).locator(".crm-ast-input-name")).toHaveValue(reason.label);
    await expect(reasons.locator(".crm-ast-row").nth(at).locator('[data-figure="count"]')).toHaveText(`${String(lostBy[String(reason.id)] ?? 0)} lost deals`);
  }
  // The numbers, as the sample's row holds them.
  for (const [column, value] of [["approval_threshold_pct", "5"], ["quote_valid_days", "30"], ["quote_warn_days", "3"], ["sitting_warm_days", "14"], ["sitting_stale_days", "30"], ["nudge_quiet_days", "7"], ["nudge_stuck_days", "21"], ["nudge_soon_days", "7"], ["lead_cold_days", "14"]] as const) {
    await expect(setting(page, column).locator("input"), column).toHaveValue(value);
  }
  // Ledger §2: warm d1, d2, d8; stale d5, d12. §17: quiet 2, stuck 2, soon 1. Each rule's real state: the install ships them off.
  await expect(setting(page, "sitting_warm_days")).toContainText("3 open deals warm now");
  await expect(setting(page, "sitting_stale_days")).toContainText("2 open deals stale now");
  const told = ((await (await direct.get("/api/v1/apps/crm/rules")).json()) as { rules: { key: string; on: boolean }[] }).rules;
  for (const [column, key, caught] of [["nudge_quiet_days", "nudge-quiet", "2 deals caught now"], ["nudge_stuck_days", "nudge-stuck", "2 deals caught now"], ["nudge_soon_days", "nudge-soon", "1 deal caught now"]] as const) {
    const on = told.find((rule) => rule.key === key)?.on;
    expect(on, key).toBe(false);
    await expect(setting(page, column)).toContainText(`${caught} · the rule is off`);
  }
  // The price list (17 lines) and the reps (4), as the server holds them.
  const prices = await rows<{ name: string }>(direct, data, "price_list", undefined, "&order=name");
  expect(prices.length).toBe(17);
  await expect(card(page, "prices").locator('[data-figure="lines"]')).toHaveText("17 lines");
  await expect(card(page, "prices").locator(".crm-ast-row")).toHaveCount(17);
  await expect(card(page, "prices").locator(".crm-ast-row").first().locator(".crm-ast-input-name")).toHaveValue(prices[0]!.name);
  await expect(card(page, "reps").locator(".crm-ast-row")).toHaveCount(4);
  await expect(card(page, "reps").locator(".crm-ast-row").first()).toContainText("Dana Whitlock");
  await picture(page, "p15-1-tessa-selling");

  // Working time.
  await tab(page, "Working time").click();
  await expect(page).toHaveURL(/\/settings\/working-time$/);
  const days = page.getByRole("group", { name: "Working days" });
  await expect(days.getByRole("button")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  await expect(days.locator('[aria-pressed="true"]')).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  await expect(page.getByLabel("The day starts")).toHaveValue("08:30");
  await expect(page.getByLabel("The day ends")).toHaveValue("17:30");
  await expect(page.getByRole("group", { name: "The week starts on" }).locator('[aria-pressed="true"]')).toHaveText("Monday");
  await expect(page.locator('[data-figure="week"]')).toHaveText("5 days · 08:30 to 17:30 · 45 h a week");
  // No crew, no job at stage 1: the crew's day comes with Jobs on site (stage 2), the sample's 8 hours.
  if (stand.parts.includes("jobs")) await expect(setting(page, "working_day_hours").locator("input")).toHaveValue(String(Number((await settingsRow(direct, data))["working_day_hours"])));
  else await expect(card(page, "crew")).toHaveCount(0);

  // Places: the depot's address in parts, and its place by town.
  await tab(page, "Places").click();
  await expect(setting(page, "depot_name").locator("input")).toHaveValue("Meridian depot");
  await expect(setting(page, "depot_address").locator("textarea")).toHaveValue("Unit 2, Aire Works");
  await expect(setting(page, "depot_town").locator("input")).toHaveValue("Leeds");
  await expect(setting(page, "depot_country").locator("input")).toHaveValue("GB");
  await expect(page.locator('[data-figure="depot"]')).toHaveText("Unit 2, Aire Works, Leeds");
  await expect(page.locator('[data-figure="pin"]')).toHaveText("Placed by town. Drag the pin to the street.");
  // The app's host of the kit's map (the kit's own root carries the same mark inside it).
  await expect(page.locator('.crm-ast-map-kit[data-kit-part="map"]')).toBeVisible();
  await expect(page.getByRole("group", { name: "Unit of distance" }).locator('[aria-pressed="true"]')).toHaveText("Kilometres");

  // Maps and Parts: what is on, read from the server, with who to ask and nothing to switch.
  const told2 = await config(direct);
  await tab(page, "Maps").click();
  await expect(card(page, "maps").locator("[data-state]")).toHaveAttribute("data-state", told2.maps.enabled ? "on" : "off");
  if (told2.maps.server !== null) await expect(card(page, "maps").locator('[data-figure="server"]')).toHaveText(new URL(told2.maps.server).host);
  await expect(card(page, "roads").locator("[data-state]")).toHaveAttribute("data-state", told2.maps.enabled && told2.maps.routing ? "on" : "off");
  await expect(page.locator('[data-panel="maps"]')).toContainText("Ask the person who runs this install.");
  await expect(page.locator('[data-panel="maps"]').locator("button, input, a")).toHaveCount(0);
  await tab(page, "Parts").click();
  const parts = Object.keys(told2.modules);
  expect(parts.sort()).toEqual(partsOf(stand));
  await expect(page.locator(".crm-ast-part")).toHaveCount(parts.length);
  for (const id of parts) await expect(page.locator(`.crm-ast-part[data-part="${id}"]`)).toHaveAttribute("data-on", told2.modules[id] === true ? "1" : "0");
  await expect(page.locator('[data-figure="parts"]')).toHaveText(`${String(parts.filter((id) => told2.modules[id]).length)} of ${String(parts.length)} on`);
  await expect(page.locator('.crm-ast-part[data-part="inbox"] .crm-ast-roles')).toHaveText("RolesCRM adminSales managerSales repMarketerFront deskRead-only");
  await expect(page.locator('[data-panel="parts"]')).toContainText("Ask the person who runs this install.");
  await expect(page.locator('[data-panel="parts"]').locator("button, input, a")).toHaveCount(0);
  // The CRM admin may not switch a part: the server's refusal.
  expect((await direct.put("/api/v1/apps/crm/parts/inbox", { data: { on: false }, headers: await csrf(direct) })).status()).toBe(403);
  await picture(page, "p15-1-tessa-parts");
  // Back goes to the tab before.
  await page.goBack();
  await expect(tab(page, "Maps")).toHaveAttribute("aria-selected", "true");
  expect(own(problems)).toEqual([]);
});

test("the sales manager has Selling and nothing else: she writes her eight settings, the lists and the price list, and the server refuses the rest", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await restore(admin, data);
  const direct = await api("ivy");
  const headers = await csrf(direct);
  const row = await settingsRow(direct, data);
  const page = await (await as("ivy")).newPage();
  const problems = watch(page);
  try {
    await openSettings(page);
    await expect(page.locator('[data-screen="appsettings"]')).toHaveAttribute("data-writes", "selling");
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.locator(".crm-ast-intro")).toHaveText("The stages, lost reasons and limits the sales team works to. The CRM admin holds the rest.");
    // Another tab's address is still her one tab.
    await page.goto(`${STAFF}settings/working-time`);
    await expect(page.locator('[data-panel="selling"]')).toBeVisible();
    await expect(page.locator('[data-panel="work"]')).toHaveCount(0);
    await expect(card(page, "stages").locator('[data-figure="open"]')).toHaveText("14 open deals");
    // WORTH ASKING (S11): Proposal and Negotiation hold the sample's four questions, Discovery none. She writes Discovery's,
    // the server keeps them, and she takes them off again.
    const asking = (stage: string) => card(page, "stages").getByRole("button", { name: `Worth asking at ${stage}` });
    await expect(asking("Negotiation")).toHaveText("4");
    await expect(asking("Discovery")).toHaveText("0");
    await asking("Discovery").click();
    const dialog = page.getByRole("dialog", { name: "Worth asking at Discovery" });
    await dialog.getByRole("textbox", { name: "Question 1" }).fill("Who else is in the room?");
    await dialog.getByRole("textbox", { name: "Question 2" }).fill("What made them call now?");
    await dialog.getByRole("button", { name: "Save the questions" }).click();
    await expect(toast(page)).toHaveText("Worth asking at Discovery: saved.");
    await expect(asking("Discovery")).toHaveText("2");
    const discovery = (await rows<{ worth_asking: string | null }>(direct, data, "stages", { column: "label", op: "eq", value: "Discovery" }))[0]!;
    expect(discovery.worth_asking).toBe("Who else is in the room?\nWhat made them call now?");
    await asking("Discovery").click();
    await dialog.getByRole("textbox", { name: "Question 1" }).fill("");
    await dialog.getByRole("textbox", { name: "Question 2" }).fill("");
    await dialog.getByRole("button", { name: "Save the questions" }).click();
    await expect(asking("Discovery")).toHaveText("0");
    // The admin's setting on this tab is not hers: she reads no field for it.
    await expect(card(page, "enquiries")).toHaveCount(0);

    // A number, by the keyboard: saved when Enter is pressed, and the server holds it.
    await type(page, "quote_valid_days", "45");
    await expect(toast(page)).toHaveText("A quote is valid for: saved.");
    expect((await settingsRow(direct, data))["quote_valid_days"]).toBe(45);
    // Outside its bounds: not sent, and the field says what it takes (more days than the warning before it runs out, which
    // is 3: plan 68 X4 keeps the warning below the validity).
    await type(page, "quote_valid_days", "400");
    await expect(setting(page, "quote_valid_days").getByRole("alert")).toHaveText("From 4 to 365.");
    // Warm stays under stale.
    await type(page, "sitting_warm_days", "30");
    await expect(setting(page, "sitting_warm_days").getByRole("alert")).toHaveText("From 1 to 29.");
    const held = await settingsRow(direct, data);
    expect([held["quote_valid_days"], held["sitting_warm_days"]]).toEqual([45, 14]);
    // A threshold moves its count: warm from 10 days catches more than from 14.
    await type(page, "sitting_warm_days", "10");
    await expect(toast(page)).toHaveText("Warm from: saved.");
    expect((await settingsRow(direct, data))["sitting_warm_days"]).toBe(10);
    await expect(setting(page, "sitting_warm_days").locator("input")).toHaveValue("10");
    await type(page, "sitting_warm_days", "14");
    await expect(setting(page, "sitting_warm_days")).toContainText("3 open deals warm now");
    // The count follows the field at once; the save may still be on its way (the toast says the same words as the last one).
    await expect.poll(async () => (await settingsRow(direct, data))["sitting_warm_days"]).toBe(14);

    // Stages: she adds one, names it, gives it odds and moves it; she is offered no bin.
    const stages = card(page, "stages");
    await expect(stages.locator("[data-remove]")).toHaveCount(0);
    await stages.locator("[data-add]").click();
    await expect(toast(page)).toHaveText("Stage added. Give it a name.");
    await expect(stages.locator(".crm-ast-row")).toHaveCount(6);
    const fresh = stages.locator(".crm-ast-row").nth(5);
    await expect(fresh.locator(".crm-ast-input-name")).toBeFocused();
    await fresh.locator(".crm-ast-input-name").fill("Spec stage");
    await fresh.locator(".crm-ast-input-name").press("Enter");
    await expect(toast(page)).toHaveText("Renamed to Spec stage.");
    const named = stages.locator('.crm-ast-row[data-name="Spec stage"]');
    await named.locator(".crm-ast-input-odds").fill("95");
    await named.locator(".crm-ast-input-odds").press("Enter");
    await expect(toast(page)).toHaveText("Spec stage now weighs 95%.");
    await expect(named.locator('[data-figure="count"]')).toHaveText("0 open deals");
    await named.getByRole("button", { name: "Move Spec stage up" }).press("Enter");
    await expect(toast(page)).toHaveText("Spec stage is now number 5.");
    await expect(stages.locator(".crm-ast-row").nth(4)).toHaveAttribute("data-name", "Spec stage");
    // The keyboard stays on the row it moved.
    await expect(stages.locator('.crm-ast-row[data-name="Spec stage"]').getByRole("button", { name: "Move Spec stage up" })).toBeFocused();
    const order = await rows<{ label: string; odds: number }>(direct, data, "stages", undefined, "&order=position");
    expect(order.map((stage) => stage.label)[4]).toBe("Spec stage");
    expect(Number(order[4]!.odds)).toBe(0.95);
    // The weighted total did not move: no deal is in the new stage.
    await expect(stages.locator('[data-figure="weighted"]')).toHaveText("£156,562.50");

    // The price list: she adds a line, reprices and retires it; removing is not hers.
    const prices = card(page, "prices");
    await expect(prices.locator("[data-remove]")).toHaveCount(0);
    await prices.getByLabel("Name", { exact: true }).fill("Spec chair");
    await prices.getByLabel("List price", { exact: true }).fill("120");
    await prices.getByRole("button", { name: "Add to the list" }).click();
    await expect(toast(page)).toHaveText("Spec chair added.");
    await expect(prices.locator('[data-figure="lines"]')).toHaveText("18 lines");
    const line = prices.locator('.crm-ast-row[data-name="Spec chair"]');
    await expect(line.locator('[data-figure="price"]')).toHaveText("£120");
    await line.getByLabel("List price of Spec chair").fill("132.50");
    await line.getByLabel("List price of Spec chair").press("Enter");
    await expect(toast(page)).toHaveText("Spec chair is now £132.50.");
    await line.getByRole("switch", { name: "Offer Spec chair on new quotes" }).click();
    await expect(toast(page)).toHaveText("Spec chair is retired. Quotes that have it keep it.");
    const chair = (await rows<{ id: number; list_rate: number; active: boolean | number }>(direct, data, "price_list", { column: "name", op: "eq", value: "Spec chair" }))[0]!;
    expect([Number(chair.list_rate), chair.active === true || chair.active === 1]).toEqual([132.5, false]);
    // The reps: she reads who has a profile and adds none.
    await expect(card(page, "reps").locator(".crm-ast-row")).toHaveCount(4);
    await expect(card(page, "reps").locator("select, [data-remove]")).toHaveCount(0);

    // What is not hers, tried by a direct call: the server refuses each, and the row stays.
    for (const values of [{ week_starts: "sun" }, { work_sat: true }, { work_from: "07:00" }, { depot_town: "York" }, { depot_place: { lat: 53.9, lng: -1.08 } }, { distance_unit: "miles" }, { lead_cold_days: 3 }, { quote_valid_days: 20, work_sun: true }]) {
      const res = await direct.patch(data("settings", `/${String(row.id)}`), { data: { values }, headers });
      expect(res.status(), JSON.stringify(values)).toBe(403);
    }
    // Her own, outside its bounds: refused too.
    expect((await direct.patch(data("settings", `/${String(row.id)}`), { data: { values: { approval_threshold_pct: 80 } }, headers })).status()).toBe(422);
    const after = await settingsRow(direct, data);
    expect([after["week_starts"], after["depot_town"], after["distance_unit"], after["quote_valid_days"], Number(after["approval_threshold_pct"])]).toEqual(["mon", "Leeds", "km", 45, 5]);
    const spec = (await rows<{ id: number }>(direct, data, "stages", { column: "label", op: "eq", value: "Spec stage" }))[0]!;
    expect((await direct.delete(data("stages", `/${String(spec.id)}?confirm=true`), { headers })).status()).toBe(403);
    expect((await direct.delete(data("price_list", `/${String(chair.id)}?confirm=true`), { headers })).status()).toBe(403);
    expect((await direct.post(data("reps"), { data: { values: { user_id: "not-a-person" }, clientKey: "p15managermakesnorepAAAAAAAAAAAA" }, headers })).status()).toBe(403);
    expect((await direct.put("/api/v1/apps/crm/parts/inbox", { data: { on: false }, headers })).status()).toBe(403);
    expect(own(problems)).toEqual([]);
  } finally {
    await restore(admin, data);
  }
});

test("a save whose reply is lost is read back, not sent twice and not called unsaved", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await restore(admin, data);
  const page = await (await as("ivy")).newPage();
  try {
    await openSettings(page);
    await expect(setting(page, "nudge_stuck_days").locator("input")).toHaveValue("21");
    // A setting: the change reaches the server; its answer never arrives.
    let patches = 0;
    await page.route("**/api/v1/data/**", async (route) => {
      const request = route.request();
      if (request.method() !== "PATCH" || !/crm_settings\/\d+$/.test(new URL(request.url()).pathname)) return route.fallback();
      patches += 1;
      await route.fetch();
      return route.abort("connectionreset");
    });
    await type(page, "nudge_stuck_days", "25");
    await expect(toast(page)).toHaveText("Sitting in one stage: saved.");
    await page.unroute("**/api/v1/data/**");
    // Sent once: the row was read back and found changed.
    expect(patches).toBe(1);
    expect((await settingsRow(admin, data))["nudge_stuck_days"]).toBe(25);
    await expect(setting(page, "nudge_stuck_days").locator("input")).toHaveValue("25");

    // A new price-list line: sent again with the same key, and the server answers the line the first one made.
    const sent: { key: string; replayed: boolean | null }[] = [];
    await page.route("**/api/v1/data/**", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !/crm_price_list$/.test(new URL(request.url()).pathname)) return route.fallback();
      const key = (request.postDataJSON() as { clientKey: string }).clientKey;
      const response = await route.fetch();
      if (sent.length === 0) {
        sent.push({ key, replayed: null });
        return route.abort("connectionreset");
      }
      sent.push({ key, replayed: ((await response.json()) as { replayed?: boolean }).replayed === true });
      await route.fulfill({ response });
    });
    const prices = card(page, "prices");
    await prices.getByLabel("Name", { exact: true }).fill("Spec lost reply");
    await prices.getByLabel("List price", { exact: true }).fill("75");
    await prices.getByRole("button", { name: "Add to the list" }).click();
    await expect(toast(page)).toHaveText("Spec lost reply added.");
    await page.unroute("**/api/v1/data/**");
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
    expect((await rows(admin, data, "price_list", { column: "name", op: "eq", value: "Spec lost reply" })).length).toBe(1);
    await expect(prices.locator('.crm-ast-row[data-name="Spec lost reply"]')).toHaveCount(1);
  } finally {
    await restore(admin, data);
  }
});

test("two people: the admin changes a setting, and the manager's open Settings and her open Cover follow", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await restore(admin, data);
  const ivys = await as("ivy");
  const settings = await ivys.newPage();
  const cover = await ivys.newPage();
  const tessa = await (await as("tessa")).newPage();
  try {
    await settings.goto(`${STAFF}settings`);
    await expect(setting(settings, "sitting_stale_days").locator("input")).toHaveValue("30");
    await expect(setting(settings, "sitting_stale_days")).toContainText("2 open deals stale now");
    await cover.goto(`${STAFF}cover`);
    // Decision 105, now a setting: the sample's cover is 10 working days on a Monday-to-Friday week.
    const days = cover.getByTestId("cover-entry").locator(".crm-cv-entry-days");
    await expect(days).toHaveText("10 working days · Dana is back Sat, Aug 22");

    await tessa.goto(`${STAFF}settings`);
    await type(tessa, "sitting_stale_days", "33");
    await expect(toast(tessa)).toHaveText("Stale from: saved.");
    // Ivy's page follows without a reload: the number, and the count the server works out from it (d5 has sat 32 days).
    await expect(setting(settings, "sitting_stale_days").locator("input")).toHaveValue("33");
    await expect(setting(settings, "sitting_stale_days")).toContainText("1 open deal stale now");

    // Saturday becomes a working day: the cover that spans one Saturday is 11 working days, on Ivy's open page.
    await tab(tessa, "Working time").click();
    await tessa.getByRole("group", { name: "Working days" }).getByRole("button", { name: "Saturday" }).click();
    await expect(toast(tessa)).toHaveText("Saturday is a working day.");
    await expect(tessa.locator('[data-figure="week"]')).toHaveText("6 days · 08:30 to 17:30 · 54 h a week");
    await expect(days).toHaveText("11 working days · Dana is back Sat, Aug 22");
    await tessa.getByRole("group", { name: "Working days" }).getByRole("button", { name: "Saturday" }).click();
    await expect(toast(tessa)).toHaveText("Saturday is no longer a working day.");
    await expect(days).toHaveText("10 working days · Dana is back Sat, Aug 22");
  } finally {
    await restore(admin, data);
  }
});

test("the CRM admin writes Working time and Places, makes and removes a rep's profile, and removes a stage nothing names", async ({ as, api, data }) => {
  const direct = await api("tessa");
  const headers = await csrf(direct);
  await restore(direct, data);
  const page = await (await as("tessa")).newPage();
  const problems = watch(page);
  try {
    await page.goto(`${STAFF}settings/working-time`);
    await expect(tab(page, "Working time")).toHaveAttribute("aria-selected", "true");
    // The hours of the day, and a day that ends before it starts is not sent.
    await page.getByLabel("The day ends").fill("07:00");
    await page.getByLabel("The day ends").blur();
    await expect(page.locator('[data-panel="work"]').getByRole("alert")).toHaveText("The day has to end after it starts.");
    expect((await settingsRow(direct, data))["work_to"]).toBe("17:30");
    await page.getByLabel("The day ends").fill("17:00");
    await page.getByLabel("The day ends").blur();
    await expect(toast(page)).toHaveText("The working day is 08:30 to 17:00.");
    await expect(page.locator('[data-figure="week"]')).toHaveText("5 days · 08:30 to 17:00 · 42.5 h a week");
    // The week's first day: the chips of the days follow it.
    await page.getByRole("group", { name: "The week starts on" }).getByRole("button", { name: "Sunday" }).click();
    await expect(toast(page)).toHaveText("The week starts on Sunday.");
    await expect(page.getByRole("group", { name: "Working days" }).getByRole("button").first()).toHaveText("Sun");
    const kept = await settingsRow(direct, data);
    expect([kept["work_from"], kept["work_to"], kept["week_starts"]]).toEqual(["08:30", "17:00", "sun"]);
    // The tabs by the keyboard: an arrow goes to the next, and the focus goes with it.
    await tab(page, "Working time").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Places")).toBeFocused();
    await expect(page).toHaveURL(/\/settings\/places$/);

    // Places: a part of the address, a country held to two letters, the unit of distance.
    await setting(page, "depot_region").locator("input").fill("West Yorkshire");
    await setting(page, "depot_region").locator("input").press("Enter");
    await expect(toast(page)).toHaveText("Region: saved.");
    await setting(page, "depot_postal_code").locator("input").fill("LS10 1JF");
    await setting(page, "depot_postal_code").locator("input").press("Enter");
    await expect(toast(page)).toHaveText("Postal code: saved.");
    await setting(page, "depot_country").locator("input").fill("G");
    await setting(page, "depot_country").locator("input").press("Enter");
    await expect(setting(page, "depot_country").locator("input")).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("group", { name: "Unit of distance" }).getByRole("button", { name: "Miles" }).click();
    await expect(toast(page)).toHaveText("Distances are shown in Miles.");
    const placed = await settingsRow(direct, data);
    expect([placed["depot_region"], placed["depot_postal_code"], placed["depot_country"], placed["distance_unit"]]).toEqual(["West Yorkshire", "LS10 1JF", "GB", "miles"]);
    // The pin put on the street (here by a direct write, as a drag ends): the page follows and says so.
    expect((await direct.patch(data("settings", `/${String(placed.id)}`), { data: { values: { depot_place: { lat: 53.7912, lng: -1.5503 } } }, headers })).status()).toBe(200);
    await expect(page.locator('[data-figure="pin"]')).toHaveText("Placed on the street.");

    // The reps: a profile for somebody who has none, then taken away again.
    await tab(page, "Selling").click();
    const reps = card(page, "reps");
    await expect(reps.locator(".crm-ast-row")).toHaveCount(4);
    await reps.getByLabel("Choose a person").selectOption({ label: "Ivy Sandoval" });
    await reps.getByRole("button", { name: "Add a profile" }).click();
    await expect(toast(page)).toHaveText("Ivy Sandoval has a rep’s profile.");
    await expect(reps.locator(".crm-ast-row")).toHaveCount(5);
    // One a person: she is no longer offered.
    await expect(reps.getByLabel("Choose a person").locator("option", { hasText: "Ivy Sandoval" })).toHaveCount(0);
    const all = await rows<{ id: number; user_id: string }>(direct, data, "reps", undefined, "&order=id");
    expect(all.length).toBe(5);
    expect((await direct.post(data("reps"), { data: { values: { user_id: all[4]!.user_id }, clientKey: "p15secondprofileofonepersonAAAAA" }, headers })).status()).toBeGreaterThanOrEqual(400);
    await reps.getByRole("button", { name: "Remove the profile of Ivy Sandoval" }).click();
    await expect(toast(page)).toHaveText("The profile of Ivy Sandoval is removed.");
    await expect(reps.locator(".crm-ast-row")).toHaveCount(4);
    expect((await rows(direct, data, "reps")).length).toBe(4);

    // A stage: one nothing names is removed; one that deals name is kept by the server whoever asks.
    const stages = card(page, "stages");
    await stages.locator("[data-add]").click();
    await expect(stages.locator(".crm-ast-row")).toHaveCount(6);
    const fresh = stages.locator(".crm-ast-row").nth(5);
    await fresh.locator(".crm-ast-input-name").fill("Spec removed");
    await fresh.locator(".crm-ast-input-name").press("Enter");
    await expect(toast(page)).toHaveText("Renamed to Spec removed.");
    await stages.getByRole("button", { name: "Remove Spec removed" }).click();
    await expect(toast(page)).toHaveText("Spec removed removed.");
    await expect(stages.locator(".crm-ast-row")).toHaveCount(5);
    const first = (await rows<{ id: number }>(direct, data, "stages", undefined, "&order=position"))[0]!;
    const refused = await direct.delete(data("stages", `/${String(first.id)}?confirm=true`), { headers });
    expect(refused.status(), await refused.text()).toBeGreaterThanOrEqual(400);
    expect(refused.status()).toBeLessThan(500);
    expect((await rows(direct, data, "stages")).length).toBe(5);
    expect(own(problems)).toEqual([]);
  } finally {
    await restore(direct, data);
  }
});

test("Read-only reads every tab with nothing to press, and the server refuses her writes", async ({ as, api, data, stand }) => {
  await restore(await api("tessa"), data);
  const page = await (await as("grace")).newPage();
  await openSettings(page);
  await expect(page.locator('[data-screen="appsettings"]')).toHaveAttribute("data-writes", "none");
  await expect(page.locator(".crm-ast-intro")).toContainText("You can read every setting and change none.");
  await expect(page.getByRole("tab")).toHaveText(tabsOf(stand));
  // Selling: the figures are hers to read; no field, no button, no switch.
  const selling = page.locator('[data-panel="selling"]');
  await expect(card(page, "stages").locator('[data-figure="open"]')).toHaveText("14 open deals");
  await expect(card(page, "stages").locator(".crm-ast-row")).toHaveCount(5);
  await expect(setting(page, "quote_valid_days").locator("output")).toHaveText("30");
  await expect(card(page, "prices").locator(".crm-ast-row")).toHaveCount(17);
  await expect(card(page, "reps").locator(".crm-ast-row")).toHaveCount(4);
  await expect(selling.locator("input, textarea, select, button")).toHaveCount(0);
  await tab(page, "Working time").click();
  await expect(page.locator('[data-figure="week"]')).toHaveText("5 days · 08:30 to 17:30 · 45 h a week");
  await expect(page.locator('[data-figure="hours"]')).toHaveText("08:30 to 17:30");
  await expect(page.locator('[data-panel="work"]').locator("input, textarea, select")).toHaveCount(0);
  await expect(page.locator('[data-panel="work"]').getByRole("button", { disabled: false })).toHaveCount(0);
  await tab(page, "Places").click();
  await expect(setting(page, "depot_town").locator("output")).toHaveText("Leeds");
  await expect(page.locator('[data-figure="pin"]')).toHaveText("Placed by town.");
  await expect(page.locator(".crm-ast-address").locator("input, textarea, select")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Unit of distance" }).getByRole("button", { disabled: false })).toHaveCount(0);
  await tab(page, "Maps").click();
  await expect(page.locator('[data-panel="maps"]')).toContainText("Ask the person who runs this install.");
  await tab(page, "Parts").click();
  await expect(page.locator(".crm-ast-part")).toHaveCount(partsOf(stand).length);

  // By a direct call, each write she might try.
  const direct = await api("grace");
  const headers = await csrf(direct);
  const row = await settingsRow(direct, data);
  for (const values of [{ quote_valid_days: 31 }, { work_sat: true }, { depot_town: "York" }]) expect((await direct.patch(data("settings", `/${String(row.id)}`), { data: { values }, headers })).status(), JSON.stringify(values)).toBe(403);
  const stage = (await rows<{ id: number }>(direct, data, "stages"))[0]!;
  const price = (await rows<{ id: number }>(direct, data, "price_list"))[0]!;
  const rep = (await rows<{ id: number }>(direct, data, "reps"))[0]!;
  const company = (await rows<{ id: number }>(direct, data, "companies"))[0]!;
  expect((await direct.patch(data("stages", `/${String(stage.id)}`), { data: { values: { label: "Renamed by Read-only" } }, headers })).status()).toBe(403);
  expect((await direct.post(data("stages"), { data: { values: { label: "Spec by Read-only", odds: 0.5, position: 9 }, clientKey: "p15readonlymakesnostageAAAAAAAAA" }, headers })).status()).toBe(403);
  expect((await direct.patch(data("price_list", `/${String(price.id)}`), { data: { values: { list_rate: 1 } }, headers })).status()).toBe(403);
  expect((await direct.patch(data("reps", `/${String(rep.id)}`), { data: { values: { hours_from: "10:00" } }, headers })).status()).toBe(403);
  expect((await direct.patch(data("companies", `/${String(company.id)}`), { data: { values: { customer_no: "RO-1" } }, headers })).status()).toBe(403);
});

test("a rep, the account manager, the marketer and the front desk have no Settings: the page says so, and the server refuses their writes", async ({ as, api, data }) => {
  for (const person of ["dana", "hugo", "lena", "corin"]) {
    const page = await (await as(person)).newPage();
    for (const address of ["settings", "settings/working-time", "settings/parts"]) {
      await page.goto(`${STAFF}${address}`);
      await expect(page.getByRole("heading", { level: 1 }), `${person} ${address}`).toHaveText("This page is not part of your role");
    }
    await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
    await expect(page.locator('[data-screen="appsettings"]')).toHaveCount(0);
    const direct = await api(person);
    const headers = await csrf(direct);
    // They read the one row (a screen of theirs needs the days and the unit), and change nothing of it.
    const row = await settingsRow(direct, data);
    for (const values of [{ quote_valid_days: 31 }, { work_sat: true }, { distance_unit: "miles" }]) expect((await direct.patch(data("settings", `/${String(row.id)}`), { data: { values }, headers })).status(), `${person} ${JSON.stringify(values)}`).toBe(403);
    expect((await direct.post(data("stages"), { data: { values: { label: `Spec by ${person}`, odds: 0.5, position: 9 }, clientKey: `p15${person}makesnostageAAAAAAAAAAAAAAAA`.slice(0, 32) }, headers })).status(), person).toBe(403);
    expect((await direct.post(data("price_list"), { data: { values: { name: `Spec by ${person}`, list_rate: 1 }, clientKey: `p15${person}makesnopriceAAAAAAAAAAAAAAAA`.slice(0, 32) }, headers })).status(), person).toBe(403);
    expect((await direct.post(data("reps"), { data: { values: { user_id: "nobody" }, clientKey: `p15${person}makesnorepAAAAAAAAAAAAAAAAAA`.slice(0, 32) }, headers })).status(), person).toBe(403);
  }
  // A rep changes her own profile and nobody else's (F20): the server's rule, by a direct call.
  const dana = await api("dana");
  const headers = await csrf(dana);
  const me = ((await (await dana.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const reps = await rows<{ id: number; user_id: string; hours_from: string | null }>(dana, data, "reps");
  const mine = reps.find((rep) => rep.user_id === me)!;
  const other = reps.find((rep) => rep.user_id !== me)!;
  expect((await dana.patch(data("reps", `/${String(mine.id)}`), { data: { values: { hours_from: mine.hours_from } }, headers })).status()).toBe(200);
  expect([403, 404]).toContain((await dana.patch(data("reps", `/${String(other.id)}`), { data: { values: { hours_from: "11:00" } }, headers })).status());
  expect((await dana.delete(data("reps", `/${String(mine.id)}?confirm=true`), { headers })).status()).toBe(403);
});

test("the install's owner is told where each switch is, and what the quote's e-mail link has", async ({ as, api, stand }) => {
  const direct = await api("owner");
  const page = await (await as("owner")).newPage();
  await openSettings(page);
  await expect(page.getByRole("tab")).toHaveText(tabsOf(stand));
  // "Address in email links", as Adminium answers the person who runs it: the page says that and no more.
  const email = (await (await direct.get("/api/v1/settings/email")).json()) as { data?: { publicOrigin?: string | null }; publicOrigin?: string | null };
  const origin = email.data?.publicOrigin ?? email.publicOrigin ?? null;
  await expect(card(page, "quotes").locator(".crm-ast-ask")).toContainText(origin === null || origin === "" ? "No address for e-mail links is set in Adminium." : "uses the address set for this install");
  await tab(page, "Maps").click();
  await expect(page.locator('[data-panel="maps"]')).toContainText("You switch them under Settings, Maps.");
  await expect(page.locator('[data-panel="maps"]').getByRole("link", { name: "Open Maps in Adminium" })).toHaveAttribute("href", "/settings/maps");
  await expect(page.locator('[data-panel="maps"]').getByRole("switch")).toHaveCount(0);
  await tab(page, "Parts").click();
  await expect(page.locator('[data-panel="parts"]')).toContainText("You switch a part on or off in Adminium, under Installed apps, on this app’s page.");
});

test("Settings at 390 wide in the dark, and in Arabic from the right", async ({ as, api, data, stand }) => {
  await restore(await api("tessa"), data);
  const narrow = await (await as("tessa", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  for (const [address, panel] of [["settings", "selling"], ["settings/working-time", "work"], ["settings/places", "places"], ["settings/maps", "maps"], ["settings/parts", "parts"]] as const) {
    await narrow.goto(`${STAFF}${address}`);
    await expect(narrow.locator(`[data-panel="${panel}"]`)).toBeVisible();
    if (panel === "selling") await expect(card(narrow, "prices").locator(".crm-ast-row")).toHaveCount(17);
    expect(await noSidewaysScroll(narrow), `${address} does not scroll sideways`).toBe(true);
  }
  await picture(narrow, "p15-9-tessa-parts-390-dark");
  await narrow.goto(`${STAFF}settings`);
  await expect(card(narrow, "stages").locator('[data-figure="open"]')).toHaveText("14 open deals");
  await picture(narrow, "p15-9-tessa-selling-390-dark");
  await inArabic(await api("tessa"), async () => {
    const page = await (await as("tessa")).newPage();
    await page.goto(`${STAFF}settings`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الإعدادات");
    await expect(page.getByRole("tab")).toHaveText(tabsOf(stand, true));
    await expect(card(page, "stages").getByRole("heading", { level: 2 })).toHaveText("المراحل");
    // The figure is the same figure, read from the right.
    await expect(card(page, "stages").locator('[data-figure="open"]')).toContainText("صفقة مفتوحة");
    await page.getByRole("tab", { name: "وقت العمل" }).click();
    await expect(page.locator('[data-panel="work"]')).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
    await picture(page, "p15-9-tessa-working-time-arabic");
  });
});

/**
 * Plan 68 X4: a pair the server keeps apart is refused naming both settings. The screen bounds each field by the other
 * as it last read them, so the save is made to cross its partner on its way (the request's value changed in flight):
 * what comes back is the server's own refusal, said on the page in the reader's words.
 */
test("a setting saved past its partner is refused by the server, and the page names both settings", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await restore(admin, data);
  const page = await (await as("tessa")).newPage();
  try {
    await page.route("**/api/v1/data/**", async (route) => {
      const request = route.request();
      if (request.method() !== "PATCH" || !/crm_settings/.test(decodeURIComponent(request.url()))) return route.fallback();
      const body = request.postDataJSON() as { values: Record<string, unknown> };
      if (body.values["sitting_warm_days"] !== 20) return route.fallback();
      return route.fallback({ postData: JSON.stringify({ ...body, values: { ...body.values, sitting_warm_days: 30 } }) });
    });
    await page.goto(`${STAFF}settings`);
    await expect(setting(page, "sitting_warm_days").locator("input")).toHaveValue("14");
    await type(page, "sitting_warm_days", "20");
    await expect(toast(page)).toHaveText("Not saved. “Warm from” must be fewer days than “Stale from”. Change one of the two.");
    expect(Number((await settingsRow(admin, data))["sitting_warm_days"])).toBe(14);
  } finally {
    await restore(admin, data);
  }
});

/** Plan 68 X4: Settings shows every lost reason, fifty at a time. The 46 it adds are "Spec reason …", removed at the end. */
test("Settings shows every lost reason, fifty and then the rest", async ({ as, api, data }) => {
  const admin = await api("tessa");
  const headers = await csrf(admin);
  const clean = async () => {
    for (const made of await rows<{ id: number }>(admin, data, "lost_reasons", { column: "label", op: "like", value: "Spec reason%" })) {
      expect((await admin.delete(data("lost_reasons", `/${String(made.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
  };
  await clean();
  try {
    const kept = (await rows<{ id: number }>(admin, data, "lost_reasons")).length;
    const adding = 51 - kept;
    for (let n = 0; n < adding; n += 1) {
      const res = await admin.post(data("lost_reasons"), { headers, data: { values: { label: `Spec reason ${String(n + 1).padStart(2, "0")}`, position: 100 + n } } });
      expect(res.status(), await res.text()).toBe(201);
    }
    const page = await (await as("tessa")).newPage();
    await page.goto(`${STAFF}settings`);
    const reasons = card(page, "reasons");
    await expect(reasons.locator(".crm-ast-row")).toHaveCount(50);
    await expect(reasons.locator('[data-more="lost_reasons"]')).toContainText("Show 1 more");
    await expect(reasons.locator('[data-more="lost_reasons"]')).toContainText("50 of 51");
    await reasons.locator('[data-more="lost_reasons"] button').click();
    await expect(reasons.locator(".crm-ast-row")).toHaveCount(51);
    await expect(reasons.locator(".crm-ast-row").last().locator(".crm-ast-input-name")).toHaveValue(`Spec reason ${String(adding).padStart(2, "0")}`);
    await expect(reasons.locator('[data-more="lost_reasons"]')).toHaveCount(0);
  } finally {
    await clean();
  }
});
