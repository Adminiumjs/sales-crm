/**
 * What the Territory specs share: the map server stood in for (no spec reaches
 * the network), the figure door asked directly as a person, and the sample's
 * territories put back as they were.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect } from "./fixtures.ts";
import type { StandState } from "./stand.mjs";
import { csrf, rows, STAFF, type Data } from "./helpers.ts";

/** A picture of one pixel: all the stand-in's sprite holds. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** A style as a map server writes one, every address in it on that server. */
function styleOf(origin: string, dark: boolean): Record<string, unknown> {
  return {
    version: 8,
    name: dark ? "stand-in dark" : "stand-in light",
    sprite: `${origin}/sprites/stand-in`,
    glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
    sources: { land: { type: "vector", tiles: [`${origin}/tiles/{z}/{x}/{y}.pbf`], maxzoom: 6 } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": dark ? "#101418" : "#e6edf2" } },
      { id: "land", type: "fill", source: "land", "source-layer": "land", paint: { "fill-color": dark ? "#1c242c" : "#d3dde4" } },
    ],
  };
}

export interface MapServer {
  origin: string;
  /** Every path the page asked the map server for. */
  asked: string[];
  turn: (next: "up" | "down") => void;
}

/**
 * The map server this Adminium names, answered here: `up` gives a plain style
 * with empty map pictures, `down` refuses every request as an unreachable
 * server does. As the engine's own kit spec does it (`apps/e2e/tests/kit-parts.spec.ts`).
 */
export async function mapServer(page: Page, how: "up" | "down" = "up", origin?: string): Promise<MapServer> {
  const from = origin ?? new URL(((await (await page.request.get(`${STAFF}surface-config.json`)).json()) as { maps: { server: string } }).maps.server).origin;
  const asked: string[] = [];
  const state = { how };
  const cors = { "access-control-allow-origin": "*" };
  await page.route(`${from}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    asked.push(pathname);
    if (state.how === "down") return route.abort("connectionrefused");
    if (pathname.startsWith("/styles/")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(styleOf(from, pathname.endsWith("/dark"))) });
    if (pathname.endsWith(".json")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: "{}" });
    if (pathname.endsWith(".png")) return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PIXEL });
    return route.fulfill({ status: 200, headers: cors, contentType: "application/x-protobuf", body: Buffer.alloc(0) });
  });
  return { origin: from, asked, turn: (next) => void (state.how = next) };
}

export const bubble = (page: Page) => page.locator('[data-kit-part="map"] [data-widget="map-bubble"]');
export const pins = (page: Page) => page.locator('[data-kit-part="map"] [data-part="map-pin"]');
export const pinOf = (page: Page, name: string) => page.locator(`[data-kit-part="map"] [data-part="map-pin"][aria-label^="${name}"]`);
export const canvas = (page: Page) => page.locator('[data-kit-part="map"] [data-part="map-canvas"]');
export const territoryRow = (page: Page, name: string) => page.locator(".crm-terr-row", { has: page.locator(".crm-terr-name-main", { hasText: new RegExp(`^${name}$`) }) });
export const unplacedRow = (page: Page, name: string) => page.locator(".crm-terr-unplaced > li", { hasText: name });

export async function openTerritory(page: Page, wait: "ready" | "unavailable" | "off" = "ready"): Promise<void> {
  await page.goto(`${STAFF}territory`);
  await expect(page.locator('[data-screen="territory"]')).toBeVisible();
  await expect(bubble(page)).toHaveAttribute("data-map-status", wait, { timeout: 45_000 });
}

/** A figure, asked of the server directly as a person: what the screen must show them. */
export async function figure(person: APIRequestContext, stand: StandState, table: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await person.post("/api/v1/widget-data/query", { data: { descriptor: { connectionId: stand.connectionId, source: { name: stand.tables[`crm_${table}`] }, ...body } }, headers: await csrf(person) });
  expect(res.status(), `${table} figure: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { result: Record<string, unknown> }).result;
}

export interface OpenDeals {
  count: number;
  value: number;
}
/** How many open deals there are at some companies and what they come to, for this person. */
export async function openDealsAt(person: APIRequestContext, stand: StandState, companyIds: number[], more: unknown[] = []): Promise<OpenDeals> {
  const result = (await figure(person, stand, "deals", {
    shape: "categorical",
    filters: [{ column: "state", op: "eq", value: "open" }, { column: "company_id", op: "in", value: companyIds }, ...more],
    groupBy: ["state"],
    aggregations: [
      { fn: "count", alias: "n" },
      { fn: "sum", column: "amount", alias: "amount" },
    ],
  })) as { items: { key: string; values?: Record<string, number> }[] };
  const values = result.items.find((item) => String(item.key) === "open")?.values;
  return { count: Number(values?.["n"] ?? 0), value: Number(values?.["amount"] ?? 0) };
}

export interface TerritoryRow {
  id: number;
  name: string;
  owner_id: string | null;
  area: unknown;
}
export interface CompanyRow {
  id: number;
  name: string;
  territory_id: number | null;
  place: unknown;
}

export const territories = (person: APIRequestContext, data: Data): Promise<TerritoryRow[]> => rows<TerritoryRow>(person, data, "territories", undefined, "&order=id");
export const companies = (person: APIRequestContext, data: Data): Promise<CompanyRow[]> => rows<CompanyRow>(person, data, "companies", undefined, "&order=name");

/** What a place column holds, as an object. */
export const placeOf = (value: unknown): { lat: number; lng: number; by?: string; placeId?: number } | null => (value === null || value === undefined ? null : typeof value === "string" ? (JSON.parse(value) as { lat: number; lng: number }) : (value as { lat: number; lng: number }));

/** The sample's territories and companies as they shipped: taken before a spec changes them, put back after. */
export async function snapshot(admin: APIRequestContext, data: Data): Promise<{ territories: TerritoryRow[]; companies: CompanyRow[] }> {
  return { territories: await territories(admin, data), companies: await companies(admin, data) };
}

export async function restore(admin: APIRequestContext, data: Data, was: { territories: TerritoryRow[]; companies: CompanyRow[] }): Promise<void> {
  const headers = await csrf(admin);
  for (const company of await companies(admin, data)) {
    const before = was.companies.find((one) => one.id === company.id);
    if (before === undefined) continue;
    const values: Record<string, unknown> = {};
    if (company.territory_id !== before.territory_id) values["territory_id"] = before.territory_id;
    if (JSON.stringify(placeOf(company.place)) !== JSON.stringify(placeOf(before.place))) {
      const place = placeOf(before.place);
      // A place by town is given back by its town's number: the server fills in the rest, as it did for the sample.
      values["place"] = place === null ? null : place.by === "town" && place.placeId !== undefined ? { placeId: place.placeId } : { lat: place.lat, lng: place.lng };
    }
    if (Object.keys(values).length > 0) expect((await admin.patch(data("companies", `/${String(company.id)}`), { data: { values }, headers })).status(), `put ${company.name} back`).toBe(200);
  }
  for (const territory of await territories(admin, data)) {
    const before = was.territories.find((one) => one.id === territory.id);
    if (before === undefined) {
      expect((await admin.delete(data("territories", `/${String(territory.id)}?confirm=true`), { headers })).status(), `take ${territory.name} away`).toBeLessThan(300);
      continue;
    }
    const values: Record<string, unknown> = {};
    if (JSON.stringify(territory.area ?? null) !== JSON.stringify(before.area ?? null)) values["area"] = before.area ?? null;
    if (territory.owner_id !== before.owner_id) values["owner_id"] = before.owner_id;
    if (territory.name !== before.name) values["name"] = before.name;
    if (Object.keys(values).length > 0) expect((await admin.patch(data("territories", `/${String(territory.id)}`), { data: { values }, headers })).status(), `put ${territory.name} back`).toBe(200);
  }
}
