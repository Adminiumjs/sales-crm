/**
 * STOCK AND LEAD TIMES (ledger screen 42): what is on the shelf, what is on
 * order, how long each supplier says it takes, and which open deals ask for
 * each line.
 *
 * Every figure is the Inventory add-on's or the server's (see `data.ts`). A
 * line's state is read from Inventory's own figures for it: nothing on the
 * shelf; at or under the reorder level Inventory was told ("Running low"); or
 * in stock. The deals on a line are links for whoever reads deals; the
 * operations manager, who reads none, is told on how many open deals each
 * line is asked for.
 *
 * Read only: stock is received, counted and ordered in Inventory's own pages.
 */
import { useCallback, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, noonOf, type Formatters } from "../../lib/format.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { LINE_STATES, leadOf, num, readStock, shortOf, stateOf, SUPPLY_TABLES, type LineState, type StockData } from "./data.ts";

const TONE: Record<LineState, "pos" | "warn" | "danger"> = { inStock: "pos", low: "warn", empty: "danger" };

/** The person's session and how they read figures: the formatters for their language, the install's currency and the business's clock. */
export function useSupply(): { session: StaffSession; f: Formatters } {
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  return { session, f };
}

/** Read again when stock, an order or a deal's need changes: the tables of these the person reads. */
export function useSupplyLive(session: StaffSession, reload: () => void): void {
  const again = useCoalesced(reload);
  const heard = useMemo(() => SUPPLY_TABLES.filter((table) => session.can(table, "read")), [session]);
  useLive(heard, again);
}

/** "3 weeks", "10 days", or the words for none. */
export function useLeadWords(): (days: number | null | undefined, none: string) => string {
  const t = useT();
  const { locale } = useI18n();
  return useCallback(
    (days, none) => {
      const lead = leadOf(days);
      if (lead === null) return none;
      const n = new Intl.NumberFormat(locale);
      return "weeks" in lead ? t("supply.weeks", { count: n.format(lead.weeks) }, lead.weeks) : t("supply.days", { count: n.format(lead.days) }, lead.days);
    },
    [t, locale],
  );
}

export function Stock() {
  const t = useT();
  const { session, f } = useSupply();
  const lead = useLeadWords();
  const { load, reload } = useLoad(() => readStock(session), [session]);
  useSupplyLive(session, reload);
  const [filter, setFilter] = useState<LineState | "all">("all");

  return (
    <div className="crm-screen crm-sup mr-screen" data-screen="stock">
      <div className="crm-screen-head">
        <div>
          <h1>{t("nav.item.stock")}</h1>
          <p className="crm-screen-sub">{t("supply.stock.sub")}</p>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={6} height={84} />}>
        {(data) => <StockBody data={data} f={f} lead={lead} filter={filter} setFilter={setFilter} busy={load.state === "ready" && load.again} />}
      </Loaded>
    </div>
  );
}

function StockBody({ data, f, lead, filter, setFilter, busy }: { data: StockData; f: Formatters; lead: (days: number | null | undefined, none: string) => string; filter: LineState | "all"; setFilter: (state: LineState | "all") => void; busy: boolean }) {
  const t = useT();
  const short = shortOf(data.lines, data.asked);
  const counts: Record<LineState | "all", number> = data.counts;
  const shown = data.lines.filter((line) => filter === "all" || stateOf(line, data.low.has(line.id)) === filter);
  const longestLead = data.longest === null ? null : lead(data.longest.lead_days, "");
  return (
    <>
      <div className="crm-sup-tiles">
        <Tile figure="inStock" label={t("supply.stock.inStock")} value={f.number(data.counts.inStock)} sub={t("supply.stock.inStock.sub")} tone="pos" />
        <Tile figure="low" label={t("supply.stock.low")} value={f.number(data.counts.low)} sub={t(data.levelsSet === 0 ? "supply.stock.low.unset" : "supply.stock.low.sub")} tone="warn" />
        <Tile figure="empty" label={t("supply.stock.empty")} value={f.number(data.counts.empty)} sub={t("supply.stock.empty.sub")} tone="danger" />
        <Tile figure="lead" label={t("supply.stock.lead")} value={longestLead ?? "–"} sub={data.longest?.name ?? t("supply.stock.lead.none")} tone="plain" />
      </div>

      <div className="crm-sup-banner" data-tone={"deals" in data.risk ? (data.risk.deals > 0 ? "warn" : "plain") : data.risk.needs > 0 ? "warn" : "plain"} data-figure="risk">
        <Icon name="truck" size={16} />
        <span>
          {"deals" in data.risk
            ? data.risk.deals === 0
              ? t("supply.stock.risk.none")
              : t("supply.stock.risk.deals", { count: f.number(data.risk.deals), amount: f.money(data.risk.amount) }, data.risk.deals)
            : data.risk.needs === 0
              ? t("supply.stock.risk.none")
              : t("supply.stock.risk.needs", { count: f.number(data.risk.needs) }, data.risk.needs)}
        </span>
      </div>
      <p className="crm-sup-short" data-figure="short">
        {short.length === 0
          ? t("supply.stock.short.none")
          : `${t("supply.stock.short")} ${short.map((one) => t("supply.stock.short.line", { name: one.line.name, need: f.number(one.need), have: f.number(one.have), short: f.number(one.short) })).join(t("supply.list.sep"))}.`}{" "}
        <span className="crm-sup-quiet">{t("supply.stock.short.note")}</span>
      </p>

      <div className="crm-chips crm-sup-chips" role="group" aria-label={t("supply.stock.filter")}>
        {(["all", ...LINE_STATES] as const).map((state) => (
          <button key={state} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === state} data-filter={state} onClick={() => setFilter(state)}>
            {t(state === "all" ? "supply.stock.all" : `supply.stock.${state}`)}
            <span className="crm-mono crm-sup-chip-n">{f.number(counts[state])}</span>
          </button>
        ))}
      </div>

      {data.lines.length === 0 ? (
        <p className="crm-sup-none">{t("supply.stock.none")}</p>
      ) : shown.length === 0 ? (
        <p className="crm-sup-none">{t("supply.stock.none.filter")}</p>
      ) : (
        <ul className="crm-sup-lines" aria-busy={busy} aria-label={t("nav.item.stock")}>
          {shown.map((line) => {
            const key = String(line.id);
            const state = stateOf(line, data.low.has(line.id));
            const supplier = data.suppliers[String(data.supplierOf[key] ?? "")];
            const coming = data.onOrder[key] ?? 0;
            const lands = data.landing[key];
            const deals = data.dealsOn?.[key] ?? [];
            const asked = data.askedOn[key] ?? 0;
            return (
              <li key={line.id} className="crm-sup-line mr-card" data-line={line.sku ?? line.id} data-state={state}>
                <div className="crm-sup-line-top">
                  <div className="crm-sup-line-words">
                    <div className="crm-sup-line-head">
                      <h2>{line.name}</h2>
                      <span className="crm-pill" data-tone={TONE[state]}>
                        {t(`supply.stock.${state}`)}
                      </span>
                    </div>
                    {line.note !== null && line.note !== "" && <p className="crm-sup-quiet">{line.note}</p>}
                  </div>
                  <dl className="crm-sup-facts">
                    <div>
                      <dt>{t("supply.stock.have")}</dt>
                      <dd className="crm-mono" data-figure="have" data-tone={num(line.on_hand) <= 0 ? "danger" : undefined}>
                        {f.number(num(line.on_hand))}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("supply.stock.onOrder")}</dt>
                      <dd className="crm-mono" data-figure="on-order">
                        {f.number(coming)}
                        {coming > 0 && <span className="crm-sup-lands">{lands?.expected ? t("supply.stock.lands", { day: f.dayShort(noonOf(lands.expected)) }) : t("supply.stock.lands.unknown")}</span>}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("supply.stock.leadTime")}</dt>
                      <dd className="crm-mono" data-figure="lead">
                        {supplier === undefined ? t("supply.stock.noSupplier") : lead(supplier.lead_days, t("supply.stock.noLead"))}
                        {supplier !== undefined && <span className="crm-sup-lands">{supplier.name}</span>}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="crm-sup-deals">
                  {data.dealsOn === null ? (
                    <span className="crm-sup-quiet" data-figure="asked">
                      {asked === 0 ? t("supply.stock.deals.none") : t("supply.stock.deals.count", { count: f.number(asked) }, asked)}
                    </span>
                  ) : deals.length === 0 ? (
                    <span className="crm-sup-quiet">{t("supply.stock.deals.none")}</span>
                  ) : (
                    <ul aria-label={t("supply.stock.deals", { name: line.name })}>
                      {deals.map((deal) => (
                        <li key={deal.id} className="crm-sup-deal">
                          <DealLink id={deal.id}>{deal.name}</DealLink>
                          <span className="crm-mono">{f.money(deal.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data.cut && <p className="crm-sup-quiet">{t("supply.stock.cut", { count: f.number(data.lines.length) })}</p>}
      <p className="crm-sup-where">
        <Icon name="package" size={14} />
        {t("supply.where")}
      </p>
    </>
  );
}

export function Tile({ figure, label, value, sub, tone }: { figure: string; label: string; value: string; sub: string; tone: "pos" | "warn" | "danger" | "plain" }) {
  return (
    <div className="crm-sup-tile mr-card" data-figure={figure}>
      <div className="crm-sup-tile-label">{label}</div>
      <div className="crm-sup-tile-value crm-mono" data-tone={tone}>
        {value}
      </div>
      <div className="crm-sup-tile-sub">{sub}</div>
    </div>
  );
}
