/**
 * Walks "The aftercare call after a real sign-off" (stage 2) and "A real crew
 * member's sign-off books the aftercare call" (stage 3), as one spec: on an
 * install with REAL people, not the sample's (`zw-helpers.ts` invites them as
 * an owner does: a crew member, Noor Haddad, given the crew role and a place
 * in Blue crew; and an account manager, Iris Moreau).
 *
 * The CRM admin names Iris for the aftercare calls in Settings (After the job)
 * and sets the call at 10 days. Noor signs off a job of the spec's own on his
 * phone: the call that comes is Iris's, due ten days after the sign-off's day
 * at 09:00 where the business is, and Iris finds it on her Aftercare calls.
 * Then nobody is named in Settings, and his sign-off of a second job gives the
 * call to the rep who sold it (the deal's owner, Dana).
 *
 * What it makes is named "zw-aftercare:" and taken away by the install's
 * owner (no role removes a sign-off; a sign-off's queued e-mail 17 is
 * removed first, as `crew-signoff.e2e.ts` does), the two people are removed
 * for good, and Settings is put back.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch, type Data } from "./helpers.ts";
import { asOwner, asReal, bookedVisit, invite, removePerson, takeAwayJobs, until, wonJobs, type RealPerson } from "./zw-helpers.ts";

const BLUE = 1;
const PREFIX = "zw-aftercare:";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const NOOR = { name: "Noor Haddad", email: "noor.haddad@zw-real.test" };
const IRIS = { name: "Iris Moreau", email: "iris.moreau@zw-real.test" };
const DAYS = 10;
const TODAY = "2026-07-28";

test.skip(({ stand }) => !stand.parts.includes("aftercare") || !stand.parts.includes("jobs"), "After the job and Jobs on site arrive with stage 2: run with CRM_STAND_STAGE=2 or 3");

/** The day a moment falls on in London, and that day plus `days` at 09:00 there, as an instant. */
function dueOf(signedAt: string, days: number): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(signedAt));
  const target = new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  // 09:00 in London that day: BST (UTC+1) from the last Sunday of March to the last Sunday of October.
  for (const offset of [1, 0]) {
    const at = new Date(`${target}T${String(9 - offset).padStart(2, "0")}:00:00Z`);
    if (new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(at) === "09") return at.toISOString();
  }
  throw new Error("no 09:00 in London that day");
}

/** He signs off a visit's job on his phone, as the crew does: the five checks, the customer's name, a typed signature. */
async function signOff(page: Page, visit: number): Promise<void> {
  await page.goto(`${STAFF}my-day/${TODAY}`);
  const card = page.locator(`[data-visit="${String(visit)}"]`);
  await expect(card.locator("h2")).toContainText(PREFIX);
  await card.getByRole("link", { name: "Sign off the job" }).tap();
  await expect(page).toHaveURL(new RegExp(`/sign-off-the-job/${String(visit)}$`));
  await expect(page.locator("button[data-check]")).toHaveCount(5);
  for (const check of await page.locator("button[data-check]").all()) if ((await check.getAttribute("aria-checked")) !== "true") await check.tap();
  await page.getByRole("button", { name: "Use Petra Holm" }).tap();
  const customer = page.getByTestId("cw-sign-customer");
  await customer.getByRole("button", { name: "Type the name instead" }).tap();
  await customer.getByLabel("Name, as the signature").fill("Petra Holm");
  await customer.getByRole("button", { name: "Keep this signature" }).tap();
  await expect(page.getByTestId("cw-sign-hint")).toHaveText("Ready to sign off.");
  await page.getByTestId("cw-sign-go").tap();
  await expect(page.getByTestId("cw-signed-page")).toBeVisible({ timeout: 30_000 });
}

interface Call {
  id: number;
  owner_id: string | null;
  kind: string;
  due_at: string;
  call_no: string | number;
  deal_id: number | null;
}

test("a real crew member's sign-off books the aftercare call: for the person Settings names, else the rep who sold the job; due after the set days at 09:00", async ({ as, api, browser, data, stand }) => {
  test.setTimeout(720_000);
  const tessa = await api("tessa");
  const ada = await api("ada");
  const tessaHeaders = await csrf(tessa);
  const settings = (await rows<{ id: number; aftercare_owner_id: string | null; aftercare_days: number }>(tessa, data, "settings"))[0]!;
  const dana = stand.people["dana"]!.id;
  // What an earlier run that stopped half-way left behind.
  await takeAwayJobs(data, tessa, PREFIX);
  for (const one of [NOOR, IRIS]) await removePerson(one.email);
  let noor: RealPerson | null = null;
  let iris: RealPerson | null = null;
  let member: number | null = null;
  let wonAt: number | null = null;
  try {
    // The owner invites them as people are invited; each follows the link and is active, not a sample person.
    noor = await invite(NOOR.name, NOOR.email, "crew");
    iris = await invite(IRIS.name, IRIS.email, "account-manager");
    // The office puts Noor in Blue crew.
    const joined = await ada.post(data("crew_members"), { data: { values: { crew_id: BLUE, user_id: noor.id, since: "2026-07-01" } }, headers: await csrf(ada) });
    expect(joined.status(), await joined.text()).toBe(201);
    member = ((await joined.json()) as { data: { id: number } }).data.id;

    // Two won deals of Dana's: their jobs, made by the app's rule, and a fitting of each for Blue crew today.
    const [first, second] = await wonJobs(tessa, ada, data, [`${PREFIX} first job`, `${PREFIX} second job`], dana);
    wonAt = Date.now();
    const visits = [await bookedVisit(ada, data, first!.job, BLUE, TODAY, "15:00", `${PREFIX} benches`), await bookedVisit(ada, data, second!.job, BLUE, TODAY, "17:30", `${PREFIX} lockers`)];

    // Settings → After the job: the CRM admin names Iris for the calls, and sets them at ten days.
    const desk = await (await as("tessa")).newPage();
    const deskProblems = watch(desk);
    await desk.goto(`${STAFF}settings/after-the-job`);
    const ownerPick = desk.getByTestId("ac-set-owner");
    await expect(ownerPick.locator("option", { hasText: IRIS.name })).toHaveCount(1);
    await ownerPick.selectOption({ label: IRIS.name });
    await expect(desk.locator(".crm-toast").last()).toHaveText("Aftercare calls: saved.");
    const daysField = desk.getByRole("spinbutton", { name: /An aftercare call is due after/ }).or(desk.getByRole("textbox", { name: /An aftercare call is due after/ }));
    await daysField.fill(String(DAYS));
    await daysField.press("Enter");
    await expect(desk.locator(".crm-toast").last()).toHaveText("An aftercare call is due after: saved.");
    const saved = (await rows<{ aftercare_owner_id: string | null; aftercare_days: number }>(tessa, data, "settings"))[0]!;
    expect([saved.aftercare_owner_id, Number(saved.aftercare_days)]).toEqual([iris.id, DAYS]);

    // Noor, on his phone, signs off the first job.
    const phone = await asReal(browser, noor, PHONE);
    const page = await phone.newPage();
    const problems = watch(page);
    await signOff(page, visits[0]!);
    const callOf = async (job: number): Promise<Call[]> => rows<Call>(tessa, data, "follow_ups", { column: "job_id", op: "eq", value: job });
    // The sign-off is his, a real person's, and it moves the job.
    const [signed] = await rows<{ id: number; signer_name: string }>(tessa, data, "sign_offs", { column: "job_id", op: "eq", value: first!.job });
    expect(signed?.signer_name).toBe("Petra Holm");
    const job1 = (await rows<{ state: string; signed_off_at: string }>(tessa, data, "jobs", { column: "id", op: "eq", value: first!.job }))[0]!;
    expect(job1.state).toBe("signed-off");
    // The rule's run wakes a minute after the sign-off: the call comes then, Iris's, ten days on at 09:00.
    const calls1 = await until(() => callOf(first!.job), (found) => found.length > 0, 150_000);
    expect(calls1.map((one) => [one.owner_id, one.kind, Number(one.call_no), one.deal_id])).toEqual([[iris.id, "aftercare", 1, first!.deal]]);
    expect(new Date(calls1[0]!.due_at).toISOString()).toBe(dueOf(job1.signed_off_at, DAYS));
    // Iris, signed in as herself, finds it on her Aftercare calls.
    const irisPage = await (await asReal(browser, iris)).newPage();
    const irisProblems = watch(irisPage);
    await irisPage.goto(`${STAFF}aftercare-calls`);
    const card = irisPage.locator(`.crm-ac-card[data-call="${String(calls1[0]!.id)}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(PREFIX);
    await picture(irisPage, "zw-aftercare-1-iris-calls");
    await irisPage.context().close();

    // Nobody named in Settings: the call is the rep's who sold the job.
    await desk.goto(`${STAFF}settings/after-the-job`);
    await expect(ownerPick).toHaveValue(iris.id);
    await ownerPick.selectOption("");
    await expect(desk.locator(".crm-toast").last()).toHaveText("Aftercare calls: saved.");
    expect((await rows<{ aftercare_owner_id: string | null }>(tessa, data, "settings"))[0]!.aftercare_owner_id).toBeNull();
    await signOff(page, visits[1]!);
    const job2 = (await rows<{ state: string; signed_off_at: string }>(tessa, data, "jobs", { column: "id", op: "eq", value: second!.job }))[0]!;
    expect(job2.state).toBe("signed-off");
    const calls2 = await until(() => callOf(second!.job), (found) => found.length > 0, 150_000);
    expect(calls2.map((one) => [one.owner_id, one.kind, Number(one.call_no)])).toEqual([[dana, "aftercare", 1]]);
    expect(new Date(calls2[0]!.due_at).toISOString()).toBe(dueOf(job2.signed_off_at, DAYS));
    await picture(page, "zw-aftercare-2-noor-signed");
    expect(problems).toEqual([]);
    expect(irisProblems).toEqual([]);
    expect(deskProblems).toEqual([]);
    await phone.close();
  } finally {
    // Settings back as the sample had them.
    const back = await tessa.patch(data("settings", `/${String(settings.id)}`), { data: { values: { aftercare_owner_id: settings.aftercare_owner_id, aftercare_days: settings.aftercare_days } }, headers: tessaHeaders });
    expect(back.status(), await back.text()).toBe(200);
    // The win's runs of "a deal is won: its job is made" all done before the deals go (`crew-signoff.e2e.ts`).
    if (wonAt !== null) await new Promise((done) => setTimeout(done, Math.max(0, 130_000 - (Date.now() - wonAt!))));
    await takeAwayJobs(data as Data, tessa, PREFIX);
    if (member !== null) {
      const me: APIRequestContext = await asOwner();
      expect((await me.delete(data("crew_members", `/${String(member)}?confirm=true`), { headers: await csrf(me) })).status()).toBeLessThan(300);
    }
    for (const one of [NOOR, IRIS]) await removePerson(one.email);
    void noor;
    void iris;
  }
});
