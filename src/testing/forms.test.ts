/**
 * What a website form may do to the CRM: make an enquiry, through the forms
 * entry and nothing else, filling only what a stranger may say; and the
 * brochure such an enquirer asks for, sent by a rule that ships switched off.
 *
 * Read against the manifest. That a form's answer becomes an enquiry, and that
 * the rule sends and books what it says, is proved on the whole server, on
 * three engines (`proofs/crm-forms.test.ts`).
 */
import { describe, expect, it } from "vitest";

import released from "../../manifest.json";
import whole from "../../whole/manifest.json";
import sample from "../../whole/seeds/meridian.json";
import { validateManifest } from "./manifest/index.ts";
import { PLAIN_TEXT_DIGITS_MOST, PLAIN_TEXT_LONGEST } from "./manifest/public-access.ts";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
type Column = { ref: string; type: string; nullable?: boolean; maxLength?: number; enum?: string[]; references?: string; rules?: Record<string, unknown>; label?: Record<string, string> };
type Table = { ref: string; module?: string; columns: Column[] };
type Entry = { table: string; key?: string; methods: string[]; writable?: string[]; select?: string[]; defaults?: Record<string, unknown>; requires?: string[]; source?: string; module?: string; anonymous?: { perValue?: { columns: string[]; n: number }; plainText?: (string | { column: string; digits?: number; max?: number })[] } };
type Role = { key: string; permissions: string[]; limits?: Record<string, { writable?: string[]; creatable?: string[] }> };
interface Doc {
  compatibility: { minAdminiumVersion: string };
  requiredSchema: { tables: Table[] };
  publicAccess: Entry[];
  roles: Role[];
  outbox: { links: Record<string, string>; recipient: { fallback?: Record<string, string> }; kinds: Record<string, string>; classes: Record<string, string>; producers?: { kind: string }[] };
  emailTemplates: { key: string; vars?: string[]; locales: Record<string, { subject: string; blocks: { block: string; data: Record<string, unknown> }[]; footer?: string }> }[];
  automations: { key: string; enabled: boolean; module?: string; name: Record<string, string>; description: Record<string, string>; trigger: Record<string, unknown>; graph: { nodes: Record<string, unknown>[] } }[];
  addOns: { suggests: { key: string; range: string; checked?: boolean; reason: Record<string, string> }[]; features: { id: string; requires: string[]; label: Record<string, string> }[] };
}

const FORM_WRITES = ["person", "company_name", "email", "phone", "text", "town", "wants", "wanted_on", "brochure", "from_form"];

for (const [name, raw] of [
  ["the whole app", whole],
  ["the released stage", released],
] as const) {
  const doc = raw as unknown as Doc;
  const table = (ref: string) => doc.requiredSchema.tables.find((one) => one.ref === ref)!;
  const column = (ref: string, col: string) => table(ref).columns.find((one) => one.ref === col)!;
  // The website forms' entry: the survey's (on feedback) is its own file's (`surveys.test.ts`).
  const forms = doc.publicAccess.filter((entry) => entry.key === "forms" && entry.table === "enquiries");

  describe(`website forms in ${name}`, () => {
    it("still passes the validator, at the first Adminium that reads a forms entry's source", () => {
      const result = validateManifest(raw);
      expect(result.ok ? [] : result.issues).toEqual([]);
      expect(doc.compatibility.minAdminiumVersion).toBe("0.3.41");
    });

    it("opens Enquiries to forms by one entry, of the Inbox part, that only adds a row", () => {
      expect(doc.publicAccess.filter((entry) => entry.key === "forms").map((entry) => entry.table)).toEqual(["enquiries", "feedback"]);
      const entry = forms[0]!;
      expect(entry.methods).toEqual(["POST"]);
      expect(entry.module).toBe(table("enquiries").module);
      expect(entry.module).toBe("inbox");
      expect(entry.writable).toEqual(FORM_WRITES);
      expect(entry.defaults).toEqual({ state: "open", source: "form" });
      expect(entry.requires).toEqual(["company_name"]);
      expect(entry.source).toBe("from_form");
      expect(entry.select).toBeUndefined();
    });

    it("lets a form fill no link, no state, nobody's name, no stamp and no opt-out mark", () => {
      const writable = forms[0]!.writable!;
      for (const ref of writable) {
        const col = column("enquiries", ref);
        expect(col.type, ref).not.toBe("fk");
        expect(col.rules?.["stamp"], ref).toBeUndefined();
        expect(col.rules?.["staff"], ref).toBeUndefined();
      }
      for (const ref of ["state", "source", "claimed_by_id", "passed_to_id", "deal_id", "company_id", "show_id", "received_at", "rung_at", "opt_out_offered_at", "brochure_link", "est_value", "warmth", "retry_key"]) expect(writable, ref).not.toContain(ref);
      // The moment it came in is the column's own stamp, on create: a form's answer gets it too.
      expect(column("enquiries", "received_at").rules?.["stamp"]).toEqual({ set: "now", on: "create" });
    });

    it("holds the name and the company to plain text, in the engine's limits, and counts each address a day", () => {
      const caps = forms[0]!.anonymous!;
      expect(caps.perValue).toEqual({ columns: ["email"], n: 5 });
      expect(caps.plainText).toEqual([
        { column: "person", max: 120 },
        { column: "company_name", digits: 4, max: 160 },
      ]);
      for (const one of caps.plainText!) {
        if (typeof one === "string") continue;
        expect(one.max ?? 0).toBeLessThanOrEqual(PLAIN_TEXT_LONGEST);
        expect(one.digits ?? 0).toBeLessThanOrEqual(PLAIN_TEXT_DIGITS_MOST);
        expect(column("enquiries", one.column).maxLength).toBeLessThanOrEqual(one.max!);
      }
    });

    it("lets nobody read Enquiries without signing in", () => {
      for (const entry of doc.publicAccess.filter((one) => one.table === "enquiries")) expect(entry.methods).toEqual(["POST"]);
    });

    it("keeps what a form brought: its name, the brochure asked and the day that suits, in eight languages", () => {
      expect(column("enquiries", "from_form")).toMatchObject({ type: "text", maxLength: 200, nullable: true });
      expect(column("enquiries", "brochure")).toMatchObject({ type: "enum", enum: ["yes", "no"], nullable: true });
      expect(column("enquiries", "wanted_on")).toMatchObject({ type: "date", nullable: true });
      expect(column("enquiries", "brochure_link")).toMatchObject({ type: "text", maxLength: 500, nullable: true });
      for (const ref of ["from_form", "brochure", "wanted_on", "brochure_link"]) expect(Object.keys(column("enquiries", ref).label ?? {}).sort(), ref).toEqual([...LOCALES].sort());
      expect(column("enquiries", "from_form").label?.["en-US"]).toBe("From the form");
    });

    it("lets no staff role write where an enquiry came from, what it asked or what went; the day that suits is a detail they keep", () => {
      for (const role of doc.roles) {
        const limits = role.limits?.["enquiries"];
        if (!role.permissions.some((one) => one === "table:@enquiries:create" || one === "table:@enquiries:update")) continue;
        // The CRM admin writes every column, as everywhere in the app.
        if (role.key === "admin") continue;
        for (const list of [limits?.writable, limits?.creatable]) {
          if (list === undefined) continue;
          for (const ref of ["from_form", "brochure", "brochure_link"]) expect(list, `${role.key} ${ref}`).not.toContain(ref);
        }
      }
      for (const key of ["rep", "sales-manager", "front-desk"]) expect(doc.roles.find((one) => one.key === key)!.limits!["enquiries"]!.writable, key).toContain("wanted_on");
      for (const key of ["marketer", "front-desk"]) expect(doc.roles.find((one) => one.key === key)!.limits!["enquiries"]!.creatable, key).toContain("wanted_on");
    });
  });

  describe(`the brochure in ${name}`, () => {
    const rule = doc.automations.find((one) => one.key === "brochure-asked")!;

    it("keeps its link and who gets the follow-up in Settings", () => {
      expect(column("settings", "brochure_link")).toMatchObject({ type: "text", maxLength: 500, nullable: true, rules: { validation: { format: "url" } } });
      expect(column("settings", "brochure_follow_up_owner_id")).toMatchObject({ type: "text", maxLength: 36, nullable: true, rules: { staff: true } });
    });

    it("is an e-mail of its own, service mail, to the enquiry's own address, in eight languages with the link as its button", () => {
      expect(doc.outbox.kinds["brochure"]).toBe("crm-brochure");
      expect(doc.outbox.classes["brochure"]).toBe("service");
      expect(doc.outbox.links["enquiry"]).toBe("enquiry_id");
      expect(doc.outbox.recipient.fallback).toEqual({ via: "enquiry_id", email: "email", name: "person" });
      expect((doc.outbox.producers ?? []).some((one) => one.kind === "brochure")).toBe(false);
      expect(column("outbox", "enquiry_id")).toMatchObject({ type: "fk", references: "enquiries", nullable: true });
      expect(column("outbox", "kind").enum).toContain("brochure");
      const template = doc.emailTemplates.find((one) => one.key === "crm-brochure")!;
      expect(Object.keys(template.locales).sort()).toEqual([...LOCALES].sort());
      for (const [locale, content] of Object.entries(template.locales)) {
        const button = content.blocks.find((block) => block.block === "email.button");
        expect(button?.data["url"], locale).toBe("{{enquiry.brochure_link}}");
        expect(String(button?.data["label"] ?? ""), locale).not.toBe("");
        expect(content.subject, locale).not.toBe("");
        expect(content.footer ?? "", locale).not.toBe("");
      }
    });

    it("ships its rule switched off, of the Inbox part, run for an enquiry that asked", () => {
      expect(rule.enabled).toBe(false);
      expect(rule.module).toBe("inbox");
      expect(rule.trigger).toEqual({ kind: "record", event: "created", table: "enquiries", when: [{ left: { field: "brochure" }, op: "is", right: "yes" }] });
      expect(Object.keys(rule.name).sort()).toEqual([...LOCALES].sort());
      expect(Object.keys(rule.description).sort()).toEqual([...LOCALES].sort());
      expect(rule.graph.nodes.map((node) => node["id"])).toEqual(["t", "link", "send", "wait", "no-deal", "not-dropped", "who"]);
      expect(rule.graph.nodes.find((node) => node["id"] === "wait")).toMatchObject({ amount: 2, unit: "days" });
    });

    it("sends the brochure only with a link, and books the call for whoever claimed it, else the person Settings names", () => {
      const send = rule.graph.nodes.find((node) => node["id"] === "send") as { condition: unknown; branches: { id: string; nodes: { action: { table: string; values: Record<string, unknown> } }[] }[] };
      expect(send.condition).toEqual({ left: { field: "brochure_link" }, op: "not_empty" });
      expect(send.branches[0]!.nodes.map((node) => [node.action.table, node.action.values])).toEqual([["outbox", { kind: "brochure", enquiry_id: "{{record.id}}" }]]);
      expect(send.branches[1]!.nodes).toEqual([]);
      const who = rule.graph.nodes.find((node) => node["id"] === "who") as { condition: unknown; branches: { nodes: { action: { table: string; values: Record<string, unknown> } }[] }[] };
      expect(who.condition).toEqual({ left: { field: "claimed_by_id" }, op: "not_empty" });
      const owners = who.branches.map((branch) => branch.nodes[0]!.action.values["owner_id"]);
      expect(owners).toEqual(["{{record.claimed_by_id}}", { setting: { table: "settings", column: "brochure_follow_up_owner_id" } }]);
      for (const branch of who.branches) expect(branch.nodes[0]!.action).toMatchObject({ table: "follow_ups", values: { kind: "chase", due_at: { daysAfter: { now: true, days: 1, at: "09:00" } } } });
    });

    it("stays inside the rule cap", () => {
      expect(doc.automations.length).toBeLessThanOrEqual(32);
    });
  });

  describe(`Forms, suggested by ${name}`, () => {
    it("is ticked at install, from 1.0.15, saying what it brings in eight languages", () => {
      const forms = doc.addOns.suggests.find((one) => one.key === "forms")!;
      expect(forms).toMatchObject({ range: ">=1.0.15", checked: true });
      expect(Object.keys(forms.reason).sort()).toEqual([...LOCALES].sort());
      expect(doc.addOns.suggests.length).toBeLessThanOrEqual(8);
    });

    it("names the two things it brings: web enquiries and customer feedback", () => {
      expect(doc.addOns.features.filter((one) => one.requires.includes("forms")).map((one) => one.id)).toEqual(["web-enquiries", "customer-feedback"]);
    });
  });
}

describe("the sample's brochure settings", () => {
  const row = (sample as unknown as { tables: { ref: string; rows: Record<string, unknown>[] }[] }).tables.find((one) => one.ref === "settings")!.rows[0]!;
  it("names the sales manager for brochure follow-ups, and a brochure at an https address", () => {
    expect(row["brochure_follow_up_owner_id"]).toEqual({ "@person": "ivy" });
    expect(String(row["brochure_link"])).toMatch(/^https:\/\//);
  });
});
