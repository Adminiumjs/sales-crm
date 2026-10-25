import { describe, expect, it } from "vitest";

import { themeOf, watchTheme } from "./pageTheme.ts";

/** A root whose `data-theme` the test sets, and an observer the test fires, as the shell's button and the browser would. */
function fakeRoot(start: string | null) {
  let value = start;
  let fire: (() => void) | null = null;
  let stopped = false;
  const root = { getAttribute: (name: string) => (name === "data-theme" ? value : null) };
  const observe = (_root: unknown, changed: () => void) => {
    fire = changed;
    return () => {
      stopped = true;
    };
  };
  return {
    root,
    observe,
    set(next: string | null) {
      value = next;
      fire?.();
    },
    stopped: () => stopped,
  };
}

describe("the page's theme, for a kit part that must be told", () => {
  it("reads data-theme: dark is dark, anything else light", () => {
    expect(themeOf("dark")).toBe("dark");
    expect(themeOf("light")).toBe("light");
    expect(themeOf(null)).toBe("light");
    expect(themeOf("sepia")).toBe("light");
  });

  it("says each switch once, with the theme it switched to, and stops when asked", () => {
    const page = fakeRoot("light");
    const said: string[] = [];
    const stop = watchTheme(page.root, (theme) => said.push(theme), page.observe);
    page.set("dark");
    // Another attribute change that leaves the theme as it is says nothing.
    page.set("dark");
    page.set("light");
    expect(said).toEqual(["dark", "light"]);
    stop();
    expect(page.stopped()).toBe(true);
  });
});
