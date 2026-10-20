/**
 * What the Vehicles and crew screens share: the reader's clock and
 * formatters, the settings they read once a page, which other screens this
 * person may open, the distance unit's words, and a small figure card.
 */
import { useCallback, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, noonOf, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { isBuilt } from "../../shell/screens.tsx";
import { canOpen, inMenu, waitsFor, type MenuFacts, type PartId, type RouteKey } from "../../shell/routes.ts";
import type { StaffSession } from "../../staffSession.ts";
import { useLoad } from "../../ui/load.tsx";
import { num } from "./data.ts";

export interface FleetScreen {
  session: StaffSession;
  f: Formatters;
  /** The server's clock, read once per look at the page. */
  now: Date;
  today: string;
  tick: () => void;
}

export function useFleetScreen(): FleetScreen {
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [now, setNow] = useState(() => session.now());
  const tick = useCallback(() => setNow(session.now()), [session]);
  return { session, f, now, today: f.dayKey(now), tick };
}

/** The settings the fleet's screens read: the distance unit and the inspection warning. Read once a page; the install's own defaults when the row is not readable. */
export interface FleetSettings {
  unit: "km" | "miles";
  inspectionWarnDays: number;
}

export function useFleetSettings(session: StaffSession) {
  return useLoad<FleetSettings>(async () => {
    if (!session.can("settings", "read")) return { unit: "km", inspectionWarnDays: 30 };
    const page = await session.list<{ distance_unit: string | null; inspection_warn_days: number | null }>("settings", { select: ["distance_unit", "inspection_warn_days"], limit: 1 });
    const row = page.rows[0];
    return { unit: row?.distance_unit === "miles" ? "miles" : "km", inspectionWarnDays: row?.inspection_warn_days === null || row?.inspection_warn_days === undefined ? 30 : num(row.inspection_warn_days) };
  }, [session]);
}

/** Whether this person may open another screen, by the same three tests the menu uses, and their role lists it. */
export function useOpens(): (route: RouteKey) => boolean {
  const session = useSession();
  const config = session.config;
  return useMemo(() => {
    const facts: MenuFacts = {
      roles: (config.access?.roles ?? []).map((role) => role.slug),
      part: (id: PartId) => session.part(id),
      waits: (id: PartId) => waitsFor(id, session.part(id), (addOn) => config.addOns[addOn] !== undefined),
      reads: (table) => session.can(table, "read"),
      built: isBuilt,
    };
    return (route: RouteKey) => canOpen(route, facts) && inMenu(route, facts.roles);
  }, [config, session]);
}

/** `Tue, Aug 4` for a day key. */
export const dayWords = (f: Formatters, day: string): string => f.dayShort(noonOf(day));
/** `Aug 4, 2026` for a day key. */
export const dateWords = (f: Formatters, day: string): string => f.date(noonOf(day));

/** One decimal place, as the reader's language writes it. */
export const oneDecimal = (f: Pick<Formatters, "number">, value: number): string => f.number(Math.round(value * 10) / 10);

/** A distance in the install's unit, whole. */
export const distanceOf = (f: Pick<Formatters, "number">, value: number): string => f.number(Math.round(value));

/** A money figure per unit of distance: three places, so 0.240 reads as the ledger has it. */
export function moneyRate(f: Formatters, locale: string, currency: string | null, value: number): string {
  if (currency === null) return f.number(Math.round(value * 1000) / 1000);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value);
  } catch {
    return f.number(Math.round(value * 1000) / 1000);
  }
}

/** The figure card the fleet's screens draw: a label, the number, a line under it. */
export function Figure({ label, value, sub, tone, name }: { label: string; value: string; sub?: string; tone?: "danger" | "warn" | "pos"; name: string }) {
  return (
    <div className="crm-kpi crm-fl-stat" data-figure={name} data-tone={tone}>
      <div className="crm-kpi-head">
        <span className="crm-kpi-label">{label}</span>
      </div>
      <div className="crm-kpi-value crm-fl-stat-value crm-mono" data-value>
        {value}
      </div>
      {sub !== undefined && sub !== "" && <div className="crm-kpi-sub">{sub}</div>}
    </div>
  );
}

/** A form's line that says why the server refused, or that the reply was lost and nothing could be read back. */
export function FormError({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <div className="crm-form-error" role="alert">
      <span>{text}</span>
    </div>
  );
}

export function useUnitWords(unit: "km" | "miles"): { short: string; per100: string } {
  const t = useT();
  return unit === "miles" ? { short: t("fl.unit.mi"), per100: t("fl.unit.per100.mi") } : { short: t("fl.unit.km"), per100: t("fl.unit.per100.km") };
}
