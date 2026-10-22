/**
 * MY DAY, the field crew's home on his phone (P22): one day of his crew's
 * visits, in the order they start, each with everything he needs on site
 * (`VisitCard.tsx`). Any day can be reached with the arrows and the week's
 * strip; it opens on today, by the server's clock.
 *
 * The day's count and hours are the server's. A visit the office moves while
 * the screen is open moves here too (the screen listens to the visits it
 * shows), with a line that says what changed, who changed it and when, read
 * from the visit's own history.
 *
 * Addresses: `my-day` (today) and `my-day/<day>`.
 */
import { useCallback, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { addDays, noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { crewPeople, type CrewFacts } from "../jobs/data.ts";
import { useCrewFacts, useJobsScreen } from "../jobs/parts.tsx";
import { crewsOf, dayKeyOf, hoursText, readDayFigures, readLoads, readMoves, readSignOffs, readSnags, readWeek, setTick, weekDays, type CrewVisit, type Tick } from "./data.ts";
import { readLoadLists, readVanDays } from "../jobs/vandays.ts";
import { DayVehicle } from "./DayVehicle.tsx";
import { NoConnection, useConnection } from "./Offline.tsx";
import { VisitCard, type VisitFacts } from "./VisitCard.tsx";

interface DayData {
  week: CrewVisit[];
  figures: { visits: number; hours: number };
  cards: VisitFacts[];
  /** The next day from tomorrow on with a visit of his, when the shown day has none. */
  next: string | null;
  /** His crew's vehicle that day, as the office put it on (plan 68 S14). */
  vans: Awaited<ReturnType<typeof readVanDays>>;
}

const isDay = (value: string | undefined): value is string => value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function MyDay({ rest }: ScreenProps) {
  const t = useT();
  const { dir } = useI18n();
  const nav = useNav();
  const toasts = useToasts();
  const { session, f, today, tick } = useJobsScreen();
  const conn = useConnection();
  const { load: factsLoad, reload: reloadFacts } = useCrewFacts(session);
  const day = isDay(rest[0]) ? rest[0] : today;
  const me = session.config.user?.id ?? null;

  const { load, reload } = useLoad<DayData>(async () => {
    const [week, figures] = await Promise.all([readWeek(session, day), readDayFigures(session, day)]);
    const shown = week.filter((visit) => dayKeyOf(visit.day) === day);
    const jobs = [...new Set(shown.map((visit) => visit.job_id))];
    const [snags, signed, loads, moves, after, vans] = await Promise.all([
      readSnags(session, jobs),
      readSignOffs(session, jobs),
      // What to load, the stock and the note (plan 68 S14) where Vehicles and crew is on; the note's lines alone before it.
      session.part("fleet") ? readLoadLists(session, shown.map((visit) => visit.id)) : readLoads(session, shown.map((visit) => visit.id)),
      readMoves(session, shown),
      shown.length > 0
        ? Promise.resolve(null)
        : session
            .list<CrewVisit>("job_visits", { select: ["id", "day"], where: { and: [{ column: "state", op: "eq", value: "booked" }, { column: "day", op: "gt", value: day }] }, order: ["day", "start_time"], limit: 1 })
            .then((page) => dayKeyOf(page.rows[0]?.day) ?? null),
      readVanDays(session, day, day).catch(() => []),
    ]);
    const cards = shown.map((visit) => ({ visit, signed: signed.get(visit.job_id), snags: snags.filter((snag) => snag.job_id === visit.job_id), load: loads instanceof Map ? loads.get(visit.id) : undefined, loads: loads instanceof Map ? undefined : loads, moved: moves.get(visit.id) }));
    return { week, figures, cards, next: after, vans };
  }, [session, day]);

  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["job_visits", "snags", "sign_offs", "delivery_notes", "delivery_note_lines", ...(session.part("fleet") && session.can("van_days", "read") ? ["van_days"] : [])], again);

  // A read that did not arrive is said as no connection; the last day read stays on screen meanwhile.
  const failed = load.state === "failed" || factsLoad.state === "failed";
  const [busyTick, setBusyTick] = useState<string | null>(null);
  const press = useCallback(
    async (visit: CrewVisit, which: Tick, on: boolean): Promise<boolean> => {
      setBusyTick(`${String(visit.id)}:${which}`);
      const sent = await setTick(session, visit, which, on);
      setBusyTick(null);
      if (sent.state === "offline") {
        conn.lost(() => press(visit, which, on));
        return false;
      }
      conn.back();
      if (sent.state === "refused") toasts.show(t("ui.refused", { reason: reasonOf(sent.error, t) }), "danger", true);
      else toasts.show(t(on ? "cw.ticks.saved" : "cw.ticks.taken", { tick: t(`jb.tick.${which}`) }), "pos");
      again();
      return true;
    },
    [session, conn, toasts, t, again],
  );

  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const touch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  const go = (to: string): void => nav.replace("myday", to);
  const facts: CrewFacts | null = factsLoad.state === "ready" ? factsLoad.data : null;
  const mine = facts === null ? [] : crewsOf(facts, me);
  const crewNames = facts === null ? [] : mine.map((id) => facts.crews.find((crew) => crew.id === id)?.name ?? "").filter((name) => name !== "");
  const mates = facts === null ? [] : mine.flatMap((id) => crewPeople(facts, id).map((one) => one.name)).filter((name, i, all) => name !== "" && all.indexOf(name) === i);
  const crewOf = (visit: CrewVisit): string | null => (mine.length < 2 || facts === null ? null : (facts.crews.find((crew) => crew.id === visit.crew_id)?.name ?? null));
  const week = useMemo(() => weekDays(day), [day]);
  const busyDays = new Set(load.state === "ready" ? load.data.week.map((visit) => dayKeyOf(visit.day)) : []);

  return (
    <div className="crm-cw mr-screen" data-screen="myday">
      <div className="crm-cw-head">
        <h1>{t("cw.day.title")}</h1>
        {crewNames.length > 0 && (
          <span className="crm-cw-crew" data-testid="cw-crew">
            <span className="crm-jb-dot" data-colour="0" aria-hidden="true" />
            {crewNames.join(" · ")}
          </span>
        )}
      </div>
      {mates.length > 0 && (
        <div className="crm-cw-mates" data-testid="cw-mates">
          {mates.join(" · ")}
        </div>
      )}

      <div className="crm-cw-daybar">
        <button type="button" className="crm-cw-arrow mr-gi" aria-label={t("cw.day.before", { day: f.dayShort(noonOf(addDays(day, -1))) })} onClick={() => go(addDays(day, -1))}>
          <Icon name={dir === "rtl" ? "chevron-right" : "chevron-left"} size={18} />
        </button>
        <div className="crm-cw-dayname" aria-live="polite" data-testid="cw-day" data-day={day}>
          <div className="crm-cw-dayname-top">
            <span>{f.weekdayLong(noonOf(day))}</span>
            {day === today && <span className="crm-cw-today">{t("cw.day.today")}</span>}
          </div>
          <div className="crm-cw-date crm-mono">{f.dayLong(noonOf(day))}</div>
        </div>
        <button type="button" className="crm-cw-arrow mr-gi" aria-label={t("cw.day.after", { day: f.dayShort(noonOf(addDays(day, 1))) })} onClick={() => go(addDays(day, 1))}>
          <Icon name={dir === "rtl" ? "chevron-left" : "chevron-right"} size={18} />
        </button>
      </div>
      <div className="crm-cw-week" role="group" aria-label={t("cw.day.week")}>
        {week.map((one) => (
          <button
            key={one}
            type="button"
            className="crm-cw-weekday mr-chip"
            data-day={one}
            aria-current={one === day ? "date" : undefined}
            aria-label={t(busyDays.has(one) ? "cw.day.strip.busy" : "cw.day.strip.free", { day: f.dayLong(noonOf(one)) })}
            onClick={() => go(one)}
          >
            <span className="crm-cw-weekday-dow">{f.weekdayShort(noonOf(one))}</span>
            <span className="crm-cw-weekday-num crm-mono">{f.number(Number(one.slice(8, 10)))}</span>
            <span className="crm-cw-weekday-dot" data-on={busyDays.has(one) ? "1" : "0"} aria-hidden="true" />
          </button>
        ))}
      </div>
      {load.state === "ready" && facts !== null && <DayVehicle vans={load.data.vans} facts={facts} mine={mine} />}
      {session.part("fleet") && session.can("vehicles", "read") && (
        // Vehicles and crew (P25): his vehicle's check before the day, a fault and a fuel fill, one press away.
        <ScreenLink to="myvan" className="crm-cw-back crm-fl-myday mr-gi">
          <Icon name="truck" size={15} />
          {t("fl.myday.link")}
        </ScreenLink>
      )}
      {day !== today && (
        <button type="button" className="crm-cw-back mr-gi" onClick={() => go(today)}>
          <Icon name="sun" size={15} />
          {t("cw.day.backToday")}
        </button>
      )}

      {(conn.down || failed) && (
        <NoConnection
          tried={conn.tried}
          busy={conn.busy}
          onRetry={() => {
            if (failed) {
              reloadFacts();
              reload();
              conn.back();
            } else conn.retry();
          }}
        />
      )}

      {load.state === "loading" || factsLoad.state === "loading" ? (
        <Skeleton rows={2} height={220} />
      ) : load.state === "ready" ? (
        load.data.cards.length === 0 ? (
          <div className="crm-empty crm-cw-empty" data-testid="cw-day-empty">
            <span className="crm-empty-icon">
              <Icon name="calendar-x" size={20} />
            </span>
            <div className="crm-empty-title">{t("cw.day.empty")}</div>
            <p>{crewNames.length === 0 ? t("cw.day.noCrew") : t("cw.day.empty.body", { crew: crewNames.join(" · ") })}</p>
            {load.data.next !== null && (
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" data-testid="cw-next" onClick={() => go(load.data.next!)}>
                <Icon name="calendar-days" />
                {t("cw.day.next", { day: f.dayShort(noonOf(load.data.next)) })}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="crm-cw-summary crm-mono" data-testid="cw-summary">
              {t("cw.day.summary", { n: f.number(load.data.figures.visits), hours: hoursText(f, load.data.figures.hours) }, load.data.figures.visits)}
            </div>
            <div className="crm-cw-visits">
              {load.data.cards.map((card) => (
                <VisitCard key={card.visit.id} facts={card} today={today} f={f} crewName={crewOf(card.visit)} busyTick={busyTick} onTick={(visit, which, on) => void press(visit, which, on)} conn={conn} onChanged={again} agent={agent} touch={touch} />
              ))}
            </div>
          </>
        )
      ) : load.state === "refused" ? (
        <p className="crm-cw-quiet">{t("ui.refused", { reason: reasonOf(load.error, t) })}</p>
      ) : null}
    </div>
  );
}
