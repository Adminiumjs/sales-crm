/**
 * The rows the app's tables hold from the first second (`seeds`).
 *
 * There is one: the settings row. A snag's due day is "raised on, plus the
 * setting", an approval reads the threshold, so an install with no sample
 * needs the row before anybody has opened a page, and no role of the app may
 * make it (they read and change it). It is a row of defaults: what an owner
 * finds is what the manifest's columns say, nothing of the sample's.
 *
 * That a server writes it at install, once, and leaves a row the owner
 * changed alone is proved on three engines, against an install, in the
 * engine's repo.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";

interface Column {
  ref: string;
  nullable?: boolean;
  default?: unknown;
  role?: string;
}
const doc = manifest as unknown as {
  seeds?: { table: string; rows?: Record<string, unknown>[]; file?: string }[];
  requiredSchema: { tables: { ref: string; columns: Column[] }[] };
  roles: { key: string; permissions: string[] }[];
};

describe("the app's starting rows", () => {
  it("are the settings row and nothing else, written as a row of defaults", () => {
    expect(doc.seeds).toEqual([{ table: "settings", rows: [{}] }]);
  });

  it("every setting has a default or may be empty, so the row of defaults can be written", () => {
    const settings = doc.requiredSchema.tables.find((table) => table.ref === "settings")!;
    const stuck = settings.columns.filter((column) => column.role !== "pk" && column.default === undefined && column.nullable !== true).map((column) => column.ref);
    expect(stuck).toEqual([]);
    expect(settings.columns.length).toBeGreaterThan(20);
  });

  it("no role makes or removes a settings row: the install's is the only one", () => {
    const writers = doc.roles.filter((role) => role.permissions.some((permission) => permission === "table:@settings:create" || permission === "table:@settings:delete")).map((role) => role.key);
    expect(writers).toEqual([]);
  });
});
