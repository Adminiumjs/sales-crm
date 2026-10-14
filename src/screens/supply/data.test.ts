/**
 * Supply's reads: what is asked of the server, and what the screen makes of
 * the answers. The server here is a function answering the sample's rows as
 * Inventory keeps them on the stand (ten lines, four orders sent with no
 * landing day, sixteen needs of open deals).
 */
import { describe, expect, it } from "vitest";

import type { Figure, Grouped, ListQuery, Page, Row, StaffSession } from "../../staffSession.ts";
import { leadOf, readStock, readSuppliers, shortOf, stateOf, supplierOfLine, type Line } from "./data.ts";

const LINES: Line[] = [
  { id: 1, name: "Bench desk runs", sku: "MER-001", note: "desks", on_hand: 120 },
  { id: 2, name: "Task seating, mesh back", sku: "MER-002", note: "chairs", on_hand: 60 },
  { id: 3, name: "Acoustic booths, single", sku: "MER-003", note: "booths", on_hand: 4 },
  { id: 4, name: "Acoustic rooms, four-person", sku: "MER-004", note: "rooms", on_hand: 0 },
  { id: 7, name: "Showroom fittings", sku: "MER-007", note: "made to order", on_hand: "0" },
];
const ASKED = { "1": 46, "2": 68, "3": 10, "4": 2, "5": 90, "6": 8 };

describe("a stock line", () => {
  it("is empty with nothing on the shelf, low where Inventory says so, else in stock", () => {
    expect(LINES.map((line) => stateOf(line, line.id === 2))).toEqual(["inStock", "low", "inStock", "empty", "empty"]);
  });

  it("says its lead time in weeks when it is whole weeks, else in days, and nothing when none is set", () => {
    expect([leadOf(14), leadOf(49), leadOf(10), leadOf(null), leadOf(0)]).toEqual([{ weeks: 2 }, { weeks: 7 }, { days: 10 }, null, null]);
  });

  it("is short where open deals ask for more than is on the shelf: the ledger's three", () => {
    expect(shortOf(LINES, ASKED).map((one) => `${one.line.name} need ${String(one.need)}, have ${String(one.have)}, short ${String(one.short)}`)).toEqual([
      "Acoustic booths, single need 10, have 4, short 6",
      "Acoustic rooms, four-person need 2, have 0, short 2",
      "Task seating, mesh back need 68, have 60, short 8",
    ]);
  });

  it("is supplied by its first-choice supplier", () => {
    expect(supplierOfLine([{ item_id: 1, supplier_id: 4, rank: "other" }, { item_id: 1, supplier_id: 2, rank: "preferred" }, { item_id: 3, supplier_id: 5, rank: "other" }])).toEqual({ "1": 2, "3": 5 });
  });
});

/** A session over fixed answers, remembering each list and figure it was asked. */
function fake(reads: { deals: boolean }) {
  const lists: { ref: string; q: ListQuery }[] = [];
  const figures: Figure[] = [];
  const grouped = (items: [string, Record<string, number | null>][]): Grouped => ({ shape: "categorical", items: items.map(([key, values]) => ({ key, label: key, value: Number(Object.values(values)[0] ?? 0), values })), total: 0 });
  const rows: Record<string, Row[]> = {
    "inventory:items": LINES,
    "inventory:suppliers": [
      { id: 6, name: "Marchmont Joinery", lead_days: 49, active: true },
      { id: 5, name: "Fenlow Acoustics", lead_days: 42, active: true },
      { id: 3, name: "Ostrom Seating", lead_days: 21, active: true },
      { id: 1, name: "Halvard Werke", lead_days: 14, active: true },
    ],
    "inventory:item_suppliers": [
      { id: 1, item_id: 1, supplier_id: 1, rank: "preferred", item: "Bench desk runs" },
      { id: 2, item_id: 2, supplier_id: 3, rank: "preferred", item: "Task seating, mesh back" },
      { id: 3, item_id: 3, supplier_id: 5, rank: "preferred", item: "Acoustic booths, single" },
      { id: 4, item_id: 4, supplier_id: 5, rank: "preferred", item: "Acoustic rooms, four-person" },
    ],
    "inventory:po_lines": [
      { id: 1, item_id: 2, open_qty: 240, expected: null },
      { id: 2, item_id: 3, open_qty: 12, expected: "2026-09-08" },
      { id: 5, item_id: 3, open_qty: 6, expected: "2026-08-20" },
      { id: 3, item_id: 4, open_qty: 6, expected: null },
    ],
    "inventory:purchase_orders": [
      { id: 1, number: "PO-1001", supplier_id: 3, status: "sent", expected_on: null },
      { id: 2, number: "PO-1002", supplier_id: 5, status: "sent", expected_on: "2026-09-08" },
      { id: 3, number: "PO-1003", supplier_id: 5, status: "sent", expected_on: "2026-08-20" },
    ],
    deal_stock_needs: [
      { id: 1, deal_id: 1, item: 1, deal: "Fourth-floor desk rows", amount: 52800 },
      { id: 5, deal_id: 2, item: 3, deal: "Pods", amount: 30000 },
      { id: 7, deal_id: 2, item: 4, deal: "Pods", amount: 30000 },
      { id: 11, deal_id: 5, item: 7, deal: "Showroom", amount: 38000 },
    ],
  };
  const session = {
    can: (ref: string) => ref !== "deals" || reads.deals,
    list: async (ref: string, q: ListQuery = {}): Promise<Page> => {
      lists.push({ ref, q });
      const all = rows[ref] ?? [];
      return { rows: all, total: all.length, next: null };
    },
    figure: async (figure: Figure) => {
      figures.push(figure);
      const where = JSON.stringify(figure.filters ?? []);
      if (figure.shape === "single-metric") {
        if (figure.table === "inventory:items") return { value: where.includes('"gt"') ? 7 : where.includes('"lte"') ? 3 : 10 };
        if (figure.table === "deal_stock_needs") return { value: 3 };
        if (figure.table === "inventory:purchase_orders") return { value: where.includes('"value":"received"') ? 0 : 4 };
        if (figure.table === "inventory:suppliers") return { value: 6 };
        return { value: 0 };
      }
      if (figure.table === "inventory:stock_points") return figure.aggregations?.[0]?.alias === "o" ? grouped([["2", { o: 240 }], ["3", { o: 12 }], ["4", { o: 6 }]]) : grouped([]);
      if (figure.table === "deal_stock_needs") return grouped([...Object.entries(ASKED).map(([key, q]): [string, Record<string, number | null>] => [key, { q, n: 1 }]), ["7", { q: null, n: 1 }]]);
      if (figure.table === "deals") return grouped([["open", { n: 2, a: 68000 }]]);
      if (figure.table === "inventory:purchase_orders") return grouped(where.includes('"value":"received"') ? [] : [["3", { n: 1 }], ["5", { n: 2 }]]);
      return grouped([]);
    },
  } as unknown as StaffSession;
  return { session, lists, figures };
}

describe("the Stock screen's read", () => {
  it("asks the server every count and sum, and only picks rows itself", async () => {
    const { session, figures, lists } = fake({ deals: true });
    const data = await readStock(session);
    expect(data.counts).toEqual({ all: 10, inStock: 7, empty: 3, low: 0 });
    expect(data.cut).toBe(false);
    expect(data.onOrder).toEqual({ "2": 240, "3": 12, "4": 6 });
    // A need with no number counts on its line and in no "how many".
    expect(data.asked["7"]).toBeUndefined();
    expect(data.askedOn["7"]).toBe(1);
    // The order line due soonest; one with no day comes after any that has one.
    expect(data.landing).toEqual({ "2": { qty: 240, expected: null }, "3": { qty: 6, expected: "2026-08-20" }, "4": { qty: 6, expected: null } });
    expect(data.longest?.name).toBe("Marchmont Joinery");
    expect(data.dealsOn?.["3"]).toEqual([{ id: 2, name: "Pods", amount: 30000 }]);
    // The open deals on an empty line are counted and summed by the server: d2 on the rooms, d5 on the fittings, each once.
    const risk = figures.find((figure) => figure.table === "deals")!;
    expect(risk.filters).toEqual([{ column: "state", op: "eq", value: "open" }, { column: "id", op: "in", value: [2, 5] }]);
    expect(data.risk).toEqual({ deals: 2, amount: 68000 });
    // What open deals ask for is held to open deals by the server, not by the screen.
    expect(figures.filter((figure) => figure.table === "deal_stock_needs").map((figure) => figure.filters)).toEqual([[{ column: "deal_state", op: "eq", value: "open" }]]);
    expect(lists.find((one) => one.ref === "deal_stock_needs")?.q.lookup).toEqual(["deal:deal_id.name", "amount:deal_id.amount"]);
  });

  it("asks a reader of no deal no deal: how many needs wait on an empty line, from the server", async () => {
    const { session, figures, lists } = fake({ deals: false });
    const data = await readStock(session);
    expect(data.dealsOn).toBeNull();
    expect(data.risk).toEqual({ needs: 3 });
    expect(figures.some((figure) => figure.table === "deals")).toBe(false);
    expect(lists.find((one) => one.ref === "deal_stock_needs")?.q.lookup).toBeUndefined();
    const needs = figures.filter((figure) => figure.table === "deal_stock_needs" && figure.shape === "single-metric");
    expect(needs.map((figure) => figure.filters)).toEqual([[{ column: "deal_state", op: "eq", value: "open" }, { column: "item", op: "in", value: [4, 7] }]]);
  });
});

describe("the Supplier scorecard's read", () => {
  it("counts orders on their way and received by the server, and names each supplier's lines and its soonest order", async () => {
    const { session } = fake({ deals: true });
    const data = await readSuppliers(session);
    expect(data.counts).toEqual({ inUse: 6, coming: 4, received: 0 });
    expect(data.coming).toEqual({ "3": 1, "5": 2 });
    expect(data.received).toEqual({});
    expect(data.supplies["5"]).toEqual(["Acoustic booths, single", "Acoustic rooms, four-person"]);
    expect(data.next).toEqual({ "3": { number: "PO-1001", expected: null }, "5": { number: "PO-1003", expected: "2026-08-20" } });
    expect(data.longest?.name).toBe("Marchmont Joinery");
    expect(data.suppliers.map((supplier) => supplier.name)).toEqual(["Fenlow Acoustics", "Halvard Werke", "Marchmont Joinery", "Ostrom Seating"]);
  });
});
