/**
 * WHY WE LOSE, and ONE REASON: the deals lost in the last three, six or
 * twelve months, grouped by the reason the rep wrote down when closing.
 * `why-we-lose/<reason>/<months>` is one reason's page.
 *
 * WHO ADDS UP. Counts, sums and averages are the server's, over the lost
 * deals the reader reaches. This screen divides a reason's value by the
 * whole (its share) and compares figures to say which is largest; a tie is
 * named as a tie. The design's typed commentary ("up since spring", "the
 * pattern", "what to try") is not drawn: nothing in the data says it.
 */
import { useCallback, useMemo, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { closedFigures } from "../../selling/figures.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { NoRecord } from "../../shell/pages.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { byKey, cellsOf, largest, monthsBack, num, peopleOf, stagesOf, toneOf, useScreen, type Matrix, type People, type Stage } from "./data.ts";

const WINDOWS = [3, 6, 12] as const;
type Months = (typeof WINDOWS)[number];
/** The stages "after terms were on the table": the last two before a yes. */
const LATE_STAGES = 2;
const NO_REASON = "none";

const lostSince = (from: string): Condition[] => [
  { column: "state", op: "eq", value: "lost" },
  { column: "closed_on", op: "gte", value: from },
];
const reasonIs = (reason: string): Condition => (reason === NO_REASON ? { column: "lost_reason_id", op: "is_null" } : { column: "lost_reason_id", op: "eq", value: Number(reason) });

interface LostData {
  stages: Stage[];
  count: number;
  value: number;
  average: number | null;
  won: number;
  /** Count and value by reason; the key is the reason's id, or `none`. */
  reasons: { id: string; label: string | null; count: number; value: number }[];
  /** How many deals of each reason were lost at each stage. */
  atStage: Record<string, Record<string, number>>;
  byStage: Record<string, Record<string, number>>;
  late: number;
}

async function readLost(session: StaffSession, from: string, today: string): Promise<LostData> {
  const lost = lostSince(from);
  const stages = await stagesOf(session);
  const lateIds = stages.slice(-LATE_STAGES).map((stage) => stage.id);
  const [whole, byReason, atStage, byStage, late, alongside] = await Promise.all([
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: lost, groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "v" }, { fn: "avg", column: "amount", alias: "a" }] }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: lost, groupBy: ["lost_reason_id"], groupLabel: "lost_reason_id.label", aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "v" }], limit: 100 }),
    session.figure<Matrix>({ table: "deals", shape: "matrix", filters: lost, groupBy: ["lost_reason_id", "stage_id"], aggregations: [{ fn: "count", alias: "n" }] }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: lost, groupBy: ["stage_id"], aggregations: [{ fn: "sum", column: "amount", alias: "v" }, { fn: "count", alias: "n" }], limit: 50 }),
    session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters: [...lost, { column: "stage_id", op: "in", value: lateIds }], aggregations: [{ fn: "sum", column: "amount", alias: "v" }] }),
    closedFigures(session, { between: [from, today] }),
  ]);
  const totals = byKey(whole)["lost"];
  const reasons = byReason.items
    .map((item) => ({ id: item.key === null || item.key === "" ? NO_REASON : String(item.key), label: item.key === null || item.key === "" ? null : item.label, count: num(item.values?.["n"]), value: num(item.values?.["v"]) }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const cells = cellsOf(atStage);
  return {
    stages,
    count: num(totals?.["n"]),
    value: num(totals?.["v"]),
    average: totals === undefined ? null : num(totals["a"]),
    won: alongside.won.count,
    reasons,
    atStage: Object.fromEntries(Object.entries(cells).map(([key, value]) => [key === "null" || key === "" ? NO_REASON : key, value])),
    byStage: byKey(byStage),
    late: num(late.value),
  };
}

function Stat({ label, value, sub, tone, words }: { label: string; value: string; sub: string; tone?: "danger" | "pos"; words?: boolean }) {
  return (
    <div className="crm-stat mr-card" data-stat={label}>
      <div className="crm-stat-label">{label}</div>
      <div className={words === true ? "crm-stat-value crm-stat-words" : "crm-stat-value crm-mono"} data-tone={tone ?? "plain"}>
        {value}
      </div>
      <div className="crm-stat-sub">{sub}</div>
    </div>
  );
}

/** Several stages at once (a tie), as the ledger writes them: `Discovery / Qualified / Proposal`. */
const listed = (words: string[]): string => words.filter((word) => word !== "").join(" / ");

const readWindow = (text: string | undefined): Months => (WINDOWS.find((months) => String(months) === text) ?? 12) as Months;

export function Lost(props: ScreenProps) {
  const reason = props.rest[0];
  return reason === undefined ? <LostView /> : <OneReason reason={reason} months={readWindow(props.rest[1])} />;
}

function LostView() {
  const t = useT();
  const { session, f } = useScreen();
  const today = useMemo(() => f.dayKey(session.now()), [f, session]);
  const [months, setMonths] = useState<Months>(12);
  const from = monthsBack(today, months);
  const { load, reload } = useLoad(() => readLost(session, from, today), [session, from, today]);
  useLive(["deals"], reload);

  return (
    <div className="crm-screen crm-lost mr-screen" data-screen="lost">
      <div className="crm-screen-head">
        <div>
          <h1>{t("lost.title")}</h1>
          <p className="crm-screen-sub">{t("lost.sub", undefined, months)}</p>
        </div>
        <div className="crm-chips" role="group" aria-label={t("lost.window")}>
          {WINDOWS.map((one) => (
            <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={months === one} onClick={() => setMonths(one)}>
              {t("lost.window.months", undefined, one)}
            </button>
          ))}
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={140} />}>
        {(data) => {
          const top = data.reasons[0];
          const share = (value: number): string => (data.value === 0 ? "—" : f.percent(value / data.value));
          const stageName = (id: string): string => data.stages.find((stage) => String(stage.id) === id)?.label ?? "";
          const widest = largest(Object.fromEntries(data.stages.map((stage) => [String(stage.id), data.byStage[String(stage.id)]?.["v"] ?? 0]))).value;
          const lateNames = listed(data.stages.slice(-LATE_STAGES).map((stage) => stage.label));
          return (
            <div aria-busy={load.state === "ready" && load.again}>
              <div className="crm-stats">
                <Stat tone="danger" label={t("lost.stat.value")} value={f.money(data.value)} sub={t("closed.deals", undefined, data.count)} />
                <Stat label={t("lost.stat.average")} value={data.average === null ? "—" : f.money(Math.round(data.average))} sub={t("lost.stat.average.sub")} />
                <Stat words label={t("lost.stat.biggest")} value={top === undefined ? "—" : (top.label ?? t("lost.noReason"))} sub={top === undefined ? "" : `${f.money(top.value)} · ${share(top.value)}`} />
                <Stat tone="pos" label={t("lost.stat.won")} value={f.number(data.won)} sub={t("lost.stat.won.sub")} />
              </div>
              {data.count === 0 ? (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="check" size={21} />
                  </span>
                  <div className="crm-empty-title">{t("lost.empty")}</div>
                  <p>{t("lost.empty.body")}</p>
                </div>
              ) : (
                <div className="crm-lr-grid">
                  <section className="crm-panel mr-card" aria-labelledby="crm-lr-reasons">
                    <div className="crm-panel-head">
                      <h2 id="crm-lr-reasons">{t("lost.byReason")}</h2>
                      <span>{t("lost.byReason.sub")}</span>
                    </div>
                    {data.reasons.map((reason) => {
                      const most = largest(data.atStage[reason.id] ?? {});
                      return (
                        <ScreenLink key={reason.id} to="lost" rest={[reason.id, months]} className="crm-lr-reason mr-row">
                          <span className="crm-lr-reason-top">
                            <span className="crm-tm-name">{reason.label ?? t("lost.noReason")}</span>
                            <span className="crm-mono crm-tm-amount">{f.money(reason.value)}</span>
                            <span className="crm-mono crm-lr-share">{share(reason.value)}</span>
                          </span>
                          <span className="crm-lr-track" aria-hidden="true">
                            <span style={{ inlineSize: data.value === 0 ? "0%" : `${String((reason.value / data.value) * 100)}%` }} />
                          </span>
                          <span className="crm-lr-reason-foot">
                            <span>{t("closed.deals", undefined, reason.count)}</span>
                            {most.keys.length > 0 && <span>{t("lost.mostly", { stages: listed(most.keys.map(stageName)), count: f.number(most.value), all: f.number(reason.count) })}</span>}
                          </span>
                        </ScreenLink>
                      );
                    })}
                  </section>
                  <section className="crm-panel crm-panel-pad mr-card" aria-labelledby="crm-lr-where">
                    <h2 id="crm-lr-where">{t("lost.where")}</h2>
                    <div className="crm-lr-stages">
                      {data.stages.map((stage, i) => {
                        const value = data.byStage[String(stage.id)]?.["v"] ?? 0;
                        return (
                          <div key={stage.id} data-stage={stage.label}>
                            <div className="crm-lr-stage-top">
                              <span>{stage.label}</span>
                              <span className="crm-mono">{f.money(value)}</span>
                            </div>
                            <div className="crm-lr-track" aria-hidden="true">
                              <span data-tone={toneOf(i)} style={{ inlineSize: widest === 0 ? "0%" : `${String((value / widest) * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="crm-lr-note" data-figure="late">
                      {data.late > 0 ? t("lost.late", { amount: f.money(data.late), stages: lateNames }) : t("lost.late.none", { stages: lateNames })}
                    </p>
                  </section>
                </div>
              )}
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}

interface LostDeal extends Record<string, unknown> {
  id: number;
  name: string;
  owner_id: string | null;
  amount: number | string;
  closed_on: string | null;
  company: string | null;
  stage: string | null;
}
interface OneData {
  /** Null when no such reason is there for the reader. */
  label: string | null;
  found: boolean;
  stages: Stage[];
  people: People;
  wholeValue: number;
  count: number;
  value: number;
  average: number | null;
  atStage: Record<string, Record<string, number>>;
  byRep: { id: string; value: number }[];
  deals: LostDeal[];
  total: number;
}

async function readOne(session: StaffSession, reason: string, from: string): Promise<OneData> {
  const lost = lostSince(from);
  const these = [...lost, reasonIs(reason)];
  const [label, stages, people, whole, mine, atStage, byRep, deals] = await Promise.all([
    reason === NO_REASON ? Promise.resolve(null) : /^\d+$/.test(reason) ? session.get<{ label: string }>("lost_reasons", reason).then((row) => row?.label ?? undefined) : Promise.resolve(undefined),
    stagesOf(session),
    peopleOf(session),
    session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters: lost, aggregations: [{ fn: "sum", column: "amount", alias: "v" }] }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: these, groupBy: ["state"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "amount", alias: "v" }, { fn: "avg", column: "amount", alias: "a" }] }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: these, groupBy: ["stage_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 50 }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: these, groupBy: ["owner_id"], aggregations: [{ fn: "sum", column: "amount", alias: "v" }], limit: 200 }),
    session.list<LostDeal>("deals", { select: ["id", "name", "owner_id", "amount", "closed_on"], where: { and: these }, order: ["closed_at.desc", "id"], lookup: ["company:company_id.name", "stage:stage_id.label"], limit: 200, count: "exact" }),
  ]);
  const totals = byKey(mine)["lost"];
  return {
    label: label ?? null,
    found: label !== undefined,
    stages,
    people,
    wholeValue: num(whole.value),
    count: num(totals?.["n"]),
    value: num(totals?.["v"]),
    average: totals === undefined ? null : num(totals["a"]),
    atStage: byKey(atStage, "n"),
    byRep: Object.entries(byKey(byRep, "v"))
      .map(([id, values]) => ({ id, value: values["v"] ?? 0 }))
      .sort((a, b) => b.value - a.value),
    deals: deals.rows,
    total: deals.total ?? deals.rows.length,
  };
}

function OneReason({ reason, months }: { reason: string; months: Months }) {
  const t = useT();
  const { session, f } = useScreen();
  const today = useMemo(() => f.dayKey(session.now()), [f, session]);
  const from = monthsBack(today, months);
  const { load, reload } = useLoad(() => readOne(session, reason, from), [session, reason, from]);
  const again = useCallback(() => reload(), [reload]);
  useLive(["deals"], again);

  return (
    <div className="crm-screen crm-lost mr-screen" data-screen="lost-reason">
      <ScreenLink to="lost" className="crm-back">
        <Icon name="chevron-left" size={15} className="crm-flip" />
        {t("lost.title")}
      </ScreenLink>
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={3} height={140} />}>
        {(data) => {
          if (!data.found) return <NoRecord home={{ route: "lost", item: { route: "lost", label: "lost" } }} />;
          const name = (id: string | null): string => (id === null ? t("team.someone") : (data.people.names[id] ?? t("team.someone")));
          const most = largest(Object.fromEntries(Object.entries(data.atStage).map(([key, values]) => [key, values["n"] ?? 0])));
          const recent = data.deals[0];
          return (
            <>
              <div className="crm-screen-head">
                <div>
                  <h1>{data.label ?? t("lost.noReason")}</h1>
                  <p className="crm-screen-sub">{t("one.sub", { count: f.number(data.count), amount: f.money(data.value), months: t("lost.window.months", undefined, months) }, data.count)}</p>
                </div>
                <span className="crm-pill crm-mono crm-tm-pill" data-tone="danger" data-figure="share">
                  {t("one.share", { share: data.wholeValue === 0 ? "—" : f.percent(data.value / data.wholeValue) })}
                </span>
              </div>
              <div className="crm-stats">
                <Stat tone="danger" label={t("one.stat.value")} value={f.money(data.value)} sub={t("closed.deals", undefined, data.count)} />
                <Stat label={t("lost.stat.average")} value={data.average === null ? "—" : f.money(Math.round(data.average))} sub={t("one.stat.average.sub")} />
                <Stat
                  words
                  label={t("one.stat.dies")}
                  value={most.keys.length === 0 ? "—" : listed(most.keys.map((id) => data.stages.find((stage) => String(stage.id) === id)?.label ?? ""))}
                  sub={most.keys.length === 0 ? "" : t("one.stat.dies.sub", { count: f.number(most.value), all: f.number(data.count) })}
                />
                <Stat label={t("one.stat.recent")} value={recent === undefined || recent.closed_on === null ? "—" : f.dayShort(noonOf(recent.closed_on))} sub={recent?.name ?? ""} />
              </div>
              <div className="crm-lr-grid">
                <section className="crm-panel mr-card" aria-labelledby="crm-l1-deals">
                  <div className="crm-panel-head">
                    <h2 id="crm-l1-deals">{t("one.deals")}</h2>
                    <span>{data.total > data.deals.length ? t("one.deals.cut", { shown: f.number(data.deals.length), all: f.number(data.total) }) : t("one.deals.sub")}</span>
                  </div>
                  {data.deals.map((deal) => (
                    <div key={deal.id} className="crm-l1-deal">
                      <span className="crm-o1-ended-icon">
                        <Icon name="circle-slash" size={15} />
                      </span>
                      <div className="crm-tm-grow">
                        <div className="crm-tm-name">{deal.name}</div>
                        <div className="crm-tm-note">{t("one.meta", { company: deal.company ?? "", rep: firstName(name(deal.owner_id)), day: deal.closed_on === null ? "" : f.dayShort(noonOf(deal.closed_on)) })}</div>
                      </div>
                      <span className="crm-l1-end">
                        <span className="crm-mono crm-tm-amount">{f.money(deal.amount)}</span>
                        {deal.stage !== null && <span className="crm-pill">{deal.stage}</span>}
                      </span>
                    </div>
                  ))}
                  {data.deals.length === 0 && <p className="crm-tm-none">{t("lost.empty")}</p>}
                </section>
                <section className="crm-panel crm-panel-pad mr-card" aria-labelledby="crm-l1-reps">
                  <h2 id="crm-l1-reps">{t("one.reps")}</h2>
                  <div className="crm-l1-reps">
                    {data.byRep.map((rep) => (
                      <div key={rep.id} data-rep={firstName(name(rep.id))}>
                        <span className="crm-avatar crm-avatar-26" aria-hidden="true">
                          {initials(name(rep.id))}
                        </span>
                        <span className="crm-tm-grow">{name(rep.id)}</span>
                        <span className="crm-mono crm-tm-amount">{f.money(rep.value)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
