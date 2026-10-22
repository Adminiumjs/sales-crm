/**
 * P06, the customer's quote page (on F16): what somebody with no account sees
 * behind the link of a quote's e-mail, in a browser that is signed in to
 * nothing.
 *
 * From the sample: Q-1002 (d1) version 1 is sent at 52,800 before tax and
 * valid until Thu 30 Jul, so it can still be answered on the ledger's Tuesday
 * 28 Jul; Q-1001 (d5) version 1 ran out on Sun 26 Jul; Q-1004 was replaced by
 * the sent Q-1006. The spec answers none of the sample's quotes: it makes a
 * deal of its own ("Customer spec: two quotes") with two quotes, accepts one and
 * declines the other, and closes the deal as lost at the end.
 *
 * THE FILE'S NAME PUTS IT LAST. Its deal ends lost with two answered quotes,
 * which no spec can take away again (a sent quote stays), and the specs before
 * it count the year's closed deals and each person's quotes.
 *
 * The link's code leaves Adminium only by e-mail; `linkCodeOf` stands in for
 * the customer's inbox.
 */
import type { APIRequestContext, Browser, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, dealNamed, rows, STAFF, watch, type Data } from "./helpers.ts";
import { linkCodeOf, readState } from "./stand.mjs";

const CUSTOMER = "/apps/crm/customer/";
type QuoteRow = Record<string, unknown> & { id: number; number: string; total: string | number; subtotal: string | number; tax: string | number };

/** A browser that is signed in to nothing, as a customer's is. */
async function stranger(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  const context = await browser.newContext({ baseURL: readState()!.url, locale: "en-US", ...options });
  return context.newPage();
}
const quoteNumbered = async (person: APIRequestContext, data: Data, number: string) => (await rows<QuoteRow>(person, data, "quotes", { column: "number", op: "eq", value: number }))[0]!;
const figure = (value: unknown): string => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));

/** A call as the customer, with no cookie: the quote's own key from the side's config, and the session its code opens. */
async function door(browser: Browser, code: string) {
  const context = await browser.newContext({ baseURL: readState()!.url });
  const config = (await (await context.request.get(`${CUSTOMER}surface-config.json`)).json()) as { publicKeys?: Record<string, string>; tables?: Record<string, string> };
  const headers: Record<string, string> = { authorization: `Bearer ${config.publicKeys!["quote"]!}`, origin: readState()!.url };
  const opened = await context.request.post("/api/v1/public/claim/token", { data: { token: code }, headers });
  const session = opened.ok() ? ((await opened.json()) as { data: { session: string } }).data.session : null;
  const refs = Object.keys(((await (await context.request.get("/api/v1/public/config", { headers })).json()) as { refs?: Record<string, unknown>; data?: { refs: Record<string, unknown> } }).refs ?? {});
  const quotes = refs.find((ref) => ref === "crm_quotes" || ref.startsWith("crm_quotes_")) ?? "crm_quotes";
  return {
    opened: opened.status(),
    answer: (id: number, values: Record<string, unknown>) => context.request.patch(`/api/v1/public/records/${quotes}/${String(id)}`, { data: { values }, headers: { ...headers, ...(session === null ? {} : { "x-adminium-public-session": session }) } }),
    close: () => context.close(),
  };
}

test("a customer with no account opens the link of Q-1002: the quote, its lines and its total, and nothing of the app around it", async ({ browser, api, data }) => {
  const dana = await api("dana");
  const quote = await quoteNumbered(dana, data, "Q-1002");
  const lines = await rows<{ description: string; amount: string }>(dana, data, "quote_lines", { column: "document_id", op: "eq", value: quote.id });
  const page = await stranger(browser);
  const problems = watch(page);
  await page.goto(`${CUSTOMER}#${await linkCodeOf(quote.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Q-1002");
  await expect(page.getByText("Valid until")).toBeVisible();
  await expect(page.locator(".crm-q-valid")).toHaveText("Jul 30, 2026");
  // Every line the server holds, and the server's own total: the page adds up nothing.
  await expect(page.locator(".crm-q-lines tbody tr")).toHaveCount(lines.length);
  for (const line of lines) await expect(page.locator(".crm-q-lines tbody tr").filter({ hasText: line.description })).toContainText(figure(line.amount));
  await expect(page.getByTestId("quote-total")).toContainText(figure(quote.total));
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(page.locator(".crm-q-left")).toContainText("until Jul 30, 2026");
  // No menu, no sign-in, no name of anybody on the staff, no list price and no word of an approval.
  await expect(page.getByRole("navigation")).toHaveCount(0);
  for (const hidden of ["Dana", "Ivy", "Approved", "under list", "list price", "Fourth-floor desk rows"]) await expect(page.locator("body")).not.toContainText(hidden);
  expect(problems).toEqual([]);
  await picture(page, "1-customer-q1002");
});

test("the link of a quote that ran out still opens it, says so, and takes no answer (the server refuses one too)", async ({ browser, api, data }) => {
  const ivy = await api("ivy");
  const quote = await quoteNumbered(ivy, data, "Q-1001");
  const code = await linkCodeOf(quote.id);
  const page = await stranger(browser);
  await page.goto(`${CUSTOMER}#${code}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Q-1001");
  await expect(page.getByRole("status")).toContainText("ran out on Jul 26, 2026");
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Decline" })).toHaveCount(0);
  await expect(page.getByTestId("quote-total")).toContainText(figure(quote.total));
  // By a direct call with the link's own session: neither answer.
  const direct = await door(browser, code);
  expect(direct.opened).toBe(200);
  expect((await direct.answer(quote.id, { status: "accepted", accepted_name: "Late Buyer" })).status()).toBeGreaterThanOrEqual(400);
  expect((await direct.answer(quote.id, { status: "declined" })).status()).toBeGreaterThanOrEqual(400);
  await direct.close();
  expect((await quoteNumbered(ivy, data, "Q-1001"))["status"]).toBe("sent");
  await picture(page, "2-customer-ran-out");
});

test("a replaced quote's link says it is no longer on offer, and shows nothing of it or of the newer one", async ({ browser, api, data }) => {
  const tessa = await api("tessa");
  const old = await quoteNumbered(tessa, data, "Q-1004");
  expect(old["status"]).toBe("withdrawn");
  const page = await stranger(browser);
  await page.goto(`${CUSTOMER}#${await linkCodeOf(old.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/no longer on offer|does not open a quote/);
  for (const hidden of ["Q-1004", "Q-1006", figure(old.total)]) await expect(page.locator("body")).not.toContainText(hidden);
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
});

test("a made-up code, and no code at all, open nothing", async ({ browser }) => {
  const page = await stranger(browser);
  await page.goto(`${CUSTOMER}#AAAAAAAAAAAAAAAA`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This link does not open a quote");
  await expect(page.locator("main")).toContainText("Ask the person who sent it for a new link.");
  await page.goto(CUSTOMER);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This link does not open a quote");
});

test("Accept asks for a name, the server keeps it, and the rep's open quote turns Accepted without a reload; a second Accept is refused", async ({ browser, as, api, data }) => {
  const dana = await api("dana");
  const headers = await csrf(dana);
  const me = (await (await dana.get(`${STAFF}surface-config.json`)).json() as { user: { id: string } }).user.id;
  const petra = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Petra Lindqvist" }))[0]!;
  const stages = await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const item = (await rows<{ id: number; list_rate: string }>(dana, data, "price_list", undefined, "&order=id"))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name: "Customer spec: two quotes", company_id: petra.company_id, contact_id: petra.id, owner_id: me, stage_id: stages[2]!.id, typed_amount: 100 } }, headers });
  expect(made.status(), await made.text()).toBeLessThan(300);
  const deal = ((await made.json()) as { data: { id: number } }).data.id;
  const sendOne = async (): Promise<number> => {
    const quote = ((await (await dana.post(data("quotes"), { data: { values: { deal_id: deal, sent_to_contact_id: petra.id } }, headers })).json()) as { data: { id: number } }).data.id;
    expect((await dana.post(data("quote_lines"), { data: { values: { document_id: quote, qty: 2, rate: Number(item.list_rate), price_id: item.id } }, headers })).status()).toBeLessThan(300);
    const sent = await dana.patch(data("quotes", `/${String(quote)}`), { data: { values: { status: "sent" } }, headers });
    expect(sent.status(), await sent.text()).toBe(200);
    return quote;
  };
  const first = await sendOne();
  const code = await linkCodeOf(first);

  // The rep has her quote open; nobody on the staff is shown the link.
  const staff = await (await as("dana")).newPage();
  await staff.goto(`${STAFF}quotes/${String(first)}`);
  await expect(staff.getByTestId("quote-customer-page")).toContainText("Petra Lindqvist has the link to this quote by e-mail");
  await expect(staff.getByTestId("quote-link-went-to")).toContainText("The link went to ");
  await expect(staff.locator("body")).not.toContainText(code);
  expect(await (await dana.get(data("quotes", `/${String(first)}`))).text()).not.toContain(code);

  const page = await stranger(browser);
  const problems = watch(page);
  await page.goto(`${CUSTOMER}#${code}`);
  // By keyboard alone: to Accept, into the name, and send.
  await page.getByRole("button", { name: "Accept" }).focus();
  await page.keyboard.press("Enter");
  const name = page.getByLabel("Your name");
  await expect(name).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Type your name to accept.");
  await name.fill("see https://evil.example/pay");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("could not be taken");
  expect((await (await dana.get(data("quotes", `/${String(first)}`))).json() as { data: { status: string } }).data.status).toBe("sent");
  await name.fill("Petra Lindqvist");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("by Petra Lindqvist");
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  // The server holds it as the customer's own answer.
  const held = (await (await dana.get(data("quotes", `/${String(first)}`))).json() as { data: Record<string, unknown> }).data;
  expect([held["status"], held["accepted_name"], held["accepted_via"]]).toEqual(["accepted", "Petra Lindqvist", "customer"]);
  // Two people: Dana's open quote follows, with no reload.
  await expect(staff.getByTestId("quote-customer-page")).toContainText("Petra Lindqvist accepted it on the customer's page");
  // The link again, later: accepted, and nothing to press. A second Accept by a direct call is refused.
  await page.reload();
  await expect(page.getByRole("status")).toContainText("by Petra Lindqvist");
  await expect(page.getByRole("button")).toHaveCount(0);
  const direct = await door(browser, code);
  expect((await direct.answer(first, { status: "accepted", accepted_name: "Somebody Else" })).status()).toBeGreaterThanOrEqual(400);
  expect((await direct.answer(first, { status: "declined" })).status()).toBeGreaterThanOrEqual(400);
  await direct.close();
  expect(((await (await dana.get(data("quotes", `/${String(first)}`))).json()) as { data: Record<string, unknown> }).data["accepted_name"]).toBe("Petra Lindqvist");
  expect(problems.filter((line) => !line.includes("evil") && !/ 4\d\d /.test(line))).toEqual([]);
  await picture(page, "3-customer-accepted");
  await picture(staff, "3-dana-sees-accepted");
});

test("an answer whose reply is lost on the way back is read back and said once; Decline needs no name", async ({ browser, api, data }) => {
  const dana = await api("dana");
  const headers = await csrf(dana);
  const deal = await dealNamed(dana, data, "Customer spec: two quotes");
  const petra = (await rows<{ id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Petra Lindqvist" }))[0]!;
  const item = (await rows<{ id: number; list_rate: string }>(dana, data, "price_list", undefined, "&order=id"))[0]!;
  const quote = ((await (await dana.post(data("quotes"), { data: { values: { deal_id: deal.id, sent_to_contact_id: petra.id } }, headers })).json()) as { data: { id: number } }).data.id;
  expect((await dana.post(data("quote_lines"), { data: { values: { document_id: quote, qty: 1, rate: Number(item.list_rate), price_id: item.id } }, headers })).status()).toBeLessThan(300);
  expect((await dana.patch(data("quotes", `/${String(quote)}`), { data: { values: { status: "sent" } }, headers })).status()).toBe(200);

  const page = await stranger(browser, { viewport: { width: 390, height: 800 }, colorScheme: "dark" });
  await page.goto(`${CUSTOMER}#${await linkCodeOf(quote)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The write reaches the server; its answer is dropped on the way back.
  let dropped = 0;
  await page.route("**/api/v1/public/records/**", async (route) => {
    if (route.request().method() !== "PATCH" || dropped > 0) return route.continue();
    dropped += 1;
    await route.fetch();
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "Decline" }).click();
  await page.getByRole("button", { name: "Decline the quote" }).click();
  await expect(page.getByRole("status")).toContainText("Declined on");
  expect(dropped).toBe(1);
  const held = (await (await dana.get(data("quotes", `/${String(quote)}`))).json() as { data: Record<string, unknown> }).data;
  expect([held["status"], held["accepted_name"]]).toEqual(["declined", null]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(page, "4-customer-declined-390-dark");
});

test("in Arabic the page runs right to left; and the spec's deal is closed", async ({ browser, api, data }) => {
  const dana = await api("dana");
  const quote = await quoteNumbered(dana, data, "Q-1002");
  const page = await stranger(browser, { locale: "ar-EG" });
  await page.goto(`${CUSTOMER}#${await linkCodeOf(quote.id)}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: "قبول" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Q-1002");
  await picture(page, "5-customer-arabic");
  // A lost deal is in no open figure the later specs read.
  const headers = await csrf(dana);
  const deal = await dealNamed(dana, data, "Customer spec: two quotes");
  const reason = (await rows<{ id: number }>(dana, data, "lost_reasons"))[0]!;
  expect((await dana.post(data("deals", `/${String(deal.id)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id } }, headers })).status()).toBe(200);
});

test("R1a: a lost deal's quote the customer then accepts: the owner's bell and Inbox say so, she leaves it closed; the room and the draft say why nothing more is quoted or sent", async ({ browser, as, api, data }) => {
  const dana = await api("dana");
  const headers = await csrf(dana);
  const me = (await (await dana.get(`${STAFF}surface-config.json`)).json() as { user: { id: string } }).user.id;
  const petra = (await rows<{ id: number; company_id: number }>(dana, data, "contacts", { column: "name", op: "eq", value: "Petra Lindqvist" }))[0]!;
  const stages = await rows<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const item = (await rows<{ id: number; list_rate: string }>(dana, data, "price_list", undefined, "&order=id"))[0]!;
  const made = await dana.post(data("deals"), { data: { values: { name: "Customer spec: late yes", company_id: petra.company_id, contact_id: petra.id, owner_id: me, stage_id: stages[2]!.id, typed_amount: 100 } }, headers });
  expect(made.status(), await made.text()).toBeLessThan(300);
  const deal = ((await made.json()) as { data: { id: number } }).data.id;
  const quote = ((await (await dana.post(data("quotes"), { data: { values: { deal_id: deal, sent_to_contact_id: petra.id } }, headers })).json()) as { data: { id: number; number: string } }).data;
  expect((await dana.post(data("quote_lines"), { data: { values: { document_id: quote.id, qty: 2, rate: Number(item.list_rate), price_id: item.id } }, headers })).status()).toBeLessThan(300);
  expect((await dana.patch(data("quotes", `/${String(quote.id)}`), { data: { values: { status: "sent" } }, headers })).status()).toBe(200);
  // A second version, drafted and not sent, before the deal is lost.
  const draft = ((await (await dana.post(data("quotes"), { data: { values: { deal_id: deal, sent_to_contact_id: petra.id, replaces_id: quote.id, version: 2 } }, headers })).json()) as { data: { id: number } }).data.id;
  expect((await dana.post(data("quote_lines"), { data: { values: { document_id: draft, qty: 3, rate: Number(item.list_rate), price_id: item.id } }, headers })).status()).toBeLessThan(300);
  const reason = (await rows<{ id: number }>(dana, data, "lost_reasons"))[0]!;
  expect((await dana.post(data("deals", `/${String(deal)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id } }, headers })).status()).toBe(200);
  const number0 = String((await rows<{ number: string }>(dana, data, "quotes", { column: "id", op: "eq", value: quote.id }))[0]!.number);

  // The customer accepts the one already out: still theirs to accept.
  // A browser of its own with nothing kept in it: an earlier spec's customer session would open its own quote instead.
  const customer = await stranger(browser, { storageState: { cookies: [], origins: [] } });
  // The door lets one address open only so many links a minute, and this file's earlier cases spend it: wait it out.
  const link = `${CUSTOMER}#${await linkCodeOf(quote.id)}`;
  await expect(async () => {
    // A new document each time: the same address again only moves its "#", and the page would ask nothing.
    await customer.goto("about:blank");
    await customer.goto(link);
    await expect(customer.getByRole("heading", { level: 1 })).toHaveText(number0, { timeout: 4_000 });
  }).toPass({ timeout: 100_000, intervals: [15_000] });
  await customer.getByRole("button", { name: "Accept" }).click();
  await customer.getByLabel("Your name").fill("Petra Lindqvist");
  await customer.keyboard.press("Enter");
  await expect(customer.getByRole("status")).toContainText("by Petra Lindqvist");
  await customer.context().close();
  const number = String((await rows<{ number: string }>(dana, data, "quotes", { column: "id", op: "eq", value: quote.id }))[0]!.number);

  // Dana's Inbox says so, with the deal's own Reopen and "Leave it closed"; her bell too, once the rule has run.
  const context = await as("dana");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}inbox`);
  const late = page.getByTestId("inbox-yes-on-lost");
  await expect(late.getByRole("heading", { level: 2 })).toHaveText("A customer said yes to a lost deal");
  const line = late.locator(`[data-quote="${String(quote.id)}"]`);
  await expect(line).toContainText(`Petra Lindqvist accepted ${number}`);
  await expect(line).toContainText("Customer spec: late yes");
  await expect(line.getByRole("button", { name: "Reopen the deal" })).toBeVisible();
  await expect
    .poll(async () => ((await (await dana.get("/api/v1/me/notifications?limit=50")).json()) as { data: { items: { title: string }[] } }).data.items.map((item) => item.title), { timeout: 90_000 })
    .toContain(`Petra Lindqvist said yes to quote ${number}, on a lost deal`);
  await line.getByRole("button", { name: "Leave it closed" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Customer spec: late yes stays lost.");
  // Its line leaves the list (the file's own "two quotes" deal, lost with a quote accepted earlier, may still be listed).
  await expect(page.locator(`[data-quote="${String(quote.id)}"]`)).toHaveCount(0);

  // The room says why it takes no new quote; the draft says why it is not sent, and offers no Send.
  await page.goto(`${STAFF}deals/${String(deal)}`);
  await expect(page.getByTestId("room-quote-closed")).toHaveText("A closed deal takes no new quote, and its drafts are not sent. A quote already sent can still be accepted. Reopen the deal to quote again.");
  await page.goto(`${STAFF}quotes/${String(draft)}`);
  await expect(page.getByTestId("quote-closed-deal")).toHaveText("This deal is closed, so this draft is not sent and no new version is made. Reopen the deal to quote again.");
  await expect(page.locator('[data-panel="send"]')).toHaveCount(0);
  expect((await dana.patch(data("quotes", `/${String(draft)}`), { data: { values: { status: "sent" } }, headers })).status()).toBeGreaterThanOrEqual(400);
  expect(problems).toEqual([]);
});
