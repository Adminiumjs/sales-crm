#!/usr/bin/env node
/**
 * Plan 68, phase 4, T26c: guards, imports, figures and the board, on the
 * engine words of 0.3.35 (E13, E14, E16, E23).
 *
 * Changes `whole/manifest.json` only (the sample needs no new row). Finds
 * everything by key or name, asserts what it needs, and is idempotent: run
 * twice, it changes nothing more. Touches only the keys named below, so it
 * runs on a manifest that already holds the other agents' changes.
 *
 *   node scripts/plan68/t26c-whole.mjs
 *
 * What it does:
 *  - R5 (E13): `deals.closed_at` is required while the deal is won or lost,
 *    so a closed deal brought in from a file without its closed moment is
 *    named and not brought in (a person's own move still stamps it);
 *    `deals.closed_on` is worked out from `closed_at` (a date `addDays` 0
 *    days after it) when the deal is closed, instead of "today", so a file's
 *    closed deal takes the day of its own closed moment, never the import
 *    day. The CRM admin may bring a list of deals in (`deals:import`);
 *  - R8 (E23): `contacts.may_email_by_id` and `may_email_at` are strict: the
 *    server's on every write, and a file that carries them is refused;
 *  - X4 (E14): Settings' pairs: warm below stale, the quote's warning below
 *    its validity, the working day's start before its end, the showroom's
 *    opening before its closing (each `strict`: never the same); the depot's
 *    country from the built-in list;
 *  - X5 (E14): a cover ends no sooner than it starts and at most 365 days
 *    after (an empty end stays "until further notice", D11);
 *  - X6 (E14's guard): an enquiry's deal is set only while the enquiry is
 *    claimed, by whoever claimed it;
 *  - X7 (E14, D18): a site visit never starts before now when it is made (a
 *    file or the sample, which bring history, are not held to it);
 *  - S8 (E16): the console's Pipeline board: the toolbar (the total of every
 *    card the reader reaches, and a person filter), a card's second money
 *    line (the weighted value, "w") and "days in stage" with its unit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const fail = (message) => {
  throw new Error(`t26c-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);
const tables = must(manifest.requiredSchema?.tables, "requiredSchema.tables");
const table = (ref) => must(tables.find((one) => one.ref === ref), `table ${ref}`);
const column = (ref, name) => must(table(ref).columns.find((one) => one.ref === name), `column ${ref}.${name}`);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);
const page = (ref) => must(manifest.pages.find((one) => one.ref === ref), `page ${ref}`);
const rules = (ref, name) => {
  const c = column(ref, name);
  c.rules ??= {};
  return c.rules;
};
const grant = (key, permission) => {
  const r = role(key);
  if (!r.permissions.includes(permission)) r.permissions.push(permission);
};
/** A label in the eight languages. */
const L = (en, de, fr, da, cs, ar, zhCN, zhTW) => ({ "de-DE": de, "fr-FR": fr, "da-DK": da, "cs-CZ": cs, "ar-EG": ar, "zh-CN": zhCN, "zh-TW": zhTW, en });

/* ─── Preconditions ─── */

for (const ref of ["deals", "contacts", "settings", "covers", "enquiries", "site_visits"]) table(ref);
const closedAt = column("deals", "closed_at");
if (closedAt.rules?.stamp?.set !== "now") fail("deals.closed_at is stamped now when the deal closes");
const closedOn = column("deals", "closed_on");
if (closedOn.type !== "date" || closedOn.rules?.stamp === undefined) fail("deals.closed_on is a stamped date");
for (const name of ["may_email_by_id", "may_email_at"]) if (rules("contacts", name).stamp === undefined) fail(`contacts.${name} is a stamp`);
for (const name of ["sitting_warm_days", "sitting_stale_days", "quote_warn_days", "quote_valid_days", "work_from", "work_to", "showroom_opens", "showroom_closes", "depot_country"]) column("settings", name);
column("covers", "starts_on");
column("covers", "ends_on");
if (column("enquiries", "claimed_by_id").rules?.staff !== true) fail("enquiries.claimed_by_id is a staff column");
if (column("site_visits", "starts_at").type !== "timestamptz") fail("site_visits.starts_at is a moment");
const board = must(page("crm-pipeline").config?.board, "the Pipeline page's board");
if (board.card?.person !== "owner_id" || board.card?.daysSince?.column !== "entered_stage_at") fail("the Pipeline board's card names its owner and the days in stage");
column("deals", "weighted_value");

/* ─── R5: a closed deal brought in carries its closed date ─── */

closedAt.rules.requiredWhen = { column: "state", in: ["won", "lost"] };
// Worked out from the closed moment, so a history line takes its own day: the stamp fires as the deal closes (after the
// moment's own stamp, which it reads), and empties again on a reopen as before.
closedOn.rules.stamp = { set: { addDays: { date: "closed_at", days: 0 } }, on: { column: "state", values: ["won", "lost"] }, clearOnBack: true };
grant("admin", "table:@deals:import");

/* ─── R8: who ticked "may be e-mailed", and when, are the server's ─── */

for (const name of ["may_email_by_id", "may_email_at"]) rules("contacts", name).stamp.strict = true;

/* ─── X4: Settings' pairs, and the depot's country from the list ─── */

rules("settings", "sitting_warm_days").notAfter = { column: "sitting_stale_days", strict: true };
rules("settings", "quote_warn_days").notAfter = { column: "quote_valid_days", strict: true };
rules("settings", "work_from").notAfter = { column: "work_to", strict: true };
rules("settings", "showroom_opens").notAfter = { column: "showroom_closes", strict: true };
rules("settings", "depot_country").options = { list: "builtin:countries" };

/* ─── X5: a cover lasts a year at most ─── */

Object.assign(rules("covers", "ends_on"), { notBefore: { column: "starts_on" }, notAfter: { column: "starts_on", days: 365 } });

/* ─── X6: an enquiry's deal, only while it is claimed, by its claimer ─── */

rules("enquiries", "deal_id").changes = [{ while: { column: "state", in: ["claimed"] }, by: "claimed_by_id" }];

/* ─── X7: a visit is never booked to start in the past ─── */

rules("site_visits", "starts_at").notBefore = "now";

/* ─── S8: the console's Pipeline board ─── */

const weighted = L("w", "gew.", "pond.", "vægt.", "váž.", "مرجّح", "加权", "加權");
const inStage = L("in stage", "in der Phase", "dans l’étape", "i fasen", "ve fázi", "في المرحلة", "在此阶段", "在此階段");
const { en: wEn, ...wOthers } = weighted;
const { en: dEn, ...dOthers } = inStage;
board.toolbar = { total: true, person: "owner_id" };
board.card.secondAmount = { column: "weighted_value", label: wEn, labels: wOthers };
board.card.daysSince = { ...board.card.daysSince, label: dEn, labels: dOthers };

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log("t26c-whole: done");
