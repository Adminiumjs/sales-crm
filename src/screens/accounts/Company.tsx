/**
 * ONE COMPANY: what is known of it, what is open there, who works there, and
 * what closed.
 *
 * WHOSE FIGURES. A company is everybody's; a deal is not. So every figure
 * about deals here is the reader's own answer from the server, and the page
 * says so:
 *  - the manager, the CRM admin and Read-only: "Open value", "Weighted",
 *    "Won to date" over the deals they reach;
 *  - a rep: "MY open value", "MY weighted", "Won by me", over her own deals
 *    here, with a line that colleagues' deals are not in them;
 *  - the account manager: "Won to date" (he reads a deal once it is won) and
 *    how many are open;
 *  - the marketer: how many are open, and nothing else of any deal.
 *
 * A COLLEAGUE'S OPEN DEAL is one quiet line: who has it and its stage. No
 * title, no amount, no link. It is the deal's mark, which is all the server
 * answers the reader about a deal she may not open.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { noonOf } from "../../lib/format.ts";
import { useDealActions } from "../../selling/actions.tsx";
import { DealLink } from "../../selling/DealLink.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { NoRecord } from "../../shell/pages.tsx";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { addressOf, num, readProfile, type Since } from "./data.ts";
import { RecordSheet, type Rec } from "./RecordSheet.tsx";
import { Tile, useAccounts } from "./shared.tsx";

const KIND_ICON: Record<string, string> = { call: "contact", email: "mail", meeting: "calendar-days", note: "notebook-pen" };

export function CompanyProfile({ id }: { id: number }) {
  const t = useT();
  const { session, f, locale, reach } = useAccounts();
  const actions = useDealActions();
  const [rec, setRec] = useState<Rec | null>(null);
  const { load, reload } = useLoad(() => readProfile(session, reach, id), [session, reach, id, actions.changed]);
  useLive(reach === "none" ? ["companies", "contacts"] : reach === "count" ? ["companies", "contacts", "deal_marks"] : ["companies", "contacts", "deals", "deal_marks", ...(session.can("activities", "read") ? ["activities"] : [])], reload);
  const closeRec = useCallback(() => setRec(null), []);

  const sinceWords = (since: Since): string | null => {
    if (since === null) return null;
    if (since.kind === "new") return t("acc.cp.since.new");
    if (since.on === null) return t(since.kind === "customer" ? "acc.cp.since.customer.plain" : "acc.cp.since.talking.plain");
    return t(since.kind === "customer" ? "acc.cp.since.customer" : "acc.cp.since.talking", { when: f.monthYear(noonOf(since.on)) });
  };

  return (
    <div className="crm-screen crm-acc crm-acc-profile mr-screen" data-screen="company">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={170} />}>
        {(data) => {
          if (data === null) return <NoRecord home={{ route: "companies", item: { route: "companies", label: "companies" } }} />;
          const { company } = data;
          const meta = [company.sector, company.headcount === null ? null : t("room.company.people", { count: f.number(num(company.headcount)) }, num(company.headcount)), addressOf(company, locale)].filter((part) => part !== null && part !== "").join(" · ");
          const badge = sinceWords(data.since);
          const mine = reach === "mine";
          const openN = num(company.open_n);
          const facts: { key: string; label: MessageKey; value: string; tone?: "accent" | "pos" }[] = [
            ...(reach === "team" || mine
              ? [
                  { key: "open", label: (mine ? "acc.cp.fact.open.mine" : "acc.cp.fact.open") as MessageKey, value: f.money(company.open_value) },
                  { key: "weighted", label: (mine ? "acc.cp.fact.weighted.mine" : "acc.cp.fact.weighted") as MessageKey, value: f.money(company.weighted), tone: "accent" as const },
                ]
              : []),
            ...(reach === "team" || mine || reach === "won" ? [{ key: "won", label: (mine ? "acc.cp.fact.won.mine" : "acc.cp.fact.won") as MessageKey, value: f.money(company.won_value), tone: "pos" as const }] : []),
            ...((reach === "won" || reach === "count") && data.openEverybody !== null ? [{ key: "deals", label: "acc.cp.fact.deals" as MessageKey, value: f.number(data.openEverybody) }] : []),
            { key: "people", label: "acc.cp.fact.people", value: f.number(num(company.people)) },
          ];
          // Hers, her team's or nobody's (plan 68 X3): the server holds the rest.
          const canEdit = data.changeable;
          const canAddPerson = session.can("contacts", "create");
          const showsDeals = reach !== "none";
          return (
            <>
              <ScreenLink to="companies" className="crm-btn crm-btn-ghost crm-btn-32 crm-acc-back mr-gi">
                <Icon name="chevron-left" size={14} className="crm-flip" />
                {t("acc.cp.back")}
              </ScreenLink>

              <section className="crm-acc-hero mr-card">
                <Tile id={company.id} size="profile">
                  {badge !== null && (
                    <span className="crm-acc-since" data-since={data.since?.kind}>
                      {badge}
                    </span>
                  )}
                </Tile>
                <div className="crm-acc-hero-body">
                  <div className="crm-acc-hero-top">
                    <div>
                      <h1>{company.name}</h1>
                      {meta !== "" && <div className="crm-acc-hero-meta">{meta}</div>}
                      <div className="crm-mono crm-acc-hero-no">{t("acc.cp.number", { id: String(company.id) })}</div>
                    </div>
                    {canEdit && (
                      <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" onClick={() => setRec({ kind: "company", mode: "edit", id: company.id })}>
                        <Icon name="pencil" size={15} />
                        {t("acc.cp.edit")}
                      </button>
                    )}
                  </div>
                  {company.access_note !== null && company.access_note !== "" && (
                    <p className="crm-acc-hero-note">
                      <strong>{t("acc.cp.access")}</strong> {company.access_note}
                    </p>
                  )}
                  <dl className="crm-acc-facts">
                    {facts.map((fact) => (
                      <div key={fact.key} data-fact={fact.key}>
                        <dt>{t(fact.label)}</dt>
                        <dd className="crm-mono" data-tone={fact.tone ?? "plain"}>
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {mine && <p className="crm-acc-own">{t("acc.cp.fact.own")}</p>}
                </div>
              </section>

              <div className="crm-acc-cols">
                <div className="crm-acc-col">
                  {showsDeals && (
                    <section className="crm-acc-panel mr-card" aria-labelledby="crm-acc-open">
                      <div className="crm-acc-panel-head">
                        <h2 id="crm-acc-open">{t(mine ? "acc.cp.open.mine" : "acc.cp.open")}</h2>
                        {(reach === "team" || mine) && <span className="crm-pill crm-mono crm-acc-open-n">{f.number(openN)}</span>}
                        {(reach === "team" || mine) && openN > 0 && <span className="crm-mono crm-acc-panel-sum">{f.money(company.open_value)}</span>}
                        {actions.canStart && (
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 crm-acc-panel-act mr-gi" onClick={() => actions.start({ companyId: company.id })}>
                            <Icon name="plus" size={14} />
                            {t("acc.cp.newDeal")}
                          </button>
                        )}
                      </div>
                      {data.open.length > 0 && (
                        <ul className="crm-acc-deals mr-scroll">
                          {data.open.map((deal) => (
                            <li key={deal.id} className="crm-acc-deal mr-card" data-deal={deal.id}>
                              <DealLink id={deal.id} className="crm-acc-deal-name">
                                {deal.name}
                              </DealLink>
                              <div className="crm-acc-deal-row">
                                <span className="crm-mono crm-acc-deal-amount">{f.money(deal.amount)}</span>
                                {deal.stage !== null && <span className="crm-pill">{deal.stage}</span>}
                              </div>
                              {deal.expected_close !== null && <div className="crm-mono crm-acc-deal-close">{t("acc.cp.closes", { day: f.dayShort(noonOf(deal.expected_close)) })}</div>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {data.open.length === 0 && data.quiet.length === 0 && reach !== "count" && <p className="crm-acc-quiet-none">{t("acc.cp.open.none")}</p>}
                      {data.quiet.length > 0 && (
                        <ul className="crm-acc-quiet" aria-label={t("acc.cp.others")}>
                          {data.quiet.map((line) => (
                            <li key={line.key}>
                              <Icon name="user-round" size={13} />
                              <span>{line.owner === null ? t("acc.cp.other.someone") : t("acc.cp.other", { name: line.owner })}</span>
                              {line.stage !== null && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{line.stage}</span>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {reach === "count" && <p className="crm-acc-quiet-none">{data.openEverybody === 0 ? t("acc.cp.open.none") : t("acc.cp.open.count", { count: f.number(data.openEverybody ?? 0) }, data.openEverybody ?? 0)}</p>}
                    </section>
                  )}

                  {session.can("activities", "read") && (
                    <section className="crm-acc-panel mr-card" aria-labelledby="crm-acc-happened">
                      <div className="crm-acc-panel-head">
                        <h2 id="crm-acc-happened">{t("acc.cp.happened")}</h2>
                        <ScreenLink to="companies" rest={[company.id, "timeline"]} className="crm-btn crm-btn-ghost crm-btn-32 crm-acc-panel-act mr-gi">
                          <Icon name="history" size={14} />
                          {t("acc.cp.timeline")}
                        </ScreenLink>
                      </div>
                      {data.latest.length === 0 ? (
                        <p className="crm-acc-quiet-none">{t("acc.cp.happened.none")}</p>
                      ) : (
                        <ul className="crm-acc-acts">
                          {data.latest.map((entry) => (
                            <li key={entry.id} className="crm-acc-act" data-type={entry.kind}>
                              <span className="crm-feed-icon" data-type={entry.kind}>
                                <Icon name={KIND_ICON[entry.kind] ?? "history"} size={14} />
                              </span>
                              <div className="crm-acc-act-main">
                                <div className="crm-acc-act-top">
                                  <DealLink id={entry.deal_id} className="crm-acc-act-deal">
                                    {entry.deal ?? ""}
                                  </DealLink>
                                  <span className="crm-pill">{t(`feed.label.${entry.kind}` as MessageKey)}</span>
                                  <span className="crm-mono crm-acc-act-when">
                                    {f.dayShort(new Date(entry.at))}, {f.time(new Date(entry.at))}
                                  </span>
                                </div>
                                {entry.text !== null && <p>{entry.text}</p>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}
                </div>

                <div className="crm-acc-col">
                  <section className="crm-acc-panel crm-acc-side mr-card" aria-labelledby="crm-acc-people">
                    <div className="crm-acc-panel-head">
                      <h2 id="crm-acc-people" className="crm-acc-label">
                        {t("acc.cp.people")}
                      </h2>
                      {canAddPerson && (
                        <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 crm-acc-panel-act mr-gi" aria-label={t("acc.cp.people.add.long")} onClick={() => setRec({ kind: "contact", mode: "add", companyId: company.id })}>
                          <Icon name="plus" size={13} />
                          {t("acc.cp.people.add")}
                        </button>
                      )}
                    </div>
                    <ul className="crm-acc-people">
                      {data.people.map((person) => (
                        <li key={person.id}>
                          <button type="button" className="crm-acc-person mr-row" onClick={() => setRec({ kind: "contact", mode: "view", id: person.id })}>
                            <span className="crm-avatar crm-avatar-34" aria-hidden="true">
                              {initials(person.name)}
                            </span>
                            <span className="crm-acc-person-words">
                              <span className="crm-acc-person-name">{person.name}</span>
                              {person.job_title !== null && <span className="crm-acc-person-sub">{person.job_title}</span>}
                            </span>
                            <Icon name="chevron-right" size={14} className="crm-flip" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {data.people.length === 0 && <p className="crm-acc-quiet-none">{t("acc.cp.people.none")}</p>}
                  </section>

                  {(reach === "team" || mine || reach === "won") && (
                    <section className="crm-acc-panel crm-acc-side mr-card" aria-labelledby="crm-acc-history">
                      <div className="crm-acc-panel-head">
                        <h2 id="crm-acc-history" className="crm-acc-label">
                          {t(mine ? "acc.cp.history.mine" : reach === "won" ? "acc.cp.history.won.title" : "acc.cp.history")}
                        </h2>
                      </div>
                      <ul className="crm-acc-history">
                        {data.closed.map((deal) => {
                          const won = deal.state === "won";
                          const day = deal.closed_on === null ? "" : f.date(noonOf(deal.closed_on));
                          const job = data.jobs[deal.id];
                          return (
                            <li key={deal.id} data-state={deal.state}>
                              <span className="crm-acc-history-icon">
                                <Icon name={won ? "trophy" : "circle-slash"} size={13} />
                              </span>
                              <span className="crm-acc-history-words">
                                <DealLink id={deal.id} className="crm-acc-history-name">
                                  {deal.name}
                                </DealLink>
                                <span className="crm-acc-history-sub">
                                  {won
                                    ? `${t("acc.cp.history.won", { day })}${job === undefined ? "" : ` · ${t("closed.row.job", { job })}`}`
                                    : t("acc.cp.history.lost", { day, stage: deal.stage ?? "", reason: deal.reason ?? t("closed.row.noReason") })}
                                </span>
                              </span>
                              <span className="crm-mono crm-acc-history-amount">{f.money(deal.amount)}</span>
                            </li>
                          );
                        })}
                      </ul>
                      {data.closed.length === 0 && <p className="crm-acc-quiet-none">{t("acc.cp.history.none")}</p>}
                    </section>
                  )}
                </div>
              </div>
            </>
          );
        }}
      </Loaded>
      {rec !== null && (
        <RecordSheet
          rec={rec}
          onClose={closeRec}
          onSaved={reload}
          onEdit={(person) => setRec({ kind: "contact", mode: "edit", id: person })}
          onBack={(person) => setRec({ kind: "contact", mode: "view", id: person })}
        />
      )}
    </div>
  );
}
