/**
 * NO SIGNAL on the crew's phone (plan 68 S19, the design's "Offline queue"):
 * what the phone shows of the saves it keeps (`queue.tsx`).
 *
 *  - the SIGNAL LINE above every crew screen while there is none: what is
 *    saved is kept on this phone and sent when it is back (no "Try again":
 *    sending is by itself);
 *  - the PILL in the bar: how many wait (or how many were refused), and it
 *    opens the LIST: what waits, oldest first and numbered in the order made,
 *    what was sent today (greyed), and what was refused on arrival, with why;
 *  - a line OPENED: what it holds, its photos, and "Remove from this phone",
 *    which asks first and says what is lost. Nothing else of a line changes;
 *  - the CHIP beside anything on a screen that waits to be sent.
 *
 * `useConnection` and `NoConnection` are the old online-only line, kept for the
 * one phone screen the queue does not take (My certificates).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useI18n, useT, type TFunction } from "../../i18n/index.tsx";
import { formatters, noonOf, type Formatters } from "../../lib/format.ts";
import { heldBytes, heldIn, type AddResult, type NewLine, type QueueLine } from "../../offlineQueue.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { StaffError } from "../../staffSession.ts";
import { signWhy, useHeldSrc, usePeopleNames, useQueue, useQueueLines, type MovedBy, type StoppedBy } from "./queue.tsx";

/* ─── Words for a line ─── */

const text = (value: unknown): string => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
const atOf = (iso: string | null | undefined): Date | null => (iso === null || iso === undefined || iso === "" ? null : new Date(iso));

function useFormatters(): Formatters {
  const { locale } = useI18n();
  const session = useSession();
  return useMemo(() => formatters({ locale, currency: session.config.currency, timeZone: session.config.timezone ?? session.config.serverTimezone ?? null }), [locale, session]);
}

/** What a line is, in a list's words: "Done on site · Tandem Robotics". */
export function lineTitle(line: QueueLine, t: TFunction, f: Formatters): string {
  const m = line.meta;
  switch (line.kind) {
    case "tick":
      return t(m["on"] === false ? "offline.line.untick" : "offline.line.tick", { tick: t(`jb.tick.${text(m["tick"]) as "tick_loaded"}`), site: text(m["site"]) });
    case "snag":
      return t("offline.line.snag", { site: text(m["site"]) });
    case "put-right":
      return t("offline.line.putRight", { snag: text(m["text"]), site: text(m["site"]) });
    case "sign-off":
      return t("offline.line.signOff", { site: text(m["site"]) });
    case "check":
      return t("offline.line.check", { vehicle: text(m["plate"]) || text(m["name"]) });
    case "fault":
      return t("offline.line.fault", { vehicle: text(m["plate"]) || text(m["name"]) });
    case "fill":
      return t("offline.line.fill", { vehicle: text(m["plate"]) || text(m["name"]) });
    case "day":
      return t("offline.line.day", { day: f.dayShort(noonOf(text(m["day"]))) });
    case "day-change":
      return t("offline.line.dayChange", { day: f.dayShort(noonOf(text(m["day"]))) });
    case "send-week":
      return t("offline.line.sendWeek", { day: f.dayShort(noonOf(text(m["monday"]))) });
    default:
      return line.kind;
  }
}

/** The files a line holds, and how much: "3 photos, 1 signature · 5.7 MB". */
export function filesText(line: QueueLine, bytes: number, t: TFunction, f: Formatters): string {
  const values = line.op.type === "act" ? (line.op.values ?? {}) : line.op.values;
  const held = heldIn(values);
  if (held.length === 0) return t("offline.files.none");
  const signature = typeof values["signature"] === "string" && held.includes(values["signature"]) ? 1 : 0;
  const photos = held.length - signature;
  const what = photos === 0 ? t("offline.files.signature") : signature === 0 ? t("offline.files.photos", { n: f.number(photos) }, photos) : t("offline.files.both", { n: f.number(photos) }, photos);
  const size = bytes >= 100_000 ? t("offline.files.mb", { n: f.number(Math.round(bytes / 100_000) / 10) }) : t("offline.files.kb", { n: f.number(Math.max(1, Math.round(bytes / 1000))) });
  return t("offline.files.size", { files: what, size });
}

/** What a line holds, a fact a line, for the line opened. */
function holdsOf(line: QueueLine, t: TFunction, f: Formatters): string[] {
  const m = line.meta;
  switch (line.kind) {
    case "tick":
      return [t(m["on"] === false ? "offline.holds.untick" : "offline.holds.tick", { tick: t(`jb.tick.${text(m["tick"]) as "tick_loaded"}`) })];
    case "snag":
      return [text(m["text"]), ...(m["stops"] === true ? [t("cw.snag.stopsShort")] : [])];
    case "put-right":
      return [t("offline.holds.note", { note: text(m["note"]) })];
    case "sign-off":
      return [t("offline.holds.checks", { n: f.number(count(m["checks"])), all: f.number(5) }), t("offline.holds.signer", { name: text(m["signer"]) })];
    case "check":
      return [t("offline.holds.ticks", { n: f.number(count(m["ticked"])), all: f.number(5) })];
    case "fault":
      return [text(m["text"])];
    case "fill":
      return [t("offline.holds.fill", { litres: f.number(count(m["litres"])), cost: f.money(m["cost"]), reading: f.number(count(m["odometer"])) })];
    case "day":
    case "day-change":
      return [text(m["what"]), t("offline.holds.hours", { hours: f.number(count(m["hours"])), travel: f.number(count(m["travel"])) })];
    case "send-week":
      return [t("offline.holds.send")];
    default:
      return [];
  }
}

/** Why a line was refused, in one sentence, from what came back with it. */
export function whyText(line: QueueLine, lines: readonly QueueLine[], names: Record<string, string>, t: TFunction, f: Formatters): string {
  const refusal = line.refusal;
  if (refusal === null) return "";
  const when = (at: string | null, on: string | null): string => (at !== null ? f.time(new Date(at)) : on !== null ? f.dayShort(noonOf(on)) : "");
  if (line.kind === "sign-off") {
    const why = signWhy(line);
    if (why === "signed") return t("offline.why.signed");
    if (why === "snag") {
      const stopped = line.meta["stopped"] as StoppedBy | undefined;
      if (stopped === undefined) return t("offline.why.snagAny");
      const who = stopped.by === null ? undefined : names[stopped.by];
      const time = when(stopped.at, stopped.on);
      // Sent at once (there was signal): it was raised while the page was open, not while there was no signal.
      if (!line.kept) return who === undefined ? t("offline.why.snagNowNobody", { snag: stopped.text, time }) : t("offline.why.snagNow", { who, snag: stopped.text, time });
      return who === undefined ? t("offline.why.snagNobody", { snag: stopped.text, time }) : t("offline.why.snag", { who, snag: stopped.text, time });
    }
  }
  if (line.kind === "put-right" && refusal.code === "ROW_CHANGED") {
    const moved = line.meta["moved"] as MovedBy | undefined;
    if (moved?.state === "put-right") return moved.by !== null && moved.at !== null ? t("offline.why.putRight", { who: moved.by, snag: text(line.meta["text"]), time: f.time(new Date(moved.at)) }) : t("offline.why.putRightNobody", { snag: text(line.meta["text"]) });
    return t("offline.why.changed", { snag: text(line.meta["text"]) });
  }
  if (refusal.code === "NEEDED_REFUSED") {
    const needed = lines.find((one) => one.id === refusal.needed);
    // A week's sheet the phone made for its first day: its own refusal stands for the day's.
    if (needed !== undefined && needed.quiet && needed.refusal !== null) return t("offline.why.other", { reason: reasonOf(new StaffError(needed.refusal.status, needed.refusal.code, needed.refusal.message, needed.refusal.details), t) });
    const mine = lines.filter((one) => !one.quiet).sort((a, b) => a.seq - b.seq);
    const n = mine.findIndex((one) => one.id === refusal.needed) + 1;
    return n > 0 ? t("offline.why.needed", { n: f.number(n) }) : t("offline.why.neededGone");
  }
  if (refusal.code === "FILE_GONE") return t("offline.why.file");
  if (refusal.code === "RECORD_LOCKED") return t("offline.why.locked");
  return t("offline.why.other", { reason: reasonOf(new StaffError(refusal.status, refusal.code, refusal.message, refusal.details), t) });
}

/** What the person is told is lost when a line is taken off the phone. */
function loseText(line: QueueLine, t: TFunction, f: Formatters): string {
  const values = line.op.type === "act" ? (line.op.values ?? {}) : line.op.values;
  const held = heldIn(values);
  const signature = typeof values["signature"] === "string" && held.includes(values["signature"]);
  const photos = held.length - (signature ? 1 : 0);
  if (line.state === "refused") {
    // The signature of a refused sign-off is gone already; its checks, its name and its photos are what it still holds.
    if (line.kind === "sign-off") return t("offline.remove.refusedSign", { n: f.number(photos) }, photos);
    return t("offline.remove.never");
  }
  const lost = signature ? (photos === 0 ? t("offline.remove.loseSignOnly") : t("offline.remove.loseSign", { n: f.number(photos) }, photos)) : photos > 0 ? t("offline.remove.losePhotos", { n: f.number(photos) }, photos) : "";
  return [t("offline.remove.unsent"), lost].filter((part) => part !== "").join(" ");
}

/** Why a line was refused, in the person's words: for a toast or a box. */
export function useWhy(): (line: QueueLine) => string {
  const t = useT();
  const f = useFormatters();
  const names = usePeopleNames();
  const { lines } = useQueueLines();
  return useCallback((line: QueueLine) => whyText(line, lines, names, t, f), [lines, names, t, f]);
}

/**
 * Keep a save and send it if it can go now (`queue.tsx`). Kept on the phone,
 * the toast says so in the words given; refused at once (there was signal),
 * the toast says why and the line goes, unless the screen keeps it to show
 * (a sign-off: its checks and photos wait there for the next try).
 */
export function useSave(): (line: NewLine, opts?: { kept?: string; keepRefused?: boolean }) => Promise<AddResult> {
  const queue = useQueue();
  const toasts = useToasts();
  const t = useT();
  const why = useWhy();
  const whyRef = useRef(why);
  whyRef.current = why;
  return useCallback(
    async (line, opts = {}) => {
      const done = await queue.add(line);
      if (done.state === "kept") toasts.show(opts.kept ?? t("offline.kept"), "plain");
      if (done.state === "refused" && opts.keepRefused !== true) {
        toasts.show(whyRef.current(done.line), "danger", true);
        await queue.remove(done.line.id);
      }
      return done;
    },
    [queue, toasts, t],
  );
}

/* ─── The list's own place: opened from the pill, from My day, from a refusal ─── */

interface ListOpen {
  open: (lineId?: string) => void;
  /** Take a line off the phone, asking first (un-ticking a waiting tick asks the same). */
  confirmRemove: (line: QueueLine, done?: () => void) => void;
}
const ListContext = createContext<ListOpen | null>(null);

export function useQueueList(): ListOpen {
  const list = useContext(ListContext);
  if (list === null) throw new Error("useQueueList is read inside <QueueListProvider>");
  return list;
}

export function QueueListProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ line: string | null } | null>(null);
  const [removing, setRemoving] = useState<{ line: QueueLine; done?: (() => void) | undefined } | null>(null);
  const value = useMemo<ListOpen>(
    () => ({
      open: (lineId) => setShown({ line: lineId ?? null }),
      confirmRemove: (line, done) => setRemoving({ line, done }),
    }),
    [],
  );
  return (
    <ListContext.Provider value={value}>
      {children}
      {shown !== null && removing === null && <QueueSheet first={shown.line} onClose={() => setShown(null)} onRemove={(line) => setRemoving({ line })} />}
      {removing !== null && (
        <RemoveConfirm
          line={removing.line}
          onClose={() => setRemoving(null)}
          onDone={() => {
            removing.done?.();
            setRemoving(null);
          }}
        />
      )}
    </ListContext.Provider>
  );
}

/* ─── The pieces ─── */

/** "No signal": above every crew screen while there is none. */
export function SignalLine({ failed = false }: { failed?: boolean }) {
  const t = useT();
  const queue = useQueue();
  const { offline } = useQueueLines();
  // A read that did not arrive is no signal too, though the phone may think it has some.
  if (!offline && !failed) return null;
  return (
    <div className="crm-cw-offline" role="status" data-testid="cw-signal">
      <Icon name="wifi-off" size={16} className="crm-cw-offline-icon" />
      <div className="crm-cw-offline-words">
        <div className="crm-cw-offline-line">{t("offline.signal")}</div>
        {queue.kept() === "memory" && <div className="crm-cw-offline-tried">{t("offline.signal.memory")}</div>}
      </div>
    </div>
  );
}

/** The pill in the bar: what waits or was refused; it opens the list. Nothing waits, no pill. */
export function QueuePill() {
  const t = useT();
  const f = useFormatters();
  const { view } = useQueueLines();
  const list = useQueueList();
  const pill = view.pill;
  if (pill.kind === "none") return null;
  const refused = pill.kind === "refused";
  return (
    <button
      type="button"
      className="crm-q-pill mr-gi"
      data-tone={refused ? "danger" : "plain"}
      data-testid="queue-pill"
      aria-label={t(refused ? "offline.pill.aria.refused" : "offline.pill.aria.waiting", { n: f.number(pill.n) }, pill.n)}
      onClick={() => list.open()}
    >
      <Icon name={pill.sending ? "loader" : refused ? "circle-x" : "hourglass"} size={14} />
      <span className="crm-mono crm-q-pill-n">{f.number(pill.n)}</span>
      <span>{t(refused ? "offline.pill.refused" : "offline.pill.waiting")}</span>
    </button>
  );
}

/** "Waiting to send" (or "Sending") beside something a screen shows that is still only on the phone. */
export function WaitChip({ line }: { line: Pick<QueueLine, "state"> | undefined }) {
  const t = useT();
  if (line === undefined || (line.state !== "waiting" && line.state !== "sending")) return null;
  const sending = line.state === "sending";
  return (
    <span className="crm-q-chip" data-tone={sending ? "info" : "plain"} data-testid="queue-chip">
      <Icon name={sending ? "loader" : "hourglass"} size={12} />
      {t(sending ? "offline.chip.sending" : "offline.chip.waiting")}
    </span>
  );
}

/** The row on My day: what is on this phone, and the way to the list. Nothing on the phone today, no row. */
export function QueueRow() {
  const t = useT();
  const f = useFormatters();
  const { view } = useQueueLines();
  const list = useQueueList();
  if (view.shown.length === 0) return null;
  const refused = view.refused > 0;
  const sub = refused ? t("offline.row.refused", { n: f.number(view.refused) }, view.refused) : view.waiting > 0 ? t("offline.row.waiting", { n: f.number(view.waiting) }, view.waiting) : t("offline.row.sent", { n: f.number(view.sent) }, view.sent);
  return (
    <button type="button" className="crm-q-row mr-row" data-tone={refused ? "danger" : "plain"} data-testid="queue-row" onClick={() => list.open()}>
      <Icon name={refused ? "circle-x" : "hourglass"} size={16} />
      <span className="crm-q-row-words">
        <span className="crm-q-row-title">{t("offline.row.title")}</span>
        <span className="crm-q-row-sub">{sub}</span>
      </span>
      <Icon name="chevron-right" size={16} className="crm-cw-flip" />
    </button>
  );
}

/** A refusal, where a screen shows it: why, what to do, and the way to the snag. */
export function RefusedBox({ line, onSnag, children }: { line: QueueLine; onSnag?: (() => void) | undefined; children?: ReactNode }) {
  const t = useT();
  const f = useFormatters();
  const names = usePeopleNames();
  const { lines } = useQueueLines();
  return (
    <div className="crm-cw-refused crm-q-refused" role="alert" data-testid="queue-refused">
      <Icon name="circle-x" size={16} />
      <div className="crm-q-refused-words">
        <p>{whyText(line, lines, names, t, f)}</p>
        {children}
        {onSnag !== undefined && (
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" onClick={onSnag}>
            <Icon name="wrench" size={14} />
            {t("offline.seeSnag")}
          </button>
        )}
      </div>
    </div>
  );
}

function stateTone(line: QueueLine): string {
  return line.state === "refused" ? "danger" : line.state === "sent" ? "pos" : line.state === "sending" ? "info" : "plain";
}

function LineRow({ line, number, bytes, onOpen }: { line: QueueLine; number: number; bytes: number; onOpen: () => void }) {
  const t = useT();
  const f = useFormatters();
  return (
    <li className="crm-q-line" data-state={line.state} data-line={line.id} data-kind={line.kind}>
      <button type="button" className="crm-q-line-btn mr-row" onClick={onOpen}>
        <span className="crm-q-num crm-mono" aria-hidden="true">
          {line.state === "refused" ? <Icon name="circle-x" size={14} /> : f.number(number)}
        </span>
        <span className="crm-q-line-words">
          <span className="crm-q-line-title" dir="auto">
            {lineTitle(line, t, f)}
          </span>
          <span className="crm-q-line-meta">
            <span className="crm-mono">{f.time(new Date(line.madeAt))}</span>
            {" · "}
            {filesText(line, bytes, t, f)}
          </span>
        </span>
        <span className="crm-pill" data-tone={stateTone(line)}>
          {t(`offline.state.${line.state}`)}
        </span>
      </button>
    </li>
  );
}

function HeldPhoto({ id, alt }: { id: string; alt: string }) {
  const src = useHeldSrc(id);
  return src === null ? <span className="crm-q-photo crm-q-photo-none" aria-hidden="true" /> : <img className="crm-q-photo" src={src} alt={alt} />;
}

function QueueSheet({ first, onClose, onRemove }: { first: string | null; onClose: () => void; onRemove: (line: QueueLine) => void }) {
  const t = useT();
  const f = useFormatters();
  const nav = useNav();
  const queue = useQueue();
  const { lines, view } = useQueueLines();
  const [open, setOpen] = useState<string | null>(first);
  const [bytes, setBytes] = useState<Record<string, number>>({});
  useEffect(() => {
    let gone = false;
    void Promise.all(view.shown.map(async (line) => [line.id, await heldBytes(queue, line)] as const)).then((sizes) => !gone && setBytes(Object.fromEntries(sizes)));
    return () => {
      gone = true;
    };
  }, [queue, view.shown]);
  const line = open === null ? undefined : lines.find((one) => one.id === open && !one.quiet);
  const values = line === undefined ? {} : line.op.type === "act" ? (line.op.values ?? {}) : line.op.values;
  const photos = line === undefined ? [] : heldIn(values).filter((id) => id !== values["signature"]);
  const snag = line?.kind === "sign-off" ? (line.meta["stopped"] as StoppedBy | undefined) : undefined;
  return (
    <Dialog
      shape="sheet"
      icon="hourglass"
      title={line === undefined ? t("offline.list.title") : lineTitle(line, t, f)}
      subtitle={line === undefined ? t("offline.list.sub") : undefined}
      onClose={onClose}
      name="queue"
      foot={
        line === undefined ? (
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" onClick={onClose}>
            {t("ui.close")}
          </button>
        ) : (
          <>
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" onClick={() => setOpen(null)}>
              <Icon name="chevron-left" size={15} className="crm-cw-flip" />
              {t("offline.list.back")}
            </button>
            {(line.state === "waiting" || line.state === "refused") && (
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 crm-q-remove mr-gi" data-testid="queue-remove" onClick={() => onRemove(line)}>
                <Icon name="trash-2" size={15} />
                {t("offline.remove")}
              </button>
            )}
          </>
        )
      }
    >
      {line === undefined ? (
        view.shown.length === 0 ? (
          <p className="crm-cw-quiet" data-testid="queue-empty">
            {t("offline.list.empty")}
          </p>
        ) : (
          <>
            <ol className="crm-q-lines" data-testid="queue-list">
              {view.shown.map((one) => (
                <LineRow key={one.id} line={one} number={view.number(one)} bytes={bytes[one.id] ?? 0} onOpen={() => setOpen(one.id)} />
              ))}
            </ol>
            {view.sent > 0 && <p className="crm-cw-quiet crm-q-foot">{t("offline.list.sentNote")}</p>}
          </>
        )
      ) : (
        <div className="crm-q-open" data-testid="queue-line" data-state={line.state}>
          <span className="crm-pill" data-tone={stateTone(line)}>
            {t(`offline.state.${line.state}`)}
          </span>
          {line.state === "refused" && (
            <RefusedBox
              line={line}
              onSnag={
                snag === undefined
                  ? undefined
                  : () => {
                      onClose();
                      nav.go("mysnags");
                    }
              }
            >
              {line.kind !== "sign-off" && <p>{t("offline.why.todo")}</p>}
            </RefusedBox>
          )}
          <dl className="crm-q-facts">
            <div>
              <dt>{t("offline.line.madeLabel")}</dt>
              <dd className="crm-mono">{t("offline.line.made", { time: f.time(new Date(line.madeAt)) })}</dd>
            </div>
            <div>
              <dt>{t("offline.line.numberLabel")}</dt>
              <dd className="crm-mono">{t("offline.line.number", { n: f.number(view.number(line)) })}</dd>
            </div>
          </dl>
          <h3 className="crm-q-h3">{t("offline.line.holds")}</h3>
          <ul className="crm-q-holds">
            {holdsOf(line, t, f).map((fact, i) => (
              <li key={i} dir="auto">
                {fact}
              </li>
            ))}
            <li>{filesText(line, bytes[line.id] ?? 0, t, f)}</li>
          </ul>
          {photos.length > 0 && (
            <div className="crm-q-photos">
              {photos.map((id, i) => (
                <HeldPhoto key={id} id={id} alt={t("cw.signed.photoAlt", { n: f.number(i + 1) })} />
              ))}
            </div>
          )}
          <p className="crm-cw-quiet">{t("offline.line.fixed")}</p>
        </div>
      )}
    </Dialog>
  );
}

function RemoveConfirm({ line, onClose, onDone }: { line: QueueLine; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const f = useFormatters();
  const queue = useQueue();
  const toasts = useToasts();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      shape="box"
      icon="trash-2"
      title={t("offline.remove.title")}
      subtitle={lineTitle(line, t, f)}
      onClose={onClose}
      busy={busy}
      name="queue-remove"
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-autofocus onClick={onClose} disabled={busy}>
            {t("offline.remove.keep")}
          </button>
          <button
            type="button"
            className="crm-btn crm-btn-ghost crm-btn-44 crm-q-remove mr-gi"
            data-testid="queue-remove-go"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void queue.remove(line.id).then((gone) => {
                setBusy(false);
                if (gone) toasts.show(t("offline.removed"), "plain");
                onDone();
              });
            }}
          >
            {t("offline.remove.go")}
          </button>
        </>
      }
    >
      <p>{loseText(line, t, f)}</p>
    </Dialog>
  );
}

/**
 * Sign-out, asked first while anything waits, is being sent or was refused:
 * signing out throws it away. A line being sent is let finish first.
 */
export function useGuardedSignOut(signOut: () => Promise<void>): { leave: () => void; dialog: ReactNode } {
  const t = useT();
  const f = useFormatters();
  const queue = useQueue();
  const { view, lines } = useQueueLines();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const leave = useCallback(() => {
    if (queue.busy()) setAsking(true);
    else void queue.clear().then(() => signOutRef.current());
  }, [queue]);
  // With the hidden lines still to send (a refused sign-off's record), so the count is never "0 saves".
  const n = view.waiting + view.refused + lines.filter((line) => line.quiet && (line.state === "waiting" || line.state === "sending")).length;
  const dialog = asking ? (
    <Dialog
      shape="box"
      icon="log-out"
      title={t("offline.out.title")}
      onClose={() => setAsking(false)}
      busy={busy}
      name="queue-signout"
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-autofocus disabled={busy} onClick={() => setAsking(false)}>
            {t("offline.out.stay")}
          </button>
          <button
            type="button"
            className="crm-btn crm-btn-ghost crm-btn-44 crm-q-remove mr-gi"
            data-testid="queue-signout-go"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void queue.clear().then(() => signOutRef.current());
            }}
          >
            {t("offline.out.go")}
          </button>
        </>
      }
    >
      <p>{t("offline.out.body", { n: f.number(n) }, n)}</p>
    </Dialog>
  ) : null;
  return { leave, dialog };
}

/* ─── The old online-only line (My certificates) ─── */

export interface Connection {
  /** Whether the last thing tried did not reach the server. */
  down: boolean;
  /** A save or a read did not get through: show the line, and what "Try again" does. */
  lost: (again: () => Promise<boolean> | void) => void;
  /** Something got through. */
  back: () => void;
}

export function useConnection(): Connection & { tried: Date | null; retry: () => void; busy: boolean } {
  const session = useSession();
  const [down, setDown] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [tried, setTried] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const again = useRef<(() => Promise<boolean> | void) | null>(null);
  useEffect(() => {
    const off = (): void => setDown(true);
    window.addEventListener("offline", off);
    return () => window.removeEventListener("offline", off);
  }, []);
  const lost = useCallback((next: () => Promise<boolean> | void) => {
    again.current = next;
    setDown(true);
  }, []);
  const back = useCallback(() => {
    again.current = null;
    setTried(null);
    setDown(false);
  }, []);
  const retry = useCallback(() => {
    const run = again.current;
    setBusy(true);
    void Promise.resolve(run === null ? true : run()).then((ok) => {
      setBusy(false);
      if (ok === false) setTried(session.now());
      else if (run === null) back();
    });
  }, [session, back]);
  return { down, tried, retry, busy, lost, back };
}

export function NoConnection({ tried, onRetry, busy }: { tried: Date | null; onRetry: () => void; busy: boolean }) {
  const t = useT();
  const f = useFormatters();
  return (
    <div className="crm-cw-offline" role="status" data-testid="cw-offline">
      <Icon name="wifi-off" size={16} className="crm-cw-offline-icon" />
      <div className="crm-cw-offline-words">
        <div className="crm-cw-offline-line">{t("cw.offline")}</div>
        {tried !== null && <div className="crm-cw-offline-tried">{t("cw.offline.tried", { time: f.time(tried) })}</div>}
      </div>
      <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" disabled={busy} onClick={onRetry}>
        <Icon name="refresh-cw" size={14} />
        {t("cw.offline.retry")}
      </button>
    </div>
  );
}

/**
 * A screen the queue serves reads again when the signal comes back, when a
 * save kept on the phone has gone (its row is the server's now), and every
 * quarter-minute while a read has not arrived; "No signal" says why meanwhile.
 */
export function useReadAgainOnSignal(failed: boolean, reload: () => void): void {
  const { offline, view } = useQueueLines();
  const was = useRef(offline);
  const sent = useRef(view.sent);
  useEffect(() => {
    if (was.current && !offline) reload();
    was.current = offline;
  }, [offline, reload]);
  useEffect(() => {
    if (view.sent > sent.current) reload();
    sent.current = view.sent;
  }, [view.sent, reload]);
  useEffect(() => {
    if (!failed) return;
    const timer = setInterval(reload, 15_000);
    return () => clearInterval(timer);
  }, [failed, reload]);
}

export { atOf };
