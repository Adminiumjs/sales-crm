// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connected mode (28-public-surface.md §5.2, 28-T28 wave 4).
 *
 * ── WHY THIS DRIVES A REAL CLIENT ──────────────────────────────────────────
 * `createPublicClient` takes an injectable `fetch`, so these run the SHIPPED
 * client against canned wire responses rather than a hand-written stub of it.
 * `assertRefs`, the config fetch, the paging and the URL building are therefore
 * under test too — and those are where a connected app actually fails.
 *
 * ── THE ORPHANED SEAM IS WHAT THIS REPO ACTUALLY HAD ───────────────────────
 * §5.3 recorded this seam as orphaned and it was: the store and six screens
 * read `data/demo.ts` directly, so a swap changed nothing. The last test in
 * this file is the tripwire that now makes that impossible, and it is the one
 * that matters most here.
 */

import { describe, expect, it } from "vitest";

import { createPublicClient } from "@adminiumjs/public-client";

import { loadSnapshot, snapshotSource } from "./adminiumSource.ts";
import { demoSource, isConnected, setDataSource, source } from "./source.ts";

const REFS = [
  "users", "companies", "contacts", "pipelines", "stages", "deals", "activities", "tasks",
];

const ROWS: Record<string, unknown[]> = {
  users: [
    { id: 1, name: "Dana Okafor", email: "d@x.test", initials: "DO", tint: "#111", role: "rep" },
    { id: 2, name: "Priya Raman", email: "p@x.test", initials: "PR", tint: "#222", role: "manager" },
  ],
  companies: [
    {
      id: 10, name: "Meridian Freight", domain: "meridian.example", industry: "freight",
      city: "Rotterdam", headcount: 420, initials: "MF", tint: "#333", icon: "truck",
      since_note: "Customer since 2024", note: "Renewal in Q3.",
    },
  ],
  contacts: [
    { id: 20, company_id: 10, name: "Wren Hall", email: "w@x.test", phone: "0700", title: "Head of Ops", initials: "WH" },
  ],
  pipelines: [
    { id: 4, name: "Second pipeline" },
    { id: 1, name: "New business" },
  ],
  stages: [
    { id: 31, pipeline_id: 1, name: "Proposal", position: 1, probability: 50 },
    { id: 30, pipeline_id: 1, name: "Discovery", position: 0, probability: 10 },
    { id: 90, pipeline_id: 4, name: "Elsewhere", position: 0, probability: 5 },
  ],
  deals: [
    {
      id: 50, name: "Depot rollout", company_id: 10, contact_id: 20, stage_id: 31,
      amount: "48000.00", expected_close: "2026-09-30", status: "open", lost_reason: "",
      owner_id: 1, scope: "Twelve depots.", stage_entered_at: "2026-07-20T08:00:00Z",
      closed_on: null, created_at: "2026-05-02T10:00:00Z",
    },
    {
      id: 51, name: "Other pipeline deal", company_id: 10, contact_id: null, stage_id: 90,
      amount: "1000.00", expected_close: null, status: "open", lost_reason: "",
      owner_id: 1, scope: "", stage_entered_at: "2026-07-20T08:00:00Z",
      closed_on: null, created_at: "2026-05-02T10:00:00Z",
    },
    {
      id: 52, name: "Won last quarter", company_id: 10, contact_id: 20, stage_id: 31,
      amount: "22000.00", expected_close: "2026-06-01", status: "won", lost_reason: "",
      owner_id: 2, scope: "", stage_entered_at: "2026-05-20T08:00:00Z",
      closed_on: "2026-06-04", created_at: "2026-03-02T10:00:00Z",
    },
    {
      id: 53, name: "Lost on price", company_id: 10, contact_id: null, stage_id: 31,
      amount: "9000.00", expected_close: "2026-06-01", status: "lost", lost_reason: "Budget pulled",
      owner_id: 1, scope: "", stage_entered_at: "2026-05-20T08:00:00Z",
      closed_on: "2026-06-10", created_at: "2026-03-02T10:00:00Z",
    },
  ],
  activities: [
    { id: 60, deal_id: 50, type: "stage_change", summary: "Moved to Proposal", created_by: 1, created_at: "2026-07-20T08:00:00Z" },
    { id: 61, deal_id: 50, type: "carrier-pigeon", summary: "Unknown kind", created_by: 1, created_at: "2026-07-21T08:00:00Z" },
  ],
  tasks: [
    { id: 70, deal_id: 50, title: "Send the revised scope", due_at: "2026-07-29T13:30:00Z", done: false },
    { id: 71, deal_id: null, title: "Floating task", due_at: "2026-07-29T13:30:00Z", done: false },
    { id: 72, deal_id: 50, title: "Already done", due_at: "2026-07-01T13:30:00Z", done: true },
  ],
};

interface FakeOptions {
  rows?: Record<string, unknown[]>;
  expose?: (ref: string) => string[];
  /** The scope's per-ref page ceiling — the operator's number, not the app's. */
  limit?: number;
}

/** A server that answers exactly what the scope would, paging included. */
function fakeFetch(overrides: FakeOptions = {}) {
  const rows = overrides.rows ?? ROWS;
  const limit = overrides.limit ?? 500;
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

    if (url.pathname.endsWith("/public/config")) {
      const refs: Record<string, unknown> = {};
      for (const ref of REFS) {
        refs[ref] = {
          actions: ["list"],
          expose: overrides.expose?.(ref) ?? Object.keys((rows[ref]?.[0] ?? {}) as object),
          filterable: [], searchable: [], orderable: [], writable: [], limit,
        };
      }
      // `/public/config` is the one route the client unwraps: it reads
      // `body.data`, while `list` reads the body itself.
      return json({
        data: { version: 1, side: "staff", timezone: "Europe/Amsterdam", currency: "EUR", claim: null, refs },
      });
    }

    const ref = url.pathname.split("/").pop() ?? "";
    const all = rows[ref] ?? [];
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const size = Number(url.searchParams.get("limit") ?? String(all.length));
    return json({ data: all.slice(offset, offset + size) });
  };
}

const clientWith = (fetch: ReturnType<typeof fakeFetch>) =>
  createPublicClient({ baseUrl: "https://api.example.test", publishableKey: "adm_pub_test", fetch });

const snapshot = async (overrides: FakeOptions = {}) =>
  loadSnapshot(clientWith(fakeFetch(overrides))!);

describe("demo mode is the structural default", () => {
  it("builds no client when either variable is absent", () => {
    expect(createPublicClient({ baseUrl: "https://x.test", publishableKey: "" })).toBeNull();
    expect(createPublicClient({ baseUrl: "", publishableKey: "adm_pub_x" })).toBeNull();
    expect(createPublicClient(undefined)).toBeNull();
  });

  it("falls back rather than throwing when the server is unreachable", async () => {
    const client = clientWith(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await loadSnapshot(client!)).toBeNull();
  });

  it("falls back when the scope does not expose a column the app reads", async () => {
    expect(await snapshot({ expose: (ref) => (ref === "deals" ? ["id"] : ["id"]) })).toBeNull();
  });
});

describe("the board", () => {
  it("draws one pipeline, lowest id, in position order", async () => {
    const snap = await snapshot();
    expect(snap).not.toBeNull();
    // WS-I G-2: two pipelines exist and the board has room for one. The columns
    // must not reshuffle between loads, so the rule is lowest id, not arrival.
    expect(snap!.stages.map((s) => s.label)).toEqual(["Discovery", "Proposal"]);
    // Odds are a percentage in the database and a fraction in the app.
    expect(snap!.stages.map((s) => s.odds)).toEqual([0.1, 0.5]);
    // Serial keys, stringified — the people-ops pattern, applied everywhere.
    expect(snap!.stages.map((s) => s.id)).toEqual(["30", "31"]);
  });

  it("drops a deal whose stage belongs to another pipeline", async () => {
    const snap = await snapshot();
    // Piling it into the first column would quietly inflate the forecast by a
    // deal nobody on this board is working.
    expect(snap!.deals.map((d) => d.name)).toEqual(["Depot rollout"]);
    expect(snap!.deals[0]!.stage).toBe("31");
    expect(snap!.deals[0]!.amount).toBe(48_000);
    expect(snap!.deals[0]!.main).toBe("20");
  });

  it("splits open deals from history and keeps a loss's reason", async () => {
    const snap = await snapshot();
    expect(snap!.history.map((h) => h.won)).toEqual([true, false]);
    expect(snap!.history[1]!.reason).toBe("Budget pulled");
    // A won deal carries no reason at all, rather than an empty string.
    expect(snap!.history[0]!.reason).toBeUndefined();
    expect(snap!.history[0]!.closed).toBe("2026-06-04");
  });
});

describe("the two closed vocabularies the schema enforces are translated", () => {
  it("derives a sector key and a role key from CHECK-constrained columns", async () => {
    const snap = await snapshot();
    // These are §5.5's `catalogue` classification working: nine industries,
    // nine `data.sector.*` keys, so a German reader sees a German sector.
    expect(snap!.companies[0]!.sector).toBe("data.sector.freight");
    expect(snap!.reps.map((r) => r.role)).toEqual(["data.role.rep", "data.role.manager"]);
  });

  it("ships everything else as the tenant's own words", async () => {
    const snap = await snapshot();
    // `label()` resolves with `tOr(key, key)`, so operator text renders
    // literally where the seed rendered a key.
    expect(snap!.companies[0]!.since).toBe("Customer since 2024");
    expect(snap!.companies[0]!.note).toBe("Renewal in Q3.");
    expect(snap!.contacts[0]!.role).toBe("Head of Ops");
    expect(snap!.deals[0]!.scope).toBe("Twelve depots.");
  });

  it("derives the fields the schema has no column for", async () => {
    const snap = await snapshot();
    // WS-I G-1: no given name, no logo file.
    expect(snap!.reps[0]!.first).toBe("Dana");
    expect(snap!.companies[0]!.file).toBe("meridian.svg");
  });
});

describe("the timeline and the follow-ups", () => {
  it("maps stage_change onto the app's word and drops what it cannot name", async () => {
    const snap = await snapshot();
    // WS-I G-4: an unrecognised type has no icon and no label, so it is dropped
    // rather than rendered as a blank row in somebody's deal history.
    expect(snap!.activities.map((a) => a.type)).toEqual(["stage"]);
    // Stamps are `YYYY-MM-DD HH:mm` in the TENANT's zone: 08:00Z is 10:00 in
    // Amsterdam in July, and reading it as UTC would show every call two hours
    // early with no error anywhere.
    expect(snap!.activities[0]!.at).toBe("2026-07-20 10:00");
  });

  it("keeps only open follow-ups that belong to a live deal", async () => {
    const snap = await snapshot();
    // WS-I G-5: `tasks.deal_id` is nullable and a done task is not a follow-up.
    expect(snap!.followUps.map((f) => f.text)).toEqual(["Send the revised scope"]);
    expect(snap!.followUps[0]!.due).toBe("2026-07-29 15:30");
  });

  it("picks a manager, and falls back rather than crashing without one", async () => {
    const snap = await snapshot();
    expect(snap!.manager.name).toBe("Priya Raman");
    const noManager = await snapshot({
      rows: { ...ROWS, users: [ROWS["users"]![0]] },
    });
    // Somebody has to be the manager persona; the first user is less wrong
    // than a blank screen.
    expect(noManager!.manager.name).toBe("Dana Okafor");
  });

  it("reads every page, not just the first the scope allows", async () => {
    const snap = await snapshot({ limit: 1 });
    expect(snap!.stages).toHaveLength(2);
    expect(snap!.history).toHaveLength(2);
    expect(snap!.reps).toHaveLength(2);
  });

  it("hands back the same shapes demoSource does", async () => {
    const connected = snapshotSource((await snapshot())!);
    for (const key of Object.keys(demoSource) as (keyof typeof demoSource)[]) {
      expect(typeof connected[key]).toBe("function");
    }
    // Copied on the way out: a caller that mutates what it is given must not
    // reach back into the snapshot.
    connected.stages()[0]!.label = "mutated";
    expect(connected.stages()[0]!.label).toBe("Discovery");
  });
});

describe("the seam", () => {
  it("reports demo mode until a real source is installed", () => {
    expect(isConnected()).toBe(false);
  });

  it("refuses a swap that arrives after the app has read", () => {
    // THE SILENT FAILURE THIS PINS, and the one this repo actually had: the
    // seam was orphaned, so a swap changed nothing at all. `data/live.ts` now
    // reads it at module scope and `main.tsx` imports `App` dynamically, which
    // makes the ordering load-bearing rather than incidental.
    source.stages();
    expect(() => setDataSource(demoSource)).toThrow(/after the app already read/);
  });
});
