/** What the selling specs share: the app's address, a person's write token, a row by its name, and putting the sample back. */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { request, type APIRequestContext, type Page } from "@playwright/test";

import { expect } from "./fixtures.ts";
import { readState, STAND_DIR } from "./stand.mjs";

export const STAFF = "/apps/crm/staff/";

export type Data = (ref: string, rest?: string) => string;

export async function csrf(person: APIRequestContext): Promise<Record<string, string>> {
  const config = (await (await person.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string };
  return { "x-adminium-csrf": config.csrfToken };
}

const where = (condition: unknown): string => `where=${encodeURIComponent(JSON.stringify(condition))}`;

export async function rows<R = Record<string, unknown>>(person: APIRequestContext, data: Data, ref: string, condition?: unknown, more = ""): Promise<R[]> {
  // A spec's own look at the server is not what is being proved: when the person's minute of requests is spent (300), it waits
  // for the server's clock and asks again, rather than fail a screen's spec on its own bookkeeping.
  let res = await person.get(data(ref, `?limit=200${condition === undefined ? "" : `&${where(condition)}`}${more}`));
  for (let tries = 0; res.status() === 429 && tries < 3; tries += 1) {
    await new Promise((done) => setTimeout(done, (Number(res.headers()["retry-after"]) || 10) * 1000 + 500));
    res = await person.get(data(ref, `?limit=200${condition === undefined ? "" : `&${where(condition)}`}${more}`));
  }
  expect(res.status(), `${ref}: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { data: R[] }).data;
}

export async function dealNamed(person: APIRequestContext, data: Data, name: string): Promise<{ id: number; stage_id: number; state: string; owner_id: string } & Record<string, unknown>> {
  const found = await rows<{ id: number; stage_id: number; state: string; owner_id: string }>(person, data, "deals", { column: "name", op: "eq", value: name });
  expect(found.length, `one deal called "${name}"`).toBe(1);
  return found[0]!;
}

let ownerRequest: APIRequestContext | null = null;

/**
 * The install's owner, with no page: for the one thing no role of the app may do, which is to take away the rows the
 * rules hang on a deal (its mark, its stage changes). Signed in once a run, the first time a clean-up needs it.
 */
async function asOwner(): Promise<APIRequestContext> {
  if (ownerRequest !== null) return ownerRequest;
  const state = readState();
  if (state === null) throw new Error("the stand is not up");
  const file = join(STAND_DIR, "auth", "owner-cleanup.json");
  const context = await request.newContext({ baseURL: state.url, ...(existsSync(file) ? { storageState: file } : {}) });
  if (!existsSync(file)) {
    for (let tries = 0; ; tries += 1) {
      const res = await context.post("/api/v1/auth/login", { data: { email: state.owner.email, password: state.owner.password } });
      // The server allows five sign-ins a minute from one address: wait for its own clock, a few times.
      if (res.status() === 429 && tries < 4) {
        await new Promise((done) => setTimeout(done, 20_000));
        continue;
      }
      expect(res.status(), `the owner signs in for a clean-up: ${await res.text()}`).toBe(200);
      break;
    }
    mkdirSync(join(STAND_DIR, "auth"), { recursive: true });
    await context.storageState({ path: file });
  }
  ownerRequest = context;
  return context;
}

/** The tables whose rows hang on a deal, the ones under another first. A table the installed stage does not have is passed over. */
const UNDER_A_DEAL = ["visit_agreed", "visit_notes", "site_visits", "quote_lines", "quotes", "cover_notes", "deal_members", "comments", "activities", "follow_ups", "deal_amount_changes", "deal_stage_changes", "deal_marks", "nudge_snoozes"] as const;

/** Everything a deal holds, taken away as the install's owner; then the deal. For a deal no role of the app can remove any more. */
async function purgeDeal(data: Data, id: number): Promise<void> {
  const owner = await asOwner();
  const headers = await csrf(owner);
  const quotes = await rows<{ id: number }>(owner, data, "quotes", { column: "deal_id", op: "eq", value: id }).catch(() => []);
  const visits = await rows<{ id: number }>(owner, data, "site_visits", { column: "deal_id", op: "eq", value: id }).catch(() => []);
  for (const ref of UNDER_A_DEAL) {
    const under = ref === "quote_lines" ? quotes.map((quote) => ({ column: "document_id", value: quote.id })) : ref === "visit_notes" || ref === "visit_agreed" ? visits.map((visit) => ({ column: "visit_id", value: visit.id })) : [{ column: "deal_id", value: id }];
    for (const { column, value } of under) {
      let held: { id: number }[] = [];
      try {
        held = await rows<{ id: number }>(owner, data, ref, { column, op: "eq", value });
      } catch {
        continue; // not a table of this stage, or not a column of it
      }
      for (const row of held) await owner.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers });
    }
  }
  // An enquiry that became this deal lets go of it.
  for (const enquiry of await rows<{ id: number }>(owner, data, "enquiries", { column: "deal_id", op: "eq", value: id }).catch(() => [])) {
    await owner.patch(data("enquiries", `/${String(enquiry.id)}`), { data: { values: { deal_id: null } }, headers });
  }
  const gone = await owner.delete(data("deals", `/${String(id)}?confirm=true`), { headers });
  expect(gone.status(), `deal ${String(id)} is taken away: ${await gone.text()}`).toBeLessThan(300);
}

/**
 * Take away every deal a spec made (by its name's first words), its follow-ups first, as the CRM admin. A closed one is
 * reopened first: a closed deal is locked. A deal that has lived a minute holds rows the rules made (its mark, its stage
 * changes), which no role of the app removes: that one is taken away as the install's owner, with all it holds, so that
 * no figure a later spec reads keeps it.
 */
export async function removeDeals(admin: APIRequestContext, data: Data, startsWith: string): Promise<void> {
  const headers = await csrf(admin);
  for (const deal of await rows<{ id: number; state: string }>(admin, data, "deals", { column: "name", op: "like", value: `${startsWith}%` })) {
    for (const step of await rows<{ id: number }>(admin, data, "follow_ups", { column: "deal_id", op: "eq", value: deal.id })) {
      expect((await admin.delete(data("follow_ups", `/${String(step.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
    if (deal.state !== "open") expect((await admin.post(data("deals", `/${String(deal.id)}/actions/reopen`), { data: { from: deal.state }, headers })).status()).toBe(200);
    const removed = await admin.delete(data("deals", `/${String(deal.id)}?confirm=true`), { headers });
    if (removed.status() >= 300) await purgeDeal(data, deal.id);
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

/**
 * Open every group of the menu. A long menu (a manager's, the CRM admin's) starts with its lower groups folded, so a spec
 * that looks for a line under "The team" or "Settings" unfolds them first, as a person would.
 */
export async function unfoldMenu(page: Page): Promise<void> {
  // The menu is drawn once the person's session has answered: a look taken before that finds nothing to unfold.
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link").first().waitFor();
  const heads = page.getByRole("navigation", { name: "Menu" }).locator('button.crm-menu-head[aria-expanded="false"]');
  for (let left = await heads.count(); left > 0; left -= 1) await heads.first().click();
}
