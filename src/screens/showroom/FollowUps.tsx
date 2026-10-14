/**
 * SHOWROOM FOLLOW-UPS (ledger screen 55): they came in, and what happened
 * next. Each booking somebody came in for, newest first, with its write-up
 * (how it went, the next step and by when) and the deal it is for.
 *
 * The three counts are the server's. "Next step promised N days after the
 * visit, on average" is not drawn: it would add up the rows in the browser
 * (decision 90's rule). Live to a colleague's change.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { useScreen } from "../team/data.ts";
import { readNames } from "../visits/data.ts";
import { nextStepDone, readFollowUps, writeUp, type Booking } from "./data.ts";

export function FollowUps(_props: ScreenProps) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, opens } = useScreen();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => readFollowUps(session, now, f), [session, today, f]);
  const { load: people } = useLoad(() => readNames(session), [session]);
  const names = people.state === "ready" ? people.data : {};
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["showroom_bookings"], again);
  const canWrite = session.can("showroom_bookings", "update");
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const markDone = async (booking: Booking): Promise<void> => {
    setBusy(booking.id);
    await toasts.say(nextStepDone(session, booking, today), () => t("sh.fu.toast.done"));
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-sh mr-screen" data-screen="showfollow">
      <div className="crm-screen-head">
        <div>
          <h1>{t("sh.fu.title")}</h1>
          <p className="crm-screen-sub">{t("sh.fu.sub")}</p>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
        {(data) => {
          const missing = data.rows.filter((row) => row.outcome === null);
          return (
            <>
              <div className="crm-sh-stats">
                <div className="crm-sh-stat mr-card" data-stat="been">
                  <div className="crm-kpi-label">{t("sh.fu.stat.been")}</div>
                  <div className="crm-sh-value crm-mono">{f.number(data.counts.been)}</div>
                  <div className="crm-sh-stat-note">{t("sh.fu.stat.been.note")}</div>
                </div>
                <div className="crm-sh-stat mr-card" data-stat="written" data-tone={data.counts.written === data.counts.been ? "pos" : "warn"}>
                  <div className="crm-kpi-label">{t("sh.fu.stat.written")}</div>
                  <div className="crm-sh-value crm-mono">{t("sh.fu.stat.of", { n: f.number(data.counts.written), of: f.number(data.counts.been) })}</div>
                  <div className="crm-sh-stat-note">
                    {data.counts.been - data.counts.written === 0 ? t("sh.fu.stat.written.all") : t("sh.fu.stat.written.blank", { count: f.number(data.counts.been - data.counts.written) }, data.counts.been - data.counts.written)}
                  </div>
                </div>
                <div className="crm-sh-stat mr-card" data-stat="late" data-tone={data.counts.late > 0 ? "danger" : "pos"}>
                  <div className="crm-kpi-label">{t("sh.fu.stat.late")}</div>
                  <div className="crm-sh-value crm-mono">{f.number(data.counts.late)}</div>
                  <div className="crm-sh-stat-note">{t("sh.fu.stat.late.note", { count: f.number(data.counts.done) }, data.counts.done)}</div>
                </div>
              </div>

              {missing.length > 0 && (
                <div className="crm-banner crm-sh-banner" data-tone="warn" data-testid="sh-fu-missing">
                  <Icon name="pencil" size={15} />
                  <span>{missing.length === 1 ? t("sh.fu.missing.one", { company: missing[0]!.company ?? missing[0]!.visitor_name ?? "" }) : t("sh.fu.missing", { count: f.number(missing.length) }, missing.length)}</span>
                </div>
              )}

              <ul className="crm-sh-list crm-sh-fu">
                {data.rows.map((booking) => {
                  const at = new Date(booking.starts_at);
                  const ago = f.dayDiff(at, now);
                  const by = booking.next_step_by === null ? null : new Date(`${booking.next_step_by}T12:00:00Z`);
                  const done = booking.next_step_done_on !== null;
                  const late = !done && by !== null && booking.next_step_by! < today;
                  const rep = booking.rep_id === null ? "" : (names[booking.rep_id] ?? "");
                  const name = booking.company ?? booking.visitor_name ?? "";
                  const tone = booking.outcome === null ? "warn" : done ? "pos" : late ? "danger" : "accent";
                  return (
                    <li key={booking.id} className="crm-sh-card mr-card" data-booking={booking.id} data-tone={tone}>
                      <div className="crm-sh-card-top">
                        <span className="crm-avatar crm-sh-tile" aria-hidden="true">
                          {initials(name)}
                        </span>
                        <div className="crm-sh-main">
                          <div className="crm-sh-fu-head">
                            {booking.company_id !== null && opens("companies") ? (
                              <ScreenLink to="companies" rest={[booking.company_id]} className="crm-sh-name">
                                {name}
                              </ScreenLink>
                            ) : (
                              <span className="crm-sh-name">{name}</span>
                            )}
                            <span className="crm-pill crm-sh-space-pill">{booking.space}</span>
                            <span className="crm-mono crm-sh-ago">{ago === 0 ? t("sh.day.today") : ago === 1 ? t("sh.day.yesterday") : t("sh.day.ago", { count: f.number(ago) }, ago)}</span>
                          </div>
                          <div className="crm-sh-who">
                            {[booking.contact ?? booking.visitor_name, booking.note === null ? null : t("sh.fu.saw", { what: booking.note })].filter((part) => part !== null && part !== "").join(" · ")}
                          </div>
                          {booking.outcome !== null && <p className="crm-sh-see">{booking.outcome}</p>}
                        </div>
                        {rep !== "" && (
                          <span className="crm-sh-rep">
                            <span className="crm-avatar crm-avatar-sm" data-tone="accent" aria-hidden="true">
                              {initials(rep)}
                            </span>
                            {firstName(rep)}
                          </span>
                        )}
                      </div>
                      {booking.next_step !== null && (
                        <div className="crm-sh-next" data-testid="sh-fu-next">
                          <Icon name="corner-down-right" size={14} />
                          <span>{booking.next_step}</span>
                          <span className="crm-pill" data-tone={done ? "pos" : late ? "danger" : "accent"} data-testid="sh-fu-step">
                            {done ? t("sh.fu.step.done") : late ? t("sh.fu.step.late") : by === null ? t("sh.fu.step.open") : t("sh.fu.step.by", { day: f.dayShort(by) })}
                          </span>
                        </div>
                      )}
                      <div className="crm-sh-actions">
                        {booking.deal_id !== null && booking.deal !== undefined && booking.deal !== null && opens("deal") && (
                          <ScreenLink to="deal" rest={[booking.deal_id]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi crm-sh-deal">
                            <Icon name="move-right" size={14} />
                            {booking.deal}
                            {booking.deal_amount !== null && booking.deal_amount !== undefined && <span className="crm-mono">{f.money(booking.deal_amount)}</span>}
                          </ScreenLink>
                        )}
                        <span className="crm-sh-push" />
                        {canWrite && booking.next_step !== null && !done && (
                          <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="step-done" disabled={busy === booking.id} onClick={() => void markDone(booking)}>
                            <Icon name="check" size={14} />
                            {t("sh.fu.act.done")}
                          </button>
                        )}
                        {canWrite && (
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="write" aria-expanded={editing === booking.id} onClick={() => setEditing(editing === booking.id ? null : booking.id)}>
                            <Icon name="pencil" size={14} />
                            {t(booking.outcome === null ? "sh.fu.act.write" : "sh.fu.act.edit")}
                          </button>
                        )}
                      </div>
                      {editing === booking.id && <WriteUpForm booking={booking} onDone={() => (setEditing(null), again())} onCancel={() => setEditing(null)} />}
                    </li>
                  );
                })}
              </ul>

              {data.rows.length === 0 && (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="store" size={21} />
                  </span>
                  <div className="crm-empty-title">{t("sh.fu.empty")}</div>
                  <p>{t("sh.fu.empty.body")}</p>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function WriteUpForm({ booking, onDone, onCancel }: { booking: Booking; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session } = useScreen();
  const [outcome, setOutcome] = useState(booking.outcome ?? "");
  const [step, setStep] = useState(booking.next_step ?? "");
  const [by, setBy] = useState(booking.next_step_by ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const saved = await toasts.say(writeUp(session, booking, { outcome, next_step: step, next_step_by: by }), () => t("sh.fu.toast.written"));
    setBusy(false);
    if (saved !== null) onDone();
  };
  const ready = outcome.trim() !== "" && (step.trim() === "" || /^\d{4}-\d{2}-\d{2}$/.test(by));
  return (
    <form
      className="crm-sh-write"
      aria-label={t("sh.fu.form")}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) void save();
      }}
    >
      <label className="crm-label" htmlFor={`crm-sh-went-${booking.id}`}>
        {t("sh.fu.went")}
      </label>
      <textarea id={`crm-sh-went-${booking.id}`} autoFocus className="crm-input crm-textarea mr-fld" rows={3} maxLength={1000} value={outcome} disabled={busy} onChange={(event) => setOutcome(event.target.value)} />
      <div className="crm-field-pair">
        <div>
          <label className="crm-label" htmlFor={`crm-sh-step-${booking.id}`}>
            {t("sh.fu.next")}
          </label>
          <input id={`crm-sh-step-${booking.id}`} className="crm-input mr-fld" maxLength={400} value={step} disabled={busy} onChange={(event) => setStep(event.target.value)} />
        </div>
        <div>
          <label className="crm-label" htmlFor={`crm-sh-by-${booking.id}`}>
            {t("sh.fu.by")}
          </label>
          <input id={`crm-sh-by-${booking.id}`} className="crm-input crm-mono mr-fld" type="date" value={by} disabled={busy} onChange={(event) => setBy(event.target.value)} />
        </div>
      </div>
      <div className="crm-sh-actions">
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy} onClick={onCancel}>
          {t("ui.cancel")}
        </button>
        <button type="submit" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" disabled={!ready || busy}>
          {busy ? t("ui.saving") : t("sh.fu.save")}
        </button>
      </div>
    </form>
  );
}
