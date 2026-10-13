/**
 * Figures over deals that more than one screen shows, asked of the server
 * the same way each time: closed deals by how they ended, open deals by
 * stage. Every one is cut to the reader's own rows by the server; nothing
 * here adds rows up.
 */
import { leadRole } from "../shell/roles.ts";
import type { Condition, Grouped, StaffSession } from "../staffSession.ts";

export interface Ended {
  count: number;
  /** The sum of the deals' amounts. */
  amount: number;
  /** Average whole days from the day a deal opened to the day it closed; null when none closed. */
  cycle: number | null;
}
export interface Closed {
  won: Ended;
  lost: Ended;
}

const NONE: Ended = { count: 0, amount: 0, cycle: null };
const num = (value: number | null | undefined): number => (typeof value === "number" ? value : 0);

/** Closed deals, won and lost: how many, for how much, and how long they were open. `owner` narrows to one person's; `between` to the days they closed on. */
export async function closedFigures(session: StaffSession, q: { owner?: string | null; between?: [string, string] } = {}): Promise<Closed> {
  const filters: Condition[] = [{ column: "state", op: "in", value: ["won", "lost"] }];
  if (q.owner !== undefined && q.owner !== null) filters.push({ column: "owner_id", op: "eq", value: q.owner });
  if (q.between !== undefined) filters.push({ column: "closed_on", op: "between", value: q.between });
  const grouped = await session.figure<Grouped>({
    table: "deals",
    shape: "categorical",
    filters,
    groupBy: ["state"],
    aggregations: [
      { fn: "count", alias: "n" },
      { fn: "sum", column: "amount", alias: "amount" },
      { fn: "avg", column: "cycle_days", alias: "cycle" },
    ],
  });
  const of = (state: string): Ended => {
    const values = grouped.items.find((item) => String(item.key) === state)?.values;
    return values === undefined ? NONE : { count: num(values["n"]), amount: num(values["amount"]), cycle: typeof values["cycle"] === "number" ? values["cycle"] : null };
  };
  return { won: of("won"), lost: of("lost") };
}

/** Won out of all that closed, between 0 and 1: two figures of the server's, divided. Null when nothing closed. */
export const winRate = (closed: Closed): number | null => (closed.won.count + closed.lost.count === 0 ? null : closed.won.count / (closed.won.count + closed.lost.count));

/**
 * Whose deals a selling screen shows:
 *  - `mine`: a rep's own (the deals she helps on or covers are shown on her
 *    board, marked, and counted for their owners);
 *  - `won`: the account manager's, who reads a deal once it is won;
 *  - `team`: everybody's the reader reaches, with a filter by person.
 */
export type Scope = "mine" | "won" | "team";
export function scopeOf(session: StaffSession): Scope {
  const lead = leadRole((session.config.access?.roles ?? []).map((role) => role.slug));
  return lead === "rep" ? "mine" : lead === "account-manager" ? "won" : "team";
}

/** The first and last day of the year a day falls in. */
export const yearOf = (dayKey: string): [string, string] => [`${dayKey.slice(0, 4)}-01-01`, `${dayKey.slice(0, 4)}-12-31`];
