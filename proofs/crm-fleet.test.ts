// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 67, stage 3: VEHICLES AND CREW, part A (P25-A): vehicles, their checks,
 * faults and fuel, subcontractors and insurance claims, against the whole
 * server on SQLite, Postgres and MySQL, with the app's own manifest and Jobs
 * on site and Vehicles and crew switched on, each try made signed in as the
 * person it is about.
 *
 *  - who reads and writes each of the six tables: the operations manager and
 *    the CRM admin all of them; Read-only reads them and writes none; a rep
 *    and a sales manager are refused every one, by a list and by a figure;
 *  - a crew member is given his crew's vehicle (`crews.vehicle_id`, kept on
 *    his crew row): he reads that vehicle and its faults, checks and fills,
 *    and no other; he makes a check, a fault and a fill only for it (a link
 *    to a vehicle out of his reach is refused as one that is not there); when
 *    the office gives his crew another vehicle, his reach moves with it; he
 *    changes and removes none of them, and reads no subcontractor or claim;
 *  - a fill is measured from the vehicle's reading before it: the server
 *    copies the reading onto the fill, works the distance out, and the
 *    vehicle's reading becomes the fill's; nobody below the CRM admin types
 *    the reading before;
 *  - e-mail 11 (a certificate asked for) goes to the subcontractor's own
 *    address, from the chase and from nothing else, with who chased stamped by
 *    the server and the reply going to them;
 *  - an insurance incident is settled by its button, by the office only.
 *
 * The screens, as each is answered, are on the browser stand: `e2e/fleet-*.e2e.ts`.
 *
 * To run: `npm run proofs -- fleet` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.36' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const FLEET = ['vehicles', 'vehicle_checks', 'vehicle_faults', 'fuel_fills', 'subcontractors', 'insurance_incidents'] as const;
const TICKS = { tyres: true, fluids: true, lights: true, straps: true, tail_lift: false };
const DAY = '2026-07-28';

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's vehicles, fuel, subcontractors and claims, on ${dialect}`, () => {
    let s: WholeServer;
    const van: Record<string, number> = {};
    const crew: Record<string, number> = {};
    const at = { sub: 0, bare: 0, incident: 0, check: 0, fault: 0, redFault: 0, fill: 0 };

    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const list = (who: string, ref: string): Promise<Reply> => s.get(who, url(ref, '?limit=200'));
    const ids = async (who: string, ref: string): Promise<number[]> => {
      const res = await list(who, ref);
      expect(res.statusCode, `${who} lists ${ref}: ${res.body}`).toBe(200);
      return (res.json() as { data: { id: number }[] }).data.map((row) => Number(row.id)).sort((a, b) => a - b);
    };
    const one = (who: string, ref: string, id: number): Promise<Reply> => s.get(who, url(ref, `/${String(id)}`));
    const figure = (who: string, ref: string, aggregations: unknown[] = [{ fn: 'count', alias: 'n' }], filters: unknown[] = []): Promise<Reply> =>
      s.send(who, 'POST', '/api/v1/widget-data/query', { descriptor: { connectionId: s.connectionId, source: { name: s.t(ref) }, shape: 'single-metric', filters, aggregations } });
    const valueOf = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(200);
      return Number((res.json() as { result: { value?: number } }).result.value ?? 0);
    };
    const keyed = (who: string, ref: string, values: Record<string, unknown>, clientKey: string): Promise<Reply> => s.send(who, 'POST', url(ref), { values, clientKey });
    const codeOf = (res: Reply): string => (res.json() as { error?: { code?: string } }).error?.code ?? '';
    const rowOf = async (ref: string, id: number): Promise<Record<string, unknown>> => (await s.rows(`select * from ${s.t(ref)} where id = ${String(id)}`))[0]!;
    const jobs = (): Promise<void> => s.jobs({ except: ['digest.send'] });

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { tessa: ['admin'], ada: ['ops-manager'], grace: ['read-only'], dana: ['rep'], ivy: ['sales-manager'], yusuf: ['crew'], cal: ['crew'], rina: ['crew'] },
        install: { modules: { jobs: true, fleet: true } },
        smtp: true,
      });
      for (const [name, odometer, hired] of [['Blue van', 1000, false], ['Red van', 2000, false], ['Hired van', 500, true]] as const) {
        van[name] = made(await s.make('ada', 'vehicles', { name, plate: `P${name.slice(0, 3).toUpperCase()}`, odometer, hired, service_due: '2026-07-20', inspection_due: '2026-08-08' }));
      }
      for (const [name, vehicle, people] of [['Blue crew', 'Blue van', ['yusuf', 'cal']], ['Red crew', 'Red van', ['rina']]] as const) {
        crew[name] = made(await s.make('ada', 'crews', { name, vehicle_id: van[vehicle] }));
        for (const [i, person] of people.entries()) made(await s.make('ada', 'crew_members', { crew_id: crew[name], user_id: s.ids[person], lead: i === 0 }));
      }
      at.redFault = made(await s.make('ada', 'vehicle_faults', { vehicle_id: van['Red van'], text: 'Sliding door catches' }));
      at.sub = made(await s.make('ada', 'subcontractors', { name: 'Marek Sowa', hands: 1, day_rate: 190, days_used: 6, insurance_until: '2026-06-30', email: 'marek@sowa-lockers.example' }));
      at.bare = made(await s.make('ada', 'subcontractors', { name: 'No Address Ltd', hands: 2, day_rate: 300, insurance_until: '2026-01-31' }));
      at.incident = made(await s.make('ada', 'insurance_incidents', { day: '2026-07-02', what: 'Pallet of chairs damaged in transit', kind: 'goods in transit', claimed: 2960, excess: 250 }));
    }, 300_000);
    afterAll(async () => {
      await s?.close();
    });

    it('lets the office read and write the six tables, Read-only read them and write none, and refuses a rep and a sales manager every one', async () => {
      for (const ref of FLEET) {
        for (const who of ['ada', 'tessa', 'grace']) expect((await list(who, ref)).statusCode, `${who} ${ref}`).toBe(200);
        expect((await figure('grace', ref)).statusCode, `grace ${ref} figure`).toBe(200);
        for (const who of ['dana', 'ivy']) {
          expect((await list(who, ref)).statusCode, `${who} ${ref}`).toBe(403);
          expect((await figure(who, ref)).statusCode, `${who} ${ref} figure`).toBe(403);
        }
      }
      // Read-only writes nothing: not a vehicle, a subcontractor's chase, a claim's settling.
      expect((await s.make('grace', 'vehicles', { name: 'Grace van' })).statusCode).toBe(403);
      expect((await s.change('grace', 'vehicles', van['Blue van']!, { odometer: 9 })).statusCode).toBe(403);
      expect((await s.change('grace', 'subcontractors', at.sub, { chased_at: new Date().toISOString() })).statusCode).toBe(403);
      expect((await s.send('grace', 'POST', url('insurance_incidents', `/${String(at.incident)}/actions/settle`), { from: 'open' })).statusCode).toBe(403);
      // Nobody below the CRM admin types what the server works out: a vehicle's reading, a subcontractor's spend or who chased.
      expect((await s.change('ada', 'vehicles', van['Blue van']!, { reading: 5 })).statusCode).toBe(403);
      expect((await s.change('ada', 'subcontractors', at.sub, { spent: 1 })).statusCode).toBe(403);
      expect((await s.change('ada', 'subcontractors', at.sub, { chased_by_id: s.ids['grace'] })).statusCode).toBe(403);
      expect((await rowOf('subcontractors', at.sub))['spent']).toEqual(expect.anything());
      expect(Number((await rowOf('subcontractors', at.sub))['spent'])).toBe(1140);
      // A subcontractor's address is personal: the office reads it (it is where the chase goes); Read-only is shown it masked.
      const seen = async (who: string): Promise<Record<string, unknown>> => ((await one(who, 'subcontractors', at.sub)).json() as { data: Record<string, unknown> }).data;
      for (const who of ['ada', 'tessa']) expect((await seen(who))['email'], who).toBe('marek@sowa-lockers.example');
      const masked = await seen('grace');
      expect([masked['email'] ?? null, masked['_masked']]).toEqual([null, expect.arrayContaining(['email'])]);
    });

    it("gives a crew member his crew's vehicle: he reads it, its faults, checks and fills, and no other vehicle's, by any door", async () => {
      expect(await ids('yusuf', 'vehicles')).toEqual([van['Blue van']]);
      expect(await ids('rina', 'vehicles')).toEqual([van['Red van']]);
      for (const other of ['Red van', 'Hired van']) {
        expect((await one('yusuf', 'vehicles', van[other]!)).statusCode, other).toBe(404);
        expect((await s.get('yusuf', url('vehicles', `/${String(van[other])}/history`))).statusCode, `${other} history`).toBe(404);
      }
      expect(valueOf(await figure('yusuf', 'vehicles'))).toBe(1);
      // Red's fault is not there for him; it is for Rina.
      expect(await ids('yusuf', 'vehicle_faults')).toEqual([]);
      expect(await ids('rina', 'vehicle_faults')).toEqual([at.redFault]);
      expect((await one('yusuf', 'vehicle_faults', at.redFault)).statusCode).toBe(404);
      expect(valueOf(await figure('yusuf', 'vehicle_faults'))).toBe(0);
      // No subcontractor, no claim, by any door.
      for (const ref of ['subcontractors', 'insurance_incidents']) {
        expect((await list('yusuf', ref)).statusCode, ref).toBe(403);
        expect((await figure('yusuf', ref)).statusCode, `${ref} figure`).toBe(403);
      }
      expect((await one('yusuf', 'subcontractors', at.sub)).statusCode).toBe(403);
    });

    it('lets him make a check, a fault and a fill for his vehicle only, once for one retry key; and change or remove none', async () => {
      // His crew's van: each is made, once for a key sent twice.
      const check = { vehicle_id: van['Blue van'], day: DAY, ...TICKS };
      at.check = made(await keyed('yusuf', 'vehicle_checks', check, 'FleetProofCheckKey0000000000000001'));
      const again = await keyed('yusuf', 'vehicle_checks', check, 'FleetProofCheckKey0000000000000001');
      expect(again.statusCode, again.body).toBeLessThan(300);
      expect([Number((again.json() as { data: { id: number } }).data.id), (again.json() as { replayed?: boolean }).replayed]).toEqual([at.check, true]);
      expect(await s.rows(`select id from ${s.t('vehicle_checks')} where vehicle_id = ${String(van['Blue van'])}`)).toHaveLength(1);
      // Who checked is the server's to say.
      expect((await rowOf('vehicle_checks', at.check))['by_id']).toBe(s.ids['yusuf']);
      at.fault = made(await keyed('yusuf', 'vehicle_faults', { vehicle_id: van['Blue van'], text: 'Nearside mirror cracked' }, 'FleetProofFaultKey0000000000000001'));
      expect((await rowOf('vehicle_faults', at.fault))['raised_by_id']).toBe(s.ids['yusuf']);
      at.fill = made(await keyed('yusuf', 'fuel_fills', { vehicle_id: van['Blue van'], day: DAY, litres: 40.5, cost: 59.13, odometer: 1250 }, 'FleetProofFillKey00000000000000001'));
      // Another crew's van, or the hired one nobody was given: refused as a vehicle that is not there; nothing is made.
      for (const other of ['Red van', 'Hired van']) {
        const vehicle = van[other]!;
        for (const [ref, values] of [
          ['vehicle_checks', { vehicle_id: vehicle, day: DAY, ...TICKS }],
          ['vehicle_faults', { vehicle_id: vehicle, text: 'Not mine' }],
          ['fuel_fills', { vehicle_id: vehicle, day: DAY, litres: 10, cost: 15, odometer: 99_999 }],
        ] as const) {
          const refused = await s.make('yusuf', ref, values);
          expect(refused.statusCode, `${ref} on ${other}: ${refused.body}`).toBe(409);
          expect(codeOf(refused)).toBe('FK_VIOLATION');
          expect(await s.rows(`select id from ${s.t(ref)} where vehicle_id = ${String(vehicle)} and ${ref === 'vehicle_faults' ? "text = 'Not mine'" : `day = '${DAY}'`}`), `${ref} on ${other}`).toHaveLength(0);
        }
      }
      // His crew-mate sees what he made on their van; Rina does not.
      expect(await ids('cal', 'vehicle_checks')).toEqual([at.check]);
      expect(await ids('cal', 'vehicle_faults')).toEqual([at.fault]);
      expect(await ids('cal', 'fuel_fills')).toEqual([at.fill]);
      for (const [ref, id] of [['vehicle_checks', at.check], ['vehicle_faults', at.fault], ['fuel_fills', at.fill]] as const) expect((await one('rina', ref, id)).statusCode, ref).toBe(404);
      // Made is made: nobody of the crew changes or removes a check, a fault or a fill; the fault's fixing is the office's.
      for (const who of ['yusuf', 'cal']) {
        expect((await s.change(who, 'vehicle_checks', at.check, { lights: false })).statusCode, who).toBe(403);
        expect((await s.change(who, 'vehicle_faults', at.fault, { fixed_on: DAY })).statusCode, who).toBe(403);
        expect((await s.change(who, 'fuel_fills', at.fill, { litres: 1 })).statusCode, who).toBe(403);
        for (const [ref, id] of [['vehicle_checks', at.check], ['vehicle_faults', at.fault], ['fuel_fills', at.fill]] as const) {
          expect((await s.send(who, 'DELETE', url(ref, `/${String(id)}?confirm=true`))).statusCode, `${who} removes ${ref}`).toBe(403);
        }
      }
      expect(said(await s.change('ada', 'vehicle_faults', at.fault, { fixed_on: DAY }))).toBe('ok');
      // Nor does he write the vehicle itself, or a check of somebody else's name.
      expect((await s.change('yusuf', 'vehicles', van['Blue van']!, { odometer: 1 })).statusCode).toBe(403);
      expect((await s.make('yusuf', 'vehicle_checks', { ...check, by_id: s.ids['cal'] })).statusCode).toBe(403);
    });

    it('moves his reach with his crew: given another vehicle, he reaches that one and no longer the old one', async () => {
      expect(said(await s.change('ada', 'crews', crew['Blue crew']!, { vehicle_id: van['Hired van'] }))).toBe('ok');
      try {
        expect(await ids('yusuf', 'vehicles')).toEqual([van['Hired van']]);
        made(await keyed('yusuf', 'vehicle_faults', { vehicle_id: van['Hired van'], text: 'Tail lift slow' }, 'FleetProofFaultKey0000000000000002'));
        const old = await s.make('yusuf', 'vehicle_faults', { vehicle_id: van['Blue van'], text: 'Old van' });
        expect(old.statusCode, old.body).toBe(409);
        // What he made on the old van stays his own (he made it); its faults are the old van's and leave his list.
        expect(await ids('yusuf', 'vehicle_checks')).toEqual([at.check]);
        expect((await one('yusuf', 'vehicle_faults', at.fault)).statusCode).toBe(404);
      } finally {
        expect(said(await s.change('ada', 'crews', crew['Blue crew']!, { vehicle_id: van['Blue van'] }))).toBe('ok');
      }
      expect(await ids('yusuf', 'vehicles')).toEqual([van['Blue van']]);
    });

    it("puts one vehicle on a crew's day (S14, D16): one crew a vehicle a day, a hired one only inside its hire days, and each crew reads its own days only", async () => {
      const on = '2026-08-05';
      const days: number[] = [];
      const day = async (who: string, crewName: string, vehicle: string, when: string): Promise<Reply> => {
        const res = await s.make(who, 'van_days', { crew_id: crew[crewName], day: when, vehicle_id: van[vehicle] });
        if (res.statusCode === 201) days.push(made(res));
        return res;
      };
      // The hired van is hired from Mon 27 Jul to Fri 14 Aug: the office writes the days; nobody else does.
      expect(said(await s.change('ada', 'vehicles', van['Hired van']!, { hired_from: '2026-07-27', hired_to: '2026-08-14' }))).toBe('ok');
      for (const who of ['grace', 'yusuf', 'dana']) expect((await s.change(who, 'vehicles', van['Hired van']!, { hired_to: '2026-09-30' })).statusCode, who).toBe(403);
      // Blue crew on its own van, Red crew on the hired one, the same day.
      expect((await day('ada', 'Blue crew', 'Blue van', on)).statusCode).toBe(201);
      expect((await day('ada', 'Red crew', 'Hired van', on)).statusCode).toBe(201);
      // One vehicle on two crews the same day: refused, whichever vehicle, and nothing is written.
      const twice = await day('ada', 'Red crew', 'Blue van', '2026-08-06');
      expect(twice.statusCode).toBe(201);
      const clash = await s.make('ada', 'van_days', { crew_id: crew['Blue crew'], day: '2026-08-06', vehicle_id: van['Blue van'] });
      expect(clash.statusCode, clash.body).toBe(409);
      expect((await s.make('tessa', 'van_days', { crew_id: crew['Blue crew'], day: on, vehicle_id: van['Hired van'] })).statusCode).toBe(409);
      // …and a crew on two vehicles the same day: its one row is changed instead (a crew's visits that day share it).
      expect((await s.make('ada', 'van_days', { crew_id: crew['Red crew'], day: on, vehicle_id: van['Red van'] })).statusCode).toBe(409);
      expect(await s.rows(`select id from ${s.t('van_days')} where day = '${on}' order by id`)).toHaveLength(2);
      // Moving a row onto the other crew's vehicle that day is refused as well.
      expect((await s.change('ada', 'van_days', days[1]!, { vehicle_id: van['Blue van'] })).statusCode).toBe(409);
      // The hired van goes on a day inside its hire days only: before, after, and a hire shortened past a day it is given.
      for (const outside of ['2026-07-24', '2026-08-17']) {
        const refused = await s.make('ada', 'van_days', { crew_id: crew['Blue crew'], day: outside, vehicle_id: van['Hired van'] });
        expect(refused.statusCode, `${outside}: ${refused.body}`).toBe(422);
        expect(Object.keys((refused.json() as { error: { details?: { fields?: Record<string, unknown> } } }).error.details?.fields ?? {}), outside).toEqual(['day']);
      }
      expect((await day('ada', 'Blue crew', 'Hired van', '2026-08-14')).statusCode).toBe(201);
      // A van of our own (no hire days) goes on any day.
      expect((await day('ada', 'Blue crew', 'Blue van', '2026-12-01')).statusCode).toBe(201);
      // The row keeps the vehicle's plate, name and whether it is hired, for the crew who reads no other vehicle.
      const red = (await rowOf('van_days', days[1]!)) as Record<string, unknown>;
      expect([red['plate'], red['vehicle_name'], Boolean(Number(red['hired']) || red['hired'] === true)]).toEqual(['PHIR', 'Hired van', true]);

      // Each crew reads its own days, and no other crew's, by any door; nor the vehicle another crew is given that day.
      const blueDays = (await s.rows(`select id from ${s.t('van_days')} where crew_id = ${String(crew['Blue crew'])} order by id`)).map((one) => Number(one['id']));
      const redDays = (await s.rows(`select id from ${s.t('van_days')} where crew_id = ${String(crew['Red crew'])} order by id`)).map((one) => Number(one['id']));
      expect(await ids('yusuf', 'van_days')).toEqual(blueDays);
      expect(await ids('rina', 'van_days')).toEqual(redDays);
      for (const id of redDays) {
        expect((await one('yusuf', 'van_days', id)).statusCode).toBe(404);
        expect((await s.get('yusuf', url('van_days', `/${String(id)}/history`))).statusCode).toBe(404);
      }
      expect(valueOf(await figure('yusuf', 'van_days'))).toBe(blueDays.length);
      expect((await one('rina', 'vehicles', van['Blue van']!)).statusCode).toBe(404);
      expect((await one('yusuf', 'vehicles', van['Hired van']!)).statusCode).toBe(404);
      // The crew writes no day of its own: not one, not a change, not a removal.
      expect((await s.make('yusuf', 'van_days', { crew_id: crew['Blue crew'], day: '2026-08-07', vehicle_id: van['Blue van'] })).statusCode).toBe(403);
      expect((await s.change('rina', 'van_days', days[1]!, { vehicle_id: van['Red van'] })).statusCode).toBe(403);
      expect((await s.send('rina', 'DELETE', url('van_days', `/${String(days[1])}?confirm=true`))).statusCode).toBe(403);
      // Read-only reads every day; a rep and a sales manager none.
      expect((await ids('grace', 'van_days')).length).toBe(blueDays.length + redDays.length);
      for (const who of ['dana', 'ivy']) expect((await list(who, 'van_days')).statusCode, who).toBe(403);
      for (const id of days) expect(said(await s.send('ada', 'DELETE', url('van_days', `/${String(id)}?confirm=true`)))).toBe('ok');
    });

    it("measures a fill from the vehicle's reading before it, and the fill becomes the vehicle's reading", async () => {
      // The first fill: from the typed 1,000 to 1,250.
      const first = await rowOf('fuel_fills', at.fill);
      expect([Number(first['prev_odometer']), Number(first['distance'])]).toEqual([1000, 250]);
      const vehicle = await rowOf('vehicles', van['Blue van']!);
      expect([Number(vehicle['odometer']), Number(vehicle['last_fill_reading']), Number(vehicle['reading'])]).toEqual([1000, 1250, 1250]);
      // The next, by his crew-mate: from 1,250.
      const next = made(await keyed('cal', 'fuel_fills', { vehicle_id: van['Blue van'], day: DAY, litres: 30, cost: 44, odometer: 1480 }, 'FleetProofFillKey00000000000000002'));
      expect([Number((await rowOf('fuel_fills', next))['prev_odometer']), Number((await rowOf('fuel_fills', next))['distance'])]).toEqual([1250, 230]);
      // The office types a newer reading (a service): the next fill is measured from it.
      expect(said(await s.change('ada', 'vehicles', van['Blue van']!, { odometer: 1600 }))).toBe('ok');
      expect(Number((await rowOf('vehicles', van['Blue van']!))['reading'])).toBe(1600);
      const third = made(await s.make('ada', 'fuel_fills', { vehicle_id: van['Blue van'], day: DAY, litres: 20, cost: 30, odometer: 1700 }));
      expect(Number((await rowOf('fuel_fills', third))['distance'])).toBe(100);
      // The server adds them up, for whoever reads them: the distance, and the cost of the fills it was measured over.
      const filters = [{ column: 'vehicle_id', op: 'eq', value: van['Blue van'] }, { column: 'distance', op: 'gt', value: 0 }];
      expect(valueOf(await figure('ada', 'fuel_fills', [{ fn: 'sum', column: 'distance', alias: 'd' }], filters))).toBe(580);
      expect(valueOf(await figure('yusuf', 'fuel_fills', [{ fn: 'sum', column: 'cost', alias: 'c' }], filters))).toBeCloseTo(133.13, 2);
      // Nobody below the CRM admin types the reading before; a crew member names no reading but the one he read.
      expect((await s.make('yusuf', 'fuel_fills', { vehicle_id: van['Blue van'], day: DAY, litres: 5, cost: 7, odometer: 1800, prev_odometer: 1 })).statusCode).toBe(403);
      expect((await s.make('ada', 'fuel_fills', { vehicle_id: van['Blue van'], day: DAY, litres: 5, cost: 7, odometer: 1800, prev_odometer: 1 })).statusCode).toBe(403);
      for (const id of [next, third]) await s.rows(`delete from ${s.t('fuel_fills')} where id = ${String(id)}`);
    });

    it("sends e-mail 11 to the subcontractor's own address from the chase, and from nothing else", async () => {
      await s.emails();
      const box = (): Promise<Record<string, unknown>[]> => s.rows(`select kind, subcontractor_id, ${dialect === 'mysql' ? '`to`' : '"to"'} as addr from ${s.t('outbox')} where subcontractor_id is not null order by id`);
      // A change of anything else, his address included, writes nothing.
      expect(said(await s.change('ada', 'subcontractors', at.sub, { days_used: 7, certificate: 'Expired policy', email: 'marek.sowa@sowa-lockers.com' }))).toBe('ok');
      await jobs();
      expect(await box()).toEqual([]);
      // The chase, as the Subcontractors screen writes it: the moment; who chased is the server's.
      expect(said(await s.change('ada', 'subcontractors', at.sub, { chased_at: new Date().toISOString() }))).toBe('ok');
      await jobs();
      const rows = await box();
      expect(rows.map((row) => [row['kind'], Number(row['subcontractor_id'])])).toEqual([['certificate-asked', at.sub]]);
      // (An address on a reserved domain, as every sample address is, would be skipped by the sender: this one is real-shaped.)
      for (const row of await s.rows(`select status, error from ${s.t('outbox')} where subcontractor_id = ${String(at.sub)}`)) expect(['sent', 'queued'], String(row['error'])).toContain(row['status']);
      expect((await rowOf('subcontractors', at.sub))['chased_by_id']).toBe(s.ids['ada']);
      const mails = (await s.emails()).filter((mail) => mail.templateKey === 'crm-certificate-asked');
      expect(mails.map((mail) => [mail.to, mail.subject])).toEqual([['marek.sowa@sowa-lockers.com', 'Please send your new insurance certificate']]);
      expect(mails[0]!.text).toContain('Hello Marek, the insurance certificate we hold for you ran out on');
      expect(mails[0]!.text).not.toMatch(/\{\{|190|1,330|1330/);
      // The CRM admin chases too; a subcontractor with no address is mailed nothing at all.
      expect(said(await s.change('tessa', 'subcontractors', at.bare, { chased_at: new Date().toISOString() }))).toBe('ok');
      await jobs();
      expect((await s.emails()).filter((mail) => mail.templateKey === 'crm-certificate-asked')).toEqual([]);
      expect((await rowOf('subcontractors', at.bare))['chased_by_id']).toBe(s.ids['tessa']);
      await s.rows(`delete from ${s.t('outbox')} where subcontractor_id is not null`);
    });

    it('settles an insurance incident by its button, from open only, by the office only', async () => {
      expect((await s.send('yusuf', 'POST', url('insurance_incidents', `/${String(at.incident)}/actions/settle`), { from: 'open' })).statusCode).toBe(403);
      expect((await s.send('dana', 'POST', url('insurance_incidents', `/${String(at.incident)}/actions/settle`), { from: 'open' })).statusCode).toBe(403);
      expect(said(await s.change('ada', 'insurance_incidents', at.incident, { paid: 2710 }))).toBe('ok');
      expect(said(await s.send('ada', 'POST', url('insurance_incidents', `/${String(at.incident)}/actions/settle`), { from: 'open' }))).toBe('ok');
      expect((await rowOf('insurance_incidents', at.incident))['state']).toBe('settled');
      // A second press finds it settled: no move from there.
      expect((await s.send('ada', 'POST', url('insurance_incidents', `/${String(at.incident)}/actions/settle`), { from: 'open' })).statusCode).toBeGreaterThanOrEqual(400);
    });
  });
}
