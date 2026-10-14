/**
 * THE JOB SNAG LIST (ledger screen 48): what is not right after the crew has
 * gone, open ones first. Logged here by the office, on the sign-off by the
 * office, and on the crew's phone (P22).
 *
 * Every count is the server's (`readSnagFigures`). A snag is put right with a
 * line of what was done (the move asks for it, at the server), and may wait
 * for a part first. The day a snag logged today is due is the setting's
 * number of days on from the server's today.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays, noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { dayKeyOf, num, readJobs, readSnagFigures, readSnags, truthy, type CrewFacts, type Job, type Snag, type SnagFigures } from "./data.ts";
import { Stat, useCrewFacts, useJobsScreen } from "./parts.tsx";

type Filter = "live" | "open" | "waiting-part" | "put-right" | "all";
const FILTERS: readonly Filter[] = ["live", "open", "waiting-part", "put-right", "all"];

const countOf = (figures: SnagFigures, filter: Filter): number =>
  filter === "live" ? figures.live : filter === "open" ? figures.open : filter === "waiting-part" ? figures.waiting : filter === "put-right" ? figures.putRight : figures.all;

export function Snags(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useJobsScreen();
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  const { load, reload } = useLoad(() => Promise.all([readSnags(session), readSnagFigures(session, today), readJobs(session)]), [session, today]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["snags", "jobs"], again);
  const [filter, setFilter] = useState<Filter>("live");
  const [adding, setAdding] = useState(false);
  const canAdd = session.can("snags", "create") && session.can("jobs", "read");
  const canWork = session.can("snags", "update");

  return (
    <div className="crm-screen crm-jb mr-screen" data-screen="snags">
      <div className="crm-screen-head">
        <div>
          <h1>{t("jb.sg.title")}</h1>
          <p className="crm-screen-sub crm-jb-lead">{t("jb.sg.sub")}</p>
        </div>
        {canAdd && (
          <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="jb-sg-add" aria-expanded={adding} onClick={() => setAdding((was) => !was)}>
            <Icon name="plus" />
            {t("jb.sg.log")}
          </button>
        )}
      </div>
      <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={3} height={110} />}>
        {(crews) => (
          <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={110} />}>
            {([snags, figures, jobs]) => {
              // The live ones that stop a sign-off: listed by the server's rows, counted by the server's figure.
              const stopping = snags.filter((snag) => snag.state !== "put-right" && truthy(snag.stops_sign_off));
              const snagDays = num(crews.settings?.snag_days ?? 5) || 5;
              const shown = snags.filter((snag) => (filter === "all" ? true : filter === "live" ? snag.state !== "put-right" : snag.state === filter));
              return (
                <>
                  <div className="crm-kpis crm-jb-stats">
                    <Stat name="open" label={t("jb.sg.stat.open")} value={f.number(figures.open)} tone={figures.open > 0 ? "danger" : undefined} sub={t("jb.sg.stat.open.sub", { count: f.number(figures.openJobs) }, figures.openJobs)} />
                    <Stat name="waiting" label={t("jb.sg.stat.waiting")} value={f.number(figures.waiting)} tone={figures.waiting > 0 ? "warn" : undefined} sub={t("jb.sg.stat.waiting.sub")} />
                    <Stat name="late" label={t("jb.sg.stat.late")} value={f.number(figures.late)} tone={figures.late > 0 ? "danger" : "pos"} sub={t(figures.late > 0 ? "jb.sg.stat.late.sub" : "jb.sg.stat.late.none")} />
                  </div>
                  {figures.stopping > 0 && (
                    <div className="crm-banner" data-tone="danger" data-testid="jb-sg-stopping">
                      <Icon name="octagon-alert" size={16} />
                      <span>
                        {t("jb.sg.stopping", { count: f.number(figures.stopping), list: stopping.map((snag) => t("jb.sg.stopping.one", { what: snag.text, job: snag.code ?? "" })).join("; ") }, figures.stopping)}
                      </span>
                    </div>
                  )}
                  <p className="crm-jb-quiet" data-testid="jb-sg-by">
                    {t("jb.sg.by", { crew: f.number(figures.byCrew), customer: f.number(figures.byCustomer), day: f.dayShort(noonOf(addDays(today, snagDays))) })}
                  </p>
                  {adding && canAdd && <LogSnag jobs={jobs} onClose={() => setAdding(false)} onDone={() => (setFilter("live"), again())} />}
                  <div className="crm-chips" role="group" aria-label={t("jb.sg.filter")}>
                    {FILTERS.map((one) => (
                      <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                        {t(`jb.sg.filter.${one}`)}
                        <span className="crm-chip-count crm-mono">{f.number(countOf(figures, one))}</span>
                      </button>
                    ))}
                  </div>
                  <ul className="crm-jb-list">
                    {shown.map((snag) => (
                      <SnagRow key={snag.id} snag={snag} crews={crews} today={today} canWork={canWork} onDone={again} />
                    ))}
                  </ul>
                  {shown.length === 0 && (
                    <div className="crm-empty">
                      <span className="crm-empty-icon">
                        <Icon name="check-check" size={20} />
                      </span>
                      <div className="crm-empty-title">{t("jb.sg.empty")}</div>
                      <p>{t("jb.sg.empty.body")}</p>
                    </div>
                  )}
                </>
              );
            }}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

function LogSnag({ jobs, onClose, onDone }: { jobs: Job[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session } = useJobsScreen();
  const [text, setText] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [stops, setStops] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newClientKey());
  const ready = text.trim().length > 3 && jobId !== null;
  const save = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    const job = jobs.find((one) => one.id === jobId);
    const saved = await toasts.say(session.create("snags", { job_id: jobId, text: text.trim(), stops_sign_off: stops, raised_by_id: session.config.user?.id ?? null }, key), () => t(stops ? "jb.so.snag.stops.done" : "jb.so.snag.done", { job: job?.code ?? "" }));
    setBusy(false);
    if (saved === null) return;
    setKey(newClientKey());
    onDone();
    onClose();
  };
  return (
    <section className="crm-jb-panel crm-jb-log" aria-labelledby="crm-jb-log-h" data-testid="jb-sg-form">
      <div className="crm-jb-so-block-head">
        <h2 id="crm-jb-log-h">{t("jb.sg.form.title")}</h2>
        <button type="button" className="crm-icon-btn mr-gi" aria-label={t("ui.close")} disabled={busy} onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <fieldset className="crm-fields" disabled={busy}>
        <label className="crm-label" htmlFor="crm-jb-sg-text">
          {t("jb.so.snag.what")}
        </label>
        <input id="crm-jb-sg-text" className="crm-input mr-fld" autoFocus value={text} maxLength={400} placeholder={t("jb.sg.form.hint")} onChange={(event) => setText(event.target.value)} />
        <label className="crm-label" htmlFor="crm-jb-sg-job">
          {t("jb.sg.form.job")}
        </label>
        <select id="crm-jb-sg-job" className="crm-input mr-fld" value={jobId ?? ""} onChange={(event) => setJobId(event.target.value === "" ? null : Number(event.target.value))}>
          <option value="">{t("jb.bk.job.pick")}</option>
          {jobs.map((one) => (
            <option key={one.id} value={one.id}>
              {[one.code, one.site_name, one.title].filter((part) => part !== null && part !== "").join(" · ")}
            </option>
          ))}
        </select>
        <div className="crm-label">{t("jb.sg.form.bad")}</div>
        <div className="crm-chips" role="group" aria-label={t("jb.sg.form.bad")}>
          <button type="button" className="crm-chip-btn mr-chip" aria-pressed={!stops} onClick={() => setStops(false)}>
            {t("jb.sg.form.minor")}
          </button>
          <button type="button" className="crm-chip-btn mr-chip" aria-pressed={stops} data-testid="jb-sg-stops" onClick={() => setStops(true)}>
            {t("jb.sg.stops")}
          </button>
        </div>
        <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" disabled={!ready || busy} onClick={() => void save()}>
          <Icon name="wrench" />
          {busy ? t("ui.saving") : t("jb.sg.form.go")}
        </button>
      </fieldset>
    </section>
  );
}

function SnagRow({ snag, crews, today, canWork, onDone }: { snag: Snag; crews: CrewFacts; today: string; canWork: boolean; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const live = snag.state !== "put-right";
  const due = dayKeyOf(snag.due_on);
  const raised = dayKeyOf(snag.raised_on);
  const late = live && due !== null && due < today;
  const ago = raised === null ? null : f.dayDiff(noonOf(raised), noonOf(today));
  const by = snag.raised_by_id !== null ? (crews.names[snag.raised_by_id] ?? t("jb.sg.by.staff")) : snag.raised_by_contact_id !== null ? t("jb.sg.by.customer") : t("jb.sg.by.nobody");
  const crewMember = snag.raised_by_id !== null && crews.members.some((member) => member.user_id === snag.raised_by_id);
  const stops = live && truthy(snag.stops_sign_off);
  const move = async (action: "put-right" | "wait-for-part", values?: Record<string, unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const saved = await toasts.say(session.act("snags", snag.id, action, snag.state, values === undefined ? {} : { values }), () => t(action === "put-right" ? "jb.sg.fixed" : "jb.sg.waiting", { job: snag.code ?? "" }));
    setBusy(false);
    if (saved !== null) {
      setFixing(false);
      onDone();
    }
  };
  return (
    <li className="crm-jb-row mr-card" data-snag={snag.id} data-state={snag.state} data-tone={!live ? "pos" : stops ? "danger" : "warn"}>
      <div className="crm-jb-row-top">
        <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
          {initials(snag.site ?? "?")}
        </span>
        <div className="crm-jb-row-words">
          <strong>{snag.text}</strong>
          <div className="crm-jb-quiet">{[snag.site, [snag.code, snag.title].filter((part) => part !== null).join(" · ")].filter((part) => part !== null && part !== "").join(" · ")}</div>
          <div className="crm-jb-quiet">
            {t(ago === 0 ? "jb.sg.raised.today" : ago === 1 ? "jb.sg.raised.yesterday" : "jb.sg.raised.ago", { count: f.number(ago ?? 0), by: crewMember ? t("jb.sg.by.crew", { name: by }) : by }, ago ?? 0)}
          </div>
          {snag.put_right_note !== null && snag.put_right_note !== "" && <div className="crm-jb-note">{snag.put_right_note}</div>}
        </div>
        <div className="crm-jb-row-end">
          <span className="crm-pill" data-tone={!live ? "pos" : snag.state === "open" ? "danger" : "warn"}>
            <Icon name={!live ? "check" : snag.state === "open" ? "circle-dot" : "truck"} size={12} />
            {t(`jb.sg.state.${snag.state}`)}
          </span>
          {stops && (
            <span className="crm-pill" data-tone="danger">
              {t("jb.sg.stops")}
            </span>
          )}
          <span className="crm-mono" data-tone={late ? "danger" : undefined}>
            {!live ? t("jb.sg.closed", { day: snag.put_right_on === null ? "" : f.date(noonOf(dayKeyOf(snag.put_right_on)!)) }) : due === null ? "" : t(late ? "jb.sg.wasDue" : "jb.sg.due", { day: f.dayShort(noonOf(due)) })}
          </span>
        </div>
      </div>
      {live && canWork && !fixing && (
        <div className="crm-jb-row-acts">
          <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="fix" disabled={busy} onClick={() => setFixing(true)}>
            <Icon name="check" size={13} />
            {t("jb.sg.fix")}
          </button>
          {snag.state === "open" && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="part" disabled={busy} onClick={() => void move("wait-for-part")}>
              <Icon name="truck" size={13} />
              {t("jb.sg.part")}
            </button>
          )}
        </div>
      )}
      {fixing && (
        <div className="crm-jb-fix" data-testid="jb-sg-fix">
          <label className="crm-label" htmlFor={`crm-jb-fix-${String(snag.id)}`}>
            {t("jb.sg.fix.what")}
          </label>
          <input
            id={`crm-jb-fix-${String(snag.id)}`}
            className="crm-input mr-fld"
            autoFocus
            value={note}
            maxLength={400}
            disabled={busy}
            placeholder={t("jb.sg.fix.hint")}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && note.trim() !== "") void move("put-right", { put_right_note: note.trim() });
              if (event.key === "Escape") setFixing(false);
            }}
          />
          <div className="crm-jb-row-acts">
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy} onClick={() => setFixing(false)}>
              {t("ui.close")}
            </button>
            <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" disabled={busy || note.trim() === ""} onClick={() => void move("put-right", { put_right_note: note.trim() })}>
              {busy ? t("ui.saving") : t("jb.sg.fix.go")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
