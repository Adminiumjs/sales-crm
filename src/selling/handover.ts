/**
 * Whether a deal's hand-over carries the old owner's visits not yet made
 * (plan 68 R1c). The manifest's `handOver.carries` says it; the hand-over
 * sheet says it to the person. Adminium 0.3.35 places each carried visit
 * under its time slot's lock, and a clash of the new owner's refuses the
 * hand-over; `src/testing/states.test.ts` holds this equal to the manifest.
 */
export const HAND_OVER_CARRIES_VISITS = true;
