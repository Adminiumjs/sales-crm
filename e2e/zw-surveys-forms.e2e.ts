/**
 * The CRM's screens with Forms installed: the aftercare call says when its
 * job's survey went and whether it came back, and What customers said marks
 * an answer that came from the survey, in light and in dark, and in Arabic
 * right to left at 390 wide. On a stand without Forms, Surveys waits for it
 * and no call says anything of a survey.
 *
 * The Forms run is a stand of its own (`CRM_STAND_ADD_ONS=invoices,inventory,forms`),
 * which brings the sample's forms, the fit-out survey's invitations and its
 * answers. The website form's card in the Team inbox and Settings' Inbox tab
 * are walked by `zw-inbox-forms.e2e.ts`, on either stand.
 */
import type { Page } from "@playwright/test";

import { expect, picture, stand, test } from "./fixtures.ts";
import { inArabic, STAFF, watch } from "./helpers.ts";

const withForms = (): boolean => stand().addOns.some((one) => one.key === "forms");
const noSidewaysScroll = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("without Forms, Surveys waits for it and no aftercare call says anything of a survey", async ({ as }) => {
  test.skip(withForms(), "the stand has Forms");
  const page = await (await as("hugo")).newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}aftercare-calls`);
  await expect(page.locator(".crm-ac-card").first()).toBeVisible();
  await expect(page.getByTestId("ac-survey")).toHaveCount(0);
  const config = (await (await page.request.get(`${STAFF}surface-config.json`)).json()) as { modules: Record<string, boolean> };
  expect(config.modules["surveys"]).not.toBe(true);
  expect(problems).toEqual([]);
});

test.describe("with Forms installed", () => {
  test.beforeEach(() => {
    test.skip(!withForms(), "the stand has no Forms: start it with CRM_STAND_ADD_ONS=invoices,inventory,forms");
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`the aftercare call says when its survey went and whether it came back, and an answer from it says so (${colorScheme})`, async ({ as }) => {
      const page = await (await as("hugo", { colorScheme })).newPage();
      const problems = watch(page);
      await page.goto(`${STAFF}aftercare-calls`);
      const lines = page.getByTestId("ac-survey");
      await expect(lines.first()).toBeVisible();
      for (const text of await lines.allTextContents()) expect(text).toMatch(/^Survey sent .+ · (answered .+|not answered yet)$/);
      // The sample's fit-out survey has both: answered, and still waiting.
      await expect(page.locator('[data-testid="ac-survey"][data-answered="1"]').first()).toBeVisible();
      await picture(page, `p71-aftercare-survey-${colorScheme}`);

      await page.goto(`${STAFF}what-customers-said`);
      const marked = page.getByTestId("fb-survey");
      await expect(marked.first()).toHaveText("From the survey");
      await expect(page.locator(".crm-skeleton")).toHaveCount(0);
      await picture(page, `p71-feedback-survey-${colorScheme}`);
      expect(problems).toEqual([]);
    });
  }

  test("in Arabic, at 390 wide, in the dark: the survey line and the survey's mark read right to left with no sideways scroll", async ({ as, api }) => {
    const hugo = await api("hugo");
    await inArabic(hugo, async () => {
      const page = await (await as("hugo", { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
      const problems = watch(page);
      await page.goto(`${STAFF}aftercare-calls`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByTestId("ac-survey").first()).toContainText("أُرسل الاستبيان في");
      await expect(page.locator(".crm-skeleton")).toHaveCount(0);
      expect(await noSidewaysScroll(page)).toBe(true);
      await picture(page, "p71-aftercare-survey-ar-390-dark");

      await page.goto(`${STAFF}what-customers-said`);
      await expect(page.getByTestId("fb-survey").first()).toHaveText("من الاستبيان");
      await expect(page.locator(".crm-skeleton")).toHaveCount(0);
      expect(await noSidewaysScroll(page)).toBe(true);
      await picture(page, "p71-feedback-survey-ar-390-dark");
      expect(problems).toEqual([]);
    });
  });

  test("the Surveys part is on, and the operations manager, who reads no invitations, reads no survey of a job", async ({ api }) => {
    const ada = await api("ada");
    const config = (await (await ada.get(`${STAFF}surface-config.json`)).json()) as { modules: Record<string, boolean> };
    expect(config.modules["surveys"]).toBe(true);
    const table = stand().tables["forms_invitations"];
    expect(table, "Forms' invitations on the stand").toBeDefined();
    expect((await ada.get(`/api/v1/data/${stand().connectionId}/${table!}?limit=1`)).status()).toBe(403);
    const hugo = await api("hugo");
    expect((await hugo.get(`/api/v1/data/${stand().connectionId}/${table!}?limit=1`)).status()).toBe(200);
  });
});
