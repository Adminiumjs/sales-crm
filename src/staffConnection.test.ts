/**
 * The staff surface's connection binding.
 *
 * Every case here is a way the answer can be ABSENT, because absent is the
 * common case — unbound surfaces, and any Adminium older than the binding —
 * and all of them must keep the app booting on its old inference.
 */
import { describe, expect, it, vi } from "vitest";

import { configBase, loadStaffConfig, resolveStaffConnectionId } from "./staffConnection.ts";

const ok = (doc: unknown) =>
  vi.fn(async () =>
    new Response(JSON.stringify(doc), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;

describe("resolveStaffConnectionId", () => {
  it("reads the bound connection from the served document", async () => {
    const fetchImpl = ok({ connectionId: "con_42" });
    expect(
      await resolveStaffConnectionId({ hostedStaff: true, base: "/apps/clients/staff/", fetchImpl }),
    ).toBe("con_42");
  });

  it("returns null for an UNBOUND surface — a complete answer, not a failure", async () => {
    const fetchImpl = ok({ connectionId: null });
    expect(
      await resolveStaffConnectionId({ hostedStaff: true, base: "/apps/clients/staff/", fetchImpl }),
    ).toBeNull();
  });

  it("returns null when an older server answers with the SPA index", async () => {
    // The route does not exist there; the wildcard serves index.html and
    // `json()` throws. The app must still boot against that Adminium.
    const fetchImpl = vi.fn(
      async () => new Response("<!doctype html><html></html>", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(
      await resolveStaffConnectionId({ hostedStaff: true, base: "/apps/clients/staff/", fetchImpl }),
    ).toBeNull();
  });

  it("never asks on a non-staff build", async () => {
    // A demo or customer bundle has no session and no business fetching this.
    const fetchImpl = ok({ connectionId: "con_42" });
    expect(await resolveStaffConnectionId({ hostedStaff: false, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("configBase", () => {
  const BAKED = "/apps/clients/staff/";

  it("asks the INSTANCE mount when the page is served from one", () => {
    expect(configBase(BAKED, "/apps/clients/berlin/staff/invoices")).toBe(
      "/apps/clients/berlin/staff/",
    );
  });

  it("keeps the baked base on the unslugged mount", () => {
    expect(configBase(BAKED, "/apps/clients/staff/invoices")).toBe(BAKED);
  });

  it("asks `/` on a MAPPED DOMAIN, which is the only place its instance is known", () => {
    /*
     * Reversed deliberately. This returned the baked `/apps/…` form while
     * nothing answered at the root — but a mapped host can now point at an
     * instance, and the bundle never sees the domain map, so the root document
     * is the only thing that can tell it which database it belongs to. Asking
     * the baked form would pin every mapped host to the app's own.
     */
    expect(configBase(BAKED, "/invoices/7")).toBe("/");
    expect(configBase(BAKED, "/")).toBe("/");
  });

  it("never reads the unslugged mount as an instance called `staff`", () => {
    // `/apps/clients/staff/staff` is a deep link, not an instance.
    expect(configBase(BAKED, "/apps/clients/staff/staff")).toBe(BAKED);
  });

  it("ignores an instance path belonging to a DIFFERENT app or side", () => {
    // One bundle must never fetch another surface's binding.
    expect(configBase(BAKED, "/apps/clinic/berlin/staff/x")).toBe(BAKED);
    expect(configBase(BAKED, "/apps/clients/berlin/customer/x")).toBe(BAKED);
  });
});

describe("loadStaffConfig", () => {
  it("reads everything a till boots from, and keeps nothing it does not understand", async () => {
    const fetchImpl = ok({
      connectionId: "con_42",
      appName: null,
      tables: { tickets: "pos_tickets", odd: 7 },
      settings: { business_type: "retail" },
      timezone: "Europe/Lisbon",
      timezoneSource: "operator",
      serverTimezone: "UTC",
      currency: "EUR",
      now: "2026-07-28T13:05:00.000Z",
      user: { id: "usr_1", name: "Cara", email: "cara@example.com" },
      csrfToken: "tok",
      publicKeys: { kiosk: "adm_pub_k", broken: 3 },
      access: { tables: { tickets: ["read", "update", "fly"], odd: "all" }, roles: [{ slug: "pos-cashier", name: "POS cashier" }, { name: "no slug" }] },
      addOns: { invoices: { version: "1.0.3", settings: { business_name: "Harbour Café" } }, odd: 3 },
      sharedTables: { menu_items: ["ordering"], tickets: [], odd: "all" },
      modules: { selling: true, jobs: false, odd: "yes" },
      locale: "ar-EG",
      dir: "rtl",
      kit: { contract: 1, entry: "/assets/kit/kit-abc.js", styles: ["/assets/kit/root-abc.css", 7, ""] },
      maps: { enabled: true, server: "https://tiles.example", routing: false },
    });
    expect(await loadStaffConfig({ hostedStaff: true, base: "/apps/pos/staff/", fetchImpl })).toEqual({
      connectionId: "con_42",
      appName: null,
      tables: { tickets: "pos_tickets" },
      settings: { business_type: "retail" },
      timezone: "Europe/Lisbon",
      timezoneSource: "operator",
      serverTimezone: "UTC",
      currency: "EUR",
      now: "2026-07-28T13:05:00.000Z",
      user: { id: "usr_1", name: "Cara", email: "cara@example.com" },
      csrfToken: "tok",
      publicKeys: { kiosk: "adm_pub_k" },
      access: { tables: { tickets: ["read", "update"] }, roles: [{ slug: "pos-cashier", name: "POS cashier" }] },
      addOns: { invoices: { version: "1.0.3", settings: { business_name: "Harbour Café" } } },
      sharedTables: { menu_items: ["ordering"] },
      // The app's parts, each on or off; the person's own language and its direction.
      modules: { selling: true, jobs: false },
      locale: "ar-EG",
      dir: "rtl",
      // Where Adminium's own parts are, and whether maps are on.
      kit: { contract: 1, entry: "/assets/kit/kit-abc.js", styles: ["/assets/kit/root-abc.css"] },
      maps: { enabled: true, server: "https://tiles.example", routing: false },
    });
  });

  it("says there is no kit and nothing of maps when the server names neither, or names a kit with no file to import", async () => {
    const none = await loadStaffConfig({ hostedStaff: true, base: "/apps/pos/staff/", fetchImpl: ok({ connectionId: "con_42" }) });
    expect([none?.kit, none?.maps]).toEqual([null, null]);
    const broken = await loadStaffConfig({ hostedStaff: true, base: "/apps/pos/staff/", fetchImpl: ok({ connectionId: "con_42", kit: { contract: 1 }, maps: { enabled: "yes" } }) });
    expect([broken?.kit, broken?.maps]).toEqual([null, { enabled: false, server: null, routing: false }]);
    // An Adminium from before the list: one stylesheet, as text.
    const old = await loadStaffConfig({ hostedStaff: true, base: "/apps/pos/staff/", fetchImpl: ok({ connectionId: "con_42", kit: { contract: 1, entry: "/assets/kit/k.js", styles: "/assets/kit/k.css" } }) });
    expect(old?.kit?.styles).toEqual(["/assets/kit/k.css"]);
  });

  it("says nothing of parts or language when the server said nothing: no screen is left out, and the app keeps its own choice", async () => {
    const config = await loadStaffConfig({ hostedStaff: true, base: "/apps/pos/staff/", fetchImpl: ok({ connectionId: "con_42", dir: "sideways" }) });
    expect([config?.modules, config?.locale, config?.dir]).toEqual([null, null, null]);
  });

  it("says nothing of access when the server said nothing, so no button is hidden on a guess", async () => {
    const fetchImpl = ok({ connectionId: "con_42", tables: {} });
    const config = await loadStaffConfig({ hostedStaff: true, base: "/apps/pos/staff/", fetchImpl });
    expect(config?.access).toBeNull();
    expect(config?.publicKeys).toEqual({});
    // No add-on said attached: a feature that needs one stays off.
    expect(config?.addOns).toEqual({});
    // Nor any table another app shares (a server up to 0.3.7 does not say).
    expect(config?.sharedTables).toEqual({});
  });

  it("is null outside a hosted staff build", async () => {
    const fetchImpl = ok({});
    expect(await loadStaffConfig({ hostedStaff: false, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
