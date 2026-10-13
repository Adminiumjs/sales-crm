/**
 * THE TEAM VIEW: where the open work is, month by month and person by
 * person. The home of the sales manager, the CRM admin and Read-only.
 *
 * A sales manager's figures are her team's and the admin's are everybody's:
 * the server decides whose deals each of them reads, and every figure here is
 * asked of it. `team/<person>` is that person's one-to-one page.
 *
 * WHO ADDS UP. The win rate is two of the server's counts divided. The curve
 * is one figure per month ("expected to have closed by the end of it"), each
 * asked of the server; the months are not added to each other here. "Sitting"
 * is the server's clock less the moment a deal entered its stage.
 */
import { useCallback, useMemo, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { monthOf, noonOf, type Formatters } from "../../lib/format.ts";
import { closedFigures, winRate, yearOf, type Closed } from "../../selling/figures.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { before, byKey, cellsOf, daysOf, daysSince, monthsBack, num, OPEN, peopleOf, stagesOf, toneOf, useScreen, type Days, type Matrix, type People, type Stage } from "./data.ts";
import { OneToOne } from "./OneToOne.tsx";

/** The strip shows this many months at least, and no more than a year. */
const MONTHS_MIN = 3;
const MONTHS_MAX = 12;

interface Sitting extends Record<string, unknown> {
  id: number;
  name: string;
  owner_id: string | null;
  amount: number | string;
  entered_stage_at: string | null;
  company: string | null;
  stage: string | null;
}
interface Month {
  /** The month's first day. */
  from: string;
  weighted: number;
  count: number;
  /** Weighted value expected to have closed from this month's start to the end of this one. */
  upTo: number;
}
interface TeamData {
  twelve: Closed;
  year: Closed;
  all: Closed;
  stages: Stage[];
  people: People;
  days: Days;
  /** Open deals and their weighted value, by owner. */
  open: Record<string, Record<string, number>>;
  openCount: number;
  byStage: Record<string, Record<string, number>>;
  months: Month[];
  /** Open deals of the people shown with no expected close, or one before this month. */
  outside: number;
  longest: Sitting[];
  staleCount: number;
}

/** The first day of the month `n` months after the one `from` is in. */
const monthAfter = (from: string, n: number): string => {
  const at = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + n, 1));
  return at.toISOString().slice(0, 10);
};

async function read(session: StaffSession, f: Formatters, today: string, who: string | null): Promise<TeamData> {
  const [thisMonth] = monthOf(today);
  const scoped: Condition[] = who === null ? [OPEN] : [OPEN, { column: "owner_id", op: "eq", value: who }];
  const days = await daysOf(session);
  const [twelve, year, all, stages, people, open, openCount, byStage, furthest, outside, longest, staleCount] = await Promise.all([
    closedFigures(session, { between: [monthsBack(today, 12), today] }),
    closedFigures(session, { between: yearOf(today) }),
    closedFigures(session),
    stagesOf(session),
    peopleOf(session),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [OPEN], groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "w" }], limit: 200 }),
    session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters: [OPEN], aggregations: [{ fn: "count", alias: "n" }] }),
    session.figure<Matrix>({ table: "deals", shape: "matrix", filters: [OPEN], groupBy: ["owner_id", "stage_id"], aggregations: [{ fn: "count", alias: "n" }] }),
    // The furthest day a deal is expected to close on: how many months the strip holds.
    session.list<{ expected_close: string | null }>("deals", { select: ["expected_close"], where: { and: [...scoped, { column: "expected_close", op: "not_null" }] }, order: ["expected_close.desc", "id"], limit: 1 }),
    session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters: [...scoped, { or: [{ column: "expected_close", op: "lt", value: thisMonth }, { column: "expected_close", op: "is_null" }] }], aggregations: [{ fn: "count", alias: "n" }] }),
    session.list<Sitting>("deals", { select: ["id", "name", "owner_id", "amount", "entered_stage_at"], where: OPEN, order: ["entered_stage_at", "id"], lookup: ["company:company_id.name", "stage:stage_id.label"], limit: 3 }),
    session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters: [OPEN, { column: "entered_stage_at", op: "lt", value: before(f, today, days.stale) }], aggregations: [{ fn: "count", alias: "n" }] }),
  ]);
  // The months from this one to the last a deal is expected in.
  const last = (furthest.rows[0]?.expected_close ?? thisMonth).slice(0, 7);
  const firsts: string[] = [];
  for (let i = 0; i < MONTHS_MAX; i += 1) {
    const from = monthAfter(thisMonth, i);
    if (i >= MONTHS_MIN && from.slice(0, 7) > last) break;
    firsts.push(from);
  }
  /*
   * Two figures a month, each between two DAYS, all asked together (one
   * request): what is expected in the month, and what is expected to have
   * closed by its end (the curve). Asked by day and not as "a figure by
   * month": the engines do not agree on the moment a month's bucket is named
   * by, and a day is a day on all of them.
   */
  const monthly = await Promise.all(
    firsts.map(async (from) => {
      const end = monthOf(from)[1];
      const [inMonth, upTo] = await Promise.all([
        session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [...scoped, { column: "expected_close", op: "between", value: [from, end] }], groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "w" }] }),
        session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters: [...scoped, { column: "expected_close", op: "between", value: [thisMonth, end] }], aggregations: [{ fn: "sum", column: "weighted_value", alias: "w" }] }),
      ]);
      const these = byKey(inMonth)["open"];
      return { from, weighted: num(these?.["w"]), count: num(these?.["n"]), upTo: num(upTo.value) };
    }),
  );
  return {
    twelve,
    year,
    all,
    stages,
    people,
    days,
    open: byKey(open),
    openCount: num(openCount.value),
    byStage: cellsOf(byStage),
    months: monthly,
    outside: num(outside.value),
    longest: longest.rows,
    staleCount: num(staleCount.value),
  };
}

/** The curve: nothing at the start of this month, then what is expected to have closed by each month's end. */
function Curve({ months, label }: { months: Month[]; label: string }) {
  const W = 320;
  const H = 92;
  const total = months.at(-1)?.upTo ?? 0;
  const points = [{ x: 0, y: 0 }, ...months.map((month, i) => ({ x: (i + 1) / months.length, y: total === 0 ? 0 : month.upTo / total }))];
  const line = points.map((point, i) => `${i === 0 ? "M" : "L"}${(point.x * W).toFixed(1)} ${(H - point.y * (H - 6)).toFixed(1)}`).join(" ");
  return (
    <svg className="crm-tm-curve" viewBox={`0 0 ${String(W)} ${String(H)}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={`${line} L${String(W)} ${String(H)} L0 ${String(H)} Z`} className="crm-tm-curve-area" />
      <path d={line} className="crm-tm-curve-line" />
    </svg>
  );
}

export function Team(props: ScreenProps) {
  const person = props.rest[0];
  return person === undefined ? <TeamView /> : <OneToOne person={person} />;
}

function TeamView() {
  const t = useT();
  const { session, f, opens, writes } = useScreen();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const year = today.slice(0, 4);
  const [who, setWho] = useState<string | null>(null);
  const { load, reload } = useLoad(() => read(session, f, today, who), [session, f, today, who]);
  const again = useCallback(() => {
    setNow(session.now());
    reload();
  }, [session, reload]);
  useLive(["deals"], again);

  const days = useMemo(() => (n: number): string => t("closed.days", undefined, n), [t]);

  return (
    <div className="crm-screen crm-team mr-screen" data-screen="team">
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={4} height={120} />}>
        {(data) => {
          const rate = winRate(data.twelve);
          const yearRate = winRate(data.year);
          const count = (closed: Closed): number => closed.won.count + closed.lost.count;
          // Everybody with a rep's profile, then anybody else who owns an open deal.
          const owners = [...data.people.reps, ...Object.keys(data.open).filter((id) => !data.people.reps.includes(id))];
          const name = (id: string | null): string => (id === null ? t("team.someone") : (data.people.names[id] ?? t("team.someone")));
          const shown = data.longest.length;
          const staleShown = Math.min(shown, data.staleCount);
          const total = data.months.at(-1)?.upTo ?? 0;
          return (
            <>
              <div className="crm-screen-head">
                <div>
                  <h1>{t("team.title")}</h1>
                  <div className="crm-now">
                    <Icon name="calendar-days" size={15} />
                    <span>{f.dayLong(now)}</span>
                  </div>
                </div>
                <div className="crm-tm-pills">
                  <span className="crm-pill crm-tm-pill" data-tone="pos" data-figure="win-rate">
                    <Icon name="trophy" size={14} />
                    {rate === null
                      ? t("team.winRate.none")
                      : `${t("team.winRate", { rate: f.percent(rate), won: f.number(data.twelve.won.count), all: f.number(count(data.twelve)) })}${yearRate === null ? "" : ` · ${t("team.winRate.year", { rate: f.percent(yearRate), year, won: f.number(data.year.won.count), all: f.number(count(data.year)) })}`}`}
                  </span>
                  {data.all.won.cycle !== null && (
                    <span className="crm-pill crm-tm-pill" data-tone="info" data-figure="cycle">
                      <Icon name="clock" size={14} />
                      {data.year.won.cycle === null ? t("team.cycle.all", { all: days(Math.round(data.all.won.cycle)) }) : t("team.cycle", { days: days(Math.round(data.year.won.cycle)), year, all: f.number(Math.round(data.all.won.cycle)) })}
                    </span>
                  )}
                  {writes && opens("targets") && (
                    <ScreenLink to="targets" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                      <Icon name="target" size={14} />
                      {t("team.targets")}
                    </ScreenLink>
                  )}
                </div>
              </div>

              <div className="crm-chips" role="group" aria-label={t("team.who")}>
                <button type="button" className="crm-chip-btn mr-chip" aria-pressed={who === null} onClick={() => setWho(null)}>
                  {t("team.all")}
                  <span className="crm-chip-count crm-mono">{f.number(data.openCount)}</span>
                </button>
                {owners.map((id) => (
                  <button key={id} type="button" className="crm-chip-btn mr-chip" aria-pressed={who === id} onClick={() => setWho(id)}>
                    {firstName(name(id))}
                    <span className="crm-chip-count crm-mono">{f.number(data.open[id]?.["n"] ?? 0)}</span>
                  </button>
                ))}
              </div>

              <div className="crm-tm-forecast" aria-busy={load.state === "ready" && load.again}>
                <div className="crm-tm-months">
                  {data.months.map((month, i) => (
                    <div key={month.from} className="crm-tm-month mr-card" data-month={month.from.slice(0, 7)}>
                      <div className="crm-tm-month-head">
                        <span className="crm-dot" data-tone={toneOf((i + 2) % 5)} />
                        <span className="crm-tm-label">{f.monthLong(noonOf(month.from))}</span>
                      </div>
                      <div className="crm-tm-month-value crm-mono">{f.money(month.weighted)}</div>
                      <div className="crm-stat-sub">{t("team.month.sub", { count: f.number(month.count) }, month.count)}</div>
                    </div>
                  ))}
                </div>
                <div className="crm-tm-cum mr-card">
                  <div className="crm-tm-cum-head">
                    <span className="crm-tm-label">{t("team.cumulative")}</span>
                    <span className="crm-mono crm-tm-cum-total" data-figure="cumulative">
                      {f.money(total)}
                    </span>
                  </div>
                  <Curve months={data.months} label={t("team.cumulative.label")} />
                  <div className="crm-tm-axis crm-mono" aria-hidden="true">
                    {data.months.map((month) => (
                      <span key={month.from}>{f.monthLong(noonOf(month.from))}</span>
                    ))}
                  </div>
                </div>
              </div>
              {data.outside > 0 && <p className="crm-tm-outside">{t("team.outside", { count: f.number(data.outside) }, data.outside)}</p>}

              {shown > 0 && (
                <section className="crm-tm-longest" aria-labelledby="crm-tm-longest">
                  <div className="crm-tm-longest-head">
                    <span className="crm-tm-longest-icon">
                      <Icon name="alarm-clock" />
                    </span>
                    <div className="crm-tm-grow">
                      <h2 id="crm-tm-longest">{t("team.longest")}</h2>
                      <div className="crm-tm-note">
                        {staleShown === 0
                          ? t("team.longest.none")
                          : staleShown === shown
                            ? t("team.longest.all", { count: f.number(shown), days: f.number(data.days.stale) })
                            : t("team.longest.some", { stale: f.number(staleShown), count: f.number(shown), days: f.number(data.days.stale) })}
                      </div>
                    </div>
                    {writes && (
                      <div className="crm-tm-actions">
                        {opens("nudges") && (
                          <ScreenLink to="nudges" className="crm-btn crm-btn-ghost crm-btn-34 mr-gi">
                            <Icon name="bell" size={14} />
                            {t("nav.item.nudges")}
                          </ScreenLink>
                        )}
                        {opens("health") && (
                          <ScreenLink to="health" className="crm-btn crm-btn-ghost crm-btn-34 mr-gi">
                            <Icon name="activity" size={14} />
                            {t("nav.item.health")}
                          </ScreenLink>
                        )}
                      </div>
                    )}
                  </div>
                  <ul className="crm-tm-rows">
                    {data.longest.map((deal) => {
                      const sat = daysSince(f, now, deal.entered_stage_at) ?? 0;
                      const tone = sat >= data.days.stale ? "danger" : "warn";
                      return (
                        <li key={deal.id} className="crm-tm-row">
                          <span className="crm-avatar" aria-hidden="true">
                            {initials(name(deal.owner_id))}
                          </span>
                          <div className="crm-tm-grow">
                            <div className="crm-tm-name">{deal.name}</div>
                            <div className="crm-tm-note">{[firstName(name(deal.owner_id)), deal.stage, deal.company].filter((part) => part !== null && part !== "").join(" · ")}</div>
                          </div>
                          <span className="crm-pill crm-mono" data-tone={tone}>
                            {t("team.sitting", { count: f.number(sat) }, sat)}
                            {sat >= data.days.stale ? ` · ${t("team.stale")}` : sat >= data.days.warm ? ` · ${t("team.warm")}` : ""}
                          </span>
                          <span className="crm-mono crm-tm-amount">{f.money(deal.amount)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <section className="crm-tm-reps mr-card" aria-labelledby="crm-tm-reps">
                <div className="crm-tm-reps-head">
                  <h2 id="crm-tm-reps">{t("team.reps")}</h2>
                  <span>{t("team.reps.sub")}</span>
                </div>
                {owners.length === 0 && <p className="crm-tm-none">{t("team.reps.none")}</p>}
                <ul className="crm-tm-rows">
                  {owners.map((id) => {
                    const open = data.open[id]?.["n"] ?? 0;
                    return (
                      <li key={id} className="crm-tm-row" data-rep={firstName(name(id))}>
                        <span className="crm-avatar crm-avatar-34" aria-hidden="true">
                          {initials(name(id))}
                        </span>
                        <div className="crm-tm-who">
                          <div className="crm-tm-name">{name(id)}</div>
                          <div className="crm-tm-note">{t("team.rep.open", { count: f.number(open) }, open)}</div>
                        </div>
                        <div className="crm-tm-bar" role="list" aria-label={t("team.reps.sub")}>
                          {data.stages.map((stage, i) => {
                            const n = data.byStage[id]?.[String(stage.id)] ?? 0;
                            return n === 0 ? null : <span key={stage.id} role="listitem" data-tone={toneOf(i)} data-stage={stage.label} style={{ flexGrow: n }} aria-label={t("team.bar", { stage: stage.label, count: f.number(n) })} title={t("team.bar", { stage: stage.label, count: f.number(n) })} />;
                          })}
                        </div>
                        <span className="crm-mono crm-tm-amount">{f.money(data.open[id]?.["w"] ?? 0)}</span>
                        {writes && (
                          <div className="crm-tm-actions">
                            <ScreenLink to="team" rest={[id]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                              {t("team.oneToOne")}
                            </ScreenLink>
                            {opens("pipeline") && (
                              <ScreenLink to="pipeline" rest={["of", id]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                                {t("team.board")}
                              </ScreenLink>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
