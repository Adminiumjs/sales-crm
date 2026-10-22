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
 *
 * AN AREA (T04) says why it matters and what good looks like, and may be
 * measured by a live number the server answers over the rep's own work
 * (`coaching.ts`). The manager who wrote the plan adds an area and renames one;
 * the rep reads them, and the server refuses her either.
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
import { Dialog } from "../../ui/dialog.tsx";
import { ACTION_COLUMNS, ActionRow, Avatar, countOf, Empty, Head, NOBODY, PersonChips, readWho, tickAction, useF, type Action, type Who } from "./common.tsx";
import { AREA_COLUMNS, changeArea, liveOf, makeArea, MEASURES, type Area, type AreaValues, type Live, type Measure } from "./coaching.ts";

interface Plan extends Record<string, unknown> {
  id: number;
  rep_id: string;
  manager_id: string;
  review_on: string | null;
  runs_to: string | null;
}
interface PlanData {
  areas: Area[];
  steps: Action[];
  total: number;
  done: number;
}

const readPlans = (session: StaffSession): Promise<Plan[]> => session.list<Plan>("coaching_plans", { select: ["id", "rep_id", "manager_id", "review_on", "runs_to"], order: ["id"], limit: 200 }).then((page) => page.rows);

async function readPlan(session: StaffSession, plan: Plan): Promise<PlanData> {
  const areas = (await session.list<Area>("coaching_areas", { select: AREA_COLUMNS, where: { column: "plan_id", op: "eq", value: plan.id }, order: ["position", "id"], limit: 50 })).rows;
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
  // The plan's own manager adds and renames its areas; the server holds who (a rep reads them only).
  const writes = plan.manager_id === me;
  const canMake = writes && session.can("coaching_areas", "create");
  const canChange = writes && session.can("coaching_areas", "update");
  const [editing, setEditing] = useState<Area | "new" | null>(null);
  const today = f.dayKey(now);

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
              const good = area.good_looks_like ?? "";
              return (
                <section key={area.id} className="crm-tw-card crm-co-area" aria-labelledby={`crm-co-area-${String(area.id)}`} data-area={at + 1}>
                  <div className="crm-co-area-head">
                    <span className="crm-co-n crm-mono">{f.number(at + 1)}</span>
                    <div className="crm-co-area-words">
                      <h2 id={`crm-co-area-${String(area.id)}`}>{area.title}</h2>
                      {(area.why ?? "") !== "" && <p className="crm-co-why">{area.why}</p>}
                    </div>
                    <AreaNumber area={area} rep={plan.rep_id} f={f} now={now} today={today} round={round} />
                    {canChange && (
                      <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("coaching.area.edit.label", { title: area.title })} title={t("coaching.area.edit")} onClick={() => setEditing(area)}>
                        <Icon name="pencil" size={14} />
                      </button>
                    )}
                  </div>
                  {good !== "" && (
                    <div className="crm-co-good" data-testid="co-good">
                      <Icon name="target" size={14} />
                      <span>{good}</span>
                    </div>
                  )}
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
          {canMake && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi crm-co-new" data-testid="co-new-area" onClick={() => setEditing("new")}>
              <Icon name="plus" size={14} />
              {t("coaching.area.new")}
            </button>
          )}
          {editing !== null && (
            <AreaDialog
              plan={plan}
              area={editing === "new" ? null : editing}
              rep={rep}
              position={Math.max(-1, ...data.areas.map((one) => Number(one.position))) + 1}
              onClose={() => setEditing(null)}
              onSaved={onChanged}
            />
          )}

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

/** The area's live number, as the server answers it now; nothing at all where the area has none. */
function AreaNumber({ area, rep, f, now, today, round }: { area: Area; rep: string; f: Formatters; now: Date; today: string; round: number }) {
  const t = useT();
  const session = useSession();
  const { load } = useLoad(() => liveOf(session, area.measure, rep, now, today), [session, area.measure, rep, today, round]);
  if (area.measure === null || area.measure === undefined || load.state !== "ready" || load.data === null) return null;
  const live: Live = load.data;
  const value = live.kind === "money" ? f.money(live.value) : live.kind === "share" ? f.percent(live.value) : live.kind === "days" ? t("meeting.n.days", { count: f.number(live.value) }, live.value) : f.number(live.value);
  const label = live.kind === "count" && live.stage !== undefined ? t("coaching.live.first_stage", { stage: live.stage }) : t(`coaching.live.${area.measure}`);
  return (
    <div className="crm-co-live" data-testid="co-live" data-measure={area.measure}>
      <strong className="crm-mono">{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Add an area to a plan, or rename one (with its why, what good looks like and number). */
function AreaDialog({ plan, area, rep, position, onClose, onSaved }: { plan: Plan; area: Area | null; rep: string; position: number; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const [values, setValues] = useState<AreaValues>(() => ({ title: area?.title ?? "", why: area?.why ?? "", good_looks_like: area?.good_looks_like ?? "", measure: area?.measure ?? "" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newClientKey());
  const set = (patch: Partial<AreaValues>): void => (setValues((was) => ({ ...was, ...patch })), setError(null));
  const ready = values.title.trim() !== "";
  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    const saved = area === null ? await makeArea(session, plan, values, position, key.current) : await changeArea(session, area, values);
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t(area === null ? "coaching.area.toast.made" : "coaching.area.toast.changed", { title: values.title.trim() }), "pos");
    onSaved();
    onClose();
  };
  return (
    <Dialog
      shape="box"
      name={area === null ? "co-area-new" : "co-area-edit"}
      icon="graduation-cap"
      title={t(area === null ? "coaching.area.new" : "coaching.area.edit")}
      subtitle={t("coaching.area.dlg.sub", { name: rep })}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t(area === null ? "coaching.area.go.new" : "coaching.area.go.edit")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        <label className="crm-label" htmlFor="crm-co-title">
          {t("coaching.area.title")}
        </label>
        <input id="crm-co-title" data-autofocus className="crm-input mr-fld" maxLength={160} value={values.title} onChange={(event) => set({ title: event.target.value })} />
        <label className="crm-label" htmlFor="crm-co-why">
          {t("coaching.area.why")}
        </label>
        <textarea id="crm-co-why" className="crm-input crm-textarea mr-fld" rows={2} maxLength={400} value={values.why} onChange={(event) => set({ why: event.target.value })} />
        <label className="crm-label" htmlFor="crm-co-good">
          {t("coaching.area.good")}
        </label>
        <input id="crm-co-good" className="crm-input mr-fld" maxLength={300} value={values.good_looks_like} onChange={(event) => set({ good_looks_like: event.target.value })} />
        <label className="crm-label" htmlFor="crm-co-measure">
          {t("coaching.area.measure")}
        </label>
        <select id="crm-co-measure" className="crm-input mr-fld" value={values.measure} aria-describedby="crm-co-measure-note" onChange={(event) => set({ measure: event.target.value as Measure | "" })}>
          <option value="">{t("coaching.area.measure.none")}</option>
          {MEASURES.map((measure) => (
            <option key={measure} value={measure}>
              {t(`coaching.measure.${measure}`)}
            </option>
          ))}
        </select>
        <p id="crm-co-measure-note" className="crm-field-note">
          {t("coaching.area.measure.note")}
        </p>
      </fieldset>
      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
