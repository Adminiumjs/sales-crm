/**
 * THE UPDATE FROM A RELEASE: a real install of the RELEASED 0.2.0, 0.2.1, 0.2.2, 0.2.3, 0.2.4, 0.2.5, 0.2.6 and 0.2.7,
 * holding the sample and rows typed since by the people who type them, updated to 0.2.9 (the whole app), on SQLite,
 * Postgres and MySQL.
 *
 * Each release is read from its git tag (`v0.2.0` … `v0.2.7`): the manifest and the `seeds/` the package shipped, as
 * the release put them in its file. Before a release is tagged, `CRM_RELEASE_REFS` names the commit that holds it
 * (`0.2.6=<commit>`). The add-ons are what an install had then (`CRM_ADD_ONS_BEFORE`, built: Invoices and
 * Inventory, no Forms) and what the next add-ons release brings (`ADD_ONS_REPO`, built; its version is taken one up
 * when it still says the one installed), Forms among them, installed after the CRM's update.
 *
 * A company's details for Lead finder (0.2.9, on Adminium 0.3.66): companies gain a number in the register, a phone and
 * a few words about them, and the companies entry says where a found company's details go (the `lead` word). Every
 * company is kept as it was, and the three columns are empty on every one. No grant of an add-on's table, part or rule
 * changes: the update from 0.2.8 asks nothing.
 *
 * Landing pages (0.2.8, on Adminium 0.3.65): the marketer's home shows the campaigns, the forms' answers, the funnels'
 * views and the chats, so the marketer reads Forms' forms and answers and Pages' pages and funnels, read only. No table,
 * column, part or rule changes. The update from every release asks the owner for those reads, though no install has
 * Pages yet; once it is installed after the update, the marketer reads its pages and funnels and the operations manager
 * does not.
 *
 * The website chat (0.2.7, on Adminium 0.3.64): a question left outside hours makes an enquiry through the chat entry,
 * and the Team inbox's five roles read the chat an enquiry came from (Live chat's conversations and messages). No table,
 * column, part or rule changes. The update from every release asks the owner for those reads, though no install has
 * Live chat yet; once it is installed after the update, a rep reads its chats and the operations manager does not.
 *
 * A quote paid online (0.2.6, on Adminium 0.3.62): a new table of the Quotes part (`quote_payments`), what a quote asks on
 * acceptance and what was paid of it, and two settings. The update from every release asks the owner to let the
 * customer's link show more of a quote (what is asked, paid and left) and to let the CRM admin and the sales manager
 * refund online payments; the quote's payable arrives switched off. The releases are installed on the engine under test
 * (0.3.64): each says an older floor, which it still meets. The customer's link is the app's only public door (a quote
 * opened by its code, no guest key): its access follows the version as a guest key's does, so the update asks nothing
 * more of it than the wider entry.
 *
 * One app per install (0.2.5, on Adminium 0.3.49): both frontends say `instances`; no table, column, grant, part or rule
 * changed.
 *
 * Website forms and surveys (0.2.4, on Adminium 0.3.42): the update to it asks the owner for the read of Forms' invitations
 * for the five roles that read the aftercare calls, though Forms is not there yet; the brochure and survey rules
 * arrive off, and Surveys (which ships on) waits for Forms until it is installed. A quote still reaches an address on the do-not-email
 * list (a service kind with no purpose); the brochure (a service kind with the newsletter purpose) does not.
 *
 * E-mail to contacts (0.2.3, on Adminium 0.3.38): before the update the release, read as Adminium reads every manifest
 * that says no class, still sends its quote to an address on the do-not-email list; the update carries each contact's old
 * "unsubscribed" moment onto that list once, fills who counts as a customer for every contact, marks nobody as offered a
 * way to say no, and asks no question an add-on's table did not; after it the quote still goes, the referral's thanks
 * goes and the code for a next order (marketing mail) does not.
 *
 *  1. installed as released, with Invoices and Inventory as they were, and its sample;
 *  2. rows typed as the people who type them: Dana the rep (a deal, a DRAFT quote with a line on it, a follow-up on a
 *     deal and one on none, and on 0.2.1 a site visit), on 0.2.1 Ada the operations manager (a job on a won deal of
 *     Dana's and a booked visit of it) and Yusuf of the Blue crew (a sign-off of that visit); the owner switches some
 *     parts and rules off and on;
 *  3. the add-ons update to their next version, every row kept (were the installed Inventory one that does not copy an
 *     order's expected day, a delivery begun before it would NOT take it: a known engine gap, held by an `it.fails`);
 *  4. the CRM update is refused, naming each grant of an add-on's table it widens, and goes when the owner allows it;
 *  5. after it: every table that was there holds exactly the rows it held, each column it had as it was; the parts and
 *     the rules keep their switches (the parts it lacked arrive switched off); every derived column the update adds
 *     (a copy, a formula, a total: worked out here from the two manifests) holds, on every row there, the value its
 *     rule gives, and every other column it adds holds its default or nothing;
 *  6. Dana herself sends the draft quote she made before the update, and the deal takes its amount; afterwards a new
 *     quote on an open deal is made, one on a closed deal refused, and the new grant of Inventory's receipts reads
 *     as the operations manager and is refused to a rep;
 *  7. Forms installed after the update: Surveys waits for nothing and is on (its rule still off); Forms' invitations read as a rep
 *     and are refused to the operations manager; the brochure goes to an enquirer and is stopped at the list.
 *
 * To run: `ADD_ONS_REPO=<next add-ons, built> CRM_ADD_ONS_BEFORE=<add-ons as released, built> npm run proofs -- update`.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { automationsRepo, createFirstSuperAdmin, payableProfilesRepo, createSqliteMetaDb, firstRun, settingsRepo, snapshotsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { encryptSecret } from '../src/config/secrets.js';
import { createConsentService } from '../src/consent/index.js';
import { emailSecretKey } from '../src/email/config.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

// The server says the version it was built at; the app's floor is the release to come.
vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.3.76' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
type Row = Record<string, unknown>;
type Reply = Awaited<ReturnType<AdminiumServer['inject']>>;
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const NEXT = '0.2.9';
const RELEASES = ['0.2.0', '0.2.1', '0.2.2', '0.2.3', '0.2.4', '0.2.5', '0.2.6', '0.2.7', '0.2.8'] as const;
/** A release not tagged yet, read from the commit that holds it: `CRM_RELEASE_REFS=0.2.6=<commit>`. */
const REFS: Record<string, string> = Object.fromEntries((process.env.CRM_RELEASE_REFS ?? '').split(',').filter((pair) => pair.includes('=')).map((pair) => pair.split('=', 2) as [string, string]));
const refOf = (version: string): string => REFS[version] ?? `v${version}`;
/** What 0.2.6 adds to a quote, worked out by the server, and the two it takes from Settings when it is made; and the two settings. */
const PAY_DERIVED = ['quotes.pay_amount', 'quotes.pay_due', 'quotes.pay_open', 'quotes.pay_paid', 'quotes.pay_paid_at', 'quotes.pay_provider', 'quotes.pay_refunded'];
const PAY_PLAIN = ['quotes.pay_ask', 'quotes.pay_pct', 'settings.pay_ask', 'settings.pay_deposit_pct'];
type Release = (typeof RELEASES)[number];

interface Column {
  ref: string;
  type: string;
  nullable?: boolean;
  default?: unknown;
  references?: string;
  role?: string;
  rules?: { copy?: { via: string; from: string }; formula?: unknown; rollup?: { from: string; via: string; count?: boolean; where?: { column: string; eq: unknown }; unlessSet?: string } } & Record<string, unknown>;
}
interface Table {
  ref: string;
  columns: Column[];
}
interface Grant {
  addOn: string;
  table: string;
  actions: string[];
  limit?: { readable?: string[] };
}
interface Doc {
  key: string;
  version: string;
  requiredSchema: { tables: Table[] };
  modules: { id: string }[];
  roles: { key: string; name?: unknown; tables?: Grant[] }[];
  automations?: { key: string; enabled?: boolean }[];
  sampleData: { people: { key: string; name: string; role: string }[] };
}

// ---------------------------------------------------------------------------------------------------------------------
// What is installed and what it updates to: the releases from their tags, 0.2.2 from the app's own stage script.

const git = (...args: string[]): Buffer => execFileSync('git', ['-C', APP, ...args], { maxBuffer: 1 << 30 });
const tagged = (version: Release): boolean => {
  try {
    git('rev-parse', '--verify', '--quiet', `${refOf(version)}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

/** A package as the server takes it: text files only, each picture's bytes stood in for (its place in the package is what counts). */
function packed(files: Record<string, string | Buffer>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (path === 'manifest.json') continue;
    out[path] = typeof content === 'string' ? content : 'png';
  }
  const sample = JSON.parse(out['seeds/meridian.json']!) as { assets?: Record<string, { sha256: string }> };
  for (const asset of Object.values(sample.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
  out['seeds/meridian.json'] = JSON.stringify(sample);
  return out;
}

/** A release as its tag holds it: `manifest.json`, and every file under `seeds/` (what `publish-app.mjs` puts in the package). */
function released(version: Release): { manifest: Doc; files: Record<string, string> } {
  const tag = refOf(version);
  const manifest = JSON.parse(git('show', `${tag}:manifest.json`).toString('utf8')) as Doc;
  expect(manifest.version).toBe(version);
  const files: Record<string, string | Buffer> = {};
  for (const path of git('ls-tree', '-r', '--name-only', tag, 'seeds/').toString('utf8').split('\n').filter(Boolean)) {
    const bytes = git('show', `${tag}:${path}`);
    files[path] = /\.(json|txt|csv|md)$/.test(path) ? bytes.toString('utf8') : bytes;
  }
  return { manifest, files: packed(files) };
}

/** 0.2.9: the whole app, cut by the app's own script (stage 3 is the whole), numbered as the release will be. */
async function next(): Promise<{ manifest: Doc; files: Record<string, string> }> {
  const script = (await import(pathToFileURL(`${APP}/scripts/stage-manifest.mjs`).href)) as { stageFiles: (stage: number) => { manifest: Doc; files: Record<string, string | Buffer> } };
  const three = script.stageFiles(3);
  return { manifest: { ...three.manifest, version: NEXT }, files: packed(three.files) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The add-ons: as an install had them, and as the next release brings them.

interface AddOn {
  key: string;
  version: string;
  manifest: Row;
  files: Record<string, string>;
}
const home = (path: string | undefined): string | undefined => (path === undefined || path === '' ? undefined : path.startsWith('~/') ? join(process.env.HOME ?? '', path.slice(2)) : path);
const BEFORE_REPO = home(process.env.CRM_ADD_ONS_BEFORE);
const AFTER_REPO = home(process.env.ADMINIUM_ADD_ONS_REPO);

/** An add-on of a checkout as it is built: its manifest and every file of its package the manifest names. Null when not built. */
function addOnAt(repo: string | undefined, key: string): AddOn | null {
  if (repo === undefined) return null;
  const root = join(repo, 'packages', key);
  if (!existsSync(join(root, 'manifest.json'))) return null;
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Row;
  const addOn = (manifest['addOn'] ?? {}) as { provides?: { server?: string }[]; pages?: { client?: string }[]; slots?: { client?: string }[] };
  const sample = (manifest['sampleData'] as { file?: string } | undefined)?.file;
  const named = [...(addOn.provides ?? []).map((one) => one.server), ...(addOn.pages ?? []).map((one) => one.client), ...(addOn.slots ?? []).map((one) => one.client), sample];
  const files: Record<string, string> = {};
  for (const path of new Set(named.filter((one): one is string => typeof one === 'string'))) {
    if (!existsSync(join(root, path))) return null;
    files[path] = readFileSync(join(root, path), 'utf8');
  }
  return { key, version: String(manifest['version']), manifest, files };
}
/** The next release of an add-on: one patch up from what the install has, when the checkout still says the same. */
function bumped(after: AddOn | null, before: AddOn | null): AddOn | null {
  if (after === null || before === null) return after;
  if (after.version !== before.version) return after;
  const version = after.version.replace(/\d+$/, (patch) => String(Number(patch) + 1));
  return { ...after, version, manifest: { ...after.manifest, version } };
}
const ADD_ONS = ['invoices', 'inventory'] as const;
const before = Object.fromEntries(ADD_ONS.map((key) => [key, addOnAt(BEFORE_REPO, key)])) as Record<(typeof ADD_ONS)[number], AddOn | null>;
const after = Object.fromEntries(ADD_ONS.map((key) => [key, bumped(addOnAt(AFTER_REPO, key), before[key])])) as Record<(typeof ADD_ONS)[number], AddOn | null>;
/** Forms, which no install had before: installed after the CRM's update, at the next add-ons release. */
const formsNext = addOnAt(AFTER_REPO, 'forms');
/** Live chat, which no install had before: installed after the CRM's update, numbered as the release will (the app suggests 1.0.30 or newer). */
const chatBuilt = addOnAt(AFTER_REPO, 'live-chat');
const chatNext: AddOn | null = chatBuilt === null ? null : { ...chatBuilt, version: '1.0.30', manifest: { ...chatBuilt.manifest, version: '1.0.30' } };
/** What every release before 0.2.7 is asked of Live chat's tables: the Team inbox's five roles read a chat and its lines. */
const CHAT_READS = ['admin', 'front-desk', 'marketer', 'rep', 'sales-manager'].flatMap((role) => [
  { role, addOn: 'live-chat', table: 'conversations', actions: ['read'], columns: ['id', 'started_at', 'outside_hours', 'became_table', 'became_key'] },
  { role, addOn: 'live-chat', table: 'messages', actions: ['read', 'read_pii'], columns: ['id', 'conversation_id', 'kind', 'body', 'event', 'author_id', 'sent_at'] },
]);
/** Pages, which no install had before: installed after the CRM's update, numbered as its first release will be (the app suggests 1.0.31 or newer). */
const pagesBuilt = addOnAt(AFTER_REPO, 'pages');
const pagesNext: AddOn | null = pagesBuilt === null ? null : { ...pagesBuilt, version: '1.0.31', manifest: { ...pagesBuilt.manifest, version: '1.0.31' } };
/** What every release before 0.2.8 is asked for the marketer's home: Forms' forms and answers, Pages' pages and funnels, read only. */
const MARKETER_READS = [
  { role: 'marketer', addOn: 'forms', table: 'answers', actions: ['read'], columns: ['id', 'form_id', 'submitted_at'] },
  { role: 'marketer', addOn: 'forms', table: 'forms', actions: ['read'], columns: ['id', 'name', 'kind', 'state'] },
  { role: 'marketer', addOn: 'pages', table: 'funnels', actions: ['read'], columns: ['id', 'name', 'steps'] },
  { role: 'marketer', addOn: 'pages', table: 'pages', actions: ['read'], columns: ['id', 'name', 'slug', 'state', 'language', 'published_at'] },
];
const isMarketerRead = (grant: { role: string; addOn: string; table: string }): boolean => MARKETER_READS.some((one) => one.role === grant.role && one.addOn === grant.addOn && one.table === grant.table);
const haveAddOns = ADD_ONS.every((key) => before[key] !== null && after[key] !== null) && formsNext !== null && chatNext !== null && pagesNext !== null;
/** Whether an Inventory copies an order's expected day onto each delivery (from 1.0.14). */
const copiesExpectedDay = (addOn: AddOn | null): boolean => ((addOn?.manifest['requiredSchema'] as { tables?: Table[] } | undefined)?.tables ?? []).some((table) => table.ref === 'receipts' && table.columns.some((column) => column.ref === 'expected_on'));

function addOnTarball(addOn: AddOn): Uint8Array {
  return packageTarball({
    'manifest.json': JSON.stringify(addOn.manifest),
    'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${addOn.key}`, version: addOn.version }),
    'dist/client.js': 'export const register = () => {};',
    ...addOn.files,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The two manifests compared: what the update adds.

const derivedRule = (column: Column): 'copy' | 'formula' | 'rollup' | null =>
  column.rules?.copy !== undefined ? 'copy' : column.rules?.formula !== undefined ? 'formula' : column.rules?.rollup !== undefined ? 'rollup' : null;

interface Added {
  table: string;
  column: Column;
}
/** The columns of the tables `was` had that `now` adds, split into those Adminium works out and the rest. */
function addedColumns(was: Doc, now: Doc): { derived: Added[]; plain: Added[] } {
  const had = new Map(was.requiredSchema.tables.map((table) => [table.ref, new Set(table.columns.map((column) => column.ref))]));
  const derived: Added[] = [];
  const plain: Added[] = [];
  for (const table of now.requiredSchema.tables) {
    const columns = had.get(table.ref);
    if (columns === undefined) continue;
    for (const column of table.columns) {
      if (columns.has(column.ref)) continue;
      (derivedRule(column) === null ? plain : derived).push({ table: table.ref, column });
    }
  }
  return { derived, plain };
}

/** What a role of `now` holds MORE of an add-on's tables than the same role of `was`: what the owner is asked to allow. */
function widerGrants(was: Doc, now: Doc): { role: string; addOn: string; table: string; actions: string[]; columns: string[] }[] {
  const out: { role: string; addOn: string; table: string; actions: string[]; columns: string[] }[] = [];
  for (const role of now.roles) {
    const held = was.roles.find((one) => one.key === role.key)?.tables ?? [];
    for (const grant of role.tables ?? []) {
      const had = held.find((one) => one.addOn === grant.addOn && one.table === grant.table);
      const actions = grant.actions.filter((action) => !(had?.actions ?? []).includes(action));
      const columns = (grant.limit?.readable ?? []).filter((column) => had === undefined || !(had.limit?.readable ?? []).includes(column));
      if (actions.length > 0 || columns.length > 0) out.push({ role: role.key, addOn: grant.addOn, table: grant.table, actions, columns });
    }
  }
  return out.sort((a, b) => `${a.role}/${a.table}`.localeCompare(`${b.role}/${b.table}`));
}

/** One value, spelled the same whichever engine answered it. */
function plainValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'number' || typeof value === 'bigint') return String(Number(value));
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return String(Number(value));
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A formula of the manifest's, worked out over a row as the manifest says: the few words the added formulas use. Anything else is a gap of this proof, named. */
function formulaOf(formula: unknown, row: Row): unknown {
  if (typeof formula === 'number' || formula === null) return formula;
  if (typeof formula === 'string') return row[formula];
  const [[word, args]] = Object.entries(formula as Record<string, unknown>) as [[string, unknown]];
  const list = args as unknown[];
  if (word === 'if') return formulaOf(list[0], row) ? formulaOf(list[1], row) : formulaOf(list[2], row);
  if (word === 'isNull') return row[args as string] === null || row[args as string] === undefined;
  if (word === 'coalesce') return list.map((one) => formulaOf(one, row)).find((one) => one !== null && one !== undefined) ?? null;
  if (word === 'eq') return plainValue(formulaOf(list[0], row)) === plainValue(formulaOf(list[1], row));
  if (word === 'neq') return plainValue(formulaOf(list[0], row)) !== plainValue(formulaOf(list[1], row));
  if (word === 'and') return list.every((one) => formulaOf(one, row) === true);
  // Numbers: what the added formulas take over rows that ask nothing (a quote made before 0.2.6), exact enough here.
  const n = (one: unknown): number | null => {
    const value = formulaOf(one, row);
    return value === null || value === undefined ? null : Number(value);
  };
  if (word === 'gt') return (n(list[0]) ?? Number.NaN) > (n(list[1]) ?? Number.NaN);
  if (word === 'sub') return n(list[0]) === null || n(list[1]) === null ? null : n(list[0])! - n(list[1])!;
  if (word === 'mul') return list.some((one) => n(one) === null) ? null : list.reduce<number>((product, one) => product * n(one)!, 1);
  if (word === 'div') return n(list[0]) === null || !n(list[1]) ? null : n(list[0])! / n(list[1])!;
  if (word === 'max') return list.some((one) => n(one) === null) ? null : Math.max(...list.map((one) => n(one)!));
  throw new Error(`this proof cannot work out the formula word "${word}": add it here before trusting the check`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The whole server over a fresh database.

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `crm_upd_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'source.db');
    new BetterSqlite3(file).close();
    return { dsn: `sqlite:${file}`, drop: async () => undefined };
  }
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    return {
      dsn: url.toString(),
      drop: async () => {
        const again = new Client({ connectionString: POSTGRES_URL });
        await again.connect();
        await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await again.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const admin = await mysql.createConnection(MYSQL_URL as string);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const url = new URL(MYSQL_URL as string);
  url.pathname = `/${name}`;
  return {
    dsn: url.toString(),
    drop: async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    },
  };
}

interface Stack {
  app: AdminiumServer;
  meta: MetaDb;
  connectionId: string;
  hash: string;
  rows: (statement: string) => Promise<Row[]>;
  tables: () => Promise<string[]>;
  /** The id the data routes name a table by, read from the latest look at the database. */
  t: (name: string) => string;
  /** Look at the database again (after an update made tables). */
  reread: () => Promise<void>;
  jobs: () => Promise<void>;
  close: () => Promise<void>;
}

let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.31.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

async function stack(dialect: Dialect): Promise<Stack> {
  process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'invoices,inventory,forms';
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-update-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const hash = await adminPasswordHash();
  await createFirstSuperAdmin(meta, { email: 'owner@crm.test', name: 'Owner', passwordHash: hash });
  // Outgoing mail set up (never delivered: nothing listens), so a message is queued and its row says "sent".
  await settingsRepo(meta).set(
    'email.smtp',
    { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Meridian <no-reply@meridian-workplace.co.uk>', secure: false },
    { updatedBy: null },
  );
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Meridian', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  const app = composed.app;
  await app.ready();
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  const handle = await manager.data(connection.id);
  let model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const listing =
    dialect === 'sqlite'
      ? "select name as n from sqlite_master where type = 'table' and name not like 'sqlite_%'"
      : dialect === 'postgres'
        ? "select table_name as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"
        : "select table_name as n from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE'";
  const rows = async (statement: string) => (await sql.raw<Row>(statement).execute(handle.db)).rows;
  return {
    app,
    meta,
    connectionId: connection.id,
    hash,
    rows,
    tables: async () => (await rows(listing)).map((row) => String(row['n'] ?? row['N'] ?? row['TABLE_NAME'])).sort(),
    t: (name) => {
      const found = model.tables.find((table) => table.name === name);
      if (found === undefined) throw new Error(`no table ${name} in the latest look at the database`);
      return found.id;
    },
    reread: async () => {
      model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
    },
    jobs: async () => {
      for (let round = 0; round < 20; round += 1) {
        // A mail handed to the queue is the outbox's "sent": nothing listens for it, so it is never tried (as the whole-server tests keep it).
        await meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('kind', '=', 'email.send').where('status', '=', 'pending' as never).execute();
        await meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).execute();
        if ((await composed.jobs.worker.runOnce()) === 0) break;
      }
    },
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** `ok`, or `<status> <code>`: what a try came back with. */
const said = (res: Reply): string => {
  if (res.statusCode < 300) return 'ok';
  let code = '';
  try {
    code = (res.json() as { error?: { code?: string } }).error?.code ?? '';
  } catch {
    code = '';
  }
  return `${String(res.statusCode)} ${code}`.trim();
};
const DAY = 86_400_000;
/** Pat, a contact typed in before the update, who said no to the business's mail; Rowan, whose old release marked him unsubscribed. */
const PAT = 'pat.quinn@harbourline-dental.co.uk';
const ROWAN = 'rowan.hale@harbourline-dental.co.uk';
/** Kim, who asks for the brochure on a website form after the update, on no list. */
const KIM = 'kim.hart@harbourline-dental.co.uk';
const inDays = (days: number, hour = 10): string => {
  const at = new Date(Date.now() + days * DAY);
  at.setUTCHours(hour, 0, 0, 0);
  return at.toISOString();
};
const dayIn = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
/** The first day at least `days` ahead that the sample's crews work (Monday to Friday): a crew is not booked on its day off. */
const workdayIn = (days: number): string => {
  for (let ahead = days; ; ahead += 1) {
    const day = dayIn(ahead);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return day;
  }
};

/** Every row of every table, by its key: what "nothing was lost or changed" is held to. */
async function everyRow(s: Stack): Promise<Map<string, Map<string, Row>>> {
  const out = new Map<string, Map<string, Row>>();
  for (const table of await s.tables()) {
    const rows = await s.rows(`select * from ${table}`);
    out.set(table, new Map(rows.map((row) => [row['id'] === undefined ? JSON.stringify(Object.values(row).map(plainValue)) : plainValue(row['id'])!, row])));
  }
  return out;
}
/** What of `was` is not in `now` as it was: a table, a row, a column's value. */
function lostOrChanged(was: Map<string, Map<string, Row>>, now: Map<string, Map<string, Row>>, skip: (table: string, column: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const [table, rows] of was) {
    const after = now.get(table);
    if (after === undefined) {
      out.push(`${table}: gone`);
      continue;
    }
    if (after.size !== rows.size) out.push(`${table}: ${String(rows.size)} rows, now ${String(after.size)}`);
    for (const [key, row] of rows) {
      const kept = after.get(key);
      if (kept === undefined) {
        out.push(`${table} ${key}: gone`);
        continue;
      }
      for (const [column, value] of Object.entries(row)) {
        if (skip(table, column)) continue;
        if (plainValue(kept[column]) !== plainValue(value)) out.push(`${table} ${key}.${column}: ${String(plainValue(value))} → ${String(plainValue(kept[column]))}`);
      }
    }
  }
  return out.slice(0, 40);
}

describe.skipIf(haveAddOns && RELEASES.every(tagged))('the CRM updated from its releases', () => {
  it('needs both releases tagged, and the add-ons as released and as next, built', () => {
    throw new Error(
      `tags ${RELEASES.filter((one) => !tagged(one)).join(', ') || 'present'}; CRM_ADD_ONS_BEFORE ${BEFORE_REPO ?? 'unset'}, ADD_ONS_REPO ${AFTER_REPO ?? 'unset'}: each needs Invoices and Inventory built, the next one Forms, Live chat and Pages too`,
    );
  });
});

for (const [dialect, reachable] of LEGS) {
  for (const from of RELEASES) {
    describe.skipIf(!reachable || !haveAddOns || !tagged(from))(`the released CRM ${from}, holding data, updated to ${NEXT}, on ${dialect}`, () => {
      let s: Stack;
      let was: { manifest: Doc; files: Record<string, string> };
      let now: { manifest: Doc; files: Record<string, string> };
      const cookie: Record<string, string> = {};
      const id: Record<string, string> = {};
      /** The rows the people typed, by what they are. */
      const typed: Record<string, number> = {};
      let rowsBefore = new Map<string, Map<string, Row>>();
      let partsBefore: Record<string, boolean> = {};
      let rulesBefore: Record<string, boolean> = {};
      let updateReply: { derived?: { filled: { table: string; column: string; rows: number }[]; skipped: unknown[] } } = {};
      const has21 = from !== '0.2.0';
      /** 0.2.2 and later already let Supply's roles read Inventory's receipts; 0.2.3 and later already have the mark of the line and the count of won deals; 0.2.4 already has website forms and surveys. */
      const has22 = from !== '0.2.0' && from !== '0.2.1';
      const has23 = has22 && from !== '0.2.2';
      const has24 = from === '0.2.4' || from === '0.2.5' || from === '0.2.6' || from === '0.2.7' || from === '0.2.8';
      /** 0.2.6 and later already take a quote's payments online: the update asks nothing of them. */
      const has26 = from === '0.2.6' || from === '0.2.7' || from === '0.2.8';
      /** 0.2.7 already lets the Team inbox's roles read the chat an enquiry came from. */
      const has27 = from === '0.2.7' || from === '0.2.8';
      /** 0.2.8 already lets the marketer read Forms' and Pages' tables: the update asks nothing at all. */
      const has28 = from === '0.2.8';
      const installedAddOns = before;
      const nextAddOns = after;

      const url = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(`crm_${ref}`)}${rest}`;
      const as = (person: string, method: string, path: string, payload?: unknown) => s.app.inject({ method: method as 'GET', url: path, headers: { cookie: cookie[person]! }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
      const post = (person: string, ref: string, values: Row) => as(person, 'POST', url(ref), { values });
      const patch = (person: string, ref: string, key: number, values: Row) => as(person, 'PATCH', url(ref, `/${String(key)}`), { values });
      const made = (res: Reply): number => {
        expect(res.statusCode, res.body).toBeLessThan(300);
        return Number((res.json() as { data: { id: unknown } }).data.id);
      };
      const one = async (statement: string): Promise<Row> => {
        const found = (await s.rows(statement))[0];
        expect(found, statement).toBeDefined();
        return found!;
      };
      /** A quote of the deal to the contact at list price, sent by Dana; its key. */
      const sendQuote = async (deal: number, to: number, price: Row): Promise<number> => {
        const quote = made(await post('dana', 'quotes', { deal_id: deal, sent_to_contact_id: to }));
        made(await post('dana', 'quote_lines', { document_id: quote, qty: 2, rate: price['list_rate'], price_id: price['id'], description: 'Chairs' }));
        expect(said(await patch('dana', 'quotes', quote, { status: 'sent' }))).toBe('ok');
        return quote;
      };
      /** What the outbox did: each message's kind, address, status and why, once every waiting one is due. */
      const outboxOf = async (where: string): Promise<unknown[][]> => {
        await s.jobs();
        await s.rows(`update crm_outbox set due_at = '${dialect === 'mysql' ? '2000-01-01 00:00:00' : '2000-01-01T00:00:00.000Z'}' where status = 'queued'`);
        await s.app.outboxSender.sendApp('crm', Date.now());
        await s.jobs();
        const to = dialect === 'mysql' ? '`to`' : '"to"';
        return (await s.rows(`select kind, ${to} as addr, status, error from crm_outbox where ${where} order by id`)).map((row) => [row['kind'], row['addr'], row['status'], row['error'] ?? null]);
      };
      const quoteMail = (quote: number) => outboxOf(`quote_id = ${String(quote)}`);
      const parts = async (): Promise<Record<string, boolean>> => {
        const res = await as('owner', 'GET', '/api/v1/apps/crm/parts');
        expect(res.statusCode, res.body).toBe(200);
        return Object.fromEntries((res.json() as { parts: { id: string; on: boolean }[] }).parts.map((part) => [part.id, part.on]));
      };
      const waitingFor = async (part: string): Promise<string[]> => {
        const res = await as('owner', 'GET', '/api/v1/apps/crm/parts');
        expect(res.statusCode, res.body).toBe(200);
        return ((res.json() as { parts: { id: string; waiting?: { key: string }[] }[] }).parts.find((one) => one.id === part)?.waiting ?? []).map((one) => one.key);
      };
      const rules = async (): Promise<Record<string, boolean>> => Object.fromEntries((await automationsRepo(s.meta).listManagedBy('crm', s.connectionId)).map((rule) => [rule.templateKey ?? rule.id, rule.enabled]));
      const upload = async (path: string, bytes: Uint8Array) => {
        const res = await s.app.inject({ method: 'POST', url: `${path}?expectedSha512=${encodeURIComponent(sha512Integrity(bytes))}`, headers: { cookie: cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(bytes) });
        expect(res.statusCode, res.body).toBeLessThan(300);
      };
      const appTarball = (manifest: Doc, files: Record<string, string>) =>
        packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html><body></body></html>', 'customer/index.html': '<!doctype html><html><body></body></html>', ...files });

      beforeAll(async () => {
        was = released(from);
        now = await next();
        s = await stack(dialect);
        cookie['owner'] = await signIn(s.app, 'owner@crm.test');
      }, 600_000);
      afterAll(async () => {
        await s?.close();
      });

      it(`installs as ${from} was released, with Invoices and Inventory as an install of it had them, and its sample`, async () => {
        for (const key of ADD_ONS) await upload('/api/v1/add-ons/upload', addOnTarball(installedAddOns[key]!));
        await upload('/api/v1/apps/upload', appTarball(was.manifest, was.files));
        // The owner leaves one part unticked: on 0.2.0 the Inbox, on 0.2.1 the Showroom.
        const modules = has21 ? { quotes: true, inbox: true, showroom: false, jobs: true, aftercare: true, supply: true, fleet: true } : { quotes: true, inbox: false, supply: true };
        const installed = await as('owner', 'POST', '/api/v1/apps/install', { key: 'crm', version: from, connectionId: s.connectionId, addOns: ADD_ONS.map((key) => ({ key, version: installedAddOns[key]!.version })), modules });
        expect(installed.statusCode, installed.body).toBe(200);
        const sample = await as('owner', 'POST', '/api/v1/apps/crm/sample-data', {});
        expect(sample.statusCode, sample.body).toBe(200);
        await s.jobs();
        const loaded = (await as('owner', 'GET', '/api/v1/apps/crm/sample-data')).json() as { loaded?: boolean };
        expect(loaded.loaded, JSON.stringify(loaded).slice(0, 800)).toBe(true);
        await s.reread();
        const tables = (await s.tables()).filter((name) => name.startsWith('crm_') && name !== 'crm_sample_data');
        expect(tables.length).toBe(was.manifest.requiredSchema.tables.length);
        // The sample's people, as ordinary staff with a password.
        const people = await usersRepo(s.meta).list({ status: 'sample', limit: 50 });
        expect(people).toHaveLength(was.manifest.sampleData.people.length);
        for (const person of was.manifest.sampleData.people) {
          const user = people.find((p) => p.name === person.name)!;
          expect(user, person.name).toBeDefined();
          await s.meta.db.updateTable('adminium_users').set({ status: 'active', passwordHash: s.hash, email: `${person.key}@crm.test` }).where('id', '=', user.id).execute();
          id[person.key] = user.id;
        }
        for (const key of ['dana', 'priya', 'ada', 'tessa', 'lena', ...(has21 ? ['f_yusuf'] : [])]) cookie[key] = await signIn(s.app, `${key}@crm.test`);
      }, 900_000);

      it('takes rows typed since, each by the person who types it', async () => {
        const contact = await one("select id, company_id from crm_contacts where email is not null order by id");
        const stage = await one('select id from crm_stages order by position, id');
        const price = (await s.rows('select id, list_rate, active from crm_price_list order by id')).find((row) => plainValue(row['active']) === '1' && row['list_rate'] !== null)!;
        expect(price, 'the sample has a price on the list').toBeDefined();
        // Dana's deal, and a draft quote of it at list price, to a contact with an address: one she could send.
        typed['deal'] = made(await post('dana', 'deals', { name: `Typed before the update ${from}`, company_id: contact['company_id'], contact_id: contact['id'], stage_id: stage['id'], owner_id: id['dana'], typed_amount: 4000 }));
        typed['quote'] = made(await post('dana', 'quotes', { deal_id: typed['deal'], sent_to_contact_id: contact['id'] }));
        typed['line'] = made(await post('dana', 'quote_lines', { document_id: typed['quote'], qty: 3, rate: price['list_rate'], price_id: price['id'], description: 'Typed line' }));
        // Dana's next steps: one on the deal, one on none.
        typed['stepOnDeal'] = made(await post('dana', 'follow_ups', { deal_id: typed['deal'], owner_id: id['dana'], due_at: inDays(4), text: 'Call back about the quote', kind: 'step' }));
        typed['stepAlone'] = made(await post('dana', 'follow_ups', { owner_id: id['dana'], due_at: inDays(6), text: 'Plan the week', kind: 'step' }));
        // Priya helps on it ("Also on this deal"), with a follow-up of her own there: made by the install's owner, so the
        // proof does not hang on what each release let a helper write.
        typed['helper'] = made(await as('owner', 'POST', url('deal_members'), { values: { deal_id: typed['deal'], user_id: id['priya'] } }));
        typed['helperStep'] = made(await as('owner', 'POST', url('follow_ups'), { values: { deal_id: typed['deal'], owner_id: id['priya'], due_at: inDays(5), text: 'Priya sends the brochure', kind: 'step' } }));
        // Another deal of hers, quoted while open, then won: its quote is a quote of a closed deal.
        typed['wonDeal'] = made(await post('dana', 'deals', { name: `Won before the update ${from}`, company_id: contact['company_id'], contact_id: contact['id'], stage_id: stage['id'], owner_id: id['dana'], typed_amount: 6000 }));
        typed['wonQuote'] = made(await post('dana', 'quotes', { deal_id: typed['wonDeal'], sent_to_contact_id: contact['id'] }));
        expect(said(await patch('dana', 'deals', typed['wonDeal'], { state: 'won' }))).toBe('ok');
        const quote = await one(`select status, deal_id, total from crm_quotes where id = ${String(typed['quote'])}`);
        expect([quote['status'], Number(quote['total'])]).toEqual(['draft', 3 * Number(price['list_rate'])]);
        if (has21) {
          // Dana books a site visit on her deal; Ada makes a job of a won deal of Dana's and books its visit for the Blue crew; Yusuf of that crew signs it off.
          typed['siteVisit'] = made(await post('dana', 'site_visits', { deal_id: typed['deal'], contact_id: contact['id'], rep_id: id['dana'], starts_at: inDays(3, 19), minutes: 45, purpose: 'Measure up before the update' }));
          // The deal Dana won makes its job (0.2.1's rule); Ada makes it by hand if the rule has not.
          await s.jobs();
          const ruled = (await s.rows(`select id from crm_jobs where deal_id = ${String(typed['wonDeal'])}`))[0];
          typed['job'] = ruled === undefined ? made(await post('ada', 'jobs', { deal_id: typed['wonDeal'], site_name: 'Typed site', town: 'Leeds' })) : Number(ruled['id']);
          const blue = await one("select c.id from crm_crews c where c.name like 'Blue%'");
          typed['jobVisit'] = made(await post('ada', 'job_visits', { job_id: typed['job'], kind: 'install', what: 'Fit the desks', day: workdayIn(5), crew_id: blue['id'], hours: 4, crew_size: 2 }));
          expect(said(await patch('ada', 'job_visits', typed['jobVisit'], { state: 'booked' }))).toBe('ok');
          typed['signOff'] = made(await post('f_yusuf', 'sign_offs', { visit_id: typed['jobVisit'], check_1: true, check_2: true, check_3: true, check_4: true, check_5: true, signer_name: 'Pat Client' }));
          expect(Number((await one(`select job_id from crm_sign_offs where id = ${String(typed['signOff'])}`))['job_id'])).toBe(typed['job']);
        }
        // The owner, who keeps the stock: an order of the sample's sent to its supplier, and its delivery begun.
        const inv = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(`inventory_${ref}`)}${rest}`;
        const supplier = await one('select id from inventory_suppliers order by id');
        const place = await one('select id from inventory_places order by id');
        const item = await one('select id from inventory_items order by id');
        const order = { id: made(await as('owner', 'POST', inv('purchase_orders'), { values: { supplier_id: supplier['id'], place_id: place['id'], sent_how: 'none' } })), place_id: place['id'] };
        made(await as('owner', 'POST', inv('po_lines'), { values: { po_id: order.id, item_id: item['id'], packs: 4, pack_size: 1, price: '10.00' } }));
        expect(said(await as('owner', 'PATCH', inv('purchase_orders', `/${String(order.id)}`), { values: { status: 'sent' } }))).toBe('ok');
        expect((await one(`select expected_on from inventory_purchase_orders where id = ${String(order.id)}`))['expected_on']).not.toBeNull();
        typed['receipt'] = made(await as('owner', 'POST', inv('receipts'), { values: { kind: 'delivery', po_id: order.id, place_id: order.place_id } }));
        // E-MAIL TO CONTACTS, BEFORE THE UPDATE (engine first). Pat, typed in by Dana with an address of her own business,
        // said no to the business's mail by a link: the do-not-email list this Adminium keeps. Dana sends her a quote. The
        // release says no class of its mail, so Adminium reads it as service, and the quote goes.
        typed['pat'] = made(await post('dana', 'contacts', { company_id: contact['company_id'], name: 'Pat Quinn', email: PAT, may_email: false }));
        await createConsentService({ meta: s.meta, secret: TEST_SECRET }).stop.add({ address: PAT, reason: 'link' });
        typed['patDeal'] = made(await post('dana', 'deals', { name: `Chairs for Pat ${from}`, company_id: contact['company_id'], contact_id: typed['pat'], stage_id: stage['id'], owner_id: id['dana'], typed_amount: 2500 }));
        typed['patQuote'] = await sendQuote(typed['patDeal']!, typed['pat']!, price);
        expect(await quoteMail(typed['patQuote']!)).toEqual([['quote-sent', PAT, 'sent', null]]);
        // The release's own mark that a contact unsubscribed, as an install kept it: on a contact of the sample, on one Dana
        // typed, and on one with no address (nothing to carry).
        typed['rowan'] = made(await post('dana', 'contacts', { company_id: contact['company_id'], name: 'Rowan Hale', email: ROWAN, may_email: false }));
        typed['nameless'] = made(await post('dana', 'contacts', { company_id: contact['company_id'], name: 'Sam Noaddress', may_email: false }));
        const sampleContact = Number((await one("select id from crm_contacts where email like '%.example' order by id"))['id']);
        await s.rows(`update crm_contacts set unsubscribed_at = '${dialect === 'mysql' ? '2026-03-02 09:00:00' : '2026-03-02T09:00:00.000Z'}' where id in (${String(sampleContact)}, ${String(typed['rowan'])}, ${String(typed['nameless'])})`);
        // An introduction Pat made, not thanked yet: the CRM admin thanks it after the update.
        typed['patReferral'] = made(await post('tessa', 'referrals', { from_contact_id: typed['pat'], referred_name: 'Somebody at the harbour', introduced_on: dayIn(-20) }));
        // The owner's own switches: two rules that ship off switched on, one that ships on switched off.
        const shipped = await automationsRepo(s.meta).listManagedBy('crm', s.connectionId);
        for (const [key, enabled] of [['approval-given', true], ['approval-refused', true], ['nudge-quiet', true], ['deal-made', false]] as const) {
          // "Refused" was merged into "given" in 0.2.2: a release without it has nothing to switch.
          if (key === 'approval-refused' && !(was.manifest.automations ?? []).some((one) => one.key === key)) continue;
          const rule = shipped.find((one) => one.templateKey === key);
          expect(rule, key).toBeDefined();
          expect(said(await as('owner', 'PATCH', `/api/v1/automations/${rule!.id}`, { enabled })), key).toBe('ok');
        }
        await s.jobs();
      }, 600_000);

      it('Invoices and Inventory update to their next version with every row kept', async () => {
        await s.jobs();
        const kept = await everyRow(s);
        for (const key of ADD_ONS) await upload('/api/v1/add-ons/upload', addOnTarball(nextAddOns[key]!));
        for (const key of ['inventory', 'invoices'] as const) {
          const res = await as('owner', 'POST', `/api/v1/add-ons/${key}/update`, { to: nextAddOns[key]!.version });
          expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
          expect((res.json() as { to: string }).to).toBe(nextAddOns[key]!.version);
        }
        await s.reread();
        expect(lostOrChanged(kept, await everyRow(s))).toEqual([]);
        // The delivery typed on a sent order is there, and its order expects it on a day: what the gap below is about.
        const typedReceipt = await one(`select r.id, p.expected_on from inventory_receipts r join inventory_purchase_orders p on p.id = r.po_id where r.id = ${String(typed['receipt'])}`);
        expect(typedReceipt['expected_on']).not.toBeNull();
      }, 600_000);

      // KNOWN ENGINE GAP, kept failing on purpose until the engine closes it: an add-on's update adds its columns as an app's
      // does, but has no stage that works out the derived ones for the rows already there (the app's update does: E20).
      // Inventory from 1.0.14 copies an order's expected day onto each delivery; a delivery begun before an update to it
      // keeps it empty, so once posted it cannot say whether it was late, and the supplier scorecard leaves it out.
      // (An install whose Inventory copies the day already, as every one here from 1.0.14 does, has no gap to show.)
      (copiesExpectedDay(installedAddOns.inventory) ? it.skip : it.fails)('KNOWN GAP: a delivery begun before Inventory\'s update takes the day its order expected it', async () => {
        const receipts = await s.rows('select r.id, r.expected_on as got, p.expected_on as want from inventory_receipts r join inventory_purchase_orders p on p.id = r.po_id');
        expect(receipts.filter((row) => plainValue(row['got']) !== plainValue(row['want'])).map((row) => `${String(row['id'])}: ${String(plainValue(row['got']))}, the order says ${String(plainValue(row['want']))}`).slice(0, 10)).toEqual([]);
      }, 600_000);

      it(`the CRM update to ${NEXT} is refused naming each wider grant of an add-on's table (${has28 ? 'none from 0.2.8' : `the marketer's reads of Forms and Pages${has27 ? '' : ', the inbox\'s reads of Live chat'}${has24 ? '' : ', and older ones'}`}), and goes when the owner allows them${has26 ? '' : ', lets the customer\'s link show more and two roles refund'}`, async () => {
        await s.jobs();
        rowsBefore = await everyRow(s);
        partsBefore = await parts();
        rulesBefore = await rules();
        await upload('/api/v1/apps/upload', appTarball(now.manifest, now.files));
        const want = widerGrants(was.manifest, now.manifest);
        // From every release before 0.2.8: the marketer reads what her home shows of Forms and Pages, though no install has Pages yet.
        expect(want.filter(isMarketerRead)).toEqual(has28 ? [] : MARKETER_READS);
        // From every release before 0.2.7: the Team inbox's roles read the chat an enquiry came from.
        const chatWant = want.filter((grant) => grant.addOn === 'live-chat');
        expect(chatWant).toEqual(has27 ? [] : [...CHAT_READS].sort((a, b) => `${a.role}/${a.table}`.localeCompare(`${b.role}/${b.table}`)));
        const older = want.filter((grant) => grant.addOn !== 'live-chat' && !isMarketerRead(grant));
        // Each refusal names what it asks, before anything moves; the owner allows each in turn.
        // Nothing is allowed up front: the quote link's own key carries the app's public access through the update.
        const allowed: Record<string, boolean> = {};
        const reasons: string[] = [];
        let updated: Reply | null = null;
        for (let round = 0; round < 4 && updated === null; round += 1) {
          const asked = await as('owner', 'POST', '/api/v1/apps/crm/update', allowed);
          if (asked.statusCode === 200) {
            updated = asked;
            break;
          }
          expect(asked.statusCode, asked.body).toBe(422);
          const named = (asked.json() as { error: { code: string; details: { reason?: string; refundGrants?: unknown[]; roleTables?: { role: string; addOn: string; table: string; wider: { actions?: string[]; columns?: string[] } }[] } } }).error;
          const reason = named.details.roleTables !== undefined ? 'roleTables' : (named.details.reason ?? named.code);
          reasons.push(reason);
          // Refused before anything moved.
          expect(lostOrChanged(rowsBefore, await everyRow(s))).toEqual([]);
          if (reason === 'PUBLIC_WIDER') allowed['publicWider'] = true;
          else if (reason === 'ROLE_GRANTS_ADDED') allowed['roleGrants'] = true;
          else {
            const asWider = (named.details.roleTables ?? []).map((grant) => ({ role: grant.role, addOn: grant.addOn, table: grant.table, actions: grant.wider.actions ?? [], columns: grant.wider.columns ?? [] })).sort((a, b) => `${a.role}/${a.table}`.localeCompare(`${b.role}/${b.table}`));
            expect(asWider).toEqual(want);
            allowed['roleTables'] = true;
          }
        }
        // From every release: the customer's link shows what a quote asks, and what was paid and is left; the CRM admin
        // and the sales manager may refund the CRM's online payments.
        // 0.2.6, 0.2.7 and 0.2.8 ask neither: they hold both already. The chat's own entry asks nothing more of the app's public access.
        expect(reasons.filter((one) => one !== 'roleTables').sort()).toEqual(has26 ? [] : ['PUBLIC_WIDER', 'ROLE_GRANTS_ADDED']);
        // 0.2.8 holds every grant of an add-on's table already: the update goes at once.
        if (has28) expect(reasons).toEqual([]);
        else expect(reasons).toContain('roleTables');
        if (has24) {
          // 0.2.4 already holds every other grant of an add-on's table 0.2.9 does.
          expect(older).toEqual([]);
        } else {
          // From every release before 0.2.4: the five roles that read the aftercare calls read when a job's survey went
          // (Forms' invitations), though no install has Forms yet; never who it went to.
          const invitations = older.filter((grant) => grant.addOn === 'forms' && grant.table === 'invitations');
          expect(invitations.map((grant) => [grant.role, grant.actions]).sort()).toEqual(['account-manager', 'admin', 'read-only', 'rep', 'sales-manager'].map((role) => [role, ['read']]));
          for (const grant of invitations) expect(grant.columns, grant.role).not.toContain('email');
          // Inventory's receipts, read by Supply's three roles (the scorecard), from 0.2.0 and 0.2.1 only.
          expect(older.filter((grant) => grant.table === 'receipts').map((grant) => grant.role).sort()).toEqual(has22 ? [] : ['admin', 'ops-manager', 'read-only']);
          // And from those two, the crew's read of Inventory's items (a van's load names the item).
          expect(older.filter((grant) => grant.table !== 'receipts' && grant.table !== 'invitations').map((grant) => `${grant.role}/${grant.addOn}/${grant.table}`)).toEqual(has22 ? [] : ['crew/inventory/items']);
        }
        expect(updated?.statusCode, updated?.body).toBe(200);
        updateReply = updated!.json() as typeof updateReply;
        await s.reread();
        const installed = (await s.meta.db.selectFrom('adminium_manifests').select(['version']).where('manifestKey', '=', 'crm').executeTakeFirst()) as { version: string } | undefined;
        expect(installed?.version).toBe(NEXT);
        // The quote's payable arrives switched off: someone who manages payments switches it on.
        const profiles = (await payableProfilesRepo(s.meta).list(s.connectionId)).filter((one) => one.ownerApp === 'crm');
        expect(profiles.map((one) => one.enabled)).toEqual([false]);
      }, 900_000);

      it('every table that was there holds exactly the rows it held, each column as it was, and the new tables are made', async () => {
        expect(lostOrChanged(rowsBefore, await everyRow(s))).toEqual([]);
        const crm = (await s.tables()).filter((name) => name.startsWith('crm_') && name !== 'crm_sample_data');
        const want = now.manifest.requiredSchema.tables.map((table) => `crm_${table.ref}`).sort();
        expect({ extra: crm.filter((name) => !want.includes(name)), missing: want.filter((name) => !crm.includes(name)) }).toEqual({ extra: [], missing: [] });
        expect(crm.length).toBe(79);
      });

      it('every company is kept, its number in the register, phone and few words empty, and the companies entry says where Lead finder writes', async () => {
        const companies = [...(rowsBefore.get('crm_companies') ?? new Map<string, Row>()).keys()].map(String).sort();
        expect(companies.length).toBeGreaterThan(0);
        const held = await s.rows('select id, company_number, phone, about from crm_companies');
        expect(held.map((row) => String(row['id'])).sort()).toEqual(companies);
        expect(held.filter((row) => row['company_number'] !== null || row['phone'] !== null || row['about'] !== null)).toEqual([]);
        const entry = (now.manifest as unknown as { people: { table: string; lead?: Record<string, unknown> }[] }).people.find((one) => one.table === 'companies');
        expect(entry?.lead).toMatchObject({ number: 'company_number', phone: 'phone', about: 'about', owner: 'account_owner_id' });
      });

      it('the parts keep their switches, and the parts it lacked arrive switched off; the rules keep theirs', async () => {
        const after = await parts();
        expect(Object.keys(after).sort()).toEqual(now.manifest.modules.map((part) => part.id).sort());
        for (const [part, on] of Object.entries(partsBefore)) expect([part, after[part]]).toEqual([part, on]);
        const arrived = Object.keys(after).filter((part) => !(part in partsBefore));
        expect(arrived.sort()).toEqual(has24 ? [] : has21 ? ['surveys'] : ['aftercare', 'fleet', 'jobs', 'showroom', 'surveys']);
        for (const part of arrived) expect([part, after[part]]).toEqual([part, false]);
        expect(after[has21 ? 'showroom' : 'inbox']).toBe(false);
        // Surveys waits for Forms, which no install has yet.
        expect(await waitingFor('surveys')).toEqual(['forms']);

        const nowRules = await rules();
        const shipped = new Map((now.manifest.automations ?? []).map((rule) => [rule.key, rule.enabled !== false]));
        // A rule this version still ships keeps the owner's switch; the merged approval rule kept its key (`approval-given`).
        for (const [key, on] of Object.entries(rulesBefore)) {
          if (shipped.has(key)) expect([key, nowRules[key]]).toEqual([key, on]);
          else expect([key, nowRules[key]]).toEqual([key, undefined]);
        }
        expect([nowRules['approval-given'], nowRules['nudge-quiet'], nowRules['deal-made']]).toEqual([true, true, false]);
        // "Refused" was merged into "given": an install that switched it on hears the decision through "given" now.
        expect(nowRules['approval-refused']).toBeUndefined();
        for (const [key, on] of shipped) if (!(key in rulesBefore)) expect([key, nowRules[key]]).toEqual([key, on]);
        // 0.2.4's two arrive off: the brochure asked on a website form, and the survey after a sign-off (an install of 0.2.4 had them, off as shipped).
        expect([rulesBefore['brochure-asked'], rulesBefore['survey-after-sign-off']]).toEqual(has24 ? [false, false] : [undefined, undefined]);
        expect([nowRules['brochure-asked'], nowRules['survey-after-sign-off']]).toEqual([false, false]);
      });

      it('every derived column the update adds holds, on every row there, the value its rule gives', async () => {
        const { derived } = addedColumns(was.manifest, now.manifest);
        const ids = derived.map((added) => `${added.table}.${added.column.ref}`).sort();
        // 0.2.3 adds one: how many of a contact's deals are won, who counts as a customer. 0.2.4 and 0.2.5 add none; 0.2.6
        // what a quote asks on acceptance and how its payments stand.
        expect(ids).toEqual(
          [
            ...(has26 ? [] : PAY_DERIVED),
            ...(has23
              ? []
              : has22
                ? ['contacts.won_deals']
                : has21
                  ? ['contacts.won_deals', 'deal_stock_needs.crew_id', 'follow_ups.on_deal', 'job_visits.deal_id', 'jobs.deal_owner_id', 'quotes.deal_owner_id', 'quotes.deal_state', 'site_visits.deal_owner_id']
                  : ['contacts.won_deals', 'deal_stock_needs.crew_id', 'deals.job_count', 'follow_ups.on_deal', 'quotes.deal_owner_id', 'quotes.deal_state', 'site_visits.deal_owner_id']),
          ].sort(),
        );
        // What the engine says it filled and left is not in the update's reply (its schema keeps only app, from, to, pruned):
        // when it is, it must have left none. The values below are the proof either way.
        if (updateReply.derived !== undefined) expect(updateReply.derived.skipped).toEqual([]);

        const tableOf = (ref: string) => now.manifest.requiredSchema.tables.find((table) => table.ref === ref)!;
        const checked: Record<string, number> = {};
        const wrong: string[] = [];
        for (const { table, column } of derived) {
          const name = `${table}.${column.ref}`;
          const rows = await s.rows(`select * from crm_${table}`);
          let count = 0;
          if (column.rules!.copy !== undefined) {
            const { via, from: source } = column.rules!.copy;
            const parent = tableOf(tableOf(table).columns.find((one) => one.ref === via)!.references!);
            const key = parent.columns.find((one) => one.role === 'pk')?.ref ?? 'id';
            const parents = new Map((await s.rows(`select ${key} as k, ${source} as v from crm_${parent.ref}`)).map((row) => [plainValue(row['k']), row['v']]));
            for (const row of rows) {
              const want = row[via] === null ? null : plainValue(parents.get(plainValue(row[via])));
              if (row[via] !== null) count += 1;
              if (plainValue(row[column.ref]) !== want) wrong.push(`${name} of ${String(row['id'])}: ${String(plainValue(row[column.ref]))}, the rule gives ${String(want)}`);
            }
          } else if (column.rules!.formula !== undefined) {
            for (const row of rows) {
              count += 1;
              const want = plainValue(formulaOf(column.rules!.formula, row));
              if (plainValue(row[column.ref]) !== want) wrong.push(`${name} of ${String(row['id'])}: ${String(plainValue(row[column.ref]))}, the rule gives ${String(want)}`);
            }
          } else {
            const rollup = column.rules!.rollup!;
            // A quote's payments, which no row had before 0.2.6: a total over none, and no newest one.
            if (rollup.sum !== undefined || rollup.latest !== undefined) {
              if ((await s.rows(`select count(*) as c from crm_${rollup.from}`)).some((row) => Number(row['c']) > 0)) throw new Error(`${name}: rows of ${rollup.from} were there before; check their totals here`);
              for (const row of rows) {
                count += 1;
                const value = plainValue(row[column.ref]);
                if (value !== null && value !== '0') wrong.push(`${name} of ${String(row['id'])}: ${value}, the rule gives nothing`);
              }
              checked[name] = count;
              continue;
            }
            if (rollup.count !== true) throw new Error(`${name}: this proof checks a total that counts; add the others before trusting the check`);
            const where = [rollup.where === undefined ? null : `${rollup.where.column} = ${typeof rollup.where.eq === 'boolean' ? (dialect === 'postgres' ? String(rollup.where.eq) : rollup.where.eq ? '1' : '0') : `'${String(rollup.where.eq)}'`}`, rollup.unlessSet === undefined ? null : `${rollup.unlessSet} is null`].filter(Boolean);
            const counts = new Map((await s.rows(`select ${rollup.via} as k, count(*) as c from crm_${rollup.from}${where.length === 0 ? '' : ` where ${where.join(' and ')}`} group by ${rollup.via}`)).map((row) => [plainValue(row['k']), Number(row['c'])]));
            for (const row of rows) {
              count += 1;
              const want = String(counts.get(plainValue(row['id'])) ?? 0);
              if (plainValue(row[column.ref]) !== want) wrong.push(`${name} of ${String(row['id'])}: ${String(plainValue(row[column.ref]))}, the rule gives ${want}`);
            }
          }
          checked[name] = count;
        }
        expect(wrong.slice(0, 30)).toEqual([]);
        // Rows whose source is set were there to fill, for each the plan names: not a check of empty tables.
        const filled = has22 ? [] : ['quotes.deal_state', 'quotes.deal_owner_id', 'site_visits.deal_owner_id', 'follow_ups.on_deal', ...(has21 ? ['jobs.deal_owner_id', 'job_visits.deal_id'] : ['deals.job_count'])];
        for (const name of [...filled, ...(has23 ? [] : ['contacts.won_deals'])]) expect([name, checked[name]! > 0]).toEqual([name, true]);
        // A customer made before the update counts as one: the contact of Dana's deal won before it, and of the sample's won deals.
        const customer = Number((await one(`select contact_id from crm_deals where id = ${String(typed['wonDeal'])}`))['contact_id']);
        const won = Number((await one(`select count(*) as c from crm_deals where contact_id = ${String(customer)} and state = 'won'`))['c']);
        expect(won).toBeGreaterThan(0);
        expect(Number((await one(`select won_deals from crm_contacts where id = ${String(customer)}`))['won_deals'])).toBe(won);
        expect(Number((await one(`select won_deals from crm_contacts where id = ${String(typed['pat'])}`))['won_deals'])).toBe(0);

        // By value, on the rows typed before the update.
        const quote = await one(`select deal_state, deal_owner_id from crm_quotes where id = ${String(typed['quote'])}`);
        expect([quote['deal_state'], quote['deal_owner_id']]).toEqual(['open', id['dana']]);
        const steps = await s.rows(`select id, on_deal from crm_follow_ups where id in (${String(typed['stepOnDeal'])}, ${String(typed['stepAlone'])}) order by id`);
        expect(steps.map((row) => Number(row['on_deal']))).toEqual([1, 0]);
        // A quote of a won and of a lost deal of the sample's carries its deal's state, not "open".
        const closed = await s.rows("select q.id, q.deal_state as q, d.state as d from crm_quotes q join crm_deals d on d.id = q.deal_id where d.state <> 'open'");
        expect(closed.map((row) => Number(row['id']))).toContain(typed['wonQuote']);
        expect(closed.every((row) => row['q'] === row['d'])).toBe(true);
        expect((await one(`select deal_state from crm_quotes where id = ${String(typed['wonQuote'])}`))['deal_state']).toBe('won');
        if (has21) {
          expect((await one(`select deal_owner_id from crm_site_visits where id = ${String(typed['siteVisit'])}`))['deal_owner_id']).toBe(id['dana']);
          expect((await one(`select deal_owner_id from crm_jobs where id = ${String(typed['job'])}`))['deal_owner_id']).toBe(id['dana']);
          expect(Number((await one(`select deal_id from crm_job_visits where id = ${String(typed['jobVisit'])}`))['deal_id'])).toBe(typed['wonDeal']);
        } else {
          expect((await s.rows('select job_count from crm_deals')).every((row) => Number(row['job_count']) === 0)).toBe(true);
        }
      });

      it('every other column the update adds holds its stated default, or nothing', async () => {
        const { plain } = addedColumns(was.manifest, now.manifest);
        // 0.2.3's: the mark of the line, on contacts and enquiries. Every row there before it carries none: nobody brought
        // in before was told they could say no where we took their address, so nobody is an existing customer by it.
        // 0.2.4's: what a website form says of an enquiry and the brochure it asked, the outbox's enquiry, whether a piece of
        // feedback came from the survey, and the brochure's two settings: none set on a row there before. 0.2.5 adds none.
        // 0.2.6's: what a quote asks on acceptance, taken from Settings when it is made (nothing on a quote there before),
        // and the two settings, at what they start at (nothing asked, a deposit of 20 %).
        const ours = ['enquiries.brochure', 'enquiries.brochure_link', 'enquiries.from_form', 'enquiries.wanted_on', 'feedback.from_survey', 'outbox.enquiry_id', 'settings.brochure_follow_up_owner_id', 'settings.brochure_link'];
        const ids = plain.map((added) => `${added.table}.${added.column.ref}`).sort();
        // 0.2.7's and 0.2.8's: none. 0.2.9's: a company's number, phone and few words, empty on every company there before.
        const COMPANY = ['companies.about', 'companies.company_number', 'companies.phone'];
        expect(COMPANY.filter((one) => ids.includes(one))).toEqual(COMPANY);
        if (has26) expect(ids).toEqual(COMPANY);
        else if (has24) expect(ids).toEqual([...COMPANY, ...PAY_PLAIN].sort());
        else if (has23) expect(ids).toEqual([...ours, ...COMPANY, ...PAY_PLAIN].sort());
        else if (has22) expect(ids).toEqual([...ours, ...COMPANY, ...PAY_PLAIN, 'contacts.opt_out_offered_at', 'enquiries.opt_out_offered_at'].sort());
        else expect(plain.length).toBeGreaterThan(20);
        // (0.2.0 had no feedback: the table is new to it, the column with it.)
        if (!has24) for (const id of ours.filter((one) => has21 || !one.startsWith('feedback.'))) expect(ids, id).toContain(id);
        // (From 0.2.3 the mark is the server's own on a row typed there: kept as it was, above.)
        if (!has23) for (const ref of ['contacts', 'enquiries']) expect(Number((await one(`select count(*) as c from crm_${ref} where opt_out_offered_at is not null`))['c']), ref).toBe(0);
        const wrong: string[] = [];
        for (const { table, column } of plain) {
          const want = column.default === undefined ? null : plainValue(column.default);
          const held = await s.rows(`select id, ${column.ref} as v from crm_${table}`);
          for (const row of held) {
            const value = plainValue(row['v']);
            if (value !== null && value !== want) wrong.push(`${table}.${column.ref} of ${String(row['id'])}: ${value}, stated ${String(want)}`);
            if (value === null && column.nullable !== true && want !== null) wrong.push(`${table}.${column.ref} of ${String(row['id'])}: empty, stated ${String(want)}`);
          }
        }
        expect(wrong.slice(0, 30)).toEqual([]);
      });

      it('carries each old "unsubscribed" mark onto the do-not-email list; the quote still reaches Pat on it; the referral\'s thanks goes to her and its code does not', async () => {
        // The carry: one entry for each contact the release marked unsubscribed that has an address, said why. It was 0.2.3's
        // update that carried them: from 0.2.3 (which reads that column no more) there is nothing left to carry.
        const marked = (await s.rows('select email from crm_contacts where unsubscribed_at is not null and email is not null')).map((row) => String(row['email']).toLowerCase()).sort();
        expect(marked).toContain(ROWAN);
        const list = (await as('owner', 'GET', '/api/v1/consent/stop-list?reason=old-mark&limit=200')).json() as { data: { entries: { address: string | null; reason: string }[]; total: number } };
        expect(list.data.entries.map((entry) => entry.address ?? '').sort()).toEqual(has23 ? [] : marked);
        // Pat, on the list by her own link, is there once and for her own reason.
        const pat = (await as('owner', 'GET', `/api/v1/consent/stop-list?q=${encodeURIComponent('pat.quinn')}`)).json() as { data: { entries: { address: string | null; reason: string }[] } };
        expect(pat.data.entries.map((entry) => [entry.address, entry.reason])).toEqual([[PAT, 'link']]);
        // A quote is service mail: it still reaches her.
        const price = (await s.rows('select id, list_rate, active from crm_price_list order by id')).find((row) => plainValue(row['active']) === '1' && row['list_rate'] !== null)!;
        const again = await sendQuote(typed['patDeal']!, typed['pat']!, price);
        expect(await quoteMail(again)).toEqual([['quote-sent', PAT, 'sent', null]]);
        // The CRM admin thanks Pat for her introduction, with a code: the thanks is service, the code marketing, and she said no.
        expect(said(await patch('tessa', 'referrals', typed['patReferral']!, { thanked_at: new Date().toISOString(), reward: 'THANKS-PAT' }))).toBe('ok');
        expect(await outboxOf(`referral_id = ${String(typed['patReferral'])}`)).toEqual([
          ['referral-thanks', PAT, 'sent', null],
          ['referral-code', PAT, 'skipped', 'Not sent: on the do-not-email list (marketing mail)'],
        ]);
      }, 600_000);

      it('Dana herself sends the draft quote she made before the update, and the deal takes its amount', async () => {
        expect(said(await patch('dana', 'quotes', typed['quote']!, { status: 'sent' }))).toBe('ok');
        const quote = await one(`select status, subtotal, total, sent_at from crm_quotes where id = ${String(typed['quote'])}`);
        expect(quote['status']).toBe('sent');
        expect(quote['sent_at']).not.toBeNull();
        const deal = await one(`select quote_id, quoted_amount, amount from crm_deals where id = ${String(typed['deal'])}`);
        expect([Number(deal['quote_id']), Number(deal['quoted_amount']), Number(deal['amount'])]).toEqual([typed['quote'], Number(quote['subtotal']), Number(quote['subtotal'])]);
        expect(Number(quote['total'])).toBeGreaterThan(0);
      });

      it('afterwards the roles work: a new quote on an open deal, none on a closed one, the receipts read as the operations manager only', async () => {
        const open = await one(`select id from crm_deals where owner_id = '${id['dana']!}' and state = 'open' and id <> ${String(typed['deal'])} order by id`);
        const fresh = made(await post('dana', 'quotes', { deal_id: open['id'] }));
        const row = await one(`select deal_state, deal_owner_id from crm_quotes where id = ${String(fresh)}`);
        expect([row['deal_state'], row['deal_owner_id']]).toEqual(['open', id['dana']]);
        const refused = await post('dana', 'quotes', { deal_id: typed['wonDeal'] });
        expect(refused.statusCode, refused.body).toBeGreaterThanOrEqual(400);
        expect(refused.statusCode, refused.body).toBeLessThan(500);
        const step = made(await post('dana', 'follow_ups', { owner_id: id['dana'], due_at: inDays(2), text: 'After the update', kind: 'step' }));
        expect(Number((await one(`select on_deal from crm_follow_ups where id = ${String(step)}`))['on_deal'])).toBe(0);
        if (has21) {
          const visit = made(await post('ada', 'job_visits', { job_id: typed['job'], kind: 'install', what: 'Second fit', day: dayIn(9), hours: 2, crew_size: 2 }));
          expect(Number((await one(`select deal_id from crm_job_visits where id = ${String(visit)}`))['deal_id'])).toBe(typed['wonDeal']);
        }
        // The grant the owner allowed: Inventory's receipts, six columns, read by the operations manager; never a rep.
        const receipts = `/api/v1/data/${s.connectionId}/${s.t('inventory_receipts')}?limit=1`;
        const read = await as('ada', 'GET', receipts);
        expect(read.statusCode, read.body).toBe(200);
        expect((await as('dana', 'GET', receipts)).statusCode).toBe(403);
      });

      it('a helper on a deal before the update reads it and comments after it, and changes and adds nothing of it; her own follow-up stays hers', async () => {
        expect((await as('priya', 'GET', url('deals', `/${String(typed['deal'])}`))).statusCode).toBe(200);
        expect((await as('priya', 'GET', url('quotes', `/${String(typed['quote'])}`))).statusCode).toBe(200);
        expect(said(await patch('priya', 'deals', typed['deal']!, { typed_amount: 9999 }))).toBe('404 NOT_FOUND');
        expect(said(await patch('priya', 'quotes', typed['quote']!, { notes: 'Priya was here' }))).toBe('404 NOT_FOUND');
        const added = await post('priya', 'follow_ups', { deal_id: typed['deal'], owner_id: id['priya'], due_at: inDays(3), text: 'Priya adds one', kind: 'step' });
        expect(said(added), added.body).toBe('403 COLUMN_FORBIDDEN');
        expect(added.body).toContain('parent-not-theirs');
        expect(said(await post('priya', 'comments', { deal_id: typed['deal'], text: 'Priya read the quote' }))).toBe('ok');
        expect(said(await patch('priya', 'follow_ups', typed['helperStep']!, { done: true }))).toBe('ok');
        // The owner works it as before.
        expect(said(await patch('dana', 'deals', typed['deal']!, { typed_amount: 4100 }))).toBe('ok');
      });

      it('Forms installed after the update: Surveys waits for nothing and is on; its invitations read as a rep and not the operations manager; the brochure goes, and stops at the do-not-email list', async () => {
        await upload('/api/v1/add-ons/upload', addOnTarball(formsNext!));
        const added = await as('owner', 'POST', '/api/v1/add-ons', { key: 'forms', version: formsNext!.version, attachTo: ['crm'] });
        expect(added.statusCode, added.body).toBe(200);
        await s.jobs();
        await s.reread();
        // Surveys ships on: it waited only for Forms, and is on once Forms is there. Its rule stays off until the owner says.
        expect(await waitingFor('surveys')).toEqual([]);
        expect((await parts())['surveys']).toBe(true);
        expect((await rules())['survey-after-sign-off']).toBe(false);
        // The grant the owner allowed on the update: when a job's survey went, read by a rep; never by the operations manager.
        const invitations = `/api/v1/data/${s.connectionId}/${s.t('forms_invitations')}?limit=1`;
        const read = await as('dana', 'GET', invitations);
        expect(read.statusCode, read.body).toBe(200);
        expect((await as('ada', 'GET', invitations)).statusCode).toBe(403);
        // The brochure: the owner sets its link and whom to ring, and switches its rule on. Two enquiries ask for it, as a
        // website form would put them: Kim's goes; Pat, on the do-not-email list, gets none (service mail with the
        // newsletter's purpose, stopped there by Adminium 0.3.42), where her quote above still went.
        const settings = await one('select id from crm_settings order by id');
        expect(said(await patch('owner', 'settings', Number(settings['id']), { brochure_link: 'https://meridian-workplace.co.uk/brochure.pdf', brochure_follow_up_owner_id: id['dana'] }))).toBe('ok');
        const rule = (await automationsRepo(s.meta).listManagedBy('crm', s.connectionId)).find((one) => one.templateKey === 'brochure-asked');
        expect(rule, 'the brochure rule').toBeDefined();
        expect(said(await as('owner', 'PATCH', `/api/v1/automations/${rule!.id}`, { enabled: true }))).toBe('ok');
        // The rule is the Inbox's: an owner of 0.2.0 who left the Inbox off switches it on first.
        if (!has21) expect(said(await as('owner', 'PUT', '/api/v1/apps/crm/parts/inbox', { on: true }))).toBe('ok');
        const asks = async (person: string, email: string) => made(await post('owner', 'enquiries', { company_name: 'Harbourline Dental', person, email, brochure: 'yes', source: 'form', from_form: 'Website form' }));
        const kim = await asks('Kim Hart', KIM);
        const pat = await asks('Pat Quinn', PAT);
        // A stopped mail keeps no address.
        // Sorted by status: the engines return the two rows in no fixed order.
        expect((await outboxOf(`kind = 'brochure' and enquiry_id in (${String(kim)}, ${String(pat)})`)).sort((a, b) => String(a[2]).localeCompare(String(b[2])))).toEqual([
          ['brochure', KIM, 'sent', null],
          ['brochure', null, 'skipped', 'Not sent: on the do-not-email list'],
        ]);
      }, 600_000);

      it('Live chat installed after the update: a rep reads its chats and their lines, the operations manager neither', async () => {
        await upload('/api/v1/add-ons/upload', addOnTarball(chatNext!));
        const added = await as('owner', 'POST', '/api/v1/add-ons', { key: 'live-chat', version: chatNext!.version, attachTo: ['crm'] });
        expect(added.statusCode, added.body).toBe(200);
        await s.jobs();
        await s.reread();
        // The grants the owner allowed on the update, written now the add-on is there.
        for (const table of ['conversations', 'messages']) {
          const path = `/api/v1/data/${s.connectionId}/${s.t(`live_chat_${table}`)}?limit=1`;
          const read = await as('dana', 'GET', path);
          expect(read.statusCode, `${table}: ${read.body}`).toBe(200);
          expect((await as('ada', 'GET', path)).statusCode, table).toBe(403);
        }
        // What the update kept is still kept.
        expect(Number((await one('select count(*) as c from crm_enquiries'))['c'])).toBeGreaterThan(0);
      }, 600_000);

      it('Pages installed after the update: the marketer reads its pages and funnels, and Forms\' forms and answers; the operations manager none of them', async () => {
        await upload('/api/v1/add-ons/upload', addOnTarball(pagesNext!));
        const added = await as('owner', 'POST', '/api/v1/add-ons', { key: 'pages', version: pagesNext!.version, attachTo: ['crm'] });
        expect(added.statusCode, added.body).toBe(200);
        await s.jobs();
        await s.reread();
        // The grants the owner allowed on the update, written now each add-on is there (Forms came in above).
        for (const table of ['pages_pages', 'pages_funnels', 'forms_forms', 'forms_answers']) {
          const path = `/api/v1/data/${s.connectionId}/${s.t(table)}?limit=1`;
          const read = await as('lena', 'GET', path);
          expect(read.statusCode, `${table}: ${read.body}`).toBe(200);
          expect((await as('ada', 'GET', path)).statusCode, table).toBe(403);
        }
        // She writes none of them: an admin builds a page and a funnel.
        const write = await as('lena', 'POST', `/api/v1/data/${s.connectionId}/${s.t('pages_funnels')}`, { values: { name: 'Mine', steps: [] } });
        expect(write.statusCode, write.body).toBe(403);
        // What the update kept is still kept.
        expect(Number((await one('select count(*) as c from crm_enquiries'))['c'])).toBeGreaterThan(0);
      }, 600_000);

      it('a later update carries the old marks again and adds no entry: each was put on the list once', async () => {
        const count = async (): Promise<number> => ((await as('owner', 'GET', '/api/v1/consent/stop-list?reason=old-mark&limit=200')).json() as { data: { total: number } }).data.total;
        const before = await count();
        expect(before > 0).toBe(!has23);
        // The same app numbered one patch up, as the next release would carry the same column.
        const later = { ...now.manifest, version: NEXT.replace(/\d+$/, (patch) => String(Number(patch) + 1)) };
        await upload('/api/v1/apps/upload', appTarball(later, now.files));
        const updated = await as('owner', 'POST', '/api/v1/apps/crm/update', {});
        expect(updated.statusCode, updated.body).toBe(200);
        expect(await count()).toBe(before);
      }, 600_000);
    });
  }
}
