/**
 * The tables of `manifest.json`, held to what the plan says of them.
 *
 * The validator checks that the manifest is well formed. It does not know which
 * tables the app is meant to have, which columns may be empty, or that a list
 * limited to a person's rows needs an index to stay fast: a staff column with
 * no index still validates, and still installs. Those are checked here.
 *
 * The expectations are data, at the top: a later batch of tables extends
 * `TABLES`, and nothing below it.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../manifest.json";

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

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE MANIFEST, READ LOOSELY                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

type Labels = Record<string, string>;

interface Column {
  ref: string;
  type: string;
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
}

interface Way {
  column?: string;
  person?: string;
  via?: string;
  through?: Through;
}

interface Table {
  ref: string;
  label?: Labels;
  labelPlural?: Labels;
  columns: Column[];
  indexes?: string[][];
  belongs?: Way[];
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
