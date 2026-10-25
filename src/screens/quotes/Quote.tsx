/**
 * ONE QUOTE, open on one of its versions.
 *
 * The versions sit in a strip; the newest is the one that is worked on. A
 * draft's lines are changed here, a line at a time: each change is saved when
 * the field is left, and the totals are read back from the server, which
 * works them out (a line's amount, the list value, how far under list the
 * version is, whether it needs approval). Nothing is added up on this page.
 *
 * A line either picks an item of the price list, whose list price is shown
 * and never typed, or is a line of the rep's own, which has no list price
 * and so needs approval.
 *
 * WHAT CAN BE DONE, and the server holds each: send (a draft that may be
 * sent: at list, or approved for what it is), ask for approval (with why),
 * start a new version (a copy of the newest, which that one then replaces).
 * Sending a version withdraws the one it replaces in the same save.
 *
 * A rep HELPING on the deal (ruling 1d, `selling/helping.ts`) reads every
 * version and changes, sends and asks nothing: the deal's owner does, and
 * the page says so.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { addDays, formatters, noonOf } from "../../lib/format.ts";
import { useHelping } from "../../selling/helping.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import { canOpen, type MenuFacts, type PartId } from "../../shell/routes.ts";
import { isBuilt } from "../../shell/screens.tsx";
import { newClientKey, type StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { createQuote, editable, familyNo, held, LINE_COLUMNS, newest, num, readNames, readQuotes, stateOf, TONE, type Line, type Quote, type QuoteState } from "./data.ts";

interface Price extends Record<string, unknown> {
  id: number;
  name: string;
  list_rate: number | string;
}
interface DealFacts extends Record<string, unknown> {
  id: number;
  name: string;
  contact_id: number | null;
  amount: number | string;
  contact: string | null;
}
interface QuoteData {
  family: Quote[];
  lines: Line[];
  prices: Price[];
  deal: DealFacts | null;
  names: Record<string, string>;
  validDays: number;
  warnDays: number;
}

/** What does not change with a save: the price list and the two settings a quote reads. Asked once per page. */
async function readFixed(session: StaffSession): Promise<{ prices: Price[]; validDays: number; warnDays: number }> {
  const [prices, settings] = await Promise.all([
    session.can("price_list", "read") ? session.list<Price>("price_list", { select: ["id", "name", "list_rate"], where: { column: "active", op: "eq", value: true }, order: ["name"], limit: 200 }) : Promise.resolve({ rows: [] as Price[] }),
    session.can("settings", "read") ? session.list<{ quote_valid_days: number | null; quote_warn_days: number | null }>("settings", { select: ["quote_valid_days", "quote_warn_days"], limit: 1 }).then((page) => page.rows[0] ?? null) : Promise.resolve(null),
  ]);
  return { prices: prices.rows, validDays: num(settings?.quote_valid_days) || 30, warnDays: num(settings?.quote_warn_days) || 3 };
}

async function read(session: StaffSession, id: number, fixed: Promise<{ prices: Price[]; validDays: number; warnDays: number }>): Promise<QuoteData | null> {
  const one = await session.get<Quote>("quotes", id);
  if (one === null) return null;
  const [all, lines, deal, rest] = await Promise.all([
    readQuotes(session, { column: "deal_id", op: "eq", value: one.deal_id }),
    session.list<Line>("quote_lines", { select: LINE_COLUMNS, where: { column: "document_id", op: "eq", value: id }, order: ["position", "id"], limit: 200 }),
    session.get<DealFacts>("deals", one.deal_id, { lookup: ["contact:contact_id.name"] }),
    fixed,
  ]);
  // The quote read by itself carries what its reader's role shows of it; the list asks for fewer columns. Where the link went comes from the first.
  const family = all.filter((quote) => (quote.family_no ?? quote.number) === (one.family_no ?? one.number)).sort((a, b) => a.version - b.version).map((quote) => (quote.id === id ? { ...quote, sent_to_email: one.sent_to_email ?? null, to_email: one.to_email ?? null } : quote));
  if (!family.some((quote) => quote.id === id)) return null;
  const names = await readNames(session, family.flatMap((quote) => [quote.owner_id, quote.asked_by_id, quote.decided_by_id]));
  return { family, lines: lines.rows, deal, names, ...rest };
}

export function QuotePage({ id }: { id: string }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const nav = useNav();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const key = Number(id);
  const fixed = useMemo(() => readFixed(session), [session]);
  const { load, reload } = useLoad(() => (Number.isInteger(key) ? read(session, key, fixed) : Promise.resolve(null)), [session, key, fixed]);
  // A save's own "read again" and the live frame it sets off are one read.
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["quotes", "quote_lines"], again);
  const facts = useMemo<MenuFacts>(
    () => ({ roles: (config.access?.roles ?? []).map((role) => role.slug), part: (part: PartId) => session.part(part), reads: (table) => session.can(table, "read"), built: isBuilt }),
    [config, session],
  );
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [key]);

  // A helper on the deal reads its quotes and changes none (null: still being read, so nothing is offered yet).
  const ownerId = load.state === "ready" && load.data !== null ? (load.data.family.find((one) => one.id === key) ?? load.data.family[0])?.owner_id : undefined;
  const helping = useHelping(ownerId, today);
  const canWrite = session.can("quotes", "update") && session.can("quote_lines", "update") && helping === false;

  const back = (
    <ScreenLink to="quotes" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
      <Icon name="chevron-left" size={14} className="crm-flip" />
      {t("quote.back")}
    </ScreenLink>
  );

  return (
    <div className="crm-screen crm-quote mr-screen" data-screen="quote">
      {back}
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={4} height={90} />}>
        {(data) => {
          if (data === null) {
            return (
              <div className="crm-empty crm-quote-none">
                <span className="crm-empty-icon">
                  <Icon name="file-text" size={22} />
                </span>
                <div className="crm-empty-title">{t("quote.none")}</div>
                <p>{t("quote.none.body")}</p>
              </div>
            );
          }
          const quote = data.family.find((one) => one.id === key);
          // The address moved to another quote and its read is still on its way: what is held is the one before.
          if (quote === undefined) return <Skeleton rows={4} height={90} />;
          const last = newest(data.family);
          const state = stateOf(quote, data.family, today);
          const lastState = stateOf(last, data.family, today);
          const has = held(data.family);
          const isNewest = quote.id === last.id;
          const edit = canWrite && isNewest && editable(quote) && !busy;
          const who = (userId: string | null): string => (userId === null ? "" : (data.names[userId] ?? t("closed.someone")));
          const day = (value: string | null): string => (value === null ? "" : f.date(noonOf(value.slice(0, 10))));
          const moment = (value: string | null): string => (value === null ? "" : `${f.dayShort(new Date(value))}, ${f.time(new Date(value))}`);
          // Who it goes to: the contact the quote names (the deal's, from the day the quote was made). Once sent, who it went to.
          const contact = quote.status === "draft" ? quote.to_name : (quote.sent_to_name ?? quote.to_name);
          const linesOk = data.lines.length > 0 && data.lines.every((line) => (line.description ?? "").trim() !== "" && num(line.qty) > 0) && num(quote.total) > 0;
          const maySend = num(quote.may_send) === 1;
          const over = num(quote.needs_approval) === 1;
          // A closed deal takes no new quote, and a draft of it is not sent (plan 68 R1a; the server refuses both).
          const dealOpen = quote.deal_state === null || quote.deal_state === undefined || quote.deal_state === "open";

          const save = async (work: () => Promise<unknown>): Promise<void> => {
            setBusy(true);
            await work();
            setBusy(false);
            again();
          };
          const changeLine = (line: Line, values: Record<string, unknown>) => save(() => toasts.say(session.update("quote_lines", line.id, values), () => t("quote.toast.line")));
          const pick = (line: Line, priceId: string) => {
            const price = data.prices.find((one) => String(one.id) === priceId);
            // An item of the price list brings its name and its list price, which the rep then changes if she is quoting under it. "A line of my own" keeps what is typed and has no list price.
            return changeLine(line, price === undefined ? { price_id: null } : { price_id: price.id, description: price.name, rate: num(price.list_rate) });
          };
          const addLine = () =>
            save(() => toasts.say(session.create("quote_lines", { document_id: quote.id, position: data.lines.reduce((max, line) => Math.max(max, line.position), -1) + 1, description: "", qty: 1, rate: 0 }, newClientKey()), () => t("quote.toast.lineAdded")));
          const removeLine = (line: Line) => save(() => toasts.say(session.remove("quote_lines", line.id), () => t("quote.toast.lineRemoved")));
          const swap = (line: Line, other: Line) =>
            save(async () => {
              const first = await session.update("quote_lines", line.id, { position: other.position });
              if (first.state === "saved") await toasts.say(session.update("quote_lines", other.id, { position: line.position }), () => t("quote.toast.line"));
              else await toasts.say(Promise.resolve(first), () => "");
            });
          const send = () =>
            save(async () => {
              const until = addDays(today, data.validDays);
              await toasts.say(
                session.update<Quote>("quotes", quote.id, { status: "sent", valid_until: until }, { seen: { status: "draft" } }),
                (row) => t("quote.toast.sent", { number: row.number ?? "", name: firstName(contact ?? ""), amount: f.money(row.subtotal) }),
              );
            });
          const ask = () =>
            save(async () => {
              const done = await toasts.say(session.act("quotes", quote.id, "ask-approval", "draft", { values: { ask_reason: reason.trim() }, stateColumn: "approval" }), () => t("quote.toast.asked"));
              if (done !== null) setReason("");
            });
          const newVersion = () =>
            save(async () => {
              const source = isNewest ? data.lines : (await session.list<Line>("quote_lines", { select: LINE_COLUMNS, where: { column: "document_id", op: "eq", value: last.id }, order: ["position", "id"], limit: 200 })).rows;
              // It replaces the newest version, which sending it will withdraw. A version the customer declined is not named: it stays declined, and the next one is a quote of its own.
              const { saved } = await createQuote(
                session,
                { deal_id: last.deal_id, version: last.version + 1, ...(last.status === "declined" ? {} : { replaces_id: last.id }), family_no: familyNo(data.family), ...(last.notes === null ? {} : { notes: last.notes }), ...(last.sent_to_contact_id === null ? {} : { sent_to_contact_id: last.sent_to_contact_id }) },
                source.map((line) => ({ description: line.description, qty: line.qty, rate: line.rate, price_id: line.price_id })),
              );
              const made = await toasts.say(Promise.resolve(saved), (row) => t("quote.toast.version", { n: row.version, number: row.number ?? "" }));
              if (made !== null) nav.go("quotes", made.id);
            });
          const saveNotes = (text: string) => (text === (quote.notes ?? "") ? Promise.resolve() : save(() => toasts.say(session.update("quotes", quote.id, { notes: text === "" ? null : text }), () => t("quote.toast.notes"))));

          const banner = ((): string | null => {
            if (!isNewest) return t("quote.banner.old", { n: quote.version, newest: last.version, state: t(`quotes.state.${lastState}` as MessageKey).toLowerCase() });
            const customer = has === null || has.id === quote.id ? "" : ` ${t("quote.banner.customerHas", { n: has.version, amount: f.money(has.total) })}`;
            switch (state) {
              case "ranOut":
                return t("quote.banner.ranOut", { day: day(quote.valid_until) });
              case "sent": {
                const left = quote.valid_until === null ? null : f.dayDiff(now, noonOf(quote.valid_until.slice(0, 10)));
                return left !== null && left <= data.warnDays ? t("quote.banner.runsOut", { day: f.dayShort(noonOf(quote.valid_until!.slice(0, 10))) }, left) : null;
              }
              case "refused":
                return `${t("quote.banner.refused", { name: who(quote.decided_by_id), when: moment(quote.approval_decided_at) })}${quote.decision_note === null ? "" : ` “${quote.decision_note}”`} ${t("quote.banner.refused.next")}`;
              case "waiting":
                return t("quote.banner.waiting", { when: moment(quote.asked_at) });
              case "approved":
                return `${t("quote.banner.approved", { name: who(quote.decided_by_id), when: moment(quote.approval_decided_at), pct: f.number(Math.round(num(quote.approved_pct) * 10) / 10) })}${customer}`;
              case "accepted":
                return quote.accepted_via === "customer" ? t("quote.banner.accepted", { name: quote.accepted_name ?? contact ?? "", when: moment(quote.decided_at) }) : t("quote.banner.accepted.staff", { when: moment(quote.decided_at) });
              case "declined":
                return t("quote.banner.declined", { when: moment(quote.decided_at) });
              case "replaced":
                return t("quote.banner.replaced");
              case "withdrawn":
                return t("quote.banner.withdrawn", { when: moment(quote.decided_at) });
              default:
                return null;
            }
          })();
          const canNew = canWrite && dealOpen && !(["draft", "waiting", "approved", "refused", "accepted"] as QuoteState[]).includes(lastState);

          return (
            <>
              <div className="crm-quote-head">
                <div className="crm-quote-head-main">
                  <div className="crm-quote-head-line">
                    <span className="crm-mono crm-quote-family">{familyNo(data.family)}</span>
                    <span className="crm-pill" data-tone={TONE[state]} data-testid="quote-state">
                      {t(`quotes.state.${state}` as MessageKey)}
                    </span>
                  </div>
                  <h1>{quote.deal}</h1>
                  <div className="crm-quote-who">
                    {quote.company !== null && (
                      <span className="crm-chip">
                        <span className="crm-dot" data-tone="accent" />
                        {quote.company}
                      </span>
                    )}
                    {quote.owner_id !== null && <span>{who(quote.owner_id)}</span>}
                  </div>
                </div>
                {canOpen("deal", facts) && (
                  <ScreenLink to="deal" rest={[quote.deal_id]} className="crm-btn crm-btn-ghost crm-btn-38 mr-gi">
                    <Icon name="panel-right-open" size={15} />
                    {t("room.open")}
                  </ScreenLink>
                )}
                {canOpen("pipeline", facts) && isBuilt("pipeline") && (
                  <ScreenLink to="pipeline" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi">
                    <Icon name="columns-3" size={15} />
                    {t("quote.toBoard")}
                  </ScreenLink>
                )}
              </div>

              <div className="crm-versions" role="group" aria-label={t("quote.versions")}>
                {data.family.map((one) => {
                  const its = stateOf(one, data.family, today);
                  return (
                    <ScreenLink key={one.id} to="quotes" rest={[one.id]} className="crm-version mr-chip" current={one.id === quote.id}>
                      <span className="crm-version-name">{t("quote.version", { n: one.version })}</span>
                      <span className="crm-mono crm-version-no">{one.number}</span>
                      <span className="crm-version-state">{t(`quotes.state.${its}` as MessageKey)}</span>
                      <span className="crm-mono crm-version-total">{f.money(one.total)}</span>
                    </ScreenLink>
                  );
                })}
                {canNew && (
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" disabled={busy} onClick={() => void newVersion()}>
                    <Icon name="plus" size={15} />
                    {t("quote.newVersion")}
                  </button>
                )}
              </div>

              {helping === true && dealOpen && (
                <div className="crm-banner" role="status" data-tone="info" data-testid="quote-helping">
                  {t("help.quote", { owner: firstName(who(quote.owner_id)) })}
                </div>
              )}

              {banner !== null && (
                <div className="crm-banner" role="status" data-tone={TONE[state]} data-testid="quote-banner">
                  {banner}
                </div>
              )}

              <div className="crm-quote-grid">
                <section className="crm-quote-lines" aria-label={t("quote.lines")}>
                  <div className="crm-lines-scroll mr-scroll">
                    <table className="crm-lines">
                      <thead>
                        <tr>
                          <th scope="col">{t("quote.col.description")}</th>
                          <th scope="col" className="crm-num">{t("quote.col.qty")}</th>
                          <th scope="col" className="crm-num">{t("quote.col.rate")}</th>
                          <th scope="col" className="crm-num">{t("quote.col.list")}</th>
                          <th scope="col" className="crm-num">{t("quote.col.total")}</th>
                          {edit && <th scope="col">{t("quote.col.order")}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {data.lines.map((line, at) => (
                          <tr key={`${String(line.id)}:${String(line.description)}:${String(line.qty)}:${String(line.rate)}:${String(line.price_id)}`} data-line={line.id}>
                            <td>
                              {edit ? (
                                <div className="crm-line-what">
                                  <select className="crm-input crm-input-sm mr-fld" aria-label={t("quote.line.from")} value={line.price_id === null ? "" : String(line.price_id)} onChange={(event) => void pick(line, event.target.value)}>
                                    <option value="">{t("quote.line.own")}</option>
                                    {data.prices.map((price) => (
                                      <option key={price.id} value={price.id}>
                                        {price.name}
                                      </option>
                                    ))}
                                  </select>
                                  <input className="crm-input crm-input-sm mr-fld" aria-label={t("quote.col.description")} defaultValue={line.description ?? ""} maxLength={400} placeholder={t("quote.line.what")} onBlur={(event) => event.target.value !== (line.description ?? "") && void changeLine(line, { description: event.target.value })} />
                                </div>
                              ) : (
                                line.description
                              )}
                            </td>
                            <td className="crm-num crm-mono">
                              {edit ? <input className="crm-input crm-input-sm crm-input-num crm-mono mr-fld" inputMode="decimal" aria-label={t("quote.col.qty")} defaultValue={String(num(line.qty))} onBlur={(event) => { const typed = f.readAmount(event.target.value); if (typed !== null && typed !== num(line.qty)) void changeLine(line, { qty: typed }); }} /> : f.number(num(line.qty))}
                            </td>
                            <td className="crm-num crm-mono">
                              {edit ? <input className="crm-input crm-input-sm crm-input-num crm-mono mr-fld" inputMode="decimal" aria-label={t("quote.col.rate")} defaultValue={line.rate === null ? "" : String(num(line.rate))} onBlur={(event) => { const typed = event.target.value.trim() === "0" ? 0 : f.readAmount(event.target.value); if (typed !== null && typed !== num(line.rate)) void changeLine(line, { rate: typed }); }} /> : f.money(line.rate)}
                            </td>
                            <td className="crm-num crm-mono crm-line-list">{line.list_rate === null ? <span className="crm-line-unlisted">{t("quote.line.unlisted")}</span> : f.money(line.list_rate)}</td>
                            <td className="crm-num crm-mono crm-line-amount">{f.money(line.amount)}</td>
                            {edit && (
                              <td className="crm-line-order">
                                <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("quote.line.up", { what: line.description ?? "" })} disabled={at === 0} onClick={() => void swap(line, data.lines[at - 1]!)}>
                                  <Icon name="chevron-up" size={14} />
                                </button>
                                <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("quote.line.down", { what: line.description ?? "" })} disabled={at === data.lines.length - 1} onClick={() => void swap(line, data.lines[at + 1]!)}>
                                  <Icon name="chevron-down" size={14} />
                                </button>
                                {session.can("quote_lines", "delete") && (
                                  <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("quote.line.remove", { what: line.description ?? "" })} disabled={data.lines.length === 1} onClick={() => void removeLine(line)}>
                                    <Icon name="trash-2" size={14} />
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {edit && (
                    <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 crm-line-add mr-gi" onClick={() => void addLine()}>
                      <Icon name="plus" size={14} />
                      {t("quote.line.add")}
                    </button>
                  )}

                  <dl className="crm-totals">
                    <div>
                      <dt>{t("quote.total.list")}</dt>
                      <dd className="crm-mono" data-testid="quote-list-value">{f.money(quote.list_value)}</dd>
                    </div>
                    {num(quote.tax) !== 0 && (
                      <>
                        <div>
                          <dt>{t("quote.total.before")}</dt>
                          <dd className="crm-mono">{f.money(quote.subtotal)}</dd>
                        </div>
                        <div>
                          <dt>{quote.tax_name ?? t("quote.total.tax")} {f.number(num(quote.tax_rate))}%</dt>
                          <dd className="crm-mono">{f.money(quote.tax)}</dd>
                        </div>
                      </>
                    )}
                    <div className="crm-totals-total">
                      <dt>{t("quote.total")}</dt>
                      <dd className="crm-mono" data-testid="quote-total">{f.money(quote.total)}</dd>
                    </div>
                    <div className="crm-totals-under" data-over={over ? "1" : "0"} data-testid="quote-under">
                      {num(quote.unlisted_lines) > 0 ? t("quote.under.unlisted", undefined, num(quote.unlisted_lines)) : num(quote.under_list_pct) > 0 ? t("quote.under", { pct: f.number(Math.round(num(quote.under_list_pct) * 10) / 10) }) : t("quote.under.none")}
                    </div>
                  </dl>
                  {over && quote.status === "draft" && quote.approval !== "approved" && <p className="crm-threshold">{t("quote.threshold", { pct: f.number(num(quote.threshold_pct)) })}</p>}

                  <div className="crm-label" id="crm-quote-notes">{t("quote.notes")}</div>
                  {edit ? (
                    <textarea key={`notes:${String(quote.id)}:${quote.notes ?? ""}`} className="crm-input crm-textarea mr-fld" aria-labelledby="crm-quote-notes" defaultValue={quote.notes ?? ""} maxLength={2000} placeholder={t("quote.notes.hint")} onBlur={(event) => void saveNotes(event.target.value.trim())} />
                  ) : (
                    <p className="crm-quote-notes">{quote.notes ?? t("quote.notes.none")}</p>
                  )}
                </section>

                <aside className="crm-quote-side">
                  <section className="crm-side-card" aria-label={t("quote.facts")}>
                    <h2>{t("quote.facts")}</h2>
                    <dl className="crm-facts-list">
                      <div>
                        <dt>{t("quote.fact.number")}</dt>
                        <dd className="crm-mono">{quote.number}{quote.replaces_id === null ? "" : ` · ${t("quote.fact.replaces", { number: data.family.find((one) => one.id === quote.replaces_id)?.number ?? "" })}`}</dd>
                      </div>
                      <div>
                        <dt>{t("quote.fact.version")}</dt>
                        <dd>{t("quote.fact.versionOf", { n: quote.version, all: data.family.length })}</dd>
                      </div>
                      {quote.valid_until !== null && (
                        <div>
                          <dt>{t("quote.fact.validUntil")}</dt>
                          <dd className="crm-mono">{day(quote.valid_until)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>{t("quote.fact.for")}</dt>
                        <dd>{contact ?? t("quote.fact.noContact")}</dd>
                      </div>
                      {quote.sent_at !== null && (
                        <div>
                          <dt>{t("quote.fact.sent")}</dt>
                          <dd className="crm-mono">{moment(quote.sent_at)}</dd>
                        </div>
                      )}
                      {quote.asked_by_id !== null && (
                        <div>
                          <dt>{t("quote.fact.askedBy")}</dt>
                          <dd>{who(quote.asked_by_id)} · <span className="crm-mono">{moment(quote.asked_at)}</span></dd>
                        </div>
                      )}
                      {quote.decided_by_id !== null && (quote.approval === "approved" || quote.approval === "refused") && (
                        <div>
                          <dt>{t(quote.approval === "approved" ? "quote.fact.approvedBy" : "quote.fact.refusedBy")}</dt>
                          <dd>{who(quote.decided_by_id)} · <span className="crm-mono">{moment(quote.approval_decided_at)}</span></dd>
                        </div>
                      )}
                      <div>
                        <dt>{t("quote.fact.customerHas")}</dt>
                        <dd className="crm-mono" data-testid="quote-customer-has">{has === null ? t("quote.fact.nothingYet") : `${has.number ?? ""} · ${f.money(has.total)}`}</dd>
                      </div>
                    </dl>
                  </section>

                  {canWrite && isNewest && quote.status === "draft" && !dealOpen && (
                    <section className="crm-side-card" data-panel="closed-deal">
                      <p className="crm-side-note" data-testid="quote-closed-deal">
                        {t("quote.closedDeal")}
                      </p>
                    </section>
                  )}

                  {canWrite && isNewest && dealOpen && quote.status === "draft" && quote.approval !== "asked" && maySend && (
                    <section className="crm-side-card" data-panel="send">
                      <h2>{t("quote.send")}</h2>
                      {contact === null ? (
                        <>
                          <p className="crm-side-note">{t(data.deal?.contact_id == null ? "quote.send.noContact" : "quote.send.useContact", { name: data.deal?.contact ?? "" })}</p>
                          {data.deal?.contact_id != null && (
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={() => void save(() => toasts.say(session.update("quotes", quote.id, { sent_to_contact_id: data.deal!.contact_id }), () => t("quote.toast.contact", { name: data.deal!.contact ?? "" })))}>
                              {t("quote.send.setContact", { name: data.deal.contact ?? "" })}
                            </button>
                          )}
                        </>
                      ) : (
                        <p className="crm-side-note">{t("quote.send.body", { name: contact, until: f.date(noonOf(addDays(today, data.validDays))), amount: f.money(quote.subtotal) })} {t("quote.send.link")}{has !== null && has.id !== quote.id ? ` ${t("quote.send.replaces", { number: has.number ?? "" })}` : ""}</p>
                      )}
                      {/* The address it goes to, as the contact holds it now: the sender sees it before it leaves (a contact's address is where the customer's link is mailed). */}
                      {contact !== null && typeof quote.to_email === "string" && quote.to_email !== "" && (
                        <p className="crm-side-note crm-mono" data-testid="quote-goes-to">{t("quote.send.goesTo", { address: quote.to_email })}</p>
                      )}
                      {!linesOk && <p className="crm-side-check">{t("quote.linesCheck")}</p>}
                      <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" disabled={busy || !linesOk || contact === null} onClick={() => void send()}>
                        <Icon name="send" />
                        {contact === null ? t("quote.send") : t("quote.send.to", { name: contact })}
                      </button>
                    </section>
                  )}

                  {(state === "sent" || state === "ranOut" || state === "accepted" || state === "declined") && (
                    // The link is the customer's own: it leaves by e-mail and nobody on the staff reads it, so there is nothing here to copy.
                    <section className="crm-side-card" data-info="customer-page">
                      <h2>{t("quote.page.title")}</h2>
                      <p className="crm-side-note" data-testid="quote-customer-page">
                        {state === "sent"
                          ? t("quote.page.open", { name: contact ?? t("quote.page.someone"), day: quote.valid_until === null ? "" : f.date(noonOf(quote.valid_until)) })
                          : state === "ranOut"
                            ? t("quote.page.ranOut", { day: quote.valid_until === null ? "" : f.date(noonOf(quote.valid_until)) })
                            : state === "accepted"
                              ? quote.accepted_via === "customer"
                                ? t("quote.page.accepted", { name: quote.accepted_name ?? contact ?? t("quote.page.someone"), when: moment(quote.decided_at) })
                                : t("quote.page.accepted.staff", { when: moment(quote.decided_at) })
                              : t("quote.page.declined", { when: moment(quote.decided_at) })}
                      </p>
                      {/* Where the link went, as it was stamped at sending: an answer "by the customer" came through a link mailed there. */}
                      {typeof quote.sent_to_email === "string" && quote.sent_to_email !== "" && (
                        <p className="crm-side-note crm-mono" data-testid="quote-link-went-to">
                          {t("quote.page.wentTo", { address: quote.sent_to_email })}
                        </p>
                      )}
                    </section>
                  )}

                  {canWrite && isNewest && quote.status === "draft" && quote.approval !== "asked" && !maySend && over && (
                    <section className="crm-side-card" data-panel="ask">
                      <h2>{t("quote.ask")}</h2>
                      <label className="crm-label" htmlFor="crm-quote-why">{t("quote.ask.why")}</label>
                      <textarea id="crm-quote-why" className="crm-input crm-textarea mr-fld" value={reason} maxLength={600} disabled={busy} placeholder={t("quote.ask.hint")} onChange={(event) => setReason(event.target.value)} />
                      {!linesOk && <p className="crm-side-check">{t("quote.linesCheck")}</p>}
                      <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" disabled={busy || !linesOk || reason.trim() === ""} onClick={() => void ask()}>
                        <Icon name="stamp" />
                        {t("quote.ask")}
                      </button>
                    </section>
                  )}

                  {quote.status === "draft" && quote.approval === "asked" && (
                    <section className="crm-side-card" data-panel="asked">
                      <h2>{t("quote.asked")}</h2>
                      {quote.ask_reason !== null && <p className="crm-side-quote">“{quote.ask_reason}”</p>}
                      <p className="crm-side-note">{t(canOpen("approvals", facts) ? "quote.asked.decide" : "quote.asked.wait")}</p>
                      {canOpen("approvals", facts) && (
                        <ScreenLink to="approvals" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi">
                          <Icon name="stamp" />
                          {t("quote.asked.open")}
                        </ScreenLink>
                      )}
                    </section>
                  )}
                </aside>
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
