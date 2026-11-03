#!/usr/bin/env node
/**
 * Website forms make enquiries, the brochure an enquirer asks for, and the
 * Forms add-on suggested: on the engine words of Adminium 0.3.41.
 *
 * Changes `whole/manifest.json` and the sample's settings row only. Finds
 * everything by key or name, asserts what it needs, and is idempotent: run
 * twice, it changes nothing more.
 *
 *   node scripts/forms-and-brochure-whole.mjs
 *   npm run stage
 *
 * What it does:
 *  - the floor moves to 0.3.41: the first Adminium that reads a forms entry's
 *    `source` (0.3.40 reads the entry itself);
 *  - `enquiries` gains what a form brings: `from_form` (the form's fixed
 *    "Source" value, its name unless the owner words it otherwise),
 *    `brochure` (yes or no: the enquirer asked for the brochure), `wanted_on`
 *    (the day that suits them), and `brochure_link` (the link the brochure
 *    went out with, copied from Settings by the brochure rule: empty, nothing
 *    went);
 *  - a forms entry on `enquiries` (key `forms`, which no browser key ever
 *    has): a form's answer may become an enquiry through it, filling only its
 *    `writable` columns. It belongs to the Inbox part, so switching the part
 *    off closes the way in. Its state and source are its `defaults`; the
 *    moment it came in is the column's own stamp; nobody's name, no deal, no
 *    company match and no link column is a form's to fill. Nor is the opt-out
 *    mark: it records that staff offered a way to say no where they took an
 *    address, and a stranger filling in a form was asked by the form's own tick
 *    instead, so `opt_out_offered_at` is not in the entry (its stamp fires
 *    only on a staff save that showed the line);
 *  - the staff who write an enquiry's details may write `wanted_on`; nobody
 *    on the staff writes `from_form`, `brochure` or `brochure_link` (where it
 *    came from and what it asked are the form's, what went is the rule's);
 *  - the brochure: two settings (the link, and who gets a brochure follow-up
 *    while the enquiry is unclaimed; the sample names the sales manager), the
 *    outbox's link to an enquiry and its address as the fallback recipient, a
 *    kind `brochure` (service: the enquirer asked for it) with its template,
 *    and a rule, shipped off: an enquiry that asked → the link copied from
 *    Settings → the brochure, when there is a link → 2 days → still no deal
 *    and not set aside → a follow-up to call them the next day at 09:00, for
 *    whoever claimed it, else for the person Settings names;
 *  - Forms (1.0.15 or newer) suggested and ticked, with the two things it
 *    brings: web enquiries and customer feedback.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const SAMPLE = join(APP, "whole", "seeds", "meridian.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const sample = JSON.parse(readFileSync(SAMPLE, "utf8"));

const fail = (message) => {
  throw new Error(`forms-and-brochure-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);
const tables = must(manifest.requiredSchema?.tables, "requiredSchema.tables");
const table = (ref) => must(tables.find((one) => one.ref === ref), `table ${ref}`);
const column = (ref, name) => must(table(ref).columns.find((one) => one.ref === name), `column ${ref}.${name}`);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);
/** A column added once, before `before`. */
const addColumn = (ref, made, before) => {
  const t = table(ref);
  if (t.columns.some((one) => one.ref === made.ref)) return;
  const at = t.columns.findIndex((one) => one.ref === before);
  if (at === -1) fail(`${ref}.${before} is not there`);
  t.columns.splice(at, 0, made);
};
/** Eight languages, in the manifest's order, from one row of words. */
const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
const words = (...row) => {
  if (row.length !== LOCALES.length) fail(`"${row[0]}" is not in eight languages`);
  return Object.fromEntries(LOCALES.map((locale, i) => [locale, row[i]]));
};

// ── The floor ───────────────────────────────────────────────────────────────
manifest.compatibility.minAdminiumVersion = "0.3.41";

// ── What a form brings to an enquiry ────────────────────────────────────────
addColumn(
  "enquiries",
  {
    ref: "from_form",
    type: "text",
    maxLength: 200,
    nullable: true,
    label: words("From the form", "Aus dem Formular", "Depuis le formulaire", "Fra formularen", "Z formuláře", "من النموذج", "来自表单", "來自表單"),
  },
  "opt_out_offered_at",
);
addColumn(
  "enquiries",
  {
    ref: "brochure",
    type: "enum",
    enum: ["yes", "no"],
    nullable: true,
    rules: {
      enumLabels: {
        labels: {
          yes: words("Yes", "Ja", "Oui", "Ja", "Ano", "نعم", "是", "是"),
          no: words("No", "Nein", "Non", "Nej", "Ne", "لا", "否", "否"),
        },
      },
    },
    label: words("Asked for the brochure", "Broschüre angefragt", "Brochure demandée", "Bad om brochuren", "Žádá o brožuru", "طلب الكتيّب", "索取宣传册", "索取宣傳冊"),
  },
  "opt_out_offered_at",
);
addColumn(
  "enquiries",
  {
    ref: "wanted_on",
    type: "date",
    nullable: true,
    label: words("Wanted on", "Gewünscht am", "Souhaité le", "Ønsket den", "Požadováno na", "التاريخ المطلوب", "期望日期", "期望日期"),
  },
  "opt_out_offered_at",
);
addColumn(
  "enquiries",
  {
    ref: "brochure_link",
    type: "text",
    maxLength: 500,
    nullable: true,
    label: words("Brochure link sent", "Gesendeter Broschüren-Link", "Lien de la brochure envoyé", "Sendt brochurelink", "Odeslaný odkaz na brožuru", "رابط الكتيّب المُرسَل", "已发送的宣传册链接", "已寄出的宣傳冊連結"),
  },
  "opt_out_offered_at",
);

// Who on the staff writes the day that suits them: whoever writes an enquiry's details. Nobody writes the other three.
const addTo = (list, ref, after) => {
  if (list.includes(ref)) return;
  const at = list.indexOf(after);
  if (at === -1) fail(`"${after}" is not in the list ${ref} goes into`);
  list.splice(at + 1, 0, ref);
};
for (const key of ["rep", "sales-manager", "front-desk"]) addTo(must(role(key).limits?.enquiries?.writable, `${key}'s enquiry writable`), "wanted_on", "wants");
for (const key of ["marketer", "front-desk"]) addTo(must(role(key).limits?.enquiries?.creatable, `${key}'s enquiry creatable`), "wanted_on", "wants");

// ── The forms entry ─────────────────────────────────────────────────────────
const FORM_WRITES = ["person", "company_name", "email", "phone", "text", "town", "wants", "wanted_on", "brochure", "from_form"];
const entry = {
  table: "enquiries",
  key: "forms",
  module: "inbox",
  methods: ["POST"],
  writable: FORM_WRITES,
  requires: ["company_name"],
  defaults: { state: "open", source: "form" },
  source: "from_form",
  anonymous: {
    perValue: { columns: ["email"], n: 5 },
    plainText: [
      { column: "person", max: 120 },
      { column: "company_name", digits: 4, max: 160 },
    ],
  },
};
manifest.publicAccess = must(manifest.publicAccess, "publicAccess").filter((one) => !(one.table === "enquiries" && one.key === "forms"));
manifest.publicAccess.push(entry);

// ── The brochure's settings ─────────────────────────────────────────────────
addColumn(
  "settings",
  {
    ref: "brochure_link",
    type: "text",
    maxLength: 500,
    nullable: true,
    rules: { validation: { format: "url" } },
    label: words("Brochure link", "Link zur Broschüre", "Lien de la brochure", "Link til brochuren", "Odkaz na brožuru", "رابط الكتيّب", "宣传册链接", "宣傳冊連結"),
  },
  "office_phone",
);
addColumn(
  "settings",
  {
    ref: "brochure_follow_up_owner_id",
    type: "text",
    maxLength: 36,
    nullable: true,
    rules: { staff: true },
    label: words(
      "Brochure follow-ups go to",
      "Nachfassen zur Broschüre geht an",
      "Relances de brochure confiées à",
      "Opfølgning på brochurer går til",
      "Navazující kroky k brožuře dostane",
      "متابعات الكتيّب تذهب إلى",
      "宣传册跟进交给",
      "宣傳冊跟進交給",
    ),
  },
  "office_phone",
);
const settings = must(sample.tables.find((one) => one.ref === "settings")?.rows?.[0], "the sample's settings row");
settings.brochure_link ??= "https://meridian.example/brochure";
settings.brochure_follow_up_owner_id ??= { "@person": "ivy" };

// ── The brochure's e-mail ───────────────────────────────────────────────────
const outbox = manifest.outbox;
const box = table(outbox.table);
addColumn(outbox.table, { ref: "enquiry_id", type: "fk", references: "enquiries", nullable: true, label: { ...table("enquiries").label } }, "subcontractor_id");
// After the column it was added before: the new link last, beside the other links.
{
  const at = box.columns.findIndex((one) => one.ref === "enquiry_id");
  const last = box.columns.findIndex((one) => one.ref === "subcontractor_id");
  if (at < last) box.columns.splice(last, 0, ...box.columns.splice(at, 1));
}
// No index of its own: the outbox has the six a table may take, and a brochure's messages are found by kind.
outbox.links.enquiry = "enquiry_id";
// A message about an enquiry goes to the enquiry's own address, as no contact is named on it.
outbox.recipient.fallback = { via: "enquiry_id", email: "email", name: "person" };
const kind = column(outbox.table, outbox.columns.kind);
if (!kind.enum.includes("brochure")) kind.enum.push("brochure");
kind.rules.enumLabels.labels.brochure = words("Brochure", "Broschüre", "Brochure", "Brochure", "Brožura", "الكتيّب", "宣传册", "宣傳冊");
outbox.kinds.brochure = "crm-brochure";
outbox.classes.brochure = "service";

const MAIL = {
  "en-US": ["Our brochure", "Thank you for asking for our brochure. You can read it at the link below. We will be in touch soon.", "Open the brochure", "You got this because you asked for our brochure."],
  "de-DE": ["Unsere Broschüre", "Vielen Dank, dass Sie unsere Broschüre angefordert haben. Sie finden sie unter dem Link unten. Wir melden uns bald bei Ihnen.", "Broschüre öffnen", "Sie erhalten diese E-Mail, weil Sie unsere Broschüre angefordert haben."],
  "fr-FR": ["Notre brochure", "Merci d’avoir demandé notre brochure. Vous pouvez la lire grâce au lien ci-dessous. Nous reviendrons vers vous très bientôt.", "Ouvrir la brochure", "Vous recevez ce message parce que vous avez demandé notre brochure."],
  "da-DK": ["Vores brochure", "Tak, fordi du bad om vores brochure. Du kan læse den via linket nedenfor. Vi kontakter dig snart.", "Åbn brochuren", "Du får denne e-mail, fordi du bad om vores brochure."],
  "cs-CZ": ["Naše brožura", "Děkujeme, že jste si vyžádali naši brožuru. Najdete ji na odkazu níže. Brzy se vám ozveme.", "Otevřít brožuru", "Tento e-mail jste dostali, protože jste si vyžádali naši brožuru."],
  "ar-EG": ["كتيّبنا", "شكرًا لطلبك كتيّبنا. يمكنك قراءته من الرابط أدناه. سنتواصل معك قريبًا.", "افتح الكتيّب", "وصلتك هذه الرسالة لأنك طلبت كتيّبنا."],
  "zh-CN": ["我们的宣传册", "感谢您索取我们的宣传册。您可以通过下方链接阅读。我们会尽快与您联系。", "打开宣传册", "您收到这封邮件，是因为您索取了我们的宣传册。"],
  "zh-TW": ["我們的宣傳冊", "感謝您索取我們的宣傳冊。您可以透過下方連結閱讀。我們會盡快與您聯絡。", "開啟宣傳冊", "您收到這封郵件，是因為您索取了我們的宣傳冊。"],
};
const template = {
  key: "crm-brochure",
  name: "Our brochure",
  vars: ["enquiry.brochure_link"],
  locales: Object.fromEntries(
    LOCALES.map((locale) => {
      const [subject, text, label, footer] = must(MAIL[locale], `the brochure mail in ${locale}`);
      return [
        locale,
        {
          subject,
          blocks: [
            { block: "email.heading", data: { text: subject } },
            { block: "email.text", data: { text } },
            { block: "email.button", data: { label, url: "{{enquiry.brochure_link}}" } },
          ],
          footer,
        },
      ];
    }),
  ),
};
manifest.emailTemplates = manifest.emailTemplates.filter((one) => one.key !== template.key);
manifest.emailTemplates.push(template);

// ── The brochure's rule, shipped off ────────────────────────────────────────
const RULE_NAME = words(
  "An enquiry asks for the brochure: send it, then a follow-up after 2 days",
  "Eine Anfrage bittet um die Broschüre: senden, nach 2 Tagen nachfassen",
  "Une demande réclame la brochure : l’envoyer, puis une relance 2 jours plus tard",
  "En henvendelse beder om brochuren: send den, og en opfølgning efter 2 dage",
  "Poptávka žádá o brožuru: odeslat ji a po 2 dnech navazující krok",
  "استفسار يطلب الكتيّب: أرسله، ثم متابعة بعد يومين",
  "询盘索取宣传册：发送宣传册，2 天后跟进",
  "詢問索取宣傳冊：寄出宣傳冊，2 天後跟進",
);
const RULE_DESCRIPTION = words(
  "When an enquiry comes in that asked for the brochure, e-mails it the brochure link set in Settings (nothing goes while no link is set). Two days later, if no deal was made of it and it was not set aside, a follow-up to call them, due the next day at 09:00: for whoever claimed it, else for the person Settings names for brochure follow-ups.",
  "Geht eine Anfrage ein, die um die Broschüre bittet, schickt sie per E-Mail den Broschüren-Link aus den Einstellungen (ohne Link geht nichts hinaus). Ist zwei Tage später kein Deal daraus entstanden und wurde sie nicht abgelegt, ein Follow-up zum Anrufen, fällig am nächsten Tag um 09:00: für die Person, die sie übernommen hat, sonst für die Person, die die Einstellungen für das Nachfassen zur Broschüre nennen.",
  "Quand arrive une demande qui réclame la brochure, lui envoie par e-mail le lien de la brochure indiqué dans les Réglages (rien ne part tant qu’aucun lien n’est indiqué). Deux jours plus tard, si aucune affaire n’en est née et qu’elle n’a pas été écartée, une relance pour appeler, due le lendemain à 09:00 : pour qui l’a prise en charge, sinon pour la personne que les Réglages désignent pour les relances de brochure.",
  "Når der kommer en henvendelse, der beder om brochuren, sendes linket til brochuren fra Indstillinger pr. e-mail (intet sendes, så længe der ikke er et link). Er der to dage senere ikke lavet en deal ud af den, og er den ikke lagt til side, en opfølgning om at ringe, med forfald dagen efter kl. 09:00: til den, der overtog den, ellers til den person, Indstillinger udpeger til opfølgning på brochurer.",
  "Když přijde poptávka, která žádá o brožuru, pošle jí e-mailem odkaz na brožuru z Nastavení (dokud odkaz není nastaven, nic neodejde). Pokud z ní po dvou dnech nevznikl obchod a nebyla odložena, navazující krok zavolat s termínem další den v 09:00: pro toho, kdo ji převzal, jinak pro osobu, kterou Nastavení určuje pro navazující kroky k brožuře.",
  "عند وصول استفسار يطلب الكتيّب، يُرسَل إليه بالبريد الإلكتروني رابط الكتيّب المحدد في الإعدادات (لا يُرسَل شيء ما دام لا يوجد رابط). وبعد يومين، إن لم تُنشأ منه صفقة ولم يُستبعد، متابعة للاتصال بهم موعدها اليوم التالي الساعة 09:00: لمن استلمه، وإلا للشخص الذي تسمّيه الإعدادات لمتابعات الكتيّب.",
  "收到索取宣传册的询盘时，通过邮件发送“设置”中的宣传册链接（未设置链接时不发送）。两天后，如果仍未由此建立商机且未被搁置，则创建一条致电跟进，次日 09:00 到期：交给认领人；若无人认领，则交给“设置”中指定的宣传册跟进负责人。",
  "收到索取宣傳冊的詢問時，以郵件寄出「設定」中的宣傳冊連結（未設定連結時不寄出）。兩天後，如果仍未由此建立案件且未被擱置，則建立一筆致電跟進，隔天 09:00 到期：交給認領人；若無人認領，則交給「設定」中指定的宣傳冊跟進負責人。",
);
for (const [locale, text] of Object.entries(RULE_DESCRIPTION)) if (text.length > 500) fail(`the rule's description in ${locale} is ${String(text.length)} characters, over 500`);
for (const [locale, text] of Object.entries(RULE_NAME)) if (text.length > 120) fail(`the rule's name in ${locale} is ${String(text.length)} characters, over 120`);

/** The follow-up, for the person `owner` names. A rule writes its text in one language: the words a rep reads, with the company. */
const followUp = (owner) => ({
  kind: "record.create",
  table: "follow_ups",
  values: {
    owner_id: owner,
    due_at: { daysAfter: { now: true, days: 1, at: "09:00" } },
    kind: "chase",
    text: "Brochure sent 2 days ago: call {{record.company_name}}",
  },
});
const rule = {
  key: "brochure-asked",
  name: RULE_NAME,
  description: RULE_DESCRIPTION,
  enabled: false,
  module: "inbox",
  trigger: { kind: "record", event: "created", table: "enquiries", when: [{ left: { field: "brochure" }, op: "is", right: "yes" }] },
  graph: {
    version: 1,
    nodes: [
      { id: "t", kind: "trigger", title: "An enquiry asks for the brochure" },
      {
        id: "link",
        kind: "action",
        title: "Note the brochure link from Settings on it",
        action: { kind: "record.update", values: { brochure_link: { setting: { table: "settings", column: "brochure_link" } } } },
      },
      {
        id: "send",
        kind: "branch",
        title: "Is there a brochure link?",
        condition: { left: { field: "brochure_link" }, op: "not_empty" },
        branches: [
          {
            id: "with-link",
            label: "A link is set",
            nodes: [{ id: "mail", kind: "action", title: "E-mail the brochure", action: { kind: "record.create", table: "outbox", values: { kind: "brochure", enquiry_id: "{{record.id}}" } } }],
          },
          { id: "no-link", label: "No brochure link in Settings: nothing sent", nodes: [] },
        ],
      },
      { id: "wait", kind: "wait", title: "Wait 2 days", amount: 2, unit: "days" },
      { id: "no-deal", kind: "condition", title: "Still no deal made of it", condition: { left: { field: "deal_id" }, op: "is_empty" } },
      { id: "not-dropped", kind: "condition", title: "Not set aside as not for us", condition: { left: { field: "state" }, op: "is_not", right: "dropped" } },
      {
        id: "who",
        kind: "branch",
        title: "Has somebody claimed it?",
        condition: { left: { field: "claimed_by_id" }, op: "not_empty" },
        branches: [
          { id: "claimed", label: "Claimed", nodes: [{ id: "call-claimer", kind: "action", title: "A follow-up for whoever claimed it", action: followUp("{{record.claimed_by_id}}") }] },
          {
            id: "unclaimed",
            label: "Nobody yet",
            nodes: [{ id: "call-named", kind: "action", title: "A follow-up for the person Settings names", action: followUp({ setting: { table: "settings", column: "brochure_follow_up_owner_id" } }) }],
          },
        ],
      },
    ],
  },
};
manifest.automations = manifest.automations.filter((one) => one.key !== rule.key);
manifest.automations.push(rule);

// ── Forms, suggested ────────────────────────────────────────────────────────
const addOns = manifest.addOns;
addOns.suggests = addOns.suggests.filter((one) => one.key !== "forms");
addOns.suggests.push({
  key: "forms",
  range: ">=1.0.15",
  checked: true,
  reason: words(
    "Website forms become enquiries in the Team inbox, and surveys fill Customer feedback.",
    "Website-Formulare werden zu Anfragen im Team-Eingang, und Umfragen füllen das Kundenfeedback.",
    "Les formulaires du site deviennent des demandes dans la boîte de l’équipe, et les enquêtes alimentent les avis clients.",
    "Formularer på hjemmesiden bliver til henvendelser i teamets indbakke, og undersøgelser udfylder kundernes feedback.",
    "Formuláře z webu se stávají poptávkami v týmové schránce a průzkumy plní zpětnou vazbu zákazníků.",
    "تتحول نماذج الموقع إلى استفسارات في صندوق الفريق، وتملأ الاستبيانات آراء العملاء.",
    "网站表单会变成团队收件箱中的询盘，问卷会填入客户反馈。",
    "網站表單會變成團隊收件匣中的詢問，問卷會填入客戶回饋。",
  ),
});
addOns.features = addOns.features.filter((one) => !["web-enquiries", "customer-feedback"].includes(one.id));
addOns.features.push(
  { id: "web-enquiries", label: words("Web enquiries", "Anfragen über die Website", "Demandes depuis le site", "Henvendelser fra hjemmesiden", "Poptávky z webu", "استفسارات الموقع", "网站询盘", "網站詢問"), requires: ["forms"] },
  { id: "customer-feedback", label: words("Customer feedback", "Kundenfeedback", "Avis clients", "Kundefeedback", "Zpětná vazba zákazníků", "آراء العملاء", "客户反馈", "客戶回饋"), requires: ["forms"] },
);

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(SAMPLE, `${JSON.stringify(sample, null, 1)}\n`);
console.log("forms-and-brochure-whole: whole/manifest.json and the sample written");
