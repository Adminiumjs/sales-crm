/**
 * WHO A SPEC IS. `as("dana")` answers a browser context signed in as that
 * sample person; `api("dana")` answers the same person with no page, for the
 * direct calls that prove a refusal is the server's and not a missing button.
 *
 * Each person is signed in ONCE per stand, the first time a spec asks for
 * them, and their cookies are kept beside the stand. The server allows five
 * sign-ins a minute from one address, so the sixth in a minute waits its turn
 * here instead of being refused there.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test as base, expect, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions } from "@playwright/test";

import { readState, STAND_DIR, type StandState } from "./stand.mjs";

const AUTH_DIR = join(STAND_DIR, "auth");
const SIGN_INS = join(STAND_DIR, "sign-ins.json");
const PER_MINUTE = 4;

export function stand(): StandState {
  const state = readState();
  if (state === null || state.ready !== true) throw new Error("the stand is not up: run the specs through `npm run e2e`");
  return state;
}

/** Wait until a sign-in may be made, and note it. Exported for a spec that signs in through a page of its own (another address of the stand). */
export async function takeTurn(): Promise<void> {
  for (;;) {
    const now = Date.now();
    const recent = (existsSync(SIGN_INS) ? (JSON.parse(readFileSync(SIGN_INS, "utf8")) as number[]) : []).filter((at) => now - at < 61_000);
    if (recent.length < PER_MINUTE) {
      writeFileSync(SIGN_INS, JSON.stringify([...recent, now]));
      return;
    }
    await new Promise((done) => setTimeout(done, 61_000 - (now - Math.min(...recent)) + 250));
  }
}

/** Sign a person in on a context of their own, waiting for a turn. For a spec that needs a session it may end (signing out); every other spec uses `as`. */
export async function signIn(context: BrowserContext, person: string): Promise<void> {
  const state = stand();
  const who = person === "owner" ? { email: state.owner.email, password: state.owner.password } : { email: state.people[person]?.email, password: state.staffPassword };
  if (who.email === undefined) throw new Error(`the sample has no "${person}"`);
  for (let tries = 0; ; tries += 1) {
    await takeTurn();
    const res = await context.request.post("/api/v1/auth/login", { data: who });
    // Somebody else on this address used the minute's sign-ins (the stand making its owner, an earlier run): wait for the server's own clock.
    if (res.status() === 429 && tries < 3) {
      const resetAt = ((await res.json()) as { error?: { details?: { resetAt?: string } } }).error?.details?.resetAt;
      await new Promise((done) => setTimeout(done, Math.max(1000, (resetAt === undefined ? Date.now() + 60_000 : new Date(resetAt).getTime()) - Date.now() + 500)));
      continue;
    }
    expect(res.status(), `${person} signs in: ${await res.text()}`).toBe(200);
    return;
  }
}

/** The file a person's cookies are kept in, signing them in if they have not been. `owner` is the install's owner. */
export async function authOf(browser: Browser, person: string): Promise<string> {
  const state = stand();
  const file = join(AUTH_DIR, `${person}.json`);
  if (existsSync(file)) return file;
  mkdirSync(AUTH_DIR, { recursive: true });
  const context = await browser.newContext({ baseURL: state.url });
  await signIn(context, person);
  await context.storageState({ path: file });
  await context.close();
  return file;
}

export interface Who {
  /** A browser context signed in as this person. Closed with the test. */
  as: (person: string, options?: BrowserContextOptions) => Promise<BrowserContext>;
  /** The same person with no page: for a direct call to the server. */
  api: (person: string) => Promise<APIRequestContext>;
  stand: StandState;
  /** The address of a table's rows, by the app's short name. */
  data: (ref: string, rest?: string) => string;
}

export const test = base.extend<Who>({
  stand: async ({}, use) => {
    await use(stand());
  },
  as: async ({ browser }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (person, options = {}) => {
      const context = await browser.newContext({ baseURL: stand().url, storageState: await authOf(browser, person), ...options });
      opened.push(context);
      return context;
    });
    for (const context of opened) await context.close();
  },
  api: async ({ browser }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (person) => {
      const context = await browser.newContext({ baseURL: stand().url, storageState: await authOf(browser, person) });
      opened.push(context);
      return context.request;
    });
    for (const context of opened) await context.close();
  },
  data: async ({}, use) => {
    const state = stand();
    await use((ref, rest = "") => {
      const real = state.tables[`crm_${ref}`];
      if (real === undefined) throw new Error(`the install has no table crm_${ref}`);
      return `/api/v1/data/${state.connectionId}/${encodeURIComponent(real)}${rest}`;
    });
  },
});
/** Keep a picture of what a gate is shown, when `CRM_PROOF_OUT` names a folder for them. */
export async function picture(page: { screenshot: (options: { path: string; fullPage: boolean }) => Promise<unknown> }, name: string): Promise<void> {
  const out = process.env.CRM_PROOF_OUT;
  if (out === undefined || out === "") return;
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
}

export { expect };
