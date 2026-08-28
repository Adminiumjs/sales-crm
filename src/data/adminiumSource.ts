// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `DataSource` backed by a real Adminium instance (28-public-surface.md §5.2,
 * 28-T28 wave 4).
 *
 * ── READS DO NOT BECOME ASYNC ──────────────────────────────────────────────
 * `loadSnapshot` fetches the whole read-set once, before React mounts, and
 * hands back the same SYNCHRONOUS shapes `demoSource` returns — so the store,
 * the pipeline engine and every screen are untouched.
 *
 * ── EVERY KEY HERE IS A SERIAL: THE people-ops PATTERN, NOT THE hotel ONE ──
 * There is not one slug in this schema. Users, companies, contacts, stages,
 * deals, activities and tasks are all `serial`, so every id below is a row id
 * stringified. That is INTERNALLY consistent — every reference between them is
 * a foreign key to the same table, so the graph never disagrees with itself —
 * and it is why this app needed no migration to work. What it costs is that
 * nothing is portable: a deal's stage is "3" here and "7" in the next
 * deployment, and a saved board layout or an exported report cannot be moved.
 *
 * ── ONE CLOSED VOCABULARY SURVIVES, AND IT IS THE INTERESTING ONE ──────────
 * `companies.industry` is CHECK-constrained to nine values which are exactly
 * the app's own sector keys, so `data.sector.<industry>` is DERIVED and a
 * German reader sees a translated sector. `users.role` is the same shape.
 * Those two are §5.5's `catalogue` classification working as designed. Every
 * other translatable column here — a stage's name, a deal's name, a contact's
 * title, a lost reason — is `operator` text and ships untranslated, which is
 * correct: they are the tenant's words, not the app's.
 *
 * ── `StageId` IS STILL A COMPILE-TIME UNION OF FIVE ────────────────────────
 * The app's type says a stage is one of five names; the database says a stage
 * is a row in a pipeline. Nothing below rejects a sixth stage — the board draws
 * whatever `stages` returns, in `position` order — so a tenant with a seven-
 * stage pipeline gets seven columns. The union is now a lie the compiler tells
 * itself, and widening it is 28-T36's job, not a mapping's.
 *
 * ── WHAT THE SCHEMA CANNOT SAY (WS-I gaps, marked not hidden) ──────────────
 * G-1 There is no `first` name and no logo file. The first word of `name` is
 *     used for one, and the other is derived from the company's domain.
 * G-2 `pipelines` allows many and the board draws one. The lowest pipeline id
 *     wins, stably; a tenant with two pipelines sees only the first.
 * G-3 A deal has no "opened" date of its own — `created_at` is when the ROW was
 *     made, which is the same thing only if the CRM was there first.
 * G-4 `activities.type` has `stage_change` where the app has `stage`; the two
 *     are mapped, and any other type is dropped rather than rendered blank.
 * G-5 A follow-up is a `tasks` row, and `tasks.deal_id` is nullable. A task
 *     attached to no deal has no screen to appear on and is dropped.
 */

import { createPublicClient, toTenantDay, type PublicClient } from "@adminiumjs/public-client";

import type {
  Activity,
  ActivityType,
  ClosedDeal,
  Company,
  Contact,
  Deal,
  FollowUp,
  Rep,
  Stage,
  StageId,
} from "./types.ts";
import type { DataSource } from "./source.ts";

/* --------------------------------------------------------------- the wire */

interface WireUser {
  id: number;
  name: string;
  email: string;
  initials: string;
  tint: string;
  role: string;
}

interface WireCompany {
  id: number;
  name: string;
  domain: string;
  industry: string;
  city: string;
  headcount: number;
  initials: string;
  tint: string;
  icon: string;
  since_note: string;
  note: string;
}

interface WireContact {
  id: number;
  company_id: number;
  name: string;
  email: string;
  phone: string;
  title: string;
  initials: string;
}

interface WirePipeline {
  id: number;
  name: string;
}

interface WireStage {
  id: number;
  pipeline_id: number;
  name: string;
  position: number;
  probability: number;
}

interface WireDeal {
  id: number;
  name: string;
  company_id: number;
  contact_id: number | null;
  stage_id: number;
  /** `numeric` serializes as a STRING, not a number. */
  amount: string;
  expected_close: string | null;
  status: string;
  lost_reason: string;
  owner_id: number;
  scope: string;
  stage_entered_at: string;
  closed_on: string | null;
  created_at: string;
}

interface WireActivity {
  id: number;
  deal_id: number;
  type: string;
  summary: string;
  created_by: number | null;
  created_at: string;
}

interface WireTask {
  id: number;
  deal_id: number | null;
  title: string;
  due_at: string | null;
  done: boolean;
}

/** WS-I G-4: the schema's word for a stage move is not the app's. */
const ACTIVITY_TYPES: Record<string, ActivityType> = {
  call: "call",
  email: "email",
  meeting: "meeting",
  note: "note",
  stage_change: "stage",
};

/**
 * The columns the scope must expose, checked at boot.
 *
 * Fail with a legible message naming the missing column rather than at render
 * with a 403 on a screen nobody was looking at — an operator can narrow a scope
 * at any time, and this turns that into a startup error.
 */
const REQUIRED = {
  users: ["id", "name", "email", "initials", "tint", "role"],
  companies: [
    "id", "name", "domain", "industry", "city", "headcount",
    "initials", "tint", "icon", "since_note", "note",
  ],
  contacts: ["id", "company_id", "name", "email", "phone", "title", "initials"],
  pipelines: ["id", "name"],
  stages: ["id", "pipeline_id", "name", "position", "probability"],
  deals: [
    "id", "name", "company_id", "contact_id", "stage_id", "amount", "expected_close",
    "status", "lost_reason", "owner_id", "scope", "stage_entered_at", "closed_on", "created_at",
  ],
  activities: ["id", "deal_id", "type", "summary", "created_by", "created_at"],
  tasks: ["id", "deal_id", "title", "due_at", "done"],
};

export interface Snapshot {
  now: Date;
  stages: Stage[];
  reps: Rep[];
  manager: Rep;
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  history: ClosedDeal[];
  followUps: FollowUp[];
  activities: Activity[];
}

/**
 * The client, or null when either build-time variable is absent.
 *
 * The emptiness check is `createPublicClient`'s, not repeated here: it already
 * treats a missing or empty value as "this build has no server", and a second
 * copy of that rule is a second place for it to drift.
 */
export function clientFromEnv(): PublicClient | null {
  return createPublicClient({
    baseUrl: import.meta.env["VITE_ADMINIUM_API_BASE_URL"] as string | undefined,
    publishableKey: import.meta.env["VITE_ADMINIUM_PUBLISHABLE_KEY"] as string | undefined,
  });
}

/**
 * Read a whole ref, a page at a time.
 *
 * The page size is the SCOPE's — `refs[ref].limit` is the operator's ceiling
 * and asking for more than it allows is refused. A pipeline larger than one
 * page would otherwise lose its tail and the forecast would be quietly short.
 */
async function listAll<T>(
  client: PublicClient,
  ref: string,
  size: number,
  max: number,
): Promise<T[]> {
  const out: T[] = [];
  const page = Math.max(1, Math.min(size, 500));
  for (let offset = 0; offset < max; offset += page) {
    const res = await client.list<T>(ref, { limit: page, offset });
    out.push(...res.data);
    if (res.data.length < page) return out;
  }
  console.warn(`[adminium] ${ref}: stopped at ${String(max)} rows — the rest were not read.`);
  return out;
}

/**
 * Fetch the read-set and map it into the app's shapes.
 *
 * Returns `null` on ANY failure so the caller falls back to demo mode
 * structurally rather than in a catch — the marketplace demos are static clones
 * with no server and must keep working byte-identically.
 */
export async function loadSnapshot(client: PublicClient): Promise<Snapshot | null> {
  try {
    await client.assertRefs(REQUIRED);
    const config = await client.config();
    const tz = config.timezone;
    const cap = (ref: string): number => config.refs[ref]?.limit ?? 100;

    const [users, companies, contacts, pipelines, stages, deals, activities, tasks] =
      await Promise.all([
        listAll<WireUser>(client, "users", cap("users"), 1_000),
        listAll<WireCompany>(client, "companies", cap("companies"), 10_000),
        listAll<WireContact>(client, "contacts", cap("contacts"), 50_000),
        listAll<WirePipeline>(client, "pipelines", cap("pipelines"), 100),
        listAll<WireStage>(client, "stages", cap("stages"), 500),
        listAll<WireDeal>(client, "deals", cap("deals"), 50_000),
        listAll<WireActivity>(client, "activities", cap("activities"), 100_000),
        listAll<WireTask>(client, "tasks", cap("tasks"), 50_000),
      ]);

    /* WS-I G-2: the board draws one pipeline. Lowest id, stably, so the columns
     * do not reshuffle between loads. */
    const pipeline = [...pipelines].sort((a, b) => a.id - b.id)[0];
    const own = stages
      .filter((s) => pipeline !== undefined && s.pipeline_id === pipeline.id)
      .sort((a, b) => a.position - b.position);

    const mappedStages: Stage[] = own.map((row) => ({
      // The app's union is a lie the compiler tells itself here; see the header.
      id: String(row.id) as StageId,
      // Operator text. `label()` resolves with `tOr(key, key)`, so a value that
      // is not a key renders literally — which is what a tenant's own stage
      // name should do.
      label: row.name,
      odds: row.probability / 100,
    }));
    const knownStage = new Set(own.map((s) => s.id));

    const reps: Rep[] = users.map((row) => ({
      id: String(row.id),
      name: row.name,
      // WS-I G-1: no given-name column. The first word, which is right for most
      // names and wrong for some — and visibly so, rather than silently.
      first: row.name.split(" ")[0] ?? row.name,
      ini: row.initials,
      // A closed vocabulary the schema itself enforces: `data.role.rep` and
      // `data.role.manager` both exist, so this one IS translated.
      role: `data.role.${row.role}`,
      tint: row.tint,
    }));
    const repById = new Map(reps.map((r) => [r.id, r]));

    const mappedCompanies: Company[] = companies.map((row) => ({
      id: String(row.id),
      name: row.name,
      ini: row.initials,
      // The other enforced vocabulary — nine industries, nine `data.sector.*`
      // keys, translated in every locale.
      sector: `data.sector.${row.industry}`,
      headcount: row.headcount,
      city: row.city,
      tint: row.tint,
      icon: row.icon,
      // WS-I G-1: no logo file. Derived from the domain so the chip reads like
      // a filename rather than being blank.
      file: fileFor(row.domain, row.name),
      since: row.since_note,
      note: row.note,
    }));

    const mappedContacts: Contact[] = contacts.map((row) => ({
      id: String(row.id),
      name: row.name,
      ini: row.initials,
      role: row.title,
      co: String(row.company_id),
      email: row.email,
      phone: row.phone,
    }));

    const open: Deal[] = [];
    const closed: ClosedDeal[] = [];
    for (const row of deals) {
      const opened = toTenantDay(row.created_at, tz);
      if (row.status === "open") {
        /* A deal whose stage belongs to another pipeline has no column on this
         * board. Dropped rather than piled into the first column, which would
         * quietly inflate the forecast. */
        if (!knownStage.has(row.stage_id)) continue;
        open.push({
          id: String(row.id),
          name: row.name,
          co: String(row.company_id),
          amount: Number(row.amount),
          stage: String(row.stage_id) as StageId,
          owner: String(row.owner_id),
          // WS-I G-3: `created_at` is when the row was made, not when the deal
          // was opened. They agree only if the CRM was there first.
          opened,
          since: toTenantDay(row.stage_entered_at, tz),
          // A deal with no expected close has no place on a dated board; its
          // own opening date is the least misleading stand-in.
          close: row.expected_close ?? opened,
          scope: row.scope,
          main: row.contact_id === null ? "" : String(row.contact_id),
        });
        continue;
      }
      // The constraint guarantees a closed deal has a closing date; belt and
      // braces, because a violated constraint would otherwise render "Invalid".
      if (row.closed_on === null) continue;
      const record: ClosedDeal = {
        id: String(row.id),
        name: row.name,
        co: String(row.company_id),
        amount: Number(row.amount),
        owner: String(row.owner_id),
        opened,
        closed: row.closed_on,
        won: row.status === "won",
      };
      if (row.status === "lost" && row.lost_reason.length > 0) record.reason = row.lost_reason;
      closed.push(record);
    }

    const liveDeals = new Set(open.map((d) => d.id));

    const mappedActivities: Activity[] = [];
    for (const row of activities) {
      const type = ACTIVITY_TYPES[row.type];
      // WS-I G-4: an unrecognised type has no icon and no label. Dropped.
      if (type === undefined) continue;
      mappedActivities.push({
        id: String(row.id),
        deal: String(row.deal_id),
        type,
        at: stampOf(row.created_at, tz),
        who: row.created_by === null ? "" : String(row.created_by),
        text: row.summary,
      });
    }

    const followUps: FollowUp[] = [];
    for (const row of tasks) {
      // WS-I G-5: a task attached to no deal, or already done, has no screen.
      if (row.done || row.deal_id === null || row.due_at === null) continue;
      if (!liveDeals.has(String(row.deal_id))) continue;
      followUps.push({
        id: String(row.id),
        deal: String(row.deal_id),
        due: stampOf(row.due_at, tz),
        text: row.title,
      });
    }

    /* The manager persona needs somebody to be. A tenant with no manager gets
     * the first user rather than a crash — and if there are no users at all,
     * a blank one, because an empty CRM is a legitimate state. */
    const manager =
      reps.find((r) => users.find((u) => String(u.id) === r.id)?.role === "manager") ??
      repById.values().next().value ??
      { id: "", name: "", first: "", ini: "", role: "data.role.manager", tint: "#4f46e5" };

    return {
      now: new Date(),
      stages: mappedStages,
      reps,
      manager,
      companies: mappedCompanies,
      contacts: mappedContacts,
      deals: open,
      history: closed,
      followUps,
      activities: mappedActivities,
    };
  } catch (error) {
    console.warn("[adminium] connected mode unavailable, using demo data:", error);
    return null;
  }
}

/** `YYYY-MM-DD HH:mm` in the TENANT's zone — the app's stamp format. */
function stampOf(iso: string, timezone: string): string {
  const day = toTenantDay(iso, timezone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return `${day} ${parts}`;
}

/** "meridian.example" → "meridian.svg". WS-I G-1: presentation, not data. */
function fileFor(domain: string, name: string): string {
  const stem = domain.length > 0 ? (domain.split(".")[0] ?? domain) : name;
  return `${stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.svg`;
}

/** A synchronous `DataSource` over an already-fetched snapshot. */
export function snapshotSource(snap: Snapshot): DataSource {
  return {
    now: () => new Date(snap.now),
    stages: () => snap.stages.map((s) => ({ ...s })),
    reps: () => snap.reps.map((r) => ({ ...r })),
    manager: () => ({ ...snap.manager }),
    companies: () => snap.companies.map((c) => ({ ...c })),
    contacts: () => snap.contacts.map((c) => ({ ...c })),
    deals: () => snap.deals.map((d) => ({ ...d })),
    history: () => snap.history.map((h) => ({ ...h })),
    followUps: () => snap.followUps.map((f) => ({ ...f })),
    activities: () => snap.activities.map((a) => ({ ...a })),
  };
}
