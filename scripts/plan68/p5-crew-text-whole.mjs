#!/usr/bin/env node
// Plan 68, phase 5 (T31): what the crew types that e-mail 17 prints to the customer (a snag's put-right note) is held to
// plain text, as every other staff text in a customer's mail is (a deal's name, a visit's purpose): no address of any
// kind, no long run of digits.
//
// Run: node scripts/plan68/p5-crew-text-whole.mjs  (idempotent)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const column = manifest.requiredSchema.tables.find((one) => one.ref === "snags")?.columns.find((one) => one.ref === "put_right_note");
if (column === undefined) throw new Error("p5-crew-text-whole: no snags.put_right_note");
if (column.type !== "text" || column.maxLength !== 400) throw new Error("p5-crew-text-whole: snags.put_right_note is not text(400)");
column.rules = { ...(column.rules ?? {}), plainText: { digits: 12, max: 400 } };
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
