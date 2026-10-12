/**
 * The nine roles of `manifest.json`, held to the access matrix.
 *
 * The validator checks that a role is well formed: that a grant names a table
 * the app has, that a limited table says whose its rows are. It does not know
 * who is meant to read what. A sales rep granted every deal validates, and
 * installs. That is checked here.
 *
 * The matrix is written once, as data, at the top: one line per table (or per
 * tables that share a line), one cell per role. Everything below reads it.
 * A change of access is a change of that table first.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../manifest.json";

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE MATRIX                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

/** The role keys, in the order of a matrix line's cells. Each installs as `crm-<key>`. */
const ROLES = ["admin", "sales-manager", "rep", "account-manager", "marketer", "front-desk", "ops-manager", "crew", "read-only"] as const;
type RoleKey = (typeof ROLES)[number];

const NAMES: Record<RoleKey, string> = {
  admin: "CRM admin",
  "sales-manager": "Sales manager",
  rep: "Sales rep",
  "account-manager": "Account manager",
  marketer: "Marketer",
  "front-desk": "Front desk",
  "ops-manager": "Operations manager",
  crew: "Field crew",
  "read-only": "Read-only",
};

/**
 * HOW A CELL READS.
 *
 * Letters are the table rights: R read, C create, U update, D delete,
 * X export. `-` is no grant at all.
 *
 * After a colon, the rows every one of the cell's read, update and delete
 * reaches: `own`, `team`, `own+free` and `team+free` (also the rows nobody
 * owns), `won` (every row, only while `state` is `won`). No colon: every row.
 *
 * After a semicolon, one action's own reach, where the actions differ:
 * `r=` read, `u=` update, `d=` delete. `RCUD;r=own+free;u=own;d=own` reads its
 * own rows and the shared ones, and changes only its own.
 *
 * A create is never limited to some rows: a new row is held by the links and
 * the people it names.
 */
const SAVED = "RCUD;r=own+free;u=own;d=own";
/** The four private tables: the manager and the rep of the row, and nobody else. */
const PAIR = ["-", "RCUD:own", "R:own", "-", "-", "-", "-", "-", "-"] as const;
/** Conversations: the four sales roles, each in their own. */
const talk = (cell: string) => [cell, cell, cell, cell, "-", "-", "-", "-", "-"] as const;

//   tables                                      Ad       SM       Rep      AM       Mk   FD   Ops  Cr   RO
const MATRIX: readonly (readonly [readonly string[], ...string[]])[] = [
  [["stages", "lost_reasons"], "RCUD", "R", "R", "R", "-", "-", "-", "-", "R"],
  [["deals"], "RCUDX", "RCUX:team", "RCU:own", "R:won", "-", "-", "-", "-", "RX"],
  [["deal_stage_changes"], "R", "R:team", "R:own", "-", "-", "-", "-", "-", "R"],
  [["activities", "comments"], "RCUD", "RCU:team", "RCU:own", "-", "-", "-", "-", "-", "R"],
  [["follow_ups"], "RCUD", "RCU:team", "RCUD:own", "RCU:own", "-", "-", "-", "-", "R"],
  [["quotes", "quote_lines"], "RCUDX", "RCU:team", "RCU:own", "-", "-", "-", "-", "-", "RX"],
  [["saved_views", "saved_searches"], "RCUD:own+free", "RCUD:own+free", SAVED, SAVED, "-", "-", "-", "-", "R:own+free"],
  [["nudge_snoozes"], "RCD:own", "RCD:own", "RCD:own", "-", "-", "-", "-", "-", "-"],
  [["deal_members"], "RCUD", "RCUD;u=team;d=team", "RCUD;u=own;d=own", "R", "-", "-", "-", "-", "R"],
  [["deal_marks"], "R", "R", "R", "R", "-", "-", "-", "-", "R"],
  [["site_visits", "visit_notes", "visit_agreed"], "RCUD", "RCU:team", "RCUD:own", "-", "-", "-", "-", "-", "R"],
  [["companies"], "RCUDX", "RCUX", "RCU", "RCU", "R", "R", "-", "-", "RX"],
  [["contacts"], "RCUDX", "RCUX", "RCU", "RCU", "R", "RC", "-", "-", "RX"],
  [["territories", "territory_places"], "RCUD", "RCUD", "R", "R", "R", "-", "-", "-", "R"],
  [["renewals", "referrals"], "RCUD", "R", "RCU", "RCUD", "-", "-", "-", "-", "R"],
  [["reps"], "RCUD", "RU;u=own", "RU;u=own", "RU;u=own", "-", "-", "-", "-", "R"],
  [["targets"], "RCUD", "RCU:team", "R:own", "-", "-", "-", "-", "-", "R"],
  [["one_to_ones", "one_to_one_sessions", "coaching_plans", "coaching_areas"], ...PAIR],
  [["actions"], "R:own", "RCUD:own", "RCU:own", "-", "-", "-", "-", "-", "-"],
  [["meetings", "meeting_slots", "meeting_decisions"], "RCUD", "RCUD", "R", "-", "-", "-", "-", "-", "R"],
  [["threads"], ...talk("RC:own")],
  [["thread_members"], ...talk("RCU;u=own")],
  [["messages"], ...talk("RC:own")],
  [["starters"], "RCUD", "RCUD", "R", "-", "-", "-", "-", "-", "R"],
  [["starter_steps"], "RCUD", "RCUD", "RU", "-", "-", "-", "-", "-", "R"],
  // NARROWER THAN THE PLAN'S TABLE, which gives the sales manager every cover (RCUD). A cover opens
  // its rep's deals to whoever it names, so a manager who could write one for any rep could read any
  // team's deals by covering for them. They read every cover, and write one for the people they lead.
  [["covers"], "RCUD", "RCUD;u=team;d=team", "R", "R", "-", "-", "-", "-", "R"],
  [["cover_notes"], "RCUD", "RCUD:team", "RCU:own", "-", "-", "-", "-", "-", "R"],
  [["enquiries"], "RCUD", "RCU:team+free", "RCU:own+free", "-", "RC", "RCU:own+free", "-", "-", "R"],
  [["shows"], "RCUD", "R", "R", "-", "RCUD", "R", "-", "-", "R"],
  [["showroom_spaces", "samples", "display_pieces"], "RCUD", "R", "R", "-", "-", "RCUD", "-", "-", "R"],
  [["showroom_bookings", "sample_loans", "sample_chases"], "RCUD", "R", "RCU", "-", "-", "RCUD", "-", "-", "R"],
  [["jobs"], "RCUD", "R:team", "R:own", "R", "-", "-", "RCU", "-", "R"],
  [["crews", "crew_members"], "RCUD", "-", "-", "-", "-", "-", "RCUD", "R", "R"],
  [["job_visits"], "RCUD", "R:team", "R:own", "R", "-", "-", "RCUD", "RU:own", "R"],
  [["sign_offs"], "RCUD", "R:team", "R:own", "R", "-", "-", "RCU", "RC:own", "R"],
  [["snags"], "RCUD", "R:team", "R:own", "R", "-", "-", "RCUD", "RCU:own", "R"],
  [["delivery_notes", "delivery_note_lines"], "RCUD", "-", "-", "R", "-", "-", "RCUD", "RCU:own", "R"],
  [["waste_removals"], "RCUD", "-", "-", "-", "-", "-", "RCUD", "-", "R"],
  [["feedback"], "RCUD", "R:team", "R:own", "RCUD", "-", "-", "R", "-", "R"],
  [["complaints"], "RCUD", "R:team", "RU:own", "RCUD", "-", "-", "R", "-", "R"],
  [["warranty_claims"], "RCUD", "R:team", "R:own", "RCUD", "-", "-", "RCU", "-", "R"],
  [["deal_stock_needs"], "RCUD", "R:team", "RCU:own", "-", "-", "-", "RCUD", "-", "R"],
  [["vehicles"], "RCUD", "-", "-", "-", "-", "-", "RCUD", "R", "R"],
  [["vehicle_faults"], "RCUD", "-", "-", "-", "-", "-", "RCUD", "RC", "R"],
  [["vehicle_checks", "fuel_fills"], "RCUD", "-", "-", "-", "-", "-", "RCUD", "RC:own", "R"],
  // The sign-off and the send-back are the sheet's: a line has no state, so the manager reads the lines.
  [["time_sheets"], "R", "-", "-", "-", "-", "-", "RU", "RCU:own", "R"],
  [["time_sheet_lines"], "R", "-", "-", "-", "-", "-", "R", "RCU:own", "R"],
  [["certificates"], "RCUD", "-", "-", "-", "-", "-", "RCUD", "R:own", "R"],
  [["subcontractors", "insurance_incidents"], "RCUD", "-", "-", "-", "-", "-", "RCUD", "-", "R"],
  [["outbox"], "R", "-", "-", "-", "-", "-", "-", "-", "-"],
  [["settings"], "RU", "RU", "R", "R", "R", "R", "R", "R", "R"],
];

/** The four tables read by the two people of a row, on the screen, and by nothing else. */
const PRIVATE = ["one_to_ones", "one_to_one_sessions", "coaching_plans", "coaching_areas"] as const;
/** The only roles that hold anything on them. */
const PRIVATE_ROLES: readonly RoleKey[] = ["sales-manager", "rep"];

/** The only roles that take a file out of a table. */
const EXPORTERS: readonly RoleKey[] = ["admin", "sales-manager", "read-only"];

/** Who reads a table's personal columns in clear; everybody else reads them empty. */
const PERSONAL: Record<string, readonly RoleKey[]> = {
  contacts: ["admin", "sales-manager", "rep", "account-manager", "front-desk"],
  enquiries: ["admin", "sales-manager", "rep", "marketer", "front-desk"],
};

/** The settings the sales manager may change: the Selling keys. */
const SELLING_KEYS = ["approval_threshold_pct", "quote_valid_days", "quote_warn_days", "sitting_warm_days", "sitting_stale_days", "nudge_quiet_days", "nudge_stuck_days", "nudge_soon_days"];

/** Each button that hands a row to a colleague, and the roles that press it. */
const HAND_OVERS: Record<string, readonly RoleKey[]> = {
  "enquiries.pass": ["admin", "sales-manager", "rep", "front-desk"],
};

/** The nine parts, each a heading of the menu, and the last heading for the app's own two tables. */
const PARTS: readonly (readonly [string, readonly string[]])[] = [
  ["selling", ["stages", "deals", "deal_stage_changes", "follow_ups", "activities", "lost_reasons", "quotes", "quote_lines", "comments", "saved_views", "saved_searches", "nudge_snoozes", "deal_members", "deal_marks", "site_visits", "visit_notes", "visit_agreed"]],
  ["accounts", ["companies", "contacts", "territories", "territory_places", "renewals", "referrals"]],
  ["team", ["reps", "targets", "one_to_ones", "one_to_one_sessions", "coaching_plans", "coaching_areas", "actions", "meetings", "meeting_slots", "meeting_decisions", "threads", "thread_members", "messages", "starters", "starter_steps", "covers", "cover_notes"]],
  ["inbox", ["enquiries", "shows"]],
  ["showroom", ["showroom_spaces", "showroom_bookings", "samples", "sample_loans", "sample_chases", "display_pieces"]],
  ["jobs", ["jobs", "crews", "crew_members", "job_visits", "sign_offs", "snags", "delivery_notes", "delivery_note_lines", "waste_removals"]],
  ["aftercare", ["feedback", "complaints", "warranty_claims"]],
  ["supply", ["deal_stock_needs"]],
  ["fleet", ["vehicles", "vehicle_checks", "vehicle_faults", "fuel_fills", "time_sheets", "time_sheet_lines", "certificates", "subcontractors", "insurance_incidents"]],
  ["setup", ["outbox", "settings"]],
];

const LOCALES = ["en-US", "de-DE", "fr-FR", "cs-CZ", "da-DK", "zh-CN", "zh-TW", "ar-EG"] as const;

/* ─────────────────────────────────────────────────────────────────────────── */
/*  READING THE MATRIX AND THE MANIFEST                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

type Action = "read" | "create" | "update" | "delete" | "export";
type RowAction = "read" | "update" | "delete";
interface Reach {
  reach: "own" | "team" | "all";
  unowned?: true;
  while?: { column: string; in: string[] };
}
type Rows = Partial<Record<RowAction, Reach>>;
interface Cell {
  actions: Action[];
  rows: Rows;
}

const LETTERS: Record<string, Action> = { R: "read", C: "create", U: "update", D: "delete", X: "export" };
const REACHES: Record<string, Reach> = {
  own: { reach: "own" },
  team: { reach: "team" },
  "own+free": { reach: "own", unowned: true },
  "team+free": { reach: "team", unowned: true },
  won: { reach: "all", while: { column: "state", in: ["won"] } },
};
const ROW_ACTIONS: readonly RowAction[] = ["read", "update", "delete"];

function reachOf(word: string, cell: string): Reach {
  const found = REACHES[word];
  if (found === undefined) throw new Error(`"${word}" in "${cell}" is no reach`);
  return found;
}

/** One cell of the matrix, as the grants and the row limits it stands for. */
function read(cell: string): Cell {
  if (cell === "-") return { actions: [], rows: {} };
  const [head = "", ...own] = cell.split(";");
  const [letters = "", all] = head.split(":");
  const actions = [...letters].map((letter) => {
    const action = LETTERS[letter];
    if (action === undefined) throw new Error(`"${letter}" in "${cell}" is no right`);
    return action;
  });
  const rows: Rows = {};
  for (const action of ROW_ACTIONS) if (all !== undefined && actions.includes(action)) rows[action] = reachOf(all, cell);
  for (const piece of own) {
    const [key = "", word = ""] = piece.split("=");
    const action = ({ r: "read", u: "update", d: "delete" } as Record<string, RowAction>)[key];
    if (action === undefined || !actions.includes(action)) throw new Error(`"${piece}" in "${cell}" limits a right the cell does not give`);
    rows[action] = reachOf(word, cell);
  }
  return { actions, rows };
}

/** role → table → what the matrix says. */
const EXPECTED = new Map<RoleKey, Map<string, Cell>>(ROLES.map((role) => [role, new Map()]));
const MATRIX_TABLES: string[] = [];
for (const [refs, ...cells] of MATRIX) {
  if (cells.length !== ROLES.length) throw new Error(`the line of ${refs.join(", ")} has ${String(cells.length)} cells`);
  for (const ref of refs) {
    MATRIX_TABLES.push(ref);
    ROLES.forEach((role, i) => EXPECTED.get(role)?.set(ref, read(cells[i] ?? "-")));
  }
}

interface Limit {
  writable?: string[];
  writableValues?: Record<string, (string | number | boolean)[]>;
  writableFrom?: Record<string, (string | number | boolean)[]>;
  readable?: string[];
  creatable?: string[];
  creatableValues?: Record<string, (string | number | boolean)[]>;
  rows?: Rows;
}
interface Role {
  key: string;
  name: string;
  cloneFrom?: string;
  screensOnly?: boolean;
  permissions: string[];
  limits?: Record<string, Limit>;
  tables?: unknown;
}
interface Rules {
  stamp?: unknown;
  rollup?: unknown;
  formula?: unknown;
  sequence?: unknown;
  format?: unknown;
  code?: unknown;
  copy?: { mode?: string };
  personal?: boolean;
}
interface Column {
  ref: string;
  role?: string;
  rules?: Rules;
}
interface Move {
  to: string;
  roles?: string[];
}
interface StateAction {
  id: string;
  move?: { to: string };
  set?: Record<string, unknown>;
  ask?: string[];
  handOver?: boolean;
}
interface Table {
  ref: string;
  labelPlural?: Record<string, string>;
  private?: boolean;
  belongs?: unknown[];
  columns: Column[];
  states?: { column: string; moves: Record<string, (string | Move)[]>; actions?: StateAction[] };
}
interface Page {
  ref: string;
  template: string;
  title: { key: string; fallback: string };
  titles?: Record<string, string>;
  nav: { group: string; icon: string; order: number };
  bindings?: Record<string, string>;
}
interface NavGroup {
  key: string;
  label: Record<string, string>;
  order: number;
}

const doc = manifest as unknown as { roles?: Role[]; pages: Page[]; navGroups?: NavGroup[]; requiredSchema: { tables: Table[] } };
const roles = doc.roles ?? [];
const tables = doc.requiredSchema.tables;
const tableOf = new Map(tables.map((table) => [table.ref, table]));
const pages = doc.pages;
const groups = doc.navGroups ?? [];

function role(key: RoleKey): Role {
  const found = roles.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`the manifest has no role "${key}"`);
  return found;
}

/** The rights a role holds on a table, in the matrix's order (the personal-data right is read apart). */
function held(key: RoleKey, ref: string): Action[] {
  const grants = new Set(role(key).permissions);
  return (["read", "create", "update", "delete", "export"] as const).filter((action) => grants.has(`table:@${ref}:${action}`));
}
const holds = (key: RoleKey, ref: string, action: Action): boolean => role(key).permissions.includes(`table:@${ref}:${action}`);
const limitOf = (key: RoleKey, ref: string): Limit | undefined => role(key).limits?.[ref];

/** A column Adminium writes by itself: a stamp, a copy it keeps true, a total, a figure, a number, a code. */
function workedOut(column: Column): boolean {
  const rules = column.rules ?? {};
  return rules.stamp !== undefined || rules.rollup !== undefined || rules.formula !== undefined || rules.sequence !== undefined || rules.format !== undefined || rules.code !== undefined || rules.copy?.mode === "always";
}
/** A column whose value a new row would carry as typed, whatever Adminium meant to write there. */
function typedWins(column: Column): boolean {
  const rules = column.rules ?? {};
  return rules.rollup !== undefined || rules.formula !== undefined || rules.sequence !== undefined || rules.format !== undefined || rules.code !== undefined;
}
const columnsOf = (ref: string): Column[] => tableOf.get(ref)?.columns ?? [];
/**
 * Columns that are Adminium's with no rule of their own to say so: the key of
 * the newest sent quote (written with the deal's quoted amount), and the team
 * a deal closed under (no stamp can fill it yet).
 */
const ALSO_ADMINIUMS: Record<string, readonly string[]> = { deals: ["quote_id", "closed_team"] };
const keptFromWriters = (ref: string): string[] => [...columnsOf(ref).filter(workedOut).map((c) => c.ref), ...(ALSO_ADMINIUMS[ref] ?? [])];
const keptFromMakers = (ref: string): string[] => [...columnsOf(ref).filter(typedWins).map((c) => c.ref), ...(ALSO_ADMINIUMS[ref] ?? [])];

const pageOfTable = new Map(pages.map((page) => [Object.values(page.bindings ?? {})[0] ?? "", page]));

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE CHECKS                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

describe("the app brings nine roles", () => {
  it("names them as the plan does, in its order", () => {
    expect(roles.map((r) => r.key)).toEqual([...ROLES]);
    expect(Object.fromEntries(roles.map((r) => [r.key, r.name]))).toEqual(NAMES);
  });

  it("fits each installed name, crm-<key>, in the forty characters a role's slug holds", () => {
    for (const r of roles) expect(`${manifest.key}-${r.key}`.length, r.key).toBeLessThanOrEqual(40);
  });

  it("writes each role out whole: none copies another, none reaches an add-on's table", () => {
    for (const r of roles) {
      expect(r.cloneFrom, r.key).toBeUndefined();
      expect(r.tables, r.key).toBeUndefined();
    }
  });

  it("sends nobody past the dashboard while the app has no screen of its own", () => {
    // A role marked screens-only would open the staff side, which is still a placeholder,
    // and never the records pages below.
    for (const r of roles) expect(r.screensOnly, r.key).toBeUndefined();
  });

  it("grants only a table right, a page to view, and the app's staff screens", () => {
    const known = /^(table:@[a-z_]+:(read|create|update|delete|export|read_pii)|page:@[a-z][a-z0-9-]*:view|app:@:staff)$/;
    for (const r of roles) {
      expect(r.permissions.filter((grant) => !known.test(grant)), r.key).toEqual([]);
      expect(r.permissions.length, `${r.key} repeats a grant`).toBe(new Set(r.permissions).size);
      expect(r.permissions, r.key).toContain("app:@:staff");
    }
  });

  it("names only tables and pages the manifest declares", () => {
    const pageRefs = new Set(pages.map((page) => page.ref));
    for (const r of roles) {
      for (const grant of r.permissions) {
        const [kind, at] = grant.split(":");
        if (kind === "table") expect(tableOf.has((at ?? "").slice(1)), `${r.key}: ${grant}`).toBe(true);
        if (kind === "page") expect(pageRefs.has((at ?? "").slice(1)), `${r.key}: ${grant}`).toBe(true);
      }
      for (const ref of Object.keys(r.limits ?? {})) expect(tableOf.has(ref), `${r.key} limits ${ref}`).toBe(true);
    }
  });
});

describe("the matrix covers every table, and every table's every role", () => {
  it("lists each of the manifest's tables once", () => {
    expect(MATRIX_TABLES.length).toBe(new Set(MATRIX_TABLES).size);
    expect([...MATRIX_TABLES].sort()).toEqual(tables.map((table) => table.ref).sort());
    expect(MATRIX_TABLES).toHaveLength(72);
  });

  it("has nine roles by seventy-two tables: 648 cells", () => {
    let cells = 0;
    for (const key of ROLES) cells += EXPECTED.get(key)?.size ?? 0;
    expect(cells).toBe(648);
  });
});

describe("every cell of the matrix is what the manifest grants", () => {
  for (const key of ROLES) {
    it(`${key}: the rights on each table`, () => {
      const wrong: string[] = [];
      for (const ref of MATRIX_TABLES) {
        const want = EXPECTED.get(key)?.get(ref)?.actions ?? [];
        const got = held(key, ref);
        if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${ref}: holds [${got.join(" ")}], the matrix says [${want.join(" ")}]`);
      }
      expect(wrong).toEqual([]);
    });

    it(`${key}: the rows each read, update and delete reaches`, () => {
      const wrong: string[] = [];
      for (const ref of MATRIX_TABLES) {
        const want = EXPECTED.get(key)?.get(ref)?.rows ?? {};
        const got = limitOf(key, ref)?.rows ?? {};
        for (const action of ROW_ACTIONS) {
          if (JSON.stringify(got[action]) !== JSON.stringify(want[action])) {
            wrong.push(`${ref} ${action}: ${JSON.stringify(got[action] ?? "every row")}, the matrix says ${JSON.stringify(want[action] ?? "every row")}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it(`${key}: no limit on a table it holds nothing on`, () => {
      for (const ref of Object.keys(role(key).limits ?? {})) expect(held(key, ref).length, `${key} limits ${ref}`).toBeGreaterThan(0);
    });
  }

  it("says whose a row is on every table a role reaches only some rows of", () => {
    for (const key of ROLES) {
      for (const [ref, limit] of Object.entries(role(key).limits ?? {})) {
        for (const action of ROW_ACTIONS) {
          const reach = limit.rows?.[action];
          if (reach === undefined || reach.reach === "all") continue;
          expect(tableOf.get(ref)?.belongs, `${key}: ${ref} ${action}`).toBeDefined();
        }
      }
    }
  });

  it("limits rows by a value only on a column that takes the value", () => {
    for (const key of ROLES) {
      for (const [ref, limit] of Object.entries(role(key).limits ?? {})) {
        for (const action of ROW_ACTIONS) {
          const condition = limit.rows?.[action]?.while;
          if (condition === undefined) continue;
          const column = columnsOf(ref).find((c) => c.ref === condition.column) as (Column & { enum?: string[] }) | undefined;
          expect(column, `${key}: ${ref}.${condition.column}`).toBeDefined();
          for (const value of condition.in) expect(column?.enum, `${key}: ${ref}.${condition.column}`).toContain(value);
        }
      }
    }
  });
});

describe("the four private tables are their two people's", () => {
  it("marks exactly those four private", () => {
    expect(tables.filter((table) => table.private === true).map((table) => table.ref)).toEqual([...PRIVATE]);
  });

  it("gives nothing on them to any role but the sales manager and the rep", () => {
    for (const r of roles) {
      if (PRIVATE_ROLES.includes(r.key as RoleKey)) continue;
      for (const ref of PRIVATE) {
        expect(r.permissions.filter((grant) => grant.startsWith(`table:@${ref}:`) || grant === `page:@crm-${ref.replaceAll("_", "-")}:view`), `${r.key} on ${ref}`).toEqual([]);
        expect(r.limits?.[ref], `${r.key} limits ${ref}`).toBeUndefined();
      }
    }
  });

  it("holds each right the two roles have there to the person's own rows, and nothing wider", () => {
    for (const key of PRIVATE_ROLES) {
      for (const ref of PRIVATE) {
        const rows = limitOf(key, ref)?.rows ?? {};
        for (const action of ROW_ACTIONS) {
          if (holds(key, ref, action)) expect(rows[action], `${key}: ${ref} ${action}`).toEqual({ reach: "own" });
          else expect(rows[action], `${key}: ${ref} ${action}`).toBeUndefined();
        }
      }
    }
  });

  it("lets the rep read them and write nothing", () => {
    for (const ref of PRIVATE) expect(held("rep", ref), ref).toEqual(["read"]);
  });

  it("takes no file out of them, brings none in, and shows no personal column of them", () => {
    for (const r of roles) {
      for (const ref of PRIVATE) {
        for (const action of ["export", "import", "read_pii"]) expect(r.permissions, `${r.key}: ${ref}`).not.toContain(`table:@${ref}:${action}`);
      }
    }
  });
});

describe("a file out of a table is three roles' to take", () => {
  it("gives export to the CRM admin, the sales manager and Read-only, and to nobody else", () => {
    for (const r of roles) {
      const exports = r.permissions.filter((grant) => grant.endsWith(":export"));
      if (!EXPORTERS.includes(r.key as RoleKey)) expect(exports, r.key).toEqual([]);
    }
  });

  it("gives each of the three exactly the tables the matrix marks", () => {
    const of = (key: RoleKey) => role(key).permissions.filter((grant) => grant.endsWith(":export")).map((grant) => grant.split(":")[1]?.slice(1));
    expect(of("admin")).toEqual(["deals", "quotes", "quote_lines", "companies", "contacts"]);
    expect(of("sales-manager")).toEqual(["deals", "companies", "contacts"]);
    expect(of("read-only")).toEqual(["deals", "quotes", "quote_lines", "companies", "contacts"]);
  });

  it("brings no file in through any role", () => {
    for (const r of roles) expect(r.permissions.filter((grant) => grant.endsWith(":import")), r.key).toEqual([]);
  });
});

describe("a personal column is shown to the roles that ring or write to the person", () => {
  it("marks personal only the columns the list below covers", () => {
    const marked = tables.filter((table) => table.columns.some((c) => c.rules?.personal === true)).map((table) => table.ref);
    expect(marked.sort()).toEqual(Object.keys(PERSONAL).sort());
  });

  it("gives the right to exactly the listed roles, each on a table it reads", () => {
    for (const r of roles) {
      const clear = r.permissions.filter((grant) => grant.endsWith(":read_pii")).map((grant) => grant.split(":")[1]?.slice(1) ?? "");
      const want = Object.entries(PERSONAL).filter(([, keys]) => keys.includes(r.key as RoleKey)).map(([ref]) => ref);
      expect(clear.sort(), r.key).toEqual(want.sort());
      for (const ref of clear) expect(r.permissions, `${r.key}: ${ref}`).toContain(`table:@${ref}:read`);
    }
  });
});

describe("one records page per table, under the heading of its part", () => {
  it("has a page for each table and no other page", () => {
    expect(pages).toHaveLength(tables.length);
    expect(pages.map((page) => Object.values(page.bindings ?? {})).flat().sort()).toEqual(tables.map((table) => table.ref).sort());
    for (const page of pages) {
      expect(page.template, page.ref).toBe("page-crud");
      expect(Object.keys(page.bindings ?? {}), page.ref).toEqual(["rows"]);
      expect(page.ref, page.ref).toBe(`crm-${(page.bindings?.["rows"] ?? "").replaceAll("_", "-")}`);
    }
  });

  it("titles each page as its table is named, in eight languages", () => {
    for (const page of pages) {
      const table = tableOf.get(page.bindings?.["rows"] ?? "");
      const titles: Record<string, string> = { "en-US": page.title.fallback, ...(page.titles ?? {}) };
      for (const locale of LOCALES) expect((titles[locale] ?? "").trim(), `${page.ref} in ${locale}`).not.toBe("");
      expect(titles, page.ref).toEqual(table?.labelPlural);
    }
  });

  it("puts each page under its part, and names each part in eight languages", () => {
    expect(groups.map((group) => group.key)).toEqual(PARTS.map(([key]) => key));
    expect(groups.map((group) => group.order)).toEqual(PARTS.map((_, i) => i + 1));
    for (const group of groups) {
      for (const locale of LOCALES) expect((group.label[locale] ?? "").trim(), `${group.key} in ${locale}`).not.toBe("");
    }
    for (const [key, refs] of PARTS) {
      const inGroup = pages.filter((page) => page.nav.group === key).sort((a, b) => a.nav.order - b.nav.order);
      expect(inGroup.map((page) => page.bindings?.["rows"]), key).toEqual([...refs]);
    }
    expect(PARTS.flatMap(([, refs]) => refs).sort()).toEqual(tables.map((table) => table.ref).sort());
  });

  for (const key of ROLES) {
    it(`${key}: a page for every table it reads, and no page of a table it cannot read`, () => {
      const reads = MATRIX_TABLES.filter((ref) => holds(key, ref, "read"));
      const viewed = role(key).permissions.filter((grant) => grant.startsWith("page:@")).map((grant) => grant.split(":")[1]?.slice(1) ?? "");
      // Every table the role reads has its page on the role's menu.
      for (const ref of reads) expect(viewed, `${key} reads ${ref} and has no page for it`).toContain(pageOfTable.get(ref)?.ref);
      // No page on the menu shows a table the role cannot read.
      for (const ref of viewed) {
        const table = pages.find((page) => page.ref === ref)?.bindings?.["rows"] ?? "";
        expect(holds(key, table, "read"), `${key} sees the page ${ref} and cannot read ${table}`).toBe(true);
      }
      expect(viewed).toHaveLength(reads.length);
      // A role with a right on a table always reads it: no write into a table it cannot see.
      for (const ref of MATRIX_TABLES) if (held(key, ref).length > 0) expect(holds(key, ref, "read"), `${key} writes ${ref} unread`).toBe(true);
    });
  }

  it("counts each role's menu", () => {
    const menu = Object.fromEntries(ROLES.map((key) => [key, role(key).permissions.filter((grant) => grant.startsWith("page:@")).length]));
    expect(menu).toEqual({ admin: 68, "sales-manager": 57, rep: 57, "account-manager": 29, marketer: 7, "front-desk": 11, "ops-manager": 23, crew: 15, "read-only": 62 });
  });
});

describe("a discount is approved by the sales manager or the CRM admin, and by nobody else", () => {
  const others = ROLES.filter((key) => key !== "admin" && key !== "sales-manager" && holds(key, "quotes", "update"));

  it("holds every other role that changes a quote to asking", () => {
    expect(others).toEqual(["rep"]);
    for (const key of others) {
      const limit = limitOf(key, "quotes");
      expect(limit?.writable, key).toContain("approval");
      expect(limit?.writable, key).toContain("ask_reason");
      expect(limit?.writableValues, key).toEqual({ approval: ["asked"] });
      // The decision's note is the decider's, and the threshold a version was made under is nobody's to lower.
      for (const column of ["decision_note", "threshold_pct"]) expect(limit?.writable, `${key}: ${column}`).not.toContain(column);
    }
  });

  it("holds a quote they make to the same: never approved from the start, never sent from the start", () => {
    for (const key of ROLES.filter((k) => k !== "admin" && k !== "sales-manager" && holds(k, "quotes", "create"))) {
      const limit = limitOf(key, "quotes");
      expect(limit?.creatable, key).toBeDefined();
      expect(limit?.creatableValues, key).toEqual({ approval: ["none", "asked"] });
      for (const column of ["status", "decision_note", "threshold_pct"]) expect(limit?.creatable, `${key}: ${column}`).not.toContain(column);
    }
  });

  it("leaves the two buttons to the roles that may set what they set", () => {
    const actions = tableOf.get("quotes")?.states?.actions ?? [];
    for (const id of ["approve", "refuse"]) {
      const sets = actions.find((action) => action.id === id)?.set?.["approval"];
      expect(sets, id).toBeDefined();
      for (const key of others) expect(limitOf(key, "quotes")?.writableValues?.["approval"], `${key} presses ${id}`).not.toContain(sets);
      for (const key of ["admin", "sales-manager"] as const) {
        expect(holds(key, "quotes", "update"), key).toBe(true);
        expect(limitOf(key, "quotes")?.writableValues, key).toBeUndefined();
      }
    }
    expect(limitOf("sales-manager", "quotes")?.writable).toContain("decision_note");
  });
});

describe("a time sheet is signed off or sent back by the operations manager", () => {
  const sheet = tableOf.get("time_sheets");
  const movesOf = (from: string): Move[] => (sheet?.states?.moves[from] ?? []).map((move) => (typeof move === "string" ? { to: move } : move));

  it("keeps the two moves for that role, and no other move of the app for any role", () => {
    const kept: string[] = [];
    for (const table of tables) {
      for (const [from, moves] of Object.entries(table.states?.moves ?? {})) {
        for (const move of moves) if (typeof move === "object" && move.roles !== undefined) kept.push(`${table.ref}: ${from} → ${move.to} [${move.roles.join(", ")}]`);
      }
    }
    expect(kept).toEqual(["time_sheets: sent → signed-off [ops-manager]", "time_sheets: sent → sent-back [ops-manager]"]);
    expect(movesOf("sent").map((move) => move.to)).toEqual(["signed-off", "sent-back"]);
  });

  it("lets her write the state and the note, from a sent sheet, and nothing else of it", () => {
    expect(limitOf("ops-manager", "time_sheets")).toEqual({
      writable: ["state", "sent_back_note"],
      writableValues: { state: ["signed-off", "sent-back"] },
      writableFrom: { state: ["sent"] },
    });
    expect(held("ops-manager", "time_sheet_lines")).toEqual(["read"]);
  });

  it("lets the crew change a sheet only while it is open or sent back, and only send it", () => {
    const limit = limitOf("crew", "time_sheets");
    expect(limit?.writable).toEqual(["week_of", "state"]);
    expect(limit?.writableValues).toEqual({ state: ["sent"] });
    expect(limit?.writableFrom).toEqual({ state: ["open", "sent-back"] });
    // A new sheet starts open: its state is not the crew's to choose.
    expect(limit?.creatable).toEqual(["user_id", "week_of"]);
  });

  it("locks a sheet's lines with the sheet, for everybody", () => {
    expect((sheet?.states as unknown as { lock: { when: string[] }; children: Record<string, unknown> }).lock.when).toEqual(["sent", "signed-off"]);
    expect((sheet?.states as unknown as { children: Record<string, unknown> }).children).toEqual({ time_sheet_lines: { via: "sheet_id", lock: true } });
  });

  it("gives no other role a change of a time sheet or of its lines", () => {
    for (const key of ROLES) {
      if (key === "ops-manager" || key === "crew") continue;
      for (const ref of ["time_sheets", "time_sheet_lines"]) for (const action of ["create", "update", "delete"] as const) expect(holds(key, ref, action), `${key}: ${ref} ${action}`).toBe(false);
    }
  });
});

describe("the field crew writes what the day asks of it", () => {
  it("ticks the four ticks of a visit and changes nothing else of it", () => {
    expect(limitOf("crew", "job_visits")?.writable).toEqual(["tick_loaded", "tick_arrived", "tick_fitted", "tick_cleared"]);
    expect(held("crew", "job_visits")).toEqual(["read", "update"]);
  });

  it("names, for every row it makes and every row it changes, the columns it may fill", () => {
    for (const ref of MATRIX_TABLES) {
      if (holds("crew", ref, "create")) expect(limitOf("crew", ref)?.creatable, `${ref} (create)`).toBeDefined();
      if (holds("crew", ref, "update")) expect(limitOf("crew", ref)?.writable, `${ref} (update)`).toBeDefined();
    }
  });

  it("never moves a row it reaches to another job, another visit or another crew", () => {
    for (const ref of ["snags", "delivery_notes", "delivery_note_lines"]) {
      for (const column of ["job_id", "visit_id", "crew_id", "note_id"]) expect(limitOf("crew", ref)?.writable, `${ref}.${column}`).not.toContain(column);
    }
    expect(limitOf("crew", "snags")?.writable).not.toContain("stops_sign_off");
  });

  it("holds nothing on a company, a contact, a deal, a quote or a job", () => {
    for (const ref of ["companies", "contacts", "deals", "quotes", "quote_lines", "jobs", "deal_marks", "follow_ups", "feedback", "complaints"]) expect(held("crew", ref), ref).toEqual([]);
  });
});

describe("the settings are the CRM admin's, and the Selling keys the sales manager's too", () => {
  it("lets only those two change the settings row", () => {
    expect(ROLES.filter((key) => holds(key, "settings", "update"))).toEqual(["admin", "sales-manager"]);
    expect(limitOf("admin", "settings")).toBeUndefined();
    expect(limitOf("sales-manager", "settings")).toEqual({ writable: SELLING_KEYS });
    for (const key of ROLES) for (const action of ["create", "delete"] as const) expect(holds(key, "settings", action), `${key} ${action}`).toBe(false);
  });
});

describe("a hand-over button is pressed by a role that may change the row", () => {
  const buttons = tables.flatMap((table) => (table.states?.actions ?? []).filter((action) => action.handOver === true).map((action) => ({ table, action })));

  it("lists every such button of the manifest", () => {
    // A new button (a deal's, a follow-up's) joins HAND_OVERS with the roles that press it.
    expect(buttons.map(({ table, action }) => `${table.ref}.${action.id}`)).toEqual(Object.keys(HAND_OVERS));
  });

  it("gives each listed role the update, and the state and the person the button writes", () => {
    for (const { table, action } of buttons) {
      const pressers = HAND_OVERS[`${table.ref}.${action.id}`] ?? [];
      expect(ROLES.filter((key) => holds(key, table.ref, "update")), `${table.ref}.${action.id}`).toEqual([...pressers]);
      for (const key of pressers) {
        const writable = limitOf(key, table.ref)?.writable;
        if (writable === undefined) continue;
        for (const column of [table.states?.column ?? "", ...(action.ask ?? [])]) expect(writable, `${key}: ${table.ref}.${column}`).toContain(column);
        expect(limitOf(key, table.ref)?.writableValues?.[table.states?.column ?? ""], key).toBeUndefined();
      }
    }
  });
});

describe("nobody but the CRM admin types what Adminium works out", () => {
  // A copy is kept true and is not a lock; a stamp fires when its moment comes and not after;
  // a number and a code a writer sends win over the ones Adminium would make.
  it("keeps every worked-out column out of each other role's update", () => {
    const open: string[] = [];
    for (const key of ROLES) {
      if (key === "admin") continue;
      for (const ref of MATRIX_TABLES) {
        if (!holds(key, ref, "update")) continue;
        const worked = keptFromWriters(ref);
        if (worked.length === 0) continue;
        const writable = limitOf(key, ref)?.writable;
        if (writable === undefined) open.push(`${key} writes all of ${ref}, with ${worked.join(", ")}`);
        else for (const column of worked) if (writable.includes(column)) open.push(`${key} may write ${ref}.${column}`);
      }
    }
    expect(open).toEqual([]);
  });

  it("keeps a total, a figure, a number and a code out of each other role's new row", () => {
    const open: string[] = [];
    for (const key of ROLES) {
      if (key === "admin") continue;
      for (const ref of MATRIX_TABLES) {
        if (!holds(key, ref, "create")) continue;
        const kept = keptFromMakers(ref);
        if (kept.length === 0) continue;
        const creatable = limitOf(key, ref)?.creatable;
        if (creatable === undefined) open.push(`${key} makes ${ref} whole, with ${kept.join(", ")}`);
        else for (const column of kept) if (creatable.includes(column)) open.push(`${key} may give a new ${ref} its ${column}`);
      }
    }
    expect(open).toEqual([]);
  });

  it("names only columns the table has, and a limit only beside the right it narrows", () => {
    for (const key of ROLES) {
      for (const [ref, limit] of Object.entries(role(key).limits ?? {})) {
        const has = new Set(columnsOf(ref).map((c) => c.ref));
        for (const list of [limit.writable, limit.creatable, limit.readable]) for (const column of list ?? []) expect(has.has(column), `${key}: ${ref}.${column}`).toBe(true);
        if (limit.writable !== undefined) expect(holds(key, ref, "update"), `${key}: ${ref} writable`).toBe(true);
        if (limit.creatable !== undefined) expect(holds(key, ref, "create"), `${key}: ${ref} creatable`).toBe(true);
        if (limit.readable !== undefined) expect(holds(key, ref, "read"), `${key}: ${ref} readable`).toBe(true);
        // The key is Adminium's on every table.
        for (const list of [limit.writable, limit.creatable]) expect(list ?? [], `${key}: ${ref}`).not.toContain("id");
      }
    }
  });

  it("gives no role a write of a deal's mark: the copy is kept true by nobody writing it", () => {
    for (const key of ROLES) expect(held(key, "deal_marks").filter((action) => action !== "read"), key).toEqual([]);
  });
});

describe("a listing a table is read through is not a way in", () => {
  // A table is reached through `deal_members`, `thread_members`, `crew_members` and `covers`: whoever
  // may write themselves into one of those reaches the rows behind it. A new row there is held by its
  // link (it names a deal or a conversation its writer reaches), so the role must read that table in part.
  it("lets a role add a person to a deal or a conversation only where it reads that table in part", () => {
    for (const [listing, parent] of [["deal_members", "deals"], ["thread_members", "threads"]] as const) {
      for (const key of ROLES) {
        if (!holds(key, listing, "create") || key === "admin") continue;
        expect(limitOf(key, parent)?.rows?.read, `${key} adds to ${listing} and reads all of ${parent}`).toBeDefined();
      }
    }
    // The CRM admin reads every deal already, and conversations only as their own.
    expect(limitOf("admin", "threads")?.rows?.read).toEqual({ reach: "own" });
  });

  it("lets a member of a conversation add a colleague, and change no row there but their own", () => {
    expect(tableOf.get("thread_members")?.belongs).toEqual([{ column: "user_id", set: "anyone" }]);
    for (const key of ROLES) {
      if (!holds(key, "thread_members", "update")) continue;
      expect(limitOf(key, "thread_members")?.rows, key).toEqual({ update: { reach: "own" } });
      expect(holds(key, "thread_members", "delete"), key).toBe(false);
    }
    // Nobody changes a conversation or a message once written, so no row is added under one by a change of it.
    for (const key of ROLES) for (const ref of ["threads", "messages"]) for (const action of ["update", "delete"] as const) expect(holds(key, ref, action), `${key}: ${ref}`).toBe(false);
  });

  it("lets a manager write cover for the people they lead, and for nobody else's rep", () => {
    // The rep away is the cover's own person, and a writer held to their team names there only
    // themselves or somebody they lead. Who covers is anybody: that is the manager's choice.
    expect(tableOf.get("covers")?.belongs).toEqual([{ column: "owner_id", set: "team" }]);
    expect(ROLES.filter((key) => held(key, "covers").some((action) => action !== "read"))).toEqual(["admin", "sales-manager"]);
    expect(limitOf("sales-manager", "covers")?.rows).toEqual({ update: { reach: "team" }, delete: { reach: "team" } });
    // Everybody who holds the table still reads every cover.
    for (const key of ROLES) expect(limitOf(key, "covers")?.rows?.read, key).toBeUndefined();
  });

  it("leaves a crew's people to the operations manager and the CRM admin", () => {
    expect(ROLES.filter((key) => held(key, "crew_members").some((action) => action !== "read"))).toEqual(["admin", "ops-manager"]);
  });
});

describe("what a role is kept from, column by column", () => {
  it("lets only the CRM admin take back that a contact unsubscribed", () => {
    for (const key of ROLES) {
      if (key === "admin" || !holds(key, "contacts", "update")) continue;
      expect(limitOf(key, "contacts")?.writable, key).toBeDefined();
      expect(limitOf(key, "contacts")?.writable, key).not.toContain("unsubscribed_at");
      expect(limitOf(key, "contacts")?.writable, key).toContain("may_email");
    }
  });

  it("shows a rep a new starter, and not the target she was given", () => {
    // A rep reads their own target and nobody else's.
    expect(limitOf("rep", "targets")?.rows).toEqual({ read: { reach: "own" } });
    expect(limitOf("rep", "starters")?.readable).toEqual(["name", "starts_on", "manager_id", "user_id"]);
  });

  it("lets the marketer put an enquiry in the inbox, and not hand it to anybody", () => {
    const creatable = limitOf("marketer", "enquiries")?.creatable ?? [];
    expect(creatable.length).toBeGreaterThan(0);
    for (const column of ["state", "claimed_by_id", "passed_to_id", "deal_id", "rung_at", "received_at"]) expect(creatable, column).not.toContain(column);
    expect(held("marketer", "enquiries")).toEqual(["read", "create"]);
  });

  it("reads columns apart only where the list above says so", () => {
    const apart = ROLES.flatMap((key) => Object.entries(role(key).limits ?? {}).filter(([, limit]) => limit.readable !== undefined).map(([ref]) => `${key}: ${ref}`));
    expect(apart).toEqual(["rep: starters"]);
  });
});
