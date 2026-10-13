/**
 * Reading what a screen shows, and saying so honestly while it is on its way
 * or when it did not come.
 *
 * `useLoad` runs a read as the signed-in person and keeps the last good
 * answer on screen while it reads again (after a save, or when a colleague's
 * change is heard), so a list does not blink. The first read shows a quiet
 * skeleton; a read that fails shows what happened and "Try again", never a
 * blank page and never yesterday's figures passed off as today's.
 */
import { useCallback, useEffect, useRef, useState, type DependencyList, type ReactNode } from "react";

import { useT } from "../i18n/index.tsx";
import { useSession } from "../session/session.tsx";
import { LostReply, StaffError } from "../staffSession.ts";

export type Load<T> =
  | { state: "loading" }
  | { state: "ready"; data: T; again: boolean }
  /** The server said no: the person may not read this. */
  | { state: "refused"; error: StaffError }
  /** The read did not arrive. */
  | { state: "failed" };

export function useLoad<T>(read: () => Promise<T>, deps: DependencyList): { load: Load<T>; reload: () => void } {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    const mine = (latest.current += 1);
    setLoad((was) => (was.state === "ready" ? { ...was, again: true } : { state: "loading" }));
    read().then(
      (data) => {
        if (latest.current === mine) setLoad({ state: "ready", data, again: false });
      },
      (error: unknown) => {
        if (latest.current !== mine) return;
        if (error instanceof StaffError) setLoad({ state: "refused", error });
        else if (error instanceof LostReply) setLoad((was) => (was.state === "ready" ? { ...was, again: false } : { state: "failed" }));
        else throw error;
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what the read depends on
  }, [...deps, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { load, reload };
}

/** Read again when a colleague (or a rule) changes one of these tables. One read per burst of changes. */
export function useLive(tables: readonly string[], reload: () => void): void {
  const session = useSession();
  const key = tables.join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = (): void => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        reload();
      }, 250);
    };
    const stop = session.listen(key.split(","), soon, reload);
    return () => {
      stop();
      if (timer !== null) clearTimeout(timer);
    };
  }, [session, key, reload]);
}

/** What a screen shows in place of its content when the read failed. */
export function LoadFailed({ reload }: { reload: () => void }) {
  const t = useT();
  return (
    <div className="crm-load-failed" role="alert">
      <strong>{t("ui.loadFailed")}</strong>
      <span>{t("ui.loadFailed.body")}</span>
      <button type="button" className="crm-btn crm-btn-ghost mr-gi" onClick={reload}>
        {t("ui.tryAgain")}
      </button>
    </div>
  );
}

/** Blocks the size of what is coming, while the first read is on its way. */
export function Skeleton({ rows = 3, height = 56 }: { rows?: number; height?: number }) {
  const t = useT();
  return (
    <div className="crm-skeleton" role="status" aria-label={t("ui.loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mr-skel" style={{ blockSize: height }} />
      ))}
    </div>
  );
}

export function Loaded<T>({ load, reload, skeleton, children }: { load: Load<T>; reload: () => void; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  if (load.state === "loading") return <>{skeleton ?? <Skeleton />}</>;
  if (load.state === "failed" || load.state === "refused") return <LoadFailed reload={reload} />;
  return <>{children(load.data)}</>;
}
