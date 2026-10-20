// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 67, stage 3 (P25, part B): TIME SHEETS AND CERTIFICATES, against the
 * whole server on SQLite, Postgres and MySQL, with the app's own manifest and
 * Vehicles and crew switched on, each try made signed in as the person it is
 * about.
 *
 *  - A crew member reads and writes his own time sheets and their lines, and
 *    nobody else's by any door (a record, a list, a figure, a change, a line
 *    hung under somebody else's sheet); he makes a sheet only for himself; he
 *    removes neither; the hours on a sheet are kept by the server from its
 *    lines.
 *  - A week is sent with a day written in it; once sent, its lines and the
 *    sheet are locked; only the operations manager and the CRM admin sign it
 *    off or send it back, and a sending back needs its reason; sent back, the
 *    crew member corrects it and sends it again; signed off, nobody changes
 *    it any more, its answerer included. When it was sent and who signed it
 *    are stamped by the server.
 *  - A certificate is read by its holder and by the office (the operations
 *    manager, the CRM admin, Read-only) only; the operations manager and the
 *    admin write them; a rep, a sales manager, the crew member himself do not.
 *  - The part's two numbers on the settings row are held between bounds.
 *
 * The screens, as each person is answered, are on the browser stand:
 * `e2e/hours-*.e2e.ts`.
 *
 * To run: `npm run proofs -- hours` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.30' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const WEEK = '2026-07-13';
const EMPTY_WEEK = '2026-07-06';

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's time sheets and certificates, on ${dialect}`, () => {
    let s: WholeServer;
    /** Yusuf's sheet and line, Cal's sheet and line; certificates of each. */
    const at = { yusufSheet: 0, yusufLine: 0, calSheet: 0, calLine: 0, yusufCert: 0, calCert: 0, settings: 0 };

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
    const one = async (who: string, ref: string, id: number): Promise<Record<string, unknown> | null> => {
      const res = await s.get(who, url(ref, `/${String(id)}`));
      return res.statusCode === 200 ? (res.json() as { data: Record<string, unknown> }).data : null;
    };
    const count = (who: string, ref: string): Promise<Reply> =>
      s.send(who, 'POST', '/api/v1/widget-data/query', { descriptor: { connectionId: s.connectionId, source: { name: s.t(ref) }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] } });
    const valueOf = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(200);
      return Number((res.json() as { result: { value?: number } }).result.value ?? 0);
    };
    const act = (who: string, id: number, action: string, from: string, values?: Record<string, unknown>): Promise<Reply> =>
      s.send(who, 'POST', url('time_sheets', `/${String(id)}/actions/${action}`), { from, ...(values === undefined ? {} : { values }) });
    const remove = (who: string, ref: string, id: number): Promise<Reply> => s.send(who, 'DELETE', url(ref, `/${String(id)}?confirm=true`));
    const refused = (res: Reply): boolean => res.statusCode >= 400 && res.statusCode < 500;
    const state = async (id: number): Promise<string> => String((await one('ada', 'time_sheets', id))?.['state']);

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { yusuf: ['crew'], cal: ['crew'], ada: ['ops-manager'], tessa: ['admin'], grace: ['read-only'], dana: ['rep'], ivy: ['sales-manager'] },
        install: { modules: { jobs: true, fleet: true } },
      });
      at.yusufSheet = made(await s.make('yusuf', 'time_sheets', { user_id: s.ids['yusuf'], week_of: WEEK }));
      at.calSheet = made(await s.make('cal', 'time_sheets', { user_id: s.ids['cal'], week_of: WEEK }));
      at.yusufLine = made(await s.make('yusuf', 'time_sheet_lines', { sheet_id: at.yusufSheet, day: WEEK, what: 'Depot, rebuild a bench top', hours: 7, travel_hours: 1.5 }));
      at.calLine = made(await s.make('cal', 'time_sheet_lines', { sheet_id: at.calSheet, day: WEEK, what: 'Depot, stock check', hours: 5, travel_hours: 0 }));
      at.yusufCert = made(await s.make('ada', 'certificates', { user_id: s.ids['yusuf'], name: 'Working at height', valid_until: '2026-09-12' }));
      at.calCert = made(await s.make('ada', 'certificates', { user_id: s.ids['cal'], name: 'First aid at work', valid_until: '2026-07-12' }));
      at.settings = (await ids('tessa', 'settings'))[0]!;
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it("holds a crew member to his own sheets and lines, by every door, and keeps a sheet's hours from its lines", async () => {
      expect(await ids('yusuf', 'time_sheets')).toEqual([at.yusufSheet]);
      expect(await ids('yusuf', 'time_sheet_lines')).toEqual([at.yusufLine]);
      expect(await one('yusuf', 'time_sheets', at.calSheet)).toBeNull();
      expect(await one('yusuf', 'time_sheet_lines', at.calLine)).toBeNull();
      expect(valueOf(await count('yusuf', 'time_sheets'))).toBe(1);
      expect(valueOf(await count('yusuf', 'time_sheet_lines'))).toBe(1);
      // The office reads both.
      expect(await ids('ada', 'time_sheets')).toEqual([at.yusufSheet, at.calSheet].sort((a, b) => a - b));
      expect(valueOf(await count('grace', 'time_sheet_lines'))).toBe(2);
      // He makes a sheet for himself only, and hangs a line only under his own sheet.
      expect(refused(await s.make('yusuf', 'time_sheets', { user_id: s.ids['cal'], week_of: EMPTY_WEEK }))).toBe(true);
      expect(refused(await s.make('yusuf', 'time_sheet_lines', { sheet_id: at.calSheet, day: WEEK, what: 'Not mine', hours: 1, travel_hours: 0 }))).toBe(true);
      expect(await ids('ada', 'time_sheet_lines')).toEqual([at.yusufLine, at.calLine].sort((a, b) => a - b));
      // He changes nothing of a crew-mate's, and moves no line of his to a crew-mate's sheet.
      expect(refused(await s.change('yusuf', 'time_sheet_lines', at.calLine, { hours: 9 }))).toBe(true);
      expect(refused(await s.change('yusuf', 'time_sheets', at.calSheet, { week_of: EMPTY_WEEK }))).toBe(true);
      expect(refused(await s.change('yusuf', 'time_sheet_lines', at.yusufLine, { sheet_id: at.calSheet }))).toBe(true);
      // Nor the columns that are the office's, on his own sheet; nor a removal of either.
      expect(refused(await s.change('yusuf', 'time_sheets', at.yusufSheet, { sent_back_note: 'All fine' }))).toBe(true);
      expect(refused(await s.change('yusuf', 'time_sheets', at.yusufSheet, { state: 'signed-off' }))).toBe(true);
      expect(refused(await remove('yusuf', 'time_sheet_lines', at.yusufLine))).toBe(true);
      expect(refused(await remove('yusuf', 'time_sheets', at.yusufSheet))).toBe(true);
      // The hours are the server's: kept from the lines, a total of the two, and a value sent for them is not kept.
      const sheet = (await one('yusuf', 'time_sheets', at.yusufSheet))!;
      expect([Number(sheet['hours_total']), Number(sheet['travel_total']), Number(sheet['total_hours'])]).toEqual([7, 1.5, 8.5]);
      expect(said(await s.change('yusuf', 'time_sheet_lines', at.yusufLine, { hours: 6.5 }))).toBe('ok');
      expect(Number((await one('ada', 'time_sheets', at.yusufSheet))!['total_hours'])).toBe(8);
      await s.change('yusuf', 'time_sheets', at.yusufSheet, { hours_total: 99 });
      expect(Number((await one('ada', 'time_sheets', at.yusufSheet))!['hours_total'])).toBe(6.5);
      // Nobody outside the office and the crew reads a time sheet.
      for (const who of ['dana', 'ivy']) {
        for (const ref of ['time_sheets', 'time_sheet_lines']) {
          expect((await s.get(who, url(ref, '?limit=1'))).statusCode, `${who} ${ref}`).toBe(403);
          expect((await count(who, ref)).statusCode, `${who} ${ref} figure`).toBe(403);
        }
      }
    });

    it('sends a week with a day in it; once sent it is locked, and only the operations manager or the admin answers it', async () => {
      // A week with no day written is not sent.
      const empty = made(await s.make('yusuf', 'time_sheets', { user_id: s.ids['yusuf'], week_of: EMPTY_WEEK }));
      const nothing = await act('yusuf', empty, 'send', 'open');
      expect(nothing.statusCode, nothing.body).toBe(409);
      expect(await state(empty)).toBe('open');

      expect(said(await act('yusuf', at.yusufSheet, 'send', 'open'))).toBe('ok');
      const sent = (await one('yusuf', 'time_sheets', at.yusufSheet))!;
      expect(sent['state']).toBe('sent');
      expect(sent['sent_at'], 'stamped when it was sent').not.toBeNull();
      // Sent, it is the office's: its lines and the sheet are locked for him.
      expect((await s.change('yusuf', 'time_sheet_lines', at.yusufLine, { hours: 7 })).statusCode).toBe(409);
      expect((await s.make('yusuf', 'time_sheet_lines', { sheet_id: at.yusufSheet, day: '2026-07-14', what: 'Late add', hours: 2, travel_hours: 0 })).statusCode).toBe(409);
      expect(refused(await s.change('yusuf', 'time_sheets', at.yusufSheet, { week_of: EMPTY_WEEK }))).toBe(true);
      // He does not answer his own week, nor does Read-only, a rep or a sales manager.
      for (const who of ['yusuf', 'grace', 'dana', 'ivy']) {
        expect(refused(await act(who, at.yusufSheet, 'sign-off', 'sent')), `${who} signs off`).toBe(true);
        expect(refused(await act(who, at.yusufSheet, 'send-back', 'sent', { sent_back_note: 'Check Tuesday' })), `${who} sends back`).toBe(true);
      }
      expect(await state(at.yusufSheet)).toBe('sent');

      // Sending back needs its reason.
      expect(refused(await act('ada', at.yusufSheet, 'send-back', 'sent'))).toBe(true);
      expect(said(await act('ada', at.yusufSheet, 'send-back', 'sent', { sent_back_note: 'Monday says 6.5 h; the van log says 7.' }))).toBe('ok');
      const back = (await one('yusuf', 'time_sheets', at.yusufSheet))!;
      expect([back['state'], back['sent_back_note']]).toEqual(['sent-back', 'Monday says 6.5 h; the van log says 7.']);
      // Sent back, it is his again: he corrects the day and sends it again.
      expect(said(await s.change('yusuf', 'time_sheet_lines', at.yusufLine, { hours: 7 }))).toBe('ok');
      expect(said(await act('yusuf', at.yusufSheet, 'send', 'sent-back'))).toBe('ok');
      expect(said(await act('ada', at.yusufSheet, 'sign-off', 'sent'))).toBe('ok');
      const signed = (await one('yusuf', 'time_sheets', at.yusufSheet))!;
      expect([signed['state'], signed['signed_by_id'], signed['signed_at'] !== null, Number(signed['total_hours'])]).toEqual(['signed-off', s.ids['ada'], true, 8.5]);

      // The CRM admin answers a week too.
      expect(said(await act('cal', at.calSheet, 'send', 'open'))).toBe('ok');
      expect(said(await act('tessa', at.calSheet, 'sign-off', 'sent'))).toBe('ok');
      expect((await one('cal', 'time_sheets', at.calSheet))!['signed_by_id']).toBe(s.ids['tessa']);
    });

    it('changes a signed-off week no more, whoever asks', async () => {
      expect(await state(at.yusufSheet)).toBe('signed-off');
      for (const who of ['ada', 'tessa']) {
        expect(refused(await s.change(who, 'time_sheets', at.yusufSheet, { sent_back_note: 'Changed my mind' })), `${who}: the note`).toBe(true);
        expect(refused(await act(who, at.yusufSheet, 'send-back', 'signed-off', { sent_back_note: 'Again' })), `${who}: send back`).toBe(true);
        expect(refused(await s.change(who, 'time_sheets', at.yusufSheet, { state: 'sent-back', sent_back_note: 'Again' })), `${who}: a plain change`).toBe(true);
      }
      expect(refused(await act('yusuf', at.yusufSheet, 'send', 'signed-off'))).toBe(true);
      expect(refused(await s.change('yusuf', 'time_sheet_lines', at.yusufLine, { hours: 9 }))).toBe(true);
      expect(refused(await s.make('yusuf', 'time_sheet_lines', { sheet_id: at.yusufSheet, day: '2026-07-15', what: 'After', hours: 1, travel_hours: 0 }))).toBe(true);
      expect(refused(await remove('tessa', 'time_sheets', at.yusufSheet))).toBe(true);
      const kept = (await one('ada', 'time_sheets', at.yusufSheet))!;
      expect([kept['state'], kept['sent_back_note'], Number(kept['total_hours'])]).toEqual(['signed-off', 'Monday says 6.5 h; the van log says 7.', 8.5]);
    });

    it('lets a certificate be read by its holder and the office only, and written by the office', async () => {
      // His own and nobody else's, by a record, a list and a figure.
      expect(await ids('yusuf', 'certificates')).toEqual([at.yusufCert]);
      expect(await one('yusuf', 'certificates', at.calCert)).toBeNull();
      expect(valueOf(await count('yusuf', 'certificates'))).toBe(1);
      // He keeps none of them, his own included.
      expect(refused(await s.make('yusuf', 'certificates', { user_id: s.ids['yusuf'], name: 'Forklift', valid_until: '2027-01-01' }))).toBe(true);
      expect(refused(await s.change('yusuf', 'certificates', at.yusufCert, { valid_until: '2030-01-01' }))).toBe(true);
      expect(refused(await remove('yusuf', 'certificates', at.yusufCert))).toBe(true);
      // The office reads all; Read-only writes nothing.
      for (const who of ['ada', 'tessa', 'grace']) expect(await ids(who, 'certificates'), who).toEqual([at.yusufCert, at.calCert].sort((a, b) => a - b));
      expect(refused(await s.change('grace', 'certificates', at.calCert, { course_on: '2026-08-03' }))).toBe(true);
      expect(refused(await s.make('grace', 'certificates', { user_id: s.ids['cal'], name: 'Forklift', valid_until: '2027-01-01' }))).toBe(true);
      // A rep and a sales manager read none, by any door.
      for (const who of ['dana', 'ivy']) {
        expect((await s.get(who, url('certificates', '?limit=1'))).statusCode, who).toBe(403);
        expect((await s.get(who, url('certificates', `/${String(at.yusufCert)}`))).statusCode, who).toBeGreaterThanOrEqual(403);
        expect((await count(who, 'certificates')).statusCode, `${who} figure`).toBe(403);
      }
      // The operations manager books a course and renews; the admin too; and one is taken off.
      expect(said(await s.change('ada', 'certificates', at.calCert, { course_on: '2026-08-03' }))).toBe('ok');
      expect(said(await s.change('tessa', 'certificates', at.calCert, { valid_until: '2029-08-03', course_on: null }))).toBe('ok');
      expect((await one('cal', 'certificates', at.calCert))!['course_on']).toBeNull();
      const extra = made(await s.make('tessa', 'certificates', { user_id: s.ids['cal'], name: 'Forklift, counterbalance', valid_until: '2027-01-19' }));
      expect(said(await remove('ada', 'certificates', extra))).toBe('ok');
      expect(await one('tessa', 'certificates', extra)).toBeNull();
    });

    it("holds the part's two numbers between their bounds, and leaves them the admin's", async () => {
      for (const [ref, low, high, fine] of [['certificate_warn_days', 0, 181, 30], ['inspection_warn_days', 0, 91, 21]] as const) {
        for (const value of [low, high]) expect((await s.change('tessa', 'settings', at.settings, { [ref]: value })).statusCode, `${ref} ${String(value)}`).toBe(422);
        expect(said(await s.change('tessa', 'settings', at.settings, { [ref]: fine })), ref).toBe('ok');
        for (const who of ['ada', 'ivy', 'yusuf', 'grace']) expect((await s.change(who, 'settings', at.settings, { [ref]: fine + 1 })).statusCode, `${who} ${ref}`).toBe(403);
      }
      // The crew member reads the warning his phone uses.
      expect(Number((await one('yusuf', 'settings', at.settings))!['certificate_warn_days'])).toBe(30);
    });
  });
}
