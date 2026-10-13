/**
 * APPROVALS: reps ask, the manager decides. A quote further under list than
 * the threshold, or with a line that has no list price, needs a yes before it
 * can be sent.
 *
 * A decision is one of the quote's own buttons on the server (`approve`,
 * `refuse`), with a line of why. The server keeps those buttons for the roles
 * that decide. A manager is not offered her own request here: somebody else
 * decides it. (That is this screen's rule; the server does not yet tell a
 * manager's own request from anybody else's.)
 *
 * "Ask for more" is a comment on the deal that mentions the rep who asked, so
 * the question has a record and an answer has somewhere to go.
 */
import { useCallback, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, noonOf } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey, type StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { num, readNames, readQuotes, type Quote } from "./data.ts";

type Filter = "waiting" | "decided" | "all";
type Doing = { id: number; what: "approve" | "refuse" | "more" } | null;

interface Data {
  asked: Quote[];
  /** What the customer holds on each deal: the deal's amount as it stands. */
  deals: Record<number, number>;
  names: Record<string, string>;
}

async function read(session: StaffSession): Promise<Data> {
  // Every version somebody asked about: waiting, approved or refused, sent or not.
  const asked = (await readQuotes(session, { column: "asked_at", op: "not_null" })).sort((a, b) => String(b.asked_at).localeCompare(String(a.asked_at)));
  const ids = [...new Set(asked.map((quote) => quote.deal_id))];
  const deals = ids.length === 0 ? [] : (await session.list<{ id: number; amount: number | string }>("deals", { select: ["id", "amount"], where: { column: "id", op: "in", value: ids }, limit: 200 })).rows;
  const names = await readNames(session, asked.flatMap((quote) => [quote.owner_id, quote.asked_by_id, quote.decided_by_id]));
  return { asked, deals: Object.fromEntries(deals.map((deal) => [deal.id, num(deal.amount)])), names };
}

export function Approvals(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const { load, reload } = useLoad(() => read(session), [session]);
  const again = useCallback(() => reload(), [reload]);
  useLive(["quotes"], again);
  const [filter, setFilter] = useState<Filter>("waiting");
  const [doing, setDoing] = useState<Doing>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const me = config.user?.id ?? null;
  const decides = session.can("quotes", "update");

  const open = (next: Doing, text = ""): void => {
    setDoing(next);
    setWhy(text);
  };

  const decide = async (quote: Quote, what: "approve" | "refuse", asker: string): Promise<void> => {
    setBusy(true);
    const done = await toasts.say(session.act("quotes", quote.id, what, "draft", { values: { decision_note: why.trim() }, stateColumn: "approval" }), () =>
      what === "approve" ? t("approvals.toast.approved", { name: firstName(asker) }) : t("approvals.toast.refused"),
    );
    setBusy(false);
    if (done !== null) open(null);
    again();
  };
  const askMore = async (quote: Quote, asker: string): Promise<void> => {
    if (quote.asked_by_id === null) return;
    setBusy(true);
    // A mention is stored as `@[Name](id)`: the rep is told, and the question sits on the deal.
    const done = await toasts.say(session.create("comments", { deal_id: quote.deal_id, text: `@[${asker}](${quote.asked_by_id}) ${why.trim()}` }, newClientKey()), () => t("approvals.toast.more", { name: firstName(asker) }));
    setBusy(false);
    if (done !== null) open(null);
  };

  return (
    <div className="crm-screen crm-approvals mr-screen" data-screen="approvals">
      <h1>{t("approvals.title")}</h1>
      <p className="crm-screen-sub">{t("approvals.sub")}</p>
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={3} height={150} />}>
        {(data) => {
          const waiting = data.asked.filter((quote) => quote.status === "draft" && quote.approval === "asked");
          const decided = data.asked.filter((quote) => quote.approval === "approved" || quote.approval === "refused");
          const shown = filter === "waiting" ? waiting : filter === "decided" ? decided : data.asked;
          return (
            <>
              <div className="crm-chips" role="group" aria-label={t("approvals.filter")}>
                {(
                  [
                    ["waiting", waiting.length],
                    ["decided", decided.length],
                    ["all", data.asked.length],
                  ] as const
                ).map(([key, count]) => (
                  <button key={key} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === key} data-filter={key} onClick={() => setFilter(key)}>
                    {t(`approvals.filter.${key}`)}
                    <span className="crm-chip-count crm-mono">{f.number(count)}</span>
                  </button>
                ))}
              </div>

              <ul className="crm-approval-list">
                {shown.map((quote) => {
                  const asker = quote.asked_by_id === null ? "" : (data.names[quote.asked_by_id] ?? t("closed.someone"));
                  const decider = quote.decided_by_id === null ? "" : (data.names[quote.decided_by_id] ?? t("closed.someone"));
                  const isWaiting = quote.status === "draft" && quote.approval === "asked";
                  const mine = quote.asked_by_id !== null && quote.asked_by_id === me;
                  const stands = data.deals[quote.deal_id] ?? 0;
                  const active = doing?.id === quote.id ? doing.what : null;
                  const moment = (value: string | null): string => (value === null ? "" : `${f.dayShort(new Date(value))}, ${f.time(new Date(value))}`);
                  return (
                    <li key={quote.id} className="crm-approval mr-card" data-quote={quote.id} data-state={isWaiting ? "waiting" : quote.approval}>
                      <div className="crm-approval-head">
                        <div>
                          <ScreenLink to="quotes" rest={[quote.id]} className="crm-approval-deal">
                            {quote.deal}
                          </ScreenLink>
                          <div className="crm-approval-meta">
                            {[quote.company, firstName(data.names[quote.owner_id ?? ""] ?? ""), quote.deal_stage, quote.deal_close === null ? null : t("approvals.closes", { day: f.dayShort(noonOf(String(quote.deal_close).slice(0, 10))) })].filter((part) => part !== null && part !== "").join(" · ")}
                          </div>
                        </div>
                        <span className="crm-pill" data-tone={isWaiting ? "warn" : quote.approval === "approved" ? "pos" : "danger"}>
                          {t(isWaiting ? "approvals.state.waiting" : quote.approval === "approved" ? "approvals.state.approved" : "approvals.state.refused")}
                        </span>
                      </div>

                      <dl className="crm-approval-figs">
                        <div>
                          <dt>{t("approvals.list")}</dt>
                          <dd className="crm-mono crm-struck">{f.money(quote.list_value)}</dd>
                        </div>
                        <div>
                          <dt>{t("approvals.asked")}</dt>
                          <dd className="crm-mono">{f.money(quote.subtotal)}</dd>
                        </div>
                        <div>
                          <dt>{t("approvals.under")}</dt>
                          <dd className="crm-mono" data-testid="approval-under">
                            {num(quote.unlisted_lines) > 0 ? t("quote.under.unlisted", undefined, num(quote.unlisted_lines)) : t("quote.under", { pct: f.number(Math.round(num(quote.under_list_pct) * 10) / 10) })}
                          </dd>
                        </div>
                      </dl>

                      {quote.ask_reason !== null && (
                        <p className="crm-approval-why">
                          <span className="crm-approval-why-label">{t("approvals.why")}</span> {quote.ask_reason}
                        </p>
                      )}
                      <div className="crm-approval-chip">
                        <span className="crm-chip crm-mono">
                          {quote.family_no} · {t("quote.version", { n: quote.version })} · {quote.number} · {t(quote.sent_at === null ? "approvals.notSent" : "approvals.sent")}
                        </span>
                        <span className="crm-approval-asked">{t("approvals.askedBy", { name: firstName(asker), when: moment(quote.asked_at) })}</span>
                      </div>

                      {!isWaiting && (
                        <p className="crm-approval-decided">
                          {t(quote.approval === "approved" ? "approvals.decided.approved" : "approvals.decided.refused", { name: decider, when: moment(quote.approval_decided_at) })}
                          {quote.decision_note === null || quote.decision_note === "" ? "" : ` · “${quote.decision_note}”`}
                        </p>
                      )}

                      {isWaiting && decides && mine && <p className="crm-approval-own">{t("approvals.own")}</p>}

                      {isWaiting && decides && !mine && active === null && (
                        <div className="crm-approval-actions">
                          <button type="button" className="crm-btn crm-btn-primary crm-btn-38 mr-btn" onClick={() => open({ id: quote.id, what: "approve" })}>
                            {t("approvals.approve")}
                          </button>
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" onClick={() => open({ id: quote.id, what: "refuse" })}>
                            {t("approvals.refuse")}
                          </button>
                          {session.can("comments", "create") && quote.asked_by_id !== null && (
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" onClick={() => open({ id: quote.id, what: "more" }, t("approvals.more.text"))}>
                              {t("approvals.more")}
                            </button>
                          )}
                        </div>
                      )}

                      {active !== null && (
                        <div className="crm-approval-box">
                          <label className="crm-label" htmlFor={`crm-ap-why-${String(quote.id)}`}>
                            {active === "approve" ? t("approvals.box.approve", { amount: f.money(quote.subtotal) }) : active === "refuse" ? t("approvals.box.refuse") : t("approvals.box.more", { name: firstName(asker) })}
                          </label>
                          <textarea id={`crm-ap-why-${String(quote.id)}`} className="crm-input crm-textarea mr-fld" value={why} maxLength={600} disabled={busy} placeholder={t("approvals.box.hint")} autoFocus onChange={(event) => setWhy(event.target.value)} />
                          <p className="crm-field-note">
                            {active === "approve" ? t("approvals.note.approve", { name: firstName(asker) }) : active === "refuse" ? t("approvals.note.refuse", { amount: f.money(stands), name: firstName(asker) }) : t("approvals.note.more", { name: firstName(asker) })}
                          </p>
                          <div className="crm-approval-actions">
                            <button
                              type="button"
                              className="crm-btn crm-btn-primary crm-btn-38 mr-btn"
                              disabled={busy || why.trim() === ""}
                              onClick={() => void (active === "more" ? askMore(quote, asker) : decide(quote, active, asker))}
                            >
                              {busy ? t("ui.saving") : t(active === "approve" ? "approvals.approve.confirm" : active === "refuse" ? "approvals.refuse.confirm" : "approvals.more.confirm")}
                            </button>
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" disabled={busy} onClick={() => open(null)}>
                              {t("ui.cancel")}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
                {shown.length === 0 && (
                  <li className="crm-empty">
                    <span className="crm-empty-icon">
                      <Icon name="stamp" size={21} />
                    </span>
                    <div className="crm-empty-title">{t(filter === "waiting" ? "approvals.empty" : "approvals.empty.any")}</div>
                    <p>{t("approvals.empty.body")}</p>
                  </li>
                )}
              </ul>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
