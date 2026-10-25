/**
 * What the console walks share: Adminium's own words in the reader's language, a person's language set and put back,
 * and the stand's clock read and moved.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { APIRequestContext } from "@playwright/test";

import { expect, stand } from "./fixtures.ts";
import { csrf, STAFF } from "./helpers.ts";
import { readState } from "./stand.mjs";

export type ConsoleLocale = "en-US" | "ar-EG" | "de-DE";

const loaded = new Map<string, unknown>();

function namespace(locale: ConsoleLocale, ns: string): unknown {
  const file = join(stand().adminiumRepo, "packages", "i18n", "locales", locale, `${ns}.json`);
  if (!loaded.has(file)) loaded.set(file, JSON.parse(readFileSync(file, "utf8")) as unknown);
  return loaded.get(file);
}

function lookup(locale: ConsoleLocale, key: string): string | undefined {
  const at = key.indexOf(":");
  const [ns, path] = at < 1 ? ["common", key] : [key.slice(0, at), key.slice(at + 1)];
  let node = namespace(locale, ns);
  for (const part of path.split(".")) node = typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  return typeof node === "string" ? node : undefined;
}

/**
 * The console's own words for a key (`roles:rows.title`, or `team.title` for the common namespace), in a language, read
 * from the locale files the dashboard is built from: the same bytes it draws. A plural takes its branch by the language's
 * own rules (`count`). A key the language has not translated is refused: the walk is that it IS translated.
 */
export function words(locale: ConsoleLocale): (key: string, params?: Record<string, string | number>) => string {
  const rules = new Intl.PluralRules(locale);
  const number = new Intl.NumberFormat(locale);
  return (key, params = {}) => {
    const found = lookup(locale, key);
    if (found === undefined) throw new Error(`${locale} has no string at "${key}"`);
    const plural = found.replace(/\{(\w+), plural,((?:\s*\w+\s*\{[^{}]*\})+)\s*\}/g, (_whole, name: string, branches: string) => {
      const count = Number(params[name]);
      const options = Object.fromEntries([...branches.matchAll(/(\w+)\s*\{([^{}]*)\}/g)].map((one) => [one[1], one[2]]));
      const chosen = options[`=${String(count)}`] ?? options[rules.select(count)] ?? options["other"] ?? "";
      return chosen.replace(/#/g, number.format(count));
    });
    // A plural's "#" is written as the language writes numbers (Arabic digits in Arabic); a plain `{n}` is not, as the console's formatter does.
    return plural.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
  };
}

/** Adminium's locale names, as a person's preference holds them. */
const PREF: Record<ConsoleLocale, string> = { "en-US": "en_US", "ar-EG": "ar_EG", "de-DE": "de_DE" };

/** Run something with a person reading the console in a language (their own preference), and give them English back after. */
export async function inLanguage(person: APIRequestContext, locale: ConsoleLocale, run: () => Promise<void>): Promise<void> {
  const headers = await csrf(person);
  if (locale !== "en-US") expect((await person.patch("/api/v1/me/prefs", { data: { locale: PREF[locale] }, headers })).status()).toBe(200);
  try {
    await run();
  } finally {
    let back = 0;
    for (let round = 0; round < 4; round += 1) {
      back = (await person.patch("/api/v1/me/prefs", { data: { locale: "en_US" }, headers })).status();
      if (back !== 429) break;
      await new Promise((done) => setTimeout(done, 20_000));
    }
    expect(back, "the person's language is put back").toBe(200);
  }
}

/** The stand's "now", as the server tells the app (the staff config's `now`), in ms. */
export async function standNow(person: APIRequestContext): Promise<number> {
  const config = (await (await person.get(`${STAFF}surface-config.json`)).json()) as { now?: string | number };
  const now = typeof config.now === "number" ? config.now : Date.parse(String(config.now));
  expect(Number.isFinite(now), `the staff config says when now is: ${JSON.stringify(config.now)}`).toBe(true);
  return now;
}

/**
 * Move the stand's clock to a moment, running on from there (the stand's own signal, as `ledgerClock`). A stand on the real
 * clock cannot be moved: answers false.
 */
export function moveStandClock(at: number): boolean {
  const state = readState() as { pid: number; work: string; startedAt: string | null } | null;
  if (state === null || state.startedAt === null) return false;
  writeFileSync(join(state.work, "clock"), String(at));
  process.kill(state.pid, "SIGUSR2");
  return true;
}

/** Asks until `check` holds, at most `ms`; answers the last value read. */
export async function until<T>(read: () => Promise<T>, check: (value: T) => boolean, ms = 30_000, every = 1000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (check(value) || Date.now() > deadline) return value;
    await new Promise((done) => setTimeout(done, every));
  }
}
