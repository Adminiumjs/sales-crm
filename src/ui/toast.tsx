/**
 * The line at the foot of the screen that says what a save came to.
 *
 * A save has three ends (`staffSession.ts`): saved, refused by the server
 * with its reason, or unknown (no reply, and nothing could be read back).
 * `say` words each of them the same way on every screen, and while a lost
 * reply is being read back the line says "checking", never "not saved".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useT, type TFunction } from "../i18n/index.tsx";
import type { Saved, StaffError } from "../staffSession.ts";
import { Icon } from "../shell/icons.tsx";

type Tone = "pos" | "danger" | "plain";
interface Line {
  id: number;
  text: string;
  tone: Tone;
  /** Stays until dismissed or replaced: something the person has to read. */
  sticky: boolean;
}

interface Toasts {
  show: (text: string, tone?: Tone, sticky?: boolean) => void;
  /** Run a save and say how it ended. Answers the row when it was saved, else null. */
  say: <R>(save: Promise<Saved<R>>, done: (row: R) => string) => Promise<R | null>;
}

const ToastContext = createContext<Toasts | null>(null);

export function useToasts(): Toasts {
  const toasts = useContext(ToastContext);
  if (toasts === null) throw new Error("useToasts is read inside <ToastProvider>");
  return toasts;
}

/** Why the server said no, in the reader's words. Its own sentence only where no plainer one is known. */
export function reasonOf(error: StaffError, t: TFunction): string {
  if (error.status === 403) return t("ui.refused.notYours");
  if (error.status === 404) return t("ui.refused.gone");
  if (error.status === 409 && (error.code === "ROW_CHANGED" || error.code === "STATE_MOVE_REFUSED")) return t("ui.refused.changed");
  return error.message;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [line, setLine] = useState<Line | null>(null);
  const next = useRef(0);
  const show = useCallback((text: string, tone: Tone = "plain", sticky = false) => {
    next.current += 1;
    setLine({ id: next.current, text, tone, sticky });
  }, []);
  useEffect(() => {
    if (line === null || line.sticky) return;
    const timer = setTimeout(() => setLine((was) => (was?.id === line.id ? null : was)), 4200);
    return () => clearTimeout(timer);
  }, [line]);

  const say = useCallback(
    async <R,>(save: Promise<Saved<R>>, done: (row: R) => string): Promise<R | null> => {
      // A save that takes more than a moment is a reply on its way, or lost and being read back.
      const slow = setTimeout(() => show(t("ui.checking"), "plain", true), 1200);
      const saved = await save.finally(() => clearTimeout(slow));
      if (saved.state === "saved") {
        show(done(saved.row), "pos");
        return saved.row;
      }
      if (saved.state === "refused") show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
      else show(t("ui.unknown"), "danger", true);
      return null;
    },
    [show, t],
  );

  const value = useMemo<Toasts>(() => ({ show, say }), [show, say]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="crm-toast-region" aria-live="polite" aria-atomic="true">
        {line !== null && (
          <div key={line.id} className="crm-toast" data-tone={line.tone} role={line.tone === "danger" ? "alert" : "status"}>
            <Icon name={line.tone === "pos" ? "check" : line.tone === "danger" ? "circle-alert" : "loader"} />
            <span>{line.text}</span>
            {line.sticky && (
              <button type="button" className="crm-toast-close mr-gi" aria-label={t("ui.dismiss")} onClick={() => setLine(null)}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
