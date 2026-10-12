/**
 * The tables of `manifest.json`, held to what the plan says of them.
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

import manifest from "../../manifest.json";
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
      "owner_id",
      "expected_close",
      "closed_at",
      "lost_reason_id",
      "close_note",
      "typed_amount",
      "quoted_amount",
      "quote_id",
      "list_value",
      "closed_team",
    ],
  },
  deal_stage_changes: { nullable: ["from_stage_id", "by_id"] },
  follow_ups: { nullable: ["deal_id", "call_no", "outcome", "done_by_id", "done_at"] },
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
      "threshold_pct",
      "asked_by_id",
      "asked_at",
      "ask_reason",
      "decided_by_id",
      "approval_decided_at",
      "decision_note",
      "sent_to_contact_id",
      "notes",
      "share_code",
      "accepted_name",
      "withdrawn_at",
    ],
  },
  quote_lines: { nullable: ["description", "rate", "discount", "currency", "amount", "list_rate"] },
  comments: { nullable: ["parent_id", "settled_by_id", "settled_at"] },
  saved_views: { nullable: ["owner_id"] },
  saved_searches: { nullable: ["owner_id", "last_run_at"] },
  nudge_snoozes: { nullable: [] },
  deal_members: { nullable: ["role_note"] },
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

/** How many tables the manifest holds after this batch (the plan lists 72 in all). */
const TABLE_COUNT = 50;

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

describe("the manifest holds the tables the plan lists, and no other", () => {
  it("has exactly the expected tables", () => {
    expect(tables.map((table) => table.ref).sort()).toEqual(Object.keys(TABLES).sort());
  });

  it("has fifty of them", () => {
    expect(tables).toHaveLength(TABLE_COUNT);
    expect(Object.keys(TABLES)).toHaveLength(TABLE_COUNT);
  });

  it("gives every table a key, first", () => {
    for (const table of tables) {
      expect(table.columns[0], table.ref).toMatchObject({ ref: "id", type: "int", role: "pk" });
    }
  });
});

describe("a column may be empty only where the plan says so", () => {
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
      actual[table.ref] = table.columns.filter((column) => column.nullable === true).map((column) => column.ref).sort();
      expected[table.ref] = [...(TABLES[table.ref]?.nullable ?? [])].sort();
    }
    expect(actual).toEqual(expected);
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

  it("left the six sets of deals as they were", () => {
    expect(byRef.get("deals")?.indexes).toEqual([
      ["owner_id"],
      ["state", "stage_id"],
      ["expected_close"],
      ["company_id"],
      ["stage_id"],
      ["contact_id"],
    ]);
  });
});

describe("a deal is reached by its owner, by the people on it, and by whoever covers its owner", () => {
  it("writes the three ways as the plan does", () => {
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
    // Who covers whom is everybody's to read: the listing itself is limited by nothing.
    expect(covers?.belongs).toBeUndefined();
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
    expect(members?.belongs).toEqual([{ column: "user_id" }]);
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
    // No other button of this batch hands a row over.
    const handOvers = tables.flatMap((table) => (table.states?.actions ?? []).filter((action) => action.handOver === true).map((action) => `${table.ref}.${action.id}`));
    expect(handOvers).toEqual(["enquiries.pass"]);
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

describe("what this batch leaves for a later one", () => {
  it("holds no overlap rule on a showroom booking yet", () => {
    // The core's booking rule needs a kind, a table of who does what, weekly
    // hours and a grid, none of which the plan gives the showroom. The day one
    // is written, this fails and the note in the plan is struck.
    const bookings = byRef.get("showroom_bookings");
    expect(bookings?.booking).toBeUndefined();
    expect(bookings?.capacity).toBeUndefined();
  });

  it("keeps an Inventory item as plain text until the add-on link is written", () => {
    for (const ref of ["samples", "display_pieces"]) {
      const item = byRef.get(ref)?.columns.find((c) => c.ref === "item") as unknown as { type: string; maxLength?: number; rules?: unknown };
      expect(item, ref).toEqual(expect.objectContaining({ type: "text", maxLength: 64, nullable: true }));
      expect(item.rules, ref).toBeUndefined();
    }
  });

  it("declares no outbox yet: no kind has a template", () => {
    expect((manifest as unknown as { outbox?: unknown }).outbox).toBeUndefined();
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
