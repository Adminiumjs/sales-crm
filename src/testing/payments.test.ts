/**
 * Paying for an accepted quote online: the payable, the quote's payments, and
 * what a quote asks, held to what the app is meant to do.
 *
 * The figures are worked out with the product's own arithmetic
 * (`evaluateFormula` and `rollupValue`, the functions the server calls), over
 * the rules as the manifest writes them. That a payment really lands, once,
 * and that the server refuses what it refuses is the proof's
 * (`proofs/crm-payments.test.ts`), on three engines.
 */
import { describe, expect, it } from "vitest";

import released from "../../manifest.json";
import whole from "../../whole/manifest.json";
import { evaluateFormula, rollupValue, type FormulaExpr } from "./manifest/formula.ts";
import { validateManifest } from "./manifest/index.ts";

interface Column {
  ref: string;
  type: string;
  enum?: string[];
  default?: unknown;
  nullable?: boolean;
  unique?: boolean;
  maxLength?: number;
  scale?: number | "currency";
  references?: string;
  rules?: { formula?: FormulaExpr; rollup?: { from: string; via: string; sum?: string; latest?: unknown }; default?: { from: unknown }; validation?: { min?: number; max?: number } };
}
interface Table {
  ref: string;
  module?: string;
  columns: Column[];
  states?: { children?: Record<string, { via: string; parentIn?: string[] }>; lock?: { except?: string[] } };
}
interface Doc {
  compatibility: { minAdminiumVersion: string };
  requiredSchema: { tables: Table[] };
  roles: { key: string; permissions: string[]; limits?: Record<string, { writable?: string[]; creatable?: string[] }> }[];
  publicAccess: { table: string; key?: string; select?: string[]; writable?: string[]; defaults?: Record<string, unknown> }[];
  payments?: { payables?: Record<string, unknown>[] };
}
type Row = Record<string, unknown>;

for (const [name, raw] of [
  ["the whole app", whole],
  ["the released stage", released],
] as const) {
  const doc = raw as unknown as Doc;
  const table = (ref: string): Table => doc.requiredSchema.tables.find((one) => one.ref === ref)!;
  const column = (ref: string, col: string): Column => table(ref).columns.find((one) => one.ref === col)!;
  const payable = doc.payments?.payables?.[0] as Record<string, unknown> & { payments: Record<string, unknown> };

  describe(`a quote paid online, in ${name}`, () => {
    it("passes the validator, at an Adminium that takes payments in an app", () => {
      const result = validateManifest(raw);
      expect(result.ok ? [] : result.issues).toEqual([]);
      expect(doc.compatibility.minAdminiumVersion).toBe("0.3.60");
    });

    it("is one payable: the quote, paid into its own payments, while it is accepted on a deal that is not lost and something is asked", () => {
      expect(doc.payments?.payables).toHaveLength(1);
      expect(payable).toEqual({
        table: "quotes",
        label: "number",
        amount: { column: "pay_amount" },
        currency: { column: "currency" },
        due: { column: "pay_due" },
        payments: {
          kind: "table",
          table: "quote_payments",
          link: "quote_id",
          amount: "amount",
          paidAt: "paid_at",
          method: { column: "method", values: { "*": "online" } },
          note: "note",
          reference: "payment_ref",
          refunded: "refunded",
          provider: "provider",
          currency: "currency",
        },
        customerEmail: "sent_to_email",
        payableWhen: [
          { column: "status", eq: "accepted" },
          { column: "deal_state", in: ["open", "won"] },
          { column: "pay_amount", gt: 0 },
        ],
        returnTo: "/",
        receipt: "engine",
      });
      // Paying moves nothing: no status is set when it is paid or refunded, so the quote stays accepted and the deal where it is.
      expect(payable["status"]).toBeUndefined();
      // The CRM shows no way to pay by hand of its own: the shop's own ways stay on the pay page.
      expect(payable["onlyOnline"]).toBeUndefined();
    });

    it("keeps each payment once: a unique reference only Adminium writes, the service, the currency and what was refunded", () => {
      const payments = table("quote_payments");
      expect(payments.module).toBe("quotes");
      expect(column("quote_payments", "payment_ref")).toMatchObject({ type: "text", maxLength: 64, unique: true, nullable: true });
      expect(column("quote_payments", "quote_id")).toMatchObject({ type: "fk", references: "quotes" });
      expect(column("quote_payments", "method")).toMatchObject({ type: "enum", default: "online" });
      expect(column("quote_payments", "method").enum).toEqual(["online", "bank-transfer", "cash", "card", "cheque", "other"]);
      for (const money of ["amount", "refunded", "net_amount"]) expect(column("quote_payments", money).scale, money).toBe("currency");
      // Added only while the quote is accepted.
      expect(table("quotes").states?.children?.["quote_payments"]).toEqual({ via: "quote_id", parentIn: ["accepted"] });
      // Nobody writes a payment by hand on the app's screens, nor any of what a quote asks, and no stranger at all.
      for (const role of doc.roles) {
        expect(role.permissions.filter((grant) => grant.startsWith("table:@quote_payments:") && !grant.endsWith(":read")), role.key).toEqual([]);
        for (const kind of ["writable", "creatable"] as const) {
          for (const col of role.limits?.["quotes"]?.[kind] ?? []) expect(col.startsWith("pay_"), `${role.key} ${kind} ${col}`).toBe(false);
        }
      }
      expect(doc.publicAccess.filter((entry) => entry.table === "quote_payments")).toEqual([]);
      const link = doc.publicAccess.find((entry) => entry.table === "quotes" && entry.key === "quote")!;
      for (const col of link.writable ?? []) expect(col.startsWith("pay_"), col).toBe(false);
      expect(Object.keys(link.defaults ?? {})).toEqual([]);
    });

    it("lets the setting say what is asked: nothing at install, a deposit of 1 to 99 %, or the whole amount", () => {
      expect(column("settings", "pay_ask")).toMatchObject({ type: "enum", enum: ["off", "deposit", "whole"], default: "off" });
      expect(column("settings", "pay_deposit_pct")).toMatchObject({ type: "int", default: 20, rules: { validation: { min: 1, max: 99 } } });
      // A quote takes the setting when it is made: a later change never moves what a quote already asks.
      expect(column("quotes", "pay_ask").rules?.default).toEqual({ from: { table: "settings", column: "pay_ask" } });
      expect(column("quotes", "pay_pct").rules?.default).toEqual({ from: { table: "settings", column: "pay_deposit_pct" } });
    });
  });
}

describe("what a quote asks, paid and left, as the server works it out", () => {
  const doc = whole as unknown as Doc;
  const column = (ref: string, col: string): Column => doc.requiredSchema.tables.find((one) => one.ref === ref)!.columns.find((one) => one.ref === col)!;
  /** A column's formula over a row, at a currency's places (the column's `scale: "currency"`). */
  const formula = (ref: string, col: string, row: Row, places: number): string | null => evaluateFormula(column(ref, col).rules!.formula!, row, places);
  const asked = (row: Row, places = 2): Row => {
    const out: Row = { ...row };
    out["pay_amount"] = formula("quotes", "pay_amount", out, places);
    out["pay_due"] = formula("quotes", "pay_due", out, places);
    out["pay_open"] = formula("quotes", "pay_open", out, 0);
    return out;
  };
  const paid = (payments: Row[], places = 2): string => {
    const rows = payments.map((one) => ({ ...one, net_amount: formula("quote_payments", "net_amount", one, places) }));
    return rollupValue(rows, { sum: "net_amount" }, places);
  };

  it("asks a deposit of the total, tax included, rounded once to the currency's places", () => {
    expect(asked({ status: "accepted", deal_state: "open", total: "38000.00", pay_ask: "deposit", pay_pct: 20, pay_paid: null })).toMatchObject({ pay_amount: "7600.00", pay_due: "7600.00", pay_open: "1" });
    expect(asked({ status: "accepted", deal_state: "open", total: "1234.55", pay_ask: "deposit", pay_pct: 15, pay_paid: null })).toMatchObject({ pay_amount: "185.18" });
    expect(asked({ status: "accepted", deal_state: "open", total: "999.99", pay_ask: "deposit", pay_pct: 33, pay_paid: null })).toMatchObject({ pay_amount: "330.00" });
    // Yen have no minor unit; a Kuwaiti dinar has three.
    expect(asked({ status: "accepted", deal_state: "open", total: "123457", pay_ask: "deposit", pay_pct: 15, pay_paid: null }, 0)).toMatchObject({ pay_amount: "18519" });
    expect(asked({ status: "accepted", deal_state: "open", total: "1000.005", pay_ask: "deposit", pay_pct: 33, pay_paid: null }, 3)).toMatchObject({ pay_amount: "330.002" });
  });

  it("asks the whole total, or nothing", () => {
    expect(asked({ status: "accepted", deal_state: "won", total: "38000.00", pay_ask: "whole", pay_pct: 20, pay_paid: null })).toMatchObject({ pay_amount: "38000.00", pay_due: "38000.00", pay_open: "1" });
    for (const ask of ["off", null]) expect(asked({ status: "accepted", deal_state: "open", total: "38000.00", pay_ask: ask, pay_pct: 20, pay_paid: null }), String(ask)).toMatchObject({ pay_amount: "0.00", pay_due: "0.00", pay_open: "0" });
  });

  it("is paid net of refunds: a refunded deposit is due again", () => {
    const quote = { status: "accepted", deal_state: "open", total: "38000.00", pay_ask: "deposit", pay_pct: 20 };
    const taken = { amount: "7600.00", refunded: "0.00" };
    expect(asked({ ...quote, pay_paid: paid([taken]) })).toMatchObject({ pay_due: "0.00" });
    expect(asked({ ...quote, pay_paid: paid([{ ...taken, refunded: "2600.00" }]) })).toMatchObject({ pay_due: "2600.00" });
    expect(asked({ ...quote, pay_paid: paid([{ ...taken, refunded: "7600.00" }]) })).toMatchObject({ pay_due: "7600.00", pay_open: "1" });
  });

  it("is not open to pay before it is accepted, or on a deal that was lost", () => {
    const quote = { total: "38000.00", pay_ask: "deposit", pay_pct: 20, pay_paid: null };
    expect(asked({ ...quote, status: "sent", deal_state: "open" })).toMatchObject({ pay_open: "0" });
    expect(asked({ ...quote, status: "accepted", deal_state: "lost" })).toMatchObject({ pay_open: "0" });
  });
});
