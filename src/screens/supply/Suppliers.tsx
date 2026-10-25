/**
 * SUPPLIER SCORECARD (ledger screen 60), on Inventory's receipts (plan 68 S12).
 *
 * Each supplier as drawn: its band and score, a bar, on time over the last 90
 * days of the business's calendar, its deliveries, the late ones, its claims
 * of the year, the lead time it really takes against the one it promises, its
 * next order on the way. Above them: on time for all of them, the claims of
 * the year, and how many are worth a conversation, with the worst named.
 *
 * Every count is the server's (`data.ts`); the score and band are worked out
 * from those counts as the ledger works them (`score.ts`). An updated install
 * keeps lateness only from its update on: the figures then say "since" their
 * first day. The claims (tiles, facts, the link to them) are drawn only while
 * After the job is on and the reader reads claims; the score then counts none.
 *
 * Departures from the design (Inventory keeps neither): no "with us since"
 * year and no typed verdict or "how they answer" line; the supplier's lines
 * and its next order stand where they were.
 */
import { useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { noonOf, type Formatters } from "../../lib/format.ts";
import { ScreenLink } from "../../shell/nav.tsx";
import { useOpens } from "../fleet/parts.tsx";
import { Icon } from "../../shell/icons.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { readSuppliers, showsClaims, type Lateness, type Supplier, type SuppliersData } from "./data.ts";
import { scoreOf, type Band, type Score } from "./score.ts";
import { Tile, useLeadWords, useSupply, useSupplyLive } from "./Stock.tsx";

const BAND_TONE: Record<Band, "pos" | "warn" | "danger"> = { solid: "pos", watch: "warn", problem: "danger" };

export function Suppliers() {
  const t = useT();
  const { session, f } = useSupply();
  const { load, reload } = useLoad(() => readSuppliers(session), [session]);
  useSupplyLive(session, reload);
  const claims = showsClaims(session);
  const sub = (data: SuppliersData): string => {
    const n = data.counts.inUse;
    if (data.lateness === null) return t("supply.sup.sub", { count: f.number(n) }, n);
    return claims ? t("scorecard.sub", { count: f.number(n) }, n) : t("scorecard.sub.noClaims", { count: f.number(n) }, n);
  };
  return (
    <div className="crm-screen crm-sup mr-screen" data-screen="suppliers">
      <div className="crm-screen-head">
        <div>
          <h1>{t("nav.item.suppliers")}</h1>
          <p className="crm-screen-sub">{load.state === "ready" ? sub(load.data) : t("supply.sup.sub.plain")}</p>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={6} height={120} />}>
        {(data) => <SuppliersBody data={data} f={f} busy={load.state === "ready" && load.again} />}
      </Loaded>
    </div>
  );
}

interface Scored {
  supplier: Supplier;
  score: Score | null;
}

/** Highest score first; the ones with nothing to judge after, those in use first, then by name. */
function ranked(data: SuppliersData, lateness: Lateness): Scored[] {
  const rows = data.suppliers.map((supplier) => ({ supplier, score: scoreOf(lateness.by[String(supplier.id)] ?? { n: 0, late: 0, avgLate: null, claims: null }) }));
  return rows.sort((a, b) => {
    if (a.score !== null && b.score !== null) return b.score.score - a.score.score || a.supplier.name.localeCompare(b.supplier.name);
    if (a.score !== null || b.score !== null) return a.score === null ? 1 : -1;
    return Number(Boolean(b.supplier.active)) - Number(Boolean(a.supplier.active)) || a.supplier.name.localeCompare(b.supplier.name);
  });
}

function SuppliersBody({ data, f, busy }: { data: SuppliersData; f: Formatters; busy: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const lead = useLeadWords();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  /** On time to a tenth of a per cent, in the reader's own digits: 85.4 %, 100 %. */
  const pct = useMemo(() => {
    const format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
    return (tenths: number) => format.format(tenths / 1000);
  }, [locale]);
  const lateness = data.lateness;
  const rows: Scored[] = lateness === null ? data.suppliers.map((supplier) => ({ supplier, score: null })) : ranked(data, lateness);
  const problems = rows.filter((row) => row.score?.band === "problem");
  const worst = problems.at(-1);
  const allOn = lateness === null || lateness.all.n === 0 ? null : Math.floor((2000 * (lateness.all.n - lateness.all.late) + lateness.all.n) / (2 * lateness.all.n));
  const claims = lateness?.claims ?? null;
  // The link to Claims only for whom that screen opens: the operations manager reads the counts and has no Claims screen.
  const opensClaims = useOpens()("claims");

  return (
    <>
      {lateness === null ? (
        <>
          <div className="crm-sup-tiles">
            <Tile figure="in-use" label={t("supply.sup.inUse")} value={f.number(data.counts.inUse)} sub={t("supply.sup.inUse.sub")} tone="plain" />
            <Tile figure="coming" label={t("supply.sup.coming")} value={f.number(data.counts.coming)} sub={t("supply.sup.coming.sub")} tone={data.counts.coming > 0 ? "warn" : "plain"} />
            <Tile figure="received" label={t("supply.sup.received")} value={f.number(data.counts.received)} sub={t("supply.sup.received.sub")} tone="plain" />
            <Tile figure="lead" label={t("supply.sup.lead")} value={data.longest === null ? "–" : lead(data.longest.lead_days, "–")} sub={data.longest?.name ?? t("supply.stock.lead.none")} tone="plain" />
          </div>
          <div className="crm-sup-banner" data-tone="plain" data-figure="not-scored">
            <Icon name="circle-alert" size={16} />
            <span>{t("scorecard.notKept")}</span>
          </div>
        </>
      ) : (
        <>
          <div className="crm-sup-tiles">
            <Tile
              figure="on-time"
              label={t("scorecard.onTime")}
              value={allOn === null ? "–" : pct(allOn)}
              sub={allOn === null ? t("scorecard.onTime.none") : lateness.from !== null ? t("scorecard.onTime.from", { day: f.dayShort(noonOf(lateness.from)) }) : t("scorecard.onTime.window")}
              tone={allOn === null ? "plain" : allOn >= 900 ? "pos" : "warn"}
            />
            {claims !== null && <Tile figure="claims" label={t("scorecard.claims")} value={f.number(claims)} sub={t("scorecard.claims.sub")} tone={claims > 4 ? "warn" : "plain"} />}
            <Tile figure="talk" label={t("scorecard.talk")} value={f.number(problems.length)} sub={problems.length === 0 ? t("scorecard.talk.none") : problems.map((row) => row.supplier.name).join(t("supply.list.sep"))} tone={problems.length > 0 ? "danger" : "pos"} />
          </div>
          {worst !== undefined && worst.score !== null && (
            <div className="crm-sup-banner" data-tone="danger" data-figure="worst">
              <Icon name="triangle-alert" size={16} />
              <span>
                {worst.score.weeksOver > 0
                  ? t("scorecard.worst.weeks", { name: worst.supplier.name, pct: pct(worst.score.onTenths), weeks: t("supply.weeks", { count: f.number(worst.score.weeksOver) }, worst.score.weeksOver) })
                  : t("scorecard.worst.score", { name: worst.supplier.name, pct: pct(worst.score.onTenths), score: f.number(worst.score.score) })}
              </span>
            </div>
          )}
        </>
      )}

      {data.suppliers.length === 0 ? (
        <p className="crm-sup-none">{t("supply.sup.none")}</p>
      ) : (
        <ul className="crm-sup-lines" aria-busy={busy} aria-label={t("nav.item.suppliers")}>
          {rows.map(({ supplier, score }) => {
            const key = String(supplier.id);
            const supplies = data.supplies[key] ?? [];
            const next = data.next[key];
            const judged = lateness?.by[key];
            const active = Boolean(supplier.active);
            const many = supplies.length > 3 && open[supplier.id] !== true;
            const band = score?.band;
            const took = supplier.lead_days === null || score === null ? null : supplier.lead_days + 7 * score.weeksOver;
            return (
              <li key={supplier.id} className="crm-sup-line crm-sup-supplier mr-card" data-supplier={supplier.name} data-active={active ? "1" : "0"} data-band={band ?? "none"}>
                <div className="crm-sup-line-top">
                  <span className="crm-sup-tile-icon" aria-hidden="true">
                    <Icon name="factory" size={17} />
                  </span>
                  <div className="crm-sup-line-words">
                    <div className="crm-sup-line-head">
                      <h2>{supplier.name}</h2>
                      {lateness !== null && (
                        <span className="crm-pill crm-sup-band" data-band={band ?? "none"} data-figure="band">
                          {t(band === undefined ? "scorecard.band.none" : `scorecard.band.${band}`)}
                        </span>
                      )}
                      {!active && <span className="crm-pill">{t("supply.sup.inactive")}</span>}
                    </div>
                    <p className="crm-sup-quiet" data-figure="supplies">
                      {supplies.length === 0 ? t("supply.sup.supplies.none") : `${t("supply.sup.supplies")} ${(many ? supplies.slice(0, 3) : supplies).join(t("supply.list.sep"))}`}
                      {many && (
                        <>
                          {" "}
                          <button type="button" className="crm-sup-more mr-gi" onClick={() => setOpen((was) => ({ ...was, [supplier.id]: true }))}>
                            {t("supply.sup.more", { count: f.number(supplies.length - 3) }, supplies.length - 3)}
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                  {score !== null && (
                    <div className="crm-sup-score">
                      <div className="crm-sup-score-value crm-mono" data-tone={BAND_TONE[score.band]} data-figure="score">
                        {f.number(score.score)}
                      </div>
                      <div className="crm-sup-score-of">{t("scorecard.outOf")}</div>
                    </div>
                  )}
                </div>
                {score !== null && <meter className="crm-sup-bar" data-band={score.band} min={0} max={100} value={score.score} aria-hidden="true" />}
                <dl className="crm-sup-facts crm-sup-facts-row">
                  {lateness !== null && (
                    <>
                      <div>
                        <dt>{t("scorecard.fact.onTime")}</dt>
                        <dd className="crm-mono" data-figure="on-time" data-tone={score === null ? undefined : score.onTenths >= 900 ? "pos" : score.onTenths >= 850 ? "warn" : "danger"}>
                          {score === null ? "–" : pct(score.onTenths)}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("scorecard.fact.deliveries")}</dt>
                        <dd className="crm-mono" data-figure="deliveries">
                          {f.number(judged?.n ?? 0)}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("scorecard.fact.late")}</dt>
                        <dd className="crm-mono" data-figure="late" data-tone={(judged?.late ?? 0) > 4 ? "danger" : undefined}>
                          {f.number(judged?.late ?? 0)}
                        </dd>
                      </div>
                      {judged?.claims !== null && judged?.claims !== undefined && (
                        <div>
                          <dt>{t("scorecard.fact.claims")}</dt>
                          <dd className="crm-mono" data-figure="claims" data-tone={judged.claims > 1 ? "warn" : undefined}>
                            {f.number(judged.claims)}
                          </dd>
                        </div>
                      )}
                    </>
                  )}
                  <div>
                    <dt>{t("supply.sup.fact.lead")}</dt>
                    <dd className="crm-mono" data-figure="lead" data-tone={score === null ? undefined : score.weeksOver > 0 ? "warn" : "pos"}>
                      {lead(took ?? supplier.lead_days, t("supply.stock.noLead"))}
                    </dd>
                  </div>
                </dl>
                <div className="crm-sup-foot">
                  {lateness !== null && (
                    <span className="crm-sup-slip" data-figure="slip" data-tone={score === null ? undefined : score.weeksOver > 0 ? "warn" : "pos"}>
                      {score === null
                        ? t("scorecard.slip.none")
                        : supplier.lead_days === null
                          ? t("scorecard.slip.noLead")
                          : score.weeksOver > 0
                            ? t("scorecard.slip.over", { promised: lead(supplier.lead_days, "–"), took: lead(took, "–") })
                            : t("scorecard.slip.kept", { promised: lead(supplier.lead_days, "–") })}
                    </span>
                  )}
                  <span className="crm-sup-next" data-figure="next">
                    {next === undefined ? t("supply.sup.next.none") : next.expected !== null ? t("supply.sup.next", { number: next.number ?? "", day: f.dayShort(noonOf(next.expected)) }) : t("supply.sup.next.unknown", { number: next.number ?? "" })}
                  </span>
                  {opensClaims && judged?.claims !== null && judged?.claims !== undefined && (
                    <ScreenLink to="claims" className="crm-sup-claims mr-gi">
                      {t("scorecard.toClaims")}
                    </ScreenLink>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data.cut && <p className="crm-sup-quiet">{t("supply.sup.cut", { count: f.number(data.suppliers.length) })}</p>}
      <p className="crm-sup-where">
        <Icon name="package" size={14} />
        {t("supply.where")}
      </p>
    </>
  );
}
