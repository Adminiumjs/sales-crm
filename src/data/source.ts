/**
 * The DataSource seam.
 *
 * This app ships in demo mode: every read below returns the seeded fiction in
 * `demo.ts`, synchronously, with no network involved. The seam exists so that
 * pointing the app at a real Adminium deployment is a change to ONE file
 * rather than a rewrite — the screens and the store already talk to this
 * interface and never import `demo.ts` for data they render.
 *
 * That second implementation now exists: `adminiumSource.ts` reads a real
 * Adminium instance through `@adminiumjs/public-client` and is swapped in by
 * `main.tsx` before React mounts. `demoSource` remains the fallback whenever
 * either build-time env var is absent — which is the case for every
 * marketplace demo, and is why that fallback is structural rather than a catch.
 *
 * THE PARAGRAPH ABOVE USED TO BE A LIE OF OMISSION, and §5.3 recorded it: this
 * seam was ORPHANED. Nothing imported it. The store and six screens and
 * components read `data/demo.ts` directly, so swapping the source would have
 * changed nothing anybody could see — the app worked, which is exactly why
 * nobody noticed. There is now one reader, `data/live.ts`, and everything else
 * reads that.
 */

import {
  ACTIVITIES,
  COMPANIES,
  CONTACTS,
  DEALS,
  FOLLOWUPS,
  HISTORY,
  MANAGER,
  NOW,
  REPS,
  STAGES,
} from "./demo.ts";
import type {
  Activity,
  ClosedDeal,
  Company,
  Contact,
  Deal,
  FollowUp,
  Rep,
  Stage,
} from "./types.ts";

export interface DataSource {
  /** The clock the whole app runs on. Pinned in demo mode, real when connected. */
  now(): Date;
  stages(): Stage[];
  reps(): Rep[];
  manager(): Rep;
  companies(): Company[];
  contacts(): Contact[];
  deals(): Deal[];
  history(): ClosedDeal[];
  followUps(): FollowUp[];
  activities(): Activity[];
}

/**
 * Arrays are copied on the way out. A caller that mutates what it is given
 * cannot reach back into the seed, which is what lets the demo reset cleanly.
 */
export const demoSource: DataSource = {
  now: () => new Date(NOW),
  stages: () => STAGES.map((s) => ({ ...s })),
  reps: () => REPS.map((r) => ({ ...r })),
  manager: () => ({ ...MANAGER }),
  companies: () => COMPANIES.map((c) => ({ ...c })),
  contacts: () => CONTACTS.map((c) => ({ ...c })),
  deals: () => DEALS.map((d) => ({ ...d })),
  history: () => HISTORY.map((h) => ({ ...h })),
  followUps: () => FOLLOWUPS.map((f) => ({ ...f })),
  activities: () => ACTIVITIES.map((a) => ({ ...a })),
};

let current: DataSource = demoSource;
let read = false;

/**
 * The source the app is currently wired to.
 *
 * An indirection rather than a re-export, because `data/live.ts` reads it at
 * MODULE SCOPE — a re-exported binding would be captured at import time and a
 * later swap would change nothing.
 */
export const source: DataSource = {
  now: () => ((read = true), current.now()),
  stages: () => ((read = true), current.stages()),
  reps: () => ((read = true), current.reps()),
  manager: () => ((read = true), current.manager()),
  companies: () => ((read = true), current.companies()),
  contacts: () => ((read = true), current.contacts()),
  deals: () => ((read = true), current.deals()),
  history: () => ((read = true), current.history()),
  followUps: () => ((read = true), current.followUps()),
  activities: () => ((read = true), current.activities()),
};

/**
 * Swap the backing source. Must happen before any module-scope read.
 *
 * The tripwire is the whole reason this is a function and not an assignment:
 * the ordering it depends on is invisible, and getting it wrong fails SILENTLY
 * — the app renders demo data against a configured backend and looks fine. A
 * thrown error at boot is the only way that mistake announces itself.
 */
export function setDataSource(next: DataSource): void {
  if (read) {
    throw new Error(
      "setDataSource() called after the app already read — import App dynamically, after the snapshot resolves.",
    );
  }
  current = next;
}

/**
 * True once a real backend is behind the seam.
 *
 * Read by the demo dock, which resets the pipeline and advances the clock:
 * against real deals those controls either lie or do damage, so it does not
 * render.
 */
export function isConnected(): boolean {
  return current !== demoSource;
}
