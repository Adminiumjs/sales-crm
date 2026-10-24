// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 68, phase 4 (T26b): STEPS READ THROUGH A PLAN, A REMOVED MESSAGE, AND
 * WHAT A REMOVAL KEEPS, against the whole server on SQLite, Postgres and
 * MySQL, with the app's own manifest, each try made signed in as the person
 * it is about.
 *
 *  - R4a/R4b (E27): a rep reads every step of her own coaching plan, the one
 *    her manager owns included, and changes only the steps she owns or set; a
 *    manager reads the steps her rep set in her coaching and one-to-ones and
 *    the meeting actions her reps set, never another manager's coaching or
 *    one-to-one with the same rep; a colleague hangs nothing on a plan that
 *    is not hers.
 *  - R4d (E19): a message is removed by its own button, which empties its
 *    words: by its author, and by the CRM admin in a conversation she is in;
 *    never by another member, nor by the CRM admin elsewhere; the words are
 *    never changed after the message is made; a member's history of a
 *    removed message holds no words; the audit log keeps them.
 *  - S3 (E8): a member taken off a deal is kept under the deal, read by whoever
 *    reads the deal now (404 for anybody else); no reason is taken.
 *  - S16 (E8): a cancelled site visit, showroom booking and job visit keep
 *    their why, read through the deal, the space or the job; a reader who
 *    does not read the parent is answered 404; the crew reads none through a
 *    job; a visit removed from a crew's tomorrow still leaves its note for
 *    that crew (D17).
 *  - X8 (E20): no undo is offered for a removed member row (a locked child of
 *    its deal), so none can put back the owner it was removed under; a row
 *    made after the deal changes hands takes the CURRENT owner.
 *
 * To run: `npm run proofs -- p4-removals` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.35' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const DAY = 86_400_000;
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WORDS = 'Meet me at the hotel bar at nine';

type Removed = { key: string; reason: string | null; actorLabel: string; row: Record<string, unknown> };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's plans, removed messages and kept removals, on ${dialect}`, () => {
    let s: WholeServer;
    let stage = 0;
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
    const ids = async (who: string, ref: string, where?: unknown): Promise<number[]> => {
      const res = await s.get(who, url(ref, `?limit=200&order=id.asc${where === undefined ? '' : `&where=${encodeURIComponent(JSON.stringify(where))}`}`));
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { id: number }[] }).data.map((one) => Number(one.id));
    };
    const remove = (who: string, ref: string, id: number, reason?: string): Promise<Reply> => s.send(who, 'DELETE', url(ref, `/${String(id)}?confirm=true`), reason === undefined ? undefined : { reason });
    const act = (who: string, ref: string, id: number, action: string, from: string): Promise<Reply> => s.send(who, 'POST', url(ref, `/${String(id)}/actions/${action}`), { from });
    const under = (who: string, parent: string, id: number, child: string, rest = ''): Promise<Reply> => s.get(who, `/api/v1/data/${s.connectionId}/${s.t(parent)}/${String(id)}/removed/${s.t(child)}${rest}`);
    const removedUnder = async (who: string, parent: string, id: number, child: string): Promise<Removed[]> => {
      const res = await under(who, parent, id, child);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { removed: Removed[] }).removed;
    };
    const jobs = (): Promise<void> => s.jobs({ except: ['digest.send'] });
    const at = (days: number, hour = 10): string => {
      const day = new Date(Date.now() + days * DAY);
      return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 0)).toISOString();
    };
    const dealOf = async (owner: string, name: string): Promise<number> => made(await s.make(owner, 'deals', { name, company_id: company, contact_id: contact, owner_id: s.ids[owner], stage_id: stage }));

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: {
          dana: ['rep'],
          sam: ['rep'],
          priya: ['rep'],
          ivy: ['sales-manager'],
          mara: ['sales-manager'],
          tessa: ['admin'],
          corin: ['front-desk'],
          lena: ['marketer'],
          ada: ['ops-manager'],
          yusuf: ['crew'],
          rina: ['crew'],
          grace: ['read-only'],
        },
        install: { modules: { showroom: true, jobs: true } },
      });
      // Ivy leads Dana and Sam; Mara leads Priya, and Dana too (Dana has a coaching plan and a one-to-one with each).
      const north = await teamsRepo(s.meta).create('North');
      await teamsRepo(s.meta).setMember(north.id, s.ids['ivy']!, true);
      for (const rep of ['dana', 'sam']) await teamsRepo(s.meta).setMember(north.id, s.ids[rep]!, false);
      const south = await teamsRepo(s.meta).create('South');
      await teamsRepo(s.meta).setMember(south.id, s.ids['mara']!, true);
      for (const rep of ['priya', 'dana']) await teamsRepo(s.meta).setMember(south.id, s.ids[rep]!, false);
      stage = made(await s.make('owner', 'stages', { label: 'Proposal', odds: 0.5, position: 3 }));
      company = made(await s.make('owner', 'companies', { name: 'Nordwind Logistics' }));
      contact = made(await s.make('owner', 'contacts', { company_id: company, name: 'Petra Lindqvist', email: 'petra@nordwind.test', may_email: true }));
      await jobs();
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    describe('steps read through a coaching plan and a one-to-one (R4a, R4b)', () => {
      const step: Record<string, number> = {};
      let areaIvy = 0;
      let areaMara = 0;
      beforeAll(async () => {
        const planIvy = made(await s.make('ivy', 'coaching_plans', { rep_id: s.ids['dana'], manager_id: s.ids['ivy'] }));
        areaIvy = made(await s.make('ivy', 'coaching_areas', { plan_id: planIvy, rep_id: s.ids['dana'], manager_id: s.ids['ivy'], title: 'Ask for the decision earlier', position: 0 }));
        const planMara = made(await s.make('mara', 'coaching_plans', { rep_id: s.ids['dana'], manager_id: s.ids['mara'] }));
        areaMara = made(await s.make('mara', 'coaching_areas', { plan_id: planMara, rep_id: s.ids['dana'], manager_id: s.ids['mara'], title: 'Follow-ups on the day', position: 0 }));
        const pairIvy = made(await s.make('ivy', 'one_to_ones', { manager_id: s.ids['ivy'], rep_id: s.ids['dana'] }));
        const pairMara = made(await s.make('mara', 'one_to_ones', { manager_id: s.ids['mara'], rep_id: s.ids['dana'] }));
        const meeting = made(await s.make('ivy', 'meetings', { at: at(2), minutes: 30 }));
        const action = (who: string, values: Record<string, unknown>): Promise<Reply> => s.make(who, 'actions', values);
        // Ivy sets Dana a step, and one of her own, in Dana's plan.
        step['ivyForDana'] = made(await action('ivy', { text: 'Ask who signs at the first meeting', owner_id: s.ids['dana'], source: 'coaching', coaching_area_id: areaIvy }));
        step['ivysOwn'] = made(await action('ivy', { text: 'Ivy sits in on two of Dana\'s calls', owner_id: s.ids['ivy'], source: 'coaching', coaching_area_id: areaIvy }));
        // Dana sets herself a step in each plan, and a meeting action.
        step['danaInIvys'] = made(await action('dana', { text: 'Write the close plan for Nordwind', owner_id: s.ids['dana'], source: 'coaching', coaching_area_id: areaIvy }));
        step['danaInMaras'] = made(await action('dana', { text: 'Clear the Friday queue', owner_id: s.ids['dana'], source: 'coaching', coaching_area_id: areaMara }));
        step['danaMeeting'] = made(await action('dana', { text: 'Bring the Nordwind numbers', owner_id: s.ids['dana'], source: 'meeting', meeting_id: meeting }));
        // Each manager's one-to-one with Dana: a step for Dana, and one the manager keeps for herself.
        step['ivyPairForDana'] = made(await action('ivy', { text: 'Send the revised layout', owner_id: s.ids['dana'], source: 'one-to-one', one_to_one_id: pairIvy }));
        step['maraPairForDana'] = made(await action('mara', { text: 'Book the walk-round', owner_id: s.ids['dana'], source: 'one-to-one', one_to_one_id: pairMara }));
        step['maraPairOwn'] = made(await action('mara', { text: 'Mara checks Dana\'s targets', owner_id: s.ids['mara'], source: 'one-to-one', one_to_one_id: pairMara }));
      });

      it('lets a rep read every step of her plan, and change only the ones she owns or set', async () => {
        // All four steps of Ivy's plan for her, the one Ivy keeps included (4b); Mara's plan's one too.
        expect(await ids('dana', 'actions', { column: 'coaching_area_id', op: 'eq', value: areaIvy })).toEqual([step['ivyForDana'], step['ivysOwn'], step['danaInIvys']].sort((a, b) => a! - b!));
        expect(Number((await row('dana', 'actions', step['ivysOwn']!))?.['id'])).toBe(step['ivysOwn']);
        // She ticks hers and the one set for her; the one Ivy keeps is not hers to change.
        expect(said(await s.change('dana', 'actions', step['ivyForDana']!, { done: true }))).toBe('ok');
        expect(said(await s.change('dana', 'actions', step['danaInIvys']!, { done: true }))).toBe('ok');
        expect((await s.change('dana', 'actions', step['ivysOwn']!, { done: true })).statusCode).toBe(404);
        expect((await row('ivy', 'actions', step['ivysOwn']!))?.['done']).toBeFalsy();
        // Nothing of a one-to-one is hers to read beyond what she owns: Mara's own step stays Mara's.
        expect(await row('dana', 'actions', step['maraPairOwn']!)).toBeNull();
        // A colleague reads none of it, and hangs nothing on Dana's plan.
        for (const key of ['ivyForDana', 'ivysOwn', 'danaInIvys', 'danaInMaras']) expect(await row('sam', 'actions', step[key]!), key).toBeNull();
        const hung = await s.make('sam', 'actions', { text: 'Not mine to add', owner_id: s.ids['sam'], source: 'coaching', coaching_area_id: areaIvy });
        expect(hung.statusCode, hung.body).toBe(409);
      });

      it('lets a manager read what her rep set in her plan and her meetings, never another manager\'s pair', async () => {
        const ivys = await ids('ivy', 'actions');
        for (const key of ['ivyForDana', 'ivysOwn', 'danaInIvys', 'danaMeeting', 'ivyPairForDana']) expect(ivys, key).toContain(step[key]);
        // Mara's coaching and one-to-one with the same rep are Mara's and Dana's alone: not by a list, not by the record.
        for (const key of ['danaInMaras', 'maraPairForDana', 'maraPairOwn']) {
          expect(ivys, key).not.toContain(step[key]);
          expect(await row('ivy', 'actions', step[key]!), key).toBeNull();
          expect((await s.change('ivy', 'actions', step[key]!, { done: true })).statusCode, key).toBe(404);
        }
        // She reads the step Dana set in her plan, and does not change it: it is Dana's own.
        expect((await s.change('ivy', 'actions', step['danaInIvys']!, { text: 'Changed by Ivy' })).statusCode).toBe(404);
        expect((await row('dana', 'actions', step['danaInIvys']!))?.['text']).toBe('Write the close plan for Nordwind');
        // What she set she still changes.
        expect(said(await s.change('ivy', 'actions', step['ivysOwn']!, { done: true }))).toBe('ok');
        // Mara reads her own pair's and plan's steps, and Dana's meeting action (she leads Dana too); not Ivy's plan.
        const maras = await ids('mara', 'actions');
        for (const key of ['danaInMaras', 'maraPairForDana', 'maraPairOwn', 'danaMeeting']) expect(maras, key).toContain(step[key]);
        for (const key of ['ivyForDana', 'ivysOwn', 'danaInIvys', 'ivyPairForDana']) expect(maras, key).not.toContain(step[key]);
        // Priya is in Mara's team, not in Dana's work: she reads none of it.
        expect(await ids('priya', 'actions')).toEqual([]);
      });
    });

    describe('a removed message (R4d)', () => {
      let direct = 0;
      let group = 0;
      const msg: Record<string, number> = {};
      beforeAll(async () => {
        direct = made(await s.make('owner', 'threads', { kind: 'direct' }));
        for (const who of ['dana', 'ivy']) made(await s.make('owner', 'thread_members', { thread_id: direct, user_id: s.ids[who] }));
        group = made(await s.make('owner', 'threads', { kind: 'group', title: 'The desk' }));
        for (const who of ['dana', 'sam', 'tessa']) made(await s.make('owner', 'thread_members', { thread_id: group, user_id: s.ids[who] }));
        msg['direct'] = made(await s.make('dana', 'messages', { thread_id: direct, text: WORDS }));
        msg['groupDana'] = made(await s.make('dana', 'messages', { thread_id: group, text: 'Who has the acoustic sheet?' }));
        msg['groupSam'] = made(await s.make('sam', 'messages', { thread_id: group, text: 'I do, sending it now' }));
      });

      it('starts live, and its words are never changed after it is made', async () => {
        expect((await row('ivy', 'messages', msg['direct']!))?.['state']).toBe('live');
        expect((await s.change('dana', 'messages', msg['direct']!, { text: 'Something else' })).statusCode).toBe(403);
        // A bare change of the state that keeps the words is refused: only the button removes, and it empties them.
        expect((await s.change('dana', 'messages', msg['direct']!, { state: 'removed' })).statusCode).toBe(409);
        // Who removed it and when are the server's, never sent.
        expect((await s.change('dana', 'messages', msg['direct']!, { removed_by_id: s.ids['ivy'] })).statusCode).toBeGreaterThanOrEqual(400);
        expect((await row('ivy', 'messages', msg['direct']!))?.['text']).toBe(WORDS);
      });

      it('is removed by its author and by the CRM admin in a conversation she is in, and by nobody else', async () => {
        // Another member does not remove Dana's message; nor does the CRM admin in a conversation she is not in.
        expect((await act('ivy', 'messages', msg['direct']!, 'remove', 'live')).statusCode).toBe(404);
        expect((await act('tessa', 'messages', msg['direct']!, 'remove', 'live')).statusCode).toBe(404);
        expect((await act('sam', 'messages', msg['groupDana']!, 'remove', 'live')).statusCode).toBe(404);
        expect((await act('grace', 'messages', msg['direct']!, 'remove', 'live')).statusCode).toBeGreaterThanOrEqual(403);
        expect((await row('dana', 'messages', msg['groupDana']!))?.['state']).toBe('live');
        // Dana removes her own; the CRM admin removes Sam's in the conversation she is in.
        expect(said(await act('dana', 'messages', msg['direct']!, 'remove', 'live'))).toBe('ok');
        expect(said(await act('tessa', 'messages', msg['groupSam']!, 'remove', 'live'))).toBe('ok');
        const gone = (await row('ivy', 'messages', msg['direct']!))!;
        expect([gone['state'], gone['text'], gone['removed_by_id']]).toEqual(['removed', '', s.ids['dana']]);
        expect(Math.abs(new Date(String(gone['removed_at'])).getTime() - Date.now())).toBeLessThan(120_000);
        expect((await row('dana', 'messages', msg['groupSam']!))?.['removed_by_id']).toBe(s.ids['tessa']);
        // Removed once: a second press, and a change of the words after, are refused.
        expect((await act('dana', 'messages', msg['direct']!, 'remove', 'live')).statusCode).toBe(409);
        expect((await s.change('dana', 'messages', msg['direct']!, { text: WORDS })).statusCode).toBe(403);
      });

      it('keeps the words out of a member\'s record history, and in the audit log', async () => {
        for (const who of ['ivy', 'dana']) {
          const history = await s.get(who, url('messages', `/${String(msg['direct'])}/history`));
          expect(history.statusCode, history.body).toBe(200);
          expect(history.body).not.toContain('hotel bar');
        }
        const kept = await s.meta.db.selectFrom('adminium_audit_log').select('changes').where('entityId', '=', String(msg['direct'])).execute();
        expect(kept.some((entry) => JSON.stringify(entry.changes).includes('hotel bar'))).toBe(true);
      });
    });

    describe('a member taken off a deal (S3), and no undo of it (X8)', () => {
      it('keeps the removed member under the deal, for whoever reads the deal now', async () => {
        const deal = await dealOf('dana', 'Nordwind fit-out');
        const member = made(await s.make('dana', 'deal_members', { deal_id: deal, user_id: s.ids['sam'] }));
        expect((await row('dana', 'deal_members', member))?.['added_by_id']).toBe(s.ids['dana']);
        // No reason is taken for taking somebody off a deal.
        expect((await remove('dana', 'deal_members', member, 'Moved team')).statusCode).toBe(422);
        expect(said(await remove('dana', 'deal_members', member))).toBe('ok');
        for (const who of ['dana', 'ivy', 'grace']) {
          const listed = await removedUnder(who, 'deals', deal, 'deal_members');
          expect(listed.map((one) => [Number(one.key), one.row['user_id'], one.reason]), who).toEqual([[member, s.ids['sam'], null]]);
          expect(listed[0]!.actorLabel, who).toMatch(/dana/i);
        }
        // Sam, off the deal, reads it no more; Priya never did; Mara leads Dana, not this deal's other team.
        for (const who of ['sam', 'priya']) expect((await under(who, 'deals', deal, 'deal_members')).statusCode, who).toBe(404);
        expect((await under('lena', 'deals', deal, 'deal_members')).statusCode).toBeGreaterThanOrEqual(403);
      });

      it('offers no undo of a removed member, so no undo can bring back the owner the row was taken off under (X8)', async () => {
        // A member row is a locked child of its deal (a closed deal's people stay as they were): an undo writes with no
        // rules, so the server offers none for it, by any person. The deal's owner a removed row kept cannot come back
        // through one; where an undo does bring a row back elsewhere, E20 re-reads its copies (the engine's own test).
        const deal = await dealOf('dana', 'Fernway refit');
        const owners: string[] = [];
        for (const who of ['dana', 'ivy', 'owner']) {
          const member = made(await s.make(who === 'owner' ? 'dana' : who, 'deal_members', { deal_id: deal, user_id: s.ids['sam'] }));
          const gone = await remove(who, 'deal_members', member);
          expect(gone.statusCode, gone.body).toBe(200);
          expect((gone.json() as { undoToken: string | null }).undoToken, who).toBeNull();
          expect((await removedUnder('owner', 'deals', deal, 'deal_members')).map((one) => Number(one.key)), who).toContain(member);
          owners.push(who);
        }
        expect(owners).toHaveLength(3);
        // The deal changes hands: the removed rows stay removed, and a new member row takes the new owner.
        expect(said(await s.change('owner', 'deals', deal, { owner_id: s.ids['sam'] }))).toBe('ok');
        const again = made(await s.make('owner', 'deal_members', { deal_id: deal, user_id: s.ids['priya'] }));
        const [row2] = await s.rows(`select deal_owner_id from crm_deal_members where id = ${String(again)}`);
        expect(row2!['deal_owner_id']).toBe(s.ids['sam']);
        expect(await removedUnder('owner', 'deals', deal, 'deal_members')).toHaveLength(3);
      });
    });

    describe('a cancelled visit\'s why (S16)', () => {
      it('keeps a site visit\'s why, read through its deal by whoever reads the deal', async () => {
        const deal = await dealOf('dana', 'Cobalt records room');
        const visit = made(await s.make('dana', 'site_visits', { deal_id: deal, contact_id: contact, rep_id: s.ids['dana'], starts_at: at(5), minutes: 60, purpose: 'Walk the floor' }));
        expect(said(await remove('dana', 'site_visits', visit, 'Petra is off sick'))).toBe('ok');
        for (const who of ['dana', 'ivy', 'grace', 'tessa']) {
          const listed = await removedUnder(who, 'deals', deal, 'site_visits');
          expect(listed.map((one) => [Number(one.key), one.reason, one.row['purpose']]), who).toEqual([[visit, 'Petra is off sick', 'Walk the floor']]);
        }
        const history = await under('dana', 'deals', deal, 'site_visits', `/${String(visit)}/history`);
        expect(history.statusCode, history.body).toBe(200);
        expect(history.body).toContain('Petra is off sick');
        // A rep who does not read the deal: as a deal that is not there.
        for (const who of ['sam', 'priya']) expect((await under(who, 'deals', deal, 'site_visits')).statusCode, who).toBe(404);
        // Too long a why is refused, and the visit stays.
        const other = made(await s.make('dana', 'site_visits', { deal_id: deal, contact_id: contact, rep_id: s.ids['dana'], starts_at: at(6), minutes: 60, purpose: 'Measure up' }));
        expect((await remove('dana', 'site_visits', other, 'x'.repeat(501))).statusCode).toBe(422);
        expect(await row('dana', 'site_visits', other)).not.toBeNull();
        expect(said(await remove('dana', 'site_visits', other))).toBe('ok');
        expect((await removedUnder('dana', 'deals', deal, 'site_visits')).find((one) => Number(one.key) === other)?.reason).toBeNull();
      });

      it('keeps a showroom booking\'s why, read through its space by whoever reads the space', async () => {
        const space = made(await s.make('owner', 'showroom_spaces', { name: 'Main floor' }));
        const booking = made(await s.make('corin', 'showroom_bookings', { space_id: space, company_id: company, contact_id: contact, party: 2, starts_at: at(4, 9), minutes: 60 }));
        expect(said(await remove('corin', 'showroom_bookings', booking, 'They moved the day'))).toBe('ok');
        for (const who of ['corin', 'tessa', 'dana', 'grace']) {
          const listed = await removedUnder(who, 'showroom_spaces', space, 'showroom_bookings');
          expect(listed.map((one) => [Number(one.key), one.reason]), who).toEqual([[booking, 'They moved the day']]);
        }
        // The marketer reads no showroom at all.
        expect((await under('lena', 'showroom_spaces', space, 'showroom_bookings')).statusCode).toBeGreaterThanOrEqual(403);
      });

      it('keeps a job visit\'s why, read through its job; the crew reads none, and the crew it left is still told', async () => {
        const crew: Record<string, number> = {};
        for (const [name, person] of [['blue', 'yusuf'], ['red', 'rina']] as const) {
          crew[name] = made(await s.make('ada', 'crews', { name: `${name} crew` }));
          made(await s.make('ada', 'crew_members', { crew_id: crew[name], user_id: s.ids[person], lead: true }));
          for (const weekday of WEEK) made(await s.make('ada', 'crew_days', { crew_id: crew[name], weekday }));
        }
        const deal = await dealOf('dana', 'Harbour clinic lockers');
        expect(said(await act('dana', 'deals', deal, 'mark-won', 'open'))).toBe('ok');
        await jobs();
        const job = Number((await s.rows(`select id from crm_jobs where deal_id = ${String(deal)}`))[0]!['id']);
        const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
        const visits: Record<string, number> = {};
        for (const name of ['blue', 'red']) {
          visits[name] = made(await s.make('ada', 'job_visits', { job_id: job, kind: 'drop', what: `Drop for ${name}`, hours: 2, crew_size: 1 }));
          expect(said(await s.change('ada', 'job_visits', visits[name]!, { day: tomorrow, start_time: '08:00', crew_id: crew[name] }))).toBe('ok');
          expect(said(await act('ada', 'job_visits', visits[name]!, 'book', 'waiting'))).toBe('ok');
        }
        await jobs();
        expect(said(await remove('ada', 'job_visits', visits['blue']!, 'The ward is shut'))).toBe('ok');
        expect(said(await remove('ada', 'job_visits', visits['red']!, 'Lift out of order'))).toBe('ok');
        await jobs();
        for (const who of ['ada', 'tessa', 'dana']) {
          const listed = await removedUnder(who, 'jobs', job, 'job_visits');
          expect(listed.map((one) => [Number(one.key), one.reason]).sort(), who).toEqual([[visits['blue'], 'The ward is shut'], [visits['red'], 'Lift out of order']].sort());
        }
        // The crew reads no job, so nothing through one: neither its own visit's why nor another crew's.
        for (const who of ['yusuf', 'rina']) expect((await under(who, 'jobs', job, 'job_visits')).statusCode, who).toBeGreaterThanOrEqual(403);
        // The crew a visit left (tomorrow, removed) is still told, each its own and not the other's (D17).
        const left = await s.rows(`select crew_id, visit_id from crm_left_visits where visit_id in (${String(visits['blue'])}, ${String(visits['red'])})`);
        expect(left.map((one) => [Number(one['crew_id']), Number(one['visit_id'])]).sort()).toEqual([[crew['blue'], visits['blue']], [crew['red'], visits['red']]].sort());
      });
    });
  });
}
