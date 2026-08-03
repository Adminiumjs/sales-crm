/**
 * The DataSource seam.
 *
 * This app ships in demo mode: every read below returns the seeded fiction in
 * `demo.ts`, synchronously, with no network involved. The seam exists so that
 * pointing the app at a real Adminium deployment is a change to ONE file
 * rather than a rewrite — the screens and the store already talk to this
 * interface and never import `demo.ts` for data they render.
 *
 * When `@adminium/manifest` lands (Phase B), a second implementation of
 * `DataSource` backed by `AdminiumDataSource` slots in here and `demoSource`
 * becomes the fallback used when no `adm_pub_` key is configured.
 */

import {
  ACTIVITIES,
  COMPANIES,
  CONTACTS,
  DEALS,
  FOLLOWUPS,
  HISTORY,
  MANAGER,
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

/** The source the app is currently wired to. */
export const source: DataSource = demoSource;
