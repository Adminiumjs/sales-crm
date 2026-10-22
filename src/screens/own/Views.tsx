/**
 * SAVED VIEWS (ledger screen 19): a cut of a screen a person keeps coming
 * back to, with a live count.
 *
 * The list is what the server answers her: her own views, and nobody else's
 * (the table is private, plan 68 D9: not even the install's owner reads
 * them). A view's count, and for a cut of the board its weighted value, are
 * the server's FOR HER. "Open it" goes to the screen the view was saved
 * from, narrowed. She pins and removes her own.
 */
import { useCallback, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { isBuilt, type ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { readNames } from "../visits/data.ts";
import { mayChangeView, readViews, screenOf, viewFigure, type SavedView, type Stage, type ViewFigure, type ViewScreen } from "./data.ts";
import { rulesOf } from "./savedView.tsx";

const SCREEN_ICON: Record<ViewScreen, string> = { pipeline: "columns-3", archive: "folder-clock", quotes: "file-text", visits: "map-pin", team: "users", week: "calendar-range", health: "activity", feed: "history", lost: "circle-slash" };

export function Views(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const me = config.user?.id ?? "";
  const [now, setNow] = useState(() => session.now());
  // Who and which stage a rule names: read once per page.
  const { load: fixed } = useLoad(() => Promise.all([readNames(session), session.can("stages", "read") ? session.list<Stage>("stages", { select: ["id", "label"], order: ["position"], limit: 50 }).then((page) => page.rows) : Promise.resolve([] as Stage[])]), [session]);
  const names = fixed.state === "ready" ? fixed.data[0] : {};
  const stages = useMemo(() => (fixed.state === "ready" ? fixed.data[1] : []), [fixed]);
  const { load, reload } = useLoad(
    async () => {
      // Not before the stages are known: a view may name one, and its figure would be asked twice.
      if (fixed.state !== "ready") return new Promise<never>(() => undefined);
      const views = await readViews(session);
      // Every view's figure leaves in the same moment: one request for the lot.
      const figures = await Promise.all(views.map((view) => viewFigure(session, view, stages, now, f).catch(() => null)));
      return views.map((view, i) => ({ view, figure: figures[i] ?? null }));
    },
    [session, stages, now, f, fixed.state],
  );
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["saved_views"], again);
  const [busy, setBusy] = useState<number | null>(null);

  const pin = async (view: SavedView): Promise<void> => {
    setBusy(view.id);
    await toasts.say(session.update("saved_views", view.id, { pinned: !view.pinned }), () => t(view.pinned ? "views.unpinned" : "views.pinned", { name: view.name }));
    setBusy(null);
    again();
  };
  const remove = async (view: SavedView): Promise<void> => {
    setBusy(view.id);
    await toasts.say(session.remove("saved_views", view.id), () => t("views.removed", { name: view.name }));
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-views mr-screen" data-screen="views">
      <div className="crm-screen-head">
        <div>
          <h1>{t("views.title")}</h1>
          <p className="crm-screen-sub">{t("views.sub")}</p>
        </div>
        {isBuilt("searches") && session.can("saved_searches", "read") && (
          <div className="crm-screen-actions">
            <ScreenLink to="searches" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
              <Icon name="search" />
              {t("nav.item.searches")}
            </ScreenLink>
          </div>
        )}
      </div>
      <Loaded load={fixed.state === "ready" ? load : fixed.state === "loading" ? { state: "loading" } : { state: "failed" }} reload={reload} skeleton={<Skeleton rows={3} height={150} />}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="crm-empty" data-testid="views-none">
              <span className="crm-empty-icon">
                <Icon name="bookmark" size={21} />
              </span>
              <div className="crm-empty-title">{t("views.none")}</div>
              <p>{t("views.none.body")}</p>
            </div>
          ) : (
            <ul className="crm-view-grid">
              {rows.map(({ view, figure }) => {
                const screen = screenOf(view.filters);
                const mine = view.owner_id === me;
                const change = mayChangeView(session, view);
                const maker = names[view.made_by_id];
                return (
                  <li key={view.id} className="crm-view mr-card" data-view={view.id} data-shared={view.owner_id === null ? "1" : "0"}>
                    <div className="crm-view-top">
                      <span className="crm-enq-icon" aria-hidden="true">
                        <Icon name={SCREEN_ICON[screen]} size={15} />
                      </span>
                      <div className="crm-view-words">
                        <div className="crm-view-name">{view.name}</div>
                        <div className="crm-view-owner">
                          {t(`views.screen.${screen}` as MessageKey)} · {mine ? t("views.owner.mine") : maker === undefined ? t("views.owner.sharedPlain") : t("views.owner.shared", { name: firstName(maker) })}
                        </div>
                      </div>
                      {change && (
                        <button type="button" className="crm-icon-btn mr-gi" aria-pressed={view.pinned} aria-label={t(view.pinned ? "views.unpin" : "views.pin", { name: view.name })} data-act="pin" disabled={busy === view.id} onClick={() => void pin(view)}>
                          <Icon name={view.pinned ? "pin-off" : "pin"} size={15} />
                        </button>
                      )}
                    </div>
                    <div className="crm-view-rules">
                      {rulesOf(view.filters, { names, stages }, t, f).map((rule) => (
                        <span key={rule} className="crm-pill" data-tone="plain">
                          {rule}
                        </span>
                      ))}
                    </div>
                    <Figure figure={figure} screen={screen} f={f} />
                    <div className="crm-view-foot">
                      {isBuilt(screen) ? (
                        <ScreenLink to={screen} rest={["view", view.id]} className="crm-btn crm-btn-primary crm-btn-32 mr-btn">
                          <span aria-hidden="true">{t("views.open")}</span>
                          <span className="crm-sr">{t("views.open.aria", { name: view.name })}</span>
                        </ScreenLink>
                      ) : (
                        <span />
                      )}
                      {change && session.can("saved_views", "delete") && (
                        <button type="button" className="crm-icon-btn mr-gi" aria-label={t("views.remove", { name: view.name })} data-act="remove" disabled={busy === view.id} onClick={() => void remove(view)}>
                          <Icon name="trash-2" size={15} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Loaded>
    </div>
  );
}

function Figure({ figure, screen, f }: { figure: ViewFigure | null; screen: ViewScreen; f: ReturnType<typeof formatters> }) {
  const t = useT();
  if (figure === null) return <p className="crm-view-nofigure">{t("views.count.none")}</p>;
  return (
    <div className="crm-view-figures">
      <div>
        <div className="crm-view-count crm-mono" data-testid="view-count">
          {f.number(figure.count)}
        </div>
        <div className="crm-view-label">{t(`views.count.${screen}` as MessageKey, undefined, figure.count)}</div>
      </div>
      {figure.weighted !== null && (
        <div className="crm-view-weighted">
          <div className="crm-view-count crm-mono" data-testid="view-weighted">
            {f.money(figure.weighted)}
          </div>
          <div className="crm-view-label">{t("views.weighted")}</div>
        </div>
      )}
    </div>
  );
}
