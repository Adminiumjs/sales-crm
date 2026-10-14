/**
 * THE ACCOUNT MANAGER'S HOME, the "After the job" part of it (decision 139:
 * stage 2's): aftercare calls due, complaints open, and customers' answers
 * nobody has replied to. Each is shown only to somebody who may open its
 * page, and each row opens that page, not the row.
 *
 * Every count is the server's. No total across the lists is shown.
 */
import { useMemo, type ReactNode } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { canOpen, type MenuFacts, type RouteKey } from "../../shell/routes.ts";
import { useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { Kpi, useFacts } from "../aftersale/common.tsx";
import { daysWord, jobLabel, keyOf } from "./common.tsx";
import { CAUSE_ICON } from "./Complaints.tsx";
import { daysBetween, readAfterHome, type AfterHome } from "./data.ts";

/** What the home reads of "After the job", for the pages this person may open; null while it is on its way, or when they open none. */
export function useAfterHome(facts: MenuFacts): AfterHome | null {
  const { session, today } = useFacts();
  const reads = useMemo(() => ({ calls: canOpen("aftercare", facts), complaints: canOpen("complaints", facts), answers: canOpen("feedback", facts) }), [facts]);
  const any = reads.calls || reads.complaints || reads.answers;
  const { load, reload } = useLoad(() => (any ? readAfterHome(session, today, reads) : Promise.resolve(null)), [session, today, reads, any]);
  const again = useCoalesced(reload);
  useLive([...(reads.calls ? ["follow_ups"] : []), ...(reads.complaints ? ["complaints"] : []), ...(reads.answers ? ["feedback"] : [])], again);
  return load.state === "ready" ? load.data : null;
}

export function AfterKpi({ data, which }: { data: AfterHome | null; which: "calls" | "complaints" | "answers" }) {
  const t = useT();
  const { f } = useFacts();
  if (data === null) return null;
  if (which === "calls" && data.calls !== null) {
    const { due, late } = data.calls;
    return <Kpi testId="amhome-calls" icon="phone-call" tone={late > 0 ? "danger" : "accent"} label={t("ac.home.calls")} value={f.number(due)} sub={late > 0 ? t("ac.home.calls.late", { count: f.number(late) }, late) : t("ac.home.calls.none")} />;
  }
  if (which === "complaints" && data.complaints !== null) {
    const { open, slow, answerDays } = data.complaints;
    const wait = daysWord(t, f, answerDays);
    return <Kpi testId="amhome-complaints" icon="frown" tone="danger" label={t("ac.home.complaints")} value={f.number(open)} sub={slow > 0 ? t("ac.home.complaints.slow", { count: f.number(slow), wait }, slow) : t("ac.home.complaints.none", { wait })} />;
  }
  if (which === "answers" && data.answers !== null) {
    const { unreplied } = data.answers;
    return <Kpi testId="amhome-answers" icon="star" tone="accent" label={t("ac.home.answers")} value={f.number(unreplied)} sub={unreplied > 0 ? t("ac.home.answers.some", { count: f.number(unreplied) }, unreplied) : t("ac.home.answers.none")} />;
  }
  return null;
}

function Group({ testId, tone, label, count, children, empty, shown }: { testId: string; tone: string; label: string; count: number; children: ReactNode; empty: string; shown: number }) {
  const t = useT();
  const { f } = useFacts();
  return (
    <div data-group={testId}>
      <div className="crm-queue-group">
        <span className="crm-dot" data-tone={tone} />
        <span className="crm-queue-group-label">{label}</span>
        <span className="crm-queue-group-count">{f.number(count)}</span>
      </div>
      <ul className="crm-queue-list">{children}</ul>
      {shown === 0 && <div className="crm-as-queue-empty">{empty}</div>}
      {count > shown && shown > 0 && <div className="crm-as-queue-empty">{t("ac.home.more", { shown: f.number(shown) })}</div>}
    </div>
  );
}

function Row({ to, icon, tone, title, chip, sub, due, late, value }: { to: RouteKey; icon: string; tone: string; title: string; chip: string | null; sub: string | null; due: string; late: boolean; value?: string }) {
  return (
    <li className="crm-step crm-as-step" data-late={late ? "1" : "0"} data-open="0">
      <span className="crm-as-step-icon" data-tone={tone}>
        <Icon name={icon} size={15} />
      </span>
      <div className="crm-step-main">
        <div className="crm-step-title">
          <ScreenLink to={to} className="crm-step-deal crm-as-open">
            {title}
          </ScreenLink>
          {chip !== null && (
            <span className="crm-chip">
              <span className="crm-dot" data-tone="accent" />
              {chip}
            </span>
          )}
        </div>
        {sub !== null && sub !== "" && <div className="crm-step-sub crm-ac-home-sub">{sub}</div>}
      </div>
      <div className="crm-step-end">
        <span className={late ? "crm-pill crm-mono" : "crm-mono crm-step-due"} data-tone={late ? "danger" : undefined}>
          {due}
        </span>
        {value !== undefined && <span className="crm-mono crm-step-amount">{value}</span>}
      </div>
    </li>
  );
}

export function AfterGroup({ data, which }: { data: AfterHome | null; which: "calls" | "complaints" | "answers" }) {
  const t = useT();
  const { f, today } = useFacts();
  if (data === null) return null;
  if (which === "calls" && data.calls !== null) {
    const { due, rows } = data.calls;
    return (
      <Group testId="calls" tone="accent" label={t("ac.home.group.calls")} count={due} empty={t("ac.home.group.calls.none")} shown={rows.length}>
        {rows.map((call) => (
          <Row
            key={call.id}
            to="aftercare"
            icon="phone-call"
            tone={call.state === "late" ? "danger" : "accent"}
            title={jobLabel(t, call.job, (call.callNo ?? 1) > 1)}
            chip={call.job?.company ?? null}
            sub={call.job?.contact == null ? null : t("ac.calls.ring", { name: call.job.contact })}
            due={f.dayShort(new Date(call.dueAt))}
            late={call.state === "late"}
          />
        ))}
      </Group>
    );
  }
  if (which === "complaints" && data.complaints !== null) {
    const { open, rows, answerDays } = data.complaints;
    return (
      <Group testId="complaints" tone="danger" label={t("ac.home.group.complaints")} count={open} empty={t("ac.home.group.complaints.none")} shown={rows.length}>
        {rows.map((row) => {
          const days = row.raisedOn === null ? 0 : daysBetween(row.raisedOn, today);
          return (
            <Row
              key={row.id}
              to="complaints"
              icon={row.cause === null ? "frown" : CAUSE_ICON[row.cause]}
              tone="danger"
              title={row.cause === null ? (row.company ?? "") : t(keyOf(`ac.cause.${row.cause}`))}
              chip={row.company}
              sub={row.text}
              due={t("ac.cp.daysOpen", { count: f.number(days) }, days)}
              late={days >= answerDays}
            />
          );
        })}
      </Group>
    );
  }
  if (which === "answers" && data.answers !== null) {
    const { unreplied, rows } = data.answers;
    return (
      <Group testId="answers" tone="warn" label={t("ac.home.group.answers")} count={unreplied} empty={t("ac.home.group.answers.none")} shown={rows.length}>
        {rows.map((row) => (
          <Row
            key={row.id}
            to="feedback"
            icon="star"
            tone="warn"
            title={t("ac.home.answer.title", { name: row.job?.contact ?? t("ac.someone"), job: row.job?.code ?? jobLabel(t, row.job) })}
            chip={row.job?.company ?? null}
            sub={row.text}
            due={row.answeredOn === null ? "" : t("ac.fb.answered", { day: f.dayShort(noonOf(row.answeredOn)) })}
            late={false}
            value={t("ac.fb.score", { score: f.number(row.score) })}
          />
        ))}
      </Group>
    );
  }
  return null;
}
