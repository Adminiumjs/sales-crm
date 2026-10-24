#!/usr/bin/env node
// Plan 68, phase 4 (T27, E25): the weekly summaries' "cover" counts this year, as the console's Target cover does: open
// deals (no closed day yet) and deals won THIS year, against this year's target. Before, it counted every won deal
// ever (plan-67 decision 135). `within` is the business's calendar year; `orEmpty` keeps the open deals.
//
// Run: node scripts/plan68/t27-summaries-whole.mjs  (idempotent; finds everything by key)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const fail = (message) => {
  throw new Error(`t27-summaries-whole: ${message}`);
};
for (const key of ["week-rep", "week-manager"]) {
  const rule = manifest.automations.find((one) => one.key === key) ?? fail(`no rule "${key}"`);
  const digest = rule.graph.nodes.map((node) => node.action).find((action) => action?.kind === "digest") ?? fail(`"${key}" has no summary step`);
  const cover = digest.sections.find((section) => section.key === "cover") ?? fail(`"${key}" has no cover section`);
  if (cover.table !== "deals" || JSON.stringify(cover.sum) !== '["target_value"]') fail(`"${key}" cover is no longer the deals' target value`);
  cover.within = { column: "closed_on", this: "year", orEmpty: true };
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
