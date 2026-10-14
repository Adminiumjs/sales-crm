/** What the "customers after a sale" screens share: the formatters for the reader, today where the business is, and a figure tile. */
import { useMemo } from "react";

import { useI18n } from "../../i18n/index.tsx";
import { formatters, noonOf, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { StaffSession } from "../../staffSession.ts";

export function useFacts(): { session: StaffSession; f: Formatters; today: string; day: (key: string) => string } {
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  // The server's clock, where the business is: the browser's own is never asked what day it is.
  const today = useMemo(() => f.dayKey(session.now()), [f, session]);
  const day = useMemo(() => (key: string) => f.date(noonOf(key)), [f]);
  return { session, f, today, day };
}

export function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub: string; tone?: "pos" | "accent" | "muted"; testId?: string }) {
  return (
    <div className="crm-stat mr-card" data-testid={testId}>
      <div className="crm-stat-label">{label}</div>
      <div className="crm-stat-value crm-mono" data-tone={tone ?? "plain"}>
        {value}
      </div>
      <div className="crm-stat-sub">{sub}</div>
    </div>
  );
}

export function Kpi({ icon, tone, label, value, sub, testId }: { icon: string; tone: "accent" | "pos" | "danger"; label: string; value: string; sub: string; testId?: string }) {
  return (
    <div className="crm-kpi mr-card" data-testid={testId}>
      <div className="crm-kpi-head">
        <span className="crm-kpi-icon" data-tone={tone}>
          <Icon name={icon} size={15} />
        </span>
        <span className="crm-kpi-label">{label}</span>
      </div>
      <div className="crm-kpi-value">{value}</div>
      <div className="crm-kpi-sub">{sub}</div>
    </div>
  );
}
