/**
 * SITE VISITS (ledger screen 39): what is booked, and what still needs
 * writing up. A rep's own; the whole team's for who reads the team.
 *
 * The four counts on the filters are the server's (see `data.ts`). This
 * screen puts each visit under its day, the ones still to come first, and
 * names it "today", "booked", "written up" or "no notes yet" by the server's
 * clock.
 *
 * Addresses: `visits` is the list; `visits/book/<deal>` opens the booking
 * dialog on that deal (a deal's page links here); `visits/notes` and
 * `visits/notes/<visit>` are the write-up (`VisitNotes.tsx`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, noonOf } from "../../lib/format.ts";
import { scopeOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { BookingDialog, type Booking } from "./BookingDialog.tsx";
import { readNames, readVisits, toneOf, type Filter, type Tone, type Visit } from "./data.ts";
import { VisitNotes } from "./VisitNotes.tsx";

const FILTERS: readonly Filter[] = ["all", "soon", "done", "unwritten"];
const PILL: Record<Tone, "accent" | "info" | "pos" | "danger"> = { today: "accent", soon: "info", done: "pos", unwritten: "danger" };

export function Visits({ rest }: ScreenProps) {
  if (rest[0] === "notes") return <VisitNotes id={rest[1] === undefined || !/^\d+$/.test(rest[1]) ? null : Number(rest[1])} />;
  return <VisitList book={rest[0] === "book" && rest[1] !== undefined && /^\d+$/.test(rest[1]) ? Number(rest[1]) : null} />;
}

function VisitList({ book }: { book: number | null }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const nav = useNav();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const mine = scopeOf(session) === "mine";
  const me = config.user?.id ?? "";
  // The server's clock, read once per look at the page.
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => readVisits(session, mine, now, f), [session, mine, today, f]);
  // Who is who: read once, not with every look at the list.
  const { load: people } = useLoad(() => readNames(session), [session]);
  const names = people.state === "ready" ? people.data : {};
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["site_visits", "visit_notes"], again);

  const canBook = session.can("site_visits", "create") && session.can("deals", "read");
  const canMove = session.can("site_visits", "update");
  const canCancel = session.can("site_visits", "delete");
  const [filter, setFilter] = useState<Filter>("all");
  const [booking, setBooking] = useState<Booking | null>(null);
  // A deal's page sends the person here to book on that deal: the dialog opens once, and the address goes back to the list.
  useEffect(() => {
    if (book === null || !canBook) return;
    setBooking({ mode: "new", dealId: book });
    nav.replace("visits");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the address the page was opened at
  }, [book]);

  return (
    <div className="crm-screen crm-visits mr-screen" data-screen="visits">
      <div className="crm-screen-head">
        <div>
          <h1>{t(mine ? "visits.title.mine" : "visits.title.team")}</h1>
          <p className="crm-screen-sub">{t(mine ? "visits.sub.mine" : "visits.sub.team")}</p>
        </div>
        <Loaded load={load} reload={reload} skeleton={<span />}>
          {(data) => {
            const next = data.visits.find((visit) => new Date(visit.starts_at).getTime() >= now.getTime()) ?? null;
            const at = next === null ? null : new Date(next.starts_at);
            return (
              <div className="crm-screen-actions">
                <span className="crm-visit-next" data-testid="visit-next">
                  <Icon name="map-pin" size={14} />
                  {next === null || at === null
                    ? t("visits.next.none")
                    : t(f.dayDiff(now, at) === 0 ? "visits.next.today" : "visits.next.day", { day: f.weekdayLong(at), time: f.time(at), company: next.company ?? "" })}
                </span>
                {canBook && (
                  <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="visit-book" onClick={() => setBooking({ mode: "new" })}>
                    <Icon name="calendar-plus" />
                    {t("visits.book")}
                  </button>
                )}
              </div>
            );
          }}
        </Loaded>
      </div>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={104} />}>
        {(data) => {
          const shown = data.visits.filter((visit) => {
            const tone = toneOf(visit, now, f);
            return filter === "all" || (filter === "soon" ? tone === "today" || tone === "soon" : filter === tone);
          });
          // Still to come first, soonest first; then what has been, newest first.
          const order = [...shown].sort((a, b) => {
            const pa = f.dayDiff(now, new Date(a.starts_at)) < 0;
            const pb = f.dayDiff(now, new Date(b.starts_at)) < 0;
            if (pa !== pb) return pa ? 1 : -1;
            const diff = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
            return pa ? -diff : diff;
          });
          const groups: { key: string; rows: Visit[] }[] = [];
          for (const visit of order) {
            const key = f.dayKey(new Date(visit.starts_at));
            const last = groups[groups.length - 1];
            if (last !== undefined && last.key === key) last.rows.push(visit);
            else groups.push({ key, rows: [visit] });
          }
          return (
            <>
              {data.counts.unwritten > 0 && (
                <div className="crm-banner" data-tone="danger" data-testid="visit-missing">
                  <Icon name="notebook-pen" size={16} />
                  <span>{t("visits.missing", { count: f.number(data.counts.unwritten) }, data.counts.unwritten)}</span>
                  <ScreenLink to="visits" rest={["notes"]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                    {t(session.can("visit_notes", "create") ? "visits.missing.write" : "visits.missing.read")}
                  </ScreenLink>
                </div>
              )}

              <div className="crm-chips" role="group" aria-label={t("visits.filter")}>
                {FILTERS.map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                    {t(`visits.filter.${one}`)}
                    <span className="crm-chip-count crm-mono">{f.number(data.counts[one])}</span>
                  </button>
                ))}
              </div>

              <div className="crm-visit-days">
                {groups.map((group) => {
                  const days = f.dayDiff(now, noonOf(group.key));
                  const label = days === 0 ? t("visits.day.today") : days === 1 ? t("visits.day.tomorrow") : days === -1 ? t("visits.day.yesterday") : f.weekdayLong(noonOf(group.key));
                  return (
                    <section key={group.key} className="crm-visit-day" data-past={days < 0 ? "1" : "0"} data-day={group.key}>
                      <div className="crm-visit-day-head">
                        <span>{label}</span>
                        <span className="crm-mono">{f.date(noonOf(group.key))}</span>
                      </div>
                      <ul className="crm-visit-list">
                        {group.rows.map((visit) => {
                          const tone = toneOf(visit, now, f);
                          const at = new Date(visit.starts_at);
                          const past = at.getTime() < now.getTime();
                          const repName = names[visit.rep_id] ?? "";
                          // Hers to change (a manager's, when it is one of her people's: the server says which).
                          const change = (tone === "today" || tone === "soon") && visit.state === "booked" && (!mine || visit.rep_id === me);
                          return (
                            <li key={visit.id} className="crm-visit mr-card" data-tone={tone} data-visit={visit.id}>
                              <div className="crm-visit-time">
                                <span className="crm-mono">{f.time(at)}</span>
                                <span>{t("visits.minutes", { count: f.number(Number(visit.minutes)) })}</span>
                              </div>
                              <div className="crm-visit-main">
                                <div className="crm-visit-top">
                                  <span className="crm-visit-purpose">{visit.purpose}</span>
                                  <span className="crm-pill" data-tone={PILL[tone]}>
                                    {t(`visits.tone.${tone}`)}
                                  </span>
                                </div>
                                <div className="crm-visit-meta">
                                  <span className="crm-visit-co">
                                    <Icon name="building-2" size={14} />
                                    {visit.company}
                                  </span>
                                  {visit.town !== null && visit.town !== "" && <span className="crm-visit-town">{visit.town}</span>}
                                  <span className="crm-visit-rule" aria-hidden="true" />
                                  <span className="crm-visit-who">
                                    <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                                      {visit.contact === null ? "?" : initials(visit.contact)}
                                    </span>
                                    {visit.contact ?? t("visits.nobody")}
                                  </span>
                                  {repName !== "" && (
                                    <span className="crm-visit-who" data-rep>
                                      <span className="crm-avatar crm-avatar-sm" data-tone="accent" aria-hidden="true">
                                        {initials(repName)}
                                      </span>
                                      {firstName(repName)}
                                    </span>
                                  )}
                                </div>
                                {visit.note !== null && visit.note !== "" && <p className="crm-visit-note">{visit.note}</p>}
                                <div className="crm-visit-foot">
                                  {visit.deal !== null && (
                                    <span className="crm-visit-deal">
                                      <span>{visit.deal}</span>
                                      {visit.amount !== null && <span className="crm-mono">{f.money(visit.amount)}</span>}
                                    </span>
                                  )}
                                  {past && session.can("visit_notes", "read") && (
                                    <ScreenLink to="visits" rest={["notes", visit.id]} className={`crm-btn crm-btn-32 ${tone === "unwritten" && session.can("visit_notes", "create") ? "crm-btn-danger mr-btn" : "crm-btn-ghost mr-gi"}`}>
                                      <Icon name="notebook-pen" size={14} />
                                      {t(tone === "done" || !session.can("visit_notes", "create") ? "visits.notes.read" : "visits.notes.write")}
                                    </ScreenLink>
                                  )}
                                  {change && canMove && (
                                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" aria-label={t("visits.move.aria", { company: visit.company ?? "", day: f.dayShort(at) })} data-act="move" onClick={() => setBooking({ mode: "move", visit })}>
                                      <Icon name="calendar-sync" size={14} />
                                      {t("visits.move")}
                                    </button>
                                  )}
                                  {change && canCancel && (
                                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" aria-label={t("visits.cancel.aria", { company: visit.company ?? "", day: f.dayShort(at) })} data-act="cancel" onClick={() => setBooking({ mode: "cancel", visit })}>
                                      <Icon name="calendar-x" size={14} />
                                      {t("visits.cancel")}
                                    </button>
                                  )}
                                </div>
                              </div>
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
                    <Icon name="map-pin" size={21} />
                  </span>
                  <div className="crm-empty-title">{t(data.counts.all === 0 ? "visits.empty.none" : "visits.empty")}</div>
                  <p>{t(data.counts.all === 0 ? (canBook ? "visits.empty.none.body" : "visits.empty.none.read") : "visits.empty.body")}</p>
                </div>
              )}

              {booking !== null && <BookingDialog booking={booking} names={names} onClose={() => setBooking(null)} onDone={again} />}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
