/**
 * The marketer's home past the enquiries: this month's campaigns, form
 * answers, funnels and website chats.
 *
 * The campaigns group is always there (Adminium's own campaigns, read by
 * everybody who signs in). The forms, funnels and chats groups are there only
 * with Forms, Pages and Live chat on the stand
 * (`CRM_STAND_ADD_ONS=…,forms,live-chat,pages`); without one, its group and its
 * tile are absent, never drawn empty. With Pages, the sample's "Open day"
 * funnel shows its steps in order: the open day's page, its form opened and
 * sent, the thanks page. Nothing on it makes or changes a page, a funnel, a
 * form or a campaign: the marketer reads them.
 *
 * What the server answers each role is proved in `proofs/crm-pages.test.ts`.
 */
import { expect, picture, test } from "./fixtures.ts";
import { inArabic, STAFF, watch } from "./helpers.ts";

test("the marketer's home shows campaigns, and forms, funnels and chats where their add-on is here, all read only", async ({ as, api, stand }) => {
  const has = (key: string) => stand.addOns.some((one) => one.key === key);
  const lena = await (await as("lena")).newPage();
  const problems = watch(lena);
  await lena.goto(`${STAFF}home`);
  const home = lena.locator('[data-screen="mkhome"]');
  await expect(home.getByRole("heading", { level: 1 })).toHaveText("Where the work is coming from");
  await expect(home.locator('section[data-group="campaigns"]')).toBeVisible();
  await expect(home.locator('[data-stat="campaigns"]')).toBeVisible();

  for (const [key, group, stat] of [
    ["forms", "forms", "answers"],
    ["pages", "funnels", "views"],
    ["live-chat", "chats", "chats"],
  ] as const) {
    if (has(key)) {
      await expect(home.locator(`section[data-group="${group}"]`), group).toBeVisible();
      await expect(home.locator(`[data-stat="${stat}"]`), stat).toBeVisible();
    } else {
      await expect(home.locator(`section[data-group="${group}"]`), group).toHaveCount(0);
      await expect(home.locator(`[data-stat="${stat}"]`), stat).toHaveCount(0);
    }
  }

  if (has("pages")) {
    // The sample's funnel: the open day, its form opened and sent there, and the thanks page, each with its views.
    const funnel = home.locator('section[data-group="funnels"] li[data-funnel]').filter({ hasText: "Open day" });
    await expect(funnel).toHaveCount(1);
    const steps = funnel.locator(".crm-mk-step");
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toContainText("Showroom open day");
    await expect(steps.nth(1)).toHaveAttribute("data-kind", "form-opened");
    await expect(steps.nth(3)).toContainText("Thanks, see you there");
    // Three of the sample's four pages are live.
    await expect(home.locator('[data-stat="views"] .crm-leads-note')).toHaveText("3 live pages");
  }

  // Read only: no button, form or field in any of the four groups.
  for (const group of ["campaigns", "forms", "funnels", "chats"]) {
    await expect(home.locator(`section[data-group="${group}"]`).locator("button, form, input, select, textarea")).toHaveCount(0);
  }
  await picture(lena, "p71-marketer-home");
  expect(problems).toEqual([]);

  // In Arabic on a phone: the groups fit the screen, nothing scrolls sideways.
  await inArabic(await api("lena"), async () => {
    const narrow = await (await as("lena", { viewport: { width: 390, height: 844 } })).newPage();
    await narrow.goto(`${STAFF}home`);
    await expect(narrow.locator('[data-screen="mkhome"] section[data-group="campaigns"] h2')).toContainText("الحملات");
    expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
