/**
 * COACHING (ledger screen 41): the two things a rep and her manager agreed
 * to work on, and the steps under each.
 *
 * PRIVATE TO THE TWO OF THEM, as one-to-one notes are (`notes.ts`): the plan
 * and its areas are read by the rep and the manager they name and by nobody
 * else. A step is a row of the one action list (`common.tsx`): ticked here,
 * it reads as done in One-to-one notes and the weekly meeting where the same
 * row lives.
 *
 * "2 of 5 done" is two counts the server answers. The screen puts each step
 * under its area.
 */
import { useCallback, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { newClientKey, type StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { ACTION_COLUMNS, ActionRow, Avatar, countOf, Empty, Head, NOBODY, PersonChips, readWho, tickAction, useF, type Action, type Who } from "./common.tsx";

interface Plan extends Record<string, unknown> {
  id: number;
  rep_id: string;
  manager_id: string;
  review_on: string | null;
  runs_to: string | null;
}
interface Area extends Record<string, unknown> {
  id: number;
  plan_id: number;
  title: string;
  position: number;
}
interface PlanData {
  areas: Area[];
  steps: Action[];
  total: number;
  done: number;
}

const readPlans = (session: StaffSession): Promise<Plan[]> => session.list<Plan>("coaching_plans", { select: ["id", "rep_id", "manager_id", "review_on", "runs_to"], order: ["id"], limit: 200 }).then((page) => page.rows);

async function readPlan(session: StaffSession, plan: Plan): Promise<PlanData> {
  const areas = (await session.list<Area>("coaching_areas", { select: ["id", "plan_id", "title", "position"], where: { column: "plan_id", op: "eq", value: plan.id }, order: ["position", "id"], limit: 50 })).rows;
  if (areas.length === 0 || !session.can("actions", "read")) return { areas, steps: [], total: 0, done: 0 };
  const under = { column: "coaching_area_id", op: "in" as const, value: areas.map((area) => area.id) };
  const [steps, done] = await Promise.all([
    session.list<Action>("actions", { select: ACTION_COLUMNS, where: under, order: ["id"], limit: 200, count: "exact" }),
    countOf(session, "actions", { and: [under, { column: "done", op: "eq", value: true }] }),
  ]);
  return { areas, steps: steps.rows, total: Number(steps.total ?? steps.rows.length), done };
}

export function Coaching(_: ScreenProps) {
  const t = useT();
  const f = useF();
  const session = useSession();
  const me = session.config.user?.id ?? "";
  const [now, setNow] = useState(() => session.now());
  const { load: whoLoad } = useLoad(() => readWho(session), [session]);
  const who = whoLoad.state === "ready" ? whoLoad.data : NOBODY;
  const { load, reload } = useLoad(() => readPlans(session), [session]);
  const [picked, setPicked] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      setRound((n) => n + 1);
      reload();
    }, [session, reload]),
  );
  useLive(["actions"], again);

  return (
    <Loaded load={load} reload={reload} skeleton={<div className="crm-screen mr-screen"><Skeleton rows={3} height={120} /></div>}>
      {(plans) => {
        const leads = plans.some((plan) => plan.manager_id === me);
        const order = who.reps.length === 0 ? plans : [...plans].sort((a, b) => (who.reps.indexOf(a.rep_id) + 1 || 999) - (who.reps.indexOf(b.rep_id) + 1 || 999));
        const plan = order.find((one) => one.rep_id === picked) ?? order.find((one) => one.rep_id === me) ?? order[0] ?? null;
        return (
          <div className="crm-screen crm-coaching mr-screen" data-screen="coaching">
            <Head title={t(leads ? "coaching.h1.team" : "coaching.h1.mine")} sub={t(leads ? "coaching.sub.team" : "coaching.sub.mine")} />
            <div className="crm-tw-private">
              <Icon name="lock" size={14} />
              <span>{t("team.private")}</span>
            </div>
            {leads && order.length > 1 && <PersonChips people={order.map((one) => one.rep_id)} names={who.names} value={plan?.rep_id ?? null} onPick={setPicked} label={t("team.pick")} />}
            {plan === null ? <Empty icon="graduation-cap" title={t("coaching.none")} body={t("coaching.none.body")} /> : <PlanView key={plan.id} plan={plan} who={who} f={f} now={now} round={round} onChanged={again} />}
          </div>
        );
      }}
    </Loaded>
  );
}

function PlanView({ plan, who, f, now, round, onChanged }: { plan: Plan; who: Who; f: Formatters; now: Date; round: number; onChanged: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const me = session.config.user?.id ?? "";
  const { load, reload } = useLoad(() => readPlan(session, plan), [session, plan.id, round]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticking, setTicking] = useState<number | null>(null);
  const key = useRef(newClientKey());
  const rep = who.names[plan.rep_id] ?? "";
  const review = plan.review_on === null ? null : noonOf(String(plan.review_on).slice(0, 10));
  const until = plan.runs_to === null ? null : noonOf(String(plan.runs_to).slice(0, 10));
  const weeks = review === null ? 0 : Math.round(f.dayDiff(now, review) / 7);
  const canTick = session.can("actions", "update");
  const canAdd = session.can("actions", "create");

  const tick = async (action: Action, done: boolean): Promise<void> => {
    setTicking(action.id);
    const saved = await tickAction(session, action, done);
    setTicking(null);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t(done ? "team.action.done" : "team.action.undone"), "pos");
    onChanged();
  };
  const add = async (area: number): Promise<void> => {
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    const saved = await session.create("actions", { text, owner_id: plan.manager_id === me ? plan.rep_id : me, source: "coaching", coaching_area_id: area }, key.current);
    setBusy(false);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    key.current = newClientKey();
    setDraft("");
    toasts.show(t("coaching.toast.added"), "pos");
    onChanged();
  };

  return (
    <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={110} />}>
      {(data) => (
        <>
          <section className="crm-tw-card crm-co-who" data-testid="co-who">
            <Avatar name={rep} size="lg" />
            <div className="crm-no-who-words">
              <strong>{rep}</strong>
              {until !== null && <span>{t("coaching.runsTo", { day: f.dayShort(until) })}</span>}
            </div>
            {review !== null && (
              <div className="crm-co-fact" data-testid="co-review">
                <span className="crm-tw-kicker">{t("coaching.review")}</span>
                <strong>{f.dayShort(review)}</strong>
                <span className="crm-tw-quiet">{weeks <= 0 ? t("coaching.review.now") : t("coaching.review.weeks", { count: f.number(weeks) }, weeks)}</span>
              </div>
            )}
            <div className="crm-co-fact crm-co-progress" data-testid="co-progress">
              <span className="crm-tw-kicker">{t("coaching.progress")}</span>
              <strong className="crm-mono">{t("coaching.progress.of", { done: f.number(data.done), all: f.number(data.total) })}</strong>
              <div className="crm-tw-bar" aria-hidden="true">
                {data.done > 0 && <span data-part="done" style={{ flex: `${String(data.done)} 0 0` }} />}
                {data.total - data.done > 0 && <span style={{ flex: `${String(data.total - data.done)} 0 0` }} />}
              </div>
            </div>
          </section>

          <div className="crm-co-areas">
            {data.areas.map((area, at) => {
              const steps = data.steps.filter((step) => step.coaching_area_id === area.id);
              return (
                <section key={area.id} className="crm-tw-card crm-co-area" aria-labelledby={`crm-co-area-${String(area.id)}`} data-area={at + 1}>
                  <div className="crm-co-area-head">
                    <span className="crm-co-n crm-mono">{f.number(at + 1)}</span>
                    <h2 id={`crm-co-area-${String(area.id)}`}>{area.title}</h2>
                  </div>
                  <ul className="crm-tw-actions">
                    {steps.map((step) => (
                      <ActionRow key={step.id} action={step} here="coaching" names={who.names} f={f} onTick={canTick ? (one, on) => void tick(one, on) : null} busy={ticking === step.id} />
                    ))}
                  </ul>
                  {steps.length === 0 && <p className="crm-cv-none">{t("coaching.area.none")}</p>}
                </section>
              );
            })}
          </div>
          {data.areas.length === 0 && <Empty icon="graduation-cap" title={t("coaching.areas.none")} />}

          {canAdd && data.areas[0] !== undefined && (
            <div className="crm-tw-add crm-co-add">
              <input
                className="crm-input mr-fld"
                aria-label={t("coaching.add.label")}
                value={draft}
                maxLength={400}
                disabled={busy}
                placeholder={t("coaching.add.hint")}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void add(data.areas[0]!.id);
                }}
              />
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" disabled={draft.trim() === "" || busy} onClick={() => void add(data.areas[0]!.id)}>
                <Icon name="plus" size={14} />
                {t("coaching.add")}
              </button>
            </div>
          )}
          {isBuilt("notes") && session.can("one_to_ones", "read") && (
            <ScreenLink to="notes" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi crm-mt-link">
              <Icon name="notebook-pen" size={14} />
              {t("coaching.goNotes")}
            </ScreenLink>
          )}
        </>
      )}
    </Loaded>
  );
}
