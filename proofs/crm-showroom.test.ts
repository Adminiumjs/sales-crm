// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 67, P19 with F17's and F20's showroom parts and F22's showroom mails:
 * SHOWROOM AND SAMPLES, against the whole server on SQLite, Postgres and
 * MySQL, with the app's own manifest, each try made signed in as the person
 * it is about.
 *
 *  - a booking: the front desk books, moves and cancels; two live bookings of
 *    one space never overlap (the server's refusal), whatever the state of
 *    the one in the way; a new booking starts "to confirm"; a create sent
 *    again with its key is the same booking;
 *  - a cancel REMOVES the booking, the why in the removal's audit entry; one
 *    somebody came in for is not removed, the admin included; a piece of
 *    display stock promised to it holds it until it lets go;
 *  - who: Read-only reads and changes nothing; the marketer, the account
 *    manager and the operations manager read nothing of the showroom;
 *  - the showroom's settings (hours, address, the mails' switch) are the CRM
 *    admin's: the sales manager and the front desk are refused;
 *  - samples: the server keeps each sample's pieces out and on the shelf, and
 *    refuses a loan that would take a piece the shelf does not have; a
 *    return puts it back; a loan keeps its chases; nobody below the admin
 *    types a kept total;
 *  - mails: a booking confirmed, moved and cancelled writes the visitor its
 *    e-mail; one never confirmed is told nothing; the switch stops all three.
 *
 * To run: `npm run proofs -- showroom` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { jobsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.36' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const DAY = 86_400_000;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's showroom and samples, on ${dialect}`, () => {
    let s: WholeServer;
    const space: Record<string, number> = {};
    let company = 0;
    let contact = 0;
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const row = async (who: string, ref: string, id: number): Promise<Record<string, unknown> | null> => {
      const res = await s.get(who, url(ref, `/${String(id)}`));
      return res.statusCode === 200 ? (res.json() as { data: Record<string, unknown> }).data : null;
    };
    const remove = (who: string, ref: string, id: number): Promise<Reply> => s.send(who, 'DELETE', url(ref, `/${String(id)}?confirm=true`));
    const act = (who: string, ref: string, id: number, action: string, from: string): Promise<Reply> => s.send(who, 'POST', url(ref, `/${String(id)}/actions/${action}`), { from });
    /** A whole hour some days on, so no two tries of a test meet by accident. */
    const at = (days: number, hour = 10, minute = 0): string => {
      const day = new Date(Date.now() + days * DAY);
      return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute)).toISOString();
    };
    const book = (who: string, where: string, starts: string, minutes = 60, extra: Record<string, unknown> = {}): Promise<Reply> =>
      s.make(who, 'showroom_bookings', { space_id: space[where], contact_id: contact, company_id: company, party: 1, starts_at: starts, minutes, ...extra });
    const code = (res: Reply): string => ((res.json() as { error?: { code?: string } }).error?.code ?? '') as string;
    const jobs = (): Promise<void> => s.jobs({ except: ['digest.send'] });

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { corin: ['front-desk'], tessa: ['admin'], grace: ['read-only'], lena: ['marketer'], hugo: ['account-manager'], ada: ['ops-manager'], ivy: ['sales-manager'], dana: ['rep'] },
        install: { modules: { showroom: true } },
        smtp: true,
      });
      for (const name of ['Main floor', 'Booth corner']) space[name === 'Main floor' ? 'main' : 'booth'] = made(await s.make('owner', 'showroom_spaces', { name }));
      company = made(await s.make('owner', 'companies', { name: 'Cobalt Legal' }));
      contact = made(await s.make('owner', 'contacts', { company_id: company, name: 'Ines Vaughan', email: 'ines.vaughan@cobalt-legal.com', may_email: true }));
      await jobs();
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('lets the front desk book a space; two live bookings of it never overlap, and the one in the way is not named', async () => {
      const first = made(await book('corin', 'main', at(3, 9, 30), 90, { party: 3, note: 'Records-room lockers, finish choices' }));
      // A new booking starts to be confirmed; it is not made confirmed.
      expect((await row('corin', 'showroom_bookings', first))?.['state']).toBe('tentative');
      expect((await book('corin', 'main', at(3, 14), 30, { state: 'confirmed' })).statusCode).toBe(409);
      // Inside the first's time, on the same space: refused, as it would be were the first confirmed.
      const inside = await book('corin', 'main', at(3, 10), 60);
      expect([inside.statusCode, code(inside)]).toEqual([409, 'BOOKING_TAKEN']);
      expect(inside.body).not.toContain('Records-room');
      expect(said(await act('corin', 'showroom_bookings', first, 'confirm', 'tentative'))).toBe('ok');
      expect(said(await book('corin', 'main', at(3, 10), 60))).toBe('409 BOOKING_TAKEN');
      // Another space at the same time, and the same space as the first ends: both taken.
      const booth = made(await book('corin', 'booth', at(3, 10), 60));
      const after = made(await book('corin', 'main', at(3, 11), 60));
      // A move onto the first is refused the same way, and a move clear of it goes.
      expect(said(await s.change('corin', 'showroom_bookings', after, { starts_at: at(3, 10, 30) }))).toBe('409 BOOKING_TAKEN');
      expect(said(await s.change('corin', 'showroom_bookings', after, { starts_at: at(3, 12), party: 2 }))).toBe('ok');
      // The CRM admin books too; Read-only, the marketer and the operations manager do not.
      const admins = made(await book('tessa', 'booth', at(4, 15), 45));
      for (const who of ['grace', 'lena', 'ada', 'hugo']) expect([who, (await book(who, 'booth', at(5, 9), 30)).statusCode]).toEqual([who, 403]);
      for (const id of [first, booth, after, admins]) {
        expect(said(await s.change('tessa', 'showroom_bookings', id, { cancel_reason: 'Proof over' }))).toBe('ok');
        expect(said(await remove('tessa', 'showroom_bookings', id))).toBe('ok');
      }
    });

    it('takes a create sent again with its key as the booking the first made, and refuses another key for the same time', async () => {
      const key = `showroom-proof-${dialect}-keyed-booking-0001`;
      const send = (clientKey: string, starts: string): Promise<Reply> => s.send('corin', 'POST', url('showroom_bookings'), { values: { space_id: space['booth'], contact_id: contact, company_id: company, party: 1, starts_at: starts, minutes: 45 }, clientKey });
      const one = await send(key, at(6, 11));
      expect(one.statusCode, one.body).toBe(201);
      const id = Number((one.json() as { data: { id: number } }).data.id);
      const again = await send(key, at(6, 11));
      expect(again.statusCode, again.body).toBeLessThan(300);
      expect(Number((again.json() as { data: { id: number } }).data.id)).toBe(id);
      expect(said(await send(`${key}-other`, at(6, 11)))).toBe('409 BOOKING_TAKEN');
      expect((await s.rows(`select id from crm_showroom_bookings where space_id = ${String(space['booth'])}`)).map((one) => Number(one['id']))).toEqual([id]);
      expect(said(await remove('corin', 'showroom_bookings', id))).toBe('ok');
    });

    it('removes a cancelled booking, with the why in the removal\'s audit entry, and frees its time', async () => {
      const id = made(await book('corin', 'main', at(7, 10), 60));
      // There is no cancelled mark, by the column or by a button.
      expect((await s.change('corin', 'showroom_bookings', id, { state: 'cancelled', cancel_reason: 'x' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await s.send('corin', 'POST', url('showroom_bookings', `/${String(id)}/actions/cancel`), { from: 'tentative', values: { cancel_reason: 'x' } })).statusCode).toBeGreaterThanOrEqual(400);
      // A piece of display stock promised to it holds it: the database refuses to remove a booking a piece names.
      const piece = made(await s.make('corin', 'display_pieces', { name: 'Locker wall, twelve doors', space_id: space['main'], out_since: at(-40).slice(0, 10), spec: 'current', promised_booking_id: id }));
      expect(said(await s.change('corin', 'showroom_bookings', id, { cancel_reason: 'They moved the day' }))).toBe('ok');
      expect((await remove('corin', 'showroom_bookings', id)).statusCode).toBeGreaterThanOrEqual(400);
      expect(Number((await row('corin', 'showroom_bookings', id))?.['id'])).toBe(id);
      // The piece lets go first (the screen does it), then the booking goes.
      expect(said(await s.change('corin', 'display_pieces', piece, { promised_booking_id: null }))).toBe('ok');
      expect(said(await remove('corin', 'showroom_bookings', id))).toBe('ok');
      expect(await row('tessa', 'showroom_bookings', id)).toBeNull();
      const logged = await s.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes', 'actorLabel']).where('entityId', '=', String(id)).where('action', 'like', '%delete%').execute();
      const mine = logged.filter((entry) => JSON.stringify(entry.changes).includes('They moved the day'));
      expect(mine, JSON.stringify(logged)).toHaveLength(1);
      expect(String(mine[0]!.actorLabel)).toMatch(/corin/i);
      // Its time is free again.
      const next = made(await book('corin', 'main', at(7, 10), 60));
      expect(said(await remove('corin', 'showroom_bookings', next))).toBe('ok');
      expect(said(await remove('corin', 'display_pieces', piece))).toBe('ok');
    });

    it('keeps a booking somebody came in for, and frees its space', async () => {
      const id = made(await book('corin', 'booth', at(-1, 15), 45));
      // They came in, without a confirmation first.
      expect(said(await act('corin', 'showroom_bookings', id, 'done', 'tentative'))).toBe('ok');
      expect((await remove('corin', 'showroom_bookings', id)).statusCode).toBe(409);
      expect((await remove('tessa', 'showroom_bookings', id)).statusCode).toBe(409);
      expect((await row('tessa', 'showroom_bookings', id))?.['state']).toBe('done');
      // It takes no time any more: another booking may overlap it.
      const over = made(await book('tessa', 'booth', at(-1, 15), 45));
      expect(said(await s.change('corin', 'showroom_bookings', id, { outcome: 'Liked the taller bay', next_step: 'Send the bay drawing', next_step_by: at(2).slice(0, 10), next_step_done_on: at(0).slice(0, 10) }))).toBe('ok');
      expect((await row('grace', 'showroom_bookings', id))?.['outcome']).toBe('Liked the taller bay');
      // Read-only reads it and writes nothing.
      expect((await s.change('grace', 'showroom_bookings', id, { outcome: 'Mine now' })).statusCode).toBe(403);
      expect((await remove('grace', 'showroom_bookings', over)).statusCode).toBe(403);
      // Nobody else of the app reads the showroom.
      for (const who of ['lena', 'hugo', 'ada']) for (const ref of ['showroom_bookings', 'samples', 'sample_loans', 'display_pieces']) expect([who, ref, (await s.get(who, url(ref, '?limit=5'))).statusCode]).toEqual([who, ref, 403]);
      expect(said(await s.change('tessa', 'showroom_bookings', over, { cancel_reason: 'Proof over' }))).toBe('ok');
      expect(said(await remove('tessa', 'showroom_bookings', over))).toBe('ok');
      await s.rows(`delete from crm_showroom_bookings where id = ${String(id)}`);
    });

    it('takes no web address, e-mail address or handle in what a visitor\'s e-mail repeats', async () => {
      for (const note of ['See https://evil.example now', 'Write to pay@evil.example', 'Ask @evil on the day']) {
        const res = await book('corin', 'booth', at(8, 10), 30, { note });
        expect(res.statusCode, note).toBe(422);
        expect(res.body, note).toContain('plain-text');
      }
    });

    it('keeps the showroom\'s settings the CRM admin\'s', async () => {
      const id = Number((await s.rows('select id from crm_settings'))[0]!['id']);
      expect(said(await s.change('tessa', 'settings', id, { showroom_opens: '10:00', showroom_closes: '18:00', showroom_address: 'Unit 2, Aire Works, Leeds', showroom_emails: true }))).toBe('ok');
      // The sales manager writes how the team sells, not the showroom; the front desk reads the settings and writes none.
      expect((await s.change('ivy', 'settings', id, { showroom_opens: '07:00' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await s.change('corin', 'settings', id, { showroom_closes: '23:00' })).statusCode).toBe(403);
      expect((await s.change('tessa', 'settings', id, { showroom_opens: '9am' })).statusCode).toBe(422);
      const kept = (await s.rows(`select showroom_opens, showroom_closes, showroom_address from crm_settings where id = ${String(id)}`))[0]!;
      expect([kept['showroom_opens'], kept['showroom_closes'], kept['showroom_address']]).toEqual(['10:00', '18:00', 'Unit 2, Aire Works, Leeds']);
      // A space is set up by the CRM admin.
      const extra = made(await s.make('tessa', 'showroom_spaces', { name: 'Meeting room' }));
      expect((await s.make('grace', 'showroom_spaces', { name: 'Hers' })).statusCode).toBe(403);
      expect(said(await remove('tessa', 'showroom_spaces', extra))).toBe('ok');
    });

    it('keeps each sample\'s pieces out and on the shelf, and refuses a loan the shelf cannot give', async () => {
      const sample = made(await s.make('corin', 'samples', { name: 'Acoustic panel set', kind: 'Panel', held: 2 }));
      const kept = async (): Promise<[number, number]> => {
        const one = await row('corin', 'samples', sample);
        return [Number(one?.['out']), Number(one?.['on_shelf'])];
      };
      expect(await kept()).toEqual([0, 2]);
      const lend = (who: string, extra: Record<string, unknown> = {}): Promise<Reply> => s.make(who, 'sample_loans', { sample_id: sample, company_id: company, contact_id: contact, out_on: at(0).slice(0, 10), due_back: at(14).slice(0, 10), ...extra });
      const one = made(await lend('corin'));
      const two = made(await lend('corin'));
      expect(await kept()).toEqual([2, 0]);
      // The shelf is empty: a third is refused, whoever asks.
      for (const who of ['corin', 'tessa']) {
        const third = await lend(who);
        expect(third.statusCode, `${who}: ${third.body}`).toBeGreaterThanOrEqual(400);
        expect(code(third), who).toBe('BALANCE_EXCEEDED');
      }
      // Nobody below the admin types a kept total.
      expect((await s.change('corin', 'samples', sample, { out: 0 })).statusCode).toBeGreaterThanOrEqual(400);
      expect(await kept()).toEqual([2, 0]);
      // A sample cannot be held fewer than are out.
      expect((await s.change('corin', 'samples', sample, { held: 1 })).statusCode).toBeGreaterThanOrEqual(400);
      // It came back: the piece is on the shelf again, and can go out again.
      expect(said(await s.change('corin', 'sample_loans', one, { returned_on: at(0).slice(0, 10) }))).toBe('ok');
      expect(await kept()).toEqual([1, 1]);
      // A chase is kept on its loan, stamped with who chased.
      made(await s.make('corin', 'sample_chases', { loan_id: two, chased_on: at(0).slice(0, 10) }));
      expect(Number((await row('corin', 'sample_loans', two))?.['chases'])).toBe(1);
      const chase = (await s.rows(`select by_id from crm_sample_chases where loan_id = ${String(two)}`))[0]!;
      expect(chase['by_id']).toBe(s.ids['corin']);
      expect((await s.change('corin', 'sample_loans', two, { chases: 9 })).statusCode).toBeGreaterThanOrEqual(400);
      // Read-only and the operations manager lend nothing.
      for (const who of ['grace', 'ada']) expect((await lend(who)).statusCode).toBe(403);
      await s.rows(`delete from crm_sample_chases where loan_id = ${String(two)}`);
      await s.rows(`delete from crm_sample_loans where sample_id = ${String(sample)}`);
      await s.rows(`delete from crm_samples where id = ${String(sample)}`);
    });

    it('mails the visitor when a booking is confirmed, moved and cancelled, never one that was not confirmed, and not at all with the switch off', async () => {
      await s.emails();
      const id = Number((await s.rows('select id from crm_settings'))[0]!['id']);
      const rows = async (): Promise<Record<string, unknown>[]> => s.rows(`select * from crm_outbox where kind like 'showroom-%' order by id`);
      await s.rows(`delete from crm_outbox where kind like 'showroom-%'`);

      // Pencilled in, moved and cancelled before it was confirmed: the visitor is told nothing.
      const quiet = made(await book('corin', 'main', at(9, 10), 60));
      expect(said(await s.change('corin', 'showroom_bookings', quiet, { starts_at: at(9, 14) }))).toBe('ok');
      expect(said(await s.change('corin', 'showroom_bookings', quiet, { cancel_reason: 'Never firm' }))).toBe('ok');
      expect(said(await remove('corin', 'showroom_bookings', quiet))).toBe('ok');
      await jobs();
      expect(await rows()).toEqual([]);

      // Booked and confirmed: one mail. Moved: one more, keeping the time it had, waiting a quarter of an hour. Cancelled: the third.
      const booking = made(await book('corin', 'booth', at(10, 10), 60, { note: 'Acoustic booth, sound test' }));
      expect(said(await act('corin', 'showroom_bookings', booking, 'confirm', 'tentative'))).toBe('ok');
      await jobs();
      expect((await rows()).map((one) => [one['kind'], one['to'], Number(one['booking_id']), Number(one['contact_id'])])).toEqual([['showroom-confirmed', 'ines.vaughan@cobalt-legal.com', booking, contact]]);
      expect(said(await s.change('corin', 'showroom_bookings', booking, { starts_at: at(11, 11) }))).toBe('ok');
      // A save that moves no time writes nothing.
      expect(said(await s.change('corin', 'showroom_bookings', booking, { party: 2 }))).toBe('ok');
      await jobs();
      expect((await rows()).map((one) => one['kind'])).toEqual(['showroom-confirmed', 'showroom-moved']);
      expect(String((await rows())[1]!['was'])).toContain('starts_at');
      expect([(await rows())[1]!['status'], (await rows())[1]!['due_at'] === null]).toEqual(['queued', false]);
      await s.rows(`update crm_outbox set due_at = '${dialect === 'mysql' ? '2000-01-01 00:00:00' : '2000-01-01T00:00:00.000Z'}' where kind = 'showroom-moved'`);
      await jobsRepo(s.meta).enqueue({ kind: 'app-outbox-send', payload: { app: 'crm' }, dedupeKey: `app-outbox-send:crm:showroom-window-${dialect}` });
      await jobs();
      expect(said(await s.change('corin', 'showroom_bookings', booking, { cancel_reason: 'Office move' }))).toBe('ok');
      expect(said(await remove('corin', 'showroom_bookings', booking))).toBe('ok');
      await jobs();
      const all = await rows();
      expect(all.map((one) => one['kind'])).toEqual(['showroom-confirmed', 'showroom-moved', 'showroom-cancelled']);
      for (const one of all) expect(one['booking_id']).toBeNull();
      expect([all[2]!['to'], Number(all[2]!['contact_id'])]).toEqual(['ines.vaughan@cobalt-legal.com', contact]);
      // Each goes on every engine (the Postgres fault F21's proof writes down, a staff column taken for a key, is not met here).
      for (const one of all) expect(['sent', 'queued'], `${String(one['kind'])}: ${String(one['error'])}`).toContain(one['status']);
      const mails = (await s.emails()).filter((mail) => mail.to === 'ines.vaughan@cobalt-legal.com');
      {
        expect(mails.map((mail) => mail.templateKey)).toEqual(['crm-showroom-confirmed', 'crm-showroom-moved', 'crm-showroom-cancelled']);
        const [confirmed, moved, cancelled] = mails;
        expect(confirmed!.subject).toMatch(/^Your showroom visit on .+ is confirmed$/);
        expect(confirmed!.text).toContain('Hello Ines, your visit to our showroom is confirmed for');
        expect(confirmed!.text).toContain('Booth corner');
        expect(confirmed!.text).toContain('Acoustic booth, sound test');
        expect(confirmed!.text).toContain('Unit 2, Aire Works, Leeds');
        expect(moved!.text).toContain('Hello Ines, the visit to our showroom that was on');
        expect(cancelled!.subject).toMatch(/^Your showroom visit on .+ is cancelled$/);
        for (const mail of mails) expect(`${mail.subject} ${mail.text}`).not.toMatch(/\{\{|Office move/);
      }

      // The switch, off: a booking confirmed is told nothing.
      expect(said(await s.change('tessa', 'settings', id, { showroom_emails: false }))).toBe('ok');
      await s.rows(`delete from crm_outbox where kind like 'showroom-%'`);
      const silent = made(await book('corin', 'main', at(12, 10), 60));
      expect(said(await act('corin', 'showroom_bookings', silent, 'confirm', 'tentative'))).toBe('ok');
      await jobs();
      expect(await rows()).toEqual([]);
      expect(said(await s.change('tessa', 'settings', id, { showroom_emails: true }))).toBe('ok');
      expect(said(await s.change('corin', 'showroom_bookings', silent, { cancel_reason: 'Proof over' }))).toBe('ok');
      expect(said(await remove('corin', 'showroom_bookings', silent))).toBe('ok');
    });
  });
}
