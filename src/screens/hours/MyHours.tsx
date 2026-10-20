/**
 * MY HOURS, on the crew's phone (P25, the design's crew My hours): one week of
 * his time sheet, a line a day (what, on site, travel), its totals, and where
 * the week stands: not sent yet, sent, signed off, or sent back with the
 * office's note.
 *
 * He writes his own days while the week is his (open, or sent back): "Add a
 * day" and "Change" on a line (the design draws the lines read-only, with no
 * way to write one: D6 §5 item 13). The first day he writes makes the week's
 * sheet. "Send for sign-off" moves the week on; once sent it is the office's,
 * and once signed off it changes no more. The server holds each of these,
 * and holds him to his own sheet (`proofs/crm-hours.test.ts`).
 *
 * The totals are the server's, kept on his sheet as the lines are written.
 *
 * Online only (ruling Q1): a save that cannot be sent says so and keeps what
 * was typed; the same press sends it again, a new row with the same key.
 *
 * Address: `my-hours` (the week just gone), `my-hours/<a day of the week>`.
 */
import { useCallback, useId, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { addDays, noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey, type Saved } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { readWeek, type CrewVisit } from "../crew/data.ts";
import { NoConnection, useConnection, type Connection } from "../crew/Offline.tsx";
import { dayWords, useJobsScreen } from "../jobs/parts.tsx";
import { addLine, changeLine, dayKeyOf, daysOf, editable, lastWorkingDay, makeSheet, mondayOf, num, readHours, readHoursSettings, readLines, readWeekSheets, sendSheet, weekAsked, type LineDraft, type Sheet, type SheetLine } from "./data.ts";

interface Mine {
  sheet: Sheet | null;
  lines: SheetLine[];
  visits: CrewVisit[];
  /** Who signed it off, by name. */
  signer: string | null;
  lastDay: string;
}

const PILL = { none: "plain", open: "plain", sent: "accent", "sent-back": "warn", "signed-off": "pos" } as const;

export function MyHours({ rest }: ScreenProps) {
  const t = useT();
  const { dir } = useI18n();
  const nav = useNav();
  const toasts = useToasts();
  const { session, f, today, tick } = useJobsScreen();
  const conn = useConnection();
  const me = session.config.user?.id ?? null;
  const monday = weekAsked(rest, today);
  const thisWeek = mondayOf(today);
  const { load, reload } = useLoad<Mine>(async () => {
    const [settings, sheets, visits] = await Promise.all([
      readHoursSettings(session),
      readWeekSheets(session, monday, me),
      session.part("jobs") && session.can("job_visits", "read") ? readWeek(session, monday).catch(() => []) : Promise.resolve([]),
    ]);
    const sheet = sheets[0] ?? null;
    const lines = sheet === null ? [] : await readLines(session, [sheet.id]);
    let signer: string | null = null;
    if (sheet?.signed_by_id) signer = (await session.people(undefined, 200).catch(() => [])).find((person) => person.id === sheet.signed_by_id)?.name ?? null;
    return { sheet, lines, visits, signer, lastDay: lastWorkingDay(monday, settings.workDays) };
  }, [session, monday, me]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["time_sheets", "time_sheet_lines"], again);
  const [editing, setEditing] = useState<SheetLine | "new" | null>(null);
  const [sending, setSending] = useState(false);

  const send = async (sheet: Sheet): Promise<boolean> => {
    if (sending) return true;
    setSending(true);
    const saved = await sendSheet(session, sheet);
    setSending(false);
    if (saved.state === "unknown") {
      conn.lost(() => send(sheet));
      return false;
    }
    conn.back();
    if (saved.state === "refused") toasts.show(t("ui.refused", { reason: saved.error.code === "STATE_MOVE_REFUSED" && saved.error.status === 409 ? t("hr.mh.send.empty") : reasonOf(saved.error, t) }), "danger", true);
    else toasts.show(t(sheet.state === "sent-back" ? "hr.mh.again.done" : "hr.mh.send.done"), "pos");
    again();
    return true;
  };

  return (
    <div className="crm-cw crm-hr mr-screen" data-screen="myhours">
      <h1 className="crm-cw-title">{t("hr.mh.title")}</h1>
      <div className="crm-hr-weekline">
        <button type="button" className="crm-icon-btn mr-gi" aria-label={t("jb.week.before")} onClick={() => nav.replace("myhours", addDays(monday, -7))}>
          <Icon name={dir === "rtl" ? "chevron-right" : "chevron-left"} />
        </button>
        <span className="crm-mono crm-hr-week" data-testid="hr-mh-week" aria-live="polite">
          {t("jb.week.span", { from: dayWords(f, monday), to: dayWords(f, load.state === "ready" ? load.data.lastDay : addDays(monday, 4)) })}
        </span>
        <button type="button" className="crm-icon-btn mr-gi" aria-label={t("jb.week.after")} disabled={monday >= thisWeek} onClick={() => nav.replace("myhours", addDays(monday, 7))}>
          <Icon name={dir === "rtl" ? "chevron-left" : "chevron-right"} />
        </button>
        {load.state === "ready" && (
          <span className="crm-pill" data-tone={PILL[load.data.sheet?.state ?? "none"]} data-testid="hr-mh-state">
            {t(`hr.mine.${load.data.sheet?.state ?? "none"}`)}
          </span>
        )}
      </div>
      {(conn.down || load.state === "failed") && (
        <NoConnection
          tried={conn.tried}
          busy={conn.busy}
          onRetry={() => {
            if (load.state === "failed") {
              conn.back();
              reload();
            } else conn.retry();
          }}
        />
      )}
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={84} />}>
        {(data) => {
          const { sheet } = data;
          const mine = sheet === null || editable(sheet.state);
          // A week still to come is nobody's to write yet; this week and those before are.
          const canWrite = mine && monday <= thisWeek && session.can("time_sheet_lines", "create") && (sheet !== null || session.can("time_sheets", "create"));
          const ended = today > data.lastDay;
          const visitOf = (id: number | null): CrewVisit | undefined => (id === null ? undefined : data.visits.find((visit) => visit.id === id));
          return (
            <>
              <ul className="crm-hr-days" aria-label={t("hr.mh.days")}>
                {data.lines.map((line) => {
                  const day = dayKeyOf(line.day) ?? monday;
                  const off = num(line.hours) === 0 && num(line.travel_hours) === 0;
                  const visit = visitOf(line.visit_id);
                  return (
                    <li key={line.id} className="crm-hr-day-row mr-card" data-line={line.id} data-day={day}>
                      <div className="crm-hr-dayno" aria-hidden="true">
                        <div className="crm-hr-dow">{f.weekdayShort(noonOf(day))}</div>
                        <div className="crm-mono crm-hr-num">{f.number(Number(day.slice(8, 10)))}</div>
                      </div>
                      <div className="crm-hr-day-words">
                        <span className="mr-sr-only">{f.dayLong(noonOf(day))}</span>
                        <div className="crm-hr-what">{line.what}</div>
                        {visit !== undefined && <div className="crm-mono crm-hr-visit">{[visit.site_name, visit.what].filter((part) => part !== null && part !== "").join(" · ")}</div>}
                        {!off && (
                          <div className="crm-hr-split">
                            <span>
                              {t("hr.mh.onSite")} <b className="crm-mono" data-figure="hours">{t("hr.h", { n: f.number(num(line.hours)) })}</b>
                            </span>
                            <span>
                              {t("hr.mh.travel")} <b className="crm-mono" data-figure="travel">{t("hr.h", { n: f.number(num(line.travel_hours)) })}</b>
                            </span>
                          </div>
                        )}
                      </div>
                      {canWrite && sheet !== null && (
                        <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" aria-label={t("hr.mh.change.label", { day: f.dayShort(noonOf(day)) })} onClick={() => setEditing(line)}>
                          <Icon name="pencil" size={14} />
                          {t("hr.mh.change")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {data.lines.length === 0 && (
                <div className="crm-empty" data-testid="hr-mh-empty">
                  <span className="crm-empty-icon">
                    <Icon name="clock" size={20} />
                  </span>
                  <div className="crm-empty-title">{t("hr.mh.empty")}</div>
                  <p>{t(canWrite ? "hr.mh.empty.write" : "hr.mh.empty.read")}</p>
                </div>
              )}
              {canWrite && (
                <button type="button" className="crm-cw-bigbtn crm-hr-add mr-btn" onClick={() => setEditing("new")}>
                  <Icon name="plus" />
                  {t("hr.mh.add")}
                </button>
              )}
              <div className="crm-hr-totals" data-testid="hr-mh-totals">
                <div className="crm-hr-tot mr-card">
                  <div className="crm-hr-tot-label">{t("hr.mh.onSite")}</div>
                  <div className="crm-mono crm-hr-tot-value" data-figure="onsite">
                    {t("hr.h", { n: f.number(num(sheet?.hours_total)) })}
                  </div>
                </div>
                <div className="crm-hr-tot mr-card">
                  <div className="crm-hr-tot-label">{t("hr.mh.travel")}</div>
                  <div className="crm-mono crm-hr-tot-value" data-figure="travel">
                    {t("hr.h", { n: f.number(num(sheet?.travel_total)) })}
                  </div>
                </div>
                <div className="crm-hr-tot crm-hr-tot-all mr-card">
                  <div className="crm-hr-tot-label">{t("hr.mh.total")}</div>
                  <div className="crm-mono crm-hr-tot-value" data-figure="total">
                    {t("hr.h", { n: f.number(num(sheet?.total_hours)) })}
                  </div>
                </div>
              </div>
              <StateCard data={data} ended={ended} sending={sending} canSend={sheet !== null && editable(sheet.state) && session.can("time_sheets", "update")} onSend={() => sheet !== null && void send(sheet)} />
              {editing !== null && (
                <LineDialog
                  monday={monday}
                  me={me}
                  sheet={sheet}
                  line={editing === "new" ? null : editing}
                  visits={data.visits}
                  conn={conn}
                  onClose={() => setEditing(null)}
                  onDone={again}
                />
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

/** Where the week stands, in the design's four lines, and the button that moves it on. */
function StateCard({ data, ended, sending, canSend, onSend }: { data: Mine; ended: boolean; sending: boolean; canSend: boolean; onSend: () => void }) {
  const t = useT();
  const { f } = useJobsScreen();
  const { sheet } = data;
  const state = sheet?.state ?? "none";
  const sentAt = sheet?.sent_at ? new Date(sheet.sent_at) : null;
  const signedAt = sheet?.signed_at ? new Date(sheet.signed_at) : null;
  const ready = canSend && ended && data.lines.length > 0 && !sending;
  return (
    <div className="crm-hr-card mr-card" data-testid="hr-mh-card" data-state={state}>
      {(state === "none" || state === "open") && <p>{t(data.lines.length === 0 ? "hr.mh.line.empty" : ended ? "hr.mh.line.ended" : "hr.mh.line.notYet")}</p>}
      {state === "sent" && <p data-testid="hr-mh-sent">{sentAt === null ? t("hr.mh.line.sent") : t("hr.mh.line.sentAt", { day: f.dayLong(sentAt), time: f.time(sentAt) })}</p>}
      {state === "signed-off" && (
        <p className="crm-hr-signed" data-testid="hr-mh-signed">
          <Icon name="check-check" size={17} />
          {data.signer === null ? t("hr.mh.line.signed") : signedAt === null ? t("hr.mh.line.signedBy", { name: data.signer }) : t("hr.mh.line.signedByOn", { name: data.signer, day: f.dayShort(signedAt) })}
        </p>
      )}
      {state === "sent-back" && (
        <>
          <p className="crm-hr-back">{t("hr.mh.line.back")}</p>
          {sheet?.sent_back_note !== null && sheet?.sent_back_note !== undefined && sheet.sent_back_note !== "" && (
            <p className="crm-hr-backnote" data-testid="hr-mh-backnote">
              {sheet.sent_back_note}
            </p>
          )}
        </>
      )}
      {canSend && (
        <button type="button" className="crm-cw-bigbtn crm-hr-send mr-btn" data-testid="hr-mh-send" disabled={!ready} onClick={onSend}>
          <Icon name="send" />
          {sending ? t("ui.saving") : t(state === "sent-back" ? "hr.mh.again" : "hr.mh.send")}
        </button>
      )}
    </div>
  );
}

/** A day of the week, written or changed: what, on site, travel, and the visit it was if it was one. The first day makes the week's sheet. */
function LineDialog({ monday, me, sheet, line, visits, conn, onClose, onDone }: { monday: string; me: string | null; sheet: Sheet | null; line: SheetLine | null; visits: CrewVisit[]; conn: Connection; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const id = useId();
  const days = useMemo(() => daysOf(monday), [monday]);
  const [day, setDay] = useState(line === null ? days[0]! : (dayKeyOf(line.day) ?? days[0]!));
  const [what, setWhat] = useState(line?.what ?? "");
  const [hours, setHours] = useState(line === null ? "" : String(num(line.hours)));
  const [travel, setTravel] = useState(line === null ? "" : String(num(line.travel_hours)));
  const [visitId, setVisitId] = useState<number | null>(line?.visit_id ?? null);
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(false);
  // One key for the week's sheet and one for the line, kept while the same press is sent again.
  const [keys] = useState(() => ({ sheet: newClientKey(), line: newClientKey() }));
  const [made, setMade] = useState<Sheet | null>(sheet);
  const onHours = readHours(hours);
  const onTravel = readHours(travel);
  const ready = what.trim() !== "" && onHours !== null && onTravel !== null && !busy;
  const ofDay = visits.filter((visit) => dayKeyOf(visit.day) === day);

  const save = async (): Promise<boolean> => {
    if (!ready || me === null || onHours === null || onTravel === null) return true;
    setBusy(true);
    const draft: LineDraft = { day, what, hours: onHours, travel: onTravel, visitId };
    let target = made;
    if (target === null) {
      const saved = await makeSheet(session, me, monday, keys.sheet);
      if (!(await settled(saved, () => setMade(saved.state === "saved" ? saved.row : null)))) return false;
      if (saved.state !== "saved") return true;
      target = saved.row;
    }
    const saved = line === null ? await addLine(session, target.id, draft, keys.line) : await changeLine(session, line, draft);
    if (!(await settled(saved, () => undefined))) return false;
    if (saved.state === "saved") {
      toasts.show(t(line === null ? "hr.mh.line.added" : "hr.mh.line.changed", { day: f.dayShort(noonOf(day)) }), "pos");
      onDone();
      onClose();
    }
    return true;
  };
  /** How a save ended: no connection keeps the dialog and its words; a refusal says why; a save goes on. */
  async function settled<R>(saved: Saved<R>, keep: () => void): Promise<boolean> {
    if (saved.state === "unknown") {
      setBusy(false);
      setLost(true);
      conn.lost(save);
      return false;
    }
    setLost(false);
    conn.back();
    if (saved.state === "refused") {
      setBusy(false);
      toasts.show(t("ui.refused", { reason: saved.error.code === "RECORD_LOCKED" ? t("hr.mh.locked") : reasonOf(saved.error, t) }), "danger", true);
      onDone();
      return true;
    }
    keep();
    setBusy(false);
    return true;
  }

  return (
    <Dialog
      shape="box"
      icon="clock"
      tone="accent"
      title={t(line === null ? "hr.mh.add" : "hr.mh.change.title")}
      subtitle={t("jb.week.span", { from: dayWords(f, monday), to: dayWords(f, addDays(monday, 6)) })}
      onClose={onClose}
      busy={busy}
      name="hr-line"
      foot={
        <>
          <span className="crm-cw-hint" role="status" aria-live="polite">
            {lost ? t("cw.offline") : what.trim() === "" ? t("hr.mh.need.what") : onHours === null || onTravel === null ? t("hr.mh.need.hours") : ""}
          </span>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="hr-line-save" disabled={!ready} onClick={() => void save()}>
            <Icon name="check" />
            {busy ? t("ui.saving") : t(line === null ? "hr.mh.add.go" : "hr.mh.change.go")}
          </button>
        </>
      }
    >
      <label className="crm-label" htmlFor={`${id}-day`}>
        {t("hr.mh.day")}
      </label>
      <select id={`${id}-day`} className="crm-input mr-fld" value={day} disabled={busy} onChange={(event) => (setDay(event.target.value), setVisitId(null))}>
        {days.map((one) => (
          <option key={one} value={one}>
            {f.dayLong(noonOf(one))}
          </option>
        ))}
      </select>
      <label className="crm-label" htmlFor={`${id}-what`}>
        {t("hr.mh.what")}
      </label>
      <input id={`${id}-what`} data-autofocus className="crm-input mr-fld" value={what} maxLength={200} placeholder={t("hr.mh.what.hint")} disabled={busy} onChange={(event) => setWhat(event.target.value)} />
      <div className="crm-hr-pair">
        <div>
          <label className="crm-label" htmlFor={`${id}-hours`}>
            {t("hr.mh.hours")}
          </label>
          <input id={`${id}-hours`} className="crm-input crm-mono mr-fld" inputMode="decimal" value={hours} placeholder="0" aria-invalid={onHours === null} disabled={busy} onChange={(event) => setHours(event.target.value)} />
        </div>
        <div>
          <label className="crm-label" htmlFor={`${id}-travel`}>
            {t("hr.mh.travelHours")}
          </label>
          <input id={`${id}-travel`} className="crm-input crm-mono mr-fld" inputMode="decimal" value={travel} placeholder="0" aria-invalid={onTravel === null} disabled={busy} onChange={(event) => setTravel(event.target.value)} />
        </div>
      </div>
      {ofDay.length > 0 && (
        <>
          <label className="crm-label" htmlFor={`${id}-visit`}>
            {t("hr.mh.visit")}
          </label>
          <select id={`${id}-visit`} className="crm-input mr-fld" value={visitId ?? ""} disabled={busy} onChange={(event) => setVisitId(event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">{t("hr.mh.visit.none")}</option>
            {ofDay.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {[visit.site_name, visit.what].filter((part) => part !== null && part !== "").join(" · ")}
              </option>
            ))}
          </select>
        </>
      )}
    </Dialog>
  );
}
