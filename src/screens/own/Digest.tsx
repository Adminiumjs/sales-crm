/**
 * THE WEEKLY DIGEST (ledger screen 16): the summary a rule writes to this
 * person each week, what it holds for her right now, and "Send me a test".
 *
 * WHAT IS SHOWN IS WHAT THE MAIL HOLDS. The sections are the rule's own, read
 * for her the way the rule reads them: her own rows, the same conditions, the
 * same order, twenty to a section. Each count is the server's. Nothing here
 * is a figure worked out for the screen.
 *
 * WHETHER IT GOES OUT is the rule's state, and the server says that for her
 * own summaries (`ruleState`): switched on, or switched off for this install
 * with who to ask. The test works either way, three times an hour.
 */
import { useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { formatters, noonOf } from "../../lib/format.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { digestKinds, readDigest, readSchedule, readSummaries, readTold, ruleState, sendTest, type DigestKind, type DigestSection, type SectionKey } from "./data.ts";

const SECTION_ICON: Record<SectionKey, string> = { closing: "calendar-clock", due: "clock", slipped: "clock-alert", quiet: "alarm-clock" };

export function Digest(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const slugs = useMemo(() => (config.access?.roles ?? []).map((role) => role.slug), [config]);
  const kinds = useMemo(() => digestKinds(slugs), [slugs]);
  const [kind, setKind] = useState<DigestKind | null>(null);
  const shown = kind ?? kinds[0] ?? null;
  const [now] = useState(() => session.now());
  // What says whether and when: read once per page.
  const { load, reload } = useLoad(() => Promise.all([readSummaries(session), readSchedule(session), readTold(session)]), [session]);
  const { load: holds, reload: reloadHolds } = useLoad(() => (shown === null ? Promise.resolve([] as DigestSection[]) : readDigest(session, shown, now, f)), [session, shown, now, f]);
  const [sending, setSending] = useState<string | null>(null);
  const [left, setLeft] = useState<Record<string, number>>({});

  const send = async (ruleId: string): Promise<void> => {
    setSending(ruleId);
    const sent = await sendTest(session, ruleId);
    setSending(null);
    if (sent.state === "sent" || sent.state === "made") setLeft((was) => ({ ...was, [ruleId]: sent.left }));
    if (sent.state === "sent") toasts.show(t("digest.test.sent", { email: config.user?.email ?? "" }), "pos");
    else if (sent.state === "made") toasts.show(t(sent.reason === "no-template" ? "digest.test.noTemplate" : "digest.test.noMail"), "plain", true);
    else if (sent.state === "limited") toasts.show(t("digest.test.limited", { count: f.number(Math.ceil(sent.seconds / 60)) }, Math.ceil(sent.seconds / 60)), "danger", true);
    else if (sent.state === "gone") {
      toasts.show(t("digest.test.gone"), "danger", true);
      reload();
    } else toasts.show(sent.state === "refused" && sent.message !== "" ? t("ui.refused", { reason: sent.message }) : t("digest.test.lost"), "danger", true);
  };

  return (
    <div className="crm-screen crm-digest mr-screen" data-screen="digest">
      <div className="crm-screen-head">
        <div>
          <h1>{t("digest.title")}</h1>
          <p className="crm-screen-sub">{t("digest.sub")}</p>
        </div>
      </div>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={96} />}>
        {([summaries, schedule, told]) => {
          const mail = told.channels.find((channel) => channel.id === "email")?.available === true;
          if (summaries.length === 0) {
            return (
              <div className="crm-empty" data-testid="digest-none">
                <span className="crm-empty-icon">
                  <Icon name="mail" size={21} />
                </span>
                <div className="crm-empty-title">{t("digest.none")}</div>
                <p>{t("digest.none.body")}</p>
              </div>
            );
          }
          const when =
            schedule.digestTime === null
              ? t("digest.when.rule")
              : schedule.digestDay === null
                ? t("digest.when.daily", { time: schedule.digestTime })
                : t("digest.when.own", { day: f.weekdayLong(noonOf(`2026-03-0${String(1 + schedule.digestDay)}`)), time: schedule.digestTime });
          return (
            <>
              {!mail && (
                <div className="crm-banner" data-tone="warn" data-testid="digest-no-mail">
                  <Icon name="triangle-alert" size={15} />
                  <span>{t("digest.noMail")}</span>
                </div>
              )}
              <ul className="crm-digest-rules">
                {summaries.map((rule) => {
                  const state = ruleState(rule);
                  return (
                    <li key={rule.id} className="crm-digest-rule mr-card" data-rule={rule.id} data-state={state}>
                      <span className="crm-enq-icon" aria-hidden="true">
                        <Icon name="mail" size={15} />
                      </span>
                      <div className="crm-digest-rule-main">
                        <div className="crm-digest-rule-name">{rule.name}</div>
                        <div className="crm-digest-rule-state" data-testid="digest-state">
                          <span className="crm-pill" data-tone={state === "on" ? "pos" : state === "off" ? "warn" : "plain"}>
                            {t(`digest.state.${state}`)}
                          </span>
                          <span>{t(`digest.state.${state}.body`)}</span>
                        </div>
                        <div className="crm-digest-when crm-mono">
                          {when}
                          {isBuilt("notifs") && (
                            <ScreenLink to="notifs" className="crm-digest-change">
                              {t("digest.when.change")}
                            </ScreenLink>
                          )}
                        </div>
                      </div>
                      <div className="crm-digest-test">
                        <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" data-testid="digest-test" disabled={sending !== null} onClick={() => void send(rule.id)}>
                          <Icon name="send" />
                          {sending === rule.id ? t("digest.test.sending") : t("digest.test")}
                        </button>
                        <span className="crm-field-note">{left[rule.id] === undefined ? t("digest.test.note") : t("digest.test.left", { count: f.number(left[rule.id]!) }, left[rule.id]!)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {shown !== null && (
                <section className="crm-digest-holds" aria-labelledby="crm-digest-holds">
                  <div className="crm-digest-holds-head">
                    <h2 id="crm-digest-holds">{t("digest.holds")}</h2>
                    {kinds.length > 1 && (
                      <div className="crm-chips" role="group" aria-label={t("digest.kind")}>
                        {kinds.map((one) => (
                          <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={shown === one} data-kind={one} onClick={() => setKind(one)}>
                            {t(`digest.kind.${one}`)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="crm-field-note">{t(`digest.holds.${shown}` as MessageKey, { email: config.user?.email ?? "" })}</p>
                  <Loaded load={holds} reload={reloadHolds} skeleton={<Skeleton rows={3} height={84} />}>
                    {(sections) => (
                      <div className="crm-digest-frame mr-card">
                        {sections.map((section) => (
                          <div key={section.key} className="crm-digest-section" data-section={section.key}>
                            <h3>
                              <Icon name={SECTION_ICON[section.key]} size={14} />
                              {t(`digest.section.${section.key}`)}
                              <span className="crm-chip-count crm-mono">{f.number(section.total)}</span>
                            </h3>
                            {section.lines.length === 0 ? (
                              <p className="crm-digest-empty">{t(`digest.section.${section.key}.none`)}</p>
                            ) : (
                              <ul>
                                {section.lines.map((line) => (
                                  <li key={line.id}>
                                    <span className="crm-digest-line">
                                      {line.dealId !== null && session.can("deals", "read") ? (
                                        <DealLink id={line.dealId} className="crm-digest-title">
                                          {line.title}
                                        </DealLink>
                                      ) : (
                                        <span className="crm-digest-title">{line.title}</span>
                                      )}
                                      {line.sub !== null && <span className="crm-digest-sub">{line.sub}</span>}
                                    </span>
                                    <span className="crm-digest-value crm-mono">
                                      {line.amount !== null && <span>{f.money(line.amount)}</span>}
                                      {line.at !== null && (
                                        <span>
                                          {section.key === "closing"
                                            ? f.dayShort(noonOf(line.at))
                                            : section.key === "quiet"
                                              ? t("digest.quiet.days", { count: f.number(f.dayDiff(new Date(line.at), now)) }, f.dayDiff(new Date(line.at), now))
                                              : `${f.dayShort(new Date(line.at))}, ${f.time(new Date(line.at))}`}
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {section.total > section.lines.length && <p className="crm-digest-empty">{t("digest.section.more", { count: f.number(section.lines.length) })}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </Loaded>
                </section>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
