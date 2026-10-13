/**
 * What the app ships beside its tables: the rules that run by themselves, the
 * e-mails, and the outbox that sends them.
 *
 * Read against the manifest. That a rule runs and a mail is queued is proved
 * against an install, on three engines, in the engine's repo.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
type Text = string | Record<string, string>;
interface Rule {
  key: string;
  name: Text;
  description?: Text;
  enabled: boolean;
  module?: string;
  trigger: { kind: string; event?: string; table?: string; changedColumn?: string; when?: unknown[]; schedule?: Record<string, unknown>; forEach?: { table: string; once: boolean | string; where: { left: { field: string }; op: string; right?: unknown }[] } };
  graph: {
    nodes: {
      id: string;
      kind: string;
      action?: { kind: string; table?: string; values?: Record<string, string>; to?: { roles?: string[]; column?: string }; title?: Text; body?: Text; templateKey?: string; sections?: { key: string; table: string; owner: string }[] };
      condition?: unknown;
    }[];
  };
}
interface Template {
  key: string;
  locales: Record<string, { subject: string; blocks: { block: string; data: { text: string; section?: string; empty?: string } }[] }>;
}
const m = manifest as unknown as {
  automations: Rule[];
  emailTemplates: Template[];
  outbox: { kinds: Record<string, string>; producers: { kind: string; link: string; recipient?: { column: string; name?: string }; onChange?: { table: string; column: string; to: string } }[] };
  roles: { key: string }[];
  requiredSchema: { tables: { ref: string; columns: { ref: string; type: string; nullable?: boolean; rules?: { personal?: boolean; copy?: unknown; staff?: boolean; mentions?: unknown } }[] }[] };
};
const rule = (key: string): Rule => m.automations.find((one) => one.key === key)!;
const steps = (key: string) => rule(key).graph.nodes.filter((node) => node.kind === "action").map((node) => node.action!);
const inAll = (text: Text | undefined): boolean => typeof text === "object" && LOCALES.every((locale) => (text[locale] ?? "").trim() !== "");
const names = (text: string): string[] => [...text.matchAll(/\{\{([^}|]+)/g)].map((found) => found[1]!.trim()).sort();

describe("the rules the app ships", () => {
  // What the app cannot work without is switched on as it is installed; what tells people is the owner's to switch on.
  const WORKS = ["deal-made", "deal-stage-changed", "deal-won-job", "quote-sent-amount", "approval-asked"];
  const TELLS = ["nudge-quiet", "nudge-stuck", "nudge-soon", "follow-up-due", "quote-runs-out", "deal-handed-over", "approval-given", "approval-refused", "week-rep", "week-manager"];

  it("are fifteen: five the app works by, switched on, and ten that tell people, switched off; each named and described in eight languages", () => {
    expect(m.automations.map((one) => one.key)).toEqual([...WORKS, ...TELLS]);
    for (const one of m.automations) {
      expect(one.enabled, one.key).toBe(WORKS.includes(one.key));
      expect(inAll(one.name), `${one.key} name`).toBe(true);
      expect(inAll(one.description), `${one.key} description`).toBe(true);
    }
  });

  it("a deal made gets its mark and the first line of its history", () => {
    expect(rule("deal-made").trigger).toEqual({ kind: "record", event: "created", table: "deals" });
    expect(steps("deal-made")).toEqual([
      { kind: "record.create", table: "deal_marks", values: { deal_id: "{{record.id}}" } },
      // Who set the stage is kept on the deal as a person writes it, and handed on: a line a rule writes has no writer of its own.
      { kind: "record.create", table: "deal_stage_changes", values: { deal_id: "{{record.id}}", to_stage_id: "{{record.stage_id}}", by_id: "{{record.stage_by_id}}" } },
    ]);
  });

  it("a deal that changes stage gets a line in its history, and only then", () => {
    expect(rule("deal-stage-changed").trigger).toEqual({ kind: "record", event: "updated", table: "deals", changedColumn: "stage_id" });
    expect(steps("deal-stage-changed")).toEqual([{ kind: "record.create", table: "deal_stage_changes", values: { deal_id: "{{record.id}}", to_stage_id: "{{record.stage_id}}", by_id: "{{record.stage_by_id}}" } }]);
    const column = (table: string, ref: string) => m.requiredSchema.tables.find((one) => one.ref === table)!.columns.find((one) => one.ref === ref)!;
    expect(column("deals", "stage_by_id").rules).toEqual({ staff: true, stamp: { set: "user-id", on: { columns: ["stage_id"] } } });
    expect(column("deal_stage_changes", "by_id").rules).toEqual({ staff: true });
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
      const table = one.trigger.table ?? one.trigger.forEach?.table;
      // A rule by the clock with no rows of its own (a weekly summary) has no record to read.
      const own = table === undefined ? new Set<string>() : columns(table);
      for (const read of names(JSON.stringify(one.graph))) if (!read.startsWith("record.") || !own.has(read.slice(7))) wrong.push(`${one.key}: {{${read}}}`);
    }
    expect(wrong).toEqual([]);
  });

  const staff = (table: string, column: string): boolean => m.requiredSchema.tables.find((one) => one.ref === table)!.columns.find((one) => one.ref === column)?.rules?.staff === true;

  it("three nudges tell a deal's owner, once each time the deal starts to match", () => {
    for (const key of ["nudge-quiet", "nudge-stuck", "nudge-soon"]) {
      const { trigger } = rule(key);
      expect(trigger.schedule, key).toEqual({ kind: "daily", time: "08:00" });
      expect(trigger.forEach, key).toMatchObject({ table: "deals", once: "per-spell" });
      // Only an open deal is nudged.
      expect(trigger.forEach!.where[0], key).toEqual({ left: { field: "state" }, op: "is", right: "open" });
      expect(steps(key), key).toMatchObject([{ kind: "notification", to: { column: "owner_id" } }]);
    }
    expect(rule("nudge-quiet").trigger.forEach!.where[1]).toEqual({ left: { field: "last_activity_at" }, op: "more_than_ago", right: { amount: 7, unit: "days" } });
    expect(rule("nudge-stuck").trigger.forEach!.where[1]).toEqual({ left: { field: "entered_stage_at" }, op: "more_than_ago", right: { amount: 21, unit: "days" } });
    // Closing within a week, and not yet at the last stage (whose odds are 0.9).
    expect(rule("nudge-soon").trigger.forEach!.where.slice(1)).toEqual([
      { left: { field: "expected_close" }, op: "within_next", right: { amount: 7, unit: "days" } },
      { left: { field: "stage_odds" }, op: "lt", right: 0.9 },
    ]);
    expect(staff("deals", "owner_id")).toBe(true);
  });

  it("tells one person, never a whole role, of what is theirs", () => {
    const to = (key: string) => steps(key)[0]!.to;
    expect(to("follow-up-due")).toEqual({ column: "owner_id" });
    expect(rule("follow-up-due").trigger.forEach).toMatchObject({ table: "follow_ups", once: "per-spell" });
    // A quote has no owner of its own: its deal's owner is told.
    expect(to("quote-runs-out")).toEqual({ column: "deal_id.owner_id" });
    expect(rule("quote-runs-out").trigger.forEach).toMatchObject({ table: "quotes", once: "per-spell" });
    expect(to("deal-handed-over")).toEqual({ column: "owner_id" });
    expect(rule("deal-handed-over").trigger).toEqual({ kind: "record", event: "updated", table: "deals", changedColumn: "owner_id" });
    for (const [key, decided] of [["approval-given", "approved"], ["approval-refused", "refused"]] as const) {
      expect(to(key), key).toEqual({ column: "asked_by_id" });
      expect(rule(key).trigger.when, key).toEqual([{ left: { field: "approval" }, op: "is", right: decided }]);
    }
    for (const [table, column] of [["follow_ups", "owner_id"], ["quotes", "asked_by_id"]] as const) expect(staff(table, column), `${table}.${column}`).toBe(true);
  });

  it("says each notice in eight languages, with the same variables in each", () => {
    for (const key of TELLS.filter((one) => !one.startsWith("week-"))) {
      const [tell] = steps(key);
      expect(inAll(tell!.title), key).toBe(true);
      for (const text of [tell!.title, tell!.body].filter((one) => one !== undefined) as Record<string, string>[]) for (const locale of LOCALES) expect(names(text[locale]!), `${key} ${locale}`).toEqual(names(text["en-US"]!));
    }
  });

  it("writes each rep and each sales manager their own week, on Mondays unless they chose another day", () => {
    for (const [key, roles, template, sections] of [
      ["week-rep", ["rep", "account-manager"], "crm-week-rep", ["closing", "due", "slipped"]],
      ["week-manager", ["sales-manager"], "crm-week-manager", ["closing", "slipped", "quiet"]],
    ] as const) {
      expect(rule(key).trigger, key).toEqual({ kind: "schedule", schedule: { kind: "weekly", dayOfWeek: 1, time: "07:00" } });
      const [sum] = steps(key);
      expect(sum, key).toMatchObject({ kind: "digest", templateKey: template, to: { roles } });
      expect(sum!.sections!.map((section) => section.key), key).toEqual(sections);
      // Each section is of the reader's own rows: by the staff column that names them.
      for (const section of sum!.sections!) expect(staff(section.table, section.owner), `${key} ${section.key}`).toBe(true);
      // The template draws every section, in every language, and says something when a section is empty.
      const drawn = m.emailTemplates.find((one) => one.key === template)!;
      for (const locale of LOCALES) {
        const rows = drawn.locales[locale]!.blocks.filter((block) => block.block === "email.rows");
        expect(rows.map((block) => block.data.section).sort(), `${template} ${locale}`).toEqual([...sections].sort());
        for (const block of rows) expect((block.data.empty ?? "").trim(), `${template} ${locale}`).not.toBe("");
      }
    }
  });
});

describe("a comment on a deal may mention a colleague", () => {
  it("marks the comment's text, and says the mention is about the deal", () => {
    const text = m.requiredSchema.tables.find((one) => one.ref === "comments")!.columns.find((one) => one.ref === "text")!;
    expect(text.rules?.mentions).toEqual({ about: "deal_id" });
  });
});

describe("the e-mails the app ships", () => {
  it("are five: three to one address, each in eight languages with a subject, a heading and its text, and two weekly summaries", () => {
    expect(m.emailTemplates.map((one) => one.key)).toEqual(["crm-quote-sent", "crm-handover-intro", "crm-approval-asked", "crm-week-rep", "crm-week-manager"]);
    for (const template of m.emailTemplates) expect(Object.keys(template.locales), template.key).toEqual(LOCALES);
    for (const template of m.emailTemplates.slice(0, 3)) {
      expect(Object.keys(template.locales), template.key).toEqual(LOCALES);
      for (const locale of LOCALES) {
        const content = template.locales[locale]!;
        expect(content.subject.trim(), `${template.key} ${locale}`).not.toBe("");
        // The quote's own e-mail also says where the quote can be read and answered, and carries the button that goes there.
        expect(content.blocks.map((block) => block.block), `${template.key} ${locale}`).toEqual(template.key === "crm-quote-sent" ? ["email.heading", "email.text", "email.text", "email.button", "email.text"] : ["email.heading", "email.text", "email.text"]);
        for (const block of content.blocks) expect(String(block.block === "email.button" ? (block.data as { label?: string }).label : block.data.text).trim(), `${template.key} ${locale}`).not.toBe("");
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

  it("writes a line in the deal's history when a quote is sent: the amount before tax, and the quote it came from", () => {
    expect(rule("quote-sent-amount").trigger).toEqual({ kind: "record", event: "updated", table: "quotes", changedColumn: "status", when: [{ left: { field: "status" }, op: "is", right: "sent" }] });
    expect(steps("quote-sent-amount")).toEqual([{ kind: "record.create", table: "deal_amount_changes", values: { deal_id: "{{record.deal_id}}", quote_id: "{{record.id}}", amount: "{{record.subtotal}}" } }]);
  });

  it("has one producer: a quote that reaches \"sent\" is mailed to the address kept on it", () => {
    expect(m.outbox.producers).toEqual([{ kind: "quote-sent", module: "quotes", link: "quote_id", recipient: { column: "sent_to_email", name: "sent_to_name" }, onChange: { table: "quotes", column: "status", to: "sent" }, replyTo: { staff: "deal_id.owner_id" } }]);
    // A reply to the quote's e-mail goes to the rep who owns its deal (her sign-in address, read when the mail goes).
    const quotes = m.requiredSchema.tables.find((one) => one.ref === "quotes")!;
    const column = (ref: string) => quotes.columns.find((one) => one.ref === ref)!;
    // Until it is sent, a quote shows where it will go: the contact's address as it is today, personal data like the contact's own.
    expect(column("to_email")).toMatchObject({ type: "text", nullable: true, rules: { personal: true, copy: { via: "sent_to_contact_id", from: "email", mode: "always", follow: true } } });
    expect(column("to_name")).toMatchObject({ type: "text", nullable: true, rules: { copy: { via: "sent_to_contact_id", from: "name", mode: "always", follow: true } } });
    // Sending stamps where it went, and that no longer follows the contact: the record of who was mailed stays true.
    expect(column("sent_to_email").rules).toEqual({ personal: true, stamp: { set: { copy: "to_email" }, on: { column: "status", values: ["sent"] } } });
    expect(column("sent_to_name").rules).toEqual({ stamp: { set: { copy: "to_name" }, on: { column: "status", values: ["sent"] } } });
  });
});
