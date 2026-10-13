/**
 * THIS WEEK: the follow-ups due up to Sunday, a lane a day, with what was left
 * behind from before Monday in a lane of its own.
 *
 * A rep sees her own; her manager sees the team's (the server decides the
 * rows) and can narrow the lanes to one person.
 *
 * A card moves to another day by being dragged there, or with its Move button
 * (the keyboard's and a phone's way: the design draws only the drag). It keeps
 * its hour. A tick clears it.
 *
 * WHO ADDS UP. "Riding on them" and each lane's figure count a deal once
 * however many follow-ups it has, so they are asked of the server as sums
 * over those deals, as the reader reaches them. Nothing is added up here.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { addDays, formatters, noonOf, weekOf } from "../../lib/format.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { homeFor, menuFor, type MenuFacts, type PartId } from "../../shell/routes.ts";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";

interface Step extends Record<string, unknown> {
  id: number;
  deal_id: number | null;
  owner_id: string | null;
  due_at: string;
  text: string | null;
  deal: string | null;
  amount: number | string | null;
}

interface WeekData {
  steps: Step[];
  /** Who the follow-ups are whose, by id: names for the manager's chips and the cards' corners. */
  names: Record<string, string>;
}

async function read(session: StaffSession, nextMonday: string): Promise<WeekData> {
  const steps = await session.list<Step>("follow_ups", {
    where: { and: [{ column: "kind", op: "eq", value: "step" }, { column: "done", op: "eq", value: false }, { column: "due_at", op: "lt", value: `${nextMonday}T00:00:00` }] },
    order: ["due_at"],
    lookup: ["deal:deal_id.name", "amount:deal_id.amount"],
    limit: 200,
  });
  const owners = [...new Set(steps.rows.map((step) => step.owner_id).filter((id): id is string => id !== null))];
  const me = session.config.user;
  const names: Record<string, string> = me === null ? {} : { [me.id]: me.name };
  // Somebody else's follow-ups are on the page (a manager's view): their names, from the people this person may name.
  if (owners.some((id) => names[id] === undefined)) {
    for (const person of await session.people(undefined, 200).catch(() => [])) names[person.id] = person.name;
  }
  return { steps: steps.rows, names };
}

/** The sum of some deals' amounts, each once, as the reader reaches them. Asked of the server. */
async function sumOf(session: StaffSession, deals: number[]): Promise<number> {
  if (deals.length === 0) return 0;
  const figure = await session.figure<{ value: number | null }>({ table: "deals", shape: "single-metric", filters: [{ column: "id", op: "in", value: deals }], aggregations: [{ fn: "sum", column: "amount", alias: "full" }] });
  return typeof figure.value === "number" ? figure.value : 0;
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");

interface Lane {
  key: string;
  /** The day's key; null for what was left from before Monday. */
  day: string | null;
  items: Step[];
}

export function Week(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const [monday, nextMonday] = weekOf(today);
  const { load, reload } = useLoad(() => read(session, nextMonday), [session, nextMonday]);
  const again = useCallback(() => {
    setNow(session.now());
    reload();
  }, [session, reload]);
  useLive(["follow_ups", "deals"], again);

  const [who, setWho] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  const steps = load.state === "ready" ? load.data.steps : [];
  const shown = useMemo(() => (who === null ? steps : steps.filter((step) => step.owner_id === who)), [steps, who]);
  const lanes = useMemo<Lane[]>(() => {
    const out: Lane[] = [{ key: "before", day: null, items: [] }, ...Array.from({ length: 7 }, (_, i) => ({ key: addDays(monday, i), day: addDays(monday, i), items: [] as Step[] }))];
    for (const step of shown) {
      const day = f.dayKey(new Date(step.due_at));
      (day < monday ? out[0]! : (out.find((lane) => lane.day === day) ?? out[0]!)).items.push(step);
    }
    return out;
  }, [shown, monday, f]);

  // Each lane's figure and the page's, counting a deal once: asked of the server whenever the cards change lanes.
  const dealsOf = (items: Step[]): number[] => [...new Set(items.map((step) => step.deal_id).filter((id): id is number => id !== null))].sort((a, b) => a - b);
  const asked = lanes.map((lane) => dealsOf(lane.items).join(",")).join("|");
  const sums = useLoad(async () => {
    const perLane = await Promise.all(lanes.map((lane) => sumOf(session, dealsOf(lane.items))));
    return { lanes: perLane, all: await sumOf(session, dealsOf(shown)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `asked` is the lanes' deals, spelled out
  }, [session, asked]);

  useEffect(() => {
    if (moving === null) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (focus: boolean): void => {
      const opener = menu.current?.parentElement?.querySelector<HTMLButtonElement>(".crm-card-move");
      setMoving(null);
      if (focus) opener?.focus();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close(true);
    };
    const onDown = (event: MouseEvent): void => {
      if (menu.current !== null && !menu.current.parentElement!.contains(event.target as Node)) close(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [moving]);

  const canWrite = session.can("follow_ups", "update");
  const moveTo = async (step: Step, day: string): Promise<void> => {
    setMoving(null);
    setDrag(null);
    setOver(null);
    const was = new Date(step.due_at);
    const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${f.dayKey(was)}T00:00:00Z`)) / 86_400_000);
    if (days === 0) return;
    // The same hour on the day it is moved to.
    const due = new Date(was.getTime() + days * 86_400_000);
    setBusy(step.id);
    await toasts.say(session.update("follow_ups", step.id, { due_at: due.toISOString() }, { seen: { done: false, due_at: step.due_at } }), () => t("week.toast.moved", { when: `${f.dayShort(due)}, ${f.time(due)}` }));
    setBusy(null);
    again();
  };
  const done = async (step: Step): Promise<void> => {
    setBusy(step.id);
    await toasts.say(session.update("follow_ups", step.id, { done: true }, { seen: { done: false, due_at: step.due_at } }), () => t("today.toast.done", { deal: step.deal ?? "" }));
    setBusy(null);
    again();
  };

  const facts = useMemo<MenuFacts>(
    () => ({ roles: (config.access?.roles ?? []).map((role) => role.slug), part: (id: PartId) => session.part(id), reads: (table) => session.can(table, "read"), built: isBuilt }),
    [config, session],
  );
  const home = homeFor(facts);
  const homeItem = home === null ? null : (menuFor(facts).flatMap((group) => group.items).find((item) => item.route === home) ?? null);
  const owners = [...new Set(steps.map((step) => step.owner_id).filter((id): id is string => id !== null))];
  const names = load.state === "ready" ? load.data.names : {};
  const team = owners.length > 1 || owners.some((id) => id !== config.user?.id);

  return (
    <div className="crm-week mr-screen" data-screen="week">
      <div className="crm-screen crm-week-head">
        <div className="crm-screen-head">
          <div>
            <h1>{t("week.title")}</h1>
            <div className="crm-facts">
              <span className="crm-fact">
                <Icon name="calendar-range" size={15} />
                <span className="crm-mono crm-fact-value">
                  {f.dayShort(noonOf(monday))} — {f.dayShort(noonOf(addDays(monday, 6)))}
                </span>
              </span>
              <span className="crm-fact-rule" />
              <span className="crm-fact">
                {t("week.count")}
                <span className="crm-mono crm-fact-value" data-testid="week-count">
                  {f.number(shown.length)}
                </span>
              </span>
              <span className="crm-fact-rule" />
              <span className="crm-fact">
                {t("week.value")}
                <span className="crm-mono crm-fact-value" data-testid="week-value">
                  {sums.load.state === "ready" ? f.money(sums.load.data.all) : "…"}
                </span>
              </span>
            </div>
          </div>
          {home !== null && home !== "week" && homeItem !== null && (
            <ScreenLink to={home} className="crm-btn crm-btn-ghost crm-btn-38 mr-gi">
              <Icon name="sun" size={15} />
              {t("week.back", { page: t(`nav.item.${homeItem.label}` as MessageKey) })}
            </ScreenLink>
          )}
        </div>
        {canWrite && <div className="crm-week-hint">{t("week.hint")}</div>}
        {team && (
          <div className="crm-chips" role="group" aria-label={t("week.count")}>
            <button type="button" className="crm-chip-btn mr-chip" aria-pressed={who === null} onClick={() => setWho(null)}>
              {t("week.all")}
            </button>
            {owners.map((id) => (
              <button key={id} type="button" className="crm-chip-btn mr-chip" aria-pressed={who === id} onClick={() => setWho(id)}>
                {(names[id] ?? "").split(/\s+/)[0]}
              </button>
            ))}
          </div>
        )}
      </div>

      <Loaded
        load={load}
        reload={again}
        skeleton={
          <div className="crm-screen">
            <Skeleton rows={3} height={110} />
          </div>
        }
      >
        {() => (
          <div className="crm-lanes-scroll mr-scroll" role="group" aria-label={t("week.lanes")} tabIndex={0}>
            <div className="crm-lanes">
              {lanes.map((lane, index) => {
                const isToday = lane.day === today;
                const isOver = over === lane.key;
                const droppable = lane.day !== null && canWrite;
                const sum = sums.load.state === "ready" ? sums.load.data.lanes[index] : undefined;
                const label = lane.day === null ? t("week.before", { day: f.weekdayLong(noonOf(monday)) }) : f.weekdayLong(noonOf(lane.day));
                return (
                  <section
                    key={lane.key}
                    className="crm-lane"
                    aria-label={label}
                    data-lane={lane.day ?? "before"}
                    data-today={isToday ? "1" : "0"}
                    data-over={isOver ? "1" : "0"}
                    onDragOver={(event: DragEvent) => {
                      if (!droppable || drag === null) return;
                      event.preventDefault();
                      if (over !== lane.key) setOver(lane.key);
                    }}
                    onDragLeave={() => {
                      if (over === lane.key) setOver(null);
                    }}
                    onDrop={(event: DragEvent) => {
                      if (!droppable || drag === null) return;
                      event.preventDefault();
                      const step = steps.find((one) => one.id === drag);
                      if (step !== undefined) void moveTo(step, lane.day!);
                    }}
                  >
                    <div className="crm-lane-head" data-kind={lane.day === null ? "before" : isToday ? "today" : "day"}>
                      <div className="crm-lane-title">
                        <h2>{label}</h2>
                        {isToday && <span className="crm-pill crm-pill-accent">{t("week.today")}</span>}
                        <span className="crm-mono crm-lane-count">{f.number(lane.items.length)}</span>
                      </div>
                      <div className="crm-lane-sub">
                        <span className="crm-mono">{lane.day === null ? t("week.overdue") : f.dayShort(noonOf(lane.day))}</span>
                        <span className="crm-mono crm-lane-sum" data-empty={lane.items.length === 0 ? "1" : "0"}>
                          {lane.items.length === 0 ? "—" : sum === undefined ? "…" : f.money(sum)}
                        </span>
                      </div>
                    </div>
                    <div className="crm-lane-cards">
                      {lane.items.map((step) => {
                        const due = new Date(step.due_at);
                        const late = due.getTime() < now.getTime();
                        return (
                          <article
                            key={step.id}
                            className="crm-card mr-drag"
                            data-late={late ? "1" : "0"}
                            data-dragging={drag === step.id ? "1" : "0"}
                            aria-busy={busy === step.id}
                            draggable={canWrite && busy === null}
                            onDragStart={(event: DragEvent) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", String(step.id));
                              setDrag(step.id);
                            }}
                            onDragEnd={() => {
                              setDrag(null);
                              setOver(null);
                            }}
                          >
                            <div className="crm-card-top">
                              <button type="button" className="crm-card-tick mr-gi" aria-label={t("week.done", { deal: step.deal ?? "" })} disabled={!canWrite || busy !== null} onClick={() => void done(step)}>
                                <Icon name="check" size={14} />
                              </button>
                              <DealLink id={step.deal_id} className="crm-card-deal">
                                {step.deal}
                              </DealLink>
                            </div>
                            <div className="crm-card-text">{step.text}</div>
                            <div className="crm-card-foot">
                              <span className={late ? "crm-pill crm-pill-danger crm-mono crm-card-time" : "crm-mono crm-card-time"}>{f.time(due)}</span>
                              <span className="crm-mono crm-card-amount">{f.money(step.amount)}</span>
                              {team && step.owner_id !== null && (
                                <span className="crm-avatar crm-avatar-sm" title={names[step.owner_id] ?? ""}>
                                  {initials(names[step.owner_id] ?? "")}
                                </span>
                              )}
                              {canWrite && (
                                <button type="button" className="crm-card-move mr-gi" aria-label={t("week.move", { deal: step.deal ?? "" })} aria-haspopup="menu" aria-expanded={moving === step.id} disabled={busy !== null} onClick={() => setMoving(moving === step.id ? null : step.id)}>
                                  <Icon name="calendar-sync" size={14} />
                                </button>
                              )}
                            </div>
                            {moving === step.id && (
                              <div className="crm-pop crm-card-pop" role="menu" ref={menu} aria-label={t("week.moveTo")}>
                                <div className="crm-pop-title">{t("week.moveTo")}</div>
                                {lanes
                                  .filter((to) => to.day !== null && to.day !== f.dayKey(due))
                                  .map((to) => (
                                    <button key={to.key} type="button" role="menuitem" className="crm-pop-item mr-row" onClick={() => void moveTo(step, to.day!)}>
                                      <span>{f.weekdayLong(noonOf(to.day!))}</span>
                                      <span className="crm-mono crm-pop-hint">{f.dayShort(noonOf(to.day!))}</span>
                                    </button>
                                  ))}
                              </div>
                            )}
                          </article>
                        );
                      })}
                      {lane.items.length === 0 && <div className="crm-lane-empty">{isOver ? t("week.empty.drop") : lane.day === null ? t("week.empty.before") : t("week.empty")}</div>}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </Loaded>
    </div>
  );
}
