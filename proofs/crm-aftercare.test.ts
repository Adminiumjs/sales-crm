// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 67, P23: AFTER THE JOB, against the whole server on SQLite, Postgres
 * and MySQL, with the app's own manifest (every part; Jobs on site and After
 * the job switched on), each try made signed in as the person it is about.
 *
 *  1. A complaint is answered by the move from "open", carrying what we told
 *     them (`complaints.answer`, the column the design's answer needed), once;
 *     it is settled from "answered". The account manager and the CRM admin
 *     answer any; a rep only her own; the sales manager, the operations
 *     manager and Read-only none; the marketer reads none.
 *  2. A warranty claim moves only along its table's moves (never straight
 *     from the supplier to sorted), and is put right saying who paid.
 *  3. An answer a customer gave is added by hand ("Add an answer"), one a job,
 *     by the account manager and the CRM admin only; a thank-you is kept once.
 *  4. An aftercare call is made once, done with what came of it, stamped by
 *     the server with who and when.
 *  5. A job signed off books its aftercare call (rule 16): for the person
 *     Settings names, else the rep who sold the job, the days Settings
 *     holds (28 if none) after the sign-off, at 09:00.
 *  6. While After the job is off, its roles hold nothing on its tables and
 *     nobody writes them; a rep (of another part) still reads her own.
 *
 * What these people are then shown is proved on the browser stand:
 * `e2e/aftercare-pages.e2e.ts` (run with `CRM_STAND_STAGE=2`).
 *
 * To run: `npm run proofs -- aftercare` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.35' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's After the job, on ${dialect}`, () => {
    let s: WholeServer;
    const id: Record<string, number> = {};
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const row = async (who: string, ref: string, key: number): Promise<Record<string, unknown> | null> => {
      const res = await s.get(who, url(ref, `/${String(key)}`));
      return res.statusCode === 200 ? (res.json() as { data: Record<string, unknown> }).data : null;
    };
    const act = (who: string, ref: string, key: number, action: string, from: string, values?: Record<string, unknown>): Promise<Reply> => s.send(who, 'POST', url(ref, `/${String(key)}/actions/${action}`), { from, ...(values === undefined ? {} : { values }) });
    const once = (who: string, ref: string, key: number, values: Record<string, unknown>, seen: Record<string, unknown>): Promise<Reply> => s.send(who, 'PATCH', url(ref, `/${String(key)}`), { values, seen });

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { hugo: ['account-manager'], tessa: ['admin'], dana: ['rep'], ivy: ['sales-manager'], ada: ['ops-manager'], grace: ['read-only'], lena: ['marketer'] },
        install: { modules: { inbox: true, jobs: true, aftercare: true } },
      });
      // Ivy leads the team Dana is in.
      const team = await teamsRepo(s.meta).create('Sales');
      await teamsRepo(s.meta).setMember(team.id, s.ids['ivy']!, true);
      await teamsRepo(s.meta).setMember(team.id, s.ids['dana']!, false);
      const stage = made(await s.make('owner', 'stages', { label: 'Negotiation', odds: 0.75, position: 4 }));
      id['company'] = made(await s.make('owner', 'companies', { name: 'Veldt Studios' }));
      id['contact'] = made(await s.make('owner', 'contacts', { company_id: id['company'], name: 'Marta Kovac', email: 'marta@veldt.test', may_email: true }));
      // One job a deal, each of a deal of Dana's.
      for (const key of ['job', 'job2', 'job3']) {
        const deal = made(await s.make('owner', 'deals', { name: `Studio tables, ${key}`, company_id: id['company'], contact_id: id['contact'], owner_id: s.ids['dana'], stage_id: stage }));
        id[key] = made(await s.make('owner', 'jobs', { deal_id: deal, site_name: 'Veldt Studios' }));
      }
      await s.jobs();
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('answers a complaint by the move from open, carrying what we told them, once; settles it from answered; each role as its grant says', async () => {
      const hugos = made(await s.make('hugo', 'complaints', { company_id: id['company'], contact_id: id['contact'], job_id: id['job'], owner_id: s.ids['dana'], cause: 'crew', fairness: 'fair', text: 'Cardboard everywhere at five.' }));
      expect((await row('hugo', 'complaints', hugos))?.['state']).toBe('open');
      // Nobody may answer it but whoever may change it: the sales manager, the operations manager and Read-only read it and are refused.
      for (const who of ['ivy', 'ada', 'grace']) {
        expect(await row(who, 'complaints', hugos), who).not.toBeNull();
        expect((await act(who, 'complaints', hugos, 'answered', 'open', { answer: 'not mine' })).statusCode, who).toBe(403);
      }
      // The marketer reads none of it.
      expect((await s.get('lena', url('complaints', '?limit=5'))).statusCode).toBe(403);
      const answered = await act('hugo', 'complaints', hugos, 'answered', 'open', { answer: 'Fair. Rina goes back on Saturday.' });
      expect(answered.statusCode, answered.body).toBe(200);
      const now = await row('tessa', 'complaints', hugos);
      expect([now?.['state'], now?.['answer']]).toEqual(['answered', 'Fair. Rina goes back on Saturday.']);
      expect(now?.['answered_at']).not.toBeNull();
      // Once: the same move from where it no longer stands is refused, and the answer stays.
      expect((await act('tessa', 'complaints', hugos, 'answered', 'open', { answer: 'again' })).statusCode).toBe(409);
      expect((await row('hugo', 'complaints', hugos))?.['answer']).toBe('Fair. Rina goes back on Saturday.');
      // Settled from answered.
      expect(said(await act('hugo', 'complaints', hugos, 'settle', 'answered'))).toBe('ok');
      const settled = await row('hugo', 'complaints', hugos);
      expect(settled?.['state']).toBe('settled');
      expect(settled?.['settled_at']).not.toBeNull();

      // A rep answers her own complaint, not another's.
      const hers = made(await s.make('tessa', 'complaints', { company_id: id['company'], owner_id: s.ids['dana'], cause: 'late', text: 'Two weeks late.' }));
      const his = made(await s.make('tessa', 'complaints', { company_id: id['company'], owner_id: s.ids['hugo'], cause: 'wrong', text: 'Wrong tops.' }));
      expect(said(await act('dana', 'complaints', hers, 'answered', 'open', { answer: 'Our error; new date Friday.' }))).toBe('ok');
      expect((await row('dana', 'complaints', hers))?.['answer']).toBe('Our error; new date Friday.');
      expect(await row('dana', 'complaints', his)).toBeNull();
      expect((await act('dana', 'complaints', his, 'answered', 'open', { answer: 'not hers' })).statusCode).toBe(404);
      // An answer is no longer than the column takes.
      expect((await act('hugo', 'complaints', his, 'answered', 'open', { answer: 'x'.repeat(2001) })).statusCode).toBeGreaterThanOrEqual(400);
      for (const key of [hugos, hers, his]) expect(said(await s.send('hugo', 'DELETE', url('complaints', `/${String(key)}?confirm=true`)))).toBe('ok');
    });

    it('moves a warranty claim only along its moves, and puts it right saying who paid', async () => {
      const claim = made(await s.make('hugo', 'warranty_claims', { job_id: id['job'], contact_id: id['contact'], what: 'Table leg weld cracked', cover: 'frame', cover_years: 5, supplier_name: 'Ostrom Seating' }));
      expect((await row('hugo', 'warranty_claims', claim))?.['state']).toBe('to-raise');
      // The rep reads it (her deal's job) and moves nothing; Read-only and the sales manager neither.
      expect(await row('dana', 'warranty_claims', claim)).not.toBeNull();
      for (const who of ['dana', 'grace', 'ivy']) expect((await act(who, 'warranty_claims', claim, 'raise', 'to-raise')).statusCode, who).toBe(403);
      // The operations manager may (her grant on claims); here the account manager raises it.
      expect(said(await act('hugo', 'warranty_claims', claim, 'raise', 'to-raise'))).toBe('ok');
      // Never straight from the supplier to sorted.
      expect((await act('hugo', 'warranty_claims', claim, 'sorted', 'with-supplier', { paid_by: 'us' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await row('hugo', 'warranty_claims', claim))?.['state']).toBe('with-supplier');
      expect(said(await act('ada', 'warranty_claims', claim, 'parts-coming', 'with-supplier'))).toBe('ok');
      expect(said(await act('hugo', 'warranty_claims', claim, 'sorted', 'parts-coming', { paid_by: 'us' }))).toBe('ok');
      expect([(await row('tessa', 'warranty_claims', claim))?.['state'], (await row('tessa', 'warranty_claims', claim))?.['paid_by']]).toEqual(['sorted', 'us']);
      expect(said(await s.send('hugo', 'DELETE', url('warranty_claims', `/${String(claim)}?confirm=true`)))).toBe('ok');
    });

    it('adds an answer a customer gave, one a job, by the account manager and the admin only; keeps a thank-you once', async () => {
      const answer = made(await s.make('hugo', 'feedback', { job_id: id['job'], score: 5, text: 'In and out in a morning.', theme: 'Drawings matched the room', answered_on: '2026-07-27' }));
      // One answer a job, whoever sends the second.
      expect((await s.make('tessa', 'feedback', { job_id: id['job'], score: 3, answered_on: '2026-07-28' })).statusCode).toBeGreaterThanOrEqual(400);
      // A score is from 1 to 5.
      expect((await s.make('hugo', 'feedback', { job_id: id['job2'], score: 6, answered_on: '2026-07-28' })).statusCode).toBeGreaterThanOrEqual(400);
      const tessas = made(await s.make('tessa', 'feedback', { job_id: id['job2'], score: 3, answered_on: '2026-07-28', fix_written: 'We confirm the week in writing.' }));
      for (const who of ['dana', 'ivy', 'ada', 'grace']) expect((await s.make(who, 'feedback', { job_id: id['job3'], score: 4, answered_on: '2026-07-28' })).statusCode, who).toBe(403);
      expect((await s.get('lena', url('feedback', '?limit=5'))).statusCode).toBe(403);
      // The rep reads the answers on her deal's jobs.
      expect(await row('dana', 'feedback', answer)).not.toBeNull();
      // Say thank you: the moment kept, once.
      expect(said(await once('hugo', 'feedback', answer, { replied_at: '2026-07-28T09:40:00.000Z' }, { replied_at: null }))).toBe('ok');
      expect((await once('tessa', 'feedback', answer, { replied_at: '2026-07-28T10:00:00.000Z' }, { replied_at: null })).statusCode).toBe(409);
      expect((await once('grace', 'feedback', tessas, { replied_at: '2026-07-28T10:00:00.000Z' }, { replied_at: null })).statusCode).toBe(403);
      for (const key of [answer, tessas]) expect(said(await s.send('hugo', 'DELETE', url('feedback', `/${String(key)}?confirm=true`)))).toBe('ok');
    });

    it('makes an aftercare call once, done with what came of it, stamped with who and when by the server', async () => {
      const call = made(await s.make('hugo', 'follow_ups', { job_id: id['job'], owner_id: s.ids['hugo'], due_at: '2026-08-22T09:00:00.000Z', text: 'Aftercare call', kind: 'aftercare', call_no: 1 }));
      // His own: the rep reads none of it, Read-only changes nothing.
      expect(await row('dana', 'follow_ups', call)).toBeNull();
      expect((await once('grace', 'follow_ups', call, { done: true, outcome: 'none' }, { done: false })).statusCode).toBe(403);
      expect(said(await once('hugo', 'follow_ups', call, { done: true, outcome: 'more-work' }, { done: false }))).toBe('ok');
      const done = await row('tessa', 'follow_ups', call);
      // Who made it, and when, are the server's stamps.
      expect([Boolean(done?.['done']), done?.['outcome'], done?.['done_by_id']]).toEqual([true, 'more-work', s.ids['hugo']]);
      expect(done?.['done_at']).not.toBeNull();
      expect((await once('hugo', 'follow_ups', call, { done: true, outcome: 'none' }, { done: false })).statusCode).toBe(409);
      expect(said(await s.send('tessa', 'DELETE', url('follow_ups', `/${String(call)}?confirm=true`)))).toBe('ok');
    });

    it('books the aftercare call when a job is signed off (rule 16): for whom Settings names, else the rep who sold it, so many days on at 09:00', async () => {
      // The business's clock is UTC here, so the day and the hour can be written out.
      await s.meta.db.updateTable('adminium_connections').set({ timezone: 'UTC' } as never).where('id', '=', s.connectionId).execute();
      const settings = Number((await s.rows('select id from crm_settings'))[0]!['id']);
      const signOff = async (job: number): Promise<{ owner: unknown; due: string; signed: string }> => {
        expect(said(await act('tessa', 'jobs', job, 'installed', 'open'))).toBe('ok');
        // The sign-off moves its job to signed off by itself (moveOnCreate), which sets the rule off.
        made(await s.make('tessa', 'sign_offs', { job_id: job, check_1: true, signer_name: 'Marta Kovac' }));
        expect(String((await row('tessa', 'jobs', job))?.['state'])).toBe('signed-off');
        await s.jobs();
        const calls = await s.rows(`select owner_id, due_at, kind, call_no, deal_id, text from crm_follow_ups where job_id = ${String(job)}`);
        expect(calls, `job ${String(job)}: one aftercare call`).toHaveLength(1);
        expect([calls[0]!['kind'], Number(calls[0]!['call_no']), calls[0]!['text']]).toEqual(['aftercare', 1, (await row('tessa', 'jobs', job))?.['title']]);
        const signed = new Date(String((await row('tessa', 'jobs', job))?.['signed_off_at']));
        return { owner: calls[0]!['owner_id'], due: new Date(String(calls[0]!['due_at'])).toISOString(), signed: signed.toISOString() };
      };
      const dayOn = (from: string, days: number): string => `${new Date(Date.parse(from.slice(0, 10)) + days * 86_400_000).toISOString().slice(0, 10)}T09:00:00.000Z`;
      // Hugo named for aftercare, 14 days.
      expect(said(await s.change('tessa', 'settings', settings, { aftercare_owner_id: s.ids['hugo'], aftercare_days: 14 }))).toBe('ok');
      const named = await signOff(id['job2']!);
      expect(named.owner).toBe(s.ids['hugo']);
      expect(named.due).toBe(dayOn(named.signed, 14));
      // Nobody named: the rep who sold the job; 28 days on.
      expect(said(await s.change('tessa', 'settings', settings, { aftercare_owner_id: null, aftercare_days: 28 }))).toBe('ok');
      const sold = await signOff(id['job3']!);
      expect(sold.owner).toBe(s.ids['dana']);
      expect(sold.due).toBe(dayOn(sold.signed, 28));
    });

    it('while After the job is off: its roles hold nothing on its tables, nobody writes them, a rep still reads her own', async () => {
      const hers = made(await s.make('tessa', 'complaints', { company_id: id['company'], owner_id: s.ids['dana'], cause: 'late', text: 'Late again.' }));
      const off = await s.send('owner', 'PUT', '/api/v1/apps/crm/parts/aftercare', { on: false });
      expect(off.statusCode, off.body).toBe(200);
      try {
        for (const who of ['hugo', 'tessa']) {
          for (const table of ['feedback', 'complaints', 'warranty_claims']) expect((await s.get(who, url(table, '?limit=5'))).statusCode, `${who} ${table}`).toBe(403);
        }
        expect((await s.make('hugo', 'feedback', { job_id: id['job3'], score: 4, answered_on: '2026-07-28' })).statusCode).toBe(403);
        // The rep is of another part: she goes on reading her own complaint, and writes nothing on it.
        expect(await row('dana', 'complaints', hers)).not.toBeNull();
        expect((await act('dana', 'complaints', hers, 'answered', 'open', { answer: 'off' })).statusCode).toBe(403);
      } finally {
        expect(said(await s.send('owner', 'PUT', '/api/v1/apps/crm/parts/aftercare', { on: true }))).toBe('ok');
      }
      expect(said(await act('hugo', 'complaints', hers, 'answered', 'open', { answer: 'Back on.' }))).toBe('ok');
      expect(said(await s.send('hugo', 'DELETE', url('complaints', `/${String(hers)}?confirm=true`)))).toBe('ok');
    });
  });
}
