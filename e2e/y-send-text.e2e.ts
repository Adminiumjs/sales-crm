/**
 * "Send a text" (plan 80, X59): from a deal's room and its call notes, beside
 * "Log the call", to one of the customer's people, through Adminium's own
 * `POST /texts/send`; and the yes a contact gives a rep, recorded through
 * `POST /texts/consent` with the words they were read.
 *
 * REAL: the stand connects a Telnyx account whose API is answered by the stand's
 * stub (`e2e/sms-stub.mjs`), so a text goes through Adminium's whole send path
 * (consent, the stop list, the country, the hours, the queue, the send job) and
 * stops at the stub, which keeps it. The sample's people have office numbers
 * (landlines, which a text cannot reach), so each test adds two people of its
 * own at Cobalt Legal with mobile numbers: Mia's yes is recorded by Dana on the
 * phone and her text goes; Noor never said yes, and hers is refused.
 *
 * MOCKED, AND SAID SO: a text held for the sending hours (the ledger's clock is
 * inside them), and a server with no text account (the stand has one), are
 * played into the page by `page.route`, in the door's own answer shapes.
 *
 * Every write is on a deal of the spec's own ("Spec: text …"), taken away at
 * the end with what it holds. The answers recorded stay in Adminium's text log,
 * as they would.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, minuteOut, removeDeals, rows, STAFF, watch, type Data } from "./helpers.ts";
import { smsSent } from "./stand.mjs";

const noSideways = async (page: Page): Promise<void> => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

/** Two people of the spec's own at Cobalt Legal, each with a mobile number, and a deal whose main contact is the one named. */
async function makeDeal(dana: APIRequestContext, data: Data, name: string, tag: string, main: "mia" | "noor" = "mia"): Promise<{ dealId: number; mia: { id: number; name: string; to: string }; noor: { id: number; name: string; to: string } }> {
  const me = ((await (await dana.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const stages = await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const ines = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Ines Vaughan" }))[0]!;
  const headers = await csrf(dana);
  const person = async (first: string, phone: string, to: string) => {
    const made = await dana.post(data("contacts"), { data: { values: { company_id: ines.company_id, name: `${first} Spec${tag}`, phone } }, headers });
    expect(made.status(), await made.text()).toBe(201);
    return { id: ((await made.json()) as { data: { id: number } }).data.id, name: `${first} Spec${tag}`, to };
  };
  const mia = await person("Mia", `07400 1235${tag}0`, `+4474001235${tag}0`);
  const noor = await person("Noor", `07400 1235${tag}1`, `+4474001235${tag}1`);
  const made = await dana.post(data("deals"), { data: { values: { name, company_id: ines.company_id, contact_id: (main === "mia" ? mia : noor).id, owner_id: me, stage_id: stages[1]!.id, typed_amount: 6400, expected_close: "2026-09-30" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  return { dealId: ((await made.json()) as { data: { id: number } }).data.id, mia, noor };
}

/** The spec's deals, then its people, taken away. */
async function cleanUp(api: (person: string) => Promise<APIRequestContext>, data: Data): Promise<void> {
  await removeDeals(await api("tessa"), data, "Spec: text");
  const owner = await api("owner");
  const headers = await csrf(owner);
  for (const one of await rows<{ id: number }>(owner, data, "contacts", { column: "name", op: "like", value: "% Spec_" })) await owner.delete(data("contacts", `/${String(one.id)}?confirm=true`), { headers });
}

const texts = (person: APIRequestContext, data: Data, dealId: number) => rows<{ id: number; kind: string; text: string }>(person, data, "activities", { and: [{ column: "deal_id", op: "eq", value: dealId }, { column: "kind", op: "eq", value: "text" }] }, "&order=id");

/** Answer one door as a server would, and keep what the page sent. */
async function answer(page: Page, path: string, body: unknown): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.unroute(`**/api/v1${path}*`);
  await page.route(`**/api/v1${path}*`, async (route) => {
    sent.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return sent;
}
const outcome = (result: { outcome: string; opensAt?: number | null; reason?: string | null }) => {
  const went = result.outcome !== "refused";
  return { data: { threadId: went ? "tth_spec" : null, sentTo: went ? "+44 ••• 182" : null, result: { outcome: result.outcome, deliveryId: went ? "tdl_spec" : null, opensAt: result.opensAt ?? null, reason: result.reason ?? null } } };
};

test.afterAll(async () => {
  await minuteOut();
});

test("Dana records Mia's yes on the phone and texts her: it goes through Adminium to the provider, and is logged on the deal", async ({ as, api, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const { dealId, mia } = await makeDeal(dana, data, "Spec: text real", "1");
  try {
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}deals/${String(dealId)}`);
    await expect(page.getByTestId("room-texts-off")).toHaveCount(0);
    await page.getByRole("button", { name: "Send a text" }).click();
    const dialog = page.getByRole("dialog", { name: "Send a text" });
    await expect(dialog.getByRole("radio", { name: new RegExp(mia.name) })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByTestId("text-to").first().locator("bdi")).toHaveText("07400 123510");
    // The sample's own people have office numbers on file, and are offered too: the server says a landline cannot take a text.
    await expect(dialog.getByRole("radio", { name: /Ines Vaughan/ })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Message" })).toBeFocused();

    // Where she stands, as the server reads it; then the yes she gave on the phone, in the form's own words.
    const standing = dialog.getByTestId("text-standing");
    await expect(standing).toHaveText("Not asked yet. A text goes only after their yes, or within 7 days of a text from them.");
    await expect(dialog.getByTestId("text-wording")).toHaveText("Text me about my enquiry");
    await expect(dialog.getByTestId("text-answer-yes")).toBeDisabled();
    await dialog.getByRole("radio", { name: "On the phone" }).click();
    await dialog.getByTestId("text-answer-yes").click();
    await expect(page.locator(".crm-toast")).toHaveText("Mia’s yes to texts is recorded.");
    await expect(standing).toHaveAttribute("data-state", "yes");
    await expect(standing).toHaveText(/^Agreed to texts from this app on .+\. Recorded by Dana Whitlock\.$/);
    await picture(page, "text-1-yes-recorded");

    const before = smsSent().length;
    await dialog.getByRole("textbox", { name: "Message" }).fill("Hello Mia, the desk samples are ready to see.");
    await dialog.getByTestId("text-send").click();
    await expect(page.locator(".crm-toast")).toHaveText("The text to Mia is on its way.");
    await expect(dialog).toHaveCount(0);
    expect((await texts(dana, data, dealId)).map((one) => one.text)).toEqual([`Text to ${mia.name} (+44 ••• 510)\nHello Mia, the desk samples are ready to see.`]);
    await expect(page.locator('.crm-room-line[data-type="text"]')).toHaveCount(1);
    // The send job hands it to the provider: the stub's log has it, to her number, from the stand's sender, with the opt-out line Adminium added.
    await expect.poll(() => smsSent().slice(before).filter((one) => one.to === mia.to).length, { timeout: 30_000 }).toBe(1);
    const went = smsSent().slice(before).find((one) => one.to === mia.to)!;
    expect(went.from).toBe("+447400123456");
    expect(went.text).toContain("Hello Mia, the desk samples are ready to see.");
    // The stand has no public https address, so a STOP could not reach it: Adminium gives the business's own phone instead
    // (the CRM's Settings), never "Reply STOP". A server that can take replies ends "Reply STOP to opt out."
    expect(went.text).toMatch(/(Reply STOP to opt out\.|To stop these texts, contact \d[\d ]+\d\.)$/);
    await picture(page, "text-2-sent");
    expect(problems).toEqual([]);

    // READ-ONLY: no button, no answer to record, and the door refuses her by the same name the page uses.
    const graceContext = await as("grace");
    const grace = graceContext.request;
    const hers = await graceContext.newPage();
    await hers.goto(`${STAFF}deals/${String(dealId)}`);
    await expect(hers.getByRole("heading", { level: 1 })).toHaveText("Spec: text real");
    await expect(hers.getByRole("button", { name: "Send a text" })).toHaveCount(0);
    await expect(hers.getByTestId("room-text-answer")).toHaveCount(0);
    const config = (await (await grace.get(`${STAFF}surface-config.json`)).json()) as { connectionId: string; tables: Record<string, string> };
    const record = { connection: config.connectionId, table: config.tables["contacts"], row: String(mia.id), column: "phone" };
    const refused = await grace.post("/api/v1/texts/send", { data: { ...record, body: "no", clientKey: "spec-read-only-key-000000000" }, headers: await csrf(grace) });
    expect(refused.status(), await refused.text()).toBe(403);
    const noYes = await grace.post("/api/v1/texts/consent", { data: { ...record, state: "yes", how: "phone", wording: { text: "Text me about my enquiry", version: "1" } }, headers: await csrf(grace) });
    expect(noYes.status(), await noYes.text()).toBe(403);
  } finally {
    await cleanUp(api, data);
  }
});

test("Noor never said yes, and Ines's number is an office line: the server refuses both, nothing goes and nothing is logged; from the call notes too", async ({ as, api, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const { dealId, noor } = await makeDeal(dana, data, "Spec: text no yes", "2", "noor");
  try {
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}deals/${String(dealId)}/call`);
    await page.getByRole("textbox", { name: "Notes from the call" }).fill("Noor asked for a reminder");
    await expect(page.locator(".crm-call-foot-end").getByRole("button")).toHaveText(["Start again", "Log the call", "Send a text"]);
    await page.getByRole("button", { name: "Send a text" }).click();
    const dialog = page.getByRole("dialog", { name: "Send a text" });
    await expect(dialog.getByRole("radio", { name: new RegExp(noor.name) })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByTestId("text-standing")).toHaveText("Not asked yet. A text goes only after their yes, or within 7 days of a text from them.");
    const before = smsSent().length;
    const box = dialog.getByRole("textbox", { name: "Message" });
    await box.fill("Can we move Thursday to 10:00?");
    await dialog.getByTestId("text-send").click();
    await expect(dialog.getByTestId("text-said")).toHaveText("Not sent. Noor has not agreed to texts from this app, and has not texted you in the last 7 days.");
    await picture(page, "text-3-no-yes");

    // Ines: an office line on file.
    await dialog.getByRole("radio", { name: /Ines Vaughan/ }).click();
    await expect(dialog.getByTestId("text-standing")).toHaveAttribute("data-state", /.+/);
    await dialog.getByTestId("text-send").click();
    await expect(dialog.getByTestId("text-said")).toHaveText("Not sent. This number can’t receive texts: a landline, a toll-free number or an extension.");

    expect(await texts(dana, data, dealId)).toEqual([]);
    await page.waitForTimeout(1500);
    expect(smsSent().slice(before)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    await cleanUp(api, data);
  }
});

test("mocked: a text held for the sending hours says when it goes; with no text account the button waits, with a plain line", async ({ as, api, data }) => {
  const context = await as("dana");
  const dana = context.request;
  const { dealId, mia } = await makeDeal(dana, data, "Spec: text mocked", "3");
  try {
    const page = await context.newPage();
    await page.goto(`${STAFF}deals/${String(dealId)}`);
    const dialog = page.getByRole("dialog", { name: "Send a text" });
    const opensAt = Date.parse("2026-07-29T07:00:00.000Z");
    const sent = await answer(page, "/texts/send", outcome({ outcome: "held", opensAt }));
    await page.getByRole("button", { name: "Send a text" }).click();
    await dialog.getByRole("textbox", { name: "Message" }).fill("Samples arrive tomorrow morning.");
    await dialog.getByTestId("text-send").click();
    await expect(page.locator(".crm-toast")).toHaveText("The text to Mia waits for the sending hours. It goes Wed, Jul 29, 08:00.");
    expect(sent[0]).toMatchObject({ column: "phone", body: "Samples arrive tomorrow morning." });
    expect((await texts(dana, data, dealId)).map((one) => one.text.split("\n")[0])).toEqual([`Text to ${mia.name} (+44 ••• 182), goes Wed, Jul 29, 08:00`]);

    // No account on the server: the button waits and says why, in the room and in the call notes.
    await answer(page, "/texts/ready", { data: { ready: false } });
    await page.reload();
    await expect(page.getByRole("button", { name: "Send a text" })).toBeDisabled();
    await expect(page.getByTestId("room-texts-off")).toHaveText("Texts aren’t set up on this server yet, so none can be sent. Ask whoever runs Adminium.");
    // A contact's answer can still be recorded: it needs no provider.
    await expect(page.getByTestId("room-text-answer").first()).toBeEnabled();
    await picture(page, "text-4-not-ready");
    await page.goto(`${STAFF}deals/${String(dealId)}/call`);
    await expect(page.getByRole("button", { name: "Send a text" })).toBeDisabled();
    await expect(page.getByTestId("call-texts-off")).toBeVisible();
  } finally {
    await cleanUp(api, data);
  }
});

test("390 wide in the dark, and in Arabic: the number stays left to right, the words take their own direction", async ({ as, api, data }) => {
  const dana = await api("dana");
  const { dealId, noor } = await makeDeal(dana, data, "Spec: text phone", "4", "noor");
  try {
    const context = await as("dana", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(`${STAFF}deals/${String(dealId)}`);
    await page.getByRole("button", { name: "Send a text" }).click();
    const dialog = page.getByRole("dialog", { name: "Send a text" });
    await dialog.getByRole("textbox", { name: "Message" }).fill("Hello Noor, the desk samples are ready to see.");
    await expect(dialog.getByTestId("text-standing")).toHaveAttribute("data-state", /.+/);
    await noSideways(page);
    // The dialog fades in (0.2 s): the picture waits for it.
    await page.waitForTimeout(400);
    await picture(page, "text-5-390-dark");
    await page.keyboard.press("Escape");

    await inArabic(dana, async () => {
      await page.goto(`${STAFF}deals/${String(dealId)}`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await page.getByRole("button", { name: "أرسل رسالة نصية" }).click();
      const box = page.getByRole("dialog", { name: "أرسل رسالة نصية" });
      await expect(box.getByTestId("text-to").first().locator("bdi")).toHaveAttribute("dir", "ltr");
      await expect(box.getByRole("radio", { name: new RegExp(noor.name) })).toHaveAttribute("aria-checked", "true");
      await expect(box.getByTestId("text-standing")).toHaveText("لم يُسأل بعد. لا تُرسل رسالة إلا بعد موافقته، أو خلال 7 أيام من رسالة منه.");
      await box.getByRole("textbox", { name: "الرسالة" }).fill("مرحبًا، العينات جاهزة.");
      await box.getByTestId("text-send").click();
      await expect(box.getByTestId("text-said")).toHaveText("لم تُرسل. لم يوافق Noor على الرسائل النصية من هذا التطبيق، ولم يراسلك خلال آخر 7 أيام.");
      await noSideways(page);
      await picture(page, "text-6-arabic");
    });
  } finally {
    await cleanUp(api, data);
  }
});
