/**
 * MY PROFILE (ledger screen 22): who this person is here, and, for a sales
 * rep, her own figures.
 *
 * Every figure is the server's for her: her open deals and their weighted
 * value, her win rate and average cycle over the deals she closed, what is in
 * her queue, her target for the year with what she has booked, and the
 * companies she has something open with. The screen divides (a win rate, how
 * far the target is covered) and takes one figure from another (what is
 * still to find); it adds up no rows.
 *
 * Somebody who owns no deals (every role but the rep) gets who they are and
 * the way to "How I am told", and none of the selling blocks. A field crew
 * member gets his own (`../crew/Profile.tsx`, N2): his crew, his language, the
 * alerts that reach him.
 */
import { useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters } from "../../lib/format.ts";
import { closedFigures, winRate, yearOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { CrewProfile, crewOnly } from "../crew/Profile.tsx";
import { readDetails, readProfile } from "./data.ts";

export function Me(props: ScreenProps) {
  const session = useSession();
  return crewOnly(session.config.access?.roles ?? []) ? <CrewProfile /> : <SalesMe {...props} />;
}

function SalesMe(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const roles = config.access?.roles ?? [];
  // The selling blocks are a sales rep's: she is the one who owns deals and has a target.
  const owns = roles.some((role) => role.slug === "crm-rep") && session.part("selling") && session.can("deals", "read");
  const me = config.user;
  const [now] = useState(() => session.now());
  const today = f.dayKey(now);
  const year = Number(today.slice(0, 4));
  const { load: details } = useLoad(() => readDetails(session), [session]);
  const { load, reload } = useLoad(
    () => (owns && me !== null ? Promise.all([readProfile(session, year), closedFigures(session, { owner: me.id }), closedFigures(session, { owner: me.id, between: yearOf(today) })]) : Promise.resolve(null)),
    [session, owns, today],
  );
  const rep = details.state === "ready" ? details.data.rep : null;

  return (
    <div className="crm-screen crm-me mr-screen" data-screen="me">
      <div className="crm-me-head">
        <span className="crm-avatar crm-me-avatar" aria-hidden="true">
          {initials(me?.name ?? "")}
        </span>
        <div className="crm-me-who">
          <h1>{me?.name ?? ""}</h1>
          <div className="crm-me-role" data-testid="me-role">
            {roles.length === 0 ? t("shell.owner") : roles.map((role) => role.name).join(" · ")}
          </div>
          <div className="crm-me-facts">
            <span>
              <Icon name="mail" size={14} />
              {me?.email ?? ""}
            </span>
            {rep !== null && rep.hours_from !== null && rep.hours_to !== null && (
              <span data-testid="me-hours">
                <Icon name="clock" size={14} />
                {t("me.hours", { from: rep.hours_from, to: rep.hours_to })}
              </span>
            )}
          </div>
        </div>
        {isBuilt("mydetails") && (
          <ScreenLink to="mydetails" className="crm-btn crm-btn-primary crm-btn-40 mr-btn">
            <Icon name="settings" />
            {t("me.edit")}
          </ScreenLink>
        )}
      </div>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={104} />}>
        {(data) => {
          const told = isBuilt("notifs") ? (
            <ScreenLink to="notifs" className="crm-me-told mr-card mr-row">
              <span className="crm-enq-icon" aria-hidden="true">
                <Icon name="bell" size={15} />
              </span>
              <span className="crm-mk-main">
                <span className="crm-mk-title">{t("me.told")}</span>
                <span className="crm-mk-sub">{t("me.told.sub")}</span>
              </span>
              <Icon name="chevron-right" size={15} className="crm-me-chev" />
            </ScreenLink>
          ) : null;
          if (data === null) return told;
          const [profile, closed, thisYear] = data;
          const rate = winRate(closed);
          const ended = closed.won.count + closed.lost.count;
          const booked = thisYear.won.amount;
          // Two of the server's sums put together, then set against her target: what is in hand, and what it covers.
          const inHand = booked + profile.open.weighted;
          const toFind = profile.target === null ? null : Math.max(0, profile.target - inHand);
          return (
            <>
              <div className="crm-me-stats">
                <div className="crm-leads-stat mr-card" data-stat="weighted">
                  <div className="crm-kpi-label">{t("me.stat.weighted")}</div>
                  <div className="crm-leads-value crm-mono">{f.money(profile.open.weighted)}</div>
                  <div className="crm-leads-note">{t("me.stat.weighted.sub", { count: f.number(profile.open.count) }, profile.open.count)}</div>
                </div>
                <div className="crm-leads-stat mr-card" data-stat="rate">
                  <div className="crm-kpi-label">{t("me.stat.rate")}</div>
                  <div className="crm-leads-value crm-mono">{rate === null ? "–" : f.percent(rate)}</div>
                  <div className="crm-leads-note">{t("me.stat.rate.sub", { won: f.number(closed.won.count), count: f.number(ended) }, ended)}</div>
                </div>
                <div className="crm-leads-stat mr-card" data-stat="cycle">
                  <div className="crm-kpi-label">{t("me.stat.cycle")}</div>
                  <div className="crm-leads-value crm-mono">{closed.won.cycle === null ? "–" : t("me.days", { count: f.number(Math.round(closed.won.cycle)) }, Math.round(closed.won.cycle))}</div>
                  <div className="crm-leads-note">{t("me.stat.cycle.sub")}</div>
                </div>
                <div className="crm-leads-stat mr-card" data-stat="queue">
                  <div className="crm-kpi-label">{t("me.stat.queue")}</div>
                  <div className="crm-leads-value crm-mono">{f.number(profile.queue)}</div>
                  <div className="crm-leads-note">{t("me.stat.queue.sub")}</div>
                </div>
              </div>

              <div className="crm-me-grid">
                <section className="crm-me-card mr-card" aria-labelledby="crm-me-target" data-testid="me-target">
                  <div className="crm-me-card-head">
                    <h2 id="crm-me-target">{t("me.target", { year: String(year) })}</h2>
                    {profile.target !== null && profile.target > 0 && (
                      <span className="crm-pill" data-tone="accent" data-testid="me-cover">
                        {t("me.target.covered", { share: f.percent(inHand / profile.target) })}
                      </span>
                    )}
                  </div>
                  {profile.target === null ? (
                    <p className="crm-mk-none">{t("me.target.none")}</p>
                  ) : (
                    <>
                      <div className="crm-me-target-value crm-mono">{f.money(profile.target)}</div>
                      {profile.target > 0 && (
                        <div className="crm-me-bar" role="img" aria-label={t("me.target.covered", { share: f.percent(inHand / profile.target) })}>
                          <span data-part="booked" style={{ inlineSize: `${String(Math.min(100, (booked / profile.target) * 100))}%` }} />
                          <span data-part="weighted" style={{ inlineSize: `${String(Math.min(100 - Math.min(100, (booked / profile.target) * 100), (profile.open.weighted / profile.target) * 100))}%` }} />
                        </div>
                      )}
                      <dl className="crm-me-legend">
                        <div data-part="booked">
                          <dt>{t("me.target.booked")}</dt>
                          <dd className="crm-mono">{f.money(booked)}</dd>
                        </div>
                        <div data-part="weighted">
                          <dt>{t("me.target.weighted")}</dt>
                          <dd className="crm-mono">{f.money(profile.open.weighted)}</dd>
                        </div>
                        <div data-part="toFind">
                          <dt>{t("me.target.toFind")}</dt>
                          <dd className="crm-mono">{f.money(toFind ?? 0)}</dd>
                        </div>
                      </dl>
                    </>
                  )}
                </section>

                <section className="crm-me-card mr-card" aria-labelledby="crm-me-patch" data-testid="me-companies">
                  <div className="crm-me-card-head">
                    <h2 id="crm-me-patch">{t("me.companies")}</h2>
                  </div>
                  {profile.companies.length === 0 ? (
                    <p className="crm-mk-none">{t("me.companies.none")}</p>
                  ) : (
                    <ul className="crm-mk-rows">
                      {profile.companies.map((company) => (
                        <li key={company.id} data-company={company.id}>
                          <div className="crm-mk-row">
                            <span className="crm-enq-icon" aria-hidden="true">
                              <Icon name="building-2" size={15} />
                            </span>
                            <span className="crm-mk-main">
                              <span className="crm-mk-title">{company.name}</span>
                              <span className="crm-mk-sub">{t("me.companies.open", { count: f.number(company.count) }, company.count)}</span>
                            </span>
                            <span className="crm-mk-figure crm-mono">{f.money(company.amount)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
              {told}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
