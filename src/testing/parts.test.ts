/**
 * The ten parts of `manifest.json`, and what belongs to each.
 *
 * The validator checks that a part named anywhere is a part the app has. It
 * does not know which part a table belongs to, which roles work in it, or
 * that the app must still stand without Invoices & Receipts. That is here.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";
import { validateManifest } from "./manifest/index.ts";
import { modulesLeftOut, optionalShapeAddOns, tablesLeftOut, withoutModules } from "./manifest/modules.ts";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];

/** Each part, how it starts, and the feature it waits for. */
const PARTS: [id: string, start: "always" | "on" | "off", feature?: string][] = [
  ["selling", "always"],
  ["quotes", "on", "quotes"],
  ["accounts", "always"],
  ["team", "always"],
  ["inbox", "on"],
  ["showroom", "off"],
  ["jobs", "off"],
  ["aftercare", "off"],
  ["supply", "on", "supply"],
  ["fleet", "off"],
];
const ALL = PARTS.map(([id]) => id);

/** The parts each role works in. A role is offered while any of them is on. */
const ROLE_PARTS: Record<string, string[]> = {
  admin: ALL,
  "sales-manager": ["selling", "quotes", "accounts", "team", "inbox"],
  rep: ["selling", "quotes", "accounts", "team", "inbox"],
  "account-manager": ["accounts", "aftercare"],
  marketer: ["accounts", "inbox"],
  "front-desk": ["inbox", "showroom"],
  "ops-manager": ["jobs", "supply", "fleet"],
  crew: ["jobs", "fleet"],
  "read-only": ALL,
};

type Table = { ref: string; module?: string; builtOn?: string; columns: { ref: string; type: string; references?: string; rules?: Record<string, unknown> }[] };
type Page = { ref: string; module?: string; nav: { group: string }; bindings: Record<string, string> };
type Role = { key: string; name: string; names?: Record<string, string>; modules?: string[]; permissions: string[]; limits?: Record<string, unknown> };
const tables = manifest.requiredSchema.tables as unknown as Table[];
const pages = manifest.pages as unknown as Page[];
const roles = manifest.roles as unknown as Role[];
const modules = (manifest as unknown as { modules: { id: string; label: Record<string, string>; default: string; feature?: string }[] }).modules;

describe("the app is made of ten parts", () => {
  it("declares them in the menu's order, each with the start it is meant to have", () => {
    expect(modules.map((part) => [part.id, part.default, ...(part.feature === undefined ? [] : [part.feature])])).toEqual(PARTS.map((part) => [...part]));
  });

  it("names each part in eight languages", () => {
    for (const part of modules) expect(Object.keys(part.label).sort(), part.id).toEqual([...LOCALES].sort());
  });

  it("keeps a feature for each part that waits for an add-on, and only suggests the add-ons", () => {
    const features = (manifest.addOns as unknown as { features: { id: string; requires: string[] }[] }).features;
    expect(features.map((feature) => [feature.id, feature.requires])).toEqual([
      ["quotes", ["invoices"]],
      ["supply", ["inventory"]],
    ]);
    expect((manifest.addOns as { requires?: unknown }).requires).toBeUndefined();
    expect(manifest.addOns.suggests.map((need) => [need.key, (need as { checked?: boolean }).checked === true])).toEqual([
      ["invoices", true],
      ["inventory", true],
      ["offers", false],
    ]);
  });
});

describe("every table and page is in the part of its menu heading", () => {
  const headingOf = new Map(pages.map((page) => [Object.values(page.bindings)[0]!, page.nav.group]));

  it("puts the two quote tables and the price list they read in the part of their own, and every other table in its heading's part", () => {
    // Only a quote's line reads a price: with no quotes the price list would be a page nothing uses.
    const ofQuotes = ["quotes", "quote_lines", "price_list", "deal_amount_changes"];
    for (const table of tables) {
      const heading = headingOf.get(table.ref);
      const expected = ofQuotes.includes(table.ref) ? "quotes" : heading === "setup" ? undefined : heading;
      expect(table.module, table.ref).toBe(expected);
    }
  });

  it("puts each page in its table's part", () => {
    const partOf = new Map(tables.map((table) => [table.ref, table.module]));
    for (const page of pages) expect(page.module, page.ref).toBe(partOf.get(Object.values(page.bindings)[0]!));
  });

  it("leaves the app's settings and its outgoing e-mails in no part: they are always there", () => {
    expect(tables.filter((table) => table.module === undefined).map((table) => table.ref).sort()).toEqual(["outbox", "settings"]);
  });
});

describe("every role names the parts it works in, and is named in eight languages", () => {
  it("gives each role its parts", () => {
    expect(Object.fromEntries(roles.map((role) => [role.key, role.modules]))).toEqual(ROLE_PARTS);
  });

  it("offers a role with no part that is always on only when one of its parts is switched on", () => {
    const always = new Set(PARTS.filter(([, start]) => start === "always").map(([id]) => id));
    const waits = roles.filter((role) => !role.modules!.some((id) => always.has(id))).map((role) => role.key);
    // The front desk has the inbox (on at install); operations and the crew wait for jobs or vehicles.
    expect(waits).toEqual(["front-desk", "ops-manager", "crew"]);
  });

  it("names each role in the seven other languages, with the English as its name", () => {
    for (const role of roles) {
      expect(Object.keys(role.names ?? {}).sort(), role.key).toEqual(LOCALES.filter((locale) => locale !== "en-US").sort());
      for (const text of Object.values(role.names ?? {})) expect(text.length, role.key).toBeGreaterThan(0);
    }
  });
});

describe("the shipped rules and e-mails are in the part they work for", () => {
  it("puts each rule in a part", () => {
    expect((manifest.automations as unknown as { key: string; module?: string }[]).map((rule) => [rule.key, rule.module])).toEqual([
      ["deal-made", "selling"],
      ["deal-stage-changed", "selling"],
      // A won deal makes a job only where jobs on site are done at all.
      ["deal-won-job", "jobs"],
      // The amount line is written when a quote is sent: no quotes, no line.
      ["quote-sent-amount", "quotes"],
      ["approval-asked", "quotes"],
      ["nudge-quiet", "selling"],
      ["nudge-stuck", "selling"],
      ["nudge-soon", "selling"],
      ["follow-up-due", "selling"],
      // What is said about a quote is said only while quotes are on.
      ["quote-runs-out", "quotes"],
      ["deal-handed-over", "selling"],
      ["approval-given", "quotes"],
      ["approval-refused", "quotes"],
      ["week-rep", "selling"],
      ["week-manager", "selling"],
    ]);
  });

  it("queues the quote's e-mail only while quotes are on", () => {
    expect((manifest.outbox.producers as unknown as { kind: string; module?: string }[]).map((producer) => [producer.kind, producer.module])).toEqual([["quote-sent", "quotes"], ["quote-accepted", "quotes"]]);
  });
});

describe("the app stands without Invoices & Receipts", () => {
  it("leaves the quotes part out, and nothing else", () => {
    expect([...optionalShapeAddOns(manifest)]).toEqual([["invoices", ["quotes"]]]);
    expect(modulesLeftOut(manifest, (addOn) => addOn !== "invoices")).toEqual(["quotes"]);
    expect(modulesLeftOut(manifest, () => true)).toEqual([]);
    expect([...tablesLeftOut(manifest, ["quotes"])].sort()).toEqual(["deal_amount_changes", "price_list", "quote_lines", "quotes"]);
  });

  it("is a whole manifest with the part left out", () => {
    const left = withoutModules(manifest, ["quotes"]) as unknown as typeof manifest;
    const result = validateManifest(left);
    expect(result.ok ? [] : result.issues).toEqual([]);
    const kept = left.requiredSchema.tables as unknown as Table[];
    expect(kept).toHaveLength(tables.length - 4);
    // A deal's quoted amount is a plain, empty column until quotes are there.
    const quoted = kept.find((table) => table.ref === "deals")!.columns.find((column) => column.ref === "quoted_amount")!;
    expect(quoted.rules?.["rollup"]).toBeUndefined();
    // The outgoing e-mails lose their link to a quote, and the quote's own e-mail.
    expect(kept.find((table) => table.ref === "outbox")!.columns.map((column) => column.ref)).not.toContain("quote_id");
    expect(left.outbox.producers).toEqual([]);
    expect(Object.keys(left.outbox.kinds)).toEqual(["handover-intro", "approval-asked"]);
    expect((left.pages as unknown as Page[]).filter((page) => page.ref.includes("quote"))).toEqual([]);
    expect((left.automations as unknown as { key: string }[]).map((rule) => rule.key)).toEqual(["deal-made", "deal-stage-changed", "deal-won-job", "nudge-quiet", "nudge-stuck", "nudge-soon", "follow-up-due", "deal-handed-over", "week-rep", "week-manager"]);
    // Every role is still there, without a grant, a limit or a part that names quotes.
    const leftRoles = left.roles as unknown as Role[];
    expect(leftRoles.map((role) => role.key)).toEqual(roles.map((role) => role.key));
    for (const role of leftRoles) {
      expect(role.permissions.filter((grant) => grant.includes("quote")), role.key).toEqual([]);
      expect(Object.keys(role.limits ?? {}).filter((ref) => ref.startsWith("quote")), role.key).toEqual([]);
      expect(role.modules, role.key).not.toContain("quotes");
    }
  });
});
