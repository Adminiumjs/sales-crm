/**
 * TARGETS: what the screen reads.
 *
 * WHO READS WHAT. The server: a rep reads her own target and no other (so
 * she is shown no team target, ruling F5); the sales manager reads the
 * targets of the people she leads; the CRM admin and Read-only read all.
 *
 * WHO COUNTS. The server, every figure:
 *  - booked: the sum of the amounts of deals won this year;
 *  - weighted open: the sum of the open deals' weighted values;
 *  - toward the target: ONE sum over one column the deal keeps
 *    (`target_value`: its amount once won, its weighted value while open),
 *    over the deals open now or won this year. "Covered" is that figure
 *    divided by the target. The browser adds nothing up.
 */
import { yearOf } from "../../selling/figures.ts";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { num } from "./data.ts";

export interface Target extends Record<string, unknown> {
  id: number;
  rep_id: string;
  year: number;
  amount: number | string;
  set_by_id: string | null;
  set_at: string | null;
}

export interface Sums {
  booked: number;
  weighted: number;
  /** Booked and weighted open as the server adds them, over one column. */
  toward: number;
  /** Open deals. */
  deals: number;
}
export interface Biggest {
  id: number;
  name: string;
  amount: number;
}
export interface TargetsData {
  year: number;
  targets: Target[];
  /** The sum of the targets the reader reaches, by the server. Null for somebody who is shown no team. */
  teamTarget: number | null;
  team: Sums | null;
  byRep: Record<string, Sums>;
  biggest: Record<string, Biggest>;
}

const NONE: Sums = { booked: 0, weighted: 0, toward: 0, deals: 0 };

/** Covered: the server's figure toward the target, divided by the target. Null with no target. */
export const coverOf = (toward: number, target: number): number | null => (target > 0 ? toward / target : null);
/** How far the two figures are apart, never below nothing. */
export const leftOf = (toward: number, target: number): number => Math.max(0, target - toward);

/** The day of the year a day is, and how many the year has: for "even pace". */
export function yearDay(dayKey: string): { day: number; of: number } {
  const year = Number(dayKey.slice(0, 4));
  const start = Date.UTC(year, 0, 1);
  return { day: Math.round((Date.parse(`${dayKey}T00:00:00Z`) - start) / 86_400_000) + 1, of: Math.round((Date.UTC(year + 1, 0, 1) - start) / 86_400_000) };
}

export async function readTargets(session: StaffSession, today: string, team: boolean): Promise<TargetsData> {
  const year = Number(today.slice(0, 4));
  const me = session.config.user?.id ?? "";
  const within = yearOf(today);
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const won: Condition = { and: [{ column: "state", op: "eq", value: "won" }, { column: "closed_on", op: "between", value: within }] };
  const toward: Condition = { or: [open, won] };
  // A rep's figures are her own deals', not those she helps on or covers.
  const own: Condition[] = team ? [] : [{ column: "owner_id", op: "eq", value: me }];
  const grouped = (filters: Condition[], column: string | null): Promise<Grouped> =>
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [...own, ...filters], groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }, ...(column === null ? [] : [{ fn: "sum" as const, column, alias: "sum" }])] });
  const one = (filters: Condition[], column: string): Promise<{ value: number | null }> => session.figure<{ value: number | null }>({ table: "deals", shape: "single-metric", filters, aggregations: [{ fn: "sum", column, alias: "sum" }] });
  const [targets, booked, weighted, towards, biggest, teamTarget, teamBooked, teamWeighted, teamToward] = await Promise.all([
    session.list<Target>("targets", { select: ["id", "rep_id", "year", "amount", "set_by_id", "set_at"], where: { column: "year", op: "eq", value: year }, order: ["id"], limit: 200 }),
    grouped([won], "amount"),
    grouped([open], "weighted_value"),
    grouped([toward], "target_value"),
    session.list<{ id: number; name: string; amount: number | string | null; owner_id: string }>("deals", { select: ["id", "name", "amount", "owner_id"], where: own.length === 0 ? open : { and: [...own, open] }, order: ["amount.desc", "id"], limit: 200 }),
    team ? session.figure<{ value: number | null }>({ table: "targets", shape: "single-metric", filters: [{ column: "year", op: "eq", value: year }], aggregations: [{ fn: "sum", column: "amount", alias: "sum" }] }) : Promise.resolve(null),
    team ? one([won], "amount") : Promise.resolve(null),
    team ? one([open], "weighted_value") : Promise.resolve(null),
    team ? one([toward], "target_value") : Promise.resolve(null),
  ]);
  const byRep: Record<string, Sums> = {};
  const put = (answer: Grouped, into: keyof Sums, count = false): void => {
    for (const item of answer.items) {
      if (item.key === null) continue;
      const sums = (byRep[String(item.key)] ??= { ...NONE });
      sums[into] = num(item.values?.["sum"]);
      if (count) sums.deals = num(item.values?.["n"] ?? item.value);
    }
  };
  put(booked, "booked");
  put(weighted, "weighted", true);
  put(towards, "toward");
  const first: Record<string, Biggest> = {};
  // The list comes largest first: the first row of each person is their biggest open deal.
  for (const deal of biggest.rows) first[deal.owner_id] ??= { id: deal.id, name: deal.name, amount: num(deal.amount) };
  return {
    year,
    targets: targets.rows,
    teamTarget: teamTarget === null ? null : num(teamTarget.value),
    team: teamBooked === null || teamWeighted === null || teamToward === null ? null : { booked: num(teamBooked.value), weighted: num(teamWeighted.value), toward: num(teamToward.value), deals: 0 },
    byRep,
    biggest: first,
  };
}

export const sumsOf = (data: TargetsData, rep: string): Sums => data.byRep[rep] ?? NONE;

export interface RepYear {
  /** Null when the reader reaches no target of this person (none set, or not theirs to read). */
  target: number | null;
  sums: Sums;
}

/** One person's year: their target and the server's four figures over their own deals. */
export async function readRepYear(session: StaffSession, rep: string, today: string): Promise<RepYear> {
  const within = yearOf(today);
  const mine: Condition = { column: "owner_id", op: "eq", value: rep };
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const won: Condition = { and: [{ column: "state", op: "eq", value: "won" }, { column: "closed_on", op: "between", value: within }] };
  const one = (filters: Condition[], fn: "sum" | "count", column?: string): Promise<{ value: number | null }> =>
    session.figure<{ value: number | null }>({ table: "deals", shape: "single-metric", filters: [mine, ...filters], aggregations: [{ fn, ...(column === undefined ? {} : { column }), alias: "v" }] });
  const [targets, booked, weighted, toward, deals] = await Promise.all([
    session.can("targets", "read")
      ? session.list<Target>("targets", { select: ["id", "rep_id", "year", "amount"], where: { and: [{ column: "rep_id", op: "eq", value: rep }, { column: "year", op: "eq", value: Number(today.slice(0, 4)) }] }, limit: 1 })
      : Promise.resolve({ rows: [] as Target[], total: 0, next: null }),
    one([won], "sum", "amount"),
    one([open], "sum", "weighted_value"),
    one([{ or: [open, won] }], "sum", "target_value"),
    one([open], "count"),
  ]);
  return { target: targets.rows[0] === undefined ? null : num(targets.rows[0].amount), sums: { booked: num(booked.value), weighted: num(weighted.value), toward: num(toward.value), deals: num(deals.value) } };
}
