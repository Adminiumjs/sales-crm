/**
 * THE WEEKLY MEETING (ledger screen 37): when it is, the five numbers, the
 * running order with the deals each rep brings, what is decided and who does
 * it, and what was said last week.
 *
 * "Decisions and actions" are rows of the one action list (`common.tsx`): a
 * tick here shows in One-to-one notes and in Coaching, where the same row
 * lives. Anybody who may add to the list writes a line down; it is theirs
 * until somebody is given it.
 *
 * Every figure is the server's, cut to the reader's rows: the manager reads
 * the team's five numbers, a rep her own (and the heading says which).
 */
import { useCallback, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { scopeOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { inMenu } from "../../shell/routes.ts";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { ActionRow, Avatar, Empty, Head, NOBODY, readWho, tickAction, useF, type Action } from "./common.tsx";
import { readMeeting } from "./meeting.ts";

const PILL = { done: "pos", carried: "warn", open: undefined } as const;

export function Meeting(_: ScreenProps) {
  const t = useT();
  const f = useF();
  const session = useSession();
  const toasts = useToasts();
  const team = scopeOf(session) === "team";
  const me = session.config.user?.id ?? "";
  const [now, setNow] = useState(() => session.now());
  const { load: whoLoad } = useLoad(() => readWho(session), [session]);
  const who = whoLoad.state === "ready" ? whoLoad.data : NOBODY;
  const { load, reload } = useLoad(() => readMeeting(session, now, f), [session, f.dayKey(now), f]);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["actions", "meetings", "meeting_slots", "meeting_decisions"], again);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticking, setTicking] = useState<number | null>(null);
  const key = useRef(newClientKey());
  const canAdd = session.can("actions", "create");
  const canTick = session.can("actions", "update");

  const tick = async (action: Action, done: boolean): Promise<void> => {
    setTicking(action.id);
    const saved = await tickAction(session, action, done);
    setTicking(null);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t(done ? "team.action.done" : "team.action.undone"), "pos");
    again();
  };
  const add = async (meeting: number): Promise<void> => {
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    const saved = await session.create("actions", { text, owner_id: me, source: "meeting", meeting_id: meeting }, key.current);
    setBusy(false);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    key.current = newClientKey();
    setDraft("");
    toasts.show(t("meeting.toast.added"), "pos");
    again();
  };

  return (
    <div className="crm-screen crm-meeting mr-screen" data-screen="meeting">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={110} />}>
        {(data) => {
          if (data === null)
            return (
              <>
                <Head title={t("meeting.h1")} />
                <Empty icon="calendar-clock" title={t("meeting.none")} body={t("meeting.none.body")} />
              </>
            );
          const at = new Date(data.meeting.at);
          const inDays = f.dayDiff(now, at);
          // How long it runs is the meeting's own figure; a slot's start is the one before it plus its minutes.
          const total = Number(data.meeting.minutes);
          const ends = new Date(at.getTime() + total * 60_000);
          const people = [...new Set(data.slots.map((slot) => slot.who_id).filter((id): id is string => id !== null && id !== ""))];
          const n = data.numbers;
          let clock = at.getTime();
          return (
            <>
              <Head title={t("meeting.h1")}>
                <div className="crm-mt-people" aria-label={t("meeting.people")} role="group">
                  {people.map((id) => (
                    <span key={id} title={who.names[id] ?? ""}>
                      <Avatar name={who.names[id] ?? ""} />
                    </span>
                  ))}
                </div>
              </Head>
              <div className="crm-mt-when" data-testid="mt-when">
                <span className="crm-mt-day">
                  <Icon name="calendar-clock" size={15} />
                  <strong>{f.dayLong(at)}</strong>
                  <span className="crm-mono">{f.time(at)}</span>
                </span>
                <span className="crm-tw-quiet">
                  {t("meeting.minutes", { count: f.number(total), ends: f.time(ends) }, total)} · {inDays < 0 ? t("meeting.rel.past") : inDays === 0 ? t("meeting.rel.today") : inDays === 1 ? t("meeting.rel.tomorrow") : t("meeting.rel.in", { count: f.number(inDays) }, inDays)}
                </span>
              </div>

              {session.can("deals", "read") && (
                <>
                  <div className="crm-tw-kicker crm-mt-numbers-head">{t(team ? "meeting.numbers.team" : "meeting.numbers.mine")}</div>
                  <div className="crm-stats crm-mt-numbers">
                    <Number_ label={t("meeting.n.weighted")} value={f.money(n.weighted)} sub={t("meeting.n.deals", { count: f.number(n.deals) }, n.deals)} tone="accent" testid="mt-weighted" />
                    <Number_ label={f.monthLong(at)} value={f.money(n.monthWeighted)} sub={t("meeting.n.expected", { count: f.number(n.monthDeals) }, n.monthDeals)} testid="mt-month" />
                    <Number_ label={t("meeting.n.rate")} value={n.rate === null ? "—" : f.percent(n.rate)} sub={t("meeting.n.rate.sub", { won: f.number(n.won), closed: f.number(n.closed) })} testid="mt-rate" />
                    <Number_ label={t("meeting.n.cycle")} value={n.cycle === null ? "—" : t("meeting.n.days", { count: f.number(Math.round(n.cycle)) }, Math.round(n.cycle))} sub={t("meeting.n.cycle.sub")} testid="mt-cycle" />
                    {n.stale !== null && <Number_ label={t("meeting.n.stale")} value={f.number(n.stale)} sub={t("meeting.n.stale.sub")} tone={n.stale > 0 ? "warn" : undefined} testid="mt-stale" />}
                  </div>
                </>
              )}

              <div className="crm-tw-grid">
                <section className="crm-tw-card" aria-labelledby="crm-mt-order">
                  <div className="crm-tw-card-head">
                    <h2 id="crm-mt-order">{t("meeting.order")}</h2>
                    <span className="crm-mono">{t("meeting.order.count", { count: f.number(data.slots.length) }, data.slots.length)}</span>
                  </div>
                  <ol className="crm-mt-order" data-testid="mt-order">
                    {data.slots.map((slot) => {
                      const from = new Date(clock);
                      clock += Number(slot.minutes) * 60_000;
                      const whoId = slot.who_id ?? "";
                      const isRep = who.reps.includes(whoId) && firstName(who.names[whoId] ?? "") === slot.label;
                      const brings = isRep ? (data.brings[whoId] ?? []) : [];
                      return (
                        <li key={slot.id} className="crm-mt-slot" data-slot={slot.position}>
                          <span className="crm-mt-slot-at">
                            <strong className="crm-mono">{f.time(from)}</strong>
                            <span>{t("visits.minutes", { count: f.number(Number(slot.minutes)) })}</span>
                          </span>
                          <span className="crm-mt-slot-main">
                            <strong>{slot.label}</strong>
                            {isRep && data.inPlay[whoId] !== undefined && <span>{t("meeting.slot.deals", { count: f.number(data.inPlay[whoId] ?? 0) }, data.inPlay[whoId] ?? 0)}</span>}
                            {brings.length > 0 && (
                              <span className="crm-mt-brings">
                                {brings.map((deal) => (
                                  <span key={deal.id} className="crm-chip">
                                    <span>{deal.name}</span>
                                    <span className="crm-mono">{f.money(deal.amount)}</span>
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                          {whoId !== "" && <Avatar name={who.names[whoId] ?? ""} />}
                        </li>
                      );
                    })}
                  </ol>
                  {data.slots.length === 0 && <p className="crm-cv-none">{t("meeting.order.none")}</p>}
                </section>

                <div className="crm-tw-col">
                  <section className="crm-tw-card" aria-labelledby="crm-mt-actions" data-testid="mt-actions">
                    <div className="crm-tw-card-head">
                      <h2 id="crm-mt-actions">{t("meeting.actions")}</h2>
                    </div>
                    {!session.can("actions", "read") ? (
                      <p className="crm-cv-none">{t("meeting.actions.notYours")}</p>
                    ) : (
                      <>
                        <ul className="crm-tw-actions">
                          {data.actions.map((action) => (
                            <ActionRow key={action.id} action={action} here="meeting" names={who.names} f={f} onTick={canTick ? (one, on) => void tick(one, on) : null} busy={ticking === action.id} />
                          ))}
                        </ul>
                        {data.actions.length === 0 && <p className="crm-cv-none">{t("meeting.actions.none")}</p>}
                        {canAdd && (
                          <div className="crm-tw-add">
                            <input
                              className="crm-input mr-fld"
                              aria-label={t("meeting.add.label")}
                              value={draft}
                              maxLength={400}
                              disabled={busy}
                              placeholder={t("meeting.add.hint")}
                              onChange={(event) => setDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void add(data.meeting.id);
                              }}
                            />
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" disabled={draft.trim() === "" || busy} onClick={() => void add(data.meeting.id)}>
                              <Icon name="plus" size={14} />
                              {t("meeting.add")}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </section>

                  <section className="crm-tw-card" aria-labelledby="crm-mt-last" data-testid="mt-last">
                    <div className="crm-tw-card-head">
                      <h2 id="crm-mt-last">{t("meeting.last")}</h2>
                    </div>
                    <ul className="crm-mt-last">
                      {data.decisions.map((decision) => (
                        <li key={decision.id}>
                          <p>{decision.text}</p>
                          <div>
                            {decision.who_id !== null && decision.who_id !== "" && (
                              <>
                                <Avatar name={who.names[decision.who_id] ?? ""} size="sm" />
                                <span>{firstName(who.names[decision.who_id] ?? "")}</span>
                              </>
                            )}
                            <span className="crm-pill" data-tone={PILL[decision.state]}>
                              {t(`meeting.decision.${decision.state}`)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {data.decisions.length === 0 && <p className="crm-cv-none">{t("meeting.last.none")}</p>}
                  </section>

                  {isBuilt("notes") && session.can("one_to_ones", "read") && inMenu("notes", (session.config.access?.roles ?? []).map((role) => role.slug)) && (
                    <ScreenLink to="notes" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi crm-mt-link">
                      <Icon name="notebook-pen" size={14} />
                      {t("meeting.goNotes")}
                    </ScreenLink>
                  )}
                </div>
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Number_({ label, value, sub, tone, testid }: { label: string; value: string; sub: string; tone?: "accent" | "warn" | undefined; testid: string }) {
  return (
    <div className="crm-stat" data-testid={testid}>
      <div className="crm-stat-label">{label}</div>
      <div className="crm-stat-value crm-mono" data-tone={tone}>
        {value}
      </div>
      <div className="crm-stat-sub">{sub}</div>
    </div>
  );
}
