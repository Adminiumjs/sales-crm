/**
 * THE APP BY STAGE (`scripts/stage-manifest.mjs`, `stage.json`).
 *
 * A release ships the parts that have screens and no others (ruling R5): the
 * rest are not in the file, so an owner cannot tick them and their roles are
 * not offered. Held here:
 *
 *  - the last stage is the whole app, byte for byte, and every stage is a
 *    subset of the next;
 *  - every stage passes the validator Adminium runs;
 *  - stage 1 is the six parts, with no Field crew and nothing that points at
 *    a table it does not have: no column, no right, no page, no rule, no
 *    sample row;
 *  - what sits at the repo's root (`manifest.json`, `seeds/`) is the released
 *    stage as the whole derives it today.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- a plain script, shared with the release and the stand
import { partsOf, readStages, readWhole, stageFiles, stageManifest } from "../../scripts/stage-manifest.mjs";
import { MENUS, ROUTES, type RoleKey } from "../shell/routes.ts";
import { validateManifest } from "./manifest/index.ts";

interface Column {
  ref: string;
  references?: string;
  rules?: unknown;
}
interface Doc {
  version: string;
  modules: { id: string }[];
  requiredSchema: { tables: { ref: string; module?: string; columns: Column[]; indexes?: string[][] }[] };
  roles: { key: string; modules: string[]; permissions: string[]; limits?: Record<string, { readable?: string[]; writable?: string[]; creatable?: string[] }> }[];
  pages: { ref: string; module?: string; bindings?: Record<string, unknown> }[];
  automations: { key: string }[];
  sampleData: { file: string; people: { key: string; role: string }[]; addOns?: Record<string, { file: string }> };
}
interface Sample {
  tables: { ref: string; rows: Record<string, unknown>[] }[];
  assets?: Record<string, { file: string }>;
}
interface Stage {
  manifest: Doc;
  files: Record<string, string | Buffer>;
  cut: { tables: string[]; columns: Record<string, string[]>; pages: string[]; rules: string[]; roles: string[] };
}

const ROOT = join(__dirname, "..", "..");
const stages = readStages() as { released: number; stages: Record<string, string[]> };
const whole = readWhole() as Doc;
const stage = (n: number): Stage => stageFiles(n, stages, whole) as Stage;
const sampleOf = (s: Stage): Sample => JSON.parse(String(s.files[s.manifest.sampleData.file])) as Sample;
const numbers = Object.keys(stages.stages).map(Number).sort((a, b) => a - b);
const last = numbers[numbers.length - 1]!;

describe("the stages", () => {
  it("name every part of the app once, and release a stage that exists", () => {
    const named = numbers.flatMap((n) => stages.stages[String(n)]!);
    expect([...named].sort()).toEqual(whole.modules.map((part) => part.id).sort());
    expect(new Set(named).size).toBe(named.length);
    expect(numbers).toContain(stages.released);
    expect(partsOf(stages, 1)).toEqual(["selling", "quotes", "accounts", "team", "inbox", "supply"]);
  });

  it("the last stage is the whole app, byte for byte: manifest, sample and its files", () => {
    const all = stage(last);
    expect(JSON.parse(String(all.files["manifest.json"]))).toEqual(whole);
    for (const [path, content] of Object.entries(all.files)) {
      if (path === "manifest.json") continue;
      expect(Buffer.from(content).equals(readFileSync(join(ROOT, "whole", path))), path).toBe(true);
    }
    expect(all.cut).toEqual({ parts: [], tables: [], columns: {}, pages: [], rules: [], roles: [] });
  });

  it.each(numbers)("stage %i passes the validator Adminium runs", (n) => {
    const result = validateManifest(stage(n).manifest);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it("each stage is a subset of the next: nothing is renamed or reworded on the way", () => {
    for (const n of numbers.slice(0, -1)) {
      const now = stage(n).manifest;
      const next = stage(n + 1).manifest;
      for (const table of now.requiredSchema.tables) {
        const later = next.requiredSchema.tables.find((one) => one.ref === table.ref);
        expect(later, table.ref).toBeDefined();
        for (const column of table.columns) expect(later!.columns.find((one) => one.ref === column.ref), `${table.ref}.${column.ref}`).toEqual(column);
      }
      for (const role of now.roles) {
        const later = next.roles.find((one) => one.key === role.key)!;
        for (const permission of role.permissions) expect(later.permissions, `${role.key}: ${permission}`).toContain(permission);
      }
      for (const page of now.pages) expect(next.pages.find((one) => one.ref === page.ref), page.ref).toEqual(page);
    }
  });
});

describe("stage 1, the first release", () => {
  const one = stage(1);
  const doc = one.manifest;
  const tables = new Set(doc.requiredSchema.tables.map((table) => table.ref));
  const gone = whole.requiredSchema.tables.filter((table) => !tables.has(table.ref)).map((table) => table.ref);

  it("holds six parts, 47 tables, and offers no Field crew", () => {
    expect(doc.modules.map((part) => part.id)).toEqual(["selling", "quotes", "accounts", "team", "inbox", "supply"]);
    expect(doc.requiredSchema.tables.length).toBe(47);
    expect(gone.length).toBe(28);
    expect(doc.roles.map((role) => role.key)).toEqual(["admin", "sales-manager", "rep", "account-manager", "marketer", "front-desk", "ops-manager", "read-only"]);
    expect(one.cut.roles).toEqual(["crew"]);
    // Each role keeps only the parts this stage has; the operations manager is left with Supply, the front desk with the Inbox.
    for (const role of doc.roles) for (const part of role.modules) expect(doc.modules.map((p) => p.id), `${role.key}: ${part}`).toContain(part);
    expect(doc.roles.find((role) => role.key === "ops-manager")!.modules).toEqual(["supply"]);
    expect(doc.roles.find((role) => role.key === "front-desk")!.modules).toEqual(["inbox"]);
  });

  it("names no table it does not have: not in a column, an index, a right, a column list, a page or a rule", () => {
    const text = JSON.stringify(doc);
    for (const ref of gone) {
      expect(text.includes(`"references":"${ref}"`), `a link to ${ref}`).toBe(false);
      expect(text.includes(`table:@${ref}:`), `a right on ${ref}`).toBe(false);
      expect(text.includes(`"table":"${ref}"`), `a mention of ${ref}`).toBe(false);
      expect(text.includes(`"from":"${ref}"`), `a figure from ${ref}`).toBe(false);
    }
    // The one column of a kept table that pointed into a later part: a follow-up's job.
    expect(one.cut.columns).toEqual({ follow_ups: ["job_id"] });
    const followUps = doc.requiredSchema.tables.find((table) => table.ref === "follow_ups")!;
    expect(followUps.columns.map((column) => column.ref)).not.toContain("job_id");
    expect((followUps.indexes ?? []).flat()).not.toContain("job_id");
    for (const role of doc.roles) for (const list of Object.values(role.limits?.["follow_ups"] ?? {})) if (Array.isArray(list)) expect(list, role.key).not.toContain("job_id");
    const pages = new Set(doc.pages.map((page) => page.ref));
    for (const role of doc.roles) for (const permission of role.permissions) if (permission.startsWith("page:@")) expect(pages.has(permission.split(":")[1]!.slice(1)), `${role.key}: ${permission}`).toBe(true);
    // The rule that makes a job of a won deal belongs to Jobs on site: it is not here to run.
    expect(doc.automations.map((rule) => rule.key)).not.toContain("deal-won-job");
    expect(one.cut.rules).toEqual(["deal-won-job"]);
  });

  it("its sample holds rows of its own tables only, every link of which lands, and no person of a role it lacks", () => {
    const sample = sampleOf(one);
    const columns = new Map(doc.requiredSchema.tables.map((table) => [table.ref, new Set(table.columns.map((column) => column.ref))]));
    const labels = new Set<string>();
    for (const table of sample.tables) for (const row of table.rows) if (typeof row["@label"] === "string") labels.add(row["@label"]);
    const people = new Set(doc.sampleData.people.map((person) => person.key));
    const missing: string[] = [];
    for (const table of sample.tables) {
      expect(tables.has(table.ref), table.ref).toBe(true);
      for (const row of table.rows) {
        for (const [column, value] of Object.entries(row)) {
          if (!column.startsWith("@") && !columns.get(table.ref)!.has(column)) missing.push(`${table.ref}.${column}`);
          if (value !== null && typeof value === "object") {
            const ref = (value as Record<string, unknown>)["@ref"];
            const person = (value as Record<string, unknown>)["@person"];
            if (typeof ref === "string" && !labels.has(ref)) missing.push(`${table.ref}.${column} → ${ref}`);
            if (typeof person === "string" && !people.has(person)) missing.push(`${table.ref}.${column} → person ${person}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
    expect(doc.sampleData.people.map((person) => person.role)).not.toContain("crew");
    expect(doc.sampleData.people.length).toBe(11);
    // The aftercare calls are After the job's: none here. The selling follow-ups are all here.
    const followUps = sample.tables.find((table) => table.ref === "follow_ups")!.rows;
    expect(followUps.filter((row) => row["kind"] === "aftercare")).toEqual([]);
    expect(followUps.length).toBeGreaterThan(0);
    // The ledger's selling figures do not move: 14 open deals, 26 closed.
    const deals = sample.tables.find((table) => table.ref === "deals")!.rows;
    expect([deals.filter((deal) => deal["state"] === "open").length, deals.filter((deal) => deal["state"] !== "open").length]).toEqual([14, 26]);
    // Supply's stock comes with it (the Inventory add-on's sample file); the crew's signature picture does not.
    expect(doc.sampleData.addOns).toEqual({ inventory: { file: "seeds/meridian.inventory.json" } });
    expect(sample.assets).toBeUndefined();
  });

  it("every screen its menus hold reads tables it has", () => {
    const parts = new Set(doc.modules.map((part) => part.id));
    const missing: string[] = [];
    for (const [role, groups] of Object.entries(MENUS) as [RoleKey, (typeof MENUS)[RoleKey]][]) {
      for (const [, items] of groups) {
        for (const item of items) {
          const route = ROUTES[item.route];
          if (route.part !== null && !parts.has(route.part)) continue;
          for (const table of route.reads) if (!tables.has(table)) missing.push(`${role}: ${item.route} reads ${table}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("what sits at the repo's root", () => {
  const listed = (dir: string, under = ""): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? listed(join(dir, name), `${under}${name}/`) : [`${under}${name}`])) : []);

  it("is the released stage as the whole derives it today (run `npm run stage` after changing whole/)", () => {
    const released = stage(stages.released);
    for (const [path, content] of Object.entries(released.files)) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
      expect(Buffer.from(content).equals(readFileSync(join(ROOT, path))), path).toBe(true);
    }
    expect(listed(join(ROOT, "seeds"), "seeds/").sort()).toEqual(Object.keys(released.files).filter((path) => path.startsWith("seeds/")).sort());
  });

  it("carries the whole app's version: a stage is the same app, with fewer parts", () => {
    expect((stageManifest(whole, stages, stages.released) as { manifest: Doc }).manifest.version).toBe(whole.version);
  });
});
