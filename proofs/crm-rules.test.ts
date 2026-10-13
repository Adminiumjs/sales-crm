// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SALES CRM'S RULES THAT TELL PEOPLE, against the whole server on SQLite,
 * Postgres and MySQL, with the app's own manifest and signed in as the people
 * it is about: the three nudges, once each time a deal starts to match; a
 * rep's and a sales manager's week by e-mail, each of their own deals only; a
 * notice's e-mail held to the end of the reader's quiet hours; a mention in a
 * comment, to somebody who can open the deal and to two who cannot; and a
 * part switched off and on.
 *
 * To run: copy into `~/Work/lanes/p67/apps/server/test/` as `zz-crm-rules.test.ts`, run, remove.
 */
import { readFileSync } from 'node:fs';

import { automationsRepo, pagesRepo, teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const TELLS = ['nudge-quiet', 'nudge-stuck', 'nudge-soon', 'follow-up-due', 'deal-handed-over', 'week-rep', 'week-manager'];
const DAY = 86_400_000;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's rules that tell people, on ${dialect}`, () => {
    let s: WholeServer;
    let stage = 0;
    let company = 0;
    const deal: Record<string, number> = {};
    type Notice = { title: string; body: string | null; actionUrl: string | null; entity: unknown; kind: string };
    const noticesOf = async (who: string): Promise<Notice[]> => ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: Notice[] } }).data.items;
    const titles = async (who: string): Promise<string[]> => (await noticesOf(who)).map((notice) => notice.title).sort();
    /** A time as this engine keeps one, so many days from now. */
    const at = (days: number): string => {
      const iso = new Date(Date.now() + days * DAY).toISOString();
      return dialect === 'postgres' ? iso : dialect === 'mysql' ? iso.slice(0, 19).replace('T', ' ') : iso;
    };
    const day = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
    const round = async (): Promise<void> => {
      await s.tick();
      await s.jobs({ except: ['digest.send'] });
    };
    const makeDeal = async (name: string, owner: string, extra: Record<string, unknown> = {}): Promise<number> => {
      const made = await s.make('owner', 'deals', { name, company_id: company, owner_id: s.ids[owner], stage_id: stage, ...extra });
      expect(made.statusCode, made.body).toBe(201);
      return Number((made.json() as { data: { id: number } }).data.id);
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), { people: { dana: ['rep'], noor: ['rep'], ivy: ['sales-manager'], sam: ['crew'] }, smtp: true });
      // Ivy leads the team Dana and Noor are in: she reads their deals.
      const team = await teamsRepo(s.meta).create('North');
      await teamsRepo(s.meta).setMember(team.id, s.ids['ivy']!, true);
      for (const rep of ['dana', 'noor']) await teamsRepo(s.meta).setMember(team.id, s.ids[rep]!, false);
      // The rules that tell people ship switched off: the owner switches them on.
      const shipped = await automationsRepo(s.meta).listManagedBy('crm', s.connectionId);
      expect(shipped.filter((rule) => TELLS.includes(rule.templateKey ?? '')).map((rule) => rule.enabled)).toEqual(TELLS.map(() => false));
      for (const rule of shipped.filter((one) => TELLS.includes(one.templateKey ?? ''))) {
        const on = await s.send('owner', 'PATCH', `/api/v1/automations/${rule.id}`, { enabled: true });
        expect(on.statusCode, on.body).toBe(200);
      }
      const madeStage = await s.make('owner', 'stages', { label: 'Proposal', odds: 0.5, position: 3 });
      expect(madeStage.statusCode, madeStage.body).toBe(201);
      stage = Number((madeStage.json() as { data: { id: number } }).data.id);
      const madeCompany = await s.make('owner', 'companies', { name: 'Cobalt Works' });
      expect(madeCompany.statusCode, madeCompany.body).toBe(201);
      company = Number((madeCompany.json() as { data: { id: number } }).data.id);
      deal['atrium'] = await makeDeal('Atrium', 'dana');
      deal['fresh'] = await makeDeal('Fresh', 'dana');
      deal['yard'] = await makeDeal('Yard', 'ivy', { expected_close: day(4) });
      deal['loft'] = await makeDeal('Loft', 'noor');
      await s.jobs({ except: ['digest.send'] });
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('nudges a deal\'s owner three ways, once each time the deal starts to match, and nobody else', async () => {
      // Nothing matches yet: every deal was made a moment ago.
      await round();
      expect(await titles('dana')).toEqual([]);
      // Atrium: last worked on ten days ago, thirty days in its stage, and due to close in three days at even odds.
      await s.rows(`update crm_deals set last_activity_at = '${at(-10)}', entered_stage_at = '${at(-30)}', expected_close = '${day(3)}' where id = ${String(deal['atrium'])}`);
      await round();
      expect(await titles('dana')).toEqual(['Closing soon: Atrium', 'Gone quiet: Atrium', 'Stuck in its stage: Atrium']);
      expect(await titles('noor')).toEqual([]);
      // Ivy's own deal closes in four days at even odds: she is nudged of hers, and of nobody else's.
      expect(await titles('ivy')).toEqual(['Closing soon: Yard']);
      // The next mornings: still quiet, and nobody is told again.
      await round();
      await round();
      expect(await titles('dana')).toHaveLength(3);
    });

    it('ends the quiet spell when something is logged on the deal, and tells again when it goes quiet anew', async () => {
      // Dana logs a call: Adminium keeps the time of the deal's last activity.
      const logged = await s.make('dana', 'activities', { deal_id: deal['atrium'], kind: 'call', text: 'Rang Marta about the layout' });
      expect(logged.statusCode, logged.body).toBe(201);
      const kept = (await s.rows(`select last_activity_at from crm_deals where id = ${String(deal['atrium'])}`))[0]!['last_activity_at'];
      expect(Math.abs(new Date(dialect === 'mysql' && typeof kept === 'string' ? `${kept.replace(' ', 'T')}Z` : (kept as string | Date)).getTime() - Date.now())).toBeLessThan(120_000);
      await round();
      expect((await titles('dana')).filter((title) => title.startsWith('Gone quiet'))).toHaveLength(1);
      // A fortnight later nothing more was logged.
      await s.rows(`update crm_deals set last_activity_at = '${at(-14)}' where id = ${String(deal['atrium'])}`);
      await round();
      expect((await titles('dana')).filter((title) => title.startsWith('Gone quiet'))).toHaveLength(2);
      // The other two spells never ended: told once each.
      expect((await titles('dana')).filter((title) => !title.startsWith('Gone quiet'))).toEqual(['Closing soon: Atrium', 'Stuck in its stage: Atrium']);
    });

    it('tells the owner of a follow-up that falls due, and the new owner of a deal handed over, holding the e-mail to the end of their quiet hours', async () => {
      await s.emails();
      // Dana's hours are quiet from two hours ago until two hours from now: what reaches her waits for their end.
      const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 16);
      const ends = Math.floor((Date.now() + 2 * 3_600_000) / 60_000) * 60_000;
      const quiet = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((weekday) => [weekday, { from: clock(Date.now() - 2 * 3_600_000), to: clock(ends) }]));
      expect(said(await s.send('dana', 'PUT', '/api/v1/me/notification-schedule', { timezone: 'UTC', quiet, digestDay: null, digestTime: null }))).toBe('ok');
      expect(said(await s.make('owner', 'follow_ups', { deal_id: deal['atrium'], owner_id: s.ids['dana'], due_at: at(-0.01), text: 'Send the revised layout', kind: 'step' }))).toBe('ok');
      await round();
      expect(await titles('dana')).toContain('Due now: Send the revised layout');
      // Noor's deal is handed to Dana.
      expect(said(await s.change('owner', 'deals', deal['loft'], { owner_id: s.ids['dana'] }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      expect(await titles('dana')).toContain('Handed to you: Loft');
      expect(await titles('noor')).toEqual([]);
      const held = (await s.emails()).filter((mail) => mail.to === 'dana@crm.test');
      expect(held.map((mail) => mail.subject).sort()).toEqual(['Due now: Send the revised layout', 'Handed to you: Loft']);
      for (const mail of held) expect(mail.runAt).toBe(ends);
      expect(said(await s.send('dana', 'PUT', '/api/v1/me/notification-schedule', { timezone: null, quiet: null, digestDay: null, digestTime: null }))).toBe('ok');
    });

    it('writes a rep and a sales manager their own week: each their own deals, at the hour they chose', async () => {
      await s.emails();
      await s.meta.db.deleteFrom('adminium_jobs').where('kind', '=', 'digest.send').execute();
      // Dana wants hers on Mondays at 08:00 in Cairo; Ivy and Noor chose nothing.
      expect(said(await s.send('dana', 'PUT', '/api/v1/me/notification-schedule', { timezone: 'Africa/Cairo', quiet: null, digestDay: 1, digestTime: '08:00' }))).toBe('ok');
      // A slipped follow-up of Noor's, on a deal he no longer owns.
      expect(said(await s.make('owner', 'follow_ups', { deal_id: deal['loft'], owner_id: s.ids['noor'], due_at: at(-2), text: 'Call about the booth count', kind: 'chase' }))).toBe('ok');
      await round();
      const queued = await s.meta.db.selectFrom('adminium_jobs').select(['payload', 'runAt']).where('kind', '=', 'digest.send').where('status', '=', 'pending').execute();
      const whose = (row: { payload: unknown }) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { userId: string; templateKey: string };
      const danas = queued.find((row) => whose(row).userId === s.ids['dana'])!;
      expect(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(danas.runAt))).toBe('Mon 08:00');
      expect(queued.find((row) => whose(row).userId === s.ids['ivy'])!.runAt).toBeLessThanOrEqual(Date.now());

      await s.jobs({ all: true });
      const mails = await s.emails();
      const to = (who: string) => mails.filter((mail) => mail.to === `${who}@crm.test` && mail.templateKey.startsWith('crm-week-'));
      // Dana: Atrium closes this week; her follow-up has slipped; Loft is hers now but closes on no day.
      expect(to('dana')).toHaveLength(1);
      expect(to('dana')[0]!.templateKey).toBe('crm-week-rep');
      expect(to('dana')[0]!.subject).toBe('Your week, Dana');
      expect(to('dana')[0]!.text).toContain('Closing this week: 1');
      expect(to('dana')[0]!.text).toContain('Atrium');
      expect(to('dana')[0]!.text).toContain('Follow-ups that have slipped: 1');
      expect(to('dana')[0]!.text).toContain('Send the revised layout');
      expect(to('dana')[0]!.text).not.toContain('Yard');
      expect(to('dana')[0]!.text).not.toContain('booth count');
      // Noor: a slipped follow-up of his own, and no deal.
      expect(to('noor')).toHaveLength(1);
      expect(to('noor')[0]!.text).toContain('Call about the booth count');
      expect(to('noor')[0]!.text).toContain('No deal of yours is due to close this week.');
      // Ivy reads her team's deals, and her week lists only the deal she owns herself.
      expect(to('ivy')).toHaveLength(1);
      expect(to('ivy')[0]!.templateKey).toBe('crm-week-manager');
      expect(to('ivy')[0]!.text).toContain('Closing this week: 1');
      expect(to('ivy')[0]!.text).toContain('Yard');
      expect(to('ivy')[0]!.text).not.toContain('Atrium');
      expect(((await s.get('ivy', `/api/v1/data/${s.connectionId}/${s.t('deals')}?limit=50`)).json() as { data: { name: string }[] }).data.map((row) => row.name)).toContain('Atrium');
    });

    it('tells a colleague mentioned in a comment who wrote and on which deal: with a way in for one who reads the deal, and none for the others', async () => {
      await s.emails();
      const name = (who: string): string => `@[${who[0]!.toUpperCase()}${who.slice(1)}](${s.ids[who]!})`;
      const written = await s.make('dana', 'comments', { deal_id: deal['atrium'], text: `${name('ivy')} ${name('noor')} ${name('sam')} can we deliver by the 12th? Our floor is 38 percent.` });
      expect(written.statusCode, written.body).toBe(201);
      const page = (await pagesRepo(s.meta).listForConnection(s.connectionId)).find((one) => one.slug === 'crm-deals')!;
      const mention = async (who: string) => (await noticesOf(who)).filter((notice) => notice.kind === 'mention');
      // The manager reads her team's deals: she is led to the deal the comment is on.
      expect(await mention('ivy')).toMatchObject([{ title: 'Dana mentioned you', actionUrl: `/p/${page.slug}/r/${String(deal['atrium'])}` }]);
      // A rep whose deal it is not, and a fitter with no right on deals: told who and where, with no way in.
      for (const who of ['noor', 'sam']) expect(await mention(who), who).toMatchObject([{ title: 'Dana mentioned you', actionUrl: null, entity: null }]);
      for (const who of ['ivy', 'noor', 'sam']) {
        const [notice] = await mention(who);
        expect(notice!.body, who).toContain('Atrium');
        expect(JSON.stringify(notice), who).not.toContain('38 percent');
      }
      for (const mail of (await s.emails()).filter((one) => one.subject === 'Dana mentioned you')) expect(`${mail.html} ${mail.text}`).not.toContain('38 percent');
      // Somebody who does not sign in here cannot be named: the comment is not saved.
      expect(said(await s.make('dana', 'comments', { deal_id: deal['atrium'], text: 'Ask @[Somebody](usr_01NOBODYATALL00000000)' }))).toBe('422 VALIDATION_FAILED');
    });

    it('writes who moved a deal\'s stage into its history: the person, not the rule that writes the line', async () => {
      const next = await s.make('owner', 'stages', { label: 'Negotiation', odds: 0.75, position: 4 });
      expect(next.statusCode, next.body).toBe(201);
      const to = Number((next.json() as { data: { id: number } }).data.id);
      expect(said(await s.change('dana', 'deals', deal['atrium'], { stage_id: to }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      const lines = await s.rows(`select by_id, to_stage_id from crm_deal_stage_changes where deal_id = ${String(deal['atrium'])} order by id`);
      // The line of the deal's making names who made it (the owner of this install), the move names Dana.
      expect(lines.map((line) => [Number(line['to_stage_id']), line['by_id']])).toEqual([[stage, s.ids['owner']], [to, s.ids['dana']]]);
    });

    it('closes a part that is switched off and opens it again: its page, its rows to its own roles, and its place in the menu', async () => {
      const flip = (on: boolean) => s.send('owner', 'PUT', '/api/v1/apps/crm/parts/inbox', { on });
      const enquiries = (await pagesRepo(s.meta).listForConnection(s.connectionId)).find((one) => one.slug === 'crm-enquiries')!;
      const parts = async (): Promise<Record<string, boolean>> => Object.fromEntries(((await s.get('owner', '/api/v1/apps/crm/parts')).json() as { parts: { id: string; on: boolean }[] }).parts.map((part) => [part.id, part.on]));
      expect((await parts())['inbox']).toBe(true);
      expect(said(await s.get('dana', `/api/v1/pages/${enquiries.id}`))).toBe('ok');
      expect(said(await flip(false))).toBe('ok');
      expect((await parts())['inbox']).toBe(false);
      expect(said(await s.get('dana', `/api/v1/pages/${enquiries.id}`))).toBe('409 PART_OFF');
      // What is always there stays: the deals page, and a part nobody may switch.
      expect(said(await s.get('dana', `/api/v1/pages/${(await pagesRepo(s.meta).findBySlug(s.connectionId, 'crm-deals'))!.id}`))).toBe('ok');
      expect(said(await s.send('owner', 'PUT', '/api/v1/apps/crm/parts/selling', { on: false }))).toMatch(/^4/);
      expect(said(await flip(true))).toBe('ok');
      expect(said(await s.get('dana', `/api/v1/pages/${enquiries.id}`))).toBe('ok');
    });
  });
}
