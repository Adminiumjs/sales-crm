/**
 * Whether a deal's hand-over carries the old owner's visits not yet made
 * (plan 68 R1c). The manifest's `handOver.carries` says it; the hand-over
 * sheet says it to the person. Adminium 0.3.35 refuses a carried row of a
 * table that holds a time slot (`site_visits` has `occupies`), so the visits
 * are not carried yet; `src/testing/states.test.ts` holds this equal to the
 * manifest.
 */
export const HAND_OVER_CARRIES_VISITS = false;
