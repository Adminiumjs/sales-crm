/**
 * P00, the ground: the stand is a real install with the ledger's figures, each
 * person is who the sample says, the staff side opens for whoever is signed
 * in and speaks their language, and a refusal is the server's.
 */
import { expect, picture, signIn, test } from "./fixtures.ts";

const STAFF = "/apps/crm/staff/";
const open = { column: "state", op: "eq", value: "open" };
const where = (condition: unknown) => `?limit=200&where=${encodeURIComponent(JSON.stringify(condition))}`;
const sum = (rows: { amount: unknown }[]) => rows.reduce((total, row) => total + Number(row.amount), 0);

test("the stand holds the sample as the ledger counts it, for each person as themselves", async ({ api, data, stand }) => {
  expect(stand.sampleRows).toBeGreaterThan(600);
  // The sales manager's board: 14 open deals, 286,300. Dana's own: 6 and 143,400.
  const ivys = (await (await (await api("ivy")).get(data("deals", where(open)))).json()) as { data: { amount: unknown }[] };
  expect([ivys.data.length, sum(ivys.data)]).toEqual([14, 286_300]);
  const danas = (await (await (await api("dana")).get(data("deals", where(open)))).json()) as { data: { amount: unknown; owner_id: string }[] };
  expect([danas.data.length, sum(danas.data)]).toEqual([6, 143_400]);
  expect(new Set(danas.data.map((deal) => deal.owner_id))).toEqual(new Set([stand.people["dana"]!.id]));
});

test("the staff side opens for a rep, and says who is signed in", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(STAFF);
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Dana Whitlock · Sales rep");
  expect(errors).toEqual([]);
  await picture(page, "1-dana-signed-in");
});

test("the config says who they are, what they may do and which parts are on; nothing of anybody else", async ({ api, stand }) => {
  const read = async (person: string) => (await (await (await api(person)).get(`${STAFF}surface-config.json`)).json()) as { user: { id: string; name: string }; access: { tables: Record<string, string[]>; roles: { slug: string }[] }; modules: Record<string, boolean>; tables: Record<string, string>; csrfToken: string };
  const dana = await read("dana");
  expect(dana.user).toMatchObject({ id: stand.people["dana"]!.id, name: "Dana Whitlock" });
  expect(dana.access.roles.map((role) => role.slug)).toEqual(["crm-rep"]);
  expect(dana.access.tables["deals"]).toEqual(["read", "create", "update"]);
  expect(dana.access.tables["stages"]).toEqual(["read"]);
  // Every part was switched on at the install.
  expect(Object.values(dana.modules)).toEqual(Array.from({ length: 10 }, () => true));
  // The marketer reads no deal, and her config says so.
  const lena = await read("lena");
  expect(lena.access.tables["deals"] ?? []).toEqual([]);
  expect(lena.access.tables["enquiries"]).toEqual(["read", "create"]);
  expect(lena.csrfToken).not.toBe(dana.csrfToken);
});

test("a table that is not theirs is refused by the server, not by a missing button", async ({ api, data }) => {
  const lena = await api("lena");
  expect((await lena.get(data("deals", "?limit=5"))).status()).toBe(403);
  // A rep reads her own deals, and a colleague's by its key is not there.
  const dana = await api("dana");
  const sams = (await (await (await api("sam")).get(data("deals", "?limit=1"))).json()) as { data: { id: number }[] };
  expect((await dana.get(data("deals", `/${String(sams.data[0]!.id)}`))).status()).toBe(404);
});

test("signed out, the staff side is Adminium's sign-in, and nothing of the app", async ({ browser, stand }) => {
  const context = await browser.newContext({ baseURL: stand.url });
  const page = await context.newPage();
  const config = await context.request.get(`${STAFF}surface-config.json`, { maxRedirects: 0 });
  expect([401, 302, 303]).toContain(config.status());
  await page.goto(STAFF);
  await expect(page).toHaveURL(/login|sign-in|signin/);
  await expect(page.getByTestId("signed-in-as")).toHaveCount(0);
  await context.close();
});

test("a deep address under the staff side is still the app, and an address that names no screen says so", async ({ as }) => {
  const page = await (await as("dana")).newPage();
  await page.goto(`${STAFF}nowhere/12`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("That page has moved on");
  // The frame is still there: her name and role in the bar.
  await expect(page.getByRole("button", { name: "Your menu" })).toContainText("Dana Whitlock");
  await expect(page.getByRole("button", { name: "Your menu" })).toContainText("Sales rep");
  await picture(page, "4-dana-no-such-page");
});

test("signing out from the app ends the session, and the app's address is the sign-in again", async ({ browser, stand }) => {
  // A session of its own, so the kept cookies of the other specs stay good.
  const context = await browser.newContext({ baseURL: stand.url });
  await signIn(context, "leo");
  const page = await context.newPage();
  await page.goto(STAFF);
  await page.getByRole("button", { name: "Your menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/login|sign-in|signin/);
  expect([401, 302, 303]).toContain((await context.request.get(`${STAFF}surface-config.json`, { maxRedirects: 0 })).status());
  await context.close();
});

test("below 900 wide the menu is a drawer, and the page has no sideways scroll at 390", async ({ as }) => {
  const context = await as("dana", { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(STAFF);
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open the menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  await picture(page, "3-dana-390");
});

test("the app speaks the language the person chose in Adminium, right to left for Arabic", async ({ as }) => {
  const context = await as("priya");
  const page = await context.newPage();
  await page.goto(STAFF);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const config = (await (await context.request.get(`${STAFF}surface-config.json`)).json()) as { csrfToken: string };
  const saved = await context.request.patch("/api/v1/me/prefs", { data: { locale: "ar_EG" }, headers: { "x-adminium-csrf": config.csrfToken } });
  expect(saved.status(), await saved.text()).toBe(200);
  try {
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar-EG");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("signed-in-as")).toContainText("Priya Raman");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("يُعاد بناء الشاشات");
    await picture(page, "2-priya-arabic-right-to-left");
  } finally {
    await context.request.patch("/api/v1/me/prefs", { data: { locale: "en_US" }, headers: { "x-adminium-csrf": config.csrfToken } });
  }
});
