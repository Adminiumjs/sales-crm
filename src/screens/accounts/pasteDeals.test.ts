import { describe, expect, it } from "vitest";

import { dealsFetch, reword, type PreviewLine } from "./pasteDeals.ts";

const LINES: PreviewLine[] = [
  { row: 1, status: "refused", code: "REFUSED", column: "closed_at", message: "closed_at: required", label: "Old refit" },
  { row: 2, status: "new", label: "Mill roof" },
  { row: 3, status: "refused", code: "REFUSED", column: "company_id", message: "company_id: required" },
];

describe("past deals on Paste a list (plan 68 R5)", () => {
  it("says a missing closed date in the reader's words, and nothing else", () => {
    const out = reword(LINES, "Needs a closed date.");
    expect(out[0]).toEqual({ row: 1, status: "refused", code: "REFUSED", message: "Needs a closed date.", label: "Old refit" });
    expect(out[1]).toBe(LINES[1]);
    expect(out[2]).toBe(LINES[2]);
    expect(reword([LINES[1]!], "x")).toEqual([LINES[1]]);
  });

  it("gives every line its owner on the way up, and rewords the preview on the way back", async () => {
    const seen: { input: string; body?: string }[] = [];
    const inner = async (input: string, init?: RequestInit): Promise<Response> => {
      seen.push({ input, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (input.includes("/preview")) return new Response(JSON.stringify({ data: { lines: LINES, counts: { new: 1 } } }), { status: 200, headers: { "content-type": "application/json", "content-length": "999" } });
      return new Response("{}", { status: 201 });
    };
    const send = dealsFetch(() => ({ header: "Owner", id: "u-1" }), () => "Needs a closed date.", inner);
    await send("/api/v1/imports/upload?filename=x.csv", { method: "POST", body: "Name,Closed\nOld refit,\n" });
    expect(seen[0]!.body).toBe("Owner,Name,Closed\nu-1,Old refit,\n");
    const preview = (await (await send("/api/v1/imports/abc/preview?offset=0&limit=100")).json()) as { data: { lines: PreviewLine[]; counts: unknown } };
    expect(preview.data.lines[0]!.message).toBe("Needs a closed date.");
    expect(preview.data.lines[0]!.column).toBeUndefined();
    expect(preview.data.counts).toEqual({ new: 1 });
    // Any other answer passes as it came.
    expect(await (await send("/api/v1/imports/abc")).text()).toBe("{}");
  });
});
