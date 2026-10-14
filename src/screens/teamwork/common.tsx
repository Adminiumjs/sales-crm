/**
 * THE TEAM'S SCREENS: the parts they draw with (a heading, an avatar, the
 * chips that say whose page this is, a row of the one action list). What they
 * read and write in common is in `data.ts`, re-exported here.
 */
import { useMemo, type ReactNode } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters, noonOf, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { alsoIn, truthy, type Action, type Names, type Source } from "./data.ts";

export * from "./data.ts";

/** The formatters of whoever is reading, on the install's currency and clock. */
export function useF(): Formatters {
  const { locale } = useI18n();
  const config = useSession().config;
  return useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
}

export function Avatar({ name, size = "md", tone }: { name: string; size?: "sm" | "md" | "lg"; tone?: "accent" }) {
  return (
    <span className={`crm-avatar${size === "sm" ? " crm-avatar-sm" : size === "lg" ? " crm-avatar-lg" : ""}`} data-tone={tone} aria-hidden="true">
      {name === "" ? "?" : initials(name)}
    </span>
  );
}

/** A screen's heading, its line of what it is, and what stands at its far end. */
export function Head({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="crm-screen-head">
      <div>
        <h1>{title}</h1>
        {sub !== undefined && <p className="crm-screen-sub">{sub}</p>}
      </div>
      {children !== undefined && <div className="crm-screen-actions">{children}</div>}
    </div>
  );
}

export function Empty({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="crm-empty crm-tw-empty">
      <span className="crm-empty-icon">
        <Icon name={icon} size={21} />
      </span>
      <div className="crm-empty-title">{title}</div>
      {body !== undefined && <p>{body}</p>}
    </div>
  );
}

/** The chips that say whose page this is, for somebody who reads several people's. */
export function PersonChips({ people, names, value, onPick, label }: { people: string[]; names: Names; value: string | null; onPick: (id: string) => void; label: string }) {
  return (
    <div className="crm-chips crm-tw-people" role="group" aria-label={label}>
      {people.map((id) => (
        <button key={id} type="button" className="crm-chip-btn mr-chip" aria-pressed={value === id} data-person={id} onClick={() => onPick(id)}>
          <Avatar name={names[id] ?? ""} size="sm" />
          {firstName(names[id] ?? "")}
        </button>
      ))}
    </div>
  );
}

/* ─── The one action list ─────────────────────────────────────────────────── */

const ALSO_KEY = {
  "one-to-one": "team.action.also.oneToOne",
  coaching: "team.action.also.coaching",
  meeting: "team.action.also.meeting",
} as const;

/**
 * One row of the list: a tick (a real checkbox, so a keyboard and a screen
 * reader have it), what is to be done, whose it is and by when, and where
 * else it is shown.
 */
export function ActionRow({ action, here, names, f, onTick, busy = false }: { action: Action; here: Source; names: Names; f: Formatters; onTick: ((action: Action, done: boolean) => void) | null; busy?: boolean }) {
  const t = useT();
  const done = truthy(action.done);
  const also = alsoIn(action, here);
  const owner = firstName(names[action.owner_id] ?? "");
  return (
    <li className="crm-tw-action" data-done={done ? "1" : "0"} data-action={action.id}>
      <button type="button" className="crm-tw-tick mr-gi" role="checkbox" aria-checked={done} aria-label={action.text} disabled={onTick === null || busy} onClick={() => onTick?.(action, !done)}>
        {done && <Icon name="check" size={13} />}
      </button>
      <span className="crm-tw-action-text">
        {action.text}
        <span className="crm-tw-action-meta">
          {[owner, action.due_on === null || action.due_on === "" ? "" : t("team.action.due", { day: f.dayShort(noonOf(action.due_on)) }), ...also.map((place) => t(ALSO_KEY[place]))].filter((part) => part !== "").join(" · ")}
        </span>
      </span>
      {names[action.owner_id] !== undefined && <Avatar name={names[action.owner_id] ?? ""} size="sm" />}
    </li>
  );
}
