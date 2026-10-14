/**
 * RECYCLING AND DISPOSAL (ledger screen 66): what came out of the buildings,
 * and where it went. Customers ask where the old furniture went, and they
 * deserve a straight answer.
 *
 * Tonnes, counts and money are the server's sums (`readWasteFigures`); the
 * share kept out of landfill divides two of them, and what it cost in the end
 * takes what came back on scrap from what was paid (two sums the server gave).
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { dayKeyOf, num, oneDecimal, readRemovals, readWasteFigures, shareOf, truthy, type Removal, type WasteRoute } from "./data.ts";
import { Stat, useJobsScreen } from "./parts.tsx";

type Filter = "all" | WasteRoute;
const FILTERS: readonly Filter[] = ["all", "reused", "recycled", "landfill"];
const TONE: Record<WasteRoute, "pos" | "info" | "danger"> = { reused: "pos", recycled: "info", landfill: "danger" };

export function Recycling(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useJobsScreen();
  const { load, reload } = useLoad(() => Promise.all([readRemovals(session), readWasteFigures(session, today)]), [session, today]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["waste_removals"], again);
  const [filter, setFilter] = useState<Filter>("all");

  return (
    <div className="crm-screen crm-jb mr-screen" data-screen="waste">
      <div className="crm-screen-head">
        <div>
          <h1>{t("jb.ws.title")}</h1>
          <p className="crm-screen-sub crm-jb-lead">{t("jb.ws.sub")}</p>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
        {([removals, figures]) => {
          const landfill = figures.byRoute.landfill.tonnes;
          const kept = shareOf(landfill, figures.tonnes);
          const net = figures.cost - figures.income;
          const noNote = removals.filter((removal) => !truthy(removal.has_transfer_note));
          const shown = removals.filter((removal) => filter === "all" || removal.route === filter);
          const most = Math.max(0, ...removals.map((removal) => num(removal.tonnes)));
          const span = figures.first === null || figures.last === null ? "" : t("jb.ws.span", { from: f.date(noonOf(figures.first)), to: f.date(noonOf(figures.last)) });
          return (
            <>
              <div className="crm-kpis crm-jb-stats">
                <Stat name="tonnes" label={t("jb.ws.stat.out")} value={t("jb.ws.tonnes", { n: oneDecimal(f, figures.tonnes) })} sub={`${t("jb.ws.stat.out.sub", { count: f.number(figures.count) }, figures.count)}${span === "" ? "" : `, ${span}`}`} />
                <Stat name="kept" label={t("jb.ws.stat.kept")} value={kept === null ? "—" : f.percent(1 - kept)} tone={kept !== null && 1 - kept >= 0.85 ? "pos" : "warn"} sub={t("jb.ws.stat.kept.sub", { n: oneDecimal(f, landfill) })} />
                <Stat name="cost" label={t("jb.ws.stat.cost")} value={f.money(net)} tone={net <= 0 ? "pos" : undefined} sub={figures.income > 0 ? t("jb.ws.stat.cost.sub", { paid: f.money(figures.cost), back: f.money(figures.income) }) : t("jb.ws.stat.cost.none")} />
              </div>
              {figures.byRoute.landfill.count > 0 && (
                <div className="crm-banner" data-tone="danger" data-testid="jb-ws-landfill">
                  <Icon name="trash-2" size={16} />
                  <span>{t("jb.ws.landfill", { n: oneDecimal(f, landfill), count: f.number(figures.byRoute.landfill.count) }, figures.byRoute.landfill.count)}</span>
                </div>
              )}
              {figures.noNote > 0 && (
                <div className="crm-banner" data-tone="warn" data-testid="jb-ws-nonote">
                  <Icon name="file-x" size={16} />
                  <span>{figures.noNote === 1 && noNote[0] !== undefined ? t("jb.ws.noNote.one", { job: noNote[0].code ?? "", site: noNote[0].site ?? "" }) : t("jb.ws.noNote", { count: f.number(figures.noNote) }, figures.noNote)}</span>
                </div>
              )}
              <p className="crm-jb-quiet" data-testid="jb-ws-quarters">
                {t("jb.ws.quarters", { list: figures.quarters.map((one) => t("jb.ws.quarter", { q: f.number(one.quarter), n: oneDecimal(f, one.tonnes) })).join(", ") })}
              </p>
              <div className="crm-chips" role="group" aria-label={t("jb.ws.filter")}>
                {FILTERS.map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                    {t(`jb.ws.filter.${one}`)}
                    <span className="crm-chip-count crm-mono">{f.number(one === "all" ? figures.count : figures.byRoute[one].count)}</span>
                  </button>
                ))}
              </div>
              <ul className="crm-jb-list">
                {shown.map((removal) => (
                  <RemovalRow key={removal.id} removal={removal} most={most} />
                ))}
              </ul>
              {shown.length === 0 && (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="recycle" size={20} />
                  </span>
                  <div className="crm-empty-title">{t("jb.ws.empty")}</div>
                  <p>{t("jb.ws.empty.body")}</p>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function RemovalRow({ removal, most }: { removal: Removal; most: number }) {
  const t = useT();
  const { f } = useJobsScreen();
  const day = dayKeyOf(removal.day);
  const cost = num(removal.cost);
  const income = num(removal.income);
  const hasNote = truthy(removal.has_transfer_note);
  return (
    <li className="crm-jb-row mr-card" data-removal={removal.id} data-route={removal.route} data-tone={TONE[removal.route]}>
      <div className="crm-jb-row-top">
        <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
          {initials(removal.site ?? "?")}
        </span>
        <div className="crm-jb-row-words">
          <div className="crm-jb-row-line">
            <strong>{[removal.code, removal.title].filter((part) => part !== null).join(" · ")}</strong>
            <span className="crm-pill" data-tone={TONE[removal.route]}>
              <Icon name={removal.route === "landfill" ? "trash-2" : "recycle"} size={12} />
              {t(`jb.ws.route.${removal.route}`)}
            </span>
          </div>
          <div className="crm-jb-quiet">{[removal.site, day === null ? null : f.date(noonOf(day))].filter((part) => part !== null).join(" · ")}</div>
          <div>{removal.what}</div>
          {removal.carrier !== null && removal.carrier !== "" && <div className="crm-jb-quiet">{removal.carrier}</div>}
        </div>
        <div className="crm-jb-row-end">
          <div className="crm-mono crm-jb-tonnes" data-tone={TONE[removal.route]}>
            {t("jb.ws.tonnes", { n: oneDecimal(f, num(removal.tonnes)) })}
          </div>
          <div className="crm-jb-quiet">{income > 0 ? t("jb.ws.back", { money: f.money(income) }) : cost > 0 ? t("jb.ws.paid", { money: f.money(cost) }) : t("jb.ws.free")}</div>
        </div>
      </div>
      <div className="crm-jb-bar" aria-hidden="true">
        <span data-tone={TONE[removal.route]} style={{ inlineSize: `${most <= 0 ? 0 : Math.round((num(removal.tonnes) / most) * 100)}%` }} />
      </div>
      <div className="crm-jb-row-foot">
        <span className="crm-jb-quiet" data-tone={hasNote ? undefined : "warn"}>
          <Icon name={hasNote ? "file-check" : "file-x"} size={13} />
          {hasNote ? (removal.note_number === null || removal.note_number === "" ? t("jb.ws.note") : t("jb.ws.note.number", { number: removal.note_number })) : t("jb.ws.note.none")}
        </span>
      </div>
    </li>
  );
}
