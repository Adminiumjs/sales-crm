// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 67, stage 2: THE FIELD CREW'S PHONE (P22), against the whole server on
 * SQLite, Postgres and MySQL, with the app's own manifest and Jobs on site
 * switched on, each try made signed in as the person it is about.
 *
 * Signed in as a crew member (Yusuf, Blue crew, with Cal; Rina is Red crew):
 *
 *  - he reads his crew's visits, snags and sign-offs, and another crew's are
 *    not there by any door: a record, a list, a figure, its history, search;
 *    he reads no job at all, and exports nothing;
 *  - he reads no amount of a deal, a quote or a job by any door: the tables
 *    refuse him, a lookup through his visit to the job's deal comes back
 *    masked, a figure over them is refused, search finds no deal;
 *  - he signs off only his crew's job, and not while a snag that stops it is
 *    open (the sign-off's link to its job names only a job no such snag
 *    holds); one create with a retry key is one sign-off, sent twice; he may
 *    not change or remove a sign-off;
 *  - he names only his own fresh upload: a crew-mate's file, or a file a
 *    record already holds, is refused; a file a record holds cannot be thrown
 *    away (`FILE_HELD`); his own that no record holds can;
 *  - he ticks only his crew's visits, and nothing of a visit but its ticks;
 *  - he raises and puts right snags of his crew's visits only.
 *
 * The screens, as he is answered, are on the browser stand: `e2e/crew-*.e2e.ts`.
 *
 * To run: `npm run proofs -- crew` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { png } from './picture-images.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.30' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const DAY = 86_400_000;
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const CHECKS = { check_1: true, check_2: true, check_3: true, check_4: true, check_5: true };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's field crew on his phone, on ${dialect}`, () => {
    let s: WholeServer;
    let stage = 0;
    let company = 0;
    let contact = 0;
    const crew: Record<string, number> = {};
    /** Blue's job and visit, Red's job and visit, a snag on each, and Red's job signed off by the office. */
    const at = { blueJob: 0, blueVisit: 0, redJob: 0, redVisit: 0, blueSnag: 0, redSnag: 0, redSignOff: 0, deal: 0 };

    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const ids = async (who: string, ref: string): Promise<number[]> => {
      const res = await s.get(who, url(ref, '?limit=200'));
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { id: number }[] }).data.map((row) => Number(row.id));
    };
    const one = (who: string, ref: string, id: number): Promise<Reply> => s.get(who, url(ref, `/${String(id)}`));
    const figure = (who: string, ref: string, aggregations: unknown[] = [{ fn: 'count', alias: 'n' }]): Promise<Reply> =>
      s.send(who, 'POST', '/api/v1/widget-data/query', { descriptor: { connectionId: s.connectionId, source: { name: s.t(ref) }, shape: 'single-metric', aggregations } });
    const valueOf = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(200);
      return Number((res.json() as { result: { value?: number } }).result.value ?? 0);
    };
    const act = (who: string, ref: string, id: number, action: string, from: string, values?: Record<string, unknown>): Promise<Reply> =>
      s.send(who, 'POST', url(ref, `/${String(id)}/actions/${action}`), { from, ...(values === undefined ? {} : { values }) });
    const upload = async (who: string, ref: string, column: string): Promise<string> => {
      const query = new URLSearchParams({ connectionId: s.connectionId, table: s.t(ref), column, filename: `${column}.png` });
      const res = await s.app.inject({ method: 'POST', url: `/api/v1/files?${query.toString()}`, headers: { cookie: s.cookie[who]!, 'content-type': 'image/png' }, payload: png().bytes });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string } }).data.id;
    };
    const day = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
    const jobs = (): Promise<void> => s.jobs({ except: ['digest.send'] });
    /** A deal of Dana's, won: the app's rule makes its job. */
    const wonJob = async (name: string): Promise<{ deal: number; job: number }> => {
      const deal = made(await s.make('dana', 'deals', { name, company_id: company, contact_id: contact, owner_id: s.ids['dana'], stage_id: stage, typed_amount: 48_000 }));
      expect(said(await act('dana', 'deals', deal, 'mark-won', 'open'))).toBe('ok');
      await jobs();
      const found = await s.rows(`select id from crm_jobs where deal_id = ${String(deal)}`);
      expect(found, `the rule makes the job of "${name}"`).toHaveLength(1);
      return { deal, job: Number(found[0]!['id']) };
    };
    /** A visit of a crew to a job, booked by the operations manager. */
    const visit = async (job: number, what: string, crewName: string, kind = 'install'): Promise<number> => {
      const id = made(await s.make('ada', 'job_visits', { job_id: job, kind, what, hours: 3, crew_size: 2 }));
      expect(said(await s.change('ada', 'job_visits', id, { day: day(1), start_time: '08:00', crew_id: crew[crewName] }))).toBe('ok');
      expect(said(await act('ada', 'job_visits', id, 'book', 'waiting'))).toBe('ok');
      return id;
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { dana: ['rep'], tessa: ['admin'], ada: ['ops-manager'], yusuf: ['crew'], cal: ['crew'], rina: ['crew'] },
        install: { modules: { jobs: true } },
      });
      stage = made(await s.make('owner', 'stages', { label: 'Proposal', odds: 0.5, position: 3 }));
      company = made(await s.make('owner', 'companies', { name: 'Tandem Robotics' }));
      contact = made(await s.make('owner', 'contacts', { company_id: company, name: 'Yusuf Demir', email: 'yusuf.demir@tandem.example', may_email: true }));
      for (const [name, people] of [['blue', ['yusuf', 'cal']], ['red', ['rina']]] as const) {
        crew[name] = made(await s.make('ada', 'crews', { name: `${name} crew` }));
        for (const [i, person] of people.entries()) made(await s.make('ada', 'crew_members', { crew_id: crew[name], user_id: s.ids[person], lead: i === 0 }));
        for (const weekday of WEEK) made(await s.make('ada', 'crew_days', { crew_id: crew[name], weekday }));
      }
      const blue = await wonJob('Test-floor workbenches');
      const red = await wonJob('Warehouse desks');
      at.deal = blue.deal;
      at.blueJob = blue.job;
      at.redJob = red.job;
      expect(said(await s.change('ada', 'jobs', at.blueJob, { site_name: 'Tandem Robotics', ask_for: 'Yusuf Demir', site_phone: '01223 47 1108', access_note: 'Sign in at reception.' }))).toBe('ok');
      at.blueVisit = await visit(at.blueJob, 'Test-floor workbenches', 'blue');
      at.redVisit = await visit(at.redJob, 'Warehouse desks', 'red');
      at.blueSnag = made(await s.make('ada', 'snags', { visit_id: at.blueVisit, text: 'Cable trays short by two metres', stops_sign_off: true }));
      at.redSnag = made(await s.make('ada', 'snags', { visit_id: at.redVisit, text: 'A screen marked in transit', stops_sign_off: false }));
      at.redSignOff = made(await s.make('ada', 'sign_offs', { visit_id: at.redVisit, ...CHECKS, signer_name: 'Petra Lindqvist' }));
    }, 300_000);
    afterAll(async () => {
      await s?.close();
    });

    it("lets him read his crew's visits, snags and sign-offs, and no other crew's by any door; no job at all, and no export", async () => {
      // Lists: his crew's rows only. Records of Red's: not there, as a row that does not exist.
      expect(await ids('yusuf', 'job_visits')).toEqual([at.blueVisit]);
      expect(await ids('yusuf', 'snags')).toEqual([at.blueSnag]);
      expect(await ids('yusuf', 'sign_offs')).toEqual([]);
      for (const [ref, id] of [['job_visits', at.redVisit], ['snags', at.redSnag], ['sign_offs', at.redSignOff]] as const) {
        const theirs = await one('yusuf', ref, id);
        expect(theirs.statusCode, `${ref} ${String(id)}`).toBe(404);
        expect((await one('yusuf', ref, 999_999)).statusCode).toBe(404);
        expect((await s.get('yusuf', url(ref, `/${String(id)}/history`))).statusCode, `${ref} history`).toBe(404);
      }
      // Red crew reads Red's and not Blue's: the same rule the other way.
      expect(await ids('rina', 'job_visits')).toEqual([at.redVisit]);
      expect(await ids('rina', 'sign_offs')).toEqual([at.redSignOff]);
      // Figures are his rows' only.
      expect(valueOf(await figure('yusuf', 'job_visits'))).toBe(1);
      expect(valueOf(await figure('yusuf', 'job_visits', [{ fn: 'sum', column: 'hours', alias: 'h' }]))).toBe(3);
      expect(valueOf(await figure('yusuf', 'snags'))).toBe(1);
      expect(valueOf(await figure('yusuf', 'sign_offs'))).toBe(0);
      // Search finds his visit, and nothing of Red's.
      const found = await s.get('yusuf', `/api/v1/search?q=${encodeURIComponent('Warehouse')}`);
      expect(found.statusCode, found.body).toBe(200);
      expect(JSON.stringify(found.json())).not.toContain('Warehouse');
      // The jobs table is not his by any door.
      expect((await s.get('yusuf', url('jobs', '?limit=5'))).statusCode).toBe(403);
      expect((await one('yusuf', 'jobs', at.blueJob)).statusCode).toBe(403);
      expect((await figure('yusuf', 'jobs')).statusCode).toBe(403);
      // He exports nothing, not even his own visits.
      for (const ref of ['job_visits', 'sign_offs', 'snags', 'jobs']) {
        const asked = await s.send('yusuf', 'POST', '/api/v1/exports', { connectionId: s.connectionId, source: { kind: 'table', table: s.t(ref) }, format: 'csv' });
        expect(asked.statusCode, `${ref} export: ${asked.body}`).toBe(403);
      }
    });

    it('lets him read no amount of a deal, a quote or a job, by any door', async () => {
      // Quotes' tables are there only with the Invoices add-on, which this server does not have: `crm-roles` reads them as the
      // crew, with Invoices attached, and he reads none (its matrix's `-`).
      const present = (ref: string): boolean => {
        try {
          return s.t(ref) !== '';
        } catch {
          return false;
        }
      };
      for (const ref of ['deals', 'quotes', 'quote_lines', 'jobs', 'deal_amount_changes', 'price_list'].filter(present)) {
        expect((await s.get('yusuf', url(ref, '?limit=5'))).statusCode, ref).toBe(403);
        expect((await figure('yusuf', ref)).statusCode, `${ref} figure`).toBe(403);
      }
      expect((await one('yusuf', 'deals', at.deal)).statusCode).toBe(403);
      // Through his own visit, a lookup to the job's deal and its amount comes back masked.
      const looked = await s.get('yusuf', url('job_visits', `/${String(at.blueVisit)}?lookup=amount:job_id.deal_id.amount&lookup=typed:job_id.deal_id.typed_amount&lookup=code:job_id.code`));
      expect(looked.statusCode, looked.body).toBe(200);
      const row = (looked.json() as { data: Record<string, unknown> }).data;
      expect([row['amount'] ?? null, row['typed'] ?? null, row['code'] ?? null]).toEqual([null, null, null]);
      expect(row['_masked']).toEqual(expect.arrayContaining(['amount', 'typed', 'code']));
      // A figure on his visits grouped by the deal's amount through the job: refused or no amount in it.
      const grouped = await s.send('yusuf', 'POST', '/api/v1/widget-data/query', { descriptor: { connectionId: s.connectionId, source: { name: s.t('job_visits') }, shape: 'categorical', groupBy: ['job_id'], groupLabel: 'job_id.deal_id.amount', aggregations: [{ fn: 'count', alias: 'n' }] } });
      expect(grouped.body).not.toContain('48000');
      // Search names no deal of his crew's job.
      const found = await s.get('yusuf', `/api/v1/search?q=${encodeURIComponent('Test-floor')}`);
      expect(found.statusCode).toBe(200);
      expect(JSON.stringify(found.json())).not.toContain(s.t('deals'));
      expect(JSON.stringify(found.json())).not.toContain('48000');
      // Nothing he reads holds an amount: not his visit, its history, his snag.
      expect(JSON.stringify((await one('yusuf', 'job_visits', at.blueVisit)).json())).not.toContain('48000');
      expect((await s.get('yusuf', url('job_visits', `/${String(at.blueVisit)}/history`))).body).not.toContain('48000');
    });

    it("lets him sign off his crew's job only, not while a snag stops it, once for one key; and change or remove no sign-off", async () => {
      const key = 'CrewProofSignOffKey000000000000001';
      const signature = await upload('yusuf', 'sign_offs', 'signature');
      const photo = await upload('yusuf', 'sign_offs', 'photos');
      const body = { values: { visit_id: at.blueVisit, ...CHECKS, signer_name: 'Yusuf Demir', signature, photos: [photo] }, clientKey: key };
      // While "Cable trays short" stops it: refused, as the link to a job no stopping snag holds; nothing is made.
      const stopped = await s.send('yusuf', 'POST', url('sign_offs'), body);
      expect(stopped.statusCode, stopped.body).toBe(422);
      expect((stopped.json() as { error: { details: { fields: Record<string, { code: string }> } } }).error.details.fields['job_id']?.code).toBe('not-allowed');
      expect(await s.rows(`select id from crm_sign_offs where job_id = ${String(at.blueJob)}`)).toHaveLength(0);
      // The office's own sign-off is held to the same: the server's rule, not the phone's.
      expect((await s.make('ada', 'sign_offs', { job_id: at.blueJob, ...CHECKS, signer_name: 'Office' })).statusCode).toBe(422);
      // Red's visit is not his to sign off; a job he names himself is not his to write.
      expect((await s.send('yusuf', 'POST', url('sign_offs'), { values: { visit_id: at.redVisit, ...CHECKS, signer_name: 'X' } })).statusCode).toBe(409);
      expect((await s.make('yusuf', 'sign_offs', { job_id: at.redJob, ...CHECKS, signer_name: 'X' })).statusCode).toBe(403);
      // Put right, the same create goes through, once: sent again with the same key, it answers the same row.
      expect(said(await act('ada', 'snags', at.blueSnag, 'put-right', 'open', { put_right_note: 'Two more metres fitted' }))).toBe('ok');
      const first = made(await s.send('yusuf', 'POST', url('sign_offs'), body));
      const again = await s.send('yusuf', 'POST', url('sign_offs'), body);
      expect(again.statusCode, again.body).toBeLessThan(300);
      expect([Number((again.json() as { data: { id: number } }).data.id), (again.json() as { replayed?: boolean }).replayed]).toEqual([first, true]);
      expect(await s.rows(`select id from crm_sign_offs where job_id = ${String(at.blueJob)}`)).toHaveLength(1);
      const kept = (await one('yusuf', 'sign_offs', first)).json() as { data: Record<string, unknown> };
      expect([kept.data['signature'], kept.data['job_id']]).toEqual([signature, at.blueJob]);
      const photos = typeof kept.data['photos'] === 'string' ? (JSON.parse(kept.data['photos']) as unknown) : kept.data['photos'];
      expect(photos).toEqual([photo]);
      // Nobody of the crew changes it or takes it away; nor does Cal, his crew-mate.
      for (const who of ['yusuf', 'cal']) {
        expect((await s.change(who, 'sign_offs', first, { signer_name: 'Somebody else' })).statusCode, who).toBeGreaterThanOrEqual(403);
        expect((await s.send(who, 'DELETE', url('sign_offs', `/${String(first)}?confirm=true`))).statusCode, who).toBeGreaterThanOrEqual(403);
      }
      // A second sign-off of the same job (a new key): refused, one a job.
      expect((await s.send('cal', 'POST', url('sign_offs'), { values: { visit_id: at.blueVisit, ...CHECKS, signer_name: 'Yusuf Demir' }, clientKey: 'CrewProofSignOffKey000000000000002' })).statusCode).toBe(409);
      // Cal reads the sign-off his crew made; Rina does not.
      expect((await one('cal', 'sign_offs', first)).statusCode).toBe(200);
      expect((await one('rina', 'sign_offs', first)).statusCode).toBe(404);
    });

    it("lets him name only his own fresh upload: never a crew-mate's, never one a record holds; a held file cannot be thrown away", async () => {
      const { job } = await wonJob('Studio meeting tables');
      const visitId = await visit(job, 'Studio meeting tables', 'blue');
      const cals = await upload('cal', 'sign_offs', 'signature');
      const refused = await s.send('yusuf', 'POST', url('sign_offs'), { values: { visit_id: visitId, ...CHECKS, signer_name: 'Marta Kovac', signature: cals }, clientKey: 'CrewProofFilesKey00000000000000001' });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.body).toContain('file-not-here');
      // Nor may he throw Cal's away; Cal may, since no record holds it.
      expect((await s.send('yusuf', 'DELETE', `/api/v1/files/${cals}`)).statusCode).toBeGreaterThanOrEqual(403);
      expect((await s.send('cal', 'DELETE', `/api/v1/files/${cals}`)).statusCode).toBeLessThan(300);
      // A file the first sign-off holds: refused to his second, and kept from the file routes (FILE_HELD).
      const held = (await s.rows(`select signature from crm_sign_offs where job_id = ${String(at.blueJob)}`))[0]!['signature'] as string;
      const named = await s.send('yusuf', 'POST', url('sign_offs'), { values: { visit_id: visitId, ...CHECKS, signer_name: 'Marta Kovac', signature: held }, clientKey: 'CrewProofFilesKey00000000000000002' });
      expect(named.statusCode).toBe(422);
      expect(named.body).toContain('file-not-here');
      const gone = await s.send('yusuf', 'DELETE', `/api/v1/files/${held}`);
      expect([gone.statusCode, (gone.json() as { error?: { code?: string } }).error?.code]).toEqual([409, 'FILE_HELD']);
      // His own fresh upload that no record holds: thrown away by him, as the phone does after a refusal.
      const mine = await upload('yusuf', 'sign_offs', 'photos');
      expect((await s.send('yusuf', 'DELETE', `/api/v1/files/${mine}`)).statusCode).toBeLessThan(300);
      expect((await s.get('yusuf', `/api/v1/files/${mine}/content`)).statusCode).toBe(404);
    });

    it("lets him tick his crew's visits only, and change nothing of a visit but its ticks", async () => {
      expect(said(await s.change('yusuf', 'job_visits', at.blueVisit, { tick_loaded: true }))).toBe('ok');
      expect(said(await s.change('cal', 'job_visits', at.blueVisit, { tick_arrived: true }))).toBe('ok');
      expect((await s.rows(`select tick_loaded, tick_arrived from crm_job_visits where id = ${String(at.blueVisit)}`)).map((row) => [Boolean(Number(row['tick_loaded'])) || row['tick_loaded'] === true, Boolean(Number(row['tick_arrived'])) || row['tick_arrived'] === true])).toEqual([[true, true]]);
      expect((await s.change('yusuf', 'job_visits', at.redVisit, { tick_loaded: true })).statusCode).toBe(404);
      for (const values of [{ day: day(3) }, { start_time: '06:00' }, { crew_id: crew['red'] }, { state: 'done' }, { note: 'mine now' }]) {
        expect((await s.change('yusuf', 'job_visits', at.blueVisit, values)).statusCode, JSON.stringify(values)).toBe(403);
      }
      expect((await s.send('yusuf', 'DELETE', url('job_visits', `/${String(at.blueVisit)}?confirm=true`))).statusCode).toBe(403);
      expect((await s.make('yusuf', 'job_visits', { job_id: at.blueJob, kind: 'drop', what: 'More', hours: 1, crew_size: 1 })).statusCode).toBe(403);
    });

    it("lets his phone write down a sign-off refused on arrival, for his crew's visit and a snag that stops that job alone, once a key; read as sign-offs are, changed by nobody (plan 68 S19)", async () => {
      const { job } = await wonJob('Floor boxes for bay 3');
      expect(said(await s.change('ada', 'jobs', job, { site_name: 'Tandem Robotics' }))).toBe('ok');
      const visitId = await visit(job, 'Test-floor workbenches: return visit', 'blue', 'return');
      const before = Date.now();
      const stopper = made(await s.make('ada', 'snags', { visit_id: visitId, text: 'Floor boxes not fixed down in bay 3', stops_sign_off: true, raised_by_id: s.ids['ada'] }));
      const snagRow = (await s.rows(`select raised_at, raised_on from crm_snags where id = ${String(stopper)}`))[0]!;
      // The moment a snag is raised is stamped with it.
      expect(new Date(String(snagRow['raised_at'] instanceof Date ? (snagRow['raised_at'] as Date).toISOString() : snagRow['raised_at'])).getTime()).toBeGreaterThanOrEqual(before - 5_000);
      const fine = made(await s.make('ada', 'snags', { visit_id: visitId, text: 'A drawer runner sticks', stops_sign_off: false }));
      const signedAt = new Date(Date.now() - 39 * 60_000).toISOString();
      const key = 'CrewProofRefusedKey0000000000000001';
      const record = { visit_id: visitId, signer_name: 'Yusuf Demir', signed_at: signedAt, snag_id: stopper };
      // His crew's sign-off is refused while the snag stops it: the phone writes down that it was, with a key of its own.
      expect((await s.send('yusuf', 'POST', url('sign_offs'), { values: { visit_id: visitId, ...CHECKS, signer_name: 'Yusuf Demir' }, clientKey: 'CrewProofRefusedSignOff0000000001' })).statusCode).toBe(422);
      const first = await s.send('yusuf', 'POST', url('refused_sign_offs'), { values: record, clientKey: key });
      const id = made(first);
      const row = (first.json() as { data: Record<string, unknown> }).data;
      // The server fills in the rest: the job, the crew and the site from the visit; who sent it and when it reached us;
      // the snag's words, who raised it and when, from the snag as it is now.
      expect([Number(row['job_id']), Number(row['crew_id']), row['site_name'], row['by_id'], row['snag_text'], row['snag_by_id']]).toEqual([job, crew['blue'], 'Tandem Robotics', s.ids['yusuf'], 'Floor boxes not fixed down in bay 3', s.ids['ada']]);
      expect(new Date(String(row['reached_at'])).getTime()).toBeGreaterThanOrEqual(before - 5_000);
      // As the phone said it (MySQL keeps whole seconds).
      expect(Math.abs(new Date(String(row['signed_at'])).getTime() - new Date(signedAt).getTime())).toBeLessThan(1_000);
      expect(row['snag_raised_at']).not.toBeNull();
      expect(String(row['snag_raised_on']).slice(0, 10)).toBe(String(snagRow['raised_on'] instanceof Date ? (snagRow['raised_on'] as Date).toISOString() : snagRow['raised_on']).slice(0, 10));
      // Sent again with the same key (an answer lost on its way): the same row, one record.
      const again = await s.send('yusuf', 'POST', url('refused_sign_offs'), { values: record, clientKey: key });
      expect(again.statusCode, again.body).toBeLessThan(300);
      expect([Number((again.json() as { data: { id: number } }).data.id), (again.json() as { replayed?: boolean }).replayed]).toEqual([id, true]);
      expect(await s.rows(`select id from crm_refused_sign_offs where job_id = ${String(job)}`)).toHaveLength(1);

      // Read as sign-offs are: his crew, the office, the rep whose deal it is; never another crew.
      for (const who of ['yusuf', 'cal', 'ada', 'dana', 'tessa']) expect((await one(who, 'refused_sign_offs', id)).statusCode, who).toBe(200);
      expect((await one('rina', 'refused_sign_offs', id)).statusCode).toBe(404);
      expect(await ids('rina', 'refused_sign_offs')).toEqual([]);

      // Nobody forges one for another crew's job, nor for a snag that does not stop this job's sign-off now.
      const red = await wonJob('Warehouse desks, second bay');
      const redVisit = await visit(red.job, 'Warehouse desks, second bay', 'red');
      const redStopper = made(await s.make('ada', 'snags', { visit_id: redVisit, text: 'Desk legs missing', stops_sign_off: true }));
      // A stopper of another of his own crew's jobs: his to read, and still not this job's.
      const other = await wonJob('Studio shelving, top floor');
      const otherVisit = await visit(other.job, 'Studio shelving, top floor', 'blue');
      const otherStopper = made(await s.make('ada', 'snags', { visit_id: otherVisit, text: 'Shelf brackets missing', stops_sign_off: true }));
      expect((await one('yusuf', 'snags', otherStopper)).statusCode).toBe(200);
      const NOT_NAMED = -1;
      const tries: [string, Record<string, unknown>, number][] = [
        // Rina, of the Red crew, for Blue's visit; Yusuf for Red's: a visit out of reach is one that is not there.
        ['rina', record, 409],
        ['yusuf', { ...record, visit_id: redVisit, snag_id: redStopper }, 409],
        // His own visit, naming a snag that does not stop it, or another job's stopper: refused as a link that may not be
        // named (422) or as a row that is not there for it (409), as the engine judges the link.
        ['yusuf', { ...record, snag_id: fine }, NOT_NAMED],
        ['yusuf', { ...record, snag_id: redStopper }, NOT_NAMED],
        ['yusuf', { ...record, snag_id: otherStopper }, NOT_NAMED],
        // What the server fills in is not his to write.
        ['yusuf', { ...record, job_id: red.job }, 403],
        ['yusuf', { ...record, by_id: s.ids['cal'] }, 403],
        ['yusuf', { ...record, reached_at: signedAt }, 403],
        ['yusuf', { ...record, snag_text: 'Something else' }, 403],
      ];
      for (const [i, [who, values, status]] of tries.entries()) {
        const res = await s.send(who, 'POST', url('refused_sign_offs'), { values, clientKey: `CrewProofForged${String(i).padStart(19, '0')}` });
        if (status === NOT_NAMED) expect([409, 422], `${who} ${JSON.stringify(values)}: ${res.body}`).toContain(res.statusCode);
        else expect(res.statusCode, `${who} ${JSON.stringify(values)}: ${res.body}`).toBe(status);
      }
      // Nor the office: it reads one, and writes none.
      expect((await s.send('ada', 'POST', url('refused_sign_offs'), { values: record, clientKey: 'CrewProofRefusedByAda00000000001' })).statusCode).toBe(403);
      // Once the snag is put right it stops nothing, and no record names it any more.
      expect(said(await act('ada', 'snags', stopper, 'put-right', 'open', { put_right_note: 'Fixed down' }))).toBe('ok');
      expect([409, 422]).toContain((await s.send('yusuf', 'POST', url('refused_sign_offs'), { values: record, clientKey: 'CrewProofRefusedKey0000000000000002' })).statusCode);
      expect(await s.rows(`select id from crm_refused_sign_offs`)).toHaveLength(1);
      // Nobody changes or removes it: not his crew, not the office.
      for (const who of ['yusuf', 'cal', 'ada']) {
        expect((await s.change(who, 'refused_sign_offs', id, { signer_name: 'Somebody else' })).statusCode, who).toBeGreaterThanOrEqual(403);
        expect((await s.send(who, 'DELETE', url('refused_sign_offs', `/${String(id)}?confirm=true`))).statusCode, who).toBeGreaterThanOrEqual(403);
      }
      // The operations manager is told, in the bell, once; the crew and the rep are not.
      await jobs();
      const told = async (who: string): Promise<number> => ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: { title: string }[] } }).data.items.filter((item) => item.title === 'A sign-off was refused on arrival: Tandem Robotics').length;
      expect([await told('ada'), await told('yusuf'), await told('dana')]).toEqual([1, 0, 0]);
      // The snag a record names cannot be removed while the record holds it, by the office or the CRM admin (T09)...
      for (const who of ['ada', 'tessa']) expect((await s.send(who, 'DELETE', url('snags', `/${String(stopper)}?confirm=true`))).statusCode, who).toBe(409);
      // ...and the CRM admin may delete the record (the office may not), after which the snag can go.
      expect((await s.send('ada', 'DELETE', url('refused_sign_offs', `/${String(id)}?confirm=true`))).statusCode).toBeGreaterThanOrEqual(403);
      const freed = await s.send('tessa', 'DELETE', url('refused_sign_offs', `/${String(id)}?confirm=true`));
      expect(freed.statusCode, freed.body).toBeLessThan(300);
      const gone = await s.send('ada', 'DELETE', url('snags', `/${String(stopper)}?confirm=true`));
      expect(gone.statusCode, gone.body).toBeLessThan(300);
    });

    it("lets him raise and put right his crew's snags only, with the photo of it put right", async () => {
      const photo = await upload('yusuf', 'snags', 'photo');
      const snag = made(await s.send('yusuf', 'POST', url('snags'), { values: { visit_id: at.blueVisit, text: 'A scuffed panel', stops_sign_off: false, raised_by_id: s.ids['yusuf'], photo }, clientKey: 'CrewProofSnagKey000000000000000001' }));
      expect((await s.rows(`select job_id, photo from crm_snags where id = ${String(snag)}`)).map((row) => [Number(row['job_id']), row['photo']])).toEqual([[at.blueJob, photo]]);
      // Not on Red's visit, and Red's snag is not his to put right.
      expect((await s.make('yusuf', 'snags', { visit_id: at.redVisit, text: 'Made up', stops_sign_off: true })).statusCode).toBe(409);
      expect((await s.change('yusuf', 'snags', at.redSnag, { state: 'put-right', put_right_note: 'Not mine' })).statusCode).toBe(404);
      // Put right: the line is asked by the move; the phone sends the photo with it.
      expect((await s.change('yusuf', 'snags', snag, { state: 'put-right' })).statusCode).toBe(409);
      const fixed = await upload('yusuf', 'snags', 'put_right_photo');
      expect(said(await s.send('yusuf', 'PATCH', url('snags', `/${String(snag)}`), { values: { state: 'put-right', put_right_note: 'Panel cleaned', put_right_photo: fixed }, seen: { state: 'open' } }))).toBe('ok');
      const row = (await s.rows(`select state, put_right_note, put_right_photo, put_right_on from crm_snags where id = ${String(snag)}`))[0]!;
      expect([row['state'], row['put_right_note'], row['put_right_photo'], row['put_right_on'] !== null]).toEqual(['put-right', 'Panel cleaned', fixed, true]);
      // He does not change whether a snag stops the sign-off, nor remove one.
      expect((await s.change('yusuf', 'snags', snag, { stops_sign_off: true })).statusCode).toBe(403);
      expect((await s.send('yusuf', 'DELETE', url('snags', `/${String(snag)}?confirm=true`))).statusCode).toBe(403);
    });
  });
}

/**
 * WHAT TO LOAD (plan 68 S14): a deal's stock need names the visit its stock goes on, and the crew of that visit reads it
 * (`deal_stock_needs.crew_id`, the visit's crew kept by the server). The need's reach is the manifest's own, whether or
 * not Inventory is installed: so Supply is put on here without the add-on (its link to a stock line is a plain number),
 * and Inventory's item name and unit, a grant of the add-on's, are held by the unit tests.
 */
const withoutInventory = (): Record<string, unknown> => {
  const doc = manifest() as { modules: { id: string; feature?: string }[]; addOns: { features?: { id: string }[] } };
  for (const part of doc.modules) if (part.id === 'supply') delete part.feature;
  doc.addOns.features = (doc.addOns.features ?? []).filter((feature) => feature.id !== 'supply');
  return doc as unknown as Record<string, unknown>;
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`what the crew loads: the stock needs of its own visits only, on ${dialect}`, () => {
    let s: WholeServer;
    const crew: Record<string, number> = {};
    const at = { blueVisit: 0, redVisit: 0, need: 0, other: 0, deal: 0 };
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const ids = async (who: string, ref: string): Promise<number[]> => {
      const res = await s.get(who, url(ref, '?limit=200'));
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { id: number }[] }).data.map((row) => Number(row.id)).sort((a, b) => a - b);
    };
    const one = (who: string, ref: string, id: number): Promise<Reply> => s.get(who, url(ref, `/${String(id)}`));
    const count = async (who: string, ref: string): Promise<number> => {
      const res = await s.send(who, 'POST', '/api/v1/widget-data/query', { descriptor: { connectionId: s.connectionId, source: { name: s.t(ref) }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] } });
      expect(res.statusCode, res.body).toBe(200);
      return Number((res.json() as { result: { value?: number } }).result.value ?? 0);
    };
    const act = (who: string, ref: string, id: number, action: string, from: string): Promise<Reply> => s.send(who, 'POST', url(ref, `/${String(id)}/actions/${action}`), { from });
    const day = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
    const jobs = (): Promise<void> => s.jobs({ except: ['digest.send'] });

    beforeAll(async () => {
      s = await wholeServer(dialect, withoutInventory(), {
        people: { dana: ['rep'], ada: ['ops-manager'], grace: ['read-only'], yusuf: ['crew'], cal: ['crew'], rina: ['crew'] },
        install: { modules: { jobs: true, fleet: true, supply: true } },
      });
      const stage = made(await s.make('owner', 'stages', { label: 'Proposal', odds: 0.5, position: 3 }));
      const company = made(await s.make('owner', 'companies', { name: 'Tandem Robotics' }));
      for (const [name, people] of [['blue', ['yusuf', 'cal']], ['red', ['rina']]] as const) {
        crew[name] = made(await s.make('ada', 'crews', { name: `${name} crew` }));
        for (const [i, person] of people.entries()) made(await s.make('ada', 'crew_members', { crew_id: crew[name], user_id: s.ids[person], lead: i === 0 }));
        for (const weekday of WEEK) made(await s.make('ada', 'crew_days', { crew_id: crew[name], weekday }));
      }
      // Dana's deal asks for two lines of stock (a rep writes a need on her own deal); won, the rule makes its job.
      at.deal = made(await s.make('dana', 'deals', { name: 'Test-floor workbenches', company_id: company, owner_id: s.ids['dana'], stage_id: stage, typed_amount: 48_000 }));
      at.need = made(await s.make('dana', 'deal_stock_needs', { deal_id: at.deal, qty: 2 }));
      at.other = made(await s.make('dana', 'deal_stock_needs', { deal_id: at.deal, qty: 1 }));
      expect(said(await act('dana', 'deals', at.deal, 'mark-won', 'open'))).toBe('ok');
      await jobs();
      const job = Number((await s.rows(`select id from ${s.t('jobs')} where deal_id = ${String(at.deal)}`))[0]!['id']);
      for (const [name, key] of [['blue', 'blueVisit'], ['red', 'redVisit']] as const) {
        at[key] = made(await s.make('ada', 'job_visits', { job_id: job, kind: 'drop', what: `${name} drop`, hours: 3, crew_size: 1 }));
        expect(said(await s.change('ada', 'job_visits', at[key], { day: day(3), start_time: '08:00', crew_id: crew[name] }))).toBe('ok');
        expect(said(await act('ada', 'job_visits', at[key], 'book', 'waiting'))).toBe('ok');
      }
      // The office puts the first need on Blue's visit, the second on Red's.
      expect(said(await s.change('ada', 'deal_stock_needs', at.need, { visit_id: at.blueVisit }))).toBe('ok');
      expect(said(await s.change('ada', 'deal_stock_needs', at.other, { visit_id: at.redVisit }))).toBe('ok');
    }, 300_000);
    afterAll(async () => {
      await s?.close();
    });

    it("refuses a need on a visit of another deal's job, by the office or by moving the need's deal (T09)", async () => {
      // Another customer's won deal, its job and a booked visit of Red's.
      const company = Number((await s.rows(`select company_id from ${s.t('deals')} where id = ${String(at.deal)}`))[0]!['company_id']);
      const stage = Number((await s.rows(`select stage_id from ${s.t('deals')} where id = ${String(at.deal)}`))[0]!['stage_id']);
      const otherDeal = made(await s.make('dana', 'deals', { name: 'Archive racking', company_id: company, owner_id: s.ids['dana'], stage_id: stage, typed_amount: 9_000 }));
      expect(said(await act('dana', 'deals', otherDeal, 'mark-won', 'open'))).toBe('ok');
      await jobs();
      const otherJob = Number((await s.rows(`select id from ${s.t('jobs')} where deal_id = ${String(otherDeal)}`))[0]!['id']);
      const otherVisit = made(await s.make('ada', 'job_visits', { job_id: otherJob, kind: 'drop', what: 'racking drop', hours: 2, crew_size: 1 }));
      // The visit carries its deal, copied from its job.
      expect(Number((await s.rows(`select deal_id from ${s.t('job_visits')} where id = ${String(otherVisit)}`))[0]!['deal_id'])).toBe(otherDeal);
      // The office may not put this deal's need on it...
      const moved = await s.change('ada', 'deal_stock_needs', at.other, { visit_id: otherVisit });
      expect([409, 422], moved.body).toContain(moved.statusCode);
      // ...nor may the need's deal change under the visit it names.
      const swapped = await s.change('ada', 'deal_stock_needs', at.other, { deal_id: otherDeal });
      expect(swapped.statusCode, swapped.body).toBeGreaterThanOrEqual(400);
      expect(Number((await s.rows(`select visit_id from ${s.t('deal_stock_needs')} where id = ${String(at.other)}`))[0]!['visit_id'])).toBe(at.redVisit);
      expect(said(await s.send('ada', 'DELETE', url('job_visits', `/${String(otherVisit)}?confirm=true`)))).toBe('ok');
    });

    it("lets a crew member read the needs of his crew's visits, and refuses him another crew's by any door", async () => {
      // The need carries its visit's crew, kept by the server.
      expect(Number((await s.rows(`select crew_id from ${s.t('deal_stock_needs')} where id = ${String(at.need)}`))[0]!['crew_id'])).toBe(crew['blue']);
      expect(await ids('yusuf', 'deal_stock_needs')).toEqual([at.need]);
      expect(await ids('cal', 'deal_stock_needs')).toEqual([at.need]);
      expect(await ids('rina', 'deal_stock_needs')).toEqual([at.other]);
      expect((await one('yusuf', 'deal_stock_needs', at.other)).statusCode).toBe(404);
      expect((await s.get('yusuf', url('deal_stock_needs', `/${String(at.other)}/history`))).statusCode).toBe(404);
      expect((await one('rina', 'deal_stock_needs', at.need)).statusCode).toBe(404);
      expect(await count('yusuf', 'deal_stock_needs')).toBe(1);
      // Of a need he reads its line, its count and the visit; nothing of the deal it is for (no amount, no name, no state).
      const mine = (await one('yusuf', 'deal_stock_needs', at.need)).json() as { data: Record<string, unknown> };
      expect(Object.keys(mine.data).filter((key) => !key.startsWith('_')).sort()).toEqual(['crew_id', 'deal_id', 'id', 'item', 'qty', 'visit_id']);
      const through = await s.get('yusuf', url('deal_stock_needs', `/${String(at.need)}?lookup=${encodeURIComponent('deal:deal_id.name')}`));
      expect((through.json() as { data: Record<string, unknown> }).data['deal'] ?? null).toBeNull();
      expect((await s.get('yusuf', url('deals', '?limit=5'))).statusCode).toBe(403);
      // He writes none of it.
      expect((await s.change('yusuf', 'deal_stock_needs', at.need, { qty: 9 })).statusCode).toBe(403);
      expect((await s.make('yusuf', 'deal_stock_needs', { deal_id: at.deal, qty: 1 })).statusCode).toBe(403);
      // The visit given to Red: the need goes with it.
      expect(said(await s.change('ada', 'job_visits', at.blueVisit, { crew_id: crew['red'] }))).toBe('ok');
      try {
        expect(await ids('yusuf', 'deal_stock_needs')).toEqual([]);
        expect(await ids('rina', 'deal_stock_needs')).toEqual([at.need, at.other]);
      } finally {
        expect(said(await s.change('ada', 'job_visits', at.blueVisit, { crew_id: crew['blue'] }))).toBe('ok');
      }
      // The office reads every need, and of a deal no more than before: a won deal's name, state, close day and jobs.
      expect(await ids('ada', 'deal_stock_needs')).toEqual([at.need, at.other].sort((a, b) => a - b));
      const deal = (await one('ada', 'deals', at.deal)).json() as { data: Record<string, unknown> };
      expect(Object.keys(deal.data).filter((key) => !key.endsWith('_id') && !key.startsWith('_') && !['id', 'name', 'state', 'closed_on', 'job_count'].includes(key))).toEqual([]);
      expect(await ids('grace', 'deal_stock_needs')).toEqual([at.need, at.other].sort((a, b) => a - b));
    });
  });
}
