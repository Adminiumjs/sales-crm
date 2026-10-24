/**
 * The office Sign-off's file row (plan 68 S13): drawn through the app's own door, shown only when the door gives a
 * copy, with the file's own name and size from its headers, never a guess.
 */
import { describe, expect, it } from "vitest";

import { StaffError, type StaffSession } from "../../staffSession.ts";
import { filenameOf, readSignedCopy } from "./SignedCopy.tsx";

const reply = (format: string) => ({ contentUrl: "/api/v1/documents/doc_1/content", printUrl: "/api/v1/documents/doc_1/print", document: { format, status: "rendered", hasContent: true } });
const KINDS = { kinds: [{ addOnKey: "invoices", kind: "invoice" }, { addOnKey: "invoices", kind: "signed-copy" }] };
/** A session whose Invoices draws `kinds`, and whose draw answers `answer`; what it was asked to draw goes in `asked`. */
const sessionAnswering = (answer: unknown, asked: unknown[] = [], kinds: unknown = KINDS, addOns: Record<string, unknown> = { invoices: { version: "1.0.14" } }): StaffSession =>
  ({
    config: { addOns },
    call: (method: string, path: string, body: unknown) => {
      if (method === "GET" && path === "/documents/kinds") return Promise.resolve(kinds);
      asked.push({ method, path, body });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  }) as unknown as StaffSession;
const headers = (pairs: Record<string, string>) => async (): Promise<Response> => new Response(null, { status: 200, headers: pairs });

describe("the signed copy's file row", () => {
  it("reads the file's own name from its headers, the UTF-8 form first", () => {
    expect(filenameOf(`attachment; filename="signed-copy-Studio_meeting_tables.pdf"; filename*=UTF-8''signed-copy-Studio%20meeting%20tables.pdf`)).toBe("signed-copy-Studio meeting tables.pdf");
    expect(filenameOf('inline; filename="signed-copy-x.pdf"')).toBe("signed-copy-x.pdf");
    expect(filenameOf(null)).toBeNull();
    expect(filenameOf('inline; filename=""')).toBeNull();
  });

  it("asks the app's door for the sign-off's copy and downloads a PDF from its content, with the size its headers say", async () => {
    const asked: unknown[] = [];
    const copy = await readSignedCopy(sessionAnswering(reply("pdf"), asked), 8, headers({ "content-length": "145408", "content-disposition": "inline; filename*=UTF-8''signed-copy-Studio%20meeting%20tables.pdf" }));
    expect(asked).toEqual([{ method: "POST", path: "/apps/crm/documents/render", body: { kind: "signed-copy", ref: "sign_offs", pk: { id: 8 } } }]);
    expect(copy).toEqual({ url: "/api/v1/documents/doc_1/content", format: "pdf", filename: "signed-copy-Studio meeting tables.pdf", bytes: 145408 });
  });

  it("opens the print page where the add-on drew no PDF (Arabic), and leaves out a size it was not told", async () => {
    expect(await readSignedCopy(sessionAnswering(reply("html")), 8, async () => null)).toEqual({ url: "/api/v1/documents/doc_1/print", format: "html", filename: null, bytes: null });
  });

  it("asks for no copy while Invoices draws no signed copy (1.0.13: it waits), or is not attached", async () => {
    const asked: unknown[] = [];
    expect(await readSignedCopy(sessionAnswering(reply("pdf"), asked, { kinds: [{ addOnKey: "invoices", kind: "invoice" }] }), 8, headers({}))).toBeNull();
    expect(await readSignedCopy(sessionAnswering(reply("pdf"), asked, KINDS, {}), 8, headers({}))).toBeNull();
    expect(asked).toEqual([]);
  });

  it("shows nothing when the door gives no copy: waiting for Invoices' update, no Invoices, or beyond the reader's reach", async () => {
    for (const refusal of [new StaffError(409, "FEATURE_OFF", ""), new StaffError(404, "NOT_FOUND", "")]) expect(await readSignedCopy(sessionAnswering(refusal), 8, headers({}))).toBeNull();
    expect(await readSignedCopy(sessionAnswering({ ...reply("pdf"), document: { format: "pdf", status: "failed", hasContent: false } }), 8, headers({}))).toBeNull();
  });
});
