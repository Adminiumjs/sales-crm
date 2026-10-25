/**
 * Plan 67, P16: SUPPLY ON THE INVENTORY ADD-ON, against a real install of the
 * released stage 1 with Invoices and Inventory as they are built, on SQLite,
 * Postgres and MySQL.
 *
 *  1. The three roles Supply is for (CRM admin, operations manager, Read-only)
 *     are given six of Inventory's tables, READ ONLY, each held to a few
 *     columns (nothing of what goods cost); no other role of the app is given
 *     any of Inventory's tables.
 *  2. A deal's need of a stock line carries the deal's state (a copy the
 *     server keeps), so "what open deals ask for" is a figure the server can
 *     hold to open deals for every reader, the operations manager included,
 *     who reads no deal. The rep and the operations manager may no longer
 *     write that copy.
 *  3. Inventory switched off for the app: the grants are taken back, and
 *     Supply is off (waiting); switched on again, both come back.
 *  4. Installed without Inventory: Supply is off and waits for the add-on
 *     (its own table is made all the same: it is built on no shape of the
 *     add-on's), and the grants are written nowhere.
 *  5. The supplier scorecard (plan 68 S12), on the whole server with the
 *     whole app and its sample, SIGNED IN as each role Supply is for and as a
 *     rep: Inventory's receipts read through the grant, six columns; each
 *     supplier's deliveries of the last 90 days by its orders, the late ones
 *     and how late, its claims of the year, and so the ledger's score and
 *     band; a delivery 91 days old, one not posted and one that cannot say
 *     whether it was late are not counted, one 89 days old is; the rep is
 *     refused every door.
 *
 * What these roles are then ANSWERED by the data routes, the figures and the
 * live stream (and the refusals of a rep and the sales manager) is shown on
 * the browser stand, which is this same server with its routes: `e2e/supply.e2e.ts`.
 *
 * To run: `ADD_ONS_REPO=… npm run proofs -- supply`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { parseDatabaseModel } from '@adminium/engine';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { builtAddOn, writing, type Installed } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

// The server says the version it was built at; the app's floor is the release to come.
vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.3.36' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const inventory = builtAddOn('inventory');
const invoices = builtAddOn('invoices');
const n = (value: unknown): number => Number(value);

interface Stage {
  manifest: Record<string, unknown> & { version: string; roles: { key: string; limits?: Record<string, { writable?: string[] }> }[] };
  files: Record<string, string | Buffer>;
}

/** A stage's package as the harness takes it: text files only, each picture's bytes stood in for. */
function packed(stage: Stage): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(stage.files)) {
    if (path === 'manifest.json') continue;
    files[path] = typeof content === 'string' ? content : 'png';
  }
  const sample = JSON.parse(files['seeds/meridian.json']!) as { assets?: Record<string, { sha256: string }> };
  for (const asset of Object.values(sample.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
  files['seeds/meridian.json'] = JSON.stringify(sample);
  return files;
}

/** What Supply's three roles read of each of Inventory's tables, and nothing more. */
const READ: Record<string, string[]> = {
  inventory_items: ['id', 'name', 'sku', 'note', 'unit', 'active', 'on_hand'],
  inventory_suppliers: ['id', 'name', 'lead_days', 'active'],
  inventory_item_suppliers: ['id', 'item_id', 'supplier_id', 'rank', 'supplier_name'],
  inventory_stock_points: ['id', 'item_id', 'place_id', 'on_hand', 'available', 'on_order', 'reorder_level', 'low', 'item_active'],
  inventory_purchase_orders: ['id', 'number', 'supplier_id', 'supplier_name', 'status', 'sent_on', 'expected_on', 'lead_days', 'received_at'],
  inventory_po_lines: ['id', 'po_id', 'item_id', 'item_name', 'qty', 'open_qty', 'order_status'],
  // The scorecard (plan 68 S12): whose order a delivery was on, posted or not, the day it came, whether and how late.
  inventory_receipts: ['id', 'po_id', 'status', 'received_on', 'late', 'days_late'],
};
const SUPPLY_ROLES = ['admin', 'ops-manager', 'read-only'];
const OTHER_ROLES = ['sales-manager', 'rep', 'account-manager', 'marketer', 'front-desk'];

describe.skipIf(inventory !== null && invoices !== null)('Supply on Inventory', () => {
  it('needs the add-ons built: set ADMINIUM_ADD_ONS_REPO', () => {
    throw new Error('ADMINIUM_ADD_ONS_REPO names no checkout with Invoices and Inventory built');
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable || inventory === null || invoices === null)(`Supply on the Inventory add-on, on ${dialect}`, () => {
    let h: Harness;
    let one: Stage;
    /** What a role of the app holds of Inventory's tables, by table: its actions and their limits. */
    const held = async (role: string): Promise<Record<string, Record<string, unknown>>> => {
      const found = await rolesRepo(h.meta).findBySlug(`crm-${role}`);
      expect(found, role).not.toBeNull();
      const out: Record<string, Record<string, unknown>> = {};
      for (const row of await permissionsRepo(h.meta).listForRole(found!.id)) {
        if (row.resourceKind !== 'table') continue;
        const table = row.resourceRef.slice(row.resourceRef.indexOf('/') + 1).split('.').pop()!;
        if (!table.startsWith('inventory_')) continue;
        out[table] = Object.fromEntries(Object.entries(row.actions as Record<string, unknown>).filter(([, value]) => value !== false));
      }
      return out;
    };
    const supplyOn = async (): Promise<boolean> => ((await h.inject({ method: 'GET', url: '/apps/crm/parts' })).json() as { parts: { id: string; on: boolean }[] }).parts.find((part) => part.id === 'supply')!.on;

    beforeAll(async () => {
      const script = (await import(pathToFileURL(`${APP}/scripts/stage-manifest.mjs`).href)) as { stageFiles: (stage: number) => Stage };
      one = script.stageFiles(1);
      h = await addOnHarness(dialect, {});
      await h.stageAddOn(invoices!.manifest, { bundled: true, files: invoices!.files });
      await h.stageAddOn(inventory!.manifest, { bundled: true, files: inventory!.files });
      await h.stageApp(one.manifest, packed(one));
      const installed = await h.install('crm', one.manifest.version, { addOns: [{ key: 'invoices', version: invoices!.version }, { key: 'inventory', version: inventory!.version }], modules: { quotes: true, inbox: true, supply: true } });
      expect(installed.statusCode, installed.body).toBe(200);
      // The sample, Inventory's part of it made by Inventory's own saves.
      const inv = (ref: string) => `inventory_${ref}`;
      const as: Installed = { h, addOn: inventory!, reply: installed.json() as Record<string, unknown>, real: inv, rowsOf: (ref, where) => h.rows(`select * from ${inv(ref)}${where === undefined ? '' : ` where ${where}`}`), hosts: [] };
      const w = await writing(as);
      await createSampleDataService({ ...h.sampleData, writes: () => w.writes }).add((await findSampleApp(h.meta, 'crm'))!, { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' });
    }, 600_000);
    afterAll(async () => {
      await h?.close();
    });

    it('gives the three roles Supply is for seven of Inventory\'s tables, read only and a few columns each, and nobody else any', async () => {
      const expected = Object.fromEntries(Object.entries(READ).map(([table, readable]) => [table, { read: true, readLimit: { readable } }]));
      for (const role of SUPPLY_ROLES) expect(await held(role), role).toEqual(expected);
      for (const role of OTHER_ROLES) expect(await held(role), role).toEqual({});
      // Of what a line costs, nothing: its average cost and its value are left out of every grant.
      expect(Object.values(READ).flat()).not.toContain('cost_avg');
      expect(Object.values(READ).flat()).not.toContain('price');
      expect(await supplyOn()).toBe(true);
    });

    it('keeps a need\'s deal state with the deal, and keeps it out of the rep\'s and the operations manager\'s writes', async () => {
      const needs = await h.rows('select d.deal_state as s, x.state as t from crm_deal_stock_needs d join crm_deals x on x.id = d.deal_id');
      // Sixteen of open deals, and J-07's won deal's cable trays for its return visit (plan 68 M3 BN-20).
      expect(needs).toHaveLength(17);
      expect(needs.every((row) => row['s'] === row['t'])).toBe(true);
      expect(needs.filter((row) => row['s'] !== 'open').map((row) => row['s'])).toEqual(['won']);
      // The ledger's "short today", now held to open deals by the server's own column.
      const short = await h.rows(
        "select i.name, sum(d.qty) as need, max(i.on_hand) as have from crm_deal_stock_needs d join inventory_items i on i.id = d.item where d.qty is not null and d.deal_state = 'open' group by i.name having sum(d.qty) > max(i.on_hand) order by i.name",
      );
      expect(short.map((row) => `${String(row['name'])} ${String(n(row['need']))}/${String(n(row['have']))}`)).toEqual(['Acoustic booths, single 10/4', 'Acoustic rooms, four-person 2/0', 'Task seating, mesh back 68/60']);
      for (const role of ['rep', 'ops-manager']) expect(one.manifest.roles.find((r) => r.key === role)!.limits!['deal_stock_needs']!.writable, role).toEqual(['deal_id', 'item', 'qty']);
    });

    it('takes the grants back while Inventory is switched off for the app, with Supply off; gives both back when it is on', async () => {
      const off = await h.inject({ method: 'PATCH', url: '/add-ons/inventory', payload: { attachedTo: 'crm', enabled: false } });
      expect(off.statusCode, off.body).toBe(200);
      for (const role of SUPPLY_ROLES) expect(await held(role), role).toEqual({});
      expect(await supplyOn()).toBe(false);
      const parts = (await h.inject({ method: 'GET', url: '/apps/crm/parts' })).json() as { parts: { id: string; waiting: { key: string }[] }[] };
      expect(parts.parts.find((part) => part.id === 'supply')!.waiting.map((one) => one.key)).toEqual(['inventory']);
      const on = await h.inject({ method: 'PATCH', url: '/add-ons/inventory', payload: { attachedTo: 'crm', enabled: true } });
      expect(on.statusCode, on.body).toBe(200);
      for (const role of SUPPLY_ROLES) expect(Object.keys(await held(role)).sort(), role).toEqual(Object.keys(READ).sort());
      expect(await supplyOn()).toBe(true);
    });
  });

  describe.skipIf(!reachable || invoices === null)(`Supply waiting for Inventory, installed without it, on ${dialect}`, () => {
    let h: Harness;
    afterAll(async () => {
      await h?.close();
    });

    it('keeps Supply off and waiting for the add-on, with no grant on Inventory; its own table is made, its link to a stock line inert', async () => {
      const script = (await import(pathToFileURL(`${APP}/scripts/stage-manifest.mjs`).href)) as { stageFiles: (stage: number) => Stage };
      const one = script.stageFiles(1);
      h = await addOnHarness(dialect, {});
      await h.stageAddOn(invoices!.manifest, { bundled: true, files: invoices!.files });
      await h.stageApp(one.manifest, packed(one));
      const installed = await h.install('crm', one.manifest.version, { addOns: [{ key: 'invoices', version: invoices!.version }], modules: { quotes: true, inbox: true, supply: true } });
      expect(installed.statusCode, installed.body).toBe(200);
      // The part is no shape of the add-on's: its one table is made (a need's stock line is a plain number, no foreign key).
      expect(await h.tableNames()).toContain('crm_deal_stock_needs');
      expect(await h.tableNames()).not.toContain('inventory_items');
      const parts = (await h.inject({ method: 'GET', url: '/apps/crm/parts' })).json() as { parts: { id: string; on: boolean; waiting: { key: string }[] }[] };
      const supply = parts.parts.find((part) => part.id === 'supply')!;
      expect([supply.on, supply.waiting.map((one) => one.key)]).toEqual([false, ['inventory']]);
      for (const role of SUPPLY_ROLES) {
        const found = await rolesRepo(h.meta).findBySlug(`crm-${role}`);
        const rows = found === null ? [] : await permissionsRepo(h.meta).listForRole(found.id);
        expect(rows.filter((row) => row.resourceRef.includes('inventory_')), role).toEqual([]);
      }
    }, 600_000);
  });
}

/* ─── 5. The supplier scorecard, signed in as each role (plan 68 S12) ─────────────────────────────────────────────── */

const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const PEOPLE = (JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as { sampleData: { people: { key: string; name: string }[] } }).sampleData.people;

async function sourceDatabase(dialect: string, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `crm_score_${randomBytes(4).toString('hex')}`;
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

/** An add-on's built package, as `npm pack` would hand it over: its manifest, its package file and the files it names. */
function addOnTarball(addOn: NonNullable<typeof inventory>): Uint8Array {
  return packageTarball({
    'manifest.json': JSON.stringify(addOn.manifest),
    'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${addOn.key}`, version: addOn.version }),
    'dist/client.js': 'export const register = () => {};',
    ...addOn.files,
  });
}

/** The ledger's screen 60: deliveries of the last 90 days, late ones, claims, weeks over, score, band. */
const LEDGER: Record<string, [number, number, number, number, number, string]> = {
  'Marchmont Joinery': [3, 0, 0, 0, 100, 'Solid'],
  'Halvard Werke': [9, 1, 0, 0, 89, 'Solid'],
  'Kirkwall Steel': [6, 1, 1, 0, 77, 'Watch them'],
  'Trellis Textiles': [9, 1, 1, 1, 76, 'Watch them'],
  'Ostrom Seating': [5, 1, 2, 1, 61, 'A problem'],
  'Fenlow Acoustics': [7, 4, 1, 3, 16, 'A problem'],
};
/** The ledger's arithmetic (`sample.py`): on time to a tenth, half up; less 6 a claim and 7 a week over; held to 0…100, half up. */
function ledgerScore(n: number, late: number, claims: number, weeks: number): [number, string] {
  const on = Math.floor((2000 * (n - late) + n) / (2 * n));
  const score = Math.floor((Math.max(0, Math.min(1000, on - 60 * claims - 70 * weeks)) + 5) / 10);
  return [score, score >= 88 ? 'Solid' : score >= 75 ? 'Watch them' : 'A problem'];
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable || inventory === null || invoices === null)(`the supplier scorecard, signed in as each role, on ${dialect}`, () => {
    let app: AdminiumServer;
    let close: () => Promise<void>;
    let connectionId = '';
    let rows: (statement: string) => Promise<Record<string, unknown>[]>;
    let tableId: (name: string) => string;
    const cookie: Record<string, string> = {};
    let signIns = 0;
    const signIn = async (email: string): Promise<string> => {
      signIns += 1;
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.21.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
      expect(res.statusCode, res.body).toBe(200);
      return sessionCookie(res.headers['set-cookie']);
    };
    /** A figure, asked as this person. */
    const figure = (who: string, descriptor: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie: cookie[who]! }, payload: { descriptor: { connectionId, ...descriptor } } });
    const SAYS = [{ column: 'status', op: 'eq', value: 'posted' }, { column: 'late', op: 'not_null' }];
    const WINDOW = { column: 'received_on', op: 'gte', day: 'today-89' };
    /** A supplier's deliveries of the window, the late ones, and their average days late: as the screen asks it. */
    const lateness = async (who: string, supplier: number | null): Promise<{ n: number; late: number; avg: number | null }> => {
      const res = await figure(who, { source: { name: 'inventory_receipts' }, shape: 'categorical', filters: [...SAYS, WINDOW, ...(supplier === null ? [] : [{ column: 'po_id.supplier_id', op: 'eq', value: supplier }])], groupBy: ['late'], aggregations: [{ fn: 'count', alias: 'n' }, { fn: 'avg', column: 'days_late', alias: 'd' }], limit: 5 });
      expect(res.statusCode, `${who}: ${res.body}`).toBe(200);
      const items = (res.json() as { result: { items: { key: unknown; values: { n: unknown; d: unknown } }[] } }).result.items;
      const lateOne = items.find((item) => Number(item.key) === 1);
      return { n: items.reduce((sum, item) => sum + n(item.values.n), 0), late: lateOne === undefined ? 0 : n(lateOne.values.n), avg: lateOne === undefined ? null : n(lateOne.values.d) };
    };
    const claimsOf = async (who: string, supplier: { id: number; name: string }): Promise<number> => {
      const res = await figure(who, { source: { name: 'crm_warranty_claims' }, shape: 'single-metric', filters: [{ column: 'raised_on', op: 'gte', day: 'today-364' }, { or: [{ column: 'supplier', op: 'eq', value: supplier.id }, { column: 'supplier_name', op: 'eq', value: supplier.name }] }], aggregations: [{ fn: 'count', alias: 'n' }] });
      expect(res.statusCode, `${who}: ${res.body}`).toBe(200);
      return n((res.json() as { result: { value: unknown } }).result.value);
    };
    /** A day on the server's calendar, as `YYYY-MM-DD`, some days back. */
    const daysBack = (days: number): string => {
      const at = new Date(Date.now() - days * 86_400_000);
      return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    };
    let suppliers: { id: number; name: string }[] = [];

    beforeAll(async () => {
      process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'invoices,inventory';
      const dataDir = await mkdtemp(join(tmpdir(), 'crm-score-'));
      const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
      await firstRun(meta);
      const hash = await adminPasswordHash();
      await createFirstSuperAdmin(meta, { email: 'owner@crm.test', name: 'Owner', passwordHash: hash });
      const registry = new AdapterRegistry<AdapterProvider>();
      await registerAdapters(registry);
      const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
      const source = await sourceDatabase(dialect, dataDir);
      const connection = await manager.connections.create({ name: 'Meridian', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
      connectionId = connection.id;
      await runIntrospection({ manager, meta, connectionId });
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
      app = composed.app;
      await app.ready();
      await composed.jobs.worker.stop();
      composed.jobs.scheduler.stop();
      cookie['owner'] = await signIn('owner@crm.test');
      const upload = async (url: string, bytes: Uint8Array) => {
        const res = await app.inject({ method: 'POST', url: `${url}?expectedSha512=${encodeURIComponent(sha512Integrity(bytes))}`, headers: { cookie: cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(bytes) });
        expect(res.statusCode, res.body).toBeLessThan(300);
      };
      // The two add-ons as they are built, staged as a person uploads them (their deciding code trusted for the test).
      await upload('/api/v1/add-ons/upload', addOnTarball(invoices!));
      await upload('/api/v1/add-ons/upload', addOnTarball(inventory!));
      // The whole app, with both files of its sample.
      const document = JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
      const packed = JSON.parse(readFileSync(`${APP}/whole/seeds/meridian.json`, 'utf8')) as { assets?: Record<string, { sha256: string }> };
      for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
      await upload('/api/v1/apps/upload', packageTarball({ 'manifest.json': JSON.stringify(document), 'staff/index.html': '<!doctype html><html><body></body></html>', 'seeds/meridian.json': JSON.stringify(packed), 'seeds/meridian.inventory.json': readFileSync(`${APP}/whole/seeds/meridian.inventory.json`, 'utf8') }));
      const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: cookie['owner']! }, payload: { key: 'crm', version: document['version'], connectionId, addOns: [{ key: 'invoices', version: invoices!.version }, { key: 'inventory', version: inventory!.version }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } } });
      expect(installed.statusCode, installed.body).toBe(200);
      const sample = await app.inject({ method: 'POST', url: '/api/v1/apps/crm/sample-data', headers: { cookie: cookie['owner']! }, payload: {} });
      expect(sample.statusCode, sample.body).toBe(200);
      while ((await composed.jobs.worker.runOnce()) > 0);
      const loaded = (await app.inject({ method: 'GET', url: '/api/v1/apps/crm/sample-data', headers: { cookie: cookie['owner']! } })).json() as { loaded?: boolean };
      expect(loaded.loaded, JSON.stringify(loaded).slice(0, 800)).toBe(true);
      // The sample's people become ordinary staff with a password.
      const users = usersRepo(meta);
      const samplePeople = await users.list({ status: 'sample', limit: 50 });
      for (const key of ['tessa', 'ada', 'grace', 'dana', 'ivy']) {
        const user = samplePeople.find((one) => one.name === PEOPLE.find((person) => person.key === key)!.name)!;
        await meta.db.updateTable('adminium_users').set({ status: 'active', passwordHash: hash, email: `${key}@crm.test` }).where('id', '=', user.id).execute();
        cookie[key] = await signIn(`${key}@crm.test`);
      }
      const model = parseDatabaseModel((await snapshotsRepo(meta).latest(connectionId))!.schema);
      tableId = (name) => model.tables.find((table) => table.name === name)!.id;
      const handle = await manager.data(connectionId);
      rows = async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows;
      suppliers = (await rows('select id, name from inventory_suppliers order by id')).map((row) => ({ id: n(row['id']), name: String(row['name']) }));
      close = async () => {
        await app.close();
        await manager.disposeAll().catch(() => undefined);
        await source.drop();
        await meta.db.destroy();
        await rm(dataDir, { recursive: true, force: true });
      };
    }, 900_000);
    afterAll(async () => {
      await close?.();
    });

    it('the sample\'s deliveries carry their lateness, worked out by the server from their orders: 45, of which 39 in the last 90 days', async () => {
      const all = await rows("select count(*) as c, sum(case when late is not null then 1 else 0 end) as said, sum(case when expected_on is null then 1 else 0 end) as blank from inventory_receipts where kind = 'delivery' and status = 'posted'");
      expect([n(all[0]!['c']), n(all[0]!['said']), n(all[0]!['blank'])]).toEqual([45, 45, 0]);
      // The opening receipt was never ordered: it says nothing.
      expect(n((await rows("select count(*) as c from inventory_receipts where kind = 'opening' and late is null"))[0]!['c'])).toBe(1);
    });

    for (const who of ['tessa', 'ada', 'grace']) {
      it(`${who} is answered each supplier's deliveries, late ones and claims, and so the ledger's scores and bands`, async () => {
        const whole = await lateness(who, null);
        expect([whole.n, whole.late]).toEqual([39, 8]);
        const got: Record<string, [number, number, number, number, number, string]> = {};
        for (const supplier of suppliers) {
          const one = await lateness(who, supplier.id);
          const claims = await claimsOf(who, supplier);
          const weeks = one.avg === null ? 0 : Math.floor(one.avg / 7 + 0.5);
          got[supplier.name] = [one.n, one.late, claims, weeks, ...ledgerScore(one.n, one.late, claims, weeks)];
        }
        expect(got).toEqual(LEDGER);
      });
    }

    it('counts a delivery of 89 days back, and none of 91 days back, none not posted, none that cannot say whether it was late', async () => {
      const fenlow = suppliers.find((one) => one.name === 'Fenlow Acoustics')!;
      const order = n((await rows(`select id from inventory_purchase_orders where supplier_id = ${String(fenlow.id)} and status = 'draft' order by id limit 1`))[0]!['id']);
      const place = n((await rows("select place_id from inventory_receipts where kind = 'opening'"))[0]!['place_id']);
      const before = await lateness('ada', fenlow.id);
      const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
      const columns = ['po_id', 'supplier_id', 'place_id', 'kind', 'status', 'received_on', 'late', 'days_late', 'total', 'units', 'lines', 'unposted', 'unreversed', 'lines_to_check'].map(q).join(', ');
      // Written straight into the database, as no person can: the figures' cache is told, as a write through the routes tells it.
      const cache = (app as unknown as { widgetDataCache: { invalidateTable: (connection: string, table: string) => void } }).widgetDataCache;
      const put = async (status: string, day: string, late: number | null, days: number | null) => {
        await rows(`insert into inventory_receipts (${columns}) values (${String(order)}, ${String(fenlow.id)}, ${String(place)}, 'delivery', '${status}', '${day}', ${late === null ? 'null' : String(late)}, ${days === null ? 'null' : String(days)}, 0, 0, 0, 0, 0, 0)`);
        cache.invalidateTable(connectionId, tableId('inventory_receipts'));
      };
      await put('posted', daysBack(91), 1, 30);
      await put('reversed', daysBack(10), 1, 30);
      await put('draft', daysBack(10), 1, 30);
      // Posted before Inventory kept the day it was due: no lateness.
      await put('posted', daysBack(5), null, null);
      expect(await lateness('ada', fenlow.id)).toEqual(before);
      await put('posted', daysBack(89), 0, 0);
      expect(await lateness('ada', fenlow.id)).toEqual({ n: before.n + 1, late: before.late, avg: before.avg });
      await rows(`delete from inventory_receipts where po_id = ${String(order)} and ${q('number')} is null`);
      cache.invalidateTable(connectionId, tableId('inventory_receipts'));
      expect(await lateness('ada', fenlow.id)).toEqual(before);
    });

    it('lets the three read six columns of a receipt and nothing of its money, note or taker; a rep and the sales manager are refused every door', async () => {
      const url = (rest: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tableId('inventory_receipts'))}${rest}`;
      for (const who of ['tessa', 'ada', 'grace']) {
        const listed = await app.inject({ method: 'GET', url: url('?limit=1'), headers: { cookie: cookie[who]! } });
        expect(listed.statusCode, `${who}: ${listed.body}`).toBe(200);
        expect(Object.keys((listed.json() as { data: Record<string, unknown>[] }).data[0]!).sort(), who).toEqual([...READ['inventory_receipts']!].sort());
        // A column she does not read is no filter of hers either: what a delivery cost, or who took it in.
        for (const column of ['total', 'by']) expect((await figure(who, { source: { name: 'inventory_receipts' }, shape: 'single-metric', filters: [{ column, op: 'not_null' }], aggregations: [{ fn: 'count', alias: 'n' }] })).statusCode, `${who} ${column}`).toBeGreaterThanOrEqual(400);
        const write = await app.inject({ method: 'PATCH', url: url(`/${String((listed.json() as { data: { id: unknown }[] }).data[0]!.id)}`), headers: { cookie: cookie[who]! }, payload: { values: { late: 0 } } });
        expect(write.statusCode, who).toBeGreaterThanOrEqual(400);
      }
      for (const who of ['dana', 'ivy']) {
        expect((await app.inject({ method: 'GET', url: url('?limit=1'), headers: { cookie: cookie[who]! } })).statusCode, who).toBe(403);
        expect((await figure(who, { source: { name: 'inventory_receipts' }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] })).statusCode, who).toBe(403);
        expect((await figure(who, { source: { name: 'inventory_receipts' }, shape: 'categorical', filters: [...SAYS, WINDOW], groupBy: ['late'], aggregations: [{ fn: 'count', alias: 'n' }] })).statusCode, who).toBe(403);
      }
    });
  });
}
