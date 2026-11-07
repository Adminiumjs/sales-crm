/** What the selling specs share: the app's address, a person's write token, a row by its name, and putting the sample back. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { request, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { expect } from "./fixtures.ts";
import { LEDGER_NOW, readState, STAND_DIR } from "./stand.mjs";

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

/** A box once it has stopped moving: read, wait a frame, read again, until two reads agree (a board that is still scrolling or laying out moves under the pointer). */
async function settledBox(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let before = await target.boundingBox();
  for (let tries = 0; tries < 40; tries += 1) {
    await target.page().evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const now = await target.boundingBox();
    if (before !== null && now !== null && Math.abs(now.x - before.x) < 0.5 && Math.abs(now.y - before.y) < 0.5 && Math.abs(now.width - before.width) < 0.5 && Math.abs(now.height - before.height) < 0.5) return now;
    before = now;
  }
  throw new Error("the box never stopped moving");
}

/** Which column the board has the held card over (`data-over`), once the frame after the last pointer move is drawn; null for none. */
async function columnOver(page: Page): Promise<string | null> {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const over = await page.locator("[data-board-column][data-over]").evaluateAll((all) => all.map((one) => one.getAttribute("data-board-column")));
  return over[0] ?? null;
}

/** Until the page has drawn nothing new for 400 ms (at most 10 s): a board that has just saved a move redraws its cards once more when the server's rows come back. */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let timer = 0;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = window.setTimeout(finish, 400);
        });
        const finish = () => {
          observer.disconnect();
          done();
        };
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        timer = window.setTimeout(finish, 400);
        window.setTimeout(finish, 10_000);
      }),
  );
}

/**
 * Drag a board's card onto a column with the mouse, as a person does, and let go only while the board has that column as the
 * one the card is over (`data-over`): never on the column the pointer was merely aimed at.
 *
 * Why not "aim at the column's middle and let go". A board that has just saved a move draws its cards again when the server's
 * rows come back; on a slower machine (the CI runner; here, the CPU slowed 4×) a card picked up in between is the card of the
 * old drawing, and the board then measures the new one, a column on. The held card (its overlay) rides that far ahead of the
 * pointer, and the board chooses the column by the held card's corners (dnd-kit's closest corners), not by the pointer, so it
 * drops a column too far. So: the board is left to finish drawing, the target is brought to the middle of the board (no
 * sideways auto-scroll) and every box is read once it has stopped moving; the card is picked up again if the board did not
 * start a drag (`data-dragging`); and while it is held the pointer tries places over the target until the board says the
 * target. A drag the board loses (the held card stops following the
 * pointer) is called off (Escape) and made again; after three, the spec fails here, having moved nothing.
 */
export async function dragCardTo(page: Page, card: Locator, target: Locator): Promise<void> {
  const want = await target.getAttribute("data-board-column");
  let last: string | null = null;
  // A drag the board loses track of (the card drawn again under it while it is held: the held card then stops following the
  // pointer) is called off and made again from the start, up to three times.
  for (let drags = 0; drags < 3; drags += 1) {
    last = await dragOnce(page, card, target, want);
    if (last === want) return;
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.keyboard.press("Escape");
  }
  throw new Error(`the drag never had column ${String(want)} under the card (the board had it over ${String(last)}); called off, nothing moved`);
}

/** One drag of `dragCardTo`: the column the card was let go on (the target), or, with the button still held, the one it was over instead. */
async function dragOnce(page: Page, card: Locator, target: Locator, want: string | null): Promise<string | null> {
  let x = 0;
  let y = 0;
  for (let picks = 0; ; picks += 1) {
    await quiet(page);
    await card.scrollIntoViewIfNeeded();
    await target.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "center" }));
    await settledBox(target);
    const from = await settledBox(card);
    [x, y] = [from.x + from.width / 2, from.y + from.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Past the board's 4px start, so the drag is on before it travels.
    await page.mouse.move(x + 12, y + 6, { steps: 3 });
    if ((await page.locator("[data-board-card][data-dragging]").count()) > 0) break;
    // The card was drawn again under the pointer: nothing was picked up. Let go (closing anything that opened) and pick it up again.
    await page.mouse.up();
    await page.keyboard.press("Escape");
    if (picks === 3) throw new Error("the board never started a drag of the card");
  }
  // Where on the target to hold it. The board compares the held card's four corners with each column's (closest corners): a
  // column much shorter than the target (an emptier one beside it) wins while the held card is high, and the held card (280
  // wide, drawn from where it was picked up) need not be centred on the pointer, so the middle of the target is not always
  // the target's. The pointer tries the target's middle first, then a little either side and higher and lower, and lets go
  // at the first place the board names the target. (On the CI runner the middle at a card's height from the top said the
  // column to the right, and one column to the left said the column to the left: no full column's step finds it.)
  const tries: [number, number][] = [[0, 0.5], [-70, 0.5], [70, 0.5], [-140, 0.5], [140, 0.5], [0, 0.75], [-70, 0.75], [70, 0.75], [-140, 0.75], [0, 0.3], [-70, 0.3], [70, 0.3], [-140, 0.3]];
  let over: string | null = null;
  for (const [dx, at] of tries) {
    // The board may still be scrolling itself (it follows a card it has just drawn): read where the target is once it is still.
    const aim = await settledBox(target);
    const bottom = Math.min(aim.y + aim.height, (page.viewportSize()?.height ?? 720) - 8);
    x = aim.x + aim.width / 2 + Math.max(-aim.width / 2 + 8, Math.min(aim.width / 2 - 8, dx));
    y = Math.max(aim.y + 24, Math.min(bottom - 24, aim.y + (bottom - aim.y) * at));
    await page.mouse.move(x, y, { steps: 6 });
    over = await columnOver(page);
    if (over === want) {
      await settledBox(target);
      if ((await columnOver(page)) === want) {
        await page.mouse.up();
        return want;
      }
    }
  }
  return over;
}

/**
 * Put a deal back in a stage by the server, whatever the test that moved it got to. Each spec that moves a sample deal runs this
 * after every test (`test.afterEach`), so one card left in the wrong column cannot change the figures every later spec reads.
 */
export async function putDealBack(person: APIRequestContext, data: Data, name: string, stageId: number): Promise<void> {
  const deal = await dealNamed(person, data, name);
  if (deal.stage_id === stageId) return;
  const res = await person.patch(data("deals", `/${String(deal.id)}`), { data: { values: { stage_id: stageId } }, headers: await csrf(person) });
  expect(res.status(), `${name} back to stage ${String(stageId)}: ${await res.text()}`).toBe(200);
}

/** Run something with a person reading Arabic (their own setting in Adminium), and give them English back afterwards. */
export async function inArabic(person: APIRequestContext, run: () => Promise<void>): Promise<void> {
  const headers = await csrf(person);
  expect((await person.patch("/api/v1/me/prefs", { data: { locale: "ar_EG" }, headers })).status()).toBe(200);
  try {
    await run();
  } finally {
    // Put back for the specs that follow, whatever: a refusal for too many requests waits out the minute and asks again,
    // or every later spec as this person reads Arabic (seen 2026-10-22: one 429 here failed 24 specs after it).
    let back = 0;
    for (let round = 0; round < 4; round += 1) {
      back = (await person.patch("/api/v1/me/prefs", { data: { locale: "en_US" }, headers })).status();
      if (back !== 429) break;
      await new Promise((done) => setTimeout(done, 20_000));
    }
    expect(back, "the person's language is put back").toBe(200);
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

/**
 * Puts the stand's clock back at the ledger's moment (09:35 on Tuesday 28 July), running on from there. The clock runs
 * while the specs before a file do, and the whole of stage 3 takes long enough to carry it past a follow-up due at 10:00:
 * a spec whose figures are the ledger's at 09:35 (Today, This week) starts its file here. A stand on the real clock is
 * left as it is. (The stand itself sets the clock the same way while the sample goes in: `e2e/clock.mjs`.)
 */
export function ledgerClock(): void {
  const state = readState() as { pid: number; work: string; startedAt: string | null } | null;
  if (state === null || state.startedAt === null) return;
  writeFileSync(join(state.work, "clock"), String(Date.parse(LEDGER_NOW)));
  process.kill(state.pid, "SIGUSR2");
}
