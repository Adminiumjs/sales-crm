/**
 * THE BOOKING DIALOG, in its first use: a site visit. Book one, move one,
 * cancel one. (The same pattern takes showroom bookings and visits to a job
 * when those parts get their screens.)
 *
 * WHAT THE SERVER HOLDS, whatever this dialog offers: a rep books for
 * herself, on a deal she opens; a manager for the people she leads; a visit
 * is moved and cancelled by the rep it names or who leads her; a visit that
 * was made or written up is not removed; a rep's two visits never overlap
 * (plan 68 X7: the dialog shows the one in the way and books nothing over
 * it, and a clash it could not see is the server's refusal, said in words).
 * "That time has passed": the dialog books nothing in the past, and the
 * server refuses a new visit that starts before now (plan 68 X7, D18), said
 * in words; a visit brought in from a file (history) is not held to it.
 *
 * WHAT IS SAVED. A booking carries a key made when the dialog opened, so a
 * reply lost on the way back is sent again and makes one visit. A move names
 * the time the dialog read, so a visit a colleague moved in between is not
 * written over. A cancel writes the why, then removes the visit.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { addDays, formatters, noonOf } from "../../lib/format.ts";
import { scopeOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { newClientKey, type StaffSession } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { cancelVisit, lastMove, LENGTHS, overlaps, readDay, readVisitMails, spanOf, toldLine, type Visit, type VisitMails } from "./data.ts";

export type Booking = { mode: "new"; dealId?: number } | { mode: "move"; visit: Visit } | { mode: "cancel"; visit: Visit };

interface DealChoice extends Record<string, unknown> {
  id: number;
  name: string;
  company_id: number | null;
  contact_id: number | null;
  owner_id: string | null;
  company: string | null;
}
interface ContactChoice extends Record<string, unknown> {
  id: number;
  name: string;
  job_title: string | null;
}
interface Person {
  id: string;
  name: string;
}

async function readChoices(session: StaffSession, picksRep: boolean): Promise<{ deals: DealChoice[]; reps: Person[] }> {
  const [deals, reps, people] = await Promise.all([
    session.list<DealChoice>("deals", { select: ["id", "name", "company_id", "contact_id", "owner_id"], where: { column: "state", op: "eq", value: "open" }, lookup: ["company:company_id.name"], order: ["name"], limit: 200 }),
    picksRep && session.can("reps", "read") ? session.list<{ user_id: string }>("reps", { select: ["user_id"], limit: 200 }).then((page) => page.rows.map((row) => row.user_id)) : Promise.resolve([] as string[]),
    picksRep ? session.people(undefined, 200).catch(() => []) : Promise.resolve([]),
  ]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  return { deals: deals.rows, reps: reps.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })) };
}

export function BookingDialog({ booking, names, onClose, onDone }: { booking: Booking; names: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  // The server's clock when the dialog opened: "tomorrow" and "has passed" are the business's, not the browser's.
  const [now] = useState(() => session.now());
  const me = config.user;
  const visit = booking.mode === "new" ? null : booking.visit;
  const isNew = booking.mode === "new";
  const isCancel = booking.mode === "cancel";
  // A rep books for herself; whoever reads the team says who goes (the server holds a manager to the people she leads).
  const picksRep = isNew && scopeOf(session) === "team";

  const startWas = visit === null ? null : new Date(visit.starts_at);
  const [dealId, setDealId] = useState<number | null>(visit?.deal_id ?? (booking.mode === "new" ? (booking.dealId ?? null) : null));
  const [contactId, setContactId] = useState<number | null>(visit?.contact_id ?? null);
  const [purpose, setPurpose] = useState(visit?.purpose ?? "");
  const [day, setDay] = useState(() => (startWas === null ? addDays(f.dayKey(now), 1) : f.dayKey(startWas)));
  const [time, setTime] = useState(() => (startWas === null ? "10:00" : f.time(startWas)));
  const [minutes, setMinutes] = useState<number>(visit === null ? 60 : Number(visit.minutes));
  const [repId, setRepId] = useState<string>(visit?.rep_id ?? me?.id ?? "");
  const [note, setNote] = useState(visit?.note ?? "");
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  // One key for this booking, for as long as the dialog is open.
  const key = useRef(newClientKey());

  const { load: choices } = useLoad(() => (isNew ? readChoices(session, picksRep) : Promise.resolve({ deals: [] as DealChoice[], reps: [] as Person[] })), [session, isNew, picksRep]);
  const deals = choices.state === "ready" ? choices.data.deals : [];
  const reps = choices.state === "ready" ? choices.data.reps : [];
  const deal = deals.find((one) => one.id === dealId) ?? null;
  const companyId = deal?.company_id ?? null;

  // The first rep is offered to somebody who is not one herself.
  useEffect(() => {
    if (picksRep && reps.length > 0 && !reps.some((rep) => rep.id === repId)) setRepId(reps[0]!.id);
  }, [picksRep, reps, repId]);

  const { load: people } = useLoad(
    () => (isNew && companyId !== null ? session.list<ContactChoice>("contacts", { select: ["id", "name", "job_title"], where: { column: "company_id", op: "eq", value: companyId }, order: ["name"], limit: 100 }).then((page) => page.rows) : Promise.resolve([] as ContactChoice[])),
    [session, isNew, companyId],
  );
  const contacts = people.state === "ready" ? people.data : [];
  // Picking a deal offers its own contact first, else the first of the company's.
  useEffect(() => {
    if (!isNew || people.state !== "ready") return;
    if (contacts.length === 0) return setContactId(null);
    if (!contacts.some((one) => one.id === contactId)) setContactId(contacts.find((one) => one.id === deal?.contact_id)?.id ?? contacts[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the company's contacts arrive
  }, [people]);

  const validTime = /^\d{2}:\d{2}$/.test(time) && /^\d{4}-\d{2}-\d{2}$/.test(day);
  const start = validTime ? f.at(day, time) : null;
  const drafted = start === null ? null : { starts_at: start.toISOString(), minutes };

  // The rep's other visits that day, read as the person signed in reads them.
  const { load: others } = useLoad(
    () => (isCancel || repId === "" || !/^\d{4}-\d{2}-\d{2}$/.test(day) ? Promise.resolve([] as Visit[]) : readDay(session, repId, day, f)),
    [session, isCancel, repId, day, f],
  );
  const sameDay = (others.state === "ready" ? others.data : []).filter((one) => one.id !== visit?.id);
  const clashes = drafted === null ? [] : sameDay.filter((one) => overlaps(drafted, one));

  // Whether the customer's e-mails are switched on, read once as the dialog opens.
  const { load: mails } = useLoad<VisitMails>(() => readVisitMails(session), [session]);

  // What the record's history says of an earlier move.
  const { load: moved } = useLoad(() => (visit === null ? Promise.resolve(null) : lastMove(session, visit.id).catch(() => null)), [session, visit?.id]);
  const before = moved.state === "ready" ? moved.data : null;

  const repName = names[repId] ?? reps.find((rep) => rep.id === repId)?.name ?? (repId === me?.id ? me.name : "");
  const company = visit?.company ?? deal?.company ?? "";
  const contactName = visit !== null ? (visit.contact ?? "") : (contacts.find((one) => one.id === contactId)?.name ?? "");
  const passed = start !== null && start.getTime() < now.getTime();
  const changed = visit === null || startWas === null || start === null || start.getTime() !== startWas.getTime() || minutes !== Number(visit.minutes) || purpose.trim() !== visit.purpose || note.trim() !== (visit.note ?? "");
  const ready = isCancel ? why.trim().length > 2 : dealId !== null && purpose.trim() !== "" && repId !== "" && start !== null && !passed && clashes.length === 0 && changed && (!isNew || contacts.length === 0 || contactId !== null);

  const refusal = (status: number, fallback: string): string => (status === 409 ? t("visits.book.refused.kept") : fallback);

  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    const slow = setTimeout(() => setChecking(true), 1200);
    const end = (): void => {
      clearTimeout(slow);
      setChecking(false);
      setBusy(false);
    };
    if (isCancel && visit !== null) {
      const done = await cancelVisit(session, visit, why.trim());
      end();
      if (done.state === "refused") return setError(t("ui.refused", { reason: refusal(done.error.status, reasonOf(done.error, t)) }));
      if (done.state === "unknown") return setError(t("ui.unknown"));
      toasts.show(t("visits.toast.cancelled", { company: visit.company ?? "", day: f.dayShort(new Date(visit.starts_at)) }), "plain");
      onDone();
      return onClose();
    }
    if (start === null || dealId === null) return end();
    const saved =
      visit === null
        ? await session.create<Visit>("site_visits", { deal_id: dealId, contact_id: contactId, rep_id: repId, starts_at: start.toISOString(), minutes, purpose: purpose.trim(), note: note.trim() === "" ? null : note.trim() }, key.current)
        : await session.update<Visit>("site_visits", visit.id, { starts_at: start.toISOString(), minutes, purpose: purpose.trim(), note: note.trim() === "" ? null : note.trim() }, { seen: { starts_at: visit.starts_at, minutes: visit.minutes, state: "booked" } });
    end();
    if (saved.state === "refused") {
      const fields = saved.error.fields;
      const reason =
        saved.error.code === "BOOKING_TAKEN"
          ? t("visits.book.refused.taken", { rep: firstName(repName) })
          : fields["starts_at"] === "out-of-range"
            ? t("guards.visit.past")
            : fields["rep_id"] !== undefined
            ? t("visits.book.refused.rep")
            : fields["deal_id"] !== undefined || saved.error.code === "FK_VIOLATION"
              ? t("visits.book.refused.deal")
              : reasonOf(saved.error, t);
      return setError(t("ui.refused", { reason }));
    }
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t(visit === null ? "visits.toast.booked" : "visits.toast.moved", { company, day: f.dayShort(start), time: f.time(start), rep: firstName(repName) }), "pos");
    onDone();
    onClose();
  };

  // What the customer is told is the server's doing (three e-mails of the outbox, one switch in the settings): the line says which.
  const timeMoved = startWas === null || start === null || start.getTime() !== startWas.getTime();
  const told = t(toldLine(isNew ? "new" : isCancel ? "cancel" : "move", mails.state === "ready" ? mails.data : "unknown", contactName !== "", timeMoved), { contact: contactName === "" ? company : contactName });
  const dayWords = /^\d{4}-\d{2}-\d{2}$/.test(day) ? f.dayShort(noonOf(day)) : "";

  return (
    <Dialog
      shape="box"
      name={`visit-${booking.mode}`}
      icon={isCancel ? "calendar-x" : "map-pin"}
      title={t(isNew ? "visits.book.title" : isCancel ? "visits.cancel.title" : "visits.move.title")}
      subtitle={t(isNew ? "visits.book.sub" : isCancel ? "visits.cancel.sub" : "visits.move.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t(isCancel ? "visits.cancel.keep" : "ui.close")}
          </button>
          <button type="button" className={`crm-btn crm-btn-44 crm-btn-wide mr-btn ${isCancel ? "crm-btn-danger" : "crm-btn-primary"}`} data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t(isNew ? "visits.book.go" : isCancel ? "visits.cancel.go" : "visits.move.go")}
          </button>
        </>
      }
    >
      {visit !== null && !isCancel && startWas !== null && (
        <div className="crm-bk-was" data-testid="bk-was">
          <span className="crm-bk-head">{t("visits.was")}</span>
          <s className="crm-mono">
            {f.dayShort(startWas)}, <span dir="ltr">{spanOf(visit, f)}</span> · {firstName(names[visit.rep_id] ?? "")}
          </s>
        </div>
      )}
      {visit !== null && before !== null && (
        <p className="crm-bk-history" data-testid="bk-history">
          <Icon name="history" size={14} />
          <span>
            {t(before.by === null || before.by === "" ? "visits.history.moved.nobody" : "visits.history.moved", {
              was: `${f.dayShort(before.was)}, ${f.time(before.was)}`,
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
              {visit.company} · {visit.purpose}
            </strong>
            <span className="crm-mono">
              {f.dayShort(new Date(visit.starts_at))}, <span dir="ltr">{spanOf(visit, f)}</span> · {firstName(names[visit.rep_id] ?? "")}
            </span>
          </div>
          <label className="crm-label" htmlFor="crm-bk-why">
            {t("visits.cancel.why")}
          </label>
          <input
            id="crm-bk-why"
            data-autofocus
            className="crm-input mr-fld"
            value={why}
            maxLength={200}
            disabled={busy}
            placeholder={t("visits.cancel.why.hint")}
            onChange={(event) => (setWhy(event.target.value), setError(null))}
            onKeyDown={(event) => {
              if (event.key === "Enter") void go();
            }}
          />
        </>
      ) : (
        <div className="crm-bk-grid">
          <fieldset className="crm-fields crm-bk-form" disabled={busy}>
            <div className="crm-bk-head">{t("visits.book.for")}</div>
            {isNew ? (
              <>
                <label className="crm-label" htmlFor="crm-bk-deal">
                  {t("visits.book.deal")}
                </label>
                <select id="crm-bk-deal" data-autofocus className="crm-input mr-fld" value={dealId ?? ""} onChange={(event) => (setDealId(event.target.value === "" ? null : Number(event.target.value)), setError(null))}>
                  <option value="">{t(choices.state === "ready" && deals.length === 0 ? "visits.book.deal.none" : "visits.book.deal.pick")}</option>
                  {deals.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.company === null ? one.name : `${one.company} · ${one.name}`}
                    </option>
                  ))}
                </select>
                <div className="crm-field-pair">
                  <div>
                    <label className="crm-label" htmlFor="crm-bk-contact">
                      {t("visits.book.contact")}
                    </label>
                    <select id="crm-bk-contact" className="crm-input mr-fld" value={contactId ?? ""} disabled={contacts.length === 0} onChange={(event) => setContactId(event.target.value === "" ? null : Number(event.target.value))}>
                      {contacts.length === 0 && <option value="">{t(dealId === null ? "visits.book.contact.first" : "visits.book.contact.none")}</option>}
                      {contacts.map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.job_title === null || one.job_title === "" ? one.name : `${one.name} · ${one.job_title}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="crm-label" htmlFor="crm-bk-purpose">
                      {t("visits.book.purpose")}
                    </label>
                    <input id="crm-bk-purpose" className="crm-input mr-fld" value={purpose} maxLength={200} placeholder={t("visits.book.purpose.hint")} onChange={(event) => (setPurpose(event.target.value), setError(null))} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="crm-bk-fixed">
                  {visit?.company} · {visit?.deal}
                  {contactName !== "" && <span>{contactName}</span>}
                </div>
                <label className="crm-label" htmlFor="crm-bk-purpose">
                  {t("visits.book.purpose")}
                </label>
                <input id="crm-bk-purpose" className="crm-input mr-fld" value={purpose} maxLength={200} onChange={(event) => (setPurpose(event.target.value), setError(null))} />
              </>
            )}

            <div className="crm-bk-head">{t("visits.book.when")}</div>
            <div className="crm-bk-when">
              <div>
                <label className="crm-label" htmlFor="crm-bk-day">
                  {t("visits.book.date")}
                </label>
                <input id="crm-bk-day" {...(isNew ? {} : { "data-autofocus": true })} className="crm-input crm-mono mr-fld" type="date" value={day} onChange={(event) => (setDay(event.target.value), setError(null))} />
              </div>
              <div>
                <label className="crm-label" htmlFor="crm-bk-time">
                  {t("visits.book.start")}
                </label>
                <input id="crm-bk-time" className="crm-input crm-mono mr-fld" type="time" step={900} value={time} onChange={(event) => (setTime(event.target.value), setError(null))} />
              </div>
              <div>
                <label className="crm-label" htmlFor="crm-bk-mins">
                  {t("visits.book.length")}
                </label>
                <select id="crm-bk-mins" className="crm-input crm-mono mr-fld" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
                  {[...new Set([...LENGTHS, minutes])]
                    .sort((a, b) => a - b)
                    .map((length) => (
                      <option key={length} value={length}>
                        {t("visits.minutes", { count: f.number(length) })}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="crm-bk-head">{t("visits.book.who")}</div>
            {picksRep && reps.length > 0 ? (
              <>
                <label className="crm-label" htmlFor="crm-bk-rep">
                  {t("visits.book.rep")}
                </label>
                <select id="crm-bk-rep" className="crm-input mr-fld" value={repId} onChange={(event) => (setRepId(event.target.value), setError(null))}>
                  {reps.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <div className="crm-bk-fixed" data-testid="bk-rep">
                {repName}
                <span>{t(isNew ? "visits.book.rep.self" : "visits.book.rep.fixed")}</span>
              </div>
            )}

            <label className="crm-label" htmlFor="crm-bk-note">
              {t("visits.book.note")}
            </label>
            <textarea id="crm-bk-note" className="crm-input crm-textarea mr-fld" value={note} maxLength={400} rows={2} placeholder={t("visits.book.note.hint")} onChange={(event) => setNote(event.target.value)} />

            {passed && (
              <div className="crm-form-error" role="alert">
                <Icon name="circle-slash" size={15} />
                <span>{t("visits.book.passed")}</span>
              </div>
            )}
            {clashes.length > 0 && (
              <div className="crm-bk-flag" role="status">
                <Icon name="clock-alert" size={15} />
                <span>{t("visits.book.overlap", { rep: firstName(repName) }, clashes.length)}</span>
              </div>
            )}
          </fieldset>

          <aside className="crm-bk-others" aria-label={t("visits.others.head", { rep: firstName(repName), day: dayWords })}>
            <div className="crm-bk-head">{t("visits.others.head", { rep: firstName(repName), day: dayWords })}</div>
            {sameDay.map((one) => {
              const clash = drafted !== null && overlaps(drafted, one);
              return (
                <div key={one.id} className="crm-bk-other" data-clash={clash ? "1" : "0"}>
                  <div className="crm-mono" dir="ltr">
                    {spanOf(one, f)}
                  </div>
                  <strong>{one.company}</strong>
                  <span>{one.purpose}</span>
                  {clash && <em>{t("visits.others.overlaps")}</em>}
                </div>
              );
            })}
            {others.state === "ready" && sameDay.length === 0 && <div className="crm-bk-none">{t("visits.others.none")}</div>}
          </aside>
        </div>
      )}

      <p className="crm-bk-told" data-testid="bk-told" data-mails={mails.state === "ready" ? mails.data : "reading"}>
        <Icon name="mail" size={15} />
        <span>{told}</span>
      </p>
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
