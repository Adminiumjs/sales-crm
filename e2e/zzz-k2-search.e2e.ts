/**
 * Plan 68 K2: THE "bea" SEARCH. Once, in plan 67 P26's red run, Dana's saved search "bea" (Bea at Low Orbit, the ledger's
 * one person) counted 15 deals and 9 companies.
 *
 * What a saved search went through, read path by path:
 *  - its row: the list of her searches is hers alone (private, plan 68 D9), so another person's row of the same name, or a
 *    row nobody owns, is never one of her cards;
 *  - its word: a card counts `search.query` as saved, and the box counts only once what was asked is what is typed, so a
 *    word cut short ("be") is never shown as the longer one's;
 *  - the server's answer: the screen asked each table with `q`, the server's quick search, which looks through EVERY text
 *    column of the row (`crud/filters.ts` compileQuickSearch): a staff id (`usr_` and 26 letters and digits), a stage
 *    move's key in hex, a save's retry key. Fifteen was every deal Dana owned with that run's leftovers: the three letters
 *    were in her own id, which every one of her deals names as its owner. Contacts named nobody then, and were right.
 *
 * The fix: a saved search looks through the words a person reads (a deal's name, scope and close note; a company's name,
 * town, sector, street, postal code and website; a person's name and job title), by name. This spec makes the leftovers
 * a red run leaves (a deal and a company of hers, a search of hers cut short, another person's search of the same name),
 * shows that the server's `q` finds every deal she owns and every company that is her account by three letters of her
 * id, and holds that her cards and her box never do: what the card says, every time it changes, and those three letters,
 * which find nothing. (A retry key is kept as a hash in hex, and "bea" is three hex letters: a row now and then matched
 * by that too.)
 * Run it twenty times over (`--repeat-each=20`): it is the watch the plan asks for. Last of the suite, so the requests it
 * spends as Dana are no earlier spec's.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { csrf, removeDeals, rows, STAFF, type Data } from "./helpers.ts";

const NAME = "K2 spec";
const BEA = "Bea at Low Orbit";
const BEA_LINE = "0 deals · 0 companies · 1 person";

const idOf = async (person: APIRequestContext): Promise<string> => ((await (await person.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
const total = async (person: APIRequestContext, data: Data, ref: string, query: string): Promise<number> => {
  const res = await person.get(data(ref, `?limit=1&select=id&count=exact&${query}`));
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { page: { total: number } }).page.total;
};
/** The words, as the screen now asks them of a table. */
const named = (columns: string[], word: string): string => `where=${encodeURIComponent(JSON.stringify({ or: columns.map((column) => ({ column, op: "ilike", value: `%${word}%` })) }))}`;
const WORDS: Record<string, string[]> = { deals: ["name", "scope", "close_note"], companies: ["name", "town", "sector", "address_lines", "postal_code", "website"], contacts: ["name", "job_title"] };

test("K2: a saved search counts the words a person reads, after another spec's leftovers, and nothing else", async ({ as, api, data }) => {
  const dana = await api("dana");
  const ivy = await api("ivy");
  const tessa = await api("tessa");
  const me = await idOf(dana);
  const clear = async (): Promise<void> => {
    for (const person of [dana, ivy]) {
      const headers = await csrf(person);
      for (const row of await rows<{ id: number; name: string }>(person, data, "saved_searches")) {
        if (row.name.startsWith(NAME) || (person === ivy && row.name === BEA)) expect((await person.delete(data("saved_searches", `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
      }
    }
    await removeDeals(tessa, data, NAME);
    const headers = await csrf(tessa);
    for (const row of await rows<{ id: number }>(tessa, data, "companies", { column: "name", op: "like", value: `${NAME}%` })) expect((await tessa.delete(data("companies", `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  };
  await clear();
  try {
    // ANOTHER SPEC'S LEFTOVERS, as a red run leaves them: a deal of hers and a company that is her account, a search of
    // hers whose word was cut short and was last run a moment ago, and Ivy's search with the very name of Dana's.
    const headers = await csrf(dana);
    const cobalt = (await rows<{ id: number }>(dana, data, "companies", { column: "name", op: "eq", value: "Cobalt Legal" }))[0]!.id;
    const stage = (await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position"))[0]!.id;
    const deal = await dana.post(data("deals"), { data: { values: { name: `${NAME}: plain desks`, company_id: cobalt, owner_id: me, stage_id: stage, typed_amount: 100 }, clientKey: "k2specbeabeabeabeabeabeabeabea01" }, headers });
    expect(deal.status(), await deal.text()).toBe(201);
    const company = await dana.post(data("companies"), { data: { values: { name: `${NAME}: Plain Works`, town: "Ripon", account_owner_id: me }, clientKey: "k2specbeabeabeabeabeabeabeabea02" }, headers });
    expect(company.status(), await company.text()).toBe(201);
    const now = new Date().toISOString();
    expect((await dana.post(data("saved_searches"), { data: { values: { name: `${NAME}: cut short`, query: "be", owner_id: me, last_run_at: now, pinned: false } }, headers })).status()).toBe(201);
    expect((await ivy.post(data("saved_searches"), { data: { values: { name: BEA, query: "b", owner_id: await idOf(ivy), last_run_at: now, pinned: true } }, headers: await csrf(ivy) })).status()).toBe(201);

    // The server's whole-row search (what the screen used to ask) finds by three letters of her own id every deal she owns
    // and every company that is her account: the fifteen and the nine of the red run. Three that no word of hers holds.
    const byQ = async (ref: string, word: string): Promise<string[]> => (await rows<{ name: string }>(dana, data, ref, undefined, `&select=id,name&q=${encodeURIComponent(word)}`)).map((row) => row.name);
    const letters = me.replace(/^usr_/, "");
    let word = "";
    for (let at = letters.length - 3; at >= 0 && word === ""; at -= 1) {
      const tried = letters.slice(at, at + 3);
      if (!/^[A-Za-z0-9]{3}$/.test(tried)) continue;
      const found = await Promise.all(Object.entries(WORDS).map(([ref, columns]) => total(dana, data, ref, named(columns, tried))));
      if (found.every((n) => n === 0)) word = tried;
    }
    expect(word, `three letters of ${me} no word of Dana's holds`).not.toBe("");
    const hers = await total(dana, data, "deals", `where=${encodeURIComponent(JSON.stringify({ column: "owner_id", op: "eq", value: me }))}`);
    expect(hers).toBeGreaterThanOrEqual(14);
    expect((await byQ("deals", word)).length).toBeGreaterThanOrEqual(hers);
    expect(await byQ("deals", word)).toContain(`${NAME}: plain desks`);
    const accounts = await total(dana, data, "companies", `where=${encodeURIComponent(JSON.stringify({ column: "account_owner_id", op: "eq", value: me }))}`);
    expect(accounts).toBeGreaterThanOrEqual(4);
    expect((await byQ("companies", word)).length).toBeGreaterThanOrEqual(accounts);

    // HER SCREEN. Every line any card shows is kept from the first paint: a card never says something else, even for a moment.
    const context = await as("dana");
    const page = await context.newPage();
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { k2Seen: string[] }).k2Seen = seen;
      const look = (): void => {
        for (const card of Array.from(document.querySelectorAll(".crm-view[data-search]"))) {
          const line = `${card.querySelector(".crm-view-name")?.textContent ?? ""}=${card.querySelector("[data-testid='search-breakdown']")?.textContent ?? ""}`;
          if (seen[seen.length - 1] !== line && !seen.includes(line)) seen.push(line);
        }
        const box = document.querySelector("[data-testid='search-count']");
        if (box !== null) seen.push(`box=${box.textContent ?? ""}`);
      };
      new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.goto(`${STAFF}saved-searches`);
    const cards = page.locator(".crm-view[data-search]");
    // Her five, and the one cut short: Ivy's of the same name is not hers.
    await expect(cards).toHaveCount(6);
    await expect(cards.filter({ hasText: BEA })).toHaveCount(1);
    const bea = cards.filter({ hasText: BEA });
    await expect(bea.getByTestId("search-breakdown")).toHaveText(BEA_LINE);
    await expect(bea.locator(".crm-pill").first()).toHaveText("bea");
    // Every card's line, as each changed: Bea's never said anything but the one person.
    const seen = (): Promise<string[]> => page.evaluate(() => (window as unknown as { k2Seen: string[] }).k2Seen);
    for (const line of (await seen()).filter((one) => one.startsWith(`${BEA}=`))) expect(line).toBe(`${BEA}=${BEA_LINE}`);

    // The box: a word typed letter by letter is counted for the whole word, never as the shorter one.
    const box = page.getByRole("searchbox", { name: "Search for" });
    await box.fill("be");
    await box.press("a");
    await expect(page.getByTestId("search-count")).toHaveText(BEA_LINE);
    await expect(page.getByTestId("search-found").locator("li")).toHaveCount(1);
    // Three letters of her own id: nothing, where the whole-row search found every deal she owns.
    await box.fill(word);
    await expect(page.getByTestId("search-found")).toContainText("Nothing matches that");
    // (Not run from its card: that stamps when it was last run, which the ledger's order of her searches reads.)
    for (const line of (await seen()).filter((one) => one.startsWith(`${BEA}=`))) expect(line).toBe(`${BEA}=${BEA_LINE}`);
    await page.close();
  } finally {
    await clear();
  }
});
