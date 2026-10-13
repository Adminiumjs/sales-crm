#!/usr/bin/env node
/**
 * Run `proofs/*.test.ts` inside the Adminium checkout `ADMINIUM_REPO` names.
 *
 * The proofs start the whole server in one process and import its modules by
 * relative path, so they run from the server's own test folder: copied in as
 * `zz-crm-*.test.ts`, run with the server's vitest, and removed again whatever
 * the outcome. Extra arguments narrow the run (`npm run proofs -- roles`).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = (path) => (path.startsWith("~/") ? join(process.env.HOME ?? "", path.slice(2)) : path);
const repo = home(process.env.ADMINIUM_REPO ?? "");
const server = join(repo, "apps", "server");
if (repo === "" || !existsSync(join(server, "test"))) {
  console.error("proofs: ADMINIUM_REPO must name an Adminium checkout (with apps/server/test)");
  process.exit(1);
}
const addOns = home(process.env.ADD_ONS_REPO ?? process.env.ADMINIUM_ADD_ONS_REPO ?? "");
const only = process.argv.slice(2);
const files = readdirSync(join(app, "proofs")).filter((name) => name.endsWith(".test.ts") && (only.length === 0 || only.some((word) => name.includes(word))));
if (files.length === 0) {
  console.error(`proofs: nothing matches ${only.join(", ")}`);
  process.exit(1);
}
for (const leg of ["TEST_POSTGRES_URL", "TEST_MYSQL_URL"]) if (!process.env[leg]) console.warn(`proofs: ${leg} is not set, so that engine is NOT run`);

const copied = files.map((name) => join(server, "test", `zz-${name}`));
let status = 1;
try {
  files.forEach((name, i) => copyFileSync(join(app, "proofs", name), copied[i]));
  const run = spawnSync("npx", ["vitest", "run", ...copied.map((path) => path.slice(server.length + 1))], {
    cwd: server,
    stdio: "inherit",
    env: { ...process.env, CRM_APP: app, CRM_SEEDS: join(app, "seeds"), ...(addOns === "" ? {} : { ADMINIUM_ADD_ONS_REPO: addOns }) },
  });
  status = run.status ?? 1;
} finally {
  for (const path of copied) rmSync(path, { force: true });
}
process.exit(status);
