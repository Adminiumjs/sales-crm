/**
 * TEXTS FROM A DEAL (plan 80): what the manifest says so a rep can send a text
 * from a deal beside "Log the call", and the text is logged as an activity.
 *
 * Read against the manifest and the vendored validator. The send itself is the
 * server's (`POST /texts/send`): consent, the stop list, the country, the hours
 * and the daily limit are judged there. The screen's half is
 * `screens/deal/text.test.ts`.
 */
import { describe, expect, it } from "vitest";

import released from "../../manifest.json";
import whole from "../../whole/manifest.json";
import { validateManifest } from "./manifest/index.ts";
import { installFloorWords, SMS_WORDS_FLOOR } from "./manifest/words.ts";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
type Column = { ref: string; type: string; enum?: string[]; rules?: { enumLabels?: { labels: Record<string, Record<string, string>> } } };
interface Doc {
  compatibility: { minAdminiumVersion: string };
  requiredSchema: { tables: { ref: string; columns: Column[] }[] };
  textReplies?: string;
  textTemplates?: unknown;
  outbox: { channels?: unknown };
  publicAccess: { table: string; key?: string; writable?: string[]; requires?: string[]; defaults?: Record<string, unknown>; textConsent?: unknown }[];
}

for (const [name, raw] of [
  ["the whole app", whole],
  ["the released stage", released],
] as const) {
  const doc = raw as unknown as Doc;
  const kind = doc.requiredSchema.tables.find((one) => one.ref === "activities")!.columns.find((one) => one.ref === "kind")!;

  describe(`texts in ${name}`, () => {
    it("passes the validator, and needs the Adminium that knows the text words", () => {
      const result = validateManifest(raw);
      expect(result.ok ? [] : result.issues).toEqual([]);
      expect(doc.compatibility.minAdminiumVersion).toBe(SMS_WORDS_FLOOR);
      // Exactly the words this app says: people's phones, the roles' grants, the replies switch and the form's box.
      const words = [...new Set(installFloorWords(raw).map((one) => one.word))].filter((word) => ["people.phone", "roles.texts", "textReplies", "textTemplates", "publicAccess.textConsent", "outbox.channels"].includes(word));
      expect(words.sort()).toEqual(["people.phone", "publicAccess.textConsent", "roles.texts", "textReplies"]);
    });

    it("logs a text as an activity of its own kind, named in all eight languages", () => {
      expect(kind.enum).toEqual(["call", "email", "meeting", "note", "text"]);
      const labels = kind.rules!.enumLabels!.labels;
      for (const value of kind.enum!) expect(Object.keys(labels[value]!).sort(), value).toEqual([...LOCALES].sort());
      expect(labels["text"]!["en-US"]).toBe("Text");
    });

    it("reads what customers text back, and sends no text of its own on a rule", () => {
      expect(doc.textReplies).toBe("on");
      // A person writes every text this app sends: no template, no text kind in the outbox.
      expect(doc.textTemplates).toBeUndefined();
      expect(doc.outbox.channels).toBeUndefined();
    });

    it("asks a website form's enquirer for a yes to texts in a box of its own: unticked, never required, for the number typed", () => {
      const boxes = doc.publicAccess.filter((entry) => entry.textConsent !== undefined);
      expect(boxes.map((entry) => [entry.table, entry.key])).toEqual([["enquiries", "forms"]]);
      const entry = boxes[0]!;
      const box = entry.textConsent as { column: string; phone: string; class: string; wording: { version: number; text: Record<string, string> } };
      expect(box).toMatchObject({ column: "text_ok", phone: "phone", class: "service", wording: { version: 1 } });
      expect(Object.keys(box.wording.text).sort()).toEqual([...LOCALES].sort());
      for (const text of Object.values(box.wording.text)) expect(text).not.toMatch(/\bYES\b/);
      // Its own column, never the e-mail tick's, starting empty and never required.
      const column = doc.requiredSchema.tables.find((one) => one.ref === "enquiries")!.columns.find((one) => one.ref === "text_ok") as Column & { nullable?: boolean; default?: unknown };
      expect(column).toMatchObject({ type: "bool", nullable: true });
      expect(column.default).toBeUndefined();
      expect(entry.writable).toContain("text_ok");
      expect(entry.requires ?? []).not.toContain("text_ok");
      expect(entry.defaults?.["text_ok"]).toBeUndefined();
    });
  });
}
