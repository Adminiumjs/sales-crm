/**
 * TERRITORY on the stand, with the sample: the map (Adminium's own map part)
 * beside the list this app draws, its three states, a company placed and a
 * pin moved, and "Edit areas" with the offer to move the companies a reshaped
 * area now takes in.
 *
 * The map server is stood in for (`territory-helpers.ts`): no spec reaches the
 * network. The sample ships five of nine companies with a place and NO area:
 * a spec that needs an area draws one, and every spec that changes a place, an
 * area or a company's territory puts the sample back in its `finally`.
 *
 * Who it is proved as: the sales manager and the CRM admin (everything), a
 * rep (reads, places and moves pins; may not change an area), Read-only (no
 * write control, and the server refuses each write), the front desk (refused
 * by the server) and the account manager (not part of his role).
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, unfoldMenu, watch } from "./helpers.ts";
import { bubble, canvas, companies, mapServer, openDealsAt, openTerritory, pinOf, pins, placeOf, restore, snapshot, territories, territoryRow, unplacedRow } from "./territory-helpers.ts";

const money = (value: number): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
/** What may be in the console while the map server is being refused on purpose. */
const expected = (line: string): boolean => /ERR_CONNECTION_REFUSED|ERR_FAILED|Failed to load resource|net::ERR/.test(line);
const toast = (page: Page) => page.locator(".crm-toast");

test("the map and its list, as the sales manager: every figure is what the server answers her", async ({ as, api, data, stand }) => {
  const ivy = await api("ivy");
  const page = await (await as("ivy")).newPage();
  const problems = watch(page);
  await mapServer(page);
  await page.goto(`${STAFF}team`);
  await unfoldMenu(page);
  // Reached from her menu, under Accounts.
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Territory", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Territory");
  await expect(bubble(page)).toHaveAttribute("data-map-status", "ready", { timeout: 45_000 });

  // Five of the sample's nine companies have a place; the map leaves its own list out, because this page's is there.
  await expect(pins(page)).toHaveCount(5);
  await expect(page.locator('[data-kit-part="map"] [data-part="geo-ranking"]')).toHaveCount(0);
  await expect(page.locator("#crm-terr-list > li")).toHaveCount(4);

  const allTerritories = await territories(ivy, data);
  const allCompanies = await companies(ivy, data);
  // The ledger's section 24, and the same figures asked of the server as Ivy.
  const ledger: Record<string, { value: number; open: number; others: number; companies: number }> = {
    North: { value: 128_850, open: 5, others: 2, companies: 3 },
    Scotland: { value: 71_450, open: 4, others: 3, companies: 2 },
    "Midlands and east": { value: 52_100, open: 3, others: 2, companies: 2 },
    "South and west": { value: 33_900, open: 2, others: 1, companies: 2 },
  };
  for (const territory of allTerritories) {
    const ids = allCompanies.filter((company) => company.territory_id === territory.id).map((company) => company.id);
    const mine = await openDealsAt(ivy, stand, ids);
    const others = await openDealsAt(ivy, stand, ids, [{ column: "owner_id", op: "neq", value: territory.owner_id }]);
    const want = ledger[territory.name]!;
    expect({ value: mine.value, open: mine.count, others: others.count, companies: ids.length }, territory.name).toEqual(want);
    const row = territoryRow(page, territory.name);
    await expect(row.getByTestId("terr-value")).toHaveText(money(mine.value));
    await expect(row.getByTestId("terr-open")).toHaveText(`${String(mine.count)} open deals`);
    await expect(row.getByTestId("terr-other")).toHaveText(`${String(others.count)} of ${String(mine.count)} owned by someone else`);
    await expect(row.locator(".crm-terr-owner")).toContainText(`${String(ids.length)} companies`);
  }
  await expect(territoryRow(page, "North").locator(".crm-terr-owner")).toContainText("Dana Whitlock");
  await expect(territoryRow(page, "North").locator(".crm-terr-companies > li")).toHaveText([/Cobalt Legal/, /Juno Analytics/, /Nordwind Logistics/]);

  // Under the map: the companies with a place, and the open deals at them.
  const placed = allCompanies.filter((company) => placeOf(company.place) !== null);
  expect(placed.map((company) => company.name)).toEqual(["Cobalt Legal", "Fernway Clinics", "Juno Analytics", "Nordwind Logistics", "Veldt Studios"]);
  const atPlaced = await openDealsAt(ivy, stand, placed.map((company) => company.id));
  await expect(page.getByTestId("terr-placed")).toHaveText("5");
  await expect(page.getByTestId("terr-placed-open")).toHaveText(money(atPlaced.value));
  expect(atPlaced.value).toBe(171_950);

  // The four with no place are listed, never dropped.
  await expect(page.locator(".crm-terr-unplaced > li")).toHaveCount(4);
  await picture(page, "p09-territory-manager");
  for (const name of ["Brightloom Foods", "Harbor & Finch", "Low Orbit", "Tandem Robotics"]) await expect(unplacedRow(page, name)).toBeVisible();

  // A pin is in its territory's colour, and says whose territory that is.
  const north = allTerritories.findIndex((territory) => territory.name === "North");
  await expect(pinOf(page, "Cobalt Legal")).toHaveAttribute("data-colour", String(north));
  await expect(pinOf(page, "Cobalt Legal")).toHaveAttribute("aria-label", /North · Dana Whitlock/);
  await expect(pinOf(page, "Juno Analytics")).toHaveAttribute("data-by", "town");
  await expect(territoryRow(page, "North").locator(".crm-terr-swatch")).toHaveAttribute("data-colour", String(north));

  // Picking: a company's row picks its pin, and a pin picked on the map marks its row. By keyboard too.
  const cobalt = territoryRow(page, "North").getByRole("button", { name: /Cobalt Legal/ });
  await cobalt.click();
  await expect(cobalt).toHaveAttribute("aria-pressed", "true");
  await expect(pinOf(page, "Cobalt Legal")).toHaveAttribute("aria-current", "true");
  await pinOf(page, "Veldt Studios").click();
  await expect(territoryRow(page, "Scotland").getByRole("button", { name: /Veldt Studios/ })).toHaveAttribute("aria-pressed", "true");
  await expect(cobalt).toHaveAttribute("aria-pressed", "false");
  const northPick = territoryRow(page, "North").locator(".crm-terr-pick");
  await northPick.focus();
  await page.keyboard.press("Enter");
  await expect(northPick).toHaveAttribute("aria-pressed", "true");

  expect(problems.filter((line) => !expected(line))).toEqual([]);
});

test("a rep reads her own deals' value, places and moves pins, and may not change an area", async ({ as, api, data, stand }) => {
  const dana = await api("dana");
  const page = await (await as("dana")).newPage();
  await mapServer(page);
  await openTerritory(page);

  const allTerritories = await territories(dana, data);
  const allCompanies = await companies(dana, data);
  const north = allTerritories.find((territory) => territory.name === "North")!;
  const ids = allCompanies.filter((company) => company.territory_id === north.id).map((company) => company.id);
  // Her own three deals in the North, out of the five every reader of Accounts may count.
  const mine = await openDealsAt(dana, stand, ids);
  expect(mine).toEqual({ count: 3, value: 91_200 });
  const row = territoryRow(page, "North");
  await expect(row.getByTestId("terr-value")).toHaveText(money(91_200));
  await expect(row.getByTestId("terr-open")).toHaveText("5 open deals");
  await expect(row.getByTestId("terr-other")).toHaveText("You can open 3 of 5. The value is theirs.");

  // She may place and move a company's pin; she is offered no way to change an area.
  await expect(page.getByTestId("terr-edit")).toHaveCount(0);
  await expect(unplacedRow(page, "Low Orbit").getByRole("button", { name: "Place it" })).toBeVisible();
  await expect(pinOf(page, "Cobalt Legal")).toHaveAttribute("aria-label", /Drag to the exact spot/);

  // The server's own refusal: a rep changes no territory, by its area, its owner or its name; she makes none and removes none.
  const headers = await csrf(dana);
  const square = { type: "Polygon", coordinates: [[[-2, 53], [0, 53], [0, 54], [-2, 54], [-2, 53]]] };
  for (const values of [{ area: square }, { owner_id: north.owner_id }, { name: "Hers" }]) expect((await dana.patch(data("territories", `/${String(north.id)}`), { data: { values }, headers })).status()).toBe(403);
  expect((await dana.post(data("territories"), { data: { values: { name: "Spec: not hers to make" } }, headers })).status()).toBe(403);
  expect((await dana.delete(data("territories", `/${String(north.id)}?confirm=true`), { headers })).status()).toBe(403);
  expect((await territories(dana, data)).find((territory) => territory.id === north.id)).toMatchObject({ name: "North", area: null });
});

test("Read-only sees the map and the list with nothing to press, and the server refuses each write", async ({ as, api, data }) => {
  const grace = await api("grace");
  const page = await (await as("grace")).newPage();
  await mapServer(page);
  await openTerritory(page);
  await expect(pins(page)).toHaveCount(5);
  await expect(page.locator("#crm-terr-list > li")).toHaveCount(4);
  await expect(page.getByTestId("terr-edit")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Place it" })).toHaveCount(0);
  // A pin she can pick and cannot move.
  await expect(pinOf(page, "Cobalt Legal")).not.toHaveAttribute("aria-label", /Drag to the exact spot/);

  const headers = await csrf(grace);
  const [territory] = await territories(grace, data);
  const all = await companies(grace, data);
  const cobalt = all.find((company) => company.name === "Cobalt Legal")!;
  const other = (await territories(grace, data)).find((one) => one.id !== cobalt.territory_id)!;
  expect((await grace.patch(data("companies", `/${String(cobalt.id)}`), { data: { values: { place: { lat: 53.9, lng: -1.4 } } }, headers })).status()).toBe(403);
  expect((await grace.patch(data("companies", `/${String(cobalt.id)}`), { data: { values: { territory_id: other.id } }, headers })).status()).toBe(403);
  expect((await grace.patch(data("territories", `/${String(territory!.id)}`), { data: { values: { area: { type: "Polygon", coordinates: [[[-2, 53], [0, 53], [0, 54], [-2, 53]]] } } }, headers })).status()).toBe(403);
  const after = (await companies(grace, data)).find((company) => company.id === cobalt.id)!;
  expect(after.territory_id).toBe(cobalt.territory_id);
  expect(placeOf(after.place)).toEqual(placeOf(cobalt.place));
});

test("the front desk is refused by the server, and the page is not part of the account manager's role", async ({ as, api, data }) => {
  const corin = await api("corin");
  expect((await corin.get(data("territories", "?limit=5"))).status()).toBe(403);
  const desk = await (await as("corin")).newPage();
  await desk.goto(`${STAFF}territory`);
  await expect(desk.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");

  const hugo = await (await as("hugo")).newPage();
  await hugo.goto(`${STAFF}territory`);
  await expect(hugo.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  await unfoldMenu(hugo);
  await expect(hugo.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Territory", exact: true })).toHaveCount(0);
});

test("the map server out of reach: the list is whole, nothing that needs a map is offered, and “Try again” brings it back", async ({ as }) => {
  const page = await (await as("ivy")).newPage();
  const problems = watch(page);
  const server = await mapServer(page, "down");
  await openTerritory(page, "unavailable");
  await expect(page.locator('[data-screen="territory"]')).toHaveAttribute("data-map", "unreachable");
  await expect(page.locator('[data-kit-part="map"] [data-part="map-unavailable"]')).toHaveText("The map could not be reached. Here is the list.");
  expect(server.asked.length).toBeGreaterThan(0);

  // The list is this page's own, drawn from its rows: all of it is there.
  await expect(page.locator("#crm-terr-list > li")).toHaveCount(4);
  await expect(territoryRow(page, "North").getByTestId("terr-value")).toHaveText(money(128_850));
  await expect(page.locator(".crm-terr-unplaced > li")).toHaveCount(4);
  // Reshaping and placing need a map: neither is offered, and the page says why.
  await expect(page.getByTestId("terr-edit")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Place it" })).toHaveCount(0);
  await expect(page.getByText("Areas are drawn on the map, so they cannot be changed while there is none.")).toBeVisible();
  await expect(page.getByText("A company is placed by a click on the map, so that waits until there is one.")).toBeVisible();

  // Still down: asked again, and the notice comes back.
  const retry = page.locator('[data-kit-part="map"] [data-part="map-retry"]');
  await expect(retry).toHaveText("Try again");
  await retry.click();
  await expect(bubble(page)).toHaveAttribute("data-map-status", "unavailable", { timeout: 45_000 });
  await expect(retry).toBeVisible();

  // The server is back. By keyboard.
  server.turn("up");
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(bubble(page)).toHaveAttribute("data-map-status", "ready", { timeout: 45_000 });
  await expect(pins(page)).toHaveCount(5);
  await expect(page.getByTestId("terr-edit")).toBeVisible();
  await expect(page.getByRole("button", { name: "Place it" })).toHaveCount(4);
  expect(problems.filter((line) => !expected(line))).toEqual([]);
});

test("maps switched off for the install: the list and one line, and nothing is asked of the map server", async ({ as, api, stand }) => {
  const owner = await api("owner");
  const headers = await csrf(owner);
  const origin = new URL(((await (await owner.get(`${STAFF}surface-config.json`)).json()) as { maps: { server: string } }).maps.server).origin;
  expect((await owner.put("/api/v1/settings/maps", { data: { enabled: false }, headers })).status()).toBe(200);
  try {
    const config = (await (await owner.get(`${STAFF}surface-config.json`)).json()) as { maps: { enabled: boolean; server: string | null } };
    expect(config.maps).toMatchObject({ enabled: false, server: null });

    const page = await (await as("ivy")).newPage();
    const problems = watch(page);
    const server = await mapServer(page, "up", origin);
    const elsewhere: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(new URL(stand.url).origin) && !request.url().startsWith("data:") && !request.url().startsWith("blob:")) elsewhere.push(request.url());
    });
    await openTerritory(page, "off");
    await expect(page.locator('[data-screen="territory"]')).toHaveAttribute("data-map", "off");
    await expect(page.locator('[data-kit-part="map"] [data-part="map-off"]')).toHaveText("Maps are switched off. Here is the list.");
    await expect(canvas(page)).toHaveCount(0);
    await expect(page.getByText("Ask the person who runs this install to switch maps on.")).toBeVisible();
    await picture(page, "p09-territory-maps-off");
    // The list, whole, with the server's figures.
    await expect(page.locator("#crm-terr-list > li")).toHaveCount(4);
    await expect(territoryRow(page, "Scotland").getByTestId("terr-value")).toHaveText(money(71_450));
    await expect(page.locator(".crm-terr-unplaced > li")).toHaveCount(4);
    await expect(page.getByTestId("terr-edit")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Place it" })).toHaveCount(0);
    // No request left for the map server, or for anywhere else.
    expect(server.asked).toEqual([]);
    expect(elsewhere).toEqual([]);
    expect(problems).toEqual([]);

    // The install's owner is the one who can switch maps on, and is given the way there.
    const hers = await (await as("owner")).newPage();
    await openTerritory(hers, "off");
    await expect(hers.locator('[data-kit-part="map"] [data-part="map-off-link"]')).toHaveAttribute("href", "/settings/maps");
    await expect(hers.getByText("Ask the person who runs this install to switch maps on.")).toHaveCount(0);
  } finally {
    expect((await owner.put("/api/v1/settings/maps", { data: { enabled: true }, headers })).status()).toBe(200);
  }
  const back = (await (await owner.get(`${STAFF}surface-config.json`)).json()) as { maps: { enabled: boolean } };
  expect(back.maps.enabled).toBe(true);
});

test("a company with no place is put on the map by a rep; a lost reply is read back; a refusal is said; a colleague's open page follows", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  const was = await snapshot(tessa, data);
  const lowOrbit = was.companies.find((company) => company.name === "Low Orbit")!;
  const tandem = was.companies.find((company) => company.name === "Tandem Robotics")!;
  expect(placeOf(lowOrbit.place)).toBeNull();
  try {
    const page = await (await as("leo")).newPage();
    await mapServer(page);
    await openTerritory(page);
    // A colleague has the page open too.
    const hers = await (await as("ivy")).newPage();
    await mapServer(hers);
    await openTerritory(hers);
    await expect(unplacedRow(hers, "Low Orbit")).toBeVisible();

    // The reply to the save is lost on its way back: the write is in, the answer never arrives.
    let lost = 0;
    await page.route("**/api/v1/data/**", async (route) => {
      if (route.request().method() !== "PATCH" || lost > 0 || !new RegExp(`crm_companies/${String(lowOrbit.id)}$`).test(new URL(route.request().url()).pathname)) return route.fallback();
      lost += 1;
      await route.fetch();
      return route.abort("connectionreset");
    });
    const place = unplacedRow(page, "Low Orbit").getByRole("button", { name: "Place it" });
    await place.click();
    await expect(unplacedRow(page, "Low Orbit").getByRole("button", { name: "Placing" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-kit-part="map"] [data-part="map-placing"]')).toContainText("Click the map where Low Orbit is.");
    // The map is brought into view for the click.
    await expect.poll(() => canvas(page).evaluate((element) => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight + 1; })).toBe(true);
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.8);
    await expect(toast(page)).toContainText("Low Orbit is on the map.", { timeout: 20_000 });
    expect(lost).toBe(1);
    await expect(pins(page)).toHaveCount(6);
    await expect(unplacedRow(page, "Low Orbit")).toHaveCount(0);
    await expect(page.locator('[data-kit-part="map"] [data-part="map-placing"]')).toHaveCount(0);
    // One write, and it is an exact place.
    const placed = placeOf((await companies(tessa, data)).find((company) => company.id === lowOrbit.id)!.place)!;
    expect(placed.by).toBe("exact");
    expect(Number.isFinite(placed.lat) && Number.isFinite(placed.lng)).toBe(true);
    await expect(page.getByTestId("terr-placed")).toHaveText("6");
    // Live: Ivy's open page follows without a reload.
    await expect(unplacedRow(hers, "Low Orbit")).toHaveCount(0, { timeout: 20_000 });
    await expect(pins(hers)).toHaveCount(6);
    await expect(hers.getByTestId("terr-placed")).toHaveText("6");

    // By keyboard, and refused: the server's "no" is said above the map, and the company stays unplaced. (The refusal is staged in the browser: Leo's role may place a company, so the real server would not refuse him. The server's own refusal of somebody who may not is the Read-only spec's.)
    await page.route("**/api/v1/data/**", (route) =>
      route.request().method() === "PATCH" && new RegExp(`crm_companies/${String(tandem.id)}$`).test(new URL(route.request().url()).pathname)
        ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Forbidden" } }) })
        : route.fallback(),
    );
    const placeTandem = unplacedRow(page, "Tandem Robotics").getByRole("button", { name: "Place it" });
    await placeTandem.focus();
    await page.keyboard.press("Enter");
    const middle = page.locator('[data-kit-part="map"] [data-part="map-place-middle"]');
    await middle.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-kit-part="map"] [data-part="map-refused"]')).toContainText("Tandem Robotics was not placed. Your role may not change this.");
    await expect(pins(page)).toHaveCount(6);
    await expect(unplacedRow(page, "Tandem Robotics")).toBeVisible();
    // Still placing, for another try; "Stop placing" leaves the state.
    await page.locator('[data-kit-part="map"] [data-part="map-placing-stop"]').click();
    await expect(page.locator('[data-kit-part="map"] [data-part="map-placing"]')).toHaveCount(0);
    await expect(unplacedRow(page, "Tandem Robotics").getByRole("button", { name: "Place it" })).toHaveAttribute("aria-pressed", "false");
    expect(placeOf((await companies(tessa, data)).find((company) => company.id === tandem.id)!.place)).toBeNull();
  } finally {
    await restore(tessa, data, was);
  }
  expect(placeOf((await companies(tessa, data)).find((company) => company.id === lowOrbit.id)!.place)).toBeNull();
});

test("a pin is moved by keyboard and the new spot is the company's", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  const was = await snapshot(tessa, data);
  const cobalt = was.companies.find((company) => company.name === "Cobalt Legal")!;
  const before = placeOf(cobalt.place)!;
  try {
    const page = await (await as("leo")).newPage();
    await mapServer(page);
    await openTerritory(page);
    const pin = pinOf(page, "Cobalt Legal");
    await pin.focus();
    await page.keyboard.press("Enter");
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(toast(page)).toContainText("The new spot for Cobalt Legal is kept.", { timeout: 20_000 });
    const after = placeOf((await companies(tessa, data)).find((company) => company.id === cobalt.id)!.place)!;
    expect(after.by).toBe("exact");
    expect(after.lng).toBeGreaterThan(before.lng);
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(0.05);
  } finally {
    await restore(tessa, data, was);
  }
  expect(placeOf((await companies(tessa, data)).find((company) => company.id === cobalt.id)!.place)).toMatchObject({ lat: before.lat, lng: before.lng });
});

test("Edit areas: an area is drawn and reshaped, and the companies it now takes in are offered; a “no” leaves them and says so; a “yes” moves each", async ({ as, api, data, stand }) => {
  test.setTimeout(240_000);
  const tessa = await api("tessa");
  const ivy = await api("ivy");
  const was = await snapshot(tessa, data);
  const north = was.territories.find((territory) => territory.name === "North")!;
  const scotland = was.territories.find((territory) => territory.name === "Scotland")!;
  const veldt = was.companies.find((company) => company.name === "Veldt Studios")!;
  expect(veldt.territory_id).toBe(scotland.id);
  const veldtNow = async (): Promise<number | null> => (await companies(tessa, data)).find((company) => company.id === veldt.id)!.territory_id;
  try {
    const page = await (await as("ivy")).newPage();
    const problems = watch(page);
    await mapServer(page);
    await openTerritory(page);

    // Nothing is picked when editing starts: the page asks which territory.
    await page.getByTestId("terr-edit").click();
    await expect(page.locator(".crm-terr-bar")).toContainText("Pick a territory in the list to reshape its area");
    await expect(page.getByRole("button", { name: "Place it" })).toHaveCount(0);

    // The North has no area: it is drawn on the map, corner by corner, round Veldt Studios' pin, which is Scotland's company.
    await territoryRow(page, "North").locator(".crm-terr-pick").click();
    await expect(page.locator(".crm-terr-bar")).toContainText("North has no area yet.");
    await page.locator('[data-kit-part="map"] [data-part="area-new"]').click();
    await canvas(page).scrollIntoViewIfNeeded();
    // The map fits its pins to its edges, and Glasgow is the northernmost: one step out gives room to draw round it.
    await page.locator('[data-kit-part="map"] .maplibregl-ctrl-zoom-out').click();
    await page.waitForTimeout(800);
    // One corner in each quarter round the pin, each placed from where the pin stands at that moment (the map may move under a click), and slowly enough that two clicks are never a double click.
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const at = (await pinOf(page, "Veldt Studios").boundingBox())!;
      const [x, y] = [at.x + at.width / 2, at.y + at.height / 2];
      const frame = (await canvas(page).boundingBox())!;
      const reach = Math.min(46, x - frame.x - 6, frame.x + frame.width - x - 6, y - frame.y - 6, frame.y + frame.height - y - 6);
      expect(reach, "room round the pin to draw in").toBeGreaterThan(18);
      await page.mouse.click(x + sx * reach, y + sy * reach);
      await page.waitForTimeout(600);
    }
    await expect(page.locator('[data-kit-part="map"] [data-part="map-corner"]')).toHaveCount(4);
    await page.locator('[data-kit-part="map"] [data-part="area-close"]').click();

    // The area is saved, and the question is asked of the person who reshaped it.
    const offer = page.locator('[data-dialog="terr-offer"]');
    await expect(offer).toBeVisible({ timeout: 20_000 });
    await expect(offer.getByRole("heading")).toHaveText("North now takes in 1 company of another territory");
    await expect(offer.locator(".crm-terr-offer-list > li")).toHaveText([/Veldt Studios.*now in Scotland/]);
    await picture(page, "p09-territory-offer");
    const saved = (await territories(tessa, data)).find((territory) => territory.id === north.id)!;
    expect((saved.area as { type: string }).type).toBe("Polygon");

    // "No": by keyboard. The dialog holds the focus, and Escape is a no.
    expect(await page.evaluate(() => document.activeElement?.closest('[data-dialog="terr-offer"]') !== null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(offer).toHaveCount(0);
    // What a "no" leaves: the area as drawn, the company where it was, and the row saying which now sit inside another's area.
    expect(await veldtNow()).toBe(scotland.id);
    await expect(territoryRow(page, "North").getByTestId("terr-inside")).toContainText("Inside this area, in another territory: Veldt Studios (Scotland).");
    // The North's own companies stand outside what was drawn: said too.
    await picture(page, "p09-territory-after-no");
    await expect(territoryRow(page, "North").getByTestId("terr-strayed")).toContainText("Outside its area: Cobalt Legal, Juno Analytics, Nordwind Logistics.");
    await expect(territoryRow(page, "Scotland").locator(".crm-terr-companies")).toContainText("Veldt Studios");

    // Reshaping: a corner is taken out, which is a change and a save of its own. The same company is not asked about again.
    const changed = page.waitForResponse((response) => response.request().method() === "PATCH" && new RegExp(`crm_territories/${String(north.id)}$`).test(new URL(response.url()).pathname));
    const corners = page.locator('[data-kit-part="map"] [data-part="map-corner"]');
    // The four corners clicked (a click the map takes as a pan, not a corner, would leave three: the count is the map's).
    const drawn = await corners.count();
    expect(drawn).toBeGreaterThanOrEqual(3);
    expect(((await territories(tessa, data)).find((territory) => territory.id === north.id)!.area as { coordinates: number[][][] }).coordinates[0]!.length).toBe(drawn + 1);
    await corners.first().click();
    await page.locator('[data-kit-part="map"] [data-part="area-insert-corner"]').click();
    expect((await changed).status()).toBe(200);
    await expect.poll(async () => ((await territories(tessa, data)).find((territory) => territory.id === north.id)!.area as { coordinates: number[][][] }).coordinates[0]!.length).toBe(drawn + 2);
    await expect(offer).toHaveCount(0);

    // The page read again from nothing still says it: the line is worked out from the area and the pins.
    await page.getByTestId("terr-done").click();
    await page.reload();
    await expect(bubble(page)).toHaveAttribute("data-map-status", "ready", { timeout: 45_000 });
    await expect(territoryRow(page, "North").getByTestId("terr-inside")).toContainText("Veldt Studios (Scotland)");
    // A rep reads the same line and is offered nothing.
    const rep = await (await as("leo")).newPage();
    await mapServer(rep);
    await openTerritory(rep);
    await expect(territoryRow(rep, "North").getByTestId("terr-inside")).toContainText("Veldt Studios (Scotland)");
    await expect(territoryRow(rep, "North").getByRole("button", { name: "Move them here…" })).toHaveCount(0);
    await rep.close();

    // The offer can be taken later, from the row, while editing. First a move the server refuses is said, and nothing is claimed moved.
    await page.getByTestId("terr-edit").click();
    await territoryRow(page, "North").getByRole("button", { name: "Move them here…" }).click();
    await expect(offer).toBeVisible();
    let refusals = 0;
    await page.route("**/api/v1/data/**", (route) => {
      if (route.request().method() !== "PATCH" || refusals > 0 || !new RegExp(`crm_companies/${String(veldt.id)}$`).test(new URL(route.request().url()).pathname)) return route.fallback();
      refusals += 1;
      // Staged: the manager may change a company, so the real server would not refuse her. Read-only's real refusal of this same write is in its own spec.
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Forbidden" } }) });
    });
    await page.getByTestId("terr-offer-yes").click();
    await expect(toast(page)).toContainText("0 companies moved to North. Not moved: Veldt Studios: Your role may not change this.");
    expect(await veldtNow()).toBe(scotland.id);

    // "Yes": the company is saved as the North's, by the server.
    await territoryRow(page, "North").getByRole("button", { name: "Move them here…" }).click();
    await page.getByTestId("terr-offer-yes").click();
    await expect(toast(page)).toContainText("1 company moved to North.", { timeout: 20_000 });
    await expect(offer).toHaveCount(0);
    expect(await veldtNow()).toBe(north.id);
    await expect(territoryRow(page, "North").locator(".crm-terr-companies")).toContainText("Veldt Studios");
    await expect(territoryRow(page, "North").getByTestId("terr-inside")).toHaveCount(0);
    // The figures are asked again for the territories as they now are.
    const all = await companies(ivy, data);
    const northNow = await openDealsAt(ivy, stand, all.filter((company) => company.territory_id === north.id).map((company) => company.id));
    await expect(territoryRow(page, "North").getByTestId("terr-value")).toHaveText(money(northNow.value));
    expect(northNow.value).toBe(128_850 + 30_700);

    // Scotland has no area either, and one area now exists: it starts from a box round its companies with a place (none is left, so first one is given back).
    await page.getByTestId("terr-done").click();
    expect((await tessa.patch(data("companies", `/${String(veldt.id)}`), { data: { values: { territory_id: scotland.id } }, headers: await csrf(tessa) })).status()).toBe(200);
    await expect(territoryRow(page, "Scotland").locator(".crm-terr-companies")).toContainText("Veldt Studios", { timeout: 20_000 });
    await page.getByTestId("terr-edit").click();
    await territoryRow(page, "Scotland").locator(".crm-terr-pick").click();
    await page.getByTestId("terr-start-area").click();
    await expect(toast(page)).toContainText("Scotland has an area. Drag its corners to fit.", { timeout: 20_000 });
    const boxed = (await territories(tessa, data)).find((territory) => territory.id === scotland.id)!;
    expect((boxed.area as { coordinates: number[][][] }).coordinates[0]!.length).toBe(5);
    // Its name and its owner are changed in the same place, each a save.
    const fields = territoryRow(page, "Scotland").locator(".crm-terr-fields");
    await fields.getByLabel("Owner").selectOption({ label: "Sam Okonjo" });
    await expect(toast(page)).toContainText("Scotland has a new owner.");
    await expect(territoryRow(page, "Scotland").locator(".crm-terr-owner")).toContainText("Sam Okonjo");
    expect((await territories(tessa, data)).find((territory) => territory.id === scotland.id)!.owner_id).toBe(stand.people["sam"]!.id);

    // A new territory is made once, named, and listed.
    await page.getByTestId("terr-new").click();
    await expect(toast(page)).toContainText("Territory added.");
    const made = territoryRow(page, "New territory");
    await expect(made).toBeVisible();
    const name = made.locator(".crm-terr-fields").getByLabel("Name");
    await name.fill("Spec: Wales");
    await name.press("Enter");
    await expect(toast(page)).toContainText("Renamed to Spec: Wales.");
    await expect(territoryRow(page, "Spec: Wales")).toBeVisible();
    expect((await territories(tessa, data)).filter((territory) => territory.name === "Spec: Wales")).toHaveLength(1);
    expect(problems.filter((line) => !expected(line))).toEqual([]);
  } finally {
    await restore(tessa, data, was);
  }
  const back = await snapshot(tessa, data);
  expect(back.territories.map((territory) => [territory.name, territory.owner_id, territory.area ?? null])).toEqual(was.territories.map((territory) => [territory.name, territory.owner_id, territory.area ?? null]));
  expect(back.companies.map((company) => [company.name, company.territory_id])).toEqual(was.companies.map((company) => [company.name, company.territory_id]));
  // The proof rows read by other specs are as they were: a manager's rows of deals did not move.
  expect((await rows(ivy, data, "deals", { column: "state", op: "eq", value: "open" })).length).toBe(14);
});

test("in Arabic, at 390 wide, in the dark: right to left, no sideways scroll, and the map still stands", async ({ as, api }) => {
  const tessa = await api("tessa");
  await inArabic(tessa, async () => {
    const context = await as("tessa", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    const page = await context.newPage();
    await mapServer(page);
    await openTerritory(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مناطق البيع");
    await expect(pins(page)).toHaveCount(5);
    await expect(page.locator("#crm-terr-list > li")).toHaveCount(4);
    // The map itself never mirrors; everything round it does.
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId("terr-edit")).toHaveText("تعديل المساحات");
    await picture(page, "p09-territory-ar-390-dark");
    await page.getByTestId("terr-edit").click();
    await expect(page.locator(".crm-terr-bar")).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
