/**
 * WHERE THE PERSON IS: the address under the app's base, and how to go
 * somewhere else.
 *
 * Every screen has an address of its own (`…/staff/pipeline`, `…/staff/pipeline/12`),
 * so a reload stays put, a link can be sent to a colleague, and Back goes
 * back. The base is read from where the page really is, because the same
 * bundle is served at the app's own address, at an instance's, and at the root
 * of a mapped domain (`urlSync.ts`, shared with the other apps).
 *
 * This app is never drawn inside the dashboard's frame (`placement: external`),
 * so a move is a real history entry.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { pathUnderBase, surfaceBase } from "../urlSync.ts";
import { ROUTES, type RouteKey } from "./routes.ts";

export interface Nav {
  /** The address under the base, no slashes at either end: `pipeline/12`. */
  path: string;
  /** The full address of a screen, for a link. */
  href: (route: RouteKey, ...rest: (string | number)[]) => string;
  go: (route: RouteKey, ...rest: (string | number)[]) => void;
  /** Go somewhere without leaving the place just left in the history (a redirect to the person's home). */
  replace: (route: RouteKey, ...rest: (string | number)[]) => void;
  base: string;
}

const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (nav === null) throw new Error("useNav is read inside <NavProvider>");
  return nav;
}

const under = (route: RouteKey, rest: (string | number)[]): string => [ROUTES[route].path, ...rest.map((part) => encodeURIComponent(String(part)))].join("/");

export function NavProvider({ children, bakedBase = import.meta.env.BASE_URL }: { children: ReactNode; bakedBase?: string }) {
  const [base] = useState(() => surfaceBase(window.location.pathname, bakedBase));
  const [path, setPath] = useState(() => pathUnderBase(window.location.pathname, base));

  useEffect(() => {
    const onPop = (): void => setPath(pathUnderBase(window.location.pathname, base));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [base]);

  const move = useCallback(
    (next: string, how: "push" | "replace"): void => {
      const url = `${base}${next}`;
      if (how === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
      setPath(next);
      // A new screen starts at its top, as a new page would.
      window.scrollTo(0, 0);
    },
    [base],
  );

  const nav = useMemo<Nav>(
    () => ({
      path,
      base,
      href: (route, ...rest) => `${base}${under(route, rest)}`,
      go: (route, ...rest) => move(under(route, rest), "push"),
      replace: (route, ...rest) => move(under(route, rest), "replace"),
    }),
    [path, base, move],
  );
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

/**
 * A link to a screen: a real address (it opens in a new tab, it can be
 * copied), followed in place on a plain click.
 */
export function ScreenLink({ to, rest = [], className, children, onGo, current, role }: { to: RouteKey; rest?: (string | number)[]; className?: string; children: ReactNode; onGo?: () => void; current?: boolean; role?: "menuitem" }) {
  const nav = useNav();
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    nav.go(to, ...rest);
    onGo?.();
  };
  return (
    <a href={nav.href(to, ...rest)} onClick={follow} className={className} role={role} aria-current={current === true ? "page" : undefined}>
      {children}
    </a>
  );
}
