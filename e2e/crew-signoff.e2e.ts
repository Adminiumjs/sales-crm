/**
 * P22, signing a job off on the crew's phone (stage 2), as Yusuf Adeyemi of
 * Blue crew, 390 wide:
 *
 *  - J-07 (the sample's job not signed off yet): "Cable trays short by two
 *    metres" stops it; the screen names the snag, and the server refuses the
 *    crew's sign-off by a direct call (the sign-off's link to its job names
 *    only a job no stopping snag holds);
 *  - a job of the spec's own, from its visit: the five checks, the customer's
 *    name, the signature (typed, the keyboard's way) and a photo, each kept on
 *    the phone until the sign-off goes (plan 68 S19). A snag that stops it is
 *    raised by the office while his page is open and not listening, so his
 *    press reaches the server and is REFUSED: the screen says which snag, the
 *    server's copies of the two files are thrown away (DELETE, gone), the
 *    checks, the name and the photo stay on the phone and the signature does
 *    not. He puts the snag right (a line and a photo), signs again with no
 *    signal: kept on the phone, nothing saved; once back, the reply to the
 *    create is lost, the same create goes again with the same key, and ONE
 *    sign-off is made;
 *  - an extra address for the signed copy, typed on the form: one that is
 *    not an e-mail address holds the sign-off back, said when he leaves the
 *    field; a good one is kept with the refused try, with the sign-off kept
 *    on the phone, and goes with the one sign-off made: one copy to it, one
 *    to the job's contact;
 *  - a return visit to that job shows the sign-off read-only, its signature
 *    and photo drawn from the files.
 *
 * What it makes is named "Spec crew:" and taken away at the end by the
 * install's owner (a sign-off is nobody's to remove in the app).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { request, type APIRequestContext, type Request } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, removeDeals, rows, STAFF, watch, type Data } from "./helpers.ts";
import { room } from "./p12-helpers.ts";
import { readState, STAND_DIR } from "./stand.mjs";

const BLUE = 1;
const J07_VISIT = 7;
const NAME = "Spec crew: canteen benches";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
/** The extra address for the signed copy: a reserved name, so the stand's sender never tries it. */
const COPY_TO = "site.office@canteen.example";

/** A small PNG, a few colours wide: what a phone's camera hands the photo field. */
function photoPng(): Buffer {
  const crc = (bytes: Buffer): number => {
    let c = ~0;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, body: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type), body]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(typed));
    return Buffer.concat([length, typed, sum]);
  };
  const size = 24;
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8;
  head[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) raw.set([x * 10, y * 10, 120], y * (size * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let owner: APIRequestContext | null = null;
async function asOwner(): Promise<APIRequestContext> {
  if (owner !== null) return owner;
  const state = readState()!;
  const file = join(STAND_DIR, "auth", "owner-cleanup.json");
  owner = await request.newContext({ baseURL: state.url, ...(existsSync(file) ? { storageState: file } : {}) });
  if (!existsSync(file)) {
    const res = await owner.post("/api/v1/auth/login", { data: { email: state.owner.email, password: state.owner.password } });
    expect(res.status(), await res.text()).toBe(200);
    await owner.storageState({ path: file });
  }
  return owner;
}

/** Everything the spec hung on its job, then the job, then its deal: as the owner, since no role removes a sign-off. */
async function takeAway(data: Data, tessa: APIRequestContext): Promise<void> {
  const me = await asOwner();
  const headers = await csrf(me);
  for (const deal of await rows<{ id: number }>(me, data, "deals", { column: "name", op: "eq", value: NAME })) {
    for (const job of await rows<{ id: number }>(me, data, "jobs", { column: "deal_id", op: "eq", value: deal.id })) {
      const under = async (ref: string): Promise<void> => {
        for (const row of await rows<{ id: number }>(me, data, ref, { column: "job_id", op: "eq", value: job.id })) expect((await me.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status(), ref).toBeLessThan(300);
      };
      // A refused sign-off's record names its snag (plan 68 S19): it goes first. The mails the job set off name its sign-off
      // (e-mail 17, queued for a crew's sign-off since Adminium 0.3.35) and its visits: they go before them.
      for (const ref of ["outbox", "sign_offs", "refused_sign_offs", "snags", "delivery_notes"]) await under(ref);
      // What the signed job set off or may hold from a later part: the aftercare call its sign-off books (rule 16, once the
      // sign-off moves the job to signed off), and a time sheet's line on its visit (stage 3). A table this stage lacks is passed over.
      for (const ref of ["follow_ups", "time_sheet_lines"]) {
        let held: { id: number }[] = [];
        try {
          held = await rows<{ id: number }>(me, data, ref, { column: "job_id", op: "eq", value: job.id });
        } catch {
          continue;
        }
        for (const row of held) expect((await me.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status(), ref).toBeLessThan(300);
      }
      for (const visit of await rows<{ id: number; state: string }>(me, data, "job_visits", { column: "job_id", op: "eq", value: job.id })) {
        if (visit.state === "done") await me.patch(data("job_visits", `/${String(visit.id)}`), { data: { values: { state: "booked" } }, headers });
        expect((await me.delete(data("job_visits", `/${String(visit.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
      }
      // The customer's delivery mails (booked, and the "called off" a removed visit writes) last. Rule 16's call is booked once
      // the rule's undo wait is over, which on a slow runner can be after the sweep above: sweep again until the job goes.
      let gone = 0;
      for (let attempt = 0; attempt < 20 && gone === 0; attempt += 1) {
        await under("outbox");
        for (const row of await rows<{ id: number }>(me, data, "follow_ups", { column: "job_id", op: "eq", value: job.id }).catch(() => [] as { id: number }[])) {
          await me.delete(data("follow_ups", `/${String(row.id)}?confirm=true`), { headers });
        }
        const removed = await me.delete(data("jobs", `/${String(job.id)}?confirm=true`), { headers });
        if (removed.status() < 300) gone = removed.status();
        else if (removed.status() !== 409 || attempt === 19) expect(removed.status(), await removed.text()).toBeLessThan(300);
        else await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }
  await removeDeals(tessa, data, "Spec crew:");
}

test.skip(({ stand }) => !stand.parts.includes("jobs"), "Jobs on site is not in this stand's stage");

test("J-07: the snag that stops it is named on his phone, and the server refuses his sign-off while it is open", async ({ as, data }) => {
  const context = await as("f_yusuf", PHONE);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}my-day/2026-07-21`);
  const card = page.locator(`[data-visit="${String(J07_VISIT)}"]`);
  await expect(card.locator("h2")).toHaveText("Tandem Robotics");
  await card.getByRole("link", { name: "Sign off the job" }).click();
  await expect(page).toHaveURL(new RegExp(`/sign-off-the-job/${String(J07_VISIT)}$`));
  await expect(page.getByTestId("cw-sign-snags").locator('li[data-stops="1"]')).toContainText("Cable trays short by two metres");
  await expect(page.getByTestId("cw-sign-hint")).toHaveText("“Cable trays short by two metres” stops the sign-off. Put it right first.");
  await expect(page.getByTestId("cw-sign-go")).toBeDisabled();
  // The suggestion is the site's "ask for".
  await expect(page.getByRole("button", { name: "Use Yusuf Demir" })).toBeVisible();
  await picture(page, "p22-6-yusuf-j07-stopped");
  // The server's refusal, by a direct call: the link to a job a stopping snag holds is not allowed. His minute's requests
  // may be spent by the screens before (300 a minute; a fast machine gets there): the call starts on a fresh minute.
  await room(context.request, data, 10);
  const refused = await context.request.post(data("sign_offs"), { data: { values: { visit_id: J07_VISIT, check_1: true, check_2: true, check_3: true, check_4: true, check_5: true, signer_name: "Yusuf Demir" }, clientKey: "SpecCrewJ07Refused00000000000001" }, headers: await csrf(context.request) });
  expect(refused.status(), await refused.text()).toBe(422);
  expect(((await refused.json()) as { error: { details: { fields: Record<string, { code: string }> } } }).error.details.fields["job_id"]?.code).toBe("not-allowed");
  expect(await rows(context.request, data, "sign_offs", { column: "job_id", op: "eq", value: 7 })).toEqual([]);
  expect(problems).toEqual([]);
});

test("a job signed off from its visit as one request: refused with its files thrown away, put right, no connection, a lost reply, one sign-off; then read on a return visit", async ({ as, api, data, stand }) => {
  test.setTimeout(480_000);
  const tessa = await api("tessa");
  const ada = await api("ada");
  const tessaHeaders = await csrf(tessa);
  const adaHeaders = await csrf(ada);
  // What an earlier run that stopped half-way left behind.
  await takeAway(data, tessa);
  let wonAt: number | null = null;
  try {
    // The spec's own job: a won deal, its job made by the operations manager, a fitting today for Blue crew.
    const stage = (await rows<{ id: number }>(tessa, data, "stages", undefined, "&order=position"))[0]!.id;
    const deal = await tessa.post(data("deals"), { data: { values: { name: NAME, company_id: 1, owner_id: stand.people["dana"]!.id, stage_id: stage, typed_amount: 4200 } }, headers: tessaHeaders });
    expect(deal.status(), await deal.text()).toBe(201);
    const dealId = ((await deal.json()) as { data: { id: number } }).data.id;
    expect((await tessa.post(data("deals", `/${String(dealId)}/actions/mark-won`), { data: { from: "open" }, headers: tessaHeaders })).status()).toBe(200);
    wonAt = Date.now();
    // The app's rule makes its job once the win can no longer be undone (a minute). Waited for, not made by hand: a rule's run
    // still waiting when the deal is taken away would run on whatever row SQLite gives the same number next (a later spec's deal).
    let jobs: { id: number }[] = [];
    await expect.poll(async () => (jobs = await rows<{ id: number }>(tessa, data, "jobs", { column: "deal_id", op: "eq", value: dealId })).length, { timeout: 150_000, intervals: [3000] }).toBe(1);
    const jobId = jobs[0]!.id;
    expect((await ada.patch(data("jobs", `/${String(jobId)}`), { data: { values: { site_name: "Spec crew: Canteen", address_lines: "4 Mill Lane", town: "Leeds", ask_for: "Petra Holm", site_phone: "0113 496 0222", access_note: "Side door." } }, headers: adaHeaders })).status()).toBe(200);
    const visit = async (kind: string, what: string, day: string, start: string): Promise<number> => {
      const made = await ada.post(data("job_visits"), { data: { values: { job_id: jobId, kind, what, hours: 2, crew_size: 2 } }, headers: adaHeaders });
      expect(made.status(), await made.text()).toBe(201);
      const id = ((await made.json()) as { data: { id: number } }).data.id;
      expect((await ada.patch(data("job_visits", `/${String(id)}`), { data: { values: { day, start_time: start, crew_id: BLUE } }, headers: adaHeaders })).status()).toBe(200);
      expect((await ada.post(data("job_visits", `/${String(id)}/actions/book`), { data: { from: "waiting" }, headers: adaHeaders })).status()).toBe(200);
      return id;
    };
    const fitting = await visit("install", "Spec crew: canteen benches", "2026-07-28", "13:00");

    const context = await as("f_yusuf", PHONE);
    const page = await context.newPage();
    const problems = watch(page);
    // His page is not told of the office's changes while he fills the form in: the race below reaches the server.
    await page.route("**/api/v1/events**", (route) => route.abort("failed"));
    const files: { method: string; url: string; status: number | null }[] = [];
    page.on("requestfinished", (req: Request) => {
      if (/\/api\/v1\/files(\/|\?|$)/.test(req.url())) void req.response().then((res) => files.push({ method: req.method(), url: req.url(), status: res?.status() ?? null }));
    });

    await page.goto(STAFF);
    const card = page.locator(`[data-visit="${String(fitting)}"]`);
    await expect(card.locator("h2")).toHaveText("Spec crew: Canteen");
    await expect(card.locator(".crm-cw-visit-time")).toHaveText("13:00");
    await card.getByRole("link", { name: "Sign off the job" }).click();
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("Still needed: 5 checks, the customer’s name, their signature.");

    const fill = async (): Promise<void> => {
      await expect(page.locator("button[data-check]")).toHaveCount(5);
      for (const check of await page.locator("button[data-check]").all()) if ((await check.getAttribute("aria-checked")) !== "true") await check.click();
      await page.getByRole("button", { name: "Use Petra Holm" }).click();
      await expect(page.getByLabel("Their name")).toHaveValue("Petra Holm");
      const customer = page.getByTestId("cw-sign-customer");
      await customer.getByRole("button", { name: "Type the name instead" }).click();
      await customer.getByLabel("Name, as the signature").fill("Petra Holm");
      await customer.getByRole("button", { name: "Keep this signature" }).click();
      await expect(customer.getByRole("button", { name: "Sign again" })).toBeVisible();
      await page.getByTestId("cw-sign-photos").locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "benches.png", mimeType: "image/png", buffer: photoPng() });
      await expect(page.getByTestId("cw-sign-photos")).toContainText("1 of 6");
      await expect(page.getByTestId("cw-sign-hint")).toHaveText("Ready to sign off.");
    };
    await fill();
    // An extra address for the signed copy: one that is not an address holds the sign-off back, said once he leaves the field.
    const copyTo = page.getByLabel("Also send the signed copy to");
    await copyTo.fill("site office at the canteen");
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("Still needed: a correct e-mail address for the copy.");
    await expect(page.getByTestId("cw-sign-go")).toBeDisabled();
    await expect(page.getByTestId("cw-sign-copyto-bad")).toHaveCount(0);
    await copyTo.blur();
    await expect(page.getByTestId("cw-sign-copyto-bad")).toHaveText("That is not an e-mail address. Check it, or leave it empty.");
    await expect(copyTo).toHaveAttribute("aria-invalid", "true");
    await copyTo.fill(COPY_TO);
    await expect(page.getByTestId("cw-sign-copyto-bad")).toHaveCount(0);
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("Ready to sign off.");
    // Kept on the phone until the sign-off goes: nothing has been sent yet.
    expect(files).toEqual([]);

    // The office raises a snag that stops it, from her own session; his open page does not hear of it.
    const snag = await ada.post(data("snags"), { data: { values: { visit_id: fitting, text: "Spec crew: a bench rocks on the slope", stops_sign_off: true } }, headers: adaHeaders });
    expect(snag.status(), await snag.text()).toBe(201);
    const snagId = ((await snag.json()) as { data: { id: number } }).data.id;
    await page.getByTestId("cw-sign-go").click();
    await expect(page.getByTestId("queue-refused")).toContainText(/^Not signed off: a snag that stops it was raised: “Spec crew: a bench rocks on the slope” \(\d{2}:\d{2}\)\. Put it right, then the customer signs again\./);
    await expect(page.getByTestId("cw-refused-kept")).toHaveText("The five checks and the 1 photo are still on this phone. The signature was not kept: the customer signs for what is true when they sign.");
    expect(await rows(context.request, data, "sign_offs", { column: "job_id", op: "eq", value: jobId })).toEqual([]);
    // Both files went up with it and the server's copies were thrown away, and are gone.
    await expect.poll(() => files.filter((one) => one.method === "POST" && one.status === 201).length).toBe(2);
    await expect.poll(() => files.filter((one) => one.method === "DELETE" && one.status !== null && one.status < 300).length).toBe(2);
    for (const gone of files.filter((one) => one.method === "DELETE")) expect((await context.request.get(`${new URL(gone.url).pathname}/content`)).status()).toBe(404);
    // The pad starts again, empty; the checks, the name and the photo are still there.
    await expect(page.getByTestId("cw-sign-customer").getByRole("button", { name: "Keep this signature" })).toBeVisible();
    await expect(page.locator('button[data-check][aria-checked="true"]')).toHaveCount(5);
    await expect(page.getByLabel("Their name")).toHaveValue("Petra Holm");
    await expect(page.getByLabel("Also send the signed copy to")).toHaveValue(COPY_TO);
    await expect(page.getByTestId("cw-held-photos").locator("img")).toHaveCount(1);
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("“Spec crew: a bench rocks on the slope” stops the sign-off. Put it right first.");
    await picture(page, "p22-7-yusuf-refused");

    // He puts it right on Snags: a line and a photo of it put right.
    await page.goto(`${STAFF}my-snags`);
    const row = page.locator(`article[data-snag="${String(snagId)}"]`);
    await row.getByRole("button", { name: "Put right" }).click();
    const sheet = page.getByRole("dialog", { name: "Put right" });
    await expect(sheet.getByRole("button", { name: "Put right" })).toBeDisabled();
    await sheet.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "level.png", mimeType: "image/png", buffer: photoPng() });
    await sheet.getByLabel("What you did").fill("Levelled the feet");
    await sheet.getByRole("button", { name: "Put right" }).click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Put right: Spec crew: a bench rocks on the slope.");
    const fixed = (await rows<{ state: string; put_right_note: string; put_right_photo: string | null }>(context.request, data, "snags", { column: "id", op: "eq", value: snagId }))[0]!;
    expect([fixed.state, fixed.put_right_note, fixed.put_right_photo?.startsWith("file_")]).toEqual(["put-right", "Levelled the feet", true]);

    // The office raises one that does not stop it: the customer is shown it as still to put right (plan 68 S13).
    const scuff = await ada.post(data("snags"), { data: { values: { visit_id: fitting, text: "Spec crew: a scuff on the end panel", stops_sign_off: false } }, headers: adaHeaders });
    expect(scuff.status(), await scuff.text()).toBe(201);
    const scuffDue = ((await scuff.json()) as { data: { due_on: string } }).data.due_on.slice(0, 10);

    // Back to the sign-off: the checks, the name and the photo kept from the refused one; he signs again, with no signal.
    await page.goto(`${STAFF}sign-off-the-job/${String(fitting)}`);
    await expect(page.locator(`[data-snag="${String(((await scuff.json()) as { data: { id: number } }).data.id)}"]`)).toContainText("Spec crew: a scuff on the end panel");
    await expect(page.locator('button[data-check][aria-checked="true"]')).toHaveCount(5);
    await expect(page.getByLabel("Their name")).toHaveValue("Petra Holm");
    await expect(page.getByLabel("Also send the signed copy to")).toHaveValue(COPY_TO);
    const pad = page.getByTestId("cw-sign-customer");
    await pad.getByRole("button", { name: "Type the name instead" }).click();
    await pad.getByLabel("Name, as the signature").fill("Petra Holm");
    await context.setOffline(true);
    await pad.getByRole("button", { name: "Keep this signature" }).click();
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("Ready to sign off.");
    await page.getByTestId("cw-sign-go").click();
    await expect(page.locator(".crm-toast").last()).toHaveText("Kept on this phone. It goes when you have signal.");
    await expect(page.getByTestId("cw-sign-kept")).toBeVisible();
    await expect(page.getByTestId("cw-kept-line")).toHaveText("Waiting to send: the office gets it when this phone has signal.");
    await expect(page.getByTestId("cw-kept-copyto")).toHaveText(`The signed copy also goes to ${COPY_TO}.`);
    expect(await rows(context.request, data, "sign_offs", { column: "job_id", op: "eq", value: jobId })).toEqual([]);

    // Back online, and the reply to the create is lost on its way: the same create, with the same key, answers the first one's row.
    const sent: { key: string; replayed: boolean | null }[] = [];
    let dropped = false;
    await page.route("**/api/v1/data/**", async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !/crm_sign_offs$/.test(new URL(req.url()).pathname)) return route.fallback();
      const key = (req.postDataJSON() as { clientKey: string }).clientKey;
      const response = await route.fetch();
      if (!dropped) {
        dropped = true;
        sent.push({ key, replayed: null });
        return route.abort("connectionreset");
      }
      sent.push({ key, replayed: ((await response.json()) as { replayed?: boolean }).replayed === true });
      await route.fulfill({ response });
    });
    await context.setOffline(false);
    await expect(page.locator(".crm-toast").last()).toHaveText("1 sent.", { timeout: 30_000 });
    await page.unroute("**/api/v1/data/**");
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({ key: sent[0]!.key, replayed: true });
    const made = await rows<{ id: number; signer_name: string; signature: string; photos: unknown; check_5: boolean; snags_at_signing: string | null; check_words: string | null; copy_sent_to: string | null }>(context.request, data, "sign_offs", { column: "job_id", op: "eq", value: jobId });
    expect(made.map((one) => [one.signer_name, one.check_5, one.signature.startsWith("file_"), one.copy_sent_to])).toEqual([["Petra Holm", true, true, COPY_TO]]);
    // Sent once, though the create went twice: one copy to the typed address, one to the job's contact.
    await expect.poll(async () => (await rows<{ kind: string }>(await asOwner(), data, "outbox", { column: "sign_off_id", op: "eq", value: made[0]!.id })).map((one) => one.kind).sort(), { timeout: 30_000 }).toEqual(["signed-copy", "signed-copy-to"]);
    // What his screen showed the customer went with it, from the phone's queue: the snag still open (not the one put
    // right), and the five checks in the words he read them in.
    expect(JSON.parse(made[0]!.snags_at_signing ?? "null")).toEqual([{ what: "Spec crew: a scuff on the end panel", by: scuffDue, note: "" }]);
    expect(made[0]!.check_words?.split("\n")).toEqual(["Everything on the list is on site", "Nothing damaged, nothing marked", "Keys and spares handed over", "Floor left as we found it", "Shown them how it works"]);
    // …and nobody of the crew changes them after.
    expect((await context.request.patch(data("sign_offs", `/${String(made[0]!.id)}`), { data: { values: { snags_at_signing: "[]" } }, headers: await csrf(context.request) })).status()).toBeGreaterThanOrEqual(403);
    await expect(page.getByTestId("cw-signed-page")).toBeVisible();
    await expect(page.getByTestId("cw-signed-by")).toHaveText("Signed by Petra Holm, Tuesday, July 28, 2026");
    // Nobody of the crew changes it or takes it away: the server's refusal.
    const headers = await csrf(context.request);
    expect((await context.request.patch(data("sign_offs", `/${String(made[0]!.id)}`), { data: { values: { signer_name: "Somebody" } }, headers })).status()).toBeGreaterThanOrEqual(403);
    expect((await context.request.delete(data("sign_offs", `/${String(made[0]!.id)}?confirm=true`), { headers })).status()).toBeGreaterThanOrEqual(403);

    // A return visit to the signed job, tomorrow: the sign-off read only, with its signature and its photo from the files (B19).
    const back = await visit("return", "Spec crew: canteen benches, one more", "2026-07-29", "09:00");
    await page.goto(`${STAFF}my-day/2026-07-29`);
    const again = page.locator(`[data-visit="${String(back)}"]`);
    await expect(again.getByTestId("cw-signed")).toContainText("Signed off Jul 28, 2026 by Petra Holm");
    await expect(again.getByRole("link", { name: "Sign off the job" })).toHaveCount(0);
    await expect(again.locator("button[data-tick]")).toHaveCount(4);
    await again.getByRole("link", { name: "See the sign-off" }).click();
    const signature = page.getByTestId("cw-signature");
    await expect(signature).toBeVisible();
    await expect.poll(() => signature.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect.poll(() => page.getByTestId("cw-photos").locator("img").first().evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByTestId("cw-sign-go")).toHaveCount(0);
    await picture(page, "p22-8-yusuf-return-visit");
    expect(problems.filter((line) => !/ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to load resource|NetworkError|Failed to fetch/.test(line))).toEqual([]);
  } finally {
    // The win sets off more than one run of "a deal is won: its job is made" (the deal is written again by the stage rules),
    // each a minute after its write. One still waiting when the deal is taken away runs on whatever row SQLite numbers the
    // same next (a later spec's deal: it was given a job). So the deal is taken away only once they have all run, and found
    // the job there: two minutes after the win at most.
    if (wonAt !== null) await new Promise((done) => setTimeout(done, Math.max(0, 130_000 - (Date.now() - wonAt!))));
    await takeAway(data, tessa);
  }
});
