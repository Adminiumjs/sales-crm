/**
 * The app's domain types.
 *
 * `View` is the routing union: `app/App.tsx` maps every member to a screen, so
 * adding a view here is a compile error until a screen exists for it. That is
 * what keeps every nav item, sheet link and footer link landing somewhere real.
 */

export type View =
  | "today"
  | "board"
  | "deal"
  | "companies"
  | "company"
  | "contacts"
  | "manager"
  | "notfound";

export type Persona = "rep" | "manager";

/** The five pipeline stages, in order. `odds` is the weighting factor. */
export type StageId =
  | "discovery"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "verbal";

export interface Stage {
  id: StageId;
  /** i18n key for the stage's display label. */
  label: string;
  odds: number;
}

export interface Rep {
  id: string;
  name: string;
  first: string;
  ini: string;
  /** i18n key for the role line. */
  role: string;
  tint: string;
}

export interface Company {
  id: string;
  /** A brand name — a proper noun, never translated. */
  name: string;
  ini: string;
  /** i18n key. */
  sector: string;
  /** Headcount, rendered through the locale's number formatter. */
  headcount: number;
  city: string;
  tint: string;
  icon: string;
  file: string;
  /** i18n key for the "customer since"/"in conversation since" line. */
  since: string;
  /** i18n key for the free-text note. */
  note: string;
}

export interface Contact {
  id: string;
  name: string;
  ini: string;
  /** i18n key. */
  role: string;
  co: string;
  email: string;
  phone: string;
}

export interface Deal {
  id: string;
  /** i18n key for the deal name. */
  name: string;
  co: string;
  amount: number;
  stage: StageId;
  owner: string;
  /** ISO date the deal was opened. */
  opened: string;
  /** ISO date the deal entered its current stage. */
  since: string;
  /** ISO date the deal is expected to close. */
  close: string;
  /** i18n key for the scope line. */
  scope: string;
  main: string;
}

export interface ClosedDeal {
  id: string;
  name: string;
  co: string;
  amount: number;
  owner: string;
  opened: string;
  closed: string;
  won: boolean;
  /** i18n key; only present when `won` is false. */
  reason?: string;
}

export interface FollowUp {
  id: string;
  deal: string;
  /** `YYYY-MM-DD HH:mm`, read against the pinned clock. */
  due: string;
  /** i18n key for the follow-up text. */
  text: string;
}

export type ActivityType = "call" | "email" | "meeting" | "note" | "stage";

export interface Activity {
  id: string;
  deal: string;
  type: ActivityType;
  /** `YYYY-MM-DD HH:mm`. */
  at: string;
  who: string;
  /** i18n key for the activity body. */
  text: string;
}

/** A follow-up that has been pushed forward by the outcome popover. */
export type FollowUpOutcome = "done" | "day" | "week";

export interface Toast {
  id: number;
  /** Already-resolved text — toasts are raised from the store, post-`t()`. */
  text: string;
  tone: "pos" | "danger" | "info";
}
