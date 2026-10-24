/**
 * THE STAFF SESSION CLIENT: every door a hosted staff screen reads and writes
 * through, as the signed-in person.
 *
 * A staff side has no key. It is served behind the person's own sign-in, and
 * everything here goes to Adminium with their cookie and the token their
 * writes carry. What they may read is decided by the server on every call;
 * nothing here hides a row or a column.
 *
 * ─── Why a file of its own, beside `sessionSource.ts` ────────────────────────
 *
 * `sessionSource.ts` answers one question for the apps that have a browser
 * demo: "give me this whole table", so the same screens run on a snapshot.
 * A screen built on the server's own figures needs the rest: a list with the
 * columns, lookups and counts it asks for, a record's buttons and history,
 * figures over a table, files, the live stream, people, notices, imports,
 * places and search.
 *
 * ─── A lost reply is not a failure ───────────────────────────────────────────
 *
 * A save whose answer never arrives may have been written. So:
 *
 *  - a CREATE carries a key the client makes once (`newClientKey`). Sent
 *    again, the server answers the row the first one made. The table keeps
 *    the key in a column marked `retryKey`; without one the server refuses
 *    the key, and that is a fault of the manifest, not of the save;
 *  - a BUTTON (a state move) names the state it starts from. After a lost
 *    reply the row is read back: no longer in that state, the move was made;
 *  - a CHANGE is read back and compared with what was sent.
 *
 * Each answers `saved`, `refused` (the server said no, with its reason) or
 * `unknown` (nothing could be read back either). A screen says "checking"
 * while a save is being read back, and never "not saved" on `unknown`.
 */

import { configBase, loadStaffConfig, type StaffConfig, type TableAction } from "./staffConnection.ts";

export type Row = Record<string, unknown>;
export type Key = string | number;

/** What the server said when it refused: its status, its code, and the details a screen may show. */
export class StaffError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "StaffError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** The fields a save was refused for, by column: `{ owner_id: "required" }`. */
  get fields(): Record<string, string> {
    const fields = this.details["fields"];
    if (fields === null || typeof fields !== "object") return {};
    return Object.fromEntries(
      Object.entries(fields as Record<string, { code?: unknown }>).map(([column, issue]) => [column, typeof issue?.code === "string" ? issue.code : "refused"]),
    );
  }
}

/** The reply never came, or the server fell over: the save may or may not have been written. */
export class LostReply extends Error {
  constructor(cause?: unknown) {
    super("The reply was lost.");
    this.name = "LostReply";
    this.cause = cause;
  }
}

export type Saved<R = Row> = { state: "saved"; row: R; replayed: boolean; readBack: boolean } | { state: "refused"; error: StaffError } | { state: "unknown" };

export type Condition =
  | { column: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike"; value: unknown }
  | { column: string; op: "in"; value: unknown[] }
  | { column: string; op: "between"; value: [unknown, unknown] }
  | { column: string; op: "is_null" | "not_null" }
  | { and: Condition[] }
  | { or: Condition[] };

/** A figure folded over the child rows of each listed row (the deals of each stage). */
export interface Measure {
  id: string;
  table: string;
  fkColumn: string;
  fn: "count" | "sum" | "avg" | "min" | "max";
  of?: string;
  emptyAs?: number | null;
  where?: { column: string; in: unknown[] }[];
}

export interface ListQuery {
  select?: string[];
  where?: Condition;
  q?: string;
  /** `["due_at", "name.desc"]`, at most three. */
  order?: string[];
  /** `alias:link.column` or `alias:link.link.column`: a value from a linked row. */
  lookup?: string[];
  /** `alias:table.fkColumn:count`: how many rows of another table point here. */
  agg?: string[];
  measures?: Measure[];
  limit?: number;
  offset?: number;
  cursor?: string;
  count?: "exact" | "estimated" | "none";
}

export interface Page<R = Row> {
  rows: R[];
  total: number | null;
  next: string | null;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  actorKind: string;
  actorLabel: string | null;
  action: string;
  changes: Record<string, { before?: unknown; after?: unknown }> | null;
}

/**
 * A figure over a table: counted, summed or averaged, in groups, by month.
 * Read as the person (their rows only) and kept 30 seconds by the server.
 *
 * `shape` says how it is answered. The two a screen mostly asks:
 *  - `single-metric`: one number, the first aggregation (`{ value }`);
 *  - `categorical`: one item per group, each with every aggregation under
 *    `values` (`{ items: [{ key, label, value, values }], total }`). Several
 *    sums of one set of rows are asked as one group (group by a column the
 *    filter holds to one value).
 */
export interface Figure {
  table: string;
  shape: "single-metric" | "metric+delta" | "categorical" | "timeseries" | "multi-timeseries" | "matrix" | "distribution";
  filters?: Condition[];
  aggregations?: { fn: "count" | "sum" | "avg" | "min" | "max"; column?: string; alias: string }[];
  groupBy?: string[];
  /** `link.column`: what a group keyed by a link is called. */
  groupLabel?: string;
  bucket?: { column: string; unit: "hour" | "day" | "week" | "month" | "quarter" | "year" };
  window?: Record<string, unknown>;
  orderBy?: { column: string; dir: "asc" | "desc" }[];
  limit?: number;
}

/**
 * Whether a group's key is the group of rows with no value. The server names that group `__null` (labelled "—"), in a
 * `categorical` figure and on both sides of a `matrix`; an older answer may say `null` or nothing.
 */
export const noValue = (key: string | number | null | undefined): boolean => key === null || key === undefined || key === "" || key === "__null" || key === "null";

/** A `categorical` figure's answer. */
export interface Grouped {
  shape: "categorical";
  /** `values` holds every aggregation by its alias when several were asked; a figure asked for one number answers it as `value` alone. */
  items: { key: string | number | null; label: string | null; value: number; values?: Record<string, number | null> }[];
  total: number;
}

export interface Person {
  id: string;
  name: string;
  sample?: boolean;
}

export interface Frame {
  channel: string;
  type: string;
  data: unknown;
  ts: number;
}

export interface StaffSessionOptions {
  fetchImpl?: typeof fetch;
  /** The config, when the caller already has it (a test). */
  config?: StaffConfig;
  pathname?: string;
  base?: string;
  /** How long a save waits before it is sent again or read back, in milliseconds: one entry per further try. */
  retryAfter?: number[];
  wait?: (ms: number) => Promise<void>;
}

const API = "/api/v1";
const CSRF_HEADER = "x-adminium-csrf";
/** The most figures the server takes in one request. */
const FIGURES_PER_REQUEST = 40;
const KEY_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A key for one save: 32 letters the server takes (22 to 64 of `A-Z a-z 0-9 - _`). Made once per save, and kept while it is retried. */
export function newClientKey(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(32));
  let out = "";
  for (const byte of bytes) out += KEY_LETTERS[byte % 64];
  return out;
}

const same = (a: unknown, b: unknown): boolean => a === b || (a != null && b != null && String(a) === String(b)) || ((a === null || a === undefined || a === "") && (b === null || b === undefined || b === ""));

function query(parts: Record<string, string | string[] | number | undefined>): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(parts)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const one of value) out.append(key, one);
    else out.append(key, String(value));
  }
  const text = out.toString();
  return text === "" ? "" : `?${text}`;
}

export interface StaffSession {
  readonly config: StaffConfig;
  readonly connectionId: string;
  /** The server's clock now, from the difference kept when the config was read. */
  now(): Date;
  /** Whether the person may do this to a table (`deals`, or an add-on's `inventory:items`), as the server said when the page opened. The server still decides each call. */
  can(ref: string, action: TableAction): boolean;
  /** Whether a part of the app is switched on. A server that does not say has every part on; a part the installed app does not have (a later stage's) is off. */
  part(id: string): boolean;
  /** A table's stored name, for a door that is not here. */
  tableId(ref: string): string;

  list<R extends Row = Row>(ref: string, q?: ListQuery): Promise<Page<R>>;
  get<R extends Row = Row>(ref: string, id: Key, q?: Pick<ListQuery, "lookup" | "agg" | "measures">): Promise<R | null>;
  create<R extends Row = Row>(ref: string, values: Row, clientKey: string, more?: { children?: Record<string, unknown> }): Promise<Saved<R>>;
  update<R extends Row = Row>(ref: string, id: Key, values: Row, more?: { seen?: Row; children?: Record<string, unknown> }): Promise<Saved<R>>;
  /** Remove a row. `reason` is the why, for a table that keeps one (it rides in the body, never in the address). */
  remove(ref: string, id: Key, more?: { reason?: string }): Promise<Saved<Row>>;
  /** Press a record's button. `from` is the state the screen saw; `stateColumn` is where the read-back looks. */
  act<R extends Row = Row>(ref: string, id: Key, actionId: string, from: string, more?: { values?: Row; stateColumn?: string }): Promise<Saved<R>>;
  history(ref: string, id: Key, q?: { limit?: number; cursor?: string }): Promise<{ entries: HistoryEntry[]; next: string | null }>;
  figure<T = unknown>(figure: Figure): Promise<T>;
  people(q?: string, limit?: number): Promise<Person[]>;
  /** Hear each change to these tables until the returned function is called. `resync` is called when the stream comes back after a break. */
  listen(refs: string[], on: (frame: Frame) => void, resync?: () => void): () => void;
  /** Any other door, as the person: the path under `/api/v1`. */
  call<T = unknown>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
}

/** Open the session of whoever is signed in. Throws when no config answers: the page is not served by Adminium. */
export async function connectStaffSession(opts: StaffSessionOptions = {}): Promise<StaffSession> {
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const retryAfter = opts.retryAfter ?? [400, 1500];
  const read = (): Promise<StaffConfig | null> =>
    loadStaffConfig({ hostedStaff: true, fetchImpl: doFetch, ...(opts.base === undefined ? {} : { base: opts.base }), ...(opts.pathname === undefined ? {} : { pathname: opts.pathname }) });
  let config = opts.config ?? (await read());
  if (config === null || config.connectionId === null) throw new StaffError(0, "NO_CONFIG", "This page is not served by Adminium, or the app is not connected to a database.");
  const connectionId = config.connectionId;
  const skew = config.now === null || config.now === undefined ? 0 : new Date(config.now).getTime() - Date.now();

  /**
   * A table's stored name. The app's own go by their short name (`deals`); an
   * attached add-on's by its key and its own short name (`inventory:items`),
   * as the config lists them. An add-on that is not attached has no tables.
   */
  const realName = (ref: string): string | undefined => {
    const colon = ref.indexOf(":");
    if (colon === -1) return config!.tables[ref];
    return config!.addOns[ref.slice(0, colon)]?.tables?.[ref.slice(colon + 1)];
  };
  const tableId = (ref: string): string => {
    const real = realName(ref);
    if (real === undefined) throw new StaffError(0, "NO_TABLE", `This app has no table "${ref}".`, { table: ref });
    return real;
  };
  const data = (ref: string, rest = ""): string => `/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(tableId(ref))}${rest}`;

  async function send(method: string, path: string, body: unknown, headers: Record<string, string> = {}, again = true): Promise<unknown> {
    const init: RequestInit = { method, credentials: "same-origin", headers: { accept: "application/json", ...headers } };
    if (method !== "GET") (init.headers as Record<string, string>)[CSRF_HEADER] = config!.csrfToken ?? "";
    if (body !== undefined) {
      if (typeof body === "string" || body instanceof Blob) init.body = body;
      else {
        (init.headers as Record<string, string>)["content-type"] = "application/json";
        init.body = JSON.stringify(body);
      }
    }
    let res: Response;
    try {
      res = await doFetch(`${API}${path}`, init);
    } catch (cause) {
      throw new LostReply(cause);
    }
    if (res.status >= 500) throw new LostReply(res.status);
    if (res.status === 204) return null;
    let doc: unknown = null;
    try {
      doc = await res.json();
    } catch {
      if (res.ok) return null;
    }
    if (res.ok) return doc;
    const error = ((doc ?? {}) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error ?? {};
    // The token is the session's: one made before a sign-in again is refused once, and the fresh one is read.
    if (res.status === 403 && error.code === "CSRF_FAILED" && again) {
      const fresh = await read();
      if (fresh !== null) config = { ...config!, csrfToken: fresh.csrfToken };
      return send(method, path, body, headers, false);
    }
    // Too many calls in a minute: wait as long as the server says, once.
    if (res.status === 429 && again) {
      const seconds = Number(res.headers.get("retry-after") ?? "1");
      await wait(Math.min(Number.isFinite(seconds) ? seconds : 1, 30) * 1000);
      return send(method, path, body, headers, false);
    }
    throw new StaffError(res.status, error.code ?? "ERROR", error.message ?? `The server answered ${String(res.status)}.`, error.details ?? {});
  }

  const listQuery = (q: ListQuery): string =>
    query({
      select: q.select?.join(","),
      where: q.where === undefined ? undefined : JSON.stringify(q.where),
      q: q.q,
      order: q.order?.join(","),
      lookup: q.lookup,
      agg: q.agg,
      compute: q.measures === undefined || q.measures.length === 0 ? undefined : JSON.stringify({ measures: q.measures.map((measure) => ({ ...measure, table: tableId(measure.table) })) }),
      limit: q.limit,
      offset: q.offset,
      cursor: q.cursor,
      count: q.count,
    });

  const get = async <R extends Row>(ref: string, id: Key, q: Pick<ListQuery, "lookup" | "agg" | "measures"> = {}): Promise<R | null> => {
    try {
      return ((await send("GET", data(ref, `/${encodeURIComponent(String(id))}${listQuery(q)}`), undefined)) as { data: R }).data;
    } catch (error) {
      if (error instanceof StaffError && error.status === 404) return null;
      throw error;
    }
  };

  /** Run a save; on a lost reply, try what `after` says: send again, or read back. */
  async function saving<R extends Row>(attempt: () => Promise<{ row: R; replayed: boolean }>, readBack: (() => Promise<R | "again" | null>) | null): Promise<Saved<R>> {
    for (let tries = 0; ; tries += 1) {
      try {
        const done = await attempt();
        return { state: "saved", row: done.row, replayed: done.replayed, readBack: false };
      } catch (error) {
        if (error instanceof StaffError) return { state: "refused", error };
        if (!(error instanceof LostReply)) throw error;
        const pause = retryAfter[tries];
        if (pause === undefined) return { state: "unknown" };
        await wait(pause);
        if (readBack === null) continue;
        try {
          const found = await readBack();
          if (found === null) return { state: "unknown" };
          if (found !== "again") return { state: "saved", row: found, replayed: false, readBack: true };
        } catch (inner) {
          if (inner instanceof StaffError) return { state: "refused", error: inner };
          if (!(inner instanceof LostReply)) throw inner;
        }
      }
    }
  }

  /*
   * FIGURES ASKED TOGETHER GO AS ONE REQUEST. A screen asks several at once
   * (a board: its header, each column, the year's closed deals), and the
   * server counts figure requests per person per minute. One request for the
   * lot keeps a busy screen well inside that, and each figure still answers
   * or fails by itself.
   */
  const asked: { descriptor: unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
  const flush = (): void => {
    const all = asked.splice(0, asked.length);
    for (let from = 0; from < all.length; from += FIGURES_PER_REQUEST) {
      const some = all.slice(from, from + FIGURES_PER_REQUEST);
      if (some.length === 1) {
        send("POST", "/widget-data/query", { descriptor: some[0]!.descriptor }).then((doc) => some[0]!.resolve((doc as { result: unknown }).result), some[0]!.reject);
        continue;
      }
      send("POST", "/widget-data/batch", { requests: some.map((one, i) => ({ instanceId: `f${String(i)}`, descriptor: one.descriptor })) }).then(
        (doc) => {
          const results = (doc as { results: Record<string, { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; statusCode: number } }> }).results;
          some.forEach((one, i) => {
            const answer = results[`f${String(i)}`];
            if (answer === undefined) one.reject(new LostReply());
            else if (answer.ok) one.resolve(answer.result);
            else one.reject(answer.error.statusCode >= 500 ? new LostReply(answer.error.statusCode) : new StaffError(answer.error.statusCode, answer.error.code, answer.error.message));
          });
        },
        (error: unknown) => some.forEach((one) => one.reject(error)),
      );
    }
  };

  const session: StaffSession = {
    get config() {
      return config!;
    },
    connectionId,
    now: () => new Date(Date.now() + skew),
    // An add-on's table is listed by its real name: one that is not attached is nobody's to use.
    can: (ref, action) => {
      if (config!.access === null) return !ref.includes(":") || realName(ref) !== undefined;
      const key = ref.includes(":") ? realName(ref) : ref;
      return key !== undefined && (config!.access.tables[key] ?? []).includes(action);
    },
    part: (id) => config!.modules === null || config!.modules === undefined || config!.modules[id] === true,
    tableId,

    async list<R extends Row>(ref: string, q: ListQuery = {}) {
      const doc = (await send("GET", data(ref, listQuery(q)), undefined)) as { data: R[]; page?: { total?: number | null }; cursor?: { next?: string | null } };
      return { rows: doc.data, total: doc.page?.total ?? null, next: doc.cursor?.next ?? null };
    },
    get,

    create<R extends Row>(ref: string, values: Row, clientKey: string, more: { children?: Record<string, unknown> } = {}) {
      // The same key every time: the server answers the row the first one made.
      return saving<R>(async () => {
        const doc = (await send("POST", data(ref), { values, clientKey, ...more })) as { data: R; replayed?: boolean };
        return { row: doc.data, replayed: doc.replayed === true };
      }, null);
    },

    update<R extends Row>(ref: string, id: Key, values: Row, more: { seen?: Row; children?: Record<string, unknown> } = {}) {
      return saving<R>(
        async () => ({ row: ((await send("PATCH", data(ref, `/${encodeURIComponent(String(id))}`), { values, ...more })) as { data: R }).data, replayed: false }),
        async () => {
          const row = await get<R>(ref, id);
          if (row === null) return null;
          // Every column sent is as it was sent: the change is in. Anything else: send it again (with `seen`, the server refuses a row somebody else moved).
          return Object.entries(values).every(([column, value]) => !(column in row) || same(row[column], value)) ? row : "again";
        },
      );
    },

    remove(ref: string, id: Key, more: { reason?: string } = {}) {
      const reason = more.reason?.trim();
      return saving<Row>(
        async () => {
          await send("DELETE", data(ref, `/${encodeURIComponent(String(id))}?confirm=true`), reason === undefined || reason === "" ? undefined : { reason });
          return { row: {}, replayed: false };
        },
        async () => ((await get(ref, id)) === null ? {} : "again"),
      );
    },

    act<R extends Row>(ref: string, id: Key, actionId: string, from: string, more: { values?: Row; stateColumn?: string } = {}) {
      const column = more.stateColumn ?? "state";
      return saving<R>(
        async () => ({
          row: ((await send("POST", data(ref, `/${encodeURIComponent(String(id))}/actions/${encodeURIComponent(actionId)}`), { from, ...(more.values === undefined ? {} : { values: more.values }) })) as { data: R }).data,
          replayed: false,
        }),
        async () => {
          const row = await get<R>(ref, id);
          if (row === null) return null;
          // It left the state the button was pressed in: the move was made (by this press, or by somebody's since).
          return same(row[column], from) ? "again" : row;
        },
      );
    },

    async history(ref, id, q = {}) {
      const doc = (await send("GET", data(ref, `/${encodeURIComponent(String(id))}/history${query({ limit: q.limit, cursor: q.cursor })}`), undefined)) as { entries: HistoryEntry[]; nextCursor?: string | null };
      return { entries: doc.entries, next: doc.nextCursor ?? null };
    },

    figure<T>(figure: Figure) {
      const { table, ...rest } = figure;
      const descriptor = { connectionId, source: { name: tableId(table) }, ...rest };
      return new Promise<T>((resolve, reject) => {
        asked.push({ descriptor, resolve: resolve as (value: unknown) => void, reject });
        // Everything a screen asks in one go leaves together, a moment from now.
        if (asked.length === 1) setTimeout(flush, 0);
      });
    },

    async people(q, limit = 20) {
      return ((await send("GET", `/people${query({ q, limit })}`, undefined)) as { people: Person[] }).people;
    },

    listen(refs, on, resync) {
      // A table of a part the install left out (Quotes without Invoices) has nothing to hear: it is passed over, never an error.
      const present = refs.filter((ref) => realName(ref) !== undefined);
      if (present.length === 0) return () => undefined;
      const channels = present.map((ref) => `widget-data:${connectionId}:${tableId(ref)}`);
      const url = `${API}/events${query({ channels: channels.join(",") })}`;
      const stop = new AbortController();
      /*
       * Read with `fetch`, not `EventSource`: the server names each frame by
       * what happened (`record.created`, `record.updated`, …) and that list
       * grows, while an EventSource hears only the names it was told.
       */
      void (async () => {
        for (let round = 0; !stop.signal.aborted; round += 1) {
          try {
            const res = await doFetch(url, { credentials: "same-origin", headers: { accept: "text/event-stream" }, signal: stop.signal });
            // Refused (a table the person may not hear, or signed out): asking again changes nothing.
            if (res.status === 401 || res.status === 403) return;
            if (res.ok && res.body !== null) {
              // A change made while the stream was down was never heard: read again now it is back.
              if (round > 0) resync?.();
              const reader = res.body.getReader();
              const decoder = new TextDecoder();
              let held = "";
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                held += decoder.decode(value, { stream: true });
                for (let end = held.indexOf("\n\n"); end !== -1; end = held.indexOf("\n\n")) {
                  const block = held.slice(0, end);
                  held = held.slice(end + 2);
                  const line = block.split("\n").find((one) => one.startsWith("data:"));
                  if (line === undefined) continue;
                  try {
                    const frame = JSON.parse(line.slice(5).trim()) as Frame;
                    if (typeof frame.channel === "string") on(frame);
                  } catch {
                    // A frame that is not a frame is dropped: the next read is the truth.
                  }
                }
              }
            }
          } catch {
            // The line dropped: wait and ask again, unless the screen has gone.
          }
          if (stop.signal.aborted) return;
          await wait(retryAfter[Math.min(round, retryAfter.length - 1)] ?? 5000);
        }
      })();
      return () => stop.abort();
    },

    call: <T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, headers?: Record<string, string>) => send(method, path, body, headers) as Promise<T>,
  };
  return session;
}

export { configBase };
