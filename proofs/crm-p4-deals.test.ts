/**
 * Plan 68, phase 4 (T26a): a deal, its hand-over, its approvals and its quotes on Adminium 0.3.35's words, against the
 * whole server with the app's manifest and its sample, on SQLite, Postgres and MySQL, SIGNED IN AS THE PERSON EACH RULE
 * LIMITS, and as the one it lets through:
 *
 *  - R1a (E28): no new quote on a won or a lost deal, by any door; one on an open deal is made; the sample (history)
 *    still brings quotes on won deals;
 *  - R1c (E12): a hand-over moves the old owner's visits not yet made and her open follow-ups to the new owner in its
 *    own write, and nothing else: a made visit, a done follow-up, a helper's and a manager's own rows stay; a clash of
 *    the new owner's own refuses it whole;
 *  - R1d (E11): another team's manager whose rep helps on Dana's deal is refused the deal and every row of it (the
 *    list, the record, its history, figures and board totals, a search, an export, the bell), the helper's own visit
 *    and follow-up included; the helper reads and comments; the quiet line (the deal's mark) names Dana, no amount;
 *  - S2 (E1): a request is decided only from asked, never by who asked nor by the deal's owner, by PATCH, bulk edit and
 *    the button; "Reopen it" puts a decision back to asked, keeps the asker, and the decision before stays in history;
 *  - X2 (E1): the sales manager never changes her own target nor her own starter row, and a meeting's decisions only
 *    when she runs it;
 *  - E4: a quote and its lines are one write; a line refused refuses the quote;
 *  - ruling 1d (Adminium 0.3.36, `notThrough`): a helper on a deal reads it and everything on it and comments, and
 *    changes, sends, asks, logs, books and adds nothing of it by any door; her own follow-up and visit made before stay
 *    hers; whoever covers for the owner, the owner, the manager and the CRM admin write as before; the account manager
 *    makes his aftercare calls, and hangs no follow-up of his on a deal that is not his.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, manifestsRepo, rolesRepo, snapshotsRepo, teamsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// The server says the version it was built at (0.3.26 until the release); the app's floor is the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.36' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
// The sample the app ships, and the people its manifest lists.
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const PEOPLE = manifest()['sampleData'] as { people: { key: string; name: string; email: string; role: string }[]; teams: unknown[] };

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `crm_p4_${randomBytes(4).toString('hex')}`;
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

async function invoices(meta: MetaDb): Promise<void> {
  const document = JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  document['version'] = '1.1.0';
  const addOn = document['addOn'] as { attaches?: { app: string }[] };
  addOn.attaches = [...(addOn.attaches ?? []).filter((one) => one.app !== 'crm'), { app: 'crm' }];
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: document as never });
}

type Reply = Awaited<ReturnType<AdminiumServer['inject']>>;
interface Stack {
  dialect: Dialect;
  app: AdminiumServer;
  meta: MetaDb;
  connectionId: string;
  /** The id of one of the app's tables, as the data routes name it. */
  t: (ref: string) => string;
  real: (ref: string) => string;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  /** Each person's user id, by the sample's key; `noor` is a rep in no team, made here. */
  id: Record<string, string>;
  cookie: Record<string, string>;
  owner: string;
  /** Run every job that is waiting, as the worker would: a rule's run, a mail's send. */
  jobs: () => Promise<void>;
  close: () => Promise<void>;
}

let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.11.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

async function stack(dialect: Dialect): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-p4-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const hash = await adminPasswordHash();
  await createFirstSuperAdmin(meta, { email: 'owner@crm.test', name: 'Owner', passwordHash: hash });
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
  const owner = await signIn(app, 'owner@crm.test');
  await invoices(meta);

  // The harness packs text only: the picture's bytes do not matter here, its place in the package does.
  const packed = JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { assets?: Record<string, { file: string; sha256: string }> };
  for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
  const document = manifest();
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(document),
    'staff/index.html': '<!doctype html><html><body></body></html>',
    'seeds/meridian.json': JSON.stringify(packed),
  });
  const staged = await app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: owner, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
  expect(staged.statusCode, staged.body).toBe(200);
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { key: 'crm', version: document['version'], connectionId: connection.id, addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } } });
  expect(installed.statusCode, installed.body).toBe(200);
  const sample = await app.inject({ method: 'POST', url: '/api/v1/apps/crm/sample-data', headers: { cookie: owner }, payload: {} });
  expect(sample.statusCode, sample.body).toBe(200);
  while ((await composed.jobs.worker.runOnce()) > 0);

  // The sample's people become ordinary staff with a password, each under an address the test knows.
  const users = usersRepo(meta);
  const samplePeople = await users.list({ status: 'sample', limit: 50 });
  expect(samplePeople).toHaveLength(PEOPLE.people.length);
  const id: Record<string, string> = {};
  const cookie: Record<string, string> = {};
  for (const person of PEOPLE.people) {
    const user = samplePeople.find((one) => one.name === person.name)!;
    expect(user, person.name).toBeDefined();
    await meta.db.updateTable('adminium_users').set({ status: 'active', passwordHash: hash, email: `${person.key}@crm.test` }).where('id', '=', user.id).execute();
    id[person.key] = user.id;
  }
  // Another team, West: Noor, a rep, led by Omar, a second sales manager. Ivy leads neither.
  const noor = await users.create({ email: 'noor@crm.test', name: 'Noor Haddad', passwordHash: hash });
  await rolesRepo(meta).assignToUser(noor.id, (await rolesRepo(meta).findBySlug('crm-rep'))!.id);
  const omar = await users.create({ email: 'omar@crm.test', name: 'Omar Said', passwordHash: hash });
  await rolesRepo(meta).assignToUser(omar.id, (await rolesRepo(meta).findBySlug('crm-sales-manager'))!.id);
  const west = await teamsRepo(meta).create('West');
  await teamsRepo(meta).setMember(west.id, noor.id, false);
  await teamsRepo(meta).setMember(west.id, omar.id, true);
  id['noor'] = noor.id;
  id['omar'] = omar.id;
  // Only the people this proof signs in as: a sign-in is not free.
  for (const key of ['dana', 'sam', 'priya', 'leo', 'hugo', 'ivy', 'tessa', 'noor', 'omar', 'grace']) cookie[key] = await signIn(app, `${key}@crm.test`);

  const model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const handle = await manager.data(connection.id);
  return {
    dialect,
    app,
    meta,
    connectionId: connection.id,
    t: (ref) => model.tables.find((table) => table.name === `crm_${ref}`)!.id,
    real: (ref) => `crm_${ref}`,
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    id,
    cookie,
    owner,
    jobs: async () => {
      // A rule set off by a person's write waits out the minute in which the write can be undone: the test does not, and
      // makes every waiting job due now (the only clock it moves).
      for (let round = 0; round < 20; round += 1) {
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
/** A day so many days from now, as `YYYY-MM-DD` (a cover's first or last day). */
const onDay = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
/** A moment so many days from now at a given hour, to the minute (a visit is never booked in the past). */
const inDays = (days: number, hour = 10): string => {
  const at = new Date(Date.now() + days * DAY);
  at.setUTCHours(hour, 0, 0, 0);
  return at.toISOString();
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's deals, hand-over, approvals and quotes on Adminium 0.3.36, on ${dialect}`, () => {
    let s: Stack;
    let stage = 0;
    let company = 0;
    const who = (person: string) => (person === 'owner' ? s.owner : s.cookie[person]!);
    const url = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const get = (person: string, ref: string, rest = '') => s.app.inject({ method: 'GET', url: url(ref, rest), headers: { cookie: who(person) } });
    const post = (person: string, ref: string, values: Record<string, unknown>, more: Record<string, unknown> = {}) => s.app.inject({ method: 'POST', url: url(ref), headers: { cookie: who(person) }, payload: { values, ...more } });
    const patch = (person: string, ref: string, key: unknown, values: Record<string, unknown>) => s.app.inject({ method: 'PATCH', url: url(ref, `/${String(key)}`), headers: { cookie: who(person) }, payload: { values } });
    const press = (person: string, ref: string, key: unknown, action: string, from: string, values?: Record<string, unknown>) =>
      s.app.inject({ method: 'POST', url: url(ref, `/${String(key)}/actions/${action}`), headers: { cookie: who(person) }, payload: { from, ...(values === undefined ? {} : { values }) } });
    const bulk = (person: string, ref: string, keys: number[], values: Record<string, unknown>) =>
      s.app.inject({ method: 'POST', url: url(ref, '/bulk'), headers: { cookie: who(person) }, payload: { action: 'update', ids: keys.map(String), values } });
    const bulked = (res: Reply): { id: string; ok: boolean; error?: string }[] => {
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { results: { id: string; ok: boolean; error?: string }[] }).results;
    };
    const keys = async (person: string, ref: string, where?: unknown): Promise<number[] | string> => {
      const res = await get(person, ref, `?limit=200&select=id${where === undefined ? '' : `&where=${encodeURIComponent(JSON.stringify(where))}`}`);
      if (res.statusCode !== 200) return said(res);
      return (res.json() as { data: { id: unknown }[] }).data.map((row) => Number(row.id)).sort((a, b) => a - b);
    };
    const ids = async (statement: string): Promise<number[]> => (await s.rows(statement)).map((row) => Number(row['id'])).sort((a, b) => a - b);
    const one = async (statement: string): Promise<Record<string, unknown>> => (await s.rows(statement))[0]!;
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBeLessThan(300);
      return Number((res.json() as { data: { id: unknown } }).data.id);
    };
    const reason = (res: Reply): unknown => (res.json() as { error?: { details?: { reason?: unknown } } }).error?.details?.reason;
    /** A row out of reach answers, to the byte, as a key that names no row. */
    const gone = async (person: string, ref: string, key: unknown, rest = ''): Promise<void> => {
      const hidden = await get(person, ref, `/${String(key)}${rest}`);
      const nothing = await get(person, ref, `/999999${rest}`);
      expect(hidden.statusCode, `${person} ${ref}/${String(key)}${rest}: ${hidden.body}`).toBe(404);
      const plain = (body: string, k: string) => body.replace(/"requestId":"[^"]*"/, '"requestId":"R"').replaceAll(k, 'K');
      expect(plain(hidden.body, String(key))).toBe(plain(nothing.body, '999999'));
    };
    const figure = async (person: string, ref: string, descriptor: Record<string, unknown>): Promise<Reply> =>
      s.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie: who(person) }, payload: { descriptor: { connectionId: s.connectionId, source: { name: s.t(ref) }, ...descriptor } } });
    const owner = (person: string): string => s.id[person]!;
    const deal = async (person: string, name: string, ownerKey: string, more: Record<string, unknown> = {}): Promise<number> =>
      made(await post(person, 'deals', { name, company_id: company, stage_id: stage, owner_id: owner(ownerKey), typed_amount: 5000, ...more }));
    const visit = async (person: string, dealId: number, rep: string, days: number): Promise<number> =>
      // In the evening (UTC), where none of the sample's visits sits, whichever day of the week the proof runs on.
      made(await post(person, 'site_visits', { deal_id: dealId, rep_id: owner(rep), starts_at: inDays(days, 19 + (days % 4)), minutes: 45, purpose: `P4 visit ${rep} ${String(days)}` }));
    const step = async (person: string, dealId: number, ownerKey: string, text: string, done = false): Promise<number> =>
      made(await post(person, 'follow_ups', { deal_id: dealId, owner_id: owner(ownerKey), due_at: inDays(5), text, kind: 'step', ...(done ? { done: true } : {}) }));

    beforeAll(async () => {
      s = await stack(dialect);
      stage = (await ids(`SELECT id FROM ${s.real('stages')}`))[0]!;
      company = (await ids(`SELECT id FROM ${s.real('companies')}`))[0]!;
    }, 600_000);
    afterAll(async () => {
      await s?.close();
    });

    it('R1a: no new quote on a won or a lost deal, as the rep and as her manager, and one on an open deal is made', async () => {
      const of = async (state: string) => (await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${owner('dana')}' AND state = '${state}'`))[0]!;
      const [won, lost, open] = [await of('won'), await of('lost'), await of('open')];
      for (const key of [won, lost, open]) expect(key, 'the sample has a won, a lost and an open deal of Dana\'s').toBeGreaterThan(0);
      const before = (await ids(`SELECT id FROM ${s.real('quotes')}`)).length;
      const tries: Record<string, string> = {};
      for (const person of ['dana', 'ivy']) {
        for (const [label, key] of [['won', won], ['lost', lost]] as const) {
          tries[`${person} ${label}`] = said(await post(person, 'quotes', { deal_id: key }));
          tries[`${person} ${label} with a line`] = said(await post(person, 'quotes', { deal_id: key }, { children: { quote_lines: [{ values: { description: 'P4 closed', qty: 1, rate: 100 } }] } }));
        }
      }
      expect(Object.values(tries).every((outcome) => outcome === '409 STATE_MOVE_REFUSED'), JSON.stringify(tries)).toBe(true);
      expect((await ids(`SELECT id FROM ${s.real('quotes')}`)).length).toBe(before);
      // An open deal takes one, from both.
      const mine = made(await post('dana', 'quotes', { deal_id: open }));
      const hers = made(await post('ivy', 'quotes', { deal_id: open }));
      expect((await one(`SELECT deal_state FROM ${s.real('quotes')} WHERE id = ${String(mine)}`))['deal_state']).toBe('open');
      // History is not held: a file the install's owner brings in (the only person who imports quotes) brings a past quote
      // on a won deal, as the sample would.
      const upload = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=quotes.csv', headers: { cookie: who('owner'), 'content-type': 'text/csv' }, payload: `deal_id,notes\n${String(won)},P4 a past quote\n` });
      expect(upload.statusCode, upload.body).toBe(201);
      const ready = await s.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: who('owner') }, payload: { fileId: (upload.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t('quotes'), mapping: { columns: [{ from: 'deal_id', to: 'deal_id' }, { from: 'notes', to: 'notes' }] }, options: { mode: 'insert' } } });
      expect(ready.statusCode, ready.body).toBe(201);
      const importId = (ready.json() as { data: { import: { id: string } } }).data.import.id;
      expect((await s.app.inject({ method: 'GET', url: `/api/v1/imports/${importId}/preview`, headers: { cookie: who('owner') } })).statusCode).toBe(200);
      expect((await s.app.inject({ method: 'POST', url: `/api/v1/imports/${importId}/run`, headers: { cookie: who('owner') } })).statusCode).toBe(202);
      await s.jobs();
      const past = await ids(`SELECT id FROM ${s.real('quotes')} WHERE deal_id = ${String(won)} AND notes = 'P4 a past quote'`);
      expect(past).toHaveLength(1);
      expect((await one(`SELECT deal_state FROM ${s.real('quotes')} WHERE id = ${String(past[0]!)}`))['deal_state']).toBe('won');
      for (const key of [mine, hers, past[0]!]) expect(said(await s.app.inject({ method: 'DELETE', url: url('quotes', `/${String(key)}?confirm=true`), headers: { cookie: who('tessa') } }))).toBe('ok');
    });

    it('R1c: a hand-over moves the old owner\'s booked visits and open follow-ups in its own write, and nothing else', async () => {
      // The manifest says whether visits are carried (they are, since the engine places each under its slot's lock).
      const carriesVisits = JSON.stringify(((manifest()['requiredSchema'] as { tables: { ref: string; states?: { actions?: { id: string; carries?: { table: string }[] }[] } }[] }).tables.find((one) => one.ref === 'deals')!.states!.actions!.find((one) => one.id === 'hand-over')!.carries ?? []).map((carry) => carry.table)).includes('site_visits');
      const went = (from: string, to: string): string => owner(carriesVisits ? to : from);
      const handed = await deal('dana', 'P4 hand-over', 'dana');
      expect(said(await post('dana', 'deal_members', { deal_id: handed, user_id: owner('sam') }))).toBe('ok');
      const booked = await visit('tessa', handed, 'dana', 3);
      const madeVisit = await visit('tessa', handed, 'dana', 4);
      await s.rows(`UPDATE ${s.real('site_visits')} SET state = 'done' WHERE id = ${String(madeVisit)}`);
      const samsVisit = await visit('tessa', handed, 'sam', 5);
      const open = await step('tessa', handed, 'dana', 'P4 Dana open');
      const closed = await step('tessa', handed, 'dana', 'P4 Dana done', true);
      const samsStep = await step('tessa', handed, 'sam', 'P4 Sam helps');
      const ivysStep = await step('tessa', handed, 'ivy', 'P4 Ivy checks');
      const visitsNow = async () => Object.fromEntries((await s.rows(`SELECT id, rep_id, deal_owner_id FROM ${s.real('site_visits')} WHERE deal_id = ${String(handed)}`)).map((row) => [Number(row['id']), [row['rep_id'], row['deal_owner_id']]]));
      const stepsNow = async () => Object.fromEntries((await s.rows(`SELECT id, owner_id FROM ${s.real('follow_ups')} WHERE deal_id = ${String(handed)}`)).map((row) => [Number(row['id']), row['owner_id']]));

      // Somebody who cannot open the deal hands nothing over, and nothing moves.
      expect(said(await press('noor', 'deals', handed, 'hand-over', 'open', { owner_id: owner('noor') }))).toBe('404 NOT_FOUND');
      expect(await stepsNow()).toEqual({ [open]: owner('dana'), [closed]: owner('dana'), [samsStep]: owner('sam'), [ivysStep]: owner('ivy') });

      // Dana, the rep, hands it to Priya: one press.
      const toPriya = await press('dana', 'deals', handed, 'hand-over', 'open', { owner_id: owner('priya') });
      expect(said(toPriya), toPriya.body).toBe('ok');
      expect(String((await one(`SELECT owner_id FROM ${s.real('deals')} WHERE id = ${String(handed)}`))['owner_id'])).toBe(owner('priya'));
      expect(await visitsNow()).toEqual({ [booked]: [went('dana', 'priya'), owner('priya')], [madeVisit]: [owner('dana'), owner('priya')], [samsVisit]: [owner('sam'), owner('priya')] });
      expect(await stepsNow()).toEqual({ [open]: owner('priya'), [closed]: owner('dana'), [samsStep]: owner('sam'), [ivysStep]: owner('ivy') });
      // Each carried row is a change of its own, in its history: who moved it, and from whom.
      const history = await get('priya', 'follow_ups', `/${String(open)}/history?limit=20`);
      expect(history.statusCode, history.body).toBe(200);
      expect(history.body).toContain(owner('dana'));

      // Ivy, who leads them, hands it on to Leo: Priya's visit and follow-up go; Ivy's own follow-up stays hers.
      const toLeo = await press('ivy', 'deals', handed, 'hand-over', 'open', { owner_id: owner('leo') });
      expect(said(toLeo), toLeo.body).toBe('ok');
      expect(await visitsNow()).toEqual({ [booked]: [went('dana', 'leo'), owner('leo')], [madeVisit]: [owner('dana'), owner('leo')], [samsVisit]: [owner('sam'), owner('leo')] });
      expect(await stepsNow()).toEqual({ [open]: owner('leo'), [closed]: owner('dana'), [samsStep]: owner('sam'), [ivysStep]: owner('ivy') });
    });

    it('R1c: a hand-over onto a new owner whose own visit clashes with a carried one is refused whole, and nothing moves', async () => {
      const handed = await deal('dana', 'P4 hand-over clash', 'dana');
      const elsewhere = await deal('priya', 'P4 Priya elsewhere', 'priya');
      const booked = await visit('tessa', handed, 'dana', 11);
      // Priya is already out at that very time on a deal of her own.
      await visit('tessa', elsewhere, 'priya', 11);
      const open = await step('tessa', handed, 'dana', 'P4 Dana open, clash');
      const refused = await press('dana', 'deals', handed, 'hand-over', 'open', { owner_id: owner('priya') });
      expect(said(refused), refused.body).toBe('409 BOOKING_TAKEN');
      expect(String((await one(`SELECT owner_id FROM ${s.real('deals')} WHERE id = ${String(handed)}`))['owner_id'])).toBe(owner('dana'));
      expect(String((await one(`SELECT rep_id FROM ${s.real('site_visits')} WHERE id = ${String(booked)}`))['rep_id'])).toBe(owner('dana'));
      expect(String((await one(`SELECT owner_id FROM ${s.real('follow_ups')} WHERE id = ${String(open)}`))['owner_id'])).toBe(owner('dana'));
      // To Leo, who is free then, it goes, the visit with it.
      expect(said(await press('dana', 'deals', handed, 'hand-over', 'open', { owner_id: owner('leo') }))).toBe('ok');
      expect(String((await one(`SELECT rep_id FROM ${s.real('site_visits')} WHERE id = ${String(booked)}`))['rep_id'])).toBe(owner('leo'));
    });

    it('R1d: another team\'s manager whose rep helps on Dana\'s deal is refused it on every door; the helper reads and comments', async () => {
      const helped = await deal('dana', 'P4 Atrium refit', 'dana', { typed_amount: 61000 });
      expect(said(await post('dana', 'deal_members', { deal_id: helped, user_id: owner('noor') }))).toBe('ok');
      // The helper: she reads the deal and comments on it. Her own visit and follow-up there are made for her (since 0.3.36
      // a helper books and adds nothing on the deal herself: ruling 1d, proved below).
      expect((await get('noor', 'deals', `/${String(helped)}`)).statusCode).toBe(200);
      const comment = made(await post('noor', 'comments', { deal_id: helped, text: 'Noor can survey the atrium on Friday' }));
      const noorsVisit = await visit('tessa', helped, 'noor', 6);
      const noorsStep = await step('tessa', helped, 'noor', 'P4 Noor sends the survey');
      const note = made(await post('dana', 'activities', { deal_id: helped, kind: 'note', text: 'P4 the atrium is 14 m high' }));
      const priced = made(await post('ivy', 'price_list', { name: 'P4 Acoustic baffle', list_rate: 300 }));
      const quote = made(await post('dana', 'quotes', { deal_id: helped }, { children: { quote_lines: [{ values: { description: 'Baffles', qty: 100, rate: 250, price_id: priced } }] } }));
      const line = (await ids(`SELECT id FROM ${s.real('quote_lines')} WHERE document_id = ${String(quote)}`))[0]!;
      const member = (await ids(`SELECT id FROM ${s.real('deal_members')} WHERE deal_id = ${String(helped)}`))[0]!;

      // Omar leads Noor, and Dana is nobody he leads: nothing of the deal is his, however he asks.
      const gotOmar: Record<string, unknown> = {};
      gotOmar['deals'] = (await keys('omar', 'deals')) as number[];
      for (const [ref, column] of [['comments', 'deal_id'], ['activities', 'deal_id'], ['quotes', 'deal_id'], ['site_visits', 'deal_id'], ['follow_ups', 'deal_id'], ['deal_members', 'deal_id'], ['deal_stage_changes', 'deal_id']] as const) {
        gotOmar[ref] = await keys('omar', ref, { column, op: 'eq', value: helped });
      }
      gotOmar['quote_lines'] = await keys('omar', 'quote_lines', { column: 'document_id', op: 'eq', value: quote });
      expect((gotOmar['deals'] as number[]).includes(helped)).toBe(false);
      delete gotOmar['deals'];
      expect(gotOmar).toEqual({ comments: [], activities: [], quotes: [], site_visits: [], follow_ups: [], deal_members: [], deal_stage_changes: [], quote_lines: [] });
      await gone('omar', 'deals', helped);
      await gone('omar', 'deals', helped, '/history?limit=20');
      for (const [ref, key] of [['site_visits', noorsVisit], ['follow_ups', noorsStep], ['comments', comment], ['activities', note], ['quotes', quote], ['quote_lines', line], ['deal_members', member]] as const) await gone('omar', ref, key);
      // A change is refused as a row that is not there, the helper's own visit included.
      expect(said(await patch('omar', 'deals', helped, { name: 'Omar was here' }))).toBe('404 NOT_FOUND');
      expect(said(await patch('omar', 'site_visits', noorsVisit, { note: 'Omar was here' }))).toBe('404 NOT_FOUND');
      expect(said(await patch('omar', 'follow_ups', noorsStep, { text: 'Omar was here' }))).toBe('404 NOT_FOUND');
      // Figures and the board's totals: the deal is in none of his.
      const byId = [{ column: 'id', op: 'eq', value: helped }];
      const counted = await figure('omar', 'deals', { shape: 'single-metric', filters: byId, aggregations: [{ fn: 'count', alias: 'n' }] });
      expect(counted.statusCode, counted.body).toBe(200);
      expect(Number((counted.json() as { result: { value: number } }).result.value)).toBe(0);
      const board = await figure('omar', 'deals', { shape: 'categorical', filters: [{ column: 'state', op: 'eq', value: 'open' }], groupBy: ['stage_id'], aggregations: [{ fn: 'sum', column: 'amount', alias: 'v' }], limit: 200 });
      expect(board.statusCode, board.body).toBe(200);
      const omarsSum = (board.json() as { result: { items: { values?: Record<string, number>; value: number }[] } }).result.items.reduce((sum, item) => sum + Number(item.values?.['v'] ?? item.value), 0);
      expect(omarsSum).toBe(0);
      // Jump's reads (a search by the deal's name), and a file out.
      const searched = await get('omar', 'deals', `?limit=20&q=${encodeURIComponent('Atrium refit')}`);
      expect(searched.statusCode, searched.body).toBe(200);
      expect((searched.json() as { data: unknown[] }).data).toEqual([]);
      const asked = await s.app.inject({ method: 'POST', url: '/api/v1/exports', headers: { cookie: who('omar') }, payload: { connectionId: s.connectionId, source: { kind: 'table', table: s.t('deals') }, format: 'csv' } });
      expect(asked.statusCode, asked.body).toBeLessThan(300);
      await s.jobs();
      const file = await s.app.inject({ method: 'GET', url: `/api/v1/exports/${String((asked.json() as { data: { id: unknown } }).data.id)}/download`, headers: { cookie: who('omar') } });
      expect(file.statusCode, file.body.slice(0, 200)).toBe(200);
      expect(file.body).not.toContain('Atrium refit');

      // The quiet line: the deal's mark says whose it is and in which stage, and carries no amount and no name.
      const mark = await get('omar', 'deal_marks', `?limit=5&where=${encodeURIComponent(JSON.stringify({ column: 'deal_id', op: 'eq', value: helped }))}`);
      expect(mark.statusCode, mark.body).toBe(200);
      const [quiet] = (mark.json() as { data: Record<string, unknown>[] }).data;
      expect(quiet?.['owner_id']).toBe(owner('dana'));
      expect(Object.keys(quiet ?? {}).filter((column) => /amount|value|name/.test(column))).toEqual([]);

      // Ivy leads Dana: the deal and every row of it, the helper's own visit and follow-up included.
      for (const [ref, key] of [['deals', helped], ['site_visits', noorsVisit], ['follow_ups', noorsStep], ['comments', comment], ['quote_lines', line]] as const) expect((await get('ivy', ref, `/${String(key)}`)).statusCode, `ivy ${ref}`).toBe(200);
      // The helper comments, and her reply is there; she does not hand the deal over or change its amount.
      expect(said(await post('noor', 'comments', { deal_id: helped, parent_id: comment, text: 'Friday at ten' }))).toBe('ok');

      // The bell: Noor asks for a discount on Dana's quote. A helper asks nothing (ruling 1d); while she COVERS for Dana she
      // does. Ivy, who leads the DEAL's owner, is told, and the CRM admin; Omar, Noor's lead, is not.
      type Told = { title: string };
      const toldOf = async (person: string): Promise<number> => ((await s.meta.db.selectFrom('adminium_notifications').select(['title']).where('userId', '=', owner(person)).where('title', 'like', '%needs your approval').execute()) as Told[]).length;
      const before = { ivy: await toldOf('ivy'), omar: await toldOf('omar'), tessa: await toldOf('tessa') };
      expect(said(await press('noor', 'quotes', quote, 'ask-approval', 'draft', { ask_reason: 'The atrium is a showcase' }))).toBe('404 NOT_FOUND');
      const lent = made(await post('tessa', 'covers', { owner_id: owner('dana'), cover_id: owner('noor'), starts_on: onDay(-3), ends_on: onDay(3) }));
      expect(said(await press('noor', 'quotes', quote, 'ask-approval', 'draft', { ask_reason: 'The atrium is a showcase' }))).toBe('ok');
      expect(said(await s.app.inject({ method: 'DELETE', url: url('covers', `/${String(lent)}?confirm=true`), headers: { cookie: who('tessa') } }))).toBe('ok');
      await s.jobs();
      expect({ ivy: (await toldOf('ivy')) - before.ivy, omar: (await toldOf('omar')) - before.omar, tessa: (await toldOf('tessa')) - before.tessa }).toEqual({ ivy: 1, omar: 0, tessa: 1 });
      // …and Omar is not handed the request on Approvals either.
      expect(await keys('omar', 'quotes', { column: 'asked_at', op: 'not_null' })).not.toContain(quote);
      expect(await keys('ivy', 'quotes', { column: 'asked_at', op: 'not_null' })).toContain(quote);
    });

    it('ruling 1d: a helper reads the deal and comments, and changes, sends, logs, books and adds nothing of it; the cover, the owner, the manager and the CRM admin write', async () => {
      const del = (person: string, ref: string, key: unknown) => s.app.inject({ method: 'DELETE', url: url(ref, `/${String(key)}?confirm=true`), headers: { cookie: who(person) } });
      const contact = (await ids(`SELECT id FROM ${s.real('contacts')} WHERE company_id = ${String(company)} AND email IS NOT NULL`))[0]!;
      expect(contact, 'the first company has a contact with an address').toBeGreaterThan(0);
      const priced = made(await post('ivy', 'price_list', { name: 'P5 Acoustic panel', list_rate: 200 }));
      const withLine = { children: { quote_lines: [{ values: { description: 'Panels', qty: 5, rate: 200, price_id: priced } }] } };
      const lostReason = (await ids(`SELECT id FROM ${s.real('lost_reasons')}`))[0]!;
      const otherStage = (await ids(`SELECT id FROM ${s.real('stages')}`))[1]!;

      // Dana's deal, Leo listed on it. What Leo made there before he only helped: a follow-up and a visit of his own.
      const helped = await deal('dana', 'P5 helped deal', 'dana', { contact_id: contact });
      expect(said(await post('dana', 'deal_members', { deal_id: helped, user_id: owner('leo') }))).toBe('ok');
      const leosStep = await step('tessa', helped, 'leo', 'P5 Leo sends the plan');
      const leosVisit = await visit('tessa', helped, 'leo', 7);
      // Dana's on it: a quote with a line, a note, a visit written up with a point agreed, a briefing note. (A stock need is
      // proved in crm-crew, whose install writes Supply's needs.)
      const quote = made(await post('dana', 'quotes', { deal_id: helped, sent_to_contact_id: contact }, withLine));
      const line = (await ids(`SELECT id FROM ${s.real('quote_lines')} WHERE document_id = ${String(quote)}`))[0]!;
      const note = made(await post('dana', 'activities', { deal_id: helped, kind: 'note', text: 'P5 Dana measured up' }));
      const danasVisit = await visit('tessa', helped, 'dana', 8);
      expect(said(await patch('dana', 'site_visits', danasVisit, { starts_at: inDays(-2, 21) }))).toBe('ok');
      const writeUp = made(await post('dana', 'visit_notes', { visit_id: danasVisit, saw: 'P5 a low ceiling' }));
      const point = made(await post('dana', 'visit_agreed', { visit_note_id: writeUp, text: 'P5 the panels in grey', position: 0 }));
      const away = made(await post('tessa', 'covers', { owner_id: owner('dana'), cover_id: owner('sam'), starts_on: onDay(200), ends_on: onDay(201) }));
      const brief = made(await post('dana', 'cover_notes', { cover_id: away, deal_id: helped, text: 'P5 the buyer decides on Friday' }));
      const danasComment = made(await post('dana', 'comments', { deal_id: helped, text: 'P5 Leo, you know the buyer?' }));
      const won = await deal('dana', 'P5 helped and won', 'dana');
      expect(said(await post('dana', 'deal_members', { deal_id: won, user_id: owner('leo') }))).toBe('ok');
      expect(said(await press('dana', 'deals', won, 'mark-won', 'open', { close_note: 'P5 won' }))).toBe('ok');

      // He reads all of it, as before.
      const reads: Record<string, number> = {};
      for (const [ref, key] of [['deals', helped], ['deals', won], ['quotes', quote], ['quote_lines', line], ['activities', note], ['site_visits', danasVisit], ['visit_notes', writeUp], ['visit_agreed', point], ['cover_notes', brief], ['comments', danasComment], ['follow_ups', leosStep], ['site_visits', leosVisit]] as const) {
        reads[`${ref} ${String(key)}`] = (await get('leo', ref, `/${String(key)}`)).statusCode;
      }
      expect(Object.entries(reads).filter(([, code]) => code !== 200)).toEqual([]);

      const rowOf = async (ref: string, key: number) => JSON.stringify(await one(`SELECT * FROM ${s.real(ref)} WHERE id = ${String(key)}`));
      const held = [['deals', helped], ['deals', won], ['quotes', quote], ['quote_lines', line], ['activities', note], ['visit_notes', writeUp], ['visit_agreed', point], ['cover_notes', brief]] as const;
      const before = await Promise.all(held.map(([ref, key]) => rowOf(ref, key)));
      const counted = async () => Promise.all(['quotes', 'activities', 'follow_ups', 'site_visits', 'visit_agreed'].map(async (ref) => (await ids(`SELECT id FROM ${s.real(ref)}`)).length));
      const countedBefore = await counted();

      // A change of the deal or of anything on it is refused as a row that is not there, by every door.
      // A refusal other than "not there" says what it was, body and all, so a failure names its door's reason.
      const door = (res: Reply): string => (said(res) === '404 NOT_FOUND' ? said(res) : `${said(res)} ${res.body}`);
      const changes: Record<string, string> = {
        stage: door(await patch('leo', 'deals', helped, { stage_id: otherStage })),
        amount: door(await patch('leo', 'deals', helped, { typed_amount: 9999 })),
        contact: door(await patch('leo', 'deals', helped, { contact_id: null })),
        close: door(await patch('leo', 'deals', helped, { expected_close: onDay(30) })),
        'mark-won': door(await press('leo', 'deals', helped, 'mark-won', 'open', { close_note: 'Leo closed it' })),
        'mark-lost': door(await press('leo', 'deals', helped, 'mark-lost', 'open', { lost_reason_id: lostReason, close_note: 'Leo lost it' })),
        reopen: door(await press('leo', 'deals', won, 'reopen', 'won')),
        'hand-over': door(await press('leo', 'deals', helped, 'hand-over', 'open', { owner_id: owner('leo') })),
        'quote notes': door(await patch('leo', 'quotes', quote, { notes: 'Leo was here' })),
        'quote sent': door(await patch('leo', 'quotes', quote, { status: 'sent' })),
        'ask-approval': door(await press('leo', 'quotes', quote, 'ask-approval', 'draft', { ask_reason: 'Leo asks' })),
        'line edit': door(await patch('leo', 'quote_lines', line, { qty: 6 })),
        'line delete': door(await del('leo', 'quote_lines', line)),
        'note edit': door(await patch('leo', 'activities', note, { text: 'Leo was here' })),
        'visit notes': door(await patch('leo', 'visit_notes', writeUp, { saw: 'Leo was here' })),
        'agreed edit': door(await patch('leo', 'visit_agreed', point, { text: 'Leo was here' })),
        'agreed delete': door(await del('leo', 'visit_agreed', point)),
        'cover note': door(await patch('leo', 'cover_notes', brief, { text: 'Leo was here' })),
      };
      expect(changes, JSON.stringify(changes)).toEqual(Object.fromEntries(Object.keys(changes).map((key) => [key, '404 NOT_FOUND'])));
      expect(bulked(await bulk('leo', 'deals', [helped], { typed_amount: 9999 }))).toEqual([{ id: String(helped), ok: false, error: 'NOT_FOUND' }]);
      expect(bulked(await bulk('leo', 'quotes', [quote], { notes: 'Leo was here' }))).toEqual([{ id: String(quote), ok: false, error: 'NOT_FOUND' }]);
      const upload = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=deals.csv', headers: { cookie: who('leo'), 'content-type': 'text/csv' }, payload: `id,typed_amount\n${String(helped)},9999\n` });
      const brought = upload.statusCode >= 300 ? upload : await s.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: who('leo') }, payload: { fileId: (upload.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t('deals'), mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'typed_amount', to: 'typed_amount' }] }, options: { mode: 'upsert', matchColumn: 'id' } } });
      expect(brought.statusCode, brought.body).toBe(403);

      // Nothing new of his is hung on it: a quote, a line, a note or call, a follow-up or a visit naming him, an agreed point.
      const adds: Record<string, unknown> = {};
      for (const [label, res] of [
        ['quote', await post('leo', 'quotes', { deal_id: helped })],
        ['quote with a line', await post('leo', 'quotes', { deal_id: helped }, withLine)],
        ['line', await post('leo', 'quote_lines', { document_id: quote, description: 'Leo adds', qty: 1, rate: 200, price_id: priced })],
        ['call', await post('leo', 'activities', { deal_id: helped, kind: 'call', text: 'Leo rang the buyer' })],
        ['follow-up', await post('leo', 'follow_ups', { deal_id: helped, owner_id: owner('leo'), due_at: inDays(5), text: 'Leo rings back', kind: 'step' })],
        ['visit', await post('leo', 'site_visits', { deal_id: helped, rep_id: owner('leo'), starts_at: inDays(9, 21), minutes: 45, purpose: 'Leo goes' })],
      ] as const) {
        adds[label] = [said(res), reason(res)];
      }
      expect(adds, JSON.stringify(adds)).toEqual(Object.fromEntries(Object.keys(adds).map((key) => [key, ['403 COLUMN_FORBIDDEN', 'parent-not-theirs']])));
      // Nor an agreed point under a colleague's write-up: it hangs off its visit by `visit_id`, a copy no writer sends, and
      // the engine judges the new row by the link that copy reads through (Adminium 0.3.36).
      const point2 = await post('leo', 'visit_agreed', { visit_note_id: writeUp, text: 'Leo agrees', position: 1 });
      expect([said(point2), reason(point2)], point2.body).toEqual(['403 COLUMN_FORBIDDEN', 'parent-not-theirs']);
      expect(await Promise.all(held.map(([ref, key]) => rowOf(ref, key)))).toEqual(before);
      expect(await counted()).toEqual(countedBefore);
      // Nor is a follow-up of his own moved onto it from a deal of his.
      const leosOwn = await deal('leo', 'P5 Leo\'s own', 'leo');
      const elsewhere = await step('leo', leosOwn, 'leo', 'P5 Leo on his own deal');
      const moved = await patch('leo', 'follow_ups', elsewhere, { deal_id: helped });
      expect([said(moved), reason(moved)]).toEqual(['403 COLUMN_FORBIDDEN', 'parent-not-theirs']);
      expect(Number((await one(`SELECT deal_id FROM ${s.real('follow_ups')} WHERE id = ${String(elsewhere)}`))['deal_id'])).toBe(leosOwn);

      // He comments and replies, and settles the thread he started.
      const thread = made(await post('leo', 'comments', { deal_id: helped, text: 'P5 Leo knows the buyer' }));
      expect(said(await post('leo', 'comments', { deal_id: helped, parent_id: danasComment, text: 'P5 yes, since 2019' }))).toBe('ok');
      expect(said(await patch('leo', 'comments', thread, { settled_at: new Date().toISOString() }))).toBe('ok');
      // What he made there before is his: he moves and finishes his follow-up, and moves his visit; then calls both off.
      expect(said(await patch('leo', 'follow_ups', leosStep, { due_at: inDays(6), text: 'P5 Leo sends the plan, Monday' }))).toBe('ok');
      expect(said(await patch('leo', 'follow_ups', leosStep, { done: true }))).toBe('ok');
      expect(said(await patch('leo', 'site_visits', leosVisit, { note: 'P5 bring the samples' }))).toBe('ok');
      expect(said(await del('leo', 'follow_ups', leosStep))).toBe('ok');
      expect(said(await del('leo', 'site_visits', leosVisit))).toBe('ok');

      // Dana, the owner, writes as before; Ivy, who leads her, and the CRM admin too.
      expect(said(await patch('dana', 'deals', helped, { typed_amount: 6200 }))).toBe('ok');
      expect(said(await patch('dana', 'quotes', quote, { notes: 'P5 Dana\'s note' }))).toBe('ok');
      expect(said(await patch('dana', 'quote_lines', line, { qty: 6 }))).toBe('ok');
      expect(said(await post('dana', 'activities', { deal_id: helped, kind: 'call', text: 'P5 Dana rang' }))).toBe('ok');
      expect(said(await post('dana', 'follow_ups', { deal_id: helped, owner_id: owner('dana'), due_at: inDays(4), text: 'P5 Dana rings back', kind: 'step' }))).toBe('ok');
      expect(said(await patch('dana', 'cover_notes', brief, { text: 'P5 the buyer decides on Monday' }))).toBe('ok');
      expect(said(await patch('ivy', 'deals', helped, { expected_close: onDay(40) }))).toBe('ok');
      expect(said(await patch('tessa', 'deals', helped, { name: 'P5 helped deal (checked)' }))).toBe('ok');

      // Priya covers for Leo (a cover, not a listing): his deal and its quote are hers to work while he is away.
      const leosDeal = await deal('leo', 'P5 Leo away', 'leo', { contact_id: contact });
      const leosQuote = made(await post('leo', 'quotes', { deal_id: leosDeal, sent_to_contact_id: contact }, withLine));
      expect(said(await patch('priya', 'deals', leosDeal, { typed_amount: 7000 }))).toBe('404 NOT_FOUND');
      const cover = made(await post('tessa', 'covers', { owner_id: owner('leo'), cover_id: owner('priya'), starts_on: onDay(-3), ends_on: onDay(3) }));
      expect(said(await patch('priya', 'deals', leosDeal, { typed_amount: 7000 }))).toBe('ok');
      expect(said(await post('priya', 'follow_ups', { deal_id: leosDeal, owner_id: owner('priya'), due_at: inDays(5), text: 'P5 Priya rings for Leo', kind: 'step' }))).toBe('ok');
      expect(await visit('priya', leosDeal, 'priya', 10)).toBeGreaterThan(0);
      expect(said(await post('priya', 'activities', { deal_id: leosDeal, kind: 'call', text: 'P5 Priya rang for Leo' }))).toBe('ok');
      expect(said(await patch('priya', 'quotes', leosQuote, { notes: 'P5 Priya checked it' }))).toBe('ok');
      const sent = await patch('priya', 'quotes', leosQuote, { status: 'sent' });
      expect(said(sent), sent.body).toBe('ok');
      expect(said(await press('priya', 'deals', leosDeal, 'mark-won', 'open', { close_note: 'P5 Priya closed it for Leo' }))).toBe('ok');
      expect(said(await del('tessa', 'covers', cover))).toBe('ok');

      // The account manager: an aftercare call (the rule's: on the job's won deal, which is not his) he makes as before;
      // a follow-up of his on no deal is his; hung on a deal he does not own, won or one he is listed on, it is refused.
      const job = await one(`SELECT j.id, j.deal_id FROM ${s.real('jobs')} j JOIN ${s.real('deals')} d ON d.id = j.deal_id WHERE d.state = 'won' AND d.owner_id <> '${owner('hugo')}' ORDER BY j.id`);
      const call = made(await post('tessa', 'follow_ups', { job_id: job['id'], deal_id: job['deal_id'], owner_id: owner('hugo'), due_at: inDays(3), text: 'P5 aftercare call', kind: 'aftercare' }));
      expect((await get('hugo', 'follow_ups', `/${String(call)}`)).statusCode).toBe(200);
      expect(said(await patch('hugo', 'follow_ups', call, { done: true, outcome: 'none' }))).toBe('ok');
      expect(said(await post('hugo', 'follow_ups', { owner_id: owner('hugo'), due_at: inDays(2), text: 'P5 Hugo rings the office', kind: 'step' }))).toBe('ok');
      const onWon = await post('hugo', 'follow_ups', { deal_id: job['deal_id'], owner_id: owner('hugo'), due_at: inDays(2), text: 'P5 Hugo on a won deal', kind: 'step' });
      expect([said(onWon), reason(onWon)]).toEqual(['403 COLUMN_FORBIDDEN', 'parent-not-theirs']);
      expect(said(await post('dana', 'deal_members', { deal_id: helped, user_id: owner('hugo') }))).toBe('ok');
      expect((await get('hugo', 'deals', `/${String(helped)}`)).statusCode).toBe(200);
      const onListed = await post('hugo', 'follow_ups', { deal_id: helped, owner_id: owner('hugo'), due_at: inDays(2), text: 'P5 Hugo helps', kind: 'step' });
      expect([said(onListed), reason(onListed)]).toEqual(['403 COLUMN_FORBIDDEN', 'parent-not-theirs']);
    });

    it('S2: a request is decided only from asked, never by who asked nor by the deal\'s owner; "Reopen it" keeps the asker', async () => {
      const priced = made(await post('ivy', 'price_list', { name: 'P4 Partition', list_rate: 2000 }));
      const theirs = await deal('dana', 'P4 partitions', 'dana');
      const lines = { children: { quote_lines: [{ values: { description: 'Partitions', qty: 1, rate: 1500, price_id: priced } }] } };
      const quoteOf = async (dealId: number) => made(await post('tessa', 'quotes', { deal_id: dealId }, lines));
      const row = async (key: number) => one(`SELECT approval, asked_by_id, decided_by_id, decision_note, asked_at FROM ${s.real('quotes')} WHERE id = ${String(key)}`);

      // Dana asks: she is the asker and the deal's owner. Approve or refuse is refused to her by every door.
      const danas = await quoteOf(theirs);
      expect(said(await press('dana', 'quotes', danas, 'ask-approval', 'draft', { ask_reason: 'A loyal customer' }))).toBe('ok');
      expect((await row(danas))['asked_by_id']).toBe(owner('dana'));
      expect(said(await press('dana', 'quotes', danas, 'approve', 'draft', { decision_note: 'Mine' }))).toMatch(/^403/);
      expect(said(await patch('dana', 'quotes', danas, { approval: 'approved' }))).toMatch(/^403/);

      // Ivy asks on Dana's deal: Ivy is now the asker, and never decides it, by PATCH, bulk edit or the button.
      const ivys = await quoteOf(theirs);
      expect(said(await press('ivy', 'quotes', ivys, 'ask-approval', 'draft', { ask_reason: 'I asked for Dana' }))).toBe('ok');
      const byPatch = await patch('ivy', 'quotes', ivys, { approval: 'approved' });
      expect([said(byPatch), reason(byPatch)]).toEqual(['403 COLUMN_FORBIDDEN', 'change-not-by']);
      const byBulk = await bulk('ivy', 'quotes', [ivys], { approval: 'refused' });
      expect([said(byBulk), reason(byBulk)]).toEqual(['403 COLUMN_FORBIDDEN', 'change-not-by']);
      expect(said(await press('ivy', 'quotes', ivys, 'approve', 'draft', { decision_note: 'Mine' }))).toBe('403 COLUMN_FORBIDDEN');
      // A file is no door either: nobody below the install's owner brings quotes in.
      const upload = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=quotes.csv', headers: { cookie: who('ivy'), 'content-type': 'text/csv' }, payload: `id,approval\n${String(ivys)},approved\n` });
      const brought = upload.statusCode >= 300 ? upload : await s.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: who('ivy') }, payload: { fileId: (upload.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t('quotes'), mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'approval', to: 'approval' }] }, options: { mode: 'upsert', matchColumn: 'id' } } });
      expect(brought.statusCode, brought.body).toBe(403);
      expect((await row(ivys))['approval']).toBe('asked');
      // The CRM admin decides it.
      expect(said(await press('tessa', 'quotes', ivys, 'approve', 'draft', { decision_note: 'Fine by me' }))).toBe('ok');

      // Ivy's own deal: the CRM admin asks, and Ivy, its owner, does not decide; the CRM admin, now the asker, neither.
      const herDeal = await deal('ivy', 'P4 Ivy\'s own', 'ivy');
      const onHers = await quoteOf(herDeal);
      expect(said(await press('tessa', 'quotes', onHers, 'ask-approval', 'draft', { ask_reason: 'Ivy\'s customer' }))).toBe('ok');
      expect(reason(await patch('ivy', 'quotes', onHers, { approval: 'approved' }))).toBe('change-not-by');
      expect(reason(await patch('tessa', 'quotes', onHers, { approval: 'approved' }))).toBe('change-not-by');
      expect(said(await patch('owner', 'quotes', onHers, { approval: 'approved' }))).toBe('ok');
      // Nor is the bar moved for one quote so that it needs no approval at all: a quote's threshold is the settings',
      // taken when it is made, and nobody writes it afterwards (create, PATCH or bulk edit).
      for (const person of ['ivy', 'tessa']) {
        expect(said(await post(person, 'quotes', { deal_id: herDeal, threshold_pct: 100 }, lines)), person).toMatch(/^403/);
        expect(said(await patch(person, 'quotes', onHers, { threshold_pct: 100 })), person).toMatch(/^403/);
        expect(said(await bulk(person, 'quotes', [onHers], { threshold_pct: 100 })), person).toBe('403 COLUMN_FORBIDDEN');
      }
      expect(Number((await one(`SELECT threshold_pct FROM ${s.real('quotes')} WHERE id = ${String(onHers)}`))['threshold_pct'])).not.toBe(100);

      // Decided only from asked: a quote nobody asked about is not approved, by anybody.
      const unasked = await quoteOf(theirs);
      const fromNone = await patch('tessa', 'quotes', unasked, { approval: 'approved' });
      expect([said(fromNone), reason(fromNone)]).toEqual(['403 COLUMN_FORBIDDEN', 'change-from']);

      // "Reopen it": Ivy approves Dana's request, then reopens it with a note. Still Dana's request; Ivy decides again.
      expect(said(await press('ivy', 'quotes', danas, 'approve', 'draft', { decision_note: 'Approved at 25 %' }))).toBe('ok');
      const decided = await row(danas);
      expect([decided['approval'], decided['decided_by_id']]).toEqual(['approved', owner('ivy')]);
      // Dana, who asked and owns the deal, may not reopen a decision (only her own "ask again", below).
      expect(said(await press('dana', 'quotes', danas, 'reopen-approval', 'draft', { decision_note: 'Again' }))).toMatch(/^403/);
      expect(said(await press('ivy', 'quotes', danas, 'reopen-approval', 'draft', { decision_note: 'The margin needs a second look' }))).toBe('ok');
      const reopened = await row(danas);
      expect([reopened['approval'], reopened['asked_by_id'], reopened['decided_by_id'], reopened['decision_note']]).toEqual(['asked', owner('dana'), owner('ivy'), 'The margin needs a second look']);
      // The decision before stays in the record's history.
      const history = await get('ivy', 'quotes', `/${String(danas)}/history?limit=50`);
      expect(history.statusCode, history.body).toBe(200);
      expect(history.body).toContain('approved');
      expect(history.body).toContain('Approved at 25 %');
      expect(said(await press('ivy', 'quotes', danas, 'refuse', 'draft', { decision_note: 'Hold the list price' }))).toBe('ok');
      // After a refusal the rep changes the version and asks again (plan-67 decision 63): hers to do.
      expect(said(await press('dana', 'quotes', danas, 'ask-approval', 'draft', { ask_reason: 'Two fewer panels' }))).toBe('ok');
      expect((await row(danas))['asked_by_id']).toBe(owner('dana'));
      // Back to asked only on a draft: another team's manager reaches none of it to try.
      expect(said(await press('omar', 'quotes', danas, 'reopen-approval', 'draft', { decision_note: 'Mine now' }))).toBe('404 NOT_FOUND');
    });

    it('X2: the sales manager never sets her own target nor her own first-year target, and marks only her meeting\'s decisions', async () => {
      const year = new Date().getUTCFullYear() + 1;
      const hers = made(await post('tessa', 'targets', { rep_id: owner('ivy'), year, amount: 400000 }));
      const danas = made(await post('tessa', 'targets', { rep_id: owner('dana'), year, amount: 150000 }));
      // Her own: not there, by PATCH and bulk edit; a new one for herself is refused; her rep's is hers to set.
      expect(said(await patch('ivy', 'targets', hers, { amount: 1 }))).toBe('404 NOT_FOUND');
      expect(bulked(await bulk('ivy', 'targets', [hers, danas], { amount: 160000 }))).toEqual([
        { id: String(hers), ok: false, error: 'NOT_FOUND' },
        { id: String(danas), ok: true },
      ]);
      const another = await post('ivy', 'targets', { rep_id: owner('ivy'), year: year + 1, amount: 1 });
      expect([said(another), reason(another)]).toEqual(['403 COLUMN_FORBIDDEN', 'not-by']);
      expect(Number((await one(`SELECT amount FROM ${s.real('targets')} WHERE id = ${String(hers)}`))['amount'])).toBe(400000);
      expect(Number((await one(`SELECT amount FROM ${s.real('targets')} WHERE id = ${String(danas)}`))['amount'])).toBe(160000);
      // A file is no door: she brings no targets in at all.
      const upload = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=targets.csv', headers: { cookie: who('ivy'), 'content-type': 'text/csv' }, payload: `id,amount\n${String(hers)},1\n` });
      const brought = upload.statusCode >= 300 ? upload : await s.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: who('ivy') }, payload: { fileId: (upload.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t('targets'), mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'amount', to: 'amount' }] }, options: { mode: 'upsert', matchColumn: 'id' } } });
      expect(brought.statusCode, brought.body).toBe(403);

      // Her own starter row (a manager starting in the team she leads): its first-year target is not hers to set.
      const herself = made(await post('tessa', 'starters', { name: 'Ivy Sandoval', starts_on: '2027-01-04', manager_id: owner('ivy'), user_id: owner('ivy') }));
      expect(said(await patch('ivy', 'starters', herself, { first_year_target: 90000 }))).toBe('404 NOT_FOUND');
      const nia = (await ids(`SELECT id FROM ${s.real('starters')} WHERE user_id IS NULL AND manager_id = '${owner('ivy')}'`))[0]!;
      expect(bulked(await bulk('ivy', 'starters', [herself, nia], { first_year_target: 56250 }))).toEqual([
        { id: String(herself), ok: false, error: 'NOT_FOUND' },
        { id: String(nia), ok: true },
      ]);
      expect((await one(`SELECT first_year_target FROM ${s.real('starters')} WHERE id = ${String(herself)}`))['first_year_target']).toBeNull();

      // The sample's meeting is Ivy's: she marks its decisions; Omar, who runs none of it, may not.
      const meeting = (await ids(`SELECT id FROM ${s.real('meetings')}`))[0]!;
      expect((await one(`SELECT run_by_id FROM ${s.real('meetings')} WHERE id = ${String(meeting)}`))['run_by_id']).toBe(owner('ivy'));
      const decision = made(await post('tessa', 'meeting_decisions', { meeting_id: meeting, text: 'P4 ring every lead within a day', who_id: owner('sam') }));
      expect(said(await patch('omar', 'meeting_decisions', decision, { state: 'done' }))).toBe('404 NOT_FOUND');
      expect(said(await patch('ivy', 'meeting_decisions', decision, { state: 'done' }))).toBe('ok');
      // A meeting the CRM admin runs: who runs it is stamped, never typed; Ivy marks none of its decisions, by any door.
      const theirs = made(await post('tessa', 'meetings', { at: inDays(9), minutes: 30, run_by_id: owner('ivy') }));
      expect((await one(`SELECT run_by_id FROM ${s.real('meetings')} WHERE id = ${String(theirs)}`))['run_by_id']).toBe(owner('tessa'));
      const theirDecision = made(await post('tessa', 'meeting_decisions', { meeting_id: theirs, text: 'P4 one more call a day', who_id: owner('dana') }));
      expect(said(await patch('ivy', 'meeting_decisions', theirDecision, { state: 'carried' }))).toBe('404 NOT_FOUND');
      expect(bulked(await bulk('ivy', 'meeting_decisions', [theirDecision], { state: 'carried' }))).toEqual([{ id: String(theirDecision), ok: false, error: 'NOT_FOUND' }]);
      expect(said(await post('ivy', 'meeting_decisions', { meeting_id: theirs, text: 'P4 Ivy adds one' }))).toMatch(/^403/);
      expect((await one(`SELECT state FROM ${s.real('meeting_decisions')} WHERE id = ${String(theirDecision)}`))['state']).toBe('open');
    });

    it('E4: a quote and its lines are one write, and a line the server refuses refuses the whole quote', async () => {
      const open = await deal('dana', 'P4 one write', 'dana');
      const count = async (): Promise<[number, number]> => [(await ids(`SELECT id FROM ${s.real('quotes')}`)).length, (await ids(`SELECT id FROM ${s.real('quote_lines')}`)).length];
      const priced = made(await post('ivy', 'price_list', { name: 'P4 Desk', list_rate: 500 }));
      const retired = made(await post('ivy', 'price_list', { name: 'P4 Old desk', list_rate: 400 }));
      expect(said(await patch('ivy', 'price_list', retired, { active: false }))).toBe('ok');
      const withLines = (values: Record<string, unknown>[]) => ({ children: { quote_lines: values.map((line) => ({ values: line })) } });

      const quote = made(await post('dana', 'quotes', { deal_id: open }, withLines([{ description: 'Desks', qty: 4, rate: 500, price_id: priced, position: 0 }, { description: 'Fitting', qty: 1, rate: 300, position: 1 }])));
      expect((await s.rows(`SELECT description, qty FROM ${s.real('quote_lines')} WHERE document_id = ${String(quote)} ORDER BY position`)).map((row) => [row['description'], Number(row['qty'])])).toEqual([['Desks', 4], ['Fitting', 1]]);
      expect(Number((await one(`SELECT subtotal FROM ${s.real('quotes')} WHERE id = ${String(quote)}`))['subtotal'])).toBe(2300);

      const before = await count();
      // A line naming a price no longer offered (linkable), a line typing what the server works out (creatable): nothing.
      expect(said(await post('dana', 'quotes', { deal_id: open }, withLines([{ description: 'Desks', qty: 1, rate: 500, price_id: priced }, { description: 'Old', qty: 1, rate: 400, price_id: retired }])))).toBe('422 VALIDATION_FAILED');
      expect(said(await post('dana', 'quotes', { deal_id: open }, withLines([{ description: 'Typed list', qty: 1, rate: 1, list_rate: 999 }])))).toMatch(/^4/);
      // Reach: a quote with lines on a deal that is not hers (Sam's), and the manager's on another team's deal (Noor's).
      const sams = await deal('sam', 'P4 Sam\'s', 'sam');
      expect(said(await post('dana', 'quotes', { deal_id: sams }, withLines([{ description: 'Hers?', qty: 1, rate: 1 }])))).toMatch(/^4/);
      const noors = await deal('noor', 'P4 Noor\'s', 'noor');
      expect(said(await post('ivy', 'quotes', { deal_id: noors }, withLines([{ description: 'Ivy\'s?', qty: 1, rate: 1 }])))).toMatch(/^4/);
      expect(await count()).toEqual(before);
    });
  });
}
