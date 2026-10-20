/**
 * TIME SHEETS (ledger screen 53): one week, crew member by crew member. Read
 * each week, send back what is odd with a note the crew member reads on his
 * phone, sign the rest off.
 *
 * Every figure is the server's: a sheet's hours are kept on it as its lines
 * are written (`hours_total`, `travel_total`, `total_hours`), and the week's
 * counts are figures asked for the reader's rows. "Over the week" is a sheet
 * whose hours in all pass the settings' working week (a day's hours times the
 * working days), counted by the server.
 *
 * Who presses: the operations manager and the CRM admin, on a week that was
 * sent (the server refuses anybody else, and any other state). Read-only reads
 * it with nothing to press. Live: a week a crew member sends, or changes after
 * it came back, shows here without a reload.
 *
 * Address: `time-sheets` (the week just gone), `time-sheets/<a day of the week>`.
 */
import { useCallback, useId, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import type { CrewFacts } from "../jobs/data.ts";
import { Stat, WeekBar, useCrewFacts, useJobsScreen } from "../jobs/parts.tsx";
import { dayKeyOf, lastWorkingDay, num, readHoursSettings, readJobCodes, readLines, readWeekFigures, readWeekSheets, sendBack, signSheet, truthy, weekAsked, weekHours, type Sheet, type SheetLine, type SheetState } from "./data.ts";
import { HoursText, sheetTone } from "./parts.tsx";

interface WeekData {
  sheets: Sheet[];
  lines: SheetLine[];
  codes: Map<number, string>;
  figures: Awaited<ReturnType<typeof readWeekFigures>>;
  over: number;
}

/** One person's row: whose, their crew, and their sheet for the week if there is one. */
interface Person {
  user: string;
  name: string;
  crew: string | null;
  lead: boolean;
  sheet: Sheet | null;
}

/** Crew members in their crews' order (the lead first), then anybody else with a sheet that week. */
function peopleOf(facts: CrewFacts, sheets: readonly Sheet[]): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const crew of facts.crews) {
    const members = facts.members.filter((member) => member.crew_id === crew.id).sort((a, b) => Number(truthy(b.lead)) - Number(truthy(a.lead)) || a.id - b.id);
    for (const member of members) {
      if (seen.has(member.user_id)) continue;
      seen.add(member.user_id);
      out.push({ user: member.user_id, name: facts.names[member.user_id] ?? "", crew: crew.name, lead: truthy(member.lead), sheet: sheets.find((sheet) => sheet.user_id === member.user_id) ?? null });
    }
  }
  for (const sheet of sheets) if (!seen.has(sheet.user_id)) out.push({ user: sheet.user_id, name: facts.names[sheet.user_id] ?? "", crew: null, lead: false, sheet });
  return out;
}

export function TimeSheets({ rest }: ScreenProps) {
  const t = useT();
  const nav = useNav();
  const { session, f, today, tick } = useJobsScreen();
  const monday = weekAsked(rest, today);
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  const { load: settings, reload: reloadSettings } = useLoad(() => readHoursSettings(session), [session]);
  const over = settings.state === "ready" ? weekHours(settings.data) : null;
  const { load, reload } = useLoad<WeekData | null>(async () => {
    if (over === null) return null;
    const [sheets, figures] = await Promise.all([readWeekSheets(session, monday), readWeekFigures(session, monday, over)]);
    const lines = await readLines(session, sheets.map((sheet) => sheet.id));
    return { sheets, lines, codes: await readJobCodes(session, lines), figures, over };
  }, [session, monday, over]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["time_sheets", "time_sheet_lines"], again);
  useLive(["crews", "crew_members"], useCoalesced(reloadFacts));

  return (
    <div className="crm-screen crm-jb crm-hr mr-screen" data-screen="timesheets">
      <div className="crm-screen-head">
        <div>
          <h1>{t("hr.ts.title")}</h1>
          <p className="crm-screen-sub crm-jb-lead">{t("hr.ts.sub")}</p>
        </div>
      </div>
      <WeekBar monday={monday} today={today} f={f} onWeek={(next) => nav.replace("timesheets", next)} />
      <Loaded load={settings} reload={reloadSettings} skeleton={<Skeleton rows={3} height={110} />}>
        {(hours) => (
          <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={3} height={110} />}>
            {(crews) => (
              <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={110} />}>
                {(week) => {
                  if (week === null) return <Skeleton rows={3} height={110} />;
                  const { figures } = week;
                  const people = peopleOf(crews, week.sheets);
                  const overSheets = week.sheets.filter((sheet) => num(sheet.total_hours) > week.over);
                  const jobList = figures.byJob.map((job) => t("hr.ts.jobs.one", { job: job.label, count: f.number(job.count) })).join(", ");
                  return (
                    <>
                      <p className="crm-hr-jobline" data-testid="hr-ts-jobline">
                        {[
                          jobList === "" ? t("hr.ts.jobs", { on: f.number(figures.onAJob), all: f.number(figures.lines) }) : t("hr.ts.jobs.list", { on: f.number(figures.onAJob), all: f.number(figures.lines), list: jobList }),
                          t("hr.ts.daysOff", { count: f.number(figures.daysOff) }),
                          t("hr.ts.overCount", { hours: f.number(week.over), count: f.number(figures.over) }),
                        ].join(" ")}
                      </p>
                      <div className="crm-kpis crm-jb-stats">
                        <Stat name="onjob" label={t("hr.ts.stat.job")} value={t("hr.h", { n: f.number(figures.onJob) })} sub={t("hr.ts.stat.job.sub", { count: f.number(figures.sheets) }, figures.sheets)} />
                        <Stat name="travel" label={t("hr.ts.stat.travel")} value={t("hr.h", { n: f.number(figures.travel) })} sub={t("hr.ts.stat.travel.sub")} />
                        <Stat name="tosign" label={t("hr.ts.stat.sign")} value={f.number(figures.toSign)} tone={figures.toSign > 0 ? "warn" : "pos"} sub={t(figures.toSign > 0 ? "hr.ts.stat.sign.sub" : "hr.ts.stat.sign.none")} />
                      </div>
                      {figures.over > 0 && (
                        <div className="crm-banner" data-tone="warn" data-testid="hr-ts-over" role="status">
                          <Icon name="clock-alert" size={16} />
                          <span>
                            {figures.over === 1 && overSheets.length === 1
                              ? t("hr.ts.over.one", { name: crews.names[overSheets[0]!.user_id] ?? "", hours: f.number(num(overSheets[0]!.total_hours)) })
                              : t("hr.ts.over", { count: f.number(figures.over) }, figures.over)}
                          </span>
                        </div>
                      )}
                      <ul className="crm-jb-list" aria-label={t("hr.ts.list", { week: f.dayShort(noonOf(monday)) })}>
                        {people.map((person) => (
                          <SheetRow key={person.user} person={person} lines={person.sheet === null ? [] : week.lines.filter((line) => line.sheet_id === person.sheet!.id)} codes={week.codes} over={week.over} names={crews.names} onDone={again} />
                        ))}
                      </ul>
                      {people.length === 0 && (
                        <div className="crm-empty" data-testid="hr-ts-empty">
                          <span className="crm-empty-icon">
                            <Icon name="clock" size={20} />
                          </span>
                          <div className="crm-empty-title">{t("hr.ts.empty")}</div>
                          <p>{t("hr.ts.empty.body", { from: f.dayShort(noonOf(monday)), to: f.dayShort(noonOf(lastWorkingDay(monday, hours.workDays))) })}</p>
                        </div>
                      )}
                    </>
                  );
                }}
              </Loaded>
            )}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

const PILL: Record<SheetState | "none", "plain" | "accent" | "warn" | "pos"> = { none: "plain", open: "plain", sent: "accent", "sent-back": "warn", "signed-off": "pos" };

function SheetRow({ person, lines, codes, over, names, onDone }: { person: Person; lines: SheetLine[]; codes: Map<number, string>; over: number; names: Record<string, string>; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const sheet = person.sheet;
  const state = sheet?.state ?? "none";
  const first = firstName(person.name);
  const canAct = sheet !== null && sheet.state === "sent" && session.can("time_sheets", "update");
  const total = num(sheet?.total_hours);
  const run = async (save: Promise<import("../../staffSession.ts").Saved<Sheet>>, done: string): Promise<void> => {
    setBusy(true);
    const saved = await toasts.say(save, () => done);
    setBusy(false);
    if (saved !== null) setNote("");
    onDone();
  };
  const signedAt = sheet?.signed_at === null || sheet?.signed_at === undefined ? null : new Date(sheet.signed_at);
  const sentAt = sheet?.sent_at === null || sheet?.sent_at === undefined ? null : new Date(sheet.sent_at);
  return (
    <li className="crm-jb-row crm-hr-row mr-card" data-sheet-of={person.user} data-state={state} data-tone={sheetTone(state)}>
      <div className="crm-jb-row-top">
        <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
          {initials(person.name || "?")}
        </span>
        <div className="crm-jb-row-words">
          <div className="crm-jb-row-line">
            <strong data-testid="hr-ts-name">{person.name}</strong>
            <span className="crm-pill" data-tone={PILL[state]} data-testid="hr-ts-state">
              {t(`hr.state.${state}`)}
            </span>
          </div>
          <div className="crm-jb-quiet">{[t(person.lead ? "hr.lead" : person.crew === null ? "hr.nocrew" : "hr.member"), person.crew].filter((part) => part !== null).join(" · ")}</div>
        </div>
        {sheet !== null && (
          <div className="crm-jb-row-end">
            <div className="crm-mono crm-hr-total" data-figure="total" data-tone={total > over ? "warn" : undefined}>
              {t("hr.h", { n: f.number(total) })}
            </div>
            <div className="crm-jb-quiet" data-figure="split">
              {t("hr.ts.split", { job: f.number(num(sheet.hours_total)), travel: f.number(num(sheet.travel_total)) })}
            </div>
          </div>
        )}
        {sheet !== null && (
          <button type="button" className="crm-icon-btn mr-gi" aria-expanded={open} aria-label={t(open ? "hr.ts.hide" : "hr.ts.show", { name: person.name })} onClick={() => setOpen((was) => !was)}>
            <Icon name={open ? "chevron-up" : "chevron-down"} />
          </button>
        )}
      </div>
      {sheet !== null && open && (
        <ul className="crm-hr-lines" data-testid="hr-ts-lines">
          {lines.map((line) => {
            const day = dayKeyOf(line.day);
            const off = num(line.hours) === 0 && num(line.travel_hours) === 0;
            const code = line.job_id === null ? null : (codes.get(line.job_id) ?? null);
            return (
              <li key={line.id} data-line={line.id} data-off={off ? "1" : undefined}>
                <span className="crm-mono crm-hr-day">{day === null ? "" : f.dayShort(noonOf(day))}</span>
                <span className="crm-hr-what">{[code, line.what].filter((part) => part !== null && part !== "").join(" · ")}</span>
                <span className="crm-mono crm-hr-hours">{off ? "—" : <HoursText f={f} hours={line.hours} travel={line.travel_hours} />}</span>
              </li>
            );
          })}
          {lines.length === 0 && <li className="crm-jb-quiet">{t("hr.ts.nolines")}</li>}
        </ul>
      )}
      {sheet === null && <p className="crm-jb-quiet crm-hr-foot">{t("hr.ts.none", { name: first })}</p>}
      {sheet?.state === "open" && <p className="crm-jb-quiet crm-hr-foot">{t("hr.ts.open", { name: first })}</p>}
      {sheet?.state === "sent" && sentAt !== null && <p className="crm-jb-quiet crm-hr-foot" data-testid="hr-ts-sent">{t("hr.ts.sentAt", { day: f.dayShort(sentAt), time: f.time(sentAt) })}</p>}
      {sheet?.state === "signed-off" && (
        <p className="crm-hr-foot crm-hr-signed" data-testid="hr-ts-signed">
          <Icon name="check-check" size={14} />
          {signedAt === null ? t("hr.ts.signedBy", { name: names[sheet.signed_by_id ?? ""] ?? "" }) : t("hr.ts.signedByOn", { name: names[sheet.signed_by_id ?? ""] ?? "", day: f.dayShort(signedAt) })}
        </p>
      )}
      {sheet?.state === "sent-back" && sheet.sent_back_note !== null && sheet.sent_back_note !== "" && (
        <div className="crm-jb-note" data-testid="hr-ts-backnote">
          <Icon name="sticky-note" size={13} />
          <span>{t("hr.ts.backNote", { note: sheet.sent_back_note })}</span>
        </div>
      )}
      {canAct && (
        <div className="crm-hr-acts">
          <label className="mr-sr-only" htmlFor={noteId}>
            {t("hr.ts.note", { name: first })}
          </label>
          <input id={noteId} className="crm-input crm-input-sm mr-fld" value={note} maxLength={400} placeholder={t("hr.ts.note", { name: first })} disabled={busy} onChange={(event) => setNote(event.target.value)} />
          <span className="crm-hr-buttons">
            <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="sign" disabled={busy} onClick={() => void run(signSheet(session, sheet), t("hr.ts.signed.done", { name: first }))}>
              <Icon name="check" size={14} />
              {t("hr.ts.sign")}
            </button>
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="back" disabled={busy || note.trim() === ""} title={note.trim() === "" ? t("hr.ts.back.why") : undefined} onClick={() => void run(sendBack(session, sheet, note), t("hr.ts.back.done", { name: first }))}>
              {t("hr.ts.back")}
            </button>
          </span>
        </div>
      )}
      {sheet?.state === "sent" && !session.can("time_sheets", "update") && <span className="mr-sr-only">{t("hr.ts.readOnly")}</span>}
    </li>
  );
}
