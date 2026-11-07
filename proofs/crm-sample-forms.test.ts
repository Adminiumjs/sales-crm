// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SAMPLE'S FORMS, SERVED: the CRM with the Forms add-on as the add-ons
 * checkout built it, its sample added, on the whole server, on SQLite,
 * Postgres and MySQL; a stranger's request sent to the forms door as a
 * browser sends it.
 *
 *  - an install with a privacy notice serves no sample form: each one that
 *    was ever published says it is closed;
 *  - once the owner opens the fit-out survey again (closed → live), an
 *    answer through a sample invitation's link becomes the job's feedback:
 *    the job from the invitation, the score from the stars, the words from
 *    the long answer, marked as the survey's. The sample keeps no token, so
 *    the link is given to the invitation as the outbox gives one when it
 *    mails it.
 *
 * Needs the add-ons checkout with Forms built (`ADD_ONS_REPO`): without it,
 * the suite fails by name.
 *
 * To run: `npm run proofs -- sample-forms` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';

import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { FORM_CACHE_MS } from '../src/forms/catalog.js';
import { surveyTokenHash } from '../src/forms/survey-token.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.49' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p71t06-crm`;
const read = (path: string) => readFileSync(`${APP}/${path}`, 'utf8');
const manifest = () => JSON.parse(read('whole/manifest.json')) as Record<string, unknown> & { version: string };
const HOST = 'forms.meridian.example';
const ORIGIN = `https://${HOST}`;
const BUILT = builtAddOn('forms');
// As the release will number it: the app suggests Forms 1.0.15 or newer, and a checkout built before the release says 1.0.14.
const FORMS = BUILT === null ? null : { ...BUILT, version: '1.0.15', manifest: { ...BUILT.manifest, version: '1.0.15' } };

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

describe.skipIf(FORMS !== null)("the CRM's sample forms, served", () => {
  it('needs the add-ons checkout with Forms built (ADD_ONS_REPO)', () => {
    expect(FORMS).not.toBeNull();
  });
});

describe.each(LEGS)(`the CRM's sample forms, served, with Forms ${FORMS?.version ?? ''} — %s`, (dialect, available) => {
  const run = available && FORMS !== null;
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let cookie = '';
  let formsTableId = '';
  const names: Record<string, string> = {};
  const rows = (ref: string, where = '1 = 1') => h.rows(`SELECT * FROM ${names[ref]!} WHERE ${where}`) as Promise<Doc[]>;
  const door = (slug: string, t?: string) => composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}${t === undefined ? '' : `?t=${t}`}`, headers: { host: HOST } });
  const send = async (slug: string, values: Record<string, unknown>, t: string) => {
    const challenge = (await composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}/challenge?t=${t}`, headers: { host: HOST } })).json() as Doc;
    const proof = typeof challenge.salt === 'string' ? `${challenge.id as string}.${solveProof(challenge.salt, challenge.difficulty as number)}` : 'none';
    return composed.app.inject({
      method: 'POST',
      url: `/x/forms/api/${slug}/answers`,
      remoteAddress: '198.51.100.40',
      headers: { host: HOST, origin: ORIGIN, 'x-adminium-proof': proof, 'user-agent': 'Mozilla/5.0 proof' },
      payload: { language: 'en-US', values, query: {}, website: '', t },
    });
  };

  beforeAll(async () => {
    if (!run) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(FORMS!.manifest, { bundled: true, files: FORMS!.files });
    // The harness packs text only: the sample's picture bytes do not matter here, its place in the package does.
    const packed = JSON.parse(read('whole/seeds/meridian.json')) as { assets?: Record<string, { file: string; sha256: string }> };
    for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
    await h.stageApp(manifest(), { 'seeds/meridian.json': JSON.stringify(packed), 'seeds/meridian.inventory.json': read('whole/seeds/meridian.inventory.json'), 'seeds/meridian.forms.json': read('whole/seeds/meridian.forms.json') });
    const installed = await h.install('crm', manifest().version, { addOns: [{ key: 'forms', version: FORMS!.version }], modules: { inbox: true, jobs: true, aftercare: true } });
    expect(installed.statusCode, installed.body).toBe(200);
    // Vouched for as a bundled package is: its bytes recorded as trusted (a package nobody vouches for serves no form).
    await recordDeciderTrust(h.meta, { key: 'forms', version: FORMS!.version, integrity: (await h.addOnStore.verifyTree('forms', FORMS!.version)).integrity });
    const added = await createSampleDataService(h.sampleData).add((await findSampleApp(h.meta, 'crm'))!, { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' });
    expect(added.counts).toMatchObject({ 'forms:forms': 5, 'forms:invitations': 7 });
    const snapshot = await h.meta.db.selectFrom('adminium_schema_snapshots').select(['schema']).where('connectionId', '=', h.connectionId).orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    const schema = (typeof snapshot.schema === 'string' ? JSON.parse(snapshot.schema) : snapshot.schema) as { tables: { id: string; name: string }[] };
    for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) {
      if (row.appKey === 'crm' || row.appKey === 'forms') names[row.ref] = row.tableName;
      if (row.appKey === 'forms' && row.ref === 'forms') formsTableId = schema.tables.find((table) => table.name === row.tableName)!.id;
    }

    // A server ready to serve forms: a public address and a privacy notice.
    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://meridian.example/privacy', { updatedBy: null });

    root = await mkdtemp(join(tmpdir(), 'crm-sample-forms-'));
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
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    // The owner, signed in.
    const user = await usersRepo(h.meta).create({ email: 'owner@meridian.example', name: 'Owner', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.16.0.1', headers: { host: HOST }, payload: { email: 'owner@meridian.example', password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 600_000);

  afterAll(async () => {
    if (!run) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!run)('serves no sample form to a stranger: each one ever published says it is closed', async () => {
    expect((await rows('forms', `state = 'live'`)).map((row) => row['slug'])).toEqual([]);
    for (const slug of ['showroom', 'newsletter', 'fit-out', 'showroom-feedback']) {
      const res = await door(slug);
      expect((res.json() as Doc)['state'], `${slug}: ${res.body}`).toBe('closed');
    }
  });

  it.skipIf(!run)("opened again by the owner, the fit-out survey takes a sample invitation's answer as the job's feedback, the job from the invitation", async () => {
    const [survey] = await rows('forms', `slug = 'fit-out'`);
    const opened = await composed.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(formsTableId)}/${String(survey!['id'])}`,
      headers: { host: HOST, cookie },
      payload: { values: { state: 'live' }, from: 'closed' },
    });
    expect(opened.statusCode, opened.body).toBe(200);
    // The door keeps what it last read of a form for a few seconds: a stranger sees it open once they are out.
    await new Promise((done) => setTimeout(done, FORM_CACHE_MS + 200));
    // The invitation of a signed-off job with no feedback yet, given a link as the outbox gives one when it mails it.
    const jobs = await rows('jobs');
    const answered = new Set((await rows('feedback')).map((row) => String(row['job_id'])));
    const invitations = await rows('invitations', 'answered_at IS NULL');
    const invitation = invitations.find((row) => !answered.has(String(row['record_key'])))!;
    expect(invitation, 'an unanswered invitation for a job with no feedback').toBeDefined();
    const job = jobs.find((row) => String(row['id']) === String(invitation['record_key']))!;
    expect(job, String(invitation['record_key'])).toBeDefined();
    const token = randomBytes(24).toString('base64url');
    const later = new Date(Date.now() + 7 * 86_400_000);
    const expires = dialect === 'mysql' ? later.toISOString().slice(0, 19).replace('T', ' ') : later.toISOString();
    await h.rows(`UPDATE ${names['invitations']!} SET token_hash = '${surveyTokenHash(token)}', expires_at = '${expires}' WHERE id = '${String(invitation['id'])}'`);
    expect((await door('fit-out', token)).json()).toMatchObject({ state: 'live' });

    const sent = await send('fit-out', { qrecommend: 9, qstars: 4, qsaid: 'The crew left it spotless.' }, token);
    expect(sent.statusCode, sent.body).toBe(200);
    const made = await rows('feedback', `job_id = ${String(job['id'])}`);
    expect(made).toHaveLength(1);
    expect([Number(made[0]!['score']), made[0]!['text'], Boolean(made[0]!['from_survey'])]).toEqual([4, 'The crew left it spotless.', true]);
    const [kept] = await rows('answers', `invitation_id = '${String(invitation['id'])}'`);
    expect([kept!['became_table'], String(kept!['became_key'])]).toEqual(['crm:feedback', String(made[0]!['id'])]);
    expect((await rows('invitations', `id = '${String(invitation['id'])}'`))[0]!['answered_at']).not.toBeNull();
  }, 60_000);
});
