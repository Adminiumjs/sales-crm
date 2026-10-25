#!/usr/bin/env node
// Plan 68, phase 5 (T31): a sign-off names who signed. A blank name would let e-mail 17 fail once Invoices draws the
// signed copy (its signer is a required slot); the server refuses it, as the phone's form already did.
//
// Run: node scripts/plan68/p5-signer-whole.mjs  (idempotent)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const table = manifest.requiredSchema.tables.find((one) => one.ref === "sign_offs");
if (table === undefined) throw new Error("p5-signer-whole: no sign_offs table");
const column = table.columns.find((one) => one.ref === "signer_name");
if (column === undefined) throw new Error("p5-signer-whole: no sign_offs.signer_name");
if (column.nullable === true) throw new Error("p5-signer-whole: signer_name is nullable");
column.rules = { ...(column.rules ?? {}), validation: { ...(column.rules?.validation ?? {}), minLength: 1 } };
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
