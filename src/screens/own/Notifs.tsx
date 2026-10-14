/**
 * HOW I AM TOLD (ledger screen 20): which kinds of notice reach this person
 * and by which channel, her quiet hours, and when her weekly summary goes
 * out. All of it is Adminium's own setting for her; this screen is the app's
 * cut of it.
 *
 * CUT TO HER ROLES AND PARTS (finding P26). A kind is a row only when
 * something can send it to her (`kindsFor`), and under a rule's notices the
 * screen lists what those rules can tell HER and nothing else. A marketer
 * reads no "a deal is stuck"; a rep reads no "an approval is asked".
 *
 * WHAT IS NOT HERE. Adminium keeps one switch for every rule's notice, not
 * one a rule, so the design's seven rows are two. It has no switch for "not
 * me" on a summary, and no notice by push yet: neither is drawn.
 */
import { useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, noonOf } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { channelsOf, kindsFor, quietOf, readSchedule, readSummaries, readTold, reasonsFor, ruleState, saveTold, type Kind, type Schedule, type Summary, type Told, type ToldChoice } from "./data.ts";

const KIND_ICON: Record<Kind, string> = { mention: "message-square", "automation.notice": "bell-ring" };
const KIND_KEY: Record<Kind, "mention" | "rules"> = { mention: "mention", "automation.notice": "rules" };
/** Monday first, as the design draws the week; the server counts from Sunday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export function Notifs(_props: ScreenProps) {
  const session = useSession();
  const { load, reload } = useLoad(() => Promise.all([readTold(session), readSchedule(session), readSummaries(session).catch(() => [] as Summary[])]), [session]);
  return (
    <Loaded load={load} reload={reload} skeleton={<div className="crm-screen crm-told mr-screen"><Skeleton rows={3} height={110} /></div>}>
      {([told, schedule, summaries]) => <Form told={told} schedule={schedule} summaries={summaries} />}
    </Loaded>
  );
}

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="crm-switch mr-gi" disabled={disabled} onClick={() => onChange(!on)}>
      <span className="crm-switch-track">
        <span className="crm-switch-knob" />
      </span>
    </button>
  );
}

function Form(props: { told: Told; schedule: Schedule; summaries: Summary[] }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const slugs = useMemo(() => (config.access?.roles ?? []).map((role) => role.slug), [config]);
  const kinds = useMemo(() => kindsFor(session, slugs), [session, slugs]);
  const reasons = useMemo(() => reasonsFor(session, slugs), [session, slugs]);
  // What the server holds, and what she has set on the page since.
  const [held, setHeld] = useState({ told: props.told, schedule: props.schedule });
  const start = (from: { told: Told; schedule: Schedule }): ToldChoice => ({
    kinds: Object.fromEntries(kinds.map((kind) => [kind, { inApp: channelsOf(from.told, kind).inApp, email: channelsOf(from.told, kind).email }])),
    quiet: quietOf(from.schedule),
    digestDay: from.schedule.digestDay,
    digestTime: from.schedule.digestTime,
  });
  const [choice, setHeldChoice] = useState<ToldChoice>(() => start({ told: props.told, schedule: props.schedule }));
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // Anything she sets after a save takes the "saved at" line away: it is no longer what the server holds.
  const setChoice = (next: (was: ToldChoice) => ToldChoice): void => {
    setSavedAt(null);
    setHeldChoice(next);
  };
  const mail = held.told.channels.find((channel) => channel.id === "email")?.available === true;
  const mixed = quietOf(held.schedule).mixed;
  const digest = props.summaries.length > 0;
  const on = kinds.reduce((n, kind) => n + (choice.kinds[kind]?.inApp === true ? 1 : 0) + (choice.kinds[kind]?.email === true ? 1 : 0), 0);

  const set = (kind: Kind, channel: "inApp" | "email", next: boolean): void => setChoice((was) => ({ ...was, kinds: { ...was.kinds, [kind]: { ...was.kinds[kind]!, [channel]: next } } }));
  const save = async (): Promise<void> => {
    setBusy(true);
    const saved = await saveTold(session, held, choice);
    setBusy(false);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    setHeld({ told: saved.told, schedule: saved.schedule });
    setHeldChoice(start({ told: saved.told, schedule: saved.schedule }));
    toasts.show(t("told.saved"), "pos");
    setSavedAt(session.now());
  };

  return (
    <div className="crm-screen crm-told mr-screen" data-screen="notifs">
      <div className="crm-screen-head">
        <div>
          <h1>{t("told.title")}</h1>
          <p className="crm-screen-sub">
            {t("told.sub")} {kinds.length > 0 && t("told.count", { on: f.number(on), all: f.number(kinds.length * 2) })}
          </p>
        </div>
      </div>

      {kinds.length === 0 ? (
        <div className="crm-empty" data-testid="told-none">
          <span className="crm-empty-icon">
            <Icon name="bell" size={21} />
          </span>
          <div className="crm-empty-title">{t("told.none")}</div>
          <p>{t("told.none.body")}</p>
        </div>
      ) : (
        <div className="crm-told-table mr-card" role="table" aria-label={t("told.title")}>
          <div className="crm-told-head" role="row">
            <span role="columnheader">{t("told.col.when")}</span>
            <span role="columnheader">{t("told.col.app")}</span>
            <span role="columnheader">{t("told.col.email")}</span>
          </div>
          {kinds.map((kind) => {
            const name = t(`told.kind.${KIND_KEY[kind]}`);
            return (
              <div key={kind} className="crm-told-row" role="row" data-kind={kind}>
                <div className="crm-told-what" role="cell">
                  <span className="crm-enq-icon" aria-hidden="true">
                    <Icon name={KIND_ICON[kind]} size={15} />
                  </span>
                  <div>
                    <div className="crm-told-label">{name}</div>
                    <div className="crm-told-subline">{t(`told.kind.${KIND_KEY[kind]}.sub`)}</div>
                    {kind === "automation.notice" && (
                      <>
                        <ul className="crm-told-reasons" data-testid="told-reasons">
                          {reasons.map((reason) => (
                            <li key={reason} data-reason={reason}>
                              {t(`told.reason.${reason}`)}
                            </li>
                          ))}
                        </ul>
                        <p className="crm-told-subline" data-testid="told-rules-state">
                          {t(`told.rules.${ruleState(null)}`)}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                <span role="cell">
                  <Switch on={choice.kinds[kind]?.inApp === true} label={t("told.switch.app", { kind: name })} disabled={busy} onChange={(next) => set(kind, "inApp", next)} />
                </span>
                <span role="cell">
                  <Switch on={choice.kinds[kind]?.email === true} label={t("told.switch.email", { kind: name })} disabled={busy} onChange={(next) => set(kind, "email", next)} />
                </span>
              </div>
            );
          })}
          {!mail && (
            <p className="crm-told-nomail" data-testid="told-no-mail">
              <Icon name="triangle-alert" size={14} />
              {t("told.noMail")}
            </p>
          )}
        </div>
      )}

      <div className="crm-told-cards">
        <section className="crm-told-card mr-card" aria-labelledby="crm-told-quiet">
          <h2 id="crm-told-quiet">{t("told.quiet")}</h2>
          <p>{t("told.quiet.body")}</p>
          <div className="crm-told-times">
            <label className="crm-sr" htmlFor="crm-quiet-from">
              {t("told.quiet.from")}
            </label>
            <input id="crm-quiet-from" className="crm-input crm-mono mr-fld" type="time" value={choice.quiet.from} disabled={busy || !choice.quiet.on} onChange={(event) => setChoice((was) => ({ ...was, quiet: { ...was.quiet, from: event.target.value } }))} />
            <span>{t("told.to")}</span>
            <label className="crm-sr" htmlFor="crm-quiet-to">
              {t("told.quiet.until")}
            </label>
            <input id="crm-quiet-to" className="crm-input crm-mono mr-fld" type="time" value={choice.quiet.to} disabled={busy || !choice.quiet.on} onChange={(event) => setChoice((was) => ({ ...was, quiet: { ...was.quiet, to: event.target.value } }))} />
          </div>
          <button type="button" role="switch" aria-checked={choice.quiet.on} className="crm-switch mr-gi" data-testid="quiet-switch" disabled={busy} onClick={() => setChoice((was) => ({ ...was, quiet: { ...was.quiet, on: !was.quiet.on } }))}>
            <span className="crm-switch-track">
              <span className="crm-switch-knob" />
            </span>
            {t(choice.quiet.on ? "told.quiet.on" : "told.quiet.off")}
          </button>
          {mixed && <p className="crm-field-note">{t("told.quiet.mixed")}</p>}
        </section>

        {digest && (
          <section className="crm-told-card mr-card" aria-labelledby="crm-told-digest" data-testid="told-digest">
            <h2 id="crm-told-digest">{t("told.digest")}</h2>
            <p>{t("told.digest.body")}</p>
            <div className="crm-chips" role="group" aria-label={t("told.digest.day")}>
              <button type="button" className="crm-chip-btn mr-chip" aria-pressed={choice.digestTime === null} data-day="rule" disabled={busy} onClick={() => setChoice((was) => ({ ...was, digestDay: null, digestTime: null }))}>
                {t("told.digest.rule")}
              </button>
              {WEEK.map((day) => (
                <button key={day} type="button" className="crm-chip-btn mr-chip" aria-pressed={choice.digestTime !== null && choice.digestDay === day} data-day={day} disabled={busy} onClick={() => setChoice((was) => ({ ...was, digestDay: day, digestTime: was.digestTime ?? "07:00" }))}>
                  {f.weekdayShort(noonOf(`2026-03-0${String(1 + day)}`))}
                </button>
              ))}
            </div>
            <div className="crm-told-times">
              <label className="crm-sr" htmlFor="crm-digest-time">
                {t("told.digest.time")}
              </label>
              <input id="crm-digest-time" className="crm-input crm-mono mr-fld" type="time" value={choice.digestTime ?? ""} disabled={busy || choice.digestTime === null} onChange={(event) => setChoice((was) => ({ ...was, digestTime: event.target.value === "" ? was.digestTime : event.target.value }))} />
              {isBuilt("digest") && (
                <ScreenLink to="digest" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
                  <Icon name="mail" />
                  {t("told.digest.see")}
                </ScreenLink>
              )}
            </div>
            <p className="crm-field-note" data-testid="told-digest-state">
              {t(`digest.state.${ruleState(props.summaries[0])}.body`)}
            </p>
          </section>
        )}
      </div>

      <div className="crm-told-foot">
        <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-testid="told-save" disabled={busy} onClick={() => void save()}>
          <Icon name="check" />
          {busy ? t("ui.saving") : t("told.save")}
        </button>
        {kinds.length > 0 && (
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" data-testid="told-off" disabled={busy} onClick={() => setChoice((was) => ({ ...was, kinds: Object.fromEntries(kinds.map((kind) => [kind, { inApp: false, email: false }])) }))}>
            {t("told.allOff")}
          </button>
        )}
        <span className="crm-told-saved crm-mono" role="status">
          {savedAt === null ? "" : t("told.savedAt", { time: f.time(savedAt) })}
        </span>
      </div>
    </div>
  );
}
