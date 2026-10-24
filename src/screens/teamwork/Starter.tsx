/**
 * NEW STARTER (ledger screen 30): somebody who joins soon, and what has to
 * happen before the first day, in the first week and in the first month.
 *
 * The steps are ticked by who may change them: a rep her own steps, the
 * manager her team's starters' and steps, the CRM admin any (plan 68 X1; a
 * rep ticks a step and changes nothing else of it: the server holds each).
 * "3 of 12 done" and each group's count are totals the server answers; the
 * share done is those two divided.
 *
 * The first-year target is the starter's own figure once somebody sets it.
 * Until then the screen offers half the average full target, worked out from
 * the server's average of this year's targets.
 *
 * A NEW STARTER (T04) is made here by the sales manager or the CRM admin: a
 * name, the first day and the patch she takes on, and, in the same save, the
 * steps of the starter before her, none ticked (the server makes all or none).
 * "Her patch" is the server's count of the companies in that territory.
 */
import { useCallback, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf, type Formatters } from "../../lib/format.ts";
import { heldFromOwn, readUs } from "../../selling/whose.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey, type StaffSession } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { Avatar, childLink, countOf, Empty, NOBODY, num, readWho, truthy, useF, type Who } from "./common.tsx";

type Phase = "before" | "week" | "month";
const PHASES: readonly Phase[] = ["before", "week", "month"];
const ICON: Record<Phase, string> = { before: "calendar-check", week: "eye", month: "footprints" };

interface StarterRow extends Record<string, unknown> {
  id: number;
  name: string;
  starts_on: string;
  manager_id: string;
  first_year_target?: number | string | null;
  user_id: string | null;
  /** The territory she takes on (T04), its name and whose it is now; empty when none is said. */
  patch?: number | null;
  patch_name?: string | null;
  patch_owner?: string | null;
}
interface StepRow extends Record<string, unknown> {
  id: number;
  phase: Phase;
  text: string;
  owner_id: string | null;
  for_starter: unknown;
  done: unknown;
}
interface StarterData {
  steps: StepRow[];
  total: number;
  done: number;
  byPhase: Record<Phase, { all: number; done: number }>;
  /** The server's average of this year's targets the reader reaches; null when she reads none. */
  meanTarget: number | null;
  /** How many companies are in her patch, as the server counts them; null with no patch, or for a reader of no companies. */
  patchCompanies: number | null;
}

const readStarters = (session: StaffSession): Promise<StarterRow[]> =>
  session.list<StarterRow>("starters", { order: ["starts_on", "id"], lookup: ["patch_name:patch.name", "patch_owner:patch.owner_id"], limit: 50 }).then((page) => page.rows);

async function readStarter(session: StaffSession, starter: StarterRow, year: number): Promise<StarterData> {
  const mine = { column: "starter_id", op: "eq" as const, value: starter.id };
  const phase = (one: Phase, done: boolean | null) => countOf(session, "starter_steps", { and: [mine, { column: "phase", op: "eq", value: one }, ...(done === null ? [] : [{ column: "done", op: "eq" as const, value: done }])] });
  const patch = starter.patch ?? null;
  const [steps, before, beforeDone, week, weekDone, month, monthDone, done, mean, patchCompanies] = await Promise.all([
    session.list<StepRow>("starter_steps", { select: ["id", "phase", "text", "owner_id", "for_starter", "done"], where: mine, order: ["id"], limit: 200, count: "exact" }),
    phase("before", null),
    phase("before", true),
    phase("week", null),
    phase("week", true),
    phase("month", null),
    phase("month", true),
    countOf(session, "starter_steps", { and: [mine, { column: "done", op: "eq", value: true }] }),
    session.can("targets", "read") && session.can("starters", "update")
      ? session.figure<{ value: number | null }>({ table: "targets", shape: "single-metric", filters: [{ column: "year", op: "eq", value: year }], aggregations: [{ fn: "avg", column: "amount", alias: "v" }] }).then((answer) => answer.value, () => null)
      : Promise.resolve(null),
    patch !== null && session.can("companies", "read") ? countOf(session, "companies", { column: "territory_id", op: "eq", value: patch }) : Promise.resolve(null),
  ]);
  return { steps: steps.rows, total: Number(steps.total ?? steps.rows.length), done, byPhase: { before: { all: before, done: beforeDone }, week: { all: week, done: weekDone }, month: { all: month, done: monthDone } }, meanTarget: mean, patchCompanies };
}

export function Starter(_: ScreenProps) {
  const t = useT();
  const f = useF();
  const session = useSession();
  const [now, setNow] = useState(() => session.now());
  const { load: whoLoad } = useLoad(() => readWho(session), [session]);
  const who = whoLoad.state === "ready" ? whoLoad.data : NOBODY;
  const { load, reload } = useLoad(() => readStarters(session), [session]);
  const [picked, setPicked] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      setRound((n) => n + 1);
      reload();
    }, [session, reload]),
  );
  useLive(["starters", "starter_steps"], again);
  const today = f.dayKey(now);
  const canMake = session.can("starters", "create");
  const [making, setMaking] = useState(false);

  return (
    <div className="crm-screen crm-starter mr-screen" data-screen="starter">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={100} />}>
        {(starters) => {
          // Whoever starts next; when everybody has started, the one who started last.
          const starter = starters.find((one) => one.id === picked) ?? starters.find((one) => String(one.starts_on).slice(0, 10) >= today) ?? starters[starters.length - 1] ?? null;
          const adder = canMake ? (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="st-new" onClick={() => setMaking(true)}>
              <Icon name="user-round-plus" size={14} />
              {t("starter.new")}
            </button>
          ) : null;
          // The steps a new starter begins with: the last one's (whoever starts latest), none ticked.
          const before = [...starters].sort((a, b) => String(b.starts_on).localeCompare(String(a.starts_on)) || b.id - a.id)[0] ?? null;
          const dialog = making && (
            <NewStarter
              from={before}
              today={today}
              onClose={() => setMaking(false)}
              onMade={(id) => {
                setPicked(id);
                again();
              }}
            />
          );
          if (starter === null)
            return (
              <>
                <div className="crm-screen-head">
                  <h1>{t("starter.h1")}</h1>
                  {adder !== null && <div className="crm-screen-actions">{adder}</div>}
                </div>
                <Empty icon="user-round-plus" title={t("starter.none")} body={t("starter.none.body")} />
                {dialog}
              </>
            );
          return (
            <>
              {(starters.length > 1 || adder !== null) && (
                <div className="crm-st-top">
                  {starters.length > 1 && (
                    <div className="crm-chips" role="group" aria-label={t("starter.pick")}>
                      {starters.map((one) => (
                        <button key={one.id} type="button" className="crm-chip-btn mr-chip" aria-pressed={one.id === starter.id} onClick={() => setPicked(one.id)}>
                          {one.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {adder}
                </div>
              )}
              <One key={starter.id} starter={starter} who={who} f={f} now={now} round={round} onChanged={again} />
              {dialog}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function One({ starter, who, f, now, round, onChanged }: { starter: StarterRow; who: Who; f: Formatters; now: Date; round: number; onChanged: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const day = String(starter.starts_on).slice(0, 10);
  const starts = noonOf(day);
  const away = f.dayDiff(now, starts);
  const { load, reload } = useLoad(() => readStarter(session, starter, Number(f.dayKey(now).slice(0, 4))), [session, starter.id, round]);
  const [busy, setBusy] = useState<number | "target" | null>(null);
  // Whose a step is: its owner's, and its starter's manager's (with who leads them). Others are shown, not offered.
  const { load: usLoad } = useLoad(() => readUs(session), [session]);
  const ours = (person: string | null): boolean => usLoad.state === "ready" && (usLoad.data === "anybody" || (person !== null && usLoad.data.has(person)));
  const canTick = session.can("starter_steps", "update");
  const mayTick = (step: StepRow): boolean => canTick && (ours(step.owner_id) || ours(starter.manager_id));
  // Her own starter row is never hers to change (plan 68 X2): its first-year target is set by the CRM admin.
  const ownRow = heldFromOwn(session) && starter.user_id !== null && starter.user_id === session.config.user?.id;
  const canSet = session.can("starters", "update") && ours(starter.manager_id) && !ownRow;

  const tick = async (step: StepRow): Promise<void> => {
    if (busy !== null) return;
    const done = !truthy(step.done);
    setBusy(step.id);
    const saved = await session.update("starter_steps", step.id, { done }, { seen: { done: truthy(step.done) } });
    setBusy(null);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t(done ? "team.action.done" : "team.action.undone"), "pos");
    onChanged();
  };
  const setTarget = async (amount: number): Promise<void> => {
    if (busy !== null) return;
    setBusy("target");
    const saved = await session.update("starters", starter.id, { first_year_target: amount }, { seen: { first_year_target: starter.first_year_target ?? null } });
    setBusy(null);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t("starter.target.toast", { name: firstName(starter.name), amount: f.money(amount) }), "pos");
    onChanged();
  };

  return (
    <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={100} />}>
      {(data) => {
        const share = data.total === 0 ? 0 : data.done / data.total;
        const before = data.byPhase.before;
        const left = before.all - before.done;
        const stored = starter.first_year_target === null || starter.first_year_target === undefined || starter.first_year_target === "" ? null : num(starter.first_year_target);
        const offered = data.meanTarget === null ? null : Math.round(data.meanTarget / 2);
        return (
          <>
            <div className="crm-st-head" data-testid="st-head">
              <Avatar name={starter.name} size="lg" tone="accent" />
              <div className="crm-st-head-words">
                <h1>{starter.name}</h1>
                <div className="crm-screen-sub">
                  {t("starter.sub", { day: f.date(starts) })} · {away > 0 ? t("starter.away", { count: f.number(away) }, away) : away === 0 ? t("starter.today") : t("starter.started")}
                </div>
              </div>
              <div className="crm-st-done">
                <strong className="crm-mono" data-testid="st-pct">
                  {f.percent(share)}
                </strong>
                <span data-testid="st-done">{t("starter.done", { done: f.number(data.done), all: f.number(data.total) })}</span>
                <div className="crm-tw-bar" aria-hidden="true">
                  {data.done > 0 && <span data-part="done" style={{ flex: `${String(data.done)} 0 0` }} />}
                  {data.total - data.done > 0 && <span style={{ flex: `${String(data.total - data.done)} 0 0` }} />}
                </div>
              </div>
            </div>

            <div className="crm-stats crm-st-stats">
              <div className="crm-stat" data-testid="st-before">
                <div className="crm-stat-label">{t("starter.stat.before", { day: f.dayShort(starts) })}</div>
                <div className="crm-stat-value crm-mono">
                  {f.number(before.done)}/{f.number(before.all)}
                </div>
                <div className="crm-stat-sub">{left === 0 ? t("starter.stat.before.none") : t("starter.stat.before.left", { count: f.number(left) }, left)}</div>
              </div>
              {starter.patch !== null && starter.patch !== undefined && (
                <div className="crm-stat" data-testid="st-patch">
                  <div className="crm-stat-label">{t("starter.stat.patch")}</div>
                  <div className="crm-stat-value crm-mono">{data.patchCompanies === null ? "—" : f.number(data.patchCompanies)}</div>
                  <div className="crm-stat-sub">
                    {starter.patch_owner !== null && starter.patch_owner !== undefined && who.names[starter.patch_owner] !== undefined
                      ? t("starter.stat.patch.from", { patch: starter.patch_name ?? "", name: firstName(who.names[starter.patch_owner] ?? "") })
                      : t("starter.stat.patch.sub", { patch: starter.patch_name ?? "" })}
                  </div>
                </div>
              )}
              {(stored !== null || canSet || ownRow) && (
                <div className="crm-stat" data-testid="st-target">
                  <div className="crm-stat-label">{t("starter.stat.target")}</div>
                  <div className="crm-stat-value crm-mono">{stored !== null ? f.money(stored) : t("starter.stat.target.none")}</div>
                  <div className="crm-stat-sub">{t("starter.stat.target.sub")}</div>
                  {ownRow && session.can("starters", "update") && (
                    <div className="crm-stat-sub" data-testid="st-target-own">
                      {t("dealrules.starter.own")}
                    </div>
                  )}
                  {stored === null && canSet && offered !== null && offered > 0 && (
                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi crm-st-use" disabled={busy !== null} onClick={() => void setTarget(offered)}>
                      <Icon name="target" size={12} />
                      {t("starter.stat.target.use", { amount: f.money(offered) })}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="crm-st-groups">
              {PHASES.map((phase) => {
                const rows = data.steps.filter((step) => step.phase === phase);
                const counts = data.byPhase[phase];
                const whole = counts.all > 0 && counts.done === counts.all;
                return (
                  <section key={phase} className="crm-tw-card crm-st-group" aria-labelledby={`crm-st-${phase}`} data-phase={phase}>
                    <div className="crm-st-group-head">
                      <span className="crm-st-group-icon" data-whole={whole ? "1" : "0"}>
                        <Icon name={ICON[phase]} size={16} />
                      </span>
                      <div>
                        <h2 id={`crm-st-${phase}`}>{t(`starter.phase.${phase}`)}</h2>
                        <span>{t(`starter.phase.${phase}.sub`)}</span>
                      </div>
                      <span className="crm-pill crm-mono" data-tone={whole ? "pos" : undefined} data-testid={`st-count-${phase}`}>
                        {t("starter.phase.count", { done: f.number(counts.done), all: f.number(counts.all) })}
                      </span>
                    </div>
                    <ul className="crm-st-steps">
                      {rows.map((step) => {
                        const done = truthy(step.done);
                        const owner = truthy(step.for_starter) ? starter.name : step.owner_id === null ? "" : (who.names[step.owner_id] ?? "");
                        return (
                          <li key={step.id} className="crm-st-step" data-done={done ? "1" : "0"} data-step={step.id}>
                            <button type="button" className="crm-tw-tick mr-gi" role="checkbox" aria-checked={done} aria-label={step.text} disabled={!mayTick(step) || busy !== null} onClick={() => void tick(step)}>
                              {done && <Icon name="check" size={13} />}
                            </button>
                            <span className="crm-st-step-text">{step.text}</span>
                            {owner !== "" && (
                              <span className="crm-st-owner">
                                <Avatar name={owner} size="sm" tone={truthy(step.for_starter) ? "accent" : undefined} />
                                {firstName(owner)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {rows.length === 0 && <p className="crm-cv-none">{t("starter.phase.none")}</p>}
                  </section>
                );
              })}
            </div>
          </>
        );
      }}
    </Loaded>
  );
}

interface Territory extends Record<string, unknown> {
  id: number;
  name: string;
}

/**
 * Somebody who joins: a name, the first day and the patch she takes on. The steps of the starter before her come with
 * her in the same save, none ticked, when the reader may make steps; the server makes the starter and every step, or
 * nothing. Whose starter she is: the reader's.
 */
function NewStarter({ from, today, onClose, onMade }: { from: StarterRow | null; today: string; onClose: () => void; onMade: (id: number) => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const me = session.config.user?.id ?? "";
  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const [patch, setPatch] = useState("");
  const canSteps = from !== null && session.can("starter_steps", "create");
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newClientKey());
  const { load: places } = useLoad(() => (session.can("territories", "read") ? session.list<Territory>("territories", { select: ["id", "name"], order: ["name", "id"], limit: 200 }).then((page) => page.rows) : Promise.resolve([] as Territory[])), [session]);
  const { load: steps } = useLoad(
    () => (canSteps && from !== null ? session.list<StepRow>("starter_steps", { select: ["id", "phase", "text", "owner_id", "for_starter", "done"], where: { column: "starter_id", op: "eq", value: from.id }, order: ["id"], limit: 200 }).then((page) => page.rows) : Promise.resolve([] as StepRow[])),
    [session, from?.id, canSteps],
  );
  const theirs = steps.state === "ready" ? steps.data : [];
  const ready = name.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(day) && (!canSteps || !copy || steps.state === "ready");
  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    const link = copy && theirs.length > 0 ? await childLink(session, "starter_steps", "starter_id", "starters").catch(() => null) : null;
    if (copy && theirs.length > 0 && link === null) {
      setBusy(false);
      return setError(t("ui.unknown"));
    }
    const children = link !== null ? { [link]: theirs.map((step) => ({ values: { phase: step.phase, text: step.text, owner_id: truthy(step.for_starter) ? null : step.owner_id, for_starter: truthy(step.for_starter), done: false } })) } : undefined;
    const saved = await session.create<StarterRow>("starters", { name: name.trim(), starts_on: day, manager_id: me, patch: patch === "" ? null : Number(patch) }, key.current, children === undefined ? {} : { children });
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(children === undefined ? t("starter.new.toast", { name: name.trim() }) : t("starter.new.toast.steps", { name: name.trim(), count: theirs.length }, theirs.length), "pos");
    onMade(Number(saved.row.id));
    onClose();
  };
  return (
    <Dialog
      shape="box"
      name="st-new"
      icon="user-round-plus"
      title={t("starter.new")}
      subtitle={t("starter.new.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t("starter.new.go")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        <label className="crm-label" htmlFor="crm-st-name">
          {t("starter.new.name")}
        </label>
        <input id="crm-st-name" data-autofocus className="crm-input mr-fld" maxLength={120} autoComplete="off" value={name} onChange={(event) => (setName(event.target.value), setError(null))} />
        <label className="crm-label" htmlFor="crm-st-day">
          {t("starter.new.day")}
        </label>
        <input id="crm-st-day" className="crm-input crm-mono mr-fld" type="date" min={today} value={day} onChange={(event) => (setDay(event.target.value), setError(null))} />
        <label className="crm-label" htmlFor="crm-st-patch">
          {t("starter.new.patch")}
        </label>
        <select id="crm-st-patch" className="crm-input mr-fld" value={patch} onChange={(event) => (setPatch(event.target.value), setError(null))}>
          <option value="">{t("starter.new.patch.none")}</option>
          {(places.state === "ready" ? places.data : []).map((place) => (
            <option key={place.id} value={String(place.id)}>
              {place.name}
            </option>
          ))}
        </select>
        {canSteps && from !== null && (
          <label className="crm-check crm-st-copy">
            <input type="checkbox" checked={copy} onChange={(event) => setCopy(event.target.checked)} />
            <span>{steps.state === "ready" ? t("starter.new.copy", { name: firstName(from.name), count: theirs.length }, theirs.length) : t("starter.new.copy.reading", { name: firstName(from.name) })}</span>
          </label>
        )}
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
