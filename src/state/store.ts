/**
 * The app's single store.
 *
 * Deliberately one zustand store rather than several: the board, the Today
 * queue and the deal room all read the same deal list, and splitting them
 * would mean keeping three copies in step. Everything derived — column
 * subtotals, weighted forecasts, staleness — is computed in `lib/pipeline.ts`
 * at render time from what lives here, never stored.
 *
 * The seed is copied into state on creation so the demo can be reset without
 * reloading the page, and so `data/demo.ts` stays an immutable description of
 * the fiction rather than mutable app state.
 */

import { create } from "zustand";

import {
  ACTIVITIES,
  DEALS,
  FOLLOWUPS,
  HISTORY,
  MANAGER,
  NOW,
  REPS,
  STAGES,
} from "../data/demo.ts";
import type {
  Activity,
  ClosedDeal,
  Deal,
  FollowUp,
  FollowUpOutcome,
  Persona,
  Rep,
  StageId,
  Toast,
  View,
} from "../data/types.ts";
import { t } from "../i18n/ambient.ts";
import { label } from "../lib/format.ts";
import { parseAt, pushDue, stageById } from "../lib/pipeline.ts";

const THEME_KEY = "sales-crm-theme";

export type Theme = "light" | "dark";

/** How a timestamp is written back into the seed's `YYYY-MM-DD HH:mm` shape. */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface State {
  /* --- routing + persona --- */
  view: View;
  persona: Persona;
  /** Which deal the deal room is showing. */
  dealId: string | null;
  /** Which company the company profile is showing. */
  companyId: string | null;

  /* --- chrome --- */
  theme: Theme;
  navOpen: boolean;
  searchOpen: boolean;
  search: string;
  dockOpen: boolean;
  /** True while any overlay owns the bottom corner, so the dock steps aside. */
  overlayOpen: boolean;

  /* --- data --- */
  deals: Deal[];
  history: ClosedDeal[];
  followUps: FollowUp[];
  activities: Activity[];
  doneFollowUps: string[];

  /* --- transient UI --- */
  toasts: Toast[];
  /** Which follow-up's outcome popover is open. */
  outcomeFor: string | null;
  /** Which deal the close dialog is for. */
  closingId: string | null;
  /** The card menu that is open, if any. */
  menuFor: string | null;
  /** Manager board's rep filter; `all` or a rep id. */
  repFilter: string;
  companyQuery: string;
  contactQuery: string;

  /* --- actions --- */
  go: (view: View) => void;
  openDeal: (id: string) => void;
  openCompany: (id: string) => void;
  setPersona: (p: Persona) => void;
  initTheme: () => void;
  toggleTheme: () => void;
  setNavOpen: (open: boolean) => void;
  setSearch: (q: string) => void;
  setSearchOpen: (open: boolean) => void;
  setDockOpen: (open: boolean) => void;
  setCompanyQuery: (q: string) => void;
  setContactQuery: (q: string) => void;
  setRepFilter: (id: string) => void;

  moveStage: (dealId: string, stage: StageId) => void;
  setAmount: (dealId: string, amount: number) => void;
  closeDeal: (dealId: string, won: boolean, reason?: string) => void;
  openCloseDialog: (dealId: string | null) => void;
  openMenu: (dealId: string | null) => void;

  openOutcome: (followUpId: string | null) => void;
  resolveFollowUp: (followUpId: string, outcome: FollowUpOutcome) => void;

  logActivity: (
    dealId: string,
    type: Activity["type"],
    text: string,
    asNextStep: boolean,
  ) => void;

  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  escape: () => void;
  reset: () => void;
}

/** The signed-in person for the current persona. */
export function currentUser(persona: Persona): Rep {
  return persona === "manager" ? MANAGER : REPS[0];
}

let toastSeq = 0;
let activitySeq = 0;
let followUpSeq = 0;

export const useStore = create<State>((set, get) => ({
  view: "today",
  persona: "rep",
  dealId: null,
  companyId: null,

  theme: "light",
  navOpen: false,
  searchOpen: false,
  search: "",
  dockOpen: true,
  overlayOpen: false,

  deals: DEALS.map((d) => ({ ...d })),
  history: HISTORY.map((h) => ({ ...h })),
  followUps: FOLLOWUPS.map((f) => ({ ...f })),
  activities: ACTIVITIES.map((a) => ({ ...a })),
  doneFollowUps: [],

  toasts: [],
  outcomeFor: null,
  closingId: null,
  menuFor: null,
  repFilter: "all",
  companyQuery: "",
  contactQuery: "",

  /**
   * Every view change scrolls back to the top (house layout rule 3) and closes
   * the mobile nav, so a reader arriving at a deal lands on its header rather
   * than halfway down the previous screen.
   */
  go: (view) => {
    set({ view, navOpen: false, searchOpen: false, menuFor: null });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  openDeal: (id) => {
    set({ view: "deal", dealId: id, navOpen: false, menuFor: null, searchOpen: false });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  openCompany: (id) => {
    set({ view: "company", companyId: id, navOpen: false, searchOpen: false });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  /*
   * Switching persona lands on that persona's home view rather than keeping
   * the current one: a manager arriving on the rep's Today queue would be
   * looking at someone else's day.
   */
  setPersona: (persona) => {
    set({
      persona,
      view: persona === "manager" ? "manager" : "today",
      navOpen: false,
      menuFor: null,
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  initTheme: () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      // Storage disabled — fall back to the OS preference.
    }
    const prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme: Theme = stored === "dark" || stored === "light" ? stored : prefersDark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    set({ theme });
  },

  toggleTheme: () => {
    const theme: Theme = get().theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not remembering the choice is not a reason to refuse it.
    }
    set({ theme });
  },

  setNavOpen: (navOpen) => set({ navOpen, overlayOpen: navOpen }),
  setSearch: (search) => set({ search }),
  setSearchOpen: (searchOpen) => set({ searchOpen, search: searchOpen ? get().search : "" }),
  setDockOpen: (dockOpen) => set({ dockOpen }),
  setCompanyQuery: (companyQuery) => set({ companyQuery }),
  setContactQuery: (contactQuery) => set({ contactQuery }),
  setRepFilter: (repFilter) => set({ repFilter }),

  /**
   * Moving a card also stamps a `stage` activity and resets the stage clock,
   * so the deal's age and its timeline agree with each other afterwards.
   */
  moveStage: (dealId, stage) => {
    const { deals } = get();
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage === stage) {
      set({ menuFor: null });
      return;
    }

    const now = new Date(NOW);
    set({
      deals: deals.map((d) =>
        d.id === dealId ? { ...d, stage, since: stamp(now).slice(0, 10) } : d,
      ),
      menuFor: null,
    });

    get().toast(
      t("chrome.toast.stageMoved", {
        deal: label(deal.name),
        stage: label(stageById(STAGES, stage).label),
      }),
      "info",
    );
  },

  setAmount: (dealId, amount) => {
    if (!Number.isFinite(amount) || amount < 0) return;
    set({
      deals: get().deals.map((d) =>
        d.id === dealId ? { ...d, amount: Math.round(amount) } : d,
      ),
    });
    get().toast(t("chrome.toast.amountSaved"), "pos");
  },

  /**
   * Closing moves the deal out of `deals` and into `history`, which is what
   * makes the win rate and average cycle on the manager view move with it —
   * they are computed from the same list.
   */
  closeDeal: (dealId, won, reason) => {
    const { deals, history, followUps } = get();
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;

    const closed: ClosedDeal = {
      id: deal.id,
      name: deal.name,
      co: deal.co,
      amount: deal.amount,
      owner: deal.owner,
      opened: deal.opened,
      closed: stamp(new Date(NOW)).slice(0, 10),
      won,
      ...(won ? {} : { reason }),
    };

    set({
      deals: deals.filter((d) => d.id !== dealId),
      history: [closed, ...history],
      // A closed deal's follow-ups are not work any more.
      followUps: followUps.filter((f) => f.deal !== dealId),
      closingId: null,
      menuFor: null,
      overlayOpen: false,
      view: get().view === "deal" ? "board" : get().view,
    });

    get().toast(
      won
        ? t("chrome.toast.won", { deal: label(deal.name) })
        : t("chrome.toast.lost", { deal: label(deal.name) }),
      won ? "pos" : "danger",
    );
  },

  openCloseDialog: (closingId) =>
    set({ closingId, overlayOpen: closingId !== null, menuFor: null }),

  openMenu: (menuFor) => set({ menuFor }),

  openOutcome: (outcomeFor) => set({ outcomeFor }),

  /**
   * "Done" retires the row; a push rewrites its due date, which re-sorts the
   * queue on the next render because the queue reads due dates rather than a
   * stored order.
   */
  resolveFollowUp: (followUpId, outcome) => {
    if (outcome === "done") {
      set({
        doneFollowUps: [...get().doneFollowUps, followUpId],
        outcomeFor: null,
      });
      get().toast(t("chrome.toast.followUpDone"), "pos");
      return;
    }

    const by = outcome === "day" ? "day" : "week";
    set({
      followUps: get().followUps.map((f) =>
        f.id === followUpId ? { ...f, due: stamp(pushDue(parseAt(f.due), by)) } : f,
      ),
      outcomeFor: null,
    });
    get().toast(
      t(by === "day" ? "chrome.toast.pushedDay" : "chrome.toast.pushedWeek"),
      "info",
    );
  },

  /**
   * The composer writes literal text, not a key, so `format.label()` returning
   * the input unchanged for an unknown key is what renders it. That is the
   * deliberate seam between translated fiction and things the reader typed.
   */
  logActivity: (dealId, type, text, asNextStep) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    activitySeq += 1;
    const now = new Date(NOW);
    const activity: Activity = {
      id: `new-a${activitySeq}`,
      deal: dealId,
      type,
      at: stamp(now),
      who: currentUser(get().persona).id,
      text: trimmed,
    };

    const patch: Partial<State> = { activities: [activity, ...get().activities] };

    if (asNextStep) {
      followUpSeq += 1;
      const due = new Date(now);
      due.setDate(due.getDate() + 1);
      due.setHours(9, 30, 0, 0);
      patch.followUps = [
        ...get().followUps,
        {
          id: `new-f${followUpSeq}`,
          deal: dealId,
          due: stamp(due),
          text: trimmed,
        },
      ];
    }

    set(patch);
    get().toast(
      t(asNextStep ? "chrome.toast.nextStep" : "chrome.toast.logged"),
      "pos",
    );
  },

  toast: (text, tone = "info") => {
    toastSeq += 1;
    const id = toastSeq;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    window.setTimeout(() => get().dismissToast(id), 3600);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),

  /**
   * The document-level Escape handler. Overlays are closed outermost-first so
   * one press does one thing rather than dismissing the whole stack.
   */
  escape: () => {
    const s = get();
    if (s.closingId !== null) return set({ closingId: null, overlayOpen: false });
    if (s.outcomeFor !== null) return set({ outcomeFor: null });
    if (s.menuFor !== null) return set({ menuFor: null });
    if (s.searchOpen) return set({ searchOpen: false, search: "" });
    if (s.navOpen) return set({ navOpen: false, overlayOpen: false });
  },

  reset: () => {
    set({
      deals: DEALS.map((d) => ({ ...d })),
      history: HISTORY.map((h) => ({ ...h })),
      followUps: FOLLOWUPS.map((f) => ({ ...f })),
      activities: ACTIVITIES.map((a) => ({ ...a })),
      doneFollowUps: [],
      view: get().persona === "manager" ? "manager" : "today",
      dealId: null,
      companyId: null,
      outcomeFor: null,
      closingId: null,
      menuFor: null,
      overlayOpen: false,
      repFilter: "all",
      companyQuery: "",
      contactQuery: "",
      search: "",
    });
    get().toast(t("chrome.toast.reset"), "info");
  },
}));
