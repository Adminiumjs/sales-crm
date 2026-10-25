/**
 * Approvals → "Answer in Sales CRM" on an install whose staff side is on its own address: it opens the app's Approvals
 * screen, not its first page, in a new tab, on that address.
 *
 * HOW AN INSTALL PUTS THE STAFF SIDE ON ITS OWN ADDRESS. Studio → the app → Staff screens → "Add a domain": the host is
 * kept in `surfaces.domains` (`PUT /api/v1/apps/<key>/domains`), and a request whose Host is that name is answered AS the
 * staff side, from its root (`/approvals`, not `/apps/crm/staff/approvals`). The console's link to the side then names
 * that host. A session's cookie belongs to the host it was given on, so on the new address a person signs in again
 * (the side's own sign-in page, `/login?next=…`), and lands where the link was going.
 *
 * THE ADDRESS HERE IS A LOOPBACK NAME. A real install names a domain of its own (with TLS at its proxy); the stand
 * cannot have one, so the spec maps `crm-staff.localhost:<the stand's port>`. Chromium sends every `*.localhost` name to
 * this machine's loopback, so the request reaches the stand (on 127.0.0.1) with that Host, exactly as a domain would
 * through a proxy that passes the Host on. What stays the owner's: a real domain, its certificate and its proxy.
 *
 * The domain is added through Studio as the owner would, and taken away again at the end, whatever happens.
 */
import { authOf, expect, picture, takeTurn, test } from "./fixtures.ts";
import { csrf } from "./helpers.ts";

test("with the staff side on its own address, Ivy's \"Answer in Sales CRM\" opens its Approvals screen there, in a new tab", async ({ as, browser, stand }) => {
  const host = `crm-staff.localhost:${String(stand.port)}`;
  const ownerContext = await as("owner");
  const owner = ownerContext.request;
  const headers = await csrf(owner);
  try {
    // Studio → Sales CRM → Staff screens → Add a domain.
    const studio = await ownerContext.newPage();
    await studio.goto("/studio/apps/crm");
    const staffSide = studio.getByTestId("app-side-staff");
    await expect(staffSide).toContainText(`${stand.url}/apps/crm/staff/`);
    await staffSide.getByRole("button", { name: "Add a domain" }).click();
    await staffSide.getByPlaceholder("till.example.com").fill(host);
    const [saved] = await Promise.all([studio.waitForResponse((res) => res.url().endsWith("/api/v1/apps/crm/domains") && res.request().method() === "PUT"), staffSide.getByRole("button", { name: "Add", exact: true }).click()]);
    expect(saved.status(), await saved.text()).toBe(200);
    // The side's address is that host now.
    await expect(staffSide).toContainText(`http://${host}/`);
    await picture(studio, "zw-studio-staff-domain");

    // Ivy, in the console on its own address, opens Approvals and answers in the app.
    const ivyContext = await as("ivy");
    const page = await ivyContext.newPage();
    await page.goto("/p/crm-approvals");
    const link = page.getByTestId("page-dashboard-link");
    await expect(link).toHaveText(/Answer in Sales CRM/);
    const [tab] = await Promise.all([ivyContext.waitForEvent("page"), link.click()]);
    await tab.waitForLoadState();
    // A new tab, on the side's own address: its sign-in first (a new address is a new session), going on to Approvals.
    expect(page.url()).toMatch(/\/p\/crm-approvals$/);
    expect(new URL(tab.url()).host).toBe(host);
    expect(new URL(tab.url()).pathname).toBe("/login");
    expect(new URL(tab.url()).searchParams.get("next")).toBe("/approvals");
    await takeTurn();
    await tab.getByLabel("Email").fill(stand.people["ivy"]!.email);
    await tab.getByRole("textbox", { name: "Password" }).fill(stand.staffPassword);
    await tab.getByRole("button", { name: "Sign in", exact: true }).click();
    // The app's Approvals screen, at the root of its own address: not its first page.
    await expect(tab).toHaveURL(`http://${host}/approvals`);
    // Q-1001's request among those waiting (earlier specs may leave their own on top of it).
    await expect(tab.locator(".crm-approval", { hasText: "Q-1001" })).toBeVisible();
    await expect(tab.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Approvals" })).toHaveAttribute("aria-current", "page");
    await picture(tab, "zw-ivy-approvals-own-address");
  } finally {
    // Take the domain away: the side is back at its path on this server.
    const back = await owner.put("/api/v1/apps/crm/domains", { data: { domains: {} }, headers });
    expect(back.status(), await back.text()).toBe(200);
  }
  const check = await browser.newContext({ baseURL: stand.url, storageState: await authOf(browser, "ivy") });
  const after = await check.newPage();
  await after.goto("/p/crm-approvals");
  const [staff] = await Promise.all([check.waitForEvent("page"), after.getByTestId("page-dashboard-link").click()]);
  await staff.waitForLoadState();
  expect(staff.url()).toBe(`${stand.url}/apps/crm/staff/approvals`);
  await check.close();
});
