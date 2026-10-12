/**
 * The quote tables, held to the shape they are built on and to the sums the
 * plan says they keep.
 *
 * `quotes` and `quote_lines` are built on the quote shape of Invoices &
 * Receipts. The validator checks the manifest alone; whether a table really is
 * what its part says is checked at install, against the add-on. That check is
 * a pure function the vendored validator carries, so it runs here against a
 * copy of the shape (`shapes/invoices-quote.json`), and a mismatch fails this
 * suite long before an install would refuse it.
 *
 * The sums are worked out with the product's own arithmetic (`evaluateFormula`
 * and `rollupValue`, the functions the server calls), over the rules as the
 * manifest writes them. That proves what the rules say. That a database keeps
 * them in step is the install proof's, on three engines, in the engine's repo.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "../../manifest.json";
import { evaluateFormula, rollupValue, type FormulaExpr } from "./manifest/formula.ts";
import { shapeConformanceIssues, shapeKey, validateManifest, type ShapeDefinitionView } from "./manifest/index.ts";
import SHAPES from "./shapes/invoices-quote.json";

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE MANIFEST, READ LOOSELY                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

interface Rollup {
  from: string;
  via: string;
  sum?: string;
  latest?: { of: string; by: string; row?: string };
  unlessSet?: string;
}

interface Column {
  ref: string;
  type: string;
  references?: string;
  nullable?: boolean;
  scale?: number | "currency";
  rules?: { formula?: FormulaExpr; rollup?: Rollup; stamp?: { set: unknown; on: unknown }; default?: { from: unknown } };
}

interface Move {
  to: string;
  requires?: { where?: { column: string }[] };
}

interface Action {
  id: string;
  set?: Record<string, unknown>;
  in?: string[];
  ask?: string[];
}

interface Table {
  ref: string;
  builtOn?: string;
  part?: string;
  columns: Column[];
  states?: { moves: Record<string, (string | Move)[]>; lock?: { when: string[]; except?: string[] }; actions?: Action[] };
}

type Row = Record<string, unknown>;

const tables = manifest.requiredSchema.tables as unknown as Table[];

function table(ref: string): Table {
  const found = tables.find((t) => t.ref === ref);
  if (found === undefined) throw new Error(`the manifest has no table "${ref}"`);
  return found;
}

function column(tableRef: string, ref: string): Column {
  const found = table(tableRef).columns.find((c) => c.ref === ref);
  if (found === undefined) throw new Error(`"${tableRef}" has no column "${ref}"`);
  return found;
}

/** The sample's money has two decimal places (GBP); a column says its own otherwise. */
const places = (c: Column): number => (typeof c.scale === "number" ? c.scale : c.type === "int" ? 0 : 2);

/** A column's formula, worked out over a row as the server works it out. */
function formula(tableRef: string, ref: string, row: Row): string | null {
  const c = column(tableRef, ref);
  if (c.rules?.formula === undefined) throw new Error(`"${tableRef}.${ref}" has no formula`);
  return evaluateFormula(c.rules.formula, row, places(c));
}

/** A column's total over child rows, as the server adds it up. */
function total(tableRef: string, ref: string, rows: readonly Row[]): string {
  const c = column(tableRef, ref);
  const rollup = c.rules?.rollup;
  if (rollup?.sum === undefined) throw new Error(`"${tableRef}.${ref}" adds nothing up`);
  return rollupValue(rows, { sum: rollup.sum }, places(c));
}

/** A line as the manifest's rules leave it: its amount and its list amount worked out. */
function line(typed: Row): Row {
  const row: Row = { discount_kind: "amount", discount: null, list_rate: null, ...typed };
  row["amount"] = formula("quote_lines", "amount", row);
  row["list_amount"] = formula("quote_lines", "list_amount", row);
  return row;
}

/** A version as the manifest's rules leave it, from its lines and what a person typed. */
function version(lines: readonly Row[], typed: Row = {}): Row {
  const row: Row = { tax_rate: 20, threshold_pct: 5, approval: "none", ...typed };
  row["subtotal"] = total("quotes", "subtotal", lines);
  row["list_value"] = total("quotes", "list_value", lines);
  for (const ref of ["tax", "total", "under_list_pct", "needs_approval", "may_send"]) row[ref] = formula("quotes", ref, row);
  return row;
}

const shapes = new Map(
  (SHAPES.shapes as unknown as ShapeDefinitionView[]).map((shape) => [shapeKey(SHAPES.addOn, shape), shape]),
);

/** The manifest with one change made to a copy of it. */
function changed(change: (copy: { requiredSchema: { tables: Table[] }; addOns: Record<string, unknown[]> }) => void): typeof manifest {
  const copy = structuredClone(manifest);
  change(copy as never);
  return copy;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  BUILT ON THE SHAPE                                                         */
/* ─────────────────────────────────────────────────────────────────────────── */

describe("the quote tables are what the quote shape of Invoices & Receipts says", () => {
  it("builds one table on each part of the shape", () => {
    expect(table("quotes")).toMatchObject({ builtOn: "invoices/quote@1", part: "document" });
    expect(table("quote_lines")).toMatchObject({ builtOn: "invoices/quote@1", part: "lines" });
    expect([...shapes.keys()]).toEqual(["invoices/quote@1"]);
  });

  it("passes the check Adminium runs at install, against the copy of the shape", () => {
    expect(shapeConformanceIssues(manifest as never, shapes)).toEqual([]);
  });

  it("would catch a column the app retyped, so the check above is not a stub", () => {
    const longer = changed((copy) => {
      copy.requiredSchema.tables.find((t) => t.ref === "quotes")!.columns.find((c) => c.ref === "number")!.type = "int";
    });
    expect(shapeConformanceIssues(longer as never, shapes).map((issue) => issue.message)).toEqual([
      '"quotes.number" is not declared as the shape declares it',
    ]);
  });

  it("requires the add-on, because a table built on its shape cannot do without it", () => {
    expect(manifest.addOns.requires.map((need) => need.key)).toEqual(["invoices"]);
    // Only suggested, the manifest is refused: the shape and its four settings would not be there.
    const suggested = changed((copy) => {
      copy.addOns = { suggests: [...(copy.addOns["requires"] ?? []), ...(copy.addOns["suggests"] ?? [])] };
    });
    const result = validateManifest(suggested);
    const messages = result.ok ? [] : result.issues.map((issue) => issue.message);
    expect(messages).toContain('"invoices" defines the shape, so the app requires it (addOns.requires)');
    expect(messages).toContain('"invoices" is not required by the app (addOns.requires), so its setting may not be there');
  });

  it("holds the same shape as the engine's own copy, where one is reachable", () => {
    const repo = process.env["ADMINIUM_REPO"];
    const fixture = repo === undefined ? undefined : join(repo.replace(/^~/, process.env["HOME"] ?? "~"), "apps/server/test/fixtures/invoices-add-on.json");
    if (fixture === undefined || !existsSync(fixture)) return;
    const theirs = (JSON.parse(readFileSync(fixture, "utf8")) as { addOn: { shapes: { name: string; parts: unknown }[] } }).addOn.shapes.find(
      (shape) => shape.name === "quote",
    );
    expect(SHAPES.shapes[0]?.parts).toEqual(theirs?.parts);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE SUMS                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

describe("a version's list value is its lines' list amounts, added up", () => {
  // Three lines: one at list, one priced under its list rate, one with 10 % off and no list rate.
  const lines = [
    line({ qty: 2, rate: 1000, list_rate: 1000 }),
    line({ qty: 3, rate: 450, list_rate: 500 }),
    line({ qty: 1, rate: 400, discount_kind: "percent", discount: 10 }),
  ];

  it("adds the list amounts up from the lines, through the version's own link", () => {
    expect(column("quotes", "list_value").rules?.rollup).toEqual({ from: "quote_lines", via: "document_id", sum: "list_amount" });
    expect(column("quote_lines", "document_id")).toMatchObject({ type: "fk", references: "quotes" });
  });

  it("works a line's list amount out from its quantity and its list rate, or its rate where it has none", () => {
    expect(lines.map((row) => row["list_amount"])).toEqual(["2000.00", "1500.00", "400.00"]);
    expect(lines.map((row) => row["amount"])).toEqual(["2000.00", "1350.00", "360.00"]);
    // A draft line with no rate yet has no amount, and a list amount of nothing rather than none.
    expect(line({ qty: 1, rate: null })).toMatchObject({ amount: null, list_amount: "0.00" });
  });

  it("comes to the list amounts' sum, and the version's totals follow", () => {
    const quote = version(lines);
    const byHand = lines.reduce((sum, row) => sum + Number(row["list_amount"]), 0);
    expect(byHand).toBe(3900);
    expect(quote).toMatchObject({ list_value: "3900.00", subtotal: "3710.00", tax: "742.00", total: "4452.00" });
    // 190 under a list of 3,900.
    expect(quote["under_list_pct"]).toBe("4.87");
  });

  it("is nothing under list while it has no lines", () => {
    expect(version([])).toMatchObject({ list_value: "0.00", under_list_pct: "0.00", needs_approval: "0", may_send: "1" });
  });
});

describe("a version says whether it needs approval, and whether it may be sent", () => {
  const under = version([line({ qty: 1, rate: 960, list_rate: 1000 })]); // 4 % under
  const over = (typed: Row = {}) => version([line({ qty: 1, rate: 900, list_rate: 1000 })], typed); // 10 % under

  it("takes the threshold from the settings row when the version is made", () => {
    expect(column("quotes", "threshold_pct").rules?.default).toEqual({ from: { table: "settings", column: "approval_threshold_pct" } });
  });

  it("needs none at or under the threshold, and one over it", () => {
    expect(under).toMatchObject({ under_list_pct: "4.00", needs_approval: "0", may_send: "1" });
    expect(version([line({ qty: 1, rate: 950, list_rate: 1000 })])).toMatchObject({ under_list_pct: "5.00", needs_approval: "0" });
    expect(over()).toMatchObject({ under_list_pct: "10.00", needs_approval: "1", may_send: "0" });
  });

  it("may be sent over the threshold only once approved", () => {
    expect(over({ approval: "asked" })["may_send"]).toBe("0");
    expect(over({ approval: "refused" })["may_send"]).toBe("0");
    expect(over({ approval: "approved" })["may_send"]).toBe("1");
  });

  it("may not be sent while an answer is awaited or was no, even under the threshold", () => {
    const asked = version([line({ qty: 1, rate: 960, list_rate: 1000 })], { approval: "asked" });
    const refused = version([line({ qty: 1, rate: 960, list_rate: 1000 })], { approval: "refused" });
    expect([asked["may_send"], refused["may_send"]]).toEqual(["0", "0"]);
  });

  it("needs approval for anything under list where no threshold could be read", () => {
    expect(version([line({ qty: 1, rate: 990, list_rate: 1000 })], { threshold_pct: null })).toMatchObject({ needs_approval: "1", may_send: "0" });
  });

  it("writes the approval with three buttons, each on a draft only, and stamps who and when", () => {
    const actions = table("quotes").states?.actions ?? [];
    expect(actions.map((action) => [action.id, action.set, action.in, action.ask])).toEqual([
      ["ask-approval", { approval: "asked" }, ["draft"], ["ask_reason"]],
      ["approve", { approval: "approved" }, ["draft"], ["decision_note"]],
      ["refuse", { approval: "refused" }, ["draft"], ["decision_note"]],
    ]);
    const asked = { column: "approval", values: ["asked"] };
    const decided = { column: "approval", values: ["approved", "refused"] };
    expect(column("quotes", "asked_by_id").rules?.stamp).toEqual({ set: "user-id", on: asked });
    expect(column("quotes", "asked_at").rules?.stamp).toEqual({ set: "now", on: asked });
    expect(column("quotes", "decided_by_id").rules?.stamp).toEqual({ set: "user-id", on: decided });
    expect(column("quotes", "approval_decided_at").rules?.stamp).toEqual({ set: "now", on: decided });
  });

  /*
   * THE GAP, WHICH CAN NOW BE CLOSED. The plan holds the send itself to the
   * approval: draft → sent only while `may_send` is 1. A table built on a shape
   * could not say so: its moves were the shape's, and the install refused the
   * manifest. Adminium has since learned to let an app hold a shape's move to a
   * condition on a column the app added, and the validator vendored here says
   * so. The manifest does not write the condition yet: that is a later task's,
   * with its proof on three databases. Until then the move below is the shape's
   * own, and nothing on the server stops a write that sends a quote which needs
   * approval.
   *
   * When the condition is written in `manifest.json`, the first two lines fail:
   * turn this test round.
   */
  it("could hold the send to the approval, and does not yet", () => {
    const send = table("quotes").states?.moves["draft"]?.[0] as Move;
    expect(send.to).toBe("sent");
    expect(send.requires?.where?.map((condition) => condition.column)).toEqual(["total"]);

    const gated = changed((copy) => {
      const move = copy.requiredSchema.tables.find((t) => t.ref === "quotes")!.states!.moves["draft"]![0] as Move;
      move.requires!.where!.push({ column: "may_send", eq: 1 } as never);
    });
    expect(validateManifest(gated).ok).toBe(true);
    expect(shapeConformanceIssues(gated as never, shapes).map((issue) => `${issue.code}: ${issue.message}`)).toEqual([]);

    // Only on a column the app added: a condition on one of the shape's own is still refused.
    const onTheShapes = changed((copy) => {
      const move = copy.requiredSchema.tables.find((t) => t.ref === "quotes")!.states!.moves["draft"]![0] as Move;
      move.requires!.where!.push({ column: "valid_until", isNull: false } as never);
    });
    expect(validateManifest(onTheShapes).ok).toBe(true);
    const refused = shapeConformanceIssues(onTheShapes as never, shapes).map((issue) => issue.message);
    expect(refused.some((message) => message.includes("reads a column the app added, never valid_until"))).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE DEAL'S AMOUNT                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

describe("a deal's amount is its newest sent quote's total, else what was typed", () => {
  it("takes the total of the version sent last, leaving a withdrawn one out, and keeps which one it took", () => {
    expect(column("deals", "quoted_amount")).toMatchObject({
      type: "decimal",
      nullable: true,
      rules: { rollup: { from: "quotes", via: "deal_id", latest: { of: "total", by: "sent_at", row: "quote_id" }, unlessSet: "withdrawn_at" } },
    });
    expect(column("quotes", "deal_id")).toMatchObject({ type: "fk", references: "deals" });
  });

  it("keeps the key of that version in a plain column, so the version can still be deleted", () => {
    const kept = column("deals", "quote_id");
    expect(kept).toMatchObject({ type: "int", nullable: true });
    expect(kept.references).toBeUndefined();
    expect(kept.rules).toBeUndefined();
  });

  it("stamps a version the moment it is withdrawn, which is what leaves it out", () => {
    expect(column("quotes", "withdrawn_at")).toMatchObject({
      type: "timestamptz",
      nullable: true,
      rules: { stamp: { set: "now", on: { column: "status", values: ["withdrawn"] } } },
    });
  });

  it("reads the quoted amount first, then the typed one, then nothing", () => {
    expect(column("deals", "amount").rules?.formula).toEqual({ coalesce: [{ coalesce: ["quoted_amount", "typed_amount"] }, 0] });
    const amount = (row: Row): string | null => formula("deals", "amount", row);
    expect(amount({ quoted_amount: "52800.00", typed_amount: "48000.00" })).toBe("52800.00");
    expect(amount({ quoted_amount: null, typed_amount: "48000.00" })).toBe("48000.00");
    expect(amount({ quoted_amount: null, typed_amount: null })).toBe("0.00");
    // A quote sent at nothing is still the deal's amount: the typed figure does not come back.
    expect(amount({ quoted_amount: "0.00", typed_amount: "48000.00" })).toBe("0.00");
  });

  it("weights what the amount comes to", () => {
    const row: Row = { quoted_amount: "52800.00", typed_amount: "48000.00", stage_odds: "0.50" };
    row["amount"] = formula("deals", "amount", row);
    expect(formula("deals", "weighted_value", row)).toBe("26400.00");
  });

  it("adds no index set to deals, which holds the six a table may", () => {
    expect((table("deals") as unknown as { indexes: string[][] }).indexes).toHaveLength(6);
  });
});
