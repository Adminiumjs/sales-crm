/**
 * VISIT NOTES (ledger screen 40): what was seen, what was said, what happens
 * next and what was agreed, for a visit whose time has passed.
 *
 * WHAT IS SAVED, AND WHEN. The three texts are one row, saved by the button
 * (made with a key the first time, so a lost reply makes one write-up). Each
 * agreed point is its own row, saved as it is added and removed as it is
 * taken off. The first save also marks the visit as made, which is what
 * keeps it from being removed afterwards. The "what to capture" ticks are
 * kept with the write-up (one yes/no column each, saved by the same button: D6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { addDays, formatters } from "../../lib/format.ts";
import { scopeOf } from "../../selling/figures.ts";
import { useHelping } from "../../selling/helping.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { truthy } from "../teamwork/data.ts";
import { isWritten, readNames, readWriteUp, type Agreed, type Note, type WriteUp } from "./data.ts";

const CAPTURE = ["access", "floor", "power", "existing", "timing"] as const;
type Field = "saw" | "said" | "next";
const FIELDS: readonly Field[] = ["saw", "said", "next"];
/** When "the next step" lands in the writer's queue: two days on, at ten, where the business is. */
const NEXT_IN_DAYS = 2;
const NEXT_AT = "10:00";

export function VisitNotes({ id }: { id: number | null }) {
  const t = useT();
  const session = useSession();
  const mine = scopeOf(session) === "mine";
  const [now] = useState(() => session.now());
  const { load, reload } = useLoad(() => readWriteUp(session, id, mine, now), [session, id, mine, now]);
  const again = useCoalesced(reload);
  useLive(["visit_notes", "visit_agreed"], again);
  const { load: people } = useLoad(() => readNames(session), [session]);
  const names = people.state === "ready" ? people.data : {};
  // Opened with no visit named, the page picks one (the first that waits on its notes) and then stays on it: saving its
  // write-up must not hand the page to the next visit.
  const nav = useNav();
  const picked = id === null && load.state === "ready" && load.data !== null ? load.data.visit.id : null;
  useEffect(() => {
    if (picked !== null) nav.replace("visits", "notes", picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once a visit is picked
  }, [picked]);

  return (
    <div className="crm-screen crm-visit-notes mr-screen" data-screen="visit-notes">
      <ScreenLink to="visits" className="crm-btn crm-btn-ghost crm-btn-32 crm-back mr-gi">
        <Icon name="chevron-left" size={14} className="crm-flip" />
        {t("visits.notes.back")}
      </ScreenLink>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
        {(data) =>
          data === null ? (
            <div className="crm-empty" data-testid="notes-none">
              <span className="crm-empty-icon">
                <Icon name="notebook-pen" size={21} />
              </span>
              <div className="crm-empty-title">{t(id === null ? "visits.notes.none" : "visits.notes.gone")}</div>
              <p>{t(id === null ? "visits.notes.none.body" : "visits.notes.gone.body")}</p>
            </div>
          ) : (
            <WriteUpPage key={data.visit.id} data={data} names={names} now={now} reload={again} />
          )
        }
      </Loaded>
    </div>
  );
}

function WriteUpPage({ data, names, now, reload }: { data: WriteUp; names: Record<string, string>; now: Date; reload: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const { visit, note, agreed } = data;
  const at = new Date(visit.starts_at);
  const happened = at.getTime() < now.getTime();
  const written = note !== null;
  /*
   * On a deal she only helps on (ruling 1d): her OWN visit, made before, is hers to write up; a colleague's is not,
   * and she lines no new step up on the deal. Null while that is read: nothing is offered yet.
   */
  const helping = useHelping(visit.deal_owner_id ?? null, f.dayKey(now));
  const hers = visit.rep_id === config.user?.id;
  const canWrite = happened && helping !== null && (!helping || hers) && (written ? session.can("visit_notes", "update") : session.can("visit_notes", "create"));
  const canAgree = canWrite && session.can("visit_agreed", "create");
  const canQueue = session.can("follow_ups", "create") && helping === false;

  const [draft, setDraft] = useState<Record<Field, string>>({ saw: note?.saw ?? "", said: note?.said ?? "", next: note?.next ?? "" });
  const touched = useRef(false);
  // A colleague's change arrives: what is on screen follows it unless the person has typed since.
  useEffect(() => {
    if (!touched.current) setDraft({ saw: note?.saw ?? "", said: note?.said ?? "", next: note?.next ?? "" });
  }, [note]);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  /** A tick as the person left it on screen, else as the write-up keeps it. */
  const tickOf = (key: (typeof CAPTURE)[number]): boolean => ticks[key] ?? truthy(note?.[`cap_${key}`]);
  const [point, setPoint] = useState("");
  const [queue, setQueue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef({ note: newClientKey(), step: newClientKey(), point: newClientKey() });

  const typed = FIELDS.some((field) => draft[field].trim() !== "");
  const dirty = FIELDS.some((field) => draft[field].trim() !== (note?.[field] ?? "").trim()) || CAPTURE.some((key) => ticks[key] !== undefined && ticks[key] !== truthy(note?.[`cap_${key}`]));

  /** The write-up's own row: made the first time, changed after. Answers the row, or null with the reason on screen. */
  const saveNote = useCallback(async (): Promise<Note | null> => {
    const values = {
      saw: draft.saw.trim() === "" ? null : draft.saw.trim(),
      said: draft.said.trim() === "" ? null : draft.said.trim(),
      next: draft.next.trim() === "" ? null : draft.next.trim(),
      ...Object.fromEntries(CAPTURE.map((key) => [`cap_${key}`, tickOf(key)])),
    };
    const saved = note === null ? await session.create<Note>("visit_notes", { visit_id: visit.id, ...values }, keys.current.note) : await session.update<Note>("visit_notes", note.id, values);
    if (saved.state === "saved") {
      touched.current = false;
      // It was made: the visit says so from now on, and is kept. A visit already marked is left as it is.
      if (visit.state === "booked") await session.act("site_visits", visit.id, "done", "booked");
      return saved.row;
    }
    setError(saved.state === "refused" ? t("ui.refused", { reason: reasonOf(saved.error, t) }) : t("ui.unknown"));
    return null;
  }, [draft, note, session, visit, t, ticks]); // eslint-disable-line react-hooks/exhaustive-deps -- tickOf reads ticks and note

  const save = async (): Promise<void> => {
    if (!canWrite || !typed || busy) return;
    setError(null);
    setBusy(true);
    const row = await saveNote();
    if (row !== null && queue && canQueue && draft.next.trim() !== "") {
      const due = f.at(addDays(f.dayKey(session.now()), NEXT_IN_DAYS), NEXT_AT);
      const lined = await session.create("follow_ups", { deal_id: visit.deal_id, owner_id: config.user?.id ?? visit.rep_id, due_at: due.toISOString(), text: draft.next.trim(), kind: "step" }, keys.current.step);
      if (lined.state === "saved") {
        keys.current.step = newClientKey();
        setQueue(false);
        toasts.show(t("visits.notes.toast.queued", { company: visit.company ?? "", when: `${f.dayShort(due)}, ${f.time(due)}` }), "pos");
      } else setError(t("visits.notes.error.step", { reason: lined.state === "refused" ? reasonOf(lined.error, t) : t("ui.unknown") }));
    } else if (row !== null) toasts.show(t("visits.notes.toast.saved", { company: visit.company ?? "" }), "pos");
    setBusy(false);
    reload();
  };

  const addPoint = async (): Promise<void> => {
    const text = point.trim();
    if (!canAgree || text === "" || busy) return;
    setError(null);
    setBusy(true);
    // An agreed point hangs on the write-up: the first one makes it.
    const row = note ?? (await saveNote());
    if (row !== null) {
      const position = agreed.reduce((most, one) => Math.max(most, Number(one.position)), -1) + 1;
      const saved = await session.create<Agreed>("visit_agreed", { visit_note_id: row.id, text, position }, keys.current.point);
      if (saved.state === "saved") {
        keys.current.point = newClientKey();
        setPoint("");
      } else setError(saved.state === "refused" ? t("ui.refused", { reason: reasonOf(saved.error, t) }) : t("ui.unknown"));
    }
    setBusy(false);
    reload();
  };

  const removePoint = async (one: Agreed): Promise<void> => {
    setBusy(true);
    await toasts.say(session.remove("visit_agreed", one.id), () => t("visits.notes.toast.removed"));
    setBusy(false);
    reload();
  };

  const ticked = CAPTURE.filter((key) => tickOf(key)).length;
  const ago = f.dayDiff(at, now);
  const repName = names[visit.rep_id] ?? "";
  const earlier = data.past.filter((one) => one.id !== visit.id && isWritten(one));

  return (
    <>
      <div className="crm-vn-head">
        <span className="crm-vn-icon">
          <Icon name="building-2" size={19} />
        </span>
        <div>
          <h1>{visit.purpose}</h1>
          <div className="crm-vn-meta">
            <strong>{visit.company}</strong>
            {visit.town !== null && visit.town !== "" && <span>{visit.town}</span>}
            <span className="crm-visit-rule" aria-hidden="true" />
            <span>{f.dayLong(at)}</span>
            <span className="crm-mono">{f.time(at)}</span>
            <span className="crm-pill" data-tone={!happened ? "info" : written ? "pos" : "danger"} data-testid="notes-state">
              {t(!happened ? "visits.tone.soon" : written ? "visits.notes.state.written" : "visits.notes.state.unwritten")}
            </span>
          </div>
        </div>
      </div>

      {data.past.length > 0 && (
        <div className="crm-vn-picker" role="group" aria-label={t("visits.notes.which")}>
          <span className="crm-bk-head">{t("visits.notes.which")}</span>
          {data.past.map((one) => (
            <ScreenLink key={one.id} to="visits" rest={["notes", one.id]} className="crm-chip-btn mr-chip" current={one.id === visit.id}>
              <span className="crm-dot" data-tone={isWritten(one) ? "pos" : "danger"} />
              {one.company}
              <span className="crm-chip-count crm-mono">{f.dayShort(new Date(one.starts_at))}</span>
            </ScreenLink>
          ))}
        </div>
      )}

      {!happened ? (
        <div className="crm-empty" data-testid="notes-early">
          <span className="crm-empty-icon">
            <Icon name="calendar-clock" size={21} />
          </span>
          <div className="crm-empty-title">{t("visits.notes.early")}</div>
          <p>{t("visits.notes.early.body")}</p>
        </div>
      ) : (
        <div className="crm-vn-grid">
          <div className="crm-vn-main">
            {helping === true && !hers && (
              <div className="crm-banner" role="status" data-tone="info" data-testid="notes-helping">
                {t("help.visit", { name: firstName(names[visit.rep_id] ?? t("closed.someone")) })}
              </div>
            )}
            {canWrite && (
              <section className="crm-side-card mr-card" aria-labelledby="crm-vn-capture">
                <div className="crm-vn-card-head">
                  <h2 id="crm-vn-capture">{t("visits.notes.capture")}</h2>
                  <span className="crm-mono">{t("visits.notes.capture.count", { done: f.number(ticked), all: f.number(CAPTURE.length) })}</span>
                </div>
                <p className="crm-field-note">{t("visits.notes.capture.hint")}</p>
                <div className="crm-vn-capture">
                  {CAPTURE.map((key) => {
                    const on = tickOf(key);
                    return (
                      <button key={key} type="button" role="checkbox" aria-checked={on} className="crm-vn-tick mr-row" onClick={() => setTicks((was) => ({ ...was, [key]: !on }))}>
                        <span className="crm-vn-box" aria-hidden="true">
                          {on && <Icon name="check" size={12} />}
                        </span>
                        <span>{t(`visits.notes.capture.${key}`)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="crm-side-card mr-card">
              {FIELDS.map((field) => (
                <div key={field} className="crm-vn-field">
                  <label className="crm-label" htmlFor={`crm-vn-${field}`}>
                    {t(`visits.notes.${field}`)}
                  </label>
                  <textarea
                    id={`crm-vn-${field}`}
                    className="crm-input crm-textarea mr-fld"
                    rows={field === "next" ? 2 : 4}
                    maxLength={2000}
                    value={draft[field]}
                    readOnly={!canWrite}
                    disabled={busy}
                    placeholder={canWrite ? t(`visits.notes.${field}.hint`) : t("visits.notes.empty")}
                    onChange={(event) => {
                      touched.current = true;
                      setError(null);
                      setDraft((was) => ({ ...was, [field]: event.target.value }));
                    }}
                  />
                </div>
              ))}

              <div className="crm-vn-agreed">
                <div className="crm-label">{t("visits.notes.agreed")}</div>
                {agreed.length > 0 ? (
                  <ul data-testid="notes-agreed">
                    {agreed.map((one) => (
                      <li key={one.id}>
                        <Icon name="check" size={14} />
                        <span>{one.text}</span>
                        {canWrite && session.can("visit_agreed", "delete") && (
                          <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("visits.notes.agreed.remove", { text: one.text })} disabled={busy} onClick={() => void removePoint(one)}>
                            <Icon name="x" size={13} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  !canAgree && <p className="crm-field-note">{t("visits.notes.agreed.none")}</p>
                )}
                {canAgree && (
                  <div className="crm-vn-add">
                    <input
                      className="crm-input mr-fld"
                      value={point}
                      maxLength={300}
                      disabled={busy}
                      aria-label={t("visits.notes.agreed.add.hint")}
                      placeholder={t("visits.notes.agreed.add.hint")}
                      onChange={(event) => setPoint(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void addPoint();
                        }
                      }}
                    />
                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" disabled={busy || point.trim() === ""} onClick={() => void addPoint()}>
                      <Icon name="plus" size={14} />
                      {t("visits.notes.agreed.add")}
                    </button>
                  </div>
                )}
              </div>

              {canWrite && (
                <div className="crm-vn-save">
                  {canQueue && (
                    <button type="button" role="switch" aria-checked={queue} className="crm-switch mr-gi" disabled={busy} onClick={() => setQueue((was) => !was)}>
                      <span className="crm-switch-track">
                        <span className="crm-switch-knob" />
                      </span>
                      {t("visits.notes.queue")}
                    </button>
                  )}
                  <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="notes-save" disabled={busy || !typed || (written && !dirty && !(queue && draft.next.trim() !== ""))} onClick={() => void save()}>
                    <Icon name="notebook-pen" />
                    {busy ? t("ui.saving") : t(written ? "visits.notes.save.changes" : "visits.notes.save")}
                  </button>
                </div>
              )}
              {error !== null && (
                <div className="crm-form-error" role="alert">
                  <Icon name="triangle-alert" size={15} />
                  <span>{error}</span>
                </div>
              )}
            </section>
          </div>

          <div className="crm-vn-side">
            <section className="crm-side-card mr-card" aria-labelledby="crm-vn-visit">
              <h2 id="crm-vn-visit">{t("visits.notes.visit")}</h2>
              {visit.contact !== null && (
                <div className="crm-vn-person">
                  <span className="crm-avatar" aria-hidden="true">
                    {initials(visit.contact)}
                  </span>
                  <div>
                    <strong>{visit.contact}</strong>
                    {visit.contact_role !== null && <span>{visit.contact_role}</span>}
                  </div>
                </div>
              )}
              <div className="crm-vn-person">
                <span className="crm-avatar" data-tone="accent" aria-hidden="true">
                  {repName === "" ? "?" : initials(repName)}
                </span>
                <div>
                  <strong>{repName}</strong>
                  <span>{ago <= 0 ? t("visits.notes.went.today") : ago === 1 ? t("visits.notes.went.yesterday") : t("visits.notes.went.days", { count: f.number(ago) }, ago)}</span>
                </div>
              </div>
              {visit.deal !== null && (
                <div className="crm-visit-deal">
                  <Icon name="handshake" size={14} />
                  <span>{visit.deal}</span>
                  {visit.amount !== null && <span className="crm-mono">{f.money(visit.amount)}</span>}
                </div>
              )}
            </section>
            {earlier.length > 0 && (
              <section className="crm-side-card mr-card" aria-labelledby="crm-vn-earlier">
                <h2 id="crm-vn-earlier">{t("visits.notes.earlier")}</h2>
                <ul className="crm-vn-earlier">
                  {earlier.map((one) => (
                    <li key={one.id}>
                      <ScreenLink to="visits" rest={["notes", one.id]} className="crm-vn-earlier-row mr-row">
                        <span>
                          <strong>{one.company}</strong>
                          <span className="crm-mono">{f.dayShort(new Date(one.starts_at))}</span>
                        </span>
                        <span>{one.purpose}</span>
                      </ScreenLink>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}
