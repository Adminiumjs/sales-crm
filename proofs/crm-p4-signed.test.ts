// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 68, S13: E-MAIL 17'S SIGNED COPY AS A PDF, AND ITS TICKS, against the
 * whole server on SQLite, Postgres and MySQL, each try made signed in as the
 * person it is about.
 *
 *  - The crew's phone writes what the customer was shown WITH the sign-off:
 *    the job's open snags (`snags_at_signing`, a JSON list) and the five
 *    checks' words (`check_words`). On create only: neither the crew nor the
 *    office changes them after; another crew makes no sign-off of the job;
 *    the list is held to its length.
 *  - E-mail 17 names no job code; says the day it was signed; prints the five
 *    answers as Yes/No (E15); lists what is still to put right, and "Nothing
 *    was left to put right." when nothing is. Without the copy (no Invoices
 *    & Receipts) it goes as text, without the line that says it is attached.
 *  - With Invoices & Receipts (`ADD_ONS_REPO`, built): an Invoices that does
 *    not draw the kind yet (1.0.13) leaves the copy WAITING (E22): the app
 *    says so, the mail goes without it, the office's door has none. One that
 *    draws it: the mail carries a PDF named after the work (never the code),
 *    the office downloads it, a reader without the sign-off gets none, and a
 *    customer in Arabic gets no PDF.
 *
 * The screens: `e2e/crew-signoff.e2e.ts`, `e2e/offline-queue.e2e.ts`, `e2e/jobs-office.e2e.ts`.
 *
 * To run: `ADD_ONS_REPO=… npm run proofs -- p4-signed`.
 */
import { readFileSync } from 'node:fs';

import { documentProfilesRepo, filesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { decryptSecret } from '../src/config/secrets.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { TEST_SECRET } from './helpers.js';
import { packageTarball } from './app-bundle-helpers.js';
import { builtAddOn } from './add-ons/harness.js';
import { png } from './picture-images.js';
import { LEGS, said, wholeServer, type QueuedEmail, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.38' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const invoices = builtAddOn('invoices');
const DAY = 86_400_000;
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ANA = 'ana.belova@fernway-clinics.com';
const OFFICE = '0113 496 0100';
const WORDS = ['Everything on the list is on site', 'Nothing damaged, nothing marked', 'Keys and spares handed over', 'Floor left as we found it', 'Shown them how it works'];
type Attachment = { fileId: string; filename: string };
type Mail = QueuedEmail & { attachments?: Attachment[] };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's signed copy and e-mail 17, on ${dialect}`, () => {
    let s: WholeServer;
    let stage = 0;
    let company = 0;
    let contact = 0;
    const crew: Record<string, number> = {};
    let n = 0;

    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const row = async (who: string, ref: string, id: number): Promise<Record<string, unknown> | null> => {
      const res = await s.get(who, url(ref, `/${String(id)}`));
      return res.statusCode === 200 ? (res.json() as { data: Record<string, unknown> }).data : null;
    };
    const act = (who: string, ref: string, id: number, action: string, from: string, values?: Record<string, unknown>): Promise<Reply> =>
      s.send(who, 'POST', url(ref, `/${String(id)}/actions/${action}`), { from, ...(values === undefined ? {} : { values }) });
    const day = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
    const jobs = (): Promise<void> => s.jobs({ except: ['digest.send'] });
    const upload = async (who: string, column: string): Promise<string> => {
      const query = new URLSearchParams({ connectionId: s.connectionId, table: s.t('sign_offs'), column, filename: `${column}.png` });
      const res = await s.app.inject({ method: 'POST', url: `/api/v1/files?${query.toString()}`, headers: { cookie: s.cookie[who]!, 'content-type': 'image/png' }, payload: png().bytes });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string } }).data.id;
    };
    /** A won deal's job, and a visit of the blue crew to it, booked: what a crew signs off. */
    const jobFor = async (name: string, crewName = 'blue'): Promise<{ job: number; visit: number; code: string }> => {
      const deal = made(await s.make('dana', 'deals', { name, company_id: company, contact_id: contact, owner_id: s.ids['dana'], stage_id: stage }));
      expect(said(await act('dana', 'deals', deal, 'mark-won', 'open'))).toBe('ok');
      await jobs();
      const found = await s.rows(`select id, code from crm_jobs where deal_id = ${String(deal)}`);
      expect(found, `the rule makes the job of "${name}"`).toHaveLength(1);
      const job = Number(found[0]!['id']);
      expect(said(await s.change('ada', 'jobs', job, { site_name: `${name} site` }))).toBe('ok');
      const visit = made(await s.make('ada', 'job_visits', { job_id: job, kind: 'install', what: name, hours: 3, crew_size: 1 }));
      expect(said(await s.change('ada', 'job_visits', visit, { day: day(0), start_time: '08:00', crew_id: crew[crewName] }))).toBe('ok');
      expect(said(await act('ada', 'job_visits', visit, 'book', 'waiting'))).toBe('ok');
      return { job, visit, code: String(found[0]!['code']) };
    };
    /**
     * A sign-off carrying what its screen showed the customer: the crew's phone makes it by its visit (one create, with a
     * key); the office by the job. The mail's proofs use the office's: see the engine gap below.
     */
    const signOff = async (who: string, at: { visit: number; job: number }, open: { what: string; by: string; note: string }[], checks: boolean[] = [true, true, true, true, true]) => {
      n += 1;
      const values: Record<string, unknown> = { signer_name: 'Ana Belova', signature: await upload(who, 'signature'), snags_at_signing: JSON.stringify(open), check_words: WORDS.join('\n') };
      checks.forEach((on, i) => (values[`check_${String(i + 1)}`] = on));
      if (who === 'ada') return s.make('ada', 'sign_offs', { ...values, job_id: at.job });
      return s.send(who, 'POST', url('sign_offs'), { values: { ...values, visit_id: at.visit }, clientKey: `SignedCopyProofKey${String(n).padStart(16, '0')}` });
    };
    /** The signed-copy mails of a job's title, each with the attachments its queued job carries beside the sealed body. */
    const mailsOf = async (title: string): Promise<Mail[]> => {
      const mails = ((await s.emails()) as Mail[]).filter((mail) => mail.templateKey === 'crm-signed-copy' && mail.subject.endsWith(title));
      const queued = await s.meta.db.selectFrom('adminium_jobs').select(['payload']).where('kind', '=', 'email.send').execute();
      const carried = new Map<string, Attachment[]>();
      for (const job of queued) {
        const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string; attachments?: Attachment[] };
        const subject = (JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { subject: string }).subject;
        carried.set(subject, payload.attachments ?? []);
      }
      return mails.map((mail) => ({ ...mail, attachments: carried.get(mail.subject) ?? mail.attachments ?? [] }));
    };
    const whole = (mail: Mail): string => `${mail.subject}\n${mail.text}\n${mail.html}`;

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { dana: ['rep'], tessa: ['admin'], ada: ['ops-manager'], lena: ['marketer'], yusuf: ['crew'], rina: ['crew'] },
        smtp: true,
        install: { modules: { jobs: true } },
      });
      stage = made(await s.make('owner', 'stages', { label: 'Proposal', odds: 0.5, position: 3 }));
      company = made(await s.make('owner', 'companies', { name: 'Fernway Clinics' }));
      contact = made(await s.make('owner', 'contacts', { company_id: company, name: 'Ana Belova', email: ANA, may_email: true }));
      for (const [name, person] of [['blue', 'yusuf'], ['red', 'rina']] as const) {
        crew[name] = made(await s.make('ada', 'crews', { name: `${name} crew` }));
        made(await s.make('ada', 'crew_members', { crew_id: crew[name], user_id: s.ids[person], lead: true }));
        for (const weekday of WEEK) made(await s.make('ada', 'crew_days', { crew_id: crew[name], weekday }));
      }
      const settingsId = Number((await s.rows('select id from crm_settings'))[0]!['id']);
      expect(said(await s.change('tessa', 'settings', settingsId, { office_phone: OFFICE }))).toBe('ok');
      await jobs();
    }, 300_000);
    afterAll(async () => {
      await s?.close();
    });

    it('lets the crew write what the customer was shown with the sign-off, and nobody change it after; another crew makes none', async () => {
      const at = await jobFor('Ward corridor seating');
      const { job } = at;
      const open = [{ what: 'Edge trim lifting on the small table', by: day(6), note: '' }, { what: 'Wrong castors on two of the chairs', by: day(2), note: 'Right castors go out on Thursday.' }];
      // Red's crew member: not his crew's visit, so no sign-off of it at all.
      expect((await signOff('rina', at, open)).statusCode).toBe(409);
      // Over the list's bound: refused, nothing made.
      const long = Array.from({ length: 60 }, (_, i) => ({ what: `Snag ${String(i)} ${'x'.repeat(380)}`, by: day(1), note: '' }));
      expect((await signOff('yusuf', at, long)).statusCode).toBe(422);
      expect(await s.rows(`select id from crm_sign_offs where job_id = ${String(job)}`)).toHaveLength(0);
      // His own crew's: made, with both, as written.
      const id = made(await signOff('yusuf', at, open));
      const kept = await row('tessa', 'sign_offs', id);
      expect(JSON.parse(String(kept?.['snags_at_signing']))).toEqual(open);
      expect(String(kept?.['check_words']).split('\n')).toEqual(WORDS);
      // Nobody he works with, nor the office, changes what was signed.
      for (const who of ['yusuf', 'ada']) {
        for (const values of [{ snags_at_signing: '[]' }, { check_words: 'Something else' }]) expect((await s.change(who, 'sign_offs', id, values)).statusCode, `${who} ${Object.keys(values)[0]!}`).toBeGreaterThanOrEqual(403);
      }
      const again = await row('tessa', 'sign_offs', id);
      expect([again?.['snags_at_signing'], again?.['check_words']]).toEqual([kept?.['snags_at_signing'], kept?.['check_words']]);
      // Nobody else of the sales side writes a sign-off at all.
      expect((await s.make('dana', 'sign_offs', { job_id: job, signer_name: 'D', snags_at_signing: '[]' })).statusCode).toBe(403);
    });

    it('mails e-mail 17 with no job code: the day it was signed, the five answers as Yes/No, and what is still to put right', async () => {
      await s.emails();
      const at = await jobFor('Clinic reception desk');
      const { job, code } = at;
      made(await s.make('ada', 'snags', { job_id: job, text: 'Edge trim lifting on the small table', stops_sign_off: false }));
      const fixed = made(await s.make('ada', 'snags', { job_id: job, text: 'Paint scuffed by the lift door', stops_sign_off: false }));
      expect(said(await act('ada', 'snags', fixed, 'put-right', 'open', { put_right_note: 'Touched up' }))).toBe('ok');
      made(await signOff('ada', at, [{ what: 'Edge trim lifting on the small table', by: day(6), note: '' }], [true, true, true, true, false]));
      await jobs();
      const [mail, ...more] = await mailsOf('Clinic reception desk');
      expect(more).toEqual([]);
      expect(mail?.to).toBe(ANA);
      const text = mail!.text;
      expect(text).toContain('thank you for signing off Clinic reception desk on ');
      // Each check by its words, answered as the reader says it.
      for (const words of WORDS.slice(0, 4)) expect(text).toMatch(new RegExp(`${words}[^\\n]*\\bYes\\b`));
      expect(text).toMatch(/Shown them how it works[^\n]*\bNo\b/);
      expect(text).not.toMatch(/\b(true|false)\b/);
      // What is still to put right, by its day; not what was put right.
      expect(text).toContain('Edge trim lifting on the small table');
      expect(text).not.toContain('Paint scuffed by the lift door');
      expect(text).toContain(OFFICE);
      // The job's code is internal: in no part of the mail.
      expect(whole(mail!)).not.toContain(code);
      expect(`${mail!.subject} ${text}`).not.toMatch(/\{\{/);
      // Nothing left: said so.
      const empty = await jobFor('Day-room chairs');
      made(await signOff('ada', empty, []));
      await jobs();
      const [quiet] = await mailsOf('Day-room chairs');
      expect(quiet!.text).toContain('Nothing was left to put right.');
    });

    it('sends it as text without Invoices & Receipts: no attachment, and not the line that says one is attached', async () => {
      await s.emails();
      made(await signOff('ada', await jobFor('Theatre trolleys'), []));
      await jobs();
      const box = await s.rows(`select status, error from crm_outbox where kind = 'signed-copy' order by id desc`);
      expect(['sent', 'queued'], String(box[0]?.['error'])).toContain(box[0]?.['status']);
      const [mail] = await mailsOf('Theatre trolleys');
      expect(mail!.attachments ?? []).toEqual([]);
      expect(mail!.text).not.toContain('Your signed copy is attached.');
    });

    /*
     * A sign-off made by its visit, as every crew phone makes one, queues e-mail 17. (Before the engine's fix, plan-68-engine
     * a44395400, the outbox's producer filled its `visit_id` link, a sales visit, from the sign-off's `visit_id`, a job
     * visit, because the names matched: the insert was refused and the mail dropped without a word.)
     */
    it('mails e-mail 17 for the crew\'s own sign-off, made by its visit', async () => {
      await s.emails();
      made(await signOff('yusuf', await jobFor('Canteen benches'), []));
      await jobs();
      expect(await s.rows(`select id from crm_outbox where kind = 'signed-copy' and job_id = (select max(id) from crm_jobs)`)).toHaveLength(1);
    });

    describe.skipIf(invoices === null)('with Invoices & Receipts attached', () => {
      /** Whether the Invoices given draws the signed copy: its profile is made for the app. */
      let draws = false;
      beforeAll(async () => {
        const files: Record<string, string> = { 'manifest.json': JSON.stringify(invoices!.manifest), ...invoices!.files };
        const bytes = packageTarball(files);
        const staged = await s.app.inject({ method: 'POST', url: `/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(sha512Integrity(bytes))}`, headers: { cookie: s.cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(bytes) });
        expect(staged.statusCode, staged.body).toBeLessThan(300);
        const attached = await s.send('owner', 'POST', '/api/v1/add-ons', { key: 'invoices', version: invoices!.version, attachTo: ['crm'], connectionId: s.connectionId });
        expect(attached.statusCode, attached.body).toBe(200);
        draws = (await documentProfilesRepo(s.meta).listOwnedBy(s.connectionId, 'crm')).some((profile) => profile.kind === 'signed-copy');
      }, 300_000);

      const render = (who: string, id: number): Promise<Reply> => s.send(who, 'POST', '/api/v1/apps/crm/documents/render', { kind: 'signed-copy', ref: 'sign_offs', pk: { id } });

      it('leaves the signed copy waiting while Invoices does not draw it (1.0.13): said, the mail goes without it, the office has none', async () => {
        if (draws) return;
        // Invoices is attached and on, and draws no "signed-copy": the copy waits (E22), the app is installed all the same.
        const kinds = await s.get('owner', '/api/v1/documents/kinds');
        expect(kinds.statusCode, kinds.body).toBe(200);
        const drawnBy = (kinds.json() as { kinds: { addOnKey: string; kind: string }[] }).kinds.filter((one) => one.addOnKey === 'invoices').map((one) => one.kind);
        expect(drawnBy.length).toBeGreaterThan(0);
        expect(drawnBy).not.toContain('signed-copy');
        await s.emails();
        const id = made(await signOff('ada', await jobFor('Waiting-room chairs'), []));
        await jobs();
        const [mail] = await mailsOf('Waiting-room chairs');
        expect(mail, 'the mail goes all the same').toBeDefined();
        expect(mail!.attachments ?? []).toEqual([]);
        expect(mail!.text).not.toContain('Your signed copy is attached.');
        expect((await render('ada', id)).statusCode).toBeGreaterThanOrEqual(400);
      });

      it('carries the PDF named after the work, which the office downloads and a reader without the sign-off cannot; Arabic gets no PDF', async () => {
        if (!draws) return;
        await s.emails();
        const at = await jobFor('Studio meeting tables');
        const { code } = at;
        const id = made(await signOff('ada', at, [{ what: 'Edge trim lifting on the small table', by: day(6), note: '' }]));
        await jobs();
        const [mail] = await mailsOf('Studio meeting tables');
        const box = await s.rows(`select status, error from crm_outbox where sign_off_id = ${String(id)}`);
        expect(box[0]?.['status'], String(box[0]?.['error'])).toBe('sent');
        expect(mail!.attachments, mail!.text).toHaveLength(1);
        const attached = mail!.attachments![0]!;
        expect(attached.filename).toMatch(/^signed-copy-.*\.pdf$/i);
        expect(attached.filename.toLowerCase()).toContain('studio');
        expect(attached.filename).not.toContain(code);
        const file = await filesRepo(s.meta).findById(attached.fileId);
        expect(file?.mime).toBe('application/pdf');
        expect(mail!.text).toContain('Your signed copy is attached.');
        // The office: the copy the mail carried, as a PDF, to download.
        const drawn = await render('ada', id);
        expect(drawn.statusCode, drawn.body).toBeLessThan(300);
        const reply = drawn.json() as { contentUrl: string; document: { format: string } };
        expect(reply.document.format).toBe('pdf');
        const bytes = await s.get('ada', reply.contentUrl);
        expect([bytes.statusCode, bytes.headers['content-type']]).toEqual([200, 'application/pdf']);
        expect(bytes.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        const head = await s.app.inject({ method: 'HEAD', url: reply.contentUrl, headers: { cookie: s.cookie['ada']! } });
        expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
        // A reader who does not reach the sign-off: no copy, by either door.
        for (const who of ['lena', 'rina']) {
          expect((await render(who, id)).statusCode, who).toBeGreaterThanOrEqual(403);
          expect((await s.get(who, reply.contentUrl)).statusCode, who).toBeGreaterThanOrEqual(403);
        }
        // A customer whose mail is in Arabic: no PDF (its words cannot be set in one).
        const ar = await jobFor('Glass partitions');
        await s.jobs({ except: ['digest.send', 'app-outbox-send'] });
        const arId = made(await signOff('ada', ar, []));
        await s.jobs({ except: ['digest.send', 'app-outbox-send'] });
        await s.rows(`update crm_outbox set language = 'ar-EG' where sign_off_id = ${String(arId)}`);
        await jobs();
        const [arabic] = await mailsOf('Glass partitions');
        expect(arabic, 'the Arabic mail goes').toBeDefined();
        for (const one of arabic!.attachments ?? []) expect(one.filename.toLowerCase().endsWith('.pdf'), one.filename).toBe(false);
        const arDrawn = await render('ada', arId);
        expect(arDrawn.statusCode, arDrawn.body).toBeLessThan(300);
        console.info(`[signed copy, Arabic, ${dialect}] attachments: ${JSON.stringify(arabic!.attachments ?? [])}; office render: ${(arDrawn.json() as { document: { format: string; locale: string } }).document.format}`);
      });
    });
  });
}
