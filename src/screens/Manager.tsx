/**
 * MANAGER VIEW — the team's quarter.
 *
 * A weighted forecast strip with an inline area chart of cumulative value, win
 * rate and average cycle from the closed history, a "going stale" callout, and
 * the team board filtered by rep.
 *
 * No leaderboards, by design: ranking four fictional reps against each other
 * would be inventing a competition the seed cannot honestly support.
 */

import { TrendingUp } from "lucide-react";

import { COMPANIES, NOW, REPS, STAGES } from "../data/demo.ts";
import { useI18n } from "../i18n/index.tsx";
import {
  daysInStageLabel,
  label,
  money,
  moneyShort,
  monthShort,
  percent,
} from "../lib/format.ts";
import {
  averageCycleDays,
  columns,
  daysInStage,
  forecast,
  goingStale,
  weightedTotal,
  winRate,
} from "../lib/pipeline.ts";
import { useStore } from "../state/store.ts";
import { Avatar, Button, Chip, Empty, Kpi, Mono, Panel } from "../components/Primitives.tsx";

export default function Manager() {
  const { t } = useI18n();
  const deals = useStore((s) => s.deals);
  const history = useStore((s) => s.history);
  const repFilter = useStore((s) => s.repFilter);
  const setRepFilter = useStore((s) => s.setRepFilter);
  const openDeal = useStore((s) => s.openDeal);

  const filtered = repFilter === "all" ? deals : deals.filter((d) => d.owner === repFilter);
  const months = forecast(filtered, STAGES, NOW, 3);
  const rate = winRate(history);
  const cycle = averageCycleDays(history);
  const stale = goingStale(filtered, NOW, 3);
  const cols = columns(filtered, STAGES);

  return (
    <div className="mr-screen">
      <header className="mr-head">
        <h1 className="mr-head__title">{t("manager.title")}</h1>
        <p className="mr-head__sub">{t("manager.subtitle")}</p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBlockEnd: 18 }}>
        <Chip onClick={() => setRepFilter("all")} pressed={repFilter === "all"}>
          {t("manager.filter.all")}
        </Chip>
        {REPS.map((r) => (
          <Chip key={r.id} onClick={() => setRepFilter(r.id)} pressed={repFilter === r.id}>
            <Avatar name={r.name} tint={r.tint} ini={r.ini} />
            {r.first}
          </Chip>
        ))}
      </div>

      <div className="mr-kpis" style={{ marginBlockEnd: 18 }}>
        <Kpi label={t("manager.kpi.open")} value={moneyShort(weightedTotal(filtered, STAGES))} />
        <Kpi
          label={t("manager.kpi.winRate")}
          value={percent(rate)}
          hint={t("manager.kpi.winRate.hint", {
            won: history.filter((h) => h.won).length,
            closed: history.length,
          })}
        />
        <Kpi
          label={t("manager.kpi.cycle")}
          value={t("manager.kpi.cycle.days", { count: cycle }, cycle)}
          hint={t("manager.kpi.cycle.hint")}
        />
      </div>

      <Panel
        title={t("manager.forecast.title")}
        subtitle={t("manager.forecast.hint")}
        className="mr-forecast-panel"
      >
        <div className="mr-forecast">
          {months.map((m) => (
            <div key={m.month.toISOString()} className="mr-forecast__col">
              <div className="mr-forecast__month">{monthShort(m.month)}</div>
              <div className="mr-forecast__value mr-mono">{moneyShort(m.weighted)}</div>
              <div className="mr-forecast__count">
                {t("chrome.count.deals", { count: m.count }, m.count)}
              </div>
            </div>
          ))}
        </div>
        <CumulativeChart months={months} />
      </Panel>

      <div style={{ marginBlockStart: 16 }}>
        <Panel title={t("manager.stale.title")}>
          {stale.length === 0 ? (
            <p className="mr-col__empty">{t("manager.stale.empty")}</p>
          ) : (
            <div style={{ display: "grid", gap: 9 }}>
              {stale.map((d) => {
                const company = COMPANIES.find((c) => c.id === d.co);
                const rep = REPS.find((r) => r.id === d.owner) ?? REPS[0];
                return (
                  <div key={d.id} className="mr-stalerow">
                    <div style={{ minWidth: 0 }}>
                      <div className="mr-dealrow__name">{label(d.name)}</div>
                      <div className="mr-personrow__role">
                        {company?.name} · {rep.first}
                      </div>
                    </div>
                    <Chip tone="danger">{daysInStageLabel(daysInStage(d, NOW))}</Chip>
                    <Mono className="mr-dealrow__amount">{money(d.amount)}</Mono>
                    <Button size="sm" tone="ghost" onClick={() => openDeal(d.id)}>
                      {t("manager.stale.open")}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <div style={{ marginBlockStart: 16 }}>
        <Panel title={t("manager.board.title")}>
          {filtered.length === 0 ? (
            <Empty icon={<TrendingUp size={22} aria-hidden="true" />} title={t("manager.board.empty")} />
          ) : (
            <div className="mr-minibars">
              {cols.map((col) => {
                const max = Math.max(...cols.map((c) => c.weighted), 1);
                return (
                  <div key={col.stage.id} className="mr-minibar">
                    <div className="mr-minibar__label">
                      {label(col.stage.label)}
                      <Mono>{col.count}</Mono>
                    </div>
                    <div className="mr-minibar__track">
                      <div
                        className="mr-minibar__fill"
                        style={{ inlineSize: `${(col.weighted / max) * 100}%` }}
                      />
                    </div>
                    <Mono className="mr-minibar__value">{moneyShort(col.weighted)}</Mono>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * A small area chart of cumulative weighted value.
 *
 * Drawn as an inline SVG with a `viewBox` and no fixed width so it scales with
 * its container; the path is built from the same `forecast()` output the
 * figures above it use, so the picture and the numbers can never disagree.
 */
function CumulativeChart({ months }: { months: ReturnType<typeof forecast> }) {
  const { t } = useI18n();
  const w = 300;
  const h = 68;
  const max = Math.max(...months.map((m) => m.cumulative), 1);

  const points = months.map((m, i) => {
    const x = months.length === 1 ? w : (i / (months.length - 1)) * w;
    const y = h - (m.cumulative / max) * (h - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = `M${points.join(" L")}`;
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <figure className="mr-chart">
      <figcaption className="mr-chart__cap">{t("manager.forecast.cumulative")}</figcaption>
      {/*
       * `preserveAspectRatio="none"` lets the chart stretch to the panel width.
       * It is decorative — the figures above carry the same information — so it
       * is hidden from assistive technology rather than described twice.
       */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="mr-chart__svg"
        aria-hidden="true"
        focusable="false"
      >
        <path d={area} fill="var(--accent-soft)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </figure>
  );
}
