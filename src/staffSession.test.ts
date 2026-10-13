/**
 * The staff session client, against a server that is a function.
 *
 * What matters most here is what happens when a reply is LOST: a save must
 * never be made twice, and a screen must never be told "not saved" about a
 * save that was written.
 */
import { describe, expect, it } from "vitest";

import type { StaffConfig } from "./staffConnection.ts";
import { connectStaffSession, LostReply, newClientKey, StaffError } from "./staffSession.ts";

const CONFIG: StaffConfig = {
  connectionId: "con_1",
  appName: "Sales CRM",
  tables: { deals: "public.crm_deals", stages: "public.crm_stages" },
  settings: {},
  timezone: "Europe/London",
  timezoneSource: null,
  serverTimezone: null,
  currency: "GBP",
  now: "2026-08-03T09:00:00.000Z",
  user: { id: "usr_dana", name: "Dana Whitlock", email: "dana@example.test" },
  csrfToken: "tok-1",
  publicKeys: {},
  access: { tables: { deals: ["read", "create", "update"], stages: ["read"] }, roles: [{ slug: "crm-rep", name: "Sales rep" }] },
  addOns: {},
  sharedTables: {},
  modules: { selling: true, jobs: false },
  locale: "en-US",
  dir: "ltr",
};

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };
type Answer = Response | "lost";

/** A server that answers each call from a list, in order, and remembers what it was asked. */
function server(answers: (Answer | ((call: Call) => Answer))[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const next = answers.shift();
    if (next === undefined) throw new Error(`no answer left for ${call.method} ${call.url}`);
    const answer = typeof next === "function" ? next(call) : next;
    if (answer === "lost") throw new TypeError("Failed to fetch");
    return answer;
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (status: number, doc: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(doc), { status, headers: { "content-type": "application/json", ...headers } });
const refusal = (status: number, code: string, details: Record<string, unknown> = {}) => json(status, { error: { code, message: code, details } });
const open = (answers: (Answer | ((call: Call) => Answer))[]) => {
  const s = server(answers);
  const waits: number[] = [];
  return { ...s, waits, session: connectStaffSession({ config: CONFIG, fetchImpl: s.fetchImpl, retryAfter: [10, 20], wait: async (ms) => void waits.push(ms) }) };
};

describe("what the page knows of the person", () => {
  it("says what they may do and which parts are on, from the config", async () => {
    const session = await open([]).session;
    expect([session.can("deals", "update"), session.can("deals", "delete"), session.can("quotes", "read")]).toEqual([true, false, false]);
    expect([session.part("selling"), session.part("jobs"), session.part("never-heard-of")]).toEqual([true, false, true]);
    expect(session.tableId("deals")).toBe("public.crm_deals");
    expect(() => session.tableId("nope")).toThrow(StaffError);
  });

  it("refuses to open where no config answers", async () => {
    const { fetchImpl } = server([new Response("<!doctype html>", { status: 200 })]);
    await expect(connectStaffSession({ fetchImpl, base: "/apps/crm/staff/" })).rejects.toMatchObject({ code: "NO_CONFIG" });
  });
});

describe("a list", () => {
  it("asks for its columns, lookups, counts, measures and order in the server's words", async () => {
    const { calls, session } = open([json(200, { data: [{ id: 1 }], page: { total: 14 }, cursor: { next: "c2" } })]);
    const page = await (await session).list("stages", {
      select: ["id", "label"],
      where: { column: "position", op: "gte", value: 1 },
      order: ["position"],
      lookup: ["owner:owner_id.name"],
      measures: [{ id: "open", table: "deals", fkColumn: "stage_id", fn: "sum", of: "amount", where: [{ column: "state", in: ["open"] }] }],
      limit: 50,
    });
    expect(page).toEqual({ rows: [{ id: 1 }], total: 14, next: "c2" });
    const url = new URL(calls[0]!.url, "http://x");
    expect(url.pathname).toBe("/api/v1/data/con_1/public.crm_stages");
    expect(url.searchParams.get("select")).toBe("id,label");
    expect(JSON.parse(url.searchParams.get("where")!)).toEqual({ column: "position", op: "gte", value: 1 });
    // A measure names its table by the app's short name; the server is told the stored one.
    expect(JSON.parse(url.searchParams.get("compute")!)).toEqual({ measures: [{ id: "open", table: "public.crm_deals", fkColumn: "stage_id", fn: "sum", of: "amount", where: [{ column: "state", in: ["open"] }] }] });
    // A read carries no write token.
    expect(calls[0]!.headers["x-adminium-csrf"]).toBeUndefined();
  });

  it("answers a row that is not there, or not theirs, as nothing", async () => {
    const { session } = open([refusal(404, "NOT_FOUND")]);
    expect(await (await session).get("deals", 7)).toBeNull();
  });
});

describe("a create whose reply is lost", () => {
  it("is sent again with the same key, and answers the row the first one made", async () => {
    const key = newClientKey();
    const { calls, waits, session } = open(["lost", json(200, { data: { id: 41, name: "Fit-out" }, replayed: true })]);
    const saved = await (await session).create("deals", { name: "Fit-out" }, key);
    expect(saved).toEqual({ state: "saved", row: { id: 41, name: "Fit-out" }, replayed: true, readBack: false });
    expect(calls.map((call) => (call.body as { clientKey: string }).clientKey)).toEqual([key, key]);
    expect(calls[0]!.headers["x-adminium-csrf"]).toBe("tok-1");
    expect(waits).toEqual([10]);
  });

  it("says unknown, never not saved, when no reply ever comes", async () => {
    const { calls, session } = open(["lost", json(503, {}), "lost"]);
    expect(await (await session).create("deals", { name: "Fit-out" }, newClientKey())).toEqual({ state: "unknown" });
    expect(calls).toHaveLength(3);
  });

  it("says what the server refused, with the fields it named, and does not try again", async () => {
    const { calls, session } = open([refusal(422, "VALIDATION_FAILED", { fields: { owner_id: { code: "required" } } })]);
    const saved = await (await session).create("deals", {}, newClientKey());
    expect(saved.state).toBe("refused");
    if (saved.state === "refused") expect([saved.error.status, saved.error.fields]).toEqual([422, { owner_id: "required" }]);
    expect(calls).toHaveLength(1);
  });
});

describe("a button whose reply is lost", () => {
  it("names the state it starts from, and is read back: out of that state, the move was made", async () => {
    const { calls, session } = open(["lost", json(200, { data: { id: 7, state: "won" } })]);
    const saved = await (await session).act("deals", 7, "win", "open");
    expect(saved).toEqual({ state: "saved", row: { id: 7, state: "won" }, replayed: false, readBack: true });
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/data/con_1/public.crm_deals/7/actions/win", body: { from: "open" } });
    // The second call is the read-back, not a second press.
    expect(calls[1]).toMatchObject({ method: "GET", url: "/api/v1/data/con_1/public.crm_deals/7" });
  });

  it("is pressed again only when the row is still where it was", async () => {
    const { calls, session } = open(["lost", json(200, { data: { id: 7, state: "open" } }), json(200, { data: { id: 7, state: "won" } })]);
    const saved = await (await session).act("deals", 7, "win", "open");
    expect(saved).toMatchObject({ state: "saved", readBack: false });
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "POST"]);
  });

  it("reads another column where the table keeps its state elsewhere", async () => {
    const { session } = open(["lost", json(200, { data: { id: 3, status: "sent" } })]);
    expect(await (await session).act("deals", 3, "send", "draft", { stateColumn: "status" })).toMatchObject({ state: "saved", readBack: true });
  });
});

describe("a change whose reply is lost", () => {
  it("is read back, and counts as saved when the row holds what was sent", async () => {
    const { calls, session } = open(["lost", json(200, { data: { id: 7, name: "Renamed", amount: "10.00" } })]);
    expect(await (await session).update("deals", 7, { name: "Renamed" })).toMatchObject({ state: "saved", readBack: true });
    expect(calls.map((call) => call.method)).toEqual(["PATCH", "GET"]);
  });

  it("is sent again when the row does not hold it yet", async () => {
    const { calls, session } = open(["lost", json(200, { data: { id: 7, name: "Old" } }), json(200, { data: { id: 7, name: "Renamed" } })]);
    expect(await (await session).update("deals", 7, { name: "Renamed" }, { seen: { name: "Old" } })).toMatchObject({ state: "saved", readBack: false });
    expect(calls[2]!.body).toEqual({ values: { name: "Renamed" }, seen: { name: "Old" } });
  });
});

describe("the write token and the rate limit", () => {
  it("reads a fresh token once when the server says the old one is stale", async () => {
    const { calls, fetchImpl } = server([
      refusal(403, "CSRF_FAILED"),
      json(200, { connectionId: "con_1", csrfToken: "tok-2", tables: {} }),
      (call) => (call.headers["x-adminium-csrf"] === "tok-2" ? json(201, { data: { id: 1 } }) : refusal(403, "CSRF_FAILED")),
    ]);
    const session = await connectStaffSession({ config: CONFIG, fetchImpl, base: "/apps/crm/staff/" });
    const saved = await session.create("deals", { name: "A" }, newClientKey());
    expect(saved.state).toBe("saved");
    expect(calls.map((call) => call.url)).toEqual(["/api/v1/data/con_1/public.crm_deals", "/apps/crm/staff/surface-config.json", "/api/v1/data/con_1/public.crm_deals"]);
  });

  it("waits as long as the server says when there were too many calls, once", async () => {
    const { waits, session } = open([refusal(429, "RATE_LIMITED"), json(200, { people: [{ id: "usr_1", name: "Sam" }] })]);
    expect(await (await session).people("sa")).toEqual([{ id: "usr_1", name: "Sam" }]);
    expect(waits).toEqual([1000]);
  });
});

describe("a figure, and the live stream", () => {
  it("asks the server for a figure over the stored table, as the person", async () => {
    const { calls, session } = open([json(200, { result: { rows: [{ stage_id: 1, n: 3 }] }, cached: false })]);
    await (await session).figure({ table: "deals", shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }], groupBy: ["stage_id"], aggregations: [{ fn: "count", alias: "n" }] });
    expect(calls[0]!.body).toEqual({
      descriptor: { connectionId: "con_1", source: { name: "public.crm_deals" }, shape: "categorical", filters: [{ column: "state", op: "eq", value: "open" }], groupBy: ["stage_id"], aggregations: [{ fn: "count", alias: "n" }] },
    });
  });

  it("hears every kind of frame on its tables, and reads again after a break", async () => {
    const frame = (type: string) => `event: ${type}\ndata: ${JSON.stringify({ channel: "widget-data:con_1:public.crm_deals", type, data: { pk: { id: 7 } }, ts: 1 })}\n\n`;
    const stream = (text: string) => new Response(new Blob([`retry: 5000\n\n: keep-alive\n\n${text}`]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } });
    const { calls, session } = open([stream(frame("record.updated")), stream(frame("record.created")), refusal(403, "FORBIDDEN")]);
    const heard: string[] = [];
    let resyncs = 0;
    const s = await session;
    await new Promise<void>((done) => {
      s.listen(["deals"], (f) => heard.push(f.type), () => (resyncs += 1));
      const poll = setInterval(() => {
        if (calls.length === 3) {
          clearInterval(poll);
          done();
        }
      }, 5);
    });
    expect(calls[0]!.url).toBe("/api/v1/events?channels=widget-data%3Acon_1%3Apublic.crm_deals");
    expect(heard).toEqual(["record.updated", "record.created"]);
    // The second stream is a reconnection: whatever changed in between was not heard.
    expect(resyncs).toBe(1);
  });
});

describe("a key for a save", () => {
  it("is 32 letters the server takes, and not the same twice", () => {
    const a = newClientKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newClientKey()).not.toBe(a);
  });

  it("tells a lost reply from a refusal", () => {
    expect(new LostReply().name).toBe("LostReply");
  });
});
