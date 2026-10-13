/**
 * Preloaded into the stand's server (`node --import`) while the engine it runs
 * is ahead of its own release: the engine reads its version from
 * `apps/server/package.json`, which says the last release until the next one
 * is cut, and this app's manifest asks for the release to come.
 *
 * This answers that ONE read with `CRM_STAND_VERSION`. It is loaded only when
 * that variable is set, and never against a released Adminium.
 */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = join(process.env.ADMINIUM_REPO ?? "", "apps", "server", "package.json");
const AS = process.env.CRM_STAND_VERSION ?? "";
const real = fs.readFileSync;
fs.readFileSync = function readFileSync(path, ...rest) {
  const out = real.call(fs, path, ...rest);
  let file = null;
  try {
    file = path instanceof URL ? fileURLToPath(path) : typeof path === "string" ? path : null;
  } catch {
    file = null;
  }
  if (AS === "" || file !== TARGET) return out;
  const doc = JSON.parse(String(out));
  doc.version = AS;
  const text = JSON.stringify(doc);
  return typeof out === "string" ? text : Buffer.from(text);
};
syncBuiltinESMExports();
