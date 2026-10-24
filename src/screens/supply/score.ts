/**
 * THE SUPPLIER SCORE (plan 68 S12, the design's screen 60), worked out from
 * figures the server counted: a supplier's deliveries of the last 90 days that
 * say whether they were late, how many of them were, how late the late ones
 * were on average, and its warranty claims of the year.
 *
 *   on time   = (deliveries − late) ÷ deliveries, to a tenth of a per cent
 *   weeks over = the late ones' average days late, in whole weeks (half up)
 *   score     = on time − 6 a claim − 7 a week over, held to 0…100, half up
 *   band      = Solid from 88, Watch them from 75, else A problem
 *
 * As the ledger works it (`sample.py`, screen 60), so the screen and the ledger
 * agree to the point: worked in tenths, never in floating point.
 */

export type Band = "solid" | "watch" | "problem";

export interface Judged {
  /** Deliveries of the window that say whether they were late. */
  n: number;
  late: number;
  /** The late ones' average days late, as the server answered it; null with none late. */
  avgLate: number | null;
  /** Its claims of the year; null when claims are not shown (After the job off, or not this reader's). */
  claims: number | null;
}

export interface Score {
  /** On time, in tenths of a per cent: 854 is 85.4 %. */
  onTenths: number;
  weeksOver: number;
  score: number;
  band: Band;
}

/** On time in tenths of a per cent, half up; null with no delivery to judge. */
export function onTimeTenths(n: number, late: number): number | null {
  if (n <= 0) return null;
  return Math.floor((2000 * (n - late) + n) / (2 * n));
}

/** The late ones' average days late in whole weeks, half up. */
export function weeksOver(avgLate: number | null): number {
  if (avgLate === null || !Number.isFinite(avgLate) || avgLate <= 0) return 0;
  return Math.floor(avgLate / 7 + 0.5);
}

export function bandOf(score: number): Band {
  return score >= 88 ? "solid" : score >= 75 ? "watch" : "problem";
}

/** A supplier's score, or null when no delivery of the window says whether it was late. */
export function scoreOf(judged: Judged): Score | null {
  const onTenths = onTimeTenths(judged.n, judged.late);
  if (onTenths === null) return null;
  const weeks = weeksOver(judged.avgLate);
  const tenths = Math.max(0, Math.min(1000, onTenths - 60 * (judged.claims ?? 0) - 70 * weeks));
  const score = Math.floor((tenths + 5) / 10);
  return { onTenths, weeksOver: weeks, score, band: bandOf(score) };
}
