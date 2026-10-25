/**
 * Who is on a deal, by the CONSOLE's door (Adminium's own dashboard, which the stand serves at `/`). The CRM's own deal
 * room does the same from the staff side (`y-deal-room.e2e.ts`); this is the console's record of a deal, its "Deal
 * members" tab, and the console's page of the people on deals.
 *
 * Dana adds Sam to one of her deals; Sam, now on it, opens it and is refused when he tries to add Leo; Dana takes Sam
 * off; and the install's owner, trying to put Lena Fischer (the marketer, whose role opens no deal) on it, is refused
 * with the field marked.
 *
 * The deal is the spec's own ("W3 console members"), so nothing the ledger counts moves; at the end it is put out of
 * every figure as the deal room's spec does (handed to the install's owner and closed as lost), its people taken off.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { authOf, expect, picture, stand, test } from "./fixtures.ts";
import { csrf, rows, type Data } from "./helpers.ts";
import { me, room } from "./p12-helpers.ts";

const NAME = "W3 console members";

interface Member {
  id: number;
  deal_id: number;
  user_id: string;
  added_by_id: string;
}

/** Dana's deal for this file: made once through the server as she would make it, found again after. */
async function dealOf(dana: APIRequestContext, data: Data, me: string): Promise<number> {
  const found = await rows<{ id: number; state: string }>(dana, data, "deals", { and: [{ column: "name", op: "eq", value: NAME }, { column: "state", op: "eq", value: "open" }] });
  if (found.length > 0) return found[0]!.id;
  const stages = await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const ines = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Ines Vaughan" }))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name: NAME, company_id: ines.company_id, contact_id: ines.id, owner_id: me, stage_id: stages[0]!.id, typed_amount: 4000, expected_close: "2026-09-30" } }, headers: await csrf(dana) });
  expect(made.status(), await made.text()).toBe(201);
  return ((await made.json()) as { data: { id: number } }).data.id;
}

const members = (person: APIRequestContext, data: Data, deal: number): Promise<Member[]> => rows<Member>(person, data, "deal_members", { column: "deal_id", op: "eq", value: deal });

/** The console's record of a deal, on its "Deal members" tab (the console names the tab after the table). */
async function membersTab(page: Page, deal: number): Promise<void> {
  await page.goto(`/p/crm-deals/r/${String(deal)}`);
  await expect(page.getByRole("heading", { name: NAME, level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: /Deal Members/ }).click();
}

/**
 * Put the spec's deals out of every figure a later spec reads, as the CRM admin: their people taken off, their follow-ups
 * removed, the deal handed to the install's owner and closed as lost (the deal room's way: a deal that has lived a minute
 * holds rows only the app's rules write, and is not deleted).
 */
async function retire(admin: APIRequestContext, data: Data, ownerId: string): Promise<void> {
  const headers = await csrf(admin);
  const reason = (await rows<{ id: number }>(admin, data, "lost_reasons", undefined, "&order=position"))[0]!;
  for (const deal of await rows<{ id: number; owner_id: string }>(admin, data, "deals", { and: [{ column: "name", op: "like", value: `${NAME}%` }, { column: "state", op: "eq", value: "open" }] })) {
    for (const member of await members(admin, data, deal.id)) expect((await admin.delete(data("deal_members", `/${String(member.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    for (const step of await rows<{ id: number }>(admin, data, "follow_ups", { column: "deal_id", op: "eq", value: deal.id })) {
      expect((await admin.delete(data("follow_ups", `/${String(step.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
    if (deal.owner_id !== ownerId) expect((await admin.post(data("deals", `/${String(deal.id)}/actions/hand-over`), { data: { from: "open", values: { owner_id: ownerId } }, headers })).status()).toBe(200);
    expect((await admin.post(data("deals", `/${String(deal.id)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id } }, headers })).status()).toBe(200);
  }
}

test.afterAll(async ({ browser }) => {
  const state = stand();
  const open = async (person: string) => browser.newContext({ baseURL: state.url, storageState: await authOf(browser, person) });
  const owner = await open("owner");
  const admin = await open("tessa");
  const data: Data = (ref, rest = "") => `/api/v1/data/${state.connectionId}/${encodeURIComponent(state.tables[`crm_${ref}`]!)}${rest}`;
  await retire(admin.request, data, await me(owner.request));
  await owner.close();
  await admin.close();
});

/*
 * THE WALK'S FIRST STEP, KNOWN TO FAIL TODAY (engine 0.3.35). The console's "New row" on a deal's Deal members tab asks
 * a rep for "Since" and "Added by" (marked required: the app fills both, the console's form does not know it), and when
 * she fills them the server refuses her those two columns (COLUMN_FORBIDDEN, create-limit: she may give deal_id, user_id
 * and role_note). The People on deals page asks the same. So no rep can put anybody on a deal in the console. "Person"
 * is also a box for a user id, not a choice of people. `test.fail` keeps the step as the walk says it; when the console
 * is mended this test passes, Playwright reports it, and the line comes out.
 */
test("Dana opens one of her deals in the console and adds Sam under Deal members", async ({ as, data, stand }) => {
  test.fail(true, "engine: the console's New row asks a rep for the columns the app fills (Since, Added by) and the server refuses them to her");
  const context = await as("dana");
  const dana = context.request;
  await room(dana, data, 60);
  const deal = await dealOf(dana, data, stand.people["dana"]!.id);
  for (const member of await members(dana, data, deal)) await dana.delete(data("deal_members", `/${String(member.id)}?confirm=true`), { headers: await csrf(dana) });
  const page = await context.newPage();
  await membersTab(page, deal);
  await page.getByRole("tabpanel").getByRole("button", { name: "New row" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Person")).toBeVisible();
  await dialog.getByLabel("Person").fill(stand.people["sam"]!.id);
  await dialog.getByRole("button", { name: /^Create/ }).click();
  // What the walk expects: the dialog closes and Sam is listed on the deal, added by Dana.
  await expect(dialog).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole("tabpanel").getByRole("row").filter({ hasText: stand.people["sam"]!.id })).toHaveCount(1);
  expect((await members(dana, data, deal)).map((one) => [one.user_id, one.added_by_id])).toEqual([[stand.people["sam"]!.id, stand.people["dana"]!.id]]);
});

test("Sam, put on the deal, opens it in the console and tries to add Leo: refused, and nobody is added", async ({ as, data, stand }) => {
  const danaContext = await as("dana");
  const dana = danaContext.request;
  await room(dana, data, 40);
  const deal = await dealOf(dana, data, stand.people["dana"]!.id);
  const samId = stand.people["sam"]!.id;
  const leoId = stand.people["leo"]!.id;
  // Sam is put on the deal by the CRM's own door (the deal room's "Add someone", the same write): the console's own door
  // is the test above, which fails today.
  if (!(await members(dana, data, deal)).some((one) => one.user_id === samId)) {
    const added = await dana.post(data("deal_members"), { data: { values: { deal_id: deal, user_id: samId } }, headers: await csrf(dana) });
    expect(added.status(), await added.text()).toBe(201);
  }
  const samContext = await as("sam");
  const sam = samContext.request;
  await room(sam, data, 40);
  const page = await samContext.newPage();
  // Script errors only: the console asks for things a rep may not read (it logs those 403s and 404s itself).
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  // He reaches the deal from the console's Deals, now that he is on it.
  await page.goto("/p/crm-deals");
  await page.getByRole("row").filter({ hasText: NAME }).first().click();
  await expect(page).toHaveURL(new RegExp(`/p/crm-deals/r/${String(deal)}$`));
  await page.getByRole("tab", { name: /Deal Members/ }).click();
  const tab = page.getByRole("tabpanel");
  await expect(tab.getByRole("row").filter({ hasText: samId })).toHaveCount(1);
  await picture(page, "zw-sam-console-deal-members");
  // He tries to add Leo: the dialog does not take it, and nothing is written.
  await tab.getByRole("button", { name: "New row" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Person").fill(leoId);
  await dialog.getByRole("button", { name: /^Create/ }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(tab.getByRole("row").filter({ hasText: leoId })).toHaveCount(0);
  // The server's own answer to the add as the console sends it, the columns he may give and no more: refused, because
  // somebody on a deal puts nobody else on it.
  const refused = await sam.post(data("deal_members"), { data: { values: { deal_id: deal, user_id: leoId } }, headers: await csrf(sam) });
  expect(refused.status(), await refused.text()).toBe(403);
  expect((await members(dana, data, deal)).map((one) => one.user_id)).toEqual([samId]);
  expect(problems).toEqual([]);
});

test("Dana takes Sam off in the console: the row opens, Delete, typed to confirm; the deal closes to him again", async ({ as, data, stand }) => {
  const context = await as("dana");
  const dana = context.request;
  await room(dana, data, 40);
  const deal = await dealOf(dana, data, stand.people["dana"]!.id);
  const samId = stand.people["sam"]!.id;
  if (!(await members(dana, data, deal)).some((one) => one.user_id === samId)) {
    expect((await dana.post(data("deal_members"), { data: { values: { deal_id: deal, user_id: samId } }, headers: await csrf(dana) })).status()).toBe(201);
  }
  const row = (await members(dana, data, deal)).find((one) => one.user_id === samId)!;
  const sam = (await as("sam")).request;
  expect((await sam.get(data("deals", `/${String(deal)}`))).status()).toBe(200);

  const page = await context.newPage();
  await membersTab(page, deal);
  await page.getByRole("tabpanel").getByRole("row").filter({ hasText: samId }).getByRole("cell").nth(3).click();
  await expect(page).toHaveURL(new RegExp(`/p/crm-deal-members/r/${String(row.id)}$`));
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog");
  // The console asks for the row's number before it removes it.
  await expect(confirm).toContainText(`Type ${String(row.id)} to confirm`);
  await expect(confirm.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await confirm.getByRole("textbox").fill(String(row.id));
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect.poll(async () => (await members(dana, data, deal)).length).toBe(0);
  // Off the deal, he no longer reads it: the server answers him as for a deal that is not there.
  expect((await sam.get(data("deals", `/${String(deal)}`))).status()).toBe(404);
});

test("the install's owner tries to put Lena Fischer, the marketer, on the deal: refused, with Person marked", async ({ as, data, stand }) => {
  // Dana's deal, for the owner to pick.
  await dealOf((await as("dana")).request, data, stand.people["dana"]!.id);
  const context = await as("owner");
  const owner = context.request;
  await room(owner, data, 40);
  const page = await context.newPage();
  const lenaId = stand.people["lena"]!.id;
  // The console's page of the people on deals (its deal tab says nothing on a refusal: see the report).
  await page.goto("/p/crm-deal-members");
  await page.getByRole("button", { name: "New row" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("New Person on a deal");
  await dialog.getByRole("combobox").first().click();
  await page.keyboard.type(NAME);
  await page.getByRole("option", { name: new RegExp(NAME) }).first().click();
  await dialog.getByLabel("Person").fill(lenaId);
  // The console asks for the two columns the app fills; the owner may give them (the app fills them over).
  await dialog.getByLabel("Since").fill("2026-07-28");
  await dialog.getByLabel("Added by").fill(stand.people["dana"]!.id);
  const [reply] = await Promise.all([page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/api/v1/")), dialog.getByRole("button", { name: /^Create/ }).click()]);
  expect(reply.status()).toBe(422);
  expect(((await reply.json()) as { error: { details: { fields: Record<string, { code: string }> } } }).error.details.fields["user_id"]?.code).toBe("cannot-open");
  // The field is marked, with words under it; the dialog stays, and nothing is written.
  const person = dialog.getByLabel("Person");
  await expect(person).toHaveAttribute("aria-invalid", "true");
  await expect(dialog).toContainText("This value is not valid here.");
  await picture(page, "zw-owner-lena-refused");
  expect(await rows(owner, data, "deal_members", { column: "user_id", op: "eq", value: lenaId })).toEqual([]);
});
