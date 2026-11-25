// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LANDING PAGES IN THE CRM: the marketer's home and the sample's pages, on
 * the whole server, on SQLite, Postgres and MySQL, with Forms, Live chat and
 * Pages installed beside the CRM, and every staff call made signed in as the
 * person it is about.
 *
 *  - "Add sample data" with Pages brings the four landing pages in the adding
 *    person's language (three live, each publishing a page that parses, with
 *    no mark of Milo's) and the "Open day" funnel, whose steps name the
 *    sample's pages by their real keys and which is linked to the brochure rule;
 *    "Remove sample data" takes all of it away again;
 *  - the marketer reads what her home shows: the forms and their answers, the
 *    pages and the funnels (only the columns she is given), their views
 *    through Adminium's counts, the campaigns and the chats; she makes,
 *    changes and removes no page and no funnel;
 *  - a role without those reads (the operations manager, Read-only) reads
 *    none of them and no view of them;
 *  - without Pages, the sample adds and removes as before, its file for
 *    Pages never read.
 *
 * The add-ons are the ones the add-ons checkout built (`ADD_ONS_REPO`,
 * `packages/forms`, `packages/live-chat`, `packages/pages`); without them,
 * the run skips and says so.
 *
 * To run: `npm run proofs -- pages`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { automationsRepo, rolesRepo, usersRepo, viewDaysRepo } from '@adminium/meta';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.76' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p71w4-k`;
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
const read = (path: string) => readFileSync(`${APP}/${path}`, 'utf8');
const manifest = () => JSON.parse(read('whole/manifest.json')) as Record<string, unknown> & { version: string };

/** As the release will number them: the app suggests these versions or newer, and a checkout built before the release may say less. */
const numbered = (key: string, version: string) => {
  const built = builtAddOn(key);
  return built === null ? null : { ...built, version, manifest: { ...built.manifest, version } };
};
const FORMS = numbered('forms', '1.0.37');
const CHAT = numbered('live-chat', '1.0.31');
const PAGES = numbered('pages', '1.0.31');
const ALL = FORMS !== null && CHAT !== null && PAGES !== null;

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

/** The app's package as the release ships it, every sample file in it. */
function appFiles(): Record<string, string> {
  // The harness packs text only: the picture's bytes do not matter here, its place in the package does.
  const packed = JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { assets?: Record<string, { file: string; sha256: string }> };
  for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
  const out: Record<string, string> = { 'seeds/meridian.json': JSON.stringify(packed) };
  for (const file of ['meridian.inventory.json', 'meridian.forms.json', 'meridian.live-chat.json', 'meridian.pages.json']) out[`seeds/${file}`] = readFileSync(`${SEEDS}/${file}`, 'utf8');
  return out;
}

const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

describe.skipIf(ALL)('landing pages in the CRM', () => {
  it('needs the add-ons checkout with Forms, Live chat and Pages built (ADD_ONS_REPO)', () => {
    expect({ forms: FORMS !== null, chat: CHAT !== null, pages: PAGES !== null }).toEqual({ forms: true, chat: true, pages: true });
  });
});

describe.each(LEGS)(`the CRM with Forms, Live chat and Pages — %s`, (dialect, legAvailable) => {
  const available = legAvailable && ALL;
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  const cookie: Record<string, string> = {};
  const tables: Record<string, string> = {};
  const tableIds: Record<string, string> = {};
  const installs: Record<string, string> = {};
  const service = () => createSampleDataService(h.sampleData);
  const app = async () => (await findSampleApp(h.meta, 'crm'))!;
  const rows = (statement: string) => h.rows(statement) as Promise<Doc[]>;
  const count = async (ref: string) => Number((await rows(`SELECT COUNT(*) AS n FROM ${tables[ref]!}`))[0]!['n']);
  const as = (who: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { cookie: cookie[who]! }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const data = (ref: string, rest = '') => `/api/v1/data/${h.connectionId}/${tableIds[ref]!}${rest}`;
  const views = (q: Record<string, string>) => `/api/v1/views?${new URLSearchParams(q).toString()}`;
  const today = new Date().toISOString().slice(0, 10);
  const month = { from: `${today.slice(0, 8)}01`, to: today };
  /** The sample's rows of the pages: the open day, its thanks page and the booths, by label. */
  const page: Record<string, string> = {};

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    for (const addOn of [FORMS!, CHAT!, PAGES!]) await h.stageAddOn(addOn.manifest, { bundled: true, files: addOn.files });
    await h.stageApp(manifest(), appFiles());
    const installed = await h.install('crm', manifest().version, {
      addOns: [FORMS!, CHAT!, PAGES!].map((addOn) => ({ key: addOn.key, version: addOn.version })),
      modules: { inbox: true, jobs: true, aftercare: true },
    });
    expect(installed.statusCode, installed.body).toBe(200);
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;
    const snapshot = await h.meta.db.selectFrom('adminium_schema_snapshots').select(['schema']).where('connectionId', '=', h.connectionId).orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    const schema = (typeof snapshot.schema === 'string' ? JSON.parse(snapshot.schema) : snapshot.schema) as { tables: { id: string; name: string }[] };
    for (const ref of ['crm:enquiries', 'forms:forms', 'forms:answers', 'pages:pages', 'pages:funnels', 'live-chat:conversations']) tableIds[ref] = schema.tables.find((one) => one.name === tables[ref])!.id;
    for (const row of await h.meta.db.selectFrom('adminium_manifests').select(['id', 'manifestKey']).where('kind', '=', 'add-on').execute()) installs[row.manifestKey] = row.id;

    root = await mkdtemp(join(tmpdir(), 'crm-pages-'));
    await mkdir(join(root, 'dist', 'x'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body></body></html>');
    await writeFile(join(root, 'dist', 'x', 'index.html'), '<!doctype html><html><body><noscript>x</noscript></body></html>');
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: join(root, 'dist'),
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    const hash = await adminPasswordHash();
    const people: [string, string[]][] = [
      ['lena', ['crm-marketer']],
      ['ada', ['crm-ops-manager']],
      ['grace', ['crm-read-only']],
    ];
    for (const [name, slugs] of people) {
      const user = await usersRepo(h.meta).create({ email: `${name}@meridian-workplace.com`, name: `${name[0]!.toUpperCase()}${name.slice(1)}`, passwordHash: hash });
      for (const slug of slugs) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
      const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.16.0.${String(people.findIndex(([one]) => one === name) + 1)}`, payload: { email: `${name}@meridian-workplace.com`, password: ADMIN_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      cookie[name] = sessionCookie(login.headers['set-cookie']);
    }
  }, 600_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('"Add sample data" brings the four landing pages and the "Open day" funnel, its steps naming the pages by their keys', async () => {
    const added = await service()
      .add(await app(), { locale: 'de-DE', userId: h.owner.id, userLabel: 'owner@test' })
      .catch((error: unknown) => {
        throw new Error(`${String(error)} ${JSON.stringify((error as { details?: unknown }).details ?? null)}`);
      });
    expect(added.counts).toMatchObject({ 'pages:pages': 4, 'pages:funnels': 1 });
    const pages = await rows(`SELECT * FROM ${tables['pages:pages']!} ORDER BY id`);
    // Every page in the adding person's language: its name, the language it says, and every word inside it.
    expect(pages.map((row) => [row['slug'], row['state'], row['language']])).toEqual([
      ['acoustic-booths', 'live', 'de-DE'],
      ['showroom-open-day', 'live', 'de-DE'],
      ['thanks-open-day', 'live', 'de-DE'],
      ['spring-open-day', 'draft', 'de-DE'],
    ]);
    expect(pages.map((row) => row['name'])).toEqual(['Akustikkabinen', 'Tag der offenen Tür im Showroom', 'Danke, bis bald', 'Frühjahrs-Tag der offenen Tür']);
    for (const [i, slug] of ['booths', 'open-day', 'thanks', 'spring'].entries()) page[slug] = String(pages[i]!['id']);
    expect(JSON.stringify(json(pages[0]!['draft']))).not.toContain('@t');
    // What a live page publishes parses whole and carries no mark of Milo's; its links name the booths' real key.
    const { parseLandingPage, hasMiloMarks } = await import('@adminium/add-on-contracts/landing');
    for (const row of pages.filter((one) => one['state'] === 'live')) {
      const parsed = parseLandingPage(json(row['published']));
      expect(parsed.ok, String(row['slug'])).toBe(true);
      if (parsed.ok) expect(hasMiloMarks(parsed.page)).toBe(false);
      expect(row['published_at']).not.toBeNull();
    }
    const openDay = json(pages[1]!['published']) as Doc;
    expect(openDay.title).toBe('Tag der offenen Tür im Showroom');
    expect(openDay.blocks[0].heading).toBe('Tag der offenen Tür in unserem Showroom in Leeds');
    expect(openDay.blocks[0].button).toEqual({ label: 'Zu den Kabinen', link: { kind: 'page', key: page['booths'] } });
    expect(openDay.blocks.find((block: Doc) => block.kind === 'form')).toMatchObject({ kind: 'form', addOn: 'forms' });
    expect(pages[3]!['published']).toBeNull();
    const [funnel] = await rows(`SELECT * FROM ${tables['pages:funnels']!}`);
    expect(funnel!['name']).toBe('Tag der offenen Tür');
    expect(json(funnel!['steps'])).toEqual([
      { kind: 'page', key: page['open-day'] },
      { kind: 'form', key: openDay.blocks.find((block: Doc) => block.kind === 'form').form, addOn: 'forms' },
      { kind: 'page', key: page['thanks'] },
    ]);
    // Linked to the CRM's brochure rule, as this database installed it.
    const brochure = (await automationsRepo(h.meta).listManagedBy('crm', h.connectionId)).find((rule) => rule.templateKey === 'brochure-asked');
    expect(brochure, 'the brochure rule').toBeDefined();
    expect(funnel!['rule_id']).toBe(brochure!.id);
  }, 600_000);

  it.skipIf(!available)('the marketer reads the forms, their answers, the pages and the funnels her home shows, only the columns she is given', async () => {
    const pages = await as('lena', 'GET', data('pages:pages'));
    expect(pages.statusCode, pages.body).toBe(200);
    const listed = (pages.json() as Doc).data as Doc[];
    expect(listed.length).toBe(4);
    for (const row of listed) for (const column of ['draft', 'published']) expect(row[column], column).toBeUndefined();
    const funnels = await as('lena', 'GET', data('pages:funnels'));
    expect(funnels.statusCode, funnels.body).toBe(200);
    expect(json(((funnels.json() as Doc).data as Doc[])[0]!['steps'])).toHaveLength(3);
    for (const ref of ['forms:forms', 'forms:answers', 'live-chat:conversations']) {
      const reply = await as('lena', 'GET', data(ref, '?limit=1&count=exact'));
      expect(reply.statusCode, `${ref} ${reply.body}`).toBe(200);
    }
    // Answers per form, as the home asks the figure.
    const figure = await as('lena', 'POST', '/api/v1/widget-data/query', {
      descriptor: { connectionId: h.connectionId, source: { name: tableIds['forms:answers'] }, shape: 'categorical', filters: [], groupBy: ['form_id'], aggregations: [{ fn: 'count', alias: 'n' }], limit: 200 },
    });
    expect(figure.statusCode, figure.body).toBe(200);
    expect(((figure.json() as Doc).result.items as Doc[]).reduce((sum, item) => sum + Number(item.values?.n ?? item.value), 0)).toBe(await count('forms:answers'));
    // The campaigns, as everybody who signs in reads them.
    expect((await as('lena', 'GET', '/api/v1/email-templates?kind=campaign')).statusCode).toBe(200);
  });

  it.skipIf(!available)('the marketer reads each step’s views through Adminium’s counts, the pages’ and the form’s at the page before it', async () => {
    const counts = viewDaysRepo(h.meta);
    await counts.add({ installId: installs['pages']!, kind: 'page', thing: page['open-day']!, place: '', day: month.to, views: 120 });
    await counts.add({ installId: installs['pages']!, kind: 'page', thing: page['thanks']!, place: '', day: month.to, views: 9 });
    const form = String((json((await rows(`SELECT published FROM ${tables['pages:pages']!} WHERE id = ${page['open-day']!}`))[0]!['published']) as Doc).blocks.find((block: Doc) => block.kind === 'form').form);
    await counts.add({ installId: installs['forms']!, kind: 'form-opened', thing: form, place: page['open-day']!, day: month.to, views: 40 });
    await counts.add({ installId: installs['forms']!, kind: 'form-sent', thing: form, place: page['open-day']!, day: month.to, views: 11 });
    // The install ids the home finds them by, from the add-ons list a signed-in person reads.
    const addOns = ((await as('lena', 'GET', '/api/v1/add-ons')).json() as Doc).addOns as Doc[];
    expect(addOns.filter((one) => ['pages', 'forms'].includes(one.key)).map((one) => [one.key, one.installId]).sort()).toEqual([['forms', installs['forms']], ['pages', installs['pages']]]);
    const pageViews = await as('lena', 'GET', views({ installId: installs['pages']!, kind: 'page', things: `${page['open-day']!},${page['thanks']!}`, ...month }));
    expect(pageViews.statusCode, pageViews.body).toBe(200);
    expect(((pageViews.json() as Doc).data.things as Doc[]).map((one) => [one.thing, (one.days as Doc[]).reduce((sum, day) => sum + Number(day.views), 0)])).toEqual([[page['open-day'], 120], [page['thanks'], 9]]);
    for (const [kind, n] of [['form-opened', 40], ['form-sent', 11]] as const) {
      const reply = await as('lena', 'GET', views({ installId: installs['forms']!, kind, things: form, place: page['open-day']!, ...month }));
      expect(reply.statusCode, reply.body).toBe(200);
      expect(((reply.json() as Doc).data.things as Doc[])[0]!.days[0].views).toBe(n);
    }
  });

  it.skipIf(!available)('the marketer makes, changes and removes no page and no funnel', async () => {
    const before = [await count('pages:pages'), await count('pages:funnels')];
    const made = await as('lena', 'POST', data('pages:pages'), { values: { name: 'Mine', slug: 'mine', state: 'draft', language: 'en-US', draft: { v: 1, title: 'Mine', description: 'Mine', blocks: [] } } });
    expect(made.statusCode, made.body).toBe(403);
    const changed = await as('lena', 'PATCH', data('pages:pages', `/${page['open-day']!}`), { values: { name: 'Changed' } });
    expect(changed.statusCode, changed.body).toBe(403);
    expect((await as('lena', 'DELETE', data('pages:pages', `/${page['spring']!}`))).statusCode).toBe(403);
    const funnel = String((await rows(`SELECT id FROM ${tables['pages:funnels']!}`))[0]!['id']);
    expect((await as('lena', 'POST', data('pages:funnels'), { values: { name: 'Mine', steps: [] } })).statusCode).toBe(403);
    expect((await as('lena', 'PATCH', data('pages:funnels', `/${funnel}`), { values: { name: 'Changed' } })).statusCode).toBe(403);
    expect((await as('lena', 'DELETE', data('pages:funnels', `/${funnel}`))).statusCode).toBe(403);
    expect([await count('pages:pages'), await count('pages:funnels')]).toEqual(before);
    expect((await rows(`SELECT name FROM ${tables['pages:pages']!} WHERE id = ${page['open-day']!}`))[0]!['name']).toBe('Tag der offenen Tür im Showroom');
  });

  it.skipIf(!available)('a role without those reads (the operations manager, Read-only) reads no form, page or funnel, and no view of them', async () => {
    for (const who of ['ada', 'grace']) {
      for (const ref of ['forms:forms', 'forms:answers', 'pages:pages', 'pages:funnels']) {
        const reply = await as(who, 'GET', data(ref, '?limit=1'));
        expect(reply.statusCode, `${who} ${ref} ${reply.body}`).toBe(403);
      }
      expect((await as(who, 'GET', views({ installId: installs['pages']!, kind: 'page', things: page['open-day']!, ...month }))).statusCode, who).toBe(403);
      expect((await as(who, 'GET', views({ installId: installs['forms']!, kind: 'form-sent', things: 'x', ...month }))).statusCode, who).toBe(403);
    }
  });

  it.skipIf(!available)('"Remove sample data" takes the pages and the funnel away again, with the rest', async () => {
    const removed = await service().remove(await app(), { keepChanged: true, userId: h.owner.id, userLabel: 'owner@test' });
    expect(removed.kept).toBe(0);
    expect([await count('pages:pages'), await count('pages:funnels'), await count('crm:enquiries')]).toEqual([0, 0, 0]);
    expect((await usersRepo(h.meta).countByStatus()).sample ?? 0).toBe(0);
  }, 600_000);
});

/** Without Pages: the sample comes and goes as before, its file for Pages never read. */
describe.each(LEGS)(`the CRM's sample without Pages — %s`, (dialect, legAvailable) => {
  const available = legAvailable && FORMS !== null;
  let h: Harness;
  const service = () => createSampleDataService(h.sampleData);
  const app = async () => (await findSampleApp(h.meta, 'crm'))!;

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(FORMS!.manifest, { bundled: true, files: FORMS!.files });
    // The package is the whole release, the file for Pages in it too.
    await h.stageApp(manifest(), appFiles());
    // Pages is suggested and not on this server (nor on a shelf it reads): shown as not available here, not ticked, and
    // the install goes without it.
    const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'crm', version: manifest().version, connectionId: h.connectionId } });
    expect(plan.statusCode, plan.body).toBe(200);
    const pages = (((plan.json() as Doc).plan as Doc).addOns as Doc[] | undefined)?.find((one) => one.key === 'pages');
    expect(pages === undefined ? null : { state: pages.state, checked: pages.checked, action: pages.action, need: pages.need }).toEqual({ state: 'unavailable', checked: false, action: null, need: 'suggests' });
    expect((pages!.problems as Doc[]).map((problem) => problem.code)).toEqual(['ADD_ON_UNAVAILABLE']);
    const installed = await h.install('crm', manifest().version, { addOns: [{ key: 'forms', version: FORMS!.version }], modules: { inbox: true } });
    expect(installed.statusCode, installed.body).toBe(200);
  }, 600_000);
  afterAll(async () => {
    if (available) await h?.close();
  });

  it.skipIf(!available)('adds the sample with no landing page and takes it away again', async () => {
    const added = await service().add(await app(), { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' });
    expect(Object.keys(added.counts).filter((ref) => ref.startsWith('pages:'))).toEqual([]);
    expect((await h.tableNames()).filter((name) => name.startsWith('pages_'))).toEqual([]);
    expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM forms_forms`))[0]!['n'])).toBe(5);
    const removed = await service().remove(await app(), { keepChanged: true, userId: h.owner.id, userLabel: 'owner@test' });
    expect(removed.kept).toBe(0);
    expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM forms_forms`))[0]!['n'])).toBe(0);
    expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM crm_enquiries`))[0]!['n'])).toBe(0);
  }, 600_000);
});
