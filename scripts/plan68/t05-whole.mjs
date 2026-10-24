#!/usr/bin/env node
/**
 * Plan 68, T05 (S14, D16, D17): vans on the day, a hired van, "What to load",
 * and the old crew told when a visit leaves its today or tomorrow.
 *
 * Changes `whole/manifest.json`, `whole/seeds/meridian.json` and the Inventory
 * part of the sample (`whole/seeds/meridian.inventory.json`, where the stock
 * needs live). Finds everything by key or name, asserts what it needs, and is
 * idempotent: run twice, it changes nothing more.
 *
 *   node scripts/plan68/t05-whole.mjs
 *
 * What it does:
 *  - vehicles: `hired_from`, `hired_to` (the hire days; empty for our own);
 *  - van_days (part fleet): one row a crew a day naming its vehicle; one crew a
 *    vehicle a day (`occupies`); a hired vehicle only inside its hire days; the
 *    vehicle's plate, name and "hired" kept on the row; read by the crew of
 *    the row (through crew_members) and the office;
 *  - deal_stock_needs: `visit_id` (the visit the stock goes on) and `crew_id`
 *    (that visit's crew, kept by the server), and a third way a row is
 *    somebody's: the crew of that visit reads it;
 *  - job_visits: `was_day`, `was_crew_id` (as a rule last read them; D17) and
 *    no more `vehicle_id` in the operations manager's writes (the day's
 *    vehicle is van_days');
 *  - left_visits (part jobs): a visit that left a crew's today or tomorrow,
 *    written by the rules for the crew it left (who no longer reaches the
 *    visit, or whose visit is gone);
 *  - five rules: four that write a left_visits row (day moved later, crew
 *    changed, back to waiting, removed) and one that tells that crew;
 *  - roles: the office writes van_days and the hire days; the crew reads its
 *    own van_days, its own left_visits, and the stock needs of its own visits
 *    with Inventory's item name and unit;
 *  - pages for the two new tables;
 *  - the sample (M3 BN-17…23).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const SEED = join(APP, "whole", "seeds", "meridian.json");
const INVENTORY = join(APP, "whole", "seeds", "meridian.inventory.json");

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const seed = JSON.parse(readFileSync(SEED, "utf8"));
const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));

const fail = (message) => {
  throw new Error(`t05-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);

/** A label in the eight languages, in the manifest's order. */
const L = (en, de, fr, da, cs, ar, zhCN, zhTW) => ({ "en-US": en, "de-DE": de, "fr-FR": fr, "da-DK": da, "cs-CZ": cs, "ar-EG": ar, "zh-CN": zhCN, "zh-TW": zhTW });
/** A sample text in the eight languages, in the seed's order. */
const T = (en, de, fr, cs, da, zhCN, zhTW, ar) => ({ "@t": { "en-US": en, "de-DE": de, "fr-FR": fr, "cs-CZ": cs, "da-DK": da, "zh-CN": zhCN, "zh-TW": zhTW, "ar-EG": ar } });

const tables = manifest.requiredSchema.tables;
const table = (ref) => must(tables.find((one) => one.ref === ref), `table ${ref}`);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);

/** Put a column in (or replace the one of that name), after `after` when it is new. */
function column(tableRef, def, after) {
  const t = table(tableRef);
  const at = t.columns.findIndex((one) => one.ref === def.ref);
  if (at >= 0) {
    t.columns[at] = def;
    return;
  }
  const before = t.columns.findIndex((one) => one.ref === "retry_key");
  const where = after === undefined ? (before >= 0 ? before : t.columns.length) : must(t.columns.findIndex((one) => one.ref === after) + 1 || undefined, `${tableRef}.${after}`);
  t.columns.splice(where, 0, def);
}
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const addOnce = (list, value) => {
  if (!list.some((one) => sameJson(one, value))) list.push(value);
};
const addAll = (list, values) => {
  for (const value of values) if (!list.includes(value)) list.push(value);
};
/** Put a table in after `after` (or replace the one of that ref). */
function putTable(def, after) {
  const at = tables.findIndex((one) => one.ref === def.ref);
  if (at >= 0) tables[at] = def;
  else tables.splice(must(tables.findIndex((one) => one.ref === after) + 1 || undefined, `table ${after}`), 0, def);
}
function putPage(def, after) {
  const at = manifest.pages.findIndex((one) => one.ref === def.ref);
  if (at >= 0) manifest.pages[at] = def;
  else manifest.pages.splice(must(manifest.pages.findIndex((one) => one.ref === after) + 1 || undefined, `page ${after}`), 0, def);
}
function putRule(def, after) {
  const list = manifest.automations;
  const at = list.findIndex((one) => one.key === def.key);
  if (at >= 0) list[at] = def;
  else list.splice(must(list.findIndex((one) => one.key === after) + 1 || undefined, `rule ${after}`), 0, def);
}
function grant(key, permissions) {
  addAll(role(key).permissions, permissions);
}
function limit(key, ref, value) {
  const r = role(key);
  r.limits ??= {};
  r.limits[ref] = value;
}
function extendList(key, ref, list, columns) {
  const found = must(role(key).limits?.[ref], `${key}'s limit on ${ref}`);
  must(found[list], `${key}'s ${list} on ${ref}`);
  addAll(found[list], columns);
}

/* ─── Preconditions ─── */

for (const ref of ["vehicles", "crews", "crew_members", "job_visits", "deal_stock_needs", "crew_days"]) table(ref);
for (const key of ["admin", "ops-manager", "crew", "read-only"]) role(key);
for (const rule of ["day-sheet-changed", "day-sheet-crew", "day-sheet-moved"]) must(manifest.automations.find((one) => one.key === rule), `rule ${rule}`);
if (!table("job_visits").columns.some((one) => one.ref === "vehicle_id")) fail("job_visits.vehicle_id");
if (!sameJson(table("deal_stock_needs").belongs?.[0], { via: "deal_id" })) fail("deal_stock_needs belongs via deal_id first");

/* ─── vehicles: the hire days ─── */

column("vehicles", { ref: "hired_from", type: "date", nullable: true, label: L("Hired from", "Gemietet ab", "Loué à partir du", "Lejet fra", "Najato od", "مستأجرة من", "租用开始", "租用開始") }, "hired");
column("vehicles", { ref: "hired_to", type: "date", nullable: true, label: L("Hired until", "Gemietet bis", "Loué jusqu’au", "Lejet til", "Najato do", "مستأجرة حتى", "租用结束", "租用結束") }, "hired_from");

/* ─── van_days ─── */

const LINK_CREW = { through: { table: "crew_members", link: "crew_id", on: "crew_id", user: "user_id" } };
const copyOfVehicle = (from) => ({ copy: { via: "vehicle_id", from, mode: "always", follow: true } });

putTable(
  {
    ref: "van_days",
    module: "fleet",
    label: L("Vehicle for a crew’s day", "Fahrzeug für den Tag eines Teams", "Véhicule de la journée d’une équipe", "Køretøj til et holds dag", "Vozidlo na den čety", "مركبة يوم الطاقم", "班组当天的车辆", "班組當天的車輛"),
    labelPlural: L("Vehicles for crews’ days", "Fahrzeuge für die Tage der Teams", "Véhicules des journées d’équipe", "Køretøjer til holdenes dage", "Vozidla na dny čet", "مركبات أيام الطواقم", "班组每天的车辆", "班組每天的車輛"),
    unique: [["crew_id", "day"]],
    indexes: [["vehicle_id"], ["day"]],
    belongs: [LINK_CREW],
    // One crew a vehicle a day; a crew's several visits that day share its row (unique crew and day).
    occupies: { resource: "vehicle_id", day: "day" },
    columns: [
      { ref: "id", type: "int", role: "pk" },
      { ref: "crew_id", type: "fk", references: "crews", label: L("Crew", "Team", "Équipe", "Hold", "Četa", "الطاقم", "班组", "班組") },
      {
        ref: "day",
        type: "date",
        // A hired vehicle goes on a crew's day only inside its hire days; one of our own (no hire days) on any day.
        rules: { notBefore: { column: "hired_from", via: "vehicle_id" }, notAfter: { column: "hired_to", via: "vehicle_id" } },
        label: L("Day", "Tag", "Jour", "Dag", "Den", "اليوم", "日期", "日期"),
      },
      { ref: "vehicle_id", type: "fk", references: "vehicles", label: L("Vehicle", "Fahrzeug", "Véhicule", "Køretøj", "Vozidlo", "المركبة", "车辆", "車輛") },
      { ref: "plate", type: "text", maxLength: 20, nullable: true, rules: copyOfVehicle("plate"), label: L("Number plate", "Kennzeichen", "Immatriculation", "Nummerplade", "SPZ", "رقم اللوحة", "车牌", "車牌") },
      { ref: "vehicle_name", type: "text", maxLength: 80, nullable: true, rules: copyOfVehicle("name"), label: L("Vehicle name", "Fahrzeugname", "Nom du véhicule", "Køretøjets navn", "Název vozidla", "اسم المركبة", "车辆名称", "車輛名稱") },
      { ref: "hired", type: "bool", default: false, rules: copyOfVehicle("hired"), label: L("Hired", "Gemietet", "En location", "Lejet", "Najaté", "مستأجرة", "租用", "租用") },
      { ref: "retry_key", type: "text", maxLength: 64, nullable: true, unique: true, rules: { retryKey: true }, label: L("Retry key", "Wiederholungsschlüssel", "Clé de nouvel essai", "Genforsøgsnøgle", "Klíč opakování", "مفتاح إعادة المحاولة", "重试键", "重試鍵") },
    ],
  },
  "crew_days",
);

/* ─── deal_stock_needs: the visit its stock goes on, and that visit's crew ─── */

const needs = table("deal_stock_needs");
// T09: a visit's deal, copied from its job, so a stock need may name only a visit of its own deal's job (else another
// customer's crew would read it under "Stock for this job"). Empty on a visit from before 0.2.2 until the engine fills
// copies on update (E20).
column("job_visits", { ref: "deal_id", type: "int", nullable: true, rules: { copy: { via: "job_id", from: "deal_id", mode: "always" } }, label: L("Deal", "Deal", "Affaire", "Deal", "Obchod", "الصفقة", "商机", "案件") });
column("deal_stock_needs", { ref: "visit_id", type: "fk", references: "job_visits", nullable: true, rules: { linkable: { same: [{ column: "deal_id", as: "deal_id" }] } }, label: L("Goes on visit", "Kommt mit zum Einsatz", "Part avec l’intervention", "Kommer med på besøget", "Jede s výjezdem", "يُحمَّل مع الزيارة", "随此次上门装车", "隨此次到訪裝車") }, "qty");
column("deal_stock_needs", { ref: "crew_id", type: "int", nullable: true, rules: { copy: { via: "visit_id", from: "crew_id", mode: "always", follow: true } }, label: L("Crew of that visit", "Team dieses Einsatzes", "Équipe de cette intervention", "Holdet på det besøg", "Četa toho výjezdu", "طاقم تلك الزيارة", "那次上门的班组", "那次到訪的班組") }, "visit_id");
addOnce(needs.belongs, LINK_CREW);
needs.indexes ??= [];
addOnce(needs.indexes, ["visit_id"]);
addOnce(needs.indexes, ["crew_id"]);

/* ─── job_visits: the day and crew a visit had, as a rule last read them (D17) ─── */

column("job_visits", { ref: "was_day", type: "date", nullable: true, label: L("Day before the last change, as a rule last read it", "Tag vor der letzten Änderung, wie eine Regel ihn zuletzt las", "Jour avant la dernière modification, tel qu’une règle l’a lu en dernier", "Dag før den seneste ændring, som en regel sidst læste den", "Den před poslední změnou, jak jej naposledy přečetlo pravidlo", "اليوم قبل آخر تغيير كما قرأته قاعدة آخر مرة", "规则最近读到的上次更改前的日期", "規則最近讀到的上次變更前的日期") }, "cancel_reason");
column("job_visits", { ref: "was_crew_id", type: "int", nullable: true, label: L("Crew before the last change, as a rule last read it", "Team vor der letzten Änderung, wie eine Regel es zuletzt las", "Équipe avant la dernière modification, telle qu’une règle l’a lue en dernier", "Hold før den seneste ændring, som en regel sidst læste det", "Četa před poslední změnou, jak ji naposledy přečetlo pravidlo", "الطاقم قبل آخر تغيير كما قرأته قاعدة آخر مرة", "规则最近读到的上次更改前的班组", "規則最近讀到的上次變更前的班組") }, "was_day");
// Which change of which visit a rule last noted for the crew it left: a change heard twice is noted once.
column("job_visits", { ref: "leave_key", type: "text", maxLength: 120, nullable: true, label: L("The change a rule last read", "Die Änderung, die eine Regel zuletzt las", "La modification qu’une règle a lue en dernier", "Den ændring, en regel sidst læste", "Změna, kterou pravidlo naposledy přečetlo", "التغيير الذي قرأته قاعدة آخر مرة", "规则最近读到的更改", "規則最近讀到的變更") }, "was_crew_id");
// T09: when the day, crew or state last changed, stamped by the server on that save. It goes in the change's key, so a
// visit that leaves a crew the same way twice (moved out, back, out again) is noted twice; one save heard by two rules
// (day and crew at once) still gives one key. The stamp before the change goes in too: MySQL keeps whole seconds, so two
// quick moves may share a stamp, but never the one before them.
column("job_visits", { ref: "left_at", type: "timestamptz", nullable: true, rules: { stamp: { set: "now", on: { columns: ["day", "crew_id", "state"] } } }, label: L("Day, crew or state last changed", "Tag, Team oder Stand zuletzt geändert", "Jour, équipe ou état modifié pour la dernière fois", "Dag, hold eller status sidst ændret", "Den, četa nebo stav naposledy změněny", "آخر تغيير لليوم أو الطاقم أو الحالة", "日期、班组或状态最近一次变更", "日期、班組或狀態最近一次變更") });

/* ─── left_visits: a visit that left a crew's today or tomorrow (D17) ─── */

putTable(
  {
    ref: "left_visits",
    module: "jobs",
    label: L("Visit off a crew’s day sheet", "Einsatz vom Tagesblatt eines Teams genommen", "Intervention retirée de la feuille de route d’une équipe", "Besøg taget af et holds dagsark", "Výjezd vyřazený z denního listu čety", "زيارة خرجت من ورقة يوم الطاقم", "从班组日程单上移走的上门", "從班組日程單上移走的到訪"),
    labelPlural: L("Visits off crews’ day sheets", "Einsätze von Tagesblättern genommen", "Interventions retirées des feuilles de route", "Besøg taget af holdenes dagsark", "Výjezdy vyřazené z denních listů", "زيارات خرجت من أوراق أيام الطواقم", "从班组日程单上移走的上门", "從班組日程單上移走的到訪"),
    keyField: "what",
    indexes: [["crew_id"], ["visit_id"]],
    belongs: [LINK_CREW],
    columns: [
      { ref: "id", type: "int", role: "pk" },
      { ref: "crew_id", type: "fk", references: "crews", label: L("Crew it left", "Team, das ihn hatte", "Équipe qui l’avait", "Holdet, der havde det", "Četa, která jej měla", "الطاقم الذي كانت له", "原班组", "原班組") },
      { ref: "visit_id", type: "int", nullable: true, label: L("Visit", "Einsatz", "Intervention", "Besøg", "Výjezd", "الزيارة", "上门", "到訪") },
      { ref: "what", type: "text", maxLength: 200, label: L("What is done", "Was gemacht wird", "Ce qui est fait", "Hvad der laves", "Co se dělá", "ما يُنجز", "工作内容", "工作內容") },
      { ref: "site_name", type: "text", maxLength: 160, nullable: true, label: L("Site name", "Name des Standorts", "Nom du site", "Stedets navn", "Název místa", "اسم الموقع", "现场名称", "現場名稱") },
      { ref: "site_town", type: "text", maxLength: 120, nullable: true, label: L("Site town", "Ort des Standorts", "Ville du site", "Stedets by", "Obec místa", "مدينة الموقع", "现场所在城镇", "現場所在城鎮") },
      { ref: "day", type: "date", nullable: true, label: L("Day it was on", "Tag, an dem er war", "Jour où elle était", "Dagen, det lå på", "Den, na který byl", "اليوم الذي كانت فيه", "原定日期", "原定日期") },
      { ref: "leave_key", type: "text", maxLength: 120, nullable: true, unique: true, label: L("The change it is about", "Die Änderung, um die es geht", "La modification concernée", "Den ændring, det drejer sig om", "Změna, o kterou jde", "التغيير المعني", "所涉及的更改", "所涉及的變更") },
      { ref: "now_day", type: "date", nullable: true, label: L("Day it is on now", "Tag, an dem er jetzt ist", "Jour où elle est maintenant", "Dagen, det ligger på nu", "Den, na který je teď", "اليوم الذي صارت فيه الآن", "现在的日期", "現在的日期") },
      {
        ref: "why",
        type: "enum",
        enum: ["day", "crew", "waiting", "removed"],
        rules: {
          enumLabels: {
            labels: {
              day: L("Moved to a later day", "Auf einen späteren Tag verschoben", "Déplacée à un jour plus tard", "Flyttet til en senere dag", "Přesunut na pozdější den", "نُقلت إلى يوم لاحق", "改到更晚的日期", "改到更晚的日期"),
              crew: L("Given to another crew", "An ein anderes Team gegeben", "Confiée à une autre équipe", "Givet til et andet hold", "Předán jiné četě", "أُسندت إلى طاقم آخر", "交给了另一个班组", "交給了另一個班組"),
              waiting: L("Back to waiting for a day", "Wartet wieder auf einen Tag", "De nouveau en attente d’un jour", "Venter igen på en dag", "Znovu čeká na den", "عادت لانتظار يوم", "重新等待排期", "重新等待排程"),
              removed: L("Called off", "Abgesagt", "Annulée", "Aflyst", "Zrušen", "أُلغيت", "已取消", "已取消"),
            },
          },
        },
        label: L("Why", "Warum", "Pourquoi", "Hvorfor", "Proč", "السبب", "原因", "原因"),
      },
    ],
  },
  "job_visits",
);

/* ─── Pages ─── */

putPage(
  {
    ref: "crm-van-days",
    template: "page-crud",
    title: { key: "mft.crm.page.van_days", fallback: "Vehicles for crews’ days" },
    titles: { "de-DE": "Fahrzeuge für die Tage der Teams", "fr-FR": "Véhicules des journées d’équipe", "da-DK": "Køretøjer til holdenes dage", "cs-CZ": "Vozidla na dny čet", "ar-EG": "مركبات أيام الطواقم", "zh-CN": "班组每天的车辆", "zh-TW": "班組每天的車輛" },
    nav: { group: "fleet", icon: "calendar-days", order: 10, offRail: true },
    bindings: { rows: "van_days" },
    module: "fleet",
  },
  "crm-insurance-incidents",
);
putPage(
  {
    ref: "crm-left-visits",
    template: "page-crud",
    title: { key: "mft.crm.page.left_visits", fallback: "Visits off crews’ day sheets" },
    titles: { "de-DE": "Einsätze von Tagesblättern genommen", "fr-FR": "Interventions retirées des feuilles de route", "da-DK": "Besøg taget af holdenes dagsark", "cs-CZ": "Výjezdy vyřazené z denních listů", "ar-EG": "زيارات خرجت من أوراق أيام الطواقم", "zh-CN": "从班组日程单上移走的上门", "zh-TW": "從班組日程單上移走的到訪" },
    nav: { group: "jobs", icon: "calendar-x", order: 11, offRail: true },
    bindings: { rows: "left_visits" },
    module: "jobs",
  },
  "crm-waste-removals",
);

/* ─── Roles ─── */

const crud = (ref) => ["read", "create", "update", "delete"].map((action) => `table:@${ref}:${action}`);
// A visit off a crew's day is the rules' to write: the CRM admin reads and removes one, and makes or changes none.
grant("admin", [...crud("van_days"), "page:@crm-van-days:view", "table:@left_visits:read", "table:@left_visits:delete", "page:@crm-left-visits:view"]);
for (const key of ["admin"]) role(key).permissions = role(key).permissions.filter((one) => one !== "table:@left_visits:create" && one !== "table:@left_visits:update");
grant("read-only", ["table:@van_days:read", "page:@crm-van-days:view", "table:@left_visits:read", "page:@crm-left-visits:view"]);
grant("ops-manager", [...crud("van_days"), "page:@crm-van-days:view", "table:@left_visits:read", "page:@crm-left-visits:view"]);
limit("ops-manager", "van_days", { writable: ["crew_id", "day", "vehicle_id"], creatable: ["crew_id", "day", "vehicle_id"] });
extendList("ops-manager", "vehicles", "writable", ["hired_from", "hired_to"]);
extendList("ops-manager", "vehicles", "creatable", ["hired_from", "hired_to"]);
extendList("ops-manager", "deal_stock_needs", "writable", ["visit_id"]);
// The day's vehicle is van_days': the visit's own column is no longer written (M3 BN-1). A new visit is made with what
// she writes, so what a rule keeps on it (D17) is never typed.
{
  const visits = must(role("ops-manager").limits?.job_visits?.writable, "ops-manager's writes of job_visits");
  role("ops-manager").limits.job_visits.writable = visits.filter((one) => one !== "vehicle_id");
  role("ops-manager").limits.job_visits.creatable = [...role("ops-manager").limits.job_visits.writable];
}

const crew = role("crew");
grant("crew", ["table:@van_days:read", "page:@crm-van-days:view", "table:@left_visits:read", "page:@crm-left-visits:view", "table:@deal_stock_needs:read", "page:@crm-deal-stock-needs:view"]);
limit("crew", "van_days", { rows: { read: { reach: "own" } } });
limit("crew", "left_visits", { rows: { read: { reach: "own" } } });
// What to load: the needs of his crew's own visits, and of a need nothing but its line, its count and the visit it goes on.
limit("crew", "deal_stock_needs", { readable: ["id", "deal_id", "item", "qty", "visit_id", "crew_id"], rows: { read: { reach: "own" } } });
crew.tables ??= [];
{
  const items = { addOn: "inventory", table: "items", actions: ["read"], limit: { readable: ["id", "name", "unit"] } };
  const at = crew.tables.findIndex((one) => one.addOn === "inventory" && one.table === "items");
  if (at >= 0) crew.tables[at] = items;
  else crew.tables.push(items);
}

/* ─── Rules (D17) ─── */

// The manifest takes at most 24 rules (MANIFEST_AUTOMATIONS_MAX): D17 adds three. The day sheet's rules on a booked visit's
// day and crew (which told the crew it is now for) also note the change for the crew it LEFT; one rule hears a visit going
// back to waiting, one a visit removed, and one tells the crew a note is for.
manifest.automations = manifest.automations.filter((one) => !["day-sheet-left-day", "day-sheet-left-crew", "day-sheet-left"].includes(one.key));

const TODAY_OR_TOMORROW = { amount: 1, unit: "days" };
const trigger = (title) => ({ id: "t", kind: "trigger", title });
const keyOfChange = "{{record.id}}|{{was.day}}|{{was.crew_id}}|{{record.day}}|{{record.crew_id}}|{{record.state}}|{{was.left_at}}|{{record.left_at}}";
const keepWas = {
  id: "keep-was",
  kind: "action",
  title: L("Keep the day and crew the visit had", "Tag und Team festhalten, die der Einsatz hatte", "Garder le jour et l’équipe qu’avait l’intervention", "Gem dagen og holdet, besøget havde", "Uložit den a četu, které výjezd měl", "احفظ اليوم والطاقم اللذين كانا للزيارة", "记下上门原来的日期和班组", "記下到訪原來的日期和班組"),
  action: { kind: "record.update", values: { was_day: "{{was.day}}", was_crew_id: "{{was.crew_id}}", leave_key: keyOfChange } },
};
const wasSoon = { id: "was-soon", kind: "condition", title: L("It was on today or tomorrow", "Er war heute oder morgen", "Elle était aujourd’hui ou demain", "Det lå i dag eller i morgen", "Byl dnes nebo zítra", "كانت اليوم أو غدًا", "原定在今天或明天", "原定在今天或明天"), condition: { left: { field: "was_day" }, op: "within_next", right: TODAY_OR_TOMORROW } };
const wasCrew = { id: "was-crew", kind: "condition", title: L("…for a crew", "…für ein Team", "…pour une équipe", "…til et hold", "…pro četu", "…لطاقم", "……有班组", "……有班組"), condition: { left: { field: "was_crew_id" }, op: "not_empty" } };
// A change heard twice (by the day's rule and the crew's, when both moved at once) is noted once.
const notNoted = { id: "not-noted", kind: "condition", title: L("…and this change is not noted yet", "…und diese Änderung ist noch nicht notiert", "…et ce changement n’est pas encore noté", "…og ændringen er ikke noteret endnu", "…a tato změna ještě není zapsána", "…ولم يُدوَّن هذا التغيير بعد", "……且这次更改尚未记下", "……且這次變更尚未記下"), condition: { left: { count: { table: "left_visits", matchColumn: "leave_key", equalsField: "leave_key" } }, op: "is", right: 0 } };
const write = (why, values) => ({
  id: "write",
  kind: "action",
  title: L("Write it down for the crew it left", "Für das Team notieren, das ihn hatte", "L’inscrire pour l’équipe qui l’avait", "Skriv det ned til holdet, der havde det", "Zapsat to pro četu, která jej měla", "دوِّنها للطاقم الذي كانت له", "为原班组记下来", "為原班組記下來"),
  action: { kind: "record.create", table: "left_visits", values: { visit_id: "{{record.id}}", what: "{{record.what}}", site_name: "{{record.site_name}}", site_town: "{{record.site_town}}", why, ...values } },
});
const fromWas = { crew_id: "{{was.crew_id}}", day: "{{was.day}}", now_day: "{{record.day}}", leave_key: "{{record.leave_key}}" };
const BOOKED = { left: { field: "state" }, op: "is", right: "booked" };
/** The notice an existing day-sheet rule sends, wherever its graph now holds it. */
const tellOf = (rule) => must([...rule.graph.nodes, ...rule.graph.nodes.flatMap((node) => (node.branches ?? []).flatMap((branch) => branch.nodes))].find((node) => node.id === "tell"), `${rule.key}'s notice`);
/** The rule's own notice as a branch: still only for a visit now on today or tomorrow. */
const tellIfSoon = (tell) => ({
  id: "if-soon",
  kind: "branch",
  title: L("Is it on today or tomorrow now?", "Ist er jetzt heute oder morgen?", "Est-elle maintenant aujourd’hui ou demain ?", "Ligger det nu i dag eller i morgen?", "Je teď dnes nebo zítra?", "هل هي الآن اليوم أو غدًا؟", "现在是在今天或明天吗？", "現在是在今天或明天嗎？"),
  condition: { left: { field: "day" }, op: "within_next", right: TODAY_OR_TOMORROW },
  branches: [
    { id: "if-soon-yes", label: "Yes", nodes: [tell] },
    { id: "if-soon-no", label: "No", nodes: [] },
  ],
});
{
  const moved = must(manifest.automations.find((one) => one.key === "day-sheet-moved"), "rule day-sheet-moved");
  const tell = tellOf(moved);
  moved.name = L("A booked visit changes day: tell its crew, and the crew it left", "Gebuchter Einsatz wechselt den Tag: sein Team und das bisherige benachrichtigen", "Une intervention change de jour : prévenir son équipe et l’ancienne", "Et booket besøg skifter dag: giv holdet og det tidligere hold besked", "Výjezd mění den: dát vědět jeho četě i té původní", "زيارة محجوزة تغيّر يومها: أخبر طاقمها والطاقم الذي كانت له", "已排期的上门改了日期：通知其班组和原班组", "已排程的到訪改了日期：通知其班組和原班組");
  moved.description = L(
    "When a booked visit is moved onto today or tomorrow, its crew is told at once, also in their quiet hours. When one of today or tomorrow is moved past tomorrow, the crew it was for is told (the last of the day sheet's rules tells them).",
    "Wird ein gebuchter Einsatz auf heute oder morgen verschoben, erfährt es sein Team sofort, auch in seinen Ruhezeiten. Wird einer von heute oder morgen über morgen hinaus verschoben, erfährt es das Team, das ihn hatte (die letzte Regel des Tagesplans sagt es ihm).",
    "Quand une intervention réservée passe à aujourd’hui ou demain, son équipe est prévenue tout de suite, même pendant ses heures calmes. Quand une d’aujourd’hui ou de demain passe après demain, l’équipe qui l’avait est prévenue (la dernière règle de la feuille de journée la prévient).",
    "Når et booket besøg flyttes til i dag eller i morgen, får holdet besked med det samme, også i de stille timer. Når et besøg i dag eller i morgen flyttes til efter i morgen, får holdet, der havde det, besked (dagsplanens sidste regel giver besked).",
    "Když se zarezervovaný výjezd přesune na dnes nebo zítra, jeho četa se to hned dozví, i v klidových hodinách. Když se výjezd na dnes nebo zítra přesune až za zítřek, dozví se to četa, která jej měla (řekne jí to poslední pravidlo denního listu).",
    "عند نقل زيارة محجوزة إلى اليوم أو الغد، يُبلَّغ طاقمها فورًا، حتى في ساعات الهدوء. وعند نقل زيارة لليوم أو الغد إلى ما بعد الغد، يُبلَّغ الطاقم الذي كانت له (تُبلغه آخر قواعد ورقة اليوم).",
    "已排期的上门改到今天或明天时，立即通知其班组，免打扰时段也照常。今天或明天的上门改到明天以后时，通知原来负责的班组（由当日工单的最后一条规则通知）。",
    "已排程的到訪改到今天或明天時，立即通知其班組，勿擾時段也照常。今天或明天的到訪改到明天以後時，通知原來負責的班組（由當日工單的最後一條規則通知）。",
  );
  moved.trigger = { kind: "record", event: "updated", table: "job_visits", changedColumn: "day", when: [BOOKED] };
  moved.graph = {
    version: 1,
    nodes: [
      trigger("A booked visit moves to another day"),
      tellIfSoon(tell),
      keepWas,
      wasSoon,
      wasCrew,
      { id: "now-later", kind: "condition", title: L("…and now it is past tomorrow", "…und jetzt liegt er nach morgen", "…et elle est maintenant après demain", "…og nu ligger det efter i morgen", "…a teď je až za zítřkem", "…وصارت الآن بعد الغد", "……而现在在明天以后", "……而現在在明天以後"), condition: { left: { field: "day" }, op: "more_than_ahead", right: TODAY_OR_TOMORROW } },
      notNoted,
      write("day", fromWas),
    ],
  };
}
{
  const given = must(manifest.automations.find((one) => one.key === "day-sheet-crew"), "rule day-sheet-crew");
  const tell = tellOf(given);
  given.name = L("A booked visit goes to another crew: tell that crew, and the crew it left", "Gebuchter Einsatz geht an ein anderes Team: dieses und das bisherige benachrichtigen", "Une intervention passe à une autre équipe : prévenir celle-ci et l’ancienne", "Et booket besøg går til et andet hold: giv det og det tidligere hold besked", "Výjezd přechází na jinou četu: dát vědět jí i té původní", "زيارة محجوزة تنتقل إلى طاقم آخر: أخبره وأخبر الطاقم السابق", "已排期的上门换了班组：通知新班组和原班组", "已排程的到訪換了班組：通知新班組和原班組");
  given.description = L(
    "When a visit booked for today or tomorrow is given to another crew, the crew it is now for is told at once, also in their quiet hours, and the crew it was for is told too (the last of the day sheet's rules tells them).",
    "Geht ein Einsatz für heute oder morgen an ein anderes Team, erfährt es das neue Team sofort, auch in seinen Ruhezeiten, und das bisherige Team ebenso (die letzte Regel des Tagesplans sagt es ihm).",
    "Quand une intervention prévue aujourd’hui ou demain passe à une autre équipe, la nouvelle équipe est prévenue tout de suite, même pendant ses heures calmes, et l’ancienne aussi (la dernière règle de la feuille de journée la prévient).",
    "Når et besøg booket i dag eller i morgen gives til et andet hold, får det nye hold besked med det samme, også i de stille timer, og det tidligere hold også (dagsplanens sidste regel giver besked).",
    "Když výjezd na dnes nebo zítra přejde na jinou četu, nová četa se to hned dozví, i v klidových hodinách, a původní četa také (řekne jí to poslední pravidlo denního listu).",
    "عند إسناد زيارة محجوزة اليوم أو غدًا إلى طاقم آخر، يُبلَّغ الطاقم الجديد فورًا، حتى في ساعات الهدوء، ويُبلَّغ الطاقم السابق كذلك (تُبلغه آخر قواعد ورقة اليوم).",
    "今天或明天已排期的上门交给另一个班组时，立即通知新班组，免打扰时段也照常；原班组也会收到通知（由当日工单的最后一条规则通知）。",
    "今天或明天已排程的到訪交給另一個班組時，立即通知新班組，勿擾時段也照常；原班組也會收到通知（由當日工單的最後一條規則通知）。",
  );
  given.trigger = { kind: "record", event: "updated", table: "job_visits", changedColumn: "crew_id", when: [BOOKED] };
  given.graph = { version: 1, nodes: [trigger("A booked visit goes to another crew"), tellIfSoon(tell), keepWas, wasSoon, wasCrew, notNoted, write("crew", fromWas)] };
}

putRule(
  {
    key: "day-sheet-left-waiting",
    name: L("A visit of today or tomorrow goes back to waiting: note it for its crew", "Einsatz von heute oder morgen wartet wieder: für sein Team notieren", "Une intervention d’aujourd’hui ou de demain repasse en attente : la noter pour son équipe", "Et besøg i dag eller i morgen venter igen: notér det til holdet", "Výjezd na dnes nebo zítra znovu čeká: zapsat to pro jeho četu", "زيارة اليوم أو غدًا تعود للانتظار: دوِّنها لطاقمها", "今天或明天的上门重新等待排期：为其班组记下", "今天或明天的到訪重新等待排程：為其班組記下"),
    description: L(
      "When a booked visit of today or tomorrow goes back to waiting for a day, its crew is told (the last of the day sheet's rules tells them).",
      "Wartet ein gebuchter Einsatz von heute oder morgen wieder auf einen Tag, erfährt es sein Team (die letzte Regel des Tagesplans sagt es ihm).",
      "Quand une intervention prévue aujourd’hui ou demain repasse en attente d’un jour, son équipe est prévenue (la dernière règle de la feuille de journée la prévient).",
      "Når et booket besøg i dag eller i morgen igen venter på en dag, får holdet besked (dagsplanens sidste regel giver besked).",
      "Když zarezervovaný výjezd na dnes nebo zítra znovu čeká na den, jeho četa se to dozví (řekne jí to poslední pravidlo denního listu).",
      "عند عودة زيارة محجوزة اليوم أو غدًا إلى انتظار يوم، يُبلَّغ طاقمها (تُبلغه آخر قواعد ورقة اليوم).",
      "今天或明天已排期的上门重新等待排期时，通知其班组（由当日工单的最后一条规则通知）。",
      "今天或明天已排程的到訪重新等待排程時，通知其班組（由當日工單的最後一條規則通知）。",
    ),
    enabled: true,
    module: "jobs",
    // Waiting is reached from booked only (`states.moves`): a visit that goes back to waiting was booked.
    trigger: { kind: "record", event: "updated", table: "job_visits", changedColumn: "state", when: [{ left: { field: "state" }, op: "is", right: "waiting" }] },
    graph: { version: 1, nodes: [trigger("A booked visit goes back to waiting"), keepWas, wasSoon, wasCrew, notNoted, write("waiting", fromWas)] },
  },
  "day-sheet-moved",
);
putRule(
  {
    key: "day-sheet-left-removed",
    name: L("A visit of today or tomorrow is called off: note it for its crew", "Einsatz von heute oder morgen wird abgesagt: für sein Team notieren", "Une intervention d’aujourd’hui ou de demain est annulée : la noter pour son équipe", "Et besøg i dag eller i morgen aflyses: notér det til holdet", "Výjezd na dnes nebo zítra je zrušen: zapsat to pro jeho četu", "إلغاء زيارة اليوم أو غدًا: دوِّنها لطاقمها", "今天或明天的上门被取消：为其班组记下", "今天或明天的到訪被取消：為其班組記下"),
    description: L(
      "When a booked visit of today or tomorrow is called off (removed), its crew is told (the next rule tells them).",
      "Wird ein gebuchter Einsatz von heute oder morgen abgesagt (entfernt), erfährt es sein Team (die nächste Regel sagt es ihm).",
      "Quand une intervention prévue aujourd’hui ou demain est annulée (supprimée), son équipe est prévenue (la règle suivante la prévient).",
      "Når et booket besøg i dag eller i morgen aflyses (fjernes), får holdet besked (den næste regel giver besked).",
      "Když je zarezervovaný výjezd na dnes nebo zítra zrušen (odstraněn), jeho četa se to dozví (řekne jí to další pravidlo).",
      "عند إلغاء زيارة محجوزة اليوم أو غدًا (حذفها)، يُبلَّغ طاقمها (تُبلغه القاعدة التالية).",
      "今天或明天已排期的上门被取消（删除）时，通知其班组（由下一条规则通知）。",
      "今天或明天已排程的到訪被取消（刪除）時，通知其班組（由下一條規則通知）。",
    ),
    enabled: true,
    module: "jobs",
    trigger: { kind: "record", event: "deleted", table: "job_visits", when: [BOOKED, { left: { field: "day" }, op: "within_next", right: TODAY_OR_TOMORROW }, { left: { field: "crew_id" }, op: "not_empty" }] },
    graph: { version: 1, nodes: [trigger("A booked visit of today or tomorrow is removed"), write("removed", { crew_id: "{{record.crew_id}}", day: "{{record.day}}" })] },
  },
  "day-sheet-left-waiting",
);

/** The notice of one way a visit leaves a crew's day, as a branch of the rule that tells the crew. */
const ASKED = {
  day: L("Moved to a later day?", "Auf einen späteren Tag verschoben?", "Déplacée à un jour plus tard ?", "Flyttet til en senere dag?", "Přesunut na pozdější den?", "نُقلت إلى يوم لاحق؟", "改到更晚的日期了吗？", "改到更晚的日期了嗎？"),
  crew: L("Given to another crew?", "An ein anderes Team gegeben?", "Confiée à une autre équipe ?", "Givet til et andet hold?", "Předán jiné četě?", "أُسندت إلى طاقم آخر؟", "交给另一个班组了吗？", "交給另一個班組了嗎？"),
  waiting: L("Back to waiting for a day?", "Wartet wieder auf einen Tag?", "De nouveau en attente d’un jour ?", "Venter igen på en dag?", "Znovu čeká na den?", "عادت لانتظار يوم؟", "重新等待排期了吗？", "重新等待排程了嗎？"),
  removed: L("Called off?", "Abgesagt?", "Annulée ?", "Aflyst?", "Zrušen?", "أُلغيت؟", "取消了吗？", "取消了嗎？"),
};
const tellIf = (why, title, body) => ({
  id: `if-${why}`,
  kind: "branch",
  title: ASKED[why],
  condition: { left: { field: "why" }, op: "is", right: why },
  branches: [
    { id: `if-${why}-yes`, label: "Yes", nodes: [{ id: `tell-${why}`, kind: "action", title: L("Tell that crew at once", "Diesem Team sofort Bescheid geben", "Prévenir cette équipe tout de suite", "Giv det hold besked med det samme", "Hned dát vědět té četě", "أخبر ذلك الطاقم فورًا", "立即通知该班组", "立即通知該班組"), action: { kind: "notification", to: { roles: ["crew"] }, urgent: true, title, body } }] },
    { id: `if-${why}-no`, label: "No", nodes: [] },
  ],
});
putRule(
  {
    key: "day-sheet-left-told",
    name: L("A visit left a crew’s today or tomorrow: tell that crew", "Ein Einsatz ist aus dem Heute oder Morgen eines Teams gefallen: diesem Team Bescheid geben", "Une intervention a quitté l’aujourd’hui ou le demain d’une équipe : prévenir cette équipe", "Et besøg er røget ud af et holds i dag eller i morgen: giv det hold besked", "Výjezd vypadl z dneška nebo zítřka čety: dát vědět té četě", "خرجت زيارة من يوم الطاقم اليوم أو غدًا: أخبر ذلك الطاقم", "上门离开了班组的今天或明天：通知该班组", "到訪離開了班組的今天或明天：通知該班組"),
    description: L(
      "The crew a visit of today or tomorrow left is told at once, also in their quiet hours: moved later, given to another crew, back to waiting, or called off. Nobody else is told.",
      "Das Team, aus dessen Heute oder Morgen ein Einsatz gefallen ist, erfährt es sofort, auch in seinen Ruhezeiten: verschoben, an ein anderes Team gegeben, wartet wieder oder abgesagt. Sonst niemand.",
      "L’équipe dont une intervention d’aujourd’hui ou de demain est partie est prévenue tout de suite, même pendant ses heures calmes : déplacée, confiée à une autre équipe, remise en attente ou annulée. Personne d’autre.",
      "Holdet, som et besøg i dag eller i morgen er røget ud hos, får besked med det samme, også i de stille timer: flyttet, givet til et andet hold, venter igen eller aflyst. Ingen andre.",
      "Četa, které výjezd na dnes nebo zítra vypadl, se to hned dozví, i v klidových hodinách: přesunut, předán jiné četě, znovu čeká nebo zrušen. Nikdo jiný.",
      "يُبلَّغ الطاقم الذي خرجت منه زيارة اليوم أو غدًا فورًا، حتى في ساعات الهدوء: نُقلت أو أُسندت إلى طاقم آخر أو عادت للانتظار أو أُلغيت. ولا أحد غيره.",
      "今天或明天的上门离开了哪个班组，就立即通知那个班组，免打扰时段也照常：改期、换班组、重新等待或取消。不通知其他人。",
      "今天或明天的到訪離開了哪個班組，就立即通知那個班組，勿擾時段也照常：改期、換班組、重新等待或取消。不通知其他人。",
    ),
    enabled: true,
    module: "jobs",
    trigger: { kind: "record", event: "created", table: "left_visits" },
    graph: {
      version: 1,
      nodes: [
        trigger("A visit is off a crew's day sheet"),
        tellIf(
          "day",
          L("A visit left your day sheet: {{record.what}}", "Ein Einsatz ist von Ihrem Tagesblatt: {{record.what}}", "Une intervention quitte votre feuille de route : {{record.what}}", "Et besøg er røget af jeres dagsark: {{record.what}}", "Výjezd zmizel z vašeho denního listu: {{record.what}}", "خرجت زيارة من ورقة يومكم: {{record.what}}", "一次上门已从你们的日程单移走：{{record.what}}", "一次到訪已從你們的日程單移走：{{record.what}}"),
          L(
            "{{record.site_name}}, {{record.site_town}}: moved from {{record.day}} to {{record.now_day}}. Open My day for the rest.",
            "{{record.site_name}}, {{record.site_town}}: vom {{record.day}} auf den {{record.now_day}} verschoben. Den Rest finden Sie unter Mein Tag.",
            "{{record.site_name}}, {{record.site_town}} : déplacée du {{record.day}} au {{record.now_day}}. Le reste est dans Ma journée.",
            "{{record.site_name}}, {{record.site_town}}: flyttet fra {{record.day}} til {{record.now_day}}. Resten står under Min dag.",
            "{{record.site_name}}, {{record.site_town}}: přesunut z {{record.day}} na {{record.now_day}}. Zbytek najdete v Můj den.",
            "{{record.site_name}}، {{record.site_town}}: نُقلت من {{record.day}} إلى {{record.now_day}}. التفاصيل في يومي.",
            "{{record.site_name}}，{{record.site_town}}：从 {{record.day}} 改到 {{record.now_day}}。其余见“我的一天”。",
            "{{record.site_name}}，{{record.site_town}}：從 {{record.day}} 改到 {{record.now_day}}。其餘見「我的一天」。",
          ),
        ),
        tellIf(
          "crew",
          L("A visit is no longer yours: {{record.what}}", "Ein Einsatz gehört nicht mehr Ihnen: {{record.what}}", "Une intervention n’est plus pour vous : {{record.what}}", "Et besøg er ikke længere jeres: {{record.what}}", "Výjezd už není váš: {{record.what}}", "زيارة لم تعد لكم: {{record.what}}", "这次上门不再由你们负责：{{record.what}}", "這次到訪不再由你們負責：{{record.what}}"),
          L(
            "{{record.site_name}}, {{record.site_town}}, on {{record.day}}: given to another crew. Open My day for the rest.",
            "{{record.site_name}}, {{record.site_town}}, am {{record.day}}: an ein anderes Team gegeben. Den Rest finden Sie unter Mein Tag.",
            "{{record.site_name}}, {{record.site_town}}, le {{record.day}} : confiée à une autre équipe. Le reste est dans Ma journée.",
            "{{record.site_name}}, {{record.site_town}}, den {{record.day}}: givet til et andet hold. Resten står under Min dag.",
            "{{record.site_name}}, {{record.site_town}}, {{record.day}}: předán jiné četě. Zbytek najdete v Můj den.",
            "{{record.site_name}}، {{record.site_town}}، يوم {{record.day}}: أُسندت إلى طاقم آخر. التفاصيل في يومي.",
            "{{record.site_name}}，{{record.site_town}}，{{record.day}}：已交给另一个班组。其余见“我的一天”。",
            "{{record.site_name}}，{{record.site_town}}，{{record.day}}：已交給另一個班組。其餘見「我的一天」。",
          ),
        ),
        tellIf(
          "waiting",
          L("A visit is off your day sheet: {{record.what}}", "Ein Einsatz ist von Ihrem Tagesblatt genommen: {{record.what}}", "Une intervention est retirée de votre feuille de route : {{record.what}}", "Et besøg er taget af jeres dagsark: {{record.what}}", "Výjezd je vyřazen z vašeho denního listu: {{record.what}}", "أُخرجت زيارة من ورقة يومكم: {{record.what}}", "一次上门已从你们的日程单撤下：{{record.what}}", "一次到訪已從你們的日程單撤下：{{record.what}}"),
          L(
            "{{record.site_name}}, {{record.site_town}}, on {{record.day}}: waiting for a new day. Open My day for the rest.",
            "{{record.site_name}}, {{record.site_town}}, am {{record.day}}: wartet auf einen neuen Tag. Den Rest finden Sie unter Mein Tag.",
            "{{record.site_name}}, {{record.site_town}}, le {{record.day}} : en attente d’un nouveau jour. Le reste est dans Ma journée.",
            "{{record.site_name}}, {{record.site_town}}, den {{record.day}}: venter på en ny dag. Resten står under Min dag.",
            "{{record.site_name}}, {{record.site_town}}, {{record.day}}: čeká na nový den. Zbytek najdete v Můj den.",
            "{{record.site_name}}، {{record.site_town}}، يوم {{record.day}}: بانتظار يوم جديد. التفاصيل في يومي.",
            "{{record.site_name}}，{{record.site_town}}，{{record.day}}：等待重新排期。其余见“我的一天”。",
            "{{record.site_name}}，{{record.site_town}}，{{record.day}}：等待重新排程。其餘見「我的一天」。",
          ),
        ),
        tellIf(
          "removed",
          L("A visit was called off: {{record.what}}", "Ein Einsatz wurde abgesagt: {{record.what}}", "Une intervention a été annulée : {{record.what}}", "Et besøg er aflyst: {{record.what}}", "Výjezd byl zrušen: {{record.what}}", "أُلغيت زيارة: {{record.what}}", "一次上门已取消：{{record.what}}", "一次到訪已取消：{{record.what}}"),
          L(
            "{{record.site_name}}, {{record.site_town}}, on {{record.day}}: off your day sheet. Open My day for the rest.",
            "{{record.site_name}}, {{record.site_town}}, am {{record.day}}: von Ihrem Tagesblatt genommen. Den Rest finden Sie unter Mein Tag.",
            "{{record.site_name}}, {{record.site_town}}, le {{record.day}} : retirée de votre feuille de route. Le reste est dans Ma journée.",
            "{{record.site_name}}, {{record.site_town}}, den {{record.day}}: taget af jeres dagsark. Resten står under Min dag.",
            "{{record.site_name}}, {{record.site_town}}, {{record.day}}: vyřazen z vašeho denního listu. Zbytek najdete v Můj den.",
            "{{record.site_name}}، {{record.site_town}}، يوم {{record.day}}: خرجت من ورقة يومكم. التفاصيل في يومي.",
            "{{record.site_name}}，{{record.site_town}}，{{record.day}}：已从你们的日程单撤下。其余见“我的一天”。",
            "{{record.site_name}}，{{record.site_town}}，{{record.day}}：已從你們的日程單撤下。其餘見「我的一天」。",
          ),
        ),
      ],
    },
  },
  "day-sheet-left-removed",
);

/* ─── The sample (M3 BN-17…23) ─── */

const seedTable = (ref) => must(seed.tables.find((one) => one.ref === ref), `sample table ${ref}`);
const seedRow = (ref, label) => must(seedTable(ref).rows.find((row) => row["@label"] === label), `sample row ${label}`);
const day = (n) => ({ "@day": n, "@week": true });

// BN-17: ML24 VDR is hired Mon 27 Jul to Fri 14 Aug (today is Tue 28 Jul, @day 0); its model said "for August".
const hire = seedRow("vehicles", "van:hire");
hire.hired_from = day(-1);
hire.hired_to = day(17);
hire.model = T("No crew of its own", "Ohne eigenes Team", "Sans équipe attitrée", "Bez vlastní čety", "Uden eget hold", "没有固定班组", "沒有固定班組", "بلا طاقم خاص بها");
hire.name["@t"]["ar-EG"] = "مركبة مستأجرة";

// BN-19: j5, J-07's return visit, booked for Blue crew on Wed 5 Aug from 08:00.
const j5 = seedRow("job_visits", "jobvisit:j5");
Object.assign(j5, {
  kind: "return",
  what: T("Test-floor workbenches: return visit", "Werkbänke für die Testfläche: erneuter Besuch", "Établis du plateau d’essai : second passage", "Pracovní stoly na zkušební halu: opakovaná návštěva", "Arbejdsborde til testgulvet: tilbagebesøg", "测试区工作台：回访", "測試區工作檯：回訪", "طاولات عمل قاعة الاختبار: زيارة عودة"),
  day: day(8),
  start_time: "08:00",
  crew_id: { "@ref": "crew:blue" },
  state: "booked",
});
delete j5.vehicle_id;
// Keep the columns in the order the other booked visits have them.
{
  const rows = seedTable("job_visits").rows;
  const order = ["@label", "job_id", "kind", "what", "day", "start_time", "crew_id", "hours", "crew_size", "stock_ready_on", "state", "tick_loaded", "tick_arrived", "tick_done", "tick_cleared"];
  const sorted = Object.fromEntries([...order.filter((key) => key in j5).map((key) => [key, j5[key]]), ...Object.entries(j5).filter(([key]) => !order.includes(key))]);
  rows[rows.indexOf(j5)] = sorted;
}

// BN-18: each crew's day with a visit to come is a stored row (CD-8); Red crew on the hired vehicle on Wed 5 Aug.
{
  const at = seed.tables.findIndex((one) => one.ref === "van_days");
  const rows = [
    { "@label": "vanday:blue-4aug", crew_id: { "@ref": "crew:blue" }, day: day(7), vehicle_id: { "@ref": "van:blue" } },
    { "@label": "vanday:blue-5aug", crew_id: { "@ref": "crew:blue" }, day: day(8), vehicle_id: { "@ref": "van:blue" } },
    { "@label": "vanday:red-5aug", crew_id: { "@ref": "crew:red" }, day: day(8), vehicle_id: { "@ref": "van:hire" } },
    { "@label": "vanday:blue-6aug", crew_id: { "@ref": "crew:blue" }, day: day(9), vehicle_id: { "@ref": "van:blue" } },
  ];
  const entry = { ref: "van_days", rows };
  if (at >= 0) seed.tables[at] = entry;
  else seed.tables.splice(must(seed.tables.findIndex((one) => one.ref === "crew_days") + 1 || undefined, "sample table crew_days"), 0, entry);
}

// BN-21: J-07's delivery note for Wed 5 Aug (the visit's day), not yet signed for: what goes on the vehicle.
{
  const notes = seedTable("delivery_notes").rows;
  const note = { "@label": "note:dn6", job_id: { "@ref": "job:h5" }, visit_id: { "@ref": "jobvisit:j5" }, damage: false };
  const at = notes.findIndex((row) => row["@label"] === "note:dn6");
  if (at >= 0) notes[at] = note;
  else notes.push(note);
  const lines = seedTable("delivery_note_lines").rows;
  const copyWhat = (what) => structuredClone(must(lines.find((row) => row.note_id?.["@ref"] === "note:dn1" && row.what?.["@t"]?.["en-US"] === what), `dn1's line ${what}`).what);
  const mine = [
    { note_id: { "@ref": "note:dn6" }, what: copyWhat("Cable tray, 2m"), ordered: 2, delivered: 0 },
    { note_id: { "@ref": "note:dn6" }, what: copyWhat("Bench top, laminate"), ordered: 1, delivered: 0 },
  ];
  const kept = lines.filter((row) => row.note_id?.["@ref"] !== "note:dn6");
  seedTable("delivery_note_lines").rows = [...kept, ...mine];
}

// BN-20: J-07's won deal needs "Cable trays and floor power" (s8), two each, on j5.
{
  const needsTable = must(inventory.tables.find((one) => one.ref === "deal_stock_needs"), "Inventory sample's deal_stock_needs");
  const need = { deal_id: { "@ref": "deal:h5" }, item: { "@ref": "inv:item:s8" }, qty: 2, visit_id: { "@ref": "jobvisit:j5" } };
  const at = needsTable.rows.findIndex((row) => row.deal_id?.["@ref"] === "deal:h5" && row.item?.["@ref"] === "inv:item:s8");
  if (at >= 0) needsTable.rows[at] = need;
  else needsTable.rows.push(need);
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(SEED, `${JSON.stringify(seed, null, 1)}\n`);
writeFileSync(INVENTORY, `${JSON.stringify(inventory, null, 1)}\n`);
console.log("t05-whole: van_days, hire days, What to load, D17's rules and the sample written");
