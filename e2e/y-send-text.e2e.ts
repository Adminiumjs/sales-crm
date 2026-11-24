/**
 * "Send a text" (plan 80, X59): from a deal's room and its call notes, beside
 * "Log the call", to one of the customer's people, through Adminium's own
 * `POST /texts/send`.
 *
 * REAL: the stand has no text provider, so the server refuses every text, and
 * the page says so in its words; nothing is logged. Read-only has no button,
 * and the server refuses her all the same.
 *
 * ENGINE GAP (plan 80, see `workplan/80-app-crm-progress.md`): `POST /texts/send`
 * reads `table` as the schema's table id (`main.crm_contacts` on SQLite) and
 * not as the table's name, which is all a staff page is told. Until it reads a
 * name as the data routes do, it answers the CRM's every text "No such record"
 * (404), worded "This contact is no longer there for you". The specs below hold
 * what stays true either way: "Not sent", nothing logged, Read-only refused.
 *
 * MOCKED, AND SAID SO: what a server with a provider answers (`queued`, `held`,
 * a `no-consent` refusal) is played into the page by `page.route`, the door's
 * own answer shape. The activity the page logs for a text that went is the
 * stand's real write, read back from the server.
 *
 * Every write is on a deal of the spec's own ("Spec: text …"), taken away at
 * the end with what it holds.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, minuteOut, removeDeals, rows, STAFF, watch, type Data } from "./helpers.ts";

const noSideways = async (page: Page): Promise<void> => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

async function makeDeal(dana: APIRequestContext, data: Data, name: string): Promise<{ dealId: number; inesId: number }> {
  const me = ((await (await dana.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const stages = await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const ines = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Ines Vaughan" }))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name, company_id: ines.company_id, contact_id: ines.id, owner_id: me, stage_id: stages[1]!.id, typed_amount: 6400, expected_close: "2026-09-30" } }, headers: await csrf(dana) });
  expect(made.status(), await made.text()).toBe(201);
  return { dealId: ((await made.json()) as { data: { id: number } }).data.id, inesId: ines.id };
}

const texts = (person: APIRequestContext, data: Data, dealId: number) => rows<{ id: number; kind: string; text: string }>(person, data, "activities", { and: [{ column: "deal_id", op: "eq", value: dealId }, { column: "kind", op: "eq", value: "text" }] }, "&order=id");

/** Answer the text door as a server with a provider would, and keep what the page sent. */
async function answer(page: Page, result: { outcome: string; opensAt?: number | null; reason?: string | null }): Promise<{ body: Record<string, unknown> }[]> {
  const sent: { body: Record<string, unknown> }[] = [];
  await page.unroute("**/api/v1/texts/send");
  await page.route("**/api/v1/texts/send", async (route) => {
    sent.push({ body: route.request().postDataJSON() as Record<string, unknown> });
    const went = result.outcome !== "refused";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { threadId: went ? "tth_spec" : null, sentTo: went ? "+44 ••• 182" : null, result: { outcome: result.outcome, deliveryId: went ? "tdl_spec" : null, opensAt: result.opensAt ?? null, reason: result.reason ?? null } } }) });
  });
  return sent;
}

test.afterAll(async () => {
  await minuteOut();
});

test("Dana texts from the room: no provider on the stand, so the server refuses and nothing is logged; Read-only has no button and is refused", async ({ as, api, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const { dealId, inesId } = await makeDeal(dana, data, "Spec: text no provider");
  try {
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}deals/${String(dealId)}`);
    await page.getByRole("button", { name: "Send a text" }).click();
    const dialog = page.getByRole("dialog", { name: "Send a text" });
    await expect(dialog.getByRole("radio", { name: /Ines Vaughan/ })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByTestId("text-to").first().locator("bdi")).toHaveText("0113 496 0182");
    await expect(dialog.getByRole("textbox", { name: "Message" })).toBeFocused();
    await expect(dialog.getByText("Each text ends with a line that says how to stop. It is added for you.")).toBeVisible();
    await expect(dialog.getByTestId("text-send")).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Message" }).fill("Hello Ines, the desk samples are ready to see.");
    await dialog.getByTestId("text-send").click();
    // The stand's real answer: never sent (no provider; today also the table-name gap above).
    await expect(dialog.getByTestId("text-said")).toHaveText(/^Not sent\. /);
    await picture(page, "text-1-no-provider");
    expect(await texts(dana, data, dealId)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send a text" })).toBeFocused();
    // The browser notes the door's 404 (the gap above) as a failed load: that one, and nothing else.
    expect(problems.filter((one) => !/status of 404/.test(one))).toEqual([]);

    // READ-ONLY: no button, and the door refuses her.
    const graceContext = await as("grace");
    const grace = graceContext.request;
    const hers = await graceContext.newPage();
    await hers.goto(`${STAFF}deals/${String(dealId)}`);
    await expect(hers.getByRole("heading", { level: 1 })).toHaveText("Spec: text no provider");
    await expect(hers.getByRole("button", { name: "Send a text" })).toHaveCount(0);
    const config = (await (await grace.get(`${STAFF}surface-config.json`)).json()) as { connectionId: string; tables: Record<string, string> };
    const refused = await grace.post("/api/v1/texts/send", { data: { connection: config.connectionId, table: config.tables["contacts"], row: String(inesId), column: "phone", body: "no", clientKey: "spec-read-only-key-000000000" }, headers: await csrf(grace) });
    // 403 once the door reads a table's name; 404 while it does not (the gap above). Never a text.
    expect([403, 404], await refused.text()).toContain(refused.status());
  } finally {
    await removeDeals(await api("tessa"), data, "Spec: text");
  }
});

test("what a server with a provider answers (mocked): on its way, waiting for the hours, no yes to this app; only a text that went is logged", async ({ as, api, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const { dealId, inesId } = await makeDeal(dana, data, "Spec: text answers");
  try {
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}deals/${String(dealId)}`);
    const dialog = page.getByRole("dialog", { name: "Send a text" });
    const box = dialog.getByRole("textbox", { name: "Message" });

    // Refused: no yes given to THIS app. The dialog stays, and nothing is logged.
    let sent = await answer(page, { outcome: "refused", reason: "no-consent" });
    await page.getByRole("button", { name: "Send a text" }).click();
    await box.fill("Can we move Thursday to 10:00?");
    await dialog.getByTestId("text-send").click();
    await expect(dialog.getByTestId("text-said")).toHaveText("Not sent. Ines has not agreed to texts from this app, and has not texted you in the last 7 days.");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ table: expect.stringMatching(/contacts$/), row: String(inesId), column: "phone", body: "Can we move Thursday to 10:00?" });
    const firstKey = sent[0]!.body["clientKey"];
    expect(await texts(dana, data, dealId)).toEqual([]);
    await picture(page, "text-2-no-consent");

    // Queued: on its way (never "delivered"), logged on the deal as a text, the same key as the first press of these words.
    sent = await answer(page, { outcome: "queued" });
    await dialog.getByTestId("text-send").click();
    await expect(page.locator(".crm-toast")).toHaveText("The text to Ines is on its way.");
    await expect(dialog).toHaveCount(0);
    expect(sent[0]!.body["clientKey"]).toBe(firstKey);
    expect((await texts(dana, data, dealId)).map((one) => one.text)).toEqual(["Text to Ines Vaughan (+44 ••• 182)\nCan we move Thursday to 10:00?"]);
    const line = page.locator('.crm-room-line[data-type="text"]');
    await expect(line).toHaveCount(1);
    await expect(line.locator(".crm-room-line-label")).toHaveText("Text");
    await picture(page, "text-3-logged");

    // Held: outside the sending hours, it says when it goes, and is logged.
    const opensAt = Date.parse("2026-07-29T07:00:00.000Z");
    sent = await answer(page, { outcome: "held", opensAt });
    await page.getByRole("button", { name: "Send a text" }).click();
    await box.fill("Samples arrive tomorrow morning.");
    await dialog.getByTestId("text-send").click();
    await expect(page.locator(".crm-toast")).toHaveText(/^The text to Ines waits for the sending hours\. It goes Wed, Jul 29, 08:00\.$/);
    expect(sent[0]!.body["clientKey"]).not.toBe(firstKey);
    expect((await texts(dana, data, dealId)).map((one) => one.text.split("\n")[0])).toEqual(["Text to Ines Vaughan (+44 ••• 182)", "Text to Ines Vaughan (+44 ••• 182), goes Wed, Jul 29, 08:00"]);

    // From the call notes too, after "Log the call".
    await page.goto(`${STAFF}deals/${String(dealId)}/call`);
    await page.getByRole("textbox", { name: "Notes from the call" }).fill("Ines asked for a reminder");
    const foot = page.locator(".crm-call-foot-end").getByRole("button");
    await expect(foot).toHaveText(["Start again", "Log the call", "Send a text"]);
    await expect(page.getByTestId("call-last").locator("li").first()).toContainText("Text");
    expect(problems).toEqual([]);
  } finally {
    await removeDeals(await api("tessa"), data, "Spec: text");
  }
});

test("390 wide in the dark, and in Arabic: the number stays left to right, the words take their own direction", async ({ as, api, data }) => {
  const dana = await api("dana");
  const { dealId } = await makeDeal(dana, data, "Spec: text phone");
  try {
    const context = await as("dana", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(`${STAFF}deals/${String(dealId)}`);
    await page.getByRole("button", { name: "Send a text" }).click();
    const dialog = page.getByRole("dialog", { name: "Send a text" });
    await dialog.getByRole("textbox", { name: "Message" }).fill("Hello Ines, the desk samples are ready to see.");
    await noSideways(page);
    // The dialog fades in (0.2 s): the picture waits for it.
    await page.waitForTimeout(400);
    await picture(page, "text-4-390-dark");
    await page.keyboard.press("Escape");

    await inArabic(dana, async () => {
      await page.goto(`${STAFF}deals/${String(dealId)}`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await page.getByRole("button", { name: "أرسل رسالة نصية" }).click();
      const box = page.getByRole("dialog", { name: "أرسل رسالة نصية" });
      await expect(box.getByTestId("text-to").first().locator("bdi")).toHaveAttribute("dir", "ltr");
      await box.getByRole("textbox", { name: "الرسالة" }).fill("مرحبًا، العينات جاهزة.");
      await answer(page, { outcome: "refused", reason: "stopped" });
      await box.getByTestId("text-send").click();
      await expect(box.getByTestId("text-said")).toHaveText("لم تُرسل. طلب Ines عدم تلقي المزيد من الرسائل النصية.");
      await noSideways(page);
      await picture(page, "text-5-arabic");
    });
  } finally {
    await removeDeals(await api("tessa"), data, "Spec: text");
  }
});
