/**
 * MY SAVED SEARCHES (ledger screen 38): words a person types often, kept with
 * a live count.
 *
 * A search is run as her, table by table (deals, companies, people): what it
 * finds is cut to her rows, and each count is the server's. The value of the
 * deals found is a sum the server works out over those deals. Running a
 * saved search stamps when, by the server's clock.
 *
 * Private: the server answers a person her own searches and nobody else's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { formatters } from "../../lib/format.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { readSearches, runSearch, saveSearch, type Found, type SavedSearch } from "./data.ts";

const KINDS = ["deals", "companies", "people"] as const;
const KIND_ICON: Record<(typeof KINDS)[number], string> = { deals: "columns-3", companies: "building-2", people: "contact" };

export function Searches(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const canSave = session.can("saved_searches", "create");
  const canChange = session.can("saved_searches", "update");
  const [typed, setTyped] = useState("");
  const [asked, setAsked] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAsked(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const { load: found } = useLoad(() => runSearch(session, asked), [session, asked]);
  // What each saved word finds is asked once per look at the page: saving, pinning or removing one search does not run all the others again.
  const counted = useRef(new Map<string, Found>());
  const { load, reload } = useLoad(
    async () => {
      const searches = await readSearches(session);
      const counts = await Promise.all(
        searches.map(async (search) => {
          const kept = counted.current.get(search.query);
          if (kept !== undefined) return kept;
          const found = await runSearch(session, search.query).catch(() => null);
          if (found !== null) counted.current.set(search.query, found);
          return found;
        }),
      );
      return searches.map((search, i) => ({ search, found: counts[i] ?? null }));
    },
    [session],
  );
  const again = useCoalesced(useCallback(() => reload(), [reload]));
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const key = useRef(newClientKey());
  const box = useRef<HTMLInputElement>(null);

  const lineOf = (hits: Found): string => KINDS.map((kind) => t(`searches.n.${kind}` as MessageKey, { count: f.number(hits[kind].count) }, hits[kind].count)).join(" · ");
  const nothing = (hits: Found): boolean => KINDS.every((kind) => hits[kind].count === 0);

  const save = async (): Promise<void> => {
    const query = typed.trim();
    if (query.length < 2) return;
    setBusy("new");
    const saved = await saveSearch(session, query, query, key.current);
    setBusy(null);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    key.current = newClientKey();
    toasts.show(t("searches.saved", { name: query }), "pos");
    again();
  };
  const run = async (search: SavedSearch): Promise<void> => {
    setTyped(search.query);
    box.current?.focus();
    if (!canChange) return;
    // When it was last run is hers to stamp, by the server's clock; the list follows.
    const stamped = await session.update("saved_searches", search.id, { last_run_at: session.now().toISOString() });
    if (stamped.state === "saved") again();
  };
  const pin = async (search: SavedSearch): Promise<void> => {
    setBusy(search.id);
    await toasts.say(session.update("saved_searches", search.id, { pinned: !search.pinned }), () => t(search.pinned ? "views.unpinned" : "views.pinned", { name: search.name }));
    setBusy(null);
    again();
  };
  const remove = async (search: SavedSearch): Promise<void> => {
    setBusy(search.id);
    await toasts.say(session.remove("saved_searches", search.id), () => t("views.removed", { name: search.name }));
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-searches mr-screen" data-screen="searches">
      <div className="crm-screen-head">
        <div>
          <h1>{t("searches.title")}</h1>
          <p className="crm-screen-sub">{t("searches.sub")}</p>
        </div>
        {isBuilt("views") && session.can("saved_views", "read") && (
          <div className="crm-screen-actions">
            <ScreenLink to="views" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
              <Icon name="bookmark" />
              {t("searches.goViews")}
            </ScreenLink>
          </div>
        )}
      </div>

      <section className="crm-search-box mr-card" aria-label={t("searches.query")}>
        <div className="crm-search-line">
          <Icon name="search" size={16} />
          <input ref={box} className="crm-input crm-input-plain mr-fld" type="search" value={typed} maxLength={200} aria-label={t("searches.query")} placeholder={t("searches.query.hint")} onChange={(event) => setTyped(event.target.value)} />
          {canSave && (
            <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="search-save" disabled={typed.trim().length < 2 || busy === "new"} onClick={() => void save()}>
              <Icon name="bookmark" />
              {t("searches.save")}
            </button>
          )}
        </div>
        {typed.trim() !== "" && (
          <div className="crm-search-found" data-testid="search-found" aria-live="polite">
            {typed.trim().length < 2 ? (
              <p className="crm-mk-none">{t("searches.short")}</p>
            ) : found.state !== "ready" || asked !== typed.trim() ? (
              <p className="crm-mk-none">{t("ui.loading")}</p>
            ) : nothing(found.data) ? (
              <p className="crm-mk-none">{t("searches.found.none")}</p>
            ) : (
              <>
                <p className="crm-search-count crm-mono" data-testid="search-count">
                  {lineOf(found.data)}
                  {found.data.value !== null && ` · ${t("searches.value", { amount: f.money(found.data.value) })}`}
                </p>
                <ul className="crm-mk-rows">
                  {KINDS.flatMap((kind) =>
                    found.data[kind].hits.slice(0, 6).map((hit) => (
                      <li key={`${kind}-${hit.id}`} data-kind={kind}>
                        <div className="crm-mk-row">
                          <span className="crm-enq-icon" aria-hidden="true">
                            <Icon name={KIND_ICON[kind]} size={15} />
                          </span>
                          <span className="crm-mk-main">
                            {kind === "deals" && isBuilt("deal") ? (
                              <DealLink id={Number(hit.id)} className="crm-mk-title">
                                {hit.label}
                              </DealLink>
                            ) : (
                              <span className="crm-mk-title">{hit.label}</span>
                            )}
                          </span>
                          <span className="crm-pill" data-tone="plain">
                            {t(`searches.kind.${kind}` as MessageKey)}
                          </span>
                        </div>
                      </li>
                    )),
                  )}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={150} />}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="crm-empty" data-testid="searches-none">
              <span className="crm-empty-icon">
                <Icon name="search" size={21} />
              </span>
              <div className="crm-empty-title">{t("searches.none")}</div>
              <p>{t("searches.none.body")}</p>
            </div>
          ) : (
            <ul className="crm-view-grid">
              {rows.map(({ search, found: hits }) => (
                <li key={search.id} className="crm-view mr-card" data-search={search.id}>
                  <div className="crm-view-top">
                    <div className="crm-view-words">
                      <div className="crm-view-name">{search.name}</div>
                      <div className="crm-view-owner">
                        <span className="crm-pill crm-mono" data-tone="plain">
                          {search.query}
                        </span>
                      </div>
                    </div>
                    {canChange && (
                      <button type="button" className="crm-icon-btn mr-gi" aria-pressed={search.pinned} aria-label={t(search.pinned ? "views.unpin" : "views.pin", { name: search.name })} data-act="pin" disabled={busy === search.id} onClick={() => void pin(search)}>
                        <Icon name={search.pinned ? "pin-off" : "pin"} size={15} />
                      </button>
                    )}
                  </div>
                  {hits !== null && (
                    <div className="crm-view-figures">
                      <div>
                        <div className="crm-view-label" data-testid="search-breakdown">
                          {nothing(hits) ? t("searches.found.none") : lineOf(hits)}
                        </div>
                        {hits.value !== null && (
                          <div className="crm-view-count crm-mono" data-testid="search-value">
                            {f.money(hits.value)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="crm-view-foot">
                    <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="run" aria-label={t("searches.run.aria", { name: search.name })} onClick={() => void run(search)}>
                      {t("searches.run")}
                    </button>
                    {session.can("saved_searches", "delete") && (
                      <button type="button" className="crm-icon-btn mr-gi" aria-label={t("views.remove", { name: search.name })} data-act="remove" disabled={busy === search.id} onClick={() => void remove(search)}>
                        <Icon name="trash-2" size={15} />
                      </button>
                    )}
                  </div>
                  <div className="crm-view-last crm-mono" data-testid="search-last">
                    {search.last_run_at === null ? t("searches.last.never") : t("searches.last", { when: `${f.dayShort(new Date(search.last_run_at))}, ${f.time(new Date(search.last_run_at))}` })}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </div>
  );
}
