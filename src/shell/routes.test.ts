/**
 * The menu, as a function of who is asking: the app's roles they hold, the
 * parts that are on, the tables they read, and which screens exist yet.
 */
import { describe, expect, it } from "vitest";

import manifest from "../../manifest.json";
import { canOpen, homeFor, HOMES, menuFor, MENUS, rolesOf, ROLE_ORDER, routeForPath, ROUTES, type MenuFacts, type PartId, type RoleKey, type RouteKey } from "./routes.ts";

type Role = { key: string; permissions: string[] };
const roles = (manifest as unknown as { roles: Role[] }).roles;
const tables = (manifest as unknown as { requiredSchema: { tables: { ref: string; module?: string }[] } }).requiredSchema.tables;
const parts = (manifest as unknown as { modules: { id: string }[] }).modules.map((part) => part.id);

/** What a person holding these roles is told, on an install with every part on and every screen built. */
function facts(held: RoleKey[], over: Partial<MenuFacts> = {}): MenuFacts {
  const grants = new Set(roles.filter((role) => held.includes(role.key as RoleKey)).flatMap((role) => role.permissions));
  return { roles: held.map((key) => `crm-${key}`), part: () => true, reads: (table) => grants.has(`table:@${table}:read`), built: () => true, ...over };
}
const routesOf = (f: MenuFacts): RouteKey[] => menuFor(f).flatMap((group) => group.items.map((item) => item.route));

describe("the table of screens", () => {
  it("names only parts and tables the manifest has", () => {
    for (const [key, def] of Object.entries(ROUTES)) {
      if (def.part !== null) expect(parts, key).toContain(def.part);
      for (const table of def.reads) expect(tables.map((t) => t.ref), `${key} reads ${table}`).toContain(table);
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
    expect([label("rep", "pipeline"), label("sales-manager", "pipeline"), label("account-manager", "pipeline")]).toEqual(["pipeline", "teamBoard", "dealsIAmOn"]);
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
    expect(routesOf(facts(["front-desk"]))).toEqual(["inbox"]);
    expect(routesOf(facts(["crew"]))).toEqual([]);
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

describe("where a person lands", () => {
  it("is the leading role's home", () => {
    expect(homeFor(facts(["rep"]))).toBe("today");
    expect(homeFor(facts(["rep", "sales-manager"]))).toBe("team");
    expect(homeFor(facts(["account-manager"]))).toBe("amhome");
  });

  it("is the first line they can open when the home's part is off or the home is not built", () => {
    expect(homeFor(facts(["marketer"], { part: (id: PartId) => id !== "inbox" }))).toBe("companies");
    expect(homeFor(facts(["rep"], { built: (route) => route !== "today" }))).toBe("week");
    // The front desk on the default install: the Inbox and nothing else.
    expect(homeFor(facts(["front-desk"]))).toBe("inbox");
  });

  it("is nowhere for somebody with nothing switched on", () => {
    expect(homeFor(facts(["crew"]))).toBeNull();
    expect(homeFor(facts(["front-desk"], { part: () => false }))).toBeNull();
  });
});

describe("an address", () => {
  it("names its screen and what follows it", () => {
    expect(routeForPath("pipeline/12", facts(["rep"]))).toEqual({ route: "pipeline", rest: ["12"] });
    expect(routeForPath("nowhere", facts(["rep"]))).toBeNull();
    expect(routeForPath("", facts(["rep"]))).toBeNull();
  });

  it("gives the shared home address to the home that is the person's", () => {
    expect(routeForPath("home", facts(["marketer"]))?.route).toBe("mkhome");
    expect(routeForPath("home", facts(["account-manager"]))?.route).toBe("amhome");
  });
});
