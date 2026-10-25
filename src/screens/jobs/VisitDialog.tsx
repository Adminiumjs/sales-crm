/**
 * THE BOOKING DIALOG, in its third use: a visit to a job (D4 §3.4). Book a
 * visit that waits, move a booked one, call one off, or add a visit to a job.
 *
 * WHAT IS CHECKED HERE, AND WHAT THE SERVER HOLDS. The server refuses a day
 * before the visit's stock lands and a day the crew does not work; it books a
 * crew over its normal day (and this dialog flags it). A day gone by is this
 * dialog's own refusal: the server takes one. Each refusal offers the first
 * day that would do.
 *
 * WHAT IS SAVED. A new visit carries a key made when the dialog opened, so a
 * reply lost on the way back makes one visit. A booking is two writes (the
 * day, then the visit's own "Book"), so the customer's e-mail says "booked"
 * and never "moved"; a move names the day the dialog read. Calling a visit off
 * writes the why, then removes the visit.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays, westernDigits, type Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { newClientKey, type Saved, type StaffSession } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import {
  addVisit,
  bookVisit,
  cancelVisit,
  checkBooking,
  crewPeople,
  dayHoursOf,
  dayKeyOf,
  lastMove,
  mailsOn,
  moveVisit,
  num,
  startOf,
  type CrewFacts,
  type Job,
  type Plan,
  type Refusal,
  type Visit,
  type VisitKind,
} from "./data.ts";
import { dayWords, hoursOf } from "./parts.tsx";
import { VanDayField } from "./VanDayField.tsx";
import { dropIfEmpty, putVanDay, readDayFacts, refusalOf, rowOf, writesVanDays, type DayRefusal, type VanDay } from "./vandays.ts";

export type VisitBooking = { mode: "book"; visit: Visit; day?: string } | { mode: "move"; visit: Visit; day?: string } | { mode: "cancel"; visit: Visit } | { mode: "add"; jobId?: number };

const KINDS: readonly VisitKind[] = ["drop", "return", "install"];

export function VisitDialog({ booking, session, f, facts, plan, jobs, today, onClose, onDone }: { booking: VisitBooking; session: StaffSession; f: Formatters; facts: CrewFacts; plan: Plan | null; jobs: Job[]; today: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const visit = booking.mode === "add" ? null : booking.visit;
  const isAdd = booking.mode === "add";
  const isCancel = booking.mode === "cancel";
  const isMove = booking.mode === "move";
  const wasDay = visit === null ? null : dayKeyOf(visit.day);
  const asked = booking.mode === "book" || booking.mode === "move" ? booking.day : undefined;

  const [jobId, setJobId] = useState<number | null>(booking.mode === "add" ? (booking.jobId ?? null) : (visit?.job_id ?? null));
  const [kind, setKind] = useState<VisitKind>("drop");
  const [what, setWhat] = useState("");
  const [stock, setStock] = useState("");
  // A visit that waits is offered the latest of: tomorrow, the day asked for (a drop), and its stock's day.
  const [day, setDay] = useState(() => asked ?? wasDay ?? [addDays(today, 1), visit?.stock_ready_on ?? ""].sort().reverse()[0]!);
  const [start, setStart] = useState(() => startOf(visit?.start_time) ?? "08:00");
  const [hours, setHours] = useState(() => (visit === null ? "" : String(num(visit.hours))));
  // A visit with no crew yet is offered the first crew with as many people as it needs (the design's "Red for three or more").
  const [crewId, setCrewId] = useState<number | null>(() => visit?.crew_id ?? facts.crews.find((one) => crewPeople(facts, one.id).length >= (visit?.crew_size ?? 1))?.id ?? facts.crews[0]?.id ?? null);
  const [size, setSize] = useState(() => (visit === null ? "1" : String(visit.crew_size ?? 1)));
  const [note, setNote] = useState(visit?.note ?? "");
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  // One key for a new visit, for as long as the dialog is open: a reply lost on the way back makes one visit.
  const key = useRef(newClientKey());

  // What the record's history says of an earlier move.
  const { load: moved } = useLoad(() => (visit === null || visit.state !== "booked" ? Promise.resolve(null) : lastMove(session, visit.id).catch(() => null)), [session, visit?.id]);
  const before = moved.state === "ready" ? moved.data : null;

  const job = jobs.find((one) => one.id === jobId) ?? null;
  const hoursN = Number(westernDigits(hours));
  const sizeN = Number(westernDigits(size));
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const stockDay = isAdd ? (/^\d{4}-\d{2}-\d{2}$/.test(stock) ? stock : null) : dayKeyOf(visit?.stock_ready_on);
  // An added visit may be left without a day: it waits in "To book".
  const booking_ = !isAdd || validDay;
  const own = visit !== null && visit.state === "booked" && visit.crew_id === crewId && wasDay === day ? num(visit.hours) : 0;
  const other = crewId === null || !validDay ? 0 : Math.max(0, (plan?.crewDays[String(crewId)]?.[day] ?? 0) - own);
  const check = useMemo(
    () => (!booking_ || !validDay ? null : checkBooking({ day, today, stock: stockDay, crewId, hours: Number.isFinite(hoursN) ? hoursN : 0, otherHours: other, crewDays: crewId === null ? undefined : facts.days.get(crewId), dayHours: dayHoursOf(facts, crewId) })),
    [booking_, validDay, day, today, stockDay, crewId, hoursN, other, facts],
  );
  const crew = facts.crews.find((one) => one.id === crewId) ?? null;
  const changed = !isMove || visit === null || day !== wasDay || start !== startOf(visit.start_time) || crewId !== visit.crew_id || hoursN !== num(visit.hours) || sizeN !== (visit.crew_size ?? 0) || note.trim() !== (visit.note ?? "");
  const filled = Number.isFinite(hoursN) && hoursN > 0 && Number.isInteger(sizeN) && sizeN > 0 && /^\d{2}:\d{2}$/.test(start) && (!isAdd || (jobId !== null && what.trim() !== ""));

  useEffect(() => setError(null), [day, crewId, start, hours]);

  // The crew's vehicle for the day (plan 68 S14): its row that day, else the one picked for this crew, else its own (CD-9).
  const vans = writesVanDays(session);
  const { load: dayLoad } = useLoad(() => (vans && validDay ? readDayFacts(session, day) : Promise.resolve(null)), [session, vans, validDay, day]);
  // The facts of the day picked, never those of the day before while the new day is read.
  const dayFacts = dayLoad.state === "ready" && dayLoad.data !== null && dayLoad.data.day === day ? dayLoad.data : null;
  const [pick, setPick] = useState<{ crewId: number | null; vehicle: number } | null>(null);
  const [changingDay, setChangingDay] = useState(false);
  const [vanRefused, setVanRefused] = useState<DayRefusal | null>(null);
  useEffect(() => (setChangingDay(false), setVanRefused(null)), [crewId, day]);
  const dayRow = dayFacts === null ? undefined : rowOf(dayFacts.days, crewId, day);
  const picked = pick !== null && pick.crewId === crewId ? pick.vehicle : null;
  const vehicleId = dayFacts === null ? null : changingDay ? (picked ?? dayRow?.vehicle_id ?? null) : dayRow !== undefined ? dayRow.vehicle_id : (picked ?? (crewId === null ? null : (dayFacts.own.get(crewId) ?? null)));
  const vanRefusal = vanRefused ?? (dayFacts === null || !booking_ ? null : refusalOf(dayFacts, vehicleId, crewId, day));
  const vanReady = !vans || isCancel || !booking_ || !validDay || (dayFacts !== null && vanRefusal === null);
  const here = visit !== null && visit.state === "booked" && visit.crew_id === crewId && wasDay === day ? 1 : 0;
  // A new vehicle for the crew's day is a change of its own, though the visit's fields stay as they were.
  const vanChanged = dayRow !== undefined && vehicleId !== null && vehicleId !== dayRow.vehicle_id;
  const ready = isCancel ? why.trim().length > 2 : filled && (changed || vanChanged) && (!booking_ || (check !== null && check.refusal === null));

  const refusalWords = (refusal: Refusal): string => {
    const label = visit?.code ?? job?.code ?? "";
    if (refusal.kind === "nocrew") return t("jb.bk.refused.nocrew");
    if (refusal.kind === "gone") return t("jb.bk.refused.gone", { day: dayWords(f, day) });
    if (refusal.kind === "stock") return t("jb.bk.refused.stock", { job: label, ready: dayWords(f, refusal.ready) });
    return t("jb.bk.refused.closed", { crew: crew?.name ?? "", day: dayWords(f, day) });
  };
  const offer = check?.refusal !== null && check?.refusal !== undefined && check.refusal.kind !== "nocrew" ? check.refusal.offer : null;

  const mails = mailsOn(facts.settings);
  // Only a booked visit's calling off is mailed: one that waits was never announced.
  const told = isCancel ? (visit?.state === "booked" ? "cancel" : "none") : isMove ? (day !== wasDay || start !== startOf(visit?.start_time) ? "move" : "same") : booking_ ? "book" : "none";
  const toldLine = told === "none" ? null : mails === "unknown" ? t("jb.bk.told.unknown") : mails === "off" ? t("jb.bk.told.off") : told === "same" ? t("jb.bk.told.same") : t(`jb.bk.told.${told}`);

  const go = async (): Promise<void> => {
    if (!ready || !vanReady || busy) return;
    setError(null);
    setBusy(true);
    const slow = setTimeout(() => setChecking(true), 1200);
    const end = (): void => {
      clearTimeout(slow);
      setChecking(false);
      setBusy(false);
    };
    const said = (saved: Saved<unknown>): boolean => {
      if (saved.state === "saved") return true;
      if (saved.state === "unknown") setError(t("ui.unknown"));
      else {
        const fields = saved.error.fields;
        const reason =
          fields["day"] !== undefined || saved.error.code === "BOOKING_CLOSED"
            ? t("jb.bk.refused.server")
            : saved.error.status === 409 && (saved.error.code === "ROW_CHANGED" || saved.error.code === "STATE_MOVE_REFUSED")
              ? t("jb.bk.refused.changed")
              : reasonOf(saved.error, t);
        setError(t("ui.refused", { reason }));
      }
      return false;
    };
    if (isCancel && visit !== null) {
      const done = await cancelVisit(session, visit, why.trim());
      end();
      if (!said(done)) return;
      // Its crew's vehicle that day goes with the crew's last visit then (CD-8).
      if (visit.state === "booked") await dropIfEmpty(session, visit.crew_id, wasDay).catch(() => undefined);
      toasts.show(t("jb.toast.cancelled", { site: visit.site_name, job: visit.code ?? "" }), "plain");
      onDone();
      return onClose();
    }
    if (crewId === null && booking_) return end();
    const draft = { day, start, crewId: crewId ?? 0, hours: hoursN, size: sizeN, note };
    let target: Visit | null = visit;
    if (isAdd) {
      if (jobId === null) return end();
      const made = await addVisit(session, { jobId, kind, what, hours: hoursN, size: sizeN, stock: stockDay, note }, key.current);
      if (made.state !== "saved") {
        said(made);
        return end();
      }
      target = made.row;
      if (!booking_) {
        end();
        toasts.show(t("jb.toast.added", { site: job?.site_name ?? "" }), "pos");
        onDone();
        return onClose();
      }
    }
    if (target === null) return end();
    // The crew's vehicle for that day first: one crew a vehicle a day is the server's to hold, and its refusal names who has it.
    let made: VanDay | null = null;
    if (vans && dayFacts !== null && crewId !== null && vehicleId !== null && (dayRow === undefined || dayRow.vehicle_id !== vehicleId)) {
      const put = await putVanDay(session, dayFacts, crewId, day, vehicleId);
      if ("refused" in put) {
        end();
        if (put.refused.kind === "other") said(put.refused.error as Saved<unknown>);
        else setVanRefused(put.refused);
        return;
      }
      made = put.made;
    }
    const saved = target.state === "booked" ? await moveVisit(session, target, draft) : await bookVisit(session, target, draft);
    end();
    if (saved.state === "refused" && made !== null) await session.remove("van_days", made.id).catch(() => undefined);
    // A visit that left its crew's day takes that day's vehicle with it when it was the last one (CD-8).
    if (saved.state === "saved" && target.state === "booked" && (target.crew_id !== crewId || dayKeyOf(target.day) !== day)) await dropIfEmpty(session, target.crew_id, dayKeyOf(target.day)).catch(() => undefined);
    if (!said(saved)) {
      // An added visit that could not be booked is there, waiting: say so, and the list shows it.
      if (isAdd) onDone();
      return;
    }
    const site = visit?.site_name ?? job?.site_name ?? "";
    const line = t(target.state === "booked" ? "jb.toast.moved" : "jb.toast.booked", { site, day: dayWords(f, day), crew: crew?.name ?? "" });
    const flagged = check?.over !== null && check?.over !== undefined ? ` ${t("jb.bk.over", { crew: crew?.name ?? "", hours: hoursOf(f, check.over.hours), of: hoursOf(f, check.over.of), day: dayWords(f, day) })}` : "";
    toasts.show(`${line}${flagged}`, "pos");
    onDone();
    onClose();
  };

  const title = t(isAdd ? "jb.bk.title.add" : isCancel ? "jb.bk.title.cancel" : isMove ? "jb.bk.title.move" : "jb.bk.title.book");
  const subtitle = t(isAdd ? "jb.bk.sub.add" : isCancel ? "jb.bk.sub.cancel" : isMove ? "jb.bk.sub.move" : "jb.bk.sub.book");

  return (
    <Dialog
      shape="box"
      name={`job-visit-${booking.mode}`}
      icon={isCancel ? "calendar-x" : "truck"}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t(isCancel ? "jb.bk.keep" : "ui.close")}
          </button>
          <button type="button" className={`crm-btn crm-btn-44 crm-btn-wide mr-btn ${isCancel ? "crm-btn-danger" : "crm-btn-primary"}`} data-go disabled={!ready || !vanReady || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t(isCancel ? "jb.bk.go.cancel" : isMove ? "jb.bk.go.move" : isAdd && !booking_ ? "jb.bk.go.add" : "jb.bk.go.book")}
          </button>
        </>
      }
    >
      {visit !== null && isMove && wasDay !== null && (
        <div className="crm-bk-was" data-testid="jb-was">
          <span className="crm-bk-head">{t("jb.bk.was")}</span>
          <s className="crm-mono">
            {dayWords(f, wasDay)}
            {startOf(visit.start_time) !== null && <>, <span dir="ltr">{startOf(visit.start_time)}</span></>} · {t("jb.hours", { n: hoursOf(f, visit.hours) })} · {facts.crews.find((one) => one.id === visit.crew_id)?.name ?? ""}
          </s>
        </div>
      )}
      {visit !== null && before !== null && (
        <p className="crm-bk-history" data-testid="jb-history">
          <Icon name="history" size={14} />
          <span>
            {t(before.by === null || before.by === "" ? "jb.bk.history.nobody" : "jb.bk.history", {
              was: before.day === null ? (before.start ?? "") : `${dayWords(f, before.day)}${before.start === null ? "" : `, ${before.start}`}`,
              who: before.by ?? "",
              when: `${f.dayShort(before.at)}, ${f.time(before.at)}`,
            })}
          </span>
        </p>
      )}

      {isCancel && visit !== null ? (
        <>
          <div className="crm-bk-sum">
            <strong>
              {visit.site_name} · {visit.code ?? ""} · {visit.what}
            </strong>
            <span className="crm-mono">{wasDay === null ? t("jb.dv.noDay") : `${dayWords(f, wasDay)} · ${facts.crews.find((one) => one.id === visit.crew_id)?.name ?? ""}`}</span>
          </div>
          <label className="crm-label" htmlFor="crm-jb-why">
            {t("jb.bk.why")}
          </label>
          <input
            id="crm-jb-why"
            data-autofocus
            className="crm-input mr-fld"
            value={why}
            maxLength={200}
            disabled={busy}
            placeholder={t("jb.bk.why.hint")}
            onChange={(event) => (setWhy(event.target.value), setError(null))}
            onKeyDown={(event) => {
              if (event.key === "Enter") void go();
            }}
          />
        </>
      ) : (
        <fieldset className="crm-fields crm-jb-bk" disabled={busy}>
          <div className="crm-bk-head">{t("jb.bk.for")}</div>
          {isAdd ? (
            <>
              <label className="crm-label" htmlFor="crm-jb-job">
                {t("jb.bk.job")}
              </label>
              <select id="crm-jb-job" data-autofocus className="crm-input mr-fld" value={jobId ?? ""} onChange={(event) => setJobId(event.target.value === "" ? null : Number(event.target.value))}>
                <option value="">{t("jb.bk.job.pick")}</option>
                {jobs.map((one) => (
                  <option key={one.id} value={one.id}>
                    {[one.code, one.site_name, one.title].filter((part) => part !== null && part !== "").join(" · ")}
                  </option>
                ))}
              </select>
              <div className="crm-field-pair">
                <div>
                  <label className="crm-label" htmlFor="crm-jb-kind">
                    {t("jb.bk.kind")}
                  </label>
                  <select id="crm-jb-kind" className="crm-input mr-fld" value={kind} onChange={(event) => setKind(event.target.value as VisitKind)}>
                    {KINDS.map((one) => (
                      <option key={one} value={one}>
                        {t(`jb.kind.${one}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="crm-label" htmlFor="crm-jb-stock">
                    {t("jb.bk.stock")}
                  </label>
                  <input id="crm-jb-stock" className="crm-input crm-mono mr-fld" type="date" value={stock} onChange={(event) => setStock(event.target.value)} />
                </div>
              </div>
              <label className="crm-label" htmlFor="crm-jb-what">
                {t("jb.bk.what")}
              </label>
              <input id="crm-jb-what" className="crm-input mr-fld" value={what} maxLength={200} placeholder={t("jb.bk.what.hint")} onChange={(event) => setWhat(event.target.value)} />
            </>
          ) : (
            visit !== null && (
              <div className="crm-bk-fixed" data-testid="jb-bk-job">
                {visit.site_name} · {visit.code ?? ""} · {visit.what}
                <span>
                  {[visit.site_address, visit.site_town].filter((part) => part !== null && part !== "").join(", ")}
                  {stockDay !== null && stockDay > today ? ` · ${t("jb.stock.lands", { day: dayWords(f, stockDay) })}` : ` · ${t("jb.stock.in")}`}
                </span>
              </div>
            )
          )}

          <div className="crm-bk-head">{t("jb.bk.when")}</div>
          <div className="crm-bk-when">
            <div>
              <label className="crm-label" htmlFor="crm-jb-day">
                {t("jb.bk.date")}
              </label>
              <input id="crm-jb-day" {...(isAdd ? {} : { "data-autofocus": true })} className="crm-input crm-mono mr-fld" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
            </div>
            <div>
              <label className="crm-label" htmlFor="crm-jb-start">
                {t("jb.bk.start")}
              </label>
              <input id="crm-jb-start" className="crm-input crm-mono mr-fld" type="time" step={900} value={start} onChange={(event) => setStart(event.target.value)} />
            </div>
            <div>
              <label className="crm-label" htmlFor="crm-jb-hours">
                {t("jb.bk.hours")}
              </label>
              <input id="crm-jb-hours" className="crm-input crm-mono mr-fld" type="number" min={0.5} max={24} step={0.5} inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} />
            </div>
          </div>
          {isAdd && <p className="crm-field-note">{t("jb.bk.later")}</p>}

          <div className="crm-bk-head">{t("jb.bk.who")}</div>
          <div className="crm-field-pair">
            <div>
              <label className="crm-label" htmlFor="crm-jb-crew">
                {t("jb.bk.crew")}
              </label>
              <select id="crm-jb-crew" className="crm-input mr-fld" value={crewId ?? ""} onChange={(event) => setCrewId(event.target.value === "" ? null : Number(event.target.value))}>
                {facts.crews.map((one) => {
                  const people = crewPeople(facts, one.id).map((person) => firstName(person.name)).filter((name) => name !== "");
                  return (
                    <option key={one.id} value={one.id}>
                      {people.length === 0 ? one.name : `${one.name} · ${people.join(", ")}`}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="crm-label" htmlFor="crm-jb-size">
                {t("jb.bk.size")}
              </label>
              <input id="crm-jb-size" className="crm-input crm-mono mr-fld" type="number" min={1} max={20} step={1} value={size} onChange={(event) => setSize(event.target.value)} />
            </div>
          </div>

          {vans && booking_ && dayFacts !== null && (
            <VanDayField
              facts={dayFacts}
              crews={facts}
              crewId={crewId}
              day={day}
              today={today}
              here={here}
              value={vehicleId}
              changing={changingDay}
              onPick={(vehicle) => (setPick({ crewId, vehicle }), setVanRefused(null), setError(null))}
              onChange={() => (setChangingDay(true), setPick(dayRow === undefined ? null : { crewId, vehicle: dayRow.vehicle_id }))}
              refusal={vanRefusal}
              f={f}
              disabled={busy}
            />
          )}

          <label className="crm-label" htmlFor="crm-jb-note">
            {t("jb.bk.note")}
          </label>
          <textarea id="crm-jb-note" className="crm-input crm-textarea mr-fld" value={note} maxLength={400} rows={2} placeholder={t("jb.bk.note.hint")} onChange={(event) => setNote(event.target.value)} />

          {check?.refusal !== null && check?.refusal !== undefined && (
            <div className="crm-form-error" role="alert" data-testid="jb-refusal" data-kind={check.refusal.kind}>
              <Icon name="circle-slash" size={15} />
              <span>{refusalWords(check.refusal)}</span>
              {offer !== null && (
                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="jb-offer" onClick={() => setDay(offer)}>
                  {t("jb.bk.use", { day: dayWords(f, offer) })}
                </button>
              )}
            </div>
          )}
          {check?.over !== null && check?.over !== undefined && (
            <div className="crm-bk-flag" role="status" data-testid="jb-over">
              <Icon name="clock-alert" size={15} />
              <span>{`${t("jb.bk.over", { crew: crew?.name ?? "", hours: hoursOf(f, check.over.hours), of: hoursOf(f, check.over.of), day: dayWords(f, day) })} ${t("jb.bk.over.allowed")}`}</span>
            </div>
          )}
        </fieldset>
      )}

      {toldLine !== null && (
        <p className="crm-bk-told" data-testid="jb-told" data-mails={mails}>
          <Icon name="mail" size={15} />
          <span>{toldLine}</span>
        </p>
      )}
      {checking && (
        <p className="crm-field-note" role="status">
          {t("ui.checking")}
        </p>
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
