/**
 * QUOTES: every quote the reader reaches, a row a family, with its newest
 * version and the one the customer holds; and under it the deals that are at
 * Proposal or later with no quote yet, which still stand at the amount
 * somebody typed.
 *
 * `quotes/<id>` is one quote open on that version (`Quote.tsx`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { formatters, noonOf } from "../../lib/format.ts";
import { scopeOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { useSavedView, ViewBar } from "../own/savedView.tsx";
import { firstName } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { createQuote, families, familyNo, held, newest, readNames, readQuotes, stateOf, TONE, type Quote } from "./data.ts";
import { QuotePage } from "./Quote.tsx";

/** A deal with no quote counts as "should have one" from these odds up: Proposal in the sample. */
const QUOTE_FROM_ODDS = 0.5;

interface Bare extends Record<string, unknown> {
  id: number;
  name: string;
  owner_id: string | null;
  contact_id: number | null;
  typed_amount: number | string | null;
  amount: number | string;
  company: string | null;
  stage: string | null;
}

interface ListData {
  families: Quote[][];
  bare: Bare[];
  names: Record<string, string>;
}

async function read(session: StaffSession): Promise<ListData> {
  const [quotes, stages] = await Promise.all([readQuotes(session), session.list<{ id: number; odds: number | string }>("stages", { select: ["id", "odds"], limit: 50 })]);
  const far = stages.rows.filter((stage) => Number(stage.odds) >= QUOTE_FROM_ODDS).map((stage) => stage.id);
  const quoted = [...new Set(quotes.map((quote) => quote.deal_id))];
  const bare =
    far.length === 0
      ? []
      : (
          await session.list<Bare>("deals", {
            select: ["id", "name", "owner_id", "contact_id", "typed_amount", "amount"],
            where: { and: [{ column: "state", op: "eq", value: "open" }, { column: "stage_id", op: "in", value: far }] },
            lookup: ["company:company_id.name", "stage:stage_id.label"],
            order: ["name"],
            limit: 200,
          })
        ).rows.filter((deal) => !quoted.includes(deal.id));
  const names = await readNames(session, [...quotes.map((quote) => quote.owner_id), ...bare.map((deal) => deal.owner_id)]);
  return { families: families(quotes), bare, names };
}

export function Quotes({ rest }: ScreenProps) {
  if (rest[0] !== undefined && rest[0] !== "view") return <QuotePage id={rest[0]} />;
  return <QuoteList rest={rest} />;
}

function QuoteList({ rest }: { rest: string[] }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const nav = useNav();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const today = useMemo(() => f.dayKey(session.now()), [f, session]);
  const team = useMemo(() => scopeOf(session) === "team", [session]);
  const { load, reload } = useLoad(() => read(session), [session]);
  const again = useCallback(() => reload(), [reload]);
  useLive(["quotes", "deals"], again);
  const [who, setWho] = useState<string | null>(null);
  // `quotes/view/<id>` opens the list on a saved view: whose quotes.
  const view = useSavedView("quotes", rest);
  const viewId = view.state === "ready" ? view.view.id : null;
  useEffect(() => {
    if (view.state === "ready" && team) setWho(view.view.filters.rep ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per view
  }, [viewId]);
  const [busy, setBusy] = useState<number | null>(null);
  const canStart = session.can("quotes", "create") && session.can("quote_lines", "create");

  /** A first version from what was typed on the deal: one line, the deal's name and its amount. It is a draft. */
  const start = async (deal: Bare): Promise<void> => {
    setBusy(deal.id);
    const { saved, missing } = await createQuote(session, { deal_id: deal.id, ...(deal.contact_id === null ? {} : { sent_to_contact_id: deal.contact_id }) }, [{ description: deal.name, qty: 1, rate: Number(deal.typed_amount ?? deal.amount) || 0 }]);
    const made = await toasts.say(Promise.resolve(saved), (row) => (missing > 0 ? t("quotes.toast.started.bare", { number: row.number ?? "" }) : t("quotes.toast.started", { number: row.number ?? "" })));
    setBusy(null);
    if (made !== null) nav.go("quotes", made.id);
  };

  return (
    <div className="crm-screen crm-quotes mr-screen" data-screen="quotes">
      <h1>{t("quotes.title")}</h1>
      <p className="crm-screen-sub">{t("quotes.sub")}</p>
      <ViewBar screen="quotes" view={view} current={team && who !== null ? { rep: who } : {}} names={load.state === "ready" ? load.data.names : {}} />
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={5} height={72} />}>
        {(data) => {
          const owners = [...new Set(data.families.map((family) => family[0]!.owner_id).filter((id): id is string => id !== null))];
          const shown = who === null ? data.families : data.families.filter((family) => family[0]!.owner_id === who);
          const bare = who === null ? data.bare : data.bare.filter((deal) => deal.owner_id === who);
          return (
            <>
              {team && owners.length > 0 && (
                <div className="crm-chips" role="group" aria-label={t("closed.who")}>
                  <button type="button" className="crm-chip-btn mr-chip" aria-pressed={who === null} onClick={() => setWho(null)}>
                    {t("closed.filter.all")}
                  </button>
                  {owners.map((id) => (
                    <button key={id} type="button" className="crm-chip-btn mr-chip" aria-pressed={who === id} onClick={() => setWho(id)}>
                      {firstName(data.names[id] ?? t("closed.someone"))}
                    </button>
                  ))}
                </div>
              )}
              <ul className="crm-quote-list">
                {shown.map((family) => {
                  const last = newest(family);
                  const has = held(family);
                  const state = stateOf(last, family, today);
                  const owner = last.owner_id === null ? null : (data.names[last.owner_id] ?? null);
                  return (
                    <li key={`${String(last.deal_id)}:${familyNo(family)}`}>
                      <ScreenLink to="quotes" rest={[last.id]} className="crm-quote-row mr-row">
                        <span className="crm-quote-no crm-mono">{familyNo(family)}</span>
                        <span className="crm-pill" data-tone={TONE[state]}>
                          {t("quotes.version.short", { n: last.version })} · {t(`quotes.state.${state}` as MessageKey)}
                        </span>
                        <span className="crm-quote-main">
                          <span className="crm-quote-deal">{last.deal}</span>
                          <span className="crm-quote-meta">{[last.company, team && owner !== null ? firstName(owner) : null].filter((part) => part !== null).join(" · ")}</span>
                        </span>
                        <span className="crm-quote-fig">
                          <span className="crm-quote-fig-label">{t("quotes.newest")}</span>
                          <span className="crm-mono crm-quote-fig-value">{f.money(last.total)}</span>
                        </span>
                        <span className="crm-quote-fig">
                          <span className="crm-quote-fig-label">{t("quotes.customerHas")}</span>
                          <span className="crm-mono crm-quote-fig-value">{has === null ? "—" : f.money(has.total)}</span>
                          <span className="crm-quote-fig-note">
                            {has === null
                              ? t("quotes.nothingSent")
                              : has.status === "accepted"
                                ? t("quotes.has.accepted", { n: has.version })
                                : has.valid_until === null
                                  ? t("quotes.version.short", { n: has.version })
                                  : t(has.valid_until.slice(0, 10) < today ? "quotes.has.ranOut" : "quotes.has.until", { n: has.version, day: f.dayShort(noonOf(has.valid_until.slice(0, 10))) })}
                          </span>
                        </span>
                      </ScreenLink>
                    </li>
                  );
                })}
                {shown.length === 0 && (
                  <li className="crm-empty">
                    <span className="crm-empty-icon">
                      <Icon name="file-text" size={21} />
                    </span>
                    <div className="crm-empty-title">{t("quotes.empty")}</div>
                    <p>{t("quotes.empty.body")}</p>
                  </li>
                )}
              </ul>

              {bare.length > 0 && (
                <section className="crm-bare" aria-labelledby="crm-bare-title">
                  <h2 id="crm-bare-title">{t("quotes.bare.title")}</h2>
                  <p className="crm-screen-sub">{t("quotes.bare.sub")}</p>
                  <ul className="crm-quote-list">
                    {bare.map((deal) => (
                      <li key={deal.id} className="crm-quote-row crm-bare-row" data-deal={deal.id}>
                        <span className="crm-quote-main">
                          <span className="crm-quote-deal">{deal.name}</span>
                          <span className="crm-quote-meta">{[deal.company, deal.stage, team && deal.owner_id !== null ? firstName(data.names[deal.owner_id] ?? "") : null].filter((part) => part !== null && part !== "").join(" · ")}</span>
                        </span>
                        <span className="crm-mono crm-quote-fig-value">{f.money(deal.amount)}</span>
                        {canStart && (
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={busy !== null} onClick={() => void start(deal)}>
                            <Icon name="plus" size={14} />
                            {t("quotes.start")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
