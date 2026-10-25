/**
 * THE PIPELINE BOARD: open deals, a column a stage.
 *
 * A rep's board holds her own deals, the ones she helps on and the ones she
 * is covering (the server decides which rows she reaches; the marked ones
 * are counted for their owners, never for her). The manager, the CRM admin
 * and Read-only see the team's, with a filter by person.
 *
 * A deal she HELPS on is read and commented on, never worked (ruling 1d,
 * `selling/helping.ts`): its card does not move and has no menu but "Open",
 * and the board says so. A deal she covers is worked as her own.
 *
 * The board itself is Adminium's own (the kit's `board`): cards are moved by
 * dragging or by keyboard, and a move is saved as a change of the deal's
 * stage that names the stage it was seen in. A move the server refuses puts
 * the card back and says why.
 *
 * WHO ADDS UP. The header's three figures and each column's weighted figure
 * are sums the server works out over the deals counted for the reader. This
 * screen only subtracts a deal's "entered the stage" from the server's clock
 * to say how long it has been sitting.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, noonOf } from "../../lib/format.ts";
import type { KitMissing } from "../../kitParts.ts";
import { kitCommon } from "../../kitParts.ts";
import { useDealActions } from "../../selling/actions.tsx";
import { closedFigures, scopeOf, yearOf, type Closed } from "../../selling/figures.ts";
import { helpsOn } from "../../selling/helping.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import { canOpen, type MenuFacts, type PartId } from "../../shell/routes.ts";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { noValue } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { dealConditions } from "../own/data.ts";
import { useSavedView, ViewBar } from "../own/savedView.tsx";
import { KitPart } from "../../ui/kit.tsx";
import { usePageTheme } from "../../ui/pageTheme.ts";
import { LoadFailed, Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";

/** A board draws this many cards at most; the header and the columns still count every deal. */
const CARDS = 400;
const PAGE = 200;
const TONES = ["neutral", "info", "accent", "warn", "pos"] as const;

interface Stage extends Record<string, unknown> {
  id: number;
  label: string;
  odds: number | string;
}
interface Deal extends Record<string, unknown> {
  id: number;
  name: string;
  owner_id: string | null;
  stage_id: number;
  amount: number | string;
  weighted_value: number | string;
  expected_close: string | null;
  entered_stage_at: string | null;
  company: string | null;
}
interface PerStage {
  count: number;
  full: number;
  weighted: number;
}
interface BoardData {
  stages: Stage[];
  deals: Deal[];
  /** Every deal on the board, by stage: how many cards a column holds. */
  onBoard: Record<string, number>;
  /** The deals counted for the reader (a rep's own; for the team, everybody's or one person's), by stage. */
  counted: Record<string, PerStage>;
  /** Whose deals the reader is covering today: their ids. */
  covering: string[];
  owners: string[];
  names: Record<string, string>;
  warmDays: number;
  staleDays: number;
  closed: Closed;
  /** The board's three figures over the deals counted for the reader. */
  header: PerStage;
}

const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);

/** The deals drawn as cards, the longest-sitting first: the server gives a page of 200 at most, so up to two are read. */
async function cards(session: StaffSession, where: Condition): Promise<{ rows: Deal[] }> {
  const page = (offset: number) =>
    session.list<Deal>("deals", { select: ["id", "name", "owner_id", "stage_id", "amount", "weighted_value", "expected_close", "entered_stage_at"], where, order: ["entered_stage_at", "id"], lookup: ["company:company_id.name"], limit: PAGE, offset });
  const rows: Deal[] = [];
  for (let offset = 0; offset < CARDS; offset += PAGE) {
    const got = await page(offset);
    rows.push(...got.rows);
    if (got.rows.length < PAGE) break;
  }
  return { rows };
}

/** No saved view: the whole board. One value, so a board opened plainly is read once. */
const NO_CUT: readonly Condition[] = [];

async function read(session: StaffSession, mine: boolean, who: string | null, today: string, cut: readonly Condition[] = []): Promise<BoardData> {
  const me = session.config.user;
  const open: Condition = { column: "state", op: "eq", value: "open" };
  const owner = mine ? (me?.id ?? null) : who;
  // A saved view cuts the cards and every figure alike (`cut`): the board then shows that view, and its header counts it.
  const shown: Condition[] = mine || who === null ? [open, ...cut] : [open, { column: "owner_id", op: "eq", value: who }, ...cut];
  const counted: Condition[] = owner === null ? [open, ...cut] : [open, { column: "owner_id", op: "eq", value: owner }, ...cut];
  const sums = [
    { fn: "count" as const, alias: "n" },
    { fn: "sum" as const, column: "amount", alias: "full" },
    { fn: "sum" as const, column: "weighted_value", alias: "weighted" },
  ];
  const [stages, deals, onBoard, mineByStage, whole, settings, covers, byOwner, closed] = await Promise.all([
    session.list<Stage>("stages", { select: ["id", "label", "odds"], order: ["position"], limit: 50 }),
    cards(session, { and: shown }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: shown, groupBy: ["stage_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 50 }),
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: counted, groupBy: ["stage_id"], aggregations: sums, limit: 50 }),
    // The same deals as one sum: the header's figures, so no column is added to another here.
    session.figure<Grouped>({ table: "deals", shape: "categorical", filters: counted, groupBy: ["state"], aggregations: sums }),
    session.can("settings", "read") ? session.list<{ sitting_warm_days: number | null; sitting_stale_days: number | null }>("settings", { select: ["sitting_warm_days", "sitting_stale_days"], limit: 1 }).then((page) => page.rows[0] ?? null) : Promise.resolve(null),
    // The books lent to the reader today: a deal of one of these people on her board is one she covers, not one she helps on.
    mine && me !== null && session.part("team") && session.can("covers", "read")
      ? session
          .list<{ owner_id: string }>("covers", { select: ["owner_id"], where: { and: [{ column: "cover_id", op: "eq", value: me.id }, { column: "starts_on", op: "lte", value: today }, { or: [{ column: "ends_on", op: "gte", value: today }, { column: "ends_on", op: "is_null" }] }] }, limit: 50 })
          .then((page) => page.rows.map((row) => row.owner_id))
          .catch(() => [])
      : Promise.resolve([] as string[]),
    mine ? Promise.resolve(null) : session.figure<Grouped>({ table: "deals", shape: "categorical", filters: [open], groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 50 }),
    closedFigures(session, { owner, between: yearOf(today) }),
  ]);
  const names: Record<string, string> = me === null ? {} : { [me.id]: me.name };
  const owners = byOwner === null ? [] : byOwner.items.filter((item) => !noValue(item.key)).map((item) => String(item.key));
  if ([...owners, ...deals.rows.map((deal) => deal.owner_id)].some((id) => id !== null && names[id] === undefined)) for (const person of await session.people(undefined, 200).catch(() => [])) names[person.id] = person.name;
  return {
    stages: stages.rows,
    deals: deals.rows,
    // A figure asked for one number answers it as `value`.
    onBoard: Object.fromEntries(onBoard.items.map((item) => [String(item.key), num(item.values?.["n"] ?? item.value)])),
    counted: Object.fromEntries(mineByStage.items.map((item) => [String(item.key), { count: num(item.values?.["n"]), full: num(item.values?.["full"]), weighted: num(item.values?.["weighted"]) }])),
    covering: covers,
    owners,
    names,
    warmDays: num(settings?.sitting_warm_days) || 14,
    staleDays: num(settings?.sitting_stale_days) || 30,
    closed,
    header: { count: num(whole.items[0]?.values?.["n"]), full: num(whole.items[0]?.values?.["full"]), weighted: num(whole.items[0]?.values?.["weighted"]) },
  };
}

/** What the kit's board takes: see Adminium's guide "Adminium's own parts on an app's screen". */
interface BoardProps {
  locale: string;
  dir: "ltr" | "rtl";
  theme?: "light" | "dark";
  columns: { id: string; label: string; badge?: string; tone?: string; count?: number; total?: string }[];
  cards: { id: string; columnId: string; title: string; subtitle?: string; amount?: string; tag?: string; tagTone?: string; owner?: string; due?: string; meta?: string[]; actions?: { id: string; label: string }[] }[];
  onAction?: (cardId: string, actionId: string) => void;
  onMove?: (cardId: string, toColumnId: string, fromColumnId: string) => Promise<void | { refused: string }>;
  canMove?: boolean | ((cardId: string) => boolean);
  onOpen?: (cardId: string) => void;
  busy?: boolean;
  emptyLabel?: string;
  ariaLabel?: string;
}

export function Pipeline(props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const nav = useNav();
  const actions = useDealActions();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const scope = useMemo(() => scopeOf(session), [session]);
  const mine = scope === "mine";
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  // `pipeline/of/<person>` opens the board on one person's deals (the Team view's "Board").
  const [who, setWho] = useState<string | null>(() => (props.rest[0] === "of" && props.rest[1] !== undefined ? props.rest[1] : null));
  // `pipeline/view/<id>` opens the board on a saved view: its person (for who reads the team) and its other rules.
  const view = useSavedView("pipeline", props.rest);
  const viewId = view.state === "ready" ? view.view.id : null;
  useEffect(() => {
    if (view.state === "ready" && !mine) setWho(view.view.filters.rep ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per view
  }, [viewId]);
  const cut = useMemo(() => {
    if (view.state !== "ready") return NO_CUT;
    const { rep: _whose, ...rules } = view.view.filters;
    return dealConditions(rules, view.stages, now, f);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a day's cut: read again when the day turns, not with every tick
  }, [view, today, f]);
  const { load, reload } = useLoad(() => (view.state === "loading" ? new Promise<never>(() => undefined) : read(session, mine, who, today, cut)), [session, mine, who, today, cut, view.state, actions.changed]);
  const again = useCallback(() => {
    setNow(session.now());
    reload();
  }, [session, reload]);
  useLive(["deals", "stages"], again);

  const facts = useMemo<MenuFacts>(
    () => ({ roles: (config.access?.roles ?? []).map((role) => role.slug), part: (id: PartId) => session.part(id), reads: (table) => session.can(table, "read"), built: isBuilt }),
    [config, session],
  );
  const canWork = session.can("deals", "update");
  const canHand = canWork && canOpen("handover", facts);
  const closeDeal = actions.close;
  const [look, setLook] = useState<number | null>(null);
  const data = load.state === "ready" ? load.data : null;
  // What the latest read holds, for a move's answer that arrives after it.
  const held = useRef(data);
  held.current = data;
  const theme = usePageTheme();

  const me = config.user?.id ?? null;
  // A deal of a colleague she does not cover: she reads it and comments, and its owner moves it.
  const helping = useCallback((deal: Deal): boolean => mine && helpsOn(session, deal.owner_id, new Set(data?.covering ?? [])), [mine, session, data]);
  const markOf = useCallback(
    (deal: Deal): string | null => {
      if (!mine || deal.owner_id === null || deal.owner_id === me) return null;
      const owner = firstName(data?.names[deal.owner_id] ?? "");
      return data?.covering.includes(deal.owner_id) === true ? t("board.card.covering", { name: owner }) : t("board.card.helping");
    },
    [mine, me, data, t],
  );

  const move = useCallback(
    async (cardId: string, to: string, from: string): Promise<void | { refused: string }> => {
      const deal = held.current?.deals.find((one) => String(one.id) === cardId);
      const stage = held.current?.stages.find((one) => String(one.id) === to);
      const saved = await session.update<Deal>("deals", Number(cardId), { stage_id: Number(to) }, { seen: { stage_id: Number(from), state: "open" } });
      if (saved.state === "refused") {
        again();
        return { refused: reasonOf(saved.error, t) };
      }
      if (saved.state === "unknown") {
        again();
        return { refused: t("ui.unknown") };
      }
      toasts.show(t("board.toast.moved", { deal: deal?.name ?? "", stage: stage?.label ?? "", amount: f.money(saved.row.weighted_value) }), "pos");
      again();
    },
    [session, again, toasts, t, f],
  );

  const board = useMemo<BoardProps | null>(() => {
    if (data === null) return null;
    return {
      ...kitCommon(config, locale),
      theme,
      ariaLabel: t("board.aria"),
      emptyLabel: t("board.empty"),
      columns: data.stages.map((stage, index) => ({
        id: String(stage.id),
        label: stage.label,
        badge: f.percent(Number(stage.odds)),
        tone: TONES[Math.min(index, TONES.length - 1)]!,
        count: data.onBoard[String(stage.id)] ?? 0,
        total: f.money(data.counted[String(stage.id)]?.weighted ?? 0),
      })),
      cards: data.deals.map((deal) => {
        const days = deal.entered_stage_at === null ? 0 : Math.max(0, f.dayDiff(new Date(deal.entered_stage_at), now));
        const stale = days >= data.staleDays;
        const warm = !stale && days >= data.warmDays;
        const mark = markOf(deal);
        const owner = deal.owner_id === null ? undefined : data.names[deal.owner_id];
        return {
          id: String(deal.id),
          columnId: String(deal.stage_id),
          title: deal.name,
          ...(deal.company === null ? {} : { subtitle: deal.company }),
          amount: f.money(deal.amount),
          tag: t(stale ? "board.card.sitting.stale" : warm ? "board.card.sitting.warm" : "board.card.sitting", undefined, days),
          tagTone: stale ? "danger" : warm ? "warn" : "neutral",
          ...(owner === undefined ? {} : { owner }),
          ...(deal.expected_close === null ? {} : { due: f.dayShort(noonOf(deal.expected_close)) }),
          ...(mark === null ? {} : { meta: [mark] }),
          // The card's own menu: what can be done to the deal from here. On a deal she helps on: opening it.
          ...(canWork && helping(deal)
            ? { actions: [{ id: "open", label: t("room.open") }] }
            : canWork
            ? {
                actions: [
                  { id: "close", label: t("board.look.close") },
                  { id: "open", label: t("room.open") },
                  ...(canHand && (!mine || deal.owner_id === me) ? [{ id: "handover", label: t("room.handOver") }] : []),
                ],
              }
            : {}),
        };
      }),
      // Every card she may work; never one she only helps on.
      canMove: canWork
        ? (cardId: string) => {
            const deal = data.deals.find((one) => String(one.id) === cardId);
            return deal !== undefined && !helping(deal);
          }
        : false,
      ...(canWork ? { onMove: move } : {}),
      onOpen: (cardId: string) => setLook(Number(cardId)),
      onAction: (cardId: string, actionId: string) => {
        const deal = held.current?.deals.find((one) => String(one.id) === cardId);
        if (deal === undefined) return;
        if (actionId === "close") closeDeal({ id: deal.id, name: deal.name, company: deal.company, amount: f.money(deal.amount) });
        else if (actionId === "open") nav.go("deal", deal.id);
        else if (actionId === "handover") nav.go("handover", deal.id);
      },
    };
  }, [data, config, locale, theme, t, f, now, markOf, helping, canWork, canHand, mine, me, nav, move, closeDeal]);

  const marked = data === null || !mine ? [] : data.deals.filter((deal) => deal.owner_id !== me);
  const coveringN = marked.filter((deal) => deal.owner_id !== null && data!.covering.includes(deal.owner_id)).length;
  const helpingN = marked.length - coveringN;
  const title = !mine && who !== null ? t("board.title.person", { name: firstName(data?.names[who] ?? "") }) : t(mine ? "board.title.mine" : "board.title.team");
  const looked = look === null ? null : (data?.deals.find((deal) => deal.id === look) ?? null);
  const lookHelping = looked !== null && helping(looked);
  const figures = data?.header ?? null;
  const year = today.slice(0, 4);

  const unavailable = (why: KitMissing, retry: () => void) =>
    why === "failed" ? (
      <LoadFailed reload={retry} />
    ) : (
      <div className="crm-empty crm-board-missing" role="status">
        <span className="crm-empty-icon">
          <Icon name="columns-3" size={21} />
        </span>
        <div className="crm-empty-title">{t("board.missing")}</div>
        <p>{t("board.missing.body")}</p>
      </div>
    );

  return (
    <div className="crm-board mr-screen" data-screen="pipeline">
      <div className="crm-screen crm-board-head">
        <div className="crm-screen-head crm-screen-head-top">
          <div>
            <h1>{title}</h1>
            <div className="crm-facts">
              <span className="crm-fact">
                {t("board.weighted")}
                <span className="crm-mono crm-fact-value crm-fact-lead" data-testid="board-weighted">
                  {figures === null ? "…" : f.money(figures.weighted)}
                </span>
              </span>
              <span className="crm-fact-rule" />
              <span className="crm-fact">
                {t("board.full")}
                <span className="crm-mono crm-fact-value" data-testid="board-full">
                  {figures === null ? "…" : f.money(figures.full)}
                </span>
              </span>
              <span className="crm-fact-rule" />
              <span className="crm-fact">
                {t("board.open")}
                <span className="crm-mono crm-fact-value" data-testid="board-count">
                  {figures === null ? "…" : f.number(figures.count)}
                </span>
              </span>
              {marked.length > 0 && (
                <span className="crm-fact-note" data-testid="board-marked">
                  {[coveringN > 0 ? t("board.note.covering", undefined, coveringN) : null, helpingN > 0 ? t("board.note.helping", undefined, helpingN) : null].filter((part) => part !== null).join(" · ")} · {t("board.note.counted", undefined, marked.length)}
                </span>
              )}
            </div>
          </div>
          {actions.canStart && (
            <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" onClick={() => actions.start()}>
              <Icon name="plus" />
              {t("board.new")}
              <kbd className="crm-key">N</kbd>
            </button>
          )}
        </div>
        {!mine && data !== null && data.owners.length > 0 && (
          <div className="crm-chips" role="group" aria-label={t("closed.who")}>
            <button type="button" className="crm-chip-btn mr-chip" aria-pressed={who === null} onClick={() => setWho(null)}>
              {t("closed.filter.all")}
            </button>
            {data.owners.map((id) => (
              <button key={id} type="button" className="crm-chip-btn mr-chip" aria-pressed={who === id} onClick={() => setWho(id)}>
                {firstName(data.names[id] ?? t("closed.someone"))}
              </button>
            ))}
          </div>
        )}
        {canWork && <div className="crm-week-hint">{t("board.hint")}</div>}
        {canWork && helpingN > 0 && (
          <div className="crm-week-hint" data-testid="board-helping">
            {t("help.board")}
          </div>
        )}
        <ViewBar screen="pipeline" view={view} current={{ ...(view.state === "ready" ? view.view.filters : {}), ...(!mine && who !== null ? { rep: who } : !mine ? { rep: undefined } : {}) }} names={data?.names ?? {}} />
      </div>

      <Loaded
        load={load}
        reload={again}
        skeleton={
          <div className="crm-screen">
            <Skeleton rows={3} height={120} />
          </div>
        }
      >
        {(loaded) => (
          <>
            {loaded.deals.length >= CARDS && <p className="crm-screen crm-board-cut">{t("board.cut", { shown: f.number(CARDS) })}</p>}
            {board !== null && <KitPart<BoardProps> part="board" className="crm-board-kit" props={board} fallback={unavailable} />}
            <div className="crm-screen crm-board-foot">
              <div className="crm-closed-zone">
                <span className="crm-closed-zone-icon">
                  <Icon name="handshake" size={17} />
                </span>
                <div className="crm-closed-zone-words">
                  <div className="crm-closed-zone-title">{t("board.closed.title", { year })}</div>
                  <div className="crm-closed-zone-hint">{t(canWork ? "board.closed.hint" : "board.closed.hint.read")}</div>
                </div>
                <div className="crm-closed-zone-stats">
                  <span className="crm-fact">
                    {t("closed.stat.won")}
                    <span className="crm-mono crm-fact-value" data-tone="pos" data-testid="zone-won">
                      {f.number(loaded.closed.won.count)} · {f.money(loaded.closed.won.amount)}
                    </span>
                  </span>
                  <span className="crm-fact">
                    {t("closed.stat.lost")}
                    <span className="crm-mono crm-fact-value" data-testid="zone-lost">
                      {f.number(loaded.closed.lost.count)} · {f.money(loaded.closed.lost.amount)}
                    </span>
                  </span>
                  {canOpen("archive", facts) && (
                    <ScreenLink to="archive" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                      <Icon name="folder-clock" size={14} />
                      {t("board.closed.all")}
                    </ScreenLink>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </Loaded>

      {looked !== null && data !== null && (
        <Dialog
          shape="box"
          name="deal-look"
          icon="columns-3"
          title={looked.name}
          {...(looked.company === null ? {} : { subtitle: looked.company })}
          onClose={() => setLook(null)}
          foot={
            <>
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" onClick={() => setLook(null)}>
                {t("ui.close")}
              </button>
              {canOpen("deal", facts) && (
                <ScreenLink to="deal" rest={[looked.id]} className="crm-btn crm-btn-ghost crm-btn-44 mr-gi">
                  <Icon name="panel-right-open" />
                  {t("room.open")}
                </ScreenLink>
              )}
              {canWork && !lookHelping && (
                <button
                  type="button"
                  className="crm-btn crm-btn-primary crm-btn-44 mr-btn"
                  data-autofocus
                  onClick={() => {
                    setLook(null);
                    actions.close({ id: looked.id, name: looked.name, company: looked.company, amount: f.money(looked.amount) });
                  }}
                >
                  <Icon name="handshake" />
                  {t("board.look.close")}
                </button>
              )}
            </>
          }
        >
          <dl className="crm-look">
            <div>
              <dt>{t("board.look.amount")}</dt>
              <dd className="crm-mono">{f.money(looked.amount)}</dd>
            </div>
            <div>
              <dt>{t("board.look.stage")}</dt>
              <dd>{data.stages.find((stage) => stage.id === looked.stage_id)?.label ?? ""}</dd>
            </div>
            <div>
              <dt>{t("board.look.weighted")}</dt>
              <dd className="crm-mono">{f.money(looked.weighted_value)}</dd>
            </div>
            {looked.owner_id !== null && data.names[looked.owner_id] !== undefined && (
              <div>
                <dt>{t("board.look.owner")}</dt>
                <dd>{data.names[looked.owner_id]}</dd>
              </div>
            )}
            {looked.expected_close !== null && (
              <div>
                <dt>{t("board.look.close.on")}</dt>
                <dd className="crm-mono">{f.date(noonOf(looked.expected_close))}</dd>
              </div>
            )}
          </dl>
          {lookHelping && looked.owner_id !== null && (
            <p className="crm-room-quiet" data-testid="look-helping">
              {t("help.room", { owner: firstName(data.names[looked.owner_id] ?? t("closed.someone")) })}
            </p>
          )}
          {canOpen("visits", facts) && session.can("site_visits", "create") && !lookHelping && (
            <ScreenLink to="visits" rest={["book", looked.id]} className="crm-btn crm-btn-ghost crm-btn-40 crm-look-visit mr-gi" onGo={() => setLook(null)}>
              <Icon name="map-pin" />
              {t("visits.book")}
            </ScreenLink>
          )}
        </Dialog>
      )}
    </div>
  );
}
