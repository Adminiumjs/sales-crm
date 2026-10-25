/**
 * Plan 67 gate G2, "A role's name in the reader's language": with the console in German, the CRM's sales manager role
 * is "Vertriebsleitung" (the name the app gives it in German) on Settings → Roles, on the People list and in a
 * person's Roles dialog (as the install's owner), and on Ivy's own Account page (she holds it). The language is put back.
 */
import { expect, picture, test } from "./fixtures.ts";
import { watch } from "./helpers.ts";
import { inLanguage, words } from "./zw-helpers.ts";

const GERMAN = "Vertriebsleitung";
const ENGLISH = "Sales manager";

test("the sales manager role reads Vertriebsleitung in German: Roles, People, a person's roles and their own account", async ({ as, api, stand }) => {
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
    // The People list's Roles column: judged after the rest, so that one miss does not hide the others.
    await expect.soft(row, "the People list names the role in the reader's language").toContainText(GERMAN);
    await expect.soft(row).not.toContainText(ENGLISH);
    expect(problems).toEqual([]);
  });

  // Ivy's own page.
  await inLanguage(await api("ivy"), "de-DE", async () => {
    const page = await (await as("ivy")).newPage();
    await page.goto("/account");
    await expect(page.getByText(say("account.roles"), { exact: true })).toBeVisible();
    await expect.soft(page.getByText(GERMAN), "Ivy's own page names her role in her language").toBeVisible();
    await expect.soft(page.locator("main")).not.toContainText(ENGLISH);
    await picture(page, "zw-role-name-account-de");
  });
});
