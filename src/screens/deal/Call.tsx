/**
 * CALL NOTES (ledger screen 25): notes taken while on a call about one deal,
 * at the deal's own address (`deals/<id>/call`), reached from its room.
 *
 * Beside the notes: where the deal was left (the last three things logged),
 * the customer's people and the deal's own figures. A line started with a
 * mark ("Next step:", "Decision:", "Objection:", "Blocker:") is picked out
 * under the notes as it is typed; "Log the call" keeps the call on the deal's
 * timeline and makes each next step a follow-up of the writer's, due tomorrow
 * at 10:00 where the business is (`call.ts`).
 *
 * WHO MAY: whoever the server lets log on the deal (its owner, a helper, the
 * person covering, who leads them). Anybody else who reads the deal (Read-only)
 * reads the page with nothing to press; the server refuses the write either
 * way. A deal the server does not answer this reader is "no deal to open".
 *
 * Every figure is the deal's own, kept by the server. The page subtracts the
 * day the deal entered its stage from the server's clock, and counts words.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { appName } from "../../i18n/ambient.ts";
import { addDays, formatters, noonOf } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { callText, chipsOf, logCall, MARK_ICON, MARKS, MAX_NOTES, pickOut, readCall, withLine, wordCount, type CallData, type Mark } from "./call.ts";
import { num } from "./data.ts";
import { NoDeal } from "./Room.tsx";

const MARK_WORD: Record<Mark, MessageKey> = { next: "call.mark.next", decision: "call.mark.decision", objection: "call.mark.objection", blocker: "call.mark.blocker" };
const KIND_WORD: Record<string, MessageKey> = { call: "room.kind.call", email: "room.kind.email", meeting: "room.kind.meeting", note: "room.kind.note" };

export function Call({ id }: { id: string }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const key = Number(id);
  const me = config.user ?? null;
  const endOfToday = f.at(addDays(today, 1), "00:00").toISOString();

  const call = useLoad(() => (Number.isInteger(key) ? readCall(session, key, endOfToday) : Promise.resolve(null)), [session, key, endOfToday]);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      call.reload();
    }, [session, call.reload]),
  );
  useLive(["deals", "activities", "follow_ups"].filter((table) => session.can(table, "read")), again);

  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // One key for the call and one per next step, for as long as the draft is the same: a press after a lost reply makes nothing twice.
  const keys = useRef<{ of: string; call: string; steps: string[] }>({ of: "", call: "", steps: [] });
  const toEnd = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!toEnd.current || el === null) return;
    toEnd.current = false;
    el.setSelectionRange(el.value.length, el.value.length);
  }, [notes]);
  useEffect(() => setNotes(""), [key]);

  const words = useMemo(() => Object.fromEntries(MARKS.map((mark) => [mark, t(MARK_WORD[mark])])) as Record<Mark, string>, [t]);
  const picked = useMemo(() => pickOut(notes, words), [notes, words]);
  const due = f.at(addDays(today, 1), "10:00");

  return (
    <div className="crm-screen crm-call mr-screen" data-screen="call">
      <Loaded load={call.load} reload={again} skeleton={<Skeleton rows={3} height={140} />}>
        {(data) => {
          if (data === null) return <NoDeal />;
          if (data.deal.id !== key) return <Skeleton rows={3} height={140} />;
          return body(data);
        }}
      </Loaded>
    </div>
  );

  // A plain function, not a component: the notes box keeps its focus through every read.
  function body(data: CallData) {
    const { deal } = data;
    const open = deal.state === "open";
    const canLog = open && session.can("activities", "create") && me !== null;
    const canStep = session.can("follow_ups", "create");
    const main = data.people.find((one) => one.id === deal.contact_id) ?? null;
    const mainName = main?.name ?? deal.contact;
    const days = deal.entered_stage_at === null ? 0 : Math.max(0, f.dayDiff(new Date(deal.entered_stage_at), now));
    const chips = chipsOf(data);
    const nexts = canStep ? picked.filter((one) => one.mark === "next") : [];
    const blank = notes.trim() === "";

    const save = async (): Promise<void> => {
      if (blank || me === null || busy) return;
      const text = callText(mainName === null ? null : t("call.opening", { name: mainName }), notes);
      const steps = nexts.map((one) => one.text);
      const of = `${String(deal.id)}:${text}`;
      if (keys.current.of !== of) keys.current = { of, call: newClientKey(), steps: steps.map(() => newClientKey()) };
      setBusy(true);
      const done = await logCall(session, { dealId: deal.id, text, me: me.id, due, steps }, keys.current);
      setBusy(false);
      if (done.call.state !== "saved") {
        await toasts.say(Promise.resolve(done.call), () => "");
        return;
      }
      const missed = done.steps.filter((one) => one.state !== "saved");
      if (missed.length > 0) {
        // The draft and its keys stay: pressing again makes nothing twice (what was made answers as made) and sends the missing steps.
        const first = missed[0]!;
        toasts.show(t("call.toast.stepsNot", { reason: first.state === "refused" ? reasonOf(first.error, t) : t("ui.unknown") }, missed.length), "danger", true);
        again();
        return;
      }
      if (steps.length > 0) {
        toasts.show(t("call.toast.steps", { name: firstName(me.name), day: f.dayShort(due), time: f.time(due) }, steps.length), "pos");
      } else {
        toasts.show(t("call.toast.logged"), "pos");
      }
      keys.current = { of: "", call: "", steps: [] };
      setNotes("");
      again();
    };

    const add = (start: string): void => {
      setNotes((was) => withLine(was, start));
      // Back to the notes at once, so a key pressed next lands there; the caret goes to their end once they are drawn.
      toEnd.current = true;
      box.current?.focus();
    };

    const facts: { label: MessageKey; value: string; tone?: string; testid: string }[] = [
      { label: "room.amount", value: f.money(deal.amount), testid: "call-amount" },
      { label: "call.fact.stage", value: `${deal.stage ?? ""} · ${f.percent(num(deal.stage_odds))}`, tone: "accent", testid: "call-stage" },
      ...(open ? [{ label: "room.fact.sitting" as MessageKey, value: t("room.fact.sitting.days", undefined, days), testid: "call-sitting" }] : []),
      ...(deal.expected_close === null ? [] : [{ label: "room.fact.close" as MessageKey, value: f.date(noonOf(deal.expected_close.slice(0, 10))), testid: "call-close" }]),
    ];

    return (
      <>
        <div className="crm-call-head">
          {canLog && (
            <span className="crm-call-live" data-testid="call-live">
              <span className="crm-call-live-dot" aria-hidden="true" />
              {t("call.live")}
            </span>
          )}
          <div className="crm-call-title">
            <h1>{deal.name}</h1>
            <div className="crm-screen-sub" data-testid="call-sub">
              {[deal.company, mainName === null ? null : t("call.with", { name: mainName }), `${f.dayShort(now)}, ${f.time(now)}`].filter((part) => part !== null && part !== "").join(" · ")}
            </div>
          </div>
          {chips.length > 1 && (
            <nav className="crm-call-chips" aria-label={t("call.queue")}>
              {chips.map((chip) => (
                <ScreenLink key={chip.dealId} to="deal" rest={[chip.dealId, "call"]} className="crm-chip-btn crm-call-chip mr-chip" current={chip.dealId === deal.id}>
                  <span className="crm-call-chip-dot" aria-hidden="true" />
                  {/* The design names a chip by its company; two deals at one company are named by the deal. */}
                  <span className="crm-call-chip-words">{chip.company !== null && chips.filter((one) => one.company === chip.company).length === 1 ? chip.company : (chip.deal ?? "")}</span>
                  {chip.company !== null && chips.filter((one) => one.company === chip.company).length === 1 && <span className="mr-sr-only">{`: ${chip.deal ?? ""}`}</span>}
                </ScreenLink>
              ))}
            </nav>
          )}
        </div>

        <div className="crm-call-grid">
          <div className="crm-call-left">
            <section className="crm-side-card" aria-labelledby="crm-call-last">
              <h2 id="crm-call-last">{t("call.last")}</h2>
              {data.last === null ? (
                <p className="crm-room-quiet">{t("room.activity.notYours")}</p>
              ) : data.last.length === 0 ? (
                <p className="crm-room-quiet">{t("room.activity.none")}</p>
              ) : (
                <ol className="crm-call-last" data-testid="call-last">
                  {data.last.map((one) => (
                    <li key={one.id}>
                      <div className="crm-call-last-head">
                        <span className="crm-call-last-kind">{t(KIND_WORD[one.kind] ?? "room.kind.note")}</span>
                        <span className="crm-mono crm-call-last-when">{`${f.dayShort(new Date(one.at))}, ${f.time(new Date(one.at))}`}</span>
                      </div>
                      <p>{one.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="crm-call-main">
            {canLog ? (
              <form
                className="crm-call-notes"
                aria-label={t("call.notes")}
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <div className="crm-call-marks">
                  <span className="crm-call-marks-label" id="crm-call-marks">
                    {t("call.marks")}
                  </span>
                  <div className="crm-chips" role="group" aria-labelledby="crm-call-marks">
                    {MARKS.map((mark) => (
                      <button key={mark} type="button" className="crm-chip-btn crm-call-mark mr-chip" disabled={busy} onClick={() => add(`${words[mark]}: `)}>
                        <Icon name={MARK_ICON[mark]} size={13} />
                        {words[mark]}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="mr-sr-only" htmlFor="crm-call-text">
                  {t("call.notes")}
                </label>
                <textarea
                  id="crm-call-text"
                  ref={box}
                  className="crm-call-text mr-fld"
                  value={notes}
                  maxLength={MAX_NOTES}
                  disabled={busy}
                  placeholder={t("call.placeholder", { next: words.next, decision: words.decision, objection: words.objection, blocker: words.blocker })}
                  onChange={(event) => setNotes(event.target.value)}
                />
                <div className="crm-call-foot">
                  <span className="crm-mono crm-call-words" data-testid="call-words">
                    {t("call.words", undefined, wordCount(notes))}
                  </span>
                  <span className="crm-pill crm-mono" data-tone={picked.length > 0 ? "accent" : "plain"} data-testid="call-items">
                    {t("call.items", undefined, picked.length)}
                  </span>
                  <span className="crm-call-foot-end">
                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" disabled={busy || blank} onClick={() => setNotes("")}>
                      {t("call.clear")}
                    </button>
                    <button type="submit" className="crm-btn crm-btn-primary crm-btn-38 mr-btn" disabled={busy || blank}>
                      <Icon name="check" size={16} />
                      {t("call.log")}
                    </button>
                  </span>
                </div>
              </form>
            ) : (
              <div className="crm-call-notes crm-call-readonly" data-testid="call-readonly">
                <Icon name="lock" size={16} />
                <p>{t(open ? "call.readOnly" : "room.closed.readOnly")}</p>
              </div>
            )}

            {canLog && picked.length > 0 && (
              <section className="crm-call-picked" aria-labelledby="crm-call-picked" data-testid="call-picked">
                <div className="crm-call-picked-head">
                  <h2 id="crm-call-picked">{t("call.picked")}</h2>
                  <span>{t(canStep ? "call.picked.note" : "call.picked.noSteps")}</span>
                </div>
                <ul>
                  {picked.map((one) => (
                    <li key={one.key} data-mark={one.mark}>
                      <span className="crm-pill" data-tone={one.mark === "next" ? "accent" : one.mark === "decision" ? "pos" : one.mark === "objection" ? "warn" : "danger"}>
                        {words[one.mark]}
                      </span>
                      <span className="crm-call-picked-text">{one.text}</span>
                      {one.mark === "next" && canStep && <span className="crm-mono crm-call-picked-when">{`${f.dayShort(due)}, ${f.time(due)}`}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="crm-call-rail">
            <section className="crm-side-card" aria-labelledby="crm-call-people">
              <h2 id="crm-call-people">{t("call.people")}</h2>
              <ul className="crm-call-people">
                {data.people.map((person) => (
                  <li key={person.id} className="crm-room-person">
                    <span className="crm-avatar" aria-hidden="true">
                      {initials(person.name)}
                    </span>
                    <span className="crm-room-person-words">
                      <span className="crm-room-person-name">{person.name}</span>
                      {person.job_title !== null && <span className="crm-room-person-sub">{person.job_title}</span>}
                    </span>
                    {person.id === deal.contact_id && (
                      <span className="crm-pill" data-tone="accent">
                        {t("room.people.main")}
                      </span>
                    )}
                  </li>
                ))}
                {me !== null && (
                  <li className="crm-room-person">
                    <span className="crm-avatar" aria-hidden="true">
                      {initials(me.name)}
                    </span>
                    <span className="crm-room-person-words">
                      <span className="crm-room-person-name">{me.name}</span>
                      <span className="crm-room-person-sub">{appName() ?? t("call.us")}</span>
                    </span>
                  </li>
                )}
              </ul>
            </section>
            <section className="crm-side-card" aria-labelledby="crm-call-deal">
              <h2 id="crm-call-deal">{t("call.deal")}</h2>
              <dl className="crm-facts-list crm-room-facts">
                {facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{t(fact.label)}</dt>
                    <dd className="crm-mono" data-tone={fact.tone ?? "plain"} data-testid={fact.testid}>
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <ScreenLink to="deal" rest={[deal.id]} className="crm-btn crm-btn-ghost crm-btn-38 crm-btn-wide mr-gi">
                <Icon name="panel-right-open" size={14} />
                {t("room.open")}
              </ScreenLink>
            </section>
          </aside>
        </div>
      </>
    );
  }
}

