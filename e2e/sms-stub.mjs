/**
 * Preloaded into the stand's server (`node --import`) when `CRM_STAND_SMS_LOG`
 * names a file: Telnyx's API, answered here, so a text the CRM sends goes all
 * the way through Adminium's send path and stops at a provider that is not
 * real. Nothing leaves the machine and nothing is billed.
 *
 * It answers the three calls Adminium makes to Telnyx: the messaging profile
 * (connecting the account), the number's profile (saving the sender) and a
 * message (a send). Each message is appended to the log file as one JSON line
 * (`to`, `from`, `text`, the idempotency key), which `smsSent()` in
 * `e2e/stand.mjs` reads. Every other address goes to the real `fetch`.
 *
 * NOT WHAT THE PRODUCT DOES: no stand without this file can text, because it has
 * no provider account. The stub's key and profile are test values of the stand.
 */
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const LOG = process.env.CRM_STAND_SMS_LOG ?? "";
const PROFILE = process.env.CRM_STAND_SMS_PROFILE ?? "";
const NUMBER = process.env.CRM_STAND_SMS_NUMBER ?? "";

if (LOG !== "") {
  const real = globalThis.fetch;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = async function stubbedFetch(input, init) {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.hostname !== "api.telnyx.com") return real(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === `/v2/messaging_profiles/${PROFILE}`) return json(200, { data: { id: PROFILE, name: "CRM stand", enabled: true } });
    if (method === "GET" && url.pathname === "/v2/phone_numbers/messaging") return json(200, { data: [{ phone_number: NUMBER, messaging_profile_id: PROFILE }] });
    if (method === "POST" && url.pathname === "/v2/messages") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const headers = new Headers(init?.headers ?? {});
      const id = randomUUID();
      appendFileSync(LOG, `${JSON.stringify({ id, to: body.to, from: body.from ?? null, text: body.text, key: headers.get("idempotency-key"), at: new Date().toISOString() })}\n`);
      return json(200, { data: { id, to: [{ phone_number: body.to, status: "queued" }], parts: 1 } });
    }
    return json(404, { errors: [{ code: "10005", title: "Not found on the stand's stub" }] });
  };
  process.stderr.write("[stand sms] Telnyx is answered by the stand's stub\n");
}
