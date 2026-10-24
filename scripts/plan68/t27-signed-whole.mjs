#!/usr/bin/env node
// Plan 68, phase 4 (T27, S13): e-mail 17's signed copy as a PDF, and its ticks. What the whole app and its sample gain.
//
//  - `sign_offs.snags_at_signing` (text, empty on a sign-off made before 0.2.2, which prints no list) and
//    `sign_offs.check_words` (text, empty before 0.2.2): written by the crew's phone WITH the sign-off, from what the
//    Sign off screen showed the customer (the job's open snags as a JSON list of {"what","by":"YYYY-MM-DD","note"}; the
//    five checks' words, one a line, in the language the screen was in). No engine word fills a text column from child
//    rows on create, and what the customer was shown is the truer "open at signing" (offline too: the queue sends what
//    the phone held). Create only: the crew and the operations manager may name them on a new sign-off and nobody they
//    hold changes one after (no update grant). The server cannot check the phone's list against the snags.
//  - `documents`: the signed copy, kind `signed-copy`, drawn by Invoices & Receipts from the sign-off (the job by its
//    title, never its code). An Invoices that does not draw the kind yet leaves it waiting (E22).
//  - `crm-signed-copy` (e-mail 17) carries it, `optional`: no job code, the signed day, "Your signed copy is attached."
//    only with the attachment, the five checks as Yes/No (E15), and what is still to put right.
//  - The sample's sign-offs: their check words and the snags open when each was signed.
//
// Run: node scripts/plan68/t27-signed-whole.mjs  (idempotent; finds everything by key)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const SEED = join(ROOT, "whole", "seeds", "meridian.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const seed = JSON.parse(readFileSync(SEED, "utf8"));

const fail = (message) => {
  throw new Error(`t27-signed-whole: ${message}`);
};
const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
const words = (en, de, fr, da, cs, ar, zhCN, zhTW) => ({ "en-US": en, "de-DE": de, "fr-FR": fr, "da-DK": da, "cs-CZ": cs, "ar-EG": ar, "zh-CN": zhCN, "zh-TW": zhTW });
const tables = manifest.requiredSchema?.tables;
if (!Array.isArray(tables)) fail("requiredSchema.tables is not a list");
const table = (ref) => tables.find((one) => one.ref === ref) ?? fail(`no table "${ref}"`);
const column = (t, ref) => t.columns.find((one) => one.ref === ref) ?? fail(`no column "${t.ref}.${ref}"`);
const role = (key) => manifest.roles.find((one) => one.key === key) ?? fail(`no role "${key}"`);

/* ─── The five checks' words, as the crew's screen says them (`jb.check.*`), in the order of check_1 … check_5 ─── */
const CHECK_WORDS = [
  words("Everything on the list is on site", "Alles auf der Liste ist vor Ort", "Tout ce qui est sur la liste est sur place", "Alt på listen er på stedet", "Vše ze seznamu je na místě", "كل ما في القائمة موجود في الموقع", "清单上的东西都已到场", "清單上的東西都已到場"),
  words("Nothing damaged, nothing marked", "Nichts beschädigt, nichts verkratzt", "Rien d’abîmé, rien de marqué", "Intet beskadiget, intet mærket", "Nic poškozeného, nic poškrábaného", "لا تلف ولا خدوش", "无损坏、无划痕", "無損壞、無刮痕"),
  words("Keys and spares handed over", "Schlüssel und Ersatzteile übergeben", "Clés et pièces de rechange remises", "Nøgler og reservedele afleveret", "Klíče a náhradní díly předány", "سُلّمت المفاتيح وقطع الغيار", "钥匙和备件已交付", "鑰匙和備件已交付"),
  words("Floor left as we found it", "Boden so hinterlassen, wie wir ihn vorfanden", "Sol laissé comme nous l’avons trouvé", "Gulvet efterladt, som vi fandt det", "Podlaha zanechána, jak jsme ji našli", "تُركت الأرضية كما وجدناها", "地面已恢复原样", "地面已恢復原樣"),
  words("Shown them how it works", "Bedienung gezeigt", "Montré comment ça marche", "Vist dem, hvordan det virker", "Ukázáno, jak to funguje", "عرضنا عليهم طريقة العمل", "已演示使用方法", "已示範使用方法"),
];
const CHECKS = ["check_1", "check_2", "check_3", "check_4", "check_5"];

/* ─── sign_offs: the two columns the phone writes with the sign-off ─── */
const signOffs = table("sign_offs");
for (const ref of [...CHECKS, "signer_name", "signature", "signed_at", "job_id", "visit_id", "photos"]) column(signOffs, ref);
if (column(signOffs, "signed_at").rules?.stamp?.on !== "create") fail("sign_offs.signed_at is no longer stamped on create");
if (column(signOffs, "signature").rules?.file === undefined || column(signOffs, "signature").rules.file.maxCount !== undefined) fail("sign_offs.signature is no longer one file");
const SNAGS_AT_SIGNING = {
  ref: "snags_at_signing",
  // Unbounded TEXT (a long varchar would crowd MySQL's row), held to its length by the column's own check.
  type: "text",
  nullable: true,
  rules: { validation: { maxLength: 20000 } },
  label: words(
    "Still to put right when it was signed",
    "Bei der Unterschrift noch zu beheben",
    "Restait à reprendre à la signature",
    "Manglede at blive udbedret ved underskriften",
    "Zbývalo odstranit při podpisu",
    "ما بقي لإصلاحه عند التوقيع",
    "签字时仍待整改",
    "簽名時仍待改善",
  ),
};
const CHECK_WORDS_COLUMN = {
  ref: "check_words",
  type: "text",
  maxLength: 1000,
  nullable: true,
  label: words("The checks, as worded when signed", "Die Prüfpunkte im Wortlaut der Unterschrift", "Les points de contrôle tels que signés", "Kontrolpunkterne, som de lød ved underskriften", "Kontrolní body ve znění při podpisu", "بنود الفحص كما صيغت عند التوقيع", "签字时的检查项措辞", "簽名時的檢查項措辭"),
};
for (const [made, after] of [
  [SNAGS_AT_SIGNING, "photos"],
  [CHECK_WORDS_COLUMN, "snags_at_signing"],
]) {
  const at = signOffs.columns.findIndex((one) => one.ref === made.ref);
  if (at === -1) signOffs.columns.splice(signOffs.columns.findIndex((one) => one.ref === after) + 1, 0, made);
  else signOffs.columns[at] = made;
}

/* ─── Who names them: on a new sign-off only, as each already makes one ─── */
for (const key of ["crew", "ops-manager"]) {
  const limit = role(key).limits?.sign_offs ?? fail(`role "${key}" no longer limits its sign-offs`);
  if (!Array.isArray(limit.creatable) || !limit.creatable.includes("signer_name")) fail(`role "${key}" no longer makes sign-offs`);
  if (limit.writable !== undefined || limit.rows?.update !== undefined) fail(`role "${key}" now changes sign-offs`);
  for (const ref of ["snags_at_signing", "check_words"]) if (!limit.creatable.includes(ref)) limit.creatable.splice(limit.creatable.indexOf("photos") + 1, 0, ref);
  limit.creatable = [...new Set(limit.creatable)];
}
for (const r of manifest.roles) {
  const limit = r.limits?.sign_offs;
  for (const ref of ["snags_at_signing", "check_words"]) if (limit?.writable?.includes(ref)) fail(`role "${r.key}" may change ${ref}`);
}

/* ─── The signed copy, drawn by Invoices & Receipts ─── */
const invoices = (manifest.addOns?.suggests ?? []).find((one) => one.key === "invoices") ?? fail("the app no longer suggests Invoices & Receipts");
void invoices;
for (const ref of ["title", "site_name"]) column(table("jobs"), ref);
column(table("job_visits"), "day");
const template = manifest.emailTemplates.find((one) => one.key === "crm-signed-copy") ?? fail('no template "crm-signed-copy"');
const DOCUMENT = {
  kind: "signed-copy",
  addOn: "invoices",
  table: "sign_offs",
  name: template.name,
  module: "jobs",
  // The job by its title, never its code; the customer's own words of what they signed, as the phone wrote them.
  mapping: {
    work: { via: "job_id", column: "title" },
    site: { via: "job_id", column: "site_name" },
    doneOn: { via: "visit_id", column: "day" },
    signedAt: { column: "signed_at" },
    signerName: { column: "signer_name" },
    signature: { column: "signature" },
    checks: { column: "check_words" },
    ...Object.fromEntries(CHECKS.map((ref, i) => [`check${String(i + 1)}`, { column: ref }])),
    snags: { column: "snags_at_signing" },
  },
};
manifest.documents ??= [];
const docAt = manifest.documents.findIndex((one) => one.kind === DOCUMENT.kind && one.table === DOCUMENT.table);
if (docAt === -1) manifest.documents.push(DOCUMENT);
else manifest.documents[docAt] = DOCUMENT;

/* ─── E-mail 17 ─── */
if (manifest.outbox?.links?.sign_off !== "sign_off_id") fail('the outbox has no "sign_off" link');
for (const kind of ["signed-copy", "signed-copy-to"]) if (manifest.outbox.kinds?.[kind] !== "crm-signed-copy") fail(`outbox kind "${kind}" no longer sends crm-signed-copy`);
const old = template.locales;
for (const tag of LOCALES) if (old[tag]?.subject === undefined || old[tag]?.footer === undefined) fail(`crm-signed-copy has no ${tag}`);
/** The words of each language, in order: the greeting, the attached line, the two list heads, a snag's "by", the empty line. */
const SAY = {
  "en-US": ["Hello {{recipient.first_name}}, thank you for signing off {{job.title}} on {{sign_off.signed_at.date}}.", "Your signed copy is attached.", "What you signed", "Still to put right", "by {{row.due_on.day_month}}", "Nothing was left to put right."],
  "de-DE": ["Hallo {{recipient.first_name}}, vielen Dank, dass Sie {{job.title}} am {{sign_off.signed_at.date}} abgenommen haben.", "Ihre unterschriebene Kopie ist angehängt.", "Was Sie unterschrieben haben", "Noch zu beheben", "bis {{row.due_on.day_month}}", "Es blieb nichts zu beheben."],
  "fr-FR": ["Bonjour {{recipient.first_name}}, merci d’avoir réceptionné {{job.title}} le {{sign_off.signed_at.date}}.", "Votre copie signée est jointe.", "Ce que vous avez signé", "Reste à reprendre", "avant le {{row.due_on.day_month}}", "Il ne restait rien à reprendre."],
  "da-DK": ["Hej {{recipient.first_name}}, tak fordi du godkendte {{job.title}} den {{sign_off.signed_at.date}}.", "Din underskrevne kopi er vedhæftet.", "Det, du skrev under på", "Mangler stadig at blive udbedret", "senest {{row.due_on.day_month}}", "Der var intet tilbage at udbedre."],
  "cs-CZ": ["Dobrý den, {{recipient.first_name}}, děkujeme za převzetí zakázky {{job.title}} dne {{sign_off.signed_at.date}}.", "Podepsanou kopii najdete v příloze.", "Co jste podepsali", "Zbývá odstranit", "do {{row.due_on.day_month}}", "Nezbylo nic k odstranění."],
  "ar-EG": ["مرحبًا {{recipient.first_name}}، شكرًا لاعتمادك استلام {{job.title}} يوم {{sign_off.signed_at.date}}.", "نسختك الموقّعة مرفقة.", "ما وقّعت عليه", "ما زال بحاجة إلى معالجة", "بحلول {{row.due_on.day_month}}", "لم يتبقَّ شيء لمعالجته."],
  "zh-CN": ["{{recipient.first_name}}，您好！感谢您于 {{sign_off.signed_at.date}} 对 {{job.title}} 进行验收。", "随信附上您的签字副本。", "您签字确认的内容", "仍待整改", "{{row.due_on.day_month}} 前", "已无待整改项。"],
  "zh-TW": ["{{recipient.first_name}}，您好！感謝您於 {{sign_off.signed_at.date}} 對 {{job.title}} 進行驗收。", "隨信附上您的簽名副本。", "您簽名確認的內容", "仍待改善", "{{row.due_on.day_month}} 前", "已無待改善項目。"],
};
const CALL = {
  "en-US": "Something not right? Call us on {{practice.office_phone}}.",
  "de-DE": "Stimmt etwas nicht? Rufen Sie uns an: {{practice.office_phone}}.",
  "fr-FR": "Un souci ? Appelez-nous au {{practice.office_phone}}.",
  "da-DK": "Er der noget galt? Ring til os på {{practice.office_phone}}.",
  "cs-CZ": "Něco není v pořádku? Zavolejte nám na {{practice.office_phone}}.",
  "ar-EG": "هل هناك مشكلة؟ اتصل بنا على {{practice.office_phone}}.",
  "zh-CN": "有问题？请致电 {{practice.office_phone}}。",
  "zh-TW": "有問題嗎？請致電 {{practice.office_phone}}。",
};
const headingOf = (content) => content.blocks.find((block) => block.block === "email.heading")?.data?.text ?? fail("crm-signed-copy lost its heading");
const locales = {};
for (const tag of LOCALES) {
  const [hello, attached, signedHead, snagsHead, by, none] = SAY[tag];
  locales[tag] = {
    subject: old[tag].subject,
    blocks: [
      { block: "email.heading", data: { text: headingOf(old[tag]) } },
      { block: "email.text", data: { text: hello } },
      // Only with the signed copy: an install whose Invoices does not draw it yet, or none, sends the mail without both.
      { block: "email.text", data: { text: attached, withAttachment: true } },
      { block: "email.heading", data: { text: signedHead } },
      // Each answer as the reader says yes or no (E15).
      { block: "email.tax-breakdown", data: { lines: CHECKS.map((ref, i) => ({ label: CHECK_WORDS[i][tag], amount: `{{sign_off.${ref}}}` })) } },
      { block: "email.heading", data: { text: snagsHead } },
      {
        block: "email.rows",
        id: "rows-snags",
        data: {
          // A mail lists rows of a table only (no list of a column's text), so it lists the job's snags still open as it
          // goes, a moment after the signing; the signed copy it carries prints what was open when it was signed.
          from: { link: "job", table: "snags", via: "job_id", orderBy: "due_on", where: { column: "state", in: ["open", "waiting-part"] }, limit: 50 },
          row: { title: "{{row.text}}", meta: by, note: "{{row.put_right_note|}}" },
          empty: none,
        },
      },
      { block: "email.text", data: { text: CALL[tag] }, showWhen: { var: "practice.office_phone" } },
    ],
    footer: old[tag].footer,
  };
}
template.attach = { kind: "signed-copy", link: "sign_off", optional: true };
template.vars = ["recipient.first_name", "job.title", "job.site_name", "sign_off.signed_at.date", ...CHECKS.map((ref) => `sign_off.${ref}`), "practice.office_phone"];
template.locales = locales;
// Key order as the other templates: key, name, attach, vars, locales.
const ordered = { key: template.key, name: template.name, attach: template.attach, vars: template.vars, locales: template.locales };
manifest.emailTemplates[manifest.emailTemplates.indexOf(template)] = ordered;
if (JSON.stringify(ordered).includes("job.code")) fail("e-mail 17 still names the job's code");

/* ─── The sample: each sign-off's check words, and the snags open when it was signed ─── */
const sample = (ref) => seed.tables.find((one) => one.ref === ref) ?? fail(`the sample has no "${ref}"`);
const checkWords = Object.fromEntries(LOCALES.map((tag) => [tag, CHECK_WORDS.map((one) => one[tag]).join("\n")]));
const snagsOf = sample("snags").rows;
const textOf = (snag) => snag.text?.["@t"] ?? fail("a sample snag's text is no longer in every language");
/*
 * A snag was open when its job was signed if it was raised on or before that day and put right after that day (or not
 * yet). `by` is left out: the sample's days are relative to the day it is added, and a text holds no such day.
 */
for (const signOff of sample("sign_offs").rows) {
  const job = signOff.job_id?.["@ref"] ?? fail("a sample sign-off names no job");
  const signedDay = signOff.signed_at?.["@day"] ?? fail(`the sample sign-off of ${job} has no signing day`);
  const open = snagsOf.filter((snag) => snag.job_id?.["@ref"] === job && snag.raised_on["@day"] <= signedDay && (snag.put_right_on === undefined || snag.put_right_on["@day"] > signedDay));
  signOff.check_words = { "@t": checkWords };
  signOff.snags_at_signing = { "@t": Object.fromEntries(LOCALES.map((tag) => [tag, JSON.stringify(open.map((snag) => ({ what: textOf(snag)[tag], note: "" })))])) };
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(SEED, JSON.stringify(seed, null, 1) + "\n");
console.log("t27-signed-whole: sign_offs.snags_at_signing and check_words, the signed copy, e-mail 17 and the sample are in.");
