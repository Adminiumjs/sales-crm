/** What the "After the job" pages share: a job's words, a row's age, a company's tile, and the row of filter chips. */
import type { ReactNode } from "react";

import type { MessageKey } from "../../i18n/messages/index.ts";
import type { TFunction } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { initials } from "../../ui/people.ts";
import { daysBetween, type Job } from "./data.ts";

/** `J-06 · Legal library shelving`, `(second call)` added for a second call; a job the reader cannot open says so. */
export function jobLabel(t: TFunction, job: Job | null, second = false): string {
  const label = job === null || (job.code === null && job.title === null) ? t("ac.job.hidden") : job.title === null ? (job.code ?? "") : job.code === null ? job.title : t("ac.job", { code: job.code, title: job.title });
  return second ? t("ac.calls.second", { job: label }) : label;
}

/** `3 days`, as the reader's language counts them. */
export const daysWord = (t: TFunction, f: Formatters, days: number): string => t("ac.days", { count: f.number(days) }, days);

/** How long ago a day was, from the server's today: today, yesterday, 5 days ago. */
export function ageOf(t: TFunction, f: Formatters, day: string | null, today: string): string {
  if (day === null) return "";
  const days = daysBetween(day, today);
  if (days <= 0) return t("ac.age.today");
  if (days === 1) return t("ac.age.yesterday");
  return t("ac.age.days", { count: f.number(days) }, days);
}

/** A company's two letters in a tile; a row with no company it can name gets a quiet blank one. */
export function CoTile({ name, size = 32 }: { name: string | null; size?: 32 | 26 }) {
  return (
    <span className="crm-ac-tile" data-size={size} aria-hidden="true">
      {name === null ? "" : initials(name)}
    </span>
  );
}

/** The chips that narrow a list, each with the server's count. One is pressed. */
export function Chips<K extends string>({ label, chips, value, onPick }: { label: string; chips: readonly { key: K; label: string; count: number }[]; value: K; onPick: (key: K) => void }) {
  return (
    <div className="crm-chips crm-ac-chips" role="group" aria-label={label}>
      {chips.map((chip) => (
        <button key={chip.key} type="button" className="crm-chip-btn mr-chip" aria-pressed={value === chip.key} data-chip={chip.key} onClick={() => onPick(chip.key)}>
          {chip.label}
          <span className="crm-ac-chip-count crm-mono">{chip.count}</span>
        </button>
      ))}
    </div>
  );
}

/** A message key built from a value (a state, a cause), typed as one. */
export const keyOf = (key: string): MessageKey => key as MessageKey;

/** The word for a list's empty state when a chip has narrowed it to nothing. */
export function Empty({ icon, title, body }: { icon: ReactNode; title: string; body?: string }) {
  return (
    <div className="crm-empty crm-ac-empty">
      <span className="crm-empty-icon">{icon}</span>
      <div className="crm-empty-title">{title}</div>
      {body !== undefined && <p>{body}</p>}
    </div>
  );
}

/** A figure tile, as the other screens draw one, with the tones these pages need (a late call, an overdue answer). */
export function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub: string; tone?: "pos" | "danger" | "warn" | "accent" | "muted"; testId?: string }) {
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
