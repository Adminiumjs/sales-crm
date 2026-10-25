/**
 * Plan 67 gate G1, "Rows and Teams in a running dashboard", in English and in Arabic: Adminium's console with the CRM
 * installed, as the install's owner.
 *
 *  1. Settings → Roles & permissions → Rows on a role: the CRM's Sales rep reaches its own deals, said in words, and
 *     "Try it as" Dana counts what the server gives Dana; the sales manager, tried as Ivy, counts her team's. A role made
 *     here is limited to "their own", saved, and the server holds it.
 *  2. Settings → Team → Teams: the sample's Sales team led by Ivy; a team made, led and deleted in its sheet.
 *  3. Deleting a person who owns rows: the dialog names them and asks who takes them, refuses without, and the rows go
 *     to the person chosen.
 *
 * Nothing of the sample is changed: the role, the team, the people and the deal are this spec's own, and removed after.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, removeDeals, rows, watch, type Data } from "./helpers.ts";
import { room } from "./p12-helpers.ts";
import { inLanguage, words, type ConsoleLocale } from "./zw-console-helpers.ts";

interface RoleRef {
  id: string;
  slug: string;
  name: string;
}
interface RowsTable {
  ref: string;
  tableId: string;
  label: string;
  ways: { kind: string; column?: string; label: string }[];
  limit: Record<string, unknown> | null;
}

const STAMP = String(Date.now()).slice(-6);
const LANGUAGES: { locale: ConsoleLocale; dir: "ltr" | "rtl" }[] = [
  { locale: "en-US", dir: "ltr" },
  { locale: "ar-EG", dir: "rtl" },
];

async function roles(owner: APIRequestContext): Promise<RoleRef[]> {
  return ((await (await owner.get("/api/v1/roles")).json()) as { roles: RoleRef[] }).roles;
}

async function rowsOf(owner: APIRequestContext, roleId: string): Promise<RowsTable[]> {
  const res = await owner.get(`/api/v1/roles/${roleId}/rows`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { tables: RowsTable[] }).tables;
}

/** The deals a person may read, as the server answers them: the count "Try it as" must say. */
async function dealsReadBy(person: APIRequestContext, data: Data): Promise<number> {
  return (await rows(person, data, "deals", undefined, "&select=id")).length;
}

async function openRows(page: Page, role: RoleRef): Promise<void> {
  await page.goto("/settings/roles");
  await page.getByTestId(`roles-rows-${role.slug}`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

for (const { locale, dir } of LANGUAGES) {
  test.describe(`in ${locale}`, () => {
    test(`Rows on a role: the rep's own deals in words, tried as Dana and Ivy; a role limited and saved (${locale})`, async ({ as, api, stand, data }) => {
      test.setTimeout(180_000);
      const owner = await api("owner");
      // The Roles page and its dialogs spend many of the owner's 300 requests a minute: a fresh minute first.
      await room(owner, data as Data, 200);
      const say = words(locale);
      const all = await roles(owner);
      const rep = all.find((role) => role.name === "Sales rep");
      const manager = all.find((role) => role.name === "Sales manager");
      expect(rep && manager, all.map((role) => role.name).join(", ")).toBeTruthy();
      const totalDeals = await dealsReadBy(owner, data as Data);
      const danaReads = await dealsReadBy(await api("dana"), data as Data);
      const ivyReads = await dealsReadBy(await api("ivy"), data as Data);
      expect(danaReads).toBeGreaterThan(0);
      expect(danaReads).toBeLessThan(totalDeals);
      expect(ivyReads).toBeGreaterThan(danaReads);
      const dealsId = stand.tables["crm_deals"]!;

      // A role of this spec's own, reading and changing deals by name, every row.
      const headers = await csrf(owner);
      const made = await owner.post("/api/v1/roles", { data: { name: `Spec rows ${locale} ${STAMP}` }, headers });
      expect(made.status(), await made.text()).toBeLessThan(300);
      const spec = (await roles(owner)).find((role) => role.name === `Spec rows ${locale} ${STAMP}`)!;
      const granted = await owner.put(`/api/v1/roles/${spec.id}/permissions`, { data: { grants: ["read", "update"].map((action) => `table:${stand.connectionId}:${dealsId}:${action}`) }, headers });
      expect(granted.status(), await granted.text()).toBeLessThan(300);

      try {
        await inLanguage(owner, locale, async () => {
          const page = await (await as("owner")).newPage();
          const problems = watch(page);
          const [repHere, managerHere] = [(await roles(owner)).find((one) => one.id === rep!.id)!, (await roles(owner)).find((one) => one.id === manager!.id)!];

          // The rep: deals are theirs by the owner column (and more ways the app wrote); read is "their own".
          await openRows(page, rep!);
          await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe(dir);
          const dialog = page.getByRole("dialog");
          await expect(dialog.getByRole("heading", { name: say("roles:rows.title", { role: repHere.name }) })).toBeVisible();
          const repDeals = (await rowsOf(owner, rep!.id)).find((table) => table.tableId === dealsId)!;
          const ownerWay = repDeals.ways.find((way) => way.kind === "person" && way.column === "owner_id")!;
          const card = dialog.getByTestId(`roles-rows-table-${dealsId}`);
          await expect(card.getByRole("heading", { name: repDeals.label })).toBeVisible();
          const readSentence = card.getByTestId(`roles-rows-${dealsId}-read-sentence`);
          await expect(readSentence).toContainText(say("roles:rows.wayIs.person", { column: ownerWay.label }));
          await expect(readSentence).not.toContainText(say("roles:rows.sentence.all", { table: repDeals.label }));
          // Tried as Dana: what the server gives her.
          await dialog.getByTestId("roles-rows-person").selectOption({ label: stand.people["dana"]!.name });
          await expect(card.getByTestId(`roles-rows-${dealsId}-count`)).toContainText(say("roles:rows.count", { name: stand.people["dana"]!.name, reached: danaReads, total: totalDeals, table: repDeals.label }));
          await picture(page, `zw-rows-rep-${locale}`);
          await dialog.getByRole("button", { name: say("common.cancel"), exact: true }).click();
          await expect(dialog).toBeHidden();

          // The sales manager, tried as Ivy: her team's deals.
          await openRows(page, manager!);
          await expect(page.getByRole("dialog").getByRole("heading", { name: say("roles:rows.title", { role: managerHere.name }) })).toBeVisible();
          await page.getByRole("dialog").getByTestId("roles-rows-person").selectOption({ label: stand.people["ivy"]!.name });
          await expect(page.getByRole("dialog").getByTestId(`roles-rows-table-${dealsId}`).getByTestId(`roles-rows-${dealsId}-count`)).toContainText(say("roles:rows.count", { name: stand.people["ivy"]!.name, reached: ivyReads, total: totalDeals, table: repDeals.label }));
          await page.getByRole("dialog").getByRole("button", { name: say("common.cancel"), exact: true }).click();

          // This spec's role: every row, then "their own" for reading, saved.
          await openRows(page, spec);
          const mine = page.getByRole("dialog").getByTestId(`roles-rows-table-${dealsId}`);
          const sentence = mine.getByTestId(`roles-rows-${dealsId}-read-sentence`);
          // Deals are somebody's in more than one way (the owner, who is on the deal, who covers), so "every row" names none.
          await expect(sentence).toHaveText(repDeals.ways.length === 1 ? say("roles:rows.sentence.allWho", { table: repDeals.label, column: ownerWay.label }) : say("roles:rows.sentence.all", { table: repDeals.label }));
          await mine.getByTestId(`roles-rows-${dealsId}-read`).getByRole("radio", { name: say("roles:rows.reach.own") }).click();
          await expect(sentence).toContainText(say("roles:rows.wayIs.person", { column: ownerWay.label }));
          await page.getByRole("dialog").getByTestId("roles-rows-person").selectOption({ label: stand.people["dana"]!.name });
          await expect(mine.getByTestId(`roles-rows-${dealsId}-count`)).toContainText(say("roles:rows.count", { name: stand.people["dana"]!.name, reached: danaReads, total: totalDeals, table: repDeals.label }));
          await page.getByTestId("roles-rows-save").click();
          await expect(page.getByRole("dialog")).toBeHidden();
          const held = (await rowsOf(owner, spec.id)).find((table) => table.tableId === dealsId)!;
          expect(held.limit).toMatchObject({ read: { reach: "own" } });
          expect(held.limit?.["update"]).toBeUndefined();
          expect(problems).toEqual([]);
        });
      } finally {
        await owner.delete(`/api/v1/roles/${spec.id}`, { headers });
      }
    });

    test(`Teams: the sample's Sales team led by Ivy; a team made, led and deleted in its sheet (${locale})`, async ({ as, api, stand, data }) => {
      const owner = await api("owner");
      await room(owner, data as Data, 120);
      const say = words(locale);
      const name = `Spec team ${locale} ${STAMP}`;
      try {
        await inLanguage(owner, locale, async () => {
          const page = await (await as("owner")).newPage();
          const problems = watch(page);
          await page.goto("/settings/team");
          await page.getByRole("navigation", { name: say("nav.primary") }).getByRole("link", { name: say("nav.teams"), exact: true }).click();
          await expect(page).toHaveURL(/\/settings\/teams$/);
          await expect(page.getByRole("heading", { name: say("team.teams.title"), level: 1 })).toBeVisible();
          await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe(dir);
          // The sample's team: Ivy leads, her four reps are in it.
          const sales = page.getByTestId("teams-row-Sales");
          await expect(sales).toContainText(stand.people["ivy"]!.name);
          // Its members as the server lists them, by first name, the lead apart.
          const held = ((await (await owner.get("/api/v1/teams")).json()) as { teams: { name: string; members: { name: string; lead: boolean }[] }[] }).teams.find((team) => team.name === "Sales")!;
          expect(held.members.filter((member) => member.lead).map((member) => member.name)).toEqual([stand.people["ivy"]!.name]);
          const reps = held.members.filter((member) => !member.lead).map((member) => member.name.split(" ")[0]);
          expect([...reps].sort()).toEqual(["Dana", "Leo", "Priya", "Sam"]);
          await expect(sales).toContainText(say("team.teams.inAll", { names: reps.join(", "), count: 5 }));

          // A team of this spec's own: Leo leads it, Dana is in it.
          await page.getByTestId("teams-new").click();
          const sheet = page.getByRole("dialog");
          await sheet.getByTestId("team-sheet-name").fill(name);
          for (const person of ["leo", "dana"]) {
            await sheet.getByTestId("team-sheet-add").selectOption({ label: stand.people[person]!.name });
            await sheet.getByTestId("team-sheet-add-confirm").click();
          }
          await sheet.getByTestId(`team-sheet-member-${stand.people["leo"]!.name}`).getByRole("checkbox").check();
          await sheet.getByTestId("team-sheet-save").click();
          await expect(sheet).toBeHidden();
          const row = page.getByTestId(`teams-row-${name}`);
          await expect(row).toContainText(stand.people["leo"]!.name);
          await expect(row).toContainText(say("team.teams.inAll", { names: "Dana", count: 2 }));
          const mine = ((await (await owner.get("/api/v1/teams")).json()) as { teams: { name: string; members: { name: string; lead: boolean }[] }[] }).teams.find((team) => team.name === name);
          expect(mine?.members.map((member) => [member.name, member.lead]).sort()).toEqual([[stand.people["dana"]!.name, false], [stand.people["leo"]!.name, true]]);
          await picture(page, `zw-teams-${locale}`);

          // People says it on Leo's row.
          await page.goto("/settings/team");
          const leo = page.getByTestId("team-row").filter({ hasText: stand.people["leo"]!.email });
          await expect(leo.getByTestId("team-row-teams")).toContainText(say("team.teamLeads", { team: name }));

          // Deleted from its sheet, after the question.
          await page.goto("/settings/teams");
          await page.getByRole("button", { name, exact: true }).click();
          await page.getByTestId("team-sheet-delete").click();
          await expect(page.getByText(say("team.teams.deleteBody"))).toBeVisible();
          await page.getByTestId("teams-delete-confirm").click();
          await expect(page.getByTestId(`teams-row-${name}`)).toHaveCount(0);
          await expect(page.getByTestId("teams-row-Sales")).toBeVisible();
          expect(problems).toEqual([]);
        });
      } finally {
        const teams = ((await (await owner.get("/api/v1/teams")).json()) as { teams: { id: string; name: string }[] }).teams;
        for (const team of teams.filter((one) => one.name === name)) await owner.delete(`/api/v1/teams/${team.id}`, { headers: await csrf(owner) });
      }
    });

    test(`Deleting a person who owns rows: asked who takes them, refused without, handed over (${locale})`, async ({ as, api, stand, data }) => {
      test.setTimeout(180_000);
      const owner = await api("owner");
      await room(owner, data as Data, 120);
      const tessa = await api("tessa");
      const say = words(locale);
      const headers = await csrf(owner);
      const leaver = { name: `Spec Leaver ${locale.slice(0, 2)} ${STAMP}`, email: `spec-leaver-${locale.slice(0, 2)}-${STAMP}@crm.test` };
      const rep = (await roles(owner)).find((role) => role.name === "Sales rep")!;
      const made = await owner.post("/api/v1/users", { data: { ...leaver, roleIds: [rep.id] }, headers });
      expect(made.status(), await made.text()).toBe(201);
      const leaverId = ((await made.json()) as { user: { id: string } }).user.id;
      const dealName = `Spec leaver's deal ${locale} ${STAMP}`;
      try {
        // A deal of theirs, made by the CRM admin.
        const [stage] = await rows<{ id: number }>(tessa, data as Data, "stages", undefined, "&sort=position");
        const [company] = await rows<{ id: number }>(tessa, data as Data, "companies");
        const deal = await tessa.post(data("deals"), { data: { values: { name: dealName, company_id: company!.id, owner_id: leaverId, stage_id: stage!.id, typed_amount: 1200 } }, headers: await csrf(tessa) });
        expect(deal.status(), await deal.text()).toBe(201);
        const dealId = ((await deal.json()) as { data: { id: number } }).data.id;
        const named = (await (await owner.get(`/api/v1/users/${leaverId}/rows`)).json()) as { total: number; named: { tableId: string; tableLabel: string; rows: number }[] };
        expect(named.named.find((one) => one.tableId === stand.tables["crm_deals"])?.rows).toBe(1);

        await inLanguage(owner, locale, async () => {
          const page = await (await as("owner")).newPage();
          const problems = watch(page);
          await page.goto("/settings/team");
          await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe(dir);
          const row = page.getByTestId("team-row").filter({ hasText: leaver.email });
          await row.getByRole("button", { name: say("team.action.remove"), exact: true }).click();
          const dialog = page.getByRole("dialog");
          const handOver = dialog.getByTestId("team-remove-rows");
          await expect(handOver).toContainText(say("team.handOver.title", { count: named.total }));
          await expect(handOver).toContainText(say("team.handOver.remove", { name: leaver.name }));
          // Read in the reader's language: the server's table labels.
          const here = (await (await owner.get(`/api/v1/users/${leaverId}/rows`)).json()) as { named: { tableId: string; tableLabel: string; rows: number }[] };
          for (const line of here.named) await expect(handOver).toContainText(say("team.remove.rows.line", { table: line.tableLabel, count: line.rows }));
          // The email typed, but nobody chosen: refused, and the account is still there.
          await dialog.getByRole("textbox").fill(leaver.email);
          await dialog.getByRole("button", { name: say("team.remove.confirm"), exact: true }).click();
          await expect(dialog.getByTestId("team-remove-error")).toContainText(say("team.remove.rows.needed"));
          expect((await owner.get(`/api/v1/users/${leaverId}`)).status()).toBe(200);
          // Handed to the CRM admin, then deleted.
          await handOver.getByTestId("team-remove-rows-to").selectOption({ label: stand.people["tessa"]!.name });
          await picture(page, `zw-delete-person-${locale}`);
          await dialog.getByRole("button", { name: say("team.remove.confirm"), exact: true }).click();
          await expect(dialog).toBeHidden();
          await expect(page.getByTestId("team-row").filter({ hasText: leaver.email })).toHaveCount(0);
          expect(problems).toEqual([]);
        });
        expect((await owner.get(`/api/v1/users/${leaverId}`)).status()).toBe(404);
        const [after] = await rows<{ id: number; owner_id: string }>(tessa, data as Data, "deals", { column: "id", op: "eq", value: dealId });
        expect(after?.owner_id).toBe(stand.people["tessa"]!.id);
      } finally {
        await removeDeals(tessa, data as Data, `Spec leaver's deal ${locale}`);
        await owner.delete(`/api/v1/users/${leaverId}?permanent=true&handTo=${stand.people["tessa"]!.id}`, { headers }).catch(() => undefined);
      }
    });
  });
}
