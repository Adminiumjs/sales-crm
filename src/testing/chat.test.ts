/**
 * What the website chat (the Live chat add-on) may do to the CRM: a question
 * left outside hours makes an enquiry through the chat entry and nothing else,
 * filling only the visitor's name, address and question; the Team inbox's
 * roles read the chat an enquiry came from; and the sample's chat
 * (`sampleData.addOns["live-chat"]`).
 *
 * Read against the manifest and the sample files. That a question becomes an
 * enquiry, in hours and out, that the inbox's roles read its chat and the
 * others do not, and that the sample loads and leaves whole, is proved on the
 * whole server, on three engines (`proofs/crm-chat.test.ts`,
 * `proofs/crm-sample.test.ts`).
 */
import { describe, expect, it } from "vitest";

import released from "../../manifest.json";
import whole from "../../whole/manifest.json";
import main from "../../whole/seeds/meridian.json";
import section from "../../whole/seeds/meridian.live-chat.json";
import { validateManifest } from "./manifest/index.ts";
import { CHAT_ENTRY_WORDS } from "./manifest/public-access.ts";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
type Column = { ref: string; type: string; nullable?: boolean; maxLength?: number; enum?: string[]; default?: unknown };
type Entry = { table: string; key?: string; module?: string; methods: string[]; writable?: string[]; defaults?: Record<string, unknown>; anonymous?: Record<string, unknown>; source?: string; requires?: string[] };
type Grant = { addOn: string; table: string; actions: string[]; limit?: { readable?: string[] } };
type Role = { key: string; permissions: string[]; tables?: Grant[] };
type Row = Record<string, unknown>;
interface Doc {
  compatibility: { minAdminiumVersion: string };
  requiredSchema: { tables: { ref: string; columns: Column[] }[] };
  publicAccess: Entry[];
  roles: Role[];
  addOns: { suggests: { key: string; range: string; checked?: boolean; reason: Record<string, string> }[] };
  sampleData: { addOns?: Record<string, { file: string }> };
}

/** The roles of the Team inbox: each adds enquiries, and so reads the chat one came from. */
const INBOX_ROLES = ["admin", "sales-manager", "rep", "marketer", "front-desk"];
const CONVERSATION_READ = ["id", "started_at", "outside_hours", "became_table", "became_key"];
const MESSAGE_READ = ["id", "conversation_id", "kind", "body", "event", "author_id", "sent_at"];

for (const [name, raw] of [
  ["the whole app", whole],
  ["the released stage", released],
] as const) {
  const doc = raw as unknown as Doc;
  const columns = (ref: string) => doc.requiredSchema.tables.find((one) => one.ref === ref)!.columns;
  const column = (ref: string, col: string) => columns(ref).find((one) => one.ref === col);
  const entry = doc.publicAccess.find((one) => one.table === "enquiries" && one.key === "chat")!;
  const forms = doc.publicAccess.find((one) => one.table === "enquiries" && one.key === "forms")!;

  describe(`the website chat, in ${name}`, () => {
    it("still passes the validator, and needs Adminium 0.3.65 (0.3.64 brought the chat entry)", () => {
      const result = validateManifest(raw);
      expect(result.ok ? [] : result.issues).toEqual([]);
      expect(doc.compatibility.minAdminiumVersion).toBe("0.3.65");
      // Under an older floor "chat" is no reserved key: the entry would be refused, so the floor cannot go back.
      const older = validateManifest({ ...structuredClone(raw), compatibility: { ...doc.compatibility, minAdminiumVersion: "0.3.63" } });
      expect(older.ok ? [] : older.issues.map((issue) => issue.path)).toContainEqual(expect.stringMatching(/^publicAccess\.\d+\.key$/));
    });

    it("opens enquiries to a question left outside hours: one entry, the visitor's name, address and question, open, from the chat", () => {
      expect(doc.publicAccess.filter((one) => one.key === "chat")).toEqual([entry]);
      expect(entry).toEqual({
        table: "enquiries",
        key: "chat",
        module: "inbox",
        methods: ["POST"],
        writable: ["person", "email", "text"],
        // A visitor gives no company: the empty name stands for "No company yet", and claiming the enquiry asks for one.
        defaults: { state: "open", source: "chat", company_name: "" },
        anonymous: { ...forms.anonymous, plainText: [{ column: "person", max: 120 }] },
      });
      // Only the words a chat entry takes (no `source`, no `requires`: the door fills the columns by their names).
      for (const word of Object.keys(entry)) expect(CHAT_ENTRY_WORDS as readonly string[], word).toContain(word);
    });

    it("fills the columns the chat's door fills by name, which are the enquiry's own", () => {
      // The question into `text`, the name into `person`, the address into `email`.
      expect([column("enquiries", "text")?.type, column("enquiries", "person")?.type, column("enquiries", "email")?.type]).toEqual(["text", "text", "text"]);
      // No other column a door fills by name is there to take the question or the name instead.
      for (const other of ["message", "question", "body", "name"]) expect(column("enquiries", other), other).toBeUndefined();
      // The company is a must, with no default: the entry's empty name is what lets a chat's enquiry in.
      expect(column("enquiries", "company_name")).toMatchObject({ type: "text" });
      expect(column("enquiries", "company_name")?.nullable).not.toBe(true);
      expect(column("enquiries", "source")?.enum).toContain("chat");
      expect(column("enquiries", "state")?.enum).toContain("open");
    });

    it("lets the inbox's roles add an enquiry (staff's \"Make an enquiry\" is their own create) and read the chat it came from; nobody else", () => {
      for (const role of doc.roles) {
        const chat = (role.tables ?? []).filter((grant) => grant.addOn === "live-chat");
        if (INBOX_ROLES.includes(role.key)) {
          expect(role.permissions, role.key).toContain("table:@enquiries:create");
          expect(chat, role.key).toEqual([
            { addOn: "live-chat", table: "conversations", actions: ["read"], limit: { readable: CONVERSATION_READ } },
            // The lines are personal (the visitor wrote them): read in clear, as the enquiry's own text is.
            { addOn: "live-chat", table: "messages", actions: ["read", "read_pii"], limit: { readable: MESSAGE_READ } },
          ]);
        } else {
          expect(chat, role.key).toEqual([]);
        }
      }
    });

    it("suggests Live chat fifth, not ticked, from the version that answers a chat, saying why in eight languages", () => {
      const keys = doc.addOns.suggests.map((one) => one.key);
      expect(keys.indexOf("live-chat")).toBe(4);
      expect(keys.length).toBeLessThanOrEqual(8);
      const chat = doc.addOns.suggests[4]!;
      expect([chat.range, chat.checked]).toEqual([">=1.0.30", undefined]);
      expect(Object.keys(chat.reason).sort()).toEqual([...LOCALES].sort());
    });

    it("names the chat's sample beside the others", () => {
      expect(doc.sampleData.addOns?.["live-chat"]).toEqual({ file: "seeds/meridian.live-chat.json" });
    });
  });
}

describe("the sample's chat", () => {
  const tables = (section as unknown as { tables: { ref: string; rows: Row[] }[] }).tables;
  const rows = (ref: string) => tables.find((one) => one.ref === ref)!.rows;
  const enquiries = (main as unknown as { tables: { ref: string; rows: Row[] }[] }).tables.find((one) => one.ref === "enquiries")!.rows;
  const texts = (value: unknown): Record<string, string> => (value as { "@t": Record<string, string> })["@t"];

  it("is the CRM's rows for Live chat: two answers, one conversation, its lines, in that order", () => {
    expect((section as unknown as Row)["app"]).toBe("crm");
    expect((section as unknown as Row)["addOn"]).toBe("live-chat");
    expect(tables.map((one) => one.ref)).toEqual(["answers", "conversations", "messages"]);
    expect([rows("answers").length, rows("conversations").length]).toEqual([2, 1]);
  });

  it("became the sample's enquiry from Veldt Studios, which now says it came from the chat, with the visitor's question as its text", () => {
    const [conversation] = rows("conversations");
    expect(conversation!["became_table"]).toBe("crm:enquiries");
    expect(conversation!["became_key"]).toEqual({ "@ref": "enq:marta" });
    const enquiry = enquiries.find((one) => one["@label"] === "enq:marta")!;
    expect([enquiry["source"], enquiry["company_name"], enquiry["person"], enquiry["state"]]).toEqual(["chat", "Veldt Studios", "Marta Kovac", "open"]);
    expect([conversation!["name"], conversation!["email"]]).toEqual([enquiry["person"], enquiry["email"]]);
    const first = rows("messages")[0]!;
    expect(first["kind"]).toBe("visitor");
    expect(first["body"]).toEqual(enquiry["text"]);
    // The only enquiry from the chat in the sample: with Live chat absent it reads as any other, with no button.
    expect(enquiries.filter((one) => one["source"] === "chat")).toEqual([enquiry]);
  });

  it("holds an automatic answer, a reply from the team and the chat's own lines, each line of the one conversation", () => {
    const lines = rows("messages");
    expect(lines.map((line) => line["kind"])).toEqual(["visitor", "automatic", "visitor", "system", "system", "staff", "visitor", "system", "system"]);
    expect(lines.map((line) => line["event"] ?? null)).toEqual([null, null, null, "asked", "taken", null, null, "enquiry", "closed"]);
    for (const line of lines) expect(line["conversation_id"]).toEqual({ "@ref": "chat:marta" });
    // The automatic answer is one of the two, word for word.
    const automatic = lines[1]!;
    const answer = rows("answers").find((one) => one["ref"] === automatic["answer_ref"])!;
    const versions = answer["versions"] as Record<string, { title: string; text: string; examples: string[] }>;
    for (const locale of LOCALES) expect(texts(automatic["body"])[locale], locale).toBe(versions[locale]!.text);
  });

  it("says every line and answer in eight languages, the conversation's language with them", () => {
    for (const line of rows("messages")) expect(Object.keys(texts(line["body"])).sort()).toEqual([...LOCALES].sort());
    const language = texts(rows("conversations")[0]!["language"]);
    for (const locale of LOCALES) expect(language[locale]).toBe(locale);
    for (const answer of rows("answers")) {
      const versions = answer["versions"] as Record<string, { title: string; text: string; examples: string[] }>;
      expect(Object.keys(versions).sort()).toEqual([...LOCALES].sort());
      for (const locale of LOCALES) {
        expect(versions[locale]!.title.length, locale).toBeGreaterThan(0);
        expect(versions[locale]!.text.length, locale).toBeLessThanOrEqual(2000);
        expect(versions[locale]!.examples.length, locale).toBeGreaterThan(0);
      }
    }
    // Lines fit the add-on's 2,000 characters.
    for (const line of rows("messages")) for (const text of Object.values(texts(line["body"]))) expect(text.length).toBeLessThanOrEqual(2000);
  });

  it("names no sample person (an app's rows for an add-on may not), and keeps no address the chat would have taken from a real visitor", () => {
    expect(JSON.stringify(section)).not.toContain("@person");
    for (const conversation of rows("conversations")) for (const key of ["ip", "ip_hash", "user_agent", "token"]) expect(conversation[key], key).toBeUndefined();
  });

  // The add-ons' word check (the shelf's): what a sample shows an owner says none of these.
  it("says none of the words the add-ons' shelf refuses, in any language", () => {
    const text = JSON.stringify(section).toLowerCase();
    expect(text.length).toBeGreaterThan(5_000);
    for (const word of ["pro", "plan", "tier", "free"]) expect(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "u").test(text), word).toBe(false);
    for (const word of ["pricing", "billing", "upgrade", "premium", "/mo", "promoter", "planned", "planning", "升级", "升級"]) expect(text.includes(word), word).toBe(false);
  });
});
