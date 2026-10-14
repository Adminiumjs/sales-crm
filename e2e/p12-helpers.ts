/** What the team's specs share: who a person is, a fresh minute of requests, and taking a spec's covers away. */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect } from "./fixtures.ts";
import { csrf, rows, STAFF, unfoldMenu, type Data } from "./helpers.ts";

export const me = async (person: APIRequestContext): Promise<string> => ((await (await person.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;

/**
 * The server gives a person 300 requests a minute. A spec that works a whole
 * screen as somebody first looks at what the server says is left of their
 * minute, and waits for the next one when it is short (as `visits.e2e.ts`).
 */
export async function room(person: APIRequestContext, data: Data, needs: number): Promise<void> {
  const res = await person.get(data("stages", "?limit=1&select=id"));
  const headers = res.headers();
  const left = Number(headers["x-ratelimit-remaining"] ?? "300");
  const reset = Number(headers["x-ratelimit-reset"] ?? "0");
  if (res.status() === 429 || left < needs) await new Promise((done) => setTimeout(done, (Number.isFinite(reset) && reset > 0 ? Math.min(reset, 60) : 60) * 1000 + 750));
}

export interface CoverRow {
  id: number;
  owner_id: string;
  cover_id: string;
  starts_on: string;
  ends_on: string | null;
}

/** Every cover but the sample's one (Dana away from 10 August), its briefing notes first; and every briefing note a spec wrote on the sample's. */
export async function removeSpecCovers(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const note of await rows<{ id: number }>(admin, data, "cover_notes", { column: "text", op: "like", value: "Spec: %" })) {
    expect((await admin.delete(data("cover_notes", `/${String(note.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
  for (const cover of await rows<CoverRow>(admin, data, "covers")) {
    if (String(cover.starts_on).slice(0, 10) === "2026-08-10") continue;
    for (const note of await rows<{ id: number }>(admin, data, "cover_notes", { column: "cover_id", op: "eq", value: cover.id })) {
      expect((await admin.delete(data("cover_notes", `/${String(note.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
    expect((await admin.delete(data("covers", `/${String(cover.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
}

export const menu = (page: Page) => page.getByRole("navigation", { name: "Menu" });

/** Press a line of the menu, unfolding its group first if the menu is long enough to have folded it. */
export async function go(page: Page, name: string): Promise<void> {
  await unfoldMenu(page);
  await menu(page).getByRole("link", { name, exact: true }).click();
}
export const noSidewaysScroll = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
export const stat = (page: Page, id: string) => page.getByTestId(id).locator(".crm-stat-value");
