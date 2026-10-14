/**
 * DISPLAY STOCK (ledger screen 61, "Showroom stock"): what is on the floor
 * today, by space, so the front desk knows what a visitor can sit in before
 * inviting them. The pieces that are tired (out for the settings' months or
 * more) or not the current range come first, with "Swap it out": a fresh
 * piece goes on the floor today. A piece promised to a booking says whose.
 *
 * Every count is the server's. How long a piece has been out is the server's
 * day less the day it went out, in months of 30.44 days as the ledger counts.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { useScreen } from "../team/data.ts";
import { isTired, monthsOut, readFloor, swapOut, type Piece } from "./data.ts";

export function Floor(_props: ScreenProps) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, opens } = useScreen();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => readFloor(session, now, f), [session, today, f]);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["display_pieces", "showroom_bookings"], again);
  const canSwap = session.can("display_pieces", "update");
  const [space, setSpace] = useState<number | "all">("all");
  const [busy, setBusy] = useState<number | null>(null);

  const swap = async (piece: Piece): Promise<void> => {
    setBusy(piece.id);
    await toasts.say(swapOut(session, piece, today), () => t("sh.floor.toast.swapped", { piece: piece.name }));
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-sh mr-screen" data-screen="floor">
      <div className="crm-screen-head">
        <div>
          <h1>{t("sh.floor.title")}</h1>
          <p className="crm-screen-sub">{t("sh.floor.sub")}</p>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={96} />}>
        {(data) => {
          const tired = data.pieces.filter((piece) => isTired(piece, data.tiredMonths, now, f));
          const lentBack = data.pieces.find((piece) => piece.lent_until !== null)?.lent_until ?? null;
          const shown = data.pieces
            .filter((piece) => space === "all" || piece.space_id === space)
            .sort((a, b) => Number(isTired(b, data.tiredMonths, now, f)) - Number(isTired(a, data.tiredMonths, now, f)) || a.out_since.localeCompare(b.out_since));
          return (
            <>
              <div className="crm-sh-stats">
                <div className="crm-sh-stat mr-card" data-stat="floor">
                  <div className="crm-kpi-label">{t("sh.floor.stat.floor")}</div>
                  <div className="crm-sh-value crm-mono">{f.number(data.figures.floor)}</div>
                  <div className="crm-sh-stat-note">{t("sh.floor.stat.floor.note", { all: f.number(data.figures.all), spaces: f.number(data.spaces.length), promised: f.number(data.figures.promised) })}</div>
                </div>
                <div className="crm-sh-stat mr-card" data-stat="tired" data-tone={data.figures.tired > 0 ? "warn" : "pos"}>
                  <div className="crm-kpi-label">{t("sh.floor.stat.tired")}</div>
                  <div className="crm-sh-value crm-mono">{f.number(data.figures.tired)}</div>
                  <div className="crm-sh-stat-note">{t(data.figures.tired > 0 ? "sh.floor.stat.tired.note" : "sh.floor.stat.tired.none")}</div>
                </div>
                <div className="crm-sh-stat mr-card" data-stat="lent" data-tone={data.figures.lent > 0 ? "info" : "plain"}>
                  <div className="crm-kpi-label">{t("sh.floor.stat.lent")}</div>
                  <div className="crm-sh-value crm-mono">{f.number(data.figures.lent)}</div>
                  <div className="crm-sh-stat-note">{data.figures.lent === 0 ? t("sh.floor.stat.lent.none") : lentBack !== null && data.figures.lent === 1 ? t("sh.floor.stat.lent.back", { day: f.dayShort(new Date(`${lentBack}T12:00:00Z`)) }) : t("sh.floor.stat.lent.note")}</div>
                </div>
              </div>

              {tired.length > 0 && (
                <div className="crm-banner crm-sh-banner" data-tone="warn" data-testid="sh-floor-tired">
                  <Icon name="rotate-cw" size={15} />
                  <span>
                    {tired.length === 1
                      ? t(tired[0]!.spec === "old" ? "sh.floor.tired.one.old" : "sh.floor.tired.one", { piece: tired[0]!.name, count: f.number(monthsOut(tired[0]!, now, f)) }, monthsOut(tired[0]!, now, f))
                      : t("sh.floor.tired.many", { count: f.number(tired.length) }, tired.length)}
                  </span>
                </div>
              )}

              <div className="crm-chips" role="group" aria-label={t("sh.floor.spaces")}>
                <button type="button" className="crm-chip-btn mr-chip" aria-pressed={space === "all"} data-space="all" onClick={() => setSpace("all")}>
                  {t("sh.floor.everywhere")}
                  <span className="crm-chip-count crm-mono">{f.number(data.figures.all)}</span>
                </button>
                {data.spaces.map((one) => (
                  <button key={one.id} type="button" className="crm-chip-btn mr-chip" aria-pressed={space === one.id} data-space={one.id} onClick={() => setSpace(one.id)}>
                    {one.name}
                    <span className="crm-chip-count crm-mono">{f.number(data.figures.bySpace[one.id] ?? 0)}</span>
                  </button>
                ))}
              </div>

              <ul className="crm-sh-list">
                {shown.map((piece) => {
                  const months = monthsOut(piece, now, f);
                  const isOld = piece.spec === "old";
                  const tiredNow = isTired(piece, data.tiredMonths, now, f);
                  const lent = piece.lent_company_id !== null;
                  const promised = piece.promised_at === null ? null : new Date(piece.promised_at);
                  return (
                    <li key={piece.id} className="crm-sh-card mr-card" data-piece={piece.id} data-tone={tiredNow ? "warn" : lent ? "info" : "plain"}>
                      <div className="crm-sh-card-top">
                        <span className="crm-sh-ret-tile" aria-hidden="true">
                          <Icon name="armchair" size={16} />
                        </span>
                        <div className="crm-sh-main">
                          <div className="crm-sh-fu-head">
                            <span className="crm-sh-name">{piece.name}</span>
                            <span className="crm-pill crm-sh-space-pill">{piece.space}</span>
                            {isOld && <span className="crm-sh-flag" data-tone="warn">{t("sh.floor.old")}</span>}
                            {lent && <span className="crm-sh-flag" data-tone="info">{t("sh.floor.lent", { company: piece.lent_company ?? "" })}</span>}
                          </div>
                          {lent && piece.lent_until !== null && <div className="crm-sh-who">{t("sh.floor.lentUntil", { day: f.dayShort(new Date(`${piece.lent_until}T12:00:00Z`)) })}</div>}
                        </div>
                        <span className="crm-mono crm-sh-age" data-tired={tiredNow ? "1" : "0"}>
                          {months === 0 ? t("sh.floor.age.new") : t("sh.floor.age", { count: f.number(months) }, months)}
                        </span>
                      </div>
                      {(promised !== null || (tiredNow && canSwap)) && (
                        <div className="crm-sh-actions">
                          {promised !== null &&
                            (opens("showroom") ? (
                              <ScreenLink to="showroom" className="crm-sh-wanted">
                                <Icon name="calendar-check" size={13} />
                                {t("sh.floor.wanted", { who: piece.promised_company ?? piece.promised_visitor ?? "", day: f.dayShort(promised) })}
                              </ScreenLink>
                            ) : (
                              <span className="crm-sh-wanted">{t("sh.floor.wanted", { who: piece.promised_company ?? piece.promised_visitor ?? "", day: f.dayShort(promised) })}</span>
                            ))}
                          <span className="crm-sh-push" />
                          {tiredNow && canSwap && (
                            <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="swap" disabled={busy === piece.id} onClick={() => void swap(piece)}>
                              <Icon name="rotate-cw" size={14} />
                              {t("sh.floor.act.swap")}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {shown.length === 0 && (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="armchair" size={21} />
                  </span>
                  <div className="crm-empty-title">{t("sh.floor.empty")}</div>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
