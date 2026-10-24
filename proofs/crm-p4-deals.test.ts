/**
 * Plan 68, phase 4 (T26a): a deal, its hand-over, its approvals and its quotes on Adminium 0.3.35's words, against the
 * whole server with the app's manifest and its sample, on SQLite, Postgres and MySQL, SIGNED IN AS THE PERSON EACH RULE
 * LIMITS, and as the one it lets through:
 *
 *  - R1a (E28): no new quote on a won or a lost deal, by any door; one on an open deal is made; the sample (history)
 *    still brings quotes on won deals;
 *  - R1c (E12): a hand-over moves the old owner's visits not yet made and her open follow-ups to the new owner in its
 *    own write, and nothing else: a made visit, a done follow-up, a helper's and a manager's own rows stay;
 *  - R1d (E11): another team's manager whose rep helps on Dana's deal is refused the deal and every row of it (the
 *    list, the record, its history, figures and board totals, a search, an export, the bell), the helper's own visit
 *    and follow-up included; the helper reads and comments; the quiet line (the deal's mark) names Dana, no amount;
 *  - S2 (E1): a request is decided only from asked, never by who asked nor by the deal's owner, by PATCH, bulk edit and
 *    the button; "Reopen it" puts a decision back to asked, keeps the asker, and the decision before stays in history;
 *  - X2 (E1): the sales manager never changes her own target nor her own starter row, and a meeting's decisions only
 *    when she runs it;
 *  - E4: a quote and its lines are one write; a line refused refuses the quote.
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
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.35' }));

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
  for (const key of ['dana', 'sam', 'priya', 'ivy', 'tessa', 'noor', 'omar', 'grace']) cookie[key] = await signIn(app, `${key}@crm.test`);

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
/** A moment so many days from now at a given hour, to the minute (a visit is never booked in the past). */
const inDays = (days: number, hour = 10): string => {
  const at = new Date(Date.now() + days * DAY);
  at.setUTCHours(hour, 0, 0, 0);
  return at.toISOString();
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's deals, hand-over, approvals and quotes on Adminium 0.3.35, on ${dialect}`, () => {
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
      made(await post(person, 'site_visits', { deal_id: dealId, rep_id: owner(rep), starts_at: inDays(days, 9 + (days % 7)), minutes: 45, purpose: `P4 visit ${rep} ${String(days)}` }));
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
      // History is not held: the sample brought quotes on deals that are won.
      expect((await s.rows(`SELECT q.id FROM ${s.real('quotes')} q JOIN ${s.real('deals')} d ON d.id = q.deal_id WHERE d.state = 'won'`)).length).toBeGreaterThan(0);
      for (const key of [mine, hers]) expect(said(await s.app.inject({ method: 'DELETE', url: url('quotes', `/${String(key)}?confirm=true`), headers: { cookie: who('tessa') } }))).toBe('ok');
    });

    it('R1c: a hand-over moves the old owner\'s visits not yet made and her open follow-ups in its own write, and nothing else', async () => {
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
      expect(said(await press('dana', 'deals', handed, 'hand-over', 'open', { owner_id: owner('priya') }))).toBe('ok');
      expect(String((await one(`SELECT owner_id FROM ${s.real('deals')} WHERE id = ${String(handed)}`))['owner_id'])).toBe(owner('priya'));
      expect(await visitsNow()).toEqual({ [booked]: [owner('priya'), owner('priya')], [madeVisit]: [owner('dana'), owner('priya')], [samsVisit]: [owner('sam'), owner('priya')] });
      expect(await stepsNow()).toEqual({ [open]: owner('priya'), [closed]: owner('dana'), [samsStep]: owner('sam'), [ivysStep]: owner('ivy') });
      // Each carried row is a change of its own, in its history: who moved it, and from whom.
      const history = await get('priya', 'site_visits', `/${String(booked)}/history?limit=20`);
      expect(history.statusCode, history.body).toBe(200);
      expect(history.body).toContain(owner('dana'));

      // Ivy, who leads them, hands it on to Leo: Priya's visit and follow-up go; Ivy's own follow-up stays hers.
      expect(said(await press('ivy', 'deals', handed, 'hand-over', 'open', { owner_id: owner('leo') }))).toBe('ok');
      expect(await visitsNow()).toEqual({ [booked]: [owner('leo'), owner('leo')], [madeVisit]: [owner('dana'), owner('leo')], [samsVisit]: [owner('sam'), owner('leo')] });
      expect(await stepsNow()).toEqual({ [open]: owner('leo'), [closed]: owner('dana'), [samsStep]: owner('sam'), [ivysStep]: owner('ivy') });
    });

    it('R1d: another team\'s manager whose rep helps on Dana\'s deal is refused it on every door; the helper reads and comments', async () => {
      const helped = await deal('dana', 'P4 Atrium refit', 'dana', { typed_amount: 61000 });
      expect(said(await post('dana', 'deal_members', { deal_id: helped, user_id: owner('noor') }))).toBe('ok');
      // The helper: she reads the deal, comments on it, and books her own visit and follow-up there.
      expect((await get('noor', 'deals', `/${String(helped)}`)).statusCode).toBe(200);
      const comment = made(await post('noor', 'comments', { deal_id: helped, text: 'Noor can survey the atrium on Friday' }));
      const noorsVisit = await visit('noor', helped, 'noor', 6);
      const noorsStep = await step('noor', helped, 'noor', 'P4 Noor sends the survey');
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

      // The bell: Noor asks for a discount on Dana's quote. Ivy, who leads the DEAL's owner, is told; Omar, Noor's lead, is not.
      type Told = { title: string };
      const toldOf = async (person: string): Promise<number> => ((await s.meta.db.selectFrom('adminium_notifications').select(['title']).where('userId', '=', owner(person)).where('title', 'like', '%needs your approval').execute()) as Told[]).length;
      const before = { ivy: await toldOf('ivy'), omar: await toldOf('omar'), tessa: await toldOf('tessa') };
      expect(said(await press('noor', 'quotes', quote, 'ask-approval', 'draft', { ask_reason: 'The atrium is a showcase' }))).toBe('ok');
      await s.jobs();
      expect({ ivy: (await toldOf('ivy')) - before.ivy, omar: (await toldOf('omar')) - before.omar, tessa: (await toldOf('tessa')) - before.tessa }).toEqual({ ivy: 1, omar: 0, tessa: 0 });
      // …and Omar is not handed the request on Approvals either.
      expect(await keys('omar', 'quotes', { column: 'asked_at', op: 'not_null' })).not.toContain(quote);
      expect(await keys('ivy', 'quotes', { column: 'asked_at', op: 'not_null' })).toContain(quote);
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
      expect(bulked(await bulk('ivy', 'quotes', [ivys], { approval: 'refused' }))[0]).toMatchObject({ ok: false });
      expect(said(await press('ivy', 'quotes', ivys, 'approve', 'draft', { decision_note: 'Mine' }))).toBe('403 COLUMN_FORBIDDEN');
      // A file is no door either: nobody below the install's owner brings quotes in.
      const upload = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=quotes.csv', headers: { cookie: who('ivy'), 'content-type': 'text/csv' }, payload: `id,approval\n${String(ivys)},approved\n` });
      const brought = upload.statusCode >= 300 ? upload : await s.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: who('ivy') }, payload: { fileId: (upload.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t('quotes'), mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'approval', to: 'approval' }] }, options: { mode: 'update', matchColumn: 'id' } } });
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
      const brought = upload.statusCode >= 300 ? upload : await s.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: who('ivy') }, payload: { fileId: (upload.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t('targets'), mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'amount', to: 'amount' }] }, options: { mode: 'update', matchColumn: 'id' } } });
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
