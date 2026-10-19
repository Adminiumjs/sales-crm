/**
 * The account manager on an open deal (ruling R6, T37; P23's "Hugo on d1"): Hugo reads every won deal, and an open
 * one only while he is listed on it. Listed on Dana's d1, he opens its room, reads its quote and comments on it; taken
 * off, the deal is gone for him again. A won deal he is not on he reads and comments on none of: no box, and the server
 * refuses the write. Every "may not" is also asked of the server directly.
 *
 * The spec's comment and Hugo's place on d1 are taken away at the end, so no figure another spec reads moves.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { csrf, dealNamed, rows, STAFF, watch } from "./helpers.ts";

const userId = async (person: APIRequestContext): Promise<string> => ((await (await person.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;

test("the account manager on an open deal: listed, he reads it and its quote and comments on it; off it, it is gone; a won deal he is not on takes no comment from him", async ({ as, api, data }) => {
  const dana = await api("dana");
  const danaHeaders = await csrf(dana);
  const hugo = await api("hugo");
  const hugoHeaders = await csrf(hugo);
  const hugoId = await userId(hugo);
  const d1 = await dealNamed(dana, data, "Fourth-floor desk rows");
  const d1Id = Number(d1["id"]);

  // Before he is on it: the open deal is not there for him, by the screen and by the server.
  const context = await as("hugo");
  const page = await context.newPage();
  const problems = watch(page);
  expect((await hugo.get(data("deals", `/${String(d1Id)}`))).status()).toBe(404);
  await page.goto(`${STAFF}deals/${String(d1Id)}`);
  // A record that is not his reads as not there.
  await expect(page.getByText("No deal to open")).toBeVisible();

  // Dana lists him on d1.
  const listed = await dana.post(data("deal_members"), { data: { values: { deal_id: d1Id, user_id: hugoId } }, headers: danaHeaders });
  expect(listed.status(), await listed.text()).toBe(201);
  const memberId = ((await listed.json()) as { data: { id: number } }).data.id;
  let commentId: number | null = null;
  try {
    // Listed: the room opens, with its quote; he changes nothing of the deal.
    await page.goto(`${STAFF}deals/${String(d1Id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fourth-floor desk rows");
    await expect(page.getByTestId("room-quote")).toBeVisible();
    expect((await rows(hugo, data, "quotes", { column: "deal_id", op: "eq", value: d1Id })).length).toBeGreaterThan(0);
    expect((await hugo.patch(data("deals", `/${String(d1Id)}`), { data: { values: { typed_amount: 1 } }, headers: hugoHeaders })).status()).toBe(403);

    // He comments on it.
    await page.goto(`${STAFF}deals/${String(d1Id)}/comments`);
    const box = page.locator('[data-box="new"]').getByRole("combobox");
    await expect(box).toBeVisible();
    await box.click();
    await page.keyboard.type("Their facilities lead bought from us in 2024.");
    await page.getByRole("button", { name: "Post it" }).click();
    await expect(page.locator(".crm-cmt-thread").filter({ hasText: "Their facilities lead bought from us in 2024." })).toHaveCount(1);
    const posted = await rows<{ id: number; author_id: string }>(hugo, data, "comments", { and: [{ column: "deal_id", op: "eq", value: d1Id }, { column: "author_id", op: "eq", value: hugoId }] });
    expect(posted).toHaveLength(1);
    commentId = posted[0]!.id;
  } finally {
    // Taken off d1: gone for him again.
    expect((await dana.delete(data("deal_members", `/${String(memberId)}?confirm=true`), { headers: danaHeaders })).status()).toBeLessThan(300);
  }
  expect((await hugo.get(data("deals", `/${String(d1Id)}`))).status()).toBe(404);
  expect((await hugo.post(data("comments"), { data: { values: { deal_id: d1Id, text: "not any more" } }, headers: hugoHeaders })).status()).toBe(409);

  // A won deal he is not on: he reads it, there is no box, and the server refuses a comment.
  const won = (await rows<{ id: number }>(hugo, data, "deals", { column: "state", op: "eq", value: "won" }, "&order=id"))[0]!;
  await page.goto(`${STAFF}deals/${String(won.id)}/comments`);
  await expect(page.locator(".crm-cmt-threads")).toBeVisible();
  await expect(page.locator(".crm-cmt-threads .crm-empty-title")).toHaveText("What is said on a deal is for the people working it.");
  await expect(page.locator('[data-box="new"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Post it" })).toHaveCount(0);
  expect((await hugo.post(data("comments"), { data: { values: { deal_id: won.id, text: "not mine" } }, headers: hugoHeaders })).status()).toBe(403);
  expect(problems.filter((problem) => !problem.includes("404"))).toEqual([]);

  // The spec's comment goes, by the CRM admin.
  if (commentId !== null) {
    const tessa = await api("tessa");
    expect((await tessa.delete(data("comments", `/${String(commentId)}?confirm=true`), { headers: await csrf(tessa) })).status()).toBeLessThan(300);
  }
});
