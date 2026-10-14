/**
 * P17, THE CONSOLE'S "SALES CRM" SECTION, as the manifest says it (design D10; ruling Q4 of the
 * plan's §0.16: "twelve items as drawn; a manifest option keeps a page off the rail. Rules = the
 * console's Automations for this app; Emails = the app's templates; Approvals = Quotes waiting;
 * Sample data = a link into the app's page in Installed Apps").
 *
 * Held here: the twelve entries in the drawn order, every other page off the rail; the Overview's
 * cards, each reading what its readers read, the two whole-team cards as `team-figures`; every
 * word of the two new pages in eight languages; stage 1 leaves out Jobs and its card and nothing
 * else. What each card answers each person is the server's: `proofs/crm-console.test.ts`, on three
 * engines.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error -- a plain script, shared with the release and the stand
import { readStages, readWhole, stageManifest } from "../../scripts/stage-manifest.mjs";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];

type Text = Record<string, string>;
interface Card {
  i: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: {
    title?: string;
    titles?: Text;
    subtitle?: string;
    subtitles?: Text;
    metricLabel?: string;
    metricLabels?: Text;
    emptyState?: { titleKey: string; titles?: Text };
    series?: { label: string; labels?: Text }[];
    metricFormat?: string;
    binding: { kind: string; source: { name: string }; shape: string; team?: { owner: string; target?: { table: string }; cover?: string[]; metric?: string }; filters?: unknown[]; window?: unknown };
  };
}
interface Page {
  ref: string;
  template: string;
  module?: string;
  title: { fallback: string };
  titles?: Text;
  nav: { group: string; icon: string; order: number; offRail?: true };
  config?: { layout?: { items: Card[]; toolbar?: { links?: { label: string; labels?: Text; href: string }[] } } };
}
interface NavLink {
  ref: string;
  label: Text;
  nav: { group: string; order: number };
  to: { screen?: string; side?: string };
  module?: string;
}
interface Doc {
  pages: Page[];
  navGroups: { key: string }[];
  navLinks?: NavLink[];
  roles: { key: string; permissions: string[] }[];
  requiredSchema: { tables: { ref: string; columns: { ref: string; rules?: { staff?: boolean } }[] }[] };
}

const whole = readWhole() as Doc;
const stage1 = (stageManifest(readWhole(), readStages(), 1) as { manifest: Doc }).manifest;
const rail = (doc: Doc) => [...doc.pages.filter((page) => page.nav.offRail !== true)].sort((a, b) => a.nav.order - b.nav.order);
const page = (doc: Doc, ref: string): Page => doc.pages.find((one) => one.ref === ref)!;
const inEight = (english: string | undefined, others: Text | undefined, what: string): void => {
  const all: Text = { "en-US": english ?? "", ...(others ?? {}) };
  for (const locale of LOCALES) expect((all[locale] ?? "").trim(), `${what} in ${locale}`).not.toBe("");
};

describe("the console's Sales CRM section", () => {
  it("lists the twelve entries drawn, in order: nine pages with no heading, then Rules, Emails and Sample data under Setup", () => {
    expect(rail(whole).map((one) => one.title.fallback)).toEqual(["Overview", "Pipeline", "Deals", "Companies", "Contacts", "Quotes", "Approvals", "Enquiries", "Jobs"]);
    // No heading for the first run: its group is one the manifest does not declare, so the console lists it first.
    for (const one of rail(whole)) expect(one.nav.group, one.ref).toBe("console");
    expect(whole.navGroups.map((group) => group.key)).not.toContain("console");
    expect((whole.navLinks ?? []).map((link) => [link.ref, link.nav.group, link.to])).toEqual([
      ["rules", "setup", { screen: "automations" }],
      ["emails", "setup", { screen: "email-templates" }],
      ["sample-data", "setup", { screen: "settings" }],
    ]);
    for (const link of whole.navLinks ?? []) inEight(link.label["en-US"], link.label, link.ref);
  });

  it("keeps every other page off the rail, each still a page with its address", () => {
    const off = whole.pages.filter((one) => one.nav.offRail === true);
    expect(off.length).toBe(whole.pages.length - 9);
    // The outbox is no longer "Emails" on the rail: Emails is the app's templates (ruling Q4).
    expect(page(whole, "crm-outbox").nav.offRail).toBe(true);
    expect(page(whole, "crm-stages").nav.offRail).toBe(true);
  });

  it("stage 1 leaves out Jobs, its page and its Overview card, and nothing else of the section", () => {
    expect(rail(stage1).map((one) => one.title.fallback)).toEqual(["Overview", "Pipeline", "Deals", "Companies", "Contacts", "Quotes", "Approvals", "Enquiries"]);
    expect((stage1.navLinks ?? []).map((link) => link.ref)).toEqual(["rules", "emails", "sample-data"]);
    const cards = (doc: Doc) => (page(doc, "crm-overview").config?.layout?.items ?? []).map((card) => card.i);
    expect(cards(whole).filter((one) => !cards(stage1).includes(one))).toEqual(["jobs-this-week"]);
    expect(JSON.stringify(page(stage1, "crm-overview"))).not.toContain("job_visits");
  });
});

describe("the Overview (D10)", () => {
  const overview = page(whole, "crm-overview");
  const cards = overview.config!.layout!.items;
  const byKey = Object.fromEntries(cards.map((card) => [card.i, card]));

  it("is a page of cards in the Selling part, opened by the CRM admin, the sales manager and Read-only", () => {
    expect([overview.template, overview.module, overview.nav.order]).toEqual(["page-dashboard", "selling", 0]);
    inEight(overview.title.fallback, overview.titles, "the title");
    for (const role of whole.roles) expect([role.key, role.permissions.includes("page:@crm-overview:view")]).toEqual([role.key, ["admin", "sales-manager", "read-only"].includes(role.key)]);
    expect(overview.config!.layout!.toolbar!.links!.map((link) => link.href)).toEqual(["@staff"]);
  });

  it("asks for the drawn figures, the two whole-team ones as the whole team's or none", () => {
    expect(cards.map((card) => card.i)).toEqual(["open-pipeline", "weighted", "won-this-year", "team-cover", "open-deals", "unclaimed-enquiries", "jobs-this-week", "by-stage", "forecast", "reps", "sitting"]);
    // Ordinary cards answer each reader their own rows; the cover and the reps table are `team-figures`: whole or refused.
    expect(cards.filter((card) => card.config.binding.kind === "team-figures").map((card) => card.i)).toEqual(["team-cover", "reps"]);
    for (const key of ["team-cover", "reps"]) {
      const team = byKey[key]!.config.binding.team!;
      expect([team.owner, team.target?.table, team.cover], key).toEqual(["owner_id", "targets", ["weighted", "booked"]]);
    }
    expect(byKey["team-cover"]!.config.binding.team!.metric).toBe("cover");
    expect(byKey["team-cover"]!.config.metricFormat).toBe("percent");
    // "This year" is the calendar year where the business is, never a date written into the page.
    expect(byKey["won-this-year"]!.config.binding.window).toEqual({ column: "closed_on", last: 1, unit: "year", calendar: true });
    // Each card on the 12-column grid, none over another.
    const cells = new Set<string>();
    for (const card of cards) {
      expect(card.x + card.w, card.i).toBeLessThanOrEqual(12);
      for (let x = card.x; x < card.x + card.w; x += 1) for (let y = card.y; y < card.y + card.h; y += 1) {
        expect(cells.has(`${String(x)},${String(y)}`), `${card.i} over another at ${String(x)},${String(y)}`).toBe(false);
        cells.add(`${String(x)},${String(y)}`);
      }
    }
  });

  it("reads only tables every role that opens it reads, by the staff column that says whose a row is", () => {
    const tables = new Set(whole.requiredSchema.tables.map((table) => table.ref));
    for (const card of cards) expect(tables.has(card.config.binding.source.name), card.i).toBe(true);
    const staff = (table: string, column: string) => whole.requiredSchema.tables.find((one) => one.ref === table)!.columns.find((one) => one.ref === column)?.rules?.staff === true;
    expect(staff("deals", "owner_id") && staff("targets", "rep_id")).toBe(true);
    for (const role of whole.roles.filter((one) => one.permissions.includes("page:@crm-overview:view"))) {
      for (const table of ["deals", "enquiries", "targets", "stages", "companies"]) expect(role.permissions, `${role.key} ${table}`).toContain(`table:@${table}:read`);
    }
  });

  it("says every card's words in eight languages", () => {
    for (const card of cards) {
      inEight(card.config.title, card.config.titles, `${card.i} title`);
      if (card.config.subtitle !== undefined) inEight(card.config.subtitle, card.config.subtitles, `${card.i} subtitle`);
      if (card.config.metricLabel !== undefined) inEight(card.config.metricLabel, card.config.metricLabels, `${card.i} caption`);
      if (card.config.emptyState !== undefined) inEight(card.config.emptyState.titleKey, card.config.emptyState.titles, `${card.i} empty`);
      for (const one of card.config.series ?? []) inEight(one.label, one.labels, `${card.i} series`);
    }
    for (const link of overview.config!.layout!.toolbar!.links!) inEight(link.label, link.labels, "the toolbar's link");
  });
});

describe("Approvals (ruling Q4: Quotes waiting)", () => {
  const approvals = page(whole, "crm-approvals");

  it("is a page of the Quotes part, gone with it, for the CRM admin, the sales manager and Read-only", () => {
    expect([approvals.template, approvals.module, approvals.nav.order]).toEqual(["page-dashboard", "quotes", 6]);
    inEight(approvals.title.fallback, approvals.titles, "the title");
    for (const role of whole.roles) expect([role.key, role.permissions.includes("page:@crm-approvals:view")]).toEqual([role.key, ["admin", "sales-manager", "read-only"].includes(role.key)]);
    const cards = approvals.config!.layout!.items;
    expect(cards.map((card) => [card.i, card.config.binding.source.name, card.config.binding.filters])).toEqual([
      ["waiting", "quotes", [{ column: "approval", op: "eq", value: "asked" }]],
      ["running-out", "quotes", [{ column: "status", op: "eq", value: "sent" }]],
    ]);
    for (const card of cards) {
      inEight(card.config.title, card.config.titles, `${card.i} title`);
      inEight(card.config.subtitle, card.config.subtitles, `${card.i} subtitle`);
      inEight(card.config.emptyState?.titleKey, card.config.emptyState?.titles, `${card.i} empty`);
    }
  });
});
