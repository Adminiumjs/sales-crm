/**
 * VEHICLES AND CREW, part A (P25): what the office's four screens and the
 * crew's "My vehicle" read, and how they save.
 *
 * WHO COUNTS. The server. Every count and sum on these screens is a figure
 * the server answers this reader (`session.figure`), over the rows their
 * roles reach: a crew member's figures are his own van's. The browser
 * divides two of them (a cost per unit of distance, litres per hundred) and
 * subtracts a day from the server's own today (days over, days to go), and
 * nothing else (§1). A fill's distance is the server's own formula (the
 * fill's reading less the van's reading before it, copied onto the fill when
 * it is made), so "the distance measured" is a sum, not a sum of
 * differences worked out here.
 *
 * SAVING. A create carries a retry key; a lost reply is sent again with the
 * same key and the server answers the row the first one made. A change names
 * what the screen saw (`seen`), so a colleague's change meanwhile is not
 * written over.
 */
import { noonOf, type Formatters } from "../../lib/format.ts";
import type { Condition, Grouped, Row, Saved, StaffSession } from "../../staffSession.ts";
import { dayKeyOf, num, truthy } from "../jobs/data.ts";

export { dayKeyOf, num, truthy };

/* ─── Vehicles ─── */

export interface Vehicle extends Row {
  id: number;
  name: string;
  plate: string | null;
  model: string | null;
  odometer: number | null;
  /** The newer of the typed reading and the last fill's: the server's. */
  reading: number | null;
  inspection_due: string | null;
  service_due: string | null;
  tax_to: string | null;
  hired: boolean | number;
  /** A hired vehicle's days (plan 68 S14); empty for our own. Not read by the crew (the office's columns). */
  hired_from?: string | null;
  hired_to?: string | null;
}

const VEHICLE_COLUMNS = ["id", "name", "plate", "model", "odometer", "reading", "inspection_due", "service_due", "tax_to", "hired"];
/** The office reads a vehicle's hire days too. */
const OFFICE_COLUMNS = [...VEHICLE_COLUMNS, "hired_from", "hired_to"];

export const readVehicles = (session: StaffSession, withHire = false): Promise<Vehicle[]> =>
  session.list<Vehicle>("vehicles", { select: withHire ? OFFICE_COLUMNS : VEHICLE_COLUMNS, order: ["hired", "name", "id"], limit: 200 }).then((page) => page.rows);

/** The five ticks of a walk-round, in the crew's order. */
export const CHECK_TICKS = ["tyres", "fluids", "lights", "straps", "tail_lift"] as const;
export type CheckTick = (typeof CHECK_TICKS)[number];

export interface Check extends Row {
  id: number;
  vehicle_id: number;
  day: string;
  by_id: string;
  tyres: boolean | number;
  fluids: boolean | number;
  lights: boolean | number;
  straps: boolean | number;
  tail_lift: boolean | number;
}

const CHECK_COLUMNS = ["id", "vehicle_id", "day", "by_id", ...CHECK_TICKS];

/** The newest walk-round of each vehicle: one read a vehicle (a fleet is a handful). */
export async function readLastChecks(session: StaffSession, vehicles: readonly Pick<Vehicle, "id">[]): Promise<Map<number, Check>> {
  const out = new Map<number, Check>();
  await Promise.all(
    vehicles.map(async (vehicle) => {
      const page = await session.list<Check>("vehicle_checks", { select: CHECK_COLUMNS, where: { column: "vehicle_id", op: "eq", value: vehicle.id }, order: ["day.desc", "id.desc"], limit: 1 });
      const last = page.rows[0];
      if (last !== undefined) out.set(vehicle.id, last);
    }),
  );
  return out;
}

/** The ticks of a check that are not ticked, in the crew's order. */
export const missingTicks = (check: Pick<Check, CheckTick>): CheckTick[] => CHECK_TICKS.filter((tick) => !truthy(check[tick]));

export interface Fault extends Row {
  id: number;
  vehicle_id: number;
  text: string;
  raised_on: string;
  raised_by_id: string | null;
  fixed_on: string | null;
  photo: string | null;
}

const FAULT_COLUMNS = ["id", "vehicle_id", "text", "raised_on", "raised_by_id", "fixed_on", "photo"];

/** The faults not yet fixed, newest first: of one vehicle, or of every vehicle the reader reaches. */
export const readOpenFaults = (session: StaffSession, vehicleId: number | null = null): Promise<Fault[]> =>
  session
    .list<Fault>("vehicle_faults", {
      select: FAULT_COLUMNS,
      where: vehicleId === null ? { column: "fixed_on", op: "is_null" } : { and: [{ column: "fixed_on", op: "is_null" }, { column: "vehicle_id", op: "eq", value: vehicleId }] },
      order: ["raised_on.desc", "id.desc"],
      limit: 200,
    })
    .then((page) => page.rows);

type Single = { value?: number | null };
const count = (session: StaffSession, table: string, filters: Condition[] = []): Promise<number> =>
  session.figure<Single>({ table, shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] }).then((answer) => num(answer.value));
const sum = (session: StaffSession, table: string, column: string, filters: Condition[] = []): Promise<number> =>
  session.figure<Single>({ table, shape: "single-metric", filters, aggregations: [{ fn: "sum", column, alias: "s" }] }).then((answer) => num(answer.value));

export interface VehicleFigures {
  vehicles: number;
  ours: number;
  hired: number;
  serviceOver: number;
  /** Vehicles whose inspection falls within the warning window, today included. */
  inspectionSoon: number;
  openFaults: number;
  /** Open faults by vehicle id. */
  faultsBy: Map<number, number>;
}

/** The Vehicles screen's figures, as the server counts them for this reader. `warnDays` is the setting's window. */
export async function readVehicleFigures(session: StaffSession, today: string, soonUntil: string): Promise<VehicleFigures> {
  const [vehicles, ours, hired, serviceOver, inspectionSoon, faults] = await Promise.all([
    count(session, "vehicles"),
    count(session, "vehicles", [{ column: "hired", op: "eq", value: false }]),
    count(session, "vehicles", [{ column: "hired", op: "eq", value: true }]),
    count(session, "vehicles", [{ column: "service_due", op: "lt", value: today }]),
    count(session, "vehicles", [{ column: "inspection_due", op: "gte", value: today }, { column: "inspection_due", op: "lte", value: soonUntil }]),
    session.figure<Grouped>({ table: "vehicle_faults", shape: "categorical", filters: [{ column: "fixed_on", op: "is_null" }], groupBy: ["vehicle_id"], aggregations: [{ fn: "count", alias: "n" }] }),
  ]);
  const faultsBy = new Map<number, number>();
  for (const item of faults.items) if (item.key !== null && item.key !== "__null") faultsBy.set(Number(item.key), num(item.values?.["n"] ?? item.value));
  return { vehicles, ours, hired, serviceOver, inspectionSoon, openFaults: num(faults.total), faultsBy };
}

/** What a vehicle's row is saved with, from its form. */
export interface VehicleDraft {
  name: string;
  plate: string;
  model: string;
  odometer: number | null;
  inspection_due: string;
  service_due: string;
  tax_to: string;
  hired: boolean;
}

const blank = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export const vehicleValues = (draft: VehicleDraft): Row => ({
  name: draft.name.trim(),
  plate: blank(draft.plate),
  model: blank(draft.model),
  odometer: draft.odometer,
  inspection_due: blank(draft.inspection_due),
  service_due: blank(draft.service_due),
  tax_to: blank(draft.tax_to),
  hired: draft.hired,
});

/** Only what changed is sent, and the screen's view of each changed column is named, so a colleague's change is not written over. */
export function changedOf(before: Row, after: Row): { values: Row; seen: Row } {
  const values: Row = {};
  const seen: Row = {};
  for (const [column, value] of Object.entries(after)) {
    const was = before[column] ?? null;
    const same = was === value || (was !== null && value !== null && String(dayKeyOf(was) ?? was) === String(value)) || (typeof value === "boolean" && truthy(was) === value);
    if (same) continue;
    values[column] = value;
    seen[column] = was;
  }
  return { values, seen };
}

/* ─── Fuel ─── */

export interface Fill extends Row {
  id: number;
  vehicle_id: number;
  day: string;
  by_id: string;
  litres: number | string;
  cost: number | string;
  odometer: number;
  /** The server's: the fill's reading less the van's reading before it. Empty when there was none to measure from. */
  distance: number | null;
}

const FILL_COLUMNS = ["id", "vehicle_id", "day", "by_id", "litres", "cost", "odometer", "distance"];

export const readFills = (session: StaffSession, vehicleId: number | null = null, limit = 200): Promise<Fill[]> =>
  session
    .list<Fill>("fuel_fills", {
      select: FILL_COLUMNS,
      ...(vehicleId === null ? {} : { where: { column: "vehicle_id", op: "eq", value: vehicleId } }),
      order: ["day.desc", "id.desc"],
      limit,
    })
    .then((page) => page.rows);

/** A fill that was measured: its distance is above nothing. */
const MEASURED: Condition = { column: "distance", op: "gt", value: 0 };

export interface FuelTotals {
  fills: number;
  litres: number;
  cost: number;
  /** Over the fills with a measured distance. */
  distance: number;
  measuredLitres: number;
  measuredCost: number;
  measuredFills: number;
}

export interface FuelFigures {
  all: FuelTotals;
  /** By vehicle id. */
  by: Map<number, FuelTotals>;
  /** The months asked, oldest first: the cost and litres of each vehicle in each. */
  months: { month: string; by: Map<number, { litres: number; cost: number; fills: number }> }[];
}

const emptyTotals = (): FuelTotals => ({ fills: 0, litres: 0, cost: 0, distance: 0, measuredLitres: 0, measuredCost: 0, measuredFills: 0 });

/** The first day of each of the last `n` months up to the server's today, oldest first, and the day after the last. */
export function monthStarts(today: string, n: number): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const at = new Date(Date.UTC(year, month - (n - 1) + i, 1));
    return `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
}

/**
 * The Fuel screen's figures: the fills, the litres and the money, everywhere
 * and by vehicle; the same over the measured fills, with the distance; and
 * each vehicle's litres and money by month (asked by day ranges: a month's
 * bucket is read differently on Postgres, E20).
 */
export async function readFuelFigures(session: StaffSession, today: string, months = 3): Promise<FuelFigures> {
  const aggs = [
    { fn: "count" as const, alias: "n" },
    { fn: "sum" as const, column: "litres", alias: "l" },
    { fn: "sum" as const, column: "cost", alias: "c" },
  ];
  const measuredAggs = [...aggs, { fn: "sum" as const, column: "distance", alias: "d" }];
  const starts = monthStarts(today, months);
  const [fills, litres, cost, mFills, distance, mLitres, mCost, byAll, byMeasured, ...perMonth] = await Promise.all([
    count(session, "fuel_fills"),
    sum(session, "fuel_fills", "litres"),
    sum(session, "fuel_fills", "cost"),
    count(session, "fuel_fills", [MEASURED]),
    sum(session, "fuel_fills", "distance", [MEASURED]),
    sum(session, "fuel_fills", "litres", [MEASURED]),
    sum(session, "fuel_fills", "cost", [MEASURED]),
    session.figure<Grouped>({ table: "fuel_fills", shape: "categorical", groupBy: ["vehicle_id"], aggregations: aggs }),
    session.figure<Grouped>({ table: "fuel_fills", shape: "categorical", filters: [MEASURED], groupBy: ["vehicle_id"], aggregations: measuredAggs }),
    ...starts.slice(0, -1).map((start, i) =>
      session.figure<Grouped>({ table: "fuel_fills", shape: "categorical", filters: [{ column: "day", op: "gte", value: start }, { column: "day", op: "lt", value: starts[i + 1]! }], groupBy: ["vehicle_id"], aggregations: aggs }),
    ),
  ]);
  const by = new Map<number, FuelTotals>();
  const at = (key: unknown): FuelTotals => {
    const id = Number(key);
    const held = by.get(id) ?? emptyTotals();
    by.set(id, held);
    return held;
  };
  const value = (item: Grouped["items"][number], alias: string): number => num(item.values?.[alias] ?? (alias === "n" ? item.value : 0));
  for (const item of byAll.items) {
    if (item.key === null || item.key === "__null") continue;
    Object.assign(at(item.key), { fills: value(item, "n"), litres: value(item, "l"), cost: value(item, "c") });
  }
  for (const item of byMeasured.items) {
    if (item.key === null || item.key === "__null") continue;
    Object.assign(at(item.key), { measuredFills: value(item, "n"), measuredLitres: value(item, "l"), measuredCost: value(item, "c"), distance: value(item, "d") });
  }
  return {
    all: { fills, litres, cost, distance, measuredLitres: mLitres, measuredCost: mCost, measuredFills: mFills },
    by,
    months: perMonth.map((answer, i) => ({
      month: starts[i]!,
      by: new Map(answer.items.filter((item) => item.key !== null && item.key !== "__null").map((item) => [Number(item.key), { litres: value(item, "l"), cost: value(item, "c"), fills: value(item, "n") }])),
    })),
  };
}

/** A share of two server figures, or null when the second is nothing (the browser may divide two figures, §1). */
export const per = (part: number, whole: number): number | null => (whole <= 0 ? null : part / whole);

/** What a fill is saved with, from the phone. */
export interface FillDraft {
  vehicleId: number;
  day: string;
  litres: number;
  cost: number;
  odometer: number;
}

export const addFill = (session: StaffSession, draft: FillDraft, key: string): Promise<Saved<Fill>> =>
  session.create<Fill>("fuel_fills", { vehicle_id: draft.vehicleId, day: draft.day, litres: draft.litres, cost: draft.cost, odometer: draft.odometer }, key);

export const addCheck = (session: StaffSession, vehicleId: number, day: string, ticks: Record<CheckTick, boolean>, key: string): Promise<Saved<Check>> =>
  session.create<Check>("vehicle_checks", { vehicle_id: vehicleId, day, ...ticks }, key);

export const addFault = (session: StaffSession, vehicleId: number, text: string, photo: string | null, key: string): Promise<Saved<Fault>> =>
  session.create<Fault>("vehicle_faults", { vehicle_id: vehicleId, text: text.trim(), ...(photo === null ? {} : { photo }) }, key);

/** A fault marked fixed today (the server's day), once: a fault a colleague marked meanwhile is not written over. */
export const fixFault = (session: StaffSession, fault: Pick<Fault, "id" | "fixed_on">, today: string): Promise<Saved<Fault>> =>
  session.update<Fault>("vehicle_faults", fault.id, { fixed_on: today }, { seen: { fixed_on: fault.fixed_on } });

/** The walk-rounds of one day of the vehicles the reader reaches: his crew's, and his crew-mates'. */
export const readChecksOn = (session: StaffSession, day: string): Promise<Check[]> =>
  session.list<Check>("vehicle_checks", { select: CHECK_COLUMNS, where: { column: "day", op: "eq", value: day }, order: ["id.desc"], limit: 50 }).then((page) => page.rows);

/* ─── Subcontractors ─── */

export interface Sub extends Row {
  id: number;
  name: string;
  hands: number;
  day_rate: number | string;
  days_used: number | string | null;
  /** The server's: the day rate times the days used. */
  spent: number | string | null;
  insurance_until: string | null;
  certificate: string | null;
  email: string | null;
  chased_at: string | null;
  chased_by_id: string | null;
}

/**
 * The list names no columns: a subcontractor's address is personal, and a list that names a column kept from its reader
 * (Read-only) is refused whole, where one that names none is answered with that column empty (`_masked` says which).
 */
export const readSubs = (session: StaffSession): Promise<Sub[]> => session.list<Sub>("subcontractors", { order: ["name", "id"], limit: 200 }).then((page) => page.rows);

export interface SubFigures {
  all: number;
  covered: number;
  /** Insured until a day already gone. */
  runOut: number;
  /** No day on record at all. */
  unknown: number;
  days: number;
  spent: number;
  /** Visits of Jobs on site still waiting for a day, or null when the reader may not count them. */
  undated: number | null;
}

export async function readSubFigures(session: StaffSession, today: string, visits: boolean): Promise<SubFigures> {
  const [all, covered, runOut, unknown, days, spent, undated] = await Promise.all([
    count(session, "subcontractors"),
    count(session, "subcontractors", [{ column: "insurance_until", op: "gte", value: today }]),
    count(session, "subcontractors", [{ column: "insurance_until", op: "lt", value: today }]),
    count(session, "subcontractors", [{ column: "insurance_until", op: "is_null" }]),
    sum(session, "subcontractors", "days_used"),
    sum(session, "subcontractors", "spent"),
    visits ? count(session, "job_visits", [{ column: "state", op: "eq", value: "waiting" }, { column: "day", op: "is_null" }]) : Promise.resolve(null),
  ]);
  return { all, covered, runOut, unknown, days, spent, undated };
}

/** Whether a subcontractor may go on a site today: insured until today or later. */
export const covered = (sub: Pick<Sub, "insurance_until">, today: string): boolean => {
  const until = dayKeyOf(sub.insurance_until);
  return until !== null && until >= today;
};

export interface SubDraft {
  name: string;
  hands: number;
  day_rate: number;
  days_used: number | null;
  insurance_until: string;
  certificate: string;
  email: string;
}

export const subValues = (draft: SubDraft): Row => ({
  name: draft.name.trim(),
  hands: draft.hands,
  day_rate: draft.day_rate,
  days_used: draft.days_used,
  insurance_until: blank(draft.insurance_until),
  certificate: blank(draft.certificate),
  email: blank(draft.email),
});

/**
 * "Chase the certificate": the moment, by the server's clock, written once
 * over what the screen saw. The server stamps who chased and queues e-mail 11
 * to the subcontractor's own address; nothing else sends it.
 */
export const chase = (session: StaffSession, sub: Pick<Sub, "id" | "chased_at">): Promise<Saved<Sub>> =>
  session.update<Sub>("subcontractors", sub.id, { chased_at: session.now().toISOString() }, { seen: { chased_at: sub.chased_at } });

/** Whether a chase was made on this day, where the business is. */
export const chasedOn = (sub: Pick<Sub, "chased_at">, f: Pick<Formatters, "dayKey">, day: string): boolean => sub.chased_at !== null && sub.chased_at !== "" && f.dayKey(new Date(sub.chased_at)) === day;

/* ─── Insurance claims ─── */

export interface Incident extends Row {
  id: number;
  day: string;
  what: string;
  company_id: number | null;
  kind: string;
  insurer_ref: string | null;
  claimed: number | string;
  excess: number | string;
  paid: number | string;
  state: "open" | "settled";
  company?: string | null;
}

export const readIncidents = (session: StaffSession, withCompany: boolean): Promise<Incident[]> =>
  session
    .list<Incident>("insurance_incidents", { ...(withCompany ? { lookup: ["company:company_id.name"] } : {}), order: ["day.desc", "id.desc"], limit: 200 })
    .then((page) => page.rows);

export interface IncidentFigures {
  all: number;
  open: number;
  settled: number;
  claimed: number;
  excessSettled: number;
  paid: number;
  stillClaimed: number;
}

export async function readIncidentFigures(session: StaffSession): Promise<IncidentFigures> {
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const settled: Condition = { column: "state", op: "eq", value: "settled" };
  const [all, openN, settledN, claimed, excessSettled, paid, stillClaimed] = await Promise.all([
    count(session, "insurance_incidents"),
    count(session, "insurance_incidents", [open]),
    count(session, "insurance_incidents", [settled]),
    sum(session, "insurance_incidents", "claimed"),
    sum(session, "insurance_incidents", "excess", [settled]),
    sum(session, "insurance_incidents", "paid"),
    sum(session, "insurance_incidents", "claimed", [open]),
  ]);
  return { all, open: openN, settled: settledN, claimed, excessSettled, paid, stillClaimed };
}

export interface IncidentDraft {
  day: string;
  what: string;
  kind: string;
  insurer_ref: string;
  claimed: number;
  excess: number;
  paid: number;
}

export const incidentValues = (draft: IncidentDraft): Row => ({
  day: draft.day,
  what: draft.what.trim(),
  kind: draft.kind.trim(),
  insurer_ref: blank(draft.insurer_ref),
  claimed: draft.claimed,
  excess: draft.excess,
  paid: draft.paid,
});

/** Whole days from a day key to the server's today (a time subtracted from the server's now, §1). */
export const daysSince = (f: Pick<Formatters, "dayDiff">, day: string, today: string): number => f.dayDiff(noonOf(day), noonOf(today));
