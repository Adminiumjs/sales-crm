/**
 * WARRANTY CLAIMS (ledger screen 59): something we fitted failed; where each
 * claim stands with its supplier, and who paid to put it right.
 *
 * Every count is the server's, and "longest open" is the oldest running claim
 * in the server's own order, counted in days from the server's today. Per
 * claim the page works out, from two days the server gave, how long after the
 * fitting it was raised and whether the cover still held that day (the years
 * of cover from the day the job was fitted). The buttons are the moves the
 * table allows from where the claim stands: raise it with the supplier; parts
 * on the way; put right, saying who paid.
 */
import { useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { useFacts } from "../aftersale/common.tsx";
import { RecordName } from "../territory/Name.tsx";
import { Chips, CoTile, daysWord, Empty, keyOf, Stat } from "./common.tsx";
import { CLAIM_STATES, claimMoves, daysBetween, inCover, PAID_BY, partsComing, putRight, raiseClaim, readClaims, type Claim, type Claims as ClaimsData, type ClaimState, type PaidBy } from "./data.ts";

type Filter = "all" | ClaimState;
const STATE_TONE: Record<ClaimState, string | undefined> = { "to-raise": "danger", "with-supplier": "warn", "parts-coming": "info", sorted: "pos", "turned-down": undefined };
const KNOWN_COVER = new Set(["frame", "mechanism", "fabric"]);

export function Claims(_props: ScreenProps) {
  const t = useT();
  const { session } = useFacts();
  const toasts = useToasts();
  const { load, reload } = useLoad(() => readClaims(session), [session]);
  const again = useCoalesced(reload);
  useLive(["warranty_claims"], again);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<number | null>(null);
  const [putting, setPutting] = useState<Claim | null>(null);
  const canWork = session.can("warranty_claims", "update");

  const move = async (row: Claim, what: "raise" | "parts-coming"): Promise<void> => {
    setBusy(row.id);
    await toasts.say(what === "raise" ? raiseClaim(session, row.id) : partsComing(session, row.id), () => t(what === "raise" ? "ac.wc.raise.toast" : "ac.wc.parts.toast"));
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-ac mr-screen" data-screen="claims">
      <h1>{t("nav.item.claims")}</h1>
      <p className="crm-screen-sub">{t("ac.wc.sub")}</p>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={5} height={110} />}>
        {(data) => <ClaimsBody data={data} filter={filter} setFilter={setFilter} canWork={canWork} busy={busy} onMove={(row, what) => (what === "sorted" ? setPutting(row) : void move(row, what))} again={load.state === "ready" && load.again} />}
      </Loaded>
      {putting !== null && (
        <PutRight
          row={putting}
          onClose={() => setPutting(null)}
          onSaved={() => {
            setPutting(null);
            again();
          }}
        />
      )}
    </div>
  );
}

function ClaimsBody({ data, filter, setFilter, canWork, busy, onMove, again }: { data: ClaimsData; filter: Filter; setFilter: (filter: Filter) => void; canWork: boolean; busy: number | null; onMove: (row: Claim, what: "raise" | "parts-coming" | "sorted") => void; again: boolean }) {
  const t = useT();
  const { f, today } = useFacts();
  const shown = data.rows.filter((row) => filter === "all" || row.state === filter);
  const longest = data.oldest?.raisedOn == null ? null : daysBetween(data.oldest.raisedOn, today);
  const coverWord = (cover: string | null): string | null => (cover === null ? null : KNOWN_COVER.has(cover) ? t(keyOf(`ac.cover.${cover}`)) : cover);
  return (
    <>
      <div className="crm-stats crm-ac-stats">
        <Stat testId="wc-hand" tone={data.inHand === 0 ? "pos" : "warn"} label={t("ac.wc.inHand")} value={f.number(data.inHand)} sub={t("ac.wc.inHand.sub")} />
        <Stat
          testId="wc-longest"
          tone={longest !== null && longest > data.settings.claimRedDays ? "danger" : undefined}
          label={t("ac.wc.longest")}
          value={longest === null ? "—" : daysWord(t, f, longest)}
          sub={data.oldest === null ? t("ac.wc.longest.none") : (data.oldest.job?.company ?? data.oldest.what)}
        />
        <Stat testId="wc-us" label={t("ac.wc.us")} value={f.number(data.paid.us)} sub={t("ac.wc.us.sub", { supplier: f.number(data.paid.supplier), open: f.number(data.paid.open) })} />
      </div>
      {data.byState["to-raise"] > 0 && (
        <div className="crm-ac-banner" data-tone="danger" role="status" data-testid="wc-to-raise">
          <Icon name="send" size={15} />
          <span>{t("ac.wc.toRaise", { count: f.number(data.byState["to-raise"]) }, data.byState["to-raise"])}</span>
        </div>
      )}
      <Chips
        label={t("ac.filters")}
        value={filter}
        onPick={setFilter}
        chips={[{ key: "all" as Filter, label: t("ac.filter.all"), count: data.total }, ...CLAIM_STATES.map((state) => ({ key: state as Filter, label: t(keyOf(`ac.wc.state.${state}`)), count: data.byState[state] }))]}
      />
      <ul className="crm-ac-list" aria-busy={again}>
        {shown.map((row) => {
          const job = row.job;
          const fitted = job?.fittedOn ?? null;
          const after = fitted === null || row.raisedOn === null ? null : daysBetween(fitted, row.raisedOn);
          const covered = inCover(fitted, row.coverYears, row.raisedOn);
          const cover = coverWord(row.cover);
          const paid = row.paidBy === null ? "open" : row.paidBy;
          return (
            <li key={row.id} className="crm-ac-card mr-card" data-claim={row.id} data-state={row.state} data-job={job?.code ?? ""} data-tone={STATE_TONE[row.state]}>
              <div className="crm-ac-head">
                <CoTile name={job?.company ?? null} />
                <div className="crm-ac-main">
                  <div className="crm-ac-title">
                    <span className="crm-ac-what">{row.what}</span>
                    <span className="crm-pill" data-tone={STATE_TONE[row.state]} data-testid="wc-state">
                      {t(keyOf(`ac.wc.state.${row.state}`))}
                    </span>
                  </div>
                  <div className="crm-ac-meta">
                    {job !== null && job.company !== null ? (
                      <RecordName kind="company" id={job.companyId} className="crm-ac-co">
                        {job.code === null ? job.company : `${job.code} · ${job.company}`}
                      </RecordName>
                    ) : (
                      job?.code != null && <span>{job.code}</span>
                    )}
                    {row.contact !== null && <span>{row.contact}</span>}
                    {row.raisedOn !== null && <span className="crm-mono crm-ac-day">{t("ac.wc.raised", { day: f.date(noonOf(row.raisedOn)) })}</span>}
                  </div>
                </div>
                <div className="crm-ac-end">
                  {after !== null && (
                    <span className="crm-mono crm-ac-due" data-testid="wc-after">
                      {t("ac.wc.daysOn", { count: f.number(after) }, after)}
                    </span>
                  )}
                  {fitted !== null && <span className="crm-mono crm-ac-day">{t("ac.wc.fitted", { day: f.date(noonOf(fitted)) })}</span>}
                </div>
              </div>
              <div className="crm-ac-foot">
                {(row.part !== null || row.supplier !== null) && <span className="crm-ac-quiet">{[row.part, row.supplier].filter((part) => part !== null).join(" · ")}</span>}
                {cover !== null && (
                  <span className="crm-pill" data-tone={covered === true ? "pos" : undefined} data-testid="wc-cover">
                    {[row.coverYears === null ? cover : t("ac.wc.cover", { cover, years: t("ac.years", { count: f.number(row.coverYears) }, row.coverYears) }), covered === null ? null : t(covered ? "ac.wc.inCover" : "ac.wc.outOfCover")].filter((part) => part !== null).join(" · ")}
                  </span>
                )}
                <span className="crm-ac-paid" data-paid={paid} data-testid="wc-paid">
                  {t(keyOf(`ac.wc.paid.${paid}`))}
                </span>
                {canWork &&
                  claimMoves(row.state).map((what) => (
                    <button key={what} type="button" className={what === "parts-coming" ? "crm-btn crm-btn-ghost crm-ac-btn mr-gi" : "crm-btn crm-btn-primary crm-ac-btn mr-btn"} disabled={busy !== null} aria-busy={busy === row.id} onClick={() => onMove(row, what)}>
                      <Icon name={what === "raise" ? "send" : what === "parts-coming" ? "truck" : "check"} size={14} />
                      {busy === row.id ? t("ui.saving") : t(what === "raise" ? "ac.wc.raise" : what === "parts-coming" ? "ac.wc.parts" : "ac.wc.putRight")}
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
      {data.rows.length === 0 ? <Empty icon={<Icon name="shield-check" size={21} />} title={t("ac.wc.empty")} body={t("ac.wc.empty.body")} /> : shown.length === 0 && <Empty icon={<Icon name="shield-check" size={21} />} title={t("ac.filtered.empty")} />}
      {!canWork && data.rows.length > 0 && <p className="crm-ac-note">{t("ac.readOnly")}</p>}
      {data.cut && <p className="crm-ac-note">{t("ac.cut")}</p>}
    </>
  );
}

function PutRight({ row, onClose, onSaved }: { row: Claim; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { session } = useFacts();
  const toasts = useToasts();
  const [paid, setPaid] = useState<PaidBy>("supplier");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      shape="box"
      name="put-right"
      icon="check"
      tone="accent"
      title={t("ac.wc.putRight")}
      subtitle={row.what}
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
              const done = await toasts.say(putRight(session, row.id, paid), () => t("ac.wc.putRight.toast"));
              setBusy(false);
              if (done !== null) onSaved();
            }}
          >
            {busy ? t("ui.saving") : t("ac.wc.putRight.save")}
          </button>
        </>
      }
    >
      <div className="crm-label" id="crm-ac-paid">
        {t("ac.wc.putRight.who")}
      </div>
      <div className="crm-why-list" role="radiogroup" aria-labelledby="crm-ac-paid">
        {PAID_BY.map((one, i) => (
          <button key={one} type="button" role="radio" aria-checked={paid === one} className="crm-why-item mr-row" disabled={busy} onClick={() => setPaid(one)} {...(i === 0 ? { "data-autofocus": true } : {})}>
            <span className="crm-why-dot" />
            {t(keyOf(`ac.wc.paidBy.${one}`))}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
