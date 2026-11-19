/**
 * What the CRM asks of the Pages add-on (landing pages and funnels): the
 * marketer's reads for her home, read only; Pages among the suggested
 * add-ons, not ticked; and the sample's landing pages and funnel
 * (`sampleData.addOns.pages`).
 *
 * Read against the manifest and the sample files. That the marketer reads
 * them and writes none, that a role without the reads has none, and that the
 * sample loads and leaves whole with Pages there or not, is proved on the
 * whole server, on three engines (`proofs/crm-pages.test.ts`).
 */
import { describe, expect, it } from "vitest";

import released from "../../manifest.json";
import releasedPages from "../../seeds/meridian.pages.json";
import whole from "../../whole/manifest.json";
import formsSection from "../../whole/seeds/meridian.forms.json";
import section from "../../whole/seeds/meridian.pages.json";
import { validateManifest } from "./manifest/index.ts";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
/** The longest each text of a landing page may be (`LANDING_TEXT_MAX`). */
const LIMITS: Record<string, number> = { title: 70, description: 200, heading: 120, text: 600, label: 60, question: 200, answer: 2000 };
type Grant = { addOn: string; table: string; actions: string[]; limit?: { readable?: string[] } };
type Role = { key: string; permissions: string[]; tables?: Grant[] };
type Row = Record<string, unknown>;
interface Doc {
  compatibility: { minAdminiumVersion: string };
  roles: Role[];
  addOns: { suggests: { key: string; range: string; checked?: boolean; reason: Record<string, string> }[] };
  sampleData: { addOns?: Record<string, { file: string }> };
  automations: { key: string }[];
}

/** What the marketer reads of Forms and Pages, and nothing more: no definition, no answer's words, no page's document. */
const MARKETER_READS: Record<string, string[]> = {
  "forms/forms": ["id", "name", "kind", "state"],
  "forms/answers": ["id", "form_id", "submitted_at"],
  "pages/pages": ["id", "name", "slug", "state", "language", "published_at"],
  "pages/funnels": ["id", "name", "steps"],
};

for (const [name, raw] of [
  ["the whole app", whole],
  ["the released stage", released],
] as const) {
  const doc = raw as unknown as Doc;

  describe(`landing pages, in ${name}`, () => {
    it("passes the validator, at Adminium 0.3.66 (0.3.65 counts a page's views and serves landing pages)", () => {
      const result = validateManifest(raw);
      expect(result.ok ? [] : result.issues).toEqual([]);
      expect(doc.compatibility.minAdminiumVersion).toBe("0.3.66");
    });

    it("lets the marketer read the forms, their answers, the pages and the funnels, and change none of them", () => {
      const marketer = doc.roles.find((role) => role.key === "marketer")!;
      const theirs = (marketer.tables ?? []).filter((grant) => grant.addOn === "forms" || grant.addOn === "pages");
      expect(Object.fromEntries(theirs.map((grant) => [`${grant.addOn}/${grant.table}`, grant.limit?.readable]))).toEqual(MARKETER_READS);
      for (const grant of theirs) expect(grant.actions, `${grant.addOn}/${grant.table}`).toEqual(["read"]);
      // The chat's reads, given for "Read the chat", stay as they were.
      expect((marketer.tables ?? []).filter((grant) => grant.addOn === "live-chat").map((grant) => grant.table)).toEqual(["conversations", "messages"]);
    });

    it("gives no role of the CRM a write on the pages or the funnels: an admin builds them through the Pages add-on's own roles", () => {
      for (const role of doc.roles) {
        for (const grant of role.tables ?? []) {
          if (grant.addOn !== "pages") continue;
          expect(grant.actions, `${role.key} ${grant.table}`).toEqual(["read"]);
        }
      }
      // Only the marketer reads them: the other roles have no home that shows a funnel.
      expect(doc.roles.filter((role) => (role.tables ?? []).some((grant) => grant.addOn === "pages")).map((role) => role.key)).toEqual(["marketer"]);
    });

    it("suggests Pages sixth of eight, not ticked, in every language, from its first release", () => {
      const suggests = doc.addOns.suggests;
      expect(suggests.length).toBeLessThanOrEqual(8);
      // Lead finder (0.2.9) comes after it.
      expect(suggests.map((one) => one.key)).toEqual(["invoices", "inventory", "offers", "forms", "live-chat", "pages", "lead-finder"]);
      const pages = suggests[5]!;
      expect(pages.checked).toBeUndefined();
      expect(pages.range).toBe(">=1.0.31");
      expect(Object.keys(pages.reason).sort()).toEqual([...LOCALES].sort());
      for (const text of Object.values(pages.reason)) expect(text.length).toBeLessThanOrEqual(120);
    });

    it("ships the landing sample for Pages, and no new rule (26 of 32)", () => {
      expect(doc.sampleData.addOns?.["pages"]).toEqual({ file: "seeds/meridian.pages.json" });
      expect(doc.automations.length).toBe(26);
    });
  });
}

describe("the sample's landing pages and funnel", () => {
  const rows = (ref: string) => (section as unknown as { tables: { ref: string; rows: Row[] }[] }).tables.find((table) => table.ref === ref)!.rows;
  const pages = rows("pages");
  const funnels = rows("funnels");
  const texts = (value: unknown) => (value as { "@t": Record<string, string> })["@t"];
  const showroom = (formsSection as unknown as { tables: { ref: string; rows: Row[] }[] }).tables.find((table) => table.ref === "forms")!.rows.find((row) => row["@label"] === "form:showroom")!;

  it("is the released stage's too, unchanged", () => {
    expect(releasedPages).toEqual(section);
  });

  it("holds four pages: the open day and its thanks page and the booths, live, and the spring open day, a draft", () => {
    expect(pages.map((page) => [page["slug"], page["state"]])).toEqual([
      ["acoustic-booths", "live"],
      ["showroom-open-day", "live"],
      ["thanks-open-day", "live"],
      ["spring-open-day", "draft"],
    ]);
    // An address keeps the landing rule (lower case, digits, dashes) and is none of the reserved ones, nor one of the add-on's own sample's.
    for (const page of pages) {
      expect(page["slug"]).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/);
      expect(["api", "assets", "login", "signin", "sign-in", "account", "password", "reset", "open-day", "fruehlingsangebot"]).not.toContain(page["slug"]);
    }
  });

  it("writes every page in the adding person's language: its name, its language and every word inside it, each in eight languages", () => {
    for (const row of [...pages, ...funnels]) expect(Object.keys(texts(row["name"])).sort()).toEqual([...LOCALES].sort());
    for (const page of pages) {
      // The page says the language it is written in: the one its words come in.
      for (const locale of LOCALES) expect(texts(page["language"])[locale]).toBe(locale);
      let words = 0;
      const walk = (value: unknown, key: string): void => {
        if (typeof value === "string") {
          // A word a visitor reads is never left in one language; ids, kinds, icons, a form's key and a size are not words.
          expect(["id", "kind", "icon", "form", "addOn", "size"], `${String(page["@label"])} ${key}: ${value}`).toContain(key);
          return;
        }
        if (typeof value !== "object" || value === null) return;
        if ("@t" in value) {
          words += 1;
          expect(Object.keys(texts(value)).sort(), `${String(page["@label"])} ${key}`).toEqual([...LOCALES].sort());
          for (const text of Object.values(texts(value))) expect(text.length, key).toBeLessThanOrEqual(LIMITS[key] ?? 2000);
          return;
        }
        if ("@ref" in value) return;
        for (const [inner, item] of Object.entries(value)) walk(item, Array.isArray(value) ? key : inner);
      };
      walk(page["draft"], "draft");
      expect(words).toBeGreaterThan(3);
    }
  });

  it("publishes each live page as drafted, with no mark of Milo's, and keeps the draft unpublished", () => {
    for (const page of pages) {
      const doc = page["draft"] as { v: number; blocks: Row[] };
      expect(doc.v).toBe(1);
      expect(JSON.stringify(doc)).not.toContain('"milo"');
      for (const block of doc.blocks) expect(["hero", "heading", "text", "picture", "button", "columns", "features", "quote", "questions", "spacer", "form"]).toContain(block["kind"]);
      if (page["state"] === "live") {
        expect(page["published"]).toEqual(doc);
        expect(page["published_at"]).toEqual({ "@ago": expect.stringMatching(/^P\d+D$/) });
      } else {
        expect(page["published"]).toBeNull();
        expect(page["published_at"]).toBeNull();
      }
    }
  });

  it("links pages by an earlier page's label, and puts the Showroom form on the open day by its key", () => {
    const labels: string[] = [];
    for (const page of pages) {
      const refs = [...JSON.stringify(page["draft"]).matchAll(/"@ref":"([^"]+)"/g)].map((match) => match[1]!);
      for (const ref of refs) expect(labels, `${String(page["@label"])} → ${ref}`).toContain(ref);
      labels.push(String(page["@label"]));
    }
    const openDay = pages.find((page) => page["@label"] === "page:open-day")!["draft"] as { blocks: Row[] };
    expect(openDay.blocks.find((block) => block["kind"] === "form")).toEqual({ id: "book", kind: "form", form: showroom["id"], addOn: "forms" });
  });

  it("puts the open day, its form and its thanks page in order in the \"Open day\" funnel, linked to the CRM's brochure rule", () => {
    expect(funnels.length).toBe(1);
    const funnel = funnels[0]!;
    expect(texts(funnel["name"])["en-US"]).toBe("Open day");
    expect(funnel["steps"]).toEqual([
      { kind: "page", key: { "@ref": "page:open-day" } },
      { kind: "form", key: showroom["id"], addOn: "forms" },
      { kind: "page", key: { "@ref": "page:thanks" } },
    ]);
    // The rule the CRM ships for an enquirer who asks for the brochure, as this database installed it.
    expect(funnel["rule_id"]).toEqual({ "@rule": "brochure-asked" });
    expect((whole as unknown as Doc).automations.map((rule) => rule.key)).toContain("brochure-asked");
  });

  it("names no sample person (an app's rows for an add-on may not)", () => {
    expect(JSON.stringify(section)).not.toContain("@person");
  });

  // The add-ons' word check (the shelf's): what a sample shows an owner says none of these.
  it("says none of the words the add-ons' shelf refuses, in any language", () => {
    const text = JSON.stringify(section).toLowerCase();
    expect(text.length).toBeGreaterThan(3_000);
    for (const word of ["pro", "plan", "tier", "free"]) expect(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "u").test(text), word).toBe(false);
    for (const word of ["pricing", "billing", "upgrade", "premium", "/mo", "promoter", "planned", "planning", "plan your visit", "升级", "升級"]) expect(text.includes(word), word).toBe(false);
    for (const page of pages) expect(String(page["slug"]).startsWith("mo")).toBe(false);
  });
});
