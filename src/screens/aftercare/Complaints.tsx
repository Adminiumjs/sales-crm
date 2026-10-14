/**
 * CUSTOMER COMPLAINTS (ledger screen 56): somebody let down, what it was
 * about, and whether we have answered and put it right.
 *
 * Every count is the server's, for the reader's own complaints; "overdue an
 * answer" is the complaints still open on or before the day the setting's
 * days back from the server's today. "Answer it" moves a complaint on from
 * open with what we told them; "Settled" moves it on from answered. Each move
 * names the state it starts from, so a complaint a colleague moved meanwhile
 * is refused, and a lost reply is read back before anything is said.
 */
import { useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { useFacts } from "../aftersale/common.tsx";
import { RecordName } from "../territory/Name.tsx";
import { ageOf, Chips, CoTile, daysWord, Empty, keyOf, Stat } from "./common.tsx";
import { answerComplaint, COMPLAINT_STATES, daysBetween, readComplaints, settleComplaint, type Cause, type Complaint, type Complaints as ComplaintsData, type ComplaintState } from "./data.ts";

type Filter = "all" | ComplaintState;
export const CAUSE_ICON: Record<Cause, string> = { late: "clock-alert", damaged: "package-x", wrong: "circle-off", crew: "users", silence: "message-square-off" };
const STATE_TONE: Record<ComplaintState, string | undefined> = { open: "danger", answered: "info", settled: "pos" };

export function Complaints(_props: ScreenProps) {
  const t = useT();
  const { session, today } = useFacts();
  const toasts = useToasts();
  const { load, reload } = useLoad(() => readComplaints(session, today), [session, today]);
  const again = useCoalesced(reload);
  useLive(["complaints"], again);
  const [filter, setFilter] = useState<Filter>("all");
  const [answering, setAnswering] = useState<Complaint | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const canWork = session.can("complaints", "update");

  const settle = async (row: Complaint): Promise<void> => {
    setBusy(row.id);
    await toasts.say(settleComplaint(session, row.id), () => t("ac.cp.settle.toast"));
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-ac mr-screen" data-screen="complaints">
      <h1>{t("nav.item.complaints")}</h1>
      <p className="crm-screen-sub">{t("ac.cp.sub")}</p>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={5} height={110} />}>
        {(data) => <ComplaintsBody data={data} filter={filter} setFilter={setFilter} canWork={canWork} busy={busy} onAnswer={setAnswering} onSettle={(row) => void settle(row)} again={load.state === "ready" && load.again} />}
      </Loaded>
      {answering !== null && (
        <AnswerIt
          row={answering}
          onClose={() => setAnswering(null)}
          onSaved={() => {
            setAnswering(null);
            again();
          }}
        />
      )}
    </div>
  );
}

function ComplaintsBody({ data, filter, setFilter, canWork, busy, onAnswer, onSettle, again }: { data: ComplaintsData; filter: Filter; setFilter: (filter: Filter) => void; canWork: boolean; busy: number | null; onAnswer: (row: Complaint) => void; onSettle: (row: Complaint) => void; again: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const { f, today } = useFacts();
  const shown = data.rows.filter((row) => filter === "all" || row.state === filter);
  const wait = daysWord(t, f, data.settings.answerDays);
  const causes = new Intl.ListFormat(locale, { type: "conjunction" }).format(data.topCauses.map((cause) => t(keyOf(`ac.cause.${cause}`))));
  return (
    <>
      <div className="crm-stats crm-ac-stats">
        <Stat testId="cp-open" tone={data.byState.open === 0 ? "pos" : "danger"} label={t("ac.cp.open")} value={f.number(data.byState.open)} sub={t(data.byState.open > 0 ? "ac.cp.open.some" : "ac.cp.open.none")} />
        <Stat testId="cp-slow" tone={data.slow === 0 ? "pos" : "danger"} label={t("ac.cp.slow")} value={f.number(data.slow)} sub={data.slow > 0 ? t("ac.cp.slow.some") : t("ac.cp.slow.none", { wait })} />
        <Stat
          testId="cp-top"
          label={t("ac.cp.top")}
          value={f.number(data.topCount)}
          sub={data.topCauses.length === 0 ? t("ac.cp.top.none") : t("ac.cp.top.sub", { causes, onJob: f.number(data.onJob), before: f.number(data.beforeJob) })}
        />
      </div>
      {data.slow > 0 && (
        <div className="crm-ac-banner" data-tone="danger" role="status" data-testid="cp-slow-line">
          <Icon name="clock-alert" size={15} />
          <span>{t("ac.cp.slowLine", { count: f.number(data.slow), wait }, data.slow)}</span>
        </div>
      )}
      <Chips
        label={t("ac.filters")}
        value={filter}
        onPick={setFilter}
        chips={[{ key: "all" as Filter, label: t("ac.filter.all"), count: data.total }, ...COMPLAINT_STATES.map((state) => ({ key: state as Filter, label: t(keyOf(`ac.cp.filter.${state}`)), count: data.byState[state] }))]}
      />
      <ul className="crm-ac-list" aria-busy={again}>
        {shown.map((row) => {
          const owner = row.ownerId === null ? null : (data.names[row.ownerId] ?? null);
          const waiting = row.raisedOn === null ? 0 : daysBetween(row.raisedOn, today);
          const late = row.state === "open" && waiting >= data.settings.answerDays;
          return (
            <li key={row.id} className="crm-ac-card mr-card" data-complaint={row.id} data-state={row.state} data-tone={row.state === "open" ? (row.fairness === "serious" ? "danger" : row.fairness === "fair" ? "warn" : undefined) : row.state === "answered" ? "info" : "pos"}>
              <div className="crm-ac-head">
                <CoTile name={row.company} />
                <div className="crm-ac-main">
                  <div className="crm-ac-title">
                    <span className="crm-ac-what">{row.cause === null ? (row.company ?? "") : t(keyOf(`ac.cause.${row.cause}`))}</span>
                    <span className="crm-pill" data-tone={STATE_TONE[row.state]} data-testid="cp-state">
                      {t(keyOf(`ac.cp.state.${row.state}`))}
                    </span>
                  </div>
                  <div className="crm-ac-meta">
                    {row.company !== null && (
                      <RecordName kind="company" id={row.companyId} className="crm-ac-co">
                        {row.jobCode === null ? row.company : `${row.jobCode} · ${row.company}`}
                      </RecordName>
                    )}
                    {row.contact !== null && <span>{row.contactTitle === null ? row.contact : `${row.contact} · ${row.contactTitle}`}</span>}
                    <span className="crm-mono crm-ac-day" data-late={late ? "1" : "0"} data-testid="cp-age">
                      {ageOf(t, f, row.raisedOn, today)}
                    </span>
                  </div>
                  {row.text !== null && <blockquote className="crm-ac-said">{row.text}</blockquote>}
                </div>
                {owner !== null && (
                  <span className="crm-ac-who">
                    <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                      {initials(owner)}
                    </span>
                    {firstName(owner)}
                  </span>
                )}
              </div>
              {row.answer !== null && (
                <div className="crm-ac-answer" data-testid="cp-answer">
                  <Icon name="corner-down-right" size={14} />
                  <span>{row.answer}</span>
                </div>
              )}
              <div className="crm-ac-foot">
                {row.fairness !== null && (
                  <span className="crm-ac-fair" data-tone={row.fairness}>
                    {t(keyOf(`ac.fair.${row.fairness}`))}
                  </span>
                )}
                {canWork && row.state === "open" && (
                  <button type="button" className="crm-btn crm-btn-primary crm-ac-btn mr-btn" disabled={busy !== null} onClick={() => onAnswer(row)}>
                    <Icon name="message-square" size={14} />
                    {t("ac.cp.answer")}
                  </button>
                )}
                {canWork && row.state === "answered" && (
                  <button type="button" className="crm-btn crm-btn-ghost crm-ac-btn mr-gi" data-tone="pos" disabled={busy !== null} aria-busy={busy === row.id} onClick={() => onSettle(row)}>
                    <Icon name="check" size={14} />
                    {busy === row.id ? t("ui.saving") : t("ac.cp.settle")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {data.rows.length === 0 ? <Empty icon={<Icon name="frown" size={21} />} title={t("ac.cp.empty")} body={t("ac.cp.empty.body")} /> : shown.length === 0 && <Empty icon={<Icon name="frown" size={21} />} title={t("ac.filtered.empty")} />}
      {!canWork && data.rows.length > 0 && <p className="crm-ac-note">{t("ac.readOnly")}</p>}
      {data.cut && <p className="crm-ac-note">{t("ac.cut")}</p>}
    </>
  );
}

function AnswerIt({ row, onClose, onSaved }: { row: Complaint; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { session } = useFacts();
  const toasts = useToasts();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      shape="box"
      name="answer-complaint"
      icon="message-square"
      tone="accent"
      title={t("ac.cp.answer")}
      subtitle={[row.company, row.contact].filter((part) => part !== null).join(" · ")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button
            type="button"
            className="crm-btn crm-btn-primary crm-btn-44 mr-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const done = await toasts.say(answerComplaint(session, row.id, answer), () => t("ac.cp.answer.toast"));
              setBusy(false);
              if (done !== null) onSaved();
            }}
          >
            {busy ? t("ui.saving") : t("ac.cp.answer.save")}
          </button>
        </>
      }
    >
      {row.text !== null && <blockquote className="crm-ac-said">{row.text}</blockquote>}
      <label className="crm-label" htmlFor="crm-ac-answer">
        {t("ac.cp.answer.field")}
      </label>
      <textarea id="crm-ac-answer" className="crm-input crm-textarea mr-fld" value={answer} maxLength={2000} disabled={busy} onChange={(event) => setAnswer(event.target.value)} />
      <p className="crm-field-note">{t("ac.cp.answer.hint")}</p>
    </Dialog>
  );
}
