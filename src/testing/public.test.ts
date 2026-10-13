/**
 * What the app opens to somebody with no account: one quote by its own link,
 * and nothing of the business's side of it (F16).
 */
import { describe, expect, it } from "vitest";

import released from "../../manifest.json";
import whole from "../../whole/manifest.json";

interface Entry {
  table: string;
  key?: string;
  module?: string;
  methods: string[];
  select?: string[];
  writable?: string[];
  writableValues?: Record<string, unknown[]>;
  writableWhen?: Record<string, unknown>;
  requires?: string[];
  requiresWhen?: Record<string, unknown>;
  filters?: { column: string; op: string; value: unknown }[];
  claim?: Record<string, unknown>;
  visibleWith?: { table: string; via: string };
  level?: string;
}
type Doc = { publicAccess?: Entry[]; publicKeys?: Record<string, unknown>; frontends: { side: string; routes?: Record<string, string> }[]; emailTemplates: { key: string; vars?: string[]; locales: Record<string, { blocks: { block: string; data: Record<string, unknown> }[] }> }[] };

/** Everything a customer may ever read of a quote and of a line: F16's list, and `id` to tie a line to its quote. */
const QUOTE = ["id", "number", "version", "status", "valid_until", "currency", "tax_name", "tax_rate", "subtotal", "tax", "total", "notes", "sent_at", "decided_at", "accepted_name"];
const LINE = ["id", "document_id", "position", "description", "qty", "rate", "discount_kind", "discount", "currency", "amount"];

for (const [name, doc] of [
  ["the whole app", whole as unknown as Doc],
  ["the released stage", released as unknown as Doc],
] as const) {
  describe(`the public door of ${name}`, () => {
    const entries = doc.publicAccess ?? [];
    const quote = entries.find((entry) => entry.table === "quotes")!;
    const line = entries.find((entry) => entry.table === "quote_lines")!;

    it("is two entries, both on the quote's own key and both of the Quotes part", () => {
      expect(entries.map((entry) => entry.table)).toEqual(["quotes", "quote_lines"]);
      expect(Object.keys(doc.publicKeys ?? {})).toEqual(["quote"]);
      for (const entry of entries) {
        expect(entry.key).toBe("quote");
        expect(entry.module).toBe("quotes");
      }
    });

    it("opens a quote by the code of its own link, mailed only to the address it was sent to", () => {
      expect(quote.claim).toEqual({ by: "token", column: "share_code", own: true, address: "sent_to_email" });
    });

    it("answers exactly the allowed columns of a quote and of a line, and never the code", () => {
      expect(quote.select).toEqual(QUOTE);
      expect(line.select).toEqual(LINE);
      for (const hidden of ["share_code", "deal_id", "list_value", "under_list_pct", "approval", "ask_reason", "decision_note", "asked_by_id", "decided_by_id", "to_email", "sent_to_email", "sent_to_name", "threshold_pct", "withdraw_reason", "accepted_via"]) {
        expect(quote.select, hidden).not.toContain(hidden);
      }
      for (const hidden of ["price_id", "list_rate", "list_amount", "unlisted", "unlisted_amount", "retry_key"]) expect(line.select, hidden).not.toContain(hidden);
    });

    it("keeps the code from everybody on the staff: an answer 'by the customer' came through the mailed link", () => {
      const quotes = (doc as unknown as { requiredSchema: { tables: { ref: string; columns: { ref: string; rules?: { code?: unknown } }[] }[] } }).requiredSchema.tables.find((table) => table.ref === "quotes")!;
      expect(quotes.columns.find((column) => column.ref === "share_code")!.rules?.code).toEqual({ length: 16, hiddenFromStaff: true });
    });

    it("reaches only a quote that was sent, accepted or declined: a draft and a replaced version answer nothing", () => {
      expect(quote.filters).toEqual([{ column: "status", op: "in", value: ["sent", "accepted", "declined"] }]);
      expect(line.visibleWith).toEqual({ table: "quotes", via: "document_id" });
      expect(line.methods).toEqual(["GET"]);
    });

    it("takes one change: a sent quote, still in date, accepted or declined", () => {
      expect(quote.methods).toEqual(["GET", "PATCH"]);
      expect(quote.writable).toEqual(["status", "accepted_name"]);
      expect(quote.writableValues).toEqual({ status: ["accepted", "declined"] });
      expect(quote.writableWhen).toEqual({ status: ["sent"] });
      // A name goes in with an Accept and with nothing else; a Decline carries none.
      expect(quote.requiresWhen).toEqual({ accepted_name: { status: ["accepted"] } });
      // "Still in date" is the move's own rule, so it holds the office's late "accepted" too, and the link stays readable.
      const moves = (doc as unknown as { requiredSchema: { tables: { ref: string; states?: { moves: Record<string, unknown[]> } }[] } }).requiredSchema.tables.find((table) => table.ref === "quotes")!.states!.moves["sent"];
      expect(moves).toEqual([{ to: "accepted", requires: { notPast: "valid_until" } }, { to: "declined", requires: { notPast: "valid_until" } }, "withdrawn"]);
    });

    it("has a customer side, and the quote's e-mail carries its link", () => {
      expect(doc.frontends.map((side) => side.side)).toEqual(["staff", "customer"]);
      expect(doc.frontends[1]!.routes).toEqual({ manage: "/" });
      const mail = doc.emailTemplates.find((template) => template.key === "crm-quote-sent")!;
      expect(Object.keys(mail.locales)).toHaveLength(8);
      for (const [language, body] of Object.entries(mail.locales)) {
        const button = body.blocks.find((block) => block.block === "email.button");
        expect(button?.data["url"], language).toBe("{{manage_url}}#{{quote.share_code}}");
        expect(String(button?.data["label"] ?? ""), language).not.toBe("");
      }
    });
  });
}
