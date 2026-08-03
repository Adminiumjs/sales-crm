/**
 * PIPELINE BOARD — five stage columns, drag to move.
 *
 * Column subtotals and the header total are NOT stored: they come from
 * `pipeline.columns()` on every render, which is what makes dragging a card
 * update both ends at once without any bookkeeping.
 *
 * Dragging is a progressive enhancement, never the only route. Every card also
 * carries a "…" menu offering the same three moves, so the board is completely
 * usable with a keyboard, a screen reader, or a touch device where HTML5 drag
 * events do not fire.
 */

import { useState } from "react";
import { EllipsisVertical, GripVertical } from "lucide-react";

import { COMPANIES, NOW, REPS, STAGES } from "../data/demo.ts";
import type { Deal, StageId } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import {
  daysInStageLabel,
  label,
  money,
  moneyShort,
  percent,
} from "../lib/format.ts";
import { columns, daysInStage, openTotal, staleness, weightedTotal } from "../lib/pipeline.ts";
import { useStore } from "../state/store.ts";
import { Avatar, Chip, Mono } from "../components/Primitives.tsx";

export default function Board() {
  const { t } = useI18n();
  const deals = useStore((s) => s.deals);
  const moveStage = useStore((s) => s.moveStage);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<StageId | "closed" | null>(null);

  const cols = columns(deals, STAGES);
  const openCloseDialog = useStore((s) => s.openCloseDialog);

  const drop = (stage: StageId | "closed") => {
    if (dragging === null) return;
    if (stage === "closed") openCloseDialog(dragging);
    else moveStage(dragging, stage);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="mr-screen">
      <header className="mr-head">
        <h1 className="mr-head__title">{t("board.title")}</h1>
        <p className="mr-head__sub">{t("board.subtitle")}</p>
      </header>

      <div className="mr-board-total">
        <div>
          <div className="mr-kpi__label">{t("board.total")}</div>
          <div className="mr-board-total__value mr-mono">
            {money(weightedTotal(deals, STAGES))}
          </div>
        </div>
        <p className="mr-board-total__open">
          {t("board.total.open", { value: money(openTotal(deals)) })}
        </p>
      </div>

      <p className="mr-board-hint mr-narrow-only">{t("board.scrollHint")}</p>

      <div className="mr-board mr-scroll">
        {cols.map((col) => (
          <section
            key={col.stage.id}
            className="mr-col"
            data-over={over === col.stage.id ? "true" : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.stage.id);
            }}
            onDragLeave={() => setOver((s) => (s === col.stage.id ? null : s))}
            onDrop={() => drop(col.stage.id)}
          >
            <header className="mr-col__head">
              <div className="mr-col__title">
                {label(col.stage.label)}
                <span className="mr-col__count mr-mono">{col.count}</span>
              </div>
              <div className="mr-col__sub">
                <Mono>{moneyShort(col.weighted)}</Mono>
                <span>·</span>
                <span>{t("board.column.odds", { odds: percent(col.stage.odds) })}</span>
              </div>
            </header>

            <div className="mr-col__body">
              {col.deals.length === 0 ? (
                <p className="mr-col__empty">{t("board.column.empty")}</p>
              ) : (
                col.deals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    dragging={dragging === deal.id}
                    onDragStart={() => setDragging(deal.id)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  />
                ))
              )}
            </div>
          </section>
        ))}
      </div>

      <div
        className="mr-dropzone"
        data-over={over === "closed" ? "true" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver("closed");
        }}
        onDragLeave={() => setOver((s) => (s === "closed" ? null : s))}
        onDrop={() => drop("closed")}
      >
        <span className="mr-dropzone__label">{t("board.dropzone")}</span>
        <span className="mr-dropzone__hint">{t("board.dropzone.hint")}</span>
      </div>
    </div>
  );
}

function DealCard({
  deal,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  deal: Deal;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useI18n();
  const company = COMPANIES.find((c) => c.id === deal.co);
  const owner = REPS.find((r) => r.id === deal.owner) ?? REPS[0];
  const openDeal = useStore((s) => s.openDeal);
  const menuFor = useStore((s) => s.menuFor);
  const openMenu = useStore((s) => s.openMenu);
  const moveStage = useStore((s) => s.moveStage);
  const openCloseDialog = useStore((s) => s.openCloseDialog);

  const age = daysInStage(deal, NOW);
  const stale = staleness(deal, NOW);
  const menuOpen = menuFor === deal.id;

  return (
    <article
      className="mr-deal mr-card"
      data-dragging={dragging ? "true" : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="mr-deal__grip" aria-hidden="true">
        <GripVertical size={13} />
      </div>

      <button type="button" className="mr-deal__name" onClick={() => openDeal(deal.id)}>
        {label(deal.name)}
      </button>

      {company !== undefined && (
        <div className="mr-deal__co">
          <Avatar name={company.name} tint={company.tint} ini={company.ini} />
          {company.name}
        </div>
      )}

      <div className="mr-deal__foot">
        <Mono className="mr-deal__amount">{money(deal.amount)}</Mono>
        <Chip tone={stale === "stale" ? "danger" : stale === "warn" ? "warn" : undefined}>
          {stale === "stale" ? t("board.stale") : daysInStageLabel(age)}
        </Chip>
        <span style={{ marginInlineStart: "auto" }}>
          <Avatar name={owner.name} tint={owner.tint} ini={owner.ini} title={owner.name} />
        </span>
      </div>

      <button
        type="button"
        className="mr-deal__menu"
        onClick={() => openMenu(menuOpen ? null : deal.id)}
        aria-label={t("board.card.menu")}
        aria-expanded={menuOpen}
      >
        <EllipsisVertical size={15} aria-hidden="true" />
      </button>

      {menuOpen && (
        <div className="mr-popover">
          <div className="mr-popover__title">{t("board.card.move")}</div>
          {STAGES.filter((s) => s.id !== deal.stage).map((s) => (
            <button
              key={s.id}
              type="button"
              className="mr-popover__item"
              onClick={() => moveStage(deal.id, s.id)}
            >
              {label(s.label)}
              <span className="mr-searchpop__meta mr-mono">{percent(s.odds)}</span>
            </button>
          ))}
          <hr className="mr-popover__rule" />
          <button
            type="button"
            className="mr-popover__item"
            onClick={() => openDeal(deal.id)}
          >
            {t("board.card.openRoom")}
          </button>
          <button
            type="button"
            className="mr-popover__item"
            onClick={() => openCloseDialog(deal.id)}
          >
            {t("board.card.close")}
          </button>
        </div>
      )}
    </article>
  );
}
