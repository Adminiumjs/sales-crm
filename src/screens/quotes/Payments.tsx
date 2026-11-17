/**
 * A QUOTE'S PAYMENTS, under its totals: what the customer was asked for when
 * they accepted it (a deposit or the whole amount), what was paid and how,
 * what was given back, and what is still to pay when the work is done.
 *
 * Every figure is the server's: what the quote asks and has left are its own
 * columns, each payment is a row Adminium wrote into the quote's payments.
 * A refund's state is Adminium's own (the payment panel's read of the quote,
 * through the person's own grants), and so is who asked for it and why, told
 * to those who may see it.
 *
 * WHAT CAN BE DONE, each with Adminium's own part and words, never the app's:
 * "Copy pay link" (the record's current link, made only when there is none),
 * shown while something is due and the person may change the quote; and
 * "Refund", for a payment taken online, shown to somebody who may refund.
 * Paying moves neither the quote nor the deal: a person closes the deal.
 *
 * With payments off and nothing paid, there is no block at all: the quote
 * reads as it always did.
 */
import { useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { kitCommon } from "../../kitParts.ts";
import type { Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { LostReply, StaffError, type StaffSession } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { KitPart } from "../../ui/kit.tsx";
import { num, type Quote } from "./data.ts";

/** One payment of a quote, as the quote's payments table holds it. */
export interface QuotePayment extends Record<string, unknown> {
  id: number;
  quote_id: number;
  amount: number | string;
  paid_at: string | null;
  method: string;
  provider: string | null;
  payment_ref: string | null;
  refunded: number | string | null;
}
export const PAYMENT_COLUMNS = ["id", "quote_id", "amount", "paid_at", "method", "provider", "payment_ref", "refunded"];

/** What Adminium's payment panel says of the quote: who may do what, and each online payment's refunds. */
export interface Panel {
  payable: { kind: "profile" | "shape" | "document"; connectionId: string | null; tableName: string | null; rowKey: string };
  due: string;
  mayChange: boolean;
  mayRefund: boolean;
  links: { on: boolean; reason: string | null };
  payments: { attemptId: string | null; refundable: string; refunds: PanelRefund[] }[];
}

/** The reasons Adminium's refund dialog offers. */
export const REFUND_REASONS = ["requested_by_customer", "duplicate", "fraudulent", "other"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/**
 * One refund as the panel says it. Who asked for it, why and the note come
 * only to someone who may see payments or refund them (Adminium 0.3.62), and
 * only for a refund asked in Adminium: absent or null otherwise.
 */
export interface PanelRefund {
  id: string;
  amount: string;
  state: string;
  createdAt: number;
  by?: string | null;
  reason?: string | null;
  note?: string | null;
}

/** A quote's payments and its panel. Nothing from a server that does not say whether the app takes payments. */
export async function readPayments(session: StaffSession, quoteId: number): Promise<{ rows: QuotePayment[]; panel: Panel | null }> {
  if (session.config.payments === null || session.config.payments === undefined) return { rows: [], panel: null };
  const rows = session.can("quote_payments", "read")
    ? (await session.list<QuotePayment>("quote_payments", { select: PAYMENT_COLUMNS, where: { column: "quote_id", op: "eq", value: quoteId }, order: ["paid_at", "id"], limit: 50 })).rows
    : [];
  let panel: Panel | null = null;
  try {
    const said = await session.call<{ data?: Panel | null }>("POST", "/payments/panel", { connectionId: session.connectionId, table: session.tableId("quotes"), recordId: String(quoteId) });
    panel = said?.data ?? null;
  } catch (error) {
    // No panel for this person or this server: the rows still say what was paid, and nothing is offered.
    if (!(error instanceof StaffError) && !(error instanceof LostReply)) throw error;
  }
  return { rows, panel };
}

/** The service's name as a person reads it: the payment row says it ("Stripe"); a service's key reads as its name. */
export function serviceName(provider: string | null): string | null {
  if (provider === null || provider === "") return null;
  if (provider === "payments-stripe") return "Stripe";
  if (provider === "payments-paypal") return "PayPal";
  return provider;
}

/** What the block shows: a row for what is asked and not paid, each payment and each refund, and what is left for later. */
export interface PaymentLine {
  key: string;
  kind: "asked" | "paid" | "refund" | "rest";
  amount: number;
  at: string | null;
  /** The chip: online through a service, a way paid by hand, or a refund's state. */
  service?: string | null;
  way?: string;
  done?: boolean;
  attemptId?: string | null;
  refundable?: number;
  /** A refund: who asked for it, the reason picked and the note written, when the panel tells this reader. */
  by?: string | null;
  reason?: RefundReason | null;
  note?: string | null;
}

const reasonOf = (value: string | null | undefined): RefundReason | null => ((REFUND_REASONS as readonly string[]).includes(value ?? "") ? (value as RefundReason) : null);
const plain = (value: string | null | undefined): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

export function paymentLines(quote: Quote, rows: readonly QuotePayment[], panel: Panel | null): PaymentLine[] {
  const out: PaymentLine[] = [];
  const asks = quote.pay_ask === "deposit" || quote.pay_ask === "whole";
  if (rows.length === 0 && asks && num(quote.pay_due) > 0 && quote.status === "accepted") out.push({ key: "asked", kind: "asked", amount: num(quote.pay_amount), at: quote.decided_at });
  for (const row of rows) {
    const online = row.method === "online";
    const held = online && row.payment_ref !== null ? panel?.payments.find((one) => one.attemptId === row.payment_ref) : undefined;
    out.push({ key: `p${String(row.id)}`, kind: "paid", amount: num(row.amount), at: row.paid_at, service: online ? serviceName(row.provider) : null, way: online ? undefined : row.method, attemptId: online ? row.payment_ref : null, refundable: held === undefined ? 0 : num(held.refundable) });
    const refunds = held?.refunds.filter((refund) => refund.state !== "failed" && refund.state !== "cancelled") ?? [];
    if (refunds.length > 0) {
      for (const refund of refunds) out.push({ key: `r${refund.id}`, kind: "refund", amount: num(refund.amount), at: new Date(refund.createdAt).toISOString(), done: refund.state === "succeeded", by: plain(refund.by), reason: reasonOf(refund.reason), note: plain(refund.note) });
    } else if (num(row.refunded) > 0) {
      out.push({ key: `r${String(row.id)}`, kind: "refund", amount: num(row.refunded), at: null, done: true });
    }
  }
  // A deposit paid: the rest is paid later, when the work is done (not online).
  if (quote.pay_ask === "deposit" && rows.length > 0 && num(quote.pay_due) <= 0 && num(quote.total) > num(quote.pay_amount)) {
    out.push({ key: "rest", kind: "rest", amount: num(quote.total) - num(quote.pay_amount), at: null });
  }
  return out;
}

/** Whether the block is drawn: the app takes payments and the quote asks for some, or it was paid. Otherwise the quote reads as before. */
export function showsPayments(session: StaffSession, quote: Quote, rows: readonly QuotePayment[]): boolean {
  if (rows.length > 0) return true;
  const on = session.config.payments?.on === true;
  return on && quote.status === "accepted" && (quote.pay_ask === "deposit" || quote.pay_ask === "whole") && num(quote.pay_amount) > 0;
}

export function QuotePayments({ session, quote, rows, panel, f, when, after }: { session: StaffSession; quote: Quote; rows: QuotePayment[]; panel: Panel | null; f: Formatters; when: (at: string | null) => string; after: () => void }) {
  const t = useT();
  const [refunding, setRefunding] = useState<PaymentLine | null>(null);
  if (!showsPayments(session, quote, rows)) return null;
  const lines = paymentLines(quote, rows, panel);
  const deposit = quote.pay_ask === "deposit";
  const payments = session.config.payments;
  // Only while something is due: there is no pay link to copy for a quote paid (Adminium refuses one).
  const canCopy = payments?.on === true && panel !== null && panel.mayChange && panel.payable.connectionId !== null && panel.payable.tableName !== null && num(quote.pay_due) > 0 && num(quote.pay_open) === 1;
  const mayRefund = payments?.refund === true && panel?.mayRefund === true;
  const common = kitCommon(session.config);
  const label = (line: PaymentLine): string => {
    if (line.kind === "refund") return t("quotes.pay.refund");
    if (line.kind === "rest") return t("quotes.pay.still");
    if (line.kind === "asked") return t(deposit ? "quotes.pay.deposit" : "quotes.pay.whole");
    return t(deposit ? "quotes.pay.deposit" : "quotes.pay.paid");
  };
  const meta = (line: PaymentLine): string => {
    if (line.kind === "asked") return t("quotes.pay.askedOn", { day: when(line.at) });
    if (line.kind === "rest") return t("quotes.pay.whenDone");
    if (line.kind === "paid") return line.at === null ? "" : t("quotes.pay.paidOn", { day: when(line.at) });
    // A refund: when, who asked for it and why, as far as the panel tells this reader.
    const by = line.by === null || line.by === undefined ? null : t("quotes.pay.refundBy", { person: line.by });
    const why = line.reason === null || line.reason === undefined ? null : t(`quotes.pay.reason.${line.reason}` as MessageKey);
    return [line.at === null ? null : when(line.at), by, why].filter((part): part is string => part !== null).join(" · ");
  };
  return (
    <section className="crm-quote-pay" aria-labelledby="crm-quote-pay-h" data-testid="quote-payments">
      <h3 className="crm-label" id="crm-quote-pay-h">
        {t("quotes.pay.heading")}
      </h3>
      <ul className="crm-quote-pay-rows">
        {lines.map((line) => (
          <li key={line.key} className="crm-quote-pay-row" data-kind={line.kind}>
            <span className="crm-quote-pay-label">{label(line)}</span>
            <span className="crm-mono crm-quote-pay-amount">{f.money(line.amount)}</span>
            <span className="crm-quote-pay-meta">{meta(line)}</span>
            {line.kind === "paid" && line.service !== null && line.service !== undefined ? (
              <span className="crm-pill crm-quote-pay-chip" data-tone="info">
                <Icon name="globe" size={12} />
                {t("quotes.pay.online", { service: line.service })}
              </span>
            ) : null}
            {line.kind === "paid" && line.way !== undefined ? (
              <span className="crm-pill crm-quote-pay-chip" data-tone="neutral">
                {t(`quotes.pay.way.${line.way}` as MessageKey)}
              </span>
            ) : null}
            {line.kind === "refund" ? (
              <span className="crm-pill crm-quote-pay-chip" data-tone="neutral">
                <Icon name="undo-2" size={12} />
                {t(line.done === true ? "quotes.pay.refunded" : "quotes.pay.requested")}
              </span>
            ) : null}
            {line.kind === "refund" && line.note !== null && line.note !== undefined ? (
              <span className="crm-quote-pay-why" data-testid="quote-refund-note">
                {t("quotes.pay.refundNote", { note: line.note })}
              </span>
            ) : null}
            {line.kind === "paid" && mayRefund && line.attemptId !== null && line.attemptId !== undefined && (line.refundable ?? 0) > 0 ? (
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi crm-quote-pay-refund" onClick={() => setRefunding(line)} data-testid="quote-refund">
                <Icon name="undo-2" size={14} />
                {t("quotes.pay.refund")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canCopy ? (
        <KitPart
          part="pay-link"
          className="crm-quote-pay-link"
          props={{ ...common, payable: panel!.payable, csrfToken: session.config.csrfToken ?? "" }}
          fallback={() => <p className="crm-room-quiet">{t("quotes.pay.missing")}</p>}
        />
      ) : null}
      <p className="crm-quote-pay-note">
        <Icon name="info" size={14} />
        <span>{t("quotes.pay.stageNote")}</span>
      </p>
      {refunding !== null ? (
        <Dialog
          shape="sheet"
          icon="undo-2"
          title={t("quotes.pay.refundOf", { amount: f.money(refunding.amount) })}
          onClose={() => setRefunding(null)}
          name="refund"
          foot={
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" onClick={() => setRefunding(null)}>
              {t("quotes.pay.close")}
            </button>
          }
        >
          <KitPart
            part="refund"
            props={{ ...common, attemptId: refunding.attemptId!, csrfToken: session.config.csrfToken ?? "", onRefunded: () => after() }}
            fallback={() => <p className="crm-room-quiet">{t("quotes.pay.missing")}</p>}
          />
        </Dialog>
      ) : null}
    </section>
  );
}
