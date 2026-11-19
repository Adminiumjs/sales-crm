// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A WEBSITE CHAT MAKES ENQUIRIES: the CRM with the Live chat add-on on the
 * whole server, on SQLite, Postgres and MySQL, a visitor's chat sent through
 * the chat door as the window sends it, and every staff call made signed in
 * as the person it is about.
 *
 *  - outside hours, a question left with an e-mail makes one enquiry through
 *    the CRM's chat entry: source "chat", open, the visitor's name, address
 *    and question, no company yet (an empty name, never a made-up one),
 *    nobody's; the conversation names it;
 *  - in hours, "Make an enquiry" is the person's own create: a rep who also
 *    answers the chat makes one, the same shape; somebody who answers the
 *    chat but may not add enquiries is refused, and so is Read-only;
 *  - "Read the chat": the roles of the Team inbox read the conversation an
 *    enquiry came from and its messages, and the roles without the inbox read
 *    neither.
 *
 * The add-on is the one the add-ons checkout built (`ADD_ONS_REPO`,
 * `packages/live-chat`); without it, the run skips and says so.
 *
 * To run: `npm run proofs -- chat` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';

import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.66' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p71w3-k1`;
const read = (path: string) => readFileSync(`${APP}/${path}`, 'utf8');
const manifest = () => JSON.parse(read('whole/manifest.json')) as Record<string, unknown> & { version: string };
const HOST = 'chat.meridian-workplace.com';
const ORIGIN = `https://${HOST}`;
const KEY = 'live-chat';

const CHAT = builtAddOn(KEY);
const ALL_DAY = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, [['00:00', '24:00']]]));

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

describe.each(LEGS)(`the CRM's website chat, with ${CHAT === null ? 'no built add-on (skipped)' : `the built add-on ${CHAT.version}`} — %s`, (dialect, legAvailable) => {
  const available = legAvailable && CHAT !== null;
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let seq = 0;
  const cookie: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const tables: Record<string, string> = {};
  const tableIds: Record<string, string> = {};

  const table = (ref: string) => tables[ref]!;
  const rows = (statement: string) => h.rows(statement) as Promise<Doc[]>;
  const as = (who: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { cookie: cookie[who]! }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const data = (ref: string, rest = '') => `/api/v1/data/${h.connectionId}/${tableIds[ref]!}${rest}`;
  const nextIp = () => {
    seq += 1;
    return `198.51.100.${String(seq % 250)}`;
  };
  /** The visitor, as the chat window calls the door: through the public address. */
  const door = (method: 'GET' | 'POST', path: string, opts: { payload?: unknown; headers?: Record<string, string>; ip?: string } = {}) =>
    composed.app.inject({ method, url: `/x/chat/api/${KEY}/${path}`, remoteAddress: opts.ip ?? '203.0.113.50', headers: { host: HOST, origin: ORIGIN, ...(opts.headers ?? {}) }, ...(opts.payload === undefined ? {} : { payload: opts.payload as Doc }) });
  const proof = async (): Promise<string> => {
    const challenge = (await door('POST', 'challenge', { payload: {} })).json() as Doc;
    return typeof challenge.salt === 'string' ? `${challenge.id as string}.${solveProof(challenge.salt, challenge.difficulty as number)}` : 'none';
  };
  /** The chat's settings row changed, and the door told at once. */
  const settle = async (values: Doc) => {
    const { db } = await h.manager.data(h.connectionId);
    const out: Doc = {};
    for (const [column, value] of Object.entries(values)) out[column] = ['hours', 'welcome', 'outside_words', 'tell'].includes(column) ? (value === null ? null : JSON.stringify(value)) : value;
    await db.updateTable(table(`${KEY}:settings`)).set(out as never).execute();
    composed.chat.catalog.forget();
  };
  /** A visitor starts a chat in hours and leaves a name and an address. */
  const chatted = async (body: string, name: string, email: string): Promise<{ token: string; id: string }> => {
    const started = await door('POST', 'start', { payload: { language: 'en-US', body }, headers: { 'x-adminium-proof': await proof() }, ip: nextIp() });
    expect(started.statusCode, started.body).toBe(200);
    const token = String((started.json() as Doc).token);
    const details = await door('POST', 'details', { payload: { token, name, email } });
    expect(details.statusCode, details.body).toBe(200);
    const id = String((await rows(`SELECT MAX(id) AS id FROM ${table(`${KEY}:conversations`)}`))[0]!['id']);
    return { token, id };
  };
  const enquiry = async (id: string | number): Promise<Doc> => (await rows(`SELECT * FROM ${table('crm:enquiries')} WHERE id = ${String(id)}`))[0]!;
  /** The enquiry the question left outside hours became, and its conversation. */
  const left: { enquiry?: string; conversation?: string; question?: string } = {};
  const where = (condition: unknown) => `where=${encodeURIComponent(JSON.stringify(condition))}`;

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    // The harness packs text only: the sample's picture bytes do not matter here, its place in the package does.
    const packed = JSON.parse(read('whole/seeds/meridian.json')) as { assets?: Record<string, { file: string; sha256: string }> };
    for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
    await h.stageApp(manifest(), { 'seeds/meridian.json': JSON.stringify(packed), 'seeds/meridian.inventory.json': read('whole/seeds/meridian.inventory.json') });
    const installed = await h.install('crm', manifest().version);
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(CHAT!.manifest, { bundled: true, files: CHAT!.files });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: KEY, version: CHAT!.version, attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    // Vouched for as a bundled package is: a chat nobody vouches for opens no door.
    await recordDeciderTrust(h.meta, { key: KEY, version: CHAT!.version, integrity: (await h.addOnStore.verifyTree(KEY, CHAT!.version)).integrity });
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;
    const snapshot = await h.meta.db.selectFrom('adminium_schema_snapshots').select(['schema']).where('connectionId', '=', h.connectionId).orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    const schema = (typeof snapshot.schema === 'string' ? JSON.parse(snapshot.schema) : snapshot.schema) as { tables: { id: string; name: string }[] };
    for (const ref of ['crm:enquiries', `${KEY}:conversations`, `${KEY}:messages`]) tableIds[ref] = schema.tables.find((one) => one.name === table(ref))!.id;
    if (Number((await rows(`SELECT COUNT(*) AS n FROM ${table(`${KEY}:settings`)}`))[0]!['n']) === 0) {
      const { db } = await h.manager.data(h.connectionId);
      await db.insertInto(table(`${KEY}:settings`)).values({ automatic: dialect === 'postgres' ? false : 0, daily_tokens: 0, milo_drafts: dialect === 'postgres' ? false : 0, theme: 'light' } as never).execute();
    }

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://meridian-workplace.com/privacy', { updatedBy: null });

    root = await mkdtemp(join(tmpdir(), 'crm-chat-'));
    await mkdir(join(root, 'dist', 'x'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body></body></html>');
    await writeFile(join(root, 'dist', 'x', 'index.html'), '<!doctype html><html><body><noscript>x</noscript></body></html>');
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: join(root, 'dist'),
      logger: false,
      telemetry: false,
      // No AI here: every visitor's message waits for a person.
      chatSeams: { ai: async () => ({ usable: false, service: null }), answerer: { pick: async () => ({ kind: 'hand-over', outcome: 'hand-over' }) } },
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    // The people, each signed in. Dana is a rep who also answers the chat; Abel answers the chat and is in no CRM role.
    const hash = await adminPasswordHash();
    const people: [string, string[]][] = [
      ['owner', ['super-admin']],
      ['dana', ['crm-rep', `${KEY}-agent`]],
      ['abel', [`${KEY}-agent`]],
      ['corin', ['crm-front-desk']],
      ['lena', ['crm-marketer']],
      ['grace', ['crm-read-only']],
      ['ada', ['crm-ops-manager']],
    ];
    for (const [name, slugs] of people) {
      const user = await usersRepo(h.meta).create({ email: `${name}@meridian-workplace.com`, name: `${name[0]!.toUpperCase()}${name.slice(1)}`, passwordHash: hash });
      for (const slug of slugs) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
      ids[name] = user.id;
      const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.15.0.${String(people.findIndex(([one]) => one === name) + 1)}`, payload: { email: `${name}@meridian-workplace.com`, password: ADMIN_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      cookie[name] = sessionCookie(login.headers['set-cookie']);
    }
  }, 600_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('outside hours, a question left with an e-mail makes one enquiry: from a chat, open, no company yet, nobody’s; the conversation names it', async () => {
    await settle({ hours: null });
    const before = Number((await rows(`SELECT COUNT(*) AS n FROM ${table('crm:enquiries')}`))[0]!['n']);
    const asked = await door('POST', 'question', {
      payload: { language: 'en-US', question: 'Could you quote for six acoustic booths for our Leeds office?', name: 'Marta Kovac', email: 'marta@cobalt-legal.com' },
      headers: { 'x-adminium-proof': await proof() },
      ip: nextIp(),
    });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(Number((await rows(`SELECT COUNT(*) AS n FROM ${table('crm:enquiries')}`))[0]!['n'])).toBe(before + 1);
    const conversation = (await rows(`SELECT * FROM ${table(`${KEY}:conversations`)} ORDER BY id DESC`))[0]!;
    expect(conversation['became_table']).toBe('crm:enquiries');
    const row = await enquiry(conversation['became_key'] as string);
    expect({ source: row['source'], state: row['state'], person: row['person'], email: row['email'], text: row['text'], company_name: row['company_name'], claimed_by_id: row['claimed_by_id'], deal_id: row['deal_id'] }).toEqual({
      source: 'chat',
      state: 'open',
      person: 'Marta Kovac',
      email: 'marta@cobalt-legal.com',
      text: 'Could you quote for six acoustic booths for our Leeds office?',
      company_name: '',
      claimed_by_id: null,
      deal_id: null,
    });
    expect(row['received_at']).not.toBeNull();
    left.enquiry = String(conversation['became_key']);
    left.conversation = String(conversation['id']);
    left.question = String(row['text']);
  });

  it.skipIf(!available)('in hours, "Make an enquiry" is the person’s own create: a rep who answers the chat makes it; one who may not add enquiries, and Read-only, are refused', async () => {
    await settle({ hours: ALL_DAY, time_zone: 'UTC' });
    const chat = await chatted('We need ten sit-stand desks for a new office.', 'Ines Vaughan', 'ines@harbour-design.com');
    const make = (who: string) => as(who, 'POST', `/api/v1/chat/${KEY}/conversations/${chat.id}/enquiry`, {});
    const abel = await make('abel');
    expect(abel.statusCode, abel.body).toBe(403);
    expect((abel.json() as Doc).error.details.reason).toBe('enquiry-create');
    expect((await make('grace')).statusCode).toBe(403);
    const made = await make('dana');
    expect(made.statusCode, made.body).toBe(200);
    const became = (made.json() as Doc).data.became as Doc;
    expect(became.table).toBe('crm:enquiries');
    const row = await enquiry(became.key as string);
    expect({ source: row['source'], state: row['state'], person: row['person'], email: row['email'], text: row['text'], company_name: row['company_name'], claimed_by_id: row['claimed_by_id'] }).toEqual({
      source: 'chat',
      state: 'open',
      person: 'Ines Vaughan',
      email: 'ines@harbour-design.com',
      text: 'We need ten sit-stand desks for a new office.',
      company_name: '',
      claimed_by_id: null,
    });
    // Read through the data routes as the rep sees it: the empty company stands, nothing fills it.
    const listed = await as('dana', 'GET', data('crm:enquiries', `/${String(became.key)}`));
    expect(listed.statusCode, listed.body).toBe(200);
    expect((listed.json() as Doc).data.company_name).toBe('');
  });

  it.skipIf(!available)('"Read the chat": the Team inbox roles read the conversation an enquiry came from and its lines, and only the columns the screen shows; the others read neither', async () => {
    expect(left.enquiry).toBeDefined();
    const found = { and: [{ column: 'became_table', op: 'eq', value: 'crm:enquiries' }, { column: 'became_key', op: 'eq', value: left.enquiry }] };
    const lines = { column: 'conversation_id', op: 'eq', value: Number(left.conversation) };
    for (const who of ['corin', 'lena']) {
      const conversations = await as(who, 'GET', data(`${KEY}:conversations`, `?${where(found)}&select=id,started_at,outside_hours,became_table,became_key&limit=1`));
      expect(conversations.statusCode, `${who}: ${conversations.body}`).toBe(200);
      const [conversation] = (conversations.json() as Doc).data as Doc[];
      expect(String(conversation!['id']), who).toBe(left.conversation);
      expect([true, 1].includes(conversation!['outside_hours'] as never), who).toBe(true);
      // The visitor's name and address stay the enquiry's: the conversation's own are not read.
      const whole = await as(who, 'GET', data(`${KEY}:conversations`, `?${where(found)}&limit=1`));
      expect(whole.statusCode, whole.body).toBe(200);
      const keys = Object.keys(((whole.json() as Doc).data as Doc[])[0]!).filter((key) => !key.startsWith('_'));
      expect(keys.filter((key) => ['name', 'email', 'came_from', 'taken_by'].includes(key)), who).toEqual([]);
      const messages = await as(who, 'GET', data(`${KEY}:messages`, `?${where(lines)}&select=id,kind,body,event,author_id,sent_at&order=id`));
      expect(messages.statusCode, `${who}: ${messages.body}`).toBe(200);
      const read = (messages.json() as Doc).data as Doc[];
      // The question reads in clear (the body is personal: the grant reads it), and nothing of it is masked.
      expect(read.filter((one) => one['kind'] === 'visitor').map((one) => one['body']), who).toEqual([left.question]);
      // Nobody of the inbox writes a line: Adminium alone does.
      const wrote = await as(who, 'POST', data(`${KEY}:messages`), { values: { conversation_id: Number(left.conversation), kind: 'staff', body: 'Hello', sent_at: new Date().toISOString() } });
      expect(wrote.statusCode, who).toBe(403);
    }
    for (const who of ['grace', 'ada']) {
      expect((await as(who, 'GET', data(`${KEY}:conversations`, `?${where(found)}&limit=1`))).statusCode, who).toBe(403);
      expect((await as(who, 'GET', data(`${KEY}:messages`, `?${where(lines)}`))).statusCode, who).toBe(403);
    }
  });
});
