/**
 * A company's details for Lead finder: the three columns `companies` gains
 * (its number in the register, its phone, what it does), the `lead` word the
 * companies entry of `people` says them with, Lead finder suggested and not
 * ticked, and its rows in the sample (`sampleData.addOns["lead-finder"]`,
 * naming companies and contacts of the CRM's own sample).
 *
 * Read against the manifest, the vendored validator and the sample files. That
 * the app installs, that the sample loads and leaves whole with Lead finder and
 * without it, that an update keeps every company and leaves the new columns
 * empty, and that a lead source add-on is told the map, is proved on the whole
 * server, on three engines (`proofs/crm-lead.test.ts`, `proofs/crm-update.test.ts`).
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import released from "../../manifest.json";
import whole from "../../whole/manifest.json";
import main from "../../whole/seeds/meridian.json";
import section from "../../whole/seeds/meridian.lead-finder.json";
import { validateManifest } from "./manifest/index.ts";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
type Column = { ref: string; type: string; nullable?: boolean; maxLength?: number; unique?: boolean; rules?: Record<string, unknown>; label?: Record<string, string> };
type Table = { ref: string; indexes?: string[][]; columns: Column[] };
type Row = Record<string, unknown>;
type Role = { key: string; permissions: string[]; limits?: Record<string, { writable?: string[]; creatable?: string[] }> };
interface Doc {
  compatibility: { minAdminiumVersion: string };
  requiredSchema: { tables: Table[] };
  people: { table: string; kind: string; name?: string; lead?: Record<string, unknown> }[];
  roles: Role[];
  addOns: { suggests: { key: string; range: string; checked?: boolean; reason: Record<string, string> }[] };
  sampleData: { addOns?: Record<string, { file: string }> };
}

/** Where a found company's details go: the CRM's own columns, none renamed. */
const LEAD = {
  number: "company_number",
  website: "website",
  phone: "phone",
  address: { lines: "address_lines", town: "town", region: "region", postalCode: "postal_code", country: "country" },
  activity: "sector",
  about: "about",
  owner: "account_owner_id",
};
const NEW_COLUMNS = ["company_number", "phone", "about"];

const issuesOf = (raw: unknown): { path: string; message: string }[] => {
  const result = validateManifest(raw);
  return result.ok ? [] : result.issues.map((issue) => ({ path: String(issue.path), message: String(issue.message) }));
};

for (const [name, raw] of [
  ["the whole app", whole],
  ["the released stage", released],
] as const) {
  const doc = raw as unknown as Doc;
  const companies = doc.requiredSchema.tables.find((one) => one.ref === "companies")!;
  const column = (ref: string) => companies.columns.find((one) => one.ref === ref);
  const at = doc.people.findIndex((one) => one.table === "companies");

  describe(`a company's details for Lead finder, in ${name}`, () => {
    it("still passes the validator, and needs Adminium 0.3.66, which knows the lead word", () => {
      expect(issuesOf(raw)).toEqual([]);
      expect(doc.compatibility.minAdminiumVersion).toBe("0.3.66");
      // Under an older floor the word is unknown: the entry would be refused, so the floor cannot go back.
      const older = issuesOf({ ...structuredClone(raw), compatibility: { ...doc.compatibility, minAdminiumVersion: "0.3.65" } });
      expect(older.map((issue) => issue.path)).toContainEqual(expect.stringContaining(`people.${String(at)}.lead`));
    });

    it("keeps a company's number in the register, its phone and what it does, each may be empty, labelled in eight languages", () => {
      expect(column("company_number")).toMatchObject({ type: "text", maxLength: 40, nullable: true, rules: { normalize: "code" } });
      expect(column("phone")).toMatchObject({ type: "text", maxLength: 40, nullable: true, rules: { personal: false } });
      expect(column("about")).toMatchObject({ type: "text", maxLength: 1000, nullable: true });
      for (const ref of NEW_COLUMNS) expect(Object.keys(column(ref)!.label ?? {}).sort(), ref).toEqual([...LOCALES].sort());
    });

    it("looks a company up by its number, which two companies may share; the CRM's own customer number stays its own and unique", () => {
      expect(companies.indexes).toContainEqual(["company_number"]);
      expect(column("company_number")!.unique).toBeUndefined();
      expect(column("customer_no")).toMatchObject({ unique: true, rules: { normalize: "code" } });
    });

    it("says on the companies entry where each detail goes, over the CRM's own columns", () => {
      expect(doc.people[at]).toEqual({ table: "companies", kind: "companies", name: "name", lead: LEAD });
      // Each column it names is there, text with a width; the country two wide; the owner a staff member.
      const named = [LEAD.number, LEAD.website, LEAD.phone, ...Object.values(LEAD.address), LEAD.activity, LEAD.about];
      for (const ref of named) expect(column(ref), ref).toMatchObject({ type: "text", maxLength: expect.any(Number) });
      expect(column("country")!.maxLength).toBe(2);
      expect(column("account_owner_id")).toMatchObject({ type: "text", rules: { staff: true } });
    });

    it("is refused by the validator with a country column wider than two, and an owner who is not staff", () => {
      const wider = structuredClone(raw) as unknown as Doc;
      wider.requiredSchema.tables.find((one) => one.ref === "companies")!.columns.find((one) => one.ref === "country")!.maxLength = 40;
      expect(issuesOf(wider)).toContainEqual({ path: `people.${String(at)}.lead.address.country`, message: expect.stringContaining("exactly 2 wide") });
      const plain = structuredClone(raw) as unknown as Doc;
      delete plain.requiredSchema.tables.find((one) => one.ref === "companies")!.columns.find((one) => one.ref === "account_owner_id")!.rules;
      expect(issuesOf(plain).map((issue) => issue.path)).toContain(`people.${String(at)}.lead.owner`);
    });

    it("lets whoever adds or changes a company's website add and change the three as well", () => {
      for (const role of doc.roles) {
        const limit = role.limits?.["companies"];
        for (const list of ["writable", "creatable"] as const) {
          if (limit?.[list] === undefined) continue;
          expect(limit[list]!.includes("website"), `${role.key} ${list}`).toBe(true);
          for (const ref of NEW_COLUMNS) expect(limit[list], `${role.key} ${list}`).toContain(ref);
        }
      }
    });

    it("suggests Lead finder, not ticked, from its first release, saying what it does in eight languages", () => {
      const suggested = doc.addOns.suggests.find((one) => one.key === "lead-finder")!;
      expect(suggested).toMatchObject({ range: ">=1.0.32" });
      expect(suggested.checked).toBeUndefined();
      expect(Object.keys(suggested.reason).sort()).toEqual([...LOCALES].sort());
      expect(doc.addOns.suggests.length).toBeLessThanOrEqual(8);
      // The words: never "lead" as a state, never an app's name, never "pro" or "prospect".
      for (const words of Object.values(suggested.reason)) expect(words).not.toMatch(/\b(leads?|pro|prospects?|Sales CRM)\b|métier|propriétaire/i);
    });

    it("names Lead finder's rows of the sample, added and removed with the rest", () => {
      expect(doc.sampleData.addOns?.["lead-finder"]).toEqual({ file: "seeds/meridian.lead-finder.json" });
    });
  });
}

/* ── the sample ─────────────────────────────────────────────────────────── */

const tables = new Map((main as { tables: { ref: string; rows: Row[] }[] }).tables.map((table) => [table.ref, table.rows]));
const rowsOf = (ref: string): Row[] => tables.get(ref) ?? [];
const labelled = (ref: string, label: string): Row | undefined => rowsOf(ref).find((row) => row["@label"] === label);
const own = section as { format: string; app: string; addOn: string; tables: { ref: string; rows: Row[] }[] };
const ownRows = (ref: string): Row[] => own.tables.find((table) => table.ref === ref)?.rows ?? [];
const refOf = (value: unknown): string => (value as { "@ref": string })["@ref"];
/** The companies Lead finder found, in the CRM's own sample. */
const FOUND = ["co:kestrel-yard", "co:millbeck", "co:ouseburn", "co:tannery-row", "co:fjordlys"];

/** Norway's organisation number: weights 3 2 7 6 5 4 3 2 over the first eight digits, mod 11. */
const passesMod11 = (number: string): boolean => {
  if (!/^\d{9}$/.test(number)) return false;
  const sum = [3, 2, 7, 6, 5, 4, 3, 2].reduce((total, weight, i) => total + weight * Number(number[i]), 0);
  const check = 11 - (sum % 11);
  return (check === 11 ? 0 : check) === Number(number[8]);
};
/** France's SIREN: Luhn over nine digits. */
const passesLuhn = (number: string): boolean =>
  /^\d{9}$/.test(number) &&
  [...number].reverse().reduce((total, digit, i) => {
    const doubled = i % 2 === 1 ? Number(digit) * 2 : Number(digit);
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0) %
    10 ===
    0;

describe("the sample with Lead finder", () => {
  it("is a file of rows for Lead finder, for this app", () => {
    expect([own.format, own.app, own.addOn]).toEqual(["adminium.sample/1", "crm", "lead-finder"]);
    expect(own.tables.map((table) => table.ref)).toEqual(["found_people", "tell_mails", "field_sources"]);
  });

  it("names only companies and contacts the CRM's own sample carries", () => {
    const named = JSON.stringify(own.tables).match(/"@ref":"(co|ct):[^"]+"/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const one of named) {
      const label = (JSON.parse(`{${one}}`) as { "@ref": string })["@ref"];
      expect(labelled(label.startsWith("co:") ? "companies" : "contacts", label), label).toBeDefined();
    }
    for (const row of ownRows("found_people")) {
      expect([row["person_table"], row["company_table"]]).toEqual([{ "@table": "contacts" }, { "@table": "companies" }]);
      expect(refOf(labelled("contacts", refOf(row["person_key"]))!["company_id"])).toBe(refOf(row["company_key"]));
    }
  });

  it("brings five companies it found, nobody's, in no territory, each with its number and site, and four people at them", () => {
    const found = FOUND.map((label) => labelled("companies", label)!);
    for (const company of found) {
      expect(company["company_number"], String(company["@label"])).toEqual(expect.any(String));
      expect(company["website"], String(company["@label"])).toMatch(/^https:\/\/[a-z.]+\.example$/);
      expect(company["account_owner_id"]).toBeUndefined();
      expect(company["territory_id"]).toBeUndefined();
    }
    const people = rowsOf("contacts").filter((row) => FOUND.includes(refOf(row["company_id"])));
    expect(people.map((row) => row["@label"])).toEqual(["ct:robin-hale", "ct:sam-ellery", "ct:jo-ashby", "ct:kari-vik"]);
    // Only the one who agreed by phone may be e-mailed, recorded by who and when; Adminium works out the won deals.
    expect(people.filter((row) => row["may_email"] === true).map((row) => [row["@label"], row["may_email_by_id"]])).toEqual([["ct:kari-vik", { "@person": "dana" }]]);
    for (const row of people) expect(row["won_deals"]).toBeUndefined();
  });

  it("fits each found company's details in the CRM's columns", () => {
    const doc = whole as unknown as Doc;
    const columns = doc.requiredSchema.tables.find((one) => one.ref === "companies")!.columns;
    for (const label of FOUND) {
      for (const [key, value] of Object.entries(labelled("companies", label)!)) {
        if (key.startsWith("@")) continue;
        const declared = columns.find((one) => one.ref === key);
        expect(declared, `${label}.${key}`).toBeDefined();
        if (typeof value === "string" && declared?.maxLength !== undefined) expect(value.length, `${label}.${key}`).toBeLessThanOrEqual(declared.maxLength);
      }
    }
  });

  it("notes the values the companies really hold: each hash is the value's, trimmed", () => {
    expect(ownRows("field_sources").length).toBeGreaterThan(0);
    for (const row of ownRows("field_sources")) {
      expect(row["table_ref"]).toEqual({ "@table": "companies" });
      const company = labelled("companies", refOf(row["row_key"]))!;
      const value = String(company[String(row["column_name"])]);
      expect(row["value_hash"], `${String(company["@label"])}.${String(row["column_name"])}`).toBe(createHash("sha256").update(value.trim()).digest("hex"));
    }
  });

  it("is made up: UK numbers in the unallocated 98 block, Norwegian numbers that fail mod-11, no SIREN that passes, .example everywhere", () => {
    for (const label of FOUND) {
      const company = labelled("companies", label)!;
      const number = String(company["company_number"]);
      if (company["country"] === "GB") expect(number, label).toMatch(/^98\d{6}$/);
      if (company["country"] === "NO") expect(passesMod11(number), label).toBe(false);
      if (company["country"] === "FR") expect(passesLuhn(number), label).toBe(false);
    }
    const text = JSON.stringify(own) + JSON.stringify(FOUND.map((label) => labelled("companies", label)));
    for (const address of text.match(/[a-z0-9.-]+@[a-z0-9.-]+/gi) ?? []) expect(address).toMatch(/\.example$/);
    for (const site of text.match(/https:\/\/[^"\s\\]+/g) ?? []) expect(site).toMatch(/^https:\/\/[a-z.]+\.example(\/|$)/);
    // Never the comps' own sample companies.
    expect(text).not.toMatch(/Ashdown|Wharfedale|Briggate|Northlight|OC412345/);
  });
});
