import { describe, expect, it } from "vitest";

import { addressOf, COMPANY_COLUMNS, fixedOn, CONTACT_COLUMNS, countryName, mainLine, modesFor, newestFirst, openLine, quietLines, readsDeals, sinceOf, toneOf, typed, type Entry, type Mark } from "./data.ts";

describe("what a company's card says about open deals", () => {
  it("a team's reader: the deals she reaches; how many there are where she reaches none; nothing open", () => {
    expect(openLine("team", 2, 2)).toEqual({ kind: "team", count: 2 });
    expect(openLine("team", 0, 3)).toEqual({ kind: "all", count: 3 });
    expect(openLine("team", 0, 0)).toEqual({ kind: "none" });
  });

  it("a rep: her own, or 'none of yours' when a colleague holds one, or nothing open", () => {
    // Nordwind for Dana: one of the two open deals is hers.
    expect(openLine("mine", 1, 2)).toEqual({ kind: "mine", count: 1 });
    // Brightloom for Dana: two open, both colleagues'.
    expect(openLine("mine", 0, 2)).toEqual({ kind: "noneMine" });
    expect(openLine("mine", 0, 0)).toEqual({ kind: "none" });
  });

  it("the account manager and the marketer: how many are open, whatever they read of deals", () => {
    expect(openLine("won", 0, 2)).toEqual({ kind: "all", count: 2 });
    expect(openLine("count", 0, 1)).toEqual({ kind: "all", count: 1 });
    expect(openLine("count", 0, 0)).toEqual({ kind: "none" });
  });

  it("says nothing to a reader of no mark", () => {
    expect(openLine("none", 0, null)).toBeNull();
  });

  it("only the roles that read deals are answered amounts", () => {
    expect((["team", "mine", "won", "count", "none"] as const).map(readsDeals)).toEqual([true, true, true, false, false]);
  });
});

describe("a colleague's open deal is a quiet line", () => {
  const marks: Mark[] = [
    { deal_id: 1, owner_id: "dana", stage_id: 4, state: "open" },
    { deal_id: 12, owner_id: "leo", stage_id: 2, state: "open" },
    { deal_id: 30, owner_id: "sam", stage_id: 4, state: "won" },
    { deal_id: 31, owner_id: "nobody", stage_id: 9, state: "open" },
  ];
  it("one line for each open mark the reader holds no deal for: who has it and its stage, nothing else", () => {
    const lines = quietLines(marks, [{ id: 1 }], { leo: "Leo Vance" }, { "2": "Qualified", "4": "Negotiation" });
    expect(lines).toEqual([
      { key: "12", owner: "Leo Vance", stage: "Qualified" },
      // Somebody whose name was not answered, at a stage that was not: the line still stands, with neither.
      { key: "31", owner: null, stage: null },
    ]);
  });
  it("has none when every open deal there is the reader's", () => {
    expect(quietLines(marks, [{ id: 1 }, { id: 12 }, { id: 31 }], {}, {})).toEqual([]);
  });
});

describe("since when", () => {
  const marks = (states: Mark["state"][]): Mark[] => states.map((state, i) => ({ deal_id: i + 1, state }));
  it("a reader who was answered every deal there: the first win's day, else the first deal's", () => {
    // Nordwind: first won 26 Mar 2026 (h3); Brightloom: nothing won, first opened 5 Sep 2025.
    expect(sinceOf("team", "2026-03-26", "2025-08-01", marks(["open", "won"]), true)).toEqual({ kind: "customer", on: "2026-03-26" });
    expect(sinceOf("team", null, "2025-09-05", marks(["open", "lost"]), true)).toEqual({ kind: "talking", on: "2025-09-05" });
    expect(sinceOf("team", null, null, [], true)).toEqual({ kind: "new" });
    // A rep at a company where every deal is hers is answered them all.
    expect(sinceOf("mine", "2026-04-28", "2025-09-08", marks(["won", "open"]), true)).toEqual({ kind: "customer", on: "2026-04-28" });
  });
  it("a reader who was NOT answered every deal is told 'customer' or 'in conversation' from the marks, with no day", () => {
    expect(sinceOf("mine", null, "2025-08-01", marks(["open", "won"]), false)).toEqual({ kind: "customer", on: null });
    expect(sinceOf("mine", "2026-04-28", "2025-09-08", marks(["open", "open"]), false)).toEqual({ kind: "talking", on: null });
    // A manager who leads part of the team is not everybody's reader either.
    expect(sinceOf("team", "2026-04-28", "2025-09-08", marks(["won", "open", "lost"]), false)).toEqual({ kind: "customer", on: null });
  });
  it("the account manager reads every won deal, so he is answered the day of the first win", () => {
    expect(sinceOf("won", "2026-03-26", "2026-01-14", marks(["won", "open"]), false)).toEqual({ kind: "customer", on: "2026-03-26" });
    expect(sinceOf("won", null, null, marks(["open"]), false)).toEqual({ kind: "talking", on: null });
  });
  it("the marketer's marks say whether a deal was won, and no day", () => {
    expect(sinceOf("count", null, null, marks(["won"]), true)).toEqual({ kind: "customer", on: null });
  });
  it("a reader of no mark is told nothing", () => {
    expect(sinceOf("none", null, null, null, false)).toBeNull();
  });
});

describe("what a contact's card says about deals", () => {
  it("names the deal only when it is the one open deal and the reader may open it", () => {
    expect(mainLine(1, [{ id: 3, name: "Records-room lockers" }])).toEqual({ kind: "deal", id: 3, name: "Records-room lockers" });
  });
  it("is a count for a colleague's deal, and for several", () => {
    // Ines for Dana: one open deal, Sam's.
    expect(mainLine(1, [])).toEqual({ kind: "count", count: 1 });
    // Marta: two open deals, both Dana's: a count all the same.
    expect(mainLine(2, [{ id: 2, name: "a" }, { id: 13, name: "b" }])).toEqual({ kind: "count", count: 2 });
    // Two open, one hers: the count, never the one name (it would say which is whose).
    expect(mainLine(2, [{ id: 2, name: "a" }])).toEqual({ kind: "count", count: 2 });
  });
  it("says nothing for somebody on no open deal, and nothing to a reader who is not answered the count", () => {
    expect(mainLine(0, [])).toBeNull();
    expect(mainLine(null, [])).toBeNull();
  });
});

describe("the small things", () => {
  it("narrows a list by what was typed, over the columns named, with the wildcards of the typed words taken literally", () => {
    expect(typed(["name", "town"], "  ")).toBeUndefined();
    expect(typed(["name", "town"], "50%_off")).toEqual({ or: [{ column: "name", op: "ilike", value: "%50\\%\\_off%" }, { column: "town", op: "ilike", value: "%50\\%\\_off%" }] });
  });
  it("puts the newest entry first and keeps two of one moment in one order", () => {
    const entry = (key: string, at: string): Entry => ({ key, at, type: "note", who: null, dealId: 1, deal: null, text: null });
    expect([entry("a2", "2026-07-27T10:00:00Z"), entry("s1", "2026-07-28T09:00:00Z"), entry("a1", "2026-07-27T10:00:00Z")].sort(newestFirst).map((one) => one.key)).toEqual(["s1", "a1", "a2"]);
  });
  it("gives a company one of eight tones by its number", () => {
    expect([0, 1, 7, 8, 9, 4.7].map(toneOf)).toEqual([0, 1, 7, 0, 1, 4]);
  });
  it("writes an address on one line with the country's name in the reader's language, leaving out what is empty or kept", () => {
    const hull = { address_lines: null, town: "Hull", region: null, postal_code: null, country: "GB" };
    expect(addressOf(hull, "en-US")).toBe("Hull, United Kingdom");
    expect(addressOf({ ...hull, address_lines: "Gate 4, Marfleet Dock Road", postal_code: "HU9 5NS" }, "de-DE")).toBe("Gate 4, Marfleet Dock Road, Hull, HU9 5NS, Vereinigtes Königreich");
    expect(countryName(null, "en-US")).toBeNull();
    expect(countryName("zz9", "en-US")).toBe("zz9");
  });
});

describe("paste a list", () => {
  it("offers 'update' to the CRM admin only, and 'skip' first to everybody", () => {
    expect(modesFor(true, true)).toEqual(["skip", "update"]);
    expect(modesFor(false, true)).toEqual(["skip"]);
    expect(modesFor(true, false)).toEqual(["skip"]);
  });
  it("brings no column the server works out, and no street or postal code (kept from the roles that paste)", () => {
    expect(COMPANY_COLUMNS).not.toContain("address_lines");
    expect(COMPANY_COLUMNS).not.toContain("postal_code");
    for (const column of ["id", "retry_key", "lat", "lng", "place", "account_owner_id"]) expect(COMPANY_COLUMNS as readonly string[]).not.toContain(column);
    expect(CONTACT_COLUMNS).toContain("company_id");
    expect(CONTACT_COLUMNS).toContain("may_email");
  });
});

describe("what a record shows and does not let change", () => {
  it("keeps a contact's e-mail and a company's street from a rep and an account manager, and from nobody who leads or runs the CRM", () => {
    expect(fixedOn("contact", ["crm-rep"])).toEqual(["email"]);
    expect(fixedOn("company", ["crm-account-manager"])).toEqual(["address_lines", "postal_code"]);
    expect(fixedOn("contact", ["crm-rep", "crm-sales-manager"])).toEqual([]);
    expect(fixedOn("company", ["crm-admin"])).toEqual([]);
    // The install's owner holds no app role: nothing is kept from her.
    expect(fixedOn("contact", [])).toEqual([]);
  });
});
