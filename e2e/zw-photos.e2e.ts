/**
 * Walk "Photos straight from the camera" (P24), the script's half: a
 * full-size camera photo on the crew's phone (390 wide, touch), on a sign-off
 * and on a snag, made in the test: a 12-megapixel JPEG of 9 MB (over the
 * columns' 8 MB) and a HEIC, as an iPhone hands one over. What the phone does
 * with each, and what it says.
 *
 * The photo field draws a picture the browser can open again at 2048 pixels
 * a side as a JPEG before it is kept, so a 9 MB JPEG is kept small, and
 * nothing is said against it. A HEIC Chromium cannot draw would go as it
 * came, a kind the columns do not take (JPEG, PNG and WebP): it is refused
 * the moment it is picked, in the person's language (English, then Arabic),
 * and never kept on the phone or queued. The same files sent straight to the
 * server's file door (no phone in between) are refused as too large and as
 * the wrong kind.
 *
 * What it makes is named "zw-photos:" and taken away by the install's owner.
 * The real camera (and Safari's own HEIC handling) stays the owner's.
 */
import type { Page } from "@playwright/test";

import { crew } from "../src/i18n/strings/crew.ts";
import { expect, picture, test } from "./fixtures.ts";
import { csrf, inArabic, rows, STAFF, watch } from "./helpers.ts";
import { bookedVisit, takeAwayJobs, wonJobs } from "./zw-helpers.ts";

const PREFIX = "zw-photos:";
const BLUE = 1;
const TODAY = "2026-07-28";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const NINE_MB = 9 * 1024 * 1024;

test.skip(({ stand }) => !stand.parts.includes("jobs"), "Jobs on site arrives with stage 2: run with CRM_STAND_STAGE=2 or 3");

/** A 4032 × 3024 JPEG of noise, as a camera's (made by the browser's own encoder), brought to 9 MB with bytes after its end, as camera files carry. */
async function cameraJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4032;
    canvas.height = 3024;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    let seed = 7;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      image.data[i] = seed & 255;
      image.data[i + 1] = (seed >> 8) & 255;
      image.data[i + 2] = (seed >> 16) & 255;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const made = await new Promise<Blob>((done) => canvas.toBlob((one) => done(one!), "image/jpeg", 0.8));
    const nine = 9 * 1024 * 1024;
    const blob = made.size >= nine ? made : new Blob([made, new Uint8Array(nine - made.size)], { type: "image/jpeg" });
    (window as unknown as { zwJpeg: Blob }).zwJpeg = blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  });
  return Buffer.from(base64, "base64");
}

const WRONG_KIND = { en: crew["en-US"]["cw.photo.wrongKind"], ar: crew["ar-EG"]["cw.photo.wrongKind"] };

/** How many files the phone keeps for its offline queue (every queue database of this origin). */
const heldFiles = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    let n = 0;
    for (const info of await indexedDB.databases()) {
      if (info.name === undefined) continue;
      const base = await new Promise<IDBDatabase>((done, fail) => {
        const asked = indexedDB.open(info.name!);
        asked.onsuccess = () => done(asked.result);
        asked.onerror = () => fail(asked.error);
      });
      if (base.objectStoreNames.contains("files")) {
        n += await new Promise<number>((done, fail) => {
          const counted = base.transaction("files").objectStore("files").count();
          counted.onsuccess = () => done(counted.result);
          counted.onerror = () => fail(counted.error);
        });
      }
      base.close();
    }
    return n;
  });

/** A HEIC as an iPhone's camera writes one: an ISO media file of brand `heic`, its picture in an `mdat` box (2.5 MB). */
function iphoneHeic(): Buffer {
  const box = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body]);
  };
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("heic", "latin1"), Buffer.alloc(4), Buffer.from("mif1heicmiaf", "latin1")]));
  const meta = box("meta", Buffer.concat([Buffer.alloc(4), box("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from("pict", "latin1"), Buffer.alloc(13)]))]));
  const body = Buffer.alloc(2_500_000);
  for (let i = 0; i < body.length; i += 1) body[i] = (i * 2654435761) >>> 24;
  return Buffer.concat([ftyp, meta, box("mdat", body)]);
}

test("photos straight from the camera on the crew's phone: a 9 MB JPEG kept small, a HEIC refused as it is picked (English and Arabic), on a sign-off and on a snag", async ({ as, api, data, stand }) => {
  test.setTimeout(480_000);
  const tessa = await api("tessa");
  const ada = await api("ada");
  const yusuf = await api("f_yusuf");
  await takeAwayJobs(data, tessa, PREFIX);
  let wonAt: number | null = null;
  try {
    const [made] = await wonJobs(tessa, ada, data, [`${PREFIX} canteen benches`], stand.people["dana"]!.id);
    wonAt = Date.now();
    const visit = await bookedVisit(ada, data, made!.job, BLUE, TODAY, "15:00", `${PREFIX} benches`);

    const context = await as("f_yusuf", PHONE);
    const page = await context.newPage();
    const problems = watch(page);
    const consoleLines: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleLines.push(`${message.text().slice(0, 120)} @ ${message.location().url}:${String(message.location().lineNumber)}`);
    });
    const uploads: { status: number; type: string; bytes: number }[] = [];
    page.on("requestfinished", (req) => {
      if (req.method() === "POST" && /\/api\/v1\/files(\?|$)/.test(req.url())) void req.response().then((res) => uploads.push({ status: res?.status() ?? 0, type: req.headers()["content-type"] ?? "", bytes: req.postDataBuffer()?.length ?? 0 }));
    });
    await page.goto(`${STAFF}sign-off-the-job/${String(visit)}`);
    const jpeg = await cameraJpeg(page);
    const heic = iphoneHeic();
    console.info(`[zw-photos] made: a JPEG of ${String(jpeg.length)} bytes, a HEIC of ${String(heic.length)} bytes`);
    expect(jpeg.length).toBeGreaterThanOrEqual(NINE_MB);

    // The server's own door, from the phone's browser with no photo field in between (what the field would meet with a
    // picture it could not draw small): the 9 MB JPEG is too large, the HEIC the wrong kind.
    const token = (await csrf(context.request))["x-adminium-csrf"]!;
    const door = (which: "jpeg" | "heic"): Promise<string> =>
      page.evaluate(
        async ({ which, url, token, heic64 }) => {
          const blob = which === "jpeg" ? (window as unknown as { zwJpeg: Blob }).zwJpeg : new Blob([Uint8Array.from(atob(heic64), (c) => c.charCodeAt(0))], { type: "image/heic" });
          try {
            const res = await fetch(url, { method: "POST", headers: { "content-type": blob.type, "x-adminium-csrf": token }, body: blob });
            return String(res.status);
          } catch (error) {
            return `no answer (${String(error)})`;
          }
        },
        { which, url: `/api/v1/files?connectionId=${stand.connectionId}&table=${encodeURIComponent(stand.tables["crm_sign_offs"]!)}&column=photos&filename=IMG_4020.${which === "jpeg" ? "JPG" : "HEIC"}`, token, heic64: which === "heic" ? heic.toString("base64") : "" },
      );
    const doorJpeg = await door("jpeg");
    const doorHeic = await door("heic");
    console.info(`[zw-photos] the server's file door: the 9 MB JPEG ${doorJpeg}, the HEIC ${doorHeic}`);
    expect(doorHeic).toBe("415");
    // The 9 MB one gets no answer at all: the server refuses it before the body is through, and the browser sees the
    // connection close (reported to the engine: the field would say "not sent", not "too large").
    expect(doorJpeg).not.toBe("201");
    // What the phone itself sends from here on.
    uploads.length = 0;

    // ON THE SIGN-OFF: the 9 MB JPEG is drawn again small and kept on the phone; nothing said against it.
    const photos = page.getByTestId("cw-sign-photos");
    const input = photos.locator('[data-testid="kit-photos-input"]');
    await input.setInputFiles({ name: "IMG_4020.JPG", mimeType: "image/jpeg", buffer: jpeg });
    await expect(photos).toContainText("1 of 6", { timeout: 30_000 });
    await expect(photos).toContainText("Photo added.");
    await expect.poll(() => photos.locator("img").first().evaluate((img) => (img as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    const side = await photos.locator("img").first().evaluate((img) => Math.max((img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight));
    expect(side).toBe(2048);
    expect(await heldFiles(page)).toBe(1);
    // The HEIC, which this browser cannot draw again as a JPEG: refused as it is picked, said at once, kept nowhere.
    await input.setInputFiles({ name: "IMG_4021.HEIC", mimeType: "image/heic", buffer: heic });
    await expect(photos.getByTestId("cw-photo-wrong-kind")).toHaveText(WRONG_KIND.en);
    await expect(photos).toContainText("1 of 6");
    await expect(photos).toContainText("The photo was not kept");
    expect(await heldFiles(page)).toBe(1);
    console.info(`[zw-photos] sign-off, HEIC: the field reads ${JSON.stringify(await photos.innerText())}`);
    await picture(page, "zw-photos-1-signoff-heic");

    // Signed off: the one photo the phone kept goes, and nothing is refused on the way.
    await expect(page.locator("button[data-check]")).toHaveCount(5);
    for (const check of await page.locator("button[data-check]").all()) if ((await check.getAttribute("aria-checked")) !== "true") await check.tap();
    await page.getByRole("button", { name: "Use Petra Holm" }).tap();
    const pad = page.getByTestId("cw-sign-customer");
    await pad.getByRole("button", { name: "Type the name instead" }).tap();
    await pad.getByLabel("Name, as the signature").fill("Petra Holm");
    await pad.getByRole("button", { name: "Keep this signature" }).tap();
    await expect(page.getByTestId("cw-sign-hint")).toHaveText("Ready to sign off.");
    expect(await heldFiles(page)).toBe(2);
    await page.getByTestId("cw-sign-go").tap();
    await expect(page.getByTestId("cw-signed-page")).toBeVisible({ timeout: 30_000 });
    console.info(`[zw-photos] signed off: uploads ${JSON.stringify(uploads)}`);
    expect(uploads.filter((one) => one.status !== 201)).toEqual([]);
    expect(uploads.some((one) => one.type === "image/heic")).toBe(false);
    const [signed] = await rows<{ id: number; photos: string[] | string | null }>(ada, data, "sign_offs", { column: "job_id", op: "eq", value: made!.job });
    const held = (typeof signed!.photos === "string" ? JSON.parse(signed!.photos) : signed!.photos) as string[];
    expect(held.length).toBe(1);
    const kept = await ada.get(`/api/v1/files/${held[0]!}/content`);
    expect([kept.status(), kept.headers()["content-type"]]).toEqual([200, "image/jpeg"]);
    expect((await kept.body()).length).toBeLessThan(8 * 1024 * 1024);

    // ON A SNAG (the form under the signed job): the HEIC, refused as it is picked; the JPEG in its place.
    const before = await heldFiles(page);
    const fresh = page.getByTestId("cw-add-snag").first();
    await fresh.locator("input.crm-input").fill(`${PREFIX} a scratch on the bench top`);
    await fresh.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "IMG_4022.HEIC", mimeType: "image/heic", buffer: heic });
    await expect(fresh.getByTestId("cw-photo-wrong-kind")).toHaveText(WRONG_KIND.en);
    await expect(fresh).toContainText("0 of 1");
    expect(await heldFiles(page)).toBe(before);
    await picture(page, "zw-photos-3-snag-heic");
    await fresh.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "IMG_4023.JPG", mimeType: "image/jpeg", buffer: jpeg });
    await expect(fresh).toContainText("Photo added.", { timeout: 30_000 });
    await expect(fresh.getByTestId("cw-photo-wrong-kind")).toHaveCount(0);
    await fresh.getByRole("button", { name: "Add the snag" }).tap();
    let withPhoto: { id: number; photo: string | null } | undefined;
    await expect.poll(async () => (withPhoto = (await rows<{ id: number; photo: string | null }>(ada, data, "snags", { column: "text", op: "eq", value: `${PREFIX} a scratch on the bench top` }))[0])?.photo ?? null, { timeout: 30_000 }).toMatch(/^file_/);
    const file = await ada.get(`/api/v1/files/${withPhoto!.photo!}/content`);
    expect([file.status(), file.headers()["content-type"]]).toEqual([200, "image/jpeg"]);
    expect((await file.body()).length).toBeLessThan(8 * 1024 * 1024);
    expect(uploads.some((one) => one.type === "image/heic")).toBe(false);

    // IN ARABIC, at 390: the same HEIC on the snag form, refused as it is picked, in his language, right to left.
    await inArabic(yusuf, async () => {
      const arabic = await (await as("f_yusuf", PHONE)).newPage();
      const said = watch(arabic);
      await arabic.goto(`${STAFF}sign-off-the-job/${String(visit)}`);
      await expect(arabic.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(arabic.getByTestId("cw-signed-page")).toBeVisible({ timeout: 30_000 });
      const form = arabic.getByTestId("cw-add-snag").first();
      const was = await heldFiles(arabic);
      await form.locator('[data-testid="kit-photos-input"]').setInputFiles({ name: "IMG_4024.HEIC", mimeType: "image/heic", buffer: heic });
      const note = form.getByTestId("cw-photo-wrong-kind");
      await expect(note).toHaveText(WRONG_KIND.ar);
      expect(await note.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
      expect(await heldFiles(arabic)).toBe(was);
      expect(await arabic.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await picture(arabic, "zw-photos-4-snag-heic-ar");
      expect(said.filter((line) => !/Failed to load resource/.test(line) && !/^Connecting to 'blob:.*Content Security Policy/.test(line))).toEqual([]);
      await arabic.context().close();
    });
    console.info(`[zw-photos] the page's console: ${JSON.stringify(consoleLines)}`);
    // Left out: the refused uploads' own lines, and Playwright's trace recorder reading the page's blob pictures for its
    // snapshots, which the page's CSP refuses (not the app's: gone with `--trace off`).
    expect(problems.filter((line) => !/ 41[35] |Failed to load resource/.test(line) && !/^Connecting to 'blob:.*Content Security Policy/.test(line))).toEqual([]);
  } finally {
    if (wonAt !== null) await new Promise((done) => setTimeout(done, Math.max(0, 130_000 - (Date.now() - wonAt!))));
    await takeAwayJobs(data, tessa, PREFIX);
  }
});
