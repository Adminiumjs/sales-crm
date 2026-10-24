/**
 * P10, site visits: the list, the booking dialog (book, move, cancel) and the
 * write-up, on the sample, on the ledger's Tuesday 28 July 2026 at 09:35.
 *
 * Every visit a spec makes has a purpose that starts "Spec: " and is taken
 * away again by the CRM admin; the one write-up a spec makes (visit v8, Low
 * Orbit) is removed with its agreed lines. So the ledger's counts (Dana 8, 5,
 * 2, 1; the team 10, 7, 2, 1) hold for the next spec.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, dealNamed, inArabic, rows, STAFF, watch, type Data, unfoldMenu } from "./helpers.ts";

interface VisitRow {
  id: number;
  rep_id: string;
  starts_at: string;
  minutes: number;
  purpose: string;
  state: string;
  written: number;
  cancel_reason: string | null;
}

const spec = { column: "purpose", op: "like", value: "Spec: %" };
const named = (person: APIRequestContext, data: Data, purpose: string): Promise<VisitRow[]> => rows<VisitRow>(person, data, "site_visits", { column: "purpose", op: "eq", value: purpose });
const me = async (person: APIRequestContext): Promise<string> => ((await (await person.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;

/**
 * The server gives a person 300 requests a minute, and the suite runs its
 * specs as Dana back to back (Today's seven come just before these). A spec
 * that works a whole screen as her first looks at what the server says is
 * left of her minute, and waits for the next one when it is short: pacing a
 * person never needs, since nobody books, moves and cancels in two seconds.
 */
async function room(person: APIRequestContext, data: Data, needs: number): Promise<void> {
  const res = await person.get(data("stages", "?limit=1&select=id"));
  const headers = res.headers();
  const left = Number(headers["x-ratelimit-remaining"] ?? "300");
  const reset = Number(headers["x-ratelimit-reset"] ?? "0");
  if (res.status() === 429 || left < needs) await new Promise((done) => setTimeout(done, (Number.isFinite(reset) && reset > 0 ? Math.min(reset, 60) : 60) * 1000 + 750));
}

async function tidy(admin: APIRequestContext, data: Data): Promise<void> {
  const headers = await csrf(admin);
  for (const agreed of await rows<{ id: number }>(admin, data, "visit_agreed", { column: "text", op: "like", value: "Spec: %" })) {
    expect((await admin.delete(data("visit_agreed", `/${String(agreed.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
  const lowOrbit = await named(admin, data, "First look at the second floor");
  const visits = [...(await rows<VisitRow>(admin, data, "site_visits", spec)), ...lowOrbit];
  for (const visit of visits) {
    for (const note of await rows<{ id: number }>(admin, data, "visit_notes", { column: "visit_id", op: "eq", value: visit.id })) {
      for (const agreed of await rows<{ id: number }>(admin, data, "visit_agreed", { column: "visit_note_id", op: "eq", value: note.id })) {
        expect((await admin.delete(data("visit_agreed", `/${String(agreed.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
      }
      expect((await admin.delete(data("visit_notes", `/${String(note.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
    }
    if (visit.purpose.startsWith("Spec: ")) expect((await admin.delete(data("site_visits", `/${String(visit.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
  for (const step of await rows<{ id: number }>(admin, data, "follow_ups", { column: "text", op: "like", value: "Spec: %" })) {
    expect((await admin.delete(data("follow_ups", `/${String(step.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
}

test.afterEach(async ({ api, data }) => {
  await tidy(await api("tessa"), data);
});

const chip = (page: import("@playwright/test").Page, filter: string) => page.locator(`.crm-chip-btn[data-filter="${filter}"] .crm-chip-count`);

test("Dana's site visits: the ledger's eight, five, two and one, each what the server answers her", async ({ as, data }) => {
  const context = await as("dana");
  await room(context.request, data, 120);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}today`);
  await unfoldMenu(page);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Site visits" }).click();
  await expect(page).toHaveURL(/\/staff\/visits$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My site visits");
  await expect(chip(page, "all")).toHaveText("8");
  await expect(chip(page, "soon")).toHaveText("5");
  await expect(chip(page, "done")).toHaveText("2");
  await expect(chip(page, "unwritten")).toHaveText("1");
  await expect(page.getByTestId("visit-next")).toHaveText("Next up today at 14:00 — Cobalt Legal");
  await expect(page.getByTestId("visit-missing")).toContainText("1 visit is still waiting on its notes.");

  // The same four, asked of the server as Dana.
  const dana = context.request;
  const id = await me(dana);
  const mine = await rows<VisitRow>(dana, data, "site_visits", { column: "rep_id", op: "eq", value: id });
  const today = Date.parse("2026-07-27T23:00:00Z");
  expect(mine.length).toBe(8);
  expect(mine.filter((visit) => Date.parse(visit.starts_at) >= today).length).toBe(5);
  expect(mine.filter((visit) => Date.parse(visit.starts_at) < today && Number(visit.written) > 0).length).toBe(2);
  expect(mine.filter((visit) => Date.parse(visit.starts_at) < today && Number(visit.written) === 0).length).toBe(1);

  // Today first, then what is to come; the first card is today's at two.
  const first = page.locator(".crm-visit").first();
  await expect(first.locator(".crm-visit-purpose")).toHaveText("Measure up the records room");
  await expect(first.locator(".crm-visit-time .crm-mono")).toHaveText("14:00");
  await expect(first.locator(".crm-pill")).toHaveText("Today");
  await expect(first).toContainText("Ines Vaughan");
  await expect(first.locator(".crm-visit-deal")).toContainText("Records-room lockers");
  await expect(page.locator(".crm-visit-day").first().locator(".crm-visit-day-head > span").first()).toHaveText("Today");

  // One filter: the visit that waits on its notes, twelve days back.
  await page.locator('.crm-chip-btn[data-filter="unwritten"]').click();
  await expect(page.locator(".crm-visit")).toHaveCount(1);
  await expect(page.locator(".crm-visit")).toContainText("Low Orbit");
  await expect(page.locator(".crm-visit .crm-pill")).toHaveText("No notes yet");
  // A visit that has been is not moved or cancelled.
  await expect(page.locator('.crm-visit [data-act="move"]')).toHaveCount(0);
  await page.locator('.crm-chip-btn[data-filter="done"]').click();
  await expect(page.locator(".crm-visit")).toHaveCount(2);
  await picture(page, "1-dana-visits");
  expect(problems).toEqual([]);
});

test("the sales manager reads the team's ten, the CRM admin and Read-only too; Read-only has nothing to press", async ({ as }) => {
  for (const person of ["ivy", "tessa", "grace"]) {
    const page = await (await as(person)).newPage();
    await page.goto(`${STAFF}visits`);
    await expect(page.getByRole("heading", { level: 1 }), person).toHaveText("Site visits");
    await expect(chip(page, "all"), person).toHaveText("10");
    await expect(chip(page, "soon"), person).toHaveText("7");
    await expect(chip(page, "done"), person).toHaveText("2");
    await expect(chip(page, "unwritten"), person).toHaveText("1");
    await expect(page.locator(".crm-visit"), person).toHaveCount(10);
    // Whose each is: Priya's and Sam's are among them.
    await expect(page.locator(".crm-visit", { hasText: "Leave two sample chairs with the ward team" }).locator("[data-rep]")).toHaveText(/Priya/);
    if (person === "grace") {
      await expect(page.getByTestId("visit-book")).toHaveCount(0);
      await expect(page.locator('.crm-visit [data-act="move"], .crm-visit [data-act="cancel"]')).toHaveCount(0);
    } else {
      await expect(page.getByTestId("visit-book")).toBeVisible();
      await expect(page.locator('.crm-visit [data-act="move"]')).toHaveCount(7);
    }
    await page.close();
  }
});

test("Dana books a visit for herself, moves it and cancels it, by keyboard where it counts; the server holds each step", async ({ as, api, data }) => {
  const context = await as("dana");
  await room(context.request, data, 160);
  const page = await context.newPage();
  const problems = watch(page);
  const dana = context.request;
  await page.goto(`${STAFF}visits`);
  await expect(chip(page, "all")).toHaveText("8");

  // BOOK.
  const open = page.getByTestId("visit-book");
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Book a site visit" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Deal")).toBeFocused();
  const book = dialog.getByRole("button", { name: "Book", exact: true });
  await expect(book).toBeDisabled();
  // A rep is not asked who goes.
  await expect(dialog.getByTestId("bk-rep")).toContainText("Dana Whitlock");
  await expect(dialog.getByTestId("bk-rep")).toContainText("You book your own visits.");
  await expect(dialog.getByLabel("Rep")).toHaveCount(0);
  await dialog.getByLabel("Deal").selectOption({ label: "Cobalt Legal · Records-room lockers" });
  // The deal's own contact is offered first, and the company's other one is there to pick.
  await expect(dialog.getByLabel("Contact")).toHaveValue(/\d+/);
  await expect(dialog.getByLabel("Contact").locator("option")).toHaveText(["Ines Vaughan · Operations Director", "Tomas Reidy · Facilities Lead"]);
  await dialog.getByLabel("Purpose").fill("Spec: check the door swing");
  // Tomorrow at ten, an hour: it runs into the visit she already has at half past ten.
  await expect(dialog.getByLabel("Date")).toHaveValue("2026-07-29");
  await expect(dialog.getByLabel("Start")).toHaveValue("10:00");
  await expect(dialog.locator(".crm-bk-others .crm-bk-head")).toHaveText(/Dana’s other visits, Wed/);
  await expect(dialog.locator(".crm-bk-other")).toHaveCount(1);
  await expect(dialog.locator(".crm-bk-other")).toContainText("10:30–12:00");
  await expect(dialog.locator(".crm-bk-other")).toContainText("Nordwind Logistics");
  await expect(dialog.locator(".crm-bk-other em")).toHaveText("Overlaps");
  // A rep's two visits never overlap (plan 68 X7): the dialog says which one is in the way and books nothing over it.
  await expect(dialog.locator(".crm-bk-flag")).toHaveText("This overlaps one of Dana’s visits. Pick another time.");
  await expect(book).toBeDisabled();
  // What the customer is told, read from the switch the server holds: an e-mail goes, said with her name.
  await expect(dialog.getByTestId("bk-told")).toHaveAttribute("data-mails", "on");
  await expect(dialog.getByTestId("bk-told")).toHaveText("Ines Vaughan is sent an e-mail with the day and the time, if their address is on file.");
  // A time that has gone by is refused here.
  await dialog.getByLabel("Date").fill("2026-07-27");
  await expect(dialog.getByRole("alert")).toHaveText("That time has passed.");
  await expect(book).toBeDisabled();
  await dialog.getByLabel("Date").fill("2026-07-29");
  await dialog.getByLabel("Start").fill("08:30");
  await expect(dialog.locator(".crm-bk-flag")).toHaveCount(0);
  await dialog.getByLabel("Note").fill("Spec: bring the tape");
  await book.click();
  await expect(page.locator(".crm-toast")).toHaveText(/^Booked: Cobalt Legal, Wed, Jul 29, 08:30, Dana\.$/);
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(chip(page, "all")).toHaveText("9");
  await expect(chip(page, "soon")).toHaveText("6");
  let held = await named(dana, data, "Spec: check the door swing");
  expect(held.length).toBe(1);
  expect(held[0]!.rep_id).toBe(await me(dana));
  // Half past eight in London in July is 07:30 UTC.
  expect(new Date(held[0]!.starts_at).toISOString()).toBe("2026-07-29T07:30:00.000Z");
  expect([Number(held[0]!.minutes), held[0]!.state]).toEqual([60, "booked"]);

  // MOVE.
  const cardOf = page.locator(".crm-visit", { hasText: "Spec: check the door swing" });
  await expect(cardOf.locator(".crm-visit-time .crm-mono")).toHaveText("08:30");
  await expect(cardOf.locator(".crm-visit-note")).toHaveText("Spec: bring the tape");
  const move = cardOf.getByRole("button", { name: /^Move the visit to Cobalt Legal/ });
  await move.focus();
  await page.keyboard.press("Enter");
  const moving = page.getByRole("dialog", { name: "Move this site visit" });
  await expect(moving.getByTestId("bk-was")).toContainText("08:30–09:30");
  await expect(moving.getByTestId("bk-was")).toContainText("Dana");
  await expect(moving.getByLabel("Date")).toBeFocused();
  // Nothing changed yet: nothing to move.
  await expect(moving.getByRole("button", { name: "Move it" })).toBeDisabled();
  // …and no e-mail either: only a new time is mailed.
  await expect(moving.getByTestId("bk-told")).toHaveText("The time stays as it is, so no e-mail goes to Ines Vaughan.");
  // Escape closes it and the keyboard is back on the button.
  await page.keyboard.press("Escape");
  await expect(moving).toHaveCount(0);
  await expect(move).toBeFocused();
  await page.keyboard.press("Enter");
  await moving.getByLabel("Date").fill("2026-07-30");
  await moving.getByLabel("Start").fill("15:15");
  await expect(moving.getByTestId("bk-told")).toHaveText("Ines Vaughan is sent an e-mail with the new time and the time it had.");
  await moving.getByLabel("Length").selectOption("90");
  await moving.getByRole("button", { name: "Move it" }).click();
  await expect(page.locator(".crm-toast")).toHaveText(/^Moved: Cobalt Legal, Thu, Jul 30, 15:15, Dana\.$/);
  held = await named(dana, data, "Spec: check the door swing");
  expect(new Date(held[0]!.starts_at).toISOString()).toBe("2026-07-30T14:15:00.000Z");
  expect(Number(held[0]!.minutes)).toBe(90);
  await expect(cardOf.locator(".crm-visit-time .crm-mono")).toHaveText("15:15");
  // The day it had, who moved it and when: read from the record's history, on the next look.
  await cardOf.getByRole("button", { name: /^Move the visit to Cobalt Legal/ }).click();
  await expect(moving.getByTestId("bk-history")).toHaveText(/^Moved before: it was Wed, Jul 29, 08:30\. Changed by Dana Whitlock on Tue, Jul 28, \d\d:\d\d\.$/);
  await page.keyboard.press("Escape");
  // The server's own refusal of two at once (plan 68 X7), asked directly: moved onto her Wednesday visit (10:30–12:00), or a
  // new one over it, is refused as taken, and the visit keeps its time.
  const over = { starts_at: "2026-07-29T09:45:00.000Z", minutes: 30 };
  const moved = await dana.patch(data("site_visits", `/${String(held[0]!.id)}`), { data: { values: over }, headers: await csrf(dana) });
  expect([moved.status(), ((await moved.json()) as { error?: { code?: string } }).error?.code]).toEqual([409, "BOOKING_TAKEN"]);
  const deal = (await rows<{ deal_id: number }>(dana, data, "site_visits", { column: "id", op: "eq", value: held[0]!.id }))[0]!.deal_id;
  const made = await dana.post(data("site_visits"), { data: { values: { deal_id: deal, rep_id: await me(dana), purpose: "Spec: two at once", ...over } }, headers: await csrf(dana) });
  expect([made.status(), ((await made.json()) as { error?: { code?: string } }).error?.code]).toEqual([409, "BOOKING_TAKEN"]);
  expect(await named(dana, data, "Spec: two at once")).toEqual([]);
  expect(new Date((await named(dana, data, "Spec: check the door swing"))[0]!.starts_at).toISOString()).toBe("2026-07-30T14:15:00.000Z");

  // CANCEL.
  await cardOf.getByRole("button", { name: /^Cancel the visit to Cobalt Legal/ }).click();
  const cancelling = page.getByRole("dialog", { name: "Cancel this site visit" });
  await expect(cancelling.getByLabel("Why is it cancelled?")).toBeFocused();
  await expect(cancelling.locator(".crm-bk-sum")).toContainText("15:15–16:45");
  await expect(cancelling.getByTestId("bk-told")).toHaveText("Ines Vaughan is sent an e-mail saying the visit is cancelled.");
  const go = cancelling.getByRole("button", { name: "Cancel it" });
  await expect(go).toBeDisabled();
  await page.keyboard.type("no");
  await expect(go).toBeDisabled();
  await page.keyboard.type(": Spec, Ines is away");
  await page.keyboard.press("Enter");
  await expect(page.locator(".crm-toast")).toHaveText("Cancelled: Cobalt Legal, Thu, Jul 30.");
  await expect(cardOf).toHaveCount(0);
  await expect(chip(page, "all")).toHaveText("8");
  await expect(chip(page, "soon")).toHaveText("5");
  // The row is gone for everybody: there is no cancelled visit to list.
  expect(await named(dana, data, "Spec: check the door swing")).toEqual([]);
  // Its why is kept with the removed visit, read through the deal (plan 68 S16): under the list, when asked.
  await page.getByRole("button", { name: "Show cancelled visits" }).click();
  const gone = page.getByTestId("visits-removed").locator(".crm-removed-line", { hasText: "Spec: check the door swing" });
  await expect(gone).toContainText("Why: no: Spec, Ines is away");
  await expect(gone).toContainText("Cancelled by Dana Whitlock");
  await expect(gone).toContainText("Records-room lockers · was Thu, Jul 30, 15:15");
  expect(await named(await api("tessa"), data, "Spec: check the door swing")).toEqual([]);
  // What the dialog said is what the server did: three messages about this deal in the log, as the CRM admin reads it
  // (booked, moved, cancelled). Ines is a sample person with an example address, so each is skipped, never sent.
  const tessa = await api("tessa");
  const lockers = await dealNamed(tessa, data, "Records-room lockers");
  await expect
    .poll(async () => (await rows<{ kind: string }>(tessa, data, "outbox", { and: [{ column: "deal_id", op: "eq", value: lockers.id }, { column: "kind", op: "in", value: ["visit-confirmed", "visit-moved", "visit-cancelled"] }] }, "&order=id")).map((row) => row.kind).slice(-3), { timeout: 20_000 })
    .toEqual(["visit-confirmed", "visit-moved", "visit-cancelled"]);
  const log = (await rows<{ kind: string; status: string; to: string | null; visit_id: number | null; was: string | null }>(tessa, data, "outbox", { and: [{ column: "deal_id", op: "eq", value: lockers.id }, { column: "kind", op: "in", value: ["visit-confirmed", "visit-moved", "visit-cancelled"] }] }, "&order=id")).slice(-3);
  for (const message of log) {
    expect(message.status, message.kind).not.toBe("sent");
    // The visit is gone, and its messages stay without it.
    expect(message.visit_id, message.kind).toBeNull();
  }
  expect(log[2]!.was).toContain("Spec: check the door swing");
  // Nobody but the CRM admin reads the log.
  expect((await dana.get(data("outbox", "?limit=1"))).status()).toBe(403);
  expect(problems).toEqual([]);
});

test("a booking whose reply is lost is sent again with the same key, and is one visit", async ({ as, data }) => {
  // Priya, so the specs do not spend one person's requests for the minute (300) between them.
  const context = await as("priya");
  const page = await context.newPage();
  await page.goto(`${STAFF}visits`);
  await page.getByTestId("visit-book").click();
  const dialog = page.getByRole("dialog", { name: "Book a site visit" });
  await dialog.getByLabel("Deal").selectOption({ label: "Fernway Clinics · Clinic waiting-room seating" });
  await dialog.getByLabel("Purpose").fill("Spec: lost reply");
  await dialog.getByLabel("Date").fill("2026-08-05");
  const sent: { key: string; replayed: boolean | null }[] = [];
  let dropped = false;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !/crm_site_visits$/.test(new URL(request.url()).pathname)) return route.fallback();
    const key = (request.postDataJSON() as { clientKey: string }).clientKey;
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      sent.push({ key, replayed: null });
      return route.abort("connectionreset");
    }
    sent.push({ key, replayed: ((await response.json()) as { replayed?: boolean }).replayed === true });
    await route.fulfill({ response });
  });
  await dialog.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.locator(".crm-toast")).toHaveText(/^Booked: Fernway Clinics, Wed, Aug 5, 10:00, Priya\.$/);
  await expect(page.locator(".crm-form-error")).toHaveCount(0);
  expect(sent.length).toBe(2);
  expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
  await page.unroute("**/api/v1/data/**");
  expect((await named(context.request, data, "Spec: lost reply")).length).toBe(1);
  await expect(page.locator(".crm-visit", { hasText: "Spec: lost reply" })).toHaveCount(1);

  // A cancel whose removal's reply is lost: the visit is read back, found gone, and said to be cancelled once.
  await page.locator(".crm-visit", { hasText: "Spec: lost reply" }).getByRole("button", { name: /^Cancel the visit/ }).click();
  const cancelling = page.getByRole("dialog", { name: "Cancel this site visit" });
  await cancelling.getByLabel("Why is it cancelled?").fill("Spec: lift is out of order");
  let removals = 0;
  await page.route("**/api/v1/data/**", async (route) => {
    const request = route.request();
    if (request.method() !== "DELETE") return route.fallback();
    removals += 1;
    await route.fetch();
    return route.abort("connectionreset");
  });
  await cancelling.getByRole("button", { name: "Cancel it" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Cancelled: Fernway Clinics, Wed, Aug 5.");
  await page.unroute("**/api/v1/data/**");
  expect(removals).toBe(1);
  expect(await named(context.request, data, "Spec: lost reply")).toEqual([]);
});

test("live, two people: the manager books, moves and cancels a visit of Dana's, and Dana's open list follows", async ({ as, api, data }) => {
  await room(await api("dana"), data, 120);
  const page = await (await as("dana")).newPage();
  await page.goto(`${STAFF}visits`);
  await expect(chip(page, "all")).toHaveText("8");
  const ivy = await api("ivy");
  const headers = await csrf(ivy);
  const dana = await me((await as("dana")).request);
  const deal = await dealNamed(ivy, data, "Quiet-room pods");
  const made = await ivy.post(data("site_visits"), { data: { values: { deal_id: deal.id, rep_id: dana, starts_at: "2026-08-06T09:00:00.000Z", minutes: 45, purpose: "Spec: live" } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  const cardOf = page.locator(".crm-visit", { hasText: "Spec: live" });
  await expect(cardOf).toHaveCount(1);
  await expect(chip(page, "all")).toHaveText("9");
  await expect(cardOf.locator(".crm-visit-time .crm-mono")).toHaveText("10:00");
  expect((await ivy.patch(data("site_visits", `/${String(id)}`), { data: { values: { starts_at: "2026-08-06T13:30:00.000Z" } }, headers })).status()).toBe(200);
  await expect(cardOf.locator(".crm-visit-time .crm-mono")).toHaveText("14:30");
  expect((await ivy.delete(data("site_visits", `/${String(id)}?confirm=true`), { headers })).status()).toBe(200);
  await expect(cardOf).toHaveCount(0);
  await expect(chip(page, "all")).toHaveText("8");
});

test("the sales manager books for a rep she picks; the dialog offers the reps", async ({ as, data }) => {
  const context = await as("ivy");
  const page = await context.newPage();
  await page.goto(`${STAFF}visits`);
  await page.getByTestId("visit-book").click();
  const dialog = page.getByRole("dialog", { name: "Book a site visit" });
  await expect(dialog.getByLabel("Rep").locator("option")).toHaveText(["Dana Whitlock", "Priya Raman", "Sam Okonjo", "Leo Vance"]);
  await dialog.getByLabel("Deal").selectOption({ label: "Harbor & Finch · Partner-office fit-out" });
  await dialog.getByLabel("Rep").selectOption({ label: "Sam Okonjo" });
  await dialog.getByLabel("Purpose").fill("Spec: for Sam");
  await dialog.getByLabel("Date").fill("2026-08-03");
  // Sam's own visit that Monday at two is listed beside the time.
  await expect(dialog.locator(".crm-bk-others .crm-bk-head")).toHaveText(/Sam’s other visits, Mon/);
  await expect(dialog.locator(".crm-bk-other")).toContainText("14:00–15:00");
  await dialog.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.locator(".crm-toast")).toHaveText(/^Booked: Harbor & Finch, Mon, Aug 3, 10:00, Sam\.$/);
  const held = await named(context.request, data, "Spec: for Sam");
  expect(held.length).toBe(1);
  await expect(chip(page, "all")).toHaveText("11");
});

test("what the dialog holds people to is the server's: each refusal by a direct call as that person", async ({ as, api, data }) => {
  // Priya is the rep here and Leo the colleague (Dana's requests for the minute are spent by the specs around this one).
  const priya = await api("priya");
  const leo = await api("leo");
  const ivy = await api("ivy");
  const grace = await api("grace");
  const lena = await api("lena");
  const tessa = await api("tessa");
  const [priyaId, leoId] = [await me(priya), await me(leo)];
  const own = { priya: await csrf(priya), leo: await csrf(leo), ivy: await csrf(ivy), grace: await csrf(grace), tessa: await csrf(tessa) };
  const hers = await dealNamed(priya, data, "Clinic waiting-room seating");
  const his = await dealNamed(leo, data, "Depot supervisor stations");
  const visit = (deal: number, rep: string, purpose: string) => ({ values: { deal_id: deal, rep_id: rep, starts_at: "2026-08-07T09:00:00.000Z", minutes: 60, purpose } });
  const code = async (res: { json: () => Promise<unknown> }): Promise<string> => ((await res.json()) as { error: { code: string } }).error.code;

  // A rep books for herself only, and only on a deal she opens.
  expect((await priya.post(data("site_visits"), { data: visit(hers.id, leoId, "Spec: for a colleague"), headers: own.priya })).status()).toBe(403);
  // On a deal she cannot open: refused exactly as a deal that is not there.
  const onHis = await priya.post(data("site_visits"), { data: visit(his.id, priyaId, "Spec: on his deal"), headers: own.priya });
  const onNone = await priya.post(data("site_visits"), { data: visit(999_999, priyaId, "Spec: on no deal"), headers: own.priya });
  expect([onHis.status(), await code(onHis)]).toEqual([409, "FK_VIOLATION"]);
  expect([onNone.status(), await code(onNone)]).toEqual([409, "FK_VIOLATION"]);
  expect(await rows(tessa, data, "site_visits", spec)).toEqual([]);
  const made = await priya.post(data("site_visits"), { data: visit(hers.id, priyaId, "Spec: hers"), headers: own.priya });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { data: { id: number } }).data.id;

  // Another rep: the visit is not there for him, to read, move or cancel.
  expect((await leo.get(data("site_visits", `/${String(id)}`))).status()).toBe(404);
  expect((await leo.patch(data("site_visits", `/${String(id)}`), { data: { values: { minutes: 30 } }, headers: own.leo })).status()).toBe(404);
  expect((await leo.delete(data("site_visits", `/${String(id)}?confirm=true`), { headers: own.leo })).status()).toBe(404);
  // Read-only reads it and changes nothing.
  expect((await grace.get(data("site_visits", `/${String(id)}`))).status()).toBe(200);
  expect((await grace.post(data("site_visits"), { data: visit(hers.id, priyaId, "Spec: read-only"), headers: own.grace })).status()).toBe(403);
  expect((await grace.patch(data("site_visits", `/${String(id)}`), { data: { values: { minutes: 30 } }, headers: own.grace })).status()).toBe(403);
  expect((await grace.delete(data("site_visits", `/${String(id)}?confirm=true`), { headers: own.grace })).status()).toBe(403);
  expect((await grace.post(data("visit_notes"), { data: { values: { visit_id: id, saw: "Spec" } }, headers: own.grace })).status()).toBe(403);
  // There is no cancelled mark to set.
  expect((await priya.patch(data("site_visits", `/${String(id)}`), { data: { values: { state: "cancelled" } }, headers: own.priya })).status()).toBeGreaterThanOrEqual(400);
  // A visit that was made and written up is kept, whoever asks: the manager who leads its rep, and the CRM admin.
  const walkRound = (await named(ivy, data, "Walk-round with Tomas"))[0]!;
  expect([(await ivy.delete(data("site_visits", `/${String(walkRound.id)}?confirm=true`), { headers: own.ivy })).status()]).toEqual([409]);
  expect([(await tessa.delete(data("site_visits", `/${String(walkRound.id)}?confirm=true`), { headers: own.tessa })).status()]).toEqual([409]);
  expect((await named(tessa, data, "Walk-round with Tomas")).length).toBe(1);
  // Her manager moves it and cancels it.
  expect((await ivy.patch(data("site_visits", `/${String(id)}`), { data: { values: { minutes: 45 } }, headers: own.ivy })).status()).toBe(200);
  expect((await ivy.delete(data("site_visits", `/${String(id)}?confirm=true`), { headers: own.ivy })).status()).toBe(200);

  // The marketer reads no visit and no write-up, by the rows or by the page.
  expect((await lena.get(data("site_visits", "?limit=5"))).status()).toBe(403);
  expect((await lena.get(data("visit_notes", "?limit=5"))).status()).toBe(403);
  const page = await (await as("lena")).newPage();
  await page.goto(`${STAFF}visits`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not part of your role");
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Site visits" })).toHaveCount(0);
});

test("Dana writes up the visit that waits on its notes; her manager's open page follows; Read-only reads and writes nothing", async ({ as, api, data }) => {
  const context = await as("dana");
  await room(context.request, data, 180);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}visits`);
  await page.getByTestId("visit-missing").getByRole("link", { name: "Write them now" }).click();
  // The page picks the visit that waits, and stays on it.
  await expect(page).toHaveURL(/\/staff\/visits\/notes\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("First look at the second floor");
  await expect(page.getByTestId("notes-state")).toHaveText("Not written up");
  await expect(page.locator(".crm-vn-meta")).toContainText("Low Orbit");
  await expect(page.locator(".crm-vn-meta")).toContainText("Thursday, July 16, 2026");
  // The three visits that have been, the newest first.
  await expect(page.locator(".crm-vn-picker .crm-chip-btn")).toHaveCount(3);
  await expect(page.locator(".crm-vn-person").nth(1)).toContainText("Went on the day · 12 days ago");
  await expect(page.getByText("0 of 5")).toBeVisible();
  const save = page.getByTestId("notes-save");
  await expect(save).toBeDisabled();

  // Ivy has the same visit open.
  const visit = (await named(context.request, data, "First look at the second floor"))[0]!;
  const hers = await (await as("ivy")).newPage();
  await hers.goto(`${STAFF}visits/notes/${String(visit.id)}`);
  await expect(hers.getByTestId("notes-state")).toHaveText("Not written up");

  await page.getByLabel("What I saw").fill("Spec: one open floor, no lift.");
  await page.getByLabel("What they said").fill("Spec: Bea wants six pods by the windows.");
  await page.getByLabel("What happens next").fill("Spec: send Bea the pod layout");
  await page.getByRole("switch", { name: "Put the next step in my queue" }).click();
  // Two of the five "what to capture" ticks, kept with the write-up (S10).
  await page.getByRole("checkbox", { name: "Access and the lift" }).click();
  await page.getByRole("checkbox", { name: "Power and data" }).click();
  await expect(page.getByText("2 of 5")).toBeVisible();
  await save.click();
  await expect(page.locator(".crm-toast")).toHaveText(/^Write-up saved for Low Orbit\. The next step is in your queue for Thu, Jul 30, 10:00\.$/);
  await expect(page.getByTestId("notes-state")).toHaveText("Written up");
  const kept = (await rows<Record<string, unknown>>(context.request, data, "visit_notes", { column: "visit_id", op: "eq", value: visit.id }))[0]!;
  expect(["cap_access", "cap_floor", "cap_power", "cap_existing", "cap_timing"].map((key) => kept[key] === true || kept[key] === 1)).toEqual([true, false, true, false, false]);
  // An agreed point is its own row, saved as it is added.
  await page.getByLabel("Add what you both agreed…").fill("Spec: six pods, not eight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("notes-agreed").locator("li")).toHaveText(["Spec: six pods, not eight"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("First look at the second floor");

  // The server holds it: one write-up, the visit counts it, the step is on her queue.
  const dana = context.request;
  const notes = await rows<{ id: number; saw: string; next: string }>(dana, data, "visit_notes", { column: "visit_id", op: "eq", value: visit.id });
  expect(notes.map((note) => [note.saw, note.next])).toEqual([["Spec: one open floor, no lift.", "Spec: send Bea the pod layout"]]);
  expect(Number((await named(dana, data, "First look at the second floor"))[0]!.written)).toBe(1);
  expect((await rows<{ visit_note_id: number; visit_id: number }>(dana, data, "visit_agreed", { column: "text", op: "eq", value: "Spec: six pods, not eight" })).map((line) => [line.visit_note_id, line.visit_id])).toEqual([[notes[0]!.id, visit.id]]);
  const steps = await rows<{ due_at: string; owner_id: string }>(dana, data, "follow_ups", { column: "text", op: "eq", value: "Spec: send Bea the pod layout" });
  expect(steps.map((step) => new Date(step.due_at).toISOString())).toEqual(["2026-07-30T09:00:00.000Z"]);
  // Without a reload, her manager reads what was written.
  await expect(hers.getByTestId("notes-state")).toHaveText("Written up");
  await expect(hers.getByLabel("What I saw")).toHaveValue("Spec: one open floor, no lift.");
  await expect(hers.getByTestId("notes-agreed").locator("li")).toHaveText(["Spec: six pods, not eight"]);

  // The list counts it as written up.
  await page.getByRole("link", { name: "All site visits" }).click();
  await expect(chip(page, "done")).toHaveText("3");
  await expect(chip(page, "unwritten")).toHaveText("0");
  await expect(page.getByTestId("visit-missing")).toHaveCount(0);

  // A write-up of the sample, read by Read-only: the ledger's three agreed lines, and nothing to press.
  const walk = (await named(dana, data, "Walk-round with Tomas"))[0]!;
  const reader = await (await as("grace")).newPage();
  await reader.goto(`${STAFF}visits/notes/${String(walk.id)}`);
  await expect(reader.getByTestId("notes-state")).toHaveText("Written up");
  await expect(reader.getByTestId("notes-agreed").locator("li")).toHaveText(["Re-cut the run to 2.4 metres", "Keypads stay", "Delivery week confirmed in writing"]);
  await expect(reader.getByLabel("What I saw")).toHaveAttribute("readonly", "");
  await expect(reader.getByTestId("notes-save")).toHaveCount(0);
  await expect(reader.getByRole("button", { name: /^Take off/ })).toHaveCount(0);
  const grace = await api("grace");
  expect((await grace.patch(data("visit_notes", `/${String(notes[0]!.id)}`), { data: { values: { saw: "Spec: not hers" } }, headers: await csrf(grace) })).status()).toBe(403);
  // Another rep's address for it finds nothing.
  const other = await (await as("sam")).newPage();
  await other.goto(`${STAFF}visits/notes/${String(walk.id)}`);
  await expect(other.getByTestId("notes-none")).toContainText("This visit is not there");
  expect(problems).toEqual([]);
});

test("with the visit e-mails switched off by the CRM admin, the dialog says to tell them yourself, and the server writes no message", async ({ as, api, data }) => {
  // Worked as the sales manager, who books for the people she leads: Dana's minute of requests is the specs after this one's.
  const tessa = await api("tessa");
  const ivy = await api("ivy");
  await room(ivy, data, 80);
  const headers = await csrf(tessa);
  const [settings] = await rows<{ id: number; visit_emails: boolean | number }>(tessa, data, "settings");
  const flip = async (on: boolean): Promise<void> => {
    expect((await tessa.patch(data("settings", `/${String(settings!.id)}`), { headers, data: { values: { visit_emails: on } } })).status()).toBe(200);
  };
  // The switch is the CRM admin's alone: a sales manager and a rep are refused by the server.
  for (const who of ["ivy", "dana"] as const) {
    const person = await api(who);
    expect((await person.patch(data("settings", `/${String(settings!.id)}`), { headers: await csrf(person), data: { values: { visit_emails: false } } })).status(), who).toBeGreaterThanOrEqual(400);
  }
  const visitMessages = async (): Promise<number> => (await rows<{ id: number }>(tessa, data, "outbox", { column: "kind", op: "in", value: ["visit-confirmed", "visit-moved", "visit-cancelled"] })).length;
  try {
    await flip(false);
    const before = await visitMessages();
    const page = await (await as("ivy")).newPage();
    await page.goto(`${STAFF}visits`);
    await page.getByTestId("visit-book").click();
    const dialog = page.getByRole("dialog", { name: "Book a site visit" });
    await dialog.getByLabel("Deal").selectOption({ label: "Cobalt Legal · Records-room lockers" });
    await expect(dialog.getByLabel("Contact")).toHaveValue(/\d+/);
    await expect(dialog.getByTestId("bk-told")).toHaveAttribute("data-mails", "off");
    await expect(dialog.getByTestId("bk-told")).toHaveText("No e-mail goes to Ines Vaughan about this booking. Tell them the day and the time yourself.");
    await dialog.getByLabel("Purpose").fill("Spec: nobody is mailed");
    await dialog.getByLabel("Start").fill("08:30");
    await dialog.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.locator(".crm-toast")).toHaveText(/^Booked: Cobalt Legal/);
    const [made] = await named(ivy, data, "Spec: nobody is mailed");
    // Moved and removed by direct calls: still nothing written.
    const hers = await csrf(ivy);
    expect((await ivy.patch(data("site_visits", `/${String(made!.id)}`), { headers: hers, data: { values: { starts_at: "2026-07-30T09:00:00.000Z" } } })).status()).toBe(200);
    expect((await ivy.delete(data("site_visits", `/${String(made!.id)}?confirm=true`), { headers: hers })).status()).toBeLessThan(300);
    await page.waitForTimeout(1500);
    expect(await visitMessages()).toBe(before);
  } finally {
    await flip(true);
  }
});

test("from the board's look at a deal, a visit is booked on that deal", async ({ as, data }) => {
  const context = await as("dana");
  await room(context.request, data, 100);
  const page = await context.newPage();
  await page.goto(`${STAFF}pipeline`);
  await page.locator('[data-kit-part="board"]').getByRole("button", { name: "Records-room lockers", exact: true }).click();
  const look = page.getByRole("dialog", { name: "Records-room lockers" });
  await look.getByRole("link", { name: "Book a visit" }).click();
  await expect(page).toHaveURL(/\/staff\/visits$/);
  const dialog = page.getByRole("dialog", { name: "Book a site visit" });
  await expect(dialog).toBeVisible();
  const deal = await dealNamed(context.request, data, "Records-room lockers");
  await expect(dialog.getByLabel("Deal")).toHaveValue(String(deal.id));
  await expect(dialog.getByLabel("Contact").locator("option:checked")).toHaveText("Ines Vaughan · Operations Director");
  // Read-only is offered no such way in.
  const reader = await (await as("grace")).newPage();
  await reader.goto(`${STAFF}pipeline`);
  await reader.locator('[data-kit-part="board"]').getByRole("button", { name: "Records-room lockers", exact: true }).click();
  await expect(reader.getByRole("dialog", { name: "Records-room lockers" })).toBeVisible();
  await expect(reader.getByRole("dialog", { name: "Records-room lockers" }).getByRole("link", { name: "Book a visit" })).toHaveCount(0);
});

test("site visits at 390 wide in the dark, the dialog too; and in Arabic right to left", async ({ as, data }) => {
  const context = await as("dana", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await room(context.request, data, 100);
  const page = await context.newPage();
  await page.goto(`${STAFF}visits`);
  await expect(chip(page, "all")).toHaveText("8");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await picture(page, "6-dana-visits-390-dark");
  await page.getByTestId("visit-book").click();
  const dialog = page.getByRole("dialog", { name: "Book a site visit" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((box) => box.scrollWidth <= box.clientWidth + 1 && box.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
  await picture(page, "7-dana-booking-390-dark");
  await page.keyboard.press("Escape");
  await page.goto(`${STAFF}visits/notes`);
  await expect(page.getByTestId("notes-state")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const priya = await as("priya");
  await inArabic(priya.request, async () => {
    const arabic = await priya.newPage();
    await arabic.goto(`${STAFF}visits`);
    await expect(arabic.getByRole("heading", { level: 1 })).toHaveText("زياراتي للمواقع");
    await expect(arabic.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(chip(arabic, "all")).toHaveText(/1|١/);
    await picture(arabic, "8-priya-visits-arabic");
    await arabic.close();
  });
});
