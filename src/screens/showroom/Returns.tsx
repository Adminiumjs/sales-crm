/**
 * SAMPLE RETURNS CHASE (ledger screen 54): the samples lent out that have not
 * come back, longest away first, each with who has it, the day it was due
 * and every chase made. "Chase it" logs a chase (the server stamps who);
 * "It came back" returns the loan, and its piece is on the shelf again.
 *
 * The figures are the server's: pieces out (the open loans' sum), across how
 * many accounts (its groups), how many are late, and the chases logged on
 * the loans still out. How long one has been away is the server's day less
 * the day it went.
 */
import { useCallback, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { useScreen } from "../team/data.ts";
import { readNames } from "../visits/data.ts";
import { cameBack, chase, daysAway, daysLate, readReturns, type Loan } from "./data.ts";

export function Returns(_props: ScreenProps) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, opens } = useScreen();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => readReturns(session, now, f), [session, today, f]);
  const { load: people } = useLoad(() => readNames(session), [session]);
  const names = people.state === "ready" ? people.data : {};
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["sample_loans", "sample_chases"], again);
  const canChase = session.can("sample_chases", "create");
  const canReturn = session.can("sample_loans", "update");
  const [busy, setBusy] = useState<number | null>(null);
  // One key per chase pressed, kept while it is sent again after a lost reply.
  const keys = useRef(new Map<number, string>());

  const chaseIt = async (loan: Loan): Promise<void> => {
    setBusy(loan.id);
    const key = keys.current.get(loan.id) ?? newClientKey();
    keys.current.set(loan.id, key);
    const done = await toasts.say(chase(session, loan, today, key), () => t("sh.ret.toast.chased", { sample: loan.sample ?? "" }));
    if (done !== null) keys.current.delete(loan.id);
    setBusy(null);
    again();
  };
  const back = async (loan: Loan): Promise<void> => {
    setBusy(loan.id);
    await toasts.say(cameBack(session, loan, today), () => t("sh.lib.toast.back", { sample: loan.sample ?? "" }));
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-sh mr-screen" data-screen="returns">
      <div className="crm-screen-head">
        <div>
          <h1>{t("sh.ret.title")}</h1>
          <p className="crm-screen-sub">{t("sh.ret.sub")}</p>
        </div>
        <div className="crm-screen-actions">
          <ScreenLink to="samples" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
            <Icon name="layers" />
            {t("sh.ret.cupboard")}
          </ScreenLink>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
        {(data) => {
          const longest = data.loans[0] ?? null;
          const away = longest === null ? 0 : daysAway(longest, now, f);
          return (
            <>
              <div className="crm-sh-stats">
                <div className="crm-sh-stat mr-card" data-stat="out">
                  <div className="crm-kpi-label">{t("sh.ret.stat.out")}</div>
                  <div className="crm-sh-value crm-mono">{f.number(data.figures.pieces)}</div>
                  <div className="crm-sh-stat-note">{t("sh.ret.stat.out.note", { count: f.number(data.figures.accounts) }, data.figures.accounts)}</div>
                </div>
                <div className="crm-sh-stat mr-card" data-stat="late" data-tone={data.figures.late > 0 ? "danger" : "pos"}>
                  <div className="crm-kpi-label">{t("sh.ret.stat.late")}</div>
                  <div className="crm-sh-value crm-mono">{f.number(data.figures.late)}</div>
                  <div className="crm-sh-stat-note">{t(data.figures.late > 0 ? "sh.ret.stat.late.note" : "sh.ret.stat.late.none")}</div>
                </div>
                <div className="crm-sh-stat mr-card" data-stat="longest" data-tone={longest !== null && daysLate(longest, now, f) > 0 ? "danger" : "plain"}>
                  <div className="crm-kpi-label">{t("sh.ret.stat.longest")}</div>
                  <div className="crm-sh-value crm-mono">{longest === null ? "—" : t("sh.days", { count: f.number(away) }, away)}</div>
                  <div className="crm-sh-stat-note">{longest === null ? t("sh.ret.stat.longest.none") : t("sh.ret.stat.longest.note", { company: longest.company ?? "", count: f.number(data.figures.chases) }, data.figures.chases)}</div>
                </div>
              </div>

              <ul className="crm-sh-list">
                {data.loans.map((loan) => {
                  const late = daysLate(loan, now, f);
                  const due = new Date(`${loan.due_back}T12:00:00Z`);
                  const chases = data.chases.filter((one) => one.loan_id === loan.id);
                  return (
                    <li key={loan.id} className="crm-sh-card mr-card" data-loan={loan.id} data-tone={late > 0 ? "danger" : "warn"}>
                      <div className="crm-sh-card-top">
                        <span className="crm-sh-ret-tile" aria-hidden="true">
                          <Icon name="layers" size={17} />
                        </span>
                        <div className="crm-sh-main">
                          <div className="crm-sh-fu-head">
                            <span className="crm-sh-name">{loan.sample}</span>
                            <span className="crm-pill" data-tone={late > 0 ? "danger" : "warn"} data-testid="sh-ret-state">
                              {late > 0 ? t("sh.lib.late", { count: f.number(late) }, late) : t("sh.ret.due", { day: f.dayShort(due) })}
                            </span>
                          </div>
                          <div className="crm-sh-who">
                            {loan.company_id !== null && opens("companies") ? (
                              <ScreenLink to="companies" rest={[loan.company_id]} className="crm-sh-co">
                                {loan.company}
                              </ScreenLink>
                            ) : (
                              <span className="crm-sh-co">{loan.company}</span>
                            )}
                            {loan.contact !== null && <span>{[loan.contact, loan.contact_title].filter((part) => part !== null && part !== "").join(" · ")}</span>}
                          </div>
                          {loan.contact_phone !== null && loan.contact_phone !== "" && (
                            <div className="crm-mono crm-sh-phone" dir="ltr">
                              {loan.contact_phone}
                            </div>
                          )}
                        </div>
                        <span className="crm-mono crm-sh-agreed" data-late={late > 0 ? "1" : "0"}>
                          {t("sh.ret.agreed", { day: f.dayShort(due) })}
                        </span>
                      </div>
                      {chases.length > 0 && (
                        <ul className="crm-sh-chases" aria-label={t("sh.ret.chases")}>
                          {chases.map((one) => (
                            <li key={one.id}>
                              <span className="crm-mono">{f.dayShort(new Date(`${one.chased_on}T12:00:00Z`))}</span>
                              <span>{names[one.by_id] === undefined ? t("sh.ret.chased") : t("sh.ret.chasedBy", { name: firstName(names[one.by_id]!) })}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="crm-sh-actions">
                        {canChase && (
                          <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="chase" disabled={busy === loan.id} onClick={() => void chaseIt(loan)}>
                            <Icon name="phone" size={14} />
                            {t("sh.ret.act.chase")}
                          </button>
                        )}
                        {canReturn && (
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="back" disabled={busy === loan.id} onClick={() => void back(loan)}>
                            <Icon name="rotate-ccw" size={14} />
                            {t("sh.lib.act.back")}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {data.loans.length === 0 && (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="check" size={21} />
                  </span>
                  <div className="crm-empty-title">{t("sh.ret.empty")}</div>
                  <p>{t("sh.ret.empty.body")}</p>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
