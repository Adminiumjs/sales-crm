#!/usr/bin/env node
// Plan 68, T07 (S19, the crew's offline queue): what the whole app and its sample gain.
//
//  - `snags.raised_at`: the moment a snag is raised (stamped on create), so a sign-off refused on
//    arrival can say when the snag that stopped it was raised. Empty on a snag from before 0.2.2.
//  - `refused_sign_offs`: the office's record of a sign-off refused on arrival. A refused save makes
//    no row, and phase 1 has no engine word that writes one in the refusing request, so the crew's
//    phone writes it when the refusal comes back, with its own retry key. Only a crew member of the
//    visit's crew writes one (the visit must be his crew's), only naming a snag that stops that very
//    job's sign-off right now, once a key, and nobody changes or removes it. Read by everyone who
//    reads sign-offs, each as far as they read sign-offs.
//  - the rule `sign-off-refused`: the operations manager's bell says so.
//
// Run: node scripts/plan68/t07-whole.mjs  (idempotent; finds everything by key)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const SEED = join(ROOT, "whole", "seeds", "meridian.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const seed = JSON.parse(readFileSync(SEED, "utf8"));

const fail = (message) => {
  throw new Error(`t07-whole: ${message}`);
};
const tables = manifest.requiredSchema?.tables;
if (!Array.isArray(tables)) fail("requiredSchema.tables is not a list");
const table = (ref) => tables.find((one) => one.ref === ref) ?? fail(`no table "${ref}"`);
const column = (t, ref) => t.columns.find((one) => one.ref === ref) ?? fail(`no column "${t.ref}.${ref}"`);
const role = (key) => manifest.roles.find((one) => one.key === key) ?? fail(`no role "${key}"`);
const words = (en, de, fr, da, cs, ar, zhCN, zhTW) => ({ "en-US": en, "de-DE": de, "fr-FR": fr, "da-DK": da, "cs-CZ": cs, "ar-EG": ar, "zh-CN": zhCN, "zh-TW": zhTW });

/* ─── snags.raised_at ─── */
const snags = table("snags");
column(snags, "raised_on");
column(snags, "text");
column(snags, "stops_sign_off");
column(snags, "state");
if (!snags.columns.some((one) => one.ref === "raised_at")) {
  const at = snags.columns.findIndex((one) => one.ref === "raised_on");
  snags.columns.splice(at + 1, 0, {
    ref: "raised_at",
    type: "timestamptz",
    nullable: true,
    rules: { stamp: { set: "now", on: "create" } },
    label: words("Raised at", "Gemeldet um", "Signalé à", "Meldt kl.", "Nahlášeno v", "وقت الإبلاغ", "提出时间", "提出時間"),
  });
}

/* ─── refused_sign_offs ─── */
const signOffs = table("sign_offs");
const visitLabel = column(signOffs, "visit_id").label;
const jobLabel = column(signOffs, "job_id").label;
const crewLabel = column(signOffs, "crew_id").label;
const signerLabel = column(signOffs, "signer_name").label;
const retryLabel = column(signOffs, "retry_key").label;
const siteLabel = column(table("job_visits"), "site_name").label;
const snagLabel = words("Snag that stopped it", "Mangel, der sie verhinderte", "Réserve qui l’a bloquée", "Mangel, der stoppede den", "Vada, která ho zastavila", "الملاحظة التي أوقفته", "阻止验收的整改项", "阻止驗收的改善項目");

const refused = {
  ref: "refused_sign_offs",
  module: "jobs",
  label: words("Refused sign-off", "Abgelehnte Abnahme", "Réception refusée", "Afvist godkendelse", "Odmítnuté převzetí", "استلام مرفوض", "被拒的验收", "被拒的驗收"),
  labelPlural: words("Refused sign-offs", "Abgelehnte Abnahmen", "Réceptions refusées", "Afviste godkendelser", "Odmítnutá převzetí", "استلامات مرفوضة", "被拒的验收", "被拒的驗收"),
  keyField: "signer_name",
  // Like a sign-off: his crew's (the visit's), and the job's (a rep's, a manager's team).
  belongs: [{ through: { table: "crew_members", link: "crew_id", on: "crew_id", user: "user_id" } }, { via: "job_id" }],
  indexes: [["crew_id"], ["visit_id"], ["job_id"]],
  columns: [
    { ref: "id", type: "int", role: "pk" },
    { ref: "visit_id", type: "fk", references: "job_visits", label: visitLabel },
    { ref: "job_id", type: "fk", references: "jobs", rules: { copy: { via: "visit_id", from: "job_id", mode: "always" } }, label: jobLabel },
    { ref: "crew_id", type: "int", nullable: true, rules: { copy: { via: "visit_id", from: "crew_id", mode: "always", follow: true } }, label: crewLabel },
    { ref: "site_name", type: "text", maxLength: 200, nullable: true, rules: { copy: { via: "visit_id", from: "site_name", mode: "always" } }, label: siteLabel },
    { ref: "signer_name", type: "text", maxLength: 120, label: signerLabel },
    { ref: "signed_at", type: "timestamptz", label: words("Signed on the phone at", "Auf dem Telefon unterzeichnet um", "Signé sur le téléphone à", "Underskrevet på telefonen kl.", "Podepsáno na telefonu v", "وقت التوقيع على الهاتف", "手机上签字时间", "手機上簽名時間") },
    { ref: "reached_at", type: "timestamptz", rules: { stamp: { set: "now", on: "create" } }, label: words("Reached us at", "Bei uns eingegangen um", "Reçue chez nous à", "Nåede os kl.", "Dorazilo k nám v", "وصل إلينا الساعة", "送达时间", "送達時間") },
    { ref: "by_id", type: "text", maxLength: 36, rules: { staff: true, stamp: { set: "user-id", on: "create" } }, label: words("Crew member", "Teammitglied", "Membre de l’équipe", "Holdmedlem", "Člen čety", "عضو الفريق", "班组成员", "班組成員") },
    {
      ref: "snag_id",
      type: "fk",
      references: "snags",
      // Only a snag that stops this very job's sign-off as the record is written: no record names any other.
      rules: { linkable: { where: [{ column: "stops_sign_off", eq: true }, { column: "state", in: ["open", "waiting-part"] }], same: [{ column: "job_id", as: "job_id" }] } },
      label: snagLabel,
    },
    { ref: "snag_text", type: "text", maxLength: 400, nullable: true, rules: { copy: { via: "snag_id", from: "text", mode: "always" } }, label: words("What the snag says", "Text des Mangels", "Texte de la réserve", "Manglens tekst", "Text vady", "نص الملاحظة", "整改项内容", "改善項目內容") },
    { ref: "snag_by_id", type: "text", maxLength: 36, nullable: true, rules: { copy: { via: "snag_id", from: "raised_by_id", mode: "always" } }, label: words("Snag raised by", "Mangel gemeldet von", "Réserve signalée par", "Mangel meldt af", "Vadu nahlásil(a)", "أبلغ عن الملاحظة", "整改项提出人", "改善項目提出人") },
    { ref: "snag_raised_at", type: "timestamptz", nullable: true, rules: { copy: { via: "snag_id", from: "raised_at", mode: "always" } }, label: words("Snag raised at", "Mangel gemeldet um", "Réserve signalée à", "Mangel meldt kl.", "Vada nahlášena v", "وقت الإبلاغ عن الملاحظة", "整改项提出时间", "改善項目提出時間") },
    { ref: "snag_raised_on", type: "date", nullable: true, rules: { copy: { via: "snag_id", from: "raised_on", mode: "always" } }, label: words("Snag raised on", "Mangel gemeldet am", "Réserve signalée le", "Mangel meldt den", "Vada nahlášena dne", "تاريخ الإبلاغ عن الملاحظة", "整改项提出日期", "改善項目提出日期") },
    { ref: "retry_key", type: "text", maxLength: 64, nullable: true, unique: true, rules: { retryKey: true }, label: retryLabel },
  ],
};
const at = tables.findIndex((one) => one.ref === "refused_sign_offs");
if (at === -1) tables.splice(tables.indexOf(signOffs) + 1, 0, refused);
else tables[at] = refused;

/* ─── Its records page, beside the sign-offs', and where a notice about one opens ─── */
const PAGE = "crm-refused-sign-offs";
const signOffsPage = manifest.pages.find((one) => one.ref === "crm-sign-offs") ?? fail('no page "crm-sign-offs"');
const page = {
  ref: PAGE,
  template: "page-crud",
  title: { key: "mft.crm.page.refused_sign_offs", fallback: "Refused sign-offs" },
  titles: { "de-DE": "Abgelehnte Abnahmen", "fr-FR": "Réceptions refusées", "da-DK": "Afviste godkendelser", "cs-CZ": "Odmítnutá převzetí", "ar-EG": "استلامات مرفوضة", "zh-CN": "被拒的验收", "zh-TW": "被拒的驗收" },
  // Off the rail like the sign-offs' page, at an order of its own in the heading.
  nav: { ...signOffsPage.nav, order: 16 },
  bindings: { rows: "refused_sign_offs" },
  module: "jobs",
};
const pageAt = manifest.pages.findIndex((one) => one.ref === PAGE);
if (pageAt === -1) manifest.pages.splice(manifest.pages.indexOf(signOffsPage) + 1, 0, page);
else manifest.pages[pageAt] = page;
const staffSide = manifest.frontends.find((one) => one.side === "staff") ?? fail("no staff frontend");
staffSide.records ??= {};
// The office's Sign-off, at the refused record's job.
staffSide.records.refused_sign_offs = "/sign-off/refused/{id}";

/* ─── Who reads it, who writes it ─── */
const READ = "table:@refused_sign_offs:read";
const CREATE = "table:@refused_sign_offs:create";
const VIEW = `page:@${PAGE}:view`;
const grant = (key, permissions, limit) => {
  const r = role(key);
  if (!r.permissions.includes("table:@sign_offs:read")) fail(`role "${key}" no longer reads sign-offs`);
  for (const p of permissions) if (!r.permissions.includes(p)) r.permissions.splice(r.permissions.indexOf("table:@sign_offs:read") + 1, 0, p);
  if (r.permissions.includes("page:@crm-sign-offs:view") && !r.permissions.includes(VIEW)) r.permissions.splice(r.permissions.indexOf("page:@crm-sign-offs:view") + 1, 0, VIEW);
  if (limit !== undefined) {
    r.limits ??= {};
    r.limits.refused_sign_offs = limit;
  }
};
// Read as far as each reads sign-offs.
for (const key of ["admin", "account-manager", "ops-manager", "read-only"]) {
  if (role(key).limits?.sign_offs?.rows !== undefined) fail(`role "${key}" now limits the sign-offs it reads`);
  grant(key, [READ]);
}
// T09: the CRM admin may delete one. A record holds its snag (the link refuses the snag's removal), and with nobody
// able to delete records, a snag once named could never be removed, nor its visit called off.
grant("admin", ["table:@refused_sign_offs:delete"]);
grant("sales-manager", [READ], { rows: { read: { reach: "team" } } });
grant("rep", [READ], { rows: { read: { reach: "own" } } });
// Written by the crew alone: his crew's visit, a snag that stops it, when it was signed and by whom.
grant("crew", [CREATE, READ], { creatable: ["visit_id", "signer_name", "signed_at", "snag_id"], rows: { read: { reach: "own" } } });
// Nobody else writes one.
for (const r of manifest.roles) if (r.key !== "crew" && r.permissions.includes(CREATE)) fail(`role "${r.key}" may make a refused sign-off`);
// The crew's permissions in order: its create beside its read.
{
  const crew = role("crew");
  const without = crew.permissions.filter((p) => p !== CREATE && p !== READ);
  without.splice(without.indexOf("table:@sign_offs:create") + 1, 0, READ, CREATE);
  crew.permissions = without;
}

/* ─── The office's bell ─── */
const RULE = "sign-off-refused";
const rule = {
  key: RULE,
  name: words(
    "A sign-off is refused on arrival: tell the operations manager",
    "Eine Abnahme wird beim Eingang abgelehnt: der Einsatzleitung Bescheid geben",
    "Une réception est refusée à son arrivée : prévenir le responsable des opérations",
    "En godkendelse afvises ved ankomst: giv driftslederen besked",
    "Převzetí je po doručení odmítnuto: dát vědět vedoucímu provozu",
    "رُفض استلام عند وصوله: أخبر مدير العمليات",
    "验收送达时被拒：通知运营经理",
    "驗收送達時被拒：通知營運經理",
  ),
  description: words(
    "A crew's phone signs a job off with no signal; when it is sent, a snag raised meanwhile stops it, and the phone writes down that it was refused. The operations manager is told, and opens the job's Sign-off.",
    "Das Telefon eines Teams nimmt einen Auftrag ohne Empfang ab; beim Senden verhindert ein inzwischen gemeldeter Mangel die Abnahme, und das Telefon hält die Ablehnung fest. Die Einsatzleitung erfährt es und öffnet die Abnahme des Auftrags.",
    "Le téléphone d’une équipe réceptionne un chantier sans réseau ; à l’envoi, une réserve signalée entre-temps la bloque, et le téléphone note le refus. Le responsable des opérations est prévenu et ouvre la réception du chantier.",
    "Et holds telefon godkender en opgave uden signal; da den sendes, stopper en mangel meldt imens godkendelsen, og telefonen noterer afvisningen. Driftslederen får besked og åbner opgavens godkendelse.",
    "Telefon čety převezme zakázku bez signálu; při odeslání ji zastaví vada nahlášená mezitím a telefon odmítnutí zapíše. Vedoucí provozu se to dozví a otevře převzetí zakázky.",
    "يستلم هاتف الفريق العمل دون إشارة؛ وعند إرساله توقفه ملاحظة أُبلغ عنها في الأثناء، فيسجّل الهاتف الرفض. يُبلَّغ مدير العمليات ويفتح استلام العمل.",
    "班组手机在没有信号时完成验收；发送时，期间提出的整改项阻止了验收，手机记下被拒。运营经理会收到通知，并打开该工单的验收。",
    "班組手機在沒有訊號時完成驗收；送出時，期間提出的改善項目阻止了驗收，手機記下被拒。營運經理會收到通知，並開啟該工單的驗收。",
  ),
  enabled: true,
  module: "jobs",
  trigger: { kind: "record", event: "created", table: "refused_sign_offs" },
  graph: {
    version: 1,
    nodes: [
      { id: "t", kind: "trigger", title: "A sign-off is refused on arrival: tell the operations manager" },
      {
        id: "tell",
        kind: "action",
        title: "Tell the operations manager",
        action: {
          kind: "notification",
          to: { roles: ["ops-manager"] },
          title: words(
            "A sign-off was refused on arrival: {{record.site_name}}",
            "Eine Abnahme wurde beim Eingang abgelehnt: {{record.site_name}}",
            "Une réception a été refusée à son arrivée : {{record.site_name}}",
            "En godkendelse blev afvist ved ankomst: {{record.site_name}}",
            "Převzetí bylo po doručení odmítnuto: {{record.site_name}}",
            "رُفض استلام عند وصوله: {{record.site_name}}",
            "验收送达时被拒：{{record.site_name}}",
            "驗收送達時被拒：{{record.site_name}}",
          ),
          body: words(
            "“{{record.snag_text}}” stops it. Put it right; the customer signs again on the next visit.",
            "„{{record.snag_text}}“ verhindert sie. Beheben Sie den Mangel; die Kundschaft unterschreibt beim nächsten Einsatz erneut.",
            "« {{record.snag_text}} » la bloque. Levez la réserve ; le client signe à nouveau lors de la prochaine intervention.",
            "“{{record.snag_text}}” stopper den. Udbedr manglen; kunden skriver under igen ved næste besøg.",
            "„{{record.snag_text}}“ ho zastavuje. Vadu odstraňte; zákazník podepíše znovu při příštím výjezdu.",
            "«{{record.snag_text}}» توقفه. عالجها؛ ويوقّع العميل من جديد في الزيارة القادمة.",
            "“{{record.snag_text}}”阻止了验收。请先整改；客户会在下次上门时重新签字。",
            "「{{record.snag_text}}」阻止了驗收。請先改善；客戶會在下次到訪時重新簽名。",
          ),
        },
      },
    ],
  },
};
const ruleAt = manifest.automations.findIndex((one) => one.key === RULE);
if (ruleAt === -1) {
  const after = manifest.automations.findIndex((one) => one.key === "aftercare-call");
  manifest.automations.splice(after === -1 ? manifest.automations.length : after, 0, rule);
} else manifest.automations[ruleAt] = rule;

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(SEED, JSON.stringify(seed, null, 1) + "\n");
console.log("t07-whole: snags.raised_at, refused_sign_offs, its grants and the sign-off-refused rule are in.");
