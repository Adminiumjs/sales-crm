/**
 * THE OFFLINE QUEUE: a save a phone makes with no signal is kept on the phone
 * and sent, in the order it was made, when the signal comes back.
 *
 * App-neutral, and with no framework in it: an app's phone screens hand it a
 * save as data (a create, a change, a button), and it keeps that save, its
 * files and its retry key until the server has answered. A React app draws
 * the pill, the signal line and the list from `queueView`; the words are the
 * app's own.
 *
 * ─── Exactly once ────────────────────────────────────────────────────────────
 *
 *  - A CREATE carries the retry key every table already keeps (`retryKey`),
 *    made when the save is made, never when it is sent. Sent again after a
 *    lost answer (or after the app was closed half-way), the server answers
 *    the row the first one made.
 *  - A CHANGE names what the screen saw (`seen`), so a row somebody else moved
 *    meanwhile is refused, not written over. One that was tried before is read
 *    back first: already as it was sent, it is done.
 *  - A BUTTON names the state it starts from; tried before and no longer in
 *    that state, it is done.
 *
 * ─── Files stay on the phone until sent ──────────────────────────────────────
 *
 * Adminium's photo field and signature pad take a `fetch`. `fetchFor` gives
 * them one that keeps the file on the phone (`phone_…`) instead of sending it.
 * When its line is sent, each file goes first (its server id is remembered on
 * the line, so a second try never sends it twice), then the row naming them.
 * A refused line throws its sent files away on the server and keeps the
 * phone's copies until the person removes the line (the app may let a new
 * save take them over: a refused sign-off's photos). A file no line names is
 * thrown away when the queue opens.
 *
 * ─── Order, and a refusal ────────────────────────────────────────────────────
 *
 * One line at a time, oldest first; the next goes only once the one before
 * has its answer. A save made while lines wait goes behind them. A refused
 * line does not stop the rest: a later line that relied on it (one that names
 * its row, `{ $line }`) is refused in its turn, saying which. An app may write
 * something of its own when a line is refused (`afterRefused`): those lines go
 * next, with keys of their own.
 *
 * ─── Kept where ──────────────────────────────────────────────────────────────
 *
 * IndexedDB, one database per app, connection and person, so it lives through
 * a reload and the app being closed, and dies with sign-out (`clear`). Never
 * sessionStorage: it outlives a sign-out and dies with the tab.
 */
import { LostReply, StaffError, type Key, type Row, type Saved, type StaffSession } from "./staffSession.ts";

/* ─── Lines ─── */

/** A value an earlier line's saved row holds: its id by default (a week's sheet, made on this phone, named by its days). */
export interface LineRef {
  $line: string;
  column?: string;
}

export type OpId = Key | LineRef;

export type QueueOp =
  | { type: "create"; table: string; values: Row; key: string }
  | { type: "update"; table: string; id: OpId; values: Row; seen?: Row }
  | { type: "act"; table: string; id: OpId; action: string; from: string; values?: Row; stateColumn?: string };

export type LineState = "waiting" | "sending" | "sent" | "refused";

/** Why a line was refused: the server's answer, or the queue's own (`NEEDED_REFUSED`, `FILE_GONE`). */
export interface QueueRefusal {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
  at: string;
  /** The line it relied on, when that one was refused or removed. */
  needed?: string;
}

export interface QueueLine {
  /** The line's own id. */
  id: string;
  /** The order it was made in; a line written after a refusal sits just behind it. */
  seq: number;
  /** When the save was made, by the server's clock as the phone keeps it. */
  madeAt: string;
  /** The app's name for what it is ("sign-off", "tick"). */
  kind: string;
  op: QueueOp;
  /** The app's own words about it: what the list and the screens show. */
  meta: Record<string, unknown>;
  state: LineState;
  /** How many times it has been sent. */
  tries: number;
  /** A file of the phone's, by its phone id, once the server has it: its server id. */
  uploaded: Record<string, string>;
  /** Value columns whose phone files are thrown away when the line is refused (a signature: signed again). */
  dropOnRefusal: string[];
  /** Made while lines waited or there was no signal: counted when the signal comes back. */
  kept: boolean;
  /** A line the queue writes for the app (after a refusal), not one of the person's saves: not listed. */
  quiet: boolean;
  sentAt: string | null;
  row: Row | null;
  refusal: QueueRefusal | null;
  /** Whether the app's `afterRefused` still has to run. */
  follow: "none" | "pending" | "done";
}

export interface NewLine {
  kind: string;
  op: QueueOp;
  meta?: Record<string, unknown>;
  dropOnRefusal?: string[];
  quiet?: boolean;
}

/** A file the phone holds for a line. */
export interface HeldFile {
  blob: Blob;
  name: string;
  type: string;
  /** Where the server takes it: the stored table name and the column. */
  table: string;
  column: string;
  at: string;
}

export const HELD_PREFIX = "phone_";
const HELD = /^phone_[A-Za-z0-9_-]{8,64}$/;
/** Whether a value is a file the phone holds. */
export const isHeld = (value: unknown): value is string => typeof value === "string" && HELD.test(value);
const isRef = (value: unknown): value is LineRef => value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { $line?: unknown }).$line === "string";

/** The phone's files a save names, in the order its values hold them. */
export function heldIn(values: Row | undefined): string[] {
  const out: string[] = [];
  for (const value of Object.values(values ?? {})) {
    if (isHeld(value)) out.push(value);
    else if (Array.isArray(value)) for (const one of value) if (isHeld(one)) out.push(one);
  }
  return out;
}

const valuesOf = (op: QueueOp): Row | undefined => (op.type === "act" ? op.values : op.values);

/** The earlier lines a line names (its row's id, or a value of that row). */
function refsOf(line: QueueLine): string[] {
  const out: string[] = [];
  const op = line.op;
  if (op.type !== "create" && isRef(op.id)) out.push(op.id.$line);
  for (const value of Object.values(valuesOf(op) ?? {})) if (isRef(value)) out.push(value.$line);
  return out;
}

/** The files a line still needs on the phone: none once sent. */
const filesOf = (line: QueueLine): string[] => (line.state === "sent" ? [] : heldIn(valuesOf(line.op)));

/* ─── Where it is kept ─── */

export interface QueueStore {
  lines(): Promise<QueueLine[]>;
  put(line: QueueLine): Promise<void>;
  remove(id: string): Promise<void>;
  putFile(id: string, file: HeldFile): Promise<void>;
  getFile(id: string): Promise<HeldFile | null>;
  removeFile(id: string): Promise<void>;
  fileIds(): Promise<string[]>;
  /** Everything gone: sign-out. */
  clear(): Promise<void>;
  /** Where it is really kept: on the phone, or only while the page is open (no IndexedDB). */
  readonly kind: "phone" | "memory";
  /** Told when the store is thrown away from elsewhere (a sign-out in another tab): its lines must not be sent. */
  onGone?(listener: () => void): void;
}

/** Kept only while the page is open: for tests, and a browser with no IndexedDB. */
export function memoryStore(): QueueStore {
  const lines = new Map<string, QueueLine>();
  const files = new Map<string, HeldFile>();
  const copy = (line: QueueLine): QueueLine => JSON.parse(JSON.stringify(line)) as QueueLine;
  return {
    kind: "memory",
    lines: async () => [...lines.values()].map(copy),
    put: async (line) => void lines.set(line.id, copy(line)),
    remove: async (id) => void lines.delete(id),
    putFile: async (id, file) => void files.set(id, file),
    getFile: async (id) => files.get(id) ?? null,
    removeFile: async (id) => void files.delete(id),
    fileIds: async () => [...files.keys()],
    clear: async () => {
      lines.clear();
      files.clear();
    },
  };
}

const ask = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Kept on the phone, in its own IndexedDB database. */
export function indexedStore(name: string, factory: IDBFactory = indexedDB): QueueStore {
  let opened: Promise<IDBDatabase> | null = null;
  const goneListeners = new Set<() => void>();
  // Another tab deleting the database (its sign-out) asks this one to let go: it closes, and the queue drops what it held.
  const letGo = (base: IDBDatabase): void => {
    base.onversionchange = () => {
      base.close();
      opened = null;
      for (const listener of goneListeners) listener();
    };
  };
  const db = (): Promise<IDBDatabase> =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("lines", { keyPath: "id" });
        request.result.createObjectStore("files");
      };
      request.onsuccess = () => {
        letGo(request.result);
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    }));
  const run = async <T>(store: "lines" | "files", mode: IDBTransactionMode, work: (objects: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const base = await db();
    const tx = base.transaction(store, mode);
    const answer = ask(work(tx.objectStore(store)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return answer;
  };
  return {
    kind: "phone",
    onGone: (listener) => void goneListeners.add(listener),
    lines: () => run<QueueLine[]>("lines", "readonly", (objects) => objects.getAll() as IDBRequest<QueueLine[]>),
    put: async (line) => void (await run("lines", "readwrite", (objects) => objects.put(line))),
    remove: async (id) => void (await run("lines", "readwrite", (objects) => objects.delete(id))),
    putFile: async (id, file) => void (await run("files", "readwrite", (objects) => objects.put(file, id))),
    getFile: async (id) => ((await run<HeldFile | undefined>("files", "readonly", (objects) => objects.get(id) as IDBRequest<HeldFile | undefined>)) ?? null),
    removeFile: async (id) => void (await run("files", "readwrite", (objects) => objects.delete(id))),
    fileIds: async () => (await run<IDBValidKey[]>("files", "readonly", (objects) => objects.getAllKeys())).map(String),
    clear: async () => {
      if (opened !== null) (await opened.catch(() => null))?.close();
      opened = null;
      await new Promise<void>((resolve) => {
        const request = factory.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    },
  };
}

/** IndexedDB when the browser has it, else memory (the app says the saves are kept only while the page is open). */
export function phoneStore(name: string): QueueStore {
  try {
    if (typeof indexedDB !== "undefined" && indexedDB !== null) return indexedStore(name);
  } catch {
    // A browser that refuses storage (some private windows).
  }
  return memoryStore();
}

/** The database's name: one per app, connection and person, so one person's saves never go as another's. */
export const queueName = (app: string, connectionId: string, userId: string): string => `adminium-queue:${app}:${connectionId}:${userId}`;

/* ─── The queue ─── */

export type QueueSession = Pick<StaffSession, "create" | "update" | "act" | "get" | "list" | "call" | "connectionId" | "now">;

/** What an app writes when a line is refused: words for the line, and lines to send next. */
export interface FollowUp {
  meta?: Record<string, unknown>;
  lines?: NewLine[];
}

export interface QueueOptions {
  session: QueueSession;
  store: QueueStore;
  /** Whether the phone thinks it has signal (`navigator.onLine`). */
  online?: () => boolean;
  /** Called once a line is refused, while the signal is there: may read the server and write lines of its own. */
  afterRefused?: (line: QueueLine, session: QueueSession) => Promise<FollowUp | null>;
  /** The phone's day, `YYYY-MM-DD`: lines sent on an earlier day go. */
  today?: () => string;
  makeKey?: () => string;
}

export type AddResult = { state: "sent"; line: QueueLine } | { state: "refused"; line: QueueLine } | { state: "kept"; line: QueueLine };

/** What a send that followed a spell with no signal came to: the lines kept then. */
export interface Round {
  sent: number;
  refused: number;
}

export interface Queue {
  /** The lines kept on the phone have been read. */
  readonly ready: Promise<void>;
  /** Every line, in the order made. */
  lines(): readonly QueueLine[];
  /** No signal: the phone says so, or the last try did not reach the server. */
  offline(): boolean;
  /** Where the lines are really kept. */
  kept(): "phone" | "memory";
  subscribe(listener: () => void): () => void;
  onRound(listener: (round: Round) => void): () => void;
  /** Keep a save and send it now if it is first in line and there is signal: answers how it ended, or that it is kept. */
  add(line: NewLine): Promise<AddResult>;
  /** Take a waiting or refused line off the phone, with the files only it names. A line being sent or sent stays. */
  remove(id: string): Promise<boolean>;
  /** Send what waits, in order, while the signal holds. */
  send(): Promise<void>;
  /** Keep a file on the phone for a save to name: answers its phone id. */
  hold(blob: Blob, where: { table: string; column: string; name: string }): Promise<string>;
  /** Throw away a file of the phone's that no line names. `held`: a line names it. */
  drop(id: string): Promise<"gone" | "held">;
  file(id: string): Promise<HeldFile | null>;
  /** A `fetch` for Adminium's file parts: their uploads kept on the phone, their discards of those thrown away here. */
  fetchFor(real: (input: string, init?: RequestInit) => Promise<Response>): (input: string, init?: RequestInit) => Promise<Response>;
  /** Anything waiting, being sent, or refused: what a sign-out would throw away. */
  busy(): boolean;
  /** Throw everything away (sign-out): a line being sent is let finish first. */
  clear(): Promise<void>;
  /** Hear the browser's signal and try again now and then while lines wait. Answers the way to stop. */
  watch(target?: Pick<Window, "addEventListener" | "removeEventListener">, everyMs?: number): () => void;
}

const KEY_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const randomKey = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let out = "";
  for (const byte of bytes) out += KEY_LETTERS[byte % 64];
  return out;
};
const localDay = (): string => {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const dayOfIso = (iso: string): string => {
  const at = new Date(iso);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if ((a === null || a === undefined || a === "") && (b === null || b === undefined || b === "")) return true;
  if (typeof a === "boolean" || typeof b === "boolean") return (a === true || a === 1 || a === "1" || a === "true") === (b === true || b === 1 || b === "1" || b === "true");
  if (Array.isArray(a) || Array.isArray(b) || (typeof a === "object" && a !== null) || (typeof b === "object" && b !== null)) {
    const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));
    return text(a) === text(b);
  }
  return a != null && b != null && String(a) === String(b);
};

type Outcome = { state: "sent"; row: Row } | { state: "refused"; refusal: QueueRefusal } | { state: "offline" };

/**
 * An answer that says "not now" rather than "no" (T09): the session ran out or was signed out elsewhere (401), the
 * minute's calls are spent (429, after the session's one wait), the request timed out (408), or the token went stale
 * (403 CSRF_FAILED, after its one renewal). The line waits and keeps what it holds (a customer's signature included);
 * a refusal would have thrown that away.
 */
export const notYet = (error: StaffError): boolean => error.status === 401 || error.status === 408 || error.status === 429 || (error.status === 403 && error.code === "CSRF_FAILED");

export function openQueue(options: QueueOptions): Queue {
  const { session, store } = options;
  const online = options.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const today = options.today ?? localDay;
  const makeKey = options.makeKey ?? randomKey;
  let lines: QueueLine[] = [];
  let lost = false;
  let running: Promise<void> | null = null;
  let stopping = false;
  const listeners = new Set<() => void>();
  const rounds = new Set<(round: Round) => void>();
  const order = (): QueueLine[] => [...lines].sort((a, b) => a.seq - b.seq);
  // What `lines()` answers: the same list until something changes (a screen compares it to know whether to draw again).
  let sorted: QueueLine[] = [];
  const notify = (): void => {
    sorted = order();
    for (const listener of listeners) listener();
  };
  const save = async (line: QueueLine): Promise<void> => {
    lines = [...lines.filter((one) => one.id !== line.id), line];
    notify();
    await store.put(line);
  };
  const named = (except: string | null = null): Set<string> => new Set(lines.filter((line) => line.id !== except).flatMap(filesOf));
  const forget = async (ids: readonly string[], except: string | null): Promise<void> => {
    const still = named(except);
    for (const id of ids) if (!still.has(id)) await store.removeFile(id).catch(() => undefined);
  };
  const nowIso = (): string => session.now().toISOString();

  // Thrown away from another tab (a sign-out there): nothing it held goes, from here or later.
  let ended = false;
  store.onGone?.(() => {
    ended = true;
    stopping = true;
    lines = [];
    notify();
  });
  const ready = (async () => {
    lines = await store.lines().catch(() => []);
    // Lines sent on an earlier day go, unless a line still to send names their row; files no line names (a form left
    // half-filled) go too.
    const pointed = new Set(lines.filter((one) => one.state !== "sent").flatMap(refsOf));
    for (const line of lines.filter((one) => one.state === "sent" && one.sentAt !== null && dayOfIso(one.sentAt) < today() && !pointed.has(one.id))) {
      lines = lines.filter((one) => one.id !== line.id);
      await store.remove(line.id).catch(() => undefined);
    }
    const still = named();
    for (const id of await store.fileIds().catch(() => [] as string[])) if (!still.has(id)) await store.removeFile(id).catch(() => undefined);
    notify();
  })();

  const refusalOf = (error: StaffError): QueueRefusal => ({ status: error.status, code: error.code, message: error.message, details: error.details, at: nowIso() });
  const local = (code: string, needed?: string): QueueRefusal => ({ status: 0, code, message: code, details: {}, at: nowIso(), ...(needed === undefined ? {} : { needed }) });

  /** A value an earlier line's row holds; `undefined` when that line was refused or is gone. */
  const resolved = (value: unknown): { ok: true; value: unknown } | { ok: false; needed: string } => {
    if (!isRef(value)) return { ok: true, value };
    const from = lines.find((line) => line.id === value.$line);
    if (from === undefined || from.state !== "sent" || from.row === null) return { ok: false, needed: value.$line };
    return { ok: true, value: from.row[value.column ?? "id"] };
  };

  async function upload(file: HeldFile): Promise<string> {
    const query = new URLSearchParams({ connectionId: session.connectionId, table: file.table, column: file.column, filename: file.name });
    const doc = await session.call<{ data?: { id?: unknown } }>("POST", `/files?${query.toString()}`, file.blob, { "content-type": file.type === "" ? "application/octet-stream" : file.type });
    const id = doc?.data?.id;
    if (typeof id !== "string") throw new LostReply("no file id");
    return id;
  }

  /** Throw away the server's copies of a refused line's files. `held`: a row holds one (the create WAS made). */
  async function discard(line: QueueLine): Promise<boolean> {
    let held = false;
    for (const id of Object.values(line.uploaded)) {
      try {
        await session.call("DELETE", `/files/${encodeURIComponent(id)}`);
      } catch (error) {
        if (error instanceof StaffError && error.status === 409 && error.code === "FILE_HELD") held = true;
        // Not reached: left where nothing names it, and the server's daily sweep takes it.
      }
    }
    line.uploaded = {};
    return held;
  }

  async function deliver(line: QueueLine): Promise<Outcome> {
    const op = line.op;
    // What it names of earlier lines' rows.
    let id: unknown = op.type === "create" ? null : op.id;
    if (op.type !== "create") {
      const got = resolved(op.id);
      if (!got.ok) return { state: "refused", refusal: local("NEEDED_REFUSED", got.needed) };
      id = got.value;
    }
    const values: Row = {};
    for (const [column, value] of Object.entries(valuesOf(op) ?? {})) {
      const got = resolved(value);
      if (!got.ok) return { state: "refused", refusal: local("NEEDED_REFUSED", got.needed) };
      values[column] = got.value;
    }
    // The files first, each once: its server id is kept on the line before the row is sent.
    for (const held of heldIn(values)) {
      if (line.uploaded[held] !== undefined) continue;
      const file = await store.getFile(held);
      if (file === null) return { state: "refused", refusal: local("FILE_GONE") };
      try {
        line.uploaded[held] = await upload(file);
      } catch (error) {
        if (error instanceof StaffError) return notYet(error) ? { state: "offline" } : { state: "refused", refusal: refusalOf(error) };
        if (error instanceof LostReply) return { state: "offline" };
        throw error;
      }
      await save(line);
    }
    const swap = (value: unknown): unknown => (isHeld(value) ? (line.uploaded[value] ?? value) : Array.isArray(value) ? value.map(swap) : value);
    for (const column of Object.keys(values)) values[column] = swap(values[column]);

    let saved: Saved<Row>;
    try {
      if (op.type === "create") {
        saved = await session.create(op.table, values, op.key);
      } else if (op.type === "update") {
        if (line.tries > 1) {
          // Tried before: as it was sent already, it went.
          const row = await session.get(op.table, id as Key);
          if (row !== null && Object.entries(values).every(([column, value]) => !(column in row) || same(row[column], value))) return { state: "sent", row };
        }
        saved = await session.update(op.table, id as Key, values, op.seen === undefined ? {} : { seen: op.seen });
      } else {
        const column = op.stateColumn ?? "state";
        if (line.tries > 1) {
          const row = await session.get(op.table, id as Key);
          if (row !== null && !same(row[column], op.from)) return { state: "sent", row };
        }
        saved = await session.act(op.table, id as Key, op.action, op.from, { ...(Object.keys(values).length === 0 ? {} : { values }), stateColumn: column });
      }
    } catch (error) {
      if (error instanceof LostReply) return { state: "offline" };
      if (error instanceof StaffError) saved = { state: "refused", error };
      else throw error;
    }
    if (saved.state === "saved") return { state: "sent", row: saved.row };
    if (saved.state === "unknown" || notYet(saved.error)) return { state: "offline" };
    // Refused. A create whose file a row holds WAS made (its answer was lost before). The server keeps only a keyed
    // hash of the retry key, so the row is read back by a file it holds: this phone uploaded that file for this line.
    if (Object.keys(line.uploaded).length > 0 && (await discard(line)) && op.type === "create") {
      for (const [column, value] of Object.entries(values)) {
        if (typeof value !== "string" || !isHeld((valuesOf(op) ?? {})[column])) continue;
        const found = await session.list(op.table, { where: { column, op: "eq", value }, limit: 1 }).catch(() => null);
        if (found !== null && found.rows[0] !== undefined) return { state: "sent", row: found.rows[0] };
      }
    }
    return { state: "refused", refusal: refusalOf(saved.error) };
  }

  /** The app's own writing after a refusal, for each line still owed it. False: no signal for it. */
  async function followUps(): Promise<boolean> {
    for (const line of order().filter((one) => one.state === "refused" && one.follow === "pending")) {
      let made: FollowUp | null = null;
      try {
        made = (await options.afterRefused?.(line, session)) ?? null;
      } catch (error) {
        if (error instanceof LostReply) {
          lost = true;
          notify();
          return false;
        }
        // A gone session, a full minute, a timeout: the record is still owed, so it waits like the save did.
        if (error instanceof StaffError && notYet(error)) return false;
        made = null;
      }
      const after = (made?.lines ?? []).map((one, i) => fresh(one, line.seq + (i + 1) / 1000, true));
      for (const one of after) await save(one);
      await save({ ...line, meta: { ...line.meta, ...(made?.meta ?? {}) }, follow: "done" });
    }
    return true;
  }

  const fresh = (input: NewLine, seq: number, kept: boolean): QueueLine => ({
    id: makeKey(),
    seq,
    madeAt: nowIso(),
    kind: input.kind,
    op: input.op,
    meta: input.meta ?? {},
    state: "waiting",
    tries: 0,
    uploaded: {},
    dropOnRefusal: input.dropOnRefusal ?? [],
    kept,
    quiet: input.quiet === true,
    sentAt: null,
    row: null,
    refusal: null,
    follow: "none",
  });

  async function sendOne(line: QueueLine, round: Round): Promise<boolean> {
    const sending: QueueLine = { ...line, state: "sending", tries: line.tries + 1 };
    await save(sending);
    const outcome = await deliver(sending);
    if (outcome.state === "offline") {
      lost = true;
      await save({ ...sending, state: "waiting" });
      return false;
    }
    lost = false;
    if (outcome.state === "sent") {
      await save({ ...sending, state: "sent", row: outcome.row, sentAt: nowIso() });
      // The server has the files now: the phone's copies go.
      await forget(heldIn(valuesOf(sending.op)), sending.id);
      if (sending.kept && !sending.quiet) round.sent += 1;
      return true;
    }
    await discard(sending);
    const dropped: string[] = [];
    const values = valuesOf(sending.op) ?? {};
    for (const column of sending.dropOnRefusal) dropped.push(...heldIn({ [column]: values[column] }));
    const op = dropped.length === 0 ? sending.op : dropValues(sending.op, sending.dropOnRefusal);
    await save({ ...sending, op, state: "refused", refusal: outcome.refusal, follow: options.afterRefused === undefined ? "none" : "pending" });
    await forget(dropped, null);
    if (!sending.quiet) round.refused += 1;
    return true;
  }

  function pump(): Promise<void> {
    if (running !== null) return running;
    running = (async () => {
      await ready;
      const round: Round = { sent: 0, refused: 0 };
      try {
        for (;;) {
          if (stopping || ended) break;
          if (!online()) {
            lost = true;
            notify();
            break;
          }
          if (!(await followUps())) break;
          const next = order().find((line) => line.state === "waiting" || line.state === "sending");
          if (next === undefined) break;
          if (!(await sendOne(next, round))) break;
        }
      } finally {
        running = null;
        notify();
        if (round.sent + round.refused > 0) for (const listener of rounds) listener(round);
      }
    })();
    return running;
  }

  const queue: Queue = {
    ready,
    lines: () => sorted,
    offline: () => !online() || lost,
    kept: () => store.kind,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onRound(listener) {
      rounds.add(listener);
      return () => rounds.delete(listener);
    },

    async add(input) {
      await ready;
      const ahead = lines.some((line) => line.state === "waiting" || line.state === "sending");
      const seq = Math.floor(lines.reduce((top, line) => Math.max(top, line.seq), 0)) + 1;
      const now = !ahead && online() && !stopping;
      const line = fresh(input, seq, !now);
      await save(line);
      if (!now) {
        void pump();
        return { state: "kept", line };
      }
      await pump();
      // A pump that was already running has sent it or left it waiting.
      const after = lines.find((one) => one.id === line.id) ?? line;
      if (after.state === "sent") return { state: "sent", line: after };
      if (after.state === "refused") return { state: "refused", line: after };
      // No signal after all: it waits, and counts when the signal comes back.
      const keptLine = { ...after, kept: true };
      await save(keptLine);
      return { state: "kept", line: keptLine };
    },

    async remove(id) {
      await ready;
      const line = lines.find((one) => one.id === id);
      if (line === undefined || line.state === "sending" || line.state === "sent") return false;
      lines = lines.filter((one) => one.id !== id);
      notify();
      await store.remove(id);
      await forget(heldIn(valuesOf(line.op)), id);
      return true;
    },

    send: pump,

    async hold(blob, where) {
      // After the sweep of files no line names, which would take this one too.
      await ready;
      const id = `${HELD_PREFIX}${makeKey()}`;
      await store.putFile(id, { blob, name: where.name, type: blob.type, table: where.table, column: where.column, at: nowIso() });
      return id;
    },

    async drop(id) {
      if (named().has(id)) return "held";
      await store.removeFile(id).catch(() => undefined);
      return "gone";
    },

    file: (id) => store.getFile(id),

    fetchFor(real) {
      return async (input, init) => {
        const url = new URL(input, "http://phone.invalid");
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.pathname === "/api/v1/files" && method === "POST") {
          const body = init?.body;
          const headers = new Headers(init?.headers);
          const type = headers.get("content-type") ?? "";
          const blob = body instanceof Blob ? body : new Blob(body === undefined || body === null ? [] : [body as BlobPart], { type });
          const id = await queue.hold(blob.type === "" && type !== "" ? new Blob([blob], { type }) : blob, { table: url.searchParams.get("table") ?? "", column: url.searchParams.get("column") ?? "", name: url.searchParams.get("filename") ?? "file" });
          return new Response(JSON.stringify({ data: { id } }), { status: 201, headers: { "content-type": "application/json" } });
        }
        const held = /^\/api\/v1\/files\/([^/]+)$/.exec(url.pathname);
        if (held !== null && method === "DELETE" && isHeld(decodeURIComponent(held[1]!))) {
          const gone = await queue.drop(decodeURIComponent(held[1]!));
          return gone === "gone" ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ error: { code: "FILE_HELD", message: "A save on this phone names it." } }), { status: 409, headers: { "content-type": "application/json" } });
        }
        return real(input, init);
      };
    },

    // A hidden line still to send counts too (the record of a refused sign-off): signing out would throw it away (T09).
    busy: () => lines.some((line) => line.state !== "sent" && (!line.quiet || line.state === "waiting" || line.state === "sending")),

    async clear() {
      stopping = true;
      try {
        await running;
        await store.clear();
        lines = [];
        notify();
      } finally {
        stopping = ended;
      }
    },

    watch(target = window, everyMs = 15_000) {
      const back = (): void => {
        lost = false;
        notify();
        void pump();
      };
      const gone = (): void => {
        lost = true;
        notify();
      };
      target.addEventListener("online", back);
      target.addEventListener("offline", gone);
      // The phone can say it has signal while nothing gets through: try again now and then while lines wait.
      const timer = setInterval(() => {
        if (online() && lines.some((line) => line.state === "waiting" || line.state === "sending" || line.follow === "pending")) void pump();
      }, everyMs);
      void ready.then(() => pump());
      return () => {
        target.removeEventListener("online", back);
        target.removeEventListener("offline", gone);
        clearInterval(timer);
      };
    },
  };
  return queue;
}

function dropValues(op: QueueOp, columns: readonly string[]): QueueOp {
  if (op.type === "act") return op.values === undefined ? op : { ...op, values: Object.fromEntries(Object.entries(op.values).map(([column, value]) => [column, columns.includes(column) ? null : value])) };
  return { ...op, values: Object.fromEntries(Object.entries(op.values).map(([column, value]) => [column, columns.includes(column) ? null : value])) } as QueueOp;
}

/* ─── What a screen draws ─── */

export interface QueueView {
  /** The person's lines, for the list: refused first while nothing is being sent, then in the order made. */
  shown: QueueLine[];
  waiting: number;
  sending: number;
  refused: number;
  sent: number;
  /** The pill in the bar: refused lines when there are any, else those waiting (with a line being sent). None: no pill. */
  pill: { kind: "none" } | { kind: "waiting"; n: number; sending: boolean } | { kind: "refused"; n: number; sending: boolean };
  /** A line's number: its place in the order made, among the person's lines. */
  number: (line: Pick<QueueLine, "id">) => number;
}

export function queueView(lines: readonly QueueLine[]): QueueView {
  const mine = [...lines].filter((line) => !line.quiet).sort((a, b) => a.seq - b.seq);
  const count = (state: LineState): number => mine.filter((line) => line.state === state).length;
  const sending = count("sending");
  const waiting = count("waiting") + sending;
  const refused = count("refused");
  const numbers = new Map(mine.map((line, i) => [line.id, i + 1]));
  const shown = sending > 0 ? mine : [...mine.filter((line) => line.state === "refused"), ...mine.filter((line) => line.state !== "refused")];
  return {
    shown,
    waiting,
    sending,
    refused,
    sent: count("sent"),
    pill: refused > 0 ? { kind: "refused", n: refused, sending: sending > 0 } : waiting > 0 ? { kind: "waiting", n: waiting, sending: sending > 0 } : { kind: "none" },
    number: (line) => numbers.get(line.id) ?? 0,
  };
}

/** The newest line of the person's that answers a question (the waiting tick of a visit): sent ones left out unless asked. */
export function latest(lines: readonly QueueLine[], match: (line: QueueLine) => boolean, states: readonly LineState[] = ["waiting", "sending", "refused"]): QueueLine | undefined {
  return [...lines]
    .filter((line) => !line.quiet && states.includes(line.state) && match(line))
    .sort((a, b) => b.seq - a.seq)[0];
}

/** The size of the files a line holds on the phone, in bytes. */
export async function heldBytes(queue: Pick<Queue, "file">, line: QueueLine): Promise<number> {
  let total = 0;
  for (const id of heldIn(valuesOf(line.op))) total += (await queue.file(id))?.blob.size ?? 0;
  return total;
}
