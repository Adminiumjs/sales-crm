/**
 * A CREW MEMBER'S OWN PROFILE (N2, the design's crew profile): his name, his
 * crew, his phone, the language he reads the app in, and the alerts that
 * reach him. No team figure, no pipeline, no target: he owns no deal and
 * reads no amount.
 *
 * His phone is a crew member's personal column, read only by who holds the
 * right to (the operations manager): his own is masked to him like his
 * colleagues'. The page says who keeps it.
 *
 * The alerts are the three rules that tell a crew of a change to a visit of
 * today or tomorrow, each with its real state (`GET /apps/crm/rules`, R7).
 */
import { useMemo } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { isLocaleTag, LOCALES } from "../../i18n/locales.ts";
import { ruleState, type RuleState } from "../../lib/rules.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { isBuilt } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { readCrewFacts } from "../jobs/data.ts";
import { crewsOf } from "./data.ts";

/** The rules that tell his crew of a change, in the order the design lists what reaches him. */
const ALERTS = ["day-sheet-changed", "day-sheet-moved", "day-sheet-crew"] as const;

/** Whether the person holds the field crew's role and no other of the app's. */
export const crewOnly = (roles: readonly { slug: string }[]): boolean => roles.length > 0 && roles.every((role) => role.slug === "crm-crew");

export function CrewProfile() {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const me = session.config.user;
  const roles = session.config.access?.roles ?? [];
  const { load, reload } = useLoad(
    () =>
      Promise.all([
        session.part("jobs") && session.can("crews", "read") && session.can("crew_members", "read") ? readCrewFacts(session) : Promise.resolve(null),
        Promise.all(ALERTS.map((key) => ruleState(session, key))),
      ]),
    [session],
  );
  const language = useMemo(() => (isLocaleTag(locale) ? LOCALES[locale].native : locale), [locale]);
  return (
    <div className="crm-cw mr-screen" data-screen="me">
      <div className="crm-cw-me-head">
        <span className="crm-avatar crm-cw-me-avatar" aria-hidden="true">
          {initials(me?.name ?? "")}
        </span>
        <div>
          <h1 className="crm-cw-title">{me?.name ?? ""}</h1>
          <Loaded load={load} reload={reload} skeleton={<span className="crm-cw-quiet">{roles.map((role) => role.name).join(" · ")}</span>}>
            {([facts]) => {
              const crews = facts === null ? [] : crewsOf(facts, me?.id ?? null).map((id) => facts.crews.find((crew) => crew.id === id)?.name ?? "").filter((name) => name !== "");
              return (
                <div className="crm-cw-quiet" data-testid="me-role">
                  {[roles.map((role) => role.name).join(" · "), ...crews].join(" · ")}
                </div>
              );
            }}
          </Loaded>
        </div>
      </div>

      <section className="crm-cw-sec mr-card crm-cw-me-card" aria-labelledby="crm-cw-me-facts">
        <h2 id="crm-cw-me-facts" className="crm-cw-h2">
          {t("cw.me.facts")}
        </h2>
        <dl className="crm-cw-me-dl">
          <div>
            <dt>{t("cw.me.phone")}</dt>
            <dd data-testid="me-phone">{t("cw.me.phone.office")}</dd>
          </div>
          <div>
            <dt>{t("cw.me.language")}</dt>
            <dd data-testid="me-language">{language}</dd>
          </div>
        </dl>
        {isBuilt("mydetails") && (
          <ScreenLink to="mydetails" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
            <Icon name="languages" />
            {t("cw.me.change")}
          </ScreenLink>
        )}
      </section>

      <section className="crm-cw-sec mr-card crm-cw-me-card" aria-labelledby="crm-cw-me-alerts" data-testid="me-alerts">
        <h2 id="crm-cw-me-alerts" className="crm-cw-h2">
          {t("cw.me.alerts")}
        </h2>
        <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={44} />}>
          {([, states]) => (
            <ul className="crm-cw-alerts">
              {ALERTS.map((key, i) => (
                <li key={key} data-rule={key} data-state={states[i]}>
                  <Icon name="bell-ring" size={15} />
                  <span className="crm-cw-alert-words">
                    <span>{t(`cw.me.alert.${key}`)}</span>
                    <span className="crm-cw-quiet">{alertState(t, states[i] ?? "unknown")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </section>
    </div>
  );
}

const alertState = (t: ReturnType<typeof useT>, state: RuleState): string => t(state === "on" ? "cw.me.alert.on" : state === "off" ? "cw.me.alert.off" : "cw.me.alert.unknown");
