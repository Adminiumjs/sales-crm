#!/usr/bin/env node
/**
 * Plan 68, phase 4 (S12, Q3 = A): the supplier scorecard, whole, on Inventory's
 * receipt lateness (`receipts.expected_on`, `received_on`, `late`, `days_late`).
 *
 * Changes `whole/manifest.json` and the Inventory part of the sample
 * (`whole/seeds/meridian.inventory.json`). Finds everything by key, ref or label,
 * asserts what it needs, and is idempotent: run twice, it changes nothing more.
 *
 *   node scripts/plan68/t27s12-whole.mjs
 *
 * What it does:
 *  - roles: the three that read Supply (the CRM admin, the operations manager,
 *    Read-only) read Inventory's `receipts`, read only, six columns: the row,
 *    its order (whose supplier it was), whether it is posted, the day it came
 *    in, and whether and by how many days it was late. Nothing of its money,
 *    its note or who took it in;
 *  - the sample: the ledger's 123 deliveries (screen 60), each the one
 *    delivery of an order of Inventory's, all inside the last 90 days, each
 *    supplier's late ones as many and as late as the ledger says; and one
 *    older delivery a supplier, on time, outside the 90 days (so the sample's
 *    score is "the last 90 days", not "from" its first day). The orders stay
 *    drafts: an order's status and its time received are Inventory's ledger's,
 *    which an app's sample may not type (the engine refuses the file), and a
 *    move to "received" is the ledger's alone, made by a receipt's lines,
 *    which would put the goods on the shelf. A delivery carries no line, so
 *    no stock moves: the shelf stays the opening receipt's;
 *  - the sample's moves: the four orders still to come are sent by their own
 *    labels (a move of the whole table would ask the received ones to be sent).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const INVENTORY = join(APP, "whole", "seeds", "meridian.inventory.json");

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));

const fail = (message) => {
  throw new Error(`t27s12-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);
const seedTable = (ref) => must(inventory.tables.find((one) => one.ref === ref), `the Inventory sample's ${ref}`);

/* ─── Preconditions ─── */

if (inventory.addOn !== "inventory") fail("meridian.inventory.json is not the Inventory part of the sample");
const SUPPLY_ROLES = ["admin", "ops-manager", "read-only"];
for (const key of SUPPLY_ROLES) {
  const orders = (role(key).tables ?? []).find((one) => one.addOn === "inventory" && one.table === "purchase_orders");
  must(orders, `${key}'s read of Inventory's purchase_orders`);
  if (!orders.limit.readable.includes("supplier_id")) fail(`${key} reads no supplier of an order`);
}
for (const key of ["sales-manager", "rep", "account-manager", "marketer", "front-desk", "crew"]) {
  if ((role(key).tables ?? []).some((one) => one.addOn === "inventory" && one.table === "receipts")) fail(`${key} reads Inventory's receipts`);
}
const place = must(seedTable("places").rows.find((row) => row["@label"] === "inv:place:depot"), "the depot");
const SUPPLIERS = Object.fromEntries(seedTable("suppliers").rows.map((row) => [row.name, row]));

/* ─── The grant ─── */

const RECEIPTS = { addOn: "inventory", table: "receipts", actions: ["read"], limit: { readable: ["id", "po_id", "status", "received_on", "late", "days_late"] } };
for (const key of SUPPLY_ROLES) {
  const list = role(key).tables;
  const at = list.findIndex((one) => one.addOn === "inventory" && one.table === "receipts");
  if (at >= 0) list[at] = structuredClone(RECEIPTS);
  else list.splice(list.findIndex((one) => one.addOn === "inventory" && one.table === "purchase_orders") + 1, 0, structuredClone(RECEIPTS));
}

/* ─── The sample's deliveries ─── */

/**
 * Per supplier (the ledger's screen 60): deliveries in the last 90 days, and how many days late each late one was.
 * The average of a supplier's late days, in whole weeks, is its "weeks over": Halvard and Kirkwall 0, Ostrom and
 * Trellis 1, Fenlow 3. Days count back from the day the sample is added (the ledger's Tue 28 Jul 2026).
 */
const DELIVERIES = [
  ["Halvard Werke", "halvard-werke", 28, [2]],
  ["Kirkwall Steel", "kirkwall-steel", 19, [1, 3]],
  ["Ostrom Seating", "ostrom-seating", 34, [4, 6, 7, 8, 10]],
  ["Trellis Textiles", "trellis-textiles", 22, [5, 9]],
  ["Fenlow Acoustics", "fenlow-acoustics", 14, [12, 16, 19, 21, 22, 24, 25, 29]],
  ["Marchmont Joinery", "marchmont-joinery", 6, []],
];
const FIRST = -84;
const LAST = -2;
/** Day 0 is a Tuesday: a day back on a Saturday or a Sunday is moved to the Friday before. */
const weekday = (day) => (((1 + day) % 7) + 7) % 7;
const onWeekday = (day) => (weekday(day) === 5 ? day - 1 : weekday(day) === 6 ? day - 2 : day);
/** How many days early an on-time delivery came: most on the day. */
const EARLY = [0, 0, 1, 0, 2, 0, 0, 1];

const orders = [];
const receipts = [];
const deliver = (name, slug, n, received, late) => {
  const supplier = must(SUPPLIERS[name], `supplier ${name}`);
  const expected = late > 0 ? received - late : received + EARLY[n % EARLY.length];
  const sent = expected - must(supplier.lead_days, `${name}'s lead days`);
  const label = `inv:po:${slug}:${String(n).padStart(2, "0")}`;
  orders.push({
    "@label": label,
    supplier_id: { "@ref": supplier["@label"] },
    place_id: { "@ref": place["@label"] },
    // No status and no time received: those are Inventory's ledger's to write, and an app's sample brings none of its
    // history (`sampleSectionIssues`). So the order stays a draft that says when it was sent and due.
    sent_how: "none",
    sent_on: { "@day": sent },
    expected_on: { "@day": expected },
  });
  receipts.push({
    "@label": `inv:receipt:${slug}:${String(n).padStart(2, "0")}`,
    po_id: { "@ref": label },
    supplier_id: { "@ref": supplier["@label"] },
    place_id: { "@ref": place["@label"] },
    kind: "delivery",
    status: "posted",
    received_at: { "@day": received, "@time": "10:30" },
    received_on: { "@day": received },
  });
};
let lateAll = 0;
let all = 0;
for (const [name, slug, count, lateDays] of DELIVERIES) {
  // The late ones spread through the supplier's deliveries; every delivery on a weekday inside the 90 days.
  const lateAt = new Map(lateDays.map((days, j) => [Math.floor(((j + 0.5) * count) / lateDays.length), days]));
  if (lateAt.size !== lateDays.length) fail(`${name}: two late deliveries fell on one`);
  // One older delivery first, on time and outside the 90 days: the score is of the last 90 days, never "from" a first day.
  deliver(name, slug, 0, onWeekday(-110 - DELIVERIES.findIndex((one) => one[0] === name) * 3), 0);
  for (let i = 0; i < count; i += 1) {
    const received = onWeekday(count === 1 ? LAST : FIRST + Math.floor((i * (LAST - FIRST)) / (count - 1)));
    if (received < FIRST - 2 || received > LAST) fail(`${name}'s delivery ${String(i)} on day ${String(received)} is outside the 90 days`);
    deliver(name, slug, i + 1, received, lateAt.get(i) ?? 0);
  }
  all += count;
  lateAll += lateDays.length;
}
if (all !== 123 || lateAll !== 18) fail(`the ledger's deliveries are 123 with 18 late, not ${String(all)} with ${String(lateAll)}`);

/** Put the rows of one kind in (replacing the ones of these labels), after the rows already there. */
const putRows = (ref, rows, ours) => {
  const t = seedTable(ref);
  t.rows = [...t.rows.filter((row) => !ours(row)), ...rows];
};
const isOurs = (prefix) => (row) => typeof row["@label"] === "string" && DELIVERIES.some(([, slug]) => row["@label"].startsWith(`${prefix}${slug}:`));
putRows("purchase_orders", orders, isOurs("inv:po:"));
putRows("receipts", receipts, isOurs("inv:receipt:"));
// Rows go in in the order their tables are listed: a delivery names its order, so the orders come first.
{
  const at = (ref) => inventory.tables.findIndex((one) => one.ref === ref);
  if (at("purchase_orders") > at("receipts")) inventory.tables.splice(at("receipts"), 0, ...inventory.tables.splice(at("purchase_orders"), 1));
  if (at("purchase_orders") > at("receipts")) fail("the orders are not listed before the receipts");
}

/* ─── The moves: the four orders on their way are sent by name ─── */

const SENT = ["inv:po:s2", "inv:po:s3", "inv:po:s4", "inv:po:s9"];
for (const label of SENT) must(seedTable("purchase_orders").rows.find((row) => row["@label"] === label), `order ${label}`);
const moves = must(inventory.moves, "the Inventory sample's moves");
const whole = moves.findIndex((move) => move.table === "purchase_orders" && move.to === "sent");
if (whole >= 0) moves.splice(whole, 1, ...SENT.map((ref) => ({ ref, to: "sent" })));
for (const ref of SENT) if (!moves.some((move) => move.ref === ref && move.to === "sent")) fail(`order ${ref} is not sent`);
if (moves.some((move) => move.table === "purchase_orders")) fail("a move still asks every order to be sent");

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(INVENTORY, `${JSON.stringify(inventory, null, 1)}\n`);
console.log(`t27s12-whole: receipts read by ${SUPPLY_ROLES.join(", ")}; ${String(orders.length)} orders and their deliveries in the sample`);
