/**
 * THE MARKETER'S HOME: where the work is coming from. Counts only, and no
 * money anywhere on it: she reads enquiries, and nothing of a deal but that
 * an enquiry led to one.
 *
 * Every figure is the server's for her: this month's enquiries by where they
 * came from (and how many of each were scanned on a stand), the deals they
 * led to, and the trade-show leads nobody has rung, the keenest first.
 */
import { useCallback, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, monthOf } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { readNames } from "../visits/data.ts";
import { leadAge, readMarketerHome } from "./data.ts";
import { SOURCE_ICON, sourceLabel, warmLabel, WARM_TONE } from "./parts.tsx";

export function MarketerHome(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => readMarketerHome(session, monthOf(today), f), [session, today, f]);
  const { load: people } = useLoad(() => readNames(session), [session]);
  const names = people.state === "ready" ? people.data : {};
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["enquiries"], again);
  const month = f.monthLong(now);

  return (
    <div className="crm-screen crm-mkhome mr-screen" data-screen="mkhome">
      <div className="crm-screen-head">
        <div>
          <h1>{t("mkhome.title")}</h1>
          <p className="crm-screen-sub">{t("mkhome.sub")}</p>
        </div>
        <div className="crm-screen-actions">
          <ScreenLink to="leads" className="crm-btn crm-btn-primary crm-btn-40 mr-btn">
            <Icon name="tent" />
            {t("nav.item.leads")}
          </ScreenLink>
          {isBuilt("companies") && session.can("companies", "read") && (
            <ScreenLink to="companies" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
              <Icon name="building-2" />
              {t("nav.item.companies")}
            </ScreenLink>
          )}
        </div>
      </div>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={110} />}>
        {(data) => (
          <>
            <div className="crm-leads-stats">
              <div className="crm-leads-stat mr-card" data-stat="month">
                <div className="crm-kpi-label">{t("mkhome.tile.month", { month })}</div>
                <div className="crm-leads-value crm-mono">{f.number(data.month)}</div>
                <div className="crm-leads-note">{t("mkhome.tile.month.sub", { count: f.number(data.sources.length) }, data.sources.length)}</div>
              </div>
              <div className="crm-leads-stat mr-card" data-stat="notRung" data-tone={data.notRung > 0 ? "warn" : "pos"}>
                <div className="crm-kpi-label">{t("mkhome.tile.notRung")}</div>
                <div className="crm-leads-value crm-mono">{f.number(data.notRung)}</div>
                <div className="crm-leads-note">{data.notRung === 0 ? t("leads.stat.new.none") : data.hotNotRung > 0 ? t("leads.stat.new.hot", { count: f.number(data.hotNotRung) }, data.hotNotRung) : t("leads.stat.new.noHot")}</div>
              </div>
              <div className="crm-leads-stat mr-card" data-stat="deals" data-tone="pos">
                <div className="crm-kpi-label">{t("mkhome.tile.deals")}</div>
                <div className="crm-leads-value crm-mono">{f.number(data.deals)}</div>
                <div className="crm-leads-note">{t("mkhome.tile.deals.sub")}</div>
              </div>
            </div>

            <section className="crm-mk-queue mr-card" aria-labelledby="crm-mk-sources">
              <h2 id="crm-mk-sources">
                {t("mkhome.sources", { month })}
                <span className="crm-chip-count crm-mono">{f.number(data.sources.length)}</span>
              </h2>
              {data.sources.length === 0 ? (
                <p className="crm-mk-none">{t("mkhome.sources.none")}</p>
              ) : (
                <ul className="crm-mk-rows">
                  {data.sources.map((line) => {
                    const sub = [line.inbox > 0 ? t("mkhome.source.inbox", { count: f.number(line.inbox) }, line.inbox) : null, line.scanned > 0 ? t("mkhome.source.scanned", { count: f.number(line.scanned) }, line.scanned) : null].filter((part) => part !== null).join(" · ");
                    const body = (
                      <>
                        <span className="crm-enq-icon" aria-hidden="true">
                          <Icon name={SOURCE_ICON[line.source] ?? "inbox"} size={15} />
                        </span>
                        <span className="crm-mk-main">
                          <span className="crm-mk-title">{SOURCE_ICON[line.source] === undefined ? line.label : sourceLabel(line.source, t)}</span>
                          <span className="crm-mk-sub">{sub}</span>
                        </span>
                        <span className="crm-mk-figure crm-mono">{t("mkhome.source.enquiries", { count: f.number(line.enquiries) }, line.enquiries)}</span>
                        <span className="crm-mk-figure crm-mono">{t("mkhome.source.deals", { count: f.number(line.deals) }, line.deals)}</span>
                      </>
                    );
                    return (
                      <li key={line.source} data-source={line.source}>
                        {line.source === "show" ? (
                          <ScreenLink to="leads" className="crm-mk-row mr-row">
                            {body}
                          </ScreenLink>
                        ) : (
                          <div className="crm-mk-row">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="crm-mk-queue mr-card" aria-labelledby="crm-mk-waiting">
              <h2 id="crm-mk-waiting">
                {t("mkhome.waiting")}
                <span className="crm-chip-count crm-mono">{f.number(data.notRung)}</span>
              </h2>
              {data.waiting.length === 0 ? (
                <p className="crm-mk-none">{t("mkhome.waiting.none")}</p>
              ) : (
                <ul className="crm-mk-rows">
                  {data.waiting.map((row) => {
                    const age = leadAge(row, now, f, data.coldDays);
                    const rep = names[row.passed_to_id ?? row.claimed_by_id ?? ""] ?? "";
                    const sub = [row.wants, rep === "" ? null : t("mkhome.lead.with", { name: firstName(rep) }), age.left > 0 ? t("leads.coldIn", { count: f.number(age.left) }, age.left) : t("leads.coldNow")].filter((part) => part !== null && part !== "").join(" · ");
                    return (
                      <li key={row.id} data-enquiry={row.id}>
                        <ScreenLink to="leads" className="crm-mk-row mr-row">
                          <span className="crm-mk-main">
                            <span className="crm-mk-title">
                              {row.person === null ? row.company_name : `${row.person}, ${row.company_name}`}
                              {row.warmth !== null && (
                                <span className="crm-pill" data-tone={WARM_TONE[row.warmth]}>
                                  {warmLabel(row.warmth, t)}
                                </span>
                              )}
                            </span>
                            <span className="crm-mk-sub">{sub}</span>
                          </span>
                          <span className="crm-mk-figure crm-mono" data-late={age.left <= 2 ? "1" : "0"}>
                            {t("mkhome.lead.since", { count: f.number(age.days) }, age.days)}
                          </span>
                        </ScreenLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </Loaded>
    </div>
  );
}
