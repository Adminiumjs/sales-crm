/**
 * The offline queue, against a server that is a few maps and a switch for the
 * signal. What matters: a save made with no signal is sent once the signal is
 * back, in the order made, exactly once (its retry key, its files sent once);
 * a refused line does not stop the rest; files stay on the phone until sent.
 */
import { describe, expect, it } from "vitest";

import { heldIn, latest, memoryStore, openQueue, queueView, type QueueLine, type QueueSession } from "./offlineQueue.ts";
import { LostReply, StaffError, type Row, type Saved } from "./staffSession.ts";

type Table = Map<number, Row>;

/** A server with tables, retry keys, `seen`, and files; `signal` off makes every call fail as a dropped line does. */
function fakeServer() {
  const tables = new Map<string, Table>();
  const files = new Map<string, { bytes: number; held: boolean }>();
  const calls: string[] = [];
  let next = 1;
  let fileNo = 1;
  const state = {
    signal: true,
    /** The next create's answer is lost on its way back (the row IS made). */
    loseNextReply: false,
    /** Refuse creates on this table, as a rule would. */
    refuse: new Set<string>(),
  };
  const table = (name: string): Table => {
    let found = tables.get(name);
    if (found === undefined) tables.set(name, (found = new Map()));
    return found;
  };
  const reach = (what: string): void => {
    calls.push(what);
    if (!state.signal) throw new LostReply("no signal");
  };
  const session: QueueSession = {
    connectionId: "con_1",
    now: () => new Date("2026-08-05T10:52:00.000Z"),
    async create<R extends Row>(ref: string, values: Row, key: string): Promise<Saved<R>> {
      reach(`create ${ref}`);
      if (state.refuse.has(ref)) return { state: "refused", error: new StaffError(422, "VALIDATION", "refused", { fields: { job_id: { code: "not-allowed" } } }) };
      const rows = table(ref);
      const made = [...rows.values()].find((row) => row["retry_key"] === key);
      if (made !== undefined) return { state: "saved", row: made as R, replayed: true, readBack: false };
      for (const value of Object.values(values)) for (const id of Array.isArray(value) ? value : [value]) if (typeof id === "string" && files.has(id)) files.get(id)!.held = true;
      const row: Row = { ...values, id: next++, retry_key: key };
      rows.set(row["id"] as number, row);
      if (state.loseNextReply) {
        state.loseNextReply = false;
        return { state: "unknown" };
      }
      return { state: "saved", row: row as R, replayed: false, readBack: false };
    },
    async update<R extends Row>(ref: string, id: unknown, values: Row, more: { seen?: Row } = {}): Promise<Saved<R>> {
      reach(`update ${ref} ${String(id)}`);
      const row = table(ref).get(Number(id));
      if (row === undefined) return { state: "refused", error: new StaffError(404, "NOT_FOUND", "gone") };
      if (Object.entries(more.seen ?? {}).some(([column, value]) => row[column] !== value)) return { state: "refused", error: new StaffError(409, "ROW_CHANGED", "changed") };
      Object.assign(row, values);
      return { state: "saved", row: row as R, replayed: false, readBack: false };
    },
    async act<R extends Row>(ref: string, id: unknown, _action: string, from: string, more: { values?: Row } = {}): Promise<Saved<R>> {
      reach(`act ${ref} ${String(id)}`);
      const row = table(ref).get(Number(id));
      if (row === undefined || row["state"] !== from) return { state: "refused", error: new StaffError(409, "STATE_MOVE_REFUSED", "moved") };
      Object.assign(row, more.values ?? {}, { state: "sent" });
      return { state: "saved", row: row as R, replayed: false, readBack: false };
    },
    async get<R extends Row>(ref: string, id: unknown): Promise<R | null> {
      reach(`get ${ref} ${String(id)}`);
      return (table(ref).get(Number(id)) as R | undefined) ?? null;
    },
    async list<R extends Row>(ref: string, q: { where?: unknown } = {}) {
      reach(`list ${ref}`);
      const where = q.where as { column: string; value: unknown } | undefined;
      const rows = [...table(ref).values()].filter((row) => where === undefined || row[where.column] === where.value);
      return { rows: rows as R[], total: rows.length, next: null };
    },
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
      reach(`${method} ${path.split("?")[0]!}`);
      if (method === "POST" && path.startsWith("/files?")) {
        const id = `file_${String(fileNo++).padStart(4, "0")}`;
        files.set(id, { bytes: (body as Blob).size, held: false });
        return { data: { id } } as T;
      }
      if (method === "DELETE" && path.startsWith("/files/")) {
        const id = decodeURIComponent(path.slice(7));
        if (files.get(id)?.held === true) throw new StaffError(409, "FILE_HELD", "held");
        files.delete(id);
        return null as T;
      }
      throw new Error(`no door ${method} ${path}`);
    },
  };
  return { session, tables, table, files, calls, state };
}

let keys = 0;
const makeKey = (): string => `Key${String((keys += 1)).padStart(29, "0")}`;

function setUp() {
  const server = fakeServer();
  const store = memoryStore();
  const queue = openQueue({ session: server.session, store, online: () => server.state.signal, makeKey, today: () => "2026-08-05" });
  return { server, store, queue };
}

const tick = (id: number, on = true) => ({ kind: "tick", op: { type: "update" as const, table: "job_visits", id, values: { tick_done: on } } });

describe("the offline queue", () => {
  it("sends a save at once when there is signal, and answers the row", async () => {
    const { server, queue } = setUp();
    const made = await queue.add({ kind: "snag", op: { type: "create", table: "snags", values: { text: "Scuffed panel" }, key: "SnagKey0000000000000000000000001" } });
    expect(made.state).toBe("sent");
    expect(made.line.row?.["text"]).toBe("Scuffed panel");
    expect(server.table("snags").size).toBe(1);
    expect(queueView(queue.lines()).pill).toEqual({ kind: "none" });
  });

  it("keeps saves made with no signal and sends them in the order made when it comes back", async () => {
    const { server, queue } = setUp();
    server.table("job_visits").set(7, { id: 7, tick_arrived: false, tick_done: false });
    server.state.signal = false;
    const rounds: { sent: number; refused: number }[] = [];
    queue.onRound((round) => rounds.push(round));
    const first = await queue.add({ kind: "tick", op: { type: "update", table: "job_visits", id: 7, values: { tick_arrived: true } } });
    const second = await queue.add(tick(7));
    const third = await queue.add({ kind: "snag", op: { type: "create", table: "snags", values: { text: "Gap" }, key: "SnagKey0000000000000000000000002" } });
    expect([first.state, second.state, third.state]).toEqual(["kept", "kept", "kept"]);
    expect(queueView(queue.lines()).pill).toEqual({ kind: "waiting", n: 3, sending: false });
    expect(queue.offline()).toBe(true);
    // Nothing reached the server while there was no signal.
    expect(server.table("job_visits").get(7)?.["tick_done"]).toBe(false);
    server.state.signal = true;
    server.calls.length = 0;
    await queue.send();
    expect(server.calls).toEqual(["update job_visits 7", "update job_visits 7", "create snags"]);
    expect(queue.lines().map((line) => line.state)).toEqual(["sent", "sent", "sent"]);
    expect(rounds).toEqual([{ sent: 3, refused: 0 }]);
    expect(queueView(queue.lines()).pill).toEqual({ kind: "none" });
  });

  it("sends a create once for its retry key, even when the first answer was lost", async () => {
    const { server, queue } = setUp();
    server.state.loseNextReply = true;
    const kept = await queue.add({ kind: "fill", op: { type: "create", table: "fuel_fills", values: { litres: 41.2 }, key: "FillKey0000000000000000000000001" } });
    // The row was made, but the phone heard nothing: it keeps the line, with the same key.
    expect(kept.state).toBe("kept");
    expect(server.table("fuel_fills").size).toBe(1);
    await queue.send();
    expect(server.table("fuel_fills").size).toBe(1);
    expect(queue.lines()[0]?.state).toBe("sent");
    expect(queue.lines()[0]?.row?.["id"]).toBe([...server.table("fuel_fills").keys()][0]);
  });

  it("keeps going after a refused line, and a line that named the refused one's row is refused in its turn", async () => {
    const { server, queue } = setUp();
    server.state.signal = false;
    server.state.refuse.add("time_sheets");
    const sheet = await queue.add({ kind: "sheet", op: { type: "create", table: "time_sheets", values: { week_of: "2026-08-03" }, key: "SheetKey000000000000000000000001" } });
    await queue.add({ kind: "day", op: { type: "create", table: "time_sheet_lines", values: { sheet_id: { $line: sheet.line.id }, hours: 7 }, key: "DayKey00000000000000000000000001" } });
    await queue.add({ kind: "snag", op: { type: "create", table: "snags", values: { text: "Later, and fine" }, key: "SnagKey0000000000000000000000003" } });
    server.state.signal = true;
    await queue.send();
    const [a, b, c] = queue.lines();
    expect([a?.state, b?.state, c?.state]).toEqual(["refused", "refused", "sent"]);
    expect(b?.refusal).toMatchObject({ code: "NEEDED_REFUSED", needed: sheet.line.id });
    expect(server.table("time_sheet_lines").size).toBe(0);
    expect(server.table("snags").size).toBe(1);
    // Refused lines stay, counted, at the top of the list until removed.
    const view = queueView(queue.lines());
    expect(view.pill).toEqual({ kind: "refused", n: 2, sending: false });
    expect(view.shown.map((line) => line.kind)).toEqual(["sheet", "day", "snag"]);
    expect(view.number(c!)).toBe(3);
  });

  it("names an earlier line's row once it is sent: a week made on the phone, then its day", async () => {
    const { server, queue } = setUp();
    server.state.signal = false;
    const sheet = await queue.add({ kind: "sheet", op: { type: "create", table: "time_sheets", values: { week_of: "2026-08-03", state: "open" }, key: "SheetKey000000000000000000000002" } });
    await queue.add({ kind: "day", op: { type: "create", table: "time_sheet_lines", values: { sheet_id: { $line: sheet.line.id }, hours: 7 }, key: "DayKey00000000000000000000000002" } });
    await queue.add({ kind: "send", op: { type: "act", table: "time_sheets", id: { $line: sheet.line.id }, action: "send", from: "open" } });
    server.state.signal = true;
    await queue.send();
    const sheetId = [...server.table("time_sheets").keys()][0]!;
    expect([...server.table("time_sheet_lines").values()][0]?.["sheet_id"]).toBe(sheetId);
    expect(server.table("time_sheets").get(sheetId)?.["state"]).toBe("sent");
  });

  it("keeps a change's `seen`: a snag put right by somebody else meanwhile is refused, not written over", async () => {
    const { server, queue } = setUp();
    server.table("snags").set(2, { id: 2, state: "waiting-part" });
    server.state.signal = false;
    await queue.add({ kind: "put-right", op: { type: "update", table: "snags", id: 2, values: { state: "put-right", put_right_note: "New top" }, seen: { state: "waiting-part" } } });
    server.table("snags").get(2)!["state"] = "put-right";
    server.table("snags").get(2)!["put_right_note"] = "Office did it";
    server.state.signal = true;
    await queue.send();
    expect(queue.lines()[0]?.state).toBe("refused");
    expect(queue.lines()[0]?.refusal?.code).toBe("ROW_CHANGED");
    expect(server.table("snags").get(2)?.["put_right_note"]).toBe("Office did it");
  });

  it("reads a change back before sending it again: one that went before the phone heard is done", async () => {
    const { server, store } = setUp();
    server.table("snags").set(3, { id: 3, state: "put-right", put_right_note: "Fixed" });
    // A line the app was closed on while it was being sent: tried once.
    const line: QueueLine = {
      id: "line-1",
      seq: 1,
      madeAt: "2026-08-05T10:00:00.000Z",
      kind: "put-right",
      op: { type: "update", table: "snags", id: 3, values: { state: "put-right", put_right_note: "Fixed" }, seen: { state: "open" } },
      meta: {},
      state: "sending",
      tries: 1,
      uploaded: {},
      dropOnRefusal: [],
      kept: true,
      quiet: false,
      sentAt: null,
      row: null,
      refusal: null,
      follow: "none",
    };
    await store.put(line);
    const again = openQueue({ session: server.session, store, online: () => true, makeKey, today: () => "2026-08-05" });
    await again.send();
    expect(again.lines()[0]?.state).toBe("sent");
    expect(server.calls.filter((call) => call.startsWith("update"))).toEqual([]);
  });

  it("keeps files on the phone until sent, sends each once, and the phone's copies go once the row has them", async () => {
    const { server, store, queue } = setUp();
    const send = queue.fetchFor(async () => {
      throw new Error("the kit's upload must not reach the server");
    });
    const kept = await send("/api/v1/files?connectionId=con_1&table=crm_sign_offs&column=photos&filename=photo.jpg", { method: "POST", body: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), headers: { "content-type": "image/jpeg" } });
    expect(kept.status).toBe(201);
    const photo = ((await kept.json()) as { data: { id: string } }).data.id;
    const signature = await queue.hold(new Blob(["png"], { type: "image/png" }), { table: "crm_sign_offs", column: "signature", name: "signature.png" });
    expect(photo.startsWith("phone_")).toBe(true);
    expect(server.files.size).toBe(0);
    server.state.signal = false;
    await queue.add({ kind: "sign-off", op: { type: "create", table: "sign_offs", values: { visit_id: 7, signature, photos: [photo] }, key: "SignKey0000000000000000000000001" }, dropOnRefusal: ["signature"] });
    // A file a waiting line names is not the kit's to throw away.
    expect((await send(`/api/v1/files/${photo}`, { method: "DELETE" })).status).toBe(409);
    server.state.signal = true;
    // The first answer is lost: the files are not sent a second time, and one row is made.
    server.state.loseNextReply = true;
    await queue.send();
    await queue.send();
    expect(server.files.size).toBe(2);
    const row = [...server.table("sign_offs").values()][0]!;
    expect(server.table("sign_offs").size).toBe(1);
    expect([String(row["signature"]).startsWith("file_"), (row["photos"] as string[]).every((id) => id.startsWith("file_"))]).toEqual([true, true]);
    expect(await store.fileIds()).toEqual([]);
  });

  it("refused: throws the server's copies away, drops the signature, keeps the photos on the phone until the line is removed", async () => {
    const { server, store, queue } = setUp();
    server.state.refuse.add("sign_offs");
    const signature = await queue.hold(new Blob(["png"], { type: "image/png" }), { table: "crm_sign_offs", column: "signature", name: "signature.png" });
    const photo = await queue.hold(new Blob(["jpeg"], { type: "image/jpeg" }), { table: "crm_sign_offs", column: "photos", name: "photo.jpg" });
    server.state.signal = false;
    await queue.add({ kind: "sign-off", op: { type: "create", table: "sign_offs", values: { visit_id: 7, signer_name: "Yusuf Demir", signature, photos: [photo] }, key: "SignKey0000000000000000000000002" }, dropOnRefusal: ["signature"] });
    server.state.signal = true;
    await queue.send();
    const line = queue.lines()[0]!;
    expect(line.state).toBe("refused");
    // No stray file on the server.
    expect(server.files.size).toBe(0);
    expect(server.calls.filter((call) => call.startsWith("DELETE"))).toHaveLength(2);
    expect(heldIn(line.op.type === "create" ? line.op.values : {})).toEqual([photo]);
    expect(await store.fileIds()).toEqual([photo]);
    expect(await queue.remove(line.id)).toBe(true);
    expect(await store.fileIds()).toEqual([]);
  });

  it("lets the app write a line of its own after a refusal: sent next, before the lines behind", async () => {
    const server = fakeServer();
    server.state.refuse.add("sign_offs");
    const queue = openQueue({
      session: server.session,
      store: memoryStore(),
      online: () => server.state.signal,
      makeKey,
      today: () => "2026-08-05",
      afterRefused: async (line, session) => {
        const snags = await session.list("snags");
        return { meta: { snag: snags.rows[0]?.["text"] }, lines: [{ kind: "refused-record", quiet: true, op: { type: "create", table: "refused_sign_offs", values: { visit_id: line.meta["visit"] }, key: "RecordKey00000000000000000000001" } }] };
      },
    });
    server.table("snags").set(10, { id: 10, text: "Floor boxes not fixed down in bay 3" });
    server.state.signal = false;
    await queue.add({ kind: "sign-off", meta: { visit: 7 }, op: { type: "create", table: "sign_offs", values: { visit_id: 7 }, key: "SignKey0000000000000000000000003" } });
    await queue.add({ kind: "fill", op: { type: "create", table: "fuel_fills", values: { litres: 30 }, key: "FillKey0000000000000000000000002" } });
    server.state.signal = true;
    server.calls.length = 0;
    await queue.send();
    expect(server.calls).toEqual(["create sign_offs", "list snags", "create refused_sign_offs", "create fuel_fills"]);
    const refused = queue.lines().find((line) => line.kind === "sign-off")!;
    expect(refused.meta["snag"]).toBe("Floor boxes not fixed down in bay 3");
    // The record is the queue's own: not one of the person's lines.
    expect(queueView(queue.lines()).shown.map((line) => line.kind)).toEqual(["sign-off", "fill"]);
    expect(latest(queue.lines(), (line) => line.kind === "sign-off")?.id).toBe(refused.id);
  });

  it("throws everything away on sign-out, and says while anything waits that it would", async () => {
    const { server, store, queue } = setUp();
    server.state.signal = false;
    await queue.add(tick(7));
    expect(queue.busy()).toBe(true);
    await queue.clear();
    expect(queue.lines()).toEqual([]);
    expect(await store.lines()).toEqual([]);
    expect(queue.busy()).toBe(false);
  });

  it("forgets sent lines from an earlier day and files no line names when it opens", async () => {
    const server = fakeServer();
    const store = memoryStore();
    await store.put({ id: "old", seq: 1, madeAt: "2026-08-04T09:00:00.000Z", kind: "tick", op: { type: "update", table: "job_visits", id: 7, values: {} }, meta: {}, state: "sent", tries: 1, uploaded: {}, dropOnRefusal: [], kept: true, quiet: false, sentAt: "2026-08-04T09:00:00.000Z", row: {}, refusal: null, follow: "none" });
    await store.putFile("phone_left00000000half", { blob: new Blob(["x"]), name: "photo.jpg", type: "image/jpeg", table: "crm_snags", column: "photo", at: "2026-08-05T09:00:00.000Z" });
    const queue = openQueue({ session: server.session, store, online: () => true, makeKey, today: () => "2026-08-05" });
    await queue.ready;
    expect(queue.lines()).toEqual([]);
    expect(await store.fileIds()).toEqual([]);
  });

  it("hears the signal come back and sends what waits", async () => {
    const { server, queue } = setUp();
    const target = new EventTarget();
    const stop = queue.watch(target as unknown as Window, 60_000);
    server.state.signal = false;
    target.dispatchEvent(new Event("offline"));
    await queue.add(tick(7));
    expect(queue.offline()).toBe(true);
    server.table("job_visits").set(7, { id: 7, tick_done: false });
    server.state.signal = true;
    target.dispatchEvent(new Event("online"));
    await new Promise((done) => setTimeout(done, 0));
    await queue.send();
    expect(server.table("job_visits").get(7)?.["tick_done"]).toBe(true);
    expect(queue.offline()).toBe(false);
    stop();
  });
});
