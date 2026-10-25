/**
 * Plan 67 Part 3 session 9, "Sign in with two-factor on", in Adminium's console with the CRM installed. Corin (the
 * front desk, a sample person) sets up two-factor on Account → Security; the spec takes the setup key the server makes
 * and works out each code itself (RFC 6238, on the stand's own clock, which is not the machine's). Then Corin signs in
 * through the sign-in form: the code step is drawn (on an ordinary connection and on a slow one, throttled through the
 * browser's own tools); a reload on the code step brings it back; the code signs Corin in. Two-factor is turned off again
 * at the end, whatever happened. "At once, with no blank frame" is an engine fault today: pinned by the last test,
 * expected to fail until it is fixed.
 */
import { createHmac } from "node:crypto";

import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import { expect, picture, takeTurn, test } from "./fixtures.ts";
import { csrf, watch } from "./helpers.ts";
import { standNow } from "./zw-console-helpers.ts";

const PERSON = "corin";

/** A TOTP code (SHA-1, 6 digits, 30 s) for a base32 secret at a moment. */
export function totp(secret: string, at: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A code for now on the server's clock, with time to type it (not in a step's last 5 seconds). */
async function codeNow(person: APIRequestContext, secret: string): Promise<string> {
  for (;;) {
    const serverNow = await standNow(person);
    if (serverNow % 30_000 < 25_000) return totp(secret, serverNow);
    await new Promise((done) => setTimeout(done, 30_000 - (serverNow % 30_000) + 200));
  }
}

/**
 * Each frame the browser paints, from the first: which of the two steps is on the screen, or neither ("blank"). Kept in
 * the page (`window.__frames`), and carried over a navigation inside the page (the steps are one app).
 */
const RECORD_FRAMES = () => {
  const frames: { step: string; at: number }[] = [];
  (window as unknown as { __frames: typeof frames }).__frames = frames;
  const look = (at: number) => {
    frames.push({ step: document.querySelector('[data-part="two-factor-form"]') !== null ? "code" : document.querySelector('[data-part="sign-in-form"]') !== null ? "form" : "blank", at });
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};

/** What was painted from the last frame of the sign-in form until the code step came, and how long nothing was there. */
async function framesToCode(page: Page): Promise<{ steps: string[]; blankMs: number }> {
  const frames = await page.evaluate(() => (window as unknown as { __frames: { step: string; at: number }[] }).__frames);
  const to = frames.findIndex((frame) => frame.step === "code");
  const from = frames.slice(0, to).map((frame) => frame.step).lastIndexOf("form");
  expect(from, "the sign-in form was painted").toBeGreaterThanOrEqual(0);
  expect(to, "the code step was painted").toBeGreaterThan(from);
  const between = frames.slice(from, to + 1);
  return { steps: between.map((frame) => frame.step), blankMs: Math.round(between.at(-1)!.at - between[0]!.at) };
}

/** Sign in through the form and the code step (a reload on it first); answers what was painted between the two. */
async function signInWithCode(context: BrowserContext, person: APIRequestContext, secret: string, email: string, password: string, slow: boolean): Promise<{ steps: string[]; blankMs: number }> {
  const page = await context.newPage();
  const problems = watch(page);
  await page.addInitScript(RECORD_FRAMES);
  if (slow) {
    // A slow connection, as the browser's own tools make one: 400 ms each way, 40 KB a second.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 40 * 1024, uploadThroughput: 40 * 1024 });
  }
  await page.goto("/login", { timeout: 90_000 });
  const form = page.locator('[data-part="sign-in-form"]');
  await expect(form).toBeVisible({ timeout: 60_000 });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password", { exact: true }).fill(password);
  await takeTurn();
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  const code = page.locator('[data-part="two-factor-form"]');
  await expect(code).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/otp$/);
  const painted = await framesToCode(page);
  await expect(code.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
  await picture(page, `zw-two-factor-code-step${slow ? "-slow" : ""}`);

  // A reload on the code step: it comes back (its challenge is kept for the tab), not the sign-in form.
  await page.reload({ timeout: 90_000 });
  await expect(page.locator('[data-part="two-factor-form"]')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/otp$/);

  // The sixth digit sends it (the step submits itself once the code is whole).
  await page.getByLabel("One-time code").pressSequentially(await codeNow(person, secret));
  await expect(page).not.toHaveURL(/\/(otp|login)/, { timeout: 60_000 });
  expect((await page.request.get("/api/v1/me/prefs")).status(), "signed in").toBe(200);
  expect(problems.filter((problem) => !/Failed to load resource/.test(problem))).toEqual([]);
  await page.close();
  return painted;
}

/** Two-factor set up for the person through the server's own routes, the secret kept; answers it. */
async function enrol(person: APIRequestContext): Promise<string> {
  const headers = await csrf(person);
  const started = await person.post("/api/v1/auth/2fa/enroll", { headers });
  expect(started.status(), await started.text()).toBeLessThan(300);
  const secret = ((await started.json()) as { data: { secret: string } }).data.secret;
  const on = await person.post("/api/v1/auth/2fa/activate", { data: { code: await codeNow(person, secret) }, headers });
  expect(on.status(), await on.text()).toBeLessThan(300);
  return secret;
}

test("two-factor on: set up, signed in through the code step on an ordinary and a slow connection, again after a reload, then off", async ({ as, api, browser, stand }) => {
  test.setTimeout(300_000);
  const person = await api(PERSON);
  const who = stand.people[PERSON]!;
  const context = await as(PERSON);
  const page = await context.newPage();
  try {
    // Set up on Account → Security: the setup key is the server's; the code is worked out from it.
    await page.goto("/account/security");
    await expect(page.getByTestId("security-2fa-state")).toHaveText("Off");
    const enrolled = page.waitForResponse((res) => res.url().endsWith("/api/v1/auth/2fa/enroll") && res.request().method() === "POST");
    await page.getByTestId("security-2fa-enroll").click();
    const secret = ((await (await enrolled).json()) as { data: { secret: string } }).data.secret;
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    await page.getByLabel("Code from your app").fill(await codeNow(person, secret));
    await page.getByRole("button", { name: "Turn on two-factor", exact: true }).click();
    await expect(page.getByTestId("security-recovery-codes")).toBeVisible();
    await expect(page.getByTestId("security-2fa-state")).toHaveText("On");

    for (const slow of [false, true]) {
      const fresh = await browser.newContext({ baseURL: stand.url });
      try {
        await signInWithCode(fresh, person, secret, who.email, stand.staffPassword, slow);
      } finally {
        await fresh.close();
      }
    }

    // Off again, on the same page, with the password.
    await page.goto("/account/security");
    await page.getByTestId("security-2fa-disable").click();
    await page.getByRole("dialog").getByLabel("Your password").fill(stand.staffPassword);
    await page.getByTestId("security-2fa-disable-confirm").click();
    await expect(page.getByTestId("security-2fa-state")).toHaveText("Off");
  } finally {
    const res = await person.post("/api/v1/auth/2fa/disable", { data: { password: stand.staffPassword }, headers: await csrf(person) });
    expect([200, 204, 409], `two-factor is off: ${await res.text()}`).toContain(res.status());
  }
});

// Engine fault: the code step is a lazy route with an empty fallback (apps/dashboard/src/app/router.tsx:94-110), so ~317 ms of neither step is painted though LoginPage.tsx:98 fetched its chunk first.
test("the code step comes at once after the password: no blank frame, on an ordinary or a slow connection", async ({ api, browser, stand }) => {
  test.fail();
  test.setTimeout(240_000);
  const person = await api(PERSON);
  const who = stand.people[PERSON]!;
  try {
    const secret = await enrol(person);
    const painted: string[] = [];
    for (const slow of [false, true]) {
      const fresh = await browser.newContext({ baseURL: stand.url });
      try {
        const frames = await signInWithCode(fresh, person, secret, who.email, stand.staffPassword, slow);
        painted.push(`${slow ? "slow" : "ordinary"}: ${String(frames.steps.filter((step) => step === "blank").length)} blank frames over ${String(frames.blankMs)} ms`);
        expect(frames.steps, painted.join("; ")).not.toContain("blank");
      } finally {
        await fresh.close();
      }
    }
  } finally {
    const res = await person.post("/api/v1/auth/2fa/disable", { data: { password: stand.staffPassword }, headers: await csrf(person) });
    expect([200, 204, 409], `two-factor is off: ${await res.text()}`).toContain(res.status());
  }
});
