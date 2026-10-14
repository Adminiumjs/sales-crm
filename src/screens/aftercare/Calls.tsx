/**
 * AFTERCARE CALLS (ledger screen 62): a call a few weeks after each job, owned
 * by the account manager, and what came of the ones made.
 *
 * Every count is the server's, for the reader's own calls; "past due" and
 * "coming up" are told apart by the server's clock. "Made the call" asks what
 * came of it and saves the call as made once (two people pressing at once make
 * one), reading the row back after a lost reply before it says anything.
 */
import { useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { useFacts } from "../aftersale/common.tsx";
import { RecordName } from "../territory/Name.tsx";
import { Chips, CoTile, daysWord, Empty, jobLabel, keyOf, Stat } from "./common.tsx";
import { doneOn, makeCall, OUTCOMES, readCalls, type Call, type CallState, type Calls as CallsData, type Outcome } from "./data.ts";

type Filter = "all" | CallState;
const OUTCOME_ICON: Record<Outcome, string> = { none: "check", "more-work": "trending-up", fault: "wrench", complaint: "frown" };
const OUTCOME_TONE: Record<Outcome, string> = { none: "muted", "more-work": "pos", fault: "warn", complaint: "danger" };

export function Calls(_props: ScreenProps) {
  const t = useT();
  const { session } = useFacts();
  const toasts = useToasts();
  const { load, reload } = useLoad(() => readCalls(session), [session]);
  const again = useCoalesced(reload);
  useLive(["follow_ups"], again);
  const [filter, setFilter] = useState<Filter>("all");
  const [making, setMaking] = useState<Call | null>(null);
  const canMake = session.can("follow_ups", "update");

  return (
    <div className="crm-screen crm-ac mr-screen" data-screen="aftercare">
      <h1>{t("nav.item.aftercare")}</h1>
      <p className="crm-screen-sub">{t("ac.calls.sub")}</p>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={5} height={96} />}>
        {(data) => <CallsBody data={data} filter={filter} setFilter={setFilter} canMake={canMake} onMake={setMaking} busy={load.state === "ready" && load.again} />}
      </Loaded>
      {making !== null && (
        <MakeCall
          call={making}
          onClose={() => setMaking(null)}
          onSave={async (outcome) => {
            const slow = setTimeout(() => toasts.show(t("ui.checking"), "plain", true), 1200);
            const ended = await makeCall(session, making.id, outcome).finally(() => clearTimeout(slow));
            if (ended.state === "saved") toasts.show(ended.mine ? t("ac.calls.toast", { job: jobLabel(t, making.job, (making.callNo ?? 1) > 1) }) : t("ac.calls.already"), "pos");
            else if (ended.state === "refused") toasts.show(t("ui.refused", { reason: reasonOf(ended.error, t) }), "danger", true);
            else toasts.show(t("ui.unknown"), "danger", true);
            setMaking(null);
            again();
          }}
        />
      )}
    </div>
  );
}

function CallsBody({ data, filter, setFilter, canMake, onMake, busy }: { data: CallsData; filter: Filter; setFilter: (filter: Filter) => void; canMake: boolean; onMake: (call: Call) => void; busy: boolean }) {
  const t = useT();
  const { f, session } = useFacts();
  // The server's clock: a call is late by whole days of the business's calendar, at least one.
  const now = session.now();
  const oldestLate = data.rows.find((row) => row.state === "late") ?? null;
  const shown = data.rows.filter((row) => filter === "all" || row.state === filter);
  const day = (key: string | null): string => (key === null ? "" : f.date(noonOf(key)));
  return (
    <>
      {data.settings.aftercareDays !== null && <p className="crm-ac-rule">{t("ac.calls.rule", { days: daysWord(t, f, data.settings.aftercareDays) })}</p>}
      <div className="crm-stats crm-ac-stats">
        <Stat testId="ac-late" tone={data.late > 0 ? "danger" : "pos"} label={t("ac.calls.late")} value={f.number(data.late)} sub={t(data.late > 0 ? "ac.calls.late.some" : "ac.calls.late.none")} />
        <Stat testId="ac-soon" label={t("ac.calls.soon")} value={f.number(data.soon)} sub={t("ac.calls.soon.sub")} />
        <Stat testId="ac-more" tone="pos" label={t("ac.calls.more")} value={f.number(data.moreWork)} sub={t("ac.calls.more.sub", { made: f.number(data.made), total: f.number(data.total) })} />
      </div>
      {data.late > 0 && (
        <div className="crm-ac-banner" data-tone="danger" role="status" data-testid="ac-over">
          <Icon name="phone-off" size={15} />
          <span>{t("ac.calls.over", { count: f.number(data.late), day: oldestLate === null ? "" : f.date(new Date(oldestLate.dueAt)) }, data.late)}</span>
        </div>
      )}
      <Chips
        label={t("ac.filters")}
        value={filter}
        onPick={setFilter}
        chips={[
          { key: "all", label: t("ac.filter.all"), count: data.total },
          { key: "late", label: t("ac.calls.filter.late"), count: data.late },
          { key: "soon", label: t("ac.calls.filter.soon"), count: data.soon },
          { key: "made", label: t("ac.calls.filter.made"), count: data.made },
        ]}
      />
      {!canMake && data.rows.some((row) => !row.done) && <p className="crm-ac-note">{t("ac.calls.notYours")}</p>}
      <ul className="crm-ac-list" aria-busy={busy}>
        {shown.map((call) => {
          const job = call.job;
          const done = doneOn(job);
          const lateDays = call.state === "late" ? Math.max(1, f.dayDiff(new Date(call.dueAt), now)) : 0;
          return (
            <li key={call.id} className="crm-ac-card mr-card" data-call={call.id} data-state={call.state} data-job={job?.code ?? ""}>
              <div className="crm-ac-head">
                <CoTile name={job?.company ?? null} />
                <div className="crm-ac-main">
                  <div className="crm-ac-title">
                    <span className="crm-ac-what">{jobLabel(t, job, (call.callNo ?? 1) > 1)}</span>
                    <span className="crm-pill" data-tone={call.state === "made" ? "pos" : call.state === "late" ? "danger" : undefined} data-testid="ac-state">
                      {call.state === "made" ? t("ac.calls.state.made") : call.state === "late" ? t("ac.calls.state.late", { count: f.number(lateDays) }, lateDays) : t("ac.calls.state.soon")}
                    </span>
                  </div>
                  <div className="crm-ac-meta">
                    {job?.company !== null && job !== null && (
                      <RecordName kind="company" id={job.companyId} className="crm-ac-co">
                        {job.company}
                      </RecordName>
                    )}
                    {job?.contact != null && <span>{job.contact}</span>}
                    {done !== null && <span className="crm-mono crm-ac-day">{t(job?.signedAt != null ? "ac.calls.signed" : "ac.calls.fitted", { day: day(done) })}</span>}
                  </div>
                  {call.text !== null && <p className="crm-ac-note-line">{call.text}</p>}
                </div>
                <div className="crm-ac-end">
                  <span className="crm-mono crm-ac-due" data-late={call.state === "late" ? "1" : "0"} data-testid="ac-due">
                    {call.done && call.doneAt !== null ? t("ac.calls.madeOn", { day: f.date(new Date(call.doneAt)) }) : t("ac.calls.due", { day: f.date(new Date(call.dueAt)) })}
                  </span>
                  {call.ownerId !== null && (
                    <span className="crm-ac-who">
                      <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                        {initials(data.names[call.ownerId] ?? "?")}
                      </span>
                      {firstName(data.names[call.ownerId] ?? t("ac.someone"))}
                    </span>
                  )}
                </div>
              </div>
              {(call.outcome !== null || (!call.done && canMake)) && (
                <div className="crm-ac-foot">
                  {call.done && call.outcome !== null && (
                    <span className="crm-ac-outcome" data-tone={OUTCOME_TONE[call.outcome]} data-testid="ac-outcome">
                      <Icon name={OUTCOME_ICON[call.outcome]} size={13} />
                      {t(keyOf(`ac.outcome.${call.outcome}`))}
                    </span>
                  )}
                  {!call.done && canMake && (
                    <button type="button" className="crm-btn crm-btn-primary crm-ac-btn mr-btn" onClick={() => onMake(call)}>
                      <Icon name="phone" size={14} />
                      {t("ac.calls.make")}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data.rows.length === 0 ? (
        <Empty icon={<Icon name="phone-call" size={21} />} title={t("ac.calls.empty")} body={t("ac.calls.empty.body")} />
      ) : (
        shown.length === 0 && <Empty icon={<Icon name="phone-call" size={21} />} title={t("ac.filtered.empty")} />
      )}
      {data.cut && <p className="crm-ac-note">{t("ac.cut")}</p>}
    </>
  );
}

function MakeCall({ call, onClose, onSave }: { call: Call; onClose: () => void; onSave: (outcome: Outcome) => Promise<void> }) {
  const t = useT();
  const [outcome, setOutcome] = useState<Outcome>("none");
  const [busy, setBusy] = useState(false);
  const job = call.job;
  return (
    <Dialog
      shape="box"
      name="make-call"
      icon="phone-call"
      tone="accent"
      title={t("ac.calls.make")}
      subtitle={[jobLabel(t, job, (call.callNo ?? 1) > 1), job?.company].filter((part) => part != null && part !== "").join(" · ")}
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
            onClick={() => {
              setBusy(true);
              void onSave(outcome);
            }}
          >
            {busy ? t("ui.saving") : t("ac.calls.dialog.save")}
          </button>
        </>
      }
    >
      <div className="crm-label" id="crm-ac-outcome">
        {t("ac.calls.dialog.what")}
      </div>
      <div className="crm-why-list" role="radiogroup" aria-labelledby="crm-ac-outcome">
        {OUTCOMES.map((one, i) => (
          <button key={one} type="button" role="radio" aria-checked={outcome === one} className="crm-why-item mr-row" disabled={busy} onClick={() => setOutcome(one)} {...(i === 0 ? { "data-autofocus": true } : {})}>
            <span className="crm-why-dot" />
            {t(keyOf(`ac.outcome.${one}`))}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
