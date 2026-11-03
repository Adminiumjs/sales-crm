#!/usr/bin/env node
/**
 * A survey after a job is signed off, its answer as the job's feedback, and
 * the sample's forms: on the engine words of Adminium 0.3.41 and the Forms
 * add-on 1.0.15.
 *
 * Changes `whole/manifest.json` and a few rows of `whole/seeds/meridian.json`,
 * checks `stage.json` (kept by hand), and writes `whole/seeds/meridian.forms.json`
 * whole. Finds everything by key or name,
 * asserts what it needs, and is idempotent: run twice, it changes nothing
 * more.
 *
 *   node scripts/surveys-whole.mjs
 *   npm run stage
 *
 * What it does:
 *  - a part "Surveys" that waits for Forms (the feature "customer-feedback"):
 *    on by default, off while Forms is not connected to the app, and holding
 *    what a survey brings: the rule and the way a survey's answer becomes a
 *    job's feedback;
 *  - `feedback` gains `from_survey` (yes: the row is a survey's answer, set
 *    by the forms entry's defaults; empty on an answer typed by hand), and
 *    `answered_on` is the day a survey's answer came in, stamped by the
 *    server on a stranger's write only, so an answer typed by hand keeps the
 *    day typed;
 *  - a forms entry on `feedback` (key `forms`, POST only): a survey's answer
 *    fills `score` (a Stars question) and `text` (a Long text); `job_id` is a
 *    link column, so the engine fills it from the invitation's record alone,
 *    never from a question or the body, and as the column is unique a second
 *    answer for one job is refused;
 *  - a rule, shipped off: a job signed off → 2 days → the Forms step "Send a
 *    survey": the survey whose web address ends `fit-out`, to the job's
 *    contact, as marketing mail. A job with no contact: the step fails by
 *    name and nothing is sent;
 *  - every role that reads the aftercare calls reads, of Forms' invitations,
 *    when a job's survey went and whether it was answered (no address, no
 *    name): the calls screen says "Survey sent";
 *  - the sample's forms (`sampleData.addOns.forms`): the showroom form, with
 *    an answer for each of the main sample's website enquiries that names a
 *    person (each answer names the enquiry it became, which gains the form's
 *    name, the brochure asked and the day that suits); the newsletter
 *    sign-up; a trade show form still a draft; the fit-out survey, with an
 *    invitation for every signed-off job and an answer for two of them, whose
 *    feedback in the main sample is marked as the survey's; and a closed
 *    showroom visit feedback form. Rows an answer became are the main
 *    sample's: an app's file for an add-on holds the add-on's tables only.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const STAGES = join(APP, "stage.json");
const FORMS_FILE = join(APP, "whole", "seeds", "meridian.forms.json");
const MAIN_SAMPLE = join(APP, "whole", "seeds", "meridian.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const stages = JSON.parse(readFileSync(STAGES, "utf8"));
const main = JSON.parse(readFileSync(MAIN_SAMPLE, "utf8"));

const fail = (message) => {
  throw new Error(`surveys-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);
const tables = must(manifest.requiredSchema?.tables, "requiredSchema.tables");
const table = (ref) => must(tables.find((one) => one.ref === ref), `table ${ref}`);
const column = (ref, name) => must(table(ref).columns.find((one) => one.ref === name), `column ${ref}.${name}`);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);
/** Eight languages, in the manifest's order, from one row of words. */
const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
const words = (...row) => {
  if (row.length !== LOCALES.length) fail(`"${row[0]}" is not in eight languages`);
  return Object.fromEntries(LOCALES.map((locale, i) => [locale, row[i]]));
};

// ── The part ────────────────────────────────────────────────────────────────
const PART = "surveys";
const FEATURE = "customer-feedback";
must((manifest.addOns.features ?? []).find((one) => one.id === FEATURE), `the feature ${FEATURE}`);
manifest.modules = manifest.modules.filter((one) => one.id !== PART);
manifest.modules.splice(manifest.modules.findIndex((one) => one.id === "aftercare") + 1, 0, {
  id: PART,
  label: words("Surveys", "Umfragen", "Enquêtes", "Undersøgelser", "Průzkumy", "الاستبيانات", "调查", "調查"),
  default: "on",
  feature: FEATURE,
});
// It comes with After the job, whose feedback it fills (`stage.json`, kept by hand: stage 2).
if (!stages.stages["2"].includes(PART)) fail(`stage.json: put "${PART}" in stage 2`);

// The CRM admin and Read-only are of every part.
for (const key of ["admin", "read-only"]) {
  const held = role(key);
  if (!held.modules.includes(PART)) held.modules.splice(held.modules.indexOf("aftercare") + 1, 0, PART);
}

// ── Feedback from a survey ──────────────────────────────────────────────────
const feedback = table("feedback");
if (!feedback.columns.some((one) => one.ref === "from_survey")) {
  feedback.columns.splice(feedback.columns.findIndex((one) => one.ref === "replied_at"), 0, {
    ref: "from_survey",
    type: "bool",
    nullable: true,
    label: words("From the survey", "Aus der Umfrage", "Issu de l’enquête", "Fra undersøgelsen", "Z průzkumu", "من الاستبيان", "来自调查", "來自調查"),
  });
}
// A survey's answer is dated the day it came in; a hand-typed one keeps the day typed.
column("feedback", "answered_on").rules = { stamp: { set: { byOrigin: { public: "today" } }, on: "create" } };
// Who adds an answer by hand writes the day it was given, and never says it came from a survey; a change touches neither.
{
  const manager = role("account-manager");
  manager.limits = { ...manager.limits, feedback: { creatable: ["job_id", "score", "text", "theme", "answered_on"], writable: ["score", "text", "theme", "replied_at", "fix_written"] } };
}

const ENTRY = {
  table: "feedback",
  key: "forms",
  module: PART,
  methods: ["POST"],
  writable: ["job_id", "score", "text"],
  defaults: { from_survey: true },
  anonymous: { perIpHour: 10 },
};
manifest.publicAccess = manifest.publicAccess.filter((one) => !(one.table === "feedback" && one.key === "forms"));
manifest.publicAccess.push(ENTRY);

// ── The rule, shipped off ───────────────────────────────────────────────────
const RULE_NAME = words(
  "A job is signed off: the fit-out survey 2 days later",
  "Ein Auftrag ist abgenommen: die Umfrage zur Einrichtung 2 Tage später",
  "Un chantier est réceptionné : l’enquête sur l’aménagement 2 jours plus tard",
  "En opgave er godkendt: undersøgelsen om indretningen 2 dage senere",
  "Zakázka je převzata: průzkum k vybavení o 2 dny později",
  "اعتُمد استلام عمل: استبيان التجهيز بعد يومين",
  "工单已验收：2 天后发送装修调查",
  "工單已驗收：2 天後寄出裝修調查",
);
const RULE_DESCRIPTION = words(
  "Two days after a job is signed off, sends the job's contact the survey whose web address ends in fit-out, with their own link, as marketing mail: only to people who may be e-mailed for surveys. Their answer becomes the job's customer feedback. A job with no contact, or no live survey of that address, sends nothing and says why.",
  "Zwei Tage nach der Abnahme eines Auftrags erhält der Kontakt des Auftrags die Umfrage, deren Webadresse auf fit-out endet, mit eigenem Link, als Werbe-E-Mail: nur an Personen, die für Umfragen angeschrieben werden dürfen. Die Antwort wird zum Kundenfeedback des Auftrags. Ohne Kontakt oder ohne veröffentlichte Umfrage unter dieser Adresse geht nichts hinaus, und der Grund wird genannt.",
  "Deux jours après la réception d’un chantier, envoie au contact du chantier l’enquête dont l’adresse web se termine par fit-out, avec son propre lien, en e-mail marketing : seulement aux personnes qui acceptent d’être contactées pour les enquêtes. Sa réponse devient l’avis client du chantier. Sans contact, ou sans enquête en ligne à cette adresse, rien ne part et la raison est indiquée.",
  "To dage efter at en opgave er godkendt, sendes undersøgelsen, hvis webadresse ender på fit-out, til opgavens kontakt med deres eget link som markedsføringsmail: kun til personer, der må få e-mails om undersøgelser. Svaret bliver opgavens kundefeedback. Uden kontakt, eller uden en undersøgelse online på den adresse, sendes intet, og årsagen vises.",
  "Dva dny po převzetí zakázky pošle kontaktu zakázky průzkum, jehož webová adresa končí na fit-out, s jeho vlastním odkazem, jako marketingový e-mail: jen lidem, kterým smíte psát kvůli průzkumům. Odpověď se stane zpětnou vazbou zákazníka k zakázce. Bez kontaktu nebo bez zveřejněného průzkumu na té adrese nic neodejde a důvod se uvede.",
  "بعد يومين من اعتماد استلام عمل، يُرسَل إلى جهة اتصال العمل الاستبيان الذي ينتهي عنوانه على الويب بـ fit-out، برابط خاص بها، كبريد تسويقي: فقط لمن يقبل رسائل الاستبيانات. تصبح إجابته رأي العميل في هذا العمل. إن لم توجد جهة اتصال، أو لا يوجد استبيان منشور بهذا العنوان، لا يُرسَل شيء ويُذكر السبب.",
  "工单验收两天后，以营销邮件把网址以 fit-out 结尾的调查发送给工单的联系人，并附上其专属链接：只发给同意接收调查邮件的人。其回答会成为该工单的客户反馈。工单没有联系人，或该网址下没有已上线的调查时，不发送，并说明原因。",
  "工單驗收兩天後，以行銷郵件把網址以 fit-out 結尾的調查寄給工單的聯絡人，並附上其專屬連結：只寄給同意接收調查郵件的人。其回答會成為該工單的客戶回饋。工單沒有聯絡人，或該網址下沒有已上線的調查時，不寄出，並說明原因。",
);
for (const [locale, text] of Object.entries(RULE_DESCRIPTION)) if (text.length > 500) fail(`the rule's description in ${locale} is ${String(text.length)} characters, over 500`);
for (const [locale, text] of Object.entries(RULE_NAME)) if (text.length > 120) fail(`the rule's name in ${locale} is ${String(text.length)} characters, over 120`);

export const SURVEY_SLUG = "fit-out";
const rule = {
  key: "survey-after-sign-off",
  name: RULE_NAME,
  description: RULE_DESCRIPTION,
  enabled: false,
  module: PART,
  trigger: { kind: "record", event: "updated", table: "jobs", changedColumn: "state", when: [{ left: { field: "state" }, op: "is", right: "signed-off" }] },
  graph: {
    version: 1,
    nodes: [
      { id: "t", kind: "trigger", title: "A job is signed off" },
      { id: "wait", kind: "wait", title: "Wait 2 days", amount: 2, unit: "days" },
      { id: "still", kind: "condition", title: "Still signed off", condition: { left: { field: "state" }, op: "is", right: "signed-off" } },
      {
        id: "send",
        kind: "action",
        title: "Send the fit-out survey to the job's contact",
        action: { kind: "add-on.step", addOn: "forms", step: "send-survey", inputs: { survey: SURVEY_SLUG, to: "@link:contact_id", class: "marketing" } },
      },
    ],
  },
};
manifest.automations = manifest.automations.filter((one) => one.key !== rule.key);
manifest.automations.push(rule);

// ── "Survey sent" on the aftercare call ─────────────────────────────────────
// What each reader of the calls sees of a job's invitation: when it went, when it was answered. Never who it went to.
const INVITATION_READ = ["id", "form_id", "record_table", "record_key", "class", "invited_at", "answered_at", "expires_at"];
const CALL_READERS = ["admin", "sales-manager", "rep", "account-manager", "read-only"];
for (const key of CALL_READERS) {
  const held = role(key);
  must(held.permissions.includes("table:@follow_ups:read") && held.permissions.includes("table:@jobs:read") ? true : undefined, `${key} reads the aftercare calls`);
  held.tables = (held.tables ?? []).filter((grant) => !(grant.addOn === "forms" && grant.table === "invitations"));
  held.tables.push({ addOn: "forms", table: "invitations", actions: ["read"], limit: { readable: INVITATION_READ } });
}
// A stage cut before Surveys takes the grant away with the part (`stage.json`, kept by hand).
for (const key of CALL_READERS) {
  if (!(stages.grants ?? []).some((one) => one.part === PART && one.role === key && one.tables?.includes("forms/invitations"))) fail(`stage.json: give ${key} forms/invitations with "${PART}"`);
}

// ── The sample's forms ──────────────────────────────────────────────────────
manifest.sampleData.addOns = { ...manifest.sampleData.addOns, forms: { file: "seeds/meridian.forms.json" } };

const T = Object.fromEntries(main.tables.map((one) => [one.ref, one.rows]));
const byLabel = (ref, label) => must(T[ref].find((row) => row["@label"] === label), `the sample's ${label}`);
const en = (en, de) => ({ "en-US": en, "de-DE": de });
const BILINGUAL = ["en-US", "de-DE"];

/** The showroom form: what a visitor asks of a visit, every question a column of an enquiry. */
const SHOWROOM_CHOICES = [
  ["booths", "Acoustic booths", "Akustikkabinen"],
  ["desks", "Sit-stand desks", "Sitz-Steh-Tische"],
  ["seating", "Task seating", "Bürostühle"],
  ["tables", "Meeting tables", "Besprechungstische"],
  ["storage", "Storage and lockers", "Stauraum und Schließfächer"],
];
const NEWS_TICK = (id) => ({
  id,
  kind: "tick",
  purpose: "newsletter",
  label: en("Send me Meridian's newsletter, about once a month. I can say no at any time.", "Schicken Sie mir den Newsletter von Meridian, etwa einmal im Monat. Ich kann jederzeit Nein sagen."),
  wordingVersion: 1,
  wordingChangedAt: "2026-09-01",
  confirm: true,
});
const showroom = {
  v: 1,
  kind: "form",
  languages: BILINGUAL,
  defaultLanguage: "en-US",
  title: en("Book a showroom visit", "Ausstellungsbesuch buchen"),
  intro: en("Come and sit in the chairs, try the booths and bring your drawings. Tell us when, and we will have it ready.", "Probieren Sie Stühle und Kabinen aus und bringen Sie Ihren Grundriss mit. Sagen Sie uns, wann, und wir bereiten alles vor."),
  questions: [
    { id: "qname", kind: "short", role: "name", required: true, label: en("Your name", "Ihr Name") },
    { id: "qemail", kind: "short", check: "email", role: "email", required: true, label: en("Work e-mail", "Geschäftliche E-Mail") },
    { id: "qcompany", kind: "short", role: "company", required: true, label: en("Company", "Firma") },
    { id: "qday", kind: "date", from: "tomorrow", label: en("Which day suits you?", "Welcher Tag passt Ihnen?") },
    { id: "qsee", kind: "several", label: en("What would you like to see?", "Was möchten Sie sehen?"), choices: SHOWROOM_CHOICES.map(([id, e, d]) => ({ id, label: en(e, d) })) },
    {
      id: "qbrochure",
      kind: "one",
      label: en("Send me the brochure", "Schicken Sie mir die Broschüre"),
      choices: [
        { id: "yes", label: en("Yes, please", "Ja, bitte") },
        { id: "no", label: en("No, thank you", "Nein, danke") },
      ],
    },
    { id: "qdrawings", kind: "file", maxMb: 10, kinds: ["pdf", "jpg", "png"], many: true, label: en("Floor plans or drawings", "Grundrisse oder Zeichnungen") },
    { id: "qnote", kind: "long", label: en("Anything else we should know?", "Sollen wir noch etwas wissen?") },
    NEWS_TICK("qnews"),
  ],
  ending: { kind: "words", words: en("Thank you. We will be in touch within a working day.", "Vielen Dank. Wir melden uns innerhalb eines Werktags.") },
};
const newsletter = {
  v: 1,
  kind: "form",
  languages: BILINGUAL,
  defaultLanguage: "en-US",
  title: en("Newsletter sign-up", "Newsletter-Anmeldung"),
  intro: en("New pieces in the showroom, open days and the odd floor we are proud of. About once a month.", "Neue Stücke im Ausstellungsraum, Tage der offenen Tür und ab und zu eine Etage, auf die wir stolz sind. Etwa einmal im Monat."),
  questions: [
    { id: "qname", kind: "short", role: "name", label: en("Your name", "Ihr Name") },
    { id: "qemail", kind: "short", check: "email", role: "email", required: true, label: en("E-mail", "E-Mail") },
    NEWS_TICK("qnews"),
  ],
  ending: { kind: "words", words: en("Thank you. Please click the link in the e-mail we just sent.", "Vielen Dank. Bitte klicken Sie auf den Link in der E-Mail, die wir gerade geschickt haben.") },
};
const tradeShow = {
  v: 1,
  kind: "form",
  languages: BILINGUAL,
  defaultLanguage: "en-US",
  title: en("Trade show enquiry", "Messeanfrage"),
  questions: [
    { id: "qname", kind: "short", role: "name", required: true, label: en("Your name", "Ihr Name") },
    { id: "qemail", kind: "short", check: "email", role: "email", required: true, label: en("Work e-mail", "Geschäftliche E-Mail") },
    { id: "qcompany", kind: "short", role: "company", label: en("Company", "Firma") },
    { id: "qsee", kind: "several", label: en("What caught your eye on the stand?", "Was ist Ihnen am Stand aufgefallen?"), choices: SHOWROOM_CHOICES.map(([id, e, d]) => ({ id, label: en(e, d) })) },
    { id: "qnote", kind: "long", label: en("What are you working on?", "Woran arbeiten Sie gerade?") },
  ],
  ending: { kind: "words", words: en("Thank you for stopping by. We will write after the show.", "Danke für Ihren Besuch. Wir schreiben Ihnen nach der Messe.") },
};
const fitOut = {
  v: 1,
  kind: "survey",
  languages: BILINGUAL,
  defaultLanguage: "en-US",
  title: en("How did your fit-out go?", "Wie lief Ihre Einrichtung?"),
  intro: en("Three questions, two minutes. Your answer goes straight to the team that did the work.", "Drei Fragen, zwei Minuten. Ihre Antwort geht direkt an das Team, das die Arbeit gemacht hat."),
  questions: [
    { id: "qrecommend", kind: "score", recommend: true, required: true, label: en("How likely are you to recommend Meridian to a colleague?", "Wie wahrscheinlich ist es, dass Sie Meridian weiterempfehlen?") },
    { id: "qstars", kind: "stars", required: true, label: en("How would you rate the fit-out overall?", "Wie bewerten Sie die Einrichtung insgesamt?") },
    { id: "qsaid", kind: "long", label: en("What should we keep doing, or do better?", "Was sollen wir beibehalten oder besser machen?") },
  ],
  ending: { kind: "words", words: en("Thank you. We read every answer.", "Vielen Dank. Wir lesen jede Antwort.") },
};
const visitFeedback = {
  v: 1,
  kind: "form",
  languages: BILINGUAL,
  defaultLanguage: "en-US",
  title: en("Showroom visit feedback", "Feedback zum Ausstellungsbesuch"),
  questions: [
    { id: "qstars", kind: "stars", required: true, label: en("How was your visit?", "Wie war Ihr Besuch?") },
    { id: "qsaid", kind: "long", label: en("Anything we could have done better?", "Was hätten wir besser machen können?") },
  ],
  ending: { kind: "words", words: en("Thank you for coming in.", "Danke für Ihren Besuch.") },
};

const LIMITS = { perHour: 200, harder: false };
/*
 * Who a sample form tells is a role: an app's rows for an add-on name no sample person (Dana, Tessa), so the
 * showroom form tells the sales managers and the survey's low scores the CRM admins.
 *
 * No sample form says what its answers become: `becomes.table` is a table's id in this database's own
 * listing (`main.crm_enquiries` on SQLite, another on Postgres and MySQL), and a sample file can name a
 * table only by its stored ref, and only in a column that holds one. The rows the answers became are
 * here all the same, and each answer names its row.
 */
const settings = {
  showroom: { becomes: null, tell: [{ kind: "role", id: "crm-sales-manager" }], limits: LIMITS },
  newsletter: { becomes: null, tell: [], limits: LIMITS },
  tradeShow: { becomes: null, tell: [{ kind: "role", id: "crm-sales-manager" }], limits: LIMITS },
  fitOut: { becomes: null, tell: [{ kind: "role", id: "crm-admin" }], tellWhen: { question: "qrecommend", atMost: 6 }, limits: LIMITS, survey: { mode: "named", linkNames: true, stopAfterDays: 30 } },
  visitFeedback: { becomes: null, tell: [], limits: LIMITS },
};

const NAMES = {
  showroom: words("Book a showroom visit", "Ausstellungsbesuch buchen", "Réserver une visite du showroom", "Book et besøg i showroomet", "Rezervace návštěvy showroomu", "حجز زيارة لصالة العرض", "预约参观展厅", "預約參觀展廳"),
  newsletter: words("Newsletter sign-up", "Newsletter-Anmeldung", "Inscription à la newsletter", "Tilmelding til nyhedsbrev", "Přihlášení k odběru novinek", "الاشتراك في النشرة الإخبارية", "订阅新闻简报", "訂閱電子報"),
  tradeShow: words("Trade show enquiry", "Messeanfrage", "Demande au salon", "Henvendelse fra messen", "Poptávka z veletrhu", "استفسار من المعرض التجاري", "展会询盘", "展會詢問"),
  fitOut: words("How did your fit-out go?", "Wie lief Ihre Einrichtung?", "Comment s’est passé votre aménagement ?", "Hvordan gik jeres indretning?", "Jak proběhlo vaše vybavení?", "كيف سار تجهيز مكتبك؟", "您的装修进展如何？", "您的裝修進行得如何？"),
  visitFeedback: words("Showroom visit feedback", "Feedback zum Ausstellungsbesuch", "Avis sur la visite du showroom", "Feedback på besøget i showroomet", "Hodnocení návštěvy showroomu", "رأيك في زيارة صالة العرض", "展厅参观反馈", "展廳參觀回饋"),
};
const t8 = (row) => ({ "@t": row });
/** A row's key, the same every run: Forms' keys are text that nothing on the server makes for a sample row. */
const keyOf = (label) => {
  const hex = createHash("sha256").update(`crm-sample:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const formRow = (label, key, slug, kind, state, definition, opened, updated, closed) => ({
  "@label": label,
  id: keyOf(label),
  name: t8(NAMES[key]),
  slug,
  kind,
  state,
  definition,
  settings: settings[key],
  ...(state === "draft" ? {} : { published: { definition, settings: settings[key] }, published_at: { "@day": opened, "@time": "09:00" } }),
  ...(closed === undefined ? {} : { closed_at: { "@day": closed, "@time": "17:30" } }),
  updated_at: { "@day": updated, "@time": "09:00" },
});
const forms = [
  formRow("form:showroom", "showroom", "showroom", "form", "live", showroom, -60, -60),
  formRow("form:newsletter", "newsletter", "newsletter", "form", "live", newsletter, -90, -90),
  formRow("form:trade-show", "tradeShow", "trade-show", "form", "draft", tradeShow, -6, -6),
  formRow("form:fit-out", "fitOut", SURVEY_SLUG, "survey", "live", fitOut, -260, -260),
  formRow("form:visit-feedback", "visitFeedback", "showroom-feedback", "form", "closed", visitFeedback, -200, -120, -120),
];

// ── The showroom form's answers, and the enquiries they made ────────────────
/*
 * An app's rows for an add-on hold only the add-on's tables, and an own table that links into it (`rules.addOnLink`):
 * the rows an answer became are the app's own sample's. So the showroom form's answers are the main sample's own
 * enquiries from a website form that name a person, and the answers name them (each answer, the row it became).
 */
const SHOWROOM_ANSWERED = [
  // The enquiry (by its person), its label, the brochure asked, the day that suits them (days after it came), the note's choices.
  ["Ines Vaughan", "enq:ines", "yes", 5, ["desks"]],
  ["Hannah Doyle", "enq:hannah", "yes", 3, ["seating"]],
  ["Priti Shah", "enq:priti", "no", 4, ["seating", "tables"]],
];
const SOURCE = "Showroom form";
const showroomAnswers = [];
for (const [person, label, brochure, wantedIn, see] of SHOWROOM_ANSWERED) {
  const row = must(T.enquiries.find((one) => one.person === person && one.source === "form"), `the sample's enquiry from ${person}`);
  // What the form brought to the enquiry: its name, the brochure asked, the day that suits them.
  Object.assign(row, { "@label": label, from_form: SOURCE, brochure, wanted_on: { ...row.received_at, "@day": row.received_at["@day"] + wantedIn, "@time": undefined } });
  delete row.wanted_on["@time"];
  const text = typeof row.text === "object" ? row.text["@t"]["en-US"] : row.text;
  showroomAnswers.push({
    form_id: { "@ref": "form:showroom" },
    submitted_at: row.received_at,
    language: "en-US",
    values: { qname: person, qemail: row.email, qcompany: row.company_name, qsee: see, qbrochure: brochure, ...(text === undefined ? {} : { qnote: text }), qnews: false },
    email: row.email,
    name: person,
    became_table: { "@table": "enquiries" },
    became_key: { "@ref": label },
    confirm: "none",
  });
}

// ── The newsletter's own answers: kept, nothing made of them ────────────────
const SIGNUPS = [
  [-80, "en-US", "Rosa Kemp", "rosa.kemp@mailbox.example", "confirmed"],
  [-71, "en-US", "Will Archer", "will.archer@mailbox.example", "confirmed"],
  [-66, "de-DE", "Anna Seidel", "anna.seidel@postfach.example", "confirmed"],
  [-52, "en-US", "Joe Finn", "joe.finn@mailbox.example", "expired"],
  [-44, "en-US", "Mei Lin", "mei.lin@mailbox.example", "confirmed"],
  [-30, "de-DE", "Paul Richter", "paul.richter@postfach.example", "confirmed"],
  [-18, "en-US", "Zara Hussain", "zara.hussain@mailbox.example", "confirmed"],
  [-8, "en-US", "Ben Cole", "ben.cole@mailbox.example", "confirmed"],
  [-3, "en-US", "Lily Ward", "lily.ward@mailbox.example", "confirmed"],
  [0, "de-DE", "Jonas Peters", "jonas.peters@postfach.example", "pending"],
];
const newsletterAnswers = SIGNUPS.map(([day, language, name, email, confirm]) => ({
  form_id: { "@ref": "form:newsletter" },
  submitted_at: { "@day": day, "@time": "12:00" },
  language,
  values: { qname: name, qemail: email, qnews: true },
  email,
  name,
  confirm,
  consent_purpose: "newsletter",
  consent_wording: newsletter.questions.at(-1).label[language],
  consent_version: 1,
}));

// ── The closed visit feedback form: anonymous answers, kept ────────────────
const VISIT_SAID = [
  [-190, "en-US", 5, "Coffee was good and nobody rushed us."],
  [-176, "en-US", 4, "Would have liked to see the booths with the doors shut."],
  [-161, "de-DE", 5, "Sehr gute Beratung."],
  [-150, "en-US", 3, "Parking was hard to find."],
  [-138, "en-US", 5, ""],
  [-125, "en-US", 4, "Bring more fabric samples to the table."],
];
const visitAnswers = VISIT_SAID.map(([day, language, stars, said]) => ({
  form_id: { "@ref": "form:visit-feedback" },
  submitted_at: { "@day": day, "@time": "15:30" },
  language,
  values: { qstars: stars, ...(said === "" ? {} : { qsaid: said }) },
  confirm: "none",
}));

// ── The fit-out survey: an invitation for every signed-off job ──────────────
// A job is signed off 28 days before its aftercare call (the sample's own follow-ups), and invited two days after.
const SIGNED = ["job:w1", "job:w2", "job:w3", "job:h3", "job:h2", "job:h1", "job:h4"];
// The contacts who answered: their answer is the job's feedback the main sample holds, marked as the survey's.
const SURVEY_SAID = { "job:w1": { recommend: 8, label: "fb:w1" }, "job:h4": { recommend: 10, label: "fb:h4" } };
const deals = Object.fromEntries(T.deals.map((row) => [row["@label"], row]));
const contacts = Object.fromEntries(T.contacts.map((row) => [row["@label"], row]));
const companies = Object.fromEntries(T.companies.map((row) => [row["@label"], row]));
const invitations = [];
const surveyAnswers = [];
for (const job of SIGNED) {
  const jobRow = byLabel("jobs", job);
  if (jobRow.state !== "signed-off") fail(`${job} is not signed off in the sample`);
  const call = must(T.follow_ups.find((one) => one.job_id?.["@ref"] === job && one.due_at?.["@week"] === true), `${job}'s aftercare call`);
  const sent = call.due_at["@day"] - 26;
  const deal = must(deals[jobRow.deal_id["@ref"]], `${job}'s deal`);
  const contact = must(contacts[deal.contact_id?.["@ref"]], `${job}'s contact`);
  const company = must(companies[contact.company_id["@ref"]], `${job}'s company`);
  const said = SURVEY_SAID[job];
  const feedback = said === undefined ? undefined : must(T.feedback.find((one) => one.job_id["@ref"] === job), `${job}'s feedback`);
  const label = `inv:${job.slice(4)}`;
  invitations.push({
    "@label": label,
    id: keyOf(label),
    form_id: { "@ref": "form:fit-out" },
    email: contact.email,
    name: contact.name,
    language: "en-US",
    // The contacts' table as other rows name it: the column holds no `rules.tableRef`, so `@table` cannot fill it.
    person_table: "crm:contacts",
    person_key: { "@ref": contact["@label"] },
    record_table: { "@table": "jobs" },
    record_key: { "@ref": job },
    class: "marketing",
    invited_at: { "@day": sent, "@time": "09:00", "@week": true },
    ...(feedback === undefined ? {} : { answered_at: { ...feedback.answered_on, "@time": "19:20" } }),
    expires_at: { "@day": sent + 30, "@time": "09:00", "@week": true },
    about: `${jobRow.code} · ${typeof jobRow.site_name === "string" ? jobRow.site_name : company.name}`,
    company: company.name,
    rule_name: RULE_NAME["en-US"],
  });
  if (feedback === undefined) continue;
  if (feedback.answered_on["@day"] < sent) fail(`${job}'s feedback is older than its invitation`);
  Object.assign(feedback, { "@label": said.label, from_survey: true });
  const text = feedback.text["@t"]["en-US"];
  surveyAnswers.push({
    form_id: { "@ref": "form:fit-out" },
    submitted_at: { ...feedback.answered_on, "@time": "19:20" },
    language: "en-US",
    values: { qrecommend: said.recommend, qstars: feedback.score, qsaid: text },
    email: contact.email,
    name: contact.name,
    became_table: { "@table": "feedback" },
    became_key: { "@ref": said.label },
    invitation_id: { "@ref": label },
    confirm: "none",
  });
}

const file = {
  format: "adminium.sample/1",
  app: "crm",
  addOn: "forms",
  weekAnchor: main.weekAnchor,
  tables: [
    { ref: "forms", rows: forms },
    { ref: "invitations", rows: invitations },
    { ref: "answers", rows: [...showroomAnswers, ...newsletterAnswers, ...visitAnswers, ...surveyAnswers].map((row, i) => ({ id: keyOf(`answer:${String(i + 1)}`), ...row })) },
  ],
};

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(FORMS_FILE, `${JSON.stringify(file, null, 1)}\n`);
writeFileSync(MAIN_SAMPLE, `${JSON.stringify(main, null, 1)}\n`);
console.log("surveys-whole: whole/manifest.json, whole/seeds/meridian.json and whole/seeds/meridian.forms.json written");
