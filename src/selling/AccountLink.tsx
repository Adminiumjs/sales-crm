/**
 * A company's or a contact's name where another screen shows it (a deal's
 * room, a contact's card): a link to the company's profile, or to the contact
 * on the Contacts screen, for whoever has Accounts in their menu. Plain words
 * for anybody else.
 */
import type { ReactNode } from "react";

import { useSession } from "../session/session.tsx";
import { useNav } from "../shell/nav.tsx";
import { inMenu } from "../shell/routes.ts";
import { isBuilt } from "../shell/screens.tsx";

export function AccountLink({ to, id, className, children }: { to: "companies" | "contacts"; id: number | null | undefined; className?: string; children: ReactNode }) {
  const session = useSession();
  const nav = useNav();
  const roles = (session.config.access?.roles ?? []).map((role) => role.slug);
  if (id === null || id === undefined || !isBuilt(to) || !session.part("accounts") || !session.can(to, "read") || !inMenu(to, roles)) return <span className={className}>{children}</span>;
  return (
    <a
      href={nav.href(to, id)}
      className={className === undefined ? "crm-deal-link" : `${className} crm-deal-link`}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        nav.go(to, id);
      }}
    >
      {children}
    </a>
  );
}
