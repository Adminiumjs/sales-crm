/**
 * REFERRALS: who put us in front of whom, and what came of it.
 *
 * "SAY THANK YOU" KEEPS THE MOMENT on the introduction, and the server sends
 * the introducer one thank-you e-mail for it (e-mail 19, F21's producer on
 * `thanked_at`). The save is made only while nobody has thanked yet, and a
 * reply that is lost is read back before the screen says anything.
 *
 * What a reader sees of an introduction's deal is the server's to cut. The
 * account manager reads a deal once it is won: for him an introduction whose
 * deal is still open says there is a deal and nothing of it, and "in play"
 * has no figure.
 */
import { useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { RecordName } from "../territory/Name.tsx";
import { Stat, useFacts } from "./common.tsx";
import { readReferrals, sayThanks, type Referral, type ReferralState } from "./data.ts";

const TONE: Record<ReferralState, "pos" | "info" | undefined> = { won: "pos", open: "info", lost: undefined, none: undefined, hidden: undefined };

export function Referrals(_props: ScreenProps) {
  const t = useT();
  const { session, f, today } = useFacts();
  const toasts = useToasts();
  const { load, reload } = useLoad(() => readReferrals(session, today), [session, today]);
  const again = useCoalesced(reload);
  useLive(["referrals", "deals"], again);
  const [busy, setBusy] = useState<number | null>(null);
  const canThank = session.can("referrals", "update");

  const thank = async (row: Referral): Promise<void> => {
    setBusy(row.id);
    // A save that takes more than a moment is a reply on its way, or lost and being read back.
    const slow = setTimeout(() => toasts.show(t("ui.checking"), "plain", true), 1200);
    const ended = await sayThanks(session, row.id).finally(() => clearTimeout(slow));
    setBusy(null);
    if (ended.state === "thanked") toasts.show(t(ended.mine ? "refer.thanked.toast" : "refer.thanked.already", { name: row.from ?? "" }), "pos");
    else if (ended.state === "refused") toasts.show(t("ui.refused", { reason: reasonOf(ended.error, t) }), "danger", true);
    else toasts.show(t("ui.unknown"), "danger", true);
    again();
  };

  return (
    <div className="crm-screen crm-as mr-screen" data-screen="referrals">
      <h1>{t("refer.title")}</h1>
      <p className="crm-screen-sub">{t("refer.sub")}</p>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={96} />}>
        {(data) => {
          const hidden = data.rows.some((row) => row.state === "hidden");
          return (
            <>
              <div className="crm-stats">
                <Stat testId="refer-count" label={t("refer.stat.count")} value={f.number(data.lastYear)} sub={t("refer.stat.count.sub")} />
                <Stat testId="refer-won" tone="pos" label={t("refer.stat.won")} value={data.won === null ? "—" : f.money(data.won.amount)} sub={data.won === null ? t("refer.stat.hidden") : t("refer.stat.won.sub", { count: f.number(data.won.count) }, data.won.count)} />
                <Stat
                  testId="refer-open"
                  tone="accent"
                  label={t("refer.stat.open")}
                  value={data.open === null || hidden ? "—" : f.money(data.open.amount)}
                  sub={data.open === null || hidden ? t("refer.stat.hidden") : t("refer.stat.open.sub", { count: f.number(data.open.count) }, data.open.count)}
                />
                <Stat testId="refer-nowhere" tone="muted" label={t("refer.stat.nowhere")} value={f.number(data.nowhere)} sub={t("refer.stat.nowhere.sub")} />
              </div>

              <section className="crm-as-section" aria-labelledby="crm-as-refer-title">
                <div className="crm-as-section-head">
                  <h2 id="crm-as-refer-title">{t("refer.list.title")}</h2>
                  <span className="crm-mono crm-as-count" data-testid="refer-thanked">
                    {t("refer.list.thanked", { thanked: f.number(data.thanked), all: f.number(data.total) })}
                  </span>
                </div>
                <p className="crm-as-section-sub">{t(canThank ? "refer.list.sub" : "refer.list.sub.read")}</p>
                <ul className="crm-as-list" aria-busy={load.state === "ready" && load.again}>
                  {data.rows.map((row) => {
                    const thankedAt = row.thankedAt === null ? null : new Date(row.thankedAt);
                    return (
                      <li key={row.id} className="crm-as-card crm-as-refer" data-referral={row.id} data-from={row.from ?? ""} data-state={row.state}>
                        <div className="crm-as-refer-line">
                          <span className="crm-as-refer-who">
                            <span className="crm-avatar crm-avatar-26" aria-hidden="true">
                              {initials(row.from ?? "?")}
                            </span>
                            <span>
                              <RecordName kind="contact" id={row.fromId} className="crm-as-name">
                                {row.from ?? t("refer.someone")}
                              </RecordName>
                              <span className="crm-as-meta crm-as-block">{[row.fromTitle, row.fromCompany].filter((part) => part !== null && part !== "").join(" · ")}</span>
                            </span>
                          </span>
                          <span className="crm-as-arrow" aria-hidden="true">
                            <Icon name="move-right" size={15} />
                          </span>
                          <span className="mr-sr-only">{t("refer.introduced")}</span>
                          <span className="crm-as-refer-to">
                            <span className="crm-as-tile crm-as-tile-sm">
                              <Icon name="building-2" size={14} />
                            </span>
                            {row.toId === null ? (
                              <span className="crm-as-name">{row.to ?? t("refer.someone")}</span>
                            ) : (
                              <RecordName kind="company" id={row.toId} className="crm-as-name">
                                {row.to ?? t("refer.someone")}
                              </RecordName>
                            )}
                          </span>
                          <span className="crm-as-refer-when">
                            <span className="crm-pill" data-tone={TONE[row.state]} data-testid="refer-state">
                              {t(`refer.state.${row.state}`)}
                            </span>
                            <span className="crm-mono crm-as-end-note">{f.date(noonOf(row.introducedOn))}</span>
                          </span>
                        </div>
                        <div className="crm-as-refer-foot">
                          {row.dealId !== null && row.deal !== null && (
                            <span className="crm-as-refer-deal">
                              <DealLink id={row.dealId} className="crm-as-deal-name">
                                {row.deal}
                              </DealLink>
                              {row.dealAmount !== null && <span className="crm-mono">{row.state === "won" ? t("refer.booked", { amount: f.money(row.dealAmount) }) : f.money(row.dealAmount)}</span>}
                            </span>
                          )}
                          {row.state === "hidden" && <span className="crm-as-meta">{t("refer.deal.hidden")}</span>}
                          {thankedAt !== null ? (
                            <span className="crm-pill crm-as-thanked" data-tone="pos" data-testid="refer-thanked-at">
                              <Icon name="heart-handshake" size={14} />
                              {t("refer.thanked", { day: f.dayShort(thankedAt), time: f.time(thankedAt) })}
                            </span>
                          ) : canThank ? (
                            <button type="button" className="crm-btn crm-btn-ghost crm-as-btn mr-gi" disabled={busy !== null} aria-busy={busy === row.id} onClick={() => void thank(row)}>
                              <Icon name="heart-handshake" size={14} />
                              {t(busy === row.id ? "ui.saving" : "refer.thank")}
                            </button>
                          ) : (
                            <span className="crm-as-meta">{t("refer.notThanked")}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {data.rows.length === 0 && (
                  <div className="crm-empty">
                    <span className="crm-empty-icon">
                      <Icon name="heart-handshake" size={21} />
                    </span>
                    <div className="crm-empty-title">{t("refer.empty")}</div>
                    <p>{t("refer.empty.body")}</p>
                  </div>
                )}
                {data.cut && <p className="crm-as-note">{t("after.cut")}</p>}
              </section>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
