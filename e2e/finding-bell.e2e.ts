/**
 * P08, the bell: the person's own notices from Adminium, live.
 *
 * A real notice: Ivy mentions Dana and Ada in a comment on a deal of Dana's.
 * Dana's open page counts one more without a reload (the bell asks the server
 * once a minute while the page is shown: the spec waits up to that minute); the notice names the
 * deal; pressing it opens that deal's room and the server marks it read. Ada
 * (operations, who cannot open deals) gets her notice with no way in, as the
 * server sends it, and her bell draws it as words only.
 *
 * The deal is the spec's own ("Spec: bell …") and is taken away at the end.
 * The notices stay (Adminium removes none); they are left read.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, removeDeals, rows, STAFF, watch, type Data } from "./helpers.ts";

const userId = async (person: APIRequestContext): Promise<string> => ((await (await person.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entity: Record<string, unknown> | null;
  actionUrl: string | null;
  readAt: number | null;
}
const notices = async (person: APIRequestContext): Promise<{ items: Notice[]; unreadCount: number }> => ((await (await person.get("/api/v1/me/notifications?limit=20")).json()) as { data: { items: Notice[]; unreadCount: number } }).data;
const bell = (page: Page) => page.getByTestId("bell");
const badge = (page: Page) => page.getByTestId("bell-count");
/** The bell's count, waited for as long as the bell may take to ask again (a minute, and a little). */
const expectCount = async (page: Page, count: number, timeout = 15_000): Promise<void> => {
  if (count === 0) await expect(badge(page)).toHaveCount(0, { timeout });
  else await expect(badge(page)).toHaveText(String(count), { timeout });
  await expect(bell(page)).toHaveAttribute("aria-label", `Notifications, ${String(count)} new`);
};
const A_MINUTE = 75_000;

async function makeDeal(dana: APIRequestContext, data: Data, name: string): Promise<number> {
  const me = await userId(dana);
  const stages = await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const ines = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Ines Vaughan" }))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name, company_id: ines.company_id, contact_id: ines.id, owner_id: me, stage_id: stages[0]!.id, typed_amount: 1500, expected_close: "2026-09-30" } }, headers: await csrf(dana) });
  expect(made.status(), await made.text()).toBe(201);
  return ((await made.json()) as { data: { id: number } }).data.id;
}

async function mention(ivy: APIRequestContext, data: Data, dealId: number, text: string): Promise<void> {
  const posted = await ivy.post(data("comments"), { data: { values: { deal_id: dealId, text } }, headers: await csrf(ivy) });
  expect(posted.status(), await posted.text()).toBe(201);
}

test("a mention reaches Dana's open bell live; it names the deal and opens its room; Ada's has no way in", async ({ as, api, data }) => {
  // Two waits of up to a minute each for the bell to ask again.
  test.setTimeout(300_000);
  const context = await as("dana");
  const dana = context.request;
  const ivy = await api("ivy");
  const ada = await api("ada");
  const [danaId, adaId] = [await userId(dana), await userId(ada)];
  const before = await notices(dana);
  const adaBefore = (await notices(ada)).unreadCount;

  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}today`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The badge is the server's count.
  await expectCount(page, before.unreadCount);

  const name = "Spec: bell, a mention";
  const dealId = await makeDeal(dana, data, name);
  try {
    await mention(ivy, data, dealId, `@[Dana Whitlock](${danaId}) and @[Ada Novak](${adaId}): can the crew fit this in?`);
    // Live: one more, with no reload, within the bell's minute.
    await expectCount(page, before.unreadCount + 1, A_MINUTE);
    const told = (await notices(dana)).items[0]!;
    expect([told.kind, told.title, told.body, told.readAt]).toEqual(["mention", "Ivy Sandoval mentioned you", `Deal: ${name}`, null]);

    // By keyboard: the bell, its list, the notice, Enter.
    await bell(page).focus();
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("bell-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAccessibleName("Notifications for Dana");
    const item = panel.getByTestId("bell-item").first();
    await expect(item).toContainText("Ivy Sandoval mentioned you");
    await expect(item).toContainText(`Deal: ${name}`);
    await expect(item).toHaveAttribute("data-unread", "1");
    const link = item.getByRole("link");
    await expect(link).toHaveAttribute("href", `${STAFF}deals/${String(dealId)}`);
    // Escape closes it and gives the focus back to the bell.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(bell(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await link.focus();
    await picture(page, "bell-1-dana");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${STAFF}deals/${String(dealId)}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    // Opened is read, on the server, and the badge follows.
    await expect.poll(async () => (await notices(dana)).unreadCount).toBe(before.unreadCount);
    await expectCount(page, before.unreadCount);

    // ADA cannot open deals: her notice is the server's with no way in, and her bell draws words only.
    // Ada cannot open the deal: her notice does not name it (the engine names a record only to who can open it).
    const toAda = (await notices(ada)).items.find((one) => one.kind === "mention")!;
    expect([toAda.title, toAda.actionUrl, toAda.entity]).toEqual(["Ivy Sandoval mentioned you", null, null]);
    expect(`${toAda.title} ${toAda.body ?? ""}`).not.toContain(name);
    expect((await notices(ada)).unreadCount).toBe(adaBefore + 1);
    const adaPage = await (await as("ada")).newPage();
    await adaPage.goto(STAFF);
    await expectCount(adaPage, adaBefore + 1);
    await bell(adaPage).click();
    const adaItem = adaPage.getByTestId("bell-panel").getByTestId("bell-item").filter({ hasText: "Ivy Sandoval mentioned you" }).first();
    await expect(adaPage.getByTestId("bell-panel")).not.toContainText(name);
    await expect(adaItem).toContainText("Ivy Sandoval mentioned you");
    await expect(adaItem.getByRole("link")).toHaveCount(0);
    await expect(adaItem.locator('[data-link="0"]')).toHaveCount(1);
    // And the deal is not hers by any door.
    expect((await ada.get(data("deals", `/${String(dealId)}`))).status()).toBe(403);
    await picture(adaPage, "bell-2-ada");
    // "Mark all read": her badge goes, as the server's count does.
    await adaPage.getByRole("button", { name: "Mark all read" }).click();
    await expectCount(adaPage, 0);
    expect((await notices(ada)).unreadCount).toBe(0);

    // A second mention, and Dana marks all read from the list.
    await mention(ivy, data, dealId, `@[Dana Whitlock](${danaId}) the window moved.`);
    await expectCount(page, before.unreadCount + 1, A_MINUTE);
    await bell(page).click();
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expectCount(page, 0);
    expect((await notices(dana)).unreadCount).toBe(0);
    await expect(page.getByTestId("bell-panel").locator('[data-unread="1"]')).toHaveCount(0);
    expect(problems).toEqual([]);
  } finally {
    await removeDeals(await api("tessa"), data, "Spec: bell");
  }
});

test("390 wide, dark, in Arabic: the list sits inside the screen", async ({ as, api }) => {
  const context = await as("dana", { viewport: { width: 390, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  const { inArabic } = await import("./helpers.ts");
  await inArabic(await api("dana"), async () => {
    await page.goto(`${STAFF}today`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByTestId("bell").click();
    const panel = page.getByTestId("bell-panel");
    await expect(panel).toHaveAccessibleName("إشعارات Dana");
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await picture(page, "bell-3-arabic-390-dark");
    await page.keyboard.press("Escape");
  });
});
