/**
 * WHAT CAN BE DONE TO A DEAL FROM ANYWHERE: start one, close one.
 *
 * The two dialogs live here, once, above the screens. A screen asks for one
 * (`useDealActions().start()`, `.close(deal)`) and reads `changed`, a number
 * that goes up after each save, so its own lists are read again at once and
 * not only when the live stream says so.
 *
 * `N` starts a deal from any screen, for somebody who may make one, unless
 * they are typing or another dialog is open.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useSession } from "../session/session.tsx";
import { CloseDeal, type ClosingDeal } from "./CloseDeal.tsx";
import { NewDeal, type NewDealStart } from "./NewDeal.tsx";

export interface DealActions {
  /** Whether this person may start a deal at all: the part is on and the server lets them make one. */
  canStart: boolean;
  start: (from?: NewDealStart) => void;
  close: (deal: ClosingDeal) => void;
  /** Goes up after every deal saved or closed here. */
  changed: number;
}

const DealActionsContext = createContext<DealActions | null>(null);

export function useDealActions(): DealActions {
  const actions = useContext(DealActionsContext);
  if (actions === null) throw new Error("useDealActions is read inside <DealActionsProvider>");
  return actions;
}

const typing = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function DealActionsProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const canStart = session.part("selling") && session.can("deals", "create") && session.can("companies", "read") && session.can("stages", "read");
  const [starting, setStarting] = useState<NewDealStart | null>(null);
  const [closing, setClosing] = useState<ClosingDeal | null>(null);
  const [changed, setChanged] = useState(0);

  const start = useCallback(
    (from: NewDealStart = {}) => {
      if (canStart) setStarting(from);
    },
    [canStart],
  );
  const close = useCallback((deal: ClosingDeal) => setClosing(deal), []);

  useEffect(() => {
    if (!canStart) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (typing(event.target) || document.querySelector('[role="dialog"], [role="menu"]') !== null) return;
      event.preventDefault();
      setStarting({});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canStart]);

  const value = useMemo<DealActions>(() => ({ canStart, start, close, changed }), [canStart, start, close, changed]);
  return (
    <DealActionsContext.Provider value={value}>
      {children}
      {starting !== null && <NewDeal start={starting} onClose={() => setStarting(null)} onSaved={() => setChanged((n) => n + 1)} />}
      {closing !== null && <CloseDeal deal={closing} onClose={() => setClosing(null)} onClosed={() => setChanged((n) => n + 1)} />}
    </DealActionsContext.Provider>
  );
}
