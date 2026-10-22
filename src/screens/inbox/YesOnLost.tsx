/**
 * A CUSTOMER SAID YES TO A LOST DEAL (plan 68 R1a). A quote already sent stays
 * acceptable after its deal is lost; when the customer then accepts it, the
 * deal's owner decides: reopen the deal (its own button), or leave it closed
 * (the quote is stamped as seen, and leaves this list).
 *
 * Read from the quotes themselves, never from the bell: the lost deals the
 * reader reaches, then their accepted quotes nobody has looked at. So the line
 * is here even when the rule that rings the bell is switched off.
 */
import { useCallback, useMemo } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters } from "../../lib/format.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";

export interface LateYes {
  id: number;
  number: string;
  dealId: number;
  deal: string;
  acceptedName: string | null;
  decidedAt: string | null;
}

/** The accepted quotes, not yet looked at, of the lost deals the reader reaches; empty for somebody who reads no quote. */
export async function readLateYes(session: StaffSession): Promise<LateYes[]> {
  if (!session.part("quotes") || !session.can("quotes", "read") || !session.can("deals", "read")) return [];
  const lost = await session.list<{ id: number; name: string }>("deals", { select: ["id", "name"], where: { column: "state", op: "eq", value: "lost" }, order: ["id"], limit: 200 });
  if (lost.rows.length === 0) return [];
  const names = new Map(lost.rows.map((row) => [Number(row.id), row.name]));
  const quotes = await session.list<{ id: number; number: string; deal_id: number; accepted_name: string | null; decided_at: string | null }>("quotes", {
    select: ["id", "number", "deal_id", "accepted_name", "decided_at"],
    where: { and: [{ column: "status", op: "eq", value: "accepted" }, { column: "yes_seen_at", op: "is_null" }, { column: "deal_id", op: "in", value: [...names.keys()] }] },
    order: ["decided_at.desc", "id.desc"],
    limit: 50,
  });
  return quotes.rows.map((row) => ({ id: row.id, number: row.number, dealId: Number(row.deal_id), deal: names.get(Number(row.deal_id)) ?? "", acceptedName: row.accepted_name, decidedAt: row.decided_at }));
}

export function YesOnLost() {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const { load, reload } = useLoad(() => readLateYes(session), [session]);
  const again = useCoalesced(useCallback(() => reload(), [reload]));
  // Only somebody who reads both listens: a live stream of a table one may not read is refused.
  const reads = session.part("quotes") && session.can("quotes", "read") && session.can("deals", "read");
  useLive(reads ? ["quotes", "deals"] : [], again);
  if (load.state !== "ready" || load.data.length === 0) return null;
  const mayReopen = session.can("deals", "update");
  const mayLeave = session.can("quotes", "update");

  const reopen = async (row: LateYes): Promise<void> => {
    await toasts.say(session.act("deals", row.dealId, "reopen", "lost"), () => t("inbox.yes.toast.reopened", { deal: row.deal }));
    again();
  };
  const leave = async (row: LateYes): Promise<void> => {
    await toasts.say(session.update("quotes", row.id, { yes_seen_at: session.now().toISOString() }), () => t("inbox.yes.toast.left", { deal: row.deal }));
    again();
  };

  return (
    <section className="crm-inbox-yes" aria-labelledby="crm-inbox-yes-title" data-testid="inbox-yes-on-lost">
      <h2 id="crm-inbox-yes-title">{t("inbox.yes.title")}</h2>
      <ul className="crm-enq-list">
        {load.data.map((row) => (
          <li key={row.id} className="crm-enq mr-card" data-quote={row.id}>
            <div className="crm-enq-top">
              <span className="crm-enq-icon" aria-hidden="true">
                <Icon name="handshake" size={15} />
              </span>
              <div className="crm-inbox-yes-words">
                <strong>{t(row.acceptedName === null || row.acceptedName === "" ? "inbox.yes.line.nobody" : "inbox.yes.line", { name: row.acceptedName ?? "", quote: row.number })}</strong>
                <span>
                  <DealLink id={row.dealId}>{row.deal}</DealLink>
                  {row.decidedAt !== null && <span className="crm-mono"> · {f.dayShort(new Date(row.decidedAt))}</span>}
                </span>
              </div>
            </div>
            {(mayReopen || mayLeave) && (
              <div className="crm-enq-acts">
                {mayReopen && (
                  <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" onClick={() => void reopen(row)}>
                    <Icon name="rotate-ccw" size={13} />
                    {t("inbox.yes.reopen")}
                  </button>
                )}
                {mayLeave && (
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" onClick={() => void leave(row)}>
                    {t("inbox.yes.leave")}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
