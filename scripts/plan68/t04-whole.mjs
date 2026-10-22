#!/usr/bin/env node
/**
 * Plan 68, T04 (S5): the Team screens' left-out pieces, as columns of the whole app and values of its sample.
 *
 *  - `meeting_slots.covered`: a running-order tick (yes/no, no by default);
 *  - `one_to_one_sessions`: the four drawn "what to cover" ticks (`cover_sitting`, `cover_biggest`, `cover_target`,
 *    `cover_late`, yes/no, no by default), "something else to raise" (`raised`, text, empty; not `raise`, a word SQLite keeps for itself) and how long it ran
 *    (`minutes`, a number, empty);
 *  - `coaching_areas`: "why" (`why`), "what good looks like" (`good_looks_like`), both text and empty, and which live
 *    number the area is measured by (`measure`, empty: no number);
 *  - `starters.patch`: the territory a starter takes on ("Her patch"), a link, empty.
 *
 * Every new column is nullable or has a literal default, so an install updated from 0.2.0 or 0.2.1 holds no tick, no
 * text, no number and no patch in it. The writes these screens make use rights the roles already hold (a rep reads a
 * starter's patch, a column right, below); no reach and no `belongs` changes.
 *
 * The sample: the eight coaching areas get the design's why, what good looks like and number; the sessions their
 * half hour; Nia her patch (Scotland, Leo's).
 *
 * Finds everything by key, asserts what it needs, and is idempotent. Run from the app's root:
 *   node scripts/plan68/t04-whole.mjs && npm run stage
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const SEED = join(APP, "whole", "seeds", "meridian.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const seed = JSON.parse(readFileSync(SEED, "utf8"));

const fail = (message) => {
  throw new Error(`t04-whole: ${message}`);
};
const L = (en, de, fr, da, cs, ar, zhCN, zhTW) => ({ "en-US": en, "de-DE": de, "fr-FR": fr, "da-DK": da, "cs-CZ": cs, "ar-EG": ar, "zh-CN": zhCN, "zh-TW": zhTW });

const tableOf = (ref) => manifest.requiredSchema.tables.find((table) => table.ref === ref) ?? fail(`no table "${ref}"`);
const roleOf = (key) => manifest.roles.find((role) => role.key === key) ?? fail(`no role "${key}"`);
/** Add a column after `after` (or at the end, before the retry key), once; a column already there is left as it is. */
function addColumn(ref, column, after) {
  const table = tableOf(ref);
  if (table.columns.some((one) => one.ref === column.ref)) return;
  const at = after === undefined ? table.columns.findIndex((one) => one.ref === "retry_key") : table.columns.findIndex((one) => one.ref === after) + 1;
  if (at <= 0) fail(`"${ref}" has no column to put "${column.ref}" after (${after ?? "retry_key"})`);
  table.columns.splice(at, 0, column);
}

/* ─── The weekly meeting: a running-order tick ─────────────────────────────── */

addColumn("meeting_slots", { ref: "covered", type: "bool", default: false, label: L("Covered", "Besprochen", "Traité", "Gennemgået", "Probráno", "تمت تغطيته", "已讲完", "已講完") }, "position");

/* ─── A one-to-one session: what was covered, what else was raised, how long ─ */

const TOPICS = [
  ["cover_sitting", L("Covered: the deal longest in its stage", "Besprochen: der Deal, der am längsten in seiner Phase steht", "Traité : l’affaire la plus ancienne dans son étape", "Gennemgået: handlen, der har stået længst i sin fase", "Probráno: obchod, který je nejdéle ve své fázi", "تمت تغطيته: الصفقة الأطول بقاءً في مرحلتها", "已讲：在当前阶段停留最久的商机", "已談：在目前階段停留最久的商機")],
  ["cover_biggest", L("Covered: the biggest open deal", "Besprochen: der größte offene Deal", "Traité : la plus grosse affaire ouverte", "Gennemgået: den største åbne handel", "Probráno: největší otevřený obchod", "تمت تغطيته: أكبر صفقة مفتوحة", "已讲：金额最大的进行中商机", "已談：金額最大的進行中商機")],
  ["cover_target", L("Covered: the year’s target", "Besprochen: das Jahresziel", "Traité : l’objectif de l’année", "Gennemgået: årets mål", "Probráno: roční cíl", "تمت تغطيته: هدف السنة", "已讲：年度目标", "已談：年度目標")],
  ["cover_late", L("Covered: follow-ups past due", "Besprochen: überfällige Nachfassaktionen", "Traité : relances en retard", "Gennemgået: forfaldne opfølgninger", "Probráno: zpožděná dotažení", "تمت تغطيته: المتابعات المتأخرة", "已讲：逾期的跟进", "已談：逾期的跟進")],
];
let after = "notes";
for (const [ref, label] of TOPICS) {
  addColumn("one_to_one_sessions", { ref, type: "bool", default: false, label }, after);
  after = ref;
}
addColumn("one_to_one_sessions", { ref: "raised", type: "text", nullable: true, label: L("Something else to raise", "Was sonst noch anzusprechen ist", "Autre chose à aborder", "Andet at tage op", "Co dalšího probrat", "شيء آخر للطرح", "其他要提的事", "其他要提的事"), rules: { validation: { maxLength: 400 } } }, "cover_late");
addColumn("one_to_one_sessions", { ref: "minutes", type: "int", nullable: true, label: L("Minutes", "Minuten", "Minutes", "Minutter", "Minuty", "الدقائق", "分钟", "分鐘"), rules: { validation: { min: 5, max: 240 } } }, "raised");

/* ─── A coaching area: why, what good looks like, and its live number ──────── */

const MEASURES = {
  late: L("Follow-ups past due", "Überfällige Nachfassaktionen", "Relances en retard", "Forfaldne opfølgninger", "Zpožděná dotažení", "المتابعات المتأخرة", "逾期跟进", "逾期跟進"),
  deals: L("Open deals", "Offene Deals", "Affaires ouvertes", "Åbne handler", "Otevřené obchody", "الصفقات المفتوحة", "进行中的商机", "進行中的商機"),
  average: L("Average open deal", "Durchschnittlicher offener Deal", "Affaire ouverte moyenne", "Gennemsnitlig åben handel", "Průměrný otevřený obchod", "متوسط الصفقة المفتوحة", "进行中商机的平均金额", "進行中商機的平均金額"),
  first_stage: L("Deals still in the first stage", "Deals noch in der ersten Phase", "Affaires encore à la première étape", "Handler stadig i første fase", "Obchody stále v první fázi", "صفقات ما زالت في المرحلة الأولى", "仍在第一阶段的商机", "仍在第一階段的商機"),
  win_rate: L("Win rate, last twelve months", "Abschlussquote, letzte zwölf Monate", "Taux de réussite, douze derniers mois", "Vinderrate, sidste tolv måneder", "Úspěšnost, posledních dvanáct měsíců", "نسبة الفوز، آخر اثني عشر شهرًا", "近十二个月赢单率", "近十二個月贏單率"),
  cycle: L("Days from open to won", "Tage vom Start bis zum Gewinn", "Jours de l’ouverture au gain", "Dage fra åben til vundet", "Dny od otevření po výhru", "الأيام من الفتح إلى الفوز", "从开启到赢单的天数", "從開啟到贏單的天數"),
};
addColumn("coaching_areas", { ref: "why", type: "text", nullable: true, label: L("Why", "Warum", "Pourquoi", "Hvorfor", "Proč", "لماذا", "原因", "原因"), rules: { validation: { maxLength: 400 } } }, "title");
addColumn("coaching_areas", { ref: "good_looks_like", type: "text", nullable: true, label: L("What good looks like", "Woran man Erfolg erkennt", "À quoi ressemble la réussite", "Sådan ser godt ud", "Jak vypadá úspěch", "كيف يبدو النجاح", "做好是什么样", "做好是什麼樣"), rules: { validation: { maxLength: 300 } } }, "why");
addColumn(
  "coaching_areas",
  { ref: "measure", type: "enum", enum: Object.keys(MEASURES), nullable: true, label: L("Measured by", "Gemessen an", "Mesuré par", "Måles på", "Měří se", "يُقاس بـ", "衡量指标", "衡量指標"), rules: { enumLabels: { labels: MEASURES } } },
  "good_looks_like",
);

/* ─── A new starter: her patch ──────────────────────────────────────────────── */

addColumn("starters", { ref: "patch", type: "fk", references: "territories", nullable: true, label: L("Patch", "Gebiet", "Secteur", "Distrikt", "Oblast", "المنطقة", "负责区域", "負責區域") }, "user_id");
// A rep reads a starter's patch as she reads her name and first day (never the first-year target).
const repStarters = roleOf("rep").limits?.starters;
if (repStarters === undefined || !Array.isArray(repStarters.readable)) fail("the rep's starters limit has no readable list");
if (!repStarters.readable.includes("patch")) repStarters.readable.push("patch");

/* ─── The sample ─────────────────────────────────────────────────────────── */

const rowsOf = (ref) => (seed.tables.find((table) => table.ref === ref) ?? fail(`the sample has no "${ref}"`)).rows;
const labelled = (ref, label) => rowsOf(ref).find((row) => row["@label"] === label) ?? fail(`the sample has no ${ref} "${label}"`);

const AREAS = {
  "area:dana:0": [
    L("Three of her deals slipped a week because nobody came back on time.", "Drei ihrer Deals sind eine Woche verrutscht, weil sich niemand rechtzeitig gemeldet hat.", "Trois de ses affaires ont glissé d’une semaine faute de relance à temps.", "Tre af hendes handler gled en uge, fordi ingen vendte tilbage i tide.", "Tři její obchody se posunuly o týden, protože se nikdo včas neozval.", "تأخرت ثلاث من صفقاتها أسبوعًا لأن أحدًا لم يعاود الاتصال في الوقت المحدد.", "她有三个商机拖了一周，因为没人按时回访。", "她有三個商機拖了一週，因為沒人準時回訪。"),
    L("Nothing past due on a Friday afternoon.", "Freitagnachmittag ist nichts überfällig.", "Rien en retard le vendredi après-midi.", "Intet forfaldent en fredag eftermiddag.", "V pátek odpoledne nic po termínu.", "لا شيء متأخر بعد ظهر يوم الجمعة.", "周五下午没有任何逾期。", "週五下午沒有任何逾期。"),
    "late",
  ],
  "area:dana:1": [
    L("Her deals sit in Proposal longer than anyone else’s.", "Ihre Deals bleiben länger im Angebot als die aller anderen.", "Ses affaires restent en Proposition plus longtemps que celles des autres.", "Hendes handler står længere i Tilbud end alle andres.", "Její obchody zůstávají v Nabídce déle než u kohokoli jiného.", "تبقى صفقاتها في مرحلة العرض أطول من صفقات أي شخص آخر.", "她的商机在“方案”阶段停留得比谁都久。", "她的商機在「提案」階段停留得比誰都久。"),
    L("Ask who signs and when, at the first meeting.", "Beim ersten Termin fragen, wer unterschreibt und wann.", "Demander qui signe et quand, dès le premier rendez-vous.", "Spørg ved første møde, hvem der skriver under og hvornår.", "Na první schůzce se zeptat, kdo podepisuje a kdy.", "اسأل من يوقّع ومتى، في الاجتماع الأول.", "第一次见面就问清谁签字、什么时候签。", "第一次見面就問清誰簽字、什麼時候簽。"),
    "cycle",
  ],
  "area:priya:0": [
    L("Her paper proposals win. Nobody else knows how she builds them.", "Ihre Angebote auf Papier gewinnen. Niemand sonst weiß, wie sie sie aufbaut.", "Ses propositions papier gagnent. Personne d’autre ne sait comment elle les construit.", "Hendes tilbud på papir vinder. Ingen andre ved, hvordan hun bygger dem op.", "Její papírové nabídky vyhrávají. Nikdo jiný neví, jak je staví.", "عروضها الورقية تفوز، ولا أحد غيرها يعرف كيف تبنيها.", "她的纸质方案能赢单，但没人知道她是怎么做的。", "她的紙本提案能贏單，但沒人知道她是怎麼做的。"),
    L("One page the others can copy.", "Eine Seite, die die anderen übernehmen können.", "Une page que les autres peuvent reprendre.", "Én side, de andre kan kopiere.", "Jedna stránka, kterou ostatní převezmou.", "صفحة واحدة يمكن للآخرين نسخها.", "一页纸，别人照着就能做。", "一頁紙，別人照著就能做。"),
    "win_rate",
  ],
  "area:priya:1": [
    L("Her average deal is the smallest on the team, and not because of her patch.", "Ihr durchschnittlicher Deal ist der kleinste im Team, und das liegt nicht an ihrem Gebiet.", "Son affaire moyenne est la plus petite de l’équipe, et pas à cause de son secteur.", "Hendes gennemsnitlige handel er teamets mindste, og det skyldes ikke hendes distrikt.", "Její průměrný obchod je v týmu nejmenší, a není to kvůli její oblasti.", "متوسط صفقاتها هو الأصغر في الفريق، وليس بسبب منطقتها.", "她的平均商机金额是团队里最小的，这跟她的区域无关。", "她的平均商機金額是團隊裡最小的，這跟她的區域無關。"),
    L("Quote the whole floor, not the corner of it.", "Das ganze Stockwerk anbieten, nicht nur eine Ecke davon.", "Chiffrer tout l’étage, pas seulement un coin.", "Giv tilbud på hele etagen, ikke kun et hjørne af den.", "Nacenit celé patro, ne jen jeho roh.", "قدّم عرضًا للطابق كله، لا لزاوية منه.", "报整层楼的价，而不只是一个角落。", "報整層樓的價，而不只是一個角落。"),
    "average",
  ],
  "area:sam:0": [
    L("Two deals sat in Discovery for weeks waiting on a first visit.", "Zwei Deals standen wochenlang in der Erkundung und warteten auf einen ersten Besuch.", "Deux affaires sont restées des semaines en Découverte, en attente d’une première visite.", "To handler stod i ugevis i Afdækning og ventede på et første besøg.", "Dva obchody stály týdny ve Zjišťování a čekaly na první návštěvu.", "بقيت صفقتان في مرحلة الاستكشاف أسابيع بانتظار الزيارة الأولى.", "有两个商机在“了解需求”阶段等了好几周的首次上门。", "有兩個商機在「了解需求」階段等了好幾週的首次到場。"),
    L("On site inside five working days.", "Innerhalb von fünf Arbeitstagen vor Ort.", "Sur place en cinq jours ouvrés.", "På stedet inden for fem arbejdsdage.", "Na místě do pěti pracovních dnů.", "في الموقع خلال خمسة أيام عمل.", "五个工作日内到现场。", "五個工作天內到現場。"),
    "first_stage",
  ],
  "area:sam:1": [
    L("Low Orbit went cold last year on a figure given over the phone.", "Low Orbit ist letztes Jahr wegen einer am Telefon genannten Zahl abgesprungen.", "Low Orbit s’est refroidi l’an dernier sur un chiffre donné par téléphone.", "Low Orbit kølnede sidste år på et tal givet over telefonen.", "Low Orbit loni vychladl kvůli číslu řečenému po telefonu.", "فترت Low Orbit العام الماضي بسبب رقم أُعطي عبر الهاتف.", "去年 Low Orbit 就是因为电话里报了个数而冷掉的。", "去年 Low Orbit 就是因為電話裡報了個數而冷掉的。"),
    L("Nobody gets a number without a walk-round.", "Niemand bekommt eine Zahl ohne Begehung.", "Pas de chiffre sans visite des lieux.", "Ingen får et tal uden en rundgang.", "Nikdo nedostane číslo bez obhlídky.", "لا أحد يحصل على رقم دون جولة في المكان.", "不实地看过，谁也不报数。", "不實地看過，誰也不報數。"),
    null,
  ],
  "area:leo:0": [
    L("Covering the enquiries has cost him his own deals.", "Die Anfragen abzudecken hat ihn seine eigenen Deals gekostet.", "Couvrir les demandes lui a coûté ses propres affaires.", "At dække forespørgslerne har kostet ham hans egne handler.", "Pokrývání poptávek ho stálo jeho vlastní obchody.", "تغطية الاستفسارات كلفته صفقاته الخاصة.", "忙着接询盘，让他丢了自己的商机。", "忙著接詢問，讓他丟了自己的商機。"),
    L("Four deals of his own in play by October.", "Bis Oktober vier eigene Deals im Spiel.", "Quatre affaires à lui en cours d’ici octobre.", "Fire af hans egne handler i spil inden oktober.", "Do října čtyři vlastní obchody ve hře.", "أربع صفقات خاصة به قيد العمل بحلول أكتوبر.", "到十月手上有四个自己的商机。", "到十月手上有四個自己的商機。"),
    "deals",
  ],
  "area:leo:1": [
    L("The last handover left Dana chasing the contact for a week.", "Nach der letzten Übergabe musste Dana dem Kontakt eine Woche hinterherlaufen.", "La dernière passation a laissé Dana courir après le contact pendant une semaine.", "Den seneste overdragelse fik Dana til at jagte kontakten i en uge.", "Po posledním předání Dana týden naháněla kontakt.", "تركت عملية التسليم الأخيرة Dana تلاحق جهة الاتصال لأسبوع.", "上次交接让 Dana 追了联系人一个星期。", "上次交接讓 Dana 追了聯絡人一個星期。"),
    L("The next person needs no more than the note.", "Die nächste Person braucht nicht mehr als die Notiz.", "La personne suivante n’a besoin que de la note.", "Den næste har ikke brug for mere end noten.", "Další člověk nepotřebuje nic víc než poznámku.", "لا يحتاج الشخص التالي إلى أكثر من الملاحظة.", "下一个人只看交接备注就够了。", "下一個人只看交接備註就夠了。"),
    null,
  ],
};
for (const [label, [why, good, measure]] of Object.entries(AREAS)) {
  const row = labelled("coaching_areas", label);
  row["why"] ??= { "@t": why };
  row["good_looks_like"] ??= { "@t": good };
  if (measure !== null) row["measure"] ??= measure;
}
// Each one-to-one ran its half hour.
for (const row of rowsOf("one_to_one_sessions")) row["minutes"] ??= 30;
// Nia takes on Scotland, Leo's patch.
const scotland = labelled("territories", "terr:1");
if (scotland["name"]?.["@t"]?.["en-US"] !== "Scotland") fail('the sample\'s "terr:1" is not Scotland');
labelled("starters", "starter:nia")["patch"] ??= { "@ref": "terr:1" };

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(SEED, JSON.stringify(seed, null, 1) + "\n");
console.log("t04-whole: the Team screens' pieces are in the whole app and its sample");
