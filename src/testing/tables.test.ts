/**
 * The tables of `manifest.json`, held to the list written out below.
 *
 * The validator checks that the manifest is well formed. It does not know which
 * tables the app is meant to have, which columns may be empty, or that a list
 * limited to a person's rows needs an index to stay fast: a staff column with
 * no index still validates, and still installs. Those are checked here.
 *
 * The expectations are data, at the top: a later batch of tables extends
 * `TABLES` and `TABLE_COUNT`, and nothing below them.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";
import { validateManifest } from "./manifest/index.ts";

/* ─────────────────────────────────────────────────────────────────────────── */
/*  WHAT IS EXPECTED                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Every language a table, a column and an enum value is named in. */
const LOCALES = ["en-US", "de-DE", "fr-FR", "cs-CZ", "da-DK", "zh-CN", "zh-TW", "ar-EG"] as const;

/**
 * Each table the manifest holds, with every column of it that may be empty.
 * A column not listed here may not be: `nullable` on it fails the test, and so
 * does a listed column without it.
 */
const TABLES: Record<string, { nullable: readonly string[] }> = {
  // Selling
  stages: { nullable: [] },
  deals: {
    nullable: [
      "scope",
      "contact_id",
      "expected_close",
      "closed_at",
      "closed_on",
      "cycle_days",
      "lost_reason_id",
      "close_note",
      "typed_amount",
      "quoted_amount",
      "last_activity_at",
      "stage_by_id",
      "quote_id",
      "list_value",
      "closed_team",
    ],
  },
  deal_stage_changes: { nullable: ["from_stage_id", "by_id"] },
  deal_amount_changes: { nullable: [] },
  follow_ups: { nullable: ["deal_id", "job_id", "call_no", "outcome", "done_by_id", "done_at"] },
  activities: { nullable: [] },
  lost_reasons: { nullable: [] },
  // Built on the quote shape of Invoices & Receipts. The first twelve are the
  // shape's, empty where the shape says so; the rest are the app's own.
  quotes: {
    nullable: [
      "number_seq",
      "number",
      "valid_until",
      "currency",
      "tax_name",
      "tax_rate",
      "subtotal",
      "tax",
      "total",
      "sent_at",
      "decided_at",
      "withdraw_reason",
      "family_no",
      "replaces_id",
      "deal_no",
      "replaces_deal_id",
      "threshold_pct",
      "approved_pct",
      "approved_unlisted_lines",
      "approved_unlisted_value",
      "asked_by_id",
      "asked_at",
      "ask_reason",
      "decided_by_id",
      "approval_decided_at",
      "decision_note",
      "sent_to_contact_id",
      "to_email",
      "to_name",
      "sent_to_email",
      "sent_to_name",
      "notes",
      "share_code",
      "accepted_name",
      "accepted_via",
      "withdrawn_at",
    ],
  },
  price_list: { nullable: [] },
  quote_lines: { nullable: ["description", "rate", "discount", "currency", "amount", "price_id", "list_rate"] },
  comments: { nullable: ["parent_id", "settled_by_id", "settled_at"] },
  saved_views: { nullable: ["owner_id"] },
  saved_searches: { nullable: ["owner_id", "last_run_at"] },
  nudge_snoozes: { nullable: [] },
  deal_members: { nullable: ["role_note", "deal_owner_id"] },
  deal_marks: { nullable: ["owner_id"] },
  site_visits: { nullable: ["contact_id", "cancel_reason", "note"] },
  visit_notes: { nullable: ["saw", "said", "next", "photos"] },
  visit_agreed: { nullable: [] },
  // Accounts
  companies: {
    nullable: [
      "sector",
      "headcount",
      "address_lines",
      "town",
      "region",
      "postal_code",
      "country",
      "lat",
      "lng",
      "place",
      "territory_id",
      "website",
      "logo",
      "account_owner_id",
      "access_note",
      "ask_for_contact_id",
    ],
  },
  contacts: { nullable: ["job_title", "email", "phone", "unsubscribed_at"] },
  territories: { nullable: ["owner_id", "area"] },
  territory_places: { nullable: [] },
  renewals: { nullable: ["deal_id", "est_value", "due_on", "every_months"] },
  referrals: { nullable: ["company_id", "referred_name", "deal_id", "thanked_at", "reward"] },
  // The team
  reps: { nullable: ["tint", "hours_from", "hours_to", "landing"] },
  targets: { nullable: [] },
  one_to_ones: { nullable: ["next_at"] },
  one_to_one_sessions: { nullable: ["notes"] },
  coaching_plans: { nullable: ["review_on", "runs_to"] },
  coaching_areas: { nullable: [] },
  actions: { nullable: ["due_on", "done_at", "one_to_one_id", "meeting_id", "coaching_area_id"] },
  meetings: { nullable: [] },
  meeting_slots: { nullable: ["who_id"] },
  meeting_decisions: { nullable: ["who_id"] },
  threads: { nullable: ["title"] },
  thread_members: { nullable: ["read_at"] },
  messages: { nullable: [] },
  starters: { nullable: ["first_year_target", "user_id"] },
  starter_steps: { nullable: ["owner_id"] },
  covers: { nullable: ["ends_on", "note"] },
  cover_notes: { nullable: [] },
  // Inbox
  enquiries: {
    nullable: [
      "person",
      "email",
      "phone",
      "text",
      "est_value",
      "town",
      "wants",
      "warmth",
      "show_id",
      "company_id",
      "claimed_by_id",
      "passed_to_id",
      "rung_at",
      "deal_id",
    ],
  },
  shows: { nullable: ["ends_on"] },
  // Showroom and samples
  showroom_spaces: { nullable: [] },
  showroom_bookings: {
    nullable: [
      "company_id",
      "contact_id",
      "visitor_name",
      "rep_id",
      "cancel_reason",
      "outcome",
      "next_step",
      "next_step_by",
      "deal_id",
    ],
  },
  samples: { nullable: ["kind", "item"] },
  sample_loans: { nullable: ["company_id", "contact_id", "returned_on"] },
  sample_chases: { nullable: [] },
  display_pieces: { nullable: ["promised_booking_id", "lent_company_id", "lent_until", "item"] },
  // Jobs on site. A job's number and the count behind it are empty on a sample
  // row, which brings its own text.
  jobs: { nullable: ["code_seq", "code", "contact_id", "address_lines", "town", "lat", "lng", "access_note", "ask_for", "site_phone"] },
  crews: { nullable: ["vehicle_id", "day_hours"] },
  crew_members: { nullable: ["since"] },
  // The weekdays a crew works: a visit is not booked on a day it has no row for.
  crew_days: { nullable: [] },
  job_visits: {
    nullable: [
      "day",
      "start_time",
      "crew_id",
      "vehicle_id",
      "hours",
      "crew_size",
      "stock_ready_on",
      "cancel_reason",
      "site_address",
      "site_town",
      "site_phone",
      "access_note",
    ],
  },
  sign_offs: { nullable: ["visit_id", "crew_id", "photos", "copy_sent_to"] },
  snags: {
    nullable: [
      "visit_id",
      "crew_id",
      "severity",
      "raised_by_id",
      "raised_by_contact_id",
      "due_days",
      "put_right_on",
      "put_right_note",
      "photo",
      "put_right_photo",
    ],
  },
  delivery_notes: { nullable: ["crew_id", "taken_by_id", "signed_by_contact_id", "signed_name", "note"] },
  delivery_note_lines: { nullable: ["crew_id"] },
  waste_removals: { nullable: ["carrier", "note_number"] },
  // After the job
  feedback: { nullable: ["text", "theme", "replied_at", "fix_written"] },
  complaints: { nullable: ["contact_id", "job_id", "owner_id", "text", "fairness", "answered_at", "settled_at"] },
  warranty_claims: { nullable: ["contact_id", "part", "cover", "cover_years", "supplier_name", "supplier", "paid_by"] },
  // Supply
  deal_stock_needs: { nullable: ["qty", "item"] },
  // Vehicles and crew
  vehicles: { nullable: ["plate", "model", "odometer", "inspection_due", "service_due", "tax_to"] },
  vehicle_checks: { nullable: [] },
  vehicle_faults: { nullable: ["raised_by_id", "fixed_on"] },
  fuel_fills: { nullable: [] },
  time_sheets: { nullable: ["signed_by_id", "signed_at", "sent_back_note"] },
  time_sheet_lines: { nullable: ["visit_id", "job_id"] },
  certificates: { nullable: ["course_on"] },
  subcontractors: { nullable: ["days_used", "insurance_until", "certificate", "chased_at"] },
  insurance_incidents: { nullable: ["company_id", "insurer_ref"] },
  // The app's own. Every column of the outbox but its kind and status may be
  // empty: Adminium fills them as it sends, and not every email is about a quote.
  outbox: {
    nullable: [
      "created_at",
      "to",
      "language",
      "contact_id",
      "quote_id",
      "deal_id",
      "due_at",
      "sent_at",
      "error",
      "skip_reason",
      "repeat_key",
    ],
  },
  settings: {
    nullable: ["depot_name", "depot_address", "depot_town", "depot_lat", "depot_lng", "aftercare_owner_id"],
  },
};

/** How many tables the manifest holds: the 72 of the app's ten parts, the price list, and the weekdays a crew works. */
const TABLE_COUNT = 75;

/**
 * The tables only the two people of a row read: a manager and a rep. Each
 * carries its pair in these two staff columns of its own and is reached by
 * nothing else, because a private table takes no other way.
 */
const PRIVATE: Record<string, readonly [string, string]> = {
  one_to_ones: ["manager_id", "rep_id"],
  one_to_one_sessions: ["manager_id", "rep_id"],
  coaching_plans: ["manager_id", "rep_id"],
  coaching_areas: ["manager_id", "rep_id"],
};

/**
 * The `outbox` word, as a later task will write it: here only to prove that
 * the outbox TABLE is the shape the word asks for. Its kinds, its templates
 * and its producer are that task's.
 */
const OUTBOX_WORD = {
  table: "outbox",
  columns: {
    kind: "kind",
    status: "status",
    to: "to",
    language: "language",
    due: "due_at",
    sentAt: "sent_at",
    error: "error",
    skipReason: "skip_reason",
    repeatKey: "repeat_key",
  },
  links: { contact: "contact_id", quote: "quote_id", deal: "deal_id" },
  recipient: { via: "contact_id", table: "contacts", email: "email", name: "name" },
  kinds: {},
};

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE MANIFEST, READ LOOSELY                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

type Labels = Record<string, string>;

interface Column {
  ref: string;
  type: string;
  references?: string;
  role?: string;
  nullable?: boolean;
  unique?: boolean;
  index?: boolean;
  enum?: string[];
  label?: Labels;
  rules?: { staff?: boolean; enumLabels?: { labels: Record<string, Labels> } };
}

interface Through {
  table: string;
  link: string;
  on?: string;
  user: string;
  person?: string;
  from?: string;
  to?: string;
}

interface Way {
  column?: string;
  person?: string;
  set?: string;
  via?: string;
  through?: Through;
}

interface Move {
  to: string;
  requires?: { where?: { column: string; isNull?: boolean }[] };
}

interface Action {
  id: string;
  label?: Labels;
  move?: { to: string };
  ask?: string[];
  handOver?: boolean;
}

interface Table {
  ref: string;
  label?: Labels;
  labelPlural?: Labels;
  columns: Column[];
  indexes?: string[][];
  unique?: string[][];
  belongs?: Way[];
  private?: boolean;
  booking?: unknown;
  capacity?: unknown;
  states?: { column: string; initial: string; moves: Record<string, (string | Move)[]>; actions?: Action[] };
}

const tables = manifest.requiredSchema.tables as unknown as Table[];
const byRef = new Map(tables.map((table) => [table.ref, table]));

/** Whether the database can find rows by this column without reading the table. */
function indexed(table: Table, ref: string): boolean {
  const column = table.columns.find((c) => c.ref === ref);
  if (column === undefined) return false;
  if (column.role === "pk" || column.unique === true || column.index === true) return true;
  return firstInAnIndex(table, ref);
}

/** Whether a declared index starts with this column. */
function firstInAnIndex(table: Table, ref: string): boolean {
  return (table.indexes ?? []).some((set) => set[0] === ref);
}

/**
 * Whether a list limited by this staff column reads an index: first in a
 * declared set, or a unique column, which the database indexes itself (and
 * which the validator refuses a declared set for: "indexed already").
 */
function staffIndexed(table: Table, ref: string): boolean {
  return firstInAnIndex(table, ref) || table.columns.find((c) => c.ref === ref)?.unique === true;
}

/** The moves out of a state, each as `{ to, requires? }`. */
function movesFrom(table: Table, from: string): Move[] {
  return (table.states?.moves[from] ?? []).map((move) => (typeof move === "string" ? { to: move } : move));
}

/** The languages a label lacks, or holds only blank text in. */
function missing(label: Labels | undefined): string[] {
  return LOCALES.filter((locale) => (label?.[locale] ?? "").trim() === "");
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE CHECKS                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

describe("the manifest holds the tables listed here, and no other", () => {
  it("has exactly the expected tables", () => {
    expect(tables.map((table) => table.ref).sort()).toEqual(Object.keys(TABLES).sort());
  });

  it("has seventy-three of them", () => {
    expect(tables).toHaveLength(TABLE_COUNT);
    expect(Object.keys(TABLES)).toHaveLength(TABLE_COUNT);
  });

  it("gives every table a key, first", () => {
    for (const table of tables) {
      expect(table.columns[0], table.ref).toMatchObject({ ref: "id", type: "int", role: "pk" });
    }
  });
});

describe("a column may be empty only where it is listed as such", () => {
  it("names, in the expectations, only columns that exist", () => {
    // A misspelt name in `TABLES` would otherwise pass as "not nullable, as expected".
    const unknown: string[] = [];
    for (const [ref, expected] of Object.entries(TABLES)) {
      const columns = new Set((byRef.get(ref)?.columns ?? []).map((column) => column.ref));
      for (const column of expected.nullable) if (!columns.has(column)) unknown.push(`${ref}.${column}`);
    }
    expect(unknown).toEqual([]);
  });

  it("marks exactly the expected columns nullable", () => {
    const actual: Record<string, string[]> = {};
    const expected: Record<string, string[]> = {};
    for (const table of tables) {
      // The retry key is every made table's, and has its own check below.
      actual[table.ref] = table.columns.filter((column) => column.nullable === true && column.ref !== "retry_key").map((column) => column.ref).sort();
      expected[table.ref] = [...(TABLES[table.ref]?.nullable ?? [])].sort();
    }
    expect(actual).toEqual(expected);
  });

  it("keeps a retry key on every table a role makes rows of, and on no other", () => {
    // A save sent again after a lost reply answers the row the first one made, so a screen never makes two.
    const made = new Set((manifest.roles as { permissions: string[] }[]).flatMap((role) => role.permissions.filter((grant) => /^table:@[a-z_]+:create$/.test(grant)).map((grant) => grant.split(":")[1]?.slice(1) ?? "")));
    for (const table of tables) {
      const key = (table.columns as { ref: string; type: string; maxLength?: number; nullable?: boolean; unique?: boolean; rules?: Record<string, unknown> }[]).find((column) => column.ref === "retry_key");
      if (!made.has(table.ref)) expect(key, table.ref).toBeUndefined();
      else expect({ ...key, label: undefined }, table.ref).toEqual({ ref: "retry_key", type: "text", maxLength: 64, nullable: true, unique: true, rules: { retryKey: true }, label: undefined });
    }
    expect(made.size).toBeGreaterThan(50);
  });

  it("never leaves the key empty", () => {
    for (const table of tables) expect(table.columns[0]?.nullable, table.ref).toBeUndefined();
  });
});

describe("a list limited to a person's rows reads an index", () => {
  /** Every staff column a `belongs` names: the table's own, and a listing's. */
  const staffColumns: { table: string; column: string; why: string }[] = [];
  /** Every link a `via` follows, and every `link` and `on` of a listing. */
  const links: { table: string; column: string; why: string }[] = [];

  for (const table of tables) {
    for (const way of table.belongs ?? []) {
      if (way.column !== undefined) {
        // With `person`, the column is a link to the row that holds the staff member.
        if (way.person === undefined) staffColumns.push({ table: table.ref, column: way.column, why: `${table.ref} belongs by it` });
        else links.push({ table: table.ref, column: way.column, why: `${table.ref} belongs through it` });
      }
      if (way.via !== undefined) links.push({ table: table.ref, column: way.via, why: `${table.ref} is reached via it` });
      if (way.through !== undefined) {
        const { table: listing, link, on, user, person } = way.through;
        links.push({ table: listing, column: link, why: `${table.ref} is listed by it` });
        if (on !== undefined) links.push({ table: table.ref, column: on, why: `${listing} lists ${table.ref} on it` });
        if (person === undefined) staffColumns.push({ table: listing, column: user, why: `${table.ref} is listed for it` });
        else links.push({ table: listing, column: user, why: `${table.ref} is listed for the row it names` });
      }
    }
  }

  it("found ways to check, so an empty list is never a pass", () => {
    expect(staffColumns.length).toBeGreaterThan(0);
    expect(links.length).toBeGreaterThan(0);
  });

  it("names only tables and columns that exist", () => {
    const unknown = [...staffColumns, ...links]
      .filter(({ table, column }) => byRef.get(table)?.columns.some((c) => c.ref === column) !== true)
      .map(({ table, column, why }) => `${table}.${column} (${why})`);
    expect(unknown).toEqual([]);
  });

  it("holds a staff member in every column a belongs reads one from", () => {
    const plain = staffColumns
      .filter(({ table, column }) => byRef.get(table)?.columns.find((c) => c.ref === column)?.rules?.staff !== true)
      .map(({ table, column, why }) => `${table}.${column} (${why})`);
    expect(plain).toEqual([]);
  });

  it("puts every staff column a belongs names first in a declared index, or keeps it unique", () => {
    const bare = staffColumns
      .filter(({ table, column }) => {
        const found = byRef.get(table);
        return found === undefined || !staffIndexed(found, column);
      })
      .map(({ table, column, why }) => `${table}.${column} (${why})`);
    expect(bare).toEqual([]);
  });

  it("indexes every link a via follows, and every link and on of a listing", () => {
    const bare = links
      .filter(({ table, column }) => {
        const found = byRef.get(table);
        return found === undefined || !indexed(found, column);
      })
      .map(({ table, column, why }) => `${table}.${column} (${why})`);
    expect(bare).toEqual([]);
  });

  it("would catch a missing index, so the two checks above are not stubs", () => {
    const deals = structuredClone(byRef.get("deals")) as Table;
    expect(firstInAnIndex(deals, "owner_id")).toBe(true);
    deals.indexes = (deals.indexes ?? []).filter((set) => set[0] !== "owner_id");
    expect(firstInAnIndex(deals, "owner_id")).toBe(false);

    const activities = structuredClone(byRef.get("activities")) as Table;
    expect(indexed(activities, "deal_id")).toBe(true);
    activities.indexes = (activities.indexes ?? []).filter((set) => set[0] !== "deal_id");
    expect(indexed(activities, "deal_id")).toBe(false);
    // Second in a set is not enough: the database reads an index from its first column.
    activities.indexes = [["at", "deal_id"]];
    expect(indexed(activities, "deal_id")).toBe(false);
  });
});

describe("a table takes no more indexes than the validator allows", () => {
  it("declares at most six sets a table", () => {
    const over = tables.filter((table) => (table.indexes ?? []).length > 6).map((table) => table.ref);
    expect(over).toEqual([]);
  });

  it("keeps six sets on deals, the owner's with the state a board is read by", () => {
    expect(byRef.get("deals")?.indexes).toEqual([
      // A rep's board and its count are read by owner and state: with both in one set MySQL counts them from the index.
      ["owner_id", "state"],
      ["state", "stage_id"],
      ["expected_close"],
      ["company_id"],
      ["stage_id"],
      ["contact_id"],
    ]);
  });
});

describe("a deal is reached by its owner, by the people on it, and by whoever covers its owner", () => {
  it("writes the three ways a deal is somebody's", () => {
    expect(byRef.get("deals")?.belongs).toEqual([
      { column: "owner_id", set: "team" },
      { through: { table: "deal_members", link: "deal_id", user: "user_id" } },
      { through: { table: "covers", link: "owner_id", on: "owner_id", user: "cover_id", from: "starts_on", to: "ends_on" } },
    ]);
  });

  it("counts a cover by the day, on two date columns of the listing", () => {
    const covers = byRef.get("covers");
    expect(covers?.columns.find((c) => c.ref === "starts_on")).toMatchObject({ type: "date" });
    expect(covers?.columns.find((c) => c.ref === "ends_on")).toMatchObject({ type: "date", nullable: true });
    // Who covers whom is everybody's to read. A cover is written for its own rep: a manager held to
    // their team writes one for somebody they lead, never for another manager's rep (whose deals the
    // cover would open to whoever it names). roles.test.ts holds the roles to it.
    expect(covers?.belongs).toEqual([{ column: "owner_id", set: "team" }]);
  });
});

describe("the four private tables are reached by their own two people and nothing else", () => {
  it("marks exactly those four private", () => {
    expect(tables.filter((table) => table.private === true).map((table) => table.ref).sort()).toEqual(Object.keys(PRIVATE).sort());
  });

  it("gives each exactly two ways, both staff columns of its own", () => {
    for (const [ref, pair] of Object.entries(PRIVATE)) {
      const table = byRef.get(ref);
      const ways = table?.belongs ?? [];
      expect(ways, ref).toHaveLength(2);
      for (const way of ways) {
        expect(way.via, ref).toBeUndefined();
        expect(way.through, ref).toBeUndefined();
        expect(way.person, ref).toBeUndefined();
      }
      expect(ways.map((way) => way.column).sort(), ref).toEqual([...pair].sort());
      for (const column of pair) {
        const found = table?.columns.find((c) => c.ref === column);
        expect(found?.rules?.staff, `${ref}.${column}`).toBe(true);
        // A row with half a pair would be read by one person only: neither may be empty.
        expect(found?.nullable, `${ref}.${column}`).toBeUndefined();
        expect(firstInAnIndex(table as Table, column), `${ref}.${column}`).toBe(true);
      }
    }
  });

  it("holds exactly two staff columns in each", () => {
    for (const ref of Object.keys(PRIVATE)) {
      const staffColumnsOf = (byRef.get(ref)?.columns ?? []).filter((c) => c.rules?.staff === true).map((c) => c.ref);
      expect(staffColumnsOf.sort(), ref).toEqual(["manager_id", "rep_id"]);
    }
  });

  it("is reached through by no other table", () => {
    const leaning: string[] = [];
    for (const table of tables) {
      for (const way of table.belongs ?? []) {
        const parent = way.via === undefined ? undefined : table.columns.find((c) => c.ref === way.via)?.references;
        if (parent !== undefined && parent in PRIVATE && !(table.ref in PRIVATE)) leaning.push(`${table.ref} via ${way.via}`);
        if (way.through !== undefined && way.through.table in PRIVATE) leaning.push(`${table.ref} through ${way.through.table}`);
      }
    }
    expect(leaning).toEqual([]);
  });
});

describe("the listings a table is read through are limited by their own person", () => {
  it("lists a conversation's people once each", () => {
    const members = byRef.get("thread_members");
    expect(members?.unique).toEqual([["thread_id", "user_id"]]);
    // `anyone`: a member adds a colleague. The four roles change only their own row there, and a writer
    // held to their own rows names nobody but themselves in a column that does not say otherwise. A
    // stranger is kept out by the link: a new row names a conversation its writer reaches.
    expect(members?.belongs).toEqual([{ column: "user_id", set: "anyone" }]);
    expect(byRef.get("threads")?.belongs).toEqual([{ through: { table: "thread_members", link: "thread_id", user: "user_id" } }]);
    expect(byRef.get("messages")?.belongs).toEqual([{ via: "thread_id" }]);
  });

  it("keeps one profile a person", () => {
    expect(byRef.get("reps")?.columns.find((c) => c.ref === "user_id")).toMatchObject({ unique: true, rules: { staff: true } });
  });
});

describe("the moves of this batch's three state columns", () => {
  it("lets an enquiry be claimed, passed or dropped, and a passed one claimed or dropped", () => {
    const enquiries = byRef.get("enquiries") as Table;
    expect(enquiries.states).toMatchObject({ column: "state", initial: "open" });
    expect(movesFrom(enquiries, "open").map((move) => move.to)).toEqual(["claimed", "passed", "dropped"]);
    expect(movesFrom(enquiries, "passed").map((move) => move.to)).toEqual(["claimed", "dropped"]);
    expect(Object.keys(enquiries.states?.moves ?? {})).toEqual(["open", "passed"]);
  });

  it("passes an enquiry only to somebody, by a hand-over that asks who", () => {
    const enquiries = byRef.get("enquiries") as Table;
    const pass = movesFrom(enquiries, "open").find((move) => move.to === "passed");
    expect(pass?.requires?.where).toEqual([{ column: "passed_to_id", isNull: false }]);
    const button = enquiries.states?.actions?.find((action) => action.id === "pass");
    expect(button).toMatchObject({ move: { to: "passed" }, ask: ["passed_to_id"], handOver: true });
    // Two buttons hand a row over: a deal's and an enquiry's.
    const handOvers = tables.flatMap((table) => (table.states?.actions ?? []).filter((action) => action.handOver === true).map((action) => `${table.ref}.${action.id}`));
    expect(handOvers).toEqual(["deals.hand-over", "enquiries.pass"]);
  });

  it("writes who claimed an enquiry when it is claimed", () => {
    const claimedBy = byRef.get("enquiries")?.columns.find((c) => c.ref === "claimed_by_id") as unknown as { rules?: { stamp?: unknown } };
    expect(claimedBy.rules?.stamp).toEqual({ set: "user-id", on: { column: "state", values: ["claimed"] } });
  });

  it("cancels a showroom booking from any live state, and only with a reason", () => {
    const bookings = byRef.get("showroom_bookings") as Table;
    expect(bookings.states).toMatchObject({ column: "state", initial: "tentative" });
    expect(movesFrom(bookings, "tentative").map((move) => move.to)).toEqual(["confirmed", "cancelled"]);
    expect(movesFrom(bookings, "confirmed").map((move) => move.to)).toEqual(["done", "cancelled"]);
    expect(movesFrom(bookings, "done").map((move) => move.to)).toEqual(["cancelled"]);
    for (const from of ["tentative", "confirmed", "done"]) {
      const cancel = movesFrom(bookings, from).find((move) => move.to === "cancelled");
      expect(cancel?.requires?.where, from).toEqual([{ column: "cancel_reason", isNull: false }]);
    }
    expect(bookings.states?.actions?.find((action) => action.id === "cancel")).toMatchObject({ ask: ["cancel_reason"] });
  });

  it("closes a meeting's decision as done or carried", () => {
    const decisions = byRef.get("meeting_decisions") as Table;
    expect(decisions.states).toEqual({ column: "state", initial: "open", moves: { open: ["done", "carried"] } });
  });

  it("starts every states column in its first state", () => {
    for (const table of tables) {
      if (table.states === undefined) continue;
      const column = table.columns.find((c) => c.ref === table.states?.column) as unknown as { default?: string } | undefined;
      expect(column?.default, table.ref).toBe(table.states.initial);
    }
  });
});

/** A column's rules, read loosely: this batch checks more of them than the typed ones above. */
function rulesOf(table: string, column: string): Record<string, unknown> {
  const found = byRef.get(table)?.columns.find((c) => c.ref === column) as unknown as { rules?: Record<string, unknown> } | undefined;
  return found?.rules ?? {};
}

/** What a move needs, read loosely. */
function needs(table: string, from: string, to: string): unknown {
  const move = (byRef.get(table)?.states?.moves[from] ?? []).find((m) => (typeof m === "string" ? m : m.to) === to);
  return typeof move === "object" ? move.requires : undefined;
}

/** The listing a crew's rows are read through, on the row's own crew. */
const CREW_WAY = { through: { table: "crew_members", link: "crew_id", on: "crew_id", user: "user_id" } };

/** A copy that is taken from the linked row and kept in step with it. */
const follows = (via: string, from: string) => ({ via, from, mode: "always", follow: true });

describe("a crew reaches its own work, and a rep the work on their deals", () => {
  it("reaches a visit, a sign-off, a snag, a delivery note and its lines by the crew and by the job", () => {
    for (const ref of ["job_visits", "sign_offs", "snags", "delivery_notes", "delivery_note_lines"]) {
      expect(byRef.get(ref)?.belongs, ref).toEqual([CREW_WAY, { via: "job_id" }]);
    }
  });

  it("lists a crew's people once each, each limited by their own listing", () => {
    const members = byRef.get("crew_members");
    expect(members?.unique).toEqual([["crew_id", "user_id"]]);
    expect(members?.belongs).toEqual([{ column: "user_id" }]);
    // Who is in which crew is everybody's to read: the crew itself is limited by nothing.
    expect(byRef.get("crews")?.belongs).toBeUndefined();
  });

  it("reaches a job, its feedback, its warranty claims and a deal's stock needs through the deal", () => {
    expect(byRef.get("jobs")?.belongs).toEqual([{ via: "deal_id" }]);
    expect(byRef.get("feedback")?.belongs).toEqual([{ via: "job_id" }]);
    expect(byRef.get("warranty_claims")?.belongs).toEqual([{ via: "job_id" }]);
    expect(byRef.get("deal_stock_needs")?.belongs).toEqual([{ via: "deal_id" }]);
    expect(byRef.get("time_sheet_lines")?.belongs).toEqual([{ via: "sheet_id" }]);
  });

  it("limits the rest by the row's own person", () => {
    expect(byRef.get("complaints")?.belongs).toEqual([{ column: "owner_id", set: "anyone" }]);
    for (const [ref, column] of [["vehicle_checks", "by_id"], ["fuel_fills", "by_id"], ["time_sheets", "user_id"], ["certificates", "user_id"]] as const) {
      expect(byRef.get(ref)?.belongs, ref).toEqual([{ column }]);
    }
    for (const ref of ["crews", "waste_removals", "vehicles", "vehicle_faults", "subcontractors", "insurance_incidents"]) {
      expect(byRef.get(ref)?.belongs, ref).toBeUndefined();
    }
  });

  it("keeps a line's job, visit and crew in step with its note, since a note is one link too far", () => {
    // line -> note -> job -> deal is three links and a row is reached through two.
    expect(rulesOf("delivery_note_lines", "job_id").copy).toEqual(follows("note_id", "job_id"));
    expect(rulesOf("delivery_note_lines", "visit_id").copy).toEqual(follows("note_id", "visit_id"));
    expect(rulesOf("delivery_note_lines", "crew_id").copy).toEqual(follows("visit_id", "crew_id"));
    const withNote = structuredClone(manifest) as unknown as { requiredSchema: { tables: Table[] } };
    (withNote.requiredSchema.tables.find((t) => t.ref === "delivery_note_lines") as Table).belongs = [{ via: "note_id" }];
    const result = validateManifest(withNote);
    // Said once for the app as it is, and once more for the app as it is installed without Invoices & Receipts.
    expect(result.ok ? [] : result.issues.map((issue) => issue.message).filter((message) => !message.startsWith("installed without"))).toEqual(["a row is reached through at most 2 links"]);
  });
});

describe("what Adminium copies, numbers and stamps on the jobs tables", () => {
  it("copies a job's title, company and contact from its deal, and keeps them in step", () => {
    expect(rulesOf("jobs", "title").copy).toEqual(follows("deal_id", "name"));
    expect(rulesOf("jobs", "company_id").copy).toEqual(follows("deal_id", "company_id"));
    expect(rulesOf("jobs", "contact_id").copy).toEqual(follows("deal_id", "contact_id"));
    expect(byRef.get("jobs")?.columns.find((c) => c.ref === "deal_id")).toMatchObject({ type: "fk", references: "deals", unique: true });
  });

  it("copies the five site columns of a visit from its job", () => {
    const pairs = { site_name: "site_name", site_address: "address_lines", site_town: "town", site_phone: "site_phone", access_note: "access_note" };
    for (const [own, from] of Object.entries(pairs)) expect(rulesOf("job_visits", own).copy, own).toEqual(follows("job_id", from));
  });

  it("copies the crew of a sign-off, a snag and a delivery note from their visit", () => {
    for (const ref of ["sign_offs", "snags", "delivery_notes"]) {
      expect(rulesOf(ref, "crew_id").copy, ref).toEqual(follows("visit_id", "crew_id"));
      expect(byRef.get(ref)?.columns.find((c) => c.ref === "crew_id"), ref).toMatchObject({ type: "int", nullable: true });
    }
  });

  it("numbers a job J-01, J-02 in the order jobs are made", () => {
    // The sample's jobs take J-01 to J-08 in the series, and the first real job follows them.
    expect(rulesOf("jobs", "code_seq").sequence).toEqual({ gapless: true, start: 1, sample: true });
    expect(rulesOf("jobs", "code").format).toEqual({ from: "code_seq", prefix: "J-", pad: 2 });
    expect(byRef.get("jobs")?.columns.find((c) => c.ref === "code")).toMatchObject({ type: "text", maxLength: 12, unique: true });
  });

  it("stamps the day a row is raised, and who raised it", () => {
    for (const ref of ["snags", "complaints", "warranty_claims", "vehicle_faults"]) {
      expect(rulesOf(ref, "raised_on").stamp, ref).toEqual({ set: "today", on: "create" });
    }
    expect(rulesOf("sign_offs", "signed_at").stamp).toEqual({ set: "now", on: "create" });
    for (const [ref, column] of [["vehicle_checks", "by_id"], ["fuel_fills", "by_id"], ["vehicle_faults", "raised_by_id"]] as const) {
      expect(rulesOf(ref, column), `${ref}.${column}`).toMatchObject({ staff: true, stamp: { set: "user-id", on: "create" } });
    }
  });

  it("works a snag's due day out from the day it was raised and the setting, taken when it is made", () => {
    expect(rulesOf("snags", "due_days").default).toEqual({ from: { table: "settings", column: "snag_days" } });
    expect(rulesOf("snags", "due_on").stamp).toEqual({ set: { addDays: { date: "raised_on", days: "due_days" } }, on: "create" });
    expect(byRef.get("settings")?.columns.find((c) => c.ref === "snag_days")).toMatchObject({ type: "int" });
  });

  it("stamps the moves of a complaint, a snag and a time sheet", () => {
    expect(rulesOf("complaints", "answered_at").stamp).toEqual({ set: "now", on: { column: "state", values: ["answered"] } });
    expect(rulesOf("complaints", "settled_at").stamp).toEqual({ set: "now", on: { column: "state", values: ["settled"] } });
    expect(rulesOf("snags", "put_right_on").stamp).toEqual({ set: "today", on: { column: "state", values: ["put-right"] } });
    expect(rulesOf("time_sheets", "signed_at").stamp).toEqual({ set: "now", on: { column: "state", values: ["signed-off"] } });
    expect(rulesOf("time_sheets", "signed_by_id")).toMatchObject({ staff: true, stamp: { set: "user-id", on: { column: "state", values: ["signed-off"] } } });
  });

  it("holds one feedback and one sign-off a job, a score from 1 to 5, and one sheet a person a week", () => {
    for (const ref of ["feedback", "sign_offs"]) expect(byRef.get(ref)?.columns.find((c) => c.ref === "job_id"), ref).toMatchObject({ unique: true });
    expect(rulesOf("feedback", "score").validation).toEqual({ min: 1, max: 5 });
    expect(byRef.get("time_sheets")?.unique).toEqual([["user_id", "week_of"]]);
  });

  it("links a follow-up to a job, for lookups only", () => {
    const followUps = byRef.get("follow_ups") as Table;
    expect(followUps.columns.find((c) => c.ref === "job_id")).toMatchObject({ type: "fk", references: "jobs", nullable: true });
    expect(followUps.indexes).toEqual([["owner_id", "done", "due_at"], ["deal_id"], ["job_id"]]);
    // It is still reached by its own person: no way follows the link.
    expect(followUps.belongs).toEqual([{ column: "owner_id", set: "team" }]);
  });
});

describe("the moves of the jobs, aftercare and crew tables", () => {
  /** Every move of each table, from each state, in order. */
  const MOVES: Record<string, { initial: string; moves: Record<string, string[]> }> = {
    jobs: { initial: "open", moves: { open: ["installed"], installed: ["signed-off"] } },
    job_visits: { initial: "waiting", moves: { waiting: ["booked"], booked: ["done", "waiting", "cancelled"] } },
    snags: { initial: "open", moves: { open: ["waiting-part", "put-right"], "waiting-part": ["open", "put-right"] } },
    complaints: { initial: "open", moves: { open: ["answered"], answered: ["settled"] } },
    warranty_claims: {
      initial: "to-raise",
      moves: {
        "to-raise": ["with-supplier", "turned-down"],
        "with-supplier": ["parts-coming", "turned-down"],
        "parts-coming": ["sorted", "turned-down"],
        sorted: ["turned-down"],
      },
    },
    time_sheets: { initial: "open", moves: { open: ["sent"], sent: ["signed-off", "sent-back"], "sent-back": ["sent"] } },
    insurance_incidents: { initial: "open", moves: { open: ["settled"] } },
  };

  it("writes exactly these moves", () => {
    for (const [ref, expected] of Object.entries(MOVES)) {
      const table = byRef.get(ref) as Table;
      expect(table.states, ref).toMatchObject({ column: "state", initial: expected.initial });
      const actual = Object.fromEntries(Object.keys(table.states?.moves ?? {}).map((from) => [from, movesFrom(table, from).map((move) => move.to)]));
      expect(actual, ref).toEqual(expected.moves);
    }
  });

  it("keeps a move for a role only where the roles' test says so: a sent time sheet", () => {
    // Which role, and why, is roles.test.ts's to hold.
    const kept: string[] = [];
    for (const ref of Object.keys(MOVES)) {
      for (const [from, moves] of Object.entries(byRef.get(ref)?.states?.moves ?? {})) {
        for (const move of moves) if (typeof move === "object" && (move as unknown as { roles?: unknown }).roles !== undefined) kept.push(`${ref} ${from}`);
      }
    }
    expect(kept).toEqual(["time_sheets sent", "time_sheets sent"]);
  });

  it("books a visit only with a day and a crew, and not before its stock is ready", () => {
    expect(needs("job_visits", "waiting", "booked")).toEqual({ where: [{ column: "day", isNull: false }, { column: "crew_id", isNull: false }] });
    expect(rulesOf("job_visits", "day").notBefore).toEqual({ column: "stock_ready_on", when: [{ column: "state", in: ["booked"] }] });
    expect(needs("job_visits", "booked", "cancelled")).toEqual({ where: [{ column: "cancel_reason", isNull: false }] });
    expect(byRef.get("job_visits")?.states?.actions?.find((action) => action.id === "cancel")).toMatchObject({ ask: ["cancel_reason"] });
  });

  it("signs a job off only with a sign-off, and with no open snag that stops it", () => {
    const jobs = byRef.get("jobs") as Table;
    expect(needs("jobs", "installed", "signed-off")).toEqual({ children: { sign_offs: 1 }, where: [{ column: "blocking_snags", eq: 0 }] });
    expect((jobs.states as unknown as { children?: unknown }).children).toEqual({ sign_offs: { via: "job_id", createIn: ["open", "installed"] } });
    // The count Adminium keeps: snags of the job that stop sign-off and are not put right.
    expect(rulesOf("jobs", "blocking_snags").rollup).toEqual({
      from: "snags",
      via: "job_id",
      count: true,
      where: { column: "stops_sign_off", eq: true },
      unlessSet: "put_right_on",
    });
    expect(jobs.columns.find((c) => c.ref === "blocking_snags")).toMatchObject({ type: "int", default: 0 });
    // The link the count goes by is the one link of this batch indexed as such.
    expect(byRef.get("snags")?.columns.find((c) => c.ref === "job_id")).toMatchObject({ index: true });
    expect(byRef.get("snags")?.columns.find((c) => c.ref === "stops_sign_off")).toMatchObject({ type: "bool", default: false });
  });

  it("puts a snag right only with a note, from either state", () => {
    for (const from of ["open", "waiting-part"]) {
      expect(needs("snags", from, "put-right"), from).toEqual({ where: [{ column: "put_right_note", isNull: false }] });
    }
    expect(byRef.get("snags")?.states?.actions?.find((action) => action.id === "put-right")).toMatchObject({ ask: ["put_right_note"] });
  });

  it("sends a time sheet back only with a note, and locks a sent sheet and its lines", () => {
    expect(needs("time_sheets", "sent", "sent-back")).toEqual({ where: [{ column: "sent_back_note", isNull: false }] });
    const states = byRef.get("time_sheets")?.states as unknown as { lock?: unknown; children?: unknown; actions?: Action[] };
    expect(states.lock).toEqual({ when: ["sent", "signed-off"], except: ["sent_back_note"] });
    expect(states.children).toEqual({ time_sheet_lines: { via: "sheet_id", lock: true } });
    expect(states.actions?.find((action) => action.id === "send-back")).toMatchObject({ move: { to: "sent-back" }, ask: ["sent_back_note"] });
  });

  it("offers a button for every state a move reaches by hand", () => {
    for (const [ref, expected] of Object.entries(MOVES)) {
      const reached = new Set(Object.values(expected.moves).flat());
      const offered = new Set((byRef.get(ref)?.states?.actions ?? []).map((action) => action.move?.to));
      expect([...offered].sort(), ref).toEqual([...reached].sort());
    }
  });
});

describe("what this batch leaves for a later one", () => {
  it("lets no two live bookings of one showroom space overlap", () => {
    // Not the core's booking rule (kinds of visit, who does what, a grid): the plain one. A space, a
    // start and its minutes; a cancelled booking and one that is over take nothing.
    const bookings = byRef.get("showroom_bookings") as unknown as { occupies?: unknown; booking?: unknown; capacity?: unknown };
    expect(bookings.occupies).toEqual({ resource: "space_id", start: "starts_at", minutes: "minutes", countWhere: { column: "state", values: ["tentative", "confirmed"] } });
    expect(bookings.booking).toBeUndefined();
    expect(bookings.capacity).toBeUndefined();
  });

  it("links a stock item and a supplier into Inventory, as the whole number Inventory's keys are", () => {
    // Inventory is suggested, not required: the column is there either way, with no foreign key.
    // While the add-on is absent a value is refused; while it is there, the value must be a row's key.
    // A whole number, not text: Inventory's keys are, and a text link into them is a database error on Postgres.
    const link = (table: string, column: string) => byRef.get(table)?.columns.find((c) => c.ref === column) as unknown as { type: string; nullable?: boolean; maxLength?: number; rules?: unknown };
    for (const table of ["deal_stock_needs", "samples", "display_pieces"]) {
      expect(link(table, "item"), table).toEqual(expect.objectContaining({ type: "int", nullable: true, rules: { addOnLink: { addOn: "inventory", table: "items" } } }));
    }
    expect(link("warranty_claims", "supplier")).toEqual(expect.objectContaining({ type: "int", nullable: true, rules: { addOnLink: { addOn: "inventory", table: "suppliers" } } }));
    // The add-on is one the manifest names.
    const suggests = (manifest as unknown as { addOns: { suggests: { key: string }[] } }).addOns.suggests.map((one) => one.key);
    expect(suggests).toContain("inventory");
  });

  it("refuses a booked visit on a weekday its crew does not work, and lets a crew do several a day", () => {
    // The rows share the day (over a crew's normal day is allowed and flagged when read): only the
    // crew's week is asked, and only of a visit that is booked. A crew with no days written keeps no week.
    const visits = byRef.get("job_visits") as unknown as { occupies?: unknown; booking?: unknown; capacity?: unknown };
    expect(visits.occupies).toEqual({
      resource: "crew_id",
      day: "day",
      shared: true,
      countWhere: { column: "state", values: ["booked"] },
      hours: { table: "crew_days", resource: "crew_id", weekday: "weekday" },
    });
    expect(visits.booking).toBeUndefined();
    expect(visits.capacity).toBeUndefined();
    const days = byRef.get("crew_days") as unknown as { unique?: string[][]; columns: { ref: string; type: string; enum?: string[]; references?: string }[] };
    expect(days.unique).toEqual([["crew_id", "weekday"]]);
    expect(days.columns.find((c) => c.ref === "crew_id")).toMatchObject({ type: "fk", references: "crews" });
    expect(days.columns.find((c) => c.ref === "weekday")?.enum).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });

  it("declares the outbox over the table, with a template for each of its three kinds", () => {
    const box = (manifest as unknown as { outbox: typeof OUTBOX_WORD & { kinds: Record<string, string> } }).outbox;
    expect({ ...box, kinds: {}, producers: undefined }).toEqual({ ...OUTBOX_WORD, producers: undefined });
    expect(Object.keys(box.kinds)).toEqual(byRef.get("outbox")?.columns.find((c) => c.ref === "kind")?.enum);
  });
});

describe("the outbox table is the shape the outbox word asks for", () => {
  it("validates with the word written over it, and no kind", () => {
    const withWord = { ...structuredClone(manifest), outbox: OUTBOX_WORD };
    const result = validateManifest(withWord);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it("offers every status Adminium writes, and held", () => {
    const status = byRef.get("outbox")?.columns.find((c) => c.ref === "status");
    expect(status?.enum).toEqual(["held", "queued", "sent", "failed", "skipped"]);
  });

  it("keeps every link of it empty-able, since not every email is about one", () => {
    const links = (byRef.get("outbox")?.columns ?? []).filter((c) => c.type === "fk");
    expect(links.map((c) => c.ref)).toEqual(["contact_id", "quote_id", "deal_id"]);
    for (const link of links) expect(link.nullable, link.ref).toBe(true);
  });

  it("would refuse a word that names a column the table lacks, so the check above is no stub", () => {
    const broken = { ...structuredClone(manifest), outbox: { ...OUTBOX_WORD, columns: { ...OUTBOX_WORD.columns, due: "due" } } };
    expect(validateManifest(broken).ok).toBe(false);
  });
});

describe("every table, column and enum value is named in all eight languages", () => {
  it("names each table, one row of it and many", () => {
    const gaps: string[] = [];
    for (const table of tables) {
      for (const locale of missing(table.label)) gaps.push(`${table.ref} label ${locale}`);
      for (const locale of missing(table.labelPlural)) gaps.push(`${table.ref} labelPlural ${locale}`);
    }
    expect(gaps).toEqual([]);
  });

  it("names each column but the key", () => {
    const gaps: string[] = [];
    for (const table of tables) {
      for (const column of table.columns) {
        if (column.role === "pk") continue;
        for (const locale of missing(column.label)) gaps.push(`${table.ref}.${column.ref} ${locale}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("names each value of each enum", () => {
    const gaps: string[] = [];
    for (const table of tables) {
      for (const column of table.columns) {
        if (column.type !== "enum") continue;
        const labels = column.rules?.enumLabels?.labels ?? {};
        for (const value of column.enum ?? []) {
          for (const locale of missing(labels[value])) gaps.push(`${table.ref}.${column.ref} "${value}" ${locale}`);
        }
        for (const value of Object.keys(labels)) {
          if (!(column.enum ?? []).includes(value)) gaps.push(`${table.ref}.${column.ref} labels "${value}", which is no value of it`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it("names each button of a table's states", () => {
    const gaps: string[] = [];
    let buttons = 0;
    for (const table of tables) {
      for (const action of table.states?.actions ?? []) {
        buttons += 1;
        for (const locale of missing(action.label)) gaps.push(`${table.ref} button "${action.id}" ${locale}`);
      }
    }
    expect(buttons).toBeGreaterThan(0);
    expect(gaps).toEqual([]);
  });

  it("uses no language outside the eight", () => {
    const strays: string[] = [];
    const known = new Set<string>(LOCALES);
    const check = (where: string, label: Labels | undefined): void => {
      for (const locale of Object.keys(label ?? {})) if (!known.has(locale)) strays.push(`${where} ${locale}`);
    };
    for (const table of tables) {
      check(table.ref, table.label);
      check(table.ref, table.labelPlural);
      for (const column of table.columns) check(`${table.ref}.${column.ref}`, column.label);
    }
    expect(strays).toEqual([]);
  });
});
