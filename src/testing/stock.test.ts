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

  it("hold six suppliers, the depot, ten stock lines, and seventeen needs of the app's own", () => {
    expect(Object.fromEntries(file.tables.map((table) => [table.ref, table.rows.length]))).toEqual({
      suppliers: 6, places: 1, items: 10, item_suppliers: 9, purchase_orders: 49, receipts: 46, receipt_lines: 7, po_lines: 4, deal_stock_needs: 17,
    });
    expect(file.tables.filter((table) => table.own === true).map((table) => table.ref)).toEqual(["deal_stock_needs"]);
    // The app's own table links into Inventory by a column the manifest marks so.
    const needs = doc.requiredSchema.tables.find((table) => table.ref === "deal_stock_needs")!;
    expect(needs.columns.find((column) => column.ref === "item")?.rules?.addOnLink).toEqual({ addOn: "inventory", table: "items" });
  });

  it("type no history for what stocks the shelf: nothing on hand, no cost kept, no state, no number, no receipt", () => {
    // The past deliveries (below) are history by nature; every other row is typed bare, and Inventory's saves do the rest.
    const past = (row: Row): boolean => typeof row["@label"] === "string" && /^inv:(po|receipt):[a-z-]+:\d\d$/.test(row["@label"]);
    const typed = new Set(file.tables.flatMap((table) => table.rows.filter((row) => !past(row)).flatMap((row) => Object.keys(row).map((column) => `${table.ref}.${column}`))));
    // An order's status and time received are Inventory's ledger's: no row of the file types them, a past one neither.
    for (const order of rows("purchase_orders")) expect([order["status"], order["received_at"]], String(order["@label"])).toEqual([undefined, undefined]);
    for (const kept of ["items.cost_avg", "items.on_hand", "items.receipt_id", "purchase_orders.status", "purchase_orders.number", "purchase_orders.received_at", "receipts.status", "receipts.number", "receipt_lines.status"]) {
      expect(typed.has(kept), kept).toBe(false);
    }
    for (const never of ["stock_points", "levels", "movements", "batches", "on_order_moves", "postings", "reservations"]) expect(file.tables.some((table) => table.ref === never), never).toBe(false);
  });

  it("hold the ledger's 39 deliveries of the last 90 days (screen 60), and one older a supplier: each the one delivery of an order, moving no stock", () => {
    const orders = rows("purchase_orders").filter((row) => typeof row["@label"] === "string" && /^inv:po:[a-z-]+:\d\d$/.test(row["@label"]));
    const deliveries = rows("receipts").filter((row) => row["kind"] === "delivery");
    expect([orders.length, deliveries.length]).toEqual([45, 45]);
    // No line: a past delivery says when it came, not what it brought, so the shelf's figures stay the opening receipt's.
    const withLines = new Set(rows("receipt_lines").map((line) => ref(line["receipt_id"])));
    expect(deliveries.filter((row) => withLines.has(String(row["@label"])))).toEqual([]);
    expect(new Set(rows("po_lines").map((line) => ref(line["po_id"])))).toEqual(new Set(["inv:po:s2", "inv:po:s3", "inv:po:s4", "inv:po:s9"]));
    const day = (value: unknown): number => (value as { "@day": number })["@day"];
    const orderOf = new Map(orders.map((row) => [String(row["@label"]), row]));
    const per: Record<string, { n: number; late: number[] }> = {};
    for (const receipt of deliveries) {
      const order = orderOf.get(ref(receipt["po_id"]))!;
      expect(ref(order["supplier_id"]), String(receipt["@label"])).toBe(ref(receipt["supplier_id"]));
      // Posted on a weekday (day 0 is the ledger's Tuesday), on the day it was received.
      const on = day(receipt["received_on"]);
      expect([on, day(receipt["received_at"])]).toEqual([on, on]);
      expect(((((1 + on) % 7) + 7) % 7) < 5, String(receipt["@label"])).toBe(true);
      if (on < -89) continue;
      const one = (per[ref(receipt["supplier_id"]).replace("inv:supplier:", "")] ??= { n: 0, late: [] });
      one.n += 1;
      const late = on - day(order["expected_on"]);
      if (late > 0) one.late.push(late);
    }
    const weeks = (late: number[]) => (late.length === 0 ? 0 : Math.round(late.reduce((a, b) => a + b, 0) / late.length / 7));
    expect(Object.fromEntries(Object.entries(per).map(([slug, one]) => [slug, [one.n, one.late.length, weeks(one.late)]]))).toEqual({
      "halvard-werke": [9, 1, 0], "kirkwall-steel": [6, 1, 0], "ostrom-seating": [5, 1, 1], "trellis-textiles": [9, 1, 1], "fenlow-acoustics": [7, 4, 3], "marchmont-joinery": [3, 0, 0],
    });
    // Each older one outside the 90 days, on time.
    expect(deliveries.filter((row) => day(row["received_on"]) < -89).map((row) => String(row["@label"]).split(":")[3])).toEqual(["00", "00", "00", "00", "00", "00"]);
  });

  it("ask Inventory for the stock, in the order a person would: the receipt opened, its lines posted, the receipt closed, the orders sent", () => {
    expect(file.moves).toEqual([
      { ref: "inv:opening", to: "posting" },
      { table: "receipt_lines", to: "posted" },
      { ref: "inv:opening", to: "posted" },
      // The four orders still to come, by name: the received ones stay received.
      { ref: "inv:po:s2", to: "sent" },
      { ref: "inv:po:s3", to: "sent" },
      { ref: "inv:po:s4", to: "sent" },
      { ref: "inv:po:s9", to: "sent" },
    ]);
  });

  it("every row names a row written before it, in this file or in the app's own sample", () => {
    const known = new Set(mainRows("deals").map((row) => String(row["@label"])));
    // A need that goes on a visit (J-07's return visit, M3 BN-20) names the app's visit.
    for (const row of mainRows("job_visits")) known.add(String(row["@label"]));
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
    // Every need is of an open deal but one: J-07's won deal, whose return visit takes two cable trays (M3 BN-20).
    const open = new Set(mainRows("deals").filter((deal) => deal["state"] === undefined || deal["state"] === "open").map((deal) => String(deal["@label"])));
    expect(rows("deal_stock_needs").filter((need) => !open.has(ref(need["deal_id"]))).map((need) => [ref(need["deal_id"]), ref(need["item"]), need["qty"], ref(need["visit_id"])])).toEqual([["deal:h5", "inv:item:s8", 2, "jobvisit:j5"]]);
    const asked = new Map<string, number>();
    for (const need of rows("deal_stock_needs")) if (need["qty"] !== undefined && open.has(ref(need["deal_id"]))) asked.set(ref(need["item"]), (asked.get(ref(need["item"])) ?? 0) + Number(need["qty"]));
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
