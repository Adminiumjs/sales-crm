/**
 * The small shared pieces: buttons, chips, panels, fields, avatars, tinted
 * tiles, KPI cards and empty states.
 *
 * They are grouped in one module rather than one file each because none of
 * them is more than a handful of lines and they are always imported together.
 * Anything with real behaviour — the dock, the shell, the toast layer — lives
 * in its own file.
 */

import type { CSSProperties, ReactNode } from "react";

import { useStore } from "../state/store.ts";
import { initials as toInitials, rgba, tileBackground } from "../lib/format.ts";

/* ------------------------------------------------------------------ button */

type Tone = "accent" | "ghost" | "pos" | "danger";

export function Button({
  children,
  onClick,
  tone = "accent",
  size,
  disabled,
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: Tone;
  size?: "sm";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const toneClass = tone === "accent" ? "" : ` mr-button--${tone}`;
  const sizeClass = size === "sm" ? " mr-button--sm" : "";
  return (
    <button
      type={type}
      className={`mr-button mr-btn${toneClass}${sizeClass} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- chip */

export function Chip({
  children,
  tone,
  onClick,
  pressed,
  title,
  style,
}: {
  children: ReactNode;
  tone?: "pos" | "warn" | "danger" | "info" | "accent";
  onClick?: () => void;
  pressed?: boolean;
  title?: string;
  style?: CSSProperties;
}) {
  const cls = `mr-chip${tone ? ` mr-chip--${tone}` : ""}${onClick ? " mr-chipbtn" : ""}`;
  if (!onClick) {
    return (
      <span className={cls} title={title} style={style}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      style={style}
    >
      {children}
    </button>
  );
}

/** An amount, a date, a count — anything that must not be re-ordered by bidi. */
export function Mono({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`mr-mono ${className}`.trim()}>{children}</span>;
}

/* ------------------------------------------------------------------- panel */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mr-panel ${className}`.trim()}>
      {title !== undefined && (
        <header className="mr-panel__head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <h2 className="mr-panel__title">{title}</h2>
              {subtitle !== undefined && <p className="mr-panel__sub">{subtitle}</p>}
            </div>
            {actions !== undefined && (
              <div style={{ marginInlineStart: "auto", display: "flex", gap: 7 }}>
                {actions}
              </div>
            )}
          </div>
        </header>
      )}
      <div className="mr-panel__body">{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------- KPI card */

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "pos" | "warn" | "danger";
}) {
  return (
    <div className="mr-kpi">
      <div className="mr-kpi__label">{label}</div>
      <div
        className="mr-kpi__value mr-mono"
        style={tone ? { color: `var(--${tone})` } : undefined}
      >
        {value}
      </div>
      {hint !== undefined && <div className="mr-kpi__hint">{hint}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- avatars */

/**
 * A tinted initials tile. There is no photography anywhere in this app: a
 * person is their initials over their own seed tint, and the same tint follows
 * them everywhere they appear.
 */
export function Avatar({
  name,
  tint,
  ini,
  large,
  title,
}: {
  name: string;
  tint: string;
  ini?: string;
  large?: boolean;
  title?: string;
}) {
  const dark = useStore((s) => s.theme === "dark");
  return (
    <span
      className={`mr-avatar${large ? " mr-avatar--lg" : ""}`}
      style={{ background: tileBackground(tint, dark), color: dark ? "#f4f4f6" : "#191920" }}
      title={title ?? name}
      aria-hidden="true"
    >
      {ini ?? toInitials(name)}
    </span>
  );
}

/**
 * A logo slot — the same gradient treatment at a larger size, with the seed's
 * fictional filename in the corner. `badge` renders in the OPPOSITE corner
 * from that chip so the two can never collide (house layout rule 2).
 */
export function LogoTile({
  tint,
  ini,
  file,
  size = 56,
  badge,
  icon,
}: {
  tint: string;
  ini: string;
  file?: string;
  size?: number;
  badge?: ReactNode;
  icon?: ReactNode;
}) {
  const dark = useStore((s) => s.theme === "dark");
  return (
    <span
      className="mr-tile"
      style={{
        width: size,
        height: size,
        background: tileBackground(tint, dark),
        borderColor: rgba(tint, dark ? 0.3 : 0.18),
      }}
      aria-hidden="true"
    >
      {icon ?? <span className="mr-tile__ini">{ini}</span>}
      {file !== undefined && size >= 48 && <span className="mr-tile__file">{file}</span>}
      {badge !== undefined && <span className="mr-tile__badge">{badge}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ fields */

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="mr-field">
      <span className="mr-label">{label}</span>
      {children}
      {hint !== undefined && (
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-subtle)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/* ------------------------------------------------------------ empty state */

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mr-empty">
      {icon !== undefined && <div className="mr-empty__icon">{icon}</div>}
      <div className="mr-empty__title">{title}</div>
      {body !== undefined && <p className="mr-empty__body">{body}</p>}
      {action !== undefined && <div style={{ marginBlockStart: 14 }}>{action}</div>}
    </div>
  );
}

/** The line that tells a reader what this workspace deliberately is not. */
export function Honest({ children }: { children: ReactNode }) {
  return <p className="mr-honest">{children}</p>;
}

/* --------------------------------------------------------------- segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  full,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  full?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      className={`mr-seg${full ? " mr-seg--full" : ""}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="mr-seg__btn"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
