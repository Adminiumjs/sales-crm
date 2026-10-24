/** The pieces every tab of Settings is made of: a card, a number that saves when it is left, a row of choices. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import type { Saved, StaffSession } from "../../staffSession.ts";
import { useToasts } from "../../ui/toast.tsx";
import { BOUNDS, MANAGER_WRITES, num, readNumber, type SettingsRow } from "./data.ts";
import { withPairWords } from "./pairs.ts";

export function Card({ title, sub, aside, children, flush = false, name }: { title: string; sub?: string; aside?: ReactNode; children: ReactNode; flush?: boolean; name: string }) {
  const id = useId();
  return (
    <section className="crm-ast-card" aria-labelledby={id} data-card={name} data-flush={flush ? "1" : undefined}>
      <div className="crm-ast-card-head">
        <div className="crm-ast-card-words">
          <h2 id={id}>{title}</h2>
          {sub !== undefined && <p>{sub}</p>}
        </div>
        {aside !== undefined && <div className="crm-ast-card-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Who writes what on the one settings row, as the page was told when it opened. The server decides each save. */
export interface Rights {
  /** The CRM admin, or the install's owner: every tab, every column. */
  all: boolean;
  /** Reads every tab and presses nothing. */
  readsAll: boolean;
  column: (column: string) => boolean;
}

export function rightsOf(session: StaffSession): Rights {
  const slugs = (session.config.access?.roles ?? []).map((role) => role.slug).filter((slug) => slug.startsWith("crm-"));
  const all = slugs.length === 0 || slugs.includes("crm-admin");
  const writes = session.can("settings", "update");
  return { all: all && writes, readsAll: all || slugs.includes("crm-read-only"), column: (column) => writes && (all || MANAGER_WRITES.includes(column)) };
}

/** Save one or more columns of the settings row, naming what the screen saw, and say how it ended. */
export function useSaveSettings(session: StaffSession, row: SettingsRow | null, after: () => void): { save: (values: Record<string, unknown>, done: string, seen?: boolean) => Promise<boolean>; busy: boolean } {
  const t = useT();
  const toasts = useToasts();
  const [busy, setBusy] = useState(false);
  /**
   * `seen`: the save names what the screen saw, and the server refuses it if
   * somebody else changed the column meanwhile. Left off only for a column
   * this same screen saved a moment ago whose read has not come back: what it
   * saw then is no longer what the server holds, and the change is its own.
   */
  const save = async (values: Record<string, unknown>, done: string, seen = true): Promise<boolean> => {
    if (row === null) return false;
    setBusy(true);
    const saw = Object.fromEntries(Object.keys(values).map((column) => [column, row[column]]));
    // A pair the server keeps apart (warm below stale, the day's start before its end: plan 68 X4) is refused naming both.
    const saved = await toasts.say(withPairWords(session.update("settings", row.id, values, seen ? { seen: saw } : {}) as Promise<Saved<SettingsRow>>, t), () => done);
    setBusy(false);
    after();
    return saved !== null;
  };
  return { save, busy };
}

/**
 * A number of the settings row. It is saved when the field is left or Enter
 * is pressed, never on each key; a value outside its bounds is not sent, and
 * the field says what it takes.
 */
export function NumField({ column, label, hint, unit, value, canWrite, f, onSave, max, min, whole = true }: { column: string; label: string; hint?: ReactNode; unit: string; value: unknown; canWrite: boolean; f: Formatters; onSave: (value: number, fresh: boolean) => Promise<boolean>; min?: number; max?: number; whole?: boolean }) {
  const t = useT();
  const id = useId();
  const held = String(num(value));
  const [text, setText] = useState(held);
  const [bad, setBad] = useState(false);
  /**
   * The value last sent and not yet read back. Until the row is read again it
   * stands for what the server holds: Enter saves, and leaving the field (or
   * typing the next number) before the read arrives must neither send it twice
   * nor be compared with the old value.
   */
  const sent = useRef<number | null>(null);
  useEffect(() => {
    // A read from before the save is not allowed to put the old number back while the save is out.
    if (sent.current !== null && num(held) !== sent.current) return;
    sent.current = null;
    setText(held);
    setBad(false);
  }, [held]);
  const bounds: readonly [number, number] = [Math.max(BOUNDS[column]?.[0] ?? 0, min ?? -Infinity), Math.min(BOUNDS[column]?.[1] ?? 9999, max ?? Infinity)];
  const commit = async (): Promise<void> => {
    const base = sent.current ?? num(held);
    if (text.trim() === String(base)) return setBad(false);
    const next = readNumber(text, bounds, whole);
    if (next === null) return setBad(true);
    setBad(false);
    if (next === base) return;
    // The screen's own last save is still on its way back: the row it holds is older than the server's.
    const fresh = sent.current === null;
    sent.current = next;
    if (!(await onSave(next, fresh))) {
      sent.current = null;
      setText(held);
    }
  };
  return (
    <div className="crm-ast-num" data-setting={column}>
      <label htmlFor={id}>
        {label}
        {hint !== undefined && <span className="crm-ast-hint crm-mono">{hint}</span>}
      </label>
      <span className="crm-ast-num-box">
        {canWrite ? (
          <input
            id={id}
            className="crm-ast-input crm-ast-input-num crm-mono mr-fld"
            inputMode="decimal"
            value={text}
            aria-invalid={bad}
            aria-describedby={bad ? `${id}-range` : undefined}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commit();
              if (event.key === "Escape") {
                setText(held);
                setBad(false);
              }
            }}
          />
        ) : (
          <output id={id} className="crm-ast-read crm-mono">
            {f.number(num(value))}
          </output>
        )}
        <span className="crm-ast-unit">{unit}</span>
      </span>
      {bad && (
        <span id={`${id}-range`} role="alert" className="crm-ast-range">
          {t("aset.range", { min: f.number(bounds[0]), max: f.number(bounds[1]) })}
        </span>
      )}
    </div>
  );
}

/** A row of choices of which one, or several, are pressed. */
export function Chips<K extends string>({ label, options, pressed, onPress, disabled = false }: { label: string; options: readonly { key: K; label: string; title?: string; locked?: boolean }[]; pressed: (key: K) => boolean; onPress: ((key: K) => void) | null; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="crm-ast-chips">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className="crm-ast-chip mr-chip mr-gi"
          aria-pressed={pressed(option.key)}
          aria-label={option.title}
          data-key={option.key}
          disabled={onPress === null || disabled}
          aria-disabled={option.locked === true ? true : undefined}
          onClick={() => {
            if (option.locked !== true) onPress?.(option.key);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** "Ask the person who runs this install", in a quiet box. */
export function AskLine({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <p className="crm-ast-ask" role="note">
      {icon}
      <span>{children}</span>
    </p>
  );
}
