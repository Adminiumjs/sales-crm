// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WEBSITE FORMS MAKE ENQUIRIES, AND THE BROCHURE: the CRM with the Forms
 * add-on on the whole server, on SQLite, Postgres and MySQL, a stranger's
 * answer sent through the forms door as a browser sends it, and every staff
 * read made signed in as the person it is about.
 *
 *  - a form mapped to Enquiries (as the builder writes it) makes one enquiry:
 *    source "form", state open, the form's name in "From the form", the
 *    moment it came in stamped by the server, no opt-out mark, nobody's, no
 *    deal; an address already in Contacts changes no contact;
 *  - a body naming `state`, `claimed_by_id` or `deal_id` is refused, and a
 *    form whose map names one of them serves nothing;
 *  - a rep and the marketer read the enquiry through their own roles, and
 *    neither may change where it came from;
 *  - the brochure rule, shipped off: off, an enquiry that asked gets no mail
 *    and no follow-up; on, one service mail to the enquirer with the link in
 *    Settings, and two days on with no deal one follow-up to call them: for
 *    whoever claimed it, else for the person Settings names; with a deal, none;
 *    with no link set, no mail and still the follow-up; never to an address
 *    on the do-not-email list, nor to a person who said no to the newsletter
 *    (a stranger can type anyone's address into a form);
 *  - one visitor makes at most ten enquiries an hour, all forms together.
 *
 * The Forms add-on is the one the add-ons checkout built (`ADD_ONS_REPO`,
 * `packages/forms`), else the engine's own forms fixture: the run says which.
 *
 * To run: `npm run proofs -- forms` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FormDefinitionInput, FormSettingsInput } from '@adminium/add-on-contracts/forms';
import { automationsRepo, paymentSettingsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';

import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createConsentService } from '../src/consent/index.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.41' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p71t06-crm`;
const read = (path: string) => readFileSync(`${APP}/${path}`, 'utf8');
const manifest = () => JSON.parse(read('whole/manifest.json')) as Record<string, unknown> & { version: string };
const HOST = 'forms.meridian-workplace.com';
const ORIGIN = `https://${HOST}`;
const LINK = 'https://meridian-workplace.com/brochure.pdf';
const DAY = 86_400_000;

/** The Forms add-on: as the add-ons checkout built it, else the engine's own fixture at the version the CRM suggests. */
const built = builtAddOn('forms');
const FORMS = built ?? { key: 'forms', version: '1.0.15', manifest: { ...formsAddOn(), version: '1.0.15' }, files: undefined };
const WHICH = built === null ? 'the engine fixture' : `the built add-on ${built.version}`;

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const en = (value: string) => ({ 'en-US': value });
/** The showroom form, as the builder stores it: every question a column of the enquiry takes. */
const SHOWROOM: FormDefinitionInput = {
  v: 1,
  kind: 'form',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: en('Visit our showroom'),
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, label: en('Your name') },
    { id: 'qcompany', kind: 'short', required: true, label: en('Company') },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, label: en('Work e-mail') },
    { id: 'qtown', kind: 'short', label: en('Town') },
    { id: 'qday', kind: 'date', from: 'tomorrow', label: en('Which day suits you?') },
    { id: 'qsee', kind: 'several', label: en('What would you like to see?'), choices: [{ id: 'booths', label: en('Acoustic booths') }, { id: 'seating', label: en('Seating') }] },
    { id: 'qbrochure', kind: 'one', label: en('Shall we send you our brochure?'), choices: [{ id: 'yes', label: en('Yes, please') }, { id: 'no', label: en('No, thank you') }] },
    { id: 'qnote', kind: 'long', label: en('Anything else?') },
  ],
  ending: { kind: 'words', words: en("We'll be in touch.") },
};

describe.each(LEGS)(`the CRM's website forms and brochure, with ${WHICH} — %s`, (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let formsTable = '';
  let settingsId = 0;
  let stage = 0;
  let company = 0;
  let seq = 0;
  const cookie: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const t = (ref: string) => `crm_${ref}`;
  const tableIds: Record<string, string> = {};

  const as = (who: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { cookie: cookie[who]! }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const data = (ref: string, rest = '') => `/api/v1/data/${h.connectionId}/${tableIds[ref]!}${rest}`;
  const made = (res: { statusCode: number; body: string; json: () => unknown }): number => {
    expect(res.statusCode, res.body).toBe(201);
    return Number((res.json() as { data: { id: number } }).data.id);
  };
  const rows = (statement: string) => h.rows(statement) as Promise<Doc[]>;
  const enquiry = async (email: string): Promise<Doc> => {
    const found = await rows(`SELECT * FROM ${t('enquiries')} WHERE email = '${email}'`);
    expect(found, email).toHaveLength(1);
    return found[0]!;
  };
  const insertForm = async (id: string, slug: string, settings: FormSettingsInput) => {
    const { db } = await h.manager.data(h.connectionId);
    // The built add-on names a form and keeps when it changed; the engine's fixture gives it a title.
    const named = built === null ? { title: slug } : { name: slug, updated_at: dialect === 'mysql' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString() };
    await db.insertInto(formsTable).values({ id, ...named, slug, kind: 'form', state: 'live', definition: '{}', settings: '{}', published: JSON.stringify({ definition: SHOWROOM, settings }) } as never).execute();
  };
  /** A stranger's send: a fresh proof for the form, then the answer, from an address of its own. */
  const send = async (slug: string, values: Record<string, unknown>, from?: string) => {
    seq += 1;
    const remoteAddress = from ?? `198.51.100.${String(seq % 250)}`;
    const challenge = (await composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}/challenge`, remoteAddress, headers: { host: HOST } })).json() as Doc;
    const proof = typeof challenge.salt === 'string' ? `${challenge.id as string}.${solveProof(challenge.salt, challenge.difficulty as number)}` : 'none';
    return composed.app.inject({
      method: 'POST',
      url: `/x/forms/api/${slug}/answers`,
      remoteAddress,
      headers: { host: HOST, origin: ORIGIN, 'x-adminium-proof': proof, 'user-agent': 'Mozilla/5.0 proof' },
      payload: { language: 'en-US', values, query: {}, website: '' },
    });
  };
  const someDay = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
  const answer = (name: string, email: string, brochure: 'yes' | 'no' = 'yes') => ({
    qname: name,
    qcompany: `${name.split(' ')[1]!} Interiors`,
    qemail: email,
    qtown: 'Leeds',
    qday: someDay(5),
    qsee: ['booths', 'seating'],
    qbrochure: brochure,
    qnote: 'Two booths for a quiet floor.',
  });
  /** The mails queued since the last look, opened, and taken off the worker's hands. */
  const mails = async (): Promise<{ to: string; subject: string; html: string; text: string; templateKey: string }[]> => {
    const waiting = await h.meta.db.selectFrom('adminium_jobs').select(['id', 'payload']).where('kind', '=', 'email.send').where('status', '=', 'pending').orderBy('createdAt', 'asc').execute();
    for (const row of waiting) await h.meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
    return waiting.map((row) => {
      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string; templateKey: string };
      return { ...(JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; html: string; text: string }), templateKey: payload.templateKey };
    });
  };
  /** Run what is due now (a rule's run, the outbox's send); with `wait`, also what waits (a rule's two days), as if they were over. */
  const runJobs = async (wait = false) => {
    for (let round = 0; round < 30; round += 1) {
      const all = await mails();
      queued.push(...all);
      let due = h.meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).where('kind', '!=', 'email.send');
      if (!wait) due = due.where('runAt', '<=', Date.now() + 90_000);
      await due.execute();
      if ((await composed.jobs.worker.runOnce()) === 0) break;
    }
    queued.push(...(await mails()));
  };
  const queued: Awaited<ReturnType<typeof mails>> = [];
  const takeMails = () => queued.splice(0, queued.length);
  const followUps = (company: string) => rows(`SELECT owner_id, kind, text, due_at, deal_id, job_id FROM ${t('follow_ups')} WHERE text LIKE '%${company}%'`);
  const setRule = async (enabled: boolean) => {
    const rule = (await automationsRepo(h.meta).listManagedBy('crm', h.connectionId)).find((one) => one.templateKey === 'brochure-asked');
    expect(rule, 'the brochure rule installed').toBeDefined();
    const on = await as('owner', 'PATCH', `/api/v1/automations/${rule!.id}`, { enabled });
    expect(on.statusCode, on.body).toBe(200);
  };
  const setSettings = async (values: Record<string, unknown>) => {
    const res = await as('owner', 'PATCH', data('settings', `/${String(settingsId)}`), { values });
    expect(res.statusCode, res.body).toBe(200);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    // The harness packs text only: the sample's picture bytes do not matter here, its place in the package does.
    const packed = JSON.parse(read('whole/seeds/meridian.json')) as { assets?: Record<string, { file: string; sha256: string }> };
    for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
    await h.stageApp(manifest(), { 'seeds/meridian.json': JSON.stringify(packed), 'seeds/meridian.inventory.json': read('whole/seeds/meridian.inventory.json') });
    const installed = await h.install('crm', manifest().version);
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(FORMS.manifest, { bundled: true, ...(FORMS.files === undefined ? {} : { files: FORMS.files }) });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: FORMS.version, attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    // Vouched for as a bundled package is: its bytes recorded as trusted (a package nobody vouches for serves no form).
    await recordDeciderTrust(h.meta, { key: 'forms', version: FORMS.version, integrity: (await h.addOnStore.verifyTree('forms', FORMS.version)).integrity });
    const tableOf = async (appKey: string, ref: string) => (await h.meta.db.selectFrom('adminium_app_tables').select(['tableName']).where('appKey', '=', appKey).where('ref', '=', ref).executeTakeFirstOrThrow()).tableName;
    formsTable = await tableOf('forms', 'forms');
    const snapshot = await h.meta.db.selectFrom('adminium_schema_snapshots').select(['schema']).where('connectionId', '=', h.connectionId).orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    const schema = (typeof snapshot.schema === 'string' ? JSON.parse(snapshot.schema) : snapshot.schema) as { tables: { id: string; name: string }[] };
    for (const ref of ['enquiries', 'contacts', 'companies', 'settings', 'follow_ups', 'deals', 'stages', 'outbox']) tableIds[ref] = schema.tables.find((table) => table.name === t(ref))!.id;

    const map = { qname: 'person', qcompany: 'company_name', qemail: 'email', qtown: 'town', qday: 'wanted_on', qsee: 'wants', qbrochure: 'brochure', qnote: 'text' };
    const source = { column: 'from_form', value: 'Showroom form' };
    const limits = { perHour: 200, harder: false };
    await insertForm('frm_showroom', 'showroom', { becomes: { table: tableIds['enquiries']!, map, source }, limits });
    await insertForm('frm_state', 'names-state', { becomes: { table: tableIds['enquiries']!, map: { ...map, qnote: 'state' } }, limits });
    await insertForm('frm_claim', 'names-claimed', { becomes: { table: tableIds['enquiries']!, map: { ...map, qnote: 'claimed_by_id' } }, limits });
    await insertForm('frm_deal', 'names-deal', { becomes: { table: tableIds['enquiries']!, map: { ...map, qnote: 'deal_id' } }, limits });

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://meridian-workplace.com/privacy', { updatedBy: null });
    await settings.set('email.smtp', { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Meridian <no-reply@meridian-workplace.com>', secure: false }, { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian-workplace.com', contactPhone: null, shopCountry: 'GB', showLines: false });

    root = await mkdtemp(join(tmpdir(), 'crm-forms-'));
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

    // The people, each signed in: the install's owner, a rep, the marketer, Read-only and the sales manager Settings names.
    const hash = await adminPasswordHash();
    const people: [string, string | null][] = [['owner', null], ['dana', 'rep'], ['lena', 'marketer'], ['grace', 'read-only'], ['ivy', 'sales-manager']];
    for (const [name, role] of people) {
      const user = await usersRepo(h.meta).create({ email: `${name}@meridian-workplace.com`, name: `${name[0]!.toUpperCase()}${name.slice(1)}`, passwordHash: hash });
      const slug = role === null ? 'super-admin' : `crm-${role}`;
      await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
      ids[name] = user.id;
      const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.14.0.${String(people.findIndex(([one]) => one === name) + 1)}`, payload: { email: `${name}@meridian-workplace.com`, password: ADMIN_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      cookie[name] = sessionCookie(login.headers['set-cookie']);
    }
    settingsId = Number((await rows(`SELECT id FROM ${t('settings')}`))[0]!['id']);
    stage = made(await as('owner', 'POST', data('stages'), { values: { label: 'Proposal', odds: 0.5, position: 1 } }));
    company = made(await as('owner', 'POST', data('companies'), { values: { name: 'Cobalt Legal' } }));
    await runJobs(true);
    takeMails();
  }, 600_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)("a stranger's answer makes one enquiry: from a form, open, the form's name on it, stamped by the server, nobody's", async () => {
    // An address already in Contacts, kept as it is.
    made(await as('owner', 'POST', data('contacts'), { values: { company_id: company, name: 'Marta on file', email: 'marta@cobalt-legal.com', may_email: false } }));
    const contactsBefore = await rows(`SELECT * FROM ${t('contacts')} ORDER BY id`);
    const sent = await send('showroom', { ...answer('Marta Kovac', 'marta@cobalt-legal.com', 'no'), qnote: 'Two booths, please.' });
    expect(sent.statusCode, sent.body).toBe(200);
    expect((sent.json() as Doc).state).toBe('sent');
    const row = await enquiry('marta@cobalt-legal.com');
    expect({ source: row['source'], state: row['state'], from_form: row['from_form'], person: row['person'], company_name: row['company_name'], town: row['town'], wants: row['wants'], brochure: row['brochure'], text: row['text'] }).toEqual({
      source: 'form',
      state: 'open',
      from_form: 'Showroom form',
      person: 'Marta Kovac',
      company_name: 'Kovac Interiors',
      town: 'Leeds',
      wants: 'booths, seating',
      brochure: 'no',
      text: 'Two booths, please.',
    });
    expect(String(row['wanted_on']).slice(0, 10)).toBe(someDay(5));
    // The moment it came in is the server's; nobody claimed it, no deal, and no opt-out mark: the form asked with its own tick.
    expect(Math.abs(new Date(String(row['received_at'])).getTime() - Date.now())).toBeLessThan(10 * 60_000);
    expect([row['claimed_by_id'], row['passed_to_id'], row['deal_id'], row['company_id'], row['opt_out_offered_at'], row['brochure_link']]).toEqual([null, null, null, null, null, null]);
    expect(await rows(`SELECT * FROM ${t('contacts')} ORDER BY id`)).toEqual(contactsBefore);
  });

  it.skipIf(!available)('refuses a body naming state, claimed_by_id or deal_id, and a form whose map names one serves nothing', async () => {
    const before = await rows(`SELECT id FROM ${t('enquiries')}`);
    const forged = await send('showroom', { ...answer('Bob Hale', 'bob@hale-interiors.com'), state: 'claimed', claimed_by_id: ids['dana'], deal_id: 1 });
    expect(forged.statusCode).toBe(400);
    expect((forged.json() as Doc).state).toBe('refused');
    for (const slug of ['names-state', 'names-claimed', 'names-deal']) {
      const sent = await send(slug, answer('Bob Hale', 'bob@hale-interiors.com'));
      expect([slug, sent.statusCode, (sent.json() as Doc).state]).toEqual([slug, 404, 'unavailable']);
    }
    expect(await rows(`SELECT id FROM ${t('enquiries')}`)).toEqual(before);
  });

  it.skipIf(!available)('lets a rep, the marketer and Read-only read it, and none of them change where it came from', async () => {
    const id = Number((await enquiry('marta@cobalt-legal.com'))['id']);
    for (const who of ['dana', 'lena', 'grace']) {
      const res = await as(who, 'GET', data('enquiries', `/${String(id)}`));
      expect(res.statusCode, `${who}: ${res.body}`).toBe(200);
      expect((res.json() as Doc).data.from_form, who).toBe('Showroom form');
    }
    for (const who of ['dana', 'ivy']) {
      const changed = await as(who, 'PATCH', data('enquiries', `/${String(id)}`), { values: { from_form: 'Typed by hand', brochure: 'yes' } });
      expect(changed.statusCode, `${who}: ${changed.body}`).toBeGreaterThanOrEqual(400);
    }
    // The day that suits them is a detail the rep may put right.
    expect((await as('dana', 'PATCH', data('enquiries', `/${String(id)}`), { values: { wanted_on: someDay(9) } })).statusCode).toBe(200);
    const row = await enquiry('marta@cobalt-legal.com');
    expect([row['from_form'], row['brochure'], String(row['wanted_on']).slice(0, 10)]).toEqual(['Showroom form', 'no', someDay(9)]);
  });

  it.skipIf(!available)('with the brochure rule off (as shipped), an enquiry that asked gets no mail and no follow-up', async () => {
    await setSettings({ brochure_link: LINK, brochure_follow_up_owner_id: ids['ivy'] });
    expect((await send('showroom', answer('Nell Ortiz', 'nell@ortiz-design.com'))).statusCode).toBe(200);
    await runJobs(true);
    expect(takeMails().filter((mail) => mail.to === 'nell@ortiz-design.com')).toEqual([]);
    expect(await rows(`SELECT id FROM ${t('outbox')} WHERE kind = 'brochure'`)).toEqual([]);
    expect(await followUps('Ortiz')).toEqual([]);
    expect((await enquiry('nell@ortiz-design.com'))['brochure_link']).toBeNull();
  });

  it.skipIf(!available)('switched on: one service mail to the enquirer with the link; two days on, with no deal, a follow-up for the person Settings names', async () => {
    await setRule(true);
    expect((await send('showroom', answer('Ada Brook', 'ada@brook-studio.com'))).statusCode).toBe(200);
    await runJobs();
    const row = await enquiry('ada@brook-studio.com');
    expect(row['brochure_link']).toBe(LINK);
    const outbox = await rows(`SELECT kind, status, enquiry_id FROM ${t('outbox')} WHERE kind = 'brochure'`);
    expect(outbox.map((one) => [one['kind'], Number(one['enquiry_id'])])).toEqual([['brochure', Number(row['id'])]]);
    const sent = takeMails().filter((mail) => mail.templateKey === 'crm-brochure' || mail.to === 'ada@brook-studio.com');
    expect(sent.map((mail) => [mail.to, mail.subject])).toEqual([['ada@brook-studio.com', 'Our brochure']]);
    expect(sent[0]!.text).toContain(LINK);
    // Service mail: no unsubscribe line of a marketing mail.
    expect(sent[0]!.text.toLowerCase()).not.toContain('unsubscribe');
    // Before the two days are out, nothing to ring.
    expect(await followUps('Brook')).toEqual([]);
    await runJobs(true);
    const due = await followUps('Brook');
    expect(due.map((one) => [one['owner_id'], one['kind'], one['deal_id'], one['job_id']])).toEqual([[ids['ivy'], 'chase', null, null]]);
    expect(String(due[0]!['text'])).toBe('Brochure sent 2 days ago: call Brook Interiors');
    expect(new Date(String(due[0]!['due_at'])).getTime()).toBeGreaterThan(Date.now());
    expect(takeMails().filter((mail) => mail.to === 'ada@brook-studio.com')).toEqual([]);
  });

  it.skipIf(!available)('gives the follow-up to whoever claimed the enquiry, and none at all once a deal is made of it', async () => {
    expect((await send('showroom', answer('Kit Marsh', 'kit@marsh-works.com'))).statusCode).toBe(200);
    expect((await send('showroom', answer('Lou Fenn', 'lou@fenn-office.com'))).statusCode).toBe(200);
    await runJobs();
    expect(takeMails().filter((mail) => mail.subject === 'Our brochure').map((mail) => mail.to).sort()).toEqual(['kit@marsh-works.com', 'lou@fenn-office.com']);
    const claim = async (email: string) => {
      const id = Number((await enquiry(email))['id']);
      const res = await as('dana', 'POST', data('enquiries', `/${String(id)}/actions/claim`), { from: 'open' });
      expect(res.statusCode, res.body).toBeLessThan(300);
      return id;
    };
    await claim('kit@marsh-works.com');
    const lou = await claim('lou@fenn-office.com');
    const deal = made(await as('dana', 'POST', data('deals'), { values: { name: 'Fenn office fit-out', company_id: company, owner_id: ids['dana'], stage_id: stage } }));
    const linked = await as('dana', 'PATCH', data('enquiries', `/${String(lou)}`), { values: { deal_id: deal } });
    expect(linked.statusCode, linked.body).toBe(200);
    await runJobs(true);
    expect((await followUps('Marsh')).map((one) => one['owner_id'])).toEqual([ids['dana']]);
    expect(await followUps('Fenn')).toEqual([]);
  });

  it.skipIf(!available)('sends no brochure to an address on the do-not-email list, nor to a person who said no to the newsletter', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    await consent.stop.add({ address: 'max@stopped-studio.com', reason: 'link' });
    await consent.record({ address: 'noa@no-thanks.com', purpose: 'newsletter', source: 'import', state: 'no' });
    expect((await send('showroom', answer('Max Stopped', 'max@stopped-studio.com'))).statusCode).toBe(200);
    expect((await send('showroom', answer('Noa Thanks', 'noa@no-thanks.com'))).statusCode).toBe(200);
    await runJobs();
    expect(takeMails().filter((mail) => mail.to === 'max@stopped-studio.com' || mail.to === 'noa@no-thanks.com')).toEqual([]);
    const said = async (email: string) => {
      const id = Number((await enquiry(email))['id']);
      return (await rows(`SELECT status, error FROM ${t('outbox')} WHERE kind = 'brochure' AND enquiry_id = ${String(id)}`)).map((one) => [one['status'], one['error']]);
    };
    expect(await said('max@stopped-studio.com')).toEqual([['skipped', 'Not sent: on the do-not-email list']]);
    expect(await said('noa@no-thanks.com')).toEqual([['skipped', 'Not sent: they said no to the newsletter']]);
  });

  it.skipIf(!available)('with no brochure link set, sends nothing and still books the follow-up', async () => {
    await setSettings({ brochure_link: null });
    expect((await send('showroom', answer('Rae Quill', 'rae@quill-house.com'))).statusCode).toBe(200);
    await runJobs(true);
    expect(takeMails().filter((mail) => mail.to === 'rae@quill-house.com')).toEqual([]);
    expect((await enquiry('rae@quill-house.com'))['brochure_link']).toBeNull();
    expect((await followUps('Quill')).map((one) => one['owner_id'])).toEqual([ids['ivy']]);
    // An enquiry that did not ask runs nothing.
    expect((await send('showroom', answer('Sol Tarn', 'sol@tarn-rooms.com', 'no'))).statusCode).toBe(200);
    await runJobs(true);
    expect(await followUps('Tarn')).toEqual([]);
  });

  it.skipIf(!available)('takes ten enquiries an hour from one visitor, all forms together, and refuses the eleventh', async () => {
    const visitor = '203.0.113.77';
    const second = { becomes: { table: tableIds['enquiries']!, map: { qname: 'person', qcompany: 'company_name', qemail: 'email' }, source: { column: 'from_form', value: 'Open day form' } }, limits: { perHour: 200, harder: false } };
    await insertForm('frm_open_day', 'open-day', second);
    for (let i = 0; i < 10; i += 1) {
      const res = await send(i % 2 === 0 ? 'showroom' : 'open-day', answer(`Vic Caller${'abcdefghij'[i]!}`, `vic${String(i)}@caller-works.com`, 'no'), visitor);
      expect(res.statusCode, `${String(i)}: ${res.body}`).toBe(200);
    }
    const eleventh = await send('open-day', answer('Vic Callerx', 'vicx@caller-works.com', 'no'), visitor);
    expect(eleventh.statusCode, eleventh.body).toBe(429);
    expect(await rows(`SELECT id FROM ${t('enquiries')} WHERE email = 'vicx@caller-works.com'`)).toEqual([]);
    // Another visitor is not held by it.
    expect((await send('open-day', answer('Wyn Other', 'wyn@other-works.com', 'no'), '203.0.113.78')).statusCode).toBe(200);
  });
});
