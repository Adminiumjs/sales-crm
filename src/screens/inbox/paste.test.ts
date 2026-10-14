import { describe, expect, it } from "vitest";

import { sniffMark, stampingFetch, stampList } from "./paste.ts";

describe("a pasted list that belongs to one show", () => {
  it("finds the mark the way the server does: the commonest outside quotes on the first line that says anything", () => {
    expect(sniffMark("a,b,c\n1,2,3")).toBe(",");
    expect(sniffMark("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(sniffMark("a;b;c")).toBe(";");
    expect(sniffMark('"Slate, Barrow & Co"\tLeeds')).toBe("\t");
    expect(sniffMark("  \t \nname;town")).toBe(";");
    expect(sniffMark("one column")).toBe(",");
    // A tie says nothing: a comma, as the server reads it.
    expect(sniffMark("a,b;c")).toBe(",");
  });

  it("puts the two cells in front of every line, the names in front of the first", () => {
    expect(stampList("Company,Person\nKestrel Print,Joss\nVerity,Sadie\n", ["Source", "Trade show"], ["show", "7"])).toBe("Source,Trade show,Company,Person\nshow,7,Kestrel Print,Joss\nshow,7,Verity,Sadie\n");
  });

  it("keeps a pasted sheet's tabs, a line break inside quotes, a line that stops short and a blank line", () => {
    const pasted = 'Company\tWants\tTown\r\n"Slate\n& Barrow"\tBooths\tLeeds\r\n\r\nKestrel\tDesks';
    expect(stampList(pasted, ["Source", "Trade show"], ["show", "7"])).toBe('Source\tTrade show\tCompany\tWants\tTown\r\nshow\t7\t"Slate\n& Barrow"\tBooths\tLeeds\r\n\r\nshow\t7\tKestrel\tDesks');
  });

  it("stamps every line of a list with no names, and quotes a name that holds the mark", () => {
    expect(stampList("Kestrel;Joss\nVerity;Sadie", null, ["show", "7"])).toBe("show;7;Kestrel;Joss\nshow;7;Verity;Sadie");
    expect(stampList("a,b", ["Where it came from, in a word", "Show"], ["show", "7"])).toBe('"Where it came from, in a word",Show,a,b');
    expect(stampList("﻿a,b\n1,2", ["S", "T"], ["show", "7"])).toBe("﻿S,T,a,b\nshow,7,1,2");
  });

  it("stamps the upload only, and leaves every other call alone", async () => {
    const calls: { input: string; body: unknown }[] = [];
    const inner = (input: string, init?: RequestInit): Promise<Response> => {
      calls.push({ input, body: init?.body });
      return Promise.resolve(new Response("{}"));
    };
    const send = stampingFetch(() => ({ header: ["Source", "Trade show"], values: ["show", "7"] }), inner);
    await send("/api/v1/imports/upload?filename=pasted.csv", { method: "POST", body: new Blob(["Company\nKestrel"]) });
    await send("/api/v1/imports/upload?filename=pasted.csv&header=none", { method: "POST", body: "Kestrel" });
    await send("/api/v1/imports", { method: "POST", body: '{"fileId":"f"}' });
    await send("/api/v1/imports/imp_1/preview?offset=0");
    expect(calls).toEqual([
      { input: "/api/v1/imports/upload?filename=pasted.csv", body: "Source,Trade show,Company\nshow,7,Kestrel" },
      { input: "/api/v1/imports/upload?filename=pasted.csv&header=none", body: "show,7,Kestrel" },
      { input: "/api/v1/imports", body: '{"fileId":"f"}' },
      { input: "/api/v1/imports/imp_1/preview?offset=0", body: undefined },
    ]);
    // No show picked: nothing is stamped.
    const plain = stampingFetch(() => null, inner);
    await plain("/api/v1/imports/upload?filename=pasted.csv", { method: "POST", body: "Company\nKestrel" });
    expect(calls[4]).toEqual({ input: "/api/v1/imports/upload?filename=pasted.csv", body: "Company\nKestrel" });
  });
});
