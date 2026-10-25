/**
 * SETTINGS → MAPS, in the console, as the install's owner: maps switched off
 * (the console follows at once, with no reload), on again (the page asks for
 * a reload, and until then nothing tries to draw a map), and "Routes along
 * roads" on, with one route asked: a crew's day on the CRM's Route screen.
 *
 * THE ONE CALL TO THE NETWORK IN THE SUITE. With routes along roads on, the
 * stand's server asks the public routing server (`ADMINIUM_ROUTING_SERVER`,
 * an OSRM; the stand sets none, so it is Adminium's default) for the road
 * route between that day's stops: ONE request (the server keeps the answer
 * a day, and asks at most once a second). The spec asserts that the answer
 * came from the routing server and is drawn: the legs by road, each with a
 * drive time, and the road's line handed to the map. The map server itself is
 * stood in for (`territory-helpers.ts`), as everywhere else.
 *
 * Every setting is put back as it was found, in a `finally`.
 */
import type { Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, STAFF } from "./helpers.ts";
import { mapServer } from "./territory-helpers.ts";

interface MapsSettings {
  enabled: boolean;
  routing: boolean;
  mapServer: string | null;
  routingServer: string | null;
  routingServerOff: boolean;
}
const RED = 2;

const mapsSwitch = (page: Page) => page.locator('[data-part="maps-switch"]').getByRole("switch");
const routesSwitch = (page: Page) => page.locator('[data-part="routes-switch"]').getByRole("switch");

test("Settings → Maps: off and the console follows at once, on and it asks for a reload, routes along roads with one real route", async ({ as, api, data, stand }) => {
  test.setTimeout(240_000);
  const owner = await api("owner");
  const headers = await csrf(owner);
  const before = ((await (await owner.get("/api/v1/settings/maps")).json()) as { data: MapsSettings }).data;
  expect(before).toMatchObject({ enabled: true, routing: false, routingServerOff: false });
  expect(before.routingServer, "the routing server this server would ask").not.toBeNull();
  const routingHost = new URL(before.routingServer!).host;
  test.info().annotations.push({ type: "routing server", description: routingHost });
  console.info(`[zw-maps] the routing server asked: ${routingHost}`);
  const [cobalt] = await rows<{ id: number }>(owner, data, "companies", { column: "name", op: "eq", value: "Cobalt Legal" });
  try {
    const page = await (await as("owner")).newPage();
    const server = await mapServer(page);
    await page.goto("/settings/maps");
    await expect(page.locator('[data-part="maps-server"]')).toContainText(new URL(before.mapServer!).host);
    await expect(page.locator('[data-part="routes-server"]')).toHaveText(`Routing server: ${routingHost}. Set by whoever runs this server, with ADMINIUM_ROUTING_SERVER.`);
    await expect(mapsSwitch(page)).toBeChecked();
    await expect(routesSwitch(page)).not.toBeChecked();

    // OFF: saved, and the console's session read again at once. A record's place field, reached in the console with no
    // reload, has no map and asks nothing of the map server.
    await mapsSwitch(page).click();
    await expect(mapsSwitch(page)).not.toBeChecked();
    await expect.poll(async () => ((await (await owner.get("/api/v1/settings/maps")).json()) as { data: MapsSettings }).data.enabled).toBe(false);
    await expect(page.locator('[data-part="maps-reload"]')).toHaveCount(0);
    await page.evaluate(() => ((window as unknown as { zwSamePage: boolean }).zwSamePage = true));
    const asked = server.asked.length;
    await openInApp(page, `/p/crm-companies/r/${String(cobalt!.id)}`);
    await page.locator('[data-part="page-record"]').getByRole("button", { name: "Edit", exact: true }).click();
    const field = page.getByRole("dialog").locator('[data-part="place-field"]');
    await expect(field.locator('[data-part="place-kind"]')).toContainText(/Exact spot: 53\.8008\d*, -1\.5491\d*/);
    await expect(field.locator('[data-part="place-map"]')).toHaveCount(0);
    expect(server.asked.length).toBe(asked);
    expect(await page.evaluate(() => (window as unknown as { zwSamePage?: boolean }).zwSamePage)).toBe(true);
    await page.keyboard.press("Escape");
    // An open staff page, read after the switch: the list and one line.
    const ivy = await (await as("ivy")).newPage();
    await mapServer(ivy, "up", new URL(before.mapServer!).origin);
    await ivy.goto(`${STAFF}territory`);
    await expect(ivy.locator('[data-kit-part="map"] [data-part="map-off"]')).toHaveText("Maps are switched off. Here is the list.", { timeout: 45_000 });
    await expect(ivy.locator("#crm-terr-list > li")).toHaveCount(4);

    // ON again: the page says a reload is owed, and until then the console draws no map.
    await openInApp(page, "/settings/maps");
    await mapsSwitch(page).click();
    await expect(mapsSwitch(page)).toBeChecked();
    const reload = page.locator('[data-part="maps-reload"]');
    await expect(reload).toContainText("Maps are on. Reload to see them.");
    await expect(reload).toContainText("A page that was open while maps were off may not ask the map server. Reload it, here and in other open tabs.");
    await picture(page, "zw-maps-1-reload-owed");
    await openInApp(page, `/p/crm-companies/r/${String(cobalt!.id)}`);
    await page.locator('[data-part="page-record"]').getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("dialog").locator('[data-part="place-kind"]')).toHaveText(/Exact spot/);
    await expect(page.getByRole("dialog").locator('[data-part="place-map"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    // The page's own button reloads it; the reload is still owed when the page is opened again before that.
    await openInApp(page, "/settings/maps");
    await expect(reload).toBeVisible();
    await reload.getByRole("button", { name: "Reload this page" }).click();
    await page.waitForLoadState("load");
    await expect(page.locator('[data-part="maps-reload"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { zwSamePage?: boolean }).zwSamePage)).toBeUndefined();
    await page.goto(`/p/crm-companies/r/${String(cobalt!.id)}`);
    await page.locator('[data-part="page-record"]').getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("dialog").locator('[data-part="place-map"] [data-part="map-pin"]')).toHaveCount(1, { timeout: 30_000 });
    await page.keyboard.press("Escape");

    // ROUTES ALONG ROADS: on, and no reload owed for it.
    await page.goto("/settings/maps");
    await routesSwitch(page).click();
    await expect(routesSwitch(page)).toBeChecked();
    await expect.poll(async () => ((await (await owner.get("/api/v1/settings/maps")).json()) as { data: MapsSettings }).data.routing).toBe(true);
    await expect(page.locator('[data-part="maps-reload"]')).toHaveCount(0);

    // One route asked (the Route comes with Jobs on site, stage 2 or 3): Red crew's Wednesday, Leeds → Hull → Leeds (straight, the ledger's 160.6 km).
    if (stand.parts.includes("jobs")) {
      const ada = await (await as("ada")).newPage();
      await mapServer(ada);
      // Every answer the page is given: the list asks for the whole day (out and back), the map for the way it draws.
      const answers: { stops: number; source: string; fellBack: boolean; legs: number; line: number }[] = [];
      ada.on("response", async (response) => {
        if (response.request().method() !== "POST" || new URL(response.url()).pathname !== "/api/v1/geo/route") return;
        const asked = (response.request().postDataJSON() as { stops: unknown[] }).stops.length;
        const body = ((await response.json()) as { data: { source: string; fellBack?: true; legs: unknown[]; line?: { coordinates: unknown[] } } }).data;
        answers.push({ stops: asked, source: body.source, fellBack: body.fellBack === true, legs: body.legs.length, line: body.line?.coordinates.length ?? 0 });
      });
      const answered = ada.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/geo/route", { timeout: 60_000 });
      await ada.goto(`${STAFF}route/2026-08-05/${String(RED)}`);
      const reply = await answered;
      expect(reply.status()).toBe(200);
      const answer = ((await reply.json()) as { data: { source: string; fellBack?: true; legs: { distanceM: number | null; durationS: number | null }[]; line?: { type: string; coordinates: [number, number][] } } }).data;
      // It came from the routing server, by road: a time for each leg, and the road's line.
      expect(answer.fellBack, `the routing server at ${routingHost} answered`).toBeUndefined();
      expect(answer.source).toBe("server");
      expect(answer.legs).toHaveLength(2);
      for (const leg of answer.legs) {
        expect(leg.durationS).toBeGreaterThan(0);
        expect(leg.distanceM).toBeGreaterThan(50_000);
      }
      expect(answer.line?.type).toBe("LineString");
      expect(answer.line!.coordinates.length).toBeGreaterThan(10);
      test.info().annotations.push({ type: "road route", description: `${String(answer.legs.map((leg) => Math.round((leg.distanceM ?? 0) / 100) / 10).join(" + "))} km, ${String(answer.legs.map((leg) => Math.round((leg.durationS ?? 0) / 60)).join(" + "))} min, ${String(answer.line!.coordinates.length)} points` });
      // Drawn: the screen says the legs are along the roads, a drive time beside each and in all, and the whole way by road.
      const route = ada.getByTestId("jb-route");
      console.info(`[zw-maps] ${test.info().annotations.at(-1)!.description!}`);
      await expect(ada.getByTestId("jb-route-note")).toHaveText("Along the roads, with a drive time for each leg.");
      await expect(route.locator('[data-figure="distance"] [data-value]')).not.toHaveText("160.6 km");
      await expect(route.locator('[data-figure="distance"] [data-value]')).toHaveText(/^[\d,.]+ km$/);
      await expect(route.getByText(/\d+ h \d+ min drive|\d+ min drive/).first()).toBeVisible();
      await expect(ada.locator('[data-kit-part="map"] [data-widget="map-bubble"]')).toHaveAttribute("data-map-status", "ready", { timeout: 45_000 });
      // The map's own answer (the way it draws: depot, then the stop) came by road too, with the road's line, which the map
      // draws as a solid line where a straight guess would be dashed.
      await expect.poll(() => answers.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      console.info(`[zw-maps] the page's route answers: ${JSON.stringify(answers)}`);
      const drawn = answers.find((one) => one.stops === 2);
      expect(drawn, "the map asked for its way").toBeDefined();
      expect(drawn).toMatchObject({ source: "server", fellBack: false, legs: 1 });
      expect(drawn!.line).toBeGreaterThan(10);
      await picture(ada, "zw-maps-2-route-by-road");

    }

    // And off again from the same page.
    await routesSwitch(page).click();
    await expect(routesSwitch(page)).not.toBeChecked();
  } finally {
    const back = await owner.put("/api/v1/settings/maps", { data: { enabled: before.enabled, routing: before.routing }, headers });
    expect(back.status(), await back.text()).toBe(200);
  }
  const after = ((await (await owner.get("/api/v1/settings/maps")).json()) as { data: MapsSettings }).data;
  expect({ enabled: after.enabled, routing: after.routing }).toEqual({ enabled: before.enabled, routing: before.routing });
});

/** Go to an address of the console the way its own links do, with no reload: the router hears the history change. */
async function openInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[/.]/g, "\\$&")}$`));
}
