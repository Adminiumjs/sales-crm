/**
 * WHAT CUSTOMERS SAID (ledger screen 47), with "Add an answer" (the critique's
 * P29): the answers customers gave after a job, their scores, the themes that
 * come up most, and whether somebody has thanked them.
 *
 * The survey e-mail that would ask for these (e-mail 18) waits for the Forms &
 * surveys add-on, so an answer is typed in by hand, by whoever may add one
 * (the account manager and the CRM admin): one a job, and only for a job that
 * was signed off and has none. Every figure is the server's; the theme bars
 * divide a theme's count by the answers' count, two figures it gave.
 */
import { useMemo, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { readNames } from "../quotes/data.ts";
import { useFacts } from "../aftersale/common.tsx";
import { RecordName } from "../territory/Name.tsx";
import { Chips, CoTile, Empty, jobLabel, Stat } from "./common.tsx";
import { addAnswer, ANSWER_FILTERS, inAnswerFilter, readFeedback, sayThanks, type Answer, type AnswerFilter, type Feedback as FeedbackData, type Job } from "./data.ts";

const FILTER_KEY = { all: "ac.filter.all", high: "ac.fb.filter.high", low: "ac.fb.filter.low", unreplied: "ac.fb.filter.unreplied" } as const;

export function Feedback(_props: ScreenProps) {
  const t = useT();
  const { session } = useFacts();
  const toasts = useToasts();
  const { load, reload } = useLoad(async () => {
    const data = await readFeedback(session);
    const names = await readNames(session, data.rows.map((row) => row.job?.ownerId ?? null));
    return { ...data, names };
  }, [session]);
  const again = useCoalesced(reload);
  useLive(["feedback"], again);
  const [filter, setFilter] = useState<AnswerFilter>("all");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const canAdd = session.can("feedback", "create");
  const canThank = session.can("feedback", "update");

  const thank = async (row: Answer): Promise<void> => {
    setBusy(row.id);
    const slow = setTimeout(() => toasts.show(t("ui.checking"), "plain", true), 1200);
    const ended = await sayThanks(session, row.id).finally(() => clearTimeout(slow));
    setBusy(null);
    const name = row.job?.contact ?? t("ac.someone");
    if (ended.state === "saved") toasts.show(t(ended.mine ? "ac.fb.thank.toast" : "ac.fb.thank.already", { name }), "pos");
    else if (ended.state === "refused") toasts.show(t("ui.refused", { reason: reasonOf(ended.error, t) }), "danger", true);
    else toasts.show(t("ui.unknown"), "danger", true);
    again();
  };

  return (
    <div className="crm-screen crm-ac mr-screen" data-screen="feedback">
      <div className="crm-screen-head">
        <div>
          <h1>{t("nav.item.feedback")}</h1>
          <p className="crm-screen-sub">{t("ac.fb.sub")}</p>
        </div>
        {canAdd && (
          <div className="crm-screen-actions">
            <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              {t("ac.fb.add")}
            </button>
          </div>
        )}
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={5} height={110} />}>
        {(data) => <FeedbackBody data={data} names={data.names} filter={filter} setFilter={setFilter} canThank={canThank} busy={busy} onThank={(row) => void thank(row)} again={load.state === "ready" && load.again} />}
      </Loaded>
      {adding && load.state === "ready" && <AddAnswer waiting={load.data.waiting} themes={load.data.themes.flatMap((one) => (one.theme === null ? [] : [one.theme]))} onClose={() => setAdding(false)} onSaved={() => again()} />}
    </div>
  );
}

function FeedbackBody({ data, names, filter, setFilter, canThank, busy, onThank, again }: { data: FeedbackData; names: Record<string, string>; filter: AnswerFilter; setFilter: (filter: AnswerFilter) => void; canThank: boolean; busy: number | null; onThank: (row: Answer) => void; again: boolean }) {
  const t = useT();
  const { f } = useFacts();
  const shown = data.rows.filter((row) => inAnswerFilter(row, filter));
  const counts: Record<AnswerFilter, number> = { all: data.count, high: data.high, low: data.low, unreplied: data.unreplied };
  // The average to one place, as the design writes a score.
  const average = data.average === null ? null : Math.round(data.average * 10) / 10;
  return (
    <>
      {data.waiting !== null && (
        <p className="crm-ac-rule" data-testid="fb-waiting">
          {data.waiting.length === 0 ? t("ac.fb.waiting.none") : t("ac.fb.waiting", { jobs: data.waiting.map((job) => job.code ?? t("ac.job.hidden")).join(", ") })}
        </p>
      )}
      <p className="crm-ac-rule">{t("ac.fb.byHand")}</p>
      <div className="crm-stats crm-ac-stats">
        <Stat testId="fb-avg" tone="pos" label={t("ac.fb.avg")} value={average === null ? "—" : t("ac.fb.score", { score: f.number(average) })} sub={t("ac.fb.avg.sub", { count: f.number(data.count) }, data.count)} />
        <Stat testId="fb-replied" tone={data.replied === data.count ? "pos" : "warn"} label={t("ac.fb.replied")} value={t("ac.fb.of", { n: f.number(data.replied), all: f.number(data.count) })} sub={t("ac.fb.replied.sub")} />
        <Stat testId="fb-low" tone={data.low === 0 ? "pos" : "warn"} label={t("ac.fb.low")} value={f.number(data.low)} sub={data.low === 0 ? t("ac.fb.low.none") : t("ac.fb.low.sub", { fixed: f.number(data.lowFixed), low: f.number(data.low) })} />
      </div>

      <div className="crm-ac-grid">
        <div className="crm-ac-col">
          <Chips label={t("ac.filters")} value={filter} onPick={setFilter} chips={ANSWER_FILTERS.map((key) => ({ key, label: t(FILTER_KEY[key]), count: counts[key] }))} />
          <ul className="crm-ac-list" aria-busy={again}>
            {shown.map((row) => {
              const job = row.job;
              const tone = row.score >= 4 ? "pos" : "warn";
              const repliedAt = row.repliedAt === null ? null : new Date(row.repliedAt);
              const owner = job?.ownerId == null ? null : (names[job.ownerId] ?? null);
              return (
                <li key={row.id} className="crm-ac-card mr-card" data-answer={row.id} data-job={job?.code ?? ""} data-tone={tone}>
                  <div className="crm-ac-head">
                    <CoTile name={job?.company ?? null} />
                    <div className="crm-ac-main">
                      <div className="crm-ac-title">
                        <span className="crm-ac-what">{jobLabel(t, job)}</span>
                      </div>
                      <div className="crm-ac-meta">
                        {job !== null && job.company !== null && (
                          <RecordName kind="company" id={job.companyId} className="crm-ac-co">
                            {job.company}
                          </RecordName>
                        )}
                        {row.answeredOn !== null && <span className="crm-mono crm-ac-day">{t("ac.fb.answered", { day: f.date(noonOf(row.answeredOn)) })}</span>}
                      </div>
                    </div>
                    <span className="crm-ac-score crm-mono" data-tone={tone} data-testid="fb-score">
                      {t("ac.fb.score", { score: f.number(row.score) })}
                    </span>
                  </div>
                  {row.text !== null && <blockquote className="crm-ac-said">{row.text}</blockquote>}
                  <div className="crm-ac-people">
                    {job?.contact != null && (
                      <span className="crm-ac-who">
                        <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                          {initials(job.contact)}
                        </span>
                        {job.contactTitle === null ? job.contact : `${job.contact} · ${job.contactTitle}`}
                      </span>
                    )}
                    {owner !== null && (
                      <span className="crm-ac-who crm-ac-quiet">
                        <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                          {initials(owner)}
                        </span>
                        {firstName(owner)}
                      </span>
                    )}
                    {row.theme !== null && <span className="crm-chip crm-ac-theme">{row.theme}</span>}
                  </div>
                  {row.fix !== null && (
                    <div className="crm-ac-fix" data-testid="fb-fix">
                      <Icon name="wrench" size={14} />
                      <span>{row.fix}</span>
                    </div>
                  )}
                  <div className="crm-ac-foot">
                    {repliedAt !== null ? (
                      <span className="crm-pill" data-tone="pos" data-testid="fb-thanked">
                        <Icon name="send" size={13} />
                        {t("ac.fb.thanked", { day: f.dayShort(repliedAt), time: f.time(repliedAt) })}
                      </span>
                    ) : canThank ? (
                      <button type="button" className="crm-btn crm-btn-ghost crm-ac-btn mr-gi" disabled={busy !== null} aria-busy={busy === row.id} onClick={() => onThank(row)}>
                        <Icon name="send" size={14} />
                        {t(busy === row.id ? "ui.saving" : "ac.fb.thank")}
                      </button>
                    ) : (
                      <span className="crm-ac-quiet">{t("ac.fb.notThanked")}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {data.rows.length === 0 ? <Empty icon={<Icon name="star" size={21} />} title={t("ac.fb.empty")} body={t("ac.fb.byHand")} /> : shown.length === 0 && <Empty icon={<Icon name="star" size={21} />} title={t("ac.filtered.empty")} />}
          {canThank && data.rows.length > 0 && <p className="crm-ac-note">{t("ac.fb.thank.note")}</p>}
          {data.cut && <p className="crm-ac-note">{t("ac.cut")}</p>}
        </div>

        <aside className="crm-ac-col">
          <section className="crm-ac-themes mr-card" aria-labelledby="crm-ac-themes-title" data-testid="fb-themes">
            <h2 id="crm-ac-themes-title">{t("ac.fb.themes")}</h2>
            {data.themes.length === 0 ? (
              <p className="crm-ac-quiet">{t("ac.fb.empty")}</p>
            ) : (
              <ul>
                {data.themes.map((one) => (
                  <li key={one.theme ?? ""} data-theme={one.theme ?? ""}>
                    <div className="crm-ac-theme-line">
                      <span>{one.theme ?? t("ac.fb.theme.none")}</span>
                      <span className="crm-mono" data-testid="fb-theme-n">
                        {f.number(one.n)}
                      </span>
                    </div>
                    <span className="crm-ac-bar" aria-hidden="true">
                      <span style={{ inlineSize: `${String(data.count === 0 ? 0 : Math.round((one.n / data.count) * 100))}%` }} data-none={one.theme === null ? "1" : "0"} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

/**
 * ADD AN ANSWER. The jobs offered are the signed-off ones with no answer yet;
 * the server refuses a second answer for a job whichever way it is sent. The
 * key is made once for the dialog, so a lost reply sent again is one answer.
 */
function AddAnswer({ waiting, themes, onClose, onSaved }: { waiting: Job[] | null; themes: string[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { session, f, today } = useFacts();
  const toasts = useToasts();
  const key = useMemo(() => newClientKey(), []);
  const [jobId, setJobId] = useState<number | null>(waiting !== null && waiting.length === 1 ? waiting[0]!.id : null);
  const [score, setScore] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [theme, setTheme] = useState("");
  const [on, setOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const none = waiting !== null && waiting.length === 0;
  const ready = jobId !== null && score !== null && on !== "";

  const save = async (): Promise<void> => {
    setTried(true);
    if (!ready) return;
    setBusy(true);
    const job = waiting?.find((one) => one.id === jobId) ?? null;
    const made = await toasts.say(addAnswer(session, { jobId, score, text, theme, answeredOn: on }, key), () => t("ac.fb.add.toast", { job: job?.code ?? jobLabel(t, job) }));
    setBusy(false);
    if (made !== null) {
      onSaved();
      onClose();
    }
  };

  return (
    <Dialog
      shape="sheet"
      name="add-answer"
      icon="star"
      tone="accent"
      title={t("ac.fb.add")}
      subtitle={t("ac.fb.add.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" disabled={busy || none} onClick={() => void save()}>
            {busy ? t("ui.saving") : t("ac.fb.add.save")}
          </button>
        </>
      }
    >
      {none ? (
        <p className="crm-field-note">{t("ac.fb.add.none")}</p>
      ) : (
        <>
          <label className="crm-label" htmlFor="crm-ac-job">
            {t("ac.fb.add.job")}
          </label>
          <select id="crm-ac-job" className="crm-input mr-fld" value={jobId ?? ""} disabled={busy} data-autofocus onChange={(event) => setJobId(event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">{t("ac.fb.add.job.pick")}</option>
            {(waiting ?? []).map((job) => (
              <option key={job.id} value={job.id}>
                {[jobLabel(t, job), job.company].filter((part) => part !== null && part !== "").join(" · ")}
              </option>
            ))}
          </select>

          <div className="crm-label" id="crm-ac-score">
            {t("ac.fb.add.score")}
          </div>
          <div className="crm-ac-scores" role="radiogroup" aria-labelledby="crm-ac-score">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={score === n} className="crm-ac-scorepick mr-chip" disabled={busy} onClick={() => setScore(n)}>
                {f.number(n)}
              </button>
            ))}
          </div>

          <label className="crm-label" htmlFor="crm-ac-said">
            {t("ac.fb.add.text")}
          </label>
          <textarea id="crm-ac-said" className="crm-input crm-textarea mr-fld" value={text} maxLength={2000} disabled={busy} onChange={(event) => setText(event.target.value)} />

          <label className="crm-label" htmlFor="crm-ac-theme">
            {t("ac.fb.add.theme")}
          </label>
          <input id="crm-ac-theme" className="crm-input mr-fld" value={theme} maxLength={160} list="crm-ac-themes" disabled={busy} onChange={(event) => setTheme(event.target.value)} />
          <datalist id="crm-ac-themes">
            {themes.map((one) => (
              <option key={one} value={one} />
            ))}
          </datalist>
          <p className="crm-field-note">{t("ac.fb.add.theme.hint")}</p>

          <label className="crm-label" htmlFor="crm-ac-on">
            {t("ac.fb.add.on")}
          </label>
          <input id="crm-ac-on" type="date" className="crm-input mr-fld" value={on} max={today} disabled={busy} onChange={(event) => setOn(event.target.value)} />

          {tried && !ready && (
            <p className="crm-field-note crm-ac-alert" role="alert">
              {t("ac.fb.add.needs")}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
