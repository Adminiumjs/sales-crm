/**
 * What every Accounts screen reads before it draws: the session, the
 * formatters, and what this reader is answered about deals.
 */
import { useMemo, type ReactNode } from "react";

import { useI18n } from "../../i18n/index.tsx";
import { formatters, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { reachOf, toneOf, type Reach } from "./data.ts";

export function useAccounts(): { session: StaffSession; f: Formatters; locale: string; reach: Reach } {
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const reach = useMemo(() => reachOf(session), [session]);
  return { session, f, locale, reach };
}

/** A company's coloured tile with its icon: the picture at the top of a card and of a profile. */
export function Tile({ id, size, children }: { id: number; size: "card" | "profile" | "small"; children?: ReactNode }) {
  return (
    <div className="crm-acc-tile" data-size={size} data-tone={toneOf(id)}>
      <span className="crm-acc-tile-icon">
        <Icon name="building-2" size={size === "profile" ? 46 : size === "card" ? 32 : 20} />
      </span>
      {children}
    </div>
  );
}
