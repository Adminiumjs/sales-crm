/**
 * A deal's name where another screen lists it (a follow-up, a closed deal, a
 * quote): a link to its room for whoever may open deals, plain words for
 * anybody else. The server still decides whether THIS deal opens for them.
 */
import type { ReactNode } from "react";

import { useSession } from "../session/session.tsx";
import { useNav } from "../shell/nav.tsx";
import { isBuilt } from "../shell/screens.tsx";

export function DealLink({ id, className, children }: { id: number | null | undefined; className?: string; children: ReactNode }) {
  const session = useSession();
  const nav = useNav();
  if (id === null || id === undefined || !isBuilt("deal") || !session.part("selling") || !session.can("deals", "read")) return <span className={className}>{children}</span>;
  return (
    <span className={className}>
      <a
        href={nav.href("deal", id)}
        className="crm-deal-link"
        // Not carried when the card it sits on is: the card is what is dragged.
        draggable={false}
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          nav.go("deal", id);
        }}
      >
        {children}
      </a>
    </span>
  );
}
