/**
 * THE OPERATIONS MANAGER'S HOME (the design's role home, D2 §5.4): the week
 * ahead, crew by crew; the visits with no day; the snags that stop a
 * sign-off; and the won deals that still need their job. Every figure is the
 * server's; a row opens the page it belongs to.
 *
 * Left out, said: the run-out certificates (a tile and a queue of the design)
 * and the "Training" button belong to Vehicles and crew, a later stage; and
 * the design's total pill, which would add several counts up (decision 90).
 */
import { useCallback } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays, noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { RouteKey } from "../../shell/routes.ts";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { crewPeople, dayHoursOf, dayKeyOf, readPlan, readSnagFigures, readSnags, readStillToMake, readToCome, truthy, weekColumns } from "./data.ts";
import { dayWords, hoursOf, mondayOf, Stat, useCrewFacts, useJobsScreen } from "./parts.tsx";

export function OpsHome(_props: ScreenProps) {
  const t = useT();
  const { session, f, now, today, tick } = useJobsScreen();
  const monday = addDays(mondayOf(today), 7);
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  const { load, reload } = useLoad(() => Promise.all([readPlan(session, today, monday), readToCome(session), readSnags(session), readStillToMake(session), readSnagFigures(session, today)]), [session, today, monday]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["job_visits", "snags", "jobs", ...(session.can("deals", "read") ? ["deals"] : [])], again);
  const me = session.config.user;
  const hour = f.hour(now);

  return (
    <div className="crm-screen crm-jb mr-screen" data-screen="ophome">
      <div className="crm-screen-head">
        <div>
          <h1>{t(hour < 12 ? "jb.home.morning" : hour < 18 ? "jb.home.afternoon" : "jb.home.evening", { name: firstName(me?.name ?? "") })}</h1>
          <div className="crm-now">
            <Icon name="calendar-days" size={15} />
            <span>{f.dayLong(now)}</span>
          </div>
        </div>
        <div className="crm-screen-actions">
          <ScreenLink to="deliveries" className="crm-btn crm-btn-primary crm-btn-40 mr-btn">
            <Icon name="truck" />
            {t("nav.item.deliveries")}
          </ScreenLink>
        </div>
      </div>
      <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={2} height={120} />}>
        {(crews) => (
          <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={110} />}>
            {([plan, visits, snags, still, snagFigures]) => {
              const week = t("jb.home.week", { day: dayWords(f, monday) });
              const inWeek = visits.filter((visit) => visit.state === "booked" && (dayKeyOf(visit.day) ?? "") >= monday && (dayKeyOf(visit.day) ?? "") <= addDays(monday, 6));
              const noDay = visits.filter((visit) => visit.state === "waiting");
              const stopping = snags.filter((snag) => snag.state !== "put-right" && truthy(snag.stops_sign_off));
              const days = weekColumns(monday, crews.workDays);
              return (
                <>
                  <div className="crm-kpis crm-jb-stats">
                    <Stat name="week" icon="truck" tone="info" label={t("jb.home.booked", { week })} value={f.number(plan.weekVisits)} sub={t("jb.home.booked.sub", { hours: hoursOf(f, plan.weekTotal), count: f.number(crews.crews.length) }, crews.crews.length)} />
                    <Stat name="noday" icon="calendar-x" tone="warn" label={t("jb.home.noDay")} value={f.number(plan.waiting)} sub={t(plan.waiting > 0 ? "jb.home.noDay.sub" : "jb.home.noDay.none")} />
                    <Stat name="stopping" icon="wrench" tone="danger" label={t("jb.home.stopping")} value={f.number(snagFigures.stopping)} sub={t(snagFigures.stopping > 0 ? "jb.home.stopping.sub" : "jb.home.stopping.none")} />
                    <Stat name="still" icon="hard-hat" tone={still.total > 0 ? "warn" : "pos"} label={t("jb.still.title")} value={f.number(still.total)} sub={t(still.total > 0 ? "jb.home.still.sub" : "jb.home.still.none")} />
                  </div>
                  <section className="crm-queue" aria-labelledby="crm-jb-home-h">
                    <div className="crm-queue-head">
                      <h2 id="crm-jb-home-h">{t("jb.home.queue")}</h2>
                    </div>
                    <Group label={t("jb.home.crews", { week })} count={crews.crews.length} empty={t("jb.home.crews.none")}>
                      {crews.crews.map((crew) => {
                        const mine = inWeek.filter((visit) => visit.crew_id === crew.id);
                        const of = dayHoursOf(crews, crew.id);
                        const workDays = days.filter((day) => crews.days.get(crew.id)?.has(dayOfWeek(day)) === true).length;
                        const over = Object.entries(plan.crewDays[String(crew.id)] ?? {}).filter(([day, hours]) => day >= monday && day <= addDays(monday, 6) && hours > of);
                        const booked = plan.weekByCrew[String(crew.id)] ?? 0;
                        const people = crewPeople(crews, crew.id).map((person) => firstName(person.name)).filter((name) => name !== "");
                        return (
                          <Row key={crew.id} to="deliveries" rest={[monday]} icon="users" title={crew.name} chip={people.join(", ")} tone={over.length > 0 ? "danger" : "info"} name={`crew-${String(crew.id)}`}
                            sub={[mine.length === 0 ? t("jb.home.crew.nothing") : mine.map((visit) => `${dayWords(f, dayKeyOf(visit.day)!)} · ${[visit.code, visit.site_name].filter((part) => part !== null).join(" ")} · ${t("jb.hours", { n: hoursOf(f, visit.hours) })}`).join("; "), ...over.map(([day, hours]) => t("jb.home.crew.over", { day: dayWords(f, day), hours: hoursOf(f, hours), of: hoursOf(f, of) }))].join(". ")}
                            due={t("jb.home.crew.of", { hours: hoursOf(f, booked), of: hoursOf(f, of * workDays) })}
                            value={t("jb.home.visits", { count: f.number(mine.length) }, mine.length)} />
                        );
                      })}
                    </Group>
                    <Group label={t("jb.home.noDay")} count={plan.waiting} empty={t("jb.home.noDay.none")}>
                      {noDay.map((visit) => {
                        const stock = dayKeyOf(visit.stock_ready_on);
                        return (
                          <Row key={visit.id} to="deliveries" icon="calendar-x" title={visit.what} chip={visit.site_name} tone="warn" name={`visit-${String(visit.id)}`}
                            sub={[visit.code, t("jb.hours", { n: hoursOf(f, visit.hours) }), t("jb.crewMembers", { count: f.number(visit.crew_size ?? 0) }, visit.crew_size ?? 0), stock !== null && stock > today ? t("jb.stock.lands", { day: dayWords(f, stock) }) : t("jb.stock.in")].filter((part) => part !== null).join(" · ")}
                            due={t("jb.home.noDayYet")} />
                        );
                      })}
                    </Group>
                    <Group label={t("jb.home.stopping.title")} count={snagFigures.stopping} empty={t("jb.home.stopping.none")}>
                      {stopping.map((snag) => {
                        const due = dayKeyOf(snag.due_on);
                        const late = due !== null && due < today;
                        return (
                          <Row key={snag.id} to="snags" icon="wrench" title={snag.text} chip={snag.site ?? ""} tone="danger" name={`snag-${String(snag.id)}`}
                            sub={[snag.code, dayKeyOf(snag.raised_on) === null ? null : t("jb.home.raised", { day: dayWords(f, dayKeyOf(snag.raised_on)!) })].filter((part) => part !== null).join(" · ")}
                            due={due === null ? "" : late ? t("jb.home.daysPast", { count: f.number(f.dayDiff(noonOf(due), noonOf(today))) }, f.dayDiff(noonOf(due), noonOf(today))) : t("jb.sg.due", { day: dayWords(f, due) })} late={late} />
                        );
                      })}
                    </Group>
                    {still.total > 0 && (
                      <Group label={t("jb.still.title")} count={still.total} empty="">
                        {still.deals.map((deal) => (
                          <Row key={deal.id} to="deliveries" icon="hard-hat" title={deal.name} chip="" tone="warn" name={`deal-${String(deal.id)}`} sub={deal.closed_on === null ? "" : t("jb.still.won", { day: f.date(noonOf(deal.closed_on.slice(0, 10))) })} due={t("jb.still.make")} />
                        ))}
                      </Group>
                    )}
                  </section>
                </>
              );
            }}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

const dayOfWeek = (day: string) => (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const)[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]!;

function Group({ label, count, empty, children }: { label: string; count: number; empty: string; children: React.ReactNode }) {
  const { f } = useJobsScreen();
  const items = Array.isArray(children) ? children : [children];
  return (
    <>
      <div className="crm-queue-group">
        <span className="crm-queue-group-label">{label}</span>
        <span className="crm-queue-group-count">{f.number(count)}</span>
      </div>
      <ul className="crm-queue-list crm-jb-home-list">
        {children}
        {items.flat().filter(Boolean).length === 0 && empty !== "" && <li className="crm-jb-home-empty">{empty}</li>}
      </ul>
    </>
  );
}

function Row({ to, rest = [], icon, title, chip, sub, due, value, tone, late = false, name }: { to: RouteKey; rest?: (string | number)[]; icon: string; title: string; chip: string; sub: string; due: string; value?: string; tone: "info" | "warn" | "danger"; late?: boolean; name: string }) {
  return (
    <li className="crm-jb-home-row" data-row={name}>
      <span className="crm-jb-tile" data-tone={tone} aria-hidden="true">
        <Icon name={icon} size={14} />
      </span>
      <div className="crm-jb-home-words">
        <div className="crm-jb-home-title">
          <ScreenLink to={to} rest={rest} className="crm-jb-home-link">
            {title}
          </ScreenLink>
          {chip !== "" && <span className="crm-pill">{chip}</span>}
        </div>
        {sub !== "" && <div className="crm-jb-quiet">{sub}</div>}
      </div>
      <div className="crm-jb-home-end">
        <span className="crm-mono" data-tone={late ? "danger" : undefined}>
          {due}
        </span>
        {value !== undefined && <span className="crm-jb-quiet">{value}</span>}
      </div>
    </li>
  );
}
