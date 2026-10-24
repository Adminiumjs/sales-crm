#!/usr/bin/env node
/**
 * Plan 68, phase 4 (T26b): R4a, R4b, R4d, S3, S16 (and X8's test, which needs
 * no manifest change).
 *
 * Changes `whole/manifest.json` only (the sample needs no new row: every
 * message it holds is live by the column's default). Finds everything by key
 * or name, asserts what it needs, and is idempotent: run twice, it changes
 * nothing more.
 *
 *   node scripts/plan68/t26b-whole.mjs
 *
 * What it does:
 *  - actions (R4a, R4b; E27): three more ways a step is somebody's, through
 *    the private table it hangs on and naming only that row's own people: the
 *    rep of its coaching area, the manager of its coaching area, the manager
 *    of its one-to-one. The rep's and the manager's change (and the manager's
 *    removal) stay on the actions they own or set; the manager also reads the
 *    meeting actions her reps set (`reach: team, by: set_by_id, while source =
 *    meeting`), never another manager's one-to-one or coaching;
 *  - messages (R4d; E19): a state, live by default (so every message kept
 *    stays live on update), and one move, live → removed, made by the
 *    message's own "Remove" button, which empties the words in the same write
 *    and stamps who removed it and when (the server's, always). The move
 *    waits for the words to be empty, so a plain change of the state that
 *    keeps them is refused; nobody writes the words after the message is
 *    made; their earlier values are the audit log's alone (`history:
 *    "audit"`). The author removes her own; the CRM admin any message of a
 *    conversation she is in (her read of messages is the conversations she
 *    is in);
 *  - deal_members (S3; E8): a removed member is kept, read through the deal;
 *  - site_visits, showroom_bookings, job_visits (S16; E8): a removal takes a
 *    reason, and a removed row is kept, read through the row it hung on.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const fail = (message) => {
  throw new Error(`t26b-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);
/** A label in the eight languages, in the manifest's order. */
const L = (en, de, fr, da, cs, ar, zhCN, zhTW) => ({ "en-US": en, "de-DE": de, "fr-FR": fr, "da-DK": da, "cs-CZ": cs, "ar-EG": ar, "zh-CN": zhCN, "zh-TW": zhTW });
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const tables = manifest.requiredSchema.tables;
const table = (ref) => must(tables.find((one) => one.ref === ref), `table ${ref}`);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);
const columnOf = (tableRef, ref) => must(table(tableRef).columns.find((one) => one.ref === ref), `${tableRef}.${ref}`);

/** Put a column in (or replace the one of that name), after `after` when it is new. */
function column(tableRef, def, after) {
  const t = table(tableRef);
  const at = t.columns.findIndex((one) => one.ref === def.ref);
  if (at >= 0) {
    t.columns[at] = def;
    return;
  }
  const where = must(t.columns.findIndex((one) => one.ref === after) + 1 || undefined, `${tableRef}.${after}`);
  t.columns.splice(where, 0, def);
}
const addOnce = (list, value) => {
  if (!list.some((one) => sameJson(one, value))) list.push(value);
};
/** Put a permission in after another of the same table (or at the end), once. */
function grant(key, permission, after) {
  const list = role(key).permissions;
  if (list.includes(permission)) return;
  const at = after === undefined ? -1 : list.indexOf(after);
  if (at === -1) list.push(permission);
  else list.splice(at + 1, 0, permission);
}
function limitOf(key, ref) {
  const r = role(key);
  r.limits ??= {};
  r.limits[ref] ??= {};
  return r.limits[ref];
}

/* ─── Preconditions ─── */

for (const ref of ["actions", "coaching_areas", "one_to_ones", "messages", "threads", "thread_members", "deal_members", "site_visits", "showroom_bookings", "job_visits"]) table(ref);
for (const key of ["admin", "sales-manager", "rep", "account-manager"]) role(key);
for (const ref of ["coaching_areas", "one_to_ones"]) {
  const t = table(ref);
  if (t.private !== true) fail(`${ref} is no longer private`);
  for (const person of ["rep_id", "manager_id"]) if (!t.belongs.some((way) => way.column === person)) fail(`${ref} no longer belongs to its ${person}`);
}
for (const [ref, link] of [["coaching_area_id", "coaching_areas"], ["one_to_one_id", "one_to_ones"]]) {
  if (columnOf("actions", ref).references !== link) fail(`actions.${ref} no longer links to ${link}`);
}
if (columnOf("messages", "text").type !== "text") fail("messages.text is not text");
if (table("messages").states !== undefined && table("messages").states.column !== "state") fail("messages keeps states on another column");

/* ─── actions: R4a and R4b ─── */

const actions = table("actions");
for (const way of [
  // The rep of its coaching area: a rep reads every step of her own plan (4b).
  { column: "coaching_area_id", person: "rep_id" },
  // The manager of its coaching area, and of its one-to-one: she reads the steps her rep set there (4a).
  { column: "coaching_area_id", person: "manager_id" },
  { column: "one_to_one_id", person: "manager_id" },
]) {
  addOnce(actions.belongs, way);
}
const OWN_OR_SET = [
  { reach: "own", by: "owner_id" },
  { reach: "own", by: "set_by_id" },
];
{
  const rep = limitOf("rep", "actions");
  rep.rows ??= {};
  rep.rows.read = { reach: "own" };
  rep.rows.update = OWN_OR_SET;
  const manager = limitOf("sales-manager", "actions");
  manager.rows ??= {};
  // Her own (the ways above included), and the meeting actions her reps set: never another manager's private pair.
  manager.rows.read = [{ reach: "own" }, { reach: "team", by: "set_by_id", while: { column: "source", in: ["meeting"] } }];
  manager.rows.update = OWN_OR_SET;
  manager.rows.delete = OWN_OR_SET;
}

/* ─── messages: R4d ─── */

const messages = table("messages");
{
  const text = columnOf("messages", "text");
  text.rules ??= {};
  // Its earlier values are the audit log's alone: record history, a rule's `was`, a frame of the row as it was leave them out.
  text.rules.history = "audit";
}
column(
  "messages",
  {
    ref: "state",
    type: "enum",
    enum: ["live", "removed"],
    default: "live",
    rules: {
      enumLabels: {
        labels: {
          live: L("Live", "Sichtbar", "Visible", "Synlig", "Viditelná", "ظاهرة", "可见", "可見"),
          removed: L("Removed", "Entfernt", "Retiré", "Fjernet", "Odstraněná", "محذوفة", "已删除", "已刪除"),
        },
      },
    },
    label: L("State", "Status", "État", "Status", "Stav", "الحالة", "状态", "狀態"),
  },
  "at",
);
column(
  "messages",
  {
    ref: "removed_by_id",
    type: "text",
    maxLength: 36,
    nullable: true,
    rules: { staff: true, stamp: { set: "user-id", on: { column: "state", values: ["removed"] }, strict: true } },
    label: L("Removed by", "Entfernt von", "Retiré par", "Fjernet af", "Odstranil(a)", "حذفها", "删除人", "刪除人"),
  },
  "state",
);
column(
  "messages",
  {
    ref: "removed_at",
    type: "timestamptz",
    nullable: true,
    rules: { stamp: { set: "now", on: { column: "state", values: ["removed"] }, strict: true } },
    label: L("Removed at", "Entfernt am", "Retiré le", "Fjernet den", "Odstraněno", "وقت الحذف", "删除时间", "刪除時間"),
  },
  "removed_by_id",
);
messages.states = {
  column: "state",
  initial: "live",
  // The move waits for the words to be empty: the button empties them in the same write, and a bare change of the state is refused.
  moves: { live: [{ to: "removed", requires: { where: [{ column: "text", eq: "" }] } }] },
  actions: [
    {
      id: "remove",
      label: L("Remove the message", "Nachricht entfernen", "Retirer le message", "Fjern beskeden", "Odstranit zprávu", "احذف الرسالة", "删除消息", "刪除訊息"),
      move: { to: "removed" },
      set: { text: "" },
      tone: "danger",
      confirm: L(
        "Remove this message? Everyone in the conversation sees that it was removed, and by whom. Its words are gone from the conversation.",
        "Diese Nachricht entfernen? Alle in der Unterhaltung sehen, dass sie entfernt wurde und von wem. Ihr Text ist aus der Unterhaltung verschwunden.",
        "Retirer ce message ? Tous les participants verront qu’il a été retiré, et par qui. Son texte disparaît de la conversation.",
        "Fjern denne besked? Alle i samtalen kan se, at den er fjernet, og af hvem. Dens ord er væk fra samtalen.",
        "Odstranit tuto zprávu? Všichni v konverzaci uvidí, že byla odstraněna a kým. Její text z konverzace zmizí.",
        "هل تحذف هذه الرسالة؟ سيرى كل من في المحادثة أنها حُذفت ومن حذفها. ولن يبقى نصها في المحادثة.",
        "删除这条消息？对话中的每个人都会看到它已被删除以及删除人。它的内容将从对话中消失。",
        "刪除這則訊息？對話中的每個人都會看到它已被刪除以及刪除人。它的內容將從對話中消失。",
      ),
    },
  ],
};
for (const key of ["admin", "sales-manager", "rep", "account-manager"]) {
  const r = role(key);
  if (!r.permissions.includes("table:@messages:read") || !r.permissions.includes("table:@messages:create")) fail(`${key} no longer reads and writes messages`);
  grant(key, "table:@messages:update", "table:@messages:create");
  const limit = limitOf(key, "messages");
  // The words are written once, with the conversation they are in; the state only by the button.
  limit.writable = ["state"];
  limit.creatable = ["thread_id", "text"];
  limit.rows ??= {};
  if (!sameJson(limit.rows.read, { reach: "own" })) fail(`${key}'s read of messages is no longer the conversations she is in`);
  // The author removes her own; the CRM admin any message of a conversation she is in.
  limit.rows.update = key === "admin" ? { reach: "own" } : { reach: "own", by: "author_id" };
}

/* ─── S3 and S16: removals kept ─── */

table("deal_members").removal = { history: true };
for (const ref of ["site_visits", "showroom_bookings", "job_visits"]) table(ref).removal = { reason: true, history: true };

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log("t26b-whole: actions' ways through coaching and one-to-ones, a removed message, and kept removals are in.");
