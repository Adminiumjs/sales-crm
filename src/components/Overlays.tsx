/**
 * The overlay layer: toasts and the close-deal dialog.
 *
 * Both are mounted once at the root, outside the view switch, so a view change
 * never remounts them and a toast raised by an action survives the navigation
 * that action triggered.
 */

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { STAGES } from "../data/live.ts";
import { LOST_REASONS } from "../data/demo.ts";
import { useI18n } from "../i18n/index.tsx";
import { label, money } from "../lib/format.ts";
import { stageById } from "../lib/pipeline.ts";
import { useStore } from "../state/store.ts";
import { Button, Chip, Mono } from "./Primitives.tsx";

export function ToastLayer() {
  const { t } = useI18n();
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div className="mr-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`mr-toast mr-toast--${toast.tone}`}>
          {toast.tone === "pos" && <Check size={15} aria-hidden="true" />}
          <span>{toast.text}</span>
          <button
            type="button"
            className="mr-toast__x"
            onClick={() => dismiss(toast.id)}
            aria-label={t("chrome.toast.dismiss")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Closing a deal. Winning is one tap; losing requires a reason, and the
 * confirm button stays disabled with a visible explanation rather than
 * disappearing — a disabled control that says why is kinder than a missing one.
 */
export function CloseDealDialog() {
  const { t } = useI18n();
  const closingId = useStore((s) => s.closingId);
  const deals = useStore((s) => s.deals);
  const closeDeal = useStore((s) => s.closeDeal);
  const openCloseDialog = useStore((s) => s.openCloseDialog);

  const [won, setWon] = useState(true);
  const [reason, setReason] = useState<string | null>(null);

  // Re-arm the dialog whenever it opens on a different deal.
  useEffect(() => {
    if (closingId !== null) {
      setWon(true);
      setReason(null);
    }
  }, [closingId]);

  if (closingId === null) return null;
  const deal = deals.find((d) => d.id === closingId);
  if (!deal) return null;

  const stage = stageById(STAGES, deal.stage);
  const blocked = !won && reason === null;

  return (
    <div
      className="mr-modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) openCloseDialog(null);
      }}
    >
      <div className="mr-modal" role="dialog" aria-modal="true" aria-label={t("board.close.title", { deal: label(deal.name) })}>
        <h2 className="mr-modal__title">{t("board.close.title", { deal: label(deal.name) })}</h2>
        <p className="mr-panel__sub" style={{ marginBlockEnd: 16 }}>
          <Mono>{money(deal.amount)}</Mono> · {label(stage.label)}
        </p>

        <div style={{ display: "flex", gap: 9 }}>
          <Button tone={won ? "pos" : "ghost"} onClick={() => setWon(true)} className="mr-flex1">
            {t("board.close.won")}
          </Button>
          <Button tone={!won ? "danger" : "ghost"} onClick={() => setWon(false)} className="mr-flex1">
            {t("board.close.lost")}
          </Button>
        </div>

        {!won && (
          <div style={{ marginBlockStart: 16 }}>
            <div className="mr-label" style={{ marginBlockEnd: 8 }}>
              {t("board.close.reason")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {LOST_REASONS.map((key) => (
                <Chip
                  key={key}
                  onClick={() => setReason(key)}
                  pressed={reason === key}
                >
                  {label(key)}
                </Chip>
              ))}
            </div>
            {blocked && (
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--warn)",
                  marginBlockStart: 10,
                }}
              >
                {t("board.close.reason.required")}
              </p>
            )}
          </div>
        )}

        <div className="mr-modal__actions">
          <Button tone="ghost" onClick={() => openCloseDialog(null)}>
            {t("chrome.action.cancel")}
          </Button>
          <Button
            tone={won ? "pos" : "danger"}
            disabled={blocked}
            onClick={() => closeDeal(deal.id, won, reason ?? undefined)}
          >
            {t(won ? "board.close.confirmWon" : "board.close.confirmLost")}
          </Button>
        </div>
      </div>
    </div>
  );
}
