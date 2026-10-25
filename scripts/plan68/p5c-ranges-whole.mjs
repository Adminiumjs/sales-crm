#!/usr/bin/env node
// The add-ons the CRM asks for, at the release that carries the helpers' word (Adminium 0.3.36 bundles 1.0.14):
// Invoices draws the signed copy and Inventory says lateness from 1.0.14 on, so the CRM suggests them at >=1.0.14.
// Only the two ranges move; Offers and every other add-on word stay as they are.
//
// AN INSTALL UPDATED FROM 0.2.0 / 0.2.1: the range is what the install screen and the update check read; an install
// whose Invoices or Inventory is older is told to update the add-on first. No row changes.
//
// Run: node scripts/plan68/p5c-ranges-whole.mjs  (idempotent)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const AT = "1.0.14";
const KEYS = ["invoices", "inventory"];
const fail = (message) => {
  throw new Error(`p5c-ranges-whole: ${message}`);
};

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const suggests = manifest.addOns?.suggests ?? fail("no addOns.suggests");
const num = (v) => v.split(/[.-]/).slice(0, 3).map(Number);
const older = (a, b) => {
  const [x, y] = [num(a), num(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};
for (const key of KEYS) {
  const one = suggests.find((entry) => entry.key === key) ?? fail(`no suggested add-on "${key}"`);
  const match = /^>=(\d+\.\d+\.\d+)$/.exec(one.range ?? "") ?? fail(`"${key}" range is ${JSON.stringify(one.range)}, not ">=x.y.z": look before running`);
  if (older(match[1], AT)) {
    console.log(`addOns.suggests ${key}: ${one.range} -> >=${AT}`);
    one.range = `>=${AT}`;
  }
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
