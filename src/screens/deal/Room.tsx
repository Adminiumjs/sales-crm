/**
 * THE DEAL ROOM: one deal, at an address of its own (`deals/<id>`).
 *
 * An OPEN deal is worked here: its amount (typed, until a quote is sent; then
 * the quote's, before tax), its stage, what was logged and what changed, who
 * is on it, the customer's people, its quote. A CLOSED deal is the same page
 * with nothing to change: how it ended, and "Reopen" for whoever may.
 *
 * WHAT CAN BE DONE is asked of the server every time; this page only leaves a
 * control out when pressing it could not work (the person's role has no such
 * right, or the deal is closed). A change of stage names the stage it was seen
 * in, so a deal a colleague moved meanwhile is not moved again from here: the
 * server refuses, the page says so and reads the deal back.
 *
 * WHO ADDS UP: nobody here. The amount, the weighted value and the odds are
 * the deal's own columns, kept by the server; the open threads are its count.
 * The page subtracts "entered this stage" from the server's clock.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEAL_AMOUNT_EVENT, DEAL_CLOSE_EVENT, roomCan } from "../../finding/shortcuts.ts";
import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { addDays, formatters, noonOf } from "../../lib/format.ts";
import { AccountLink } from "../../selling/AccountLink.tsx";
import { useDealActions } from "../../selling/actions.tsx";
import { scopeOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import { canOpen, rolesOf, type MenuFacts, type PartId, type RoleKey } from "../../shell/routes.ts";
import { isBuilt } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { createQuote, families, familyNo, held, newest, readNames, stateOf, TONE } from "../quotes/data.ts";
import { coverPhase, num, readFixed, readRoom, readSide, readTimeline, sittingOf, timelineOf, type Activity, type Deal, type Fixed, type Line, type Member, type RoomData, type Side, type Stage } from "./data.ts";

const KINDS: readonly Activity["kind"][] = ["call", "email", "meeting", "note"];
const KIND_ICON: Record<Activity["kind"], string> = { call: "phone", email: "mail", meeting: "calendar-days", note: "sticky-note" };

export function useMenuFacts(): MenuFacts {
  const session = useSession();
  const config = session.config;
  return useMemo<MenuFacts>(() => ({ roles: (config.access?.roles ?? []).map((role) => role.slug), part: (part: PartId) => session.part(part), reads: (table) => session.can(table, "read"), built: isBuilt }), [config, session]);
}

/** "No deal to open": not there, or not this reader's. The server answers the two alike, and so does the page. */
export function NoDeal() {
  const t = useT();
  return (
    <div className="crm-empty crm-quote-none" data-testid="no-deal">
      <span className="crm-empty-icon">
        <Icon name="file-question" size={22} />
      </span>
      <div className="crm-empty-title">{t("room.none")}</div>
      <p>{t("room.none.body")}</p>
    </div>
  );
}

/** The roles that read what was logged on every deal they open. The account manager reads it only on a deal he is on. */
const READS_EVERY_HISTORY: readonly RoleKey[] = ["admin", "sales-manager", "rep", "read-only"];

export function Room({ id }: { id: string }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const nav = useNav();
  const toasts = useToasts();
  const actions = useDealActions();
  const facts = useMenuFacts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const key = Number(id);
  const me = config.user?.id ?? null;
  const team = useMemo(() => scopeOf(session) === "team", [session]);

  const fixed = useMemo(() => readFixed(session), [session]);
  const room = useLoad(() => (Number.isInteger(key) ? Promise.all([readRoom(session, key, today), fixed]).then(([data, rest]) => (data === null ? null : { ...data, fixed: rest })) : Promise.resolve(null)), [session, key, today, fixed, actions.changed]);
  const timeline = useLoad(() => (Number.isInteger(key) ? readTimeline(session, key) : Promise.resolve(null)), [session, key, actions.changed]);
  const companyId = room.load.state === "ready" && room.load.data !== null ? room.load.data.deal.company_id : null;
  const side = useLoad<Side | null>(() => (companyId === null ? Promise.resolve(null) : readSide(session, companyId)), [session, companyId]);

  // A save's own "read again" and the live frame it sets off are one read.
  const againRoom = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      room.reload();
    }, [session, room.reload]),
  );
  const againTimeline = useCoalesced(timeline.reload);
  const reads = useCallback((tables: string[]): string[] => tables.filter((table) => session.can(table, "read") && (table !== "quotes" || session.part("quotes"))), [session]);
  useLive(reads(["deals", "deal_members", "quotes", "comments", "cover_notes"]), againRoom);
  useLive(reads(["deals", "activities", "deal_stage_changes", "deal_amount_changes"]), againTimeline);
  // A member taken off is read from the deal's removed people: only when somebody is, not on every change of the room.
  const againOff = useCoalesced(timeline.reload);
  useLive(reads(["deal_members"]), againOff);
  /*
   * THE AMOUNT A QUOTE WAS SENT AT is a line the app's rule writes, once the
   * sending can no longer be undone: a minute after it. The server tells a
   * person held to their own deals nothing of a rule's write, so after a quote
   * of this deal changes, the timeline is read again when that minute is up,
   * and once more a little later.
   */
  const echoes = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reloadTimeline = timeline.reload;
  const echo = useCallback(() => {
    for (const timer of echoes.current) clearTimeout(timer);
    echoes.current = [66_000, 95_000].map((ms) => setTimeout(reloadTimeline, ms));
  }, [reloadTimeline]);
  useEffect(
    () => () => {
      for (const timer of echoes.current) clearTimeout(timer);
    },
    [],
  );
  useLive(reads(["quotes"]), echo);
  // A deal opened moments after a quote of it was sent: the rule's line is still on its way.
  const opened = useRef<number | null>(null);
  useEffect(() => {
    const data = room.load.state === "ready" ? room.load.data : null;
    if (data === null || data.deal.id !== key || opened.current === key) return;
    opened.current = key;
    const at = session.now().getTime();
    if (data.quotes.some((quote) => quote.sent_at !== null && Math.abs(at - new Date(quote.sent_at).getTime()) < 90_000)) echo();
  }, [room.load, key, session, echo]);
  const again = useCallback(() => {
    againRoom();
    againTimeline();
  }, [againRoom, againTimeline]);

  // Everybody the page names, by id. Asked once the deal is read: its owner, who is on it, who logged.
  const ids = useMemo(() => {
    const data = room.load.state === "ready" ? room.load.data : null;
    const lines = timeline.load.state === "ready" && timeline.load.data !== null ? timeline.load.data : null;
    if (data === null) return "";
    return [...new Set([data.deal.owner_id, ...data.members.map((member) => member.user_id), ...data.fixed.reps, data.cover?.cover_id ?? null, ...(lines === null ? [] : [...lines.activities.map((one) => one.author_id), ...lines.stageChanges.map((one) => one.by_id)])].filter((one): one is string => one !== null))].sort().join(",");
  }, [room.load, timeline.load]);
  const names = useLoad(() => readNames(session, ids === "" ? [] : ids.split(",")), [session, ids]);
  const nameOf = useCallback((userId: string | null): string => (userId === null ? "" : ((names.load.state === "ready" ? names.load.data[userId] : undefined) ?? t("closed.someone"))), [names.load, t]);

  const [busy, setBusy] = useState(false);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  // Leaving the amount's field (saved, or not) gives the focus back to the button that opened it.
  const pencil = useRef<HTMLButtonElement>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (amountDraft !== null) editing.current = true;
    else if (editing.current && !busy) {
      editing.current = false;
      pencil.current?.focus();
    }
  }, [amountDraft, busy]);
  const [kind, setKind] = useState<Activity["kind"]>("call");
  const [text, setText] = useState("");
  const [next, setNext] = useState(false);
  const [adding, setAdding] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  // One key per thing saved: sent again after a lost reply it answers the row the first one made. A changed draft is another save.
  const keys = useRef<{ of: string; activity: string; step: string }>({ of: "", activity: "", step: "" });
  // `E`, heard by the frame (`finding/Finding.tsx`): open the amount's field, when it may be changed here.
  const amountKey = useRef<(() => void) | null>(null);
  // Jump's "Close this deal…": the same dialog as the room's own Close button.
  const closeKey = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onAmount = (): void => amountKey.current?.();
    const onClose = (): void => closeKey.current?.();
    window.addEventListener(DEAL_AMOUNT_EVENT, onAmount);
    window.addEventListener(DEAL_CLOSE_EVENT, onClose);
    return () => {
      window.removeEventListener(DEAL_AMOUNT_EVENT, onAmount);
      window.removeEventListener(DEAL_CLOSE_EVENT, onClose);
      roomCan.amount = false;
      roomCan.close = false;
    };
  }, []);
  useEffect(() => {
    setAmountDraft(null);
    setText("");
    setNext(false);
    setAdding(false);
    setNoteDraft(null);
  }, [key]);

  const back = (open: boolean) => {
    const to = open && canOpen("pipeline", facts) ? "pipeline" : canOpen("archive", facts) ? "archive" : canOpen("pipeline", facts) ? "pipeline" : null;
    if (to === null) return null;
    return (
      <ScreenLink to={to} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
        <Icon name="chevron-left" size={14} className="crm-flip" />
        {t(to === "pipeline" ? "room.back.board" : "room.back.closed")}
      </ScreenLink>
    );
  };

  return (
    <div className="crm-screen crm-room mr-screen" data-screen="deal">
      <Loaded load={room.load} reload={again} skeleton={<Skeleton rows={4} height={110} />}>
        {(data) => {
          if (data === null) {
            return (
              <>
                {back(true)}
                <NoDeal />
              </>
            );
          }
          // The address moved to another deal and its read is still on its way.
          if (data.deal.id !== key) return <Skeleton rows={4} height={110} />;
          return body({
            data,
            side: side.load.state === "ready" ? side.load.data : null,
            lines: timeline.load.state === "ready" && timeline.load.data !== null ? timelineOf(timeline.load.data, data.members) : null,
            timelineFailed: timeline.load.state === "failed" || timeline.load.state === "refused",
            back: back(data.deal.state === "open"),
          });
        }}
      </Loaded>
    </div>
  );

  // A plain function, not a component: the page keeps one tree, so a field being typed in keeps its focus through every read.
  function body({ data, side: its, lines, timelineFailed, back: backLink }: { data: RoomData & { fixed: Fixed }; side: Side | null; lines: Line[] | null; timelineFailed: boolean; back: React.ReactNode }) {
    const { deal, members } = data;
    const stages = data.fixed.stages;
    const stage = stages.find((one) => one.id === deal.stage_id) ?? null;
    const stageName = (stageId: number | null): string => (stageId === null ? "" : (stages.find((one) => one.id === stageId)?.label ?? ""));
    const open = deal.state === "open";
    const owner = nameOf(deal.owner_id);
    const mine = deal.owner_id !== null && deal.owner_id === me;
    // What was logged and said on a deal: every deal's for the roles that read every deal they open; the account manager's only
    // on a deal he is on (P23). On a won deal he only reads, neither is his: an empty list must not say "nothing", and the
    // comments are not offered.
    const onDeal = mine || members.some((member) => member.user_id === me);
    const readsAll = onDeal || rolesOf((config.access?.roles ?? []).map((role) => role.slug)).some((role) => READS_EVERY_HISTORY.includes(role));
    const readsLines = session.can("activities", "read") && readsAll;
    const canWork = open && session.can("deals", "update");
    const canLog = open && session.can("activities", "create");
    // Somebody is added by the deal's owner or by who leads her; a helper and a covering rep add nobody (the server holds it).
    const canList = open && (mine || team);
    const canAdd = canList && session.can("deal_members", "create");
    const canRemove = canList && session.can("deal_members", "delete");
    // The account manager reads a deal's quotes only while he is on it: on a won deal he only reads, no quote card says "none".
    const quotesOn = session.part("quotes") && session.can("quotes", "read") && readsAll;
    const family = families(data.quotes).sort((a, b) => newest(b).id - newest(a).id)[0] ?? null;
    const sent = data.quotes.find((quote) => quote.id === deal.quote_id) ?? null;
    const fromQuote = deal.quoted_amount !== null;
    const days = deal.entered_stage_at === null ? 0 : Math.max(0, f.dayDiff(new Date(deal.entered_stage_at), now));
    const sitting = sittingOf(days, data.fixed);
    const dayOf = (value: string | null): string => (value === null ? "" : f.date(noonOf(value.slice(0, 10))));
    const when = (at: number): string => `${f.dayShort(new Date(at))}, ${f.time(new Date(at))}`;
    const nextWhen = f.at(addDays(today, 1), "10:00");

    const save = async (work: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      await work();
      setBusy(false);
      again();
    };

    const move = (to: Stage) =>
      to.id === deal.stage_id
        ? Promise.resolve()
        : save(() =>
            toasts.say(session.update<Deal>("deals", deal.id, { stage_id: to.id }, { seen: { stage_id: deal.stage_id, state: "open" } }), (row) => t("board.toast.moved", { deal: deal.name, stage: to.label, amount: f.money(row.weighted_value) })),
          );

    const saveAmount = () => {
      const typed = f.readAmount(amountDraft ?? "");
      if (typed === null || typed === num(deal.amount)) {
        setAmountDraft(null);
        toasts.show(t(typed === null ? "room.amount.notRead" : "room.amount.same"));
        return Promise.resolve();
      }
      return save(async () => {
        const done = await toasts.say(session.update<Deal>("deals", deal.id, { typed_amount: typed }, { seen: { typed_amount: deal.typed_amount } }), (row) => t("room.amount.toast", { amount: f.money(row.amount) }));
        if (done !== null) setAmountDraft(null);
      });
    };

    const log = () => {
      const words = text.trim();
      if (words === "" || me === null) return Promise.resolve();
      const of = `${kind}:${next ? "1" : "0"}:${words}`;
      if (keys.current.of !== of) keys.current = { of, activity: newClientKey(), step: newClientKey() };
      return save(async () => {
        const logged = await session.create("activities", { deal_id: deal.id, kind, text: words }, keys.current.activity);
        if (logged.state !== "saved") {
          await toasts.say(Promise.resolve(logged), () => "");
          return;
        }
        if (!next) {
          toasts.show(t("room.log.toast", { kind: t(`room.kind.${kind}` as MessageKey) }), "pos");
        } else {
          const step = await session.create("follow_ups", { deal_id: deal.id, owner_id: me, due_at: nextWhen.toISOString(), text: words.slice(0, 400), kind: "step" }, keys.current.step);
          if (step.state === "saved") toasts.show(t("room.log.toast.next", { day: f.dayShort(nextWhen), time: f.time(nextWhen) }), "pos");
          else toasts.show(t("room.log.toast.stepNot", { reason: step.state === "refused" ? reasonOf(step.error, t) : t("ui.unknown") }), "danger", true);
        }
        keys.current = { of: "", activity: "", step: "" };
        setText("");
        setNext(false);
      });
    };

    const add = (userId: string) =>
      save(async () => {
        const name = nameOf(userId);
        const saved = await session.create<Member>("deal_members", { deal_id: deal.id, user_id: userId }, newClientKey());
        // The server lists nobody who could not open the deal: said in those words, not as a field's code.
        if (saved.state === "refused" && saved.error.fields["user_id"] === "cannot-open") toasts.show(t("room.on.cannotOpen", { name }), "danger", true);
        else if ((await toasts.say(Promise.resolve(saved), () => t("room.on.toast.added", { name: firstName(name), owner: firstName(owner) }))) !== null) setAdding(false);
      });
    const takeOff = (member: Member) => save(() => toasts.say(session.remove("deal_members", member.id), () => t("room.on.toast.removed", { name: nameOf(member.user_id) })));

    const startQuote = () =>
      save(async () => {
        const { saved } = await createQuote(session, { deal_id: deal.id, ...(deal.contact_id === null ? {} : { sent_to_contact_id: deal.contact_id }) }, [{ description: deal.name, qty: 1, rate: num(deal.typed_amount ?? deal.amount) }]);
        const made = await toasts.say(Promise.resolve(saved), (row) => t("quotes.toast.started", { number: row.number ?? "" }));
        if (made !== null) nav.go("quotes", made.id);
      });

    const reopen = () => save(() => toasts.say(session.act<Deal>("deals", deal.id, "reopen", deal.state), () => t("room.closed.toast.reopened", { deal: deal.name, stage: stage?.label ?? "" })));

    const saveNote = () => {
      const words = (noteDraft ?? "").trim();
      if (data.cover === null || words === "") return Promise.resolve();
      const covering = firstName(nameOf(data.cover.cover_id));
      return save(async () => {
        const saved = data.coverNote === null ? session.create("cover_notes", { cover_id: data.cover!.id, deal_id: deal.id, text: words }, newClientKey()) : session.update("cover_notes", data.coverNote.id, { text: words });
        if ((await toasts.say(saved, () => t("room.cover.toast", { name: covering }))) !== null) setNoteDraft(null);
      });
    };

    const lineText = (line: Line): { label: string; who: string; text: string; icon: string; tone: string } => {
      if (line.type === "activity") return { label: t(`room.kind.${line.kind}` as MessageKey), who: nameOf(line.who), text: line.text, icon: KIND_ICON[line.kind], tone: line.kind === "call" ? "info" : line.kind === "meeting" ? "warn" : "plain" };
      if (line.type === "stage") return { label: t("room.line.stage"), who: line.whoLabel ?? nameOf(line.who), text: line.from === null ? t("room.line.opened", { stage: stageName(line.to) }) : t("room.line.moved", { from: stageName(line.from), to: stageName(line.to) }), icon: "move-right", tone: "accent" };
      if (line.type === "member") {
        const name = nameOf(line.person);
        const by = line.byLabel ?? (line.by === null ? "" : nameOf(line.by));
        const text = line.off ? t("rm.line.off", { name, by }) : by === "" ? t("rm.line.added.bare", { name }) : t("rm.line.added", { name, by });
        return { label: t("rm.line.label"), who: "", text, icon: line.off ? "circle-slash" : "user-round-plus", tone: "plain" };
      }
      if (line.type === "quoted") return { label: t("room.line.change"), who: "", text: line.quote === null ? t("room.line.quoted.bare", { amount: f.money(line.amount) }) : t("room.line.quoted", { amount: f.money(line.amount), number: line.quote }), icon: "history", tone: "accent" };
      const change = line.change;
      const words = ((): string => {
        switch (change.column) {
          case "typed_amount":
            return change.before === null ? t("room.line.amount.set", { to: f.money(change.after) }) : t("room.line.amount", { from: f.money(change.before), to: f.money(change.after) });
          case "owner_id":
            return t("room.line.owner", { from: nameOf(change.before), to: nameOf(change.after) });
          case "expected_close":
            return change.after === null ? t("room.line.close.none") : change.before === null ? t("room.line.close.set", { to: dayOf(change.after) }) : t("room.line.close", { from: dayOf(change.before), to: dayOf(change.after) });
          case "name":
            return t("room.line.name", { from: change.before, to: change.after });
          case "contact_id":
            return t("room.line.contact", { name: its?.contacts.find((one) => one.id === change.after)?.name ?? "" });
          case "scope":
            return t("room.line.scope");
          case "state": {
            if (change.after === "won") return `${t("room.line.won")}${change.note === null ? "" : ` ${t("room.line.note", { note: change.note })}`}`;
            if (change.after === "lost") {
              const reason = change.reasonId !== null && change.reasonId === deal.lost_reason_id ? deal.lost_reason : null;
              return `${reason === null ? t("room.line.lost.bare") : t("room.line.lost", { reason })}${change.note === null ? "" : ` ${t("room.line.note", { note: change.note })}`}`;
            }
            return t("room.line.reopened");
          }
        }
      })();
      return { label: t("room.line.change"), who: line.whoLabel ?? "", text: words, icon: "history", tone: "accent" };
    };

    const newestQuote = family === null ? null : newest(family);
    const has = family === null ? null : held(family);
    const quoteState = family === null || newestQuote === null ? null : stateOf(newestQuote, family, today);
    amountKey.current = canWork && !fromQuote && !busy ? () => setAmountDraft((was) => was ?? String(num(deal.amount))) : null;
    closeKey.current = canWork && !busy ? () => actions.close({ id: deal.id, name: deal.name, company: deal.company, amount: f.money(deal.amount) }) : null;
    roomCan.amount = canWork && !fromQuote;
    roomCan.close = canWork;
    const pool = data.fixed.reps.filter((userId) => userId !== deal.owner_id && !members.some((member) => member.user_id === userId));
    const coverCard = data.cover !== null && coverPhase(data.cover, today) !== "over" ? data.cover : null;
    const coverMine = coverCard !== null && coverCard.owner_id === me && session.can("cover_notes", "create") && open;

    return (
      <>
        {backLink}
        <section className="crm-room-head" aria-label={t("room.head")}>
          <div className="crm-room-top">
            <div className="crm-room-title">
              <h1>{deal.name}</h1>
              <div className="crm-room-who">
                {deal.company !== null && (
                  <span className="crm-room-pill">
                    <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                      {initials(deal.company)}
                    </span>
                    <AccountLink to="companies" id={deal.company_id}>
                      {deal.company}
                    </AccountLink>
                  </span>
                )}
                {deal.owner_id !== null && (
                  <span className="crm-room-pill" data-quiet="1" data-testid="room-owner">
                    <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                      {initials(owner)}
                    </span>
                    {owner}
                  </span>
                )}
                {!open && (
                  <span className="crm-pill" data-tone={deal.state === "won" ? "pos" : "danger"} data-testid="room-state">
                    {t(deal.state === "won" ? "deal.close.won" : "deal.close.lost")}
                  </span>
                )}
              </div>
            </div>
            <div className="crm-room-amount">
              <div className="crm-room-amount-label">
                {t("room.amount")}
                {fromQuote && sent !== null && (
                  <span className="crm-room-amount-source" data-testid="room-amount-source">
                    {" "}
                    · {t("room.amount.from", { quote: `${sent.family_no ?? sent.number ?? ""} ${t("quotes.version.short", { n: sent.version })}` })}
                    {num(sent.tax_rate) > 0 ? ` · ${t("room.amount.beforeTax")}` : ""}
                  </span>
                )}
              </div>
              {amountDraft === null ? (
                canWork && !fromQuote ? (
                  <button type="button" ref={pencil} className="crm-room-amount-edit mr-gi" aria-label={t("room.amount.change", { amount: f.money(deal.amount) })} disabled={busy} onClick={() => setAmountDraft(String(num(deal.amount)))}>
                    <span className="crm-mono crm-room-amount-value" data-testid="room-amount">
                      {f.money(deal.amount)}
                    </span>
                    <Icon name="pencil" size={14} />
                  </button>
                ) : (
                  <div className="crm-room-amount-plain">
                    <span className="crm-mono crm-room-amount-value" data-testid="room-amount">
                      {f.money(deal.amount)}
                    </span>
                  </div>
                )
              ) : (
                <form
                  className="crm-room-amount-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveAmount();
                  }}
                >
                  <input className="crm-input crm-input-plain crm-mono mr-fld" inputMode="decimal" autoFocus aria-label={t("room.amount")} value={amountDraft} disabled={busy} onChange={(event) => setAmountDraft(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setAmountDraft(null)} />
                  <button type="submit" className="crm-btn crm-btn-primary crm-btn-38 mr-btn" disabled={busy}>
                    {t("room.amount.save")}
                  </button>
                  <button type="button" className="crm-icon-btn mr-gi" aria-label={t("ui.cancel")} disabled={busy} onClick={() => setAmountDraft(null)}>
                    <Icon name="x" size={15} />
                  </button>
                </form>
              )}
              {open && (
                <div className="crm-room-weighted" data-testid="room-weighted">
                  {t("room.weighted.at", { amount: f.money(deal.weighted_value), odds: f.percent(num(deal.stage_odds)) })}
                </div>
              )}
            </div>
          </div>

          {!open && (
            <div className="crm-banner" role="status" data-tone={deal.state === "won" ? "pos" : "danger"} data-testid="room-closed">
              {deal.state === "won"
                ? t("room.closed.won", { day: dayOf(deal.closed_on) })
                : deal.lost_reason === null
                  ? t("room.closed.lost.bare", { day: dayOf(deal.closed_on), stage: stage?.label ?? "" })
                  : t("room.closed.lost", { day: dayOf(deal.closed_on), stage: stage?.label ?? "", reason: deal.lost_reason })}
              {deal.cycle_days !== null && ` ${t("room.closed.days", undefined, num(deal.cycle_days))}`}
              {deal.close_note !== null && <span className="crm-room-closed-note"> “{deal.close_note}”</span>} {t("room.closed.readOnly")}
            </div>
          )}

          <ol className="crm-room-steps" aria-label={t("room.steps")}>
            {stages.map((one, index) => {
              const on = one.id === deal.stage_id;
              const past = stage !== null && one.position < stage.position;
              const inner = (
                <>
                  <span className="crm-room-step-no crm-mono">{f.number(index + 1)}</span>
                  <span className="crm-room-step-words">
                    <span className="crm-room-step-name">{one.label}</span>
                    <span className="crm-room-step-odds crm-mono">{f.percent(num(one.odds))}</span>
                  </span>
                </>
              );
              return (
                <li key={one.id}>
                  {canWork ? (
                    <button type="button" className="crm-room-step mr-btn" data-on={on ? "1" : "0"} data-past={past ? "1" : "0"} aria-current={on ? "step" : undefined} disabled={busy} onClick={() => void move(one)}>
                      {inner}
                    </button>
                  ) : (
                    <span className="crm-room-step" data-on={on ? "1" : "0"} data-past={past ? "1" : "0"} aria-current={on ? "step" : undefined}>
                      {inner}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="crm-room-bar">
            {deal.expected_close !== null && (
              <span className="crm-room-close-on">
                <Icon name="calendar-clock" size={15} />
                {t("room.fact.close")}
                <span className="crm-mono">{dayOf(deal.expected_close)}</span>
              </span>
            )}
            <div className="crm-room-bar-end">
              {session.can("comments", "read") && readsAll && (
                <ScreenLink to="deal" rest={[deal.id, "comments"]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                  <Icon name="message-square" size={14} />
                  {t("room.comments")}
                  {data.openThreads !== null && data.openThreads > 0 && (
                    <span className="crm-pill crm-mono" data-tone="accent" data-testid="room-open-threads">
                      {f.number(data.openThreads)}
                    </span>
                  )}
                </ScreenLink>
              )}
              {canLog && (
                <ScreenLink to="deal" rest={[deal.id, "call"]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                  <Icon name="phone" size={14} />
                  {t("room.call")}
                </ScreenLink>
              )}
              {canWork && (mine || team) && canOpen("handover", facts) && (
                <ScreenLink to="handover" rest={[deal.id]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                  <Icon name="arrow-right-left" size={14} />
                  {t("room.handOver")}
                </ScreenLink>
              )}
              {canWork && (
                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-btn" disabled={busy} onClick={() => actions.close({ id: deal.id, name: deal.name, company: deal.company, amount: f.money(deal.amount) })}>
                  <Icon name="handshake" size={14} />
                  {t("board.look.close")}
                </button>
              )}
              {!open && session.can("deals", "update") && (
                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-btn" disabled={busy} onClick={() => void reopen()}>
                  <Icon name="rotate-ccw" size={14} />
                  {t("room.closed.reopen")}
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="crm-room-grid">
          <div className="crm-room-main">
            <section className="crm-room-activity" aria-label={t("room.activity")}>
              <div className="crm-room-activity-head">
                <h2>{t("room.activity")}</h2>
                {lines !== null && (
                  <span className="crm-pill crm-mono" data-testid="room-lines">
                    {f.number(lines.length)}
                  </span>
                )}
                <span className="crm-room-activity-order">{t("room.activity.newest")}</span>
              </div>
              {lines === null ? (
                timelineFailed ? (
                  <p className="crm-room-quiet" role="alert">
                    {t("ui.loadFailed")}
                  </p>
                ) : (
                  <Skeleton rows={3} height={54} />
                )
              ) : lines.length === 0 ? (
                <p className="crm-room-quiet" data-testid="room-no-lines">
                  {t(readsLines ? "room.activity.none" : "room.activity.notYours")}
                </p>
              ) : (
                <ol className="crm-room-lines">
                  {lines.map((line) => {
                    const shown = lineText(line);
                    return (
                      <li key={line.key} className="crm-room-line" data-type={line.type === "activity" ? line.kind : line.type}>
                        <span className="crm-room-line-mark" data-tone={shown.tone}>
                          <Icon name={shown.icon} size={14} />
                        </span>
                        <div className="crm-room-line-body">
                          <div className="crm-room-line-head">
                            <span className="crm-room-line-label">{shown.label}</span>
                            {shown.who !== "" && (
                              <>
                                <span className="crm-room-line-dot" aria-hidden="true" />
                                <span className="crm-room-line-who">{shown.who}</span>
                              </>
                            )}
                            <span className="crm-room-line-when crm-mono">{line.type === "member" && line.dayOnly ? f.dayShort(new Date(line.at)) : when(line.at)}</span>
                          </div>
                          <p>{shown.text}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {canLog && (
              <form
                className="crm-room-composer"
                aria-label={t("room.log")}
                onSubmit={(event) => {
                  event.preventDefault();
                  void log();
                }}
              >
                <div className="crm-chips" role="radiogroup" aria-label={t("room.log.kind")}>
                  {KINDS.map((one) => (
                    <button key={one} type="button" role="radio" aria-checked={kind === one} className="crm-chip-btn crm-room-kind mr-chip" data-on={kind === one ? "1" : "0"} disabled={busy} onClick={() => setKind(one)}>
                      <Icon name={KIND_ICON[one]} size={14} />
                      {t(`room.kind.${one}` as MessageKey)}
                    </button>
                  ))}
                </div>
                <textarea className="crm-input crm-textarea mr-fld" aria-label={t("room.log.what")} value={text} maxLength={4000} disabled={busy} placeholder={t(`room.log.hint.${kind}` as MessageKey)} onChange={(event) => setText(event.target.value)} />
                <div className="crm-room-composer-foot">
                  {session.can("follow_ups", "create") && (
                    <button type="button" role="switch" aria-checked={next} className="crm-switch mr-gi" disabled={busy} onClick={() => setNext((was) => !was)}>
                      <span className="crm-switch-track">
                        <span className="crm-switch-knob" />
                      </span>
                      {t("room.log.next")}
                    </button>
                  )}
                  {next && (
                    <span className="crm-room-next-when" data-testid="room-next-when">
                      <Icon name="clock" size={14} />
                      <span className="crm-mono">
                        {f.dayShort(nextWhen)}, {f.time(nextWhen)}
                      </span>
                    </span>
                  )}
                  <button type="submit" className="crm-btn crm-btn-primary crm-btn-38 crm-room-log mr-btn" disabled={busy || text.trim() === ""}>
                    <Icon name="plus" size={15} />
                    {t("room.log")}
                  </button>
                </div>
              </form>
            )}
          </div>

          <aside className="crm-room-side">
            <section className="crm-side-card" aria-label={t("room.facts")}>
              <h2>{t("room.facts")}</h2>
              <dl className="crm-facts-list crm-room-facts">
                <div>
                  <dt>{t("room.amount")}</dt>
                  <dd className="crm-mono">{f.money(deal.amount)}</dd>
                </div>
                {open ? (
                  <>
                    <div>
                      <dt>{t("room.fact.weighted")}</dt>
                      <dd className="crm-mono" data-tone="accent">
                        {f.money(deal.weighted_value)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("room.fact.odds")}</dt>
                      <dd className="crm-mono">{f.percent(num(deal.stage_odds))}</dd>
                    </div>
                    <div>
                      <dt>{t("room.fact.sitting")}</dt>
                      <dd className="crm-mono" data-tone={sitting === "stale" ? "danger" : sitting === "warm" ? "warn" : "plain"} data-testid="room-sitting">
                        {t(sitting === "stale" ? "room.fact.sitting.stale" : sitting === "warm" ? "room.fact.sitting.warm" : "room.fact.sitting.days", undefined, days)}
                      </dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>{t("room.fact.stage")}</dt>
                    <dd>{stage?.label ?? ""}</dd>
                  </div>
                )}
                {deal.opened_on !== null && (
                  <div>
                    <dt>{t("room.fact.opened")}</dt>
                    <dd className="crm-mono">{dayOf(deal.opened_on)}</dd>
                  </div>
                )}
                {open
                  ? deal.expected_close !== null && (
                      <div>
                        <dt>{t("room.fact.close")}</dt>
                        <dd className="crm-mono">{dayOf(deal.expected_close)}</dd>
                      </div>
                    )
                  : deal.closed_on !== null && (
                      <div>
                        <dt>{t("room.fact.closed")}</dt>
                        <dd className="crm-mono">{dayOf(deal.closed_on)}</dd>
                      </div>
                    )}
                {deal.owner_id !== null && (
                  <div>
                    <dt>{t("room.fact.owner")}</dt>
                    <dd>{owner}</dd>
                  </div>
                )}
              </dl>
              {deal.scope !== null && <p className="crm-room-scope">{deal.scope}</p>}
            </section>

            {coverCard !== null && (
              <section className="crm-side-card crm-room-cover" aria-label={t("room.cover")} data-testid="room-cover">
                <div className="crm-room-cover-head">
                  <Icon name="plane" size={14} />
                  <span className="crm-room-cover-title">{t("room.cover.title", { cover: firstName(nameOf(coverCard.cover_id)), away: firstName(nameOf(coverCard.owner_id)) })}</span>
                  <span className="crm-mono crm-room-cover-when">
                    {coverCard.ends_on === null ? t("room.cover.from", { day: f.dayShort(noonOf(coverCard.starts_on.slice(0, 10))) }) : `${f.dayShort(noonOf(coverCard.starts_on.slice(0, 10)))} – ${f.dayShort(noonOf(coverCard.ends_on.slice(0, 10)))}`}
                  </span>
                </div>
                {noteDraft === null ? (
                  <>
                    {data.coverNote !== null ? (
                      <p className="crm-room-cover-note">{data.coverNote.text}</p>
                    ) : (
                      <p className="crm-room-quiet">{coverCard.owner_id === me ? t("room.cover.none.mine", { name: firstName(nameOf(coverCard.cover_id)) }) : t("room.cover.none", { name: firstName(nameOf(coverCard.owner_id)) })}</p>
                    )}
                    {coverMine && (
                      <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy} onClick={() => setNoteDraft(data.coverNote?.text ?? "")}>
                        <Icon name="pencil" size={12} />
                        {t(data.coverNote === null ? "room.cover.write" : "room.cover.edit")}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <label className="crm-label" htmlFor="crm-room-cover-note">
                      {t("room.cover.label")}
                    </label>
                    <textarea id="crm-room-cover-note" className="crm-input crm-textarea mr-fld" autoFocus value={noteDraft} maxLength={1000} disabled={busy} onChange={(event) => setNoteDraft(event.target.value)} />
                    <div className="crm-room-cover-actions">
                      <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" disabled={busy || noteDraft.trim() === ""} onClick={() => void saveNote()}>
                        <Icon name="check" size={14} />
                        {t("room.cover.save")}
                      </button>
                      <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy} onClick={() => setNoteDraft(null)}>
                        {t("room.cover.leave")}
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}

            <section className="crm-side-card" aria-label={t("room.on")} data-testid="room-on">
              <h2>{t("room.on")}</h2>
              <div className="crm-room-person">
                <span className="crm-avatar" aria-hidden="true">
                  {initials(owner)}
                </span>
                <span className="crm-room-person-words">
                  <span className="crm-room-person-name">{owner}</span>
                </span>
                <span className="crm-pill" data-tone="accent">
                  {t("room.on.owner")}
                </span>
              </div>
              {session.can("deal_members", "read") && (
                <>
                  <h3 className="crm-room-sub">{t("room.on.also")}</h3>
                  {members.length === 0 ? (
                    <p className="crm-room-quiet">{t("room.on.nobody")}</p>
                  ) : (
                    <ul className="crm-room-people">
                      {members.map((member) => {
                        const name = nameOf(member.user_id);
                        return (
                          <li key={member.id} className="crm-room-person" data-member={member.user_id}>
                            <span className="crm-avatar" aria-hidden="true">
                              {initials(name)}
                            </span>
                            <span className="crm-room-person-words">
                              <span className="crm-room-person-name">
                                {name}
                                <span className="crm-pill crm-room-mark">{t("board.card.helping")}</span>
                              </span>
                              {member.since !== null && <span className="crm-room-person-sub">{t("room.on.since", { day: f.dayShort(noonOf(member.since.slice(0, 10))) })}</span>}
                            </span>
                            {canRemove && (
                              <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("room.on.remove", { name })} title={t("room.on.remove", { name })} disabled={busy} onClick={() => void takeOff(member)}>
                                <Icon name="x" size={14} />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {canAdd && (
                    <button type="button" className="crm-room-add mr-gi" aria-expanded={adding} disabled={busy} onClick={() => setAdding((was) => !was)}>
                      <Icon name="user-round-plus" size={14} />
                      {t("room.on.add")}
                    </button>
                  )}
                  {canAdd && adding && (
                    <div role="group" aria-label={t("room.on.pool")} className="crm-room-pool mr-scroll">
                      {pool.map((userId) => (
                        <button key={userId} type="button" className="crm-room-pool-item mr-row" disabled={busy} onClick={() => void add(userId)}>
                          <span className="crm-avatar crm-avatar-26" aria-hidden="true">
                            {initials(nameOf(userId))}
                          </span>
                          {nameOf(userId)}
                        </button>
                      ))}
                      {pool.length === 0 && <p className="crm-room-quiet">{t("room.on.pool.none")}</p>}
                      <p className="crm-room-pool-note">{t("room.on.pool.note")}</p>
                    </div>
                  )}
                  <p className="crm-room-note">{t("room.on.note", { owner: firstName(owner) })}</p>
                </>
              )}
            </section>

            {its !== null && its.contacts.length > 0 && (
              <section className="crm-side-card" aria-label={t("room.people")}>
                <h2>{t("room.people")}</h2>
                <ul className="crm-room-contacts">
                  {its.contacts.map((contact) => (
                    <li key={contact.id} className="crm-room-contact mr-card">
                      <div className="crm-room-person">
                        <span className="crm-avatar" aria-hidden="true">
                          {initials(contact.name)}
                        </span>
                        <span className="crm-room-person-words">
                          <AccountLink to="contacts" id={contact.id} className="crm-room-person-name">
                            {contact.name}
                          </AccountLink>
                          {contact.job_title !== null && <span className="crm-room-person-sub">{contact.job_title}</span>}
                        </span>
                        {contact.id === deal.contact_id && (
                          <span className="crm-pill" data-tone="accent">
                            {t("room.people.main")}
                          </span>
                        )}
                      </div>
                      {(contact.email !== null || contact.phone !== null) && (
                        <div className="crm-room-contact-ways crm-mono">
                          {contact.email !== null && (
                            <span>
                              <Icon name="mail" size={12} />
                              <bdi>{contact.email}</bdi>
                            </span>
                          )}
                          {contact.phone !== null && (
                            <span>
                              <Icon name="phone" size={12} />
                              <bdi>{contact.phone}</bdi>
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {its !== null && its.company !== null && (
              <section className="crm-side-card crm-room-company" aria-label={t("room.company")}>
                <h2>{t("room.company")}</h2>
                <div className="crm-room-company-name">
                  <AccountLink to="companies" id={its.company.id}>
                    {its.company.name}
                  </AccountLink>
                </div>
                <div className="crm-room-person-sub">{[its.company.sector, its.company.headcount === null ? null : t("room.company.people", undefined, num(its.company.headcount)), its.company.town].filter((part) => part !== null && part !== "").join(" · ")}</div>
              </section>
            )}

            {quotesOn && (
              <section className="crm-side-card" aria-label={t("room.quote")} data-testid="room-quote">
                <div className="crm-room-quote-head">
                  <h2>{t("room.quote")}</h2>
                  {quoteState !== null && (
                    <span className="crm-pill" data-tone={TONE[quoteState]}>
                      {t(`quotes.state.${quoteState}` as MessageKey)}
                    </span>
                  )}
                </div>
                {family !== null && newestQuote !== null ? (
                  <>
                    <div className="crm-room-quote-line">
                      <span className="crm-mono crm-room-quote-doc">
                        {familyNo(family)} · {t("quote.version", { n: newestQuote.version }).toLowerCase()}
                      </span>
                      <span className="crm-mono crm-room-quote-total">{f.money(newestQuote.total)}</span>
                    </div>
                    <p className="crm-room-quiet">
                      {has === null
                        ? t("room.quote.nothingSent")
                        : has.status === "accepted"
                          ? t("room.quote.accepted", { n: has.version, amount: f.money(has.total) })
                          : has.valid_until === null
                            ? t("room.quote.has.bare", { n: has.version, amount: f.money(has.total) })
                            : t("room.quote.has", { n: has.version, amount: f.money(has.total), day: f.dayShort(noonOf(has.valid_until.slice(0, 10))) })}
                    </p>
                    <ScreenLink to="quotes" rest={[newestQuote.id]} className="crm-btn crm-btn-ghost crm-btn-38 crm-btn-wide mr-gi">
                      <Icon name="file-text" size={14} />
                      {t("room.quote.open")}
                    </ScreenLink>
                  </>
                ) : (
                  <>
                    <p className="crm-room-quiet">{t("room.quote.none")}</p>
                    {canWork && session.can("quotes", "create") && session.can("quote_lines", "create") && (
                      <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 crm-btn-wide mr-gi" disabled={busy} onClick={() => void startQuote()}>
                        <Icon name="file-plus" size={14} />
                        {t("quotes.start")}
                      </button>
                    )}
                  </>
                )}
                {!open && session.can("quotes", "create") && (
                  <p className="crm-room-quiet" data-testid="room-quote-closed">
                    {t("room.quote.closed")}
                  </p>
                )}
              </section>
            )}
          </aside>
        </div>
      </>
    );
  }
}
