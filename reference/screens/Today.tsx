/**
 * TODAY — the rep's opening screen.
 *
 * Three KPI figures and one queue. The queue is the point: overdue follow-ups
 * first with a danger-tinted leading border, each row carrying enough context
 * (deal, company, what was promised, when it was due, how much is riding on
 * it) that the reader can act without opening anything.
 *
 * Every relative figure derives from the pinned clock in `data/demo.ts`, never
 * from `Date.now()`.
 */

import { useEffect, useRef } from "react";
import { CheckCheck, CircleCheck, Clock3 } from "lucide-react";

import { COMPANIES, NOW, STAGES } from "../data/live.ts";
import { useI18n } from "../i18n/index.tsx";
import { label, money, moneyShort, nowLabel, time } from "../lib/format.ts";
import {
  closingThisMonth,
  followUpQueue,
  weightedTotal,
} from "../lib/pipeline.ts";
import { currentUser, useStore } from "../state/store.ts";
import { Avatar, Chip, Empty, Honest, Kpi, Mono, Panel } from "../components/Primitives.tsx";

export default function Today() {
  const { t } = useI18n();
  const persona = useStore((s) => s.persona);
  const deals = useStore((s) => s.deals);
  const followUps = useStore((s) => s.followUps);
  const done = useStore((s) => s.doneFollowUps);
  const outcomeFor = useStore((s) => s.outcomeFor);
  const openOutcome = useStore((s) => s.openOutcome);
  const resolveFollowUp = useStore((s) => s.resolveFollowUp);
  const openDeal = useStore((s) => s.openDeal);

  const me = currentUser(persona);
  const mine = deals.filter((d) => d.owner === me.id);
  const queue = followUpQueue(followUps, deals, NOW, new Set(done)).filter(
    (row) => row.deal.owner === me.id,
  );

  const overdue = queue.filter((r) => r.overdue);
  const closing = closingThisMonth(mine, NOW);

  const hour = NOW.getHours();
  const greetingKey =
    hour < 12
      ? "today.greeting.morning"
      : hour < 18
        ? "today.greeting.afternoon"
        : "today.greeting.evening";

  return (
    <div className="mr-screen">
      <header className="mr-head">
        <h1 className="mr-head__title">{t(greetingKey, { name: me.first })}</h1>
        <p className="mr-head__sub mr-mono">{nowLabel(NOW)}</p>
      </header>

      <div className="mr-kpis" style={{ marginBlockEnd: 20 }}>
        <Kpi
          label={t("today.kpi.pipeline")}
          value={moneyShort(weightedTotal(mine, STAGES))}
          hint={t("today.kpi.pipeline.hint")}
        />
        <Kpi
          label={t("today.kpi.closing")}
          value={moneyShort(closing.reduce((n, d) => n + d.amount, 0))}
          hint={t("today.kpi.closing.hint", { count: closing.length }, closing.length)}
        />
        <Kpi
          label={t("today.kpi.overdue")}
          value={overdue.length}
          tone={overdue.length > 0 ? "danger" : undefined}
          hint={
            overdue.length > 0
              ? t("today.kpi.overdue.hint", { days: overdue[0].daysLate })
              : t("today.kpi.overdue.clear")
          }
        />
      </div>

      <Panel title={t("today.queue.title")} subtitle={t("today.queue.subtitle")}>
        {queue.length === 0 ? (
          <Empty
            icon={<CheckCheck size={22} aria-hidden="true" />}
            title={t("today.queue.empty.title")}
            body={t("today.queue.empty.body")}
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 9 }}>
            {queue.map((row) => (
              <QueueRow
                key={row.followUp.id}
                row={row}
                open={outcomeFor === row.followUp.id}
                onToggle={() =>
                  openOutcome(outcomeFor === row.followUp.id ? null : row.followUp.id)
                }
                onResolve={(outcome) => resolveFollowUp(row.followUp.id, outcome)}
                onOpenDeal={() => openDeal(row.deal.id)}
              />
            ))}
          </ul>
        )}
      </Panel>

      <div style={{ marginBlockStart: 18 }}>
        <Honest>{t("today.honest")}</Honest>
      </div>
    </div>
  );
}

type Row = ReturnType<typeof followUpQueue>[number];

function QueueRow({
  row,
  open,
  onToggle,
  onResolve,
  onOpenDeal,
}: {
  row: Row;
  open: boolean;
  onToggle: () => void;
  onResolve: (outcome: "done" | "day" | "week") => void;
  onOpenDeal: () => void;
}) {
  const { t } = useI18n();
  const company = COMPANIES.find((c) => c.id === row.deal.co);
  const popRef = useRef<HTMLDivElement | null>(null);

  // A popover that stays open after the reader has clicked elsewhere is a bug,
  // not a feature — close on any outside pointer press.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onToggle();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onToggle]);

  return (
    <li
      className="mr-queue-row"
      data-overdue={row.overdue ? "true" : undefined}
    >
      <button
        type="button"
        className="mr-queue-row__tick mr-btn"
        onClick={onToggle}
        aria-label={t("today.queue.complete")}
        aria-expanded={open}
      >
        <CircleCheck size={19} aria-hidden="true" />
      </button>

      <div className="mr-queue-row__body">
        <p className="mr-queue-row__text">{label(row.followUp.text)}</p>
        <div className="mr-queue-row__meta">
          <button type="button" className="mr-queue-row__deal" onClick={onOpenDeal}>
            {label(row.deal.name)}
          </button>
          {company !== undefined && (
            <span className="mr-queue-row__co">
              <Avatar name={company.name} tint={company.tint} ini={company.ini} />
              {company.name}
            </span>
          )}
        </div>
      </div>

      <div className="mr-queue-row__right">
        {row.overdue ? (
          <Chip tone="danger">
            {t("today.queue.late", { count: row.daysLate }, row.daysLate)}
          </Chip>
        ) : (
          <Chip>
            <Clock3 size={12} aria-hidden="true" />
            <Mono>{time(row.due)}</Mono>
          </Chip>
        )}
        <Mono className="mr-queue-row__amount">{money(row.deal.amount)}</Mono>
      </div>

      {open && (
        <div className="mr-popover" ref={popRef}>
          <div className="mr-popover__title">{t("today.outcome.title")}</div>
          <button type="button" className="mr-popover__item" onClick={() => onResolve("done")}>
            <CircleCheck size={15} aria-hidden="true" />
            {t("today.outcome.done")}
          </button>
          <button type="button" className="mr-popover__item" onClick={() => onResolve("day")}>
            <Clock3 size={15} aria-hidden="true" />
            {t("today.outcome.day")}
          </button>
          <button type="button" className="mr-popover__item" onClick={() => onResolve("week")}>
            <Clock3 size={15} aria-hidden="true" />
            {t("today.outcome.week")}
          </button>
        </div>
      )}
    </li>
  );
}
