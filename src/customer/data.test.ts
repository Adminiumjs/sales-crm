/**
 * The customer's link: what a code can come to, and what an answer comes to,
 * against a door that stands in for the server.
 */
import { describe, expect, it } from "vitest";

import { codeOf, wentToPay } from "./CustomerApp.tsx";
import { afterPaying, payable, quoteLink, ranOut, today, type CustomerQuote, type PayState, type QuoteDoor } from "./data.ts";

type Row = Record<string, unknown>;
const sent: Row = { id: 7, number: "Q-1002", version: 2, status: "sent", valid_until: "2026-08-27", currency: "GBP", tax_name: "VAT", tax_rate: "20.00", subtotal: "2970.00", tax: "594.00", total: "3564.00", notes: null, sent_at: "2026-07-28T08:10:00.000Z", decided_at: null, accepted_name: null };
const lines: Row[] = [
  { id: 2, document_id: 7, position: 2, description: "Fitting", qty: "1", rate: "330.00", amount: "330.00" },
  { id: 1, document_id: 7, position: 1, description: "Oak desk", qty: "3", rate: "880.00", amount: "2640.00" },
];

/** A server that holds one quote; `onUpdate` decides what a write does to it. */
function server(start: Row | null, onUpdate: (held: Row, values: Row) => Row | Error = (held, values) => ({ ...held, ...values, decided_at: "2026-07-28T09:00:00.000Z" })) {
  let held = start;
  const calls: string[] = [];
  const door: QuoteDoor = {
    openShared: async (token) => {
      calls.push(`open ${token}`);
      return token === "GOODCODE12345678" ? "opened" : token === "STOPPED123456789" ? "closed" : "unknown";
    },
    config: async () => ({ timezone: "Europe/London", refs: { crm_quotes: {}, crm_quote_lines: {} } }),
    list: async (ref) => {
      calls.push(`list ${ref}`);
      if (ref === "crm_quotes") return { data: held === null ? [] : [held] };
      return { data: held === null ? [] : lines };
    },
    update: async (ref, id, values) => {
      calls.push(`update ${ref} ${id} ${JSON.stringify(values)}`);
      const next = onUpdate(held!, values);
      if (next instanceof Error) throw next;
      held = next;
      return next;
    },
    // A business that does not take payments online.
    payments: {
      available: async () => ({ online: false }),
      start: async () => {
        throw Object.assign(new Error("PUBLIC_PAY_REFUSED"), { code: "PUBLIC_PAY_REFUSED", status: 409 });
      },
      state: async () => ({ state: "none" }),
    },
  };
  return { door, calls, set: (row: Row | null) => (held = row), now: () => held };
}
const tables = { quotes: "crm_quotes", quote_lines: "crm_quote_lines" };
const NOW = () => new Date("2026-07-28T08:35:00Z");
const refused = (code: string, status: number): Error => Object.assign(new Error(code), { code, status });

describe("what a link opens", () => {
  it("opens the quote with its lines in order, every figure the server's", async () => {
    const s = server(sent);
    const opened = await quoteLink(s.door, "GOODCODE12345678", tables, NOW).open();
    expect(opened.state).toBe("open");
    if (opened.state !== "open") return;
    expect(opened.quote).toMatchObject({ number: "Q-1002", version: 2, status: "sent", validUntil: "2026-08-27", currency: "GBP", subtotal: 2970, tax: 594, total: 3564, taxRate: 20 });
    expect(opened.lines.map((line) => line.description)).toEqual(["Oak desk", "Fitting"]);
    expect(opened.timeZone).toBe("Europe/London");
    // Today is the clock it was given (the server's), not this machine's.
    expect(opened.today).toBe("2026-07-28");
  });

  it("a code that is nobody's, a stopped link, no code at all, and an install with no quote key", async () => {
    const s = server(sent);
    expect((await quoteLink(s.door, "NOBODYSCODE12345", tables).open()).state).toBe("unknown");
    expect((await quoteLink(s.door, "STOPPED123456789", tables).open()).state).toBe("closed");
    expect((await quoteLink(s.door, "", tables).open()).state).toBe("unknown");
    expect((await quoteLink(null, "GOODCODE12345678", tables).open()).state).toBe("off");
    // No code is never sent to the server.
    expect(s.calls.filter((call) => call === "open ")).toEqual([]);
  });

  it("a quote the server no longer serves (replaced, or never sent) is gone, and nothing of it is read", async () => {
    const s = server(null);
    expect(await quoteLink(s.door, "GOODCODE12345678", tables, NOW).open()).toEqual({ state: "gone" });
    expect(s.calls).not.toContain("list crm_quote_lines");
    // A row in a state the page does not know is not shown either.
    s.set({ ...sent, status: "withdrawn" });
    expect((await quoteLink(s.door, "GOODCODE12345678", tables, NOW).open()).state).toBe("gone");
  });

  it("a refusal: the part switched off reads as no such link, anything else as not reachable", async () => {
    const off: QuoteDoor = { ...server(sent).door, openShared: async () => Promise.reject(refused("PUBLIC_KEY_INVALID", 401)) };
    expect((await quoteLink(off, "GOODCODE12345678", tables).open()).state).toBe("off");
    const down: QuoteDoor = { ...server(sent).door, openShared: async () => Promise.reject(refused("PUBLIC_NETWORK_UNAVAILABLE", 0)) };
    expect((await quoteLink(down, "GOODCODE12345678", tables).open()).state).toBe("unreachable");
    const stopped: QuoteDoor = { ...server(sent).door, openShared: async () => Promise.reject(refused("LINK_EXPIRED", 410)) };
    expect((await quoteLink(stopped, "GOODCODE12345678", tables).open()).state).toBe("closed");
  });
});

describe("an answer", () => {
  async function opened(s: ReturnType<typeof server>) {
    const link = quoteLink(s.door, "GOODCODE12345678", tables, NOW);
    const first = await link.open();
    if (first.state !== "open") throw new Error("not open");
    return { link, quote: first.quote };
  }

  it("Accept sends the state and the trimmed name, and answers what the server then holds", async () => {
    const s = server(sent);
    const { link, quote } = await opened(s);
    const answered = await link.answer(quote, "accepted", "  Petra Lindqvist ");
    expect(s.calls).toContain('update crm_quotes 7 {"status":"accepted","accepted_name":"Petra Lindqvist"}');
    expect(answered).toMatchObject({ ok: true, quote: { status: "accepted", acceptedName: "Petra Lindqvist" } });
  });

  it("Accept with no name is not sent", async () => {
    const s = server(sent);
    const { link, quote } = await opened(s);
    expect(await link.answer(quote, "accepted", "   ")).toEqual({ ok: false, why: "name" });
    expect(s.calls.some((call) => call.startsWith("update"))).toBe(false);
  });

  it("Decline sends the state alone", async () => {
    const s = server(sent);
    const { link, quote } = await opened(s);
    const answered = await link.answer(quote, "declined");
    expect(s.calls).toContain('update crm_quotes 7 {"status":"declined"}');
    expect(answered).toMatchObject({ ok: true, quote: { status: "declined" } });
  });

  it("a lost reply: the write landed, the answer did not; the page reads the quote back and says accepted", async () => {
    let wrote = false;
    const s = server(sent, (held, values) => {
      wrote = true;
      s.set({ ...held, ...values, decided_at: "2026-07-28T09:00:00.000Z" });
      return refused("PUBLIC_NETWORK_UNAVAILABLE", 0);
    });
    const { link, quote } = await opened(s);
    const answered = await link.answer(quote, "accepted", "Petra Lindqvist");
    expect(wrote).toBe(true);
    expect(answered).toMatchObject({ ok: true, quote: { status: "accepted" } });
  });

  it("a second Accept after somebody else's: the server refuses, and the answer is 'changed' unless it was this very name", async () => {
    const s = server({ ...sent, status: "accepted", accepted_name: "Omar Haddad", decided_at: "2026-07-28T08:59:00.000Z" }, () => refused("PUBLIC_REF_NOT_FOUND", 404));
    const link = quoteLink(s.door, "GOODCODE12345678", tables, NOW);
    await link.open();
    expect(await link.answer({ id: 7 } as CustomerQuote, "accepted", "Petra Lindqvist")).toEqual({ ok: false, why: "changed" });
  });

  it("Accept after Decline, and an answer to a quote replaced meanwhile, are 'changed'", async () => {
    const s = server({ ...sent, status: "declined" }, () => refused("PUBLIC_REF_NOT_FOUND", 404));
    const link = quoteLink(s.door, "GOODCODE12345678", tables, NOW);
    await link.open();
    expect(await link.answer({ id: 7 } as CustomerQuote, "accepted", "Petra")).toEqual({ ok: false, why: "changed" });
    s.set(null);
    expect(await link.answer({ id: 7 } as CustomerQuote, "declined")).toEqual({ ok: false, why: "changed" });
  });

  it("refused after its last day: 'late'", async () => {
    const s = server({ ...sent, valid_until: "2020-01-01" }, () => refused("PUBLIC_REF_NOT_FOUND", 404));
    const { link, quote } = await opened(s);
    expect(await link.answer(quote, "accepted", "Petra")).toEqual({ ok: false, why: "late" });
  });

  it("a name the server will not take: 'name', and the quote is still open", async () => {
    const s = server(sent, () => refused("PUBLIC_WRITE_REFUSED", 400));
    const { link, quote } = await opened(s);
    expect(await link.answer(quote, "accepted", "see http://evil.example")).toEqual({ ok: false, why: "name" });
    expect(s.now()?.["status"]).toBe("sent");
  });
});

describe("the small readers", () => {
  it("ran out is a sent quote whose last day is before today where the business is", () => {
    const quote = { status: "sent", validUntil: "2026-07-27" } as CustomerQuote;
    expect(ranOut(quote, "2026-07-28")).toBe(true);
    expect(ranOut(quote, "2026-07-27")).toBe(false);
    expect(ranOut({ ...quote, status: "accepted" }, "2026-07-28")).toBe(false);
    expect(ranOut({ ...quote, validUntil: null }, "2026-07-28")).toBe(false);
    // 23:30 UTC on the 27th is already the 28th in Auckland, and still the 27th in London.
    const at = new Date("2026-07-27T23:30:00Z");
    expect(today("Pacific/Auckland", at)).toBe("2026-07-28");
    expect(today("Europe/London", at)).toBe("2026-07-28");
    expect(today("America/New_York", at)).toBe("2026-07-27");
  });

  it("the code is what follows #, and nothing that is not a code", () => {
    expect(codeOf("#7K2M9QXW4R8TB3NV")).toBe("7K2M9QXW4R8TB3NV");
    expect(codeOf("7K2M9QXW4R8TB3NV")).toBe("7K2M9QXW4R8TB3NV");
    expect(codeOf("#%20 7K2M9QXW4R8TB3NV")).toBe("7K2M9QXW4R8TB3NV");
    expect(codeOf("")).toBe("");
    expect(codeOf("#")).toBe("");
    expect(codeOf("#<script>")).toBe("");
    expect(codeOf("#a/b")).toBe("");
  });
});

describe("paying for an accepted quote", () => {
  const accepted: Row = { ...sent, status: "accepted", decided_at: "2026-07-28T09:00:00.000Z", accepted_name: "Ruth Adeyemi", pay_ask: "deposit", pay_pct: 20, pay_amount: "712.80", pay_paid: "0.00", pay_refunded: "0.00", pay_due: "712.80", pay_paid_at: null, pay_open: 1 };
  const paying = (said: { online: boolean; test?: true } | Error, started: { payUrl: string } | Error = { payUrl: "https://pay.example.com/pay/abc" }, stands: PayState | Error = "none") => {
    const s = server(accepted);
    const asked: string[] = [];
    s.door.payments = {
      state: async (ref, id) => {
        asked.push(`state ${ref} ${id}`);
        if (stands instanceof Error) throw stands;
        return { state: stands };
      },
      available: async () => {
        if (said instanceof Error) throw said;
        return said;
      },
      start: async (ref, id) => {
        asked.push(`${ref} ${id}`);
        if (started instanceof Error) throw started;
        return started;
      },
    };
    return { ...s, asked };
  };
  const opened = async (link: ReturnType<typeof quoteLink>): Promise<CustomerQuote> => {
    const result = await link.open();
    if (result.state !== "open") throw new Error(result.state);
    return result.quote;
  };

  it("reads what is asked, paid, given back and left as the server says it", async () => {
    const quote = await opened(quoteLink(paying({ online: true }).door, "GOODCODE12345678", tables, NOW));
    expect(quote).toMatchObject({ payAsk: "deposit", payPct: 20, payAmount: 712.8, payPaid: 0, payRefunded: 0, payDue: 712.8, payPaidAt: null, payOpen: true });
    // A quote made before anything was asked, or read by a server that says nothing of it, asks nothing.
    const s = server({ ...sent, status: "accepted" });
    expect(await opened(quoteLink(s.door, "GOODCODE12345678", tables, NOW))).toMatchObject({ payAsk: "off", payDue: 0, payOpen: false });
  });

  it("offers Pay now only while the business takes payments online and something is left to pay", async () => {
    const quote = await opened(quoteLink(paying({ online: true }).door, "GOODCODE12345678", tables, NOW));
    expect(payable(quote, { online: true, test: false })).toBe(true);
    expect(payable(quote, { online: false, test: false })).toBe(false);
    expect(payable(quote, null)).toBe(false);
    expect(payable({ ...quote, payDue: 0 }, { online: true, test: false })).toBe(false);
    // Accepted on a deal that was lost: the page reads as it always did.
    expect(payable({ ...quote, payOpen: false }, { online: true, test: false })).toBe(false);
    expect(payable({ ...quote, payAsk: "off" }, { online: true, test: false })).toBe(false);
    expect(payable({ ...quote, status: "sent" }, { online: true, test: false })).toBe(false);
  });

  it("says nothing is offered while the business takes no payments online, or when Adminium does not answer", async () => {
    const plain = server(accepted);
    expect(await quoteLink(plain.door, "GOODCODE12345678", tables, NOW).offer()).toEqual({ online: false, test: false });
    expect(await quoteLink(paying(new Error("down")).door, "GOODCODE12345678", tables, NOW).offer()).toEqual({ online: false, test: false });
    expect(await quoteLink(paying({ online: true, test: true }).door, "GOODCODE12345678", tables, NOW).offer()).toEqual({ online: true, test: true });
    expect(await quoteLink(null, "GOODCODE12345678", tables, NOW).offer()).toEqual({ online: false, test: false });
  });

  it("asks Adminium for the quote's pay link by its key alone, never an amount", async () => {
    const s = paying({ online: true });
    const link = quoteLink(s.door, "GOODCODE12345678", tables, NOW);
    const quote = await opened(link);
    expect(await link.pay(quote)).toEqual({ state: "go", payUrl: "https://pay.example.com/pay/abc" });
    expect(s.asked).toEqual(["crm_quotes 7"]);
  });

  it("reads the quote again when Adminium will not start it, and says so when it does not answer", async () => {
    for (const error of [refused("PUBLIC_PAY_REFUSED", 409), refused("PUBLIC_REF_NOT_FOUND", 404)]) {
      const link = quoteLink(paying({ online: true }, error).door, "GOODCODE12345678", tables, NOW);
      expect(await link.pay(await opened(link)), error.message).toEqual({ state: "changed" });
    }
    const down = quoteLink(paying({ online: true }, refused("PUBLIC_NETWORK_UNAVAILABLE", 0)).door, "GOODCODE12345678", tables, NOW);
    expect(await down.pay(await opened(down))).toEqual({ state: "unreachable" });
  });

  it("asks how the quote's payment stands by its key alone, and says unknown when Adminium does not answer", async () => {
    for (const stands of ["none", "open", "confirming", "paid", "failed", "expired"] as const) {
      const s = paying({ online: true }, undefined, stands);
      const link = quoteLink(s.door, "GOODCODE12345678", tables, NOW);
      expect(await link.payState(await opened(link))).toBe(stands);
      expect(s.asked).toEqual(["state crm_quotes 7"]);
    }
    const down = quoteLink(paying({ online: true }, undefined, refused("PUBLIC_NETWORK_UNAVAILABLE", 0)).door, "GOODCODE12345678", tables, NOW);
    expect(await down.payState(await opened(down))).toBe("unknown");
    // Not opened yet, or no door: nothing is asked.
    const s = paying({ online: true });
    expect(await quoteLink(s.door, "GOODCODE12345678", tables, NOW).payState({} as CustomerQuote)).toBe("unknown");
    expect(s.asked).toEqual([]);
  });

  it("back from the pay page: the paid line once the quote says it, and what Adminium says until then", async () => {
    const quote = await opened(quoteLink(paying({ online: true }).door, "GOODCODE12345678", tables, NOW));
    const paid = { ...quote, payPaid: 712.8, payDue: 0 };
    // The quote says it is paid: whatever the last payment's state, nothing is left to pay.
    for (const stands of ["none", "open", "confirming", "paid", "failed", "expired", "unknown"] as const) expect(afterPaying(stands, paid), stands).toBe("paid");
    // Not on the quote yet: the bank confirming it, didn't finish and ran out are said; a checkout still open, money that
    // arrived and is not written down yet, or no answer, are looked for again; nothing started is the page as it was.
    expect(afterPaying("confirming", quote)).toBe("confirming");
    expect(afterPaying("failed", quote)).toBe("failed");
    expect(afterPaying("expired", quote)).toBe("expired");
    expect(afterPaying("open", quote)).toBe("look");
    expect(afterPaying("paid", quote)).toBe("look");
    expect(afterPaying("unknown", quote)).toBe("look");
    expect(afterPaying("none", quote)).toBe("ask");
    // A deposit paid and part of it given back: something is due again, and the last payment's state says the rest.
    expect(afterPaying("paid", { ...quote, payPaid: 200, payRefunded: 512.8, payDue: 512.8 })).toBe("look");
  });

  it("reads the quote again through the link already opened, without opening it again", async () => {
    const s = paying({ online: true });
    const link = quoteLink(s.door, "GOODCODE12345678", tables, NOW);
    await opened(link);
    s.set({ ...accepted, pay_paid: "712.80", pay_due: "0.00", pay_paid_at: "2026-07-28T09:05:00.000Z" });
    const again = await link.refresh();
    expect(again.state === "open" ? again.quote : null).toMatchObject({ payPaid: 712.8, payDue: 0 });
    expect(s.calls.filter((call) => call.startsWith("open "))).toHaveLength(1);
  });
});

describe("coming back from the pay page", () => {
  const kept = (value: string | null) => ({ getItem: () => value });
  it("opens the quote this tab went to pay for, for a few hours", () => {
    const at = Date.parse("2026-07-28T09:00:00Z");
    expect(wentToPay(kept(JSON.stringify({ code: "GOODCODE12345678", at })), at + 60_000)).toBe("GOODCODE12345678");
    expect(wentToPay(kept(JSON.stringify({ code: "GOODCODE12345678", at })), at + 4 * 3_600_000)).toBeNull();
  });
  it("takes nothing that is not a code, and no storage at all", () => {
    expect(wentToPay(kept(JSON.stringify({ code: "<script>", at: Date.now() })))).toBeNull();
    expect(wentToPay(kept("not json"))).toBeNull();
    expect(wentToPay(kept(null))).toBeNull();
    expect(wentToPay(null)).toBeNull();
    expect(wentToPay({ getItem: () => { throw new Error("refused"); } })).toBeNull();
  });
});
