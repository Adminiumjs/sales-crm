/**
 * Plan 68 K1: A SAMPLE SIGN-OFF BOOKS ITS AFTERCARE CALL, on a stand that
 * leaves one sample person as the product leaves every one of them: Hugo, not
 * active and with no password (`CRM_STAND_SAMPLE_PERSON=hugo`), whom the
 * sample's Settings names for aftercare calls. Every other spec signs in as
 * the sample's people, so the stand makes them all active; on such a stand the
 * rule's call for a person who is not active went to nobody, and the write
 * failed (the call's owner is required). Engine 0.3.35 (E18) lets a rule run
 * from a sample row name a sample person, and lists what it made with the
 * sample.
 *
 * Run it on a stand of its own, stage 2 or 3, as the LAST thing that stand
 * does (it removes the sample at the end):
 *   CRM_STAND_SAMPLE_PERSON=hugo CRM_STAND_STAGE=3 npx playwright test e2e/k1-sample-person.e2e.ts
 * On any other stand every test here is skipped.
 *
 * J-07, the sample's job still open, is signed off by the install's owner
 * (its stopping snag put right first, and the call the sample wrote for it
 * ahead taken away, so the call that comes is the rule's): the call is
 * Hugo's, the CRM admin sees it on Aftercare calls, and Remove sample data
 * takes it.
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { csrf, rows, STAFF, watch, type Data } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

test.beforeEach(({ stand }) => {
  test.skip(stand.samplePerson !== "hugo", "needs a stand started with CRM_STAND_SAMPLE_PERSON=hugo");
  test.skip(!stand.parts.includes("aftercare"), "After the job arrives with stage 2: run with CRM_STAND_STAGE=2 or 3");
});

/** Asks until `check` holds, at most `ms`. */
async function until<T>(read: () => Promise<T>, check: (value: T) => boolean, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (check(value) || Date.now() > deadline) return value;
    await new Promise((done) => setTimeout(done, 500));
  }
}

let call = 0;

test("J-07 signed off: its aftercare call is Hugo's, a sample person who is not active, and the CRM admin sees it", async ({ api, as, data, stand }) => {
  const owner: APIRequestContext = await api("owner");
  const headers = await csrf(owner);
  const hugo = stand.people["hugo"]!;
  expect(hugo.sample).toBe(true);
  const [job] = await rows<{ id: number; state: string }>(owner, data as Data, "jobs", { column: "code", op: "eq", value: "J-07" });
  expect(job?.state).toBe("installed");
  for (const ahead of await rows<{ id: number }>(owner, data as Data, "follow_ups", { column: "job_id", op: "eq", value: job!.id })) {
    expect((await owner.delete(data("follow_ups", `/${String(ahead.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  }
  for (const snag of await rows<{ id: number; state: string }>(owner, data as Data, "snags", { column: "job_id", op: "eq", value: job!.id })) {
    if (snag.state === "put-right") continue;
    const res = await owner.patch(data("snags", `/${String(snag.id)}`), { headers, data: { values: { state: "put-right", put_right_note: "Trays fitted." } } });
    expect(res.status(), await res.text()).toBeLessThan(300);
  }
  const signed = await owner.post(data("sign_offs"), { headers, data: { values: { job_id: job!.id, check_1: true, signer_name: "Ines Holt" } } });
  expect(signed.status(), await signed.text()).toBe(201);

  // The rule runs on the server's own time: its call comes within seconds.
  const calls = await until(
    () => rows<{ id: number; owner_id: string | null; kind: string }>(owner, data as Data, "follow_ups", { column: "job_id", op: "eq", value: job!.id }),
    (found) => found.length > 0,
  );
  expect(calls.map((one) => [one.owner_id, one.kind])).toEqual([[hugo.id, "aftercare"]]);
  call = calls[0]!.id;

  const context = await as("tessa");
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}aftercare-calls`);
  const card = page.locator(`.crm-ac-card[data-call="${String(call)}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Hugo");
  expect(problems).toEqual([]);
  await context.close();
});

test("Remove sample data takes the call the rule made from the sample's job", async ({ api, data }) => {
  test.skip(call === 0, "the first test made no call");
  const owner = await api("owner");
  const headers = await csrf(owner);
  const removed = await owner.post("/api/v1/apps/crm/sample-data/remove", { headers, data: { keepChanged: false } });
  expect(removed.status(), await removed.text()).toBeLessThan(300);
  const gone = await until(
    async () => (await owner.get(data("follow_ups", `/${String(call)}`))).status(),
    (status) => status === 404,
    120_000,
  );
  expect(gone).toBe(404);
});
