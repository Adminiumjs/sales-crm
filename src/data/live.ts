// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data every screen reads, taken from the seam exactly once.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * §5.3 recorded this repo's seam as ORPHANED, and it was: `source.ts` was
 * written and NOTHING imported it. The store and six screens and components
 * reached past it into `data/demo.ts`, so swapping the source would have
 * changed nothing anybody could see. That is the failure the seam exists to
 * prevent and it was invisible because the app worked.
 *
 * So there is now exactly ONE reader of `source`, here, and everything else
 * reads these bindings. Read at module scope, which is what makes the boot
 * ordering in `main.tsx` load-bearing: the swap has to happen before this
 * module is evaluated, and `setDataSource` throws if it does not.
 *
 * Closed vocabularies and presentation tables (`ACTIVITY_TYPE`,
 * `LOST_REASONS`) still come from `demo.ts` — they are code, not rows, and a
 * backend has nothing to say about them.
 */

import { source } from "./source.ts";

/** The clock. Pinned in demo mode; the real instant when connected. */
export const NOW = source.now();

export const STAGES = source.stages();
export const REPS = source.reps();
export const MANAGER = source.manager();
export const COMPANIES = source.companies();
export const CONTACTS = source.contacts();
export const DEALS = source.deals();
export const HISTORY = source.history();
export const FOLLOWUPS = source.followUps();
export const ACTIVITIES = source.activities();
