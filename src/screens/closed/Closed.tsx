/**
 * CLOSED: everything that finished, and why. The losses are the useful half.
 *
 * A rep sees her own; the manager, the CRM admin and Read-only see the
 * team's, with a filter by person; the account manager sees what was won
 * (it is his "Won deals").
 *
 * WHO ADDS UP. The four figures are the server's: counts, sums and the
 * average of each deal's stored days-open, for all time and for this year.
 * This screen divides two of them (the win rate) and rounds the average.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, noonOf } from "../../lib/format.ts";
import { useDealActions } from "../../selling/actions.tsx";
import { closedFigures, scopeOf, winRate, yearOf, type Closed as Figures, type Scope } from "../../selling/figures.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { noValue } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { useSavedView, ViewBar } from "../own/savedView.tsx";
import { firstName, initials } from "../../ui/people.ts";

const PAGE = 50;

interface Row extends Record<string, unknown> {
  id: number;
  name: string;
  state: "won" | "lost";
  owner_id: string | null;
  amount: number | string;
  opened_on: string;
  closed_on: string | null;
  cycle_days: number | null;
  close_note: string | null;
  company: string | null;
  stage: string | null;
  reason: string | null;
}

interface Summary {
  all: Figures;
  year: Figures;
  /** Whose closed deals the reader reaches, for the filter: ids, most deals first. */
  owners: string[];
  names: Record<string, string>;
}

const closedOnly = (scope: Scope, owner: string | null, only: "all" | "won" | "lost"): Condition => {
  const states = scope === "won" || only === "won" ? ["won"] : only === "lost" ? ["lost"] : ["won", "lost"];
  const state: Condition = { column: "state", op: "in", value: states };
  return owner === null ? state : { and: [state, { column: "owner_id", op: "eq", value: owner }] };
};

async function readSummary(session: StaffSession, scope: Scope, owner: string | null, today: string): Promise<Summary> {
  const me = session.config.user;
  const [all, year, byOwner] = await Promise.all([
    closedFigures(session, { owner }),
    closedFigures(session, { owner, between: yearOf(today) }),
    scope === "team"
      ? session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [{ column: "state", op: "in", value: ["won", "lost"] }], groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 50 })
      : Promise.resolve(null),
  ]);
  const owners = byOwner === null ? [] : byOwner.items.filter((item) => !noValue(item.key)).map((item) => String(item.key));
  const names: Record<string, string> = me === null ? {} : { [me.id]: me.name };
  if (owners.some((id) => names[id] === undefined)) for (const person of await session.people(undefined, 200).catch(() => [])) names[person.id] = person.name;
  return { all, year, owners, names };
}

async function readRows(session: StaffSession, where: Condition, upTo: number): Promise<{ rows: Row[]; total: number; jobs: Record<number, string> }> {
  const page = await session.list<Row>("deals", {
    select: ["id", "name", "state", "owner_id", "amount", "opened_on", "closed_on", "cycle_days", "close_note"],
    where,
    order: ["closed_at.desc", "id.desc"],
    lookup: ["company:company_id.name", "stage:stage_id.label", "reason:lost_reason_id.label"],
    limit: upTo,
    count: "exact",
  });
  // The job a won deal became, where the reader has Jobs on site and may read it.
  const won = page.rows.filter((row) => row.state === "won").map((row) => row.id);
  const jobs: Record<number, string> = {};
  if (won.length > 0 && session.part("jobs") && session.can("jobs", "read")) {
    const found = await session.list<{ deal_id: number; code: string | null }>("jobs", { select: ["deal_id", "code"], where: { column: "deal_id", op: "in", value: won }, limit: 200 }).catch(() => null);
    for (const job of found?.rows ?? []) if (job.code !== null) jobs[job.deal_id] = job.code;
  }
  return { rows: page.rows, total: page.total ?? page.rows.length, jobs };
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "pos" | "muted" }) {
  return (
    <div className="crm-stat mr-card">
      <div className="crm-stat-label">{label}</div>
      <div className="crm-stat-value crm-mono" data-tone={tone ?? "plain"}>
        {value}
      </div>
      <div className="crm-stat-sub">{sub}</div>
    </div>
  );
}

export function Closed(props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const { changed } = useDealActions();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const scope = useMemo(() => scopeOf(session), [session]);
  const today = useMemo(() => f.dayKey(session.now()), [f, session]);
  const year = today.slice(0, 4);

  const [who, setWho] = useState<string | null>(null);
  const [only, setOnly] = useState<"all" | "won" | "lost">("all");
  const [upTo, setUpTo] = useState(PAGE);
  // `closed/view/<id>` opens the list on a saved view: whose, and won or lost only.
  const view = useSavedView("archive", props.rest);
  const viewId = view.state === "ready" ? view.view.id : null;
  useEffect(() => {
    if (view.state !== "ready") return;
    if (scope === "team") setWho(view.view.filters.rep ?? null);
    setOnly(scope === "won" ? "all" : (view.view.filters.only ?? "all"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per view
  }, [viewId]);
  const owner = scope === "mine" ? (config.user?.id ?? null) : scope === "team" ? who : null;

  const summary = useLoad(() => readSummary(session, scope, owner, today), [session, scope, owner, today, changed]);
  const where = useMemo(() => closedOnly(scope, owner, only), [scope, owner, only]);
  const list = useLoad(() => readRows(session, where, upTo), [session, where, upTo, changed]);
  const reloadSummary = summary.reload;
  const reloadList = list.reload;
  const again = useCallback(() => {
    reloadSummary();
    reloadList();
  }, [reloadSummary, reloadList]);
  useLive(["deals"], again);

  const days = (n: number): string => t("closed.days", undefined, n);
  const wonOnly = scope === "won";

  return (
    <div className="crm-screen crm-closed mr-screen" data-screen="closed">
      <h1>{t(wonOnly ? "closed.title.won" : "closed.title")}</h1>
      <p className="crm-screen-sub">{t(wonOnly ? "closed.sub.won" : "closed.sub")}</p>
      <ViewBar screen="archive" view={view} current={{ ...(scope === "team" && who !== null ? { rep: who } : {}), ...(only === "all" ? {} : { only }) }} names={summary.load.state === "ready" ? summary.load.data.names : {}} />

      <Loaded load={summary.load} reload={again} skeleton={<Skeleton rows={1} height={112} />}>
        {(data) => {
          const rate = winRate(data.all);
          const yearRate = winRate(data.year);
          const inYear = (ended: Figures["won"]): string => t("closed.stat.inYear", { year, count: f.number(ended.count), amount: f.money(ended.amount) });
          return (
            <>
              {scope === "team" && data.owners.length > 0 && (
                <div className="crm-chips" role="group" aria-label={t("closed.who")}>
                  <button type="button" className="crm-chip-btn mr-chip" aria-pressed={who === null} onClick={() => (setWho(null), setUpTo(PAGE))}>
                    {t("closed.filter.all")}
                  </button>
                  {data.owners.map((id) => (
                    <button key={id} type="button" className="crm-chip-btn mr-chip" aria-pressed={who === id} onClick={() => (setWho(id), setUpTo(PAGE))}>
                      {firstName(data.names[id] ?? t("closed.someone"))}
                    </button>
                  ))}
                </div>
              )}
              <div className="crm-stats">
                <Stat tone="pos" label={t("closed.stat.won")} value={f.money(data.all.won.amount)} sub={`${t("closed.deals", undefined, data.all.won.count)} · ${inYear(data.year.won)}`} />
                {!wonOnly && <Stat tone="muted" label={t("closed.stat.lost")} value={f.money(data.all.lost.amount)} sub={`${t("closed.deals", undefined, data.all.lost.count)} · ${inYear(data.year.lost)}`} />}
                {!wonOnly && (
                  <Stat
                    label={t("closed.stat.rate")}
                    value={rate === null ? "—" : f.percent(rate)}
                    sub={`${t("closed.stat.rate.sub", { won: f.number(data.all.won.count), all: f.number(data.all.won.count + data.all.lost.count) })}${yearRate === null ? "" : ` · ${t("closed.stat.rate.year", { rate: f.percent(yearRate), year })}`}`}
                  />
                )}
                <Stat
                  label={t("closed.stat.cycle")}
                  value={data.all.won.cycle === null ? "—" : days(Math.round(data.all.won.cycle))}
                  sub={`${t("closed.stat.cycle.sub")}${data.year.won.cycle === null ? "" : ` · ${t("closed.stat.cycle.year", { days: days(Math.round(data.year.won.cycle)), year })}`}`}
                />
              </div>
              {!wonOnly && (
                <div className="crm-chips crm-chips-wide" role="group" aria-label={t("closed.filter")}>
                  {(
                    [
                      ["all", data.all.won.count + data.all.lost.count],
                      ["won", data.all.won.count],
                      ["lost", data.all.lost.count],
                    ] as const
                  ).map(([key, count]) => (
                    <button key={key} type="button" className="crm-chip-btn mr-chip" aria-pressed={only === key} data-filter={key} onClick={() => (setOnly(key), setUpTo(PAGE))}>
                      {t(`closed.filter.${key}`)}
                      <span className="crm-chip-count crm-mono">{f.number(count)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          );
        }}
      </Loaded>

      <Loaded load={list.load} reload={again} skeleton={<Skeleton rows={6} height={66} />}>
        {(data) => (
          <>
            <ul className="crm-closed-list" aria-busy={list.load.state === "ready" && list.load.again}>
              {data.rows.map((row) => {
                const won = row.state === "won";
                const name = row.owner_id === null ? null : (summary.load.state === "ready" ? summary.load.data.names[row.owner_id] : undefined) ?? (row.owner_id === config.user?.id ? config.user.name : null);
                const job = data.jobs[row.id];
                const closed = row.closed_on === null ? null : noonOf(row.closed_on);
                const why = won
                  ? `${closed === null ? t("closed.row.won.undated") : t("closed.row.won", { day: f.date(closed) })}${job === undefined ? "" : ` · ${t("closed.row.job", { job })}`}`
                  : `${t("closed.row.lost", { stage: row.stage ?? "", reason: row.reason ?? t("closed.row.noReason") })}${row.close_note === null || row.close_note === "" ? "" : ` · “${row.close_note}”`}`;
                return (
                  <li key={row.id} className="crm-closed-row" data-state={row.state}>
                    <span className="crm-closed-icon">
                      <Icon name={won ? "trophy" : "circle-slash"} />
                    </span>
                    <div className="crm-closed-main">
                      <div className="crm-step-title">
                        <DealLink id={row.id} className="crm-closed-name">
                          {row.name}
                        </DealLink>
                        {row.company !== null && (
                          <span className="crm-chip">
                            <span className="crm-dot" data-tone="accent" />
                            {row.company}
                          </span>
                        )}
                      </div>
                      <div className="crm-closed-why">{why}</div>
                    </div>
                    {name !== null && name !== undefined && scope !== "mine" && (
                      <div className="crm-closed-owner">
                        <span className="crm-avatar crm-avatar-26" aria-hidden="true">
                          {initials(name)}
                        </span>
                        <span>{firstName(name)}</span>
                      </div>
                    )}
                    <div className="crm-closed-end">
                      <span className="crm-mono crm-closed-amount">{f.money(row.amount)}</span>
                      <span className="crm-mono crm-closed-dates">
                        {f.date(noonOf(row.opened_on))} → {closed === null ? "—" : f.date(closed)}
                      </span>
                    </div>
                    {row.cycle_days !== null && <span className="crm-pill crm-mono crm-closed-cycle">{days(Number(row.cycle_days))}</span>}
                  </li>
                );
              })}
              {data.rows.length === 0 && (
                <li className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="folder-clock" size={21} />
                  </span>
                  <div className="crm-empty-title">{t("closed.empty")}</div>
                  <p>{t(session.can("deals", "update") ? "closed.empty.body" : "closed.empty.body.read")}</p>
                </li>
              )}
            </ul>
            {data.total > data.rows.length && (
              <div className="crm-more">
                <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" onClick={() => setUpTo((n) => n + PAGE)}>
                  {t("closed.more", { shown: f.number(data.rows.length), all: f.number(data.total) })}
                </button>
              </div>
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}
