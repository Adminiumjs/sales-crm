#!/usr/bin/env node
/**
 * Plan 68, T06: who changes which rows (X1, X3, X6's plain parts), a rep's two visits at once (X7's overlap), and the
 * sample rows those need. Changes `whole/manifest.json` and `whole/seeds/meridian.json` and nothing else; run
 * `npm run stage` after it.
 *
 * Every thing is found by its key (a table by `ref`, a role by `key`, a sample row by its name), every precondition is
 * asserted, and a second run changes nothing. Only reach, `belongs`, row limits and the two `writable` lists X6 names
 * are touched on the tables another task changes the columns of (starters, meeting_slots).
 *
 *  - X1: `starter_steps` belong to `owner_id` and to their starter's manager; a rep ticks her own steps; the sales
 *    manager changes and removes the steps, starters and agenda items of her team (an agenda item is its speaker's).
 *  - X3 (Q5 = B): a company is its account owner's and the owner's of an open deal at it. A rep and the account manager
 *    change their own and the ones nobody owns; the sales manager her team's and nobody's; the CRM admin any. A
 *    territory is its owner's: the sales manager changes and removes her team's and nobody's, and names only somebody
 *    she leads (or herself) as its owner. A territory's places go with it.
 *  - X6: a call note (activities) is changed by its author only, and a comment's words too: the manager and the CRM
 *    admin settle a thread and reword nothing. The CRM admin no longer writes a deal's kept history (`was_move_key`,
 *    `was_from_stage`). Saved views and saved searches are private (D9): their owner's, and nobody else's, the
 *    install's owner included. The sample's three views that had no owner are Ivy's, who made them.
 *  - X7: a site visit takes its rep's time: no two of a rep's visits overlap (`occupies`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(root, "whole", "manifest.json");
const SEED = join(root, "whole", "seeds", "meridian.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const seed = JSON.parse(readFileSync(SEED, "utf8"));

const fail = (message) => {
  throw new Error(`t06-whole: ${message}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const tables = manifest.requiredSchema?.tables ?? fail("the manifest has no requiredSchema.tables");
const table = (ref) => tables.find((one) => one.ref === ref) ?? fail(`no table "${ref}"`);
const column = (ref, name) => table(ref).columns.find((one) => one.ref === name) ?? fail(`no column "${ref}.${name}"`);
const role = (key) => manifest.roles.find((one) => one.key === key) ?? fail(`no role "${key}"`);
const holds = (key, ref, action) => role(key).permissions.includes(`table:@${ref}:${action}`);
/** The role's limit on a table, made when it has none. */
const limitOf = (key, ref) => {
  const r = role(key);
  r.limits ??= {};
  r.limits[ref] ??= {};
  return r.limits[ref];
};
/** Set the reach of some actions, each only where the role holds the action. */
const reach = (key, ref, byAction) => {
  const limit = limitOf(key, ref);
  limit.rows ??= {};
  for (const [action, value] of Object.entries(byAction)) {
    if (!holds(key, ref, action)) fail(`${key} holds no ${action} on ${ref}: no reach to set`);
    limit.rows[action] = value;
  }
};
/** A staff column, as a `belongs` way needs it. */
const staff = (ref, name) => {
  if (column(ref, name).rules?.staff !== true) fail(`${ref}.${name} holds no staff member`);
};

/* ── X3: companies and territories ───────────────────────────────────────── */

staff("companies", "account_owner_id");
staff("deals", "owner_id");
if (column("deals", "company_id").references !== "companies") fail("deals.company_id is no link to companies");
if (!(column("deals", "state").enum ?? []).includes("open")) fail("deals.state has no 'open'");
const companies = table("companies");
const companyWays = [
  // The account owner: a rep may name only herself, a manager somebody she leads.
  { column: "account_owner_id", set: "team" },
  // …and whoever owns an open deal at it (Q5 = B: "has an open deal with").
  { through: { table: "deals", link: "company_id", user: "owner_id", while: { column: "state", in: ["open"] } } },
];
if (companies.belongs !== undefined && !same(companies.belongs, companyWays)) fail(`companies already says whose its rows are: ${JSON.stringify(companies.belongs)}`);
companies.belongs = companyWays;
for (const key of ["rep", "account-manager"]) reach(key, "companies", { update: { reach: "own", unowned: true } });
reach("sales-manager", "companies", { update: { reach: "team", unowned: true } });

staff("territories", "owner_id");
const territories = table("territories");
const territoryWays = [{ column: "owner_id", set: "team" }];
if (territories.belongs !== undefined && !same(territories.belongs, territoryWays)) fail(`territories already says whose its rows are: ${JSON.stringify(territories.belongs)}`);
territories.belongs = territoryWays;
reach("sales-manager", "territories", { update: { reach: "team", unowned: true }, delete: { reach: "team", unowned: true } });
if (column("territory_places", "territory_id").references !== "territories") fail("territory_places.territory_id is no link to territories");
const places = table("territory_places");
const placeWays = [{ via: "territory_id" }];
if (places.belongs !== undefined && !same(places.belongs, placeWays)) fail(`territory_places already says whose its rows are: ${JSON.stringify(places.belongs)}`);
places.belongs = placeWays;
reach("sales-manager", "territory_places", { update: { reach: "team", unowned: true }, delete: { reach: "team", unowned: true } });

/* ── X1: starters, their steps, agenda items ─────────────────────────────── */

const starters = table("starters");
if (!same(starters.belongs, [{ column: "manager_id" }])) fail(`starters.belongs is not the manager's: ${JSON.stringify(starters.belongs)}`);
reach("sales-manager", "starters", { update: { reach: "team" }, delete: { reach: "team" } });

staff("starter_steps", "owner_id");
if (column("starter_steps", "starter_id").references !== "starters") fail("starter_steps.starter_id is no link to starters");
const steps = table("starter_steps");
const stepWays = [{ column: "owner_id", set: "team" }, { via: "starter_id" }];
if (steps.belongs !== undefined && !same(steps.belongs, stepWays)) fail(`starter_steps already says whose its rows are: ${JSON.stringify(steps.belongs)}`);
steps.belongs = stepWays;
if (!same(role("rep").limits?.starter_steps?.writable, ["done"])) fail("the rep no longer ticks a step and nothing else");
reach("rep", "starter_steps", { update: { reach: "own" } });
// A step for the starter herself has no owner: the manager makes it, and it is her starter's.
reach("sales-manager", "starter_steps", { update: { reach: "team", unowned: true }, delete: { reach: "team", unowned: true } });

staff("meeting_slots", "who_id");
const slots = table("meeting_slots");
const slotWays = [{ column: "who_id", set: "team" }];
if (slots.belongs !== undefined && !same(slots.belongs, slotWays)) fail(`meeting_slots already says whose its rows are: ${JSON.stringify(slots.belongs)}`);
slots.belongs = slotWays;
// A list limited to a person's rows reads its person column by an index.
slots.indexes ??= [];
if (!slots.indexes.some((index) => index[0] === "who_id")) slots.indexes.push(["who_id"]);
// "Anything else" may name nobody.
reach("sales-manager", "meeting_slots", { update: { reach: "team", unowned: true }, delete: { reach: "team", unowned: true } });

/* ── X6: call notes and comments by their author; the deal's kept history; private saved views ─────────────── */

if (!same(table("activities").belongs, [{ via: "deal_id" }])) fail("activities are no longer read through their deal");
staff("activities", "author_id");
// A call note is changed by whoever wrote it: a rep and the account manager, theirs. The manager and the CRM admin reword
// none: a reach of "the ones I wrote" would also be the reach a new note is hung by (only on deals they are on), and "the
// ones my team wrote" is the gap. So neither holds the update; the CRM admin still removes one.
for (const key of ["sales-manager", "admin"]) {
  const r = role(key);
  r.permissions = r.permissions.filter((grant) => grant !== "table:@activities:update");
  const limit = r.limits?.activities;
  if (limit !== undefined) {
    delete limit.writable;
    delete limit.writableValues;
    delete limit.writableFrom;
    if (limit.rows !== undefined) delete limit.rows.update;
    if (Object.keys(limit.rows ?? {}).length === 0) delete limit.rows;
    if (Object.keys(limit).length === 0) delete r.limits.activities;
  }
}
// A helper on the deal changes none of them (`notThrough`, Adminium 0.3.36): still "the ones I wrote", and fewer.
const withoutListing = (reach) => (reach === undefined || Array.isArray(reach) ? reach : Object.fromEntries(Object.entries(reach).filter(([k]) => k !== "notThrough")));
for (const key of ["rep", "account-manager"]) {
  if (holds(key, "activities", "update") && !same(withoutListing(role(key).limits?.activities?.rows?.update), { reach: "own", by: "author_id" })) fail(`${key} changes call notes it did not write`);
}

if (!same(table("comments").belongs, [{ via: "deal_id" }])) fail("comments are no longer read through their deal");
for (const key of ["sales-manager", "admin"]) {
  const limit = limitOf(key, "comments");
  // Settling a thread is a change of `settled_at` (who settled is the server's stamp, R1b): a manager settles her team's.
  limit.writable = ["settled_at"];
}
reach("sales-manager", "comments", { update: { reach: "team" } });

const DEALS_WRITABLE = ["name", "scope", "company_id", "contact_id", "owner_id", "stage_id", "expected_close", "state", "lost_reason_id", "close_note", "typed_amount", "list_value", "introduce"];
for (const name of DEALS_WRITABLE) column("deals", name);
const managerDeals = role("sales-manager").limits?.deals?.writable ?? fail("the sales manager writes every column of a deal");
for (const name of managerDeals) if (!DEALS_WRITABLE.includes(name)) fail(`the sales manager writes deals.${name}: say whether the CRM admin does`);
const adminDeals = limitOf("admin", "deals");
if (adminDeals.writable !== undefined && !same(adminDeals.writable, DEALS_WRITABLE)) fail(`the CRM admin's deals.writable is already ${JSON.stringify(adminDeals.writable)}`);
adminDeals.writable = DEALS_WRITABLE;

// T09: a view or search is also its maker's (`made_by_id`, stamped on create). 0.2.1 saved a shared one with no owner;
// after the update it is its maker's again, where "own" alone left it read by nobody (the install's owner included).
const OWNER_OR_MAKER = [{ column: "owner_id" }, { column: "made_by_id" }];
for (const ref of ["saved_views", "saved_searches"]) {
  const saved = table(ref);
  if (!same(saved.belongs, [{ column: "owner_id" }]) && !same(saved.belongs, OWNER_OR_MAKER)) fail(`${ref} is no longer its owner's`);
  const maker = column(ref, "made_by_id");
  if (!same(maker.rules?.stamp, { set: "user-id", on: "create" })) fail(`${ref}.made_by_id is no longer stamped with its maker`);
  maker.rules = { staff: true, ...maker.rules };
  saved.belongs = OWNER_OR_MAKER;
  saved.indexes ??= [];
  if (!saved.indexes.some((index) => same(index, ["made_by_id"]))) saved.indexes.push(["made_by_id"]);
  saved.private = true;
  for (const r of manifest.roles) {
    const actions = ["read", "update", "delete"].filter((action) => r.permissions.includes(`table:@${ref}:${action}`));
    if (actions.length === 0) continue;
    const limit = limitOf(r.key, ref);
    limit.rows = Object.fromEntries(actions.map((action) => [action, { reach: "own" }]));
  }
}

/* ── X7: a rep's two visits at once ──────────────────────────────────────── */

const visits = table("site_visits");
const occupies = { resource: "rep_id", start: "starts_at", minutes: "minutes" };
if (column("site_visits", "starts_at").type !== "timestamptz" || column("site_visits", "minutes").type !== "int") fail("a visit's start or length is not what occupies takes");
if (visits.booking !== undefined || visits.capacity !== undefined) fail("site_visits carries a booking or a capacity rule");
if (visits.occupies !== undefined && !same(visits.occupies, occupies)) fail(`site_visits already occupies ${JSON.stringify(visits.occupies)}`);
visits.occupies = occupies;

/* ── the sample ──────────────────────────────────────────────────────────── */

const rowsOf = (ref) => seed.tables.find((one) => one.ref === ref)?.rows ?? fail(`the sample has no ${ref}`);
const nameOf = (row) => (typeof row.name === "string" ? row.name : row.name?.["@t"]?.["en-US"]);
// D9: a view nobody owns would be read by nobody. The three Ivy shared are hers.
for (const name of ["Everything over 20,000", "Sitting 14 days and up", "Discovery, all reps"]) {
  const row = rowsOf("saved_views").find((one) => nameOf(one) === name) ?? fail(`the sample has no saved view "${name}"`);
  if (row.made_by_id?.["@person"] !== "ivy") fail(`"${name}" was not made by Ivy`);
  if (row.owner_id !== undefined && row.owner_id?.["@person"] !== "ivy") fail(`"${name}" is somebody else's`);
  row.owner_id = { "@person": "ivy" };
}
for (const ref of ["saved_views", "saved_searches"]) for (const row of rowsOf(ref)) if (row.owner_id === undefined || row.owner_id === null) fail(`a sample ${ref} row has no owner: "${nameOf(row)}"`);

// X7: no two of a rep's sample visits overlap (checked; the sample places a visit by week day and time).
const spans = rowsOf("site_visits").map((row) => {
  const at = row.starts_at;
  if (typeof at !== "object" || at["@week"] !== true || typeof at["@time"] !== "string") fail(`a sample visit's start is not a week day and a time: ${JSON.stringify(at)}`);
  const [h, m] = at["@time"].split(":").map(Number);
  const start = at["@day"] * 1440 + h * 60 + m;
  return { rep: row.rep_id?.["@person"], start, end: start + Number(row.minutes), label: row["@label"] };
});
for (const a of spans) for (const b of spans) if (a !== b && a.rep === b.rep && a.start < b.end && b.start < a.end) fail(`two sample visits of ${a.rep} overlap: ${a.label}, ${b.label}`);

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(SEED, JSON.stringify(seed, null, 1) + "\n");
console.log("t06-whole: done");
