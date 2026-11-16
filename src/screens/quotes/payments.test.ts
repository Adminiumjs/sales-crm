/**
 * A quote's Payments block: which lines it shows, and when it is drawn at all.
 * Every figure is the server's; this only lays them out.
 */
import { describe, expect, it } from "vitest";

import type { StaffSession } from "../../staffSession.ts";
import type { Quote } from "./data.ts";
import { paymentLines, serviceName, showsPayments, type Panel, type QuotePayment } from "./Payments.tsx";
import { example } from "../appsettings/Payments.tsx";

const quote = (more: Partial<Quote> = {}): Quote =>
  ({ id: 7, status: "accepted", total: "38000.00", decided_at: "2026-07-24T09:14:00.000Z", pay_ask: "deposit", pay_pct: 20, pay_amount: "7600.00", pay_paid: "0.00", pay_due: "7600.00", pay_open: 1, ...more }) as unknown as Quote;
const online = (more: Partial<QuotePayment> = {}): QuotePayment => ({ id: 1, quote_id: 7, amount: "7600.00", paid_at: "2026-07-24T09:20:00.000Z", method: "online", provider: "Stripe", payment_ref: "pat_1", refunded: "0.00", ...more });
const panel = (refundable = "7600.00", refunds: Panel["payments"][number]["refunds"] = []): Panel => ({
  payable: { kind: "profile", connectionId: "c1", tableName: "crm_quotes", rowKey: "7" },
  due: "0",
  mayChange: true,
  mayRefund: true,
  links: { on: true, reason: null },
  payments: [{ attemptId: "pat_1", refundable, refunds }],
});
const session = (payments: { on: boolean; refund?: boolean } | null): StaffSession => ({ config: { payments: payments === null ? null : { online: payments.on, test: false, refund: false, ...payments } } }) as unknown as StaffSession;

describe("the Payments block's lines", () => {
  it("asks the deposit until it is paid", () => {
    expect(paymentLines(quote(), [], null)).toEqual([{ key: "asked", kind: "asked", amount: 7600, at: "2026-07-24T09:14:00.000Z" }]);
  });

  it("shows a deposit paid online with its service, and what is left for when the work is done", () => {
    const lines = paymentLines(quote({ pay_paid: "7600.00", pay_due: "0.00" }), [online()], panel());
    expect(lines.map((line) => [line.kind, line.amount, line.service ?? null, line.refundable ?? null])).toEqual([
      ["paid", 7600, "Stripe", 7600],
      ["rest", 30400, null, null],
    ]);
  });

  it("names a payment recorded by hand by its way, and offers no refund of it", () => {
    const [line] = paymentLines(quote({ pay_paid: "7600.00", pay_due: "0.00" }), [online({ method: "bank-transfer", provider: null, payment_ref: null })], panel());
    expect(line).toMatchObject({ kind: "paid", way: "bank-transfer", service: null, attemptId: null, refundable: 0 });
  });

  it("shows a refund requested until the service confirms it, then refunded; no rest while the deposit is due again", () => {
    const asked = paymentLines(quote(), [online({ refunded: "0.00" })], panel("0", [{ id: "rf_1", amount: "7600.00", state: "pending", createdAt: Date.parse("2026-07-25T08:40:00Z") }]));
    expect(asked.map((line) => [line.kind, line.done ?? null])).toEqual([
      ["paid", null],
      ["refund", false],
    ]);
    const done = paymentLines(quote(), [online({ refunded: "7600.00" })], panel("0", [{ id: "rf_1", amount: "7600.00", state: "succeeded", createdAt: Date.parse("2026-07-25T08:40:00Z") }]));
    expect(done.map((line) => [line.kind, line.done ?? null])).toEqual([
      ["paid", null],
      ["refund", true],
    ]);
    // Without the panel's word, what the row says was given back.
    expect(paymentLines(quote(), [online({ refunded: "7600.00" })], null).map((line) => line.kind)).toEqual(["paid", "refund"]);
  });

  it("asks the whole amount, and leaves nothing for later", () => {
    expect(paymentLines(quote({ pay_ask: "whole", pay_amount: "38000.00", pay_due: "38000.00" }), [], null)[0]).toMatchObject({ kind: "asked", amount: 38000 });
    expect(paymentLines(quote({ pay_ask: "whole", pay_amount: "38000.00", pay_paid: "38000.00", pay_due: "0.00" }), [online({ amount: "38000.00" })], panel()).map((line) => line.kind)).toEqual(["paid"]);
  });
});

describe("whether the block is drawn", () => {
  it("reads as before while payments are off or the server does not say, unless something was paid", () => {
    expect(showsPayments(session(null), quote(), [])).toBe(false);
    expect(showsPayments(session({ on: false }), quote(), [])).toBe(false);
    expect(showsPayments(session({ on: false }), quote(), [online()])).toBe(true);
  });
  it("is drawn for an accepted quote that asks for a payment, while the app takes payments", () => {
    expect(showsPayments(session({ on: true }), quote(), [])).toBe(true);
    expect(showsPayments(session({ on: true }), quote({ status: "sent" }), [])).toBe(false);
    expect(showsPayments(session({ on: true }), quote({ pay_ask: "off", pay_amount: "0.00" }), [])).toBe(false);
  });
});

describe("words", () => {
  it("names a service by its name, never a key", () => {
    expect([serviceName("Stripe"), serviceName("payments-stripe"), serviceName("payments-paypal"), serviceName(null), serviceName("")]).toEqual(["Stripe", "Stripe", "PayPal", null, null]);
  });
  it("works the Settings example on a round quote", () => {
    expect(example(20)).toEqual({ deposit: 200, rest: 800 });
    expect(example(33)).toEqual({ deposit: 330, rest: 670 });
  });
});
