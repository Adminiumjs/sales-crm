/**
 * A survey after a job is signed off, its answer as the job's feedback, and
 * the sample's forms (`sampleData.addOns.forms`).
 *
 * Read against the manifest and the sample file. That the rule sends one
 * invitation with the job in it, that the answer through its link makes the
 * job's feedback and nothing else, and that the sample loads and leaves whole,
 * is proved on the whole server, on three engines (`proofs/crm-surveys.test.ts`,
 * `proofs/crm-sample.test.ts`).
 */
import { describe, expect, it } from "vitest";

import released from "../../manifest.json";
import whole from "../../whole/manifest.json";
import main from "../../whole/seeds/meridian.json";
import section from "../../whole/seeds/meridian.forms.json";
import { validateManifest } from "./manifest/index.ts";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
type Row = Record<string, unknown>;
type Column = { ref: string; type: string; nullable?: boolean; unique?: boolean; references?: string; rules?: Record<string, unknown>; label?: Record<string, string> };
type Entry = { table: string; key?: string; module?: string; methods: string[]; writable?: string[]; defaults?: Record<string, unknown>; anonymous?: Record<string, unknown>; source?: string; requires?: string[] };
type Node = { id: string; kind: string; amount?: number; unit?: string; condition?: unknown; action?: { kind: string; addOn?: string; step?: string; inputs?: Record<string, string> } };
interface Doc {
  modules: { id: string; default: string; feature?: string; label: Record<string, string> }[];
  addOns: { features: { id: string; requires: string[] }[] };
  requiredSchema: { tables: { ref: string; module?: string; columns: Column[] }[] };
  publicAccess: Entry[];
  automations: { key: string; enabled: boolean; module?: string; trigger: Record<string, unknown>; graph: { nodes: Node[] } }[];
  roles: { key: string; modules?: string[]; limits?: Record<string, { creatable?: string[]; writable?: string[] }> }[];
  sampleData: { addOns?: Record<string, { file: string }> };
}

for (const [name, raw] of [
  ["the whole app", whole],
  ["the released stage", released],
] as const) {
  const doc = raw as unknown as Doc;
  const table = (ref: string) => doc.requiredSchema.tables.find((one) => one.ref === ref)!;
  const column = (ref: string, col: string) => table(ref).columns.find((one) => one.ref === col)!;
  const entry = doc.publicAccess.find((one) => one.table === "feedback" && one.key === "forms")!;
  const rule = doc.automations.find((one) => one.key === "survey-after-sign-off")!;

  describe(`a survey after the job, in ${name}`, () => {
    it("still passes the validator", () => {
      const result = validateManifest(raw);
      expect(result.ok ? [] : result.issues).toEqual([]);
    });

    it("is a part, Surveys, on at install and off while Forms is not connected to the app", () => {
      const part = doc.modules.find((one) => one.id === "surveys")!;
      expect([part.default, part.feature]).toEqual(["on", "customer-feedback"]);
      expect(doc.addOns.features.find((one) => one.id === part.feature)?.requires).toEqual(["forms"]);
      expect(Object.keys(part.label).sort()).toEqual([...LOCALES].sort());
      // Typed feedback stays in After the job, whatever Surveys is.
      expect(table("feedback").module).toBe("aftercare");
    });

    it("lets a survey's answer fill a job's feedback, through one entry of Surveys that only adds a row: the score, the words, and the job from the invitation", () => {
      expect(entry).toEqual({ table: "feedback", key: "forms", module: "surveys", methods: ["POST"], writable: ["job_id", "score", "text"], defaults: { from_survey: true }, anonymous: { perIpHour: 10 } });
      // The job is a link: the engine fills it from the invitation's record, never from a question or the body.
      expect(column("feedback", "job_id")).toMatchObject({ type: "fk", references: "jobs", unique: true });
      // A Stars answer is 1 to 5: the score's own check.
      expect(column("feedback", "score").rules?.["validation"]).toEqual({ min: 1, max: 5 });
      // Nothing that is staff's to write: thanks, the fix, the theme.
      for (const ref of ["theme", "replied_at", "fix_written", "answered_on", "from_survey", "retry_key"]) expect(entry.writable, ref).not.toContain(ref);
    });

    it("dates a survey's answer the day it came in, and keeps the day typed on one added by hand", () => {
      expect(column("feedback", "answered_on").rules?.["stamp"]).toEqual({ set: { byOrigin: { public: "today" } }, on: "create" });
      expect(column("feedback", "from_survey")).toMatchObject({ type: "bool", nullable: true });
      expect(Object.keys(column("feedback", "from_survey").label ?? {}).sort()).toEqual([...LOCALES].sort());
      // Who adds an answer by hand writes its day, and never marks it as a survey's; a change touches neither.
      const manager = doc.roles.find((one) => one.key === "account-manager")!;
      expect(manager.limits?.["feedback"]).toEqual({ creatable: ["job_id", "score", "text", "theme", "answered_on"], writable: ["score", "text", "theme", "replied_at", "fix_written"] });
    });

    it("ships the rule switched off: a job signed off, two days, still signed off, then Forms' step with the fit-out survey to the job's contact, as marketing mail", () => {
      expect([rule.enabled, rule.module]).toEqual([false, "surveys"]);
      expect(rule.trigger).toEqual({ kind: "record", event: "updated", table: "jobs", changedColumn: "state", when: [{ left: { field: "state" }, op: "is", right: "signed-off" }] });
      expect(rule.graph.nodes.map((node) => node.kind)).toEqual(["trigger", "wait", "condition", "action"]);
      expect([rule.graph.nodes[1]!.amount, rule.graph.nodes[1]!.unit]).toEqual([2, "days"]);
      expect(rule.graph.nodes[3]!.action).toEqual({ kind: "add-on.step", addOn: "forms", step: "send-survey", inputs: { survey: "fit-out", to: "@link:contact_id", class: "marketing" } });
      // The contact a job names is a link one step away (copied from its deal): the one hop a person input may take.
      expect(column("jobs", "contact_id").rules?.["copy"]).toMatchObject({ via: "deal_id", from: "contact_id" });
    });

    it("loads the sample's forms with Forms", () => {
      expect(doc.sampleData.addOns?.["forms"]).toEqual({ file: "seeds/meridian.forms.json" });
    });
  });
}

// ── The sample file ─────────────────────────────────────────────────────────

const file = section as unknown as { format: string; app: string; addOn: string; tables: { ref: string; own?: true; rows: Row[] }[] };
const rows = (ref: string): Row[] => file.tables.find((one) => one.ref === ref)?.rows ?? [];
const mainRows = (ref: string): Row[] => (main as unknown as { tables: { ref: string; rows: Row[] }[] }).tables.find((one) => one.ref === ref)?.rows ?? [];
const refOf = (value: unknown): string => (value as { "@ref": string })["@ref"];
const formOf = (slug: string): Row => rows("forms").find((row) => row["slug"] === slug)!;
const answersOf = (slug: string): Row[] => rows("answers").filter((row) => refOf(row["form_id"]) === formOf(slug)["@label"]);

describe("the sample's forms", () => {
  it("are rows of Forms' own tables, in an order every link finds its row: the rows an answer became are the main sample's", () => {
    expect([file.format, file.app, file.addOn]).toEqual(["adminium.sample/1", "crm", "forms"]);
    expect(file.tables.map((one) => [one.ref, one.own === true, one.rows.length])).toEqual([
      ["forms", false, 5],
      ["invitations", false, 7],
      ["answers", false, 21],
    ]);
  });

  it("are five: the showroom form and the newsletter live, a trade show form still a draft, the fit-out survey live, last spring's visit feedback closed", () => {
    expect(rows("forms").map((row) => [row["slug"], row["kind"], row["state"], row["published"] !== undefined, row["closed_at"] !== undefined])).toEqual([
      ["showroom", "form", "live", true, false],
      ["newsletter", "form", "live", true, false],
      ["trade-show", "form", "draft", false, false],
      ["fit-out", "survey", "live", true, false],
      ["showroom-feedback", "form", "closed", true, true],
    ]);
    // Each is named in eight languages, and speaks English and German to a visitor.
    for (const row of rows("forms")) {
      expect(Object.keys((row["name"] as { "@t": Record<string, string> })["@t"]).sort(), String(row["slug"])).toEqual([...LOCALES].sort());
      expect((row["definition"] as { languages: string[] }).languages, String(row["slug"])).toEqual(["en-US", "de-DE"]);
      // What a visitor is served is what the builder last published.
      if (row["published"] !== undefined) expect(row["published"], String(row["slug"])).toEqual({ definition: row["definition"], settings: row["settings"] });
    }
  });

  it("ask the showroom's questions the inbox reads: a brochure as yes or no, the company required, readable choices for what to see", () => {
    const questions = (formOf("showroom")["definition"] as { questions: { id: string; kind: string; required?: boolean; role?: string; choices?: { id: string }[]; purpose?: string }[] }).questions;
    expect(questions.map((one) => [one.id, one.kind])).toEqual([
      ["qname", "short"],
      ["qemail", "short"],
      ["qcompany", "short"],
      ["qday", "date"],
      ["qsee", "several"],
      ["qbrochure", "one"],
      ["qdrawings", "file"],
      ["qnote", "long"],
      ["qnews", "tick"],
    ]);
    const q = (id: string) => questions.find((one) => one.id === id)!;
    expect(q("qbrochure").choices!.map((one) => one.id)).toEqual(["yes", "no"]);
    expect([q("qcompany").required, q("qcompany").role]).toEqual([true, "company"]);
    expect(q("qsee").choices!.map((one) => one.id)).toEqual(["booths", "desks", "seating", "tables", "storage"]);
    expect(q("qnews").purpose).toBe("newsletter");
    // Who hears of each: the sales managers (a sample person is no add-on row's to name); at most 200 an hour.
    expect(formOf("showroom")["settings"]).toMatchObject({ tell: [{ kind: "role", id: "crm-sales-manager" }], limits: { perHour: 200, harder: false } });
  });

  it("answer for each of the main sample's website enquiries that names a person, each answer naming the enquiry it became, which says it came from the showroom form", () => {
    const answers = answersOf("showroom");
    const fromForms = mainRows("enquiries").filter((row) => row["source"] === "form" && typeof row["person"] === "string");
    expect(answers.map((row) => refOf(row["became_key"]))).toEqual(fromForms.map((row) => row["@label"]));
    expect(answers.map((row) => row["name"])).toEqual(["Ines Vaughan", "Hannah Doyle", "Priti Shah"]);
    for (const answer of answers) {
      const row = fromForms.find((one) => one["@label"] === refOf(answer["became_key"]))!;
      const values = answer["values"] as Record<string, unknown>;
      expect(answer["became_table"]).toEqual({ "@table": "enquiries" });
      expect([values["qname"], values["qemail"], values["qcompany"], values["qbrochure"]]).toEqual([row["person"], row["email"], row["company_name"], row["brochure"]]);
      expect([row["from_form"], answer["submitted_at"]]).toEqual(["Showroom form", row["received_at"]]);
      expect(row["wanted_on"]).toBeDefined();
    }
    // Only these: no other enquiry of the sample says it came from a form of Forms.
    expect(mainRows("enquiries").filter((row) => row["from_form"] !== undefined)).toHaveLength(3);
  });

  it("hold 10 newsletter sign-ups kept as answers, 8 confirmed, and nothing made of them", () => {
    const answers = answersOf("newsletter");
    expect(answers).toHaveLength(10);
    expect(answers.filter((row) => row["confirm"] === "confirmed")).toHaveLength(8);
    for (const row of answers) {
      expect([row["became_table"], row["became_key"], row["consent_purpose"]]).toEqual([undefined, undefined, "newsletter"]);
    }
  });

  it("send the fit-out survey to every signed-off job's contact, and two answered: recommend +50, stars 4.5, both in English", () => {
    const signed = mainRows("jobs").filter((row) => row["state"] === "signed-off").map((row) => row["@label"]);
    const invitations = rows("invitations");
    expect(invitations.map((row) => refOf(row["record_key"]))).toEqual(signed);
    for (const row of invitations) {
      expect([row["record_table"], row["person_table"], row["class"]]).toEqual([{ "@table": "jobs" }, "crm:contacts", "marketing"]);
      // A sample invitation is never mailed and never opened: it keeps no token.
      expect(row["token_hash"]).toBeUndefined();
    }
    const answers = answersOf("fit-out");
    expect(answers).toHaveLength(2);
    const scores = answers.map((row) => (row["values"] as { qrecommend: number }).qrecommend);
    const stars = answers.map((row) => (row["values"] as { qstars: number }).qstars);
    // Promoters' share minus detractors': a 10 (a promoter) and an 8 (passive) of two.
    const recommend = Math.round(((scores.filter((n) => n >= 9).length - scores.filter((n) => n <= 6).length) * 100) / scores.length);
    expect([recommend, stars.reduce((a, b) => a + b, 0) / stars.length]).toEqual([50, 4.5]);
    expect(answers.map((row) => row["language"])).toEqual(["en-US", "en-US"]);
    expect(invitations.filter((row) => row["answered_at"] !== undefined)).toHaveLength(2);
  });

  it("make each fit-out answer its job's feedback, the main sample's own row, marked as the survey's, the score its stars", () => {
    const feedback = mainRows("feedback");
    for (const answer of answersOf("fit-out")) {
      const row = feedback.find((one) => one["@label"] === refOf(answer["became_key"]))!;
      const invitation = rows("invitations").find((one) => one["@label"] === refOf(answer["invitation_id"]))!;
      expect(answer["became_table"]).toEqual({ "@table": "feedback" });
      expect(refOf(row["job_id"])).toBe(refOf(invitation["record_key"]));
      expect([row["score"], (row["text"] as { "@t": Record<string, string> })["@t"]["en-US"], row["from_survey"]]).toEqual([(answer["values"] as { qstars: number }).qstars, (answer["values"] as { qsaid: string }).qsaid, true]);
      // Answered the day the feedback says, after it was asked.
      expect(answer["submitted_at"]).toMatchObject(row["answered_on"] as object);
    }
    // The other answers were typed in by hand.
    expect(feedback.filter((row) => row["from_survey"] === true)).toHaveLength(2);
    // The survey tells the CRM admins (Tessa) when the recommend score is 6 or under, and stops taking an invitation's answer after 30 days.
    expect(formOf("fit-out")["settings"]).toMatchObject({ tell: [{ kind: "role", id: "crm-admin" }], tellWhen: { question: "qrecommend", atMost: 6 }, survey: { mode: "named", linkNames: true, stopAfterDays: 30 } });
  });

  it("name no sample person (an app's rows for an add-on may not), and keep no address, browser or token Adminium would have taken from a real visitor", () => {
    expect(JSON.stringify(section)).not.toContain("@person");
    for (const row of rows("answers")) for (const key of ["ip", "user_agent", "sent_from"]) expect(row[key], key).toBeUndefined();
  });

  // The add-ons' word check (the shelf's): what a sample shows an owner says none of these.
  it("say none of the words the add-ons' shelf refuses, in any language", () => {
    const text = JSON.stringify(section).toLowerCase();
    expect(text.length).toBeGreaterThan(10_000);
    for (const word of ["pro", "plan", "tier", "free"]) expect(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "u").test(text), word).toBe(false);
    for (const word of ["pricing", "billing", "upgrade", "premium", "/mo", "promoter", "planned", "planning"]) expect(text.includes(word), word).toBe(false);
  });
});
