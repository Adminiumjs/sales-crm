/**
 * NUDGES: the open deals three checks catch now — gone quiet, stuck in a
 * stage, closing soon and not yet agreed — with the days each check waits.
 *
 * TWO THINGS ARE KEPT APART HERE, because they are two things:
 *
 *  - THE LIST is read from the deals themselves, with the days the business
 *    set in its settings. It is right whatever the rules are doing.
 *  - TELLING THE OWNER BY ITSELF is done by three rules of the app, which an
 *    install ships switched off. Only somebody who may manage Adminium's
 *    automations can read whether a rule is on (the install's owner). For
 *    them this page says each rule's real state; for everybody else it says
 *    who decides and that it cannot tell, and never guesses.
 *
 * "Nudge <name>" is a comment on the deal that mentions its owner: the owner
 * is told, and the nudge sits on the deal. A snooze is the reader's own and
 * hides one deal from one check for a week.
 *
 * WHO ADDS UP. How many deals a check catches, and how many are caught at
 * all, are counts the server makes. The design's "rule hits" (the three
 * counts added) is not drawn.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { addDays, noonOf, type Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { LostReply, newClientKey, StaffError, type Condition, type StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { before, daysOf, daysSince, num, OPEN, peopleOf, useScreen, type Days, type People } from "./data.ts";

const RULES = ["quiet", "stuck", "soon"] as const;
type Rule = (typeof RULES)[number];
/** The least and the most days a check may wait, as the design sets them. */
const RANGE: Record<Rule, [number, number]> = { quiet: [3, 21], stuck: [7, 45], soon: [3, 30] };
const COLUMN: Record<Rule, string> = { quiet: "nudge_quiet_days", stuck: "nudge_stuck_days", soon: "nudge_soon_days" };
const RULE_ICON: Record<Rule, string> = { quiet: "bell", stuck: "alarm-clock", soon: "calendar-clock" };
/** "Not yet agreed": below the odds of a stage where the customer has said yes, as the app's own rule reads it. */
const AGREED_ODDS = 0.9;
const SNOOZE_DAYS = 7;

interface Caught extends Record<string, unknown> {
  id: number;
  name: string;
  owner_id: string | null;
  amount: number | string;
  expected_close: string | null;
  entered_stage_at: string | null;
  last_activity_at: string | null;
  company: string | null;
  stage: string | null;
}
interface Snooze extends Record<string, unknown> {
  id: number;
  rule: Rule;
  deal_id: number;
}
interface NudgeData {
  people: People;
  days: Days;
  open: number;
  /** Deals caught by at least one check, counted once. */
  caught: number;
  lists: Record<Rule, { rows: Caught[]; total: number }>;
  snoozes: Snooze[];
}
/** What the three rules are doing, where the reader may read it. */
type RuleStates = { known: true; on: Record<Rule, boolean | null> } | { known: false };

/** The condition a check makes of an open deal, less the deals the reader snoozed for it. */
function matches(rule: Rule, days: Days, f: Formatters, today: string, snoozes: Snooze[]): Condition[] {
  const mine =
    rule === "quiet"
      ? [{ column: "last_activity_at", op: "lt" as const, value: before(f, today, days.quiet) }]
      : rule === "stuck"
        ? [{ column: "entered_stage_at", op: "lt" as const, value: before(f, today, days.stuck) }]
        : [
            { column: "expected_close", op: "gte" as const, value: today },
            { column: "expected_close", op: "lte" as const, value: addDays(today, days.soon) },
            { column: "stage_odds", op: "lt" as const, value: AGREED_ODDS },
          ];
  return [...mine, ...snoozes.filter((snooze) => snooze.rule === rule).map((snooze) => ({ column: "id", op: "neq" as const, value: snooze.deal_id }))];
}

async function read(session: StaffSession, f: Formatters, today: string, now: Date): Promise<NudgeData> {
  const [people, days, snoozes] = await Promise.all([
    peopleOf(session),
    daysOf(session),
    session.list<Snooze>("nudge_snoozes", { select: ["id", "rule", "deal_id"], where: { column: "until", op: "gt", value: now.toISOString() }, limit: 200 }).then((page) => page.rows),
  ]);
  const count = (filters: Condition[]) => session.figure<{ value: number }>({ table: "deals", shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] }).then((figure) => num(figure.value));
  const [open, caught, ...lists] = await Promise.all([
    count([OPEN]),
    count([OPEN, { or: RULES.map((rule) => ({ and: matches(rule, days, f, today, snoozes) })) }]),
    ...RULES.map((rule) =>
      session.list<Caught>("deals", {
        select: ["id", "name", "owner_id", "amount", "expected_close", "entered_stage_at", "last_activity_at"],
        where: { and: [OPEN, ...matches(rule, days, f, today, snoozes)] },
        order: rule === "quiet" ? ["last_activity_at", "id"] : rule === "stuck" ? ["entered_stage_at", "id"] : ["expected_close", "id"],
        lookup: ["company:company_id.name", "stage:stage_id.label"],
        limit: 200,
        count: "exact",
      }),
    ),
  ]);
  return {
    people,
    days,
    open,
    caught,
    lists: Object.fromEntries(RULES.map((rule, i) => [rule, { rows: lists[i]!.rows, total: lists[i]!.total ?? lists[i]!.rows.length }])) as NudgeData["lists"],
    snoozes,
  };
}

/** The three rules' real state, from Adminium's automations: answered only to somebody who may manage them. */
async function readRules(session: StaffSession): Promise<RuleStates> {
  try {
    const doc = await session.call<{ rules: { enabled: boolean; managed?: { key?: string; templateKey?: string } | null }[] }>("GET", `/automations?connectionId=${encodeURIComponent(session.connectionId)}`);
    const on = Object.fromEntries(RULES.map((rule) => [rule, doc.rules.find((one) => one.managed?.templateKey === `nudge-${rule}`)?.enabled ?? null])) as Record<Rule, boolean | null>;
    return { known: true, on };
  } catch (error) {
    // Refused (no right to manage automations) or not reached: the page does not know, and says so.
    if (error instanceof StaffError || error instanceof LostReply) return { known: false };
    throw error;
  }
}

export function Nudges() {
  const t = useT();
  const { session, f } = useScreen();
  const toasts = useToasts();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => read(session, f, today, now), [session, f, today]);
  const rules = useLoad(() => readRules(session), [session]);
  const again = useCallback(() => {
    setNow(session.now());
    reload();
  }, [session, reload]);
  // A save here sets off its own live frame: one read for both.
  const soon = useCoalesced(again);
  useLive(["deals", "nudge_snoozes", "settings"], soon);
  const [busy, setBusy] = useState(false);
  /** Who was nudged while this page is open, and when: `deal:rule` → the day. */
  const [nudged, setNudged] = useState<Record<string, string>>({});
  const keys = useRef<Record<string, string>>({});
  const keyFor = (what: string): string => (keys.current[what] ??= newClientKey());

  const mayTune = session.can("settings", "update");
  const maySnooze = session.can("nudge_snoozes", "create");
  const mayNudge = session.can("comments", "create");
  const days = useMemo(() => (n: number): string => t("closed.days", undefined, n), [t]);

  const tune = async (data: NudgeData, rule: Rule, by: number): Promise<void> => {
    const was = data.days[rule];
    const next = Math.min(RANGE[rule][1], Math.max(RANGE[rule][0], was + by));
    // A press while the last one is being saved is dropped, not queued: the button stays focusable for the keyboard.
    if (next === was || data.days.row === null || busy) return;
    setBusy(true);
    await toasts.say(session.update("settings", data.days.row.id, { [COLUMN[rule]]: next }, { seen: { [COLUMN[rule]]: data.days.row[COLUMN[rule]] } }), () => t("nudges.toast.days", { rule: t(`nudges.rule.${rule}.title` as MessageKey), days: days(next) }));
    setBusy(false);
    soon();
  };
  const snooze = async (rule: Rule, deal: Caught): Promise<void> => {
    const until = new Date(session.now().getTime() + SNOOZE_DAYS * 86_400_000);
    const what = `snooze:${rule}:${String(deal.id)}`;
    setBusy(true);
    const saved = await toasts.say(session.create("nudge_snoozes", { rule, deal_id: deal.id, until: until.toISOString() }, keyFor(what)), () => t("nudges.toast.snoozed", { deal: deal.name, day: f.dayShort(until), time: f.time(until) }));
    if (saved !== null) delete keys.current[what];
    setBusy(false);
    soon();
  };
  const bringBack = async (data: NudgeData): Promise<void> => {
    setBusy(true);
    // One at a time: the server counts a person's requests, and each removal answers for itself.
    let back = true;
    for (const one of data.snoozes) back = (await session.remove("nudge_snoozes", one.id)).state === "saved" && back;
    toasts.show(t(back ? "nudges.toast.back" : "ui.unknown"), back ? "plain" : "danger");
    setBusy(false);
    soon();
  };
  /** A comment on the deal that mentions its owner: Adminium tells them, and the words stay on the deal. */
  const nudge = async (data: NudgeData, rule: Rule, deals: Caught[]): Promise<void> => {
    setBusy(true);
    for (const deal of deals) {
      if (deal.owner_id === null || nudged[`${String(deal.id)}:${rule}`] !== undefined) continue;
      const owner = data.people.names[deal.owner_id] ?? t("team.someone");
      const what = `nudge:${rule}:${String(deal.id)}`;
      const saved = await toasts.say(session.create("comments", { deal_id: deal.id, text: `@[${owner}](${deal.owner_id}) ${t(`nudges.message.${rule}` as MessageKey)}` }, keyFor(what)), () => t("nudges.toast.nudged", { name: firstName(owner), deal: deal.name }));
      if (saved === null) break;
      delete keys.current[what];
      setNudged((was) => ({ ...was, [`${String(deal.id)}:${rule}`]: f.dayShort(session.now()) }));
    }
    setBusy(false);
  };

  const state = rules.load.state === "ready" ? rules.load.data : null;
  const allOff = state !== null && state.known && RULES.every((rule) => state.on[rule] !== true);

  return (
    <div className="crm-screen crm-nudges mr-screen" data-screen="nudges">
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={4} height={120} />}>
        {(data) => {
          const name = (id: string | null): string => (id === null ? t("team.someone") : (data.people.names[id] ?? t("team.someone")));
          const day = (key: string | null): string => (key === null ? "" : f.dayShort(noonOf(key)));
          const moment = (at: string | null): string => (at === null ? "" : f.dayShort(new Date(at)));
          const why = (rule: Rule, deal: Caught): string =>
            rule === "quiet"
              ? t("nudges.why.quiet", { day: moment(deal.last_activity_at), stage: deal.stage ?? "", since: moment(deal.entered_stage_at) })
              : rule === "stuck"
                ? deal.expected_close === null
                  ? t("nudges.why.stuck.undated", { stage: deal.stage ?? "", since: moment(deal.entered_stage_at) })
                  : t("nudges.why.stuck", { stage: deal.stage ?? "", since: moment(deal.entered_stage_at), day: day(deal.expected_close) })
                : t("nudges.why.soon", { day: day(deal.expected_close), stage: deal.stage ?? "" });
          const trigger = (rule: Rule, deal: Caught): { words: string; tone: string } => {
            if (rule === "quiet") {
              const n = daysSince(f, now, deal.last_activity_at) ?? 0;
              return { words: t("nudges.trigger.quiet", { count: f.number(n) }, n), tone: "warn" };
            }
            if (rule === "stuck") {
              const n = daysSince(f, now, deal.entered_stage_at) ?? 0;
              return { words: t("team.sitting", { count: f.number(n) }, n), tone: n >= data.days.stale ? "danger" : "warn" };
            }
            const n = deal.expected_close === null ? 0 : f.dayDiff(now, noonOf(deal.expected_close));
            return { words: t("nudges.trigger.soon", { count: f.number(n) }, n), tone: "info" };
          };
          return (
            <>
              <div className="crm-screen-head">
                <div>
                  <h1>{t("nudges.title")}</h1>
                  <p className="crm-screen-sub">{t("nudges.sub")}</p>
                </div>
                <div className="crm-tm-pills">
                  {data.snoozes.length > 0 && maySnooze && (
                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy} onClick={() => void bringBack(data)}>
                      {t("nudges.snoozed", { count: f.number(data.snoozes.length) }, data.snoozes.length)}
                    </button>
                  )}
                  <span className="crm-pill crm-tm-pill" data-tone={data.caught > 0 ? "warn" : "pos"} data-figure="caught">
                    {t("nudges.total", { count: f.number(data.caught), open: f.number(data.open) }, data.caught)}
                  </span>
                </div>
              </div>

              {state !== null && (!state.known || allOff) && (
                <div className="crm-ndg-state" role="note" data-rules={state.known ? "off" : "unknown"}>
                  <span className="crm-tm-longest-icon">
                    <Icon name={state.known ? "circle-alert" : "lock"} />
                  </span>
                  <div>
                    <strong>{t(state.known ? "nudges.state.off.title" : "nudges.state.unknown.title")}</strong>
                    <p>{t(state.known ? "nudges.state.off" : "nudges.state.unknown")}</p>
                    <p>{t("nudges.state.days")}</p>
                  </div>
                </div>
              )}

              <div className="crm-ndg-rules">
                {RULES.map((rule) => {
                  const total = data.lists[rule].total;
                  const title = t(`nudges.rule.${rule}.title` as MessageKey);
                  return (
                    <section key={rule} className="crm-ndg-rule mr-card" data-rule={rule} aria-label={title}>
                      <div className="crm-ndg-rule-head">
                        <span className="crm-ndg-rule-icon">
                          <Icon name={RULE_ICON[rule]} />
                        </span>
                        <div className="crm-tm-grow">
                          <h2>{title}</h2>
                          <div className="crm-tm-note">{t(`nudges.rule.${rule}.sub` as MessageKey)}</div>
                        </div>
                      </div>
                      <div className="crm-ndg-rule-foot">
                        {mayTune && data.days.row !== null && (
                          <button type="button" className="crm-icon-btn mr-gi" aria-label={t("nudges.fewer", { rule: title })} disabled={data.days[rule] <= RANGE[rule][0]} aria-disabled={busy} onClick={() => void tune(data, rule, -1)}>
                            <Icon name="chevron-down" size={15} />
                          </button>
                        )}
                        <span className="crm-mono crm-ndg-days" data-figure="days">
                          {days(data.days[rule])}
                        </span>
                        {mayTune && data.days.row !== null && (
                          <button type="button" className="crm-icon-btn mr-gi" aria-label={t("nudges.more", { rule: title })} disabled={data.days[rule] >= RANGE[rule][1]} aria-disabled={busy} onClick={() => void tune(data, rule, 1)}>
                            <Icon name="chevron-up" size={15} />
                          </button>
                        )}
                        <span className="crm-pill crm-ndg-caught" data-tone={total > 0 ? "warn" : "plain"} data-figure="caught">
                          {total > 0 ? t("nudges.caught", { count: f.number(total) }) : t("nudges.caught.none")}
                        </span>
                      </div>
                      {state !== null && state.known && state.on[rule] !== null && (
                        <div className="crm-ndg-rule-state" data-on={state.on[rule] === true ? "1" : "0"}>
                          {t(state.on[rule] === true ? "nudges.rule.on" : "nudges.rule.off")}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>

              <div className="crm-ndg-groups" aria-busy={load.state === "ready" && load.again}>
                {RULES.filter((rule) => data.lists[rule].rows.length > 0).map((rule) => {
                  const list = data.lists[rule];
                  const left = list.rows.filter((deal) => deal.owner_id !== null && nudged[`${String(deal.id)}:${rule}`] === undefined);
                  return (
                    <section key={rule} className="crm-panel mr-card" data-group={rule} aria-label={t(`nudges.rule.${rule}.title` as MessageKey)}>
                      <div className="crm-panel-head">
                        <h2>{t(`nudges.rule.${rule}.title` as MessageKey)}</h2>
                        <span className="crm-pill crm-mono">{t("nudges.group.count", { count: f.number(list.total), open: f.number(data.open) })}</span>
                        {mayNudge && left.length > 0 && (
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi crm-ndg-all" disabled={busy} onClick={() => void nudge(data, rule, left)}>
                            {t("nudges.all")}
                          </button>
                        )}
                      </div>
                      {list.rows.map((deal) => {
                        const told = nudged[`${String(deal.id)}:${rule}`];
                        const hit = trigger(rule, deal);
                        return (
                          <div key={deal.id} className="crm-ndg-deal" data-deal={deal.name}>
                            <span className="crm-avatar" aria-hidden="true">
                              {initials(name(deal.owner_id))}
                            </span>
                            <div className="crm-tm-grow">
                              <div className="crm-feed-top">
                                <span className="crm-tm-name">{deal.name}</span>
                                {deal.company !== null && (
                                  <span className="crm-chip">
                                    <span className="crm-dot" data-tone="accent" />
                                    {deal.company}
                                  </span>
                                )}
                              </div>
                              <div className="crm-tm-note">{why(rule, deal)}</div>
                            </div>
                            <span className="crm-pill crm-mono" data-tone={hit.tone}>
                              {hit.words}
                            </span>
                            <span className="crm-mono crm-tm-amount">{f.money(deal.amount)}</span>
                            <div className="crm-tm-actions">
                              {told !== undefined && <span className="crm-pill" data-tone="pos">{t("nudges.nudged", { day: told })}</span>}
                              {told === undefined && mayNudge && deal.owner_id !== null && (
                                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy} onClick={() => void nudge(data, rule, [deal])}>
                                  <Icon name="bell" size={14} />
                                  {t("nudges.nudge", { name: firstName(name(deal.owner_id)) })}
                                </button>
                              )}
                              {maySnooze && (
                                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy} aria-label={t("nudges.snooze.label", { deal: deal.name })} onClick={() => void snooze(rule, deal)}>
                                  {t("nudges.snooze")}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {list.total > list.rows.length && <p className="crm-tm-none">{t("one.deals.cut", { shown: f.number(list.rows.length), all: f.number(list.total) })}</p>}
                    </section>
                  );
                })}
                {data.caught === 0 && (
                  <div className="crm-empty">
                    <span className="crm-empty-icon">
                      <Icon name="check" size={21} />
                    </span>
                    <div className="crm-empty-title">{t("nudges.clear")}</div>
                    <p>{t("nudges.clear.body")}</p>
                  </div>
                )}
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
