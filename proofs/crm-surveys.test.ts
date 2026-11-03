// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SURVEY AFTER THE JOB, AND ITS ANSWER AS THE JOB'S FEEDBACK: the CRM with
 * the Forms add-on as the add-ons checkout built it, on the whole server, on
 * SQLite, Postgres and MySQL; a customer's answer sent through the forms door
 * as a browser sends it, every staff read made signed in as the person it is
 * about.
 *
 *  - the rule ships off: a job signed off gets no survey;
 *  - switched on: two days after a job is signed off, one invitation to the
 *    job's contact, the job in it as other rows name it; one marketing mail
 *    with a one-use link to a contact who agreed to surveys, none to one on
 *    the do-not-email list or one who never agreed; a job with no contact
 *    fails by name and sends nothing; as service mail, still none to a
 *    contact who said no to surveys;
 *  - the answer through the link makes the job's feedback: the score from the
 *    stars, the words, the day it came in, marked as the survey's; a job
 *    named in the body is refused, and a second answer with the link too;
 *  - the account manager reads when the survey went and whether it was
 *    answered (the aftercare call's line), and not who it went to; the
 *    marketer reads none of it; Forms' Survey tab shows on the job's page to
 *    him, and not to the operations manager, who reads no invitations;
 *  - with Forms switched off for the app, Surveys is off and waits for it,
 *    and an answer typed by hand is still taken, with the day typed and not
 *    marked as a survey's; the account manager cannot mark one so.
 *
 * Needs the add-ons checkout with Forms built (`ADD_ONS_REPO`): without it,
 * the suite fails by name.
 *
 * To run: `npm run proofs -- surveys` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { automationsRepo, pagesRepo, paymentSettingsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';

import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createConsentService } from '../src/consent/index.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createDkimKeys, createTxtLookup } from '../src/email/sender/index.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { appPartIsOn } from '../src/rbac/app-parts.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.42' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p71t06-crm`;
const read = (path: string) => readFileSync(`${APP}/${path}`, 'utf8');
const manifest = () => JSON.parse(read('whole/manifest.json')) as Record<string, unknown> & { version: string };
const HOST = 'forms.meridian.example';
const ORIGIN = `https://${HOST}`;
const FORMS = builtAddOn('forms');

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const en = (value: string) => ({ 'en-US': value });
/** The fit-out survey, as the builder writes one: a recommend score, the stars and a long text. */
const SURVEY = {
  v: 1,
  kind: 'survey',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: en('How did your fit-out go?'),
  questions: [
    { id: 'qrecommend', kind: 'score', recommend: true, required: true, label: en('How likely are you to recommend Meridian to a colleague?') },
    { id: 'qstars', kind: 'stars', required: true, label: en('How would you rate the fit-out overall?') },
    { id: 'qsaid', kind: 'long', label: en('What should we keep doing, or do better?') },
  ],
  ending: { kind: 'words', words: en('Thank you. We read every answer.') },
};

describe.skipIf(FORMS !== null)("the CRM's survey after the job", () => {
  it('needs the add-ons checkout with Forms built (ADD_ONS_REPO)', () => {
    expect(FORMS).not.toBeNull();
  });
});

describe.each(LEGS)(`the CRM's survey after the job, with Forms ${FORMS?.version ?? ''} — %s`, (dialect, available) => {
  const run = available && FORMS !== null;
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let stage = 0;
  let company = 0;
  let seq = 0;
  let ruleId = '';
  const dns = new Map<string, string[]>();
  const cookie: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const tableIds: Record<string, string> = {};
  const names: Record<string, string> = {};
  const job: Record<string, number> = {};
  const contact: Record<string, number> = {};

  const as = (who: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { host: HOST, cookie: cookie[who]! }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const data = (ref: string, rest = '') => `/api/v1/data/${h.connectionId}/${encodeURIComponent(tableIds[ref]!)}${rest}`;
  const made = (res: { statusCode: number; body: string; json: () => unknown }): number => {
    expect(res.statusCode, res.body).toBe(201);
    return Number((res.json() as { data: { id: number } }).data.id);
  };
  const rows = (ref: string, where = '1 = 1') => h.rows(`SELECT * FROM ${names[ref]!} WHERE ${where}`) as Promise<Doc[]>;
  const consent = () => createConsentService({ meta: h.meta, secret: TEST_SECRET });
  /** The mails queued since the last look, opened, and taken off the worker's hands. */
  const mails = async (): Promise<{ to: string; subject: string; html: string; text: string }[]> => {
    const waiting = await h.meta.db.selectFrom('adminium_jobs').select(['id', 'payload']).where('kind', '=', 'email.send').where('status', '=', 'pending').orderBy('createdAt', 'asc').execute();
    for (const row of waiting) await h.meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
    return waiting.map((row) => {
      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; html: string; text: string };
    });
  };
  const queued: Awaited<ReturnType<typeof mails>> = [];
  /** Run what is due now (a rule's run, the outbox's send); with `wait`, also what waits (a rule's two days), as if they were over. */
  const runJobs = async (wait = false) => {
    for (let round = 0; round < 30; round += 1) {
      queued.push(...(await mails()));
      let due = h.meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).where('kind', '!=', 'email.send');
      if (!wait) due = due.where('runAt', '<=', Date.now() + 90_000);
      await due.execute();
      if ((await composed.jobs.worker.runOnce()) === 0) break;
    }
    queued.push(...(await mails()));
  };
  /** The survey mails queued for an address (a job's sign-off sends its signed copy to the same contact). */
  const mailTo = (address: string) => queued.filter((mail) => mail.to.includes(address) && mail.text.includes('/x/forms/'));
  /** A stranger's answer on the forms host: a fresh proof for the survey (its link's token rides on the challenge too), then the send. */
  const send = async (slug: string, values: Record<string, unknown>, t?: string) => {
    const challenge = (await composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}/challenge${t === undefined ? '' : `?t=${t}`}`, headers: { host: HOST } })).json() as Doc;
    const proof = typeof challenge.salt === 'string' ? `${challenge.id as string}.${solveProof(challenge.salt, challenge.difficulty as number)}` : 'none';
    seq += 1;
    return composed.app.inject({
      method: 'POST',
      url: `/x/forms/api/${slug}/answers`,
      remoteAddress: `198.51.100.${String(seq % 250)}`,
      headers: { host: HOST, origin: ORIGIN, 'x-adminium-proof': proof, 'user-agent': 'Mozilla/5.0 proof' },
      payload: { language: 'en-US', values, query: {}, website: '', ...(t === undefined ? {} : { t }) },
    });
  };
  const act = (who: string, ref: string, key: number, action: string, from: string) => as(who, 'POST', data(ref, `/${String(key)}/actions/${action}`), { from });
  /** A job signed off as the crew's sign-off does it: installed, then the sign-off moves it. */
  const signOff = async (key: number) => {
    expect((await act('owner', 'jobs', key, 'installed', 'open')).statusCode).toBeLessThan(300);
    made(await as('owner', 'POST', data('sign_offs'), { values: { job_id: key, check_1: true, signer_name: 'Site lead' } }));
    expect((await rows('jobs', `id = ${String(key)}`))[0]!['state']).toBe('signed-off');
  };
  const invitationOf = async (key: number) => rows('invitations', `record_key = '${String(key)}'`);
  const runsOf = async () => h.meta.db.selectFrom('adminium_automation_runs').select(['status', 'error']).where('automationId', '=', ruleId).execute();
  const rule = async (patch: Record<string, unknown>) => {
    const res = await as('owner', 'PATCH', `/api/v1/automations/${ruleId}`, patch);
    expect(res.statusCode, res.body).toBe(200);
  };
  /** Today, as the server may date it: by UTC, or by its own clock's day (they differ in the hour after a local midnight). */
  const today = () => { const now = new Date(); const local = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; return [now.toISOString().slice(0, 10), local]; };

  beforeAll(async () => {
    if (!run) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    // The harness packs text only: the sample's picture bytes do not matter here, its place in the package does.
    const packed = JSON.parse(read('whole/seeds/meridian.json')) as { assets?: Record<string, { file: string; sha256: string }> };
    for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
    await h.stageApp(manifest(), { 'seeds/meridian.json': JSON.stringify(packed), 'seeds/meridian.inventory.json': read('whole/seeds/meridian.inventory.json'), 'seeds/meridian.forms.json': read('whole/seeds/meridian.forms.json') });
    const installed = await h.install('crm', manifest().version, { modules: { inbox: true, jobs: true, aftercare: true } });
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(FORMS!.manifest, { bundled: true, files: FORMS!.files });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: FORMS!.version, attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    // Vouched for as a bundled package is: its bytes recorded as trusted (a package nobody vouches for serves no form).
    await recordDeciderTrust(h.meta, { key: 'forms', version: FORMS!.version, integrity: (await h.addOnStore.verifyTree('forms', FORMS!.version)).integrity });
    const snapshot = await h.meta.db.selectFrom('adminium_schema_snapshots').select(['schema']).where('connectionId', '=', h.connectionId).orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    const schema = (typeof snapshot.schema === 'string' ? JSON.parse(snapshot.schema) : snapshot.schema) as { tables: { id: string; name: string }[] };
    for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) {
      if (row.appKey !== 'crm' && row.appKey !== 'forms') continue;
      names[row.ref] = row.tableName;
      tableIds[row.ref] = schema.tables.find((table) => table.name === row.tableName)!.id;
    }

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://meridian.example/privacy', { updatedBy: null });
    await settings.set('email.smtp', { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Meridian <news@meridian.example>', secure: false }, { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });
    // The sender is ready for marketing mail: its signing key and DMARC published (the DNS answered here), and a postal address.
    const key = await createDkimKeys({ meta: h.meta, secret: TEST_SECRET }).make('meridian.example');
    dns.set('_dmarc.meridian.example', ['v=DMARC1; p=quarantine']);
    dns.set(key.record.name, [key.record.value]);

    root = await mkdtemp(join(tmpdir(), 'crm-surveys-'));
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
      marketingSeams: { lookup: createTxtLookup({ cacheMs: 0, resolve: async (name) => (dns.get(name) ?? []).map((record) => [record]) }), postalAddress: async () => 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom' },
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    // The people, each signed in: the owner, the account manager who makes the aftercare calls, the marketer, and the
    // operations manager (who reads the jobs, and nothing of Forms).
    const hash = await adminPasswordHash();
    const people: [string, string | null][] = [['owner', null], ['hugo', 'account-manager'], ['lena', 'marketer'], ['ada', 'ops-manager']];
    for (const [name, role] of people) {
      const user = await usersRepo(h.meta).create({ email: `${name}@meridian.example`, name: `${name[0]!.toUpperCase()}${name.slice(1)}`, passwordHash: hash });
      await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(role === null ? 'super-admin' : `crm-${role}`))!.id);
      ids[name] = user.id;
      const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.15.0.${String(people.findIndex(([one]) => one === name) + 1)}`, headers: { host: HOST }, payload: { email: `${name}@meridian.example`, password: ADMIN_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      cookie[name] = sessionCookie(login.headers['set-cookie']);
    }

    // The fit-out survey, as the builder makes and publishes it: named, its answers the job's feedback.
    const surveySettings = { becomes: { table: tableIds['feedback']!, map: { qstars: 'score', qsaid: 'text' } }, tell: [], limits: { perHour: 200, harder: false }, survey: { mode: 'named', linkNames: true, stopAfterDays: 30 } };
    const formKey = randomUUID();
    const draft = await as('owner', 'POST', data('forms'), { values: { id: formKey, name: 'How did your fit-out go?', slug: 'fit-out', kind: 'survey', state: 'draft', definition: SURVEY, settings: surveySettings } });
    expect(draft.statusCode, draft.body).toBe(201);
    const live = await as('owner', 'PATCH', data('forms', `/${formKey}`), { values: { state: 'live', published: { definition: SURVEY, settings: surveySettings }, published_at: new Date().toISOString() }, from: 'draft' });
    expect(live.statusCode, live.body).toBe(200);

    // Six jobs, each of a deal of its own: for Ann (agreed to surveys), Ben (on the do-not-email list), Cleo (agreed to the
    // newsletter only), Dee (said no to surveys), one with no contact, and an earlier one of Ann's.
    stage = made(await as('owner', 'POST', data('stages'), { values: { label: 'Proposal', odds: 0.5, position: 1 } }));
    company = made(await as('owner', 'POST', data('companies'), { values: { name: 'Linden Studio' } }));
    for (const who of ['ann', 'ben', 'cleo', 'dee', 'nobody', 'early']) {
      if (who !== 'nobody' && who !== 'early') contact[who] = made(await as('owner', 'POST', data('contacts'), { values: { company_id: company, name: `${who[0]!.toUpperCase()}${who.slice(1)} Lee`, email: `${who}@lindenstudio.co.uk`, may_email: who === 'ann' } }));
      const to = who === 'early' ? contact['ann'] : contact[who];
      const deal = made(await as('owner', 'POST', data('deals'), { values: { name: `Fit-out for ${who}`, company_id: company, ...(to === undefined ? {} : { contact_id: to }), owner_id: ids['owner'], stage_id: stage } }));
      job[who] = made(await as('owner', 'POST', data('jobs'), { values: { deal_id: deal, site_name: `Linden Studio, ${who}` } }));
    }
    // Ann's yes to surveys, as a form's tick records one: her row and her address (from 0.3.42 the sender judges a
    // marketing invitation on the contact it names, so her row's yes carries it).
    await consent().record({ person: { connectionId: h.connectionId, table: tableIds['contacts']!, key: String(contact['ann']) }, address: 'ann@lindenstudio.co.uk', purpose: 'surveys', source: 'import', state: 'yes' });
    await consent().record({ person: { connectionId: h.connectionId, table: tableIds['contacts']!, key: String(contact['cleo']) }, purpose: 'newsletter', source: 'import', state: 'yes' });
    await consent().record({ person: { connectionId: h.connectionId, table: tableIds['contacts']!, key: String(contact['dee']) }, purpose: 'surveys', source: 'import', state: 'no' });
    await consent().stop.add({ address: 'ben@lindenstudio.co.uk', reason: 'link' });
    ruleId = String((await automationsRepo(h.meta).listManagedBy('crm', h.connectionId)).find((one) => one.templateKey === 'survey-after-sign-off')!.id);
    await runJobs(true);
    queued.splice(0);
  }, 600_000);

  afterAll(async () => {
    if (!run) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!run)('ships the rule switched off: a job signed off gets no survey', async () => {
    expect(await appPartIsOn(h.meta, 'crm', 'surveys')).toBe(true);
    await signOff(job['early']!);
    await runJobs(true);
    expect(await invitationOf(job['early']!)).toEqual([]);
    expect(await runsOf()).toEqual([]);
  });

  it.skipIf(!run)("switched on: two days after a sign-off, one invitation to the job's contact with the job in it, and one marketing mail with a link to who agreed", async () => {
    await rule({ enabled: true });
    await signOff(job['ann']!);
    await runJobs();
    // Before the two days are out, nothing.
    expect(await invitationOf(job['ann']!)).toEqual([]);
    await runJobs(true);
    const [invited, ...more] = await invitationOf(job['ann']!);
    expect(more).toEqual([]);
    expect(invited).toMatchObject({ email: 'ann@lindenstudio.co.uk', name: 'Ann Lee', company: 'Linden Studio', person_table: tableIds['contacts'], person_key: String(contact['ann']), record_table: 'crm:jobs', record_key: String(job['ann']), class: 'marketing' });
    expect(invited!['answered_at']).toBeNull();
    const sent = mailTo('ann@lindenstudio.co.uk');
    expect(sent, JSON.stringify(await rows('invitation_mails', `invitation_id = '${String(invited!['id'])}'`))).toHaveLength(1);
    expect(/\/x\/forms\/fit-out\?t=[A-Za-z0-9_-]+/.test(sent[0]!.html + sent[0]!.text), sent[0]!.text).toBe(true);
    // Marketing mail: it carries the way to say no.
    expect(sent[0]!.text.toLowerCase()).toContain('unsubscribe');
  });

  it.skipIf(!run)('sends no marketing survey to a contact on the do-not-email list, nor to one who never agreed; a job with no contact fails by name and sends nothing', async () => {
    for (const who of ['ben', 'cleo', 'nobody']) await signOff(job[who]!);
    await runJobs(true);
    const mailOf = async (who: string) => (await rows('invitation_mails', `invitation_id = '${String((await invitationOf(job[who]!))[0]!['id'])}'`)).map((one) => [one['status'], one['error']]);
    expect(await mailOf('ben')).toEqual([['skipped', 'Not sent: on the do-not-email list (marketing mail)']]);
    expect(await mailOf('cleo')).toEqual([['skipped', expect.stringContaining('has not agreed')]]);
    for (const who of ['ben', 'cleo']) expect(mailTo(`${who}@lindenstudio.co.uk`)).toEqual([]);
    expect(await invitationOf(job['nobody']!)).toEqual([]);
    const failed = (await runsOf()).filter((one) => one.status === 'failed');
    expect(failed.map((one) => one.error)).toEqual([expect.stringContaining('contact_id is empty')]);
  });

  it.skipIf(!run)('as service mail, still none to a contact who said no to surveys', async () => {
    const managed = (await automationsRepo(h.meta).listManagedBy('crm', h.connectionId)).find((one) => one.templateKey === 'survey-after-sign-off')!;
    const graph = JSON.parse(JSON.stringify(managed.graph)) as { nodes: { action?: { kind: string; inputs: Record<string, string> } }[] };
    for (const node of graph.nodes) if (node.action?.kind === 'add-on.step') node.action.inputs['class'] = 'service';
    await rule({ graph });
    await signOff(job['dee']!);
    await runJobs(true);
    const [invited] = await invitationOf(job['dee']!);
    expect(invited).toMatchObject({ class: 'service' });
    expect((await rows('invitation_mails', `invitation_id = '${String(invited!['id'])}'`)).map((one) => [one['status'], one['error']])).toEqual([['skipped', 'Not sent: they said no to surveys']]);
    expect(mailTo('dee@lindenstudio.co.uk')).toEqual([]);
  });

  it.skipIf(!run)("the answer through the link makes the job's feedback, marked as the survey's and dated today; a job named in the body is refused, and a second answer too", async () => {
    const link = /\/x\/forms\/fit-out\?t=([A-Za-z0-9_-]+)/.exec(mailTo('ann@lindenstudio.co.uk')[0]!.text)!;
    const token = link[1]!;
    const forged = await send('fit-out', { qrecommend: 9, qstars: 5, qsaid: 'Spot on.', job_id: job['ben'] }, token);
    expect(forged.statusCode).toBe(400);
    expect(await rows('feedback')).toEqual([]);
    const sent = await send('fit-out', { qrecommend: 9, qstars: 4, qsaid: 'Tidy work, on time.' }, token);
    expect(sent.statusCode, sent.body).toBe(200);
    const [row, ...more] = await rows('feedback');
    expect(more).toEqual([]);
    expect([Number(row!['job_id']), Number(row!['score']), row!['text'], Boolean(row!['from_survey']), today().includes(String(row!['answered_on']).slice(0, 10))]).toEqual([job['ann'], 4, 'Tidy work, on time.', true, true]);
    expect([row!['theme'], row!['replied_at'], row!['fix_written']]).toEqual([null, null, null]);
    expect((await invitationOf(job['ann']!))[0]!['answered_at']).not.toBeNull();
    const again = await send('fit-out', { qrecommend: 2, qstars: 1, qsaid: 'Changed my mind.' }, token);
    expect(again.statusCode).not.toBe(200);
    expect(await rows('feedback')).toHaveLength(1);
  });

  it.skipIf(!run)("lets the account manager read when a job's survey went and whether it came back, and not who it went to; the marketer reads none of it", async () => {
    const where = JSON.stringify({
      and: [
        { column: 'record_table', op: 'eq', value: 'crm:jobs' },
        { column: 'record_key', op: 'in', value: [String(job['ann']), String(job['ben'])] },
      ],
    });
    const list = await as('hugo', 'GET', data('invitations', `?select=record_key,invited_at,answered_at&where=${encodeURIComponent(where)}&limit=50`));
    expect(list.statusCode, list.body).toBe(200);
    const read = (list.json() as { data: Doc[] }).data;
    expect(read.map((one) => [one['record_key'], one['answered_at'] === null]).sort()).toEqual([
      [String(job['ann']), false],
      [String(job['ben']), true],
    ]);
    // Who it went to is not his to read.
    expect((await as('hugo', 'GET', data('invitations', `?select=email&limit=5`))).statusCode).toBe(403);
    for (const one of read) expect(one['email'], 'email').toBeUndefined();
    expect((await as('lena', 'GET', data('invitations', '?limit=5'))).statusCode).toBe(403);
    // His aftercare call for the job is there beside it.
    expect((await rows('follow_ups', `job_id = ${String(job['ann'])} AND kind = 'aftercare'`)).length).toBe(1);
  });

  it.skipIf(!run)("shows Forms' Survey tab on the job's page to the account manager, and not to the operations manager, who reads no invitations", async () => {
    const page = (await pagesRepo(h.meta).listForConnection(h.connectionId)).find((one) => (one.config as { source?: { table?: string } }).source?.table === tableIds['jobs'])!;
    const tabs = async (who: string) => {
      const res = await as(who, 'GET', `/api/v1/pages/${page.id}`);
      expect(res.statusCode, `${who}: ${res.body}`).toBe(200);
      const find = (value: unknown): Doc[] | null => {
        if (Array.isArray(value)) return value.map(find).find((one) => one !== null) ?? null;
        if (typeof value !== 'object' || value === null) return null;
        if (Array.isArray((value as Doc)['recordTabs'])) return (value as Doc)['recordTabs'] as Doc[];
        return Object.values(value).map(find).find((one) => one !== null) ?? null;
      };
      return (find(res.json()) ?? []).map((tab) => `${String(tab['addOn'])}:${String(tab['id'])}`);
    };
    expect(await tabs('hugo')).toEqual(['forms:survey']);
    expect(await tabs('ada')).toEqual([]);
  });

  it.skipIf(!run)('with Forms switched off for the app: Surveys waits, and an answer typed by hand is taken as typed; nobody on the staff marks one as the survey\'s', async () => {
    const off = await h.inject({ method: 'PATCH', url: '/add-ons/forms', payload: { attachedTo: 'crm', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    try {
      expect(await appPartIsOn(h.meta, 'crm', 'surveys')).toBe(false);
      const parts = (await h.inject({ method: 'GET', url: '/apps/crm/parts' })).json() as { parts: { id: string; waiting: { key: string }[] }[] };
      expect(parts.parts.find((part) => part.id === 'surveys')!.waiting.map((one) => one.key)).toEqual(['forms']);
      // Typed by hand: the day typed, not marked as a survey's.
      const typed = made(await as('hugo', 'POST', data('feedback'), { values: { job_id: job['ben'], score: 3, text: 'Said on the phone.', answered_on: '2026-10-20' } }));
      const row = (await rows('feedback', `id = ${String(typed)}`))[0]!;
      expect([String(row['answered_on']).slice(0, 10), row['from_survey'] ?? null]).toEqual(['2026-10-20', null]);
    } finally {
      expect((await h.inject({ method: 'PATCH', url: '/add-ons/forms', payload: { attachedTo: 'crm', enabled: true } })).statusCode).toBe(200);
    }
    expect(await appPartIsOn(h.meta, 'crm', 'surveys')).toBe(true);
    // Nor may he mark one as the survey's, on a new answer or on one there.
    expect((await as('hugo', 'POST', data('feedback'), { values: { job_id: job['dee'], score: 5, answered_on: '2026-10-21', from_survey: true } })).statusCode).toBeGreaterThanOrEqual(400);
    const ann = Number((await rows('feedback', `job_id = ${String(job['ann'])}`))[0]!['id']);
    expect((await as('hugo', 'PATCH', data('feedback', `/${String(ann)}`), { values: { from_survey: false } })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await as('hugo', 'PATCH', data('feedback', `/${String(ann)}`), { values: { answered_on: '2026-01-01' } })).statusCode).toBeGreaterThanOrEqual(400);
  });
});
