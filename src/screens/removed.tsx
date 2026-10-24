/**
 * WHAT WAS TAKEN AWAY, AND WHY (plan 68 S3, S16; Adminium's E8).
 *
 * A table that keeps its removed rows (`removal.history`) answers them only
 * through a row they hung on that the reader reads NOW: a deal's people taken
 * off, a deal's cancelled visits, a job's called-off visits, a space's
 * cancelled bookings. Each comes with who removed it, when and, where the
 * table takes one, why; its columns as the reader's live read would show
 * them. A parent the reader does not read answers "not there" and is passed
 * over, never an error on the page.
 *
 * The screens read these only when asked (`RemovedPanel`): a list of removed
 * rows costs one request per parent row.
 */
import { useState } from "react";

import { useT } from "../i18n/index.tsx";
import type { Formatters } from "../lib/format.ts";
import { useSession } from "../session/session.tsx";
import { Icon } from "../shell/icons.tsx";
import { StaffError, type StaffSession } from "../staffSession.ts";
import { Loaded, Skeleton, useLoad } from "../ui/load.tsx";

/** One removed row, as the server keeps it under a parent. */
export interface Removed<R extends Record<string, unknown> = Record<string, unknown>> {
  key: string;
  at: Date;
  /** Who removed it, as the server names them ("Adminium" for a rule's or an undo's removal). */
  by: string;
  /** The why the person gave; null for none. */
  reason: string | null;
  row: R;
  /** The parent it was read under. */
  parent: { ref: string; id: number; label: string };
}

interface Reply {
  removed: { key: string; removedAt: number | string; actorLabel: string; reason: string | null; row: Record<string, unknown> }[];
  nextCursor: string | null;
}

const momentOf = (value: number | string): Date => new Date(typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : value);

/** The removed rows of `child` under one parent row, newest first; none when the reader does not read that row. */
export async function readRemoved<R extends Record<string, unknown>>(session: Pick<StaffSession, "call" | "connectionId" | "tableId">, parent: { ref: string; id: number; label: string }, child: string, limit = 50): Promise<Removed<R>[]> {
  const path = `/data/${encodeURIComponent(session.connectionId)}/${encodeURIComponent(session.tableId(parent.ref))}/${encodeURIComponent(String(parent.id))}/removed/${encodeURIComponent(session.tableId(child))}?limit=${String(limit)}`;
  try {
    const reply = await session.call<Reply>("GET", path);
    return reply.removed.map((one) => ({ key: one.key, at: momentOf(one.removedAt), by: one.actorLabel, reason: one.reason === null || one.reason.trim() === "" ? null : one.reason, row: one.row as R, parent }));
  } catch (error) {
    // A parent the reader no longer reads, or a table she does not: nothing to show under it.
    if (error instanceof StaffError && (error.status === 404 || error.status === 403)) return [];
    throw error;
  }
}

/** The same under several parents, a few at a time, newest first, at most `cap` in all. */
export async function readRemovedUnder<R extends Record<string, unknown>>(session: Pick<StaffSession, "call" | "connectionId" | "tableId">, parents: readonly { ref: string; id: number; label: string }[], child: string, cap = 100): Promise<Removed<R>[]> {
  const out: Removed<R>[] = [];
  for (let from = 0; from < parents.length; from += 4) {
    const some = await Promise.all(parents.slice(from, from + 4).map((parent) => readRemoved<R>(session, parent, child, 20)));
    for (const rows of some) out.push(...rows);
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, cap);
}

/**
 * A closed section under a screen: "Cancelled visits", opened by a press, read
 * then. Each line says what it was, who took it away and when, and why.
 */
export function RemovedPanel<R extends Record<string, unknown>>({
  title,
  testId,
  f,
  read,
  what,
}: {
  title: string;
  testId: string;
  f: Formatters;
  read: () => Promise<Removed<R>[]>;
  /** What the row was ("Walk the floor · Thu, Jul 30, 10:00"), and its place ("Nordwind refit"). */
  what: (item: Removed<R>) => { title: string; detail: string };
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <section className="crm-removed" data-testid={testId} aria-label={title}>
      <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi crm-removed-toggle" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <Icon name={open ? "chevron-up" : "history"} size={14} />
        {open ? t("rm.list.hide", { what: title }) : t("rm.list.show", { what: title })}
      </button>
      {open && <RemovedLines f={f} read={read} what={what} />}
    </section>
  );
}

function RemovedLines<R extends Record<string, unknown>>({ f, read, what }: { f: Formatters; read: () => Promise<Removed<R>[]>; what: (item: Removed<R>) => { title: string; detail: string } }) {
  const t = useT();
  const session = useSession();
  const { load, reload } = useLoad(read, [session]);
  return (
    <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={48} />}>
      {(items) =>
        items.length === 0 ? (
          <p className="crm-removed-none">{t("rm.list.none")}</p>
        ) : (
          <ul className="crm-removed-list">
            {items.map((item) => {
              const shown = what(item);
              return (
                <li key={`${item.parent.ref}:${String(item.parent.id)}:${item.key}:${String(item.at.getTime())}`} className="crm-removed-line" data-removed={item.key}>
                  <span className="crm-removed-mark" aria-hidden="true">
                    <Icon name="calendar-x" size={14} />
                  </span>
                  <div className="crm-removed-body">
                    <div className="crm-removed-head">
                      <strong>{shown.title}</strong>
                      {shown.detail !== "" && <span className="crm-removed-detail">{shown.detail}</span>}
                    </div>
                    <p className="crm-removed-by">{t("rm.list.by", { name: item.by, when: `${f.dayShort(item.at)}, ${f.time(item.at)}` })}</p>
                    <p className="crm-removed-why" data-testid="removed-why">
                      {item.reason === null ? t("rm.list.noWhy") : t("rm.list.why", { reason: item.reason })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      }
    </Loaded>
  );
}
