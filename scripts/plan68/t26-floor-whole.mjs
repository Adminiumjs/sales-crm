#!/usr/bin/env node
// Plan 68, phase 4 (T26): the CRM asks for the engine that carries the new words (E1–E28 floor 0.3.35; the helpers' word, 0.3.36).
// The release that carries the add-ons pin may be later (G2b); then this moves again at G3.
//
// Run: node scripts/plan68/t26-floor-whole.mjs  (idempotent)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "whole", "manifest.json");
const FLOOR = "0.3.36";
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const at = manifest.compatibility?.minAdminiumVersion;
if (typeof at !== "string") throw new Error("t26-floor-whole: no compatibility.minAdminiumVersion");
const num = (v) => v.split(".").map(Number);
const older = (a, b) => { const [x, y] = [num(a), num(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
if (older(at, FLOOR)) manifest.compatibility.minAdminiumVersion = FLOOR;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
