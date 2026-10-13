/**
 * The sample's goods: the app's rows for Inventory
 * (`sampleData.addOns.inventory`, `seeds/meridian.inventory.json`).
 *
 * Meridian's ten stock lines, its six suppliers and its depot are rows of
 * Inventory's tables with no history typed: nothing on hand, no cost kept,
 * no order sent. The file then asks Inventory for the rest with `moves` (an
 * opening receipt posted, four orders sent), so every figure a screen shows
 * is Inventory's own. Which open deal waits for which line is the app's own
 * table, in the same file.
 *
 * Here the file is read as data: it is the one the manifest names, it types
 * nothing that Inventory keeps, and the ledger's stock figures follow from
 * its rows. That Inventory really stocks it is proved against the add-on as
 * it is built, on three engines, in the engine's repo.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";
import main from "../../whole/seeds/meridian.json";
import section from "../../whole/seeds/meridian.inventory.json";

type Row = Record<string, unknown>;
const file = section as unknown as { format: string; app: string; addOn: string; tables: { ref: string; own?: true; rows: Row[] }[]; moves: { ref?: string; table?: string; to: string }[] };
const rows = (ref: string): Row[] => file.tables.find((table) => table.ref === ref)?.rows ?? [];
const ref = (value: unknown): string => (value as { "@ref": string })["@ref"];
const mainRows = (table: string): Row[] => (main as unknown as { tables: { ref: string; rows: Row[] }[] }).tables.find((one) => one.ref === table)?.rows ?? [];
const doc = manifest as unknown as {
  sampleData: { addOns?: Record<string, { file: string }> };
  addOns: { suggests: { key: string }[] };
  requiredSchema: { tables: { ref: string; columns: { ref: string; rules?: { addOnLink?: { addOn: string; table: string } } }[] }[] };
};

describe("the app's rows for Inventory", () => {
  it("are the file the manifest names, for an add-on the app suggests", () => {
    expect(doc.sampleData.addOns).toEqual({ inventory: { file: "seeds/meridian.inventory.json" } });
    expect(doc.addOns.suggests.map((one) => one.key)).toContain("inventory");
    expect([file.format, file.app, file.addOn]).toEqual(["adminium.sample/1", "crm", "inventory"]);
  });

  it("hold six suppliers, the depot, ten stock lines, and sixteen needs of the app's own", () => {
    expect(Object.fromEntries(file.tables.map((table) => [table.ref, table.rows.length]))).toEqual({
      suppliers: 6, places: 1, items: 10, item_suppliers: 9, receipts: 1, receipt_lines: 7, purchase_orders: 4, po_lines: 4, deal_stock_needs: 16,
    });
    expect(file.tables.filter((table) => table.own === true).map((table) => table.ref)).toEqual(["deal_stock_needs"]);
    // The app's own table links into Inventory by a column the manifest marks so.
    const needs = doc.requiredSchema.tables.find((table) => table.ref === "deal_stock_needs")!;
    expect(needs.columns.find((column) => column.ref === "item")?.rules?.addOnLink).toEqual({ addOn: "inventory", table: "items" });
  });

  it("type no history: nothing on hand, no cost kept, no state, no number, no receipt", () => {
    const typed = new Set(file.tables.flatMap((table) => table.rows.flatMap((row) => Object.keys(row).map((column) => `${table.ref}.${column}`))));
    for (const kept of ["items.cost_avg", "items.on_hand", "items.receipt_id", "purchase_orders.status", "purchase_orders.number", "purchase_orders.received_at", "receipts.status", "receipts.number", "receipt_lines.status"]) {
      expect(typed.has(kept), kept).toBe(false);
    }
    for (const never of ["stock_points", "levels", "movements", "batches", "on_order_moves", "postings", "reservations"]) expect(file.tables.some((table) => table.ref === never), never).toBe(false);
  });

  it("ask Inventory for the stock, in the order a person would: the receipt opened, its lines posted, the receipt closed, the orders sent", () => {
    expect(file.moves).toEqual([
      { ref: "inv:opening", to: "posting" },
      { table: "receipt_lines", to: "posted" },
      { ref: "inv:opening", to: "posted" },
      { table: "purchase_orders", to: "sent" },
    ]);
  });

  it("every row names a row written before it, in this file or in the app's own sample", () => {
    const known = new Set(mainRows("deals").map((row) => String(row["@label"])));
    // Inventory's own starting row: its unit "each".
    known.add("unit:each");
    const missing: string[] = [];
    for (const table of file.tables) {
      for (const row of table.rows) {
        for (const [column, value] of Object.entries(row)) {
          if (column !== "@label" && typeof value === "object" && value !== null && "@ref" in value && !known.has(ref(value))) missing.push(`${table.ref}.${column} → ${ref(value)}`);
        }
        if (typeof row["@label"] === "string") known.add(row["@label"]);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the ledger's stock figures follow from the rows: what is on hand, what is on order, and where open deals ask for more than there is", () => {
    const name = new Map(rows("items").map((item) => [String(item["@label"]), String(item["name"])]));
    const have = new Map(rows("receipt_lines").map((line) => [ref(line["item_id"]), Number(line["qty_typed"])]));
    const coming = new Map(rows("po_lines").map((line) => [ref(line["item_id"]), Number(line["packs"]) * Number(line["pack_size"])]));
    expect([...have.values()].reduce((sum, n) => sum + n, 0)).toBe(120 + 60 + 4 + 90 + 35 + 400 + 24);
    expect(Object.fromEntries([...coming].map(([item, n]) => [name.get(item), n]))).toEqual({ "Task seating, mesh back": 240, "Acoustic booths, single": 12, "Acoustic rooms, four-person": 6, "Lab bench stools": 40 });
    // Every need is of an open deal.
    const open = new Set(mainRows("deals").filter((deal) => deal["state"] === undefined || deal["state"] === "open").map((deal) => String(deal["@label"])));
    expect(rows("deal_stock_needs").filter((need) => !open.has(ref(need["deal_id"])))).toEqual([]);
    const asked = new Map<string, number>();
    for (const need of rows("deal_stock_needs")) if (need["qty"] !== undefined) asked.set(ref(need["item"]), (asked.get(ref(need["item"])) ?? 0) + Number(need["qty"]));
    const short = [...asked].filter(([item, need]) => need > (have.get(item) ?? 0)).map(([item, need]) => `${name.get(item)!} need ${String(need)}, have ${String(have.get(item) ?? 0)}, short ${String(need - (have.get(item) ?? 0))}`);
    expect(short).toEqual(["Task seating, mesh back need 68, have 60, short 8", "Acoustic booths, single need 10, have 4, short 6", "Acoustic rooms, four-person need 2, have 0, short 2"]);
  });

  it("each line that is bought has one supplier, and each order is to the supplier of its line", () => {
    const supplierOf = new Map(rows("item_suppliers").map((row) => [ref(row["item_id"]), ref(row["supplier_id"])]));
    expect(supplierOf.size).toBe(9);
    const orderSupplier = new Map(rows("purchase_orders").map((order) => [String(order["@label"]), ref(order["supplier_id"])]));
    for (const line of rows("po_lines")) expect(orderSupplier.get(ref(line["po_id"])), ref(line["item_id"])).toBe(supplierOf.get(ref(line["item_id"])));
  });
});
