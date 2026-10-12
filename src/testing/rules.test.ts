/**
 * What the app ships beside its tables: the rules that run by themselves, the
 * e-mails, and the outbox that sends them.
 *
 * Read against the manifest. That a rule runs and a mail is queued is proved
 * against an install, on three engines, in the engine's repo.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../manifest.json";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
type Text = string | Record<string, string>;
interface Rule {
  key: string;
  name: Text;
  description?: Text;
  enabled: boolean;
  trigger: { kind: string; event?: string; table?: string; changedColumn?: string; when?: unknown[] };
  graph: { nodes: { id: string; kind: string; action?: { kind: string; table?: string; values?: Record<string, string>; to?: { roles: string[] }; title?: Text; body?: Text }; condition?: unknown }[] };
}
interface Template {
  key: string;
  locales: Record<string, { subject: string; blocks: { block: string; data: { text: string } }[] }>;
}
const m = manifest as unknown as {
  automations: Rule[];
  emailTemplates: Template[];
  outbox: { kinds: Record<string, string>; producers: { kind: string; link: string; recipient?: { column: string; name?: string }; onChange?: { table: string; column: string; to: string } }[] };
  roles: { key: string }[];
  requiredSchema: { tables: { ref: string; columns: { ref: string; type: string; nullable?: boolean; rules?: { personal?: boolean; copy?: unknown } }[] }[] };
};
const rule = (key: string): Rule => m.automations.find((one) => one.key === key)!;
const steps = (key: string) => rule(key).graph.nodes.filter((node) => node.kind === "action").map((node) => node.action!);
const inAll = (text: Text | undefined): boolean => typeof text === "object" && LOCALES.every((locale) => (text[locale] ?? "").trim() !== "");
const names = (text: string): string[] => [...text.matchAll(/\{\{([^}|]+)/g)].map((found) => found[1]!.trim()).sort();

describe("the rules the app ships", () => {
  it("are four, each switched on as it is installed, each named and described in eight languages", () => {
    expect(m.automations.map((one) => one.key)).toEqual(["deal-made", "deal-stage-changed", "deal-won-job", "approval-asked"]);
    for (const one of m.automations) {
      expect(one.enabled, one.key).toBe(true);
      expect(inAll(one.name), `${one.key} name`).toBe(true);
      expect(inAll(one.description), `${one.key} description`).toBe(true);
    }
  });

  it("a deal made gets its mark and the first line of its history", () => {
    expect(rule("deal-made").trigger).toEqual({ kind: "record", event: "created", table: "deals" });
    expect(steps("deal-made")).toEqual([
      { kind: "record.create", table: "deal_marks", values: { deal_id: "{{record.id}}" } },
      { kind: "record.create", table: "deal_stage_changes", values: { deal_id: "{{record.id}}", to_stage_id: "{{record.stage_id}}" } },
    ]);
  });

  it("a deal that changes stage gets a line in its history, and only then", () => {
    expect(rule("deal-stage-changed").trigger).toEqual({ kind: "record", event: "updated", table: "deals", changedColumn: "stage_id" });
    expect(steps("deal-stage-changed")).toEqual([{ kind: "record.create", table: "deal_stage_changes", values: { deal_id: "{{record.id}}", to_stage_id: "{{record.stage_id}}" } }]);
  });

  it("a deal won gets its job, once", () => {
    expect(rule("deal-won-job").trigger).toEqual({ kind: "record", event: "updated", table: "deals", changedColumn: "state", when: [{ left: { field: "state" }, op: "is", right: "won" }] });
    // Won, reopened and won again: the job is there already, and a deal has one job.
    expect(rule("deal-won-job").graph.nodes.find((node) => node.kind === "condition")?.condition).toEqual({ left: { count: { table: "jobs", matchColumn: "deal_id", equalsField: "id" } }, op: "is", right: 0 });
    expect(steps("deal-won-job")).toEqual([{ kind: "record.create", table: "jobs", values: { deal_id: "{{record.id}}", site_name: "{{record.name}}" } }]);
  });

  it("an approval asked is told to the Sales manager role, in eight languages", () => {
    expect(rule("approval-asked").trigger).toEqual({ kind: "record", event: "updated", table: "quotes", changedColumn: "approval", when: [{ left: { field: "approval" }, op: "is", right: "asked" }] });
    const [tell] = steps("approval-asked");
    expect(tell).toMatchObject({ kind: "notification", to: { roles: ["sales-manager"] } });
    expect(m.roles.map((role) => role.key)).toContain("sales-manager");
    expect(inAll(tell!.title) && inAll(tell!.body)).toBe(true);
    // The same variables in every language: a translation that dropped the number would still read well.
    for (const text of [tell!.title, tell!.body] as Record<string, string>[]) for (const locale of LOCALES) expect(names(text[locale]!), locale).toEqual(names(text["en-US"]!));
  });

  it("reads only columns of the row a rule runs for", () => {
    const columns = (table: string) => new Set(m.requiredSchema.tables.find((one) => one.ref === table)!.columns.map((column) => column.ref));
    const wrong: string[] = [];
    for (const one of m.automations) {
      const own = columns(one.trigger.table!);
      for (const read of names(JSON.stringify(one.graph))) if (!read.startsWith("record.") || !own.has(read.slice(7))) wrong.push(`${one.key}: {{${read}}}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("the e-mails the app ships", () => {
  it("are three, each in eight languages, with a subject, a heading and its text", () => {
    expect(m.emailTemplates.map((one) => one.key)).toEqual(["crm-quote-sent", "crm-handover-intro", "crm-approval-asked"]);
    for (const template of m.emailTemplates) {
      expect(Object.keys(template.locales), template.key).toEqual(LOCALES);
      for (const locale of LOCALES) {
        const content = template.locales[locale]!;
        expect(content.subject.trim(), `${template.key} ${locale}`).not.toBe("");
        expect(content.blocks.map((block) => block.block), `${template.key} ${locale}`).toEqual(["email.heading", "email.text", "email.text"]);
        for (const block of content.blocks) expect(block.data.text.trim(), `${template.key} ${locale}`).not.toBe("");
      }
    }
  });

  it("read the same variables in every language", () => {
    for (const template of m.emailTemplates) {
      const read = (locale: string) => names(JSON.stringify(template.locales[locale]));
      for (const locale of LOCALES) expect(read(locale), `${template.key} ${locale}`).toEqual(read("en-US"));
    }
  });
});

describe("the outbox", () => {
  it("has a template for each kind", () => {
    expect(m.outbox.kinds).toEqual({ "quote-sent": "crm-quote-sent", "handover-intro": "crm-handover-intro", "approval-asked": "crm-approval-asked" });
    for (const key of Object.values(m.outbox.kinds)) expect(m.emailTemplates.map((one) => one.key)).toContain(key);
  });

  it("has one producer: a quote that reaches \"sent\" is mailed to the address kept on it", () => {
    expect(m.outbox.producers).toEqual([{ kind: "quote-sent", link: "quote_id", recipient: { column: "sent_to_email", name: "sent_to_name" }, onChange: { table: "quotes", column: "status", to: "sent" } }]);
    const quotes = m.requiredSchema.tables.find((one) => one.ref === "quotes")!;
    const column = (ref: string) => quotes.columns.find((one) => one.ref === ref)!;
    // The address follows the contact the quote was sent to, and is personal data like the contact's own.
    expect(column("sent_to_email")).toMatchObject({ type: "text", nullable: true, rules: { personal: true, copy: { via: "sent_to_contact_id", from: "email", mode: "always", follow: true } } });
    expect(column("sent_to_name")).toMatchObject({ type: "text", nullable: true, rules: { copy: { via: "sent_to_contact_id", from: "name", mode: "always", follow: true } } });
  });
});
