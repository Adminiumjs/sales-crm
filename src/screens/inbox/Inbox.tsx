/**
 * THE TEAM INBOX (ledger screen 28): enquiries that arrived with no name
 * against them, and the reader's own.
 *
 * Each reader sees what the server answers them (`data.ts`). What can be
 * done here follows what the server lets the reader do:
 *
 *  - ADD AN ENQUIRY for whoever may make one (the roles that take calls: the
 *    front desk, a rep, a manager, the CRM admin);
 *  - CLAIM IT for whoever may also start a deal. Claiming opens the new-deal
 *    sheet filled from the enquiry; saving claims the enquiry, makes the
 *    company and the contact when it is not on the books, the deal and its
 *    first step, and tells the enquiry its deal (`NewDeal.tsx`);
 *  - PASS IT ON and NOT FOR US for whoever may change an enquiry. The front
 *    desk passes and does not claim: she starts no deal.
 *
 * Read-only reads, and the server keeps e-mail addresses and phone numbers
 * from her.
 */
import { useCallback, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters } from "../../lib/format.ts";
import { useDealActions } from "../../selling/actions.tsx";
import { DealLink } from "../../selling/DealLink.tsx";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { readNames } from "../visits/data.ts";
import { AddEnquiry } from "./AddEnquiry.tsx";
import { YesOnLost } from "./YesOnLost.tsx";
import { canClaim, inInboxFilter, isLead, markRung, notForUs, passOn, readInbox, readPassTo, type Enquiry, type InboxFilter } from "./data.ts";
import { SOURCE_ICON, sourceLabel, warmLabel, WARM_TONE, whenOf } from "./parts.tsx";

const FILTERS: readonly InboxFilter[] = ["open", "mine", "all"];

/** What the new-deal sheet is opened with for an enquiry. */
export function dealFrom(row: Enquiry, firstStep: string) {
  const subject = row.wants ?? row.company_name;
  return {
    name: subject,
    ...(row.est_value === null ? {} : { amount: String(Number(row.est_value)) }),
    firstStep,
    ...(row.company_id === null ? { newCompany: { name: row.company_name, person: row.person, email: row.email, phone: row.phone, town: row.town } } : { companyId: row.company_id }),
    enquiry: { id: row.id, state: row.state, offeredAt: row.opt_out_offered_at ?? null },
  };
}

export function Inbox(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const deals = useDealActions();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const me = config.user?.id ?? "";
  const [now, setNow] = useState(() => session.now());
  const { load, reload } = useLoad(() => readInbox(session), [session, deals.changed]);
  const { load: people } = useLoad(() => readNames(session), [session]);
  const names = people.state === "ready" ? people.data : {};
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["enquiries"], again);

  const canAdd = session.can("enquiries", "create");
  const canChange = session.can("enquiries", "update");
  const claims = canClaim(session);
  const [filter, setFilter] = useState<InboxFilter>("open");
  const [adding, setAdding] = useState(false);
  const [passing, setPassing] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  // Who it can go to: read when "Pass it on" is first pressed, not with every look at the list.
  const { load: passTo } = useLoad(() => (passing === null ? Promise.resolve(null) : readPassTo(session)), [session, passing !== null]);

  const act = async (row: Enquiry, save: Promise<import("../../staffSession.ts").Saved<Enquiry>>, done: string): Promise<void> => {
    setBusy(row.id);
    await toasts.say(save, () => done);
    setBusy(null);
    setPassing(null);
    again();
  };
  const nameOf = (id: string | null): string => (id === null ? "" : (names[id] ?? ""));

  return (
    <div className="crm-screen crm-inbox mr-screen" data-screen="inbox">
      <div className="crm-screen-head">
        <div>
          <h1>{t("inbox.title")}</h1>
          <p className="crm-screen-sub">{t(claims ? "inbox.sub.claim" : canChange ? "inbox.sub.pass" : "inbox.sub.read")}</p>
        </div>
        {canAdd && (
          <div className="crm-screen-actions">
            <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="enquiry-add" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              {t("inbox.add")}
            </button>
          </div>
        )}
      </div>

      <YesOnLost />

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={132} />}>
        {(data) => {
          const shown = data.rows.filter((row) => inInboxFilter(row, filter, me));
          return (
            <>
              <div className="crm-chips" role="group" aria-label={t("inbox.filter")}>
                {FILTERS.map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                    {t(`inbox.filter.${one}`)}
                    <span className="crm-chip-count crm-mono">{f.number(data.counts[one])}</span>
                  </button>
                ))}
              </div>
              {data.cut && <p className="crm-inbox-cut">{t("inbox.cut", { count: f.number(data.rows.length) })}</p>}

              <ul className="crm-enq-list">
                {shown.map((row) => {
                  const subject = row.wants ?? row.company_name;
                  const mine = row.claimed_by_id === me || row.passed_to_id === me;
                  const waiting = row.state === "open" || (row.state === "passed" && row.passed_to_id === me);
                  const fresh = row.state === "open" && f.dayDiff(new Date(row.received_at), now) <= 1;
                  const lead = isLead(row);
                  const from = [row.person, row.company_name === subject ? null : row.company_name, row.email, row.phone].filter((part): part is string => part !== null && part !== "").join(" · ");
                  const claimer = nameOf(row.claimed_by_id);
                  const passee = nameOf(row.passed_to_id);
                  const hidden = (row._masked ?? []).some((column) => column === "email" || column === "phone");
                  const startDeal = (): void => deals.start(dealFrom(row, row.person === null ? t("inbox.firstStep.nobody", { subject }) : t("inbox.firstStep", { person: row.person, subject })));
                  return (
                    <li key={row.id} className="crm-enq mr-card" data-state={row.state} data-waiting={waiting ? "1" : "0"} data-enquiry={row.id}>
                      <div className="crm-enq-top">
                        <span className="crm-enq-icon" aria-hidden="true">
                          <Icon name={SOURCE_ICON[row.source]} size={15} />
                        </span>
                        <div className="crm-enq-main">
                          <div className="crm-enq-line">
                            {fresh && <span className="crm-enq-new" role="img" aria-label={t("inbox.new")} />}
                            <span className="crm-enq-subject">{subject}</span>
                            <span className="crm-pill" data-tone="plain">
                              {sourceLabel(row.source, t)}
                            </span>
                            {lead && row.warmth !== null && (
                              <span className="crm-pill" data-tone={WARM_TONE[row.warmth]}>
                                {warmLabel(row.warmth, t)}
                              </span>
                            )}
                            {row.state === "claimed" && (
                              <span className="crm-pill" data-tone="accent">
                                {row.claimed_by_id === me ? t("inbox.claimed.me") : claimer === "" ? t("inbox.claimed.somebody") : t("inbox.claimed.by", { name: firstName(claimer) })}
                              </span>
                            )}
                            {row.state === "passed" && (
                              <span className="crm-pill" data-tone="accent">
                                {row.passed_to_id === me ? t("inbox.passed.me") : passee === "" ? t("inbox.passed.somebody") : t("inbox.passed.to", { name: firstName(passee) })}
                              </span>
                            )}
                          </div>
                          <div className="crm-enq-from">
                            {from}
                            {hidden && <span className="crm-enq-hidden"> · {t("inbox.hidden")}</span>}
                          </div>
                          {row.text !== null && row.text !== "" && <p className="crm-enq-body">{row.text}</p>}
                        </div>
                        <div className="crm-enq-end">
                          {row.est_value !== null && <span className="crm-enq-size crm-mono">{f.money(row.est_value)}</span>}
                          <span className="crm-enq-when crm-mono">{whenOf(row.received_at, now, f, t)}</span>
                        </div>
                      </div>

                      <div className="crm-enq-foot">
                        <span className="crm-pill" data-tone={row.company_id === null ? "plain" : "pos"} data-match>
                          <Icon name={row.company_id === null ? "building-2" : "link"} size={13} />
                          {row.company_id === null ? t("inbox.match.none") : t("inbox.match", { company: row.company ?? row.company_name })}
                        </span>
                        {waiting && (claims || canChange) ? (
                          <span className="crm-enq-acts">
                            {lead && row.rung_at === null && canChange && mine && (
                              <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="rung" disabled={busy === row.id} onClick={() => void act(row, markRung(session, row), t("leads.toast.rung", { person: row.person ?? row.company_name }))}>
                                <Icon name="phone" size={14} />
                                {t("leads.rung")}
                              </button>
                            )}
                            {claims && (
                              <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="claim" aria-label={t("inbox.claim.aria", { subject })} disabled={busy === row.id} onClick={startDeal}>
                                <Icon name="hand" size={14} />
                                {t("inbox.claim")}
                              </button>
                            )}
                            {canChange && row.state === "open" && (
                              <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="pass" aria-label={t("inbox.pass.aria", { subject })} aria-expanded={passing === row.id} disabled={busy === row.id} onClick={() => setPassing(passing === row.id ? null : row.id)}>
                                <Icon name="users" size={14} />
                                {t("inbox.pass")}
                              </button>
                            )}
                            {canChange && (
                              <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 crm-btn-quiet mr-gi" data-act="drop" aria-label={t("inbox.drop.aria", { subject })} disabled={busy === row.id} onClick={() => void act(row, notForUs(session, row), t("inbox.toast.dropped", { subject }))}>
                                {t("inbox.drop")}
                              </button>
                            )}
                          </span>
                        ) : (
                          !waiting && (
                            <span className="crm-enq-settled">
                              <Icon name={row.state === "dropped" ? "circle-slash" : "user-round-check"} size={14} />
                              {row.state === "dropped" ? (
                                t("inbox.settled.dropped")
                              ) : row.state === "claimed" ? (
                                <>
                                  {row.claimed_by_id === me ? t("inbox.settled.claimed.me") : claimer === "" ? t("inbox.settled.claimed.somebody") : t("inbox.settled.claimed", { name: claimer })}
                                  {row.deal_id !== null && session.can("deals", "read") && (
                                    <DealLink id={row.deal_id} className="crm-enq-deal">
                                      {t("inbox.settled.deal")}
                                    </DealLink>
                                  )}
                                  {row.deal_id === null && row.claimed_by_id === me && claims && (
                                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="deal" onClick={startDeal}>
                                      <Icon name="plus" size={14} />
                                      {t("leads.deal")}
                                    </button>
                                  )}
                                </>
                              ) : passee === "" ? (
                                t("inbox.settled.passed.somebody")
                              ) : (
                                t("inbox.settled.passed", { name: passee })
                              )}
                            </span>
                          )
                        )}
                      </div>

                      {passing === row.id && (
                        <div className="crm-enq-pass" role="group" aria-label={t("inbox.pass.to")}>
                          <span className="crm-enq-pass-label">{t("inbox.pass.to")}</span>
                          {passTo.state === "ready" && passTo.data !== null ? (
                            passTo.data.length === 0 ? (
                              <span className="crm-enq-pass-none">{t("inbox.pass.nobody")}</span>
                            ) : (
                              passTo.data.map((person) => (
                                <button key={person.id} type="button" className="crm-chip-btn mr-chip" data-person={person.id} disabled={busy === row.id} onClick={() => void act(row, passOn(session, row, person.id), t("inbox.toast.passed", { subject, name: firstName(person.name) }))}>
                                  {firstName(person.name)}
                                </button>
                              ))
                            )
                          ) : (
                            <span className="crm-enq-pass-none">{t("ui.loading")}</span>
                          )}
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 crm-enq-pass-no mr-gi" onClick={() => setPassing(null)}>
                            {t("inbox.pass.cancel")}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {shown.length === 0 && (
                <div className="crm-empty" data-testid="inbox-empty">
                  <span className="crm-empty-icon" data-tone="pos">
                    <Icon name="inbox" size={21} />
                  </span>
                  <div className="crm-empty-title">{t(filter === "open" ? "inbox.empty" : "inbox.empty.filter")}</div>
                  <p>{t(filter === "open" ? "inbox.empty.body" : filter === "mine" ? "inbox.empty.mine" : canAdd ? "inbox.empty.all.add" : "inbox.empty.all")}</p>
                </div>
              )}
            </>
          );
        }}
      </Loaded>

      {adding && <AddEnquiry onClose={() => setAdding(false)} onSaved={again} />}
    </div>
  );
}
