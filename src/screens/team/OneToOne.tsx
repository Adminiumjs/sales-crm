/**
 * A REP'S ONE-TO-ONE PAGE: one person's open work, what closed this quarter,
 * their queue, and what is worth raising. Opened from the Team view by the
 * sales manager and the CRM admin (`team/<person>`).
 *
 * Nothing here is ranked against anyone else. Every figure is the server's,
 * over that one person's rows as far as the reader reaches them.
 */
import { useCallback, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { noonOf, type Formatters } from "../../lib/format.ts";
import { closedFigures, winRate, yearOf, type Closed } from "../../selling/figures.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { NoRecord } from "../../shell/pages.tsx";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { byKey, daysOf, daysSince, num, OPEN, peopleOf, quarterOf, stagesOf, toneOf, useScreen, type Days, type People, type Stage } from "./data.ts";

interface Deal extends Record<string, unknown> {
  id: number;
  name: string;
  stage_id: number;
  amount: number | string;
  expected_close: string | null;
  entered_stage_at: string | null;
  company: string | null;
}
interface Ended extends Record<string, unknown> {
  id: number;
  name: string;
  state: "won" | "lost";
  amount: number | string;
  closed_on: string | null;
  cycle_days: number | null;
  stage: string | null;
  reason: string | null;
}
interface Step extends Record<string, unknown> {
  id: number;
  due_at: string;
  text: string | null;
  deal: string | null;
}
interface OneData {
  people: People;
  stages: Stage[];
  days: Days;
  open: { count: number; full: number; weighted: number };
  /** Count and full value of the person's open deals, by stage. */
  byStage: Record<string, Record<string, number>>;
  deals: Deal[];
  biggest: Deal | null;
  all: Closed;
  year: Closed;
  quarter: Closed;
  ended: Ended[];
  queue: Step[];
  queued: number;
  overdue: number;
  oldestLate: string | null;
}

async function read(session: StaffSession, person: string, today: string, now: Date): Promise<OneData> {
  const theirs: Condition = { column: "owner_id", op: "eq", value: person };
  const open: Condition[] = [OPEN, theirs];
  const quarter = quarterOf(today);
  const waiting: Condition[] = [theirs, { column: "kind", op: "eq", value: "step" }, { column: "done", op: "eq", value: false }];
  const sums = [
    { fn: "count" as const, alias: "n" },
    { fn: "sum" as const, column: "amount", alias: "full" },
    { fn: "sum" as const, column: "weighted_value", alias: "weighted" },
  ];
  const [people, stages, days, whole, byStage, deals, biggest, all, year, inQuarter, ended, queue, late] = await Promise.all([
    peopleOf(session),
    stagesOf(session),
    daysOf(session),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: open, groupBy: ["state"], aggregations: sums }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: open, groupBy: ["stage_id"], aggregations: sums, limit: 50 }),
    session.list<Deal>("deals", { select: ["id", "name", "stage_id", "amount", "expected_close", "entered_stage_at"], where: { and: open }, order: ["entered_stage_at", "id"], lookup: ["company:company_id.name"], limit: 200 }),
    session.list<Deal>("deals", { select: ["id", "name", "stage_id", "amount", "expected_close", "entered_stage_at"], where: { and: open }, order: ["amount.desc", "id"], limit: 1 }),
    closedFigures(session, { owner: person }),
    closedFigures(session, { owner: person, between: yearOf(today) }),
    closedFigures(session, { owner: person, between: [quarter, today] }),
    session.list<Ended>("deals", {
      select: ["id", "name", "state", "amount", "closed_on", "cycle_days"],
      where: { and: [theirs, { column: "state", op: "in", value: ["won", "lost"] }, { column: "closed_on", op: "gte", value: quarter }] },
      order: ["closed_at.desc", "id.desc"],
      lookup: ["stage:stage_id.label", "reason:lost_reason_id.label"],
      limit: 50,
    }),
    session.list<Step>("follow_ups", { select: ["id", "due_at", "text"], where: { and: waiting }, order: ["due_at"], lookup: ["deal:deal_id.name"], limit: 5, count: "exact" }),
    // The oldest overdue step, and how many there are.
    session.list<Step>("follow_ups", { select: ["id", "due_at"], where: { and: [...waiting, { column: "due_at", op: "lt", value: now.toISOString() }] }, order: ["due_at"], limit: 1, count: "exact" }),
  ]);
  const totals = byKey(whole)["open"] ?? {};
  return {
    people,
    stages,
    days,
    open: { count: num(totals["n"]), full: num(totals["full"]), weighted: num(totals["weighted"]) },
    byStage: byKey(byStage),
    deals: deals.rows,
    biggest: biggest.rows[0] ?? null,
    all,
    year,
    quarter: inQuarter,
    ended: ended.rows,
    queue: queue.rows,
    queued: queue.total ?? queue.rows.length,
    overdue: late.total ?? late.rows.length,
    oldestLate: late.rows[0]?.due_at ?? null,
  };
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "danger" | "pos" }) {
  return (
    <div className="crm-stat mr-card" data-stat={label}>
      <div className="crm-stat-label">{label}</div>
      <div className="crm-stat-value crm-mono" data-tone={tone ?? "plain"}>
        {value}
      </div>
      <div className="crm-stat-sub">{sub}</div>
    </div>
  );
}

const sittingTone = (days: number, limits: Days): string => (days >= limits.stale ? "danger" : days >= limits.warm ? "warn" : "plain");

export function OneToOne({ person }: { person: string }) {
  const t = useT();
  const { locale } = useI18n();
  const { session, f, opens } = useScreen();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const year = today.slice(0, 4);
  const { load, reload } = useLoad(() => read(session, person, today, now), [session, person, today]);
  const again = useCallback(() => {
    setNow(session.now());
    reload();
  }, [session, reload]);
  useLive(["deals", "follow_ups"], again);

  const days = (n: number): string => t("closed.days", undefined, n);
  const sitting = (deal: Deal, limits: Days, format: Formatters): { days: number; words: string; tone: string } => {
    const sat = daysSince(format, now, deal.entered_stage_at) ?? 0;
    return { days: sat, tone: sittingTone(sat, limits), words: `${t("team.sitting", { count: format.number(sat) }, sat)}${sat >= limits.stale ? ` · ${t("team.stale")}` : sat >= limits.warm ? ` · ${t("team.warm")}` : ""}` };
  };

  return (
    <div className="crm-screen crm-o1 mr-screen" data-screen="one-to-one">
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={4} height={120} />}>
        {(data) => {
          // Somebody with a rep's profile, or who owns something the reader reaches. Anybody else reads as nobody.
          const known = data.people.reps.includes(person) || data.open.count > 0 || data.all.won.count + data.all.lost.count > 0;
          if (!known) return <NoRecord home={{ route: "team", item: { route: "team", label: "team" } }} />;
          const name = data.people.names[person] ?? t("team.someone");
          const rate = winRate(data.all);
          const yearRate = winRate(data.year);
          const closedAll = data.all.won.count + data.all.lost.count;
          const quarterDay = f.date(noonOf(quarterOf(today)));
          const oldest = data.deals[0];
          const oldestSat = oldest === undefined ? null : sitting(oldest, data.days, f);
          const gaps = data.stages.filter((stage) => (data.byStage[String(stage.id)]?.["n"] ?? 0) === 0);
          const lateDays = data.oldestLate === null ? 0 : -f.dayDiff(now, new Date(data.oldestLate));
          const listed = (words: string[]): string => {
            try {
              return new Intl.ListFormat(locale, { style: "long", type: "disjunction" }).format(words);
            } catch {
              return words.join(", ");
            }
          };
          const points: { icon: string; tone: string; text: string }[] = [];
          if (oldest !== undefined && oldestSat !== null && oldestSat.days >= data.days.warm)
            points.push({ icon: "alarm-clock", tone: "warn", text: t("o1.raise.oldest", { deal: oldest.name, stage: data.stages.find((stage) => stage.id === oldest.stage_id)?.label ?? "", days: f.number(oldestSat.days) }) });
          if (data.overdue > 0) points.push({ icon: "clock", tone: "danger", text: `${t("o1.raise.overdue", { count: f.number(data.overdue) }, data.overdue)} ${t("o1.raise.overdue.oldest", { count: f.number(lateDays) }, lateDays)}` });
          if (gaps.length > 0 && data.open.count > 0) points.push({ icon: "circle-dot", tone: "info", text: t("o1.raise.gaps", { stages: listed(gaps.map((stage) => stage.label)) }) });
          if (data.biggest !== null)
            points.push({
              icon: "trending-up",
              tone: "pos",
              text:
                data.biggest.expected_close === null
                  ? t("o1.raise.biggest.undated", { deal: data.biggest.name, amount: f.money(data.biggest.amount) })
                  : t("o1.raise.biggest", { deal: data.biggest.name, amount: f.money(data.biggest.amount), day: f.dayShort(noonOf(data.biggest.expected_close)) }),
            });
          if (points.length === 0) points.push({ icon: "check", tone: "pos", text: t("o1.raise.none") });
          return (
            <>
              <div className="crm-chips" role="group" aria-label={t("o1.people")}>
                {data.people.reps.map((id) => (
                  <ScreenLink key={id} to="team" rest={[id]} className="crm-chip-btn crm-o1-chip mr-chip" current={id === person}>
                    <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                      {initials(data.people.names[id] ?? "")}
                    </span>
                    {firstName(data.people.names[id] ?? t("team.someone"))}
                  </ScreenLink>
                ))}
              </div>

              <div className="crm-o1-head">
                <span className="crm-avatar crm-o1-avatar" aria-hidden="true">
                  {initials(name)}
                </span>
                <div className="crm-tm-grow">
                  <h1>{name}</h1>
                  <div className="crm-o1-sub">{t("o1.sub", { count: f.number(data.open.count), amount: f.money(data.open.full) }, data.open.count)}</div>
                </div>
                {opens("pipeline") && (
                  <ScreenLink to="pipeline" rest={["of", person]} className="crm-btn crm-btn-ghost crm-btn-38 mr-gi">
                    <Icon name="columns-3" size={15} />
                    {t("o1.board")}
                  </ScreenLink>
                )}
              </div>

              <div className="crm-stats">
                <Stat label={t("o1.stat.weighted")} value={f.money(data.open.weighted)} sub={t("o1.stat.weighted.sub")} />
                <Stat
                  label={t("o1.stat.rate")}
                  value={rate === null ? "—" : f.percent(rate)}
                  sub={`${t("o1.stat.rate.sub", { won: f.number(data.all.won.count), all: f.number(closedAll) })}${yearRate === null ? "" : ` · ${t("o1.stat.rate.year", { year, rate: f.percent(yearRate), won: f.number(data.year.won.count), all: f.number(data.year.won.count + data.year.lost.count) })}`}`}
                />
                <Stat label={t("o1.stat.cycle")} value={data.all.won.cycle === null ? "—" : days(Math.round(data.all.won.cycle))} sub={t("o1.stat.cycle.sub")} />
                <Stat label={t("o1.stat.queue")} value={f.number(data.queued)} sub={t("o1.stat.queue.sub")} />
                <Stat label={t("o1.stat.overdue")} value={f.number(data.overdue)} sub={t(data.overdue > 0 ? "o1.stat.overdue.some" : "o1.stat.overdue.none")} tone={data.overdue > 0 ? "danger" : "pos"} />
              </div>

              <div className="crm-o1-grid">
                <div className="crm-o1-col">
                  <section className="crm-panel mr-card" aria-labelledby="crm-o1-open">
                    <div className="crm-panel-head">
                      <h2 id="crm-o1-open">{t("o1.open")}</h2>
                      <span>{t("o1.open.sub")}</span>
                    </div>
                    {[...data.stages].reverse().map((stage) => {
                      const mine = data.deals.filter((deal) => deal.stage_id === stage.id);
                      if (mine.length === 0) return null;
                      const index = data.stages.indexOf(stage);
                      return (
                        <div key={stage.id} className="crm-o1-stage" data-stage={stage.label}>
                          <div className="crm-o1-stage-head">
                            <span className="crm-dot" data-tone={toneOf(index)} />
                            <span>
                              {stage.label} · {f.percent(num(stage.odds))}
                            </span>
                            <span className="crm-mono crm-o1-stage-sum">{f.money(data.byStage[String(stage.id)]?.["full"] ?? 0)}</span>
                          </div>
                          {mine.map((deal) => {
                            const sat = sitting(deal, data.days, f);
                            return (
                              <div key={deal.id} className="crm-o1-deal">
                                <span className="crm-tm-name">{deal.name}</span>
                                {deal.company !== null && (
                                  <span className="crm-chip">
                                    <span className="crm-dot" data-tone="accent" />
                                    {deal.company}
                                  </span>
                                )}
                                <span className="crm-pill crm-mono" data-tone={sat.tone}>
                                  {sat.words}
                                </span>
                                <span className="crm-mono crm-tm-amount">{f.money(deal.amount)}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {data.deals.length === 0 && <p className="crm-tm-none">{t("o1.open.none")}</p>}
                  </section>

                  <section className="crm-panel mr-card" aria-labelledby="crm-o1-closed">
                    <div className="crm-panel-head">
                      <h2 id="crm-o1-closed">{t("o1.closed")}</h2>
                      <span data-figure="quarter">
                        {data.quarter.won.count + data.quarter.lost.count === 0 ? t("o1.closed.nothing", { day: quarterDay }) : t("o1.closed.note", { day: quarterDay, won: f.number(data.quarter.won.count), lost: f.number(data.quarter.lost.count) })}
                      </span>
                    </div>
                    {data.ended.map((deal) => {
                      const day = deal.closed_on === null ? "" : f.dayShort(noonOf(deal.closed_on));
                      return (
                        <div key={deal.id} className="crm-o1-ended" data-state={deal.state}>
                          <span className="crm-o1-ended-icon">
                            <Icon name={deal.state === "won" ? "trophy" : "circle-slash"} size={15} />
                          </span>
                          <div className="crm-tm-grow">
                            <div className="crm-tm-name">{deal.name}</div>
                            <div className="crm-tm-note">{deal.state === "won" ? t("closed.row.won", { day }) : t("o1.closed.lost", { day, stage: deal.stage ?? "", reason: deal.reason ?? t("closed.row.noReason") })}</div>
                          </div>
                          {deal.cycle_days !== null && <span className="crm-pill crm-mono">{days(Number(deal.cycle_days))}</span>}
                          <span className="crm-mono crm-tm-amount">{f.money(deal.amount)}</span>
                        </div>
                      );
                    })}
                    {data.ended.length === 0 && <p className="crm-tm-none">{t("o1.closed.none")}</p>}
                  </section>
                </div>

                <div className="crm-o1-col">
                  <section className="crm-panel crm-panel-pad mr-card" aria-labelledby="crm-o1-raise">
                    <h2 id="crm-o1-raise">{t("o1.raise")}</h2>
                    <ul className="crm-o1-points">
                      {points.map((point) => (
                        <li key={point.icon}>
                          <span className="crm-o1-point-icon" data-tone={point.tone}>
                            <Icon name={point.icon} size={14} />
                          </span>
                          <span>{point.text}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="crm-panel mr-card" aria-labelledby="crm-o1-queue">
                    <div className="crm-panel-head">
                      <h2 id="crm-o1-queue">{t("o1.queue")}</h2>
                      <span className="crm-pill crm-mono">{f.number(data.queued)}</span>
                    </div>
                    {data.queue.map((step) => {
                      const due = new Date(step.due_at);
                      const late = due.getTime() < now.getTime();
                      return (
                        <div key={step.id} className="crm-o1-step">
                          <div className="crm-tm-grow">
                            <div className="crm-tm-name">{step.deal ?? ""}</div>
                            <div className="crm-tm-note">{step.text ?? ""}</div>
                          </div>
                          <span className="crm-mono crm-o1-due" data-late={late ? "1" : "0"}>
                            {late ? f.dayShort(due) : `${f.weekdayShort(due)} ${f.time(due)}`}
                          </span>
                        </div>
                      );
                    })}
                    {data.queue.length === 0 && <p className="crm-tm-none">{t("o1.queue.none")}</p>}
                  </section>
                  <p className="crm-o1-foot">{t("o1.foot")}</p>
                </div>
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
