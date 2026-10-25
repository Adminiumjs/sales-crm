/**
 * Walk "The Day sheet printed on paper" (P24): the sheet as Chromium prints
 * it (`page.pdf`, print media) on A4 and on US Letter, in English and in
 * Arabic, as the operations manager. A day sheet is one crew's day: every
 * crew's sheet of a busy day is printed, and each must be ONE page, with
 * nothing cut off. What the PDF holds is checked by its page count; that
 * nothing is cut off, by measuring the print layout in the page itself with
 * the paper's width and print media (every line inside the printable box, no
 * box around it that clips it, its height inside one page).
 *
 * A crew with nothing booked prints the "nothing booked" line; on the screen
 * a day with nothing booked is a dashed chip, readable (its contrast is
 * measured). The four PDFs of the busiest crew are kept with the test's
 * output (and attached to the report).
 */
import { writeFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { inArabic, rows, STAFF, watch } from "./helpers.ts";

const DAY = "2026-08-05";
const MM = 96 / 25.4;
const MARGIN_MM = 12;
const PAPERS = [
  { name: "A4", format: "A4", width: 210, height: 297 },
  { name: "Letter", format: "Letter", width: 215.9, height: 279.4 },
] as const;

test.skip(({ stand }) => !stand.parts.includes("jobs"), "Jobs on site arrives with stage 2: run with CRM_STAND_STAGE=2 or 3");

/** The pages a PDF has: its page objects (the page tree's own nodes are `/Pages`). */
const pageCount = (pdf: Buffer): number => (pdf.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

/** What does not fit the paper, measured in print media at the printable width: lines past an edge, a box that clips, a sheet taller than a page. */
async function misfits(page: Page, paper: (typeof PAPERS)[number]): Promise<string[]> {
  const width = Math.floor((paper.width - 2 * MARGIN_MM) * MM);
  const height = Math.floor((paper.height - 2 * MARGIN_MM) * MM);
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width, height });
  try {
    return await page.evaluate(({ width, height }) => {
      const out: string[] = [];
      const sheet = document.querySelector<HTMLElement>(".crm-jb-print");
      if (sheet === null) return ["no print layout"];
      const box = sheet.getBoundingClientRect();
      if (box.height === 0 || getComputedStyle(sheet).visibility !== "visible") out.push("the print layout is not shown in print");
      if (box.height > height) out.push(`taller than a page: ${String(Math.round(box.height))} > ${String(height)} px`);
      // Nor anything else on the page: the document's own height is what the PDF makes pages of.
      const whole = document.documentElement.scrollHeight;
      if (whole > height + 1) out.push(`the page is ${String(whole)} px tall in print, over one page of ${String(height)} px (the sheet ${String(Math.round(box.height))})`);
      // Every piece of text inside the printable width.
      const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() === "") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.left < -0.5 || rect.right > width + 0.5) out.push(`past the edge (${String(Math.round(rect.left))}–${String(Math.round(rect.right))} of ${String(width)}): ${(node.textContent ?? "").trim().slice(0, 50)}`);
        }
      }
      // Nothing the layout sits in clips it: at the middle of each line, the page shows that line's own element.
      const walker2 = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
      for (let node = walker2.nextNode(); node !== null; node = walker2.nextNode()) {
        if ((node.textContent ?? "").trim() === "" || node.parentElement === null) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.bottom > height) continue; // past the page: said above
        const hit = document.elementFromPoint(Math.min(width - 1, Math.max(0, rect.left + rect.width / 2)), rect.top + rect.height / 2);
        if (hit === null || !(hit === node.parentElement || node.parentElement.contains(hit) || hit.contains(node.parentElement))) out.push(`hidden under ${hit === null ? "nothing" : `${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0] ?? ""}`}: ${(node.textContent ?? "").trim().slice(0, 50)}`);
      }
      return out;
    }, { width, height });
  } finally {
    // Back to the browser's own media (null): "screen" would hold for page.pdf too, and print the screen.
    await page.emulateMedia({ media: null });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

/** The contrast of a chip's words against its own background, as WCAG measures it. */
const contrastOf = (page: Page, selector: string): Promise<number> =>
  page.locator(selector).first().evaluate((chip) => {
    const rgb = (value: string): number[] => (value.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]): number => [r!, g!, b!].map((c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    let back: Element | null = chip;
    let bg = "rgba(0, 0, 0, 0)";
    while (back !== null && /rgba\(.*, 0\)|transparent/.test((bg = getComputedStyle(back).backgroundColor))) back = back.parentElement;
    const [a, b] = [lum(rgb(getComputedStyle(chip).color)), lum(rgb(bg))];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });

test("the Day sheet on paper: every crew's sheet of a busy day is one page on A4 and Letter, in English and Arabic, nothing cut off; nothing booked reads plainly", async ({ as, api, data }, info) => {
  test.setTimeout(300_000);
  const ada = await api("ada");
  const crews = await rows<{ id: number; name: string }>(ada, data, "crews", undefined, "&order=id");
  const booked = await rows<{ crew_id: number | null }>(ada, data, "job_visits", { and: [{ column: "day", op: "eq", value: DAY }, { column: "state", op: "eq", value: "booked" }] });
  const count = (crew: number): number => booked.filter((visit) => visit.crew_id === crew).length;
  const busiest = [...crews].sort((a, b) => count(b.id) - count(a.id))[0]!;
  expect(count(busiest.id), "a crew with visits that day").toBeGreaterThan(0);
  const empty = crews.find((crew) => count(crew.id) === 0);
  console.info(`[zw-print] ${DAY}: ${crews.map((crew) => `${crew.name} ${String(count(crew.id))}`).join(", ")}`);

  const context = await as("ada");
  const page = await context.newPage();
  const problems = watch(page);
  const found: string[] = [];
  const print = async (language: "en" | "ar"): Promise<void> => {
    for (const crew of crews) {
      await page.goto(`${STAFF}day-sheet/${DAY}/${String(crew.id)}`);
      await expect(page.getByTestId("jb-sheet")).toHaveAttribute("data-crew", String(crew.id));
      // On the screen: a day with nothing booked is a dashed chip, its words readable.
      const quiet = page.locator('.crm-jb-days .crm-chip-btn[data-quiet="1"]');
      if ((await quiet.count()) > 0) {
        expect(await quiet.first().evaluate((chip) => getComputedStyle(chip).borderTopStyle)).toBe("dashed");
        const ratio = await contrastOf(page, '.crm-jb-days .crm-chip-btn[data-quiet="1"]');
        if (ratio < 4.5) found.push(`${language} ${crew.name}: a dashed day's words at ${ratio.toFixed(2)}:1`);
      }
      await page.getByTestId("jb-print").click();
      const layout = page.getByTestId("jb-print-layout");
      await expect(layout).toBeVisible();
      await expect(layout.locator("ol > li")).toHaveCount(count(crew.id));
      if (count(crew.id) === 0) await expect(layout).toContainText(language === "en" ? "Nothing booked for this crew on this day." : "لا حجوزات لهذا الفريق في هذا اليوم.");
      for (const paper of PAPERS) {
        for (const line of await misfits(page, paper)) found.push(`${language} ${paper.name} ${crew.name}: ${line}`);
        const pdf = await page.pdf({ format: paper.format, margin: { top: `${String(MARGIN_MM)}mm`, bottom: `${String(MARGIN_MM)}mm`, left: `${String(MARGIN_MM)}mm`, right: `${String(MARGIN_MM)}mm` } });
        const pages = pageCount(pdf);
        if (pages !== 1) found.push(`${language} ${paper.name} ${crew.name}: ${String(pages)} pages`);
        if (crew.id === busiest.id || crew.id === empty?.id) {
          const name = `day-sheet-${DAY}-${crew.name.toLowerCase().replace(/\W+/g, "-")}-${paper.name}-${language}.pdf`;
          writeFileSync(info.outputPath(name), pdf);
          await info.attach(name, { body: pdf, contentType: "application/pdf" });
        }
      }
      await page.keyboard.press("Escape");
      await expect(layout).toHaveCount(0);
    }
  };
  await print("en");
  await inArabic(ada, async () => {
    await page.goto(`${STAFF}day-sheet/${DAY}/${String(busiest.id)}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await print("ar");
  });
  expect(found).toEqual([]);
  expect(problems).toEqual([]);
});
