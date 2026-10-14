/**
 * SUPPLY (P16): what the two screens read, and from where.
 *
 * Stock is the Inventory add-on's, not the app's. Its tables are read as the
 * signed-in person through the grants the CRM gives its CRM admin, its
 * operations manager and Read-only (`roles[].tables` in the manifest): six
 * tables, read only, a few columns each, nothing of what goods cost. The one
 * table of the app's own is `deal_stock_needs`: which open deal asks for which
 * line, and how many where the deal says.
 *
 * WHO ADDS UP. Every count and sum here is the server's: lines in stock and
 * with nothing on the shelf (items by `on_hand`, a total Inventory keeps), what
 * is on order (stock points' `on_order`, summed by line), what open deals ask
 * for (needs summed by line), and the open deals that lean on an empty line
 * with their amount. The screen only picks rows (a line's first open order,
 * its first-choice supplier) and compares two figures of one line. "Short" is
 * need minus have: one subtraction of two server figures, as the ledger prints.
 *
 * WHAT INVENTORY DOES NOT KEEP, and so is not drawn: a lead time per line (a
 * supplier promises one for everything it supplies), whether an order came on
 * the day it was due, and a score for a supplier.
 */
import type { Condition, Grouped, Row, StaffSession } from "../../staffSession.ts";

/** Inventory's tables, as the session names an add-on's. */
export const INV = {
  items: "inventory:items",
  suppliers: "inventory:suppliers",
  itemSuppliers: "inventory:item_suppliers",
  points: "inventory:stock_points",
  orders: "inventory:purchase_orders",
  orderLines: "inventory:po_lines",
} as const;

/** The tables whose changes a Supply screen reads again on. */
export const SUPPLY_TABLES = ["deal_stock_needs", INV.items, INV.points, INV.orderLines, INV.orders, INV.suppliers, INV.itemSuppliers] as const;

/** An order still to come in all or in part. */
export const OPEN_ORDER = ["sent", "part_received"] as const;
const LIMIT = 200;

export const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export interface Line extends Row {
  id: number;
  name: string;
  sku: string | null;
  note: string | null;
  on_hand: number | string | null;
}
export interface Supplier extends Row {
  id: number;
  name: string;
  lead_days: number | null;
  active: boolean | number;
}
interface Offer extends Row {
  item_id: number;
  supplier_id: number;
  rank: string | null;
  item?: string | null;
}
interface OrderLine extends Row {
  id: number;
  item_id: number;
  open_qty: number | string | null;
  expected?: string | null;
}
interface Order extends Row {
  id: number;
  number: string | null;
  supplier_id: number;
  status: string;
  expected_on: string | null;
}
export interface NeedDeal {
  id: number;
  name: string;
  amount: number;
}
interface Need extends Row {
  id: number;
  deal_id: number;
  item: number | null;
  deal?: string | null;
  amount?: number | string | null;
}

export type LineState = "inStock" | "low" | "empty";
export const LINE_STATES: readonly LineState[] = ["inStock", "low", "empty"];

/** Where a line stands: nothing on the shelf, under the level Inventory was told, or in stock. Read from Inventory's own figures for the line. */
export function stateOf(line: Pick<Line, "on_hand">, low: boolean): LineState {
  if (num(line.on_hand) <= 0) return "empty";
  return low ? "low" : "inStock";
}

/** A lead time in whole weeks when it is whole weeks (the design's way), else in days. Null when none is set. */
export function leadOf(days: number | null | undefined): { weeks: number } | { days: number } | null {
  if (days === null || days === undefined || !Number.isFinite(days) || days <= 0) return null;
  return days % 7 === 0 ? { weeks: days / 7 } : { days };
}

/** What open deals ask for against what is on the shelf, line by line, where they ask for more. Both figures are the server's. */
export function shortOf(lines: readonly Line[], asked: Record<string, number>): { line: Line; need: number; have: number; short: number }[] {
  const out: { line: Line; need: number; have: number; short: number }[] = [];
  for (const line of lines) {
    const need = asked[String(line.id)];
    if (need === undefined) continue;
    const have = Math.max(0, num(line.on_hand));
    if (need > have) out.push({ line, need, have, short: need - have });
  }
  return out.sort((a, b) => a.line.name.localeCompare(b.line.name));
}

/** A grouped figure as `key → value`, one aggregation by its alias. */
export function byKey(answer: Grouped, alias: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of answer.items) if (item.key !== null) out[String(item.key)] = num(item.values?.[alias] ?? item.value);
  return out;
}

const count = async (session: StaffSession, table: string, filters: Condition[]): Promise<number> =>
  num((await session.figure<{ value: number }>({ table, shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] })).value);

/** Each supplier's first-choice offer for each line, the "preferred" one before any other: the line's supplier. */
export function supplierOfLine(offers: readonly Offer[]): Record<string, number> {
  const out: Record<string, number> = {};
  const ranked = [...offers].sort((a, b) => (a.rank === "preferred" ? 0 : 1) - (b.rank === "preferred" ? 0 : 1) || a.supplier_id - b.supplier_id);
  for (const offer of ranked) if (out[String(offer.item_id)] === undefined) out[String(offer.item_id)] = offer.supplier_id;
  return out;
}

export interface StockData {
  lines: Line[];
  /** More active lines than one read holds: the list is cut; the counts are of all of them. */
  cut: boolean;
  counts: { all: number; inStock: number; empty: number; low: number };
  /** Stock points with a reorder level: none means Inventory was never told when a line runs low. */
  levelsSet: number;
  low: Set<number>;
  onOrder: Record<string, number>;
  /** A line's first open order line, the one due soonest: its quantity still to come and its landing day (null when the order has none). */
  landing: Record<string, { qty: number; expected: string | null }>;
  suppliers: Record<string, Supplier>;
  supplierOf: Record<string, number>;
  /** What open deals ask for, by line, where they say how many; and on how many open deals each line is asked for. */
  asked: Record<string, number>;
  askedOn: Record<string, number>;
  /** The open deals that ask for each line, for a reader who reads deals. */
  dealsOn: Record<string, NeedDeal[]> | null;
  /** Open deals that lean on a line with nothing on the shelf, and their amount; or, for a reader of no deal, how many of their needs do. */
  risk: { deals: number; amount: number } | { needs: number };
  longest: Supplier | null;
}

/** Everything the Stock screen shows, as the person reads it. */
export async function readStock(session: StaffSession): Promise<StockData> {
  const readsDeals = session.can("deals", "read");
  const ACTIVE: Condition = { column: "active", op: "eq", value: true };
  const openNeed: Condition = { column: "deal_state", op: "eq", value: "open" };
  const [lines, suppliers, offers, orderLines, all, inStock, empty, lowAnswer, levelsSet, onOrder, askedAnswer, needs] = await Promise.all([
    session.list<Line>(INV.items, { select: ["id", "name", "sku", "note", "on_hand"], where: ACTIVE, order: ["name", "id"], limit: LIMIT, count: "exact" }),
    session.list<Supplier>(INV.suppliers, { select: ["id", "name", "lead_days", "active"], order: ["lead_days.desc", "name"], limit: LIMIT }),
    session.list<Offer>(INV.itemSuppliers, { select: ["id", "item_id", "supplier_id", "rank"], limit: LIMIT }),
    session.list<OrderLine>(INV.orderLines, { select: ["id", "item_id", "open_qty"], where: { and: [{ column: "order_status", op: "in", value: [...OPEN_ORDER] }, { column: "open_qty", op: "gt", value: 0 }] }, lookup: ["expected:po_id.expected_on"], order: ["id"], limit: LIMIT }),
    count(session, INV.items, [ACTIVE]),
    count(session, INV.items, [ACTIVE, { column: "on_hand", op: "gt", value: 0 }]),
    count(session, INV.items, [ACTIVE, { column: "on_hand", op: "lte", value: 0 }]),
    session.figure<Grouped>({ table: INV.points, shape: "categorical", filters: [{ column: "low", op: "eq", value: 1 }, { column: "item_active", op: "eq", value: true }, { column: "on_hand", op: "gt", value: 0 }], groupBy: ["item_id"], aggregations: [{ fn: "count", alias: "n" }], limit: LIMIT }),
    count(session, INV.points, [{ column: "reorder_level", op: "not_null" }]),
    session.figure<Grouped>({ table: INV.points, shape: "categorical", filters: [{ column: "on_order", op: "gt", value: 0 }], groupBy: ["item_id"], aggregations: [{ fn: "sum", column: "on_order", alias: "o" }], limit: LIMIT }),
    session.figure<Grouped>({ table: "deal_stock_needs", shape: "categorical", filters: [openNeed], groupBy: ["item"], aggregations: [{ fn: "sum", column: "qty", alias: "q" }, { fn: "count", alias: "n" }], limit: LIMIT }),
    session.list<Need>("deal_stock_needs", { select: ["id", "deal_id", "item"], where: openNeed, ...(readsDeals ? { lookup: ["deal:deal_id.name", "amount:deal_id.amount"] } : {}), order: ["deal_id", "id"], limit: LIMIT }),
  ]);
  const low = new Set(Object.keys(byKey(lowAnswer, "n")).map(Number));
  const landing: StockData["landing"] = {};
  // The order lines of open orders, the one due soonest first; a line with no day comes after any that has one.
  const due = [...orderLines.rows].sort((a, b) => (a.expected ?? "9999").localeCompare(b.expected ?? "9999") || a.id - b.id);
  for (const row of due) if (landing[String(row.item_id)] === undefined) landing[String(row.item_id)] = { qty: num(row.open_qty), expected: row.expected ?? null };
  // A need that names no number asks for some, not for none: it counts on its line, and in no "how many".
  const asked: Record<string, number> = {};
  const askedOn: Record<string, number> = {};
  for (const item of askedAnswer.items) {
    if (item.key === null) continue;
    askedOn[String(item.key)] = num(item.values?.["n"]);
    if (item.values?.["q"] !== null && item.values?.["q"] !== undefined) asked[String(item.key)] = num(item.values["q"]);
  }
  const emptyIds = lines.rows.filter((line) => num(line.on_hand) <= 0).map((line) => line.id);
  let dealsOn: StockData["dealsOn"] = null;
  let risk: StockData["risk"];
  if (readsDeals) {
    dealsOn = {};
    for (const need of needs.rows) {
      if (need.item === null) continue;
      const on = (dealsOn[String(need.item)] ??= []);
      if (!on.some((deal) => deal.id === need.deal_id)) on.push({ id: need.deal_id, name: need.deal ?? "", amount: num(need.amount) });
    }
    const leaning = [...new Set(needs.rows.filter((need) => need.item !== null && emptyIds.includes(need.item)).map((need) => need.deal_id))];
    if (leaning.length === 0) risk = { deals: 0, amount: 0 };
    else {
      const answer = await session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }, { column: "id", op: "in", value: leaning }], groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "a" }], limit: 5 });
      risk = { deals: byKey(answer, "n")["open"] ?? 0, amount: byKey(answer, "a")["open"] ?? 0 };
    }
  } else {
    risk = { needs: emptyIds.length === 0 ? 0 : await count(session, "deal_stock_needs", [openNeed, { column: "item", op: "in", value: emptyIds }]) };
  }
  const byId: Record<string, Supplier> = Object.fromEntries(suppliers.rows.map((supplier) => [String(supplier.id), supplier]));
  return {
    lines: lines.rows,
    cut: (lines.total ?? lines.rows.length) > lines.rows.length,
    counts: { all, inStock, empty, low: low.size },
    levelsSet,
    low,
    onOrder: byKey(onOrder, "o"),
    landing,
    suppliers: byId,
    supplierOf: supplierOfLine(offers.rows),
    asked,
    askedOn,
    dealsOn,
    risk,
    // The suppliers came longest lead first: the first in use with a lead time is the longest.
    longest: suppliers.rows.find((supplier) => supplier.lead_days !== null && Boolean(supplier.active)) ?? null,
  };
}

export interface SuppliersData {
  suppliers: Supplier[];
  cut: boolean;
  /** The lines each supplier supplies, by name. */
  supplies: Record<string, string[]>;
  counts: { inUse: number; coming: number; received: number };
  coming: Record<string, number>;
  received: Record<string, number>;
  /** A supplier's open order due soonest: its landing day, or null when it has none. */
  next: Record<string, { number: string | null; expected: string | null }>;
  longest: Supplier | null;
}

/** Everything the Supplier scorecard shows, as the person reads it. */
export async function readSuppliers(session: StaffSession): Promise<SuppliersData> {
  const OPEN: Condition = { column: "status", op: "in", value: [...OPEN_ORDER] };
  const RECEIVED: Condition = { column: "status", op: "eq", value: "received" };
  const [suppliers, offers, open, inUse, coming, received, comingBy, receivedBy] = await Promise.all([
    session.list<Supplier>(INV.suppliers, { select: ["id", "name", "lead_days", "active"], order: ["name", "id"], limit: LIMIT, count: "exact" }),
    session.list<Offer>(INV.itemSuppliers, { select: ["id", "item_id", "supplier_id", "rank"], lookup: ["item:item_id.name"], order: ["id"], limit: LIMIT }),
    session.list<Order>(INV.orders, { select: ["id", "number", "supplier_id", "status", "expected_on"], where: OPEN, order: ["id"], limit: LIMIT }),
    count(session, INV.suppliers, [{ column: "active", op: "eq", value: true }]),
    count(session, INV.orders, [OPEN]),
    count(session, INV.orders, [RECEIVED]),
    session.figure<Grouped>({ table: INV.orders, shape: "categorical", filters: [OPEN], groupBy: ["supplier_id"], aggregations: [{ fn: "count", alias: "n" }], limit: LIMIT }),
    session.figure<Grouped>({ table: INV.orders, shape: "categorical", filters: [RECEIVED], groupBy: ["supplier_id"], aggregations: [{ fn: "count", alias: "n" }], limit: LIMIT }),
  ]);
  const supplies: Record<string, string[]> = {};
  for (const offer of offers.rows) if (offer.item !== null && offer.item !== undefined) (supplies[String(offer.supplier_id)] ??= []).push(offer.item);
  for (const names of Object.values(supplies)) names.sort((a, b) => a.localeCompare(b));
  const next: SuppliersData["next"] = {};
  const due = [...open.rows].sort((a, b) => (a.expected_on ?? "9999").localeCompare(b.expected_on ?? "9999") || a.id - b.id);
  for (const order of due) if (next[String(order.supplier_id)] === undefined) next[String(order.supplier_id)] = { number: order.number, expected: order.expected_on };
  const longest = [...suppliers.rows].filter((supplier) => supplier.lead_days !== null && Boolean(supplier.active)).sort((a, b) => num(b.lead_days) - num(a.lead_days))[0] ?? null;
  return {
    // In use first, then by name.
    suppliers: [...suppliers.rows].sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || a.name.localeCompare(b.name)),
    cut: (suppliers.total ?? suppliers.rows.length) > suppliers.rows.length,
    supplies,
    counts: { inUse, coming, received },
    coming: byKey(comingBy, "n"),
    received: byKey(receivedBy, "n"),
    next,
    longest,
  };
}
