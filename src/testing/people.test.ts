/**
 * THE PEOPLE THIS APP KEEPS, as Adminium reads them from 0.3.38 on (`people`):
 * who may be e-mailed, by which address and name, what says yes, who counts as
 * a customer, where a screen offered them a way to say no, and every copy of
 * them on another table (found, exported and blanked with them).
 *
 * The validator holds the shapes (a column of the right kind, a link to the
 * right table). What it cannot know is that the list is whole: that each copy
 * of a person this app keeps is named, that the yes is the newsletter's, that
 * the law keeps the signed records. That is held here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";
import { validateManifest } from "./manifest/index.ts";

interface Column {
  ref: string;
  type: string;
  references?: string;
  nullable?: boolean;
  default?: unknown;
  rules?: Record<string, unknown> & { personal?: boolean; stamp?: { strict?: boolean; on?: unknown }; rollup?: unknown };
}
interface Table {
  ref: string;
  keep?: { law: string };
  columns: Column[];
}
interface Copy {
  table: string;
  column: string;
  holds: "email" | "name" | "phone";
  via?: string;
}
interface Entry {
  table: string;
  kind: "people" | "companies";
  email?: string;
  name?: string;
  company?: string;
  firstName?: unknown;
  consent?: { column: string; purpose: string };
  copies?: Copy[];
  customer?: string;
  optOutMark?: string | { column: string; carryFrom?: { table: string; column: string } };
  carry?: unknown[];
}
interface Role {
  key: string;
  permissions: string[];
  limits?: Record<string, { writable?: string[]; creatable?: string[]; readable?: string[] }>;
}

const doc = manifest as unknown as { people?: Entry[]; requiredSchema: { tables: Table[] }; roles: Role[]; outbox: { recipient: { table: string; email: string; via: string } }; compatibility: { minAdminiumVersion: string } };
const people = doc.people ?? [];
const tables = doc.requiredSchema.tables;
const table = (ref: string): Table => tables.find((one) => one.ref === ref)!;
const column = (ref: string, name: string): Column | undefined => table(ref).columns.find((one) => one.ref === name);
const entry = (ref: string): Entry => people.find((one) => one.table === ref)!;

describe("the people of the app", () => {
  it("are three tables: contacts and the enquiries' people, who may be mailed, and the companies they work for", () => {
    expect(people.map((one) => [one.table, one.kind])).toEqual([
      ["contacts", "people"],
      ["companies", "companies"],
      ["enquiries", "people"],
    ]);
    expect(doc.compatibility.minAdminiumVersion).toBe("0.3.38");
  });

  it("names a contact by her name and her address, the one the outbox writes to, and greets her by her first name", () => {
    expect(entry("contacts")).toMatchObject({ email: "email", name: "name", company: "company_id", firstName: "firstWordOfName" });
    expect(doc.outbox.recipient).toMatchObject({ table: "contacts", email: entry("contacts").email });
    expect(entry("enquiries")).toMatchObject({ email: "email", name: "person", firstName: "firstWordOfName" });
    expect(entry("companies")).toEqual({ table: "companies", kind: "companies", name: "name" });
  });

  it("reads a contact's \"may be e-mailed\" as the newsletter's yes; an enquiry's answer is kept in the consent log alone", () => {
    expect(entry("contacts").consent).toEqual({ column: "may_email", purpose: "newsletter" });
    expect(column("contacts", "may_email")).toMatchObject({ type: "bool", default: false });
    expect(entry("enquiries").consent).toBeUndefined();
  });

  it("counts a contact as a customer by her won deals, worked out by Adminium over the deals she was the contact of", () => {
    expect(entry("contacts").customer).toBe("won_deals");
    expect(column("contacts", "won_deals")).toMatchObject({ type: "int", default: 0, rules: { rollup: { from: "deals", via: "contact_id", count: true, where: { column: "state", eq: "won" } } } });
    expect(column("deals", "contact_id")).toMatchObject({ type: "fk", references: "contacts" });
    expect((column("deals", "state") as Column & { enum?: string[] }).enum).toContain("won");
    // An enquiry is somebody not yet on the books: never an existing customer.
    expect(entry("enquiries").customer).toBeUndefined();
  });

  it("marks the moment a staff screen offered a way to say no: a strict stamp on both tables, carried from a claimed enquiry to the contact made of it", () => {
    expect(entry("contacts").optOutMark).toEqual({ column: "opt_out_offered_at", carryFrom: { table: "enquiries", column: "opt_out_offered_at" } });
    expect(entry("enquiries").optOutMark).toBe("opt_out_offered_at");
    for (const ref of ["contacts", "enquiries"]) {
      const mark = column(ref, "opt_out_offered_at");
      expect(mark, ref).toMatchObject({ type: "timestamptz", nullable: true });
      expect(mark?.rules?.stamp?.strict, ref).toBe(true);
    }
  });

  it("carries the old unsubscribe mark onto the do-not-email list once, and keeps the column for that one release", () => {
    expect(entry("contacts").carry).toEqual([{ stopList: { column: "unsubscribed_at" } }]);
    expect(column("contacts", "unsubscribed_at")).toMatchObject({ type: "timestamptz", nullable: true });
    // Nothing writes it but the CRM admin's raw edit: no role's screen, no rule.
    for (const role of doc.roles) if (role.key !== "admin") expect(role.limits?.["contacts"]?.writable ?? [], role.key).not.toContain("unsubscribed_at");
  });

  it("keeps the count and both marks out of every role's writes: the server's alone", () => {
    for (const role of doc.roles) {
      if (role.key === "admin") continue;
      for (const [ref, name] of [["contacts", "won_deals"], ["contacts", "opt_out_offered_at"], ["enquiries", "opt_out_offered_at"]] as const) {
        const limit = role.limits?.[ref];
        if (role.permissions.includes(`table:@${ref}:update`)) expect(limit?.writable, `${role.key}: ${ref}.${name}`).toBeDefined();
        expect(limit?.writable ?? [], `${role.key}: ${ref}.${name}`).not.toContain(name);
      }
      if (role.permissions.includes("table:@contacts:create")) expect(role.limits?.["contacts"]?.creatable ?? ["won_deals"], role.key).not.toContain("won_deals");
    }
  });
});

describe("every copy of a contact on another table is named", () => {
  const copies = entry("contacts").copies ?? [];

  it("lists the quote's, the sign-off's, the refused sign-off's, the delivery note's and the showroom booking's", () => {
    expect(copies.map((copy) => `${copy.table}.${copy.column}:${copy.holds}${copy.via === undefined ? "" : `<${copy.via}`}`)).toEqual([
      "quotes.to_email:email<sent_to_contact_id",
      "quotes.to_name:name<sent_to_contact_id",
      "quotes.sent_to_email:email<sent_to_contact_id",
      "quotes.sent_to_name:name<sent_to_contact_id",
      "quotes.accepted_name:name<sent_to_contact_id",
      // A sign-off reaches its contact only through its job's deal: no link of its own to follow. The address a copy went to
      // is found by the address itself.
      "sign_offs.signer_name:name",
      "sign_offs.copy_sent_to:email",
      "refused_sign_offs.signer_name:name",
      "delivery_notes.signed_name:name<signed_by_contact_id",
      "showroom_bookings.visitor_name:name<contact_id",
    ]);
  });

  it("names columns the tables have, each a text column, each link one to contacts", () => {
    for (const copy of copies) {
      expect(column(copy.table, copy.column)?.type, `${copy.table}.${copy.column}`).toBe("text");
      if (copy.via !== undefined) expect(column(copy.table, copy.via), `${copy.table}.${copy.via}`).toMatchObject({ type: "fk", references: "contacts" });
    }
  });

  it("misses no copy Adminium keeps by itself: every column copied from a contact's address or name is listed", () => {
    const followed = tables.flatMap((one) =>
      one.columns
        .filter((c) => {
          const copy = c.rules?.["copy"] as { via?: string; from?: string } | undefined;
          return copy !== undefined && ["email", "name", "phone"].includes(copy.from ?? "") && column(one.ref, copy.via ?? "")?.references === "contacts";
        })
        .map((c) => `${one.ref}.${c.ref}`),
    );
    expect(followed.length).toBeGreaterThan(0);
    for (const id of followed) expect(copies.map((copy) => `${copy.table}.${copy.column}`), id).toContain(id);
  });

  it("marks every copied name personal, but two an engine word reads: the delivery note's signer (a formula) and who accepted a quote (the owner's notice)", () => {
    const readByWords = ["delivery_notes.signed_name", "quotes.accepted_name"];
    for (const copy of copies) {
      const personal = column(copy.table, copy.column)?.rules?.personal === true;
      expect(personal, `${copy.table}.${copy.column}`).toBe(!readByWords.includes(`${copy.table}.${copy.column}`));
    }
    // A name typed for whoever a customer introduced us to is a person's too, though not a contact's copy.
    expect(column("referrals", "referred_name")?.rules?.personal).toBe(true);
    expect(column("enquiries", "person")?.rules?.personal).toBe(true);
  });
});

describe("what the law keeps", () => {
  it("keeps the signed records of a job whole, a person's erasure included", () => {
    expect(tables.filter((one) => one.keep !== undefined).map((one) => [one.ref, one.keep?.law])).toEqual([
      ["sign_offs", "contract"],
      ["refused_sign_offs", "contract"],
      ["delivery_notes", "contract"],
    ]);
    // A quote is not: a sent quote's copies of the person are blanked with them.
    expect(table("quotes").keep).toBeUndefined();
  });
});

/*
 * THE COPY OF THE VALIDATOR BEFORE THIS RELEASE, the one 0.2.2 was checked with, knew none of these words: it refuses
 * this manifest. So the copy had to be taken again (`scripts/sync-manifest-validator.mjs`), and the one now beside the
 * tests takes it.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const git = (...args: string[]): string => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
/** The copy as the 0.2.2 release held it; null where the tag is not here (a shallow clone). */
const before = ((): string | null => {
  try {
    git("rev-parse", "--verify", "--quiet", "v0.2.2^{commit}");
    return "v0.2.2";
  } catch {
    return null;
  }
})();

describe.skipIf(before === null)("the validator copy before this release", () => {
  it("refuses this manifest for the words it did not know, and the copy now beside the tests takes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crm-old-validator-"));
    try {
      const zod = pathToFileURL(join(ROOT, "node_modules", "zod", "index.js")).href;
      for (const name of git("ls-tree", "--name-only", before!, "src/testing/manifest/").split("\n").filter((path) => path.endsWith(".ts"))) {
        const text = git("show", `${before!}:${name}`).replace(/from ['"]zod['"]/g, `from "${zod}"`);
        writeFileSync(join(dir, name.split("/").pop()!), text);
      }
      const old = (await import(/* @vite-ignore */ pathToFileURL(join(dir, "index.ts")).href)) as { validateManifest: typeof validateManifest };
      const refused = old.validateManifest(manifest);
      expect(refused.ok).toBe(false);
      expect((refused.ok ? [] : refused.issues).map((issue) => JSON.stringify(issue)).join("\n")).toMatch(/people|classes|keep/);
      const taken = validateManifest(manifest);
      expect(taken.ok ? [] : taken.issues).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
