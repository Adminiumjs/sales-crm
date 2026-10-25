// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 68, phase 4 (T26c): THE GUARDS THE ENGINE OF 0.3.35 GIVES THE CRM,
 * against the whole server on SQLite, Postgres and MySQL, with the app's own
 * manifest, each try made signed in as the person it limits.
 *
 *  - R5 (E13): a won or lost deal brought in from a file without its closed
 *    moment is named in the preview, by its column, and not brought in; one
 *    that carries it keeps it and its own closed day (the same cell), never
 *    the import's day. A person's own move to won still stamps both.
 *  - R8 (E23): who ticked "may be e-mailed", and when, are the server's: the
 *    CRM admin's file that carries either is refused, by its column, and so is
 *    a rep's; a value sent beside a tick is not taken. A blank cell is no on a
 *    new contact and leaves a saved contact's answer as it was.
 *  - X4 (E14): Settings' pairs (warm below stale, the warning below the
 *    quote's validity, the day's start before its end, the showroom's opening
 *    before its closing), each refusal naming both settings; the depot's
 *    country from the built-in list.
 *  - X5 (E14): a cover ends no sooner than it starts and at most 365 days on;
 *    an empty end is "until further notice".
 *  - X6 (E14's guard): an enquiry's deal is set only while it is claimed, by
 *    whoever claimed it.
 *  - X7 (E14, D18): a visit is never made to start in the past; a file brought
 *    in by the install's owner (history) is not held to it.
 *  - K1 (E18): a sample job signed off books its aftercare call for the sample
 *    person Settings names (who is not active), and Remove sample data takes it.
 *
 * To run: `npm run proofs -- p4-guards` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { teamsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.36' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;

/** A moment as milliseconds, however the driver hands it back (SQLite keeps one without a zone, on the server's wall clock). */
const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value).replace(' ', 'T')));
/** A date as `YYYY-MM-DD`, however the driver hands it back. */
const day = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return String(value).slice(0, 10);
};
const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';
const fields = (res: Reply): Record<string, { code: string }> => (res.json() as { error?: { details?: { fields?: Record<string, { code: string }> } } }).error?.details?.fields ?? {};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's phase-4 guards, on ${dialect}`, () => {
    let s: WholeServer;
    let settings = 0;
    let stage = 0;
    let company = 0;
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const act = (who: string, ref: string, key: number, action: string, from: string, values?: Record<string, unknown>): Promise<Reply> =>
      s.send(who, 'POST', url(ref, `/${String(key)}/actions/${action}`), { from, ...(values === undefined ? {} : { values }) });
    const one = async (sql: string): Promise<Record<string, unknown> | undefined> => (await s.rows(sql))[0];
    /** A file brought into a table by one person: what its preview says of each line, and what its run made. */
    const bring = async (who: string, ref: string, csv: string, columns: { from: string; to: string }[], options: Record<string, unknown> = { mode: 'insert' }) => {
      const up = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=lines.csv', headers: { cookie: s.cookie[who]!, 'content-type': 'text/csv' }, payload: csv });
      expect(up.statusCode, up.body).toBe(201);
      const fileId = (up.json() as { data: { fileId: string } }).data.fileId;
      const asked = await s.send(who, 'POST', '/api/v1/imports', { fileId, connectionId: s.connectionId, table: s.t(ref), mapping: { columns }, options });
      expect(asked.statusCode, asked.body).toBe(201);
      const importId = (asked.json() as { data: { import: { id: string } } }).data.import.id;
      const preview = await s.get(who, `/api/v1/imports/${importId}/preview`);
      expect(preview.statusCode, preview.body).toBe(200);
      const run = await s.send(who, 'POST', `/api/v1/imports/${importId}/run`);
      expect(run.statusCode, run.body).toBeLessThan(300);
      await s.jobs();
      const view = await s.get(who, `/api/v1/imports/${importId}`);
      return {
        lines: (preview.json() as { data: { lines: { row: number; status: string; column?: string; code?: string; message?: string }[] } }).data.lines,
        stats: (view.json() as { data: { stats: { inserted?: number; updated?: number; skipped?: number } } }).data.stats,
      };
    };
    const zone = (timezone: string) => s.meta.db.updateTable('adminium_connections').set({ timezone } as never).where('id', '=', s.connectionId).execute();

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { dana: ['rep'], sam: ['rep'], ivy: ['sales-manager'], tessa: ['admin'] },
        install: { modules: { inbox: true, showroom: true } },
      });
      const team = await teamsRepo(s.meta).create('Sales');
      await teamsRepo(s.meta).setMember(team.id, s.ids['ivy']!, true);
      for (const rep of ['dana', 'sam']) await teamsRepo(s.meta).setMember(team.id, s.ids[rep]!, false);
      settings = Number((await s.rows('select id from crm_settings'))[0]!['id']);
      stage = made(await s.make('owner', 'stages', { label: 'Proposal', odds: 0.5, position: 3 }));
      company = made(await s.make('owner', 'companies', { name: 'Harrow Engineering', customer_no: 'HARROW' }));
      await s.jobs();
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('R5: a closed deal brought in without its closed moment is named and not brought in; one with it keeps its own day', async () => {
      await zone('UTC');
      const owner = s.ids['dana']!;
      // A lost deal names why (the move's own rule), so the lost line carries a reason and only its date is missing.
      const reason = made(await s.make('owner', 'lost_reasons', { label: 'Price', position: 1 }));
      const csv = [
        'Name,Company,Owner,Stage,State,Reason,Closed',
        `R5 refit with no date,${String(company)},${owner},${String(stage)},won,,`,
        `R5 roof,${String(company)},${owner},${String(stage)},won,,2025-05-01T10:00:00Z`,
        `R5 lost doors,${String(company)},${owner},${String(stage)},lost,${String(reason)},`,
        `R5 still open,${String(company)},${owner},${String(stage)},open,,`,
      ].join('\n');
      const columns = [
        { from: 'Name', to: 'name' },
        { from: 'Company', to: 'company_id' },
        { from: 'Owner', to: 'owner_id' },
        { from: 'Stage', to: 'stage_id' },
        { from: 'State', to: 'state' },
        { from: 'Reason', to: 'lost_reason_id' },
        { from: 'Closed', to: 'closed_at' },
        { from: 'Closed', to: 'closed_on' },
      ];
      const brought = await bring('tessa', 'deals', csv, columns);
      // Refused by the closed moment or the closed day, whichever the server names first: both are the "Closed" cell.
      const closedCell = (column: unknown): unknown => (column === 'closed_on' ? 'closed_at' : column);
      expect(brought.lines.map((line) => [line.row, line.status, closedCell(line.column)])).toEqual([
        [1, 'refused', 'closed_at'],
        [2, 'new', undefined],
        [3, 'refused', 'closed_at'],
        [4, 'new', undefined],
      ]);
      // What the preview says of it, which the paste page words in the reader's language.
      expect(brought.lines[0]!.code).toBeDefined();
      expect(await s.rows(`select id from crm_deals where name = 'R5 refit with no date'`)).toEqual([]);
      const roof = (await one(`select closed_at, closed_on, state from crm_deals where name = 'R5 roof'`))!;
      expect(ms(roof['closed_at'])).toBe(Date.parse('2025-05-01T10:00:00Z'));
      // Its day is its own closed moment's, never the day it was brought in.
      expect(day(roof['closed_on'])).toBe('2025-05-01');
      const open = (await one(`select closed_at, closed_on from crm_deals where name = 'R5 still open'`))!;
      expect([open['closed_at'], open['closed_on']]).toEqual([null, null]);
      // The rep may not bring deals in at all.
      const up = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=d.csv', headers: { cookie: s.cookie['dana']!, 'content-type': 'text/csv' }, payload: csv });
      const fileId = up.statusCode === 201 ? (up.json() as { data: { fileId: string } }).data.fileId : 'none';
      expect((await s.send('dana', 'POST', '/api/v1/imports', { fileId, connectionId: s.connectionId, table: s.t('deals'), mapping: { columns }, options: { mode: 'insert' } })).statusCode).toBeGreaterThanOrEqual(400);
    });

    it('R5: a person moving her own deal to won is still stamped, the moment and its day', async () => {
      await zone('UTC');
      const deal = made(await s.make('dana', 'deals', { name: 'R5 live win', company_id: company, owner_id: s.ids['dana'], stage_id: stage }));
      expect(said(await act('dana', 'deals', deal, 'mark-won', 'open', { close_note: 'Signed today.' }))).toBe('ok');
      const won = (await one(`select closed_at, closed_on from crm_deals where id = ${String(deal)}`))!;
      expect(Math.abs(ms(won['closed_at']) - Date.now())).toBeLessThan(10 * 60_000);
      expect(day(won['closed_on'])).toBe(new Date(ms(won['closed_at'])).toISOString().slice(0, 10));
      // A reopen empties both again.
      expect(said(await act('dana', 'deals', deal, 'reopen', 'won'))).toBe('ok');
      expect(Object.values((await one(`select closed_at, closed_on from crm_deals where id = ${String(deal)}`))!)).toEqual([null, null]);
    });

    // The day is the file's own: the paste page maps the "Closed" cell to `closed_on` too, so a time typed without a zone
    // (as people type one) is the day it says, where the business is, never the moment's UTC day.
    it('R5: a closed moment just after midnight where the business is takes that day', async () => {
      await zone('Pacific/Auckland');
      try {
        const owner = s.ids['dana']!;
        const brought = await bring('tessa', 'deals', `Name,Company,Owner,Stage,State,Closed\nR5 midnight,${String(company)},${owner},${String(stage)},won,2025-07-01 01:30\n`, [
          { from: 'Name', to: 'name' },
          { from: 'Company', to: 'company_id' },
          { from: 'Owner', to: 'owner_id' },
          { from: 'Stage', to: 'stage_id' },
          { from: 'State', to: 'state' },
          { from: 'Closed', to: 'closed_at' },
        { from: 'Closed', to: 'closed_on' },
        ]);
        expect(brought.lines.map((line) => line.status)).toEqual(['new']);
        expect(day((await one(`select closed_on from crm_deals where name = 'R5 midnight'`))!['closed_on'])).toBe('2025-07-01');
      } finally {
        await zone('UTC');
      }
    });

    it('R5: a closed date given as a day alone is that day, where the business is', async () => {
      await zone('Europe/London');
      try {
        const owner = s.ids['dana']!;
        const brought = await bring('tessa', 'deals', `Name,Company,Owner,Stage,State,Closed\nR5 a day alone,${String(company)},${owner},${String(stage)},won,2025-07-01\n`, [
          { from: 'Name', to: 'name' },
          { from: 'Company', to: 'company_id' },
          { from: 'Owner', to: 'owner_id' },
          { from: 'Stage', to: 'stage_id' },
          { from: 'State', to: 'state' },
          { from: 'Closed', to: 'closed_at' },
        { from: 'Closed', to: 'closed_on' },
        ]);
        expect(brought.lines.map((line) => line.status)).toEqual(['new']);
        const row = (await one(`select closed_at, closed_on from crm_deals where name = 'R5 a day alone'`))!;
        expect(day(row['closed_on'])).toBe('2025-07-01');
      } finally {
        await zone('UTC');
      }
    });

    it('R8: who ticked "may be e-mailed" and when are never taken from a file, the CRM admin\'s or a rep\'s, nor from a save', async () => {
      for (const [who, name] of [['tessa', 'Ines Holt'], ['dana', 'Ola Berg']] as const) {
        for (const stamp of ['may_email_by_id', 'may_email_at'] as const) {
          const carried = stamp === 'may_email_by_id' ? s.ids['sam']! : '2020-01-01T09:00:00Z';
          const brought = await bring(who, 'contacts', `Company,Name,May email,Ticked\n${String(company)},${name} ${stamp},yes,${carried}\n${String(company)},${name} plain ${stamp},yes,\n`, [
            { from: 'Company', to: 'company_id' },
            { from: 'Name', to: 'name' },
            { from: 'May email', to: 'may_email' },
            { from: 'Ticked', to: stamp },
          ]);
          expect(brought.lines.map((line) => [line.status, line.column]), `${who} ${stamp}`).toEqual([
            ['refused', stamp],
            ['new', undefined],
          ]);
          expect(await s.rows(`select id from crm_contacts where name = '${name} ${stamp}'`)).toEqual([]);
          // The line that left it blank is stamped as whoever brought it, now.
          const plain = (await one(`select may_email, may_email_by_id, may_email_at from crm_contacts where name = '${name} plain ${stamp}'`))!;
          expect([yes(plain['may_email']), plain['may_email_by_id']]).toEqual([true, s.ids[who]]);
          expect(Math.abs(ms(plain['may_email_at']) - Date.now())).toBeLessThan(10 * 60_000);
        }
      }
      // A save that sends a name beside the tick: stamped as the writer whatever was sent.
      const contact = made(await s.make('dana', 'contacts', { company_id: company, name: 'R8 Mara Quist', may_email: false }));
      const tick = await s.change('dana', 'contacts', contact, { may_email: true, may_email_by_id: s.ids['sam'], may_email_at: '2020-01-01T09:00:00Z' });
      expect(['ok', '403 COLUMN_FORBIDDEN']).toContain(said(tick));
      if (said(tick) !== 'ok') expect(said(await s.change('dana', 'contacts', contact, { may_email: true }))).toBe('ok');
      const ticked = (await one(`select may_email, may_email_by_id, may_email_at from crm_contacts where id = ${String(contact)}`))!;
      expect([yes(ticked['may_email']), ticked['may_email_by_id']]).toEqual([true, s.ids['dana']]);
      expect(Math.abs(ms(ticked['may_email_at']) - Date.now())).toBeLessThan(10 * 60_000);
      // The CRM admin's save of a stamp alone changes nothing.
      expect(said(await s.change('tessa', 'contacts', contact, { may_email_by_id: s.ids['sam'] }))).toBe('ok');
      expect((await one(`select may_email_by_id from crm_contacts where id = ${String(contact)}`))!['may_email_by_id']).toBe(s.ids['dana']);
    });

    it('R8: a blank "may be e-mailed" is no on a new contact, and leaves a saved contact\'s answer as it was', async () => {
      const kept = made(await s.make('tessa', 'contacts', { company_id: company, name: 'R8 Pia Lund', reference: 'R8PIA', may_email: true }));
      // A rep's list: a new contact with the cell blank is no.
      const rep = await bring('dana', 'contacts', `Company,Name,May email\n${String(company)},R8 Tor Ek,\n`, [
        { from: 'Company', to: 'company_id' },
        { from: 'Name', to: 'name' },
        { from: 'May email', to: 'may_email' },
      ]);
      expect(rep.lines.map((line) => line.status)).toEqual(['new']);
      expect(yes((await one(`select may_email from crm_contacts where name = 'R8 Tor Ek'`))!['may_email'])).toBe(false);
      // The CRM admin's list that updates what is here: the blank cell leaves Pia's yes.
      const admin = await bring(
        'tessa',
        'contacts',
        `Reference,Name,Job title,May email\nR8PIA,R8 Pia Lund,Office manager,\n`,
        [
          { from: 'Reference', to: 'reference' },
          { from: 'Name', to: 'name' },
          { from: 'Job title', to: 'job_title' },
          { from: 'May email', to: 'may_email' },
        ],
        { mode: 'upsert', matchColumn: 'reference' },
      );
      expect(admin.lines.map((line) => line.status)).toEqual(['here']);
      const pia = (await one(`select may_email, job_title from crm_contacts where id = ${String(kept)}`))!;
      expect([yes(pia['may_email']), pia['job_title']]).toEqual([true, 'Office manager']);
    });

    it('X4: Settings\' pairs are refused naming both settings, as the CRM admin and the sales manager; the depot\'s country is from the list', async () => {
      const pairs: [string, string, unknown, unknown, unknown][] = [
        // [setting, the one it stays below, refused, its partner's refusing change, allowed]
        ['sitting_warm_days', 'sitting_stale_days', 30, 13, 20],
        ['quote_warn_days', 'quote_valid_days', 30, 3, 10],
        ['work_from', 'work_to', '17:30', '08:00', '09:00'],
        ['showroom_opens', 'showroom_closes', '18:00', '08:30', '10:00'],
      ];
      for (const [own, other, refused, partner, allowed] of pairs) {
        const who = own.startsWith('sitting') || own.startsWith('quote') ? ['tessa', 'ivy'] : ['tessa'];
        for (const person of who) {
          const above = await s.change(person, 'settings', settings, { [own]: refused });
          expect(said(above), `${person} ${own}`).toBe('422 VALIDATION_FAILED');
          expect(fields(above), `${person} ${own}`).toEqual({ [own]: { code: 'out-of-range' }, [other]: { code: 'out-of-range' } });
          // Moving the other one below it is refused too, naming both.
          const below = await s.change(person, 'settings', settings, { [other]: partner });
          expect(said(below), `${person} ${other}`).toBe('422 VALIDATION_FAILED');
          expect(fields(below)).toMatchObject({ [own]: { code: 'out-of-range' }, [other]: { code: 'out-of-range' } });
          expect(said(await s.change(person, 'settings', settings, { [own]: allowed })), `${person} ${own} allowed`).toBe('ok');
        }
      }
      const row = (await one(`select sitting_warm_days, quote_warn_days, work_from, showroom_opens from crm_settings where id = ${String(settings)}`))!;
      expect([Number(row['sitting_warm_days']), Number(row['quote_warn_days']), row['work_from'], row['showroom_opens']]).toEqual([20, 10, '09:00', '10:00']);
      expect(said(await s.change('tessa', 'settings', settings, { depot_country: 'ZZ' }))).not.toBe('ok');
      expect(said(await s.change('tessa', 'settings', settings, { depot_country: 'DE' }))).toBe('ok');
      expect(said(await s.change('tessa', 'settings', settings, { depot_country: 'GB' }))).toBe('ok');
    });

    it('X5: a cover ends at most a year after it starts, never before; an empty end is until further notice', async () => {
      const cover = (values: Record<string, unknown>) => s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], ...values });
      const longer = await cover({ starts_on: '2027-01-04', ends_on: '2028-01-05' });
      expect(said(longer)).toBe('422 VALIDATION_FAILED');
      expect(fields(longer)).toMatchObject({ ends_on: { code: 'out-of-range' }, starts_on: { code: 'out-of-range' } });
      expect(said(await cover({ starts_on: '2027-01-04', ends_on: '2027-01-01' }))).toBe('422 VALIDATION_FAILED');
      const year = made(await cover({ starts_on: '2027-01-04', ends_on: '2028-01-04' }));
      // Moving the start back makes it longer than a year: refused.
      expect(said(await s.change('ivy', 'covers', year, { starts_on: '2027-01-01' }))).toBe('422 VALIDATION_FAILED');
      expect(said(await s.send('ivy', 'DELETE', url('covers', `/${String(year)}?confirm=true`)))).toBe('ok');
      const open = made(await cover({ starts_on: '2027-03-01', ends_on: null }));
      expect(said(await s.change('ivy', 'covers', open, { ends_on: '2028-03-02' }))).toBe('422 VALIDATION_FAILED');
      expect(said(await s.send('ivy', 'DELETE', url('covers', `/${String(open)}?confirm=true`)))).toBe('ok');
    });

    it('X6: a rep ties an enquiry to a deal only while it is claimed, and only her own claim', async () => {
      const deal = made(await s.make('dana', 'deals', { name: 'X6 from a lead', company_id: company, owner_id: s.ids['dana'], stage_id: stage }));
      const enquiry = () => s.make('tessa', 'enquiries', { company_name: 'Lead Co', person: 'Ana', source: 'phone' });
      const unclaimed = made(await enquiry());
      const tie = (who: string, key: number) => s.change(who, 'enquiries', key, { deal_id: deal });
      // Not claimed: refused, and nothing is written.
      const early = await tie('dana', unclaimed);
      expect(said(early)).toBe('403 COLUMN_FORBIDDEN');
      expect((await one(`select deal_id from crm_enquiries where id = ${String(unclaimed)}`))!['deal_id']).toBeNull();
      // Her own claim: allowed.
      const hers = made(await enquiry());
      expect(said(await act('dana', 'enquiries', hers, 'claim', 'open'))).toBe('ok');
      expect(said(await tie('dana', hers))).toBe('ok');
      expect(Number((await one(`select deal_id from crm_enquiries where id = ${String(hers)}`))!['deal_id'])).toBe(deal);
      // Sam's claim: not hers to tie, whatever she can read of it.
      const his = made(await enquiry());
      expect(said(await act('sam', 'enquiries', his, 'claim', 'open'))).toBe('ok');
      expect(['403 COLUMN_FORBIDDEN', '404 NOT_FOUND']).toContain(said(await tie('dana', his)));
      expect((await one(`select deal_id from crm_enquiries where id = ${String(his)}`))!['deal_id']).toBeNull();
      // The CRM admin is held to it as well: the claimer ties it.
      expect(said(await tie('tessa', his))).toBe('403 COLUMN_FORBIDDEN');
    });

    it('X7: a visit is never made to start in the past; one brought in from a file is history and comes in', async () => {
      const deal = made(await s.make('dana', 'deals', { name: 'X7 site walk', company_id: company, owner_id: s.ids['dana'], stage_id: stage }));
      const visit = (starts_at: string) => s.make('dana', 'site_visits', { deal_id: deal, rep_id: s.ids['dana'], starts_at, minutes: 30, purpose: 'Walk the floor' });
      const past = await visit(new Date(Date.now() - 2 * 3_600_000).toISOString());
      expect(said(past)).toBe('422 VALIDATION_FAILED');
      expect(fields(past)).toEqual({ starts_at: { code: 'out-of-range' } });
      const soon = made(await visit(new Date(Date.now() + 26 * 3_600_000).toISOString()));
      // A later change may move it (a visit written up after the day): only a new visit is held.
      expect(said(await s.change('dana', 'site_visits', soon, { starts_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }))).toBe('ok');
      const brought = await bring('owner', 'site_visits', `Deal,Rep,Starts,Minutes,Purpose\n${String(deal)},${s.ids['dana']!},2025-03-04T10:00:00Z,45,An old survey\n`, [
        { from: 'Deal', to: 'deal_id' },
        { from: 'Rep', to: 'rep_id' },
        { from: 'Starts', to: 'starts_at' },
        { from: 'Minutes', to: 'minutes' },
        { from: 'Purpose', to: 'purpose' },
      ]);
      expect(brought.lines.map((line) => line.status)).toEqual(['new']);
      expect(ms((await one(`select starts_at from crm_site_visits where purpose = 'An old survey'`))!['starts_at'])).toBe(Date.parse('2025-03-04T10:00:00Z'));
    });
  });

  describe.skipIf(!reachable)(`K1: a sample sign-off books its aftercare call, on ${dialect}`, () => {
    let s: WholeServer;
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        install: { modules: { inbox: true, jobs: true, aftercare: true } },
        files: { 'seeds/meridian.json': readFileSync(`${SEEDS}/meridian.json`, 'utf8') },
      });
      const added = await s.send('owner', 'POST', '/api/v1/apps/crm/sample-data', {});
      expect(said(added), added.body).toBe('ok');
      await s.jobs();
    }, 300_000);
    afterAll(async () => {
      await s?.close();
    });

    it('signs off the sample job still open: its call is for Hugo, a sample person, and Remove sample data takes it', async () => {
      const hugo = (await usersRepo(s.meta).list({ status: 'sample', limit: 50 })).find((user) => user.name.startsWith('Hugo'));
      expect(hugo, 'Hugo is a sample person, not active').toBeDefined();
      const settings = (await s.rows('select aftercare_owner_id from crm_settings'))[0]!;
      expect(settings['aftercare_owner_id']).toBe(hugo!.id);
      const job = (await s.rows(`select id from crm_jobs where state = 'installed'`))[0]!;
      const jobId = Number(job['id']);
      // What stops its sign-off is put right first, by the install's owner.
      for (const snag of await s.rows(`select id from crm_snags where job_id = ${String(jobId)} and state <> 'put-right'`)) {
        expect(said(await s.change('owner', 'snags', snag['id'], { state: 'put-right', put_right_note: 'Trays fitted.' }))).toBe('ok');
      }
      // The sample already holds a call for this job (the ledger's, written ahead): taken away first, so the call the
      // sign-off books is the rule's.
      for (const ahead of await s.rows(`select id from crm_follow_ups where job_id = ${String(jobId)}`)) {
        expect(said(await s.send('owner', 'DELETE', url('follow_ups', `/${String(ahead['id'])}?confirm=true`)))).toBe('ok');
      }
      expect(await s.rows(`select id from crm_follow_ups where job_id = ${String(jobId)}`)).toEqual([]);
      const signed = await s.make('owner', 'sign_offs', { job_id: jobId, check_1: true, signer_name: 'Ines Holt' });
      expect(signed.statusCode, signed.body).toBe(201);
      await s.jobs();
      const calls = await s.rows(`select id, owner_id, kind from crm_follow_ups where job_id = ${String(jobId)}`);
      expect(calls.map((call) => [call['owner_id'], call['kind']])).toEqual([[hugo!.id, 'aftercare']]);
      // Listed with the sample, so it goes with it.
      const listed = await s.rows(`select pk from crm_sample_data where table_ref = 'follow_ups'`);
      expect(listed.map((entry) => Number((JSON.parse(String(entry['pk'])) as { id: unknown }).id))).toContain(Number(calls[0]!['id']));
      const removed = await s.send('owner', 'POST', '/api/v1/apps/crm/sample-data/remove', { keepChanged: false });
      expect(said(removed), removed.body).toBe('ok');
      await s.jobs();
      expect(await s.rows(`select id from crm_follow_ups where id = ${String(calls[0]!['id'])}`)).toEqual([]);
      expect((await s.get('owner', url('follow_ups', '?limit=5'))).statusCode).toBe(200);
    });
  });
}
