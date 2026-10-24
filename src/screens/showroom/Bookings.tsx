/**
 * SHOWROOM BOOKINGS (ledger screen 50): who is coming in, to which space,
 * and what is set out for them. The front desk's, the CRM admin's, and
 * Read-only's to read with nothing to press.
 *
 * The counts on the filters and each space's live bookings are the server's
 * (`data.ts`); this screen puts each booking under its day and names it by
 * its state. "Book a visitor", "Move" and "Cancel" open the booking dialog;
 * "Confirm it" and "They came in" are the booking's own buttons on the
 * server, pressed from the state the screen saw. Live to a colleague's change.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { useScreen } from "../team/data.ts";
import { readNames } from "../visits/data.ts";
import { BOOKING_FILTERS, cameIn, confirmBooking, inFilter, readShowroom, readWeek, spanOf, visitorOf, type Booking, type BookingFilter } from "./data.ts";
import { ShowDialog, type ShowBooking } from "./ShowDialog.tsx";
import { readRemovedUnder, RemovedPanel } from "../removed.tsx";

const STATE_TONE: Record<Booking["state"], "warn" | "pos" | "plain"> = { tentative: "warn", confirmed: "pos", done: "plain" };

export function Bookings(_props: ScreenProps) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, opens } = useScreen();
  // The server's clock, read once per look at the page.
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => readShowroom(session, now, f), [session, today, f]);
  const { load: weekLoad } = useLoad(() => readWeek(session), [session]);
  const { load: people } = useLoad(() => readNames(session), [session]);
  const names = people.state === "ready" ? people.data : {};
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["showroom_bookings", "display_pieces"], again);

  const canBook = session.can("showroom_bookings", "create");
  const canChange = session.can("showroom_bookings", "update");
  const canCancel = session.can("showroom_bookings", "delete") && canChange;
  const [filter, setFilter] = useState<BookingFilter>("coming");
  const [dialog, setDialog] = useState<ShowBooking | null>(null);
  const [pressing, setPressing] = useState<number | null>(null);

  const press = async (booking: Booking, what: "confirm" | "came"): Promise<void> => {
    setPressing(booking.id);
    const who = visitorOf(booking) || t("sh.visitor.new");
    await toasts.say(what === "confirm" ? confirmBooking(session, booking) : cameIn(session, booking), () =>
      what === "confirm" ? t("sh.toast.confirmed", { who, time: f.time(new Date(booking.starts_at)) }) : t("sh.toast.cameIn", { who }),
    );
    setPressing(null);
    again();
  };

  const week = weekLoad.state === "ready" ? weekLoad.data : null;
  const showsCompany = opens("companies");

  return (
    <div className="crm-screen crm-sh mr-screen" data-screen="showroom">
      <div className="crm-screen-head">
        <div>
          <h1>{t("sh.bookings.title")}</h1>
          <p className="crm-screen-sub">{t("sh.bookings.sub")}</p>
          <Loaded load={load} reload={reload} skeleton={<span />}>
            {(data) => (
              <div className="crm-sh-note crm-mono" data-testid="sh-note">
                {t("sh.bookings.note", { count: f.number(data.spaces.length) }, data.spaces.length)}
                {week !== null && ` · ${t("sh.bookings.open", { opens: week.opens, closes: week.closes })}`}
              </div>
            )}
          </Loaded>
        </div>
        {canBook && (
          <div className="crm-screen-actions">
            <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="sh-book" onClick={() => setDialog({ mode: "new" })} disabled={load.state !== "ready" || load.data.spaces.length === 0}>
              <Icon name="calendar-plus" />
              {t("sh.bookings.book")}
            </button>
          </div>
        )}
      </div>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={104} />}>
        {(data) => {
          const shown = data.bookings
            .filter((booking) => inFilter(booking, filter, now, f))
            .sort((a, b) => {
              const diff = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
              return filter === "done" ? -diff : diff;
            });
          const groups: { key: string; rows: Booking[] }[] = [];
          for (const booking of shown) {
            const key = f.dayKey(new Date(booking.starts_at));
            const last = groups[groups.length - 1];
            if (last !== undefined && last.key === key) last.rows.push(booking);
            else groups.push({ key, rows: [booking] });
          }
          return (
            <>
              <div className="crm-sh-spaces">
                {data.spaces.map((space, i) => (
                  <div key={space.id} className="crm-sh-space" data-space={space.id}>
                    <span className="crm-sh-dot" data-tint={i % 5} aria-hidden="true" />
                    <span className="crm-sh-space-name">{space.name}</span>
                    <span className="crm-sh-space-count crm-mono" aria-label={t("sh.space.live", { count: f.number(space.live), space: space.name }, space.live)}>
                      {f.number(space.live)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="crm-chips" role="group" aria-label={t("sh.filter")}>
                {BOOKING_FILTERS.map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                    {t(`sh.filter.${one}`)}
                    <span className="crm-chip-count crm-mono">{f.number(data.counts[one])}</span>
                  </button>
                ))}
              </div>

              <div className="crm-sh-days">
                {groups.map((group) => {
                  const days = f.dayDiff(now, noonOf(group.key));
                  const label = days === 0 ? t("sh.day.today") : days === 1 ? t("sh.day.tomorrow") : days === -1 ? t("sh.day.yesterday") : f.weekdayLong(noonOf(group.key));
                  const sub = days > 1 ? t("sh.day.in", { count: f.number(days) }, days) : days < -1 ? t("sh.day.ago", { count: f.number(-days) }, -days) : "";
                  return (
                    <section key={group.key} className="crm-sh-day" data-day={group.key}>
                      <div className="crm-sh-day-head">
                        <span>{label}</span>
                        <span className="crm-mono">{f.date(noonOf(group.key))}</span>
                        {sub !== "" && <span className="crm-mono">{sub}</span>}
                      </div>
                      <ul className="crm-sh-list">
                        {group.rows.map((booking) => {
                          const at = new Date(booking.starts_at);
                          const isLive = booking.state !== "done";
                          const setOut = data.setOut[booking.id] ?? [];
                          const rep = booking.rep_id === null ? "" : (names[booking.rep_id] ?? "");
                          const spaceAt = data.spaces.findIndex((space) => space.id === booking.space_id);
                          const name = booking.company ?? booking.contact ?? booking.visitor_name ?? "";
                          return (
                            <li key={booking.id} className="crm-sh-card mr-card" data-booking={booking.id} data-state={booking.state} data-tint={spaceAt % 5}>
                              <div className="crm-sh-card-top">
                                <div className="crm-sh-time">
                                  <span className="crm-mono">{f.time(at)}</span>
                                  <span className="crm-mono" dir="ltr">
                                    {spanOf(booking, f)}
                                  </span>
                                </div>
                                <span className="crm-avatar crm-sh-tile" aria-hidden="true">
                                  {initials(name)}
                                </span>
                                <div className="crm-sh-main">
                                  {booking.company !== null && booking.company_id !== null && showsCompany ? (
                                    <ScreenLink to="companies" rest={[booking.company_id]} className="crm-sh-name">
                                      {booking.company}
                                    </ScreenLink>
                                  ) : (
                                    <span className="crm-sh-name">{name}</span>
                                  )}
                                  <div className="crm-sh-who">{booking.contact_id === null ? (booking.company === null ? t("sh.visitor.new") : (booking.visitor_name ?? "")) : booking.contact}</div>
                                  {booking.note !== null && <p className="crm-sh-see">{booking.note}</p>}
                                  {setOut.length > 0 && (
                                    <div className="crm-sh-set" data-testid="sh-set">
                                      <Icon name="armchair" size={13} />
                                      <span>{t("sh.setOut", { pieces: setOut.join(", ") })}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="crm-sh-side">
                                  <span className="crm-pill crm-sh-space-pill" data-tint={spaceAt % 5}>
                                    {booking.space}
                                  </span>
                                  <span className="crm-pill" data-tone={STATE_TONE[booking.state]} data-testid="sh-state">
                                    {t(`sh.state.${booking.state}`)}
                                  </span>
                                  <span className="crm-sh-party crm-mono">{t("sh.party", { count: f.number(Number(booking.party)) }, Number(booking.party))}</span>
                                  {rep !== "" && (
                                    <span className="crm-sh-rep">
                                      <span className="crm-avatar crm-avatar-sm" data-tone="accent" aria-hidden="true">
                                        {initials(rep)}
                                      </span>
                                      {firstName(rep)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {isLive && (canChange || canCancel) && (
                                <div className="crm-sh-actions">
                                  {booking.state === "tentative" && canChange && (
                                    <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="confirm" disabled={pressing === booking.id} onClick={() => void press(booking, "confirm")}>
                                      <Icon name="check" size={14} />
                                      {t("sh.act.confirm")}
                                    </button>
                                  )}
                                  {canChange && f.dayDiff(now, at) <= 0 && (
                                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="came" disabled={pressing === booking.id} onClick={() => void press(booking, "came")}>
                                      <Icon name="store" size={14} />
                                      {t("sh.act.came")}
                                    </button>
                                  )}
                                  {canChange && (
                                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="move" aria-label={t("sh.act.move.aria", { who: name, day: f.dayShort(at) })} onClick={() => setDialog({ mode: "move", booking })}>
                                      <Icon name="calendar-sync" size={14} />
                                      {t("sh.act.move")}
                                    </button>
                                  )}
                                  {canCancel && (
                                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="cancel" aria-label={t("sh.act.cancel.aria", { who: name, day: f.dayShort(at) })} onClick={() => setDialog({ mode: "cancel", booking })}>
                                      <Icon name="calendar-x" size={14} />
                                      {t("sh.act.cancel")}
                                    </button>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>

              {shown.length === 0 && (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="store" size={21} />
                  </span>
                  <div className="crm-empty-title">{t(data.counts.all === 0 ? "sh.empty.none" : "sh.empty")}</div>
                  <p>{t(data.counts.all === 0 ? (canBook ? "sh.empty.none.body" : "sh.empty.none.read") : "sh.empty.body")}</p>
                </div>
              )}

              <RemovedPanel<{ visitor_name?: string | null; starts_at?: string | null; party?: number | null }>
                title={t("rm.bookings.title")}
                testId="sh-removed"
                f={f}
                // A cancelled booking is read through its space, by whoever reads the space now (plan 68 S16).
                read={() => readRemovedUnder(session, data.spaces.map((space) => ({ ref: "showroom_spaces", id: space.id, label: space.name })), "showroom_bookings")}
                what={(item) => {
                  const at = item.row.starts_at === null || item.row.starts_at === undefined ? null : new Date(item.row.starts_at);
                  const who = item.row.visitor_name ?? "";
                  return { title: who === "" ? item.parent.label : who, detail: at === null ? item.parent.label : t("rm.list.for", { what: item.parent.label, when: `${f.dayShort(at)}, ${f.time(at)}` }) };
                }}
              />
              {dialog !== null && <ShowDialog booking={dialog} spaces={data.spaces} names={names} onClose={() => setDialog(null)} onDone={again} />}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
