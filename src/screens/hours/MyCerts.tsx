/**
 * MY CERTIFICATES, on the crew's phone (P25, the design's crew My
 * certificates): his own, soonest to run out first, each with its last day,
 * the days left (or since it ran out), a chip when it has run out or runs out
 * within the warning days (one setting, 42 by default: ruling Q12), and the
 * day of a course the office booked for it. Nothing to press: the office
 * keeps them (Training).
 *
 * The server reads him his own and nobody else's; the counts in the line at
 * the top are its figures, for his rows.
 *
 * Address: `my-certificates`.
 */
import { useCallback } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { NoConnection, useConnection } from "../crew/Offline.tsx";
import { useJobsScreen } from "../jobs/parts.tsx";
import { certState, dayKeyOf, daysFrom, readCertFigures, readCertificates, readHoursSettings } from "./data.ts";
import { certTone } from "./parts.tsx";

export function MyCerts(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useJobsScreen();
  const conn = useConnection();
  const { load, reload } = useLoad(async () => {
    const settings = await readHoursSettings(session);
    const [certs, figures] = await Promise.all([readCertificates(session), readCertFigures(session, today, settings.warnDays, false)]);
    return { certs, figures, warn: settings.warnDays };
  }, [session, today]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["certificates"], again);

  return (
    <div className="crm-cw crm-hr mr-screen" data-screen="mycerts">
      <h1 className="crm-cw-title">{t("hr.mc.title")}</h1>
      {(conn.down || load.state === "failed") && (
        <NoConnection
          tried={conn.tried}
          busy={conn.busy}
          onRetry={() => {
            conn.back();
            reload();
          }}
        />
      )}
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={84} />}>
        {({ certs, figures, warn }) => (
          <>
            <p className="crm-cw-quiet crm-hr-lead" data-testid="hr-mc-line">
              {[
                t("hr.mc.count", { count: f.number(figures.all) }, figures.all),
                figures.out > 0 ? t("hr.mc.out", { count: f.number(figures.out) }, figures.out) : null,
                figures.soon > 0 ? t("hr.mc.soon", { count: f.number(figures.soon), days: f.number(warn) }, figures.soon) : null,
                figures.out === 0 && figures.soon === 0 && figures.all > 0 ? t("hr.mc.none", { days: f.number(warn) }) : null,
              ]
                .filter((part) => part !== null)
                .join(" ")}
            </p>
            <ul className="crm-hr-certs">
              {certs.map((cert) => {
                const until = dayKeyOf(cert.valid_until) ?? cert.valid_until;
                const state = certState(until, today, warn);
                const left = daysFrom(today, until);
                const course = dayKeyOf(cert.course_on);
                return (
                  <li key={cert.id} className="crm-hr-cert mr-card" data-cert={cert.id} data-state={state} data-tone={certTone(state)}>
                    <div className="crm-hr-cert-top">
                      <div className="crm-hr-cert-words">
                        <h2 className="crm-cw-h2">{cert.name}</h2>
                        <div className="crm-hr-until">
                          <span className="crm-cw-quiet">{t("hr.mc.until")}</span>
                          <span className="crm-mono" data-figure="until">
                            {f.dayLong(noonOf(until))}
                          </span>
                          <span className="crm-mono crm-hr-left" data-tone={certTone(state)} data-figure="left">
                            {left < 0 ? t("hr.ago", { count: f.number(-left) }, -left) : t("hr.left", { count: f.number(left) }, left)}
                          </span>
                        </div>
                      </div>
                      {state !== "ok" && (
                        <span className="crm-pill" data-tone={state === "out" ? "danger" : "warn"} data-testid="hr-mc-chip">
                          {state === "out" ? t("hr.cert.out") : t("hr.cert.soon", { days: f.number(warn) })}
                        </span>
                      )}
                    </div>
                    {course !== null && (
                      <div className="crm-hr-course" data-testid="hr-mc-course">
                        <Icon name="calendar-check" size={15} />
                        {t("hr.cert.course", { day: f.dayShort(noonOf(course)) })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {certs.length === 0 && (
              <div className="crm-empty" data-testid="hr-mc-empty">
                <span className="crm-empty-icon">
                  <Icon name="badge-check" size={20} />
                </span>
                <div className="crm-empty-title">{t("hr.mc.empty")}</div>
                <p>{t("hr.mc.empty.body")}</p>
              </div>
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}
