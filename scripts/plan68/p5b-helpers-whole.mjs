#!/usr/bin/env node
// HELPERS READ AND COMMENT ONLY (ruling 1d, owner 2026-10-25: "a rep helping on another team's deal gives that rep read
// and comment"; built before G3 as the manifest review's major 2).
//
// Today a rep listed on a colleague's deal ("Also on this deal", `deal_members`) reaches it for every write the owner
// has but the hand-over: the rep's `update { reach: own }` on `deals`, and on each table whose rows are a deal's, counts
// every way of `deals.belongs`, the `deal_members` listing among them (engine `crud/row-limit.ts` Build.belongs). A
// `by`/`via` reach cannot keep her out without also keeping out whoever COVERS for the owner (`covers`, the other
// listing on `deals`), whose work must go on as today.
//
// So the owner chose a new engine word (2026-10-25, "C"): a reach that does not count one listing's people,
//   { "reach": "own", "notThrough": "deal_members" }
// The rep's (and the account manager's) update and delete reaches of the deal and of every table through it gain it;
// their READ reaches do not, so a helper reads all of it as today, and `comments` keep the listing, so she comments.
// Unchanged: the owner's way (`owner_id`), the cover's (`covers`), a row's own staff column (her own follow-up or visit
// made before: she still finishes, moves or calls it off), the sales manager's `via … by owner_id` reaches (R1d), the
// CRM admin.
//
// NOT APPLIED YET: the word is not in the engine at 448a50684 (Adminium's validator refuses an unknown key of a reach),
// so this script also raises `compatibility.minAdminiumVersion` to the release that carries it (`HELPERS_FLOOR`,
// 0.3.36 unless told). Run it once that release (or a local engine build with the word) is in hand, then
// `npm run stage`, and the proofs on three engines.
//
// AN INSTALL UPDATED FROM 0.2.0 / 0.2.1: the update replaces the roles' limits; nothing in the rows changes. A rep who
// was listed on a colleague's deal keeps reading it and everything on it, and her comments, and loses (from the
// update on): changing the deal (stage, amount, contact, close date, won/lost, reopen), changing, sending or asking
// approval for its quotes and their lines, logging activities and call notes on it, booking visits or making
// follow-ups on it, writing its visits' notes and agreed points, its cover notes and its stock needs. Her own
// follow-ups and visits made on it before stay hers. No new column, no rule, no sample row.
//
// Run: node scripts/plan68/p5b-helpers-whole.mjs [--dry-run]  (idempotent)
//   HELPERS_WORD   the word's name as the engine builds it (default notThrough)
//   HELPERS_FLOOR  the first Adminium that carries it (default 0.3.36)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const WORD = process.env.HELPERS_WORD ?? "notThrough";
const FLOOR = process.env.HELPERS_FLOOR ?? "0.3.36";
const LISTING = "deal_members";
const DRY = process.argv.includes("--dry-run");
const fail = (message) => {
  throw new Error(`p5b-helpers-whole: ${message}`);
};

/**
 * Every reach the word joins, by role, table and action, with what it must hold before (without the word). The read
 * reaches are left as they are; so are `comments` (a helper comments) and `deal_members` (already the deal owner's).
 */
const CHANGES = {
  rep: {
    deals: { update: [{ reach: "own" }] },
    quotes: { update: [{ reach: "own" }] },
    quote_lines: { update: [{ reach: "own" }], delete: [{ reach: "own" }] },
    follow_ups: { update: [{ reach: "own", by: "owner_id" }], delete: [{ reach: "own", by: "owner_id" }] },
    activities: { update: [{ reach: "own", by: "author_id" }] },
    site_visits: { update: [{ reach: "own", by: "rep_id" }], delete: [{ reach: "own", by: "rep_id" }] },
    visit_notes: { update: [{ reach: "own" }] },
    visit_agreed: { update: [{ reach: "own" }], delete: [{ reach: "own" }] },
    cover_notes: { update: [{ reach: "own" }] },
    deal_stock_needs: { update: [{ reach: "own" }] },
  },
  // Listed on an open deal he is a helper too; his aftercare calls are his by their `owner_id`, which the word leaves.
  "account-manager": {
    follow_ups: { update: [{ reach: "own", by: "owner_id" }] },
  },
};

/** The tables a listing through `deal_members` reaches: `deals` itself, and every table that hangs off it (one or two links up). */
function throughDeals(tables) {
  const byRef = new Map(tables.map((table) => [table.ref, table]));
  const linkTo = (table, column) => table.columns.find((one) => one.ref === column)?.references;
  const reaches = (ref, steps) => {
    const table = byRef.get(ref);
    if (table === undefined) return false;
    if ((table.belongs ?? []).some((way) => way.through?.table === LISTING)) return true;
    if (steps >= 2) return false;
    return (table.belongs ?? []).some((way) => way.via !== undefined && reaches(linkTo(table, way.via), steps + 1));
  };
  return new Set(tables.filter((table) => reaches(table.ref, 0)).map((table) => table.ref));
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const tables = manifest.requiredSchema?.tables ?? fail("no requiredSchema.tables");
const deals = tables.find((one) => one.ref === "deals") ?? fail("no deals table");
if (!(deals.belongs ?? []).some((way) => way.through?.table === LISTING && way.through.user === "user_id")) fail(`deals no longer belongs through ${LISTING}.user_id`);
if (!(deals.belongs ?? []).some((way) => way.through?.table === "covers")) fail("deals no longer belongs through covers: whoever covers would lose nothing, check the change");
const through = throughDeals(tables);

const listOf = (reaches) => (reaches === undefined ? [] : Array.isArray(reaches) ? reaches : [reaches]);
const bare = (reach) => JSON.stringify(Object.fromEntries(Object.entries(reach).filter(([key]) => key !== WORD).sort()));
const said = [];

for (const [roleKey, byTable] of Object.entries(CHANGES)) {
  const role = manifest.roles.find((one) => one.key === roleKey) ?? fail(`no role "${roleKey}"`);
  for (const [ref, byAction] of Object.entries(byTable)) {
    if (!through.has(ref)) fail(`"${ref}" is not reached through ${LISTING}: the word would mean nothing there`);
    const rows = role.limits?.[ref]?.rows ?? fail(`${roleKey} has no row limit on ${ref}`);
    for (const [action, before] of Object.entries(byAction)) {
      const now = listOf(rows[action]);
      if (now.length !== before.length || now.some((reach, i) => bare(reach) !== bare(before[i]))) {
        fail(`${roleKey}'s ${action} of ${ref} is ${JSON.stringify(rows[action])}, not ${JSON.stringify(before)} (with or without ${WORD}): another change moved it, look before running`);
      }
      const next = now.map((reach) => (reach[WORD] === LISTING ? reach : { ...reach, [WORD]: LISTING }));
      if (JSON.stringify(next) !== JSON.stringify(now)) said.push(`${roleKey} ${ref}.${action}: ${JSON.stringify(rows[action])} -> ${JSON.stringify(next.length === 1 ? next[0] : next)}`);
      rows[action] = Array.isArray(rows[action]) ? next : next[0];
    }
    // The read stays as it is: a helper reads the deal and everything on it.
    if (listOf(rows.read).some((reach) => reach[WORD] !== undefined)) fail(`${roleKey}'s read of ${ref} names ${WORD}: a helper must still read it`);
  }
}

// What a helper keeps, said as an assertion: her comments count the listing, and the sales manager's reaches are R1d's.
const repComments = listOf(manifest.roles.find((one) => one.key === "rep")?.limits?.comments?.rows?.update);
if (repComments.length !== 1 || repComments[0][WORD] !== undefined || repComments[0].by !== "author_id") fail("the rep's comments are no longer { own, by author_id } without the word: a helper must comment");

// The release that carries the word.
const at = manifest.compatibility?.minAdminiumVersion ?? fail("no compatibility.minAdminiumVersion");
const num = (v) => v.split(/[.-]/).slice(0, 3).map(Number);
const older = (a, b) => {
  const [x, y] = [num(a), num(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};
if (older(at, FLOOR)) {
  said.push(`compatibility.minAdminiumVersion: ${at} -> ${FLOOR}`);
  manifest.compatibility.minAdminiumVersion = FLOOR;
}

for (const line of said) console.log(line);
if (said.length === 0) console.log("p5b-helpers-whole: nothing to change");
if (!DRY) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
