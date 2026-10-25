#!/usr/bin/env node
// The optional typed address for the signed copy (the crew's sign-off form). Two changes to the whole manifest:
//  1. `sign_offs.copy_sent_to` is checked as an e-mail address by the server (`rules.validation.format: "email"`), so
//     a phone (or any other writer) that sends something else is refused, not mailed to nowhere.
//  2. The job's contact gets the signed copy on EVERY sign-off (`signed-copy` loses its "no typed address" condition):
//     a typed address is an extra copy (`signed-copy-to`), never one that takes the customer's away.
//
// Run: node scripts/plan68/p5a-copy-to-whole.mjs  (idempotent)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const fail = (why) => {
  throw new Error(`p5a-copy-to-whole: ${why}`);
};

// 1. The address is an e-mail address.
const table = manifest.requiredSchema.tables.find((one) => one.ref === "sign_offs") ?? fail("no sign_offs table");
const column = table.columns.find((one) => one.ref === "copy_sent_to") ?? fail("no sign_offs.copy_sent_to");
if (column.type !== "text" || column.nullable !== true) fail("sign_offs.copy_sent_to is not a nullable text column");
const format = column.rules?.validation?.format;
if (format !== undefined && format !== "email") fail(`sign_offs.copy_sent_to already has the format "${String(format)}"`);
column.rules = { ...(column.rules ?? {}), validation: { ...(column.rules?.validation ?? {}), format: "email" } };

// 2. The job's contact gets the copy whether or not an address was typed.
const producers = manifest.outbox?.producers ?? fail("no outbox producers");
const contact = producers.find((one) => one.kind === "signed-copy") ?? fail('no "signed-copy" producer');
const typed = producers.find((one) => one.kind === "signed-copy-to") ?? fail('no "signed-copy-to" producer');
if (contact.onCreate?.table !== "sign_offs") fail('"signed-copy" is not made on a sign-off\'s create');
if (typed.onCreate?.table !== "sign_offs" || typed.recipient?.column !== "copy_sent_to") fail('"signed-copy-to" does not go to sign_offs.copy_sent_to');
const where = contact.onCreate.where;
if (where !== undefined) {
  if (where.column !== "copy_sent_to" || where.isNull !== true || Object.keys(where).length !== 2) fail(`"signed-copy" has a condition this script does not know: ${JSON.stringify(where)}`);
  delete contact.onCreate.where;
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
