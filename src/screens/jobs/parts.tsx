/**
 * What the Jobs on site screens share: the reader's clock and formatters, the
 * crews read once a page, a row of day chips and of crew chips, a figure
 * card, and the line that says why a write was refused.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { addDays, formatters, noonOf, weekOf, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { useLoad } from "../../ui/load.tsx";
import { dayOfKey } from "../appsettings/data.ts";
import { readCrewFacts, type CrewFacts, num } from "./data.ts";

export interface JobsScreen {
  session: StaffSession;
  f: Formatters;
  /** The server's clock, read once per look at the page. */
  now: Date;
  today: string;
  /** Read the clock again (after a save, or a colleague's change). */
  tick: () => void;
}

export function useJobsScreen(): JobsScreen {
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [now, setNow] = useState(() => session.now());
  const tick = useCallback(() => setNow(session.now()), [session]);
  return { session, f, now, today: f.dayKey(now), tick };
}

/** The crews, their people and days, the people's names and the settings: read once a page. */
export function useCrewFacts(session: StaffSession) {
  return useLoad<CrewFacts>(() => readCrewFacts(session), [session]);
}

/** `Tue, Aug 4` for a day key. */
export const dayWords = (f: Formatters, day: string): string => f.dayShort(noonOf(day));
/** `Tuesday, August 4, 2026` for a day key. */
export const dayLong = (f: Formatters, day: string): string => f.dayLong(noonOf(day));
/** Monday of the week a day is in. */
export const mondayOf = (day: string): string => weekOf(day)[0];
/** A number of hours, one decimal place at most. */
export const hoursOf = (f: Formatters, value: unknown): string => f.number(Math.round(num(value) * 10) / 10);

/** Days to pick from, as chips: the working days of one week, each dim when nothing is booked. */
export function DayChips({ days, picked, busy, onPick, f, label }: { days: string[]; picked: string; busy: ReadonlySet<string>; onPick: (day: string) => void; f: Formatters; label: string }) {
  return (
    <div className="crm-chips crm-jb-days" role="group" aria-label={label}>
      {days.map((day) => (
        <button key={day} type="button" className="crm-chip-btn mr-chip" aria-pressed={picked === day} data-day={day} data-quiet={busy.has(day) ? undefined : "1"} onClick={() => onPick(day)}>
          {f.weekdayShort(noonOf(day))} <span className="crm-mono">{dayNumber(day, f)}</span>
        </button>
      ))}
    </div>
  );
}

/** The day of the month in the reader's digits. */
const dayNumber = (day: string, f: Formatters): string => f.number(Number(day.slice(8, 10)));

/** The weeks around a day: the arrows and the week's words. */
export function WeekBar({ monday, today, onWeek, f, children }: { monday: string; today: string; onWeek: (monday: string) => void; f: Formatters; children?: ReactNode }) {
  const t = useT();
  const { dir } = useI18n();
  const thisWeek = mondayOf(today);
  const last = addDays(monday, 6);
  return (
    <div className="crm-jb-weekbar">
      <button type="button" className="crm-icon-btn crm-jb-arrow mr-gi" aria-label={t("jb.week.before")} onClick={() => onWeek(addDays(monday, -7))}>
        <Icon name={dir === "rtl" ? "chevron-right" : "chevron-left"} />
      </button>
      <span className="crm-jb-weeklabel crm-mono" aria-live="polite" data-testid="jb-week">
        {t("jb.week.span", { from: dayWords(f, monday), to: dayWords(f, last) })}
      </span>
      <button type="button" className="crm-icon-btn crm-jb-arrow mr-gi" aria-label={t("jb.week.after")} onClick={() => onWeek(addDays(monday, 7))}>
        <Icon name={dir === "rtl" ? "chevron-left" : "chevron-right"} />
      </button>
      <button type="button" className="crm-chip-btn mr-chip" aria-pressed={monday === thisWeek} onClick={() => onWeek(thisWeek)}>
        {t("jb.week.this")}
      </button>
      {children}
    </div>
  );
}

/** Crews to pick from, as chips. */
export function CrewChips({ facts, picked, onPick, label }: { facts: CrewFacts; picked: number | null; onPick: (crewId: number) => void; label: string }) {
  return (
    <div className="crm-chips crm-jb-crews" role="group" aria-label={label}>
      {facts.crews.map((crew, i) => (
        <button key={crew.id} type="button" className="crm-chip-btn mr-chip" aria-pressed={picked === crew.id} data-crew={crew.id} onClick={() => onPick(crew.id)}>
          <span className="crm-jb-dot" data-colour={i % 8} aria-hidden="true" />
          {crew.name}
        </button>
      ))}
    </div>
  );
}

/** One figure: a label, the number, a line under it. */
export function Stat({ label, value, sub, tone, name, icon }: { label: string; value: string; sub?: string; tone?: "danger" | "warn" | "pos" | "info"; name: string; icon?: string }) {
  return (
    <div className="crm-kpi crm-jb-stat" data-figure={name} data-tone={tone}>
      <div className="crm-kpi-head">
        {icon !== undefined && (
          <span className="crm-kpi-icon" data-tone={tone}>
            <Icon name={icon} size={14} />
          </span>
        )}
        <span className="crm-kpi-label">{label}</span>
      </div>
      <div className="crm-kpi-value crm-jb-stat-value" data-value>
        {value}
      </div>
      {sub !== undefined && <div className="crm-kpi-sub">{sub}</div>}
    </div>
  );
}

/** The weekday of a day key, in the reader's language. */
export const weekdayOf = (f: Formatters, day: string): string => f.weekdayLong(noonOf(day));
export { dayOfKey };
