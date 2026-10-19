/**
 * "NO CONNECTION" on the crew's phone (ruling Q1: online only).
 *
 * Nothing is kept on the phone and nothing is sent later by itself. When a
 * save cannot reach Adminium, or a page cannot be read, the screen says so in
 * the ruling's words, keeps on screen what was typed and what was read, and
 * offers "Try again", which sends the same thing again (a create with the same
 * retry key, so a save that did arrive is not made twice).
 *
 * The browser's own "offline" is heard too, so the line shows as soon as the
 * phone knows; it goes once something reaches the server again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";

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
      // A try that got through clears the line itself (`back`); one that did not says when it was tried.
      if (ok === false) setTried(session.now());
      else if (run === null) back();
    });
  }, [session, back]);
  return { down, tried, retry, busy, lost, back };
}

/** The line itself, where the design draws it: under the day's heading, and on top of the sign-off. */
export function NoConnection({ tried, onRetry, busy }: { tried: Date | null; onRetry: () => void; busy: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const f = useMemo(() => formatters({ locale, currency: null, timeZone: session.config.timezone ?? session.config.serverTimezone ?? null }), [locale, session]);
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
