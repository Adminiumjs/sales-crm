/**
 * Today, as Dana, the walk end to end: the app's address lands on Today with the ledger's three figures and seven
 * follow-ups in three groups (§1 of the ledger, on the ledger's clock); she ticks one and pushes it a week, and the line
 * at the foot of the page says where it went; Ivy, her manager, in a browser of her own, opens the CONSOLE's Follow-ups
 * page and marks one of Dana's done, and Dana's open screen drops it by itself; then, with Dana's network cut, "Done"
 * says it is checking, then that it could not confirm the save, and never "not saved".
 *
 * Everything it changes is put back (the pushed step's time, the step Ivy marked done), whatever happens.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, ledgerClock, rows, STAFF, watch } from "./helpers.ts";
import { room } from "./p12-helpers.ts";

// The ledger's figures are those of 09:35: the stand's clock is put back there for this file (`ledgerClock`).
test.beforeAll(() => ledgerClock());

interface Step {
  id: number;
  due_at: string;
  done: boolean;
  text: string;
}

test("Dana's Today: the ledger's figures, a step pushed a week, Ivy's tick in the console arriving by itself, and Done with the network cut", async ({ as, data }) => {
  const danaContext = await as("dana");
  const dana = danaContext.request;
  await room(dana, data, 80);
  const steps = await rows<Step>(dana, data, "follow_ups", { column: "kind", op: "eq", value: "step" }, "&order=id");
  const was = new Map(steps.map((step) => [step.id, { due_at: step.due_at, done: step.done }]));
  const putBack = async (person: APIRequestContext): Promise<void> => {
    const headers = await csrf(person);
    for (const step of await rows<Step>(person, data, "follow_ups", { column: "kind", op: "eq", value: "step" }, "&order=id")) {
      const then = was.get(step.id);
      if (then === undefined || (then.due_at === step.due_at && then.done === step.done)) continue;
      expect((await person.patch(data("follow_ups", `/${String(step.id)}`), { data: { values: then }, headers })).status()).toBe(200);
    }
  };
  try {
    const page = await danaContext.newPage();
    const problems = watch(page);
    await page.goto(STAFF);
    await expect(page).toHaveURL(/\/apps\/crm\/staff\/today$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Good morning, Dana.");
    const kpis = page.locator(".crm-kpi");
    await expect(kpis).toHaveCount(3);
    await expect(kpis.nth(0).locator(".crm-kpi-value")).toHaveText("£95,740");
    await expect(kpis.nth(1).locator(".crm-kpi-value")).toHaveText("£38,400");
    await expect(kpis.nth(2).locator(".crm-kpi-value")).toHaveText("3");
    await expect(page.getByTestId("queue-count")).toHaveText("7");
    const group = (key: string) => page.locator(`[data-group="${key}"] .crm-step`);
    await expect(group("overdue")).toHaveCount(3);
    await expect(group("today")).toHaveCount(2);
    await expect(group("later")).toHaveCount(2);
    await picture(page, "zw-dana-today-ledger");

    // Tick the oldest (Fri 24 Jul at 16:00, four days late) and push it a week: a week on from today, at its own hour.
    const oldest = group("overdue").first();
    await expect(oldest).toContainText("Fri, Jul 24, 16:00");
    await oldest.getByRole("button", { name: /What happened with/ }).click();
    await page.getByRole("menu", { name: "What happened?" }).getByRole("menuitem", { name: "Push a week" }).click();
    // The line at the foot of the page.
    const toast = page.locator(".crm-toast");
    await expect(toast).toHaveText("Pushed to Tue, Aug 4, 16:00");
    expect(await toast.evaluate((line) => line.getBoundingClientRect().bottom > window.innerHeight / 2)).toBe(true);
    await expect(group("overdue")).toHaveCount(2);
    await expect(page.getByTestId("queue-count")).toHaveText("7");
    await expect(page.locator('[data-group="after"] .crm-step')).toHaveCount(1);
    const pushed = (await rows<Step>(dana, data, "follow_ups", { column: "id", op: "eq", value: steps[0]!.id }))[0]!;
    expect(pushed.due_at).toBe("2026-08-04T15:00:00.000Z");

    // Ivy, in a browser of her own, marks one of Dana's done in the console's Follow-ups page.
    const ivyContext = await as("ivy");
    await room(ivyContext.request, data, 60);
    const target = steps.find((step) => step.text.startsWith("Call Marta about the booth count"))!;
    const console_ = await ivyContext.newPage();
    await console_.goto("/p/crm-follow-ups");
    await console_.getByRole("row").filter({ hasText: "Acoustic booths for the studio floor" }).getByRole("button").last().click();
    await expect(console_.getByText(target.text)).toBeVisible();
    await console_.getByRole("button", { name: "Edit", exact: true }).first().click();
    const edit = console_.getByRole("dialog").last();
    await expect(edit).toContainText("Edit Follow-up");
    await edit.getByLabel("Done", { exact: true }).click();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(console_.getByText("Changes saved.")).toBeVisible();
    expect((await rows<Step>(dana, data, "follow_ups", { column: "id", op: "eq", value: target.id }))[0]!.done).toBe(true);
    // Dana's screen drops it by itself: no reload.
    await expect(page.getByTestId("queue-count")).toHaveText("6");
    await expect(group("overdue")).toHaveCount(1);
    await expect(page.locator(".crm-step").filter({ hasText: "Acoustic booths for the studio floor" })).toHaveCount(0);
    await expect(kpis.nth(2).locator(".crm-kpi-value")).toHaveText("1");

    // The network cut: Done says it is checking, then that it could not confirm; never "not saved".
    const last = group("overdue").first();
    const lastText = (await last.locator(".crm-step-text").textContent()) ?? "";
    const lastId = steps.find((step) => step.text === lastText)!.id;
    const said: string[] = [];
    await page.exposeFunction("zwSaid", (line: string) => said.push(line));
    await page.evaluate(() => {
      new MutationObserver(() => {
        const line = document.querySelector(".crm-toast");
        if (line !== null) (window as unknown as { zwSaid: (text: string) => void }).zwSaid(line.textContent ?? "");
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await danaContext.setOffline(true);
    try {
      await last.getByRole("button", { name: /What happened with/ }).click();
      await page.getByRole("menu", { name: "What happened?" }).getByRole("menuitem", { name: "Done" }).click();
      await expect(toast).toHaveText("The reply did not arrive. Checking whether that was saved…");
      await expect(toast).toHaveText("We could not confirm that was saved. Check the connection, then look at the list before trying again.");
      // Sticky, something to read: it stays until dismissed.
      await expect(toast.getByRole("button", { name: "Dismiss" })).toBeVisible();
      await picture(page, "zw-dana-today-offline");
    } finally {
      await danaContext.setOffline(false);
    }
    expect(said.some((line) => /not saved/i.test(line))).toBe(false);
    // Nothing reached the server, and the step is still hers to do.
    expect((await rows<Step>(dana, data, "follow_ups", { column: "id", op: "eq", value: lastId }))[0]!.done).toBe(false);
    // Lost replies in the browser's console are the cut network's, not a fault of the page.
    expect(problems.filter((line) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|WebSocket/i.test(line))).toEqual([]);
  } finally {
    await putBack(dana);
  }
  expect((await rows<Step>(dana, data, "follow_ups", { column: "kind", op: "eq", value: "step" }, "&order=id")).map((step) => [step.id, step.due_at, step.done])).toEqual(steps.map((step) => [step.id, step.due_at, step.done]));
});
