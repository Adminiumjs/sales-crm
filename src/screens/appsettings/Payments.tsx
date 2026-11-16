/**
 * SETTINGS, SELLING: what a customer is asked to pay when they accept a quote.
 *
 * Nothing (accepting reads as it always did, and somebody calls to book the
 * work), a deposit of a whole 1 to 99 % of the quote, or the whole amount.
 * The customer pays on the Stripe or PayPal page, through Adminium, and can
 * always wait for the call instead.
 *
 * Shown only while the app takes payments (someone who manages payments
 * switched it on in Adminium): before that there is nothing to set. Written
 * by the CRM admin and the sales manager, as the rest of the Selling tab; the
 * server holds the bounds. A quote takes the setting when it is made, so a
 * change never moves what a quote already asks: the card says so.
 */
import { useEffect, useId, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import type { StaffSession } from "../../staffSession.ts";
import { BOUNDS, num, readNumber, type SettingsRow } from "./data.ts";
import { Card, type Rights } from "./parts.tsx";

type Ask = "off" | "deposit" | "whole";
const ASKS: readonly Ask[] = ["off", "deposit", "whole"];
/** The round quote the card works its example on: the business's own currency, never one quote's figures. */
export const EXAMPLE_TOTAL = 1000;

/** The example's deposit and rest, at the currency's whole units: an example, worked out the same way the server does for a quote. */
export function example(pct: number): { deposit: number; rest: number } {
  const deposit = Math.round(EXAMPLE_TOTAL * pct) / 100;
  return { deposit, rest: EXAMPLE_TOTAL - deposit };
}

export function PaymentsCard({ session, row, f, rights, save }: { session: StaffSession; row: SettingsRow | null; f: Formatters; rights: Rights; save: (values: Record<string, unknown>, done: string, seen?: boolean) => Promise<boolean> }) {
  const t = useT();
  const id = useId();
  const held: Ask = row?.pay_ask === "deposit" || row?.pay_ask === "whole" ? row.pay_ask : "off";
  const heldPct = num(row?.pay_deposit_pct) || 20;
  const [ask, setAsk] = useState<Ask>(held);
  const [text, setText] = useState(String(heldPct));
  const [bad, setBad] = useState(false);
  useEffect(() => setAsk(held), [held]);
  useEffect(() => {
    setText(String(heldPct));
    setBad(false);
  }, [heldPct]);
  if (session.config.payments?.on !== true || row === null || !session.part("quotes")) return null;
  const canWrite = rights.column("pay_ask") && rights.column("pay_deposit_pct");
  const bounds = BOUNDS["pay_deposit_pct"] ?? ([1, 99] as const);
  const typed = readNumber(text, bounds, true);
  const pct = typed ?? heldPct;
  const { deposit, rest } = example(pct);

  const choose = (next: Ask): void => {
    setAsk(next);
    if (next === held) return;
    void save({ pay_ask: next }, t("aset.saved", { what: t("aset.pay.title") })).then((ok) => {
      if (!ok) setAsk(held);
    });
  };
  const commitPct = (): void => {
    const next = readNumber(text, bounds, true);
    if (next === null) {
      setBad(true);
      return;
    }
    setBad(false);
    if (next === heldPct && held === "deposit") return;
    setAsk("deposit");
    void save({ pay_ask: "deposit", pay_deposit_pct: next }, t("aset.saved", { what: t("aset.pay.title") }));
  };
  const sub = (one: Ask): string =>
    one === "off" ? t("aset.pay.off.sub") : one === "whole" ? t("aset.pay.whole.sub") : t("aset.pay.deposit.sub", { total: f.money(EXAMPLE_TOTAL), deposit: f.money(deposit), rest: f.money(rest) });

  return (
    <Card name="payments" title={t("aset.pay.title")}>
      <fieldset className="crm-ast-pay" disabled={!canWrite}>
        <legend className="crm-ast-pay-q">{t("aset.pay.ask")}</legend>
        {ASKS.map((one) => (
          <div key={one} className="crm-ast-pay-opt" data-on={ask === one ? "1" : "0"} data-ask={one}>
            <div className="crm-ast-pay-line">
              <label className="crm-ast-pay-choice">
                <input type="radio" name={`${id}-ask`} value={one} checked={ask === one} onChange={() => choose(one)} />
                <span>{t(one === "off" ? "aset.pay.off" : one === "deposit" ? "aset.pay.deposit" : "aset.pay.whole")}</span>
              </label>
              {one === "deposit" && (
                <span className="crm-ast-pay-pct">
                  <input
                    className="crm-ast-input crm-ast-input-num crm-mono mr-fld"
                    inputMode="numeric"
                    value={text}
                    aria-label={t("aset.pay.pct")}
                    aria-invalid={bad}
                    aria-describedby={bad ? `${id}-pct` : `${id}-sub-deposit`}
                    onFocus={() => {
                      if (ask !== "deposit") setAsk("deposit");
                    }}
                    onChange={(event) => setText(event.target.value)}
                    onBlur={commitPct}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitPct();
                      if (event.key === "Escape") {
                        setText(String(heldPct));
                        setBad(false);
                      }
                    }}
                  />
                  <span className="crm-mono crm-ast-unit">%</span>
                </span>
              )}
            </div>
            <p id={`${id}-sub-${one}`} className="crm-ast-pay-sub">
              {sub(one)}
            </p>
          </div>
        ))}
      </fieldset>
      {bad && (
        <p id={`${id}-pct`} role="alert" className="crm-ast-range">
          {t("aset.pay.pctError")}
        </p>
      )}
      <p className="crm-ast-pay-help">
        {t("aset.pay.help")} {t("aset.pay.made")}
      </p>
    </Card>
  );
}
