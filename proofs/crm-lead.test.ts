/**
 * A COMPANY'S DETAILS FOR LEAD FINDER, on the whole server, on SQLite, Postgres and MySQL.
 *
 * Without Lead finder: the app installs with its `lead` word, companies keep a number, a phone and a few words about
 * them, the sample brings its fourteen companies (five of them the practices Lead finder found, nobody's) and the
 * file of Lead finder's rows is never read; "Remove sample data" takes it all away.
 *
 * With Lead finder (`ADD_ONS_REPO` with `packages/lead-finder` built): the sample also brings the four people it
 * found, the tell mails and the field notes, each naming the CRM's own sample rows; the kit tells Lead finder's page
 * of Companies and where each detail goes (the `lead` map); "Remove sample data" takes all of it away again.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rolesRepo, usersRepo } from '@adminium/meta';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { LEGS } from './invoicing-install.helpers.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { servePublic } from './public-lane.helpers.js';

// The server says the version it was built at; the app's floor is the release to come.
vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.3.76' }));

// The app this copy of the proofs came from (`npm run proofs` names it), not a fixed lane.
const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const leadFile = () => JSON.parse(readFileSync(`${SEEDS}/meridian.lead-finder.json`, 'utf8')) as { tables: { ref: string; rows: Record<string, unknown>[] }[] };

/** Where a found company's details go, as the app says it. */
const LEAD = {
  number: 'company_number',
  website: 'website',
  phone: 'phone',
  address: { lines: 'address_lines', town: 'town', region: 'region', postalCode: 'postal_code', country: 'country' },
  activity: 'sector',
  about: 'about',
  owner: 'account_owner_id',
};
const FOUND = ['Kestrel Yard Architects', 'Millbeck Drawing Office', 'Ouseburn Studio', 'Tannery Row Design', 'Fjordlys Arkitekter AS'];

const BUILT = builtAddOn('lead-finder');
// As its first release will number it: the app suggests Lead finder 1.0.32 or newer.
const FINDER = BUILT === null ? null : { ...BUILT, version: '1.0.32', manifest: { ...BUILT.manifest, version: '1.0.32' } };

/** The package as the harness takes it: text only, each picture's bytes stood in for. */
function files(): Record<string, string> {
  const packed = JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { assets?: Record<string, { sha256: string }> };
  for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
  return {
    'seeds/meridian.json': JSON.stringify(packed),
    'seeds/meridian.inventory.json': readFileSync(`${SEEDS}/meridian.inventory.json`, 'utf8'),
    'seeds/meridian.lead-finder.json': readFileSync(`${SEEDS}/meridian.lead-finder.json`, 'utf8'),
  };
}

describe.skipIf(FINDER !== null)("the CRM's sample with Lead finder", () => {
  it('needs the add-ons checkout with Lead finder built (ADD_ONS_REPO)', () => {
    expect(FINDER).not.toBeNull();
  });
});

for (const [dialect, reachable] of LEGS) {
  for (const withFinder of [false, true]) {
    describe.skipIf(!reachable || (withFinder && FINDER === null))(`the company's details, ${withFinder ? 'with' : 'without'} Lead finder, on ${dialect}`, () => {
      let h: Harness;
      let served: Awaited<ReturnType<typeof servePublic>> | undefined;
      const service = () => createSampleDataService(h.sampleData);
      const app = async () => (await findSampleApp(h.meta, 'crm'))!;
      const count = async (table: string, where = '1 = 1') => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!['n']);
      const finderTables = async (): Promise<string[]> => {
        const tables = await h.rows(dialect === 'sqlite' ? `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lead_finder_%'` : dialect === 'postgres' ? `SELECT table_name AS name FROM information_schema.tables WHERE table_name LIKE 'lead_finder_%'` : `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'lead_finder_%'`);
        return tables.map((one) => String(one['name'] ?? one['NAME'] ?? one['TABLE_NAME']));
      };
      const held = async () => Object.fromEntries(await Promise.all(leadFile().tables.map(async (table) => [table.ref, await count(`lead_finder_${table.ref}`)] as const)));

      beforeAll(async () => {
        h = await addOnHarness(dialect, { unbuiltWords: {} });
        if (withFinder) await h.stageAddOn(FINDER!.manifest, { bundled: true, files: FINDER!.files });
        await h.stageApp(manifest(), files());
        const installed = await h.install('crm', String(manifest()['version']), { ...(withFinder ? { addOns: [{ key: 'lead-finder', version: FINDER!.version }] } : {}), modules: { inbox: true } });
        expect(installed.statusCode, installed.body).toBe(200);
      }, 600_000);
      afterAll(async () => {
        await served?.close();
        await h?.close();
      });

      it('installs companies with a number two companies may share, a phone and a few words about them', async () => {
        await h.rows(`INSERT INTO crm_companies (name, company_number, phone, about) VALUES ('Twin One', '98 000 999', '0113 496 0999', 'One of two with the same number.')`);
        await h.rows(`INSERT INTO crm_companies (name, company_number) VALUES ('Twin Two', '98 000 999')`);
        expect(await count('crm_companies', `company_number = '98 000 999'`)).toBe(2);
        const about = 'x'.repeat(1000);
        await h.rows(`UPDATE crm_companies SET about = '${about}', phone = '${'1'.repeat(40)}', company_number = '${'9'.repeat(40)}' WHERE name = 'Twin Two'`);
        expect((await h.rows(`SELECT about, phone, company_number FROM crm_companies WHERE name = 'Twin Two'`))[0]).toEqual({ about, phone: '1'.repeat(40), company_number: '9'.repeat(40) });
        await h.rows(`DELETE FROM crm_companies WHERE name IN ('Twin One', 'Twin Two')`);
      }, 120_000);

      it(`"Add sample data" brings fourteen companies, the five found ones nobody's, ${withFinder ? 'and the people Lead finder found at them' : 'and never reads Lead finder\'s file'}`, async () => {
        const added = await service()
          .add(await app(), { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' })
          .catch((error: unknown) => {
            throw new Error(`${String(error)} ${JSON.stringify((error as { details?: unknown }).details ?? null)}`);
          });
        expect(await count('crm_companies')).toBe(14);
        const found = await h.rows(`SELECT name, company_number, phone, about, website, account_owner_id, territory_id FROM crm_companies WHERE company_number IS NOT NULL ORDER BY name`);
        expect(found.map((row) => row['name'])).toEqual([...FOUND].sort());
        for (const row of found) expect([row['account_owner_id'] ?? null, row['territory_id'] ?? null]).toEqual([null, null]);
        expect(found.find((row) => row['name'] === 'Kestrel Yard Architects')).toMatchObject({ company_number: '98000412', phone: '0113 496 0412', website: 'https://kestrelyard.example', about: 'A small practice drawing homes and workshops.' });
        // The Meridian nine hold none of the three.
        expect(await count('crm_companies', 'company_number IS NULL AND phone IS NULL AND about IS NULL')).toBe(9);
        if (!withFinder) {
          expect(await finderTables()).toEqual([]);
          expect(Object.keys(added.counts).filter((key) => key.startsWith('lead-finder:'))).toEqual([]);
          return;
        }
        expect(added.counts).toMatchObject({ 'lead-finder:found_people': 4, 'lead-finder:tell_mails': 3, 'lead-finder:field_sources': 5 });
        expect(await held()).toEqual({ found_people: 4, tell_mails: 3, field_sources: 5 });
        // Each found person is a contact of the CRM's at the company it was found at, by the tables' stored names.
        const people = await h.rows(`SELECT f.person_table, f.company_table, f.state, c.name, c.company_id, f.company_key FROM lead_finder_found_people f JOIN crm_contacts c ON ${dialect === 'postgres' ? 'CAST(c.id AS TEXT)' : 'c.id'} = f.person_key ORDER BY f.id`);
        expect(people.map((row) => [row['name'], row['state']])).toEqual([
          ['Robin Hale', 'told'],
          ['Sam Ellery', 'waiting'],
          ['Jo Ashby', 'failed'],
          ['Kari Vik', 'told'],
        ]);
        for (const row of people) {
          expect(String(row['person_table'])).toMatch(/contacts$/);
          expect(String(row['company_table'])).toMatch(/companies$/);
          expect(String(row['company_id'])).toBe(String(row['company_key']));
        }
      }, 600_000);

      it.skipIf(!withFinder)("tells Lead finder's page of Companies and where each detail goes", async () => {
        // The whole server, signed in as somebody who runs the install, as Lead finder's page reads it.
        // Closing it ends the harness's database too: it stays up until the harness goes (afterAll).
        served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
        const user = await usersRepo(h.meta).create({ email: 'boss@crm.example', name: 'boss', passwordHash: await adminPasswordHash() });
        await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
        const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.3.0.1', payload: { email: 'boss@crm.example', password: ADMIN_PASSWORD } });
        const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/add-ons/lead-finder/kit', headers: { cookie: sessionCookie(login.headers['set-cookie']) } });
        expect(res.statusCode, res.body).toBe(200);
        const hosts = (res.json() as unknown as { hosts: { via: string; tableRef: string; lead?: unknown }[] }).hosts.filter((one) => one.via === 'companies');
        expect(hosts).toHaveLength(1);
        expect(hosts[0]!.tableRef).toMatch(/companies$/);
        expect(hosts[0]!.lead).toEqual(LEAD);
      }, 120_000);

      it('"Remove sample data" takes all of it away again', async () => {
        const removed = await service().remove(await app(), { keepChanged: true, userId: h.owner.id, userLabel: 'owner@test' });
        expect(removed.kept).toBe(0);
        expect([await count('crm_companies'), await count('crm_contacts')]).toEqual([0, 0]);
        if (withFinder) expect(await held()).toEqual({ found_people: 0, tell_mails: 0, field_sources: 0 });
        expect((await usersRepo(h.meta).countByStatus()).sample ?? 0).toBe(0);
      }, 600_000);
    });
  }
}
