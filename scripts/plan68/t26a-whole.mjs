#!/usr/bin/env node
/**
 * Plan 68, phase 4 (T26a): deals, the hand-over, approvals and quotes on the
 * engine's new words (Adminium 0.3.35).
 *
 *  - R1a (E28): a quote is made only on an open deal (`quotes` create held to
 *    `deal_state = open`); history (imports, the sample) still brings one on a
 *    closed deal.
 *  - R1c (E12): the hand-over carries the OLD owner's booked visits and open
 *    follow-ups to the new owner in its own write; anybody else's stay.
 *  - R1d (E11): the sales manager reaches a deal only when somebody she leads
 *    OWNS it (never through a helper's listing or a cover), and every row that
 *    belongs through a deal by that deal's owner. Two links deep (a quote's
 *    lines, a visit's notes, a job's rows) the parent keeps a copy of the
 *    deal's owner (`deal_owner_id`) for the reach to read. A follow-up with no
 *    deal stays its owner's (`on_deal`). "Approval asked" tells whoever leads
 *    the DEAL's owner.
 *  - S2 + E1 (`column.changes`): a quote's approval becomes approved or refused
 *    only from asked, never by the person who asked nor by the deal's owner;
 *    it goes (back) to asked only from none, approved or refused, on a draft.
 *    "Reopen it" puts a decision back to asked with a note. Who asked is the
 *    person who wrote the reason, so a reopen does not make the manager the
 *    asker.
 *  - X2 (E1 `rows.notBy`): the sales manager never changes her own target nor
 *    her own starter row (its first-year target); a meeting's decisions are
 *    changed only by who runs the meeting (`meetings.run_by_id`, the server's).
 *
 * Finds everything by key or ref, asserts what it needs, idempotent.
 *
 *   node scripts/plan68/t26a-whole.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const SEED = join(APP, "whole", "seeds", "meridian.json");

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const seed = JSON.parse(readFileSync(SEED, "utf8"));

const fail = (message) => {
  throw new Error(`t26a-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);
/** A label in the eight languages, in the manifest's order. */
const L = (en, de, fr, da, cs, ar, zhCN, zhTW) => ({ "en-US": en, "de-DE": de, "fr-FR": fr, "da-DK": da, "cs-CZ": cs, "ar-EG": ar, "zh-CN": zhCN, "zh-TW": zhTW });

const tables = manifest.requiredSchema.tables;
const table = (ref) => must(tables.find((one) => one.ref === ref), `table ${ref}`);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);
const col = (tableRef, ref) => must(table(tableRef).columns.find((one) => one.ref === ref), `${tableRef}.${ref}`);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
/** A role's row limit on a table: the actions named are set, the others left as they are. */
function rows(key, ref, actions) {
  const r = role(key);
  const found = must(r.limits?.[ref], `${key}'s limit on ${ref}`);
  found.rows ??= {};
  for (const [action, reach] of Object.entries(actions)) found.rows[action] = reach;
}

/* ─── Preconditions ─── */

for (const ref of ["deals", "quotes", "quote_lines", "site_visits", "visit_notes", "visit_agreed", "follow_ups", "jobs", "targets", "starters", "meetings", "meeting_decisions"]) table(ref);
for (const key of ["admin", "sales-manager", "rep", "account-manager"]) role(key);
const asked = must(manifest.automations.find((one) => one.key === "approval-asked"), "rule approval-asked");
const quotes = table("quotes");
if (quotes.builtOn !== "invoices/quote@1") fail("quotes is no longer built on Invoices' quote");
if (col("quotes", "deal_state").rules?.copy?.from !== "state") fail("quotes.deal_state is not the deal's state");
if (!sameJson(col("quotes", "approval").enum, ["none", "asked", "approved", "refused"])) fail("quotes.approval's values moved");
const handOver = must(table("deals").states.actions.find((one) => one.id === "hand-over"), "the deals' hand-over");
if (handOver.handOver !== true || !sameJson(handOver.ask, ["owner_id", "introduce"])) fail("the hand-over no longer asks owner_id and introduce");
if (!sameJson(col("site_visits", "state").enum, ["booked", "done"])) fail("site_visits.state's values moved");
if (col("follow_ups", "done").type !== "bool") fail("follow_ups.done is not a yes/no");
for (const [ref, via] of [["quotes", "deal_id"], ["site_visits", "deal_id"], ["jobs", "deal_id"], ["quote_lines", "document_id"], ["visit_notes", "visit_id"], ["visit_agreed", "visit_id"]]) {
  if (!(table(ref).belongs ?? []).some((way) => way.via === via)) fail(`${ref} does not belong through ${via}`);
}
if (table("meetings").belongs !== undefined && !sameJson(table("meetings").belongs, [{ column: "run_by_id" }])) fail("meetings already belongs some other way");

/* ─── R1a: a quote is made only on an open deal (E28) ─── */

quotes.states.create = { requires: { where: [{ column: "deal_state", eq: "open" }] } };

/* ─── R1c: the hand-over carries the old owner's booked visits and open follow-ups (E12) ─── */

// Booked visits are carried too: the engine places each carried row of a table with `occupies` under its slot's lock,
// as a single change is placed (plan-68-engine 4a7cf9c1a); the new owner's own clash refuses the whole hand-over
// (409 BOOKING_TAKEN) and nothing moves. `HAND_OVER_CARRIES_VISITS` in src/selling/handover.ts says the same to the
// sheet, and a unit test holds the two equal.
const CARRY_VISITS = true;
handOver.carries = [
  ...(CARRY_VISITS ? [{ table: "site_visits", via: "deal_id", column: "rep_id", where: [{ column: "state", eq: "booked" }] }] : []),
  { table: "follow_ups", via: "deal_id", column: "owner_id", where: [{ column: "done", eq: false }] },
];

/* ─── R1d: the deal's owner judges every row that belongs through it (E11) ─── */

const OWNER_COPY = {
  ref: "deal_owner_id",
  type: "text",
  maxLength: 36,
  nullable: true,
  rules: { staff: true, copy: { via: "deal_id", from: "owner_id", mode: "always", follow: true } },
  label: L("Deal's owner", "Inhaber des Deals", "Responsable de l’affaire", "Sagens ejer", "Vlastník obchodu", "صاحب الصفقة", "商机负责人", "商機負責人"),
};
column("quotes", structuredClone(OWNER_COPY), "deal_state");
column("site_visits", structuredClone(OWNER_COPY), "rep_id");
column("jobs", structuredClone(OWNER_COPY), "deal_id");
// A role that reads a quote's deal reads whose deal it is too.
for (const r of manifest.roles) {
  for (const ref of ["quotes", "site_visits", "jobs"]) {
    const readable = r.limits?.[ref]?.readable;
    if (readable !== undefined && readable.includes("deal_id") && !readable.includes("deal_owner_id")) readable.push("deal_owner_id");
  }
}
// A follow-up with no deal (a job's aftercare call) is its owner's alone; one on a deal is judged by the deal's owner.
column(
  "follow_ups",
  {
    ref: "on_deal",
    type: "int",
    nullable: true,
    rules: { formula: { if: [{ isNull: "deal_id" }, 0, 1] } },
    label: L("On a deal", "Zu einem Deal", "Liée à une affaire", "På en deal", "U obchodu", "على صفقة", "关联商机", "關聯案件"),
  },
  "deal_id",
);
{
  const fu = table("follow_ups");
  if (!fu.belongs.some((way) => way.via === "deal_id")) fu.belongs.push({ via: "deal_id" });
}

const BY_OWNER = { reach: "team", by: "owner_id" };
const BY_DEAL = { reach: "team", via: "deal_id", by: "owner_id" };
const BY_COPY = (via) => ({ reach: "team", via, by: "deal_owner_id" });
rows("sales-manager", "deals", { read: BY_OWNER, update: BY_OWNER });
for (const ref of ["deal_stage_changes", "activities", "deal_amount_changes", "jobs", "deal_stock_needs"]) rows("sales-manager", ref, { read: BY_DEAL });
for (const ref of ["quotes", "comments"]) rows("sales-manager", ref, { read: BY_DEAL, update: BY_DEAL });
rows("sales-manager", "cover_notes", { read: BY_DEAL, update: BY_DEAL, delete: BY_DEAL });
// Who is on a deal, and its visits: read by the deal's owner; changed as before (by the deal's owner, the visit's rep), both held.
rows("sales-manager", "deal_members", { read: BY_DEAL });
rows("sales-manager", "site_visits", { read: BY_DEAL });
rows("sales-manager", "quote_lines", { read: BY_COPY("document_id"), update: BY_COPY("document_id"), delete: BY_COPY("document_id") });
for (const ref of ["visit_notes", "visit_agreed"]) rows("sales-manager", ref, { read: BY_COPY("visit_id"), update: BY_COPY("visit_id") });
for (const ref of ["job_visits", "sign_offs", "refused_sign_offs", "snags", "feedback", "warranty_claims"]) {
  if (!(table(ref).belongs ?? []).some((way) => way.via === "job_id")) fail(`${ref} does not belong through job_id`);
  rows("sales-manager", ref, { read: BY_COPY("job_id") });
}
const FOLLOW_UPS = [BY_DEAL, { reach: "team", by: "owner_id", while: { column: "on_deal", in: [0] } }];
rows("sales-manager", "follow_ups", { read: FOLLOW_UPS, update: FOLLOW_UPS });
// The new way (through the deal) widens nobody else: a rep's and the account manager's follow-ups stay the ones they own.
rows("rep", "follow_ups", { read: { reach: "own", by: "owner_id" }, update: { reach: "own", by: "owner_id" }, delete: { reach: "own", by: "owner_id" } });
rows("account-manager", "follow_ups", { read: { reach: "own", by: "owner_id" }, update: { reach: "own", by: "owner_id" } });
// `on_deal` is the server's: a new follow-up is made with the columns it may be changed in, never with its own `on_deal`.
for (const key of ["sales-manager", "rep", "account-manager"]) {
  const found = must(role(key).limits.follow_ups.writable, `${key}'s writable on follow_ups`);
  if (found.includes("on_deal")) fail(`${key} writes follow_ups.on_deal`);
  role(key).limits.follow_ups.creatable = [...found];
}

// "A discount is put to approval": whoever leads the DEAL's owner, never a helper's lead; nobody leads them, the CRM admin.
{
  const tell = must(asked.graph.nodes.find((node) => node.action?.kind === "notification"), "approval-asked's notice");
  // Owner, 2026-10-24 (ruling of R1d as written): the deal owner's lead AND the CRM admin. Two steps; a lead with no
  // `else` (Adminium 0.3.35, `automations.leadAlone`) tells nobody when nobody leads the owner, so the admin hears once.
  tell.action.to = { column: "deal_id.owner_id", lead: true };
  tell.title = "Tell the deal owner’s team lead";
  const told = asked.graph.nodes.filter((node) => node.action?.kind === "notification");
  if (!told.some((node) => node.id === "tell-admin")) {
    asked.graph.nodes.splice(asked.graph.nodes.indexOf(tell) + 1, 0, { id: "tell-admin", kind: "action", title: "Tell the CRM admin", action: { ...structuredClone(tell.action), to: { roles: ["admin"] } } });
  } else {
    const admin = told.find((node) => node.id === "tell-admin");
    admin.action = { ...structuredClone(tell.action), to: { roles: ["admin"] } };
  }
  asked.graph.nodes.find((node) => node.kind === "trigger").title = "A discount is put to approval: the deal owner’s team lead and the CRM admin are told";
  asked.name = L(
    "A discount is put to approval: the deal owner’s team lead and the CRM admin are told",
    "Ein Rabatt wird zur Genehmigung vorgelegt: die Teamleitung des Deal-Inhabers und der CRM-Admin werden benachrichtigt",
    "Remise soumise à approbation : le responsable d’équipe du titulaire de l’affaire et l’administrateur CRM sont prévenus",
    "En rabat sendes til godkendelse: lederen af teamet for sagens ejer og CRM-administratoren får besked",
    "Sleva jde ke schválení: vedoucí týmu vlastníka obchodu a správce CRM dostanou zprávu",
    "يُعرض خصم للاعتماد: يُبلَّغ قائد فريق صاحب الصفقة ومسؤول CRM",
    "折扣提交审批：通知商机负责人的团队负责人和 CRM 管理员",
    "折扣送交核准：通知商機負責人的團隊負責人和 CRM 管理員",
  );
  asked.description = L(
    "When somebody asks for approval of a quote, or a decision is reopened, tells whoever leads a team the deal’s owner is in and can open the quote, and the CRM admin. Never the lead of a colleague who only helps on the deal.",
    "Benachrichtigt, sobald jemand die Genehmigung eines Angebots anfragt oder eine Entscheidung wieder geöffnet wird, die Leitung eines Teams, in dem die Person ist, der der Deal gehört, sofern sie das Angebot öffnen kann, und den CRM-Admin. Nie die Leitung einer Kollegin oder eines Kollegen, die oder der nur am Deal mithilft.",
    "Dès qu’une approbation de devis est demandée ou qu’une décision est rouverte, prévient la personne qui dirige une équipe dont fait partie le titulaire de l’affaire et qui peut ouvrir le devis, ainsi que l’administrateur CRM. Jamais le responsable d’un collègue qui ne fait qu’aider sur l’affaire.",
    "Når nogen beder om godkendelse af et tilbud, eller en afgørelse genåbnes, får lederen af et team, sagens ejer er med i, besked, hvis lederen kan åbne tilbuddet, og det gør CRM-administratoren også. Aldrig lederen for en kollega, der kun hjælper på sagen.",
    "Když někdo požádá o schválení nabídky nebo se rozhodnutí znovu otevře, dá vědět vedoucímu týmu, jehož je vlastník obchodu členem, pokud nabídku otevře, a správci CRM. Nikdy vedoucímu kolegy, který na obchodu jen pomáhá.",
    "عند طلب اعتماد عرض سعر أو إعادة فتح قرار، يُبلِّغ من يقود فريقًا ينتمي إليه صاحب الصفقة ويستطيع فتح العرض، ويُبلِّغ مسؤول CRM. ولا يُبلِّغ أبدًا قائد زميل يساعد في الصفقة فقط.",
    "有人为报价申请审批或重新打开某个审批决定时，通知商机负责人所在团队中能打开该报价的负责人，并通知 CRM 管理员。从不通知只是协助该商机的同事的负责人。",
    "有人為報價申請核准或重新開啟某個核准決定時，通知商機負責人所在團隊中能開啟該報價的負責人，並通知 CRM 管理員。從不通知只是協助該案件的同事的負責人。",
  );
}

/* ─── S2: who decides, and "Reopen it" (E1, column.changes) ─── */

col("quotes", "approval").rules.changes = [
  { to: ["approved", "refused"], from: ["asked"], notBy: ["asked_by_id", "deal_id.owner_id"] },
  { to: ["asked"], from: ["none", "approved", "refused"], while: { column: "status", in: ["draft"] } },
];
// Who asked is who wrote the reason: a reopen (approval back to asked, the reason left as it is) keeps the asker.
col("quotes", "asked_by_id").rules.stamp = { set: "user-id", on: { column: "ask_reason", filled: true } };
{
  const actions = quotes.states.actions;
  const reopen = {
    id: "reopen-approval",
    label: L("Reopen it", "Wieder öffnen", "Rouvrir", "Genåbn", "Znovu otevřít", "أعِد فتحه", "重新打开", "重新開啟"),
    set: { approval: "asked" },
    in: ["draft"],
    ask: ["decision_note"],
  };
  const at = actions.findIndex((one) => one.id === reopen.id);
  if (at >= 0) actions[at] = reopen;
  else actions.splice(must(actions.findIndex((one) => one.id === "refuse") + 1 || undefined, "the refuse button"), 0, reopen);
}

/* ─── X2: her own target, her own first-year target, a meeting she does not run (E1, rows.notBy) ─── */

rows("sales-manager", "targets", { update: { reach: "team", notBy: "rep_id" } });
rows("sales-manager", "starters", { update: { reach: "team", notBy: "user_id" } });
column(
  "meetings",
  {
    ref: "run_by_id",
    type: "text",
    maxLength: 36,
    nullable: true,
    rules: { staff: true, stamp: { set: "user-id", on: "create", strict: true } },
    label: L("Run by", "Geleitet von", "Animée par", "Ledes af", "Vede", "يديره", "主持人", "主持人"),
  },
  "minutes",
);
table("meetings").belongs = [{ column: "run_by_id" }];
table("meetings").indexes ??= [];
if (!table("meetings").indexes.some((index) => sameJson(index, ["run_by_id"]))) table("meetings").indexes.push(["run_by_id"]);
{
  // Who runs a meeting is the server's; the manager changes the rest of it.
  const r = role("sales-manager");
  r.limits.meetings = { ...(r.limits.meetings ?? {}), writable: ["at", "minutes"] };
}
{
  const decisions = table("meeting_decisions");
  decisions.belongs ??= [];
  if (!decisions.belongs.some((way) => way.via === "meeting_id")) decisions.belongs.push({ via: "meeting_id" });
  const r = role("sales-manager");
  r.limits ??= {};
  r.limits.meeting_decisions ??= {};
  const RUNS = { reach: "own", via: "meeting_id", by: "run_by_id" };
  r.limits.meeting_decisions.rows = { update: RUNS, delete: RUNS };
}

/* ─── The sample: the team meeting is Ivy's ─── */

{
  const meetings = must(seed.tables.find((one) => one.ref === "meetings"), "the sample's meetings").rows;
  if (meetings.length === 0) fail("the sample has no meeting");
  for (const meeting of meetings) meeting.run_by_id = { "@person": "ivy" };
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(SEED, `${JSON.stringify(seed, null, 1)}\n`);
console.log("t26a-whole: quotes on open deals, the hand-over's carries, the deal owner's reach, approvals, X2 written");
