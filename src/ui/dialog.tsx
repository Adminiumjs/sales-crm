/**
 * A dialog over the page: a box in the middle, or a sheet at the far side.
 *
 * While it is open the keyboard stays inside it (Tab goes round), Escape and
 * a press outside close it, and closing gives the focus back to whatever
 * opened it. A dialog that is saving does not close: the person is told how
 * the save ended first.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

import { useT } from "../i18n/index.tsx";
import { Icon } from "../shell/icons.tsx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  /** `sheet` slides in at the far side, full height; `box` sits in the middle. */
  shape: "box" | "sheet";
  icon: string;
  tone?: "accent" | "plain";
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** A save is on its way: nothing closes the dialog until it has ended. */
  busy?: boolean;
  children: ReactNode;
  /** The buttons at the foot. */
  foot: ReactNode;
  name?: string;
}

export function Dialog({ shape, icon, tone = "plain", title, subtitle, onClose, busy = false, children, foot, name }: DialogProps) {
  const t = useT();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const held = useRef(busy);
  held.current = busy;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The first field, not the close button: the person came to fill something in.
    const first = box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>(".crm-dialog-body " + FOCUSABLE.split(", ").join(", .crm-dialog-body "));
    (first ?? box.current)?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!held.current) close.current();
        return;
      }
      if (event.key !== "Tab" || box.current === null) return;
      const stops = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (stops.length === 0) return;
      const firstStop = stops[0]!;
      const lastStop = stops[stops.length - 1]!;
      if (event.shiftKey && (document.activeElement === firstStop || !box.current.contains(document.activeElement))) {
        event.preventDefault();
        lastStop.focus();
      } else if (!event.shiftKey && (document.activeElement === lastStop || !box.current.contains(document.activeElement))) {
        event.preventDefault();
        firstStop.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const scroll = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.documentElement.style.overflow = scroll;
      opener?.focus();
    };
  }, []);

  return (
    <div className="crm-scrim" data-shape={shape} onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div ref={box} className={shape === "sheet" ? "crm-dialog crm-sheet" : "crm-dialog crm-dialog-box"} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={busy} tabIndex={-1} data-dialog={name}>
        <div className="crm-dialog-head">
          <span className="crm-dialog-icon" data-tone={tone}>
            <Icon name={icon} size={19} />
          </span>
          <div className="crm-dialog-words">
            <h2 id={`${id}-title`}>{title}</h2>
            {subtitle !== undefined && <p>{subtitle}</p>}
          </div>
          <button type="button" className="crm-icon-btn crm-dialog-x mr-gi" aria-label={t("ui.close")} disabled={busy} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="crm-dialog-body mr-scroll">{children}</div>
        <div className="crm-dialog-foot">{foot}</div>
      </div>
    </div>
  );
}
