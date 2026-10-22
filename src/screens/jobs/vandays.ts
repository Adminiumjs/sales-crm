/**
 * A CREW'S VEHICLE FOR THE DAY, AND WHAT TO LOAD (plan 68 S14, D16): what the
 * booking dialog, the Day sheet, the Route, Vehicles and My day read of it,
 * and how the office writes it.
 *
 * ONE ROW A CREW A DAY. A crew's day with a visit has a stored row naming its
 * vehicle (`van_days`), written with the crew's first visit of that day: its
 * own vehicle unless another is picked (CD-8). Every visit of the crew that
 * day shares it. The server holds one crew to a vehicle a day (`occupies`) and
 * a hired vehicle to its hire days; a row whose crew has no visit left that
 * day is taken away with its last visit, and one left behind (a visit removed
 * elsewhere) holds nothing here: it is taken away before its vehicle is given
 * to another crew.
 *
 * WHAT TO LOAD. Per visit: the stock its deal needs that goes on it
 * (`deal_stock_needs`, by the visit it names, with Inventory's line and unit;
 * never what it costs) and the lines of its delivery note, as ordered. The
 * crew reads both for its own visits only (the server's reach).
 */
import type { Row, Saved, StaffSession } from "../../staffSession.ts";
import { newClientKey } from "../../staffSession.ts";
import { dayKeyOf, num, truthy } from "./data.ts";

export interface VanDay extends Row {
  id: number;
  crew_id: number;
  day: string;
  vehicle_id: number;
  plate: string | null;
  vehicle_name: string | null;
  hired: boolean | number;
}

export interface DayVehicle extends Row {
  id: number;
  name: string;
  plate: string | null;
  hired: boolean | number;
  hired_from: string | null;
  hired_to: string | null;
  service_due: string | null;
}

/** Whether this reader's install has a vehicle for a crew's day at all: the part Vehicles and crew, and a read of its days. */
export const hasVanDays = (session: StaffSession): boolean => session.part("fleet") && session.can("van_days", "read");
/** Whether this reader puts a vehicle on a crew's day: the office. */
export const writesVanDays = (session: StaffSession): boolean => hasVanDays(session) && session.can("van_days", "create") && session.can("van_days", "update");

const DAY_COLUMNS = ["id", "crew_id", "day", "vehicle_id", "plate", "vehicle_name", "hired"];

/** The crews' vehicles of some days, as this reader reaches them (the crew: its own). Nothing where the part is off. */
export async function readVanDays(session: StaffSession, from: string, to: string): Promise<VanDay[]> {
  if (!hasVanDays(session)) return [];
  const page = await session.list<VanDay>("van_days", { select: DAY_COLUMNS, where: { and: [{ column: "day", op: "gte", value: from }, { column: "day", op: "lte", value: to }] }, order: ["day", "crew_id", "id"], limit: 200 });
  return page.rows;
}

/** The vehicles a crew's day can go on, and each crew's own: for the office. */
export async function readDayVehicles(session: StaffSession): Promise<{ vehicles: DayVehicle[]; own: Map<number, number> }> {
  if (!hasVanDays(session) || !session.can("vehicles", "read")) return { vehicles: [], own: new Map() };
  const [vehicles, crews] = await Promise.all([
    session.list<DayVehicle>("vehicles", { select: ["id", "name", "plate", "hired", "hired_from", "hired_to", "service_due"], order: ["hired", "name", "id"], limit: 50 }),
    session.list<{ id: number; vehicle_id: number | null }>("crews", { select: ["id", "vehicle_id"], limit: 50 }),
  ]);
  const own = new Map<number, number>();
  for (const crew of crews.rows) if (crew.vehicle_id !== null && crew.vehicle_id !== undefined) own.set(crew.id, Number(crew.vehicle_id));
  return { vehicles: vehicles.rows, own };
}

export const dayOfRow = (row: Pick<VanDay, "day">): string | null => dayKeyOf(row.day);
export const rowOf = (days: readonly VanDay[], crewId: number | null, day: string): VanDay | undefined => days.find((row) => row.crew_id === crewId && dayOfRow(row) === day);

/** How a vehicle stands for one crew's day, as the dialog's list says it (M3 §7 BN-10). */
export type Standing =
  | { kind: "own" }
  | { kind: "with"; crewId: number }
  | { kind: "until"; to: string }
  | { kind: "notHired"; from: string | null; to: string | null }
  | { kind: "idle"; crewId: number }
  | { kind: "plain" };

export interface Facts {
  vehicles: readonly DayVehicle[];
  /** Each crew's own vehicle, by crew. */
  own: ReadonlyMap<number, number>;
  /** The vehicles of the crews' days around. */
  days: readonly VanDay[];
  /** Whether a crew has a booked visit that day (a row of a crew with none holds nothing). */
  busy: (crewId: number, day: string) => boolean;
}

/** The crew a vehicle is with on a day, when another crew holds it there (with a visit that day). */
export function holderOf(facts: Facts, vehicleId: number, day: string, crewId: number): number | null {
  const row = facts.days.find((one) => one.vehicle_id === vehicleId && dayOfRow(one) === day && one.crew_id !== crewId);
  return row !== undefined && facts.busy(row.crew_id, day) ? row.crew_id : null;
}

/** A row another crew left behind on a vehicle that day (no visit of theirs is left): taken away before the vehicle is used. */
export function staleOf(facts: Facts, vehicleId: number, day: string, crewId: number): VanDay | undefined {
  return facts.days.find((one) => one.vehicle_id === vehicleId && dayOfRow(one) === day && one.crew_id !== crewId && !facts.busy(one.crew_id, day));
}

/** Whether a hired vehicle is hired on a day; one of our own (no hire days) always is. */
export function hiredOn(vehicle: Pick<DayVehicle, "hired_from" | "hired_to">, day: string): boolean {
  const from = dayKeyOf(vehicle.hired_from);
  const to = dayKeyOf(vehicle.hired_to);
  return (from === null || day >= from) && (to === null || day <= to);
}

export function standingOf(facts: Facts, vehicle: DayVehicle, crewId: number | null, day: string): Standing {
  const own = crewId === null ? undefined : facts.own.get(crewId);
  if (crewId !== null) {
    const holder = holderOf(facts, vehicle.id, day, crewId);
    if (holder !== null) return { kind: "with", crewId: holder };
  }
  if (!hiredOn(vehicle, day)) return { kind: "notHired", from: dayKeyOf(vehicle.hired_from), to: dayKeyOf(vehicle.hired_to) };
  if (own === vehicle.id) return { kind: "own" };
  const hireEnds = dayKeyOf(vehicle.hired_to);
  if (truthy(vehicle.hired) && hireEnds !== null) return { kind: "until", to: hireEnds };
  const owner = [...facts.own].find(([, id]) => id === vehicle.id)?.[0];
  if (owner !== undefined) return { kind: "idle", crewId: owner };
  return { kind: "plain" };
}

/** Whether a vehicle can be picked for the day: not with another crew, and hired that day. */
export const pickable = (standing: Standing): boolean => standing.kind !== "with" && standing.kind !== "notHired";

/** The vehicle a crew's day defaults to: its row's, else its own. */
export function defaultVehicle(facts: Facts, crewId: number | null, day: string): number | null {
  const row = rowOf(facts.days, crewId, day);
  if (row !== undefined) return row.vehicle_id;
  return crewId === null ? null : (facts.own.get(crewId) ?? null);
}

/** Days past a vehicle's service on the office's today (CD-11), or 0. */
export function serviceOver(vehicle: Pick<DayVehicle, "service_due">, today: string): number {
  const due = dayKeyOf(vehicle.service_due);
  if (due === null || due >= today) return 0;
  return Math.round((Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10))) / 86_400_000);
}

/** Why the server refused a vehicle for a crew's day, in the dialog's terms. */
export type DayRefusal = { kind: "with"; vehicleId: number; crewId: number | null } | { kind: "hiredTo"; vehicleId: number; to: string } | { kind: "hiredFrom"; vehicleId: number; from: string } | { kind: "other"; error: Saved };

/** What the dialog finds wrong with a pick before it is sent: another crew holds it, or it is not hired that day. */
export function refusalOf(facts: Facts, vehicleId: number | null, crewId: number | null, day: string): DayRefusal | null {
  if (vehicleId === null || crewId === null) return null;
  const holder = holderOf(facts, vehicleId, day, crewId);
  if (holder !== null) return { kind: "with", vehicleId, crewId: holder };
  const vehicle = facts.vehicles.find((one) => one.id === vehicleId);
  if (vehicle === undefined || hiredOn(vehicle, day)) return null;
  const from = dayKeyOf(vehicle.hired_from);
  const to = dayKeyOf(vehicle.hired_to);
  if (to !== null && day > to) return { kind: "hiredTo", vehicleId, to };
  if (from !== null && day < from) return { kind: "hiredFrom", vehicleId, from };
  return null;
}

/**
 * Put a vehicle on a crew's day: the row there is changed, or one is made. A row another crew left on that vehicle
 * that day, with no visit of theirs left, is taken away first. Answers whether a row was made (to take it away
 * again when the booking it was for is refused), or the refusal in the dialog's terms.
 */
export async function putVanDay(session: StaffSession, facts: Facts, crewId: number, day: string, vehicleId: number): Promise<{ made: VanDay | null } | { refused: DayRefusal }> {
  const stale = staleOf(facts, vehicleId, day, crewId);
  if (stale !== undefined) await session.remove("van_days", stale.id);
  const row = rowOf(facts.days, crewId, day);
  const saved: Saved<VanDay> =
    row === undefined
      ? await session.create<VanDay>("van_days", { crew_id: crewId, day, vehicle_id: vehicleId }, newClientKey())
      : row.vehicle_id === vehicleId
        ? { state: "saved", row, replayed: false, readBack: false }
        : await session.update<VanDay>("van_days", row.id, { vehicle_id: vehicleId }, { seen: { vehicle_id: row.vehicle_id } });
  if (saved.state === "saved") return { made: row === undefined ? saved.row : null };
  return { refused: await readRefusal(session, saved, vehicleId, day, crewId) };
}

/** The server's refusal of a vehicle for a day, read again so the words name who has it, or the hire's end. */
async function readRefusal(session: StaffSession, saved: Saved, vehicleId: number, day: string, crewId: number): Promise<DayRefusal> {
  if (saved.state !== "refused") return { kind: "other", error: saved };
  const error = saved.error;
  if (error.fields["day"] !== undefined) {
    const vehicle = await session.get<DayVehicle>("vehicles", vehicleId).catch(() => null);
    const to = dayKeyOf(vehicle?.hired_to);
    const from = dayKeyOf(vehicle?.hired_from);
    if (to !== null && day > to) return { kind: "hiredTo", vehicleId, to };
    if (from !== null && day < from) return { kind: "hiredFrom", vehicleId, from };
  }
  if (error.status === 409) {
    const page = await session.list<VanDay>("van_days", { select: DAY_COLUMNS, where: { and: [{ column: "vehicle_id", op: "eq", value: vehicleId }, { column: "day", op: "eq", value: day }] }, limit: 5 }).catch(() => null);
    const other = page?.rows.find((one) => one.crew_id !== crewId);
    return { kind: "with", vehicleId, crewId: other?.crew_id ?? null };
  }
  return { kind: "other", error: saved };
}

/** Take a crew's row of a day away when no visit of the crew is left that day (its last visit moved, called off or given away). */
export async function dropIfEmpty(session: StaffSession, crewId: number | null, day: string | null): Promise<void> {
  if (crewId === null || day === null || !writesVanDays(session) || !session.can("van_days", "delete")) return;
  const [left, rows] = await Promise.all([
    session.figure<{ value?: number | null }>({ table: "job_visits", shape: "single-metric", filters: [{ column: "state", op: "eq", value: "booked" }, { column: "crew_id", op: "eq", value: crewId }, { column: "day", op: "eq", value: day }], aggregations: [{ fn: "count", alias: "n" }] }),
    session.list<VanDay>("van_days", { select: ["id"], where: { and: [{ column: "crew_id", op: "eq", value: crewId }, { column: "day", op: "eq", value: day }] }, limit: 2 }),
  ]);
  if (num(left.value) > 0) return;
  for (const row of rows.rows) await session.remove("van_days", row.id);
}

/* ─── What to load ─── */

export interface StockLine {
  id: number;
  visitId: number;
  /** Inventory's name of the line, or null where Inventory is not read. */
  name: string | null;
  unit: string | null;
  qty: number | null;
}

export interface NoteLineToLoad {
  id: number;
  visitId: number;
  what: string;
  ordered: number;
}

export interface Loads {
  stock: Map<number, StockLine[]>;
  note: Map<number, NoteLineToLoad[]>;
  /** Whether the stock of a visit is read here at all (the part, the reader's right). */
  readsStock: boolean;
}

/** What to load on some visits: their stock needs with Inventory's line and unit, and their delivery notes' lines. */
export async function readLoadLists(session: StaffSession, visitIds: readonly number[]): Promise<Loads> {
  const out: Loads = { stock: new Map(), note: new Map(), readsStock: session.part("fleet") && session.part("supply") && session.can("deal_stock_needs", "read") };
  if (visitIds.length === 0) return out;
  const [needs, notes] = await Promise.all([
    out.readsStock
      ? session.list<{ id: number; item: number | null; qty: number | string | null; visit_id: number }>("deal_stock_needs", { select: ["id", "item", "qty", "visit_id"], where: { column: "visit_id", op: "in", value: [...visitIds] }, order: ["visit_id", "id"], limit: 200 }).then((page) => page.rows).catch(() => [])
      : Promise.resolve([]),
    session.can("delivery_notes", "read") ? session.list<{ id: number; visit_id: number }>("delivery_notes", { select: ["id", "visit_id"], where: { column: "visit_id", op: "in", value: [...visitIds] }, limit: 200 }).then((page) => page.rows).catch(() => []) : Promise.resolve([]),
  ]);
  const itemIds = [...new Set(needs.map((need) => need.item).filter((item): item is number => item !== null && item !== undefined))];
  const [items, lines] = await Promise.all([
    itemIds.length > 0 && session.can("inventory:items", "read")
      ? session.list<{ id: number; name: string; unit: string | null }>("inventory:items", { select: ["id", "name", "unit"], where: { column: "id", op: "in", value: itemIds }, limit: 200 }).then((page) => page.rows).catch(() => [])
      : Promise.resolve([]),
    notes.length > 0 ? session.list<{ id: number; note_id: number; what: string; ordered: number | string }>("delivery_note_lines", { select: ["id", "note_id", "what", "ordered"], where: { column: "note_id", op: "in", value: notes.map((note) => note.id) }, order: ["note_id", "id"], limit: 200 }).then((page) => page.rows).catch(() => []) : Promise.resolve([]),
  ]);
  const itemOf = new Map(items.map((item) => [Number(item.id), item]));
  for (const need of needs) {
    const item = need.item === null ? undefined : itemOf.get(Number(need.item));
    const line: StockLine = { id: need.id, visitId: Number(need.visit_id), name: item?.name ?? null, unit: item?.unit ?? null, qty: need.qty === null || need.qty === "" ? null : num(need.qty) };
    out.stock.set(line.visitId, [...(out.stock.get(line.visitId) ?? []), line]);
  }
  const visitOfNote = new Map(notes.map((note) => [note.id, Number(note.visit_id)]));
  for (const line of lines) {
    const visitId = visitOfNote.get(line.note_id);
    if (visitId === undefined) continue;
    out.note.set(visitId, [...(out.note.get(visitId) ?? []), { id: line.id, visitId, what: line.what, ordered: num(line.ordered) }]);
  }
  return out;
}

/** One day as the booking dialog and the Day sheet read it: the vehicles, each crew's own, the crews' rows that day, and how many visits each crew has booked then. */
export interface DayFacts extends Facts {
  day: string;
  counts: ReadonlyMap<number, number>;
}

export async function readDayFacts(session: StaffSession, day: string): Promise<DayFacts | null> {
  if (!hasVanDays(session)) return null;
  const [{ vehicles, own }, days, grouped] = await Promise.all([
    readDayVehicles(session),
    readVanDays(session, day, day),
    session.figure<{ items: { key: string | number | null; value?: number | null; values?: Record<string, number | null> }[] }>({
      table: "job_visits",
      shape: "categorical",
      filters: [{ column: "state", op: "eq", value: "booked" }, { column: "day", op: "eq", value: day }],
      groupBy: ["crew_id"],
      aggregations: [{ fn: "count", alias: "n" }],
    }),
  ]);
  const counts = new Map<number, number>();
  for (const item of grouped.items) if (item.key !== null && item.key !== "__null") counts.set(Number(item.key), num(item.values?.["n"] ?? item.value));
  return { day, vehicles, own, days, counts, busy: (crewId, when) => when === day && (counts.get(crewId) ?? 0) > 0 };
}

/** Whether a crew's day is on a hired vehicle, as its row keeps it. */
export const truthyHired = (row: Pick<VanDay, "hired">): boolean => truthy(row.hired);

/**
 * A booked visit dragged to another day keeps its crew: the crew's row that day stands, or one is made on the
 * crew's own vehicle (CD-8). Answers the refusal when another crew has that vehicle then, with the facts read.
 */
export async function vanDayForMove(session: StaffSession, crewId: number | null, day: string): Promise<{ made: VanDay | null; facts: DayFacts | null } | { refused: DayRefusal; facts: DayFacts }> {
  if (crewId === null || !writesVanDays(session)) return { made: null, facts: null };
  const facts = await readDayFacts(session, day);
  if (facts === null || rowOf(facts.days, crewId, day) !== undefined) return { made: null, facts };
  const own = facts.own.get(crewId);
  if (own === undefined) return { made: null, facts };
  const early = refusalOf(facts, own, crewId, day);
  if (early !== null) return { refused: early, facts };
  const put = await putVanDay(session, facts, crewId, day, own);
  return "refused" in put ? { refused: put.refused, facts } : { made: put.made, facts };
}
