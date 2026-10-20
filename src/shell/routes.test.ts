/**
 * The menu, as a function of who is asking: the app's roles they hold, the
 * parts that are on, the tables they read, and which screens exist yet.
 */
import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";
import { canOpen, homeFor, HOMES, inMenu, menuFor, MENUS, OWN, rolesOf, ROLE_ORDER, routeForPath, ROUTES, USER_MENU, type MenuFacts, type PartId, type RoleKey, type RouteKey } from "./routes.ts";

type Role = { key: string; permissions: string[]; tables?: { addOn: string; table: string; actions: string[] }[] };
const roles = (manifest as unknown as { roles: Role[] }).roles;
const tables = (manifest as unknown as { requiredSchema: { tables: { ref: string; module?: string }[] } }).requiredSchema.tables;
/** An add-on's tables the app's roles are given, as the session names them: `inventory:items`. */
const addOnTables = new Set(roles.flatMap((role) => (role.tables ?? []).map((entry) => `${entry.addOn}:${entry.table}`)));
const parts = (manifest as unknown as { modules: { id: string }[] }).modules.map((part) => part.id);

/** What a person holding these roles is told, on an install with every part on and every screen built. */
function facts(held: RoleKey[], over: Partial<MenuFacts> = {}): MenuFacts {
  const mine = roles.filter((role) => held.includes(role.key as RoleKey));
  // A role's own grants, and what it is given of an add-on's tables (read while the add-on is connected).
  const grants = new Set([...mine.flatMap((role) => role.permissions), ...mine.flatMap((role) => (role.tables ?? []).filter((entry) => entry.actions.includes("read")).map((entry) => `table:@${entry.addOn}:${entry.table}:read`))]);
  return { roles: held.map((key) => `crm-${key}`), part: () => true, reads: (table) => grants.has(`table:@${table}:read`), built: () => true, ...over };
}
const routesOf = (f: MenuFacts): RouteKey[] => menuFor(f).flatMap((group) => group.items.map((item) => item.route));

describe("the table of screens", () => {
  it("names only parts and tables the manifest has", () => {
    for (const [key, def] of Object.entries(ROUTES)) {
      if (def.part !== null) expect(parts, key).toContain(def.part);
      for (const table of def.reads) expect([...tables.map((t) => t.ref), ...addOnTables], `${key} reads ${table}`).toContain(table);
    }
  });

  it("gives every role of the manifest a menu and a home, and no other", () => {
    expect(Object.keys(MENUS).sort()).toEqual(roles.map((role) => role.key).sort());
    expect(Object.keys(HOMES).sort()).toEqual([...ROLE_ORDER].sort());
  });

  it("lists a screen at most once in a role's menu", () => {
    for (const [role, groups] of Object.entries(MENUS)) {
      const listed = groups.flatMap(([, items]) => items.map((item) => item.route));
      expect(new Set(listed).size, role).toBe(listed.length);
    }
  });
});

describe("a role's menu is the design's, cut to what the role can open", () => {
  it("offers a role every line of its own menu on an install with every part on: the roles read what their screens need", () => {
    // A line a role's own grants could never open would be a line drawn for nobody.
    const missing: string[] = [];
    for (const role of ROLE_ORDER) {
      const f = facts([role]);
      for (const [, items] of MENUS[role]) for (const item of items) if (!canOpen(item.route, f)) missing.push(`${role}: ${item.route} (${ROUTES[item.route].reads.filter((table) => !f.reads(table)).join(", ")})`);
    }
    expect(missing).toEqual([]);
  });

  it("gives the rep her five groups in the design's order", () => {
    expect(menuFor(facts(["rep"])).map((group) => [group.group, group.items.length])).toEqual([["top", 5], ["selling", 6], ["accounts", 4], ["inbox", 1], ["team", 6]]);
  });

  it("calls a screen by the role's own words", () => {
    const label = (role: RoleKey, route: RouteKey) => menuFor(facts([role])).flatMap((group) => group.items).find((item) => item.route === route)?.label;
    expect([label("rep", "targets"), label("sales-manager", "targets")]).toEqual(["myTargets", "teamTargets"]);
    expect([label("rep", "pipeline"), label("sales-manager", "pipeline")]).toEqual(["pipeline", "teamBoard"]);
    // The account manager's "Deals I am on" arrives with stage 2: until then he reads a deal only once it is won, and holds "Won deals".
    expect(MENUS["account-manager"].flatMap(([, items]) => items.map((item) => item.route))).not.toContain("pipeline");
    expect(label("account-manager", "archive")).toBe("wonDeals");
  });

  it("takes a part's screens out when the part is off, and the group with them", () => {
    const f = facts(["rep"], { part: (id: PartId) => id !== "quotes" && id !== "inbox" });
    expect(routesOf(f)).not.toContain("quotes");
    expect(menuFor(f).map((group) => group.group)).toEqual(["top", "selling", "accounts", "team"]);
  });

  it("holds no line for a screen that is not built", () => {
    const built = new Set<RouteKey>(["today", "pipeline"]);
    expect(routesOf(facts(["rep"], { built: (route) => built.has(route) }))).toEqual(["today", "pipeline"]);
  });

  it("keeps the marketer and the front desk to their few lines", () => {
    expect(routesOf(facts(["marketer"]))).toEqual(["mkhome", "leads", "companies", "contacts"]);
    // With every part on, the front desk has her home and the showroom's five (P19); at the first release, the Inbox alone.
    expect(routesOf(facts(["front-desk"]))).toEqual(["deskhome", "showroom", "showfollow", "samples", "returns", "floor", "inbox"]);
    expect(routesOf(facts(["front-desk"], { part: (id: PartId) => id !== "showroom" }))).toEqual(["inbox"]);
    // The field crew: his day and his crew's snags (P22), his hours and certificates (P25), and nothing at all while both parts are off (stage 1).
    expect(routesOf(facts(["crew"]))).toEqual(["myday", "mysnags", "myhours", "mycerts"]);
    expect(routesOf(facts(["crew"], { part: (id: PartId) => id !== "fleet" }))).toEqual(["myday", "mysnags"]);
    expect(routesOf(facts(["crew"], { part: (id: PartId) => id !== "jobs" }))).toEqual(["myhours", "mycerts"]);
    expect(routesOf(facts(["crew"], { part: (id: PartId) => id !== "jobs" && id !== "fleet" }))).toEqual([]);
  });

  it("keeps the crew's phone to the crew: no other role's menu holds it, and the sign-off page is lit by his day", () => {
    for (const route of ["myday", "mysnags", "crewsign", "myhours", "mycerts"] as const) {
      for (const role of ROLE_ORDER.filter((one) => one !== "crew")) expect([role, route, inMenu(route, [`crm-${role}`])]).toEqual([role, route, false]);
      expect(inMenu(route, ["crm-crew"]), route).toBe(true);
    }
  });

  it("gives Time sheets and Training to the operations manager, the CRM admin and Read-only, and to nobody else (P25)", () => {
    for (const role of ROLE_ORDER) {
      const office = role === "ops-manager" || role === "admin" || role === "read-only";
      for (const route of ["timesheets", "training"] as const) expect([role, route, inMenu(route, [`crm-${role}`])]).toEqual([role, route, office]);
    }
    expect(menuFor(facts(["ops-manager"])).find((group) => group.group === "fleet")?.items.map((item) => item.route)).toEqual(["timesheets", "training"]);
    // Off while Vehicles and crew is (stages 1 and 2).
    expect(routesOf(facts(["ops-manager"], { part: (id: PartId) => id !== "fleet" }))).not.toContain("timesheets");
  });

  it("gives the showroom's five to the front desk, the CRM admin and Read-only, and to nobody else (P19)", () => {
    const showroom = ["showroom", "showfollow", "samples", "returns", "floor"] as const;
    for (const role of ["front-desk", "admin", "read-only"] as const) {
      const group = menuFor(facts([role])).find((one) => one.group === "showroom");
      expect([role, group?.items.map((item) => item.route)]).toEqual([role, [...showroom]]);
    }
    for (const role of ["rep", "sales-manager", "account-manager", "marketer", "ops-manager", "crew"] as const) for (const route of showroom) expect([role, route, inMenu(route, [`crm-${role}`])]).toEqual([role, route, false]);
    // The admin's groups: Inbox, then the showroom, Jobs on site, After the job, then Supply.
    expect(menuFor(facts(["admin"])).map((group) => group.group)).toEqual(["top", "selling", "accounts", "inbox", "showroom", "jobs", "aftercare", "supply", "fleet", "team", "settings"]);
  });
});

describe("a person with two roles, and a person with none", () => {
  it("merges the two menus, the leading role's first, each screen once", () => {
    const both = routesOf(facts(["rep", "sales-manager"]));
    expect(new Set(both).size).toBe(both.length);
    // The manager's menu leads; the rep's own screens the manager's lacks come after, in their groups.
    expect(both.slice(0, 6)).toEqual(["team", "health", "nudges", "notifs", "feed", "digest"]);
    expect(both).toContain("today");
    expect(rolesOf(["crm-rep", "crm-sales-manager"])).toEqual(["sales-manager", "rep"]);
  });

  it("reads the install's owner, who holds none of the app's roles, as the CRM admin", () => {
    expect(rolesOf([])).toEqual(["admin"]);
    const owner: MenuFacts = { roles: [], part: () => true, reads: () => true, built: () => true };
    expect(routesOf(owner)).toEqual(routesOf(facts(["admin"])));
    expect(homeFor(owner)).toBe("team");
  });
});

describe("a screen is a role's, or it is not", () => {
  it("holds the manager's screens out of a rep's reach, though she reads every table they read", () => {
    const dana = facts(["rep"]);
    for (const route of ["team", "health", "nudges", "feed", "lost", "approvals"] as const) {
      expect(canOpen(route, dana), `${route}: the tables are hers to read`).toBe(true);
      expect(inMenu(route, dana.roles), route).toBe(false);
    }
    expect(inMenu("today", dana.roles)).toBe(true);
  });

  it("gives the CRM admin Nudges (under Settings) and Read-only none", () => {
    expect(inMenu("nudges", ["crm-admin"])).toBe(true);
    expect(inMenu("nudges", ["crm-read-only"])).toBe(false);
    for (const route of ["team", "health", "feed", "lost"] as const) for (const role of ["crm-admin", "crm-sales-manager", "crm-read-only"]) expect(inMenu(route, [role]), `${role} ${route}`).toBe(true);
    // Nobody but those three: not the account manager, the marketer, the front desk, operations or the crew.
    for (const route of ["team", "health", "feed", "lost", "nudges"] as const) for (const role of ["crm-account-manager", "crm-marketer", "crm-front-desk", "crm-ops-manager", "crm-crew"]) expect(inMenu(route, [role]), `${role} ${route}`).toBe(false);
  });

  it("opens a screen for somebody with two roles when either holds it, and reads the install's owner as the CRM admin", () => {
    expect(inMenu("team", ["crm-rep", "crm-sales-manager"])).toBe(true);
    expect(inMenu("today", ["crm-rep", "crm-sales-manager"])).toBe(true);
    expect(inMenu("nudges", [])).toBe(true);
    expect(inMenu("today", [])).toBe(false);
  });

  it("lands the CRM admin and Read-only on the Team view, and a rep who is also Read-only on Today", () => {
    expect(homeFor(facts(["admin"]))).toBe("team");
    expect(homeFor(facts(["read-only"]))).toBe("team");
    expect(homeFor(facts(["rep", "read-only"]))).toBe("today");
    // The union of the two menus, the rep's leading: her Today first, and Read-only's Team view after it.
    const both = routesOf(facts(["rep", "read-only"]));
    expect(both[0]).toBe("today");
    expect(both).toContain("team");
    expect(both).toContain("lost");
    expect(new Set(both).size).toBe(both.length);
  });
});

describe("where a person lands", () => {
  it("is the leading role's home", () => {
    expect(homeFor(facts(["rep"]))).toBe("today");
    expect(homeFor(facts(["rep", "sales-manager"]))).toBe("team");
    expect(homeFor(facts(["account-manager"]))).toBe("amhome");
  });

  it("is the first line they can open when the home's part is off or the home is not built", () => {
    expect(homeFor(facts(["marketer"], { part: (id: PartId) => id !== "inbox" }))).toBe("companies");
    expect(homeFor(facts(["rep"], { built: (route) => route !== "today" }))).toBe("week");
    // The front desk on the default install (no showroom yet): the Inbox and nothing else.
    expect(homeFor(facts(["front-desk"], { part: (id: PartId) => id !== "showroom" }))).toBe("inbox");
  });

  it("is nowhere for somebody with nothing switched on", () => {
    expect(homeFor(facts(["crew"]))).toBe("myday");
    // With Jobs on site off, a crew member of stage 3 lands on his hours; with both of his parts off, nowhere.
    expect(homeFor(facts(["crew"], { part: (id: PartId) => id !== "jobs" }))).toBe("myhours");
    expect(homeFor(facts(["crew"], { part: (id: PartId) => id !== "jobs" && id !== "fleet" }))).toBeNull();
    expect(homeFor(facts(["front-desk"], { part: () => false }))).toBeNull();
  });
});

describe("an address", () => {
  it("names its screen and what follows it", () => {
    expect(routeForPath("pipeline/12", facts(["rep"]))).toEqual({ route: "pipeline", rest: ["12"] });
    expect(routeForPath("nowhere", facts(["rep"]))).toBeNull();
    expect(routeForPath("", facts(["rep"]))).toBeNull();
  });

  it("a company's page and its timeline are the Companies screen's, and Accounts is in the menus it is drawn in and no other", () => {
    expect(routeForPath("companies/4/timeline", facts(["rep"]))).toEqual({ route: "companies", rest: ["4", "timeline"] });
    expect(routeForPath("contacts/6", facts(["marketer"]))).toEqual({ route: "contacts", rest: ["6"] });
    for (const role of ["rep", "sales-manager", "admin", "account-manager", "marketer", "read-only"]) expect([role, inMenu("companies", [`crm-${role}`]), inMenu("contacts", [`crm-${role}`])]).toEqual([role, true, true]);
    for (const role of ["front-desk", "ops-manager", "crew"]) expect([role, inMenu("companies", [`crm-${role}`])]).toEqual([role, false]);
    // Paste a list: a rep, the sales manager and the CRM admin; nobody else's menu holds it.
    for (const role of ["rep", "sales-manager", "admin"]) expect([role, inMenu("import", [`crm-${role}`])]).toEqual([role, true]);
    for (const role of ["account-manager", "marketer", "read-only", "front-desk"]) expect([role, inMenu("import", [`crm-${role}`])]).toEqual([role, false]);
  });

  it("gives the shared home address to the home that is the person's", () => {
    expect(routeForPath("home", facts(["marketer"]))?.route).toBe("mkhome");
    expect(routeForPath("home", facts(["account-manager"]))?.route).toBe("amhome");
  });
});

describe("a person's own screens", () => {
  it("are everybody's, whatever their role, and need no part and no table", () => {
    for (const route of OWN) {
      expect([ROUTES[route].part, ROUTES[route].reads], route).toEqual([null, []]);
      for (const role of ROLE_ORDER) {
        expect(inMenu(route, [`crm-${role}`]), `${route} for ${role}`).toBe(true);
        expect(canOpen(route, facts([role], { part: () => false })), `${route} for ${role} with every part off`).toBe(true);
      }
      // The install's owner too.
      expect(inMenu(route, [])).toBe(true);
    }
  });

  it("puts her profile, her details and how she is told under her name, and keeps the digest out of the menu of a role with no summary", () => {
    expect(USER_MENU).toEqual(["me", "mydetails", "notifs"]);
    expect(routesOf(facts(["marketer"]))).not.toContain("digest");
    expect(routesOf(facts(["rep"]))).toContain("digest");
  });

  it("leaves the front desk on the Inbox at the first release, on her own home once the showroom is on, and the marketer on her home", () => {
    expect(homeFor(facts(["front-desk"], { part: (id) => id !== "showroom" }))).toBe("inbox");
    expect(homeFor(facts(["front-desk"]))).toBe("deskhome");
    expect(routeForPath("home", facts(["front-desk"]))?.route).toBe("deskhome");
    expect(homeFor(facts(["marketer"]))).toBe("mkhome");
    // With the Inbox off the marketer is left with Accounts, and the front desk (her showroom off too) with nothing.
    expect(homeFor(facts(["marketer"], { part: (id) => id !== "inbox" }))).toBe("companies");
    expect(homeFor(facts(["front-desk"], { part: (id) => id !== "inbox" && id !== "showroom" }))).toBeNull();
    // With the Inbox off and the showroom on, she still has her home.
    expect(homeFor(facts(["front-desk"], { part: (id) => id !== "inbox" }))).toBe("deskhome");
  });
});

describe("a part that waits for its add-on", () => {
  // Supply is built on Inventory: with the add-on not connected, the part is off and none of its tables reads.
  const off = (held: RoleKey[], waiting: boolean): MenuFacts => facts(held, { part: (id) => id !== "supply", waits: (id) => waiting && id === "supply", reads: (table) => table !== "deal_stock_needs" && !table.startsWith("inventory:") && facts(held).reads(table) });

  it("keeps Supply's lines in the menus of the roles it is for, each opening the page that says what it waits for", () => {
    for (const role of ["admin", "read-only", "ops-manager"] as const) {
      expect(routesOf(off([role], true)).filter((route) => ROUTES[route].part === "supply"), role).toEqual(["stock", "suppliers"]);
    }
    expect(routesOf({ roles: [], part: (id) => id !== "supply", waits: (id) => id === "supply", reads: () => false, built: () => true }).filter((route) => ROUTES[route].part === "supply")).toEqual(["stock", "suppliers"]);
    // Before Jobs on site, the operations manager has nothing else: her home is the page that says so, not "nothing is switched on".
    expect(homeFor({ ...off(["ops-manager"], true), part: (id) => id !== "supply" && id !== "jobs" })).toBe("stock");
    // With Jobs on site, her home is her own.
    expect(homeFor(off(["ops-manager"], true))).toBe("ophome");
  });

  it("takes them out when the part is simply switched off, and gives nobody else a line", () => {
    for (const role of ["admin", "read-only", "ops-manager"] as const) expect(routesOf(off([role], false)).some((route) => ROUTES[route].part === "supply"), role).toBe(false);
    for (const role of ["rep", "sales-manager", "account-manager", "marketer", "front-desk"] as const) expect(routesOf(off([role], true)).some((route) => ROUTES[route].part === "supply"), role).toBe(false);
  });

  it("is waiting only while the add-on is not attached and the part is off", async () => {
    const { waitsFor } = await import("./routes.ts");
    expect(waitsFor("supply", false, () => false)).toBe(true);
    expect(waitsFor("supply", false, (key) => key === "inventory")).toBe(false);
    expect(waitsFor("supply", true, () => false)).toBe(false);
    expect(waitsFor("inbox", false, () => false)).toBe(false);
  });

  it("opens Supply for the three roles it is for only with Inventory's tables to read", () => {
    for (const role of ["admin", "read-only", "ops-manager"] as const) expect([role, canOpen("stock", facts([role])), canOpen("suppliers", facts([role]))]).toEqual([role, true, true]);
    for (const role of ["rep", "sales-manager"] as const) expect([role, canOpen("suppliers", facts([role])), inMenu("stock", [`crm-${role}`])]).toEqual([role, false, false]);
  });
});
