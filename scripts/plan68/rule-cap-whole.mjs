#!/usr/bin/env node
// Plan 68, the rule cap (§10.10, owner 2026-10-24): a manifest ships at most 24 rules, and T05 brings
// the CRM to 25. `approval-given` and `approval-refused` become one rule, `approval-decided`: the same
// change (a quote's approval decided), the same person told (who asked), both shipped switched off.
// Each notice keeps its words; a branch picks which. `approval-asked` stays its own rule: it ships
// switched on, and these two are off for the install's owner to switch on.
//
// An update from 0.2.1 removes the two old rules unless the owner edited them, and writes this one.
//
// Run: node scripts/plan68/rule-cap-whole.mjs  (idempotent; finds everything by key)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const fail = (message) => {
  throw new Error(`rule-cap-whole: ${message}`);
};
const words = (en, de, fr, da, cs, ar, zhCN, zhTW) => ({ "en-US": en, "de-DE": de, "fr-FR": fr, "da-DK": da, "cs-CZ": cs, "ar-EG": ar, "zh-CN": zhCN, "zh-TW": zhTW });
const RULE = "approval-decided";
const OLD = ["approval-given", "approval-refused"];

const rules = manifest.automations;
if (!Array.isArray(rules)) fail("automations is not a list");
const at = (key) => rules.findIndex((one) => one.key === key);

if (at(RULE) === -1) {
  const [given, refused] = OLD.map((key) => rules[at(key)] ?? fail(`no rule "${key}"`));
  // Both must still be what this script folds: told who asked, off, on the approval column.
  for (const old of [given, refused]) {
    if (old.enabled !== false) fail(`"${old.key}" is no longer shipped switched off`);
    if (old.trigger?.table !== "quotes" || old.trigger?.changedColumn !== "approval") fail(`"${old.key}" no longer hears quotes.approval`);
    if (old.graph.nodes.length !== 2 || old.graph.nodes[1].action?.kind !== "notification") fail(`"${old.key}" is no longer one notice`);
  }
  const tell = (old, id) => ({ ...old.graph.nodes[1], id });
  const rule = {
    key: RULE,
    name: words(
      "A discount is approved or refused: the person who asked is told",
      "Ein Rabatt wird genehmigt oder abgelehnt: die anfragende Person wird benachrichtigt",
      "Une remise est approuvée ou refusée : la personne qui l’a demandée est prévenue",
      "En rabat godkendes eller afvises: den, der bad om det, får besked",
      "Sleva je schválena nebo zamítnuta: žadatel dostane zprávu",
      "اعتُمد خصم أو رُفض: يُبلَّغ من طلبه",
      "折扣获批或被驳回：通知申请人",
      "折扣獲准或遭駁回：通知申請人",
    ),
    description: words(
      "When a quote’s approval is given or refused, tells the person who asked for it which.",
      "Benachrichtigt die anfragende Person, sobald die Genehmigung eines Angebots erteilt oder abgelehnt ist, und sagt, welches von beiden.",
      "Quand l’approbation d’un devis est accordée ou refusée, prévient la personne qui l’a demandée de la décision.",
      "Når et tilbud godkendes eller afvises, får den, der bad om det, besked om hvilket.",
      "Když je nabídka schválena nebo zamítnuta, dá vědět tomu, kdo o schválení požádal, jak bylo rozhodnuto.",
      "عند اعتماد عرض سعر أو رفضه، يُبلِّغ من طلب الاعتماد بالقرار.",
      "报价获批或审批被驳回时，通知申请审批的人结果如何。",
      "報價獲准或核准遭駁回時，通知申請核准的人結果如何。",
    ),
    enabled: false,
    module: given.module,
    trigger: {
      kind: "record",
      event: "updated",
      table: "quotes",
      changedColumn: "approval",
      // Decided: neither "none" nor "asked" (the column's four values: none, asked, approved, refused).
      when: [
        { left: { field: "approval" }, op: "is_not", right: "none" },
        { left: { field: "approval" }, op: "is_not", right: "asked" },
      ],
    },
    graph: {
      version: 1,
      nodes: [
        {
          id: "t",
          kind: "trigger",
          title: words(
            "A discount is approved or refused",
            "Ein Rabatt wird genehmigt oder abgelehnt",
            "Une remise est approuvée ou refusée",
            "En rabat godkendes eller afvises",
            "Sleva je schválena nebo zamítnuta",
            "اعتُمد خصم أو رُفض",
            "折扣获批或被驳回",
            "折扣獲准或遭駁回",
          ),
        },
        {
          id: "which",
          kind: "branch",
          title: words("Approved?", "Genehmigt?", "Approuvée ?", "Godkendt?", "Schváleno?", "تمت الموافقة؟", "已批准？", "已核准？"),
          condition: { left: { field: "approval" }, op: "is", right: "approved" },
          branches: [
            { id: "which-yes", label: "Yes", nodes: [tell(given, "tell-approved")] },
            { id: "which-no", label: "No", nodes: [tell(refused, "tell-refused")] },
          ],
        },
      ],
    },
  };
  rules.splice(at("approval-given"), 1, rule);
  rules.splice(at("approval-refused"), 1);
}
for (const key of OLD) if (at(key) !== -1) fail(`"${key}" is still shipped beside "${RULE}"`);

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`rule-cap-whole: "${RULE}" ships in place of ${OLD.join(" and ")} (${rules.length} rules).`);
