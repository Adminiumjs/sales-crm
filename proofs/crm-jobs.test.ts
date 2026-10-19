// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 67, stage 2: JOBS ON SITE, THE OFFICE SIDE (P20, P21; F17, F19, F20,
 * F22), against the whole server on SQLite, Postgres and MySQL, with the
 * app's own manifest and the part switched on, each try made signed in as
 * the person it is about.
 *
 *  - The operations manager reads won deals only, five columns of them, to
 *    make the jobs still to make; a job is made for a won deal only, one a
 *    deal; a won deal says how many jobs it has.
 *  - A delivery booked, moved and called off writes its e-mail to the job's
 *    contact (F22: 10, 15, 16), with the office's phone; switched off in
 *    Settings, none is written. Booking writes "booked", never "moved".
 *  - A change to a booked visit of today or tomorrow tells the crew it is for
 *    at once, and no other crew (the day sheet's notices).
 *  - A sign-off stays as it was made: nobody changes or removes it; a
 *    correction is a new row naming it, with the next version; one sign-off
 *    a job and version, one correction a sign-off.
 *  - Its signature and photos are files (F19): a sign-off names only its
 *    writer's own fresh upload, the record then holds them; a correction
 *    names a sign-off of its own job.
 *  - A visit called off is REMOVED, with the why in the removal's audit
 *    entry; a visit that was made (done) stays.
 *  - A delivery note's totals and whether it needs sorting are the server's;
 *    the crew reads its own notes without the totals.
 *  - A crew member's phone, a job's address and its site phone are personal:
 *    read only by who holds the right to.
 *
 * The screens' figures, as each of these people is answered, are on the
 * browser stand: `e2e/jobs-office.e2e.ts`, `e2e/jobs-site.e2e.ts`.
 *
 * To run: `npm run proofs -- jobs` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { jobsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { png } from './picture-images.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.29' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const DAY = 86_400_000;
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ANA = 'ana.belova@fernway-clinics.com';
const OFFICE = '0113 496 0100';

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's jobs on site, the office side, on ${dialect}`, () => {
    let s: WholeServer;
    let stage = 0;
    let company = 0;
    let contact = 0;
    let settingsId = 0;
    const crew: Record<string, number> = {};
    type Notice = { title: string; kind: string };
    const noticesOf = async (who: string): Promise<Notice[]> => ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: Notice[] } }).data.items;
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const row = async (who: string, ref: string, id: number): Promise<Record<string, unknown> | null> => {
      const res = await s.get(who, url(ref, `/${String(id)}`));
      return res.statusCode === 200 ? (res.json() as { data: Record<string, unknown> }).data : null;
    };
    const list = async (who: string, ref: string, where?: unknown): Promise<Record<string, unknown>[]> => {
      const res = await s.get(who, url(ref, `?limit=200${where === undefined ? '' : `&where=${encodeURIComponent(JSON.stringify(where))}`}`));
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Record<string, unknown>[] }).data;
    };
    const remove = (who: string, ref: string, id: number): Promise<Reply> => s.send(who, 'DELETE', url(ref, `/${String(id)}?confirm=true`));
    const act = (who: string, ref: string, id: number, action: string, from: string, values?: Record<string, unknown>): Promise<Reply> =>
      s.send(who, 'POST', url(ref, `/${String(id)}/actions/${action}`), { from, ...(values === undefined ? {} : { values }) });
    const day = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
    const jobs = (): Promise<void> => s.jobs({ except: ['digest.send'] });
    /** A deal of Dana's, won: the app's rule makes its job. Answers the deal and its job. */
    const wonJob = async (name: string): Promise<{ deal: number; job: number }> => {
      const deal = made(await s.make('dana', 'deals', { name, company_id: company, contact_id: contact, owner_id: s.ids['dana'], stage_id: stage }));
      expect(said(await act('dana', 'deals', deal, 'mark-won', 'open'))).toBe('ok');
      await jobs();
      const found = await s.rows(`select id from crm_jobs where deal_id = ${String(deal)}`);
      expect(found, `the rule makes the job of "${name}"`).toHaveLength(1);
      return { deal, job: Number(found[0]!['id']) };
    };
    /** A visit to a job, made by the operations manager; booked for a crew on a day when `on` is given. */
    const visit = async (job: number, what: string, on?: { day: string; crew: string; start?: string }): Promise<number> => {
      const id = made(await s.make('ada', 'job_visits', { job_id: job, kind: 'drop', what, hours: 3, crew_size: 1 }));
      if (on === undefined) return id;
      expect(said(await s.change('ada', 'job_visits', id, { day: on.day, start_time: on.start ?? '08:00', crew_id: crew[on.crew] }))).toBe('ok');
      expect(said(await act('ada', 'job_visits', id, 'book', 'waiting'))).toBe('ok');
      return id;
    };
    const outbox = (job: number): Promise<Record<string, unknown>[]> => s.rows(`select * from crm_outbox where job_id = ${String(job)} order by id`);

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { dana: ['rep'], tessa: ['admin'], ada: ['ops-manager'], grace: ['read-only'], lena: ['marketer'], yusuf: ['crew'], rina: ['crew'] },
        smtp: true,
        install: { modules: { jobs: true } },
      });
      stage = made(await s.make('owner', 'stages', { label: 'Proposal', odds: 0.5, position: 3 }));
      company = made(await s.make('owner', 'companies', { name: 'Fernway Clinics' }));
      contact = made(await s.make('owner', 'contacts', { company_id: company, name: 'Ana Belova', email: ANA, may_email: true }));
      // Two crews, each of one person, working every day of the week (so "tomorrow" is always a day they work).
      for (const [name, person] of [['blue', 'yusuf'], ['red', 'rina']] as const) {
        crew[name] = made(await s.make('ada', 'crews', { name: `${name[0]!.toUpperCase()}${name.slice(1)} crew` }));
        made(await s.make('ada', 'crew_members', { crew_id: crew[name], user_id: s.ids[person], lead: true, phone: person === 'yusuf' ? '07700 900123' : null }));
        for (const weekday of WEEK) made(await s.make('ada', 'crew_days', { crew_id: crew[name], weekday }));
      }
      settingsId = Number((await s.rows('select id from crm_settings'))[0]!['id']);
      expect(said(await s.change('tessa', 'settings', settingsId, { office_phone: OFFICE }))).toBe('ok');
      await jobs();
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('lets the operations manager read won deals only, five columns of them, and make a job for a won deal only, one a deal', async () => {
      const open = made(await s.make('dana', 'deals', { name: 'Reception sofas', company_id: company, contact_id: contact, owner_id: s.ids['dana'], stage_id: stage }));
      const { deal, job } = await wonJob('Ward corridor seating');
      // A won deal says how many jobs it has: the server's count.
      expect(Number((await row('ada', 'deals', deal))?.['job_count'])).toBe(1);
      // Won deals only, and five columns of each (with its links, which the engine always shows: a link says which row, not what is in it).
      const read = await list('ada', 'deals');
      expect(read.map((one) => Number(one['id']))).toEqual([deal]);
      expect(Object.keys(read[0]!).filter((key) => !key.endsWith('_id') && !['id', 'name', 'state', 'closed_on', 'job_count'].includes(key))).toEqual([]);
      for (const hidden of ['amount', 'typed_amount', 'owner_id', 'close_note', 'expected_close']) expect(read[0]!, hidden).not.toHaveProperty(hidden);
      expect(await row('ada', 'deals', open)).toBeNull();
      expect((await s.change('ada', 'deals', deal, { name: 'Renamed' })).statusCode).toBe(403);
      // A job for an open deal: refused in the words of "no such deal". A second job for a won one: refused, one a deal.
      const forOpen = await s.make('ada', 'jobs', { deal_id: open, site_name: 'Reception sofas' });
      expect(forOpen.statusCode, forOpen.body).toBe(409);
      expect(said(forOpen)).toBe(said(await s.make('ada', 'jobs', { deal_id: 999_999, site_name: 'Nowhere' })));
      expect((await s.make('ada', 'jobs', { deal_id: deal, site_name: 'Again' })).statusCode).toBe(409);
      // Nobody else of the sales side makes a job; the marketer reads none.
      expect((await s.make('dana', 'jobs', { deal_id: deal, site_name: 'Dana' })).statusCode).toBe(403);
      expect((await s.make('grace', 'jobs', { deal_id: deal, site_name: 'Grace' })).statusCode).toBe(403);
      expect((await s.get('lena', url('jobs', '?limit=5'))).statusCode).toBe(403);
      // "Jobs still to make": a won deal whose job is gone (as one won before the part was switched on) counts none, and is made from here.
      expect(said(await remove('owner', 'jobs', job))).toBe('ok');
      expect(Number((await row('ada', 'deals', deal))?.['job_count'])).toBe(0);
      const still = await list('ada', 'deals', { and: [{ column: 'state', op: 'eq', value: 'won' }, { column: 'job_count', op: 'eq', value: 0 }] });
      expect(still.map((one) => Number(one['id']))).toEqual([deal]);
      const again = made(await s.make('ada', 'jobs', { deal_id: deal, site_name: 'Ward corridor seating' }));
      expect(Number((await row('ada', 'deals', deal))?.['job_count'])).toBe(1);
      // The job carries the deal's contact: who the delivery e-mails go to.
      expect(Number((await row('ada', 'jobs', again))?.['contact_id'])).toBe(contact);
    });

    it('writes the job\'s contact an e-mail when a delivery is booked, moved and called off, and none when they are switched off', async () => {
      await s.emails();
      const { job } = await wonJob('Clinic waiting-room seating');
      const id = await visit(job, 'Waiting-room chairs');
      // Its day and crew written while it waits: nothing is said yet.
      expect(said(await s.change('ada', 'job_visits', id, { day: day(5), start_time: '08:00', crew_id: crew['blue'] }))).toBe('ok');
      await jobs();
      expect(await outbox(job)).toEqual([]);
      // Booked: one "booked", never a "moved" (the day was written before).
      expect(said(await act('ada', 'job_visits', id, 'book', 'waiting'))).toBe('ok');
      await jobs();
      expect((await outbox(job)).map((one) => [one['kind'], one['to'], Number(one['job_visit_id'])])).toEqual([['delivery-booked', ANA, id]]);
      // Moved: one more, keeping the day it had; a save that moves nothing writes nothing.
      expect(said(await s.change('ada', 'job_visits', id, { day: day(6) }))).toBe('ok');
      expect(said(await s.change('ada', 'job_visits', id, { note: 'Side door, ring twice' }))).toBe('ok');
      await jobs();
      const moved = await outbox(job);
      expect(moved.map((one) => one['kind'])).toEqual(['delivery-booked', 'delivery-moved']);
      expect(String(moved[1]!['was'])).toContain(day(5));
      // The quarter-hour ends (the test is the clock): the moved message goes.
      await s.rows(`update crm_outbox set due_at = '${dialect === 'mysql' ? '2000-01-01 00:00:00' : '2000-01-01T00:00:00.000Z'}' where kind = 'delivery-moved' and job_id = ${String(job)}`);
      await jobsRepo(s.meta).enqueue({ kind: 'app-outbox-send', payload: { app: 'crm' }, dedupeKey: `app-outbox-send:crm:jobs-window-${dialect}` });
      await jobs();
      // Called off, which removes it.
      expect(said(await s.change('ada', 'job_visits', id, { cancel_reason: 'The ward is closed that week' }))).toBe('ok');
      expect(said(await remove('ada', 'job_visits', id))).toBe('ok');
      await jobs();
      const all = await outbox(job);
      expect(all.map((one) => [one['kind'], one['to']])).toEqual([
        ['delivery-booked', ANA],
        ['delivery-moved', ANA],
        ['delivery-cancelled', ANA],
      ]);
      expect(String(all[2]!['was'])).toContain('Waiting-room chairs');
      for (const one of all) expect(['sent', 'queued'], `${String(one['kind'])}: ${String(one['error'])}`).toContain(one['status']);
      const mails = (await s.emails()).filter((mail) => mail.to === ANA);
      expect(mails.map((mail) => mail.templateKey)).toEqual(['crm-delivery-booked', 'crm-delivery-moved', 'crm-delivery-cancelled']);
      // Each gives the office's phone to ring, and none a placeholder it was written with.
      for (const mail of mails) {
        expect(mail.text, mail.templateKey).toContain(OFFICE);
        expect(`${mail.subject} ${mail.text}`, mail.templateKey).not.toMatch(/\{\{/);
      }

      // Switched off by the CRM admin (the operations manager may not): nothing is written.
      expect((await s.change('ada', 'settings', settingsId, { delivery_emails: false })).statusCode).toBe(403);
      expect(said(await s.change('tessa', 'settings', settingsId, { delivery_emails: false }))).toBe('ok');
      const quiet = await visit(job, 'Spare chairs', { day: day(7), crew: 'blue' });
      expect(said(await s.change('ada', 'job_visits', quiet, { day: day(8) }))).toBe('ok');
      await jobs();
      expect((await outbox(job)).length).toBe(3);
      expect(said(await s.change('tessa', 'settings', settingsId, { delivery_emails: true }))).toBe('ok');
      expect(said(await remove('ada', 'job_visits', quiet))).toBe('ok');
      await jobs();
    });

    it('tells the crew a booked visit of today or tomorrow is for, at once, when it changes; no other crew; and nobody of a later day', async () => {
      const { job } = await wonJob('Ward store shelving');
      const count = async (who: string, title: string): Promise<number> => (await noticesOf(who)).filter((one) => one.title === title).length;
      const soon = await visit(job, 'Store shelving', { day: day(1), crew: 'blue' });
      const later = await visit(job, 'Store top-up', { day: day(6), crew: 'blue' });
      await jobs();
      const changed = 'Your day sheet changed: Store shelving';
      const before = [await count('yusuf', changed), await count('rina', changed)];
      // A new start: Blue is told, Red is not.
      expect(said(await s.change('ada', 'job_visits', soon, { start_time: '10:00' }))).toBe('ok');
      await jobs();
      expect([await count('yusuf', changed), await count('rina', changed)]).toEqual([before[0]! + 1, before[1]]);
      // Given to Red: Red is told it is theirs now.
      expect(said(await s.change('ada', 'job_visits', soon, { crew_id: crew['red'] }))).toBe('ok');
      await jobs();
      expect(await count('rina', 'A visit is now yours: Store shelving')).toBe(1);
      expect(await count('yusuf', 'A visit is now yours: Store shelving')).toBe(0);
      // A visit of a later day moved to another later day: nobody. Moved onto tomorrow: its crew.
      const top = 'Your day sheet changed: Store top-up';
      expect(said(await s.change('ada', 'job_visits', later, { day: day(7) }))).toBe('ok');
      await jobs();
      expect(await count('yusuf', top)).toBe(0);
      expect(said(await s.change('ada', 'job_visits', later, { day: day(1) }))).toBe('ok');
      await jobs();
      expect([await count('yusuf', top), await count('rina', top)]).toEqual([1, 0]);
      // Each crew reads its own visits only.
      expect((await list('yusuf', 'job_visits')).map((one) => Number(one['id']))).toEqual([later]);
      expect((await list('rina', 'job_visits')).map((one) => Number(one['id']))).toEqual([soon]);
      for (const id of [soon, later]) expect(said(await remove('ada', 'job_visits', id))).toBe('ok');
    });

    it('keeps a sign-off as it was made: nobody changes or removes it, and a correction is a new row with the next version', async () => {
      const { job } = await wonJob('Library shelving');
      const first = made(await s.make('ada', 'sign_offs', { job_id: job, check_1: true, check_2: true, signer_name: 'Ana Belova' }));
      expect(Number((await row('ada', 'sign_offs', first))?.['version'])).toBe(1);
      // Nobody changes it or takes it away: not the operations manager, not the CRM admin, not the crew.
      for (const who of ['ada', 'tessa', 'yusuf', 'grace']) {
        expect((await s.change(who, 'sign_offs', first, { signer_name: 'Somebody else' })).statusCode, who).toBeGreaterThanOrEqual(403);
        expect((await remove(who, 'sign_offs', first)).statusCode, who).toBeGreaterThanOrEqual(403);
      }
      expect((await row('tessa', 'sign_offs', first))?.['signer_name']).toBe('Ana Belova');
      // A second sign-off of the job that names none: refused (one a job and version).
      expect((await s.make('ada', 'sign_offs', { job_id: job, signer_name: 'Ana Belova' })).statusCode).toBe(409);
      // A correction names the one it corrects: the next version, worked out by the server whatever is typed.
      const second = made(await s.make('ada', 'sign_offs', { job_id: job, check_1: true, check_2: true, check_3: true, signer_name: 'Ana Belova', corrects_id: first }));
      expect(Number((await row('ada', 'sign_offs', second))?.['version'])).toBe(2);
      // One correction a sign-off; the correction is corrected in its turn.
      expect((await s.make('ada', 'sign_offs', { job_id: job, signer_name: 'Ana Belova', corrects_id: first })).statusCode).toBe(409);
      const third = made(await s.make('tessa', 'sign_offs', { job_id: job, signer_name: 'Ana Belova', corrects_id: second }));
      expect(Number((await row('ada', 'sign_offs', third))?.['version'])).toBe(3);
      // Read-only and a rep make none.
      expect((await s.make('grace', 'sign_offs', { job_id: job, signer_name: 'G' })).statusCode).toBe(403);
      expect((await s.make('dana', 'sign_offs', { job_id: job, signer_name: 'D' })).statusCode).toBe(403);
    });

    it('keeps the signature and photos as files (F19): only the writer\'s own fresh upload, never another\'s; a correction names a sign-off of its own job', async () => {
      const { job } = await wonJob('Files sign-off');
      const { job: other } = await wonJob('Another job');
      const upload = async (who: string, column: 'signature' | 'photos'): Promise<string> => {
        const query = new URLSearchParams({ connectionId: s.connectionId, table: s.t('sign_offs'), column, filename: `${column}.png` });
        const res = await s.app.inject({ method: 'POST', url: `/api/v1/files?${query.toString()}`, headers: { cookie: s.cookie[who]!, 'content-type': 'image/png' }, payload: png().bytes });
        expect(res.statusCode, res.body).toBe(201);
        return (res.json() as { data: { id: string } }).data.id;
      };
      const code = (res: Reply): string => JSON.stringify(res.json());
      const signature = await upload('ada', 'signature');
      const photos = [await upload('ada', 'photos'), await upload('ada', 'photos')];
      const first = made(await s.make('ada', 'sign_offs', { job_id: job, check_1: true, signer_name: 'Ana Belova', signature, photos }));
      const kept = await row('tessa', 'sign_offs', first);
      expect([kept?.['signature'], kept?.['photos']]).toEqual([signature, photos]);
      // The record holds them: nobody takes them off by the file routes, the uploader neither.
      expect((await s.send('ada', 'DELETE', `/api/v1/files/${signature}`)).statusCode).toBe(409);
      // Another's upload, a file already held, one that was never uploaded: all the same refusal.
      const tessas = await upload('tessa', 'signature');
      for (const [who, value] of [['ada', tessas], ['tessa', signature], ['ada', 'file_01ZZZZZZZZZZZZZZZZZZZZZZZZ']] as const) {
        const res = await s.make(who, 'sign_offs', { job_id: other, signer_name: 'X', signature: value });
        expect(res.statusCode, `${who} naming ${value}`).toBe(422);
        expect(code(res)).toContain('file-not-here');
      }
      // A correction names a sign-off of its own job, never another job's.
      const others = made(await s.make('ada', 'sign_offs', { job_id: other, signer_name: 'Ben Ode' }));
      expect((await s.make('ada', 'sign_offs', { job_id: job, signer_name: 'Ana Belova', corrects_id: others })).statusCode).toBe(422);
      expect(Number((await row('ada', 'sign_offs', made(await s.make('ada', 'sign_offs', { job_id: job, signer_name: 'Ana Belova', corrects_id: first }))))?.['version'])).toBe(2);
    });

    it('removes a visit called off, with the why in the removal\'s audit entry, and keeps a visit that was made', async () => {
      const { job } = await wonJob('Corridor benches');
      const id = await visit(job, 'Corridor benches', { day: day(4), crew: 'red' });
      // There is no "cancelled" to set.
      expect((await s.change('ada', 'job_visits', id, { state: 'cancelled' })).statusCode).toBeGreaterThanOrEqual(400);
      expect(said(await s.change('ada', 'job_visits', id, { cancel_reason: 'Lift out of order' }))).toBe('ok');
      expect(said(await remove('ada', 'job_visits', id))).toBe('ok');
      expect(await s.rows(`select id from crm_job_visits where id = ${String(id)}`)).toEqual([]);
      const logged = await s.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes', 'actorLabel']).where('entityId', '=', String(id)).where('action', 'like', '%delete%').execute();
      const mine = logged.filter((entry) => JSON.stringify(entry.changes).includes('Lift out of order'));
      expect(mine, JSON.stringify(logged)).toHaveLength(1);
      expect(String(mine[0]!.actorLabel)).toMatch(/ada/i);
      // Made: it stays, whoever asks. A rep, Read-only and the crew remove nothing.
      const done = await visit(job, 'Corridor benches, second run', { day: day(4), crew: 'red' });
      expect(said(await act('ada', 'job_visits', done, 'done', 'booked'))).toBe('ok');
      expect((await remove('ada', 'job_visits', done)).statusCode).toBe(409);
      expect((await remove('tessa', 'job_visits', done)).statusCode).toBe(409);
      const other = await visit(job, 'Corridor benches, third run');
      for (const who of ['dana', 'grace', 'rina']) expect((await remove(who, 'job_visits', other)).statusCode, who).toBeGreaterThanOrEqual(403);
      expect((await s.change('grace', 'job_visits', other, { note: 'x' })).statusCode).toBe(403);
      expect((await s.make('grace', 'job_visits', { job_id: job, kind: 'drop', what: 'x', hours: 1, crew_size: 1 })).statusCode).toBe(403);
      expect(said(await remove('ada', 'job_visits', other))).toBe('ok');
    });

    it('works out a delivery note\'s totals and whether it needs sorting, and the crew reads its notes without the totals', async () => {
      const { job } = await wonJob('Theatre trolleys');
      const id = await visit(job, 'Theatre trolleys', { day: day(2), crew: 'blue' });
      const note = made(await s.make('ada', 'delivery_notes', { job_id: job, visit_id: id }));
      const read = async (): Promise<number[]> => {
        const one = (await row('ada', 'delivery_notes', note))!;
        return [Number(one['ordered']), Number(one['delivered']), Number(one['short']), Number(one['needs_sorting'])];
      };
      // Nothing on it, never signed: it needs sorting.
      expect(await read()).toEqual([0, 0, 0, 1]);
      made(await s.make('ada', 'delivery_note_lines', { note_id: note, job_id: job, visit_id: id, what: 'Trolleys', ordered: 4, delivered: 4 }));
      const tray = made(await s.make('ada', 'delivery_note_lines', { note_id: note, job_id: job, visit_id: id, what: 'Trays', ordered: 6, delivered: 5 }));
      expect(await read()).toEqual([10, 9, 1, 1]);
      // Signed, but short: still to sort. All there: clean. Damage noted: to sort again.
      expect(said(await s.change('ada', 'delivery_notes', note, { signed_name: 'Ana Belova' }))).toBe('ok');
      expect(await read()).toEqual([10, 9, 1, 1]);
      expect(said(await s.change('ada', 'delivery_note_lines', tray, { delivered: 6 }))).toBe('ok');
      expect(await read()).toEqual([10, 10, 0, 0]);
      expect(said(await s.change('ada', 'delivery_notes', note, { damage: true }))).toBe('ok');
      expect(await read()).toEqual([10, 10, 0, 1]);
      // Sorted by the office: no longer to sort, and the day it was is the server's.
      expect(said(await s.change('ada', 'delivery_notes', note, { sorted: true }))).toBe('ok');
      expect(await read()).toEqual([10, 10, 0, 0]);
      expect(String((await row('ada', 'delivery_notes', note))?.['sorted_on']).slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
      // Nobody types a total.
      await s.change('ada', 'delivery_notes', note, { ordered: 99, short: 5 });
      expect((await read()).slice(0, 3)).toEqual([10, 10, 0]);
      // The crew whose visit it was reads the note, not its totals; the other crew reads nothing of it; nor does the crew sort it.
      const theirs = await row('yusuf', 'delivery_notes', note);
      expect(theirs?.['signed_name']).toBe('Ana Belova');
      expect(Object.keys(theirs ?? {}).filter((key) => ['ordered', 'delivered', 'short', 'needs_sorting', 'sorted'].includes(key))).toEqual([]);
      expect(await row('rina', 'delivery_notes', note)).toBeNull();
      expect((await s.change('yusuf', 'delivery_notes', note, { sorted: false })).statusCode).toBeGreaterThanOrEqual(400);
    });

    it('keeps a crew member\'s phone, a job\'s address and its site phone to who may read what is personal', async () => {
      const { job } = await wonJob('Day-room chairs');
      expect(said(await s.change('ada', 'jobs', job, { address_lines: '4 Kingsway', town: 'Bristol', site_phone: '0117 496 0555' }))).toBe('ok');
      const id = await visit(job, 'Day-room chairs', { day: day(3), crew: 'blue' });
      const phoneOf = async (who: string): Promise<unknown> => (await list(who, 'crew_members')).find((one) => one['user_id'] === s.ids['yusuf'])?.['phone'];
      // The operations manager and the CRM admin read the phone; Read-only reads the crew, not the number.
      expect(await phoneOf('ada')).toBe('07700 900123');
      expect(await phoneOf('tessa')).toBe('07700 900123');
      expect(await phoneOf('grace')).not.toBe('07700 900123');
      // The job's address and phone: the operations manager and the crew on the visit read them; Read-only and the rep do not.
      expect((await row('ada', 'jobs', job))?.['site_phone']).toBe('0117 496 0555');
      expect((await row('yusuf', 'job_visits', id))?.['site_phone']).toBe('0117 496 0555');
      expect((await row('yusuf', 'job_visits', id))?.['site_address']).toBe('4 Kingsway');
      expect((await row('grace', 'jobs', job))?.['site_phone']).not.toBe('0117 496 0555');
      expect((await row('grace', 'jobs', job))?.['address_lines']).not.toBe('4 Kingsway');
      expect((await row('dana', 'job_visits', id))?.['site_phone']).not.toBe('0117 496 0555');
      // Nobody but the operations manager and the CRM admin keeps the crews.
      for (const who of ['dana', 'grace', 'yusuf']) expect((await s.make(who, 'crew_members', { crew_id: crew['blue'], user_id: s.ids['rina'] })).statusCode, who).toBe(403);
      expect((await s.get('lena', url('crew_members', '?limit=5'))).statusCode).toBe(403);
      expect(said(await remove('ada', 'job_visits', id))).toBe('ok');
    });
  });
}
