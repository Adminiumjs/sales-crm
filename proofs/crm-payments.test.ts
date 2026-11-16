/**
 * PAYING FOR AN ACCEPTED QUOTE ONLINE, against the whole server, on SQLite, Postgres and MySQL, with the app installed
 * through its routes, Invoices beside it and its sample in.
 *
 *  - the quote is payable, and the payable arrives switched off: someone who manages payments switches it on;
 *  - what is asked (nothing, a deposit, the whole amount) is the CRM admin's and the sales manager's setting, a whole
 *    1 to 99 %; a quote takes it when it is made, and the server works the deposit out;
 *  - the customer's link reads what is asked, paid and left of its own quote, and whether it can be paid now;
 *  - a payment lands once in the quote's payments, written by Adminium with its reference, service and currency, and
 *    moves neither the quote nor the deal; money for a quote not accepted, or accepted on a deal that was lost, is
 *    never written into the app (a person decides);
 *  - a refund writes what stands refunded, and the deposit is due again;
 *  - every role that reads quotes reads their payments, nobody writes one, and the CRM admin and the sales manager
 *    may refund (the staff config says so to the screens);
 *  - the "quote accepted" e-mail reads as before while nothing can be paid online;
 *  - the released 0.2.5, holding its sample and a quote accepted before, updates with every row kept: the new
 *    columns hold their rule's value, nothing is asked of an old quote, and the payable arrives switched off.
 *
 * To run: `npm run proofs -- payments` (copied into the engine's `apps/server/test/`, run, removed).
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PaymentProvider, RefundInput, RefundState } from '@adminium/add-on-contracts';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import {
  createFirstSuperAdmin,
  createSqliteMetaDb,
  firstRun,
  manifestsRepo,
  payableProfilesRepo,
  paymentAttemptsRepo,
  publicKeysRepo,
  settingsRepo,
  snapshotsRepo,
  usersRepo,
  type MetaDb,
  type PayableRef,
} from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { createPayableSources, type PayableSources } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import { requestRefund } from '../src/payments/refunds.js';
import { openPublishableKey } from '../src/public-api/keys.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// The server says the version it was built at; the app's floor is the release that takes payments in an app.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.60' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const ORIGIN = 'https://quotes.example.com';
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p72-crm`;
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
type Doc = Record<string, unknown> & { version: string; requiredSchema: { tables: { ref: string; columns: { ref: string }[] }[] }; sampleData: { people: { key: string; name: string; email: string; role: string }[] } };
const whole = (): Doc => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Doc;
const git = (...args: string[]): Buffer => execFileSync('git', ['-C', APP, ...args], { maxBuffer: 1 << 30 });
/** The released 0.2.5, as its tag holds it: the manifest and the sample the package shipped. */
const released = (): { manifest: Doc; sample: string } => ({ manifest: JSON.parse(git('show', 'v0.2.5:manifest.json').toString('utf8')) as Doc, sample: git('show', 'v0.2.5:seeds/meridian.json').toString('utf8') });

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `crm_pay_${randomBytes(4).toString('hex')}`;
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
interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  templateKey: string;
}
interface Stack {
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  t: (ref: string) => string;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  id: Record<string, string>;
  cookie: Record<string, string>;
  owner: string;
  token: Record<string, string>;
  jobs: () => Promise<void>;
  /** The mails queued since the last call (nothing is delivered: nothing listens). */
  mails: () => Promise<Mail[]>;
  /** The schema read again, after an update made tables. */
  reread: () => Promise<void>;
  upload: (document: Doc, sample: string) => Promise<void>;
  close: () => Promise<void>;
}

let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.12.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

/** A package as the server takes it: the manifest, the two sides, and the sample with each picture's bytes stood in for. */
function tarballOf(document: Doc, sample: string): Uint8Array {
  const packed = JSON.parse(sample) as { assets?: Record<string, { file: string; sha256: string }> };
  for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
  return packageTarball({
    'manifest.json': JSON.stringify(document),
    'staff/index.html': '<!doctype html><html><body></body></html>',
    'customer/index.html': '<!doctype html><html><body></body></html>',
    'seeds/meridian.json': JSON.stringify(packed),
  });
}

async function stack(dialect: Dialect, document: Doc, sample: string): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-pay-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const hash = await adminPasswordHash();
  await createFirstSuperAdmin(meta, { email: 'owner@crm.test', name: 'Owner', passwordHash: hash });
  // Outgoing mail set up (never delivered), so a mail is queued and can be read.
  await settingsRepo(meta).set(
    'email.smtp',
    { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Meridian <no-reply@meridian.test>', secure: false },
    { updatedBy: null },
  );
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Meridian', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
  // The business's currency, as Settings → Connections keeps it: a new quote takes it.
  await meta.db.updateTable('adminium_connections').set({ currency: 'GBP' } as never).where('id', '=', connection.id).execute();
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir, ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN, ADMINIUM_SECRET: TEST_SECRET }),
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

  const upload = async (doc: Doc, seeds: string): Promise<void> => {
    const tarball = tarballOf(doc, seeds);
    const staged = await app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: owner, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
    expect(staged.statusCode, staged.body).toBe(200);
  };
  await upload(document, sample);
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { key: 'crm', version: document.version, connectionId: connection.id, addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } } });
  expect(installed.statusCode, installed.body).toBe(200);
  await settingsRepo(meta).set('publicApi.enabled', true);
  const keyIds = ((installed.json() as { publicAccess?: { keys?: Record<string, string> } }).publicAccess?.keys ?? {}) as Record<string, string>;
  const token: Record<string, string> = {};
  for (const [name, keyId] of Object.entries(keyIds)) token[name] = openPublishableKey(dsnCryptoFromSecret(TEST_SECRET), (await publicKeysRepo(meta).findById(keyId))!.tokenEncrypted!);
  const loaded = await app.inject({ method: 'POST', url: '/api/v1/apps/crm/sample-data', headers: { cookie: owner }, payload: {} });
  expect(loaded.statusCode, loaded.body).toBe(200);
  while ((await composed.jobs.worker.runOnce()) > 0);

  // The sample's people become ordinary staff with a password, each under an address the test knows.
  const users = usersRepo(meta);
  const samplePeople = await users.list({ status: 'sample', limit: 50 });
  const id: Record<string, string> = {};
  const cookie: Record<string, string> = {};
  for (const person of document.sampleData.people) {
    const user = samplePeople.find((one) => one.name === person.name)!;
    expect(user, person.name).toBeDefined();
    await meta.db.updateTable('adminium_users').set({ status: 'active', passwordHash: hash, email: `${person.key}@crm.test` }).where('id', '=', user.id).execute();
    id[person.key] = user.id;
  }
  for (const key of ['dana', 'ivy', 'tessa', 'hugo', 'lena', 'mo']) if (id[key] !== undefined) cookie[key] = await signIn(app, `${key}@crm.test`);

  let model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const handle = await manager.data(connection.id);
  const seen = new Set<string>();
  const shelve = async (): Promise<void> => {
    await meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('kind', '=', 'email.send').where('status', '=', 'pending').execute();
  };
  return {
    app,
    meta,
    manager,
    connectionId: connection.id,
    t: (ref) => model.tables.find((table) => table.name === `crm_${ref}`)!.id,
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    id,
    cookie,
    owner,
    token,
    jobs: async () => {
      for (let round = 0; round < 20; round += 1) {
        await shelve();
        await meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).execute();
        if ((await composed.jobs.worker.runOnce()) === 0) break;
      }
      await shelve();
    },
    mails: async () => {
      await shelve();
      const rows = await meta.db.selectFrom('adminium_jobs').select(['id', 'payload', 'createdAt']).where('kind', '=', 'email.send').orderBy('createdAt', 'asc').execute();
      const out: Mail[] = [];
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string; templateKey: string };
        const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Omit<Mail, 'templateKey'>;
        out.push({ ...envelope, templateKey: payload.templateKey });
      }
      return out;
    },
    reread: async () => {
      await runIntrospection({ manager, meta, connectionId: connection.id });
      model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
    },
    upload,
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

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
/** A decimal as every engine hands it back: `7600`, `7600.00`, 7600 → `7600.00`. */
const money = (value: unknown): string | null => (value === null || value === undefined ? null : Number(value).toFixed(2));

/** A payment service that gives back what it is asked: the refund half of the contract, and nothing else. */
function service(key: string): PaymentProvider {
  let count = 0;
  const byKey = new Map<string, RefundState>();
  return {
    key,
    mode: 'live',
    async refund(input: RefundInput) {
      const known = byKey.get(input.idempotencyKey);
      if (known !== undefined) return known;
      count += 1;
      const state: RefundState = { ok: true, ref: `re_${String(count)}`, paymentRef: input.paymentRef, status: 'succeeded', amount: input.amount, currency: input.currency, failureMessage: null };
      byKey.set(input.idempotencyKey, state);
      return state;
    },
    async refundStatus() {
      return { ok: false, code: 'NOT_FOUND', providerMessage: 'No such refund.', retryable: false } as const;
    },
  } as unknown as PaymentProvider;
}

const PROVIDER = 'payments-stripe';

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a quote paid online, on ${dialect}`, () => {
    let s: Stack;
    let sources: PayableSources;
    let refs: { quotes: string };
    let item = 0;
    let deal = 0;
    let contact = 0;
    let settingsId = 0;
    let reason = 0;
    let visitors = 0;
    let n = 0;
    const url = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const who = (person: string) => (person === 'owner' ? s.owner : s.cookie[person]!);
    const get = (person: string, ref: string, rest = '') => s.app.inject({ method: 'GET', url: url(ref, rest), headers: { cookie: who(person) } });
    const post = (person: string, ref: string, values: Record<string, unknown>) => s.app.inject({ method: 'POST', url: url(ref), headers: { cookie: who(person) }, payload: { values } });
    const patch = (person: string, ref: string, key: unknown, values: Record<string, unknown>) => s.app.inject({ method: 'PATCH', url: url(ref, `/${String(key)}`), headers: { cookie: who(person) }, payload: { values } });
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBeLessThan(300);
      return Number((res.json() as { data: { id: unknown } }).data.id);
    };
    const one = async (statement: string): Promise<Record<string, unknown>> => (await s.rows(statement))[0]!;
    const quoteRow = (id: number) => one(`SELECT * FROM crm_quotes WHERE id = ${String(id)}`);
    const paymentsOf = (id: number) => s.rows(`SELECT * FROM crm_quote_payments WHERE quote_id = ${String(id)} ORDER BY id`);
    const pub = (method: 'GET' | 'POST' | 'PATCH', path: string, opts: { session?: string; payload?: Record<string, unknown> } = {}) => {
      visitors += 1;
      return s.app.inject({
        method,
        url: `/api/v1/public${path}`,
        remoteAddress: `10.78.${String(Math.floor(visitors / 250))}.${String(visitors % 250)}`,
        headers: { authorization: `Bearer ${s.token['quote']!}`, origin: ORIGIN, ...(opts.session === undefined ? {} : { 'x-adminium-public-session': opts.session }) },
        ...(opts.payload === undefined ? {} : { payload: opts.payload }),
      });
    };
    const open = async (code: string): Promise<string> => {
      const res = await pub('POST', '/claim/token', { payload: { token: code } });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { session: string } }).data.session;
    };
    const read = async (session: string): Promise<Record<string, unknown>> => {
      const res = await pub('GET', `/records/${refs.quotes}`, { session });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data?: Record<string, unknown>[] } | Record<string, unknown>[];
      return (Array.isArray(body) ? body : (body.data ?? []))[0]!;
    };
    /** A quote of Dana's at list price, with one line, sent to a contact with an address; the customer accepts it when asked. */
    const quoteOf = async (opts: { accept?: boolean; on?: number } = {}): Promise<{ id: number; code: string }> => {
      const id = made(await post('dana', 'quotes', { deal_id: opts.on ?? deal, sent_to_contact_id: contact }));
      made(await post('dana', 'quote_lines', { document_id: id, qty: 10, rate: 100, price_id: item }));
      expect(said(await patch('dana', 'quotes', id, { status: 'sent' }))).toBe('ok');
      const code = String((await quoteRow(id))['share_code']);
      if (opts.accept !== false) {
        const session = await open(code);
        const answered = await pub('PATCH', `/records/${refs.quotes}/${String(id)}`, { session, payload: { values: { status: 'accepted', accepted_name: 'Ruth Adeyemi' } } });
        expect(answered.statusCode, answered.body).toBe(200);
      }
      return { id, code };
    };
    const ref = (id: number): PayableRef => ({ kind: 'profile', connectionId: s.connectionId, tableName: s.t('quotes'), rowKey: String(id) });
    /** What the service took for a quote, live, by card; not yet written down. */
    const taken = async (id: number, amount: string, currency: string): Promise<string> => {
      n += 1;
      const attempts = paymentAttemptsRepo(s.meta);
      const attempt = (await attempts.create({ provider: PROVIDER, mode: 'live', accountId: 'acct', payable: ref(id), payableLabel: `Q-${String(id)}`, amount, currency, linkId: null, nonce: `nonce-${dialect}-${String(n)}`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(attempt.id, 'open', { providerRef: `cs_${dialect}_${String(n)}` });
      await attempts.move(attempt.id, 'succeeded', { takenAmount: amount, takenCurrency: currency, paymentRef: `pi_${dialect}_${String(n)}`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
      return attempt.id;
    };
    const record = (attemptId: string) => recordAttempt({ meta: s.meta, sources, app: s.app }, attemptId);
    const profile = async () => (await payableProfilesRepo(s.meta).list(s.connectionId)).filter((one) => one.ownerApp === 'crm');

    beforeAll(async () => {
      s = await stack(dialect, whole(), readFileSync(`${SEEDS}/meridian.json`, 'utf8'));
      sources = createPayableSources({ meta: s.meta, manager: s.manager });
      const config = await pub('GET', '/config');
      expect(config.statusCode, config.body).toBe(200);
      const names = Object.keys(((config.json() as { data?: { refs: Record<string, unknown> }; refs?: Record<string, unknown> }).data ?? (config.json() as { refs: Record<string, unknown> })).refs);
      refs = { quotes: names.find((one) => one === 'crm_quotes' || one.startsWith('crm_quotes_'))! };
      item = made(await post('ivy', 'price_list', { name: 'Stacking chair', list_rate: 100 }));
      deal = Number((await one(`SELECT id FROM crm_deals WHERE owner_id = '${s.id['dana']!}' AND state = 'open' ORDER BY id`))['id']);
      contact = Number((await one(`SELECT c.id FROM crm_contacts c JOIN crm_deals d ON d.company_id = c.company_id WHERE d.id = ${String(deal)} AND c.email IS NOT NULL ORDER BY c.id`))['id']);
      settingsId = Number((await one('SELECT id FROM crm_settings'))['id']);
      reason = Number((await one('SELECT id FROM crm_lost_reasons ORDER BY id'))['id']);
    }, 600_000);
    afterAll(async () => {
      await s?.close();
    });

    it("arrives switched off: the quote is the app's payable, until someone who manages payments switches it on", async () => {
      const profiles = await profile();
      expect(profiles.map((one) => [one.tableName, one.enabled])).toEqual([[s.t('quotes'), false]]);
      // The sample brings no payment: a fresh install reads as before.
      expect(await s.rows('SELECT id FROM crm_quote_payments')).toEqual([]);
      expect((await one('SELECT pay_ask, pay_deposit_pct FROM crm_settings'))).toMatchObject({ pay_ask: 'off' });
      expect(Number((await one('SELECT pay_deposit_pct FROM crm_settings'))['pay_deposit_pct'])).toBe(20);
    });

    it("lets the CRM admin and the sales manager say what is asked, a whole 1 to 99 %, and refuses everybody else", async () => {
      expect(said(await patch('dana', 'settings', settingsId, { pay_ask: 'deposit' }))).toMatch(/^403/);
      expect(said(await patch('hugo', 'settings', settingsId, { pay_ask: 'deposit' }))).toMatch(/^403/);
      for (const pct of [0, 100]) expect(said(await patch('tessa', 'settings', settingsId, { pay_deposit_pct: pct })), String(pct)).toMatch(/^422/);
      expect(said(await patch('ivy', 'settings', settingsId, { pay_deposit_pct: 25 }))).toBe('ok');
      expect(said(await patch('tessa', 'settings', settingsId, { pay_deposit_pct: 20 }))).toBe('ok');
    });

    it('takes what is asked when a quote is made, and works the deposit out on the server; a later change moves no quote', async () => {
      // Made while nothing is asked: it asks nothing, also once Settings asks a deposit.
      const before = await quoteOf();
      expect(said(await patch('tessa', 'settings', settingsId, { pay_ask: 'deposit' }))).toBe('ok');
      const after = await quoteOf();
      const was = await quoteRow(before.id);
      expect([was['pay_ask'], money(was['pay_amount']), money(was['pay_due']), Number(was['pay_open'])]).toEqual(['off', '0.00', '0.00', 0]);
      const now = await quoteRow(after.id);
      const total = Number(now['total']);
      expect([now['status'], now['pay_ask'], Number(now['pay_pct'])]).toEqual(['accepted', 'deposit', 20]);
      expect(money(now['pay_amount'])).toBe((Math.round(total * 20) / 100).toFixed(2));
      expect(money(now['pay_due'])).toBe(money(now['pay_amount']));
      expect(Number(now['pay_open'])).toBe(1);
      // The whole amount from now on: the quote accepted on a deposit keeps asking its deposit.
      expect(said(await patch('tessa', 'settings', settingsId, { pay_ask: 'whole' }))).toBe('ok');
      expect(money((await quoteRow(after.id))['pay_amount'])).toBe(money(now['pay_amount']));
      const whole = await quoteOf();
      expect(money((await quoteRow(whole.id))['pay_amount'])).toBe(money((await quoteRow(whole.id))['total']));
      expect(said(await patch('tessa', 'settings', settingsId, { pay_ask: 'deposit' }))).toBe('ok');
      // Nobody types what a quote asks.
      expect(said(await patch('tessa', 'quotes', after.id, { pay_amount: 1 }))).toMatch(/^4/);
    });

    it("lets the customer's link read what is asked, paid and left of its own quote, and nothing of the deal", async () => {
      const { id, code } = await quoteOf();
      const seen = await read(await open(code));
      expect(Number(seen['id'])).toBe(id);
      expect(Object.keys(seen)).toEqual(expect.arrayContaining(['pay_ask', 'pay_pct', 'pay_amount', 'pay_paid', 'pay_refunded', 'pay_due', 'pay_paid_at', 'pay_open']));
      for (const hidden of ['deal_id', 'deal_state', 'share_code']) expect(Object.keys(seen), hidden).not.toContain(hidden);
      expect([seen['pay_ask'], Number(seen['pay_open'])]).toEqual(['deposit', 1]);
      expect(money(seen['pay_due'])).toBe(money(seen['pay_amount']));
    });

    it('writes a payment once into the quote\'s payments, with its reference, service and currency, and moves neither the quote nor the deal', async () => {
      const [crm] = await profile();
      await payableProfilesRepo(s.meta).update(crm!.id, { enabled: true });
      const { id } = await quoteOf();
      const quote = await quoteRow(id);
      const dealBefore = await one(`SELECT state, stage_id FROM crm_deals WHERE id = ${String(deal)}`);
      const due = money(quote['pay_due'])!;
      const currency = String(quote['currency']);
      const attemptId = await taken(id, due, currency);
      const first = await record(attemptId);
      expect(first, JSON.stringify(first)).toMatchObject({ state: 'recorded' });
      // Asked again (a webhook and the customer's return both find it): still one row.
      await record(attemptId).catch(() => undefined);
      const rows = await paymentsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ method: 'online', payment_ref: attemptId, provider: 'Stripe', currency });
      expect(money(rows[0]!['amount'])).toBe(due);
      expect(rows[0]!['paid_at']).not.toBeNull();
      const after = await quoteRow(id);
      expect([after['status'], money(after['pay_paid']), money(after['pay_due']), after['pay_paid_at'] !== null]).toEqual(['accepted', due, '0.00', true]);
      expect(await one(`SELECT state, stage_id FROM crm_deals WHERE id = ${String(deal)}`)).toEqual(dealBefore);
    });

    it('never writes money for a quote not accepted, or accepted on a deal that was lost, into the app: a person decides', async () => {
      const sent = await quoteOf({ accept: false });
      const early = await taken(sent.id, money((await quoteRow(sent.id))['total'])!, String((await quoteRow(sent.id))['currency']));
      expect(await record(early)).toMatchObject({ state: 'record_refused', problem: { code: 'NOT_NOW' } });
      expect(await paymentsOf(sent.id)).toEqual([]);

      // A deal of Dana's of its own, lost after its quote was accepted: its quote reads as before, and takes no money.
      const lost = made(await post('dana', 'deals', { name: 'Reception desks', company_id: Number((await one(`SELECT company_id FROM crm_deals WHERE id = ${String(deal)}`))['company_id']), owner_id: s.id['dana'], stage_id: Number((await one(`SELECT stage_id FROM crm_deals WHERE id = ${String(deal)}`))['stage_id']) }));
      const accepted = await quoteOf({ on: lost });
      expect(Number((await quoteRow(accepted.id))['pay_open'])).toBe(1);
      expect(said(await patch('dana', 'deals', lost, { state: 'lost', lost_reason_id: reason }))).toBe('ok');
      const row = await quoteRow(accepted.id);
      expect([row['status'], row['deal_state'], Number(row['pay_open'])]).toEqual(['accepted', 'lost', 0]);
      const late = await taken(accepted.id, money(row['pay_due'])!, String(row['currency']));
      expect(await record(late)).toMatchObject({ state: 'record_refused', problem: { code: 'NOT_NOW' } });
      expect(await paymentsOf(accepted.id)).toEqual([]);
    });

    it('writes what stands refunded, and a refunded deposit is due again', async () => {
      const { id } = await quoteOf();
      const quote = await quoteRow(id);
      const due = money(quote['pay_due'])!;
      const attemptId = await taken(id, due, String(quote['currency']));
      expect(await record(attemptId)).toMatchObject({ state: 'recorded' });
      expect(money((await quoteRow(id))['pay_due'])).toBe('0.00');
      const deps = { meta: s.meta, sources, providerFor: async () => ({ ok: true as const, key: PROVIDER, mode: 'live' as const, provider: service(PROVIDER), redirectHosts: [] }) };
      const refunded = await requestRefund(deps as never, { attemptId, amount: due, reason: 'requested_by_customer', note: null, key: `rk-${dialect}-quote-refund-0001`, requestedBy: null });
      expect(refunded).toMatchObject({ ok: true, refund: { state: 'succeeded' } });
      const [row] = await paymentsOf(id);
      expect(money(row!['refunded'])).toBe(due);
      const after = await quoteRow(id);
      expect([after['status'], money(after['pay_paid']), money(after['pay_refunded']), money(after['pay_due']), Number(after['pay_open'])]).toEqual(['accepted', '0.00', due, due, 1]);
    });

    it('lets every role that reads quotes read their payments, nobody write one, and the CRM admin and the sales manager refund', async () => {
      const rows = await s.rows('SELECT id, quote_id FROM crm_quote_payments ORDER BY id');
      expect(rows.length).toBeGreaterThan(0);
      for (const person of ['dana', 'ivy', 'tessa']) {
        const res = await get(person, 'quote_payments');
        expect(res.statusCode, `${person}: ${res.body}`).toBe(200);
        expect(((res.json() as { data: unknown[] }).data ?? []).length, person).toBe(rows.length);
      }
      if (s.cookie['lena'] !== undefined) expect(said(await get('lena', 'quote_payments')), 'the marketer').toMatch(/^403/);
      // The app's roles write none: no right on the table at all.
      for (const person of ['dana', 'ivy', 'tessa']) {
        expect(said(await post(person, 'quote_payments', { quote_id: Number(rows[0]!['quote_id']), amount: 1 })), person).toMatch(/^403/);
        expect(said(await patch(person, 'quote_payments', rows[0]!['id'], { amount: 1 })), person).toMatch(/^403/);
      }
      // The install's owner holds every right, and still never writes or changes what a payment taken online says.
      expect(said(await post('owner', 'quote_payments', { quote_id: Number(rows[0]!['quote_id']), amount: 1, payment_ref: 'pi_forged', provider: 'Stripe' }))).toMatch(/^403/);
      expect(said(await patch('owner', 'quote_payments', rows[0]!['id'], { amount: 1 }))).toMatch(/^403/);
      expect(said(await patch('owner', 'quote_payments', rows[0]!['id'], { refunded: 0 }))).toMatch(/^403/);
      const refundsOf = async (person: string): Promise<boolean> => {
        const res = await s.app.inject({ method: 'GET', url: '/apps/crm/staff/surface-config.json', headers: { cookie: who(person) } });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { payments?: { refund: boolean } }).payments?.refund === true;
      };
      expect({ dana: await refundsOf('dana'), ivy: await refundsOf('ivy'), tessa: await refundsOf('tessa') }).toEqual({ dana: false, ivy: true, tessa: true });
    });

    it('sends the "quote accepted" e-mail as before while nothing can be paid online', async () => {
      // Adminium mails no `.example` address, as the sample's are: a contact of the deal's company with a real-looking one.
      const company = Number((await one(`SELECT company_id FROM crm_deals WHERE id = ${String(deal)}`))['company_id']);
      const mailed = made(await post('dana', 'contacts', { company_id: company, name: 'Ruth Adeyemi', email: 'ruth.adeyemi@brightloom-foods.co.uk' }));
      await s.jobs();
      await s.mails();
      const was = contact;
      contact = mailed;
      await quoteOf();
      contact = was;
      await s.jobs();
      const mails = (await s.mails()).filter((mail) => mail.templateKey === 'crm-quote-accepted');
      expect(mails.map((mail) => mail.to)).toEqual(['ruth.adeyemi@brightloom-foods.co.uk']);
      // No service is live here, so nothing can be paid online: none of the pay blocks, no pay link, no empty button.
      expect(mails[0]!.text).not.toMatch(/To pay now|online|\{\{/);
      expect(mails[0]!.html).not.toMatch(/\/pay\//);
      expect(mails[0]!.text).toMatch(/has been marked as accepted/);
    });
  });

  describe.skipIf(!reachable)(`the released 0.2.5 updated, on ${dialect}`, () => {
    let s: Stack;
    let rowsBefore: Map<string, string[]>;
    let quotesBefore: Record<string, unknown>[];
    const was = released();
    const now = whole();
    /** Every row of every table of the app, each as text: what an update must keep. */
    const everyRow = async (): Promise<Map<string, string[]>> => {
      const out = new Map<string, string[]>();
      for (const table of was.manifest.requiredSchema.tables) {
        const columns = table.columns.map((column) => column.ref).filter((ref) => ref !== 'retry_key');
        const rows = await s.rows(`SELECT ${columns.map((column) => `"${column}"`).join(', ')} FROM crm_${table.ref} ORDER BY id`.replace(/"/g, dialect === 'mysql' ? '`' : '"'));
        out.set(table.ref, rows.map((row) => JSON.stringify(columns.map((column) => (row[column] instanceof Date ? (row[column] as Date).toISOString() : row[column])))));
      }
      return out;
    };

    beforeAll(async () => {
      expect(was.manifest.version).toBe('0.2.5');
      s = await stack(dialect, was.manifest, was.sample);
      // A quote accepted before the update, typed as the people who type them.
      const post = (person: string, ref: string, values: Record<string, unknown>) => s.app.inject({ method: 'POST', url: `/api/v1/data/${s.connectionId}/${s.t(ref)}`, headers: { cookie: s.cookie[person]! }, payload: { values } });
      const deal = Number((await s.rows(`SELECT id FROM crm_deals WHERE owner_id = '${s.id['dana']!}' AND state = 'open' ORDER BY id`))[0]!['id']);
      const contact = Number((await s.rows(`SELECT c.id FROM crm_contacts c JOIN crm_deals d ON d.company_id = c.company_id WHERE d.id = ${String(deal)} AND c.email IS NOT NULL ORDER BY c.id`))[0]!['id']);
      const item = Number(((await post('ivy', 'price_list', { name: 'Stacking chair', list_rate: 100 })).json() as { data: { id: number } }).data.id);
      const quote = Number(((await post('dana', 'quotes', { deal_id: deal, sent_to_contact_id: contact })).json() as { data: { id: number } }).data.id);
      await post('dana', 'quote_lines', { document_id: quote, qty: 3, rate: 100, price_id: item });
      for (const status of ['sent', 'accepted']) {
        const moved = await s.app.inject({ method: 'PATCH', url: `/api/v1/data/${s.connectionId}/${s.t('quotes')}/${String(quote)}`, headers: { cookie: s.cookie['dana']! }, payload: { values: { status } } });
        expect(moved.statusCode, moved.body).toBe(200);
      }
      await s.jobs();
      rowsBefore = await everyRow();
      quotesBefore = await s.rows('SELECT id, status FROM crm_quotes ORDER BY id');
    }, 600_000);
    afterAll(async () => {
      await s?.close();
    });

    it('asks to show the customer more of a quote and to let two roles refund, and goes when the owner allows both', async () => {
      await s.upload(now, readFileSync(`${SEEDS}/meridian.json`, 'utf8'));
      // Each refusal names what it asks, before anything moves; the owner allows each in turn.
      // The customer's link is given what this version adds to it (`publicAccess`), as an owner does on the update's page.
      const allowed: Record<string, boolean> = { publicAccess: true };
      const refusals: string[] = [];
      let updated: Reply | null = null;
      for (let round = 0; round < 4 && updated === null; round += 1) {
        const tried = await s.app.inject({ method: 'POST', url: '/api/v1/apps/crm/update', headers: { cookie: s.owner }, payload: allowed });
        if (tried.statusCode === 200) {
          updated = tried;
          break;
        }
        expect(tried.statusCode, tried.body).toBe(422);
        const error = (tried.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
        const why = String(error.details?.['reason'] ?? error.code);
        refusals.push(why === 'ROLE_GRANTS_ADDED' ? `${why} ${JSON.stringify(error.details?.['refundGrants'] ?? [])}` : why);
        expect(await everyRow()).toEqual(rowsBefore);
        if (why === 'PUBLIC_WIDER') allowed['publicWider'] = true;
        else if (why === 'ROLE_GRANTS_ADDED') allowed['roleGrants'] = true;
        else allowed['roleTables'] = true;
      }
      // The customer's link shows what is asked and paid of their own quote; the CRM admin and the sales manager may refund.
      expect(refusals.map((one) => one.split(' ')[0]).sort()).toEqual(['PUBLIC_WIDER', 'ROLE_GRANTS_ADDED']);
      expect(refusals.find((one) => one.startsWith('ROLE_GRANTS_ADDED'))).toMatch(/admin/);
      expect(updated?.statusCode, updated?.body).toBe(200);
      await s.reread();
      const installed = (await s.meta.db.selectFrom('adminium_manifests').select(['version']).where('manifestKey', '=', 'crm').executeTakeFirst()) as { version: string } | undefined;
      expect(installed?.version).toBe(now.version);
    }, 900_000);

    it('keeps every row of every table, each column as it was, and makes the payments table empty', async () => {
      expect(await everyRow()).toEqual(rowsBefore);
      expect(await s.rows('SELECT id FROM crm_quote_payments')).toEqual([]);
    });

    it('asks nothing of a quote there before, and the payable arrives switched off', async () => {
      const quotes = await s.rows('SELECT id, status, pay_ask, pay_amount, pay_paid, pay_due, pay_open FROM crm_quotes ORDER BY id');
      expect(quotes.map((row) => [Number(row['id']), row['status']])).toEqual(quotesBefore.map((row) => [Number(row['id']), row['status']]));
      for (const row of quotes) {
        expect([row['pay_ask'] ?? null, money(row['pay_amount'] ?? 0), money(row['pay_due'] ?? 0), Number(row['pay_open'] ?? 0)], String(row['id'])).toEqual([null, '0.00', '0.00', 0]);
      }
      expect(await s.rows('SELECT pay_ask, pay_deposit_pct FROM crm_settings')).toEqual([expect.objectContaining({ pay_ask: 'off' })]);
      const profiles = (await payableProfilesRepo(s.meta).list(s.connectionId)).filter((one) => one.ownerApp === 'crm');
      expect(profiles.map((one) => [one.tableName, one.enabled])).toEqual([[s.t('quotes'), false]]);
    });

    it("lets the customer's link read what is asked of the quote it opens, once allowed", async () => {
      const visitor = { authorization: `Bearer ${s.token['quote']!}`, origin: ORIGIN };
      const config = await s.app.inject({ method: 'GET', url: '/api/v1/public/config', headers: visitor });
      const names = Object.keys(((config.json() as { data?: { refs: Record<string, unknown> }; refs?: Record<string, unknown> }).data ?? (config.json() as { refs: Record<string, unknown> })).refs);
      const quotes = names.find((one) => one === 'crm_quotes' || one.startsWith('crm_quotes_'))!;
      const code = String((await s.rows("SELECT share_code FROM crm_quotes WHERE status = 'accepted' ORDER BY id"))[0]!['share_code']);
      const opened = await s.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', remoteAddress: '10.79.0.1', headers: visitor, payload: { token: code } });
      expect(opened.statusCode, opened.body).toBe(200);
      const session = (opened.json() as { data: { session: string } }).data.session;
      const read = await s.app.inject({ method: 'GET', url: `/api/v1/public/records/${quotes}`, remoteAddress: '10.79.0.2', headers: { ...visitor, 'x-adminium-public-session': session } });
      expect(read.statusCode, read.body).toBe(200);
      const body = read.json() as { data?: Record<string, unknown>[] } | Record<string, unknown>[];
      const row = (Array.isArray(body) ? body : (body.data ?? []))[0]!;
      expect(Object.keys(row)).toEqual(expect.arrayContaining(['pay_ask', 'pay_amount', 'pay_due', 'pay_open']));
    });

    it('asks nothing more of the next update of the same app', async () => {
      await s.upload({ ...now, version: now.version.replace(/\d+$/, (patch) => String(Number(patch) + 1)) }, readFileSync(`${SEEDS}/meridian.json`, 'utf8'));
      const again = await s.app.inject({ method: 'POST', url: '/api/v1/apps/crm/update', headers: { cookie: s.owner }, payload: {} });
      expect(again.statusCode, again.body).toBe(200);
    }, 900_000);
  });
}
