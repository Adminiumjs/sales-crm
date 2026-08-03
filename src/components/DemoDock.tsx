/**
 * The demo dock.
 *
 * A fixed panel holding everything that makes this a demo rather than a
 * product: the persona segment, the theme toggle, the locale picker and a
 * reset. It is deliberately labelled "Demo controls" so nobody mistakes it for
 * a feature of the workspace.
 *
 * House layout rule 1 is enforced here: whenever an overlay owns the screen —
 * the mobile nav sheet, the close dialog — the dock moves to the opposite
 * inline corner rather than sitting on top of a primary action. `--shifted`
 * swaps `inset-inline-end` for `inset-inline-start`, which mirrors correctly
 * in RTL without a second rule.
 */

import { ChevronDown, Moon, Settings2, Sun, RotateCcw } from "lucide-react";

import { LOCALES, LOCALE_TAGS, useI18n, type LocaleTag } from "../i18n/index.tsx";
import { useStore } from "../state/store.ts";
import type { Persona } from "../data/types.ts";
import { Segmented } from "./Primitives.tsx";

export default function DemoDock() {
  const { t, locale, setLocale } = useI18n();
  const persona = useStore((s) => s.persona);
  const setPersona = useStore((s) => s.setPersona);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const open = useStore((s) => s.dockOpen);
  const setOpen = useStore((s) => s.setDockOpen);
  const reset = useStore((s) => s.reset);
  const shifted = useStore((s) => s.overlayOpen);

  if (!open) {
    return (
      <button
        type="button"
        className={`mr-dock__mini mr-btn${shifted ? " mr-dock--shifted" : ""}`}
        onClick={() => setOpen(true)}
        aria-label={t("chrome.dock.expand")}
      >
        <Settings2 size={15} aria-hidden="true" />
        {t("chrome.dock.title")}
      </button>
    );
  }

  return (
    <aside
      className={`mr-dock${shifted ? " mr-dock--shifted" : ""}`}
      aria-label={t("chrome.dock.title")}
    >
      <div className="mr-dock__head">
        <Settings2 size={13} aria-hidden="true" />
        {t("chrome.dock.title")}
        <button
          type="button"
          className="mr-dock__collapse"
          onClick={() => setOpen(false)}
          aria-label={t("chrome.dock.collapse")}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>

      <Segmented<Persona>
        full
        ariaLabel={t("chrome.dock.persona")}
        value={persona}
        onChange={setPersona}
        options={[
          { value: "rep", label: t("chrome.dock.rep") },
          { value: "manager", label: t("chrome.dock.manager") },
        ]}
      />

      <div className="mr-dock__row">
        <span className="mr-dock__label">{t("chrome.dock.language")}</span>
        <select
          className="mr-select"
          value={locale}
          onChange={(e) => setLocale(e.target.value as LocaleTag)}
          aria-label={t("chrome.dock.language")}
        >
          {LOCALE_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {LOCALES[tag].native}
            </option>
          ))}
        </select>
      </div>

      <div className="mr-dock__row">
        <span className="mr-dock__label">{t("chrome.dock.theme")}</span>
        <button
          type="button"
          className="mr-iconbtn mr-btn"
          onClick={toggleTheme}
          aria-label={t(theme === "dark" ? "chrome.dock.theme.light" : "chrome.dock.theme.dark")}
          title={t(theme === "dark" ? "chrome.dock.theme.light" : "chrome.dock.theme.dark")}
        >
          {theme === "dark" ? (
            <Sun size={16} aria-hidden="true" />
          ) : (
            <Moon size={16} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="mr-iconbtn mr-btn"
          onClick={reset}
          aria-label={t("chrome.dock.reset")}
          title={t("chrome.dock.reset")}
          style={{ marginInlineStart: "auto" }}
        >
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
