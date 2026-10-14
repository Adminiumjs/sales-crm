/**
 * DELIVERIES (ledger screen 33): the visits still to come on won jobs, a week
 * at a time, and the ones that wait for a day. Book one from the list, drag it
 * onto a day, move it, call it off, or add a visit to a job. Won deals with no
 * job yet ("jobs still to make", P15) are listed above, to be made with one
 * press.
 *
 * Reached from the operations manager's and the CRM admin's menus (Jobs on
 * site), and Read-only's, who reads it and presses nothing. Every count and
 * hour is the server's (`readPlan`); a day's column is the working days of the
 * week (Settings → Working time), its capacity the crews' days that work it.
 *
 * Addresses: `deliveries` opens on the week after this one (the week the
 * office is booking); `deliveries/<monday>` on that week.
 */
import { useCallback, useMemo, useState, type DragEvent } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays, noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { dayOfKey } from "../appsettings/data.ts";
import {
  checkBooking,
  crewPeople,
  dayHoursOf,
  dayKeyOf,
  makeJob,
  moveVisit,
  num,
  ofDay,
  overDays,
  readJobs,
  readPlan,
  readStillToMake,
  readToCome,
  startOf,
  weekColumns,
  type CrewFacts,
  type Plan,
  type Refusal,
  type Visit,
  type WonDeal,
} from "./data.ts";
import { dayLong, dayWords, hoursOf, mondayOf, useCrewFacts, useJobsScreen, WeekBar } from "./parts.tsx";
import { VisitDialog, type VisitBooking } from "./VisitDialog.tsx";

const DRAG = "application/x-crm-job-visit";

export function Deliveries({ rest }: ScreenProps) {
  const t = useT();
  const nav = useNav();
  const toasts = useToasts();
  const { session, f, today, tick } = useJobsScreen();
  const asked = rest[0] !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(rest[0]) ? mondayOf(rest[0]) : null;
  const monday = asked ?? addDays(mondayOf(today), 7);
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  const { load, reload } = useLoad(() => Promise.all([readToCome(session), readPlan(session, today, monday), readStillToMake(session), readJobs(session)]), [session, today, monday]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  const crewsAgain = useCoalesced(reloadFacts);
  useLive(["job_visits", "jobs", ...(session.can("deals", "read") ? ["deals"] : [])], again);
  useLive(["crews", "crew_members", "crew_days", "settings"], crewsAgain);

  const canBook = session.can("job_visits", "update");
  const canAdd = session.can("job_visits", "create") && session.can("jobs", "read");
  const canCancel = session.can("job_visits", "delete") && canBook;
  const canMake = session.can("jobs", "create") && session.can("deals", "read");
  const [booking, setBooking] = useState<VisitBooking | null>(null);
  const [making, setMaking] = useState<number | null>(null);
  const [bounce, setBounce] = useState<{ day: string; text: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const keys = useMemo(() => new Map<number, string>(), []);

  const make = async (deal: WonDeal): Promise<void> => {
    if (making !== null) return;
    setMaking(deal.id);
    // One key a deal, for as long as the page is open: a press sent again after a lost reply makes one job.
    if (!keys.has(deal.id)) keys.set(deal.id, newClientKey());
    await toasts.say(makeJob(session, deal, keys.get(deal.id)!), () => t("jb.make.done", { deal: deal.name }));
    setMaking(null);
    again();
  };

  return (
    <div className="crm-screen crm-jb mr-screen" data-screen="deliveries">
      <div className="crm-screen-head">
        <div>
          <h1>{t("jb.dv.title")}</h1>
          <p className="crm-screen-sub crm-jb-lead">{t(canBook ? "jb.dv.sub" : "jb.dv.sub.read")}</p>
        </div>
        <Loaded load={load} reload={reload} skeleton={<span />}>
          {([, plan]) => (
            <div className="crm-screen-actions">
              <span className="crm-pill" data-tone="info" data-figure="booked">
                <Icon name="truck" size={14} />
                {t("jb.dv.booked", { count: f.number(plan.booked) }, plan.booked)}
              </span>
              <span className="crm-pill" data-tone={plan.waiting > 0 ? "warn" : "pos"} data-figure="waiting">
                {t("jb.dv.toBook", { count: f.number(plan.waiting) }, plan.waiting)}
              </span>
              {canAdd && (
                <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" data-testid="jb-add" onClick={() => setBooking({ mode: "add" })}>
                  <Icon name="plus" />
                  {t("jb.dv.add")}
                </button>
              )}
            </div>
          )}
        </Loaded>
      </div>

      <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={3} height={140} />}>
        {(crews) => (
          <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={140} />}>
            {([visits, plan, still, jobs]) => (
              <>
                {still.total > 0 && <StillToMake deals={still.deals} total={still.total} canMake={canMake} making={making} onMake={(deal) => void make(deal)} />}
                <div className="crm-jb-dv">
                  <div className="crm-jb-dv-main">
                    <WeekBar monday={monday} today={today} f={f} onWeek={(next) => nav.replace("deliveries", next)}>
                      <span className="crm-jb-weeknote" data-testid="jb-weeknote">
                        {weekNote(t, f, plan, crews)}
                      </span>
                    </WeekBar>
                    <Alerts visits={visits} plan={plan} crews={crews} today={today} />
                    <Week
                      monday={monday}
                      today={today}
                      visits={visits}
                      plan={plan}
                      crews={crews}
                      canBook={canBook}
                      canCancel={canCancel}
                      bounce={bounce}
                      over={over}
                      onOver={setOver}
                      onBook={setBooking}
                      onDrop={async (visit, day) => {
                        setOver(null);
                        // A visit that waits has no crew yet: the dialog opens with the day filled, and asks (B11).
                        if (visit.state === "waiting") return setBooking({ mode: "book", visit, day });
                        if (dayKeyOf(visit.day) === day) return;
                        const own = visit.crew_id === null ? 0 : (plan.crewDays[String(visit.crew_id)]?.[day] ?? 0);
                        const check = checkBooking({ day, today, stock: dayKeyOf(visit.stock_ready_on), crewId: visit.crew_id, hours: num(visit.hours), otherHours: own, crewDays: visit.crew_id === null ? undefined : crews.days.get(visit.crew_id), dayHours: dayHoursOf(crews, visit.crew_id) });
                        if (check.refusal !== null) {
                          // Nothing is written: the card stays where it was, and the day says why.
                          const text = t("jb.dv.refused", { reason: refusalText(t, f, check.refusal, visit, day, crews) });
                          setBounce({ day, text });
                          toasts.show(text, "danger");
                          setTimeout(() => setBounce((was) => (was?.day === day ? null : was)), 3600);
                          return;
                        }
                        const crew = crews.crews.find((one) => one.id === visit.crew_id)?.name ?? "";
                        const saved = await toasts.say(
                          moveVisit(session, visit, { day, start: startOf(visit.start_time) ?? "08:00", crewId: visit.crew_id ?? 0, hours: num(visit.hours), size: visit.crew_size ?? 1, note: visit.note ?? "" }),
                          () => `${t("jb.toast.moved", { site: visit.site_name, day: dayWords(f, day), crew })}${check.over === null ? "" : ` ${t("jb.bk.over", { crew, hours: hoursOf(f, check.over.hours), of: hoursOf(f, check.over.of), day: dayWords(f, day) })}`}`,
                        );
                        if (saved !== null) again();
                      }}
                    />
                  </div>
                  <ToBook visits={visits.filter((visit) => visit.state === "waiting")} today={today} crews={crews} canBook={canBook} canCancel={canCancel} onBook={setBooking} />
                </div>
                {booking !== null && <VisitDialog booking={booking} session={session} f={f} facts={crews} plan={plan} jobs={jobs} today={today} onClose={() => setBooking(null)} onDone={again} />}
              </>
            )}
          </Loaded>
        )}
      </Loaded>
    </div>
  );

  function weekNote(tt: typeof t, ff: typeof f, plan: Plan, crews: CrewFacts): string {
    const hours = new Set(crews.crews.map((crew) => dayHoursOf(crews, crew.id)));
    const each = hours.size === 1 ? tt("jb.dv.note.each", { count: crews.crews.length, hours: hoursOf(ff, [...hours][0]) }, crews.crews.length) : tt("jb.dv.note.crews", { count: ff.number(crews.crews.length) }, crews.crews.length);
    return [
      tt("jb.dv.note.toCome", { count: ff.number(plan.toCome) }, plan.toCome),
      tt("jb.dv.note.hours", { hours: hoursOf(ff, plan.hours) }),
      tt("jb.dv.note.week", { count: ff.number(plan.weekVisits) }, plan.weekVisits),
      each,
    ].join(" · ");
  }
}

function refusalText(t: ReturnType<typeof useT>, f: Parameters<typeof dayWords>[0], refusal: Refusal, visit: Visit, day: string, crews: CrewFacts): string {
  if (refusal.kind === "gone") return t("jb.bk.refused.gone", { day: dayWords(f, day) });
  if (refusal.kind === "stock") return t("jb.bk.refused.stock", { job: visit.code ?? "", ready: dayWords(f, refusal.ready) });
  if (refusal.kind === "closed") return t("jb.bk.refused.closed", { crew: crews.crews.find((one) => one.id === visit.crew_id)?.name ?? "", day: dayWords(f, day) });
  return t("jb.bk.refused.nocrew");
}

/** Won deals that have no job: made by the operations manager or the CRM admin, one press each (P15). */
function StillToMake({ deals, total, canMake, making, onMake }: { deals: WonDeal[]; total: number; canMake: boolean; making: number | null; onMake: (deal: WonDeal) => void }) {
  const t = useT();
  const { f } = useJobsScreen();
  return (
    <section className="crm-jb-still" data-testid="jb-still" aria-labelledby="crm-jb-still-h">
      <div className="crm-jb-still-head">
        <Icon name="hard-hat" size={16} />
        <h2 id="crm-jb-still-h">{t("jb.still.title")}</h2>
        <span className="crm-pill" data-tone="warn" data-figure="still">
          {f.number(total)}
        </span>
      </div>
      <p className="crm-jb-still-sub">{t("jb.still.sub")}</p>
      <ul className="crm-jb-still-list">
        {deals.map((deal) => (
          <li key={deal.id} data-deal={deal.id}>
            <span className="crm-jb-still-name">{deal.name}</span>
            {deal.closed_on !== null && <span className="crm-mono crm-jb-quiet">{t("jb.still.won", { day: f.date(noonOf(deal.closed_on.slice(0, 10))) })}</span>}
            {canMake && (
              <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" disabled={making !== null} aria-label={t("jb.still.make.aria", { deal: deal.name })} onClick={() => onMake(deal)}>
                <Icon name="plus" size={14} />
                {making === deal.id ? t("ui.saving") : t("jb.still.make")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The lines above the week: a crew over its day, a visit waiting for its stock. Every visit still to come, whatever week is shown. */
function Alerts({ visits, plan, crews, today }: { visits: Visit[]; plan: Plan; crews: CrewFacts; today: string }) {
  const t = useT();
  const { f } = useJobsScreen();
  const lines: { key: string; icon: string; text: string }[] = [];
  for (const one of overDays(plan.crewDays, (crewId) => dayHoursOf(crews, crewId))) {
    const crew = crews.crews.find((c) => c.id === one.crewId)?.name ?? "";
    lines.push({ key: `over-${one.crewId}-${one.day}`, icon: "clock-alert", text: `${t("jb.bk.over", { crew, hours: hoursOf(f, one.hours), of: hoursOf(f, one.of), day: dayWords(f, one.day) })} ${t("jb.dv.flagged")}` });
  }
  for (const visit of visits) {
    const stock = dayKeyOf(visit.stock_ready_on);
    if (visit.state !== "waiting" || stock === null || stock <= today) continue;
    lines.push({ key: `stock-${visit.id}`, icon: "package", text: t("jb.dv.waitsStock", { job: visit.code ?? "", site: visit.site_name, day: dayWords(f, stock) }) });
  }
  if (lines.length === 0) return null;
  return (
    <ul className="crm-jb-alerts" data-testid="jb-alerts">
      {lines.map((line) => (
        <li key={line.key} data-alert={line.key}>
          <Icon name={line.icon} size={15} />
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Week({
  monday,
  today,
  visits,
  plan,
  crews,
  canBook,
  canCancel,
  bounce,
  over,
  onOver,
  onBook,
  onDrop,
}: {
  monday: string;
  today: string;
  visits: Visit[];
  plan: Plan;
  crews: CrewFacts;
  canBook: boolean;
  canCancel: boolean;
  bounce: { day: string; text: string } | null;
  over: string | null;
  onOver: (day: string | null) => void;
  onBook: (booking: VisitBooking) => void;
  onDrop: (visit: Visit, day: string) => void;
}) {
  const t = useT();
  const { f } = useJobsScreen();
  const days = weekColumns(monday, crews.workDays);
  const byId = new Map(visits.map((visit) => [visit.id, visit]));
  const drop = (day: string) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData(DRAG));
    const visit = byId.get(id);
    if (visit !== undefined) onDrop(visit, day);
  };
  return (
    <div className="crm-jb-week mr-board" data-testid="jb-week-days">
      {days.map((day) => {
        const booked = ofDay(visits.filter((visit) => visit.state === "booked"), day);
        // What the crews that work this weekday may do in a day, together: the day's capacity.
        const capacity = crews.crews.filter((crew) => crews.days.get(crew.id)?.has(dayOfKey(day)) === true).reduce((sum, crew) => sum + dayHoursOf(crews, crew.id), 0);
        const hours = plan.weekHours[day] ?? 0;
        const crewOver = crews.crews.some((crew) => (plan.crewDays[String(crew.id)]?.[day] ?? 0) > dayHoursOf(crews, crew.id));
        const gone = day < today;
        return (
          <section
            key={day}
            className="crm-jb-day"
            data-day={day}
            data-over={over === day ? "1" : undefined}
            data-bounce={bounce?.day === day ? "1" : undefined}
            aria-label={dayLong(f, day)}
            onDragOver={(event) => {
              if (!canBook || !event.dataTransfer.types.includes(DRAG)) return;
              event.preventDefault();
              if (over !== day) onOver(day);
            }}
            onDragLeave={() => onOver(null)}
            onDrop={drop(day)}
          >
            <div className="crm-jb-day-head">
              <span className="crm-jb-day-name">{f.weekdayShort(noonOf(day))}</span>
              <span className="crm-mono crm-jb-quiet">{f.date(noonOf(day))}</span>
            </div>
            <div className="crm-jb-load" aria-label={t("jb.dv.load", { hours: hoursOf(f, hours), of: hoursOf(f, capacity) })} data-figure="day-hours" data-hours={hours}>
              <span className="crm-jb-load-track">
                <span className="crm-jb-load-bar" data-tone={crewOver ? "warn" : undefined} style={{ inlineSize: `${capacity <= 0 ? 0 : Math.min(100, Math.round((hours / capacity) * 100))}%` }} />
              </span>
              <span className="crm-mono" data-tone={crewOver ? "warn" : undefined}>
                {t("jb.hours", { n: hoursOf(f, hours) })}
              </span>
            </div>
            {bounce?.day === day && (
              <div className="crm-jb-bounce" role="alert">
                {bounce.text}
              </div>
            )}
            <div className="crm-jb-day-cards">
              {booked.map((visit) => (
                <VisitCard key={visit.id} visit={visit} crews={crews} canBook={canBook} canCancel={canCancel} onBook={onBook} />
              ))}
              {booked.length === 0 && <div className="crm-jb-day-empty">{over === day ? t("jb.dv.dropHere") : gone ? t("jb.dv.gone") : t("jb.dv.nothing")}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function VisitCard({ visit, crews, canBook, canCancel, onBook }: { visit: Visit; crews: CrewFacts; canBook: boolean; canCancel: boolean; onBook: (booking: VisitBooking) => void }) {
  const t = useT();
  const { f } = useJobsScreen();
  const crewIndex = crews.crews.findIndex((crew) => crew.id === visit.crew_id);
  const crew = crews.crews[crewIndex];
  const day = dayKeyOf(visit.day) ?? "";
  return (
    <article
      className="crm-jb-card mr-card"
      data-visit={visit.id}
      draggable={canBook}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG, String(visit.id));
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="crm-jb-card-top">
        <span className="crm-jb-dot" data-colour={crewIndex < 0 ? undefined : crewIndex % 8} aria-hidden="true" />
        <div className="crm-jb-card-words">
          <div className="crm-jb-card-site">{visit.site_name}</div>
          <div className="crm-jb-card-what">{[visit.code, visit.what].filter((part) => part !== null && part !== "").join(" · ")}</div>
        </div>
      </div>
      <div className="crm-jb-card-meta">
        <span className="crm-pill">{crew === undefined ? t("jb.dv.noCrew") : t("jb.dv.crewSize", { crew: crew.name, count: f.number(visit.crew_size ?? 0) }, visit.crew_size ?? 0)}</span>
        <span className="crm-mono crm-jb-quiet">
          {startOf(visit.start_time) !== null && <span dir="ltr">{startOf(visit.start_time)}</span>} · {t("jb.hours", { n: hoursOf(f, visit.hours) })}
        </span>
      </div>
      {(canBook || canCancel) && (
        <div className="crm-jb-card-acts">
          {canBook && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" data-act="move" aria-label={t("jb.dv.move.aria", { site: visit.site_name, day: dayWords(f, day) })} onClick={() => onBook({ mode: "move", visit })}>
              <Icon name="calendar-sync" size={12} />
              {t("jb.dv.move")}
            </button>
          )}
          {canCancel && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" data-act="cancel" aria-label={t("jb.dv.cancel.aria", { site: visit.site_name, day: dayWords(f, day) })} onClick={() => onBook({ mode: "cancel", visit })}>
              <Icon name="calendar-x" size={12} />
              {t("jb.dv.cancel")}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** The visits that wait for a day: booked from here, or dragged onto a day. */
function ToBook({ visits, today, crews, canBook, canCancel, onBook }: { visits: Visit[]; today: string; crews: CrewFacts; canBook: boolean; canCancel: boolean; onBook: (booking: VisitBooking) => void }) {
  const t = useT();
  const { f } = useJobsScreen();
  return (
    <section className="crm-jb-tobook" aria-labelledby="crm-jb-tobook-h" data-testid="jb-tobook">
      <div className="crm-jb-tobook-head">
        <h2 id="crm-jb-tobook-h">{t("jb.dv.toBook.title")}</h2>
        <span className="crm-pill" data-tone={visits.length > 0 ? "warn" : "pos"}>
          {f.number(visits.length)}
        </span>
        <span className="crm-jb-quiet">{t("jb.dv.toBook.sub")}</span>
      </div>
      <ul className="crm-jb-tobook-list mr-scroll">
        {visits.map((visit) => {
          const stock = dayKeyOf(visit.stock_ready_on);
          const waits = stock !== null && stock > today;
          // People enough in some crew for this visit, as a hint: the dialog asks which.
          const people = crews.crews.map((crew) => crewPeople(crews, crew.id).length);
          const enough = people.some((n) => n >= (visit.crew_size ?? 1));
          return (
            <li
              key={visit.id}
              className="crm-jb-tobook-row"
              data-visit={visit.id}
              draggable={canBook}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG, String(visit.id));
                event.dataTransfer.effectAllowed = "move";
              }}
            >
              <span className="crm-jb-tile" data-tone={waits ? "warn" : "pos"} aria-hidden="true">
                <Icon name={waits ? "package" : "truck"} size={14} />
              </span>
              <div className="crm-jb-tobook-words">
                <div className="crm-jb-card-site">{visit.site_name}</div>
                <div className="crm-jb-card-what">{[visit.code, visit.what].filter((part) => part !== null && part !== "").join(" · ")}</div>
                <div className="crm-jb-card-meta">
                  <span className="crm-pill" data-tone={waits ? "warn" : "pos"}>
                    {waits ? t("jb.stock.lands", { day: dayWords(f, stock) }) : t("jb.stock.in")}
                  </span>
                  <span className="crm-mono crm-jb-quiet">
                    {t("jb.hours", { n: hoursOf(f, visit.hours) })} · {t("jb.crewMembers", { count: f.number(visit.crew_size ?? 0) }, visit.crew_size ?? 0)}
                  </span>
                  {!enough && <span className="crm-pill" data-tone="warn">{t("jb.dv.noCrewBigEnough")}</span>}
                </div>
              </div>
              <div className="crm-jb-tobook-acts">
                {canBook && (
                  <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="book" aria-label={t("jb.dv.book.aria", { site: visit.site_name, what: visit.what })} onClick={() => onBook({ mode: "book", visit })}>
                    <Icon name="calendar-plus" size={13} />
                    {t("jb.dv.book")}
                  </button>
                )}
                {canCancel && (
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="cancel" aria-label={t("jb.dv.remove.aria", { site: visit.site_name, what: visit.what })} onClick={() => onBook({ mode: "cancel", visit })}>
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {visits.length === 0 && (
        <div className="crm-empty">
          <span className="crm-empty-icon">
            <Icon name="check-check" size={20} />
          </span>
          <div className="crm-empty-title">{t("jb.dv.toBook.none")}</div>
          <p>{t("jb.dv.toBook.none.body")}</p>
        </div>
      )}
    </section>
  );
}

