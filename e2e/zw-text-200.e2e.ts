/**
 * The browser's text size at 200 %, on Today, the board and Settings: nothing cut off, nothing over another.
 *
 * The browser's own setting, not page zoom: Chrome's "Font size" is the default size a page's text starts from, and the
 * spec sets it the way that setting does (the DevTools protocol's `Page.setFontSizes`, standard 32 px instead of 16), so
 * the page's root font size is 32 px and whatever is sized from it grows. Then every visible text box on the screen is
 * measured: none may run outside an ancestor that clips it (cut off), none may cross another (over another), and the
 * page may not scroll sideways. A picture of each screen is kept for the record (`CRM_PROOF_OUT`).
 *
 * How much of the screen's text follows the setting is measured too and written on the test as a note: the CRM sizes
 * its type in pixels, so today the setting reaches the root and almost nothing else (see the report).
 *
 * It reads and changes nothing.
 */
import type { BrowserContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { STAFF } from "./helpers.ts";

interface Measured {
  /** Text boxes measured. */
  count: number;
  /** "clipping box ⟵ text" for a text box outside a box that hides what overflows it. */
  cut: string[];
  /** "box "text" × box "text"" for two text boxes crossing. */
  over: string[];
  sideways: number;
  root: string;
  /** Each text box's font size, in order, to compare with the same screen at 16 px. */
  sizes: number[];
}

/** Every visible text box of the page, measured in the page. */
function measure(): Measured {
  const shown = (el: Element): boolean => {
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
  };
  const named = (el: Element): string => {
    const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter((one) => one !== "").slice(0, 2);
    return `${el.tagName.toLowerCase()}${classes.length > 0 ? `.${classes.join(".")}` : ""}`;
  };
  const texts: { el: Element; rects: DOMRect[]; text: string }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => ((node.textContent ?? "").trim() === "" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const el = node.parentElement;
    if (el === null || !shown(el) || el.closest('[aria-hidden="true"], svg, script, style, template') !== null) continue;
    // Text kept for a screen reader only is drawn in a one-pixel box on purpose.
    const box = el.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1);
    if (rects.length > 0) texts.push({ el, rects, text: (node.textContent ?? "").trim().slice(0, 40) });
  }
  const cut = new Set<string>();
  for (const one of texts) {
    for (let up: Element | null = one.el; up !== null && up !== document.documentElement; up = up.parentElement) {
      const style = getComputedStyle(up);
      const hidesX = /hidden|clip/.test(style.overflowX);
      const hidesY = /hidden|clip/.test(style.overflowY);
      if (!hidesX && !hidesY) continue;
      const box = up.getBoundingClientRect();
      if (one.rects.some((rect) => (hidesX && (rect.left < box.left - 1 || rect.right > box.right + 1)) || (hidesY && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)))) {
        cut.add(`${named(up)} ⟵ ${one.text}`);
        break;
      }
    }
  }
  const over = new Set<string>();
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i]!;
      const b = texts[j]!;
      const crossing = a.rects.some((ra) => b.rects.some((rb) => Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 2 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 2));
      if (crossing) over.add(`${named(a.el)} "${a.text}" × ${named(b.el)} "${b.text}"`);
    }
  }
  return {
    count: texts.length,
    cut: [...cut],
    over: [...over],
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    root: getComputedStyle(document.documentElement).fontSize,
    sizes: texts.map((one) => parseFloat(getComputedStyle(one.el).fontSize)),
  };
}

/** A context of this person whose browser's text size is set to `standard` px, the way Chrome's setting sets it. */
async function withTextSize(context: BrowserContext, standard: number): Promise<Page> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setFontSizes", { fontSizes: { standard, fixed: Math.round(standard * 0.8125) } });
  return page;
}

const SCREENS = [
  { name: "Today", person: "dana", path: "today", ready: (page: Page) => expect(page.getByTestId("queue-count")).toHaveText(/\d/) },
  { name: "the board", person: "dana", path: "pipeline", ready: (page: Page) => expect(page.locator('[data-kit-part="board"] [data-board-card]').first()).toBeVisible() },
  { name: "Settings", person: "tessa", path: "settings", ready: (page: Page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible() },
] as const;

for (const screen of SCREENS) {
  test(`${screen.name} with the browser's text size at 200 %: nothing cut off, nothing over another`, async ({ as }) => {
    const context = await as(screen.person);
    const open = async (standard: number): Promise<Measured> => {
      const page = await withTextSize(context, standard);
      await page.goto(`${STAFF}${screen.path}`);
      await screen.ready(page);
      // Fonts in, and the last of the screen's reads drawn.
      await page.evaluate(() => document.fonts.ready);
      // The screen's later reads (a figure, a lookup) drawn: the count of text boxes stops changing.
      let count = -1;
      await expect.poll(async () => {
        const now = (await page.evaluate(measure)).count;
        const settled = now === count;
        count = now;
        return settled;
      }, { intervals: [400] }).toBe(true);
      const measured = await page.evaluate(measure);
      if (standard === 32) await picture(page, `zw-text-200-${screen.path}`);
      await page.close();
      return measured;
    };
    const normal = await open(16);
    const large = await open(32);
    // The setting reached the page.
    expect(normal.root).toBe("16px");
    expect(large.root).toBe("32px");
    expect(large.count).toBeGreaterThan(10);
    // Cut off by the larger text: a box that hides what overflows it, and did not at 16 px. (A label shortened with an
    // ellipsis at every size, by design, is listed in the note below and not counted here.)
    expect(large.cut.filter((one) => !normal.cut.includes(one)), "text cut off by a box that hides its overflow").toEqual([]);
    expect(large.over, "text over other text").toEqual([]);
    expect(large.sideways, "the page scrolls sideways").toBeLessThanOrEqual(1);
    // How much of the text follows the setting, for the record.
    const grew = large.sizes.filter((size, at) => size > (normal.sizes[at] ?? size) + 0.5).length;
    const note = `${String(grew)} of ${String(large.count)} text boxes grew (${screen.name})${normal.cut.length === 0 ? "" : `; shortened at every size: ${normal.cut.join(", ")}`}`;
    test.info().annotations.push({ type: "text that follows the browser's text size", description: note });
    console.log(`[text 200 %] ${note}`);
  });
}
