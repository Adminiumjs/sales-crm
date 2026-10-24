/**
 * ONE-TO-ONE NOTES (ledger screen 36): the running record of the half hour a
 * manager and a rep keep, and what each said they would do.
 *
 * PRIVATE TO THE TWO OF THEM (see `notes.ts`). A rep opens her own; her
 * manager picks whose. Nobody else has this line in their menu, and the
 * server answers nobody else a row.
 *
 * The manager writes a session (the day, what was said, the actions it
 * sets). Actions are rows of the one list (`common.tsx`): ticked here, they
 * read as done in Coaching and in the weekly meeting too, and the other way
 * round.
 *
 * WHAT TO COVER (T04). The record suggests up to four things (read from the
 * deals, the target and the queue, never kept); the manager ticks them off as
 * they are talked through and adds anything else to raise, and the session
 * keeps both with how long it ran. Where an action keeps its session (the
 * app's second stage on), each session lists the actions it set.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { ActionRow, Avatar, Empty, Head, mayTick, NOBODY, PersonChips, readWho, tickAction, truthy, useF, type Action, type Who } from "./common.tsx";
import { firstName } from "../../ui/people.ts";
import { raisedOf, readOneToOnes, readPair, saveSession, topicColumn, TOPICS, type DraftAction, type OneToOne, type Pair, type Topic } from "./notes.ts";
import { coverOf, leftOf } from "./targets.ts";

export function Notes(_: ScreenProps) {
  const t = useT();
  const f = useF();
  const session = useSession();
  const me = session.config.user?.id ?? "";
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load: whoLoad } = useLoad(() => readWho(session), [session]);
  const who = whoLoad.state === "ready" ? whoLoad.data : NOBODY;
  const { load, reload } = useLoad(() => readOneToOnes(session), [session]);
  const [picked, setPicked] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      setRound((n) => n + 1);
      reload();
    }, [session, reload]),
  );
  useLive(["actions", "one_to_one_sessions"], again);

  return (
    <Loaded load={load} reload={reload} skeleton={<div className="crm-screen mr-screen"><Skeleton rows={3} height={120} /></div>}>
      {(pairs) => {
        // Hers as the rep, or the manager's with each of her people.
        const leads = pairs.some((pair) => pair.manager_id === me);
        const order = who.reps.length === 0 ? pairs : [...pairs].sort((a, b) => (who.reps.indexOf(a.rep_id) + 1 || 999) - (who.reps.indexOf(b.rep_id) + 1 || 999));
        const pair = order.find((one) => one.rep_id === picked) ?? order.find((one) => one.rep_id === me) ?? order[0] ?? null;
        return (
          <div className="crm-screen crm-notes mr-screen" data-screen="notes">
            <Head title={t(leads ? "notes.h1.team" : "notes.h1.mine")} sub={t(leads ? "notes.sub.team" : "notes.sub.mine")} />
            <div className="crm-tw-private" data-testid="notes-private">
              <Icon name="lock" size={14} />
              <span>{t("team.private")}</span>
            </div>
            {leads && order.length > 1 && <PersonChips people={order.map((one) => one.rep_id)} names={who.names} value={pair?.rep_id ?? null} onPick={setPicked} label={t("team.pick")} />}
            {pair === null ? (
              <Empty icon="notebook-pen" title={t("notes.none")} body={t("notes.none.body")} />
            ) : (
              <PairView key={pair.id} pair={pair} who={who} f={f} now={now} today={today} round={round} leads={pair.manager_id === me} onChanged={again} />
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

function PairView({ pair, who, f, now, today, round, leads, onChanged }: { pair: OneToOne; who: Who; f: Formatters; now: Date; today: string; round: number; leads: boolean; onChanged: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const { load, reload } = useLoad(() => readPair(session, pair, now, today), [session, pair.id, today, round]);
  const [writing, setWriting] = useState(false);
  const [ticking, setTicking] = useState<number | null>(null);
  // What to cover: the lines ticked off and anything else raised, kept with the session when it is saved.
  const [covered, setCovered] = useState<readonly Topic[]>([]);
  const [raised, setRaised] = useState<readonly string[]>([]);
  const opener = useRef<HTMLButtonElement>(null);
  // Closing the form gives the focus back to "New session", once that button is drawn again.
  const giveBack = useRef(false);
  useEffect(() => {
    if (writing || !giveBack.current) return;
    giveBack.current = false;
    opener.current?.focus();
  }, [writing]);
  const rep = who.names[pair.rep_id] ?? "";
  const manager = who.names[pair.manager_id] ?? "";
  const next = pair.next_at === null ? null : new Date(pair.next_at);
  const inDays = next === null ? 0 : f.dayDiff(now, next);
  const canWrite = session.can("one_to_one_sessions", "create") && leads;
  const canTick = session.can("actions", "update");
  const me = session.config.user?.id ?? "";

  const tick = async (action: Action, done: boolean): Promise<void> => {
    setTicking(action.id);
    const saved = await tickAction(session, action, done);
    setTicking(null);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t(done ? "team.action.done" : "team.action.undone"), "pos");
    onChanged();
  };

  return (
    <>
      <section className="crm-tw-card crm-no-who" data-testid="notes-who">
        <Avatar name={rep} size="lg" />
        <div className="crm-no-who-words">
          <strong>{rep}</strong>
          <span>{leads ? t("team.with", { name: manager }) : t("notes.with.manager", { name: manager })}</span>
        </div>
        {next !== null && (
          <div className="crm-no-next" data-testid="notes-next">
            <div>
              <strong>{f.dayShort(next)}</strong> <span className="crm-mono">{f.time(next)}</span>
            </div>
            <span>{inDays <= 0 ? t("notes.next.today") : inDays === 1 ? t("notes.next.tomorrow") : t("notes.next.in", { count: f.number(inDays) }, inDays)}</span>
          </div>
        )}
      </section>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={110} />}>
        {(data) => {
          const open = data.actions.filter((action) => !truthy(action.done));
          const done = data.actions.filter((action) => truthy(action.done));
          return (
            <div className="crm-tw-grid">
              <div className="crm-tw-col">
                <Raise
                  data={data}
                  f={f}
                  now={now}
                  canWrite={canWrite}
                  covered={covered}
                  onTick={(topic) => setCovered((was) => (was.includes(topic) ? was.filter((one) => one !== topic) : [...was, topic]))}
                  raised={raised}
                  onRaise={(line) => setRaised((was) => [...was, line])}
                  onDrop={(at) => setRaised((was) => was.filter((_, i) => i !== at))}
                  manager={manager}
                  opener={
                    canWrite && !writing ? (
                      <button ref={opener} type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-testid="notes-new" onClick={() => setWriting(true)}>
                        <Icon name="plus" size={14} />
                        {t("notes.new")}
                      </button>
                    ) : null
                  }
                />
                {writing && (
                  <SessionForm
                    pair={pair}
                    who={who}
                    today={today}
                    covered={covered}
                    raised={raised}
                    onClose={() => {
                      giveBack.current = true;
                      setWriting(false);
                    }}
                    onSaved={() => {
                      setCovered([]);
                      setRaised([]);
                      onChanged();
                    }}
                  />
                )}

                <section className="crm-tw-card" aria-labelledby="crm-no-before">
                  <div className="crm-tw-card-head">
                    <h2 id="crm-no-before">{t("notes.before")}</h2>
                    <span className="crm-tw-quiet">{t("notes.before.count", { count: f.number(data.sessionCount) }, data.sessionCount)}</span>
                  </div>
                  <ol className="crm-no-sessions">
                    {data.sessions.map((one) => {
                      const day = String(one.held_on).slice(0, 10);
                      const ago = f.dayDiff(noonOf(day), now);
                      const minutes = one.minutes === null || one.minutes === undefined || one.minutes === "" ? null : Number(one.minutes);
                      const ticked = TOPICS.filter((topic) => truthy(one[topicColumn(topic)]));
                      const lines = raisedOf(one);
                      const set = data.linked ? data.actions.filter((action) => action.session_id === one.id) : [];
                      return (
                        <li key={one.id} className="crm-no-session" data-session={one.id}>
                          <div className="crm-no-session-head">
                            <strong>{f.dayShort(noonOf(day))}</strong>
                            <span className="crm-mono">{ago <= 0 ? t("notes.ago.today") : ago === 1 ? t("notes.ago.yesterday") : t("notes.ago", { count: f.number(ago) }, ago)}</span>
                            {minutes !== null && (
                              <span className="crm-mono crm-no-session-mins" data-testid="notes-minutes">
                                {t("notes.session.minutes", { count: f.number(minutes) }, minutes)}
                              </span>
                            )}
                          </div>
                          {(one.notes ?? "")
                            .split(/\n+/)
                            .map((line) => line.trim())
                            .filter((line) => line !== "")
                            .map((line, at) => (
                              <p key={at}>{line}</p>
                            ))}
                          {(ticked.length > 0 || lines.length > 0) && (
                            <ul className="crm-no-covered" data-testid="notes-covered">
                              {ticked.map((topic) => (
                                <li key={topic} data-topic={topic}>
                                  <Icon name="check" size={12} />
                                  {t(`notes.topic.${topic}`)}
                                </li>
                              ))}
                              {lines.map((line, at) => (
                                <li key={`raised-${String(at)}`} data-topic="raised">
                                  <Icon name="plus" size={12} />
                                  {line}
                                </li>
                              ))}
                            </ul>
                          )}
                          {set.length > 0 && (
                            <ul className="crm-tw-actions crm-no-session-actions" data-testid="notes-session-actions">
                              {set.map((action) => (
                                <ActionRow key={action.id} action={action} here="one-to-one" names={who.names} f={f} onTick={canTick && mayTick(action, me) ? (row, on) => void tick(row, on) : null} busy={ticking === action.id} />
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {data.sessions.length === 0 && !writing && <p className="crm-cv-none">{t("notes.before.none")}</p>}
                </section>
              </div>

              <div className="crm-tw-col">
                <section className="crm-tw-card" aria-labelledby="crm-no-open" data-testid="notes-open">
                  <div className="crm-tw-card-head">
                    <h2 id="crm-no-open">{t("notes.open")}</h2>
                    <span className="crm-mono" data-testid="notes-open-count">
                      {t("notes.open.count", { open: f.number(data.openCount), all: f.number(data.actionCount) })}
                    </span>
                  </div>
                  {open.length === 0 ? (
                    <p className="crm-cv-none">{t("notes.open.none")}</p>
                  ) : (
                    <ul className="crm-tw-actions">
                      {open.map((action) => (
                        <ActionRow key={action.id} action={action} here="one-to-one" names={who.names} f={f} onTick={canTick && mayTick(action, me) ? (one, on) => void tick(one, on) : null} busy={ticking === action.id} />
                      ))}
                    </ul>
                  )}
                  {done.length > 0 && (
                    <>
                      <div className="crm-tw-kicker crm-no-done-head">{t("notes.done")}</div>
                      <ul className="crm-tw-actions" data-testid="notes-done">
                        {done.map((action) => (
                          <ActionRow key={action.id} action={action} here="one-to-one" names={who.names} f={f} onTick={canTick && mayTick(action, me) ? (one, on) => void tick(one, on) : null} busy={ticking === action.id} />
                        ))}
                      </ul>
                    </>
                  )}
                </section>

                <section className="crm-tw-card" aria-labelledby="crm-no-where" data-testid="notes-where">
                  <div className="crm-tw-card-head">
                    <h2 id="crm-no-where">{t(leads ? "notes.where" : "notes.where.mine")}</h2>
                  </div>
                  <dl className="crm-no-stats">
                    {data.year.target !== null && (
                      <div>
                        <dt>{t("notes.stat.cover")}</dt>
                        <dd className="crm-mono" data-stat="cover">
                          {((share) => (share === null ? "—" : f.percent(share)))(coverOf(data.year.sums.toward, data.year.target))}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>{t("notes.stat.open")}</dt>
                      <dd className="crm-mono" data-stat="weighted">
                        {f.money(data.year.sums.weighted)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("notes.stat.deals")}</dt>
                      <dd className="crm-mono" data-stat="deals">
                        {f.number(data.year.sums.deals)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("notes.stat.won")}</dt>
                      <dd className="crm-mono" data-stat="booked">
                        {f.money(data.year.sums.booked)}
                      </dd>
                    </div>
                  </dl>
                  <p className="crm-tw-quiet">{t("notes.foot")}</p>
                </section>
              </div>
            </div>
          );
        }}
      </Loaded>
    </>
  );
}

/**
 * What to cover: what the record suggests raising (read from the deals, the target and the queue, not kept anywhere),
 * and anything else the manager adds. She ticks a line off as it is talked through; the ticks and the added lines are
 * kept with the session she saves next.
 */
function Raise({
  data,
  f,
  now,
  canWrite,
  covered,
  onTick,
  raised,
  onRaise,
  onDrop,
  manager,
  opener,
}: {
  data: Pair;
  f: Formatters;
  now: Date;
  canWrite: boolean;
  covered: readonly Topic[];
  onTick: (topic: Topic) => void;
  raised: readonly string[];
  onRaise: (line: string) => void;
  onDrop: (at: number) => void;
  manager: string;
  opener: ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const lines: { key: Topic; text: string; from: string }[] = [];
  if (data.sitting !== null && data.sitting.since !== null) {
    const days = f.dayDiff(new Date(data.sitting.since), now);
    lines.push({ key: "sitting", text: t("notes.raise.sitting", { deal: data.sitting.name, stage: data.sitting.stage ?? "", count: f.number(days) }, days), from: t("notes.raise.from.board") });
  }
  if (data.biggest !== null) lines.push({ key: "biggest", text: t("notes.raise.biggest", { deal: data.biggest.name, amount: f.money(data.biggest.amount) }), from: t("notes.raise.from.biggest") });
  if (data.year.target !== null) {
    const share = coverOf(data.year.sums.toward, data.year.target);
    lines.push({ key: "target", text: t("notes.raise.target", { share: share === null ? "—" : f.percent(share), left: f.money(leftOf(data.year.sums.toward, data.year.target)) }), from: t("notes.raise.from.targets") });
  }
  if (data.late > 0) lines.push({ key: "late", text: t("notes.raise.late", { count: f.number(data.late) }, data.late), from: t("notes.raise.from.today") });
  if (lines.length === 0 && !canWrite) return null;
  const add = (): void => {
    const line = draft.trim();
    if (line === "") return;
    onRaise(line);
    setDraft("");
  };
  return (
    <section className="crm-tw-card" aria-labelledby="crm-no-raise" data-testid="notes-raise">
      <div className="crm-tw-card-head">
        <h2 id="crm-no-raise">{t("notes.raise")}</h2>
        <span className="crm-mono">{f.number(lines.length + raised.length)}</span>
        {opener}
      </div>
      <ul className="crm-no-raise">
        {lines.map((line) => {
          const on = covered.includes(line.key);
          return (
            <li key={line.key} data-raise={line.key} data-on={on ? "1" : "0"}>
              {canWrite && (
                <button type="button" className="crm-tw-tick mr-gi" role="checkbox" aria-checked={on} aria-label={line.text} onClick={() => onTick(line.key)}>
                  {on && <Icon name="check" size={13} />}
                </button>
              )}
              <span>{line.text}</span>
              <em>{line.from}</em>
            </li>
          );
        })}
        {raised.map((line, at) => (
          <li key={`raised-${String(at)}`} data-raise="raised">
            <span>{line}</span>
            <em>{t("notes.raise.from.added", { name: firstName(manager) })}</em>
            <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("notes.raise.drop", { line })} onClick={() => onDrop(at)}>
              <Icon name="x" size={13} />
            </button>
          </li>
        ))}
      </ul>
      {canWrite && (
        <>
          <div className="crm-tw-add">
            <input
              className="crm-input mr-fld"
              aria-label={t("notes.raise.add.label")}
              value={draft}
              maxLength={160}
              placeholder={t("notes.raise.add.hint")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" disabled={draft.trim() === ""} onClick={add}>
              <Icon name="plus" size={14} />
              {t("notes.raise.add")}
            </button>
          </div>
          <p className="crm-tw-quiet crm-no-raise-note">{t("notes.raise.kept")}</p>
        </>
      )}
    </section>
  );
}

function SessionForm({ pair, who, today, covered, raised, onClose, onSaved }: { pair: OneToOne; who: Who; today: string; covered: readonly Topic[]; raised: readonly string[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const f = useF();
  const blank = (): DraftAction => ({ text: "", owner: pair.rep_id, due: "", key: newClientKey() });
  const [day, setDay] = useState(today);
  const [notes, setNotes] = useState("");
  const [minutes, setMinutes] = useState("");
  const [actions, setActions] = useState<DraftAction[]>(() => [blank()]);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key for this session, for as long as the form is open.
  const key = useRef(newClientKey());
  const length = minutes.trim() === "" ? null : Number(minutes);
  const lengthOk = length === null || (Number.isInteger(length) && length >= 5 && length <= 240);
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(day) && notes.trim() !== "" && lengthOk;
  const change = (at: number, patch: Partial<DraftAction>): void => setActions((was) => was.map((one, i) => (i === at ? { ...one, ...patch } : one)));

  const save = async (): Promise<void> => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    const slow = setTimeout(() => setChecking(true), 1200);
    const done = await saveSession(session, pair, { held_on: day, notes: notes.trim(), covered, raised, minutes: length }, actions.filter((one) => one.text.trim() !== "").map((one) => ({ ...one, text: one.text.trim() })), key.current);
    clearTimeout(slow);
    setChecking(false);
    setBusy(false);
    if (done.state === "refused") return setError(t("ui.refused", { reason: reasonOf(done.error, t) }));
    if (done.state === "unknown") return setError(t("ui.unknown"));
    if (done.failed > 0) toasts.show(t("notes.toast.partly", { count: done.failed }, done.failed), "danger", true);
    else toasts.show(done.actions === 0 ? t("notes.toast.saved") : t("notes.toast.saved.actions", { count: done.actions }, done.actions), "pos");
    onSaved();
    onClose();
  };

  return (
    <div
      className="crm-no-form"
      role="form"
      aria-label={t("notes.new")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="crm-no-form-head">
        <strong>{t("notes.new")}</strong>
        <span>{t("team.with", { name: who.names[pair.rep_id] ?? "" })}</span>
      </div>
      <fieldset className="crm-fields" disabled={busy}>
        <label className="crm-label" htmlFor="crm-no-day">
          {t("notes.form.date")}
        </label>
        <input id="crm-no-day" className="crm-input crm-mono crm-no-day mr-fld" type="date" value={day} max={today} onChange={(event) => setDay(event.target.value)} />
        <label className="crm-label" htmlFor="crm-no-notes">
          {t("notes.form.notes")}
        </label>
        <textarea id="crm-no-notes" className="crm-input crm-textarea mr-fld" autoFocus rows={4} maxLength={4000} value={notes} onChange={(event) => (setNotes(event.target.value), setError(null))} />
        <label className="crm-label" htmlFor="crm-no-mins">
          {t("notes.form.minutes")}
        </label>
        <input id="crm-no-mins" className="crm-input crm-mono crm-no-mins mr-fld" type="number" inputMode="numeric" min={5} max={240} step={5} value={minutes} aria-describedby="crm-no-mins-note" onChange={(event) => (setMinutes(event.target.value), setError(null))} />
        <p id="crm-no-mins-note" className="crm-field-note">
          {lengthOk ? t("notes.form.minutes.note", { count: f.number(covered.length + raised.length) }, covered.length + raised.length) : t("notes.form.minutes.bad")}
        </p>
        <div role="group" aria-label={t("notes.form.actions")}>
          <div className="crm-label">{t("notes.form.actions")}</div>
          {actions.map((action, at) => (
            <div key={action.key} className="crm-no-act">
              <input className="crm-input crm-input-sm mr-fld" aria-label={t("notes.form.action", { n: at + 1 })} value={action.text} maxLength={400} placeholder={t("notes.form.action.hint")} onChange={(event) => change(at, { text: event.target.value })} />
              <select className="crm-input crm-input-sm mr-fld" aria-label={t("notes.form.owner", { n: at + 1 })} value={action.owner} onChange={(event) => change(at, { owner: event.target.value })}>
                <option value={pair.rep_id}>{who.names[pair.rep_id] ?? ""}</option>
                <option value={pair.manager_id}>{who.names[pair.manager_id] ?? ""}</option>
              </select>
              <input className="crm-input crm-input-sm crm-mono mr-fld" type="date" aria-label={t("notes.form.due", { n: at + 1 })} value={action.due} onChange={(event) => change(at, { due: event.target.value })} />
              <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("notes.form.remove", { n: at + 1 })} onClick={() => setActions((was) => was.filter((_, i) => i !== at))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" onClick={() => setActions((was) => [...was, blank()])}>
            <Icon name="plus" size={12} />
            {t("notes.form.add")}
          </button>
        </div>
      </fieldset>
      {checking && (
        <p className="crm-field-note" role="status">
          {t("ui.checking")}
        </p>
      )}
      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
      <div className="crm-no-form-foot">
        <button type="button" className="crm-btn crm-btn-primary crm-btn-38 mr-btn" data-go disabled={!ready || busy} onClick={() => void save()}>
          <Icon name="check" size={14} />
          {busy ? t("ui.saving") : t("notes.form.save")}
        </button>
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" disabled={busy} onClick={onClose}>
          {t("notes.form.cancel")}
        </button>
      </div>
    </div>
  );
}
