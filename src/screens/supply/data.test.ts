/**
 * Supply's reads: what is asked of the server, and what the screen makes of
 * the answers. The server here is a function answering the sample's rows as
 * Inventory keeps them on the stand (ten lines, four orders sent with no
 * landing day, sixteen needs of open deals).
 */
import { describe, expect, it } from "vitest";

import { StaffError, type Figure, type Grouped, type ListQuery, type Page, type Row, type StaffSession } from "../../staffSession.ts";
import { leadOf, readsOpenDeals, readStock, readSuppliers, shortOf, stateOf, supplierOfLine, type Line } from "./data.ts";
import { scoreOf } from "./score.ts";

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
function fake(reads: { deals: boolean; receipts?: boolean; aftercare?: boolean; first?: string; older?: number; fail?: number }) {
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
  /** The ledger's deliveries by supplier id, as a grouping by `late`: on time, late, and the late ones' average days late. */
  const LATE: Record<string, [number, number, number | null]> = { "6": [6, 0, null], "5": [6, 8, 21], "3": [29, 5, 7], "1": [27, 1, 2] };
  const CLAIMS: Record<string, number> = { "3": 2, "5": 1 };
  const session = {
    can: (ref: string) => (ref === "deals" ? reads.deals : ref === "inventory:receipts" ? reads.receipts !== false : true),
    part: (id: string) => id !== "aftercare" || reads.aftercare !== false,
    list: async (ref: string, q: ListQuery = {}): Promise<Page> => {
      lists.push({ ref, q });
      const all = rows[ref] ?? [];
      return { rows: all, total: all.length, next: null };
    },
    figure: async (figure: Figure) => {
      figures.push(figure);
      const where = JSON.stringify(figure.filters ?? []);
      if (figure.table === "inventory:receipts" && reads.fail !== undefined) throw new StaffError(reads.fail, "X", "refused");
      if (figure.table === "inventory:receipts" && figure.shape === "categorical") {
        const by = (figure.filters ?? []).find((one) => "column" in one && one.column === "po_id.supplier_id") as { value: number } | undefined;
        const [on, late, d] = by === undefined ? [105, 18, 10] : (LATE[String(by.value)] ?? [0, 0, null]);
        return grouped([...(on > 0 ? [["0", { n: on, d: 0 }] as [string, Record<string, number | null>]] : []), ...(late > 0 ? [["1", { n: late, d }] as [string, Record<string, number | null>]] : [])]);
      }
      if (figure.table === "inventory:receipts") return figure.aggregations?.[0]?.fn === "min" ? { value: reads.first ?? "2026-02-09" } : { value: reads.older ?? 6 };
      if (figure.table === "warranty_claims") {
        const named = (figure.filters ?? []).find((one) => "or" in one) as { or: { value: unknown }[] } | undefined;
        return { value: named === undefined ? 5 : (CLAIMS[String(named.or[0]!.value)] ?? 0) };
      }
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

  it("asks the server each supplier's deliveries of the last 90 days by its orders, and its claims of the year: the ledger's scores", async () => {
    const { session, figures } = fake({ deals: true });
    const data = await readSuppliers(session);
    const lateness = data.lateness!;
    expect(lateness.all).toEqual({ n: 123, late: 18 });
    // Older deliveries than the window: the figures are of the last 90 days, not "since".
    expect(lateness.from).toBeNull();
    expect(lateness.claims).toBe(5);
    expect(lateness.by).toEqual({
      "6": { n: 6, late: 0, avgLate: null, claims: 0 },
      "5": { n: 14, late: 8, avgLate: 21, claims: 1 },
      "3": { n: 34, late: 5, avgLate: 7, claims: 2 },
      "1": { n: 28, late: 1, avgLate: 2, claims: 0 },
    });
    expect(Object.fromEntries(Object.entries(lateness.by).map(([id, one]) => [id, scoreOf(one)]))).toEqual({
      "6": { onTenths: 1000, weeksOver: 0, score: 100, band: "solid" },
      "5": { onTenths: 429, weeksOver: 3, score: 16, band: "problem" },
      "3": { onTenths: 853, weeksOver: 1, score: 66, band: "problem" },
      "1": { onTenths: 964, weeksOver: 0, score: 96, band: "solid" },
    });
    // A delivery counts when posted, when it says whether it was late, inside the business's last 90 days; its supplier is its order's.
    const SAYS = [{ column: "status", op: "eq", value: "posted" }, { column: "late", op: "not_null" }];
    const perSupplier = figures.filter((figure) => figure.table === "inventory:receipts" && figure.shape === "categorical");
    expect(perSupplier).toHaveLength(5);
    expect(perSupplier[1]).toEqual({ table: "inventory:receipts", shape: "categorical", filters: [...SAYS, { column: "received_on", op: "gte", day: "today-89" }, { column: "po_id.supplier_id", op: "eq", value: 6 }], groupBy: ["late"], aggregations: [{ fn: "count", alias: "n" }, { fn: "avg", column: "days_late", alias: "d" }], limit: 5 });
    expect(figures.find((figure) => figure.table === "inventory:receipts" && figure.shape === "single-metric" && figure.aggregations?.[0]?.fn === "count")?.filters).toEqual([...SAYS, { column: "received_on", op: "lt", day: "today-89" }]);
    // A claim names its supplier by Inventory's row or by the name typed on it; the year is the business's.
    const claims = figures.filter((figure) => figure.table === "warranty_claims");
    expect(claims).toHaveLength(5);
    expect(claims[2]!.filters).toEqual([{ column: "raised_on", op: "gte", day: "today-364" }, { or: [{ column: "supplier", op: "eq", value: 5 }, { column: "supplier_name", op: "eq", value: "Fenlow Acoustics" }] }]);
  });

  it("says since when, on an install that kept lateness only from its update", async () => {
    const { session } = fake({ deals: true, older: 0, first: "2026-06-15" });
    expect((await readSuppliers(session)).lateness?.from).toBe("2026-06-15");
  });

  it("asks no claim while After the job is off: the score counts none", async () => {
    const { session, figures } = fake({ deals: true, aftercare: false });
    const lateness = (await readSuppliers(session)).lateness!;
    expect(figures.some((figure) => figure.table === "warranty_claims")).toBe(false);
    expect(lateness.claims).toBeNull();
    expect(scoreOf(lateness.by["3"]!)).toEqual({ onTenths: 853, weeksOver: 1, score: 78, band: "watch" });
  });

  it("scores nobody where the reader reads no receipt, or the install's Inventory keeps no lateness; any other refusal is the screen's", async () => {
    const none = fake({ deals: true, receipts: false });
    expect((await readSuppliers(none.session)).lateness).toBeNull();
    expect(none.figures.some((figure) => figure.table === "inventory:receipts")).toBe(false);
    expect((await readSuppliers(fake({ deals: true, fail: 400 }).session)).lateness).toBeNull();
    await expect(readSuppliers(fake({ deals: true, fail: 429 }).session)).rejects.toThrow("refused");
  });
});

describe("who is answered open deals on Stock", () => {
  const reader = (slugs: string[], deals: boolean): StaffSession => ({ can: (table: string) => table !== "deals" || deals, config: { access: { tables: {}, roles: slugs.map((slug) => ({ slug, name: slug })) } } }) as unknown as StaffSession;
  it("the CRM admin, Read-only and the install's owner are; the operations manager is not, though from stage 2 she reads a won deal", () => {
    expect(readsOpenDeals(reader(["crm-admin"], true))).toBe(true);
    expect(readsOpenDeals(reader(["crm-read-only"], true))).toBe(true);
    expect(readsOpenDeals(reader([], true))).toBe(true);
    expect(readsOpenDeals(reader(["crm-ops-manager"], true))).toBe(false);
    expect(readsOpenDeals(reader(["crm-ops-manager"], false))).toBe(false);
    expect(readsOpenDeals(reader(["crm-admin"], false))).toBe(false);
  });
});
