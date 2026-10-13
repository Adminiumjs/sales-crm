/**
 * THE FRAME every screen sits in: the menu down the side, the bar across the
 * top, and the page.
 *
 * The menu is the person's own (`routes.ts`): their roles' menus as the design
 * draws them, less what is not built, what is in a part that is off, and what
 * they may not read. Below 900 wide it is a drawer opened from the bar.
 *
 * WHICH PAGE AN ADDRESS GETS, in this order:
 *
 *  1. no address            → the person's home; or "nothing is switched on";
 *  2. no such screen        → 404;
 *  3. a part that is off    → refused, naming the part;
 *  4. tables they may not read → refused (for the CRM admin on the private
 *     notes: the sentence that says why even she cannot);
 *  5. otherwise the screen, which answers "no record" itself for a record the
 *     server says is not there.
 *
 * Two refusals are the SERVER's and never reach this file: somebody who may
 * not open the app at all, and an app every part of which is off, are
 * answered by Adminium's own page before the bundle loads.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { appName } from "../i18n/ambient.ts";
import { useT } from "../i18n/index.tsx";
import type { MessageKey } from "../i18n/messages/index.ts";
import { useSession } from "../session/session.tsx";
import { Icon } from "./icons.tsx";
import { ScreenLink, useNav } from "./nav.tsx";
import { NothingOn, NotFound, Rebuilding, Refused, type RefusedWhy, type WayHome } from "./pages.tsx";
import { canOpen, homeFor, menuFor, MENUS, rolesOf, routeForPath, ROUTES, type MenuFacts, type PartId, type RouteKey, type ShownGroup } from "./routes.ts";
import { isBuilt, SCREENS } from "./screens.tsx";
import { PageBoundary } from "../ui/boundary.tsx";
import { LoadFailed } from "../ui/load.tsx";

const NARROW = 900;
/** The design opens every group for a short menu, and only Selling for a long one. */
const LONG_MENU = 16;
const THEME_KEY = "sales-crm-theme";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

/** Light or dark: the person's choice on this browser, else what the device prefers. */
function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() => {
    try {
      const kept = localStorage.getItem(THEME_KEY);
      if (kept === "dark" || kept === "light") return kept === "dark";
    } catch {
      // No storage: the device's preference stands.
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);
  const toggle = useCallback(() => {
    setDark((was) => {
      try {
        localStorage.setItem(THEME_KEY, was ? "light" : "dark");
      } catch {
        // Not remembered, still switched.
      }
      return !was;
    });
  }, []);
  return { dark, toggle };
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");

function Menu({ groups, current, onGo }: { groups: ShownGroup[]; current: RouteKey | null; onGo?: () => void }) {
  const t = useT();
  const count = groups.reduce((n, group) => n + group.items.length, 0);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  return (
    <nav className="crm-menu" aria-label={t("shell.menu")}>
      {groups.map((group) => {
        const active = group.items.some((item) => item.route === current);
        const titled = group.group !== "top";
        const open = !titled || active || (opened[group.group] ?? (group.group === "selling" || count <= LONG_MENU));
        const id = `crm-menu-${group.group}`;
        return (
          <div key={group.group}>
            {titled && (
              <button type="button" className="crm-menu-head mr-row" data-active={active ? "1" : "0"} aria-expanded={open} aria-controls={id} onClick={() => setOpened((was) => ({ ...was, [group.group]: !open }))}>
                <span>{t(`nav.group.${group.group}` as MessageKey)}</span>
                <Icon name={open ? "chevron-down" : "chevron-right"} size={13} className="crm-menu-chev" />
              </button>
            )}
            {open && (
              <div className="crm-menu-items" id={id}>
                {group.items.map((item) => (
                  <ScreenLink key={item.route} to={item.route} className="crm-menu-item mr-nav" current={item.route === current} {...(onGo === undefined ? {} : { onGo })}>
                    <Icon name={ROUTES[item.route].icon} />
                    <span>{t(`nav.item.${item.label}` as MessageKey)}</span>
                  </ScreenLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ small }: { small?: boolean }) {
  const t = useT();
  return (
    <div className={small === true ? "crm-brand crm-brand-small" : "crm-brand"}>
      <span className="crm-brand-mark">
        <Icon name="layers" size={small === true ? 15 : 16} />
      </span>
      <span className="crm-brand-words">
        <span className="crm-brand-name">{appName() ?? "Sales CRM"}</span>
        {small !== true && <span className="crm-brand-sub">{t("shell.workspace")}</span>}
      </span>
    </div>
  );
}

export function Shell() {
  const t = useT();
  const session = useSession();
  const nav = useNav();
  const narrow = useNarrow();
  const theme = useTheme();
  const [drawer, setDrawer] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);

  const config = session.config;
  const facts = useMemo<MenuFacts>(
    () => ({
      roles: (config.access?.roles ?? []).map((role) => role.slug),
      part: (id: PartId) => session.part(id),
      reads: (table) => session.can(table, "read"),
      built: isBuilt,
    }),
    [config, session],
  );
  const groups = useMemo(() => menuFor(facts), [facts]);
  const home = useMemo(() => homeFor(facts), [facts]);
  const here = useMemo(() => routeForPath(nav.path, facts), [nav.path, facts]);
  const appRoles = config.access?.roles ?? [];
  const who = { name: config.user?.name ?? "", role: appRoles.length === 0 ? t("shell.owner") : appRoles.map((role) => role.name).join(" · ") };
  const wayHome: WayHome | null = home === null ? null : { route: home, item: groups.flatMap((group) => group.items).find((item) => item.route === home) ?? null };

  // The bare address is the person's home.
  useEffect(() => {
    if (nav.path === "" && home !== null) nav.replace(home);
  }, [nav, home]);
  // A drawer or a menu left open does not follow the person to the next screen.
  useEffect(() => {
    setDrawer(false);
    setUserMenu(false);
  }, [nav.path]);
  useEffect(() => {
    if (!drawer && !userMenu) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setDrawer(false);
      setUserMenu(false);
      chip.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, userMenu]);

  const signOut = useCallback(async () => {
    try {
      await session.call("POST", "/auth/logout", {});
    } finally {
      // Adminium's sign-in, which brings the next person back here.
      window.location.assign(nav.base);
    }
  }, [session, nav.base]);

  let page;
  if (nav.path === "") {
    // No home: a role none of whose screens is built yet, or none of whose parts is on.
    const anyUnbuilt = rolesOf(facts.roles).some((role) => MENUS[role].some(([, items]) => items.some((item) => !isBuilt(item.route) && canOpen(item.route, { ...facts, built: () => true }))));
    page = home !== null ? null : anyUnbuilt ? <Rebuilding who={who} /> : <NothingOn who={who} />;
  } else if (here === null || !isBuilt(here.route)) {
    page = <NotFound home={wayHome} />;
  } else {
    const def = ROUTES[here.route];
    let why: RefusedWhy | null = null;
    if (def.part !== null && !facts.part(def.part)) why = { kind: "part", part: t(`nav.group.${def.part}` as MessageKey), owner: appRoles.length === 0 };
    else if (!def.reads.every((table) => facts.reads(table))) why = (here.route === "notes" || here.route === "coaching") && appRoles.some((role) => role.slug === "crm-admin") ? { kind: "private" } : { kind: "role" };
    const Screen = SCREENS[here.route]!;
    page = why !== null ? <Refused why={why} who={who} home={wayHome} /> : <Screen rest={here.rest} />;
  }

  const current = here?.route ?? null;
  return (
    <div className="crm-shell">
      <a className="crm-skip" href="#crm-page">
        {t("shell.skip")}
      </a>
      {!narrow && (
        <aside className="crm-side">
          <Brand />
          <div className="crm-side-scroll mr-scroll">
            <Menu groups={groups} current={current} />
          </div>
        </aside>
      )}
      <div className="crm-main">
        <header className="crm-top">
          {narrow && (
            <button type="button" className="crm-icon-btn mr-gi" aria-label={t("shell.menu.open")} aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <Icon name="menu" size={17} />
            </button>
          )}
          <div className="crm-top-end">
            <button type="button" className="crm-icon-btn mr-gi" aria-label={t(theme.dark ? "shell.theme.light" : "shell.theme.dark")} onClick={theme.toggle}>
              <Icon name={theme.dark ? "sun" : "moon"} />
            </button>
            <div className="crm-user">
              <button type="button" ref={chip} className="crm-user-chip mr-gi" data-open={userMenu ? "1" : "0"} aria-haspopup="menu" aria-expanded={userMenu} aria-label={t("shell.you")} onClick={() => setUserMenu((was) => !was)}>
                <span className="crm-avatar" aria-hidden="true">
                  {initials(who.name)}
                </span>
                {!narrow && (
                  <span className="crm-user-words">
                    <span className="crm-user-name">{who.name}</span>
                    <span className="crm-user-role">{who.role}</span>
                  </span>
                )}
                <Icon name="chevron-down" size={14} className="crm-user-chev" />
              </button>
              {userMenu && (
                <>
                  <div className="crm-scrim-clear" onClick={() => setUserMenu(false)} />
                  <div className="crm-user-panel" role="menu">
                    <div className="crm-user-card">
                      <span className="crm-avatar crm-avatar-lg" aria-hidden="true">
                        {initials(who.name)}
                      </span>
                      <span className="crm-user-words">
                        <span className="crm-user-name">{who.name}</span>
                        <span className="crm-user-mail">{config.user?.email ?? ""}</span>
                      </span>
                    </div>
                    <div className="crm-user-items">
                      <button type="button" role="menuitem" className="crm-user-item crm-user-out mr-row" onClick={() => void signOut()}>
                        <Icon name="log-out" size={15} />
                        <span>{t("shell.signOut")}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main id="crm-page" className="crm-page" tabIndex={-1}>
          <PageBoundary at={nav.path} fallback={(again) => <LoadFailed reload={again} />}>
            {page}
          </PageBoundary>
        </main>
      </div>
      {narrow && drawer && (
        <div className="crm-drawer-scrim" onClick={() => setDrawer(false)}>
          <div className="crm-drawer" role="dialog" aria-modal="true" aria-label={t("shell.menu")} onClick={(event) => event.stopPropagation()}>
            <div className="crm-drawer-head">
              <Brand small />
              <button type="button" className="crm-icon-btn mr-gi" aria-label={t("shell.menu.close")} onClick={() => setDrawer(false)} autoFocus>
                <Icon name="x" />
              </button>
            </div>
            <div className="crm-drawer-scroll mr-scroll">
              <Menu groups={groups} current={current} onGo={() => setDrawer(false)} />
            </div>
            <div className="crm-drawer-foot">
              <div className="crm-drawer-who">
                <span className="crm-avatar" aria-hidden="true">
                  {initials(who.name)}
                </span>
                <span className="crm-user-words">
                  <span className="crm-user-name">{who.name}</span>
                  <span className="crm-user-role">{who.role}</span>
                </span>
              </div>
              <button type="button" className="crm-user-item crm-user-out mr-row" onClick={() => void signOut()}>
                <Icon name="log-out" />
                <span>{t("shell.signOut")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
