/**
 * COVER (ledger screen 46): who covers whom while somebody is away, and what
 * the cover lends.
 *
 * WHO SEES WHAT.
 *  - Whoever reads the team (the sales manager, the CRM admin, Read-only):
 *    every cover in three groups (coming up, running now, over), and for the
 *    one picked the deals it lends, what closes and falls due in its days,
 *    the visits already booked, and the rest of the team over the same days.
 *  - A rep: the covers she is part of that are not over. As THE PERSON AWAY
 *    she sees her own deals and writes the briefing notes. As THE ONE WHO
 *    COVERS she is shown, before the first day, the dates and who, and
 *    NOTHING of the deals (no name, no amount, no note): the screen asks the
 *    server for none of it, and the server would answer none. From the first
 *    day the deals are hers to read, and are listed here.
 *
 * WHO CHANGES WHAT. New cover, Change the dates, End today and Cancel are
 * offered to who may write covers (the manager, the admin); the server holds
 * a manager to the people she leads. A cover that is running is ended, not
 * cancelled: "End today" keeps the deals lent through today.
 */
import { useCallback, useMemo, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays, noonOf, type Formatters } from "../../lib/format.ts";
import { scopeOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { Avatar, Head, NOBODY, readWho, useF, type Who } from "./common.tsx";
import { cancelCover, coverState, dayOf, endToday, readCovers, readLent, workingDays, type Cover as CoverRow, type CoverState, type LentDeal, type Note } from "./cover.ts";
import { CoverDialog, type CoverEdit } from "./CoverDialog.tsx";

const GROUPS: readonly CoverState[] = ["coming", "running", "over"];
const TONE: Record<CoverState, "info" | "accent" | undefined> = { coming: "info", running: "accent", over: undefined };

export function Cover(_: ScreenProps) {
  const t = useT();
  const f = useF();
  const session = useSession();
  const toasts = useToasts();
  const me = session.config.user?.id ?? "";
  const seesAll = scopeOf(session) === "team";
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load: whoLoad } = useLoad(() => readWho(session), [session]);
  const who = whoLoad.state === "ready" ? whoLoad.data : NOBODY;
  const { load, reload } = useLoad(() => readCovers(session), [session]);
  const [round, setRound] = useState(0);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      setRound((n) => n + 1);
      reload();
    }, [session, reload]),
  );
  useLive(["covers", "cover_notes"], again);

  const canNew = session.can("covers", "create");
  const canDate = session.can("covers", "update");
  const canCancel = session.can("covers", "delete");
  const [picked, setPicked] = useState<number | null>(null);
  const [edit, setEdit] = useState<CoverEdit | null>(null);
  const [cancelling, setCancelling] = useState<CoverRow | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (id: string): string => who.names[id] ?? "";
  /** Where a cover stands, in a few words: "in 13 days", "day 3 of 10", "ended Fri, Aug 21". */
  const heading = (cover: Pick<CoverRow, "starts_on" | "ends_on">): string => {
    const state = coverState(cover, today);
    if (state === "coming") {
      const days = f.dayDiff(now, noonOf(cover.starts_on));
      return t("cover.head.coming", { count: f.number(days) }, days);
    }
    if (state === "over") return t("cover.head.over", { day: f.dayShort(noonOf(cover.ends_on ?? cover.starts_on)) });
    const day = f.number(Math.max(1, workingDays(cover.starts_on, today)));
    return cover.ends_on === null ? t("cover.head.running.open", { day }) : t("cover.head.running", { day, count: f.number(Math.max(1, workingDays(cover.starts_on, cover.ends_on))) });
  };
  const when = (cover: Pick<CoverRow, "starts_on" | "ends_on">): string =>
    cover.ends_on === null ? t("cover.when.open", { from: f.dayShort(noonOf(cover.starts_on)) }) : t("cover.when", { from: f.dayShort(noonOf(cover.starts_on)), to: f.dayShort(noonOf(cover.ends_on)) });

  const end = async (cover: CoverRow): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const saved = await endToday(session, cover, today);
    setBusy(false);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t("cover.toast.ended", { away: firstName(name(cover.owner_id)), by: firstName(name(cover.cover_id)) }), "pos");
    again();
  };
  const cancel = async (): Promise<void> => {
    if (cancelling === null || busy) return;
    setBusy(true);
    const done = await cancelCover(session, cancelling);
    setBusy(false);
    if (done.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(done.error, t) }), "danger", true);
    if (done.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t("cover.toast.cancelled", { away: firstName(name(cancelling.owner_id)), by: firstName(name(cancelling.cover_id)) }), "plain");
    setCancelling(null);
    again();
  };

  return (
    <div className="crm-screen crm-cover mr-screen" data-screen="cover">
      <Head title={t("cover.h1")} sub={t(seesAll ? "cover.intro.team" : "cover.intro.mine")}>
        {canNew && (
          <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="cover-new" onClick={() => setEdit({ mode: "new" })}>
            <Icon name="plus" />
            {t("cover.new")}
          </button>
        )}
      </Head>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
        {(covers) => {
          const mine = seesAll ? covers : covers.filter((cover) => (cover.cover_id === me || cover.owner_id === me) && coverState(cover, today) !== "over");
          const shown = mine.find((cover) => cover.id === picked) ?? mine.find((cover) => coverState(cover, today) === "running") ?? mine.find((cover) => coverState(cover, today) === "coming") ?? mine[0] ?? null;
          return (
            <>
              {(seesAll || mine.length > 1) && (
                <div className="crm-cv-groups">
                  {(seesAll ? GROUPS : (["running", "coming"] as const)).map((group) => {
                    const rows = mine.filter((cover) => coverState(cover, today) === group);
                    return (
                      <section key={group} className="crm-cv-group" aria-label={t(`cover.group.${group}`)} data-group={group}>
                        <div className="crm-cv-group-head">
                          <h2>{t(`cover.group.${group}`)}</h2>
                          <span className="crm-mono">{f.number(rows.length)}</span>
                        </div>
                        <div className="crm-cv-rows">
                          {rows.map((cover) => (
                            <div key={cover.id} className="crm-cv-row" data-on={shown?.id === cover.id ? "1" : "0"} data-cover={cover.id}>
                              <button type="button" className="crm-cv-pick mr-gi" aria-pressed={shown?.id === cover.id} onClick={() => setPicked(cover.id)}>
                                <strong>{t("cover.title", { by: firstName(name(cover.cover_id)), away: firstName(name(cover.owner_id)) })}</strong>
                                <span className="crm-mono">{when(cover)}</span>
                                <em>{heading(cover)}</em>
                              </button>
                              {group === "running" && canDate && (
                                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="end" disabled={busy} aria-label={t("cover.end.aria", { away: firstName(name(cover.owner_id)) })} onClick={() => void end(cover)}>
                                  {t("cover.end")}
                                </button>
                              )}
                              {group === "coming" && canDate && (
                                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="dates" aria-label={t("cover.dates.aria", { away: firstName(name(cover.owner_id)) })} onClick={() => setEdit({ mode: "dates", cover })}>
                                  {t("cover.dates")}
                                </button>
                              )}
                              {group === "coming" && canCancel && (
                                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="cancel" aria-label={t("cover.cancel.aria", { away: firstName(name(cover.owner_id)) })} onClick={() => setCancelling(cover)}>
                                  {t("cover.cancel")}
                                </button>
                              )}
                            </div>
                          ))}
                          {rows.length === 0 && <p className="crm-cv-none">{t(`cover.group.${group}.none`)}</p>}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}

              {shown === null ? (
                <div className="crm-cv-nothing" data-testid="cover-none">
                  <strong>{t("cover.none")}</strong>
                  <p>{t(seesAll ? "cover.none.team" : "cover.none.mine")}</p>
                </div>
              ) : (
                <Entry key={`${String(shown.id)}:${shown.starts_on}:${shown.ends_on ?? ""}`} cover={shown} who={who} f={f} now={now} today={today} round={round} seesAll={seesAll} me={me} when={when(shown)} heading={heading(shown)} onChanged={again} />
              )}

              {edit !== null && (
                <CoverDialog
                  edit={edit}
                  who={who}
                  covers={covers}
                  wide={scopeOf(session) === "team" && !(session.config.access?.roles ?? []).some((role) => role.slug === "crm-sales-manager")}
                  onClose={() => setEdit(null)}
                  onDone={(id) => {
                    if (id !== null) setPicked(id);
                    again();
                  }}
                />
              )}
              {cancelling !== null && (
                <Dialog
                  shape="box"
                  name="cover-cancel"
                  icon="calendar-x"
                  title={t("cover.cancel.title")}
                  subtitle={t("cover.cancel.sub", { by: firstName(name(cancelling.cover_id)), away: firstName(name(cancelling.owner_id)), when: when(cancelling) })}
                  onClose={() => setCancelling(null)}
                  busy={busy}
                  foot={
                    <>
                      <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" data-autofocus disabled={busy} onClick={() => setCancelling(null)}>
                        {t("cover.cancel.keep")}
                      </button>
                      <button type="button" className="crm-btn crm-btn-danger crm-btn-44 crm-btn-wide mr-btn" data-go disabled={busy} onClick={() => void cancel()}>
                        {busy ? t("ui.saving") : t("cover.cancel.go")}
                      </button>
                    </>
                  }
                >
                  <p className="crm-bk-told">
                    <Icon name="notebook-pen" size={15} />
                    <span>{t("cover.cancel.notes")}</span>
                  </p>
                </Dialog>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

/** One cover: its card, and what it lends when the reader may be shown that. */
function Entry({ cover, who, f, now, today, round, seesAll, me, when, heading, onChanged }: { cover: CoverRow; who: Who; f: Formatters; now: Date; today: string; round: number; seesAll: boolean; me: string; when: string; heading: string; onChanged: () => void }) {
  const t = useT();
  const session = useSession();
  const state = coverState(cover, today);
  const by = who.names[cover.cover_id] ?? "";
  const away = who.names[cover.owner_id] ?? "";
  const byFirst = firstName(by);
  const awayFirst = firstName(away);
  // D-1: whoever covers is shown the dates and who before her first day, and nothing of the deals.
  const early = !seesAll && cover.cover_id === me && cover.owner_id !== me && state === "coming";
  const { load, reload } = useLoad(() => (early ? Promise.resolve(null) : readLent(session, cover, now, f, seesAll)), [session, cover.id, cover.starts_on, cover.ends_on, early, seesAll, round]);
  const back = cover.ends_on === null ? null : f.dayShort(noonOf(addDays(cover.ends_on, 1)));
  const first = f.dayShort(noonOf(cover.starts_on));
  const days = useMemo(() => (cover.ends_on === null ? null : workingDays(cover.starts_on, cover.ends_on)), [cover.starts_on, cover.ends_on]);

  return (
    <>
      <section className="crm-cv-entry mr-card" data-testid="cover-entry" data-state={state}>
        <div className="crm-cv-entry-top">
          <div className="crm-cv-pair">
            <Avatar name={by} tone="accent" />
            <Icon name="arrow-left-right" size={15} />
            <Avatar name={away} />
          </div>
          <div className="crm-cv-entry-words">
            <span className="crm-pill crm-mono" data-tone={TONE[state]}>
              {t(`cover.state.${state}`)}
            </span>
            <span className="crm-cv-entry-head crm-mono" data-testid="cover-head">
              {heading}
            </span>
            <div className="crm-cv-entry-title">{t("cover.entry", { by: byFirst, away: awayFirst, when })}</div>
            <div className="crm-cv-entry-days crm-mono">{days === null || back === null ? t("cover.days.open") : t("cover.days", { count: f.number(days), away: awayFirst, back }, days)}</div>
          </div>
        </div>
        <ul className="crm-cv-lines">
          <li>
            <Icon name="columns-3" size={14} />
            <span>{t("cover.line.board", { first, by: byFirst, away: awayFirst })}</span>
          </li>
          <li>
            <Icon name="user-round" size={14} />
            <span>{t("cover.line.owner", { away: awayFirst })}</span>
          </li>
          <li>
            <Icon name="calendar-check" size={14} />
            <span>{back === null ? t("cover.line.open", { by: byFirst }) : t("cover.line.back", { back, by: byFirst })}</span>
          </li>
        </ul>
      </section>

      {early ? (
        <div className="crm-banner crm-cv-early" data-tone="accent" data-testid="cover-early">
          <Icon name="lock" size={16} />
          <span>{t("cover.early", { first, away: awayFirst })}</span>
        </div>
      ) : (
        <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={96} />}>
          {(lent) =>
            lent === null ? null : (
              <>
                <div className="crm-stats crm-cv-stats">
                  <Stat label={t("cover.stat.deals")} value={f.number(lent.count)} sub={t("cover.stat.deals.sub", { amount: f.money(lent.amount) })} testid="cv-deals" />
                  <Stat label={t("cover.stat.closing")} value={f.number(lent.closing)} sub={t("cover.stat.closing.sub", { away: awayFirst })} tone={lent.closing > 0 ? "warn" : undefined} testid="cv-closing" />
                  <Stat
                    label={t(state === "coming" ? "cover.stat.steps.today" : "cover.stat.steps")}
                    value={f.number(lent.stepCount)}
                    sub={t("cover.stat.steps.sub", { late: f.number(lent.stepsLate), window: f.number(lent.stepsInWindow) })}
                    tone={lent.stepsLate > 0 ? "danger" : undefined}
                    testid="cv-steps"
                  />
                  <Stat label={t("cover.stat.visits")} value={f.number(lent.visitCount)} sub={t("cover.stat.visits.sub", { away: awayFirst })} testid="cv-visits" />
                </div>

                <div className="crm-cv-grid">
                  <section className="crm-cv-card" aria-labelledby="crm-cv-deals">
                    <div className="crm-cv-card-head">
                      <h2 id="crm-cv-deals">{t("cover.deals.head", { away: awayFirst, by: byFirst })}</h2>
                      <span className="crm-mono" data-testid="cv-deals-sum">
                        {f.number(lent.count)} · {f.money(lent.amount)}
                      </span>
                    </div>
                    <ul className="crm-cv-deals">
                      {lent.deals.map((deal) => (
                        <Deal key={deal.id} deal={deal} cover={cover} note={lent.notes.find((note) => note.deal_id === deal.id) ?? null} f={f} awayFirst={awayFirst} byFirst={byFirst} mayNote={state !== "over" && (seesAll || cover.owner_id === me)} onSaved={onChanged} />
                      ))}
                    </ul>
                    {lent.deals.length === 0 && <p className="crm-cv-none">{t("cover.deals.none", { away: awayFirst })}</p>}
                  </section>

                  <div className="crm-cv-side">
                    {lent.steps.length > 0 && (
                      <section className="crm-cv-card" aria-labelledby="crm-cv-steps">
                        <div className="crm-cv-card-head">
                          <h2 id="crm-cv-steps">{t(state === "coming" ? "cover.steps.head.today" : "cover.steps.head")}</h2>
                          <span className="crm-mono">{t("cover.steps.count", { count: f.number(lent.stepCount), late: f.number(lent.stepsLate) })}</span>
                        </div>
                        <ul className="crm-cv-list">
                          {lent.steps.map((step) => {
                            const due = new Date(step.due_at);
                            const late = due.getTime() < now.getTime();
                            const key = f.dayKey(due);
                            const inWindow = key >= cover.starts_on && (cover.ends_on === null || key <= cover.ends_on);
                            return (
                              <li key={step.id} className="crm-cv-item" data-step={step.id}>
                                <div className="crm-cv-item-top">
                                  <strong>{step.deal ?? ""}</strong>
                                  <span className="crm-mono" data-tone={late ? "danger" : inWindow ? "warn" : undefined}>
                                    {f.dayShort(due)} · {f.time(due)}
                                  </span>
                                </div>
                                <p>{step.text}</p>
                                {(late || inWindow) && (
                                  <span className="crm-cv-tag" data-tone={late ? "danger" : "warn"}>
                                    {t(late ? "cover.steps.late" : "cover.steps.window")}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    )}
                    {lent.visits.length > 0 && (
                      <section className="crm-cv-card" aria-labelledby="crm-cv-visits">
                        <div className="crm-cv-card-head">
                          <h2 id="crm-cv-visits">{t("cover.visits.head")}</h2>
                        </div>
                        <ul className="crm-cv-list">
                          {lent.visits.map((visit) => (
                            <li key={visit.id} className="crm-cv-item" data-visit={visit.id}>
                              <ScreenLink to="visits" className="crm-cv-item-link mr-gi">
                                <strong>{visit.purpose}</strong>
                                <span className="crm-cv-item-top">
                                  <span>{visit.company ?? ""}</span>
                                  <span className="crm-mono">
                                    {f.dayShort(new Date(visit.starts_at))} · {f.time(new Date(visit.starts_at))}
                                  </span>
                                </span>
                              </ScreenLink>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {seesAll && lent.others.length > 0 && (
                      <section className="crm-cv-card" aria-labelledby="crm-cv-others">
                        <div className="crm-cv-card-head">
                          <h2 id="crm-cv-others">{t("cover.others.head")}</h2>
                        </div>
                        <ul className="crm-cv-list">
                          {who.reps
                            .map((id) => lent.others.find((other) => other.id === id))
                            .filter((other) => other !== undefined)
                            .map((other) => (
                              <li key={other.id} className="crm-cv-other" data-person={other.id}>
                                <Avatar name={who.names[other.id] ?? ""} size="sm" />
                                <div>
                                  <div className="crm-cv-item-top">
                                    <strong>{firstName(who.names[other.id] ?? "")}</strong>
                                    <span className="crm-mono">
                                      {t("cover.others.deals", { count: f.number(other.deals) }, other.deals)} · {f.money(other.amount)}
                                    </span>
                                  </div>
                                  <p>
                                    {other.closing === 0 ? t("cover.others.closing.none") : t("cover.others.closing", { count: f.number(other.closing) }, other.closing)}
                                    {other.id === cover.cover_id && ` · ${t("cover.others.plus", { away: awayFirst, count: f.number(lent.count) }, lent.count)}`}
                                  </p>
                                </div>
                              </li>
                            ))}
                        </ul>
                      </section>
                    )}
                  </div>
                </div>
              </>
            )
          }
        </Loaded>
      )}
    </>
  );
}

function Stat({ label, value, sub, tone, testid }: { label: string; value: string; sub: string; tone?: "warn" | "danger" | undefined; testid: string }) {
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

/** One lent deal, with its briefing note. The note is written by who set the cover up or by the person away, one note a deal. */
function Deal({ deal, cover, note, f, awayFirst, byFirst, mayNote, onSaved }: { deal: LentDeal; cover: CoverRow; note: Note | null; f: Formatters; awayFirst: string; byFirst: string; mayNote: boolean; onSaved: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newClientKey());
  const close = dayOf(deal.expected_close);
  const inWindow = close !== null && close >= cover.starts_on && (cover.ends_on === null || close <= cover.ends_on);
  const canWrite = mayNote && (note === null ? session.can("cover_notes", "create") : session.can("cover_notes", "update"));
  const canEmpty = note !== null && session.can("cover_notes", "delete");
  const text = (draft ?? "").trim();
  const ready = draft !== null && text !== (note?.text ?? "") && (text !== "" || canEmpty);

  const save = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    const saved = note === null ? await session.create("cover_notes", { cover_id: cover.id, deal_id: deal.id, text }, key) : text === "" ? await session.remove("cover_notes", note.id) : await session.update("cover_notes", note.id, { text }, { seen: { text: note.text } });
    setBusy(false);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t(text === "" ? "cover.note.toast.off" : "cover.note.toast", { deal: deal.name }), "pos");
    setDraft(null);
    onSaved();
  };

  return (
    <li className="crm-cv-deal" data-deal={deal.id}>
      <div className="crm-cv-deal-top">
        <span className="crm-cv-deal-name">
          <strong>{deal.name}</strong>
          <span>{deal.company ?? ""}</span>
        </span>
        <span className="crm-pill" data-tone="accent">
          <Icon name="user-round-check" size={12} />
          {t("cover.mark", { away: awayFirst })}
        </span>
        {deal.stage !== null && <span className="crm-pill">{deal.stage}</span>}
        <span className="crm-mono crm-cv-deal-amount">{f.money(deal.amount)}</span>
      </div>
      {close !== null && (
        <div className="crm-cv-deal-close">
          <span>{t("cover.closes")}</span>
          <span className="crm-mono" data-tone={inWindow ? "warn" : undefined}>
            {f.dayShort(noonOf(close))}
          </span>
          {inWindow && <span className="crm-cv-tag" data-tone="warn">{t("cover.closes.window")}</span>}
        </div>
      )}
      {draft === null ? (
        <>
          {note !== null ? (
            <div className="crm-cv-note" data-testid="cv-note">
              <Icon name="corner-down-right" size={14} />
              <span>{note.text}</span>
            </div>
          ) : (
            <div className="crm-cv-nonote">{t("cover.note.none")}</div>
          )}
          {canWrite && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" data-act="note" aria-label={t(note === null ? "cover.note.write.aria" : "cover.note.edit.aria", { deal: deal.name })} onClick={() => setDraft(note?.text ?? "")}>
              <Icon name="pencil" size={12} />
              {t(note === null ? "cover.note.write" : "cover.note.edit")}
            </button>
          )}
        </>
      ) : (
        <div className="crm-cv-note-edit">
          <label className="crm-label" htmlFor={`crm-cv-note-${String(deal.id)}`}>
            {t("cover.note.for", { by: byFirst })}
          </label>
          <textarea id={`crm-cv-note-${String(deal.id)}`} className="crm-input crm-textarea mr-fld" autoFocus value={draft} maxLength={1000} rows={3} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
          <div className="crm-cv-note-acts">
            <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" disabled={!ready || busy} onClick={() => void save()}>
              <Icon name="check" size={14} />
              {busy ? t("ui.saving") : t("cover.note.save")}
            </button>
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy} onClick={() => setDraft(null)}>
              {t("cover.note.leave")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
