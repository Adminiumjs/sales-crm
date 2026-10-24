import { describe, expect, it } from "vitest";

import manifest from "../../../whole/manifest.json";
import { StaffError } from "../../staffSession.ts";
import { pairWords, PAIRS, withPairWords } from "./pairs.ts";

const refusal = (fields: Record<string, string>) => new StaffError(422, "VALIDATION_FAILED", "Some values were refused.", { fields: Object.fromEntries(Object.entries(fields).map(([column, code]) => [column, { code }])) });

describe("Settings' pairs (plan 68 X4)", () => {
  it("are the pairs the manifest holds, each kept strictly below its partner", () => {
    const settings = (manifest as unknown as { requiredSchema: { tables: { ref: string; columns: { ref: string; rules?: { notAfter?: unknown } }[] }[] } }).requiredSchema.tables.find((table) => table.ref === "settings")!;
    const held = settings.columns.filter((column) => column.rules?.notAfter !== undefined).map((column) => [column.ref, column.rules!.notAfter]);
    const byName = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
    expect(held.sort(byName)).toEqual(PAIRS.map(([own, other]) => [own, { column: other, strict: true }]).sort(byName));
  });

  it("names both settings when the server refuses both, and passes every other refusal on", async () => {
    expect(pairWords(refusal({ sitting_warm_days: "out-of-range", sitting_stale_days: "out-of-range" }))).toBe("guards.pair.sitting");
    expect(pairWords(refusal({ work_from: "out-of-range", work_to: "out-of-range" }))).toBe("guards.pair.work");
    expect(pairWords(refusal({ sitting_warm_days: "out-of-range" }))).toBeNull();
    expect(pairWords(refusal({ depot_country: "invalid-option" }))).toBe("guards.country.unknown");
    const said = await withPairWords(Promise.resolve({ state: "refused" as const, error: refusal({ showroom_opens: "out-of-range", showroom_closes: "out-of-range" }) }), (key) => `words of ${key}`);
    expect(said.state === "refused" && said.error.message).toBe("words of guards.pair.showroom");
    const other = refusal({ quote_valid_days: "out-of-range" });
    expect(await withPairWords(Promise.resolve({ state: "refused" as const, error: other }), (key) => key)).toEqual({ state: "refused", error: other });
  });
});
