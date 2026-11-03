import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';

// The app this copy of the proofs came from (`npm run proofs` names it), not a fixed lane.
const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
// The sample the app ships, from the app's own repo.
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
const bundle = () => JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { tables: { ref: string; rows: unknown[] }[] };

const manifest = () => {
  const m = JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
  return m;
};

/** The install as an owner who ticks Invoices & Receipts and every part: quotes are a part that waits for the add-on. */
const WITH_EVERY_PART = { install: { addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } } };

async function invoices(meta: MetaDb): Promise<void> {
  const document = JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  document['version'] = '1.1.0';
  const addOn = document['addOn'] as { attaches?: { app: string }[] };
  addOn.attaches = [...(addOn.attaches ?? []).filter((one) => one.app !== 'crm'), { app: 'crm' }];
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: document as never });
}

const memoryFiles = { write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }) } as unknown as FileStore;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's sample on ${dialect}`, () => {
    let h: InvoicingHarness;
    let service: ReturnType<typeof createSampleDataService>;
    beforeAll(async () => {
      // The harness packs text only: the picture's bytes do not matter to this proof, its place in the package does.
      const packed = JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { assets?: Record<string, { file: string; sha256: string }> };
      for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
      const files: Record<string, string> = { 'seeds/meridian.json': JSON.stringify(packed) };
      h = await installInvoicing(dialect, manifest(), invoices, files, WITH_EVERY_PART);
      service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
    }, 240_000);
    afterAll(async () => { await h?.close(); });
    const n = async (sql: string) => Number((await h.rows(sql))[0]!['n']);

    it('adds every row of the bundle and the sixteen people', async () => {
      const app = (await findSampleApp(h.meta, 'crm'))!;
      await service.add(app, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
      const short: string[] = [];
      for (const table of bundle().tables) {
        const got = await n(`SELECT COUNT(*) AS n FROM ${h.real(table.ref)}`);
        if (got !== table.rows.length) short.push(`${table.ref}: ${String(got)} of ${String(table.rows.length)}`);
      }
      expect(short).toEqual([]);
      expect((await usersRepo(h.meta).countByStatus()).sample).toBe(16);
    }, 240_000);

    it('holds the ledger, from the columns the engine keeps', async () => {
      const deals = h.real('deals');
      const two = async (where: string) => { const r = (await h.rows(`SELECT COUNT(*) AS n, SUM(amount) AS a, SUM(weighted_value) AS w FROM ${deals} WHERE ${where}`))[0]!; return [Number(r['n']), Number(r['a']), Number(r['w'])]; };
      expect(await two(`state = 'open'`)).toEqual([14, 286300, 156562.5]);
      const dana = (await usersRepo(h.meta).list({ status: 'sample', limit: 50 })).find((user) => user.name === 'Dana Whitlock')!;
      expect(await two(`state = 'open' AND owner_id = '${dana.id}'`)).toEqual([6, 143400, 95740]);
      expect((await two(`state = 'won'`)).slice(0, 2)).toEqual([8, 130000]);
      expect((await two(`state = 'lost'`)).slice(0, 2)).toEqual([18, 294400]);
      // Closed (ledger 8): every closed deal says the day it closed and the days it was open; won deals took 54 days on average, the longest 77.
      expect(await n(`SELECT COUNT(*) AS n FROM ${deals} WHERE state <> 'open' AND (closed_on IS NULL OR cycle_days IS NULL)`)).toBe(0);
      expect(await n(`SELECT COUNT(*) AS n FROM ${deals} WHERE state = 'open' AND (closed_on IS NOT NULL OR cycle_days IS NOT NULL)`)).toBe(0);
      const cycle = (await h.rows(`SELECT SUM(cycle_days) AS s, MAX(cycle_days) AS m, COUNT(*) AS n FROM ${deals} WHERE state = 'won'`))[0]!;
      expect([Math.round(Number(cycle['s']) / Number(cycle['n'])), Number(cycle['m'])]).toEqual([54, 77]);
      // Targets (ledger 14): what counts toward a target is ONE column the engine keeps, so the server can add it up for whoever reads it:
      // a won deal's amount, an open deal's weighted value, nothing of a lost one. Open and won together: 156,562.50 + 130,000.
      expect(await n(`SELECT COUNT(*) AS n FROM ${deals} WHERE target_value IS NULL OR (state = 'lost' AND target_value <> 0) OR (state = 'won' AND target_value <> amount) OR (state = 'open' AND target_value <> weighted_value)`)).toBe(0);
      expect(Number((await h.rows(`SELECT SUM(target_value) AS s FROM ${deals}`))[0]!['s'])).toBe(286562.5);
      expect(Number((await h.rows(`SELECT SUM(target_value) AS s FROM ${deals} WHERE owner_id = '${dana.id}' AND state = 'open'`))[0]!['s'])).toBe(95740);
      // S1: the five quoted deals stand at their newest SENT version.
      const quoted = await h.rows(`SELECT quoted_amount FROM ${deals} WHERE quoted_amount IS NOT NULL`);
      expect(quoted.map((r) => Number(r['quoted_amount'])).sort((a, b) => a - b)).toEqual([21500, 27500, 31000, 38000, 52800]);
      // Every quote line took its list price from the price list as it went in, so no version is short of one.
      expect(await n(`SELECT COUNT(*) AS n FROM ${h.real('quote_lines')} WHERE list_rate IS NULL OR price_id IS NULL`)).toBe(0);
      expect(await n(`SELECT COALESCE(SUM(unlisted_lines), 0) AS n FROM ${h.real('quotes')}`)).toBe(0);
      // Jobs: seven signed off; the snags that still stop a sign-off are counted on their jobs.
      expect(await n(`SELECT COUNT(*) AS n FROM ${h.real('jobs')} WHERE state = 'signed-off'`)).toBe(7);
      // The sample's jobs carry the ledger's numbers in the app's own series (J-01 to J-08), in the order the deals were won.
      const jobs = await h.rows(`SELECT j.code, j.code_seq, d.closed_at FROM ${h.real('jobs')} j JOIN ${deals} d ON d.id = j.deal_id ORDER BY j.code`);
      expect(jobs.map((r) => r['code'])).toEqual(['J-01', 'J-02', 'J-03', 'J-04', 'J-05', 'J-06', 'J-07', 'J-08']);
      expect(jobs.map((r) => Number(r['code_seq']))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      const closed = jobs.map((r) => new Date(String(r['closed_at'])).getTime());
      expect(closed).toEqual([...closed].sort((x, y) => x - y));
      const stops = await n(`SELECT COUNT(*) AS n FROM ${h.real('snags')} WHERE stops_sign_off = ${dialect === 'postgres' ? 'true' : '1'} AND state <> 'put-right'`);
      expect(await n(`SELECT COALESCE(SUM(blocking_snags), 0) AS n FROM ${h.real('jobs')}`)).toBe(stops);
      // A delivery-note line found its job, and a snag its crew, though the bundle wrote neither.
      expect(await n(`SELECT COUNT(*) AS n FROM ${h.real('delivery_note_lines')} WHERE job_id IS NULL`)).toBe(0);
      expect(await n(`SELECT COUNT(*) AS n FROM ${h.real('snags')} WHERE due_on IS NULL OR due_days IS NULL`)).toBe(0);
      // Every sample deal keeps the stage it was last written at (P18), so its first move names the stage it left.
      expect(await n(`SELECT COUNT(*) AS n FROM ${deals} WHERE stage_kept_id IS NULL OR stage_kept_id <> stage_id`)).toBe(0);
    });

    it.runIf(process.env.CRM_DIAG === '1')('diagnosis: columns the bundle leaves out and the install leaves empty', async () => {
      const m = manifest() as { requiredSchema: { tables: { ref: string; columns: { ref: string; rules?: Record<string, unknown>; nullable?: boolean }[] }[] } };
      const out: string[] = [];
      for (const table of bundle().tables as { ref: string; rows: Record<string, unknown>[] }[]) {
        const declared = m.requiredSchema.tables.find((t) => t.ref === table.ref)!;
        const written = new Set(table.rows.flatMap((row) => Object.keys(row)));
        for (const column of declared.columns) {
          if (written.has(column.ref) || column.rules === undefined) continue;
          const kinds = Object.keys(column.rules).filter((k) => ['rollup', 'copy', 'formula', 'stamp', 'sequence', 'default'].includes(k));
          if (kinds.length === 0) continue;
          const empty = await n(`SELECT COUNT(*) AS n FROM ${h.real(table.ref)} WHERE ${column.ref === 'to' || column.ref === 'from' ? `"${column.ref}"` : column.ref} IS NULL`);
          const zero = await n(`SELECT COUNT(*) AS n FROM ${h.real(table.ref)} WHERE CAST(${column.ref === 'to' || column.ref === 'from' ? `"${column.ref}"` : column.ref} AS CHAR) IN ('0', '0.0', '0.00', '')`).catch(() => -1);
          if (empty > 0 || zero === table.rows.length) out.push(`${table.ref}.${column.ref} [${kinds.join(',')}] empty ${String(empty)} zero ${String(zero)} of ${String(table.rows.length)}`);
        }
      }
      console.log(out.join('\n'));
    }, 240_000);

    it('the first job anybody makes beside the sample is J-09', async () => {
      // The sample's jobs hold J-01 to J-08 in the app's own series (once they were typed "S-01": a typed "J-01" met this very job).
      const w = await writerFor(h);
      const free = (await h.rows(`SELECT id FROM ${h.real('deals')} WHERE id NOT IN (SELECT deal_id FROM ${h.real('jobs')}) ORDER BY id`))[0]!;
      const job = await w.create('jobs', { deal_id: free['id'], site_name: 'A new site' });
      const made = (await h.rows(`SELECT code, code_seq FROM ${h.real('jobs')} WHERE id = ${String(job['id'])}`))[0]!;
      expect([made['code'], Number(made['code_seq'])]).toEqual(['J-09', 9]);
      // Taken out again, so that the count of what the sample leaves behind is the sample's own; and the deal's count of
      // its jobs put back, which a removal straight in the database does not count again (else the deal reads as changed).
      await h.rows(`DELETE FROM ${h.real('jobs')} WHERE id = ${String(job['id'])}`);
      await h.rows(`UPDATE ${h.real('deals')} SET job_count = 0 WHERE id = ${String(free['id'])}`);
    });

    it('takes it all away again', async () => {
      const app = (await findSampleApp(h.meta, 'crm'))!;
      // The settings row was the install's before the sample came (the app's one starting row): the sample filled in
      // what it left empty, Meridian's depot, and wrote over nothing. Still one row.
      const depot = async () => (await h.rows(`SELECT depot_name, depot_town, snag_days FROM ${h.real('settings')}`)).map((row) => [row['depot_name'], row['depot_town'], Number(row['snag_days'])]);
      expect(await depot()).toEqual([['Meridian depot', 'Leeds', 5]]);
      await service.remove(app, { keepChanged: true, userId: null, userLabel: 'test' });
      // The depot leaves with the sample; the row and its defaults are the owner's and stay.
      expect(await depot()).toEqual([[null, null, 5]]);
      const left: string[] = [];
      for (const table of bundle().tables) {
        const got = await n(`SELECT COUNT(*) AS n FROM ${h.real(table.ref)}`);
        if (got !== 0) left.push(`${table.ref}: ${String(got)}`);
      }
      // Everything of the sample is gone; the install's settings row is the owner's and stays.
      expect(left).toEqual(['settings: 1']);
      expect((await usersRepo(h.meta).countByStatus()).sample).toBe(0);
    }, 240_000);
  });
}

/**
 * The sample with Forms (`sampleData.addOns.forms`): the app's file for the add-on is loaded with the rest and leaves
 * with it. Needs the add-ons checkout with Forms built (`ADD_ONS_REPO`).
 */
const BUILT = builtAddOn('forms');
// As the release will number it: the app suggests Forms 1.0.15 or newer, and a checkout built before the release says 1.0.14.
const FORMS = BUILT === null ? null : { ...BUILT, version: '1.0.15', manifest: { ...BUILT.manifest, version: '1.0.15' } };
const formsFile = () => JSON.parse(readFileSync(`${SEEDS}/meridian.forms.json`, 'utf8')) as { tables: { ref: string; own?: true; rows: unknown[] }[] };

describe.skipIf(FORMS !== null)("the CRM's sample with Forms", () => {
  it('needs the add-ons checkout with Forms built (ADD_ONS_REPO)', () => {
    expect(FORMS).not.toBeNull();
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable || FORMS === null)(`the CRM's sample with Forms, on ${dialect}`, () => {
    let h: Harness;
    const service = () => createSampleDataService(h.sampleData);
    const app = async () => (await findSampleApp(h.meta, 'crm'))!;
    const real = (ref: string, own: boolean) => (own ? `crm_${ref}` : `forms_${ref}`);
    const crmCount = async (ref: string) => count(real(ref, true));
    const count = async (table: string, where = '1 = 1') => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!['n']);
    const held = async () => Object.fromEntries(await Promise.all(formsFile().tables.map(async (table) => [table.ref, await count(real(table.ref, table.own === true))] as const)));

    beforeAll(async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageAddOn(FORMS!.manifest, { bundled: true, files: FORMS!.files });
      // The harness packs text only: the picture's bytes do not matter to this proof, its place in the package does.
      const packed = JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { assets?: Record<string, { file: string; sha256: string }> };
      for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
      await h.stageApp(manifest(), { 'seeds/meridian.json': JSON.stringify(packed), 'seeds/meridian.inventory.json': readFileSync(`${SEEDS}/meridian.inventory.json`, 'utf8'), 'seeds/meridian.forms.json': readFileSync(`${SEEDS}/meridian.forms.json`, 'utf8') });
      const installed = await h.install('crm', String(manifest()['version']), { addOns: [{ key: 'forms', version: FORMS!.version }], modules: { inbox: true, jobs: true, aftercare: true } });
      expect(installed.statusCode, installed.body).toBe(200);
    }, 600_000);
    afterAll(async () => {
      await h?.close();
    });

    it('"Add sample data" brings the five forms, their invitations and answers, and the enquiries and feedback they made', async () => {
      const added = await service()
        .add(await app(), { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' })
        .catch((error: unknown) => {
          throw new Error(`${String(error)} ${JSON.stringify((error as { details?: unknown }).details ?? null)}`);
        });
      expect(added.counts).toMatchObject({ 'forms:forms': 5, 'forms:invitations': 7, 'forms:answers': 21 });
      expect(await held()).toEqual({ forms: 5, invitations: 7, answers: 21 });
      // Each answer names the row it became as the engine writes one (`crm:<table>`), and the row is there.
      const became = await h.rows(`SELECT became_table, became_key FROM forms_answers WHERE became_table IS NOT NULL ORDER BY became_table`);
      expect(became.map((row) => row['became_table'])).toEqual(['crm:enquiries', 'crm:enquiries', 'crm:enquiries', 'crm:feedback', 'crm:feedback']);
      for (const row of became) expect(await count(real(String(row['became_table']).slice(4), true), `id = ${String(row['became_key'])}`), String(row['became_key'])).toBe(1);
      // The survey's invitations name each signed-off job as other rows do, and its answers their invitation; none keeps a token.
      expect(await count('forms_invitations', `record_table = 'crm:jobs' AND token_hash IS NULL`)).toBe(7);
      expect(await count('forms_answers', 'invitation_id IS NOT NULL')).toBe(2);
      expect(await count('forms_answers', 'ip IS NOT NULL OR user_agent IS NOT NULL')).toBe(0);
      // The feedback a survey made is marked so, and is the job's only answer.
      expect(await count('crm_feedback', `from_survey = ${dialect === 'postgres' ? 'true' : '1'}`)).toBe(2);
      // The forms are written as the builder writes them: what a visitor is served parses.
      const { parseForm } = await import('@adminium/add-on-contracts/forms');
      for (const row of await h.rows('SELECT slug, state, definition, settings, published FROM forms_forms')) {
        const json = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value) as { definition: unknown; settings: unknown };
        const parsed = parseForm(json(row['definition']), json(row['settings']));
        expect(parsed.ok ? [] : parsed, String(row['slug'])).toEqual([]);
        if (row['state'] !== 'draft') expect(json(row['published']), String(row['slug'])).toEqual({ definition: json(row['definition']), settings: json(row['settings']) });
      }
    }, 600_000);

    it('"Remove sample data" takes all of it away again', async () => {
      const removed = await service().remove(await app(), { keepChanged: true, userId: h.owner.id, userLabel: 'owner@test' });
      expect(removed.kept).toBe(0);
      expect(await held()).toEqual({ forms: 0, invitations: 0, answers: 0 });
      expect([await crmCount('enquiries'), await crmCount('feedback'), await crmCount('jobs')]).toEqual([0, 0, 0]);
      expect((await usersRepo(h.meta).countByStatus()).sample ?? 0).toBe(0);
    }, 600_000);
  });
}
