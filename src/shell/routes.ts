/**
 * THE APP'S OWN TABLE OF SCREENS, and each role's menu as the design draws it.
 *
 * A screen names the part it belongs to and the tables it cannot be drawn
 * without. It is offered to a person when all three hold:
 *
 *  1. the screen is built (it is in `SCREENS`, see `screens.tsx`): the menu
 *     never holds a line that leads nowhere;
 *  2. its part is switched on for this install;
 *  3. the person may read its tables, as the server said when the page opened.
 *
 * The server still decides every read. This table only keeps a line out of
 * the menu when pressing it could not work.
 *
 * A ROLE PICKS THE MENU'S SHAPE AND THE HOME, nothing else. The nine menus
 * below are the design's, group by group and in its order. A person with two
 * of the app's roles gets both menus merged (the first role in `ROLE_ORDER`
 * leads; a screen already listed is not listed twice). A person with none of
 * the app's roles who still opens the app is the install's owner: they get the
 * CRM admin's menu, cut by the same three tests.
 */

export type RoleKey = "admin" | "sales-manager" | "rep" | "account-manager" | "marketer" | "front-desk" | "ops-manager" | "crew" | "read-only";

/** Whose menu leads when a person holds several roles, and whose home they land on. */
export const ROLE_ORDER: readonly RoleKey[] = ["admin", "sales-manager", "rep", "account-manager", "marketer", "front-desk", "ops-manager", "crew", "read-only"];

export type PartId = "selling" | "quotes" | "accounts" | "team" | "inbox" | "showroom" | "jobs" | "aftercare" | "supply" | "fleet";

/** A screen with a line in a menu. Record pages (a deal, a company) are reached from these and are listed in `also`. */
export type RouteKey =
  | "today" | "week" | "visits" | "notifs" | "digest"
  | "team" | "health" | "nudges" | "feed"
  | "pipeline" | "views" | "searches" | "handover" | "quotes" | "approvals" | "archive" | "lost"
  | "companies" | "contacts" | "referrals" | "renewals" | "repeat" | "map" | "import"
  | "inbox" | "leads"
  | "messages" | "targets" | "meeting" | "notes" | "coaching" | "onboarding" | "patch"
  | "appsettings"
  | "amhome" | "mkhome"
  | "stock" | "suppliers"
  | "aftercare" | "feedback" | "complaints" | "claims"
  /** Showroom and samples (stage 2, P19): the front desk's home and the five screens of the part. */
  | "deskhome" | "showroom" | "showfollow" | "samples" | "returns" | "floor"
  /** Jobs on site, the office side (P20) and the route (P21); the operations manager's home. */
  | "ophome" | "deliveries" | "daysheet" | "route" | "signoff" | "dnotes" | "snags" | "waste"
  /** Settings for the operations manager, who keeps the crews and writes no setting: the Settings screen, its Crews tab alone. */
  | "crews"
  /** The field crew's phone (P22): his day, a job signed off from one of its visits, and his crew's snags. */
  | "myday" | "crewsign" | "mysnags"
  /** One deal: its room, its comments, its call notes. In no menu: it is reached from a card, a row, a link. */
  | "deal"
  /** A person's own: reached from their name at the top, whatever their role. */
  | "me" | "mydetails";

export interface RouteDef {
  /** The address under the app's base: `today`, `pipeline`. A record page adds to it: `pipeline/12`. */
  path: string;
  /** Null for a screen of no part (a person's own notices). */
  part: PartId | null;
  /** The tables the screen cannot be drawn without, by the app's short names. */
  reads: readonly string[];
  /** A lucide icon's name. */
  icon: string;
}

export const ROUTES: Record<RouteKey, RouteDef> = {
  today: { path: "today", part: "selling", reads: ["deals", "follow_ups"], icon: "sun" },
  week: { path: "week", part: "selling", reads: ["deals"], icon: "calendar-range" },
  visits: { path: "visits", part: "selling", reads: ["site_visits"], icon: "map-pin" },
  notifs: { path: "notifications", part: null, reads: [], icon: "bell-ring" },
  digest: { path: "digest", part: null, reads: [], icon: "mail" },
  team: { path: "team", part: "selling", reads: ["deals", "reps"], icon: "users" },
  health: { path: "stage-health", part: "selling", reads: ["deals", "stages"], icon: "activity" },
  nudges: { path: "nudges", part: "selling", reads: ["deals", "nudge_snoozes"], icon: "bell" },
  feed: { path: "activity", part: "selling", reads: ["activities"], icon: "history" },
  pipeline: { path: "pipeline", part: "selling", reads: ["deals", "stages"], icon: "columns-3" },
  views: { path: "saved-views", part: "selling", reads: ["saved_views"], icon: "bookmark" },
  searches: { path: "saved-searches", part: "selling", reads: ["saved_searches"], icon: "search" },
  handover: { path: "hand-over", part: "selling", reads: ["deals"], icon: "arrow-right-left" },
  quotes: { path: "quotes", part: "quotes", reads: ["quotes"], icon: "file-text" },
  approvals: { path: "approvals", part: "quotes", reads: ["quotes"], icon: "stamp" },
  archive: { path: "closed", part: "selling", reads: ["deals"], icon: "folder-clock" },
  lost: { path: "why-we-lose", part: "selling", reads: ["deals", "lost_reasons"], icon: "circle-slash" },
  companies: { path: "companies", part: "accounts", reads: ["companies"], icon: "building-2" },
  contacts: { path: "contacts", part: "accounts", reads: ["contacts"], icon: "contact" },
  referrals: { path: "referrals", part: "accounts", reads: ["referrals"], icon: "heart-handshake" },
  renewals: { path: "renewals", part: "accounts", reads: ["renewals"], icon: "repeat" },
  repeat: { path: "repeat-orders", part: "accounts", reads: ["companies", "deals"], icon: "rotate-cw" },
  map: { path: "territory", part: "accounts", reads: ["territories", "companies"], icon: "map" },
  import: { path: "paste-a-list", part: "accounts", reads: ["companies"], icon: "clipboard-list" },
  inbox: { path: "inbox", part: "inbox", reads: ["enquiries"], icon: "inbox" },
  leads: { path: "trade-show-leads", part: "inbox", reads: ["enquiries", "shows"], icon: "tent" },
  messages: { path: "messages", part: "team", reads: ["threads", "messages"], icon: "send" },
  targets: { path: "targets", part: "team", reads: ["targets"], icon: "target" },
  meeting: { path: "weekly-meeting", part: "team", reads: ["meetings"], icon: "calendar-clock" },
  notes: { path: "one-to-ones", part: "team", reads: ["one_to_ones"], icon: "notebook-pen" },
  coaching: { path: "coaching", part: "team", reads: ["coaching_plans"], icon: "graduation-cap" },
  onboarding: { path: "new-starter", part: "team", reads: ["starters"], icon: "user-round-plus" },
  patch: { path: "cover", part: "team", reads: ["covers"], icon: "plane" },
  appsettings: { path: "settings", part: null, reads: ["settings"], icon: "settings" },
  amhome: { path: "home", part: "accounts", reads: ["companies", "renewals"], icon: "house" },
  mkhome: { path: "home", part: "inbox", reads: ["enquiries", "shows"], icon: "house" },
  // Supply reads the Inventory add-on's own tables, named `inventory:<its table>` (see `staffSession.ts`).
  stock: { path: "stock", part: "supply", reads: ["deal_stock_needs", "inventory:items"], icon: "package" },
  suppliers: { path: "suppliers", part: "supply", reads: ["inventory:suppliers"], icon: "factory" },
  // After the job. An aftercare call is a follow-up of its own kind, on a job: without the jobs it is about there is nothing to ring for.
  aftercare: { path: "aftercare-calls", part: "aftercare", reads: ["follow_ups", "jobs"], icon: "phone-call" },
  feedback: { path: "what-customers-said", part: "aftercare", reads: ["feedback"], icon: "star" },
  complaints: { path: "complaints", part: "aftercare", reads: ["complaints"], icon: "frown" },
  claims: { path: "warranty-claims", part: "aftercare", reads: ["warranty_claims"], icon: "shield-check" },
  deskhome: { path: "home", part: "showroom", reads: ["showroom_bookings", "sample_loans"], icon: "house" },
  showroom: { path: "showroom", part: "showroom", reads: ["showroom_bookings", "showroom_spaces"], icon: "store" },
  showfollow: { path: "showroom-follow-ups", part: "showroom", reads: ["showroom_bookings"], icon: "corner-down-right" },
  samples: { path: "samples", part: "showroom", reads: ["samples", "sample_loans"], icon: "layers" },
  returns: { path: "sample-returns", part: "showroom", reads: ["sample_loans"], icon: "phone" },
  floor: { path: "display-stock", part: "showroom", reads: ["display_pieces", "showroom_spaces"], icon: "armchair" },
  ophome: { path: "home", part: "jobs", reads: ["job_visits", "snags"], icon: "house" },
  deliveries: { path: "deliveries", part: "jobs", reads: ["job_visits", "crews"], icon: "truck" },
  daysheet: { path: "day-sheet", part: "jobs", reads: ["job_visits", "crews"], icon: "notebook-tabs" },
  route: { path: "route", part: "jobs", reads: ["job_visits", "crews", "jobs"], icon: "route" },
  signoff: { path: "sign-off", part: "jobs", reads: ["jobs", "sign_offs", "snags"], icon: "clipboard-check" },
  dnotes: { path: "delivery-notes", part: "jobs", reads: ["delivery_notes", "delivery_note_lines"], icon: "clipboard-list" },
  snags: { path: "snags", part: "jobs", reads: ["snags", "jobs"], icon: "wrench" },
  waste: { path: "recycling", part: "jobs", reads: ["waste_removals"], icon: "recycle" },
  crews: { path: "settings", part: "jobs", reads: ["crews"], icon: "settings" },
  myday: { path: "my-day", part: "jobs", reads: ["job_visits", "crews", "crew_members"], icon: "sun" },
  crewsign: { path: "sign-off-the-job", part: "jobs", reads: ["job_visits", "sign_offs", "snags"], icon: "clipboard-check" },
  mysnags: { path: "my-snags", part: "jobs", reads: ["snags"], icon: "wrench" },
  deal: { path: "deals", part: "selling", reads: ["deals"], icon: "columns-3" },
  me: { path: "me", part: null, reads: [], icon: "user-round" },
  mydetails: { path: "my-details", part: null, reads: [], icon: "settings" },
};

/**
 * A PERSON'S OWN SCREENS: their profile, their details, how they are told,
 * their weekly summary. Everybody's, whatever their role, so none of them is
 * "not part of your role"; the first three are in the menu under the person's
 * name at the top. What each one shows is cut to the person's roles and parts
 * by the screen itself, from what the server answers them.
 */
export const OWN: readonly RouteKey[] = ["me", "mydetails", "notifs", "digest"];
/** The lines under the person's name, in the design's order. */
export const USER_MENU: readonly RouteKey[] = ["me", "mydetails", "notifs"];

/** A record page lights the menu line it was reached from: the first of these the person's menu holds. */
export const LIT_BY: Partial<Record<RouteKey, readonly RouteKey[]>> = { deal: ["pipeline", "archive"], crewsign: ["myday", "mysnags"] };

/** The groups of a menu, in the design's words. `top` has no heading. */
export type GroupKey = "top" | "selling" | "accounts" | "customers" | "wonWork" | "inbox" | "showroom" | "jobs" | "supply" | "team" | "settings" | "aftercare";

/** One line of a menu: the screen, and the words it goes by in THIS role's menu ("My targets" for a rep, "Team targets" for her manager). */
export interface MenuItem {
  route: RouteKey;
  /** The label's key under `nav.item.`; the route's own key unless the role calls the screen something else. */
  label: string;
}
export type MenuGroup = readonly [GroupKey, readonly MenuItem[]];

const it = (route: RouteKey, label: string = route): MenuItem => ({ route, label });

const TOP_TEAM: MenuGroup = ["top", [it("team"), it("health"), it("nudges"), it("notifs"), it("feed"), it("digest")]];
const SELL_TEAM: MenuGroup = ["selling", [it("pipeline", "teamBoard"), it("week"), it("visits"), it("views"), it("searches"), it("handover"), it("quotes"), it("approvals"), it("archive"), it("lost")]];
const ACCOUNTS_FULL: MenuGroup = ["accounts", [it("companies"), it("contacts"), it("referrals"), it("renewals"), it("repeat"), it("map"), it("import")]];
const INBOX_FULL: MenuGroup = ["inbox", [it("inbox"), it("leads")]];
const SUPPLY: MenuGroup = ["supply", [it("stock"), it("suppliers")]];
const AFTER_THE_JOB: MenuGroup = ["aftercare", [it("aftercare"), it("feedback"), it("complaints"), it("claims")]];
const SHOWROOM: MenuGroup = ["showroom", [it("showroom"), it("showfollow"), it("samples"), it("returns"), it("floor")]];
const JOBS: MenuGroup = ["jobs", [it("deliveries"), it("daysheet"), it("route"), it("signoff"), it("dnotes"), it("snags"), it("waste")]];
const without = (group: MenuGroup, routes: readonly RouteKey[]): MenuGroup => [group[0], group[1].filter((item) => !routes.includes(item.route))];

/**
 * The nine menus. The groups a later stage brings (Showroom and samples, Jobs
 * on site, After the job, Vehicles and crew) are in them with that stage's
 * screens, and a line shows only while its part is on: at stage 1 the
 * operations manager and the front desk have nothing but Supply or the Inbox,
 * and the field crew nothing at all.
 */
export const MENUS: Record<RoleKey, readonly MenuGroup[]> = {
  rep: [
    ["top", [it("today"), it("week"), it("visits"), it("notifs"), it("digest")]],
    ["selling", [it("pipeline"), it("views"), it("searches"), it("handover"), it("quotes"), it("archive")]],
    ["accounts", [it("companies"), it("contacts"), it("map"), it("import")]],
    ["inbox", [it("inbox")]],
    ["team", [it("messages"), it("targets", "myTargets"), it("meeting"), it("notes", "myNotes"), it("coaching", "myCoaching"), it("patch")]],
  ],
  "sales-manager": [
    TOP_TEAM,
    SELL_TEAM,
    without(ACCOUNTS_FULL, ["referrals", "renewals", "repeat"]),
    ["inbox", [it("inbox")]],
    ["team", [it("messages"), it("targets", "teamTargets"), it("meeting"), it("notes"), it("coaching"), it("onboarding"), it("patch")]],
    ["settings", [it("appsettings")]],
  ],
  admin: [
    without(TOP_TEAM, ["nudges"]),
    SELL_TEAM,
    without(ACCOUNTS_FULL, ["import"]),
    INBOX_FULL,
    SHOWROOM,
    JOBS,
    AFTER_THE_JOB,
    SUPPLY,
    ["team", [it("messages"), it("targets", "teamTargets"), it("meeting")]],
    ["settings", [it("appsettings"), it("nudges", "nudgeRules"), it("import"), it("onboarding"), it("patch")]],
  ],
  // "Deals I am on" joins this menu with stage 2: until then he reads a deal only once it is won (ruling R6), and an open-deals board would always be empty for him.
  "account-manager": [
    ["top", [it("amhome", "home")]],
    ["customers", [it("renewals"), it("repeat"), it("referrals")]],
    AFTER_THE_JOB,
    ["wonWork", [it("archive", "wonDeals")]],
    ["accounts", [it("companies"), it("contacts")]],
  ],
  marketer: [
    ["top", [it("mkhome", "home")]],
    ["inbox", [it("leads")]],
    ["accounts", [it("companies"), it("contacts")]],
  ],
  "front-desk": [["top", [it("deskhome", "home")]], SHOWROOM, ["inbox", [it("inbox")]]],
  // The design's sixteen, less what a later stage brings (Vehicles and crew), and a Settings line for the crews, their people
  // and their days (P3): a crew is set up there, by her.
  "ops-manager": [["top", [it("ophome", "home")]], JOBS, SUPPLY, ["settings", [it("crews", "appsettings")]]],
  // The design's four, less what stage 3 brings (My hours, My certificates: Vehicles and crew).
  crew: [["top", [it("myday"), it("mysnags")]]],
  "read-only": [
    without(TOP_TEAM, ["nudges"]),
    without(SELL_TEAM, ["handover"]),
    without(ACCOUNTS_FULL, ["import"]),
    INBOX_FULL,
    SHOWROOM,
    JOBS,
    AFTER_THE_JOB,
    SUPPLY,
    ["team", [it("targets", "teamTargets"), it("meeting")]],
    // The design gives Read-only no Settings group. She reads every setting and presses nothing (P15); with no line she had no way to the page.
    ["settings", [it("appsettings")]],
  ],
};

/** Where each role lands. A role whose home cannot be opened lands on the first line of its menu that can. */
export const HOMES: Record<RoleKey, RouteKey | null> = {
  admin: "team",
  "sales-manager": "team",
  rep: "today",
  "account-manager": "amhome",
  marketer: "mkhome",
  "front-desk": "deskhome",
  "ops-manager": "ophome",
  crew: "myday",
  "read-only": "team",
};

/**
 * A PART BUILT ON AN ADD-ON, and the add-on it waits for. While that add-on is
 * not connected to this app (never connected, or switched off for it), the
 * part is off and its tables are not the app's to read. Its lines then stay
 * in the menus of the roles it is for, and each opens a page that says what
 * it waits for and who connects it, instead of leaving without a word.
 */
export const WAITS_FOR: Partial<Record<PartId, string>> = { supply: "inventory" };

/** A person's menu depends on these and on nothing else. */
export interface MenuFacts {
  /** The app's roles the person holds, as slugs: `crm-rep`. */
  roles: readonly string[];
  part: (id: PartId) => boolean;
  /** Whether a part is off only because the add-on it is built on is not connected to the app (`WAITS_FOR`). */
  waits?: (id: PartId) => boolean;
  reads: (table: string) => boolean;
  /** Whether a screen exists for a route yet. */
  built: (route: RouteKey) => boolean;
}

export interface ShownGroup {
  group: GroupKey;
  items: MenuItem[];
}

/** The app's roles a person holds, in the order that says whose menu leads. The install's owner holds none and is read as the CRM admin. */
export function rolesOf(slugs: readonly string[]): RoleKey[] {
  const held = ROLE_ORDER.filter((role) => slugs.includes(`crm-${role}`));
  return held.length === 0 ? ["admin"] : held;
}

/** Whether a screen can be offered to this person. A screen of a part that waits for its add-on is: it says so. */
export function canOpen(route: RouteKey, facts: MenuFacts): boolean {
  const def = ROUTES[route];
  if (!facts.built(route)) return false;
  if (def.part !== null && !facts.part(def.part)) return facts.waits?.(def.part) === true;
  return def.reads.every((table) => facts.reads(table));
}

/** Whether a part waits for its add-on, from what the server told the page: the part is off and its add-on is not attached here. */
export function waitsFor(part: PartId, on: boolean, attached: (addOn: string) => boolean): boolean {
  const addOn = WAITS_FOR[part];
  return addOn !== undefined && !on && !attached(addOn);
}

/**
 * Whether one of the person's roles holds this screen in its menu. A screen
 * is a role's or it is not: a rep reads her own deals, and the Team view is
 * still not hers. The address of a screen no role of the person lists says
 * "not part of your role", whatever tables they read. (What the server
 * refuses is a separate matter, and is the server's.)
 */
/**
 * Screens somebody reaches by a link and not from their menu, where the design gives their role no line for it:
 * a new starter's own steps (a rep's), and Cover for whoever only reads it. What they may read there is the
 * server's to say, as everywhere.
 */
const BY_LINK: ReadonlySet<RouteKey> = new Set<RouteKey>(["onboarding", "patch"]);

export function inMenu(route: RouteKey, slugs: readonly string[]): boolean {
  if (BY_LINK.has(route)) return true;
  // A screen reached from another and not from the menu (a deal's room, from the board or from Closed) is a role's when the screen it is reached from is.
  if (OWN.includes(route)) return true;
  const held = [route, ...(LIT_BY[route] ?? [])];
  return rolesOf(slugs).some((role) => MENUS[role].some(([, items]) => items.some((item) => held.includes(item.route))));
}

/** The person's menu: their roles' menus merged, less what they cannot open. A group left with nothing is dropped. */
export function menuFor(facts: MenuFacts): ShownGroup[] {
  const out: ShownGroup[] = [];
  const listed = new Set<RouteKey>();
  for (const role of rolesOf(facts.roles)) {
    for (const [group, items] of MENUS[role]) {
      const fresh = items.filter((item) => !listed.has(item.route) && canOpen(item.route, facts));
      if (fresh.length === 0) continue;
      for (const item of fresh) listed.add(item.route);
      const there = out.find((one) => one.group === group);
      if (there === undefined) out.push({ group, items: [...fresh] });
      else there.items.push(...fresh);
    }
  }
  return out;
}

/** Where the person lands: their leading role's home when they can open it, else the first line of their menu, else nowhere. */
export function homeFor(facts: MenuFacts): RouteKey | null {
  for (const role of rolesOf(facts.roles)) {
    const home = HOMES[role];
    if (home !== null && canOpen(home, facts)) return home;
  }
  return menuFor(facts)[0]?.items[0]?.route ?? null;
}

/** The screen an address under the app's base names, with what follows it (`pipeline/12` → `pipeline`, `["12"]`). Two homes share an address: the person's own is theirs. */
export function routeForPath(path: string, facts: MenuFacts): { route: RouteKey; rest: string[] } | null {
  const parts = path.split("/").filter((part) => part !== "");
  if (parts.length === 0) return null;
  const candidates = (Object.keys(ROUTES) as RouteKey[]).filter((key) => ROUTES[key].path === parts[0]);
  if (candidates.length === 0) return null;
  const route = candidates.find((key) => canOpen(key, facts) && inMenu(key, facts.roles)) ?? candidates.find((key) => canOpen(key, facts)) ?? candidates[0]!;
  return { route, rest: parts.slice(1) };
}
