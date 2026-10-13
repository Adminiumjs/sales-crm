/** What the selling specs share: the app's address, a person's write token, a row by its name, and putting the sample back. */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect } from "./fixtures.ts";

export const STAFF = "/apps/crm/staff/";

export type Data = (ref: string, rest?: string) => string;

export async function csrf(person: APIRequestContext): Promise<Record<string, string>> {
  const config = (await (await person.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string };
  return { "x-adminium-csrf": config.csrfToken };
}

const where = (condition: unknown): string => `where=${encodeURIComponent(JSON.stringify(condition))}`;

export async function rows<R = Record<string, unknown>>(person: APIRequestContext, data: Data, ref: string, condition?: unknown, more = ""): Promise<R[]> {
  const res = await person.get(data(ref, `?limit=200${condition === undefined ? "" : `&${where(condition)}`}${more}`));
  expect(res.status(), `${ref}: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { data: R[] }).data;
}

export async function dealNamed(person: APIRequestContext, data: Data, name: string): Promise<{ id: number; stage_id: number; state: string; owner_id: string } & Record<string, unknown>> {
  const found = await rows<{ id: number; stage_id: number; state: string; owner_id: string }>(person, data, "deals", { column: "name", op: "eq", value: name });
  expect(found.length, `one deal called "${name}"`).toBe(1);
  return found[0]!;
}

/** Take away every deal a spec made (by its name's first words), its follow-ups first, as the CRM admin. A closed one is reopened first: a closed deal is locked. */
export async function removeDeals(admin: APIRequestContext, data: Data, startsWith: string): Promise<void> {
  const headers = await csrf(admin);
  for (const deal of await rows<{ id: number; state: string }>(admin, data, "deals", { column: "name", op: "like", value: `${startsWith}%` })) {
    for (const step of await rows<{ id: number }>(admin, data, "follow_ups", { column: "deal_id", op: "eq", value: deal.id })) {
      expect((await admin.delete(data("follow_ups", `/${String(step.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
    if (deal.state !== "open") expect((await admin.post(data("deals", `/${String(deal.id)}/actions/reopen`), { data: { from: deal.state }, headers })).status()).toBe(200);
    expect((await admin.delete(data("deals", `/${String(deal.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
}

/** What goes wrong on a page while a spec looks at it: script errors and refused requests. */
export function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  return problems;
}

export const column = (page: Page, stageId: number) => page.locator(`[data-kit-part="board"] [data-board-column="${String(stageId)}"]`);
export const card = (page: Page, title: string) => page.locator('[data-kit-part="board"]').getByRole("button", { name: title, exact: true });
export const cardsIn = (page: Page, stageId: number): Promise<string[]> => column(page, stageId).locator("[data-board-card]").evaluateAll((cards) => cards.map((one) => one.getAttribute("aria-label") ?? ""));

/** Run something with a person reading Arabic (their own setting in Adminium), and give them English back afterwards. */
export async function inArabic(person: APIRequestContext, run: () => Promise<void>): Promise<void> {
  const headers = await csrf(person);
  expect((await person.patch("/api/v1/me/prefs", { data: { locale: "ar_EG" }, headers })).status()).toBe(200);
  try {
    await run();
  } finally {
    await person.patch("/api/v1/me/prefs", { data: { locale: "en_US" }, headers });
  }
}

/**
 * Let a person's minute run out. The server counts each person's requests by the minute (300), every sample person is signed in once and reused, and a run of heavy screens as one person can spend the lot: the next spec as that person would then be made to wait by the server, past its own patience. Called between such runs, not inside one.
 */
export const minuteOut = (): Promise<void> => new Promise((done) => setTimeout(done, 45_000));
