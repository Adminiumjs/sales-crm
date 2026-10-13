/**
 * CLOSE THIS DEAL: won, or lost with the reason, and a note for the team.
 *
 * It is one of the deal's own buttons on the server (`mark-won`,
 * `mark-lost`), pressed from the state the screen saw: "open". A deal
 * somebody closed in the meantime is not closed again, and a reply that
 * never arrives is read back before anything is said. The server stamps
 * when it closed, locks the deal, and refuses a loss with no reason.
 */
import { useState } from "react";

import { useT } from "../i18n/index.tsx";
import { useSession } from "../session/session.tsx";
import { Icon } from "../shell/icons.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { useLoad } from "../ui/load.tsx";
import { useToasts } from "../ui/toast.tsx";

export interface ClosingDeal {
  id: number;
  name: string;
  company: string | null;
  /** The amount, already written for the reader. */
  amount: string;
}

interface Reason extends Record<string, unknown> {
  id: number;
  label: string;
}

export function CloseDeal({ deal, onClose, onClosed }: { deal: ClosingDeal; onClose: () => void; onClosed: (as: "won" | "lost") => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const [won, setWon] = useState<boolean | null>(null);
  const [reasonId, setReasonId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { load } = useLoad(() => session.list<Reason>("lost_reasons", { select: ["id", "label"], order: ["position"], limit: 100 }), [session]);
  const reasons = load.state === "ready" ? load.data.rows : [];
  const blocked = won === null || (!won && reasonId === null);

  const confirm = async (): Promise<void> => {
    if (blocked || won === null) return;
    setBusy(true);
    const text = note.trim();
    const values = { ...(won ? {} : { lost_reason_id: reasonId }), ...(text === "" ? {} : { close_note: text }) };
    const reason = reasons.find((one) => one.id === reasonId)?.label ?? "";
    const done = await toasts.say(session.act("deals", deal.id, won ? "mark-won" : "mark-lost", "open", { values }), () => (won ? t("deal.close.toast.won", { deal: deal.name, amount: deal.amount }) : t("deal.close.toast.lost", { deal: deal.name, reason })));
    setBusy(false);
    if (done === null) return;
    onClosed(won ? "won" : "lost");
    onClose();
  };

  return (
    <Dialog
      shape="box"
      name="close-deal"
      icon="handshake"
      title={t("deal.close.title")}
      subtitle={deal.company === null ? deal.name : `${deal.name} · ${deal.company}`}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("deal.close.notYet")}
          </button>
          <button type="button" className="crm-btn crm-btn-44 mr-btn" data-tone={won === false ? "danger" : "pos"} disabled={blocked || busy} onClick={() => void confirm()}>
            {busy ? t("ui.saving") : t(won === false ? "deal.close.confirm.lost" : "deal.close.confirm.won")}
          </button>
        </>
      }
    >
      <div className="crm-pick-pair" role="radiogroup" aria-label={t("deal.close.title")}>
        <button type="button" role="radio" aria-checked={won === true} data-autofocus data-tone="pos" className="crm-pick mr-btn" disabled={busy} onClick={() => setWon(true)}>
          <Icon name="trophy" size={17} />
          {t("deal.close.won")}
        </button>
        <button type="button" role="radio" aria-checked={won === false} data-tone="danger" className="crm-pick mr-btn" disabled={busy} onClick={() => setWon(false)}>
          <Icon name="circle-slash" size={17} />
          {t("deal.close.lost")}
        </button>
      </div>

      {won === true && (
        <div className="crm-booked">
          <div className="crm-booked-line">
            <span className="crm-booked-label">{t("deal.close.booked")}</span>
            <span className="crm-booked-value crm-mono">{deal.amount}</span>
          </div>
          <p>{t("deal.close.booked.body")}</p>
        </div>
      )}

      {won === false && (
        <div className="crm-why">
          <div className="crm-label" id="crm-cd-why">
            {t("deal.close.why")} <span className="crm-required">{t("deal.close.required")}</span>
          </div>
          <div className="crm-why-list" role="radiogroup" aria-labelledby="crm-cd-why">
            {reasons.map((reason) => (
              <button key={reason.id} type="button" role="radio" aria-checked={reasonId === reason.id} className="crm-why-item mr-row" disabled={busy} onClick={() => setReasonId(reason.id)}>
                <span className="crm-why-dot" />
                {reason.label}
              </button>
            ))}
            {load.state === "ready" && reasons.length === 0 && <p className="crm-field-note">{t("deal.close.why.none")}</p>}
          </div>
        </div>
      )}

      {won !== null && (
        <>
          <label className="crm-label" htmlFor="crm-cd-note">
            {t("deal.close.note")}
          </label>
          <textarea id="crm-cd-note" className="crm-input crm-textarea mr-fld" value={note} maxLength={600} disabled={busy} placeholder={t(won ? "deal.close.note.hint.won" : "deal.close.note.hint.lost")} onChange={(event) => setNote(event.target.value)} />
        </>
      )}
    </Dialog>
  );
}
