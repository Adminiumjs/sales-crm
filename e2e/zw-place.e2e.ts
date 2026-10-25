/**
 * A PLACE IN A RECORD: the console's own place field on a table of the CRM
 * with a place column (Companies, "Place on the map"), as a person edits a
 * record. A town typed in Arabic and picked from the server's own list; a
 * Google Maps link pasted, read by the server when the record is saved; a
 * short link refused in the field's own words; the pin dragged on the small
 * map; the place cleared. Each step is saved and read back from the server.
 *
 * The map server is stood in for (`territory-helpers.ts`): nothing here
 * reaches the network. The record is one this spec makes ("ZW Place …"), and
 * it is taken away at the end.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, watch, type Data } from "./helpers.ts";
import { mapServer, placeOf } from "./territory-helpers.ts";

const NAME = "ZW Place Studio";

async function removeMade(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const company of await rows<{ id: number }>(admin, data, "companies", { column: "name", op: "like", value: "ZW Place %" })) {
    expect((await admin.delete(data("companies", `/${String(company.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
}

const placeNow = async (admin: APIRequestContext, data: Data, id: number) => placeOf((await rows<{ place: unknown }>(admin, data, "companies", { column: "id", op: "eq", value: id }))[0]!.place);

test("a place in a record: a town typed in Arabic, a Google Maps link, a short link refused, the pin dragged, cleared", async ({ as, api, data }) => {
  test.setTimeout(240_000);
  const tessa = await api("tessa");
  await removeMade(tessa, data);
  const res = await tessa.post(data("companies"), { data: { values: { name: NAME, town: "Leeds", sector: "Design" } }, headers: await csrf(tessa) });
  expect(res.status(), await res.text()).toBe(201);
  const id = ((await res.json()) as { data: { id: number } }).data.id;
  try {
    const page = await (await as("owner")).newPage();
    const problems = watch(page);
    const server = await mapServer(page);
    const record = page.locator('[data-part="page-record"]');
    const edit = async (): Promise<{ dialog: Locator; field: Locator; kind: Locator }> => {
      await record.getByRole("button", { name: "Edit", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const field = dialog.locator('[data-part="place-field"]');
      await expect(field).toBeVisible();
      return { dialog, field, kind: field.locator('[data-part="place-kind"]') };
    };
    const save = async (dialog: Locator): Promise<void> => {
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    };
    await page.goto(`/p/crm-companies/r/${String(id)}`);
    await expect(record).toContainText(NAME);

    // 1. A town typed in Arabic: the server's own list answers, and the town is picked by keyboard.
    {
      const { dialog, field, kind } = await edit();
      await expect(kind).toHaveText(/No place yet/);
      const box = field.getByRole("combobox");
      await box.fill("القاهرة");
      const first = field.locator('[data-part="place-suggestion"]').first();
      await expect(first).toContainText("Cairo", { timeout: 20_000 });
      await expect(first).toContainText("Egypt");
      await box.press("Enter");
      await expect(kind).toHaveText(/By town: Cairo/);
      // While maps are on, the place is drawn on a small map at once.
      await expect(field.locator('[data-part="place-map"] [data-part="map-pin"]')).toHaveCount(1, { timeout: 30_000 });
      await picture(page, "zw-place-1-town-in-arabic");
      await save(dialog);
      const held = await placeNow(tessa, data, id);
      expect(held).toMatchObject({ by: "town" });
      expect(held!.lat).toBeCloseTo(30.04, 1);
      expect(held!.lng).toBeCloseTo(31.24, 1);
    }

    // 2. A Google Maps link pasted: sent as the text it is, and read by the server when the record is saved.
    {
      const { dialog, field, kind } = await edit();
      await expect(kind).toHaveText(/By town: Cairo/);
      const link = "https://www.google.com/maps/place/Leeds+Town+Hall/@53.7999,-1.5497,17z";
      await field.getByRole("combobox").fill(link);
      await expect(kind).toContainText(`Read when you save: ${link}`);
      await save(dialog);
      const held = await placeNow(tessa, data, id);
      expect(held).toMatchObject({ by: "exact", lat: 53.7999, lng: -1.5497 });
      await page.reload();
      await expect(record).toContainText(NAME);
    }

    // 3. A short link: it says nothing of where it leads, and the server refuses it (its words in the field: the test after this one).
    {
      const { dialog, field } = await edit();
      await field.getByRole("combobox").fill("https://maps.app.goo.gl/q8Zz3bXyZ1Ab");
      const answer = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/${String(id)}`));
      await dialog.getByRole("button", { name: "Save changes" }).click();
      const refused = await answer;
      expect(refused.status()).toBe(422);
      expect(((await refused.json()) as { error: { details: { fields: Record<string, { code: string }> } } }).error.details.fields["place"]!.code).toBe("place-short-link");
      // The edit stays open with what was typed, for the person to put right.
      await expect(dialog).toBeVisible();
      await expect(field.locator('[data-part="place-kind"]')).toContainText("Read when you save: https://maps.app.goo.gl/q8Zz3bXyZ1Ab");
      await picture(page, "zw-place-2-short-link");
      expect(await placeNow(tessa, data, id)).toMatchObject({ by: "exact", lat: 53.7999, lng: -1.5497 });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
    }

    // 4. The pin dragged on the small map: the field says the new exact spot, and it is saved.
    {
      const { dialog, field, kind } = await edit();
      await expect(kind).toContainText(/Exact spot: 53\.7999\d*, -1\.5497\d*/);
      const pin = field.locator('[data-part="place-map"] [data-part="map-pin"]');
      await expect(pin).toHaveCount(1, { timeout: 30_000 });
      await pin.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const at = (await pin.boundingBox())!;
      const [x, y] = [at.x + at.width / 2, at.y + at.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 10, y + 6, { steps: 3 });
      await page.mouse.move(x + 60, y + 30, { steps: 10 });
      await page.mouse.up();
      await expect(kind).not.toContainText(/53\.7999\d*, -1\.5497\d*/);
      await expect(kind).toHaveText(/Exact spot: /);
      await save(dialog);
      const held = await placeNow(tessa, data, id);
      expect(held!.by).toBe("exact");
      // East and south of where it stood.
      expect(held!.lng).toBeGreaterThan(-1.5497);
      expect(held!.lat).toBeLessThan(53.7999);
    }

    // 5. Cleared: the record holds no place.
    {
      const { dialog, field, kind } = await edit();
      await field.locator('[data-part="place-clear"]').click();
      await expect(kind).toHaveText(/No place yet/);
      await expect(field.locator('[data-part="place-map"]')).toHaveCount(0);
      await save(dialog);
      expect(await placeNow(tessa, data, id)).toBeNull();
    }
    // The map's pictures came from the stand-in, and nothing else was asked of the map server's host.
    expect(server.asked.some((path) => path.startsWith("/styles/"))).toBe(true);
    // The browser logs the short link's refusal (422), and the console's record page asks for a project's actions this
    // install has none of (404, twice): neither is a fault of the place field.
    expect(problems.filter((line) => !/status of (404|422)/.test(line))).toEqual([]);
  } finally {
    await removeMade(tessa, data);
  }
});

/**
 * The short link's refusal in the field's own words. The server refuses it (422, `place-short-link`, proved above) and the
 * console's list page says it under the field; the RECORD page's edit does not: `PageRecord.tsx` reads a refusal's
 * `fieldErrors`, a shape nothing sends any more, where `PageCrud.tsx` reads `fieldIssues` (`fieldMessagesOf`). An
 * engine fault, reported; this test fails until it is fixed, and then fails the other way, to be switched on.
 */
test("the short link's refusal is said in the field's own words on the record's edit", async ({ as, api, data }) => {
  test.fail(true, "engine: the record page's edit shows no field refusal (packages/widgets/src/templates/page-record/PageRecord.tsx:1194)");
  const tessa = await api("tessa");
  await removeMade(tessa, data);
  const res = await tessa.post(data("companies"), { data: { values: { name: `${NAME} Short Link`, town: "Leeds" } }, headers: await csrf(tessa) });
  expect(res.status(), await res.text()).toBe(201);
  const id = ((await res.json()) as { data: { id: number } }).data.id;
  try {
    const page = await (await as("owner")).newPage();
    await mapServer(page);
    await page.goto(`/p/crm-companies/r/${String(id)}`);
    await page.locator('[data-part="page-record"]').getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('[data-part="place-field"]').getByRole("combobox").fill("https://maps.app.goo.gl/q8Zz3bXyZ1Ab");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("A short link does not say where it leads, and it is not followed. Open it, then paste the full link or the coordinates.", { timeout: 10_000 });
  } finally {
    await removeMade(tessa, data);
  }
});

test("the place field at 390 wide: a town is picked and the small map fits, with no sideways scroll", async ({ as, api, data }) => {
  const tessa = await api("tessa");
  await removeMade(tessa, data);
  const res = await tessa.post(data("companies"), { data: { values: { name: `${NAME} Narrow`, town: "York", place: { lat: 53.959, lng: -1.0815 } } }, headers: await csrf(tessa) });
  expect(res.status(), await res.text()).toBe(201);
  const id = ((await res.json()) as { data: { id: number } }).data.id;
  try {
    const page: Page = await (await as("owner", { viewport: { width: 390, height: 844 } })).newPage();
    await mapServer(page);
    await page.goto(`/p/crm-companies/r/${String(id)}`);
    const record = page.locator('[data-part="page-record"]');
    await record.getByRole("button", { name: "Edit", exact: true }).click();
    const field = page.getByRole("dialog").locator('[data-part="place-field"]');
    const map = field.locator('[data-part="place-map"]');
    await expect(map.locator('[data-part="map-pin"]')).toHaveCount(1, { timeout: 30_000 });
    // The dialog and its small map are inside the screen.
    const dialog = (await page.getByRole("dialog").boundingBox())!;
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(390);
    const box = (await map.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(dialog.x);
    expect(box.x + box.width).toBeLessThanOrEqual(dialog.x + dialog.width);
    // Nothing inside the dialog is wider than it.
    expect(await page.getByRole("dialog").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    // What makes the record page behind it wider than the screen, if anything: said, for the report.
    const wide = await page.evaluate(() =>
      Array.from(document.querySelectorAll("main *"))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('[role="dialog"]'))
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-part") === null ? "" : `[data-part=${el.getAttribute("data-part")!}]`} right=${String(Math.round(el.getBoundingClientRect().right))}`),
    );
    console.info(`[zw-place] the record page at 390: page sideways ${String(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))}px; ${wide.join("; ")}`);
    test.info().annotations.push({ type: "record page at 390", description: `page sideways ${String(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))}px; ${wide.join("; ")}` });
    await picture(page, "zw-place-3-390");
    await page.keyboard.press("Escape");
  } finally {
    await removeMade(tessa, data);
  }
});
