/**
 * THE MAILS, READ IN A MAILBOX (the stand's mail catcher, `mailbox()`): the
 * walks "The visit e-mails name the rep" (P18), "The quote's e-mail in a real
 * mailbox" (session 10) and "The signed-copy e-mail in a real mailbox" (P24).
 *
 * They need a stand that keeps its mail, and are skipped on any other:
 *   CRM_STAND_MAIL=1 CRM_STAND_MAIL_PORT=<port> CRM_STAND_STAGE=3 … npx playwright test e2e/zw-mail.e2e.ts
 * Adminium never mails a `.example` or `.test` address; in mail mode the
 * stand moves the sample's addresses to `.stand`, so the sample's contacts
 * get their mail.
 *
 * What each test makes it takes away again where the product lets anybody:
 * visits are cancelled (that is the walk), the rep is put back to active, the
 * address in email links and the workspace's
 * language are put back. A sent quote stays (no role removes one): its deal
 * is closed as lost, like `z-customer-page.e2e.ts`'s. The signed-off jobs are
 * taken away by the install's owner (`zw-helpers.ts`).
 *
 * THE STAND'S CLOCK is moved on twice by 16 minutes (the moved mail waits out
 * a quarter-hour) and left there: moved back, the server's once-a-minute
 * sweep waits for the minutes it was moved by before it sends anything.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import type { APIRequestContext, Browser, Page } from "@playwright/test";

import { crew } from "../src/i18n/strings/crew.ts";
import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch, type Data } from "./helpers.ts";
import { mailbox, readState, STAND_DIR } from "./stand.mjs";
import { asOwner, bookedVisit, setStandClock, standNow, takeAwayJobs, until, wonJobs } from "./zw-helpers.ts";

interface Mail {
  receivedAt: number;
  subject: string;
  to: string[];
  html: string;
  text: string;
  attachments: { filename: string; contentType: string; size: number; content: string }[];
}

test.skip(({ stand }) => stand.mail === undefined, "needs a stand that keeps its mail: CRM_STAND_MAIL=1 CRM_STAND_MAIL_PORT=<port>");

/** The mails to an address whose subject matches, oldest first, once there are at least `n` (waits for the sender's sweep, a minute at most). */
async function mailsTo(address: string, subject: RegExp, n = 1, ms = 90_000): Promise<Mail[]> {
  const pick = (all: Mail[]): Mail[] => all.filter((mail) => mail.to.map((to) => to.toLowerCase()).includes(address.toLowerCase()) && subject.test(mail.subject));
  const found = await until(async () => pick((await mailbox()) as Mail[]), (some) => some.length >= n, ms, 2000);
  expect(found.length, `${String(n)} mail(s) to ${address} matching ${String(subject)}`).toBeGreaterThanOrEqual(n);
  return found;
}

/** A mail's words, as a person reads them: its text part (the HTML part says the same, with tags). */
const words = (mail: Mail): string => `${mail.subject}\n${mail.text}`;

/** Every link of a mail's HTML part: its words and where it goes. */
function links(html: string): { label: string; href: string }[] {
  const found: { label: string; href: string }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    found.push({ href: match[1]!.replace(/&amp;/g, "&"), label: match[2]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() });
  }
  return found;
}

/** The text a PDF sets, as far as plain strings in its (inflated) streams show it. */
function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  let out = raw;
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out += `\n${inflateSync(bytes.subarray(start, end)).toString("latin1")}`;
    } catch {
      /* not a Flate stream */
    }
  }
  return out;
}

const rowsOf = rows;

/* ───────────────────────── 1. The visit e-mails name the rep ───────────────────────── */

test("the visit e-mails name the rep: booked, moved after the quarter-hour, cancelled; a suspended rep is named nowhere, never “with .”", async ({ as, api, data, stand }) => {
  test.setTimeout(480_000);
  const leo = stand.people["leo"]!;
  const ivy = await api("ivy");
  const tessa = await api("tessa");
  const owner = await asOwner();
  const ownerHeaders = await csrf(owner);
  // One of Leo's open deals whose contact has an address the stand mails.
  const deals = await rowsOf<{ id: number; name: string; company_id: number; contact_id: number | null; state: string }>(tessa, data, "deals", { and: [{ column: "owner_id", op: "eq", value: leo.id }, { column: "state", op: "eq", value: "open" }] });
  let pick: { deal: (typeof deals)[number]; contact: { id: number; name: string; email: string }; company: string } | null = null;
  for (const deal of deals) {
    if (deal.contact_id === null) continue;
    const [contact] = await rowsOf<{ id: number; name: string; email: string | null }>(tessa, data, "contacts", { column: "id", op: "eq", value: deal.contact_id });
    if (contact?.email?.endsWith(".stand") !== true) continue;
    const [company] = await rowsOf<{ name: string }>(tessa, data, "companies", { column: "id", op: "eq", value: deal.company_id });
    pick = { deal, contact: { id: contact.id, name: contact.name, email: contact.email }, company: company!.name };
    break;
  }
  expect(pick, "an open deal of Leo's whose contact the stand mails").not.toBeNull();
  const { deal, contact, company } = pick!;
  const first = contact.name.split(" ")[0]!;
  const PURPOSE = "zw-mail: measure the meeting room";
  const LATER = "zw-mail: second look";
  const AGAIN = "zw-mail: booked while he is suspended";
  const before = await standNow(tessa);
  let jumped = 0;
  let suspended = false;
  const tidy = async (): Promise<void> => {
    const headers = await csrf(tessa);
    for (const visit of await rowsOf<{ id: number }>(tessa, data, "site_visits", { column: "purpose", op: "like", value: "zw-mail:%" })) await tessa.delete(data("site_visits", `/${String(visit.id)}?confirm=true`), { headers });
  };
  await tidy();
  try {
    // BOOK, as Leo, from his Site visits.
    const context = await as("leo");
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}visits`);
    await page.getByTestId("visit-book").click();
    const dialog = page.getByRole("dialog", { name: "Book a site visit" });
    await dialog.getByLabel("Deal").selectOption({ label: `${company} · ${deal.name}` });
    await dialog.getByLabel("Contact").selectOption(String(contact.id));
    await dialog.getByLabel("Purpose").fill(PURPOSE);
    await dialog.getByLabel("Date").fill("2026-08-12");
    await dialog.getByLabel("Start").fill("08:00");
    await expect(dialog.getByTestId("bk-told")).toHaveAttribute("data-mails", "on");
    await dialog.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.locator(".crm-toast")).toHaveText(new RegExp(`^Booked: ${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, Wed, Aug 12, 08:00, Leo\\.$`));
    const [booked] = await mailsTo(contact.email, /is confirmed$/);
    expect(booked!.subject).toBe("Your visit on August 12 is confirmed");
    expect(words(booked!)).toContain(`Hello ${first}, we will visit you on`);
    expect(words(booked!)).toContain("Your visit is with Leo Vance.");
    expect(words(booked!)).not.toMatch(/with \./);

    // MOVE: the moved mail waits out its quarter-hour (the stand's clock is moved on, not waited for).
    const card = page.locator(".crm-visit", { hasText: PURPOSE });
    await card.getByRole("button", { name: new RegExp(`^Move the visit to ${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
    const moving = page.getByRole("dialog", { name: "Move this site visit" });
    await moving.getByLabel("Date").fill("2026-08-13");
    await moving.getByLabel("Start").fill("09:15");
    await moving.getByRole("button", { name: "Move it" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText(/^Moved: .*Thu, Aug 13, 09:15, Leo\.$/);
    // Not before the window closes.
    await new Promise((done) => setTimeout(done, 5000));
    expect(((await mailbox()) as Mail[]).filter((mail) => mail.to.includes(contact.email) && /has moved/.test(mail.subject))).toEqual([]);
    expect(await setStandClock((await standNow(tessa)) + 16 * 60_000)).toBe(true);
    jumped += 16 * 60_000;
    const [moved] = await mailsTo(contact.email, /has moved to/);
    expect(words(moved!)).toContain("has been moved.");
    expect(words(moved!)).toContain("Your visit is with Leo Vance.");
    expect(words(moved!)).toContain("It was: Wednesday, August 12, 2026, 8:00 AM");
    expect(words(moved!)).toContain("New day: Thursday, August 13, 2026");

    // CANCEL.
    await card.getByRole("button", { name: new RegExp(`^Cancel the visit to ${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
    const cancelling = page.getByRole("dialog", { name: "Cancel this site visit" });
    await cancelling.getByLabel("Why is it cancelled?").fill("zw-mail: the room is not ready");
    await cancelling.getByRole("button", { name: "Cancel it" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText(/^Cancelled: /);
    const [cancelled] = await mailsTo(contact.email, /is cancelled$/);
    expect(words(cancelled!)).toContain("will not take place.");
    expect(words(cancelled!)).toContain("The visit was to be with Leo Vance.");
    await picture(page, "zw-mail-1-leo-visits");
    expect(problems).toEqual([]);
    await context.close();

    // A second visit of his, booked while he is active (its confirmation names him) …
    const ivyHeaders = await csrf(ivy);
    const later = await ivy.post(data("site_visits"), { data: { values: { deal_id: deal.id, contact_id: contact.id, rep_id: leo.id, starts_at: "2026-08-14T09:00:00.000Z", minutes: 60, purpose: LATER } }, headers: ivyHeaders });
    expect(later.status(), await later.text()).toBe(201);
    const laterId = ((await later.json()) as { data: { id: number } }).data.id;
    await mailsTo(contact.email, /is confirmed$/, 2);

    // … then the owner suspends Leo in the console (Settings → People → Suspend), keeping his rows his.
    const people = await (await as("owner")).newPage();
    await people.goto("/settings/team");
    const leoRow = people.getByTestId("team-row").filter({ hasText: leo.email });
    await leoRow.getByRole("button", { name: "Suspend" }).click();
    const suspend = people.getByRole("dialog");
    await expect(suspend.getByText("Suspend Leo Vance?")).toBeVisible();
    await expect(suspend.getByTestId("team-suspend-confirm")).toHaveText("Suspend");
    await suspend.getByTestId("team-suspend-confirm").click();
    await expect(suspend).toBeHidden();
    suspended = true;
    await expect(leoRow).toContainText("Suspended");
    expect(((await (await owner.get(`/api/v1/users/${leo.id}`)).json()) as { status: string }).status).toBe("suspended");
    await people.close();
    // The sales manager's booking dialog no longer offers him.
    const ivyPage = await (await as("ivy")).newPage();
    await ivyPage.goto(`${STAFF}visits`);
    await ivyPage.getByTestId("visit-book").click();
    const ivyDialog = ivyPage.getByRole("dialog", { name: "Book a site visit" });
    await expect(ivyDialog.getByLabel("Rep").locator("option")).not.toHaveCount(0);
    await expect(ivyDialog.getByLabel("Rep").locator("option", { hasText: "Leo Vance" })).toHaveCount(0);
    await ivyPage.keyboard.press("Escape");
    // A visit still booked for him, by a direct call: the confirmation has no rep line at all.
    const again = await ivy.post(data("site_visits"), { data: { values: { deal_id: deal.id, contact_id: contact.id, rep_id: leo.id, starts_at: "2026-08-17T09:00:00.000Z", minutes: 60, purpose: AGAIN } }, headers: ivyHeaders });
    console.info(`[zw-mail] a visit booked for a suspended rep, by a direct call: ${String(again.status())}`);
    if (again.status() === 201) {
      const confirmations = await mailsTo(contact.email, /is confirmed$/, 3);
      const third = confirmations[2]!;
      expect(words(third)).not.toContain("Your visit is with");
      expect(words(third)).not.toMatch(/with \./);
      expect(third.html).not.toMatch(/with\s*\./);
    }
    // His earlier visit moved, and cancelled: neither mail names him, or anybody.
    const shifted = await ivy.patch(data("site_visits", `/${String(laterId)}`), { data: { values: { starts_at: "2026-08-14T13:00:00.000Z" } }, headers: ivyHeaders });
    expect(shifted.status(), await shifted.text()).toBe(200);
    expect(await setStandClock((await standNow(tessa)) + 16 * 60_000)).toBe(true);
    jumped += 16 * 60_000;
    const [, moved2] = await mailsTo(contact.email, /has moved to/, 2);
    expect(words(moved2!)).not.toContain("Your visit is with");
    expect(words(moved2!)).not.toMatch(/with \./);
    const gone = await ivy.delete(data("site_visits", `/${String(laterId)}?confirm=true`), { headers: ivyHeaders });
    expect(gone.status(), await gone.text()).toBeLessThan(300);
    const [, cancelled2] = await mailsTo(contact.email, /is cancelled$/, 2);
    expect(words(cancelled2!)).toContain("will not take place.");
    expect(words(cancelled2!)).not.toContain("The visit was to be with");
    expect(words(cancelled2!)).not.toMatch(/with \./);
    expect(cancelled2!.html).not.toMatch(/with\s*\./);
  } finally {
    if (suspended) {
      const back = await owner.patch(`/api/v1/users/${leo.id}`, { data: { status: "active" }, headers: ownerHeaders });
      expect(back.status(), await back.text()).toBe(200);
      // His sessions ended with the suspension: the next spec as Leo signs him in afresh.
      rmSync(join(STAND_DIR, "auth", "leo.json"), { force: true });
    }
    await tidy();
    // The stand's clock is left moved on (by `jumped`): put back, the server's minute sweep would wait out the minutes
    // it was moved by (its last run is pending "in the future"), and no mail would go meanwhile.
    void before;
    void jumped;
  }
});

/* ───────────────────────── 7. The quote's e-mail in a real mailbox ───────────────────────── */

async function stranger(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: "en-US" });
  return context.newPage();
}

test("the quote's e-mail: its button opens the quote with no sign-in, Accept with a name, the rep's open quote turns Accepted; with no address in email links, what the button is", async ({ browser, as, api, data }) => {
  test.setTimeout(300_000);
  const dana = await api("dana");
  const headers = await csrf(dana);
  const owner = await asOwner();
  const ownerHeaders = await csrf(owner);
  const me = ((await (await dana.get(`${STAFF}surface-config.json`)).json()) as { user: { id: string } }).user.id;
  const petra = (await rowsOf<{ id: number; company_id: number; email: string }>(dana, data, "contacts", { column: "name", op: "eq", value: "Petra Lindqvist" }))[0]!;
  expect(petra.email.endsWith(".stand"), petra.email).toBe(true);
  const stages = await rowsOf<{ id: number }>(dana, data, "stages", undefined, "&order=position");
  const item = (await rowsOf<{ id: number; list_rate: string }>(dana, data, "price_list", undefined, "&order=id"))[0]!;
  const was = ((await (await owner.get("/api/v1/settings/email")).json()) as { publicOrigin?: string | null; data?: { publicOrigin?: string | null } });
  const publicOrigin = was.publicOrigin ?? was.data?.publicOrigin ?? null;
  const stand = readState()!;
  let deal: number | null = null;
  try {
    // Studio → Settings → Email: "Address in email links" is the stand's own address.
    const set = await owner.put("/api/v1/settings/email", { data: { publicOrigin: stand.url }, headers: ownerHeaders });
    expect(set.status(), await set.text()).toBe(200);
    const made = await dana.post(data("deals"), { data: { values: { name: "zw-mail: quote by mail", company_id: petra.company_id, contact_id: petra.id, owner_id: me, stage_id: stages[2]!.id, typed_amount: 100 } }, headers });
    expect(made.status(), await made.text()).toBeLessThan(300);
    deal = ((await made.json()) as { data: { id: number } }).data.id;
    const sendOne = async (): Promise<{ id: number; number: string }> => {
      const quote = ((await (await dana.post(data("quotes"), { data: { values: { deal_id: deal, sent_to_contact_id: petra.id } }, headers })).json()) as { data: { id: number; number: string } }).data;
      expect((await dana.post(data("quote_lines"), { data: { values: { document_id: quote.id, qty: 2, rate: Number(item.list_rate), price_id: item.id } }, headers })).status()).toBeLessThan(300);
      const sent = await dana.patch(data("quotes", `/${String(quote.id)}`), { data: { values: { status: "sent" } }, headers });
      expect(sent.status(), await sent.text()).toBe(200);
      return { id: quote.id, number: ((await sent.json()) as { data: { number: string } }).data.number };
    };
    const quote = await sendOne();
    const [mail] = await mailsTo(petra.email, /^Your quote for zw-mail: quote by mail$/);
    expect(words(mail!)).toContain("Hello Petra Lindqvist, here is the quote we talked about.");
    const button = links(mail!.html).find((link) => link.label === "View and accept");
    expect(button, `the mail's links: ${JSON.stringify(links(mail!.html))}`).toBeDefined();
    console.info(`[zw-mail] the quote mail's button: "${button!.label}" → ${button!.href.replace(/#.*/, "#<code>")}`);
    expect(button!.href).toMatch(new RegExp(`^${stand.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/apps/crm/customer/#[A-Za-z0-9_-]{8,}$`));

    // The rep has her quote open.
    const staff = await (await as("dana")).newPage();
    await staff.goto(`${STAFF}quotes/${String(quote.id)}`);
    await expect(staff.getByTestId("quote-customer-page")).toContainText("Petra Lindqvist has the link to this quote by e-mail");

    // The customer follows the button in a browser signed in to nothing: the quote, no sign-in.
    const page = await stranger(browser);
    const problems = watch(page);
    await page.goto(button!.href);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(quote.number);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await page.getByRole("button", { name: "Accept" }).click();
    await page.getByLabel("Your name").fill("Petra Lindqvist");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("by Petra Lindqvist");
    // The rep's open quote follows by itself.
    await expect(staff.getByTestId("quote-customer-page")).toContainText("Petra Lindqvist accepted it on the customer's page");
    await picture(page, "zw-mail-7-customer-accepted");
    expect(problems).toEqual([]);
    await page.context().close();

    // "Address in email links" empty: another quote's mail, and what its button is.
    const cleared = await owner.put("/api/v1/settings/email", { data: { publicOrigin: null }, headers: ownerHeaders });
    expect(cleared.status(), await cleared.text()).toBe(200);
    await sendOne();
    const [, second] = await mailsTo(petra.email, /^Your quote for zw-mail: quote by mail$/, 2);
    const bare = links(second!.html).find((link) => link.label === "View and accept");
    console.info(`[zw-mail] with no address in email links, the button: ${bare === undefined ? "no button in the mail" : `"${bare.label}" → ${bare.href.replace(/[A-Za-z0-9_-]{12,}$/, "<code>")}`}; the text part: ${JSON.stringify(second!.text.split("\n").filter((line) => /accept|http|#/.test(line)))}`);
    // Decision 75: it goes nowhere. Never to some other host, and never the stand's (nothing told the server it).
    if (bare !== undefined) {
      expect(bare.href).not.toMatch(/^https?:\/\//);
      expect(bare.href).not.toContain(stand.url);
    }
  } finally {
    const back = await owner.put("/api/v1/settings/email", { data: { publicOrigin }, headers: ownerHeaders });
    expect(back.status(), await back.text()).toBe(200);
    if (deal !== null) {
      const [held] = await rowsOf<{ state: string }>(dana, data, "deals", { column: "id", op: "eq", value: deal });
      const reason = (await rowsOf<{ id: number }>(dana, data, "lost_reasons"))[0]!;
      if (held?.state === "open") expect((await dana.post(data("deals", `/${String(deal)}/actions/mark-lost`), { data: { from: "open", values: { lost_reason_id: reason.id } }, headers })).status()).toBe(200);
    }
  }
});

/* ───────────────────────── 10. The signed-copy e-mail in a real mailbox ───────────────────────── */

const SIGNED = "zw-mail signed:";
const BLUE = 1;
const TODAY = "2026-07-28";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** Yusuf signs off a visit's job by the server's own door, as his phone's queue sends it (the sign-off on the phone: `crew-signoff.e2e.ts`). */
async function crewSignOff(yusuf: APIRequestContext, data: Data, visit: number, extra: Record<string, unknown> = {}): Promise<number> {
  const res = await yusuf.post(data("sign_offs"), { data: { values: { visit_id: visit, check_1: true, check_2: true, check_3: true, check_4: true, check_5: true, signer_name: "Petra Holm", ...extra }, clientKey: `ZwMailSign${String(visit).padStart(22, "0")}` }, headers: await csrf(yusuf) });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { data: { id: number } }).data.id;
}

test("e-mail 17 after a crew sign-off: who signed, when, the job, the open snags, the signed copy attached; in Arabic the HTML copy; and also to an address typed on the phone's form", async ({ as, api, data, stand }) => {
  test.setTimeout(600_000);
  test.skip(!stand.parts.includes("jobs"), "Jobs on site arrives with stage 2");
  const tessa = await api("tessa");
  const ada = await api("ada");
  const yusuf = await api("f_yusuf");
  const owner = await asOwner();
  const ownerHeaders = await csrf(owner);
  const defaults = (await (await owner.get("/api/v1/settings/defaults")).json()) as Record<string, unknown>;
  const workspace = ((defaults["data"] as Record<string, unknown> | undefined) ?? defaults) as { theme: string; accent: string; density: string; locale: string };
  await takeAwayJobs(data, tessa, SIGNED);
  let wonAt: number | null = null;
  try {
    // The job's contact: one of the company's people with an address the stand mails.
    const contact = (await rowsOf<{ id: number; name: string; email: string | null }>(tessa, data, "contacts", { column: "company_id", op: "eq", value: 1 })).find((one) => one.email?.endsWith(".stand") === true)!;
    expect(contact, "a contact of company 1 the stand mails").toBeDefined();
    const first = contact.name.split(" ")[0]!;
    // The job's contact is its deal's.
    const jobs = await wonJobs(tessa, ada, data, [`${SIGNED} canteen benches`, `${SIGNED} reception desk`, `${SIGNED} meeting pods`], stand.people["dana"]!.id, contact.id);
    wonAt = Date.now();
    const adaHeaders = await csrf(ada);
    for (const one of jobs) expect((await rowsOf<{ contact_id: number | null }>(tessa, data, "jobs", { column: "id", op: "eq", value: one.job }))[0]!.contact_id).toBe(contact.id);
    const visits: number[] = [];
    for (const [i, one] of jobs.entries()) visits.push(await bookedVisit(ada, data, one.job, BLUE, TODAY, ["12:00", "14:30", "17:00"][i]!, `${SIGNED} fitting ${String(i + 1)}`));
    const titles = await Promise.all(jobs.map(async (one) => (await rowsOf<{ title: string }>(tessa, data, "jobs", { column: "id", op: "eq", value: one.job }))[0]!.title));

    // 1. Signed with a snag still open (it does not stop the sign-off): the mail goes to the job's contact.
    const snag = await ada.post(data("snags"), { data: { values: { visit_id: visits[0], text: `${SIGNED} a scuff on the end panel`, stops_sign_off: false } }, headers: adaHeaders });
    expect(snag.status(), await snag.text()).toBe(201);
    const due = ((await snag.json()) as { data: { due_on: string } }).data.due_on.slice(0, 10);
    const signed = await crewSignOff(yusuf, data, visits[0]!, { snags_at_signing: JSON.stringify([{ what: `${SIGNED} a scuff on the end panel`, by: due, note: "" }]) });
    const [mail] = await mailsTo(contact.email!, new RegExp(`^Your signed copy: ${titles[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    const signedAt = (await rowsOf<{ signed_at: string }>(tessa, data, "sign_offs", { column: "id", op: "eq", value: signed }))[0]!.signed_at;
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(new Date(signedAt));
    console.info(`[zw-mail] e-mail 17: ${JSON.stringify({ subject: mail!.subject, to: mail!.to, text: mail!.text, attachments: mail!.attachments.map((one) => [one.filename, one.contentType, one.size]) })}`);
    expect(words(mail!)).toContain(`Hello ${first}, thank you for signing off ${titles[0]!} on`);
    expect(words(mail!)).toMatch(new RegExp(`${day.replace(/ /g, "\\s")}|${new Intl.DateTimeFormat("en-US", { timeZone: "Europe/London", month: "long", day: "numeric", year: "numeric" }).format(new Date(signedAt))}`));
    expect(words(mail!)).toContain("Still to put right");
    expect(words(mail!)).toContain(`${SIGNED} a scuff on the end panel`);
    expect(words(mail!)).toContain("Your signed copy is attached.");
    const pdf = mail!.attachments.find((one) => one.contentType === "application/pdf");
    expect(pdf, "the signed copy, a PDF").toBeDefined();
    const bytes = Buffer.from(pdf!.content, "base64");
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    test.info().attachments.push({ name: "signed-copy.pdf", contentType: "application/pdf", body: bytes });
    // Who signed: the copy names the signer (the mail itself greets the job's contact).
    const text = pdfText(bytes);
    console.info(`[zw-mail] the PDF names the signer in its plain text: ${String(text.includes("Petra Holm"))}`);

    // 2. An address typed on the phone's form (in Arabic first, only looked at; then signed in English): the copy goes
    // there AND to the job's contact.
    const typed = "site.office@harbour-fitouts.stand";
    const ar = (key: keyof (typeof crew)["ar-EG"]): string => crew["ar-EG"][key];
    await inArabic(yusuf, async () => {
      const look = await (await as("f_yusuf", PHONE)).newPage();
      const said = watch(look);
      await look.goto(`${STAFF}sign-off-the-job/${String(visits[2]!)}`);
      await expect(look.locator("html")).toHaveAttribute("dir", "rtl");
      const field = look.getByLabel(ar("cw.sign.copyTo"));
      await expect(field).toBeVisible();
      await expect(look.getByTestId("cw-sign-copyto")).toContainText(ar("cw.sign.copyTo.hint"));
      await field.fill("site.office");
      await field.blur();
      await expect(look.getByTestId("cw-sign-copyto-bad")).toHaveText(ar("cw.sign.copyTo.bad"));
      // The words right to left, the address itself left to right, set at the line's start (the right); nothing wider than the phone.
      expect(await look.getByTestId("cw-sign-copyto-bad").evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
      expect(await field.evaluate((el) => [getComputedStyle(el).direction, getComputedStyle(el).textAlign])).toEqual(["ltr", "right"]);
      expect(await look.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await field.scrollIntoViewIfNeeded();
      await picture(look, "zw-mail-copyto-ar");
      expect(said.filter((line) => !/^Connecting to 'blob:.*Content Security Policy/.test(line))).toEqual([]);
      await look.context().close();
    });
    const page = await (await as("f_yusuf", PHONE)).newPage();
    const problems = watch(page);
    await page.goto(`${STAFF}sign-off-the-job/${String(visits[1]!)}`);
    await expect(page.locator("button[data-check]")).toHaveCount(5);
    for (const check of await page.locator("button[data-check]").all()) if ((await check.getAttribute("aria-checked")) !== "true") await check.tap();
    await page.getByLabel("Their name").fill("Petra Holm");
    const pad = page.getByTestId("cw-sign-customer");
    await pad.getByRole("button", { name: "Type the name instead" }).tap();
    await pad.getByLabel("Name, as the signature").fill("Petra Holm");
    await pad.getByRole("button", { name: "Keep this signature" }).tap();
    await expect(pad).toContainText("The job’s contact gets the copy anyway.");
    await page.getByLabel("Also send the signed copy to").fill(typed);
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("Ready to sign off.");
    await page.getByTestId("cw-sign-go").tap();
    await expect(page.getByTestId("cw-signed-page")).toBeVisible({ timeout: 30_000 });
    expect(problems.filter((line) => !/^Connecting to 'blob:.*Content Security Policy/.test(line))).toEqual([]);
    await page.context().close();
    const [onForm] = await rowsOf<{ copy_sent_to: string | null }>(tessa, data, "sign_offs", { column: "job_id", op: "eq", value: jobs[1]!.job });
    expect(onForm!.copy_sent_to).toBe(typed);
    const [elsewhere] = await mailsTo(typed, new RegExp(`^Your signed copy: ${titles[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    expect(words(elsewhere!)).toContain(`thank you for signing off ${titles[1]!}`);
    expect(elsewhere!.attachments.some((one) => one.contentType === "application/pdf")).toBe(true);
    const [theirs] = await mailsTo(contact.email!, new RegExp(`^Your signed copy: ${titles[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    expect(words(theirs!)).toContain(`Hello ${first}, thank you for signing off ${titles[1]!}`);
    // One each: the typed address is a second copy, never a second mail to the same person.
    await new Promise((done) => setTimeout(done, 3000));
    expect(((await mailbox()) as Mail[]).filter((one) => one.subject.includes(titles[1]!)).map((one) => one.to.join(",").toLowerCase()).sort()).toEqual([contact.email!.toLowerCase(), typed].sort());

    // 3. A customer written to in Arabic (the workspace's language, as no contact holds one): the mail in Arabic, the HTML copy.
    const arabicWorkspace = await owner.put("/api/v1/settings/defaults", { data: { ...workspace, locale: "ar_EG" }, headers: ownerHeaders });
    expect(arabicWorkspace.status(), await arabicWorkspace.text()).toBe(200);
    await crewSignOff(yusuf, data, visits[2]!);
    const all = await until(async () => ((await mailbox()) as Mail[]).filter((one) => one.to.includes(contact.email!) && one.subject.includes(titles[2]!)), (found) => found.length > 0, 90_000);
    const arabic = all[0];
    expect(arabic, "the Arabic mail goes").toBeDefined();
    console.info(`[zw-mail] e-mail 17 in Arabic: ${JSON.stringify({ subject: arabic!.subject, text: arabic!.text.slice(0, 400), attachments: arabic!.attachments.map((one) => [one.filename, one.contentType, one.size]) })}`);
    expect(arabic!.subject).toMatch(/[\u0600-\u06FF]/);
    expect(words(arabic!)).toContain("مرحبًا");
    expect(arabic!.attachments.some((one) => one.contentType === "application/pdf" || one.filename.toLowerCase().endsWith(".pdf"))).toBe(false);
  } finally {
    const back = await owner.put("/api/v1/settings/defaults", { data: workspace, headers: ownerHeaders });
    expect(back.status(), await back.text()).toBe(200);
    if (wonAt !== null) await new Promise((done) => setTimeout(done, Math.max(0, 130_000 - (Date.now() - wonAt!))));
    await takeAwayJobs(data, tessa, SIGNED);
  }
});
