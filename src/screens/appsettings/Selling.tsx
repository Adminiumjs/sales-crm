/**
 * SETTINGS, SELLING: how the team sells. The stages and their odds, the lost
 * reasons, what a quote needs and how long it holds, when a sitting deal
 * turns warm and stale, the three nudge thresholds; then the two lists a
 * business fills in before day one: the price list and the reps.
 *
 * WHO WRITES. The sales manager and the CRM admin add and rename a stage or a
 * reason and write the numbers and the price list; removing a stage, a reason
 * or a price-list line, and making or removing a rep's profile, are the CRM
 * admin's. Each of those is the server's rule; this page only leaves out a
 * control whose press would be refused.
 *
 * A STAGE OR A REASON THAT DEALS NAME STAYS. The design moves its deals to
 * another one and removes it. A closed deal is locked and keeps its stage,
 * and every stage change ever made names its two stages, so the server
 * refuses the removal; the bin is offered only where no deal names the row.
 *
 * WHO ADDS UP. Every count and the weighted total are the server's, for the
 * deals the reader reaches.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import type { Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { LostReply, newClientKey, StaffError, type Saved, type StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { peopleOf } from "../team/data.ts";
import { num, readSelling, type PriceRow, type ReasonRow, type RepRow, type SellingData, type StageRow } from "./data.ts";
import { AskLine, Card, NumField, useSaveSettings, type Rights } from "./parts.tsx";

type ListTable = "stages" | "lost_reasons";
type Listed = (StageRow | ReasonRow) & { odds?: number | string };

/** The three nudge rules' real state, as the server tells anybody who may open the app. Null: it was not told. */
async function readRules(session: StaffSession): Promise<Record<string, boolean> | null> {
  try {
    const doc = await session.call<{ rules: { key: string; on: boolean }[] }>("GET", "/apps/crm/rules");
    return Object.fromEntries(doc.rules.map((rule) => [rule.key, rule.on]));
  } catch (error) {
    if (error instanceof StaffError || error instanceof LostReply) return null;
    throw error;
  }
}

/** Whether the install has an address to put in an e-mail's links. Answered only to somebody who may read Adminium's own settings. */
async function readLinks(session: StaffSession): Promise<"set" | "unset" | "unknown"> {
  try {
    const doc = await session.call<{ data?: { publicOrigin?: string | null }; publicOrigin?: string | null }>("GET", "/settings/email");
    const origin = doc.data?.publicOrigin ?? doc.publicOrigin ?? null;
    return origin === null || origin === "" ? "unset" : "set";
  } catch (error) {
    if (error instanceof StaffError || error instanceof LostReply) return "unknown";
    throw error;
  }
}

/** A list kept in an order: the stages, or the lost reasons. */
function Ordered({ table, rows, session, f, after, counts, removable }: { table: ListTable; rows: Listed[]; session: StaffSession; f: Formatters; after: () => void; counts: (row: Listed) => string; removable: (row: Listed) => boolean }) {
  const t = useT();
  const toasts = useToasts();
  const k = (name: string): MessageKey => `aset.${table === "stages" ? "stages" : "reasons"}.${name}` as MessageKey;
  const canEdit = session.can(table, "update");
  const canAdd = session.can(table, "create");
  const canRemove = session.can(table, "delete");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /**
   * What was last sent for a field, until the list has been read again: Enter
   * saves, and leaving the field a moment later must not send the same thing
   * a second time (the server would refuse it, the row having changed).
   */
  const sent = useRef<Record<string, string>>({});
  const list = useRef<HTMLDivElement>(null);
  const focusOn = useRef<string | null>(null);
  const addKey = useRef<string | null>(null);
  useEffect(() => {
    if (focusOn.current === null) return;
    const target = list.current?.querySelector<HTMLElement>(focusOn.current);
    if (target !== null && target !== undefined && !(target as HTMLButtonElement).disabled) {
      target.focus();
      if (target instanceof HTMLInputElement) target.select();
      focusOn.current = null;
    }
  }, [rows]);
  // What was typed is dropped once the server's own value has come back.
  useEffect(() => {
    setDrafts({});
    sent.current = {};
  }, [rows]);

  const run = async <R,>(save: Promise<Saved<R>>, done: string): Promise<boolean> => {
    setBusy(true);
    const saved = await toasts.say(save, () => done);
    setBusy(false);
    // A save that did not hold may be tried again with the same words.
    if (saved === null) sent.current = {};
    after();
    return saved !== null;
  };
  const once = (key: string, value: string): boolean => {
    if (sent.current[key] === value) return false;
    sent.current[key] = value;
    return true;
  };
  const rename = (row: Listed): void => {
    const typed = drafts[`name:${String(row.id)}`];
    if (typed === undefined || typed.trim() === row.label || typed.trim() === "" || !once(`name:${String(row.id)}`, typed.trim())) return;
    void run(session.update(table, row.id, { label: typed.trim() }, { seen: { label: row.label } }), t(k("renamed"), { name: typed.trim() }));
  };
  const reodds = (row: Listed): void => {
    const typed = drafts[`odds:${String(row.id)}`];
    if (typed === undefined) return;
    const value = Number(typed.trim());
    if (typed.trim() === "" || !Number.isInteger(value) || value < 0 || value > 100 || value === Math.round(num(row.odds) * 100) || !once(`odds:${String(row.id)}`, typed.trim())) return;
    void run(session.update(table, row.id, { odds: value / 100 }, { seen: { odds: row.odds } }), t("aset.stages.odds.saved", { name: row.label, odds: f.percent(value / 100) }));
  };
  /** Two rows change places: each takes the other's position, one save after the other. */
  const move = async (at: number, by: -1 | 1): Promise<void> => {
    const row = rows[at];
    const other = rows[at + by];
    if (row === undefined || other === undefined || busy) return;
    setBusy(true);
    // Rows that share a position (a list nobody ordered yet) are given their places first.
    const place = (index: number): number => (new Set(rows.map((one) => one.position)).size === rows.length ? rows[index]!.position : index);
    const first = await session.update(table, row.id, { position: place(at + by) }, { seen: { position: row.position } });
    const second = first.state === "saved" ? await session.update(table, other.id, { position: place(at) }, { seen: { position: other.position } }) : first;
    setBusy(false);
    focusOn.current = `[data-row="${String(row.id)}"] [data-move="${by === -1 ? "up" : "down"}"]`;
    if (second.state === "saved") toasts.show(t(k("moved"), { name: row.label, place: f.number(at + by + 1) }), "pos");
    else toasts.show(t("ui.unknown"), "danger", true);
    after();
  };
  const add = async (): Promise<void> => {
    addKey.current ??= newClientKey();
    const position = rows.reduce((most, row) => Math.max(most, num(row.position)), -1) + 1;
    setBusy(true);
    const made = await toasts.say(session.create<Listed>(table, { label: t(k("new")), position, ...(table === "stages" ? { odds: 0.5 } : {}) }, addKey.current), () => t(k("added")));
    setBusy(false);
    if (made !== null) {
      addKey.current = null;
      focusOn.current = `[data-row="${String(made.id)}"] input`;
    }
    after();
  };
  const remove = (row: Listed): void => void run(session.remove(table, row.id), t(k("removed"), { name: row.label }));

  return (
    <>
      <div role="list" aria-label={t(k("title"))} ref={list} className="crm-ast-rows" aria-busy={busy}>
        {rows.map((row, at) => {
          const name = drafts[`name:${String(row.id)}`] ?? row.label;
          const odds = drafts[`odds:${String(row.id)}`] ?? String(Math.round(num(row.odds) * 100));
          const badOdds = !/^\d+$/.test(odds.trim()) || Number(odds) > 100;
          return (
            <div key={row.id} role="listitem" className="crm-ast-row" data-row={row.id} data-name={row.label}>
              <span className="crm-ast-n crm-mono">{f.number(at + 1)}</span>
              {canEdit && (
                <span className="crm-ast-moves">
                  <button type="button" className="crm-icon-btn mr-gi" data-move="up" disabled={at === 0} aria-disabled={busy} aria-label={t("aset.move.up", { name: row.label })} onClick={() => void move(at, -1)}>
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button type="button" className="crm-icon-btn mr-gi" data-move="down" disabled={at === rows.length - 1} aria-disabled={busy} aria-label={t("aset.move.down", { name: row.label })} onClick={() => void move(at, 1)}>
                    <Icon name="arrow-down" size={14} />
                  </button>
                </span>
              )}
              {canEdit ? (
                <input
                  className="crm-ast-input crm-ast-input-name mr-fld"
                  value={name}
                  maxLength={80}
                  aria-label={t(k("name"), { n: f.number(at + 1) })}
                  aria-invalid={name.trim() === ""}
                  onChange={(event) => setDrafts((was) => ({ ...was, [`name:${String(row.id)}`]: event.target.value }))}
                  onBlur={() => rename(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") rename(row);
                  }}
                />
              ) : (
                <span className="crm-ast-name">{row.label}</span>
              )}
              {table === "stages" && (
                <span className="crm-ast-odds">
                  {canEdit ? (
                    <input
                      className="crm-ast-input crm-ast-input-odds crm-mono mr-fld"
                      inputMode="numeric"
                      value={odds}
                      aria-label={t("aset.stages.odds", { name: row.label })}
                      aria-invalid={badOdds}
                      onChange={(event) => setDrafts((was) => ({ ...was, [`odds:${String(row.id)}`]: event.target.value }))}
                      onBlur={() => reodds(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") reodds(row);
                      }}
                    />
                  ) : (
                    <span className="crm-mono" data-figure="odds">
                      {f.number(Math.round(num(row.odds) * 100))}
                    </span>
                  )}
                  <span className="crm-ast-unit crm-mono">%</span>
                </span>
              )}
              <span className="crm-ast-count crm-mono" data-figure="count">
                {counts(row)}
              </span>
              {canRemove && (
                <button type="button" className="crm-icon-btn mr-gi" data-remove disabled={!removable(row) || busy || rows.length <= (table === "stages" ? 2 : 1)} title={removable(row) ? undefined : t(k("held"))} aria-label={t("aset.remove", { name: row.label })} onClick={() => remove(row)}>
                  <Icon name="trash-2" size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {(canAdd || canRemove) && (
        <div className="crm-ast-foot">
          {canAdd && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-add disabled={busy} onClick={() => void add()}>
              <Icon name="plus" size={14} />
              {t(k("add"))}
            </button>
          )}
          <span>{t(k(canRemove ? "held" : "held.ask"))}</span>
        </div>
      )}
    </>
  );
}

function PriceList({ session, f, round }: { session: StaffSession; f: Formatters; round: number }) {
  const t = useT();
  const toasts = useToasts();
  const { load, reload } = useLoad(() => session.list<PriceRow>("price_list", { select: ["id", "name", "list_rate", "active"], order: ["name", "id"], limit: 200, count: "exact" }), [session, round]);
  const soon = useCoalesced(reload);
  const canEdit = session.can("price_list", "update");
  const canAdd = session.can("price_list", "create");
  const canRemove = session.can("price_list", "delete");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState({ name: "", rate: "" });
  const addKey = useRef<string | null>(null);
  const rows = load.state === "ready" ? load.data.rows : null;
  /** As in the lists above: what was last sent for a field, until the list is read again. */
  const sent = useRef<Record<string, string>>({});
  const once = (key: string, value: string): boolean => {
    if (sent.current[key] === value) return false;
    sent.current[key] = value;
    return true;
  };
  useEffect(() => {
    setDrafts({});
    sent.current = {};
  }, [rows]);
  const run = async <R,>(save: Promise<Saved<R>>, done: string): Promise<boolean> => {
    setBusy(true);
    const saved = await toasts.say(save, () => done);
    setBusy(false);
    if (saved === null) sent.current = {};
    soon();
    return saved !== null;
  };
  const rename = (row: PriceRow): void => {
    const typed = drafts[`name:${String(row.id)}`]?.trim();
    if (typed === undefined || typed === "" || typed === row.name || !once(`name:${String(row.id)}`, typed)) return;
    void run(session.update("price_list", row.id, { name: typed }, { seen: { name: row.name } }), t("aset.prices.saved", { name: typed }));
  };
  const reprice = (row: PriceRow): void => {
    const typed = drafts[`rate:${String(row.id)}`];
    if (typed === undefined) return;
    const value = typed.trim() === "0" ? 0 : f.readAmount(typed);
    if (value === null || value === num(row.list_rate) || !once(`rate:${String(row.id)}`, String(value))) return;
    void run(session.update("price_list", row.id, { list_rate: value }, { seen: { list_rate: row.list_rate } }), t("aset.prices.priced", { name: row.name, price: f.money(value) }));
  };
  const freshRate = fresh.rate.trim() === "0" ? 0 : f.readAmount(fresh.rate);
  const add = async (): Promise<void> => {
    if (fresh.name.trim() === "" || freshRate === null) return;
    addKey.current ??= newClientKey();
    if (await run(session.create("price_list", { name: fresh.name.trim(), list_rate: freshRate, active: true }, addKey.current), t("aset.prices.added", { name: fresh.name.trim() }))) {
      addKey.current = null;
      setFresh({ name: "", rate: "" });
    }
  };
  const isOn = (row: PriceRow): boolean => row.active === true || row.active === 1;
  return (
    <Card name="prices" flush title={t("aset.prices.title")} sub={t(canEdit ? "aset.prices.sub" : "aset.prices.sub.read")} aside={rows !== null ? <span className="crm-mono" data-figure="lines">{t("aset.prices.count", { count: f.number(load.state === "ready" ? (load.data.total ?? rows.length) : 0) }, load.state === "ready" ? (load.data.total ?? rows.length) : 0)}</span> : undefined}>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={44} />}>
        {(page) => (
          <>
            <div role="list" aria-label={t("aset.prices.title")} className="crm-ast-rows" aria-busy={busy}>
              {page.rows.length === 0 && <p className="crm-ast-none">{t("aset.prices.none")}</p>}
              {page.rows.map((row) => (
                <div key={row.id} role="listitem" className="crm-ast-row" data-row={row.id} data-name={row.name} data-off={isOn(row) ? undefined : "1"}>
                  {canEdit ? (
                    <input
                      className="crm-ast-input crm-ast-input-name mr-fld"
                      value={drafts[`name:${String(row.id)}`] ?? row.name}
                      maxLength={160}
                      aria-label={t("aset.prices.name", { name: row.name })}
                      onChange={(event) => setDrafts((was) => ({ ...was, [`name:${String(row.id)}`]: event.target.value }))}
                      onBlur={() => rename(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") rename(row);
                      }}
                    />
                  ) : (
                    <span className="crm-ast-name">{row.name}</span>
                  )}
                  {canEdit ? (
                    <input
                      className="crm-ast-input crm-ast-input-rate crm-mono mr-fld"
                      inputMode="decimal"
                      value={drafts[`rate:${String(row.id)}`] ?? f.number(num(row.list_rate))}
                      aria-label={t("aset.prices.rate", { name: row.name })}
                      aria-invalid={drafts[`rate:${String(row.id)}`] !== undefined && drafts[`rate:${String(row.id)}`]!.trim() !== "0" && f.readAmount(drafts[`rate:${String(row.id)}`]!) === null}
                      onChange={(event) => setDrafts((was) => ({ ...was, [`rate:${String(row.id)}`]: event.target.value }))}
                      onBlur={() => reprice(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") reprice(row);
                      }}
                    />
                  ) : null}
                  <span className="crm-ast-count crm-mono" data-figure="price">
                    {f.money(row.list_rate)}
                  </span>
                  {canEdit ? (
                    <button type="button" role="switch" className="crm-ast-switch mr-gi" aria-checked={isOn(row)} aria-label={t("aset.prices.offered", { name: row.name })} disabled={busy} onClick={() => void run(session.update("price_list", row.id, { active: !isOn(row) }, { seen: { active: row.active } }), t(isOn(row) ? "aset.prices.retired" : "aset.prices.back", { name: row.name }))}>
                      <span />
                    </button>
                  ) : (
                    !isOn(row) && <span className="crm-pill">{t("aset.prices.off")}</span>
                  )}
                  {canRemove && (
                    <button type="button" className="crm-icon-btn mr-gi" data-remove disabled={busy} aria-label={t("aset.remove", { name: row.name })} onClick={() => void run(session.remove("price_list", row.id), t("aset.prices.removed", { name: row.name }))}>
                      <Icon name="trash-2" size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {page.total !== undefined && page.total !== null && page.total > page.rows.length && <p className="crm-ast-none">{t("aset.cut", { shown: f.number(page.rows.length), all: f.number(page.total) })}</p>}
            {canAdd && (
              <form
                className="crm-ast-foot crm-ast-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  void add();
                }}
              >
                <input className="crm-ast-input crm-ast-input-name mr-fld" value={fresh.name} maxLength={160} placeholder={t("aset.prices.new.name")} aria-label={t("aset.prices.new.name")} onChange={(event) => setFresh((was) => ({ ...was, name: event.target.value }))} />
                <input className="crm-ast-input crm-ast-input-rate crm-mono mr-fld" inputMode="decimal" value={fresh.rate} placeholder={t("aset.prices.new.rate")} aria-label={t("aset.prices.new.rate")} aria-invalid={fresh.rate.trim() !== "" && freshRate === null} onChange={(event) => setFresh((was) => ({ ...was, rate: event.target.value }))} />
                <button type="submit" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy || fresh.name.trim() === "" || freshRate === null}>
                  <Icon name="plus" size={14} />
                  {t("aset.prices.add")}
                </button>
                <span>{t(canRemove ? "aset.prices.foot" : "aset.prices.foot.manager")}</span>
              </form>
            )}
          </>
        )}
      </Loaded>
    </Card>
  );
}

function Reps({ session, round }: { session: StaffSession; round: number }) {
  const t = useT();
  const toasts = useToasts();
  const canAdd = session.can("reps", "create");
  const canRemove = session.can("reps", "delete");
  const { load, reload } = useLoad(
    async () => {
      const [rows, people, offered] = await Promise.all([
        session.list<RepRow>("reps", { select: ["id", "user_id", "hours_from", "hours_to"], order: ["id"], limit: 200 }).then((page) => page.rows),
        peopleOf(session),
        canAdd ? session.people(undefined, 200).catch(() => []) : Promise.resolve([]),
      ]);
      return { rows, names: { ...people.names, ...Object.fromEntries(offered.map((one) => [one.id, one.name])) }, offered };
    },
    [session, canAdd, round],
  );
  const soon = useCoalesced(reload);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const addKey = useRef<string | null>(null);
  const add = async (names: Record<string, string>): Promise<void> => {
    if (pick === "") return;
    addKey.current ??= newClientKey();
    setBusy(true);
    const made = await toasts.say(session.create("reps", { user_id: pick }, addKey.current), () => t("aset.reps.added", { name: names[pick] ?? "" }));
    setBusy(false);
    if (made !== null) {
      addKey.current = null;
      setPick("");
    }
    soon();
  };
  const remove = async (row: RepRow, name: string): Promise<void> => {
    setBusy(true);
    await toasts.say(session.remove("reps", row.id), () => t("aset.reps.removed", { name }));
    setBusy(false);
    soon();
  };
  return (
    <Card name="reps" flush title={t("aset.reps.title")} sub={t("aset.reps.sub")}>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={44} />}>
        {(data) => {
          const has = new Set(data.rows.map((row) => row.user_id));
          const free = data.offered.filter((one) => !has.has(one.id));
          return (
            <>
              <div role="list" aria-label={t("aset.reps.title")} className="crm-ast-rows" aria-busy={busy}>
                {data.rows.length === 0 && <p className="crm-ast-none">{t("aset.reps.none")}</p>}
                {data.rows.map((row) => {
                  const name = data.names[row.user_id] ?? t("aset.reps.someone");
                  return (
                    <div key={row.id} role="listitem" className="crm-ast-row" data-row={row.id} data-name={name}>
                      <span className="crm-ast-name">{name}</span>
                      <span className="crm-ast-count crm-mono">{row.hours_from !== null && row.hours_to !== null && row.hours_from !== "" ? t("aset.reps.hours", { from: row.hours_from, to: row.hours_to }) : t("aset.reps.hours.none")}</span>
                      {canRemove && (
                        <button type="button" className="crm-icon-btn mr-gi" data-remove disabled={busy} aria-label={t("aset.reps.remove", { name })} onClick={() => void remove(row, name)}>
                          <Icon name="trash-2" size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {canAdd ? (
                <form
                  className="crm-ast-foot crm-ast-add"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void add(data.names);
                  }}
                >
                  <select className="crm-ast-input crm-ast-select mr-fld" value={pick} aria-label={t("aset.reps.pick")} onChange={(event) => setPick(event.target.value)}>
                    <option value="">{t("aset.reps.pick")}</option>
                    {free.map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy || pick === ""}>
                    <Icon name="plus" size={14} />
                    {t("aset.reps.add")}
                  </button>
                  <span>{t("aset.reps.foot")}</span>
                </form>
              ) : (
                <div className="crm-ast-foot">
                  <span>{t("aset.reps.foot.read")}</span>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </Card>
  );
}

/**
 * ONE live stream for the whole tab. Each stream is a connection the browser
 * holds open, and it holds six to one server at most: a person with this page
 * and another of the app's pages open would otherwise run out, and every
 * further request would wait. A frame for the price list or the reps reads
 * that list again; any other reads the tab's figures again.
 */
function useOneStream(session: StaffSession, others: () => void): { price_list: number; reps: number } {
  const [rounds, setRounds] = useState({ price_list: 0, reps: 0 });
  const latest = useRef(others);
  latest.current = others;
  const tables = ["settings", "stages", "lost_reasons", ...(session.can("deals", "read") ? ["deals"] : []), ...(session.part("quotes") && session.can("price_list", "read") ? ["price_list"] : []), ...(session.can("reps", "read") ? ["reps"] : [])];
  const key = tables.join(",");
  useEffect(() => {
    const own = (ref: "price_list" | "reps"): string | null => (key.split(",").includes(ref) ? `:${session.tableId(ref)}` : null);
    const price = own("price_list");
    const reps = own("reps");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = { price_list: false, reps: false, others: false };
    const flush = (): void => {
      timer = null;
      if (pending.price_list || pending.reps) setRounds((was) => ({ price_list: was.price_list + (pending.price_list ? 1 : 0), reps: was.reps + (pending.reps ? 1 : 0) }));
      if (pending.others) latest.current();
      pending.price_list = pending.reps = pending.others = false;
    };
    const heard = (channel: string | null): void => {
      if (channel !== null && price !== null && channel.endsWith(price)) pending.price_list = true;
      else if (channel !== null && reps !== null && channel.endsWith(reps)) pending.reps = true;
      else pending.others = true;
      timer ??= setTimeout(flush, 250);
    };
    const stop = session.listen(key.split(","), (frame) => heard(frame.channel), () => {
      pending.price_list = pending.reps = true;
      heard(null);
    });
    return () => {
      stop();
      if (timer !== null) clearTimeout(timer);
    };
  }, [session, key]);
  return rounds;
}

export function Selling({ session, f, rights }: { session: StaffSession; f: Formatters; rights: Rights }) {
  const t = useT();
  const { load, reload } = useLoad(() => readSelling(session, f), [session, f]);
  const rules = useLoad(() => readRules(session), [session]);
  // Only the person who runs the install may read Adminium's own settings: nobody else is made to ask and be refused.
  const links = useLoad(() => (session.part("quotes") && rights.all && !(session.config.access?.roles ?? []).some((role) => role.slug.startsWith("crm-")) ? readLinks(session) : Promise.resolve("unknown" as const)), [session, rights.all]);
  const soon = useCoalesced(reload);
  const rounds = useOneStream(session, soon);
  const row = load.state === "ready" ? load.data.settings : null;
  const { save } = useSaveSettings(session, row, soon);
  const again = useCallback(() => reload(), [reload]);
  const ruleOn = rules.load.state === "ready" ? rules.load.data : null;
  const linkState = links.load.state === "ready" ? links.load.data : "unknown";
  const days = (n: number): string => t("aset.unit.days", undefined, n);

  return (
    <div role="tabpanel" aria-label={t("aset.tab.selling")} className="crm-ast-panel" data-panel="selling">
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={4} height={140} />}>
        {(data: SellingData) => {
          const value = (column: string): unknown => data.settings?.[column];
          const field = (column: string, label: MessageKey, unit: string, hint?: string, more: { min?: number; max?: number; whole?: boolean } = {}) => (
            <NumField key={column} column={column} label={t(label)} unit={unit} hint={hint} value={value(column)} canWrite={rights.column(column) && data.settings !== null} f={f} onSave={(next, fresh) => save({ [column]: next }, t("aset.saved", { what: t(label) }), fresh)} {...more} />
          );
          const ruleNote = (key: string): string => (ruleOn === null || ruleOn[key] === undefined ? "" : ` · ${t(ruleOn[key] === true ? "aset.rule.on" : "aset.rule.off")}`);
          const caught = (n: number, key: string): string => `${t("aset.nudges.caught", { count: f.number(n) }, n)}${ruleNote(key)}`;
          return (
            <>
              <Card
                name="stages"
                flush
                title={t("aset.stages.title")}
                sub={t("aset.stages.sub")}
                aside={
                  session.can("deals", "read") ? (
                    <>
                      <span className="crm-ast-aside-label">{t("aset.stages.weighted")}</span>
                      <span className="crm-mono crm-ast-aside-figure" data-figure="weighted">
                        {f.money(data.weighted)}
                      </span>
                      <span className="crm-mono crm-ast-aside-count" data-figure="open">
                        {t("aset.open", { count: f.number(data.open) }, data.open)}
                      </span>
                    </>
                  ) : undefined
                }
              >
                <Ordered table="stages" rows={data.stages} session={session} f={f} after={soon} counts={(stage) => t("aset.open", { count: f.number(data.byStage[String(stage.id)]?.open ?? 0) }, data.byStage[String(stage.id)]?.open ?? 0)} removable={(stage) => (data.byStage[String(stage.id)]?.all ?? 0) === 0} />
              </Card>

              <Card name="reasons" flush title={t("aset.reasons.title")} sub={t("aset.reasons.sub")} aside={session.can("deals", "read") ? <span className="crm-mono" data-figure="lost">{t("aset.lost", { count: f.number(data.lost) }, data.lost)}</span> : undefined}>
                <Ordered table="lost_reasons" rows={data.reasons} session={session} f={f} after={soon} counts={(reason) => t("aset.lost", { count: f.number(data.byReason[String(reason.id)] ?? 0) }, data.byReason[String(reason.id)] ?? 0)} removable={(reason) => (data.byReason[String(reason.id)] ?? 0) === 0} />
              </Card>

              <div className="crm-ast-grid">
                {session.part("quotes") && (
                  <Card name="quotes" title={t("aset.quotes.title")} sub={t("aset.quotes.sub")}>
                    <div className="crm-ast-fields">
                      {field("approval_threshold_pct", "aset.quotes.approval", t("aset.unit.underList"), undefined, { whole: false })}
                      {field("quote_valid_days", "aset.quotes.valid", days(num(value("quote_valid_days"))))}
                      {field("quote_warn_days", "aset.quotes.warn", days(num(value("quote_warn_days"))))}
                    </div>
                    <AskLine>{t(linkState === "set" ? "aset.links.set" : linkState === "unset" ? "aset.links.unset" : "aset.links.unknown")}</AskLine>
                  </Card>
                )}
                <Card name="sitting" title={t("aset.sitting.title")} sub={t("aset.sitting.sub")}>
                  <div className="crm-ast-fields">
                    {field("sitting_warm_days", "aset.sitting.warm", days(num(value("sitting_warm_days"))), t("aset.sitting.warm.now", { count: f.number(data.warm) }, data.warm), { max: num(value("sitting_stale_days")) - 1 })}
                    {field("sitting_stale_days", "aset.sitting.stale", days(num(value("sitting_stale_days"))), t("aset.sitting.stale.now", { count: f.number(data.stale) }, data.stale), { min: num(value("sitting_warm_days")) + 1 })}
                  </div>
                </Card>
                <Card name="nudges" title={t("aset.nudges.title")} sub={t("aset.nudges.sub")}>
                  <div className="crm-ast-fields">
                    {field("nudge_quiet_days", "aset.nudges.quiet", days(num(value("nudge_quiet_days"))), caught(data.caught.quiet, "nudge-quiet"))}
                    {field("nudge_stuck_days", "aset.nudges.stuck", days(num(value("nudge_stuck_days"))), caught(data.caught.stuck, "nudge-stuck"))}
                    {field("nudge_soon_days", "aset.nudges.soon", days(num(value("nudge_soon_days"))), caught(data.caught.soon, "nudge-soon"))}
                  </div>
                  <AskLine>{t(ruleOn === null ? "aset.rules.unknown" : "aset.rules.note")}</AskLine>
                </Card>
                {session.part("inbox") && rights.readsAll && (
                  <Card name="enquiries" title={t("aset.enquiries.title")} sub={t("aset.enquiries.sub")}>
                    <div className="crm-ast-fields">{field("lead_cold_days", "aset.enquiries.cold", days(num(value("lead_cold_days"))))}</div>
                  </Card>
                )}
              </div>
            </>
          );
        }}
      </Loaded>
      {session.part("quotes") && session.can("price_list", "read") && <PriceList session={session} f={f} round={rounds.price_list} />}
      {session.can("reps", "read") && <Reps session={session} round={rounds.reps} />}
    </div>
  );
}
