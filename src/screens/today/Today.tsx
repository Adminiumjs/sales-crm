/**
 * TODAY: a rep's morning. Three figures of her own pipeline, and the queue of
 * what she said she would do next, the overdue ones first.
 *
 * WHO WORKS THE FIGURES OUT. The server does (the session's `figure` and
 * `list`): the sums are of her own open deals as the server reaches them for
 * her, never of rows added up here. This screen only places each follow-up
 * under "overdue", "today" or "later" by the server's clock, and counts the
 * days the oldest one is late.
 *
 * A follow-up is ticked off or pushed on with one press. The change names
 * what the row held when it was read (`seen`), so a row a colleague or a rule
 * changed in between is not written over; and a reply that never arrives is
 * read back before the screen says anything (see `staffSession.ts`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, monthOf, weekOf, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { DealLink } from "../../selling/DealLink.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { canOpen, type MenuFacts, type PartId } from "../../shell/routes.ts";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import type { Grouped, StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";

/** A stage counts as "past proposal" from these odds up, as the design draws the figure. */
const PAST_PROPOSAL = 0.5;

interface Step extends Record<string, unknown> {
  id: number;
  deal_id: number | null;
  due_at: string;
  text: string | null;
  deal: string | null;
  company: string | null;
  amount: number | string | null;
}

interface TodayData {
  /** Her own open deals: how many, at full value, weighted by their stage's odds. */
  pipeline: { count: number; full: number; weighted: number };
  /** Of those, the ones expected to close in the month the server's clock is in. */
  closing: { count: number; full: number; late: number };
  steps: Step[];
}

const one = (grouped: Grouped): Record<string, number | null> => grouped.items[0]?.values ?? {};
const num = (value: number | null | undefined): number => (typeof value === "number" ? value : 0);

async function read(session: StaffSession, today: string): Promise<TodayData> {
  const me = session.config.user?.id ?? "";
  const mine = [
    { column: "state", op: "eq" as const, value: "open" },
    { column: "owner_id", op: "eq" as const, value: me },
  ];
  const [from, to] = monthOf(today);
  const thisMonth = [...mine, { column: "expected_close", op: "between" as const, value: [from, to] as [string, string] }];
  const sums = [
    { fn: "count" as const, alias: "n" },
    { fn: "sum" as const, column: "amount", alias: "full" },
    { fn: "sum" as const, column: "weighted_value", alias: "weighted" },
  ];
  const [pipeline, closing, stages, steps] = await Promise.all([
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: mine, groupBy: ["state"], aggregations: sums }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: thisMonth, groupBy: ["state"], aggregations: sums }),
    session.list<{ id: number; odds: number | string }>("stages", { select: ["id", "odds"], limit: 200 }),
    session.list<Step>("follow_ups", {
      where: { and: [{ column: "owner_id", op: "eq", value: me }, { column: "kind", op: "eq", value: "step" }, { column: "done", op: "eq", value: false }] },
      order: ["due_at"],
      lookup: ["deal:deal_id.name", "company:deal_id.company_id.name", "amount:deal_id.amount"],
      limit: 200,
    }),
  ]);
  const far = stages.rows.filter((stage) => Number(stage.odds) >= PAST_PROPOSAL).map((stage) => stage.id);
  const late = far.length === 0 || num(one(closing)["n"]) === 0 ? 0 : await session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters: [...thisMonth, { column: "stage_id", op: "in", value: far }], aggregations: [{ fn: "count", alias: "n" }] }).then((figure) => figure.value);
  return {
    pipeline: { count: num(one(pipeline)["n"]), full: num(one(pipeline)["full"]), weighted: num(one(pipeline)["weighted"]) },
    closing: { count: num(one(closing)["n"]), full: num(one(closing)["full"]), late },
    steps: steps.rows,
  };
}

type GroupKey = "overdue" | "today" | "later" | "after";

function grouped(steps: Step[], now: Date, f: Formatters): { key: GroupKey; items: Step[] }[] {
  const [, nextMonday] = weekOf(f.dayKey(now));
  const groups: Record<GroupKey, Step[]> = { overdue: [], today: [], later: [], after: [] };
  for (const step of steps) {
    const due = new Date(step.due_at);
    const key: GroupKey = due.getTime() < now.getTime() ? "overdue" : f.dayDiff(now, due) === 0 ? "today" : f.dayKey(due) < nextMonday ? "later" : "after";
    groups[key].push(step);
  }
  return (["overdue", "today", "later", "after"] as const).filter((key) => groups[key].length > 0).map((key) => ({ key, items: groups[key] }));
}

function Kpi({ icon, tone, label, value, sub, alarm }: { icon: string; tone: "accent" | "pos" | "danger"; label: string; value: string; sub: string; alarm?: boolean }) {
  return (
    <div className="crm-kpi mr-card">
      <div className="crm-kpi-head">
        <span className="crm-kpi-icon" data-tone={tone}>
          <Icon name={icon} size={15} />
        </span>
        <span className="crm-kpi-label">{label}</span>
      </div>
      <div className="crm-kpi-value" data-alarm={alarm === true ? "1" : "0"}>
        {value}
      </div>
      <div className="crm-kpi-sub">{sub}</div>
    </div>
  );
}

export function Today(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  // The server's clock, read once per look at the page: what is "overdue" does not flicker as the seconds pass.
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => read(session, today), [session, today]);
  const again = useCallback(() => {
    setNow(session.now());
    reload();
  }, [session, reload]);
  useLive(["follow_ups", "deals"], again);

  const facts = useMemo<MenuFacts>(
    () => ({ roles: (config.access?.roles ?? []).map((role) => role.slug), part: (id: PartId) => session.part(id), reads: (table) => session.can(table, "read"), built: isBuilt }),
    [config, session],
  );
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    pop.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Back to the button that opened it: the keyboard is where it was.
      const opener = pop.current?.parentElement?.querySelector<HTMLButtonElement>(".crm-step-tick");
      setOpen(null);
      opener?.focus();
    };
    const onDown = (event: MouseEvent): void => {
      if (pop.current !== null && !pop.current.parentElement!.contains(event.target as Node)) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const outcome = async (step: Step, kind: "done" | "day" | "week"): Promise<void> => {
    setOpen(null);
    setBusy(step.id);
    const seen = { done: false, due_at: step.due_at };
    if (kind === "done") {
      await toasts.say(session.update("follow_ups", step.id, { done: true }, { seen }), () => t("today.toast.done", { deal: step.deal ?? "" }));
    } else {
      // A day or a week on, at its own hour: from the day it was due, or from today when that day has passed
      // (a step four days late, pushed a day, is tomorrow's, not three days ago's).
      const was = new Date(step.due_at);
      const behind = Math.max(0, f.dayDiff(was, now));
      const from = new Date(was.getTime() + (behind + (kind === "day" ? 1 : 7)) * 86_400_000);
      await toasts.say(session.update("follow_ups", step.id, { due_at: from.toISOString() }, { seen }), () => t("today.toast.pushed", { when: `${f.dayShort(from)}, ${f.time(from)}` }));
    }
    setBusy(null);
    again();
  };

  const hour = f.hour(now);
  const first = (config.user?.name ?? "").split(/\s+/)[0] ?? "";
  const greeting = t(hour < 12 ? "today.greeting.morning" : hour < 18 ? "today.greeting.afternoon" : "today.greeting.evening", { name: first });

  return (
    <div className="crm-screen crm-today mr-screen" data-screen="today">
      <div className="crm-screen-head">
        <div>
          <h1>{greeting}</h1>
          <div className="crm-now">
            <Icon name="calendar-days" size={15} />
            <span>
              {f.dayLong(now)} · {f.time(now)}
            </span>
          </div>
        </div>
        <div className="crm-screen-actions">
          {canOpen("week", facts) && (
            <ScreenLink to="week" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
              <Icon name="calendar-range" />
              {t("today.week")}
            </ScreenLink>
          )}
          {canOpen("pipeline", facts) && (
            <ScreenLink to="pipeline" className="crm-btn crm-btn-primary crm-btn-40 mr-btn">
              <Icon name="columns-3" />
              {t("today.board")}
            </ScreenLink>
          )}
        </div>
      </div>

      <Loaded
        load={load}
        reload={again}
        skeleton={
          <>
            <div className="crm-kpis">
              <Skeleton rows={3} height={118} />
            </div>
            <div className="crm-queue-skeleton">
              <Skeleton rows={5} height={64} />
            </div>
          </>
        }
      >
        {(data) => {
          const groups = grouped(data.steps, now, f);
          const overdue = groups.find((group) => group.key === "overdue")?.items ?? [];
          const lateDays = overdue.length === 0 ? 0 : -f.dayDiff(now, new Date(overdue[0]!.due_at));
          return (
            <>
              <div className="crm-kpis">
                <Kpi icon="trending-up" tone="accent" label={t("today.kpi.pipeline")} value={f.money(data.pipeline.weighted)} sub={t("today.kpi.pipeline.sub", { amount: f.money(data.pipeline.full) }, data.pipeline.count)} />
                <Kpi
                  icon="target"
                  tone="pos"
                  label={t("today.kpi.closing", { month: f.monthLong(now) })}
                  value={f.money(data.closing.full)}
                  sub={data.closing.count === 0 ? t("today.kpi.closing.none") : t("today.kpi.closing.sub", { late: data.closing.late }, data.closing.count)}
                />
                <Kpi
                  icon="alarm-clock"
                  tone={overdue.length > 0 ? "danger" : "pos"}
                  label={t("today.kpi.overdue")}
                  value={f.number(overdue.length)}
                  sub={overdue.length === 0 ? t("today.kpi.overdue.none") : t("today.kpi.overdue.sub", undefined, lateDays)}
                  alarm={overdue.length > 0}
                />
              </div>

              <section className="crm-queue" aria-labelledby="crm-queue-title">
                <div className="crm-queue-head">
                  <h2 id="crm-queue-title">{t("today.queue")}</h2>
                  <span className="crm-pill" data-testid="queue-count">
                    {f.number(data.steps.length)}
                  </span>
                  <span className="crm-queue-hint">{t("today.queue.hint")}</span>
                  {canOpen("digest", facts) && (
                    <ScreenLink to="digest" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                      <Icon name="mail" size={14} />
                      {t("today.digest")}
                    </ScreenLink>
                  )}
                </div>

                {groups.map((group) => (
                  <div key={group.key} data-group={group.key}>
                    <div className="crm-queue-group">
                      <span className="crm-dot" data-tone={group.key === "overdue" ? "danger" : group.key === "today" ? "accent" : "subtle"} />
                      <span className="crm-queue-group-label">{t(`today.group.${group.key}`)}</span>
                      <span className="crm-queue-group-count">{f.number(group.items.length)}</span>
                    </div>
                    <ul className="crm-queue-list">
                      {group.items.map((step) => {
                        const due = new Date(step.due_at);
                        const late = group.key === "overdue";
                        const when = late ? `${f.dayShort(due)}, ${f.time(due)}` : group.key === "today" ? f.time(due) : `${f.weekdayShort(due)}, ${f.time(due)}`;
                        const isOpen = open === step.id;
                        return (
                          <li key={step.id} className="crm-step" data-late={late ? "1" : "0"} data-open={isOpen ? "1" : "0"} aria-busy={busy === step.id}>
                            <button
                              type="button"
                              className="crm-step-tick mr-gi"
                              aria-label={t("today.tick", { deal: step.deal ?? "" })}
                              aria-haspopup="menu"
                              aria-expanded={isOpen}
                              disabled={busy !== null || !session.can("follow_ups", "update")}
                              onClick={() => setOpen(isOpen ? null : step.id)}
                            >
                              <Icon name={isOpen ? "circle-dot" : "check"} size={15} />
                            </button>
                            <div className="crm-step-main">
                              <div className="crm-step-title">
                                <DealLink id={step.deal_id} className="crm-step-deal">
                                  {step.deal}
                                </DealLink>
                                {step.company !== null && (
                                  <span className="crm-chip">
                                    <span className="crm-dot" data-tone="accent" />
                                    {step.company}
                                  </span>
                                )}
                              </div>
                              <div className="crm-step-text">{step.text}</div>
                            </div>
                            <div className="crm-step-end">
                              <span className={late ? "crm-pill crm-pill-danger crm-mono" : "crm-mono crm-step-due"}>{when}</span>
                              <span className="crm-mono crm-step-amount">{f.money(step.amount)}</span>
                            </div>
                            {isOpen && (
                              <div className="crm-pop" role="menu" ref={pop} aria-label={t("today.outcome")}>
                                <div className="crm-pop-title">{t("today.outcome")}</div>
                                <button type="button" role="menuitem" className="crm-pop-item mr-row" onClick={() => void outcome(step, "done")}>
                                  <Icon name="check" size={15} />
                                  <span>{t("today.outcome.done")}</span>
                                </button>
                                <button type="button" role="menuitem" className="crm-pop-item mr-row" onClick={() => void outcome(step, "day")}>
                                  <Icon name="clock-arrow-up" size={15} />
                                  <span>{t("today.outcome.day")}</span>
                                </button>
                                <button type="button" role="menuitem" className="crm-pop-item mr-row" onClick={() => void outcome(step, "week")}>
                                  <Icon name="calendar-arrow-up" size={15} />
                                  <span>{t("today.outcome.week")}</span>
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}

                {data.steps.length === 0 && (
                  <div className="crm-empty">
                    <span className="crm-empty-icon">
                      <Icon name="check-check" size={22} />
                    </span>
                    <div className="crm-empty-title">{t("today.clear")}</div>
                    <p>{t("today.clear.body")}</p>
                  </div>
                )}
              </section>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
