/**
 * REPEAT ORDERS: the companies that have ordered twice or more, and the
 * reorders a rep expects (held as renewals with a rhythm in months).
 *
 * The counts, sums and averages are the server's. A reorder's due day is the
 * company's last won day plus the months the rep gave it: worked out here,
 * from two things the server said, because no stored column holds it. So
 * each reorder says whether it is due, and no total of "due now" is claimed.
 */
import { useT } from "../../i18n/index.tsx";
import { useDealActions } from "../../selling/actions.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { RecordName } from "../territory/Name.tsx";
import { Stat, useFacts } from "./common.tsx";
import { readRepeat, type Reorder, type ReorderState } from "./data.ts";

const TONE: Record<ReorderState, "warn" | "info" | undefined> = { now: "warn", soon: "info", later: undefined, unknown: undefined };

export function Repeat(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, day } = useFacts();
  const { canStart, start, changed } = useDealActions();
  const { load, reload } = useLoad(() => readRepeat(session, today), [session, today, changed]);
  const again = useCoalesced(reload);
  useLive(["renewals", "deals"], again);

  const pill = (reorder: Reorder | null) => (
    <span className="crm-pill" data-tone={reorder === null ? undefined : TONE[reorder.state]} data-testid="reorder-state">
      {t(reorder === null ? "repeat.state.none" : `repeat.state.${reorder.state}`)}
    </span>
  );

  return (
    <div className="crm-screen crm-as mr-screen" data-screen="repeat">
      <h1>{t("repeat.title")}</h1>
      <p className="crm-screen-sub">{t("repeat.sub")}</p>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={110} />}>
        {(data) => (
          <>
            <div className="crm-stats">
              <Stat testId="repeat-twice" label={t("repeat.stat.twice")} value={f.number(data.repeaters.length)} sub={data.repeaters.length === 0 ? t("repeat.stat.twice.none") : data.repeaters.map((one) => one.name).join(", ")} />
              <Stat
                testId="repeat-later"
                tone="pos"
                label={t("repeat.stat.later")}
                value={data.laterValue === null ? "—" : f.money(data.laterValue)}
                sub={data.meanOrder === null ? t("repeat.stat.later.none") : t("repeat.stat.mean", { amount: f.money(data.meanOrder) })}
              />
              <Stat testId="repeat-expected" label={t("repeat.stat.expected")} value={f.number(data.reorderCount)} sub={data.typical === null ? t("repeat.stat.expected.none") : t("repeat.stat.typical", { amount: f.money(data.typical) })} />
            </div>

            <section className="crm-as-section" aria-labelledby="crm-as-back-title">
              <h2 id="crm-as-back-title">{t("repeat.back.title")}</h2>
              <ul className="crm-as-list" aria-busy={load.state === "ready" && load.again}>
                {data.repeaters.map((company) => (
                  <li key={company.id} className="crm-as-card crm-as-edge" data-company={company.name} data-state={company.reorder?.state ?? "none"}>
                    <div className="crm-as-card-head">
                      <span className="crm-as-tile">
                        <Icon name="rotate-cw" size={18} />
                      </span>
                      <div className="crm-as-card-main">
                        <div className="crm-as-card-title">
                          <RecordName kind="company" id={company.id} className="crm-as-name">
                            {company.name}
                          </RecordName>
                          {pill(company.reorder)}
                        </div>
                        <div className="crm-as-meta" data-testid="repeat-orders">
                          {company.orders.map((order) => `${order.name} ${f.money(order.amount)}${order.closedOn === null ? "" : ` · ${day(order.closedOn)}`}`).join("  ·  ")}
                        </div>
                        {company.reorder !== null && <div className="crm-as-meta">{company.reorder.title}</div>}
                      </div>
                      <div className="crm-as-end">
                        <span className="crm-mono crm-as-end-value" data-testid="repeat-mean">
                          {company.count === 0 ? "—" : f.money(company.total / company.count)}
                        </span>
                        <span className="crm-mono crm-as-end-note" data-testid="repeat-gap">
                          {t("repeat.row.won", { count: f.number(company.count) }, company.count)}
                          {company.gapDays === null ? "" : ` · ${t("repeat.row.gap", { count: f.number(company.gapDays) }, company.gapDays)}`} · {t("repeat.row.mean")}
                        </span>
                        {company.reorder?.due != null && <span className="crm-mono crm-as-end-note">{t("repeat.row.due", { day: day(company.reorder.due) })}</span>}
                      </div>
                    </div>
                    {canStart && (
                      <div className="crm-as-actions">
                        <button type="button" className="crm-btn crm-btn-ghost crm-as-btn mr-gi" onClick={() => start({ companyId: company.id, ...(company.reorder === null ? {} : { name: company.reorder.title }) })}>
                          <Icon name="rotate-cw" size={14} />
                          {t("repeat.start")}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {data.repeaters.length === 0 && <p className="crm-as-note">{t("repeat.back.none")}</p>}
            </section>

            <section className="crm-as-section" aria-labelledby="crm-as-expected-title">
              <h2 id="crm-as-expected-title">{t("repeat.expected.title")}</h2>
              <p className="crm-as-section-sub">{t("repeat.expected.sub")}</p>
              <ul className="crm-as-rows">
                {data.reorders.map((reorder) => (
                  <li key={reorder.id} className="crm-as-row" data-company={reorder.company ?? ""} data-state={reorder.state}>
                    <div className="crm-as-row-main">
                      <div className="crm-as-card-title">
                        <RecordName kind="company" id={reorder.companyId} className="crm-as-name">
                          {reorder.company ?? ""}
                        </RecordName>
                        {pill(reorder)}
                      </div>
                      <div className="crm-as-meta">
                        {reorder.title}
                        {reorder.everyMonths === null ? "" : ` · ${t("repeat.every", { count: f.number(reorder.everyMonths) }, reorder.everyMonths)}`}
                      </div>
                    </div>
                    <div className="crm-as-end">
                      {reorder.typical !== null && <span className="crm-mono crm-as-end-value">{f.money(reorder.typical)}</span>}
                      <span className="crm-mono crm-as-end-note" data-testid="reorder-days">
                        {reorder.lastWon === null ? t("repeat.lastWon.none") : t("repeat.lastWon", { day: day(reorder.lastWon) })}
                        {reorder.due === null ? "" : ` · ${t("repeat.due", { day: day(reorder.due) })}`}
                      </span>
                    </div>
                    {canStart && (reorder.state === "now" || reorder.state === "soon") && (
                      <button type="button" className="crm-btn crm-btn-ghost crm-as-btn mr-gi" onClick={() => start({ companyId: reorder.companyId, name: reorder.title })}>
                        <Icon name="rotate-cw" size={14} />
                        {t("repeat.start")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {data.reorders.length === 0 && <p className="crm-as-note">{t("repeat.expected.empty")}</p>}
              {data.cut && <p className="crm-as-note">{t("after.cut")}</p>}
            </section>
          </>
        )}
      </Loaded>
    </div>
  );
}
