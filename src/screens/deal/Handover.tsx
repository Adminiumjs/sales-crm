/**
 * HAND A DEAL OVER (`hand-over`, `hand-over/<deal>`): the deal goes to a
 * colleague, with what they need to know beside it.
 *
 * The move is the deal's own button on the server (`hand-over`), pressed from
 * "open": the one write in which somebody held to their own deals may name a
 * colleague. A rep hands over her own; whoever leads the team, anybody's.
 * The words typed for the next person are logged on the deal as a note first,
 * so they are there when it changes hands. The change of owner itself is in
 * the deal's history, and so in its room.
 *
 * WHAT GOES WITH IT is the server's, in the hand-over's own write (Adminium
 * 0.3.35, `handOver.carries`): the visits of the old owner's on the deal that
 * are not yet made, and her open follow-ups on it. A visit already made keeps
 * her name; a colleague's own visits and follow-ups (a helper's, a manager's)
 * stay theirs. The page says, before anything is pressed, how many go,
 * counting only the rows the reader reads.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { formatters, noonOf } from "../../lib/format.ts";
import { scopeOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey, type Condition, type StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { ruleStates } from "../../lib/rules.ts";
import { readNames } from "../quotes/data.ts";
import { num, readFixed, sittingOf, type Activity, type Fixed } from "./data.ts";

interface Offered extends Record<string, unknown> {
  id: number;
  name: string;
  owner_id: string | null;
  stage_id: number;
  amount: number | string;
  weighted_value: number | string;
  stage_odds: number | string;
  expected_close: string | null;
  entered_stage_at: string | null;
  company: string | null;
  stage: string | null;
  contact: string | null;
  /** The deal contact's address, where the introduction would go (S1). */
  contact_email?: string | null;
}
interface Step extends Record<string, unknown> {
  id: number;
  owner_id: string;
  due_at: string;
  text: string;
}
interface Pool {
  deals: Offered[];
  fixed: Fixed;
  names: Record<string, string>;
}
interface Brief {
  last: Activity[];
  steps: Step[];
  /** How many follow-ups are open on the deal: the server's count. */
  open: number;
  /** What the hand-over carries, of the rows the reader reads: null where she reads none of that table. */
  carries: { visits: number | null; steps: number | null };
}
interface Done {
  id: number;
  deal: string;
  to: string;
  from: string;
  /** Whether the reader still reaches the deal. */
  stillOpens: boolean;
  noted: boolean;
  /** What went with it: the visits not yet made and the open follow-ups, as counted before. */
  visits: number;
  moved: number;
  /** Who the introduction e-mail goes to, when it was asked for. */
  introduced: string | null;
}

async function readPool(session: StaffSession, mine: boolean): Promise<Pool> {
  const me = session.config.user?.id ?? null;
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const [deals, fixed] = await Promise.all([
    session.list<Offered>("deals", {
      select: ["id", "name", "owner_id", "stage_id", "amount", "weighted_value", "stage_odds", "expected_close", "entered_stage_at"],
      where: mine && me !== null ? { and: [open, { column: "owner_id", op: "eq", value: me }] } : open,
      lookup: ["company:company_id.name", "stage:stage_id.label", "contact:contact_id.name", "contact_email:contact_id.email"],
      order: ["name"],
      limit: 200,
    }),
    readFixed(session),
  ]);
  const names = await readNames(session, [...deals.rows.map((deal) => deal.owner_id), ...fixed.reps]);
  return { deals: deals.rows, fixed, names };
}

async function readBrief(session: StaffSession, dealId: number, owner: string | null): Promise<Brief> {
  const of = { column: "deal_id", op: "eq" as const, value: dealId };
  const theirs = (column: string): Condition => ({ column, op: owner === null ? "is_null" : "eq", ...(owner === null ? {} : { value: owner }) }) as Condition;
  const counted = async (ref: string, where: Condition): Promise<number | null> => (session.can(ref, "read") ? ((await session.list(ref, { select: ["id"], where, limit: 1, count: "exact" })).total ?? 0) : null);
  const [last, steps, visits, carried] = await Promise.all([
    session.can("activities", "read") ? session.list<Activity>("activities", { select: ["id", "kind", "text", "author_id", "at"], where: of, order: ["at.desc", "id.desc"], limit: 3 }).then((page) => page.rows) : Promise.resolve([] as Activity[]),
    session.can("follow_ups", "read") ? session.list<Step>("follow_ups", { select: ["id", "owner_id", "due_at", "text"], where: { and: [of, { column: "done", op: "eq", value: false }] }, order: ["due_at"], limit: 50, count: "exact" }) : Promise.resolve({ rows: [] as Step[], total: 0 }),
    // What the server carries: the owner's booked visits on the deal, and her open follow-ups on it.
    counted("site_visits", { and: [of, { column: "state", op: "eq", value: "booked" }, theirs("rep_id")] }),
    counted("follow_ups", { and: [of, { column: "done", op: "eq", value: false }, theirs("owner_id")] }),
  ]);
  return { last, steps: steps.rows, open: steps.total ?? 0, carries: { visits, steps: carried } };
}

export function Handover({ rest }: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const nav = useNav();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const now = useMemo(() => session.now(), [session]);
  const me = config.user?.id ?? null;
  const team = useMemo(() => scopeOf(session) === "team", [session]);
  const asked = rest[0] === undefined ? null : Number(rest[0]);
  const pool = useLoad(() => readPool(session, !team), [session, team]);
  useLive(["deals"], pool.reload);
  const [picked, setPicked] = useState<number | null>(asked);
  useEffect(() => setPicked(asked), [asked]);
  const deals = pool.load.state === "ready" ? pool.load.data.deals : null;
  const dealId = deals === null ? null : (deals.find((deal) => deal.id === picked)?.id ?? deals[0]?.id ?? null);
  const ownerOf = deals === null ? null : (deals.find((deal) => deal.id === dealId)?.owner_id ?? null);
  const brief = useLoad<Brief | null>(() => (dealId === null ? Promise.resolve(null) : readBrief(session, dealId, ownerOf)), [session, dealId, ownerOf]);
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // "Introduce … to the customer by e-mail" (S1): on when the deal's contact has an address, and the reader's to undo.
  const [introduce, setIntroduce] = useState(true);
  // "Tell the new owner" is the `deal-handed-over` rule: what is said is its real state (plan-67 T10i).
  const told = useLoad(() => ruleStates(session).then((states) => (states === null || states["deal-handed-over"] === undefined ? "unknown" : states["deal-handed-over"] ? "on" : "off")), [session]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const noteKey = useRef<{ of: string; key: string }>({ of: "", key: "" });
  useEffect(() => {
    setTo(null);
    setIntroduce(true);
  }, [dealId]);
  const canHand = session.can("deals", "update");

  return (
    <div className="crm-screen crm-hand mr-screen" data-screen="handover">
      <h1>{t("hand.title")}</h1>
      <p className="crm-screen-sub">{t("hand.sub")}</p>
      {done !== null ? (
        <section className="crm-hand-done" role="status" data-testid="hand-done">
          <div className="crm-hand-done-head">
            <span className="crm-hand-done-icon">
              <Icon name="check" size={18} />
            </span>
            <div>
              <div className="crm-hand-done-title">{t("hand.done.title", { deal: done.deal, name: done.to })}</div>
              <div className="crm-room-quiet">{t("hand.done.sub", { day: f.dayShort(now), time: f.time(session.now()), name: config.user?.name ?? "" })}</div>
            </div>
            <button
              type="button"
              className="crm-btn crm-btn-ghost crm-btn-38 mr-gi"
              onClick={() => {
                setDone(null);
                setNote("");
                setTo(null);
                nav.replace("handover");
              }}
            >
              {t("hand.done.another")}
            </button>
          </div>
          <ul className="crm-hand-moved">
            <li>
              <Icon name="user-round" size={14} />
              {t("hand.done.owns", { name: done.to })}
            </li>
            {done.noted && (
              <li>
                <Icon name="sticky-note" size={14} />
                {t("hand.done.noted")}
              </li>
            )}
            {done.visits > 0 && (
              <li data-testid="hand-carried-visits">
                <Icon name="map-pin" size={14} />
                {t("dealrules.carried.visits", { name: firstName(done.to) }, done.visits)}
              </li>
            )}
            {done.moved > 0 && (
              <li data-testid="hand-carried-steps">
                <Icon name="calendar-clock" size={14} />
                {t("hand.done.steps.moved", { name: firstName(done.to) }, done.moved)}
              </li>
            )}
            {done.introduced !== null && (
              <li data-testid="hand-introduced">
                <Icon name="mail" size={14} />
                {t("hand.done.introduced", { contact: done.introduced, name: firstName(done.to) })}
              </li>
            )}
            <li>
              <Icon name="history" size={14} />
              {t("hand.done.history")}
            </li>
          </ul>
          {done.stillOpens ? (
            <ScreenLink to="deal" rest={[done.id]} className="crm-btn crm-btn-ghost crm-btn-38 mr-gi">
              <Icon name="panel-right-open" size={15} />
              {t("hand.done.open")}
            </ScreenLink>
          ) : (
            <p className="crm-room-quiet">{t("hand.done.gone", { name: firstName(done.to) })}</p>
          )}
        </section>
      ) : (
        <Loaded load={pool.load} reload={pool.reload} skeleton={<Skeleton rows={4} height={64} />}>
          {(data) => {
            const deal = data.deals.find((one) => one.id === dealId) ?? null;
            if (deal === null) {
              return (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="arrow-right-left" size={21} />
                  </span>
                  <div className="crm-empty-title">{t("hand.empty")}</div>
                  <p>{t("hand.empty.body")}</p>
                </div>
              );
            }
            const nameOf = (userId: string | null): string => (userId === null ? "" : (data.names[userId] ?? t("closed.someone")));
            const takers = data.fixed.reps.filter((userId) => userId !== deal.owner_id);
            const from = nameOf(deal.owner_id);
            const steps = brief.load.state === "ready" && brief.load.data !== null ? brief.load.data.steps : [];
            const last = brief.load.state === "ready" && brief.load.data !== null ? brief.load.data.last : [];
            const openSteps = brief.load.state === "ready" && brief.load.data !== null ? brief.load.data.open : 0;
            const carries = brief.load.state === "ready" && brief.load.data !== null ? brief.load.data.carries : null;
            const isMine = deal.owner_id !== null && deal.owner_id === me;
            const carryLine = (): string | null => {
              if (carries === null) return null;
              const toName = to === null ? t("dealrules.carry.someone") : firstName(nameOf(to));
              const fromName = firstName(from);
              if (carries.visits === null || carries.steps === null) return t("dealrules.carry.unknown", { to: toName, name: fromName });
              const visits = carries.visits;
              const moving = carries.steps;
              if (visits === 0 && moving === 0) return isMine ? t("dealrules.carry.none.mine") : t("dealrules.carry.none.theirs", { name: fromName });
              if (moving === 0) return t("dealrules.carry.visitsOnly", { to: toName }, visits);
              if (visits === 0) return isMine ? t("dealrules.carry.stepsOnly.mine", { to: toName }, moving) : t("dealrules.carry.stepsOnly.theirs", { to: toName, name: fromName }, moving);
              const stepsWords = isMine ? t("dealrules.carry.steps.mine", undefined, moving) : t("dealrules.carry.steps.theirs", { name: fromName }, moving);
              return t("dealrules.carry.both", { visits: t("dealrules.carry.visits", undefined, visits), steps: stepsWords, to: toName });
            };
            const days = deal.entered_stage_at === null ? 0 : Math.max(0, f.dayDiff(new Date(deal.entered_stage_at), now));
            const sitting = sittingOf(days, data.fixed);
            const reachable = typeof deal.contact_email === "string" && deal.contact_email !== "";
            const newName = to === null ? null : firstName(nameOf(to));

            const confirm = async (): Promise<void> => {
              if (to === null || me === null) return;
              setBusy(true);
              const words = note.trim();
              let noted = false;
              if (words !== "" && session.can("activities", "create")) {
                if (noteKey.current.of !== `${String(deal.id)}:${words}`) noteKey.current = { of: `${String(deal.id)}:${words}`, key: newClientKey() };
                const logged = await session.create("activities", { deal_id: deal.id, kind: "note", text: words }, noteKey.current.key);
                if (logged.state !== "saved") {
                  // The note is what the next person reads first: with it unsaved, nothing is handed over.
                  await toasts.say(Promise.resolve(logged), () => "");
                  setBusy(false);
                  return;
                }
                noted = true;
              }
              const introducing = introduce && reachable;
              const handed = await toasts.say(session.act("deals", deal.id, "hand-over", "open", { values: { owner_id: to, introduce: introducing } }), () => t("hand.toast", { deal: deal.name, name: firstName(nameOf(to)) }));
              if (handed === null) {
                setBusy(false);
                pool.reload();
                return;
              }
              // The server moved them in the same write: what was counted before, of the rows the reader reads.
              setDone({ id: deal.id, deal: deal.name, to: nameOf(to), from, stillOpens: team, noted, visits: carries?.visits ?? 0, moved: carries?.steps ?? 0, introduced: introducing ? deal.contact : null });
              setBusy(false);
              pool.reload();
            };

            return (
              <div className="crm-hand-grid">
                <div className="crm-hand-form">
                  <section className="crm-side-card">
                    <h2 id="crm-hand-which">{t("hand.which")}</h2>
                    <div className="crm-hand-deals mr-scroll" role="radiogroup" aria-labelledby="crm-hand-which">
                      {data.deals.map((one) => (
                        <button key={one.id} type="button" role="radio" aria-checked={one.id === deal.id} className="crm-hand-deal mr-row" disabled={busy} onClick={() => setPicked(one.id)}>
                          <span className="crm-why-dot" />
                          <span className="crm-hand-deal-words">
                            <span className="crm-hand-deal-name">{one.name}</span>
                            <span className="crm-room-person-sub">{[one.company, one.stage, team ? firstName(nameOf(one.owner_id)) : null].filter((part) => part !== null && part !== "").join(" · ")}</span>
                          </span>
                          <span className="crm-mono crm-hand-deal-amount">{f.money(one.amount)}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="crm-side-card">
                    <h2 id="crm-hand-who">{t("hand.who")}</h2>
                    <div className="crm-chips" role="radiogroup" aria-labelledby="crm-hand-who">
                      {takers.map((userId) => (
                        <button key={userId} type="button" role="radio" aria-checked={to === userId} className="crm-chip-btn crm-hand-taker mr-chip" data-on={to === userId ? "1" : "0"} disabled={busy || !canHand} onClick={() => setTo(userId)}>
                          <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                            {initials(nameOf(userId))}
                          </span>
                          {firstName(nameOf(userId))}
                        </button>
                      ))}
                    </div>
                    {takers.length === 0 && <p className="crm-room-quiet">{t("hand.who.none")}</p>}
                    <p className="crm-room-note" data-testid="hand-who-note">
                      {to === null ? t("hand.who.now", { name: from }) : t("hand.who.picked", { to: nameOf(to), from })}
                    </p>
                  </section>

                  <section className="crm-side-card">
                    <h2>
                      <label htmlFor="crm-hand-note">{t("hand.note")}</label>
                    </h2>
                    <textarea id="crm-hand-note" className="crm-input crm-textarea mr-fld" value={note} maxLength={4000} disabled={busy} placeholder={t("hand.note.hint")} onChange={(event) => setNote(event.target.value)} />
                    <p className="crm-room-quiet">{t("hand.note.where")}</p>
                    {carries !== null && (
                      <div className="crm-room-note" data-testid="hand-carries">
                        <p>{carryLine()}</p>
                        <p className="crm-room-quiet">{isMine ? t("dealrules.carry.stay.mine") : t("dealrules.carry.stay.theirs", { name: firstName(from) })}</p>
                      </div>
                    )}
                    <div className="crm-hand-tell" data-testid="hand-tell">
                      <Icon name={told.load.state === "ready" && told.load.data === "on" ? "bell-ring" : "bell"} size={14} />
                      <span>
                        {told.load.state !== "ready" || told.load.data === "unknown"
                          ? t("hand.tell.unknown")
                          : told.load.data === "on"
                            ? t(newName === null ? "hand.tell.on.anyone" : "hand.tell.on", { name: newName ?? "" })
                            : t("hand.tell.off")}
                      </span>
                    </div>
                    <button type="button" role="switch" aria-checked={introduce && reachable} className="crm-switch mr-gi" disabled={busy || !reachable} aria-describedby="crm-hand-intro-note" onClick={() => setIntroduce((was) => !was)} data-testid="hand-introduce">
                      <span className="crm-switch-track">
                        <span className="crm-switch-knob" />
                      </span>
                      {newName === null ? t("hand.intro.anyone") : t("hand.intro", { name: newName })}
                    </button>
                    <p className="crm-room-quiet" id="crm-hand-intro-note">
                      {!reachable ? (deal.contact === null ? t("hand.intro.noContact") : t("hand.intro.noAddress", { contact: deal.contact })) : t("hand.intro.to", { contact: deal.contact ?? "" })}
                    </p>
                    <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" disabled={busy || to === null || !canHand} onClick={() => void confirm()}>
                      <Icon name="arrow-right-left" />
                      {busy ? t("ui.saving") : to === null ? t("hand.confirm.pick") : t("hand.confirm", { name: firstName(nameOf(to)) })}
                    </button>
                  </section>
                </div>

                <section className="crm-side-card crm-hand-brief" aria-label={t("hand.brief")} data-testid="hand-brief">
                  <div className="crm-room-quote-head">
                    <h2>{t("hand.brief")}</h2>
                    <span className="crm-room-quiet">{t("hand.brief.from")}</span>
                  </div>
                  <div className="crm-hand-brief-name">{deal.name}</div>
                  <div className="crm-room-who">
                    {deal.company !== null && (
                      <span className="crm-chip">
                        <span className="crm-dot" data-tone="accent" />
                        {deal.company}
                      </span>
                    )}
                    <span className="crm-pill" data-tone="accent">
                      {deal.stage} · {f.percent(num(deal.stage_odds))}
                    </span>
                  </div>
                  <dl className="crm-facts-list crm-room-facts">
                    <div>
                      <dt>{t("room.amount")}</dt>
                      <dd className="crm-mono">{f.money(deal.amount)}</dd>
                    </div>
                    <div>
                      <dt>{t("room.fact.weighted")}</dt>
                      <dd className="crm-mono" data-tone="accent">
                        {f.money(deal.weighted_value)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("room.fact.sitting")}</dt>
                      <dd className="crm-mono" data-tone={sitting === "stale" ? "danger" : sitting === "warm" ? "warn" : "plain"}>
                        {t(sitting === "stale" ? "room.fact.sitting.stale" : sitting === "warm" ? "room.fact.sitting.warm" : "room.fact.sitting.days", undefined, days)}
                      </dd>
                    </div>
                    {deal.expected_close !== null && (
                      <div>
                        <dt>{t("room.fact.close")}</dt>
                        <dd className="crm-mono">{f.date(noonOf(deal.expected_close.slice(0, 10)))}</dd>
                      </div>
                    )}
                    {deal.contact !== null && (
                      <div>
                        <dt>{t("hand.brief.contact")}</dt>
                        <dd>{deal.contact}</dd>
                      </div>
                    )}
                    <div>
                      <dt>{t("hand.brief.now")}</dt>
                      <dd>{from}</dd>
                    </div>
                  </dl>
                  {last.length > 0 && (
                    <>
                      <h3 className="crm-room-sub">{t("hand.brief.last")}</h3>
                      <ul className="crm-hand-last">
                        {last.map((activity) => (
                          <li key={activity.id}>
                            <div className="crm-room-line-head">
                              <span className="crm-room-line-label">{t(`room.kind.${activity.kind}` as MessageKey)}</span>
                              <span className="crm-room-line-when crm-mono">
                                {f.dayShort(new Date(activity.at))}, {f.time(new Date(activity.at))}
                              </span>
                            </div>
                            <p>{activity.text}</p>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {steps.length > 0 && (
                    <>
                      <h3 className="crm-room-sub" data-testid="hand-steps-title">
                        {t("hand.brief.steps", undefined, openSteps)}
                      </h3>
                      <ul className="crm-hand-steps">
                        {steps.map((step) => (
                          <li key={step.id} data-late={new Date(step.due_at).getTime() < now.getTime() ? "1" : "0"}>
                            <span>{step.text}</span>
                            <span className="crm-mono">
                              {f.dayShort(new Date(step.due_at))}, {f.time(new Date(step.due_at))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              </div>
            );
          }}
        </Loaded>
      )}
    </div>
  );
}
