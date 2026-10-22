/**
 * STAGE HEALTH: where work sits still, stage by stage, and for how long.
 *
 * WHO ADDS UP. Each stage's count and weighted value, and how many of its
 * deals have sat under the "warm" mark, between the two marks and past the
 * "stale" one, are counts the server makes (the marks are the business's own
 * settings; the cut-off moments are worked out from the server's clock). The
 * design's "typical age" is a median, which the server cannot answer, so it
 * is not drawn: nothing here sorts rows to find a middle.
 */
import { useCallback, useEffect, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import type { ScreenProps } from "../../shell/screens.tsx";
import { useSavedView, ViewBar } from "../own/savedView.tsx";
import { before, byKey, daysOf, daysSince, num, OPEN, peopleOf, stagesOf, toneOf, useScreen, type Days, type People, type Stage } from "./data.ts";

const BUCKETS = ["fresh", "warm", "stale"] as const;
type Bucket = (typeof BUCKETS)[number];

interface Oldest extends Record<string, unknown> {
  id: number;
  name: string;
  owner_id: string | null;
  amount: number | string;
  entered_stage_at: string | null;
  stage_id: number;
}
interface HealthData {
  stages: Stage[];
  people: People;
  days: Days;
  owners: string[];
  /** Count and weighted value by stage. */
  byStage: Record<string, Record<string, number>>;
  buckets: Record<Bucket, Record<string, Record<string, number>>>;
  oldest: Record<string, Oldest | undefined>;
}

async function read(session: StaffSession, f: Formatters, today: string, who: string | null): Promise<HealthData> {
  const scoped: Condition[] = who === null ? [OPEN] : [OPEN, { column: "owner_id", op: "eq", value: who }];
  const [stages, people, days] = await Promise.all([stagesOf(session), peopleOf(session), daysOf(session)]);
  const warm = before(f, today, days.warm);
  const stale = before(f, today, days.stale);
  const counted = (more: Condition[]) => session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [...scoped, ...more], groupBy: ["stage_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 50 });
  const sitting = ["id", "name", "owner_id", "amount", "entered_stage_at", "stage_id"];
  const [byStage, fresh, warmed, staled, byOwner, longest] = await Promise.all([
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: scoped, groupBy: ["stage_id"], aggregations: [{ fn: "count", alias: "n" }, { fn: "sum", column: "weighted_value", alias: "w" }], limit: 50 }),
    counted([{ column: "entered_stage_at", op: "gte", value: warm }]),
    counted([{ column: "entered_stage_at", op: "lt", value: warm }, { column: "entered_stage_at", op: "gte", value: stale }]),
    counted([{ column: "entered_stage_at", op: "lt", value: stale }]),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [OPEN], groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 200 }),
    // The open deals, the longest-sitting first: the first of each stage is the one sitting longest there.
    session.list<Oldest>("deals", { select: sitting, where: { and: scoped }, order: ["entered_stage_at", "id"], limit: 200, count: "exact" }),
  ]);
  // More open deals than one read holds: a stage's oldest may lie beyond it, so each stage is asked for its own.
  const whole = (longest.total ?? longest.rows.length) <= longest.rows.length;
  const oldest = whole
    ? stages.map((stage) => longest.rows.find((deal) => deal.stage_id === stage.id))
    : await Promise.all(stages.map((stage) => session.list<Oldest>("deals", { select: sitting, where: { and: [...scoped, { column: "stage_id", op: "eq", value: stage.id }] }, order: ["entered_stage_at", "id"], limit: 1 }).then((page) => page.rows[0])));
  const owning = Object.keys(byKey(byOwner, "n"));
  return {
    stages,
    people,
    days,
    owners: [...people.reps, ...owning.filter((id) => !people.reps.includes(id))],
    byStage: byKey(byStage),
    buckets: { fresh: byKey(fresh, "n"), warm: byKey(warmed, "n"), stale: byKey(staled, "n") },
    oldest: Object.fromEntries(stages.map((stage, i) => [String(stage.id), oldest[i]])),
  };
}

export function Health({ rest = [] }: Partial<ScreenProps>) {
  const t = useT();
  const { session, f } = useScreen();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const [who, setWho] = useState<string | null>(null);
  // `stage-health/view/<id>`: narrowed to the person a saved view names (S7).
  const view = useSavedView("health", rest);
  const viewId = view.state === "ready" ? view.view.id : null;
  useEffect(() => {
    if (view.state === "ready") setWho(view.view.filters.rep ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per view
  }, [viewId]);
  const { load, reload } = useLoad(() => read(session, f, today, who), [session, f, today, who]);
  const again = useCallback(() => {
    setNow(session.now());
    reload();
  }, [session, reload]);
  useLive(["deals", "stages"], again);

  return (
    <div className="crm-screen crm-health mr-screen" data-screen="health">
      <ViewBar screen="health" view={view} current={who === null ? {} : { rep: who }} names={load.state === "ready" ? load.data.people.names : {}} />
      <div className="crm-screen-head">
        <div>
          <h1>{t("health.title")}</h1>
          <p className="crm-screen-sub">{t("health.sub")}</p>
        </div>
      </div>
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={5} height={132} />}>
        {(data) => {
          const name = (id: string | null): string => (id === null ? t("team.someone") : (data.people.names[id] ?? t("team.someone")));
          const label = (bucket: Bucket): string =>
            bucket === "fresh"
              ? t("health.bucket.fresh", { days: f.number(data.days.warm) })
              : bucket === "warm"
                ? t("health.bucket.warm", { from: f.number(data.days.warm), to: f.number(data.days.stale - 1) })
                : t("health.bucket.stale", { days: f.number(data.days.stale) });
          return (
            <>
              <div className="crm-chips" role="group" aria-label={t("team.who")}>
                <button type="button" className="crm-chip-btn mr-chip" aria-pressed={who === null} onClick={() => setWho(null)}>
                  {t("team.all")}
                </button>
                {data.owners.map((id) => (
                  <button key={id} type="button" className="crm-chip-btn mr-chip" aria-pressed={who === id} onClick={() => setWho(id)}>
                    {firstName(name(id))}
                  </button>
                ))}
              </div>
              <div className="crm-hl-key">
                <span className="crm-tm-label">{t("health.key")}</span>
                {BUCKETS.map((bucket) => (
                  <span key={bucket}>
                    <span className="crm-hl-swatch" data-bucket={bucket} />
                    {label(bucket)}
                  </span>
                ))}
              </div>
              <div className="crm-hl-stages" aria-busy={load.state === "ready" && load.again}>
                {data.stages.map((stage, i) => {
                  const key = String(stage.id);
                  const count = data.byStage[key]?.["n"] ?? 0;
                  const oldest = data.oldest[key];
                  const sat = oldest === undefined ? 0 : (daysSince(f, now, oldest.entered_stage_at) ?? 0);
                  return (
                    <section key={stage.id} className="crm-hl-stage mr-card" data-stage={stage.label} aria-label={stage.label}>
                      <div className="crm-hl-head">
                        <span className="crm-dot" data-tone={toneOf(i)} />
                        <h2>{stage.label}</h2>
                        <span className="crm-pill crm-mono">{f.percent(num(stage.odds))}</span>
                        <div className="crm-hl-figures">
                          <span>
                            {t("health.deals")}
                            <span className="crm-mono" data-figure="count">
                              {f.number(count)}
                            </span>
                          </span>
                          <span>
                            {t("health.weighted")}
                            <span className="crm-mono" data-figure="weighted">
                              {f.money(data.byStage[key]?.["w"] ?? 0)}
                            </span>
                          </span>
                        </div>
                      </div>
                      {count > 0 && (
                        <div className="crm-hl-bar" aria-hidden="true">
                          {BUCKETS.map((bucket) => {
                            const n = data.buckets[bucket][key]?.["n"] ?? 0;
                            return n === 0 ? null : <span key={bucket} data-bucket={bucket} style={{ flexGrow: n }} />;
                          })}
                        </div>
                      )}
                      <div className="crm-hl-buckets">
                        {BUCKETS.map((bucket) => (
                          <span key={bucket} data-bucket={bucket}>
                            <span className="crm-hl-swatch" data-bucket={bucket} />
                            {label(bucket)}
                            <span className="crm-mono" data-figure={bucket}>
                              {f.number(data.buckets[bucket][key]?.["n"] ?? 0)}
                            </span>
                          </span>
                        ))}
                      </div>
                      {oldest !== undefined && (
                        <div className="crm-hl-oldest">
                          <span className="crm-tm-label">{t("health.longest")}</span>
                          <span className="crm-tm-name">{oldest.name}</span>
                          <span className="crm-pill crm-mono" data-tone={sat >= data.days.stale ? "danger" : sat >= data.days.warm ? "warn" : "plain"}>
                            {t("closed.days", undefined, sat)}
                          </span>
                          <span className="crm-mono crm-tm-amount">{f.money(oldest.amount)}</span>
                          <span className="crm-hl-rep">
                            <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                              {initials(name(oldest.owner_id))}
                            </span>
                            {firstName(name(oldest.owner_id))}
                          </span>
                        </div>
                      )}
                      {count === 0 && (
                        <p className="crm-tm-none">
                          {t("health.empty")} {t(i === 0 ? "health.empty.first" : i === data.stages.length - 1 ? "health.empty.last" : "health.empty.mid")}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
