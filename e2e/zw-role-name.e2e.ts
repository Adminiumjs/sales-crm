/**
 * Plan 67 gate G2, "A role's name in the reader's language": with the console in German, the CRM's sales manager role
 * is "Vertriebsleitung" (the name the app gives it in German) on Settings → Roles and in a person's Roles dialog (as the
 * install's owner). Two places still name it otherwise, each pinned by a test of its own that is expected to fail until the
 * engine is fixed: the People list's Roles column, and Ivy's own Account page. The language is put back.
 */
import { expect, picture, test } from "./fixtures.ts";
import { watch } from "./helpers.ts";
import { inLanguage, words } from "./zw-console-helpers.ts";

const GERMAN = "Vertriebsleitung";
const ENGLISH = "Sales manager";

test("the sales manager role reads Vertriebsleitung in German: Settings → Roles and a person's Roles dialog", async ({ as, api, stand }) => {
  const say = words("de-DE");
  const owner = await api("owner");
  const ivy = stand.people["ivy"]!;
  await inLanguage(owner, "de-DE", async () => {
    const page = await (await as("owner")).newPage();
    const problems = watch(page);
    await page.goto("/settings/roles");
    await expect(page.getByRole("heading", { name: say("roles:title"), level: 1 })).toBeVisible();
    const roleRow = page.getByTestId("roles-table").getByRole("row").filter({ hasText: GERMAN });
    await expect(roleRow).toHaveCount(1);
    await expect(page.getByTestId("roles-table")).not.toContainText(ENGLISH);
    await picture(page, "zw-role-name-roles-de");

    // People: Ivy's row, and the dialog of her roles.
    await page.goto("/settings/team");
    const row = page.getByTestId("team-row").filter({ hasText: ivy.email });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: say("team.action.roles"), exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(say("team.rolesDialog.title", { name: ivy.name }))).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: GERMAN })).toBeChecked();
    await expect(dialog).not.toContainText(ENGLISH);
    await dialog.getByRole("button", { name: say("common.cancel"), exact: true }).click();
    expect(problems).toEqual([]);
  });
});

// Engine fault: the People list's roles carry the stored name, not the reader's (apps/server/src/routes/users/index.ts:79-81).
test("the People list names Ivy's role in German", async ({ as, api, stand }) => {
  test.fail();
  const ivy = stand.people["ivy"]!;
  await inLanguage(await api("owner"), "de-DE", async () => {
    const page = await (await as("owner")).newPage();
    await page.goto("/settings/team");
    const row = page.getByTestId("team-row").filter({ hasText: ivy.email });
    await expect(row).toBeVisible();
    await expect(row).toContainText(GERMAN, { timeout: 5000 });
    await expect(row).not.toContainText(ENGLISH);
  });
});

// Engine fault: the Account page lists role slugs (apps/server/src/routes/bootstrap/handlers.ts:998, apps/dashboard/src/pages/AccountPage.tsx:243).
// On MySQL its cards are also drawn in English under a German menu (seen twice, never on SQLite or Postgres).
test("Ivy's own Account page names her role in German", async ({ as, api }) => {
  test.fail();
  const say = words("de-DE");
  await inLanguage(await api("ivy"), "de-DE", async () => {
    const page = await (await as("ivy")).newPage();
    await page.goto("/account");
    await expect(page.getByText(say("account.roles"), { exact: true })).toBeVisible();
    await expect(page.getByText(GERMAN)).toBeVisible({ timeout: 5000 });
    await expect(page.locator("main")).not.toContainText(ENGLISH);
  });
});
