/**
 * THE ACCOUNT MANAGER'S HOME: what needs him now, soonest first.
 *
 * At this stage he reads a deal only once it is won (ruling R6), so nothing
 * here speaks of an open deal: renewal ideas whose day has come or is coming,
 * introductions nobody has thanked for, and how many reorders are expected.
 * Aftercare calls, complaints and customers' answers join this page with
 * "After the job" (stage 2). Each row opens the list it belongs to.
 *
 * Every count is the server's. No total across the lists is shown: it would
 * be two of them added here.
 */
import { useMemo } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { canOpen, type MenuFacts, type PartId } from "../../shell/routes.ts";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { RecordName } from "../territory/Name.tsx";
import { Kpi, useFacts } from "./common.tsx";
import { readAmHome } from "./data.ts";

export function AmHome(_props: ScreenProps) {
  const t = useT();
  const { session, f, today } = useFacts();
  const config = session.config;
  const { load, reload } = useLoad(() => readAmHome(session, today), [session, today]);
  const again = useCoalesced(reload);
  useLive(["renewals", "referrals"], again);

  const facts = useMemo<MenuFacts>(() => ({ roles: (config.access?.roles ?? []).map((role) => role.slug), part: (id: PartId) => session.part(id), reads: (table) => session.can(table, "read"), built: isBuilt }), [config, session]);
  const now = session.now();
  const hour = f.hour(now);
  const first = (config.user?.name ?? "").split(/\s+/)[0] ?? "";
  const greeting = t(hour < 12 ? "today.greeting.morning" : hour < 18 ? "today.greeting.afternoon" : "today.greeting.evening", { name: first });
  const toRenewals = canOpen("renewals", facts);
  const toReferrals = canOpen("referrals", facts);
  const toRepeat = canOpen("repeat", facts);

  return (
    <div className="crm-screen crm-as crm-as-home mr-screen" data-screen="amhome">
      <div className="crm-screen-head">
        <div>
          <h1>{greeting}</h1>
          <div className="crm-now">
            <Icon name="calendar-days" size={15} />
            <span>
              {f.dayLong(now)} · {f.time(now)}
            </span>
          </div>
        </div>
        <div className="crm-screen-actions">
          {toReferrals && (
            <ScreenLink to="referrals" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
              <Icon name="heart-handshake" />
              {t("nav.item.referrals")}
            </ScreenLink>
          )}
          {toRenewals && (
            <ScreenLink to="renewals" className="crm-btn crm-btn-primary crm-btn-40 mr-btn">
              <Icon name="repeat" />
              {t("nav.item.renewals")}
            </ScreenLink>
          )}
        </div>
      </div>

      <Loaded
        load={load}
        reload={reload}
        skeleton={
          <>
            <div className="crm-kpis">
              <Skeleton rows={3} height={118} />
            </div>
            <div className="crm-queue-skeleton">
              <Skeleton rows={5} height={64} />
            </div>
          </>
        }
      >
        {(data) => (
          <>
            <div className="crm-kpis">
              <Kpi testId="amhome-ready" icon="repeat" tone="pos" label={t("amhome.kpi.ready")} value={f.number(data.ready)} sub={`${t("renew.count.ideas", { count: f.number(data.ideaCount) }, data.ideaCount)} · ${t("amhome.kpi.ready.sub", { amount: f.money(data.room) })}`} />
              {session.can("referrals", "read") && (
                <Kpi testId="amhome-thank" icon="heart-handshake" tone="accent" label={t("amhome.kpi.thank")} value={f.number(data.toThankCount)} sub={t("amhome.kpi.thank.sub", { count: f.number(data.introductions) }, data.introductions)} />
              )}
              <Kpi testId="amhome-reorders" icon="rotate-cw" tone="accent" label={t("amhome.kpi.reorders")} value={f.number(data.reorders)} sub={data.typical === null ? t("repeat.stat.expected.none") : t("repeat.stat.typical", { amount: f.money(data.typical) })} />
            </div>

            <section className="crm-queue" aria-labelledby="crm-as-queue-title">
              <div className="crm-queue-head">
                <h2 id="crm-as-queue-title">{t("amhome.queue")}</h2>
                <span className="crm-queue-hint">{t("amhome.queue.hint")}</span>
              </div>

              <div data-group="renewals">
                <div className="crm-queue-group">
                  <span className="crm-dot" data-tone="pos" />
                  <span className="crm-queue-group-label">{t("amhome.group.renewals")}</span>
                  <span className="crm-queue-group-count">{f.number(data.ideaCount)}</span>
                </div>
                <ul className="crm-queue-list">
                  {data.ideas.map((idea) => (
                    <li key={idea.id} className="crm-step crm-as-step" data-late="0" data-open="0">
                      <span className="crm-as-step-icon" data-tone={idea.ready ? "pos" : "info"}>
                        <Icon name="repeat" size={15} />
                      </span>
                      <div className="crm-step-main">
                        <div className="crm-step-title">
                          {toRenewals ? (
                            <ScreenLink to="renewals" className="crm-step-deal crm-as-open">
                              {idea.title}
                            </ScreenLink>
                          ) : (
                            <span className="crm-step-deal">{idea.title}</span>
                          )}
                          {idea.company !== null && (
                            <span className="crm-chip">
                              <span className="crm-dot" data-tone="accent" />
                              <RecordName kind="company" id={idea.companyId}>
                                {idea.company}
                              </RecordName>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="crm-step-end">
                        <span className={idea.ready ? "crm-pill crm-mono" : "crm-mono crm-step-due"} data-tone={idea.ready ? "pos" : undefined}>
                          {idea.ready ? t("renew.when.ready") : idea.dueOn === null ? t("renew.when.none") : t("renew.when.from", { day: f.dayShort(noonOf(idea.dueOn)) })}
                        </span>
                        {idea.value !== null && <span className="crm-mono crm-step-amount">{f.money(idea.value)}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {data.ideas.length === 0 && <div className="crm-as-queue-empty">{t("amhome.group.renewals.none")}</div>}
              </div>

              {session.can("referrals", "read") && (
                <div data-group="thanks">
                  <div className="crm-queue-group">
                    <span className="crm-dot" data-tone="accent" />
                    <span className="crm-queue-group-label">{t("amhome.group.thanks")}</span>
                    <span className="crm-queue-group-count">{f.number(data.toThankCount)}</span>
                  </div>
                  <ul className="crm-queue-list">
                    {data.toThank.map((row) => (
                      <li key={row.id} className="crm-step crm-as-step" data-late="0" data-open="0">
                        <span className="crm-as-step-icon" data-tone="accent">
                          <Icon name="heart-handshake" size={15} />
                        </span>
                        <div className="crm-step-main">
                          <div className="crm-step-title">
                            {toReferrals ? (
                              <ScreenLink to="referrals" className="crm-step-deal crm-as-open">
                                {t("amhome.thanks.row", { from: row.from ?? t("refer.someone"), to: row.to ?? t("refer.someone") })}
                              </ScreenLink>
                            ) : (
                              <span className="crm-step-deal">{t("amhome.thanks.row", { from: row.from ?? t("refer.someone"), to: row.to ?? t("refer.someone") })}</span>
                            )}
                            {row.fromCompany !== null && (
                              <span className="crm-chip">
                                <span className="crm-dot" data-tone="accent" />
                                {row.fromCompany}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="crm-step-end">
                          <span className="crm-mono crm-step-due">{f.date(noonOf(row.introducedOn))}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {data.toThank.length === 0 && <div className="crm-as-queue-empty">{t("amhome.group.thanks.none")}</div>}
                  {data.toThankCount > data.toThank.length && <div className="crm-as-queue-empty">{t("amhome.group.more", { shown: f.number(data.toThank.length) })}</div>}
                </div>
              )}
              {data.cut && <p className="crm-as-note">{t("after.cut")}</p>}
            </section>

            {toRepeat && (
              <p className="crm-as-note">
                <ScreenLink to="repeat" className="crm-as-inline-link">
                  {t("amhome.toRepeat")}
                </ScreenLink>
              </p>
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}
