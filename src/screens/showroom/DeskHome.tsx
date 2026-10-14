/**
 * THE FRONT DESK'S HOME: who is coming into the showroom today and tomorrow,
 * the samples late back, and the enquiries nobody has picked up. Three counts
 * of the server's and three short queues, each opening its screen. No total
 * across the three (decision 90): they are not one kind of thing.
 *
 * With the Inbox off, the third tile and queue are not drawn; with the
 * showroom off this home is not hers (the menu lands her on the Inbox).
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { readInbox, type Enquiry } from "../inbox/data.ts";
import { sourceLabel, whenOf } from "../inbox/parts.tsx";
import { useScreen } from "../team/data.ts";
import { daysLate, readDeskHome, spanOf } from "./data.ts";

export function DeskHome(_props: ScreenProps) {
  const t = useT();
  const { session, f, opens } = useScreen();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const inbox = opens("inbox") && session.can("enquiries", "read");
  const { load, reload } = useLoad(() => readDeskHome(session, now, f), [session, today, f]);
  const { load: enquiries, reload: reloadInbox } = useLoad(() => (inbox ? readInbox(session).then((data) => ({ open: data.counts.open, rows: data.rows.filter((row) => row.state === "open").slice(0, 4) })) : Promise.resolve(null)), [session, inbox]);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
      reloadInbox();
    }, [session, reload, reloadInbox]),
  );
  useLive(inbox ? ["showroom_bookings", "sample_loans", "enquiries"] : ["showroom_bookings", "sample_loans"], again);
  const open = enquiries.state === "ready" ? enquiries.data : null;

  return (
    <div className="crm-screen crm-sh mr-screen" data-screen="deskhome">
      <div className="crm-screen-head">
        <div>
          <h1>{t("sh.desk.title")}</h1>
          <p className="crm-screen-sub">{t("sh.desk.sub")}</p>
        </div>
        <div className="crm-screen-actions">
          <ScreenLink to="showroom" className="crm-btn crm-btn-primary crm-btn-40 mr-btn">
            <Icon name="store" />
            {t("nav.item.showroom")}
          </ScreenLink>
          {inbox && (
            <ScreenLink to="inbox" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
              <Icon name="inbox" />
              {t("nav.item.inbox")}
            </ScreenLink>
          )}
        </div>
      </div>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={110} />}>
        {(data) => (
          <>
            <div className="crm-sh-stats">
              <div className="crm-sh-stat mr-card" data-stat="soon">
                <div className="crm-kpi-label">{t("sh.desk.tile.soon")}</div>
                <div className="crm-sh-value crm-mono">{f.number(data.soonCount)}</div>
                <div className="crm-sh-stat-note">
                  {data.today === 0 ? t("sh.desk.tile.soon.noneToday") : t("sh.desk.tile.soon.today", { count: f.number(data.today) }, data.today)} · {t("sh.desk.tile.soon.tomorrow", { count: f.number(data.tomorrow) }, data.tomorrow)}
                </div>
              </div>
              <div className="crm-sh-stat mr-card" data-stat="late" data-tone={data.lateCount > 0 ? "danger" : "pos"}>
                <div className="crm-kpi-label">{t("sh.desk.tile.late")}</div>
                <div className="crm-sh-value crm-mono">{f.number(data.lateCount)}</div>
                <div className="crm-sh-stat-note">{t(data.lateCount > 0 ? "sh.desk.tile.late.note" : "sh.desk.tile.late.none")}</div>
              </div>
              {inbox && open !== null && (
                <div className="crm-sh-stat mr-card" data-stat="unclaimed" data-tone={open.open > 0 ? "warn" : "pos"}>
                  <div className="crm-kpi-label">{t("sh.desk.tile.unclaimed")}</div>
                  <div className="crm-sh-value crm-mono">{f.number(open.open)}</div>
                  <div className="crm-sh-stat-note">{t(open.open > 0 ? "sh.desk.tile.unclaimed.note" : "sh.desk.tile.unclaimed.none")}</div>
                </div>
              )}
            </div>

            <section className="crm-sh-queue mr-card" aria-labelledby="crm-sh-desk-soon">
              <h2 id="crm-sh-desk-soon">
                {t("sh.desk.soon")}
                <span className="crm-chip-count crm-mono">{f.number(data.soonCount)}</span>
              </h2>
              {data.soon.length === 0 ? (
                <p className="crm-sh-none">{t("sh.desk.soon.none")}</p>
              ) : (
                <ul className="crm-sh-rows">
                  {data.soon.map((booking) => {
                    const at = new Date(booking.starts_at);
                    const day = f.dayDiff(now, at);
                    const sub = [booking.space, booking.note, booking.state === "tentative" ? t("sh.desk.notConfirmed") : null].filter((part) => part !== null && part !== "").join(" · ");
                    return (
                      <li key={booking.id} data-booking={booking.id}>
                        <ScreenLink to="showroom" className="crm-sh-row mr-row">
                          <span className="crm-sh-row-main">
                            <span className="crm-sh-row-title">
                              {booking.contact ?? booking.visitor_name ?? ""}
                              {booking.company !== null && <span className="crm-sh-row-co">{booking.company}</span>}
                            </span>
                            <span className="crm-sh-row-sub">{sub}</span>
                          </span>
                          <span className="crm-sh-row-when crm-mono">
                            {day === 0 ? t("sh.desk.today", { time: f.time(at) }) : t("sh.desk.tomorrow", { time: f.time(at) })}
                            <span dir="ltr">{spanOf(booking, f)}</span>
                          </span>
                        </ScreenLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="crm-sh-queue mr-card" aria-labelledby="crm-sh-desk-late">
              <h2 id="crm-sh-desk-late">
                {t("sh.desk.late")}
                <span className="crm-chip-count crm-mono">{f.number(data.lateCount)}</span>
              </h2>
              {data.late.length === 0 ? (
                <p className="crm-sh-none">{t("sh.desk.late.none")}</p>
              ) : (
                <ul className="crm-sh-rows">
                  {data.late.map((loan) => {
                    const late = daysLate(loan, now, f);
                    return (
                      <li key={loan.id} data-loan={loan.id}>
                        <ScreenLink to="returns" className="crm-sh-row mr-row">
                          <span className="crm-sh-row-main">
                            <span className="crm-sh-row-title">
                              {loan.sample}
                              {loan.company !== null && <span className="crm-sh-row-co">{loan.company}</span>}
                            </span>
                            <span className="crm-sh-row-sub">{t("sh.desk.with", { who: loan.contact ?? loan.company ?? "", day: f.dayShort(new Date(`${loan.due_back}T12:00:00Z`)) })}</span>
                          </span>
                          <span className="crm-sh-row-when crm-mono" data-late="1">
                            {t("sh.lib.late", { count: f.number(late) }, late)}
                          </span>
                        </ScreenLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {inbox && open !== null && (
              <section className="crm-sh-queue mr-card" aria-labelledby="crm-sh-desk-inbox">
                <h2 id="crm-sh-desk-inbox">
                  {t("sh.desk.unclaimed")}
                  <span className="crm-chip-count crm-mono">{f.number(open.open)}</span>
                </h2>
                {open.rows.length === 0 ? (
                  <p className="crm-sh-none">{t("sh.desk.unclaimed.none")}</p>
                ) : (
                  <ul className="crm-sh-rows">
                    {open.rows.map((row: Enquiry) => (
                      <li key={row.id} data-enquiry={row.id}>
                        <ScreenLink to="inbox" className="crm-sh-row mr-row">
                          <span className="crm-sh-row-main">
                            <span className="crm-sh-row-title">
                              {row.wants ?? row.text ?? row.company_name}
                              <span className="crm-sh-row-co">{sourceLabel(row.source, t)}</span>
                            </span>
                            <span className="crm-sh-row-sub">{[row.person, row.company_name].filter((part) => part !== null && part !== "").join(" · ")}</span>
                          </span>
                          <span className="crm-sh-row-when crm-mono">{whenOf(row.received_at, now, f, t)}</span>
                        </ScreenLink>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}
