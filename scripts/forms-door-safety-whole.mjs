#!/usr/bin/env node
/**
 * What keeps the website forms safe to leave open: on the engine words of
 * Adminium 0.3.42.
 *
 * Changes `whole/manifest.json` only. Finds everything by key, asserts what it
 * needs, and is idempotent: run twice, it changes nothing more. Run it after
 * `forms-and-brochure-whole.mjs` and `surveys-whole.mjs`.
 *
 *   node scripts/forms-door-safety-whole.mjs
 *   npm run stage
 *
 * What it does:
 *  - the brochure is sent for the consent purpose `newsletter` (the CRM's
 *    "May be emailed"): it stays service mail, the enquirer asked for it, but
 *    anyone can type someone else's address into a public form, so it is not
 *    sent to a person whose latest answer is "no", nor to an address on the
 *    do-not-email list (Adminium 0.3.42 stops a service kind that names a
 *    purpose at the list);
 *  - the forms entry on `enquiries` gets two hourly caps on top of each
 *    address's five a day: 60 an hour through it, all forms together (the
 *    engine counts the app's forms key as one), and 10 an hour from one
 *    visitor (an IPv6 subscriber's whole /64), as the survey's entry has.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const fail = (message) => {
  throw new Error(`forms-door-safety-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);

// ── The brochure: a purpose, so a "no" and the do-not-email list stop it ──────
const outbox = must(manifest.outbox, "outbox");
if (outbox.kinds?.brochure === undefined) fail("the outbox kind brochure is not there");
if (outbox.classes?.brochure !== "service") fail("the brochure is not service mail");
outbox.purposes = { ...(outbox.purposes ?? {}), brochure: "newsletter" };

// ── The enquiries' forms entry: hourly caps, all forms together and per visitor ─
const entry = must(manifest.publicAccess?.find((one) => one.table === "enquiries" && one.key === "forms"), "the forms entry on enquiries");
const anonymous = must(entry.anonymous, "the forms entry's anonymous limits");
const { perValue, plainText, ...rest } = anonymous;
// Kept in the order the engine's schema lists them: per value, per key, per visitor, plain text.
entry.anonymous = { ...(perValue === undefined ? {} : { perValue }), ...rest, perKeyHour: 60, perIpHour: 10, ...(plainText === undefined ? {} : { plainText }) };

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("forms-door-safety-whole: whole/manifest.json written");
