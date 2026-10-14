/**
 * THE BELL: the person's notices from Adminium, in the top bar.
 *
 * The badge is the server's unread count. Pressing the bell opens the list,
 * newest first: who, what, when. A notice about a record this app shows
 * opens the app's own screen for it (`shell/open-record.ts`) and is marked
 * read; a notice the server sent without a way in (somebody who cannot open
 * the record) is words only, and is marked read by "Mark all read".
 *
 * Live: the bell asks the server once a minute while the page is shown, and
 * at once when the page comes back into view (`notices.ts` says why it asks
 * rather than listens).
 *
 * The list is a small panel, not a dialog over the page: Tab moves through
 * its lines, Escape (or a press outside) closes it and gives the focus back
 * to the bell.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../i18n/index.tsx";
import { formatters } from "../lib/format.ts";
import { useSession } from "../session/session.tsx";
import { Icon } from "../shell/icons.tsx";
import { useNav } from "../shell/nav.tsx";
import { openRecord, type Place } from "../shell/open-record.ts";
import { useCoalesced } from "../ui/load.tsx";
import { firstName } from "../ui/people.ts";
import { markAllRead, markRead, POLL_MS, readNotices, shouldNudge, type Notice, type NoticePage } from "./notices.ts";

/** This app's key: the server's `opens` names it. */
const APP_KEY = "crm";

export function Bell() {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const nav = useNav();
  const config = session.config;
  const me = config.user;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [page, setPage] = useState<NoticePage | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const latest = useRef(0);

  const asked = useRef<number | null>(null);
  const read = useCallback(() => {
    asked.current = Date.now();
    const mine = (latest.current += 1);
    readNotices(session).then(
      (answer) => {
        if (latest.current !== mine) return;
        setPage(answer);
        setFailed(false);
      },
      () => {
        if (latest.current === mine) setFailed(true);
      },
    );
  }, [session]);
  const again = useCoalesced(read, 250);
  useEffect(read, [read]);
  useEffect(() => {
    // Once a minute while the page is shown; at once when it is shown again, or its window takes the focus.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, POLL_MS);
    const nudge = (): void => {
      if (document.visibilityState === "visible" && shouldNudge(asked.current, Date.now())) read();
    };
    document.addEventListener("visibilitychange", nudge);
    window.addEventListener("focus", nudge);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", nudge);
      window.removeEventListener("focus", nudge);
    };
  }, [read]);

  // Escape, and a press outside, close the list and give the focus back to the bell.
  const shut = useCallback((focus: boolean) => {
    setOpen(false);
    if (focus) button.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      shut(true);
    };
    document.addEventListener("keydown", onKey, true);
    panel.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, shut]);

  const placeOf = useCallback((notice: Notice): Place | null => openRecord(notice, { appKey: APP_KEY, connectionId: session.connectionId, tables: config.tables }), [session, config.tables]);

  const press = async (notice: Notice, place: Place): Promise<void> => {
    shut(false);
    nav.go(place.route, ...place.rest);
    if (notice.readAt === null) {
      try {
        await markRead(session, notice.id);
      } catch {
        // The list is read again either way; a notice left unread is still there to press.
      }
      again();
    }
  };
  const allRead = async (): Promise<void> => {
    try {
      await markAllRead(session);
    } catch {
      // Read again below: the count says what the server holds.
    }
    again();
  };

  const unread = page?.unreadCount ?? 0;
  const label = t("bell.label", undefined, unread);
  return (
    <div className="crm-bell">
      <button ref={button} type="button" className="crm-icon-btn mr-gi" aria-label={label} title={t("bell.title")} aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} data-testid="bell" onClick={() => {
          if (!open) again();
          setOpen((was) => !was);
        }}>
        <Icon name="bell" />
        {unread > 0 && (
          <span className="crm-bell-count crm-mono" aria-hidden="true" data-testid="bell-count">
            {unread > 99 ? "99+" : f.number(unread)}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="crm-scrim-clear" onClick={() => shut(false)} />
          <div ref={panel} id={`${id}-panel`} className="crm-bell-panel" role="region" aria-label={t("bell.for", { name: firstName(me?.name ?? "") })} data-testid="bell-panel">
            <div className="crm-bell-head">
              <span className="crm-bell-title">{t("bell.for", { name: firstName(me?.name ?? "") })}</span>
              {unread > 0 && (
                <button type="button" className="crm-bell-all mr-gi" onClick={() => void allRead()}>
                  <Icon name="check-check" size={14} />
                  {t("bell.allRead")}
                </button>
              )}
            </div>
            <div className="crm-bell-list mr-scroll">
              {page === null ? (
                <p className="crm-bell-quiet">{failed ? t("bell.failed") : t("ui.loading")}</p>
              ) : page.items.length === 0 ? (
                <p className="crm-bell-quiet">{t("bell.none")}</p>
              ) : (
                <ul>
                  {page.items.map((notice) => {
                    const place = placeOf(notice);
                    const when = `${f.dayShort(new Date(notice.createdAt))}, ${f.time(new Date(notice.createdAt))}`;
                    const words = (
                      <>
                        <span className="crm-bell-text">{notice.kind === "mention" ? t("bell.mention", { name: notice.actorLabel }) : notice.title}</span>
                        {notice.body !== null && notice.body !== "" && <span className="crm-bell-body">{notice.body}</span>}
                        <span className="crm-bell-when crm-mono">{when}</span>
                      </>
                    );
                    return (
                      <li key={notice.id} className="crm-bell-item" data-unread={notice.readAt === null ? "1" : "0"} data-testid="bell-item">
                        {notice.readAt === null && <span className="crm-bell-dot" aria-label={t("bell.unread")} role="img" />}
                        {place === null ? (
                          <div className="crm-bell-words" data-link="0">
                            {words}
                          </div>
                        ) : (
                          <a
                            className="crm-bell-words mr-row"
                            data-link="1"
                            href={nav.href(place.route, ...place.rest)}
                            onClick={(event) => {
                              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                              event.preventDefault();
                              void press(notice, place);
                            }}
                          >
                            {words}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
