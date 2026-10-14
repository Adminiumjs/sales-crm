/**
 * THE DAY SHEET (ledger screen 49): one crew, one day, in the order the
 * visits start. What the crew takes with them: where, when, who to ask for,
 * how to get in, and the four ticks of the day (loaded, arrived, done on
 * site, cleared). The office ticks them here too; the crew's own phone is
 * P22's. Print it and the crew takes it with them.
 *
 * Each visit's start is its own (N18): no time is worked out from the one
 * before. Addresses: `day-sheet/<day>/<crew>`; with none, the next day that
 * has a visit booked, and the first crew booked that day.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { crewPeople, dayHoursOf, dayKeyOf, ofDay, readBooked, readDayHours, startOf, TICKS, truthy, weekColumns, type CrewFacts, type Tick, type Visit } from "./data.ts";
import { CrewChips, DayChips, dayLong, hoursOf, mondayOf, useCrewFacts, useJobsScreen, WeekBar } from "./parts.tsx";

/** The day and crew a sheet opens on: the address's, else the next day with a visit booked, and its first crew. */
export function pickSheet(rest: string[], booked: readonly Visit[], crews: CrewFacts, today: string): { day: string; crewId: number | null } {
  const day = rest[0] !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(rest[0]) ? rest[0] : (booked.map((visit) => dayKeyOf(visit.day)).filter((one): one is string => one !== null && one >= today).sort()[0] ?? today);
  const asked = rest[1] !== undefined && /^\d+$/.test(rest[1]) ? Number(rest[1]) : null;
  const crewId = asked !== null && crews.crews.some((crew) => crew.id === asked) ? asked : (ofDay(booked, day)[0]?.crew_id ?? crews.crews[0]?.id ?? null);
  return { day, crewId };
}

export function DaySheet({ rest }: ScreenProps) {
  const t = useT();
  const nav = useNav();
  const { session, f, today, tick } = useJobsScreen();
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  // Every visit booked from this week on, two weeks and more: the chips are dim on a day with nothing, and the sheet needs no second read.
  const from = mondayOf(rest[0] !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(rest[0]) ? rest[0] : today);
  const { load, reload } = useLoad(() => readBooked(session, addDays(from, -7), addDays(from, 27)), [session, from]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["job_visits", "jobs"], again);
  useLive(["crews", "crew_members", "crew_days"], useCoalesced(reloadFacts));
  const [printing, setPrinting] = useState(false);

  return (
    <div className="crm-screen crm-jb mr-screen" data-screen="daysheet">
      <div className="crm-screen-head">
        <div>
          <h1>{t("jb.ds.title")}</h1>
          <p className="crm-screen-sub crm-jb-lead">{t("jb.ds.sub")}</p>
        </div>
      </div>
      <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={2} height={120} />}>
        {(crews) => (
          <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={160} />}>
            {(booked) => {
              const { day, crewId } = pickSheet(rest, booked, crews, today);
              const monday = mondayOf(day);
              const busy = new Set(booked.map((visit) => dayKeyOf(visit.day)).filter((one): one is string => one !== null));
              const go = (nextDay: string, nextCrew: number | null): void => nav.replace("daysheet", nextDay, ...(nextCrew === null ? [] : [nextCrew]));
              return (
                <>
                  <WeekBar monday={monday} today={today} f={f} onWeek={(next) => go(weekColumns(next, crews.workDays)[0] ?? next, crewId)} />
                  <DayChips days={weekColumns(monday, crews.workDays)} picked={day} busy={busy} f={f} label={t("jb.ds.days")} onPick={(next) => go(next, crewId)} />
                  <CrewChips facts={crews} picked={crewId} label={t("jb.ds.crews")} onPick={(next) => go(day, next)} />
                  <Sheet day={day} crewId={crewId} visits={ofDay(booked, day, crewId)} crews={crews} onOther={(other) => go(day, other)} onPrint={() => setPrinting(true)} onDone={again} printing={printing} onPrinted={() => setPrinting(false)} />
                </>
              );
            }}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

function crewLine(crews: CrewFacts, crewId: number | null): string {
  return crewPeople(crews, crewId)
    .map((person) => person.name)
    .filter((name) => name !== "")
    .join(" · ");
}

function Sheet({ day, crewId, visits, crews, onOther, onPrint, onDone, printing, onPrinted }: { day: string; crewId: number | null; visits: Visit[]; crews: CrewFacts; onOther: (crewId: number) => void; onPrint: () => void; onDone: () => void; printing: boolean; onPrinted: () => void }) {
  const t = useT();
  const { session, f } = useJobsScreen();
  const crewIndex = crews.crews.findIndex((one) => one.id === crewId);
  const crew = crews.crews[crewIndex];
  const of = dayHoursOf(crews, crewId);
  // The crew's hours that day, as the server adds them up.
  const ids = visits.map((visit) => `${visit.id}:${String(visit.hours)}`).join(",");
  const { load: hoursLoad } = useLoad(() => (crewId === null ? Promise.resolve(0) : readDayHours(session, day, crewId)), [session, day, crewId, ids]);
  const hours = hoursLoad.state === "ready" ? hoursLoad.data : null;
  const other = crews.crews.find((one) => one.id !== crewId);
  if (crew === undefined) return null;
  return (
    <section className="crm-jb-sheet" aria-labelledby="crm-jb-sheet-h" data-testid="jb-sheet" data-day={day} data-crew={crewId}>
      <div className="crm-jb-sheet-head">
        <span className="crm-jb-crewtile" data-colour={crewIndex % 8} aria-hidden="true">
          {crew.name.slice(0, 1)}
        </span>
        <div className="crm-jb-sheet-words">
          <h2 id="crm-jb-sheet-h">{crew.name}</h2>
          <div className="crm-jb-quiet" data-testid="jb-sheet-people">
            {crewLine(crews, crewId)}
          </div>
        </div>
        <div className="crm-jb-sheet-end">
          <div className="crm-jb-sheet-date">{dayLong(f, day)}</div>
          <div className="crm-jb-sheet-hours">
            <span className="crm-mono" data-tone={hours !== null && hours > of ? "warn" : undefined} data-figure="sheet-hours">
              {hours === null ? "…" : t("jb.hours", { n: hoursOf(f, hours) })}
            </span>
            {hours !== null && <span className="crm-jb-quiet">{hours === 0 ? t("jb.ds.nothingBooked") : hours > of ? t("jb.ds.over", { of: hoursOf(f, of) }) : t("jb.ds.inside")}</span>}
          </div>
          <div className="crm-jb-quiet" data-figure="sheet-visits">
            {t("jb.ds.visits", { count: f.number(visits.length) }, visits.length)}
          </div>
        </div>
      </div>

      <ol className="crm-jb-stops">
        {visits.map((visit, i) => (
          <SheetVisit key={visit.id} n={i + 1} visit={visit} canTick={session.can("job_visits", "update")} onDone={onDone} />
        ))}
      </ol>

      {visits.length === 0 && (
        <div className="crm-empty" data-testid="jb-sheet-empty">
          <span className="crm-empty-icon">
            <Icon name="truck" size={20} />
          </span>
          <div className="crm-empty-title">{t("jb.ds.empty")}</div>
          {other !== undefined && (
            <>
              <p>{t("jb.ds.empty.body", { crew: other.name })}</p>
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" onClick={() => onOther(other.id)}>
                {t("jb.ds.showOther", { crew: other.name })}
              </button>
            </>
          )}
        </div>
      )}

      <div className="crm-jb-sheet-foot">
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" data-testid="jb-print" onClick={onPrint}>
          <Icon name="printer" />
          {t("jb.ds.print")}
        </button>
      </div>
      {printing && <PrintLayout day={day} crewId={crewId} visits={visits} crews={crews} hours={hours} onClose={onPrinted} />}
    </section>
  );
}

function SheetVisit({ n, visit, canTick, onDone }: { n: number; visit: Visit; canTick: boolean; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const [busy, setBusy] = useState<Tick | null>(null);
  const done = TICKS.filter((tick) => truthy(visit[tick])).length;
  const toggle = async (tick: Tick): Promise<void> => {
    if (busy !== null) return;
    setBusy(tick);
    const on = truthy(visit[tick]);
    // Names what the sheet saw: a tick the crew changed meanwhile is not written over.
    await toasts.say(session.update("job_visits", visit.id, { [tick]: !on }, { seen: { [tick]: on } }), () => t(on ? "jb.ds.untick.done" : "jb.ds.tick.done", { tick: t(`jb.tick.${tick}`) }));
    setBusy(null);
    onDone();
  };
  return (
    <li className="crm-jb-stop mr-card" data-visit={visit.id}>
      <div className="crm-jb-stop-top">
        <span className="crm-jb-num crm-mono">{f.number(n)}</span>
        <div className="crm-jb-stop-words">
          <div className="crm-jb-stop-line">
            {startOf(visit.start_time) !== null && (
              <span className="crm-mono crm-jb-time" dir="ltr">
                {startOf(visit.start_time)}
              </span>
            )}
            <strong>{visit.site_name}</strong>
            <span className="crm-jb-quiet">
              {t("jb.hours", { n: hoursOf(f, visit.hours) })}
              {visit.site_town !== null && visit.site_town !== "" ? ` · ${visit.site_town}` : ""}
            </span>
          </div>
          <div className="crm-jb-card-what">{[visit.code, visit.title, visit.what].filter((part) => part !== null && part !== "").join(" · ")}</div>
        </div>
        <span className="crm-pill" data-tone={done === 4 ? "pos" : undefined} data-figure="ticks">
          {t("jb.ds.ticks", { done: f.number(done), of: f.number(4) })}
        </span>
      </div>
      <div className="crm-jb-stop-facts">
        <div>
          <div className="crm-jb-fact-head">{t("jb.ds.where")}</div>
          <div>{[visit.site_address, visit.site_town].filter((part) => part !== null && part !== "").join(", ") || t("jb.ds.noAddress")}</div>
        </div>
        <div>
          <div className="crm-jb-fact-head">{t("jb.ds.askFor")}</div>
          <div>{visit.ask_for ?? t("jb.ds.nobodyNamed")}</div>
          {visit.site_phone !== null && visit.site_phone !== "" && (
            <a className="crm-jb-phone crm-mono" href={`tel:${visit.site_phone.replace(/[^\d+]/g, "")}`} dir="ltr">
              <Icon name="phone" size={13} />
              {visit.site_phone}
            </a>
          )}
        </div>
        <div>
          <div className="crm-jb-fact-head">{t("jb.ds.gettingIn")}</div>
          <div>{visit.access_note ?? t("jb.ds.nothingWritten")}</div>
        </div>
        {visit.note !== null && visit.note !== "" && (
          <div>
            <div className="crm-jb-fact-head">{t("jb.ds.note")}</div>
            <div>{visit.note}</div>
          </div>
        )}
      </div>
      <div className="crm-jb-ticks" role="group" aria-label={t("jb.ds.ticksLabel")}>
        {TICKS.map((tick) => {
          const on = truthy(visit[tick]);
          return canTick ? (
            <button key={tick} type="button" className="crm-jb-tick mr-gi" aria-pressed={on} data-tick={tick} disabled={busy !== null} onClick={() => void toggle(tick)}>
              <span className="crm-jb-tick-box" aria-hidden="true">
                {on && <Icon name="check" size={12} />}
              </span>
              {t(`jb.tick.${tick}`)}
            </button>
          ) : (
            <span key={tick} className="crm-jb-tick" data-on={on ? "1" : "0"} data-tick={tick}>
              <span className="crm-jb-tick-box" aria-hidden="true">
                {on && <Icon name="check" size={12} />}
              </span>
              {t(`jb.tick.${tick}`)}
              <span className="crm-sr">{t(on ? "jb.ds.ticked" : "jb.ds.notTicked")}</span>
            </span>
          );
        })}
      </div>
    </li>
  );
}

/** The sheet as it prints: plain lines, the four ticks as boxes to tick by hand. */
function PrintLayout({ day, crewId, visits, crews, hours, onClose }: { day: string; crewId: number | null; visits: Visit[]; crews: CrewFacts; hours: number | null; onClose: () => void }) {
  const t = useT();
  const { f } = useJobsScreen();
  const crew = crews.crews.find((one) => one.id === crewId);
  return (
    <Dialog
      shape="box"
      name="jb-print"
      icon="printer"
      title={t("jb.ds.print.title", { day: dayLong(f, day) })}
      subtitle={t("jb.ds.print.sub")}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" onClick={onClose}>
            {t("ui.close")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-autofocus onClick={() => window.print()}>
            <Icon name="printer" />
            {t("jb.ds.print.go")}
          </button>
        </>
      }
    >
      <div className="crm-jb-print" data-testid="jb-print-layout">
        <h1>{t("jb.ds.print.title", { day: dayLong(f, day) })}</h1>
        <p>
          {crew?.name ?? ""} · {crewLine(crews, crewId)}
        </p>
        <p>{`${t("jb.ds.visits", { count: f.number(visits.length) }, visits.length)}${hours === null ? "" : ` · ${t("jb.hours", { n: hoursOf(f, hours) })}`}`}</p>
        {visits.length === 0 && <p>{t("jb.ds.print.empty")}</p>}
        <ol>
          {visits.map((visit) => (
            <li key={visit.id}>
              <div dir="auto">{[startOf(visit.start_time), visit.site_name, t("jb.hours", { n: hoursOf(f, visit.hours) })].filter((part) => part !== null).join(" · ")}</div>
              <div dir="auto">{[visit.code, visit.title, visit.what].filter((part) => part !== null && part !== "").join(" · ")}</div>
              <div dir="auto">{[visit.site_address, visit.site_town].filter((part) => part !== null && part !== "").join(", ")}</div>
              <div dir="auto">{[visit.ask_for === null ? null : t("jb.ds.print.ask", { who: visit.ask_for }), visit.site_phone, visit.access_note].filter((part) => part !== null && part !== "").join(" · ")}</div>
              <div className="crm-jb-print-ticks">{TICKS.map((tick) => `[ ] ${t(`jb.tick.${tick}`)}`).join("   ")}</div>
            </li>
          ))}
        </ol>
      </div>
    </Dialog>
  );
}

