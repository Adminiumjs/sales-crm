#!/usr/bin/env node
// Plan 68, phase 5 (T31): a quote's approval threshold is the settings' value, taken when the quote is made. Nobody
// writes it afterwards: a sales manager who could set it to 100 on her own deal's quote would need no approval at all,
// round the S2 guard that keeps her from deciding her own.
//
// Run: node scripts/plan68/p5-threshold-whole.mjs  (idempotent)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const quotes = manifest.requiredSchema.tables.find((one) => one.ref === "quotes");
if (quotes?.columns.find((one) => one.ref === "threshold_pct")?.rules?.default?.from?.column !== "approval_threshold_pct") throw new Error("p5-threshold-whole: quotes.threshold_pct is not the settings' copy");
for (const role of manifest.roles) {
  const limit = role.limits?.quotes;
  if (limit === undefined) continue;
  for (const list of ["writable", "creatable"]) if (Array.isArray(limit[list])) limit[list] = limit[list].filter((column) => column !== "threshold_pct");
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
