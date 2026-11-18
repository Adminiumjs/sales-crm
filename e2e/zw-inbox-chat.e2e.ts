/**
 * An enquiry from the website chat (the Live chat add-on), in the Team inbox.
 *
 * With Live chat on the stand (`CRM_STAND_ADD_ONS=…,live-chat`): the sample's
 * enquiry from Veldt Studios came from a chat, and its card has "Read the
 * chat", which opens the conversation read only, each line said in the
 * reader's language. Read-only, who is given no read of the chat, sees the
 * card and no button. Without Live chat, nobody has the button.
 *
 * An enquiry a question left outside hours made names no company: its card
 * says "No company yet", and claiming it asks for the company's name. It is
 * written here as the chat's door writes one (source "chat", an empty company
 * name), by the CRM admin; the door itself is proved in
 * `proofs/crm-chat.test.ts`. Everything made here is named "P71C …" and
 * taken away again, whatever happens.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";

const VELDT = "Acoustic booths — how many fit?";

async function clear(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const row of await rows<{ id: number }>(admin, data, "enquiries", { column: "wants", op: "like", value: "P71C %" })) {
    expect((await admin.delete(data("enquiries", `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
}

test("the sample's chat enquiry: \"Read the chat\" with Live chat, for the inbox's roles only; no button without it", async ({ as, stand }) => {
  const withChat = stand.addOns.some((one) => one.key === "live-chat");
  const corin = await (await as("corin")).newPage();
  const problems = watch(corin);
  await corin.goto(`${STAFF}inbox`);
  const card = corin.locator(".crm-enq").filter({ hasText: VELDT });
  await expect(card.locator("[data-source-pill]")).toHaveText("Chat");
  const button = card.locator('[data-act="read-chat"]');
  if (!withChat) {
    await expect(button).toHaveCount(0);
    expect(problems).toEqual([]);
    return;
  }
  await expect(button).toHaveText("Read the chat");
  await expect(button).toHaveAccessibleName(`Read the chat: ${VELDT}`);
  await button.click();
  const sheet = corin.getByRole("dialog", { name: "The website chat" });
  await expect(sheet).toBeVisible();
  // Nine lines: the visitor's three, the automatic answer, Dana's reply, and the chat's own four.
  const lines = sheet.locator(".crm-chat-lines > li");
  await expect(lines).toHaveCount(9);
  await expect(lines.nth(0).locator(".crm-chat-who")).toHaveText("Marta Kovac");
  await expect(lines.nth(0).locator(".crm-chat-body")).toHaveText("Hello, we are fitting out a second grading suite. How many of your acoustic booths fit along an eleven-metre wall?");
  await expect(lines.nth(1).locator(".crm-chat-who")).toHaveText("Automatic answer");
  await expect(lines.nth(3)).toContainText("The visitor asked for a person.");
  await expect(lines.nth(4)).toContainText("A person joined the chat.");
  await expect(lines.nth(5)).toHaveAttribute("data-kind", "staff");
  await expect(lines.nth(5).locator(".crm-chat-body")).toContainText("this is Dana at Meridian");
  await expect(lines.nth(7)).toContainText("An enquiry was made from this chat.");
  await expect(lines.nth(8)).toContainText("The chat was closed.");
  // Asked in hours: not marked as left outside them.
  await expect(sheet.getByTestId("chat-started")).not.toContainText("outside");
  await picture(corin, "p71c-read-the-chat");
  await corin.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(problems).toEqual([]);

  // Read-only reads the inbox, and nothing of the chat: no button.
  const grace = await (await as("grace")).newPage();
  await grace.goto(`${STAFF}inbox`);
  await grace.locator('.crm-chip-btn[data-filter="all"]').click();
  await expect(grace.locator(".crm-enq").filter({ hasText: VELDT })).toHaveCount(1);
  await expect(grace.locator('[data-act="read-chat"]')).toHaveCount(0);
});

test("a question left outside hours names no company: its card says so, and claiming it asks for the company's name", async ({ as, api, data }) => {
  const admin = await api("tessa");
  await clear(admin, data);
  try {
    const made = await admin.post(data("enquiries"), {
      data: { values: { source: "chat", company_name: "", person: "Lou Fenn", email: "lou@p71c-fenn.example", text: "Do you deliver to Hull?", wants: "P71C delivery to Hull" }, clientKey: "p71cchatAAAAAAAAAAAAAAAAAAAAAAAA" },
      headers: await csrf(admin),
    });
    expect(made.status(), await made.text()).toBe(201);

    const page = await (await as("ivy")).newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}inbox`);
    const card = page.locator(".crm-enq").filter({ hasText: "P71C delivery to Hull" });
    await expect(card.locator("[data-source-pill]")).toHaveText("Chat");
    await card.locator('[data-act="claim"]').click();
    const sheet = page.getByRole("dialog", { name: "Start a deal" });
    await expect(sheet.getByRole("radio", { name: "A new company" })).toHaveAttribute("aria-checked", "true");
    const name = sheet.getByLabel("The company’s name");
    await expect(name).toHaveValue("");
    await expect(sheet.getByRole("textbox", { name: "Line up the first step" })).toHaveValue("First call with Lou Fenn about P71C delivery to Hull");
    await sheet.getByRole("button", { name: "Add to the board" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Type the company’s name: this enquiry came with none.");
    await picture(page, "p71c-claim-no-company");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect((await rows<{ state: string }>(admin, data, "enquiries", { column: "wants", op: "eq", value: "P71C delivery to Hull" }))[0]!.state).toBe("open");

    // With nothing it wants either, the card says "No company yet" where its headline goes, in English and in Arabic.
    const plain = await admin.post(data("enquiries"), {
      data: { values: { source: "chat", company_name: "", person: "Ana P71C", text: "P71C a question" }, clientKey: "p71cchatBBBBBBBBBBBBBBBBBBBBBBBB" },
      headers: await csrf(admin),
    });
    expect(plain.status(), await plain.text()).toBe(201);
    try {
      await page.reload();
      const bare = page.locator(".crm-enq").filter({ hasText: "Ana P71C" });
      await expect(bare.locator(".crm-enq-subject")).toHaveText("No company yet");
      const ivy = await api("ivy");
      await inArabic(ivy, async () => {
        const narrow = await (await as("ivy", { viewport: { width: 390, height: 844 } })).newPage();
        await narrow.goto(`${STAFF}inbox`);
        await expect(narrow.locator(".crm-enq").filter({ hasText: "Ana P71C" }).locator(".crm-enq-subject")).toHaveText("لا شركة بعد");
        expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    } finally {
      const headers = await csrf(admin);
      const id = ((await plain.json()) as { data: { id: number } }).data.id;
      await admin.delete(data("enquiries", `/${String(id)}?confirm=true`), { headers });
    }
    expect(problems).toEqual([]);
  } finally {
    await clear(admin, data);
  }
});
