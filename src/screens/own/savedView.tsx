/**
 * A SAVED VIEW ON THE SCREEN IT WAS SAVED FROM.
 *
 * A screen that can be narrowed (the board, Closed, Quotes, Site visits, the
 * Team view) takes a view by its address, `<screen>/view/<id>`: `useSavedView`
 * reads the view, and the screen sets its own filters from it. `ViewBar`
 * says which view is showing, clears it, and saves what the screen is
 * narrowed to now as a new view.
 *
 * Whose views a person may open is the server's: her own (the table is
 * private, plan 68 D9). A view that is not hers reads as not there.
 */
import { useMemo, useRef, useState } from "react";

import { useI18n, useT, type TFunction } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { formatters, type Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { readView, saveView, screenOf, stageOf, type SavedView, type Stage, type ViewFilters, type ViewScreen } from "./data.ts";

export type ViewState =
  /** No view was asked for. */
  | { state: "none" }
  | { state: "loading" }
  | { state: "ready"; view: SavedView; stages: Stage[] }
  /** Not there, not hers, or saved from another screen. */
  | { state: "missing"; other: ViewScreen | null };

const NO_VIEW: ViewState = { state: "none" };
const LOADING_VIEW: ViewState = { state: "loading" };

/** The id a screen's address names: `["view", "3"]` is 3. */
export const viewIdOf = (rest: readonly string[]): number | null => (rest[0] === "view" && rest[1] !== undefined && /^\d+$/.test(rest[1]) ? Number(rest[1]) : null);

/** The view an address names, for the screen it belongs to. The stages are read with it: a board view may name one. */
export function useSavedView(screen: ViewScreen, rest: readonly string[]): ViewState {
  const session = useSession();
  const id = viewIdOf(rest);
  const { load } = useLoad(
    async () => {
      if (id === null || !session.can("saved_views", "read")) return null;
      const [view, stages] = await Promise.all([readView(session, id), session.can("stages", "read") ? session.list<Stage>("stages", { select: ["id", "label"], order: ["position"], limit: 50 }).then((page) => page.rows) : Promise.resolve([] as Stage[])]);
      return { view, stages };
    },
    [session, id],
  );
  return useMemo<ViewState>(() => {
    // The same answer every time for a screen opened plainly: a screen that reads again when its view changes must not read twice at the start.
    if (id === null) return NO_VIEW;
    if (load.state === "loading") return LOADING_VIEW;
    if (load.state !== "ready" || load.data === null || load.data.view === null) return { state: "missing", other: null };
    const from = screenOf(load.data.view.filters);
    return from === screen ? { state: "ready", view: load.data.view, stages: load.data.stages } : { state: "missing", other: from };
  }, [id, load, screen]);
}

/** A view's rules in words: one chip each. */
export function rulesOf(filters: ViewFilters, facts: { names: Record<string, string>; stages: readonly Stage[] }, t: TFunction, f: Formatters): string[] {
  const out: string[] = [];
  if (filters.rep !== undefined) out.push(facts.names[filters.rep] === undefined ? t("views.rule.repGone") : t("views.rule.rep", { name: firstName(facts.names[filters.rep]!) }));
  if (filters.stage !== undefined) {
    const stage = stageOf(filters, facts.stages);
    out.push(stage === null ? t("views.rule.stageGone") : t("views.rule.stage", { stage: stage.label }));
  }
  if (typeof filters.over === "number") out.push(t("views.rule.over", { amount: f.money(filters.over) }));
  if (typeof filters.sitting === "number") out.push(t("views.rule.sitting", { count: f.number(filters.sitting) }, filters.sitting));
  if (filters.closing === "this month") out.push(t("views.rule.closing"));
  if (filters.only !== undefined) out.push(t(`views.rule.only.${filters.only}` as MessageKey));
  if (filters.show !== undefined) out.push(t(`views.rule.show.${filters.show}` as MessageKey));
  if (typeof filters.type === "string" && filters.type !== "all") out.push(t(`feed.kind.${filters.type}` as MessageKey));
  if (typeof filters.months === "number") out.push(t("lost.window.months", { count: f.number(filters.months) }, filters.months));
  return out.length === 0 ? [t("views.rule.all")] : out;
}

/**
 * The line a screen draws under its heading: the view that is showing (with
 * "Clear it"), and "Save this view" for what the screen is narrowed to now.
 * `current` is that narrowing; `names` are the people a rule may name.
 */
export function ViewBar({ screen, view, current, names }: { screen: ViewScreen; view: ViewState; current: ViewFilters; names: Record<string, string> }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const nav = useNav();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [saving, setSaving] = useState(false);
  const canSave = session.part("selling") && session.can("saved_views", "create");
  const stages = view.state === "ready" ? view.stages : [];
  if (view.state === "none" && !canSave) return null;
  return (
    <div className="crm-viewbar" data-testid="viewbar">
      {view.state === "ready" && (
        <span className="crm-viewbar-showing" data-testid="viewbar-showing">
          <Icon name="bookmark" size={14} />
          {t("views.bar.showing", { name: view.view.name, rules: rulesOf(view.view.filters, { names, stages }, t, f).join(" · ") })}
        </span>
      )}
      {view.state === "missing" && (
        <span className="crm-viewbar-showing" data-tone="warn" data-testid="viewbar-missing" role="status">
          <Icon name="triangle-alert" size={14} />
          {view.other === null ? t("views.bar.missing") : t("views.bar.other", { screen: t(`views.screen.${view.other}` as MessageKey) })}
        </span>
      )}
      {(view.state === "ready" || view.state === "missing") && (
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="viewbar-clear" onClick={() => nav.go(screen)}>
          {t("views.bar.clear")}
        </button>
      )}
      {canSave && (
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 crm-viewbar-save mr-gi" data-testid="viewbar-save" onClick={() => setSaving(true)}>
          <Icon name="bookmark" size={14} />
          {t("views.save")}
        </button>
      )}
      {saving && <SaveView filters={{ ...current, screen }} rules={rulesOf(current, { names, stages }, t, f)} onClose={() => setSaving(false)} />}
    </div>
  );
}

function SaveView({ filters, rules, onClose }: { filters: ViewFilters; rules: string[]; onClose: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newClientKey());
  const save = async (): Promise<void> => {
    if (name.trim() === "") return setError(t("views.save.error"));
    setError(null);
    setBusy(true);
    const saved = await saveView(session, name, filters, key.current);
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t("views.save.toast", { name: name.trim() }), "pos");
    onClose();
  };
  return (
    <Dialog
      shape="box"
      name="save-view"
      icon="bookmark"
      tone="accent"
      title={t("views.save")}
      subtitle={t("views.save.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" disabled={busy} onClick={() => void save()}>
            <Icon name="check" />
            {busy ? t("ui.saving") : t("views.save.go")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        <label className="crm-label" htmlFor="crm-view-name">
          {t("views.save.name")}
        </label>
        <input
          id="crm-view-name"
          data-autofocus
          className="crm-input mr-fld"
          value={name}
          maxLength={80}
          onChange={(event) => (setName(event.target.value), setError(null))}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
        <p className="crm-field-note" data-testid="view-holds">
          {t("views.save.holds", { rules: rules.join(" · ") })}
        </p>
      </fieldset>
      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
