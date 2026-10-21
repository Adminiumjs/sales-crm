/**
 * THE STAND: a real Adminium with this app installed, its sample in, and the
 * sample's people able to sign in.
 *
 * It starts the engine's own built server (`adminium start`) from a checkout
 * named by `ADMINIUM_REPO`, and does everything else through the server's
 * routes, as an owner would: makes the owner, connects a database, stages the
 * add-ons from `ADD_ONS_REPO`, uploads this app as it is built here, installs
 * it with every part on, and loads the sample.
 *
 * ONE THING HERE IS NOT WHAT THE PRODUCT DOES. A sample person cannot sign in
 * (no password, never mailed). The stand gives each one a password straight in
 * Adminium's own store, so a spec can be Dana, Ivy or Hugo and own the rows
 * the ledger's figures are counted from. A real owner tries a role by inviting
 * a real person.
 *
 *   node e2e/stand.mjs up     start it, write e2e/.stand/state.json, keep it running
 *   node e2e/stand.mjs down   stop the one the state file names (by its pid)
 *
 * Environment: ADMINIUM_REPO (built: `apps/server/dist`, `apps/dashboard/dist`),
 * ADD_ONS_REPO (built: `packages/invoices`, `packages/inventory`),
 * CRM_STAND_PORT (default 4774), CRM_STAND_ENGINE (sqlite | postgres | mysql),
 * CRM_STAND_ADD_ONS (the add-ons staged and attached: `invoices,inventory` unless set; `none` for neither),
 * CRM_STAND_STAGE (which stage of the app to install: the released one unless set),
 * CRM_STAND_VERSION (the version the server says, while the engine is unreleased),
 * CRM_STAND_NOW (the moment the sample is added at; the ledger's, unless set;
 * `real` for the real clock) and CRM_STAND_TZ (the server's time zone),
 * TEST_POSTGRES_URL / TEST_MYSQL_URL for the other two engines, and
 * CRM_STAND_MAIL=1 to keep the mail it sends (`e2e/mail-catcher.mjs`: SMTP on
 * the stand's port + 100, the mails at port + 101; `mailbox()` reads them).
 * Adminium never mails a `.example` or `.test` address, so in mail mode the
 * people sign in as `<key>@crm.stand` and the sample's addresses end `.stand`:
 * a spec that reads an address on screen runs on a stand without mail.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, "..");
export const STAND_DIR = join(here, ".stand");
export const STATE_FILE = join(STAND_DIR, "state.json");
/** One password for the owner and one for everybody else: test values, of this stand only. */
const OWNER = { email: "owner@crm.test", name: "Ava Reyes", password: "stand-owner-password-1" };
export const STAFF_PASSWORD = "stand-staff-password-2";
/** The moment every figure of the ledger is true at: 09:35 on Tuesday 28 July 2026, where the sample's business is. */
export const LEDGER_NOW = "2026-07-28T09:35:00+01:00";
export const LEDGER_TZ = "Europe/London";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (line) => console.log(`[stand] ${line}`);
const home = (path) => (path.startsWith("~/") ? join(process.env.HOME ?? "", path.slice(2)) : path);

/** A package tarball, member by member (binary safe): what `npm pack` would make of these files. */
function tarball(files) {
  const BLOCK = 512;
  const members = [];
  const put = (block, at, length, value) => block.set(Buffer.from(value, "latin1").subarray(0, length), at);
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const name = `package/${path}`;
    if (Buffer.byteLength(name) > 100) throw new Error(`a packed path is at most 100 bytes: ${name}`);
    const header = new Uint8Array(BLOCK);
    put(header, 0, 100, name);
    put(header, 100, 8, "0000644\0");
    put(header, 124, 12, `${body.length.toString(8).padStart(11, "0")}\0`);
    put(header, 136, 12, "00000000000\0");
    put(header, 156, 1, "0");
    put(header, 257, 6, "ustar\0");
    put(header, 263, 2, "00");
    header.set(Buffer.from("        ", "latin1"), 148);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i] ?? 0;
    put(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    const padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
    const member = new Uint8Array(BLOCK + body.length + padding);
    member.set(header, 0);
    member.set(body, BLOCK);
    members.push(Buffer.from(member));
  }
  members.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(members));
}
const integrityOf = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

function walk(dir, prefix, into) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`, into);
    else into[`${prefix}${name}`] = readFileSync(full);
  }
  return into;
}

/** A database of the engine asked for: a file for SQLite, a fresh database on the local server for the other two. */
async function sourceDatabase(engine, work, engineRequire) {
  const name = `crm_stand_${randomBytes(4).toString("hex")}`;
  if (engine === "sqlite") {
    const file = join(work, "source.db");
    new (engineRequire("better-sqlite3"))(file).close();
    return { dsn: `sqlite:${file}`, drop: null };
  }
  if (engine === "postgres") {
    const base = process.env.TEST_POSTGRES_URL;
    if (!base) throw new Error("TEST_POSTGRES_URL is needed for the postgres stand");
    const { Client } = engineRequire("pg");
    const admin = new Client({ connectionString: base });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    return { dsn: url.toString(), drop: { engine, base, name } };
  }
  const base = process.env.TEST_MYSQL_URL;
  if (!base) throw new Error("TEST_MYSQL_URL is needed for the mysql stand");
  const mysql = engineRequire("mysql2/promise");
  const admin = await mysql.createConnection(base);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  return { dsn: url.toString(), drop: { engine, base, name } };
}

export function readState() {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : null;
}

/**
 * MAIL MODE ONLY: every address the app could mail moved off the domains kept
 * for examples and tests (`.example`, `.test`), which Adminium never mails, onto
 * `.stand`, a name no one owns. Nothing can leave: the stand's only relay is the
 * catcher. Any column named like `email` in the app's tables (contacts,
 * subcontractors, Inventory's suppliers…) keeps its name before the domain:
 * `marta@veldtstudios.example` becomes `marta@veldtstudios.stand`.
 */
async function moveAddresses(engine, dsn, engineRequire) {
  const ending = ".example";
  let moved = 0;
  if (engine === "sqlite") {
    const db = new (engineRequire("better-sqlite3"))(dsn.slice("sqlite:".length));
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
      for (const column of db.prepare(`PRAGMA table_info("${name}")`).all().filter((one) => one.name.includes("email"))) {
        moved += db.prepare(`UPDATE "${name}" SET "${column.name}" = substr("${column.name}", 1, length("${column.name}") - ${String(ending.length)}) || '.stand' WHERE "${column.name}" LIKE '%${ending}'`).run().changes;
      }
    }
    db.close();
    return moved;
  }
  if (engine === "postgres") {
    const { Client } = engineRequire("pg");
    const db = new Client({ connectionString: dsn });
    await db.connect();
    const found = await db.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name LIKE '%email%' AND data_type IN ('text', 'character varying')");
    for (const row of found.rows) {
      const done = await db.query(`UPDATE "${row.table_name}" SET "${row.column_name}" = left("${row.column_name}", length("${row.column_name}") - ${String(ending.length)}) || '.stand' WHERE "${row.column_name}" LIKE '%${ending}'`);
      moved += done.rowCount ?? 0;
    }
    await db.end();
    return moved;
  }
  const db = await engineRequire("mysql2/promise").createConnection(dsn);
  const [found] = await db.query("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name LIKE '%email%' AND data_type IN ('varchar', 'text')");
  for (const row of found) {
    const [done] = await db.query(`UPDATE \`${row.t}\` SET \`${row.c}\` = CONCAT(LEFT(\`${row.c}\`, CHAR_LENGTH(\`${row.c}\`) - ${String(ending.length)}), '.stand') WHERE \`${row.c}\` LIKE '%${ending}'`);
    moved += done.affectedRows ?? 0;
  }
  await db.end();
  return moved;
}

/** The mails the stand has sent, oldest first (the stand must be up with CRM_STAND_MAIL=1). */
export async function mailbox() {
  const state = readState();
  if (!state?.mail) throw new Error("the stand keeps no mail: start it with CRM_STAND_MAIL=1");
  const res = await fetch(`${state.mail.url}/messages`);
  if (!res.ok) throw new Error(`the mail catcher answered ${String(res.status)}`);
  return res.json();
}

/** Forget every mail kept so far. */
export async function clearMailbox() {
  const state = readState();
  if (!state?.mail) throw new Error("the stand keeps no mail: start it with CRM_STAND_MAIL=1");
  await fetch(`${state.mail.url}/messages`, { method: "DELETE" });
}

/** Whether the process a state file names is still there. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * THE CUSTOMER'S INBOX, stood in for. The code of a quote's link leaves
 * Adminium only inside the e-mail to the customer: nobody on the staff reads
 * it, by any door, and the stand sends no mail. A spec that plays the
 * customer takes the code here, straight from the stand's own database: the
 * second thing the stand does that the product does not.
 */
export async function linkCodeOf(quoteId) {
  const state = readState();
  if (state === null) throw new Error("the stand is not up");
  const id = Number(quoteId);
  if (!Number.isInteger(id)) throw new Error("a quote's number, please");
  const engineRequire = createRequire(join(state.adminiumRepo, "apps", "server", "package.json"));
  if (state.engine === "sqlite") {
    const db = new (engineRequire("better-sqlite3"))(join(state.work, "source.db"), { readonly: true });
    try {
      return String(db.prepare("SELECT share_code FROM crm_quotes WHERE id = ?").get(id)?.share_code ?? "");
    } finally {
      db.close();
    }
  }
  const url = new URL(state.drop.base);
  url.pathname = `/${state.drop.name}`;
  if (state.engine === "postgres") {
    const { Client } = engineRequire("pg");
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      return String((await client.query("SELECT share_code FROM crm_quotes WHERE id = $1", [id])).rows[0]?.share_code ?? "");
    } finally {
      await client.end();
    }
  }
  const connection = await engineRequire("mysql2/promise").createConnection(url.toString());
  try {
    const [rows] = await connection.query("SELECT share_code FROM crm_quotes WHERE id = ?", [id]);
    return String(rows[0]?.share_code ?? "");
  } finally {
    await connection.end();
  }
}

export async function standDown() {
  const state = readState();
  if (state === null) return;
  // By its pid, never by a pattern: another server on this machine has the same name.
  if (typeof state.mail?.pid === "number" && alive(state.mail.pid)) process.kill(state.mail.pid, "SIGTERM");
  if (typeof state.pid === "number" && alive(state.pid)) {
    try {
      process.kill(-state.pid, "SIGTERM");
    } catch {
      process.kill(state.pid, "SIGTERM");
    }
    for (let i = 0; i < 50 && alive(state.pid); i += 1) await sleep(100);
  }
  if (state.drop) {
    try {
      const engineRequire = createRequire(join(state.adminiumRepo, "apps", "server", "package.json"));
      if (state.drop.engine === "postgres") {
        const { Client } = engineRequire("pg");
        const admin = new Client({ connectionString: state.drop.base });
        await admin.connect();
        await admin.query(`DROP DATABASE IF EXISTS ${state.drop.name} WITH (FORCE)`);
        await admin.end();
      } else {
        const admin = await engineRequire("mysql2/promise").createConnection(state.drop.base);
        await admin.query(`DROP DATABASE IF EXISTS \`${state.drop.name}\``);
        await admin.end();
      }
    } catch (error) {
      log(`the stand's database was not dropped: ${String(error)}`);
    }
  }
  if (state.work) rmSync(state.work, { recursive: true, force: true });
  // The server's log outlives the stand, beside the browser run's results: a failed CI run uploads that folder.
  const logFile = join(STAND_DIR, "server.log");
  if (existsSync(logFile)) {
    mkdirSync(join(here, ".results"), { recursive: true });
    copyFileSync(logFile, join(here, ".results", "server.log"));
  }
  rmSync(STAND_DIR, { recursive: true, force: true });
}

export async function standUp() {
  const adminiumRepo = home(process.env.ADMINIUM_REPO ?? "");
  const addOnsRepo = home(process.env.ADD_ONS_REPO ?? process.env.ADMINIUM_ADD_ONS_REPO ?? "");
  const port = Number(process.env.CRM_STAND_PORT ?? "4774");
  const engine = process.env.CRM_STAND_ENGINE ?? "sqlite";
  const cli = join(adminiumRepo, "apps", "server", "dist", "cli", "index.js");
  const dashboard = join(adminiumRepo, "apps", "dashboard", "dist");
  const surface = join(APP, "dist-surface", "crm", "staff");
  for (const [what, path] of [["ADMINIUM_REPO is built (apps/server/dist)", cli], ["the dashboard is built", join(dashboard, "index.html")], ["ADD_ONS_REPO holds Invoices", join(addOnsRepo, "packages", "invoices", "manifest.json")], ["the staff side is built (npm run build:surface)", join(surface, "index.html")]]) {
    if (!existsSync(path)) throw new Error(`the stand needs: ${what} — nothing at ${path}`);
  }
  if (!["sqlite", "postgres", "mysql"].includes(engine)) throw new Error(`CRM_STAND_ENGINE is sqlite, postgres or mysql, not ${engine}`);
  if (readState() !== null) await standDown();
  mkdirSync(STAND_DIR, { recursive: true });
  const url = `http://127.0.0.1:${String(port)}`;
  const engineRequire = createRequire(join(adminiumRepo, "apps", "server", "package.json"));
  // The stage the stand installs: the released one (what an owner gets today) unless another is named. Cut from `whole/` here, so a stage that is not released yet can be stood up too.
  const { readStages, stageFiles } = await import("../scripts/stage-manifest.mjs");
  const stage = Number(process.env.CRM_STAND_STAGE ?? readStages().released);
  const staged_ = stageFiles(stage);
  const manifest = staged_.manifest;

  // The version the server says: its own, unless it is behind what the manifest asks and a stand-in is named.
  const says = JSON.parse(readFileSync(join(adminiumRepo, "apps", "server", "package.json"), "utf8")).version;
  const standIn = process.env.CRM_STAND_VERSION ?? "";

  const asked = process.env.CRM_STAND_NOW ?? LEDGER_NOW;
  const startAt = asked === "real" ? null : new Date(asked).getTime();
  if (startAt !== null && !Number.isFinite(startAt)) throw new Error(`CRM_STAND_NOW is a moment (${LEDGER_NOW}) or "real", not ${asked}`);
  const timeZone = process.env.CRM_STAND_TZ ?? LEDGER_TZ;

  const work = mkdtempSync(join(tmpdir(), "crm-stand-"));
  const clockFile = join(work, "clock");
  const dataDir = join(work, "data");
  mkdirSync(dataDir, { recursive: true });
  const source = await sourceDatabase(engine, work, engineRequire);

  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("ADMINIUM_") || key === "NODE_ENV") continue;
    env[key] = value;
  }
  Object.assign(env, {
    ADMINIUM_REPO: adminiumRepo,
    ADMINIUM_STATIC_ROOT: dashboard,
    ADMINIUM_DATA_DIR: dataDir,
    ADMINIUM_SECRET: createHash("sha256").update(`crm-stand-${work}`).digest("hex"),
    ADMINIUM_ADD_ON_DEV_TRUST: "invoices,inventory",
    // The customer's quote page is served by this same server and calls its public API: "self" is that page's origin.
    ADMINIUM_PUBLIC_API_ORIGINS: "self",
    ...(standIn === "" ? {} : { CRM_STAND_VERSION: standIn }),
    ...(startAt === null ? {} : { CRM_STAND_NOW: String(startAt), CRM_STAND_CLOCK_FILE: clockFile }),
    TZ: timeZone,
  });
  const logFile = join(STAND_DIR, "server.log");
  const fd = openSync(logFile, "w");
  const preload = (file) => ["--import", pathToFileURL(join(here, file)).href];
  const args = [...(standIn === "" ? [] : preload("version-shim.mjs")), ...(startAt === null ? [] : preload("clock.mjs")), cli, "start", "--port", String(port), "--host", "127.0.0.1"];
  const child = spawn(process.execPath, args, { cwd: work, detached: true, stdio: ["ignore", fd, fd], env });
  closeSync(fd);
  child.unref();
  /** Set the server's clock; `still` holds it there. */
  const setClock = (at, still) => {
    if (startAt === null) return;
    writeFileSync(clockFile, still ? `${String(at)} still` : String(at));
    process.kill(child.pid, "SIGUSR2");
  };
  const state = { pid: child.pid, url, port, engine, work, dataDir, adminiumRepo, drop: source.drop, owner: OWNER, staffPassword: STAFF_PASSWORD, timeZone, startedAt: startAt === null ? null : new Date(startAt).toISOString(), version: { server: says, standIn: standIn === "" ? null : standIn, manifestAsks: manifest.compatibility.minAdminiumVersion } };
  const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  save();
  log(`server pid ${String(child.pid)} on ${url} (${engine}); log ${logFile}`);

  // The mail catcher, when asked for: its own process, up before anything can send.
  if (process.env.CRM_STAND_MAIL === "1") {
    const smtpPort = port + 100;
    const httpPort = port + 101;
    const mailLog = openSync(join(STAND_DIR, "mail.log"), "w");
    const catcher = spawn(process.execPath, [join(here, "mail-catcher.mjs"), adminiumRepo, String(smtpPort), String(httpPort)], { cwd: work, detached: true, stdio: ["ignore", mailLog, mailLog] });
    closeSync(mailLog);
    catcher.unref();
    state.mail = { pid: catcher.pid, smtpPort, url: `http://127.0.0.1:${String(httpPort)}` };
    save();
  }

  try {
    for (const deadline = Date.now() + 120_000; ; await sleep(300)) {
      if (!alive(child.pid)) throw new Error(`the server stopped:\n${readFileSync(logFile, "utf8").slice(-4000)}`);
      try {
        if ((await fetch(`${url}/api/v1/healthz`)).ok) break;
      } catch {
        /* not yet */
      }
      if (Date.now() > deadline) throw new Error(`nothing healthy after two minutes:\n${readFileSync(logFile, "utf8").slice(-4000)}`);
    }

    // The owner's own session, kept by hand: the stand has no browser.
    let cookie = "";
    let csrf = "";
    const call = async (label, method, path, body, wanted = [200, 201, 202], headers = {}) => {
      const init = { method, headers: { ...(cookie === "" ? {} : { cookie }), ...(csrf === "" ? {} : { "x-adminium-csrf": csrf }), ...headers } };
      if (body !== undefined) {
        if (Buffer.isBuffer(body)) init.body = body;
        else {
          init.headers["content-type"] = "application/json";
          init.body = JSON.stringify(body);
        }
      }
      const res = await fetch(`${url}${path}`, init);
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length > 0) cookie = set.map((one) => one.split(";")[0]).join("; ");
      const text = await res.text();
      if (!wanted.includes(res.status)) throw new Error(`${label}: ${String(res.status)} ${text.slice(0, 3000)}`);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    };
    const data = (doc) => doc?.data ?? doc;

    // The owner's writes carry the token their session was given (Node's fetch says how it was sent, so the server asks for it).
    csrf = data(await call("the owner", "POST", "/api/v1/setup/super-admin", OWNER, [201])).csrfToken ?? "";
    if (state.mail) {
      for (const deadline = Date.now() + 20_000; ; await sleep(200)) {
        if (!alive(state.mail.pid)) throw new Error(`the mail catcher stopped:\n${readFileSync(join(STAND_DIR, "mail.log"), "utf8").slice(-2000)}`);
        try {
          if ((await fetch(`${state.mail.url}/messages`)).ok) break;
        } catch {
          /* not yet */
        }
        if (Date.now() > deadline) throw new Error("the mail catcher never answered");
      }
      // Adminium's own mail settings, as an owner sets them: the relay is the catcher (no user, so no AUTH; loopback, so plain).
      await call("the mail settings", "PUT", "/api/v1/settings/email", { smtp: { host: "127.0.0.1", port: state.mail.smtpPort, user: "", from: `Meridian <${OWNER.email}>`, secure: false } });
      log(`mail kept at ${state.mail.url}/messages`);
    }
    const connection = data(await call("the connection", "POST", "/api/v1/connections", { name: "Meridian", engine, dsn: source.dsn }, [201]));
    state.connectionId = connection.id ?? connection.connection?.id;
    // Money is the install's currency: the stand's business keeps its books in pounds.
    await call("the currency", "PATCH", `/api/v1/connections/${state.connectionId}`, { currency: process.env.CRM_STAND_CURRENCY ?? "GBP" });

    // The add-ons as they are built in their checkout. Inventory is optional: Supply waits for it. `CRM_STAND_ADD_ONS` names the
    // ones to stage (`none` for none): an install without Invoices and Inventory is the smaller app, Quotes and Supply left out.
    const staged = [];
    const wanted = (process.env.CRM_STAND_ADD_ONS ?? "invoices,inventory").split(",").map((one) => one.trim()).filter((one) => one !== "" && one !== "none");
    for (const key of ["invoices", "inventory"].filter((one) => wanted.includes(one))) {
      const dir = join(addOnsRepo, "packages", key);
      if (!existsSync(join(dir, "manifest.json"))) continue;
      const packDir = mkdtempSync(join(tmpdir(), "crm-stand-pack-"));
      const [packed] = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
      const bytes = readFileSync(join(packDir, packed.filename));
      await call(`the ${key} add-on`, "POST", `/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(integrityOf(bytes))}`, bytes, [200, 201], { "content-type": "application/octet-stream" });
      staged.push({ key, version: packed.version });
      rmSync(packDir, { recursive: true, force: true });
    }
    state.addOns = staged;

    // This app, as built here: the manifest, the sample, and the staff side the browser will open.
    const files = { ...staged_.files };
    walk(surface, "staff/", files);
    // …and the customer side, the one page a quote's link opens.
    const customer = join(APP, "dist-surface", "crm", "customer");
    if (!existsSync(join(customer, "index.html"))) throw new Error(`the stand needs: the customer side is built (npm run build:surface) — nothing at ${customer}`);
    walk(customer, "customer/", files);
    const bytes = tarball(files);
    await call("the app", "POST", `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(integrityOf(bytes))}`, bytes, [200, 201], { "content-type": "application/octet-stream" });
    const parts = Object.fromEntries(manifest.modules.filter((part) => part.default !== "always").map((part) => [part.id, true]));
    const installed = await call("the install", "POST", "/api/v1/apps/install", { key: manifest.key, version: manifest.version, connectionId: state.connectionId, addOns: staged, modules: parts, maps: true });
    state.skippedRules = installed.rules?.skipped ?? [];
    // The public API is off until an owner switches it on (Studio → Settings → Public API): the customer's page needs it.
    await call("the public API switched on", "PUT", "/api/v1/public-api", { enabled: true });

    // The sample goes in at the ledger's moment exactly, however long the install took; the clock runs on from there after.
    setClock(startAt, true);
    await sleep(150);
    await call("the sample", "POST", `/api/v1/apps/${manifest.key}/sample-data`, {});
    for (const deadline = Date.now() + 300_000; ; await sleep(1000)) {
      const status = await call("the sample's state", "GET", `/api/v1/apps/${manifest.key}/sample-data`);
      if (status.loaded) {
        state.sampleRows = status.total;
        setClock(startAt, false);
        break;
      }
      if (Date.now() > deadline) throw new Error(`the sample never loaded: ${JSON.stringify(status).slice(0, 800)}`);
    }

    // The sample's people: ordinary staff with a password, each under an address the specs know.
    const { hashPassword } = await import(pathToFileURL(join(adminiumRepo, "apps", "server", "dist", "auth", "passwords.js")).href);
    const hash = await hashPassword(STAFF_PASSWORD);
    const meta = new (engineRequire("better-sqlite3"))(join(dataDir, "meta.db"));
    meta.pragma("busy_timeout = 10000");
    const columns = meta.prepare("PRAGMA table_info(adminium_users)").all().map((column) => column.name);
    const col = (camel) => (columns.includes(camel) ? camel : camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
    const people = {};
    for (const person of manifest.sampleData.people) {
      const row = meta.prepare("SELECT id, status FROM adminium_users WHERE name = ?").get(person.name);
      if (!row) throw new Error(`the sample made no ${person.name}`);
      meta.prepare(`UPDATE adminium_users SET status = 'active', ${col("passwordHash")} = ?, email = ? WHERE id = ?`).run(hash, `${person.key}@crm.test`, row.id);
      people[person.key] = { id: row.id, email: `${person.key}@crm.test`, name: person.name, role: person.role };
    }
    // With mail kept, the people's addresses are mailable too (`.test` is never mailed).
    if (state.mail) {
      for (const person of Object.values(people)) {
        person.email = person.email.replace(/@crm\.test$/, "@crm.stand");
        meta.prepare("UPDATE adminium_users SET email = ? WHERE id = ?").run(person.email, person.id);
      }
    }
    meta.close();
    state.people = people;
    if (state.mail) log(`mail mode: the people are @crm.stand; ${String(await moveAddresses(engine, source.dsn, engineRequire))} sample addresses moved from .example to .stand`);

    const schema = await call("the schema", "GET", `/api/v1/connections/${state.connectionId}/schema`);
    state.tables = Object.fromEntries((schema.model ?? data(schema).model).tables.map((table) => [table.name, table.id]));
    state.stage = stage;
    state.parts = manifest.modules.map((part) => part.id);
    state.ready = true;
    save();
    log(`ready: ${String(Object.keys(people).length)} people, ${String(state.sampleRows)} sample rows, add-ons ${staged.map((one) => `${one.key} ${one.version}`).join(", ")}`);
    return state;
  } catch (error) {
    save();
    await standDown();
    throw error;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const run = command === "up" ? standUp() : command === "down" ? standDown() : Promise.reject(new Error("say `up` or `down`"));
  run.catch((error) => {
    console.error(`[stand] FAILED: ${error.stack ?? error}`);
    process.exit(1);
  });
}
