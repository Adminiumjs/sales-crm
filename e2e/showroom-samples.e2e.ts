/**
 * P19, the samples, the display stock and the follow-ups WRITTEN: booking a
 * sample out and back in, a chase, the server refusing a loan the shelf
 * cannot give, a tired piece swapped out, a visit written up and its next
 * step done. Stage 2's part: run with `CRM_STAND_STAGE=2`.
 *
 * Each spec puts back what it changed (a loan and its chases removed, a
 * piece's day and range as they were, a booking's write-up as it was), so
 * the ledger's figures hold for the next one.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch, type Data } from "./helpers.ts";

test.skip(Number(process.env.CRM_STAND_STAGE ?? "1") < 2, "the showroom arrives with stage 2: run with CRM_STAND_STAGE=2");

const chip = (page: Page, filter: string) => page.locator(`.crm-chip-btn[data-filter="${filter}"] .crm-chip-count`);
const stat = (page: Page, name: string) => page.locator(`.crm-sh-stat[data-stat="${name}"]`);
const named = async <R extends { id: number }>(person: APIRequestContext, data: Data, ref: string, name: string): Promise<R> => (await rows<R>(person, data, ref, { column: "name", op: "eq", value: name }))[0]!;

test("a sample booked out and back in: the shelf, the returns chase and a chase follow the server; a loan past the shelf is refused", async ({ as, api, data }) => {
  const context = await as("corin");
  const page = await context.newPage();
  const problems = watch(page);
  const admin = await api("tessa");
  const headers = await csrf(admin);
  const boards = await named<{ id: number }>(admin, data, "samples", "Desk finish boards, oak and ash");
  const before = await rows<{ id: number }>(admin, data, "sample_loans", { column: "sample_id", op: "eq", value: boards.id });
  try {
    await page.goto(`${STAFF}samples`);
    const card = page.locator(".crm-sh-sample", { hasText: "Desk finish boards, oak and ash" });
    await expect(card.locator(".crm-sh-held")).toHaveText("4 held · 4 on the shelf");
    await card.getByRole("button", { name: "Book out Desk finish boards, oak and ash" }).click();
    const panel = page.getByTestId("sh-lend");
    await expect(panel).toContainText("Who is it going to? Back in 14 days.");
    await panel.getByLabel("Find a contact").fill("Tomas");
    await panel.getByLabel("Going to").selectOption({ label: "Tomas Reidy · Cobalt Legal" });
    await panel.getByRole("button", { name: "Book it out" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Desk finish boards, oak and ash out to Cobalt Legal, back on Tue, Aug 11.");
    await expect(card.locator(".crm-sh-held")).toHaveText("4 held · 3 on the shelf");
    await expect(page.getByTestId("sh-lib-line")).toContainText("22 pieces held: 5 out, 17 on the shelf.");
    await expect(chip(page, "out")).toHaveText("5");
    await expect(chip(page, "in")).toHaveText("3");
    await picture(page, "sh-10-library-lent");

    // On the returns chase: five pieces across the same three accounts; chase it, and the chase is logged.
    await page.goto(`${STAFF}sample-returns`);
    await expect(stat(page, "out").locator(".crm-sh-value")).toHaveText("5");
    await expect(stat(page, "out").locator(".crm-sh-stat-note")).toHaveText("pieces across 4 accounts");
    const row = page.locator(".crm-sh-card", { hasText: "Desk finish boards, oak and ash" });
    await expect(row.getByTestId("sh-ret-state")).toHaveText("due Tue, Aug 11");
    await row.getByRole("button", { name: "Chase it" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Chase logged against Desk finish boards, oak and ash.");
    await expect(row.locator(".crm-sh-chases li")).toHaveText([/Chased by Corin/]);
    await expect(stat(page, "longest").locator(".crm-sh-stat-note")).toHaveText("Low Orbit · 4 chases logged");
    // It came back: off the chase, on the shelf.
    await row.getByRole("button", { name: "It came back" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Desk finish boards, oak and ash is back on the shelf.");
    await expect(row).toHaveCount(0);
    await expect(stat(page, "out").locator(".crm-sh-value")).toHaveText("4");
    const kept = await named<{ id: number; out: number; on_shelf: number }>(context.request, data, "samples", "Desk finish boards, oak and ash");
    expect([Number(kept.out), Number(kept.on_shelf)]).toEqual([0, 4]);

    // The panels' one piece is out: the server refuses a second loan, whoever asks, the CRM admin too.
    const panels = await named<{ id: number }>(admin, data, "samples", "Acoustic panel set");
    const refused = await admin.post(data("sample_loans"), { data: { values: { sample_id: panels.id, out_on: "2026-07-28", due_back: "2026-08-11" } }, headers });
    expect(refused.status()).toBeGreaterThanOrEqual(400);
    expect(await refused.text()).toContain("BALANCE_EXCEEDED");
    // Read-only lends nothing, and the operations manager reads no loan.
    const grace = await api("grace");
    expect((await grace.post(data("sample_loans"), { data: { values: { sample_id: boards.id, out_on: "2026-07-28", due_back: "2026-08-11" } }, headers: await csrf(grace) })).status()).toBe(403);
    expect((await (await api("ada")).get(data("sample_loans", "?limit=1"))).status()).toBe(403);
    expect(problems).toEqual([]);
  } finally {
    for (const loan of await rows<{ id: number }>(admin, data, "sample_loans", { column: "sample_id", op: "eq", value: boards.id })) {
      if (before.some((one) => one.id === loan.id)) continue;
      for (const chased of await rows<{ id: number }>(admin, data, "sample_chases", { column: "loan_id", op: "eq", value: loan.id })) await admin.delete(data("sample_chases", `/${String(chased.id)}?confirm=true`), { headers });
      expect((await admin.delete(data("sample_loans", `/${String(loan.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
  }
});

test("a tired piece is swapped out: the clock starts again and the count of tired pieces falls; put back as it was", async ({ as, api, data }) => {
  const admin = await api("tessa");
  const frame = await named<{ id: number; out_since: string; spec: string }>(admin, data, "display_pieces", "Sit-stand frame, single");
  try {
    const page = await (await as("corin")).newPage();
    await page.goto(`${STAFF}display-stock`);
    await expect(stat(page, "tired").locator(".crm-sh-value")).toHaveText("2");
    const card = page.locator(".crm-sh-card", { hasText: "Sit-stand frame, single" });
    await card.getByRole("button", { name: "Swap it out" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Sit-stand frame, single swapped for a fresh one today.");
    await expect(stat(page, "tired").locator(".crm-sh-value")).toHaveText("1");
    await expect(card.locator(".crm-sh-age")).toHaveText("out this month");
    await expect(card.getByText("Not current spec")).toHaveCount(0);
    await expect(page.getByTestId("sh-floor-tired")).toHaveText("Meeting table, welded frame is the one to change. It has been out 11 months.");
    const now = await named<{ id: number; out_since: string; spec: string }>(admin, data, "display_pieces", "Sit-stand frame, single");
    expect([now.out_since, now.spec]).toEqual(["2026-07-28", "current"]);
  } finally {
    expect((await admin.patch(data("display_pieces", `/${String(frame.id)}`), { data: { values: { out_since: frame.out_since, spec: frame.spec } }, headers: await csrf(admin) })).status()).toBe(200);
  }
});

test("a visit written up, and a next step done: the follow-ups' counts follow the server; put back as they were", async ({ as, api, data }) => {
  const admin = await api("tessa");
  const headers = await csrf(admin);
  const been = await rows<{ id: number; company_id: number; outcome: string | null; next_step: string | null; next_step_by: string | null; next_step_done_on: string | null }>(admin, data, "showroom_bookings", { column: "state", op: "eq", value: "done" });
  try {
    const page = await (await as("corin")).newPage();
    await page.goto(`${STAFF}showroom-follow-ups`);
    const harbor = page.locator(".crm-sh-card", { hasText: "Harbor & Finch" });
    await harbor.getByRole("button", { name: "Write it up" }).click();
    const form = harbor.getByRole("form", { name: "Write-up" });
    await form.getByLabel("How it went").fill("Sadie liked the taller bay. Wants the run in oak.");
    await form.getByLabel("The next step").fill("Price the taller bay in oak");
    await form.getByLabel("By when").fill("2026-08-03");
    await form.getByRole("button", { name: "Save the write-up" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Write-up saved.");
    await expect(stat(page, "written").locator(".crm-sh-value")).toHaveText("3 of 3");
    await expect(page.getByTestId("sh-fu-missing")).toHaveCount(0);
    await expect(harbor.getByTestId("sh-fu-step")).toHaveText("by Mon, Aug 3");
    // Nordwind's step, past its day, is done: none is late now.
    const nordwind = page.locator(".crm-sh-card", { hasText: "Nordwind Logistics" });
    await nordwind.getByRole("button", { name: "Done it" }).click();
    await expect(page.locator(".crm-toast")).toHaveText("Next step marked done.");
    await expect(nordwind.getByTestId("sh-fu-step")).toHaveText("done");
    await expect(stat(page, "late").locator(".crm-sh-value")).toHaveText("0");
    await expect(stat(page, "late").locator(".crm-sh-stat-note")).toHaveText("1 done");
    await picture(page, "sh-11-follow-ups-written");
  } finally {
    for (const one of been) {
      const res = await admin.patch(data("showroom_bookings", `/${String(one.id)}`), { data: { values: { outcome: one.outcome, next_step: one.next_step, next_step_by: one.next_step_by, next_step_done_on: one.next_step_done_on } }, headers });
      expect(res.status(), await res.text()).toBe(200);
    }
  }
});
