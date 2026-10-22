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
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { crewPeople, dayHoursOf, dayKeyOf, ofDay, readBooked, readDayHours, startOf, TICKS, truthy, weekColumns, type CrewFacts, type Tick, type Visit } from "./data.ts";
import { LoadLists } from "./LoadLists.tsx";
import { CrewChips, DayChips, dayLong, dayWords, hoursOf, mondayOf, useCrewFacts, useJobsScreen, WeekBar } from "./parts.tsx";
import { plateOf, VehiclePick } from "./VehiclePick.tsx";
import { hasVanDays, putVanDay, readDayFacts, readLoadLists, refusalOf, rowOf, truthyHired, writesVanDays, type DayFacts, type DayRefusal, type Loads, type VanDay } from "./vandays.ts";

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
  // The crew's vehicle that day, and what to load on each visit (plan 68 S14).
  const vans = hasVanDays(session);
  const { load: vanLoad, reload: reloadVan } = useLoad(() => (vans ? readDayFacts(session, day) : Promise.resolve(null)), [session, vans, day, ids]);
  const { load: loadsLoad, reload: reloadLoads } = useLoad(() => (vans ? readLoadLists(session, visits.map((visit) => visit.id)) : Promise.resolve(null)), [session, vans, ids]);
  useLive(vans ? ["van_days", "vehicles", ...(session.can("deal_stock_needs", "read") ? ["deal_stock_needs"] : []), "delivery_notes", "delivery_note_lines"] : [], useCoalesced(useCallback(() => (reloadVan(), reloadLoads()), [reloadVan, reloadLoads])));
  const dayFacts = vanLoad.state === "ready" ? vanLoad.data : null;
  const loads = loadsLoad.state === "ready" ? loadsLoad.data : null;
  const vanDay = dayFacts === null ? undefined : rowOf(dayFacts.days, crewId, day);
  const [changing, setChanging] = useState(false);
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

      {dayFacts !== null && <SheetVehicle facts={dayFacts} crewName={crew.name} crewId={crewId} day={day} row={vanDay} canChange={writesVanDays(session)} onChange={() => setChanging(true)} />}

      <ol className="crm-jb-stops">
        {visits.map((visit, i) => (
          <SheetVisit key={visit.id} n={i + 1} visit={visit} loads={loads} canTick={session.can("job_visits", "update")} onDone={onDone} />
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
      {printing && <PrintLayout day={day} crewId={crewId} visits={visits} crews={crews} hours={hours} vanDay={vanDay} loads={loads} onClose={onPrinted} />}
      {changing && dayFacts !== null && crewId !== null && <DayVehicleDialog facts={dayFacts} crews={crews} crewId={crewId} day={day} row={vanDay} onClose={() => setChanging(false)} onDone={() => (reloadVan(), onDone())} />}
    </section>
  );
}

function SheetVisit({ n, visit, loads, canTick, onDone }: { n: number; visit: Visit; loads: Loads | null; canTick: boolean; onDone: () => void }) {
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
      {loads !== null && <LoadLists loads={loads} visitId={visit.id} day={dayKeyOf(visit.day)} f={f} />}
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
function PrintLayout({ day, crewId, visits, crews, hours, vanDay, loads, onClose }: { day: string; crewId: number | null; visits: Visit[]; crews: CrewFacts; hours: number | null; vanDay: VanDay | undefined; loads: Loads | null; onClose: () => void }) {
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
        <p data-testid="jb-print-crew">
          {vanDay === undefined
            ? `${crew?.name ?? ""} · ${crewLine(crews, crewId)}`
            : t(truthyHired(vanDay) ? "vandays.print.crew.hired" : "vandays.print.crew", { crew: crew?.name ?? "", people: crewPeople(crews, crewId).map((person) => person.name).filter((name) => name !== "").join(", "), plate: vanDay.plate ?? vanDay.vehicle_name ?? "" })}
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
              {loads !== null && <LoadLists loads={loads} visitId={visit.id} day={dayKeyOf(visit.day)} f={f} print />}
              <div className="crm-jb-print-ticks">{TICKS.map((tick) => `[ ] ${t(`jb.tick.${tick}`)}`).join("   ")}</div>
            </li>
          ))}
        </ol>
      </div>
    </Dialog>
  );
}


/** The crew's vehicle that day, on the sheet's head: its plate and name, "Hired", and "Change" for the office (M3 2a–2d). */
function SheetVehicle({ facts, crewName, crewId, day, row, canChange, onChange }: { facts: DayFacts; crewName: string; crewId: number | null; day: string; row: VanDay | undefined; canChange: boolean; onChange: () => void }) {
  const t = useT();
  const { f } = useJobsScreen();
  const own = crewId === null ? undefined : facts.own.get(crewId);
  return (
    <div className="crm-vd-sheet" data-testid="vd-sheet-vehicle" data-vehicle={row?.vehicle_id ?? ""}>
      <div className="crm-vd-sheet-row">
        <Icon name="truck" size={16} />
        {row === undefined ? (
          <span className="crm-jb-quiet">{t("vandays.ds.noVehicle")}</span>
        ) : (
          <>
            <span className="crm-mono crm-vd-sheet-plate" dir="ltr">
              {row.plate ?? ""}
            </span>
            <span className="crm-vd-sheet-name">{row.vehicle_name ?? ""}</span>
            {truthyHired(row) && (
              <span className="crm-pill" data-tone="info" data-testid="vd-hired">
                {t("vandays.ds.hired")}
              </span>
            )}
          </>
        )}
        {canChange && (
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi crm-vd-sheet-change" data-testid="vd-sheet-change" aria-label={t("vandays.ds.change.aria", { crew: crewName, day: dayWords(f, day) })} onClick={onChange}>
            <Icon name="pencil" size={14} />
            {t("vandays.ds.change")}
          </button>
        )}
      </div>
      {row !== undefined && own !== undefined && own !== row.vehicle_id && (
        <p className="crm-vd-notown" data-testid="vd-not-own">
          {t("vandays.ds.notOwn", { plate: plateOf(facts.vehicles.find((one) => one.id === own)) })}
        </p>
      )}
    </div>
  );
}

/** "Vehicle for {crew}, {day}": one vehicle for all of the crew's visits that day (M3 2e/2f). Save stays off until another is picked. */
function DayVehicleDialog({ facts, crews, crewId, day, row, onClose, onDone }: { facts: DayFacts; crews: CrewFacts; crewId: number; day: string; row: VanDay | undefined; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const crewName = crews.crews.find((one) => one.id === crewId)?.name ?? "";
  const [value, setValue] = useState<number | null>(row?.vehicle_id ?? facts.own.get(crewId) ?? null);
  const [refused, setRefused] = useState<DayRefusal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = refused ?? refusalOf(facts, value, crewId, day);
  const plate = (id: number | null) => plateOf(facts.vehicles.find((one) => one.id === id));
  const ready = value !== null && value !== row?.vehicle_id && refusal === null;
  const go = async (): Promise<void> => {
    if (!ready || busy || value === null) return;
    setBusy(true);
    setError(null);
    const put = await putVanDay(session, facts, crewId, day, value);
    setBusy(false);
    if ("refused" in put) {
      if (put.refused.kind !== "other") return setRefused(put.refused);
      const saved = put.refused.error;
      return setError(saved.state === "refused" ? t("ui.refused", { reason: reasonOf(saved.error, t) }) : t("ui.unknown"));
    }
    toasts.show(t("vandays.dlg.saved", { crew: crewName, plate: plate(value), day: dayWords(f, day) }), "pos");
    onDone();
    onClose();
  };
  const name = (id: number | null) => crews.crews.find((one) => one.id === id)?.name ?? "";
  const words = (one: DayRefusal): string =>
    one.kind === "with"
      ? one.crewId === null
        ? t("vandays.isWith.other", { plate: plate(one.vehicleId), day: dayWords(f, day) })
        : t("vandays.isWith", { plate: plate(one.vehicleId), crew: name(one.crewId), day: dayWords(f, day) })
      : one.kind === "hiredTo"
        ? t("vandays.hiredTo", { plate: plate(one.vehicleId), day: dayWords(f, one.to) })
        : one.kind === "hiredFrom"
          ? t("vandays.hiredFrom", { plate: plate(one.vehicleId), day: dayWords(f, one.from) })
          : "";
  return (
    <Dialog
      shape="box"
      name="vd-day-vehicle"
      icon="truck"
      title={t("vandays.dlg.title", { crew: crewName, day: dayWords(f, day) })}
      subtitle={t("vandays.dlg.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.close")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t("vandays.dlg.save")}
          </button>
        </>
      }
    >
      <label className="crm-label" htmlFor="crm-vd-day-pick">
        {t("vandays.field")}
      </label>
      <VehiclePick id="crm-vd-day-pick" facts={facts} crews={crews} crewId={crewId} crewName={crewName} day={day} value={value} onPick={(id) => (setValue(id), setRefused(null))} f={f} open disabled={busy} />
      {refusal !== null && refusal.kind !== "other" && (
        <div className="crm-form-error" role="alert" data-testid="vd-refusal" data-kind={refusal.kind}>
          <Icon name="circle-slash" size={15} />
          <span>{words(refusal)}</span>
        </div>
      )}
      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
