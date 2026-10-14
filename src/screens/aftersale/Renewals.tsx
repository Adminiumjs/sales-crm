/**
 * RENEWALS AND EXPANSION: customers who already bought, and what they have
 * not fitted out yet. One card a customer: what was won there, what is open
 * now, the room its ideas come to, and each idea with the day it is worth
 * raising from.
 *
 * Every figure is the server's for whoever reads it. The account manager
 * reads a deal once it is won, so "open now" holds nothing for him; the
 * count of open deals in a customer's line is the one every reader of
 * Accounts may see.
 */
import { useCallback } from "react";

import { useT } from "../../i18n/index.tsx";
import { useDealActions } from "../../selling/actions.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { RecordName } from "../territory/Name.tsx";
import { useFacts } from "./common.tsx";
import { readRenewals } from "./data.ts";

export function Renewals(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, day } = useFacts();
  const { canStart, start, changed } = useDealActions();
  const { load, reload } = useLoad(() => readRenewals(session, today), [session, today, changed]);
  const again = useCoalesced(reload);
  const live = useCallback(() => again(), [again]);
  useLive(["renewals", "deals"], live);

  return (
    <div className="crm-screen crm-as mr-screen" data-screen="renewals">
      <Loaded
        load={load}
        reload={reload}
        skeleton={
          <>
            <h1>{t("renew.title")}</h1>
            <p className="crm-screen-sub">{t("renew.sub")}</p>
            <div className="crm-as-list">
              <Skeleton rows={3} height={170} />
            </div>
          </>
        }
      >
        {(data) => (
          <>
            <div className="crm-screen-head">
              <div>
                <h1>{t("renew.title")}</h1>
                <p className="crm-screen-sub">{t("renew.sub")}</p>
              </div>
              <div className="crm-as-pills">
                {data.wonToDate !== null && (
                  <span className="crm-pill crm-as-pill" data-tone="pos" data-testid="renew-won">
                    <Icon name="trophy" size={14} />
                    {t("renew.won", { amount: f.money(data.wonToDate) })}
                  </span>
                )}
                <span className="crm-pill crm-as-pill" data-tone="accent" data-testid="renew-room">
                  <Icon name="trending-up" size={14} />
                  {t("renew.room", { amount: f.money(data.room) })}
                </span>
                <span className="crm-as-count" data-testid="renew-count">
                  {t("renew.count.ideas", { count: f.number(data.ideas) }, data.ideas)} · {t("renew.count.customers", { count: f.number(data.customers) }, data.customers)} · {t("renew.count.ready", { count: f.number(data.ready) })}
                </span>
              </div>
            </div>

            <ul className="crm-as-list" aria-busy={load.state === "ready" && load.again}>
              {data.companies.map((company) => {
                const meta = [
                  company.lastWon === null ? null : t("renew.meta.lastWon", { day: day(company.lastWon) }),
                  company.sector,
                  company.headcount === null ? null : t("renew.meta.people", { count: f.number(company.headcount) }, company.headcount),
                  company.town,
                  company.openDeals === null || company.openDeals === 0 ? null : t("renew.meta.open", { count: f.number(company.openDeals) }, company.openDeals),
                ].filter((part): part is string => part !== null && part !== "");
                return (
                  <li key={company.id} className="crm-as-card" data-company={company.name}>
                    <div className="crm-as-card-head">
                      <span className="crm-as-tile">
                        <Icon name="building-2" size={20} />
                      </span>
                      <div className="crm-as-card-main">
                        <div className="crm-as-card-title">
                          <RecordName kind="company" id={company.id} className="crm-as-name">
                            {company.name}
                          </RecordName>
                          <span className="crm-pill crm-as-since">{company.firstWon === null ? t("renew.since.none") : t("renew.since", { day: day(company.firstWon) })}</span>
                        </div>
                        <div className="crm-as-meta">{meta.join(" · ")}</div>
                      </div>
                      <dl className="crm-as-three">
                        {company.won !== null && (
                          <div>
                            <dt>{t("renew.col.won")}</dt>
                            <dd className="crm-mono" data-tone="pos" data-testid="renew-co-won">
                              {f.money(company.won)}
                            </dd>
                          </div>
                        )}
                        {company.openValue !== null && (
                          <div>
                            <dt>{t("renew.col.open")}</dt>
                            <dd className="crm-mono" data-tone={company.openValue === 0 ? "muted" : "plain"} data-testid="renew-co-open">
                              {company.openValue === 0 ? "—" : f.money(company.openValue)}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>{t("renew.col.room")}</dt>
                          <dd className="crm-mono" data-tone="accent" data-testid="renew-co-room">
                            {f.money(company.room)}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <ul className="crm-as-ideas">
                      {company.ideas.map((idea) => (
                        <li key={idea.id} className="crm-as-idea" data-ready={idea.ready}>
                          <div className="crm-as-idea-head">
                            <span className="crm-as-idea-icon">
                              <Icon name="repeat" size={14} />
                            </span>
                            <span className="crm-as-idea-title">{idea.title}</span>
                            {idea.value !== null && <span className="crm-mono crm-as-idea-value">{f.money(idea.value)}</span>}
                          </div>
                          <div className="crm-as-idea-foot">
                            <span className="crm-pill" data-tone={idea.ready ? "pos" : undefined}>
                              {idea.ready ? t("renew.when.ready") : idea.dueOn === null ? t("renew.when.none") : t("renew.when.from", { day: day(idea.dueOn) })}
                            </span>
                            {canStart && (
                              <button type="button" className="crm-btn crm-btn-ghost crm-as-btn mr-gi" onClick={() => start({ companyId: company.id, name: idea.title })}>
                                <Icon name="plus" size={14} />
                                {t("renew.start")}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            {data.companies.length === 0 && (
              <div className="crm-empty">
                <span className="crm-empty-icon">
                  <Icon name="repeat" size={21} />
                </span>
                <div className="crm-empty-title">{t("renew.empty")}</div>
                <p>{t("renew.empty.body")}</p>
              </div>
            )}
            {data.cut && <p className="crm-as-note">{t("after.cut")}</p>}
            {data.companies.some((company) => company.openDeals !== null && company.openDeals > 0 && company.openValue === 0) && <p className="crm-as-note">{t("renew.open.note")}</p>}
          </>
        )}
      </Loaded>
    </div>
  );
}
