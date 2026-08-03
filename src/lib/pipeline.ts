/**
 * The pipeline engine.
 *
 * Every number the workspace shows about money, odds, age or pace is derived
 * here from the deal list and the pinned clock — nothing is stored pre-computed
 * on a record, because a stored total is a total that goes stale the moment a
 * card moves between columns.
 *
 * The module is pure and React-free: it takes data in and returns data out, so
 * the vitest suite exercises the real thing rather than a copy of it. Anything
 * that needs a "today" takes it as an argument; the app passes `NOW` from
 * `data/demo.ts`, the tests pass whatever date the case needs.
 */

import type {
  Activity,
  ClosedDeal,
  Deal,
  FollowUp,
  Stage,
  StageId,
} from "../data/types.ts";

/** Days at which a deal's stage age turns amber, then danger. */
export const STALE_WARN_DAYS = 14;
export const STALE_DANGER_DAYS = 30;

/** Parse `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` as a LOCAL date. */
export function parseAt(value: string): Date {
  const [datePart, timePart = "00:00"] = value.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/** Whole days from `b` to `a`, ignoring the time of day on both. */
export function dayDiff(a: Date, b: Date): number {
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const y = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((x - y) / 86_400_000);
}

export function stageById(stages: Stage[], id: StageId): Stage {
  return stages.find((s) => s.id === id) ?? stages[0];
}

/** A deal's odds-weighted value: amount × the odds of the stage it sits in. */
export function weighted(deal: Deal, stages: Stage[]): number {
  return deal.amount * stageById(stages, deal.stage).odds;
}

/** Weighted total across any set of deals. */
export function weightedTotal(deals: Deal[], stages: Stage[]): number {
  return deals.reduce((sum, d) => sum + weighted(d, stages), 0);
}

/** Unweighted total — what the deals are worth if every one of them lands. */
export function openTotal(deals: Deal[]): number {
  return deals.reduce((sum, d) => sum + d.amount, 0);
}

/** How long the deal has sat in its current stage, against `now`. */
export function daysInStage(deal: Deal, now: Date): number {
  return Math.max(0, dayDiff(now, parseAt(deal.since)));
}

export type Staleness = "fresh" | "warn" | "stale";

/**
 * Staleness is a property of *time in the current stage*, not of the deal's
 * total age — a deal that has moved twice this month is not stale even if it
 * opened in April.
 */
export function staleness(deal: Deal, now: Date): Staleness {
  const days = daysInStage(deal, now);
  if (days >= STALE_DANGER_DAYS) return "stale";
  if (days >= STALE_WARN_DAYS) return "warn";
  return "fresh";
}

export interface Column {
  stage: Stage;
  deals: Deal[];
  count: number;
  /** Unweighted sum for the column. */
  total: number;
  /** Odds-weighted sum — what the forecast actually uses. */
  weighted: number;
}

/**
 * The board: one column per stage, in stage order, with its own subtotals.
 * Recomputed on every render rather than mutated, so dragging a card between
 * columns updates both subtotals and the header total from one source.
 */
export function columns(deals: Deal[], stages: Stage[]): Column[] {
  return stages.map((stage) => {
    const inStage = deals.filter((d) => d.stage === stage.id);
    return {
      stage,
      deals: inStage,
      count: inStage.length,
      total: openTotal(inStage),
      weighted: inStage.reduce((sum, d) => sum + d.amount * stage.odds, 0),
    };
  });
}

/* ---------------------------------------------------------------- follow-ups */

export interface QueuedFollowUp {
  followUp: FollowUp;
  deal: Deal;
  due: Date;
  overdue: boolean;
  /** Whole days late; 0 when it is due today or later. */
  daysLate: number;
}

/**
 * The Today queue: overdue first (oldest first inside that group), then the
 * rest by due time. Follow-ups whose deal has been closed or completed drop
 * out entirely rather than lingering as orphans.
 */
export function followUpQueue(
  followUps: FollowUp[],
  deals: Deal[],
  now: Date,
  done: ReadonlySet<string> = new Set(),
): QueuedFollowUp[] {
  const byId = new Map(deals.map((d) => [d.id, d]));

  const rows = followUps.flatMap<QueuedFollowUp>((followUp) => {
    if (done.has(followUp.id)) return [];
    const deal = byId.get(followUp.deal);
    if (!deal) return [];
    const due = parseAt(followUp.due);
    const overdue = due.getTime() < now.getTime();
    return [
      {
        followUp,
        deal,
        due,
        overdue,
        daysLate: overdue ? Math.max(0, dayDiff(now, due)) : 0,
      },
    ];
  });

  return rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.due.getTime() - b.due.getTime();
  });
}

/** Push a follow-up's due time forward by one day or one week. */
export function pushDue(due: Date, by: "day" | "week"): Date {
  const next = new Date(due);
  next.setDate(next.getDate() + (by === "day" ? 1 : 7));
  return next;
}

/* ------------------------------------------------------------------ forecast */

export interface ForecastMonth {
  /** First day of the month, for formatting through `Intl`. */
  month: Date;
  count: number;
  /** Odds-weighted value expected to close inside this month. */
  weighted: number;
  total: number;
  /** Running weighted total from the first month up to and including this one. */
  cumulative: number;
}

/**
 * Weighted value by expected close month, starting at `now`'s month and
 * running for `months` months. Deals expected to close before the window opens
 * are folded into the first month — an overdue close date does not vanish from
 * the forecast, which is exactly when a manager most wants to see it.
 */
export function forecast(
  deals: Deal[],
  stages: Stage[],
  now: Date,
  months = 3,
): ForecastMonth[] {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);

  const buckets: ForecastMonth[] = Array.from({ length: months }, (_, i) => ({
    month: new Date(start.getFullYear(), start.getMonth() + i, 1),
    count: 0,
    weighted: 0,
    total: 0,
    cumulative: 0,
  }));

  for (const deal of deals) {
    const close = parseAt(deal.close);
    const index =
      (close.getFullYear() - start.getFullYear()) * 12 +
      (close.getMonth() - start.getMonth());
    // Before the window → first bucket. After it → not forecast at all.
    if (index >= months) continue;
    const bucket = buckets[Math.max(0, index)];
    bucket.count += 1;
    bucket.weighted += weighted(deal, stages);
    bucket.total += deal.amount;
  }

  let running = 0;
  for (const bucket of buckets) {
    running += bucket.weighted;
    bucket.cumulative = running;
  }
  return buckets;
}

/** Deals whose expected close falls inside the calendar month `now` sits in. */
export function closingThisMonth(deals: Deal[], now: Date): Deal[] {
  return deals.filter((d) => {
    const close = parseAt(d.close);
    return (
      close.getFullYear() === now.getFullYear() &&
      close.getMonth() === now.getMonth()
    );
  });
}

/* ------------------------------------------------------------------- history */

/** Won ÷ closed, as a 0–1 fraction. An empty history is 0, not NaN. */
export function winRate(history: ClosedDeal[]): number {
  if (history.length === 0) return 0;
  return history.filter((h) => h.won).length / history.length;
}

/**
 * Mean days from opening to closing across WON deals only. Lost deals have a
 * different shape — they tend to die slowly — and folding them in makes the
 * number describe nothing in particular.
 */
export function averageCycleDays(history: ClosedDeal[]): number {
  const won = history.filter((h) => h.won);
  if (won.length === 0) return 0;
  const total = won.reduce(
    (sum, h) => sum + dayDiff(parseAt(h.closed), parseAt(h.opened)),
    0,
  );
  return Math.round(total / won.length);
}

/** The `n` deals sitting longest in their current stage, worst first. */
export function goingStale(deals: Deal[], now: Date, n = 3): Deal[] {
  return deals
    .filter((d) => staleness(d, now) !== "fresh")
    .sort((a, b) => daysInStage(b, now) - daysInStage(a, now))
    .slice(0, n);
}

/* ----------------------------------------------------------------- timelines */

/**
 * Activities for a deal, newest first. The comparison is on the parsed
 * timestamp rather than the raw string so a seed written out of order still
 * renders in order.
 */
export function timeline(activities: Activity[], dealId: string): Activity[] {
  return activities
    .filter((a) => a.deal === dealId)
    .sort((a, b) => parseAt(b.at).getTime() - parseAt(a.at).getTime());
}

/** Every activity across a set of deals, newest first — the company timeline. */
export function timelineForDeals(
  activities: Activity[],
  dealIds: readonly string[],
): Activity[] {
  const ids = new Set(dealIds);
  return activities
    .filter((a) => ids.has(a.deal))
    .sort((a, b) => parseAt(b.at).getTime() - parseAt(a.at).getTime());
}
