/**
 * Plan 67 gate G2, "Parts at install and after", the half after the install: the app's page in Studio → its Parts card.
 * The install's owner switches Inbox off: the dialog lists what is open in it (as the server counts it), its menu goes
 * (the console's Enquiries entry; the Inbox heading of the CRM admin's menu on the staff side), and its pages opened by
 * their address say the part is switched off, in the console and on the staff side. Switched on again, it is all back.
 * (The install half, from the install wizard, is `zw-install-wizard.e2e.ts`, on a stand of its own.)
 *
 * Inbox is switched on again whatever happened: nothing of it is changed while it is off, and its records stay.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { STAFF, unfoldMenu, watch } from "./helpers.ts";
import { words } from "./zw-helpers.ts";

const say = words("en-US");
const section = (page: Page) => page.locator('[data-part="nav-app-section"]').filter({ hasText: "Sales CRM" });
const staffMenu = (page: Page) => page.getByRole("navigation", { name: "Menu" });

interface Open {
  open: { label: string; rows: number }[];
  rules: number;
  stranded: number;
}

async function inboxOn(owner: APIRequestContext): Promise<boolean> {
  const parts = ((await (await owner.get("/api/v1/apps/crm/parts")).json()) as { parts: { id: string; on?: boolean; switch?: boolean }[] }).parts;
  const inbox = parts.find((part) => part.id === "inbox")!;
  return inbox.switch ?? inbox.on ?? false;
}

/** The lines the dialog must list, from what the server counts open in the part. */
function openLines(open: Open): string[] {
  return [
    ...open.open.map((table) => say("studio:appParts.offDialog.openRows", { n: table.rows, table: table.label })),
    ...(open.rules === 0 ? [] : [open.rules === 1 ? say("studio:appParts.offDialog.oneRule") : say("studio:appParts.offDialog.rules", { n: open.rules })]),
    ...(open.stranded === 0 ? [] : [open.stranded === 1 ? say("studio:appParts.offDialog.oneStranded") : say("studio:appParts.offDialog.stranded", { n: open.stranded })]),
  ];
}

test("Inbox switched off on the app's Parts card: what is open is listed, its menu goes, its pages say so; on again, all back", async ({ as, api }) => {
  test.setTimeout(180_000);
  const owner = await api("owner");
  expect(await inboxOn(owner)).toBe(true);
  const open = (await (await owner.get("/api/v1/apps/crm/parts/inbox/open")).json()) as Open;
  // The sample's unclaimed enquiries are open in it.
  expect(open.open.length, JSON.stringify(open)).toBeGreaterThan(0);

  const studio = await (await as("owner")).newPage();
  const problems = watch(studio);
  const tessa = await (await as("tessa")).newPage();

  // Before: the console lists Enquiries; the CRM admin's menu has its Inbox heading.
  await studio.goto("/");
  const enquiries = section(studio).getByRole("link", { name: "Enquiries", exact: true });
  await expect(enquiries).toBeVisible();
  const enquiriesPage = (await enquiries.getAttribute("href"))!;
  expect(enquiriesPage).toMatch(/^\/p\//);
  await tessa.goto(STAFF);
  await unfoldMenu(tessa);
  await expect(staffMenu(tessa).getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(staffMenu(tessa).getByRole("link", { name: "Team inbox", exact: true })).toBeVisible();

  try {
    await studio.goto("/studio/apps/crm");
    const card = studio.getByTestId("app-parts");
    await expect(card.getByText(say("studio:appParts.title"), { exact: true })).toBeVisible();
    const inbox = card.locator('li[data-part="inbox"]');
    await expect(inbox).toHaveAttribute("data-on", "true");
    await card.getByRole("switch", { name: say("studio:appParts.switch", { part: "Inbox" }) }).click();
    const dialog = studio.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: say("studio:appParts.offDialog.title", { part: "Inbox" }) })).toBeVisible();
    const body = dialog.getByTestId("part-off-dialog");
    await expect(body).toContainText(say("studio:appParts.offDialog.stops"));
    await expect(body).toContainText(say("studio:appParts.offDialog.open"));
    await expect(body.locator('[data-part="open"] li')).toHaveText(openLines(open));
    await expect(body).toContainText(say("studio:appParts.offDialog.stays"));
    await picture(studio, "zw-parts-inbox-off-dialog");
    await dialog.getByRole("button", { name: say("studio:appParts.offDialog.confirm"), exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(inbox).toHaveAttribute("data-on", "false");
    expect(await inboxOn(owner)).toBe(false);

    // Its menu goes: the console's entry, and the staff side's heading.
    await studio.goto("/");
    await expect(section(studio).getByRole("link", { name: "Overview", exact: true })).toBeVisible();
    await expect(section(studio).getByRole("link", { name: "Enquiries", exact: true })).toHaveCount(0);
    await tessa.goto(STAFF);
    await unfoldMenu(tessa);
    await expect(staffMenu(tessa).getByRole("link").first()).toBeVisible();
    await expect(staffMenu(tessa).getByRole("button", { name: "Inbox" })).toHaveCount(0);
    await expect(staffMenu(tessa).getByRole("link", { name: "Team inbox", exact: true })).toHaveCount(0);

    // Its pages by their address say it is switched off.
    await studio.goto(enquiriesPage);
    const hero = studio.locator('[data-part="state-hero"][data-state="part-off"]');
    await expect(hero.getByRole("heading", { level: 1 })).toHaveText(say("states.partOff.title"));
    await picture(studio, "zw-parts-inbox-off-console-page");
    await tessa.goto(`${STAFF}inbox`);
    await expect(tessa.locator(".crm-plain")).toContainText("Inbox is switched off for this install. If you need it, ask the person who runs this install.");
    await picture(tessa, "zw-parts-inbox-off-staff-page");
    const ownStaff = await (await as("owner")).newPage();
    await ownStaff.goto(`${STAFF}inbox`);
    await expect(ownStaff.locator(".crm-plain")).toContainText("Inbox is switched off. Switch it on in Adminium");

    // On again, from the same card.
    await studio.goto("/studio/apps/crm");
    await studio.getByTestId("app-parts").getByRole("switch", { name: say("studio:appParts.switch", { part: "Inbox" }) }).click();
    await expect(studio.getByTestId("part-on-dialog")).toContainText(say("studio:appParts.onDialog.back"));
    await studio.getByRole("dialog").getByRole("button", { name: say("studio:appParts.onDialog.confirm"), exact: true }).click();
    await expect(studio.getByRole("dialog")).toBeHidden();
    await expect(studio.getByTestId("app-parts").locator('li[data-part="inbox"]')).toHaveAttribute("data-on", "true");
  } finally {
    if (!(await inboxOn(owner))) {
      const res = await owner.put("/api/v1/apps/crm/parts/inbox", { data: { on: true }, headers: { "x-adminium-csrf": ((await (await owner.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string }).csrfToken } });
      expect(res.status(), await res.text()).toBe(200);
    }
  }

  // All back: the entry, the heading, the page.
  await studio.goto("/");
  await expect(section(studio).getByRole("link", { name: "Enquiries", exact: true })).toBeVisible();
  await tessa.goto(`${STAFF}inbox`);
  await unfoldMenu(tessa);
  await expect(staffMenu(tessa).getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(tessa.getByRole("heading", { level: 1 })).not.toHaveText("This page is not part of your role");
  expect(problems).toEqual([]);
});
