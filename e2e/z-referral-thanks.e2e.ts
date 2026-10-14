/**
 * E-mail 19, the thank-you for an introduction (F21, decision 134), as the
 * account manager says it: one message when a referral is thanked, and no
 * second one when it is thanked again.
 *
 * The sample is never mailed: the server writes no message about a sample
 * row, so thanking one of the sample's six introductions writes nothing. The
 * spec makes an introduction of its own ("Spec: an introduction to thank").
 *
 * THE FILE'S NAME PUTS IT LAST. A mailed introduction can never be removed
 * (the message keeps it), and `aftersale.e2e.ts` counts the introductions.
 */
import { expect, test } from "./fixtures.ts";
import { csrf, rows } from "./helpers.ts";

test("a thanked introduction is mailed once to who made it; a sample one is not mailed", async ({ api, data }) => {
  const tessa = await api("tessa");
  const hugo = await api("hugo");
  const headers = await csrf(tessa);
  const hugoHeaders = await csrf(hugo);
  const mail = async (id: number): Promise<{ kind: string; to: string | null }[]> => await rows<{ kind: string; to: string | null }>(tessa, data, "outbox", { column: "referral_id", op: "eq", value: id });
  const ruth = (await rows<{ id: number; email: string }>(tessa, data, "contacts", { column: "name", op: "like", value: "Ruth%" }))[0]!;
  const hers = (await rows<{ id: number; from_contact_id: number; thanked_at: string | null }>(tessa, data, "referrals")).find((row) => row.from_contact_id === ruth.id)!;
  expect(hers.thanked_at).toBeNull();
  try {
    // A sample introduction thanked: kept, and nothing mailed.
    expect((await hugo.patch(data("referrals", `/${String(hers.id)}`), { data: { values: { thanked_at: "2026-07-28T10:00:00.000Z" }, seen: { thanked_at: null } }, headers: hugoHeaders })).status()).toBe(200);

    // One of the spec's own, thanked by the account manager.
    const made = await tessa.post(data("referrals"), { data: { values: { from_contact_id: ruth.id, referred_name: "Spec: an introduction to thank", introduced_on: "2026-07-20" } }, headers });
    expect(made.status(), await made.text()).toBe(201);
    const own = ((await made.json()) as { data: { id: number } }).data.id;
    expect(await mail(own)).toEqual([]);
    expect((await hugo.patch(data("referrals", `/${String(own)}`), { data: { values: { thanked_at: "2026-07-28T10:05:00.000Z" }, seen: { thanked_at: null } }, headers: hugoHeaders })).status()).toBe(200);
    // The message is made by the server's own job after the save: waited for, not assumed. It goes to who made the introduction.
    await expect.poll(async () => (await mail(own)).map((row) => row.kind), { timeout: 60_000, intervals: [2_000, 5_000] }).toEqual(["referral-thanks"]);
    expect((await mail(own))[0]!.to).toBe(ruth.email);
    // Thanked once: a second thanks is refused, and no second message is written.
    expect((await hugo.patch(data("referrals", `/${String(own)}`), { data: { values: { thanked_at: "2026-07-29T10:00:00.000Z" }, seen: { thanked_at: null } }, headers: hugoHeaders })).status()).toBe(409);
    expect((await mail(own)).map((row) => row.kind)).toEqual(["referral-thanks"]);
    // The job has run since the sample's thanks: nothing was written about it.
    expect(await mail(hers.id)).toEqual([]);
  } finally {
    expect((await tessa.patch(data("referrals", `/${String(hers.id)}`), { data: { values: { thanked_at: null } }, headers })).status()).toBe(200);
  }
});
