#!/usr/bin/env node
/**
 * E-mail to contacts, on the engine words of Adminium 0.3.38: who the app's
 * people are, which of its mails are marketing, and what the law keeps.
 *
 * Changes `whole/manifest.json` only. Finds everything by key or name, asserts
 * what it needs, and is idempotent: run twice, it changes nothing more.
 *
 *   node scripts/people-and-classes-whole.mjs
 *   npm run stage
 *
 * What it does:
 *  - the floor moves to 0.3.38 (the first Adminium that reads `people`,
 *    `outbox.classes` and `keep`), and the version to 0.2.3;
 *  - `people`: contacts (the outbox's people: address, name, company, the
 *    newsletter yes in `may_email`, every copy of them on another table, who
 *    counts as a customer, the opt-out mark and the one-time carry of the old
 *    unsubscribe mark onto the do-not-email list), companies, and enquiries
 *    (address, name and the opt-out mark; the consent log alone holds their
 *    answer);
 *  - `contacts.won_deals`: how many of the contact's deals are won, worked
 *    out by Adminium, the "existing customer" test. A stored total is every
 *    row's, so the three roles that reach only some deals do not read it
 *    (`limits.contacts.readable`), and no role but the CRM admin gives it on
 *    a new contact (`limits.contacts.creatable`);
 *  - `contacts.opt_out_offered_at` and `enquiries.opt_out_offered_at`: the
 *    moment a staff screen showed the person the line "you can say no to our
 *    e-mail" where it took the address. A strict stamp: only that save sets
 *    it (or a claimed enquiry's mark, carried to the contact made of it);
 *  - the names copied from a person onto another table, and the referral's
 *    third party, are personal data; the roles whose screens show them read
 *    them in clear;
 *  - sign-offs, refused sign-offs and delivery notes are kept by law (signed
 *    records of a contract);
 *  - every outbox kind says its class: service, but the referral's code;
 *  - the referral's thank-you is split: the thanks itself (service, always
 *    sent) and a new `referral-code` (marketing) that carries the code, only
 *    when the referral holds one;
 *  - `approval-asked`, a kind nothing ever sent, goes with its template.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const fail = (message) => {
  throw new Error(`people-and-classes-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);
const tables = must(manifest.requiredSchema?.tables, "requiredSchema.tables");
const table = (ref) => must(tables.find((one) => one.ref === ref), `table ${ref}`);
const column = (ref, name) => must(table(ref).columns.find((one) => one.ref === name), `column ${ref}.${name}`);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);
const grant = (key, permission) => {
  const r = role(key);
  if (!r.permissions.includes(permission)) r.permissions.push(permission);
};
/** A column added once, before `before` (the row's retry key). */
const addColumn = (ref, made, before = "retry_key") => {
  const t = table(ref);
  if (t.columns.some((one) => one.ref === made.ref)) return;
  const at = t.columns.findIndex((one) => one.ref === before);
  if (at === -1) fail(`${ref}.${before} is not there`);
  t.columns.splice(at, 0, made);
};

// ── The floor and the version ───────────────────────────────────────────────
manifest.version = "0.2.3";
manifest.compatibility.minAdminiumVersion = "0.3.38";

// ── The new columns ─────────────────────────────────────────────────────────
const MARK_LABEL = {
  "en-US": "Offered a way to say no",
  "de-DE": "Auf Widerspruch hingewiesen",
  "fr-FR": "Possibilité de refuser proposée",
  "da-DK": "Tilbudt at sige nej",
  "cs-CZ": "Nabídnuta možnost odmítnout",
  "ar-EG": "عُرض عليه الرفض",
  "zh-CN": "已告知可拒绝",
  "zh-TW": "已告知可拒絕",
};
/** The opt-out mark: the server's alone, set by the save of a screen that showed the line (its own trigger never fires). */
const mark = () => ({ ref: "opt_out_offered_at", type: "timestamptz", nullable: true, label: { ...MARK_LABEL }, rules: { stamp: { set: "now", on: { columns: ["email"] }, strict: true } } });

addColumn("contacts", {
  ref: "won_deals",
  type: "int",
  default: 0,
  label: { "en-US": "Won deals", "de-DE": "Gewonnene Deals", "fr-FR": "Affaires gagnées", "da-DK": "Vundne deals", "cs-CZ": "Vyhrané obchody", "ar-EG": "الصفقات الرابحة", "zh-CN": "赢得的商机", "zh-TW": "成交的案件" },
  rules: { rollup: { from: "deals", via: "contact_id", count: true, where: { column: "state", eq: "won" } } },
});
addColumn("contacts", mark());
addColumn("enquiries", mark());
// The column order a reader meets: the mark beside the address it was offered at, the count last.
{
  const contacts = table("contacts");
  const order = ["opt_out_offered_at", "won_deals"];
  const moved = contacts.columns.filter((one) => order.includes(one.ref));
  contacts.columns = contacts.columns.filter((one) => !order.includes(one.ref));
  const at = contacts.columns.findIndex((one) => one.ref === "retry_key");
  contacts.columns.splice(at, 0, ...order.map((ref) => moved.find((one) => one.ref === ref)));
}

// ── Personal data: the names copied from a person, and a referral's third party ─
// (Not a delivery note's signer: whether anybody signed is read by a formula, and a formula reads no personal
// column. The note is kept by law, so its copy stays whole whatever the column says.)
for (const [ref, name] of [
  ["quotes", "to_name"],
  ["quotes", "sent_to_name"],
  ["quotes", "accepted_name"],
  ["sign_offs", "signer_name"],
  ["sign_offs", "copy_sent_to"],
  ["refused_sign_offs", "signer_name"],
  ["showroom_bookings", "visitor_name"],
  ["enquiries", "person"],
  ["referrals", "referred_name"],
]) {
  const c = column(ref, name);
  c.rules = { ...(c.rules ?? {}), personal: true };
}
// Who reads them in clear: the roles whose screens show them (the CRM admin too). The marketer reads a contact's address.
for (const [key, refs] of [
  ["admin", ["sign_offs", "refused_sign_offs", "showroom_bookings", "referrals"]],
  ["ops-manager", ["sign_offs", "refused_sign_offs"]],
  ["crew", ["sign_offs", "refused_sign_offs"]],
  ["front-desk", ["showroom_bookings"]],
  ["rep", ["showroom_bookings"]],
  ["account-manager", ["referrals"]],
  ["marketer", ["contacts"]],
]) {
  for (const ref of refs) {
    if (!role(key).permissions.includes(`table:@${ref}:read`)) fail(`${key} does not read ${ref}`);
    grant(key, `table:@${ref}:read_pii`);
  }
}

// ── The stored count of won deals: kept from the roles that reach only some deals, and from every new row but the admin's ─
const contactColumns = table("contacts").columns.map((one) => one.ref);
const CONTACT_CREATE = ["company_id", "name", "reference", "job_title", "email", "phone", "may_email"];
for (const key of ["sales-manager", "rep", "account-manager"]) {
  const r = role(key);
  if (r.limits?.deals?.rows?.read === undefined) fail(`${key} reaches every deal: nothing to keep from it`);
  r.limits.contacts = { ...(r.limits.contacts ?? {}), readable: contactColumns.filter((ref) => !["id", "retry_key", "won_deals"].includes(ref)) };
}
for (const key of ["sales-manager", "rep", "account-manager", "front-desk"]) {
  const r = role(key);
  if (!r.permissions.includes("table:@contacts:create")) fail(`${key} makes no contact`);
  r.limits ??= {};
  r.limits.contacts = { ...(r.limits.contacts ?? {}), creatable: [...CONTACT_CREATE] };
}
// Each limit's lists in one order: what it writes, what it makes, what it reads.
for (const key of ["sales-manager", "rep", "account-manager", "front-desk"]) {
  const limit = role(key).limits.contacts;
  role(key).limits.contacts = Object.fromEntries(["writable", "creatable", "readable"].filter((list) => limit[list] !== undefined).map((list) => [list, limit[list]]));
}

// ── Kept by law: the signed records of a job ────────────────────────────────
for (const ref of ["sign_offs", "refused_sign_offs", "delivery_notes"]) {
  const t = table(ref);
  if (t.keep === undefined) {
    // After its labels, before its columns, as the other table words sit.
    const entries = Object.entries(t);
    const at = entries.findIndex(([key]) => key === "columns");
    entries.splice(at, 0, ["keep", { law: "contract" }]);
    tables[tables.indexOf(t)] = Object.fromEntries(entries);
  }
}

// ── The referral's code: a mail of its own, marketing ───────────────────────
const outbox = manifest.outbox;
const kindColumn = column(outbox.table, outbox.columns.kind);
const thanks = must(manifest.emailTemplates.find((one) => one.key === "crm-referral-thanks"), "template crm-referral-thanks");
if (!manifest.emailTemplates.some((one) => one.key === "crm-referral-code")) {
  const CODE = {
    "en-US": ["A code for your next order", "Hello {{recipient.first_name}}, thank you again for the introduction you made on {{referral.introduced_on}}. Here is a code for your next order with us. Give it when you ask for a price."],
    "de-DE": ["Ein Code für Ihre nächste Bestellung", "Guten Tag {{recipient.first_name}}, nochmals vielen Dank für Ihre Empfehlung vom {{referral.introduced_on}}. Hier ist ein Code für Ihre nächste Bestellung bei uns. Nennen Sie ihn, wenn Sie einen Preis anfragen."],
    "fr-FR": ["Un code pour votre prochaine commande", "Bonjour {{recipient.first_name}}, merci encore pour la recommandation que vous avez faite le {{referral.introduced_on}}. Voici un code pour votre prochaine commande chez nous. Indiquez-le lorsque vous demandez un prix."],
    "da-DK": ["En kode til din næste ordre", "Hej {{recipient.first_name}}, tak igen for den anbefaling, du gav {{referral.introduced_on}}. Her er en kode til din næste ordre hos os. Oplys den, når du beder om en pris."],
    "cs-CZ": ["Kód na vaši příští objednávku", "Dobrý den, {{recipient.first_name}}, ještě jednou děkujeme za doporučení, které jste nám dali {{referral.introduced_on}}. Zde je kód na vaši příští objednávku u nás. Uveďte jej, až budete žádat o cenu."],
    "ar-EG": ["رمز لطلبك القادم", "مرحبًا {{recipient.first_name}}، شكرًا مرة أخرى على التعريف الذي قدّمته يوم {{referral.introduced_on}}. هذا رمز لطلبك القادم معنا. اذكره عند طلب السعر."],
    "zh-CN": ["您下次订购可用的代码", "{{recipient.first_name}}，您好，再次感谢您在 {{referral.introduced_on}} 为我们引荐。这是您下次订购时可用的代码，询价时请告知我们。"],
    "zh-TW": ["您下次訂購可用的代碼", "{{recipient.first_name}}，您好，再次感謝您在 {{referral.introduced_on}} 為我們引薦。這是您下次訂購時可用的代碼，詢價時請告知我們。"],
  };
  const locales = {};
  for (const [locale, content] of Object.entries(thanks.locales)) {
    const [subject, text] = must(CODE[locale], `the code mail in ${locale}`);
    const box = must(content.blocks.find((block) => block.block === "email.box"), `the code box in ${locale}`);
    locales[locale] = {
      subject,
      blocks: [
        { block: "email.heading", data: { text: subject } },
        { block: "email.text", data: { text } },
        { block: "email.box", data: { ...box.data } },
      ],
      footer: content.footer,
    };
  }
  const at = manifest.emailTemplates.indexOf(thanks) + 1;
  manifest.emailTemplates.splice(at, 0, { key: "crm-referral-code", name: "A code for your next order", vars: ["recipient.first_name", "referral.introduced_on", "referral.reward"], locales });
}
// The thanks itself says thank you, and gives nothing.
for (const content of Object.values(thanks.locales)) content.blocks = content.blocks.filter((block) => block.showWhen?.var !== "referral.reward");
thanks.vars = thanks.vars.filter((name) => name !== "referral.reward");

if (outbox.kinds["referral-code"] === undefined) {
  const kinds = {};
  for (const [kind, template] of Object.entries(outbox.kinds)) {
    kinds[kind] = template;
    if (kind === "referral-thanks") kinds["referral-code"] = "crm-referral-code";
  }
  outbox.kinds = kinds;
}
// A new value of the kind column sits with its part's (stage 1's), so each stage's values stay the start of the next
// stage's. An update adds a value an install lacks by its name, wherever it sits.
if (!kindColumn.enum.includes("referral-code")) kindColumn.enum.splice(kindColumn.enum.indexOf("referral-thanks") + 1, 0, "referral-code");
{
  const labels = kindColumn.rules.enumLabels.labels;
  kindColumn.rules.enumLabels.labels = Object.fromEntries(kindColumn.enum.filter((kind) => labels[kind] !== undefined || kind === "referral-code").map((kind) => [kind, labels[kind] ?? null]));
}
kindColumn.rules.enumLabels.labels["referral-code"] = {
  "en-US": "Code for the next order",
  "de-DE": "Code für die nächste Bestellung",
  "fr-FR": "Code pour la prochaine commande",
  "da-DK": "Kode til næste ordre",
  "cs-CZ": "Kód na příští objednávku",
  "ar-EG": "رمز للطلب القادم",
  "zh-CN": "下次订购代码",
  "zh-TW": "下次訂購代碼",
};
{
  const producers = outbox.producers;
  const thanked = must(producers.find((one) => one.kind === "referral-thanks"), "the referral-thanks producer");
  if (!producers.some((one) => one.kind === "referral-code")) {
    const code = structuredClone(thanked);
    code.kind = "referral-code";
    // Sent with the thanks, only when the referral holds a code.
    code.onChange.where = { column: "reward", isNull: false };
    producers.splice(producers.indexOf(thanked) + 1, 0, code);
  }
}

// ── A kind nothing ever sent goes ───────────────────────────────────────────
if (outbox.producers.some((one) => one.kind === "approval-asked")) fail("approval-asked has a producer now");
delete outbox.kinds["approval-asked"];
manifest.emailTemplates = manifest.emailTemplates.filter((one) => one.key !== "crm-approval-asked");
kindColumn.enum = kindColumn.enum.filter((value) => value !== "approval-asked");
delete kindColumn.rules.enumLabels.labels["approval-asked"];

// ── Each kind's class ───────────────────────────────────────────────────────
const MARKETING = new Set(["referral-code"]);
outbox.classes = Object.fromEntries(Object.keys(outbox.kinds).map((kind) => [kind, MARKETING.has(kind) ? "marketing" : "service"]));
{
  // Beside the kinds, before the producers.
  const entries = Object.entries(outbox).filter(([key]) => key !== "classes");
  const at = entries.findIndex(([key]) => key === "kinds") + 1;
  entries.splice(at, 0, ["classes", outbox.classes]);
  manifest.outbox = Object.fromEntries(entries);
}

// ── The people ──────────────────────────────────────────────────────────────
const people = [
  {
    table: "contacts",
    kind: "people",
    email: "email",
    name: "name",
    company: "company_id",
    firstName: "firstWordOfName",
    consent: { column: "may_email", purpose: "newsletter" },
    copies: [
      { table: "quotes", column: "to_email", holds: "email", via: "sent_to_contact_id" },
      { table: "quotes", column: "to_name", holds: "name", via: "sent_to_contact_id" },
      { table: "quotes", column: "sent_to_email", holds: "email", via: "sent_to_contact_id" },
      { table: "quotes", column: "sent_to_name", holds: "name", via: "sent_to_contact_id" },
      { table: "quotes", column: "accepted_name", holds: "name", via: "sent_to_contact_id" },
      { table: "sign_offs", column: "signer_name", holds: "name" },
      { table: "sign_offs", column: "copy_sent_to", holds: "email" },
      { table: "refused_sign_offs", column: "signer_name", holds: "name" },
      { table: "delivery_notes", column: "signed_name", holds: "name", via: "signed_by_contact_id" },
      { table: "showroom_bookings", column: "visitor_name", holds: "name", via: "contact_id" },
    ],
    customer: "won_deals",
    optOutMark: { column: "opt_out_offered_at", carryFrom: { table: "enquiries", column: "opt_out_offered_at" } },
    carry: [{ stopList: { column: "unsubscribed_at" } }],
  },
  { table: "companies", kind: "companies", name: "name" },
  { table: "enquiries", kind: "people", email: "email", name: "person", firstName: "firstWordOfName", optOutMark: "opt_out_offered_at" },
];
for (const entry of people) for (const copy of entry.copies ?? []) column(copy.table, copy.column);
{
  // Beside the outbox, whose recipient it names again.
  const entries = Object.entries(manifest).filter(([key]) => key !== "people");
  const at = entries.findIndex(([key]) => key === "outbox");
  entries.splice(at, 0, ["people", people]);
  const out = Object.fromEntries(entries);
  for (const key of Object.keys(manifest)) delete manifest[key];
  Object.assign(manifest, out);
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

// ── The sample: a few contacts were offered a way to say no, so "existing customers" can be seen in the demo ─
// (Sample rows are never mailed.) Three of them have a won deal and no yes; one has no won deal, so the mark alone is
// seen not to make a customer.
const SAMPLE = join(APP, "whole", "seeds", "meridian.json");
const sample = JSON.parse(readFileSync(SAMPLE, "utf8"));
const sampleContacts = must(sample.tables.find((one) => one.ref === "contacts"), "the sample's contacts");
for (const [label, day, time] of [
  ["ct:tomas", -120, "11:00"],
  ["ct:owen", -95, "09:30"],
  ["ct:yusuf", -60, "14:15"],
  ["ct:kit", -21, "10:45"],
]) {
  const row = must(sampleContacts.rows.find((one) => one["@label"] === label), `sample contact ${label}`);
  row.opt_out_offered_at = { "@day": day, "@time": time, "@week": true };
}
writeFileSync(SAMPLE, `${JSON.stringify(sample, null, 1)}\n`);
console.log("people-and-classes-whole: whole/manifest.json and the sample written");
