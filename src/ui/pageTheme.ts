/**
 * LIGHT OR DARK, as the page is now: the shell writes the person's choice on
 * `<html data-theme>` (the top bar's button, `D`, or the device's own).
 *
 * A kit part that draws pictures from elsewhere needs telling: the map asks
 * its server for a dark or a light style, and left to itself it looks again
 * only when the app hands it new props or the DEVICE changes its mind, not
 * when the person presses the button. So a screen with a map (or a board,
 * which takes the app's word too) hands it this, read again on every change.
 */
import { useEffect, useState } from "react";

export type PageTheme = "light" | "dark";

/** What `data-theme` says, as a theme: anything but "dark" is light. */
export const themeOf = (attribute: string | null | undefined): PageTheme => (attribute === "dark" ? "dark" : "light");

interface Watchable {
  getAttribute(name: string): string | null;
}
type Observe = (root: Watchable, changed: () => void) => () => void;

/** Calls `changed` with the theme each time `data-theme` changes on `root`; returns the way to stop. */
export function watchTheme(root: Watchable, changed: (theme: PageTheme) => void, observe: Observe = observeAttribute): () => void {
  let last = themeOf(root.getAttribute("data-theme"));
  return observe(root, () => {
    const now = themeOf(root.getAttribute("data-theme"));
    if (now === last) return;
    last = now;
    changed(now);
  });
}

function observeAttribute(root: Watchable, changed: () => void): () => void {
  const watch = new MutationObserver(changed);
  watch.observe(root as unknown as Node, { attributes: true, attributeFilter: ["data-theme"] });
  return () => watch.disconnect();
}

/** The page's theme now, and again whenever the person switches it. */
export function usePageTheme(): PageTheme {
  const [theme, setTheme] = useState<PageTheme>(() => themeOf(document.documentElement.getAttribute("data-theme")));
  useEffect(() => {
    // The theme may have changed between the first draw and this effect.
    setTheme(themeOf(document.documentElement.getAttribute("data-theme")));
    return watchTheme(document.documentElement, setTheme);
  }, []);
  return theme;
}
