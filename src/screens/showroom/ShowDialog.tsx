/**
 * THE BOOKING DIALOG, in its second use: the showroom. Book a visitor, move a
 * booking, cancel one. The pattern of the site visits' dialog (P10): one
 * dialog, three modes, the time it had struck through on a move.
 *
 * A CLASH IS REFUSED BY THE SERVER (one booking per space at a time). This
 * dialog says it first, in its own words: it reads that space's live bookings
 * for the day and three weeks on, names the booking in the way and offers the
 * next clear time (B8). The server stays the last word for a race between two
 * desks, said as a plain line. The showroom's hours and a time already past
 * are this dialog's checks (the ruling of D4 Q1).
 *
 * WHAT IS SAVED. A booking carries a key made when the dialog opened, so a
 * lost reply makes one booking. It starts "to confirm" (the server's rule) and
 * is confirmed at once in a second write when "confirmed with the visitor" is
 * ticked. A move names the time, space and state the dialog read. A cancel
 * writes the why, lets the display stock promised to it go, then removes it.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { addDays, formatters, noonOf } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { readPassTo } from "../inbox/data.ts";
import { bookIn, cancelBooking, clashOf, hoursProblem, lastMove, moveBooking, nextClear, readSpaceDays, readWeek, spanOf, STEP_MINUTES, toldLine, visitorOf, weekdayOf, type Booking, type Space } from "./data.ts";

export type ShowBooking = { mode: "new" } | { mode: "move"; booking: Booking } | { mode: "cancel"; booking: Booking };

/** The lengths a visit to the showroom is booked for, in minutes. */
export const SHOW_LENGTHS = [30, 45, 60, 75, 90, 120, 180] as const;

interface ContactChoice extends Record<string, unknown> {
  id: number;
  name: string;
  company_id: number | null;
  company: string | null;
  email: string | null;
}

export function ShowDialog({ booking, spaces, names, onClose, onDone }: { booking: ShowBooking; spaces: Space[]; names: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  // The server's clock when the dialog opened: "tomorrow" and "has passed" are the business's, not the browser's.
  const [now] = useState(() => session.now());
  const held = booking.mode === "new" ? null : booking.booking;
  const isNew = booking.mode === "new";
  const isCancel = booking.mode === "cancel";
  const startWas = held === null ? null : new Date(held.starts_at);

  const [visitorMode, setVisitorMode] = useState<"contact" | "name">("contact");
  const [contactId, setContactId] = useState<number | null>(null);
  const [find, setFind] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [party, setParty] = useState(String(held?.party ?? 1));
  const [day, setDay] = useState(() => (startWas === null ? addDays(f.dayKey(now), 1) : f.dayKey(startWas)));
  const [time, setTime] = useState(() => (startWas === null ? "10:00" : f.time(startWas)));
  const [minutes, setMinutes] = useState<number>(held === null ? 60 : Number(held.minutes));
  const [spaceId, setSpaceId] = useState<number | null>(held?.space_id ?? spaces[0]?.id ?? null);
  const [repId, setRepId] = useState<string>(held?.rep_id ?? "");
  const [note, setNote] = useState(held?.note ?? "");
  const [confirm, setConfirm] = useState(true);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [round, setRound] = useState(0);
  // One key for this booking, for as long as the dialog is open.
  const key = useRef(newClientKey());

  const { load: weekLoad } = useLoad(() => readWeek(session), [session]);
  const week = weekLoad.state === "ready" ? weekLoad.data : null;
  // Who may be named as the rep who meets them: the people with a rep's profile where the reader may read those, else everybody who signs in here.
  const { load: repsLoad } = useLoad(() => (isCancel ? Promise.resolve([]) : readPassTo(session).then((people) => people)), [session, isCancel]);
  const reps = repsLoad.state === "ready" ? repsLoad.data : [];
  // Contacts, by name: the first fifty, or those whose name holds what was typed.
  const typed = find.trim();
  const { load: contactsLoad } = useLoad(
    () =>
      isNew && session.can("contacts", "read")
        ? session.list<ContactChoice>("contacts", { select: ["id", "name", "company_id", "email"], ...(typed.length >= 2 ? { q: typed } : {}), order: ["name"], lookup: ["company:company_id.name"], limit: 50 }).then((page) => page.rows)
        : Promise.resolve([] as ContactChoice[]),
    [session, isNew, typed.length >= 2 ? typed : ""],
  );
  const contacts = contactsLoad.state === "ready" ? contactsLoad.data : [];
  const [picked, setPicked] = useState<ContactChoice | null>(null);
  useEffect(() => {
    if (contactId === null) return;
    const found = contacts.find((one) => one.id === contactId);
    if (found !== undefined) setPicked(found);
  }, [contacts, contactId]);

  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const validTime = /^\d{2}:\d{2}$/.test(time) && validDay;
  const start = validTime ? f.at(day, time) : null;
  const draft = start === null || spaceId === null ? null : { ...(held === null ? {} : { id: held.id }), space_id: spaceId, starts_at: start.toISOString(), minutes };

  // That space's live bookings from the day asked, for as far as the next clear time is looked for.
  const { load: daysLoad } = useLoad(() => (isCancel || spaceId === null || !validDay ? Promise.resolve([] as Booking[]) : readSpaceDays(session, spaceId, day, f)), [session, isCancel, spaceId, day, f, round]);
  const spaceDays = daysLoad.state === "ready" ? daysLoad.data : [];
  const sameDay = spaceDays.filter((one) => one.id !== held?.id && f.dayKey(new Date(one.starts_at)) === day);

  const { load: moved } = useLoad(() => (held === null ? Promise.resolve(null) : lastMove(session, held.id).catch(() => null)), [session, held?.id]);
  const before = moved.state === "ready" ? moved.data : null;

  const spaceName = spaces.find((one) => one.id === spaceId)?.name ?? "";
  const passed = start !== null && start.getTime() < now.getTime();
  const hours = draft === null || week === null ? null : hoursProblem(draft, week, f);
  const clash = draft === null ? null : clashOf(draft, spaceDays);
  const blocked = passed || hours !== null || clash !== null;
  const offer = draft === null || week === null || !blocked || daysLoad.state !== "ready" ? null : nextClear(draft, spaceDays, week, now, f);
  const partyN = Number(party);
  const partyOk = Number.isInteger(partyN) && partyN >= 1 && partyN <= 50;
  const who = isNew ? (visitorMode === "contact" ? picked !== null && contactId !== null : visitorName.trim().length >= 2) : true;
  const changed =
    held === null ||
    startWas === null ||
    start === null ||
    start.getTime() !== startWas.getTime() ||
    minutes !== Number(held.minutes) ||
    spaceId !== held.space_id ||
    partyN !== Number(held.party) ||
    note.trim() !== (held.note ?? "") ||
    (repId === "" ? null : repId) !== held.rep_id;
  const ready = isCancel ? why.trim().length > 2 : who && partyOk && draft !== null && !blocked && changed && week !== null;

  const use = (at: Date): void => {
    setDay(f.dayKey(at));
    setTime(f.time(at));
    setError(null);
  };

  const visitor = held !== null ? visitorOf(held) : visitorMode === "contact" ? [picked?.company, picked?.name].filter(Boolean).join(", ") : visitorName.trim();
  const mailable = held !== null ? held.contact_id !== null && (held.contact_email ?? "") !== "" : visitorMode === "contact" && picked !== null && (picked.email ?? "") !== "";
  const timeMoved = startWas === null || start === null || start.getTime() !== startWas.getTime();
  const told = t(toldLine(isNew ? "new" : isCancel ? "cancel" : "move", week?.emails ?? "unknown", held?.state ?? (confirm ? "confirmed" : "tentative"), mailable, timeMoved, confirm), { who: visitor });

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
    if (isCancel && held !== null) {
      const done = await cancelBooking(session, held, why.trim());
      end();
      if (done.state === "refused") return setError(t("ui.refused", { reason: done.error.code === "DELETE_REFUSED" ? t("sh.cancel.refused.been") : reasonOf(done.error, t) }));
      if (done.state === "unknown") return setError(t("ui.unknown"));
      toasts.show(t("sh.toast.cancelled", { who: visitorOf(held), day: f.dayShort(new Date(held.starts_at)) }), "plain");
      onDone();
      return onClose();
    }
    if (start === null || spaceId === null) return end();
    const values = { space_id: spaceId, starts_at: start.toISOString(), minutes, party: partyN, rep_id: repId === "" ? null : repId, note: note.trim() === "" ? null : note.trim() };
    const refusal = (code: string, fallback: string): string => (code === "BOOKING_TAKEN" ? t("sh.refused.taken") : fallback);
    if (held === null) {
      const { made, confirmed } = await bookIn(
        session,
        { ...values, contact_id: visitorMode === "contact" ? contactId : null, company_id: visitorMode === "contact" ? (picked?.company_id ?? null) : null, visitor_name: visitorMode === "name" ? visitorName.trim() : null },
        key.current,
        confirm,
      );
      end();
      if (made.state === "refused") {
        if (made.error.code === "BOOKING_TAKEN") setRound((n) => n + 1);
        const fields = made.error.fields ?? {};
        return setError(t("ui.refused", { reason: fields["note"] !== undefined ? t("sh.refused.note") : refusal(made.error.code, reasonOf(made.error, t)) }));
      }
      if (made.state === "unknown") return setError(t("ui.unknown"));
      const said = { who: visitor, space: spaceName, day: f.dayShort(start), time: f.time(start) };
      // The booking is in; only its confirmation did not go: say both, and leave "Confirm it" on the list.
      if (confirmed !== null && confirmed.state !== "saved") toasts.show(t("sh.toast.bookedNotConfirmed", said), "danger", true);
      else toasts.show(t(confirm ? "sh.toast.booked" : "sh.toast.pencilled", said), "pos");
      onDone();
      return onClose();
    }
    const saved = await moveBooking(session, held, values);
    end();
    if (saved.state === "refused") {
      if (saved.error.code === "BOOKING_TAKEN") setRound((n) => n + 1);
      return setError(t("ui.refused", { reason: refusal(saved.error.code, reasonOf(saved.error, t)) }));
    }
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t("sh.toast.moved", { who: visitorOf(held), space: spaceName, day: f.dayShort(start), time: f.time(start) }), "pos");
    onDone();
    onClose();
  };

  const dayWords = validDay ? f.dayShort(noonOf(day)) : "";
  const refusals: { text: string; testid: string }[] = [];
  if (passed) refusals.push({ text: t("sh.check.passed"), testid: "passed" });
  else if (hours === "closed") refusals.push({ text: t("sh.check.closed", { day: f.weekdayLong(noonOf(day)) }), testid: "closed" });
  else if (hours === "hours" && week !== null) refusals.push({ text: t("sh.check.hours", { opens: week.opens, closes: week.closes }), testid: "hours" });
  else if (clash !== null) refusals.push({ text: t("sh.check.taken", { space: spaceName, span: spanOf(clash, f), day: f.dayShort(new Date(clash.starts_at)), who: visitorOf(clash) || t("sh.visitor.new") }), testid: "taken" });

  return (
    <Dialog
      shape="box"
      name={`show-${booking.mode}`}
      icon={isCancel ? "calendar-x" : "store"}
      title={t(isNew ? "sh.book.title" : isCancel ? "sh.cancel.title" : "sh.move.title")}
      subtitle={t(isNew ? "sh.book.sub" : isCancel ? "sh.cancel.sub" : "sh.move.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t(isCancel ? "sh.cancel.keep" : "ui.close")}
          </button>
          <button type="button" className={`crm-btn crm-btn-44 crm-btn-wide mr-btn ${isCancel ? "crm-btn-danger" : "crm-btn-primary"}`} data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t(isNew ? "sh.book.go" : isCancel ? "sh.cancel.go" : "sh.move.go")}
          </button>
        </>
      }
    >
      {held !== null && !isCancel && startWas !== null && (
        <div className="crm-bk-was" data-testid="sh-was">
          <span className="crm-bk-head">{t("sh.was")}</span>
          <s className="crm-mono">
            {f.dayShort(startWas)}, <span dir="ltr">{spanOf(held, f)}</span> · {held.space ?? ""}
          </s>
        </div>
      )}
      {held !== null && before !== null && (
        <p className="crm-bk-history" data-testid="sh-history">
          <Icon name="history" size={14} />
          <span>
            {t(before.by === null || before.by === "" ? "sh.history.moved.nobody" : "sh.history.moved", {
              was: `${f.dayShort(before.was)}, ${f.time(before.was)}`,
              who: before.by ?? "",
              when: `${f.dayShort(before.at)}, ${f.time(before.at)}`,
            })}
          </span>
        </p>
      )}

      {isCancel && held !== null ? (
        <>
          <div className="crm-bk-sum">
            <strong>
              {visitorOf(held) || t("sh.visitor.new")} · {held.space}
            </strong>
            <span className="crm-mono">
              {f.dayShort(new Date(held.starts_at))}, <span dir="ltr">{spanOf(held, f)}</span>
            </span>
          </div>
          <label className="crm-label" htmlFor="crm-sh-why">
            {t("sh.cancel.why")}
          </label>
          <input
            id="crm-sh-why"
            data-autofocus
            className="crm-input mr-fld"
            value={why}
            maxLength={200}
            disabled={busy}
            placeholder={t("sh.cancel.why.hint")}
            onChange={(event) => (setWhy(event.target.value), setError(null))}
            onKeyDown={(event) => {
              if (event.key === "Enter") void go();
            }}
          />
        </>
      ) : (
        <div className="crm-bk-grid">
          <fieldset className="crm-fields crm-bk-form" disabled={busy}>
            <div className="crm-bk-head">{t("sh.book.for")}</div>
            {isNew ? (
              <>
                <div className="crm-chips crm-sh-mode" role="group" aria-label={t("sh.book.for")}>
                  {(["contact", "name"] as const).map((one) => (
                    <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={visitorMode === one} data-mode={one} onClick={() => (setVisitorMode(one), setError(null))}>
                      {t(one === "contact" ? "sh.book.mode.contact" : "sh.book.mode.name")}
                    </button>
                  ))}
                </div>
                {visitorMode === "contact" ? (
                  <div className="crm-field-pair">
                    <div>
                      <label className="crm-label" htmlFor="crm-sh-find">
                        {t("sh.book.find")}
                      </label>
                      <input id="crm-sh-find" data-autofocus className="crm-input mr-fld" value={find} placeholder={t("sh.book.find.hint")} onChange={(event) => setFind(event.target.value)} />
                    </div>
                    <div>
                      <label className="crm-label" htmlFor="crm-sh-contact">
                        {t("sh.book.visitor")}
                      </label>
                      <select
                        id="crm-sh-contact"
                        className="crm-input mr-fld"
                        value={contactId ?? ""}
                        onChange={(event) => {
                          const id = event.target.value === "" ? null : Number(event.target.value);
                          setContactId(id);
                          setPicked(contacts.find((one) => one.id === id) ?? null);
                          setError(null);
                        }}
                      >
                        <option value="">{t(contactsLoad.state === "ready" && contacts.length === 0 ? "sh.book.visitor.none" : "sh.book.visitor.pick")}</option>
                        {picked !== null && !contacts.some((one) => one.id === picked.id) && <option value={picked.id}>{picked.company === null ? picked.name : `${picked.name} · ${picked.company}`}</option>}
                        {contacts.map((one) => (
                          <option key={one.id} value={one.id}>
                            {one.company === null ? one.name : `${one.name} · ${one.company}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="crm-label" htmlFor="crm-sh-name">
                      {t("sh.book.name")}
                    </label>
                    <input id="crm-sh-name" data-autofocus className="crm-input mr-fld" value={visitorName} maxLength={120} placeholder={t("sh.book.name.hint")} onChange={(event) => (setVisitorName(event.target.value), setError(null))} />
                  </>
                )}
              </>
            ) : (
              <div className="crm-bk-fixed" data-testid="sh-visitor">
                {visitorOf(held!) || t("sh.visitor.new")}
              </div>
            )}

            <div className="crm-bk-head">{t("sh.book.when")}</div>
            <div className="crm-bk-when">
              <div>
                <label className="crm-label" htmlFor="crm-sh-day">
                  {t("sh.book.date")}
                </label>
                <input id="crm-sh-day" {...(isNew ? {} : { "data-autofocus": true })} className="crm-input crm-mono mr-fld" type="date" value={day} onChange={(event) => (setDay(event.target.value), setError(null))} />
              </div>
              <div>
                <label className="crm-label" htmlFor="crm-sh-time">
                  {t("sh.book.start")}
                </label>
                <input id="crm-sh-time" className="crm-input crm-mono mr-fld" type="time" step={STEP_MINUTES * 60} value={time} onChange={(event) => (setTime(event.target.value), setError(null))} />
              </div>
              <div>
                <label className="crm-label" htmlFor="crm-sh-mins">
                  {t("sh.book.length")}
                </label>
                <select id="crm-sh-mins" className="crm-input crm-mono mr-fld" value={minutes} onChange={(event) => (setMinutes(Number(event.target.value)), setError(null))}>
                  {[...new Set([...SHOW_LENGTHS, minutes])]
                    .sort((a, b) => a - b)
                    .map((length) => (
                      <option key={length} value={length}>
                        {t("sh.minutes", { count: f.number(length) })}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="crm-bk-head">{t("sh.book.who")}</div>
            <div className="crm-field-pair">
              <div>
                <label className="crm-label" htmlFor="crm-sh-space">
                  {t("sh.book.space")}
                </label>
                <select id="crm-sh-space" className="crm-input mr-fld" value={spaceId ?? ""} onChange={(event) => (setSpaceId(event.target.value === "" ? null : Number(event.target.value)), setError(null))}>
                  {spaces.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="crm-label" htmlFor="crm-sh-party">
                  {t("sh.book.party")}
                </label>
                <input id="crm-sh-party" className="crm-input crm-mono mr-fld" type="number" min={1} max={50} inputMode="numeric" value={party} aria-invalid={!partyOk} onChange={(event) => setParty(event.target.value)} />
              </div>
            </div>
            <label className="crm-label" htmlFor="crm-sh-rep">
              {t("sh.book.rep")}
            </label>
            <select id="crm-sh-rep" className="crm-input mr-fld" value={repId} onChange={(event) => setRepId(event.target.value)}>
              <option value="">{t("sh.book.rep.none")}</option>
              {repId !== "" && !reps.some((rep) => rep.id === repId) && <option value={repId}>{names[repId] ?? repId}</option>}
              {reps.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.name}
                </option>
              ))}
            </select>

            <label className="crm-label" htmlFor="crm-sh-note">
              {t("sh.book.note")}
            </label>
            <textarea id="crm-sh-note" className="crm-input crm-textarea mr-fld" value={note} maxLength={400} rows={2} placeholder={t("sh.book.note.hint")} onChange={(event) => (setNote(event.target.value), setError(null))} />

            {isNew && (
              <label className="crm-sh-confirm">
                <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
                <span>{t("sh.book.confirmed")}</span>
              </label>
            )}

            {refusals.map((one) => (
              <div key={one.testid} className="crm-form-error crm-sh-refusal" role="alert" data-check={one.testid}>
                <Icon name="circle-slash" size={15} />
                <span>{one.text}</span>
                {offer !== null ? (
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="sh-offer" onClick={() => use(offer)}>
                    {t("sh.check.use", { day: f.dayShort(offer), time: f.time(offer) })}
                  </button>
                ) : (
                  daysLoad.state === "ready" && week !== null && <em>{t("sh.check.none")}</em>
                )}
              </div>
            ))}
          </fieldset>

          <aside className="crm-bk-others" aria-label={t("sh.others.head", { space: spaceName, day: dayWords })}>
            <div className="crm-bk-head">{t("sh.others.head", { space: spaceName, day: dayWords })}</div>
            {sameDay.map((one) => {
              const hit = draft !== null && clash !== null && clash.id === one.id;
              return (
                <div key={one.id} className="crm-bk-other" data-clash={hit ? "1" : "0"}>
                  <div className="crm-mono" dir="ltr">
                    {spanOf(one, f)}
                  </div>
                  <strong>{visitorOf(one) || t("sh.visitor.new")}</strong>
                  {one.note !== null && <span>{one.note}</span>}
                  {hit && <em>{t("sh.others.inTheWay")}</em>}
                </div>
              );
            })}
            {daysLoad.state === "ready" && sameDay.length === 0 && <div className="crm-bk-none">{t("sh.others.none")}</div>}
            {week !== null && (
              <div className="crm-bk-none crm-sh-hours">
                {t("sh.others.hours", { opens: week.opens, closes: week.closes })}
                {validDay && !week.days.has(weekdayOf(day)) ? ` · ${t("sh.others.closedDay")}` : ""}
              </div>
            )}
          </aside>
        </div>
      )}

      <p className="crm-bk-told" data-testid="sh-told" data-mails={week?.emails ?? "reading"}>
        <Icon name="mail" size={15} />
        <span>{told}</span>
      </p>
      {checking && (
        <p className="crm-field-note" role="status">
          {t("ui.checking")}
        </p>
      )}
      {error !== null && (
        <div className="crm-form-error" role="alert" data-testid="sh-error">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
