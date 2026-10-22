/**
 * THE CREW'S OFFLINE QUEUE in this app (plan 68 S19): the shared queue
 * (`offlineQueue.ts`) opened for whoever is signed in, and what the CRM's
 * phone screens put in it.
 *
 * Every save of the crew's phone screens goes through it: a tick on My day,
 * a snag and "Put right", the sign-off with its photos and signature, a check,
 * a fault and a fuel fill on My vehicle, a day and the week on My hours. With
 * signal and nothing waiting a save is sent at once and the screen hears how
 * it ended, as before; with none, it is kept on the phone (with its retry key
 * and its files) and sent, in order, when the signal comes back. A refusal
 * that comes back then is kept on the phone with why, until the person
 * removes it.
 *
 * A SIGN-OFF REFUSED ON ARRIVAL. A refused save makes no row, so the office
 * would never know. When a sign-off is refused because a snag that stops it
 * was raised meanwhile, the phone writes down that it was
 * (`refused_sign_offs`), straight after, with a key made from the sign-off's
 * own: who signed and when, on the phone, and the snag. The server fills in
 * when it reached it, who sent it and the snag's words, and refuses one for
 * any other crew's visit or for a snag that does not stop that job
 * (`proofs/crm-crew.test.ts`). The office's Sign-off reads it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { useT } from "../../i18n/index.tsx";
import { latest, openQueue, phoneStore, queueName, queueView, type FollowUp, type Queue, type QueueLine, type QueueSession, type QueueView } from "../../offlineQueue.ts";
import { useSession } from "../../session/session.tsx";
import type { Row, StaffSession } from "../../staffSession.ts";
import { useToasts } from "../../ui/toast.tsx";
import { warmFileParts } from "./FileParts.tsx";

const QueueContext = createContext<Queue | null>(null);

/** The queue of whoever is signed in. */
export function useQueue(): Queue {
  const queue = useContext(QueueContext);
  if (queue === null) throw new Error("useQueue is read inside <QueueProvider>");
  return queue;
}

/** The lines and the pill, kept current. */
export function useQueueLines(): { lines: readonly QueueLine[]; view: QueueView; offline: boolean } {
  const queue = useQueue();
  const lines = useSyncExternalStore(
    useCallback((listener: () => void) => queue.subscribe(listener), [queue]),
    () => queue.lines(),
  );
  const offline = useSyncExternalStore(
    useCallback((listener: () => void) => queue.subscribe(listener), [queue]),
    () => queue.offline(),
  );
  const view = useMemo(() => queueView(lines), [lines]);
  return { lines, view, offline };
}

/* ─── What a refusal comes back with ─── */

/** The snag a refused sign-off ran into, as the phone read it when the refusal came back. */
export interface StoppedBy {
  id: number;
  text: string;
  by: string | null;
  at: string | null;
  on: string | null;
}

/** Who moved a snag before a put-right of the phone's arrived, and when, from its history. */
export interface MovedBy {
  state: string | null;
  by: string | null;
  at: string | null;
}

/** A sign-off refused for a snag, for a job signed already, or for another reason. */
export function signWhy(line: Pick<QueueLine, "refusal">): "snag" | "signed" | "other" {
  const refusal = line.refusal;
  if (refusal === null) return "other";
  const fields = (refusal.details["fields"] ?? {}) as Record<string, { code?: string } | undefined>;
  if (refusal.status === 422 && fields["job_id"]?.code === "not-allowed") return "snag";
  if (refusal.status === 409 && refusal.code === "UNIQUE_VIOLATION") return "signed";
  return "other";
}

/** The refused-record's key, made from the sign-off's own: the same refusal written twice is one record. */
export const recordKey = (signOffKey: string): string => `R${signOffKey.slice(1)}`;

/** What the phone writes and reads once a line of the crew's is refused. */
async function afterRefused(line: QueueLine, session: StaffSession): Promise<FollowUp | null> {
  if (line.kind === "sign-off" && line.op.type === "create") {
    if (signWhy(line) !== "snag") return null;
    const job = Number(line.meta["job"]);
    // The snag that stops it now: the newest raised, as the screen lists them.
    const page = await session.list<Row>("snags", {
      select: ["id", "text", "raised_by_id", "raised_at", "raised_on"],
      where: { and: [{ column: "job_id", op: "eq", value: job }, { column: "stops_sign_off", op: "eq", value: true }, { column: "state", op: "in", value: ["open", "waiting-part"] }] },
      order: ["raised_on.desc", "id.desc"],
      limit: 1,
    });
    const snag = page.rows[0];
    if (snag === undefined) return null;
    const stopped: StoppedBy = { id: Number(snag["id"]), text: String(snag["text"] ?? ""), by: typeof snag["raised_by_id"] === "string" ? snag["raised_by_id"] : null, at: typeof snag["raised_at"] === "string" ? snag["raised_at"] : null, on: typeof snag["raised_on"] === "string" ? snag["raised_on"].slice(0, 10) : null };
    const values = line.op.values;
    return {
      meta: { stopped },
      lines: [
        {
          kind: "refused-record",
          quiet: true,
          meta: { of: line.id, job },
          op: { type: "create", table: "refused_sign_offs", values: { visit_id: values["visit_id"], signer_name: values["signer_name"], signed_at: line.madeAt, snag_id: stopped.id }, key: recordKey(line.op.key) },
        },
      ],
    };
  }
  if (line.kind === "put-right" && line.op.type === "update" && line.refusal?.code === "ROW_CHANGED") {
    const id = line.op.id as number;
    const row = await session.get<Row>("snags", id);
    if (row === null) return null;
    let by: string | null = null;
    let at: string | null = null;
    try {
      const { entries } = await session.history("snags", id, { limit: 20 });
      const moved = entries.find((entry) => (entry.changes as { after?: Record<string, unknown> | null } | null)?.after?.["state"] === row["state"]);
      if (moved !== undefined) {
        by = moved.actorLabel;
        at = new Date(/^\d+$/.test(String(moved.createdAt)) ? Number(moved.createdAt) : moved.createdAt).toISOString();
      }
    } catch {
      // Its history is not his to read, or not reachable: the line says what is now true without who.
    }
    const movedBy: MovedBy = { state: typeof row["state"] === "string" ? row["state"] : null, by, at };
    return { meta: { moved: movedBy } };
  }
  return null;
}

/* ─── The provider ─── */

/** Open the signed-in person's queue, send what waits when the signal comes back, and say what came of it. */
export function QueueProvider({ app, children }: { app: string; children: ReactNode }) {
  const session = useSession();
  const t = useT();
  const toasts = useToasts();
  const user = session.config.user?.id ?? "nobody";
  const queue = useMemo(
    () =>
      openQueue({
        session: session as unknown as QueueSession,
        store: phoneStore(queueName(app, session.connectionId, user)),
        afterRefused: (line) => afterRefused(line, session),
        // The phone's day by the server's clock: lines sent on an earlier day go.
        today: () => {
          const now = session.now();
          return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        },
      }),
    [app, session, user],
  );
  useEffect(() => queue.watch(window), [queue]);
  // The crew's forms draw Adminium's photo field and signature pad: loaded now, while there is signal.
  useEffect(() => {
    if (["sign_offs", "snags", "vehicle_faults"].some((ref) => session.can(ref, "create") || session.can(ref, "update"))) warmFileParts(session.config);
  }, [session]);
  useEffect(
    () =>
      queue.onRound((round) => {
        if (round.refused > 0) toasts.show(round.sent === 0 ? t("offline.round.refusedOnly", { n: round.refused }, round.refused) : t("offline.round.refused", { sent: round.sent, n: round.refused }, round.refused), "danger", true);
        else toasts.show(t("offline.round.sent", { n: round.sent }, round.sent), "pos");
      }),
    [queue, toasts, t],
  );
  return <QueueContext.Provider value={queue}>{children}</QueueContext.Provider>;
}

/* ─── Reading it ─── */

/** The newest waiting, sending or refused line of a kind that matches: what a screen shows in place of the server's value. */
export function useLatest(match: (line: QueueLine) => boolean, states?: QueueLine["state"][]): QueueLine | undefined {
  const { lines } = useQueueLines();
  return latest(lines, match, states);
}

/** People's names, by id: read once a session (every part that says "raised by" shares the one read). */
const namesOf = new WeakMap<StaffSession, Promise<Record<string, string>>>();
export function usePeopleNames(): Record<string, string> {
  const session = useSession();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let gone = false;
    let asked = namesOf.get(session);
    if (asked === undefined) {
      asked = session.people(undefined, 200).then((people) => Object.fromEntries(people.map((person) => [person.id, person.name])));
      // A read that did not arrive is asked again by the next part that needs it.
      asked.catch(() => namesOf.delete(session));
      namesOf.set(session, asked);
    }
    asked.then((found) => !gone && setNames(found)).catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [session]);
  return names;
}

/** The phone's copy of a file, as an address an image can show; null while it is read or once it is gone. */
export function useHeldSrc(id: string | null): string | null {
  const queue = useQueue();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (id === null) return setSrc(null);
    let url: string | null = null;
    let gone = false;
    void queue.file(id).then((file) => {
      if (gone || file === null) return;
      url = URL.createObjectURL(file.blob);
      setSrc(url);
    });
    return () => {
      gone = true;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [queue, id]);
  return src;
}
