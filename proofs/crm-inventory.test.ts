/**
 * Plan 67, F09 (the Inventory file) on top of Part 1's T13g: THE CRM'S OWN GOODS, STOCKED BY INVENTORY.
 *
 * The real app, its real sample (both files), and the Invoices and Inventory add-ons AS THEY ARE BUILT in the
 * add-ons repository at 1.0.12, on SQLite, Postgres and MySQL. "Add sample data" brings Meridian's ten stock
 * lines, six suppliers and depot as rows with no history, then asks Inventory for the rest: an opening receipt
 * is posted and four orders are sent by saves of their own. Every figure read below is one Inventory keeps.
 *
 * To run: build the two add-ons (`npm run build -w packages/invoices -w packages/inventory` in the add-ons
 * checkout), copy this file into `~/Work/lanes/p67/apps/server/test/` as `zz-crm-inventory.test.ts`, run with
 * `ADMINIUM_ADD_ONS_REPO=<the checkout>`, remove.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { builtAddOn, writing, type Installed, type Writing } from './add-ons/harness.js';
import { addOnHarness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const read = (path: string) => readFileSync(`${APP}/${path}`, 'utf8');
const manifest = () => JSON.parse(read("whole/manifest.json")) as Record<string, unknown> & { version: string };
const inventory = builtAddOn('inventory');
const invoices = builtAddOn('invoices');
const n = (value: unknown): number => Number(value);

describe.skipIf(inventory !== null && invoices !== null)('the CRM\'s goods in Inventory', () => {
  it('needs the add-ons repository, with Invoices and Inventory built (ADMINIUM_ADD_ONS_REPO)', () => {
    expect([inventory === null ? 'inventory: not built' : 'ok', invoices === null ? 'invoices: not built' : 'ok']).toEqual(['ok', 'ok']);
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable || inventory === null || invoices === null)(`the CRM's goods, stocked by Inventory from the CRM's sample, on ${dialect}`, () => {
    let w: Writing;
    const service = () => createSampleDataService({ ...w.h.sampleData, writes: () => w.writes });
    const app = async () => (await findSampleApp(w.h.meta, 'crm'))!;
    const who = () => ({ userId: w.h.owner.id, userLabel: 'owner@test' });
    const inv = (ref: string) => `inventory_${ref}`;
    const count = async (table: string, where = '1 = 1') => n((await w.h.rows(`select count(*) as c from ${table} where ${where}`))[0]!['c']);
    const HELD = ['suppliers', 'places', 'items', 'item_suppliers', 'receipts', 'receipt_lines', 'purchase_orders', 'po_lines', 'stock_points', 'levels', 'batches', 'movements', 'on_order_moves', 'postings'];
    const held = async () => Object.fromEntries(await Promise.all(HELD.map(async (ref) => [ref, await count(inv(ref))] as const)));
    const bySku = async (column: string) => Object.fromEntries((await w.h.rows(`select sku, ${column} as v from ${inv('items')} order by sku`)).map((row) => [String(row['sku']), n(row['v'])]));

    beforeAll(async () => {
      const h = await addOnHarness(dialect, {});
      await h.stageAddOn(invoices!.manifest, { bundled: true, files: invoices!.files });
      await h.stageAddOn(inventory!.manifest, { bundled: true, files: inventory!.files });
      // The harness packs text only: the picture's bytes do not matter here, its place in the package does.
      const packed = JSON.parse(read('whole/seeds/meridian.json')) as { assets?: Record<string, { file: string; sha256: string }> };
      for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
      await h.stageApp(manifest(), { 'seeds/meridian.json': JSON.stringify(packed), 'seeds/meridian.inventory.json': read('whole/seeds/meridian.inventory.json') });
      const installed = await h.install('crm', manifest().version, { addOns: [{ key: 'invoices', version: invoices!.version }, { key: 'inventory', version: inventory!.version }] });
      expect(installed.statusCode, installed.body).toBe(200);
      const as: Installed = { h, addOn: inventory!, reply: installed.json() as Record<string, unknown>, real: inv, rowsOf: (ref, where) => h.rows(`select * from ${inv(ref)}${where === undefined ? '' : ` where ${where}`}`), hosts: [] };
      w = await writing(as);
    }, 600_000);
    afterAll(async () => {
      await w?.h.close();
    });

    it('"Add sample data" brings the ten lines and six suppliers, and Inventory writes what is on hand and on order', async () => {
      const added = await service().add(await app(), { locale: 'en-US', ...who() });
      expect(added.counts).toMatchObject({ deals: 40, deal_stock_needs: 17, 'inventory:items': 10, 'inventory:suppliers': 6, 'inventory:receipt_lines': 7, 'inventory:purchase_orders': 133, 'inventory:receipts': 130 });
      // On hand, line by line: the ledger's figures, kept by Inventory (a level's balance, added up to its item).
      expect(await bySku('on_hand')).toEqual({ 'MER-001': 120, 'MER-002': 60, 'MER-003': 4, 'MER-004': 0, 'MER-005': 90, 'MER-006': 35, 'MER-007': 0, 'MER-008': 400, 'MER-009': 0, 'MER-010': 24 });
      // What each cost, as the receipt said: Inventory's own average.
      expect(await bySku('cost_avg')).toMatchObject({ 'MER-001': 310, 'MER-002': 145, 'MER-003': 2900, 'MER-005': 85, 'MER-006': 260, 'MER-008': 18, 'MER-010': 240 });
      expect(n((await w.h.rows(`select sum(value) as v from ${inv('items')}`))[0]!['v'])).toBe(87210);
      // On order: the four orders were sent by saves of their own.
      const coming = await w.h.rows(`select i.sku, sum(p.on_order) as v from ${inv('stock_points')} p join ${inv('items')} i on i.id = p.item_id group by i.sku having sum(p.on_order) > 0 order by i.sku`);
      expect(Object.fromEntries(coming.map((row) => [String(row['sku']), n(row['v'])]))).toEqual({ 'MER-002': 240, 'MER-003': 12, 'MER-004': 6, 'MER-009': 40 });
      expect(await count(inv('purchase_orders'), "status = 'sent'")).toBe(4);
      expect(await count(inv('receipts'), "status = 'posted' and kind = 'opening'")).toBe(1);
      // Seven movements, all opening, each under a receipt of Inventory's own: none typed.
      expect((await w.h.rows(`select kind, count(*) as c from ${inv('movements')} where receipt_id is not null group by kind`)).map((row) => `${String(row['kind'])} ${String(n(row['c']))}`)).toEqual(['opening 7']);
      expect(await count(inv('movements'), 'receipt_id is null')).toBe(0);
    }, 600_000);

    it('the ledger\'s deliveries (screen 60): 129 orders received in one delivery each, the days due copied from them, lateness worked out by the server', async () => {
      expect(await count(inv('purchase_orders'), "status = 'received'")).toBe(129);
      expect(await count(inv('receipts'), "kind = 'delivery' and status = 'posted' and late is not null")).toBe(129);
      // Each delivery's day due is its order's, copied by the server; its lateness the add-on's own formula's.
      const off = await w.h.rows(`select count(*) as c from ${inv('receipts')} r join ${inv('purchase_orders')} o on o.id = r.po_id where r.expected_on is null or r.expected_on <> o.expected_on`);
      expect(n(off[0]!['c'])).toBe(0);
      // By supplier, the late ones and their days: Halvard 1 (2 days), Kirkwall 2 (1, 3), Ostrom 5 (35 days), Trellis 2 (14), Fenlow 8 (168), Marchmont none.
      const by = await w.h.rows(`select s.name, count(*) as c, sum(r.late) as late, sum(r.days_late) as days from ${inv('receipts')} r join ${inv('purchase_orders')} o on o.id = r.po_id join ${inv('suppliers')} s on s.id = o.supplier_id group by s.name order by s.name`);
      expect(Object.fromEntries(by.map((row) => [String(row['name']), [n(row['c']), n(row['late']), n(row['days'])]]))).toEqual({
        'Fenlow Acoustics': [15, 8, 168], 'Halvard Werke': [29, 1, 2], 'Kirkwall Steel': [20, 2, 4], 'Marchmont Joinery': [7, 0, 0], 'Ostrom Seating': [35, 5, 35], 'Trellis Textiles': [23, 2, 14],
      });
      // A past delivery moved no stock: the shelf is the opening receipt's alone, and the four orders on their way still are.
      expect(await count(inv('receipt_lines'))).toBe(7);
      expect(await count(inv('purchase_orders'), "status = 'sent'")).toBe(4);
      expect((await w.h.rows(`select number from ${inv('purchase_orders')} where status = 'sent' order by number`)).map((row) => String(row['number']))).toEqual(['PO-1001', 'PO-1002', 'PO-1003', 'PO-1004']);
    });

    it('the ledger\'s "short today": where open deals ask for more than Inventory holds', async () => {
      const rows = await w.h.rows(
        `select i.name, sum(d.qty) as need, max(i.on_hand) as have from crm_deal_stock_needs d join ${inv('items')} i on i.id = d.item where d.qty is not null group by i.name having sum(d.qty) > max(i.on_hand) order by i.name`,
      );
      expect(rows.map((row) => `${String(row['name'])} need ${String(n(row['need']))}, have ${String(n(row['have']))}, short ${String(n(row['need']) - n(row['have']))}`)).toEqual([
        'Acoustic booths, single need 10, have 4, short 6',
        'Acoustic rooms, four-person need 2, have 0, short 2',
        'Task seating, mesh back need 68, have 60, short 8',
      ]);
      // Every need names an item of Inventory's, and a deal that is open, but one: J-07's won deal, whose return visit takes two cable trays (plan 68 M3 BN-20).
      expect(await count('crm_deal_stock_needs', 'item is null')).toBe(0);
      expect(n((await w.h.rows(`select count(*) as c from crm_deal_stock_needs d join crm_deals x on x.id = d.deal_id where x.state <> 'open'`))[0]!['c'])).toBe(1);
    });

    it('"Remove sample data" takes Inventory\'s part out with the rest, and adding it again brings the same stock', async () => {
      const before = await held();
      expect(before).toMatchObject({ suppliers: 6, places: 1, items: 10, receipts: 130, receipt_lines: 7, purchase_orders: 133, po_lines: 4, movements: 7 });
      const removed = await service().remove(await app(), { keepChanged: true, ...who() });
      expect(removed.kept).toBe(0);
      expect(await held()).toEqual(Object.fromEntries(HELD.map((ref) => [ref, 0])));
      expect([await count('crm_deals'), await count('crm_deal_stock_needs')]).toEqual([0, 0]);
      // Inventory's own starting rows are no sample.
      expect(await count(inv('units'))).toBeGreaterThan(0);
      await service().add(await app(), { locale: 'en-US', ...who() });
      expect(await held()).toEqual(before);
      expect(n((await w.h.rows(`select sum(on_hand) as v from ${inv('items')}`))[0]!['v'])).toBe(733);
    }, 600_000);
  });
}
