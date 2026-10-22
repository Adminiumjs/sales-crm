/**
 * COMPANIES: who the business sells to, and what is open with each right now.
 * `companies` is the list, `companies/<id>` a company's profile and
 * `companies/<id>/timeline` everything logged there.
 *
 * WHAT A CARD SAYS ABOUT DEALS is the reader's own answer from the server:
 *  - the manager, the CRM admin and Read-only: the open deals they reach and
 *    their sum;
 *  - a rep: HER open deals here and their sum ("2 deals of yours open"), or
 *    "none of yours open" when a colleague holds one, or "nothing open";
 *  - the account manager and the marketer: how many are open, no amount.
 * The counts and sums are measures the server folds over the reader's rows,
 * and the marks' count; nothing is added up here.
 */
import { useCallback, useEffect, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { NoRecord } from "../../shell/pages.tsx";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { CompanyProfile } from "./Company.tsx";
import { num, openLine, readCompanies, type CompanyCard } from "./data.ts";
import { RecordSheet, type Rec } from "./RecordSheet.tsx";
import { Tile, useAccounts } from "./shared.tsx";
import { CompanyTimeline } from "./Timeline.tsx";

const whole = (text: string | undefined): number | null => (text !== undefined && /^\d{1,15}$/.test(text) ? Number(text) : null);

export function CompaniesScreen({ rest }: ScreenProps) {
  const [id, page, ...more] = rest;
  if (id === undefined) return <Companies />;
  const key = whole(id);
  if (key === null || more.length > 0 || (page !== undefined && page !== "timeline")) {
    return (
      <div className="crm-screen mr-screen" data-screen="company">
        <NoRecord home={{ route: "companies", item: { route: "companies", label: "companies" } }} />
      </div>
    );
  }
  return page === "timeline" ? <CompanyTimeline id={key} /> : <CompanyProfile id={key} />;
}

/** What the filter box matches: what the card shows of a company. */
const matches = (company: CompanyCard, q: string): boolean => `${company.name} ${company.sector ?? ""} ${company.town ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());

function Companies() {
  const t = useT();
  const nav = useNav();
  const { session, f, reach } = useAccounts();
  const [typedNow, setTypedNow] = useState("");
  const [asked, setAsked] = useState("");
  const [rec, setRec] = useState<Rec | null>(null);
  // The moment before which a deal has sat `days` whole days or more, by the business's calendar.
  const before = useCallback((days: number) => f.at(addDays(f.dayKey(session.now()), 1 - days), "00:00").toISOString(), [f, session]);
  const { load, reload } = useLoad(() => readCompanies(session, reach, before, asked), [session, reach, before, asked]);
  useLive(reach === "none" ? ["companies"] : reach === "count" ? ["companies", "deal_marks"] : ["companies", "deals", "deal_marks"], reload);

  // With more companies than one look holds, the typed words go to the server; otherwise the list in hand is narrowed.
  const overflow = load.state === "ready" && (load.data.total > load.data.rows.length || asked !== "");
  useEffect(() => {
    if (!overflow) return;
    const timer = setTimeout(() => setAsked(typedNow.trim()), 350);
    return () => clearTimeout(timer);
  }, [overflow, typedNow]);

  const canAdd = session.can("companies", "create");
  const money = reach === "team" || reach === "mine";
  const open = useCallback((id: number) => nav.go("companies", id), [nav]);

  return (
    <div className="crm-screen crm-acc mr-screen" data-screen="companies">
      <div className="crm-acc-head">
        <h1>{t("acc.co.title")}</h1>
        <div className="crm-acc-head-tools">
          <div className="crm-acc-search">
            <Icon name="search" size={15} />
            <input className="crm-input mr-fld" type="search" value={typedNow} aria-label={t("acc.co.filter")} placeholder={t("acc.co.filter")} onChange={(event) => setTypedNow(event.target.value)} />
          </div>
          {canAdd && (
            <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" onClick={() => setRec({ kind: "company", mode: "add" })}>
              <Icon name="plus" />
              {t("acc.co.new")}
            </button>
          )}
        </div>
      </div>
      <p className="crm-screen-sub">{t("acc.co.sub")}</p>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={196} />}>
        {(data) => {
          const rows = overflow ? data.rows : data.rows.filter((company) => matches(company, typedNow));
          return (
            <>
              <ul className="crm-acc-grid" aria-busy={load.state === "ready" && load.again}>
                {rows.map((company) => {
                  const mine = num(company.open_n);
                  const line = openLine(reach, mine, data.marks === null ? null : (data.marks[String(company.id)] ?? 0));
                  const stale = data.stale[String(company.id)] ?? 0;
                  const meta = [company.sector, company.headcount === null ? null : t("room.company.people", { count: f.number(num(company.headcount)) }, num(company.headcount)), company.town].filter((part) => part !== null && part !== "").join(" · ");
                  return (
                    <li key={company.id} className="crm-acc-card mr-card" data-company={company.id}>
                      <Tile id={company.id} size="card">
                        {stale > 0 && <span className="crm-acc-badge crm-mono">{t("acc.co.stale", { count: f.number(stale) }, stale)}</span>}
                      </Tile>
                      {data.changeable.has(company.id) && (
                        <button type="button" className="crm-icon-btn crm-acc-card-edit mr-gi" aria-label={t("acc.co.edit", { name: company.name })} onClick={() => setRec({ kind: "company", mode: "edit", id: company.id })}>
                          <Icon name="pencil" size={13} />
                        </button>
                      )}
                      <div className="crm-acc-card-body">
                        <a
                          className="crm-acc-card-name"
                          href={nav.href("companies", company.id)}
                          onClick={(event) => {
                            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                            event.preventDefault();
                            open(company.id);
                          }}
                        >
                          {company.name}
                        </a>
                        {meta !== "" && <div className="crm-acc-card-meta">{meta}</div>}
                        {line !== null && (
                          <div className="crm-acc-card-open">
                            <span>
                              {line.kind === "team"
                                ? t("acc.co.open.team", { count: f.number(line.count) }, line.count)
                                : line.kind === "mine"
                                  ? t("acc.co.open.mine", { count: f.number(line.count) }, line.count)
                                  : line.kind === "all"
                                    ? t("acc.co.open.team", { count: f.number(line.count) }, line.count)
                                    : t(line.kind === "noneMine" ? "acc.co.open.noneMine" : "acc.co.open.none")}
                            </span>
                            {money && (
                              <span className="crm-mono crm-acc-card-value" data-none={mine === 0}>
                                {mine > 0 ? f.money(company.open_value) : "—"}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {rows.length === 0 && (
                <div className="crm-empty crm-acc-empty">
                  <span className="crm-empty-icon" data-tone="plain">
                    <Icon name="building-2" size={22} />
                  </span>
                  <div className="crm-empty-title">{t(data.total === 0 && asked === "" ? "acc.co.none" : "acc.co.empty")}</div>
                  <p>{t(data.total === 0 && asked === "" ? (canAdd ? "acc.co.none.body" : "acc.co.none.read") : "acc.co.empty.body")}</p>
                </div>
              )}
              {data.total > data.rows.length && <p className="crm-acc-more">{t("acc.list.more", { shown: f.number(data.rows.length), all: f.number(data.total) })}</p>}
            </>
          );
        }}
      </Loaded>
      {rec !== null && <RecordSheet rec={rec} onClose={() => setRec(null)} onSaved={reload} />}
    </div>
  );
}
